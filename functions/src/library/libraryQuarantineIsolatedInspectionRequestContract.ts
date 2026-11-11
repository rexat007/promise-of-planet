import {
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
  deriveQuarantineCatalogDocumentIdFromReceipt,
  isMatchingSourceFormatAndDeepInspection,
  isValidSha256Hex,
  type LibraryQuarantineBinarySafetyDeepInspectionStatus,
  type LibraryQuarantineBinarySafetySourceFormat,
  type LibraryQuarantineReadinessIndicatorsDto,
} from './libraryQuarantineBinarySafetyCaseContract';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import { parseCanonicalSafeGcsGeneration } from './gcsLibraryQuarantineStorageAdapter';
import { LIBRARY_UPLOAD_MAX_BYTES } from './libraryUploadBinaryAdmission';

export type {
  LibraryQuarantineBinarySafetyDeepInspectionStatus,
  LibraryQuarantineBinarySafetySourceFormat,
  LibraryQuarantineReadinessIndicatorsDto,
};
export { deriveQuarantineCatalogDocumentIdFromReceipt };

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

const DETERMINISTIC_REQUEST_ID_REGEX =
  /^([0-9a-f]{32})_([1-9][0-9]{0,14})_([1-9][0-9]{0,14})$/;

const PERSISTED_ISOLATED_INSPECTION_REQUEST_KEYS: ReadonlySet<string> = new Set(
  [
    'schemaVersion',
    'requestId',
    'receiptId',
    'documentId',
    'sourceRevision',
    'sourceUpdatedAt',
    'sourceSha256',
    'sourceGeneration',
    'sourceByteSize',
    'sourceFormat',
    'deepInspectionStatus',
    'safetyCaseRevision',
    'effectiveHumanCaseRevision',
    'catalogUpdatedAt',
    'requestedBy',
    'requestedAt',
    'state',
    'dispatched',
    'scanPerformed',
    'sanitized',
    'isVerifiedSafe',
    'isPublished',
    'isReadyForPeia',
  ]
);

const SANITIZED_ISOLATED_INSPECTION_REQUEST_DTO_KEYS: ReadonlySet<string> =
  new Set([
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export interface ParsedIsolatedInspectionRequestId {
  readonly requestId: string;
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly safetyCaseRevision: number;
}

export function deriveLibraryQuarantineIsolatedInspectionRequestId(
  receiptId: string,
  sourceRevision: number,
  safetyCaseRevision: number
): string {
  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    throw new Error(
      'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }
  if (
    typeof sourceRevision !== 'number' ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1
  ) {
    throw new Error(
      'INVALID_SOURCE_REVISION: sourceRevision must be a positive safe integer.'
    );
  }
  if (
    typeof safetyCaseRevision !== 'number' ||
    !Number.isSafeInteger(safetyCaseRevision) ||
    safetyCaseRevision < 1
  ) {
    throw new Error(
      'INVALID_SAFETY_CASE_REVISION: safetyCaseRevision must be a positive safe integer.'
    );
  }
  return `${receiptId}_${sourceRevision}_${safetyCaseRevision}`;
}

export function parseLibraryQuarantineIsolatedInspectionRequestId(
  rawRequestId: unknown
): ParsedIsolatedInspectionRequestId | null {
  if (typeof rawRequestId !== 'string' || rawRequestId.length > 68) {
    return null;
  }
  const match = DETERMINISTIC_REQUEST_ID_REGEX.exec(rawRequestId);
  if (!match) {
    return null;
  }
  const receiptId = match[1];
  const sourceRevision = Number(match[2]);
  const safetyCaseRevision = Number(match[3]);
  if (
    !isValidLibraryQuarantineReceiptId(receiptId) ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1 ||
    !Number.isSafeInteger(safetyCaseRevision) ||
    safetyCaseRevision < 1
  ) {
    return null;
  }
  return Object.freeze({
    requestId: rawRequestId,
    receiptId,
    sourceRevision,
    safetyCaseRevision,
  });
}

export function isValidRecordIsolatedInspectionConfirmation(
  value: unknown
): value is LibraryQuarantineIsolatedInspectionConfirmationLiteral {
  return (
    value === LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL
  );
}

export interface LibraryQuarantinePersistedIsolatedInspectionRequest {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION;
  readonly requestId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly sourceGeneration: string;
  readonly sourceByteSize: number;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly state: typeof LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isVerifiedSafe: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

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

export type LibraryQuarantineIsolatedInspectionContractErrorCode =
  | 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA'
  | 'INVALID_SANITIZED_INSPECTION_REQUEST_DTO'
  | 'SECURITY_POSTURE_VIOLATION';

export interface ValidatePersistedIsolatedInspectionRequestSuccess {
  readonly ok: true;
  readonly value: LibraryQuarantinePersistedIsolatedInspectionRequest;
}

export interface ValidateIsolatedInspectionContractFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineIsolatedInspectionContractErrorCode;
  readonly errorMessage: string;
}

export type ValidatePersistedIsolatedInspectionRequestResult =
  | ValidatePersistedIsolatedInspectionRequestSuccess
  | ValidateIsolatedInspectionContractFailure;

export function validatePersistedLibraryQuarantineIsolatedInspectionRequest(
  raw: unknown,
  expectedRequestId?: string
): ValidatePersistedIsolatedInspectionRequestResult {
  if (!isPlainRecord(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Persisted isolated inspection request must be a plain object without symbol properties.',
    };
  }

  const keys = Object.keys(raw);
  if (
    keys.length !== PERSISTED_ISOLATED_INSPECTION_REQUEST_KEYS.size ||
    !keys.every((k) => PERSISTED_ISOLATED_INSPECTION_REQUEST_KEYS.has(k))
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Persisted isolated inspection request failed strict 23-field closed schema validation.',
    };
  }

  if (
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
      errorCode: 'SECURITY_POSTURE_VIOLATION',
      errorMessage:
        'Isolated inspection request violated RECORDED_NOT_DISPATCHED or mandatory false security posture locks.',
    };
  }

  if (
    raw.schemaVersion !==
    LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage: 'Invalid schemaVersion in persisted isolated inspection request.',
    };
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage: 'Invalid receiptId in persisted isolated inspection request.',
    };
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentIdFromReceipt(
    raw.receiptId
  );
  if (raw.documentId !== expectedDocumentId) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage: 'Invalid documentId in persisted isolated inspection request.',
    };
  }

  if (
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Invalid sourceRevision in persisted isolated inspection request.',
    };
  }

  if (
    typeof raw.safetyCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.safetyCaseRevision) ||
    raw.safetyCaseRevision < 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Invalid safetyCaseRevision in persisted isolated inspection request.',
    };
  }

  if (
    typeof raw.effectiveHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
    raw.effectiveHumanCaseRevision < 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Invalid effectiveHumanCaseRevision in persisted isolated inspection request.',
    };
  }

  const derivedRequestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
    raw.receiptId,
    raw.sourceRevision,
    raw.safetyCaseRevision
  );
  const parsedRequestId = parseLibraryQuarantineIsolatedInspectionRequestId(
    raw.requestId
  );
  if (
    !parsedRequestId ||
    raw.requestId !== derivedRequestId ||
    (expectedRequestId !== undefined && raw.requestId !== expectedRequestId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'requestId must deterministically match <receiptId>_<sourceRevision>_<safetyCaseRevision>.',
    };
  }

  if (
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.catalogUpdatedAt) ||
    typeof raw.requestedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.requestedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Invalid UTC ISO-8601 timestamp in persisted isolated inspection request.',
    };
  }

  if (
    Date.parse(raw.requestedAt) < Date.parse(raw.sourceUpdatedAt) ||
    Date.parse(raw.requestedAt) < Date.parse(raw.catalogUpdatedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'requestedAt cannot precede sourceUpdatedAt or catalogUpdatedAt.',
    };
  }

  if (!isValidSha256Hex(raw.sourceSha256)) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Invalid sourceSha256 in persisted isolated inspection request.',
    };
  }

  const canonicalGeneration = parseCanonicalSafeGcsGeneration(
    raw.sourceGeneration
  );
  if (
    canonicalGeneration === null ||
    raw.sourceGeneration !== canonicalGeneration
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'sourceGeneration must be a non-empty canonical GCS generation string.',
    };
  }

  if (
    typeof raw.sourceByteSize !== 'number' ||
    !Number.isSafeInteger(raw.sourceByteSize) ||
    raw.sourceByteSize < 1 ||
    raw.sourceByteSize > LIBRARY_UPLOAD_MAX_BYTES
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Invalid sourceByteSize in persisted isolated inspection request.',
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
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'sourceFormat and deepInspectionStatus must form a valid quarantine pair.',
    };
  }

  if (
    typeof raw.requestedBy !== 'string' ||
    !isValidUploaderUid(raw.requestedBy)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA',
      errorMessage:
        'Invalid requestedBy UID in persisted isolated inspection request.',
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
      requestId: derivedRequestId,
      receiptId: raw.receiptId,
      documentId: expectedDocumentId,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
      sourceGeneration: canonicalGeneration,
      sourceByteSize: raw.sourceByteSize,
      sourceFormat: raw.sourceFormat,
      deepInspectionStatus:
        raw.deepInspectionStatus as LibraryQuarantineBinarySafetyDeepInspectionStatus,
      safetyCaseRevision: raw.safetyCaseRevision,
      effectiveHumanCaseRevision: raw.effectiveHumanCaseRevision,
      catalogUpdatedAt: raw.catalogUpdatedAt,
      requestedBy: raw.requestedBy,
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

export function arePersistedIsolatedInspectionRequestsIncompatible(
  persisted: LibraryQuarantinePersistedIsolatedInspectionRequest,
  expected: {
    readonly requestId: string;
    readonly receiptId: string;
    readonly documentId: string;
    readonly sourceRevision: number;
    readonly sourceUpdatedAt: string;
    readonly sourceSha256: string;
    readonly sourceGeneration: string;
    readonly sourceByteSize: number;
    readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
    readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
    readonly safetyCaseRevision: number;
    readonly effectiveHumanCaseRevision: number;
    readonly catalogUpdatedAt: string;
  }
): boolean {
  return (
    persisted.requestId !== expected.requestId ||
    persisted.receiptId !== expected.receiptId ||
    persisted.documentId !== expected.documentId ||
    persisted.sourceRevision !== expected.sourceRevision ||
    persisted.sourceUpdatedAt !== expected.sourceUpdatedAt ||
    persisted.sourceSha256 !== expected.sourceSha256 ||
    persisted.sourceGeneration !== expected.sourceGeneration ||
    persisted.sourceByteSize !== expected.sourceByteSize ||
    persisted.sourceFormat !== expected.sourceFormat ||
    persisted.deepInspectionStatus !== expected.deepInspectionStatus ||
    persisted.safetyCaseRevision !== expected.safetyCaseRevision ||
    persisted.effectiveHumanCaseRevision !==
      expected.effectiveHumanCaseRevision ||
    persisted.catalogUpdatedAt !== expected.catalogUpdatedAt ||
    persisted.state !== LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE ||
    persisted.dispatched !== false ||
    persisted.scanPerformed !== false ||
    persisted.sanitized !== false ||
    persisted.isVerifiedSafe !== false ||
    persisted.isPublished !== false ||
    persisted.isReadyForPeia !== false
  );
}

export function toSanitizedLibraryQuarantineIsolatedInspectionRequestDto(
  persisted: LibraryQuarantinePersistedIsolatedInspectionRequest
): SanitizedLibraryQuarantineIsolatedInspectionRequestDto {
  const validated =
    validatePersistedLibraryQuarantineIsolatedInspectionRequest(persisted);
  if (!validated.ok) {
    throw new Error(`${validated.errorCode}: ${validated.errorMessage}`);
  }
  const r = validated.value;
  const dto: SanitizedLibraryQuarantineIsolatedInspectionRequestDto =
    Object.freeze({
      schemaVersion: r.schemaVersion,
      requestId: r.requestId,
      receiptId: r.receiptId,
      documentId: r.documentId,
      sourceRevision: r.sourceRevision,
      sourceUpdatedAt: r.sourceUpdatedAt,
      sourceFormat: r.sourceFormat,
      deepInspectionStatus: r.deepInspectionStatus,
      safetyCaseRevision: r.safetyCaseRevision,
      effectiveHumanCaseRevision: r.effectiveHumanCaseRevision,
      catalogUpdatedAt: r.catalogUpdatedAt,
      requestedAt: r.requestedAt,
      state: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
      dispatched: false,
      scanPerformed: false,
      sanitized: false,
      isVerifiedSafe: false,
      isPublished: false,
      isReadyForPeia: false,
    });

  const dtoKeys = Object.keys(dto);
  if (
    dtoKeys.length !== SANITIZED_ISOLATED_INSPECTION_REQUEST_DTO_KEYS.size ||
    !dtoKeys.every((k) => SANITIZED_ISOLATED_INSPECTION_REQUEST_DTO_KEYS.has(k))
  ) {
    throw new Error(
      'INVALID_SANITIZED_INSPECTION_REQUEST_DTO: Sanitized DTO key set mismatch.'
    );
  }

  return dto;
}
