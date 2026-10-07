import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  SqliteTaskProcessingLifecycleRepository,
  SqliteTaskProcessingLifecycleRepositoryError,
} from '../peia-worker/src/sqliteTaskProcessingLifecycleRepository';
import {
  TaskProcessingState,
  TaskProcessingTerminalOutcome,
  PEIA_MAX_MODEL_ATTEMPTS,
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

const TEST_DB_PATH = join(process.cwd(), 'peia_test_task_processing.sqlite');

function cleanupDb() {
  if (existsSync(TEST_DB_PATH)) {
    try {
      unlinkSync(TEST_DB_PATH);
    } catch {
      // ignore
    }
  }
}

(async () => {
  console.log('--- RUNNING PEIA SQLITE TASK PROCESSING LIFECYCLE REPOSITORY TESTS ---');
  cleanupDb();

  try {
    // 1. Table creation on init
    await test('1. initializes repository and creates peia_task_processing table', () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      repo.close();
      assert(existsSync(TEST_DB_PATH), 'DB file must exist');
    });

    // 2. Insert initial READY record
    await test('2. creates initial READY record with modelAttempts 0', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        const record = await repo.createInitialRecord('task-1');
        assert(record.taskId === 'task-1', 'TaskId mismatch');
        assert(record.state === TaskProcessingState.READY, 'State must be READY');
        assert(record.modelAttempts === 0, 'modelAttempts must be 0');
        assert(record.terminalOutcome === null, 'terminalOutcome must be null');

        const fetched = await repo.findByTaskId('task-1');
        assert(fetched !== null, 'Record must be found');
        assert(fetched.taskId === 'task-1', 'Fetched taskId match');
        assert(fetched.state === TaskProcessingState.READY, 'Fetched state match');
      } finally {
        repo.close();
      }
    });

    // 3. Idempotent createInitialRecord
    await test('3. identical createInitialRecord is idempotent', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        const record1 = await repo.createInitialRecord('task-1');
        const record2 = await repo.createInitialRecord('task-1');
        assert(record1.taskId === record2.taskId, 'Idempotent taskId match');
        assert(record1.state === record2.state, 'Idempotent state match');
        assert(record1.modelAttempts === record2.modelAttempts, 'Idempotent attempts match');
      } finally {
        repo.close();
      }
    });

    // 4. Conflicting createInitialRecord throws PROCESSING_CONFLICT
    await test('4. conflicting initialization on modified task throws PROCESSING_CONFLICT', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        await repo.recordModelAttempt('task-1'); // state -> PROCESSING, attempts -> 1

        try {
          await repo.createInitialRecord('task-1');
          assert(false, 'Should have failed with PROCESSING_CONFLICT');
        } catch (err) {
          assert(err instanceof SqliteTaskProcessingLifecycleRepositoryError, 'Must be repo error');
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'PROCESSING_CONFLICT', 'Code mismatch');
        }
      } finally {
        repo.close();
      }
    });

    // 5. recordModelAttempt increments attempts and updates state to PROCESSING
    await test('5. recordModelAttempt increments modelAttempts and sets state to PROCESSING', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        await repo.createInitialRecord('task-2');
        const attempt1 = await repo.recordModelAttempt('task-2');
        assert(attempt1.state === TaskProcessingState.PROCESSING, 'State must be PROCESSING');
        assert(attempt1.modelAttempts === 1, 'Attempts must be 1');

        // Second attempt
        const attempt2 = await repo.recordModelAttempt('task-2');
        assert(attempt2.state === TaskProcessingState.PROCESSING, 'State must be PROCESSING');
        assert(attempt2.modelAttempts === 2, 'Attempts must be 2');
      } finally {
        repo.close();
      }
    });

    // 6. Third attempt is rejected with MAX_ATTEMPTS_EXCEEDED
    await test('6. third model attempt rejected with MAX_ATTEMPTS_EXCEEDED (max 2)', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        try {
          await repo.recordModelAttempt('task-2'); // attempts were 2
          assert(false, 'Should have failed with MAX_ATTEMPTS_EXCEEDED');
        } catch (err) {
          assert(err instanceof SqliteTaskProcessingLifecycleRepositoryError, 'Must be repo error');
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'MAX_ATTEMPTS_EXCEEDED', 'Code mismatch');
        }
      } finally {
        repo.close();
      }
    });

    // 7. State transitions: PROCESSING -> ADVISORY_PENDING_UPLOAD
    await test('7. valid transition to ADVISORY_PENDING_UPLOAD', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        const transitioned = await repo.transitionState(
          'task-1',
          TaskProcessingState.ADVISORY_PENDING_UPLOAD
        );
        assert(transitioned.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD, 'State match');
        assert(transitioned.modelAttempts === 1, 'Attempts preserved');
        assert(transitioned.terminalOutcome === null, 'Terminal outcome null');
      } finally {
        repo.close();
      }
    });

    // 8. State transitions: PROCESSING -> NON_ADVISORY_PENDING_REPORT (ABSTAINED)
    await test('8. valid transition to NON_ADVISORY_PENDING_REPORT with ABSTAINED', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        const transitioned = await repo.transitionState(
          'task-2',
          TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
          TaskProcessingTerminalOutcome.ABSTAINED
        );
        assert(transitioned.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'State match');
        assert(transitioned.terminalOutcome === TaskProcessingTerminalOutcome.ABSTAINED, 'Outcome match');
      } finally {
        repo.close();
      }
    });

    // 9. State transitions: ADVISORY_PENDING_UPLOAD -> COMPLETED
    await test('9. valid transition to COMPLETED', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        const completed = await repo.transitionState(
          'task-1',
          TaskProcessingState.COMPLETED
        );
        assert(completed.state === TaskProcessingState.COMPLETED, 'State must be COMPLETED');
      } finally {
        repo.close();
      }
    });

    // 10. Prohibited transitions throw INVALID_TRANSITION
    await test('10. prohibited state transitions throw INVALID_TRANSITION', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        // COMPLETED -> READY prohibited
        try {
          await repo.transitionState('task-1', TaskProcessingState.READY);
          assert(false, 'Should have failed with INVALID_TRANSITION');
        } catch (err) {
          assert(err instanceof SqliteTaskProcessingLifecycleRepositoryError, 'Must be repo error');
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'INVALID_TRANSITION', 'Code mismatch');
        }

        // Create a new task in READY to test forbidden transitions from READY
        await repo.createInitialRecord('task-forbidden-ready');

        // READY -> COMPLETED prohibited
        try {
          await repo.transitionState('task-forbidden-ready', TaskProcessingState.COMPLETED);
          assert(false, 'READY -> COMPLETED should have failed');
        } catch (err) {
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'INVALID_TRANSITION', 'Code mismatch');
        }

        // READY -> ADVISORY_PENDING_UPLOAD prohibited
        try {
          await repo.transitionState('task-forbidden-ready', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
          assert(false, 'READY -> ADVISORY_PENDING_UPLOAD should have failed');
        } catch (err) {
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'INVALID_TRANSITION', 'Code mismatch');
        }

        // READY -> NON_ADVISORY_PENDING_REPORT with MODEL_FAILURE prohibited (attempts = 0)
        try {
          await repo.transitionState(
            'task-forbidden-ready',
            TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
            TaskProcessingTerminalOutcome.MODEL_FAILURE
          );
          assert(false, 'READY -> NON_ADVISORY_PENDING_REPORT + MODEL_FAILURE should have failed');
        } catch (err) {
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'INVALID_TRANSITION', 'Code mismatch');
        }

        // Move task to PROCESSING to test forbidden transitions from PROCESSING
        await repo.recordModelAttempt('task-forbidden-ready');

        // PROCESSING -> COMPLETED prohibited
        try {
          await repo.transitionState('task-forbidden-ready', TaskProcessingState.COMPLETED);
          assert(false, 'PROCESSING -> COMPLETED should have failed');
        } catch (err) {
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'INVALID_TRANSITION', 'Code mismatch');
        }
      } finally {
        repo.close();
      }
    });

    // 11. READY -> NON_ADVISORY_PENDING_REPORT (ABSTAINED) with modelAttempts = 0
    await test('11. direct transition from READY to NON_ADVISORY_PENDING_REPORT with ABSTAINED keeps modelAttempts=0 and completes', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        await repo.createInitialRecord('task-abstained-zero-attempts');
        const transitioned = await repo.transitionState(
          'task-abstained-zero-attempts',
          TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
          TaskProcessingTerminalOutcome.ABSTAINED
        );
        assert(transitioned.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'State must be NON_ADVISORY_PENDING_REPORT');
        assert(transitioned.modelAttempts === 0, 'modelAttempts must remain 0');
        assert(transitioned.terminalOutcome === TaskProcessingTerminalOutcome.ABSTAINED, 'Outcome must be ABSTAINED');

        // Complete the task
        const completed = await repo.transitionState(
          'task-abstained-zero-attempts',
          TaskProcessingState.COMPLETED
        );
        assert(completed.state === TaskProcessingState.COMPLETED, 'State must be COMPLETED');
        assert(completed.modelAttempts === 0, 'modelAttempts must remain 0 on COMPLETED');
        assert(completed.terminalOutcome === TaskProcessingTerminalOutcome.ABSTAINED, 'Outcome must remain ABSTAINED on COMPLETED');
      } finally {
        repo.close();
      }
    });

    // 12. Persistence survives reopen / process restart
    await test('12. state and attempts survive database reopen', async () => {
      const repo1 = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      repo1.close();

      const repo2 = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        const task1 = await repo2.findByTaskId('task-1');
        assert(task1 !== null, 'task-1 must exist');
        assert(task1.state === TaskProcessingState.COMPLETED, 'task-1 state preserved');
        assert(task1.modelAttempts === 1, 'task-1 attempts preserved');

        const task2 = await repo2.findByTaskId('task-2');
        assert(task2 !== null, 'task-2 must exist');
        assert(task2.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'task-2 state preserved');
        assert(task2.modelAttempts === 2, 'task-2 attempts preserved');
        assert(task2.terminalOutcome === TaskProcessingTerminalOutcome.ABSTAINED, 'task-2 outcome preserved');

        const taskAbstained = await repo2.findByTaskId('task-abstained-zero-attempts');
        assert(taskAbstained !== null, 'task-abstained must exist');
        assert(taskAbstained.state === TaskProcessingState.COMPLETED, 'State preserved');
        assert(taskAbstained.modelAttempts === 0, 'Attempts = 0 preserved');
        assert(taskAbstained.terminalOutcome === TaskProcessingTerminalOutcome.ABSTAINED, 'Outcome preserved');
      } finally {
        repo2.close();
      }
    });

    // 13. listResumableRecords lists active non-completed tasks
    await test('13. listResumableRecords lists only non-completed active tasks', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        await repo.createInitialRecord('task-3'); // READY
        const resumable = await repo.listResumableRecords();
        const ids = resumable.map((r) => r.taskId);
        assert(!ids.includes('task-1'), 'Completed task-1 must not be resumable');
        assert(!ids.includes('task-abstained-zero-attempts'), 'Completed task-abstained must not be resumable');
        assert(ids.includes('task-2'), 'Pending report task-2 must be resumable');
        assert(ids.includes('task-3'), 'Ready task-3 must be resumable');
      } finally {
        repo.close();
      }
    });

    // 14. Nonexistent task throws TASK_NOT_FOUND on transition or record attempt
    await test('14. nonexistent task throws TASK_NOT_FOUND on recordModelAttempt or transitionState', async () => {
      const repo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        try {
          await repo.recordModelAttempt('task-nonexistent');
          assert(false, 'Should have failed');
        } catch (err) {
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'TASK_NOT_FOUND', 'Code mismatch');
        }

        try {
          await repo.transitionState('task-nonexistent', TaskProcessingState.COMPLETED);
          assert(false, 'Should have failed');
        } catch (err) {
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'TASK_NOT_FOUND', 'Code mismatch');
        }
      } finally {
        repo.close();
      }
    });

    // 15. Two-connection concurrent attempt reservation produces distinct attempts 1 and 2, blocks attempt 3
    await test('15. two independent repository connections reserve distinct model attempts and enforce max attempts', async () => {
      const initRepo = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        await initRepo.createInitialRecord('task-concurrent');
      } finally {
        initRepo.close();
      }

      const repoA = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      const repoB = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);

      try {
        // Execute overlapping reservations from independent connections
        const [resA, resB] = await Promise.all([
          repoA.recordModelAttempt('task-concurrent'),
          repoB.recordModelAttempt('task-concurrent'),
        ]);

        const observedAttempts = [resA.modelAttempts, resB.modelAttempts].sort((a, b) => a - b);
        assert(
          observedAttempts[0] === 1 && observedAttempts[1] === 2,
          `Expected distinct attempt numbers [1, 2] across connections, got: [${resA.modelAttempts}, ${resB.modelAttempts}]`
        );
        assert(resA.state === TaskProcessingState.PROCESSING, 'resA state must be PROCESSING');
        assert(resB.state === TaskProcessingState.PROCESSING, 'resB state must be PROCESSING');

        // Verify persisted state from both connections
        const readA = await repoA.findByTaskId('task-concurrent');
        const readB = await repoB.findByTaskId('task-concurrent');
        assert(readA !== null && readA.modelAttempts === 2, 'repoA sees persisted modelAttempts = 2');
        assert(readB !== null && readB.modelAttempts === 2, 'repoB sees persisted modelAttempts = 2');

        // Third reservation on either connection must fail with MAX_ATTEMPTS_EXCEEDED
        try {
          await repoA.recordModelAttempt('task-concurrent');
          assert(false, 'Third attempt on repoA should have failed');
        } catch (err) {
          assert(err instanceof SqliteTaskProcessingLifecycleRepositoryError, 'Must be repo error');
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'MAX_ATTEMPTS_EXCEEDED', 'Code mismatch on repoA');
        }

        try {
          await repoB.recordModelAttempt('task-concurrent');
          assert(false, 'Third attempt on repoB should have failed');
        } catch (err) {
          assert(err instanceof SqliteTaskProcessingLifecycleRepositoryError, 'Must be repo error');
          assert((err as SqliteTaskProcessingLifecycleRepositoryError).code === 'MAX_ATTEMPTS_EXCEEDED', 'Code mismatch on repoB');
        }
      } finally {
        repoA.close();
        repoB.close();
      }

      // Reopen a third connection to verify durable persisted state
      const repoC = new SqliteTaskProcessingLifecycleRepository(TEST_DB_PATH);
      try {
        const persisted = await repoC.findByTaskId('task-concurrent');
        assert(persisted !== null, 'task-concurrent must exist in reopened DB');
        assert(persisted.modelAttempts === 2, 'Persisted modelAttempts must be 2');
        assert(persisted.state === TaskProcessingState.PROCESSING, 'Persisted state must be PROCESSING');
      } finally {
        repoC.close();
      }
    });
  } finally {
    cleanupDb();
  }

  console.log('------------------------------------------------------------');
  console.log(`SQLITE TASK PROCESSING LIFECYCLE REPOSITORY TESTS: ${passedTests}/${totalTests} PASSED`);
})();
