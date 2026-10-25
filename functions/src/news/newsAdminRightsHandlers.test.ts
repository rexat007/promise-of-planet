import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    public readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
      this.code = code;
    }
  },
}));

import { InMemoryAdminRepository } from '../admin/inMemoryAdminRepository';
import { AdminRole, type AdminUser } from '../types/admin';
import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
} from '../shared/editorialImageAssetContract';
import type {
  EditorialImageAssetMetadata,
  EditorialImageAssetVariant,
} from '../types/editorialImageAsset';
import {
  EditorialImageAssetRepositoryError,
  type EditorialImageAssetReadResult,
  type EditorialImageAssetRepository,
  type EditorialImageAssetRepositoryRecord,
} from './editorialImageAssetRepository';
import { InMemoryEditorialImageAssetRepository } from './inMemoryEditorialImageAssetRepository';
import {
  EditorialImageRightsReviewError,
  EditorialImageRightsReviewService,
  InMemoryEditorialImageRightsReviewRunner,
  type EditorialImageRightsDecisionInput,
} from './editorialImageRightsReviewService';
import { InMemoryNewsRepository } from './inMemoryNewsRepository';
import {
  NewsApplicationService,
  REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS,
} from './newsApplicationService';
import {
  GET_EDITORIAL_IMAGE_RIGHTS_CONCURRENCY,
  MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS,
  createProductionEditorialImageRightsReviewService,
  executeManageNewsRequest,
} from './newsAdminHandlers';

const VALID_SHA256 = 'a'.repeat(64);

function buildCanonicalVariantsMap(
  assetId: string
): Record<string, EditorialImageAssetVariant> {
  const variants: Record<string, EditorialImageAssetVariant> = {};
  for (const key of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
    variants[key] = {
      variantKey: key,
      storagePath: buildEditorialImageVariantStoragePath(
        assetId,
        key,
        'image/webp'
      ),
      mimeType: 'image/webp',
      width: 1200,
      height: 800,
      sizeBytes: 32768,
      sha256Checksum: VALID_SHA256,
    };
  }
  return variants;
}

function buildPendingAsset(
  assetId: string,
  overrides: {
    readonly createdByUid?: string;
    readonly createdAtIso?: string;
    readonly updatedAtIso?: string;
    readonly altAr?: string;
    readonly altEn?: string;
    readonly captionAr?: string;
    readonly captionEn?: string;
  } = {}
): EditorialImageAssetMetadata {
  const createdAtIso = overrides.createdAtIso ?? '2026-10-20T08:00:00.000Z';
  const updatedAtIso = overrides.updatedAtIso ?? createdAtIso;

  return createEditorialImageAssetRecord({
    assetId,
    createdByUid: overrides.createdByUid ?? 'editor_creator_01',
    createdAtIso,
    updatedAtIso,
    origin: 'news_article',
    originalFilename: `${assetId}.webp`,
    mimeType: 'image/webp',
    originalSizeBytes: 65536,
    originalWidth: 1200,
    originalHeight: 800,
    sha256Checksum: VALID_SHA256,
    variants: buildCanonicalVariantsMap(assetId),
    altAr: overrides.altAr ?? 'صورة توثيقية لمشروع الطاقة المتجددة',
    altEn: overrides.altEn ?? 'Documentary photo of renewable energy project',
    ...(overrides.captionAr !== undefined
      ? { captionAr: overrides.captionAr }
      : { captionAr: 'وصف الصورة بالعربية' }),
    ...(overrides.captionEn !== undefined
      ? { captionEn: overrides.captionEn }
      : { captionEn: 'English image caption' }),
  });
}

function buildApprovalDecision(
  assetId: string,
  expectedRevision: number,
  evidenceRefs: string[],
  overrides: Partial<EditorialImageRightsDecisionInput> = {}
): EditorialImageRightsDecisionInput {
  return {
    assetId,
    expectedRevision,
    targetStatus: 'Approved',
    reviewReason:
      overrides.reviewReason ??
      'Verified signed photographer agreement and editorial attribution.',
    licenseType: overrides.licenseType ?? 'DirectLicense',
    licenseDetails:
      overrides.licenseDetails ??
      'Signed editorial press license agreement #DL-2026-104',
    rightsHolder: overrides.rightsHolder ?? 'Promise Environmental Press',
    sourceAttributionAr:
      overrides.sourceAttributionAr ?? 'تصوير: وكالة وعد البيئية',
    sourceAttributionEn:
      overrides.sourceAttributionEn ?? 'Photo: Promise Environmental Press',
    evidenceRefs,
    usageScope: overrides.usageScope ?? {
      scopeType: 'GeneralEditorial',
    },
    ...(overrides.documentedException !== undefined
      ? { documentedException: overrides.documentedException }
      : {}),
    ...(overrides.reviewRequestId !== undefined
      ? { reviewRequestId: overrides.reviewRequestId }
      : {}),
  };
}

async function expectHttpsError(
  promise: Promise<unknown>,
  expectedCode: string,
  expectedMessagePattern?: RegExp
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  const httpsErr = caught as { name?: string; code?: string; message?: string };
  expect(httpsErr.name).toBe('HttpsError');
  expect(httpsErr.code).toBe(expectedCode);
  if (expectedMessagePattern) {
    expect(httpsErr.message).toMatch(expectedMessagePattern);
  }
}

describe('Editorial Image Rights — Secure Firebase Callable Bridge (D3-B2-B1)', () => {
  const ownerAdmin: AdminUser = {
    id: 'owner_human_01',
    name: 'المالك الرئيسي',
    email: 'owner@promiseofplanet.org',
    role: AdminRole.Owner,
    isActive: true,
  };

  const primaryAdmin: AdminUser = {
    id: 'rights_reviewer_01',
    name: 'مدير مراجعة الحقوق',
    email: 'rights1@promiseofplanet.org',
    role: AdminRole.RightsReviewer,
    isActive: true,
  };

  const secondaryAdmin: AdminUser = {
    id: 'rights_reviewer_02',
    name: 'مدير مراجعة ثان',
    email: 'rights2@promiseofplanet.org',
    role: AdminRole.RightsReviewer,
    isActive: true,
  };

  const editorAdmin: AdminUser = {
    id: 'editor_creator_01',
    name: 'محرر محتوى',
    email: 'editor@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  };

  const reviewerAdmin: AdminUser = {
    id: 'curator_human_01',
    name: 'أمين مكتبة ومراجع',
    email: 'curator@promiseofplanet.org',
    role: AdminRole.LibraryCurator,
    isActive: true,
  };

  const viewerAdmin: AdminUser = {
    id: 'viewer_human_01',
    name: 'مشاهد إداري',
    email: 'viewer@promiseofplanet.org',
    role: AdminRole.Viewer,
    isActive: true,
  };

  const aiAssistantPrincipal: AdminUser = {
    id: 'ai_assistant_01',
    name: 'AI Assistant Bot',
    email: 'ai@promiseofplanet.org',
    role: AdminRole.AIAssistant,
    isActive: true,
  };

  const inactiveAdmin: AdminUser = {
    id: 'inactive_admin_01',
    name: 'مدير غير نشط',
    email: 'inactive@promiseofplanet.org',
    role: AdminRole.RightsReviewer,
    isActive: false,
  };

  let adminRepo: InMemoryAdminRepository;
  let assetRepo: InMemoryEditorialImageAssetRepository;
  let rightsRunner: InMemoryEditorialImageRightsReviewRunner;
  let rightsService: EditorialImageRightsReviewService;
  let newsRepo: InMemoryNewsRepository;
  let newsService: NewsApplicationService;
  let currentClockMs: number;

  const advanceClock = (ms = 5_000): string => {
    currentClockMs += ms;
    return new Date(currentClockMs).toISOString();
  };

  beforeEach(async () => {
    currentClockMs = Date.parse('2026-10-21T10:00:00.000Z');
    adminRepo = new InMemoryAdminRepository();
    for (const user of [
      ownerAdmin,
      primaryAdmin,
      secondaryAdmin,
      editorAdmin,
      reviewerAdmin,
      viewerAdmin,
      aiAssistantPrincipal,
      inactiveAdmin,
    ]) {
      await adminRepo.saveAdmin(user);
    }
    assetRepo = new InMemoryEditorialImageAssetRepository();
    rightsRunner = new InMemoryEditorialImageRightsReviewRunner(
      undefined,
      adminRepo
    );
    rightsService = new EditorialImageRightsReviewService({
      adminRepository: adminRepo,
      transactionRunner: rightsRunner,
      clock: () => advanceClock(1_000),
    });
    newsRepo = new InMemoryNewsRepository();
    newsService = new NewsApplicationService(newsRepo, assetRepo);
  });

  async function seedAssetInBothRepositories(
    asset: EditorialImageAssetMetadata
  ): Promise<EditorialImageAssetRepositoryRecord> {
    await assetRepo.createIfAbsent(asset);
    return rightsRunner.seedInitialPendingAsset(asset);
  }

  describe('1–5. Authentication, Registration, Active State, AI Rejection, and RBAC Gates', () => {
    const allFiveActionPayloads = [
      {
        action: 'getEditorialImageRights',
        assetIds: ['asset_auth_test_01'],
      },
      {
        action: 'registerImageRightsEvidence',
        input: {
          assetId: 'asset_auth_test_01',
          sourceKind: 'PhotographerWrittenRelease',
          sourceReference: 'REL-2026-001',
          summary: 'Signed model and photographer release document.',
        },
      },
      {
        action: 'revokeImageRightsEvidence',
        input: {
          evidenceId: 'ev_auth_test_01',
          revocationReason: 'Superseded by updated contract.',
        },
      },
      {
        action: 'submitImageRightsReviewRequest',
        input: {
          assetId: 'asset_auth_test_01',
          expectedRevision: 2,
          rationale: 'New signed release uploaded for re-evaluation.',
          submittedEvidenceRefs: ['ev_auth_test_02'],
        },
      },
      {
        action: 'transitionImageRights',
        decision: buildApprovalDecision('asset_auth_test_01', 1, [
          'ev_auth_test_01',
        ]),
      },
    ];

    it('1. rejects unauthenticated callers across all 5 editorial image rights actions', async () => {
      for (const data of allFiveActionPayloads) {
        await expectHttpsError(
          executeManageNewsRequest(
            { data },
            adminRepo,
            newsService,
            rightsService,
            assetRepo
          ),
          'unauthenticated',
          /UNAUTHENTICATED/
        );

        await expectHttpsError(
          executeManageNewsRequest(
            { auth: { uid: '   ' }, data },
            adminRepo,
            newsService,
            rightsService,
            assetRepo
          ),
          'unauthenticated',
          /UNAUTHENTICATED/
        );
      }
    });

    it('2. rejects unregistered callers across all 5 editorial image rights actions', async () => {
      for (const data of allFiveActionPayloads) {
        await expectHttpsError(
          executeManageNewsRequest(
            { auth: { uid: 'unregistered_user_999' }, data },
            adminRepo,
            newsService,
            rightsService,
            assetRepo
          ),
          'permission-denied',
          /ADMIN_NOT_REGISTERED/
        );
      }
    });

    it('3. rejects inactive admins across all 5 editorial image rights actions', async () => {
      for (const data of allFiveActionPayloads) {
        await expectHttpsError(
          executeManageNewsRequest(
            { auth: { uid: inactiveAdmin.id }, data },
            adminRepo,
            newsService,
            rightsService,
            assetRepo
          ),
          'permission-denied',
          /ADMIN_INACTIVE/
        );
      }
    });

    it('4. rejects AdminRole.AIAssistant and AI token claims across all 5 editorial image rights actions', async () => {
      for (const data of allFiveActionPayloads) {
        await expectHttpsError(
          executeManageNewsRequest(
            { auth: { uid: aiAssistantPrincipal.id }, data },
            adminRepo,
            newsService,
            rightsService,
            assetRepo
          ),
          'permission-denied',
          /AI_APPROVAL_FORBIDDEN/
        );

        await expectHttpsError(
          executeManageNewsRequest(
            {
              auth: {
                uid: primaryAdmin.id,
                token: { role: AdminRole.AIAssistant },
              },
              data,
            },
            adminRepo,
            newsService,
            rightsService,
            assetRepo
          ),
          'permission-denied',
          /AI_APPROVAL_FORBIDDEN/
        );
      }
    });

    it('5. rejects ContentEditor, LibraryCurator, TrainingManager, Trainer, CitizenModerator, and Viewer across all 4 rights mutation actions', async () => {
      const mutationPayloads = allFiveActionPayloads.slice(1);
      const nonRightsHumanUsers = [editorAdmin, reviewerAdmin, viewerAdmin];

      for (const caller of nonRightsHumanUsers) {
        for (const data of mutationPayloads) {
          await expectHttpsError(
            executeManageNewsRequest(
              { auth: { uid: caller.id }, data },
              adminRepo,
              newsService,
              rightsService,
              assetRepo
            ),
            'permission-denied',
            /PERMISSION_DENIED.*manageRights/
          );
        }
      }
    });

    it('6. allows active human editors/reviewers/viewers with AdminPermission.View to call getEditorialImageRights', async () => {
      const assetId = 'asset_view_allowed_01';
      await seedAssetInBothRepositories(buildPendingAsset(assetId));

      for (const caller of [
        editorAdmin,
        reviewerAdmin,
        viewerAdmin,
        primaryAdmin,
        ownerAdmin,
      ]) {
        const res = await executeManageNewsRequest(
          {
            auth: { uid: caller.id },
            data: {
              action: 'getEditorialImageRights',
              assetIds: [assetId],
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        );

        expect(res.items).toHaveLength(1);
        expect(res.items[0].assetId).toBe(assetId);
        expect(res.items[0].found).toBe(true);
        expect(res.items[0].revision).toBe(1);
        expect(res.items[0].rights.status).toBe('PendingReview');
      }
    });
  });

  describe('7–8. getEditorialImageRights Validation, Bounded Concurrency, and Strict Sanitization', () => {
    it('7. rejects empty, non-array, duplicate, malformed, or > 20 assetIds', async () => {
      // Non-array
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: editorAdmin.id },
            data: {
              action: 'getEditorialImageRights',
              assetIds: 'asset_01',
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'invalid-argument',
        /assetIds must be an array/
      );

      // Empty array
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: editorAdmin.id },
            data: {
              action: 'getEditorialImageRights',
              assetIds: [],
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'invalid-argument',
        /between 1 and 20/
      );

      // > 20 assetIds
      const twentyOneIds = Array.from(
        { length: MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS + 1 },
        (_, idx) => `asset_batch_${idx + 1}`
      );
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: editorAdmin.id },
            data: {
              action: 'getEditorialImageRights',
              assetIds: twentyOneIds,
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'invalid-argument',
        /between 1 and 20/
      );

      // Duplicate assetIds
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: editorAdmin.id },
            data: {
              action: 'getEditorialImageRights',
              assetIds: ['asset_dup_01', 'asset_dup_01'],
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'invalid-argument',
        /duplicate asset ID/
      );

      // Malformed assetId (path traversal / invalid chars)
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: editorAdmin.id },
            data: {
              action: 'getEditorialImageRights',
              assetIds: ['../editorial_images/private/secret'],
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'invalid-argument',
        /not a valid canonical asset ID/
      );
    });

    it('8. returns sanitized rights metadata, represents missing assets safely, and never exposes variants or storagePath', async () => {
      const existingId = 'asset_inspect_existing_01';
      const missingId = 'asset_inspect_missing_02';
      await seedAssetInBothRepositories(
        buildPendingAsset(existingId, {
          createdByUid: primaryAdmin.id,
          altAr: 'صورة الشعاب المرجانية',
          altEn: 'Coral reef photo',
          captionAr: 'توثيق الشعاب المرجانية في البحر الأحمر',
          captionEn: 'Red Sea coral reef documentation',
        })
      );

      const response = await executeManageNewsRequest(
        {
          auth: { uid: editorAdmin.id },
          data: {
            action: 'getEditorialImageRights',
            assetIds: [existingId, missingId],
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      expect(response.items).toHaveLength(2);
      const foundDto = response.items[0];
      const missingDto = response.items[1];

      expect(foundDto).toMatchObject({
        assetId: existingId,
        found: true,
        revision: 1,
        status: 'active',
        createdByUid: primaryAdmin.id,
        rights: {
          status: 'PendingReview',
        },
        altAr: 'صورة الشعاب المرجانية',
        altEn: 'Coral reef photo',
        captionAr: 'توثيق الشعاب المرجانية في البحر الأحمر',
        captionEn: 'Red Sea coral reef documentation',
        originalFilename: `${existingId}.webp`,
        mimeType: 'image/webp',
        originalWidth: 1200,
        originalHeight: 800,
        aspectRatio: 1.5,
      });

      expect(missingDto).toEqual({
        assetId: missingId,
        found: false,
        revision: null,
        status: 'NOT_FOUND',
        createdByUid: null,
        rights: null,
        altAr: null,
        originalFilename: null,
        mimeType: null,
        originalWidth: null,
        originalHeight: null,
        aspectRatio: null,
        asset: null,
      });

      expect(response.assetsById[existingId]).toEqual(foundDto);
      expect(response.assetsById[missingId]).toEqual(missingDto);

      // Verify zero leakage of variants, storagePath, private storage prefixes, or binary checksums
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain('variants');
      expect(serialized).not.toContain('storagePath');
      expect(serialized).not.toContain('editorial_images/private');
      expect(serialized).not.toContain('sha256Checksum');
      expect(serialized).not.toContain('originalSizeBytes');
    });

    it('enforces bounded read concurrency when inspecting up to 20 assetIds', async () => {
      const batchIds = Array.from(
        { length: MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS },
        (_, idx) => `asset_conc_${String(idx + 1).padStart(2, '0')}`
      );

      let inFlight = 0;
      let maxObservedInFlight = 0;

      const trackingAssetRepo: EditorialImageAssetRepository = {
        async getById(id: string): Promise<EditorialImageAssetReadResult> {
          inFlight += 1;
          if (inFlight > maxObservedInFlight) {
            maxObservedInFlight = inFlight;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
          try {
            return await assetRepo.getById(id);
          } finally {
            inFlight -= 1;
          }
        },
        createIfAbsent: (a) => assetRepo.createIfAbsent(a),
        updateEditorialMetadata: (id, rev, patch) =>
          assetRepo.updateEditorialMetadata(id, rev, patch),
      };

      const res = await executeManageNewsRequest(
        {
          auth: { uid: editorAdmin.id },
          data: {
            action: 'getEditorialImageRights',
            assetIds: batchIds,
          },
        },
        adminRepo,
        newsService,
        rightsService,
        trackingAssetRepo
      );

      expect(res.items.map((item: { assetId: string }) => item.assetId)).toEqual(
        batchIds
      );
      expect(maxObservedInFlight).toBeLessThanOrEqual(
        GET_EDITORIAL_IMAGE_RIGHTS_CONCURRENCY
      );
      expect(maxObservedInFlight).toBeGreaterThan(1);
    });
  });

  describe('9–16. Rights Evidence Registration/Revocation, Review Requests, Transitions, Self-Approval, and Concurrency', () => {
    it('9. allows AdminRole.Admin to register evidence and approve a PendingReview asset created by another user', async () => {
      const assetId = 'asset_admin_approve_01';
      await seedAssetInBothRepositories(
        buildPendingAsset(assetId, { createdByUid: editorAdmin.id })
      );

      const evResult = await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'registerImageRightsEvidence',
            input: {
              evidenceId: 'ev_admin_approve_001',
              assetId,
              sourceKind: 'SignedLicenseAgreement',
              sourceReference: 'CONTRACT-2026-501',
              summary: 'Signed bilateral editorial photography license.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      expect(evResult.evidence).toMatchObject({
        evidenceId: 'ev_admin_approve_001',
        assetId,
        status: 'Active',
        recordedByUid: primaryAdmin.id,
      });

      const transitionResult = await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'transitionImageRights',
            decision: buildApprovalDecision(assetId, 1, [
              'ev_admin_approve_001',
            ]),
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      expect(transitionResult.record.assetId).toBe(assetId);
      expect(transitionResult.record.revision).toBe(2);
      expect(transitionResult.record.asset.rights.status).toBe('Approved');
      expect(transitionResult.record.asset.rights.reviewedByUid).toBe(
        primaryAdmin.id
      );
      expect(transitionResult.auditEvent.newRightsStatus).toBe('Approved');
      expect(transitionResult.auditEvent.selfApprovedByOwner).toBe(false);

      const serialized = JSON.stringify(transitionResult);
      expect(serialized).not.toContain('variants');
      expect(serialized).not.toContain('storagePath');
      expect(serialized).not.toContain('editorial_images/private');
    });

    it('10. blocks AdminRole.Admin from self-approving an asset they uploaded themselves', async () => {
      const assetId = 'asset_admin_self_approve_blocked_01';
      await seedAssetInBothRepositories(
        buildPendingAsset(assetId, { createdByUid: primaryAdmin.id })
      );

      await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'registerImageRightsEvidence',
            input: {
              evidenceId: 'ev_self_approve_001',
              assetId,
              sourceKind: 'PhotographerWrittenRelease',
              sourceReference: 'ATTEST-2026-11',
              summary: 'Photographer attestation form.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: primaryAdmin.id },
            data: {
              action: 'transitionImageRights',
              decision: buildApprovalDecision(assetId, 1, [
                'ev_self_approve_001',
              ]),
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'permission-denied',
        /SELF_APPROVAL_FORBIDDEN/
      );
    });

    it('11. allows AdminRole.Owner to self-approve their own uploaded asset with selfApprovedByOwner: true', async () => {
      const assetId = 'asset_owner_self_approve_01';
      await seedAssetInBothRepositories(
        buildPendingAsset(assetId, { createdByUid: ownerAdmin.id })
      );

      await executeManageNewsRequest(
        {
          auth: { uid: ownerAdmin.id },
          data: {
            action: 'registerImageRightsEvidence',
            input: {
              evidenceId: 'ev_owner_self_001',
              assetId,
              sourceKind: 'SignedLicenseAgreement',
              sourceReference: 'STUDIO-2026-77',
              summary: 'In-house editorial photography record.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      const res = await executeManageNewsRequest(
        {
          auth: { uid: ownerAdmin.id },
          data: {
            action: 'transitionImageRights',
            decision: buildApprovalDecision(assetId, 1, ['ev_owner_self_001']),
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      expect(res.record.revision).toBe(2);
      expect(res.record.asset.rights.status).toBe('Approved');
      expect(res.auditEvent.selfApprovedByOwner).toBe(true);
      expect(res.auditEvent.actorUserId).toBe(ownerAdmin.id);
    });

    it('12. fails closed when attempting to approve without registered active evidence', async () => {
      const assetId = 'asset_no_evidence_01';
      await seedAssetInBothRepositories(
        buildPendingAsset(assetId, { createdByUid: editorAdmin.id })
      );

      // Empty evidenceRefs -> INVALID_INPUT -> invalid-argument
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: primaryAdmin.id },
            data: {
              action: 'transitionImageRights',
              decision: buildApprovalDecision(assetId, 1, []),
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'invalid-argument',
        /INVALID_INPUT/
      );

      // Unregistered evidence reference -> INVALID_EVIDENCE -> failed-precondition
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: primaryAdmin.id },
            data: {
              action: 'transitionImageRights',
              decision: buildApprovalDecision(assetId, 1, [
                'ev_unregistered_999',
              ]),
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'failed-precondition',
        /INVALID_EVIDENCE/
      );
    });

    it('13. revoking evidence blocks subsequent approval referencing that evidence', async () => {
      const assetId = 'asset_revoked_evidence_01';
      await seedAssetInBothRepositories(
        buildPendingAsset(assetId, { createdByUid: editorAdmin.id })
      );

      await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'registerImageRightsEvidence',
            input: {
              evidenceId: 'ev_to_revoke_001',
              assetId,
              sourceKind: 'SignedLicenseAgreement',
              sourceReference: 'CONTRACT-REV-01',
              summary: 'Initial license contract later found incomplete.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      const revokeRes = await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'revokeImageRightsEvidence',
            input: {
              evidenceId: 'ev_to_revoke_001',
              assetId,
              revocationReason:
                'Missing counter-signature on attachment page 2.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      expect(revokeRes.evidence.status).toBe('Revoked');
      expect(revokeRes.evidence.revokedByUid).toBe(primaryAdmin.id);

      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: primaryAdmin.id },
            data: {
              action: 'transitionImageRights',
              decision: buildApprovalDecision(assetId, 1, ['ev_to_revoke_001']),
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'failed-precondition',
        /INVALID_EVIDENCE/
      );
    });

    it('14 & 15. enforces documented review request + fresh post-decision evidence for Rejected -> Approved and Revoked -> Approved, and blocks replay of consumed review request', async () => {
      const assetId = 'asset_reapproval_flow_01';
      await seedAssetInBothRepositories(
        buildPendingAsset(assetId, { createdByUid: editorAdmin.id })
      );

      // Step 1: Reject PendingReview asset (revision 1 -> 2)
      const rejectRes = await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'transitionImageRights',
            decision: {
              assetId,
              expectedRevision: 1,
              targetStatus: 'Rejected',
              reviewReason:
                'Initial upload lacked signed photographer release.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );
      expect(rejectRes.record.revision).toBe(2);
      expect(rejectRes.record.asset.rights.status).toBe('Rejected');

      // Register fresh evidence strictly after rejection
      await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'registerImageRightsEvidence',
            input: {
              evidenceId: 'ev_post_reject_001',
              assetId,
              sourceKind: 'PhotographerWrittenRelease',
              sourceReference: 'REL-POST-REJECT-01',
              summary: 'Signed release received after initial rejection.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      // Attempt Rejected -> Approved without reviewRequestId fails with REVIEW_REQUEST_REQUIRED (failed-precondition)
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: primaryAdmin.id },
            data: {
              action: 'transitionImageRights',
              decision: buildApprovalDecision(assetId, 2, [
                'ev_post_reject_001',
              ]),
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'failed-precondition',
        /REVIEW_REQUEST_REQUIRED/
      );

      // Submit persisted review request
      const reqRes = await executeManageNewsRequest(
        {
          auth: { uid: secondaryAdmin.id },
          data: {
            action: 'submitImageRightsReviewRequest',
            input: {
              requestId: 'img_req_reapprove_001',
              assetId,
              expectedRevision: 2,
              rationale:
                'Photographer supplied signed release document REL-POST-REJECT-01.',
              submittedEvidenceRefs: ['ev_post_reject_001'],
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      expect(reqRes.reviewRequest).toMatchObject({
        requestId: 'img_req_reapprove_001',
        assetId,
        assetRevision: 2,
        priorRightsStatus: 'Rejected',
        status: 'Pending',
      });

      // Rejected -> Approved with valid reviewRequestId succeeds (revision 2 -> 3) and consumes request
      const approveFromRejectRes = await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'transitionImageRights',
            decision: buildApprovalDecision(
              assetId,
              2,
              ['ev_post_reject_001'],
              {
                reviewRequestId: 'img_req_reapprove_001',
              }
            ),
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      expect(approveFromRejectRes.record.revision).toBe(3);
      expect(approveFromRejectRes.record.asset.rights.status).toBe('Approved');
      expect(approveFromRejectRes.consumedReviewRequest).toMatchObject({
        requestId: 'img_req_reapprove_001',
        status: 'Consumed',
        consumedByUid: primaryAdmin.id,
        consumedAtAssetRevision: 3,
      });

      // Step 2: Transition Approved -> Revoked (revision 3 -> 4)
      const revokeRightsRes = await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'transitionImageRights',
            decision: {
              assetId,
              expectedRevision: 3,
              targetStatus: 'Revoked',
              reviewReason:
                'Temporary revocation pending agency territorial scope addendum.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );
      expect(revokeRightsRes.record.revision).toBe(4);
      expect(revokeRightsRes.record.asset.rights.status).toBe('Revoked');

      // Register second fresh post-revocation evidence
      await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'registerImageRightsEvidence',
            input: {
              evidenceId: 'ev_post_revoke_002',
              assetId,
              sourceKind: 'AgencyContractRecord',
              sourceReference: 'AGENCY-ADDENDUM-2026-09',
              summary: 'Signed agency territorial clearance addendum.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      // Attempt Revoked -> Approved without reviewRequestId fails with REVIEW_REQUEST_REQUIRED
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: primaryAdmin.id },
            data: {
              action: 'transitionImageRights',
              decision: buildApprovalDecision(assetId, 4, [
                'ev_post_reject_001',
                'ev_post_revoke_002',
              ]),
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'failed-precondition',
        /REVIEW_REQUEST_REQUIRED/
      );

      // 15. Reusing already consumed reviewRequestId ('img_req_reapprove_001') fails closed with REVIEW_REQUEST_CONSUMED -> aborted
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: primaryAdmin.id },
            data: {
              action: 'transitionImageRights',
              decision: buildApprovalDecision(
                assetId,
                4,
                ['ev_post_reject_001', 'ev_post_revoke_002'],
                {
                  reviewRequestId: 'img_req_reapprove_001',
                }
              ),
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'aborted',
        /REVIEW_REQUEST_CONSUMED/
      );

      // Submit new review request for Revoked -> Approved
      await executeManageNewsRequest(
        {
          auth: { uid: secondaryAdmin.id },
          data: {
            action: 'submitImageRightsReviewRequest',
            input: {
              requestId: 'img_req_reapprove_002',
              assetId,
              expectedRevision: 4,
              rationale:
                'Agency territorial scope addendum AGENCY-ADDENDUM-2026-09 registered.',
              submittedEvidenceRefs: ['ev_post_revoke_002'],
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      const approveFromRevokeRes = await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'transitionImageRights',
            decision: buildApprovalDecision(
              assetId,
              4,
              ['ev_post_reject_001', 'ev_post_revoke_002'],
              {
                reviewRequestId: 'img_req_reapprove_002',
              }
            ),
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      expect(approveFromRevokeRes.record.revision).toBe(5);
      expect(approveFromRevokeRes.record.asset.rights.status).toBe('Approved');
      expect(approveFromRevokeRes.consumedReviewRequest?.status).toBe(
        'Consumed'
      );
    });

    it('16. fails closed with aborted (CONFLICT) on stale expectedRevision', async () => {
      const assetId = 'asset_stale_revision_01';
      await seedAssetInBothRepositories(
        buildPendingAsset(assetId, { createdByUid: editorAdmin.id })
      );

      // Transition revision 1 -> 2
      await executeManageNewsRequest(
        {
          auth: { uid: primaryAdmin.id },
          data: {
            action: 'transitionImageRights',
            decision: {
              assetId,
              expectedRevision: 1,
              targetStatus: 'Rejected',
              reviewReason: 'Missing source attribution.',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );

      // Attempt transition with stale expectedRevision: 1 -> CONFLICT -> aborted
      await expectHttpsError(
        executeManageNewsRequest(
          {
            auth: { uid: primaryAdmin.id },
            data: {
              action: 'transitionImageRights',
              decision: {
                assetId,
                expectedRevision: 1,
                targetStatus: 'Rejected',
                reviewReason: 'Duplicate stale rejection attempt.',
              },
            },
          },
          adminRepo,
          newsService,
          rightsService,
          assetRepo
        ),
        'aborted',
        /CONFLICT/
      );
    });
  });

  describe('17. Existing manageNews Actions Regression & Error Sanitization', () => {
    it('17. preserves existing manageNews actions (listAll, getById, saveDraft, transitionWorkflow) unchanged', async () => {
      // 1. saveDraft (create)
      const createdRes = await executeManageNewsRequest(
        {
          auth: { uid: editorAdmin.id },
          data: {
            action: 'saveDraft',
            item: {
              titleAr: 'تقرير المناخ السنوي',
              summaryAr: 'ملخص التقرير البيئي',
              bodyAr: 'محتوى الخبر التفصيلي حول مؤشرات المناخ.',
              category: 'Climate',
            },
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );
      expect(createdRes.item.id).toMatch(/^news-/);
      expect(createdRes.item.workflowState).toBe('Draft');

      // 2. getById
      const fetchedRes = await executeManageNewsRequest(
        {
          auth: { uid: viewerAdmin.id },
          data: {
            action: 'getById',
            id: createdRes.item.id,
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );
      expect(fetchedRes.item.id).toBe(createdRes.item.id);

      // 3. listAll
      const listRes = await executeManageNewsRequest(
        {
          auth: { uid: viewerAdmin.id },
          data: {
            action: 'listAll',
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );
      expect(listRes.items).toHaveLength(1);

      // 4. transitionWorkflow (Draft -> InReview)
      const workflowRes = await executeManageNewsRequest(
        {
          auth: { uid: editorAdmin.id },
          data: {
            action: 'transitionWorkflow',
            id: createdRes.item.id,
            targetState: 'InReview',
            comment: 'جاهز للمراجعة التحريرية',
          },
        },
        adminRepo,
        newsService,
        rightsService,
        assetRepo
      );
      expect(workflowRes.item.workflowState).toBe('InReview');
    });

    it('sanitizes persistence errors and never leaks private storage paths or internal stack details', async () => {
      const failingAssetRepo: EditorialImageAssetRepository = {
        async getById(): Promise<EditorialImageAssetReadResult> {
          throw new EditorialImageAssetRepositoryError(
            'PERSISTENCE_FAILURE',
            'Failed reading gs://secret-bucket/editorial_images/private/asset_01/original_processed.webp'
          );
        },
        createIfAbsent: (a) => assetRepo.createIfAbsent(a),
        updateEditorialMetadata: (id, rev, patch) =>
          assetRepo.updateEditorialMetadata(id, rev, patch),
      };

      let caughtError: { code?: string; message?: string } | undefined;
      try {
        await executeManageNewsRequest(
          {
            auth: { uid: editorAdmin.id },
            data: {
              action: 'getEditorialImageRights',
              assetIds: ['asset_01'],
            },
          },
          adminRepo,
          newsService,
          rightsService,
          failingAssetRepo
        );
      } catch (err) {
        caughtError = err as { code?: string; message?: string };
      }

      expect(caughtError).toBeDefined();
      expect(caughtError?.code).toBe('internal');
      expect(caughtError?.message).not.toContain('editorial_images/private');
      expect(caughtError?.message).not.toContain('gs://');

      // Also verify production factory wiring creates an EditorialImageRightsReviewService instance
      const prodRightsService =
        createProductionEditorialImageRightsReviewService(adminRepo);
      expect(prodRightsService).toBeInstanceOf(
        EditorialImageRightsReviewService
      );

      // And verify domain errors with any embedded path are redacted
      const pathLeakAssetRepo: EditorialImageAssetRepository = {
        async getById(): Promise<EditorialImageAssetReadResult> {
          throw new EditorialImageRightsReviewError(
            'INVALID_ASSET',
            'Corrupted variant at editorial_images/private/asset_01/card.webp'
          );
        },
        createIfAbsent: (a) => assetRepo.createIfAbsent(a),
        updateEditorialMetadata: (id, rev, patch) =>
          assetRepo.updateEditorialMetadata(id, rev, patch),
      };

      let domainErr: { code?: string; message?: string } | undefined;
      try {
        await executeManageNewsRequest(
          {
            auth: { uid: editorAdmin.id },
            data: {
              action: 'getEditorialImageRights',
              assetIds: ['asset_01'],
            },
          },
          adminRepo,
          newsService,
          rightsService,
          pathLeakAssetRepo
        );
      } catch (err) {
        domainErr = err as { code?: string; message?: string };
      }

      expect(domainErr?.code).toBe('failed-precondition');
      expect(domainErr?.message).toContain('[REDACTED_STORAGE_PATH]');
      expect(domainErr?.message).not.toContain('editorial_images/private');
    });
  });
});
