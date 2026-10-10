export interface SourceFailureRecord {
  readonly sourceId: 'EPA' | 'NOAA';
  readonly errorCode: 'TRANSPORT_FAILURE' | 'INVALID_SOURCE_RESPONSE';
}

export type NonAdvisoryOutcomeKind =
  | 'INPUT_FAILURE'
  | 'ABSTAINED'
  | 'RETRIEVAL_FAILURE'
  | 'MODEL_FAILURE';

export const NonAdvisoryOutcomeKindValues: readonly NonAdvisoryOutcomeKind[] = [
  'INPUT_FAILURE',
  'ABSTAINED',
  'RETRIEVAL_FAILURE',
  'MODEL_FAILURE',
] as const;

export interface CanonicalNonAdvisoryOutcome {
  readonly taskId: string;
  readonly kind: NonAdvisoryOutcomeKind;
  readonly reason: string;
  readonly modelAttempts: number;
  readonly createdAt: string;
  readonly detail?: string;
  readonly exitCode?: number | null;
  readonly sourceFailures?: readonly SourceFailureRecord[];
}

export interface NonAdvisoryOutcomeIntakeRequest {
  readonly outcome: CanonicalNonAdvisoryOutcome;
}

export type NonAdvisoryOutcomeContractErrorCode = 'INVALID_NON_ADVISORY_OUTCOME_INTAKE';

export class NonAdvisoryOutcomeContractError extends Error {
  readonly code: NonAdvisoryOutcomeContractErrorCode;

  constructor(
    code: NonAdvisoryOutcomeContractErrorCode = 'INVALID_NON_ADVISORY_OUTCOME_INTAKE',
    message: string = 'Invalid PEIA non-advisory task outcome intake request.'
  ) {
    super(message);
    this.name = 'NonAdvisoryOutcomeContractError';
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

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value;
}

function isValidIsoTimestamp(value: unknown): boolean {
  if (!isNonEmptyTrimmedString(value)) {
    return false;
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return false;
  }
  return date.toISOString() === value;
}

const VALID_INPUT_FAILURE_REASONS = new Set([
  'MISSING_RETRIEVAL_QUERY',
  'INVALID_RETRIEVAL_QUERY',
  'INVALID_TASK_PAYLOAD',
]);

const VALID_ABSTAINED_REASONS = new Set([
  'NO_EVIDENCE',
  'INSUFFICIENT_EVIDENCE',
  'INVALID_MODEL_OUTPUT',
  'UNGROUNDED_MODEL_OUTPUT',
]);

const VALID_MODEL_FAILURE_REASONS = new Set([
  'PROCESS_LAUNCH_FAILURE',
  'TIMEOUT',
  'NON_ZERO_EXIT',
  'UNUSABLE_PROCESS_OUTPUT',
  'PROCESS_ERROR',
  'INTERRUPTED_MODEL_ATTEMPT',
]);

const VALID_SOURCE_IDS = new Set(['EPA', 'NOAA']);
const VALID_SOURCE_ERROR_CODES = new Set(['TRANSPORT_FAILURE', 'INVALID_SOURCE_RESPONSE']);

export function validateNonAdvisoryOutcomeIntakeRequest(
  input: unknown
): NonAdvisoryOutcomeIntakeRequest {
  if (!isPlainObject(input)) {
    throw new NonAdvisoryOutcomeContractError();
  }

  if (!hasExactKeys(input, ['outcome'])) {
    throw new NonAdvisoryOutcomeContractError();
  }

  const { outcome } = input;

  if (!isPlainObject(outcome)) {
    throw new NonAdvisoryOutcomeContractError();
  }

  const { taskId, kind, reason, modelAttempts, createdAt, detail, exitCode, sourceFailures } = outcome;

  if (!isNonEmptyTrimmedString(taskId)) {
    throw new NonAdvisoryOutcomeContractError();
  }

  if (!isValidIsoTimestamp(createdAt)) {
    throw new NonAdvisoryOutcomeContractError();
  }

  if (detail !== undefined) {
    if (typeof detail !== 'string' || detail.trim() !== detail || detail.length === 0) {
      throw new NonAdvisoryOutcomeContractError();
    }
  }

  if (typeof kind !== 'string') {
    throw new NonAdvisoryOutcomeContractError();
  }

  if (kind === 'INPUT_FAILURE') {
    if (exitCode !== undefined || sourceFailures !== undefined) {
      throw new NonAdvisoryOutcomeContractError();
    }
    const expectedKeys = detail !== undefined
      ? ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'detail']
      : ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt'];
    if (!hasExactKeys(outcome, expectedKeys)) {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (typeof reason !== 'string' || !VALID_INPUT_FAILURE_REASONS.has(reason)) {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (modelAttempts !== 0) {
      throw new NonAdvisoryOutcomeContractError();
    }
  } else if (kind === 'ABSTAINED') {
    if (exitCode !== undefined || sourceFailures !== undefined) {
      throw new NonAdvisoryOutcomeContractError();
    }
    const expectedKeys = detail !== undefined
      ? ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'detail']
      : ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt'];
    if (!hasExactKeys(outcome, expectedKeys)) {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (typeof reason !== 'string' || !VALID_ABSTAINED_REASONS.has(reason)) {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (reason === 'NO_EVIDENCE' || reason === 'INSUFFICIENT_EVIDENCE') {
      if (modelAttempts !== 0) {
        throw new NonAdvisoryOutcomeContractError();
      }
    } else if (reason === 'INVALID_MODEL_OUTPUT' || reason === 'UNGROUNDED_MODEL_OUTPUT') {
      if (modelAttempts !== 1 && modelAttempts !== 2) {
        throw new NonAdvisoryOutcomeContractError();
      }
    } else {
      throw new NonAdvisoryOutcomeContractError();
    }
  } else if (kind === 'RETRIEVAL_FAILURE') {
    if (exitCode !== undefined) {
      throw new NonAdvisoryOutcomeContractError();
    }
    const expectedKeys = detail !== undefined
      ? ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'sourceFailures', 'detail']
      : ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'sourceFailures'];
    if (!hasExactKeys(outcome, expectedKeys)) {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (reason !== 'TOTAL_RETRIEVAL_FAILURE') {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (modelAttempts !== 0) {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (!Array.isArray(sourceFailures) || sourceFailures.length !== 2) {
      throw new NonAdvisoryOutcomeContractError();
    }
    const foundSources = new Set<string>();
    for (const sf of sourceFailures) {
      if (!isPlainObject(sf) || !hasExactKeys(sf, ['sourceId', 'errorCode'])) {
        throw new NonAdvisoryOutcomeContractError();
      }
      if (typeof sf.sourceId !== 'string' || !VALID_SOURCE_IDS.has(sf.sourceId)) {
        throw new NonAdvisoryOutcomeContractError();
      }
      if (typeof sf.errorCode !== 'string' || !VALID_SOURCE_ERROR_CODES.has(sf.errorCode)) {
        throw new NonAdvisoryOutcomeContractError();
      }
      if (foundSources.has(sf.sourceId)) {
        throw new NonAdvisoryOutcomeContractError(); // duplicate source
      }
      foundSources.add(sf.sourceId);
    }
    if (!foundSources.has('EPA') || !foundSources.has('NOAA')) {
      throw new NonAdvisoryOutcomeContractError();
    }
  } else if (kind === 'MODEL_FAILURE') {
    if (sourceFailures !== undefined) {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (typeof reason !== 'string' || !VALID_MODEL_FAILURE_REASONS.has(reason)) {
      throw new NonAdvisoryOutcomeContractError();
    }
    if (reason === 'INTERRUPTED_MODEL_ATTEMPT') {
      if (modelAttempts !== 2 || exitCode !== undefined || 'exitCode' in outcome) {
        throw new NonAdvisoryOutcomeContractError();
      }
      const expectedKeys = detail !== undefined
        ? ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'detail']
        : ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt'];
      if (!hasExactKeys(outcome, expectedKeys)) {
        throw new NonAdvisoryOutcomeContractError();
      }
    } else {
      if (modelAttempts !== 1 && modelAttempts !== 2) {
        throw new NonAdvisoryOutcomeContractError();
      }
      const hasExitCode = 'exitCode' in outcome || exitCode !== undefined;
      if (hasExitCode) {
        if (exitCode !== null && (typeof exitCode !== 'number' || !Number.isInteger(exitCode))) {
          throw new NonAdvisoryOutcomeContractError();
        }
        const expectedKeys = detail !== undefined
          ? ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'exitCode', 'detail']
          : ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'exitCode'];
        if (!hasExactKeys(outcome, expectedKeys)) {
          throw new NonAdvisoryOutcomeContractError();
        }
      } else {
        const expectedKeys = detail !== undefined
          ? ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'detail']
          : ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt'];
        if (!hasExactKeys(outcome, expectedKeys)) {
          throw new NonAdvisoryOutcomeContractError();
        }
      }
    }
  } else {
    throw new NonAdvisoryOutcomeContractError();
  }

  return input as unknown as NonAdvisoryOutcomeIntakeRequest;
}
