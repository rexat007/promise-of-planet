import {
  SqliteNonAdvisoryOutcomeRepository,
  SqliteNonAdvisoryOutcomeRepositoryError,
} from '../peia-worker/src/sqliteNonAdvisoryOutcomeRepository';
import {
  NonAdvisoryOutcomeKind,
  validateDurableNonAdvisoryOutcomeRecord,
} from '../peia-worker/src/localNonAdvisoryOutcomeContract';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  console.log('--- RUNNING PEIA SQLITE NON-ADVISORY OUTCOME REPOSITORY TESTS ---');

  const tmpDbPath = path.join(process.cwd(), `test_non_advisory_${Date.now()}.db`);

  // Cleanup helper
  const cleanup = () => {
    try {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
    } catch {
      // ignore
    }
  };

  cleanup();

  // 1. table created & basic save/findByTaskId
  await test('1. table created and first valid save persists / findByTaskId round-trip', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-100',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'MISSING_RETRIEVAL_QUERY',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    await repo.save(record);
    const found = await repo.findByTaskId('task-100');
    assert(found !== null, 'found should not be null');
    assert(found?.taskId === 'task-100', 'taskId');
    assert(found?.kind === NonAdvisoryOutcomeKind.INPUT_FAILURE, 'kind');
    repo.close();
  });

  // 2. identical save idempotent
  await test('2. identical save idempotent', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-100',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'MISSING_RETRIEVAL_QUERY',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    // Save again identically
    await repo.save(record);
    const found = await repo.findByTaskId('task-100');
    assert(found?.taskId === 'task-100', 'still found');
    repo.close();
  });

  // 3. conflicting same-task save rejected
  await test('3. conflicting same-task save rejected with OUTCOME_CONFLICT', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const conflictRecord = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-100',
      kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
      reason: 'INVALID_RETRIEVAL_QUERY',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    try {
      await repo.save(conflictRecord);
      assert(false, 'Should have thrown conflict error');
    } catch (err) {
      assert(err instanceof SqliteNonAdvisoryOutcomeRepositoryError, 'error type');
      assert((err as SqliteNonAdvisoryOutcomeRepositoryError).code === 'OUTCOME_CONFLICT', 'conflict code');
    }
    repo.close();
  });

  // 4. ABSTAINED persistence
  await test('4. ABSTAINED persistence', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-abstain-1',
      kind: NonAdvisoryOutcomeKind.ABSTAINED,
      reason: 'NO_EVIDENCE',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    await repo.save(record);
    const found = await repo.findByTaskId('task-abstain-1');
    assert(found?.kind === NonAdvisoryOutcomeKind.ABSTAINED, 'kind');
    assert(found?.reason === 'NO_EVIDENCE', 'reason');
    repo.close();
  });

  // 5. RETRIEVAL_FAILURE sourceFailures deep round-trip
  await test('5. RETRIEVAL_FAILURE sourceFailures deep round-trip', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-retrieval-1',
      kind: NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE,
      reason: 'TOTAL_RETRIEVAL_FAILURE',
      modelAttempts: 0,
      sourceFailures: [
        { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
        { sourceId: 'NOAA', errorCode: 'INVALID_SOURCE_RESPONSE' },
      ],
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    await repo.save(record);
    const found = await repo.findByTaskId('task-retrieval-1');
    assert(found?.kind === NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE, 'kind');
    assert(found?.kind === 'RETRIEVAL_FAILURE' && found.sourceFailures.length === 2, 'sourceFailures length');
    assert(found?.kind === 'RETRIEVAL_FAILURE' && found.sourceFailures[0].sourceId === 'EPA', 'source 1');
    repo.close();
  });

  // 6. MODEL_FAILURE exitCode round-trip
  await test('6. MODEL_FAILURE exitCode round-trip', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const record = validateDurableNonAdvisoryOutcomeRecord({
      taskId: 'task-model-1',
      kind: NonAdvisoryOutcomeKind.MODEL_FAILURE,
      reason: 'NON_ZERO_EXIT',
      modelAttempts: 2,
      exitCode: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    await repo.save(record);
    const found = await repo.findByTaskId('task-model-1');
    assert(found?.kind === NonAdvisoryOutcomeKind.MODEL_FAILURE, 'kind');
    assert(found?.kind === 'MODEL_FAILURE' && found.exitCode === 1, 'exitCode');
    repo.close();
  });

  // 7. persistence survives close/reopen
  await test('7. persistence survives close/reopen', async () => {
    const repo1 = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const found1 = await repo1.findByTaskId('task-model-1');
    assert(found1 !== null, 'found in repo1');
    repo1.close();

    const repo2 = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const found2 = await repo2.findByTaskId('task-model-1');
    assert(found2?.taskId === 'task-model-1', 'found in repo2');
    repo2.close();
  });

  // 8. unknown task returns null
  await test('8. unknown task returns null', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    const found = await repo.findByTaskId('unknown-task');
    assert(found === null, 'should be null');
    repo.close();
  });

  // 9. corrupt stored row fails closed
  await test('9. corrupt stored row fails closed with CORRUPT_STORED_RECORD', async () => {
    // Manually insert corrupt row directly via SQLite
    const rawDb = new DatabaseSync(tmpDbPath);
    rawDb.exec(`
      INSERT OR REPLACE INTO peia_non_advisory_outcomes (
        task_id, kind, reason, model_attempts, detail, exit_code, source_failures_json, created_at
      ) VALUES ('corrupt-task', 'INVALID_KIND_XYZ', 'BAD', -1, NULL, NULL, NULL, 'bad-date');
    `);
    rawDb.close();

    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    try {
      await repo.findByTaskId('corrupt-task');
      assert(false, 'Should have thrown corrupt error');
    } catch (err) {
      assert(err instanceof SqliteNonAdvisoryOutcomeRepositoryError, 'error type');
      assert((err as SqliteNonAdvisoryOutcomeRepositoryError).code === 'CORRUPT_STORED_RECORD', 'corrupt code');
    }
    repo.close();
  });

  // 10. invalid input fails before persistence
  await test('10. invalid input fails before persistence', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    try {
      await repo.save({ taskId: '', kind: 'INPUT_FAILURE', reason: 'MISSING_RETRIEVAL_QUERY', modelAttempts: 0, createdAt: 'bad' } as any);
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof SqliteNonAdvisoryOutcomeRepositoryError, 'error type');
    }
    repo.close();
  });

  // 11. repository close behavior
  await test('11. repository operations after close throw error', async () => {
    const repo = new SqliteNonAdvisoryOutcomeRepository(tmpDbPath);
    repo.close();
    try {
      await repo.findByTaskId('task-100');
      assert(false, 'Should have thrown read error');
    } catch (err) {
      assert(err instanceof SqliteNonAdvisoryOutcomeRepositoryError, 'error type');
    }
  });

  // 12. no advisory table modified / no lifecycle table modified
  await test('12. no advisory or lifecycle tables modified by non-advisory repo', async () => {
    const rawDb = new DatabaseSync(tmpDbPath);
    const tables = rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    assert(tableNames.includes('peia_non_advisory_outcomes'), 'non-advisory table exists');
    assert(!tableNames.includes('peia_advisory_result_outbox'), 'advisory table not created');
    assert(!tableNames.includes('peia_task_processing'), 'lifecycle table not created');
    rawDb.close();
  });

  cleanup();

  console.log(`\nALL SQLITE REPOSITORY TESTS COMPLETED: ${passedTests}/${totalTests} PASSED`);
})();
