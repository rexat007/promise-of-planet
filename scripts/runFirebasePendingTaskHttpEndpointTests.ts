import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  executeFirebasePendingTaskHttpEndpoint,
  peiaPendingTaskGateway,
  type PendingTaskHttpResponseWriter,
  type FirebasePendingTaskHttpEndpointDependencies,
} from '../functions/src/peia/firebasePendingTaskHttpEndpoint';
import {
  executePendingTaskHttpRequest,
  type PendingTaskHttpRequest,
} from '../functions/src/peia/taskGatewayHttpRequestAdapter';
import {
  mapPendingTaskHttpSuccess,
  mapPendingTaskHttpError,
} from '../functions/src/peia/taskGatewayHttpResponseMapper';
import { type PendingTaskGatewaySuccess } from '../functions/src/peia/taskGatewayContract';

/**
 * Regression suite for PEIA-16R — FIREBASE onRequest ENDPOINT WIRING FOUNDATION.
 * Enforces exactly 34 test units covering injectable core wiring, response headers,
 * error boundary isolation, source invariants, and index.ts export integrity.
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

interface MockResponseWriter extends PendingTaskHttpResponseWriter {
  readonly headers: Record<string, string>;
  readonly calls: string[];
  statusCode: number | null;
  jsonBody: unknown;
}

function createMockWriter(): MockResponseWriter {
  const writer: MockResponseWriter = {
    headers: {},
    calls: [],
    statusCode: null,
    jsonBody: undefined,
    setHeader(name: string, value: string) {
      writer.headers[name] = value;
      writer.calls.push(`setHeader:${name}:${value}`);
    },
    status(code: number) {
      writer.statusCode = code;
      writer.calls.push(`status:${code}`);
      return writer;
    },
    json(body: unknown) {
      writer.jsonBody = body;
      writer.calls.push('json');
      return body;
    },
  };
  return writer;
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

const validRequest: PendingTaskHttpRequest = {
  method: 'POST',
  headers: {
    Authorization: 'Bearer valid-token',
  },
  body: {},
};

async function runSuite() {
  const endpointPath = join(process.cwd(), 'functions/src/peia/firebasePendingTaskHttpEndpoint.ts');
  const endpointSource = readFileSync(endpointPath, 'utf8');

  const indexPath = join(process.cwd(), 'functions/src/index.ts');
  const indexSource = readFileSync(indexPath, 'utf8');

  console.log('--- PEIA-16R 34-Test Firebase onRequest Endpoint Wiring Audit ---');

  // Shared spy state for standard success execution (Tests 4–14)
  let createGatewayCalls = 0;
  let executeRequestCalls = 0;
  let mapSuccessCalls = 0;
  let mapErrorCalls = 0;
  let passedRequestToExecute: unknown = null;
  let passedGatewayToExecute: unknown = null;
  let passedSuccessToMap: unknown = null;
  let exactMappedSuccessResponse: ReturnType<typeof mapPendingTaskHttpSuccess> | null = null;

  const fakeGateway = async () => dummySuccess;
  const mockWriter = createMockWriter();

  const successDeps: FirebasePendingTaskHttpEndpointDependencies = {
    createGateway: () => {
      createGatewayCalls++;
      return fakeGateway;
    },
    executeRequest: async (req, gw) => {
      executeRequestCalls++;
      passedRequestToExecute = req;
      passedGatewayToExecute = gw;
      return executePendingTaskHttpRequest(req, gw);
    },
    mapSuccess: (suc) => {
      mapSuccessCalls++;
      passedSuccessToMap = suc;
      const mapped = mapPendingTaskHttpSuccess(suc);
      exactMappedSuccessResponse = mapped;
      return mapped;
    },
    mapError: (err) => {
      mapErrorCalls++;
      return mapPendingTaskHttpError(err);
    },
  };

  await executeFirebasePendingTaskHttpEndpoint(validRequest, mockWriter, successDeps);

  // 1. executeFirebasePendingTaskHttpEndpoint exists
  await test('1. executeFirebasePendingTaskHttpEndpoint exists', () => {
    assert(
      typeof executeFirebasePendingTaskHttpEndpoint === 'function',
      'executeFirebasePendingTaskHttpEndpoint is not a function'
    );
  });

  // 2. peiaPendingTaskGateway export exists
  await test('2. peiaPendingTaskGateway export exists', () => {
    assert(typeof peiaPendingTaskGateway === 'function', 'peiaPendingTaskGateway is not a function');
  });

  // 3. injectable core takes exactly 3 arguments
  await test('3. injectable core takes exactly 3 arguments', () => {
    assert(
      executeFirebasePendingTaskHttpEndpoint.length === 3,
      `Expected 3 arguments, got ${executeFirebasePendingTaskHttpEndpoint.length}`
    );
  });

  // 4. createGateway called exactly once on successful request
  await test('4. createGateway called exactly once on successful request', () => {
    assert(createGatewayCalls === 1, `Expected 1 call, got ${createGatewayCalls}`);
  });

  // 5. executeRequest called exactly once on successful request
  await test('5. executeRequest called exactly once on successful request', () => {
    assert(executeRequestCalls === 1, `Expected 1 call, got ${executeRequestCalls}`);
  });

  // 6. exact request object reference is passed to executeRequest
  await test('6. exact request object reference is passed to executeRequest', () => {
    assert(passedRequestToExecute === validRequest, 'Request reference mismatch');
  });

  // 7. exact gateway returned by createGateway is passed to executeRequest
  await test('7. exact gateway returned by createGateway is passed to executeRequest', () => {
    assert(passedGatewayToExecute === fakeGateway, 'Gateway reference mismatch');
  });

  // 8. mapSuccess called exactly once with exact success object
  await test('8. mapSuccess called exactly once with exact success object', () => {
    assert(mapSuccessCalls === 1, `Expected 1 call, got ${mapSuccessCalls}`);
    assert(passedSuccessToMap === dummySuccess, 'Success object reference mismatch');
  });

  // 9. mapError not called on success
  await test('9. mapError not called on success', () => {
    assert(mapErrorCalls === 0, `Expected 0 calls, got ${mapErrorCalls}`);
  });

  // 10. response status called exactly once on success
  await test('10. response status called exactly once on success', () => {
    const statusCalls = mockWriter.calls.filter((c) => c.startsWith('status:'));
    assert(statusCalls.length === 1, `Expected 1 status call, got ${statusCalls.length}`);
  });

  // 11. response json called exactly once on success
  await test('11. response json called exactly once on success', () => {
    const jsonCalls = mockWriter.calls.filter((c) => c === 'json');
    assert(jsonCalls.length === 1, `Expected 1 json call, got ${jsonCalls.length}`);
  });

  // 12. exact mapped success status is written
  await test('12. exact mapped success status is written', () => {
    assert(mockWriter.statusCode === 200, `Expected statusCode 200, got ${mockWriter.statusCode}`);
  });

  // 13. exact mapped success body reference is written
  await test('13. exact mapped success body reference is written', () => {
    assert(exactMappedSuccessResponse !== null, 'exactMappedSuccessResponse was not captured');
    assert(
      mockWriter.jsonBody === exactMappedSuccessResponse.body,
      'Exact mapped success body reference was not preserved'
    );
    assert(
      (mockWriter.jsonBody as any)?.task === dummySuccess.task,
      'Task reference inside body was not preserved'
    );
  });

  // 14. Cache-Control is exactly no-store on success
  await test('14. Cache-Control is exactly no-store on success', () => {
    assert(
      mockWriter.headers['Cache-Control'] === 'no-store',
      `Expected Cache-Control 'no-store', got ${mockWriter.headers['Cache-Control']}`
    );
  });

  // 15. createGateway thrown Error reaches mapError as exact same object
  await test('15. createGateway thrown Error reaches mapError as exact same object', async () => {
    const gatewayError = new Error('CREATE_GATEWAY_FAILURE');
    let capturedError: unknown = null;
    const writer = createMockWriter();

    await executeFirebasePendingTaskHttpEndpoint(validRequest, writer, {
      createGateway: () => {
        throw gatewayError;
      },
      executeRequest: async () => dummySuccess,
      mapSuccess: () => ({ status: 200, body: {} as any }),
      mapError: (err) => {
        capturedError = err;
        return mapPendingTaskHttpError(err);
      },
    });

    assert(capturedError === gatewayError, 'Error reference to mapError mismatch');
  });

  // 16. executeRequest thrown Error reaches mapError as exact same object
  await test('16. executeRequest thrown Error reaches mapError as exact same object', async () => {
    const executeError = new Error('EXECUTE_REQUEST_FAILURE');
    let capturedError: unknown = null;
    const writer = createMockWriter();

    await executeFirebasePendingTaskHttpEndpoint(validRequest, writer, {
      createGateway: () => fakeGateway,
      executeRequest: async () => {
        throw executeError;
      },
      mapSuccess: () => ({ status: 200, body: {} as any }),
      mapError: (err) => {
        capturedError = err;
        return mapPendingTaskHttpError(err);
      },
    });

    assert(capturedError === executeError, 'Error reference to mapError mismatch');
  });

  // 17. mapSuccess thrown Error reaches mapError as exact same object
  await test('17. mapSuccess thrown Error reaches mapError as exact same object', async () => {
    const mappingError = new Error('MAP_SUCCESS_FAILURE');
    let capturedError: unknown = null;
    const writer = createMockWriter();

    await executeFirebasePendingTaskHttpEndpoint(validRequest, writer, {
      createGateway: () => fakeGateway,
      executeRequest: async () => dummySuccess,
      mapSuccess: () => {
        throw mappingError;
      },
      mapError: (err) => {
        capturedError = err;
        return mapPendingTaskHttpError(err);
      },
    });

    assert(capturedError === mappingError, 'Error reference to mapError mismatch');
  });

  // 18. mapError called exactly once on failure
  await test('18. mapError called exactly once on failure', async () => {
    let failureMapCalls = 0;
    const writer = createMockWriter();

    await executeFirebasePendingTaskHttpEndpoint(validRequest, writer, {
      createGateway: () => fakeGateway,
      executeRequest: async () => {
        throw new Error('FAIL');
      },
      mapSuccess: () => ({ status: 200, body: {} as any }),
      mapError: (err) => {
        failureMapCalls++;
        return mapPendingTaskHttpError(err);
      },
    });

    assert(failureMapCalls === 1, `Expected 1 call, got ${failureMapCalls}`);
  });

  // 19. exact mapped error status/body are written
  await test('19. exact mapped error status/body are written', async () => {
    const customErrorBody = { ok: false as const, error: { code: 'CUSTOM', message: 'Custom message' } };
    const writer = createMockWriter();

    await executeFirebasePendingTaskHttpEndpoint(validRequest, writer, {
      createGateway: () => fakeGateway,
      executeRequest: async () => {
        throw new Error('FAIL');
      },
      mapSuccess: () => ({ status: 200, body: {} as any }),
      mapError: () => ({
        status: 503,
        body: customErrorBody,
      }),
    });

    assert(writer.statusCode === 503, `Expected status 503, got ${writer.statusCode}`);
    assert(writer.jsonBody === customErrorBody, 'jsonBody reference mismatch');
  });

  // 20. 401 response adds exactly: WWW-Authenticate: Bearer (Integration with real PEIA-16P and PEIA-16Q)
  await test('20. 401 response adds exactly: WWW-Authenticate: Bearer', async () => {
    const invalidAuthRequest: PendingTaskHttpRequest = {
      method: 'POST',
      headers: {}, // Missing Authorization triggers HTTP_AUTHORIZATION_MISSING -> 401 UNAUTHENTICATED
      body: {},
    };
    const writer = createMockWriter();

    await executeFirebasePendingTaskHttpEndpoint(invalidAuthRequest, writer, {
      createGateway: () => fakeGateway,
      executeRequest: executePendingTaskHttpRequest,
      mapSuccess: mapPendingTaskHttpSuccess,
      mapError: mapPendingTaskHttpError,
    });

    assert(writer.statusCode === 401, `Expected status 401, got ${writer.statusCode}`);
    assert(
      writer.headers['WWW-Authenticate'] === 'Bearer',
      `Expected WWW-Authenticate 'Bearer', got ${writer.headers['WWW-Authenticate']}`
    );
    assert(writer.headers['Cache-Control'] === 'no-store', 'Cache-Control must be no-store');
    assert((writer.jsonBody as any)?.error?.code === 'UNAUTHENTICATED', 'Code mismatch');
    assert((writer.jsonBody as any)?.error?.message === 'Authentication required.', 'Message mismatch');
  });

  // 21. non-401 response does not add WWW-Authenticate
  await test('21. non-401 response does not add WWW-Authenticate', () => {
    assert(
      mockWriter.headers['WWW-Authenticate'] === undefined,
      'WWW-Authenticate must not be present on 200 response'
    );
  });

  // 22. 405 response adds exactly: Allow: POST (Integration with real PEIA-16P and PEIA-16Q)
  await test('22. 405 response adds exactly: Allow: POST', async () => {
    const methodNotAllowedRequest: PendingTaskHttpRequest = {
      method: 'GET', // Triggers HTTP_METHOD_NOT_ALLOWED -> 405 METHOD_NOT_ALLOWED
      headers: { Authorization: 'Bearer token' },
      body: {},
    };
    const writer = createMockWriter();

    await executeFirebasePendingTaskHttpEndpoint(methodNotAllowedRequest, writer, {
      createGateway: () => fakeGateway,
      executeRequest: executePendingTaskHttpRequest,
      mapSuccess: mapPendingTaskHttpSuccess,
      mapError: mapPendingTaskHttpError,
    });

    assert(writer.statusCode === 405, `Expected status 405, got ${writer.statusCode}`);
    assert(writer.headers['Allow'] === 'POST', `Expected Allow 'POST', got ${writer.headers['Allow']}`);
    assert(writer.headers['Cache-Control'] === 'no-store', 'Cache-Control must be no-store');
    assert((writer.jsonBody as any)?.error?.code === 'METHOD_NOT_ALLOWED', 'Code mismatch');
  });

  // 23. non-405 response does not add Allow
  await test('23. non-405 response does not add Allow', () => {
    assert(mockWriter.headers['Allow'] === undefined, 'Allow must not be present on 200 response');
  });

  // 24. Cache-Control no-store also exists on error responses
  await test('24. Cache-Control no-store also exists on error responses', async () => {
    const writer = createMockWriter();
    await executeFirebasePendingTaskHttpEndpoint(validRequest, writer, {
      createGateway: () => fakeGateway,
      executeRequest: async () => {
        throw new Error('UNKNOWN_CRASH');
      },
      mapSuccess: mapPendingTaskHttpSuccess,
      mapError: mapPendingTaskHttpError,
    });

    assert(writer.statusCode === 500, `Expected 500, got ${writer.statusCode}`);
    assert(
      writer.headers['Cache-Control'] === 'no-store',
      `Expected Cache-Control 'no-store', got ${writer.headers['Cache-Control']}`
    );
  });

  // 25. response status happens before json
  await test('25. response status happens before json', () => {
    const statusIndex = mockWriter.calls.findIndex((c) => c.startsWith('status:'));
    const jsonIndex = mockWriter.calls.findIndex((c) => c === 'json');
    assert(statusIndex !== -1, 'status was not called');
    assert(jsonIndex !== -1, 'json was not called');
    assert(statusIndex < jsonIndex, `Expected status before json: ${mockWriter.calls.join(' -> ')}`);
  });

  // 26. if response.status throws, mapError is NOT called again and json is NOT called
  await test('26. if response.status throws, mapError is NOT called again and json is NOT called', async () => {
    const writerError = new Error('WRITER_STATUS_EXCEPTION');
    let thrown: unknown = null;
    let mapErrorCallsOnStatusThrow = 0;
    let jsonCallsOnStatusThrow = 0;

    try {
      await executeFirebasePendingTaskHttpEndpoint(
        validRequest,
        {
          setHeader: () => {},
          status: () => {
            throw writerError;
          },
          json: () => {
            jsonCallsOnStatusThrow++;
          },
        },
        {
          createGateway: () => fakeGateway,
          executeRequest: async () => dummySuccess,
          mapSuccess: () => ({ status: 200, body: {} as any }),
          mapError: () => {
            mapErrorCallsOnStatusThrow++;
            return { status: 500, body: {} as any };
          },
        }
      );
    } catch (err: unknown) {
      thrown = err;
    }

    assert(thrown === writerError, 'Expected response.status error to propagate directly');
    assert(mapErrorCallsOnStatusThrow === 0, 'mapError must not be called when response.status throws');
    assert(jsonCallsOnStatusThrow === 0, 'json must not be called when response.status throws');
  });

  // 27. if response.json throws, mapError is NOT called again
  await test('27. if response.json throws, mapError is NOT called again', async () => {
    const writerError = new Error('WRITER_JSON_EXCEPTION');
    let thrown: unknown = null;
    let mapErrorCallsOnJsonThrow = 0;

    try {
      await executeFirebasePendingTaskHttpEndpoint(
        validRequest,
        {
          setHeader: () => {},
          status: function () {
            return this;
          },
          json: () => {
            throw writerError;
          },
        },
        {
          createGateway: () => fakeGateway,
          executeRequest: async () => dummySuccess,
          mapSuccess: () => ({ status: 200, body: {} as any }),
          mapError: () => {
            mapErrorCallsOnJsonThrow++;
            return { status: 500, body: {} as any };
          },
        }
      );
    } catch (err: unknown) {
      thrown = err;
    }

    assert(thrown === writerError, 'Expected response.json error to propagate directly');
    assert(mapErrorCallsOnJsonThrow === 0, 'mapError must not be called when response.json throws');
  });

  // 28. endpoint core does not mutate request
  await test('28. endpoint core does not mutate request', async () => {
    const inputReq: PendingTaskHttpRequest = {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'X-Custom': 'value' },
      body: {},
    };
    const cloned = { ...inputReq, headers: { ...inputReq.headers } };
    const writer = createMockWriter();

    await executeFirebasePendingTaskHttpEndpoint(inputReq, writer, successDeps);

    assert(inputReq.method === cloned.method, 'method mutated');
    assert(JSON.stringify(inputReq.headers) === JSON.stringify(cloned.headers), 'headers mutated');
    assert(JSON.stringify(inputReq.body) === JSON.stringify(cloned.body), 'body mutated');
  });

  // 29. production wrapper uses cors: false
  await test('29. production wrapper uses cors: false', () => {
    assert(endpointSource.includes('cors: false'), 'cors: false must be present');
    assert(!endpointSource.includes('cors: true'), 'cors: true must not be present');
    assert(!endpointSource.includes("cors: '*'"), "cors: '*' must not be present");
  });

  // 30. production wrapper constructs request only from: method / headers / body
  await test('30. production wrapper constructs request only from: method / headers / body', () => {
    assert(endpointSource.includes('method: request.method'), 'method must be extracted');
    assert(endpointSource.includes('headers: request.headers'), 'headers must be extracted');
    assert(endpointSource.includes('body: request.body'), 'body must be extracted');
    assert(!endpointSource.includes('request.query'), 'query must not be inspected');
    assert(!endpointSource.includes('request.params'), 'params must not be inspected');
    assert(!endpointSource.includes('request.cookies'), 'cookies must not be inspected');
    assert(!endpointSource.includes('request.headers.authorization'), 'authorization header must not be inspected');
    assert(!endpointSource.includes('request.get('), 'request.get must not be called');
  });

  // 31. endpoint source contains no duplicated auth/business/Firestore logic
  await test('31. endpoint source contains no duplicated auth/business/Firestore logic', () => {
    const forbidden = [
      'initializeApp',
      'getFirestore',
      'firebase-admin/firestore',
      'console.log',
      'console.error',
      'logger.',
      'hashOpaqueMachineCredential',
      'validateOpaqueMachineCredential',
      'authorizePendingTaskDelivery',
      'PEIAMachineCapability',
      'prepareNextPendingTaskFromSource',
      'FirestorePendingTaskSource',
      'FirestoreMachineCredentialBindingRepository',
      'MACHINE_UNAUTHENTICATED',
      'MACHINE_INACTIVE',
      'MACHINE_CAPABILITY_DENIED',
      'MACHINE_AUTHENTICATION_FAILED',
      'HTTP_AUTHORIZATION_MISSING',
      'HTTP_AUTHORIZATION_INVALID',
      'TASK_NOT_DELIVERABLE',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
      'taskId',
      'principalId',
      'workerId',
      'peia_v1_',
      'digest',
    ];

    for (const term of forbidden) {
      assert(!endpointSource.includes(term), `Forbidden term "${term}" found in endpoint source`);
    }

    assert(!/\bcredential\b/i.test(endpointSource), 'Forbidden credential term found in endpoint source');
  });

  // 32. createFirebaseTaskGatewayRuntime is NOT invoked at module scope
  await test('32. createFirebaseTaskGatewayRuntime is NOT invoked at module scope', () => {
    assert(
      !/(const|let|var)\s+gateway\s*=\s*createFirebaseTaskGatewayRuntime\(\)/.test(endpointSource),
      'Module scope gateway initialization found'
    );
    // Remove the expected reference assignment and verify no direct call exists in module scope
    const withoutDependencyAssignment = endpointSource.replace(
      'createGateway: createFirebaseTaskGatewayRuntime',
      ''
    );
    assert(
      !/createFirebaseTaskGatewayRuntime\s*\(/.test(withoutDependencyAssignment),
      'createFirebaseTaskGatewayRuntime must not be called outside the core factory invocation'
    );
  });

  // 33. functions/src/index.ts exports peiaPendingTaskGateway and still contains exactly one initializeApp()
  await test('33. functions/src/index.ts exports peiaPendingTaskGateway and still contains exactly one initializeApp()', () => {
    assert(
      indexSource.includes('export { peiaPendingTaskGateway } from "./peia/firebasePendingTaskHttpEndpoint";'),
      'peiaPendingTaskGateway export missing from index.ts'
    );

    const initMatches = indexSource.match(/initializeApp\(\)/g);
    assert(initMatches !== null && initMatches.length === 1, `Expected exactly 1 initializeApp(), got ${initMatches?.length}`);

    const initIndex = indexSource.indexOf('initializeApp()');
    const exportIndex = indexSource.indexOf('export { peiaPendingTaskGateway }');
    assert(initIndex !== -1, 'initializeApp() not found');
    assert(exportIndex !== -1, 'export { peiaPendingTaskGateway } not found');
    assert(initIndex < exportIndex, 'initializeApp() must precede peiaPendingTaskGateway export');
  });

  // 34. existing index exports / helloWorld remain present and final test count gate is exact
  await test('34. existing index exports / helloWorld remain present and final test count gate is exact', () => {
    assert(indexSource.includes('syncYouTubeUploads'), 'syncYouTubeUploads export missing');
    assert(indexSource.includes('manageYouTubeIntegration'), 'manageYouTubeIntegration export missing');
    assert(indexSource.includes('reviewYouTubeCandidate'), 'reviewYouTubeCandidate export missing');
    assert(indexSource.includes('manageMedia'), 'manageMedia export missing');
    assert(indexSource.includes('helloWorld'), 'helloWorld export missing');
    assert(indexSource.includes('onRequest({ cors: true }'), 'helloWorld onRequest cors setting missing');
  });

  // Final count gate
  assert(totalTests === 34, `Expected exactly 34 tests, found ${totalTests}`);
  assert(passedTests === 34, `Expected exactly 34 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / ${totalTests - passedTests} failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
