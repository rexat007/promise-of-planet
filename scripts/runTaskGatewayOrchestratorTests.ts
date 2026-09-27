import * as fs from 'fs';
import * as path from 'path';
import { executePendingTaskGatewayRequest } from '../functions/src/peia/taskGatewayOrchestrator';
import { PEIAMachineCapability, MachineAuthorizationError } from '../functions/src/peia/machineAuthorizationBoundary';
import { TaskGatewayContractError } from '../functions/src/peia/taskGatewayContract';
import { AITaskStatus } from '../functions/src/types/aiTask';

const tests: (() => Promise<void>)[] = [];

function registerTest(name: string, fn: () => Promise<void>) {
  tests.push(async () => {
    try {
      await fn();
      console.log(`✅ [${tests.indexOf(fn) + 1}] ${name}`);
    } catch (err: any) {
      console.error(`❌ [${tests.indexOf(fn) + 1}] ${name}`);
      console.error(`   ${err.message}`);
      throw err;
    }
  });
}

// Recording Fake Verifier
class FakeVerifier {
  callCount = 0;
  lastInput: any = null;
  result: any = null;
  error: Error | null = null;

  async verify(input: any) {
    this.callCount++;
    this.lastInput = input;
    if (this.error) throw this.error;
    return this.result;
  }
}

// Recording Fake Source
class FakeSource {
  callCount = 0;
  result: any = null;
  error: Error | null = null;
  order: string[] = [];

  constructor(private verifier: FakeVerifier) {}

  async fetchNextPendingTask() {
    this.callCount++;
    this.order.push('source');
    if (this.error) throw this.error;
    return this.result;
  }

  recordAuth() {
    this.order.push('auth');
  }
}

const mockPrincipal = {
  principalId: 'machine-123',
  isActive: true,
  capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS]
};

const mockTask = {
  taskId: 'task-456',
  taskType: 'CONTENT_REVIEW',
  target: {
    targetType: 'CitizenSubmission',
    targetId: 'sub-789',
    sourceUpdatedAt: '2026-09-27T00:00:00Z',
  },
  contentSnapshot: { text: 'hello' },
  createdAt: '2026-09-27T00:00:00Z',
  status: AITaskStatus.Pending
};

// 1. valid credential-only request + valid source task succeeds
registerTest('1. valid credential-only request + valid source task succeeds', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = mockTask;

  const response = await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if (response.task?.taskId !== mockTask.taskId) throw new Error('Task not delivered');
});

// 2. response principalId comes from verified principal
registerTest('2. response principalId comes from verified principal', async () => {
  const verifier = new FakeVerifier();
  verifier.result = { ...mockPrincipal, principalId: 'diff-id' };
  const source = new FakeSource(verifier);
  source.result = mockTask;

  const response = await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if (response.principalId !== 'diff-id') throw new Error('Principal ID mismatch');
});

// 3. response task comes from server source
registerTest('3. response task comes from server source', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = { ...mockTask, taskId: 'source-task' };

  const response = await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if (response.task?.taskId !== 'source-task') throw new Error('Task did not come from source');
});

// 4. caller-supplied task is rejected before verifier call
registerTest('4. caller-supplied task is rejected before verifier call', async () => {
  const verifier = new FakeVerifier();
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok', task: {} }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (!(err instanceof TaskGatewayContractError)) throw new Error('Wrong error class');
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
  if (verifier.callCount !== 0) throw new Error('Verifier called despite invalid request');
});

// 5. caller-supplied task is rejected before source call
registerTest('5. caller-supplied task is rejected before source call', async () => {
  const verifier = new FakeVerifier();
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok', task: {} }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (!(err instanceof TaskGatewayContractError)) throw new Error('Wrong error class');
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
  if (source.callCount !== 0) throw new Error('Source called despite invalid request');
});

// 6. missing credential rejected before verifier
registerTest('6. missing credential rejected before verifier', async () => {
  const verifier = new FakeVerifier();
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({}, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (!(err instanceof TaskGatewayContractError)) throw new Error('Wrong error class');
    if (err.code !== 'MISSING_GATEWAY_FIELD') throw err;
  }
  if (verifier.callCount !== 0) throw new Error('Verifier called despite missing credential');
});

// 7. missing credential rejected before source
registerTest('7. missing credential rejected before source', async () => {
  const verifier = new FakeVerifier();
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({}, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (!(err instanceof TaskGatewayContractError)) throw new Error('Wrong error class');
    if (err.code !== 'MISSING_GATEWAY_FIELD') throw err;
  }
  if (source.callCount !== 0) throw new Error('Source called despite missing credential');
});

// 8. verifier receives exact request credential
registerTest('8. verifier receives exact request credential', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = mockTask;
  const secret = { a: 1 };
  await executePendingTaskGatewayRequest({ credential: secret }, verifier as any, source as any);
  if (verifier.lastInput !== secret) throw new Error('Verifier did not receive correct credential');
});

// 9. verifier null -> MACHINE_UNAUTHENTICATED
registerTest('9. verifier null -> MACHINE_UNAUTHENTICATED', async () => {
  const verifier = new FakeVerifier();
  verifier.result = null;
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.code !== 'MACHINE_UNAUTHENTICATED') throw err;
  }
});

// 10. verifier null -> source not called
registerTest('10. verifier null -> source not called', async () => {
  const verifier = new FakeVerifier();
  verifier.result = null;
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (!(err instanceof MachineAuthorizationError)) throw new Error('Wrong error class');
    if (err.code !== 'MACHINE_UNAUTHENTICATED') throw err;
  }
  if (source.callCount !== 0) throw new Error('Source called after auth failure');
});

// 11. verifier throws -> MACHINE_AUTHENTICATION_FAILED
registerTest('11. verifier throws -> MACHINE_AUTHENTICATION_FAILED', async () => {
  const verifier = new FakeVerifier();
  verifier.error = new Error('Crypto fail');
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.code !== 'MACHINE_AUTHENTICATION_FAILED') throw err;
  }
});

// 12. verifier throws -> source not called
registerTest('12. verifier throws -> source not called', async () => {
  const verifier = new FakeVerifier();
  verifier.error = new Error('Crypto fail');
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (!(err instanceof MachineAuthorizationError)) throw new Error('Wrong error class');
    if (err.code !== 'MACHINE_AUTHENTICATION_FAILED') throw err;
  }
  if (source.callCount !== 0) throw new Error('Source called after verifier threw');
});

// 13. inactive principal -> MACHINE_INACTIVE
registerTest('13. inactive principal -> MACHINE_INACTIVE', async () => {
  const verifier = new FakeVerifier();
  verifier.result = { ...mockPrincipal, isActive: false };
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.code !== 'MACHINE_INACTIVE') throw err;
  }
});

// 14. inactive principal -> source not called
registerTest('14. inactive principal -> source not called', async () => {
  const verifier = new FakeVerifier();
  verifier.result = { ...mockPrincipal, isActive: false };
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (!(err instanceof MachineAuthorizationError)) throw new Error('Wrong error class');
    if (err.code !== 'MACHINE_INACTIVE') throw err;
  }
  if (source.callCount !== 0) throw new Error('Source called for inactive principal');
});

// 15. missing capability -> MACHINE_CAPABILITY_DENIED
registerTest('15. missing capability -> MACHINE_CAPABILITY_DENIED', async () => {
  const verifier = new FakeVerifier();
  verifier.result = { ...mockPrincipal, capabilities: [] };
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.code !== 'MACHINE_CAPABILITY_DENIED') throw err;
  }
});

// 16. missing capability -> source not called
registerTest('16. missing capability -> source not called', async () => {
  const verifier = new FakeVerifier();
  verifier.result = { ...mockPrincipal, capabilities: [] };
  const source = new FakeSource(verifier);
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (!(err instanceof MachineAuthorizationError)) throw new Error('Wrong error class');
    if (err.code !== 'MACHINE_CAPABILITY_DENIED') throw err;
  }
  if (source.callCount !== 0) throw new Error('Source called for unauthorized principal');
});

// 17. successful authorization occurs before source access
registerTest('17. successful authorization occurs before source access', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = mockTask;
  
  // To track ordering, we need to instrument the verifier.
  // Since the orchestrator is async, the order is verifier.verify finishes THEN source.fetch starts.
  const originalVerify = verifier.verify;
  verifier.verify = async (i) => {
    source.order.push('verify_start');
    const res = await originalVerify.call(verifier, i);
    source.order.push('verify_end');
    return res;
  };

  await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  
  const verifyEndIndex = source.order.indexOf('verify_end');
  const sourceIndex = source.order.indexOf('source');
  if (verifyEndIndex === -1 || sourceIndex === -1 || verifyEndIndex > sourceIndex) {
    throw new Error(`Invalid execution order: ${source.order.join(' -> ')}`);
  }
});

// 18. source called exactly once after successful authorization
registerTest('18. source called exactly once after successful authorization', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = mockTask;
  await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if (source.callCount !== 1) throw new Error(`Source called ${source.callCount} times`);
});

// 19. source null -> successful response with task:null
registerTest('19. source null -> successful response with task:null', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = null;
  const response = await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if (response.task !== null) throw new Error('Response task should be null');
});

// 20. source null does not fabricate task
registerTest('20. source null does not fabricate task', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = null;
  const response = await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if (response.task !== null) throw new Error('Fabricated task detected');
});

// 21. source infrastructure Error propagates exact same Error instance
registerTest('21. source infrastructure Error propagates exact same Error instance', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  const infraError = new Error('DB Down');
  source.error = infraError;
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err !== infraError) throw new Error('Error instance mismatch');
  }
});

// 22. malformed source task -> canonical ValidationError
registerTest('22. malformed source task -> canonical ValidationError', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = { garbage: true };
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have failed validation');
  } catch (err: any) {
    if (err.name !== 'ValidationError') throw err;
  }
});

// 23. Completed source task -> TaskDeliveryError
registerTest('23. Completed source task -> TaskDeliveryError', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = { ...mockTask, status: AITaskStatus.Completed };
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have rejected non-Pending task');
  } catch (err: any) {
    if (err.name !== 'TaskDeliveryError') throw err;
  }
});

// 24. Failed source task -> TaskDeliveryError
registerTest('24. Failed source task -> TaskDeliveryError', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = { ...mockTask, status: AITaskStatus.Failed };
  try {
    await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
    throw new Error('Should have rejected non-Pending task');
  } catch (err: any) {
    if (err.name !== 'TaskDeliveryError') throw err;
  }
});

// 25. valid source task preserved unchanged
registerTest('25. valid source task preserved unchanged', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = mockTask;
  const response = await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if (JSON.stringify(response.task) !== JSON.stringify(mockTask)) throw new Error('Task mutated');
});

// 26. principalId/workerId not injected into task
registerTest('26. principalId/workerId not injected into task', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = mockTask;
  const response = await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if ((response.task as any).principalId) throw new Error('Leaked principalId into task');
  if ((response.task as any).workerId) throw new Error('Leaked workerId into task');
});

// 27. response exposes no credential/isActive/capabilities
registerTest('27. response exposes no credential/isActive/capabilities', async () => {
  const verifier = new FakeVerifier();
  verifier.result = mockPrincipal;
  const source = new FakeSource(verifier);
  source.result = mockTask;
  const response = await executePendingTaskGatewayRequest({ credential: 'tok' }, verifier as any, source as any);
  if ('isActive' in response) throw new Error('Exposed isActive');
  if ('capabilities' in response) throw new Error('Exposed capabilities');
  if ('credential' in response) throw new Error('Exposed credential');
});

// 28. orchestrator no longer imports/calls authorizeAndPreparePendingTaskDelivery
registerTest('28. orchestrator no longer imports/calls authorizeAndPreparePendingTaskDelivery', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/taskGatewayOrchestrator.ts'), 'utf8');
  if (content.includes('authorizeAndPreparePendingTaskDelivery')) {
    throw new Error('Orchestrator still contains authorizeAndPreparePendingTaskDelivery reference');
  }
});

// 29. orchestrator contains no request.task access
registerTest('29. orchestrator contains no request.task access', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/taskGatewayOrchestrator.ts'), 'utf8');
  if (content.includes('request.task')) {
    throw new Error('Orchestrator still accesses request.task');
  }
});

// 30. functions/src/index.ts remains unwired
registerTest('30. functions/src/index.ts remains unwired', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/index.ts'), 'utf8');
  if (content.includes('executePendingTaskGatewayRequest')) {
    throw new Error('Gateway orchestrator leaked into index.ts');
  }
});

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING PEIA-16L TASK GATEWAY ORCHESTRATOR TESTS');
  console.log('====================================================');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (e) {
      failed++;
    }
  }
  
  console.log('----------------------------------------------------');
  console.log(`SUMMARY: ${passed} passed / ${tests.length} total / ${failed} failed`);
  
  if (failed > 0 || tests.length !== 30) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
