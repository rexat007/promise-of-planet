export const PEIA_MAX_MODEL_ATTEMPTS = 2;

export const TaskProcessingState = {
  READY: 'READY',
  PROCESSING: 'PROCESSING',
  ADVISORY_PENDING_UPLOAD: 'ADVISORY_PENDING_UPLOAD',
  NON_ADVISORY_PENDING_REPORT: 'NON_ADVISORY_PENDING_REPORT',
  COMPLETED: 'COMPLETED',
} as const;

export type TaskProcessingState =
  typeof TaskProcessingState[keyof typeof TaskProcessingState];

export const TaskProcessingTerminalOutcome = {
  ABSTAINED: 'ABSTAINED',
  MODEL_FAILURE: 'MODEL_FAILURE',
} as const;

export type TaskProcessingTerminalOutcome =
  typeof TaskProcessingTerminalOutcome[keyof typeof TaskProcessingTerminalOutcome];

export interface TaskProcessingRecord {
  readonly taskId: string;
  readonly state: TaskProcessingState;
  readonly modelAttempts: number;
  readonly terminalOutcome: TaskProcessingTerminalOutcome | null;
  readonly updatedAt: string;
}

export type LocalTaskProcessingLifecycleContractErrorCode =
  | 'INVALID_PROCESSING_RECORD'
  | 'INVALID_TASK_ID'
  | 'INVALID_STATE'
  | 'INVALID_MODEL_ATTEMPTS'
  | 'INVALID_TERMINAL_OUTCOME'
  | 'STATE_INVARIANT_VIOLATION'
  | 'INVALID_STATE_TRANSITION'
  | 'MAX_MODEL_ATTEMPTS_EXCEEDED';

export class LocalTaskProcessingLifecycleContractError extends Error {
  readonly code: LocalTaskProcessingLifecycleContractErrorCode;

  constructor(
    code: LocalTaskProcessingLifecycleContractErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'LocalTaskProcessingLifecycleContractError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const ALLOWED_STATES = new Set<string>(Object.values(TaskProcessingState));
const ALLOWED_TERMINAL_OUTCOMES = new Set<string>(
  Object.values(TaskProcessingTerminalOutcome)
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a TaskProcessingRecord against structural requirements and state-specific invariants.
 */
export function validateTaskProcessingRecord(
  input: unknown
): TaskProcessingRecord {
  if (!isPlainObject(input)) {
    throw new LocalTaskProcessingLifecycleContractError(
      'INVALID_PROCESSING_RECORD',
      'Processing record must be a plain object.'
    );
  }

  const keys = Object.keys(input);
  const expectedKeys = [
    'taskId',
    'state',
    'modelAttempts',
    'terminalOutcome',
    'updatedAt',
  ];

  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((k) => Object.prototype.hasOwnProperty.call(input, k))
  ) {
    throw new LocalTaskProcessingLifecycleContractError(
      'INVALID_PROCESSING_RECORD',
      'Processing record must contain exactly: taskId, state, modelAttempts, terminalOutcome, updatedAt.'
    );
  }

  const { taskId, state, modelAttempts, terminalOutcome, updatedAt } = input;

  // Validate taskId
  if (
    typeof taskId !== 'string' ||
    taskId.length === 0 ||
    taskId !== taskId.trim()
  ) {
    throw new LocalTaskProcessingLifecycleContractError(
      'INVALID_TASK_ID',
      'taskId must be a non-empty trimmed string.'
    );
  }

  // Validate state
  if (typeof state !== 'string' || !ALLOWED_STATES.has(state)) {
    throw new LocalTaskProcessingLifecycleContractError(
      'INVALID_STATE',
      `state must be one of: ${Array.from(ALLOWED_STATES).join(', ')}.`
    );
  }

  // Validate modelAttempts
  if (
    typeof modelAttempts !== 'number' ||
    !Number.isInteger(modelAttempts) ||
    modelAttempts < 0
  ) {
    throw new LocalTaskProcessingLifecycleContractError(
      'INVALID_MODEL_ATTEMPTS',
      'modelAttempts must be a non-negative integer.'
    );
  }

  if (modelAttempts > PEIA_MAX_MODEL_ATTEMPTS) {
    throw new LocalTaskProcessingLifecycleContractError(
      'MAX_MODEL_ATTEMPTS_EXCEEDED',
      `modelAttempts (${modelAttempts}) exceeds maximum allowed of ${PEIA_MAX_MODEL_ATTEMPTS}.`
    );
  }

  // Validate terminalOutcome
  if (terminalOutcome !== null) {
    if (
      typeof terminalOutcome !== 'string' ||
      !ALLOWED_TERMINAL_OUTCOMES.has(terminalOutcome)
    ) {
      throw new LocalTaskProcessingLifecycleContractError(
        'INVALID_TERMINAL_OUTCOME',
        `terminalOutcome must be null or one of: ${Array.from(
          ALLOWED_TERMINAL_OUTCOMES
        ).join(', ')}.`
      );
    }
  }

  // Validate updatedAt
  if (
    typeof updatedAt !== 'string' ||
    updatedAt.length === 0 ||
    updatedAt !== updatedAt.trim()
  ) {
    throw new LocalTaskProcessingLifecycleContractError(
      'INVALID_PROCESSING_RECORD',
      'updatedAt must be a non-empty trimmed ISO-8601 string.'
    );
  }

  const typedState = state as TaskProcessingState;
  const typedOutcome = terminalOutcome as TaskProcessingTerminalOutcome | null;

  // Enforce State-Specific Invariants
  switch (typedState) {
    case TaskProcessingState.READY:
      if (modelAttempts !== 0) {
        throw new LocalTaskProcessingLifecycleContractError(
          'STATE_INVARIANT_VIOLATION',
          'READY state requires modelAttempts to be 0.'
        );
      }
      if (typedOutcome !== null) {
        throw new LocalTaskProcessingLifecycleContractError(
          'STATE_INVARIANT_VIOLATION',
          'READY state requires terminalOutcome to be null.'
        );
      }
      break;

    case TaskProcessingState.PROCESSING:
      if (modelAttempts < 1 || modelAttempts > PEIA_MAX_MODEL_ATTEMPTS) {
        throw new LocalTaskProcessingLifecycleContractError(
          'STATE_INVARIANT_VIOLATION',
          `PROCESSING state requires modelAttempts to be between 1 and ${PEIA_MAX_MODEL_ATTEMPTS}.`
        );
      }
      if (typedOutcome !== null) {
        throw new LocalTaskProcessingLifecycleContractError(
          'STATE_INVARIANT_VIOLATION',
          'PROCESSING state requires terminalOutcome to be null.'
        );
      }
      break;

    case TaskProcessingState.ADVISORY_PENDING_UPLOAD:
      if (modelAttempts < 1 || modelAttempts > PEIA_MAX_MODEL_ATTEMPTS) {
        throw new LocalTaskProcessingLifecycleContractError(
          'STATE_INVARIANT_VIOLATION',
          `ADVISORY_PENDING_UPLOAD state requires modelAttempts to be between 1 and ${PEIA_MAX_MODEL_ATTEMPTS}.`
        );
      }
      if (typedOutcome !== null) {
        throw new LocalTaskProcessingLifecycleContractError(
          'STATE_INVARIANT_VIOLATION',
          'ADVISORY_PENDING_UPLOAD state requires terminalOutcome to be null (advisory payload lives in advisory outbox).'
        );
      }
      break;

    case TaskProcessingState.NON_ADVISORY_PENDING_REPORT:
      if (typedOutcome === TaskProcessingTerminalOutcome.ABSTAINED) {
        if (modelAttempts < 0 || modelAttempts > PEIA_MAX_MODEL_ATTEMPTS) {
          throw new LocalTaskProcessingLifecycleContractError(
            'STATE_INVARIANT_VIOLATION',
            `NON_ADVISORY_PENDING_REPORT state with ABSTAINED outcome requires modelAttempts to be between 0 and ${PEIA_MAX_MODEL_ATTEMPTS}.`
          );
        }
      } else if (typedOutcome === TaskProcessingTerminalOutcome.MODEL_FAILURE) {
        if (modelAttempts < 1 || modelAttempts > PEIA_MAX_MODEL_ATTEMPTS) {
          throw new LocalTaskProcessingLifecycleContractError(
            'STATE_INVARIANT_VIOLATION',
            `NON_ADVISORY_PENDING_REPORT state with MODEL_FAILURE outcome requires modelAttempts to be between 1 and ${PEIA_MAX_MODEL_ATTEMPTS}.`
          );
        }
      } else {
        throw new LocalTaskProcessingLifecycleContractError(
          'STATE_INVARIANT_VIOLATION',
          'NON_ADVISORY_PENDING_REPORT state requires terminalOutcome to be ABSTAINED or MODEL_FAILURE.'
        );
      }
      break;

    case TaskProcessingState.COMPLETED:
      if (typedOutcome === null) {
        if (modelAttempts < 1 || modelAttempts > PEIA_MAX_MODEL_ATTEMPTS) {
          throw new LocalTaskProcessingLifecycleContractError(
            'STATE_INVARIANT_VIOLATION',
            `COMPLETED state with null outcome requires modelAttempts to be between 1 and ${PEIA_MAX_MODEL_ATTEMPTS}.`
          );
        }
      } else if (typedOutcome === TaskProcessingTerminalOutcome.ABSTAINED) {
        if (modelAttempts < 0 || modelAttempts > PEIA_MAX_MODEL_ATTEMPTS) {
          throw new LocalTaskProcessingLifecycleContractError(
            'STATE_INVARIANT_VIOLATION',
            `COMPLETED state with ABSTAINED outcome requires modelAttempts to be between 0 and ${PEIA_MAX_MODEL_ATTEMPTS}.`
          );
        }
      } else if (typedOutcome === TaskProcessingTerminalOutcome.MODEL_FAILURE) {
        if (modelAttempts < 1 || modelAttempts > PEIA_MAX_MODEL_ATTEMPTS) {
          throw new LocalTaskProcessingLifecycleContractError(
            'STATE_INVARIANT_VIOLATION',
            `COMPLETED state with MODEL_FAILURE outcome requires modelAttempts to be between 1 and ${PEIA_MAX_MODEL_ATTEMPTS}.`
          );
        }
      } else {
        throw new LocalTaskProcessingLifecycleContractError(
          'STATE_INVARIANT_VIOLATION',
          'COMPLETED state requires terminalOutcome to be null, ABSTAINED, or MODEL_FAILURE.'
        );
      }
      break;
  }

  return {
    taskId,
    state: typedState,
    modelAttempts,
    terminalOutcome: typedOutcome,
    updatedAt,
  };
}

/**
 * Validates whether a state transition from currentState to targetState is permitted.
 */
export function validateStateTransition(
  currentState: TaskProcessingState,
  targetState: TaskProcessingState
): void {
  const allowedTransitions: Record<TaskProcessingState, readonly TaskProcessingState[]> = {
    [TaskProcessingState.READY]: [
      TaskProcessingState.PROCESSING,
      TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
    ],
    [TaskProcessingState.PROCESSING]: [
      TaskProcessingState.PROCESSING, // Retry
      TaskProcessingState.ADVISORY_PENDING_UPLOAD,
      TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
    ],
    [TaskProcessingState.ADVISORY_PENDING_UPLOAD]: [
      TaskProcessingState.COMPLETED,
    ],
    [TaskProcessingState.NON_ADVISORY_PENDING_REPORT]: [
      TaskProcessingState.COMPLETED,
    ],
    [TaskProcessingState.COMPLETED]: [], // Terminal
  };

  const targets = allowedTransitions[currentState];
  if (!targets || !targets.includes(targetState)) {
    throw new LocalTaskProcessingLifecycleContractError(
      'INVALID_STATE_TRANSITION',
      `Transition from ${currentState} to ${targetState} is not allowed.`
    );
  }
}

/**
 * Checks structural equality of two TaskProcessingRecords.
 */
export function areTaskProcessingRecordsIdentical(
  a: TaskProcessingRecord,
  b: TaskProcessingRecord
): boolean {
  return (
    a.taskId === b.taskId &&
    a.state === b.state &&
    a.modelAttempts === b.modelAttempts &&
    a.terminalOutcome === b.terminalOutcome
  );
}
