import {
  createFirestoreNonAdvisoryOutcomePersistenceRuntime,
  NonAdvisoryFirestoreQueryDatabase,
} from '../functions/src/peia/firestoreNonAdvisoryOutcomePersistenceComposition';
import {
  FirestoreNonAdvisoryOutcomeRepository,
  PEIA_PENDING_TASK_COLLECTION,
  PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
  deriveNonAdvisoryOutcomeDocumentId,
  NonAdvisoryOutcomeRepositoryError,
} from '../functions/src/peia/firestoreNonAdvisoryOutcomeRepository';
import {
  NonAdvisoryOutcomePersistenceError,
} from '../functions/src/peia/nonAdvisoryOutcomePersistenceBoundary';
import { NonAdvisoryOutcomeTaskReconciliationError } from '../functions/src/peia/nonAdvisoryOutcomeTaskReconciliationBoundary';
import { AuthorizedNonAdvisoryOutcomeIntake } from '../functions/src/peia/authorizedNonAdvisoryOutcomeIntakeBoundary';
import { CanonicalNonAdvisoryOutcome } from '../functions/src/peia/nonAdvisoryOutcomeIntakeContract';
import { AITaskStatus, AITaskType, AIReviewTask } from '../functions/src/types/aiTask';
import { PEIAMachineCapability, VerifiedMachinePrincipal } from '../functions/src/peia/machineAuthorizationBoundary';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- Running PEIA Firestore Non-Advisory Outcome Persistence Composition Tests ---');

const now = new Date().toISOString();

const principal1: VerifiedMachinePrincipal = {
  principalId: 'p-comp-1',
  isActive: true,
  capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
};

function createIntake(outcome: CanonicalNonAdvisoryOutcome): AuthorizedNonAdvisoryOutcomeIntake {
  return {
    principal: principal1,
    request: {
      outcome,
    },
  };
}

class MockCompositionFirestoreDb {
  public docsMap = new Map<string, any>();
  public taskDocs = new Map<string, { id: string; data: any }>();
  public createCount = 0;
  public updateCount = 0;

  constructor() {}

  seedTask(docId: string, task: AIReviewTask) {
    this.taskDocs.set(docId, {
      id: docId,
      data: JSON.parse(JSON.stringify(task)),
    });
  }

  seedOutcome(taskId: string, record: any) {
    const docId = deriveNonAdvisoryOutcomeDocumentId(taskId);
    this.docsMap.set(docId, JSON.parse(JSON.stringify(record)));
  }

  // Implementation for NonAdvisoryFirestoreQueryDatabase
  collection(collName: string) {
    const self = this;
    return {
      doc(docId: string) {
        return {
          id: docId,
        };
      },
      where(field: string, op: string, value: any) {
        return {
          limit(count: number) {
            return {
              _isTaskQuery: true,
              collName,
              field,
              op,
              value,
              limitCount: count,
              async get() {
                const matches = Array.from(self.taskDocs.values())
                  .filter((t) => t.data.taskId === value)
                  .map((t) => ({
                    ref: { id: t.id },
                    data: () => t.data,
                  }));
                return { docs: matches.slice(0, count) };
              },
            };
          },
        };
      },
    };
  }

  // Implementation for Firestore Transaction Db
  async runTransaction<T>(updateFn: (tx: any) => Promise<T>): Promise<T> {
    const self = this;
    const tx = {
      async get(target: any) {
        if (target && target._isTaskQuery) {
          const matches = Array.from(self.taskDocs.values())
            .filter((t) => t.data.taskId === target.value)
            .map((t) => ({
              ref: { id: t.id },
              data: () => t.data,
            }));
          return { docs: matches.slice(0, target.limitCount) };
        }
        const docId = target.id;
        const existing = self.docsMap.get(docId);
        return {
          exists: existing !== undefined,
          data: () => existing,
        };
      },
      create(ref: any, data: any) {
        if (self.docsMap.has(ref.id)) {
          const err: any = new Error(`Document ${ref.id} already exists`);
          err.code = 6;
          throw err;
        }
        self.createCount++;
        self.docsMap.set(ref.id, JSON.parse(JSON.stringify(data)));
      },
      update(ref: any, data: any) {
        const existing = self.taskDocs.get(ref.id);
        if (!existing) {
          throw new Error(`Task document ${ref.id} not found`);
        }
        self.updateCount++;
        Object.assign(existing.data, data);
      },
    };
    return updateFn(tx);
  }
}

function createHarness() {
  const db = new MockCompositionFirestoreDb();
  const repo = new FirestoreNonAdvisoryOutcomeRepository(db as any);
  const runtime = createFirestoreNonAdvisoryOutcomePersistenceRuntime(db as any, repo);
  return { db, repo, runtime };
}

async function runAllTests() {
  const baseTask: AIReviewTask = {
    taskId: 'task-comp-1',
    taskType: AITaskType.CONTENT_REVIEW,
    status: AITaskStatus.Pending,
    target: {
      targetType: 'News' as any,
      targetId: 't-1',
      sourceUpdatedAt: now,
    },
    contentSnapshot: {
      title: 'Title 1',
      body: 'Body 1',
    },
    createdAt: now,
  };

  const outcomeAbstained: CanonicalNonAdvisoryOutcome = {
    taskId: 'task-comp-1',
    kind: 'ABSTAINED',
    reason: 'NO_EVIDENCE',
    modelAttempts: 0,
    createdAt: now,
  };

  const outcomeModelFailure: CanonicalNonAdvisoryOutcome = {
    taskId: 'task-comp-1',
    kind: 'MODEL_FAILURE',
    reason: 'TIMEOUT',
    modelAttempts: 1,
    createdAt: now,
  };

  // =========================================================================
  // CASE 1: Pending authoritative task + no stored outcome -> STORED -> task terminal
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Pending });

    const result = await runtime(createIntake(outcomeAbstained));
    assert(result.disposition === 'STORED', 'Case 1: disposition is STORED');
    assert(result.convergedStatus === AITaskStatus.Completed, 'Case 1: convergedStatus is Completed');

    const updatedTask = db.taskDocs.get('doc-1')?.data;
    assert(updatedTask.status === AITaskStatus.Completed, 'Case 1: task transitioned to Completed');

    const outcomeDocId = deriveNonAdvisoryOutcomeDocumentId('task-comp-1');
    assert(db.docsMap.has(outcomeDocId), 'Case 1: outcome document persisted in Firestore');
    console.log('✅ Case 1: Pending authoritative task + no stored outcome -> STORED');
  }

  // =========================================================================
  // CASE 2: Completed authoritative task + identical stored ABSTAINED outcome -> ALREADY_IDENTICAL -> zero writes
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Completed });
    const originalConvergedAt = '2026-01-01T00:00:00.000Z';
    db.seedOutcome('task-comp-1', {
      taskId: 'task-comp-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      nonAdvisoryOutcome: outcomeAbstained,
      convergedStatus: AITaskStatus.Completed,
      convergedAt: originalConvergedAt,
    });

    const createsBefore = db.createCount;
    const updatesBefore = db.updateCount;

    const result = await runtime(createIntake(outcomeAbstained));
    assert(result.disposition === 'ALREADY_IDENTICAL', 'Case 2: disposition is ALREADY_IDENTICAL');
    assert(result.convergedStatus === AITaskStatus.Completed, 'Case 2: convergedStatus is Completed');
    assert(db.createCount === createsBefore, 'Case 2: zero creates performed');
    assert(db.updateCount === updatesBefore, 'Case 2: zero updates performed');

    const storedDoc = db.docsMap.get(deriveNonAdvisoryOutcomeDocumentId('task-comp-1'));
    assert(storedDoc.convergedAt === originalConvergedAt, 'Case 2: original convergedAt preserved');
    console.log('✅ Case 2: Completed authoritative task + identical stored ABSTAINED outcome -> ALREADY_IDENTICAL');
  }

  // =========================================================================
  // CASE 3: Failed authoritative task + identical stored MODEL_FAILURE outcome -> ALREADY_IDENTICAL -> zero writes
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Failed });
    const originalConvergedAt = '2026-01-02T00:00:00.000Z';
    db.seedOutcome('task-comp-1', {
      taskId: 'task-comp-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      nonAdvisoryOutcome: outcomeModelFailure,
      convergedStatus: AITaskStatus.Failed,
      convergedAt: originalConvergedAt,
    });

    const createsBefore = db.createCount;
    const updatesBefore = db.updateCount;

    const result = await runtime(createIntake(outcomeModelFailure));
    assert(result.disposition === 'ALREADY_IDENTICAL', 'Case 3: disposition is ALREADY_IDENTICAL');
    assert(result.convergedStatus === AITaskStatus.Failed, 'Case 3: convergedStatus is Failed');
    assert(db.createCount === createsBefore, 'Case 3: zero creates performed');
    assert(db.updateCount === updatesBefore, 'Case 3: zero updates performed');
    console.log('✅ Case 3: Failed authoritative task + identical stored MODEL_FAILURE outcome -> ALREADY_IDENTICAL');
  }

  // =========================================================================
  // CASE 4: Terminal authoritative task + divergent stored outcome -> RESULT_CONFLICT
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Completed });
    db.seedOutcome('task-comp-1', {
      taskId: 'task-comp-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      nonAdvisoryOutcome: outcomeAbstained,
      convergedStatus: AITaskStatus.Completed,
      convergedAt: now,
    });

    const divergentOutcome: CanonicalNonAdvisoryOutcome = {
      ...outcomeAbstained,
      reason: 'INSUFFICIENT_EVIDENCE',
    };

    try {
      await runtime(createIntake(divergentOutcome));
      assert(false, 'Case 4: should have thrown RESULT_CONFLICT');
    } catch (err: any) {
      assert(err instanceof NonAdvisoryOutcomePersistenceError, 'Case 4: instance of NonAdvisoryOutcomePersistenceError');
      assert(err.code === 'RESULT_CONFLICT', 'Case 4: code is RESULT_CONFLICT');
    }
    console.log('✅ Case 4: Terminal authoritative task + divergent stored outcome -> RESULT_CONFLICT');
  }

  // =========================================================================
  // CASE 5: Terminal authoritative task + NO stored outcome -> fail closed
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Completed });

    const createsBefore = db.createCount;
    const updatesBefore = db.updateCount;

    try {
      await runtime(createIntake(outcomeAbstained));
      assert(false, 'Case 5: should have failed closed');
    } catch (err: any) {
      assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Case 5: instance of NonAdvisoryOutcomeRepositoryError');
      assert(err.code === 'TASK_NOT_PENDING', 'Case 5: code is TASK_NOT_PENDING');
    }

    assert(db.createCount === createsBefore, 'Case 5: no outcome written');
    assert(db.updateCount === updatesBefore, 'Case 5: no task updated');
    console.log('✅ Case 5: Terminal authoritative task + NO stored outcome -> fail closed');
  }

  // =========================================================================
  // CASE 6: Pending authoritative task + existing identical stored outcome -> fail closed with TASK_STATUS_INCONSISTENT
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Pending });
    db.seedOutcome('task-comp-1', {
      taskId: 'task-comp-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      nonAdvisoryOutcome: outcomeAbstained,
      convergedStatus: AITaskStatus.Completed,
      convergedAt: now,
    });

    try {
      await runtime(createIntake(outcomeAbstained));
      assert(false, 'Case 6: should have thrown TASK_STATUS_INCONSISTENT');
    } catch (err: any) {
      assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Case 6: instance of NonAdvisoryOutcomeRepositoryError');
      assert(err.code === 'TASK_STATUS_INCONSISTENT', 'Case 6: code is TASK_STATUS_INCONSISTENT');
    }
    console.log('✅ Case 6: Pending authoritative task + existing identical stored outcome -> TASK_STATUS_INCONSISTENT');
  }

  // =========================================================================
  // CASE 7: Wrong terminal status + existing identical stored outcome -> fail closed with TASK_STATUS_INCONSISTENT
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    // Task is Failed, but outcome is ABSTAINED (which expects Completed)
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Failed });
    db.seedOutcome('task-comp-1', {
      taskId: 'task-comp-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      nonAdvisoryOutcome: outcomeAbstained,
      convergedStatus: AITaskStatus.Completed,
      convergedAt: now,
    });

    try {
      await runtime(createIntake(outcomeAbstained));
      assert(false, 'Case 7: should have thrown TASK_STATUS_INCONSISTENT');
    } catch (err: any) {
      assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Case 7: instance of NonAdvisoryOutcomeRepositoryError');
      assert(err.code === 'TASK_STATUS_INCONSISTENT', 'Case 7: code is TASK_STATUS_INCONSISTENT');
    }
    console.log('✅ Case 7: Wrong terminal status + existing identical stored outcome -> TASK_STATUS_INCONSISTENT');
  }

  // =========================================================================
  // CASE 8: Missing authoritative task -> TASK_NOT_FOUND
  // =========================================================================
  {
    const { runtime } = createHarness();
    // No task seeded in db

    try {
      await runtime(createIntake(outcomeAbstained));
      assert(false, 'Case 8: should have thrown TASK_NOT_FOUND');
    } catch (err: any) {
      assert(err instanceof NonAdvisoryOutcomeTaskReconciliationError, 'Case 8: instance of NonAdvisoryOutcomeTaskReconciliationError');
      assert(err.code === 'TASK_NOT_FOUND', 'Case 8: code is TASK_NOT_FOUND');
    }
    console.log('✅ Case 8: Missing authoritative task -> TASK_NOT_FOUND');
  }

  // =========================================================================
  // CASE 9: Duplicate authoritative task query results -> fail closed with cardinality error
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Pending });
    db.seedTask('doc-2', { ...baseTask, status: AITaskStatus.Pending });

    try {
      await runtime(createIntake(outcomeAbstained));
      assert(false, 'Case 9: should have thrown cardinality error');
    } catch (err: any) {
      assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Case 9: instance of NonAdvisoryOutcomeRepositoryError');
      assert(err.code === 'TASK_QUERY_CARDINALITY_INVALID', 'Case 9: code is TASK_QUERY_CARDINALITY_INVALID');
    }
    console.log('✅ Case 9: Duplicate authoritative task query results -> TASK_QUERY_CARDINALITY_INVALID');
  }

  // =========================================================================
  // LOST-RESPONSE REPLAY THROUGH REAL COMPOSITION (SECTION 4)
  // =========================================================================
  {
    const { db, runtime } = createHarness();
    db.seedTask('doc-1', { ...baseTask, status: AITaskStatus.Pending });

    const intake = createIntake(outcomeAbstained);

    // FIRST EXECUTION:
    const res1 = await runtime(intake);
    assert(res1.disposition === 'STORED', 'Lost-response execution 1 disposition is STORED');
    assert(res1.convergedStatus === AITaskStatus.Completed, 'Lost-response execution 1 convergedStatus is Completed');

    const taskAfterExec1 = db.taskDocs.get('doc-1')?.data;
    assert(taskAfterExec1.status === AITaskStatus.Completed, 'Task is terminal Completed after execution 1');

    const outcomeDocId = deriveNonAdvisoryOutcomeDocumentId('task-comp-1');
    const storedOutcome1 = db.docsMap.get(outcomeDocId);
    assert(storedOutcome1 !== undefined, 'Outcome stored after execution 1');
    const originalConvergedAt = storedOutcome1.convergedAt;

    const createsAfterExec1 = db.createCount;
    const updatesAfterExec1 = db.updateCount;

    // SECOND EXECUTION (Identical lost-response retry):
    const res2 = await runtime(intake);
    assert(res2.disposition === 'ALREADY_IDENTICAL', 'Lost-response execution 2 disposition is ALREADY_IDENTICAL');
    assert(res2.convergedStatus === AITaskStatus.Completed, 'Lost-response execution 2 convergedStatus is Completed');

    assert(db.createCount === createsAfterExec1, 'Lost-response execution 2: zero additional creates');
    assert(db.updateCount === updatesAfterExec1, 'Lost-response execution 2: zero additional updates');

    const storedOutcome2 = db.docsMap.get(outcomeDocId);
    assert(storedOutcome2.convergedAt === originalConvergedAt, 'Original convergedAt preserved across lost-response replay');
    console.log('✅ Section 4: Lost-response replay through real composition passed');
  }

  console.log('PASSED: All 10 Composition tests passed (9 matrix cases + real lost-response composition).');
}

runAllTests().catch((err) => {
  console.error('FAILED with error:', err);
  process.exit(1);
});
