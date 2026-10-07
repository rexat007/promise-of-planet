import {
  NonAdvisoryOutcomeKind,
  validateDurableNonAdvisoryOutcomeRecord,
  isSameDurableNonAdvisoryOutcomeRecord,
  LocalNonAdvisoryOutcomeContractError,
} from '../peia-worker/src/localNonAdvisoryOutcomeContract';

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
  console.log('--- RUNNING PEIA LOCAL NON-ADVISORY OUTCOME CONTRACT TESTS ---');

  // 1. valid INPUT_FAILURE / MISSING_RETRIEVAL_QUERY
  await test('1. valid INPUT_FAILURE / MISSING_RETRIEVAL_QUERY', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'MISSING_RETRIEVAL_QUERY',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.taskId === 'task-1', 'taskId');
    assert(record.reason === 'MISSING_RETRIEVAL_QUERY', 'reason');
  });

  // 2. valid INPUT_FAILURE / INVALID_RETRIEVAL_QUERY
  await test('2. valid INPUT_FAILURE / INVALID_RETRIEVAL_QUERY', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'INVALID_RETRIEVAL_QUERY',
      modelAttempts: 0,
      detail: 'Query malformed',
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.reason === 'INVALID_RETRIEVAL_QUERY', 'reason');
  });

  // 3. valid INPUT_FAILURE / INVALID_TASK_PAYLOAD
  await test('3. valid INPUT_FAILURE / INVALID_TASK_PAYLOAD', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'INVALID_TASK_PAYLOAD',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.reason === 'INVALID_TASK_PAYLOAD', 'reason');
  });

  // 4. INPUT_FAILURE attempts > 0 rejected
  await test('4. INPUT_FAILURE attempts > 0 rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
        reason: 'MISSING_RETRIEVAL_QUERY',
        modelAttempts: 1,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 5. NO_EVIDENCE attempts 0 valid
  await test('5. NO_EVIDENCE attempts 0 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.ABSTAINED,
      reason: 'NO_EVIDENCE',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.reason === 'NO_EVIDENCE', 'reason');
  });

  // 6. INSUFFICIENT_EVIDENCE attempts 0 valid
  await test('6. INSUFFICIENT_EVIDENCE attempts 0 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.ABSTAINED,
      reason: 'INSUFFICIENT_EVIDENCE',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.reason === 'INSUFFICIENT_EVIDENCE', 'reason');
  });

  // 7. INVALID_MODEL_OUTPUT attempts 1 valid
  await test('7. INVALID_MODEL_OUTPUT attempts 1 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.ABSTAINED,
      reason: 'INVALID_MODEL_OUTPUT',
      modelAttempts: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.modelAttempts === 1, 'attempts');
  });

  // 8. INVALID_MODEL_OUTPUT attempts 2 valid
  await test('8. INVALID_MODEL_OUTPUT attempts 2 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.ABSTAINED,
      reason: 'INVALID_MODEL_OUTPUT',
      modelAttempts: 2,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.modelAttempts === 2, 'attempts');
  });

  // 9. INVALID_MODEL_OUTPUT attempts 0 rejected
  await test('9. INVALID_MODEL_OUTPUT attempts 0 rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.ABSTAINED,
        reason: 'INVALID_MODEL_OUTPUT',
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 10. UNGROUNDED_MODEL_OUTPUT attempts 1 valid
  await test('10. UNGROUNDED_MODEL_OUTPUT attempts 1 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.ABSTAINED,
      reason: 'UNGROUNDED_MODEL_OUTPUT',
      modelAttempts: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.reason === 'UNGROUNDED_MODEL_OUTPUT', 'reason');
  });

  // 11. UNGROUNDED_MODEL_OUTPUT attempts 0 rejected
  await test('11. UNGROUNDED_MODEL_OUTPUT attempts 0 rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.ABSTAINED,
        reason: 'UNGROUNDED_MODEL_OUTPUT',
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 12. EPA-only TOTAL_RETRIEVAL_FAILURE rejected
  await test('12. EPA-only TOTAL_RETRIEVAL_FAILURE rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        sourceFailures: [
          { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 13. NOAA-only TOTAL_RETRIEVAL_FAILURE rejected
  await test('13. NOAA-only TOTAL_RETRIEVAL_FAILURE rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        sourceFailures: [
          { sourceId: 'NOAA', errorCode: 'TRANSPORT_FAILURE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 14. EPA + NOAA accepted
  await test('14. EPA + NOAA accepted', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
      reason: 'TOTAL_RETRIEVAL_FAILURE',
      modelAttempts: 0,
      sourceFailures: [
        { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
        { sourceId: 'NOAA', errorCode: 'INVALID_SOURCE_RESPONSE' },
      ],
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.sourceFailures.length === 2, 'length');
  });

  // 15. NOAA + EPA accepted (order independence)
  await test('15. NOAA + EPA accepted (order independence)', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
      reason: 'TOTAL_RETRIEVAL_FAILURE',
      modelAttempts: 0,
      sourceFailures: [
        { sourceId: 'NOAA', errorCode: 'TRANSPORT_FAILURE' },
        { sourceId: 'EPA', errorCode: 'INVALID_SOURCE_RESPONSE' },
      ],
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.sourceFailures.length === 2, 'length');
  });

  // 16. duplicate EPA rejected
  await test('16. duplicate EPA rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        sourceFailures: [
          { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
          { sourceId: 'EPA', errorCode: 'INVALID_SOURCE_RESPONSE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 17. duplicate NOAA rejected
  await test('17. duplicate NOAA rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        sourceFailures: [
          { sourceId: 'NOAA', errorCode: 'TRANSPORT_FAILURE' },
          { sourceId: 'NOAA', errorCode: 'INVALID_SOURCE_RESPONSE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 18. empty sourceFailures rejected
  await test('18. empty sourceFailures rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 19. invalid source rejected
  await test('19. invalid source rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        sourceFailures: [
          { sourceId: 'NASA' as any, errorCode: 'TRANSPORT_FAILURE' },
          { sourceId: 'NOAA', errorCode: 'TRANSPORT_FAILURE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 20. invalid errorCode rejected
  await test('20. invalid errorCode rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        sourceFailures: [
          { sourceId: 'EPA', errorCode: 'BAD_ERROR' as any },
          { sourceId: 'NOAA', errorCode: 'TRANSPORT_FAILURE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 21. modelAttempts > 0 still rejected for RETRIEVAL_FAILURE
  await test('21. modelAttempts > 0 still rejected for RETRIEVAL_FAILURE', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 1,
        sourceFailures: [
          { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
          { sourceId: 'NOAA', errorCode: 'TRANSPORT_FAILURE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 22. TIMEOUT attempts 1 valid
  await test('22. TIMEOUT attempts 1 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
      reason: 'TIMEOUT',
      modelAttempts: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.reason === 'TIMEOUT', 'reason');
  });

  // 22b. TIMEOUT attempts 2 valid
  await test('22b. TIMEOUT attempts 2 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
      reason: 'TIMEOUT',
      modelAttempts: 2,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.modelAttempts === 2, 'attempts');
  });

  // 22c. PROCESS_LAUNCH_FAILURE attempts 1 valid
  await test('22c. PROCESS_LAUNCH_FAILURE attempts 1 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
      reason: 'PROCESS_LAUNCH_FAILURE',
      modelAttempts: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.reason === 'PROCESS_LAUNCH_FAILURE', 'reason');
  });

  // 23. MODEL_FAILURE attempts 2 valid
  await test('23. MODEL_FAILURE attempts 2 valid', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
      reason: 'NON_ZERO_EXIT',
      modelAttempts: 2,
      exitCode: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.modelAttempts === 2, 'attempts');
  });

  // 24. MODEL_FAILURE attempts 0 rejected
  await test('24. MODEL_FAILURE attempts 0 rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
        reason: 'TIMEOUT',
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 25. exitCode accepted for MODEL_FAILURE
  await test('25. exitCode accepted for MODEL_FAILURE', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
      reason: 'PROCESS_ERROR',
      modelAttempts: 1,
      exitCode: 137,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.exitCode === 137, 'exitCode');
  });

  // 26. exitCode rejected outside MODEL_FAILURE
  await test('26. exitCode rejected outside MODEL_FAILURE', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.ABSTAINED,
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        exitCode: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 27. sourceFailures rejected outside RETRIEVAL_FAILURE
  await test('27. sourceFailures rejected outside RETRIEVAL_FAILURE', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
        reason: 'TIMEOUT',
        modelAttempts: 1,
        sourceFailures: [
          { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
          { sourceId: 'NOAA', errorCode: 'TRANSPORT_FAILURE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 28. mismatched kind/reason rejected
  await test('28. mismatched kind/reason rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 29. extra fields rejected
  await test('29. extra fields rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
        reason: 'MISSING_RETRIEVAL_QUERY',
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
        extraField: 'bad',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 30. invalid taskId rejected
  await test('30. invalid taskId rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: '   ',
        kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
        reason: 'MISSING_RETRIEVAL_QUERY',
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 31. invalid createdAt rejected
  await test('31. invalid createdAt rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
        reason: 'MISSING_RETRIEVAL_QUERY',
        modelAttempts: 0,
        createdAt: 'not-a-date',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 32. empty/untrimmed detail rejected
  await test('32. empty/untrimmed detail rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
        reason: 'MISSING_RETRIEVAL_QUERY',
        modelAttempts: 0,
        detail: '   ',
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // --- INTERRUPTED_MODEL_ATTEMPT SPECIFIC TESTS ---

  // 34. INTERRUPTED_MODEL_ATTEMPT + attempts 2 -> accepted
  await test('34. INTERRUPTED_MODEL_ATTEMPT + attempts 2 -> accepted', () => {
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
      reason: 'INTERRUPTED_MODEL_ATTEMPT',
      modelAttempts: 2,
      detail: 'Recovered PROCESSING task at maximum model attempts with no durable model result.',
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(record.reason === 'INTERRUPTED_MODEL_ATTEMPT', 'reason');
    assert(record.modelAttempts === 2, 'attempts');
  });

  // 35. INTERRUPTED_MODEL_ATTEMPT + attempts 1 -> rejected
  await test('35. INTERRUPTED_MODEL_ATTEMPT + attempts 1 -> rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
        reason: 'INTERRUPTED_MODEL_ATTEMPT',
        modelAttempts: 1,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 36. INTERRUPTED_MODEL_ATTEMPT + attempts 0 -> rejected
  await test('36. INTERRUPTED_MODEL_ATTEMPT + attempts 0 -> rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
        reason: 'INTERRUPTED_MODEL_ATTEMPT',
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 37. INTERRUPTED_MODEL_ATTEMPT + explicit exitCode 0 -> rejected
  await test('37. INTERRUPTED_MODEL_ATTEMPT + explicit exitCode 0 -> rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
        reason: 'INTERRUPTED_MODEL_ATTEMPT',
        modelAttempts: 2,
        exitCode: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 38. INTERRUPTED_MODEL_ATTEMPT + explicit exitCode null -> rejected
  await test('38. INTERRUPTED_MODEL_ATTEMPT + explicit exitCode null -> rejected', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
        reason: 'INTERRUPTED_MODEL_ATTEMPT',
        modelAttempts: 2,
        exitCode: null,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 39. INTERRUPTED_MODEL_ATTEMPT cannot be INPUT_FAILURE
  await test('39. INTERRUPTED_MODEL_ATTEMPT cannot be INPUT_FAILURE', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
        reason: 'INTERRUPTED_MODEL_ATTEMPT' as any,
        modelAttempts: 0,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 40. INTERRUPTED_MODEL_ATTEMPT cannot be ABSTAINED
  await test('40. INTERRUPTED_MODEL_ATTEMPT cannot be ABSTAINED', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.ABSTAINED,
        reason: 'INTERRUPTED_MODEL_ATTEMPT' as any,
        modelAttempts: 2,
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 41. INTERRUPTED_MODEL_ATTEMPT cannot be RETRIEVAL_FAILURE
  await test('41. INTERRUPTED_MODEL_ATTEMPT cannot be RETRIEVAL_FAILURE', () => {
    try {
      validateDurableNonAdvisoryOutcomeRecord({
        taskId: 'task-1',
        kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
        reason: 'INTERRUPTED_MODEL_ATTEMPT' as any,
        modelAttempts: 0,
        sourceFailures: [
          { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
          { sourceId: 'NOAA', errorCode: 'TRANSPORT_FAILURE' },
        ],
        createdAt: '2026-10-07T00:00:00.000Z',
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalNonAdvisoryOutcomeContractError, 'error type');
    }
  });

  // 33. equality helper test
  await test('33. isSameDurableNonAdvisoryOutcomeRecord comparisons', () => {
    const r1 = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'MISSING_RETRIEVAL_QUERY',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    const r2 = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'MISSING_RETRIEVAL_QUERY',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    const r3 = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-1',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'INVALID_RETRIEVAL_QUERY',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    assert(isSameDurableNonAdvisoryOutcomeRecord(r1, r2), 'r1 and r2 identical');
    assert(!isSameDurableNonAdvisoryOutcomeRecord(r1, r3), 'r1 and r3 different');
  });

  console.log(`\nALL CONTRACT TESTS COMPLETED: ${passedTests}/${totalTests} PASSED`);
})();
