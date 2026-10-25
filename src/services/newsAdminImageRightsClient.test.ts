/**
 * Promise of Planet — IMG-F3-09/D3-B2-B2
 * Editorial Image Rights — Typed Client Bridge Tests
 *
 * Covers:
 * 1. All 5 editorial image rights actions invoke the existing manageNews callable transport
 *    with exact action names and payload envelopes.
 * 2. getEditorialImageRights handles valid found (active, PendingReview, Approved, Rejected, Revoked)
 *    and missing (NOT_FOUND) asset records without reinterpreting non-approved records as Approved.
 * 3. Fail-closed rejection of malformed responses and any leaked private storage / binary fields
 *    (variants, storagePath, sha256Checksum, originalSizeBytes, editorial_images/private, gs://, http/https URLs).
 * 4. Server permission-denied (SELF_APPROVAL_FORBIDDEN, AI_APPROVAL_FORBIDDEN, PERMISSION_DENIED)
 *    and conflict (CONFLICT, REVIEW_REQUEST_CONSUMED) errors propagate deterministically with zero retries.
 * 5. No local rights approval, reviewer identity, timestamp, or revision synthesis; client rejects
 *    caller-supplied actor UID/role/permission injection before invoking transport.
 * 6. Existing NewsAdminClient actions (listAll, getById, saveNewsItem, executeTransition) remain intact.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EDITORIAL_IMAGE_AUDIT_TARGET_TYPE,
  MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS,
  NewsAdminClient,
  type EditorialImageAssetRightsAuditEvent,
  type EditorialImageRightsDecisionInput,
  type EditorialImageRightsEvidenceRecord,
  type EditorialImageRightsReviewRequestRecord,
  type FoundEditorialImageRightsAdminDto,
  type MissingEditorialImageRightsAdminDto,
  type RegisterEditorialImageRightsEvidenceInput,
  type RevokeEditorialImageRightsEvidenceInput,
  type SanitizedEditorialImageAssetAdminMetadata,
  type SubmitEditorialImageRightsReviewRequestInput,
} from './newsAdminClient';
import { AdminRole } from '../types/admin';
import { AuditAction } from '../types/audit';
import { WorkflowState } from '../types/workflow';

const VALID_SHA256 =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0';

function createFoundAssetMetadata(
  overrides: Partial<SanitizedEditorialImageAssetAdminMetadata> = {}
): SanitizedEditorialImageAssetAdminMetadata {
  const assetId = overrides.assetId ?? 'asset_cop16_01';
  return {
    assetId,
    createdByUid: 'editor_uid_01',
    createdAtIso: '2026-10-20T10:00:00.000Z',
    updatedAtIso: '2026-10-20T10:00:00.000Z',
    origin: 'news_article',
    status: 'active',
    rights: {
      status: 'PendingReview',
    },
    originalFilename: 'cop16-sudan-pavilion.webp',
    mimeType: 'image/webp',
    originalWidth: 1600,
    originalHeight: 1000,
    aspectRatio: 1.6,
    altAr: 'جناح السودان في مؤتمر الأطراف السادس عشر',
    altEn: 'Sudan pavilion at COP16',
    captionAr: 'جانب من مشاركة الوفد السوداني في الرياض',
    captionEn: 'Sudanese delegation participation in Riyadh',
    photographerCredit: 'وحدة الإعلام البيئي',
    licensingInfo: 'ترخيص تحريري مباشر',
    tags: ['السودان', 'COP16'],
    associatedArticleIds: ['news_article_101'],
    ...overrides,
  };
}

function createFoundRightsDto(
  assetOverrides: Partial<SanitizedEditorialImageAssetAdminMetadata> = {},
  revision: number = 1
): FoundEditorialImageRightsAdminDto {
  const asset = createFoundAssetMetadata(assetOverrides);
  return {
    assetId: asset.assetId,
    found: true,
    revision,
    status: asset.status,
    createdByUid: asset.createdByUid,
    rights: asset.rights,
    altAr: asset.altAr,
    ...(asset.altEn !== undefined ? { altEn: asset.altEn } : {}),
    ...(asset.captionAr !== undefined ? { captionAr: asset.captionAr } : {}),
    ...(asset.captionEn !== undefined ? { captionEn: asset.captionEn } : {}),
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    originalWidth: asset.originalWidth,
    originalHeight: asset.originalHeight,
    aspectRatio: asset.aspectRatio,
    asset,
  };
}

function createMissingRightsDto(
  assetId: string = 'asset_missing_99'
): MissingEditorialImageRightsAdminDto {
  return {
    assetId,
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
  };
}

function createActiveEvidenceRecord(
  overrides: Partial<EditorialImageRightsEvidenceRecord> = {}
): EditorialImageRightsEvidenceRecord {
  return {
    evidenceId: 'ev_cop16_release_01',
    assetId: 'asset_cop16_01',
    status: 'Active',
    sourceKind: 'PhotographerWrittenRelease',
    sourceReference: 'POP-REL-2026-1042',
    summary: 'تصريح خطي موقع من المصور الميداني لنشر الصورة في أخبار المنصة',
    artifactSha256: VALID_SHA256,
    recordedByUid: 'reviewer_uid_02',
    recordedAtIso: '2026-10-20T11:00:00.000Z',
    ...overrides,
  };
}

function createPendingReviewRequestRecord(
  overrides: Partial<EditorialImageRightsReviewRequestRecord> = {}
): EditorialImageRightsReviewRequestRecord {
  return {
    requestId: 'req_reapproval_01',
    assetId: 'asset_cop16_01',
    assetRevision: 2,
    priorRightsStatus: 'Rejected',
    priorReviewedAtIso: '2026-10-20T10:30:00.000Z',
    priorEvidenceRefs: ['ev_old_01'],
    requestedByUid: 'editor_uid_01',
    requestedByName: 'محرر الأخبار',
    requestedByRole: AdminRole.RightsReviewer,
    requestedAtIso: '2026-10-20T11:15:00.000Z',
    rationale: 'تم إرفاق تصريح المصور الميداني الموثق برقم POP-REL-2026-1042',
    submittedEvidenceRefs: ['ev_cop16_release_01'],
    status: 'Pending',
    ...overrides,
  };
}

describe('IMG-F3-09/D3-B2-B2 — NewsAdminClient Editorial Image Rights Typed Bridge', () => {
  const transportSpy = vi.fn();

  beforeEach(() => {
    transportSpy.mockReset();
    NewsAdminClient.setTransport(transportSpy);
  });

  afterEach(() => {
    NewsAdminClient.setTransport(null);
    NewsAdminClient.clear();
  });

  describe('1. Exact manageNews transport routing & payload envelopes for all 5 actions', () => {
    it('routes getEditorialImageRights through manageNews with { assetIds } and returns found + NOT_FOUND records', async () => {
      const foundPending = createFoundRightsDto({ assetId: 'asset_cop16_01' }, 1);
      const foundApproved = createFoundRightsDto(
        {
          assetId: 'asset_cop16_02',
          rights: {
            status: 'Approved',
            licenseType: 'OriginalWork',
            rightsHolder: 'وعد الكوكب',
            sourceAttributionAr: 'عدسة وعد الكوكب - الخرطوم',
            sourceAttributionEn: 'Promise of Planet Lens - Khartoum',
            evidenceRefs: ['ev_cop16_release_01'],
            usageScope: {
              scopeType: 'ArticleRestricted',
              articleIds: ['news_article_101'],
            },
            reviewedByUid: 'reviewer_uid_02',
            reviewedAtIso: '2026-10-20T12:00:00.000Z',
            reviewReason: 'تم التحقق من ملكية العمل الأصلي وتوثيق المصدر',
          },
        },
        3
      );
      const missingDto = createMissingRightsDto('asset_missing_99');

      transportSpy.mockResolvedValueOnce({
        items: [foundPending, foundApproved, missingDto],
        assetsById: {
          asset_cop16_01: foundPending,
          asset_cop16_02: foundApproved,
          asset_missing_99: missingDto,
        },
      });

      const response = await NewsAdminClient.getEditorialImageRights([
        'asset_cop16_01',
        'asset_cop16_02',
        'asset_missing_99',
      ]);

      expect(transportSpy).toHaveBeenCalledTimes(1);
      expect(transportSpy).toHaveBeenCalledWith('getEditorialImageRights', {
        assetIds: ['asset_cop16_01', 'asset_cop16_02', 'asset_missing_99'],
      });

      expect(response.items).toHaveLength(3);
      expect(response.items[0]).toEqual(foundPending);
      expect(response.items[0].found).toBe(true);
      expect(response.items[0].rights?.status).toBe('PendingReview');

      expect(response.items[1]).toEqual(foundApproved);
      expect(response.items[1].found).toBe(true);
      expect(response.items[1].rights?.status).toBe('Approved');

      // Missing asset is preserved explicitly as NOT_FOUND, never reinterpreted as Approved
      expect(response.items[2]).toEqual(missingDto);
      expect(response.items[2].found).toBe(false);
      expect(response.items[2].status).toBe('NOT_FOUND');
      expect(response.items[2].rights).toBeNull();
      expect(response.items[2].asset).toBeNull();
      expect(response.items[2].revision).toBeNull();
      expect(response.assetsById['asset_missing_99']).toEqual(missingDto);
    });

    it('routes registerImageRightsEvidence through manageNews with { input }', async () => {
      const input: RegisterEditorialImageRightsEvidenceInput = {
        evidenceId: 'ev_cop16_release_01',
        assetId: 'asset_cop16_01',
        sourceKind: 'PhotographerWrittenRelease',
        sourceReference: 'POP-REL-2026-1042',
        summary: 'تصريح خطي موقع من المصور الميداني لنشر الصورة في أخبار المنصة',
        artifactSha256: VALID_SHA256,
      };
      const expectedRecord = createActiveEvidenceRecord();

      transportSpy.mockResolvedValueOnce({
        evidence: expectedRecord,
      });

      const result = await NewsAdminClient.registerImageRightsEvidence(input);

      expect(transportSpy).toHaveBeenCalledTimes(1);
      expect(transportSpy).toHaveBeenCalledWith('registerImageRightsEvidence', {
        input,
      });
      expect(result.evidence).toEqual(expectedRecord);
    });

    it('routes revokeImageRightsEvidence through manageNews with { input }', async () => {
      const input: RevokeEditorialImageRightsEvidenceInput = {
        evidenceId: 'ev_cop16_release_01',
        assetId: 'asset_cop16_01',
        revocationReason: 'انتهاء صلاحية التفويض الزمني الممنوح من المصدر',
      };
      const revokedRecord: EditorialImageRightsEvidenceRecord = {
        ...createActiveEvidenceRecord(),
        status: 'Revoked',
        revokedByUid: 'reviewer_uid_02',
        revokedAtIso: '2026-10-21T09:00:00.000Z',
        revocationReason: input.revocationReason,
      };

      transportSpy.mockResolvedValueOnce({
        evidence: revokedRecord,
      });

      const result = await NewsAdminClient.revokeImageRightsEvidence(input);

      expect(transportSpy).toHaveBeenCalledTimes(1);
      expect(transportSpy).toHaveBeenCalledWith('revokeImageRightsEvidence', {
        input,
      });
      expect(result.evidence).toEqual(revokedRecord);
      expect(result.evidence.status).toBe('Revoked');
    });

    it('routes submitImageRightsReviewRequest through manageNews with { input }', async () => {
      const input: SubmitEditorialImageRightsReviewRequestInput = {
        requestId: 'req_reapproval_01',
        assetId: 'asset_cop16_01',
        expectedRevision: 2,
        rationale: 'تم إرفاق تصريح المصور الميداني الموثق برقم POP-REL-2026-1042',
        submittedEvidenceRefs: ['ev_cop16_release_01'],
      };
      const reviewRequest = createPendingReviewRequestRecord();

      transportSpy.mockResolvedValueOnce({
        reviewRequest,
      });

      const result = await NewsAdminClient.submitImageRightsReviewRequest(input);

      expect(transportSpy).toHaveBeenCalledTimes(1);
      expect(transportSpy).toHaveBeenCalledWith(
        'submitImageRightsReviewRequest',
        { input }
      );
      expect(result.reviewRequest).toEqual(reviewRequest);
      expect(result.reviewRequest.status).toBe('Pending');
    });

    it('routes transitionImageRights through manageNews with { decision } and validates record, auditEvent, and consumedReviewRequest', async () => {
      const decision: EditorialImageRightsDecisionInput = {
        assetId: 'asset_cop16_01',
        expectedRevision: 2,
        targetStatus: 'Approved',
        reviewReason: 'تمت مراجعة التصريح المحدث والموافقة على النشر ضمن نطاق المقال',
        reviewRequestId: 'req_reapproval_01',
        licenseType: 'DirectLicense',
        licenseDetails: 'ترخيص مباشر رقم POP-REL-2026-1042',
        rightsHolder: 'المصور الميداني أحمد بابكر',
        sourceAttributionAr: 'تصوير: أحمد بابكر / وعد الكوكب',
        sourceAttributionEn: 'Photo: Ahmed Babiker / Promise of Planet',
        evidenceRefs: ['ev_cop16_release_01'],
        usageScope: {
          scopeType: 'ArticleRestricted',
          articleIds: ['news_article_101'],
        },
      };

      const approvedAsset = createFoundAssetMetadata({
        assetId: 'asset_cop16_01',
        updatedAtIso: '2026-10-20T12:30:00.000Z',
        rights: {
          status: 'Approved',
          licenseType: 'DirectLicense',
          licenseDetails: 'ترخيص مباشر رقم POP-REL-2026-1042',
          rightsHolder: 'المصور الميداني أحمد بابكر',
          sourceAttributionAr: 'تصوير: أحمد بابكر / وعد الكوكب',
          sourceAttributionEn: 'Photo: Ahmed Babiker / Promise of Planet',
          evidenceRefs: ['ev_cop16_release_01'],
          usageScope: {
            scopeType: 'ArticleRestricted',
            articleIds: ['news_article_101'],
          },
          reviewedByUid: 'reviewer_uid_02',
          reviewedAtIso: '2026-10-20T12:30:00.000Z',
          reviewReason: decision.reviewReason,
        },
      });

      const auditEvent: EditorialImageAssetRightsAuditEvent = {
        id: 'audit_rights_01',
        targetType: EDITORIAL_IMAGE_AUDIT_TARGET_TYPE,
        targetId: 'asset_cop16_01',
        assetId: 'asset_cop16_01',
        action: AuditAction.RightsChanged,
        previousRightsStatus: 'Rejected',
        newRightsStatus: 'Approved',
        previousRevision: 2,
        newRevision: 3,
        actorUserId: 'reviewer_uid_02',
        actorName: 'مراجع الحقوق',
        actorRole: AdminRole.Owner,
        timestamp: '2026-10-20T12:30:00.000Z',
        reviewReason: decision.reviewReason,
        reviewRequestId: 'req_reapproval_01',
        evidenceRefs: ['ev_cop16_release_01'],
        selfApprovedByOwner: false,
      };

      const consumedReviewRequest: EditorialImageRightsReviewRequestRecord = {
        ...createPendingReviewRequestRecord(),
        status: 'Consumed',
        consumedByUid: 'reviewer_uid_02',
        consumedAtIso: '2026-10-20T12:30:00.000Z',
        consumedByAuditId: 'audit_rights_01',
        consumedAtAssetRevision: 3,
      };

      transportSpy.mockResolvedValueOnce({
        record: {
          assetId: 'asset_cop16_01',
          revision: 3,
          asset: approvedAsset,
        },
        auditEvent,
        consumedReviewRequest,
      });

      const result = await NewsAdminClient.transitionImageRights(decision);

      expect(transportSpy).toHaveBeenCalledTimes(1);
      expect(transportSpy).toHaveBeenCalledWith('transitionImageRights', {
        decision,
      });
      expect(result.record.revision).toBe(3);
      expect(result.record.asset.rights.status).toBe('Approved');
      expect(result.auditEvent).toEqual(auditEvent);
      expect(result.consumedReviewRequest).toEqual(consumedReviewRequest);
    });
  });

  describe('2. Input validation & actor-identity injection prevention before network call', () => {
    it('rejects empty, oversized (>20), duplicate, or malformed assetIds in getEditorialImageRights without calling transport', async () => {
      await expect(NewsAdminClient.getEditorialImageRights([])).rejects.toThrow(
        /INVALID_ARGUMENT/
      );

      const twentyOneIds = Array.from(
        { length: MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS + 1 },
        (_, idx) => `asset_${idx + 1}`
      );
      await expect(
        NewsAdminClient.getEditorialImageRights(twentyOneIds)
      ).rejects.toThrow(/INVALID_ARGUMENT/);

      await expect(
        NewsAdminClient.getEditorialImageRights(['asset_1', 'asset_1'])
      ).rejects.toThrow(/duplicate/i);

      await expect(
        NewsAdminClient.getEditorialImageRights(['../editorial_images/private/x'])
      ).rejects.toThrow(/INVALID_ARGUMENT/);

      expect(transportSpy).not.toHaveBeenCalled();
    });

    it('rejects caller-supplied actor UID, role, or permissions injected into rights mutation payloads', async () => {
      await expect(
        NewsAdminClient.registerImageRightsEvidence({
          assetId: 'asset_cop16_01',
          sourceKind: 'PhotographerWrittenRelease',
          sourceReference: 'POP-REL-2026-1042',
          summary: 'ملخص دليل الحقوق',
          recordedByUid: 'spoofed_admin_uid',
        } as unknown as RegisterEditorialImageRightsEvidenceInput)
      ).rejects.toThrow(/Caller-supplied actor identity/i);

      await expect(
        NewsAdminClient.transitionImageRights({
          assetId: 'asset_cop16_01',
          expectedRevision: 1,
          targetStatus: 'Approved',
          reviewReason: 'محاولة تمرير هوية مراجع مزورة',
          reviewedByUid: 'spoofed_reviewer_uid',
          role: AdminRole.Owner,
        } as unknown as EditorialImageRightsDecisionInput)
      ).rejects.toThrow(/Caller-supplied actor identity/i);

      expect(transportSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. Fail-closed rejection of malformed responses and leaked storage/binary metadata', () => {
    it('rejects getEditorialImageRights response if variants, storagePath, sha256Checksum, originalSizeBytes, or private storage paths leak', async () => {
      const leakedVariantsDto = {
        ...createFoundRightsDto({ assetId: 'asset_cop16_01' }, 1),
        asset: {
          ...createFoundAssetMetadata({ assetId: 'asset_cop16_01' }),
          variants: {
            thumbnail: {
              variantKey: 'thumbnail',
              storagePath:
                'editorial_images/private/asset_cop16_01/thumbnail.webp',
            },
          },
        },
      };

      transportSpy.mockResolvedValueOnce({
        items: [leakedVariantsDto],
        assetsById: { asset_cop16_01: leakedVariantsDto },
      });

      await expect(
        NewsAdminClient.getEditorialImageRights(['asset_cop16_01'])
      ).rejects.toThrow(/INVALID_SERVER_RESPONSE/);

      const leakedChecksumDto = {
        ...createFoundRightsDto({ assetId: 'asset_cop16_01' }, 1),
        asset: {
          ...createFoundAssetMetadata({ assetId: 'asset_cop16_01' }),
          sha256Checksum: VALID_SHA256,
          originalSizeBytes: 120400,
        },
      };

      transportSpy.mockResolvedValueOnce({
        items: [leakedChecksumDto],
        assetsById: { asset_cop16_01: leakedChecksumDto },
      });

      await expect(
        NewsAdminClient.getEditorialImageRights(['asset_cop16_01'])
      ).rejects.toThrow(/INVALID_SERVER_RESPONSE/);
    });

    it('rejects responses containing editorial_images/private, gs://, or http/https URLs anywhere in string fields', async () => {
      const leakedPathInCaption = createFoundRightsDto(
        {
          assetId: 'asset_cop16_01',
          captionAr: 'editorial_images/private/asset_cop16_01/article_inline.webp',
        },
        1
      );

      transportSpy.mockResolvedValueOnce({
        items: [leakedPathInCaption],
        assetsById: { asset_cop16_01: leakedPathInCaption },
      });

      await expect(
        NewsAdminClient.getEditorialImageRights(['asset_cop16_01'])
      ).rejects.toThrow(/INVALID_SERVER_RESPONSE/);

      const leakedGsUrlInEvidence = {
        evidence: {
          ...createActiveEvidenceRecord(),
          summary: 'gs://promise-of-planet.appspot.com/private/doc.pdf',
        },
      };

      transportSpy.mockResolvedValueOnce(leakedGsUrlInEvidence);

      await expect(
        NewsAdminClient.registerImageRightsEvidence({
          assetId: 'asset_cop16_01',
          sourceKind: 'PhotographerWrittenRelease',
          sourceReference: 'POP-REL-2026-1042',
          summary: 'تصريح خطي موقع من المصور',
        })
      ).rejects.toThrow(/INVALID_SERVER_RESPONSE/);
    });

    it('rejects malformed NOT_FOUND record that attempts to carry non-null rights or Approved status', async () => {
      const hybridMissingDto = {
        ...createMissingRightsDto('asset_missing_99'),
        rights: { status: 'Approved' },
      };

      transportSpy.mockResolvedValueOnce({
        items: [hybridMissingDto],
        assetsById: { asset_missing_99: hybridMissingDto },
      });

      await expect(
        NewsAdminClient.getEditorialImageRights(['asset_missing_99'])
      ).rejects.toThrow(/INVALID_SERVER_RESPONSE/);
    });

    it('rejects transitionImageRights response when server revision or targetStatus does not match expected transition', async () => {
      const decision: EditorialImageRightsDecisionInput = {
        assetId: 'asset_cop16_01',
        expectedRevision: 1,
        targetStatus: 'Rejected',
        reviewReason: 'عدم كفاية بيانات الترخيص المرفقة بالصورة',
      };

      const rejectedAsset = createFoundAssetMetadata({
        assetId: 'asset_cop16_01',
        rights: {
          status: 'Rejected',
          reviewedByUid: 'reviewer_uid_02',
          reviewedAtIso: '2026-10-20T12:30:00.000Z',
          reviewReason: decision.reviewReason,
        },
      });

      // Stale revision (1 instead of expectedRevision + 1 = 2)
      transportSpy.mockResolvedValueOnce({
        record: {
          assetId: 'asset_cop16_01',
          revision: 1,
          asset: rejectedAsset,
        },
        auditEvent: {
          id: 'audit_01',
          targetType: EDITORIAL_IMAGE_AUDIT_TARGET_TYPE,
          targetId: 'asset_cop16_01',
          assetId: 'asset_cop16_01',
          action: AuditAction.RightsChanged,
          previousRightsStatus: 'PendingReview',
          newRightsStatus: 'Rejected',
          previousRevision: 1,
          newRevision: 1,
          actorUserId: 'reviewer_uid_02',
          actorName: 'مراجع الحقوق',
          actorRole: AdminRole.RightsReviewer,
          timestamp: '2026-10-20T12:30:00.000Z',
          reviewReason: decision.reviewReason,
          evidenceRefs: [],
          selfApprovedByOwner: false,
        },
      });

      await expect(
        NewsAdminClient.transitionImageRights(decision)
      ).rejects.toThrow(/INVALID_SERVER_RESPONSE/);
    });
  });

  describe('4. Deterministic error propagation without automatic retries', () => {
    it('propagates permission-denied (SELF_APPROVAL_FORBIDDEN, AI_APPROVAL_FORBIDDEN) and conflict (CONFLICT, REVIEW_REQUEST_CONSUMED) errors with zero retries', async () => {
      const selfApprovalError = Object.assign(
        new Error(
          'SELF_APPROVAL_FORBIDDEN: Asset creator cannot self-approve editorial image rights.'
        ),
        { code: 'functions/permission-denied' }
      );
      transportSpy.mockRejectedValueOnce(selfApprovalError);

      await expect(
        NewsAdminClient.transitionImageRights({
          assetId: 'asset_cop16_01',
          expectedRevision: 1,
          targetStatus: 'Approved',
          reviewReason: 'محاولة موافقة ذاتية غير مصرح بها',
          licenseType: 'OriginalWork',
          rightsHolder: 'وعد الكوكب',
          sourceAttributionAr: 'وعد الكوكب',
          evidenceRefs: ['ev_cop16_release_01'],
          usageScope: { scopeType: 'GeneralEditorial' },
        })
      ).rejects.toThrow(/SELF_APPROVAL_FORBIDDEN/);

      expect(transportSpy).toHaveBeenCalledTimes(1);

      const conflictError = Object.assign(
        new Error(
          'CONFLICT: Expected revision 1 does not match current persisted revision 2.'
        ),
        { code: 'functions/aborted' }
      );
      transportSpy.mockRejectedValueOnce(conflictError);

      await expect(
        NewsAdminClient.transitionImageRights({
          assetId: 'asset_cop16_01',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'رفض بسبب نقص التوثيق',
        })
      ).rejects.toThrow(/CONFLICT/);

      expect(transportSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Existing NewsAdminClient actions remain unchanged', () => {
    it('preserves listAll, getById, saveNewsItem, and executeTransition behavior', async () => {
      transportSpy.mockResolvedValueOnce({ items: [] });
      const all = await NewsAdminClient.listAll();
      expect(all).toEqual([]);
      expect(transportSpy).toHaveBeenLastCalledWith('listAll', undefined);

      transportSpy.mockResolvedValueOnce({ item: null });
      const item = await NewsAdminClient.getById('news_101');
      expect(item).toBeNull();
      expect(transportSpy).toHaveBeenLastCalledWith('getById', { id: 'news_101' });

      transportSpy.mockResolvedValueOnce({
        item: {
          id: 'news_101',
          titleAr: 'خبر بيئي',
          workflowState: WorkflowState.InReview,
        },
      });
      const transitioned = await NewsAdminClient.executeTransition(
        'news_101',
        WorkflowState.InReview,
        undefined,
        'جاهز للمراجعة'
      );
      expect(transitioned.workflowState).toBe(WorkflowState.InReview);
      expect(transportSpy).toHaveBeenLastCalledWith('transitionWorkflow', {
        id: 'news_101',
        targetState: WorkflowState.InReview,
        comment: 'جاهز للمراجعة',
      });
    });
  });
});
