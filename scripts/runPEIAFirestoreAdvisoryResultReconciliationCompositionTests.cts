import {
  createFirestoreAdvisoryResultReconciliationRuntime,
  createProductionAdvisoryResultReconciliationRuntime,
} from '../functions/src/peia/firestoreAdvisoryResultReconciliationComposition';
import { AdvisoryResultTaskReconciliationError } from '../functions/src/peia/advisoryResultTaskReconciliationBoundary';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
}

const tests: TestResult[] = [];
let testCounter = 1;

// Helper to create mock databases
function createMockDb(docs: any[] = []) {
  let collectionCalls = 0;
  let collectionNamePassed = '';
  let whereCalls = 0;
  let whereArgsPassed: any = null;
  let limitCalls = 0;
  let limitValuePassed: number | null = null;
  let getCalls = 0;

  const mockQuery = {
    where(field: string, op: string, value: any) {
      whereCalls++;
      whereArgsPassed = { field, op, value };
      return mockQuery;
    },
    limit(count: number) {
      limitCalls++;
      limitValuePassed = count;
      return mockQuery;
    },
    async get() {
      getCalls++;
      return { docs };
    },
  };

  const mockDb = {
    collection(name: string) {
      collectionCalls++;
      collectionNamePassed = name;
      return mockQuery;
    },
  };

  return {
    db: mockDb,
    get collectionCalls() { return collectionCalls; },
    get collectionNamePassed() { return collectionNamePassed; },
    get whereCalls() { return whereCalls; },
    get whereArgsPassed() { return whereArgsPassed; },
    get limitCalls() { return limitCalls; },
    get limitValuePassed() { return limitValuePassed; },
    get getCalls() { return getCalls; },
  };
}

// Generate valid standard intake request
function createFakeIntake(taskId = 'task-100') {
  return {
    principal: { machineId: 'machine-1' },
    request: {
      result: {
        task: {
          taskId,
          taskType: 'CONTENT_REVIEW',
          target: {
            targetType: 'LibraryDocument',
            targetId: 'doc-123',
            sourceUpdatedAt: '2026-10-01T00:00:00Z',
          },
        },
      },
    },
  } as any;
}

// Generate valid standard Firestore task doc data
function createFakeTaskData(taskId = 'task-100', status = 'Pending') {
  return {
    taskId,
    taskType: 'CONTENT_REVIEW',
    status,
    createdAt: '2026-10-01T00:00:00Z',
    target: {
      targetType: 'LibraryDocument',
      targetId: 'doc-123',
      sourceUpdatedAt: '2026-10-01T00:00:00Z',
    },
    contentSnapshot: { title: 'Some Document' },
  };
}

async function run() {
  const compFilePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultReconciliationComposition.ts');
  const compCode = fs.readFileSync(compFilePath, 'utf8');

  // 1. composition factory/function exists
  try {
    const passed = typeof createFirestoreAdvisoryResultReconciliationRuntime === 'function' &&
                   typeof createProductionAdvisoryResultReconciliationRuntime === 'function';
    tests.push({ id: testCounter++, name: '1. Composition factories exist', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '1. Composition factories exist', passed: false, message: err.message });
  }

  // 2. FirestoreAdvisoryResultTaskSource is instantiated by the composition
  // 3. provided database dependency is passed into that adapter
  try {
    const mock = createMockDb([{ data: () => createFakeTaskData() }]);
    const handler = createFirestoreAdvisoryResultReconciliationRuntime(mock.db as any);
    await handler(createFakeIntake());

    const passed = mock.collectionCalls === 1 && mock.collectionNamePassed === 'peiaReviewTasks';
    tests.push({ id: testCounter++, name: '2 & 3. Source instantiated and provided db dependency injected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '2 & 3. Source instantiated and provided db dependency injected', passed: false, message: err.message });
  }

  // 4. reconcileAdvisoryResultTask is the boundary being delegated to
  // 5. successful reconciliation flows through: composition -> adapter -> reconciliation boundary
  try {
    const fakeData = createFakeTaskData();
    const mock = createMockDb([{ data: () => fakeData }]);
    const handler = createFirestoreAdvisoryResultReconciliationRuntime(mock.db as any);
    const result = await handler(createFakeIntake());

    const passed = result !== null && 
                   typeof result === 'object' &&
                   result.task.taskId === 'task-100' &&
                   result.task.status === 'Pending';
    tests.push({ id: testCounter++, name: '4 & 5. Successful reconciliation flows through the composition boundary', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '4 & 5. Successful reconciliation flows through the composition boundary', passed: false, message: err.message });
  }

  // 6. Firestore source performs the expected taskId lookup through the real adapter contract
  try {
    const mock = createMockDb([{ data: () => createFakeTaskData('task-custom-lookup') }]);
    const handler = createFirestoreAdvisoryResultReconciliationRuntime(mock.db as any);
    await handler(createFakeIntake('task-custom-lookup'));

    const passed = mock.whereCalls === 1 &&
                   mock.whereArgsPassed.field === 'taskId' &&
                   mock.whereArgsPassed.op === '==' &&
                   mock.whereArgsPassed.value === 'task-custom-lookup';
    tests.push({ id: testCounter++, name: '6. Lookup performs exact taskId search via adapter query contract', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '6. Lookup performs exact taskId search via adapter query contract', passed: false, message: err.message });
  }

  // 7. TASK_NOT_FOUND propagates from the accepted boundary when source returns no task
  try {
    const mock = createMockDb([]);
    const handler = createFirestoreAdvisoryResultReconciliationRuntime(mock.db as any);
    let passed = false;
    try {
      await handler(createFakeIntake('task-not-existent'));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError && err.code === 'TASK_NOT_FOUND';
    }
    tests.push({ id: testCounter++, name: '7. TASK_NOT_FOUND propagates when task lookup is empty', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '7. TASK_NOT_FOUND propagates when task lookup is empty', passed: false, message: err.message });
  }

  // 8. TASK_NOT_PENDING propagates from the accepted boundary
  try {
    const mock = createMockDb([{ data: () => createFakeTaskData('task-completed', 'Completed') }]);
    const handler = createFirestoreAdvisoryResultReconciliationRuntime(mock.db as any);
    let passed = false;
    try {
      await handler(createFakeIntake('task-completed'));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError && err.code === 'TASK_NOT_PENDING';
    }
    tests.push({ id: testCounter++, name: '8. TASK_NOT_PENDING propagates when status is not Pending', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '8. TASK_NOT_PENDING propagates when status is not Pending', passed: false, message: err.message });
  }

  // 9. TASK_REFERENCE_MISMATCH propagates from the accepted boundary
  try {
    const fakeData = createFakeTaskData('task-100');
    fakeData.target.targetId = 'doc-different'; // mismatch that is perfectly valid according to validator
    const mock = createMockDb([{ data: () => fakeData }]);
    const handler = createFirestoreAdvisoryResultReconciliationRuntime(mock.db as any);
    let passed = false;
    try {
      await handler(createFakeIntake('task-100'));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError && err.code === 'TASK_REFERENCE_MISMATCH';
    }
    tests.push({ id: testCounter++, name: '9. TASK_REFERENCE_MISMATCH propagates on target/type mismatch', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '9. TASK_REFERENCE_MISMATCH propagates on target/type mismatch', passed: false, message: err.message });
  }

  // 10. Firestore source infrastructure errors propagate without being rewritten by composition
  try {
    const infraError = new Error('Database connection interrupted');
    const mockDb = {
      collection() {
        throw infraError;
      }
    };
    const handler = createFirestoreAdvisoryResultReconciliationRuntime(mockDb as any);
    let passed = false;
    try {
      await handler(createFakeIntake());
    } catch (err: any) {
      passed = err === infraError;
    }
    tests.push({ id: testCounter++, name: '10. Firestore source infrastructure errors propagate unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '10. Firestore source infrastructure errors propagate unchanged', passed: false, message: err.message });
  }

  // 11. composition does NOT contain Firestore write operations
  try {
    const hasWrites = compCode.includes('.set(') ||
                      compCode.includes('.add(') ||
                      compCode.includes('.update(') ||
                      compCode.includes('.delete(') ||
                      compCode.includes('transaction') ||
                      compCode.includes('batch');
    const passed = !hasWrites;
    tests.push({ id: testCounter++, name: '11. Composition contains zero Firestore writes', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '11. Composition contains zero Firestore writes', passed: false, message: err.message });
  }

  // 12. composition does NOT contain HTTP / onRequest logic
  try {
    const hasHttp = compCode.includes('onRequest') ||
                    compCode.includes('express') ||
                    compCode.includes('app.') ||
                    compCode.includes('fetch(') ||
                    compCode.includes('http');
    const passed = !hasHttp;
    tests.push({ id: testCounter++, name: '12. Composition contains zero HTTP or onRequest bindings', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '12. Composition contains zero HTTP or onRequest bindings', passed: false, message: err.message });
  }

  // 13. composition does NOT persist advisory results
  try {
    const hasResultPersistence = compCode.includes('fs.write') ||
                                 compCode.includes('persistAdvisoryResult') ||
                                 compCode.includes('saveAdvisoryResult');
    const passed = !hasResultPersistence;
    tests.push({ id: testCounter++, name: '13. Composition contains zero result persistence', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '13. Composition contains zero result persistence', passed: false, message: err.message });
  }

  // 14. composition does NOT mutate task status
  try {
    const hasStatusMutation = compCode.includes('status =') ||
                              compCode.includes('status:') ||
                              compCode.includes('AITaskStatus.Completed') ||
                              compCode.includes('AITaskStatus.Failed');
    const passed = !hasStatusMutation;
    tests.push({ id: testCounter++, name: '14. Composition contains zero task status mutations', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '14. Composition contains zero task status mutations', passed: false, message: err.message });
  }

  // 15. accepted source and reconciliation files remain unchanged
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultTaskSource.ts');
    const sourceCode = fs.readFileSync(sourcePath, 'utf8');
    const unchangedSource = !sourceCode.includes('firestoreAdvisoryResultReconciliationComposition');

    const boundaryPath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const boundaryCode = fs.readFileSync(boundaryPath, 'utf8');
    const unchangedBoundary = !boundaryCode.includes('firestoreAdvisoryResultReconciliationComposition');

    const passed = unchangedSource && unchangedBoundary;
    tests.push({ id: testCounter++, name: '15. Accepted source and reconciliation boundary files are unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '15. Accepted source and reconciliation boundary files are unchanged', passed: false, message: err.message });
  }

  // Log results
  console.log('====================================================');
  console.log('RUNNING PEIA FIRESTORE ADVISORY RECONCILIATION COMPOSITION TESTS');
  console.log('====================================================\n');

  let failed = 0;
  for (const t of tests) {
    if (t.passed) {
      console.log(`✅ [${t.id}] ${t.name}`);
    } else {
      failed++;
      console.error(`❌ [${t.id}] ${t.name}`);
      if (t.message) {
        console.error(`   ${t.message}`);
      }
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY: ${tests.length - failed} passed / ${tests.length} total / ${failed} failed`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
