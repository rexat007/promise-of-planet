import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runSingleAdvisoryResultPersistenceCycle,
  runSingleAdvisoryResultPersistenceCycleWithDependencies,
  type SingleAdvisoryResultPersistenceCycleInput,
  type SingleAdvisoryResultPersistenceCycleDependencies,
} from '../peia-worker/src/singleAdvisoryResultPersistenceCycle';
import {
  LocalAdvisoryResultOutboxState,
  type LocalAdvisoryResultOutboxRepository,
  type StoredAdvisoryResultRecord,
} from '../peia-worker/src/localAdvisoryResultOutboxContract';
import {
  type PersistAdvisoryResultToOutboxResult,
} from '../peia-worker/src/advisoryResultToOutboxPersistence';
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

class FakeClosableOutboxRepository implements LocalAdvisoryResultOutboxRepository {
  closeCallCount = 0;
  saveCallCount = 0;
  findByTaskIdCallCount = 0;
  listPendingUploadCallCount = 0;
  onClose?: () => void;

  close(): void {
    this.closeCallCount++;
    if (this.onClose) {
      this.onClose();
    }
  }

  async save(_record: StoredAdvisoryResultRecord): Promise<void> {
    this.saveCallCount++;
  }

  async findByTaskId(_taskId: string): Promise<StoredAdvisoryResultRecord | null> {
    this.findByTaskIdCallCount++;
    return null;
  }

  async listPendingUpload(): Promise<readonly StoredAdvisoryResultRecord[]> {
    this.listPendingUploadCallCount++;
    return [];
  }
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
];

const canonicalValidResult: PEIAAdvisoryResult = {
  task: {
    taskId: 'task-canonical-303',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-987',
      sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
  assessment: {
    summary: 'Comprehensive review completed.',
    findings: canonicalFindings,
  },
};

const canonicalStoredRecord: StoredAdvisoryResultRecord = {
  result: canonicalValidResult,
  localState: LocalAdvisoryResultOutboxState.PendingUpload,
};

const sentinelPersistResult: PersistAdvisoryResultToOutboxResult = {
  kind: 'STORED',
  record: canonicalStoredRecord,
};

async function runSuite() {
  console.log('--- PEIA-18E 34-Test Single Advisory Result Persistence Cycle Audit ---');

  // 1. SingleAdvisoryResultPersistenceCycleInput exists
  await test('1. SingleAdvisoryResultPersistenceCycleInput exists', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(
      source.includes('export interface SingleAdvisoryResultPersistenceCycleInput'),
      'Must export SingleAdvisoryResultPersistenceCycleInput'
    );
  });

  // 2. input contract has exactly databasePath + result
  await test('2. input contract has exactly databasePath + result', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+interface\s+SingleAdvisoryResultPersistenceCycleInput\s*\{([^}]+)\}/
    );
    assert(match !== null, 'Must match SingleAdvisoryResultPersistenceCycleInput');
    const fields = match![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    assert(fields.length === 2, `Expected exactly 2 fields in input contract, got ${fields.length}`);
    assert(fields[0].includes('readonly databasePath: string'), 'Field 1 must be readonly databasePath: string');
    assert(fields[1].includes('readonly result: PEIAAdvisoryResult'), 'Field 2 must be readonly result: PEIAAdvisoryResult');
  });

  // 3. SingleAdvisoryResultPersistenceCycleDependencies exists
  await test('3. SingleAdvisoryResultPersistenceCycleDependencies exists', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(
      source.includes('export interface SingleAdvisoryResultPersistenceCycleDependencies'),
      'Must export SingleAdvisoryResultPersistenceCycleDependencies'
    );
  });

  // 4. dependency contract has exactly createRepository + persistResult
  await test('4. dependency contract has exactly createRepository + persistResult', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+interface\s+SingleAdvisoryResultPersistenceCycleDependencies\s*\{([\s\S]*?)\n\}/
    );
    assert(match !== null, 'Must match SingleAdvisoryResultPersistenceCycleDependencies');
    const body = match![1];

    const memberDeclarations = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('readonly '));

    assert(
      memberDeclarations.length === 2,
      `Expected exactly 2 readonly members in dependencies interface, got ${memberDeclarations.length}`
    );
    assert(body.includes('readonly createRepository:'), 'Must declare readonly createRepository');
    assert(body.includes('readonly persistResult:'), 'Must declare readonly persistResult');

    const forbiddenHooks = [
      'log',
      'logger',
      'notify',
      'upload',
      'retry',
      'beforeSave',
      'afterSave',
      'onError',
    ];
    for (const hook of forbiddenHooks) {
      assert(!body.includes(hook), `Forbidden dependency hook "${hook}" found`);
    }
  });

  // 5. runSingleAdvisoryResultPersistenceCycleWithDependencies exists
  await test('5. runSingleAdvisoryResultPersistenceCycleWithDependencies exists', () => {
    assert(
      typeof runSingleAdvisoryResultPersistenceCycleWithDependencies === 'function',
      'runSingleAdvisoryResultPersistenceCycleWithDependencies must be a function'
    );
  });

  // 6. runSingleAdvisoryResultPersistenceCycle exists
  await test('6. runSingleAdvisoryResultPersistenceCycle exists', () => {
    assert(
      typeof runSingleAdvisoryResultPersistenceCycle === 'function',
      'runSingleAdvisoryResultPersistenceCycle must be a function'
    );
  });

  // 7. createRepository receives exact databasePath
  await test('7. createRepository receives exact databasePath', async () => {
    let capturedPath = '';
    const fakeRepo = new FakeClosableOutboxRepository();

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test-peia-outbox.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: (dbPath: string) => {
        capturedPath = dbPath;
        return fakeRepo;
      },
      persistResult: async () => sentinelPersistResult,
    });

    assert(capturedPath === input.databasePath, `Expected path "${input.databasePath}", got "${capturedPath}"`);
  });

  // 8. createRepository called exactly once
  await test('8. createRepository called exactly once', async () => {
    let createCount = 0;
    const fakeRepo = new FakeClosableOutboxRepository();

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => {
        createCount++;
        return fakeRepo;
      },
      persistResult: async () => sentinelPersistResult,
    });

    assert(createCount === 1, `createRepository must be called 1 time, got ${createCount}`);
  });

  // 9. persistResult receives exact input result reference
  await test('9. persistResult receives exact input result reference', async () => {
    let passedResult: PEIAAdvisoryResult | null = null;
    const fakeRepo = new FakeClosableOutboxRepository();

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async (res) => {
        passedResult = res;
        return sentinelPersistResult;
      },
    });

    assert(passedResult === canonicalValidResult, 'persistResult must receive exact input result reference');
  });

  // 10. persistResult receives exact created repository reference
  await test('10. persistResult receives exact created repository reference', async () => {
    let passedRepo: LocalAdvisoryResultOutboxRepository | null = null;
    const fakeRepo = new FakeClosableOutboxRepository();

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async (_res, repo) => {
        passedRepo = repo;
        return sentinelPersistResult;
      },
    });

    assert(passedRepo === fakeRepo, 'persistResult must receive exact created repository reference');
  });

  // 11. persistResult called exactly once
  await test('11. persistResult called exactly once', async () => {
    let persistCount = 0;
    const fakeRepo = new FakeClosableOutboxRepository();

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async () => {
        persistCount++;
        return sentinelPersistResult;
      },
    });

    assert(persistCount === 1, `persistResult must be called exactly once, got ${persistCount}`);
  });

  // 12. successful persistence result returned unchanged
  await test('12. successful persistence result returned unchanged', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    const outcome = await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async () => sentinelPersistResult,
    });

    assert(outcome.kind === 'STORED', 'Returned kind must be STORED');
    assert(outcome.record === canonicalStoredRecord, 'Returned record must match canonicalStoredRecord');
  });

  // 13. exact returned object identity preserved
  await test('13. exact returned object identity preserved', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const uniqueSentinel: PersistAdvisoryResultToOutboxResult = {
      kind: 'STORED',
      record: {
        result: canonicalValidResult,
        localState: LocalAdvisoryResultOutboxState.PendingUpload,
      },
    };

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    const outcome = await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async () => uniqueSentinel,
    });

    assert(outcome === uniqueSentinel, 'Returned outcome must be exact reference to uniqueSentinel');
  });

  // 14. repository close called after successful persistence
  await test('14. repository close called after successful persistence', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async () => sentinelPersistResult,
    });

    assert(fakeRepo.closeCallCount > 0, 'Repository close must be called');
  });

  // 15. repository close called exactly once on success
  await test('15. repository close called exactly once on success', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async () => sentinelPersistResult,
    });

    assert(fakeRepo.closeCallCount === 1, `closeCallCount must be 1, got ${fakeRepo.closeCallCount}`);
  });

  // 16. repository close occurs after persistence resolves
  await test('16. repository close occurs after persistence resolves', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const events: string[] = [];

    fakeRepo.onClose = () => {
      events.push('close');
    };

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async () => {
        events.push('persist-start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push('persist-resolve');
        return sentinelPersistResult;
      },
    });

    assert(events.length === 3, `Expected 3 events, got ${events.length}`);
    assert(events[0] === 'persist-start', 'Event 0 must be persist-start');
    assert(events[1] === 'persist-resolve', 'Event 1 must be persist-resolve');
    assert(events[2] === 'close', 'Event 2 must be close');
  });

  // 17. rejected persistence error propagates unchanged
  await test('17. rejected persistence error propagates unchanged', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const sentinelError = new Error('persistence failure sentinel');

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    let caughtError: unknown = null;
    try {
      await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
        createRepository: () => fakeRepo,
        persistResult: async () => {
          throw sentinelError;
        },
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === sentinelError, 'Caught error must match sentinelError identity');
  });

  // 18. repository close still called after rejected persistence
  await test('18. repository close still called after rejected persistence', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const persistenceError = new Error('persistence failure sentinel');

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    let caughtError: unknown = null;
    try {
      await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
        createRepository: () => fakeRepo,
        persistResult: async () => {
          throw persistenceError;
        },
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === persistenceError, 'Caught error must match persistenceError identity');
    assert(fakeRepo.closeCallCount === 1, `Repository close must be called once on failure, got ${fakeRepo.closeCallCount}`);
  });

  // 19. repository close called exactly once after rejection
  await test('19. repository close called exactly once after rejection', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const persistenceError = new Error('persistence failure sentinel');

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    let caughtError: unknown = null;
    try {
      await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
        createRepository: () => fakeRepo,
        persistResult: async () => {
          throw persistenceError;
        },
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === persistenceError, 'Caught error must match persistenceError identity');
    assert(fakeRepo.closeCallCount === 1, `closeCallCount must be 1, got ${fakeRepo.closeCallCount}`);
  });

  // 20. no retry after persistence rejection
  await test('20. no retry after persistence rejection', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    let persistCount = 0;
    const persistenceError = new Error('persistence retry sentinel');

    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    let caughtError: unknown = null;
    try {
      await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
        createRepository: () => fakeRepo,
        persistResult: async () => {
          persistCount++;
          throw persistenceError;
        },
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === persistenceError, 'Caught error must match persistenceError identity');
    assert(persistCount === 1, `persistResult must be called only 1 time on failure, got ${persistCount}`);
    assert(fakeRepo.closeCallCount === 1, `fakeRepo.closeCallCount must be 1, got ${fakeRepo.closeCallCount}`);
  });

  // 21. createRepository rejection propagates unchanged
  await test('21. createRepository rejection propagates unchanged', async () => {
    const creationError = new Error('repository creation failure sentinel');
    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/invalid/path',
      result: canonicalValidResult,
    };

    let caughtError: unknown = null;
    try {
      await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
        createRepository: () => {
          throw creationError;
        },
        persistResult: async () => sentinelPersistResult,
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === creationError, 'Caught error must match creationError');
  });

  // 22. createRepository rejection prevents persistResult call
  await test('22. createRepository rejection prevents persistResult call', async () => {
    let persistCount = 0;
    const creationError = new Error('repository creation failure sentinel');
    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/invalid/path',
      result: canonicalValidResult,
    };

    let caughtError: unknown = null;
    try {
      await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
        createRepository: () => {
          throw creationError;
        },
        persistResult: async () => {
          persistCount++;
          return sentinelPersistResult;
        },
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === creationError, 'Caught error must match creationError');
    assert(persistCount === 0, `persistResult must not be called, got ${persistCount}`);
  });

  // 23. createRepository rejection does not attempt close
  await test('23. createRepository rejection does not attempt close', async () => {
    let persistCount = 0;
    const creationError = new Error('repository creation failure sentinel');
    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/invalid/path',
      result: canonicalValidResult,
    };

    let caughtError: unknown = null;
    try {
      await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
        createRepository: () => {
          throw creationError;
        },
        persistResult: async () => {
          persistCount++;
          return sentinelPersistResult;
        },
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === creationError, 'Caught error must match creationError');
    assert(persistCount === 0, 'persistCount must be 0');

    // Structural proof: creation is outside try/finally, so close cannot be invoked on creation failure
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');
    const injectedFnMatch = source.match(
      /export\s+async\s+function\s+runSingleAdvisoryResultPersistenceCycleWithDependencies\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(injectedFnMatch !== null, 'Must match injected function body');
    const body = injectedFnMatch![1];

    const creationIndex = body.indexOf('dependencies.createRepository(input.databasePath)');
    const tryIndex = body.indexOf('try {');
    const finallyIndex = body.indexOf('finally {');
    const closeIndex = body.indexOf('repository.close();');

    assert(creationIndex !== -1 && tryIndex !== -1, 'createRepository and try must exist');
    assert(creationIndex < tryIndex, 'createRepository must appear strictly BEFORE try {');
    assert(closeIndex > finallyIndex, 'repository.close() must appear strictly inside finally {');
  });

  // 24. runtime does not call findByTaskId
  await test('24. runtime does not call findByTaskId', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async () => sentinelPersistResult,
    });

    assert(fakeRepo.findByTaskIdCallCount === 0, 'findByTaskId must not be called');
  });

  // 25. runtime does not call listPendingUpload
  await test('25. runtime does not call listPendingUpload', async () => {
    const fakeRepo = new FakeClosableOutboxRepository();
    const input: SingleAdvisoryResultPersistenceCycleInput = {
      databasePath: '/tmp/test.sqlite',
      result: canonicalValidResult,
    };

    await runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
      createRepository: () => fakeRepo,
      persistResult: async () => sentinelPersistResult,
    });

    assert(fakeRepo.listPendingUploadCallCount === 0, 'listPendingUpload must not be called');
  });

  // 26. source reuses canonical PEIA/result/repository types
  await test('26. source reuses canonical PEIA/result/repository types', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes("from './advisoryResultContract'"), "Must import from './advisoryResultContract'");
    assert(source.includes('PEIAAdvisoryResult'), 'Must import PEIAAdvisoryResult');

    assert(source.includes("from './advisoryResultToOutboxPersistence'"), "Must import from './advisoryResultToOutboxPersistence'");
    assert(source.includes('PersistAdvisoryResultToOutboxResult'), 'Must import PersistAdvisoryResultToOutboxResult');
    assert(source.includes('persistAdvisoryResultToOutbox'), 'Must import persistAdvisoryResultToOutbox');

    assert(source.includes("from './localAdvisoryResultOutboxContract'"), "Must import from './localAdvisoryResultOutboxContract'");
    assert(source.includes('LocalAdvisoryResultOutboxRepository'), 'Must import LocalAdvisoryResultOutboxRepository');

    assert(source.includes("from './sqliteAdvisoryResultOutboxRepository'"), "Must import from './sqliteAdvisoryResultOutboxRepository'");
    assert(source.includes('SqliteAdvisoryResultOutboxRepository'), 'Must import SqliteAdvisoryResultOutboxRepository');
  });

  // 27. real runtime constructs SqliteAdvisoryResultOutboxRepository
  await test('27. real runtime constructs SqliteAdvisoryResultOutboxRepository', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const realFnMatch = source.match(
      /export\s+async\s+function\s+runSingleAdvisoryResultPersistenceCycle\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(realFnMatch !== null, 'Must find runSingleAdvisoryResultPersistenceCycle');
    const body = realFnMatch![1];

    assert(
      body.includes('new SqliteAdvisoryResultOutboxRepository(databasePath)'),
      'Must construct SqliteAdvisoryResultOutboxRepository(databasePath)'
    );

    const constructionCount = (body.match(/new\s+SqliteAdvisoryResultOutboxRepository/g) || []).length;
    assert(constructionCount === 1, `Must contain exactly one SqliteAdvisoryResultOutboxRepository construction, got ${constructionCount}`);
  });

  // 28. real runtime delegates to persistAdvisoryResultToOutbox
  await test('28. real runtime delegates to persistAdvisoryResultToOutbox', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const realFnMatch = source.match(
      /export\s+async\s+function\s+runSingleAdvisoryResultPersistenceCycle\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(realFnMatch !== null, 'Must find runSingleAdvisoryResultPersistenceCycle');
    const body = realFnMatch![1];

    assert(
      body.includes('persistResult: persistAdvisoryResultToOutbox'),
      'Must wire persistResult to persistAdvisoryResultToOutbox'
    );
  });

  // 29. real runtime delegates through dependency-injected function
  await test('29. real runtime delegates through dependency-injected function', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const realFnMatch = source.match(
      /export\s+async\s+function\s+runSingleAdvisoryResultPersistenceCycle\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(realFnMatch !== null, 'Must find runSingleAdvisoryResultPersistenceCycle');
    const body = realFnMatch![1];

    assert(
      body.includes('return runSingleAdvisoryResultPersistenceCycleWithDependencies(input,'),
      'Must return result of runSingleAdvisoryResultPersistenceCycleWithDependencies'
    );
    assert(!body.includes('repository.save'), 'Must not call repository.save directly');
    assert(!body.includes('createStoredAdvisoryResultRecord'), 'Must not call createStoredAdvisoryResultRecord directly');
  });

  // 30. source contains no duplicate save/record-creation logic
  await test('30. source contains no duplicate save/record-creation logic', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'createStoredAdvisoryResultRecord',
      'validateStoredAdvisoryResultRecord',
      'isSameStoredAdvisoryResultRecord',
      'repository.save(',
      'CREATE TABLE',
      'INSERT INTO',
      'SELECT ',
      'UPDATE ',
      'DELETE ',
      'REPLACE ',
      'UPSERT ',
    ];

    for (const f of forbidden) {
      assert(!source.includes(f), `Forbidden duplicated logic/SQL found: "${f}"`);
    }
  });

  // 31. source contains no network/upload/retry/background behavior
  await test('31. source contains no network/upload/retry/background behavior', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
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
      'workerLoop',
    ];

    for (const f of forbidden) {
      assert(!source.includes(f), `Forbidden token found: "${f}"`);
    }
  });

  // 32. source contains no authority/generated metadata/time/randomness/serialization
  await test('32. source contains no authority/generated metadata/time/randomness/serialization', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
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
      'JSON.stringify',
      'JSON.parse',
      'structuredClone',
    ];

    for (const f of forbidden) {
      assert(!source.includes(f), `Forbidden token found: "${f}"`);
    }
  });

  // 33. source proves try/finally cleanup structure and no catch
  await test('33. source proves try/finally cleanup structure and no catch', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const injectedFnMatch = source.match(
      /export\s+async\s+function\s+runSingleAdvisoryResultPersistenceCycleWithDependencies\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(injectedFnMatch !== null, 'Must extract injected function body');
    const body = injectedFnMatch![1];

    const creationIndex = body.indexOf('dependencies.createRepository(input.databasePath)');
    const tryIndex = body.indexOf('try {');
    const persistIndex = body.indexOf('return await dependencies.persistResult(');
    const finallyIndex = body.indexOf('finally {');
    const closeIndex = body.indexOf('repository.close();');

    assert(creationIndex !== -1, 'Must call dependencies.createRepository');
    assert(tryIndex !== -1, 'Must contain try block');
    assert(persistIndex !== -1, 'Must call dependencies.persistResult inside try');
    assert(finallyIndex !== -1, 'Must contain finally block');
    assert(closeIndex !== -1, 'Must call repository.close() inside finally');

    assert(creationIndex < tryIndex, 'createRepository must occur before try block');
    assert(tryIndex < persistIndex, 'persistResult must occur inside try block');
    assert(persistIndex < finallyIndex, 'persistResult must occur before finally block');
    assert(finallyIndex < closeIndex, 'repository.close must occur inside finally block');

    assert(!body.includes('catch'), 'Injected function must not contain catch block');
    assert(!body.includes('.catch('), 'Injected function must not contain .catch(');

    const closeCount = (body.match(/repository\.close\(\)/g) || []).length;
    assert(closeCount === 1, `repository.close() must appear exactly once in injected function, got ${closeCount}`);
  });

  // 34. final self-contained source invariant + exact test-count gate
  await test('34. final self-contained source invariant + exact test-count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleAdvisoryResultPersistenceCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    // A. INPUT CONTRACT
    const inputMatch = source.match(
      /export\s+interface\s+SingleAdvisoryResultPersistenceCycleInput\s*\{([^}]+)\}/
    );
    assert(inputMatch !== null, 'Must find input contract');
    const inputFields = inputMatch![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    assert(inputFields.length === 2, `Input contract must have exactly 2 fields, got ${inputFields.length}`);
    assert(inputFields[0].includes('readonly databasePath: string'), 'Field 1 must be readonly databasePath: string');
    assert(inputFields[1].includes('readonly result: PEIAAdvisoryResult'), 'Field 2 must be readonly result: PEIAAdvisoryResult');

    // B. DEPENDENCY CONTRACT
    const depMatch = source.match(
      /export\s+interface\s+SingleAdvisoryResultPersistenceCycleDependencies\s*\{([\s\S]*?)\n\}/
    );
    assert(depMatch !== null, 'Must find dependencies contract');
    const depBody = depMatch![1];
    const depMembers = depBody
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('readonly '));
    assert(depMembers.length === 2, `Dependencies contract must have exactly 2 members, got ${depMembers.length}`);
    assert(depBody.includes('readonly createRepository:'), 'Must declare readonly createRepository');
    assert(depBody.includes('readonly persistResult:'), 'Must declare readonly persistResult');

    // C. REQUIRED FUNCTIONS
    assert(source.includes('runSingleAdvisoryResultPersistenceCycleWithDependencies'), 'Must export runSingleAdvisoryResultPersistenceCycleWithDependencies');
    assert(source.includes('runSingleAdvisoryResultPersistenceCycle'), 'Must export runSingleAdvisoryResultPersistenceCycle');

    // D. CANONICAL IMPORTS
    assert(source.includes("from './advisoryResultContract'"), 'Must import advisoryResultContract');
    assert(source.includes('PEIAAdvisoryResult'), 'Must import PEIAAdvisoryResult');
    assert(source.includes("from './advisoryResultToOutboxPersistence'"), 'Must import advisoryResultToOutboxPersistence');
    assert(source.includes('PersistAdvisoryResultToOutboxResult'), 'Must import PersistAdvisoryResultToOutboxResult');
    assert(source.includes('persistAdvisoryResultToOutbox'), 'Must import persistAdvisoryResultToOutbox');
    assert(source.includes("from './sqliteAdvisoryResultOutboxRepository'"), 'Must import sqliteAdvisoryResultOutboxRepository');
    assert(source.includes('SqliteAdvisoryResultOutboxRepository'), 'Must import SqliteAdvisoryResultOutboxRepository');
    assert(source.includes("from './localAdvisoryResultOutboxContract'"), 'Must import localAdvisoryResultOutboxContract');
    assert(source.includes('LocalAdvisoryResultOutboxRepository'), 'Must import LocalAdvisoryResultOutboxRepository');

    // E. INJECTED FLOW — STRUCTURAL ORDER
    const injectedFnMatch = source.match(
      /export\s+async\s+function\s+runSingleAdvisoryResultPersistenceCycleWithDependencies\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(injectedFnMatch !== null, 'Must find injected function');
    const injectedBody = injectedFnMatch![1];

    const creationIndex = injectedBody.indexOf('dependencies.createRepository(input.databasePath)');
    const tryIndex = injectedBody.indexOf('try {');
    const persistIndex = injectedBody.indexOf('return await dependencies.persistResult(');
    const finallyIndex = injectedBody.indexOf('finally {');
    const closeIndex = injectedBody.indexOf('repository.close();');

    assert(creationIndex !== -1, 'Must call dependencies.createRepository');
    assert(tryIndex !== -1, 'Must contain try block');
    assert(persistIndex !== -1, 'Must call dependencies.persistResult');
    assert(finallyIndex !== -1, 'Must contain finally block');
    assert(closeIndex !== -1, 'Must call repository.close()');

    assert(creationIndex < tryIndex, '1. createRepository must precede try {');
    assert(tryIndex < persistIndex, '2. try { must precede persistResult');
    assert(persistIndex < finallyIndex, '3. persistResult must precede finally {');
    assert(finallyIndex < closeIndex, '4. finally { must precede repository.close()');

    const createCount = (injectedBody.match(/dependencies\.createRepository\(/g) || []).length;
    assert(createCount === 1, `createRepository call count must be 1, got ${createCount}`);

    const persistCount = (injectedBody.match(/dependencies\.persistResult\(/g) || []).length;
    assert(persistCount === 1, `persistResult call count must be 1, got ${persistCount}`);

    const closeCount = (injectedBody.match(/repository\.close\(\)/g) || []).length;
    assert(closeCount === 1, `repository.close() count must be 1, got ${closeCount}`);

    assert(!injectedBody.includes('catch'), 'Must not contain catch');
    assert(!injectedBody.includes('.catch('), 'Must not contain .catch(');

    // F. CREATION FAILURE DESIGN
    assert(creationIndex < tryIndex, 'Repository creation occurs strictly BEFORE try block');

    // G. REAL WRAPPER
    const realFnMatch = source.match(
      /export\s+async\s+function\s+runSingleAdvisoryResultPersistenceCycle\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(realFnMatch !== null, 'Must find real runtime function');
    const realBody = realFnMatch![1];
    assert(realBody.includes('new SqliteAdvisoryResultOutboxRepository(databasePath)'), 'Real runtime must construct SqliteAdvisoryResultOutboxRepository');
    const constructionCount = (realBody.match(/new\s+SqliteAdvisoryResultOutboxRepository/g) || []).length;
    assert(constructionCount === 1, `Must construct SqliteAdvisoryResultOutboxRepository exactly once, got ${constructionCount}`);
    assert(realBody.includes('persistResult: persistAdvisoryResultToOutbox'), 'Real runtime must wire persistResult');
    assert(realBody.includes('runSingleAdvisoryResultPersistenceCycleWithDependencies(input,'), 'Real runtime must delegate to injected function');

    // H. NO DUPLICATED PERSISTENCE OWNERSHIP
    assert(!source.includes('repository.save('), 'Must not call repository.save directly');
    assert(!source.includes('createStoredAdvisoryResultRecord'), 'Must not call createStoredAdvisoryResultRecord');
    assert(!source.includes('validateStoredAdvisoryResultRecord'), 'Must not call validateStoredAdvisoryResultRecord');
    assert(!source.includes('isSameStoredAdvisoryResultRecord'), 'Must not call isSameStoredAdvisoryResultRecord');

    // I. NO RAW SQL
    const forbiddenSql = ['CREATE TABLE', 'INSERT INTO', 'SELECT ', 'UPDATE ', 'DELETE ', 'REPLACE ', 'UPSERT '];
    for (const sql of forbiddenSql) {
      assert(!source.includes(sql), `Forbidden SQL "${sql}" found`);
    }

    // J. NO NETWORK / UPLOAD
    const forbiddenNet = ['fetch(', 'globalThis.fetch', 'Authorization', 'Bearer', 'credential', 'endpointUrl', 'HTTP', 'HTTPS', 'upload', 'markUploaded', 'acknowledge'];
    for (const net of forbiddenNet) {
      assert(!source.includes(net), `Forbidden token "${net}" found`);
    }

    // K. NO RETRY / BACKGROUND
    const forbiddenRetry = ['retry', 'backoff', 'poll', 'setInterval', 'setTimeout', 'cron', 'schedule', 'claim', 'lease', 'workerLoop'];
    for (const r of forbiddenRetry) {
      assert(!source.includes(r), `Forbidden token "${r}" found`);
    }

    // L. NO AUTHORITY
    const forbiddenAuth = ['AIReviewArtifact', 'AIReviewFinding', 'decision', 'suggestedAction', 'approved', 'rejected', 'published', 'workflowState', 'permission', 'role', 'autoApply', 'autoPublish', 'override', 'execute'];
    for (const a of forbiddenAuth) {
      assert(!source.includes(a), `Forbidden token "${a}" found`);
    }

    // M. NO GENERATED METADATA
    const forbiddenMeta = ['resultId', 'generatedAt', 'createdAt', 'updatedAt', 'queuedAt', 'uploadedAt', 'attemptCount', 'retryCount', 'lastError', 'serverStatus', 'principalId', 'providerId', 'executionState', 'contentSnapshot'];
    for (const m of forbiddenMeta) {
      assert(!source.includes(m), `Forbidden token "${m}" found`);
    }

    // N. NO TIME / RANDOMNESS / SERIALIZATION / CLONE
    const forbiddenMisc = ['Date.now', 'new Date', 'Math.random', 'randomUUID', 'JSON.stringify', 'JSON.parse', 'structuredClone'];
    for (const mi of forbiddenMisc) {
      assert(!source.includes(mi), `Forbidden token "${mi}" found`);
    }

    // O. FINAL COUNT
    assert(totalTests === 34, `Expected exactly 34 tests, found ${totalTests}`);
    assert(passedTests === 33, `Expected 33 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 34, `Expected exactly 34 tests, found ${totalTests}`);
  assert(passedTests === 34, `Expected exactly 34 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
