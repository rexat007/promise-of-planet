import {
  FirestoreAdvisoryResultRepository,
  PEIA_PENDING_TASK_COLLECTION,
  PEIA_ADVISORY_RESULT_COLLECTION,
  deriveAdvisoryResultDocumentId,
  AdvisoryResultRepositoryError,
} from '../functions/src/peia/firestoreAdvisoryResultRepository';
import {
  AdvisoryResultPersistenceError,
} from '../functions/src/peia/advisoryResultPersistenceBoundary';
import { AuthorizedAdvisoryResultIntake } from '../functions/src/peia/authorizedAdvisoryResultIntakeBoundary';
import { AdvisoryResultIntakeResult } from '../functions/src/peia/advisoryResultIntakeContract';
import { AITaskStatus, AITaskType, AIReviewTask } from '../functions/src/types/aiTask';
import { AIReviewTargetType, AIReviewSeverity } from '../src/types/aiReview';
import { PEIAMachineCapability, VerifiedMachinePrincipal } from '../functions/src/peia/machineAuthorizationBoundary';

let assertionCount = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  assertionCount++;
}

console.log('--- Running PEIA Firestore Advisory Result Persistence Composition Tests ---');

const now = new Date().toISOString();

const principal1: VerifiedMachinePrincipal = {
  principalId: 'p-adv-1',
  isActive: true,
  capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
};

const principal2: VerifiedMachinePrincipal = {
  principalId: 'p-adv-2',
  isActive: true,
  capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT, PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
};

const baseTask: AIReviewTask = {
  taskId: 'task-adv-1',
  taskType: AITaskType.CONTENT_REVIEW,
  status: AITaskStatus.Pending,
  createdAt: now,
  target: {
    targetType: AIReviewTargetType.News,
    targetId: 'news-100',
    sourceUpdatedAt: now,
  },
  contentSnapshot: { title: 'Test News' },
};

const baseResult: AdvisoryResultIntakeResult = {
  schemaVersion: 1,
  task: {
    taskId: 'task-adv-1',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-100',
      sourceUpdatedAt: now,
    },
  },
  humanReviewRequired: true,
  assessment: {
    summary: 'Advisory assessment summary',
    findings: [
      {
        code: 'PEIA_FINDING_001',
        severity: AIReviewSeverity.Info,
        message: 'Info message',
        evidenceIds: ['ev-1'],
      },
    ],
  },
  recommendations: ['rec-1'],
  uncertainties: ['unc-1'],
  limitations: ['lim-1'],
};

class MockFirestoreTxDb {
  public docsMap = new Map<string, any>();
  public taskDocs = new Map<string, { id: string; data: any }>();
  public createCount = 0;
  public updateCount = 0;
  public stagedCreateCount = 0;
  public stagedUpdateCount = 0;
  public failOnCommitCreateError: Error | null = null;
  public failOnCommitUpdateError: Error | null = null;
  public onStagedCreate?: (ref: any, data: any) => void;
  public onStagedUpdate?: (ref: any, data: any) => void;

  seedTask(docId: string, task: AIReviewTask) {
    this.taskDocs.set(docId, {
      id: docId,
      data: JSON.parse(JSON.stringify(task)),
    });
  }

  seedOutcome(taskId: string, record: any) {
    const docId = deriveAdvisoryResultDocumentId(taskId);
    this.docsMap.set(docId, JSON.parse(JSON.stringify(record)));
  }

  collection(collName: string) {
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
            };
          },
        };
      },
    };
  }

  async runTransaction<T>(updateFn: (tx: any) => Promise<T>): Promise<T> {
    const self = this;
    const stagedCreates: Array<{ ref: any; data: any }> = [];
    const stagedUpdates: Array<{ ref: any; data: any }> = [];

    const tx = {
      async get(target: any) {
        if (target && target._isTaskQuery) {
          const matches = Array.from(self.taskDocs.values())
            .filter((t) => t.data.taskId === target.value)
            .map((t) => ({
              exists: true,
              ref: { id: t.id },
              data: () => JSON.parse(JSON.stringify(t.data)),
            }));
          return { docs: matches.slice(0, target.limitCount) };
        }
        const docId = target.id;
        const existing = self.docsMap.get(docId);
        return {
          exists: existing !== undefined,
          ref: { id: docId },
          data: () => (existing !== undefined ? JSON.parse(JSON.stringify(existing)) : undefined),
        };
      },
      create(ref: any, data: any) {
        const cloned = JSON.parse(JSON.stringify(data));
        self.stagedCreateCount++;
        stagedCreates.push({ ref, data: cloned });
        if (self.onStagedCreate) {
          self.onStagedCreate(ref, cloned);
        }
        return tx;
      },
      update(ref: any, data: any) {
        const cloned = JSON.parse(JSON.stringify(data));
        self.stagedUpdateCount++;
        stagedUpdates.push({ ref, data: cloned });
        if (self.onStagedUpdate) {
          self.onStagedUpdate(ref, cloned);
        }
        return tx;
      },
      set() {
        throw new Error('set() is forbidden in advisory result transaction');
      },
    };

    // 1. Await transaction callback completion before validating or committing any write
    const callbackResult = await updateFn(tx);

    // 2. Validate all create-only preconditions before committing any write
    const pendingCreateIds = new Set<string>();
    for (const op of stagedCreates) {
      if (self.failOnCommitCreateError) {
        throw self.failOnCommitCreateError;
      }
      if (!op.ref || typeof op.ref.id !== 'string' || op.ref.id.trim() === '') {
        throw new Error('Invalid document reference for transactional create');
      }
      if (self.docsMap.has(op.ref.id) || pendingCreateIds.has(op.ref.id)) {
        const err: any = new Error('ALREADY_EXISTS');
        err.code = 6;
        throw err;
      }
      pendingCreateIds.add(op.ref.id);
    }

    // 3. Validate all target task references and update preconditions before committing any write
    for (const op of stagedUpdates) {
      if (self.failOnCommitUpdateError) {
        throw self.failOnCommitUpdateError;
      }
      if (!op.ref || typeof op.ref.id !== 'string' || op.ref.id.trim() === '') {
        throw new Error('Invalid task document reference for transactional update');
      }
      if (!self.taskDocs.has(op.ref.id)) {
        throw new Error(`Task document ${op.ref.id} not found`);
      }
      if (!op.data || typeof op.data !== 'object') {
        throw new Error('Invalid transactional update payload');
      }
    }

    // 4. Commit all staged writes atomically together
    for (const op of stagedCreates) {
      self.docsMap.set(op.ref.id, JSON.parse(JSON.stringify(op.data)));
      self.createCount++;
    }
    for (const op of stagedUpdates) {
      const taskObj = self.taskDocs.get(op.ref.id)!;
      taskObj.data = { ...taskObj.data, ...JSON.parse(JSON.stringify(op.data)) };
      self.updateCount++;
    }

    return callbackResult;
  }
}

async function runTests() {
  // Case 1: Pending authoritative task + no stored result -> STORED + task Completed
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Pending });
    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      advisoryResult: baseResult,
    };

    const res = await repo.saveWithTaskConvergence(record);
    assert(res.disposition === 'STORED', 'Case 1: disposition is STORED');
    assert(db.taskDocs.get('t-doc-1')!.data.status === AITaskStatus.Completed, 'Case 1: task transitions to Completed');
    assert(db.createCount === 1 && db.updateCount === 1, 'Case 1: committed 1 create and 1 update');
  }

  // Case 2: Completed authoritative task + identical stored advisory result -> ALREADY_IDENTICAL
  {
    const db = new MockFirestoreTxDb();
    const completedTask = { ...baseTask, status: AITaskStatus.Completed };
    db.seedTask('t-doc-1', completedTask);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending }, // stored pre-transition snapshot
      principal: principal1,
      advisoryResult: baseResult,
    };
    db.seedOutcome('task-adv-1', record);

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const res = await repo.saveWithTaskConvergence(record);
    assert(res.disposition === 'ALREADY_IDENTICAL', 'Case 2: Completed + identical -> ALREADY_IDENTICAL');
    assert(db.createCount === 0 && db.updateCount === 0, 'Case 2: zero writes on replay');
  }

  // Case 3: Completed authoritative task + divergent advisory result -> RESULT_CONFLICT
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Completed });
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };
    db.seedOutcome('task-adv-1', record);

    const divergentResult = JSON.parse(JSON.stringify(baseResult));
    divergentResult.assessment.summary = 'Divergent summary';
    const divergentRecord = { ...record, advisoryResult: divergentResult };

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    try {
      await repo.saveWithTaskConvergence(divergentRecord);
      assert(false, 'Case 3: Should have thrown RESULT_CONFLICT');
    } catch (err: any) {
      assert(err instanceof AdvisoryResultPersistenceError && err.code === 'RESULT_CONFLICT', 'Case 3: error is RESULT_CONFLICT');
      assert(db.createCount === 0 && db.updateCount === 0, 'Case 3: zero writes on RESULT_CONFLICT');
    }
  }

  // Case 4: Completed task + NO stored result -> fail closed (TASK_NOT_PENDING)
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Completed });
    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };

    try {
      await repo.saveWithTaskConvergence(record);
      assert(false, 'Case 4: Should have failed closed');
    } catch (err: any) {
      assert(err instanceof AdvisoryResultRepositoryError && err.code === 'TASK_NOT_PENDING', 'Case 4: Completed task cannot accept first submission -> TASK_NOT_PENDING');
      assert(db.createCount === 0 && db.updateCount === 0, 'Case 4: zero writes on TASK_NOT_PENDING');
    }
  }

  // Case 5: Pending task + existing stored result -> fail closed (TASK_STATUS_INCONSISTENT)
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Pending });
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };
    db.seedOutcome('task-adv-1', record);

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    try {
      await repo.saveWithTaskConvergence(record);
      assert(false, 'Case 5: Should have failed closed');
    } catch (err: any) {
      assert(err instanceof AdvisoryResultRepositoryError && err.code === 'TASK_STATUS_INCONSISTENT', 'Case 5: Pending task with existing result -> TASK_STATUS_INCONSISTENT');
      assert(db.createCount === 0 && db.updateCount === 0, 'Case 5: zero writes on TASK_STATUS_INCONSISTENT');
    }
  }

  // Case 6: Authoritative task reference mismatch -> fail closed (TASK_IDENTITY_MISMATCH) with zero writes
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', {
      ...baseTask,
      status: AITaskStatus.Pending,
      target: {
        ...baseTask.target,
        targetId: 'news-different-999',
      },
    });
    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };

    try {
      await repo.saveWithTaskConvergence(record);
      assert(false, 'Case 6: Should have thrown TASK_IDENTITY_MISMATCH');
    } catch (err: any) {
      assert(
        err instanceof AdvisoryResultPersistenceError && err.code === 'TASK_IDENTITY_MISMATCH',
        'Case 6: error is TASK_IDENTITY_MISMATCH'
      );
      assert(db.createCount === 0 && db.updateCount === 0, 'Case 6: zero writes on task reference mismatch');
      assert(db.docsMap.size === 0, 'Case 6: no outcome document committed');
      assert(db.taskDocs.get('t-doc-1')!.data.status === AITaskStatus.Pending, 'Case 6: task remains Pending');
    }
  }

  // Case 8: missing task -> TASK_NOT_FOUND
  {
    const db = new MockFirestoreTxDb();
    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const record = {
      taskId: 'missing-task',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };

    try {
      await repo.saveWithTaskConvergence(record);
      assert(false, 'Case 8: Should have thrown TASK_NOT_FOUND');
    } catch (err: any) {
      assert(err instanceof AdvisoryResultRepositoryError && err.code === 'TASK_NOT_FOUND', 'Case 8: error is TASK_NOT_FOUND');
      assert(db.createCount === 0 && db.updateCount === 0, 'Case 8: zero writes on TASK_NOT_FOUND');
    }
  }

  // Case 12: Stored principal unchanged on replay, different currently-authorized principal does not conflict
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Completed });
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1, // stored with principal1
      advisoryResult: baseResult,
    };
    db.seedOutcome('task-adv-1', record);

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const replayRecord = {
      ...record,
      principal: principal2, // submitted with principal2
    };

    const res = await repo.saveWithTaskConvergence(replayRecord);
    assert(res.disposition === 'ALREADY_IDENTICAL', 'Case 12/13: different authorized principal does not conflict');
    const stored = db.docsMap.get(deriveAdvisoryResultDocumentId('task-adv-1'));
    assert(stored.principal.principalId === 'p-adv-1', 'Case 12: stored principal snapshot remains unchanged');
    assert(db.createCount === 0 && db.updateCount === 0, 'Case 12: zero writes on replay');
  }

  // Case 9: Duplicate authoritative task query results -> TASK_QUERY_CARDINALITY_INVALID
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Pending });
    db.seedTask('t-doc-2', { ...baseTask, status: AITaskStatus.Pending });
    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };

    try {
      await repo.saveWithTaskConvergence(record);
      assert(false, 'Case 9: Should have thrown TASK_QUERY_CARDINALITY_INVALID');
    } catch (err: any) {
      assert(
        err instanceof AdvisoryResultRepositoryError && err.code === 'TASK_QUERY_CARDINALITY_INVALID',
        'Case 9: error is TASK_QUERY_CARDINALITY_INVALID'
      );
      assert(db.createCount === 0 && db.updateCount === 0, 'Case 9: zero writes on cardinality failure');
    }
  }

  // Case 10: Missing runTransaction -> fail closed (TRANSACTION_REQUIRED) with zero writes
  {
    let nonTxCreateCalled = false;
    const nonTxDb = {
      collection() {
        return {
          doc(id: string) {
            return {
              id,
              async create() {
                nonTxCreateCalled = true;
              },
            };
          },
          where() {
            return {
              limit() {
                return {};
              },
            };
          },
        };
      },
    };
    const repo = new FirestoreAdvisoryResultRepository(nonTxDb as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };

    try {
      await repo.saveWithTaskConvergence(record);
      assert(false, 'Case 10: Should have failed closed when runTransaction is missing');
    } catch (err: any) {
      assert(
        err instanceof AdvisoryResultRepositoryError && err.code === 'TRANSACTION_REQUIRED',
        'Case 10: error is TRANSACTION_REQUIRED'
      );
      assert(!nonTxCreateCalled, 'Case 10: zero writes when runTransaction is missing');
    }
  }

  // Case 11: Missing taskDoc.ref -> fail closed (TASK_DOCUMENT_REF_MISSING) before any transaction writes
  {
    let txCreates = 0;
    let txUpdates = 0;
    const missingRefDb = {
      collection() {
        return {
          doc(id: string) {
            return { id };
          },
          where() {
            return {
              limit() {
                return { _isTaskQuery: true };
              },
            };
          },
        };
      },
      async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        return fn({
          async get(target: any) {
            if (target && target._isTaskQuery) {
              return {
                docs: [
                  {
                    exists: true,
                    ref: undefined,
                    data: () => ({ ...baseTask, status: AITaskStatus.Pending }),
                  },
                ],
              };
            }
            return { exists: false, data: () => undefined };
          },
          create() {
            txCreates++;
          },
          update() {
            txUpdates++;
          },
          set() {},
        });
      },
    };
    const repo = new FirestoreAdvisoryResultRepository(missingRefDb as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };

    try {
      await repo.saveWithTaskConvergence(record);
      assert(false, 'Case 11: Should have failed closed when taskDoc.ref is missing');
    } catch (err: any) {
      assert(
        err instanceof AdvisoryResultRepositoryError && err.code === 'TASK_DOCUMENT_REF_MISSING',
        'Case 11: error is TASK_DOCUMENT_REF_MISSING'
      );
      assert(txCreates === 0 && txUpdates === 0, 'Case 11: zero writes when taskDoc.ref is missing');
    }
  }

  // TX-ROLLBACK-CREATE: Simulate a result-create failure -> zero committed writes, task remains Pending
  {
    // Subcase A: Simulated create infrastructure failure
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Pending });
    const simulatedCreateFailure = new Error('SIMULATED_RESULT_CREATE_FAILURE');
    db.failOnCommitCreateError = simulatedCreateFailure;

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      advisoryResult: baseResult,
    };

    const outcomeDocId = deriveAdvisoryResultDocumentId('task-adv-1');
    let falseStoredDisposition = false;
    let caughtError: unknown = null;

    try {
      const res = await repo.saveWithTaskConvergence(record);
      if (res && res.disposition === 'STORED') {
        falseStoredDisposition = true;
      }
      assert(false, 'TX-ROLLBACK-CREATE: Should have rejected on result-create failure');
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === simulatedCreateFailure, 'TX-ROLLBACK-CREATE: simulated result-create failure propagated');
    assert(!falseStoredDisposition, 'TX-ROLLBACK-CREATE: no false STORED disposition');
    assert(db.stagedCreateCount === 1 && db.stagedUpdateCount === 1, 'TX-ROLLBACK-CREATE: writes were staged during callback');
    assert(!db.docsMap.has(outcomeDocId) && db.docsMap.size === 0, 'TX-ROLLBACK-CREATE: result document was not committed');
    assert(db.taskDocs.get('t-doc-1')!.data.status === AITaskStatus.Pending, 'TX-ROLLBACK-CREATE: authoritative task remains Pending');
    assert(db.createCount === 0 && db.updateCount === 0, 'TX-ROLLBACK-CREATE: zero committed writes');

    // Subcase B: Create-only precondition failure (concurrently created outcome doc before commit)
    const dbRace = new MockFirestoreTxDb();
    dbRace.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Pending });
    dbRace.onStagedCreate = () => {
      // Simulate concurrent outcome document inserted before commit validation
      dbRace.docsMap.set(outcomeDocId, { concurrent: true });
    };
    const repoRace = new FirestoreAdvisoryResultRepository(dbRace as any);
    let raceError: any = null;
    try {
      await repoRace.saveWithTaskConvergence(record);
      assert(false, 'TX-ROLLBACK-CREATE (create precondition): Should have rejected with ALREADY_EXISTS');
    } catch (err: any) {
      raceError = err;
    }
    assert(raceError && raceError.code === 6, 'TX-ROLLBACK-CREATE (create precondition): ALREADY_EXISTS propagated');
    assert(dbRace.taskDocs.get('t-doc-1')!.data.status === AITaskStatus.Pending, 'TX-ROLLBACK-CREATE (create precondition): task remains Pending');
    assert(dbRace.createCount === 0 && dbRace.updateCount === 0, 'TX-ROLLBACK-CREATE (create precondition): zero committed writes');
    console.log('PASSED: TX-ROLLBACK-CREATE');
  }

  // TX-ROLLBACK-UPDATE: Simulate a task-update failure after result creation has been staged -> staged create discarded, zero committed writes
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Pending });
    const simulatedUpdateFailure = new Error('SIMULATED_TASK_UPDATE_FAILURE');
    db.failOnCommitUpdateError = simulatedUpdateFailure;

    let createStagedBeforeUpdate = false;
    let committedDocsDuringCallback = -1;
    let taskStatusDuringCallback = '';

    db.onStagedCreate = () => {
      committedDocsDuringCallback = db.docsMap.size;
    };
    db.onStagedUpdate = () => {
      createStagedBeforeUpdate = db.stagedCreateCount === 1;
      taskStatusDuringCallback = db.taskDocs.get('t-doc-1')!.data.status;
    };

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      advisoryResult: baseResult,
    };

    const outcomeDocId = deriveAdvisoryResultDocumentId('task-adv-1');
    let falseStoredDisposition = false;
    let caughtError: unknown = null;

    try {
      const res = await repo.saveWithTaskConvergence(record);
      if (res && res.disposition === 'STORED') {
        falseStoredDisposition = true;
      }
      assert(false, 'TX-ROLLBACK-UPDATE: Should have rejected on task-update failure');
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError === simulatedUpdateFailure, 'TX-ROLLBACK-UPDATE: simulated task-update failure propagated');
    assert(!falseStoredDisposition, 'TX-ROLLBACK-UPDATE: no false STORED disposition');
    assert(createStagedBeforeUpdate, 'TX-ROLLBACK-UPDATE: result creation was staged before task update');
    assert(committedDocsDuringCallback === 0, 'TX-ROLLBACK-UPDATE: create did not mutate committed storage during callback');
    assert(taskStatusDuringCallback === AITaskStatus.Pending, 'TX-ROLLBACK-UPDATE: update did not mutate task status during callback');
    assert(!db.docsMap.has(outcomeDocId) && db.docsMap.size === 0, 'TX-ROLLBACK-UPDATE: staged result creation was discarded and does not exist in committed storage');
    assert(db.taskDocs.get('t-doc-1')!.data.status === AITaskStatus.Pending, 'TX-ROLLBACK-UPDATE: authoritative task remains Pending');
    assert(db.createCount === 0 && db.updateCount === 0, 'TX-ROLLBACK-UPDATE: zero committed writes');
    console.log('PASSED: TX-ROLLBACK-UPDATE');
  }

  // TX-ATOMIC-SUCCESS: Valid first submission stages during callback and commits both result and Completed task status together
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Pending });

    let docsSizeDuringCreate = -1;
    let taskStatusDuringUpdate = '';
    db.onStagedCreate = () => {
      docsSizeDuringCreate = db.docsMap.size;
    };
    db.onStagedUpdate = () => {
      taskStatusDuringUpdate = db.taskDocs.get('t-doc-1')!.data.status;
    };

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      advisoryResult: baseResult,
    };

    const outcomeDocId = deriveAdvisoryResultDocumentId('task-adv-1');
    const res = await repo.saveWithTaskConvergence(record);

    assert(docsSizeDuringCreate === 0, 'TX-ATOMIC-SUCCESS: zero committed outcome docs during callback execution');
    assert(taskStatusDuringUpdate === AITaskStatus.Pending, 'TX-ATOMIC-SUCCESS: task remains Pending during callback execution');
    assert(res.disposition === 'STORED', 'TX-ATOMIC-SUCCESS: returns STORED disposition');
    assert(db.createCount === 1 && db.updateCount === 1, 'TX-ATOMIC-SUCCESS: commits 1 result creation and 1 task update together');
    assert(db.docsMap.has(outcomeDocId), 'TX-ATOMIC-SUCCESS: result document exists in committed storage');
    assert(db.taskDocs.get('t-doc-1')!.data.status === AITaskStatus.Completed, 'TX-ATOMIC-SUCCESS: authoritative task status is Completed in committed storage');

    const storedRecord = db.docsMap.get(outcomeDocId);
    const forbiddenFields = ['status', 'approved', 'rejected', 'published', 'completed', 'humanDecision', 'credential', 'machineCredential', 'secret', 'token', 'authorization'];
    for (const field of forbiddenFields) {
      assert(!(field in storedRecord), `TX-ATOMIC-SUCCESS: stored record contains no forbidden field "${field}"`);
      assert(!(field in storedRecord.principal), `TX-ATOMIC-SUCCESS: stored principal contains no forbidden field "${field}"`);
    }
    console.log('PASSED: TX-ATOMIC-SUCCESS');
  }

  // TX-REPLAY: Identical replay returns ALREADY_IDENTICAL with zero additional writes
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Completed });
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: { ...baseTask, status: AITaskStatus.Pending },
      principal: principal1,
      advisoryResult: baseResult,
    };
    db.seedOutcome('task-adv-1', record);

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    const res = await repo.saveWithTaskConvergence(record);
    assert(res.disposition === 'ALREADY_IDENTICAL', 'TX-REPLAY: identical replay returns ALREADY_IDENTICAL');
    assert(db.stagedCreateCount === 0 && db.stagedUpdateCount === 0, 'TX-REPLAY: zero staged writes on replay');
    assert(db.createCount === 0 && db.updateCount === 0, 'TX-REPLAY: zero committed writes on replay');
    console.log('PASSED: TX-REPLAY');
  }

  // TX-CONFLICT: Divergent replay cannot overwrite the existing result
  {
    const db = new MockFirestoreTxDb();
    db.seedTask('t-doc-1', { ...baseTask, status: AITaskStatus.Completed });
    const record = {
      taskId: 'task-adv-1',
      reconciledTask: baseTask,
      principal: principal1,
      advisoryResult: baseResult,
    };
    db.seedOutcome('task-adv-1', record);

    const divergentResult = JSON.parse(JSON.stringify(baseResult));
    divergentResult.assessment.summary = 'Divergent summary attempting overwrite';
    const divergentRecord = { ...record, advisoryResult: divergentResult };

    const repo = new FirestoreAdvisoryResultRepository(db as any);
    let caughtConflict = false;
    try {
      await repo.saveWithTaskConvergence(divergentRecord);
      assert(false, 'TX-CONFLICT: Should have thrown RESULT_CONFLICT');
    } catch (err: any) {
      caughtConflict = err instanceof AdvisoryResultPersistenceError && err.code === 'RESULT_CONFLICT';
    }

    assert(caughtConflict, 'TX-CONFLICT: rejected with RESULT_CONFLICT');
    assert(db.createCount === 0 && db.updateCount === 0, 'TX-CONFLICT: zero committed writes on divergent replay');
    const outcomeDocId = deriveAdvisoryResultDocumentId('task-adv-1');
    const committedRecord = db.docsMap.get(outcomeDocId);
    assert(
      committedRecord.advisoryResult.assessment.summary === 'Advisory assessment summary',
      'TX-CONFLICT: existing committed advisory result was not overwritten'
    );
    console.log('PASSED: TX-CONFLICT');
  }

  console.log(`PASSED: All PEIA Firestore Advisory Result Persistence Composition tests passed (${assertionCount} assertions across 16 cases).`);
}

runTests().catch((err) => {
  console.error('FAILED with error:', err);
  process.exit(1);
});
