import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import type { AdminUser } from '../types/admin';
import {
  QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX,
  QUARANTINE_CATALOG_DOCUMENT_ID_REGEX,
} from './libraryQuarantineCatalogHandoffClient';
import {
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
  canUserManageBinarySafetyCases,
  isLibraryQuarantineBinarySafetyCaseEnabled,
  type LibraryQuarantineBinarySafetyDeepInspectionStatus,
  type LibraryQuarantineBinarySafetySourceFormat,
  type LibraryQuarantineReadinessIndicatorsDto,
} from './libraryQuarantineBinarySafetyCaseClient';

export const LIBRARY_ISOLATED_INSPECTION_REQUEST_UI_ENV_VAR =
  'VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED' as const;

export const LIBRARY_AV_EXECUTION_UI_ENV_VAR =
  'VITE_LIBRARY_AV_EXECUTION_ENABLED' as const;

export const LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION =
  1 as const;

export const LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE =
  'RECORDED_NOT_DISPATCHED' as const;

export type LibraryQuarantineIsolatedInspectionRequestState =
  typeof LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE;

export const LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL =
  'RECORD_INSPECTION_REQUEST_ONLY' as const;

export type LibraryQuarantineIsolatedInspectionConfirmationLiteral =
  typeof LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL;

export const LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL =
  'START_REAL_ISOLATED_AV_SCAN' as const;

export type LibraryQuarantineAvDispatchConfirmationLiteral =
  typeof LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL;

export const LIBRARY_QUARANTINE_AV_EXECUTION_STATES = Object.freeze([
  'DISPATCH_PENDING',
  'DISPATCHED_WAITING_WORKER',
  'DISPATCH_UNKNOWN',
  'DISPATCH_FAILED',
  'RUNNING',
  'AV_NO_THREAT_DETECTED',
  'AV_THREAT_DETECTED',
  'AV_SCAN_FAILED',
  'STALE_HOLD',
] as const);

export type LibraryQuarantineAvExecutionState =
  (typeof LIBRARY_QUARANTINE_AV_EXECUTION_STATES)[number];

export type QuarantineAvInspectionOverallStatus =
  | 'NOT_DISPATCHED'
  | LibraryQuarantineAvExecutionState;

export const LIBRARY_QUARANTINE_AV_EXECUTION_FAILURE_REASON_CODES =
  Object.freeze([
    'JOB_CONFIG_MISSING_OR_INVALID',
    'IAM_PRECONDITION_FAILED',
    'JOB_LAUNCH_REJECTED',
    'JOB_LAUNCH_UNCERTAIN',
    'CLAMAV_BINARY_MISSING',
    'SIGNATURE_DB_MISSING',
    'SIGNATURE_DB_STALE',
    'QUARANTINE_BUCKET_MISMATCH',
    'QUARANTINE_OBJECT_MISSING',
    'QUARANTINE_OBJECT_METADATA_MISMATCH',
    'QUARANTINE_STREAM_TIMEOUT',
    'QUARANTINE_BYTE_SIZE_MISMATCH',
    'QUARANTINE_SHA256_MISMATCH',
    'SCAN_TIMEOUT',
    'SCAN_EXECUTION_ERROR',
    'SOURCE_CHAIN_DRIFT_DURING_SCAN',
    'RECEIPT_GENERATION_DRIFT_DURING_SCAN',
    'TEMP_WORKSPACE_INIT_FAILED',
  ] as const);

export type LibraryQuarantineAvExecutionFailureReasonCode =
  (typeof LIBRARY_QUARANTINE_AV_EXECUTION_FAILURE_REASON_CODES)[number];

export const QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS: LibraryQuarantineReadinessIndicatorsDto =
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS;

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;

const DETERMINISTIC_REQUEST_ID_REGEX =
  /^([0-9a-f]{32})_([1-9][0-9]{0,14})_([1-9][0-9]{0,14})$/;

const ISO_UTC_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const BIDI_OR_INVISIBLE_FORMAT_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|blob\s*:|gs:\/\/|https?:\/\/|\/quarantine\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com|x-goog-signature|\.\.\/|\.\.\\)/i;

const FORBIDDEN_DTO_SECRET_KEYS: ReadonlySet<string> = new Set([
  'sourceSha256',
  'sha256',
  'sourceGeneration',
  'generation',
  'sourceByteSize',
  'byteSize',
  'requestedBy',
  'dispatchedBy',
  'workerRunId',
  'createdBy',
  'updatedBy',
  'actorUid',
  'storagePath',
  'quarantineBucket',
  'quarantineObjectPath',
  'bucket',
  'objectPath',
  'url',
  'signedUrl',
  'downloadUrl',
  'publicUrl',
  'fileUrl',
  'referenceUrl',
  'receipt',
  'rawBytes',
  'bytes',
  'buffer',
  'token',
  'attestation',
  'stdout',
  'stderr',
  'rawOutput',
]);

const ALLOWED_SANITIZED_REQUEST_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'requestId',
  'receiptId',
  'documentId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'safetyCaseRevision',
  'effectiveHumanCaseRevision',
  'catalogUpdatedAt',
  'requestedAt',
  'state',
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isVerifiedSafe',
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
  'outcome',
  'receiptId',
  'documentId',
  'requestId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'safetyCaseRevision',
  'effectiveHumanCaseRevision',
  'catalogUpdatedAt',
  'readiness',
  'inspectionRequest',
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_GET_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'readiness',
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_RECORD_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'requestOutcome',
  'requestRecorded',
  'receiptId',
  'documentId',
  'requestId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'safetyCaseRevision',
  'effectiveHumanCaseRevision',
  'catalogUpdatedAt',
  'readiness',
  'inspectionRequest',
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_RECORD_CONFLICT_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'requestOutcome',
  'requestRecorded',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'currentSafetyCaseRevision',
  'currentEffectiveHumanCaseRevision',
  'readiness',
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_RECORD_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'requestOutcome',
  'requestRecorded',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'readiness',
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_RECORD_UNKNOWN_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'requestOutcome',
  'requestRecorded',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'readiness',
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

export interface SanitizedLibraryQuarantineIsolatedInspectionRequestDto {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION;
  readonly requestId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly requestedAt: string;
  readonly state: typeof LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isVerifiedSafe: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineIsolatedInspectionRequestSuccessDto {
  readonly ok: true;
  readonly status: 'NOT_RECORDED' | 'RECORDED';
  readonly outcome: 'NOT_RECORDED' | 'RECORDED';
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineIsolatedInspectionRequestHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineIsolatedInspectionRequestResponseDto =
  | GetLibraryQuarantineIsolatedInspectionRequestSuccessDto
  | GetLibraryQuarantineIsolatedInspectionRequestHoldDto;

export interface RecordLibraryQuarantineIsolatedInspectionRequestSuccessDto {
  readonly ok: true;
  readonly status: 'RECORDED' | 'ALREADY_RECORDED';
  readonly outcome: 'RECORDED' | 'ALREADY_RECORDED';
  readonly requestOutcome: 'RECORDED' | 'ALREADY_RECORDED';
  readonly requestRecorded: true;
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface RecordLibraryQuarantineIsolatedInspectionRequestConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly outcome: 'CONFLICT';
  readonly requestOutcome: 'NOT_RECORDED';
  readonly requestRecorded: false;
  readonly errorCode: 'SAFETY_CASE_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentSafetyCaseRevision: number;
  readonly currentEffectiveHumanCaseRevision: number;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface RecordLibraryQuarantineIsolatedInspectionRequestHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly requestOutcome: 'NOT_RECORDED';
  readonly requestRecorded: false;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface RecordLibraryQuarantineIsolatedInspectionRequestUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly outcome: 'UNKNOWN';
  readonly requestOutcome: 'UNKNOWN';
  readonly requestRecorded: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type RecordLibraryQuarantineIsolatedInspectionRequestResponseDto =
  | RecordLibraryQuarantineIsolatedInspectionRequestSuccessDto
  | RecordLibraryQuarantineIsolatedInspectionRequestConflictDto
  | RecordLibraryQuarantineIsolatedInspectionRequestHoldDto
  | RecordLibraryQuarantineIsolatedInspectionRequestUnknownDto;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactAllowedKeysAndNoSecrets(
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
    if (FORBIDDEN_DTO_SECRET_KEYS.has(key) || !allowedKeys.has(key)) {
      return false;
    }
  }
  return true;
}

function isSafeSingleLineText(raw: unknown, maxLen: number): raw is string {
  if (typeof raw !== 'string') {
    return false;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) {
    return false;
  }
  if (
    BIDI_OR_INVISIBLE_FORMAT_REGEX.test(trimmed) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(trimmed) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(trimmed)
  ) {
    return false;
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return false;
    }
  }
  return true;
}

function isMatchingSourceFormatAndDeepInspection(
  sourceFormat: unknown,
  deepInspectionStatus: unknown
): sourceFormat is LibraryQuarantineBinarySafetySourceFormat {
  if (
    sourceFormat === 'PDF' &&
    deepInspectionStatus === 'PDF_REQUIRES_ISOLATED_PARSER'
  ) {
    return true;
  }
  if (
    sourceFormat === 'DOCX' &&
    deepInspectionStatus === 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
  ) {
    return true;
  }
  return false;
}

function isValidConstantReadinessDto(
  raw: unknown
): raw is LibraryQuarantineReadinessIndicatorsDto {
  if (
    !isPlainRecord(raw) ||
    !hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_READINESS_KEYS)
  ) {
    return false;
  }
  return (
    raw.binarySafety === 'NOT_VERIFIED' &&
    raw.fileSanitization === 'NOT_PERFORMED' &&
    raw.publication === 'BLOCKED' &&
    raw.catalogWorkflow === 'Draft'
  );
}

function hasMandatoryFalseResponseFlags(raw: Record<string, unknown>): boolean {
  return (
    raw.dispatched === false &&
    raw.scanPerformed === false &&
    raw.sanitized === false &&
    raw.isSanitized === false &&
    raw.isVerifiedSafe === false &&
    raw.isRightsApproved === false &&
    raw.isPublished === false &&
    raw.isReadyForPeia === false
  );
}

export function deriveLibraryQuarantineIsolatedInspectionRequestId(
  receiptId: string,
  sourceRevision: number,
  safetyCaseRevision: number
): string {
  if (!QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)) {
    throw new Error('INVALID_RECEIPT_ID');
  }
  if (
    typeof sourceRevision !== 'number' ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1 ||
    typeof safetyCaseRevision !== 'number' ||
    !Number.isSafeInteger(safetyCaseRevision) ||
    safetyCaseRevision < 1
  ) {
    throw new Error('INVALID_REVISION');
  }
  return `${receiptId}_${sourceRevision}_${safetyCaseRevision}`;
}

export function isLibraryQuarantineIsolatedInspectionRequestEnabled(
  envOverride?: Record<string, unknown>
): boolean {
  if (!isLibraryQuarantineBinarySafetyCaseEnabled(envOverride)) {
    return false;
  }
  const sourceEnv: Record<string, unknown> =
    envOverride ??
    ((typeof import.meta !== 'undefined' &&
    typeof (import.meta as unknown as { env?: Record<string, unknown> }).env ===
      'object'
      ? (import.meta as unknown as { env: Record<string, unknown> }).env
      : {}) as Record<string, unknown>);

  const flagValue = sourceEnv[LIBRARY_ISOLATED_INSPECTION_REQUEST_UI_ENV_VAR];
  return flagValue === 'true' || flagValue === true;
}

export function canUserRecordIsolatedInspectionRequest(
  user: AdminUser | null | undefined
): boolean {
  return canUserManageBinarySafetyCases(user);
}

export function validateSanitizedIsolatedInspectionRequestDto(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly value: SanitizedLibraryQuarantineIsolatedInspectionRequestDto;
    }
  | { readonly ok: false; readonly errorMessage: string } {
  if (
    !isPlainRecord(raw) ||
    !hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_SANITIZED_REQUEST_KEYS)
  ) {
    return {
      ok: false,
      errorMessage:
        'Sanitized isolated inspection request DTO failed strict 19-field closed key validation.',
    };
  }

  if (
    raw.schemaVersion !==
      LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION ||
    raw.state !== LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE ||
    raw.dispatched !== false ||
    raw.scanPerformed !== false ||
    raw.sanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false
  ) {
    return {
      ok: false,
      errorMessage:
        'Sanitized isolated inspection request DTO violated schemaVersion, state, or mandatory false posture locks.',
    };
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
    (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid or mismatched receiptId in inspection request DTO.',
    };
  }

  const expectedDocId = `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}`;
  if (
    typeof raw.documentId !== 'string' ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(raw.documentId) ||
    raw.documentId !== expectedDocId
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid documentId in inspection request DTO.',
    };
  }

  if (
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    typeof raw.safetyCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.safetyCaseRevision) ||
    raw.safetyCaseRevision < 1 ||
    typeof raw.effectiveHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
    raw.effectiveHumanCaseRevision < 1
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid revision numbers in inspection request DTO.',
    };
  }

  const expectedRequestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
    raw.receiptId,
    raw.sourceRevision,
    raw.safetyCaseRevision
  );
  if (
    typeof raw.requestId !== 'string' ||
    !DETERMINISTIC_REQUEST_ID_REGEX.test(raw.requestId) ||
    raw.requestId !== expectedRequestId
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid deterministic requestId in inspection request DTO.',
    };
  }

  if (
    !isMatchingSourceFormatAndDeepInspection(
      raw.sourceFormat,
      raw.deepInspectionStatus
    )
  ) {
    return {
      ok: false,
      errorMessage:
        'Invalid sourceFormat or deepInspectionStatus in inspection request DTO.',
    };
  }

  if (
    typeof raw.sourceUpdatedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.sourceUpdatedAt) ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.catalogUpdatedAt) ||
    typeof raw.requestedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.requestedAt) ||
    Date.parse(raw.requestedAt) < Date.parse(raw.sourceUpdatedAt) ||
    Date.parse(raw.requestedAt) < Date.parse(raw.catalogUpdatedAt)
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid timestamps in inspection request DTO.',
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
      requestId: expectedRequestId,
      receiptId: raw.receiptId,
      documentId: expectedDocId,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceFormat: raw.sourceFormat,
      deepInspectionStatus:
        raw.deepInspectionStatus as LibraryQuarantineBinarySafetyDeepInspectionStatus,
      safetyCaseRevision: raw.safetyCaseRevision,
      effectiveHumanCaseRevision: raw.effectiveHumanCaseRevision,
      catalogUpdatedAt: raw.catalogUpdatedAt,
      requestedAt: raw.requestedAt,
      state: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
      dispatched: false,
      scanPerformed: false,
      sanitized: false,
      isVerifiedSafe: false,
      isPublished: false,
      isReadyForPeia: false,
    }),
  };
}

export function validateGetIsolatedInspectionRequestResponseDto(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly value: GetLibraryQuarantineIsolatedInspectionRequestResponseDto;
    }
  | { readonly ok: false; readonly errorMessage: string } {
  if (!isPlainRecord(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return {
      ok: false,
      errorMessage: 'GET response must be a plain object.',
    };
  }

  if (
    !hasMandatoryFalseResponseFlags(raw) ||
    !isValidConstantReadinessDto(raw.readiness)
  ) {
    return {
      ok: false,
      errorMessage:
        'GET response violated mandatory false flags or readiness indicators.',
    };
  }

  if (
    raw.ok === true &&
    (raw.status === 'NOT_RECORDED' || raw.status === 'RECORDED') &&
    raw.outcome === raw.status
  ) {
    if (!hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_GET_SUCCESS_KEYS)) {
      return {
        ok: false,
        errorMessage: 'GET success response failed strict key validation.',
      };
    }

    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in GET success response.',
      };
    }

    const expectedDocId = `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}`;
    if (raw.documentId !== expectedDocId) {
      return {
        ok: false,
        errorMessage: 'Invalid documentId in GET success response.',
      };
    }

    if (
      typeof raw.sourceRevision !== 'number' ||
      !Number.isSafeInteger(raw.sourceRevision) ||
      raw.sourceRevision < 1 ||
      typeof raw.safetyCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.safetyCaseRevision) ||
      raw.safetyCaseRevision < 1 ||
      typeof raw.effectiveHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
      raw.effectiveHumanCaseRevision < 1 ||
      typeof raw.sourceUpdatedAt !== 'string' ||
      !ISO_UTC_TIMESTAMP_REGEX.test(raw.sourceUpdatedAt) ||
      typeof raw.catalogUpdatedAt !== 'string' ||
      !ISO_UTC_TIMESTAMP_REGEX.test(raw.catalogUpdatedAt) ||
      !isMatchingSourceFormatAndDeepInspection(
        raw.sourceFormat,
        raw.deepInspectionStatus
      )
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid provenance fields in GET success response.',
      };
    }

    const expectedRequestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
      raw.receiptId,
      raw.sourceRevision,
      raw.safetyCaseRevision
    );
    if (raw.requestId !== expectedRequestId) {
      return {
        ok: false,
        errorMessage: 'Invalid requestId in GET success response.',
      };
    }

    let validatedRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null =
      null;
    if (raw.status === 'NOT_RECORDED') {
      if (raw.inspectionRequest !== null) {
        return {
          ok: false,
          errorMessage:
            'NOT_RECORDED response must have inspectionRequest: null.',
        };
      }
    } else {
      const reqCheck = validateSanitizedIsolatedInspectionRequestDto(
        raw.inspectionRequest,
        raw.receiptId
      );
      if (!reqCheck.ok) {
        return reqCheck;
      }
      if (
        reqCheck.value.requestId !== expectedRequestId ||
        reqCheck.value.sourceRevision !== raw.sourceRevision ||
        reqCheck.value.safetyCaseRevision !== raw.safetyCaseRevision ||
        reqCheck.value.effectiveHumanCaseRevision !==
          raw.effectiveHumanCaseRevision
      ) {
        return {
          ok: false,
          errorMessage:
            'RECORDED response inspectionRequest does not match envelope provenance.',
        };
      }
      validatedRequest = reqCheck.value;
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: true as const,
        status: raw.status,
        outcome: raw.status,
        receiptId: raw.receiptId,
        documentId: expectedDocId,
        requestId: expectedRequestId,
        sourceRevision: raw.sourceRevision,
        sourceUpdatedAt: raw.sourceUpdatedAt,
        sourceFormat: raw.sourceFormat,
        deepInspectionStatus:
          raw.deepInspectionStatus as LibraryQuarantineBinarySafetyDeepInspectionStatus,
        safetyCaseRevision: raw.safetyCaseRevision,
        effectiveHumanCaseRevision: raw.effectiveHumanCaseRevision,
        catalogUpdatedAt: raw.catalogUpdatedAt,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        inspectionRequest: validatedRequest,
        dispatched: false as const,
        scanPerformed: false as const,
        sanitized: false as const,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  if (raw.ok === false && raw.status === 'HOLD' && raw.outcome === 'HOLD') {
    if (!hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_GET_HOLD_KEYS)) {
      return {
        ok: false,
        errorMessage: 'GET HOLD response failed strict key validation.',
      };
    }

    if (
      !isSafeSingleLineText(raw.errorCode, 120) ||
      !isSafeSingleLineText(raw.errorMessage, 500)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid errorCode or errorMessage in GET HOLD response.',
      };
    }

    const receiptId =
      raw.receiptId === null
        ? null
        : typeof raw.receiptId === 'string' &&
          QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
        ? raw.receiptId
        : undefined;
    if (
      receiptId === undefined ||
      (expectedReceiptId !== undefined &&
        receiptId !== null &&
        receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in GET HOLD response.',
      };
    }

    const expectedDocId = receiptId
      ? `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`
      : null;
    if (raw.documentId !== expectedDocId) {
      return {
        ok: false,
        errorMessage: 'Invalid documentId in GET HOLD response.',
      };
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: false as const,
        status: 'HOLD' as const,
        outcome: 'HOLD' as const,
        errorCode: raw.errorCode.trim(),
        errorMessage: raw.errorMessage.trim(),
        receiptId,
        documentId: expectedDocId,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        dispatched: false as const,
        scanPerformed: false as const,
        sanitized: false as const,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  return {
    ok: false,
    errorMessage: 'Unrecognized GET isolated inspection response shape.',
  };
}

export function validateRecordIsolatedInspectionRequestResponseDto(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly value: RecordLibraryQuarantineIsolatedInspectionRequestResponseDto;
    }
  | { readonly ok: false; readonly errorMessage: string } {
  if (!isPlainRecord(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return {
      ok: false,
      errorMessage: 'RECORD response must be a plain object.',
    };
  }

  if (
    !hasMandatoryFalseResponseFlags(raw) ||
    !isValidConstantReadinessDto(raw.readiness)
  ) {
    return {
      ok: false,
      errorMessage:
        'RECORD response violated mandatory false flags or readiness indicators.',
    };
  }

  if (
    raw.ok === true &&
    (raw.status === 'RECORDED' || raw.status === 'ALREADY_RECORDED') &&
    raw.outcome === raw.status &&
    raw.requestOutcome === raw.status &&
    raw.requestRecorded === true
  ) {
    if (!hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_RECORD_SUCCESS_KEYS)) {
      return {
        ok: false,
        errorMessage: 'RECORD success response failed strict key validation.',
      };
    }

    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in RECORD success response.',
      };
    }

    const expectedDocId = `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}`;
    if (raw.documentId !== expectedDocId) {
      return {
        ok: false,
        errorMessage: 'Invalid documentId in RECORD success response.',
      };
    }

    const reqCheck = validateSanitizedIsolatedInspectionRequestDto(
      raw.inspectionRequest,
      raw.receiptId
    );
    if (!reqCheck.ok) {
      return reqCheck;
    }

    const req = reqCheck.value;
    if (
      raw.requestId !== req.requestId ||
      raw.sourceRevision !== req.sourceRevision ||
      raw.sourceUpdatedAt !== req.sourceUpdatedAt ||
      raw.sourceFormat !== req.sourceFormat ||
      raw.deepInspectionStatus !== req.deepInspectionStatus ||
      raw.safetyCaseRevision !== req.safetyCaseRevision ||
      raw.effectiveHumanCaseRevision !== req.effectiveHumanCaseRevision ||
      raw.catalogUpdatedAt !== req.catalogUpdatedAt
    ) {
      return {
        ok: false,
        errorMessage:
          'RECORD success envelope fields do not match sanitized inspectionRequest.',
      };
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: true as const,
        status: raw.status,
        outcome: raw.status,
        requestOutcome: raw.status,
        requestRecorded: true as const,
        receiptId: raw.receiptId,
        documentId: expectedDocId,
        requestId: req.requestId,
        sourceRevision: req.sourceRevision,
        sourceUpdatedAt: req.sourceUpdatedAt,
        sourceFormat: req.sourceFormat,
        deepInspectionStatus: req.deepInspectionStatus,
        safetyCaseRevision: req.safetyCaseRevision,
        effectiveHumanCaseRevision: req.effectiveHumanCaseRevision,
        catalogUpdatedAt: req.catalogUpdatedAt,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        inspectionRequest: req,
        dispatched: false as const,
        scanPerformed: false as const,
        sanitized: false as const,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  if (
    raw.ok === false &&
    raw.status === 'CONFLICT' &&
    raw.outcome === 'CONFLICT' &&
    raw.requestOutcome === 'NOT_RECORDED' &&
    raw.requestRecorded === false &&
    raw.errorCode === 'SAFETY_CASE_REVISION_CONFLICT'
  ) {
    if (!hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_RECORD_CONFLICT_KEYS)) {
      return {
        ok: false,
        errorMessage: 'RECORD CONFLICT response failed strict key validation.',
      };
    }

    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in RECORD CONFLICT response.',
      };
    }

    const expectedDocId = `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}`;
    if (
      raw.documentId !== expectedDocId ||
      typeof raw.currentSafetyCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentSafetyCaseRevision) ||
      raw.currentSafetyCaseRevision < 1 ||
      typeof raw.currentEffectiveHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentEffectiveHumanCaseRevision) ||
      raw.currentEffectiveHumanCaseRevision < 1 ||
      !isSafeSingleLineText(raw.errorMessage, 500)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid fields in RECORD CONFLICT response.',
      };
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        outcome: 'CONFLICT' as const,
        requestOutcome: 'NOT_RECORDED' as const,
        requestRecorded: false as const,
        errorCode: 'SAFETY_CASE_REVISION_CONFLICT' as const,
        errorMessage: raw.errorMessage.trim(),
        receiptId: raw.receiptId,
        documentId: expectedDocId,
        currentSafetyCaseRevision: raw.currentSafetyCaseRevision,
        currentEffectiveHumanCaseRevision:
          raw.currentEffectiveHumanCaseRevision,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        dispatched: false as const,
        scanPerformed: false as const,
        sanitized: false as const,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  if (
    raw.ok === false &&
    raw.status === 'HOLD' &&
    raw.outcome === 'HOLD' &&
    raw.requestOutcome === 'NOT_RECORDED' &&
    raw.requestRecorded === false
  ) {
    if (!hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_RECORD_HOLD_KEYS)) {
      return {
        ok: false,
        errorMessage: 'RECORD HOLD response failed strict key validation.',
      };
    }

    if (
      !isSafeSingleLineText(raw.errorCode, 120) ||
      !isSafeSingleLineText(raw.errorMessage, 500)
    ) {
      return {
        ok: false,
        errorMessage:
          'Invalid errorCode or errorMessage in RECORD HOLD response.',
      };
    }

    const receiptId =
      raw.receiptId === null
        ? null
        : typeof raw.receiptId === 'string' &&
          QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
        ? raw.receiptId
        : undefined;
    if (
      receiptId === undefined ||
      (expectedReceiptId !== undefined &&
        receiptId !== null &&
        receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in RECORD HOLD response.',
      };
    }

    const expectedDocId = receiptId
      ? `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`
      : null;
    if (raw.documentId !== expectedDocId) {
      return {
        ok: false,
        errorMessage: 'Invalid documentId in RECORD HOLD response.',
      };
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: false as const,
        status: 'HOLD' as const,
        outcome: 'HOLD' as const,
        requestOutcome: 'NOT_RECORDED' as const,
        requestRecorded: false as const,
        errorCode: raw.errorCode.trim(),
        errorMessage: raw.errorMessage.trim(),
        receiptId,
        documentId: expectedDocId,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        dispatched: false as const,
        scanPerformed: false as const,
        sanitized: false as const,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  if (
    raw.ok === false &&
    raw.status === 'UNKNOWN' &&
    raw.outcome === 'UNKNOWN' &&
    raw.requestOutcome === 'UNKNOWN' &&
    raw.requestRecorded === null &&
    raw.errorCode === 'TRANSACTION_COMMIT_UNCERTAIN'
  ) {
    if (!hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_RECORD_UNKNOWN_KEYS)) {
      return {
        ok: false,
        errorMessage: 'RECORD UNKNOWN response failed strict key validation.',
      };
    }

    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId) ||
      raw.documentId !==
        `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}` ||
      !isSafeSingleLineText(raw.errorMessage, 500)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid fields in RECORD UNKNOWN response.',
      };
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        outcome: 'UNKNOWN' as const,
        requestOutcome: 'UNKNOWN' as const,
        requestRecorded: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage: raw.errorMessage.trim(),
        receiptId: raw.receiptId,
        documentId: raw.documentId,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        dispatched: false as const,
        scanPerformed: false as const,
        sanitized: false as const,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  return {
    ok: false,
    errorMessage: 'Unrecognized RECORD isolated inspection response shape.',
  };
}

export type IsolatedInspectionCallableTransport = (
  payload: Record<string, unknown>
) => Promise<{ readonly data: unknown }>;

export interface IsolatedInspectionClientOptions {
  readonly envOverride?: Record<string, unknown>;
  readonly currentUser?: AdminUser | null;
  readonly callableOverride?: IsolatedInspectionCallableTransport;
}

function makeClientGetHold(
  receiptId: string | null,
  errorCode: string,
  errorMessage: string
): GetLibraryQuarantineIsolatedInspectionRequestHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    errorCode,
    errorMessage,
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${safeReceiptId}`
      : null,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    dispatched: false as const,
    scanPerformed: false as const,
    sanitized: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeClientRecordHold(
  receiptId: string | null,
  errorCode: string,
  errorMessage: string
): RecordLibraryQuarantineIsolatedInspectionRequestHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    requestOutcome: 'NOT_RECORDED' as const,
    requestRecorded: false as const,
    errorCode,
    errorMessage,
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${safeReceiptId}`
      : null,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    dispatched: false as const,
    scanPerformed: false as const,
    sanitized: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeClientRecordUnknown(
  receiptId: string
): RecordLibraryQuarantineIsolatedInspectionRequestUnknownDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    outcome: 'UNKNOWN' as const,
    requestOutcome: 'UNKNOWN' as const,
    requestRecorded: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
    errorMessage:
      'Isolated inspection request commit acknowledgement was lost or malformed; verify state via GET before retrying.',
    receiptId,
    documentId: `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    dispatched: false as const,
    scanPerformed: false as const,
    sanitized: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function resolveCallableTransport(
  options?: IsolatedInspectionClientOptions
): IsolatedInspectionCallableTransport | null {
  if (options?.callableOverride) {
    return options.callableOverride;
  }
  if (!isFirebaseConfigured || !app) {
    return null;
  }
  const functionsInstance = getFunctions(app);
  return httpsCallable(
    functionsInstance,
    'manageLibraryDocuments'
  ) as unknown as IsolatedInspectionCallableTransport;
}

export async function getQuarantineIsolatedInspectionRequestViaCallable(
  receiptId: string,
  options?: IsolatedInspectionClientOptions
): Promise<GetLibraryQuarantineIsolatedInspectionRequestResponseDto> {
  if (!isLibraryQuarantineIsolatedInspectionRequestEnabled(options?.envOverride)) {
    return makeClientGetHold(
      receiptId,
      'ISOLATED_INSPECTION_REQUEST_NOT_RELEASED',
      'Isolated inspection request feature release gates are disabled.'
    );
  }

  if (
    options?.currentUser !== undefined &&
    !canUserRecordIsolatedInspectionRequest(options.currentUser)
  ) {
    return makeClientGetHold(
      receiptId,
      'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
      'Only active human Library Owners with Review permission may access isolated inspection requests.'
    );
  }

  if (
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    return makeClientGetHold(
      null,
      'INVALID_RECEIPT_ID',
      'Quarantine receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }

  const transport = resolveCallableTransport(options);
  if (!transport) {
    return makeClientGetHold(
      receiptId,
      'FIREBASE_NOT_CONFIGURED_HOLD',
      'Firebase callable transport is not configured.'
    );
  }

  let rawResult: { readonly data: unknown };
  try {
    rawResult = await transport(
      Object.freeze({
        action: 'getQuarantineIsolatedInspectionRequest',
        receiptId,
      })
    );
  } catch {
    return makeClientGetHold(
      receiptId,
      'CALLABLE_TRANSPORT_FAILED_HOLD',
      'Failed to read isolated inspection request from server.'
    );
  }

  const validated = validateGetIsolatedInspectionRequestResponseDto(
    rawResult?.data,
    receiptId
  );
  if (!validated.ok) {
    return makeClientGetHold(
      receiptId,
      'MALFORMED_SERVER_RESPONSE_HOLD',
      validated.errorMessage
    );
  }

  return validated.value;
}

export async function recordQuarantineIsolatedInspectionRequestViaCallable(
  params: {
    readonly receiptId: string;
    readonly expectedSafetyCaseRevision: number;
    readonly acknowledgedHumanCaseRevision: number;
    readonly confirmation: LibraryQuarantineIsolatedInspectionConfirmationLiteral;
  },
  options?: IsolatedInspectionClientOptions
): Promise<RecordLibraryQuarantineIsolatedInspectionRequestResponseDto> {
  const receiptId =
    params && typeof params.receiptId === 'string' ? params.receiptId : '';

  if (!isLibraryQuarantineIsolatedInspectionRequestEnabled(options?.envOverride)) {
    return makeClientRecordHold(
      receiptId,
      'ISOLATED_INSPECTION_REQUEST_NOT_RELEASED',
      'Isolated inspection request feature release gates are disabled.'
    );
  }

  if (
    options?.currentUser !== undefined &&
    !canUserRecordIsolatedInspectionRequest(options.currentUser)
  ) {
    return makeClientRecordHold(
      receiptId,
      'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
      'Only active human Library Owners with Review permission may record isolated inspection requests.'
    );
  }

  if (!QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)) {
    return makeClientRecordHold(
      null,
      'INVALID_RECEIPT_ID',
      'Quarantine receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }

  if (
    typeof params.expectedSafetyCaseRevision !== 'number' ||
    !Number.isSafeInteger(params.expectedSafetyCaseRevision) ||
    params.expectedSafetyCaseRevision < 1
  ) {
    return makeClientRecordHold(
      receiptId,
      'INVALID_EXPECTED_SAFETY_CASE_REVISION',
      'expectedSafetyCaseRevision must be a positive safe integer (>= 1).'
    );
  }

  if (
    typeof params.acknowledgedHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(params.acknowledgedHumanCaseRevision) ||
    params.acknowledgedHumanCaseRevision < 1
  ) {
    return makeClientRecordHold(
      receiptId,
      'UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD',
      'acknowledgedHumanCaseRevision must be a positive safe integer (>= 1).'
    );
  }

  if (
    params.confirmation !==
    LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL
  ) {
    return makeClientRecordHold(
      receiptId,
      'CONFIRMATION_LITERAL_REQUIRED_HOLD',
      'confirmation must equal RECORD_INSPECTION_REQUEST_ONLY.'
    );
  }

  const transport = resolveCallableTransport(options);
  if (!transport) {
    return makeClientRecordHold(
      receiptId,
      'FIREBASE_NOT_CONFIGURED_HOLD',
      'Firebase callable transport is not configured.'
    );
  }

  let rawResult: { readonly data: unknown };
  try {
    rawResult = await transport(
      Object.freeze({
        action: 'recordQuarantineIsolatedInspectionRequest',
        receiptId,
        expectedSafetyCaseRevision: params.expectedSafetyCaseRevision,
        acknowledgedHumanCaseRevision: params.acknowledgedHumanCaseRevision,
        confirmation:
          LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
      })
    );
  } catch {
    // Transport failure after sending record request: commit outcome is uncertain -> UNKNOWN, zero auto-retry
    return makeClientRecordUnknown(receiptId);
  }

  const validated = validateRecordIsolatedInspectionRequestResponseDto(
    rawResult?.data,
    receiptId
  );
  if (!validated.ok) {
    // Malformed server response after mutation request -> UNKNOWN, zero auto-retry
    return makeClientRecordUnknown(receiptId);
  }

  return validated.value;
}

export type IsolatedInspectionControllerPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'recording'
  | 'hold'
  | 'conflict'
  | 'unknown';

export interface IsolatedInspectionSnapshotView {
  readonly status: 'NOT_RECORDED' | 'RECORDED';
  readonly requestOutcome: 'NOT_RECORDED' | 'RECORDED' | 'ALREADY_RECORDED';
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null;
}

export interface LibraryQuarantineIsolatedInspectionControllerState {
  readonly receiptId: string;
  readonly phase: IsolatedInspectionControllerPhase;
  readonly inFlight: boolean;
  readonly confirmedRequestOnly: boolean;
  readonly snapshot: IsolatedInspectionSnapshotView | null;
  readonly holdState: {
    readonly errorCode: string;
    readonly errorMessage: string;
  } | null;
  readonly conflictState: {
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly currentSafetyCaseRevision: number;
    readonly currentEffectiveHumanCaseRevision: number;
  } | null;
  readonly uncertainState: {
    readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
    readonly errorMessage: string;
  } | null;
  readonly errorMessage: string | null;
  readonly avPhase: AvExecutionControllerPhase;
  readonly avInFlight: boolean;
  readonly confirmedAvDispatch: boolean;
  readonly avStatusSnapshot: AvInspectionStatusSnapshotView | null;
  readonly avHoldState: {
    readonly errorCode: string;
    readonly errorMessage: string;
  } | null;
  readonly avConflictState: {
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly currentSafetyCaseRevision: number;
    readonly currentEffectiveHumanCaseRevision: number;
  } | null;
  readonly avUncertainState: {
    readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' | 'JOB_LAUNCH_UNCERTAIN';
    readonly errorMessage: string;
  } | null;
  readonly avErrorMessage: string | null;
}

const ALLOWED_EXECUTION_STATES_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_AV_EXECUTION_STATES
);

const ALLOWED_FAILURE_REASON_CODES_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_AV_EXECUTION_FAILURE_REASON_CODES
);

const SAFE_ENGINE_METADATA_TOKEN_REGEX = /^[A-Za-z0-9._:+/ -]{1,80}$/;

const ALLOWED_SANITIZED_AV_EXECUTION_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'requestId',
  'receiptId',
  'documentId',
  'revision',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'safetyCaseRevision',
  'effectiveHumanCaseRevision',
  'catalogUpdatedAt',
  'state',
  'dispatchedAt',
  'workerClaimedAt',
  'completedAt',
  'engineName',
  'engineVersion',
  'signatureVersion',
  'signatureUpdatedAt',
  'scannedBytes',
  'exitCode',
  'failureReasonCode',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_GET_AV_STATUS_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'receiptId',
  'documentId',
  'requestId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'safetyCaseRevision',
  'effectiveHumanCaseRevision',
  'catalogUpdatedAt',
  'inspectionRequestRecorded',
  'inspectionRequest',
  'execution',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_GET_AV_STATUS_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_DISPATCH_AV_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'dispatchOutcome',
  'receiptId',
  'documentId',
  'requestId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'safetyCaseRevision',
  'effectiveHumanCaseRevision',
  'catalogUpdatedAt',
  'inspectionRequest',
  'execution',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_DISPATCH_AV_CONFLICT_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'dispatchOutcome',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'currentSafetyCaseRevision',
  'currentEffectiveHumanCaseRevision',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_DISPATCH_AV_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'dispatchOutcome',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'execution',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_DISPATCH_AV_UNKNOWN_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'dispatchOutcome',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'requestId',
  'execution',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

export interface SanitizedLibraryQuarantineAvExecutionDto {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION;
  readonly requestId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly state: LibraryQuarantineAvExecutionState;
  readonly dispatchedAt: string;
  readonly workerClaimedAt: string | null;
  readonly completedAt: string | null;
  readonly engineName: 'ClamAV' | null;
  readonly engineVersion: string | null;
  readonly signatureVersion: string | null;
  readonly signatureUpdatedAt: string | null;
  readonly scannedBytes: number | null;
  readonly exitCode: number | null;
  readonly failureReasonCode: LibraryQuarantineAvExecutionFailureReasonCode | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineAvInspectionStatusSuccessDto {
  readonly ok: true;
  readonly status: QuarantineAvInspectionOverallStatus;
  readonly outcome: QuarantineAvInspectionOverallStatus;
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly inspectionRequestRecorded: boolean;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineAvInspectionStatusHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineAvInspectionStatusResponseDto =
  | GetLibraryQuarantineAvInspectionStatusSuccessDto
  | GetLibraryQuarantineAvInspectionStatusHoldDto;

export interface DispatchLibraryQuarantineAvInspectionSuccessDto {
  readonly ok: true;
  readonly status: LibraryQuarantineAvExecutionState;
  readonly outcome: 'DISPATCHED' | 'ALREADY_DISPATCHED';
  readonly dispatchOutcome: 'DISPATCHED' | 'ALREADY_DISPATCHED';
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface DispatchLibraryQuarantineAvInspectionConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly outcome: 'CONFLICT';
  readonly dispatchOutcome: 'NOT_DISPATCHED';
  readonly errorCode: 'SAFETY_CASE_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentSafetyCaseRevision: number;
  readonly currentEffectiveHumanCaseRevision: number;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface DispatchLibraryQuarantineAvInspectionHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly dispatchOutcome: 'NOT_DISPATCHED';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface DispatchLibraryQuarantineAvInspectionUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly outcome: 'UNKNOWN';
  readonly dispatchOutcome: 'UNKNOWN';
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' | 'JOB_LAUNCH_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string | null;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type DispatchLibraryQuarantineAvInspectionResponseDto =
  | DispatchLibraryQuarantineAvInspectionSuccessDto
  | DispatchLibraryQuarantineAvInspectionConflictDto
  | DispatchLibraryQuarantineAvInspectionHoldDto
  | DispatchLibraryQuarantineAvInspectionUnknownDto;

export type AvExecutionControllerPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'dispatching'
  | 'hold'
  | 'conflict'
  | 'unknown';

export interface AvInspectionStatusSnapshotView {
  readonly status: QuarantineAvInspectionOverallStatus;
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly inspectionRequestRecorded: boolean;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
}

export function isLibraryQuarantineAvExecutionEnabled(
  envOverride?: Record<string, unknown>
): boolean {
  if (!isLibraryQuarantineIsolatedInspectionRequestEnabled(envOverride)) {
    return false;
  }
  const sourceEnv: Record<string, unknown> =
    envOverride ??
    ((typeof import.meta !== 'undefined' &&
    typeof (import.meta as unknown as { env?: Record<string, unknown> }).env ===
      'object'
      ? (import.meta as unknown as { env: Record<string, unknown> }).env
      : {}) as Record<string, unknown>);

  const flagValue = sourceEnv[LIBRARY_AV_EXECUTION_UI_ENV_VAR];
  return flagValue === 'true' || flagValue === true;
}

export function canUserDispatchAvInspection(
  user: AdminUser | null | undefined
): boolean {
  return canUserRecordIsolatedInspectionRequest(user);
}

function hasMandatoryFalseAvEnvelopeFlags(
  raw: Record<string, unknown>
): boolean {
  return (
    raw.isSanitized === false &&
    raw.isVerifiedSafe === false &&
    raw.isRightsApproved === false &&
    raw.isPublished === false &&
    raw.isReadyForPeia === false
  );
}

function isSafeEngineToken(value: unknown): value is string {
  if (typeof value !== 'string' || !SAFE_ENGINE_METADATA_TOKEN_REGEX.test(value)) {
    return false;
  }
  return !FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(value);
}

export function validateSanitizedAvExecutionDto(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly value: SanitizedLibraryQuarantineAvExecutionDto;
    }
  | { readonly ok: false; readonly errorMessage: string } {
  if (
    !isPlainRecord(raw) ||
    !hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_SANITIZED_AV_EXECUTION_KEYS)
  ) {
    return {
      ok: false,
      errorMessage:
        'Sanitized AV execution DTO failed strict 28-field closed key validation.',
    };
  }

  if (
    raw.schemaVersion !== LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION ||
    !hasMandatoryFalseAvEnvelopeFlags(raw)
  ) {
    return {
      ok: false,
      errorMessage:
        'Sanitized AV execution DTO violated schemaVersion or mandatory false security posture locks.',
    };
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
    (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid or mismatched receiptId in AV execution DTO.',
    };
  }

  const expectedDocId = `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}`;
  if (
    typeof raw.documentId !== 'string' ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(raw.documentId) ||
    raw.documentId !== expectedDocId
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid documentId in AV execution DTO.',
    };
  }

  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1 ||
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    typeof raw.safetyCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.safetyCaseRevision) ||
    raw.safetyCaseRevision < 1 ||
    typeof raw.effectiveHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
    raw.effectiveHumanCaseRevision < 1
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid revision numbers in AV execution DTO.',
    };
  }

  const expectedRequestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
    raw.receiptId,
    raw.sourceRevision,
    raw.safetyCaseRevision
  );
  if (
    typeof raw.requestId !== 'string' ||
    !DETERMINISTIC_REQUEST_ID_REGEX.test(raw.requestId) ||
    raw.requestId !== expectedRequestId
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid deterministic requestId in AV execution DTO.',
    };
  }

  if (
    !isMatchingSourceFormatAndDeepInspection(
      raw.sourceFormat,
      raw.deepInspectionStatus
    )
  ) {
    return {
      ok: false,
      errorMessage:
        'Invalid sourceFormat or deepInspectionStatus in AV execution DTO.',
    };
  }

  if (
    typeof raw.state !== 'string' ||
    !ALLOWED_EXECUTION_STATES_SET.has(raw.state)
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid state in AV execution DTO.',
    };
  }

  if (
    typeof raw.sourceUpdatedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.sourceUpdatedAt) ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.catalogUpdatedAt) ||
    typeof raw.dispatchedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.dispatchedAt) ||
    Date.parse(raw.dispatchedAt) < Date.parse(raw.sourceUpdatedAt) ||
    Date.parse(raw.dispatchedAt) < Date.parse(raw.catalogUpdatedAt)
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid timestamps in AV execution DTO.',
    };
  }

  if (
    raw.workerClaimedAt !== null &&
    (typeof raw.workerClaimedAt !== 'string' ||
      !ISO_UTC_TIMESTAMP_REGEX.test(raw.workerClaimedAt) ||
      Date.parse(raw.workerClaimedAt) < Date.parse(raw.dispatchedAt))
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid workerClaimedAt in AV execution DTO.',
    };
  }

  if (
    raw.completedAt !== null &&
    (typeof raw.completedAt !== 'string' ||
      !ISO_UTC_TIMESTAMP_REGEX.test(raw.completedAt) ||
      Date.parse(raw.completedAt) < Date.parse(raw.dispatchedAt))
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid completedAt in AV execution DTO.',
    };
  }

  if (raw.engineName !== null && raw.engineName !== 'ClamAV') {
    return {
      ok: false,
      errorMessage: 'Invalid engineName in AV execution DTO.',
    };
  }

  if (raw.engineVersion !== null && !isSafeEngineToken(raw.engineVersion)) {
    return {
      ok: false,
      errorMessage: 'Invalid engineVersion in AV execution DTO.',
    };
  }

  if (
    raw.signatureVersion !== null &&
    !isSafeEngineToken(raw.signatureVersion)
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid signatureVersion in AV execution DTO.',
    };
  }

  if (
    raw.signatureUpdatedAt !== null &&
    (typeof raw.signatureUpdatedAt !== 'string' ||
      !ISO_UTC_TIMESTAMP_REGEX.test(raw.signatureUpdatedAt))
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid signatureUpdatedAt in AV execution DTO.',
    };
  }

  if (
    raw.scannedBytes !== null &&
    (typeof raw.scannedBytes !== 'number' ||
      !Number.isSafeInteger(raw.scannedBytes) ||
      raw.scannedBytes < 0 ||
      raw.scannedBytes > 15_000_000)
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid scannedBytes in AV execution DTO.',
    };
  }

  if (
    raw.exitCode !== null &&
    (typeof raw.exitCode !== 'number' ||
      !Number.isSafeInteger(raw.exitCode) ||
      raw.exitCode < 0 ||
      raw.exitCode > 255)
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid exitCode in AV execution DTO.',
    };
  }

  if (
    raw.failureReasonCode !== null &&
    (typeof raw.failureReasonCode !== 'string' ||
      !ALLOWED_FAILURE_REASON_CODES_SET.has(raw.failureReasonCode))
  ) {
    return {
      ok: false,
      errorMessage: 'Invalid failureReasonCode in AV execution DTO.',
    };
  }

  const state = raw.state as LibraryQuarantineAvExecutionState;
  if (state === 'AV_NO_THREAT_DETECTED' || state === 'AV_THREAT_DETECTED') {
    const requiredExitCode = state === 'AV_NO_THREAT_DETECTED' ? 0 : 1;
    if (
      raw.engineName !== 'ClamAV' ||
      raw.engineVersion === null ||
      raw.signatureVersion === null ||
      raw.signatureUpdatedAt === null ||
      raw.scannedBytes === null ||
      raw.scannedBytes < 1 ||
      raw.exitCode !== requiredExitCode ||
      raw.completedAt === null ||
      raw.failureReasonCode !== null
    ) {
      return {
        ok: false,
        errorMessage: `Invalid terminal ${state} fields in AV execution DTO.`,
      };
    }
  } else if (
    state === 'AV_SCAN_FAILED' ||
    state === 'DISPATCH_FAILED' ||
    state === 'STALE_HOLD'
  ) {
    if (raw.failureReasonCode === null || raw.completedAt === null) {
      return {
        ok: false,
        errorMessage: `${state} requires non-null failureReasonCode and completedAt.`,
      };
    }
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
      requestId: expectedRequestId,
      receiptId: raw.receiptId,
      documentId: expectedDocId,
      revision: raw.revision,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceFormat: raw.sourceFormat,
      deepInspectionStatus:
        raw.deepInspectionStatus as LibraryQuarantineBinarySafetyDeepInspectionStatus,
      safetyCaseRevision: raw.safetyCaseRevision,
      effectiveHumanCaseRevision: raw.effectiveHumanCaseRevision,
      catalogUpdatedAt: raw.catalogUpdatedAt,
      state,
      dispatchedAt: raw.dispatchedAt,
      workerClaimedAt: raw.workerClaimedAt,
      completedAt: raw.completedAt,
      engineName: raw.engineName,
      engineVersion: raw.engineVersion,
      signatureVersion: raw.signatureVersion,
      signatureUpdatedAt: raw.signatureUpdatedAt,
      scannedBytes: raw.scannedBytes,
      exitCode: raw.exitCode,
      failureReasonCode:
        raw.failureReasonCode as LibraryQuarantineAvExecutionFailureReasonCode | null,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    }),
  };
}

export function validateGetQuarantineAvInspectionStatusResponseDto(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly value: GetLibraryQuarantineAvInspectionStatusResponseDto;
    }
  | { readonly ok: false; readonly errorMessage: string } {
  if (!isPlainRecord(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return {
      ok: false,
      errorMessage: 'GET AV status response must be a plain object.',
    };
  }

  if (
    !hasMandatoryFalseAvEnvelopeFlags(raw) ||
    !isValidConstantReadinessDto(raw.readiness)
  ) {
    return {
      ok: false,
      errorMessage:
        'GET AV status response violated mandatory false flags or readiness indicators.',
    };
  }

  if (
    raw.ok === true &&
    typeof raw.status === 'string' &&
    raw.outcome === raw.status &&
    (raw.status === 'NOT_DISPATCHED' ||
      ALLOWED_EXECUTION_STATES_SET.has(raw.status))
  ) {
    if (
      !hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_GET_AV_STATUS_SUCCESS_KEYS)
    ) {
      return {
        ok: false,
        errorMessage:
          'GET AV status success response failed strict key validation.',
      };
    }

    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in GET AV status success response.',
      };
    }

    const expectedDocId = `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}`;
    if (raw.documentId !== expectedDocId) {
      return {
        ok: false,
        errorMessage: 'Invalid documentId in GET AV status success response.',
      };
    }

    if (
      typeof raw.sourceRevision !== 'number' ||
      !Number.isSafeInteger(raw.sourceRevision) ||
      raw.sourceRevision < 1 ||
      typeof raw.safetyCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.safetyCaseRevision) ||
      raw.safetyCaseRevision < 1 ||
      typeof raw.effectiveHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
      raw.effectiveHumanCaseRevision < 1 ||
      typeof raw.sourceUpdatedAt !== 'string' ||
      !ISO_UTC_TIMESTAMP_REGEX.test(raw.sourceUpdatedAt) ||
      typeof raw.catalogUpdatedAt !== 'string' ||
      !ISO_UTC_TIMESTAMP_REGEX.test(raw.catalogUpdatedAt) ||
      typeof raw.inspectionRequestRecorded !== 'boolean' ||
      !isMatchingSourceFormatAndDeepInspection(
        raw.sourceFormat,
        raw.deepInspectionStatus
      )
    ) {
      return {
        ok: false,
        errorMessage:
          'Invalid provenance fields in GET AV status success response.',
      };
    }

    const expectedRequestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
      raw.receiptId,
      raw.sourceRevision,
      raw.safetyCaseRevision
    );
    if (raw.requestId !== expectedRequestId) {
      return {
        ok: false,
        errorMessage: 'Invalid requestId in GET AV status success response.',
      };
    }

    let validatedRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null =
      null;
    if (raw.inspectionRequest !== null) {
      const reqCheck = validateSanitizedIsolatedInspectionRequestDto(
        raw.inspectionRequest,
        raw.receiptId
      );
      if (!reqCheck.ok) {
        return reqCheck;
      }
      if (reqCheck.value.requestId !== expectedRequestId) {
        return {
          ok: false,
          errorMessage:
            'inspectionRequest requestId mismatch in GET AV status response.',
        };
      }
      validatedRequest = reqCheck.value;
    }

    if (raw.inspectionRequestRecorded !== (validatedRequest !== null)) {
      return {
        ok: false,
        errorMessage:
          'inspectionRequestRecorded boolean does not match inspectionRequest presence.',
      };
    }

    let validatedExec: SanitizedLibraryQuarantineAvExecutionDto | null = null;
    if (raw.status === 'NOT_DISPATCHED') {
      if (raw.execution !== null) {
        return {
          ok: false,
          errorMessage:
            'NOT_DISPATCHED AV status response must have execution: null.',
        };
      }
    } else {
      if (validatedRequest === null) {
        return {
          ok: false,
          errorMessage:
            'Dispatched AV status response requires a recorded inspectionRequest.',
        };
      }
      const execCheck = validateSanitizedAvExecutionDto(
        raw.execution,
        raw.receiptId
      );
      if (!execCheck.ok) {
        return execCheck;
      }
      if (
        execCheck.value.requestId !== expectedRequestId ||
        execCheck.value.state !== raw.status
      ) {
        return {
          ok: false,
          errorMessage:
            'Dispatched AV status response execution does not match envelope requestId or status.',
        };
      }
      validatedExec = execCheck.value;
    }

    const status = raw.status as QuarantineAvInspectionOverallStatus;
    return {
      ok: true,
      value: Object.freeze({
        ok: true as const,
        status,
        outcome: status,
        receiptId: raw.receiptId,
        documentId: expectedDocId,
        requestId: expectedRequestId,
        sourceRevision: raw.sourceRevision,
        sourceUpdatedAt: raw.sourceUpdatedAt,
        sourceFormat: raw.sourceFormat,
        deepInspectionStatus:
          raw.deepInspectionStatus as LibraryQuarantineBinarySafetyDeepInspectionStatus,
        safetyCaseRevision: raw.safetyCaseRevision,
        effectiveHumanCaseRevision: raw.effectiveHumanCaseRevision,
        catalogUpdatedAt: raw.catalogUpdatedAt,
        inspectionRequestRecorded: validatedRequest !== null,
        inspectionRequest: validatedRequest,
        execution: validatedExec,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  if (raw.ok === false && raw.status === 'HOLD' && raw.outcome === 'HOLD') {
    if (!hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_GET_AV_STATUS_HOLD_KEYS)) {
      return {
        ok: false,
        errorMessage: 'GET AV status HOLD response failed strict key validation.',
      };
    }

    if (
      !isSafeSingleLineText(raw.errorCode, 120) ||
      !isSafeSingleLineText(raw.errorMessage, 500)
    ) {
      return {
        ok: false,
        errorMessage:
          'Invalid errorCode or errorMessage in GET AV status HOLD response.',
      };
    }

    const receiptId =
      raw.receiptId === null
        ? null
        : typeof raw.receiptId === 'string' &&
          QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
        ? raw.receiptId
        : undefined;
    if (
      receiptId === undefined ||
      (expectedReceiptId !== undefined &&
        receiptId !== null &&
        receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in GET AV status HOLD response.',
      };
    }

    const expectedDocId = receiptId
      ? `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`
      : null;
    if (raw.documentId !== expectedDocId) {
      return {
        ok: false,
        errorMessage: 'Invalid documentId in GET AV status HOLD response.',
      };
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: false as const,
        status: 'HOLD' as const,
        outcome: 'HOLD' as const,
        errorCode: raw.errorCode.trim(),
        errorMessage: raw.errorMessage.trim(),
        receiptId,
        documentId: expectedDocId,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  return {
    ok: false,
    errorMessage: 'Unrecognized GET AV status response shape.',
  };
}

export function validateDispatchQuarantineAvInspectionResponseDto(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly value: DispatchLibraryQuarantineAvInspectionResponseDto;
    }
  | { readonly ok: false; readonly errorMessage: string } {
  if (!isPlainRecord(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return {
      ok: false,
      errorMessage: 'DISPATCH AV response must be a plain object.',
    };
  }

  if (
    !hasMandatoryFalseAvEnvelopeFlags(raw) ||
    !isValidConstantReadinessDto(raw.readiness)
  ) {
    return {
      ok: false,
      errorMessage:
        'DISPATCH AV response violated mandatory false flags or readiness indicators.',
    };
  }

  if (
    raw.ok === true &&
    typeof raw.status === 'string' &&
    ALLOWED_EXECUTION_STATES_SET.has(raw.status) &&
    (raw.outcome === 'DISPATCHED' || raw.outcome === 'ALREADY_DISPATCHED') &&
    raw.dispatchOutcome === raw.outcome
  ) {
    if (
      !hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_DISPATCH_AV_SUCCESS_KEYS)
    ) {
      return {
        ok: false,
        errorMessage:
          'DISPATCH AV success response failed strict key validation.',
      };
    }

    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in DISPATCH AV success response.',
      };
    }

    const expectedDocId = `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}`;
    if (raw.documentId !== expectedDocId) {
      return {
        ok: false,
        errorMessage: 'Invalid documentId in DISPATCH AV success response.',
      };
    }

    const reqCheck = validateSanitizedIsolatedInspectionRequestDto(
      raw.inspectionRequest,
      raw.receiptId
    );
    if (!reqCheck.ok) {
      return reqCheck;
    }

    const execCheck = validateSanitizedAvExecutionDto(
      raw.execution,
      raw.receiptId
    );
    if (!execCheck.ok) {
      return execCheck;
    }

    const req = reqCheck.value;
    const exec = execCheck.value;
    if (
      raw.requestId !== req.requestId ||
      exec.requestId !== req.requestId ||
      exec.state !== raw.status ||
      raw.sourceRevision !== req.sourceRevision ||
      raw.sourceUpdatedAt !== req.sourceUpdatedAt ||
      raw.sourceFormat !== req.sourceFormat ||
      raw.deepInspectionStatus !== req.deepInspectionStatus ||
      raw.safetyCaseRevision !== req.safetyCaseRevision ||
      raw.effectiveHumanCaseRevision !== req.effectiveHumanCaseRevision ||
      raw.catalogUpdatedAt !== req.catalogUpdatedAt
    ) {
      return {
        ok: false,
        errorMessage:
          'DISPATCH AV success envelope fields do not match inspectionRequest and execution.',
      };
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: true as const,
        status: exec.state,
        outcome: raw.outcome,
        dispatchOutcome: raw.outcome,
        receiptId: raw.receiptId,
        documentId: expectedDocId,
        requestId: req.requestId,
        sourceRevision: req.sourceRevision,
        sourceUpdatedAt: req.sourceUpdatedAt,
        sourceFormat: req.sourceFormat,
        deepInspectionStatus: req.deepInspectionStatus,
        safetyCaseRevision: req.safetyCaseRevision,
        effectiveHumanCaseRevision: req.effectiveHumanCaseRevision,
        catalogUpdatedAt: req.catalogUpdatedAt,
        inspectionRequest: req,
        execution: exec,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  if (
    raw.ok === false &&
    raw.status === 'CONFLICT' &&
    raw.outcome === 'CONFLICT' &&
    raw.dispatchOutcome === 'NOT_DISPATCHED' &&
    raw.errorCode === 'SAFETY_CASE_REVISION_CONFLICT'
  ) {
    if (
      !hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_DISPATCH_AV_CONFLICT_KEYS)
    ) {
      return {
        ok: false,
        errorMessage:
          'DISPATCH AV CONFLICT response failed strict key validation.',
      };
    }

    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in DISPATCH AV CONFLICT response.',
      };
    }

    const expectedDocId = `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}`;
    if (
      raw.documentId !== expectedDocId ||
      typeof raw.currentSafetyCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentSafetyCaseRevision) ||
      raw.currentSafetyCaseRevision < 1 ||
      typeof raw.currentEffectiveHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentEffectiveHumanCaseRevision) ||
      raw.currentEffectiveHumanCaseRevision < 1 ||
      !isSafeSingleLineText(raw.errorMessage, 500)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid fields in DISPATCH AV CONFLICT response.',
      };
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        outcome: 'CONFLICT' as const,
        dispatchOutcome: 'NOT_DISPATCHED' as const,
        errorCode: 'SAFETY_CASE_REVISION_CONFLICT' as const,
        errorMessage: raw.errorMessage.trim(),
        receiptId: raw.receiptId,
        documentId: expectedDocId,
        currentSafetyCaseRevision: raw.currentSafetyCaseRevision,
        currentEffectiveHumanCaseRevision:
          raw.currentEffectiveHumanCaseRevision,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  if (
    raw.ok === false &&
    raw.status === 'HOLD' &&
    raw.outcome === 'HOLD' &&
    raw.dispatchOutcome === 'NOT_DISPATCHED'
  ) {
    if (!hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_DISPATCH_AV_HOLD_KEYS)) {
      return {
        ok: false,
        errorMessage: 'DISPATCH AV HOLD response failed strict key validation.',
      };
    }

    if (
      !isSafeSingleLineText(raw.errorCode, 120) ||
      !isSafeSingleLineText(raw.errorMessage, 500)
    ) {
      return {
        ok: false,
        errorMessage:
          'Invalid errorCode or errorMessage in DISPATCH AV HOLD response.',
      };
    }

    const receiptId =
      raw.receiptId === null
        ? null
        : typeof raw.receiptId === 'string' &&
          QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId)
        ? raw.receiptId
        : undefined;
    if (
      receiptId === undefined ||
      (expectedReceiptId !== undefined &&
        receiptId !== null &&
        receiptId !== expectedReceiptId)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid receiptId in DISPATCH AV HOLD response.',
      };
    }

    const expectedDocId = receiptId
      ? `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`
      : null;
    if (raw.documentId !== expectedDocId) {
      return {
        ok: false,
        errorMessage: 'Invalid documentId in DISPATCH AV HOLD response.',
      };
    }

    let validatedExec: SanitizedLibraryQuarantineAvExecutionDto | null = null;
    if (raw.execution !== null) {
      const execCheck = validateSanitizedAvExecutionDto(
        raw.execution,
        receiptId ?? undefined
      );
      if (!execCheck.ok) {
        return execCheck;
      }
      validatedExec = execCheck.value;
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: false as const,
        status: 'HOLD' as const,
        outcome: 'HOLD' as const,
        dispatchOutcome: 'NOT_DISPATCHED' as const,
        errorCode: raw.errorCode.trim(),
        errorMessage: raw.errorMessage.trim(),
        receiptId,
        documentId: expectedDocId,
        execution: validatedExec,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  if (
    raw.ok === false &&
    raw.status === 'UNKNOWN' &&
    raw.outcome === 'UNKNOWN' &&
    raw.dispatchOutcome === 'UNKNOWN' &&
    (raw.errorCode === 'TRANSACTION_COMMIT_UNCERTAIN' ||
      raw.errorCode === 'JOB_LAUNCH_UNCERTAIN')
  ) {
    if (
      !hasExactAllowedKeysAndNoSecrets(raw, ALLOWED_DISPATCH_AV_UNKNOWN_KEYS)
    ) {
      return {
        ok: false,
        errorMessage:
          'DISPATCH AV UNKNOWN response failed strict key validation.',
      };
    }

    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId) ||
      raw.documentId !==
        `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${raw.receiptId}` ||
      !isSafeSingleLineText(raw.errorMessage, 500)
    ) {
      return {
        ok: false,
        errorMessage: 'Invalid fields in DISPATCH AV UNKNOWN response.',
      };
    }

    const requestId =
      raw.requestId === null
        ? null
        : typeof raw.requestId === 'string' &&
          DETERMINISTIC_REQUEST_ID_REGEX.test(raw.requestId)
        ? raw.requestId
        : undefined;
    if (requestId === undefined) {
      return {
        ok: false,
        errorMessage: 'Invalid requestId in DISPATCH AV UNKNOWN response.',
      };
    }

    let validatedExec: SanitizedLibraryQuarantineAvExecutionDto | null = null;
    if (raw.execution !== null) {
      const execCheck = validateSanitizedAvExecutionDto(
        raw.execution,
        raw.receiptId
      );
      if (!execCheck.ok) {
        return execCheck;
      }
      validatedExec = execCheck.value;
    }

    return {
      ok: true,
      value: Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        outcome: 'UNKNOWN' as const,
        dispatchOutcome: 'UNKNOWN' as const,
        errorCode: raw.errorCode,
        errorMessage: raw.errorMessage.trim(),
        receiptId: raw.receiptId,
        documentId: raw.documentId,
        requestId,
        execution: validatedExec,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      }),
    };
  }

  return {
    ok: false,
    errorMessage: 'Unrecognized DISPATCH AV response shape.',
  };
}

function makeClientGetAvStatusHold(
  receiptId: string | null,
  errorCode: string,
  errorMessage: string
): GetLibraryQuarantineAvInspectionStatusHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    errorCode,
    errorMessage,
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${safeReceiptId}`
      : null,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeClientDispatchAvHold(
  receiptId: string | null,
  errorCode: string,
  errorMessage: string,
  execution: SanitizedLibraryQuarantineAvExecutionDto | null = null
): DispatchLibraryQuarantineAvInspectionHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    dispatchOutcome: 'NOT_DISPATCHED' as const,
    errorCode,
    errorMessage,
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${safeReceiptId}`
      : null,
    execution,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeClientDispatchAvUnknown(
  receiptId: string,
  requestId: string | null = null,
  errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' | 'JOB_LAUNCH_UNCERTAIN' = 'JOB_LAUNCH_UNCERTAIN'
): DispatchLibraryQuarantineAvInspectionUnknownDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    outcome: 'UNKNOWN' as const,
    dispatchOutcome: 'UNKNOWN' as const,
    errorCode,
    errorMessage:
      'Isolated ClamAV job dispatch acknowledgement was lost or malformed; verify execution status via GET without retrying.',
    receiptId,
    documentId: `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`,
    requestId,
    execution: null,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

export async function getQuarantineAvInspectionStatusViaCallable(
  receiptId: string,
  options?: IsolatedInspectionClientOptions
): Promise<GetLibraryQuarantineAvInspectionStatusResponseDto> {
  if (!isLibraryQuarantineAvExecutionEnabled(options?.envOverride)) {
    return makeClientGetAvStatusHold(
      receiptId,
      'AV_EXECUTION_NOT_RELEASED',
      'Isolated ClamAV execution feature release gates are disabled.'
    );
  }

  if (
    options?.currentUser !== undefined &&
    !canUserDispatchAvInspection(options.currentUser)
  ) {
    return makeClientGetAvStatusHold(
      receiptId,
      'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
      'Only active human Library Owners with Review permission may access isolated AV execution status.'
    );
  }

  if (
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    return makeClientGetAvStatusHold(
      null,
      'INVALID_RECEIPT_ID',
      'Quarantine receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }

  const transport = resolveCallableTransport(options);
  if (!transport) {
    return makeClientGetAvStatusHold(
      receiptId,
      'FIREBASE_NOT_CONFIGURED_HOLD',
      'Firebase callable transport is not configured.'
    );
  }

  let rawResult: { readonly data: unknown };
  try {
    rawResult = await transport(
      Object.freeze({
        action: 'getQuarantineAvInspectionStatus',
        receiptId,
      })
    );
  } catch {
    return makeClientGetAvStatusHold(
      receiptId,
      'CALLABLE_TRANSPORT_FAILED_HOLD',
      'Failed to read isolated AV execution status from server.'
    );
  }

  const validated = validateGetQuarantineAvInspectionStatusResponseDto(
    rawResult?.data,
    receiptId
  );
  if (!validated.ok) {
    return makeClientGetAvStatusHold(
      receiptId,
      'MALFORMED_SERVER_RESPONSE_HOLD',
      validated.errorMessage
    );
  }

  return validated.value;
}

export async function dispatchQuarantineAvInspectionViaCallable(
  params: {
    readonly receiptId: string;
    readonly expectedRequestId: string;
    readonly expectedSafetyCaseRevision: number;
    readonly acknowledgedHumanCaseRevision: number;
    readonly confirmation: LibraryQuarantineAvDispatchConfirmationLiteral;
  },
  options?: IsolatedInspectionClientOptions
): Promise<DispatchLibraryQuarantineAvInspectionResponseDto> {
  const receiptId =
    params && typeof params.receiptId === 'string' ? params.receiptId : '';
  const expectedRequestId =
    params && typeof params.expectedRequestId === 'string'
      ? params.expectedRequestId
      : '';

  if (!isLibraryQuarantineAvExecutionEnabled(options?.envOverride)) {
    return makeClientDispatchAvHold(
      receiptId,
      'AV_EXECUTION_NOT_RELEASED',
      'Isolated ClamAV execution feature release gates are disabled.'
    );
  }

  if (
    options?.currentUser !== undefined &&
    !canUserDispatchAvInspection(options.currentUser)
  ) {
    return makeClientDispatchAvHold(
      receiptId,
      'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
      'Only active human Library Owners with Review permission may dispatch isolated AV scans.'
    );
  }

  if (!QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)) {
    return makeClientDispatchAvHold(
      null,
      'INVALID_RECEIPT_ID',
      'Quarantine receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }

  if (
    !DETERMINISTIC_REQUEST_ID_REGEX.test(expectedRequestId) ||
    !expectedRequestId.startsWith(`${receiptId}_`)
  ) {
    return makeClientDispatchAvHold(
      receiptId,
      'REQUEST_ID_MISMATCH_HOLD',
      'expectedRequestId must match <receiptId>_<sourceRevision>_<safetyCaseRevision>.'
    );
  }

  if (
    typeof params.expectedSafetyCaseRevision !== 'number' ||
    !Number.isSafeInteger(params.expectedSafetyCaseRevision) ||
    params.expectedSafetyCaseRevision < 1
  ) {
    return makeClientDispatchAvHold(
      receiptId,
      'INVALID_EXPECTED_SAFETY_CASE_REVISION',
      'expectedSafetyCaseRevision must be a positive safe integer (>= 1).'
    );
  }

  if (
    typeof params.acknowledgedHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(params.acknowledgedHumanCaseRevision) ||
    params.acknowledgedHumanCaseRevision < 1
  ) {
    return makeClientDispatchAvHold(
      receiptId,
      'UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD',
      'acknowledgedHumanCaseRevision must be a positive safe integer (>= 1).'
    );
  }

  if (
    params.confirmation !==
    LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL
  ) {
    return makeClientDispatchAvHold(
      receiptId,
      'CONFIRMATION_LITERAL_REQUIRED_HOLD',
      'confirmation must equal START_REAL_ISOLATED_AV_SCAN.'
    );
  }

  const transport = resolveCallableTransport(options);
  if (!transport) {
    return makeClientDispatchAvHold(
      receiptId,
      'FIREBASE_NOT_CONFIGURED_HOLD',
      'Firebase callable transport is not configured.'
    );
  }

  let rawResult: { readonly data: unknown };
  try {
    rawResult = await transport(
      Object.freeze({
        action: 'dispatchQuarantineAvInspection',
        receiptId,
        expectedRequestId,
        expectedSafetyCaseRevision: params.expectedSafetyCaseRevision,
        acknowledgedHumanCaseRevision: params.acknowledgedHumanCaseRevision,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
      })
    );
  } catch {
    // Transport failure after sending dispatch request -> outcome is uncertain -> UNKNOWN, zero auto-retry
    return makeClientDispatchAvUnknown(
      receiptId,
      expectedRequestId,
      'JOB_LAUNCH_UNCERTAIN'
    );
  }

  const validated = validateDispatchQuarantineAvInspectionResponseDto(
    rawResult?.data,
    receiptId
  );
  if (!validated.ok) {
    // Malformed server response after mutation request -> UNKNOWN, zero auto-retry
    return makeClientDispatchAvUnknown(
      receiptId,
      expectedRequestId,
      'JOB_LAUNCH_UNCERTAIN'
    );
  }

  return validated.value;
}

export class LibraryQuarantineIsolatedInspectionRequestController {
  private receiptId: string;
  private options: IsolatedInspectionClientOptions;
  private state: LibraryQuarantineIsolatedInspectionControllerState;
  private sessionEpoch = 0;
  private readonly listeners = new Set<
    (state: LibraryQuarantineIsolatedInspectionControllerState) => void
  >();

  constructor(receiptId: string, options: IsolatedInspectionClientOptions = {}) {
    this.receiptId = receiptId;
    this.options = { ...options };
    this.state = this.createInitialState(receiptId);
  }

  private createInitialState(
    receiptId: string
  ): LibraryQuarantineIsolatedInspectionControllerState {
    return Object.freeze({
      receiptId,
      phase: 'idle',
      inFlight: false,
      confirmedRequestOnly: false,
      snapshot: null,
      holdState: null,
      conflictState: null,
      uncertainState: null,
      errorMessage: null,
      avPhase: 'idle',
      avInFlight: false,
      confirmedAvDispatch: false,
      avStatusSnapshot: null,
      avHoldState: null,
      avConflictState: null,
      avUncertainState: null,
      avErrorMessage: null,
    });
  }

  private emit(
    nextState: LibraryQuarantineIsolatedInspectionControllerState
  ): void {
    this.state = Object.freeze({ ...nextState });
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public getState(): LibraryQuarantineIsolatedInspectionControllerState {
    return this.state;
  }

  public subscribe(
    listener: (
      state: LibraryQuarantineIsolatedInspectionControllerState
    ) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setCurrentUser(user: AdminUser | null): void {
    this.options = { ...this.options, currentUser: user };
  }

  public setConfirmedRequestOnly(confirmed: boolean): void {
    if (this.state.inFlight || this.state.phase === 'unknown') {
      return;
    }
    this.emit({
      ...this.state,
      confirmedRequestOnly: confirmed === true,
    });
  }

  public setConfirmedAvDispatch(confirmed: boolean): void {
    if (
      this.state.inFlight ||
      this.state.avInFlight ||
      this.state.avPhase === 'unknown'
    ) {
      return;
    }
    this.emit({
      ...this.state,
      confirmedAvDispatch: confirmed === true,
    });
  }

  public switchReceipt(newReceiptId: string): void {
    if (
      newReceiptId === this.receiptId &&
      this.state.phase === 'idle' &&
      this.state.avPhase === 'idle'
    ) {
      return;
    }
    this.sessionEpoch += 1;
    this.receiptId = newReceiptId;
    this.emit(this.createInitialState(newReceiptId));
  }

  public resetForSafetyOrCaseChange(): void {
    this.sessionEpoch += 1;
    this.emit(this.createInitialState(this.receiptId));
  }

  public async loadRequest(): Promise<GetLibraryQuarantineIsolatedInspectionRequestResponseDto> {
    if (this.state.inFlight) {
      return makeClientGetHold(
        this.receiptId,
        'IN_FLIGHT_OPERATION_LOCK',
        'An isolated inspection request operation is already in flight.'
      );
    }

    const epochAtStart = this.sessionEpoch;
    const targetReceiptId = this.receiptId;

    this.emit({
      ...this.state,
      phase: 'loading',
      inFlight: true,
      errorMessage: null,
    });

    const response = await getQuarantineIsolatedInspectionRequestViaCallable(
      targetReceiptId,
      this.options
    );

    if (this.sessionEpoch !== epochAtStart || this.receiptId !== targetReceiptId) {
      return response;
    }

    if (response.ok) {
      this.emit({
        ...this.state,
        receiptId: targetReceiptId,
        phase: 'ready',
        inFlight: false,
        confirmedRequestOnly: false,
        snapshot: Object.freeze({
          status: response.status,
          requestOutcome: response.status,
          receiptId: response.receiptId,
          documentId: response.documentId,
          requestId: response.requestId,
          sourceRevision: response.sourceRevision,
          sourceUpdatedAt: response.sourceUpdatedAt,
          sourceFormat: response.sourceFormat,
          deepInspectionStatus: response.deepInspectionStatus,
          safetyCaseRevision: response.safetyCaseRevision,
          effectiveHumanCaseRevision: response.effectiveHumanCaseRevision,
          catalogUpdatedAt: response.catalogUpdatedAt,
          readiness: response.readiness,
          inspectionRequest: response.inspectionRequest,
        }),
        holdState: null,
        conflictState: null,
        uncertainState: null,
        errorMessage: null,
      });
      return response;
    }

    this.emit({
      ...this.state,
      phase: 'hold',
      inFlight: false,
      confirmedRequestOnly: false,
      holdState: Object.freeze({
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      }),
      conflictState: null,
      uncertainState: null,
      errorMessage: response.errorMessage,
    });
    return response;
  }

  public async recordRequest(params: {
    readonly expectedSafetyCaseRevision: number;
    readonly acknowledgedHumanCaseRevision: number;
    readonly hasUnsavedCaseEdits?: boolean;
    readonly isSafetyCaseStale?: boolean;
    readonly safetyCaseDisposition?: string;
  }): Promise<RecordLibraryQuarantineIsolatedInspectionRequestResponseDto> {
    if (this.state.inFlight || this.state.avInFlight) {
      return makeClientRecordHold(
        this.receiptId,
        'IN_FLIGHT_OPERATION_LOCK',
        'An isolated inspection request operation is already in flight.'
      );
    }

    if (this.state.phase === 'unknown' || this.state.uncertainState !== null) {
      return makeClientRecordHold(
        this.receiptId,
        'UNKNOWN_COMMIT_REQUIRES_GET_VERIFY',
        'Verify the isolated inspection request state via GET before attempting another record action.'
      );
    }

    if (params.hasUnsavedCaseEdits === true) {
      const msg =
        'Cannot record an isolated inspection request while the human review case has unsaved edits.';
      this.emit({
        ...this.state,
        errorMessage: msg,
      });
      return makeClientRecordHold(
        this.receiptId,
        'DIRTY_HUMAN_CASE_EDITS_HOLD',
        msg
      );
    }

    if (params.isSafetyCaseStale === true) {
      const msg =
        'Cannot record an isolated inspection request when the binary safety case is stale.';
      this.emit({
        ...this.state,
        errorMessage: msg,
      });
      return makeClientRecordHold(
        this.receiptId,
        'STALE_BINARY_SAFETY_CASE_HOLD',
        msg
      );
    }

    if (
      params.safetyCaseDisposition !== undefined &&
      params.safetyCaseDisposition !== 'ISOLATED_ASSESSMENT_REQUIRED'
    ) {
      const msg =
        'Isolated inspection requests require disposition ISOLATED_ASSESSMENT_REQUIRED.';
      this.emit({
        ...this.state,
        errorMessage: msg,
      });
      return makeClientRecordHold(
        this.receiptId,
        'BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD',
        msg
      );
    }

    if (!this.state.confirmedRequestOnly) {
      const msg =
        'Explicit confirmation checkbox is required before recording an isolated inspection request.';
      this.emit({
        ...this.state,
        errorMessage: msg,
      });
      return makeClientRecordHold(
        this.receiptId,
        'CONFIRMATION_LITERAL_REQUIRED_HOLD',
        msg
      );
    }

    const epochAtStart = this.sessionEpoch;
    const targetReceiptId = this.receiptId;

    this.emit({
      ...this.state,
      phase: 'recording',
      inFlight: true,
      errorMessage: null,
    });

    const response = await recordQuarantineIsolatedInspectionRequestViaCallable(
      {
        receiptId: targetReceiptId,
        expectedSafetyCaseRevision: params.expectedSafetyCaseRevision,
        acknowledgedHumanCaseRevision: params.acknowledgedHumanCaseRevision,
        confirmation:
          LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
      },
      this.options
    );

    if (this.sessionEpoch !== epochAtStart || this.receiptId !== targetReceiptId) {
      return response;
    }

    if (response.ok) {
      this.emit({
        ...this.state,
        receiptId: targetReceiptId,
        phase: 'ready',
        inFlight: false,
        confirmedRequestOnly: false,
        snapshot: Object.freeze({
          status: 'RECORDED' as const,
          requestOutcome: response.requestOutcome,
          receiptId: response.receiptId,
          documentId: response.documentId,
          requestId: response.requestId,
          sourceRevision: response.sourceRevision,
          sourceUpdatedAt: response.sourceUpdatedAt,
          sourceFormat: response.sourceFormat,
          deepInspectionStatus: response.deepInspectionStatus,
          safetyCaseRevision: response.safetyCaseRevision,
          effectiveHumanCaseRevision: response.effectiveHumanCaseRevision,
          catalogUpdatedAt: response.catalogUpdatedAt,
          readiness: response.readiness,
          inspectionRequest: response.inspectionRequest,
        }),
        holdState: null,
        conflictState: null,
        uncertainState: null,
        errorMessage: null,
      });
      return response;
    }

    if (response.status === 'UNKNOWN') {
      this.emit({
        ...this.state,
        phase: 'unknown',
        inFlight: false,
        confirmedRequestOnly: false,
        holdState: null,
        conflictState: null,
        uncertainState: Object.freeze({
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
          errorMessage: response.errorMessage,
        }),
        errorMessage: response.errorMessage,
      });
      return response;
    }

    if (response.status === 'CONFLICT') {
      this.emit({
        ...this.state,
        phase: 'conflict',
        inFlight: false,
        confirmedRequestOnly: false,
        holdState: null,
        conflictState: Object.freeze({
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
          currentSafetyCaseRevision: response.currentSafetyCaseRevision,
          currentEffectiveHumanCaseRevision:
            response.currentEffectiveHumanCaseRevision,
        }),
        uncertainState: null,
        errorMessage: response.errorMessage,
      });
      return response;
    }

    this.emit({
      ...this.state,
      phase: 'hold',
      inFlight: false,
      confirmedRequestOnly: false,
      holdState: Object.freeze({
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      }),
      conflictState: null,
      uncertainState: null,
      errorMessage: response.errorMessage,
    });
    return response;
  }

  public async loadAvInspectionStatus(): Promise<GetLibraryQuarantineAvInspectionStatusResponseDto> {
    if (this.state.avInFlight || this.state.inFlight) {
      return makeClientGetAvStatusHold(
        this.receiptId,
        'IN_FLIGHT_OPERATION_LOCK',
        'An isolated AV inspection operation is already in flight.'
      );
    }

    const epochAtStart = this.sessionEpoch;
    const targetReceiptId = this.receiptId;

    this.emit({
      ...this.state,
      avPhase: 'loading',
      avInFlight: true,
      avErrorMessage: null,
    });

    const response = await getQuarantineAvInspectionStatusViaCallable(
      targetReceiptId,
      this.options
    );

    if (this.sessionEpoch !== epochAtStart || this.receiptId !== targetReceiptId) {
      return response;
    }

    if (response.ok) {
      const isUnknownLedgerState = response.status === 'DISPATCH_UNKNOWN';
      this.emit({
        ...this.state,
        avPhase: isUnknownLedgerState ? 'unknown' : 'ready',
        avInFlight: false,
        confirmedAvDispatch: false,
        avStatusSnapshot: Object.freeze({
          status: response.status,
          receiptId: response.receiptId,
          documentId: response.documentId,
          requestId: response.requestId,
          sourceRevision: response.sourceRevision,
          sourceUpdatedAt: response.sourceUpdatedAt,
          sourceFormat: response.sourceFormat,
          deepInspectionStatus: response.deepInspectionStatus,
          safetyCaseRevision: response.safetyCaseRevision,
          effectiveHumanCaseRevision: response.effectiveHumanCaseRevision,
          catalogUpdatedAt: response.catalogUpdatedAt,
          inspectionRequestRecorded: response.inspectionRequestRecorded,
          inspectionRequest: response.inspectionRequest,
          execution: response.execution,
          readiness: response.readiness,
        }),
        avHoldState: null,
        avConflictState: null,
        avUncertainState: isUnknownLedgerState
          ? Object.freeze({
              errorCode: 'JOB_LAUNCH_UNCERTAIN' as const,
              errorMessage:
                'Isolated ClamAV job launch acknowledgement is uncertain; refresh via GET-only verification.',
            })
          : null,
        avErrorMessage: null,
      });
      return response;
    }

    this.emit({
      ...this.state,
      avPhase: 'hold',
      avInFlight: false,
      confirmedAvDispatch: false,
      avHoldState: Object.freeze({
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      }),
      avConflictState: null,
      avUncertainState: null,
      avErrorMessage: response.errorMessage,
    });
    return response;
  }

  public async dispatchAvInspection(params: {
    readonly expectedRequestId: string;
    readonly expectedSafetyCaseRevision: number;
    readonly acknowledgedHumanCaseRevision: number;
    readonly hasUnsavedCaseEdits?: boolean;
    readonly isSafetyCaseStale?: boolean;
    readonly safetyCaseDisposition?: string;
  }): Promise<DispatchLibraryQuarantineAvInspectionResponseDto> {
    if (this.state.avInFlight || this.state.inFlight) {
      return makeClientDispatchAvHold(
        this.receiptId,
        'IN_FLIGHT_OPERATION_LOCK',
        'An isolated AV inspection operation is already in flight.'
      );
    }

    if (
      this.state.avPhase === 'unknown' ||
      this.state.avUncertainState !== null ||
      this.state.phase === 'unknown' ||
      this.state.uncertainState !== null
    ) {
      return makeClientDispatchAvHold(
        this.receiptId,
        'UNKNOWN_DISPATCH_REQUIRES_GET_VERIFY',
        'Verify the isolated AV execution status via GET before attempting another dispatch.'
      );
    }

    if (params.hasUnsavedCaseEdits === true) {
      const msg =
        'Cannot dispatch isolated AV scan while the human review case has unsaved edits.';
      this.emit({
        ...this.state,
        avErrorMessage: msg,
      });
      return makeClientDispatchAvHold(
        this.receiptId,
        'DIRTY_HUMAN_CASE_EDITS_HOLD',
        msg
      );
    }

    if (params.isSafetyCaseStale === true) {
      const msg =
        'Cannot dispatch isolated AV scan when the binary safety case is stale.';
      this.emit({
        ...this.state,
        avErrorMessage: msg,
      });
      return makeClientDispatchAvHold(
        this.receiptId,
        'STALE_BINARY_SAFETY_CASE_HOLD',
        msg
      );
    }

    if (
      params.safetyCaseDisposition !== undefined &&
      params.safetyCaseDisposition !== 'ISOLATED_ASSESSMENT_REQUIRED'
    ) {
      const msg =
        'Isolated AV execution requires binary safety disposition ISOLATED_ASSESSMENT_REQUIRED.';
      this.emit({
        ...this.state,
        avErrorMessage: msg,
      });
      return makeClientDispatchAvHold(
        this.receiptId,
        'BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD',
        msg
      );
    }

    if (!this.state.confirmedAvDispatch) {
      const msg =
        'Explicit AV dispatch confirmation checkbox is required before dispatching isolated ClamAV scan.';
      this.emit({
        ...this.state,
        avErrorMessage: msg,
      });
      return makeClientDispatchAvHold(
        this.receiptId,
        'CONFIRMATION_LITERAL_REQUIRED_HOLD',
        msg
      );
    }

    const epochAtStart = this.sessionEpoch;
    const targetReceiptId = this.receiptId;

    this.emit({
      ...this.state,
      avPhase: 'dispatching',
      avInFlight: true,
      avErrorMessage: null,
    });

    const response = await dispatchQuarantineAvInspectionViaCallable(
      {
        receiptId: targetReceiptId,
        expectedRequestId: params.expectedRequestId,
        expectedSafetyCaseRevision: params.expectedSafetyCaseRevision,
        acknowledgedHumanCaseRevision: params.acknowledgedHumanCaseRevision,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
      },
      this.options
    );

    if (this.sessionEpoch !== epochAtStart || this.receiptId !== targetReceiptId) {
      return response;
    }

    if (response.ok) {
      this.emit({
        ...this.state,
        avPhase: 'ready',
        avInFlight: false,
        confirmedAvDispatch: false,
        avStatusSnapshot: Object.freeze({
          status: response.status,
          receiptId: response.receiptId,
          documentId: response.documentId,
          requestId: response.requestId,
          sourceRevision: response.sourceRevision,
          sourceUpdatedAt: response.sourceUpdatedAt,
          sourceFormat: response.sourceFormat,
          deepInspectionStatus: response.deepInspectionStatus,
          safetyCaseRevision: response.safetyCaseRevision,
          effectiveHumanCaseRevision: response.effectiveHumanCaseRevision,
          catalogUpdatedAt: response.catalogUpdatedAt,
          inspectionRequestRecorded: true,
          inspectionRequest: response.inspectionRequest,
          execution: response.execution,
          readiness: response.readiness,
        }),
        avHoldState: null,
        avConflictState: null,
        avUncertainState: null,
        avErrorMessage: null,
      });
      return response;
    }

    if (response.status === 'UNKNOWN') {
      this.emit({
        ...this.state,
        avPhase: 'unknown',
        avInFlight: false,
        confirmedAvDispatch: false,
        avStatusSnapshot:
          response.execution && this.state.avStatusSnapshot
            ? Object.freeze({
                ...this.state.avStatusSnapshot,
                status: response.execution.state,
                execution: response.execution,
              })
            : this.state.avStatusSnapshot,
        avHoldState: null,
        avConflictState: null,
        avUncertainState: Object.freeze({
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
        }),
        avErrorMessage: response.errorMessage,
      });
      return response;
    }

    if (response.status === 'CONFLICT') {
      this.emit({
        ...this.state,
        avPhase: 'conflict',
        avInFlight: false,
        confirmedAvDispatch: false,
        avHoldState: null,
        avConflictState: Object.freeze({
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
          currentSafetyCaseRevision: response.currentSafetyCaseRevision,
          currentEffectiveHumanCaseRevision:
            response.currentEffectiveHumanCaseRevision,
        }),
        avUncertainState: null,
        avErrorMessage: response.errorMessage,
      });
      return response;
    }

    this.emit({
      ...this.state,
      avPhase: 'hold',
      avInFlight: false,
      confirmedAvDispatch: false,
      avStatusSnapshot:
        response.execution && this.state.avStatusSnapshot
          ? Object.freeze({
              ...this.state.avStatusSnapshot,
              status: response.execution.state,
              execution: response.execution,
            })
          : this.state.avStatusSnapshot,
      avHoldState: Object.freeze({
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      }),
      avConflictState: null,
      avUncertainState: null,
      avErrorMessage: response.errorMessage,
    });
    return response;
  }
}
