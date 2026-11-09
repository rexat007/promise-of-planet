import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import type { AdminUser } from '../types/admin';
import {
  validateSanitizedLibraryQuarantineReceiptListItem,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryAdminClient';
import {
  canPrepareLibraryQuarantineReviewDraft,
  isLibraryQuarantineReviewWorkbenchEnabled,
  type LibraryQuarantineReviewWorkbenchDisplayStatus,
} from './libraryQuarantineReviewWorkbenchClient';

/**
 * LIB-FILE-HUMAN-CASEWORK-01 — Browser-Safe Typed Client for Human Review Casework
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Calls ONLY the existing `manageLibraryDocuments` Firebase callable with exact
 *   minimal payloads (`{ action: 'getQuarantineHumanReviewCase', receiptId }` and
 *   `{ action: 'saveQuarantineHumanReviewCase', receiptId, expectedRevision, input }`).
 * - Never accesses Firestore or Google Cloud Storage directly from the browser.
 * - Requires BOTH `VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED === 'true'` and
 *   `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED === 'true'` (default disabled).
 * - Strictly validates the 17-field `SanitizedLibraryQuarantineHumanReviewCaseDto`
 *   and all server responses (`READY | SAVED | CONFLICT | HOLD | UNKNOWN`),
 *   rejecting extra keys, symbol properties, HTML tags, private storage paths,
 *   `sourceSha256`, `createdBy`, `updatedBy`, `storagePath`, `generation`,
 *   signed URLs, or escalated security posture flags.
 * - Never auto-retries on `UNKNOWN` (`caseSaved: null`).
 */

export const LIBRARY_HUMAN_CASE_REVIEW_UI_ENV_VAR =
  'VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED' as const;

export const LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_STATUSES = Object.freeze([
  'IN_REVIEW',
  'NEEDS_INFORMATION',
  'METADATA_RECORDED',
  'NOT_SUITABLE',
] as const);

export type LibraryQuarantineHumanReviewCaseStatus =
  (typeof LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_STATUSES)[number];

const ALLOWED_CASE_STATUS_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_STATUSES
);

export const HUMAN_REVIEW_TITLE_MAX_LENGTH = 300 as const;
export const HUMAN_REVIEW_ORGANIZATION_MAX_LENGTH = 240 as const;
export const HUMAN_REVIEW_NOTES_MAX_LENGTH = 2000 as const;

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;

const ISO_UTC_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const SINGLE_LINE_CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const MULTI_LINE_CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|gs:\/\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i;

export interface LibraryQuarantineHumanReviewEditorialFields {
  readonly status: LibraryQuarantineHumanReviewCaseStatus;
  readonly titleAr: string;
  readonly titleEn: string;
  readonly issuingOrganization: string;
  readonly summaryAr: string;
  readonly summaryEn: string;
  readonly sourceEvidenceNotes: string;
  readonly rightsEvidenceNotes: string;
  readonly editorialNotes: string;
}

export interface SanitizedLibraryQuarantineHumanReviewCaseDto
  extends LibraryQuarantineHumanReviewEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly draftSourceRevision: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveLibraryQuarantineHumanReviewCaseEditorialInput {
  readonly status: LibraryQuarantineHumanReviewCaseStatus;
  readonly titleAr?: string;
  readonly titleEn?: string;
  readonly issuingOrganization?: string;
  readonly summaryAr?: string;
  readonly summaryEn?: string;
  readonly sourceEvidenceNotes?: string;
  readonly rightsEvidenceNotes?: string;
  readonly editorialNotes?: string;
}

export interface GetLibraryQuarantineHumanReviewCaseSuccessDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly draftStatus: 'PENDING_HUMAN_REVIEW';
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly currentRevision: number;
  readonly reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineHumanReviewCaseHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineHumanReviewCaseResponseDto =
  | GetLibraryQuarantineHumanReviewCaseSuccessDto
  | GetLibraryQuarantineHumanReviewCaseHoldDto;

export interface SaveLibraryQuarantineHumanReviewCaseSavedDto {
  readonly ok: true;
  readonly status: 'SAVED';
  readonly caseSaveOutcome: 'CREATED' | 'UPDATED';
  readonly caseSaved: true;
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly currentRevision: number;
  readonly reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineHumanReviewCaseConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly errorCode: 'CASE_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly currentRevision: number;
  readonly currentCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineHumanReviewCaseHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineHumanReviewCaseUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly caseSaveOutcome: 'UNKNOWN';
  readonly caseSaved: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type SaveLibraryQuarantineHumanReviewCaseResponseDto =
  | SaveLibraryQuarantineHumanReviewCaseSavedDto
  | SaveLibraryQuarantineHumanReviewCaseConflictDto
  | SaveLibraryQuarantineHumanReviewCaseHoldDto
  | SaveLibraryQuarantineHumanReviewCaseUnknownDto;

export interface GetQuarantineHumanReviewCaseActionPayload {
  readonly action: 'getQuarantineHumanReviewCase';
  readonly receiptId: string;
}

export interface SaveQuarantineHumanReviewCaseActionPayload {
  readonly action: 'saveQuarantineHumanReviewCase';
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly input: LibraryQuarantineHumanReviewEditorialFields;
}

export type HumanReviewCallableInvoker = (
  payload:
    | GetQuarantineHumanReviewCaseActionPayload
    | SaveQuarantineHumanReviewCaseActionPayload
) => Promise<{ readonly data: unknown }>;

export const HUMAN_REVIEW_CLIENT_SAFE_ERRORS = Object.freeze({
  BACKEND_UNAVAILABLE:
    'HUMAN_REVIEW_BACKEND_UNAVAILABLE: Secure Library backend or authenticated admin session is unavailable.',
  FEATURE_NOT_RELEASED:
    'HUMAN_CASE_REVIEW_NOT_RELEASED: Library quarantine human case review is not enabled.',
  INVALID_RECEIPT_ID:
    'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hexadecimal string.',
  INVALID_EXPECTED_REVISION:
    'INVALID_EXPECTED_REVISION: expectedRevision must be a non-negative safe integer.',
  INVALID_EDITORIAL_INPUT:
    'INVALID_EDITORIAL_INPUT: Human review editorial fields failed validation.',
  METADATA_RECORDED_REQUIREMENTS_NOT_MET:
    'METADATA_RECORDED_REQUIREMENTS_NOT_MET: METADATA_RECORDED requires at least one title and non-empty source evidence notes.',
  JUSTIFICATION_NOTES_REQUIRED:
    'JUSTIFICATION_NOTES_REQUIRED: NEEDS_INFORMATION and NOT_SUITABLE require non-empty reviewer justification notes.',
  EMPTY_REVIEW_CASE_NOT_ALLOWED:
    'EMPTY_REVIEW_CASE_NOT_ALLOWED: At least one descriptive field or reviewer note is required.',
  CASE_DTO_CONTRACT_INVALID:
    'HUMAN_REVIEW_CASE_DTO_INVALID: Server response violated 17-field sanitized human review case DTO contract.',
  GET_RESPONSE_CONTRACT_INVALID:
    'HUMAN_REVIEW_GET_CONTRACT_INVALID: Server response violated getQuarantineHumanReviewCase contract.',
  GET_CALL_FAILED:
    'HUMAN_REVIEW_GET_CALL_FAILED: Failed to load quarantine human review case from server.',
  SAVE_RESPONSE_CONTRACT_INVALID:
    'HUMAN_REVIEW_SAVE_CONTRACT_INVALID: Server response violated saveQuarantineHumanReviewCase contract.',
  SAVE_CALL_FAILED:
    'HUMAN_REVIEW_SAVE_CALL_FAILED: Failed to save quarantine human review case on server.',
});

const ALLOWED_EDITORIAL_INPUT_KEYS: ReadonlySet<string> = new Set([
  'status',
  'titleAr',
  'titleEn',
  'issuingOrganization',
  'summaryAr',
  'summaryEn',
  'sourceEvidenceNotes',
  'rightsEvidenceNotes',
  'editorialNotes',
]);

const ALLOWED_SANITIZED_CASE_DTO_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'sourceRevision',
  'sourceUpdatedAt',
  'draftSourceRevision',
  'revision',
  'status',
  'titleAr',
  'titleEn',
  'issuingOrganization',
  'summaryAr',
  'summaryEn',
  'sourceEvidenceNotes',
  'rightsEvidenceNotes',
  'editorialNotes',
  'createdAt',
  'updatedAt',
]);

const ALLOWED_GET_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'receiptId',
  'sourceRevision',
  'draftStatus',
  'adminReceipt',
  'currentRevision',
  'reviewCase',
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
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_SAVED_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'caseSaveOutcome',
  'caseSaved',
  'receiptId',
  'sourceRevision',
  'currentRevision',
  'reviewCase',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_CONFLICT_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'caseSaveOutcome',
  'caseSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'currentRevision',
  'currentCase',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_HOLD_OR_UNKNOWN_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'caseSaveOutcome',
  'caseSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const FORBIDDEN_PRIVATE_HUMAN_REVIEW_KEYS: ReadonlySet<string> = new Set([
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
  'rawBytes',
  'bytes',
  'sourceSha256',
  'createdBy',
  'updatedBy',
  'actorUid',
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

export function hasForbiddenPrivateLeakInHumanReviewPayload(
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
      hasForbiddenPrivateLeakInHumanReviewPayload(entry, depth + 1)
    );
  }
  if (typeof value === 'object') {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return true;
    }
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (FORBIDDEN_PRIVATE_HUMAN_REVIEW_KEYS.has(key)) {
        return true;
      }
      if (hasForbiddenPrivateLeakInHumanReviewPayload(nested, depth + 1)) {
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

/**
 * Checks whether BOTH `VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED === 'true'` and
 * `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED === 'true'` are active.
 * Defaults to `false` when either flag is unset or not `'true'`.
 */
export function isLibraryQuarantineHumanReviewEnabled(
  envOverride?: Readonly<Record<string, unknown>>
): boolean {
  if (!isLibraryQuarantineReviewWorkbenchEnabled(envOverride)) {
    return false;
  }
  if (envOverride !== undefined) {
    if (!isPlainObject(envOverride)) {
      return false;
    }
    return envOverride[LIBRARY_HUMAN_CASE_REVIEW_UI_ENV_VAR] === 'true';
  }
  const viteEnv = (
    import.meta as unknown as { readonly env?: Record<string, unknown> }
  )?.env;
  if (!viteEnv || typeof viteEnv !== 'object') {
    return false;
  }
  return viteEnv[LIBRARY_HUMAN_CASE_REVIEW_UI_ENV_VAR] === 'true';
}

/**
 * Checks whether the current admin user is an active human Library reviewer
 * with `AdminPermission.Review`.
 */
export function canOpenLibraryQuarantineHumanReviewCase(
  user: AdminUser | null | undefined
): boolean {
  return canPrepareLibraryQuarantineReviewDraft(user);
}

/**
 * Checks whether a workbench row is eligible for opening the human review case
 * modal (`Quarantined` receipt state AND `PENDING_HUMAN_REVIEW` draft status).
 */
export function isQuarantineWorkbenchItemEligibleForHumanReviewCase(
  item:
    | {
        readonly adminReceipt: Pick<
          SanitizedLibraryQuarantineAdminReceiptDto,
          'state'
        >;
        readonly draftStatus: LibraryQuarantineReviewWorkbenchDisplayStatus;
      }
    | null
    | undefined
): boolean {
  if (!item || !item.adminReceipt) {
    return false;
  }
  return (
    item.adminReceipt.state === 'Quarantined' &&
    item.draftStatus === 'PENDING_HUMAN_REVIEW'
  );
}

export function isHumanCaseReviewNotReleasedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const msg =
    typeof (err as { readonly message?: unknown }).message === 'string'
      ? (err as { readonly message: string }).message
      : '';
  return (
    msg.includes('HUMAN_CASE_REVIEW_NOT_RELEASED') ||
    msg.includes('WORKBENCH_NOT_RELEASED')
  );
}

function validateAndNormalizeClientSingleLineField(
  raw: unknown,
  maxLength: number
): string {
  if (raw === undefined) {
    return '';
  }
  if (
    typeof raw !== 'string' ||
    SINGLE_LINE_CONTROL_OR_BIDI_REGEX.test(raw) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(raw) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(raw)
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
  }
  const trimmed = raw.trim();
  if (trimmed.length > maxLength) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
  }
  return trimmed;
}

function validateAndNormalizeClientMultiLineField(
  raw: unknown,
  maxLength: number
): string {
  if (raw === undefined) {
    return '';
  }
  if (typeof raw !== 'string') {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
  }
  const normalized = raw.replace(/\r\n?/g, '\n');
  if (
    MULTI_LINE_CONTROL_OR_BIDI_REGEX.test(normalized) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(normalized) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(normalized)
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
  }
  const trimmed = normalized.trim();
  if (trimmed.length > maxLength) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
  }
  return trimmed;
}

export function validateClientHumanReviewEditorialInput(
  rawInput: unknown
): LibraryQuarantineHumanReviewEditorialFields {
  if (
    !isPlainObject(rawInput) ||
    Object.getOwnPropertySymbols(rawInput).length > 0
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
  }

  for (const key of Object.keys(rawInput)) {
    if (
      FORBIDDEN_PRIVATE_HUMAN_REVIEW_KEYS.has(key) ||
      !ALLOWED_EDITORIAL_INPUT_KEYS.has(key)
    ) {
      throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
    }
  }

  if (
    typeof rawInput.status !== 'string' ||
    !ALLOWED_CASE_STATUS_SET.has(rawInput.status)
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
  }

  const status = rawInput.status as LibraryQuarantineHumanReviewCaseStatus;
  const titleAr = validateAndNormalizeClientSingleLineField(
    rawInput.titleAr,
    HUMAN_REVIEW_TITLE_MAX_LENGTH
  );
  const titleEn = validateAndNormalizeClientSingleLineField(
    rawInput.titleEn,
    HUMAN_REVIEW_TITLE_MAX_LENGTH
  );
  const issuingOrganization = validateAndNormalizeClientSingleLineField(
    rawInput.issuingOrganization,
    HUMAN_REVIEW_ORGANIZATION_MAX_LENGTH
  );
  const summaryAr = validateAndNormalizeClientMultiLineField(
    rawInput.summaryAr,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  const summaryEn = validateAndNormalizeClientMultiLineField(
    rawInput.summaryEn,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  const sourceEvidenceNotes = validateAndNormalizeClientMultiLineField(
    rawInput.sourceEvidenceNotes,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  const rightsEvidenceNotes = validateAndNormalizeClientMultiLineField(
    rawInput.rightsEvidenceNotes,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  const editorialNotes = validateAndNormalizeClientMultiLineField(
    rawInput.editorialNotes,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );

  if (status === 'METADATA_RECORDED') {
    const hasTitle = titleAr.length > 0 || titleEn.length > 0;
    if (!hasTitle || sourceEvidenceNotes.length === 0) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.METADATA_RECORDED_REQUIREMENTS_NOT_MET
      );
    }
  }

  if (status === 'NEEDS_INFORMATION' || status === 'NOT_SUITABLE') {
    if (editorialNotes.length === 0) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.JUSTIFICATION_NOTES_REQUIRED
      );
    }
  }

  const hasAnyContent =
    titleAr.length > 0 ||
    titleEn.length > 0 ||
    issuingOrganization.length > 0 ||
    summaryAr.length > 0 ||
    summaryEn.length > 0 ||
    sourceEvidenceNotes.length > 0 ||
    rightsEvidenceNotes.length > 0 ||
    editorialNotes.length > 0;

  if (!hasAnyContent) {
    throw new Error(
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.EMPTY_REVIEW_CASE_NOT_ALLOWED
    );
  }

  return Object.freeze({
    status,
    titleAr,
    titleEn,
    issuingOrganization,
    summaryAr,
    summaryEn,
    sourceEvidenceNotes,
    rightsEvidenceNotes,
    editorialNotes,
  });
}

export function buildGetQuarantineHumanReviewCasePayload(
  receiptId: unknown
): GetQuarantineHumanReviewCaseActionPayload {
  if (
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }
  return Object.freeze({
    action: 'getQuarantineHumanReviewCase' as const,
    receiptId,
  });
}

export function buildSaveQuarantineHumanReviewCasePayload(params: {
  readonly receiptId: unknown;
  readonly expectedRevision: unknown;
  readonly input: unknown;
}): SaveQuarantineHumanReviewCaseActionPayload {
  if (!isPlainObject(params)) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT);
  }
  const { receiptId, expectedRevision, input } = params;
  if (
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EXPECTED_REVISION);
  }

  const validatedInput = validateClientHumanReviewEditorialInput(input);
  return Object.freeze({
    action: 'saveQuarantineHumanReviewCase' as const,
    receiptId,
    expectedRevision,
    input: validatedInput,
  });
}

/**
 * Validates the exact 17-field `SanitizedLibraryQuarantineHumanReviewCaseDto`.
 */
export function validateSanitizedLibraryQuarantineHumanReviewCaseDto(
  candidate: unknown,
  expectedReceiptId?: string
): SanitizedLibraryQuarantineHumanReviewCaseDto {
  if (hasForbiddenPrivateLeakInHumanReviewPayload(candidate)) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID);
  }

  const obj = assertExactPlainObjectKeys(
    candidate,
    ALLOWED_SANITIZED_CASE_DTO_KEYS,
    HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID
  );

  const {
    schemaVersion,
    receiptId,
    sourceRevision,
    sourceUpdatedAt,
    draftSourceRevision,
    revision,
    status,
    titleAr,
    titleEn,
    issuingOrganization,
    summaryAr,
    summaryEn,
    sourceEvidenceNotes,
    rightsEvidenceNotes,
    editorialNotes,
    createdAt,
    updatedAt,
  } = obj;

  if (
    schemaVersion !== LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION ||
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId) ||
    (expectedReceiptId !== undefined && receiptId !== expectedReceiptId) ||
    typeof sourceRevision !== 'number' ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1 ||
    !isValidIsoTimestamp(sourceUpdatedAt) ||
    typeof draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(draftSourceRevision) ||
    draftSourceRevision !== sourceRevision ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !isValidIsoTimestamp(createdAt) ||
    !isValidIsoTimestamp(updatedAt) ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    Date.parse(createdAt) < Date.parse(sourceUpdatedAt)
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID);
  }

  let validatedEditorial: LibraryQuarantineHumanReviewEditorialFields;
  try {
    validatedEditorial = validateClientHumanReviewEditorialInput({
      status,
      titleAr,
      titleEn,
      issuingOrganization,
      summaryAr,
      summaryEn,
      sourceEvidenceNotes,
      rightsEvidenceNotes,
      editorialNotes,
    });
  } catch {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID);
  }

  if (
    validatedEditorial.titleAr !== titleAr ||
    validatedEditorial.titleEn !== titleEn ||
    validatedEditorial.issuingOrganization !== issuingOrganization ||
    validatedEditorial.summaryAr !== summaryAr ||
    validatedEditorial.summaryEn !== summaryEn ||
    validatedEditorial.sourceEvidenceNotes !== sourceEvidenceNotes ||
    validatedEditorial.rightsEvidenceNotes !== rightsEvidenceNotes ||
    validatedEditorial.editorialNotes !== editorialNotes
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID);
  }

  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
    receiptId,
    sourceRevision,
    sourceUpdatedAt,
    draftSourceRevision,
    revision,
    status: validatedEditorial.status,
    titleAr: validatedEditorial.titleAr,
    titleEn: validatedEditorial.titleEn,
    issuingOrganization: validatedEditorial.issuingOrganization,
    summaryAr: validatedEditorial.summaryAr,
    summaryEn: validatedEditorial.summaryEn,
    sourceEvidenceNotes: validatedEditorial.sourceEvidenceNotes,
    rightsEvidenceNotes: validatedEditorial.rightsEvidenceNotes,
    editorialNotes: validatedEditorial.editorialNotes,
    createdAt,
    updatedAt,
  });
}

export function validateGetLibraryQuarantineHumanReviewCaseResponse(
  rawData: unknown,
  expectedReceiptId: string
): GetLibraryQuarantineHumanReviewCaseResponseDto {
  if (
    typeof expectedReceiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(expectedReceiptId)
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }

  if (
    !isPlainObject(rawData) ||
    Object.getOwnPropertySymbols(rawData).length > 0 ||
    hasForbiddenPrivateLeakInHumanReviewPayload(rawData)
  ) {
    throw new Error(
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
    );
  }

  if (rawData.ok === true) {
    const obj = assertExactPlainObjectKeys(
      rawData,
      ALLOWED_GET_SUCCESS_KEYS,
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
    );

    const {
      status,
      receiptId,
      sourceRevision,
      draftStatus,
      adminReceipt,
      currentRevision,
      reviewCase,
      isSanitized,
      isVerifiedSafe,
      isRightsApproved,
      isPublished,
      isReadyForPeia,
    } = obj;

    if (
      status !== 'READY' ||
      receiptId !== expectedReceiptId ||
      typeof sourceRevision !== 'number' ||
      !Number.isSafeInteger(sourceRevision) ||
      sourceRevision < 1 ||
      draftStatus !== 'PENDING_HUMAN_REVIEW' ||
      typeof currentRevision !== 'number' ||
      !Number.isSafeInteger(currentRevision) ||
      currentRevision < 0 ||
      isSanitized !== false ||
      isVerifiedSafe !== false ||
      isRightsApproved !== false ||
      isPublished !== false ||
      isReadyForPeia !== false
    ) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
      );
    }

    let validatedReceiptItem: {
      readonly revision: number;
      readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
    };
    try {
      validatedReceiptItem = validateSanitizedLibraryQuarantineReceiptListItem({
        revision: sourceRevision,
        adminReceipt,
      });
    } catch {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
      );
    }

    if (
      validatedReceiptItem.adminReceipt.receiptId !== expectedReceiptId ||
      validatedReceiptItem.adminReceipt.state !== 'Quarantined'
    ) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
      );
    }

    let validatedCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null =
      null;
    if (reviewCase !== null) {
      try {
        validatedCase = validateSanitizedLibraryQuarantineHumanReviewCaseDto(
          reviewCase,
          expectedReceiptId
        );
      } catch {
        throw new Error(
          HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
        );
      }
      if (
        validatedCase.revision !== currentRevision ||
        validatedCase.sourceRevision !== sourceRevision ||
        validatedCase.sourceUpdatedAt !==
          validatedReceiptItem.adminReceipt.updatedAt
      ) {
        throw new Error(
          HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
        );
      }
    } else if (currentRevision !== 0) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
      );
    }

    return Object.freeze({
      ok: true as const,
      status: 'READY' as const,
      receiptId: expectedReceiptId,
      sourceRevision,
      draftStatus: 'PENDING_HUMAN_REVIEW' as const,
      adminReceipt: validatedReceiptItem.adminReceipt,
      currentRevision,
      reviewCase: validatedCase,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (rawData.ok === false) {
    const obj = assertExactPlainObjectKeys(
      rawData,
      ALLOWED_GET_HOLD_KEYS,
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
    );

    const {
      status,
      errorCode,
      errorMessage,
      receiptId,
      isSanitized,
      isVerifiedSafe,
      isRightsApproved,
      isPublished,
      isReadyForPeia,
    } = obj;

    if (
      status !== 'HOLD' ||
      typeof errorCode !== 'string' ||
      errorCode.trim().length === 0 ||
      typeof errorMessage !== 'string' ||
      errorMessage.trim().length === 0 ||
      errorMessage.length > 260 ||
      SINGLE_LINE_CONTROL_OR_BIDI_REGEX.test(errorMessage) ||
      (receiptId !== expectedReceiptId && receiptId !== null) ||
      isSanitized !== false ||
      isVerifiedSafe !== false ||
      isRightsApproved !== false ||
      isPublished !== false ||
      isReadyForPeia !== false
    ) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
      );
    }

    return Object.freeze({
      ok: false as const,
      status: 'HOLD' as const,
      errorCode,
      errorMessage,
      receiptId: (receiptId as string | null) ?? null,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  throw new Error(
    HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID
  );
}

export function validateSaveLibraryQuarantineHumanReviewCaseResponse(
  rawData: unknown,
  expectedReceiptId: string
): SaveLibraryQuarantineHumanReviewCaseResponseDto {
  if (
    typeof expectedReceiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(expectedReceiptId)
  ) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }

  if (
    !isPlainObject(rawData) ||
    Object.getOwnPropertySymbols(rawData).length > 0 ||
    hasForbiddenPrivateLeakInHumanReviewPayload(rawData)
  ) {
    throw new Error(
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
    );
  }

  if (rawData.ok === true) {
    const obj = assertExactPlainObjectKeys(
      rawData,
      ALLOWED_SAVE_SAVED_KEYS,
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
    );

    const {
      status,
      caseSaveOutcome,
      caseSaved,
      receiptId,
      sourceRevision,
      currentRevision,
      reviewCase,
      isSanitized,
      isVerifiedSafe,
      isRightsApproved,
      isPublished,
      isReadyForPeia,
    } = obj;

    if (
      status !== 'SAVED' ||
      (caseSaveOutcome !== 'CREATED' && caseSaveOutcome !== 'UPDATED') ||
      caseSaved !== true ||
      receiptId !== expectedReceiptId ||
      typeof sourceRevision !== 'number' ||
      !Number.isSafeInteger(sourceRevision) ||
      sourceRevision < 1 ||
      typeof currentRevision !== 'number' ||
      !Number.isSafeInteger(currentRevision) ||
      currentRevision < 1 ||
      (caseSaveOutcome === 'CREATED'
        ? currentRevision !== 1
        : currentRevision < 2) ||
      isSanitized !== false ||
      isVerifiedSafe !== false ||
      isRightsApproved !== false ||
      isPublished !== false ||
      isReadyForPeia !== false
    ) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
      );
    }

    let validatedCase: SanitizedLibraryQuarantineHumanReviewCaseDto;
    try {
      validatedCase = validateSanitizedLibraryQuarantineHumanReviewCaseDto(
        reviewCase,
        expectedReceiptId
      );
    } catch {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
      );
    }

    if (
      validatedCase.revision !== currentRevision ||
      validatedCase.sourceRevision !== sourceRevision
    ) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
      );
    }

    return Object.freeze({
      ok: true as const,
      status: 'SAVED' as const,
      caseSaveOutcome,
      caseSaved: true as const,
      receiptId: expectedReceiptId,
      sourceRevision,
      currentRevision,
      reviewCase: validatedCase,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (rawData.ok === false && rawData.status === 'CONFLICT') {
    const obj = assertExactPlainObjectKeys(
      rawData,
      ALLOWED_SAVE_CONFLICT_KEYS,
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
    );

    const {
      caseSaveOutcome,
      caseSaved,
      errorCode,
      errorMessage,
      receiptId,
      currentRevision,
      currentCase,
      isSanitized,
      isVerifiedSafe,
      isRightsApproved,
      isPublished,
      isReadyForPeia,
    } = obj;

    if (
      caseSaveOutcome !== 'NOT_SAVED' ||
      caseSaved !== false ||
      errorCode !== 'CASE_REVISION_CONFLICT' ||
      typeof errorMessage !== 'string' ||
      errorMessage.trim().length === 0 ||
      errorMessage.length > 260 ||
      SINGLE_LINE_CONTROL_OR_BIDI_REGEX.test(errorMessage) ||
      receiptId !== expectedReceiptId ||
      typeof currentRevision !== 'number' ||
      !Number.isSafeInteger(currentRevision) ||
      currentRevision < 0 ||
      isSanitized !== false ||
      isVerifiedSafe !== false ||
      isRightsApproved !== false ||
      isPublished !== false ||
      isReadyForPeia !== false
    ) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
      );
    }

    let validatedConflictCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null =
      null;
    if (currentCase !== null) {
      try {
        validatedConflictCase =
          validateSanitizedLibraryQuarantineHumanReviewCaseDto(
            currentCase,
            expectedReceiptId
          );
      } catch {
        throw new Error(
          HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
        );
      }
      if (validatedConflictCase.revision !== currentRevision) {
        throw new Error(
          HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
        );
      }
    } else if (currentRevision !== 0) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
      );
    }

    return Object.freeze({
      ok: false as const,
      status: 'CONFLICT' as const,
      caseSaveOutcome: 'NOT_SAVED' as const,
      caseSaved: false as const,
      errorCode: 'CASE_REVISION_CONFLICT' as const,
      errorMessage,
      receiptId: expectedReceiptId,
      currentRevision,
      currentCase: validatedConflictCase,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (
    rawData.ok === false &&
    (rawData.status === 'HOLD' || rawData.status === 'UNKNOWN')
  ) {
    const obj = assertExactPlainObjectKeys(
      rawData,
      ALLOWED_SAVE_HOLD_OR_UNKNOWN_KEYS,
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
    );

    const {
      status,
      caseSaveOutcome,
      caseSaved,
      errorCode,
      errorMessage,
      receiptId,
      isSanitized,
      isVerifiedSafe,
      isRightsApproved,
      isPublished,
      isReadyForPeia,
    } = obj;

    if (
      typeof errorCode !== 'string' ||
      errorCode.trim().length === 0 ||
      typeof errorMessage !== 'string' ||
      errorMessage.trim().length === 0 ||
      errorMessage.length > 260 ||
      SINGLE_LINE_CONTROL_OR_BIDI_REGEX.test(errorMessage) ||
      isSanitized !== false ||
      isVerifiedSafe !== false ||
      isRightsApproved !== false ||
      isPublished !== false ||
      isReadyForPeia !== false
    ) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
      );
    }

    if (status === 'HOLD') {
      if (
        caseSaveOutcome !== 'NOT_SAVED' ||
        caseSaved !== false ||
        (receiptId !== expectedReceiptId && receiptId !== null)
      ) {
        throw new Error(
          HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
        );
      }

      return Object.freeze({
        ok: false as const,
        status: 'HOLD' as const,
        caseSaveOutcome: 'NOT_SAVED' as const,
        caseSaved: false as const,
        errorCode,
        errorMessage,
        receiptId: (receiptId as string | null) ?? null,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    // status === 'UNKNOWN'
    if (
      caseSaveOutcome !== 'UNKNOWN' ||
      caseSaved !== null ||
      errorCode !== 'TRANSACTION_COMMIT_UNCERTAIN' ||
      receiptId !== expectedReceiptId
    ) {
      throw new Error(
        HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
      );
    }

    return Object.freeze({
      ok: false as const,
      status: 'UNKNOWN' as const,
      caseSaveOutcome: 'UNKNOWN' as const,
      caseSaved: null,
      errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
      errorMessage,
      receiptId: expectedReceiptId,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  throw new Error(
    HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID
  );
}

function createDefaultHumanReviewCallableInvoker(): HumanReviewCallableInvoker {
  if (!isFirebaseConfigured || !app || !auth?.currentUser) {
    throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE);
  }
  const fns = getFunctions(app, 'us-central1');
  const callable = httpsCallable<Record<string, unknown>, unknown>(
    fns,
    'manageLibraryDocuments'
  );
  return async (payload) => {
    const res = await callable(payload as unknown as Record<string, unknown>);
    return { data: res?.data };
  };
}

export const LibraryQuarantineHumanReviewClient = {
  isHumanReviewEnabled(
    envOverride?: Readonly<Record<string, unknown>>
  ): boolean {
    return isLibraryQuarantineHumanReviewEnabled(envOverride);
  },

  async getQuarantineHumanReviewCase(
    receiptId: string,
    options?: {
      readonly invoker?: HumanReviewCallableInvoker;
    }
  ): Promise<GetLibraryQuarantineHumanReviewCaseResponseDto> {
    const payload = buildGetQuarantineHumanReviewCasePayload(receiptId);
    const invoker =
      options?.invoker ?? createDefaultHumanReviewCallableInvoker();

    let rawResult: { readonly data: unknown };
    try {
      rawResult = await invoker(payload);
    } catch (err: unknown) {
      if (isHumanCaseReviewNotReleasedError(err)) {
        throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED);
      }
      throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_CALL_FAILED);
    }

    return validateGetLibraryQuarantineHumanReviewCaseResponse(
      rawResult?.data,
      payload.receiptId
    );
  },

  async saveQuarantineHumanReviewCase(
    params: {
      readonly receiptId: string;
      readonly expectedRevision: number;
      readonly input: SaveLibraryQuarantineHumanReviewCaseEditorialInput;
    },
    options?: {
      readonly invoker?: HumanReviewCallableInvoker;
    }
  ): Promise<SaveLibraryQuarantineHumanReviewCaseResponseDto> {
    const payload = buildSaveQuarantineHumanReviewCasePayload(params);
    const invoker =
      options?.invoker ?? createDefaultHumanReviewCallableInvoker();

    let rawResult: { readonly data: unknown };
    try {
      rawResult = await invoker(payload);
    } catch (err: unknown) {
      if (isHumanCaseReviewNotReleasedError(err)) {
        throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED);
      }
      throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED);
    }

    return validateSaveLibraryQuarantineHumanReviewCaseResponse(
      rawResult?.data,
      payload.receiptId
    );
  },
};
