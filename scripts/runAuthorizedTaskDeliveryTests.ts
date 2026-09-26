import { authorizeAndPreparePendingTaskDelivery } from '../functions/src/peia/authorizedTaskDeliveryBoundary';
import { MachineAuthorizationError, PEIAMachineCapability, VerifiedMachinePrincipal, MachineIdentityVerifier } from '../functions/src/peia/machineAuthorizationBoundary';
import { ValidationError } from '../functions/src/peia/aiTaskValidator';
import { TaskDeliveryError } from '../functions/src/peia/aiTaskDeliveryBoundary';
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

function createValidTaskPayload(overrides: Record<string, any> = {}): Record<string, any> {
  const base = {
    taskId: 'task-8888',
    taskType: 'CONTENT_REVIEW',
    target: {
      targetType: 'News',
      targetId: 'news-900',
      sourceUpdatedAt: '2026-09-26T03:00:00Z',
    },
    contentSnapshot: {
      title: 'Solar Inventions 2026',
    },
    createdAt: '2026-09-26T03:30:00Z',
    status: 'Pending',
  };

  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete (result as any)[key];
    } else {
      (result as any)[key] = value;
    }
  }
  return result;
}

class FakeVerifier implements MachineIdentityVerifier {
  constructor(private readonly mockPrincipal: VerifiedMachinePrincipal | null) {}

  async verify(input: unknown): Promise<VerifiedMachinePrincipal | null> {
    if (input === 'valid-worker-token') {
      return this.mockPrincipal;
    }
    return null;
  }
}

async function run() {
  const activePrincipal: VerifiedMachinePrincipal = {
    principalId: 'node-x',
    isActive: true,
    capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
  };

  // 1. Authorized active machine + valid Pending task succeeds
  try {
    const res = await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      createValidTaskPayload(),
      new FakeVerifier(activePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '1. Authorized active machine + valid Pending task succeeds',
      passed: res.principal.principalId === 'node-x' && res.task.taskId === 'task-8888',
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '1. Authorized active machine + valid Pending task succeeds',
      passed: false,
      message: err.message,
    });
  }

  // 2. Returned result preserves: principal, task
  try {
    const res = await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      createValidTaskPayload(),
      new FakeVerifier(activePrincipal)
    );
    const preserves = res.principal !== undefined && res.task !== undefined &&
                      res.principal.principalId === 'node-x' &&
                      res.task.taskId === 'task-8888';
    tests.push({
      id: testCounter++,
      name: '2. Returned result preserves principal and task',
      passed: preserves,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '2. Returned result preserves principal and task',
      passed: false,
    });
  }

  // 3. Unauthorized credential fails with MachineAuthorizationError
  try {
    await authorizeAndPreparePendingTaskDelivery(
      'unauthorized-token',
      createValidTaskPayload(),
      new FakeVerifier(activePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '3. Unauthorized credential fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '3. Unauthorized credential fails with MachineAuthorizationError',
      passed: matched,
    });
  }

  // 4. Inactive principal fails with MachineAuthorizationError
  try {
    const inactivePrincipal = { ...activePrincipal, isActive: false };
    await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      createValidTaskPayload(),
      new FakeVerifier(inactivePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '4. Inactive principal fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_INACTIVE';
    tests.push({
      id: testCounter++,
      name: '4. Inactive principal fails with MachineAuthorizationError',
      passed: matched,
    });
  }

  // 5. Missing capability fails with MachineAuthorizationError
  try {
    const missingCapPrincipal = { ...activePrincipal, capabilities: [] };
    await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      createValidTaskPayload(),
      new FakeVerifier(missingCapPrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '5. Missing capability fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_CAPABILITY_DENIED';
    tests.push({
      id: testCounter++,
      name: '5. Missing capability fails with MachineAuthorizationError',
      passed: matched,
    });
  }

  // 6. Valid machine + malformed task fails with ValidationError
  try {
    await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      createValidTaskPayload({ taskId: '   ' }),
      new FakeVerifier(activePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '6. Malformed task fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof ValidationError && err.code === 'INVALID_TASK_ID';
    tests.push({
      id: testCounter++,
      name: '6. Valid machine + malformed task fails with ValidationError',
      passed: matched,
    });
  }

  // 7. Valid machine + Completed task fails with TaskDeliveryError
  try {
    await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      createValidTaskPayload({ status: 'Completed' }),
      new FakeVerifier(activePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '7. Completed task fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof TaskDeliveryError && err.code === 'TASK_NOT_DELIVERABLE';
    tests.push({
      id: testCounter++,
      name: '7. Valid machine + Completed task fails with TaskDeliveryError',
      passed: matched,
    });
  }

  // 8. Valid machine + Failed task fails with TaskDeliveryError
  try {
    await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      createValidTaskPayload({ status: 'Failed' }),
      new FakeVerifier(activePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '8. Failed task fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof TaskDeliveryError && err.code === 'TASK_NOT_DELIVERABLE';
    tests.push({
      id: testCounter++,
      name: '8. Valid machine + Failed task fails with TaskDeliveryError',
      passed: matched,
    });
  }

  // 9. Security Ordering: Authorization failure occurs before task processing
  try {
    // Supplying invalid credentials and completely toxic task payload
    // If it validates task payload first, it will fail with ValidationError.
    // If it evaluates authorization first, it must fail with MachineAuthorizationError.
    await authorizeAndPreparePendingTaskDelivery(
      'invalid-worker-token',
      { completelyInvalidPayload: true },
      new FakeVerifier(activePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '9. Security ordering test fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '9. Security ordering: Authorization failure occurs before task processing',
      passed: matched,
      message: matched ? undefined : `Expected MachineAuthorizationError, got: ${err.message}`,
    });
  }

  // 10. Human role claim in credential input does not bypass verifier
  try {
    const inputWithRole = { token: 'unauthorized', role: 'AIAssistant' };
    await authorizeAndPreparePendingTaskDelivery(
      inputWithRole,
      createValidTaskPayload(),
      new FakeVerifier(null)
    );
    tests.push({
      id: testCounter++,
      name: '10. Role claim bypass fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '10. Human role claim in credential input does not bypass verifier',
      passed: matched,
    });
  }

  // 11. Task cannot inject workerId or auth field
  try {
    const poisonedTask = createValidTaskPayload({ workerId: 'fake-id' });
    await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      poisonedTask,
      new FakeVerifier(activePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '11. Task cannot inject workerId fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof ValidationError && err.code === 'PROHIBITED_TASK_FIELD';
    tests.push({
      id: testCounter++,
      name: '11. Task cannot inject workerId or auth field (prevented by underlying validator)',
      passed: matched,
    });
  }

  // 12. Composition does not mutate task status
  try {
    const task = createValidTaskPayload();
    const res = await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      task,
      new FakeVerifier(activePrincipal)
    );
    tests.push({
      id: testCounter++,
      name: '12. Composition does not mutate task status',
      passed: res.task.status === 'Pending' && task.status === 'Pending',
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '12. Composition does not mutate task status',
      passed: false,
    });
  }

  // 13. principalId is NOT copied into AIReviewTask
  try {
    const res = await authorizeAndPreparePendingTaskDelivery(
      'valid-worker-token',
      createValidTaskPayload(),
      new FakeVerifier(activePrincipal)
    );
    const hasPrincipalId = 'principalId' in res.task || 'workerId' in res.task;
    tests.push({
      id: testCounter++,
      name: '13. principalId is NOT copied into AIReviewTask',
      passed: !hasPrincipalId,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '13. principalId is NOT copied into AIReviewTask',
      passed: false,
    });
  }

  // 14. No AdminRole/AdminPermission import appears in production composition file
  const prodFilePath = path.join(process.cwd(), 'functions/src/peia/authorizedTaskDeliveryBoundary.ts');
  const code = fs.readFileSync(prodFilePath, 'utf8');
  const cleanOfHumanRBAC = !code.includes('AdminRole') && !code.includes('AdminPermission') && !code.includes('adminContract');
  tests.push({
    id: testCounter++,
    name: '14. No AdminRole/AdminPermission import appears in production composition file',
    passed: cleanOfHumanRBAC,
  });

  // 15. No endpoint/index modification exists
  const indexPath = path.join(process.cwd(), 'functions/src/index.ts');
  const indexCode = fs.readFileSync(indexPath, 'utf8');
  const cleanIndex = !indexCode.includes('authorizedTaskDeliveryBoundary') && !indexCode.includes('authorizeAndPreparePendingTaskDelivery');
  tests.push({
    id: testCounter++,
    name: '15. No endpoint or modification exists in functions/src/index.ts',
    passed: cleanIndex,
  });

  // 16. No duplicate validator/auth rules exist in composition file
  const cleanCompositionRules = !code.includes('isActive') && !code.includes('taskId') && !code.includes('taskType') && !code.includes('contentSnapshot');
  tests.push({
    id: testCounter++,
    name: '16. No duplicate validator or authorization rules exist in composition file',
    passed: cleanCompositionRules,
  });

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA-16D AUTHORIZED COMPOSITION BOUNDARY TESTS');
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
