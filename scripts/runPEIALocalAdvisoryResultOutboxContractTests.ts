import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LocalAdvisoryResultOutboxState,
  LocalAdvisoryResultOutboxContractError,
  createStoredAdvisoryResultRecord,
  validateStoredAdvisoryResultRecord,
  isSameStoredAdvisoryResultRecord,
  type StoredAdvisoryResultRecord,
  type LocalAdvisoryResultOutboxContractErrorCode,
} from '../peia-worker/src/localAdvisoryResultOutboxContract';
import {
  AITaskType,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
} from '../src/types/aiReview';
import type {
  PEIAAdvisoryResult,
  PEIAAdvisoryFinding,
} from '../peia-worker/src/advisoryResultContract';

/**
 * PEIA-18B — LOCAL ADVISORY RESULT OUTBOX CONTRACT TEST SUITE.
 * Enforces exactly 42 real test units covering local outbox state,
 * stored record wrapper, strict validation, structural equality,
 * repository interface semantics, and architectural invariants.
 */

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  totalTests++;
  try {
    await fn();
    passedTests++;
  } catch (err: unknown) {
    console.error(`FAILED Test ${totalTests}: ${name}`);
    console.error(err);
    throw err;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertThrowsOutboxContractError(
  fn: () => unknown,
  expectedCode: LocalAdvisoryResultOutboxContractErrorCode,
  expectedMessage: string
): void {
  try {
    fn();
  } catch (err: unknown) {
    assert(
      err instanceof LocalAdvisoryResultOutboxContractError,
      'Error must be instanceof LocalAdvisoryResultOutboxContractError'
    );
    const contractErr = err as LocalAdvisoryResultOutboxContractError;
    assert(
      contractErr.code === expectedCode,
      `Expected error code ${expectedCode}, got ${contractErr.code}`
    );
    assert(
      contractErr.message === expectedMessage,
      `Expected error message "${expectedMessage}", got "${contractErr.message}"`
    );
    return;
  }
  throw new Error('Expected function to throw LocalAdvisoryResultOutboxContractError, but it returned normally.');
}

const canonicalFindings: readonly PEIAAdvisoryFinding[] = [
  {
    code: 'METRIC_VERIFICATION_NEEDED',
    severity: AIReviewSeverity.Info,
    message: 'Rainfall metrics require human verification against official records.',
  },
  {
    code: 'CITATION_SOURCE_OUTDATED',
    severity: AIReviewSeverity.Warning,
    message: 'Referenced policy guideline was revised in 2025.',
  },
  {
    code: 'POTENTIAL_INCONSISTENCY_DETECTED',
    severity: AIReviewSeverity.ReviewRecommended,
    message: 'Section 3 directly contradicts Section 1 figures.',
  },
];

const canonicalValidResult: PEIAAdvisoryResult = {
  task: {
    taskId: 'task-canonical-202',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-987',
      sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
  assessment: {
    summary: 'Comprehensive review completed. Three advisory findings recorded.',
    findings: canonicalFindings,
  },
};

async function runSuite() {
  console.log('--- PEIA-18B 42-Test Local Advisory Result Outbox Contract Audit ---');

  // 1. LocalAdvisoryResultOutboxState exists
  await test('1. LocalAdvisoryResultOutboxState exists', () => {
    assert(
      typeof LocalAdvisoryResultOutboxState === 'object' && LocalAdvisoryResultOutboxState !== null,
      'LocalAdvisoryResultOutboxState must exist'
    );
  });

  // 2. exact state vocabulary is ONLY PendingUpload
  await test('2. exact state vocabulary is ONLY PendingUpload', () => {
    const keys = Object.keys(LocalAdvisoryResultOutboxState);
    assert(keys.length === 1, `Expected 1 state key, got ${keys.length}`);
    assert(keys[0] === 'PendingUpload', 'State key must be PendingUpload');
    assert(
      LocalAdvisoryResultOutboxState.PendingUpload === 'PendingUpload',
      'PendingUpload value must be "PendingUpload"'
    );
  });

  // 3. createStoredAdvisoryResultRecord exists
  await test('3. createStoredAdvisoryResultRecord exists', () => {
    assert(
      typeof createStoredAdvisoryResultRecord === 'function',
      'createStoredAdvisoryResultRecord must be a function'
    );
  });

  // 4. validateStoredAdvisoryResultRecord exists
  await test('4. validateStoredAdvisoryResultRecord exists', () => {
    assert(
      typeof validateStoredAdvisoryResultRecord === 'function',
      'validateStoredAdvisoryResultRecord must be a function'
    );
  });

  // 5. isSameStoredAdvisoryResultRecord exists
  await test('5. isSameStoredAdvisoryResultRecord exists', () => {
    assert(
      typeof isSameStoredAdvisoryResultRecord === 'function',
      'isSameStoredAdvisoryResultRecord must be a function'
    );
  });

  // 6. valid advisory result creates stored record
  await test('6. valid advisory result creates stored record', () => {
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    assert(record !== null && typeof record === 'object', 'Created record must be an object');
  });

  // 7. created record contains EXACTLY result + localState
  await test('7. created record contains EXACTLY result + localState', () => {
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    const keys = Object.keys(record).sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(['localState', 'result']),
      'Created record must contain exactly result and localState'
    );
  });

  // 8. created record preserves exact result object reference
  await test('8. created record preserves exact result object reference', () => {
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    assert(record.result === canonicalValidResult, 'Record must preserve exact result reference');
  });

  // 9. created localState is exactly PendingUpload
  await test('9. created localState is exactly PendingUpload', () => {
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    assert(
      record.localState === LocalAdvisoryResultOutboxState.PendingUpload,
      'localState must be PendingUpload'
    );
  });

  // 10. invalid advisory result is rejected by create function
  await test('10. invalid advisory result is rejected by create function', () => {
    const invalidResult = {
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskId: '',
      },
    } as unknown as PEIAAdvisoryResult;

    assertThrowsOutboxContractError(
      () => createStoredAdvisoryResultRecord(invalidResult),
      'INVALID_ADVISORY_RESULT',
      'Invalid advisory result for local outbox.'
    );
  });

  // 11. create-function error is LocalAdvisoryResultOutboxContractError
  await test('11. create-function error is LocalAdvisoryResultOutboxContractError', () => {
    const invalidResult = {
      ...canonicalValidResult,
      assessment: {
        summary: '',
        findings: [],
      },
    } as unknown as PEIAAdvisoryResult;

    assertThrowsOutboxContractError(
      () => createStoredAdvisoryResultRecord(invalidResult),
      'INVALID_ADVISORY_RESULT',
      'Invalid advisory result for local outbox.'
    );

    const directErr = new LocalAdvisoryResultOutboxContractError('INVALID_ADVISORY_RESULT');
    assert(directErr instanceof LocalAdvisoryResultOutboxContractError, 'Direct instance check');
    assert(directErr.code === 'INVALID_ADVISORY_RESULT', 'Direct instance code check');
    assert(directErr.message === 'Invalid advisory result for local outbox.', 'Direct instance message check');
  });

  // 12. create-function error code is INVALID_ADVISORY_RESULT
  await test('12. create-function error code is INVALID_ADVISORY_RESULT', () => {
    const invalidResult = {
      extraKey: 123,
    } as unknown as PEIAAdvisoryResult;

    assertThrowsOutboxContractError(
      () => createStoredAdvisoryResultRecord(invalidResult),
      'INVALID_ADVISORY_RESULT',
      'Invalid advisory result for local outbox.'
    );
  });

  // 13. create-function fixed message exact
  await test('13. create-function fixed message exact', () => {
    const invalidResult = {
      task: 'not-an-object',
      assessment: 'not-an-object',
    } as unknown as PEIAAdvisoryResult;

    assertThrowsOutboxContractError(
      () => createStoredAdvisoryResultRecord(invalidResult),
      'INVALID_ADVISORY_RESULT',
      'Invalid advisory result for local outbox.'
    );
  });

  // 14. valid stored record validates successfully
  await test('14. valid stored record validates successfully', () => {
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    const validated = validateStoredAdvisoryResultRecord(record);
    assert(validated.result.task.taskId === 'task-canonical-202', 'Validated record task id must match');
    assert(validated.localState === LocalAdvisoryResultOutboxState.PendingUpload, 'localState must match');
  });

  // 15. stored validator returns exact same record object reference
  await test('15. stored validator returns exact same record object reference', () => {
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    const validated = validateStoredAdvisoryResultRecord(record);
    assert(validated === record, 'Validator must return exact same record reference');
  });

  // 16. non-object stored input rejected
  await test('16. non-object stored input rejected', () => {
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord(null),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord('string-input'),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord([1, 2, 3]),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
  });

  // 17. missing result rejected
  await test('17. missing result rejected', () => {
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord({
        localState: LocalAdvisoryResultOutboxState.PendingUpload,
      }),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
  });

  // 18. missing localState rejected
  await test('18. missing localState rejected', () => {
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord({
        result: canonicalValidResult,
      }),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
  });

  // 19. extra stored-record key rejected
  await test('19. extra stored-record key rejected', () => {
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord({
        result: canonicalValidResult,
        localState: LocalAdvisoryResultOutboxState.PendingUpload,
        extraKey: 'forbidden',
      }),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord({
        result: canonicalValidResult,
        localState: LocalAdvisoryResultOutboxState.PendingUpload,
        taskId: canonicalValidResult.task.taskId,
      }),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
  });

  // 20. invalid localState rejected
  await test('20. invalid localState rejected', () => {
    const invalidStates = ['Uploading', 'Uploaded', 'Completed', 'Failed', 'pendingUpload', ''];
    for (const st of invalidStates) {
      assertThrowsOutboxContractError(
        () => validateStoredAdvisoryResultRecord({
          result: canonicalValidResult,
          localState: st,
        }),
        'INVALID_STORED_RECORD',
        'Stored advisory result record is invalid.'
      );
    }
  });

  // 21. malformed nested advisory result rejected
  await test('21. malformed nested advisory result rejected', () => {
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord({
        result: {
          ...canonicalValidResult,
          task: {
            ...canonicalValidResult.task,
            taskId: '',
          },
        },
        localState: LocalAdvisoryResultOutboxState.PendingUpload,
      }),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
  });

  // 22. nested malformed result becomes INVALID_STORED_RECORD
  await test('22. nested malformed result becomes INVALID_STORED_RECORD', () => {
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord({
        result: {
          ...canonicalValidResult,
          assessment: {
            summary: '',
            findings: [],
          },
        },
        localState: LocalAdvisoryResultOutboxState.PendingUpload,
      }),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );

    const directErr = new LocalAdvisoryResultOutboxContractError('INVALID_STORED_RECORD');
    assert(directErr instanceof LocalAdvisoryResultOutboxContractError, 'Direct instance check');
    assert(directErr.code === 'INVALID_STORED_RECORD', 'Direct instance code check');
    assert(directErr.message === 'Stored advisory result record is invalid.', 'Direct instance message check');
  });

  // 23. INVALID_STORED_RECORD fixed message exact
  await test('23. INVALID_STORED_RECORD fixed message exact', () => {
    assertThrowsOutboxContractError(
      () => validateStoredAdvisoryResultRecord({
        result: 'not-an-object',
        localState: LocalAdvisoryResultOutboxState.PendingUpload,
      }),
      'INVALID_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );
  });

  // 24. equality returns true for same object
  await test('24. equality returns true for same object', () => {
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    assert(isSameStoredAdvisoryResultRecord(record, record), 'Same record instance must be equal');
  });

  // 25. equality returns true for separately constructed structurally identical records
  await test('25. equality returns true for separately constructed structurally identical records', () => {
    const result1: PEIAAdvisoryResult = {
      task: {
        taskId: 'task-canonical-202',
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: AIReviewTargetType.News,
          targetId: 'news-987',
          sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
        },
      },
      assessment: {
        summary: 'Comprehensive review completed. Three advisory findings recorded.',
        findings: [
          {
            code: 'METRIC_VERIFICATION_NEEDED',
            severity: AIReviewSeverity.Info,
            message: 'Rainfall metrics require human verification against official records.',
          },
          {
            code: 'CITATION_SOURCE_OUTDATED',
            severity: AIReviewSeverity.Warning,
            message: 'Referenced policy guideline was revised in 2025.',
          },
          {
            code: 'POTENTIAL_INCONSISTENCY_DETECTED',
            severity: AIReviewSeverity.ReviewRecommended,
            message: 'Section 3 directly contradicts Section 1 figures.',
          },
        ],
      },
    };

    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord(result1);

    assert(recordA !== recordB, 'Records must be separate instances');
    assert(isSameStoredAdvisoryResultRecord(recordA, recordB), 'Separately constructed identical records must be equal');
  });

  // 26. equality false for different localState
  await test('26. equality false for different localState', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = {
      result: canonicalValidResult,
      localState: 'Uploaded' as unknown as typeof LocalAdvisoryResultOutboxState.PendingUpload,
    };
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different localState must not be equal');
  });

  // 27. equality false for different taskId
  await test('27. equality false for different taskId', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskId: 'task-other-555',
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different taskId must not be equal');
  });

  // 28. equality false for different taskType
  await test('28. equality false for different taskType', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = {
      ...recordA,
      result: {
        ...recordA.result,
        task: {
          ...recordA.result.task,
          taskType: 'IMAGE_REVIEW' as unknown as typeof AITaskType.CONTENT_REVIEW,
        },
      },
    };
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different taskType must not be equal');
  });

  // 29. equality false for different targetType
  await test('29. equality false for different targetType', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          ...canonicalValidResult.task.target,
          targetType: AIReviewTargetType.LibraryDocument,
        },
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different targetType must not be equal');
  });

  // 30. equality false for different targetId
  await test('30. equality false for different targetId', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          ...canonicalValidResult.task.target,
          targetId: 'news-99999',
        },
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different targetId must not be equal');
  });

  // 31. equality false for different sourceUpdatedAt
  await test('31. equality false for different sourceUpdatedAt', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          ...canonicalValidResult.task.target,
          sourceUpdatedAt: '2026-09-29T12:00:00.000Z',
        },
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different sourceUpdatedAt must not be equal');
  });

  // 32. equality false for different summary
  await test('32. equality false for different summary', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        summary: 'Different summary text.',
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different summary must not be equal');
  });

  // 33. equality false for different findings length
  await test('33. equality false for different findings length', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        findings: [canonicalFindings[0]],
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different findings length must not be equal');
  });

  // 34. equality false for different finding code
  await test('34. equality false for different finding code', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        findings: [
          {
            ...canonicalFindings[0],
            code: 'DIFFERENT_CODE_KEY',
          },
          canonicalFindings[1],
          canonicalFindings[2],
        ],
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different finding code must not be equal');
  });

  // 35. equality false for different finding severity
  await test('35. equality false for different finding severity', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        findings: [
          {
            ...canonicalFindings[0],
            severity: AIReviewSeverity.Warning,
          },
          canonicalFindings[1],
          canonicalFindings[2],
        ],
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different finding severity must not be equal');
  });

  // 36. equality false for different finding message
  await test('36. equality false for different finding message', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        findings: [
          {
            ...canonicalFindings[0],
            message: 'Completely different finding message.',
          },
          canonicalFindings[1],
          canonicalFindings[2],
        ],
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Different finding message must not be equal');
  });

  // 37. equality false when finding order differs
  await test('37. equality false when finding order differs', () => {
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        findings: [
          canonicalFindings[1],
          canonicalFindings[0],
          canonicalFindings[2],
        ],
      },
    });
    assert(!isSameStoredAdvisoryResultRecord(recordA, recordB), 'Permuted finding order must not be equal');
  });

  // 38. repository interface source contract has exactly save, findByTaskId, listPendingUpload and NO delete/markUploaded/retry/claim APIs
  await test('38. repository interface source contract has exactly save, findByTaskId, listPendingUpload and NO delete/markUploaded/retry/claim APIs', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/localAdvisoryResultOutboxContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const repoMatch = source.match(
      /export\s+interface\s+LocalAdvisoryResultOutboxRepository\s*\{([^}]+)\}/
    );
    assert(repoMatch !== null, 'Must extract LocalAdvisoryResultOutboxRepository interface');
    const repoBody = repoMatch![1];

    assert(repoBody.includes('save(record: StoredAdvisoryResultRecord): Promise<void>;'), 'Must declare save');
    assert(repoBody.includes('findByTaskId(taskId: string): Promise<StoredAdvisoryResultRecord | null>;'), 'Must declare findByTaskId');
    assert(repoBody.includes('listPendingUpload(): Promise<readonly StoredAdvisoryResultRecord[]>;'), 'Must declare listPendingUpload');

    const methodLines = repoBody
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'));
    assert(methodLines.length === 3, `Expected exactly 3 method declarations in repository interface, got ${methodLines.length}`);

    const forbiddenMethods = [
      'delete',
      'remove',
      'markUploaded',
      'markFailed',
      'retry',
      'claim',
      'lease',
      'updateState',
    ];

    for (const m of forbiddenMethods) {
      assert(!repoBody.includes(m), `Forbidden repository method "${m}" found in interface body`);
    }
  });

  // 39. source contains no duplicate top-level taskId field in StoredAdvisoryResultRecord
  await test('39. source contains no duplicate top-level taskId field in StoredAdvisoryResultRecord', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/localAdvisoryResultOutboxContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const interfaceMatch = source.match(/export\s+interface\s+StoredAdvisoryResultRecord\s*\{([^}]+)\}/);
    assert(interfaceMatch !== null, 'Must find StoredAdvisoryResultRecord interface');
    const interfaceBody = interfaceMatch![1];

    assert(interfaceBody.includes('result: PEIAAdvisoryResult'), 'Must contain result');
    assert(interfaceBody.includes('localState: typeof LocalAdvisoryResultOutboxState.PendingUpload'), 'Must contain localState');
    assert(!interfaceBody.includes('taskId'), 'StoredAdvisoryResultRecord interface must NOT contain top-level taskId');
  });

  // 40. source contains no authority/server-artifact/network/SQLite/filesystem/env/time/randomness/retry behavior
  await test('40. source contains no authority/server-artifact/network/SQLite/filesystem/env/time/randomness/retry behavior', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/localAdvisoryResultOutboxContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'AIReviewArtifact',
      'AIReviewFinding',
      'contentSnapshot',
      'decision',
      'suggestedAction',
      'approved',
      'rejected',
      'published',
      'workflowState',
      'desiredWorkflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
      'override',
      'execute',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'fetch(',
      'globalThis.fetch',
      'Authorization',
      'Bearer',
      'endpointUrl',
      'credential',
      'node:sqlite',
      'DatabaseSync',
      'node:fs',
      'process.env',
      'import.meta.env',
      'setInterval',
      'setTimeout',
      'retry',
      'backoff',
      'poll',
      'cron',
      'schedule',
    ];

    for (const token of forbidden) {
      assert(!source.includes(token), `Forbidden token "${token}" found in source`);
    }
  });

  // 41. source proves canonical 18A reuse + identity preservation + no JSON.stringify equality
  await test('41. source proves canonical 18A reuse + identity preservation + no JSON.stringify equality', () => {
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    assert(
      record.result === canonicalValidResult,
      'createStoredAdvisoryResultRecord must preserve exact result reference'
    );

    const filePath = join(process.cwd(), 'peia-worker/src/localAdvisoryResultOutboxContract.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes("from './advisoryResultContract'"), 'Must import from advisoryResultContract');
    assert(source.includes('PEIAAdvisoryResult'), 'Must import PEIAAdvisoryResult');
    assert(source.includes('validatePEIAAdvisoryResult'), 'Must import validatePEIAAdvisoryResult');
    assert(source.includes('return input as StoredAdvisoryResultRecord;'), 'Must return input directly by identity in validator');
    assert(!source.includes('JSON.stringify'), 'Must not use JSON.stringify');
    assert(!source.includes('structuredClone'), 'Must not use structuredClone');
    assert(!source.includes('.sort('), 'Must not sort findings');
  });

  // 42. exact error contract + exact final count gate
  await test('42. exact error contract + exact final count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/localAdvisoryResultOutboxContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const requiredSymbols = [
      'LocalAdvisoryResultOutboxState',
      'StoredAdvisoryResultRecord',
      'LocalAdvisoryResultOutboxRepository',
      'LocalAdvisoryResultOutboxContractError',
      'createStoredAdvisoryResultRecord',
      'validateStoredAdvisoryResultRecord',
      'isSameStoredAdvisoryResultRecord',
    ];

    for (const sym of requiredSymbols) {
      assert(source.includes(sym), `Required symbol "${sym}" missing from source`);
    }

    // A. EXACT OUTBOX STATE VOCABULARY
    const stateMatch = source.match(
      /export\s+const\s+LocalAdvisoryResultOutboxState\s*=\s*\{([^}]+)\}\s*as\s*const;/
    );
    assert(stateMatch !== null, 'Must extract LocalAdvisoryResultOutboxState definition');
    const stateBody = stateMatch![1];
    const stateEntries = stateBody
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    assert(stateEntries.length === 1, `Expected exactly 1 state entry, got ${stateEntries.length}`);
    assert(
      stateEntries[0].replace(/\s+/g, '') === "PendingUpload:'PendingUpload'",
      `State entry must be PendingUpload: 'PendingUpload', got "${stateEntries[0]}"`
    );

    // B. NO SERVER/LOCAL GENERATED METADATA
    const forbiddenMetadata = [
      'resultId',
      'generatedAt',
      'createdAt',
      'updatedAt',
      'queuedAt',
      'uploadedAt',
      'attemptCount',
      'retryCount',
      'lastError',
      'serverStatus',
      'principalId',
      'providerId',
      'executionState',
      'isAdvisoryOnly',
    ];
    for (const field of forbiddenMetadata) {
      assert(!source.includes(field), `Forbidden metadata field "${field}" found in source`);
    }

    // C. EXACT STORED RECORD SHAPE
    const recordMatch = source.match(
      /export\s+interface\s+StoredAdvisoryResultRecord\s*\{([^}]+)\}/
    );
    assert(recordMatch !== null, 'Must extract StoredAdvisoryResultRecord interface');
    const recordFields = recordMatch![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    assert(recordFields.length === 2, `Expected exactly 2 fields in StoredAdvisoryResultRecord, got ${recordFields.length}`);
    assert(recordFields[0].includes('result: PEIAAdvisoryResult'), 'Field 1 must be result: PEIAAdvisoryResult');
    assert(
      recordFields[1].includes('localState: typeof LocalAdvisoryResultOutboxState.PendingUpload'),
      'Field 2 must be localState'
    );

    // D. ERROR CONTRACT
    const errorCodeTypeMatch = source.match(
      /export\s+type\s+LocalAdvisoryResultOutboxContractErrorCode\s*=\s*([^;]+);/
    );
    assert(errorCodeTypeMatch !== null, 'Must declare LocalAdvisoryResultOutboxContractErrorCode type');
    const errorCodes = errorCodeTypeMatch![1]
      .split('|')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s.length > 0);
    assert(errorCodes.length === 2, `Expected exactly 2 error codes, got ${errorCodes.length}`);
    assert(errorCodes.includes('INVALID_ADVISORY_RESULT'), 'Must contain INVALID_ADVISORY_RESULT');
    assert(errorCodes.includes('INVALID_STORED_RECORD'), 'Must contain INVALID_STORED_RECORD');

    const err1 = new LocalAdvisoryResultOutboxContractError('INVALID_ADVISORY_RESULT');
    assert(err1.code === 'INVALID_ADVISORY_RESULT', 'err1 code must match');
    assert(err1.message === 'Invalid advisory result for local outbox.', 'err1 message must match');

    const err2 = new LocalAdvisoryResultOutboxContractError('INVALID_STORED_RECORD');
    assert(err2.code === 'INVALID_STORED_RECORD', 'err2 code must match');
    assert(err2.message === 'Stored advisory result record is invalid.', 'err2 message must match');

    const constructorMatch = source.match(/constructor\s*\(([^)]*)\)/);
    assert(constructorMatch !== null, 'Must find constructor definition');
    const constructorParams = constructorMatch![1].trim();
    assert(
      constructorParams === 'code: LocalAdvisoryResultOutboxContractErrorCode',
      `Constructor must accept ONLY code, got: "${constructorParams}"`
    );
    assert(!constructorParams.includes('message'), 'Constructor must not accept message parameter');

    // E. NO LIFECYCLE EXPANSION
    const forbiddenStates = [
      'Uploading',
      'Uploaded',
      'Acknowledged',
      'Failed',
      'Retrying',
      'Rejected',
      'Approved',
      'Completed',
      'Synced',
    ];
    for (const st of forbiddenStates) {
      assert(!source.includes(`'${st}'`) && !source.includes(`"${st}"`), `Forbidden lifecycle state "${st}" found in source`);
    }

    // F. FINAL COUNT
    assert(totalTests === 42, `Expected exactly 42 tests, found ${totalTests}`);
    assert(passedTests === 41, `Expected 41 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 42, `Expected exactly 42 tests, found ${totalTests}`);
  assert(passedTests === 42, `Expected exactly 42 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
