import {
  CANONICAL_ASSET_ID_REGEX,
  CANONICAL_EDITORIAL_IMAGE_STORAGE_PREFIX,
  CANONICAL_SHA256_CHECKSUM_REGEX,
  CANONICAL_UTC_TIMESTAMP_REGEX,
  DEFAULT_ASSET_VALIDATION_LIMITS,
  MAX_IMAGE_DIMENSION_PX,
  type CreateEditorialImageAssetInput,
  type EditorialImageAssetMetadata,
  type EditorialImageAssetOrigin,
  type EditorialImageAssetStatus,
  type EditorialImageAssetValidationLimits,
  type EditorialImageAssetValidationResult,
  type EditorialImageAssetVariant,
  type EditorialImageAssetVariantFormat,
  type EditorialImageAssetVariantKey,
  type EditorialImageLicenseType,
  type EditorialImageRightsRecord,
  type EditorialImageUsageScope,
  type EditorialImageUsageScopeType,
  type RightsReviewStatus,
  type UpdateEditorialImageAssetInput,
} from '../types/editorialImageAsset';

export {
  CANONICAL_ASSET_ID_REGEX,
  CANONICAL_EDITORIAL_IMAGE_STORAGE_PREFIX,
  CANONICAL_SHA256_CHECKSUM_REGEX,
  CANONICAL_UTC_TIMESTAMP_REGEX,
  MAX_IMAGE_DIMENSION_PX,
};

const ASSET_ID_CHARS_REGEX = /^[a-zA-Z0-9_-]+$/;
const UID_REGEX = /^[a-zA-Z0-9_-]+$/;
const EVIDENCE_REF_CHARS_REGEX = /^[a-zA-Z0-9_.:-]+$/;

const VALID_ORIGINS: EditorialImageAssetOrigin[] = [
  'news_article',
  'standalone_upload',
  'editorial_library',
];

const VALID_STATUSES: EditorialImageAssetStatus[] = ['active', 'archived', 'deleted'];

const VALID_RIGHTS_STATUSES: RightsReviewStatus[] = [
  'PendingReview',
  'Approved',
  'Rejected',
  'Revoked',
];

const VALID_LICENSE_TYPES: EditorialImageLicenseType[] = [
  'OriginalWork',
  'DirectLicense',
  'CreativeCommons',
  'PublicDomainClaim',
  'ContextSpecificAssessment',
  'Other',
];

const VALID_USAGE_SCOPE_TYPES: EditorialImageUsageScopeType[] = [
  'GeneralEditorial',
  'ArticleRestricted',
];

const GENERIC_CREATIVE_COMMONS_LABELS: ReadonlySet<string> = new Set([
  'cc',
  'creative commons',
  'creativecommons',
  'cc license',
  'creative commons license',
]);

const VALID_VARIANT_KEYS: EditorialImageAssetVariantKey[] = [
  'thumbnail',
  'card',
  'article_inline',
  'article_cover',
  'original_processed',
];

const ALLOWED_VARIANT_OBJECT_KEYS: ReadonlySet<string> = new Set([
  'variantKey',
  'storagePath',
  'mimeType',
  'width',
  'height',
  'sizeBytes',
  'sha256Checksum',
]);

const ALLOWED_USAGE_SCOPE_OBJECT_KEYS: ReadonlySet<string> = new Set([
  'scopeType',
  'articleIds',
]);

const ALLOWED_RIGHTS_RECORD_KEYS: ReadonlySet<string> = new Set([
  'status',
  'licenseType',
  'licenseDetails',
  'rightsHolder',
  'documentedException',
  'sourceAttributionAr',
  'sourceAttributionEn',
  'evidenceRefs',
  'usageScope',
  'reviewedByUid',
  'reviewedAtIso',
  'reviewReason',
]);

const ALLOWED_ASSET_METADATA_KEYS: ReadonlySet<string> = new Set([
  'assetId',
  'createdByUid',
  'createdAtIso',
  'updatedAtIso',
  'origin',
  'status',
  'rights',
  'originalFilename',
  'mimeType',
  'originalSizeBytes',
  'originalWidth',
  'originalHeight',
  'aspectRatio',
  'sha256Checksum',
  'variants',
  'altAr',
  'altEn',
  'captionAr',
  'captionEn',
  'photographerCredit',
  'licensingInfo',
  'tags',
  'associatedArticleIds',
]);

const ALLOWED_CREATE_ASSET_INPUT_KEYS: ReadonlySet<string> = new Set([
  'assetId',
  'createdByUid',
  'createdAtIso',
  'updatedAtIso',
  'origin',
  'status',
  'originalFilename',
  'mimeType',
  'originalSizeBytes',
  'originalWidth',
  'originalHeight',
  'sha256Checksum',
  'variants',
  'altAr',
  'altEn',
  'captionAr',
  'captionEn',
  'photographerCredit',
  'licensingInfo',
  'tags',
  'associatedArticleIds',
]);

const ALLOWED_UPDATE_ASSET_INPUT_KEYS: ReadonlySet<string> = new Set([
  'altAr',
  'altEn',
  'captionAr',
  'captionEn',
  'photographerCredit',
  'licensingInfo',
  'tags',
  'associatedArticleIds',
]);

const IMMUTABLE_ASSET_FIELDS: ReadonlySet<string> = new Set([
  'assetId',
  'createdByUid',
  'createdAtIso',
  'origin',
  'originalFilename',
  'mimeType',
  'originalSizeBytes',
  'originalWidth',
  'originalHeight',
  'aspectRatio',
  'sha256Checksum',
]);

const PROTECTED_TRANSITION_OR_VARIANT_FIELDS: ReadonlySet<string> = new Set([
  'status',
  'variants',
  'updatedAtIso',
]);

const PROTECTED_RIGHTS_OR_AUTHORIZATION_FIELDS: ReadonlySet<string> = new Set([
  'rights',
  'rightsStatus',
  'reviewedByUid',
  'reviewedAtIso',
  'reviewReason',
  'evidenceRefs',
  'usageScope',
  'licenseType',
  'licenseDetails',
  'rightsHolder',
  'documentedException',
  'sourceAttributionAr',
  'sourceAttributionEn',
  'isPublic',
  'isApproved',
  'rightsApproved',
  'approvedByUid',
  'approvedAtIso',
]);

const MIME_TO_EXTENSIONS: Record<EditorialImageAssetVariantFormat, readonly string[]> = {
  'image/webp': ['webp'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
};

const PRIMARY_MIME_EXTENSION: Record<EditorialImageAssetVariantFormat, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const ALLOWED_IMAGE_EXTENSIONS = new Set(['webp', 'jpg', 'jpeg', 'png']);

const PROHIBITED_URL_PATTERNS = [
  /https?:\/\//i,
  /gs:\/\//i,
  /file:\/\//i,
  /ftp:\/\//i,
  /data:/i,
  /blob:/i,
  /javascript:/i,
  /vbscript:/i,
  /token=/i,
  /access_token=/i,
  /alt=media/i,
  /x-goog-/i,
];

const PROHIBITED_STORAGE_URL_OR_TOKEN_PATTERNS = [
  ...PROHIBITED_URL_PATTERNS,
  /^\/\//,
  /[?#]/,
];

const PROHIBITED_EVIDENCE_CREDENTIAL_OR_PATH_PATTERNS = [
  ...PROHIBITED_STORAGE_URL_OR_TOKEN_PATTERNS,
  /editorial_images/i,
  /[\\/]/,
  /\.\./,
  /%/,
  /bearer/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /credential/i,
  /signature/i,
  /access[_-]?token/i,
  /id[_-]?token/i,
  /refresh[_-]?token/i,
];

function isString(val: unknown): val is string {
  return typeof val === 'string';
}

function isNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

function isInteger(val: unknown): val is number {
  return isNumber(val) && Number.isInteger(val);
}

function isPlainRecord(val: unknown): val is Record<string, any> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function getUnknownObjectKeys(
  obj: object,
  allowedKeys: ReadonlySet<string>
): string[] {
  const unknownKeys: string[] = [];
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowedKeys.has(key)) {
      unknownKeys.push(key);
    }
  }
  for (const sym of Object.getOwnPropertySymbols(obj)) {
    unknownKeys.push(String(sym));
  }
  return unknownKeys;
}

function hasOwnKey(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function isValidCanonicalUtcTimestamp(str: unknown): str is string {
  if (!isString(str)) return false;
  if (!CANONICAL_UTC_TIMESTAMP_REGEX.test(str)) return false;
  const timestamp = Date.parse(str);
  if (!Number.isFinite(timestamp)) return false;
  return new Date(timestamp).toISOString() === str;
}

export function validateSha256Checksum(
  checksum: unknown,
  fieldLabel = 'sha256Checksum'
): EditorialImageAssetValidationResult {
  const errors: string[] = [];
  if (!isString(checksum) || !CANONICAL_SHA256_CHECKSUM_REGEX.test(checksum)) {
    errors.push(
      `${fieldLabel} must be a 64-character lowercase hexadecimal SHA-256 string.`
    );
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

function containsProhibitedUrlPattern(str: string): boolean {
  return PROHIBITED_URL_PATTERNS.some((pattern) => pattern.test(str));
}

function containsProhibitedStorageUrlOrToken(str: string): boolean {
  return PROHIBITED_STORAGE_URL_OR_TOKEN_PATTERNS.some((pattern) => pattern.test(str));
}

function containsProhibitedEvidencePattern(str: string): boolean {
  return PROHIBITED_EVIDENCE_CREDENTIAL_OR_PATH_PATTERNS.some((pattern) => pattern.test(str));
}

export function validateAssetId(
  assetId: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetValidationResult {
  const errors: string[] = [];

  if (!isString(assetId)) {
    errors.push('Asset ID must be a string.');
    return { valid: false, errors };
  }

  const effectiveMinLength = Math.max(1, limits.minAssetIdLength);
  const effectiveMaxLength = Math.min(128, limits.maxAssetIdLength);

  if (effectiveMinLength > effectiveMaxLength) {
    errors.push(
      `Invalid assetId length limits: min (${effectiveMinLength}) exceeds max (${effectiveMaxLength}).`
    );
  }

  if (assetId.length < effectiveMinLength) {
    errors.push(`Asset ID length must be at least ${effectiveMinLength} characters.`);
  }

  if (assetId.length > effectiveMaxLength) {
    errors.push(`Asset ID length must not exceed ${effectiveMaxLength} characters.`);
  }

  if (!ASSET_ID_CHARS_REGEX.test(assetId)) {
    errors.push('Asset ID must contain only alphanumeric characters, hyphens, and underscores.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface ValidateEditorialImageStoragePathOptions {
  expectedAssetId?: string;
  expectedVariantKey?: string;
  expectedMimeType?: string;
  limits?: EditorialImageAssetValidationLimits;
}

export function buildEditorialImageVariantStoragePath(
  assetId: string,
  variantKey: EditorialImageAssetVariantKey,
  mimeType: EditorialImageAssetVariantFormat = 'image/webp',
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): string {
  const idValidation = validateAssetId(assetId, limits);
  if (!idValidation.valid) {
    throw new Error(`Invalid assetId for storagePath: ${idValidation.errors.join(' ')}`);
  }

  if (!VALID_VARIANT_KEYS.includes(variantKey)) {
    throw new Error(`Invalid variantKey for storagePath: '${String(variantKey)}'.`);
  }

  const ext = PRIMARY_MIME_EXTENSION[mimeType];
  if (!ext || !limits.allowedMimeTypes.includes(mimeType)) {
    throw new Error(`Invalid mimeType for storagePath: '${String(mimeType)}'.`);
  }

  return `${CANONICAL_EDITORIAL_IMAGE_STORAGE_PREFIX}/${assetId}/${variantKey}.${ext}`;
}

export function validateEditorialImageStoragePath(
  storagePath: unknown,
  options: ValidateEditorialImageStoragePathOptions = {}
): EditorialImageAssetValidationResult {
  const errors: string[] = [];
  const limits = options.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;

  if (!isString(storagePath) || storagePath.trim().length === 0) {
    errors.push('Variant storagePath must be a non-empty string.');
    return { valid: false, errors };
  }

  if (storagePath !== storagePath.trim() || /\s/.test(storagePath)) {
    errors.push('Variant storagePath must not contain leading, trailing, or internal whitespace.');
  }

  if (containsProhibitedStorageUrlOrToken(storagePath)) {
    errors.push(
      'Variant storagePath must not contain external URLs, blob/data URIs, or security tokens.'
    );
  }

  if (storagePath.includes('\\')) {
    errors.push('Variant storagePath must not contain backslashes.');
  }

  if (storagePath.startsWith('/') || storagePath.endsWith('/') || storagePath.includes('//')) {
    errors.push(
      'Variant storagePath must be a normalized relative path without leading, trailing, or duplicate slashes.'
    );
  }

  if (storagePath.includes('%')) {
    errors.push('Variant storagePath must not contain percent-encoded characters.');
  }

  const segments = storagePath.trim().split('/');
  if (segments.some((seg) => seg === '.' || seg === '..')) {
    errors.push('Variant storagePath must not contain path traversal segments ("." or "..").');
  }

  if (
    segments.length !== 4 ||
    segments[0] !== 'editorial_images' ||
    segments[1] !== 'private'
  ) {
    errors.push(
      'Variant storagePath must follow canonical format "editorial_images/private/<assetId>/<variantKey>.<ext>".'
    );
    return { valid: false, errors };
  }

  const pathAssetId = segments[2];
  const fileName = segments[3];

  const pathAssetIdValidation = validateAssetId(pathAssetId, limits);
  if (!pathAssetIdValidation.valid) {
    errors.push(`Variant storagePath contains invalid assetId segment '${pathAssetId}'.`);
  }

  if (options.expectedAssetId !== undefined && pathAssetId !== options.expectedAssetId) {
    errors.push(
      `Variant storagePath assetId segment '${pathAssetId}' does not match assetId '${options.expectedAssetId}'.`
    );
  }

  const dotIndex = fileName.indexOf('.');
  if (dotIndex <= 0 || dotIndex !== fileName.lastIndexOf('.') || dotIndex === fileName.length - 1) {
    errors.push(`Variant storagePath filename '${fileName}' must follow '<variantKey>.<ext>' format.`);
    return { valid: false, errors };
  }

  const pathVariantKey = fileName.slice(0, dotIndex);
  const pathExt = fileName.slice(dotIndex + 1);

  if (!VALID_VARIANT_KEYS.includes(pathVariantKey as EditorialImageAssetVariantKey)) {
    errors.push(
      `Variant storagePath filename key '${pathVariantKey}' is not a valid variantKey.`
    );
  }

  if (
    options.expectedVariantKey !== undefined &&
    VALID_VARIANT_KEYS.includes(options.expectedVariantKey as EditorialImageAssetVariantKey) &&
    pathVariantKey !== options.expectedVariantKey
  ) {
    errors.push(
      `Variant storagePath filename key '${pathVariantKey}' does not match variantKey '${options.expectedVariantKey}'.`
    );
  }

  if (!ALLOWED_IMAGE_EXTENSIONS.has(pathExt)) {
    errors.push(`Variant storagePath extension '.${pathExt}' is not an allowed image extension.`);
  } else if (
    options.expectedMimeType !== undefined &&
    limits.allowedMimeTypes.includes(options.expectedMimeType as EditorialImageAssetVariantFormat)
  ) {
    const allowedExtensions =
      MIME_TO_EXTENSIONS[options.expectedMimeType as EditorialImageAssetVariantFormat];
    if (!allowedExtensions.includes(pathExt)) {
      errors.push(
        `Variant storagePath extension '.${pathExt}' does not match mimeType '${options.expectedMimeType}'.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateEditorialImageAssetVariant(
  variant: unknown,
  expectedKey?: string,
  limitsOrExpectedAssetId: EditorialImageAssetValidationLimits | string = DEFAULT_ASSET_VALIDATION_LIMITS,
  maybeExpectedAssetId?: EditorialImageAssetValidationLimits | string
): EditorialImageAssetValidationResult {
  const errors: string[] = [];

  const limits: EditorialImageAssetValidationLimits =
    typeof limitsOrExpectedAssetId === 'object' && limitsOrExpectedAssetId !== null
      ? limitsOrExpectedAssetId
      : typeof maybeExpectedAssetId === 'object' && maybeExpectedAssetId !== null
        ? maybeExpectedAssetId
        : DEFAULT_ASSET_VALIDATION_LIMITS;

  const expectedAssetId: string | undefined =
    typeof limitsOrExpectedAssetId === 'string'
      ? limitsOrExpectedAssetId
      : typeof maybeExpectedAssetId === 'string'
        ? maybeExpectedAssetId
        : undefined;

  if (!isPlainRecord(variant)) {
    errors.push('Variant must be a plain non-null object.');
    return { valid: false, errors };
  }

  const v = variant;

  const unknownVariantKeys = getUnknownObjectKeys(v, ALLOWED_VARIANT_OBJECT_KEYS);
  for (const key of unknownVariantKeys) {
    errors.push(`Unexpected or disallowed field "${key}" on image variant.`);
  }

  if (
    !isString(v.variantKey) ||
    !VALID_VARIANT_KEYS.includes(v.variantKey as EditorialImageAssetVariantKey)
  ) {
    errors.push(`Invalid or missing variantKey: '${String(v.variantKey)}'.`);
  } else if (expectedKey && v.variantKey !== expectedKey) {
    errors.push(`Variant key '${String(v.variantKey)}' does not match record key '${expectedKey}'.`);
  }

  if (
    !isString(v.mimeType) ||
    !limits.allowedMimeTypes.includes(v.mimeType as EditorialImageAssetVariantFormat)
  ) {
    errors.push(`Variant mimeType must be one of: ${limits.allowedMimeTypes.join(', ')}.`);
  }

  const storagePathResult = validateEditorialImageStoragePath(v.storagePath, {
    expectedAssetId,
    expectedVariantKey: isString(v.variantKey) ? v.variantKey : expectedKey,
    expectedMimeType: isString(v.mimeType) ? v.mimeType : undefined,
    limits,
  });

  if (!storagePathResult.valid) {
    errors.push(...storagePathResult.errors);
  }

  const maxDimensionPx = Math.min(
    MAX_IMAGE_DIMENSION_PX,
    limits.maxDimensionPx ?? MAX_IMAGE_DIMENSION_PX
  );

  if (!isInteger(v.width) || v.width <= 0) {
    errors.push('Variant width must be a finite positive integer.');
  } else if (v.width > maxDimensionPx) {
    errors.push(`Variant width must not exceed ${maxDimensionPx} pixels.`);
  }

  if (!isInteger(v.height) || v.height <= 0) {
    errors.push('Variant height must be a finite positive integer.');
  } else if (v.height > maxDimensionPx) {
    errors.push(`Variant height must not exceed ${maxDimensionPx} pixels.`);
  }

  if (!isInteger(v.sizeBytes) || v.sizeBytes <= 0) {
    errors.push('Variant sizeBytes must be a positive integer.');
  } else if (v.sizeBytes > limits.maxSizeBytes) {
    errors.push(`Variant sizeBytes exceeds maximum allowed size of ${limits.maxSizeBytes} bytes.`);
  }

  const checksumResult = validateSha256Checksum(v.sha256Checksum, 'Variant sha256Checksum');
  if (!checksumResult.valid) {
    errors.push(...checksumResult.errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateEditorialImageUsageScope(
  usageScope: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetValidationResult {
  const errors: string[] = [];

  if (!isPlainRecord(usageScope)) {
    errors.push('rights.usageScope must be a plain non-null object.');
    return { valid: false, errors };
  }

  const unknownKeys = getUnknownObjectKeys(usageScope, ALLOWED_USAGE_SCOPE_OBJECT_KEYS);
  for (const key of unknownKeys) {
    errors.push(`Unexpected or disallowed field "${key}" on rights.usageScope.`);
  }

  const maxScopeArticleIdsCount =
    limits.maxScopeArticleIdsCount ?? DEFAULT_ASSET_VALIDATION_LIMITS.maxScopeArticleIdsCount ?? 100;
  const maxArticleIdLength =
    limits.maxArticleIdLength ?? DEFAULT_ASSET_VALIDATION_LIMITS.maxArticleIdLength ?? 128;

  if (
    !isString(usageScope.scopeType) ||
    !VALID_USAGE_SCOPE_TYPES.includes(usageScope.scopeType as EditorialImageUsageScopeType)
  ) {
    errors.push(`rights.usageScope.scopeType must be one of: ${VALID_USAGE_SCOPE_TYPES.join(', ')}.`);
    return { valid: false, errors };
  }

  if (usageScope.scopeType === 'GeneralEditorial') {
    if (
      usageScope.articleIds !== undefined &&
      (!Array.isArray(usageScope.articleIds) || usageScope.articleIds.length > 0)
    ) {
      errors.push('rights.usageScope with scopeType "GeneralEditorial" must not specify articleIds.');
    }
  } else if (usageScope.scopeType === 'ArticleRestricted') {
    if (!Array.isArray(usageScope.articleIds) || usageScope.articleIds.length === 0) {
      errors.push(
        'rights.usageScope with scopeType "ArticleRestricted" requires a non-empty articleIds array.'
      );
    } else if (usageScope.articleIds.length > maxScopeArticleIdsCount) {
      errors.push(
        `rights.usageScope.articleIds count must not exceed ${maxScopeArticleIdsCount}.`
      );
    } else {
      usageScope.articleIds.forEach((artId: unknown, idx: number) => {
        if (!isString(artId) || artId.trim().length === 0) {
          errors.push(`rights.usageScope.articleIds[${idx}] must be a non-empty string.`);
        } else if (artId !== artId.trim() || /\s/.test(artId)) {
          errors.push(`rights.usageScope.articleIds[${idx}] must not contain whitespace.`);
        } else if (artId.length > maxArticleIdLength) {
          errors.push(
            `rights.usageScope.articleIds[${idx}] length must not exceed ${maxArticleIdLength} characters.`
          );
        } else if (containsProhibitedUrlPattern(artId)) {
          errors.push(`rights.usageScope.articleIds[${idx}] contains prohibited URL patterns.`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateEditorialImageRights(
  rights: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetValidationResult {
  const errors: string[] = [];

  if (!isPlainRecord(rights)) {
    errors.push('rights must be a plain non-null object.');
    return { valid: false, errors };
  }

  const r = rights;

  // Fail-closed unknown field check on rights object
  const unknownRightsKeys = getUnknownObjectKeys(r, ALLOWED_RIGHTS_RECORD_KEYS);
  for (const key of unknownRightsKeys) {
    errors.push(`Unexpected or disallowed field "${key}" on editorial image rights record.`);
  }

  // 1. Validate status
  if (!isString(r.status) || !VALID_RIGHTS_STATUSES.includes(r.status as RightsReviewStatus)) {
    errors.push(`rights.status must be one of: ${VALID_RIGHTS_STATUSES.join(', ')}.`);
    return { valid: false, errors };
  }

  const status = r.status as RightsReviewStatus;

  const maxRightsHolderLength =
    limits.maxRightsHolderLength ?? DEFAULT_ASSET_VALIDATION_LIMITS.maxRightsHolderLength ?? 300;
  const maxDocumentedExceptionLength =
    limits.maxDocumentedExceptionLength ??
    DEFAULT_ASSET_VALIDATION_LIMITS.maxDocumentedExceptionLength ??
    500;
  const maxLicenseDetailsLength =
    limits.maxLicenseDetailsLength ?? DEFAULT_ASSET_VALIDATION_LIMITS.maxLicenseDetailsLength ?? 500;
  const maxSourceAttributionLength =
    limits.maxSourceAttributionLength ??
    DEFAULT_ASSET_VALIDATION_LIMITS.maxSourceAttributionLength ??
    500;
  const maxReviewReasonLength =
    limits.maxReviewReasonLength ?? DEFAULT_ASSET_VALIDATION_LIMITS.maxReviewReasonLength ?? 1000;
  const maxEvidenceRefsCount =
    limits.maxEvidenceRefsCount ?? DEFAULT_ASSET_VALIDATION_LIMITS.maxEvidenceRefsCount ?? 50;
  const maxEvidenceRefLength =
    limits.maxEvidenceRefLength ?? DEFAULT_ASSET_VALIDATION_LIMITS.maxEvidenceRefLength ?? 128;

  // 2. Validate optional/present common fields when supplied
  let validLicenseType = false;
  if (r.licenseType !== undefined) {
    if (
      !isString(r.licenseType) ||
      !VALID_LICENSE_TYPES.includes(r.licenseType as EditorialImageLicenseType)
    ) {
      errors.push(`rights.licenseType must be one of: ${VALID_LICENSE_TYPES.join(', ')}.`);
    } else {
      validLicenseType = true;
    }
  }

  let hasNonEmptyLicenseDetails = false;
  if (r.licenseDetails !== undefined) {
    if (!isString(r.licenseDetails) || r.licenseDetails.trim().length === 0) {
      errors.push('rights.licenseDetails must be a non-empty string when provided.');
    } else if (r.licenseDetails !== r.licenseDetails.trim()) {
      errors.push('rights.licenseDetails must not contain leading or trailing whitespace.');
    } else if (r.licenseDetails.length > maxLicenseDetailsLength) {
      errors.push(
        `rights.licenseDetails length must not exceed ${maxLicenseDetailsLength} characters.`
      );
    } else if (containsProhibitedUrlPattern(r.licenseDetails)) {
      errors.push('rights.licenseDetails contains prohibited URL or token patterns.');
    } else {
      hasNonEmptyLicenseDetails = true;
    }
  }

  let hasNonEmptyRightsHolder = false;
  if (r.rightsHolder !== undefined) {
    if (!isString(r.rightsHolder) || r.rightsHolder.trim().length === 0) {
      errors.push('rights.rightsHolder must be a non-empty string when provided.');
    } else if (r.rightsHolder !== r.rightsHolder.trim()) {
      errors.push('rights.rightsHolder must not contain leading or trailing whitespace.');
    } else if (r.rightsHolder.length > maxRightsHolderLength) {
      errors.push(
        `rights.rightsHolder length must not exceed ${maxRightsHolderLength} characters.`
      );
    } else if (containsProhibitedUrlPattern(r.rightsHolder)) {
      errors.push('rights.rightsHolder contains prohibited URL or token patterns.');
    } else {
      hasNonEmptyRightsHolder = true;
    }
  }

  let hasNonEmptyDocumentedException = false;
  if (r.documentedException !== undefined) {
    if (!isString(r.documentedException) || r.documentedException.trim().length === 0) {
      errors.push('rights.documentedException must be a non-empty string when provided.');
    } else if (r.documentedException !== r.documentedException.trim()) {
      errors.push('rights.documentedException must not contain leading or trailing whitespace.');
    } else if (r.documentedException.length > maxDocumentedExceptionLength) {
      errors.push(
        `rights.documentedException length must not exceed ${maxDocumentedExceptionLength} characters.`
      );
    } else if (containsProhibitedUrlPattern(r.documentedException)) {
      errors.push('rights.documentedException contains prohibited URL or token patterns.');
    } else {
      hasNonEmptyDocumentedException = true;
    }
  }

  let hasNonEmptySourceAttributionAr = false;
  if (r.sourceAttributionAr !== undefined) {
    if (!isString(r.sourceAttributionAr) || r.sourceAttributionAr.trim().length === 0) {
      errors.push('rights.sourceAttributionAr must be a non-empty string when provided.');
    } else if (r.sourceAttributionAr !== r.sourceAttributionAr.trim()) {
      errors.push('rights.sourceAttributionAr must not contain leading or trailing whitespace.');
    } else if (r.sourceAttributionAr.length > maxSourceAttributionLength) {
      errors.push(
        `rights.sourceAttributionAr length must not exceed ${maxSourceAttributionLength} characters.`
      );
    } else if (containsProhibitedUrlPattern(r.sourceAttributionAr)) {
      errors.push('rights.sourceAttributionAr contains prohibited URL or token patterns.');
    } else {
      hasNonEmptySourceAttributionAr = true;
    }
  }

  if (r.sourceAttributionEn !== undefined) {
    if (!isString(r.sourceAttributionEn) || r.sourceAttributionEn.trim().length === 0) {
      errors.push('rights.sourceAttributionEn must be a non-empty string when provided.');
    } else if (r.sourceAttributionEn !== r.sourceAttributionEn.trim()) {
      errors.push('rights.sourceAttributionEn must not contain leading or trailing whitespace.');
    } else if (r.sourceAttributionEn.length > maxSourceAttributionLength) {
      errors.push(
        `rights.sourceAttributionEn length must not exceed ${maxSourceAttributionLength} characters.`
      );
    } else if (containsProhibitedUrlPattern(r.sourceAttributionEn)) {
      errors.push('rights.sourceAttributionEn contains prohibited URL or token patterns.');
    }
  }

  let hasValidNonEmptyEvidenceRefs = false;
  if (r.evidenceRefs !== undefined) {
    if (!Array.isArray(r.evidenceRefs)) {
      errors.push('rights.evidenceRefs must be an array of opaque identifier strings.');
    } else if (r.evidenceRefs.length > maxEvidenceRefsCount) {
      errors.push(`rights.evidenceRefs count must not exceed ${maxEvidenceRefsCount}.`);
    } else {
      let allRefsValid = true;
      r.evidenceRefs.forEach((ref: unknown, idx: number) => {
        if (!isString(ref) || ref.trim().length === 0) {
          errors.push(`rights.evidenceRefs[${idx}] must be a non-empty string.`);
          allRefsValid = false;
        } else if (ref !== ref.trim() || /\s/.test(ref)) {
          errors.push(`rights.evidenceRefs[${idx}] must not contain whitespace.`);
          allRefsValid = false;
        } else if (ref.length > maxEvidenceRefLength) {
          errors.push(
            `rights.evidenceRefs[${idx}] length must not exceed ${maxEvidenceRefLength} characters.`
          );
          allRefsValid = false;
        } else if (containsProhibitedEvidencePattern(ref)) {
          errors.push(
            `rights.evidenceRefs[${idx}] must be an opaque identifier and must not contain URLs, private storage paths, tokens, or credentials.`
          );
          allRefsValid = false;
        } else if (!EVIDENCE_REF_CHARS_REGEX.test(ref)) {
          errors.push(
            `rights.evidenceRefs[${idx}] contains disallowed characters; only alphanumeric, '_', '-', '.', and ':' are permitted.`
          );
          allRefsValid = false;
        }
      });
      if (allRefsValid && r.evidenceRefs.length > 0) {
        hasValidNonEmptyEvidenceRefs = true;
      }
    }
  }

  let hasValidUsageScope = false;
  if (r.usageScope !== undefined) {
    const scopeRes = validateEditorialImageUsageScope(r.usageScope, limits);
    if (!scopeRes.valid) {
      errors.push(...scopeRes.errors);
    } else {
      hasValidUsageScope = true;
    }
  }

  let hasValidReviewedByUid = false;
  if (r.reviewedByUid !== undefined) {
    if (!isString(r.reviewedByUid) || r.reviewedByUid.length === 0) {
      errors.push('rights.reviewedByUid must be a non-empty string.');
    } else if (!UID_REGEX.test(r.reviewedByUid)) {
      errors.push('rights.reviewedByUid contains invalid characters or whitespace.');
    } else if (containsProhibitedUrlPattern(r.reviewedByUid)) {
      errors.push('rights.reviewedByUid contains prohibited patterns.');
    } else {
      hasValidReviewedByUid = true;
    }
  }

  let hasValidReviewedAtIso = false;
  if (r.reviewedAtIso !== undefined) {
    if (!isValidCanonicalUtcTimestamp(r.reviewedAtIso)) {
      errors.push(
        'rights.reviewedAtIso must be a valid canonical UTC ISO-8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ).'
      );
    } else {
      hasValidReviewedAtIso = true;
    }
  }

  let hasNonEmptyReviewReason = false;
  if (r.reviewReason !== undefined) {
    if (!isString(r.reviewReason) || r.reviewReason.trim().length === 0) {
      errors.push('rights.reviewReason must be a non-empty string when provided.');
    } else if (r.reviewReason !== r.reviewReason.trim()) {
      errors.push('rights.reviewReason must not contain leading or trailing whitespace.');
    } else if (r.reviewReason.length > maxReviewReasonLength) {
      errors.push(`rights.reviewReason length must not exceed ${maxReviewReasonLength} characters.`);
    } else if (containsProhibitedUrlPattern(r.reviewReason)) {
      errors.push('rights.reviewReason contains prohibited URL or token patterns.');
    } else {
      hasNonEmptyReviewReason = true;
    }
  }

  // 3. Status-specific requirements
  if (status === 'PendingReview') {
    if (r.reviewedByUid !== undefined) {
      errors.push('rights with status "PendingReview" must not include reviewedByUid.');
    }
    if (r.reviewedAtIso !== undefined) {
      errors.push('rights with status "PendingReview" must not include reviewedAtIso.');
    }
    if (r.reviewReason !== undefined) {
      errors.push('rights with status "PendingReview" must not include reviewReason.');
    }
  } else if (status === 'Approved') {
    if (!validLicenseType) {
      errors.push('Approved rights record requires a valid rights.licenseType.');
    }
    if (!hasNonEmptyRightsHolder && !hasNonEmptyDocumentedException) {
      errors.push(
        'Approved rights record requires rights.rightsHolder or rights.documentedException.'
      );
    }
    if (!hasNonEmptySourceAttributionAr) {
      errors.push('Approved rights record requires non-empty rights.sourceAttributionAr.');
    }
    if (!hasValidNonEmptyEvidenceRefs) {
      errors.push('Approved rights record requires at least one valid reference in rights.evidenceRefs.');
    }
    if (!hasValidUsageScope) {
      errors.push('Approved rights record requires a valid rights.usageScope.');
    }
    if (!hasValidReviewedByUid) {
      errors.push('Approved rights record requires a valid non-empty rights.reviewedByUid.');
    }
    if (!hasValidReviewedAtIso) {
      errors.push('Approved rights record requires a valid canonical UTC rights.reviewedAtIso.');
    }

    if (validLicenseType) {
      const licenseType = r.licenseType as EditorialImageLicenseType;

      if (licenseType === 'CreativeCommons') {
        if (!hasNonEmptyLicenseDetails) {
          errors.push(
            'Approved CreativeCommons rights record requires specific rights.licenseDetails (e.g. CC-BY-4.0).'
          );
        } else {
          const normalizedDetails = (r.licenseDetails as string).trim().toLowerCase();
          if (GENERIC_CREATIVE_COMMONS_LABELS.has(normalizedDetails)) {
            errors.push(
              'Approved CreativeCommons rights record requires a specific license identifier in rights.licenseDetails, not a generic Creative Commons label.'
            );
          }
        }
      } else if (licenseType === 'DirectLicense' || licenseType === 'Other') {
        if (!hasNonEmptyLicenseDetails) {
          errors.push(
            `Approved ${licenseType} rights record requires non-empty rights.licenseDetails.`
          );
        }
      } else if (licenseType === 'PublicDomainClaim') {
        if (!hasNonEmptyLicenseDetails && !hasNonEmptyDocumentedException) {
          errors.push(
            'Approved PublicDomainClaim rights record requires rights.licenseDetails or rights.documentedException.'
          );
        }
        if (!hasNonEmptyReviewReason) {
          errors.push(
            'Approved PublicDomainClaim rights record requires supporting rationale in rights.reviewReason.'
          );
        }
      } else if (licenseType === 'ContextSpecificAssessment') {
        if (!hasNonEmptyLicenseDetails && !hasNonEmptyDocumentedException) {
          errors.push(
            'Approved ContextSpecificAssessment rights record requires rights.licenseDetails or rights.documentedException.'
          );
        }
        if (!hasNonEmptyReviewReason) {
          errors.push(
            'Approved ContextSpecificAssessment rights record requires supporting rationale in rights.reviewReason.'
          );
        }
        if (
          hasValidUsageScope &&
          (r.usageScope as EditorialImageUsageScope).scopeType !== 'ArticleRestricted'
        ) {
          errors.push(
            'Approved ContextSpecificAssessment rights record prohibits GeneralEditorial usageScope and requires ArticleRestricted scope with explicit articleIds.'
          );
        }
      }
    }
  } else if (status === 'Rejected') {
    if (!hasValidReviewedByUid) {
      errors.push('Rejected rights record requires a valid non-empty rights.reviewedByUid.');
    }
    if (!hasValidReviewedAtIso) {
      errors.push('Rejected rights record requires a valid canonical UTC rights.reviewedAtIso.');
    }
    if (!hasNonEmptyReviewReason) {
      errors.push('Rejected rights record requires a non-empty rejection reason in rights.reviewReason.');
    }
  } else if (status === 'Revoked') {
    if (!hasValidReviewedByUid) {
      errors.push('Revoked rights record requires a valid non-empty rights.reviewedByUid.');
    }
    if (!hasValidReviewedAtIso) {
      errors.push('Revoked rights record requires a valid canonical UTC rights.reviewedAtIso.');
    }
    if (!hasNonEmptyReviewReason) {
      errors.push('Revoked rights record requires a non-empty revocation reason in rights.reviewReason.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateEditorialImageAsset(
  asset: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetValidationResult {
  const errors: string[] = [];

  if (!isPlainRecord(asset)) {
    errors.push('Editorial image asset must be a plain non-null object.');
    return { valid: false, errors };
  }

  const a = asset;

  // 0. Fail-closed unknown field validation
  const unknownAssetKeys = getUnknownObjectKeys(a, ALLOWED_ASSET_METADATA_KEYS);
  for (const key of unknownAssetKeys) {
    errors.push(`Unexpected or disallowed field "${key}" on editorial image asset.`);
  }

  // 1. assetId
  const idRes = validateAssetId(a.assetId, limits);
  if (!idRes.valid) {
    errors.push(...idRes.errors);
  }

  // 2. createdByUid (strict identifier check without silent whitespace trimming)
  if (!isString(a.createdByUid) || a.createdByUid.length === 0) {
    errors.push('createdByUid must be a non-empty string.');
  } else if (!UID_REGEX.test(a.createdByUid)) {
    errors.push('createdByUid contains invalid characters or whitespace.');
  } else if (containsProhibitedUrlPattern(a.createdByUid)) {
    errors.push('createdByUid contains prohibited patterns.');
  }

  // 3. Canonical UTC Timestamps & Chronological Consistency
  const validCreatedAt = isValidCanonicalUtcTimestamp(a.createdAtIso);
  const validUpdatedAt = isValidCanonicalUtcTimestamp(a.updatedAtIso);

  if (!validCreatedAt) {
    errors.push(
      'createdAtIso must be a valid canonical UTC ISO-8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ).'
    );
  }
  if (!validUpdatedAt) {
    errors.push(
      'updatedAtIso must be a valid canonical UTC ISO-8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ).'
    );
  }
  if (validCreatedAt && validUpdatedAt) {
    if (Date.parse(a.updatedAtIso as string) < Date.parse(a.createdAtIso as string)) {
      errors.push('updatedAtIso must be greater than or equal to createdAtIso.');
    }
  }

  // 4. Origin & Status
  if (!isString(a.origin) || !VALID_ORIGINS.includes(a.origin as EditorialImageAssetOrigin)) {
    errors.push(`origin must be one of: ${VALID_ORIGINS.join(', ')}.`);
  }
  if (!isString(a.status) || !VALID_STATUSES.includes(a.status as EditorialImageAssetStatus)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}.`);
  }

  // 4b. Rights & Human Review Metadata
  const rightsRes = validateEditorialImageRights(a.rights, limits);
  if (!rightsRes.valid) {
    errors.push(...rightsRes.errors);
  } else if (
    isPlainRecord(a.rights) &&
    isValidCanonicalUtcTimestamp(a.rights.reviewedAtIso)
  ) {
    const reviewedAtMs = Date.parse(a.rights.reviewedAtIso);
    if (validCreatedAt && reviewedAtMs < Date.parse(a.createdAtIso as string)) {
      errors.push('rights.reviewedAtIso must be greater than or equal to createdAtIso.');
    }
    if (validUpdatedAt && reviewedAtMs > Date.parse(a.updatedAtIso as string)) {
      errors.push('rights.reviewedAtIso must be less than or equal to updatedAtIso.');
    }
  }

  // 5. Filename, Original details, Dimensions & SHA-256 Checksum
  if (!isString(a.originalFilename) || a.originalFilename.trim().length === 0) {
    errors.push('originalFilename must be a non-empty string.');
  } else if (a.originalFilename !== a.originalFilename.trim()) {
    errors.push('originalFilename must not contain leading or trailing whitespace.');
  } else if (a.originalFilename.length > 255) {
    errors.push('originalFilename must not exceed 255 characters.');
  } else if (containsProhibitedUrlPattern(a.originalFilename)) {
    errors.push('originalFilename contains prohibited URL or token patterns.');
  }

  if (
    !isString(a.mimeType) ||
    !limits.allowedMimeTypes.includes(a.mimeType as EditorialImageAssetVariantFormat)
  ) {
    errors.push(`mimeType must be one of: ${limits.allowedMimeTypes.join(', ')}.`);
  }

  if (!isInteger(a.originalSizeBytes) || a.originalSizeBytes <= 0) {
    errors.push('originalSizeBytes must be a positive integer.');
  } else if (a.originalSizeBytes > limits.maxSizeBytes) {
    errors.push(`originalSizeBytes exceeds maximum limit of ${limits.maxSizeBytes} bytes.`);
  }

  const maxDimensionPx = Math.min(
    MAX_IMAGE_DIMENSION_PX,
    limits.maxDimensionPx ?? MAX_IMAGE_DIMENSION_PX
  );

  const validOrigWidth =
    isInteger(a.originalWidth) && a.originalWidth > 0 && a.originalWidth <= maxDimensionPx;
  const validOrigHeight =
    isInteger(a.originalHeight) && a.originalHeight > 0 && a.originalHeight <= maxDimensionPx;

  if (!isInteger(a.originalWidth) || a.originalWidth <= 0) {
    errors.push('originalWidth must be a finite positive integer.');
  } else if (a.originalWidth > maxDimensionPx) {
    errors.push(`originalWidth must not exceed ${maxDimensionPx} pixels.`);
  }

  if (!isInteger(a.originalHeight) || a.originalHeight <= 0) {
    errors.push('originalHeight must be a finite positive integer.');
  } else if (a.originalHeight > maxDimensionPx) {
    errors.push(`originalHeight must not exceed ${maxDimensionPx} pixels.`);
  }

  if (!isNumber(a.aspectRatio) || a.aspectRatio <= 0) {
    errors.push('aspectRatio must be a positive number.');
  } else if (validOrigWidth && validOrigHeight) {
    const calculated = (a.originalWidth as number) / (a.originalHeight as number);
    if (Math.abs(a.aspectRatio - calculated) > 0.01) {
      errors.push(
        `aspectRatio (${a.aspectRatio}) does not match originalWidth/originalHeight (${calculated.toFixed(4)}).`
      );
    }
  }

  const assetChecksumRes = validateSha256Checksum(a.sha256Checksum, 'sha256Checksum');
  if (!assetChecksumRes.valid) {
    errors.push(...assetChecksumRes.errors);
  }

  // 6. Variants
  if (!isPlainRecord(a.variants)) {
    errors.push('variants must be a plain non-null object.');
  } else {
    const variantPropertyNames = Object.getOwnPropertyNames(a.variants);
    const variantSymbols = Object.getOwnPropertySymbols(a.variants);

    for (const sym of variantSymbols) {
      errors.push(`Unexpected symbol property "${String(sym)}" on variants object.`);
    }

    if (variantPropertyNames.length === 0) {
      errors.push('variants object must contain at least one image variant.');
    } else {
      const expectedAssetId = isString(a.assetId) ? a.assetId : undefined;
      for (const k of variantPropertyNames) {
        if (!VALID_VARIANT_KEYS.includes(k as EditorialImageAssetVariantKey)) {
          errors.push(`Unexpected or disallowed variant key "${k}" in variants record.`);
        }
        const varRes = validateEditorialImageAssetVariant(
          a.variants[k],
          k,
          limits,
          expectedAssetId
        );
        if (!varRes.valid) {
          errors.push(...varRes.errors.map((e) => `[variant '${k}'] ${e}`));
        }
      }
    }
  }

  // 7. Alt text
  if (!isString(a.altAr) || a.altAr.trim().length === 0) {
    errors.push('altAr (Arabic alt text) is required and must be non-empty.');
  } else if (a.altAr.length > limits.maxAltTextLength) {
    errors.push(`altAr length must not exceed ${limits.maxAltTextLength} characters.`);
  } else if (containsProhibitedUrlPattern(a.altAr)) {
    errors.push('altAr contains prohibited URL or token patterns.');
  }

  if (a.altEn !== undefined) {
    if (!isString(a.altEn)) {
      errors.push('altEn must be a string.');
    } else if (a.altEn.length > limits.maxAltTextLength) {
      errors.push(`altEn length must not exceed ${limits.maxAltTextLength} characters.`);
    } else if (containsProhibitedUrlPattern(a.altEn)) {
      errors.push('altEn contains prohibited URL or token patterns.');
    }
  }

  // 8. Captions
  if (a.captionAr !== undefined) {
    if (!isString(a.captionAr)) {
      errors.push('captionAr must be a string.');
    } else if (a.captionAr.length > limits.maxCaptionLength) {
      errors.push(`captionAr length must not exceed ${limits.maxCaptionLength} characters.`);
    } else if (containsProhibitedUrlPattern(a.captionAr)) {
      errors.push('captionAr contains prohibited URL or token patterns.');
    }
  }

  if (a.captionEn !== undefined) {
    if (!isString(a.captionEn)) {
      errors.push('captionEn must be a string.');
    } else if (a.captionEn.length > limits.maxCaptionLength) {
      errors.push(`captionEn length must not exceed ${limits.maxCaptionLength} characters.`);
    } else if (containsProhibitedUrlPattern(a.captionEn)) {
      errors.push('captionEn contains prohibited URL or token patterns.');
    }
  }

  // 9. Photographer Credit & Licensing
  if (a.photographerCredit !== undefined) {
    if (!isString(a.photographerCredit)) {
      errors.push('photographerCredit must be a string.');
    } else if (a.photographerCredit.length > limits.maxCreditLength) {
      errors.push(`photographerCredit length must not exceed ${limits.maxCreditLength} characters.`);
    } else if (containsProhibitedUrlPattern(a.photographerCredit)) {
      errors.push('photographerCredit contains prohibited URL or token patterns.');
    }
  }

  if (a.licensingInfo !== undefined) {
    if (!isString(a.licensingInfo)) {
      errors.push('licensingInfo must be a string.');
    } else if (a.licensingInfo.length > limits.maxLicensingLength) {
      errors.push(`licensingInfo length must not exceed ${limits.maxLicensingLength} characters.`);
    } else if (containsProhibitedUrlPattern(a.licensingInfo)) {
      errors.push('licensingInfo contains prohibited URL or token patterns.');
    }
  }

  // 10. Tags
  if (a.tags !== undefined) {
    if (!Array.isArray(a.tags)) {
      errors.push('tags must be an array of strings.');
    } else if (a.tags.length > limits.maxTagsCount) {
      errors.push(`tags count must not exceed ${limits.maxTagsCount}.`);
    } else {
      a.tags.forEach((tag, idx) => {
        if (!isString(tag)) {
          errors.push(`tag at index ${idx} must be a string.`);
        } else if (tag.trim().length === 0) {
          errors.push(`tag at index ${idx} must not be empty.`);
        } else if (tag !== tag.trim()) {
          errors.push(`tag at index ${idx} must not contain leading or trailing whitespace.`);
        } else if (tag.length > limits.maxTagLength) {
          errors.push(`tag at index ${idx} exceeds max length of ${limits.maxTagLength}.`);
        } else if (containsProhibitedUrlPattern(tag)) {
          errors.push(`tag at index ${idx} contains prohibited URL patterns.`);
        }
      });
    }
  }

  // 11. Associated Article IDs
  const maxArticleIdLength =
    limits.maxArticleIdLength ?? DEFAULT_ASSET_VALIDATION_LIMITS.maxArticleIdLength ?? 128;

  if (a.associatedArticleIds !== undefined) {
    if (!Array.isArray(a.associatedArticleIds)) {
      errors.push('associatedArticleIds must be an array of strings.');
    } else {
      a.associatedArticleIds.forEach((artId, idx) => {
        if (!isString(artId) || artId.trim().length === 0) {
          errors.push(`associatedArticleId at index ${idx} must be a non-empty string.`);
        } else if (artId !== artId.trim() || /\s/.test(artId)) {
          errors.push(`associatedArticleId at index ${idx} must not contain whitespace.`);
        } else if (artId.length > maxArticleIdLength) {
          errors.push(
            `associatedArticleId at index ${idx} length must not exceed ${maxArticleIdLength} characters.`
          );
        } else if (containsProhibitedUrlPattern(artId)) {
          errors.push(`associatedArticleId at index ${idx} contains prohibited URL patterns.`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function cloneValidatedRightsRecord(
  rights: EditorialImageRightsRecord
): EditorialImageRightsRecord {
  const clonedRights: EditorialImageRightsRecord = {
    status: rights.status,
  };

  if (rights.licenseType !== undefined) clonedRights.licenseType = rights.licenseType;
  if (rights.licenseDetails !== undefined) clonedRights.licenseDetails = rights.licenseDetails;
  if (rights.rightsHolder !== undefined) clonedRights.rightsHolder = rights.rightsHolder;
  if (rights.documentedException !== undefined)
    clonedRights.documentedException = rights.documentedException;
  if (rights.sourceAttributionAr !== undefined)
    clonedRights.sourceAttributionAr = rights.sourceAttributionAr;
  if (rights.sourceAttributionEn !== undefined)
    clonedRights.sourceAttributionEn = rights.sourceAttributionEn;
  if (rights.evidenceRefs !== undefined) clonedRights.evidenceRefs = [...rights.evidenceRefs];
  if (rights.usageScope !== undefined) {
    const clonedScope: EditorialImageUsageScope = {
      scopeType: rights.usageScope.scopeType,
    };
    if (rights.usageScope.articleIds !== undefined) {
      clonedScope.articleIds = [...rights.usageScope.articleIds];
    }
    clonedRights.usageScope = clonedScope;
  }
  if (rights.reviewedByUid !== undefined) clonedRights.reviewedByUid = rights.reviewedByUid;
  if (rights.reviewedAtIso !== undefined) clonedRights.reviewedAtIso = rights.reviewedAtIso;
  if (rights.reviewReason !== undefined) clonedRights.reviewReason = rights.reviewReason;

  return clonedRights;
}

function cloneValidatedAssetMetadata(
  asset: EditorialImageAssetMetadata
): EditorialImageAssetMetadata {
  const cleanVariants: Record<string, EditorialImageAssetVariant> = {};

  for (const [k, v] of Object.entries(asset.variants)) {
    cleanVariants[k] = {
      variantKey: v.variantKey,
      storagePath: v.storagePath,
      mimeType: v.mimeType,
      width: v.width,
      height: v.height,
      sizeBytes: v.sizeBytes,
      sha256Checksum: v.sha256Checksum,
    };
  }

  const cloned: EditorialImageAssetMetadata = {
    assetId: asset.assetId,
    createdByUid: asset.createdByUid,
    createdAtIso: asset.createdAtIso,
    updatedAtIso: asset.updatedAtIso,
    origin: asset.origin,
    status: asset.status,
    rights: cloneValidatedRightsRecord(asset.rights),
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    originalSizeBytes: asset.originalSizeBytes,
    originalWidth: asset.originalWidth,
    originalHeight: asset.originalHeight,
    aspectRatio: asset.aspectRatio,
    sha256Checksum: asset.sha256Checksum,
    variants: cleanVariants,
    altAr: asset.altAr,
  };

  if (asset.altEn !== undefined) cloned.altEn = asset.altEn;
  if (asset.captionAr !== undefined) cloned.captionAr = asset.captionAr;
  if (asset.captionEn !== undefined) cloned.captionEn = asset.captionEn;
  if (asset.photographerCredit !== undefined)
    cloned.photographerCredit = asset.photographerCredit;
  if (asset.licensingInfo !== undefined) cloned.licensingInfo = asset.licensingInfo;
  if (asset.tags !== undefined) cloned.tags = [...asset.tags];
  if (asset.associatedArticleIds !== undefined)
    cloned.associatedArticleIds = [...asset.associatedArticleIds];

  return cloned;
}

export function sanitizeEditorialImageAssetMetadata(
  asset: EditorialImageAssetMetadata,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetMetadata {
  const validation = validateEditorialImageAsset(asset, limits);
  if (!validation.valid) {
    throw new Error(
      `Failed to sanitize EditorialImageAssetMetadata due to validation errors:\n- ${validation.errors.join('\n- ')}`
    );
  }

  return cloneValidatedAssetMetadata(asset);
}

export function createEditorialImageAssetRecord(
  input: CreateEditorialImageAssetInput,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetMetadata {
  if (!isPlainRecord(input)) {
    throw new Error(
      'Failed to create EditorialImageAssetRecord: input must be a plain non-null object.'
    );
  }

  const preflightErrors: string[] = [];

  const unknownInputKeys = getUnknownObjectKeys(input, ALLOWED_CREATE_ASSET_INPUT_KEYS);
  for (const key of unknownInputKeys) {
    if (PROTECTED_RIGHTS_OR_AUTHORIZATION_FIELDS.has(key)) {
      preflightErrors.push(
        `Unexpected or disallowed rights/authorization field "${key}" on editorial image asset creation input: new assets must begin with PendingReview rights status.`
      );
    } else {
      preflightErrors.push(
        `Unexpected or disallowed field "${key}" on editorial image asset creation input.`
      );
    }
  }

  if (input.status !== undefined && input.status !== 'active') {
    preflightErrors.push(
      `Prohibited initial lifecycle status "${String(input.status)}": new editorial image assets must be created with status "active".`
    );
  }

  const nowIso = new Date().toISOString();

  const createdAtIso = hasOwnKey(input, 'createdAtIso')
    ? (input.createdAtIso as string)
    : nowIso;
  const updatedAtIso = hasOwnKey(input, 'updatedAtIso')
    ? (input.updatedAtIso as string)
    : hasOwnKey(input, 'createdAtIso')
      ? (input.createdAtIso as string)
      : nowIso;

  const maxDimensionPx = Math.min(
    MAX_IMAGE_DIMENSION_PX,
    limits.maxDimensionPx ?? MAX_IMAGE_DIMENSION_PX
  );

  const validDimensions =
    isInteger(input.originalWidth) &&
    input.originalWidth > 0 &&
    input.originalWidth <= maxDimensionPx &&
    isInteger(input.originalHeight) &&
    input.originalHeight > 0 &&
    input.originalHeight <= maxDimensionPx;

  const calculatedAspectRatio = validDimensions
    ? Number((input.originalWidth / input.originalHeight).toFixed(4))
    : Number.NaN;

  const candidate: EditorialImageAssetMetadata = {
    assetId: input.assetId,
    createdByUid: input.createdByUid,
    createdAtIso,
    updatedAtIso,
    origin: input.origin,
    status: hasOwnKey(input, 'status') ? (input.status as EditorialImageAssetStatus) : 'active',
    rights: {
      status: 'PendingReview',
    },
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    originalSizeBytes: input.originalSizeBytes,
    originalWidth: input.originalWidth,
    originalHeight: input.originalHeight,
    aspectRatio: calculatedAspectRatio,
    sha256Checksum: input.sha256Checksum,
    variants: input.variants,
    altAr: input.altAr,
  };

  if (hasOwnKey(input, 'altEn') && input.altEn !== undefined) candidate.altEn = input.altEn;
  if (hasOwnKey(input, 'captionAr') && input.captionAr !== undefined)
    candidate.captionAr = input.captionAr;
  if (hasOwnKey(input, 'captionEn') && input.captionEn !== undefined)
    candidate.captionEn = input.captionEn;
  if (hasOwnKey(input, 'photographerCredit') && input.photographerCredit !== undefined)
    candidate.photographerCredit = input.photographerCredit;
  if (hasOwnKey(input, 'licensingInfo') && input.licensingInfo !== undefined)
    candidate.licensingInfo = input.licensingInfo;
  if (hasOwnKey(input, 'tags') && input.tags !== undefined) candidate.tags = input.tags;
  if (hasOwnKey(input, 'associatedArticleIds') && input.associatedArticleIds !== undefined)
    candidate.associatedArticleIds = input.associatedArticleIds;

  const validation = validateEditorialImageAsset(candidate, limits);
  const allErrors = [...preflightErrors, ...validation.errors];

  if (allErrors.length > 0) {
    throw new Error(
      `Failed to create EditorialImageAssetRecord due to validation errors:\n- ${allErrors.join('\n- ')}`
    );
  }

  return sanitizeEditorialImageAssetMetadata(candidate, limits);
}

export function updateEditorialImageAssetRecord(
  current: EditorialImageAssetMetadata,
  input: UpdateEditorialImageAssetInput,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetMetadata {
  if (!isPlainRecord(current)) {
    throw new Error(
      'Failed to update EditorialImageAssetRecord: current record must be a plain non-null object.'
    );
  }
  if (!isPlainRecord(input)) {
    throw new Error(
      'Failed to update EditorialImageAssetRecord: update input must be a plain non-null object.'
    );
  }

  // A. Validate the full existing canonical record BEFORE applying any update
  const currentValidation = validateEditorialImageAsset(current, limits);
  if (!currentValidation.valid) {
    throw new Error(
      `Failed to update EditorialImageAssetRecord because existing record is invalid:\n- ${currentValidation.errors.join('\n- ')}`
    );
  }

  // B. Validate the raw update input keys (reject immutable, lifecycle/variant, rights/review, and unknown fields)
  const patchErrors: string[] = [];
  const unknownUpdateKeys = getUnknownObjectKeys(input, ALLOWED_UPDATE_ASSET_INPUT_KEYS);

  for (const key of unknownUpdateKeys) {
    if (IMMUTABLE_ASSET_FIELDS.has(key)) {
      patchErrors.push(
        `Cannot modify immutable identity or verified-file property "${key}" on editorial image asset.`
      );
    } else if (PROTECTED_TRANSITION_OR_VARIANT_FIELDS.has(key)) {
      patchErrors.push(
        `Cannot modify protected lifecycle or variant property "${key}" via generic editorial metadata update.`
      );
    } else if (PROTECTED_RIGHTS_OR_AUTHORIZATION_FIELDS.has(key) || key.startsWith('rights.')) {
      patchErrors.push(
        `Unexpected or disallowed field "${key}": cannot modify protected rights or human-review metadata via generic editorial metadata update.`
      );
    } else {
      patchErrors.push(
        `Unexpected or disallowed field "${key}" on editorial image asset update input.`
      );
    }
  }

  if (patchErrors.length > 0) {
    throw new Error(
      `Failed to update EditorialImageAssetRecord due to disallowed update fields:\n- ${patchErrors.join('\n- ')}`
    );
  }

  const nextUpdatedAtIso = new Date().toISOString();

  if (Date.parse(nextUpdatedAtIso) < Date.parse(current.updatedAtIso)) {
    throw new Error(
      'Failed to update EditorialImageAssetRecord: generated updatedAtIso precedes existing updatedAtIso.'
    );
  }

  const baseClone = cloneValidatedAssetMetadata(current);

  const updatedCandidate: EditorialImageAssetMetadata = {
    ...baseClone,
    updatedAtIso: nextUpdatedAtIso,
  };

  if (hasOwnKey(input, 'altAr')) {
    updatedCandidate.altAr = input.altAr as string;
  }
  if (hasOwnKey(input, 'altEn')) {
    if (input.altEn === undefined) {
      delete updatedCandidate.altEn;
    } else {
      updatedCandidate.altEn = input.altEn;
    }
  }
  if (hasOwnKey(input, 'captionAr')) {
    if (input.captionAr === undefined) {
      delete updatedCandidate.captionAr;
    } else {
      updatedCandidate.captionAr = input.captionAr;
    }
  }
  if (hasOwnKey(input, 'captionEn')) {
    if (input.captionEn === undefined) {
      delete updatedCandidate.captionEn;
    } else {
      updatedCandidate.captionEn = input.captionEn;
    }
  }
  if (hasOwnKey(input, 'photographerCredit')) {
    if (input.photographerCredit === undefined) {
      delete updatedCandidate.photographerCredit;
    } else {
      updatedCandidate.photographerCredit = input.photographerCredit;
    }
  }
  if (hasOwnKey(input, 'licensingInfo')) {
    if (input.licensingInfo === undefined) {
      delete updatedCandidate.licensingInfo;
    } else {
      updatedCandidate.licensingInfo = input.licensingInfo;
    }
  }
  if (hasOwnKey(input, 'tags')) {
    if (input.tags === undefined) {
      delete updatedCandidate.tags;
    } else {
      updatedCandidate.tags = input.tags;
    }
  }
  if (hasOwnKey(input, 'associatedArticleIds')) {
    if (input.associatedArticleIds === undefined) {
      delete updatedCandidate.associatedArticleIds;
    } else {
      updatedCandidate.associatedArticleIds = input.associatedArticleIds;
    }
  }

  const validation = validateEditorialImageAsset(updatedCandidate, limits);
  if (!validation.valid) {
    throw new Error(
      `Failed to update EditorialImageAssetRecord due to validation errors:\n- ${validation.errors.join('\n- ')}`
    );
  }

  return sanitizeEditorialImageAssetMetadata(updatedCandidate, limits);
}
