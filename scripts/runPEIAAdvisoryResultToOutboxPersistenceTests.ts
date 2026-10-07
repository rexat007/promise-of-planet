import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  persistAdvisoryResultToOutbox,
  type PersistAdvisoryResultToOutboxResult,
} from '../peia-worker/src/advisoryResultToOutboxPersistence';
import {
  LocalAdvisoryResultOutboxState,
  LocalAdvisoryResultOutboxContractError,
  type LocalAdvisoryResultOutboxRepository,
  type StoredAdvisoryResultRecord,
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

class InMemoryTestRepository implements LocalAdvisoryResultOutboxRepository {
  saveCallCount = 0;
  findByTaskIdCallCount = 0;
  listPendingUploadCallCount = 0;
  savedRecords: StoredAdvisoryResultRecord[] = [];
  saveImpl?: (record: StoredAdvisoryResultRecord) => Promise<void>;

  async save(record: StoredAdvisoryResultRecord): Promise<void> {
    this.saveCallCount++;
    this.savedRecords.push(record);
    if (this.saveImpl) {
      await this.saveImpl(record);
    }
  }

  async findByTaskId(_taskId: string): Promise<StoredAdvisoryResultRecord | null> {
    this.findByTaskIdCallCount++;
    return null;
  }

  async listPendingUpload(): Promise<readonly StoredAdvisoryResultRecord[]> {
    this.listPendingUploadCallCount++;
    return this.savedRecords;
  }
}

const canonicalFindings: readonly PEIAAdvisoryFinding[] = [
  {
    code: 'METRIC_VERIFICATION_NEEDED',
    severity: AIReviewSeverity.Info,
    message: 'Rainfall metrics require human verification against official records.',
    evidenceIds: ['EPA::rain-metrics-2026'],
  },
  {
    code: 'CITATION_SOURCE_OUTDATED',
    severity: AIReviewSeverity.Warning,
    message: 'Referenced policy guideline was revised in 2025.',
    evidenceIds: ['EPA::cwa-guideline-2025'],
  },
  {
    code: 'POTENTIAL_INCONSISTENCY_DETECTED',
    severity: AIReviewSeverity.ReviewRecommended,
    message: 'Section 3 directly contradicts Section 1 figures.',
    evidenceIds: ['EPA::cwa-sec-1', 'EPA::cwa-sec-3'],
  },
];

const canonicalValidResult: PEIAAdvisoryResult = {
  schemaVersion: 1,
  task: {
    taskId: 'task-canonical-202',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-987',
      sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
  humanReviewRequired: true,
  assessment: {
    summary: 'Comprehensive review completed. Three advisory findings recorded.',
    findings: canonicalFindings,
  },
  recommendations: ['Update citations to 2026 standards.'],
  uncertainties: ['Preliminary rainfall metrics.'],
  limitations: ['Limited to public EPA data.'],
};

async function runSuite() {
  console.log('--- PEIA-18D 32-Test Advisory Result to Outbox Persistence Audit ---');

  // 1. persistAdvisoryResultToOutbox exists
  await test('1. persistAdvisoryResultToOutbox exists', () => {
    assert(
      typeof persistAdvisoryResultToOutbox === 'function',
      'persistAdvisoryResultToOutbox must be a function'
    );
  });

  // 2. PersistAdvisoryResultToOutboxResult contract exists
  await test('2. PersistAdvisoryResultToOutboxResult contract exists', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(
      source.includes('export interface PersistAdvisoryResultToOutboxResult'),
      'Must declare PersistAdvisoryResultToOutboxResult interface'
    );
  });

  // 3. result kind vocabulary is only STORED
  await test('3. result kind vocabulary is only STORED', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+interface\s+PersistAdvisoryResultToOutboxResult\s*\{([^}]+)\}/
    );
    assert(match !== null, 'Must find PersistAdvisoryResultToOutboxResult interface');
    const body = match![1];

    assert(body.includes("kind: 'STORED'"), "Must have kind: 'STORED'");

    const forbiddenKinds = [
      'NO_TASK',
      'FAILED',
      'RETRY',
      'UPLOADED',
      'ACKNOWLEDGED',
      'PENDING',
      'SKIPPED',
    ];
    for (const k of forbiddenKinds) {
      assert(!body.includes(k), `Forbidden kind found: ${k}`);
    }
  });

  // 4. valid advisory result persists successfully
  await test('4. valid advisory result persists successfully', async () => {
    const repo = new InMemoryTestRepository();
    const outcome = await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(outcome.kind === 'STORED', 'Outcome kind must be STORED');
    assert(outcome.record !== undefined, 'Outcome record must be defined');
  });

  // 5. repository.save called exactly once
  await test('5. repository.save called exactly once', async () => {
    const repo = new InMemoryTestRepository();
    await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(repo.saveCallCount === 1, `Expected saveCallCount === 1, got ${repo.saveCallCount}`);
  });

  // 6. repository.save receives canonical StoredAdvisoryResultRecord
  await test('6. repository.save receives canonical StoredAdvisoryResultRecord', async () => {
    const repo = new InMemoryTestRepository();
    await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(repo.savedRecords.length === 1, 'Expected 1 saved record');
    const saved = repo.savedRecords[0];
    assert(saved.localState === LocalAdvisoryResultOutboxState.PendingUpload, 'Saved localState must be PendingUpload');
    assert(saved.result.task.taskId === canonicalValidResult.task.taskId, 'Saved taskId must match');
  });

  // 7. saved record.localState is PendingUpload
  await test('7. saved record.localState is PendingUpload', async () => {
    const repo = new InMemoryTestRepository();
    await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(
      repo.savedRecords[0].localState === LocalAdvisoryResultOutboxState.PendingUpload,
      'Saved record.localState must be PendingUpload'
    );
  });

  // 8. saved record.result is exact original input reference
  await test('8. saved record.result is exact original input reference', async () => {
    const repo = new InMemoryTestRepository();
    await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(
      repo.savedRecords[0].result === canonicalValidResult,
      'Saved record.result must be exact reference of canonicalValidResult'
    );
  });

  // 9. returned kind is STORED
  await test('9. returned kind is STORED', async () => {
    const repo = new InMemoryTestRepository();
    const outcome = await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(outcome.kind === 'STORED', 'Returned kind must be STORED');
  });

  // 10. returned record is exact same object passed to repository.save
  await test('10. returned record is exact same object passed to repository.save', async () => {
    const repo = new InMemoryTestRepository();
    const outcome = await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(
      outcome.record === repo.savedRecords[0],
      'Returned record must be identical instance to saved record'
    );
  });

  // 11. returned record.result is exact original input reference
  await test('11. returned record.result is exact original input reference', async () => {
    const repo = new InMemoryTestRepository();
    const outcome = await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(
      outcome.record.result === canonicalValidResult,
      'Returned record.result must be exact reference to input result'
    );
  });

  // 12. no clone of result
  await test('12. no clone of result', async () => {
    const repo = new InMemoryTestRepository();
    const outcome = await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(outcome.record.result === canonicalValidResult, 'Result must not be cloned');
  });

  // 13. no clone of record
  await test('13. no clone of record', async () => {
    const repo = new InMemoryTestRepository();
    const outcome = await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(outcome.record === repo.savedRecords[0], 'Record must not be cloned');
  });

  // 14. repository.save is awaited before function resolves
  await test('14. repository.save is awaited before function resolves', async () => {
    const repo = new InMemoryTestRepository();
    let resolveSavePromise!: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSavePromise = resolve;
    });

    repo.saveImpl = async () => {
      await savePromise;
    };

    let persistenceResolved = false;
    const persistPromise = persistAdvisoryResultToOutbox(canonicalValidResult, repo).then(
      (res) => {
        persistenceResolved = true;
        return res;
      }
    );

    // Yield macro/micro task turns
    await new Promise((r) => setTimeout(r, 10));
    assert(!persistenceResolved, 'persistAdvisoryResultToOutbox must not resolve before save completes');

    resolveSavePromise();
    const result = await persistPromise;
    assert(persistenceResolved, 'persistAdvisoryResultToOutbox must resolve after save resolves');
    assert(result.kind === 'STORED', 'Result must be STORED');
  });

  // 15. repository rejection propagates unchanged
  await test('15. repository rejection propagates unchanged', async () => {
    const repo = new InMemoryTestRepository();
    const sentinelError = new Error('repository failure sentinel');
    repo.saveImpl = async () => {
      throw sentinelError;
    };

    let caughtError: unknown = null;
    try {
      await persistAdvisoryResultToOutbox(canonicalValidResult, repo);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === sentinelError, 'Caught error must match repository rejection');
  });

  // 16. repository rejection object identity preserved
  await test('16. repository rejection object identity preserved', async () => {
    const repo = new InMemoryTestRepository();
    const customErrorObj = { message: 'custom failure object', code: 500 };
    repo.saveImpl = async () => {
      throw customErrorObj;
    };

    let caughtError: unknown = null;
    try {
      await persistAdvisoryResultToOutbox(canonicalValidResult, repo);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === customErrorObj, 'Caught error object reference must be preserved');
  });

  // 17. repository rejection causes no second save call
  await test('17. repository rejection causes no second save call', async () => {
    const repo = new InMemoryTestRepository();
    const sentinelError = new Error('fail immediately sentinel');
    repo.saveImpl = async () => {
      throw sentinelError;
    };

    let caughtError: unknown = null;
    try {
      await persistAdvisoryResultToOutbox(canonicalValidResult, repo);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === sentinelError, 'Caught error must match sentinelError identity');
    assert(repo.saveCallCount === 1, `saveCallCount must be 1, got ${repo.saveCallCount}`);
  });

  // 18. invalid advisory result propagates LocalAdvisoryResultOutboxContractError unchanged
  await test('18. invalid advisory result propagates LocalAdvisoryResultOutboxContractError unchanged', async () => {
    const repo = new InMemoryTestRepository();
    const invalidResult = {
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskId: '',
      },
    } as unknown as PEIAAdvisoryResult;

    let caughtError: unknown = null;
    try {
      await persistAdvisoryResultToOutbox(invalidResult, repo);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof LocalAdvisoryResultOutboxContractError,
      'Error must be instanceof LocalAdvisoryResultOutboxContractError'
    );
  });

  // 19. invalid advisory result code remains INVALID_ADVISORY_RESULT
  await test('19. invalid advisory result code remains INVALID_ADVISORY_RESULT', async () => {
    const repo = new InMemoryTestRepository();
    const invalidResult = {
      ...canonicalValidResult,
      assessment: {
        summary: '',
        findings: [],
      },
    } as unknown as PEIAAdvisoryResult;

    let caughtError: unknown = null;
    try {
      await persistAdvisoryResultToOutbox(invalidResult, repo);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof LocalAdvisoryResultOutboxContractError,
      'Error must be LocalAdvisoryResultOutboxContractError'
    );
    assert(
      (caughtError as LocalAdvisoryResultOutboxContractError).code === 'INVALID_ADVISORY_RESULT',
      `Expected code INVALID_ADVISORY_RESULT, got ${(caughtError as LocalAdvisoryResultOutboxContractError).code}`
    );
  });

  // 20. invalid advisory result fixed message remains exact
  await test('20. invalid advisory result fixed message remains exact', async () => {
    const repo = new InMemoryTestRepository();
    const invalidResult = {
      task: 'invalid-task',
    } as unknown as PEIAAdvisoryResult;

    let caughtError: unknown = null;
    try {
      await persistAdvisoryResultToOutbox(invalidResult, repo);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof LocalAdvisoryResultOutboxContractError,
      'Error must be LocalAdvisoryResultOutboxContractError'
    );
    assert(
      (caughtError as LocalAdvisoryResultOutboxContractError).message === 'Invalid advisory result for local outbox.',
      `Expected fixed message "Invalid advisory result for local outbox.", got "${(caughtError as LocalAdvisoryResultOutboxContractError).message}"`
    );
  });

  // 21. invalid advisory result prevents repository.save call
  await test('21. invalid advisory result prevents repository.save call', async () => {
    const repo = new InMemoryTestRepository();
    const invalidResult = {
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskId: '',
      },
    } as unknown as PEIAAdvisoryResult;

    let caughtError: unknown = null;
    try {
      await persistAdvisoryResultToOutbox(invalidResult, repo);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof LocalAdvisoryResultOutboxContractError,
      'Error must be instanceof LocalAdvisoryResultOutboxContractError'
    );
    assert(
      (caughtError as LocalAdvisoryResultOutboxContractError).code === 'INVALID_ADVISORY_RESULT',
      'Error code must be INVALID_ADVISORY_RESULT'
    );
    assert(
      (caughtError as LocalAdvisoryResultOutboxContractError).message === 'Invalid advisory result for local outbox.',
      'Error message must be "Invalid advisory result for local outbox."'
    );
    assert(repo.saveCallCount === 0, `repo.saveCallCount must remain 0, got ${repo.saveCallCount}`);
  });

  // 22. operation order is create record before save
  await test('22. operation order is create record before save', async () => {
    const repo = new InMemoryTestRepository();
    const events: string[] = [];

    repo.saveImpl = async (record) => {
      events.push('save');
      assert(record.localState === LocalAdvisoryResultOutboxState.PendingUpload, 'Record must be already constructed before save');
      assert(record.result === canonicalValidResult, 'Record must contain canonical result before save');
    };

    await persistAdvisoryResultToOutbox(canonicalValidResult, repo);
    assert(events.length === 1 && events[0] === 'save', 'Save event must occur');
  });

  // 23. no repository method other than save is called
  await test('23. no repository method other than save is called', async () => {
    const repo = new InMemoryTestRepository();
    await persistAdvisoryResultToOutbox(canonicalValidResult, repo);

    assert(repo.saveCallCount === 1, 'saveCallCount must be 1');
    assert(repo.findByTaskIdCallCount === 0, 'findByTaskIdCallCount must be 0');
    assert(repo.listPendingUploadCallCount === 0, 'listPendingUploadCallCount must be 0');
  });

  // 24. separate structurally identical input results produce separate record objects
  await test('24. separate structurally identical input results produce separate record objects', async () => {
    const repo = new InMemoryTestRepository();

    const inputA: PEIAAdvisoryResult = {
      schemaVersion: 1,
      task: {
        taskId: 'task-same-id',
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: AIReviewTargetType.News,
          targetId: 'news-987',
          sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
        },
      },
      humanReviewRequired: true,
      assessment: {
        summary: 'Summary A',
        findings: canonicalFindings,
      },
      recommendations: ['Update citations to 2026 standards.'],
      uncertainties: ['Preliminary rainfall metrics.'],
      limitations: ['Limited to public EPA data.'],
    };

    const inputB: PEIAAdvisoryResult = {
      schemaVersion: 1,
      task: {
        taskId: 'task-same-id',
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: AIReviewTargetType.News,
          targetId: 'news-987',
          sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
        },
      },
      humanReviewRequired: true,
      assessment: {
        summary: 'Summary A',
        findings: canonicalFindings,
      },
      recommendations: ['Update citations to 2026 standards.'],
      uncertainties: ['Preliminary rainfall metrics.'],
      limitations: ['Limited to public EPA data.'],
    };

    const outcomeA = await persistAdvisoryResultToOutbox(inputA, repo);
    const outcomeB = await persistAdvisoryResultToOutbox(inputB, repo);

    assert(outcomeA.record !== outcomeB.record, 'Separate input results must produce separate record objects');
  });

  // 25. each produced record preserves its own exact result reference
  await test('25. each produced record preserves its own exact result reference', async () => {
    const repo = new InMemoryTestRepository();

    const inputA: PEIAAdvisoryResult = { ...canonicalValidResult };
    const inputB: PEIAAdvisoryResult = { ...canonicalValidResult };

    const outcomeA = await persistAdvisoryResultToOutbox(inputA, repo);
    const outcomeB = await persistAdvisoryResultToOutbox(inputB, repo);

    assert(outcomeA.record.result === inputA, 'Record A must point to input A');
    assert(outcomeB.record.result === inputB, 'Record B must point to input B');
  });

  // 26. source imports PEIAAdvisoryResult from advisoryResultContract
  await test('26. source imports PEIAAdvisoryResult from advisoryResultContract', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes("from './advisoryResultContract'"), "Must import from './advisoryResultContract'");
    assert(source.includes('PEIAAdvisoryResult'), 'Must import PEIAAdvisoryResult');
  });

  // 27. source imports repository/record/create function from localAdvisoryResultOutboxContract
  await test('27. source imports repository/record/create function from localAdvisoryResultOutboxContract', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes("from './localAdvisoryResultOutboxContract'"), "Must import from './localAdvisoryResultOutboxContract'");
    assert(source.includes('createStoredAdvisoryResultRecord'), 'Must import createStoredAdvisoryResultRecord');
    assert(source.includes('LocalAdvisoryResultOutboxRepository'), 'Must import LocalAdvisoryResultOutboxRepository');
    assert(source.includes('StoredAdvisoryResultRecord'), 'Must import StoredAdvisoryResultRecord');
  });

  // 28. source contains no SQLite/database dependency
  await test('28. source contains no SQLite/database dependency', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'SqliteAdvisoryResultOutboxRepository',
      'DatabaseSync',
      'node:sqlite',
      'databasePath',
    ];

    for (const f of forbidden) {
      assert(!source.includes(f), `Forbidden database dependency found: ${f}`);
    }
  });

  // 29. source contains no network/upload/retry/scheduling behavior
  await test('29. source contains no network/upload/retry/scheduling behavior', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'fetch(',
      'globalThis.fetch',
      'Authorization',
      'Bearer',
      'credential',
      'endpointUrl',
      'HTTP',
      'HTTPS',
      'upload',
      'markUploaded',
      'acknowledge',
      'retry',
      'backoff',
      'poll',
      'setInterval',
      'setTimeout',
      'cron',
      'schedule',
      'claim',
      'lease',
    ];

    for (const f of forbidden) {
      assert(!source.includes(f), `Forbidden token found: ${f}`);
    }
  });

  // 30. source contains no authority/generated metadata/time/randomness
  await test('30. source contains no authority/generated metadata/time/randomness', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'AIReviewArtifact',
      'AIReviewFinding',
      'decision',
      'suggestedAction',
      'approved',
      'rejected',
      'published',
      'workflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
      'override',
      'execute',
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
      'contentSnapshot',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
    ];

    for (const f of forbidden) {
      assert(!source.includes(f), `Forbidden token found: ${f}`);
    }
  });

  // 31. source proves no catch/retry/clone/JSON serialization and save exactly once
  await test('31. source proves no catch/retry/clone/JSON serialization and save exactly once', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    const funcMatch = source.match(
      /export\s+async\s+function\s+persistAdvisoryResultToOutbox\s*\([^)]*\)[^{]*\{([\s\S]*)\}/
    );
    assert(funcMatch !== null, 'Must extract persistAdvisoryResultToOutbox function');
    const body = funcMatch![1];

    const createCount = (body.match(/createStoredAdvisoryResultRecord\(/g) || []).length;
    assert(createCount === 1, `createStoredAdvisoryResultRecord must appear exactly once, got ${createCount}`);

    const saveCount = (body.match(/repository\.save\(/g) || []).length;
    assert(saveCount === 1, `repository.save must appear exactly once, got ${saveCount}`);

    assert(body.includes('await repository.save(record);'), 'Must await repository.save');

    assert(!body.includes('catch'), 'Function must not contain catch block');
    assert(!body.includes('.catch('), 'Function must not contain .catch(');
    assert(!body.includes('for ('), 'Function must not contain loop');
    assert(!body.includes('while ('), 'Function must not contain while');
    assert(!body.includes('JSON.stringify'), 'Function must not stringify');
    assert(!body.includes('JSON.parse'), 'Function must not parse JSON');
    assert(!body.includes('structuredClone'), 'Function must not clone');
    assert(!body.includes('...'), 'Function must not spread clone');
  });

  // 32. final self-contained source invariant + exact test-count gate
  await test('32. final self-contained source invariant + exact test-count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultToOutboxPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    // A. REQUIRED SYMBOLS
    const requiredSymbols = [
      'PersistAdvisoryResultToOutboxResult',
      'persistAdvisoryResultToOutbox',
    ];
    for (const sym of requiredSymbols) {
      assert(source.includes(sym), `Required symbol "${sym}" missing from source`);
    }

    // B. EXACT RESULT CONTRACT
    const resultInterfaceMatch = source.match(
      /export\s+interface\s+PersistAdvisoryResultToOutboxResult\s*\{([^}]+)\}/
    );
    assert(resultInterfaceMatch !== null, 'Must find PersistAdvisoryResultToOutboxResult interface');
    const resultFields = resultInterfaceMatch![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    assert(resultFields.length === 2, `Expected exactly 2 fields in PersistAdvisoryResultToOutboxResult, got ${resultFields.length}`);
    assert(resultFields[0].includes("readonly kind: 'STORED'"), 'Field 1 must be readonly kind: STORED');
    assert(resultFields[1].includes('readonly record: StoredAdvisoryResultRecord'), 'Field 2 must be readonly record: StoredAdvisoryResultRecord');

    const forbiddenKinds = [
      'NO_TASK',
      'FAILED',
      'RETRY',
      'UPLOADED',
      'ACKNOWLEDGED',
      'PENDING',
      'SKIPPED',
    ];
    for (const k of forbiddenKinds) {
      assert(!resultInterfaceMatch![1].includes(k), `Forbidden result kind "${k}" found`);
    }

    // C. CANONICAL IMPORTS
    assert(source.includes("from './advisoryResultContract'"), "Must import from './advisoryResultContract'");
    assert(source.includes('PEIAAdvisoryResult'), 'Must import PEIAAdvisoryResult');
    assert(source.includes("from './localAdvisoryResultOutboxContract'"), "Must import from './localAdvisoryResultOutboxContract'");
    assert(source.includes('createStoredAdvisoryResultRecord'), 'Must import createStoredAdvisoryResultRecord');
    assert(source.includes('LocalAdvisoryResultOutboxRepository'), 'Must import LocalAdvisoryResultOutboxRepository');
    assert(source.includes('StoredAdvisoryResultRecord'), 'Must import StoredAdvisoryResultRecord');

    // D. EXACT FUNCTION STRUCTURE
    const funcMatch = source.match(
      /export\s+async\s+function\s+persistAdvisoryResultToOutbox\s*\([^)]*\)[^{]*\{([\s\S]*)\}/
    );
    assert(funcMatch !== null, 'Must extract persistAdvisoryResultToOutbox function');
    const body = funcMatch![1];

    const createCount = (body.match(/createStoredAdvisoryResultRecord\(result\)/g) || []).length;
    assert(createCount === 1, `createStoredAdvisoryResultRecord(result) must appear exactly once, got ${createCount}`);

    const saveCount = (body.match(/repository\.save\(record\)/g) || []).length;
    assert(saveCount === 1, `repository.save(record) must appear exactly once, got ${saveCount}`);

    assert(body.includes('await repository.save(record);'), 'Must contain exact awaited call: await repository.save(record);');
    assert(body.includes("kind: 'STORED'"), 'Return must contain kind: STORED');
    assert(body.includes('record,'), 'Return must contain record');

    // E. ERROR PROPAGATION / NO WRAPPING
    assert(!body.includes('try'), 'Function body must contain no try block');
    assert(!body.includes('catch'), 'Function body must contain no catch block');
    assert(!body.includes('.catch('), 'Function body must contain no .catch(');

    // F. NO RETRY / LOOP
    const forbiddenLoopControl = [
      'for (',
      'while (',
      'retry',
      'backoff',
      'poll',
      'setInterval',
      'setTimeout',
      'cron',
      'schedule',
      'claim',
      'lease',
    ];
    for (const token of forbiddenLoopControl) {
      assert(!source.includes(token), `Forbidden token "${token}" found in source`);
    }

    // G. NO SQLITE / DATABASE
    const forbiddenDb = [
      'SqliteAdvisoryResultOutboxRepository',
      'DatabaseSync',
      'node:sqlite',
      'databasePath',
    ];
    for (const dbSym of forbiddenDb) {
      assert(!source.includes(dbSym), `Forbidden DB symbol "${dbSym}" found in source`);
    }

    // H. NO NETWORK / UPLOAD
    const forbiddenNetwork = [
      'fetch(',
      'globalThis.fetch',
      'Authorization',
      'Bearer',
      'credential',
      'endpointUrl',
      'HTTP',
      'HTTPS',
      'upload',
      'markUploaded',
      'acknowledge',
    ];
    for (const net of forbiddenNetwork) {
      assert(!source.includes(net), `Forbidden network token "${net}" found in source`);
    }

    // I. NO AUTHORITY / PLATFORM ARTIFACT
    const forbiddenAuthority = [
      'AIReviewArtifact',
      'AIReviewFinding',
      'decision',
      'suggestedAction',
      'approved',
      'rejected',
      'published',
      'workflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
      'override',
      'execute',
    ];
    for (const auth of forbiddenAuthority) {
      assert(!source.includes(auth), `Forbidden authority token "${auth}" found in source`);
    }

    // J. NO GENERATED METADATA / TIME / RANDOMNESS
    const forbiddenMeta = [
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
      'contentSnapshot',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
    ];
    for (const meta of forbiddenMeta) {
      assert(!source.includes(meta), `Forbidden metadata/time/randomness token "${meta}" found in source`);
    }

    // K. NO CLONE / SERIALIZATION
    assert(!source.includes('JSON.stringify'), 'Must not contain JSON.stringify');
    assert(!source.includes('JSON.parse'), 'Must not contain JSON.parse');
    assert(!source.includes('structuredClone'), 'Must not contain structuredClone');
    assert(!body.includes('...'), 'Function body must not contain spread clone');

    // L. FINAL COUNT
    assert(totalTests === 32, `Expected exactly 32 tests, found ${totalTests}`);
    assert(passedTests === 31, `Expected 31 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 32, `Expected exactly 32 tests, found ${totalTests}`);
  assert(passedTests === 32, `Expected exactly 32 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
