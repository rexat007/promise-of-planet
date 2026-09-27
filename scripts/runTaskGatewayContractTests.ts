import * as fs from 'fs';
import * as path from 'path';
import { 
  validatePendingTaskGatewayRequest, 
  toPendingTaskGatewaySuccess,
  TaskGatewayContractError 
} from '../functions/src/peia/taskGatewayContract';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
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

const mockPrincipal = {
  principalId: 'machine-123',
  isActive: true,
  capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS]
};

const mockTask = {
  taskId: 'task-456',
  taskType: 'CONTENT_REVIEW',
  status: AITaskStatus.Pending,
  target: {
    targetType: 'CitizenSubmission',
    targetId: 'sub-789',
    sourceUpdatedAt: '2026-09-27T00:00:00Z',
  },
  contentSnapshot: { text: 'hello' },
  createdAt: '2026-09-27T00:00:00Z'
};

// 1. credential-only request passes
registerTest('1. credential-only request passes', async () => {
  const result = validatePendingTaskGatewayRequest({ credential: 'token-123' });
  if (result.credential !== 'token-123') throw new Error('Credential not preserved');
});

// 2. validated request contains credential
registerTest('2. validated request contains credential', async () => {
  const result = validatePendingTaskGatewayRequest({ credential: { secret: 'abc' } });
  if (!(result.credential as any).secret) throw new Error('Complex credential not preserved');
});

// 3. validated request contains no task property
registerTest('3. validated request contains no task property', async () => {
  const result = validatePendingTaskGatewayRequest({ credential: 'token-123' });
  if ('task' in result) throw new Error('Validated request must not contain task field');
});

// 4. caller-supplied task -> PROHIBITED_GATEWAY_FIELD
registerTest('4. caller-supplied task -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', task: {} });
    throw new Error('Should have rejected task field');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 5. null request -> INVALID_GATEWAY_REQUEST
registerTest('5. null request -> INVALID_GATEWAY_REQUEST', async () => {
  try {
    validatePendingTaskGatewayRequest(null);
    throw new Error('Should have rejected null');
  } catch (err: any) {
    if (err.code !== 'INVALID_GATEWAY_REQUEST') throw err;
  }
});

// 6. array request -> INVALID_GATEWAY_REQUEST
registerTest('6. array request -> INVALID_GATEWAY_REQUEST', async () => {
  try {
    validatePendingTaskGatewayRequest([]);
    throw new Error('Should have rejected array');
  } catch (err: any) {
    if (err.code !== 'INVALID_GATEWAY_REQUEST') throw err;
  }
});

// 7. primitive request -> INVALID_GATEWAY_REQUEST
registerTest('7. primitive request -> INVALID_GATEWAY_REQUEST', async () => {
  try {
    validatePendingTaskGatewayRequest('string');
    throw new Error('Should have rejected primitive');
  } catch (err: any) {
    if (err.code !== 'INVALID_GATEWAY_REQUEST') throw err;
  }
});

// 8. missing credential -> MISSING_GATEWAY_FIELD
registerTest('8. missing credential -> MISSING_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({});
    throw new Error('Should have rejected missing credential');
  } catch (err: any) {
    if (err.code !== 'MISSING_GATEWAY_FIELD') throw err;
  }
});

// 9. unknown traceId -> UNKNOWN_GATEWAY_FIELD
registerTest('9. unknown traceId -> UNKNOWN_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', traceId: '456' });
    throw new Error('Should have rejected unknown field');
  } catch (err: any) {
    if (err.code !== 'UNKNOWN_GATEWAY_FIELD') throw err;
  }
});

// 10. principalId -> PROHIBITED_GATEWAY_FIELD
registerTest('10. principalId -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', principalId: 'm-1' });
    throw new Error('Should have rejected principalId');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 11. workerId -> PROHIBITED_GATEWAY_FIELD
registerTest('11. workerId -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', workerId: 'w-1' });
    throw new Error('Should have rejected workerId');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 12. role -> PROHIBITED_GATEWAY_FIELD
registerTest('12. role -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', role: 'Admin' });
    throw new Error('Should have rejected role');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 13. permission/adminPermission -> PROHIBITED_GATEWAY_FIELD
registerTest('13. permission/adminPermission -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', adminPermission: 'ALL' });
    throw new Error('Should have rejected permission');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 14. approved/published/autoPublish authority field -> PROHIBITED_GATEWAY_FIELD
registerTest('14. approved/published/autoPublish authority field -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', approved: true });
    throw new Error('Should have rejected authority field');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 15. apiKey -> PROHIBITED_GATEWAY_FIELD
registerTest('15. apiKey -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', apiKey: 'key' });
    throw new Error('Should have rejected apiKey');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 16. machineToken -> PROHIBITED_GATEWAY_FIELD
registerTest('16. machineToken -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', machineToken: 'tok' });
    throw new Error('Should have rejected machineToken');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 17. jwt/serviceAccount -> PROHIBITED_GATEWAY_FIELD
registerTest('17. jwt/serviceAccount -> PROHIBITED_GATEWAY_FIELD', async () => {
  try {
    validatePendingTaskGatewayRequest({ credential: '123', jwt: 'eyJ...' });
    throw new Error('Should have rejected jwt');
  } catch (err: any) {
    if (err.code !== 'PROHIBITED_GATEWAY_FIELD') throw err;
  }
});

// 18. credential content remains opaque/uninterpreted
registerTest('18. credential content remains opaque/uninterpreted', async () => {
  const secret = { foo: 'bar', baz: 123 };
  const result = validatePendingTaskGatewayRequest({ credential: secret });
  if (result.credential !== secret) throw new Error('Credential content modified');
});

// 19. success adapter returns principalId + real task
registerTest('19. success adapter returns principalId + real task', async () => {
  const result = toPendingTaskGatewaySuccess(mockPrincipal as any, mockTask as any);
  if (result.principalId !== mockPrincipal.principalId) throw new Error('Principal ID mismatch');
  if (result.task !== mockTask) throw new Error('Task mismatch');
});

// 20. success adapter supports task:null
registerTest('20. success adapter supports task:null', async () => {
  const result = toPendingTaskGatewaySuccess(mockPrincipal as any, null);
  if (result.task !== null) throw new Error('Should support null task');
});

// 21. success adapter preserves task unchanged
registerTest('21. success adapter preserves task unchanged', async () => {
  const result = toPendingTaskGatewaySuccess(mockPrincipal as any, mockTask as any);
  if (JSON.stringify(result.task) !== JSON.stringify(mockTask)) throw new Error('Task mutated');
});

// 22. success adapter exposes no isActive/capabilities/credential
registerTest('22. success adapter exposes no isActive/capabilities/credential', async () => {
  const result = toPendingTaskGatewaySuccess(mockPrincipal as any, mockTask as any);
  if ('isActive' in result) throw new Error('Exposed isActive');
  if ('capabilities' in result) throw new Error('Exposed capabilities');
  if ('credential' in result) throw new Error('Exposed credential');
});

// 23. contract source contains no request task field / accepted task key
registerTest('23. contract source contains no request task field / accepted task key', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/taskGatewayContract.ts'), 'utf8');
  if (content.includes('task: unknown') && content.includes('PendingTaskGatewayRequest')) {
    throw new Error('PendingTaskGatewayRequest still contains task field');
  }
  if (content.includes("acceptedKeys = ['credential', 'task']")) {
    throw new Error('Accepted keys still contain task');
  }
});

// 24. functions/src/index.ts remains unwired
registerTest('24. functions/src/index.ts remains unwired', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/index.ts'), 'utf8');
  if (content.includes('executePendingTaskGatewayRequest')) {
    throw new Error('Gateway orchestrator leaked into index.ts');
  }
});

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING PEIA-16L TASK GATEWAY CONTRACT TESTS');
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
  
  if (failed > 0 || tests.length !== 24) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
