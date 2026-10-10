import {
  persistNonAdvisoryOutcome,
  computeConvergedTaskStatus,
  isOutcomeEqual,
  NonAdvisoryOutcomePersistenceError,
  ReconciledNonAdvisoryOutcomePersistenceRecord,
} from '../functions/src/peia/nonAdvisoryOutcomePersistenceBoundary';
import { AITaskStatus, AITaskType, AIReviewTask } from '../functions/src/types/aiTask';
import { PEIAMachineCapability, VerifiedMachinePrincipal } from '../functions/src/peia/machineAuthorizationBoundary';
import { CanonicalNonAdvisoryOutcome } from '../functions/src/peia/nonAdvisoryOutcomeIntakeContract';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- Running PEIA Non-Advisory Outcome Persistence Boundary Tests ---');

const principal1: VerifiedMachinePrincipal = {
  principalId: 'p-1',
  isActive: true,
  capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
};

const principal2: VerifiedMachinePrincipal = {
  principalId: 'p-2',
  isActive: true,
  capabilities: [
    PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME,
    PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS,
  ],
};

const now = new Date().toISOString();

const task1: AIReviewTask = {
  taskId: 'task-pers-1',
  taskType: AITaskType.CONTENT_REVIEW,
  status: AITaskStatus.Pending,
  target: {
    targetType: 'News' as any,
    targetId: 'target-1',
    sourceUpdatedAt: now,
  },
  contentSnapshot: {
    title: 'Test Title',
    body: 'Test Body',
  },
  createdAt: now,
};

// 1. Test Status Mappings
assert(computeConvergedTaskStatus('ABSTAINED') === AITaskStatus.Completed, 'ABSTAINED -> Completed');
assert(computeConvergedTaskStatus('INPUT_FAILURE') === AITaskStatus.Failed, 'INPUT_FAILURE -> Failed');
assert(computeConvergedTaskStatus('RETRIEVAL_FAILURE') === AITaskStatus.Failed, 'RETRIEVAL_FAILURE -> Failed');
assert(computeConvergedTaskStatus('MODEL_FAILURE') === AITaskStatus.Failed, 'MODEL_FAILURE -> Failed');

// 2. Test sourceFailures Order-Independent Equality
const retrieval1: CanonicalNonAdvisoryOutcome = {
  taskId: 'task-pers-1',
  kind: 'RETRIEVAL_FAILURE',
  reason: 'TOTAL_RETRIEVAL_FAILURE',
  modelAttempts: 0,
  createdAt: now,
  sourceFailures: [
    { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
    { sourceId: 'NOAA', errorCode: 'INVALID_SOURCE_RESPONSE' },
  ],
};

const retrieval1Reversed: CanonicalNonAdvisoryOutcome = {
  taskId: 'task-pers-1',
  kind: 'RETRIEVAL_FAILURE',
  reason: 'TOTAL_RETRIEVAL_FAILURE',
  modelAttempts: 0,
  createdAt: now,
  sourceFailures: [
    { sourceId: 'NOAA', errorCode: 'INVALID_SOURCE_RESPONSE' },
    { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
  ],
};

assert(isOutcomeEqual(retrieval1, retrieval1Reversed), 'sourceFailures reversed order is outcome equal');

// 3. Test Persistence Repository Interactions and Replays
class MockRepo {
  public storedRecord: ReconciledNonAdvisoryOutcomePersistenceRecord | null = null;

  async findByTaskId(taskId: string) {
    if (this.storedRecord && this.storedRecord.taskId === taskId) {
      return this.storedRecord;
    }
    return null;
  }

  async saveWithTaskConvergence(record: ReconciledNonAdvisoryOutcomePersistenceRecord) {
    if (this.storedRecord) {
      if (this.storedRecord.taskId !== record.taskId) {
        throw new NonAdvisoryOutcomePersistenceError('TASK_IDENTITY_MISMATCH', 'TaskId mismatch.');
      }
      if (isOutcomeEqual(this.storedRecord.nonAdvisoryOutcome, record.nonAdvisoryOutcome)) {
        return { disposition: 'ALREADY_IDENTICAL' as const };
      }
      throw new NonAdvisoryOutcomePersistenceError('RESULT_CONFLICT', 'Divergent outcome for taskId.');
    }
    this.storedRecord = record;
    return { disposition: 'STORED' as const };
  }
}

async function runTests() {
  const repo = new MockRepo();

  // First submission
  const outcome1: CanonicalNonAdvisoryOutcome = {
    taskId: 'task-pers-1',
    kind: 'ABSTAINED',
    reason: 'NO_EVIDENCE',
    modelAttempts: 0,
    createdAt: now,
  };

  const res1 = await persistNonAdvisoryOutcome('task-pers-1', task1, principal1, outcome1, repo);
  assert(res1.disposition === 'STORED', 'First submission stored');
  assert(res1.convergedStatus === AITaskStatus.Completed, 'Status is Completed');
  assert(repo.storedRecord !== null, 'Record saved in repo');
  assert(repo.storedRecord?.reconciledTask.taskId === 'task-pers-1', 'Reconciled task snapshot saved');

  // Identical replay (same principal)
  const res2 = await persistNonAdvisoryOutcome('task-pers-1', task1, principal1, outcome1, repo);
  assert(res2.disposition === 'ALREADY_IDENTICAL', 'Identical replay returns ALREADY_IDENTICAL');

  // Identical replay (different authorized principal)
  const res3 = await persistNonAdvisoryOutcome('task-pers-1', task1, principal2, outcome1, repo);
  assert(res3.disposition === 'ALREADY_IDENTICAL', 'Identical replay from different principal returns ALREADY_IDENTICAL');

  // Divergent replay (different reason)
  const outcomeDivergentReason: CanonicalNonAdvisoryOutcome = {
    ...outcome1,
    reason: 'INSUFFICIENT_EVIDENCE',
  };

  // 4. Concurrent race test (findByTaskId returned null, but saveWithTaskConvergence converged)
  class ConcurrentMockRepo {
    public saveCalled = false;
    async findByTaskId() {
      return null; // Simulates race: pre-read executed before winning transaction committed
    }
    async saveWithTaskConvergence() {
      this.saveCalled = true;
      return { disposition: 'ALREADY_IDENTICAL' as const };
    }
  }

  const concurrentRepo = new ConcurrentMockRepo();
  const resConcurrent = await persistNonAdvisoryOutcome('task-pers-1', task1, principal1, outcome1, concurrentRepo as any);
  assert(resConcurrent.disposition === 'ALREADY_IDENTICAL', 'Concurrent replay passing pre-read returns ALREADY_IDENTICAL');
  assert(concurrentRepo.saveCalled === true, 'saveWithTaskConvergence was invoked and handled convergence');

  // Concurrent divergent race test (saveWithTaskConvergence throws RESULT_CONFLICT)
  class ConcurrentConflictRepo {
    async findByTaskId() {
      return null;
    }
    async saveWithTaskConvergence() {
      throw new NonAdvisoryOutcomePersistenceError('RESULT_CONFLICT', 'Divergent outcome for taskId.');
    }
  }

  const conflictRepo = new ConcurrentConflictRepo();
  try {
    await persistNonAdvisoryOutcome('task-pers-1', task1, principal1, outcomeDivergentReason, conflictRepo as any);
    assert(false, 'Expected RESULT_CONFLICT during concurrent race');
  } catch (err: any) {
    assert(err instanceof NonAdvisoryOutcomePersistenceError, 'Expected NonAdvisoryOutcomePersistenceError');
    assert(err.code === 'RESULT_CONFLICT', 'Code is RESULT_CONFLICT');
  }

  console.log('PASSED: All Non-Advisory Outcome Persistence Boundary tests passed.');
}

runTests().catch((err) => {
  console.error('FAILED with error:', err);
  process.exit(1);
});
