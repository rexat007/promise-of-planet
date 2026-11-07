import { auth } from './firebase';
import { AdminAccessService } from './adminAccess';
import type { AdminUser } from '../types/admin';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
} from '../types/admin';
import type {
  LibraryQuarantineReceiptState,
  SanitizedLibraryQuarantineAdminReceiptDto,
} from '../../functions/src/library/libraryQuarantineReceiptContract';

/**
 * LIB-FILE-UPLOAD-02 — Admin Library Private Quarantine Upload Client & Session Controller
 *
 * SECURITY & ARCHITECTURAL INVARIANTS:
 * 1. Sends a single raw binary PDF/DOCX (`File`/`Blob`) via `fetch()` `POST` to the
 *    explicitly configured and origin-verified HTTPS Cloud Functions endpoint.
 * 2. Never uses `FormData`, `httpsCallable`, base64 JSON encoding, signed URLs,
 *    or direct browser writes to Cloud Storage or Firestore.
 * 3. Never manually sets `Content-Length` (browser-controlled forbidden header).
 * 4. Acquires a fresh Firebase ID token (`getIdToken(true)`) at upload time and
 *    passes it exclusively in `Authorization: Bearer <token>`.
 * 5. Defaults to disabled (`DISABLED_BY_DEFAULT` / `ENDPOINT_UNCONFIGURED`)
 *    until `VITE_LIBRARY_QUARANTINE_UPLOAD_ENABLED === 'true'` AND a verified
 *    project HTTPS endpoint URL is configured in `VITE_LIBRARY_QUARANTINE_UPLOAD_ENDPOINT_URL`.
 * 6. Validates HTTP 201 responses against the strict `QUARANTINED` receipt contract
 *    (32-hex `receiptId`, `revision >= 3`, `adminReceipt.state === 'Quarantined'`,
 *    `hasVerifiedStorageWrite === true`, all 5 posture flags `false`, and zero
 *    storage path / bucket / generation / URL leaks).
 * 7. Never automatically retries on `503` (`NEEDS_RECONCILIATION` / `PERSISTENCE_UNCERTAIN`)
 *    or network/timeout failures (`UPLOAD_OUTCOME_UNCERTAIN`).
 */

export const MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES = 15_000_000 as const;

export const CANONICAL_PDF_MIME_TYPE = 'application/pdf' as const;
export const CANONICAL_DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

export type LibraryQuarantineAllowedFormat = 'pdf' | 'docx';
export type LibraryQuarantineCanonicalExtension = '.pdf' | '.docx';
export type LibraryQuarantineCanonicalMimeType =
  | typeof CANONICAL_PDF_MIME_TYPE
  | typeof CANONICAL_DOCX_MIME_TYPE;

const RECEIPT_ID_HEX_32_REGEX = /^[0-9a-f]{32}$/;
const SHA256_HEX_64_REGEX = /^[0-9a-f]{64}$/;

const ALLOWED_RECEIPT_STATES: ReadonlySet<LibraryQuarantineReceiptState> =
  new Set<LibraryQuarantineReceiptState>([
    'Reserved',
    'WritePending',
    'Quarantined',
    'NeedsReconciliation',
    'Rejected',
  ]);

/**
 * Verified Cloud Functions / Cloud Run hostname patterns for the project's
 * `libraryQuarantineUploadEndpoint` deployment.
 */
const VERIFIED_PROJECT_FUNCTIONS_HOST_REGEX =
  /^[a-z0-9-]+-(promiseofplanet-bb325|promise-of-planet)\.cloudfunctions\.net$/i;

const VERIFIED_FUNCTION_PATHNAME = '/libraryQuarantineUploadEndpoint';

const ALLOWED_ADMIN_RECEIPT_DTO_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'uploaderUid',
  'originalFilename',
  'sanitizedFilename',
  'format',
  'canonicalExtension',
  'canonicalMimeType',
  'byteSize',
  'sha256',
  'state',
  'deepInspectionStatus',
  'hasVerifiedStorageWrite',
  'reconciliationRequired',
  'reconciliationReason',
  'rejectionReasonCode',
  'createdAt',
  'updatedAt',
  'isQuarantinedPrivateOnly',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_QUARANTINED_RESPONSE_TOP_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'receiptId',
  'revision',
  'adminReceipt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const FORBIDDEN_RESPONSE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'storagePath',
  'gcsPath',
  'objectPath',
  'targetPath',
  'destinationPath',
  'bucket',
  'bucketName',
  'storageBucket',
  'gcsBucket',
  'generation',
  'attestedGeneration',
  'gcsGeneration',
  'objectGeneration',
  'metageneration',
  'publicUrl',
  'signedUrl',
  'downloadUrl',
  'downloadToken',
  'mediaLink',
  'selfLink',
  'uri',
  'gcsUri',
  'rawBytes',
  'idToken',
  'accessToken',
  'authorization',
  'serviceAccount',
  'clientEmail',
  'privateKey',
]);

const FORBIDDEN_RESPONSE_STRING_PATTERNS: readonly RegExp[] = [
  /gs:\/\//i,
  /firebasestorage\.googleapis\.com/i,
  /storage\.googleapis\.com/i,
  /promiseofplanet-bb325-library-quarantine/i,
  /promiseofplanet-bb325\.firebasestorage\.app/i,
  /library-quarantine\/uploads\//i,
  /X-Goog-Signature/i,
  /GoogleAccessId/i,
];

/**
 * Checks whether the current AdminUser is authorized to upload documents to
 * private library quarantine.
 * Mirrors backend `verifyAndAuthorizeLibraryHumanEditor`:
 * - Active human administrator (`isActive === true`, `role !== AdminRole.AIAssistant`)
 * - Library domain responsibility (`hasDomainResponsibility(role, AdminDomain.Library)`)
 * - `AdminPermission.Create` or `AdminPermission.Edit`
 */
export function canUploadToLibraryQuarantine(
  user: AdminUser | null | undefined
): boolean {
  if (!user || user.isActive !== true) {
    return false;
  }
  if (user.role === AdminRole.AIAssistant) {
    return false;
  }
  if (!hasDomainResponsibility(user.role, AdminDomain.Library)) {
    return false;
  }
  return (
    AdminAccessService.hasPermission(user, AdminPermission.Create) ||
    AdminAccessService.hasPermission(user, AdminPermission.Edit)
  );
}

export type LibraryQuarantineEndpointGateStatus =
  | 'READY'
  | 'DISABLED_BY_DEFAULT'
  | 'ENDPOINT_UNCONFIGURED'
  | 'ENDPOINT_ORIGIN_UNVERIFIED';

export interface LibraryQuarantineEndpointGateResult {
  readonly enabled: boolean;
  readonly status: LibraryQuarantineEndpointGateStatus;
  readonly endpointUrl: string | null;
  readonly reasonAr: string | null;
  readonly reasonEn: string | null;
}

export interface LibraryQuarantineEndpointEnvOverrides {
  readonly enabledFlag?: string;
  readonly endpointUrl?: string;
  readonly verifiedEndpointOrigins?: ReadonlySet<string>;
}

function readRuntimeEnv(): Record<string, string | undefined> {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env as Record<string, string | undefined>;
  }
  if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    if (proc?.env) {
      return proc.env;
    }
  }
  return {};
}

function isVerifiedLibraryQuarantineEndpointUrl(
  rawUrl: string,
  verifiedEndpointOrigins?: ReadonlySet<string>
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return null;
  }

  const normalizedPathname = parsed.pathname.replace(/\/+$/, '');
  if (normalizedPathname !== VERIFIED_FUNCTION_PATHNAME) {
    return null;
  }

  const origin = parsed.origin;
  const host = parsed.hostname;
  const isDefaultVerifiedHost = VERIFIED_PROJECT_FUNCTIONS_HOST_REGEX.test(host);
  const isExplicitlyVerifiedOrigin =
    verifiedEndpointOrigins !== undefined && verifiedEndpointOrigins.has(origin);

  if (!isDefaultVerifiedHost && !isExplicitlyVerifiedOrigin) {
    return null;
  }

  return `${origin}${VERIFIED_FUNCTION_PATHNAME}`;
}

/**
 * Evaluates the hard deployment gate for `libraryQuarantineUploadEndpoint`.
 * Never synthesizes a live URL from project ID or region; defaults to disabled.
 */
export function resolveLibraryQuarantineUploadEndpointGate(
  overrides?: LibraryQuarantineEndpointEnvOverrides
): LibraryQuarantineEndpointGateResult {
  const env = readRuntimeEnv();
  const rawEnabled =
    overrides?.enabledFlag !== undefined
      ? overrides.enabledFlag
      : env.VITE_LIBRARY_QUARANTINE_UPLOAD_ENABLED;
  const rawEndpointUrl =
    overrides?.endpointUrl !== undefined
      ? overrides.endpointUrl
      : env.VITE_LIBRARY_QUARANTINE_UPLOAD_ENDPOINT_URL;

  const isExplicitlyEnabled =
    typeof rawEnabled === 'string' && rawEnabled.trim() === 'true';
  const trimmedUrl =
    typeof rawEndpointUrl === 'string' ? rawEndpointUrl.trim() : '';

  if (!isExplicitlyEnabled) {
    return {
      enabled: false,
      status: 'DISABLED_BY_DEFAULT',
      endpointUrl: null,
      reasonAr:
        'بوابة الرفع إلى الحجر الخاص غير مفعّلة في هذه البيئة حالياً (لم يتم نشر الوظيفة الخلفية بعد).',
      reasonEn:
        'Private quarantine upload gateway is currently disabled in this environment (backend function not yet deployed).',
    };
  }

  if (trimmedUrl.length === 0) {
    return {
      enabled: false,
      status: 'ENDPOINT_UNCONFIGURED',
      endpointUrl: null,
      reasonAr:
        'عنوان نقطة النهاية لبوابة الحجر الخاص غير مضبوط (VITE_LIBRARY_QUARANTINE_UPLOAD_ENDPOINT_URL).',
      reasonEn:
        'Private quarantine upload endpoint URL is unconfigured (VITE_LIBRARY_QUARANTINE_UPLOAD_ENDPOINT_URL).',
    };
  }

  const verifiedUrl = isVerifiedLibraryQuarantineEndpointUrl(
    trimmedUrl,
    overrides?.verifiedEndpointOrigins
  );
  if (!verifiedUrl) {
    return {
      enabled: false,
      status: 'ENDPOINT_ORIGIN_UNVERIFIED',
      endpointUrl: null,
      reasonAr:
        'تم رفض عنوان نقطة النهاية لأن النطاق غير موثق أو لا يستخدم بروتوكول HTTPS الصارم لوظائف المشروع.',
      reasonEn:
        'Endpoint URL rejected because its origin is unverified or does not match the strict HTTPS project Functions endpoint.',
    };
  }

  return {
    enabled: true,
    status: 'READY',
    endpointUrl: verifiedUrl,
    reasonAr: null,
    reasonEn: null,
  };
}

export type LibraryQuarantineClientValidationErrorCode =
  | 'FILE_REQUIRED'
  | 'INVALID_FILENAME'
  | 'UNSUPPORTED_EXTENSION'
  | 'EMPTY_BINARY'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'CLAIMED_MIME_MISMATCH';

export interface ValidatedLibraryQuarantineFileCandidate {
  readonly ok: true;
  readonly format: LibraryQuarantineAllowedFormat;
  readonly canonicalExtension: LibraryQuarantineCanonicalExtension;
  readonly canonicalMimeType: LibraryQuarantineCanonicalMimeType;
  readonly originalFilename: string;
  readonly byteSize: number;
}

export interface RejectedLibraryQuarantineFileCandidate {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineClientValidationErrorCode;
  readonly messageAr: string;
  readonly messageEn: string;
}

export type LibraryQuarantineFileValidationResult =
  | ValidatedLibraryQuarantineFileCandidate
  | RejectedLibraryQuarantineFileCandidate;

/**
 * Pure client-side preflight validation for a candidate PDF or DOCX file.
 * Server-side admission (`LIB-FILE-01A` + `LIB-FILE-01B`) remains authoritative.
 */
export function validateLibraryQuarantineFileCandidate(
  file: File | null | undefined
): LibraryQuarantineFileValidationResult {
  if (!file) {
    return {
      ok: false,
      errorCode: 'FILE_REQUIRED',
      messageAr: 'يرجى اختيار ملف بصيغة PDF أو DOCX أولاً.',
      messageEn: 'Please select a PDF or DOCX file first.',
    };
  }

  const rawName = typeof file.name === 'string' ? file.name.trim() : '';
  if (
    rawName.length === 0 ||
    rawName.length > 255 ||
    rawName.includes('/') ||
    rawName.includes('\\') ||
    rawName.includes('\0')
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_FILENAME',
      messageAr: 'اسم الملف غير صالح أو يحتوي على محارف مسار ممنوعة.',
      messageEn: 'Invalid filename or forbidden path characters detected.',
    };
  }

  const lowerName = rawName.toLowerCase();
  let format: LibraryQuarantineAllowedFormat | null = null;
  let canonicalExtension: LibraryQuarantineCanonicalExtension | null = null;
  let canonicalMimeType: LibraryQuarantineCanonicalMimeType | null = null;

  if (lowerName.endsWith('.pdf') && lowerName.length > 4) {
    format = 'pdf';
    canonicalExtension = '.pdf';
    canonicalMimeType = CANONICAL_PDF_MIME_TYPE;
  } else if (lowerName.endsWith('.docx') && lowerName.length > 5) {
    format = 'docx';
    canonicalExtension = '.docx';
    canonicalMimeType = CANONICAL_DOCX_MIME_TYPE;
  }

  if (!format || !canonicalExtension || !canonicalMimeType) {
    return {
      ok: false,
      errorCode: 'UNSUPPORTED_EXTENSION',
      messageAr:
        'امتداد الملف غير مدعوم. يُسمح فقط بملفات PDF (.pdf) أو Word (.docx) القياسية.',
      messageEn:
        'Unsupported file extension. Only standard PDF (.pdf) and Word (.docx) files are permitted.',
    };
  }

  const byteSize = file.size;
  if (typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
    return {
      ok: false,
      errorCode: 'EMPTY_BINARY',
      messageAr: 'الملف المختار فارغ (0 بايت). لا يمكن رفع ملف فارغ.',
      messageEn: 'The selected file is empty (0 bytes). Empty files cannot be uploaded.',
    };
  }

  if (byteSize > MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES) {
    return {
      ok: false,
      errorCode: 'SIZE_LIMIT_EXCEEDED',
      messageAr:
        'حجم الملف يتجاوز الحد الأقصى المسموح به للحجر الخاص (15,000,000 بايت).',
      messageEn:
        'File size exceeds the maximum private quarantine limit (15,000,000 bytes).',
    };
  }

  const rawMime = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  if (rawMime.length > 0 && rawMime !== 'application/octet-stream') {
    if (rawMime !== canonicalMimeType) {
      return {
        ok: false,
        errorCode: 'CLAIMED_MIME_MISMATCH',
        messageAr:
          'نوع المحتوى المعلن للملف لا يتطابق مع امتداده (.pdf أو .docx).',
        messageEn:
          'File claimed MIME type does not match its extension (.pdf or .docx).',
      };
    }
  }

  return {
    ok: true,
    format,
    canonicalExtension,
    canonicalMimeType,
    originalFilename: rawName,
    byteSize,
  };
}

export type LibraryQuarantineUploadOutcomeKind =
  | 'QUARANTINED'
  | 'NEEDS_RECONCILIATION'
  | 'PERSISTENCE_UNCERTAIN'
  | 'UPLOAD_OUTCOME_UNCERTAIN'
  | 'REJECTED';

export interface LibraryQuarantineUploadQuarantinedOutcome {
  readonly ok: true;
  readonly outcome: 'QUARANTINED';
  readonly httpStatus: 201;
  readonly receiptId: string;
  readonly revision: number;
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly messageAr: string;
  readonly messageEn: string;
}

export interface LibraryQuarantineUploadNonSuccessOutcome {
  readonly ok: false;
  readonly outcome: Exclude<LibraryQuarantineUploadOutcomeKind, 'QUARANTINED'>;
  readonly httpStatus: number | null;
  readonly errorCode: string;
  readonly binaryRejectionCode: string | null;
  readonly receiptId: string | null;
  readonly revision: number | null;
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto | null;
  readonly requiresUncertaintyAck: boolean;
  readonly messageAr: string;
  readonly messageEn: string;
}

export type LibraryQuarantineUploadResult =
  | LibraryQuarantineUploadQuarantinedOutcome
  | LibraryQuarantineUploadNonSuccessOutcome;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function containsForbiddenResponseLeak(value: unknown, depth = 0): boolean {
  if (depth > 8) {
    return true;
  }
  if (typeof value === 'string') {
    return FORBIDDEN_RESPONSE_STRING_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenResponseLeak(item, depth + 1));
  }
  if (isPlainRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_RESPONSE_PROPERTY_NAMES.has(key)) {
        return true;
      }
      if (containsForbiddenResponseLeak(nested, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function validateSanitizedAdminReceiptDto(
  candidate: unknown,
  expectedReceiptId: string,
  expectedState?: LibraryQuarantineReceiptState
): SanitizedLibraryQuarantineAdminReceiptDto | null {
  if (!isPlainRecord(candidate)) {
    return null;
  }

  const keys = Object.keys(candidate);
  if (keys.length !== ALLOWED_ADMIN_RECEIPT_DTO_KEYS.size) {
    return null;
  }
  for (const key of keys) {
    if (!ALLOWED_ADMIN_RECEIPT_DTO_KEYS.has(key)) {
      return null;
    }
  }

  if (candidate.receiptId !== expectedReceiptId) {
    return null;
  }
  if (!RECEIPT_ID_HEX_32_REGEX.test(candidate.receiptId)) {
    return null;
  }
  if (
    typeof candidate.uploaderUid !== 'string' ||
    candidate.uploaderUid.trim().length === 0
  ) {
    return null;
  }
  if (
    typeof candidate.originalFilename !== 'string' ||
    candidate.originalFilename.trim().length === 0 ||
    typeof candidate.sanitizedFilename !== 'string' ||
    candidate.sanitizedFilename.trim().length === 0
  ) {
    return null;
  }
  if (candidate.format !== 'pdf' && candidate.format !== 'docx') {
    return null;
  }
  if (
    (candidate.format === 'pdf' &&
      (candidate.canonicalExtension !== 'pdf' ||
        candidate.canonicalMimeType !== CANONICAL_PDF_MIME_TYPE ||
        candidate.deepInspectionStatus !== 'PDF_REQUIRES_ISOLATED_PARSER')) ||
    (candidate.format === 'docx' &&
      (candidate.canonicalExtension !== 'docx' ||
        candidate.canonicalMimeType !== CANONICAL_DOCX_MIME_TYPE ||
        candidate.deepInspectionStatus !==
          'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'))
  ) {
    return null;
  }
  if (
    typeof candidate.byteSize !== 'number' ||
    !Number.isSafeInteger(candidate.byteSize) ||
    candidate.byteSize <= 0 ||
    candidate.byteSize > MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES
  ) {
    return null;
  }
  if (
    typeof candidate.sha256 !== 'string' ||
    !SHA256_HEX_64_REGEX.test(candidate.sha256)
  ) {
    return null;
  }
  if (
    typeof candidate.state !== 'string' ||
    !ALLOWED_RECEIPT_STATES.has(
      candidate.state as LibraryQuarantineReceiptState
    )
  ) {
    return null;
  }
  if (expectedState && candidate.state !== expectedState) {
    return null;
  }
  if (
    candidate.isQuarantinedPrivateOnly !== true ||
    candidate.isSanitized !== false ||
    candidate.isVerifiedSafe !== false ||
    candidate.isRightsApproved !== false ||
    candidate.isPublished !== false ||
    candidate.isReadyForPeia !== false
  ) {
    return null;
  }
  if (
    typeof candidate.createdAt !== 'string' ||
    candidate.createdAt.length === 0 ||
    typeof candidate.updatedAt !== 'string' ||
    candidate.updatedAt.length === 0
  ) {
    return null;
  }

  return candidate as unknown as SanitizedLibraryQuarantineAdminReceiptDto;
}

function mapRejectionMessages(
  errorCode: string,
  binaryRejectionCode: string | null
): { messageAr: string; messageEn: string } {
  const effectiveCode = binaryRejectionCode ?? errorCode;
  switch (effectiveCode) {
    case 'EMPTY_BINARY':
      return {
        messageAr: 'تم رفض الرفع: الملف فارغ.',
        messageEn: 'Upload rejected: the binary payload is empty.',
      };
    case 'SIZE_LIMIT_EXCEEDED':
      return {
        messageAr: 'تم رفض الرفع: حجم الملف يتجاوز الحد الأقصى المسموح به (15,000,000 بايت).',
        messageEn: 'Upload rejected: file size exceeds the 15,000,000-byte limit.',
      };
    case 'CLAIMED_MIME_MISMATCH':
    case 'UNSUPPORTED_CONTENT_TYPE':
    case 'MAGIC_SIGNATURE_MISMATCH':
      return {
        messageAr: 'تم رفض الرفع: توقيع الملف الفعلي أو نوعه لا يطابق صيغة PDF أو DOCX قياسية.',
        messageEn: 'Upload rejected: file signature or MIME type does not match standard PDF or DOCX.',
      };
    case 'MACRO_ENABLED_FORMAT_FORBIDDEN':
      return {
        messageAr: 'تم رفض الرفع أمنياً: يحتوي الملف على وحدات ماكرو (VBA) محظورة.',
        messageEn: 'Upload rejected for security: macro-enabled (VBA) content is forbidden.',
      };
    case 'PDF_ACTIVE_CONTENT_FORBIDDEN':
    case 'PDF_EMBEDDED_FILES_FORBIDDEN':
    case 'PDF_LAUNCH_ACTION_FORBIDDEN':
      return {
        messageAr: 'تم رفض ملف PDF أمنياً لاحتوائه على محتوى نشط أو مرفقات مدمجة محظورة.',
        messageEn: 'PDF rejected for security: contains forbidden active content or embedded files.',
      };
    case 'DOCX_EXTERNAL_RELATIONSHIP_FORBIDDEN':
    case 'DOCX_ACTIVE_CONTENT_FORBIDDEN':
    case 'ZIP_TRAVERSAL_OR_SYMLINK_FORBIDDEN':
    case 'ZIP_BOMB_LIMIT_EXCEEDED':
      return {
        messageAr: 'تم رفض ملف DOCX أمنياً لعدم اجتياز فحص البنية العميقة.',
        messageEn: 'DOCX rejected for security: failed deep structural inspection.',
      };
    case 'UNAUTHENTICATED':
      return {
        messageAr: 'جلسة المصادقة غير صالحة أو منتهية. يرجى إعادة تسجيل الدخول.',
        messageEn: 'Authentication session is missing or expired. Please sign in again.',
      };
    case 'PERMISSION_DENIED':
    case 'AI_ACCOUNT_FORBIDDEN':
      return {
        messageAr: 'ليس لديك الصلاحية الإدارية لرفع المستندات إلى الحجر الخاص للمكتبة.',
        messageEn: 'You do not have administrative permission to upload documents to library quarantine.',
      };
    default:
      return {
        messageAr: 'تم رفض رفع المستند بواسطة بوابة الفحص الأمني للحجر الخاص.',
        messageEn: 'Document upload was rejected by the private quarantine security gateway.',
      };
  }
}

/**
 * Validates the HTTP status and parsed JSON body returned by `libraryQuarantineUploadEndpoint`.
 * HTTP 201 is NEVER accepted as `QUARANTINED` unless all receipt contract invariants hold.
 */
export function validateLibraryQuarantineUploadResponse(
  httpStatus: number,
  parsedBody: unknown
): LibraryQuarantineUploadResult {
  if (!isPlainRecord(parsedBody) || containsForbiddenResponseLeak(parsedBody)) {
    return {
      ok: false,
      outcome: 'UPLOAD_OUTCOME_UNCERTAIN',
      httpStatus,
      errorCode: 'INVALID_SERVER_RESPONSE_CONTRACT',
      binaryRejectionCode: null,
      receiptId: null,
      revision: null,
      adminReceipt: null,
      requiresUncertaintyAck: true,
      messageAr:
        'نتيجة الرفع غير مؤكدة — استجابة الخادم لم تطابق عقد إيصال الحجر الآمن.',
      messageEn:
        'Upload outcome uncertain — server response did not satisfy the safe quarantine receipt contract.',
    };
  }

  const postureFlagsStrictlyFalse =
    parsedBody.isSanitized === false &&
    parsedBody.isVerifiedSafe === false &&
    parsedBody.isRightsApproved === false &&
    parsedBody.isPublished === false &&
    parsedBody.isReadyForPeia === false;

  if (httpStatus === 201) {
    const bodyKeys = Object.keys(parsedBody);
    const hasOnlyAllowedTopKeys =
      bodyKeys.length === ALLOWED_QUARANTINED_RESPONSE_TOP_KEYS.size &&
      bodyKeys.every((key) => ALLOWED_QUARANTINED_RESPONSE_TOP_KEYS.has(key));

    const receiptId =
      typeof parsedBody.receiptId === 'string' &&
      RECEIPT_ID_HEX_32_REGEX.test(parsedBody.receiptId)
        ? parsedBody.receiptId
        : null;
    const revision =
      typeof parsedBody.revision === 'number' &&
      Number.isSafeInteger(parsedBody.revision) &&
      parsedBody.revision >= 3
        ? parsedBody.revision
        : null;

    const validatedAdminReceipt = receiptId
      ? validateSanitizedAdminReceiptDto(
          parsedBody.adminReceipt,
          receiptId,
          'Quarantined'
        )
      : null;

    if (
      !hasOnlyAllowedTopKeys ||
      parsedBody.ok !== true ||
      parsedBody.status !== 'QUARANTINED' ||
      !postureFlagsStrictlyFalse ||
      !receiptId ||
      revision === null ||
      !validatedAdminReceipt ||
      validatedAdminReceipt.hasVerifiedStorageWrite !== true ||
      validatedAdminReceipt.reconciliationRequired !== false ||
      validatedAdminReceipt.reconciliationReason !== null ||
      validatedAdminReceipt.rejectionReasonCode !== null
    ) {
      return {
        ok: false,
        outcome: 'UPLOAD_OUTCOME_UNCERTAIN',
        httpStatus,
        errorCode: 'INVALID_QUARANTINED_RECEIPT_INVARIANT',
        binaryRejectionCode: null,
        receiptId,
        revision,
        adminReceipt: null,
        requiresUncertaintyAck: true,
        messageAr:
          'نتيجة الرفع غير مؤكدة — لم تكتمل شروط التحقق من إيصال الحجر الخاص.',
        messageEn:
          'Upload outcome uncertain — quarantined receipt verification invariants were not satisfied.',
      };
    }

    return {
      ok: true,
      outcome: 'QUARANTINED',
      httpStatus: 201,
      receiptId,
      revision,
      adminReceipt: validatedAdminReceipt,
      messageAr:
        'تم إيداع المستند في الحجر الخاص بنجاح وتوثيق الإيصال (تخزين خاص معزول فقط — غير منشور وغير جاهز للنشر أو لـ PEIA).',
      messageEn:
        'Document stored in private quarantine with a verified receipt (isolated private storage only — not published, not rights-approved, and not ready for PEIA).',
    };
  }

  const candidateReceiptId =
    typeof parsedBody.receiptId === 'string' &&
    RECEIPT_ID_HEX_32_REGEX.test(parsedBody.receiptId)
      ? parsedBody.receiptId
      : null;
  const candidateRevision =
    typeof parsedBody.revision === 'number' &&
    Number.isSafeInteger(parsedBody.revision) &&
    parsedBody.revision >= 1
      ? parsedBody.revision
      : typeof parsedBody.lastKnownRevision === 'number' &&
          Number.isSafeInteger(parsedBody.lastKnownRevision) &&
          parsedBody.lastKnownRevision >= 1
        ? parsedBody.lastKnownRevision
        : null;

  const validatedOptionalAdminReceipt = candidateReceiptId
    ? validateSanitizedAdminReceiptDto(parsedBody.adminReceipt, candidateReceiptId)
    : null;

  const statusField = typeof parsedBody.status === 'string' ? parsedBody.status : '';
  const errorCode =
    typeof parsedBody.errorCode === 'string' && parsedBody.errorCode.trim().length > 0
      ? parsedBody.errorCode.trim()
      : 'UPLOAD_FAILED';
  const binaryRejectionCode =
    typeof parsedBody.binaryRejectionCode === 'string' &&
    parsedBody.binaryRejectionCode.trim().length > 0
      ? parsedBody.binaryRejectionCode.trim()
      : null;

  if (
    statusField === 'NEEDS_RECONCILIATION' ||
    (httpStatus === 503 && statusField !== 'PERSISTENCE_UNCERTAIN')
  ) {
    return {
      ok: false,
      outcome: 'NEEDS_RECONCILIATION',
      httpStatus,
      errorCode,
      binaryRejectionCode,
      receiptId: candidateReceiptId,
      revision: candidateRevision,
      adminReceipt: validatedOptionalAdminReceipt,
      requiresUncertaintyAck: true,
      messageAr:
        'العملية تتطلب مطابقة إدارية (NEEDS_RECONCILIATION) — يرجى الاحتفاظ بمعرّف الإيصال وعدم إعادة رفع الملف تلقائياً.',
      messageEn:
        'Upload requires administrative reconciliation (NEEDS_RECONCILIATION) — retain the receipt ID and do not automatically re-upload.',
    };
  }

  if (statusField === 'PERSISTENCE_UNCERTAIN') {
    return {
      ok: false,
      outcome: 'PERSISTENCE_UNCERTAIN',
      httpStatus,
      errorCode,
      binaryRejectionCode,
      receiptId: candidateReceiptId,
      revision: candidateRevision,
      adminReceipt: validatedOptionalAdminReceipt,
      requiresUncertaintyAck: true,
      messageAr:
        'حالة حفظ الإيصال غير مؤكدة (PERSISTENCE_UNCERTAIN) — يرجى الاحتفاظ بمعرّف الإيصال للمراجعة وعدم تكرار الرفع.',
      messageEn:
        'Receipt persistence state is uncertain (PERSISTENCE_UNCERTAIN) — retain the receipt ID for recovery and do not repeat the upload.',
    };
  }

  if (httpStatus >= 500) {
    return {
      ok: false,
      outcome: 'UPLOAD_OUTCOME_UNCERTAIN',
      httpStatus,
      errorCode,
      binaryRejectionCode,
      receiptId: candidateReceiptId,
      revision: candidateRevision,
      adminReceipt: validatedOptionalAdminReceipt,
      requiresUncertaintyAck: true,
      messageAr:
        'نتيجة الرفع غير مؤكدة بسبب خطأ في الخادم — لا تقم بإعادة الرفع تلقائياً قبل التحقق.',
      messageEn:
        'Upload outcome uncertain due to a server error — do not automatically retry before verification.',
    };
  }

  const { messageAr, messageEn } = mapRejectionMessages(errorCode, binaryRejectionCode);
  return {
    ok: false,
    outcome: 'REJECTED',
    httpStatus,
    errorCode,
    binaryRejectionCode,
    receiptId: candidateReceiptId,
    revision: candidateRevision,
    adminReceipt: null,
    requiresUncertaintyAck: false,
    messageAr,
    messageEn,
  };
}

export interface LibraryQuarantineUploadRuntimeDependencies {
  readonly getFreshIdToken?: () => Promise<string | null>;
  readonly fetchFn?: typeof fetch;
  readonly envOverrides?: LibraryQuarantineEndpointEnvOverrides;
}

async function defaultGetFreshIdToken(): Promise<string | null> {
  const currentUser = auth?.currentUser;
  if (!currentUser || typeof currentUser.getIdToken !== 'function') {
    return null;
  }
  const token = await currentUser.getIdToken(true);
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
}

/**
 * Executes a single raw binary `POST` upload of a PDF/DOCX file to `libraryQuarantineUploadEndpoint`.
 * Never retries automatically.
 */
export async function uploadDocumentToLibraryQuarantine(
  user: AdminUser | null | undefined,
  file: File | null | undefined,
  deps?: LibraryQuarantineUploadRuntimeDependencies
): Promise<LibraryQuarantineUploadResult> {
  if (!canUploadToLibraryQuarantine(user)) {
    return {
      ok: false,
      outcome: 'REJECTED',
      httpStatus: null,
      errorCode: 'PERMISSION_DENIED',
      binaryRejectionCode: null,
      receiptId: null,
      revision: null,
      adminReceipt: null,
      requiresUncertaintyAck: false,
      messageAr: 'ليس لديك الصلاحية الإدارية لرفع المستندات إلى الحجر الخاص للمكتبة.',
      messageEn: 'You do not have administrative permission to upload documents to library quarantine.',
    };
  }

  const gate = resolveLibraryQuarantineUploadEndpointGate(deps?.envOverrides);
  if (!gate.enabled || !gate.endpointUrl) {
    return {
      ok: false,
      outcome: 'REJECTED',
      httpStatus: null,
      errorCode: gate.status,
      binaryRejectionCode: null,
      receiptId: null,
      revision: null,
      adminReceipt: null,
      requiresUncertaintyAck: false,
      messageAr:
        gate.reasonAr ??
        'بوابة الرفع إلى الحجر الخاص غير مفعّلة في هذه البيئة.',
      messageEn:
        gate.reasonEn ??
        'Private quarantine upload gateway is not enabled in this environment.',
    };
  }

  const preflight = validateLibraryQuarantineFileCandidate(file);
  if (!preflight.ok || !file) {
    return {
      ok: false,
      outcome: 'REJECTED',
      httpStatus: null,
      errorCode: preflight.ok ? 'FILE_REQUIRED' : preflight.errorCode,
      binaryRejectionCode: null,
      receiptId: null,
      revision: null,
      adminReceipt: null,
      requiresUncertaintyAck: false,
      messageAr: preflight.ok
        ? 'يرجى اختيار ملف بصيغة PDF أو DOCX أولاً.'
        : preflight.messageAr,
      messageEn: preflight.ok
        ? 'Please select a PDF or DOCX file first.'
        : preflight.messageEn,
    };
  }

  const getToken = deps?.getFreshIdToken ?? defaultGetFreshIdToken;
  let idToken: string | null = null;
  try {
    idToken = await getToken();
  } catch {
    idToken = null;
  }

  if (
    !idToken ||
    idToken.trim().length === 0 ||
    /\s/.test(idToken.trim())
  ) {
    return {
      ok: false,
      outcome: 'REJECTED',
      httpStatus: null,
      errorCode: 'UNAUTHENTICATED',
      binaryRejectionCode: null,
      receiptId: null,
      revision: null,
      adminReceipt: null,
      requiresUncertaintyAck: false,
      messageAr: 'تعذر الحصول على رمز مصادقة إداري صالح. يرجى إعادة تسجيل الدخول.',
      messageEn: 'Unable to obtain a fresh administrative Firebase ID token. Please sign in again.',
    };
  }

  const fetchImpl = deps?.fetchFn ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      outcome: 'REJECTED',
      httpStatus: null,
      errorCode: 'TRANSPORT_UNAVAILABLE',
      binaryRejectionCode: null,
      receiptId: null,
      revision: null,
      adminReceipt: null,
      requiresUncertaintyAck: false,
      messageAr: 'واجهة الاتصال الشبكي غير متوفرة في هذه البيئة.',
      messageEn: 'Network fetch transport is unavailable in this environment.',
    };
  }

  const encodedFilename = encodeURIComponent(preflight.originalFilename);
  const encodedMetadata = encodeURIComponent(
    JSON.stringify({
      originalFilename: preflight.originalFilename,
      claimedMimeType: preflight.canonicalMimeType,
    })
  );

  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${idToken.trim()}`,
    'Content-Type': preflight.canonicalMimeType,
    'X-Original-Filename': encodedFilename,
    'X-Library-Upload-Metadata': encodedMetadata,
  };

  let response: Response;
  try {
    response = await fetchImpl(gate.endpointUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: file,
      credentials: 'omit',
    });
  } catch {
    return {
      ok: false,
      outcome: 'UPLOAD_OUTCOME_UNCERTAIN',
      httpStatus: null,
      errorCode: 'NETWORK_OR_TIMEOUT_UNCERTAIN',
      binaryRejectionCode: null,
      receiptId: null,
      revision: null,
      adminReceipt: null,
      requiresUncertaintyAck: true,
      messageAr:
        'نتيجة الرفع غير مؤكدة — انقطع الاتصال أو انتهت المهلة بعد إرسال الطلب. لا تقم بإعادة الرفع تلقائياً قبل التحقق.',
      messageEn:
        'Upload outcome uncertain — network connection failed or timed out after request dispatch. Do not automatically re-upload before checking.',
    };
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = await response.json();
  } catch {
    return {
      ok: false,
      outcome: 'UPLOAD_OUTCOME_UNCERTAIN',
      httpStatus: response.status,
      errorCode: 'NON_JSON_SERVER_RESPONSE',
      binaryRejectionCode: null,
      receiptId: null,
      revision: null,
      adminReceipt: null,
      requiresUncertaintyAck: true,
      messageAr:
        'نتيجة الرفع غير مؤكدة — تعذر قراءة استجابة الخادم بصيغة JSON آمنة.',
      messageEn:
        'Upload outcome uncertain — server returned a non-JSON or unreadable response.',
    };
  }

  return validateLibraryQuarantineUploadResponse(response.status, parsedBody);
}

export interface LibraryQuarantineUploadSessionSnapshot {
  readonly isOpen: boolean;
  readonly sessionToken: number;
  readonly selectedFilename: string | null;
  readonly selectedByteSize: number | null;
  readonly selectedFormat: LibraryQuarantineAllowedFormat | null;
  readonly preflightValidation: LibraryQuarantineFileValidationResult | null;
  readonly isUploading: boolean;
  readonly lastResult: LibraryQuarantineUploadResult | null;
  readonly unacknowledgedUncertainResult: LibraryQuarantineUploadNonSuccessOutcome | null;
}

export function createInitialLibraryQuarantineUploadSessionSnapshot(
  sessionToken = 0,
  isOpen = false
): LibraryQuarantineUploadSessionSnapshot {
  return {
    isOpen,
    sessionToken,
    selectedFilename: null,
    selectedByteSize: null,
    selectedFormat: null,
    preflightValidation: null,
    isUploading: false,
    lastResult: null,
    unacknowledgedUncertainResult: null,
  };
}

/**
 * Session-safe state controller for the Admin Library Private Quarantine Upload panel.
 * - Isolates async operations via `sessionToken` so stale responses after file switch
 *   or modal close cannot overwrite current state.
 * - Prevents duplicate concurrent submissions while `isUploading === true`.
 * - Preserves uncertain outcomes (`NEEDS_RECONCILIATION`, `PERSISTENCE_UNCERTAIN`,
 *   `UPLOAD_OUTCOME_UNCERTAIN`) until explicitly acknowledged by the administrator.
 */
export class LibraryQuarantineUploadSessionController {
  private snapshot: LibraryQuarantineUploadSessionSnapshot;
  private activeFile: File | null = null;
  private currentUser: AdminUser | null | undefined;
  private deps?: LibraryQuarantineUploadRuntimeDependencies;
  private readonly listeners = new Set<
    (snapshot: LibraryQuarantineUploadSessionSnapshot) => void
  >();

  constructor(
    currentUser: AdminUser | null | undefined,
    deps?: LibraryQuarantineUploadRuntimeDependencies,
    initialIsOpen = false
  ) {
    this.currentUser = currentUser;
    this.deps = deps;
    this.snapshot = createInitialLibraryQuarantineUploadSessionSnapshot(
      0,
      initialIsOpen
    );
  }

  public setCurrentUser(user: AdminUser | null | undefined): void {
    this.currentUser = user;
  }

  public setDependencies(deps?: LibraryQuarantineUploadRuntimeDependencies): void {
    this.deps = deps;
  }

  public getSnapshot(): LibraryQuarantineUploadSessionSnapshot {
    return this.snapshot;
  }

  public subscribe(
    listener: (snapshot: LibraryQuarantineUploadSessionSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: LibraryQuarantineUploadSessionSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  public openPanel(): void {
    if (this.snapshot.isOpen) {
      return;
    }
    this.emit({
      ...this.snapshot,
      isOpen: true,
    });
  }

  /**
   * Closes the panel and invalidates any in-flight session token so a late response
   * cannot overwrite subsequent sessions, while preserving any unacknowledged uncertain result.
   */
  public closePanel(): void {
    this.activeFile = null;
    this.emit({
      ...this.snapshot,
      isOpen: false,
      sessionToken: this.snapshot.sessionToken + 1,
      selectedFilename: null,
      selectedByteSize: null,
      selectedFormat: null,
      preflightValidation: null,
      isUploading: false,
    });
  }

  public acknowledgeUncertainResult(): void {
    if (!this.snapshot.unacknowledgedUncertainResult) {
      return;
    }
    this.emit({
      ...this.snapshot,
      unacknowledgedUncertainResult: null,
      lastResult:
        this.snapshot.lastResult === this.snapshot.unacknowledgedUncertainResult
          ? null
          : this.snapshot.lastResult,
    });
  }

  public selectFile(file: File | null): void {
    if (this.snapshot.isUploading) {
      return;
    }

    const nextToken = this.snapshot.sessionToken + 1;
    if (!file) {
      this.activeFile = null;
      this.emit({
        ...this.snapshot,
        sessionToken: nextToken,
        selectedFilename: null,
        selectedByteSize: null,
        selectedFormat: null,
        preflightValidation: null,
        lastResult: this.snapshot.unacknowledgedUncertainResult ?? null,
      });
      return;
    }

    const validation = validateLibraryQuarantineFileCandidate(file);
    this.activeFile = validation.ok ? file : null;
    this.emit({
      ...this.snapshot,
      sessionToken: nextToken,
      selectedFilename: typeof file.name === 'string' ? file.name : null,
      selectedByteSize: typeof file.size === 'number' ? file.size : null,
      selectedFormat: validation.ok ? validation.format : null,
      preflightValidation: validation,
      lastResult: this.snapshot.unacknowledgedUncertainResult ?? null,
    });
  }

  public async submitSelectedFile(): Promise<LibraryQuarantineUploadResult | null> {
    if (this.snapshot.isUploading) {
      return null;
    }
    if (this.snapshot.unacknowledgedUncertainResult) {
      return null;
    }

    const fileToUpload = this.activeFile;
    const requestToken = this.snapshot.sessionToken + 1;

    this.emit({
      ...this.snapshot,
      sessionToken: requestToken,
      isUploading: true,
      lastResult: null,
    });

    const result = await uploadDocumentToLibraryQuarantine(
      this.currentUser,
      fileToUpload,
      this.deps
    );

    // Release raw File reference immediately after request completes
    if (this.snapshot.sessionToken === requestToken) {
      this.activeFile = null;
    }

    // Ignore stale response if session was invalidated by modal close or file switch,
    // except if the outcome is uncertain we still preserve it in unacknowledgedUncertainResult
    // so an interrupted/uncertain receipt is never silently lost.
    if (this.snapshot.sessionToken !== requestToken) {
      if (!result.ok && result.requiresUncertaintyAck) {
        this.emit({
          ...this.snapshot,
          unacknowledgedUncertainResult: result,
        });
      }
      return null;
    }

    const unacknowledgedUncertainResult =
      !result.ok && result.requiresUncertaintyAck ? result : null;

    this.emit({
      ...this.snapshot,
      isUploading: false,
      lastResult: result,
      unacknowledgedUncertainResult,
    });

    return result;
  }
}
