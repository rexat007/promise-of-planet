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
  QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX,
  QUARANTINE_CATALOG_DOCUMENT_ID_REGEX,
  isLibraryQuarantineCatalogHandoffEnabled,
} from './libraryQuarantineCatalogHandoffClient';

/**
 * LIB-FILE-RIGHTS-AND-READINESS-01 — Browser-Safe Typed Client for Human Rights
 * Review Decisions & Internal Library Readiness Indicators
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Calls ONLY the existing `manageLibraryDocuments` Firebase callable with exact
 *   minimal payloads (`{ action: 'getQuarantineRightsDecision', receiptId }` and
 *   `{ action: 'saveQuarantineRightsDecision', receiptId, expectedRevision, input }`).
 * - Never accesses Firestore or Google Cloud Storage directly from the browser.
 * - Requires ALL FOUR UI release gates (`VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED === 'true'`,
 *   `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED === 'true'`,
 *   `VITE_LIBRARY_CATALOG_HANDOFF_ENABLED === 'true'`, and
 *   `VITE_LIBRARY_RIGHTS_DECISION_ENABLED === 'true'`, default disabled).
 * - Requires active human administrator with BOTH `AdminPermission.Review` AND
 *   `AdminPermission.ManageRights` (`Owner` and `RightsReviewer` qualify by default
 *   even though `RightsReviewer` does NOT have `Create`; `LibraryCurator` without
 *   `ManageRights` does NOT qualify).
 * - Strictly validates the 22-field `SanitizedLibraryQuarantineRightsDecisionDto`,
 *   the constant 4-field `LibraryQuarantineReadinessIndicatorsDto`
 *   (`binarySafety: 'NOT_VERIFIED'`, `fileSanitization: 'NOT_PERFORMED'`,
 *   `publication: 'BLOCKED'`, `catalogWorkflow: 'Draft'`), and all server responses
 *   (`READY | SAVED | CONFLICT | HOLD | UNKNOWN`), rejecting extra keys, symbol
 *   properties, HTML tags, private storage paths, `sourceSha256`, `createdBy`,
 *   `updatedBy`, `storagePath`, `generation`, signed URLs, or escalated security flags.
 * - Never auto-retries on `UNKNOWN` (`decisionSaved: null`).
 */

export const LIBRARY_RIGHTS_DECISION_UI_ENV_VAR =
  'VITE_LIBRARY_RIGHTS_DECISION_ENABLED' as const;

export const LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_RIGHTS_SCOPE = 'CATALOG_METADATA_ONLY' as const;

export const LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES = Object.freeze([
  'EVIDENCE_PENDING',
  'PERMISSION_REQUIRED',
  'METADATA_USE_CLEARED',
  'RESTRICTED',
  'NOT_PERMITTED',
] as const);

export type LibraryQuarantineRightsDecisionStatus =
  (typeof LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES)[number];

const ALLOWED_DECISION_STATUS_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES
);

export const LIBRARY_QUARANTINE_RIGHTS_BASES = Object.freeze([
  'OFFICIAL_RECORD',
  'OPEN_LICENSE',
  'EXPLICIT_PERMISSION_METADATA',
  'PUBLIC_DOMAIN',
  'INTERNAL_ONLY',
  'UNDETERMINED',
] as const);

export type LibraryQuarantineRightsBasis =
  (typeof LIBRARY_QUARANTINE_RIGHTS_BASES)[number];

const ALLOWED_RIGHTS_BASIS_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_RIGHTS_BASES
);

export const RIGHTS_DECISION_EVIDENCE_REFERENCE_MAX_LENGTH = 500 as const;
export const RIGHTS_DECISION_NOTES_MAX_LENGTH = 2000 as const;

export interface LibraryQuarantineReadinessIndicatorsDto {
  readonly binarySafety: 'NOT_VERIFIED';
  readonly fileSanitization: 'NOT_PERFORMED';
  readonly publication: 'BLOCKED';
  readonly catalogWorkflow: 'Draft';
}

export const QUARANTINE_RIGHTS_READINESS_INDICATORS: LibraryQuarantineReadinessIndicatorsDto =
  Object.freeze({
    binarySafety: 'NOT_VERIFIED' as const,
    fileSanitization: 'NOT_PERFORMED' as const,
    publication: 'BLOCKED' as const,
    catalogWorkflow: 'Draft' as const,
  });

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;

const ISO_UTC_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const BIDI_OR_INVISIBLE_FORMAT_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

function hasForbiddenControlOrBidiChar(
  value: string,
  allowNewline: boolean
): boolean {
  if (BIDI_OR_INVISIBLE_FORMAT_REGEX.test(value)) {
    return true;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (allowNewline && code === 0x0a) {
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|gs:\/\/|https?:\/\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com|x-goog-signature)/i;

export interface LibraryQuarantineRightsDecisionEditorialFields {
  readonly decision: LibraryQuarantineRightsDecisionStatus;
  readonly basis: LibraryQuarantineRightsBasis;
  readonly evidenceReference: string;
  readonly evidenceNotes: string;
  readonly reviewNotes: string;
}

export interface SaveLibraryQuarantineRightsDecisionInput {
  readonly decision: LibraryQuarantineRightsDecisionStatus;
  readonly basis: LibraryQuarantineRightsBasis;
  readonly evidenceReference?: string;
  readonly evidenceNotes?: string;
  readonly reviewNotes?: string;
}

export interface SanitizedLibraryQuarantineRightsDecisionDto
  extends LibraryQuarantineRightsDecisionEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly draftSourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineRightsDecisionSuccessDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly currentRevision: number;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly rightsDecision: SanitizedLibraryQuarantineRightsDecisionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineRightsDecisionHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineRightsDecisionResponseDto =
  | GetLibraryQuarantineRightsDecisionSuccessDto
  | GetLibraryQuarantineRightsDecisionHoldDto;

export interface SaveLibraryQuarantineRightsDecisionSuccessDto {
  readonly ok: true;
  readonly status: 'SAVED';
  readonly decisionSaveOutcome: 'CREATED' | 'UPDATED';
  readonly decisionSaved: true;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly currentRevision: number;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly rightsDecision: SanitizedLibraryQuarantineRightsDecisionDto;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineRightsDecisionConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly decisionSaveOutcome: 'NOT_SAVED';
  readonly decisionSaved: false;
  readonly errorCode: 'RIGHTS_DECISION_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentRevision: number;
  readonly currentDecision: SanitizedLibraryQuarantineRightsDecisionDto | null;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineRightsDecisionHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly decisionSaveOutcome: 'NOT_SAVED';
  readonly decisionSaved: false;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineRightsDecisionUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly decisionSaveOutcome: 'UNKNOWN';
  readonly decisionSaved: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type SaveLibraryQuarantineRightsDecisionResponseDto =
  | SaveLibraryQuarantineRightsDecisionSuccessDto
  | SaveLibraryQuarantineRightsDecisionConflictDto
  | SaveLibraryQuarantineRightsDecisionHoldDto
  | SaveLibraryQuarantineRightsDecisionUnknownDto;

export interface GetQuarantineRightsDecisionActionPayload {
  readonly action: 'getQuarantineRightsDecision';
  readonly receiptId: string;
}

export interface SaveQuarantineRightsDecisionActionPayload {
  readonly action: 'saveQuarantineRightsDecision';
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly input: LibraryQuarantineRightsDecisionEditorialFields;
}

export type RightsDecisionCallableInvoker = (
  payload:
    | GetQuarantineRightsDecisionActionPayload
    | SaveQuarantineRightsDecisionActionPayload
) => Promise<{ readonly data: unknown }>;

export interface LibraryQuarantineRightsDecisionClientOptions {
  readonly invokeCallable?: RightsDecisionCallableInvoker;
  readonly isConfigured?: boolean;
  readonly getAuthenticatedUid?: () => string | null;
}

export const RIGHTS_DECISION_CLIENT_SAFE_ERRORS = Object.freeze({
  BACKEND_UNAVAILABLE:
    'RIGHTS_DECISION_BACKEND_UNAVAILABLE: Firebase backend is not configured or no authenticated administrator session is active.',
  FEATURE_NOT_RELEASED:
    'RIGHTS_DECISION_NOT_RELEASED: Library quarantine human rights review decision is not enabled on the server.',
  INVALID_RECEIPT_ID:
    'RIGHTS_DECISION_INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hexadecimal string.',
  INVALID_EXPECTED_REVISION:
    'RIGHTS_DECISION_INVALID_EXPECTED_REVISION: expectedRevision must be a non-negative safe integer.',
  INVALID_RIGHTS_INPUT:
    'RIGHTS_DECISION_INVALID_INPUT: Rights decision fields failed client-side plain-text or completeness validation.',
  GET_RESPONSE_CONTRACT_INVALID:
    'RIGHTS_DECISION_GET_CONTRACT_INVALID: Server returned a malformed getQuarantineRightsDecision response.',
  SAVE_RESPONSE_CONTRACT_INVALID:
    'RIGHTS_DECISION_SAVE_CONTRACT_INVALID: Server returned a malformed saveQuarantineRightsDecision response.',
  DECISION_DTO_CONTRACT_INVALID:
    'RIGHTS_DECISION_DTO_CONTRACT_INVALID: Server returned a malformed or non-sanitized rights decision DTO.',
  GET_CALL_FAILED:
    'RIGHTS_DECISION_GET_FAILED: Failed to load quarantine rights review decision.',
  SAVE_CALL_FAILED:
    'RIGHTS_DECISION_SAVE_FAILED: Failed to save quarantine rights review decision.',
});

const ALLOWED_INPUT_KEYS: ReadonlySet<string> = new Set([
  'decision',
  'basis',
  'evidenceReference',
  'evidenceNotes',
  'reviewNotes',
]);

const ALLOWED_SANITIZED_DECISION_DTO_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'documentId',
  'revision',
  'sourceRevision',
  'sourceUpdatedAt',
  'draftSourceRevision',
  'catalogHandoffCaseRevision',
  'currentHumanCaseRevision',
  'rightsScope',
  'decision',
  'basis',
  'evidenceReference',
  'evidenceNotes',
  'reviewNotes',
  'createdAt',
  'updatedAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_READINESS_KEYS: ReadonlySet<string> = new Set([
  'binarySafety',
  'fileSanitization',
  'publication',
  'catalogWorkflow',
]);

const ALLOWED_GET_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'receiptId',
  'documentId',
  'sourceRevision',
  'catalogHandoffCaseRevision',
  'currentHumanCaseRevision',
  'currentRevision',
  'rightsScope',
  'rightsDecision',
  'readiness',
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
  'rightsScope',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'decisionSaveOutcome',
  'decisionSaved',
  'receiptId',
  'documentId',
  'sourceRevision',
  'catalogHandoffCaseRevision',
  'currentHumanCaseRevision',
  'currentRevision',
  'rightsScope',
  'rightsDecision',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_CONFLICT_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'decisionSaveOutcome',
  'decisionSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'currentRevision',
  'currentDecision',
  'rightsScope',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_HOLD_OR_UNKNOWN_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'decisionSaveOutcome',
  'decisionSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'rightsScope',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const FORBIDDEN_SECRET_DTO_KEYS: ReadonlySet<string> = new Set([
  'sourceSha256',
  'sha256',
  'attestedSha256',
  'createdBy',
  'updatedBy',
  'actorUid',
  'uploaderUid',
  'storagePath',
  'attestedStoragePath',
  'generation',
  'attestedGeneration',
  'gcsGeneration',
  'objectGeneration',
  'metageneration',
  'attestation',
  'bucket',
  'bucketName',
  'url',
  'signedUrl',
  'downloadUrl',
  'downloadToken',
  'referenceUrl',
  'bytes',
  'rawBytes',
  'buffer',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactAllowedKeys(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): boolean {
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    return false;
  }
  const keys = Object.keys(obj);
  if (keys.length !== allowedKeys.size) {
    return false;
  }
  for (const key of keys) {
    if (FORBIDDEN_SECRET_DTO_KEYS.has(key) || !allowedKeys.has(key)) {
      return false;
    }
  }
  return true;
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC_TIMESTAMP_REGEX.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export function deriveQuarantineCatalogDocumentId(receiptId: string): string {
  if (
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }
  return `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`;
}

/**
 * Release gate helper: returns `true` ONLY when all four UI release gates
 * (`VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED`, `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED`,
 * `VITE_LIBRARY_CATALOG_HANDOFF_ENABLED`, and `VITE_LIBRARY_RIGHTS_DECISION_ENABLED`)
 * are explicitly set to `'true'`. Defaults to `false`.
 */
export function isLibraryQuarantineRightsDecisionEnabled(
  envOverride?: Record<string, unknown>
): boolean {
  if (!isLibraryQuarantineCatalogHandoffEnabled(envOverride)) {
    return false;
  }
  if (envOverride !== undefined) {
    if (!isPlainObject(envOverride)) {
      return false;
    }
    return envOverride[LIBRARY_RIGHTS_DECISION_UI_ENV_VAR] === 'true';
  }
  const viteEnv = (
    import.meta as unknown as { readonly env?: Record<string, unknown> }
  )?.env;
  if (!viteEnv || typeof viteEnv !== 'object') {
    return false;
  }
  return viteEnv[LIBRARY_RIGHTS_DECISION_UI_ENV_VAR] === 'true';
}

/**
 * Verifies whether the given `AdminUser` is an active human administrator
 * authorized to review and record rights decisions (`Review + ManageRights`).
 * (`Owner` and `RightsReviewer` return `true` even though `RightsReviewer` does NOT
 * have `Create`; `LibraryCurator` without `ManageRights` returns `false`.)
 */
export function canReviewLibraryQuarantineRights(
  user: AdminUser | null | undefined
): boolean {
  if (!user || typeof user !== 'object') {
    return false;
  }
  if (user.isActive !== true) {
    return false;
  }
  if (user.role === AdminRole.AIAssistant) {
    return false;
  }
  const hasDomain =
    hasDomainResponsibility(user.role, AdminDomain.Library) ||
    user.role === AdminRole.RightsReviewer;
  if (!hasDomain) {
    return false;
  }
  if (
    !AdminAccessService.hasPermission(user, AdminPermission.Review) ||
    !AdminAccessService.hasPermission(user, AdminPermission.ManageRights)
  ) {
    return false;
  }
  const explicitPermissions = (
    user as AdminUser & { readonly permissions?: unknown }
  ).permissions;
  if (explicitPermissions !== undefined) {
    if (
      !Array.isArray(explicitPermissions) ||
      !explicitPermissions.includes(AdminPermission.Review) ||
      !explicitPermissions.includes(AdminPermission.ManageRights)
    ) {
      return false;
    }
  }
  return true;
}

export function isRightsDecisionNotReleasedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const msg =
    typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : '';
  return (
    msg.includes('RIGHTS_DECISION_NOT_RELEASED') ||
    msg.includes('CATALOG_HANDOFF_NOT_RELEASED') ||
    msg.includes('HUMAN_CASE_REVIEW_NOT_RELEASED') ||
    msg.includes('WORKBENCH_NOT_RELEASED')
  );
}

function validateAndNormalizeSingleLinePlainText(
  raw: unknown,
  maxLength: number
): string | null {
  if (raw === undefined) {
    return '';
  }
  if (typeof raw !== 'string') {
    return null;
  }
  if (
    hasForbiddenControlOrBidiChar(raw, false) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(raw) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(raw)
  ) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function validateAndNormalizeMultiLinePlainText(
  raw: unknown,
  maxLength: number
): string | null {
  if (raw === undefined) {
    return '';
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.replace(/\r\n?/g, '\n');
  if (
    hasForbiddenControlOrBidiChar(normalized, true) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(normalized) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(normalized)
  ) {
    return null;
  }
  const trimmed = normalized.trim();
  if (trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

export function validateClientRightsDecisionInput(
  rawInput: unknown
): LibraryQuarantineRightsDecisionEditorialFields {
  if (!isPlainObject(rawInput) || Object.getOwnPropertySymbols(rawInput).length > 0) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RIGHTS_INPUT);
  }

  for (const key of Object.keys(rawInput)) {
    if (
      FORBIDDEN_SECRET_DTO_KEYS.has(key) ||
      !ALLOWED_INPUT_KEYS.has(key)
    ) {
      throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RIGHTS_INPUT);
    }
  }

  if (
    typeof rawInput.decision !== 'string' ||
    !ALLOWED_DECISION_STATUS_SET.has(rawInput.decision) ||
    typeof rawInput.basis !== 'string' ||
    !ALLOWED_RIGHTS_BASIS_SET.has(rawInput.basis)
  ) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RIGHTS_INPUT);
  }

  const evidenceReference = validateAndNormalizeSingleLinePlainText(
    rawInput.evidenceReference,
    RIGHTS_DECISION_EVIDENCE_REFERENCE_MAX_LENGTH
  );
  const evidenceNotes = validateAndNormalizeMultiLinePlainText(
    rawInput.evidenceNotes,
    RIGHTS_DECISION_NOTES_MAX_LENGTH
  );
  const reviewNotes = validateAndNormalizeMultiLinePlainText(
    rawInput.reviewNotes,
    RIGHTS_DECISION_NOTES_MAX_LENGTH
  );

  if (
    evidenceReference === null ||
    evidenceNotes === null ||
    reviewNotes === null
  ) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RIGHTS_INPUT);
  }

  const hasAnyContent =
    evidenceReference.length > 0 ||
    evidenceNotes.length > 0 ||
    reviewNotes.length > 0;
  if (!hasAnyContent) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RIGHTS_INPUT);
  }

  const decision = rawInput.decision as LibraryQuarantineRightsDecisionStatus;
  const basis = rawInput.basis as LibraryQuarantineRightsBasis;

  if (decision === 'METADATA_USE_CLEARED') {
    if (
      basis === 'UNDETERMINED' ||
      evidenceReference.length === 0 ||
      evidenceNotes.length === 0
    ) {
      throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RIGHTS_INPUT);
    }
  }

  if (
    (decision === 'RESTRICTED' || decision === 'NOT_PERMITTED') &&
    reviewNotes.length === 0 &&
    evidenceNotes.length === 0
  ) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RIGHTS_INPUT);
  }

  return Object.freeze({
    decision,
    basis,
    evidenceReference,
    evidenceNotes,
    reviewNotes,
  });
}

export function buildGetQuarantineRightsDecisionActionPayload(
  receiptId: string
): GetQuarantineRightsDecisionActionPayload {
  if (
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }
  return Object.freeze({
    action: 'getQuarantineRightsDecision' as const,
    receiptId,
  });
}

export function buildSaveQuarantineRightsDecisionActionPayload(params: {
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly input: SaveLibraryQuarantineRightsDecisionInput;
}): SaveQuarantineRightsDecisionActionPayload {
  if (
    !params ||
    typeof params !== 'object' ||
    typeof params.receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(params.receiptId)
  ) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }
  if (
    typeof params.expectedRevision !== 'number' ||
    !Number.isSafeInteger(params.expectedRevision) ||
    params.expectedRevision < 0
  ) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_EXPECTED_REVISION
    );
  }

  const validatedInput = validateClientRightsDecisionInput(params.input);

  return Object.freeze({
    action: 'saveQuarantineRightsDecision' as const,
    receiptId: params.receiptId,
    expectedRevision: params.expectedRevision,
    input: validatedInput,
  });
}

export function validateReadinessIndicatorsDto(
  raw: unknown
): LibraryQuarantineReadinessIndicatorsDto {
  if (!isPlainObject(raw) || !hasExactAllowedKeys(raw, ALLOWED_READINESS_KEYS)) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID
    );
  }
  if (
    raw.binarySafety !== 'NOT_VERIFIED' ||
    raw.fileSanitization !== 'NOT_PERFORMED' ||
    raw.publication !== 'BLOCKED' ||
    raw.catalogWorkflow !== 'Draft'
  ) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID
    );
  }
  return QUARANTINE_RIGHTS_READINESS_INDICATORS;
}

export function validateSanitizedRightsDecisionDto(
  rawDto: unknown,
  expectedReceiptId?: string
): SanitizedLibraryQuarantineRightsDecisionDto {
  if (
    !isPlainObject(rawDto) ||
    !hasExactAllowedKeys(rawDto, ALLOWED_SANITIZED_DECISION_DTO_KEYS)
  ) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID
    );
  }

  if (
    rawDto.isSanitized !== false ||
    rawDto.isVerifiedSafe !== false ||
    rawDto.isRightsApproved !== false ||
    rawDto.isPublished !== false ||
    rawDto.isReadyForPeia !== false ||
    rawDto.rightsScope !== LIBRARY_QUARANTINE_RIGHTS_SCOPE ||
    rawDto.schemaVersion !== LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION ||
    typeof rawDto.receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(rawDto.receiptId)
  ) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID
    );
  }

  if (
    expectedReceiptId !== undefined &&
    rawDto.receiptId !== expectedReceiptId
  ) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID
    );
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentId(
    rawDto.receiptId
  );
  if (
    typeof rawDto.documentId !== 'string' ||
    rawDto.documentId !== expectedDocumentId ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(rawDto.documentId)
  ) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID
    );
  }

  if (
    typeof rawDto.revision !== 'number' ||
    !Number.isSafeInteger(rawDto.revision) ||
    rawDto.revision < 1 ||
    typeof rawDto.sourceRevision !== 'number' ||
    !Number.isSafeInteger(rawDto.sourceRevision) ||
    rawDto.sourceRevision < 1 ||
    typeof rawDto.draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(rawDto.draftSourceRevision) ||
    rawDto.draftSourceRevision !== rawDto.sourceRevision ||
    typeof rawDto.catalogHandoffCaseRevision !== 'number' ||
    !Number.isSafeInteger(rawDto.catalogHandoffCaseRevision) ||
    rawDto.catalogHandoffCaseRevision < 1 ||
    typeof rawDto.currentHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(rawDto.currentHumanCaseRevision) ||
    rawDto.currentHumanCaseRevision !== rawDto.catalogHandoffCaseRevision ||
    !isValidIsoTimestamp(rawDto.sourceUpdatedAt) ||
    !isValidIsoTimestamp(rawDto.createdAt) ||
    !isValidIsoTimestamp(rawDto.updatedAt)
  ) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID
    );
  }

  const validatedEditorial = validateClientRightsDecisionInput({
    decision: rawDto.decision,
    basis: rawDto.basis,
    evidenceReference: rawDto.evidenceReference,
    evidenceNotes: rawDto.evidenceNotes,
    reviewNotes: rawDto.reviewNotes,
  });

  if (
    validatedEditorial.evidenceReference !== rawDto.evidenceReference ||
    validatedEditorial.evidenceNotes !== rawDto.evidenceNotes ||
    validatedEditorial.reviewNotes !== rawDto.reviewNotes
  ) {
    throw new Error(
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID
    );
  }

  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
    receiptId: rawDto.receiptId,
    documentId: rawDto.documentId,
    revision: rawDto.revision,
    sourceRevision: rawDto.sourceRevision,
    sourceUpdatedAt: rawDto.sourceUpdatedAt,
    draftSourceRevision: rawDto.draftSourceRevision,
    catalogHandoffCaseRevision: rawDto.catalogHandoffCaseRevision,
    currentHumanCaseRevision: rawDto.currentHumanCaseRevision,
    rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
    decision: validatedEditorial.decision,
    basis: validatedEditorial.basis,
    evidenceReference: validatedEditorial.evidenceReference,
    evidenceNotes: validatedEditorial.evidenceNotes,
    reviewNotes: validatedEditorial.reviewNotes,
    createdAt: rawDto.createdAt,
    updatedAt: rawDto.updatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function assertNonAssurancePostureOnResponse(
  raw: Record<string, unknown>,
  errorMsg: string
): void {
  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false ||
    raw.rightsScope !== LIBRARY_QUARANTINE_RIGHTS_SCOPE
  ) {
    throw new Error(errorMsg);
  }
}

export function validateGetQuarantineRightsDecisionResponseDto(
  raw: unknown
): GetLibraryQuarantineRightsDecisionResponseDto {
  const errMsg = RIGHTS_DECISION_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID;
  if (!isPlainObject(raw)) {
    throw new Error(errMsg);
  }
  assertNonAssurancePostureOnResponse(raw, errMsg);
  const readiness = validateReadinessIndicatorsDto(raw.readiness);

  if (raw.ok === true) {
    if (
      !hasExactAllowedKeys(raw, ALLOWED_GET_SUCCESS_KEYS) ||
      raw.status !== 'READY' ||
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
    ) {
      throw new Error(errMsg);
    }

    const expectedDocId = deriveQuarantineCatalogDocumentId(raw.receiptId);
    if (
      typeof raw.documentId !== 'string' ||
      raw.documentId !== expectedDocId ||
      typeof raw.sourceRevision !== 'number' ||
      !Number.isSafeInteger(raw.sourceRevision) ||
      raw.sourceRevision < 1 ||
      typeof raw.catalogHandoffCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.catalogHandoffCaseRevision) ||
      raw.catalogHandoffCaseRevision < 1 ||
      typeof raw.currentHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentHumanCaseRevision) ||
      raw.currentHumanCaseRevision !== raw.catalogHandoffCaseRevision ||
      typeof raw.currentRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentRevision) ||
      raw.currentRevision < 0
    ) {
      throw new Error(errMsg);
    }

    let validatedDecision: SanitizedLibraryQuarantineRightsDecisionDto | null =
      null;
    if (raw.rightsDecision !== null) {
      validatedDecision = validateSanitizedRightsDecisionDto(
        raw.rightsDecision,
        raw.receiptId
      );
      if (
        raw.currentRevision !== validatedDecision.revision ||
        raw.sourceRevision !== validatedDecision.sourceRevision ||
        raw.catalogHandoffCaseRevision !==
          validatedDecision.catalogHandoffCaseRevision
      ) {
        throw new Error(errMsg);
      }
    } else if (raw.currentRevision !== 0) {
      throw new Error(errMsg);
    }

    return Object.freeze({
      ok: true as const,
      status: 'READY' as const,
      receiptId: raw.receiptId,
      documentId: raw.documentId,
      sourceRevision: raw.sourceRevision,
      catalogHandoffCaseRevision: raw.catalogHandoffCaseRevision,
      currentHumanCaseRevision: raw.currentHumanCaseRevision,
      currentRevision: raw.currentRevision,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      rightsDecision: validatedDecision,
      readiness,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (raw.ok === false) {
    if (
      !hasExactAllowedKeys(raw, ALLOWED_GET_HOLD_KEYS) ||
      raw.status !== 'HOLD'
    ) {
      throw new Error(errMsg);
    }

    const code = validateAndNormalizeSingleLinePlainText(raw.errorCode, 120);
    const msg = validateAndNormalizeSingleLinePlainText(raw.errorMessage, 500);
    if (!code || !msg) {
      throw new Error(errMsg);
    }

    const receiptId =
      raw.receiptId === null
        ? null
        : typeof raw.receiptId === 'string' &&
            QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
          ? raw.receiptId
          : undefined;
    if (receiptId === undefined) {
      throw new Error(errMsg);
    }

    const expectedDocId = receiptId
      ? deriveQuarantineCatalogDocumentId(receiptId)
      : null;
    if (raw.documentId !== expectedDocId) {
      throw new Error(errMsg);
    }

    return Object.freeze({
      ok: false as const,
      status: 'HOLD' as const,
      errorCode: code,
      errorMessage: msg,
      receiptId,
      documentId: expectedDocId,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      readiness,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  throw new Error(errMsg);
}

export function validateSaveQuarantineRightsDecisionResponseDto(
  raw: unknown
): SaveLibraryQuarantineRightsDecisionResponseDto {
  const errMsg = RIGHTS_DECISION_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID;
  if (!isPlainObject(raw)) {
    throw new Error(errMsg);
  }
  assertNonAssurancePostureOnResponse(raw, errMsg);
  const readiness = validateReadinessIndicatorsDto(raw.readiness);

  if (raw.ok === true) {
    if (
      !hasExactAllowedKeys(raw, ALLOWED_SAVE_SUCCESS_KEYS) ||
      raw.status !== 'SAVED' ||
      (raw.decisionSaveOutcome !== 'CREATED' &&
        raw.decisionSaveOutcome !== 'UPDATED') ||
      raw.decisionSaved !== true ||
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
    ) {
      throw new Error(errMsg);
    }

    const expectedDocId = deriveQuarantineCatalogDocumentId(raw.receiptId);
    if (
      typeof raw.documentId !== 'string' ||
      raw.documentId !== expectedDocId ||
      typeof raw.sourceRevision !== 'number' ||
      !Number.isSafeInteger(raw.sourceRevision) ||
      raw.sourceRevision < 1 ||
      typeof raw.catalogHandoffCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.catalogHandoffCaseRevision) ||
      raw.catalogHandoffCaseRevision < 1 ||
      typeof raw.currentHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentHumanCaseRevision) ||
      raw.currentHumanCaseRevision !== raw.catalogHandoffCaseRevision ||
      typeof raw.currentRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentRevision) ||
      raw.currentRevision < 1
    ) {
      throw new Error(errMsg);
    }

    const validatedDecision = validateSanitizedRightsDecisionDto(
      raw.rightsDecision,
      raw.receiptId
    );
    if (
      validatedDecision.revision !== raw.currentRevision ||
      validatedDecision.sourceRevision !== raw.sourceRevision ||
      validatedDecision.catalogHandoffCaseRevision !==
        raw.catalogHandoffCaseRevision ||
      (raw.decisionSaveOutcome === 'CREATED' && raw.currentRevision !== 1) ||
      (raw.decisionSaveOutcome === 'UPDATED' && raw.currentRevision < 2)
    ) {
      throw new Error(errMsg);
    }

    return Object.freeze({
      ok: true as const,
      status: 'SAVED' as const,
      decisionSaveOutcome: raw.decisionSaveOutcome,
      decisionSaved: true as const,
      receiptId: raw.receiptId,
      documentId: raw.documentId,
      sourceRevision: raw.sourceRevision,
      catalogHandoffCaseRevision: raw.catalogHandoffCaseRevision,
      currentHumanCaseRevision: raw.currentHumanCaseRevision,
      currentRevision: raw.currentRevision,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      rightsDecision: validatedDecision,
      readiness,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (raw.ok === false) {
    if (raw.status === 'CONFLICT') {
      if (
        !hasExactAllowedKeys(raw, ALLOWED_SAVE_CONFLICT_KEYS) ||
        raw.decisionSaveOutcome !== 'NOT_SAVED' ||
        raw.decisionSaved !== false ||
        raw.errorCode !== 'RIGHTS_DECISION_REVISION_CONFLICT' ||
        typeof raw.receiptId !== 'string' ||
        !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
        typeof raw.currentRevision !== 'number' ||
        !Number.isSafeInteger(raw.currentRevision) ||
        raw.currentRevision < 0
      ) {
        throw new Error(errMsg);
      }

      const expectedDocId = deriveQuarantineCatalogDocumentId(raw.receiptId);
      if (raw.documentId !== expectedDocId) {
        throw new Error(errMsg);
      }

      const msg = validateAndNormalizeSingleLinePlainText(
        raw.errorMessage,
        500
      );
      if (!msg) {
        throw new Error(errMsg);
      }

      let currentDecision: SanitizedLibraryQuarantineRightsDecisionDto | null =
        null;
      if (raw.currentDecision !== null) {
        currentDecision = validateSanitizedRightsDecisionDto(
          raw.currentDecision,
          raw.receiptId
        );
        if (currentDecision.revision !== raw.currentRevision) {
          throw new Error(errMsg);
        }
      } else if (raw.currentRevision !== 0) {
        throw new Error(errMsg);
      }

      return Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        decisionSaveOutcome: 'NOT_SAVED' as const,
        decisionSaved: false as const,
        errorCode: 'RIGHTS_DECISION_REVISION_CONFLICT' as const,
        errorMessage: msg,
        receiptId: raw.receiptId,
        documentId: expectedDocId,
        currentRevision: raw.currentRevision,
        currentDecision,
        rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
        readiness,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (raw.status === 'UNKNOWN') {
      if (
        !hasExactAllowedKeys(raw, ALLOWED_SAVE_HOLD_OR_UNKNOWN_KEYS) ||
        raw.decisionSaveOutcome !== 'UNKNOWN' ||
        raw.decisionSaved !== null ||
        raw.errorCode !== 'TRANSACTION_COMMIT_UNCERTAIN' ||
        typeof raw.receiptId !== 'string' ||
        !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
      ) {
        throw new Error(errMsg);
      }

      const expectedDocId = deriveQuarantineCatalogDocumentId(raw.receiptId);
      if (raw.documentId !== expectedDocId) {
        throw new Error(errMsg);
      }

      const msg = validateAndNormalizeSingleLinePlainText(
        raw.errorMessage,
        500
      );
      if (!msg) {
        throw new Error(errMsg);
      }

      return Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        decisionSaveOutcome: 'UNKNOWN' as const,
        decisionSaved: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage: msg,
        receiptId: raw.receiptId,
        documentId: expectedDocId,
        rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
        readiness,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (raw.status === 'HOLD') {
      if (
        !hasExactAllowedKeys(raw, ALLOWED_SAVE_HOLD_OR_UNKNOWN_KEYS) ||
        raw.decisionSaveOutcome !== 'NOT_SAVED' ||
        raw.decisionSaved !== false
      ) {
        throw new Error(errMsg);
      }

      const code = validateAndNormalizeSingleLinePlainText(raw.errorCode, 120);
      const msg = validateAndNormalizeSingleLinePlainText(
        raw.errorMessage,
        500
      );
      if (!code || !msg) {
        throw new Error(errMsg);
      }

      const receiptId =
        raw.receiptId === null
          ? null
          : typeof raw.receiptId === 'string' &&
              QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
            ? raw.receiptId
            : undefined;
      if (receiptId === undefined) {
        throw new Error(errMsg);
      }

      const expectedDocId = receiptId
        ? deriveQuarantineCatalogDocumentId(receiptId)
        : null;
      if (raw.documentId !== expectedDocId) {
        throw new Error(errMsg);
      }

      return Object.freeze({
        ok: false as const,
        status: 'HOLD' as const,
        decisionSaveOutcome: 'NOT_SAVED' as const,
        decisionSaved: false as const,
        errorCode: code,
        errorMessage: msg,
        receiptId,
        documentId: expectedDocId,
        rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
        readiness,
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

function getDefaultRightsDecisionCallableInvoker(
  options?: LibraryQuarantineRightsDecisionClientOptions
): RightsDecisionCallableInvoker {
  if (options?.invokeCallable) {
    return options.invokeCallable;
  }

  const configured =
    options?.isConfigured !== undefined
      ? options.isConfigured
      : Boolean(isFirebaseConfigured && app && auth);
  const currentUid =
    options?.getAuthenticatedUid !== undefined
      ? options.getAuthenticatedUid()
      : (auth?.currentUser?.uid ?? null);

  if (!configured || !currentUid) {
    throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE);
  }

  const functionsInstance = getFunctions(app!);
  return httpsCallable(
    functionsInstance,
    'manageLibraryDocuments'
  ) as unknown as RightsDecisionCallableInvoker;
}

export class LibraryQuarantineRightsDecisionClient {
  public static async getQuarantineRightsDecision(
    receiptId: string,
    options?: LibraryQuarantineRightsDecisionClientOptions
  ): Promise<GetLibraryQuarantineRightsDecisionResponseDto> {
    const payload = buildGetQuarantineRightsDecisionActionPayload(receiptId);
    const invoker = getDefaultRightsDecisionCallableInvoker(options);

    let rawResult: { readonly data: unknown };
    try {
      rawResult = await invoker(payload);
    } catch (err: unknown) {
      if (isRightsDecisionNotReleasedError(err)) {
        throw new Error(
          RIGHTS_DECISION_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED
        );
      }
      throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.GET_CALL_FAILED);
    }

    return validateGetQuarantineRightsDecisionResponseDto(rawResult?.data);
  }

  public static async saveQuarantineRightsDecision(
    params: {
      readonly receiptId: string;
      readonly expectedRevision: number;
      readonly input: SaveLibraryQuarantineRightsDecisionInput;
    },
    options?: LibraryQuarantineRightsDecisionClientOptions
  ): Promise<SaveLibraryQuarantineRightsDecisionResponseDto> {
    const payload = buildSaveQuarantineRightsDecisionActionPayload(params);
    const invoker = getDefaultRightsDecisionCallableInvoker(options);

    let rawResult: { readonly data: unknown };
    try {
      rawResult = await invoker(payload);
    } catch (err: unknown) {
      if (isRightsDecisionNotReleasedError(err)) {
        throw new Error(
          RIGHTS_DECISION_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED
        );
      }
      throw new Error(RIGHTS_DECISION_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED);
    }

    return validateSaveQuarantineRightsDecisionResponseDto(rawResult?.data);
  }
}
