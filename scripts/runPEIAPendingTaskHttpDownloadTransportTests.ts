import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  downloadPendingTaskWithFetch,
  downloadPendingTask,
  PendingTaskHttpDownloadTransportError,
  type PendingTaskHttpFetch,
  type PendingTaskHttpFetchInit,
  type PendingTaskHttpDownloadInput,
} from '../peia-worker/src/pendingTaskHttpDownloadTransport';
import {
  PendingTaskDownloadResponseError,
} from '../peia-worker/src/downloadTaskResponseContract';
import {
  AITaskType,
  AITaskStatus,
  type AIReviewTask,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
} from '../src/types/aiReview';

/**
 * PEIA-17B — HTTP DOWNLOAD TRANSPORT FOUNDATION TEST SUITE.
 * Enforces exactly 40 real test units covering HTTP transport, headers,
 * error boundaries, and integration with PEIA-17A parser.
 */

let totalTests = 0;
let passedTests = 0;

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

async function assertTransportError(
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<PendingTaskHttpDownloadTransportError> {
  try {
    await fn();
  } catch (err: unknown) {
    if (err instanceof PendingTaskHttpDownloadTransportError) {
      if (err.code !== expectedCode) {
        throw new Error(
          `Expected transport code "${expectedCode}", but received "${err.code}" (message: "${err.message}")`
        );
      }
      return err;
    }
    throw err;
  }
  throw new Error(
    `Expected PendingTaskHttpDownloadTransportError with code "${expectedCode}", but function returned normally.`
  );
}

async function assertPEIA17AError(
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<PendingTaskDownloadResponseError> {
  try {
    await fn();
  } catch (err: unknown) {
    if (err instanceof PendingTaskDownloadResponseError) {
      if (err.code !== expectedCode) {
        throw new Error(
          `Expected PEIA-17A code "${expectedCode}", but received "${err.code}" (message: "${err.message}")`
        );
      }
      return err;
    }
    throw err;
  }
  throw new Error(
    `Expected PendingTaskDownloadResponseError with code "${expectedCode}", but function returned normally.`
  );
}

const validCanonicalTask: AIReviewTask = {
  taskId: 'task-canonical-101',
  taskType: AITaskType.CONTENT_REVIEW,
  status: AITaskStatus.Pending,
  createdAt: '2026-09-28T00:00:00.000Z',
  target: {
    targetType: AIReviewTargetType.News,
    targetId: 'news-987',
    sourceUpdatedAt: '2026-09-27T12:00:00.000Z',
  },
  contentSnapshot: {
    title: 'Climate Action Report',
    summary: 'Detailed summary of climate metrics.',
  },
};

const validSuccessBody = {
  ok: true,
  principalId: 'p-123',
  task: validCanonicalTask,
};

function createMockFetcher(response: { status: number; body: unknown } | (() => Promise<{ status: number; body: unknown }>)) {
  let callCount = 0;
  let capturedUrl: string | null = null;
  let capturedInit: PendingTaskHttpFetchInit | null = null;
  let jsonCallCount = 0;

  const fetcher: PendingTaskHttpFetch = async (url, init) => {
    callCount++;
    capturedUrl = url;
    capturedInit = init;
    const res = typeof response === 'function' ? await response() : response;
    return {
      status: res.status,
      json: async () => {
        jsonCallCount++;
        return res.body;
      },
    };
  };

  return {
    fetcher,
    getCallCount: () => callCount,
    getCapturedUrl: () => capturedUrl,
    getCapturedInit: () => capturedInit,
    getJsonCallCount: () => jsonCallCount,
  };
}

async function runSuite() {
  console.log('--- PEIA-17B 40-Test HTTP Download Transport Audit ---');

  const defaultInput: PendingTaskHttpDownloadInput = {
    endpointUrl: 'https://gateway.example.com/api/peia/pending-task',
    credential: 'secure-machine-token-abc-123',
  };

  // 1. downloadPendingTaskWithFetch exists
  await test('1. downloadPendingTaskWithFetch exists', () => {
    assert(
      typeof downloadPendingTaskWithFetch === 'function',
      'downloadPendingTaskWithFetch must be a function'
    );
  });

  // 2. downloadPendingTask exists
  await test('2. downloadPendingTask exists', () => {
    assert(
      typeof downloadPendingTask === 'function',
      'downloadPendingTask must be a function'
    );
  });

  // 3. valid HTTPS endpoint accepted
  await test('3. valid HTTPS endpoint accepted', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    const result = await downloadPendingTaskWithFetch(
      { endpointUrl: 'https://remote.server.org/v1/tasks', credential: 'valid-token' },
      mock.fetcher
    );
    assert(result.kind === 'TASK_AVAILABLE', 'Expected TASK_AVAILABLE');
  });

  // 4. localhost HTTP endpoint accepted
  await test('4. localhost HTTP endpoint accepted', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    const result = await downloadPendingTaskWithFetch(
      { endpointUrl: 'http://localhost:5001/project/us-central1/peiaPendingTaskGateway', credential: 'valid-token' },
      mock.fetcher
    );
    assert(result.kind === 'TASK_AVAILABLE', 'Expected TASK_AVAILABLE');
  });

  // 5. 127.0.0.1 HTTP endpoint accepted
  await test('5. 127.0.0.1 HTTP endpoint accepted', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    const result = await downloadPendingTaskWithFetch(
      { endpointUrl: 'http://127.0.0.1:8080/api/peia', credential: 'valid-token' },
      mock.fetcher
    );
    assert(result.kind === 'TASK_AVAILABLE', 'Expected TASK_AVAILABLE');
  });

  // 6. ::1 loopback HTTP endpoint accepted
  await test('6. ::1 loopback HTTP endpoint accepted', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    const result = await downloadPendingTaskWithFetch(
      { endpointUrl: 'http://[::1]:8080/api/peia', credential: 'valid-token' },
      mock.fetcher
    );
    assert(result.kind === 'TASK_AVAILABLE', 'Expected TASK_AVAILABLE');
  });

  // 7. non-loopback HTTP endpoint rejected with INVALID_ENDPOINT
  await test('7. non-loopback HTTP endpoint rejected with INVALID_ENDPOINT', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'http://insecure-domain.org/api/peia', credential: 'valid-token' },
          mock.fetcher
        ),
      'INVALID_ENDPOINT'
    );
  });

  // 8. ftp/file/data/javascript/ws/wss rejected
  await test('8. ftp/file/data/javascript/ws/wss rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    const invalidProtocols = [
      'ftp://example.com/file',
      'file:///etc/passwd',
      'data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==',
      'javascript:alert(1)',
      'ws://localhost:3000/socket',
      'wss://example.com/socket',
    ];

    for (const url of invalidProtocols) {
      await assertTransportError(
        () => downloadPendingTaskWithFetch({ endpointUrl: url, credential: 'valid-token' }, mock.fetcher),
        'INVALID_ENDPOINT'
      );
    }
  });

  // 9. relative endpoint rejected
  await test('9. relative endpoint rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: '/api/v1/peia/pending-task', credential: 'valid-token' },
          mock.fetcher
        ),
      'INVALID_ENDPOINT'
    );
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'relative/path', credential: 'valid-token' },
          mock.fetcher
        ),
      'INVALID_ENDPOINT'
    );
  });

  // 10. blank endpoint rejected
  await test('10. blank endpoint rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () => downloadPendingTaskWithFetch({ endpointUrl: '', credential: 'valid-token' }, mock.fetcher),
      'INVALID_ENDPOINT'
    );
  });

  // 11. whitespace-padded endpoint rejected
  await test('11. whitespace-padded endpoint rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: '  https://gateway.example.com/api', credential: 'valid-token' },
          mock.fetcher
        ),
      'INVALID_ENDPOINT'
    );
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api  ', credential: 'valid-token' },
          mock.fetcher
        ),
      'INVALID_ENDPOINT'
    );
  });

  // 12. blank credential rejected
  await test('12. blank credential rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api', credential: '' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
  });

  // 13. whitespace-only credential rejected
  await test('13. whitespace-only credential rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api', credential: '     ' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
  });

  // 14. padded credential rejected
  await test('14. padded credential rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api', credential: ' my-token' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api', credential: 'my-token ' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
  });

  // 15. credential containing internal space rejected
  await test('15. credential containing internal space rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api', credential: 'part1 part2' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
  });

  // 16. credential containing tab/newline/CR rejected
  await test('16. credential containing tab/newline/CR rejected', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api', credential: 'token\tvalue' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api', credential: 'token\nvalue' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com/api', credential: 'token\rvalue' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
  });

  // 17. credential does NOT require peia_v1_ prefix
  await test('17. credential does NOT require peia_v1_ prefix', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    const result = await downloadPendingTaskWithFetch(
      {
        endpointUrl: 'https://gateway.example.com/api',
        credential: 'standard_opaque_credential_without_prefix',
      },
      mock.fetcher
    );
    assert(result.kind === 'TASK_AVAILABLE', 'Expected success without peia_v1_ prefix');
  });

  // 18. fetcher called exactly once on valid request
  await test('18. fetcher called exactly once on valid request', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(mock.getCallCount() === 1, `Expected 1 call, got ${mock.getCallCount()}`);
  });

  // 19. exact accepted endpoint string passed unchanged to fetcher
  await test('19. exact accepted endpoint string passed unchanged to fetcher', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(
      mock.getCapturedUrl() === defaultInput.endpointUrl,
      'URL passed to fetcher must match endpointUrl exactly'
    );
  });

  // 20. method is exactly POST
  await test('20. method is exactly POST', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(mock.getCapturedInit()?.method === 'POST', 'HTTP method must be POST');
  });

  // 21. Authorization header is exactly: Bearer <credential>
  await test('21. Authorization header is exactly: Bearer <credential>', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(
      mock.getCapturedInit()?.headers.Authorization === `Bearer ${defaultInput.credential}`,
      'Authorization header mismatch'
    );
  });

  // 22. Accept header is exactly: application/json
  await test('22. Accept header is exactly: application/json', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(
      mock.getCapturedInit()?.headers.Accept === 'application/json',
      'Accept header must be application/json'
    );
  });

  // 23. fetch init contains exactly: method, headers
  await test('23. fetch init contains exactly: method, headers', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    const keys = Object.keys(mock.getCapturedInit() || {}).sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(['headers', 'method']),
      `Expected exactly ['headers', 'method'], got ${JSON.stringify(keys)}`
    );
  });

  // 24. headers contain exactly: Authorization, Accept
  await test('24. headers contain exactly: Authorization, Accept', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    const headerKeys = Object.keys(mock.getCapturedInit()?.headers || {}).sort();
    assert(
      JSON.stringify(headerKeys) === JSON.stringify(['Accept', 'Authorization']),
      `Expected exactly ['Accept', 'Authorization'], got ${JSON.stringify(headerKeys)}`
    );
  });

  // 25. no request body is sent
  await test('25. no request body is sent', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(!('body' in (mock.getCapturedInit() || {})), 'Request init must not contain body');
  });

  // 26. no Content-Type header is sent
  await test('26. no Content-Type header is sent', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(!('Content-Type' in (mock.getCapturedInit()?.headers || {})), 'Headers must not contain Content-Type');
  });

  // 27. successful response json() called exactly once
  await test('27. successful response json() called exactly once', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(mock.getJsonCallCount() === 1, `Expected 1 json() call, got ${mock.getJsonCallCount()}`);
  });

  // 28. exact response.status passed to PEIA-17A parser behavior
  await test('28. exact response.status passed to PEIA-17A parser behavior', async () => {
    // 201 status with otherwise valid success body triggers INVALID_HTTP_STATUS from PEIA-17A
    const mock = createMockFetcher({ status: 201, body: validSuccessBody });
    await assertPEIA17AError(
      () => downloadPendingTaskWithFetch(defaultInput, mock.fetcher),
      'INVALID_HTTP_STATUS'
    );
  });

  // 29. valid 200 task response returns TASK_AVAILABLE
  await test('29. valid 200 task response returns TASK_AVAILABLE', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    const result = await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(result.kind === 'TASK_AVAILABLE', 'Expected TASK_AVAILABLE');
    assert(result.value.principalId === 'p-123', 'principalId mismatch');
  });

  // 30. exact task reference preserved through transport + PEIA-17A
  await test('30. exact task reference preserved through transport + PEIA-17A', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    const result = await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(
      result.kind === 'TASK_AVAILABLE' && result.value.task === validCanonicalTask,
      'Task reference must be preserved through transport and PEIA-17A'
    );
  });

  // 31. valid 200 null task returns NO_TASK
  await test('31. valid 200 null task returns NO_TASK', async () => {
    const mock = createMockFetcher({
      status: 200,
      body: { ok: true, principalId: 'p-123', task: null },
    });
    const result = await downloadPendingTaskWithFetch(defaultInput, mock.fetcher);
    assert(result.kind === 'NO_TASK', 'Expected NO_TASK');
    assert(result.value.task === null, 'Task must be null');
  });

  // 32. real 401 safe error response propagates PEIA-17A PendingTaskDownloadResponseError code REMOTE_REQUEST_REJECTED unchanged
  await test('32. real 401 safe error response propagates PEIA-17A PendingTaskDownloadResponseError code REMOTE_REQUEST_REJECTED unchanged', async () => {
    const mock = createMockFetcher({
      status: 401,
      body: {
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      },
    });
    const error = await assertPEIA17AError(
      () => downloadPendingTaskWithFetch(defaultInput, mock.fetcher),
      'REMOTE_REQUEST_REJECTED'
    );
    assert(
      error instanceof PendingTaskDownloadResponseError,
      'Error must be instance of PendingTaskDownloadResponseError'
    );
  });

  // 33. malformed 200 response propagates PEIA-17A INVALID_* error unchanged
  await test('33. malformed 200 response propagates PEIA-17A INVALID_* error unchanged', async () => {
    const mock = createMockFetcher({
      status: 200,
      body: {
        ok: false,
        error: { code: 'FAIL', message: 'Rejected' },
      },
    });
    const error = await assertPEIA17AError(
      () => downloadPendingTaskWithFetch(defaultInput, mock.fetcher),
      'INVALID_RESPONSE_BODY'
    );
    assert(
      error instanceof PendingTaskDownloadResponseError,
      'Error must be instance of PendingTaskDownloadResponseError'
    );
  });

  // 34. fetcher rejection → NETWORK_FAILURE
  await test('34. fetcher rejection → NETWORK_FAILURE', async () => {
    const rejectingFetcher: PendingTaskHttpFetch = async () => {
      throw new Error('ECONNREFUSED connect 127.0.0.1:8080');
    };
    await assertTransportError(
      () => downloadPendingTaskWithFetch(defaultInput, rejectingFetcher),
      'NETWORK_FAILURE'
    );
  });

  // 35. raw network error message does not leak
  await test('35. raw network error message does not leak', async () => {
    const secretErrorText = 'CONFIDENTIAL_SOCKET_LEAK_999';
    const rejectingFetcher: PendingTaskHttpFetch = async () => {
      throw new Error(secretErrorText);
    };
    const err = await assertTransportError(
      () => downloadPendingTaskWithFetch(defaultInput, rejectingFetcher),
      'NETWORK_FAILURE'
    );
    assert(!err.message.includes(secretErrorText), 'Raw network error leaked');
    assert(err.message === 'Unable to reach task gateway.', 'Message must be exact fixed string');
  });

  // 36. response.json rejection → RESPONSE_READ_FAILED
  await test('36. response.json rejection → RESPONSE_READ_FAILED', async () => {
    const jsonFailingFetcher: PendingTaskHttpFetch = async () => {
      return {
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      };
    };
    await assertTransportError(
      () => downloadPendingTaskWithFetch(defaultInput, jsonFailingFetcher),
      'RESPONSE_READ_FAILED'
    );
  });

  // 37. raw JSON/read error message does not leak
  await test('37. raw JSON/read error message does not leak', async () => {
    const secretSyntaxText = 'PARSER_INTERNAL_SECRET_STREAM_ERROR_42';
    const jsonFailingFetcher: PendingTaskHttpFetch = async () => {
      return {
        status: 200,
        json: async () => {
          throw new Error(secretSyntaxText);
        },
      };
    };
    const err = await assertTransportError(
      () => downloadPendingTaskWithFetch(defaultInput, jsonFailingFetcher),
      'RESPONSE_READ_FAILED'
    );
    assert(!err.message.includes(secretSyntaxText), 'Raw read error leaked');
    assert(err.message === 'Unable to read task gateway response.', 'Message must be exact fixed string');
  });

  // 38. fetcher is not called when endpoint validation fails
  await test('38. fetcher is not called when endpoint validation fails', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'invalid-url', credential: 'valid-token' },
          mock.fetcher
        ),
      'INVALID_ENDPOINT'
    );
    assert(
      mock.getCallCount() === 0,
      'Fetcher must not be called when endpoint validation fails'
    );
  });

  // 39. fetcher is not called when credential validation fails
  await test('39. fetcher is not called when credential validation fails', async () => {
    const mock = createMockFetcher({ status: 200, body: validSuccessBody });
    await assertTransportError(
      () =>
        downloadPendingTaskWithFetch(
          { endpointUrl: 'https://gateway.example.com', credential: 'padded token ' },
          mock.fetcher
        ),
      'INVALID_CREDENTIAL'
    );
    assert(
      mock.getCallCount() === 0,
      'Fetcher must not be called when credential validation fails'
    );
  });

  // 40. source invariants + exact final count gate
  await test('40. source invariants + exact final count gate', () => {
    const transportPath = join(process.cwd(), 'peia-worker/src/pendingTaskHttpDownloadTransport.ts');
    const source = readFileSync(transportPath, 'utf8');

    // Required terms
    const requiredTerms = [
      'parsePendingTaskDownloadResponse',
      'globalThis.fetch',
      "method: 'POST'",
      'Authorization',
      'Bearer',
      'Accept',
      'application/json',
    ];
    for (const term of requiredTerms) {
      assert(source.includes(term), `Required term "${term}" missing from transport source`);
    }

    // Forbidden terms
    const forbiddenTerms = [
      'firebase-admin',
      'firebase-functions',
      'onRequest',
      'onCall',
      'getFirestore',
      'initializeApp',
      'taskGatewayHttpRequestAdapter',
      'taskGatewayHttpResponseMapper',
      'firebasePendingTaskHttpEndpoint',
      'machineAuthorizationBoundary',
      'sqlite',
      'better-sqlite3',
      'localStorage',
      'IndexedDB',
      'readFile',
      'writeFile',
      'console.log',
      'console.error',
      'logger',
      'setInterval',
      'setTimeout',
      'retry',
      'backoff',
      'process.env',
      'import.meta.env',
      'VITE_FIREBASE_PROJECT_ID',
      'promiseofplanet-bb325',
      'cloudfunctions.net',
      'run.app',
      'taskId',
      'principalId',
      'workerId',
      'role',
      'permission',
      'Content-Type',
      'peia_v1_',
    ];

    for (const term of forbiddenTerms) {
      assert(!source.includes(term), `Forbidden term "${term}" found in transport source`);
    }

    // No body property in request init
    assert(
      !/headers:\s*\{[\s\S]*?\},\s*body:/.test(source) &&
      !/method:\s*'POST',\s*body:/.test(source),
      'body property must not be sent in request init'
    );

    // Module-scope fetch safety
    const globalFetchCalls = source.match(/globalThis\.fetch\s*\(/g) ?? [];
    assert(
      globalFetchCalls.length === 1,
      `Expected exactly one globalThis.fetch invocation, found ${globalFetchCalls.length}`
    );

    const adapterStart = source.indexOf('const productionFetch');
    const adapterEnd = source.indexOf(
      'return downloadPendingTaskWithFetch',
      adapterStart
    );
    const globalFetchIndex = source.indexOf('globalThis.fetch(');

    assert(adapterStart !== -1, 'const productionFetch must exist in source');
    assert(adapterEnd !== -1, 'return downloadPendingTaskWithFetch must exist in source');
    assert(globalFetchIndex !== -1, 'globalThis.fetch( must exist in source');

    assert(
      globalFetchIndex > adapterStart && globalFetchIndex < adapterEnd,
      'globalThis.fetch invocation must exist only inside productionFetch adapter'
    );

    // Bare fetch calls outside adapter
    const bareFetchCalls = source.match(/(?<![a-zA-Z0-9_.])fetch\s*\(/g) ?? [];
    assert(
      bareFetchCalls.length === 0,
      `Expected zero bare fetch() calls, found ${bareFetchCalls.length}`
    );

    assert(totalTests === 40, `Expected exactly 40 tests, found ${totalTests}`);
    assert(passedTests === 39, `Expected 39 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 40, `Expected exactly 40 tests, found ${totalTests}`);
  assert(passedTests === 40, `Expected exactly 40 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
