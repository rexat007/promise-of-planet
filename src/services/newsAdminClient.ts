import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import { validateAssetId } from './editorialImageAssetContract';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetOrigin,
  type EditorialImageAssetValidationLimits,
} from '../types/editorialImageAsset';
import type { NewsItem } from '../types/news';
import type { RichNewsDocument } from '../types/richNewsDocument';
import { WorkflowState } from '../types/workflow';
import type { AdminUser } from '../types/admin';

export type NewsAdminTransport = (action: string, payload?: any) => Promise<any>;

let customAdminTransport: NewsAdminTransport | null = null;

export const MAX_NEWS_IMAGE_UPLOAD_BYTES = 15_000_000 as const;
export const MAX_NEWS_IMAGE_METADATA_HEADER_BYTES = 16_384 as const;
export const DEFAULT_NEWS_IMAGE_UPLOAD_TIMEOUT_MS = 60_000 as const;

export const ALLOWED_NEWS_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type AllowedNewsImageMimeType = (typeof ALLOWED_NEWS_IMAGE_MIME_TYPES)[number];

const ALLOWED_MIME_SET: ReadonlySet<string> = new Set(ALLOWED_NEWS_IMAGE_MIME_TYPES);

const MIME_TO_ALLOWED_EXTENSIONS: Readonly<Record<AllowedNewsImageMimeType, readonly string[]>> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
};

const INTAKE_ID_REGEX = /^[A-Za-z0-9_-]{3,128}$/;

const ALLOWED_METADATA_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'intakeId',
  'assetId',
  'originalFilename',
  'claimedMimeType',
  'claimedFilenameOrExtension',
  'origin',
  'altAr',
  'altEn',
  'captionAr',
  'captionEn',
  'photographerCredit',
  'licensingInfo',
  'tags',
  'associatedArticleIds',
]);

const ALLOWED_UPLOAD_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'intakeId',
  'assetId',
  'status',
  'errorCode',
  'rejectionCode',
]);

const PROHIBITED_METADATA_TEXT_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /gs:\/\//i,
  /file:\/\//i,
  /ftp:\/\//i,
  /data:/i,
  /blob:/i,
  /javascript:/i,
  /vbscript:/i,
  /editorial_images\/private/i,
  /editorial_intake_quarantine/i,
];

const FORBIDDEN_FEATURED_IMAGE_PERSISTENCE_PATTERNS: readonly RegExp[] = [
  /^data:/i,
  /^blob:/i,
  /^gs:\/\//i,
  /^file:\/\//i,
  /^javascript:/i,
  /editorial_images\/private/i,
  /editorial_intake_quarantine/i,
  /\.\./,
  /\\/,
];

export interface NewsImageBinaryFileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly lastModified?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface NewsImageMetadataFormInput {
  readonly altAr: string;
  readonly altEn?: string;
  readonly captionAr?: string;
  readonly captionEn?: string;
  readonly photographerCredit?: string;
  readonly licensingInfo?: string;
}

export interface EditorialImageUploadMetadataEnvelope {
  readonly intakeId: string;
  readonly assetId: string;
  readonly originalFilename: string;
  readonly claimedMimeType: AllowedNewsImageMimeType;
  readonly claimedFilenameOrExtension?: string;
  readonly origin: EditorialImageAssetOrigin;
  readonly altAr: string;
  readonly altEn?: string;
  readonly captionAr?: string;
  readonly captionEn?: string;
  readonly photographerCredit?: string;
  readonly licensingInfo?: string;
  readonly tags?: readonly string[];
  readonly associatedArticleIds?: readonly string[];
}

export interface UploadEditorialNewsImageRequest {
  readonly intakeId: string;
  readonly assetId: string;
  readonly file: NewsImageBinaryFileLike;
  readonly metadata: NewsImageMetadataFormInput;
  readonly origin?: EditorialImageAssetOrigin;
  readonly tags?: readonly string[];
  readonly associatedArticleIds?: readonly string[];
}

export type NewsImageUploadOutcomeStatus =
  | 'Completed'
  | 'CleanupPending'
  | 'NeedsReconciliation'
  | 'Rejected'
  | 'Failed'
  | 'Ambiguous';

export type UploadEditorialNewsImageOutcome =
  | {
      readonly ok: true;
      readonly httpStatus: 201;
      readonly intakeId: string;
      readonly assetId: string;
      readonly status: 'Completed';
      readonly eligibleForDraftLinking: true;
    }
  | {
      readonly ok: false;
      readonly httpStatus?: number;
      readonly intakeId: string;
      readonly assetId: string;
      readonly status: Exclude<NewsImageUploadOutcomeStatus, 'Completed'>;
      readonly errorCode: string;
      readonly rejectionCode?: string;
      readonly eligibleForDraftLinking: false;
      readonly haltAutomaticRetry: boolean;
      readonly messageAr: string;
      readonly messageEn: string;
    };

export interface RetainedCompletedImageUpload {
  readonly intakeId: string;
  readonly assetId: string;
  readonly status: 'Completed';
  readonly fileSignature: string;
  readonly originalFilename: string;
  readonly mimeType: AllowedNewsImageMimeType;
  readonly sizeBytes: number;
  readonly completedAtIso: string;
}

export interface HaltedAmbiguousImageUpload {
  readonly intakeId: string;
  readonly assetId: string;
  readonly fileSignature: string;
  readonly status: 'CleanupPending' | 'NeedsReconciliation' | 'Ambiguous';
  readonly errorCode: string;
  readonly messageAr: string;
  readonly messageEn: string;
}

export interface NewsImageUploadRuntimeOverrides {
  readonly endpointUrl?: string | null;
  readonly isAuthenticated?: () => boolean;
  readonly getAuthenticatedIdToken?: (forceRefresh: boolean) => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

let customImageUploadRuntime: NewsImageUploadRuntimeOverrides | null = null;

function resolveEnvRecord(): Record<string, unknown> {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env as unknown as Record<string, unknown>;
  }
  if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
    return ((globalThis as any).process?.env as Record<string, unknown>) || {};
  }
  return {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isValidUploadEndpointUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed !== rawUrl || /\s/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      return Boolean(parsed.hostname);
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function validateClientIntakeId(intakeId: unknown): {
  readonly valid: boolean;
  readonly errors: string[];
} {
  if (typeof intakeId !== 'string' || !INTAKE_ID_REGEX.test(intakeId)) {
    return {
      valid: false,
      errors: [
        'intakeId must be a non-empty string of 3 to 128 ASCII alphanumeric, underscore, or hyphen characters.',
      ],
    };
  }
  return { valid: true, errors: [] };
}

export function createCanonicalNewsImageUploadIds(
  nowMs: number = Date.now(),
  randomSuffix?: string
): { readonly intakeId: string; readonly assetId: string } {
  const safeTimestamp = Math.max(1, Math.floor(nowMs));
  let suffix = randomSuffix;
  if (!suffix) {
    if (
      typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto.randomUUID === 'function'
    ) {
      suffix = globalThis.crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toLowerCase();
    } else {
      suffix = Math.random().toString(36).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase();
    }
  }
  const sanitizedSuffix = suffix.replace(/[^a-zA-Z0-9_-]/g, '') || '0001';
  const intakeId = `intake_news_${safeTimestamp}_${sanitizedSuffix}`;
  const assetId = `asset_news_${safeTimestamp}_${sanitizedSuffix}`;

  const intakeCheck = validateClientIntakeId(intakeId);
  const assetCheck = validateAssetId(assetId, DEFAULT_ASSET_VALIDATION_LIMITS);
  if (!intakeCheck.valid || !assetCheck.valid) {
    throw new Error('Failed to generate valid canonical intakeId and assetId.');
  }

  return { intakeId, assetId };
}

export function computeNewsImageFileSignature(file: NewsImageBinaryFileLike): string {
  const lastMod = typeof file.lastModified === 'number' ? file.lastModified : 0;
  return `${file.name}::${file.type}::${file.size}::${lastMod}`;
}

export function isForbiddenFeaturedImagePersistenceValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return FORBIDDEN_FEATURED_IMAGE_PERSISTENCE_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );
}

export function validateRetainedCompletedUpload(
  retained: unknown,
  expectedFile: NewsImageBinaryFileLike,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): retained is RetainedCompletedImageUpload {
  if (!isPlainObject(retained)) {
    return false;
  }
  if (retained.status !== 'Completed') {
    return false;
  }
  if (!validateClientIntakeId(retained.intakeId).valid) {
    return false;
  }
  if (!validateAssetId(retained.assetId, limits).valid) {
    return false;
  }
  const expectedSig = computeNewsImageFileSignature(expectedFile);
  if (retained.fileSignature !== expectedSig) {
    return false;
  }
  if (
    typeof retained.sizeBytes !== 'number' ||
    retained.sizeBytes <= 0 ||
    retained.sizeBytes > MAX_NEWS_IMAGE_UPLOAD_BYTES ||
    retained.sizeBytes !== expectedFile.size
  ) {
    return false;
  }
  if (
    typeof retained.mimeType !== 'string' ||
    !ALLOWED_MIME_SET.has(retained.mimeType) ||
    retained.mimeType !== expectedFile.type
  ) {
    return false;
  }
  return true;
}

export function validateNewsImageSelectionAndMetadata(
  metadata: NewsImageMetadataFormInput,
  file?: NewsImageBinaryFileLike | null,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): {
  readonly valid: boolean;
  readonly errors: string[];
  readonly errorAr?: string;
  readonly errorEn?: string;
} {
  const errors: string[] = [];
  let firstAr: string | undefined;
  let firstEn: string | undefined;

  const recordError = (en: string, ar: string) => {
    errors.push(en);
    if (!firstEn) firstEn = en;
    if (!firstAr) firstAr = ar;
  };

  if (!file) {
    recordError(
      'Image file selection is required.',
      'يرجى اختيار ملف صورة صالح للرفع.'
    );
    return { valid: false, errors, errorAr: firstAr, errorEn: firstEn };
  }

  if (
    typeof file.name !== 'string' ||
    file.name.trim().length === 0 ||
    file.name !== file.name.trim() ||
    file.name.length > 255 ||
    file.name.includes('/') ||
    file.name.includes('\\') ||
    file.name.includes('..') ||
    PROHIBITED_METADATA_TEXT_PATTERNS.some((p) => p.test(file.name))
  ) {
    recordError(
      'Image filename is invalid or contains prohibited path segments.',
      'اسم ملف الصورة غير صالح أو يتضمن مسارات غير مسموح بها.'
    );
  }

  const normalizedMime = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  if (!ALLOWED_MIME_SET.has(normalizedMime)) {
    recordError(
      'Only PNG, JPEG, and WebP images are supported.',
      'يُسمح فقط برفع صور بصيغة PNG أو JPEG أو WebP.'
    );
  } else {
    const ext = file.name.includes('.')
      ? file.name.split('.').pop()?.trim().toLowerCase() ?? ''
      : '';
    const allowedExts =
      MIME_TO_ALLOWED_EXTENSIONS[normalizedMime as AllowedNewsImageMimeType];
    if (!ext || !allowedExts.includes(ext)) {
      recordError(
        `File extension ".${ext || 'none'}" does not match MIME type "${normalizedMime}".`,
        `امتداد الملف لا يتطابق مع نوع الصورة (${normalizedMime}).`
      );
    }
  }

  if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size <= 0) {
    recordError(
      'Selected image file is empty.',
      'ملف الصورة المختار فارغ.'
    );
  } else if (file.size > MAX_NEWS_IMAGE_UPLOAD_BYTES) {
    recordError(
      `Image file size exceeds the maximum limit of ${MAX_NEWS_IMAGE_UPLOAD_BYTES.toLocaleString('en-US')} bytes (15 MB).`,
      'حجم ملف الصورة يتجاوز الحد الأقصى المسموح به (15 ميجابايت).'
    );
  }

  const altAr = typeof metadata.altAr === 'string' ? metadata.altAr.trim() : '';
  if (!altAr) {
    recordError(
      'Arabic image alt text (altAr) is required.',
      'النص البديل للصورة باللغة العربية مطلوب.'
    );
  } else if (altAr.length > limits.maxAltTextLength) {
    recordError(
      `Arabic image alt text must not exceed ${limits.maxAltTextLength} characters.`,
      `النص البديل بالعربية يجب ألا يتجاوز ${limits.maxAltTextLength} حرف.`
    );
  } else if (PROHIBITED_METADATA_TEXT_PATTERNS.some((p) => p.test(altAr))) {
    recordError(
      'Arabic image alt text contains prohibited URL or storage path patterns.',
      'النص البديل بالعربية يتضمن روابط أو مسارات غير مسموح بها.'
    );
  }

  const checkOptionalField = (
    rawVal: string | undefined,
    maxLength: number,
    labelEn: string,
    labelAr: string
  ) => {
    if (rawVal === undefined) return;
    const trimmed = rawVal.trim();
    if (!trimmed) return;
    if (trimmed.length > maxLength) {
      recordError(
        `${labelEn} must not exceed ${maxLength} characters.`,
        `${labelAr} يجب ألا يتجاوز ${maxLength} حرف.`
      );
    } else if (PROHIBITED_METADATA_TEXT_PATTERNS.some((p) => p.test(trimmed))) {
      recordError(
        `${labelEn} contains prohibited URL or storage path patterns.`,
        `${labelAr} يتضمن روابط أو مسارات غير مسموح بها.`
      );
    }
  };

  checkOptionalField(
    metadata.altEn,
    limits.maxAltTextLength,
    'English image alt text',
    'النص البديل بالإنجليزية'
  );
  checkOptionalField(
    metadata.captionAr,
    limits.maxCaptionLength,
    'Arabic image caption',
    'التعليق التوضيحي بالعربية'
  );
  checkOptionalField(
    metadata.captionEn,
    limits.maxCaptionLength,
    'English image caption',
    'التعليق التوضيحي بالإنجليزية'
  );
  checkOptionalField(
    metadata.photographerCredit,
    limits.maxCreditLength,
    'Photographer credit',
    'اسم المصور / جهة التصوير'
  );
  checkOptionalField(
    metadata.licensingInfo,
    limits.maxLicensingLength,
    'Licensing information',
    'بيانات الترخيص'
  );

  return {
    valid: errors.length === 0,
    errors,
    errorAr: firstAr,
    errorEn: firstEn,
  };
}

export function buildAndEncodeEditorialImageMetadataHeader(
  input: {
    readonly intakeId: string;
    readonly assetId: string;
    readonly originalFilename: string;
    readonly claimedMimeType: AllowedNewsImageMimeType;
    readonly origin?: EditorialImageAssetOrigin;
    readonly metadata: NewsImageMetadataFormInput;
    readonly tags?: readonly string[];
    readonly associatedArticleIds?: readonly string[];
  },
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): {
  readonly envelope: EditorialImageUploadMetadataEnvelope;
  readonly encodedHeaderValue: string;
} {
  const intakeCheck = validateClientIntakeId(input.intakeId);
  if (!intakeCheck.valid) {
    throw new Error(`INVALID_INTAKE_ID: ${intakeCheck.errors.join(' ')}`);
  }

  const assetCheck = validateAssetId(input.assetId, limits);
  if (!assetCheck.valid) {
    throw new Error(`INVALID_ASSET_ID: ${assetCheck.errors.join(' ')}`);
  }

  const origin: EditorialImageAssetOrigin = input.origin ?? 'news_article';
  if (
    origin !== 'news_article' &&
    origin !== 'standalone_upload' &&
    origin !== 'editorial_library'
  ) {
    throw new Error(`INVALID_ORIGIN: Unsupported image origin "${String(origin)}".`);
  }

  const altAr = input.metadata.altAr.trim();
  const altEn = input.metadata.altEn?.trim();
  const captionAr = input.metadata.captionAr?.trim();
  const captionEn = input.metadata.captionEn?.trim();
  const photographerCredit = input.metadata.photographerCredit?.trim();
  const licensingInfo = input.metadata.licensingInfo?.trim();

  const sanitizedTags = input.tags
    ?.map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= limits.maxTagLength)
    .slice(0, limits.maxTagsCount);

  const sanitizedArticleIds = input.associatedArticleIds
    ?.map((id) => id.trim())
    .filter(
      (id) =>
        id.length > 0 &&
        id.length <= (limits.maxArticleIdLength ?? 128) &&
        !id.startsWith('news-sudan-') &&
        !id.startsWith('temp-') &&
        !/\s/.test(id)
    );

  const envelope: EditorialImageUploadMetadataEnvelope = {
    intakeId: input.intakeId,
    assetId: input.assetId,
    originalFilename: input.originalFilename.trim(),
    claimedMimeType: input.claimedMimeType,
    claimedFilenameOrExtension: input.originalFilename.trim(),
    origin,
    altAr,
    ...(altEn ? { altEn } : {}),
    ...(captionAr ? { captionAr } : {}),
    ...(captionEn ? { captionEn } : {}),
    ...(photographerCredit ? { photographerCredit } : {}),
    ...(licensingInfo ? { licensingInfo } : {}),
    ...(sanitizedTags && sanitizedTags.length > 0 ? { tags: sanitizedTags } : {}),
    ...(sanitizedArticleIds && sanitizedArticleIds.length > 0
      ? { associatedArticleIds: sanitizedArticleIds }
      : {}),
  };

  for (const key of Object.keys(envelope)) {
    if (!ALLOWED_METADATA_ENVELOPE_KEYS.has(key)) {
      throw new Error(`FORBIDDEN_METADATA_KEY: "${key}" is not allowed in upload metadata.`);
    }
  }

  const jsonStr = JSON.stringify(envelope);
  const encodedHeaderValue = encodeURIComponent(jsonStr);
  const byteLength = new TextEncoder().encode(encodedHeaderValue).byteLength;

  if (byteLength === 0 || byteLength > MAX_NEWS_IMAGE_METADATA_HEADER_BYTES) {
    throw new Error(
      `METADATA_HEADER_LIMIT_EXCEEDED: Encoded metadata header (${byteLength} bytes) exceeds limit of ${MAX_NEWS_IMAGE_METADATA_HEADER_BYTES} bytes.`
    );
  }

  return { envelope, encodedHeaderValue };
}

function mapUploadFailureMessages(
  status: Exclude<NewsImageUploadOutcomeStatus, 'Completed'>,
  errorCode: string
): { readonly messageAr: string; readonly messageEn: string } {
  switch (status) {
    case 'CleanupPending':
      return {
        messageAr:
          'تمت عملية الرفع الجزئية ولكن حالة التنظيف معلقة (CleanupPending). لن يتم ربط الصورة بالمقال تلقائياً؛ يرجى مراجعة الجلسة قبل إعادة المحاولة.',
        messageEn:
          'Image upload finished in CleanupPending state (CLEANUP_INCOMPLETE) and cannot be linked to the draft automatically.',
      };
    case 'NeedsReconciliation':
      return {
        messageAr:
          'حالة تسجيل الصورة غير مؤكدة وتتطلب تسوية (NeedsReconciliation). تم إيقاف إعادة الرفع التلقائي لمنع تكرار الأصول.',
        messageEn:
          'Image upload outcome requires reconciliation (NeedsReconciliation). Automatic re-upload is halted to prevent duplicate assets.',
      };
    case 'Ambiguous':
      return {
        messageAr:
          'انتهت مهلة الاتصال أو تعذر التحقق من نتيجة رفع الصورة. لم يتم حفظ الصورة في المقال وتم إيقاف إعادة الرفع التلقائي بنفس الجلسة.',
        messageEn:
          'Image upload timed out or returned an ambiguous network outcome. The image was not linked and automatic retry with new IDs is halted.',
      };
    default:
      if (errorCode === 'UPLOAD_ENDPOINT_UNCONFIGURED') {
        return {
          messageAr:
            'خدمة رفع الصور الخبرية غير مهيأة أو غير متاحة في البيئة الحالية. لا يمكن رفع الصورة حالياً.',
          messageEn:
            'Editorial news image upload endpoint is not configured or verified in this environment.',
        };
      }
      if (errorCode === 'UNAUTHENTICATED' || errorCode === 'AUTH_TOKEN_FAILURE') {
        return {
          messageAr:
            'تعذر التحقق من جلسة المصادقة الإدارية أو تحديث رمز الدخول (ID Token). يرجى تسجيل الدخول والمحاولة مجدداً.',
          messageEn:
            'Administrative authentication is missing or Firebase ID token refresh failed.',
        };
      }
      if (errorCode === 'PERMISSION_DENIED' || errorCode === 'CORS_ORIGIN_FORBIDDEN') {
        return {
          messageAr: 'ليس لديك الصلاحية الكافية لرفع الصور التحريرية في هذا الخبر.',
          messageEn: 'Permission denied for editorial news image binary intake.',
        };
      }
      if (errorCode === 'SIZE_LIMIT_EXCEEDED') {
        return {
          messageAr: 'حجم ملف الصورة يتجاوز الحد الأقصى المسموح به (15 ميجابايت).',
          messageEn: 'Image file size exceeds the maximum allowed limit (15 MB).',
        };
      }
      if (errorCode === 'BINARY_REJECTED' || errorCode === 'UNSUPPORTED_CONTENT_TYPE') {
        return {
          messageAr:
            'تم رفض ملف الصورة أثناء الفحص الأمني والتقني (صيغة غير مدعومة أو بيانات تالفة).',
          messageEn:
            'Image binary was rejected by content inspection (unsupported signature, dimensions, or corrupt data).',
        };
      }
      if (
        errorCode === 'INTAKE_ID_CONFLICT' ||
        errorCode === 'ASSET_ALREADY_EXISTS' ||
        errorCode === 'STORAGE_CONFLICT'
      ) {
        return {
          messageAr: 'حدث تعارض في معرّف الأصل أو جلسة الرفع. لم يتم تعديل أي أصول سابقة.',
          messageEn:
            'Upload identifier or storage conflict detected. Existing assets were preserved untouched.',
        };
      }
      return {
        messageAr: `فشل رفع الصورة التحريرية (${errorCode}). لم يتم ربط الصورة بالمقال.`,
        messageEn: `Editorial image upload failed (${errorCode}). The image was not linked to the draft.`,
      };
  }
}

function getFunctionsInstance() {
  if (!isFirebaseConfigured || !app) {
    throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
  }
  if (!auth?.currentUser) {
    throw new Error('UNAUTHENTICATED: Authentication required. Newsroom management requires an authenticated Admin user session.');
  }
  return getFunctions(app);
}

export class NewsAdminClient {
  /**
   * Allows injecting an isolated transport function (used for automated testing without live network mutation).
   */
  public static setTransport(transport: NewsAdminTransport | null): void {
    customAdminTransport = transport;
  }

  /**
   * Allows injecting isolated runtime overrides for the HTTP binary image upload client in tests.
   */
  public static setImageUploadRuntime(
    overrides: NewsImageUploadRuntimeOverrides | null
  ): void {
    customImageUploadRuntime = overrides;
  }

  public static isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  }

  public static isAuthenticated(): boolean {
    if (customImageUploadRuntime?.isAuthenticated) {
      return Boolean(customImageUploadRuntime.isAuthenticated());
    }
    return !!(isFirebaseConfigured && auth?.currentUser);
  }

  /**
   * Resolves the verified editorial news image upload endpoint URL from explicit application configuration.
   * Never guesses or fabricates a Cloud Functions URL, region, or project ID.
   */
  public static getConfiguredImageUploadEndpointUrl(): string | null {
    if (customImageUploadRuntime && 'endpointUrl' in customImageUploadRuntime) {
      const overrideUrl = customImageUploadRuntime.endpointUrl;
      return isValidUploadEndpointUrl(overrideUrl) ? overrideUrl : null;
    }

    const env = resolveEnvRecord();
    const candidate =
      env.VITE_EDITORIAL_NEWS_IMAGE_UPLOAD_URL ??
      env.VITE_NEWS_IMAGE_UPLOAD_ENDPOINT ??
      null;

    return isValidUploadEndpointUrl(candidate) ? candidate : null;
  }

  public static isImageUploadAvailable(): boolean {
    return Boolean(this.getConfiguredImageUploadEndpointUrl() && this.isAuthenticated());
  }

  /**
   * Refreshes the authenticated Firebase user's ID token via the Firebase Auth SDK (`getIdToken(true)`).
   */
  public static async getRefreshedAdminIdToken(): Promise<string> {
    if (customImageUploadRuntime?.getAuthenticatedIdToken) {
      const token = await customImageUploadRuntime.getAuthenticatedIdToken(true);
      if (typeof token !== 'string' || token.trim().length === 0 || /\s/.test(token.trim())) {
        throw new Error('AUTH_TOKEN_FAILURE: Retrieved Firebase ID token is empty or malformed.');
      }
      return token.trim();
    }

    if (!isFirebaseConfigured || !auth?.currentUser) {
      throw new Error(
        'UNAUTHENTICATED: An authenticated Firebase administrator session is required for image upload.'
      );
    }

    if (typeof auth.currentUser.getIdToken !== 'function') {
      throw new Error(
        'AUTH_TOKEN_FAILURE: Firebase currentUser does not support getIdToken(true).'
      );
    }

    const token = await auth.currentUser.getIdToken(true);
    if (typeof token !== 'string' || token.trim().length === 0 || /\s/.test(token.trim())) {
      throw new Error('AUTH_TOKEN_FAILURE: Refreshed Firebase ID token is empty or invalid.');
    }

    return token.trim();
  }

  /**
   * Uploads an editorial image binary via authenticated HTTP POST to `editorialNewsImageUpload`.
   * Only `status: 'Completed'` with HTTP 201 and matching `intakeId` / `assetId` is eligible for draft linking.
   */
  public static async uploadEditorialNewsImage(
    request: UploadEditorialNewsImageRequest
  ): Promise<UploadEditorialNewsImageOutcome> {
    const { intakeId, assetId, file, metadata } = request;

    const intakeCheck = validateClientIntakeId(intakeId);
    const assetCheck = validateAssetId(assetId, DEFAULT_ASSET_VALIDATION_LIMITS);
    if (!intakeCheck.valid || !assetCheck.valid) {
      const msg = mapUploadFailureMessages('Rejected', 'INVALID_INPUT');
      return {
        ok: false,
        intakeId: typeof intakeId === 'string' ? intakeId : '',
        assetId: typeof assetId === 'string' ? assetId : '',
        status: 'Rejected',
        errorCode: 'INVALID_INPUT',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        ...msg,
      };
    }

    const validation = validateNewsImageSelectionAndMetadata(
      metadata,
      file,
      DEFAULT_ASSET_VALIDATION_LIMITS
    );
    if (!validation.valid) {
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Rejected',
        errorCode: 'INVALID_INPUT',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        messageAr:
          validation.errorAr || 'بيانات الصورة أو الملف المختار غير صالحة.',
        messageEn:
          validation.errorEn || 'Selected image file or metadata is invalid.',
      };
    }

    // Check endpoint URL configuration BEFORE any token refresh or remote call
    const endpointUrl = this.getConfiguredImageUploadEndpointUrl();
    if (!endpointUrl) {
      const msg = mapUploadFailureMessages('Rejected', 'UPLOAD_ENDPOINT_UNCONFIGURED');
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Rejected',
        errorCode: 'UPLOAD_ENDPOINT_UNCONFIGURED',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        ...msg,
      };
    }

    // Check authentication & refresh Firebase ID token BEFORE reading/sending bytes
    if (!this.isAuthenticated()) {
      const msg = mapUploadFailureMessages('Rejected', 'UNAUTHENTICATED');
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Rejected',
        errorCode: 'UNAUTHENTICATED',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        ...msg,
      };
    }

    let bearerToken: string;
    try {
      bearerToken = await this.getRefreshedAdminIdToken();
    } catch {
      const msg = mapUploadFailureMessages('Rejected', 'AUTH_TOKEN_FAILURE');
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Rejected',
        errorCode: 'AUTH_TOKEN_FAILURE',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        ...msg,
      };
    }

    const normalizedMime = file.type.trim().toLowerCase() as AllowedNewsImageMimeType;

    let encodedHeaderValue: string;
    try {
      const built = buildAndEncodeEditorialImageMetadataHeader({
        intakeId,
        assetId,
        originalFilename: file.name,
        claimedMimeType: normalizedMime,
        origin: request.origin ?? 'news_article',
        metadata,
        tags: request.tags,
        associatedArticleIds: request.associatedArticleIds,
      });
      encodedHeaderValue = built.encodedHeaderValue;
    } catch (err: any) {
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Rejected',
        errorCode: 'INVALID_INPUT',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        messageAr: 'تجاوزت البيانات الوصفية للصورة الحد المسموح به أو تضمنت حقولاً غير صالحة.',
        messageEn: err?.message || 'Image metadata header validation failed.',
      };
    }

    let rawBytes: Uint8Array;
    try {
      const arrayBuf = await file.arrayBuffer();
      rawBytes = new Uint8Array(arrayBuf);
    } catch {
      const msg = mapUploadFailureMessages('Rejected', 'FILE_READ_ERROR');
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Rejected',
        errorCode: 'FILE_READ_ERROR',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        ...msg,
      };
    }

    if (rawBytes.byteLength === 0) {
      const msg = mapUploadFailureMessages('Rejected', 'EMPTY_BINARY');
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Rejected',
        errorCode: 'EMPTY_BINARY',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        ...msg,
      };
    }

    if (rawBytes.byteLength > MAX_NEWS_IMAGE_UPLOAD_BYTES) {
      const msg = mapUploadFailureMessages('Rejected', 'SIZE_LIMIT_EXCEEDED');
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Rejected',
        errorCode: 'SIZE_LIMIT_EXCEEDED',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        ...msg,
      };
    }

    const fetchFn = customImageUploadRuntime?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      const msg = mapUploadFailureMessages('Failed', 'FETCH_UNAVAILABLE');
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Failed',
        errorCode: 'FETCH_UNAVAILABLE',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: false,
        ...msg,
      };
    }

    const timeoutMs =
      customImageUploadRuntime?.timeoutMs ?? DEFAULT_NEWS_IMAGE_UPLOAD_TIMEOUT_MS;
    const abortController = new AbortController();
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      abortController.abort();
    }, timeoutMs);

    let httpResponse: Response;
    try {
      httpResponse = await fetchFn(endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': normalizedMime,
          'X-Editorial-Image-Metadata': encodedHeaderValue,
        },
        body: rawBytes as unknown as BodyInit,
        signal: abortController.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort =
        didTimeout ||
        err?.name === 'AbortError' ||
        /abort|timeout/i.test(String(err?.message ?? ''));
      const errorCode = isAbort ? 'UPLOAD_TIMEOUT' : 'AMBIGUOUS_NETWORK_ERROR';
      const msg = mapUploadFailureMessages('Ambiguous', errorCode);
      return {
        ok: false,
        intakeId,
        assetId,
        status: 'Ambiguous',
        errorCode,
        eligibleForDraftLinking: false,
        haltAutomaticRetry: true,
        ...msg,
      };
    } finally {
      clearTimeout(timer);
    }

    let parsedBody: unknown;
    try {
      const rawText = await httpResponse.text();
      parsedBody = JSON.parse(rawText);
    } catch {
      const isServerAmbiguous = httpResponse.status >= 500 || httpResponse.status === 201;
      const status: 'Ambiguous' | 'Failed' = isServerAmbiguous ? 'Ambiguous' : 'Failed';
      const msg = mapUploadFailureMessages(status, 'MALFORMED_RESPONSE');
      return {
        ok: false,
        httpStatus: httpResponse.status,
        intakeId,
        assetId,
        status,
        errorCode: 'MALFORMED_RESPONSE',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: isServerAmbiguous,
        ...msg,
      };
    }

    if (!isPlainObject(parsedBody) || typeof parsedBody.ok !== 'boolean') {
      const msg = mapUploadFailureMessages('Ambiguous', 'MALFORMED_RESPONSE');
      return {
        ok: false,
        httpStatus: httpResponse.status,
        intakeId,
        assetId,
        status: 'Ambiguous',
        errorCode: 'MALFORMED_RESPONSE',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: true,
        ...msg,
      };
    }

    // Reject any response containing unexpected keys or leaked paths/URLs
    const unknownKeys = Object.keys(parsedBody).filter(
      (k) => !ALLOWED_UPLOAD_RESPONSE_KEYS.has(k)
    );
    if (unknownKeys.length > 0) {
      const msg = mapUploadFailureMessages('Ambiguous', 'MALFORMED_RESPONSE');
      return {
        ok: false,
        httpStatus: httpResponse.status,
        intakeId,
        assetId,
        status: 'Ambiguous',
        errorCode: 'MALFORMED_RESPONSE',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: true,
        ...msg,
      };
    }

    if (parsedBody.ok === true) {
      if (
        httpResponse.status !== 201 ||
        parsedBody.intakeId !== intakeId ||
        parsedBody.assetId !== assetId ||
        !validateClientIntakeId(parsedBody.intakeId).valid ||
        !validateAssetId(parsedBody.assetId, DEFAULT_ASSET_VALIDATION_LIMITS).valid ||
        isForbiddenFeaturedImagePersistenceValue(parsedBody.assetId)
      ) {
        const msg = mapUploadFailureMessages('Ambiguous', 'RESPONSE_IDENTITY_MISMATCH');
        return {
          ok: false,
          httpStatus: httpResponse.status,
          intakeId,
          assetId,
          status: 'Ambiguous',
          errorCode: 'RESPONSE_IDENTITY_MISMATCH',
          eligibleForDraftLinking: false,
          haltAutomaticRetry: true,
          ...msg,
        };
      }

      if (parsedBody.status === 'Completed') {
        return {
          ok: true,
          httpStatus: 201,
          intakeId,
          assetId,
          status: 'Completed',
          eligibleForDraftLinking: true,
        };
      }

      if (parsedBody.status === 'CleanupPending') {
        const errorCode =
          typeof parsedBody.errorCode === 'string'
            ? parsedBody.errorCode
            : 'CLEANUP_INCOMPLETE';
        const msg = mapUploadFailureMessages('CleanupPending', errorCode);
        return {
          ok: false,
          httpStatus: httpResponse.status,
          intakeId,
          assetId,
          status: 'CleanupPending',
          errorCode,
          eligibleForDraftLinking: false,
          haltAutomaticRetry: true,
          ...msg,
        };
      }

      const msg = mapUploadFailureMessages('Ambiguous', 'UNEXPECTED_UPLOAD_STATUS');
      return {
        ok: false,
        httpStatus: httpResponse.status,
        intakeId,
        assetId,
        status: 'Ambiguous',
        errorCode: 'UNEXPECTED_UPLOAD_STATUS',
        eligibleForDraftLinking: false,
        haltAutomaticRetry: true,
        ...msg,
      };
    }

    // parsedBody.ok === false
    const rawErrorCode =
      typeof parsedBody.errorCode === 'string' && parsedBody.errorCode.trim().length > 0
        ? parsedBody.errorCode.trim()
        : 'UPLOAD_FAILED';
    const rawRejectionCode =
      typeof parsedBody.rejectionCode === 'string'
        ? parsedBody.rejectionCode
        : undefined;

    let mappedStatus: Exclude<NewsImageUploadOutcomeStatus, 'Completed'> = 'Failed';
    if (
      parsedBody.status === 'NeedsReconciliation' ||
      rawErrorCode === 'RECONCILIATION_REQUIRED' ||
      httpResponse.status === 503
    ) {
      mappedStatus = 'NeedsReconciliation';
    } else if (
      parsedBody.status === 'CleanupPending' ||
      rawErrorCode === 'CLEANUP_INCOMPLETE'
    ) {
      mappedStatus = 'CleanupPending';
    } else if (parsedBody.status === 'Rejected') {
      mappedStatus = 'Rejected';
    }

    const haltAutomaticRetry =
      mappedStatus === 'NeedsReconciliation' ||
      mappedStatus === 'CleanupPending';

    const msg = mapUploadFailureMessages(mappedStatus, rawErrorCode);

    return {
      ok: false,
      httpStatus: httpResponse.status,
      intakeId,
      assetId,
      status: mappedStatus,
      errorCode: rawErrorCode,
      ...(rawRejectionCode ? { rejectionCode: rawRejectionCode } : {}),
      eligibleForDraftLinking: false,
      haltAutomaticRetry,
      ...msg,
    };
  }

  private static async executeAction<T = any>(action: string, payload?: any): Promise<T> {
    if (customAdminTransport) {
      return customAdminTransport(action, payload);
    }
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; [key: string]: any }, T>(fns, 'manageNews');
    const res = await callable({ action, ...payload });
    return res.data;
  }

  /**
   * Retrieves all news items from authoritative server repository.
   */
  public static async listAll(): Promise<NewsItem[]> {
    const data = await this.executeAction<{ items: NewsItem[] }>('listAll');
    return data.items || [];
  }

  /**
   * Retrieves a single news item by ID from authoritative server repository.
   */
  public static async getById(id: string): Promise<NewsItem | null> {
    if (!id || typeof id !== 'string') return null;
    const data = await this.executeAction<{ item: NewsItem | null }>('getById', { id: id.trim() });
    return data.item ?? null;
  }

  /**
   * Saves or updates a draft article via server-authoritative manageNews.
   * For new articles (isNew === true or when item.id is omitted), the provisional client ID is omitted
   * so the server executes createDraft and assigns an authoritative Firestore ID.
   */
  public static async saveNewsItem(
    item: Partial<NewsItem>,
    _actor?: AdminUser,
    isNew: boolean = false
  ): Promise<NewsItem> {
    if (!item.titleAr || item.titleAr.trim() === '') {
      throw new Error('Arabic title (titleAr) is mandatory for Promise of Planet news items');
    }

    if (isForbiddenFeaturedImagePersistenceValue(item.featuredImage)) {
      throw new Error(
        'INVALID_FEATURED_IMAGE_REFERENCE: Base64 data URLs, temporary blob URLs, and private GCS storage paths are prohibited in NewsItem.featuredImage.'
      );
    }

    const payload: Record<string, any> = {};

    if (item.titleAr !== undefined) payload.titleAr = item.titleAr.trim();
    if (item.titleEn !== undefined) payload.titleEn = item.titleEn.trim();
    if (item.kickerAr !== undefined) payload.kickerAr = item.kickerAr;
    if (item.kickerEn !== undefined) payload.kickerEn = item.kickerEn;
    if (item.journalisticType !== undefined) payload.journalisticType = item.journalisticType;
    if (item.summaryAr !== undefined) payload.summaryAr = item.summaryAr.trim();
    if (item.summaryEn !== undefined) payload.summaryEn = item.summaryEn.trim();
    if (item.bodyAr !== undefined) payload.bodyAr = item.bodyAr;
    if (item.bodyEn !== undefined) payload.bodyEn = item.bodyEn;
    if (item.richBodyAr !== undefined) payload.richBodyAr = item.richBodyAr;
    if (item.richBodyEn !== undefined) payload.richBodyEn = item.richBodyEn;
    if (item.category !== undefined) payload.category = item.category;
    if (item.tags !== undefined) payload.tags = item.tags;
    if (item.sources !== undefined) payload.sources = item.sources;
    if (item.featuredImage !== undefined) payload.featuredImage = item.featuredImage;
    if (item.location !== undefined) payload.location = item.location;
    if (item.urgencyLevel !== undefined) payload.urgencyLevel = item.urgencyLevel;
    if (item.relatedVideoIds !== undefined) payload.relatedVideoIds = item.relatedVideoIds;
    if (item.author !== undefined) payload.author = item.author;

    if (isNew) {
      payload.titleEn = payload.titleEn || '';
      payload.summaryAr = payload.summaryAr || '';
      payload.summaryEn = payload.summaryEn || '';
      payload.bodyAr = payload.bodyAr || '';
      payload.bodyEn = payload.bodyEn || '';
      payload.tags = payload.tags || [];
      payload.sources = payload.sources || [];
      payload.location = payload.location || 'Sudan / السودان';
      payload.urgencyLevel = payload.urgencyLevel || 'Standard';
      payload.relatedVideoIds = payload.relatedVideoIds || [];
    } else if (item.id && !item.id.startsWith('news-sudan-provisional-') && !item.id.startsWith('temp-')) {
      payload.id = item.id;
    }

    const data = await this.executeAction<{ item: NewsItem }>('saveDraft', { item: payload });
    return data.item;
  }

  /**
   * Executes a workflow transition with server-side authorization and audit logging.
   * Human explicit publication required for state === 'Published'.
   */
  public static async executeTransition(
    newsItemId: string,
    targetState: WorkflowState,
    _actor?: AdminUser,
    comment?: string
  ): Promise<NewsItem> {
    if (!newsItemId || !targetState) {
      throw new Error('newsItemId and targetState are required for workflow transition');
    }

    const data = await this.executeAction<{ item: NewsItem }>('transitionWorkflow', {
      id: newsItemId,
      targetState,
      comment: comment?.trim() || undefined,
    });

    return data.item;
  }

  /**
   * Test/environment utility to clear test state. Does not touch live storage or local storage.
   */
  public static clear(): void {
    customImageUploadRuntime = null;
  }
}

export interface ObjectUrlLifecycleAdapter {
  createObjectURL(blob: Blob | MediaSource): string;
  revokeObjectURL(url: string): void;
}

const defaultObjectUrlAdapter: ObjectUrlLifecycleAdapter = {
  createObjectURL: (blob) =>
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(blob)
      : '',
  revokeObjectURL: (url) => {
    if (
      url &&
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      URL.revokeObjectURL(url);
    }
  },
};

export interface DraftSaveWithImageInput {
  readonly isDraft: boolean;
  readonly isCreating: boolean;
  readonly activeItem: NewsItem | null;
  readonly editForm: Partial<NewsItem> & {
    readonly bodyArHasEdited?: boolean;
    readonly bodyEnHasEdited?: boolean;
    readonly richBodyAr?: RichNewsDocument;
    readonly richBodyEn?: RichNewsDocument;
  };
  readonly tagsInput: string;
  readonly sourcesInput: string;
  readonly currentUser: AdminUser;
  readonly isAr: boolean;
}

export type DraftSaveWithImageOutcome =
  | {
      readonly ok: true;
      readonly savedItem: NewsItem;
      readonly linkedAssetId?: string;
      readonly reusedRetainedUpload: boolean;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | 'NON_DRAFT_FORBIDDEN'
        | 'DUPLICATE_SUBMISSION_BLOCKED'
        | 'VALIDATION_FAILED'
        | 'UPLOAD_HALTED_AMBIGUOUS'
        | 'UPLOAD_FAILED'
        | 'DRAFT_SAVE_FAILED';
      readonly errorMessage: string;
      readonly retainedCompletedUpload: RetainedCompletedImageUpload | null;
      readonly haltedAmbiguousUpload: HaltedAmbiguousImageUpload | null;
    };

/**
 * Manages the per-editor-session state for featured image selection, temporary browser
 * object URL lifecycle, canonical intake/asset ID binding, retained Completed upload reuse
 * on draft-save failure, ambiguous upload retry prevention, and single-save lock.
 */
export class NewsEditorImageSessionController {
  private selectedFile: NewsImageBinaryFileLike | null = null;
  private previewObjectUrl: string | null = null;
  private boundIds: { readonly intakeId: string; readonly assetId: string } | null = null;
  private retainedCompletedUpload: RetainedCompletedImageUpload | null = null;
  private haltedAmbiguousUpload: HaltedAmbiguousImageUpload | null = null;
  private imageMetadata: NewsImageMetadataFormInput = {
    altAr: '',
    altEn: '',
    captionAr: '',
    captionEn: '',
    photographerCredit: '',
    licensingInfo: '',
  };
  private isSaveInFlight = false;
  private readonly urlAdapter: ObjectUrlLifecycleAdapter;
  private readonly idFactory: () => { readonly intakeId: string; readonly assetId: string };

  constructor(options?: {
    readonly urlAdapter?: ObjectUrlLifecycleAdapter;
    readonly idFactory?: () => { readonly intakeId: string; readonly assetId: string };
  }) {
    this.urlAdapter = options?.urlAdapter ?? defaultObjectUrlAdapter;
    this.idFactory = options?.idFactory ?? (() => createCanonicalNewsImageUploadIds());
  }

  public getSelectedFile(): NewsImageBinaryFileLike | null {
    return this.selectedFile;
  }

  public getPreviewObjectUrl(): string | null {
    return this.previewObjectUrl;
  }

  public getBoundIds(): { readonly intakeId: string; readonly assetId: string } | null {
    return this.boundIds;
  }

  public getRetainedCompletedUpload(): RetainedCompletedImageUpload | null {
    return this.retainedCompletedUpload;
  }

  public getHaltedAmbiguousUpload(): HaltedAmbiguousImageUpload | null {
    return this.haltedAmbiguousUpload;
  }

  public getImageMetadata(): NewsImageMetadataFormInput {
    return { ...this.imageMetadata };
  }

  public isSaving(): boolean {
    return this.isSaveInFlight;
  }

  public setImageMetadata(next: Partial<NewsImageMetadataFormInput>): NewsImageMetadataFormInput {
    this.imageMetadata = {
      ...this.imageMetadata,
      ...next,
    };
    return this.getImageMetadata();
  }

  /**
   * Selects or replaces the local image file, immediately revoking any previous temporary object URL
   * and binding a single canonical `{ intakeId, assetId }` pair to the new selection.
   */
  public selectFile(file: NewsImageBinaryFileLike | null): {
    readonly previewObjectUrl: string | null;
    readonly boundIds: { readonly intakeId: string; readonly assetId: string } | null;
  } {
    this.revokeCurrentPreviewUrl();
    this.retainedCompletedUpload = null;
    this.haltedAmbiguousUpload = null;

    if (!file) {
      this.selectedFile = null;
      this.boundIds = null;
      return { previewObjectUrl: null, boundIds: null };
    }

    this.selectedFile = file;
    this.boundIds = this.idFactory();

    if (typeof Blob !== 'undefined' && file instanceof Blob) {
      this.previewObjectUrl = this.urlAdapter.createObjectURL(file);
    } else {
      try {
        this.previewObjectUrl = this.urlAdapter.createObjectURL(
          file as unknown as Blob
        );
      } catch {
        this.previewObjectUrl = null;
      }
    }

    return {
      previewObjectUrl: this.previewObjectUrl,
      boundIds: this.boundIds,
    };
  }

  public revokeCurrentPreviewUrl(): void {
    if (this.previewObjectUrl) {
      const toRevoke = this.previewObjectUrl;
      this.previewObjectUrl = null;
      this.urlAdapter.revokeObjectURL(toRevoke);
    }
  }

  public resetSession(): void {
    this.revokeCurrentPreviewUrl();
    this.selectedFile = null;
    this.boundIds = null;
    this.retainedCompletedUpload = null;
    this.haltedAmbiguousUpload = null;
    this.imageMetadata = {
      altAr: '',
      altEn: '',
      captionAr: '',
      captionEn: '',
      photographerCredit: '',
      licensingInfo: '',
    };
    this.isSaveInFlight = false;
  }

  /**
   * Executes the unified single-button Save workflow for a news draft.
   */
  public async executeSaveWorkflow(
    input: DraftSaveWithImageInput
  ): Promise<DraftSaveWithImageOutcome> {
    const { isAr } = input;

    if (this.isSaveInFlight) {
      return {
        ok: false,
        reasonCode: 'DUPLICATE_SUBMISSION_BLOCKED',
        errorMessage: isAr
          ? 'جاري حفظ التعديلات بالفعل، يرجى الانتظار...'
          : 'A save operation is already in progress. Please wait.',
        retainedCompletedUpload: this.retainedCompletedUpload,
        haltedAmbiguousUpload: this.haltedAmbiguousUpload,
      };
    }

    const effectiveIsDraft =
      input.isDraft &&
      (input.isCreating || input.activeItem?.workflowState === WorkflowState.Draft);

    if (!effectiveIsDraft) {
      return {
        ok: false,
        reasonCode: 'NON_DRAFT_FORBIDDEN',
        errorMessage: isAr
          ? 'لا يمكن تعديل محتوى المقال أو صورته خارج مرحلة المسودة.'
          : 'Content and featured image cannot be edited outside Draft state.',
        retainedCompletedUpload: this.retainedCompletedUpload,
        haltedAmbiguousUpload: this.haltedAmbiguousUpload,
      };
    }

    if (!input.editForm.titleAr?.trim()) {
      return {
        ok: false,
        reasonCode: 'VALIDATION_FAILED',
        errorMessage: isAr
          ? 'يرجى كتابة عنوان المقال باللغة العربية'
          : 'Arabic title is required',
        retainedCompletedUpload: this.retainedCompletedUpload,
        haltedAmbiguousUpload: this.haltedAmbiguousUpload,
      };
    }

    if (!input.editForm.category?.trim()) {
      return {
        ok: false,
        reasonCode: 'VALIDATION_FAILED',
        errorMessage: isAr
          ? 'يرجى اختيار التصنيف البيئي'
          : 'Environmental category is required',
        retainedCompletedUpload: this.retainedCompletedUpload,
        haltedAmbiguousUpload: this.haltedAmbiguousUpload,
      };
    }

    // If a file is selected, validate image selection & metadata BEFORE any remote call
    if (this.selectedFile) {
      // Block automatic retry if a previous upload attempt for this file halted in an ambiguous state
      if (
        this.haltedAmbiguousUpload &&
        this.haltedAmbiguousUpload.fileSignature ===
          computeNewsImageFileSignature(this.selectedFile)
      ) {
        return {
          ok: false,
          reasonCode: 'UPLOAD_HALTED_AMBIGUOUS',
          errorMessage: isAr
            ? this.haltedAmbiguousUpload.messageAr
            : this.haltedAmbiguousUpload.messageEn,
          retainedCompletedUpload: this.retainedCompletedUpload,
          haltedAmbiguousUpload: this.haltedAmbiguousUpload,
        };
      }

      const imageValidation = validateNewsImageSelectionAndMetadata(
        this.imageMetadata,
        this.selectedFile,
        DEFAULT_ASSET_VALIDATION_LIMITS
      );
      if (!imageValidation.valid) {
        return {
          ok: false,
          reasonCode: 'VALIDATION_FAILED',
          errorMessage: isAr
            ? imageValidation.errorAr || 'بيانات الصورة المختارة غير صالحة.'
            : imageValidation.errorEn || 'Selected image metadata is invalid.',
          retainedCompletedUpload: this.retainedCompletedUpload,
          haltedAmbiguousUpload: this.haltedAmbiguousUpload,
        };
      }
    }

    this.isSaveInFlight = true;

    try {
      const parsedTags = input.tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const parsedSources = input.sourcesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      let resolvedFeaturedImage: string | undefined = input.editForm.featuredImage;
      let reusedRetainedUpload = false;

      if (this.selectedFile) {
        if (
          this.retainedCompletedUpload &&
          validateRetainedCompletedUpload(
            this.retainedCompletedUpload,
            this.selectedFile,
            DEFAULT_ASSET_VALIDATION_LIMITS
          )
        ) {
          resolvedFeaturedImage = this.retainedCompletedUpload.assetId;
          reusedRetainedUpload = true;
        } else {
          // Clear any invalid retained state before fresh upload
          this.retainedCompletedUpload = null;
          if (!this.boundIds) {
            this.boundIds = this.idFactory();
          }

          const associatedArticleIds =
            !input.isCreating &&
            input.activeItem?.id &&
            !input.activeItem.id.startsWith('news-sudan-') &&
            !input.activeItem.id.startsWith('temp-')
              ? [input.activeItem.id]
              : undefined;

          const uploadOutcome = await NewsAdminClient.uploadEditorialNewsImage({
            intakeId: this.boundIds.intakeId,
            assetId: this.boundIds.assetId,
            file: this.selectedFile,
            metadata: this.imageMetadata,
            origin: 'news_article',
            tags: parsedTags,
            associatedArticleIds,
          });

          if (!uploadOutcome.ok || uploadOutcome.status !== 'Completed') {
            if (
              uploadOutcome.haltAutomaticRetry &&
              (uploadOutcome.status === 'CleanupPending' ||
                uploadOutcome.status === 'NeedsReconciliation' ||
                uploadOutcome.status === 'Ambiguous')
            ) {
              this.haltedAmbiguousUpload = {
                intakeId: uploadOutcome.intakeId,
                assetId: uploadOutcome.assetId,
                fileSignature: computeNewsImageFileSignature(this.selectedFile),
                status: uploadOutcome.status,
                errorCode: uploadOutcome.errorCode,
                messageAr: uploadOutcome.messageAr,
                messageEn: uploadOutcome.messageEn,
              };
            }

            return {
              ok: false,
              reasonCode: 'UPLOAD_FAILED',
              errorMessage: isAr
                ? uploadOutcome.messageAr
                : uploadOutcome.messageEn,
              retainedCompletedUpload: null,
              haltedAmbiguousUpload: this.haltedAmbiguousUpload,
            };
          }

          // Verified Completed upload -> retain in editor session before attempting draft save
          this.retainedCompletedUpload = {
            intakeId: uploadOutcome.intakeId,
            assetId: uploadOutcome.assetId,
            status: 'Completed',
            fileSignature: computeNewsImageFileSignature(this.selectedFile),
            originalFilename: this.selectedFile.name,
            mimeType: this.selectedFile.type.trim().toLowerCase() as AllowedNewsImageMimeType,
            sizeBytes: this.selectedFile.size,
            completedAtIso: new Date().toISOString(),
          };
          resolvedFeaturedImage = uploadOutcome.assetId;
        }
      }

      let richArPayload = undefined;
      let richEnPayload = undefined;

      if (input.editForm.bodyArHasEdited) {
        richArPayload = input.editForm.richBodyAr;
      } else if (input.activeItem?.richBodyAr) {
        richArPayload = input.activeItem.richBodyAr;
      }

      if (input.editForm.bodyEnHasEdited) {
        richEnPayload = input.editForm.richBodyEn;
      } else if (input.activeItem?.richBodyEn) {
        richEnPayload = input.activeItem.richBodyEn;
      }

      let savedItem: NewsItem;
      if (input.isCreating) {
        const { id: _provisionalId, ...rest } = input.editForm as NewsItem;
        const itemToSave: Partial<NewsItem> = {
          ...rest,
          tags: parsedTags,
          sources: parsedSources,
           ...(resolvedFeaturedImage !== undefined
            ? { featuredImage: resolvedFeaturedImage }
            : {}),
          workflowState: WorkflowState.Draft,
          richBodyAr: input.editForm.richBodyAr,
          richBodyEn: input.editForm.richBodyEn,
        };
        delete itemToSave.bodyAr;
        delete itemToSave.bodyEn;

        savedItem = await NewsAdminClient.saveNewsItem(
          itemToSave,
          input.currentUser,
          true
        );
      } else if (input.activeItem) {
        const itemToSave: Partial<NewsItem> = {
          ...(input.editForm as NewsItem),
          id: input.activeItem.id,
          tags: parsedTags,
          sources: parsedSources,
          ...(resolvedFeaturedImage !== undefined
            ? { featuredImage: resolvedFeaturedImage }
            : {}),
          richBodyAr: richArPayload,
          richBodyEn: richEnPayload,
        };
        if (input.editForm.bodyArHasEdited) delete itemToSave.bodyAr;
        if (input.editForm.bodyEnHasEdited) delete itemToSave.bodyEn;

        savedItem = await NewsAdminClient.saveNewsItem(
          itemToSave,
          input.currentUser,
          false
        );
      } else {
        throw new Error('No active article draft available to save.');
      }

      // Draft save succeeded -> release temporary preview URL and clear transient upload state
      this.revokeCurrentPreviewUrl();
      this.selectedFile = null;
      this.boundIds = null;
      this.retainedCompletedUpload = null;
      this.haltedAmbiguousUpload = null;

      return {
        ok: true,
        savedItem,
        ...(resolvedFeaturedImage ? { linkedAssetId: resolvedFeaturedImage } : {}),
        reusedRetainedUpload,
      };
    } catch (err: any) {
      const baseMsg =
        err?.message || (isAr ? 'فشل حفظ المقال' : 'Failed to save article');
      const errorMessage = this.retainedCompletedUpload
        ? isAr
          ? `تم رفع الصورة بنجاح (${this.retainedCompletedUpload.assetId}) ولكن فشل حفظ مسودة المقال: ${baseMsg}. عند الضغط على "حفظ البيانات والتعديلات" مجدداً سيتم استخدام الصورة المرفوعة دون إعادة رفعها.`
          : `Image uploaded successfully (${this.retainedCompletedUpload.assetId}), but saving the draft article failed: ${baseMsg}. Clicking Save Changes again will safely reuse the uploaded image without re-uploading.`
        : baseMsg;

      return {
        ok: false,
        reasonCode: 'DRAFT_SAVE_FAILED',
        errorMessage,
        retainedCompletedUpload: this.retainedCompletedUpload,
        haltedAmbiguousUpload: this.haltedAmbiguousUpload,
      };
    } finally {
      this.isSaveInFlight = false;
    }
  }
}

