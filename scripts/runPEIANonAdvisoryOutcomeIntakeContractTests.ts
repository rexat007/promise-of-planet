import {
  validateNonAdvisoryOutcomeIntakeRequest,
  NonAdvisoryOutcomeContractError,
  CanonicalNonAdvisoryOutcome,
} from '../functions/src/peia/nonAdvisoryOutcomeIntakeContract';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

function assertThrows(fn: () => void, msg: string) {
  try {
    fn();
    console.error(`FAILED (expected throw): ${msg}`);
    process.exit(1);
  } catch (err) {
    assert(err instanceof NonAdvisoryOutcomeContractError, `Expected NonAdvisoryOutcomeContractError: ${msg}`);
  }
}

console.log('--- Running PEIA Non-Advisory Outcome Intake Contract Tests ---');

const now = new Date().toISOString();

// 1. INPUT_FAILURE variants
const validInputFailure1 = {
  outcome: {
    taskId: 'task-100',
    kind: 'INPUT_FAILURE',
    reason: 'MISSING_RETRIEVAL_QUERY',
    modelAttempts: 0,
    createdAt: now,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validInputFailure1);

const validInputFailure2 = {
  outcome: {
    taskId: 'task-100',
    kind: 'INPUT_FAILURE',
    reason: 'INVALID_TASK_PAYLOAD',
    modelAttempts: 0,
    createdAt: now,
    detail: 'Malformed payload JSON',
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validInputFailure2);

// Reject INPUT_FAILURE with attempts > 0
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validInputFailure1.outcome, modelAttempts: 1 },
    }),
  'INPUT_FAILURE with modelAttempts > 0'
);

// Reject INPUT_FAILURE with exitCode or sourceFailures
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validInputFailure1.outcome, exitCode: 0 },
    }),
  'INPUT_FAILURE with exitCode'
);

// 2. ABSTAINED variants
const validAbstainedNoEvidence = {
  outcome: {
    taskId: 'task-101',
    kind: 'ABSTAINED',
    reason: 'NO_EVIDENCE',
    modelAttempts: 0,
    createdAt: now,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validAbstainedNoEvidence);

const validAbstainedUngrounded = {
  outcome: {
    taskId: 'task-101',
    kind: 'ABSTAINED',
    reason: 'UNGROUNDED_MODEL_OUTPUT',
    modelAttempts: 2,
    createdAt: now,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validAbstainedUngrounded);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validAbstainedNoEvidence.outcome, modelAttempts: 1 },
    }),
  'ABSTAINED NO_EVIDENCE with attempts 1'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validAbstainedUngrounded.outcome, modelAttempts: 0 },
    }),
  'ABSTAINED UNGROUNDED_MODEL_OUTPUT with attempts 0'
);

// 3. RETRIEVAL_FAILURE variants
const validRetrievalFailure = {
  outcome: {
    taskId: 'task-102',
    kind: 'RETRIEVAL_FAILURE',
    reason: 'TOTAL_RETRIEVAL_FAILURE',
    modelAttempts: 0,
    createdAt: now,
    sourceFailures: [
      { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
      { sourceId: 'NOAA', errorCode: 'INVALID_SOURCE_RESPONSE' },
    ],
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validRetrievalFailure);

// Reversed order is valid
const validRetrievalFailureReversed = {
  outcome: {
    taskId: 'task-102',
    kind: 'RETRIEVAL_FAILURE',
    reason: 'TOTAL_RETRIEVAL_FAILURE',
    modelAttempts: 0,
    createdAt: now,
    sourceFailures: [
      { sourceId: 'NOAA', errorCode: 'INVALID_SOURCE_RESPONSE' },
      { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
    ],
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validRetrievalFailureReversed);

// Reject EPA only
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: {
        ...validRetrievalFailure.outcome,
        sourceFailures: [{ sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' }],
      },
    }),
  'RETRIEVAL_FAILURE with EPA only'
);

// Reject duplicate source
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: {
        ...validRetrievalFailure.outcome,
        sourceFailures: [
          { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
          { sourceId: 'EPA', errorCode: 'INVALID_SOURCE_RESPONSE' },
        ],
      },
    }),
  'RETRIEVAL_FAILURE with duplicate EPA'
);

// 4. MODEL_FAILURE variants
const validModelFailureOrdinaryWithExitCode = {
  outcome: {
    taskId: 'task-103',
    kind: 'MODEL_FAILURE',
    reason: 'NON_ZERO_EXIT',
    modelAttempts: 1,
    createdAt: now,
    exitCode: 137,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validModelFailureOrdinaryWithExitCode);

const validModelFailureOrdinaryWithNullExitCode = {
  outcome: {
    taskId: 'task-103',
    kind: 'MODEL_FAILURE',
    reason: 'NON_ZERO_EXIT',
    modelAttempts: 1,
    createdAt: now,
    exitCode: null,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validModelFailureOrdinaryWithNullExitCode);

const validModelFailureOrdinaryAbsentExitCode = {
  outcome: {
    taskId: 'task-103',
    kind: 'MODEL_FAILURE',
    reason: 'NON_ZERO_EXIT',
    modelAttempts: 1,
    createdAt: now,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validModelFailureOrdinaryAbsentExitCode);

const validModelFailureTimeout = {
  outcome: {
    taskId: 'task-103',
    kind: 'MODEL_FAILURE',
    reason: 'TIMEOUT',
    modelAttempts: 1,
    createdAt: now,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validModelFailureTimeout);

const validModelFailureTimeoutWithExitCode = {
  outcome: {
    taskId: 'task-103',
    kind: 'MODEL_FAILURE',
    reason: 'TIMEOUT',
    modelAttempts: 2,
    createdAt: now,
    exitCode: 124,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validModelFailureTimeoutWithExitCode);

const validModelFailureTimeoutWithNullExitCode = {
  outcome: {
    taskId: 'task-103',
    kind: 'MODEL_FAILURE',
    reason: 'TIMEOUT',
    modelAttempts: 2,
    createdAt: now,
    exitCode: null,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validModelFailureTimeoutWithNullExitCode);

// Reject ordinary MODEL_FAILURE with non-integer exitCode
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: {
        ...validModelFailureOrdinaryWithExitCode.outcome,
        exitCode: 1.5,
      },
    }),
  'Ordinary MODEL_FAILURE with exitCode 1.5'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: {
        ...validModelFailureOrdinaryWithExitCode.outcome,
        exitCode: '137' as unknown as number,
      },
    }),
  'Ordinary MODEL_FAILURE with exitCode string'
);

// Reject ordinary MODEL_FAILURE with modelAttempts = 0
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: {
        ...validModelFailureOrdinaryWithExitCode.outcome,
        modelAttempts: 0,
      },
    }),
  'Ordinary MODEL_FAILURE with modelAttempts 0'
);

const validModelFailureInterrupted = {
  outcome: {
    taskId: 'task-103',
    kind: 'MODEL_FAILURE',
    reason: 'INTERRUPTED_MODEL_ATTEMPT',
    modelAttempts: 2,
    createdAt: now,
  },
};
validateNonAdvisoryOutcomeIntakeRequest(validModelFailureInterrupted);

// Reject INTERRUPTED_MODEL_ATTEMPT with modelAttempts != 2
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validModelFailureInterrupted.outcome, modelAttempts: 0 },
    }),
  'INTERRUPTED_MODEL_ATTEMPT with modelAttempts 0'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validModelFailureInterrupted.outcome, modelAttempts: 1 },
    }),
  'INTERRUPTED_MODEL_ATTEMPT with modelAttempts 1'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validModelFailureInterrupted.outcome, modelAttempts: 3 },
    }),
  'INTERRUPTED_MODEL_ATTEMPT with modelAttempts 3'
);

// Reject INTERRUPTED_MODEL_ATTEMPT with exitCode
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validModelFailureInterrupted.outcome, exitCode: 0 },
    }),
  'INTERRUPTED_MODEL_ATTEMPT with exitCode 0'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validModelFailureInterrupted.outcome, exitCode: null },
    }),
  'INTERRUPTED_MODEL_ATTEMPT with exitCode null'
);

// 5. Reject OLD/Forbidden fields
assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validInputFailure1.outcome, outcomeKind: 'INPUT_FAILURE' },
    }),
  'Old outcomeKind field'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validInputFailure1.outcome, evaluatedAt: now },
    }),
  'Old evaluatedAt field'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validInputFailure1.outcome, workerId: 'worker-1' },
    }),
  'Client workerId field'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      outcome: { ...validInputFailure1.outcome, principalId: 'p-1' },
    }),
  'Client principalId field'
);

assertThrows(
  () =>
    validateNonAdvisoryOutcomeIntakeRequest({
      taskId: 'task-100',
      outcome: validInputFailure1.outcome,
    }),
  'Duplicate top-level taskId field'
);

console.log('PASSED: All Non-Advisory Outcome Intake Contract tests passed.');
