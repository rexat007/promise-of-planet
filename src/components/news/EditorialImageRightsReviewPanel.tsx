import { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileWarning,
  RefreshCw,
  Image as ImageIcon,
  Lock,
  Plus,
  Ban,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminPermission, AdminRole, type AdminUser } from '../../types/admin';
import {
  CANONICAL_EVIDENCE_SOURCE_KINDS,
  MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS,
  NewsAdminClient,
  type EditorialImageAssetRightsAuditEvent,
  type EditorialImageRightsDecisionInput,
  type EditorialImageRightsEvidenceRecord,
  type EditorialImageRightsEvidenceSourceKind,
  type EditorialImageRightsReviewRequestRecord,
  type FoundEditorialImageRightsAdminDto,
  type GetEditorialImageRightsResponseDto,
  type RegisterEditorialImageRightsEvidenceInput,
  type RegisterImageRightsEvidenceResponseDto,
  type RevokeEditorialImageRightsEvidenceInput,
  type RevokeImageRightsEvidenceResponseDto,
  type RightsDecisionTargetStatus,
  type SanitizedEditorialImageRightsAdminDto,
  type SubmitEditorialImageRightsReviewRequestInput,
  type SubmitImageRightsReviewRequestResponseDto,
  type TransitionImageRightsResponseDto,
} from '../../services/newsAdminClient';
import {
  EditorialImagePreviewService,
  extractPersistedEditorialImageAssetIds,
  isValidPersistedPreviewAssetId,
  type FetchEditorialImagePreviewOutcome,
} from '../../services/editorialImagePreviewService';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetValidationLimits,
  type EditorialImageLicenseType,
  type EditorialImageUsageScope,
  type EditorialImageUsageScopeType,
  type RightsReviewStatus,
} from '../../types/editorialImageAsset';
import {
  validateEditorialImageRights,
  validateEditorialImageUsageScope,
} from '../../services/editorialImageAssetContract';
import {
  createOwnedPreviewUrlRegistry,
  isSafeRuntimePreviewUrl,
  type OwnedPreviewUrlRegistry,
} from './editor/editorialImageExtension';

export const EDITORIAL_SEPARATION_NOTICE_AR =
  'اعتماد حقوق الصورة مستقل عن الموافقة على نشر الخبر.' as const;
export const EDITORIAL_SEPARATION_NOTICE_EN =
  'Image rights approval is independent of article publication approval.' as const;

export const CANONICAL_LICENSE_TYPE_OPTIONS: readonly {
  readonly value: EditorialImageLicenseType;
  readonly labelAr: string;
  readonly labelEn: string;
}[] = [
  {
    value: 'OriginalWork',
    labelAr: 'عمل أصلي للمنصة (OriginalWork)',
    labelEn: 'Original Work (OriginalWork)',
  },
  {
    value: 'DirectLicense',
    labelAr: 'ترخيص مباشر موثق (DirectLicense)',
    labelEn: 'Direct License (DirectLicense)',
  },
  {
    value: 'CreativeCommons',
    labelAr: 'مشاع إبداعي محدد (CreativeCommons)',
    labelEn: 'Creative Commons (CreativeCommons)',
  },
  {
    value: 'PublicDomainClaim',
    labelAr: 'ملكية عامة موثقة (PublicDomainClaim)',
    labelEn: 'Public Domain Claim (PublicDomainClaim)',
  },
  {
    value: 'ContextSpecificAssessment',
    labelAr: 'تقييم سياقي مقيد بالمقال (ContextSpecificAssessment)',
    labelEn: 'Context-Specific Assessment (ContextSpecificAssessment)',
  },
  {
    value: 'Other',
    labelAr: 'ترخيص آخر موثق (Other)',
    labelEn: 'Other Documented License (Other)',
  },
] as const;

export const CANONICAL_USAGE_SCOPE_OPTIONS: readonly {
  readonly value: EditorialImageUsageScopeType;
  readonly labelAr: string;
  readonly labelEn: string;
}[] = [
  {
    value: 'ArticleRestricted',
    labelAr: 'مقيد بمقالات محددة (ArticleRestricted)',
    labelEn: 'Article Restricted (ArticleRestricted)',
  },
  {
    value: 'GeneralEditorial',
    labelAr: 'استخدام تحريري عام (GeneralEditorial)',
    labelEn: 'General Editorial (GeneralEditorial)',
  },
] as const;

export const EVIDENCE_SOURCE_KIND_LABELS: Readonly<
  Record<
    EditorialImageRightsEvidenceSourceKind,
    { readonly labelAr: string; readonly labelEn: string }
  >
> = {
  SignedLicenseAgreement: {
    labelAr: 'اتفاقية ترخيص موقعة (SignedLicenseAgreement)',
    labelEn: 'Signed License Agreement',
  },
  PhotographerWrittenRelease: {
    labelAr: 'إقرار خطي من المصور (PhotographerWrittenRelease)',
    labelEn: 'Photographer Written Release',
  },
  AgencyContractRecord: {
    labelAr: 'سجل تعاقد وكالة (AgencyContractRecord)',
    labelEn: 'Agency Contract Record',
  },
  PublicDomainArchivalRecord: {
    labelAr: 'سجل أرشيفي للملكية العامة (PublicDomainArchivalRecord)',
    labelEn: 'Public Domain Archival Record',
  },
  EditorialExceptionMemo: {
    labelAr: 'مذكرة استثناء تحريري (EditorialExceptionMemo)',
    labelEn: 'Editorial Exception Memo',
  },
};

export type DiscoveredEditorialImageRole = 'cover' | 'inline' | 'both';

export interface DiscoveredEditorialImageEntry {
  readonly assetId: string;
  readonly role: DiscoveredEditorialImageRole;
}

export interface EditorialImageDiscoveryInput {
  readonly featuredImage?: unknown;
  readonly richBodyAr?: unknown;
  readonly richBodyEn?: unknown;
  readonly unsavedLocalAssetIds?: ReadonlySet<string> | readonly string[];
  readonly maxBatchSize?: number;
  readonly limits?: EditorialImageAssetValidationLimits;
}

export interface EditorialImageDiscoveryResult {
  readonly allAssets: readonly DiscoveredEditorialImageEntry[];
  readonly batchAssets: readonly DiscoveredEditorialImageEntry[];
  readonly batchAssetIds: readonly string[];
  readonly excessAssetIds: readonly string[];
  readonly hasExcessAssets: boolean;
  readonly isCompleteArticleReviewClaimable: boolean;
}

/**
 * Pure canonical discovery helper that collects persisted editorial image `assetId`s
 * from `featuredImage`, `richBodyAr`, and `richBodyEn`.
 *
 * - Uses `isValidPersistedPreviewAssetId` and `extractPersistedEditorialImageAssetIds`.
 * - Excludes legacy external URLs (`https://...`), `blob:`, `data:`, invalid identifiers,
 *   missing values, and unsaved local session-only preview assetIds.
 * - Deduplicates repeated `assetId`s and computes each asset's role (`cover` | `inline` | `both`).
 * - Enforces the 20-asset batch boundary without silently omitting excess assets.
 */
export function discoverPersistedEditorialImageAssets(
  input: EditorialImageDiscoveryInput
): EditorialImageDiscoveryResult {
  const limits = input.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;
  const maxBatch =
    typeof input.maxBatchSize === 'number' &&
    Number.isInteger(input.maxBatchSize) &&
    input.maxBatchSize > 0
      ? Math.min(input.maxBatchSize, MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS)
      : MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS;

  const unsavedSet = new Set<string>(
    input.unsavedLocalAssetIds ? Array.from(input.unsavedLocalAssetIds) : []
  );

  const rawFeatured = input.featuredImage;
  const validCoverAssetId =
    isValidPersistedPreviewAssetId(rawFeatured, limits) &&
    !unsavedSet.has(rawFeatured)
      ? rawFeatured
      : null;

  const inlineIds = extractPersistedEditorialImageAssetIds(
    input.richBodyAr,
    input.richBodyEn,
    limits
  ).filter((id) => !unsavedSet.has(id));

  const inlineSet = new Set<string>(inlineIds);
  const allAssets: DiscoveredEditorialImageEntry[] = [];
  const added = new Set<string>();

  if (validCoverAssetId) {
    allAssets.push({
      assetId: validCoverAssetId,
      role: inlineSet.has(validCoverAssetId) ? 'both' : 'cover',
    });
    added.add(validCoverAssetId);
  }

  for (const inlineId of inlineIds) {
    if (!added.has(inlineId)) {
      allAssets.push({
        assetId: inlineId,
        role: 'inline',
      });
      added.add(inlineId);
    }
  }

  const batchAssets = allAssets.slice(0, maxBatch);
  const batchAssetIds = batchAssets.map((a) => a.assetId);
  const excessAssetIds = allAssets.slice(maxBatch).map((a) => a.assetId);
  const hasExcessAssets = excessAssetIds.length > 0;

  return {
    allAssets,
    batchAssets,
    batchAssetIds,
    excessAssetIds,
    hasExcessAssets,
    isCompleteArticleReviewClaimable: !hasExcessAssets,
  };
}

export function isAllowedImageRightsTransition(
  fromStatus: RightsReviewStatus | 'NOT_FOUND',
  toStatus: RightsDecisionTargetStatus
): boolean {
  if (fromStatus === 'PendingReview') {
    return toStatus === 'Approved' || toStatus === 'Rejected';
  }
  if (fromStatus === 'Approved') {
    return toStatus === 'Revoked';
  }
  if (fromStatus === 'Rejected' || fromStatus === 'Revoked') {
    return toStatus === 'Approved';
  }
  return false;
}

export interface SelfApprovalEvaluation {
  readonly isUploader: boolean;
  readonly isSelfApprovalForbidden: boolean;
  readonly isOwnerSelfApprovalException: boolean;
}

export function evaluateImageRightsSelfApproval(
  currentUser: AdminUser,
  createdByUid: string | null | undefined
): SelfApprovalEvaluation {
  if (
    !createdByUid ||
    typeof currentUser?.id !== 'string' ||
    currentUser.id.trim().length === 0
  ) {
    return {
      isUploader: false,
      isSelfApprovalForbidden: false,
      isOwnerSelfApprovalException: false,
    };
  }

  const isUploader = currentUser.id === createdByUid;
  if (!isUploader) {
    return {
      isUploader: false,
      isSelfApprovalForbidden: false,
      isOwnerSelfApprovalException: false,
    };
  }

  if (currentUser.role === AdminRole.Owner) {
    return {
      isUploader: true,
      isSelfApprovalForbidden: false,
      isOwnerSelfApprovalException: true,
    };
  }

  return {
    isUploader: true,
    isSelfApprovalForbidden: true,
    isOwnerSelfApprovalException: false,
  };
}

export type ContextualRightsActionMode =
  | 'none'
  | 'registerEvidence'
  | 'revokeEvidence'
  | 'submitReviewRequest'
  | 'approve'
  | 'reject'
  | 'revoke';

export interface RegisterEvidenceFormState {
  readonly sourceKind: EditorialImageRightsEvidenceSourceKind;
  readonly sourceReference: string;
  readonly summary: string;
  readonly artifactSha256: string;
  readonly evidenceId: string;
}

export interface RevokeEvidenceFormState {
  readonly evidenceId: string;
  readonly revocationReason: string;
}

export interface SubmitReviewRequestFormState {
  readonly rationale: string;
  readonly submittedEvidenceRefsInput: string;
}

export interface ApproveRightsFormState {
  readonly licenseType: EditorialImageLicenseType;
  readonly licenseDetails: string;
  readonly rightsHolder: string;
  readonly documentedException: string;
  readonly sourceAttributionAr: string;
  readonly sourceAttributionEn: string;
  readonly usageScopeType: EditorialImageUsageScopeType;
  readonly restrictedArticleIdsInput: string;
  readonly evidenceRefsInput: string;
  readonly reviewRequestId: string;
  readonly reviewReason: string;
}

export interface ReasonOnlyDecisionFormState {
  readonly reviewReason: string;
}

export interface AssetContextualFormBundle {
  readonly activeMode: ContextualRightsActionMode;
  readonly registerEvidence: RegisterEvidenceFormState;
  readonly revokeEvidence: RevokeEvidenceFormState;
  readonly submitReviewRequest: SubmitReviewRequestFormState;
  readonly approve: ApproveRightsFormState;
  readonly reject: ReasonOnlyDecisionFormState;
  readonly revoke: ReasonOnlyDecisionFormState;
  readonly actionError: string | null;
  readonly actionSuccess: string | null;
  readonly conflictMessage: string | null;
  readonly isSubmitting: boolean;
}

export function createInitialAssetFormBundle(
  dto: SanitizedEditorialImageRightsAdminDto | undefined,
  defaultArticleId?: string
): AssetContextualFormBundle {
  const foundDto: FoundEditorialImageRightsAdminDto | null =
    dto && dto.found ? dto : null;
  const rights = foundDto?.rights ?? null;
  const asset = foundDto?.asset ?? null;

  const initialScopeType: EditorialImageUsageScopeType =
    rights?.usageScope?.scopeType === 'GeneralEditorial'
      ? 'GeneralEditorial'
      : 'ArticleRestricted';

  const initialArticleIds =
    rights?.usageScope?.articleIds && rights.usageScope.articleIds.length > 0
      ? rights.usageScope.articleIds.join(', ')
      : defaultArticleId && defaultArticleId.trim().length > 0
        ? defaultArticleId.trim()
        : asset?.associatedArticleIds && asset.associatedArticleIds.length > 0
          ? asset.associatedArticleIds.join(', ')
          : '';

  return {
    activeMode: 'none',
    registerEvidence: {
      sourceKind: 'SignedLicenseAgreement',
      sourceReference: '',
      summary: '',
      artifactSha256: '',
      evidenceId: '',
    },
    revokeEvidence: {
      evidenceId: rights?.evidenceRefs?.[0] ?? '',
      revocationReason: '',
    },
    submitReviewRequest: {
      rationale: '',
      submittedEvidenceRefsInput: '',
    },
    approve: {
      licenseType: rights?.licenseType ?? 'OriginalWork',
      licenseDetails: rights?.licenseDetails ?? asset?.licensingInfo ?? '',
      rightsHolder: rights?.rightsHolder ?? asset?.photographerCredit ?? '',
      documentedException: rights?.documentedException ?? '',
      sourceAttributionAr:
        rights?.sourceAttributionAr ?? asset?.photographerCredit ?? '',
      sourceAttributionEn: rights?.sourceAttributionEn ?? '',
      usageScopeType: initialScopeType,
      restrictedArticleIdsInput: initialArticleIds,
      evidenceRefsInput: rights?.evidenceRefs
        ? rights.evidenceRefs.join(', ')
        : '',
      reviewRequestId: '',
      reviewReason: '',
    },
    reject: {
      reviewReason: '',
    },
    revoke: {
      reviewReason: '',
    },
    actionError: null,
    actionSuccess: null,
    conflictMessage: null,
    isSubmitting: false,
  };
}

export interface EditorialImageRightsClientAdapter {
  getEditorialImageRights(
    assetIds: readonly string[]
  ): Promise<GetEditorialImageRightsResponseDto>;
  registerImageRightsEvidence(
    input: RegisterEditorialImageRightsEvidenceInput
  ): Promise<RegisterImageRightsEvidenceResponseDto>;
  revokeImageRightsEvidence(
    input: RevokeEditorialImageRightsEvidenceInput
  ): Promise<RevokeImageRightsEvidenceResponseDto>;
  submitImageRightsReviewRequest(
    input: SubmitEditorialImageRightsReviewRequestInput
  ): Promise<SubmitImageRightsReviewRequestResponseDto>;
  transitionImageRights(
    decision: EditorialImageRightsDecisionInput
  ): Promise<TransitionImageRightsResponseDto>;
}

const defaultRightsClientAdapter: EditorialImageRightsClientAdapter = {
  getEditorialImageRights: (assetIds) =>
    NewsAdminClient.getEditorialImageRights(assetIds),
  registerImageRightsEvidence: (input) =>
    NewsAdminClient.registerImageRightsEvidence(input),
  revokeImageRightsEvidence: (input) =>
    NewsAdminClient.revokeImageRightsEvidence(input),
  submitImageRightsReviewRequest: (input) =>
    NewsAdminClient.submitImageRightsReviewRequest(input),
  transitionImageRights: (decision) =>
    NewsAdminClient.transitionImageRights(decision),
};

export interface EditorialImageRightsPanelSnapshot {
  readonly discovery: EditorialImageDiscoveryResult;
  readonly canView: boolean;
  readonly canManageRights: boolean;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly assetsById: Readonly<
    Record<string, SanitizedEditorialImageRightsAdminDto>
  >;
  readonly previewUrlsByAssetId: Readonly<Record<string, string>>;
  readonly previewErrorsByAssetId: Readonly<Record<string, string>>;
  readonly formsByAssetId: Readonly<Record<string, AssetContextualFormBundle>>;
  readonly sessionEvidenceByAssetId: Readonly<
    Record<string, readonly EditorialImageRightsEvidenceRecord[]>
  >;
  readonly sessionReviewRequestsByAssetId: Readonly<
    Record<string, EditorialImageRightsReviewRequestRecord>
  >;
  readonly sessionAuditEventsByAssetId: Readonly<
    Record<string, readonly EditorialImageAssetRightsAuditEvent[]>
  >;
  readonly generation: number;
}

export interface EditorialImageRightsPanelControllerOptions {
  readonly currentUser: AdminUser;
  readonly articleId?: string;
  readonly isAr?: boolean;
  readonly clientAdapter?: EditorialImageRightsClientAdapter;
  readonly fetchPreview?: (options: {
    readonly assetId: string;
    readonly signal?: AbortSignal;
  }) => Promise<FetchEditorialImagePreviewOutcome>;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly onSnapshotChange?: (snapshot: EditorialImageRightsPanelSnapshot) => void;
}

function isRevisionConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as { code?: unknown })?.code;
  return (
    /CONFLICT/i.test(msg) ||
    /Revision conflict/i.test(msg) ||
    /expectedRevision/i.test(msg) ||
    /aborted/i.test(msg) ||
    (typeof code === 'string' && /aborted|conflict/i.test(code))
  );
}

function parseDelimitedIds(raw: string): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const trimmed = part.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

export interface EditorialImageRightsPanelController {
  getSnapshot(): EditorialImageRightsPanelSnapshot;
  getPreviewRegistry(): OwnedPreviewUrlRegistry;
  loadForDiscovery(
    input: EditorialImageDiscoveryInput
  ): Promise<EditorialImageRightsPanelSnapshot>;
  refreshAuthoritativeBatch(): Promise<EditorialImageRightsPanelSnapshot>;
  setActiveActionMode(
    assetId: string,
    mode: ContextualRightsActionMode
  ): EditorialImageRightsPanelSnapshot;
  updateRegisterEvidenceForm(
    assetId: string,
    patch: Partial<RegisterEvidenceFormState>
  ): EditorialImageRightsPanelSnapshot;
  updateRevokeEvidenceForm(
    assetId: string,
    patch: Partial<RevokeEvidenceFormState>
  ): EditorialImageRightsPanelSnapshot;
  updateSubmitReviewRequestForm(
    assetId: string,
    patch: Partial<SubmitReviewRequestFormState>
  ): EditorialImageRightsPanelSnapshot;
  updateApproveForm(
    assetId: string,
    patch: Partial<ApproveRightsFormState>
  ): EditorialImageRightsPanelSnapshot;
  updateRejectForm(
    assetId: string,
    patch: Partial<ReasonOnlyDecisionFormState>
  ): EditorialImageRightsPanelSnapshot;
  updateRevokeForm(
    assetId: string,
    patch: Partial<ReasonOnlyDecisionFormState>
  ): EditorialImageRightsPanelSnapshot;
  submitRegisterEvidence(
    assetId: string
  ): Promise<RegisterImageRightsEvidenceResponseDto | null>;
  submitRevokeEvidence(
    assetId: string
  ): Promise<RevokeImageRightsEvidenceResponseDto | null>;
  submitReviewRequest(
    assetId: string
  ): Promise<SubmitImageRightsReviewRequestResponseDto | null>;
  submitDecision(
    assetId: string,
    targetStatus: RightsDecisionTargetStatus
  ): Promise<TransitionImageRightsResponseDto | null>;
  dispose(): void;
}

export function createEditorialImageRightsPanelController(
  options: EditorialImageRightsPanelControllerOptions
): EditorialImageRightsPanelController {
  const client = options.clientAdapter ?? defaultRightsClientAdapter;
  const isAr = options.isAr ?? true;
  const fetchPreviewFn =
    options.fetchPreview ??
    ((req: { readonly assetId: string; readonly signal?: AbortSignal }) =>
      EditorialImagePreviewService.fetchPreviewImage(req));

  const createUrlFn =
    options.createObjectUrl ??
    ((blob: Blob) =>
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(blob)
        : '');

  const revokeUrlFn =
    options.revokeObjectUrl ??
    ((url: string) => {
      if (
        url &&
        typeof URL !== 'undefined' &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        URL.revokeObjectURL(url);
      }
    });

  const previewRegistry = createOwnedPreviewUrlRegistry((url: string) => {
    revokeUrlFn(url);
  });

  const canView =
    Boolean(options.currentUser?.isActive) &&
    AdminAccessService.hasPermission(options.currentUser, AdminPermission.View);
  const canManageRights =
    Boolean(options.currentUser?.isActive) &&
    AdminAccessService.hasPermission(
      options.currentUser,
      AdminPermission.ManageRights
    );

  let generation = 0;
  let activeAbortController: AbortController | null = null;
  let disposed = false;

  let currentDiscovery: EditorialImageDiscoveryResult =
    discoverPersistedEditorialImageAssets({});
  let loading = false;
  let loadError: string | null = null;
  let assetsById: Record<string, SanitizedEditorialImageRightsAdminDto> = {};
  let previewErrorsByAssetId: Record<string, string> = {};
  let formsByAssetId: Record<string, AssetContextualFormBundle> = {};
  let sessionEvidenceByAssetId: Record<
    string,
    EditorialImageRightsEvidenceRecord[]
  > = {};
  let sessionReviewRequestsByAssetId: Record<
    string,
    EditorialImageRightsReviewRequestRecord
  > = {};
  let sessionAuditEventsByAssetId: Record<
    string,
    EditorialImageAssetRightsAuditEvent[]
  > = {};

  const buildSnapshot = (): EditorialImageRightsPanelSnapshot => ({
    discovery: currentDiscovery,
    canView,
    canManageRights,
    loading,
    loadError,
    assetsById: { ...assetsById },
    previewUrlsByAssetId: previewRegistry.getPreviewMap(),
    previewErrorsByAssetId: { ...previewErrorsByAssetId },
    formsByAssetId: { ...formsByAssetId },
    sessionEvidenceByAssetId: { ...sessionEvidenceByAssetId },
    sessionReviewRequestsByAssetId: { ...sessionReviewRequestsByAssetId },
    sessionAuditEventsByAssetId: { ...sessionAuditEventsByAssetId },
    generation,
  });

  const emit = (): EditorialImageRightsPanelSnapshot => {
    const snap = buildSnapshot();
    if (!disposed) {
      options.onSnapshotChange?.(snap);
    }
    return snap;
  };

  const ensureFormBundle = (assetId: string): AssetContextualFormBundle => {
    if (!formsByAssetId[assetId]) {
      formsByAssetId[assetId] = createInitialAssetFormBundle(
        assetsById[assetId],
        options.articleId
      );
    }
    return formsByAssetId[assetId];
  };

  const updateFormBundle = (
    assetId: string,
    updater: (prev: AssetContextualFormBundle) => AssetContextualFormBundle
  ): EditorialImageRightsPanelSnapshot => {
    const current = ensureFormBundle(assetId);
    formsByAssetId = {
      ...formsByAssetId,
      [assetId]: updater(current),
    };
    return emit();
  };

  const loadPreviewsForBatch = async (
    batchIds: readonly string[],
    expectedGen: number,
    signal: AbortSignal
  ): Promise<void> => {
    await Promise.all(
      batchIds.map(async (assetId) => {
        if (disposed || generation !== expectedGen || signal.aborted) {
          return;
        }

        let outcome: FetchEditorialImagePreviewOutcome;
        try {
          outcome = await fetchPreviewFn({ assetId, signal });
        } catch {
          if (!disposed && generation === expectedGen && !signal.aborted) {
            previewErrorsByAssetId = {
              ...previewErrorsByAssetId,
              [assetId]: 'NETWORK_ERROR',
            };
            emit();
          }
          return;
        }

        if (disposed || generation !== expectedGen || signal.aborted) {
          return;
        }

        if (!outcome.ok) {
          if (outcome.errorCode !== 'REQUEST_ABORTED') {
            previewErrorsByAssetId = {
              ...previewErrorsByAssetId,
              [assetId]: outcome.errorCode,
            };
            emit();
          }
          return;
        }

        let createdUrl = '';
        try {
          createdUrl = createUrlFn(outcome.blob);
        } catch {
          previewErrorsByAssetId = {
            ...previewErrorsByAssetId,
            [assetId]: 'OBJECT_URL_CREATION_FAILED',
          };
          emit();
          return;
        }

        if (!isSafeRuntimePreviewUrl(createdUrl)) {
          if (createdUrl) {
            try {
              revokeUrlFn(createdUrl);
            } catch {
              // ignore
            }
          }
          previewErrorsByAssetId = {
            ...previewErrorsByAssetId,
            [assetId]: 'OBJECT_URL_CREATION_FAILED',
          };
          emit();
          return;
        }

        if (disposed || generation !== expectedGen || signal.aborted) {
          try {
            revokeUrlFn(createdUrl);
          } catch {
            // ignore
          }
          return;
        }

        previewRegistry.registerOwnedPreviewUrl(assetId, createdUrl);
        if (
          !previewRegistry.isUrlOwned(assetId) ||
          previewRegistry.getPreviewMap()[assetId] !== createdUrl
        ) {
          try {
            revokeUrlFn(createdUrl);
          } catch {
            // ignore
          }
          return;
        }

        const nextErrors = { ...previewErrorsByAssetId };
        delete nextErrors[assetId];
        previewErrorsByAssetId = nextErrors;
        emit();
      })
    );
  };

  const fetchBatchRightsInternal = async (
    batchIds: readonly string[],
    expectedGen: number,
    preserveExistingForms: boolean
  ): Promise<void> => {
    if (batchIds.length === 0 || !canView) {
      loading = false;
      emit();
      return;
    }

    loading = true;
    loadError = null;
    emit();

    try {
      const response = await client.getEditorialImageRights(batchIds);
      if (disposed || generation !== expectedGen) {
        return;
      }

      assetsById = { ...response.assetsById };
      const nextForms: Record<string, AssetContextualFormBundle> =
        preserveExistingForms ? { ...formsByAssetId } : {};

      for (const id of batchIds) {
        if (!nextForms[id]) {
          nextForms[id] = createInitialAssetFormBundle(
            assetsById[id],
            options.articleId
          );
        }
      }
      formsByAssetId = nextForms;
      loading = false;
      loadError = null;
      emit();
    } catch (err: unknown) {
      if (disposed || generation !== expectedGen) {
        return;
      }
      loading = false;
      const rawMsg = err instanceof Error ? err.message : '';
      loadError =
        rawMsg ||
        (isAr
          ? 'تعذر استرجاع حالة حقوق الصور من الخادم.'
          : 'Failed to retrieve image rights status from server.');
      emit();
    }
  };

  const loadForDiscovery = async (
    input: EditorialImageDiscoveryInput
  ): Promise<EditorialImageRightsPanelSnapshot> => {
    generation += 1;
    const expectedGen = generation;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    previewRegistry.revokeAllOwnedPreviewUrls();

    currentDiscovery = discoverPersistedEditorialImageAssets(input);
    assetsById = {};
    previewErrorsByAssetId = {};
    formsByAssetId = {};
    sessionEvidenceByAssetId = {};
    sessionReviewRequestsByAssetId = {};
    sessionAuditEventsByAssetId = {};
    loadError = null;

    if (!canView || currentDiscovery.batchAssetIds.length === 0) {
      loading = false;
      return emit();
    }

    const abortController = new AbortController();
    activeAbortController = abortController;

    await Promise.all([
      fetchBatchRightsInternal(
        currentDiscovery.batchAssetIds,
        expectedGen,
        false
      ),
      loadPreviewsForBatch(
        currentDiscovery.batchAssetIds,
        expectedGen,
        abortController.signal
      ),
    ]);

    return buildSnapshot();
  };

  const refreshAuthoritativeBatch =
    async (): Promise<EditorialImageRightsPanelSnapshot> => {
      const expectedGen = generation;
      if (!canView || currentDiscovery.batchAssetIds.length === 0) {
        return buildSnapshot();
      }
      await fetchBatchRightsInternal(
        currentDiscovery.batchAssetIds,
        expectedGen,
        true
      );
      return buildSnapshot();
    };

  const setActiveActionMode = (
    assetId: string,
    mode: ContextualRightsActionMode
  ): EditorialImageRightsPanelSnapshot => {
    return updateFormBundle(assetId, (prev) => ({
      ...prev,
      activeMode: prev.activeMode === mode ? 'none' : mode,
      actionError: null,
      conflictMessage: null,
    }));
  };

  const updateRegisterEvidenceForm = (
    assetId: string,
    patch: Partial<RegisterEvidenceFormState>
  ): EditorialImageRightsPanelSnapshot =>
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      registerEvidence: { ...prev.registerEvidence, ...patch },
      actionError: null,
    }));

  const updateRevokeEvidenceForm = (
    assetId: string,
    patch: Partial<RevokeEvidenceFormState>
  ): EditorialImageRightsPanelSnapshot =>
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      revokeEvidence: { ...prev.revokeEvidence, ...patch },
      actionError: null,
    }));

  const updateSubmitReviewRequestForm = (
    assetId: string,
    patch: Partial<SubmitReviewRequestFormState>
  ): EditorialImageRightsPanelSnapshot =>
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      submitReviewRequest: { ...prev.submitReviewRequest, ...patch },
      actionError: null,
    }));

  const updateApproveForm = (
    assetId: string,
    patch: Partial<ApproveRightsFormState>
  ): EditorialImageRightsPanelSnapshot =>
    updateFormBundle(assetId, (prev) => {
      const nextApprove = { ...prev.approve, ...patch };
      if (nextApprove.licenseType === 'ContextSpecificAssessment') {
        nextApprove.usageScopeType = 'ArticleRestricted';
      }
      return {
        ...prev,
        approve: nextApprove,
        actionError: null,
      };
    });

  const updateRejectForm = (
    assetId: string,
    patch: Partial<ReasonOnlyDecisionFormState>
  ): EditorialImageRightsPanelSnapshot =>
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      reject: { ...prev.reject, ...patch },
      actionError: null,
    }));

  const updateRevokeForm = (
    assetId: string,
    patch: Partial<ReasonOnlyDecisionFormState>
  ): EditorialImageRightsPanelSnapshot =>
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      revoke: { ...prev.revoke, ...patch },
      actionError: null,
    }));

  const submitRegisterEvidence = async (
    assetId: string
  ): Promise<RegisterImageRightsEvidenceResponseDto | null> => {
    if (!canManageRights) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'صلاحية إدارة الحقوق (ManageRights) مطلوبة لتسجيل الأدلة.'
          : 'ManageRights permission is required to register evidence.',
      }));
      return null;
    }

    const bundle = ensureFormBundle(assetId);
    if (bundle.isSubmitting) return null;

    const form = bundle.registerEvidence;
    const trimmedSourceRef = form.sourceReference.trim();
    const trimmedSummary = form.summary.trim();
    const trimmedSha = form.artifactSha256.trim();
    const trimmedEvidenceId = form.evidenceId.trim();

    if (!trimmedSourceRef || !trimmedSummary) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'يرجى إدخال مرجع المصدر وملخص دليل الحقوق.'
          : 'Please provide both source reference and evidence summary.',
      }));
      return null;
    }

    const payload: RegisterEditorialImageRightsEvidenceInput = {
      assetId,
      sourceKind: form.sourceKind,
      sourceReference: trimmedSourceRef,
      summary: trimmedSummary,
      ...(trimmedSha ? { artifactSha256: trimmedSha } : {}),
      ...(trimmedEvidenceId ? { evidenceId: trimmedEvidenceId } : {}),
    };

    const callGen = generation;
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      isSubmitting: true,
      actionError: null,
      actionSuccess: null,
      conflictMessage: null,
    }));

    try {
      const res = await client.registerImageRightsEvidence(payload);
      if (disposed || generation !== callGen) return null;

      const existingList = sessionEvidenceByAssetId[assetId] ?? [];
      sessionEvidenceByAssetId = {
        ...sessionEvidenceByAssetId,
        [assetId]: [...existingList, res.evidence],
      };

      updateFormBundle(assetId, (prev) => {
        const currentApproveRefs = parseDelimitedIds(
          prev.approve.evidenceRefsInput
        );
        if (!currentApproveRefs.includes(res.evidence.evidenceId)) {
          currentApproveRefs.push(res.evidence.evidenceId);
        }
        const currentReqRefs = parseDelimitedIds(
          prev.submitReviewRequest.submittedEvidenceRefsInput
        );
        if (!currentReqRefs.includes(res.evidence.evidenceId)) {
          currentReqRefs.push(res.evidence.evidenceId);
        }
        return {
          ...prev,
          isSubmitting: false,
          activeMode: 'none',
          registerEvidence: {
            sourceKind: 'SignedLicenseAgreement',
            sourceReference: '',
            summary: '',
            artifactSha256: '',
            evidenceId: '',
          },
          revokeEvidence: {
            ...prev.revokeEvidence,
            evidenceId:
              prev.revokeEvidence.evidenceId || res.evidence.evidenceId,
          },
          approve: {
            ...prev.approve,
            evidenceRefsInput: currentApproveRefs.join(', '),
          },
          submitReviewRequest: {
            ...prev.submitReviewRequest,
            submittedEvidenceRefsInput: currentReqRefs.join(', '),
          },
          actionSuccess: isAr
            ? `تم تسجيل دليل الحقوق بنجاح (${res.evidence.evidenceId}).`
            : `Rights evidence registered successfully (${res.evidence.evidenceId}).`,
        };
      });

      await refreshAuthoritativeBatch();
      return res;
    } catch (err: unknown) {
      if (disposed || generation !== callGen) return null;
      const msg =
        err instanceof Error
          ? err.message
          : isAr
            ? 'فشل تسجيل دليل الحقوق.'
            : 'Failed to register rights evidence.';
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        isSubmitting: false,
        actionError: msg,
      }));
      return null;
    }
  };

  const submitRevokeEvidence = async (
    assetId: string
  ): Promise<RevokeImageRightsEvidenceResponseDto | null> => {
    if (!canManageRights) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'صلاحية إدارة الحقوق (ManageRights) مطلوبة لإلغاء الأدلة.'
          : 'ManageRights permission is required to revoke evidence.',
      }));
      return null;
    }

    const bundle = ensureFormBundle(assetId);
    if (bundle.isSubmitting) return null;

    const trimmedId = bundle.revokeEvidence.evidenceId.trim();
    const trimmedReason = bundle.revokeEvidence.revocationReason.trim();
    if (!trimmedId || !trimmedReason) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'يرجى تحديد معرف الدليل وسبب الإلغاء.'
          : 'Please provide both the evidence ID and revocation reason.',
      }));
      return null;
    }

    const payload: RevokeEditorialImageRightsEvidenceInput = {
      evidenceId: trimmedId,
      assetId,
      revocationReason: trimmedReason,
    };

    const callGen = generation;
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      isSubmitting: true,
      actionError: null,
      actionSuccess: null,
      conflictMessage: null,
    }));

    try {
      const res = await client.revokeImageRightsEvidence(payload);
      if (disposed || generation !== callGen) return null;

      const existingList = sessionEvidenceByAssetId[assetId] ?? [];
      const updatedList = existingList.some(
        (e) => e.evidenceId === res.evidence.evidenceId
      )
        ? existingList.map((e) =>
            e.evidenceId === res.evidence.evidenceId ? res.evidence : e
          )
        : [...existingList, res.evidence];

      sessionEvidenceByAssetId = {
        ...sessionEvidenceByAssetId,
        [assetId]: updatedList,
      };

      updateFormBundle(assetId, (prev) => {
        const remainingApproveRefs = parseDelimitedIds(
          prev.approve.evidenceRefsInput
        ).filter((id) => id !== res.evidence.evidenceId);
        const remainingReqRefs = parseDelimitedIds(
          prev.submitReviewRequest.submittedEvidenceRefsInput
        ).filter((id) => id !== res.evidence.evidenceId);

        return {
          ...prev,
          isSubmitting: false,
          activeMode: 'none',
          revokeEvidence: {
            evidenceId: '',
            revocationReason: '',
          },
          approve: {
            ...prev.approve,
            evidenceRefsInput: remainingApproveRefs.join(', '),
          },
          submitReviewRequest: {
            ...prev.submitReviewRequest,
            submittedEvidenceRefsInput: remainingReqRefs.join(', '),
          },
          actionSuccess: isAr
            ? `تم إلغاء دليل الحقوق (${res.evidence.evidenceId}) بنجاح.`
            : `Rights evidence (${res.evidence.evidenceId}) revoked successfully.`,
        };
      });

      await refreshAuthoritativeBatch();
      return res;
    } catch (err: unknown) {
      if (disposed || generation !== callGen) return null;
      const msg =
        err instanceof Error
          ? err.message
          : isAr
            ? 'فشل إلغاء دليل الحقوق.'
            : 'Failed to revoke rights evidence.';
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        isSubmitting: false,
        actionError: msg,
      }));
      return null;
    }
  };

  const submitReviewRequest = async (
    assetId: string
  ): Promise<SubmitImageRightsReviewRequestResponseDto | null> => {
    if (!canManageRights) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'صلاحية إدارة الحقوق (ManageRights) مطلوبة لتقديم طلب إعادة المراجعة.'
          : 'ManageRights permission is required to submit a review request.',
      }));
      return null;
    }

    const dto = assetsById[assetId];
    if (!dto || !dto.found || dto.revision === null) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'سجل الأصل غير متاح لتقديم طلب مراجعة.'
          : 'Asset record is unavailable for review request submission.',
      }));
      return null;
    }

    if (
      dto.rights.status !== 'Rejected' &&
      dto.rights.status !== 'Revoked'
    ) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'طلبات إعادة المراجعة متاحة فقط للأصول المرفوضة (Rejected) أو الملغاة (Revoked).'
          : 'Review requests are only permitted for assets in Rejected or Revoked status.',
      }));
      return null;
    }

    const bundle = ensureFormBundle(assetId);
    if (bundle.isSubmitting) return null;

    const trimmedRationale = bundle.submitReviewRequest.rationale.trim();
    const submittedEvidenceRefs = parseDelimitedIds(
      bundle.submitReviewRequest.submittedEvidenceRefsInput
    );

    if (!trimmedRationale || submittedEvidenceRefs.length === 0) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'يتطلب طلب إعادة المراجعة مبرراً موثقاً ودليل حقوق نشط واحد على الأقل.'
          : 'Review request requires a documented rationale and at least one active evidence reference.',
      }));
      return null;
    }

    const payload: SubmitEditorialImageRightsReviewRequestInput = {
      assetId,
      expectedRevision: dto.revision,
      rationale: trimmedRationale,
      submittedEvidenceRefs,
    };

    const callGen = generation;
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      isSubmitting: true,
      actionError: null,
      actionSuccess: null,
      conflictMessage: null,
    }));

    try {
      const res = await client.submitImageRightsReviewRequest(payload);
      if (disposed || generation !== callGen) return null;

      sessionReviewRequestsByAssetId = {
        ...sessionReviewRequestsByAssetId,
        [assetId]: res.reviewRequest,
      };

      updateFormBundle(assetId, (prev) => {
        const mergedEvidence = Array.from(
          new Set([
            ...parseDelimitedIds(prev.approve.evidenceRefsInput),
            ...res.reviewRequest.submittedEvidenceRefs,
          ])
        );
        return {
          ...prev,
          isSubmitting: false,
          activeMode: 'approve',
          approve: {
            ...prev.approve,
            reviewRequestId: res.reviewRequest.requestId,
            evidenceRefsInput: mergedEvidence.join(', '),
          },
          actionSuccess: isAr
            ? `تم تقديم طلب إعادة المراجعة (${res.reviewRequest.requestId}) بنجاح عند المراجعة r${res.reviewRequest.assetRevision}.`
            : `Review request (${res.reviewRequest.requestId}) submitted at revision r${res.reviewRequest.assetRevision}.`,
        };
      });

      await refreshAuthoritativeBatch();
      return res;
    } catch (err: unknown) {
      if (disposed || generation !== callGen) return null;
      const isConflict = isRevisionConflictError(err);
      if (isConflict) {
        await refreshAuthoritativeBatch();
        const refreshedRev = assetsById[assetId]?.revision;
        updateFormBundle(assetId, (prev) => ({
          ...prev,
          isSubmitting: false,
          conflictMessage: isAr
            ? `تعارض في رقم المراجعة (تم تحديث المراجعة الحالية إلى r${refreshedRev ?? '—'}). تم الاحتفاظ بالبيانات المدخلة؛ يرجى المراجعة وإعادة الإرسال يدوياً.`
            : `Revision conflict detected (refreshed current revision to r${refreshedRev ?? '—'}). Your form inputs have been preserved; please verify and resubmit manually.`,
        }));
        return null;
      }

      const msg =
        err instanceof Error
          ? err.message
          : isAr
            ? 'فشل تقديم طلب إعادة المراجعة.'
            : 'Failed to submit review request.';
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        isSubmitting: false,
        actionError: msg,
      }));
      return null;
    }
  };

  const submitDecision = async (
    assetId: string,
    targetStatus: RightsDecisionTargetStatus
  ): Promise<TransitionImageRightsResponseDto | null> => {
    if (!canManageRights) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'صلاحية إدارة الحقوق (ManageRights) مطلوبة لاتخاذ قرارات الحقوق.'
          : 'ManageRights permission is required to execute rights decisions.',
      }));
      return null;
    }

    const dto = assetsById[assetId];
    if (!dto || !dto.found || dto.revision === null) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? 'سجل الأصل غير موجود على الخادم.'
          : 'Asset record was not found on the server.',
      }));
      return null;
    }

    if (!isAllowedImageRightsTransition(dto.rights.status, targetStatus)) {
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        actionError: isAr
          ? `الانتقال من الحالة "${dto.rights.status}" إلى "${targetStatus}" غير مسموح.`
          : `Transition from "${dto.rights.status}" to "${targetStatus}" is not permitted.`,
      }));
      return null;
    }

    const bundle = ensureFormBundle(assetId);
    if (bundle.isSubmitting) return null;

    let decision: EditorialImageRightsDecisionInput;

    if (targetStatus === 'Approved') {
      const selfEval = evaluateImageRightsSelfApproval(
        options.currentUser,
        dto.createdByUid
      );
      if (selfEval.isSelfApprovalForbidden) {
        updateFormBundle(assetId, (prev) => ({
          ...prev,
          actionError: isAr
            ? 'SELF_APPROVAL_FORBIDDEN: لا يُسمح بالموافقة الذاتية على حقوق صورة قمت برفعها بنفسك لغير دور المالك (Owner).'
            : 'SELF_APPROVAL_FORBIDDEN: Non-Owner accounts cannot self-approve editorial images they uploaded.',
        }));
        return null;
      }

      const appForm = bundle.approve;
      const trimmedReason = appForm.reviewReason.trim();
      const trimmedAttrAr = appForm.sourceAttributionAr.trim();
      const trimmedAttrEn = appForm.sourceAttributionEn.trim();
      const trimmedRightsHolder = appForm.rightsHolder.trim();
      const trimmedDocException = appForm.documentedException.trim();
      const trimmedLicenseDetails = appForm.licenseDetails.trim();
      const trimmedRequestId = appForm.reviewRequestId.trim();
      const evidenceRefs = parseDelimitedIds(appForm.evidenceRefsInput);

      const effectiveScopeType: EditorialImageUsageScopeType =
        appForm.licenseType === 'ContextSpecificAssessment'
          ? 'ArticleRestricted'
          : appForm.usageScopeType;

      const restrictedArticleIds = parseDelimitedIds(
        appForm.restrictedArticleIdsInput
      );

      const usageScope: EditorialImageUsageScope =
        effectiveScopeType === 'GeneralEditorial'
          ? { scopeType: 'GeneralEditorial' }
          : {
              scopeType: 'ArticleRestricted',
              articleIds: restrictedArticleIds,
            };

      const scopeValidation = validateEditorialImageUsageScope(
        usageScope,
        DEFAULT_ASSET_VALIDATION_LIMITS
      );
      if (!scopeValidation.valid) {
        updateFormBundle(assetId, (prev) => ({
          ...prev,
          actionError: isAr
            ? `نطاق الاستخدام غير صالح: ${scopeValidation.errors.join(' ')}`
            : `Invalid usageScope: ${scopeValidation.errors.join(' ')}`,
        }));
        return null;
      }

      const isReapproval =
        dto.rights.status === 'Rejected' || dto.rights.status === 'Revoked';
      if (isReapproval && !trimmedRequestId) {
        updateFormBundle(assetId, (prev) => ({
          ...prev,
          actionError: isAr
            ? 'REVIEW_REQUEST_REQUIRED: إعادة اعتماد صورة مرفوضة أو ملغاة يتطلب تقديم طلب إعادة مراجعة أولاً وتحديد معرف الطلب (reviewRequestId).'
            : 'REVIEW_REQUEST_REQUIRED: Re-approving a Rejected or Revoked image requires a submitted reviewRequestId.',
        }));
        return null;
      }

      const candidateRightsCheck = validateEditorialImageRights(
        {
          status: 'Approved',
          licenseType: appForm.licenseType,
          ...(trimmedLicenseDetails
            ? { licenseDetails: trimmedLicenseDetails }
            : {}),
          ...(trimmedRightsHolder ? { rightsHolder: trimmedRightsHolder } : {}),
          ...(trimmedDocException
            ? { documentedException: trimmedDocException }
            : {}),
          sourceAttributionAr: trimmedAttrAr,
          ...(trimmedAttrEn ? { sourceAttributionEn: trimmedAttrEn } : {}),
          evidenceRefs,
          usageScope,
          reviewedByUid: options.currentUser.id || 'reviewer_check',
          reviewedAtIso: new Date().toISOString(),
          reviewReason: trimmedReason,
        },
        DEFAULT_ASSET_VALIDATION_LIMITS
      );

      if (!candidateRightsCheck.valid) {
        updateFormBundle(assetId, (prev) => ({
          ...prev,
          actionError: candidateRightsCheck.errors.join(' '),
        }));
        return null;
      }

      decision = {
        assetId,
        expectedRevision: dto.revision,
        targetStatus: 'Approved',
        reviewReason: trimmedReason,
        licenseType: appForm.licenseType,
        ...(trimmedLicenseDetails
          ? { licenseDetails: trimmedLicenseDetails }
          : {}),
        ...(trimmedRightsHolder ? { rightsHolder: trimmedRightsHolder } : {}),
        ...(trimmedDocException
          ? { documentedException: trimmedDocException }
          : {}),
        sourceAttributionAr: trimmedAttrAr,
        ...(trimmedAttrEn ? { sourceAttributionEn: trimmedAttrEn } : {}),
        evidenceRefs,
        usageScope,
        ...(isReapproval && trimmedRequestId
          ? { reviewRequestId: trimmedRequestId }
          : {}),
      };
    } else if (targetStatus === 'Rejected') {
      const trimmedReason = bundle.reject.reviewReason.trim();
      if (!trimmedReason) {
        updateFormBundle(assetId, (prev) => ({
          ...prev,
          actionError: isAr
            ? 'يرجى إدخال سبب رفض حقوق الصورة.'
            : 'Please enter a rejection reason for image rights.',
        }));
        return null;
      }
      decision = {
        assetId,
        expectedRevision: dto.revision,
        targetStatus: 'Rejected',
        reviewReason: trimmedReason,
      };
    } else {
      const trimmedReason = bundle.revoke.reviewReason.trim();
      if (!trimmedReason) {
        updateFormBundle(assetId, (prev) => ({
          ...prev,
          actionError: isAr
            ? 'يرجى إدخال سبب إلغاء حقوق الصورة.'
            : 'Please enter a revocation reason for image rights.',
        }));
        return null;
      }
      decision = {
        assetId,
        expectedRevision: dto.revision,
        targetStatus: 'Revoked',
        reviewReason: trimmedReason,
      };
    }

    const callGen = generation;
    updateFormBundle(assetId, (prev) => ({
      ...prev,
      isSubmitting: true,
      actionError: null,
      actionSuccess: null,
      conflictMessage: null,
    }));

    try {
      const res = await client.transitionImageRights(decision);
      if (disposed || generation !== callGen) return null;

      const updatedDto: FoundEditorialImageRightsAdminDto = {
        assetId: res.record.assetId,
        found: true,
        revision: res.record.revision,
        status: res.record.asset.status,
        createdByUid: res.record.asset.createdByUid,
        rights: res.record.asset.rights,
        altAr: res.record.asset.altAr,
        ...(res.record.asset.altEn !== undefined
          ? { altEn: res.record.asset.altEn }
          : {}),
        ...(res.record.asset.captionAr !== undefined
          ? { captionAr: res.record.asset.captionAr }
          : {}),
        ...(res.record.asset.captionEn !== undefined
          ? { captionEn: res.record.asset.captionEn }
          : {}),
        originalFilename: res.record.asset.originalFilename,
        mimeType: res.record.asset.mimeType,
        originalWidth: res.record.asset.originalWidth,
        originalHeight: res.record.asset.originalHeight,
        aspectRatio: res.record.asset.aspectRatio,
        asset: res.record.asset,
      };

      assetsById = {
        ...assetsById,
        [assetId]: updatedDto,
      };

      const existingAudits = sessionAuditEventsByAssetId[assetId] ?? [];
      sessionAuditEventsByAssetId = {
        ...sessionAuditEventsByAssetId,
        [assetId]: [res.auditEvent, ...existingAudits],
      };

      if (res.consumedReviewRequest) {
        sessionReviewRequestsByAssetId = {
          ...sessionReviewRequestsByAssetId,
          [assetId]: res.consumedReviewRequest,
        };
      }

      updateFormBundle(assetId, (prev) => ({
        ...prev,
        isSubmitting: false,
        activeMode: 'none',
        approve: {
          ...prev.approve,
          reviewReason: '',
          reviewRequestId: '',
        },
        reject: { reviewReason: '' },
        revoke: { reviewReason: '' },
        conflictMessage: null,
        actionError: null,
        actionSuccess: isAr
          ? `تم تحديث حالة حقوق الصورة إلى ${res.record.asset.rights.status} (المراجعة r${res.record.revision} • سجل التدقيق ${res.auditEvent.id}).`
          : `Image rights transitioned to ${res.record.asset.rights.status} (revision r${res.record.revision} • audit ${res.auditEvent.id}).`,
      }));

      await refreshAuthoritativeBatch();
      return res;
    } catch (err: unknown) {
      if (disposed || generation !== callGen) return null;
      if (isRevisionConflictError(err)) {
        await refreshAuthoritativeBatch();
        const refreshedRev = assetsById[assetId]?.revision;
        updateFormBundle(assetId, (prev) => ({
          ...prev,
          isSubmitting: false,
          conflictMessage: isAr
            ? `تعارض في رقم المراجعة (تم تحديث المراجعة الحالية إلى r${refreshedRev ?? '—'}). تم الاحتفاظ ببيانات النموذج؛ يرجى المراجعة وإعادة الإرسال يدوياً.`
            : `Revision conflict detected (refreshed current revision to r${refreshedRev ?? '—'}). Your form data has been preserved; please verify and resubmit manually.`,
        }));
        return null;
      }

      const msg =
        err instanceof Error
          ? err.message
          : isAr
            ? 'فشل تحديث حالة حقوق الصورة.'
            : 'Failed to transition image rights.';
      updateFormBundle(assetId, (prev) => ({
        ...prev,
        isSubmitting: false,
        actionError: msg,
      }));
      return null;
    }
  };

  const dispose = (): void => {
    disposed = true;
    generation += 1;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    previewRegistry.revokeAllOwnedPreviewUrls();
  };

  return {
    getSnapshot: buildSnapshot,
    getPreviewRegistry: () => previewRegistry,
    loadForDiscovery,
    refreshAuthoritativeBatch,
    setActiveActionMode,
    updateRegisterEvidenceForm,
    updateRevokeEvidenceForm,
    updateSubmitReviewRequestForm,
    updateApproveForm,
    updateRejectForm,
    updateRevokeForm,
    submitRegisterEvidence,
    submitRevokeEvidence,
    submitReviewRequest,
    submitDecision,
    dispose,
  };
}

export interface EditorialImageRightsReviewPanelProps {
  readonly currentUser: AdminUser;
  readonly articleId?: string;
  readonly featuredImage?: unknown;
  readonly richBodyAr?: unknown;
  readonly richBodyEn?: unknown;
  readonly unsavedLocalAssetIds?: readonly string[];
  readonly isAr: boolean;
  readonly initialSnapshot?: EditorialImageRightsPanelSnapshot;
  readonly controllerOverrides?: Partial<EditorialImageRightsPanelControllerOptions>;
}

function renderRoleBadge(role: DiscoveredEditorialImageRole, isAr: boolean) {
  if (role === 'both') {
    return (
      <span
        data-testid="rights-asset-role-badge"
        className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
      >
        {isAr ? 'غلاف وضمن النص' : 'Cover & Inline'}
      </span>
    );
  }
  if (role === 'cover') {
    return (
      <span
        data-testid="rights-asset-role-badge"
        className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
      >
        {isAr ? 'صورة الغلاف' : 'Cover Image'}
      </span>
    );
  }
  return (
    <span
      data-testid="rights-asset-role-badge"
      className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
    >
      {isAr ? 'صورة مضمنة' : 'Inline Image'}
    </span>
  );
}

function renderRightsStatusBadge(
  status: RightsReviewStatus | 'NOT_FOUND',
  isAr: boolean
) {
  switch (status) {
    case 'Approved':
      return (
        <span
          data-testid="rights-status-badge-Approved"
          className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 inline-flex items-center gap-1"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{isAr ? 'معتمد الحقوق (Approved)' : 'Approved'}</span>
        </span>
      );
    case 'PendingReview':
      return (
        <span
          data-testid="rights-status-badge-PendingReview"
          className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 inline-flex items-center gap-1"
        >
          <Clock className="w-3.5 h-3.5" />
          <span>{isAr ? 'قيد مراجعة الحقوق (PendingReview)' : 'PendingReview'}</span>
        </span>
      );
    case 'Rejected':
      return (
        <span
          data-testid="rights-status-badge-Rejected"
          className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 inline-flex items-center gap-1"
        >
          <Ban className="w-3.5 h-3.5" />
          <span>{isAr ? 'مرفوض الحقوق (Rejected)' : 'Rejected'}</span>
        </span>
      );
    case 'Revoked':
      return (
        <span
          data-testid="rights-status-badge-Revoked"
          className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 inline-flex items-center gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{isAr ? 'ملغى الحقوق (Revoked)' : 'Revoked'}</span>
        </span>
      );
    default:
      return (
        <span
          data-testid="rights-status-badge-NOT_FOUND"
          className="px-2.5 py-1 rounded-full text-xs font-bold bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-300 inline-flex items-center gap-1"
        >
          <FileWarning className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
          <span>
            {isAr
              ? 'سجل الأصل غير موجود — غير معتمد (NOT_FOUND)'
              : 'NOT_FOUND (Unapproved)'}
          </span>
        </span>
      );
  }
}

export function EditorialImageRightsReviewPanel({
  currentUser,
  articleId,
  featuredImage,
  richBodyAr,
  richBodyEn,
  unsavedLocalAssetIds,
  isAr,
  initialSnapshot,
  controllerOverrides,
}: EditorialImageRightsReviewPanelProps) {
  const controllerRef = useRef<EditorialImageRightsPanelController | null>(null);
  const [snapshot, setSnapshot] = useState<EditorialImageRightsPanelSnapshot>(
    () => {
      if (initialSnapshot) {
        return initialSnapshot;
      }
      const ctrl = createEditorialImageRightsPanelController({
        currentUser,
        articleId,
        isAr,
        ...controllerOverrides,
        onSnapshotChange: (next) => setSnapshot(next),
      });
      controllerRef.current = ctrl;
      return {
        ...ctrl.getSnapshot(),
        discovery: discoverPersistedEditorialImageAssets({
          featuredImage,
          richBodyAr,
          richBodyEn,
          unsavedLocalAssetIds,
        }),
      };
    }
  );

  const unsavedKey = unsavedLocalAssetIds
    ? unsavedLocalAssetIds.join('|')
    : '';
  const discoverySignature = JSON.stringify({
    featuredImage: typeof featuredImage === 'string' ? featuredImage : null,
    inlineIds: extractPersistedEditorialImageAssetIds(richBodyAr, richBodyEn),
    unsavedKey,
    userId: currentUser.id,
    userRole: currentUser.role,
  });

  useEffect(() => {
    if (initialSnapshot) {
      return;
    }
    const ctrl = createEditorialImageRightsPanelController({
      currentUser,
      articleId,
      isAr,
      ...controllerOverrides,
      onSnapshotChange: (next) => setSnapshot(next),
    });
    controllerRef.current = ctrl;

    void ctrl.loadForDiscovery({
      featuredImage,
      richBodyAr,
      richBodyEn,
      unsavedLocalAssetIds,
    });

    return () => {
      ctrl.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverySignature]);

  const {
    discovery,
    canView,
    canManageRights,
    loading,
    loadError,
    assetsById,
    previewUrlsByAssetId,
    previewErrorsByAssetId,
    formsByAssetId,
    sessionEvidenceByAssetId,
    sessionReviewRequestsByAssetId,
    sessionAuditEventsByAssetId,
  } = snapshot;

  if (!canView) {
    return (
      <section
        data-testid="editorial-image-rights-review-panel"
        dir={isAr ? 'rtl' : 'ltr'}
        className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl space-y-3"
      >
        <div
          data-testid="rights-panel-permission-denied"
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 font-semibold"
        >
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            {isAr
              ? 'صلاحية العرض (View) مطلوبة للاطلاع على سجلات حقوق الصور التحريرية.'
              : 'AdminPermission.View is required to inspect editorial image rights.'}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="editorial-image-rights-review-panel"
      dir={isAr ? 'rtl' : 'ltr'}
      aria-label={
        isAr
          ? 'مراجعة واعتماد حقوق الصور التحريرية'
          : 'Editorial Image Rights Review & Governance'
      }
      className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-4 sm:p-5 rounded-2xl space-y-4 w-full max-w-full min-w-0"
    >
      {/* Header & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-3.5">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
              {isAr
                ? 'حوكمة ومراجعة حقوق الصور التحريرية المرتبطة بالخبر'
                : 'Editorial Image Rights Review & Governance'}
            </h3>
            <span
              data-testid="rights-panel-role-mode-badge"
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                canManageRights
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {canManageRights
                ? isAr
                  ? `مخوّل بإدارة الحقوق (${currentUser.role})`
                  : `Rights Management Authorized (${currentUser.role})`
                : isAr
                  ? `معاينة للقراءة فقط (${currentUser.role})`
                  : `Read-Only Inspection (${currentUser.role})`}
            </span>
          </div>
          {/* Mandatory Editorial Separation Notice (Section 11) */}
          <p
            data-testid="editorial-image-rights-separation-notice"
            className="text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/50 rounded-lg px-2.5 py-1.5"
          >
            {isAr
              ? EDITORIAL_SEPARATION_NOTICE_AR
              : EDITORIAL_SEPARATION_NOTICE_EN}
          </p>
        </div>

        {discovery.batchAssetIds.length > 0 && (
          <button
            type="button"
            data-testid="rights-panel-refresh-btn"
            disabled={loading}
            onClick={() => {
              void controllerRef.current?.refreshAuthoritativeBatch();
            }}
            className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{isAr ? 'تحديث من الخادم' : 'Refresh Rights'}</span>
          </button>
        )}
      </div>

      {/* Excess Asset Limit Warning (> 20 assets) */}
      {discovery.hasExcessAssets && (
        <div
          data-testid="rights-panel-excess-limit-warning"
          className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1.5"
        >
          <div className="font-extrabold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              {isAr
                ? `تنبيه تجاوز حد الدفعة: يحتوي المقال على ${discovery.allAssets.length} صورة محفوظة، بينما الحد الأقصى للفحص في الدفعة الواحدة هو ${MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS} صورة.`
                : `Batch Limit Warning: This article references ${discovery.allAssets.length} persisted images, exceeding the maximum batch size of ${MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS} assets.`}
            </span>
          </div>
          <p className="leading-relaxed">
            {isAr
              ? 'لا يمكن الجزم باعتماد حقوق جميع صور المقال بشكل مكتمل طالما توجد أصول إضافية خارج نطاق هذه الدفعة. الأصول غير المفحوصة في هذه الدفعة:'
              : 'Complete article-wide image rights verification cannot be claimed while excess assets remain outside the 20-asset batch window. Omitted asset IDs:'}
          </p>
          <div
            dir="ltr"
            data-testid="rights-panel-excess-asset-ids"
            className="font-mono tabular-nums text-[11px] bg-white/80 dark:bg-gray-900/80 px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 break-all"
          >
            {discovery.excessAssetIds.join(', ')}
          </div>
        </div>
      )}

      {/* Top-Level Error State */}
      {loadError && (
        <div
          data-testid="rights-panel-error"
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 font-semibold"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Loading Indicator */}
      {loading && discovery.batchAssetIds.length > 0 && (
        <div
          data-testid="rights-panel-loading"
          className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200/70 dark:border-gray-700/70 text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2 font-semibold"
        >
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
          <span>
            {isAr
              ? 'جاري فحص سجلات حقوق الصور من الخادم...'
              : 'Loading authoritative image rights records from server...'}
          </span>
        </div>
      )}

      {/* Empty State */}
      {discovery.batchAssets.length === 0 ? (
        <div
          data-testid="rights-panel-empty"
          className="p-6 rounded-xl bg-gray-50/70 dark:bg-gray-800/30 border border-dashed border-gray-200 dark:border-gray-700 text-center space-y-1.5"
        >
          <ImageIcon className="w-6 h-6 text-gray-400 mx-auto" />
          <p className="text-xs font-bold text-gray-700 dark:text-gray-300">
            {isAr
              ? 'لا توجد أصول صور تحريرية محفوظة مرتبطة بهذا الخبر حالياً.'
              : 'No persisted editorial image assets are currently linked to this article.'}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {isAr
              ? 'تظهر سجلات مراجعة الحقوق هنا بمجرد حفظ المسودة بالصور المرفوعة (تُستثنى الروابط الخارجية القديمة والمعاينات المحلية غير المحفوظة).'
              : 'Rights review records appear here once uploaded editorial images are saved to the draft (legacy external URLs and unsaved local previews are excluded).'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {discovery.batchAssets.map((entry) => {
            const { assetId, role } = entry;
            const dto = assetsById[assetId];
            const isFound = Boolean(dto && dto.found);
            const foundDto = dto && dto.found ? dto : null;
            const rights = foundDto?.rights ?? null;
            const rightsStatus: RightsReviewStatus | 'NOT_FOUND' = foundDto
              ? foundDto.rights.status
              : 'NOT_FOUND';

            const previewUrl = previewUrlsByAssetId[assetId];
            const hasSafePreview =
              typeof previewUrl === 'string' &&
              isSafeRuntimePreviewUrl(previewUrl);
            const previewError = previewErrorsByAssetId[assetId];

            const bundle =
              formsByAssetId[assetId] ??
              createInitialAssetFormBundle(dto, articleId);
            const sessionEvidence = sessionEvidenceByAssetId[assetId] ?? [];
            const sessionRequest = sessionReviewRequestsByAssetId[assetId];
            const sessionAudits = sessionAuditEventsByAssetId[assetId] ?? [];

            const selfEval = evaluateImageRightsSelfApproval(
              currentUser,
              foundDto?.createdByUid
            );

            const canApproveTransition =
              isFound &&
              foundDto?.status === 'active' &&
              isAllowedImageRightsTransition(rightsStatus, 'Approved');
            const canRejectTransition =
              isFound &&
              foundDto?.status === 'active' &&
              isAllowedImageRightsTransition(rightsStatus, 'Rejected');
            const canRevokeTransition =
              isFound &&
              foundDto?.status === 'active' &&
              isAllowedImageRightsTransition(rightsStatus, 'Revoked');
            const canSubmitReReviewRequest =
              isFound &&
              foundDto?.status === 'active' &&
              (rightsStatus === 'Rejected' || rightsStatus === 'Revoked');

            return (
              <div
                key={assetId}
                data-testid={`rights-asset-card-${assetId}`}
                className="rounded-2xl border border-gray-200 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/30 p-4 space-y-4 w-full max-w-full min-w-0"
              >
                {/* Top Summary Bar */}
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  {/* Private Thumbnail Preview & Identity */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-20 h-20 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden shrink-0 flex items-center justify-center">
                      {hasSafePreview ? (
                        <img
                          data-testid={`rights-asset-preview-img-${assetId}`}
                          src={previewUrl}
                          alt={
                            foundDto?.altAr ||
                            (isAr
                              ? 'معاينة خاصة للصورة التحريرية'
                              : 'Private editorial image preview')
                          }
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div
                          data-testid={`rights-asset-preview-fallback-${assetId}`}
                          className="p-1.5 text-center text-[10px] text-gray-400 dark:text-gray-500 flex flex-col items-center gap-1"
                        >
                          <ImageIcon className="w-4 h-4" />
                          <span>
                            {previewError
                              ? isAr
                                ? 'المعاينة الخاصة غير متاحة'
                                : 'Private preview unavailable'
                              : isAr
                                ? 'معاينة خاصة'
                                : 'Private preview'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {renderRoleBadge(role, isAr)}
                        <code
                          dir="ltr"
                          data-testid={`rights-asset-id-${assetId}`}
                          className="px-2 py-0.5 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 font-mono tabular-nums text-[11px] text-emerald-700 dark:text-emerald-300 break-all"
                        >
                          {assetId}
                        </code>
                        <span
                          dir="ltr"
                          data-testid={`rights-asset-revision-${assetId}`}
                          className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono tabular-nums text-[11px] font-bold text-gray-700 dark:text-gray-300"
                        >
                          {foundDto ? `r${foundDto.revision}` : 'r—'}
                        </span>
                        <span
                          dir="ltr"
                          data-testid={`rights-asset-lifecycle-${assetId}`}
                          className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-[10px] text-gray-600 dark:text-gray-400"
                        >
                          {foundDto ? foundDto.status : 'NOT_FOUND'}
                        </span>
                      </div>

                      {foundDto ? (
                        <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                          <div className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                            {foundDto.altAr}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                            <span>
                              {isAr ? 'رافع الأصل:' : 'Uploaded by:'}{' '}
                              <code dir="ltr" className="font-mono">
                                {foundDto.createdByUid}
                              </code>
                            </span>
                            {foundDto.asset.photographerCredit && (
                              <span>
                                {isAr ? 'المصور/المصدر:' : 'Photographer:'}{' '}
                                <strong className="text-gray-700 dark:text-gray-200">
                                  {foundDto.asset.photographerCredit}
                                </strong>
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p
                          data-testid={`rights-asset-not-found-warning-${assetId}`}
                          className="text-xs font-semibold text-rose-700 dark:text-rose-300"
                        >
                          {isAr
                            ? 'لم يتم العثور على سجل هذا الأصل في مستودع الصور التحريرية. يُحظر اعتباره معتمداً أو تسليمه للجمهور.'
                            : 'Asset record was not found in the editorial image repository. It is strictly treated as unapproved and withheld from public delivery.'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Rights Status Badge */}
                  <div className="shrink-0">
                    {renderRightsStatusBadge(rightsStatus, isAr)}
                  </div>
                </div>

                {/* Metadata & Current Review State Details (When Found) */}
                {foundDto && rights && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs bg-white dark:bg-gray-900 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                    <div>
                      <span className="text-gray-400 block text-[11px]">
                        {isAr ? 'نوع الترخيص (License Type):' : 'License Type:'}
                      </span>
                      <span
                        dir="ltr"
                        data-testid={`rights-asset-license-type-${assetId}`}
                        className="font-bold text-gray-800 dark:text-gray-200 font-mono"
                      >
                        {rights.licenseType ?? '—'}
                      </span>
                      {(rights.licenseDetails || foundDto.asset.licensingInfo) && (
                        <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                          {rights.licenseDetails || foundDto.asset.licensingInfo}
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="text-gray-400 block text-[11px]">
                        {isAr ? 'نطاق الاستخدام (Usage Scope):' : 'Usage Scope:'}
                      </span>
                      <span
                        dir="ltr"
                        data-testid={`rights-asset-usage-scope-${assetId}`}
                        className="font-bold text-gray-800 dark:text-gray-200 font-mono"
                      >
                        {rights.usageScope?.scopeType ?? '—'}
                      </span>
                      {rights.usageScope?.articleIds &&
                        rights.usageScope.articleIds.length > 0 && (
                          <span
                            dir="ltr"
                            className="block text-[11px] font-mono text-gray-500 dark:text-gray-400 mt-0.5 break-all"
                          >
                            [{rights.usageScope.articleIds.join(', ')}]
                          </span>
                        )}
                    </div>

                    <div>
                      <span className="text-gray-400 block text-[11px]">
                        {isAr
                          ? 'صاحب الحقوق / النسبة:'
                          : 'Rights Holder & Attribution:'}
                      </span>
                      <span className="font-semibold text-gray-800 dark:text-gray-200 block">
                        {rights.rightsHolder ||
                          rights.documentedException ||
                          foundDto.asset.photographerCredit ||
                          '—'}
                      </span>
                      {rights.sourceAttributionAr && (
                        <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                          {rights.sourceAttributionAr}
                        </span>
                      )}
                    </div>

                    {rights.evidenceRefs && rights.evidenceRefs.length > 0 && (
                      <div className="sm:col-span-2">
                        <span className="text-gray-400 block text-[11px]">
                          {isAr
                            ? 'معرفات الأدلة المرتبطة (Evidence Refs):'
                            : 'Linked Evidence References:'}
                        </span>
                        <div
                          dir="ltr"
                          data-testid={`rights-asset-evidence-refs-${assetId}`}
                          className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300 break-all"
                        >
                          {rights.evidenceRefs.join(', ')}
                        </div>
                      </div>
                    )}

                    {(rights.reviewedByUid || rights.reviewReason) && (
                      <div className="sm:col-span-3 pt-2 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                        <div>
                          {isAr ? 'آخر مراجعة بواسطة:' : 'Last reviewed by:'}{' '}
                          <code dir="ltr" className="font-mono font-bold">
                            {rights.reviewedByUid ?? '—'}
                          </code>{' '}
                          {rights.reviewedAtIso && (
                            <span dir="ltr" className="font-mono">
                              ({rights.reviewedAtIso})
                            </span>
                          )}
                        </div>
                        {rights.reviewReason && (
                          <div className="italic text-gray-700 dark:text-gray-300">
                            "{rights.reviewReason}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Session-Registered Evidence List */}
                {sessionEvidence.length > 0 && (
                  <div
                    data-testid={`rights-session-evidence-list-${assetId}`}
                    className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200/70 dark:border-gray-800 space-y-1.5 text-xs"
                  >
                    <div className="font-bold text-gray-700 dark:text-gray-300 text-[11px]">
                      {isAr
                        ? 'أدلة الحقوق المسجلة في هذه الجلسة:'
                        : 'Evidence Registered in Current Session:'}
                    </div>
                    {sessionEvidence.map((ev) => (
                      <div
                        key={ev.evidenceId}
                        className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-gray-50 dark:bg-gray-800/60 px-2.5 py-1.5 rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          <code
                            dir="ltr"
                            className="font-mono font-bold text-emerald-700 dark:text-emerald-300"
                          >
                            {ev.evidenceId}
                          </code>
                          <span className="text-gray-500">({ev.sourceKind})</span>
                        </div>
                        <span
                          dir="ltr"
                          className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                            ev.status === 'Active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {ev.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Session Review Request Status */}
                {sessionRequest && (
                  <div
                    data-testid={`rights-session-review-request-${assetId}`}
                    className="p-2.5 rounded-xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-xs text-sky-900 dark:text-sky-200 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-bold">
                        {isAr ? 'طلب إعادة المراجعة:' : 'Re-Review Request:'}
                      </span>{' '}
                      <code dir="ltr" className="font-mono font-bold">
                        {sessionRequest.requestId}
                      </code>
                    </div>
                    <span
                      dir="ltr"
                      className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-white dark:bg-gray-900"
                    >
                      {sessionRequest.status} (r{sessionRequest.assetRevision})
                    </span>
                  </div>
                )}

                {/* Session Audit Event Confirmation */}
                {sessionAudits.length > 0 && (
                  <div
                    data-testid={`rights-session-audit-events-${assetId}`}
                    className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-800/60 text-[11px] space-y-1"
                  >
                    {sessionAudits.map((audit) => (
                      <div
                        key={audit.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-emerald-900 dark:text-emerald-200"
                      >
                        <div>
                          <FileCheck2 className="w-3.5 h-3.5 inline me-1 text-emerald-600" />
                          <code dir="ltr" className="font-mono font-bold">
                            {audit.id}
                          </code>
                          {': '}
                          <span dir="ltr" className="font-mono">
                            {audit.previousRightsStatus} → {audit.newRightsStatus} (r
                            {audit.previousRevision} → r{audit.newRevision})
                          </span>
                        </div>
                        <div className="text-gray-600 dark:text-gray-400">
                          {audit.actorName} ({audit.actorRole})
                          {audit.selfApprovedByOwner && (
                            <span
                              dir="ltr"
                              className="ms-1.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 font-mono text-[10px]"
                            >
                              selfApprovedByOwner: true
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action Feedback Banners */}
                {bundle.actionSuccess && (
                  <div
                    data-testid={`rights-action-success-${assetId}`}
                    className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{bundle.actionSuccess}</span>
                  </div>
                )}

                {bundle.conflictMessage && (
                  <div
                    data-testid={`rights-conflict-banner-${assetId}`}
                    className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <span>{bundle.conflictMessage}</span>
                  </div>
                )}

                {bundle.actionError && (
                  <div
                    data-testid={`rights-action-error-${assetId}`}
                    className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{bundle.actionError}</span>
                  </div>
                )}

                {/* Self-Approval Policy Notice when current user uploaded this asset */}
                {canManageRights && foundDto && selfEval.isSelfApprovalForbidden && (
                  <div
                    data-testid={`rights-self-approval-blocked-${assetId}`}
                    className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2 font-semibold"
                  >
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>
                      {isAr
                        ? 'قام حسابك برفع هذه الصورة؛ يُحظر الاعتماد الذاتي لحقوق الصور لغير دور المالك (Owner).'
                        : 'Your account uploaded this image; self-approval of image rights is forbidden for non-Owner roles.'}
                    </span>
                  </div>
                )}

                {canManageRights &&
                  foundDto &&
                  selfEval.isOwnerSelfApprovalException &&
                  canApproveTransition && (
                    <div
                      data-testid={`rights-owner-self-approval-notice-${assetId}`}
                      className="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 text-sky-800 dark:text-sky-300 text-[11px] font-medium"
                    >
                      {isAr
                        ? 'ملاحظة تدقيقية: بصفتك المالك (Owner)، سيُسجل اعتمادك لهذه الصورة التي رفعتها بنفسك تحت استثناء الموافقة الذاتية الموثق (selfApprovedByOwner: true).'
                        : 'Audit note: As Owner, approving an image uploaded by your account is permitted and recorded under the audited exception (selfApprovedByOwner: true).'}
                    </div>
                  )}

                {/* Contextual Action Toolbar (Only for ManageRights roles on active found assets) */}
                {canManageRights && isFound && foundDto?.status === 'active' && (
                  <div className="pt-2 border-t border-gray-200/70 dark:border-gray-700/70 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Register Evidence Toggle */}
                      <button
                        type="button"
                        data-testid={`rights-open-register-evidence-${assetId}`}
                        onClick={() =>
                          controllerRef.current?.setActiveActionMode(
                            assetId,
                            'registerEvidence'
                          )
                        }
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                          bundle.activeMode === 'registerEvidence'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>
                          {isAr ? 'تسجيل دليل حقوق' : 'Register Evidence'}
                        </span>
                        {bundle.activeMode === 'registerEvidence' ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>

                      {/* Revoke Evidence Toggle */}
                      <button
                        type="button"
                        data-testid={`rights-open-revoke-evidence-${assetId}`}
                        onClick={() =>
                          controllerRef.current?.setActiveActionMode(
                            assetId,
                            'revokeEvidence'
                          )
                        }
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                          bundle.activeMode === 'revokeEvidence'
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>
                          {isAr ? 'إلغاء دليل حقوق' : 'Revoke Evidence'}
                        </span>
                      </button>

                      {/* Submit Re-Review Request Toggle (Contextual to Rejected / Revoked) */}
                      {canSubmitReReviewRequest && (
                        <button
                          type="button"
                          data-testid={`rights-open-review-request-${assetId}`}
                          onClick={() =>
                            controllerRef.current?.setActiveActionMode(
                              assetId,
                              'submitReviewRequest'
                            )
                          }
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                            bundle.activeMode === 'submitReviewRequest'
                              ? 'bg-sky-600 text-white border-sky-600'
                              : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                          }`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>
                            {isAr
                              ? 'تقديم طلب إعادة مراجعة'
                              : 'Submit Review Request'}
                          </span>
                        </button>
                      )}

                      {/* Approve Rights Toggle */}
                      {canApproveTransition && (
                        <button
                          type="button"
                          data-testid={`rights-open-approve-${assetId}`}
                          disabled={selfEval.isSelfApprovalForbidden}
                          onClick={() =>
                            controllerRef.current?.setActiveActionMode(
                              assetId,
                              'approve'
                            )
                          }
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors ${
                            selfEval.isSelfApprovalForbidden
                              ? 'bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800 dark:text-gray-600 dark:border-gray-700 cursor-not-allowed'
                              : bundle.activeMode === 'approve'
                                ? 'bg-emerald-700 text-white border-emerald-700 cursor-pointer'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 cursor-pointer'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {rightsStatus === 'Rejected' ||
                            rightsStatus === 'Revoked'
                              ? isAr
                                ? 'إعادة اعتماد الحقوق (Re-Approve)'
                                : 'Re-Approve Rights'
                              : isAr
                                ? 'اعتماد حقوق الصورة'
                                : 'Approve Rights'}
                          </span>
                        </button>
                      )}

                      {/* Reject Rights Toggle (From PendingReview) */}
                      {canRejectTransition && (
                        <button
                          type="button"
                          data-testid={`rights-open-reject-${assetId}`}
                          onClick={() =>
                            controllerRef.current?.setActiveActionMode(
                              assetId,
                              'reject'
                            )
                          }
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                            bundle.activeMode === 'reject'
                              ? 'bg-rose-700 text-white border-rose-700'
                              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          }`}
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>{isAr ? 'رفض الحقوق' : 'Reject Rights'}</span>
                        </button>
                      )}

                      {/* Revoke Rights Toggle (From Approved) */}
                      {canRevokeTransition && (
                        <button
                          type="button"
                          data-testid={`rights-open-revoke-${assetId}`}
                          onClick={() =>
                            controllerRef.current?.setActiveActionMode(
                              assetId,
                              'revoke'
                            )
                          }
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                            bundle.activeMode === 'revoke'
                              ? 'bg-red-700 text-white border-red-700'
                              : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                          }`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{isAr ? 'إلغاء اعتماد الحقوق' : 'Revoke Rights'}</span>
                        </button>
                      )}
                    </div>

                    {/* 1. Contextual Form: Register Evidence */}
                    {bundle.activeMode === 'registerEvidence' && (
                      <div
                        data-testid={`rights-form-register-evidence-${assetId}`}
                        className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-3"
                      >
                        <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">
                          {isAr
                            ? 'تسجيل دليل حقوق جديد في السجل المعتمد'
                            : 'Register New Rights Evidence Record'}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'نوع مصدر الدليل (sourceKind) *'
                                : 'Evidence Source Kind *'}
                            </label>
                            <select
                              data-testid={`rights-ev-source-kind-${assetId}`}
                              value={bundle.registerEvidence.sourceKind}
                              onChange={(e) =>
                                controllerRef.current?.updateRegisterEvidenceForm(
                                  assetId,
                                  {
                                    sourceKind: e.target
                                      .value as EditorialImageRightsEvidenceSourceKind,
                                  }
                                )
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            >
                              {CANONICAL_EVIDENCE_SOURCE_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {isAr
                                    ? EVIDENCE_SOURCE_KIND_LABELS[kind].labelAr
                                    : EVIDENCE_SOURCE_KIND_LABELS[kind].labelEn}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'مرجع الوثيقة أو العقد (sourceReference) *'
                                : 'Source Reference Identifier *'}
                            </label>
                            <input
                              type="text"
                              data-testid={`rights-ev-source-ref-${assetId}`}
                              value={bundle.registerEvidence.sourceReference}
                              onChange={(e) =>
                                controllerRef.current?.updateRegisterEvidenceForm(
                                  assetId,
                                  { sourceReference: e.target.value }
                                )
                              }
                              placeholder={
                                isAr
                                  ? 'مثال: LIC-2026-SUDAN-09'
                                  : 'e.g. LIC-2026-SUDAN-09'
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>

                          <div className="sm:col-span-2 space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'ملخص الدليل والتصريح (summary) *'
                                : 'Evidence Summary *'}
                            </label>
                            <input
                              type="text"
                              data-testid={`rights-ev-summary-${assetId}`}
                              value={bundle.registerEvidence.summary}
                              onChange={(e) =>
                                controllerRef.current?.updateRegisterEvidenceForm(
                                  assetId,
                                  { summary: e.target.value }
                                )
                              }
                              placeholder={
                                isAr
                                  ? 'ملخص التصريح الرسمي أو الرخصة...'
                                  : 'Summary of written release or license terms...'
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>

                          <div className="sm:col-span-2 space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'بصمة SHA-256 للملف المرجعي (اختياري — 64 محرفاً ست عشرياً)'
                                : 'Artifact SHA-256 Checksum (Optional — 64 lowercase hex chars)'}
                            </label>
                            <input
                              type="text"
                              dir="ltr"
                              data-testid={`rights-ev-sha256-${assetId}`}
                              value={bundle.registerEvidence.artifactSha256}
                              onChange={(e) =>
                                controllerRef.current?.updateRegisterEvidenceForm(
                                  assetId,
                                  { artifactSha256: e.target.value }
                                )
                              }
                              placeholder="a3f5... (64 hex chars)"
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono text-gray-900 dark:text-white"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={bundle.isSubmitting}
                            data-testid={`rights-submit-register-evidence-${assetId}`}
                            onClick={() => {
                              void controllerRef.current?.submitRegisterEvidence(
                                assetId
                              );
                            }}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {isAr ? 'تأكيد تسجيل الدليل' : 'Confirm Evidence Registration'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 2. Contextual Form: Revoke Evidence */}
                    {bundle.activeMode === 'revokeEvidence' && (
                      <div
                        data-testid={`rights-form-revoke-evidence-${assetId}`}
                        className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-rose-200 dark:border-rose-800 space-y-3"
                      >
                        <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">
                          {isAr
                            ? 'إلغاء دليل حقوق مسجل (Revoke Evidence)'
                            : 'Revoke Registered Rights Evidence'}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr ? 'معرف الدليل (evidenceId) *' : 'Evidence ID *'}
                            </label>
                            <input
                              type="text"
                              dir="ltr"
                              data-testid={`rights-revoke-ev-id-${assetId}`}
                              value={bundle.revokeEvidence.evidenceId}
                              onChange={(e) =>
                                controllerRef.current?.updateRevokeEvidenceForm(
                                  assetId,
                                  { evidenceId: e.target.value }
                                )
                              }
                              placeholder="ev_..."
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono text-gray-900 dark:text-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'سبب إلغاء الدليل (revocationReason) *'
                                : 'Revocation Reason *'}
                            </label>
                            <input
                              type="text"
                              data-testid={`rights-revoke-ev-reason-${assetId}`}
                              value={bundle.revokeEvidence.revocationReason}
                              onChange={(e) =>
                                controllerRef.current?.updateRevokeEvidenceForm(
                                  assetId,
                                  { revocationReason: e.target.value }
                                )
                              }
                              placeholder={
                                isAr
                                  ? 'سبب إلغاء صلاحية هذا الدليل...'
                                  : 'Reason for revoking this evidence record...'
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={bundle.isSubmitting}
                            data-testid={`rights-submit-revoke-evidence-${assetId}`}
                            onClick={() => {
                              void controllerRef.current?.submitRevokeEvidence(
                                assetId
                              );
                            }}
                            className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {isAr ? 'تأكيد إلغاء الدليل' : 'Confirm Evidence Revocation'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 3. Contextual Form: Submit Re-Review Request */}
                    {bundle.activeMode === 'submitReviewRequest' &&
                      canSubmitReReviewRequest && (
                        <div
                          data-testid={`rights-form-review-request-${assetId}`}
                          className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-sky-200 dark:border-sky-800 space-y-3"
                        >
                          <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">
                            {isAr
                              ? 'تقديم طلب إعادة مراجعة لحقوق صورة مرفوضة أو ملغاة'
                              : 'Submit Re-Review Request for Rejected / Revoked Asset'}
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                                {isAr
                                  ? 'معرفات الأدلة الجديدة المقدمة (submittedEvidenceRefs) *'
                                  : 'Submitted New Active Evidence IDs *'}
                              </label>
                              <input
                                type="text"
                                dir="ltr"
                                data-testid={`rights-req-evidence-refs-${assetId}`}
                                value={
                                  bundle.submitReviewRequest
                                    .submittedEvidenceRefsInput
                                }
                                onChange={(e) =>
                                  controllerRef.current?.updateSubmitReviewRequestForm(
                                    assetId,
                                    {
                                      submittedEvidenceRefsInput:
                                        e.target.value,
                                    }
                                  )
                                }
                                placeholder="ev_new_01, ev_new_02"
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono text-gray-900 dark:text-white"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                                {isAr
                                  ? 'مبررات طلب إعادة المراجعة (rationale) *'
                                  : 'Re-Review Rationale *'}
                              </label>
                              <input
                                type="text"
                                data-testid={`rights-req-rationale-${assetId}`}
                                value={bundle.submitReviewRequest.rationale}
                                onChange={(e) =>
                                  controllerRef.current?.updateSubmitReviewRequestForm(
                                    assetId,
                                    { rationale: e.target.value }
                                  )
                                }
                                placeholder={
                                  isAr
                                    ? 'توضيح الدليل الجديد ومبرر إعادة الفحص...'
                                    : 'Explain the newly registered evidence and rationale...'
                                }
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={bundle.isSubmitting}
                              data-testid={`rights-submit-review-request-${assetId}`}
                              onClick={() => {
                                void controllerRef.current?.submitReviewRequest(
                                  assetId
                                );
                              }}
                              className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                            >
                              {isAr
                                ? 'إرسال طلب إعادة المراجعة'
                                : 'Submit Re-Review Request'}
                            </button>
                          </div>
                        </div>
                      )}

                    {/* 4. Contextual Form: Approve / Re-Approve Rights */}
                    {bundle.activeMode === 'approve' && canApproveTransition && (
                      <div
                        data-testid={`rights-form-approve-${assetId}`}
                        className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 space-y-3"
                      >
                        <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">
                          {isAr
                            ? `اعتماد حقوق الصورة (المراجعة المتوقعة r${foundDto.revision})`
                            : `Approve Image Rights (Expected Revision r${foundDto.revision})`}
                        </h4>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* License Type */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'نوع الترخيص القانوني (licenseType) *'
                                : 'Canonical License Type *'}
                            </label>
                            <select
                              data-testid={`rights-approve-license-type-${assetId}`}
                              value={bundle.approve.licenseType}
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  {
                                    licenseType: e.target
                                      .value as EditorialImageLicenseType,
                                  }
                                )
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            >
                              {CANONICAL_LICENSE_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {isAr ? opt.labelAr : opt.labelEn}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Usage Scope Type */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'نطاق الاستخدام المسموح (usageScope) *'
                                : 'Canonical Usage Scope *'}
                            </label>
                            <select
                              data-testid={`rights-approve-usage-scope-${assetId}`}
                              value={bundle.approve.usageScopeType}
                              disabled={
                                bundle.approve.licenseType ===
                                'ContextSpecificAssessment'
                              }
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  {
                                    usageScopeType: e.target
                                      .value as EditorialImageUsageScopeType,
                                  }
                                )
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white disabled:opacity-60"
                            >
                              {CANONICAL_USAGE_SCOPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {isAr ? opt.labelAr : opt.labelEn}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Restricted Article IDs (when ArticleRestricted) */}
                          {bundle.approve.usageScopeType ===
                            'ArticleRestricted' && (
                            <div className="sm:col-span-2 space-y-1">
                              <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                                {isAr
                                  ? 'معرفات المقالات المسموح بها (articleIds) *'
                                  : 'Permitted Article IDs (ArticleRestricted) *'}
                              </label>
                              <input
                                type="text"
                                dir="ltr"
                                data-testid={`rights-approve-article-ids-${assetId}`}
                                value={bundle.approve.restrictedArticleIdsInput}
                                onChange={(e) =>
                                  controllerRef.current?.updateApproveForm(
                                    assetId,
                                    {
                                      restrictedArticleIdsInput: e.target.value,
                                    }
                                  )
                                }
                                placeholder="news_article_id_01"
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono text-gray-900 dark:text-white"
                              />
                            </div>
                          )}

                          {/* License Details */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'تفاصيل الرخصة (licenseDetails)'
                                : 'License Details (e.g. CC-BY-4.0)'}
                            </label>
                            <input
                              type="text"
                              data-testid={`rights-approve-license-details-${assetId}`}
                              value={bundle.approve.licenseDetails}
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  { licenseDetails: e.target.value }
                                )
                              }
                              placeholder="CC-BY-4.0 / Direct Contract #..."
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>

                          {/* Rights Holder */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'صاحب الحقوق (rightsHolder) *'
                                : 'Rights Holder *'}
                            </label>
                            <input
                              type="text"
                              data-testid={`rights-approve-rights-holder-${assetId}`}
                              value={bundle.approve.rightsHolder}
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  { rightsHolder: e.target.value }
                                )
                              }
                              placeholder={
                                isAr
                                  ? 'اسم المصور أو الجهة المالكة للحقوق'
                                  : 'Photographer or rights-holding entity'
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>

                          {/* Documented Exception (optional alternative) */}
                          <div className="sm:col-span-2 space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'الاستثناء التوثيقي (documentedException — عند الاقتضاء)'
                                : 'Documented Exception (if applicable)'}
                            </label>
                            <input
                              type="text"
                              data-testid={`rights-approve-documented-exception-${assetId}`}
                              value={bundle.approve.documentedException}
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  { documentedException: e.target.value }
                                )
                              }
                              placeholder={
                                isAr
                                  ? 'مرجع الاستثناء التوثيقي للملكية العامة أو التقييم السياقي...'
                                  : 'Documented exception reference if applicable...'
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>

                          {/* Arabic Attribution */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'نسبة المصدر بالعربية (sourceAttributionAr) *'
                                : 'Arabic Source Attribution *'}
                            </label>
                            <input
                              type="text"
                              dir="rtl"
                              data-testid={`rights-approve-attribution-ar-${assetId}`}
                              value={bundle.approve.sourceAttributionAr}
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  { sourceAttributionAr: e.target.value }
                                )
                              }
                              placeholder="تصوير: وحدة الرصد الميداني - وعد الكوكب"
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>

                          {/* English Attribution */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'نسبة المصدر بالإنجليزية (sourceAttributionEn)'
                                : 'English Source Attribution (Optional)'}
                            </label>
                            <input
                              type="text"
                              dir="ltr"
                              data-testid={`rights-approve-attribution-en-${assetId}`}
                              value={bundle.approve.sourceAttributionEn}
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  { sourceAttributionEn: e.target.value }
                                )
                              }
                              placeholder="Photo: Field Monitoring Unit"
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>

                          {/* Active Evidence References */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'معرفات الأدلة النشطة (evidenceRefs) *'
                                : 'Active Evidence Reference IDs *'}
                            </label>
                            <input
                              type="text"
                              dir="ltr"
                              data-testid={`rights-approve-evidence-refs-${assetId}`}
                              value={bundle.approve.evidenceRefsInput}
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  { evidenceRefsInput: e.target.value }
                                )
                              }
                              placeholder="ev_01, ev_02"
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono text-gray-900 dark:text-white"
                            />
                          </div>

                          {/* Review Request ID (when re-approving from Rejected or Revoked) */}
                          {(rightsStatus === 'Rejected' ||
                            rightsStatus === 'Revoked') && (
                            <div className="space-y-1">
                              <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                                {isAr
                                  ? 'معرف طلب إعادة المراجعة (reviewRequestId) *'
                                  : 'Review Request ID (Required for Re-Approval) *'}
                              </label>
                              <input
                                type="text"
                                dir="ltr"
                                data-testid={`rights-approve-request-id-${assetId}`}
                                value={bundle.approve.reviewRequestId}
                                onChange={(e) =>
                                  controllerRef.current?.updateApproveForm(
                                    assetId,
                                    { reviewRequestId: e.target.value }
                                  )
                                }
                                placeholder="img_req_..."
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono text-gray-900 dark:text-white"
                              />
                            </div>
                          )}

                          {/* Review Reason */}
                          <div className="sm:col-span-2 space-y-1">
                            <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                              {isAr
                                ? 'سبب وقرار اعتماد الحقوق (reviewReason) *'
                                : 'Approval Decision Reason *'}
                            </label>
                            <input
                              type="text"
                              data-testid={`rights-approve-reason-${assetId}`}
                              value={bundle.approve.reviewReason}
                              onChange={(e) =>
                                controllerRef.current?.updateApproveForm(
                                  assetId,
                                  { reviewReason: e.target.value }
                                )
                              }
                              placeholder={
                                isAr
                                  ? 'تم التحقق من اتفاقية الترخيص ومطابقة النسبة...'
                                  : 'Verified signed license agreement and attribution metadata...'
                              }
                              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={
                              bundle.isSubmitting ||
                              selfEval.isSelfApprovalForbidden
                            }
                            data-testid={`rights-submit-approve-${assetId}`}
                            onClick={() => {
                              void controllerRef.current?.submitDecision(
                                assetId,
                                'Approved'
                              );
                            }}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {isAr
                              ? 'تأكيد اعتماد حقوق الصورة'
                              : 'Confirm Rights Approval'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 5. Contextual Form: Reject Rights */}
                    {bundle.activeMode === 'reject' && canRejectTransition && (
                      <div
                        data-testid={`rights-form-reject-${assetId}`}
                        className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-rose-200 dark:border-rose-800 space-y-3"
                      >
                        <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">
                          {isAr
                            ? `رفض حقوق الصورة (المراجعة المتوقعة r${foundDto.revision})`
                            : `Reject Image Rights (Expected Revision r${foundDto.revision})`}
                        </h4>
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                            {isAr
                              ? 'سبب الرفض (reviewReason) *'
                              : 'Rejection Reason *'}
                          </label>
                          <input
                            type="text"
                            data-testid={`rights-reject-reason-${assetId}`}
                            value={bundle.reject.reviewReason}
                            onChange={(e) =>
                              controllerRef.current?.updateRejectForm(assetId, {
                                reviewReason: e.target.value,
                              })
                            }
                            placeholder={
                              isAr
                                ? 'عدم كفاية أدلة الملكية الفكرية أو نقص التصريح...'
                                : 'Insufficient rights documentation or missing release...'
                            }
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={bundle.isSubmitting}
                            data-testid={`rights-submit-reject-${assetId}`}
                            onClick={() => {
                              void controllerRef.current?.submitDecision(
                                assetId,
                                'Rejected'
                              );
                            }}
                            className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {isAr ? 'تأكيد رفض الحقوق' : 'Confirm Rights Rejection'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 6. Contextual Form: Revoke Rights */}
                    {bundle.activeMode === 'revoke' && canRevokeTransition && (
                      <div
                        data-testid={`rights-form-revoke-${assetId}`}
                        className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800 space-y-3"
                      >
                        <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">
                          {isAr
                            ? `إلغاء اعتماد حقوق الصورة (المراجعة المتوقعة r${foundDto.revision})`
                            : `Revoke Image Rights Approval (Expected Revision r${foundDto.revision})`}
                        </h4>
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">
                            {isAr
                              ? 'سبب إلغاء الاعتماد (reviewReason) *'
                              : 'Revocation Reason *'}
                          </label>
                          <input
                            type="text"
                            data-testid={`rights-revoke-reason-${assetId}`}
                            value={bundle.revoke.reviewReason}
                            onChange={(e) =>
                              controllerRef.current?.updateRevokeForm(assetId, {
                                reviewReason: e.target.value,
                              })
                            }
                            placeholder={
                              isAr
                                ? 'انتهاء صلاحية الترخيص أو سحب التصريح...'
                                : 'License expiration or withdrawal of release...'
                            }
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={bundle.isSubmitting}
                            data-testid={`rights-submit-revoke-${assetId}`}
                            onClick={() => {
                              void controllerRef.current?.submitDecision(
                                assetId,
                                'Revoked'
                              );
                            }}
                            className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {isAr
                              ? 'تأكيد إلغاء اعتماد الحقوق'
                              : 'Confirm Rights Revocation'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
