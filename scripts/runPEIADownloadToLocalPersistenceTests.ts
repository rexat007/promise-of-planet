import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  downloadAndPersistPendingTaskWithDependencies,
  downloadAndPersistPendingTask,
  persistPendingTaskDownloadResult,
} from '../peia-worker/src/downloadToLocalPersistence';
import {
  PendingTaskHttpDownloadTransportError,
  type PendingTaskHttpDownloadInput,
} from '../peia-worker/src/pendingTaskHttpDownloadTransport';
import {
  PendingTaskDownloadResponseError,
  type PendingTaskDownloadResult,
} from '../peia-worker/src/downloadTaskResponseContract';
import {
  LocalPendingTaskState,
  LocalPendingTaskStoreContractError,
  type StoredPendingTaskRecord,
  type LocalPendingTaskRepository,
} from '../peia-worker/src/localPendingTaskStoreContract';
import {
  SqlitePendingTaskRepositoryError,
} from '../peia-worker/src/sqlitePendingTaskRepository';
import {
  AITaskType,
  AITaskStatus,
  type AIReviewTask,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
} from '../src/types/aiReview';

/**
 * PEIA-17E — DOWNLOAD-TO-LOCAL PERSISTENCE COMPOSITION TEST SUITE.
 * Enforces exactly 36 real test units covering download-to-local persistence,
 * dependency injection, error propagation, non-leakage of credentials, and invariants.
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

class MockPendingTaskRepository implements LocalPendingTaskRepository {
  saveCalls: StoredPendingTaskRecord[] = [];
  findByTaskIdCalls: string[] = [];
  listDownloadedCalls = 0;
  injectedSaveError: Error | null = null;

  async save(record: StoredPendingTaskRecord): Promise<void> {
    this.saveCalls.push(record);
    if (this.injectedSaveError) {
      throw this.injectedSaveError;
    }
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

const canonicalValidTask: AIReviewTask = {
  taskId: 'task-canonical-101',
  taskType: AITaskType.CONTENT_REVIEW,
  status: AITaskStatus.Pending,
  createdAt: '2026-09-28T00:00:00.000Z',
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
};

const defaultInput: PendingTaskHttpDownloadInput = {
  endpointUrl: 'https://gateway.example.com/api/tasks/download',
  credential: 'valid-secret-token',
};

async function runSuite() {
  console.log('--- PEIA-17E 36-Test Download-to-Local Persistence Audit ---');

  // 1. downloadAndPersistPendingTaskWithDependencies exists
  await test('1. downloadAndPersistPendingTaskWithDependencies exists', () => {
    assert(
      typeof downloadAndPersistPendingTaskWithDependencies === 'function',
      'downloadAndPersistPendingTaskWithDependencies must be a function'
    );
  });

  // 2. downloadAndPersistPendingTask exists
  await test('2. downloadAndPersistPendingTask exists', () => {
    assert(
      typeof downloadAndPersistPendingTask === 'function',
      'downloadAndPersistPendingTask must be a function'
    );
  });

  // 3. valid TASK_AVAILABLE returns STORED
  await test('3. valid TASK_AVAILABLE returns STORED', async () => {
    const repo = new MockPendingTaskRepository();
    let fetchCalled = 0;
    const mockFetch = async () => {
      fetchCalled++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          principalId: 'worker-p-1',
          task: canonicalValidTask,
        }),
      };
    };

    const result = await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(result.kind === 'STORED', 'Result kind must be STORED');
    assert(fetchCalled === 1, 'Fetch must be called once');
  });

  // 4. STORED result contains exact expected taskId
  await test('4. STORED result contains exact expected taskId', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    const result = await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(result.kind === 'STORED', 'Expected STORED result');
    if (result.kind === 'STORED') {
      assert(result.record.taskId === canonicalValidTask.taskId, 'taskId must match canonical task');
    }
  });

  // 5. STORED result record is valid StoredPendingTaskRecord shape
  await test('5. STORED result record is valid StoredPendingTaskRecord shape', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    const result = await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(result.kind === 'STORED', 'Expected STORED');
    if (result.kind === 'STORED') {
      const { record } = result;
      assert(record.principalId === 'worker-p-1', 'principalId must match');
      assert(record.taskType === AITaskType.CONTENT_REVIEW, 'taskType must match');
      assert(record.remoteStatus === AITaskStatus.Pending, 'remoteStatus must be Pending');
      assert(record.localState === LocalPendingTaskState.Downloaded, 'localState must be Downloaded');
      assert(record.remoteCreatedAt === canonicalValidTask.createdAt, 'remoteCreatedAt must match');
    }
  });

  // 6. target reference preserved from downloaded task through conversion
  await test('6. target reference preserved from downloaded task through conversion', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    const result = await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    if (result.kind === 'STORED') {
      assert(result.record.target === canonicalValidTask.target, 'target object reference must be preserved');
    }
  });

  // 7. contentSnapshot reference preserved through conversion
  await test('7. contentSnapshot reference preserved through conversion', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    const result = await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    if (result.kind === 'STORED') {
      assert(
        result.record.contentSnapshot === canonicalValidTask.contentSnapshot,
        'contentSnapshot object reference must be preserved'
      );
    }
  });

  // 8. repository.save called exactly once on TASK_AVAILABLE
  await test('8. repository.save called exactly once on TASK_AVAILABLE', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(repo.saveCalls.length === 1, `Expected repository.save to be called exactly once, got ${repo.saveCalls.length}`);
  });

  // 9. exact record reference passed to repository.save
  await test('9. exact record reference passed to repository.save', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    const result = await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    if (result.kind === 'STORED') {
      assert(repo.saveCalls[0] === result.record, 'Exact record reference passed to repository.save');
    }
  });

  // 10. exact same record reference returned in STORED result
  await test('10. exact same record reference returned in STORED result', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    const result = await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    if (result.kind === 'STORED') {
      assert(result.record === repo.saveCalls[0], 'Returned record must equal saved record reference');
    }
  });

  // 11. transport fetcher called exactly once
  await test('11. transport fetcher called exactly once', async () => {
    let callCount = 0;
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          principalId: 'worker-p-1',
          task: canonicalValidTask,
        }),
      };
    };

    await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(callCount === 1, `Expected fetcher called 1 time, got ${callCount}`);
  });

  // 12. NO_TASK returns exactly { kind: 'NO_TASK' }
  await test('12. NO_TASK returns exactly { kind: "NO_TASK" }', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: null,
      }),
    });

    const result = await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(result.kind === 'NO_TASK', 'Result must be NO_TASK');
    assert(Object.keys(result).length === 1, 'Result must contain exactly kind');
  });

  // 13. NO_TASK does not call repository.save
  await test('13. NO_TASK does not call repository.save', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: null,
      }),
    });

    await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(repo.saveCalls.length === 0, 'repository.save must not be called on NO_TASK');
  });

  // 14. NO_TASK does not invoke repository.findByTaskId
  await test('14. NO_TASK does not invoke repository.findByTaskId', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: null,
      }),
    });

    await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(repo.findByTaskIdCalls.length === 0, 'repository.findByTaskId must not be called');
  });

  // 15. NO_TASK does not invoke repository.listDownloaded
  await test('15. NO_TASK does not invoke repository.listDownloaded', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: null,
      }),
    });

    await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(repo.listDownloadedCalls === 0, 'repository.listDownloaded must not be called');
  });

  // 16. TASK_AVAILABLE path does not invoke repository.findByTaskId
  await test('16. TASK_AVAILABLE path does not invoke repository.findByTaskId', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(repo.findByTaskIdCalls.length === 0, 'repository.findByTaskId must not be invoked');
  });

  // 17. TASK_AVAILABLE path does not invoke repository.listDownloaded
  await test('17. TASK_AVAILABLE path does not invoke repository.listDownloaded', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    await downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo);
    assert(repo.listDownloadedCalls === 0, 'repository.listDownloaded must not be invoked');
  });

  // 18. HTTP transport NETWORK_FAILURE propagates unchanged
  await test('18. HTTP transport NETWORK_FAILURE propagates unchanged', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => {
      throw new Error('connection refused');
    };

    await assertThrows(
      () => downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo),
      (err) => {
        assert(err instanceof PendingTaskHttpDownloadTransportError, 'Must be PendingTaskHttpDownloadTransportError');
        assert(
          (err as PendingTaskHttpDownloadTransportError).code === 'NETWORK_FAILURE',
          'Code must be NETWORK_FAILURE'
        );
      }
    );
  });

  // 19. HTTP transport INVALID_ENDPOINT propagates unchanged
  await test('19. HTTP transport INVALID_ENDPOINT propagates unchanged', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, principalId: 'worker-p-1', task: null }),
    });

    await assertThrows(
      () => downloadAndPersistPendingTaskWithDependencies({ ...defaultInput, endpointUrl: '   ' }, mockFetch, repo),
      (err) => {
        assert(err instanceof PendingTaskHttpDownloadTransportError, 'Must be PendingTaskHttpDownloadTransportError');
        assert(
          (err as PendingTaskHttpDownloadTransportError).code === 'INVALID_ENDPOINT',
          'Code must be INVALID_ENDPOINT'
        );
      }
    );
  });

  // 20. HTTP transport INVALID_CREDENTIAL propagates unchanged
  await test('20. HTTP transport INVALID_CREDENTIAL propagates unchanged', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, principalId: 'worker-p-1', task: null }),
    });

    await assertThrows(
      () => downloadAndPersistPendingTaskWithDependencies({ ...defaultInput, credential: '' }, mockFetch, repo),
      (err) => {
        assert(err instanceof PendingTaskHttpDownloadTransportError, 'Must be PendingTaskHttpDownloadTransportError');
        assert(
          (err as PendingTaskHttpDownloadTransportError).code === 'INVALID_CREDENTIAL',
          'Code must be INVALID_CREDENTIAL'
        );
      }
    );
  });

  // 21. response read failure propagates unchanged
  await test('21. response read failure propagates unchanged', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('truncated chunk');
      },
    });

    await assertThrows(
      () => downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo),
      (err) => {
        assert(err instanceof PendingTaskHttpDownloadTransportError, 'Must be PendingTaskHttpDownloadTransportError');
        assert(
          (err as PendingTaskHttpDownloadTransportError).code === 'RESPONSE_READ_FAILED',
          'Code must be RESPONSE_READ_FAILED'
        );
      }
    );
  });

  // 22. PEIA-17A REMOTE_REQUEST_REJECTED propagates unchanged
  await test('22. PEIA-17A REMOTE_REQUEST_REJECTED propagates unchanged', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Invalid authorization token',
        },
      }),
    });

    await assertThrows(
      () => downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo),
      (err) => {
        assert(err instanceof PendingTaskDownloadResponseError, 'Must be PendingTaskDownloadResponseError');
        assert(
          (err as PendingTaskDownloadResponseError).code === 'REMOTE_REQUEST_REJECTED',
          'Code must be REMOTE_REQUEST_REJECTED'
        );
      }
    );
  });

  // 23. PEIA-17A INVALID_TASK_PAYLOAD propagates unchanged
  await test('23. PEIA-17A INVALID_TASK_PAYLOAD propagates unchanged', async () => {
    const repo = new MockPendingTaskRepository();
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: {
          ...canonicalValidTask,
          status: 'Completed', // Invalid non-pending status rejected by 17A parser
        },
      }),
    });

    await assertThrows(
      () => downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo),
      (err) => {
        assert(err instanceof PendingTaskDownloadResponseError, 'Must be PendingTaskDownloadResponseError');
        assert(
          (err as PendingTaskDownloadResponseError).code === 'INVALID_TASK_PAYLOAD',
          'Code must be INVALID_TASK_PAYLOAD'
        );
      }
    );
  });

  // 24. PEIA-17C INVALID_DOWNLOADED_TASK propagates unchanged
  await test('24. PEIA-17C INVALID_DOWNLOADED_TASK propagates unchanged', async () => {
    const repo = new MockPendingTaskRepository();
    const malformedResult = {
      kind: 'TASK_AVAILABLE',
      value: {
        principalId: 'worker-p-1',
        task: {
          ...canonicalValidTask,
          target: 'not-an-object' as unknown,
        },
      },
    } as unknown as PendingTaskDownloadResult;

    await assertThrows(
      () => persistPendingTaskDownloadResult(malformedResult, repo),
      (err) => {
        assert(err instanceof LocalPendingTaskStoreContractError, 'Must be LocalPendingTaskStoreContractError');
        assert(
          (err as LocalPendingTaskStoreContractError).code === 'INVALID_DOWNLOADED_TASK',
          'Code must be INVALID_DOWNLOADED_TASK'
        );
      }
    );
  });

  // 25. repository.save rejection propagates exact same error object
  await test('25. repository.save rejection propagates exact same error object', async () => {
    const repo = new MockPendingTaskRepository();
    const saveError = new Error('save-failure-sentinel');
    repo.injectedSaveError = saveError;

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    await assertThrows(
      () => downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo),
      (err) => {
        assert(err === saveError, 'Exact save error reference must propagate unchanged');
      }
    );
  });

  // 26. repository TASK_CONFLICT-style error object propagates unchanged
  await test('26. repository TASK_CONFLICT-style error object propagates unchanged', async () => {
    const repo = new MockPendingTaskRepository();
    const conflictError = new SqlitePendingTaskRepositoryError(
      'TASK_CONFLICT',
      'Conflicting local task record.'
    );
    repo.injectedSaveError = conflictError;

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      }),
    });

    await assertThrows(
      () => downloadAndPersistPendingTaskWithDependencies(defaultInput, mockFetch, repo),
      (err) => {
        assert(err === conflictError, 'Repository error object must propagate unchanged');
        assert(err instanceof SqlitePendingTaskRepositoryError, 'Must be SqlitePendingTaskRepositoryError');
        assert((err as SqlitePendingTaskRepositoryError).code === 'TASK_CONFLICT', 'Code must be TASK_CONFLICT');
      }
    );
  });

  // 27. persistence helper NO_TASK does not convert or save
  await test('27. persistence helper NO_TASK does not convert or save', async () => {
    const repo = new MockPendingTaskRepository();
    const result = await persistPendingTaskDownloadResult(
      { kind: 'NO_TASK', value: { principalId: 'p-1', task: null } },
      repo
    );
    assert(result.kind === 'NO_TASK', 'Must return NO_TASK');
    assert(repo.saveCalls.length === 0, 'No save call on NO_TASK');
    assert(repo.findByTaskIdCalls.length === 0, 'No findByTaskId call on NO_TASK');
    assert(repo.listDownloadedCalls === 0, 'No listDownloaded call on NO_TASK');
  });

  // 28. persistence helper TASK_AVAILABLE saves exactly once
  await test('28. persistence helper TASK_AVAILABLE saves exactly once', async () => {
    const repo = new MockPendingTaskRepository();
    const downloadResult: PendingTaskDownloadResult = {
      kind: 'TASK_AVAILABLE',
      value: {
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      },
    };

    const result = await persistPendingTaskDownloadResult(downloadResult, repo);
    assert(result.kind === 'STORED', 'Must return STORED');
    assert(repo.saveCalls.length === 1, 'Must save exactly once');
  });

  // 29. persistence helper returns exact saved record reference
  await test('29. persistence helper returns exact saved record reference', async () => {
    const repo = new MockPendingTaskRepository();
    const downloadResult: PendingTaskDownloadResult = {
      kind: 'TASK_AVAILABLE',
      value: {
        principalId: 'worker-p-1',
        task: canonicalValidTask,
      },
    };

    const result = await persistPendingTaskDownloadResult(downloadResult, repo);
    if (result.kind === 'STORED') {
      assert(result.record === repo.saveCalls[0], 'Must return exact saved record reference');
    }
  });

  // 30. production wrapper delegates to accepted downloadPendingTask and does not contain direct fetch implementation
  await test('30. production wrapper delegates to accepted downloadPendingTask and does not contain direct fetch implementation', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/downloadToLocalPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes('downloadAndPersistPendingTask('), 'Wrapper function must exist');
    assert(source.includes('downloadPendingTask(input)'), 'Wrapper must call downloadPendingTask');
    assert(
      source.includes('return persistPendingTaskDownloadResult(result, repository);'),
      'Wrapper must delegate to persistPendingTaskDownloadResult'
    );
    assert(!source.includes('globalThis.fetch'), 'Source must not contain globalThis.fetch');
    assert(!source.includes('fetch('), 'Source must not contain fetch(');
    assert(!source.includes('Authorization'), 'Source must not contain Authorization');
    assert(!source.includes('Bearer'), 'Source must not contain Bearer');
    assert(!source.includes('Accept:'), 'Source must not contain Accept header');
    assert(!source.includes('Content-Type'), 'Source must not contain Content-Type header');
  });

  // 31. composition source does not access input.credential
  await test('31. composition source does not access input.credential', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/downloadToLocalPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(!source.includes('input.credential'), 'Source must not access input.credential');
  });

  // 32. composition source does not access input.endpointUrl
  await test('32. composition source does not access input.endpointUrl', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/downloadToLocalPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(!source.includes('input.endpointUrl'), 'Source must not access input.endpointUrl');
  });

  // 33. composition source contains no repository read calls
  await test('33. composition source contains no repository read calls', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/downloadToLocalPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(!source.includes('.findByTaskId('), 'Source must not call findByTaskId');
    assert(!source.includes('.listDownloaded('), 'Source must not call listDownloaded');
  });

  // 34. composition source contains no SQLite/filesystem/env/logging/time/randomness/polling/retry code
  await test('34. composition source contains no SQLite/filesystem/env/logging/time/randomness/polling/retry code', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/downloadToLocalPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'node:sqlite',
      'SqlitePendingTaskRepository',
      'DatabaseSync',
      'peia_pending_tasks',
      'CREATE TABLE',
      'INSERT',
      'SELECT',
      'UPDATE',
      'DELETE',
      'node:fs',
      'readFile',
      'writeFile',
      'mkdir',
      'localStorage',
      'IndexedDB',
      'process.env',
      'import.meta.env',
      'console.log',
      'console.error',
      'logger',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
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

    for (const item of forbidden) {
      assert(!source.includes(item), `Forbidden token "${item}" found in source`);
    }
  });

  // 35. source imports repository interface, not concrete SQLite adapter
  await test('35. source imports repository interface, not concrete SQLite adapter', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/downloadToLocalPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes('LocalPendingTaskRepository'), 'Source must import LocalPendingTaskRepository');
    assert(source.includes('./localPendingTaskStoreContract'), 'Source must import from localPendingTaskStoreContract');
    assert(!source.includes('./sqlitePendingTaskRepository'), 'Source must not import concrete sqlite adapter');
  });

  // 36. source invariants + exact final count gate
  await test('36. source invariants + exact final count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/downloadToLocalPersistence.ts');
    const source = readFileSync(filePath, 'utf8');

    const requiredInvariants = [
      'downloadPendingTaskWithFetch',
      'downloadPendingTask',
      'persistPendingTaskDownloadResult',
      'createStoredPendingTaskRecord',
      'LocalPendingTaskRepository',
      'repository.save',
    ];

    for (const req of requiredInvariants) {
      assert(source.includes(req), `Source must contain required invariant "${req}"`);
    }

    // Explicitly prove the result contract has exactly the two result kinds: 'STORED' and 'NO_TASK' and no third kind
    const resultTypeMatch = source.match(/export type DownloadToLocalPersistenceResult\s*=\s*([\s\S]*?);\s*export /);
    assert(resultTypeMatch !== null, 'DownloadToLocalPersistenceResult type definition must exist');
    const resultTypeBody = resultTypeMatch[1];
    const kindMatches = Array.from(resultTypeBody.matchAll(/(?:readonly\s+)?kind:\s*'([^']+)'/g)).map((m) => m[1]);
    assert(
      kindMatches.length === 2,
      `Expected exactly 2 kind definitions in DownloadToLocalPersistenceResult, found ${kindMatches.length}`
    );
    assert(kindMatches.includes('STORED'), 'DownloadToLocalPersistenceResult must include kind "STORED"');
    assert(kindMatches.includes('NO_TASK'), 'DownloadToLocalPersistenceResult must include kind "NO_TASK"');

    // Explicitly prove production introduces NO error class
    assert(!source.includes('class ') && !source.includes('extends Error'), 'Production must not introduce any class or Error subclass');
    assert(!source.includes('export class'), 'Production must not export any class');

    assert(totalTests === 36, `Expected exactly 36 tests, found ${totalTests}`);
    assert(passedTests === 35, `Expected 35 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 36, `Expected exactly 36 tests, found ${totalTests}`);
  assert(passedTests === 36, `Expected exactly 36 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
