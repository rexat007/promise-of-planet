export type EditorialImageAssetOrigin = 'news_article' | 'standalone_upload' | 'editorial_library';

export type EditorialImageAssetVariantFormat = 'image/webp' | 'image/jpeg' | 'image/png';

export type EditorialImageAssetVariantKey =
  | 'thumbnail'
  | 'card'
  | 'article_inline'
  | 'article_cover'
  | 'original_processed';

export interface EditorialImageAssetVariant {
  variantKey: EditorialImageAssetVariantKey;
  storagePath: string;
  mimeType: EditorialImageAssetVariantFormat;
  width: number;
  height: number;
  sizeBytes: number;
  sha256Checksum: string;
}

export type EditorialImageAssetStatus = 'active' | 'archived' | 'deleted';

export type RightsReviewStatus = 'PendingReview' | 'Approved' | 'Rejected' | 'Revoked';

export type EditorialImageLicenseType =
  | 'OriginalWork'
  | 'DirectLicense'
  | 'CreativeCommons'
  | 'PublicDomainClaim'
  | 'ContextSpecificAssessment'
  | 'Other';

export type EditorialImageUsageScopeType = 'GeneralEditorial' | 'ArticleRestricted';

export interface EditorialImageUsageScope {
  scopeType: EditorialImageUsageScopeType;
  articleIds?: string[];
}

export interface EditorialImageRightsRecord {
  status: RightsReviewStatus;
  licenseType?: EditorialImageLicenseType;
  licenseDetails?: string;
  rightsHolder?: string;
  documentedException?: string;
  sourceAttributionAr?: string;
  sourceAttributionEn?: string;
  evidenceRefs?: string[];
  usageScope?: EditorialImageUsageScope;
  reviewedByUid?: string;
  reviewedAtIso?: string;
  reviewReason?: string;
}

export interface EditorialImageAssetMetadata {
  assetId: string;
  createdByUid: string;
  createdAtIso: string;
  updatedAtIso: string;
  origin: EditorialImageAssetOrigin;
  status: EditorialImageAssetStatus;
  rights: EditorialImageRightsRecord;
  originalFilename: string;
  mimeType: EditorialImageAssetVariantFormat;
  originalSizeBytes: number;
  originalWidth: number;
  originalHeight: number;
  aspectRatio: number;
  sha256Checksum: string;
  variants: Record<string, EditorialImageAssetVariant>;
  altAr: string;
  altEn?: string;
  captionAr?: string;
  captionEn?: string;
  photographerCredit?: string;
  licensingInfo?: string;
  tags?: string[];
  associatedArticleIds?: string[];
}

export interface CreateEditorialImageAssetInput {
  assetId: string;
  createdByUid: string;
  origin: EditorialImageAssetOrigin;
  originalFilename: string;
  mimeType: EditorialImageAssetVariantFormat;
  originalSizeBytes: number;
  originalWidth: number;
  originalHeight: number;
  sha256Checksum: string;
  variants: Record<string, EditorialImageAssetVariant>;
  altAr: string;
  altEn?: string;
  captionAr?: string;
  captionEn?: string;
  photographerCredit?: string;
  licensingInfo?: string;
  tags?: string[];
  associatedArticleIds?: string[];
  status?: EditorialImageAssetStatus;
  createdAtIso?: string;
  updatedAtIso?: string;
}

export interface UpdateEditorialImageAssetInput {
  altAr?: string;
  altEn?: string;
  captionAr?: string;
  captionEn?: string;
  photographerCredit?: string;
  licensingInfo?: string;
  tags?: string[];
  associatedArticleIds?: string[];
}

export interface EditorialImageAssetValidationLimits {
  minAssetIdLength: number;
  maxAssetIdLength: number;
  maxAltTextLength: number;
  maxCaptionLength: number;
  maxCreditLength: number;
  maxLicensingLength: number;
  maxTagsCount: number;
  maxTagLength: number;
  maxSizeBytes: number;
  maxDimensionPx: number;
  allowedMimeTypes: EditorialImageAssetVariantFormat[];
  maxRightsHolderLength?: number;
  maxDocumentedExceptionLength?: number;
  maxLicenseDetailsLength?: number;
  maxSourceAttributionLength?: number;
  maxReviewReasonLength?: number;
  maxEvidenceRefsCount?: number;
  maxEvidenceRefLength?: number;
  maxScopeArticleIdsCount?: number;
  maxArticleIdLength?: number;
}

export const CANONICAL_ASSET_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export const CANONICAL_EDITORIAL_IMAGE_STORAGE_PREFIX = 'editorial_images/private';

export const CANONICAL_SHA256_CHECKSUM_REGEX = /^[a-f0-9]{64}$/;

export const CANONICAL_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const MAX_IMAGE_DIMENSION_PX = 10_000;

export const DEFAULT_ASSET_VALIDATION_LIMITS: EditorialImageAssetValidationLimits = {
  minAssetIdLength: 1,
  maxAssetIdLength: 128,
  maxAltTextLength: 500,
  maxCaptionLength: 1000,
  maxCreditLength: 200,
  maxLicensingLength: 500,
  maxTagsCount: 50,
  maxTagLength: 50,
  maxSizeBytes: 15_000_000,
  maxDimensionPx: MAX_IMAGE_DIMENSION_PX,
  allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png'],
  maxRightsHolderLength: 300,
  maxDocumentedExceptionLength: 500,
  maxLicenseDetailsLength: 500,
  maxSourceAttributionLength: 500,
  maxReviewReasonLength: 1000,
  maxEvidenceRefsCount: 50,
  maxEvidenceRefLength: 128,
  maxScopeArticleIdsCount: 100,
  maxArticleIdLength: 128,
};

export interface EditorialImageAssetValidationResult {
  valid: boolean;
  errors: string[];
}
