import {
  type PEIAAdvisoryResult,
  validatePEIAAdvisoryResult,
} from './advisoryResultContract';

export const LocalAdvisoryResultOutboxState = {
  PendingUpload: 'PendingUpload',
} as const;

export type LocalAdvisoryResultOutboxState =
  typeof LocalAdvisoryResultOutboxState[keyof typeof LocalAdvisoryResultOutboxState];

export interface StoredAdvisoryResultRecord {
  readonly result: PEIAAdvisoryResult;
  readonly localState: typeof LocalAdvisoryResultOutboxState.PendingUpload;
}

export type LocalAdvisoryResultOutboxContractErrorCode =
  | 'INVALID_ADVISORY_RESULT'
  | 'INVALID_STORED_RECORD';

export class LocalAdvisoryResultOutboxContractError extends Error {
  readonly code: LocalAdvisoryResultOutboxContractErrorCode;

  constructor(code: LocalAdvisoryResultOutboxContractErrorCode) {
    super(
      code === 'INVALID_ADVISORY_RESULT'
        ? 'Invalid advisory result for local outbox.'
        : 'Stored advisory result record is invalid.'
    );
    this.name = 'LocalAdvisoryResultOutboxContractError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(obj);
  if (actualKeys.length !== expectedKeys.length) {
    return false;
  }
  return expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

export function createStoredAdvisoryResultRecord(
  result: PEIAAdvisoryResult
): StoredAdvisoryResultRecord {
  try {
    validatePEIAAdvisoryResult(result);
  } catch {
    throw new LocalAdvisoryResultOutboxContractError('INVALID_ADVISORY_RESULT');
  }

  return {
    result,
    localState: LocalAdvisoryResultOutboxState.PendingUpload,
  };
}

export function validateStoredAdvisoryResultRecord(
  input: unknown
): StoredAdvisoryResultRecord {
  if (!isPlainObject(input)) {
    throw new LocalAdvisoryResultOutboxContractError('INVALID_STORED_RECORD');
  }

  if (!hasExactKeys(input, ['result', 'localState'])) {
    throw new LocalAdvisoryResultOutboxContractError('INVALID_STORED_RECORD');
  }

  const { result, localState } = input;

  if (localState !== LocalAdvisoryResultOutboxState.PendingUpload) {
    throw new LocalAdvisoryResultOutboxContractError('INVALID_STORED_RECORD');
  }

  try {
    validatePEIAAdvisoryResult(result);
  } catch {
    throw new LocalAdvisoryResultOutboxContractError('INVALID_STORED_RECORD');
  }

  return input as StoredAdvisoryResultRecord;
}

function isStringArrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function isLibraryPreparationEqual(
  a: PEIAAdvisoryResult['libraryPreparation'],
  b: PEIAAdvisoryResult['libraryPreparation']
): boolean {
  if (a === undefined && b === undefined) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return (
    a.inputBasis === b.inputBasis &&
    a.suggestedTitleAr === b.suggestedTitleAr &&
    a.suggestedTitleEn === b.suggestedTitleEn &&
    a.suggestedIssuingOrganization === b.suggestedIssuingOrganization &&
    a.suggestedDocumentType === b.suggestedDocumentType &&
    a.suggestedSummaryAr === b.suggestedSummaryAr &&
    a.suggestedSummaryEn === b.suggestedSummaryEn &&
    isStringArrayEqual(a.suggestedEnvironmentalDomains, b.suggestedEnvironmentalDomains) &&
    isStringArrayEqual(a.suggestedTopicsAr, b.suggestedTopicsAr) &&
    isStringArrayEqual(a.suggestedTopicsEn, b.suggestedTopicsEn) &&
    isStringArrayEqual(a.provenanceObservationsAr, b.provenanceObservationsAr) &&
    isStringArrayEqual(a.provenanceObservationsEn, b.provenanceObservationsEn) &&
    isStringArrayEqual(a.uncertaintyNoticesAr, b.uncertaintyNoticesAr) &&
    isStringArrayEqual(a.uncertaintyNoticesEn, b.uncertaintyNoticesEn)
  );
}

export function isSameStoredAdvisoryResultRecord(
  a: StoredAdvisoryResultRecord,
  b: StoredAdvisoryResultRecord
): boolean {
  if (a === b) {
    return true;
  }

  if (a.localState !== b.localState) {
    return false;
  }

  if (a.result.schemaVersion !== b.result.schemaVersion) {
    return false;
  }

  if (a.result.humanReviewRequired !== b.result.humanReviewRequired) {
    return false;
  }

  const taskA = a.result.task;
  const taskB = b.result.task;

  if (
    taskA.taskId !== taskB.taskId ||
    taskA.taskType !== taskB.taskType ||
    taskA.target.targetType !== taskB.target.targetType ||
    taskA.target.targetId !== taskB.target.targetId ||
    taskA.target.sourceUpdatedAt !== taskB.target.sourceUpdatedAt
  ) {
    return false;
  }

  const assessA = a.result.assessment;
  const assessB = b.result.assessment;

  if (assessA.summary !== assessB.summary) {
    return false;
  }

  if (assessA.findings.length !== assessB.findings.length) {
    return false;
  }

  for (let i = 0; i < assessA.findings.length; i++) {
    const fA = assessA.findings[i];
    const fB = assessB.findings[i];

    if (
      fA.code !== fB.code ||
      fA.message !== fB.message ||
      fA.severity !== fB.severity
    ) {
      return false;
    }

    if (fA.evidenceIds.length !== fB.evidenceIds.length) {
      return false;
    }
    for (let j = 0; j < fA.evidenceIds.length; j++) {
      if (fA.evidenceIds[j] !== fB.evidenceIds[j]) {
        return false;
      }
    }
  }

  if (!isStringArrayEqual(a.result.recommendations, b.result.recommendations)) {
    return false;
  }

  if (!isStringArrayEqual(a.result.uncertainties, b.result.uncertainties)) {
    return false;
  }

  if (!isStringArrayEqual(a.result.limitations, b.result.limitations)) {
    return false;
  }

  if (!isLibraryPreparationEqual(a.result.libraryPreparation, b.result.libraryPreparation)) {
    return false;
  }

  return true;
}

/**
 * Local Advisory Result Outbox Repository interface.
 * 
 * SEMANTIC CONTRACT:
 * Future repository implementations MUST treat:
 * - same taskId + structurally identical record as idempotent.
 * - same taskId + structurally different record as conflict / fail-closed.
 */
export interface LocalAdvisoryResultOutboxRepository {
  save(record: StoredAdvisoryResultRecord): Promise<void>;
  findByTaskId(taskId: string): Promise<StoredAdvisoryResultRecord | null>;
  listPendingUpload(): Promise<readonly StoredAdvisoryResultRecord[]>;
}
