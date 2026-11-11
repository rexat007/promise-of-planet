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
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  parseLibraryQuarantineIsolatedInspectionRequestId,
} from './libraryQuarantineIsolatedInspectionRequestContract';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import { parseCanonicalSafeGcsGeneration } from './gcsLibraryQuarantineStorageAdapter';
import { MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES } from './libraryUploadBinaryAdmission';

export type {
  LibraryQuarantineBinarySafetyDeepInspectionStatus,
  LibraryQuarantineBinarySafetySourceFormat,
  LibraryQuarantineReadinessIndicatorsDto,
};
export {
  deriveQuarantineCatalogDocumentIdFromReceipt,
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  parseLibraryQuarantineIsolatedInspectionRequestId,
};

export const LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION =
  'library_quarantine_av_executions' as const;

export const LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL =
  'START_REAL_ISOLATED_AV_SCAN' as const;

export type LibraryQuarantineAvDispatchConfirmationLiteral =
  typeof LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL;

export const QUARANTINE_AV_EXECUTION_READINESS_INDICATORS: LibraryQuarantineReadinessIndicatorsDto =
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS;

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

const ALLOWED_EXECUTION_STATES_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_AV_EXECUTION_STATES
);

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

const ALLOWED_FAILURE_REASON_CODES_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_AV_EXECUTION_FAILURE_REASON_CODES
);

const PERSISTED_AV_EXECUTION_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'requestId',
  'receiptId',
  'documentId',
  'revision',
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
  'state',
  'dispatchedBy',
  'dispatchedAt',
  'workerRunId',
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

const SANITIZED_AV_EXECUTION_DTO_KEYS: ReadonlySet<string> = new Set([
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

const SAFE_ENGINE_METADATA_TOKEN_REGEX = /^[A-Za-z0-9._:+/ -]{1,80}$/;
const SAFE_WORKER_RUN_ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isValidAvExecutionState(
  value: unknown
): value is LibraryQuarantineAvExecutionState {
  return typeof value === 'string' && ALLOWED_EXECUTION_STATES_SET.has(value);
}

export function isValidAvExecutionFailureReasonCode(
  value: unknown
): value is LibraryQuarantineAvExecutionFailureReasonCode {
  return (
    typeof value === 'string' && ALLOWED_FAILURE_REASON_CODES_SET.has(value)
  );
}

export function isValidDispatchAvInspectionConfirmation(
  value: unknown
): value is LibraryQuarantineAvDispatchConfirmationLiteral {
  return value === LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL;
}

export function isValidSafeEngineToken(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (!SAFE_ENGINE_METADATA_TOKEN_REGEX.test(value)) {
    return false;
  }
  const lower = value.toLowerCase();
  if (
    lower.includes('http:') ||
    lower.includes('https:') ||
    lower.includes('gs:') ||
    lower.includes('..') ||
    lower.includes('/quarantine/') ||
    lower.includes('library/quarantine')
  ) {
    return false;
  }
  return true;
}

export function isValidWorkerRunId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_WORKER_RUN_ID_REGEX.test(value);
}

export interface LibraryQuarantinePersistedAvExecution {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION;
  readonly requestId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
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
  readonly state: LibraryQuarantineAvExecutionState;
  readonly dispatchedBy: string;
  readonly dispatchedAt: string;
  readonly workerRunId: string | null;
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

export type LibraryQuarantineAvExecutionContractErrorCode =
  | 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA'
  | 'INVALID_SANITIZED_AV_EXECUTION_DTO'
  | 'SECURITY_POSTURE_VIOLATION';

export interface ValidatePersistedAvExecutionSuccess {
  readonly ok: true;
  readonly value: LibraryQuarantinePersistedAvExecution;
}

export interface ValidateAvExecutionContractFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineAvExecutionContractErrorCode;
  readonly errorMessage: string;
}

export type ValidatePersistedAvExecutionResult =
  | ValidatePersistedAvExecutionSuccess
  | ValidateAvExecutionContractFailure;

export function validatePersistedLibraryQuarantineAvExecution(
  raw: unknown,
  expectedRequestId?: string
): ValidatePersistedAvExecutionResult {
  if (!isPlainRecord(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage:
        'Persisted AV execution record must be a plain object without symbol properties.',
    };
  }

  const keys = Object.keys(raw);
  if (
    keys.length !== PERSISTED_AV_EXECUTION_KEYS.size ||
    !keys.every((k) => PERSISTED_AV_EXECUTION_KEYS.has(k))
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage:
        'Persisted AV execution record failed strict 33-field closed schema validation.',
    };
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false
  ) {
    return {
      ok: false,
      errorCode: 'SECURITY_POSTURE_VIOLATION',
      errorMessage:
        'Persisted AV execution record violated mandatory false security posture locks.',
    };
  }

  if (raw.schemaVersion !== LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid schemaVersion in persisted AV execution record.',
    };
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid receiptId in persisted AV execution record.',
    };
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentIdFromReceipt(
    raw.receiptId
  );
  if (raw.documentId !== expectedDocumentId) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid documentId in persisted AV execution record.',
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
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid revision numbers in persisted AV execution record.',
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
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage:
        'requestId must deterministically match <receiptId>_<sourceRevision>_<safetyCaseRevision>.',
    };
  }

  if (
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.catalogUpdatedAt) ||
    typeof raw.dispatchedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.dispatchedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid timestamp in persisted AV execution record.',
    };
  }

  if (
    Date.parse(raw.dispatchedAt) < Date.parse(raw.sourceUpdatedAt) ||
    Date.parse(raw.dispatchedAt) < Date.parse(raw.catalogUpdatedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage:
        'dispatchedAt cannot precede sourceUpdatedAt or catalogUpdatedAt.',
    };
  }

  if (!isValidSha256Hex(raw.sourceSha256)) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid sourceSha256 in persisted AV execution record.',
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
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid sourceGeneration in persisted AV execution record.',
    };
  }

  if (
    typeof raw.sourceByteSize !== 'number' ||
    !Number.isSafeInteger(raw.sourceByteSize) ||
    raw.sourceByteSize < 1 ||
    raw.sourceByteSize > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid sourceByteSize in persisted AV execution record.',
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
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage:
        'sourceFormat and deepInspectionStatus must form a valid quarantine pair.',
    };
  }

  if (!isValidAvExecutionState(raw.state)) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid state in persisted AV execution record.',
    };
  }

  if (
    typeof raw.dispatchedBy !== 'string' ||
    !isValidUploaderUid(raw.dispatchedBy)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid dispatchedBy UID in persisted AV execution record.',
    };
  }

  if (raw.workerRunId !== null && !isValidWorkerRunId(raw.workerRunId)) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid workerRunId in persisted AV execution record.',
    };
  }

  if (
    raw.workerClaimedAt !== null &&
    (typeof raw.workerClaimedAt !== 'string' ||
      !isValidIsoUtcTimestamp(raw.workerClaimedAt) ||
      Date.parse(raw.workerClaimedAt) < Date.parse(raw.dispatchedAt))
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid workerClaimedAt in persisted AV execution record.',
    };
  }

  if (
    raw.completedAt !== null &&
    (typeof raw.completedAt !== 'string' ||
      !isValidIsoUtcTimestamp(raw.completedAt) ||
      Date.parse(raw.completedAt) < Date.parse(raw.dispatchedAt))
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid completedAt in persisted AV execution record.',
    };
  }

  if (raw.engineName !== null && raw.engineName !== 'ClamAV') {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid engineName in persisted AV execution record.',
    };
  }

  if (
    raw.engineVersion !== null &&
    !isValidSafeEngineToken(raw.engineVersion)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid engineVersion in persisted AV execution record.',
    };
  }

  if (
    raw.signatureVersion !== null &&
    !isValidSafeEngineToken(raw.signatureVersion)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid signatureVersion in persisted AV execution record.',
    };
  }

  if (
    raw.signatureUpdatedAt !== null &&
    (typeof raw.signatureUpdatedAt !== 'string' ||
      !isValidIsoUtcTimestamp(raw.signatureUpdatedAt))
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage:
        'Invalid signatureUpdatedAt in persisted AV execution record.',
    };
  }

  if (
    raw.scannedBytes !== null &&
    (typeof raw.scannedBytes !== 'number' ||
      !Number.isSafeInteger(raw.scannedBytes) ||
      raw.scannedBytes < 0 ||
      raw.scannedBytes > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid scannedBytes in persisted AV execution record.',
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
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid exitCode in persisted AV execution record.',
    };
  }

  if (
    raw.failureReasonCode !== null &&
    !isValidAvExecutionFailureReasonCode(raw.failureReasonCode)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
      errorMessage: 'Invalid failureReasonCode in persisted AV execution record.',
    };
  }

  // State-specific invariants
  if (raw.state === 'AV_NO_THREAT_DETECTED') {
    if (
      raw.engineName !== 'ClamAV' ||
      raw.engineVersion === null ||
      raw.signatureVersion === null ||
      raw.signatureUpdatedAt === null ||
      raw.scannedBytes !== raw.sourceByteSize ||
      raw.exitCode !== 0 ||
      raw.completedAt === null ||
      raw.failureReasonCode !== null
    ) {
      return {
        ok: false,
        errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
        errorMessage:
          'AV_NO_THREAT_DETECTED requires ClamAV metadata, exitCode 0, scannedBytes === sourceByteSize, completedAt, and failureReasonCode null.',
      };
    }
  } else if (raw.state === 'AV_THREAT_DETECTED') {
    if (
      raw.engineName !== 'ClamAV' ||
      raw.engineVersion === null ||
      raw.signatureVersion === null ||
      raw.signatureUpdatedAt === null ||
      raw.scannedBytes !== raw.sourceByteSize ||
      raw.exitCode !== 1 ||
      raw.completedAt === null ||
      raw.failureReasonCode !== null
    ) {
      return {
        ok: false,
        errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
        errorMessage:
          'AV_THREAT_DETECTED requires ClamAV metadata, exitCode 1, scannedBytes === sourceByteSize, completedAt, and failureReasonCode null.',
      };
    }
  } else if (
    raw.state === 'AV_SCAN_FAILED' ||
    raw.state === 'DISPATCH_FAILED' ||
    raw.state === 'STALE_HOLD'
  ) {
    if (raw.failureReasonCode === null || raw.completedAt === null) {
      return {
        ok: false,
        errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
        errorMessage: `${raw.state} requires a non-null failureReasonCode and completedAt.`,
      };
    }
  } else if (raw.state === 'RUNNING') {
    if (
      raw.workerRunId === null ||
      raw.workerClaimedAt === null ||
      raw.completedAt !== null
    ) {
      return {
        ok: false,
        errorCode: 'INVALID_PERSISTED_AV_EXECUTION_SCHEMA',
        errorMessage:
          'RUNNING state requires workerRunId and workerClaimedAt with completedAt null.',
      };
    }
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
      requestId: derivedRequestId,
      receiptId: raw.receiptId,
      documentId: expectedDocumentId,
      revision: raw.revision,
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
      state: raw.state,
      dispatchedBy: raw.dispatchedBy,
      dispatchedAt: raw.dispatchedAt,
      workerRunId: raw.workerRunId,
      workerClaimedAt: raw.workerClaimedAt,
      completedAt: raw.completedAt,
      engineName: raw.engineName,
      engineVersion: raw.engineVersion,
      signatureVersion: raw.signatureVersion,
      signatureUpdatedAt: raw.signatureUpdatedAt,
      scannedBytes: raw.scannedBytes,
      exitCode: raw.exitCode,
      failureReasonCode: raw.failureReasonCode,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    }),
  };
}

export function arePersistedAvExecutionProvenanceIncompatible(
  persisted: LibraryQuarantinePersistedAvExecution,
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
    persisted.isSanitized !== false ||
    persisted.isVerifiedSafe !== false ||
    persisted.isRightsApproved !== false ||
    persisted.isPublished !== false ||
    persisted.isReadyForPeia !== false
  );
}

export function toSanitizedLibraryQuarantineAvExecutionDto(
  persisted: LibraryQuarantinePersistedAvExecution
): SanitizedLibraryQuarantineAvExecutionDto {
  const validated = validatePersistedLibraryQuarantineAvExecution(persisted);
  if (!validated.ok) {
    throw new Error(`${validated.errorCode}: ${validated.errorMessage}`);
  }
  const e = validated.value;
  const dto: SanitizedLibraryQuarantineAvExecutionDto = Object.freeze({
    schemaVersion: e.schemaVersion,
    requestId: e.requestId,
    receiptId: e.receiptId,
    documentId: e.documentId,
    revision: e.revision,
    sourceRevision: e.sourceRevision,
    sourceUpdatedAt: e.sourceUpdatedAt,
    sourceFormat: e.sourceFormat,
    deepInspectionStatus: e.deepInspectionStatus,
    safetyCaseRevision: e.safetyCaseRevision,
    effectiveHumanCaseRevision: e.effectiveHumanCaseRevision,
    catalogUpdatedAt: e.catalogUpdatedAt,
    state: e.state,
    dispatchedAt: e.dispatchedAt,
    workerClaimedAt: e.workerClaimedAt,
    completedAt: e.completedAt,
    engineName: e.engineName,
    engineVersion: e.engineVersion,
    signatureVersion: e.signatureVersion,
    signatureUpdatedAt: e.signatureUpdatedAt,
    scannedBytes: e.scannedBytes,
    exitCode: e.exitCode,
    failureReasonCode: e.failureReasonCode,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });

  const dtoKeys = Object.keys(dto);
  if (
    dtoKeys.length !== SANITIZED_AV_EXECUTION_DTO_KEYS.size ||
    !dtoKeys.every((k) => SANITIZED_AV_EXECUTION_DTO_KEYS.has(k))
  ) {
    throw new Error(
      'INVALID_SANITIZED_AV_EXECUTION_DTO: Sanitized AV execution DTO key set mismatch.'
    );
  }

  return dto;
}
