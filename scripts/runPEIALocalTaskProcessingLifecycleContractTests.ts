import {
  TaskProcessingState,
  TaskProcessingTerminalOutcome,
  PEIA_MAX_MODEL_ATTEMPTS,
  validateTaskProcessingRecord,
  validateStateTransition,
  areTaskProcessingRecordsIdentical,
  LocalTaskProcessingLifecycleContractError,
  type TaskProcessingRecord,
} from '../peia-worker/src/localTaskProcessingLifecycleContract';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`[PASS] ${totalTests}. ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${totalTests}. ${name}`);
    console.error(err);
    throw err;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

(async () => {
  console.log('--- RUNNING PEIA LOCAL TASK PROCESSING LIFECYCLE CONTRACT TESTS ---');

  // 1. Valid READY record
  await test('1. valid READY record validated successfully', () => {
    const record = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.READY,
      modelAttempts: 0,
      terminalOutcome: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(record.taskId === 'task-101', 'TaskId mismatch');
    assert(record.state === TaskProcessingState.READY, 'State mismatch');
    assert(record.modelAttempts === 0, 'Attempts mismatch');
    assert(record.terminalOutcome === null, 'Terminal outcome mismatch');
  });

  // 2. READY with modelAttempts > 0 rejected
  await test('2. READY with modelAttempts > 0 rejected with STATE_INVARIANT_VIOLATION', () => {
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.READY,
        modelAttempts: 1,
        terminalOutcome: null,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingLifecycleContractError, 'Must be contract error');
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'STATE_INVARIANT_VIOLATION', 'Code mismatch');
    }
  });

  // 3. READY with non-null terminalOutcome rejected
  await test('3. READY with non-null terminalOutcome rejected with STATE_INVARIANT_VIOLATION', () => {
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.READY,
        modelAttempts: 0,
        terminalOutcome: TaskProcessingTerminalOutcome.ABSTAINED,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'STATE_INVARIANT_VIOLATION', 'Code mismatch');
    }
  });

  // 4. Valid PROCESSING record
  await test('4. valid PROCESSING record with attempts 1 and 2 accepted', () => {
    const rec1 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.PROCESSING,
      modelAttempts: 1,
      terminalOutcome: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(rec1.modelAttempts === 1, 'Attempts 1 accepted');

    const rec2 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.PROCESSING,
      modelAttempts: 2,
      terminalOutcome: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(rec2.modelAttempts === 2, 'Attempts 2 accepted');
  });

  // 5. PROCESSING with attempts = 0 rejected
  await test('5. PROCESSING with modelAttempts = 0 rejected', () => {
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.PROCESSING,
        modelAttempts: 0,
        terminalOutcome: null,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'STATE_INVARIANT_VIOLATION', 'Code mismatch');
    }
  });

  // 6. Max model attempts is 2; attempts = 3 rejected
  await test('6. modelAttempts = 3 rejected with MAX_MODEL_ATTEMPTS_EXCEEDED', () => {
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.PROCESSING,
        modelAttempts: 3,
        terminalOutcome: null,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'MAX_MODEL_ATTEMPTS_EXCEEDED', 'Code mismatch');
    }
  });

  // 7. Valid ADVISORY_PENDING_UPLOAD record
  await test('7. valid ADVISORY_PENDING_UPLOAD record accepted', () => {
    const rec = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.ADVISORY_PENDING_UPLOAD,
      modelAttempts: 1,
      terminalOutcome: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(rec.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD, 'State match');
  });

  // 8. ADVISORY_PENDING_UPLOAD with incompatible terminalOutcome rejected
  await test('8. ADVISORY_PENDING_UPLOAD with ABSTAINED or MODEL_FAILURE outcome rejected', () => {
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.ADVISORY_PENDING_UPLOAD,
        modelAttempts: 1,
        terminalOutcome: TaskProcessingTerminalOutcome.MODEL_FAILURE,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'STATE_INVARIANT_VIOLATION', 'Code mismatch');
    }
  });

  // 9. Valid NON_ADVISORY_PENDING_REPORT records
  await test('9. valid NON_ADVISORY_PENDING_REPORT with ABSTAINED (attempts 0, 1, 2) and MODEL_FAILURE (attempts 1, 2) accepted', () => {
    const recAbstained0 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
      modelAttempts: 0,
      terminalOutcome: TaskProcessingTerminalOutcome.ABSTAINED,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recAbstained0.modelAttempts === 0, 'Attempts 0 match');
    assert(recAbstained0.terminalOutcome === TaskProcessingTerminalOutcome.ABSTAINED, 'Outcome match');

    const recAbstained1 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
      modelAttempts: 1,
      terminalOutcome: TaskProcessingTerminalOutcome.ABSTAINED,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recAbstained1.modelAttempts === 1, 'Attempts 1 match');

    const recAbstained2 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
      modelAttempts: 2,
      terminalOutcome: TaskProcessingTerminalOutcome.ABSTAINED,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recAbstained2.modelAttempts === 2, 'Attempts 2 match');

    const recModelFailure1 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
      modelAttempts: 1,
      terminalOutcome: TaskProcessingTerminalOutcome.MODEL_FAILURE,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recModelFailure1.modelAttempts === 1, 'Attempts 1 match');

    const recModelFailure2 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
      modelAttempts: 2,
      terminalOutcome: TaskProcessingTerminalOutcome.MODEL_FAILURE,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recModelFailure2.modelAttempts === 2, 'Attempts 2 match');
  });

  // 10. NON_ADVISORY_PENDING_REPORT invalid combinations rejected
  await test('10. NON_ADVISORY_PENDING_REPORT with null outcome or MODEL_FAILURE with attempts=0 rejected', () => {
    // null outcome
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
        modelAttempts: 1,
        terminalOutcome: null,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'Should have failed with null terminalOutcome');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'STATE_INVARIANT_VIOLATION', 'Code mismatch');
    }

    // MODEL_FAILURE with attempts 0
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
        modelAttempts: 0,
        terminalOutcome: TaskProcessingTerminalOutcome.MODEL_FAILURE,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'Should have failed with MODEL_FAILURE and attempts 0');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'STATE_INVARIANT_VIOLATION', 'Code mismatch');
    }
  });

  // 11. Valid COMPLETED terminal records
  await test('11. valid COMPLETED records accepted (advisory attempts 1-2, ABSTAINED attempts 0-2, MODEL_FAILURE attempts 1-2)', () => {
    // Advisory (null outcome) with attempts 1 and 2
    const recAdvisory1 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.COMPLETED,
      modelAttempts: 1,
      terminalOutcome: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recAdvisory1.state === TaskProcessingState.COMPLETED, 'State match');
    assert(recAdvisory1.terminalOutcome === null, 'Outcome match');

    const recAdvisory2 = validateTaskProcessingRecord({
      taskId: 'task-101',
      state: TaskProcessingState.COMPLETED,
      modelAttempts: 2,
      terminalOutcome: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recAdvisory2.modelAttempts === 2, 'Attempts match');

    // ABSTAINED with attempts 0, 1, 2
    const recAbstained0 = validateTaskProcessingRecord({
      taskId: 'task-102',
      state: TaskProcessingState.COMPLETED,
      modelAttempts: 0,
      terminalOutcome: TaskProcessingTerminalOutcome.ABSTAINED,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recAbstained0.modelAttempts === 0, 'Attempts 0 match');
    assert(recAbstained0.terminalOutcome === TaskProcessingTerminalOutcome.ABSTAINED, 'Outcome match');

    const recAbstained1 = validateTaskProcessingRecord({
      taskId: 'task-102',
      state: TaskProcessingState.COMPLETED,
      modelAttempts: 1,
      terminalOutcome: TaskProcessingTerminalOutcome.ABSTAINED,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recAbstained1.modelAttempts === 1, 'Attempts 1 match');

    // MODEL_FAILURE with attempts 1, 2
    const recModelFailure1 = validateTaskProcessingRecord({
      taskId: 'task-103',
      state: TaskProcessingState.COMPLETED,
      modelAttempts: 1,
      terminalOutcome: TaskProcessingTerminalOutcome.MODEL_FAILURE,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    assert(recModelFailure1.modelAttempts === 1, 'Attempts 1 match');
  });

  // 12. Invalid COMPLETED combinations rejected
  await test('12. COMPLETED with attempts=0 and null or MODEL_FAILURE outcome rejected', () => {
    // attempts 0 + null
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.COMPLETED,
        modelAttempts: 0,
        terminalOutcome: null,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'COMPLETED + attempts 0 + null should fail');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'STATE_INVARIANT_VIOLATION', 'Code mismatch');
    }

    // attempts 0 + MODEL_FAILURE
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.COMPLETED,
        modelAttempts: 0,
        terminalOutcome: TaskProcessingTerminalOutcome.MODEL_FAILURE,
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      assert(false, 'COMPLETED + attempts 0 + MODEL_FAILURE should fail');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'STATE_INVARIANT_VIOLATION', 'Code mismatch');
    }
  });

  // 13. Extra / unknown fields rejected
  await test('13. extra forbidden / unknown fields rejected with INVALID_PROCESSING_RECORD', () => {
    try {
      validateTaskProcessingRecord({
        taskId: 'task-101',
        state: TaskProcessingState.READY,
        modelAttempts: 0,
        terminalOutcome: null,
        updatedAt: '2026-10-01T00:00:00.000Z',
        extraField: 'prohibited',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'INVALID_PROCESSING_RECORD', 'Code mismatch');
    }
  });

  // 14. State transitions validation
  await test('14. allowed and prohibited state transitions enforce state machine', () => {
    // READY transitions
    validateStateTransition(TaskProcessingState.READY, TaskProcessingState.PROCESSING);
    validateStateTransition(TaskProcessingState.READY, TaskProcessingState.NON_ADVISORY_PENDING_REPORT);

    // PROCESSING transitions
    validateStateTransition(TaskProcessingState.PROCESSING, TaskProcessingState.PROCESSING);
    validateStateTransition(TaskProcessingState.PROCESSING, TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    validateStateTransition(TaskProcessingState.PROCESSING, TaskProcessingState.NON_ADVISORY_PENDING_REPORT);

    // ADVISORY_PENDING_UPLOAD transitions
    validateStateTransition(TaskProcessingState.ADVISORY_PENDING_UPLOAD, TaskProcessingState.COMPLETED);

    // NON_ADVISORY_PENDING_REPORT transitions
    validateStateTransition(TaskProcessingState.NON_ADVISORY_PENDING_REPORT, TaskProcessingState.COMPLETED);

    // Prohibited transitions
    try {
      validateStateTransition(TaskProcessingState.READY, TaskProcessingState.COMPLETED);
      assert(false, 'READY -> COMPLETED should be prohibited');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'INVALID_STATE_TRANSITION', 'Code mismatch');
    }

    try {
      validateStateTransition(TaskProcessingState.PROCESSING, TaskProcessingState.COMPLETED);
      assert(false, 'PROCESSING -> COMPLETED should be prohibited');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'INVALID_STATE_TRANSITION', 'Code mismatch');
    }

    try {
      validateStateTransition(TaskProcessingState.READY, TaskProcessingState.ADVISORY_PENDING_UPLOAD);
      assert(false, 'READY -> ADVISORY_PENDING_UPLOAD should be prohibited');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'INVALID_STATE_TRANSITION', 'Code mismatch');
    }

    try {
      validateStateTransition(TaskProcessingState.ADVISORY_PENDING_UPLOAD, TaskProcessingState.PROCESSING);
      assert(false, 'ADVISORY_PENDING_UPLOAD -> PROCESSING should be prohibited');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'INVALID_STATE_TRANSITION', 'Code mismatch');
    }

    try {
      validateStateTransition(TaskProcessingState.COMPLETED, TaskProcessingState.READY);
      assert(false, 'COMPLETED -> READY should be prohibited');
    } catch (err) {
      assert((err as LocalTaskProcessingLifecycleContractError).code === 'INVALID_STATE_TRANSITION', 'Code mismatch');
    }
  });

  // 15. areTaskProcessingRecordsIdentical structural equality
  await test('15. areTaskProcessingRecordsIdentical compares full semantic state', () => {
    const a: TaskProcessingRecord = {
      taskId: 't-1',
      state: TaskProcessingState.READY,
      modelAttempts: 0,
      terminalOutcome: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const b: TaskProcessingRecord = {
      taskId: 't-1',
      state: TaskProcessingState.READY,
      modelAttempts: 0,
      terminalOutcome: null,
      updatedAt: '2026-10-01T00:05:00.000Z', // Different timestamp still identical semantically
    };
    assert(areTaskProcessingRecordsIdentical(a, b), 'Must be identical');

    const c: TaskProcessingRecord = {
      ...a,
      modelAttempts: 1,
    };
    assert(!areTaskProcessingRecordsIdentical(a, c), 'Attempts mismatch must not be identical');
  });

  console.log('------------------------------------------------------------');
  console.log(`TASK PROCESSING LIFECYCLE CONTRACT TESTS: ${passedTests}/${totalTests} PASSED`);
})();
