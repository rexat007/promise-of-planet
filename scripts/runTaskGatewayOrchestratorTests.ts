import { executePendingTaskGatewayRequest } from '../functions/src/peia/taskGatewayOrchestrator';
import { MachineIdentityVerifier, PEIAMachineCapability, MachineAuthorizationError } from '../functions/src/peia/machineAuthorizationBoundary';
import { TaskGatewayContractError } from '../functions/src/peia/taskGatewayContract';
import { ValidationError } from '../functions/src/peia/aiTaskValidator';
import { TaskDeliveryError } from '../functions/src/peia/aiTaskDeliveryBoundary';
import { AITaskType, AITaskStatus } from '../src/types/aiTask';
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
    taskId: 'task-9999',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: 'News',
      targetId: 'news-777',
      sourceUpdatedAt: '2026-09-26T04:00:00Z',
    },
    contentSnapshot: {
      title: 'Decarbonizing Steel',
    },
    createdAt: '2026-09-26T04:05:00Z',
    status: AITaskStatus.Pending,
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
  public verifyCalled = false;

  constructor(
    private readonly mockPrincipal: { principalId: string; isActive: boolean; capabilities: readonly PEIAMachineCapability[] } | null,
    private readonly shouldThrow: boolean = false
  ) {}

  async verify(input: unknown): Promise<any> {
    this.verifyCalled = true;
    if (this.shouldThrow) {
      throw new Error('Database disconnected');
    }
    if (input === 'valid-secret-token') {
      return this.mockPrincipal;
    }
    return null;
  }
}

async function run() {
  const activePrincipal = {
    principalId: 'node-omega',
    isActive: true,
    capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS] as const,
  };

  // 1. Valid outer request + authorized machine + Pending task succeeds
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload(),
    };
    const res = await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    tests.push({
      id: testCounter++,
      name: '1. Valid outer request + authorized machine + Pending task succeeds',
      passed: res.principalId === 'node-omega' && res.task.taskId === 'task-9999',
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '1. Valid outer request + authorized machine + Pending task succeeds',
      passed: false,
      message: err.message,
    });
  }

  // 2. Success response contains only principalId and task
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload(),
    };
    const res = await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    const extraKeys = Object.keys(res).filter(k => k !== 'principalId' && k !== 'task');
    tests.push({
      id: testCounter++,
      name: '2. Success response contains only principalId and task',
      passed: extraKeys.length === 0,
      message: extraKeys.length > 0 ? `Extra keys found: ${extraKeys.join(', ')}` : undefined,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '2. Success response contains only principalId and task',
      passed: false,
    });
  }

  // 3. Invalid outer request fails with TaskGatewayContractError
  try {
    await executePendingTaskGatewayRequest(null, new FakeVerifier(activePrincipal));
    tests.push({
      id: testCounter++,
      name: '3. Invalid outer request fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof TaskGatewayContractError && err.code === 'INVALID_GATEWAY_REQUEST';
    tests.push({
      id: testCounter++,
      name: '3. Invalid outer request fails with TaskGatewayContractError',
      passed: matched,
    });
  }

  // 4. Unknown outer field fails before machine verification is used
  const verifier4 = new FakeVerifier(activePrincipal);
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload(),
      extraUnsupported: 'nonsense',
    };
    await executePendingTaskGatewayRequest(input, verifier4);
    tests.push({
      id: testCounter++,
      name: '4. Unknown outer field fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof TaskGatewayContractError &&
                    err.code === 'UNKNOWN_GATEWAY_FIELD' &&
                    !verifier4.verifyCalled;
    tests.push({
      id: testCounter++,
      name: '4. Unknown outer field fails before machine verification is used',
      passed: matched,
    });
  }

  // 5. Prohibited outer field fails before machine verification is used
  const verifier5 = new FakeVerifier(activePrincipal);
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload(),
      principalId: 'hack-attempt',
    };
    await executePendingTaskGatewayRequest(input, verifier5);
    tests.push({
      id: testCounter++,
      name: '5. Prohibited outer field fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof TaskGatewayContractError &&
                    err.code === 'PROHIBITED_GATEWAY_FIELD' &&
                    !verifier5.verifyCalled;
    tests.push({
      id: testCounter++,
      name: '5. Prohibited outer field fails before machine verification is used',
      passed: matched,
    });
  }

  // 6. Valid outer request + unauthorized credential fails with MachineAuthorizationError
  try {
    const input = {
      credential: 'invalid-secret-token',
      task: createValidTaskPayload(),
    };
    await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    tests.push({
      id: testCounter++,
      name: '6. Unauthorized credential fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '6. Valid outer request + unauthorized credential fails with MachineAuthorizationError',
      passed: matched,
    });
  }

  // 7. Valid outer request + inactive machine fails with MachineAuthorizationError
  try {
    const inactivePrincipal = { ...activePrincipal, isActive: false };
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload(),
    };
    await executePendingTaskGatewayRequest(input, new FakeVerifier(inactivePrincipal));
    tests.push({
      id: testCounter++,
      name: '7. Inactive machine fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_INACTIVE';
    tests.push({
      id: testCounter++,
      name: '7. Valid outer request + inactive machine fails with MachineAuthorizationError',
      passed: matched,
    });
  }

  // 8. Valid outer request + missing capability fails with MachineAuthorizationError
  try {
    const missingCapPrincipal = { ...activePrincipal, capabilities: [] };
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload(),
    };
    await executePendingTaskGatewayRequest(input, new FakeVerifier(missingCapPrincipal));
    tests.push({
      id: testCounter++,
      name: '8. Missing capability fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_CAPABILITY_DENIED';
    tests.push({
      id: testCounter++,
      name: '8. Valid outer request + missing capability fails with MachineAuthorizationError',
      passed: matched,
    });
  }

  // 9. Valid outer request + valid machine + malformed task fails with ValidationError
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload({ taskId: '   ' }),
    };
    await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    tests.push({
      id: testCounter++,
      name: '9. Malformed task fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof ValidationError && err.code === 'INVALID_TASK_ID';
    tests.push({
      id: testCounter++,
      name: '9. Valid outer request + valid machine + malformed task fails with ValidationError',
      passed: matched,
    });
  }

  // 10. Valid outer request + valid machine + Completed task fails with TaskDeliveryError
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload({ status: 'Completed' }),
    };
    await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    tests.push({
      id: testCounter++,
      name: '10. Completed task fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof TaskDeliveryError && err.code === 'TASK_NOT_DELIVERABLE';
    tests.push({
      id: testCounter++,
      name: '10. Valid outer request + valid machine + Completed task fails with TaskDeliveryError',
      passed: matched,
    });
  }

  // 11. Valid outer request + valid machine + Failed task fails with TaskDeliveryError
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload({ status: 'Failed' }),
    };
    await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    tests.push({
      id: testCounter++,
      name: '11. Failed task fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof TaskDeliveryError && err.code === 'TASK_NOT_DELIVERABLE';
    tests.push({
      id: testCounter++,
      name: '11. Valid outer request + valid machine + Failed task fails with TaskDeliveryError',
      passed: matched,
    });
  }

  // 12. Malformed task is NOT processed before failed machine authorization
  try {
    const input = {
      credential: 'invalid-secret-token',
      task: { completelyMalformed: true },
    };
    await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    tests.push({
      id: testCounter++,
      name: '12. Security order mismatch',
      passed: false,
    });
  } catch (err: any) {
    // Must trigger MachineAuthorizationError because verifier is run and fails before task validation is evaluated.
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '12. Malformed task is NOT processed before failed machine authorization',
      passed: matched,
    });
  }

  // 13. Outer request validation occurs before machine authorization
  const verifier13 = new FakeVerifier(activePrincipal);
  try {
    const input = {
      credential: 'invalid-secret-token',
      task: createValidTaskPayload(),
      unauthorizedExtraneousKey: 'yes',
    };
    await executePendingTaskGatewayRequest(input, verifier13);
    tests.push({
      id: testCounter++,
      name: '13. Request validator order fails',
      passed: false,
    });
  } catch (err: any) {
    // Must trigger TaskGatewayContractError because outer request validation is executed before machine authorization.
    const matched = err instanceof TaskGatewayContractError &&
                    err.code === 'UNKNOWN_GATEWAY_FIELD' &&
                    !verifier13.verifyCalled;
    tests.push({
      id: testCounter++,
      name: '13. Outer request validation occurs before machine authorization',
      passed: matched,
    });
  }

  // 14. Success adapter does not expose isActive/capabilities/credential
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload(),
    };
    const res = await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    const clean = !('isActive' in res) && !('capabilities' in res) && !('credential' in res);
    tests.push({
      id: testCounter++,
      name: '14. Success adapter does not leak internal principal information',
      passed: clean,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '14. Success adapter does not leak internal principal information',
      passed: false,
    });
  }

  // 15. Task remains unchanged through successful orchestration
  try {
    const task = createValidTaskPayload();
    const input = {
      credential: 'valid-secret-token',
      task,
    };
    const res = await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    const unchanged = JSON.stringify(res.task) === JSON.stringify(task);
    tests.push({
      id: testCounter++,
      name: '15. Task remains completely unchanged through successful orchestration',
      passed: unchanged,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '15. Task remains completely unchanged through successful orchestration',
      passed: false,
    });
  }

  // 16. principalId is not injected into AIReviewTask
  try {
    const input = {
      credential: 'valid-secret-token',
      task: createValidTaskPayload(),
    };
    const res = await executePendingTaskGatewayRequest(input, new FakeVerifier(activePrincipal));
    const notLeaked = !('principalId' in res.task) && !('workerId' in res.task);
    tests.push({
      id: testCounter++,
      name: '16. principalId is not injected into AIReviewTask object',
      passed: notLeaked,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '16. principalId is not injected into AIReviewTask object',
      passed: false,
    });
  }

  // 17. No duplicate gateway validation rules exist in orchestrator
  const prodFilePath = path.join(process.cwd(), 'functions/src/peia/taskGatewayOrchestrator.ts');
  const code = fs.readFileSync(prodFilePath, 'utf8');
  const cleanOrchValidation = !code.includes('prohibitedFields') && !code.includes('acceptedKeys') && !code.includes('isPlainObject');
  tests.push({
    id: testCounter++,
    name: '17. No duplicate gateway validation rules exist in orchestrator',
    passed: cleanOrchValidation,
  });

  // 18. No duplicate machine authorization rules exist in orchestrator
  const cleanOrchAuth = !code.includes('isActive') && !code.includes('capabilities') && !code.includes('FETCH_PENDING_REVIEW_TASKS');
  tests.push({
    id: testCounter++,
    name: '18. No duplicate machine authorization rules exist in orchestrator',
    passed: cleanOrchAuth,
  });

  // 19. No duplicate task validation rules exist in orchestrator
  // Ensure the orchestrator code doesn't directly inspect task properties or hardcode statuses
  const cleanOrchTaskRules = !code.includes('taskId') && 
                             !code.includes('taskType') && 
                             !code.includes('contentSnapshot') && 
                             !code.includes("status === 'Pending'") && 
                             !code.includes('status === "Pending"') &&
                             !code.includes("status !== 'Pending'") &&
                             !code.includes('status !== "Pending"');
  tests.push({
    id: testCounter++,
    name: '19. No duplicate task validation rules exist in orchestrator',
    passed: cleanOrchTaskRules,
  });

  // 20. No Firebase/HTTP imports exist in production orchestrator
  const cleanOrchImports = !code.includes('firebase-functions') && !code.includes('express') && !code.includes('HttpsError');
  tests.push({
    id: testCounter++,
    name: '20. No Firebase/HTTP imports exist in production orchestrator',
    passed: cleanOrchImports,
  });

  // 21. functions/src/index.ts remains untouched
  const indexPath = path.join(process.cwd(), 'functions/src/index.ts');
  const indexCode = fs.readFileSync(indexPath, 'utf8');
  const cleanIndex = !indexCode.includes('taskGatewayOrchestrator') && !indexCode.includes('executePendingTaskGatewayRequest');
  tests.push({
    id: testCounter++,
    name: '21. functions/src/index.ts remains untouched',
    passed: cleanIndex,
  });

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA-16F TASK GATEWAY ORCHESTRATOR TESTS');
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
