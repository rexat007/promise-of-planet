import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AdminRole, type AdminUser } from '../../types/admin';
import type { RichNewsDocumentWrapperV2 } from '../../types/richNewsDocument';
import type {
  EditorialImageRightsDecisionInput,
  FoundEditorialImageRightsAdminDto,
  GetEditorialImageRightsResponseDto,
  RegisterEditorialImageRightsEvidenceInput,
  RegisterImageRightsEvidenceResponseDto,
  RevokeEditorialImageRightsEvidenceInput,
  RevokeImageRightsEvidenceResponseDto,
  SanitizedEditorialImageRightsAdminDto,
  SubmitEditorialImageRightsReviewRequestInput,
  SubmitImageRightsReviewRequestResponseDto,
  TransitionImageRightsResponseDto,
} from '../../services/newsAdminClient';
import type { RightsReviewStatus } from '../../types/editorialImageAsset';
import {
  EditorialImageRightsReviewPanel,
  discoverPersistedEditorialImageAssets,
  isAllowedImageRightsTransition,
  evaluateImageRightsSelfApproval,
  createInitialAssetFormBundle,
  createEditorialImageRightsPanelController,
  EDITORIAL_SEPARATION_NOTICE_AR,
  EDITORIAL_SEPARATION_NOTICE_EN,
  CANONICAL_LICENSE_TYPE_OPTIONS,
  CANONICAL_USAGE_SCOPE_OPTIONS,
  type EditorialImageRightsClientAdapter,
  type EditorialImageRightsPanelSnapshot,
} from './EditorialImageRightsReviewPanel';

// ---------------------------------------------------------------------------
// Canonical Test Users
// ---------------------------------------------------------------------------

const CONTENT_EDITOR_USER: AdminUser = {
  id: 'editor-uid-1',
  name: 'Sarah Ahmed',
  email: 'editor@promiseofplanet.sd',
  role: AdminRole.ContentEditor,
  isActive: true,
};

const RIGHTS_REVIEWER_USER: AdminUser = {
  id: 'reviewer-uid-2',
  name: 'Amna Al-Bashir',
  email: 'rights@promiseofplanet.sd',
  role: AdminRole.RightsReviewer,
  isActive: true,
};

const OWNER_USER: AdminUser = {
  id: 'owner-uid-9',
  name: 'Abbass Abdelhalim',
  email: 'owner@promiseofplanet.sd',
  role: AdminRole.Owner,
  isActive: true,
};

const VIEWER_USER: AdminUser = {
  id: 'viewer-uid-0',
  name: 'Mona El-Tayeb',
  email: 'viewer@promiseofplanet.sd',
  role: AdminRole.Viewer,
  isActive: true,
};

const INACTIVE_USER: AdminUser = {
  id: 'inactive-uid-5',
  name: 'Inactive User',
  email: 'inactive@promiseofplanet.sd',
  role: AdminRole.Owner,
  isActive: false,
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRichDocWithImages(assetIds: string[]): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Sample paragraph' }],
        },
        ...assetIds.map((assetId, idx) => ({
          type: 'editorialImage' as const,
          attrs: {
            assetId,
            altAr: `وصف الصورة ${idx + 1}`,
            altEn: `Alt text ${idx + 1}`,
            captionAr: `تعليق ${idx + 1}`,
            captionEn: `Caption ${idx + 1}`,
            width: '100%' as const,
            layout: 'block-full' as const,
          },
        })),
      ],
    },
  };
}

function makeFoundAssetDto(
  overrides: Partial<{
    assetId: string;
    revision: number;
    rightsStatus: RightsReviewStatus;
    createdByUid: string;
    licenseType:
      | 'OriginalWork'
      | 'DirectLicense'
      | 'CreativeCommons'
      | 'PublicDomainClaim'
      | 'ContextSpecificAssessment'
      | 'Other';
    usageScope: {
      scopeType: 'GeneralEditorial' | 'ArticleRestricted';
      articleIds?: string[];
    };
    evidenceRefs: string[];
  }> = {}
): FoundEditorialImageRightsAdminDto {
  const assetId = overrides.assetId ?? 'img_valid_asset_001';
  const revision = overrides.revision ?? 3;
  const rightsStatus = overrides.rightsStatus ?? 'PendingReview';
  const createdByUid = overrides.createdByUid ?? CONTENT_EDITOR_USER.id;
  const licenseType = overrides.licenseType ?? 'DirectLicense';
  const usageScope = overrides.usageScope ?? {
    scopeType: 'ArticleRestricted' as const,
    articleIds: ['article_101'],
  };
  const evidenceRefs = overrides.evidenceRefs ?? ['ev_initial_01'];

  const rights = {
    status: rightsStatus,
    licenseType,
    licenseDetails: 'Direct Contract #KRT-2026',
    rightsHolder: 'Khartoum Environmental Collective',
    sourceAttributionAr: 'تصوير: مجموعة الخرطوم البيئية',
    sourceAttributionEn: 'Photo: Khartoum Environmental Collective',
    evidenceRefs,
    usageScope,
    ...(rightsStatus !== 'PendingReview'
      ? {
          reviewedByUid: RIGHTS_REVIEWER_USER.id,
          reviewedAtIso: '2026-03-30T10:00:00.000Z',
          reviewReason: 'Verified license documentation',
        }
      : {}),
  };

  return {
    assetId,
    found: true,
    revision,
    status: 'active',
    createdByUid,
    rights,
    altAr: 'وصف بديل للصورة التحريرية',
    altEn: 'Editorial image alt text',
    captionAr: 'تعليق توضيحي للصورة',
    captionEn: 'Editorial image caption',
    originalFilename: 'field-report.jpg',
    mimeType: 'image/jpeg',
    originalWidth: 1600,
    originalHeight: 900,
    aspectRatio: 1600 / 900,
    asset: {
      id: assetId,
      revision,
      status: 'active',
      createdAtIso: '2026-03-29T08:00:00.000Z',
      updatedAtIso: '2026-03-30T09:00:00.000Z',
      createdByUid,
      updatedByUid: createdByUid,
      originalFilename: 'field-report.jpg',
      mimeType: 'image/jpeg',
      byteSize: 245000,
      sha256: 'a'.repeat(64),
      originalWidth: 1600,
      originalHeight: 900,
      aspectRatio: 1600 / 900,
      altAr: 'وصف بديل للصورة التحريرية',
      altEn: 'Editorial image alt text',
      captionAr: 'تعليق توضيحي للصورة',
      captionEn: 'Editorial image caption',
      photographerCredit: 'Khartoum Environmental Collective',
      licensingInfo: 'Direct Contract #KRT-2026',
      associatedArticleIds: ['article_101'],
      rights,
    },
  };
}

function makeSnapshotForDtos(
  dtos: SanitizedEditorialImageRightsAdminDto[],
  overrides: Partial<EditorialImageRightsPanelSnapshot> = {}
): EditorialImageRightsPanelSnapshot {
  const assetsById: Record<string, SanitizedEditorialImageRightsAdminDto> = {};
  const formsByAssetId: Record<string, ReturnType<typeof createInitialAssetFormBundle>> = {};

  for (const dto of dtos) {
    assetsById[dto.assetId] = dto;
    formsByAssetId[dto.assetId] = createInitialAssetFormBundle(dto, 'article_101');
  }

  const allAssets = dtos.map((d, idx) => ({
    assetId: d.assetId,
    role: (idx === 0 ? 'cover' : 'inline') as 'cover' | 'inline',
  }));

  return {
    discovery: {
      allAssets,
      batchAssets: allAssets,
      batchAssetIds: allAssets.map((a) => a.assetId),
      excessAssetIds: [],
      hasExcessAssets: false,
      isCompleteArticleReviewClaimable: true,
    },
    canView: true,
    canManageRights: true,
    loading: false,
    loadError: null,
    assetsById,
    previewUrlsByAssetId: {},
    previewErrorsByAssetId: {},
    formsByAssetId,
    sessionEvidenceByAssetId: {},
    sessionReviewRequestsByAssetId: {},
    sessionAuditEventsByAssetId: {},
    generation: 1,
    ...overrides,
  };
}

function createMockClientAdapter(
  initialDtos: SanitizedEditorialImageRightsAdminDto[] = [makeFoundAssetDto()]
): EditorialImageRightsClientAdapter & {
  getEditorialImageRights: ReturnType<typeof vi.fn>;
  registerImageRightsEvidence: ReturnType<typeof vi.fn>;
  revokeImageRightsEvidence: ReturnType<typeof vi.fn>;
  submitImageRightsReviewRequest: ReturnType<typeof vi.fn>;
  transitionImageRights: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, SanitizedEditorialImageRightsAdminDto>(
    initialDtos.map((d) => [d.assetId, d])
  );

  const getEditorialImageRights = vi.fn(
    async (assetIds: readonly string[]): Promise<GetEditorialImageRightsResponseDto> => {
      const assetsById: Record<string, SanitizedEditorialImageRightsAdminDto> = {};
      for (const id of assetIds) {
        assetsById[id] =
          store.get(id) ?? {
            assetId: id,
            found: false,
            revision: null,
            status: null,
            createdByUid: null,
            rights: null,
          };
      }
      return { assetsById };
    }
  );

  const registerImageRightsEvidence = vi.fn(
    async (
      input: RegisterEditorialImageRightsEvidenceInput
    ): Promise<RegisterImageRightsEvidenceResponseDto> => ({
      evidence: {
        evidenceId: input.evidenceId ?? 'ev_registered_101',
        assetId: input.assetId,
        sourceKind: input.sourceKind,
        sourceReference: input.sourceReference,
        summary: input.summary,
        ...(input.artifactSha256 ? { artifactSha256: input.artifactSha256 } : {}),
        status: 'Active',
        registeredByUid: RIGHTS_REVIEWER_USER.id,
        registeredByRole: AdminRole.RightsReviewer,
        registeredAtIso: '2026-03-30T12:00:00.000Z',
      },
    })
  );

  const revokeImageRightsEvidence = vi.fn(
    async (
      input: RevokeEditorialImageRightsEvidenceInput
    ): Promise<RevokeImageRightsEvidenceResponseDto> => ({
      evidence: {
        evidenceId: input.evidenceId,
        assetId: input.assetId,
        sourceKind: 'SignedLicenseAgreement',
        sourceReference: 'LIC-2026-01',
        summary: 'Signed agreement',
        status: 'Revoked',
        registeredByUid: RIGHTS_REVIEWER_USER.id,
        registeredByRole: AdminRole.RightsReviewer,
        registeredAtIso: '2026-03-29T12:00:00.000Z',
        revokedByUid: RIGHTS_REVIEWER_USER.id,
        revokedByRole: AdminRole.RightsReviewer,
        revokedAtIso: '2026-03-30T12:05:00.000Z',
        revocationReason: input.revocationReason,
      },
    })
  );

  const submitImageRightsReviewRequest = vi.fn(
    async (
      input: SubmitEditorialImageRightsReviewRequestInput
    ): Promise<SubmitImageRightsReviewRequestResponseDto> => ({
      reviewRequest: {
        requestId: 'img_req_501',
        assetId: input.assetId,
        assetRevision: input.expectedRevision,
        priorRightsStatus: 'Rejected',
        requestedByUid: RIGHTS_REVIEWER_USER.id,
        requestedByRole: AdminRole.RightsReviewer,
        requestedAtIso: '2026-03-30T12:10:00.000Z',
        rationale: input.rationale,
        submittedEvidenceRefs: [...input.submittedEvidenceRefs],
        status: 'Pending',
      },
    })
  );

  const transitionImageRights = vi.fn(
    async (
      decision: EditorialImageRightsDecisionInput
    ): Promise<TransitionImageRightsResponseDto> => {
      const nextRevision = decision.expectedRevision + 1;
      const updatedDto = makeFoundAssetDto({
        assetId: decision.assetId,
        revision: nextRevision,
        rightsStatus: decision.targetStatus,
        licenseType:
          decision.targetStatus === 'Approved' ? decision.licenseType : 'DirectLicense',
        usageScope:
          decision.targetStatus === 'Approved'
            ? decision.usageScope
            : { scopeType: 'ArticleRestricted', articleIds: ['article_101'] },
      });
      store.set(decision.assetId, updatedDto);

      return {
        record: {
          assetId: decision.assetId,
          revision: nextRevision,
          asset: updatedDto.asset,
        },
        auditEvent: {
          id: 'aud_evt_901',
          assetId: decision.assetId,
          previousRevision: decision.expectedRevision,
          newRevision: nextRevision,
          previousRightsStatus: 'PendingReview',
          newRightsStatus: decision.targetStatus,
          actorUid: RIGHTS_REVIEWER_USER.id,
          actorEmail: RIGHTS_REVIEWER_USER.email,
          actorName: RIGHTS_REVIEWER_USER.name,
          actorRole: AdminRole.RightsReviewer,
          assetCreatedByUid: updatedDto.createdByUid,
          selfApprovedByOwner: false,
          reviewReason: decision.reviewReason,
          timestampIso: '2026-03-30T12:15:00.000Z',
        },
      };
    }
  );

  return {
    getEditorialImageRights,
    registerImageRightsEvidence,
    revokeImageRightsEvidence,
    submitImageRightsReviewRequest,
    transitionImageRights,
  };
}

// ---------------------------------------------------------------------------
// Test Suite (Section 13)
// ---------------------------------------------------------------------------

describe('EditorialImageRightsReviewPanel — D3-B2-B3-B', () => {
  it('1. discovers and deduplicates featured + Arabic inline + English inline assetIds while excluding unsaved local assets and legacy URLs', () => {
    const richBodyAr = makeRichDocWithImages([
      'img_feat_asset_001',
      'img_ar_inline_002',
      'img_shared_inline_003',
    ]);
    const richBodyEn = makeRichDocWithImages([
      'img_shared_inline_003',
      'img_en_inline_004',
      'img_local_staged_999',
    ]);

    const discovery = discoverPersistedEditorialImageAssets({
      featuredImage: 'img_feat_asset_001',
      richBodyAr,
      richBodyEn,
      unsavedLocalAssetIds: ['img_local_staged_999'],
    });

    expect(discovery.hasExcessAssets).toBe(false);
    expect(discovery.isCompleteArticleReviewClaimable).toBe(true);
    expect(discovery.batchAssets).toEqual([
      { assetId: 'img_feat_asset_001', role: 'both' },
      { assetId: 'img_ar_inline_002', role: 'inline' },
      { assetId: 'img_shared_inline_003', role: 'inline' },
      { assetId: 'img_en_inline_004', role: 'inline' },
    ]);

    // Legacy external URLs in featuredImage are ignored
    const legacyUrlDiscovery = discoverPersistedEditorialImageAssets({
      featuredImage: 'https://images.example.org/photo.jpg',
      richBodyAr: null,
      richBodyEn: null,
    });
    expect(legacyUrlDiscovery.batchAssets).toEqual([]);
  });

  it('2. enforces 20-asset batch limit and surfaces excess warning', () => {
    const twentyThreeIds = Array.from(
      { length: 23 },
      (_, i) => `img_batch_asset_${String(i + 1).padStart(3, '0')}`
    );
    const richBodyAr = makeRichDocWithImages(twentyThreeIds.slice(1));

    const discovery = discoverPersistedEditorialImageAssets({
      featuredImage: twentyThreeIds[0],
      richBodyAr,
      richBodyEn: null,
    });

    expect(discovery.batchAssetIds).toHaveLength(20);
    expect(discovery.hasExcessAssets).toBe(true);
    expect(discovery.isCompleteArticleReviewClaimable).toBe(false);
    expect(discovery.excessAssetIds).toEqual([
      'img_batch_asset_021',
      'img_batch_asset_022',
      'img_batch_asset_023',
    ]);

    const snapshot = makeSnapshotForDtos(
      [makeFoundAssetDto({ assetId: twentyThreeIds[0] })],
      { discovery }
    );

    const html = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: snapshot,
      })
    );

    expect(html).toContain('data-testid="rights-panel-excess-limit-warning"');
    expect(html).toContain('data-testid="rights-panel-excess-asset-ids"');
    expect(html).toContain('img_batch_asset_021, img_batch_asset_022, img_batch_asset_023');
  });

  it('3. calls NewsAdminClient.getEditorialImageRights(assetIds) and populates controller state', async () => {
    const clientAdapter = createMockClientAdapter([
      makeFoundAssetDto({ assetId: 'img_feat_asset_001', rightsStatus: 'PendingReview' }),
      makeFoundAssetDto({ assetId: 'img_ar_inline_002', rightsStatus: 'Approved' }),
    ]);

    const controller = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: true,
        assetId,
        blob: new Blob(['mock'], { type: 'image/jpeg' }),
        mimeType: 'image/jpeg',
      }),
      createObjectUrl: () => 'blob:https://example.org/preview-uuid-1',
    });

    const snap = await controller.loadForDiscovery({
      featuredImage: 'img_feat_asset_001',
      richBodyAr: makeRichDocWithImages(['img_ar_inline_002']),
      richBodyEn: null,
    });

    expect(clientAdapter.getEditorialImageRights).toHaveBeenCalledTimes(1);
    expect(clientAdapter.getEditorialImageRights).toHaveBeenCalledWith([
      'img_feat_asset_001',
      'img_ar_inline_002',
    ]);
    expect(snap.loading).toBe(false);
    expect(snap.assetsById['img_feat_asset_001']?.rights?.status).toBe('PendingReview');
    expect(snap.assetsById['img_ar_inline_002']?.rights?.status).toBe('Approved');
    expect(snap.previewUrlsByAssetId['img_feat_asset_001']).toBe(
      'blob:https://example.org/preview-uuid-1'
    );
  });

  it('4. renders Loading, Empty, Error, NOT_FOUND, PendingReview, Approved, Rejected, and Revoked states', () => {
    // Loading state
    const loadingSnapshot = makeSnapshotForDtos(
      [makeFoundAssetDto({ assetId: 'img_loading_001' })],
      { loading: true }
    );
    const loadingHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        isAr: false,
        initialSnapshot: loadingSnapshot,
      })
    );
    expect(loadingHtml).toContain('data-testid="rights-panel-loading"');

    // Empty state
    const emptySnapshot = makeSnapshotForDtos([]);
    const emptyHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        isAr: false,
        initialSnapshot: emptySnapshot,
      })
    );
    expect(emptyHtml).toContain('data-testid="rights-panel-empty"');

    // Error state
    const errorSnapshot = makeSnapshotForDtos([], {
      loadError: 'Server rights fetch failed',
    });
    const errorHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        isAr: false,
        initialSnapshot: errorSnapshot,
      })
    );
    expect(errorHtml).toContain('data-testid="rights-panel-error"');
    expect(errorHtml).toContain('Server rights fetch failed');

    // NOT_FOUND, PendingReview, Approved, Rejected, Revoked
    const notFoundDto: SanitizedEditorialImageRightsAdminDto = {
      assetId: 'img_missing_404',
      found: false,
      revision: null,
      status: null,
      createdByUid: null,
      rights: null,
    };
    const pendingDto = makeFoundAssetDto({
      assetId: 'img_pending_01',
      rightsStatus: 'PendingReview',
    });
    const approvedDto = makeFoundAssetDto({
      assetId: 'img_approved_02',
      rightsStatus: 'Approved',
      usageScope: { scopeType: 'GeneralEditorial' },
    });
    const rejectedDto = makeFoundAssetDto({
      assetId: 'img_rejected_03',
      rightsStatus: 'Rejected',
    });
    const revokedDto = makeFoundAssetDto({
      assetId: 'img_revoked_04',
      rightsStatus: 'Revoked',
    });

    const allStatusesHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: makeSnapshotForDtos([
          notFoundDto,
          pendingDto,
          approvedDto,
          rejectedDto,
          revokedDto,
        ]),
      })
    );

    expect(allStatusesHtml).toContain('data-testid="rights-status-badge-NOT_FOUND"');
    expect(allStatusesHtml).toContain('data-testid="rights-asset-not-found-warning-img_missing_404"');
    expect(allStatusesHtml).toContain('data-testid="rights-status-badge-PendingReview"');
    expect(allStatusesHtml).toContain('data-testid="rights-status-badge-Approved"');
    expect(allStatusesHtml).toContain('data-testid="rights-status-badge-Rejected"');
    expect(allStatusesHtml).toContain('data-testid="rights-status-badge-Revoked"');
  });

  it('5. renders ContentEditor read-only rights inspection and hides ManageRights mutation buttons', async () => {
    const assetDto = makeFoundAssetDto({
      assetId: 'img_rbac_001',
      rightsStatus: 'PendingReview',
      createdByUid: CONTENT_EDITOR_USER.id,
    });

    const editorCtrl = createEditorialImageRightsPanelController({
      currentUser: CONTENT_EDITOR_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter: createMockClientAdapter([assetDto]),
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });
    const editorSnap = await editorCtrl.loadForDiscovery({
      featuredImage: 'img_rbac_001',
    });
    expect(editorSnap.canView).toBe(true);
    expect(editorSnap.canManageRights).toBe(false);

    const editorHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: CONTENT_EDITOR_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: editorSnap,
      })
    );
    expect(editorHtml).toContain('Read-Only Inspection (ContentEditor)');
    expect(editorHtml).not.toContain('data-testid="rights-open-approve-img_rbac_001"');
    expect(editorHtml).not.toContain('data-testid="rights-open-reject-img_rbac_001"');
    expect(editorHtml).not.toContain('data-testid="rights-open-register-evidence-img_rbac_001"');
  });

  it('6. renders RightsReviewer controls for evidence registration, evidence revocation, review-request submission, and transitions', async () => {
    const assetDto = makeFoundAssetDto({
      assetId: 'img_rbac_002',
      rightsStatus: 'PendingReview',
      createdByUid: CONTENT_EDITOR_USER.id,
    });

    const reviewerCtrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter: createMockClientAdapter([assetDto]),
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });
    const reviewerSnap = await reviewerCtrl.loadForDiscovery({
      featuredImage: 'img_rbac_002',
    });
    expect(reviewerSnap.canView).toBe(true);
    expect(reviewerSnap.canManageRights).toBe(true);

    const reviewerHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: RIGHTS_REVIEWER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: reviewerSnap,
      })
    );
    expect(reviewerHtml).toContain('Rights Management Authorized (RightsReviewer)');
    expect(reviewerHtml).toContain('data-testid="rights-open-register-evidence-img_rbac_002"');
    expect(reviewerHtml).toContain('data-testid="rights-open-revoke-evidence-img_rbac_002"');
    expect(reviewerHtml).toContain('data-testid="rights-open-approve-img_rbac_002"');
    expect(reviewerHtml).toContain('data-testid="rights-open-reject-img_rbac_002"');
  });

  it('7. renders Owner controls for evidence/request and transitions, Viewer read-only view, and blocks inactive accounts', () => {
    const assetDto = makeFoundAssetDto({
      assetId: 'img_rbac_003',
      rightsStatus: 'Rejected',
      createdByUid: CONTENT_EDITOR_USER.id,
    });

    const ownerCtrl = createEditorialImageRightsPanelController({
      currentUser: OWNER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter: createMockClientAdapter([assetDto]),
    });
    expect(ownerCtrl.getSnapshot().canView).toBe(true);
    expect(ownerCtrl.getSnapshot().canManageRights).toBe(true);

    const ownerHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: makeSnapshotForDtos([assetDto]),
      })
    );
    expect(ownerHtml).toContain('data-testid="rights-open-register-evidence-img_rbac_003"');
    expect(ownerHtml).toContain('data-testid="rights-open-review-request-img_rbac_003"');
    expect(ownerHtml).toContain('data-testid="rights-open-approve-img_rbac_003"');

    const viewerCtrl = createEditorialImageRightsPanelController({
      currentUser: VIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter: createMockClientAdapter([assetDto]),
    });
    expect(viewerCtrl.getSnapshot().canView).toBe(true);
    expect(viewerCtrl.getSnapshot().canManageRights).toBe(false);

    const inactiveCtrl = createEditorialImageRightsPanelController({
      currentUser: INACTIVE_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter: createMockClientAdapter([assetDto]),
    });
    expect(inactiveCtrl.getSnapshot().canView).toBe(false);
    const inactiveHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: INACTIVE_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: inactiveCtrl.getSnapshot(),
      })
    );
    expect(inactiveHtml).toContain('data-testid="rights-panel-permission-denied"');
  });

  it('8. blocks RightsReviewer self-approval when createdByUid === currentUser.id while still allowing Reject', async () => {
    const evalResult = evaluateImageRightsSelfApproval(
      RIGHTS_REVIEWER_USER,
      RIGHTS_REVIEWER_USER.id
    );
    expect(evalResult).toEqual({
      isUploader: true,
      isSelfApprovalForbidden: true,
      isOwnerSelfApprovalException: false,
    });

    const selfUploadedDto = makeFoundAssetDto({
      assetId: 'img_self_reviewer_01',
      createdByUid: RIGHTS_REVIEWER_USER.id,
      rightsStatus: 'PendingReview',
    });

    const clientAdapter = createMockClientAdapter([selfUploadedDto]);
    const ctrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });

    const snap = await ctrl.loadForDiscovery({
      featuredImage: 'img_self_reviewer_01',
    });

    const html = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: RIGHTS_REVIEWER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: snap,
      })
    );

    expect(html).toContain('data-testid="rights-self-approval-blocked-img_self_reviewer_01"');
    expect(html).toContain(
      'Your account uploaded this image; self-approval of image rights is forbidden for non-Owner roles.'
    );

    // Attempting submitDecision('Approved') is blocked client-side without calling transitionImageRights
    const blockedRes = await ctrl.submitDecision('img_self_reviewer_01', 'Approved');
    expect(blockedRes).toBeNull();
    expect(clientAdapter.transitionImageRights).not.toHaveBeenCalled();
    expect(ctrl.getSnapshot().formsByAssetId['img_self_reviewer_01']?.actionError).toContain(
      'SELF_APPROVAL_FORBIDDEN'
    );
  });

  it('9. allows Owner self-approval and displays the Owner self-approval audit notice', () => {
    const evalResult = evaluateImageRightsSelfApproval(OWNER_USER, OWNER_USER.id);
    expect(evalResult).toEqual({
      isUploader: true,
      isSelfApprovalForbidden: false,
      isOwnerSelfApprovalException: true,
    });

    const ownerUploadedDto = makeFoundAssetDto({
      assetId: 'img_self_owner_01',
      createdByUid: OWNER_USER.id,
      rightsStatus: 'PendingReview',
    });

    const html = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: makeSnapshotForDtos([ownerUploadedDto]),
      })
    );

    expect(html).toContain('data-testid="rights-owner-self-approval-notice-img_self_owner_01"');
    expect(html).toContain('selfApprovedByOwner: true');
    expect(html).not.toContain('data-testid="rights-self-approval-blocked-img_self_owner_01"');
  });

  it('10. enforces canonical state transition matrix and hides invalid transition actions', () => {
    // PendingReview -> Approved | Rejected (NOT Revoked)
    expect(isAllowedImageRightsTransition('PendingReview', 'Approved')).toBe(true);
    expect(isAllowedImageRightsTransition('PendingReview', 'Rejected')).toBe(true);
    expect(isAllowedImageRightsTransition('PendingReview', 'Revoked')).toBe(false);

    // Approved -> Revoked (NOT Approved | Rejected)
    expect(isAllowedImageRightsTransition('Approved', 'Revoked')).toBe(true);
    expect(isAllowedImageRightsTransition('Approved', 'Approved')).toBe(false);
    expect(isAllowedImageRightsTransition('Approved', 'Rejected')).toBe(false);

    // Rejected / Revoked -> Approved (re-approval with reviewRequestId, NOT Rejected | Revoked)
    expect(isAllowedImageRightsTransition('Rejected', 'Approved')).toBe(true);
    expect(isAllowedImageRightsTransition('Rejected', 'Rejected')).toBe(false);
    expect(isAllowedImageRightsTransition('Rejected', 'Revoked')).toBe(false);

    expect(isAllowedImageRightsTransition('Revoked', 'Approved')).toBe(true);
    expect(isAllowedImageRightsTransition('Revoked', 'Rejected')).toBe(false);
    expect(isAllowedImageRightsTransition('Revoked', 'Revoked')).toBe(false);

    expect(isAllowedImageRightsTransition('NOT_FOUND', 'Approved')).toBe(false);

    // PendingReview asset hides Revoke and Review-Request buttons
    const pendingHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: RIGHTS_REVIEWER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: makeSnapshotForDtos([
          makeFoundAssetDto({ assetId: 'img_matrix_pend', rightsStatus: 'PendingReview' }),
        ]),
      })
    );
    expect(pendingHtml).toContain('data-testid="rights-open-approve-img_matrix_pend"');
    expect(pendingHtml).toContain('data-testid="rights-open-reject-img_matrix_pend"');
    expect(pendingHtml).not.toContain('data-testid="rights-open-revoke-img_matrix_pend"');
    expect(pendingHtml).not.toContain('data-testid="rights-open-review-request-img_matrix_pend"');

    // Approved asset shows Revoke button and hides Approve / Reject / Review-Request buttons
    const approvedHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: RIGHTS_REVIEWER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: makeSnapshotForDtos([
          makeFoundAssetDto({ assetId: 'img_matrix_app', rightsStatus: 'Approved' }),
        ]),
      })
    );
    expect(approvedHtml).toContain('data-testid="rights-open-revoke-img_matrix_app"');
    expect(approvedHtml).not.toContain('data-testid="rights-open-approve-img_matrix_app"');
    expect(approvedHtml).not.toContain('data-testid="rights-open-reject-img_matrix_app"');
  });

  it('11. passes exact expectedRevision, targetStatus, reviewReason, licenseType, evidenceRefs, and usageScope (ArticleRestricted & GeneralEditorial) to transitionImageRights', async () => {
    const clientAdapter = createMockClientAdapter([
      makeFoundAssetDto({
        assetId: 'img_trans_001',
        revision: 7,
        rightsStatus: 'PendingReview',
        createdByUid: CONTENT_EDITOR_USER.id,
      }),
    ]);

    const ctrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });

    await ctrl.loadForDiscovery({ featuredImage: 'img_trans_001' });

    ctrl.setActiveActionMode('img_trans_001', 'approve');
    ctrl.updateApproveForm('img_trans_001', {
      licenseType: 'DirectLicense',
      licenseDetails: 'Agreement #SDN-77',
      rightsHolder: 'Blue Nile Documentary Archive',
      sourceAttributionAr: 'تصوير: أرشيف النيل الأزرق الوثائقي',
      sourceAttributionEn: 'Photo: Blue Nile Documentary Archive',
      usageScopeType: 'ArticleRestricted',
      restrictedArticleIdsInput: 'article_101, article_202',
      evidenceRefsInput: 'ev_initial_01, ev_extra_02',
      reviewReason: 'Verified signed archive release and article scope',
    });

    const approveRes = await ctrl.submitDecision('img_trans_001', 'Approved');
    expect(approveRes).not.toBeNull();
    expect(clientAdapter.transitionImageRights).toHaveBeenCalledWith({
      assetId: 'img_trans_001',
      expectedRevision: 7,
      targetStatus: 'Approved',
      reviewReason: 'Verified signed archive release and article scope',
      licenseType: 'DirectLicense',
      licenseDetails: 'Agreement #SDN-77',
      rightsHolder: 'Blue Nile Documentary Archive',
      sourceAttributionAr: 'تصوير: أرشيف النيل الأزرق الوثائقي',
      sourceAttributionEn: 'Photo: Blue Nile Documentary Archive',
      evidenceRefs: ['ev_initial_01', 'ev_extra_02'],
      usageScope: {
        scopeType: 'ArticleRestricted',
        articleIds: ['article_101', 'article_202'],
      },
    });

    // Now asset is Approved at revision 8 -> test Revoke transition
    ctrl.setActiveActionMode('img_trans_001', 'revoke');
    ctrl.updateRevokeForm('img_trans_001', {
      reviewReason: 'Syndication window ended',
    });

    const revokeRes = await ctrl.submitDecision('img_trans_001', 'Revoked');
    expect(revokeRes).not.toBeNull();
    expect(clientAdapter.transitionImageRights).toHaveBeenLastCalledWith({
      assetId: 'img_trans_001',
      expectedRevision: 8,
      targetStatus: 'Revoked',
      reviewReason: 'Syndication window ended',
    });
  });

  it('12. approves Other license when required licenseDetails rationale is provided', async () => {
    const clientAdapter = createMockClientAdapter([
      makeFoundAssetDto({
        assetId: 'img_other_lic_001',
        revision: 4,
        rightsStatus: 'PendingReview',
        createdByUid: CONTENT_EDITOR_USER.id,
      }),
    ]);

    const ctrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });

    await ctrl.loadForDiscovery({ featuredImage: 'img_other_lic_001' });

    ctrl.setActiveActionMode('img_other_lic_001', 'approve');
    ctrl.updateApproveForm('img_other_lic_001', {
      licenseType: 'Other',
      licenseDetails: 'Custom bilateral humanitarian media sharing memorandum #2026-4',
      rightsHolder: 'Partner NGO',
      sourceAttributionAr: 'تصوير: منظمة شريكة',
      usageScopeType: 'GeneralEditorial',
      evidenceRefsInput: 'ev_initial_01',
      reviewReason: 'Reviewed custom license',
    });

    const allowed = await ctrl.submitDecision('img_other_lic_001', 'Approved');
    expect(allowed).not.toBeNull();
    expect(clientAdapter.transitionImageRights).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'img_other_lic_001',
        expectedRevision: 4,
        targetStatus: 'Approved',
        licenseType: 'Other',
        licenseDetails: 'Custom bilateral humanitarian media sharing memorandum #2026-4',
        usageScope: { scopeType: 'GeneralEditorial' },
      })
    );
  });

  it('13. blocks Other license approval when licenseDetails rationale is missing', async () => {
    const clientAdapter = createMockClientAdapter([
      makeFoundAssetDto({
        assetId: 'img_other_lic_002',
        revision: 4,
        rightsStatus: 'PendingReview',
        createdByUid: CONTENT_EDITOR_USER.id,
      }),
    ]);

    const ctrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });

    await ctrl.loadForDiscovery({ featuredImage: 'img_other_lic_002' });

    ctrl.setActiveActionMode('img_other_lic_002', 'approve');
    ctrl.updateApproveForm('img_other_lic_002', {
      licenseType: 'Other',
      licenseDetails: '   ',
      rightsHolder: 'Partner NGO',
      sourceAttributionAr: 'تصوير: منظمة شريكة',
      usageScopeType: 'GeneralEditorial',
      evidenceRefsInput: 'ev_initial_01',
      reviewReason: 'Reviewed custom license',
    });

    const blocked = await ctrl.submitDecision('img_other_lic_002', 'Approved');
    expect(blocked).toBeNull();
    expect(clientAdapter.transitionImageRights).not.toHaveBeenCalled();
    expect(ctrl.getSnapshot().formsByAssetId['img_other_lic_002']?.actionError).toContain(
      'licenseDetails'
    );
  });

  it('14. registers and revokes rights evidence with reason and refreshes authoritative batch', async () => {
    const clientAdapter = createMockClientAdapter([
      makeFoundAssetDto({
        assetId: 'img_ev_flow_001',
        revision: 2,
        rightsStatus: 'PendingReview',
      }),
    ]);

    const ctrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });

    await ctrl.loadForDiscovery({ featuredImage: 'img_ev_flow_001' });

    // Register evidence
    ctrl.setActiveActionMode('img_ev_flow_001', 'registerEvidence');
    ctrl.updateRegisterEvidenceForm('img_ev_flow_001', {
      sourceKind: 'PhotographerWrittenRelease',
      sourceReference: 'REL-2026-99',
      summary: 'Signed written release from field photographer',
      artifactSha256: 'b'.repeat(64),
    });

    const regRes = await ctrl.submitRegisterEvidence('img_ev_flow_001');
    expect(regRes).not.toBeNull();
    expect(clientAdapter.registerImageRightsEvidence).toHaveBeenCalledWith({
      assetId: 'img_ev_flow_001',
      sourceKind: 'PhotographerWrittenRelease',
      sourceReference: 'REL-2026-99',
      summary: 'Signed written release from field photographer',
      artifactSha256: 'b'.repeat(64),
    });
    expect(ctrl.getSnapshot().sessionEvidenceByAssetId['img_ev_flow_001']).toHaveLength(1);

    // Revoke evidence
    ctrl.setActiveActionMode('img_ev_flow_001', 'revokeEvidence');
    ctrl.updateRevokeEvidenceForm('img_ev_flow_001', {
      evidenceId: 'ev_registered_101',
      revocationReason: 'Replaced by updated release document',
    });

    const revRes = await ctrl.submitRevokeEvidence('img_ev_flow_001');
    expect(revRes).not.toBeNull();
    expect(clientAdapter.revokeImageRightsEvidence).toHaveBeenCalledWith({
      evidenceId: 'ev_registered_101',
      assetId: 'img_ev_flow_001',
      revocationReason: 'Replaced by updated release document',
    });
    expect(
      ctrl.getSnapshot().sessionEvidenceByAssetId['img_ev_flow_001']?.[0]?.status
    ).toBe('Revoked');
  });

  it('15. submits review request with expectedRevision for Rejected/Revoked asset and refreshes state', async () => {
    const clientAdapter = createMockClientAdapter([
      makeFoundAssetDto({
        assetId: 'img_req_flow_001',
        revision: 5,
        rightsStatus: 'Rejected',
      }),
    ]);

    const ctrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });

    await ctrl.loadForDiscovery({ featuredImage: 'img_req_flow_001' });

    ctrl.setActiveActionMode('img_req_flow_001', 'submitReviewRequest');
    ctrl.updateSubmitReviewRequestForm('img_req_flow_001', {
      submittedEvidenceRefsInput: 'ev_new_201, ev_new_202',
      rationale: 'Uploaded counter-signed release from agency archive',
    });

    const reqRes = await ctrl.submitReviewRequest('img_req_flow_001');
    expect(reqRes).not.toBeNull();
    expect(clientAdapter.submitImageRightsReviewRequest).toHaveBeenCalledWith({
      assetId: 'img_req_flow_001',
      expectedRevision: 5,
      rationale: 'Uploaded counter-signed release from agency archive',
      submittedEvidenceRefs: ['ev_new_201', 'ev_new_202'],
    });

    const snap = ctrl.getSnapshot();
    expect(snap.sessionReviewRequestsByAssetId['img_req_flow_001']?.requestId).toBe(
      'img_req_501'
    );
    expect(snap.formsByAssetId['img_req_flow_001']?.approve.reviewRequestId).toBe(
      'img_req_501'
    );
  });

  it('16. displays revision conflict banner on revision mismatch, preserves user input, and refreshes authoritative batch', async () => {
    const clientAdapter = createMockClientAdapter([
      makeFoundAssetDto({
        assetId: 'img_conflict_001',
        revision: 2,
        rightsStatus: 'PendingReview',
      }),
    ]);

    clientAdapter.transitionImageRights.mockRejectedValueOnce(
      new Error('CONFLICT: expectedRevision mismatch (expected 2, actual 3)')
    );

    const ctrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: false,
        assetId,
        errorCode: 'NOT_FOUND',
        message: 'none',
      }),
    });

    await ctrl.loadForDiscovery({ featuredImage: 'img_conflict_001' });

    ctrl.setActiveActionMode('img_conflict_001', 'reject');
    ctrl.updateRejectForm('img_conflict_001', {
      reviewReason: 'Missing source release form',
    });

    const res = await ctrl.submitDecision('img_conflict_001', 'Rejected');
    expect(res).toBeNull();
    // Initial load + conflict refresh = 2 calls
    expect(clientAdapter.getEditorialImageRights).toHaveBeenCalledTimes(2);

    const snap = ctrl.getSnapshot();
    expect(snap.formsByAssetId['img_conflict_001']?.conflictMessage).toContain(
      'Revision conflict detected'
    );
    // Preserves form input
    expect(snap.formsByAssetId['img_conflict_001']?.reject.reviewReason).toBe(
      'Missing source release form'
    );

    const html = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: RIGHTS_REVIEWER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: snap,
      })
    );
    expect(html).toContain('data-testid="rights-conflict-banner-img_conflict_001"');
  });

  it('17. revokes blob: preview URLs when discovery changes and when controller is disposed', async () => {
    const revokedUrls: string[] = [];
    const clientAdapter = createMockClientAdapter([
      makeFoundAssetDto({ assetId: 'img_blob_001' }),
      makeFoundAssetDto({ assetId: 'img_blob_002' }),
    ]);

    let counter = 0;
    const ctrl = createEditorialImageRightsPanelController({
      currentUser: RIGHTS_REVIEWER_USER,
      articleId: 'article_101',
      isAr: false,
      clientAdapter,
      fetchPreview: async ({ assetId }) => ({
        ok: true,
        assetId,
        blob: new Blob(['img'], { type: 'image/jpeg' }),
        mimeType: 'image/jpeg',
      }),
      createObjectUrl: () => {
        counter += 1;
        return `blob:https://example.org/owned-blob-${counter}`;
      },
      revokeObjectUrl: (url) => {
        revokedUrls.push(url);
      },
    });

    await ctrl.loadForDiscovery({
      featuredImage: 'img_blob_001',
      richBodyAr: makeRichDocWithImages(['img_blob_002']),
    });
    expect(revokedUrls).toEqual([]);

    // Reloading discovery revokes prior owned blob URLs
    await ctrl.loadForDiscovery({
      featuredImage: 'img_blob_001',
    });
    expect(revokedUrls).toEqual([
      'blob:https://example.org/owned-blob-1',
      'blob:https://example.org/owned-blob-2',
    ]);

    // Disposing revokes remaining owned blob URLs
    ctrl.dispose();
    expect(revokedUrls).toEqual([
      'blob:https://example.org/owned-blob-1',
      'blob:https://example.org/owned-blob-2',
      'blob:https://example.org/owned-blob-3',
    ]);
  });

  it('18. renders exact bilingual editorial separation notices in Arabic (RTL) and English (LTR) and uses only canonical contract values', () => {
    const snapshot = makeSnapshotForDtos([makeFoundAssetDto({ assetId: 'img_bilingual_01' })]);

    const arHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        articleId: 'article_101',
        isAr: true,
        initialSnapshot: snapshot,
      })
    );

    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('data-testid="editorial-image-rights-separation-notice"');
    expect(arHtml).toContain(EDITORIAL_SEPARATION_NOTICE_AR);
    expect(arHtml).toContain('اعتماد حقوق الصورة مستقل عن الموافقة على نشر الخبر.');

    const enHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: OWNER_USER,
        articleId: 'article_101',
        isAr: false,
        initialSnapshot: snapshot,
      })
    );

    expect(enHtml).toContain('dir="ltr"');
    expect(enHtml).toContain('data-testid="editorial-image-rights-separation-notice"');
    expect(enHtml).toContain(EDITORIAL_SEPARATION_NOTICE_EN);
    expect(enHtml).toContain('Image rights approval is independent of article publication approval.');

    expect(CANONICAL_LICENSE_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'OriginalWork',
      'DirectLicense',
      'CreativeCommons',
      'PublicDomainClaim',
      'ContextSpecificAssessment',
      'Other',
    ]);
    expect(CANONICAL_USAGE_SCOPE_OPTIONS.map((o) => o.value)).toEqual([
      'ArticleRestricted',
      'GeneralEditorial',
    ]);
  });

  it('19. preserves existing news-existing-asset-placeholder and news-existing-asset-id test IDs in AdminNewsManagement.tsx', () => {
    const adminNewsSource = readFileSync(
      resolve(__dirname, './AdminNewsManagement.tsx'),
      'utf8'
    );

    expect(adminNewsSource).toContain('data-testid="news-existing-asset-placeholder"');
    expect(adminNewsSource).toContain('data-testid="news-existing-asset-id"');
    expect(adminNewsSource).toContain('data-testid="news-open-image-rights-panel-btn"');
    expect(adminNewsSource).toContain('<EditorialImageRightsReviewPanel');
  });
});
