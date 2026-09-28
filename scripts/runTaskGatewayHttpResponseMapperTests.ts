import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mapPendingTaskHttpSuccess,
  mapPendingTaskHttpError,
} from '../functions/src/peia/taskGatewayHttpResponseMapper';
import { PendingTaskHttpRequestError } from '../functions/src/peia/taskGatewayHttpRequestAdapter';
import { MachineAuthorizationError } from '../functions/src/peia/machineAuthorizationBoundary';
import { TaskGatewayContractError, type PendingTaskGatewaySuccess } from '../functions/src/peia/taskGatewayContract';
import { ValidationError } from '../functions/src/peia/aiTaskValidator';
import { TaskDeliveryError } from '../functions/src/peia/aiTaskDeliveryBoundary';
import { FirestorePendingTaskSourceError } from '../functions/src/peia/firestorePendingTaskSource';

/**
 * Regression suite for PEIA-16Q — HTTP RESPONSE / ERROR MAPPING CONTRACT.
 * Enforces exactly 32 test units covering HTTP response generation, error status codes,
 * security boundary validation, and source invariants.
 */

let passedTests = 0;
let totalTests = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  totalTests++;
  try {
    await fn();
    passedTests++;
  } catch (err: unknown) {
    console.error(`FAILED Test ${totalTests}: ${name}`);
    console.error(err);
    throw err;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const dummySuccess: PendingTaskGatewaySuccess = {
  principalId: 'p-1',
  task: {
    taskId: 'task-1',
    taskType: 'CONTENT_REVIEW',
    target: {
      targetType: 'News',
      targetId: 'news-123',
      sourceUpdatedAt: '2026-09-27T00:00:00.000Z',
    },
    contentSnapshot: {
      title: 'News Title',
    },
    createdAt: '2026-09-27T00:00:00.000Z',
    status: 'Pending',
  },
};

async function runSuite() {
  const mapperPath = join(process.cwd(), 'functions/src/peia/taskGatewayHttpResponseMapper.ts');
  const mapperSource = readFileSync(mapperPath, 'utf8');

  const indexPath = join(process.cwd(), 'functions/src/index.ts');
  const indexSource = readFileSync(indexPath, 'utf8');

  console.log('--- PEIA-16Q 32-Test HTTP Response/Error Mapper Audit ---');

  // 1. mapPendingTaskHttpSuccess exists
  await test('1. mapPendingTaskHttpSuccess exists', () => {
    assert(typeof mapPendingTaskHttpSuccess === 'function', 'mapPendingTaskHttpSuccess is not a function');
  });

  // 2. mapPendingTaskHttpError exists
  await test('2. mapPendingTaskHttpError exists', () => {
    assert(typeof mapPendingTaskHttpError === 'function', 'mapPendingTaskHttpError is not a function');
  });

  // 3. success status is exactly 200
  await test('3. success status is exactly 200', () => {
    const res = mapPendingTaskHttpSuccess(dummySuccess);
    assert(res.status === 200, `Expected status 200, got ${res.status}`);
  });

  // 4. success body contains exactly: ok, principalId, task
  await test('4. success body contains exactly: ok, principalId, task', () => {
    const res = mapPendingTaskHttpSuccess(dummySuccess);
    const keys = Object.keys(res.body).sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(['ok', 'principalId', 'task']),
      `Expected keys ['ok', 'principalId', 'task'], got ${JSON.stringify(keys)}`
    );
  });

  // 5. success body ok === true
  await test('5. success body ok === true', () => {
    const res = mapPendingTaskHttpSuccess(dummySuccess);
    assert(res.body.ok === true, 'Expected res.body.ok to be true');
  });

  // 6. success principalId preserved exactly
  await test('6. success principalId preserved exactly', () => {
    const res = mapPendingTaskHttpSuccess(dummySuccess);
    assert(res.body.principalId === 'p-1', `Expected principalId 'p-1', got ${res.body.principalId}`);
  });

  // 7. success task reference preserved exactly
  await test('7. success task reference preserved exactly', () => {
    const res = mapPendingTaskHttpSuccess(dummySuccess);
    assert(res.body.task === dummySuccess.task, 'Task reference was not preserved exactly');

    // Also verify task: null is preserved exactly
    const nullTaskSuccess: PendingTaskGatewaySuccess = { principalId: 'p-2', task: null };
    const nullRes = mapPendingTaskHttpSuccess(nullTaskSuccess);
    assert(nullRes.body.task === null, 'Task null reference was not preserved');
  });

  // 8. success mapper does not mutate input
  await test('8. success mapper does not mutate input', () => {
    const cloned = { ...dummySuccess };
    mapPendingTaskHttpSuccess(cloned);
    assert(cloned.principalId === dummySuccess.principalId, 'principalId was mutated');
    assert(cloned.task === dummySuccess.task, 'task was mutated');
  });

  // 9. HTTP_METHOD_NOT_ALLOWED → 405 / METHOD_NOT_ALLOWED
  await test('9. HTTP_METHOD_NOT_ALLOWED → 405 / METHOD_NOT_ALLOWED', () => {
    const err = new PendingTaskHttpRequestError('HTTP_METHOD_NOT_ALLOWED', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 405, `Expected 405, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'METHOD_NOT_ALLOWED', `Expected METHOD_NOT_ALLOWED, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Method not allowed.', `Unexpected message: ${res.body.error.message}`);
  });

  // 10. HTTP_AUTHORIZATION_MISSING → 401 / UNAUTHENTICATED
  await test('10. HTTP_AUTHORIZATION_MISSING → 401 / UNAUTHENTICATED', () => {
    const err = new PendingTaskHttpRequestError('HTTP_AUTHORIZATION_MISSING', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'UNAUTHENTICATED', `Expected UNAUTHENTICATED, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Authentication required.', `Unexpected message: ${res.body.error.message}`);
  });

  // 11. HTTP_AUTHORIZATION_INVALID → 401 / UNAUTHENTICATED
  await test('11. HTTP_AUTHORIZATION_INVALID → 401 / UNAUTHENTICATED', () => {
    const err = new PendingTaskHttpRequestError('HTTP_AUTHORIZATION_INVALID', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'UNAUTHENTICATED', `Expected UNAUTHENTICATED, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Authentication required.', `Unexpected message: ${res.body.error.message}`);
  });

  // 12. HTTP_BODY_NOT_EMPTY → 400 / INVALID_REQUEST
  await test('12. HTTP_BODY_NOT_EMPTY → 400 / INVALID_REQUEST', () => {
    const err = new PendingTaskHttpRequestError('HTTP_BODY_NOT_EMPTY', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INVALID_REQUEST', `Expected INVALID_REQUEST, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Invalid request.', `Unexpected message: ${res.body.error.message}`);
  });

  // 13. MACHINE_UNAUTHENTICATED → 401 / UNAUTHENTICATED
  await test('13. MACHINE_UNAUTHENTICATED → 401 / UNAUTHENTICATED', () => {
    const err = new MachineAuthorizationError('MACHINE_UNAUTHENTICATED', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'UNAUTHENTICATED', `Expected UNAUTHENTICATED, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Authentication failed.', `Unexpected message: ${res.body.error.message}`);
  });

  // 14. MACHINE_INACTIVE → 403 / FORBIDDEN
  await test('14. MACHINE_INACTIVE → 403 / FORBIDDEN', () => {
    const err = new MachineAuthorizationError('MACHINE_INACTIVE', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'FORBIDDEN', `Expected FORBIDDEN, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Access denied.', `Unexpected message: ${res.body.error.message}`);
  });

  // 15. MACHINE_CAPABILITY_DENIED → 403 / FORBIDDEN
  await test('15. MACHINE_CAPABILITY_DENIED → 403 / FORBIDDEN', () => {
    const err = new MachineAuthorizationError('MACHINE_CAPABILITY_DENIED', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'FORBIDDEN', `Expected FORBIDDEN, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Access denied.', `Unexpected message: ${res.body.error.message}`);
  });

  // 16. MACHINE_PRINCIPAL_INVALID → 403 / FORBIDDEN
  await test('16. MACHINE_PRINCIPAL_INVALID → 403 / FORBIDDEN', () => {
    const err = new MachineAuthorizationError('MACHINE_PRINCIPAL_INVALID', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'FORBIDDEN', `Expected FORBIDDEN, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Access denied.', `Unexpected message: ${res.body.error.message}`);
  });

  // 17. MACHINE_AUTHENTICATION_FAILED → 503 / SERVICE_UNAVAILABLE
  await test('17. MACHINE_AUTHENTICATION_FAILED → 503 / SERVICE_UNAVAILABLE', () => {
    const err = new MachineAuthorizationError('MACHINE_AUTHENTICATION_FAILED', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 503, `Expected 503, got ${res.status}`);
    assert(res.status !== 401, 'MACHINE_AUTHENTICATION_FAILED must not map to 401');
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'SERVICE_UNAVAILABLE', `Expected SERVICE_UNAVAILABLE, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Service temporarily unavailable.', `Unexpected message: ${res.body.error.message}`);
  });

  // 18. TaskGatewayContractError → 400 / INVALID_REQUEST
  await test('18. TaskGatewayContractError → 400 / INVALID_REQUEST', () => {
    const err = new TaskGatewayContractError('PROHIBITED_GATEWAY_FIELD', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INVALID_REQUEST', `Expected INVALID_REQUEST, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Invalid request.', `Unexpected message: ${res.body.error.message}`);
  });

  // 19. ValidationError → 500 / INTERNAL_ERROR
  await test('19. ValidationError → 500 / INTERNAL_ERROR', () => {
    const err = new ValidationError('INVALID_TASK_PAYLOAD', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 500, `Expected 500, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INTERNAL_ERROR', `Expected INTERNAL_ERROR, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Internal server error.', `Unexpected message: ${res.body.error.message}`);
  });

  // 20. TaskDeliveryError → 409 / TASK_NOT_AVAILABLE
  await test('20. TaskDeliveryError → 409 / TASK_NOT_AVAILABLE', () => {
    const err = new TaskDeliveryError('TASK_NOT_DELIVERABLE', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'TASK_NOT_AVAILABLE', `Expected TASK_NOT_AVAILABLE, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Task is not available for delivery.', `Unexpected message: ${res.body.error.message}`);
  });

  // 21. FirestorePendingTaskSourceError → 500 / INTERNAL_ERROR
  await test('21. FirestorePendingTaskSourceError → 500 / INTERNAL_ERROR', () => {
    const err = new FirestorePendingTaskSourceError('QUERY_FAILED', 'Internal details');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 500, `Expected 500, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INTERNAL_ERROR', `Expected INTERNAL_ERROR, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Internal server error.', `Unexpected message: ${res.body.error.message}`);
  });

  // 22. generic Error → 500 / INTERNAL_ERROR
  await test('22. generic Error → 500 / INTERNAL_ERROR', () => {
    const err = new Error('Generic unhandled error');
    const res = mapPendingTaskHttpError(err);
    assert(res.status === 500, `Expected 500, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INTERNAL_ERROR', `Expected INTERNAL_ERROR, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Internal server error.', `Unexpected message: ${res.body.error.message}`);
  });

  // 23. null → 500 / INTERNAL_ERROR
  await test('23. null → 500 / INTERNAL_ERROR', () => {
    const res = mapPendingTaskHttpError(null);
    assert(res.status === 500, `Expected 500, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INTERNAL_ERROR', `Expected INTERNAL_ERROR, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Internal server error.', `Unexpected message: ${res.body.error.message}`);
  });

  // 24. undefined → 500 / INTERNAL_ERROR
  await test('24. undefined → 500 / INTERNAL_ERROR', () => {
    const res = mapPendingTaskHttpError(undefined);
    assert(res.status === 500, `Expected 500, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INTERNAL_ERROR', `Expected INTERNAL_ERROR, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Internal server error.', `Unexpected message: ${res.body.error.message}`);
  });

  // 25. string primitive → 500 / INTERNAL_ERROR
  await test('25. string primitive → 500 / INTERNAL_ERROR', () => {
    const res = mapPendingTaskHttpError('something went wrong');
    assert(res.status === 500, `Expected 500, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INTERNAL_ERROR', `Expected INTERNAL_ERROR, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Internal server error.', `Unexpected message: ${res.body.error.message}`);
  });

  // 26. object with fake code/message fields → 500 / INTERNAL_ERROR
  await test('26. object with fake code/message fields → 500 / INTERNAL_ERROR', () => {
    const fake = {
      name: 'MachineAuthorizationError',
      code: 'MACHINE_UNAUTHENTICATED',
      message: 'SECRET SHOULD NOT LEAK',
    };
    const res = mapPendingTaskHttpError(fake);
    assert(res.status === 500, `Expected 500, got ${res.status}`);
    assert(res.body.ok === false, 'Expected ok === false');
    assert(res.body.error.code === 'INTERNAL_ERROR', `Expected INTERNAL_ERROR, got ${res.body.error.code}`);
    assert(res.body.error.message === 'Internal server error.', `Unexpected message: ${res.body.error.message}`);
  });

  // 27. public error body contains exactly: ok, error and error contains exactly: code, message
  await test('27. public error body contains exactly: ok, error and error contains exactly: code, message', () => {
    const err = new PendingTaskHttpRequestError('HTTP_METHOD_NOT_ALLOWED', 'msg');
    const res = mapPendingTaskHttpError(err);
    const bodyKeys = Object.keys(res.body).sort();
    assert(
      JSON.stringify(bodyKeys) === JSON.stringify(['error', 'ok']),
      `Expected ['error', 'ok'], got ${JSON.stringify(bodyKeys)}`
    );
    const errorKeys = Object.keys(res.body.error).sort();
    assert(
      JSON.stringify(errorKeys) === JSON.stringify(['code', 'message']),
      `Expected ['code', 'message'], got ${JSON.stringify(errorKeys)}`
    );
  });

  // 28. no input error.message leaks into response
  await test('28. no input error.message leaks into response', () => {
    const secretMsg = 'CONFIDENTIAL_INTERNAL_STACK_TRACE_12345';
    const errors = [
      new PendingTaskHttpRequestError('HTTP_METHOD_NOT_ALLOWED', secretMsg),
      new MachineAuthorizationError('MACHINE_UNAUTHENTICATED', secretMsg),
      new TaskGatewayContractError('PROHIBITED_GATEWAY_FIELD', secretMsg),
      new ValidationError('INVALID_TASK_PAYLOAD', secretMsg),
      new TaskDeliveryError('TASK_NOT_DELIVERABLE', secretMsg),
      new FirestorePendingTaskSourceError('INTERNAL', secretMsg),
      new Error(secretMsg),
      { message: secretMsg },
    ];

    for (const e of errors) {
      const res = mapPendingTaskHttpError(e);
      const json = JSON.stringify(res);
      assert(!json.includes(secretMsg), `Secret leaked in response: ${json}`);
    }
  });

  // 29. no stack/cause/name/internal code leaks into response
  await test('29. no stack/cause/name/internal code leaks into response', () => {
    const err = new MachineAuthorizationError('MACHINE_INACTIVE', 'some internal message');
    (err as any).cause = 'root_cause_sensitive';
    const res = mapPendingTaskHttpError(err);
    const json = JSON.stringify(res);
    assert(!json.includes('stack'), 'stack found in response JSON');
    assert(!json.includes('cause'), 'cause found in response JSON');
    assert(!json.includes('root_cause_sensitive'), 'cause value leaked in response');
    assert(!json.includes('MACHINE_INACTIVE'), 'internal error code leaked in response');
    assert(!json.includes('MachineAuthorizationError'), 'internal class name leaked in response');
  });

  // 30. mapper source contains no logging/Firebase/runtime/credential logic
  await test('30. mapper source contains no logging/Firebase/runtime/credential logic', () => {
    const forbidden = [
      'console.log',
      'console.error',
      'firebase-admin',
      'firebase-functions',
      'onRequest',
      'onCall',
      'HttpsError',
      'getFirestore',
      'initializeApp',
      'Bearer',
      'peia_v1_',
      'digest',
      'error.stack',
      'error.cause',
      'String(error)',
      'JSON.stringify(error)',
    ];

    for (const term of forbidden) {
      assert(!mapperSource.includes(term), `Forbidden term "${term}" found in mapper source`);
    }
    assert(!/\bAuthorization\b/.test(mapperSource), 'Forbidden standalone Authorization found in mapper source');
    assert(!/\bcredential\b/i.test(mapperSource), 'Forbidden credential term found in mapper source');
    assert(!/\btoken\b/i.test(mapperSource), 'Forbidden token term found in mapper source');
  });

  // 31. functions/src/index.ts remains unwired
  await test('31. functions/src/index.ts remains unwired', () => {
    assert(!indexSource.includes('mapPendingTaskHttpSuccess'), 'index.ts wires mapPendingTaskHttpSuccess');
    assert(!indexSource.includes('mapPendingTaskHttpError'), 'index.ts wires mapPendingTaskHttpError');
    assert(!indexSource.includes('taskGatewayHttpResponseMapper'), 'index.ts wires taskGatewayHttpResponseMapper');
  });

  // 32. all fixed public messages exactly match the required contract
  await test('32. all fixed public messages exactly match the required contract', () => {
    const expectedMessages = {
      METHOD_NOT_ALLOWED: 'Method not allowed.',
      UNAUTHENTICATED_HEADER: 'Authentication required.',
      UNAUTHENTICATED_MACHINE: 'Authentication failed.',
      FORBIDDEN: 'Access denied.',
      INVALID_REQUEST: 'Invalid request.',
      SERVICE_UNAVAILABLE: 'Service temporarily unavailable.',
      TASK_NOT_AVAILABLE: 'Task is not available for delivery.',
      INTERNAL_ERROR: 'Internal server error.',
    };

    assert(
      mapPendingTaskHttpError(new PendingTaskHttpRequestError('HTTP_METHOD_NOT_ALLOWED', '')).body.error.message ===
        expectedMessages.METHOD_NOT_ALLOWED,
      'METHOD_NOT_ALLOWED message mismatch'
    );
    assert(
      mapPendingTaskHttpError(new PendingTaskHttpRequestError('HTTP_AUTHORIZATION_MISSING', '')).body.error.message ===
        expectedMessages.UNAUTHENTICATED_HEADER,
      'HTTP_AUTHORIZATION_MISSING message mismatch'
    );
    assert(
      mapPendingTaskHttpError(new MachineAuthorizationError('MACHINE_UNAUTHENTICATED', '')).body.error.message ===
        expectedMessages.UNAUTHENTICATED_MACHINE,
      'MACHINE_UNAUTHENTICATED message mismatch'
    );
    assert(
      mapPendingTaskHttpError(new MachineAuthorizationError('MACHINE_INACTIVE', '')).body.error.message ===
        expectedMessages.FORBIDDEN,
      'MACHINE_INACTIVE message mismatch'
    );
    assert(
      mapPendingTaskHttpError(new TaskGatewayContractError('INVALID_GATEWAY_REQUEST', '')).body.error.message ===
        expectedMessages.INVALID_REQUEST,
      'INVALID_REQUEST message mismatch'
    );
    assert(
      mapPendingTaskHttpError(new MachineAuthorizationError('MACHINE_AUTHENTICATION_FAILED', '')).body.error.message ===
        expectedMessages.SERVICE_UNAVAILABLE,
      'MACHINE_AUTHENTICATION_FAILED message mismatch'
    );
    assert(
      mapPendingTaskHttpError(new TaskDeliveryError('TASK_NOT_DELIVERABLE', '')).body.error.message ===
        expectedMessages.TASK_NOT_AVAILABLE,
      'TASK_NOT_DELIVERABLE message mismatch'
    );
    assert(
      mapPendingTaskHttpError(new ValidationError('INVALID_TASK_PAYLOAD', '')).body.error.message ===
        expectedMessages.INTERNAL_ERROR,
      'ValidationError message mismatch'
    );
    assert(
      mapPendingTaskHttpError(new Error('generic')).body.error.message ===
        expectedMessages.INTERNAL_ERROR,
      'generic Error message mismatch'
    );
  });

  // Final count gate
  assert(totalTests === 32, `Expected exactly 32 tests, found ${totalTests}`);
  assert(passedTests === 32, `Expected exactly 32 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / ${totalTests - passedTests} failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
