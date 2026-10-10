import {
  FirestoreNonAdvisoryOutcomeRepository,
  deriveNonAdvisoryOutcomeDocumentId,
  PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
  PEIA_PENDING_TASK_COLLECTION,
  NonAdvisoryOutcomeRepositoryError,
} from '../functions/src/peia/firestoreNonAdvisoryOutcomeRepository';
import { NonAdvisoryOutcomePersistenceError } from '../functions/src/peia/nonAdvisoryOutcomePersistenceBoundary';
import { AITaskStatus, AITaskType } from '../functions/src/types/aiTask';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import { createHash } from 'node:crypto';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- Running Firestore Non-Advisory Outcome Repository Tests ---');

// 1. Assert SHA-256(taskId) ONLY
const sampleTaskId = 'task-repo-xyz';
const expectedHash = createHash('sha256').update(sampleTaskId, 'utf8').digest('hex');
const derivedDocId = deriveNonAdvisoryOutcomeDocumentId(sampleTaskId);
assert(derivedDocId === expectedHash, 'deriveNonAdvisoryOutcomeDocumentId uses SHA-256(taskId) hex digest');

// 2. Mock Firestore Database proving Field Query usage and SHA-256 doc address
class MockFirestoreTxDb {
  public docsMap = new Map<string, any>();
  public taskDocs = new Map<string, { id: string; data: any }>();
  public directDocIdRequested: string | null = null;
  public queryFieldsUsed: Array<{ collection: string; field: string; op: string; value: any }> = [];
  public createCount = 0;
  public updateCount = 0;

  constructor() {
    // Seed task in peiaReviewTasks with random doc ID distinct from taskId
    this.taskDocs.set('task-doc-123', {
      id: 'task-doc-123',
      data: {
        taskId: sampleTaskId,
        taskType: AITaskType.CONTENT_REVIEW,
        status: AITaskStatus.Pending,
        target: { targetType: 'News', targetId: 't1', sourceUpdatedAt: new Date().toISOString() },
        contentSnapshot: { title: 'T', body: 'B' },
        createdAt: new Date().toISOString(),
      },
    });
  }

  collection(collName: string) {
    const self = this;
    return {
      doc(docId: string) {
        self.directDocIdRequested = docId;
        return {
          id: docId,
        };
      },
      where(field: string, op: string, value: any) {
        self.queryFieldsUsed.push({ collection: collName, field, op, value });
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
          return { docs: matches };
        }
        // Outcome doc lookup
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
        self.docsMap.set(ref.id, data);
      },
      update(ref: any, data: any) {
        const taskObj = self.taskDocs.get(ref.id);
        if (taskObj) {
          self.updateCount++;
          taskObj.data = { ...taskObj.data, ...data };
        }
      },
    };
    return updateFn(tx);
  }
}

async function runTests() {
  const mockDb = new MockFirestoreTxDb();
  const repo = new FirestoreNonAdvisoryOutcomeRepository(mockDb as any);

  const record = {
    taskId: sampleTaskId,
    reconciledTask: mockDb.taskDocs.get('task-doc-123')!.data,
    principal: {
      principalId: 'p-1',
      isActive: true,
      capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
    },
    nonAdvisoryOutcome: {
      taskId: sampleTaskId,
      kind: 'ABSTAINED' as const,
      reason: 'NO_EVIDENCE',
      modelAttempts: 0,
      createdAt: new Date().toISOString(),
    },
    convergedStatus: AITaskStatus.Completed,
    convergedAt: new Date().toISOString(),
  };

  // 1. First store of ABSTAINED -> STORED + task Completed
  const res1 = await repo.saveWithTaskConvergence(record);
  assert(res1.disposition === 'STORED', '1. Initial save returns STORED disposition');
  const taskQuery = mockDb.queryFieldsUsed.find((q) => q.collection === PEIA_PENDING_TASK_COLLECTION);
  assert(taskQuery !== undefined, 'Task lookup used field query on PEIA_PENDING_TASK_COLLECTION');
  assert(taskQuery?.field === 'taskId' && taskQuery?.op === '==', 'Query checked taskId == sampleTaskId');
  assert(mockDb.docsMap.has(expectedHash), 'Outcome record stored at SHA-256(taskId) document ID');
  const updatedTask = mockDb.taskDocs.get('task-doc-123')!.data;
  assert(updatedTask.status === AITaskStatus.Completed, 'Matched task doc updated to Completed status');

  // 1. Existing identical + Completed ABSTAINED -> ALREADY_IDENTICAL
  const resIdenticalAbstained = await repo.saveWithTaskConvergence(record);
  assert(resIdenticalAbstained.disposition === 'ALREADY_IDENTICAL', '1. Existing identical + Completed ABSTAINED -> ALREADY_IDENTICAL');

  // 2. Existing identical + Failed MODEL_FAILURE -> ALREADY_IDENTICAL
  const modelFailTaskId = 'task-model-fail-1';
  const modelFailHash = createHash('sha256').update(modelFailTaskId, 'utf8').digest('hex');
  const modelDb = new MockFirestoreTxDb();
  modelDb.taskDocs.set('task-doc-model', {
    id: 'task-doc-model',
    data: {
      taskId: modelFailTaskId,
      taskType: AITaskType.CONTENT_REVIEW,
      status: AITaskStatus.Pending,
      target: { targetType: 'News', targetId: 't-mod', sourceUpdatedAt: new Date().toISOString() },
      contentSnapshot: { title: 'M', body: 'B' },
      createdAt: new Date().toISOString(),
    },
  });
  const modelRepo = new FirestoreNonAdvisoryOutcomeRepository(modelDb as any);
  const modelRecord = {
    taskId: modelFailTaskId,
    reconciledTask: modelDb.taskDocs.get('task-doc-model')!.data,
    principal: record.principal,
    nonAdvisoryOutcome: {
      taskId: modelFailTaskId,
      kind: 'MODEL_FAILURE' as const,
      reason: 'PROCESS_LAUNCH_FAILURE',
      modelAttempts: 1,
      createdAt: new Date().toISOString(),
    },
    convergedStatus: AITaskStatus.Failed,
    convergedAt: new Date().toISOString(),
  };
  const resModelStore = await modelRepo.saveWithTaskConvergence(modelRecord);
  assert(resModelStore.disposition === 'STORED', 'MODEL_FAILURE first store is STORED');
  assert(modelDb.taskDocs.get('task-doc-model')!.data.status === AITaskStatus.Failed, 'Task converged to Failed');
  const resModelReplay = await modelRepo.saveWithTaskConvergence(modelRecord);
  assert(resModelReplay.disposition === 'ALREADY_IDENTICAL', '2. Existing identical + Failed MODEL_FAILURE -> ALREADY_IDENTICAL');

  // 3. Existing identical + Pending task -> fail closed (TASK_STATUS_INCONSISTENT)
  const pendingInconsistentDb = new MockFirestoreTxDb();
  pendingInconsistentDb.docsMap.set(expectedHash, { ...record });
  pendingInconsistentDb.taskDocs.set('task-doc-123', {
    id: 'task-doc-123',
    data: {
      ...mockDb.taskDocs.get('task-doc-123')!.data,
      status: AITaskStatus.Pending, // Inconsistent: outcome exists but task is still Pending
    },
  });
  const pendingInconsistentRepo = new FirestoreNonAdvisoryOutcomeRepository(pendingInconsistentDb as any);
  try {
    await pendingInconsistentRepo.saveWithTaskConvergence(record);
    assert(false, 'Should have failed closed for existing identical + Pending task');
  } catch (err: any) {
    assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Expected NonAdvisoryOutcomeRepositoryError');
    assert(err.code === 'TASK_STATUS_INCONSISTENT', '3. Code is TASK_STATUS_INCONSISTENT');
  }

  // 4. Existing ABSTAINED + Failed task -> fail closed (TASK_STATUS_INCONSISTENT)
  const failedAbstainedDb = new MockFirestoreTxDb();
  failedAbstainedDb.docsMap.set(expectedHash, { ...record });
  failedAbstainedDb.taskDocs.set('task-doc-123', {
    id: 'task-doc-123',
    data: {
      ...mockDb.taskDocs.get('task-doc-123')!.data,
      status: AITaskStatus.Failed, // Inconsistent: ABSTAINED requires Completed, but task is Failed
    },
  });
  const failedAbstainedRepo = new FirestoreNonAdvisoryOutcomeRepository(failedAbstainedDb as any);
  try {
    await failedAbstainedRepo.saveWithTaskConvergence(record);
    assert(false, 'Should have failed closed for ABSTAINED + Failed task');
  } catch (err: any) {
    assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Expected NonAdvisoryOutcomeRepositoryError');
    assert(err.code === 'TASK_STATUS_INCONSISTENT', '4. Code is TASK_STATUS_INCONSISTENT');
  }

  // 5. Existing failure outcome + Completed task -> fail closed (TASK_STATUS_INCONSISTENT)
  const completedFailureDb = new MockFirestoreTxDb();
  completedFailureDb.docsMap.set(modelFailHash, { ...modelRecord });
  completedFailureDb.taskDocs.set('task-doc-model', {
    id: 'task-doc-model',
    data: {
      ...modelDb.taskDocs.get('task-doc-model')!.data,
      status: AITaskStatus.Completed, // Inconsistent: MODEL_FAILURE requires Failed, but task is Completed
    },
  });
  const completedFailureRepo = new FirestoreNonAdvisoryOutcomeRepository(completedFailureDb as any);
  try {
    await completedFailureRepo.saveWithTaskConvergence(modelRecord);
    assert(false, 'Should have failed closed for MODEL_FAILURE + Completed task');
  } catch (err: any) {
    assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Expected NonAdvisoryOutcomeRepositoryError');
    assert(err.code === 'TASK_STATUS_INCONSISTENT', '5. Code is TASK_STATUS_INCONSISTENT');
  }

  // 6. Existing identical + task missing -> TASK_NOT_FOUND
  const missingTaskDb = new MockFirestoreTxDb();
  missingTaskDb.docsMap.set(expectedHash, { ...record });
  missingTaskDb.taskDocs.clear(); // 0 tasks
  const missingTaskRepo = new FirestoreNonAdvisoryOutcomeRepository(missingTaskDb as any);
  try {
    await missingTaskRepo.saveWithTaskConvergence(record);
    assert(false, 'Should have thrown TASK_NOT_FOUND on replay when task missing');
  } catch (err: any) {
    assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Expected NonAdvisoryOutcomeRepositoryError');
    assert(err.code === 'TASK_NOT_FOUND', '6. Code is TASK_NOT_FOUND on replay');
  }

  // 7. Existing identical + 2 task matches -> TASK_QUERY_CARDINALITY_INVALID
  const multiMatchReplayDb = new MockFirestoreTxDb();
  multiMatchReplayDb.docsMap.set(expectedHash, { ...record });
  multiMatchReplayDb.taskDocs.set('t-doc-1', {
    id: 't-doc-1',
    data: { ...mockDb.taskDocs.get('task-doc-123')!.data },
  });
  multiMatchReplayDb.taskDocs.set('t-doc-2', {
    id: 't-doc-2',
    data: { ...mockDb.taskDocs.get('task-doc-123')!.data },
  });
  const multiMatchReplayRepo = new FirestoreNonAdvisoryOutcomeRepository(multiMatchReplayDb as any);
  try {
    await multiMatchReplayRepo.saveWithTaskConvergence(record);
    assert(false, 'Should have thrown TASK_QUERY_CARDINALITY_INVALID on replay with 2 tasks');
  } catch (err: any) {
    assert(err instanceof NonAdvisoryOutcomeRepositoryError, 'Expected NonAdvisoryOutcomeRepositoryError');
    assert(err.code === 'TASK_QUERY_CARDINALITY_INVALID', '7. Code is TASK_QUERY_CARDINALITY_INVALID on replay');
  }

  // 8. Existing identical + authoritative identity mismatch -> fail closed (TASK_IDENTITY_MISMATCH)
  const identityMismatchDb = new MockFirestoreTxDb();
  identityMismatchDb.docsMap.set(expectedHash, { ...record });
  identityMismatchDb.taskDocs.set('task-doc-123', {
    id: 'task-doc-123',
    data: {
      ...mockDb.taskDocs.get('task-doc-123')!.data,
      status: AITaskStatus.Completed,
      target: { targetType: 'News', targetId: 'divergent-target-id', sourceUpdatedAt: new Date().toISOString() },
    },
  });
  const identityMismatchRepo = new FirestoreNonAdvisoryOutcomeRepository(identityMismatchDb as any);
  try {
    await identityMismatchRepo.saveWithTaskConvergence(record);
    assert(false, 'Should have thrown TASK_IDENTITY_MISMATCH for target identity mismatch');
  } catch (err: any) {
    assert(err instanceof NonAdvisoryOutcomePersistenceError, 'Expected NonAdvisoryOutcomePersistenceError');
    assert(err.code === 'TASK_IDENTITY_MISMATCH', '8. Code is TASK_IDENTITY_MISMATCH on replay');
  }

  // 9. Valid replay performs zero writes
  mockDb.createCount = 0;
  mockDb.updateCount = 0;
  const replayZeroWriteRes = await repo.saveWithTaskConvergence(record);
  assert(replayZeroWriteRes.disposition === 'ALREADY_IDENTICAL', 'Replay succeeded');
  assert(mockDb.createCount === 0, '9. Replay executed ZERO create operations');
  assert(mockDb.updateCount === 0, '9. Replay executed ZERO update operations');

  // 10. Valid replay preserves convergedAt
  const originalConvergedAt = mockDb.docsMap.get(expectedHash).convergedAt;
  await repo.saveWithTaskConvergence(record);
  const afterReplayConvergedAt = mockDb.docsMap.get(expectedHash).convergedAt;
  assert(originalConvergedAt === afterReplayConvergedAt, '10. Original convergedAt preserved across replays');

  // 11. Concurrent identical simulation -> second resolves ALREADY_IDENTICAL after authoritative verification
  const concurrentSimDb = new MockFirestoreTxDb();
  const concurrentSimRepo = new FirestoreNonAdvisoryOutcomeRepository(concurrentSimDb as any);
  // Transaction A commits
  const resA = await concurrentSimRepo.saveWithTaskConvergence(record);
  assert(resA.disposition === 'STORED', '11. First concurrent call commits and returns STORED');
  // Transaction B executes after A
  const resB = await concurrentSimRepo.saveWithTaskConvergence(record);
  assert(resB.disposition === 'ALREADY_IDENTICAL', '11. Second concurrent call verifies authoritative task and returns ALREADY_IDENTICAL');

  // 12. Concurrent divergent simulation -> RESULT_CONFLICT
  const divergentRecord = {
    ...record,
    nonAdvisoryOutcome: {
      ...record.nonAdvisoryOutcome,
      reason: 'INSUFFICIENT_EVIDENCE',
    },
  };
  try {
    await concurrentSimRepo.saveWithTaskConvergence(divergentRecord);
    assert(false, 'Should have thrown RESULT_CONFLICT for divergent record');
  } catch (err: any) {
    assert(err instanceof NonAdvisoryOutcomePersistenceError, 'Expected NonAdvisoryOutcomePersistenceError');
    assert(err.code === 'RESULT_CONFLICT', '12. Code is RESULT_CONFLICT for concurrent divergent submission');
  }

  console.log('PASSED: All Firestore Non-Advisory Outcome Repository tests passed.');
}

runTests().catch((err) => {
  console.error('FAILED with error:', err);
  process.exit(1);
});
