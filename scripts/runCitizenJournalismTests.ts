/**
 * Standalone test runner for Citizen Journalism & Navigation Integration.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const memoryStore = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => memoryStore.get(k) || null,
    setItem: (k: string, v: string) => memoryStore.set(k, String(v)),
    removeItem: (k: string) => memoryStore.delete(k),
    clear: () => memoryStore.clear(),
  };
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    location: {
      origin: 'https://promiseofplanet.org',
      hash: '',
    },
  };
}

import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

class FallbackHttpsError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
): unknown {
  try {
    return originalModuleLoad.call(this, request, parent, isMain);
  } catch (err: unknown) {
    if (request === 'firebase-functions/v2/https') {
      return {
        HttpsError: FallbackHttpsError,
        onCall: (_opts: unknown, handler: unknown) => handler,
        onRequest: (_opts: unknown, handler: unknown) => handler,
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error('Uninjected live getFirestore() must not be called in headless tests.');
        },
      };
    }
    if (request === 'firebase-admin/app') {
      return { getApps: () => [], initializeApp: () => ({ name: '[DEFAULT]' }) };
    }
    if (request === 'firebase-admin/auth') {
      return { getAuth: () => ({}) };
    }
    throw err;
  }
};

const require = createRequire(import.meta.url);

async function registerBunFirebaseMocks(): Promise<void> {
  if (typeof (globalThis as unknown as { Bun?: unknown }).Bun === 'undefined') {
    return;
  }
  const bunTestSpec: string = 'bun:test';
  const bunTest = (await import(bunTestSpec)) as {
    mock: { module: (spec: string, factory: () => Record<string, unknown>) => void };
  };
  bunTest.mock.module('firebase-functions/v2/https', () => ({
    HttpsError: FallbackHttpsError,
    onCall: (_opts: unknown, handler: unknown) => handler,
    onRequest: (_opts: unknown, handler: unknown) => handler,
  }));
  bunTest.mock.module('firebase-functions/params', () => ({
    defineSecret: (name: string) => ({ name, value: () => process.env[name] || '' }),
  }));
  bunTest.mock.module('firebase-admin/app', () => ({
    getApps: () => [],
    initializeApp: () => ({ name: '[DEFAULT]' }),
  }));
  bunTest.mock.module('firebase-admin/auth', () => ({
    getAuth: () => ({}),
  }));
  bunTest.mock.module('firebase-admin/firestore', () => ({
    getFirestore: () => {
      throw new Error('Uninjected live getFirestore() must not be called in headless tests.');
    },
  }));
  bunTest.mock.module('firebase-admin/storage', () => ({
    getStorage: () => {
      throw new Error('Uninjected live getStorage() must not be called in headless tests.');
    },
  }));
}

interface CoordCheckResult {
  readonly id: string;
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

async function runCoordinatedCitizenVerification(): Promise<CoordCheckResult[]> {
  const results: CoordCheckResult[] = [];

  const {
    executeSubmitCitizenReport,
    executeManageCitizenSubmissions,
  } = await import('../functions/src/community/communityHandlers');
  const { CommunityApplicationService } = await import('../functions/src/community/communityApplicationService');
  const { InMemoryCommunityRepository } = await import('../functions/src/community/inMemoryCommunityRepository');
  const { InMemoryNewsRepository } = await import('../functions/src/news/inMemoryNewsRepository');
  const { NewsApplicationService } = await import('../functions/src/news/newsApplicationService');
  const { AdminRole: FnAdminRole } = await import('../functions/src/shared/adminContract');
  const {
    CitizenSubmissionServiceClass,
    InMemoryCitizenEvidenceStorageAdapter,
  } = await import('../src/services/citizenSubmissionService');
  const { CitizenSubmissionReviewModal } = await import('../src/components/community/CitizenSubmissionReviewModal');
  const { SubmissionStatus } = await import('../src/types/community');
  const { AdminRole } = await import('../src/types/admin');

  const allNineRoles = [
    FnAdminRole.Owner,
    FnAdminRole.CitizenModerator,
    FnAdminRole.ContentEditor,
    FnAdminRole.Viewer,
    FnAdminRole.Trainer,
    FnAdminRole.TrainingManager,
    FnAdminRole.LibraryCurator,
    FnAdminRole.RightsReviewer,
    FnAdminRole.AIAssistant,
  ] as const;

  const admins = new Map<string, any>();
  for (const role of allNineRoles) {
    admins.set(`uid_${role}`, {
      id: `uid_${role}`,
      name: `Admin ${role}`,
      email: `${role.toLowerCase()}@pop.org`,
      role,
      isActive: true,
    });
  }
  const fakeAdminRepo = {
    getAdminByUid: async (uid: string) => admins.get(uid) ?? null,
    saveAdmin: async (a: any) => a,
    listAdmins: async () => Array.from(admins.values()),
  };

  // CJ-COORD-01: 9-role RBAC matrix on manageCitizenSubmissions (listAll/getById/moderate/createNewsDraft)
  try {
    const communityRepo = new InMemoryCommunityRepository();
    const communityService = new CommunityApplicationService(communityRepo);
    const newsRepo = new InMemoryNewsRepository();
    const newsService = new NewsApplicationService(newsRepo, undefined, { getVideoById: async () => null }, communityRepo);

    const seededSub = await communityService.submitReport(
      {
        id: 'sub-rbac-001',
        contributorName: 'مراسل ميداني',
        title: 'رصد ميداني لجفاف بحيرة',
        body: 'تفاصيل ميدانية موثقة من موقع البحيرة مع صور خاصة.',
        sourceLanguage: 'ar',
        category: 'water',
        locationDescription: 'دارفور',
        attachments: [
          {
            id: 'att-1',
            fileName: 'private-lake.jpg',
            fileType: 'image',
            fileUrl: 'storage://citizen_submissions/citizen_01/sub-rbac-001/private-lake.jpg',
            storagePath: 'citizen_submissions/citizen_01/sub-rbac-001/private-lake.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 2048,
          },
        ],
      } as any,
      'citizen_01'
    );

    const viewModAllowed = new Set<string>([FnAdminRole.Owner, FnAdminRole.CitizenModerator]);
    const handoffAllowed = new Set<string>([
      FnAdminRole.Owner,
      FnAdminRole.CitizenModerator,
      FnAdminRole.ContentEditor,
    ]);

    const failures: string[] = [];

    for (const role of allNineRoles) {
      const uid = `uid_${role}`;
      const expectViewMod = viewModAllowed.has(role);

      for (const action of ['listAll', 'getById', 'moderate'] as const) {
        let succeeded = false;
        let errCode = '';
        try {
          await executeManageCitizenSubmissions(
            {
              auth: { uid },
              data:
                action === 'listAll'
                  ? { action }
                  : action === 'getById'
                  ? { action, id: seededSub.id }
                  : { action, id: seededSub.id, status: 'UnderReview', moderatorNotes: 'Checking' },
            },
            fakeAdminRepo,
            communityService,
            newsService
          );
          succeeded = true;
        } catch (err: any) {
          errCode = String(err?.code || '');
        }
        if (expectViewMod && !succeeded) {
          failures.push(`${role} should be allowed for ${action} (err=${errCode})`);
        }
        if (!expectViewMod && (succeeded || errCode !== 'permission-denied')) {
          failures.push(`${role} should be denied with permission-denied for ${action} (succeeded=${succeeded}, err=${errCode})`);
        }
      }
    }

    // Non-AcceptedForEditorial must be blocked on createNewsDraft even for Owner
    let blockedBeforeAccept = false;
    try {
      await executeManageCitizenSubmissions(
        {
          auth: { uid: `uid_${FnAdminRole.Owner}` },
          data: { action: 'createNewsDraft', id: seededSub.id },
        },
        fakeAdminRepo,
        communityService,
        newsService
      );
    } catch (err: any) {
      blockedBeforeAccept = err?.code === 'failed-precondition';
    }
    if (!blockedBeforeAccept) {
      failures.push('createNewsDraft must fail-precondition when submission is not AcceptedForEditorial');
    }

    // Persist AcceptedForEditorial via CitizenModerator
    await executeManageCitizenSubmissions(
      {
        auth: { uid: `uid_${FnAdminRole.CitizenModerator}` },
        data: {
          action: 'moderate',
          id: seededSub.id,
          status: 'AcceptedForEditorial',
          moderatorNotes: 'Accepted for editorial newsroom',
        },
      },
      fakeAdminRepo,
      communityService,
      newsService
    );

    for (const role of allNineRoles) {
      const uid = `uid_${role}`;
      const expectHandoff = handoffAllowed.has(role);
      let succeeded = false;
      let errCode = '';
      let leakedEvidence = false;
      try {
        const res = await executeManageCitizenSubmissions(
          {
            auth: { uid },
            data: { action: 'createNewsDraft', id: seededSub.id },
          },
          fakeAdminRepo,
          communityService,
          newsService
        );
        succeeded = true;
        const serialized = JSON.stringify(res.article ?? {});
        leakedEvidence =
          serialized.includes('private-lake.jpg') || serialized.includes('citizen_submissions/');
      } catch (err: any) {
        errCode = String(err?.code || '');
      }
      if (expectHandoff && (!succeeded || leakedEvidence)) {
        failures.push(`${role} handoff failed or leaked evidence (succeeded=${succeeded}, leaked=${leakedEvidence}, err=${errCode})`);
      }
      if (!expectHandoff && (succeeded || errCode !== 'permission-denied')) {
        failures.push(`${role} handoff should be permission-denied (succeeded=${succeeded}, err=${errCode})`);
      }
    }

    results.push({
      id: 'CJ-COORD-01',
      name: '9-role least-privilege RBAC matrix for manageCitizenSubmissions (listAll/getById/moderate/createNewsDraft)',
      passed: failures.length === 0,
      details:
        failures.length === 0
          ? 'All 9 roles verified: ONLY Owner/CitizenModerator can list/view/moderate; ONLY Owner/CitizenModerator/ContentEditor can create News Draft from persisted AcceptedForEditorial without copying private evidence.'
          : failures.join('; '),
    });
  } catch (err: any) {
    results.push({
      id: 'CJ-COORD-01',
      name: '9-role least-privilege RBAC matrix for manageCitizenSubmissions',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  // CJ-COORD-02: executeSubmitCitizenReport maps SUBMISSION_EXISTS -> already-exists
  try {
    const communityRepo = new InMemoryCommunityRepository();
    const communityService = new CommunityApplicationService(communityRepo);
    const verifier = { hasCanonicalAccount: async () => true };

    const reportPayload = {
      id: 'sub-dup-001',
      contributorName: 'مراسل مكرر',
      title: 'تقرير مكرر لاختبار المعرف',
      body: 'وصف تفصيلي للتقرير الميداني المكرر لتجاوز الحد الأدنى.',
      sourceLanguage: 'ar',
      category: 'water',
      locationDescription: 'بورتسودان',
      attachments: [],
    };
    await executeSubmitCitizenReport({ auth: { uid: 'citizen_dup_1' }, data: { submission: reportPayload } }, verifier, communityService);

    let duplicateCode = '';
    try {
      await executeSubmitCitizenReport({ auth: { uid: 'citizen_dup_1' }, data: { submission: reportPayload } }, verifier, communityService);
    } catch (err: any) {
      duplicateCode = String(err?.code || '');
    }

    const passed = duplicateCode === 'already-exists';
    results.push({
      id: 'CJ-COORD-02',
      name: 'executeSubmitCitizenReport maps duplicate SUBMISSION_EXISTS to already-exists',
      passed,
      details: passed
        ? 'Duplicate submission ID cleanly returned HttpsError(already-exists).'
        : `Expected already-exists, got "${duplicateCode}"`,
    });
  } catch (err: any) {
    results.push({
      id: 'CJ-COORD-02',
      name: 'executeSubmitCitizenReport maps duplicate SUBMISSION_EXISTS to already-exists',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  // CJ-COORD-03: Client submitReport rollback safety on definite rejection vs ambiguous server commit
  try {
    const { AccountService, InMemoryAccountRepository } = await import('../src/services/accountService');
    const prevAccountRepo = AccountService.getRepository();
    const coordAccountRepo = new InMemoryAccountRepository();
    AccountService.setRepository(coordAccountRepo);
    for (const uid of ['citizen_rollback_1', 'citizen_rollback_2', 'citizen_rollback_3']) {
      await coordAccountRepo.createAccount({
        id: uid,
        email: `${uid}@pop.org`,
        displayName: `Reporter ${uid}`,
        createdAt: '2026-11-21T10:00:00.000Z',
        updatedAt: '2026-11-21T10:00:00.000Z',
      });
    }

    try {
      const storage1 = new InMemoryCitizenEvidenceStorageAdapter();
      const deletedPathsDefinite: string[] = [];
      const origDel1 = storage1.deleteEvidence.bind(storage1);
      storage1.deleteEvidence = async (path: string) => {
        deletedPathsDefinite.push(path);
        return origDel1(path);
      };
      const rejectingRepo = {
        createSubmission: async () => {
          const err: any = new Error('VALIDATION_ERROR: bad payload');
          err.code = 'VALIDATION_ERROR';
          throw err;
        },
        getSubmissionById: async () => null,
        listSubmissionsByUser: async () => [],
        listAllSubmissions: async () => [],
        updateSubmission: async () => {
          throw new Error('unused');
        },
      };
      const svcDefinite = new CitizenSubmissionServiceClass();
      svcDefinite.setRepository(rejectingRepo as any);
      svcDefinite.setStorageAdapter(storage1);
      svcDefinite.setAuthProvider(() => 'citizen_rollback_1');

      const fakeEvidenceInput = {
        name: 'field.jpg',
        type: 'image/jpeg',
        size: 1024,
        file: new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'field.jpg', { type: 'image/jpeg' }),
      };

      let definiteThrew = false;
      try {
        await svcDefinite.submitReport({
          contributorName: 'Citizen 1',
          title: 'تقرير ميداني موثق للاختبار',
          body: 'وصف ميداني طويل بما يكفي لاجتياز التحقق الأولي في العميل.',
          sourceLanguage: 'ar',
          category: 'water',
          locationDescription: 'الخرطوم',
          evidenceFiles: [fakeEvidenceInput],
        });
      } catch {
        definiteThrew = true;
      }

      // Ambiguous server error AFTER server actually committed -> MUST read back and PRESERVE evidence (0 deletes)
      const storage2 = new InMemoryCitizenEvidenceStorageAdapter();
      const deletedPathsAmbiguousCommit: string[] = [];
      const origDel2 = storage2.deleteEvidence.bind(storage2);
      storage2.deleteEvidence = async (path: string) => {
        deletedPathsAmbiguousCommit.push(path);
        return origDel2(path);
      };
      let committedSubmission: any = null;
      const ambiguousCommitRepo = {
        createSubmission: async (sub: any) => {
          committedSubmission = { ...sub, status: SubmissionStatus.Received };
          const err: any = new Error('AMBIGUOUS_SERVER_ERROR: network timeout after commit');
          err.code = 'AMBIGUOUS_SERVER_ERROR';
          throw err;
        },
        getSubmissionById: async (id: string) => (committedSubmission?.id === id ? committedSubmission : null),
        listSubmissionsByUser: async () => [],
        listAllSubmissions: async () => [],
        updateSubmission: async () => {
          throw new Error('unused');
        },
      };
      const svcAmbiguousCommit = new CitizenSubmissionServiceClass();
      svcAmbiguousCommit.setRepository(ambiguousCommitRepo as any);
      svcAmbiguousCommit.setStorageAdapter(storage2);
      svcAmbiguousCommit.setAuthProvider(() => 'citizen_rollback_2');

      const recovered = await svcAmbiguousCommit.submitReport({
        contributorName: 'Citizen 2',
        title: 'تقرير التزم به الخادم قبل انقطاع الشبكة',
        body: 'وصف ميداني كامل يثبت أن المرفق لا يُحذف عند التزام الخادم.',
        sourceLanguage: 'ar',
        category: 'water',
        locationDescription: 'كسلا',
        evidenceFiles: [fakeEvidenceInput],
      });

      // Ambiguous server error when server did NOT commit -> readback returns null -> MUST roll back evidence
      const storage3 = new InMemoryCitizenEvidenceStorageAdapter();
      const deletedPathsAmbiguousMiss: string[] = [];
      const origDel3 = storage3.deleteEvidence.bind(storage3);
      storage3.deleteEvidence = async (path: string) => {
        deletedPathsAmbiguousMiss.push(path);
        return origDel3(path);
      };
      const ambiguousMissRepo = {
        createSubmission: async () => {
          const err: any = new Error('AMBIGUOUS_SERVER_ERROR: connection dropped before write');
          err.code = 'AMBIGUOUS_SERVER_ERROR';
          throw err;
        },
        getSubmissionById: async () => null,
        listSubmissionsByUser: async () => [],
        listAllSubmissions: async () => [],
        updateSubmission: async () => {
          throw new Error('unused');
        },
      };
      const svcAmbiguousMiss = new CitizenSubmissionServiceClass();
      svcAmbiguousMiss.setRepository(ambiguousMissRepo as any);
      svcAmbiguousMiss.setStorageAdapter(storage3);
      svcAmbiguousMiss.setAuthProvider(() => 'citizen_rollback_3');

      let ambiguousMissThrew = false;
      try {
        await svcAmbiguousMiss.submitReport({
          contributorName: 'Citizen 3',
          title: 'تقرير لم يصل إلى الخادم',
          body: 'وصف ميداني طويل بما يكفي لاختبار التنظيف الآمن بعد القراءة المرجعية.',
          sourceLanguage: 'ar',
          category: 'climate',
          locationDescription: 'عطبرة',
          evidenceFiles: [fakeEvidenceInput],
        });
      } catch {
        ambiguousMissThrew = true;
      }

      const passed =
        definiteThrew &&
        deletedPathsDefinite.length === 1 &&
        recovered?.id === committedSubmission?.id &&
        deletedPathsAmbiguousCommit.length === 0 &&
        ambiguousMissThrew &&
        deletedPathsAmbiguousMiss.length === 1;

      results.push({
        id: 'CJ-COORD-03',
        name: 'Client submitReport rollback safety preserves evidence on ambiguous server commit and deletes on confirmed non-commit/rejection',
        passed,
        details: passed
          ? 'Definite rejection rolled back 1 attachment; ambiguous server commit recovered via authoritative getSubmissionById with 0 deletes; ambiguous non-commit rolled back 1 attachment.'
          : `definiteThrew=${definiteThrew}, delDef=${deletedPathsDefinite.length}, recovered=${Boolean(recovered)}, delCommit=${deletedPathsAmbiguousCommit.length}, missThrew=${ambiguousMissThrew}, delMiss=${deletedPathsAmbiguousMiss.length}`,
      });
    } finally {
      AccountService.setRepository(prevAccountRepo);
    }
  } catch (err: any) {
    results.push({
      id: 'CJ-COORD-03',
      name: 'Client submitReport rollback safety',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  // CJ-COORD-04: Static rules & single-path contract audit + CitizenSubmissionReviewModal persisted-status gate
  try {
    const clientSrc = fs.readFileSync('src/services/citizenSubmissionService.ts', 'utf8');
    const firestoreRules = fs.readFileSync('firestore.rules', 'utf8');
    const storageRules = fs.readFileSync('storage.rules', 'utf8');

    const noSetDocFallback =
      !/\bsetDoc\s*\(/.test(clientSrc) &&
      clientSrc.includes("'submitCitizenReport'");
    const firestoreTightened =
      firestoreRules.includes('function isAuthorizedCommunityAdmin()') &&
      !firestoreRules.includes('isAuthorizedCommunityReviewer') &&
      firestoreRules.includes('allow create: if false;') &&
      firestoreRules.includes('isCanonicalCitizenSubmissionShape()');
    const storageTightened =
      storageRules.includes('match /citizen_submissions/{userId}/{submissionId}/{fileName}') &&
      storageRules.includes("data.role == 'Owner'") &&
      storageRules.includes("data.role == 'CitizenModerator'") &&
      !storageRules.includes("data.role == 'ContentEditor'");

    // Modal rendered on Received submission MUST NOT enable Create News Draft
    const submittedModalHtml = renderToStaticMarkup(
      React.createElement(CitizenSubmissionReviewModal, {
        isOpen: true,
        submission: {
          id: 'sub-modal-1',
          submittedByUid: 'citizen_1',
          contributorName: 'Citizen 1',
          title: 'بلاغ اختباري',
          body: 'وصف تفصيلي',
          sourceLanguage: 'ar',
          category: 'water',
          locationDescription: 'الخرطوم',
          status: SubmissionStatus.Received,
          attachments: [],
          submittedAt: '2026-11-21T10:00:00.000Z',
        } as any,
        currentUser: {
          id: 'uid_owner',
          name: 'Owner',
          email: 'owner@pop.org',
          role: AdminRole.Owner,
          isActive: true,
        },
        isAr: true,
        onClose: () => {},
        onUpdate: () => {},
      })
    );
    const acceptedModalHtml = renderToStaticMarkup(
      React.createElement(CitizenSubmissionReviewModal, {
        isOpen: true,
        submission: {
          id: 'sub-modal-2',
          submittedByUid: 'citizen_1',
          contributorName: 'Citizen 1',
          title: 'بلاغ مقبول تحريرياً',
          body: 'وصف تفصيلي',
          sourceLanguage: 'ar',
          category: 'water',
          locationDescription: 'الخرطوم',
          status: SubmissionStatus.AcceptedForEditorial,
          attachments: [],
          submittedAt: '2026-11-21T10:00:00.000Z',
        } as any,
        currentUser: {
          id: 'uid_owner',
          name: 'Owner',
          email: 'owner@pop.org',
          role: AdminRole.Owner,
          isActive: true,
        },
        isAr: true,
        onClose: () => {},
        onUpdate: () => {},
      })
    );

    const modalGatesPersistedAccept =
      !submittedModalHtml.includes('المعالجة التحريرية لمسودة الخبر') &&
      acceptedModalHtml.includes('المعالجة التحريرية لمسودة الخبر') &&
      acceptedModalHtml.includes('إنشاء مسودة خبر') &&
      !acceptedModalHtml.includes('يرجى النقر على &quot;حفظ التحديثات&quot;');

    const passed =
      noSetDocFallback &&
      firestoreTightened &&
      storageTightened &&
      modalGatesPersistedAccept;

    results.push({
      id: 'CJ-COORD-04',
      name: 'Single submitCitizenReport path, Firestore/Storage Owner+CitizenModerator rules, and ReviewModal persisted-AcceptedForEditorial gate',
      passed,
      details: passed
        ? 'No setDoc fallback in client; firestore.rules restricts citizen_submissions to isAuthorizedCommunityAdmin() + allow create: if false; storage.rules restricts reads to owner + Owner/CitizenModerator; modal gates draft handoff on persisted AcceptedForEditorial.'
        : `noSetDocFallback=${noSetDocFallback}, firestoreTightened=${firestoreTightened}, storageTightened=${storageTightened}, modalGatesPersistedAccept=${modalGatesPersistedAccept}`,
    });
  } catch (err: any) {
    results.push({
      id: 'CJ-COORD-04',
      name: 'Static rules & ReviewModal gate audit',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  return results;
}

async function main() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — CITIZEN JOURNALISM & NAVIGATION VERIFICATION');
  console.log('=================================================================\n');

  try {
    await registerBunFirebaseMocks();
    const { PublicNewsClient } = await import('../src/services/publicNewsClient');
    PublicNewsClient.setTransport(async () => ({ articles: [] }));
    const { runCitizenJournalismFunctionalTests } = await import('../src/services/citizenJournalismFunctionalTests');
    const baseResults = await runCitizenJournalismFunctionalTests();
    const coordResults = await runCoordinatedCitizenVerification();
    const results = [...baseResults, ...coordResults];
    let allPassed = true;

    for (const res of results) {
      const icon = res.passed ? '✓' : '✗';
      console.log(`[${icon}] ${res.id}: ${res.name}`);
      console.log(`    ${res.details}\n`);
      if (!res.passed) {
        allPassed = false;
      }
    }

    console.log('=================================================================');
    if (allPassed) {
      console.log(` SUMMARY: ALL ${results.length} CITIZEN JOURNALISM & NAVIGATION TESTS PASSED.`);
      console.log('=================================================================');
      process.exit(0);
    } else {
      console.error(' SUMMARY: SOME CITIZEN JOURNALISM TESTS FAILED.');
      console.log('=================================================================');
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error running Citizen Journalism tests:', err);
    process.exit(1);
  }
}

main();

