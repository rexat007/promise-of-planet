import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  SqliteAdvisoryResultOutboxRepository,
  SqliteAdvisoryResultOutboxRepositoryError,
  type SqliteAdvisoryResultOutboxRepositoryErrorCode,
} from '../peia-worker/src/sqliteAdvisoryResultOutboxRepository';
import {
  LocalAdvisoryResultOutboxState,
  createStoredAdvisoryResultRecord,
  isSameStoredAdvisoryResultRecord,
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

function assertThrowsRepoError(
  fn: () => unknown,
  expectedCode: SqliteAdvisoryResultOutboxRepositoryErrorCode,
  expectedMessage: string
): void {
  try {
    fn();
  } catch (err: unknown) {
    assert(
      err instanceof SqliteAdvisoryResultOutboxRepositoryError,
      'Error must be instanceof SqliteAdvisoryResultOutboxRepositoryError'
    );
    const repoErr = err as SqliteAdvisoryResultOutboxRepositoryError;
    assert(
      repoErr.code === expectedCode,
      `Expected error code ${expectedCode}, got ${repoErr.code}`
    );
    assert(
      repoErr.message === expectedMessage,
      `Expected error message "${expectedMessage}", got "${repoErr.message}"`
    );
    return;
  }
  throw new Error('Expected function to throw SqliteAdvisoryResultOutboxRepositoryError, but it returned normally.');
}

async function assertRejectsRepoError(
  fn: () => Promise<unknown>,
  expectedCode: SqliteAdvisoryResultOutboxRepositoryErrorCode,
  expectedMessage: string
): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    assert(
      err instanceof SqliteAdvisoryResultOutboxRepositoryError,
      'Error must be instanceof SqliteAdvisoryResultOutboxRepositoryError'
    );
    const repoErr = err as SqliteAdvisoryResultOutboxRepositoryError;
    assert(
      repoErr.code === expectedCode,
      `Expected error code ${expectedCode}, got ${repoErr.code}`
    );
    assert(
      repoErr.message === expectedMessage,
      `Expected error message "${expectedMessage}", got "${repoErr.message}"`
    );
    return;
  }
  throw new Error('Expected async function to reject with SqliteAdvisoryResultOutboxRepositoryError, but it resolved.');
}

let tempCounter = 0;
function getTempDbPath(): string {
  tempCounter++;
  return join(tmpdir(), `peia_advisory_outbox_test_${Date.now()}_${tempCounter}.sqlite`);
}

function cleanupDb(path: string): void {
  try {
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  } catch {
    // best-effort cleanup
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
  console.log('--- PEIA-18C 48-Test SQLite Advisory Result Outbox Repository Audit ---');

  // 1. SqliteAdvisoryResultOutboxRepository exists
  await test('1. SqliteAdvisoryResultOutboxRepository exists', () => {
    assert(
      typeof SqliteAdvisoryResultOutboxRepository === 'function',
      'SqliteAdvisoryResultOutboxRepository must be a class/constructor'
    );
  });

  // 2. error class exists
  await test('2. error class exists', () => {
    assert(
      typeof SqliteAdvisoryResultOutboxRepositoryError === 'function',
      'SqliteAdvisoryResultOutboxRepositoryError must be a class/constructor'
    );
  });

  // 3. exact seven error codes
  await test('3. exact seven error codes', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqliteAdvisoryResultOutboxRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    const typeMatch = source.match(
      /export\s+type\s+SqliteAdvisoryResultOutboxRepositoryErrorCode\s*=\s*([^;]+);/
    );
    assert(typeMatch !== null, 'Must declare SqliteAdvisoryResultOutboxRepositoryErrorCode');
    const codes = typeMatch![1]
      .split('|')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s.length > 0);

    const expectedCodes = [
      'INVALID_DATABASE_PATH',
      'DATABASE_OPEN_FAILED',
      'DATABASE_SCHEMA_FAILED',
      'DATABASE_READ_FAILED',
      'DATABASE_WRITE_FAILED',
      'RESULT_CONFLICT',
      'CORRUPT_STORED_RECORD',
    ];

    assert(codes.length === 7, `Expected exactly 7 error codes, got ${codes.length}`);
    for (const exp of expectedCodes) {
      assert(codes.includes(exp), `Missing error code: ${exp}`);
    }
  });

  // 4. exact fixed error mapping for all seven codes
  await test('4. exact fixed error mapping for all seven codes', () => {
    const mappings: Record<SqliteAdvisoryResultOutboxRepositoryErrorCode, string> = {
      INVALID_DATABASE_PATH: 'Invalid local advisory outbox database path.',
      DATABASE_OPEN_FAILED: 'Unable to open local advisory outbox database.',
      DATABASE_SCHEMA_FAILED: 'Unable to initialize local advisory outbox database.',
      DATABASE_READ_FAILED: 'Unable to read local advisory outbox database.',
      DATABASE_WRITE_FAILED: 'Unable to write local advisory outbox database.',
      RESULT_CONFLICT: 'Conflicting local advisory result record.',
      CORRUPT_STORED_RECORD: 'Stored advisory result record is invalid.',
    };

    for (const [code, expectedMsg] of Object.entries(mappings) as [SqliteAdvisoryResultOutboxRepositoryErrorCode, string][]) {
      const err = new SqliteAdvisoryResultOutboxRepositoryError(code);
      assert(err.code === code, `Code mismatch for ${code}`);
      assert(err.message === expectedMsg, `Message mismatch for ${code}`);
    }
  });

  // 5. error constructor accepts code only
  await test('5. error constructor accepts code only', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqliteAdvisoryResultOutboxRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(/constructor\s*\(([^)]*)\)/);
    assert(match !== null, 'Must find constructor signature');
    const param = match![1].trim();
    assert(
      param === 'code: SqliteAdvisoryResultOutboxRepositoryErrorCode',
      `Constructor parameter must be code-only, got: "${param}"`
    );
  });

  // 6. blank database path rejected
  await test('6. blank database path rejected', () => {
    assertThrowsRepoError(
      () => new SqliteAdvisoryResultOutboxRepository(''),
      'INVALID_DATABASE_PATH',
      'Invalid local advisory outbox database path.'
    );
  });

  // 7. whitespace-only database path rejected
  await test('7. whitespace-only database path rejected', () => {
    assertThrowsRepoError(
      () => new SqliteAdvisoryResultOutboxRepository('   '),
      'INVALID_DATABASE_PATH',
      'Invalid local advisory outbox database path.'
    );
  });

  // 8. padded database path rejected
  await test('8. padded database path rejected', () => {
    const dbPath = getTempDbPath();
    assertThrowsRepoError(
      () => new SqliteAdvisoryResultOutboxRepository(` ${dbPath} `),
      'INVALID_DATABASE_PATH',
      'Invalid local advisory outbox database path.'
    );
  });

  // 9. valid file-backed database constructs
  await test('9. valid file-backed database constructs', () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();
    cleanupDb(dbPath);
  });

  // 10. schema creates exact table name
  await test('10. schema creates exact table name', () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    const db = new DatabaseSync(dbPath);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='peia_advisory_result_outbox'"
    ).all();
    db.close();
    cleanupDb(dbPath);

    assert(tables.length === 1, 'Table peia_advisory_result_outbox must exist');
  });

  // 11. schema has exactly required eight columns
  await test('11. schema has exactly required eight columns', () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    const db = new DatabaseSync(dbPath);
    const columns = db.prepare('PRAGMA table_info(peia_advisory_result_outbox)').all() as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    db.close();
    cleanupDb(dbPath);

    assert(columns.length === 14, `Expected exactly 14 columns, got ${columns.length}`);

    const expectedColumns = [
      'task_id',
      'task_type',
      'target_type',
      'target_id',
      'source_updated_at',
      'assessment_summary',
      'findings_json',
      'local_state',
      'schema_version',
      'human_review_required',
      'recommendations_json',
      'uncertainties_json',
      'limitations_json',
      'library_preparation_json',
    ];

    const actualNames = columns.map((c) => c.name).sort();
    const sortedExpected = [...expectedColumns].sort();
    assert(
      JSON.stringify(actualNames) === JSON.stringify(sortedExpected),
      `Columns mismatch: ${JSON.stringify(actualNames)}`
    );

    const baseColumns = [
      'task_id',
      'task_type',
      'target_type',
      'target_id',
      'source_updated_at',
      'assessment_summary',
      'findings_json',
      'local_state',
    ];
    for (const name of baseColumns) {
      const col = columns.find((c) => c.name === name)!;
      assert(col.type === 'TEXT', `Column ${col.name} must have type TEXT, got ${col.type}`);
      assert(col.notnull === 1, `Column ${col.name} must have notnull === 1, got ${col.notnull}`);
    }

    const libPrepCol = columns.find((c) => c.name === 'library_preparation_json')!;
    assert(libPrepCol !== undefined, 'library_preparation_json column must exist');
    assert(libPrepCol.type === 'TEXT', `library_preparation_json must have type TEXT, got ${libPrepCol.type}`);
    assert(libPrepCol.notnull === 0, `library_preparation_json must be nullable (notnull === 0), got ${libPrepCol.notnull}`);
  });

  // 12. schema primary key is task_id
  await test('12. schema primary key is task_id', () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    const db = new DatabaseSync(dbPath);
    const columns = db.prepare('PRAGMA table_info(peia_advisory_result_outbox)').all() as { name: string; pk: number }[];
    db.close();
    cleanupDb(dbPath);

    const taskIdCol = columns.find((c) => c.name === 'task_id');
    assert(taskIdCol !== undefined && taskIdCol.pk === 1, 'task_id must be primary key (pk === 1)');

    const nonPkCols = columns.filter((c) => c.name !== 'task_id');
    for (const col of nonPkCols) {
      assert(col.pk === 0, `Column ${col.name} must have pk === 0, got ${col.pk}`);
    }
  });

  // 13. schema contains no forbidden metadata columns
  await test('13. schema contains no forbidden metadata columns', () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    const db = new DatabaseSync(dbPath);
    const columns = db.prepare('PRAGMA table_info(peia_advisory_result_outbox)').all() as { name: string }[];
    db.close();
    cleanupDb(dbPath);

    const forbiddenCols = [
      'result_id',
      'principal_id',
      'generated_at',
      'created_at',
      'updated_at',
      'queued_at',
      'uploaded_at',
      'attempt_count',
      'retry_count',
      'last_error',
      'server_status',
      'provider_id',
      'execution_state',
      'content_snapshot',
    ];

    for (const f of forbiddenCols) {
      assert(!columns.some((c) => c.name === f), `Forbidden column found: ${f}`);
    }
  });

  // 14. valid record save succeeds
  await test('14. valid record save succeeds', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    repo.close();
    cleanupDb(dbPath);
  });

  // 15. findByTaskId returns saved record
  await test('15. findByTaskId returns saved record', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    const found = await repo.findByTaskId(record.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Saved record must be found');
    assert(found.result.task.taskId === record.result.task.taskId, 'taskId must match');
    assert(found.localState === LocalAdvisoryResultOutboxState.PendingUpload, 'localState must match');
  });

  // 16. reconstructed record passes canonical validation
  await test('16. reconstructed record passes canonical validation', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    const found = await repo.findByTaskId(record.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Record must be found');
    assert(found.result.assessment.findings.length === 3, 'Findings count must match');
  });

  // 17. findByTaskId returns structurally identical record
  await test('17. findByTaskId returns structurally identical record', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    const found = await repo.findByTaskId(record.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Record must be found');
    assert(isSameStoredAdvisoryResultRecord(record, found), 'Found record must be structurally identical');
  });

  // 18. findByTaskId missing returns null
  await test('18. findByTaskId missing returns null', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);

    const found = await repo.findByTaskId('non-existent-task-id');
    repo.close();
    cleanupDb(dbPath);

    assert(found === null, 'Missing task must return null');
  });

  // 19. invalid blank taskId -> DATABASE_READ_FAILED
  await test('19. invalid blank taskId -> DATABASE_READ_FAILED', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);

    await assertRejectsRepoError(
      () => repo.findByTaskId(''),
      'DATABASE_READ_FAILED',
      'Unable to read local advisory outbox database.'
    );
    repo.close();
    cleanupDb(dbPath);
  });

  // 20. invalid whitespace taskId -> DATABASE_READ_FAILED
  await test('20. invalid whitespace taskId -> DATABASE_READ_FAILED', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);

    await assertRejectsRepoError(
      () => repo.findByTaskId('   '),
      'DATABASE_READ_FAILED',
      'Unable to read local advisory outbox database.'
    );
    repo.close();
    cleanupDb(dbPath);
  });

  // 21. padded taskId -> DATABASE_READ_FAILED
  await test('21. padded taskId -> DATABASE_READ_FAILED', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);

    await assertRejectsRepoError(
      () => repo.findByTaskId(' task-123 '),
      'DATABASE_READ_FAILED',
      'Unable to read local advisory outbox database.'
    );
    repo.close();
    cleanupDb(dbPath);
  });

  // 22. saving same exact record twice is idempotent
  await test('22. saving same exact record twice is idempotent', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    await repo.save(record);

    const found = await repo.findByTaskId(record.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Record must be found');
  });

  // 23. saving separately constructed structurally identical record is idempotent
  await test('23. saving separately constructed structurally identical record is idempotent', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);

    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
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
        findings: [
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
        ],
      },
      recommendations: ['Update citations to 2026 standards.'],
      uncertainties: ['Preliminary rainfall metrics.'],
      limitations: ['Limited to public EPA data.'],
    });

    await repo.save(recordA);
    await repo.save(recordB);

    const found = await repo.findByTaskId('task-canonical-202');
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Record must be found');
  });

  // 24. idempotent save leaves exactly one DB row
  await test('24. idempotent save leaves exactly one DB row', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    await repo.save(record);
    repo.close();

    const db = new DatabaseSync(dbPath);
    const countRow = db.prepare('SELECT count(*) as count FROM peia_advisory_result_outbox').get() as { count: number };
    db.close();
    cleanupDb(dbPath);

    assert(countRow.count === 1, `Expected 1 row, got ${countRow.count}`);
  });

  // 25. same taskId + different summary -> RESULT_CONFLICT
  await test('25. same taskId + different summary -> RESULT_CONFLICT', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        summary: 'Different summary causing conflict.',
      },
    });

    await repo.save(recordA);
    await assertRejectsRepoError(
      () => repo.save(recordB),
      'RESULT_CONFLICT',
      'Conflicting local advisory result record.'
    );

    repo.close();
    cleanupDb(dbPath);
  });

  // 26. same taskId + different targetId -> RESULT_CONFLICT
  await test('26. same taskId + different targetId -> RESULT_CONFLICT', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          ...canonicalValidResult.task.target,
          targetId: 'different-target-999',
        },
      },
    });

    await repo.save(recordA);
    await assertRejectsRepoError(
      () => repo.save(recordB),
      'RESULT_CONFLICT',
      'Conflicting local advisory result record.'
    );

    repo.close();
    cleanupDb(dbPath);
  });

  // 27. same taskId + different finding content -> RESULT_CONFLICT
  await test('27. same taskId + different finding content -> RESULT_CONFLICT', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        findings: [
          {
            code: 'DIFFERENT_CODE',
            severity: AIReviewSeverity.Info,
            message: 'Different message',
            evidenceIds: ['EPA::diff-evidence-001'],
          },
        ],
      },
    });

    await repo.save(recordA);
    await assertRejectsRepoError(
      () => repo.save(recordB),
      'RESULT_CONFLICT',
      'Conflicting local advisory result record.'
    );

    repo.close();
    cleanupDb(dbPath);
  });

  // 28. conflict leaves original row unchanged
  await test('28. conflict leaves original row unchanged', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        summary: 'Conflicting summary.',
      },
    });

    await repo.save(recordA);
    await assertRejectsRepoError(
      () => repo.save(recordB),
      'RESULT_CONFLICT',
      'Conflicting local advisory result record.'
    );

    const found = await repo.findByTaskId(recordA.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Original record must exist');
    assert(found.result.assessment.summary === canonicalValidResult.assessment.summary, 'Summary must remain original');
  });

  // 29. save invalid record -> DATABASE_WRITE_FAILED
  await test('29. save invalid record -> DATABASE_WRITE_FAILED', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);

    const invalidRecord = {
      result: {
        ...canonicalValidResult,
        task: {
          ...canonicalValidResult.task,
          taskId: '',
        },
      },
      localState: LocalAdvisoryResultOutboxState.PendingUpload,
    } as unknown as StoredAdvisoryResultRecord;

    await assertRejectsRepoError(
      () => repo.save(invalidRecord),
      'DATABASE_WRITE_FAILED',
      'Unable to write local advisory outbox database.'
    );

    // Serialization failure test with non-enumerable custom toJSON on findings array
    const findingsWithBadToJson: PEIAAdvisoryFinding[] = [
      {
        code: 'METRIC_VERIFICATION_NEEDED',
        severity: AIReviewSeverity.Info,
        message: 'Rainfall metrics require human verification against official records.',
        evidenceIds: ['EPA::rain-metrics-2026'],
      },
    ];

    Object.defineProperty(findingsWithBadToJson, 'toJSON', {
      enumerable: false,
      value: () => {
        throw new Error('serialization failure');
      },
    });

    const hostileRecord = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskId: 'task-hostile-serialization',
      },
      assessment: {
        summary: 'Summary with serialization hostile findings.',
        findings: findingsWithBadToJson,
      },
    });

    await assertRejectsRepoError(
      () => repo.save(hostileRecord),
      'DATABASE_WRITE_FAILED',
      'Unable to write local advisory outbox database.'
    );

    repo.close();
    cleanupDb(dbPath);
  });

  // 30. save after close -> DATABASE_WRITE_FAILED
  await test('30. save after close -> DATABASE_WRITE_FAILED', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);
    repo.close();

    await assertRejectsRepoError(
      () => repo.save(record),
      'DATABASE_WRITE_FAILED',
      'Unable to write local advisory outbox database.'
    );

    cleanupDb(dbPath);
  });

  // 31. find after close -> DATABASE_READ_FAILED
  await test('31. find after close -> DATABASE_READ_FAILED', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    await assertRejectsRepoError(
      () => repo.findByTaskId('task-123'),
      'DATABASE_READ_FAILED',
      'Unable to read local advisory outbox database.'
    );

    cleanupDb(dbPath);
  });

  // 32. list after close -> DATABASE_READ_FAILED
  await test('32. list after close -> DATABASE_READ_FAILED', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    await assertRejectsRepoError(
      () => repo.listPendingUpload(),
      'DATABASE_READ_FAILED',
      'Unable to read local advisory outbox database.'
    );

    cleanupDb(dbPath);
  });

  // 33. close is idempotent
  await test('33. close is idempotent', () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();
    repo.close();
    repo.close();
    cleanupDb(dbPath);
  });

  // 34. listPendingUpload returns saved records
  await test('34. listPendingUpload returns saved records', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    const list = await repo.listPendingUpload();
    repo.close();
    cleanupDb(dbPath);

    assert(list.length === 1, `Expected 1 pending record, got ${list.length}`);
    assert(list[0].result.task.taskId === record.result.task.taskId, 'taskId must match');
  });

  // 35. listPendingUpload returns ONLY PendingUpload rows
  await test('35. listPendingUpload returns ONLY PendingUpload rows', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    repo.close();

    // Directly insert a non-canonical row with different local_state to test SQL filter
    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO peia_advisory_result_outbox (
        task_id, task_type, target_type, target_id, source_updated_at, assessment_summary, findings_json, local_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'task-other-state',
      'CONTENT_REVIEW',
      'News',
      'news-123',
      '2026-09-28T00:00:00.000Z',
      'Other state summary',
      JSON.stringify(canonicalFindings),
      'Uploaded'
    );
    db.close();

    const repo2 = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const list = await repo2.listPendingUpload();
    repo2.close();
    cleanupDb(dbPath);

    assert(list.length === 1, `Expected 1 PendingUpload record, got ${list.length}`);
    assert(list[0].result.task.taskId === 'task-canonical-202', 'Only PendingUpload row returned');
  });

  // 36. listPendingUpload ordered by task_id ASC
  await test('36. listPendingUpload ordered by task_id ASC', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);

    const recordC = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: { ...canonicalValidResult.task, taskId: 'task-c-300' },
    });
    const recordA = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: { ...canonicalValidResult.task, taskId: 'task-a-100' },
    });
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      task: { ...canonicalValidResult.task, taskId: 'task-b-200' },
    });

    await repo.save(recordC);
    await repo.save(recordA);
    await repo.save(recordB);

    const list = await repo.listPendingUpload();
    repo.close();
    cleanupDb(dbPath);

    assert(list.length === 3, 'Expected 3 records');
    assert(list[0].result.task.taskId === 'task-a-100', 'First must be task-a-100');
    assert(list[1].result.task.taskId === 'task-b-200', 'Second must be task-b-200');
    assert(list[2].result.task.taskId === 'task-c-300', 'Third must be task-c-300');
  });

  // 37. finding order survives SQLite round-trip
  await test('37. finding order survives SQLite round-trip', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    const found = await repo.findByTaskId(record.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Record must be found');
    assert(found.result.assessment.findings[0].code === canonicalFindings[0].code, 'Finding 0 code matches');
    assert(found.result.assessment.findings[1].code === canonicalFindings[1].code, 'Finding 1 code matches');
    assert(found.result.assessment.findings[2].code === canonicalFindings[2].code, 'Finding 2 code matches');
  });

  // 38. finding severity survives SQLite round-trip
  await test('38. finding severity survives SQLite round-trip', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord(canonicalValidResult);

    await repo.save(record);
    const found = await repo.findByTaskId(record.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Record must be found');
    assert(found.result.assessment.findings[0].severity === AIReviewSeverity.Info, 'Info severity matches');
    assert(found.result.assessment.findings[1].severity === AIReviewSeverity.Warning, 'Warning severity matches');
    assert(found.result.assessment.findings[2].severity === AIReviewSeverity.ReviewRecommended, 'ReviewRecommended severity matches');
  });

  // 39. empty summary + non-empty findings survives round-trip
  await test('39. empty summary + non-empty findings survives round-trip', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        summary: '',
        findings: canonicalFindings,
      },
    });

    await repo.save(record);
    const found = await repo.findByTaskId(record.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Record must be found');
    assert(found.result.assessment.summary === '', 'Summary must be empty');
    assert(found.result.assessment.findings.length === 3, 'Findings must have 3 items');
  });

  // 40. non-empty summary + empty findings survives round-trip
  await test('40. non-empty summary + empty findings survives round-trip', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const record = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        summary: 'Non-empty summary with empty findings array.',
        findings: [],
      },
    });

    await repo.save(record);
    const found = await repo.findByTaskId(record.result.task.taskId);
    repo.close();
    cleanupDb(dbPath);

    assert(found !== null, 'Record must be found');
    assert(found.result.assessment.summary === 'Non-empty summary with empty findings array.', 'Summary matches');
    assert(found.result.assessment.findings.length === 0, 'Findings must be empty');
  });

  // 41. corrupt findings_json -> CORRUPT_STORED_RECORD
  await test('41. corrupt findings_json -> CORRUPT_STORED_RECORD', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO peia_advisory_result_outbox (
        task_id, task_type, target_type, target_id, source_updated_at, assessment_summary, findings_json, local_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'task-corrupt-json',
      'CONTENT_REVIEW',
      'News',
      'news-1',
      '2026-09-28T00:00:00.000Z',
      'Summary',
      'invalid-json-findings',
      'PendingUpload'
    );
    db.close();

    const repo2 = new SqliteAdvisoryResultOutboxRepository(dbPath);
    await assertRejectsRepoError(
      () => repo2.findByTaskId('task-corrupt-json'),
      'CORRUPT_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );

    await assertRejectsRepoError(
      () => repo2.listPendingUpload(),
      'CORRUPT_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );

    repo2.close();
    cleanupDb(dbPath);
  });

  // 42. corrupt canonical row field -> CORRUPT_STORED_RECORD
  await test('42. corrupt canonical row field -> CORRUPT_STORED_RECORD', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO peia_advisory_result_outbox (
        task_id, task_type, target_type, target_id, source_updated_at, assessment_summary, findings_json, local_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'task-corrupt-type',
      'INVALID_TASK_TYPE',
      'News',
      'news-1',
      '2026-09-28T00:00:00.000Z',
      'Summary',
      JSON.stringify(canonicalFindings),
      'PendingUpload'
    );
    db.close();

    const repo2 = new SqliteAdvisoryResultOutboxRepository(dbPath);
    await assertRejectsRepoError(
      () => repo2.findByTaskId('task-corrupt-type'),
      'CORRUPT_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );

    repo2.close();
    cleanupDb(dbPath);
  });

  // 43. corrupt existing row during save -> CORRUPT_STORED_RECORD
  await test('43. corrupt existing row during save -> CORRUPT_STORED_RECORD', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO peia_advisory_result_outbox (
        task_id, task_type, target_type, target_id, source_updated_at, assessment_summary, findings_json, local_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'task-canonical-202',
      'CONTENT_REVIEW',
      'News',
      'news-1',
      '2026-09-28T00:00:00.000Z',
      'Summary',
      '{corrupt-json',
      'PendingUpload'
    );
    db.close();

    const repo2 = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const validRecord = createStoredAdvisoryResultRecord(canonicalValidResult);

    await assertRejectsRepoError(
      () => repo2.save(validRecord),
      'CORRUPT_STORED_RECORD',
      'Stored advisory result record is invalid.'
    );

    repo2.close();
    cleanupDb(dbPath);
  });

  // 44. save does not overwrite conflicting existing row
  await test('44. save does not overwrite conflicting existing row', async () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    const recordA = createStoredAdvisoryResultRecord(canonicalValidResult);
    const recordB = createStoredAdvisoryResultRecord({
      ...canonicalValidResult,
      assessment: {
        ...canonicalValidResult.assessment,
        summary: 'Conflicting summary attempt',
      },
    });

    await repo.save(recordA);
    await assertRejectsRepoError(
      () => repo.save(recordB),
      'RESULT_CONFLICT',
      'Conflicting local advisory result record.'
    );

    const db = new DatabaseSync(dbPath);
    const row = db.prepare('SELECT assessment_summary FROM peia_advisory_result_outbox WHERE task_id = ?').get('task-canonical-202') as { assessment_summary: string };
    db.close();
    repo.close();
    cleanupDb(dbPath);

    assert(row.assessment_summary === canonicalValidResult.assessment.summary, 'Existing summary must not be overwritten');
  });

  // 45. production source contains no UPDATE/REPLACE/UPSERT/DELETE mutation path
  await test('45. production source contains no UPDATE/REPLACE/UPSERT/DELETE mutation path', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqliteAdvisoryResultOutboxRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    // Remove single-line comments and multi-line comments
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

    const forbiddenSql = ['UPDATE ', 'REPLACE ', 'UPSERT ', 'DELETE '];
    for (const sql of forbiddenSql) {
      assert(!codeOnly.toUpperCase().includes(sql), `Forbidden SQL mutation path found: ${sql}`);
    }
  });

  // 46. production source contains no network/upload/retry/authority/generated metadata
  await test('46. production source contains no network/upload/retry/authority/generated metadata', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqliteAdvisoryResultOutboxRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'fetch(',
      'globalThis.fetch',
      'Authorization',
      'Bearer',
      'credential',
      'endpointUrl',
      'markUploaded',
      'markFailed',
      'retry',
      'backoff',
      'poll',
      'claim',
      'lease',
      'updateState',
      'acknowledge',
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
      assert(!source.includes(f), `Forbidden token "${f}" found in production source`);
    }
  });

  // 47. source proves narrow serialization + canonical contract reuse + task_id physical-key boundary
  await test('47. source proves narrow serialization + canonical contract reuse + task_id physical-key boundary', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqliteAdvisoryResultOutboxRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes("from './localAdvisoryResultOutboxContract'"), 'Must import from localAdvisoryResultOutboxContract');
    assert(source.includes('LocalAdvisoryResultOutboxRepository'), 'Must import LocalAdvisoryResultOutboxRepository');
    assert(source.includes('StoredAdvisoryResultRecord'), 'Must import StoredAdvisoryResultRecord');
    assert(source.includes('validateStoredAdvisoryResultRecord'), 'Must import validateStoredAdvisoryResultRecord');
    assert(source.includes('isSameStoredAdvisoryResultRecord'), 'Must import isSameStoredAdvisoryResultRecord');
    assert(source.includes('LocalAdvisoryResultOutboxState'), 'Must import LocalAdvisoryResultOutboxState');

    // Structurally verify try/catch surrounding findings serialization in save(...)
    const serializationBlockRegex =
      /try\s*\{[\s\S]*?findingsJson\s*=\s*JSON\.stringify\(record\.result\.assessment\.findings\);[\s\S]*?\}\s*catch\s*\{\s*throw\s+new\s+SqliteAdvisoryResultOutboxRepositoryError\(\s*'DATABASE_WRITE_FAILED'\s*\);?\s*\}/;
    assert(
      serializationBlockRegex.test(source),
      'Must contain try/catch surrounding findings serialization throwing DATABASE_WRITE_FAILED'
    );

    assert(!source.includes('JSON.stringify(record)'), 'Must not stringify whole record');
    assert(!source.includes('JSON.stringify(record.result)'), 'Must not stringify whole result');

    // Physical key mapping
    assert(source.includes('taskId: row.task_id'), 'Must map task_id to taskId in reconstructed result');
  });

  // 48. final self-contained source invariant + exact test-count gate
  await test('48. final self-contained source invariant + exact test-count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqliteAdvisoryResultOutboxRepository.ts');
    const source = readFileSync(filePath, 'utf8');

    // A. REQUIRED SYMBOLS
    const requiredSymbols = [
      'SqliteAdvisoryResultOutboxRepository',
      'SqliteAdvisoryResultOutboxRepositoryError',
      'SqliteAdvisoryResultOutboxRepositoryErrorCode',
      'AdvisoryResultOutboxRow',
    ];
    for (const sym of requiredSymbols) {
      assert(source.includes(sym), `Required symbol "${sym}" missing from source`);
    }

    // B. EXACT ERROR CONTRACT
    const typeMatch = source.match(
      /export\s+type\s+SqliteAdvisoryResultOutboxRepositoryErrorCode\s*=\s*([^;]+);/
    );
    assert(typeMatch !== null, 'Must declare SqliteAdvisoryResultOutboxRepositoryErrorCode');
    const codes = typeMatch![1]
      .split('|')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s.length > 0);

    const expectedCodes: SqliteAdvisoryResultOutboxRepositoryErrorCode[] = [
      'INVALID_DATABASE_PATH',
      'DATABASE_OPEN_FAILED',
      'DATABASE_SCHEMA_FAILED',
      'DATABASE_READ_FAILED',
      'DATABASE_WRITE_FAILED',
      'RESULT_CONFLICT',
      'CORRUPT_STORED_RECORD',
    ];
    assert(codes.length === 7, `Expected exactly 7 error codes, got ${codes.length}`);
    for (const exp of expectedCodes) {
      assert(codes.includes(exp), `Missing error code: ${exp}`);
    }

    const mappings: Record<SqliteAdvisoryResultOutboxRepositoryErrorCode, string> = {
      INVALID_DATABASE_PATH: 'Invalid local advisory outbox database path.',
      DATABASE_OPEN_FAILED: 'Unable to open local advisory outbox database.',
      DATABASE_SCHEMA_FAILED: 'Unable to initialize local advisory outbox database.',
      DATABASE_READ_FAILED: 'Unable to read local advisory outbox database.',
      DATABASE_WRITE_FAILED: 'Unable to write local advisory outbox database.',
      RESULT_CONFLICT: 'Conflicting local advisory result record.',
      CORRUPT_STORED_RECORD: 'Stored advisory result record is invalid.',
    };
    for (const code of expectedCodes) {
      const err = new SqliteAdvisoryResultOutboxRepositoryError(code);
      assert(err.code === code, `Code mismatch for ${code}`);
      assert(err.message === mappings[code], `Message mismatch for ${code}`);
    }

    const constructorMatch = source.match(/constructor\s*\(([^)]*)\)/);
    assert(constructorMatch !== null, 'Must find constructor definition');
    const constructorParams = constructorMatch![1].trim();
    assert(
      constructorParams === 'code: SqliteAdvisoryResultOutboxRepositoryErrorCode',
      `Constructor must accept ONLY code, got: "${constructorParams}"`
    );
    assert(!constructorParams.includes('message'), 'Constructor must not accept message parameter');

    // C. EXACT TABLE CONTRACT
    assert(source.includes('peia_advisory_result_outbox'), 'Must declare exact table name');
    const tableCreateMatch = source.match(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+peia_advisory_result_outbox\s*\(([^;]+)\);/
    );
    assert(tableCreateMatch !== null, 'Must match CREATE TABLE definition');
    const tableColumns = tableCreateMatch![1]
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    assert(tableColumns.length === 8, `Expected exactly 8 SQL column declarations, got ${tableColumns.length}`);
    assert(tableColumns[0] === 'task_id TEXT PRIMARY KEY NOT NULL', `Col 0: "${tableColumns[0]}"`);
    assert(tableColumns[1] === 'task_type TEXT NOT NULL', `Col 1: "${tableColumns[1]}"`);
    assert(tableColumns[2] === 'target_type TEXT NOT NULL', `Col 2: "${tableColumns[2]}"`);
    assert(tableColumns[3] === 'target_id TEXT NOT NULL', `Col 3: "${tableColumns[3]}"`);
    assert(tableColumns[4] === 'source_updated_at TEXT NOT NULL', `Col 4: "${tableColumns[4]}"`);
    assert(tableColumns[5] === 'assessment_summary TEXT NOT NULL', `Col 5: "${tableColumns[5]}"`);
    assert(tableColumns[6] === 'findings_json TEXT NOT NULL', `Col 6: "${tableColumns[6]}"`);
    assert(tableColumns[7] === 'local_state TEXT NOT NULL', `Col 7: "${tableColumns[7]}"`);

    // D. REQUIRED QUERY SEMANTICS
    assert(source.includes('WHERE local_state = ?'), 'Must query with WHERE local_state = ?');
    assert(source.includes('ORDER BY task_id ASC'), 'Must order by ORDER BY task_id ASC');
    assert(source.includes('LocalAdvisoryResultOutboxState.PendingUpload'), 'Must filter by PendingUpload state');

    // E. WRITE SAFETY
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const forbiddenSql = ['UPDATE ', 'REPLACE ', 'UPSERT ', 'DELETE '];
    for (const sql of forbiddenSql) {
      assert(!codeOnly.toUpperCase().includes(sql), `Forbidden SQL mutation path found: ${sql}`);
    }

    // F. NARROW SERIALIZATION
    const serializationBlockRegex =
      /try\s*\{[\s\S]*?findingsJson\s*=\s*JSON\.stringify\(record\.result\.assessment\.findings\);[\s\S]*?\}\s*catch\s*\{\s*throw\s+new\s+SqliteAdvisoryResultOutboxRepositoryError\(\s*'DATABASE_WRITE_FAILED'\s*\);?\s*\}/;
    assert(serializationBlockRegex.test(source), 'Must contain try/catch serialization block');
    assert(!source.includes('JSON.stringify(record)'), 'Must not stringify whole record');
    assert(!source.includes('JSON.stringify(record.result)'), 'Must not stringify whole result');

    // G. ARCHITECTURE BOUNDARY
    const forbidden = [
      'fetch(',
      'globalThis.fetch',
      'Authorization',
      'Bearer',
      'credential',
      'endpointUrl',
      'markUploaded',
      'markFailed',
      'retry',
      'backoff',
      'poll',
      'claim',
      'lease',
      'updateState',
      'acknowledge',
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
      assert(!source.includes(f), `Forbidden token "${f}" found in production source`);
    }

    // H. PHYSICAL KEY BOUNDARY
    assert(source.includes('taskId: row.task_id'), 'Must map task_id to taskId during row reconstruction');

    // I. FINAL COUNT
    assert(totalTests === 48, `Expected exactly 48 tests, found ${totalTests}`);
    assert(passedTests === 47, `Expected 47 prior tests to have passed, got ${passedTests}`);
  });

  // ==========================================
  // SUBUNIT-2: LIBRARY PREPARATION SQLITE OUTBOX PERSISTENCE & MIGRATION TESTS (49 - 60)
  // ==========================================

  function makeCanonicalLibraryPreparation(
    inputBasis: 'MetadataOnly' | 'SuppliedExcerptAndMetadata'
  ) {
    return {
      inputBasis,
      suggestedTitleAr: 'اللائحة التنفيذية لحماية البيئة البحرية ٢٠٢٦',
      suggestedTitleEn: 'Executive Regulation for Marine Environmental Protection 2026',
      suggestedIssuingOrganization: 'Ministry of Environment',
      suggestedDocumentType: 'ExecutiveRegulation' as const,
      suggestedEnvironmentalDomains: ['Marine Biodiversity', 'Coastal Water Quality'],
      suggestedTopicsAr: ['التنوع البيولوجي البحري', 'جودة المياه الساحلية'],
      suggestedTopicsEn: ['Marine Biodiversity', 'Coastal Water Quality'],
      suggestedSummaryAr:
        inputBasis === 'MetadataOnly'
          ? null
          : 'ملخص مستند إلى المقتطف المقدم يوضح ضوابط تصريف المياه في المناطق الساحلية.',
      suggestedSummaryEn:
        inputBasis === 'MetadataOnly'
          ? null
          : 'Excerpt-grounded summary detailing coastal zone discharge controls.',
      provenanceObservationsAr: [
        'البيانات مستمدة من بيانات الإدخال الوصفية ومعايير وكالة حماية البيئة.',
      ],
      provenanceObservationsEn: [
        'Prepared from supplied intake metadata corroborated by EPA water quality standards.',
      ],
      uncertaintyNoticesAr: ['لم يتم الاطلاع على النص الكامل لملف PDF الخارجي.'],
      uncertaintyNoticesEn: ['Full external PDF document text was not inspected.'],
    };
  }

  function makeCanonicalLibraryIntakeResult(
    taskId: string,
    inputBasis: 'MetadataOnly' | 'SuppliedExcerptAndMetadata'
  ): PEIAAdvisoryResult {
    return {
      schemaVersion: 1,
      task: {
        taskId,
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: AIReviewTargetType.LibraryIntake,
          targetId: `intake-${taskId}`,
          sourceUpdatedAt: '2026-10-06T12:00:00.000Z',
        },
      },
      humanReviewRequired: true,
      assessment: {
        summary: 'Prepared bibliographic proposal from supplied intake snapshot and EPA reference.',
        findings: canonicalFindings,
      },
      recommendations: ['Verify official gazette issue number before canonical registration.'],
      uncertainties: ['Full external PDF text was not read.'],
      limitations: ['Bounded local context window.'],
      libraryPreparation: makeCanonicalLibraryPreparation(inputBasis),
    };
  }

  // 49. Clean database creation initializes 14-column schema with nullable library_preparation_json TEXT column
  await test('49. Clean database creation initializes 14-column schema with nullable library_preparation_json TEXT column', () => {
    const dbPath = getTempDbPath();
    const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
    repo.close();

    const db = new DatabaseSync(dbPath);
    const columns = db.prepare('PRAGMA table_info(peia_advisory_result_outbox)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    db.close();
    cleanupDb(dbPath);

    assert(columns.length === 14, `Expected 14 columns on clean DB, got ${columns.length}`);
    const libCol = columns.find((c) => c.name === 'library_preparation_json');
    assert(libCol !== undefined, 'library_preparation_json must exist on clean DB');
    assert(libCol!.type === 'TEXT', 'library_preparation_json type must be TEXT');
    assert(libCol!.notnull === 0, 'library_preparation_json must be nullable');
  });

  // 50. Safe non-destructive migration from an actual legacy 13-column SQLite table containing News advisory records
  await test('50. Safe non-destructive migration from an actual legacy 13-column SQLite table containing News advisory records', async () => {
    const dbPath = getTempDbPath();
    try {
      // Create actual legacy 13-column table and insert two News advisory records
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE TABLE peia_advisory_result_outbox (
          task_id TEXT PRIMARY KEY NOT NULL,
          task_type TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          source_updated_at TEXT NOT NULL,
          assessment_summary TEXT NOT NULL,
          findings_json TEXT NOT NULL,
          local_state TEXT NOT NULL,
          schema_version INTEGER,
          human_review_required INTEGER,
          recommendations_json TEXT,
          uncertainties_json TEXT,
          limitations_json TEXT
        );
      `);

      const preMigrationCols = legacyDb.prepare('PRAGMA table_info(peia_advisory_result_outbox)').all() as Array<{ name: string }>;
      assert(preMigrationCols.length === 13, 'Legacy table must start with exactly 13 columns');

      const insertLegacy = legacyDb.prepare(`
        INSERT INTO peia_advisory_result_outbox (
          task_id, task_type, target_type, target_id, source_updated_at,
          assessment_summary, findings_json, local_state, schema_version,
          human_review_required, recommendations_json, uncertainties_json, limitations_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertLegacy.run(
        'task-legacy-news-1',
        'CONTENT_REVIEW',
        'News',
        'news-legacy-101',
        '2026-09-20T00:00:00.000Z',
        'Legacy News summary 1.',
        JSON.stringify(canonicalFindings),
        'PendingUpload',
        1,
        1,
        JSON.stringify(['Legacy recommendation 1']),
        JSON.stringify(['Legacy uncertainty 1']),
        JSON.stringify(['Legacy limitation 1'])
      );

      insertLegacy.run(
        'task-legacy-news-2',
        'CONTENT_REVIEW',
        'News',
        'news-legacy-102',
        '2026-09-21T00:00:00.000Z',
        'Legacy News summary 2.',
        JSON.stringify(canonicalFindings),
        'PendingUpload',
        1,
        1,
        JSON.stringify(['Legacy recommendation 2']),
        JSON.stringify(['Legacy uncertainty 2']),
        JSON.stringify(['Legacy limitation 2'])
      );
      legacyDb.close();

      // Open with SqliteAdvisoryResultOutboxRepository to trigger migration
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const pending = await repo.listPendingUpload();
      assert(pending.length === 2, `Expected both legacy rows preserved, got ${pending.length}`);
      assert(pending[0].result.task.taskId === 'task-legacy-news-1', 'Legacy row 1 taskId intact');
      assert(pending[0].result.assessment.summary === 'Legacy News summary 1.', 'Legacy row 1 summary intact');
      assert(!('libraryPreparation' in pending[0].result), 'Legacy row 1 must not have libraryPreparation property');
      assert(pending[1].result.task.taskId === 'task-legacy-news-2', 'Legacy row 2 taskId intact');
      assert(pending[1].result.assessment.summary === 'Legacy News summary 2.', 'Legacy row 2 summary intact');
      assert(!('libraryPreparation' in pending[1].result), 'Legacy row 2 must not have libraryPreparation property');
      repo.close();

      const verifyDb = new DatabaseSync(dbPath);
      const postMigrationCols = verifyDb.prepare('PRAGMA table_info(peia_advisory_result_outbox)').all() as Array<{ name: string }>;
      assert(postMigrationCols.length === 14, 'Migrated table must have 14 columns');
      assert(postMigrationCols.some((c) => c.name === 'library_preparation_json'), 'Migrated table includes library_preparation_json');
      verifyDb.close();
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 51. Second initialization is idempotent and preserves existing News and LibraryIntake records
  await test('51. Second initialization is idempotent and preserves existing News and LibraryIntake records', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo1 = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const newsRec = createStoredAdvisoryResultRecord(canonicalValidResult);
      const libRec = createStoredAdvisoryResultRecord(makeCanonicalLibraryIntakeResult('task-lib-51', 'MetadataOnly'));
      await repo1.save(newsRec);
      await repo1.save(libRec);
      repo1.close();

      // Second initialization on same database file
      const repo2 = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const foundNews = await repo2.findByTaskId(canonicalValidResult.task.taskId);
      const foundLib = await repo2.findByTaskId('task-lib-51');
      repo2.close();

      assert(foundNews !== null && isSameStoredAdvisoryResultRecord(newsRec, foundNews), 'News record preserved across re-init');
      assert(foundLib !== null && isSameStoredAdvisoryResultRecord(libRec, foundLib), 'LibraryIntake record preserved across re-init');
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 52. Legacy News advisory round-trip stores NULL in library_preparation_json and reconstructs without libraryPreparation key
  await test('52. Legacy News advisory round-trip stores NULL in library_preparation_json and reconstructs without libraryPreparation key', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const record = createStoredAdvisoryResultRecord(canonicalValidResult);
      await repo.save(record);

      const found = await repo.findByTaskId(canonicalValidResult.task.taskId);
      repo.close();

      assert(found !== null, 'News record found');
      assert(found!.result.libraryPreparation === undefined, 'libraryPreparation is undefined');
      assert(!('libraryPreparation' in found!.result), 'libraryPreparation key is absent on News result');

      const db = new DatabaseSync(dbPath);
      const rawRow = db
        .prepare('SELECT library_preparation_json FROM peia_advisory_result_outbox WHERE task_id = ?')
        .get(canonicalValidResult.task.taskId) as { library_preparation_json: string | null };
      db.close();
      assert(rawRow.library_preparation_json === null, 'SQLite column library_preparation_json must be NULL for News');
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 53. LibraryIntake MetadataOnly round-trip preserves all 14 canonical fields with both summaries null
  await test('53. LibraryIntake MetadataOnly round-trip preserves all 14 canonical fields with both summaries null', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const libResult = makeCanonicalLibraryIntakeResult('task-lib-meta-53', 'MetadataOnly');
      const record = createStoredAdvisoryResultRecord(libResult);
      await repo.save(record);

      const found = await repo.findByTaskId('task-lib-meta-53');
      repo.close();

      assert(found !== null, 'LibraryIntake MetadataOnly record found');
      assert(isSameStoredAdvisoryResultRecord(record, found!), 'Reconstructed record matches saved record');
      const prep = found!.result.libraryPreparation!;
      assert(prep !== undefined, 'libraryPreparation present');

      const expectedKeys = [
        'inputBasis',
        'suggestedTitleAr',
        'suggestedTitleEn',
        'suggestedIssuingOrganization',
        'suggestedDocumentType',
        'suggestedEnvironmentalDomains',
        'suggestedTopicsAr',
        'suggestedTopicsEn',
        'suggestedSummaryAr',
        'suggestedSummaryEn',
        'provenanceObservationsAr',
        'provenanceObservationsEn',
        'uncertaintyNoticesAr',
        'uncertaintyNoticesEn',
      ];
      assert(
        JSON.stringify(Object.keys(prep)) === JSON.stringify(expectedKeys),
        'Reconstructed libraryPreparation has exact 14 canonical keys in canonical order'
      );
      assert(prep.inputBasis === 'MetadataOnly', 'inputBasis is MetadataOnly');
      assert(prep.suggestedSummaryAr === null, 'suggestedSummaryAr is null');
      assert(prep.suggestedSummaryEn === null, 'suggestedSummaryEn is null');
      assert(prep.suggestedDocumentType === 'ExecutiveRegulation', 'suggestedDocumentType preserved');
      assert(prep.suggestedEnvironmentalDomains.length === 2, 'suggestedEnvironmentalDomains array preserved');
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 54. LibraryIntake SuppliedExcerptAndMetadata round-trip preserves all 14 canonical fields including bilingual summaries
  await test('54. LibraryIntake SuppliedExcerptAndMetadata round-trip preserves all 14 canonical fields including bilingual summaries', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const libResult = makeCanonicalLibraryIntakeResult('task-lib-excerpt-54', 'SuppliedExcerptAndMetadata');
      const record = createStoredAdvisoryResultRecord(libResult);
      await repo.save(record);

      const found = await repo.findByTaskId('task-lib-excerpt-54');
      repo.close();

      assert(found !== null, 'LibraryIntake SuppliedExcerptAndMetadata record found');
      assert(isSameStoredAdvisoryResultRecord(record, found!), 'Reconstructed record matches saved record');
      const prep = found!.result.libraryPreparation!;
      assert(prep.inputBasis === 'SuppliedExcerptAndMetadata', 'inputBasis is SuppliedExcerptAndMetadata');
      assert(
        prep.suggestedSummaryAr ===
          'ملخص مستند إلى المقتطف المقدم يوضح ضوابط تصريف المياه في المناطق الساحلية.',
        'suggestedSummaryAr preserved verbatim'
      );
      assert(
        prep.suggestedSummaryEn ===
          'Excerpt-grounded summary detailing coastal zone discharge controls.',
        'suggestedSummaryEn preserved verbatim'
      );
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 55. listPendingUpload returns full News and LibraryIntake results with libraryPreparation intact
  await test('55. listPendingUpload returns full News and LibraryIntake results with libraryPreparation intact', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const newsRec = createStoredAdvisoryResultRecord({
        ...canonicalValidResult,
        task: { ...canonicalValidResult.task, taskId: 'task-pending-01-news' },
      });
      const libMetaRec = createStoredAdvisoryResultRecord(
        makeCanonicalLibraryIntakeResult('task-pending-02-lib-meta', 'MetadataOnly')
      );
      const libExcerptRec = createStoredAdvisoryResultRecord(
        makeCanonicalLibraryIntakeResult('task-pending-03-lib-excerpt', 'SuppliedExcerptAndMetadata')
      );

      await repo.save(libExcerptRec);
      await repo.save(newsRec);
      await repo.save(libMetaRec);

      const pending = await repo.listPendingUpload();
      repo.close();

      assert(pending.length === 3, 'All 3 pending records returned');
      assert(!('libraryPreparation' in pending[0].result), 'First (News) has no libraryPreparation');
      assert(pending[1].result.libraryPreparation?.inputBasis === 'MetadataOnly', 'Second has MetadataOnly libraryPreparation');
      assert(pending[1].result.libraryPreparation?.suggestedSummaryAr === null, 'Second preserves null summary');
      assert(
        pending[2].result.libraryPreparation?.inputBasis === 'SuppliedExcerptAndMetadata',
        'Third has SuppliedExcerptAndMetadata libraryPreparation'
      );
      assert(
        typeof pending[2].result.libraryPreparation?.suggestedSummaryEn === 'string',
        'Third preserves English summary'
      );
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 56. Identical LibraryIntake replay is accepted idempotently
  await test('56. Identical LibraryIntake replay is accepted idempotently', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const recordA = createStoredAdvisoryResultRecord(
        makeCanonicalLibraryIntakeResult('task-lib-replay-56', 'SuppliedExcerptAndMetadata')
      );
      const recordB = createStoredAdvisoryResultRecord(
        makeCanonicalLibraryIntakeResult('task-lib-replay-56', 'SuppliedExcerptAndMetadata')
      );

      await repo.save(recordA);
      await repo.save(recordB);

      const list = await repo.listPendingUpload();
      repo.close();
      assert(list.length === 1, 'Exactly 1 row stored after identical LibraryIntake replay');
      assert(isSameStoredAdvisoryResultRecord(recordA, list[0]), 'Stored record remains identical');
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 57. Divergent libraryPreparation replay for same taskId fails with RESULT_CONFLICT and preserves original row
  await test('57. Divergent libraryPreparation replay for same taskId fails with RESULT_CONFLICT and preserves original row', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const baseLibResult = makeCanonicalLibraryIntakeResult('task-lib-conflict-57', 'MetadataOnly');
      const recordA = createStoredAdvisoryResultRecord(baseLibResult);

      const divergentLibResult: PEIAAdvisoryResult = {
        ...baseLibResult,
        libraryPreparation: {
          ...baseLibResult.libraryPreparation!,
          suggestedDocumentType: 'Law',
        },
      };
      const recordB = createStoredAdvisoryResultRecord(divergentLibResult);

      await repo.save(recordA);
      await assertRejectsRepoError(
        () => repo.save(recordB),
        'RESULT_CONFLICT',
        'Conflicting local advisory result record.'
      );

      const found = await repo.findByTaskId('task-lib-conflict-57');
      repo.close();
      assert(
        found?.result.libraryPreparation?.suggestedDocumentType === 'ExecutiveRegulation',
        'Original libraryPreparation must remain untouched after conflict'
      );
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 58. Invalid JSON, non-object JSON, missing/extra keys, or schema-incompatible library_preparation_json rejected with CORRUPT_STORED_RECORD
  await test('58. Invalid JSON, non-object JSON, missing/extra keys, or schema-incompatible library_preparation_json rejected with CORRUPT_STORED_RECORD', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      repo.close();

      const validPrep = makeCanonicalLibraryPreparation('MetadataOnly');
      const extraKeyPrep = { ...validPrep, analysisBasis: 'MetadataOnly' };
      const missingKeyPrep: Record<string, unknown> = { ...validPrep };
      delete missingKeyPrep['uncertaintyNoticesEn'];
      const badSummaryMetaPrep = { ...validPrep, suggestedSummaryEn: 'Non-null summary on MetadataOnly' };

      const db = new DatabaseSync(dbPath);
      const insertRaw = db.prepare(`
        INSERT INTO peia_advisory_result_outbox (
          task_id, task_type, target_type, target_id, source_updated_at,
          assessment_summary, findings_json, local_state, schema_version,
          human_review_required, recommendations_json, uncertainties_json,
          limitations_json, library_preparation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const corruptCases: Array<{ taskId: string; targetType: string; libPrepJson: string | null }> = [
        { taskId: 'corrupt-lib-1-syntax', targetType: 'LibraryIntake', libPrepJson: '{not-valid-json' },
        { taskId: 'corrupt-lib-2-array', targetType: 'LibraryIntake', libPrepJson: '[]' },
        { taskId: 'corrupt-lib-3-primitive', targetType: 'LibraryIntake', libPrepJson: '"string-value"' },
        { taskId: 'corrupt-lib-4-empty', targetType: 'LibraryIntake', libPrepJson: '   ' },
        { taskId: 'corrupt-lib-5-null-on-intake', targetType: 'LibraryIntake', libPrepJson: null },
        { taskId: 'corrupt-lib-6-extra-key', targetType: 'LibraryIntake', libPrepJson: JSON.stringify(extraKeyPrep) },
        { taskId: 'corrupt-lib-7-missing-key', targetType: 'LibraryIntake', libPrepJson: JSON.stringify(missingKeyPrep) },
        { taskId: 'corrupt-lib-8-bad-summary', targetType: 'LibraryIntake', libPrepJson: JSON.stringify(badSummaryMetaPrep) },
        { taskId: 'corrupt-lib-9-prep-on-news', targetType: 'News', libPrepJson: JSON.stringify(validPrep) },
      ];

      for (const c of corruptCases) {
        insertRaw.run(
          c.taskId,
          'CONTENT_REVIEW',
          c.targetType,
          'target-1',
          '2026-10-06T00:00:00.000Z',
          'Summary.',
          JSON.stringify(canonicalFindings),
          'PendingUpload',
          1,
          1,
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          c.libPrepJson
        );
      }
      db.close();

      const repo2 = new SqliteAdvisoryResultOutboxRepository(dbPath);
      for (const c of corruptCases) {
        await assertRejectsRepoError(
          () => repo2.findByTaskId(c.taskId),
          'CORRUPT_STORED_RECORD',
          'Stored advisory result record is invalid.'
        );
      }
      await assertRejectsRepoError(
        () => repo2.listPendingUpload(),
        'CORRUPT_STORED_RECORD',
        'Stored advisory result record is invalid.'
      );
      repo2.close();
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 59. save rejects LibraryIntake record missing libraryPreparation with DATABASE_WRITE_FAILED
  await test('59. save rejects LibraryIntake record missing libraryPreparation with DATABASE_WRITE_FAILED', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const libMissingPrep: StoredAdvisoryResultRecord = {
        result: {
          ...canonicalValidResult,
          task: {
            taskId: 'task-lib-missing-prep-59',
            taskType: AITaskType.CONTENT_REVIEW,
            target: {
              targetType: AIReviewTargetType.LibraryIntake,
              targetId: 'intake-59',
              sourceUpdatedAt: '2026-10-06T00:00:00.000Z',
            },
          },
        },
        localState: LocalAdvisoryResultOutboxState.PendingUpload,
      };

      await assertRejectsRepoError(
        () => repo.save(libMissingPrep),
        'DATABASE_WRITE_FAILED',
        'Unable to write local advisory outbox database.'
      );
      repo.close();
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 60. Production source contains no destructive schema operations (DROP, TRUNCATE, RENAME)
  await test('60. Production source contains no destructive schema operations (DROP, TRUNCATE, RENAME)', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/sqliteAdvisoryResultOutboxRepository.ts');
    const source = readFileSync(filePath, 'utf8');
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').toUpperCase();

    const destructiveTokens = ['DROP TABLE', 'DROP COLUMN', 'TRUNCATE', 'RENAME TABLE', 'DELETE FROM'];
    for (const token of destructiveTokens) {
      assert(!codeOnly.includes(token), `Destructive SQL operation prohibited: ${token}`);
    }
  });

  // Final count gate
  assert(totalTests === 60, `Expected exactly 60 tests, found ${totalTests}`);
  assert(passedTests === 60, `Expected exactly 60 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
