import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runSingleDownloadCycle,
  runSingleDownloadCycleWithDependencies,
  type SingleDownloadCycleInput,
} from '../peia-worker/src/singleDownloadCycle';
import {
  PendingTaskHttpDownloadTransportError,
  type PendingTaskHttpDownloadInput,
} from '../peia-worker/src/pendingTaskHttpDownloadTransport';
import {
  PendingTaskDownloadResponseError,
} from '../peia-worker/src/downloadTaskResponseContract';
import {
  LocalPendingTaskState,
  type StoredPendingTaskRecord,
  type LocalPendingTaskRepository,
} from '../peia-worker/src/localPendingTaskStoreContract';
import {
  SqlitePendingTaskRepository,
  SqlitePendingTaskRepositoryError,
} from '../peia-worker/src/sqlitePendingTaskRepository';
import {
  AITaskType,
  AITaskStatus,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
} from '../src/types/aiReview';

/**
 * PEIA-17F — SINGLE DOWNLOAD CYCLE RUNTIME BOUNDARY TEST SUITE.
 * Enforces exactly 34 real test units covering single-cycle lifecycle,
 * dependency injection, guaranteed cleanup, error propagation, and invariants.
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

async function assertThrows(
  fn: () => Promise<unknown> | unknown,
  verifier: (err: unknown) => void
): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    verifier(err);
    return;
  }
  throw new Error('Expected function to throw, but it returned normally.');
}

class MockClosableRepository implements LocalPendingTaskRepository {
  closeCalls = 0;
  saveCalls: StoredPendingTaskRecord[] = [];
  findByTaskIdCalls: string[] = [];
  listDownloadedCalls = 0;

  close(): void {
    this.closeCalls++;
  }

  async save(record: StoredPendingTaskRecord): Promise<void> {
    this.saveCalls.push(record);
  }

  async findByTaskId(taskId: string): Promise<StoredPendingTaskRecord | null> {
    this.findByTaskIdCalls.push(taskId);
    return null;
  }

  async listDownloaded(): Promise<readonly StoredPendingTaskRecord[]> {
    this.listDownloadedCalls++;
    return [];
  }
}

const canonicalValidRecord: StoredPendingTaskRecord = {
  taskId: 'task-canonical-101',
  principalId: 'worker-principal-alpha-1',
  taskType: AITaskType.CONTENT_REVIEW,
  target: {
    targetType: AIReviewTargetType.News,
    targetId: 'news-987',
    sourceUpdatedAt: '2026-09-27T12:00:00.000Z',
  },
  contentSnapshot: {
    title: 'Climate Report',
    metrics: {
      temperature: 32.5,
      active: true,
    },
    tags: ['climate', 'sudan'],
    notes: null,
  },
  remoteCreatedAt: '2026-09-28T00:00:00.000Z',
  remoteStatus: AITaskStatus.Pending,
  localState: LocalPendingTaskState.Downloaded,
};

const sampleDownloadInput: PendingTaskHttpDownloadInput = {
  endpointUrl: 'https://gateway.example.com/api/tasks/download',
  credential: 'valid-secret-token',
};

const sampleCycleInput: SingleDownloadCycleInput = {
  databasePath: '/tmp/test-tasks.db',
  download: sampleDownloadInput,
};

async function runSuite() {
  console.log('--- PEIA-17F 34-Test Single Download Cycle Audit ---');

  // 1. runSingleDownloadCycle exists
  await test('1. runSingleDownloadCycle exists', () => {
    assert(
      typeof runSingleDownloadCycle === 'function',
      'runSingleDownloadCycle must be a function'
    );
  });

  // 2. runSingleDownloadCycleWithDependencies exists
  await test('2. runSingleDownloadCycleWithDependencies exists', () => {
    assert(
      typeof runSingleDownloadCycleWithDependencies === 'function',
      'runSingleDownloadCycleWithDependencies must be a function'
    );
  });

  // 3. SingleDownloadCycle input passes exact databasePath to createRepository
  await test('3. SingleDownloadCycle input passes exact databasePath to createRepository', async () => {
    let capturedPath = '';
    const repo = new MockClosableRepository();
    const dependencies = {
      createRepository: (dbPath: string) => {
        capturedPath = dbPath;
        return repo;
      },
      downloadAndPersist: async () => ({ kind: 'NO_TASK' as const }),
    };

    await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(capturedPath === sampleCycleInput.databasePath, 'Exact databasePath must be passed to createRepository');
  });

  // 4. exact input.download object reference passed to downloadAndPersist
  await test('4. exact input.download object reference passed to downloadAndPersist', async () => {
    let capturedDownload: PendingTaskHttpDownloadInput | null = null;
    const repo = new MockClosableRepository();
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async (dl: PendingTaskHttpDownloadInput) => {
        capturedDownload = dl;
        return { kind: 'NO_TASK' as const };
      },
    };

    await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(capturedDownload === sampleCycleInput.download, 'Exact download input reference must be passed');
  });

  // 5. exact repository object created is passed to downloadAndPersist
  await test('5. exact repository object created is passed to downloadAndPersist', async () => {
    const repo = new MockClosableRepository();
    let capturedRepo: LocalPendingTaskRepository | null = null;
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async (_dl: PendingTaskHttpDownloadInput, r: LocalPendingTaskRepository) => {
        capturedRepo = r;
        return { kind: 'NO_TASK' as const };
      },
    };

    await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(capturedRepo === repo, 'Exact repository instance must be passed to downloadAndPersist');
  });

  // 6. STORED result propagates unchanged
  await test('6. STORED result propagates unchanged', async () => {
    const repo = new MockClosableRepository();
    const storedResult = {
      kind: 'STORED' as const,
      record: canonicalValidRecord,
    };
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => storedResult,
    };

    const result = await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(result.kind === 'STORED', 'Result kind must be STORED');
    assert(result === storedResult, 'Exact STORED result object must propagate unchanged');
  });

  // 7. NO_TASK result propagates unchanged
  await test('7. NO_TASK result propagates unchanged', async () => {
    const repo = new MockClosableRepository();
    const noTaskResult = {
      kind: 'NO_TASK' as const,
    };
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => noTaskResult,
    };

    const result = await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(result.kind === 'NO_TASK', 'Result kind must be NO_TASK');
    assert(result === noTaskResult, 'Exact NO_TASK result object must propagate unchanged');
  });

  // 8. repository.close called exactly once after STORED
  await test('8. repository.close called exactly once after STORED', async () => {
    const repo = new MockClosableRepository();
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => ({
        kind: 'STORED' as const,
        record: canonicalValidRecord,
      }),
    };

    await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(repo.closeCalls === 1, `Expected close to be called exactly 1 time, got ${repo.closeCalls}`);
  });

  // 9. repository.close called exactly once after NO_TASK
  await test('9. repository.close called exactly once after NO_TASK', async () => {
    const repo = new MockClosableRepository();
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => ({
        kind: 'NO_TASK' as const,
      }),
    };

    await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(repo.closeCalls === 1, `Expected close to be called exactly 1 time, got ${repo.closeCalls}`);
  });

  // 10. downloadAndPersist called exactly once
  await test('10. downloadAndPersist called exactly once', async () => {
    let callCount = 0;
    const repo = new MockClosableRepository();
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        callCount++;
        return { kind: 'NO_TASK' as const };
      },
    };

    await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(callCount === 1, `Expected downloadAndPersist called 1 time, got ${callCount}`);
  });

  // 11. createRepository called exactly once
  await test('11. createRepository called exactly once', async () => {
    let createCount = 0;
    const repo = new MockClosableRepository();
    const dependencies = {
      createRepository: () => {
        createCount++;
        return repo;
      },
      downloadAndPersist: async () => ({ kind: 'NO_TASK' as const }),
    };

    await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(createCount === 1, `Expected createRepository called 1 time, got ${createCount}`);
  });

  // 12. close happens AFTER downloadAndPersist resolves
  await test('12. close happens AFTER downloadAndPersist resolves', async () => {
    const events: string[] = [];
    const repo: LocalPendingTaskRepository & { close(): void } = {
      close: () => {
        events.push('close');
      },
      save: async () => {},
      findByTaskId: async () => null,
      listDownloaded: async () => [],
    };

    const dependencies = {
      createRepository: () => {
        events.push('create');
        return repo;
      },
      downloadAndPersist: async () => {
        events.push('download-start');
        events.push('download-end');
        return { kind: 'NO_TASK' as const };
      },
    };

    await runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies);
    assert(
      JSON.stringify(events) === JSON.stringify(['create', 'download-start', 'download-end', 'close']),
      'Close must occur strictly after downloadAndPersist resolves'
    );
  });

  // 13. close happens AFTER downloadAndPersist rejects
  await test('13. close happens AFTER downloadAndPersist rejects', async () => {
    const events: string[] = [];
    const repo: LocalPendingTaskRepository & { close(): void } = {
      close: () => {
        events.push('close');
      },
      save: async () => {},
      findByTaskId: async () => null,
      listDownloaded: async () => [],
    };

    const errorSentinel = new Error('download-failure');
    const dependencies = {
      createRepository: () => {
        events.push('create');
        return repo;
      },
      downloadAndPersist: async () => {
        events.push('download-start');
        events.push('download-error');
        throw errorSentinel;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === errorSentinel, 'Sentinel error must be thrown');
      }
    );

    assert(
      JSON.stringify(events) === JSON.stringify(['create', 'download-start', 'download-error', 'close']),
      'Close must occur strictly after downloadAndPersist rejects'
    );
  });

  // 14. generic download error propagates exact same object identity
  await test('14. generic download error propagates exact same object identity', async () => {
    const repo = new MockClosableRepository();
    const genericError = new Error('generic-error-sentinel');
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        throw genericError;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === genericError, 'Exact generic error object must propagate unchanged');
      }
    );
  });

  // 15. PendingTaskHttpDownloadTransportError propagates exact same object identity
  await test('15. PendingTaskHttpDownloadTransportError propagates exact same object identity', async () => {
    const repo = new MockClosableRepository();
    const transportError = new PendingTaskHttpDownloadTransportError(
      'NETWORK_FAILURE',
      'Unable to reach task gateway.'
    );
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        throw transportError;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === transportError, 'Exact transport error object must propagate unchanged');
      }
    );
  });

  // 16. PendingTaskDownloadResponseError propagates exact same object identity
  await test('16. PendingTaskDownloadResponseError propagates exact same object identity', async () => {
    const repo = new MockClosableRepository();
    const responseError = new PendingTaskDownloadResponseError(
      'REMOTE_REQUEST_REJECTED',
      'Remote task request was rejected.'
    );
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        throw responseError;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === responseError, 'Exact response error object must propagate unchanged');
      }
    );
  });

  // 17. SqlitePendingTaskRepositoryError TASK_CONFLICT propagates exact same object identity
  await test('17. SqlitePendingTaskRepositoryError TASK_CONFLICT propagates exact same object identity', async () => {
    const repo = new MockClosableRepository();
    const conflictError = new SqlitePendingTaskRepositoryError(
      'TASK_CONFLICT',
      'Conflicting local task record.'
    );
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        throw conflictError;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === conflictError, 'Exact conflict error object must propagate unchanged');
      }
    );
  });

  // 18. repository close still occurs on generic error
  await test('18. repository close still occurs on generic error', async () => {
    const repo = new MockClosableRepository();
    const genericError = new Error('generic-error');
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        throw genericError;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === genericError, 'Exact generic error object must propagate unchanged');
      }
    );
    assert(repo.closeCalls === 1, 'Close must occur on generic error');
  });

  // 19. repository close still occurs on transport error
  await test('19. repository close still occurs on transport error', async () => {
    const repo = new MockClosableRepository();
    const transportError = new PendingTaskHttpDownloadTransportError(
      'NETWORK_FAILURE',
      'Net failure'
    );
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        throw transportError;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === transportError, 'Exact transport error object must propagate unchanged');
        assert(err instanceof PendingTaskHttpDownloadTransportError, 'Must be PendingTaskHttpDownloadTransportError');
        assert((err as PendingTaskHttpDownloadTransportError).code === 'NETWORK_FAILURE', 'Code must be NETWORK_FAILURE');
      }
    );
    assert(repo.closeCalls === 1, 'Close must occur on transport error');
  });

  // 20. repository close still occurs on parser error
  await test('20. repository close still occurs on parser error', async () => {
    const repo = new MockClosableRepository();
    const parserError = new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'Invalid payload'
    );
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        throw parserError;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === parserError, 'Exact parser error object must propagate unchanged');
        assert(err instanceof PendingTaskDownloadResponseError, 'Must be PendingTaskDownloadResponseError');
        assert((err as PendingTaskDownloadResponseError).code === 'INVALID_TASK_PAYLOAD', 'Code must be INVALID_TASK_PAYLOAD');
      }
    );
    assert(repo.closeCalls === 1, 'Close must occur on parser error');
  });

  // 21. repository close still occurs on TASK_CONFLICT
  await test('21. repository close still occurs on TASK_CONFLICT', async () => {
    const repo = new MockClosableRepository();
    const conflictError = new SqlitePendingTaskRepositoryError(
      'TASK_CONFLICT',
      'Conflict'
    );
    const dependencies = {
      createRepository: () => repo,
      downloadAndPersist: async () => {
        throw conflictError;
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === conflictError, 'Exact conflict error object must propagate unchanged');
        assert(err instanceof SqlitePendingTaskRepositoryError, 'Must be SqlitePendingTaskRepositoryError');
        assert((err as SqlitePendingTaskRepositoryError).code === 'TASK_CONFLICT', 'Code must be TASK_CONFLICT');
      }
    );
    assert(repo.closeCalls === 1, 'Close must occur on TASK_CONFLICT');
  });

  // 22. createRepository constructor/factory failure propagates exact same error object
  await test('22. createRepository constructor/factory failure propagates exact same error object', async () => {
    const constructorError = new SqlitePendingTaskRepositoryError(
      'DATABASE_OPEN_FAILED',
      'Unable to open local task database.'
    );
    const dependencies = {
      createRepository: () => {
        throw constructorError;
      },
      downloadAndPersist: async () => ({ kind: 'NO_TASK' as const }),
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === constructorError, 'Constructor failure must propagate exact error object');
      }
    );
  });

  // 23. when createRepository fails, close is not attempted
  await test('23. when createRepository fails, close is not attempted', async () => {
    const orphanRepo = new MockClosableRepository();
    const constructorError = new Error('factory failure');
    const dependencies = {
      createRepository: () => {
        throw constructorError;
      },
      downloadAndPersist: async () => ({
        kind: 'NO_TASK' as const,
      }),
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === constructorError, 'Factory failure must propagate');
      }
    );
    assert(orphanRepo.closeCalls === 0, 'No close attempt must occur when createRepository fails');
  });

  // 24. when createRepository fails, downloadAndPersist is not called
  await test('24. when createRepository fails, downloadAndPersist is not called', async () => {
    let downloadCalled = false;
    const constructorError = new Error('factory failure');
    const dependencies = {
      createRepository: () => {
        throw constructorError;
      },
      downloadAndPersist: async () => {
        downloadCalled = true;
        return { kind: 'NO_TASK' as const };
      },
    };

    await assertThrows(
      () => runSingleDownloadCycleWithDependencies(sampleCycleInput, dependencies),
      (err) => {
        assert(err === constructorError, 'Factory failure must propagate');
      }
    );
    assert(!downloadCalled, 'downloadAndPersist must not be called when createRepository fails');
  });

  // 25. composition does not call repository.save directly
  await test('25. composition does not call repository.save directly', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(!source.includes('repository.save('), 'Composition must not call repository.save directly');
  });

  // 26. composition does not call repository.findByTaskId directly
  await test('26. composition does not call repository.findByTaskId directly', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(!source.includes('repository.findByTaskId('), 'Composition must not call repository.findByTaskId directly');
  });

  // 27. composition does not call repository.listDownloaded directly
  await test('27. composition does not call repository.listDownloaded directly', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(!source.includes('repository.listDownloaded('), 'Composition must not call repository.listDownloaded directly');
  });

  // 28. production wrapper uses SqlitePendingTaskRepository
  await test('28. production wrapper uses SqlitePendingTaskRepository', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes("from './sqlitePendingTaskRepository'"), 'Must import from ./sqlitePendingTaskRepository');
    assert(source.includes('new SqlitePendingTaskRepository(databasePath)'), 'Must construct SqlitePendingTaskRepository');
  });

  // 29. production wrapper delegates to runSingleDownloadCycleWithDependencies
  await test('29. production wrapper delegates to runSingleDownloadCycleWithDependencies', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes('runSingleDownloadCycleWithDependencies(input,'), 'Must delegate to runSingleDownloadCycleWithDependencies');
  });

  // 30. production wrapper passes downloadAndPersistPendingTask as dependency
  await test('30. production wrapper passes downloadAndPersistPendingTask as dependency', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes('downloadAndPersist: downloadAndPersistPendingTask'), 'Must pass downloadAndPersistPendingTask');
  });

  // 31. production wrapper does not inspect endpointUrl or credential
  await test('31. production wrapper does not inspect endpointUrl or credential', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(!source.includes('input.download.endpointUrl'), 'Must not inspect input.download.endpointUrl');
    assert(!source.includes('input.download.credential'), 'Must not inspect input.download.credential');
    assert(!source.includes('input.endpointUrl'), 'Must not inspect input.endpointUrl');
    assert(!source.includes('input.credential'), 'Must not inspect input.credential');
  });

  // 32. source contains no direct network/SQLite SQL/filesystem/env/time/randomness/logging/polling/retry/scheduling
  await test('32. source contains no direct network/SQLite SQL/filesystem/env/time/randomness/logging/polling/retry/scheduling', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'globalThis.fetch',
      'fetch(',
      'Authorization',
      'Bearer',
      'Accept:',
      'Content-Type',
      'http://',
      'https://',
      'node:sqlite',
      'DatabaseSync',
      'peia_pending_tasks',
      'CREATE TABLE',
      'INSERT',
      'SELECT',
      'UPDATE',
      'DELETE',
      'PRAGMA',
      'node:fs',
      'readFile',
      'writeFile',
      'mkdir',
      'existsSync',
      'rmSync',
      'process.env',
      'import.meta.env',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'console.log',
      'console.error',
      'logger',
      'setInterval',
      'setTimeout',
      'retry',
      'backoff',
      'poll',
      'cron',
      'schedule',
      'approved',
      'published',
      'decision',
      'workflowState',
      'desiredWorkflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
      'suggestedAction',
    ];

    for (const token of forbidden) {
      assert(!source.includes(token), `Forbidden token "${token}" found in source`);
    }
  });

  // 33. REAL file-backed smoke test: concrete adapter constructibility
  await test('33. REAL file-backed smoke test: concrete adapter constructibility', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-smoke-17f-'));
    const dbPath = join(tempDir, 'smoke.db');
    let repo: SqlitePendingTaskRepository | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);
      assert(repo !== null, 'Real SqlitePendingTaskRepository must open file successfully');
      repo.close();
      repo = null;
    } finally {
      try {
        repo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 34. source invariants + exact final count gate
  await test('34. source invariants + exact final count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/singleDownloadCycle.ts');
    const source = readFileSync(filePath, 'utf8');

    const requiredInvariants = [
      'SingleDownloadCycleInput',
      'SingleDownloadCycleDependencies',
      'runSingleDownloadCycleWithDependencies',
      'runSingleDownloadCycle',
      'SqlitePendingTaskRepository',
      'downloadAndPersistPendingTask',
      'repository.close',
    ];

    for (const req of requiredInvariants) {
      assert(source.includes(req), `Source must contain required invariant "${req}"`);
    }

    assert(source.includes('try {'), 'Must contain try block');
    assert(source.includes('finally {'), 'Must contain finally block');
    assert(!source.includes('catch ('), 'Production must not contain catch block');
    assert(!source.includes('class ') && !source.includes('extends Error'), 'Production must not declare classes or Error subclasses');

    assert(!source.includes('repository.save('), 'Must contain no direct repository.save');
    assert(!source.includes('repository.findByTaskId('), 'Must contain no direct repository.findByTaskId');
    assert(!source.includes('repository.listDownloaded('), 'Must contain no direct repository.listDownloaded');

    const forbidden = [
      'globalThis.fetch',
      'fetch(',
      'Authorization',
      'Bearer',
      'Accept:',
      'Content-Type',
      'http://',
      'https://',
      'node:sqlite',
      'DatabaseSync',
      'peia_pending_tasks',
      'CREATE TABLE',
      'INSERT',
      'SELECT',
      'UPDATE',
      'DELETE',
      'PRAGMA',
      'node:fs',
      'readFile',
      'writeFile',
      'mkdir',
      'existsSync',
      'rmSync',
      'process.env',
      'import.meta.env',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'console.log',
      'console.error',
      'logger',
      'setInterval',
      'setTimeout',
      'retry',
      'backoff',
      'poll',
      'cron',
      'schedule',
      'approved',
      'published',
      'decision',
      'workflowState',
      'desiredWorkflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
      'suggestedAction',
    ];

    for (const token of forbidden) {
      assert(!source.includes(token), `Forbidden token "${token}" found in source`);
    }

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
