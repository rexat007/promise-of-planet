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

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
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
            };
          },
        };
      },
    };
  }

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
          const err: any = new Error('ALREADY_EXISTS');
          err.code = 6;
          throw err;
        }
        self.createCount++;
        self.docsMap.set(ref.id, JSON.parse(JSON.stringify(data)));
      },
      update(ref: any, data: any) {
        const taskObj = self.taskDocs.get(ref.id);
        if (!taskObj) {
          throw new Error(`Task document ${ref.id} not found`);
        }
        self.updateCount++;
        taskObj.data = { ...taskObj.data, ...data };
      },
    };
    return updateFn(tx);
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
    assert(db.createCount === 0, 'Case 2: zero writes on replay');
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
    }
  }

  // Case 4: Completed task + NO stored result -> fail closed (TASK_STATUS_INCONSISTENT or TASK_NOT_FOUND)
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
  }

  console.log('PASSED: All PEIA Firestore Advisory Result Persistence Composition tests passed.');
}

runTests().catch((err) => {
  console.error('FAILED with error:', err);
  process.exit(1);
});
