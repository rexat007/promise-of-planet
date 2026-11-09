import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
  type AdminUser,
} from '../types/admin';
import { AdminAccessService } from './adminAccess';
import {
  LibraryDocumentType,
  LibraryRightsStatus,
} from '../types/library';
import { WorkflowState } from '../types/workflow';
import {
  isLibraryQuarantineHumanReviewEnabled,
  type LibraryQuarantineHumanReviewCaseStatus,
  type SanitizedLibraryQuarantineHumanReviewCaseDto,
} from './libraryQuarantineHumanReviewClient';

/**
 * LIB-FILE-CATALOG-HANDOFF-01 — Browser-Safe Typed Client for Internal Catalog Draft Handoff
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Calls ONLY the existing `manageLibraryDocuments` Firebase callable with exact
 *   minimal payloads (`{ action: 'getQuarantineCatalogHandoff', receiptId }` and
 *   `{ action: 'createQuarantineCatalogDraft', receiptId, expectedCaseRevision, input }`).
 * - Never accesses Firestore or Google Cloud Storage directly from the browser.
 * - Requires ALL THREE UI release gates (`VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED === 'true'`,
 *   `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED === 'true'`, and
 *   `VITE_LIBRARY_CATALOG_HANDOFF_ENABLED === 'true'`, default disabled).
 * - Requires active human Library administrator with BOTH `AdminPermission.Review`
 *   AND `AdminPermission.Create`.
 * - Strictly validates the 16-field `SanitizedLibraryQuarantineCatalogHandoffDto`,
 *   the internal `SanitizedLibraryQuarantineCatalogDocumentDto` (`workflowState: 'Draft'`,
 *   `rightsStatus: 'ReviewRequired'`, and zero `referenceUrl` on versions), and all
 *   server responses (`READY | HANDOFF_RECORDED | CONFLICT | HOLD | UNKNOWN`),
 *   rejecting extra keys, symbol properties, HTML tags, private storage paths,
 *   `sourceSha256`, `createdBy`, `updatedBy`, `storagePath`, `generation`,
 *   signed URLs, or escalated security posture flags.
 * - Never auto-retries on `UNKNOWN` (`documentCreated: null`).
 */

export const LIBRARY_CATALOG_HANDOFF_UI_ENV_VAR =
  'VITE_LIBRARY_CATALOG_HANDOFF_ENABLED' as const;

export const LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION = 1 as const;

export const QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX = 'qcat-' as const;
export const QUARANTINE_CATALOG_DOCUMENT_ID_REGEX = /^qcat-[0-9a-f]{32}$/;

export const CATALOG_HANDOFF_TITLE_MAX_LENGTH = 300 as const;
export const CATALOG_HANDOFF_SUMMARY_MAX_LENGTH = 2000 as const;
export const CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH = 200 as const;
export const CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH = 1000 as const;
export const CATALOG_HANDOFF_ID_REF_MAX_LENGTH = 128 as const;
export const CATALOG_HANDOFF_TAG_MAX_LENGTH = 120 as const;
export const CATALOG_HANDOFF_MAX_TOPICS = 20 as const;
export const CATALOG_HANDOFF_MAX_DOMAINS = 10 as const;

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;
const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const ISO_UTC_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const SINGLE_LINE_CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const MULTI_LINE_CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|gs:\/\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i;

const ALLOWED_LANGUAGES: ReadonlySet<string> = new Set([
  'ar',
  'en',
  'bilingual',
  'other',
]);

const ALLOWED_DOCUMENT_TYPES: ReadonlySet<string> = new Set(
  Object.values(LibraryDocumentType)
);

const ALLOWED_CASE_STATUS_SET: ReadonlySet<string> = new Set([
  'IN_REVIEW',
  'NEEDS_INFORMATION',
  'METADATA_RECORDED',
  'NOT_SUITABLE',
]);

export interface CreateLibraryQuarantineCatalogDraftClassificationInput {
  readonly titleAr: string;
  readonly titleEn: string;
  readonly originalTitle?: string;
  readonly summaryAr: string;
  readonly summaryEn: string;
  readonly documentType: LibraryDocumentType;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly geographyAr: string;
  readonly geographyEn: string;
  readonly publicationDate: string;
  readonly language: 'ar' | 'en' | 'bilingual' | 'other';
  readonly topicsAr: readonly string[];
  readonly topicsEn: readonly string[];
  readonly environmentalDomains: readonly string[];
  readonly legalStatusDescriptionAr: string;
  readonly legalStatusDescriptionEn: string;
}

export interface SanitizedLibraryQuarantineCatalogHandoffDto {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly draftSourceRevision: number;
  readonly caseRevision: number;
  readonly caseUpdatedAt: string;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly createdAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SanitizedLibraryQuarantineCatalogDocumentVersionDto {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: string;
  readonly publishedDate: string;
  readonly changeDescriptionAr: string;
  readonly changeDescriptionEn: string;
}

export interface SanitizedLibraryQuarantineCatalogDocumentDto {
  readonly id: string;
  readonly titleAr: string;
  readonly titleEn: string;
  readonly originalTitle?: string;
  readonly documentType: LibraryDocumentType;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly geographyAr: string;
  readonly geographyEn: string;
  readonly publicationDate: string;
  readonly language: 'ar' | 'en' | 'bilingual' | 'other';
  readonly summaryAr: string;
  readonly summaryEn: string;
  readonly topicsAr: readonly string[];
  readonly topicsEn: readonly string[];
  readonly environmentalDomains: readonly string[];
  readonly rightsStatus: typeof LibraryRightsStatus.ReviewRequired;
  readonly workflowState: typeof WorkflowState.Draft;
  readonly legalStatusDescriptionAr: string;
  readonly legalStatusDescriptionEn: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly SanitizedLibraryQuarantineCatalogDocumentVersionDto[];
}

export interface GetLibraryQuarantineCatalogHandoffSuccessDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly receiptId: string;
  readonly documentId: string;
  readonly handoffExists: boolean;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto | null;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto | null;
  readonly caseStatus: LibraryQuarantineHumanReviewCaseStatus | null;
  readonly currentCaseRevision: number;
  readonly isEligibleForHandoff: boolean;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineCatalogHandoffHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineCatalogHandoffResponseDto =
  | GetLibraryQuarantineCatalogHandoffSuccessDto
  | GetLibraryQuarantineCatalogHandoffHoldDto;

export interface CreateLibraryQuarantineCatalogDraftSuccessDto {
  readonly ok: true;
  readonly status: 'HANDOFF_RECORDED';
  readonly disposition: 'CREATED' | 'IDEMPOTENT_EXISTING';
  readonly documentCreationOutcome: 'CREATED' | 'IDEMPOTENT_EXISTING';
  readonly documentCreated: boolean;
  readonly receiptId: string;
  readonly documentId: string;
  readonly caseRevision: number;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface CreateLibraryQuarantineCatalogDraftConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly documentCreationOutcome: 'NOT_CREATED';
  readonly documentCreated: false;
  readonly errorCode:
    | 'CASE_REVISION_CONFLICT'
    | 'HANDOFF_ALREADY_EXISTS_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentCaseRevision: number;
  readonly existingHandoff: SanitizedLibraryQuarantineCatalogHandoffDto | null;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface CreateLibraryQuarantineCatalogDraftHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly documentCreationOutcome: 'NOT_CREATED';
  readonly documentCreated: false;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface CreateLibraryQuarantineCatalogDraftUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly documentCreationOutcome: 'UNKNOWN';
  readonly documentCreated: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type CreateLibraryQuarantineCatalogDraftResponseDto =
  | CreateLibraryQuarantineCatalogDraftSuccessDto
  | CreateLibraryQuarantineCatalogDraftConflictDto
  | CreateLibraryQuarantineCatalogDraftHoldDto
  | CreateLibraryQuarantineCatalogDraftUnknownDto;

export interface GetQuarantineCatalogHandoffActionPayload {
  readonly action: 'getQuarantineCatalogHandoff';
  readonly receiptId: string;
}

export interface CreateQuarantineCatalogDraftActionPayload {
  readonly action: 'createQuarantineCatalogDraft';
  readonly receiptId: string;
  readonly expectedCaseRevision: number;
  readonly input: CreateLibraryQuarantineCatalogDraftClassificationInput;
}

export type CatalogHandoffCallableInvoker = (
  payload:
    | GetQuarantineCatalogHandoffActionPayload
    | CreateQuarantineCatalogDraftActionPayload
) => Promise<{ readonly data: unknown }>;

export const CATALOG_HANDOFF_CLIENT_SAFE_ERRORS = Object.freeze({
  BACKEND_UNAVAILABLE:
    'CATALOG_HANDOFF_BACKEND_UNAVAILABLE: Secure Library backend or authenticated admin session is unavailable.',
  FEATURE_NOT_RELEASED:
    'CATALOG_HANDOFF_NOT_RELEASED: Library quarantine catalog draft handoff is not enabled.',
  INVALID_RECEIPT_ID:
    'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hexadecimal string.',
  INVALID_EXPECTED_CASE_REVISION:
    'INVALID_EXPECTED_CASE_REVISION: expectedCaseRevision must be a positive safe integer (>= 1).',
  INVALID_CLASSIFICATION_INPUT:
    'INVALID_CLASSIFICATION_INPUT: Catalog draft classification fields failed validation.',
  HANDOFF_DTO_CONTRACT_INVALID:
    'CATALOG_HANDOFF_DTO_INVALID: Server response violated 16-field sanitized catalog handoff DTO contract.',
  DOCUMENT_DTO_CONTRACT_INVALID:
    'CATALOG_DOCUMENT_DTO_INVALID: Server response violated sanitized catalog draft document DTO contract.',
  GET_RESPONSE_CONTRACT_INVALID:
    'CATALOG_HANDOFF_GET_CONTRACT_INVALID: Server response violated getQuarantineCatalogHandoff contract.',
  GET_CALL_FAILED:
    'CATALOG_HANDOFF_GET_CALL_FAILED: Failed to load quarantine catalog handoff status from server.',
  CREATE_RESPONSE_CONTRACT_INVALID:
    'CATALOG_HANDOFF_CREATE_CONTRACT_INVALID: Server response violated createQuarantineCatalogDraft contract.',
  CREATE_CALL_FAILED:
    'CATALOG_HANDOFF_CREATE_CALL_FAILED: Failed to create quarantine catalog draft on server.',
});

const ALLOWED_CLASSIFICATION_INPUT_KEYS: ReadonlySet<string> = new Set([
  'titleAr',
  'titleEn',
  'originalTitle',
  'summaryAr',
  'summaryEn',
  'documentType',
  'organizationId',
  'sourceId',
  'geographyAr',
  'geographyEn',
  'publicationDate',
  'language',
  'topicsAr',
  'topicsEn',
  'environmentalDomains',
  'legalStatusDescriptionAr',
  'legalStatusDescriptionEn',
]);

const ALLOWED_SANITIZED_HANDOFF_DTO_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'documentId',
  'sourceRevision',
  'sourceUpdatedAt',
  'draftSourceRevision',
  'caseRevision',
  'caseUpdatedAt',
  'organizationId',
  'sourceId',
  'createdAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SANITIZED_DOC_VERSION_KEYS: ReadonlySet<string> = new Set([
  'id',
  'documentId',
  'versionNumber',
  'publishedDate',
  'changeDescriptionAr',
  'changeDescriptionEn',
]);

const ALLOWED_SANITIZED_DOC_KEYS_WITHOUT_ORIGINAL_TITLE: ReadonlySet<string> =
  new Set([
    'id',
    'titleAr',
    'titleEn',
    'documentType',
    'organizationId',
    'sourceId',
    'geographyAr',
    'geographyEn',
    'publicationDate',
    'language',
    'summaryAr',
    'summaryEn',
    'topicsAr',
    'topicsEn',
    'environmentalDomains',
    'rightsStatus',
    'workflowState',
    'legalStatusDescriptionAr',
    'legalStatusDescriptionEn',
    'createdAt',
    'updatedAt',
    'versions',
  ]);

const ALLOWED_SANITIZED_DOC_KEYS_WITH_ORIGINAL_TITLE: ReadonlySet<string> =
  new Set([
    ...ALLOWED_SANITIZED_DOC_KEYS_WITHOUT_ORIGINAL_TITLE,
    'originalTitle',
  ]);

const ALLOWED_GET_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'receiptId',
  'documentId',
  'handoffExists',
  'handoff',
  'catalogDocument',
  'caseStatus',
  'currentCaseRevision',
  'isEligibleForHandoff',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_GET_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_CREATE_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'disposition',
  'documentCreationOutcome',
  'documentCreated',
  'receiptId',
  'documentId',
  'caseRevision',
  'handoff',
  'catalogDocument',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_CREATE_CONFLICT_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'documentCreationOutcome',
  'documentCreated',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'currentCaseRevision',
  'existingHandoff',
  'catalogDocument',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_CREATE_HOLD_OR_UNKNOWN_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'documentCreationOutcome',
  'documentCreated',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const FORBIDDEN_PRIVATE_CATALOG_HANDOFF_KEYS: ReadonlySet<string> = new Set([
  'storagePath',
  'generation',
  'attestedGeneration',
  'attestedStoragePath',
  'attestation',
  'bucket',
  'targetBucketName',
  'signedUrl',
  'downloadUrl',
  'mediaLink',
  'downloadTokens',
  'referenceUrl',
  'rawBytes',
  'bytes',
  'sourceSha256',
  'createdBy',
  'updatedBy',
  'actorUid',
  'uploaderUid',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC_TIMESTAMP_REGEX.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function isValidCalendarDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DATE_REGEX.test(value)) {
    return false;
  }
  const parsedMs = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsedMs)) {
    return false;
  }
  return new Date(parsedMs).toISOString().slice(0, 10) === value;
}

export function deriveQuarantineCatalogDocumentId(receiptId: string): string {
  if (
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    throw new Error(CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }
  return `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`;
}

export function isQuarantineCatalogDocumentId(id: unknown): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  const trimmed = id.trim();
  return (
    QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(trimmed) ||
    trimmed.toLowerCase().startsWith(QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX)
  );
}

export function hasForbiddenPrivateLeakInCatalogHandoffPayload(
  value: unknown,
  depth = 0
): boolean {
  if (depth > 6 || value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return (
      lower.includes('library/quarantine/') ||
      lower.includes('library-quarantine/') ||
      lower.includes('promiseofplanet-bb325-library-quarantine') ||
      lower.includes('promiseofplanet-bb325.firebasestorage.app') ||
      lower.includes('gs://') ||
      lower.includes('https://storage.googleapis.com') ||
      lower.includes('firebasestorage.googleapis.com')
    );
  }
  if (Array.isArray(value)) {
    return value.some((entry) =>
      hasForbiddenPrivateLeakInCatalogHandoffPayload(entry, depth + 1)
    );
  }
  if (typeof value === 'object') {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return true;
    }
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (FORBIDDEN_PRIVATE_CATALOG_HANDOFF_KEYS.has(key)) {
        return true;
      }
      if (hasForbiddenPrivateLeakInCatalogHandoffPayload(nested, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function assertExactPlainObjectKeys(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  errorMessage: string
): Record<string, unknown> {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(errorMessage);
  }
  const keys = Object.keys(value);
  if (keys.length !== allowedKeys.size) {
    throw new Error(errorMessage);
  }
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new Error(errorMessage);
    }
  }
  return value;
}

function assertNonAssurancePostureFlags(
  record: Record<string, unknown>,
  errorMessage: string
): void {
  if (
    record.isSanitized !== false ||
    record.isVerifiedSafe !== false ||
    record.isRightsApproved !== false ||
    record.isPublished !== false ||
    record.isReadyForPeia !== false
  ) {
    throw new Error(errorMessage);
  }
}

/**
 * Checks whether ALL THREE UI release gates (`VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED`,
 * `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED`, and `VITE_LIBRARY_CATALOG_HANDOFF_ENABLED`)
 * are explicitly set to `'true'`. Defaults to `false`.
 */
export function isLibraryQuarantineCatalogHandoffEnabled(
  envOverride?: Readonly<Record<string, unknown>>
): boolean {
  if (!isLibraryQuarantineHumanReviewEnabled(envOverride)) {
    return false;
  }
  if (envOverride !== undefined) {
    if (!isPlainObject(envOverride)) {
      return false;
    }
    return envOverride[LIBRARY_CATALOG_HANDOFF_UI_ENV_VAR] === 'true';
  }
  const viteEnv = (
    import.meta as unknown as { readonly env?: Record<string, unknown> }
  )?.env;
  if (!viteEnv || typeof viteEnv !== 'object') {
    return false;
  }
  return viteEnv[LIBRARY_CATALOG_HANDOFF_UI_ENV_VAR] === 'true';
}

/**
 * Checks whether the current admin user is an active human Library administrator
 * who possesses BOTH `AdminPermission.Review` AND `AdminPermission.Create`.
 */
export function canCreateLibraryQuarantineCatalogDraft(
  user: AdminUser | null | undefined
): boolean {
  if (!user || user.isActive !== true) {
    return false;
  }
  if (user.role === AdminRole.AIAssistant) {
    return false;
  }
  const hasLibraryDomainAccess =
    hasDomainResponsibility(user.role, AdminDomain.Library) ||
    user.role === AdminRole.RightsReviewer;
  if (!hasLibraryDomainAccess) {
    return false;
  }

  const explicitPermissions = (
    user as { readonly permissions?: unknown }
  ).permissions;
  if (
    Array.isArray(explicitPermissions) &&
    (!explicitPermissions.includes(AdminPermission.Review) ||
      !explicitPermissions.includes(AdminPermission.Create))
  ) {
    return false;
  }

  return (
    AdminAccessService.hasPermission(user, AdminPermission.Review) &&
    AdminAccessService.hasPermission(user, AdminPermission.Create)
  );
}

/**
 * Checks whether a persisted human review case is eligible for catalog draft handoff
 * (`status === 'METADATA_RECORDED'`, non-empty `sourceEvidenceNotes`, and at least one title).
 */
export function isHumanReviewCaseEligibleForCatalogHandoff(
  reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null | undefined
): boolean {
  if (!reviewCase) {
    return false;
  }
  return (
    reviewCase.status === 'METADATA_RECORDED' &&
    typeof reviewCase.sourceEvidenceNotes === 'string' &&
    reviewCase.sourceEvidenceNotes.trim().length > 0 &&
    ((typeof reviewCase.titleAr === 'string' &&
      reviewCase.titleAr.trim().length > 0) ||
      (typeof reviewCase.titleEn === 'string' &&
        reviewCase.titleEn.trim().length > 0))
  );
}

export function isCatalogHandoffNotReleasedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const msg =
    typeof (err as { readonly message?: unknown }).message === 'string'
      ? (err as { readonly message: string }).message
      : '';
  return (
    msg.includes('CATALOG_HANDOFF_NOT_RELEASED') ||
    msg.includes('HUMAN_CASE_REVIEW_NOT_RELEASED') ||
    msg.includes('WORKBENCH_NOT_RELEASED')
  );
}

function validateAndNormalizeClientSingleLineField(
  raw: unknown,
  maxLength: number,
  required: boolean
): string {
  if (raw === undefined) {
    if (required) {
      throw new Error(
        CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
      );
    }
    return '';
  }
  if (
    typeof raw !== 'string' ||
    SINGLE_LINE_CONTROL_OR_BIDI_REGEX.test(raw) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(raw) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(raw)
  ) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }
  const trimmed = raw.trim();
  if ((required && trimmed.length === 0) || trimmed.length > maxLength) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }
  return trimmed;
}

function validateAndNormalizeClientMultiLineField(
  raw: unknown,
  maxLength: number,
  required: boolean
): string {
  if (raw === undefined) {
    if (required) {
      throw new Error(
        CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
      );
    }
    return '';
  }
  if (typeof raw !== 'string') {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }
  const normalized = raw.replace(/\r\n?/g, '\n');
  if (
    MULTI_LINE_CONTROL_OR_BIDI_REGEX.test(normalized) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(normalized) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(normalized)
  ) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }
  const trimmed = normalized.trim();
  if ((required && trimmed.length === 0) || trimmed.length > maxLength) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }
  return trimmed;
}

function validateAndNormalizeClientTagArray(
  rawArr: unknown,
  maxItems: number
): readonly string[] {
  if (
    !Array.isArray(rawArr) ||
    rawArr.length < 1 ||
    rawArr.length > maxItems
  ) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }
  const items: string[] = [];
  for (const entry of rawArr) {
    const cleaned = validateAndNormalizeClientSingleLineField(
      entry,
      CATALOG_HANDOFF_TAG_MAX_LENGTH,
      true
    );
    items.push(cleaned);
  }
  return Object.freeze(items);
}

export function validateClientCatalogDraftClassificationInput(
  rawInput: unknown
): CreateLibraryQuarantineCatalogDraftClassificationInput {
  if (
    !isPlainObject(rawInput) ||
    Object.getOwnPropertySymbols(rawInput).length > 0
  ) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }

  for (const key of Object.keys(rawInput)) {
    if (
      FORBIDDEN_PRIVATE_CATALOG_HANDOFF_KEYS.has(key) ||
      !ALLOWED_CLASSIFICATION_INPUT_KEYS.has(key)
    ) {
      throw new Error(
        CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
      );
    }
  }

  const titleAr = validateAndNormalizeClientSingleLineField(
    rawInput.titleAr,
    CATALOG_HANDOFF_TITLE_MAX_LENGTH,
    true
  );
  const titleEn = validateAndNormalizeClientSingleLineField(
    rawInput.titleEn,
    CATALOG_HANDOFF_TITLE_MAX_LENGTH,
    true
  );
  const originalTitleRaw = validateAndNormalizeClientSingleLineField(
    rawInput.originalTitle,
    CATALOG_HANDOFF_TITLE_MAX_LENGTH,
    false
  );
  const summaryAr = validateAndNormalizeClientMultiLineField(
    rawInput.summaryAr,
    CATALOG_HANDOFF_SUMMARY_MAX_LENGTH,
    true
  );
  const summaryEn = validateAndNormalizeClientMultiLineField(
    rawInput.summaryEn,
    CATALOG_HANDOFF_SUMMARY_MAX_LENGTH,
    true
  );

  if (
    typeof rawInput.documentType !== 'string' ||
    !ALLOWED_DOCUMENT_TYPES.has(rawInput.documentType)
  ) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }
  const documentType = rawInput.documentType as LibraryDocumentType;

  const organizationId = validateAndNormalizeClientSingleLineField(
    rawInput.organizationId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    true
  );
  const sourceId = validateAndNormalizeClientSingleLineField(
    rawInput.sourceId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    true
  );
  const geographyAr = validateAndNormalizeClientSingleLineField(
    rawInput.geographyAr,
    CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH,
    true
  );
  const geographyEn = validateAndNormalizeClientSingleLineField(
    rawInput.geographyEn,
    CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH,
    true
  );

  const publicationDate = validateAndNormalizeClientSingleLineField(
    rawInput.publicationDate,
    32,
    true
  );
  if (!isValidCalendarDateString(publicationDate)) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }

  if (
    typeof rawInput.language !== 'string' ||
    !ALLOWED_LANGUAGES.has(rawInput.language)
  ) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT
    );
  }
  const language = rawInput.language as 'ar' | 'en' | 'bilingual' | 'other';

  const topicsAr = validateAndNormalizeClientTagArray(
    rawInput.topicsAr,
    CATALOG_HANDOFF_MAX_TOPICS
  );
  const topicsEn = validateAndNormalizeClientTagArray(
    rawInput.topicsEn,
    CATALOG_HANDOFF_MAX_TOPICS
  );
  const environmentalDomains = validateAndNormalizeClientTagArray(
    rawInput.environmentalDomains,
    CATALOG_HANDOFF_MAX_DOMAINS
  );

  const legalStatusDescriptionAr = validateAndNormalizeClientMultiLineField(
    rawInput.legalStatusDescriptionAr,
    CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH,
    true
  );
  const legalStatusDescriptionEn = validateAndNormalizeClientMultiLineField(
    rawInput.legalStatusDescriptionEn,
    CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH,
    true
  );

  return Object.freeze({
    titleAr,
    titleEn,
    ...(originalTitleRaw.length > 0 ? { originalTitle: originalTitleRaw } : {}),
    summaryAr,
    summaryEn,
    documentType,
    organizationId,
    sourceId,
    geographyAr,
    geographyEn,
    publicationDate,
    language,
    topicsAr,
    topicsEn,
    environmentalDomains,
    legalStatusDescriptionAr,
    legalStatusDescriptionEn,
  });
}

export function buildGetQuarantineCatalogHandoffPayload(
  receiptId: unknown
): GetQuarantineCatalogHandoffActionPayload {
  if (
    typeof receiptId !== 'string' ||
    receiptId.trim() !== receiptId ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    throw new Error(CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }
  return Object.freeze({
    action: 'getQuarantineCatalogHandoff' as const,
    receiptId,
  });
}

export function buildCreateQuarantineCatalogDraftPayload(params: {
  readonly receiptId: unknown;
  readonly expectedCaseRevision: unknown;
  readonly input: unknown;
}): CreateQuarantineCatalogDraftActionPayload {
  if (
    typeof params.receiptId !== 'string' ||
    params.receiptId.trim() !== params.receiptId ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(params.receiptId)
  ) {
    throw new Error(CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }

  if (
    typeof params.expectedCaseRevision !== 'number' ||
    !Number.isSafeInteger(params.expectedCaseRevision) ||
    params.expectedCaseRevision < 1
  ) {
    throw new Error(
      CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_EXPECTED_CASE_REVISION
    );
  }

  const validatedInput = validateClientCatalogDraftClassificationInput(
    params.input
  );

  return Object.freeze({
    action: 'createQuarantineCatalogDraft' as const,
    receiptId: params.receiptId,
    expectedCaseRevision: params.expectedCaseRevision,
    input: validatedInput,
  });
}

export function validateSanitizedLibraryQuarantineCatalogHandoffDto(
  rawDto: unknown,
  expectedReceiptId?: string
): SanitizedLibraryQuarantineCatalogHandoffDto {
  const errMsg = CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.HANDOFF_DTO_CONTRACT_INVALID;
  const obj = assertExactPlainObjectKeys(
    rawDto,
    ALLOWED_SANITIZED_HANDOFF_DTO_KEYS,
    errMsg
  );

  if (hasForbiddenPrivateLeakInCatalogHandoffPayload(obj)) {
    throw new Error(errMsg);
  }

  assertNonAssurancePostureFlags(obj, errMsg);

  if (
    obj.schemaVersion !== LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION ||
    typeof obj.receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(obj.receiptId)
  ) {
    throw new Error(errMsg);
  }

  if (
    expectedReceiptId !== undefined &&
    obj.receiptId !== expectedReceiptId
  ) {
    throw new Error(errMsg);
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentId(obj.receiptId);
  if (
    typeof obj.documentId !== 'string' ||
    obj.documentId !== expectedDocumentId ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(obj.documentId)
  ) {
    throw new Error(errMsg);
  }

  if (
    typeof obj.sourceRevision !== 'number' ||
    !Number.isSafeInteger(obj.sourceRevision) ||
    obj.sourceRevision < 1 ||
    typeof obj.draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(obj.draftSourceRevision) ||
    obj.draftSourceRevision !== obj.sourceRevision ||
    typeof obj.caseRevision !== 'number' ||
    !Number.isSafeInteger(obj.caseRevision) ||
    obj.caseRevision < 1
  ) {
    throw new Error(errMsg);
  }

  if (
    !isValidIsoTimestamp(obj.sourceUpdatedAt) ||
    !isValidIsoTimestamp(obj.caseUpdatedAt) ||
    !isValidIsoTimestamp(obj.createdAt)
  ) {
    throw new Error(errMsg);
  }

  const organizationId = validateAndNormalizeClientSingleLineField(
    obj.organizationId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    true
  );
  const sourceId = validateAndNormalizeClientSingleLineField(
    obj.sourceId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    true
  );
  if (organizationId !== obj.organizationId || sourceId !== obj.sourceId) {
    throw new Error(errMsg);
  }

  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
    receiptId: obj.receiptId,
    documentId: obj.documentId,
    sourceRevision: obj.sourceRevision,
    sourceUpdatedAt: obj.sourceUpdatedAt,
    draftSourceRevision: obj.draftSourceRevision,
    caseRevision: obj.caseRevision,
    caseUpdatedAt: obj.caseUpdatedAt,
    organizationId,
    sourceId,
    createdAt: obj.createdAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

export function validateSanitizedLibraryQuarantineCatalogDocumentDto(
  rawDto: unknown,
  expectedDocumentId?: string
): SanitizedLibraryQuarantineCatalogDocumentDto {
  const errMsg = CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.DOCUMENT_DTO_CONTRACT_INVALID;
  if (!isPlainObject(rawDto) || Object.getOwnPropertySymbols(rawDto).length > 0) {
    throw new Error(errMsg);
  }

  if (hasForbiddenPrivateLeakInCatalogHandoffPayload(rawDto)) {
    throw new Error(errMsg);
  }

  const hasOriginalTitle = Object.prototype.hasOwnProperty.call(
    rawDto,
    'originalTitle'
  );
  const obj = assertExactPlainObjectKeys(
    rawDto,
    hasOriginalTitle
      ? ALLOWED_SANITIZED_DOC_KEYS_WITH_ORIGINAL_TITLE
      : ALLOWED_SANITIZED_DOC_KEYS_WITHOUT_ORIGINAL_TITLE,
    errMsg
  );

  if (
    typeof obj.id !== 'string' ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(obj.id)
  ) {
    throw new Error(errMsg);
  }

  if (expectedDocumentId !== undefined && obj.id !== expectedDocumentId) {
    throw new Error(errMsg);
  }

  if (
    obj.workflowState !== WorkflowState.Draft ||
    obj.rightsStatus !== LibraryRightsStatus.ReviewRequired
  ) {
    throw new Error(errMsg);
  }

  const validatedInput = validateClientCatalogDraftClassificationInput({
    titleAr: obj.titleAr,
    titleEn: obj.titleEn,
    ...(hasOriginalTitle ? { originalTitle: obj.originalTitle } : {}),
    summaryAr: obj.summaryAr,
    summaryEn: obj.summaryEn,
    documentType: obj.documentType,
    organizationId: obj.organizationId,
    sourceId: obj.sourceId,
    geographyAr: obj.geographyAr,
    geographyEn: obj.geographyEn,
    publicationDate: obj.publicationDate,
    language: obj.language,
    topicsAr: obj.topicsAr,
    topicsEn: obj.topicsEn,
    environmentalDomains: obj.environmentalDomains,
    legalStatusDescriptionAr: obj.legalStatusDescriptionAr,
    legalStatusDescriptionEn: obj.legalStatusDescriptionEn,
  });

  if (
    !isValidIsoTimestamp(obj.createdAt) ||
    !isValidIsoTimestamp(obj.updatedAt)
  ) {
    throw new Error(errMsg);
  }

  if (!Array.isArray(obj.versions) || obj.versions.length < 1) {
    throw new Error(errMsg);
  }

  const versions: SanitizedLibraryQuarantineCatalogDocumentVersionDto[] = [];
  for (const rawVer of obj.versions) {
    const verObj = assertExactPlainObjectKeys(
      rawVer,
      ALLOWED_SANITIZED_DOC_VERSION_KEYS,
      errMsg
    );
    if (
      typeof verObj.id !== 'string' ||
      verObj.id.trim().length === 0 ||
      typeof verObj.documentId !== 'string' ||
      verObj.documentId !== obj.id ||
      typeof verObj.versionNumber !== 'string' ||
      verObj.versionNumber.trim().length === 0 ||
      !isValidCalendarDateString(verObj.publishedDate) ||
      typeof verObj.changeDescriptionAr !== 'string' ||
      typeof verObj.changeDescriptionEn !== 'string'
    ) {
      throw new Error(errMsg);
    }
    versions.push(
      Object.freeze({
        id: verObj.id,
        documentId: verObj.documentId,
        versionNumber: verObj.versionNumber,
        publishedDate: verObj.publishedDate,
        changeDescriptionAr: verObj.changeDescriptionAr,
        changeDescriptionEn: verObj.changeDescriptionEn,
      })
    );
  }

  return Object.freeze({
    id: obj.id,
    titleAr: validatedInput.titleAr,
    titleEn: validatedInput.titleEn,
    ...(validatedInput.originalTitle !== undefined
      ? { originalTitle: validatedInput.originalTitle }
      : {}),
    documentType: validatedInput.documentType,
    organizationId: validatedInput.organizationId,
    sourceId: validatedInput.sourceId,
    geographyAr: validatedInput.geographyAr,
    geographyEn: validatedInput.geographyEn,
    publicationDate: validatedInput.publicationDate,
    language: validatedInput.language,
    summaryAr: validatedInput.summaryAr,
    summaryEn: validatedInput.summaryEn,
    topicsAr: validatedInput.topicsAr,
    topicsEn: validatedInput.topicsEn,
    environmentalDomains: validatedInput.environmentalDomains,
    rightsStatus: LibraryRightsStatus.ReviewRequired,
    workflowState: WorkflowState.Draft,
    legalStatusDescriptionAr: validatedInput.legalStatusDescriptionAr,
    legalStatusDescriptionEn: validatedInput.legalStatusDescriptionEn,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    versions: Object.freeze(versions),
  });
}

export function validateGetQuarantineCatalogHandoffResponse(
  rawResponse: unknown,
  expectedReceiptId?: string
): GetLibraryQuarantineCatalogHandoffResponseDto {
  const errMsg =
    CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID;
  if (
    !isPlainObject(rawResponse) ||
    Object.getOwnPropertySymbols(rawResponse).length > 0 ||
    hasForbiddenPrivateLeakInCatalogHandoffPayload(rawResponse)
  ) {
    throw new Error(errMsg);
  }

  assertNonAssurancePostureFlags(rawResponse, errMsg);

  if (rawResponse.ok === true) {
    const obj = assertExactPlainObjectKeys(
      rawResponse,
      ALLOWED_GET_SUCCESS_KEYS,
      errMsg
    );

    if (
      obj.status !== 'READY' ||
      typeof obj.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(obj.receiptId)
    ) {
      throw new Error(errMsg);
    }

    if (
      expectedReceiptId !== undefined &&
      obj.receiptId !== expectedReceiptId
    ) {
      throw new Error(errMsg);
    }

    const expectedDocumentId = deriveQuarantineCatalogDocumentId(obj.receiptId);
    if (
      typeof obj.documentId !== 'string' ||
      obj.documentId !== expectedDocumentId ||
      typeof obj.handoffExists !== 'boolean' ||
      typeof obj.isEligibleForHandoff !== 'boolean'
    ) {
      throw new Error(errMsg);
    }

    if (
      obj.caseStatus !== null &&
      (typeof obj.caseStatus !== 'string' ||
        !ALLOWED_CASE_STATUS_SET.has(obj.caseStatus))
    ) {
      throw new Error(errMsg);
    }

    if (
      typeof obj.currentCaseRevision !== 'number' ||
      !Number.isSafeInteger(obj.currentCaseRevision) ||
      obj.currentCaseRevision < 0
    ) {
      throw new Error(errMsg);
    }

    let handoff: SanitizedLibraryQuarantineCatalogHandoffDto | null = null;
    let catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto | null =
      null;

    if (obj.handoffExists) {
      if (obj.handoff === null || obj.catalogDocument === null) {
        throw new Error(errMsg);
      }
      handoff = validateSanitizedLibraryQuarantineCatalogHandoffDto(
        obj.handoff,
        obj.receiptId
      );
      catalogDocument = validateSanitizedLibraryQuarantineCatalogDocumentDto(
        obj.catalogDocument,
        expectedDocumentId
      );
    } else {
      if (obj.handoff !== null || obj.catalogDocument !== null) {
        throw new Error(errMsg);
      }
    }

    return Object.freeze({
      ok: true as const,
      status: 'READY' as const,
      receiptId: obj.receiptId,
      documentId: expectedDocumentId,
      handoffExists: obj.handoffExists,
      handoff,
      catalogDocument,
      caseStatus: (obj.caseStatus ??
        null) as LibraryQuarantineHumanReviewCaseStatus | null,
      currentCaseRevision: obj.currentCaseRevision,
      isEligibleForHandoff: obj.isEligibleForHandoff,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (rawResponse.ok === false) {
    const obj = assertExactPlainObjectKeys(
      rawResponse,
      ALLOWED_GET_HOLD_KEYS,
      errMsg
    );

    if (
      obj.status !== 'HOLD' ||
      typeof obj.errorCode !== 'string' ||
      obj.errorCode.trim().length === 0 ||
      typeof obj.errorMessage !== 'string' ||
      obj.errorMessage.trim().length === 0
    ) {
      throw new Error(errMsg);
    }

    if (
      obj.receiptId !== null &&
      (typeof obj.receiptId !== 'string' ||
        !QUARANTINE_RECEIPT_ID_REGEX.test(obj.receiptId))
    ) {
      throw new Error(errMsg);
    }

    if (
      expectedReceiptId !== undefined &&
      obj.receiptId !== null &&
      obj.receiptId !== expectedReceiptId
    ) {
      throw new Error(errMsg);
    }

    if (
      obj.documentId !== null &&
      (typeof obj.documentId !== 'string' ||
        !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(obj.documentId))
    ) {
      throw new Error(errMsg);
    }

    return Object.freeze({
      ok: false as const,
      status: 'HOLD' as const,
      errorCode: obj.errorCode,
      errorMessage: obj.errorMessage,
      receiptId: obj.receiptId as string | null,
      documentId: obj.documentId as string | null,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  throw new Error(errMsg);
}

export function validateCreateQuarantineCatalogDraftResponse(
  rawResponse: unknown,
  expectedReceiptId?: string
): CreateLibraryQuarantineCatalogDraftResponseDto {
  const errMsg =
    CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.CREATE_RESPONSE_CONTRACT_INVALID;
  if (
    !isPlainObject(rawResponse) ||
    Object.getOwnPropertySymbols(rawResponse).length > 0 ||
    hasForbiddenPrivateLeakInCatalogHandoffPayload(rawResponse)
  ) {
    throw new Error(errMsg);
  }

  assertNonAssurancePostureFlags(rawResponse, errMsg);

  if (rawResponse.ok === true) {
    const obj = assertExactPlainObjectKeys(
      rawResponse,
      ALLOWED_CREATE_SUCCESS_KEYS,
      errMsg
    );

    if (
      obj.status !== 'HANDOFF_RECORDED' ||
      (obj.disposition !== 'CREATED' &&
        obj.disposition !== 'IDEMPOTENT_EXISTING') ||
      obj.documentCreationOutcome !== obj.disposition ||
      typeof obj.documentCreated !== 'boolean' ||
      (obj.disposition === 'CREATED' && obj.documentCreated !== true) ||
      (obj.disposition === 'IDEMPOTENT_EXISTING' &&
        obj.documentCreated !== false) ||
      typeof obj.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(obj.receiptId)
    ) {
      throw new Error(errMsg);
    }

    if (
      expectedReceiptId !== undefined &&
      obj.receiptId !== expectedReceiptId
    ) {
      throw new Error(errMsg);
    }

    const expectedDocumentId = deriveQuarantineCatalogDocumentId(obj.receiptId);
    if (
      typeof obj.documentId !== 'string' ||
      obj.documentId !== expectedDocumentId ||
      typeof obj.caseRevision !== 'number' ||
      !Number.isSafeInteger(obj.caseRevision) ||
      obj.caseRevision < 1
    ) {
      throw new Error(errMsg);
    }

    const handoff = validateSanitizedLibraryQuarantineCatalogHandoffDto(
      obj.handoff,
      obj.receiptId
    );
    const catalogDocument = validateSanitizedLibraryQuarantineCatalogDocumentDto(
      obj.catalogDocument,
      expectedDocumentId
    );

    return Object.freeze({
      ok: true as const,
      status: 'HANDOFF_RECORDED' as const,
      disposition: obj.disposition,
      documentCreationOutcome: obj.disposition,
      documentCreated: obj.documentCreated,
      receiptId: obj.receiptId,
      documentId: expectedDocumentId,
      caseRevision: obj.caseRevision,
      handoff,
      catalogDocument,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (rawResponse.ok === false) {
    if (rawResponse.status === 'CONFLICT') {
      const obj = assertExactPlainObjectKeys(
        rawResponse,
        ALLOWED_CREATE_CONFLICT_KEYS,
        errMsg
      );

      if (
        obj.documentCreationOutcome !== 'NOT_CREATED' ||
        obj.documentCreated !== false ||
        (obj.errorCode !== 'CASE_REVISION_CONFLICT' &&
          obj.errorCode !== 'HANDOFF_ALREADY_EXISTS_CONFLICT') ||
        typeof obj.errorMessage !== 'string' ||
        obj.errorMessage.trim().length === 0 ||
        typeof obj.receiptId !== 'string' ||
        !QUARANTINE_RECEIPT_ID_REGEX.test(obj.receiptId)
      ) {
        throw new Error(errMsg);
      }

      if (
        expectedReceiptId !== undefined &&
        obj.receiptId !== expectedReceiptId
      ) {
        throw new Error(errMsg);
      }

      const expectedDocumentId = deriveQuarantineCatalogDocumentId(
        obj.receiptId
      );
      if (
        typeof obj.documentId !== 'string' ||
        obj.documentId !== expectedDocumentId ||
        typeof obj.currentCaseRevision !== 'number' ||
        !Number.isSafeInteger(obj.currentCaseRevision) ||
        obj.currentCaseRevision < 1
      ) {
        throw new Error(errMsg);
      }

      const existingHandoff =
        obj.existingHandoff !== null
          ? validateSanitizedLibraryQuarantineCatalogHandoffDto(
              obj.existingHandoff,
              obj.receiptId
            )
          : null;

      const catalogDocument =
        obj.catalogDocument !== null
          ? validateSanitizedLibraryQuarantineCatalogDocumentDto(
              obj.catalogDocument,
              expectedDocumentId
            )
          : null;

      return Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        documentCreationOutcome: 'NOT_CREATED' as const,
        documentCreated: false as const,
        errorCode: obj.errorCode,
        errorMessage: obj.errorMessage,
        receiptId: obj.receiptId,
        documentId: expectedDocumentId,
        currentCaseRevision: obj.currentCaseRevision,
        existingHandoff,
        catalogDocument,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (rawResponse.status === 'HOLD') {
      const obj = assertExactPlainObjectKeys(
        rawResponse,
        ALLOWED_CREATE_HOLD_OR_UNKNOWN_KEYS,
        errMsg
      );

      if (
        obj.documentCreationOutcome !== 'NOT_CREATED' ||
        obj.documentCreated !== false ||
        typeof obj.errorCode !== 'string' ||
        obj.errorCode.trim().length === 0 ||
        typeof obj.errorMessage !== 'string' ||
        obj.errorMessage.trim().length === 0
      ) {
        throw new Error(errMsg);
      }

      if (
        obj.receiptId !== null &&
        (typeof obj.receiptId !== 'string' ||
          !QUARANTINE_RECEIPT_ID_REGEX.test(obj.receiptId))
      ) {
        throw new Error(errMsg);
      }

      if (
        expectedReceiptId !== undefined &&
        obj.receiptId !== null &&
        obj.receiptId !== expectedReceiptId
      ) {
        throw new Error(errMsg);
      }

      if (
        obj.documentId !== null &&
        (typeof obj.documentId !== 'string' ||
          !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(obj.documentId))
      ) {
        throw new Error(errMsg);
      }

      return Object.freeze({
        ok: false as const,
        status: 'HOLD' as const,
        documentCreationOutcome: 'NOT_CREATED' as const,
        documentCreated: false as const,
        errorCode: obj.errorCode,
        errorMessage: obj.errorMessage,
        receiptId: obj.receiptId as string | null,
        documentId: obj.documentId as string | null,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (rawResponse.status === 'UNKNOWN') {
      const obj = assertExactPlainObjectKeys(
        rawResponse,
        ALLOWED_CREATE_HOLD_OR_UNKNOWN_KEYS,
        errMsg
      );

      if (
        obj.documentCreationOutcome !== 'UNKNOWN' ||
        obj.documentCreated !== null ||
        obj.errorCode !== 'TRANSACTION_COMMIT_UNCERTAIN' ||
        typeof obj.errorMessage !== 'string' ||
        obj.errorMessage.trim().length === 0 ||
        typeof obj.receiptId !== 'string' ||
        !QUARANTINE_RECEIPT_ID_REGEX.test(obj.receiptId)
      ) {
        throw new Error(errMsg);
      }

      if (
        expectedReceiptId !== undefined &&
        obj.receiptId !== expectedReceiptId
      ) {
        throw new Error(errMsg);
      }

      const expectedDocumentId = deriveQuarantineCatalogDocumentId(
        obj.receiptId
      );
      if (
        typeof obj.documentId !== 'string' ||
        obj.documentId !== expectedDocumentId
      ) {
        throw new Error(errMsg);
      }

      return Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        documentCreationOutcome: 'UNKNOWN' as const,
        documentCreated: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage: obj.errorMessage,
        receiptId: obj.receiptId,
        documentId: expectedDocumentId,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }
  }

  throw new Error(errMsg);
}

function defaultManageLibraryDocumentsInvoker(
  payload:
    | GetQuarantineCatalogHandoffActionPayload
    | CreateQuarantineCatalogDraftActionPayload
): Promise<{ readonly data: unknown }> {
  if (!isFirebaseConfigured || !app || !auth?.currentUser) {
    throw new Error(CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE);
  }
  const functions = getFunctions(app);
  const fn = httpsCallable(functions, 'manageLibraryDocuments');
  return fn(payload) as Promise<{ readonly data: unknown }>;
}

export const LibraryQuarantineCatalogHandoffClient = {
  async getQuarantineCatalogHandoff(
    receiptId: string,
    invoker: CatalogHandoffCallableInvoker = defaultManageLibraryDocumentsInvoker
  ): Promise<GetLibraryQuarantineCatalogHandoffResponseDto> {
    const payload = buildGetQuarantineCatalogHandoffPayload(receiptId);

    let rawResult: { readonly data: unknown };
    try {
      rawResult = await invoker(payload);
    } catch (err: unknown) {
      if (isCatalogHandoffNotReleasedError(err)) {
        throw new Error(
          CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED
        );
      }
      if (
        err instanceof Error &&
        err.message === CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE
      ) {
        throw err;
      }
      throw new Error(CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.GET_CALL_FAILED);
    }

    if (!rawResult || typeof rawResult !== 'object') {
      throw new Error(
        CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
      );
    }

    return validateGetQuarantineCatalogHandoffResponse(
      rawResult.data,
      payload.receiptId
    );
  },

  async createQuarantineCatalogDraft(
    params: {
      readonly receiptId: string;
      readonly expectedCaseRevision: number;
      readonly input: CreateLibraryQuarantineCatalogDraftClassificationInput;
    },
    invoker: CatalogHandoffCallableInvoker = defaultManageLibraryDocumentsInvoker
  ): Promise<CreateLibraryQuarantineCatalogDraftResponseDto> {
    const payload = buildCreateQuarantineCatalogDraftPayload(params);

    let rawResult: { readonly data: unknown };
    try {
      rawResult = await invoker(payload);
    } catch (err: unknown) {
      if (isCatalogHandoffNotReleasedError(err)) {
        throw new Error(
          CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED
        );
      }
      if (
        err instanceof Error &&
        err.message === CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE
      ) {
        throw err;
      }
      throw new Error(CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.CREATE_CALL_FAILED);
    }

    if (!rawResult || typeof rawResult !== 'object') {
      throw new Error(
        CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.CREATE_RESPONSE_CONTRACT_INVALID
      );
    }

    return validateCreateQuarantineCatalogDraftResponse(
      rawResult.data,
      payload.receiptId
    );
  },
};
