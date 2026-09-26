import {
  validatePendingTaskGatewayRequest,
  toPendingTaskGatewaySuccess,
  TaskGatewayContractError,
} from '../functions/src/peia/taskGatewayContract';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
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

function createValidRequest(overrides: Record<string, any> = {}): Record<string, any> {
  const base = {
    credential: 'some-untrusted-raw-credential',
    task: {
      taskId: 'task-100',
      status: 'Pending',
    },
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

// 1. Valid outer request with credential + task passes
try {
  const input = createValidRequest();
  const res = validatePendingTaskGatewayRequest(input);
  const matched = res.credential === 'some-untrusted-raw-credential' && typeof res.task === 'object';
  tests.push({
    id: testCounter++,
    name: '1. Valid outer request with credential + task passes',
    passed: matched,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '1. Valid outer request with credential + task passes',
    passed: false,
    message: err.message,
  });
}

// 2. Null request fails
try {
  validatePendingTaskGatewayRequest(null);
  tests.push({
    id: testCounter++,
    name: '2. Null request fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'INVALID_GATEWAY_REQUEST';
  tests.push({
    id: testCounter++,
    name: '2. Null request fails with INVALID_GATEWAY_REQUEST',
    passed: matched,
  });
}

// 3. Array request fails
try {
  validatePendingTaskGatewayRequest([]);
  tests.push({
    id: testCounter++,
    name: '3. Array request fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'INVALID_GATEWAY_REQUEST';
  tests.push({
    id: testCounter++,
    name: '3. Array request fails with INVALID_GATEWAY_REQUEST',
    passed: matched,
  });
}

// 4. Missing credential fails
try {
  const input = createValidRequest({ credential: undefined });
  validatePendingTaskGatewayRequest(input);
  tests.push({
    id: testCounter++,
    name: '4. Missing credential fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'MISSING_GATEWAY_FIELD';
  tests.push({
    id: testCounter++,
    name: '4. Missing credential fails with MISSING_GATEWAY_FIELD',
    passed: matched,
  });
}

// 5. Missing task fails
try {
  const input = createValidRequest({ task: undefined });
  validatePendingTaskGatewayRequest(input);
  tests.push({
    id: testCounter++,
    name: '5. Missing task fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'MISSING_GATEWAY_FIELD';
  tests.push({
    id: testCounter++,
    name: '5. Missing task fails with MISSING_GATEWAY_FIELD',
    passed: matched,
  });
}

// 6. Unknown top-level field fails
try {
  const input = createValidRequest({ traceId: '12345-abcde' });
  validatePendingTaskGatewayRequest(input);
  tests.push({
    id: testCounter++,
    name: '6. Unknown top-level field fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'UNKNOWN_GATEWAY_FIELD';
  tests.push({
    id: testCounter++,
    name: '6. Unknown top-level field fails with UNKNOWN_GATEWAY_FIELD',
    passed: matched,
  });
}

// 7. principalId shortcut field fails
try {
  const input = createValidRequest({ principalId: 'bypass-id' });
  validatePendingTaskGatewayRequest(input);
  tests.push({
    id: testCounter++,
    name: '7. principalId shortcut field fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'PROHIBITED_GATEWAY_FIELD';
  tests.push({
    id: testCounter++,
    name: '7. principalId shortcut field fails with PROHIBITED_GATEWAY_FIELD',
    passed: matched,
  });
}

// 8. workerId shortcut field fails
try {
  const input = createValidRequest({ workerId: 'bypass-worker' });
  validatePendingTaskGatewayRequest(input);
  tests.push({
    id: testCounter++,
    name: '8. workerId shortcut field fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'PROHIBITED_GATEWAY_FIELD';
  tests.push({
    id: testCounter++,
    name: '8. workerId shortcut field fails with PROHIBITED_GATEWAY_FIELD',
    passed: matched,
  });
}

// 9. role/AdminPermission-style field fails
try {
  const input = createValidRequest({ adminRole: 'AIAssistant' });
  validatePendingTaskGatewayRequest(input);
  tests.push({
    id: testCounter++,
    name: '9. role/AdminPermission-style field fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'PROHIBITED_GATEWAY_FIELD';
  tests.push({
    id: testCounter++,
    name: '9. role/AdminPermission-style field fails with PROHIBITED_GATEWAY_FIELD',
    passed: matched,
  });
}

// 10. apiKey/machineToken field fails
try {
  const input = createValidRequest({ apiKey: 'key-1234' });
  validatePendingTaskGatewayRequest(input);
  tests.push({
    id: testCounter++,
    name: '10. apiKey/machineToken field fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof TaskGatewayContractError && err.code === 'PROHIBITED_GATEWAY_FIELD';
  tests.push({
    id: testCounter++,
    name: '10. apiKey/machineToken field fails with PROHIBITED_GATEWAY_FIELD',
    passed: matched,
  });
}

// 11. Request validator does NOT inspect malformed task internals
try {
  const input = {
    credential: 'valid-cred',
    task: { nonsense: true, completelyMalformed: 'yes' },
  };
  const res = validatePendingTaskGatewayRequest(input);
  const matched = res.credential === 'valid-cred' && typeof res.task === 'object';
  tests.push({
    id: testCounter++,
    name: '11. Request validator does NOT inspect malformed task internals',
    passed: matched,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '11. Request validator does NOT inspect malformed task internals',
    passed: false,
    message: err.message,
  });
}

// 12. Request validator does NOT interpret credential contents
try {
  const input = {
    credential: { tokenType: 'OIDC', tokenBody: 'xyz-999', nested: { val: 1 } },
    task: { taskId: 'task-1' },
  };
  const res = validatePendingTaskGatewayRequest(input);
  const matched = typeof res.credential === 'object' && typeof res.task === 'object';
  tests.push({
    id: testCounter++,
    name: '12. Request validator does NOT interpret credential contents',
    passed: matched,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '12. Request validator does NOT interpret credential contents',
    passed: false,
    message: err.message,
  });
}

// 13. Success adapter returns principalId and task
const mockDelivery = {
  principal: {
    principalId: 'node-gamma',
    isActive: true,
    capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
  },
  task: {
    taskId: 'task-abc',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: 'News' as const,
      targetId: 'news-1',
      sourceUpdatedAt: '2026-09-26T00:00:00Z',
    },
    contentSnapshot: { text: 'climate action' },
    createdAt: '2026-09-26T00:01:00Z',
    status: AITaskStatus.Pending,
  },
};

try {
  const res = toPendingTaskGatewaySuccess(mockDelivery);
  const matched = res.principalId === 'node-gamma' && res.task.taskId === 'task-abc';
  tests.push({
    id: testCounter++,
    name: '13. Success adapter returns principalId and task',
    passed: matched,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '13. Success adapter returns principalId and task',
    passed: false,
    message: err.message,
  });
}

// 14. Success adapter does NOT expose: isActive, capabilities, credential
try {
  const res = toPendingTaskGatewaySuccess(mockDelivery);
  const hasInternalKeys = 'isActive' in res || 'capabilities' in res || 'credential' in res;
  tests.push({
    id: testCounter++,
    name: '14. Success adapter does NOT expose internal principal fields or credentials',
    passed: !hasInternalKeys,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '14. Success adapter does NOT expose internal principal fields or credentials',
    passed: false,
  });
}

// 15. Success adapter preserves task unchanged
try {
  const res = toPendingTaskGatewaySuccess(mockDelivery);
  const preserved = JSON.stringify(res.task) === JSON.stringify(mockDelivery.task);
  tests.push({
    id: testCounter++,
    name: '15. Success adapter preserves task completely unchanged',
    passed: preserved,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '15. Success adapter preserves task completely unchanged',
    passed: false,
  });
}

// 16. No duplicate AIReviewTask interface is declared
const prodFilePath = path.join(process.cwd(), 'functions/src/peia/taskGatewayContract.ts');
const code = fs.readFileSync(prodFilePath, 'utf8');
const noDuplicateTaskInterface = !code.includes('interface AIReviewTask') && !code.includes('type AIReviewTask =');
tests.push({
  id: testCounter++,
  name: '16. No duplicate AIReviewTask interface or type is declared in contract',
  passed: noDuplicateTaskInterface,
});

// 17. No Firebase/HTTP imports exist in production contract file
const cleanOfHttpImports = !code.includes('firebase-functions') && !code.includes('express') && !code.includes('HttpsError');
tests.push({
  id: testCounter++,
  name: '17. No Firebase/HTTP imports exist in production contract file',
  passed: cleanOfHttpImports,
});

// 18. functions/src/index.ts remains untouched
const indexPath = path.join(process.cwd(), 'functions/src/index.ts');
const indexCode = fs.readFileSync(indexPath, 'utf8');
const cleanIndex = !indexCode.includes('taskGatewayContract') && !indexCode.includes('PendingTaskGatewayRequest');
tests.push({
  id: testCounter++,
  name: '18. functions/src/index.ts remains untouched by contract parameters',
  passed: cleanIndex,
});

// Log results
console.log('====================================================');
console.log('RUNNING PEIA-16E TASK GATEWAY CONTRACT TESTS');
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
