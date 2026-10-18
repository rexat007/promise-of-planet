import * as fs from 'fs';
import * as path from 'path';
import {
  CitizenSubmissionServiceClass,
  InMemoryCitizenSubmissionRepository,
  InMemoryCitizenEvidenceStorageAdapter,
  validateCitizenSubmissionData,
  validateEvidenceFile,
} from './citizenSubmissionService';
import { AccountService, InMemoryAccountRepository } from './accountService';
import { SubmissionStatus, CANONICAL_COMMUNITY_CATEGORIES } from '../types/community';
import { AdminRole, AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';
import { PublicNewsClient } from './publicNewsClient';
import { SOCIAL_PLATFORM_ICON_PATHS } from '../components/common/SocialPlatformIcon';

export interface CitizenJournalismTestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

export async function runCitizenJournalismFunctionalTests(): Promise<CitizenJournalismTestResult[]> {
  const results: CitizenJournalismTestResult[] = [];

  const record = (id: string, name: string, passed: boolean, details: string) => {
    results.push({ id, name, passed, details });
  };

  // Isolate AccountService & CitizenSubmissionService with in-memory repositories
  const originalAccountRepo = AccountService.getRepository();
  const accountRepo = new InMemoryAccountRepository();
  AccountService.setRepository(accountRepo);

  const service = new CitizenSubmissionServiceClass();
  const subRepo = new InMemoryCitizenSubmissionRepository();
  const storageAdapter = new InMemoryCitizenEvidenceStorageAdapter();
  service.setRepository(subRepo);
  service.setStorageAdapter(storageAdapter);

  let currentAuthUid: string | null = null;
  service.setAuthProvider(() => currentAuthUid);

  try {
    // =========================================================================
    // TEST 1: Unauthenticated submission is strictly blocked
    // =========================================================================
    {
      currentAuthUid = null;
      let blocked = false;
      let errCode = '';
      try {
        await service.submitReport({
          contributorName: 'Anonymous Visitor',
          title: 'Illegal logging near river bank',
          body: 'Detailed observation of unauthorized tree cutting along the river.',
          sourceLanguage: 'en',
          category: 'desertification',
          locationDescription: 'Sennar State',
        });
      } catch (err: any) {
        blocked = true;
        errCode = err.code || '';
      }

      const count = (await subRepo.listAllSubmissions()).length;
      record(
        'CJ-01',
        'Unauthenticated visitor is blocked from submitting Citizen Journalist reports',
        blocked && errCode === 'AUTH_REQUIRED' && count === 0,
        `blocked=${blocked}, code=${errCode}, persistedCount=${count}`
      );
    }

    // =========================================================================
    // TEST 2: Authenticated user without provisioned canonical Account is blocked
    // =========================================================================
    {
      currentAuthUid = 'uid-unprovisioned-99';
      let blocked = false;
      let errCode = '';
      try {
        await service.submitReport({
          contributorName: 'Unprovisioned User',
          title: 'Water pollution observation in canal',
          body: 'Observed agricultural runoff entering the main irrigation canal.',
          sourceLanguage: 'en',
          category: 'water',
          locationDescription: 'Gezira State',
        });
      } catch (err: any) {
        blocked = true;
        errCode = err.code || '';
      }

      const count = (await subRepo.listAllSubmissions()).length;
      record(
        'CJ-02',
        'Authenticated user without canonical Account profile fails closed (ACCOUNT_UNAVAILABLE)',
        blocked && errCode === 'ACCOUNT_UNAVAILABLE' && count === 0,
        `blocked=${blocked}, code=${errCode}, persistedCount=${count}`
      );
    }

    // =========================================================================
    // TEST 3: Authenticated user with provisioned Account creates Received report with bound UID & private evidence
    // =========================================================================
    let subAId = '';
    {
      const uidA = 'uid-reporter-alpha';
      await accountRepo.createAccount({
        id: uidA,
        email: 'alpha@reporter.sd',
        displayName: 'أحمد المراسل البيئي',
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
      });
      currentAuthUid = uidA;

      const created = await service.submitReport({
        contributorName: 'أحمد المراسل البيئي',
        contributorContact: 'alpha@reporter.sd',
        title: 'رصد انحسار الغطاء النباتي في أطراف القضارف',
        body: 'تم توثيق تراجع واضح في أشجار السنط والطلح نتيجة القطع الجائر وموجات الجفاف المتتالية.',
        sourceLanguage: 'ar',
        category: 'desertification',
        locationDescription: 'ولاية القضارف — محلية البطانة',
        // Attempt to spoof status on creation (must be ignored)
        status: SubmissionStatus.AcceptedForEditorial,
        moderatorNotes: 'Spoofed note',
        evidenceFiles: [
          {
            name: 'field photo 01.jpg',
            type: 'image/jpeg',
            size: 512 * 1024,
            file: new Uint8Array([1, 2, 3, 4]),
          },
        ],
      });

      subAId = created.id;
      const stored = await subRepo.getSubmissionById(created.id);
      const att = stored?.attachments[0];
      const expectedPrefix = `citizen_submissions/${uidA}/${created.id}/`;

      const passed =
        stored !== null &&
        stored.submittedByUid === uidA &&
        stored.status === SubmissionStatus.Received &&
        stored.moderatorNotes === undefined &&
        stored.category === 'desertification' &&
        stored.locationDescription === 'ولاية القضارف — محلية البطانة' &&
        stored.attachments.length === 1 &&
        Boolean(att?.storagePath && att.storagePath.startsWith(expectedPrefix)) &&
        att?.fileUrl === `storage://${att?.storagePath}` &&
        storageAdapter.hasObject(att!.storagePath!);

      record(
        'CJ-03',
        'Provisioned reporter creates durable Received submission with bound UID and private evidence storage path',
        passed,
        `id=${created.id}, uid=${stored?.submittedByUid}, status=${stored?.status}, storagePath=${att?.storagePath}`
      );
    }

    // =========================================================================
    // TEST 4: Evidence validation & atomic rollback on upload failure (no false success or orphan files)
    // =========================================================================
    {
      const invalidMimeCheck = validateEvidenceFile({
        name: 'payload.exe',
        type: 'application/x-msdownload',
        size: 1024,
      });
      const oversizeCheck = validateEvidenceFile({
        name: 'huge_video.mp4',
        type: 'video/mp4',
        size: 20 * 1024 * 1024, // 20 MB > 15 MB limit
      });

      let fakeUrlRejected = false;
      try {
        validateCitizenSubmissionData({
          id: 'sub-fake-url',
          submittedAt: new Date().toISOString(),
          submittedByUid: 'uid-reporter-alpha',
          contributorName: 'Reporter',
          title: 'Valid title here',
          body: 'Valid detailed description of environmental observation.',
          sourceLanguage: 'en',
          category: 'water',
          status: SubmissionStatus.Received,
          attachments: [
            {
              id: 'att-bad',
              fileName: 'photo.jpg',
              fileType: 'image',
              storagePath: 'citizen_submissions/uid-reporter-alpha/sub-fake-url/att-bad_photo.jpg',
              fileUrl: 'https://untrusted.example.com/fake-photo.jpg',
            },
          ],
          updatedAt: new Date().toISOString(),
        });
      } catch {
        fakeUrlRejected = true;
      }

      // Simulate storage upload failure and verify no submission is created
      const beforeObjCount = storageAdapter.getObjectCount();
      const beforeSubCount = (await subRepo.listAllSubmissions()).length;
      storageAdapter.setShouldFailUploads(true);

      let uploadFailCaught = false;
      try {
        await service.submitReport({
          contributorName: 'أحمد المراسل البيئي',
          title: 'بلاغ لن يكتمل بسبب فشل رفع المرفق',
          body: 'وصف تفصيلي للبلاغ الميداني الذي يحتوي على مرفق يفشل رفعه.',
          sourceLanguage: 'ar',
          category: 'water',
          evidenceFiles: [
            {
              name: 'evidence.pdf',
              type: 'application/pdf',
              size: 100 * 1024,
              file: new Uint8Array([9, 9, 9]),
            },
          ],
        });
      } catch (err: any) {
        uploadFailCaught = err.code === 'ATTACHMENT_UPLOAD_FAILED';
      } finally {
        storageAdapter.setShouldFailUploads(false);
      }

      const afterObjCount = storageAdapter.getObjectCount();
      const afterSubCount = (await subRepo.listAllSubmissions()).length;

      const passed =
        !invalidMimeCheck.valid &&
        !oversizeCheck.valid &&
        fakeUrlRejected &&
        uploadFailCaught &&
        beforeObjCount === afterObjCount &&
        beforeSubCount === afterSubCount;

      record(
        'CJ-04',
        'Invalid evidence files, fake external URLs, and failed uploads fail-closed with atomic rollback',
        passed,
        `invalidMime=${!invalidMimeCheck.valid}, oversize=${!oversizeCheck.valid}, fakeUrlRejected=${fakeUrlRejected}, uploadFailCaught=${uploadFailCaught}, noOrphanSub=${beforeSubCount === afterSubCount}`
      );
    }

    // =========================================================================
    // TEST 5: Contributor isolation (Contributor B cannot view Contributor A's submissions or private evidence)
    // =========================================================================
    {
      const uidB = 'uid-reporter-beta';
      await accountRepo.createAccount({
        id: uidB,
        email: 'beta@reporter.sd',
        displayName: 'سارة المراسلة',
        createdAt: '2026-10-02T10:00:00Z',
        updatedAt: '2026-10-02T10:00:00Z',
      });
      currentAuthUid = uidB;

      const subB = await service.submitReport({
        contributorName: 'سارة المراسلة',
        title: 'Coastal mangrove stress observation in Port Sudan',
        body: 'Documented sediment accumulation affecting coastal red sea mangroves.',
        sourceLanguage: 'en',
        category: 'marine',
        locationDescription: 'Red Sea State — Port Sudan',
      });

      const listForB = await service.listMySubmissions();
      const seesOnlyOwn = listForB.length === 1 && listForB[0].id === subB.id;

      // Contributor B tries to resolve Contributor A's private attachment URL
      const subA = await subRepo.getSubmissionById(subAId);
      const attA = subA!.attachments[0];
      let crossOwnerAttachmentBlocked = false;
      try {
        await service.resolveAttachmentAccessUrl(attA, { contributorUid: uidB });
      } catch (err: any) {
        crossOwnerAttachmentBlocked = err.code === 'UNAUTHORIZED';
      }

      // Contributor A CAN resolve their own attachment URL
      const ownerResolvedUrl = await service.resolveAttachmentAccessUrl(attA, {
        contributorUid: 'uid-reporter-alpha',
      });

      record(
        'CJ-05',
        'Contributors are strictly isolated to their own submissions and private evidence attachments',
        seesOnlyOwn && crossOwnerAttachmentBlocked && ownerResolvedUrl.includes('citizen_submissions'),
        `seesOnlyOwn=${seesOnlyOwn}, crossOwnerBlocked=${crossOwnerAttachmentBlocked}, ownerResolved=${Boolean(ownerResolvedUrl)}`
      );
    }

    // =========================================================================
    // TEST 6: Admin RBAC moderation & Editorial boundary (AcceptedForEditorial never auto-publishes News)
    // =========================================================================
    {
      const viewerAdmin: AdminUser = {
        id: 'admin-viewer-1',
        name: 'Analytics Viewer',
        email: 'viewer@pop.sd',
        role: AdminRole.AnalyticsViewer,
        isActive: true,
      };

      const moderatorAdmin: AdminUser = {
        id: 'admin-mod-1',
        name: 'Citizen Moderator',
        email: 'mod@pop.sd',
        role: AdminRole.CitizenModerator,
        isActive: true,
      };

      // Viewer lacks AdminPermission.Review -> must be blocked from moderating
      let viewerBlocked = false;
      try {
        await service.moderateSubmission(
          subAId,
          { status: SubmissionStatus.UnderReview, moderatorNotes: 'Unauthorized attempt' },
          viewerAdmin
        );
      } catch (err: any) {
        viewerBlocked = err.code === 'UNAUTHORIZED';
      }

      // Snapshot public News articles before moderation
      const newsBefore = await PublicNewsClient.listPublishedNews();

      // Authorized CitizenModerator updates submission to AcceptedForEditorial
      const moderated = await service.moderateSubmission(
        subAId,
        {
          status: SubmissionStatus.AcceptedForEditorial,
          moderatorNotes: 'تم التحقق من الصور الميدانية وإحالة البلاغ لفريق التحرير.',
          editorialReferenceId: 'news-draft-ref-2026-77',
        },
        moderatorAdmin
      );

      // Authorized CitizenModerator can resolve private attachment URL
      const adminAttachmentUrl = await service.resolveAttachmentAccessUrl(moderated.attachments[0], {
        adminUser: moderatorAdmin,
      });

      const newsAfter = await PublicNewsClient.listPublishedNews();
      const noAutoPublish =
        newsBefore.length === newsAfter.length &&
        !newsAfter.some((n) => n.id === subAId || n.title === moderated.title);

      const passed =
        viewerBlocked &&
        moderated.status === SubmissionStatus.AcceptedForEditorial &&
        moderated.submittedByUid === 'uid-reporter-alpha' &&
        moderated.reviewedByUid === moderatorAdmin.id &&
        moderated.editorialReferenceId === 'news-draft-ref-2026-77' &&
        adminAttachmentUrl.includes('citizen_submissions') &&
        noAutoPublish;

      record(
        'CJ-06',
        'Admin RBAC enforces Review permission and AcceptedForEditorial never auto-publishes to News',
        passed,
        `viewerBlocked=${viewerBlocked}, newStatus=${moderated.status}, preservedOwner=${moderated.submittedByUid}, noAutoPublish=${noAutoPublish}`
      );
    }

    // =========================================================================
    // TEST 7: Public Navigation Order, About Us Consolidation & PNG Social Media Assets
    // =========================================================================
    {
      const headerCode = fs.readFileSync(path.resolve('./src/components/layout/Header.tsx'), 'utf8');
      const aboutCode = fs.readFileSync(path.resolve('./src/components/about/AboutUsView.tsx'), 'utf8');
      const appCode = fs.readFileSync(path.resolve('./src/App.tsx'), 'utf8');
      const firestoreRules = fs.readFileSync(path.resolve('./firestore.rules'), 'utf8');
      const storageRules = fs.readFileSync(path.resolve('./storage.rules'), 'utf8');

      // Extract navItems keys in order from Header.tsx
      const navMatch = headerCode.match(/const navItems = \[([\s\S]*?)\];/);
      const navBlock = navMatch ? navMatch[1] : '';
      const keyMatches = Array.from(navBlock.matchAll(/key:\s*'([^']+)'/g)).map((m) => m[1]);
      const expectedNavOrder = [
        'home',
        'news',
        'media',
        'library',
        'training',
        'citizen-journalist',
        'about',
      ];
      const navOrderExact =
        keyMatches.length === expectedNavOrder.length &&
        keyMatches.every((k, idx) => k === expectedNavOrder[idx]);

      const aboutConsolidatesChannels =
        aboutCode.includes('id="official-channels-section"') &&
        aboutCode.includes('https://www.youtube.com/@PromiseOfPlanet') &&
        aboutCode.includes('https://www.facebook.com/PromiseOfPlanet/') &&
        aboutCode.includes('https://www.instagram.com/promiseplanet1974') &&
        aboutCode.includes('https://whatsapp.com/channel/0029Vazh20iB4hdWzpMeOI0r') &&
        aboutCode.includes('SocialPlatformIcon');

      const appWiresCitizenJournalist =
        appCode.includes('<PublicCitizenJournalist') &&
        appCode.includes("activePage === 'citizen-journalist'");

      // Verify PNG icon files exist and have valid PNG signature (89 50 4E 47)
      const pngPlatforms = Object.keys(SOCIAL_PLATFORM_ICON_PATHS) as Array<keyof typeof SOCIAL_PLATFORM_ICON_PATHS>;
      const allPngsValid = pngPlatforms.every((platform) => {
        const relPath = SOCIAL_PLATFORM_ICON_PATHS[platform].replace(/^\//, 'public/');
        const fullPath = path.resolve(relPath);
        if (!fs.existsSync(fullPath)) return false;
        const buf = fs.readFileSync(fullPath);
        return (
          buf.length > 500 &&
          buf[0] === 0x89 &&
          buf[1] === 0x50 &&
          buf[2] === 0x4e &&
          buf[3] === 0x47
        );
      });

      const rulesConfigured =
        firestoreRules.includes('match /citizen_submissions/{submissionId}') &&
        firestoreRules.includes('isCanonicalCitizenSubmissionShape()') &&
        storageRules.includes('match /citizen_submissions/{userId}/{submissionId}/{fileName}');

      const canonicalCategoriesValid =
        CANONICAL_COMMUNITY_CATEGORIES.join(',') === 'water,climate,desertification,marine' &&
        AdminPermission.Review === 'review';

      const passed =
        navOrderExact &&
        aboutConsolidatesChannels &&
        appWiresCitizenJournalist &&
        allPngsValid &&
        rulesConfigured &&
        canonicalCategoriesValid;

      record(
        'CJ-07',
        'Public navigation order, consolidated About Us channels, PNG social icons, and security rules are verified',
        passed,
        `navOrder=[${keyMatches.join(', ')}], aboutConsolidated=${aboutConsolidatesChannels}, pngIconsValid=${allPngsValid}, rulesConfigured=${rulesConfigured}`
      );
    }
  } finally {
    AccountService.setRepository(originalAccountRepo);
  }

  return results;
}
