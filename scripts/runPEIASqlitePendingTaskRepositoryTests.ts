import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  SqlitePendingTaskRepository,
  SqlitePendingTaskRepositoryError,
} from '../peia-worker/src/sqlitePendingTaskRepository';
import {
  LocalPendingTaskState,
  type StoredPendingTaskRecord,
} from '../peia-worker/src/localPendingTaskStoreContract';
import {
  AITaskType,
  AITaskStatus,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
} from '../src/types/aiReview';

/**
 * PEIA-17D — SQLITE LOCAL PENDING TASK REPOSITORY ADAPTER TEST SUITE.
 * Enforces exactly 46 real test units covering SQLite storage, idempotency,
 * conflict rejection, corruption detection, schema invariants, and cleanup.
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

async function assertRepositoryError(
  fn: () => Promise<unknown> | unknown,
  expectedCode: string
): Promise<SqlitePendingTaskRepositoryError> {
  try {
    await fn();
  } catch (err: unknown) {
    if (err instanceof SqlitePendingTaskRepositoryError) {
      if (err.code !== expectedCode) {
        throw new Error(
          `Expected repository error code "${expectedCode}", but received "${err.code}" (message: "${err.message}")`
        );
      }
      return err;
    }
    throw err;
  }
  throw new Error(
    `Expected SqlitePendingTaskRepositoryError with code "${expectedCode}", but function returned normally.`
  );
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

async function runSuite() {
  console.log('--- PEIA-17D 46-Test SQLite Repository Adapter Audit ---');

  // 1. SqlitePendingTaskRepository class exists
  await test('1. SqlitePendingTaskRepository class exists', () => {
    assert(
      typeof SqlitePendingTaskRepository === 'function',
      'SqlitePendingTaskRepository must be a class/constructor'
    );
  });

  // 2. repository implements save behavior
  await test('2. repository implements save behavior', () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      assert(typeof repo.save === 'function', 'repo.save must be a function');
    } finally {
      repo.close();
    }
  });

  // 3. repository implements findByTaskId behavior
  await test('3. repository implements findByTaskId behavior', () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      assert(typeof repo.findByTaskId === 'function', 'repo.findByTaskId must be a function');
    } finally {
      repo.close();
    }
  });

  // 4. repository implements listDownloaded behavior
  await test('4. repository implements listDownloaded behavior', () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      assert(typeof repo.listDownloaded === 'function', 'repo.listDownloaded must be a function');
    } finally {
      repo.close();
    }
  });

  // 5. ':memory:' database opens successfully
  await test('5. :memory: database opens successfully', () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    assert(repo !== null, 'Repository must open memory db successfully');
    repo.close();
  });

  // 6. schema initializes automatically
  await test('6. schema initializes automatically', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      const result = await repo.findByTaskId('non-existent');
      assert(result === null, 'Query on initialized schema must succeed and return null');
    } finally {
      repo.close();
    }
  });

  // 7. schema initialization is idempotent across two repository instances using same file
  await test('7. schema initialization is idempotent across two repository instances using same file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-idempotent-schema-'));
    const dbPath = join(tempDir, 'test.db');
    let repo1: SqlitePendingTaskRepository | null = null;
    let repo2: SqlitePendingTaskRepository | null = null;
    try {
      repo1 = new SqlitePendingTaskRepository(dbPath);
      await repo1.save(canonicalValidRecord);
      repo1.close();
      repo1 = null;

      repo2 = new SqlitePendingTaskRepository(dbPath);
      const found = await repo2.findByTaskId(canonicalValidRecord.taskId);
      assert(found !== null, 'Saved record must be found in second instance after schema init');
      assert(
        JSON.stringify(found) === JSON.stringify(canonicalValidRecord),
        'Persisted record must be structurally preserved across second instance schema initialization'
      );
      repo2.close();
      repo2 = null;
    } finally {
      try {
        repo1?.close();
      } catch {}
      try {
        repo2?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 8. first save inserts valid record
  await test('8. first save inserts valid record', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const found = await repo.findByTaskId(canonicalValidRecord.taskId);
      assert(found !== null, 'Saved record must be retrievable');
    } finally {
      repo.close();
    }
  });

  // 9. findByTaskId returns saved record
  await test('9. findByTaskId returns saved record', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const found = await repo.findByTaskId(canonicalValidRecord.taskId);
      assert(found?.taskId === canonicalValidRecord.taskId, 'taskId must match');
      assert(found?.principalId === canonicalValidRecord.principalId, 'principalId must match');
    } finally {
      repo.close();
    }
  });

  // 10. returned record is structurally equal to saved canonical record
  await test('10. returned record is structurally equal to saved canonical record', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const found = await repo.findByTaskId(canonicalValidRecord.taskId);
      assert(JSON.stringify(found) === JSON.stringify(canonicalValidRecord), 'Must be structurally identical');
    } finally {
      repo.close();
    }
  });

  // 11. nested contentSnapshot survives serialize/deserialize
  await test('11. nested contentSnapshot survives serialize/deserialize', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const found = await repo.findByTaskId(canonicalValidRecord.taskId);
      assert(
        JSON.stringify(found?.contentSnapshot) === JSON.stringify(canonicalValidRecord.contentSnapshot),
        'Nested snapshot must match exactly'
      );
    } finally {
      repo.close();
    }
  });

  // 12. find missing task returns null
  await test('12. find missing task returns null', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      const found = await repo.findByTaskId('missing-task-id');
      assert(found === null, 'Missing task must return null');
    } finally {
      repo.close();
    }
  });

  // 13. second exact same save succeeds idempotently
  await test('13. second exact same save succeeds idempotently', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      await repo.save(canonicalValidRecord); // Must succeed without error
      const found = await repo.findByTaskId(canonicalValidRecord.taskId);
      assert(found?.taskId === canonicalValidRecord.taskId, 'Record must exist');
    } finally {
      repo.close();
    }
  });

  // 14. idempotent re-save does NOT create duplicate row
  await test('14. idempotent re-save does NOT create duplicate row', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      await repo.save(canonicalValidRecord);
      const list = await repo.listDownloaded();
      assert(list.length === 1, `Expected exactly 1 row, got ${list.length}`);
    } finally {
      repo.close();
    }
  });

  // 15. same taskId + changed targetId → TASK_CONFLICT
  await test('15. same taskId + changed targetId → TASK_CONFLICT', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const conflictingRecord = {
        ...canonicalValidRecord,
        target: {
          ...canonicalValidRecord.target,
          targetId: 'different-target',
        },
      };
      await assertRepositoryError(() => repo.save(conflictingRecord), 'TASK_CONFLICT');
    } finally {
      repo.close();
    }
  });

  // 16. same taskId + changed contentSnapshot → TASK_CONFLICT
  await test('16. same taskId + changed contentSnapshot → TASK_CONFLICT', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const conflictingRecord = {
        ...canonicalValidRecord,
        contentSnapshot: {
          ...canonicalValidRecord.contentSnapshot,
          title: 'Modified Title',
        },
      };
      await assertRepositoryError(() => repo.save(conflictingRecord), 'TASK_CONFLICT');
    } finally {
      repo.close();
    }
  });

  // 17. same taskId + changed principalId → TASK_CONFLICT
  await test('17. same taskId + changed principalId → TASK_CONFLICT', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const conflictingRecord = {
        ...canonicalValidRecord,
        principalId: 'worker-principal-beta-2',
      };
      await assertRepositoryError(() => repo.save(conflictingRecord), 'TASK_CONFLICT');
    } finally {
      repo.close();
    }
  });

  // 18. conflicting save does NOT alter original persisted record
  await test('18. conflicting save does NOT alter original persisted record', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const conflictingRecord = {
        ...canonicalValidRecord,
        principalId: 'worker-principal-beta-2',
      };
      await assertRepositoryError(() => repo.save(conflictingRecord), 'TASK_CONFLICT');
      const found = await repo.findByTaskId(canonicalValidRecord.taskId);
      assert(found?.principalId === canonicalValidRecord.principalId, 'Original principalId must remain unchanged');
    } finally {
      repo.close();
    }
  });

  // 19. listDownloaded returns saved records
  await test('19. listDownloaded returns saved records', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await repo.save(canonicalValidRecord);
      const list = await repo.listDownloaded();
      assert(list.length === 1, 'listDownloaded must return 1 item');
      assert(list[0].taskId === canonicalValidRecord.taskId, 'taskId must match');
    } finally {
      repo.close();
    }
  });

  // 20. listDownloaded deterministic ordering by remoteCreatedAt then taskId
  await test('20. listDownloaded deterministic ordering by remoteCreatedAt then taskId', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      const taskA = {
        ...canonicalValidRecord,
        taskId: 'task-a',
        remoteCreatedAt: '2026-09-28T02:00:00.000Z',
      };
      const taskB = {
        ...canonicalValidRecord,
        taskId: 'task-b',
        remoteCreatedAt: '2026-09-28T01:00:00.000Z',
      };
      const taskC = {
        ...canonicalValidRecord,
        taskId: 'task-c',
        remoteCreatedAt: '2026-09-28T01:00:00.000Z',
      };

      await repo.save(taskA);
      await repo.save(taskB);
      await repo.save(taskC);

      const list = await repo.listDownloaded();
      assert(list.length === 3, 'Must have 3 items');
      assert(list[0].taskId === 'task-b', 'First must be task-b (earlier date, alphabetical taskId)');
      assert(list[1].taskId === 'task-c', 'Second must be task-c (earlier date, alphabetical taskId)');
      assert(list[2].taskId === 'task-a', 'Third must be task-a (later date)');
    } finally {
      repo.close();
    }
  });

  // 21. listDownloaded returns only Downloaded state
  await test('21. listDownloaded returns only Downloaded state', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-filter-'));
    const dbPath = join(tempDir, 'filter.db');
    let repo: SqlitePendingTaskRepository | null = null;
    let rawDb: DatabaseSync | null = null;
    let reopenedRepo: SqlitePendingTaskRepository | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);
      await repo.save(canonicalValidRecord);
      repo.close();
      repo = null;

      // Inject row with a different local_state in raw DB
      rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        INSERT INTO peia_pending_tasks (
          task_id, principal_id, task_type, target_type, target_id,
          source_updated_at, content_snapshot_json, remote_created_at,
          remote_status, local_state
        ) VALUES (
          'task-other-state', 'p-1', 'CONTENT_REVIEW', 'News', 'news-1',
          '2026-09-27T00:00:00.000Z', '{"title":"T"}', '2026-09-28T00:00:00.000Z',
          'Pending', 'Completed'
        )
      `);
      rawDb.close();
      rawDb = null;

      reopenedRepo = new SqlitePendingTaskRepository(dbPath);
      const list = await reopenedRepo.listDownloaded();
      assert(list.length === 1, 'Only Downloaded rows must be returned');
      assert(list[0].taskId === canonicalValidRecord.taskId, 'Must return canonical record');
      reopenedRepo.close();
      reopenedRepo = null;
    } finally {
      try {
        rawDb?.close();
      } catch {}
      try {
        repo?.close();
      } catch {}
      try {
        reopenedRepo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 22. invalid save record fails DATABASE_WRITE_FAILED
  await test('22. invalid save record fails DATABASE_WRITE_FAILED', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      const invalidRecord = {
        ...canonicalValidRecord,
        taskType: 'INVALID_TYPE' as unknown as typeof AITaskType.CONTENT_REVIEW,
      };
      await assertRepositoryError(() => repo.save(invalidRecord), 'DATABASE_WRITE_FAILED');
    } finally {
      repo.close();
    }
  });

  // 23. blank taskId find fails DATABASE_READ_FAILED
  await test('23. blank taskId find fails DATABASE_READ_FAILED', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await assertRepositoryError(() => repo.findByTaskId(''), 'DATABASE_READ_FAILED');
    } finally {
      repo.close();
    }
  });

  // 24. padded taskId find fails DATABASE_READ_FAILED
  await test('24. padded taskId find fails DATABASE_READ_FAILED', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      await assertRepositoryError(() => repo.findByTaskId('  padded-id  '), 'DATABASE_READ_FAILED');
    } finally {
      repo.close();
    }
  });

  // 25. invalid database path fails INVALID_DATABASE_PATH
  await test('25. invalid database path fails INVALID_DATABASE_PATH', () => {
    assertRepositoryError(() => new SqlitePendingTaskRepository(''), 'INVALID_DATABASE_PATH');
    assertRepositoryError(() => new SqlitePendingTaskRepository('   '), 'INVALID_DATABASE_PATH');
    assertRepositoryError(() => new SqlitePendingTaskRepository('  padded.db  '), 'INVALID_DATABASE_PATH');
  });

  // 26. nonexistent parent/path open failure maps DATABASE_OPEN_FAILED
  await test('26. nonexistent parent/path open failure maps DATABASE_OPEN_FAILED', () => {
    const invalidPath = '/nonexistent-directory-abc-123-xyz/db.sqlite';
    assertRepositoryError(() => new SqlitePendingTaskRepository(invalidPath), 'DATABASE_OPEN_FAILED');
  });

  // 27. close succeeds
  await test('27. close succeeds', () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    repo.close();
  });

  // 28. close is idempotent
  await test('28. close is idempotent', () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    repo.close();
    repo.close(); // Second close must be safe
  });

  // 29. find after close fails bounded DATABASE_READ_FAILED
  await test('29. find after close fails bounded DATABASE_READ_FAILED', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    repo.close();
    await assertRepositoryError(() => repo.findByTaskId('task-1'), 'DATABASE_READ_FAILED');
  });

  // 30. save after close fails bounded DATABASE_WRITE_FAILED
  await test('30. save after close fails bounded DATABASE_WRITE_FAILED', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    repo.close();
    await assertRepositoryError(() => repo.save(canonicalValidRecord), 'DATABASE_WRITE_FAILED');
  });

  // 31. list after close fails bounded DATABASE_READ_FAILED
  await test('31. list after close fails bounded DATABASE_READ_FAILED', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    repo.close();
    await assertRepositoryError(() => repo.listDownloaded(), 'DATABASE_READ_FAILED');
  });

  // 32. file-backed database persists across close/reopen
  await test('32. file-backed database persists across close/reopen', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-file-persist-'));
    const dbPath = join(tempDir, 'persist.db');
    let repo1: SqlitePendingTaskRepository | null = null;
    let repo2: SqlitePendingTaskRepository | null = null;
    try {
      repo1 = new SqlitePendingTaskRepository(dbPath);
      await repo1.save(canonicalValidRecord);
      repo1.close();
      repo1 = null;

      repo2 = new SqlitePendingTaskRepository(dbPath);
      const found = await repo2.findByTaskId(canonicalValidRecord.taskId);
      assert(found !== null, 'Record must persist in file-backed database');
      assert(found.taskId === canonicalValidRecord.taskId, 'taskId must match');
      repo2.close();
      repo2 = null;
    } finally {
      try {
        repo1?.close();
      } catch {}
      try {
        repo2?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 33. reopened file returns structurally equal record
  await test('33. reopened file returns structurally equal record', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-file-struct-'));
    const dbPath = join(tempDir, 'struct.db');
    let repo1: SqlitePendingTaskRepository | null = null;
    let repo2: SqlitePendingTaskRepository | null = null;
    try {
      repo1 = new SqlitePendingTaskRepository(dbPath);
      await repo1.save(canonicalValidRecord);
      repo1.close();
      repo1 = null;

      repo2 = new SqlitePendingTaskRepository(dbPath);
      const found = await repo2.findByTaskId(canonicalValidRecord.taskId);
      assert(JSON.stringify(found) === JSON.stringify(canonicalValidRecord), 'Must be structurally identical across sessions');
      repo2.close();
      repo2 = null;
    } finally {
      try {
        repo1?.close();
      } catch {}
      try {
        repo2?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 34. all four canonical AIReviewTargetType values persist and reload
  await test('34. all four canonical AIReviewTargetType values persist and reload', async () => {
    const repo = new SqlitePendingTaskRepository(':memory:');
    try {
      const targetTypes = [
        AIReviewTargetType.News,
        AIReviewTargetType.LibraryDocument,
        AIReviewTargetType.TrainingCourse,
        AIReviewTargetType.CitizenSubmission,
      ];

      for (let i = 0; i < targetTypes.length; i++) {
        const targetType = targetTypes[i];
        const record: StoredPendingTaskRecord = {
          ...canonicalValidRecord,
          taskId: `task-target-${i}`,
          target: {
            ...canonicalValidRecord.target,
            targetType,
          },
        };
        await repo.save(record);
        const reloaded = await repo.findByTaskId(record.taskId);
        assert(reloaded !== null, `Record with targetType ${targetType} must be reloaded`);
        assert(reloaded.target.targetType === targetType, `Target type ${targetType} must match`);
      }
    } finally {
      repo.close();
    }
  });

  // 35. corrupt JSON content_snapshot_json → CORRUPT_STORED_RECORD
  await test('35. corrupt JSON content_snapshot_json → CORRUPT_STORED_RECORD', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-corrupt-json-'));
    const dbPath = join(tempDir, 'corrupt.db');
    let repo: SqlitePendingTaskRepository | null = null;
    let rawDb: DatabaseSync | null = null;
    let reopenedRepo: SqlitePendingTaskRepository | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);
      repo.close();
      repo = null;

      rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        INSERT INTO peia_pending_tasks (
          task_id, principal_id, task_type, target_type, target_id,
          source_updated_at, content_snapshot_json, remote_created_at,
          remote_status, local_state
        ) VALUES (
          'task-corrupt-json', 'p-1', 'CONTENT_REVIEW', 'News', 'news-1',
          '2026-09-27T00:00:00.000Z', 'INVALID_JSON{broken', '2026-09-28T00:00:00.000Z',
          'Pending', 'Downloaded'
        )
      `);
      rawDb.close();
      rawDb = null;

      reopenedRepo = new SqlitePendingTaskRepository(dbPath);
      await assertRepositoryError(
        () => reopenedRepo!.findByTaskId('task-corrupt-json'),
        'CORRUPT_STORED_RECORD'
      );
      reopenedRepo.close();
      reopenedRepo = null;
    } finally {
      try {
        rawDb?.close();
      } catch {}
      try {
        repo?.close();
      } catch {}
      try {
        reopenedRepo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 36. corrupt task_type persisted row → CORRUPT_STORED_RECORD
  await test('36. corrupt task_type persisted row → CORRUPT_STORED_RECORD', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-corrupt-tasktype-'));
    const dbPath = join(tempDir, 'corrupt.db');
    let repo: SqlitePendingTaskRepository | null = null;
    let rawDb: DatabaseSync | null = null;
    let reopenedRepo: SqlitePendingTaskRepository | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);
      repo.close();
      repo = null;

      rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        INSERT INTO peia_pending_tasks (
          task_id, principal_id, task_type, target_type, target_id,
          source_updated_at, content_snapshot_json, remote_created_at,
          remote_status, local_state
        ) VALUES (
          'task-corrupt-tasktype', 'p-1', 'INVALID_TASK_TYPE', 'News', 'news-1',
          '2026-09-27T00:00:00.000Z', '{"title":"T"}', '2026-09-28T00:00:00.000Z',
          'Pending', 'Downloaded'
        )
      `);
      rawDb.close();
      rawDb = null;

      reopenedRepo = new SqlitePendingTaskRepository(dbPath);
      await assertRepositoryError(
        () => reopenedRepo!.findByTaskId('task-corrupt-tasktype'),
        'CORRUPT_STORED_RECORD'
      );
      reopenedRepo.close();
      reopenedRepo = null;
    } finally {
      try {
        rawDb?.close();
      } catch {}
      try {
        repo?.close();
      } catch {}
      try {
        reopenedRepo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 37. corrupt local_state persisted row → CORRUPT_STORED_RECORD
  await test('37. corrupt local_state persisted row → CORRUPT_STORED_RECORD', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-corrupt-localstate-'));
    const dbPath = join(tempDir, 'corrupt.db');
    let repo: SqlitePendingTaskRepository | null = null;
    let rawDb: DatabaseSync | null = null;
    let reopenedRepo: SqlitePendingTaskRepository | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);
      repo.close();
      repo = null;

      rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        INSERT INTO peia_pending_tasks (
          task_id, principal_id, task_type, target_type, target_id,
          source_updated_at, content_snapshot_json, remote_created_at,
          remote_status, local_state
        ) VALUES (
          'task-corrupt-localstate', 'p-1', 'CONTENT_REVIEW', 'News', 'news-1',
          '2026-09-27T00:00:00.000Z', '{"title":"T"}', '2026-09-28T00:00:00.000Z',
          'Pending', 'INVALID_STATE'
        )
      `);
      rawDb.close();
      rawDb = null;

      reopenedRepo = new SqlitePendingTaskRepository(dbPath);
      await assertRepositoryError(
        () => reopenedRepo!.findByTaskId('task-corrupt-localstate'),
        'CORRUPT_STORED_RECORD'
      );
      reopenedRepo.close();
      reopenedRepo = null;
    } finally {
      try {
        rawDb?.close();
      } catch {}
      try {
        repo?.close();
      } catch {}
      try {
        reopenedRepo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 38. list fails entirely if one row is corrupt
  await test('38. list fails entirely if one row is corrupt', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-corrupt-list-'));
    const dbPath = join(tempDir, 'corrupt.db');
    let repo: SqlitePendingTaskRepository | null = null;
    let rawDb: DatabaseSync | null = null;
    let reopenedRepo: SqlitePendingTaskRepository | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);
      await repo.save(canonicalValidRecord);
      repo.close();
      repo = null;

      rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        INSERT INTO peia_pending_tasks (
          task_id, principal_id, task_type, target_type, target_id,
          source_updated_at, content_snapshot_json, remote_created_at,
          remote_status, local_state
        ) VALUES (
          'task-corrupt-list', 'p-1', 'INVALID_TASK_TYPE', 'News', 'news-1',
          '2026-09-27T00:00:00.000Z', '{"title":"T"}', '2026-09-28T00:00:00.000Z',
          'Pending', 'Downloaded'
        )
      `);
      rawDb.close();
      rawDb = null;

      reopenedRepo = new SqlitePendingTaskRepository(dbPath);
      await assertRepositoryError(
        () => reopenedRepo!.listDownloaded(),
        'CORRUPT_STORED_RECORD'
      );
      reopenedRepo.close();
      reopenedRepo = null;
    } finally {
      try {
        rawDb?.close();
      } catch {}
      try {
        repo?.close();
      } catch {}
      try {
        reopenedRepo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 39. raw SQLite error text is not leaked
  await test('39. raw SQLite error text is not leaked', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-raw-sqlite-error-'));
    const dbPath = join(tempDir, 'raw-error.db');
    let repo: SqlitePendingTaskRepository | null = null;
    let rawDb: DatabaseSync | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);

      // Trigger a real SQLite engine failure by dropping the table from underneath the repository
      rawDb = new DatabaseSync(dbPath);
      rawDb.exec('DROP TABLE peia_pending_tasks');
      rawDb.close();
      rawDb = null;

      const err = await assertRepositoryError(
        () => repo!.findByTaskId('task-raw-sqlite-error'),
        'DATABASE_READ_FAILED'
      );
      assert(
        err.message === 'Unable to read local task database.',
        `Expected fixed message "Unable to read local task database.", got "${err.message}"`
      );
      assert(!err.message.includes('SQLITE'), 'Message must not leak raw SQLITE text');
      assert(!err.message.includes('no such table'), 'Message must not leak "no such table" text');
      assert(!err.message.includes('peia_pending_tasks'), 'Message must not leak table name');
      assert(!err.message.includes(dbPath), 'Message must not leak database path');
    } finally {
      try {
        rawDb?.close();
      } catch {}
      try {
        repo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 40. database path is not leaked in errors
  await test('40. database path is not leaked in errors', async () => {
    const secretPath = '/secret/classified/path/to/database.db';
    const err = await assertRepositoryError(
      () => new SqlitePendingTaskRepository(secretPath),
      'DATABASE_OPEN_FAILED'
    );
    assert(!err.message.includes(secretPath), 'Error message must not leak database path');
    assert(!err.message.includes('/secret/classified'), 'Error message must not leak partial path');
  });

  // 41. schema has exactly expected columns
  await test('41. schema has exactly expected columns', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-schema-cols-'));
    const dbPath = join(tempDir, 'schema.db');
    let repo: SqlitePendingTaskRepository | null = null;
    let rawDb: DatabaseSync | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);
      repo.close();
      repo = null;

      rawDb = new DatabaseSync(dbPath);
      const tableInfo = rawDb.prepare('PRAGMA table_info(peia_pending_tasks)').all() as Array<{ name: string }>;
      rawDb.close();
      rawDb = null;

      const colNames = tableInfo.map((col) => col.name).sort();
      const expected = [
        'content_snapshot_json',
        'local_state',
        'principal_id',
        'remote_created_at',
        'remote_status',
        'source_updated_at',
        'target_id',
        'target_type',
        'task_id',
        'task_type',
      ].sort();

      assert(colNames.length === 10, `Expected 10 columns, found ${colNames.length}`);
      assert(JSON.stringify(colNames) === JSON.stringify(expected), 'Columns must match expected schema exactly');
    } finally {
      try {
        rawDb?.close();
      } catch {}
      try {
        repo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 42. schema contains no credential/endpoint/authority/timestamp columns
  await test('42. schema contains no credential/endpoint/authority/timestamp columns', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'peia-test-schema-forbidden-'));
    const dbPath = join(tempDir, 'forbidden.db');
    let repo: SqlitePendingTaskRepository | null = null;
    let rawDb: DatabaseSync | null = null;
    try {
      repo = new SqlitePendingTaskRepository(dbPath);
      repo.close();
      repo = null;

      rawDb = new DatabaseSync(dbPath);
      const tableInfo = rawDb.prepare('PRAGMA table_info(peia_pending_tasks)').all() as Array<{ name: string }>;
      rawDb.close();
      rawDb = null;

      const colNames = tableInfo.map((col) => col.name);
      const forbiddenColumns = [
        'credential',
        'token',
        'machine_token',
        'api_key',
        'service_account',
        'endpoint_url',
        'approved',
        'published',
        'decision',
        'workflow_state',
        'desired_workflow_state',
        'permission',
        'role',
        'auto_apply',
        'auto_publish',
        'suggested_action',
        'downloaded_at',
        'stored_at',
        'updated_at',
        'created_at',
      ];

      for (const forbidden of forbiddenColumns) {
        assert(!colNames.includes(forbidden), `Forbidden column "${forbidden}" found in schema`);
      }
    } finally {
      try {
        rawDb?.close();
      } catch {}
      try {
        repo?.close();
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 43. source uses node:sqlite only and no external SQLite package
  await test('43. source uses node:sqlite only and no external SQLite package', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqlitePendingTaskRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes("from 'node:sqlite'"), 'Source must import from node:sqlite');
    assert(!source.includes('better-sqlite3'), 'Source must not contain better-sqlite3');
    assert(!source.includes('sqlite3'), 'Source must not contain sqlite3');
    assert(!source.includes('sql.js'), 'Source must not contain sql.js');
  });

  // 44. source contains no UPDATE / REPLACE / UPSERT mutation path
  await test('44. source contains no UPDATE / REPLACE / UPSERT mutation path', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqlitePendingTaskRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(!source.includes('UPDATE peia_pending_tasks'), 'No UPDATE allowed');
    assert(!source.includes('INSERT OR REPLACE'), 'No INSERT OR REPLACE allowed');
    assert(!source.includes('REPLACE INTO'), 'No REPLACE INTO allowed');
    assert(!source.includes('ON CONFLICT'), 'No ON CONFLICT allowed');
    assert(!source.includes('UPSERT'), 'No UPSERT allowed');
  });

  // 45. source uses parameterized statements for dynamic task values
  await test('45. source uses parameterized statements for dynamic task values', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqlitePendingTaskRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes('.prepare('), 'Must use .prepare(');
    assert(source.includes('.run('), 'Must use .run(');
    assert(source.includes('.get('), 'Must use .get(');
    assert(source.includes('.all('), 'Must use .all(');

    assert(!source.includes('${record.taskId}'), 'No interpolation of record.taskId');
    assert(!source.includes('${taskId}'), 'No interpolation of taskId');
    assert(!source.includes('${principalId}'), 'No interpolation of principalId');
    assert(!source.includes('${targetId}'), 'No interpolation of targetId');
    assert(!source.includes('${contentSnapshot}'), 'No interpolation of contentSnapshot');
  });

  // 46. source invariants + exact final count gate
  await test('46. source invariants + exact final count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqlitePendingTaskRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    const requiredInvariants = [
      'node:sqlite',
      'DatabaseSync',
      'peia_pending_tasks',
      'validateStoredPendingTaskRecord',
      'isSameStoredPendingTaskRecord',
      'LocalPendingTaskState',
    ];

    for (const req of requiredInvariants) {
      assert(source.includes(req), `Source must include "${req}"`);
    }

    const forbiddenInvariants = [
      'better-sqlite3',
      'sqlite3',
      'sql.js',
      'firebase-admin',
      'firebase-functions',
      'functions/src/',
      'fetch',
      'globalThis.fetch',
      'Authorization',
      'Bearer',
      'credential',
      'endpointUrl',
      'Date.now',
      'new Date',
      'CURRENT_TIMESTAMP',
      'datetime(',
      'strftime(',
      'Math.random',
      'randomUUID',
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
      'INSERT OR REPLACE',
      'REPLACE INTO',
      'ON CONFLICT',
      'UPDATE peia_pending_tasks',
    ];

    for (const forb of forbiddenInvariants) {
      assert(!source.includes(forb), `Source must not include forbidden invariant "${forb}"`);
    }

    assert(totalTests === 46, `Expected exactly 46 tests, found ${totalTests}`);
    assert(passedTests === 45, `Expected 45 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 46, `Expected exactly 46 tests, found ${totalTests}`);
  assert(passedTests === 46, `Expected exactly 46 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
