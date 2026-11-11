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

export const LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION =
  1 as const;

export const LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE =
  'RECORDED_NOT_DISPATCHED' as const;

export type LibraryQuarantineIsolatedInspectionRequestState =
  typeof LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE;

export const LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL =
  'RECORD_INSPECTION_REQUEST_ONLY' as const;

export type LibraryQuarantineIsolatedInspectionConfirmationLiteral =
  typeof LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL;

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

  public switchReceipt(newReceiptId: string): void {
    if (newReceiptId === this.receiptId && this.state.phase === 'idle') {
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
    if (this.state.inFlight) {
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
}
