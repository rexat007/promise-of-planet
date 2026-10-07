export const NonAdvisoryOutcomeKind = {
  INPUT_FAILURE: 'INPUT_FAILURE',
  ABSTAINED: 'ABSTAINED',
  RETRIEVAL_FAILURE: 'RETRIEVAL_FAILURE',
  MODEL_FAILURE: 'MODEL_FAILURE',
} as const;

export type NonAdvisoryOutcomeKind =
  typeof NonAdvisoryOutcomeKind[keyof typeof NonAdvisoryOutcomeKind];

export interface PEIASourceFailureDetail {
  readonly sourceId: 'EPA' | 'NOAA';
  readonly errorCode: 'TRANSPORT_FAILURE' | 'INVALID_SOURCE_RESPONSE';
}

export interface InputFailureNonAdvisoryOutcome {
  readonly taskId: string;
  readonly kind: typeof NonAdvisoryOutcomeKind.INPUT_FAILURE;
  readonly reason:
    | 'MISSING_RETRIEVAL_QUERY'
    | 'INVALID_RETRIEVAL_QUERY'
    | 'INVALID_TASK_PAYLOAD';
  readonly modelAttempts: 0;
  readonly detail?: string;
  readonly createdAt: string;
}

export interface AbstainedNonAdvisoryOutcome {
  readonly taskId: string;
  readonly kind: typeof NonAdvisoryOutcomeKind.ABSTAINED;
  readonly reason:
    | 'NO_EVIDENCE'
    | 'INSUFFICIENT_EVIDENCE'
    | 'INVALID_MODEL_OUTPUT'
    | 'UNGROUNDED_MODEL_OUTPUT';
  readonly modelAttempts: number;
  readonly detail?: string;
  readonly createdAt: string;
}

export interface RetrievalFailureNonAdvisoryOutcome {
  readonly taskId: string;
  readonly kind: typeof NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE;
  readonly reason: 'TOTAL_RETRIEVAL_FAILURE';
  readonly modelAttempts: 0;
  readonly sourceFailures: readonly PEIASourceFailureDetail[];
  readonly detail?: string;
  readonly createdAt: string;
}

export interface ModelFailureNonAdvisoryOutcome {
  readonly taskId: string;
  readonly kind: typeof NonAdvisoryOutcomeKind.MODEL_FAILURE;
  readonly reason:
    | 'PROCESS_LAUNCH_FAILURE'
    | 'TIMEOUT'
    | 'NON_ZERO_EXIT'
    | 'UNUSABLE_PROCESS_OUTPUT'
    | 'PROCESS_ERROR';
  readonly modelAttempts: number;
  readonly exitCode?: number | null;
  readonly detail?: string;
  readonly createdAt: string;
}

export type DurableNonAdvisoryOutcomeRecord =
  | InputFailureNonAdvisoryOutcome
  | AbstainedNonAdvisoryOutcome
  | RetrievalFailureNonAdvisoryOutcome
  | ModelFailureNonAdvisoryOutcome;

export type LocalNonAdvisoryOutcomeContractErrorCode =
  | 'INVALID_OUTCOME_RECORD'
  | 'INVALID_TASK_ID'
  | 'INVALID_KIND'
  | 'INVALID_REASON'
  | 'INVALID_MODEL_ATTEMPTS'
  | 'INVALID_CREATED_AT'
  | 'INVALID_DETAIL'
  | 'INVALID_EXIT_CODE'
  | 'INVALID_SOURCE_FAILURES'
  | 'VARIANT_INVARIANT_VIOLATION';

export class LocalNonAdvisoryOutcomeContractError extends Error {
  readonly code: LocalNonAdvisoryOutcomeContractErrorCode;

  constructor(
    code: LocalNonAdvisoryOutcomeContractErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'LocalNonAdvisoryOutcomeContractError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

export function validateDurableNonAdvisoryOutcomeRecord(
  input: unknown
): DurableNonAdvisoryOutcomeRecord {
  if (!isPlainObject(input)) {
    throw new LocalNonAdvisoryOutcomeContractError(
      'INVALID_OUTCOME_RECORD',
      'Non-advisory outcome record must be a plain object.'
    );
  }

  const { taskId, kind, reason, modelAttempts, detail, exitCode, sourceFailures, createdAt } = input;

  // Validate taskId
  if (
    typeof taskId !== 'string' ||
    taskId.length === 0 ||
    taskId !== taskId.trim()
  ) {
    throw new LocalNonAdvisoryOutcomeContractError(
      'INVALID_TASK_ID',
      'taskId must be a non-empty trimmed string.'
    );
  }

  // Validate kind
  if (
    typeof kind !== 'string' ||
    !Object.values(NonAdvisoryOutcomeKind).includes(kind as any)
  ) {
    throw new LocalNonAdvisoryOutcomeContractError(
      'INVALID_KIND',
      'Invalid non-advisory outcome kind.'
    );
  }

  // Validate reason
  if (typeof reason !== 'string' || reason.length === 0 || reason !== reason.trim()) {
    throw new LocalNonAdvisoryOutcomeContractError(
      'INVALID_REASON',
      'reason must be a non-empty trimmed string.'
    );
  }

  // Validate modelAttempts
  if (
    typeof modelAttempts !== 'number' ||
    !Number.isInteger(modelAttempts) ||
    modelAttempts < 0
  ) {
    throw new LocalNonAdvisoryOutcomeContractError(
      'INVALID_MODEL_ATTEMPTS',
      'modelAttempts must be a non-negative integer.'
    );
  }

  // Validate createdAt
  if (!isValidIsoTimestamp(createdAt)) {
    throw new LocalNonAdvisoryOutcomeContractError(
      'INVALID_CREATED_AT',
      'createdAt must be a valid ISO timestamp string.'
    );
  }

  // Validate detail if present
  if (detail !== undefined) {
    if (
      typeof detail !== 'string' ||
      detail.length === 0 ||
      detail !== detail.trim()
    ) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_DETAIL',
        'detail must be a non-empty trimmed string if present.'
      );
    }
  }

  // Variant specific invariants
  if (kind === NonAdvisoryOutcomeKind.INPUT_FAILURE) {
    const validReasons = [
      'MISSING_RETRIEVAL_QUERY',
      'INVALID_RETRIEVAL_QUERY',
      'INVALID_TASK_PAYLOAD',
    ];
    if (!validReasons.includes(reason)) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_REASON',
        'Invalid reason for INPUT_FAILURE.'
      );
    }
    if (modelAttempts !== 0) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'VARIANT_INVARIANT_VIOLATION',
        'INPUT_FAILURE modelAttempts must be 0.'
      );
    }
    if (exitCode !== undefined) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_EXIT_CODE',
        'exitCode is not allowed for INPUT_FAILURE.'
      );
    }
    if (sourceFailures !== undefined) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_SOURCE_FAILURES',
        'sourceFailures is not allowed for INPUT_FAILURE.'
      );
    }
    const expectedKeys = ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', ...(detail !== undefined ? ['detail'] : [])];
    const actualKeys = Object.keys(input);
    if (actualKeys.length !== expectedKeys.length || !expectedKeys.every(k => actualKeys.includes(k))) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_OUTCOME_RECORD',
        'Invalid keys for INPUT_FAILURE record.'
      );
    }
  } else if (kind === NonAdvisoryOutcomeKind.ABSTAINED) {
    const validReasons = [
      'NO_EVIDENCE',
      'INSUFFICIENT_EVIDENCE',
      'INVALID_MODEL_OUTPUT',
      'UNGROUNDED_MODEL_OUTPUT',
    ];
    if (!validReasons.includes(reason)) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_REASON',
        'Invalid reason for ABSTAINED.'
      );
    }
    if (reason === 'NO_EVIDENCE' || reason === 'INSUFFICIENT_EVIDENCE') {
      if (modelAttempts !== 0) {
        throw new LocalNonAdvisoryOutcomeContractError(
          'VARIANT_INVARIANT_VIOLATION',
          `${reason} modelAttempts must be 0.`
        );
      }
    } else {
      if (modelAttempts !== 1 && modelAttempts !== 2) {
        throw new LocalNonAdvisoryOutcomeContractError(
          'VARIANT_INVARIANT_VIOLATION',
          `${reason} modelAttempts must be 1 or 2.`
        );
      }
    }
    if (exitCode !== undefined) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_EXIT_CODE',
        'exitCode is not allowed for ABSTAINED.'
      );
    }
    if (sourceFailures !== undefined) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_SOURCE_FAILURES',
        'sourceFailures is not allowed for ABSTAINED.'
      );
    }
    const expectedKeys = ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', ...(detail !== undefined ? ['detail'] : [])];
    const actualKeys = Object.keys(input);
    if (actualKeys.length !== expectedKeys.length || !expectedKeys.every(k => actualKeys.includes(k))) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_OUTCOME_RECORD',
        'Invalid keys for ABSTAINED record.'
      );
    }
  } else if (kind === NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE) {
    if (reason !== 'TOTAL_RETRIEVAL_FAILURE') {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_REASON',
        'RETRIEVAL_FAILURE reason must be TOTAL_RETRIEVAL_FAILURE.'
      );
    }
    if (modelAttempts !== 0) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'VARIANT_INVARIANT_VIOLATION',
        'RETRIEVAL_FAILURE modelAttempts must be 0.'
      );
    }
    if (exitCode !== undefined) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_EXIT_CODE',
        'exitCode is not allowed for RETRIEVAL_FAILURE.'
      );
    }
    if (!Array.isArray(sourceFailures) || sourceFailures.length === 0) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_SOURCE_FAILURES',
        'sourceFailures must be a non-empty array for RETRIEVAL_FAILURE.'
      );
    }
    const seenSources = new Set<string>();
    for (const sf of sourceFailures) {
      if (!isPlainObject(sf)) {
        throw new LocalNonAdvisoryOutcomeContractError(
          'INVALID_SOURCE_FAILURES',
          'Source failure item must be a plain object.'
        );
      }
      const { sourceId, errorCode } = sf;
      if (sourceId !== 'EPA' && sourceId !== 'NOAA') {
        throw new LocalNonAdvisoryOutcomeContractError(
          'INVALID_SOURCE_FAILURES',
          'Invalid sourceId in sourceFailures.'
        );
      }
      if (errorCode !== 'TRANSPORT_FAILURE' && errorCode !== 'INVALID_SOURCE_RESPONSE') {
        throw new LocalNonAdvisoryOutcomeContractError(
          'INVALID_SOURCE_FAILURES',
          'Invalid errorCode in sourceFailures.'
        );
      }
      if (seenSources.has(sourceId)) {
        throw new LocalNonAdvisoryOutcomeContractError(
          'INVALID_SOURCE_FAILURES',
          'Duplicate sourceId in sourceFailures.'
        );
      }
      seenSources.add(sourceId);
    }
    if (
      sourceFailures.length !== 2 ||
      !seenSources.has('EPA') ||
      !seenSources.has('NOAA')
    ) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_SOURCE_FAILURES',
        'TOTAL_RETRIEVAL_FAILURE requires exactly one EPA and one NOAA source failure.'
      );
    }
    const expectedKeys = ['taskId', 'kind', 'reason', 'modelAttempts', 'sourceFailures', 'createdAt', ...(detail !== undefined ? ['detail'] : [])];
    const actualKeys = Object.keys(input);
    if (actualKeys.length !== expectedKeys.length || !expectedKeys.every(k => actualKeys.includes(k))) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_OUTCOME_RECORD',
        'Invalid keys for RETRIEVAL_FAILURE record.'
      );
    }
  } else if (kind === NonAdvisoryOutcomeKind.MODEL_FAILURE) {
    const validReasons = [
      'PROCESS_LAUNCH_FAILURE',
      'TIMEOUT',
      'NON_ZERO_EXIT',
      'UNUSABLE_PROCESS_OUTPUT',
      'PROCESS_ERROR',
    ];
    if (!validReasons.includes(reason)) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_REASON',
        'Invalid reason for MODEL_FAILURE.'
      );
    }
    if (modelAttempts !== 1 && modelAttempts !== 2) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'VARIANT_INVARIANT_VIOLATION',
        'MODEL_FAILURE modelAttempts must be 1 or 2.'
      );
    }
    if (sourceFailures !== undefined) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_SOURCE_FAILURES',
        'sourceFailures is not allowed for MODEL_FAILURE.'
      );
    }
    if (exitCode !== undefined && exitCode !== null) {
      if (typeof exitCode !== 'number' || !Number.isInteger(exitCode)) {
        throw new LocalNonAdvisoryOutcomeContractError(
          'INVALID_EXIT_CODE',
          'exitCode must be an integer or null if present.'
        );
      }
    }
    const expectedKeys = ['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', ...(exitCode !== undefined ? ['exitCode'] : []), ...(detail !== undefined ? ['detail'] : [])];
    const actualKeys = Object.keys(input);
    if (actualKeys.length !== expectedKeys.length || !expectedKeys.every(k => actualKeys.includes(k))) {
      throw new LocalNonAdvisoryOutcomeContractError(
        'INVALID_OUTCOME_RECORD',
        'Invalid keys for MODEL_FAILURE record.'
      );
    }
  }

  return input as DurableNonAdvisoryOutcomeRecord;
}

export function isSameDurableNonAdvisoryOutcomeRecord(
  a: DurableNonAdvisoryOutcomeRecord,
  b: DurableNonAdvisoryOutcomeRecord
): boolean {
  if (a === b) {
    return true;
  }
  if (
    a.taskId !== b.taskId ||
    a.kind !== b.kind ||
    a.reason !== b.reason ||
    a.modelAttempts !== b.modelAttempts ||
    a.createdAt !== b.createdAt ||
    a.detail !== b.detail
  ) {
    return false;
  }

  if (a.kind === 'MODEL_FAILURE' && b.kind === 'MODEL_FAILURE') {
    if (a.exitCode !== b.exitCode) {
      return false;
    }
  }

  if (a.kind === 'RETRIEVAL_FAILURE' && b.kind === 'RETRIEVAL_FAILURE') {
    if (a.sourceFailures.length !== b.sourceFailures.length) {
      return false;
    }
    for (let i = 0; i < a.sourceFailures.length; i++) {
      if (
        a.sourceFailures[i].sourceId !== b.sourceFailures[i].sourceId ||
        a.sourceFailures[i].errorCode !== b.sourceFailures[i].errorCode
      ) {
        return false;
      }
    }
  }

  return true;
}
