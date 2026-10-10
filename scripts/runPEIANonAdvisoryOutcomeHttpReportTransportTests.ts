import {
  uploadNonAdvisoryOutcomeWithFetch,
  NonAdvisoryOutcomeHttpReportTransportError,
  type NonAdvisoryOutcomeHttpFetch,
} from '../peia-worker/src/nonAdvisoryOutcomeHttpReportTransport';
import { NonAdvisoryOutcomeKind } from '../peia-worker/src/localNonAdvisoryOutcomeContract';
import { NonAdvisoryOutcomeReportContractError } from '../peia-worker/src/nonAdvisoryOutcomeReportContract';

console.log('--- Running PEIA Non-Advisory Outcome HTTP Report Transport Tests ---');

const now = new Date().toISOString();
const validOutcome = {
  taskId: 'task-100',
  kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
  reason: 'MISSING_RETRIEVAL_QUERY',
  modelAttempts: 0,
  createdAt: now,
};

const dummyFetch: NonAdvisoryOutcomeHttpFetch = async () => ({
  status: 200,
  json: async () => ({ ok: true, taskId: 'task-100' }),
});

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name: string, fn: () => Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`[PASS] ${name}`);
  } catch (err: unknown) {
    failedTests++;
    console.error(`[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

// 1. HTTPS accepted
await test('1. HTTPS accepted', async () => {
  const res = await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
    dummyFetch
  );
  assert(res.ok === true && res.taskId === 'task-100', 'Expected successful parse');
});

// 2. localhost HTTP accepted
await test('2. localhost HTTP accepted', async () => {
  const res = await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'http://localhost:3000/report', credential: 'valid-credential', outcome: validOutcome },
    dummyFetch
  );
  assert(res.ok === true && res.taskId === 'task-100', 'Expected successful parse');
});

// 3. 127.0.0.1 HTTP accepted
await test('3. 127.0.0.1 HTTP accepted', async () => {
  const res = await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'http://127.0.0.1:3000/report', credential: 'valid-credential', outcome: validOutcome },
    dummyFetch
  );
  assert(res.ok === true && res.taskId === 'task-100', 'Expected successful parse');
});

// 4. non-loopback HTTP rejected
await test('4. non-loopback HTTP rejected', async () => {
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'http://insecure.example.com/report', credential: 'valid-credential', outcome: validOutcome },
      dummyFetch
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeHttpReportTransportError, 'Expected transport error');
  assert(caught.code === 'INVALID_ENDPOINT', `Expected INVALID_ENDPOINT, got ${caught?.code}`);
});

// 5. invalid URL rejected
await test('5. invalid URL rejected', async () => {
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'not_a_valid_url', credential: 'valid-credential', outcome: validOutcome },
      dummyFetch
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeHttpReportTransportError, 'Expected transport error');
  assert(caught.code === 'INVALID_ENDPOINT', `Expected INVALID_ENDPOINT, got ${caught?.code}`);
});

// 6. empty credential rejected
await test('6. empty credential rejected', async () => {
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'https://api.example.com/report', credential: '', outcome: validOutcome },
      dummyFetch
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeHttpReportTransportError, 'Expected transport error');
  assert(caught.code === 'INVALID_CREDENTIAL', `Expected INVALID_CREDENTIAL, got ${caught?.code}`);
});

// 7. padded credential rejected
await test('7. padded credential rejected', async () => {
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'https://api.example.com/report', credential: '  padded-token  ', outcome: validOutcome },
      dummyFetch
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeHttpReportTransportError, 'Expected transport error');
  assert(caught.code === 'INVALID_CREDENTIAL', `Expected INVALID_CREDENTIAL, got ${caught?.code}`);
});

// 8. whitespace credential rejected
await test('8. whitespace credential rejected', async () => {
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'https://api.example.com/report', credential: 'token with spaces', outcome: validOutcome },
      dummyFetch
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeHttpReportTransportError, 'Expected transport error');
  assert(caught.code === 'INVALID_CREDENTIAL', `Expected INVALID_CREDENTIAL, got ${caught?.code}`);
});

// 9. exact POST
await test('9. exact POST', async () => {
  let capturedMethod = '';
  const fetcher: NonAdvisoryOutcomeHttpFetch = async (_url, init) => {
    capturedMethod = init.method;
    return { status: 200, json: async () => ({ ok: true, taskId: 'task-100' }) };
  };
  await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
    fetcher
  );
  assert(capturedMethod === 'POST', `Expected POST, got ${capturedMethod}`);
});

// 10. exact Authorization Bearer header
await test('10. exact Authorization Bearer header', async () => {
  let capturedAuth = '';
  const fetcher: NonAdvisoryOutcomeHttpFetch = async (_url, init) => {
    capturedAuth = init.headers['Authorization'];
    return { status: 200, json: async () => ({ ok: true, taskId: 'task-100' }) };
  };
  await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'https://api.example.com/report', credential: 'my-secret-token', outcome: validOutcome },
    fetcher
  );
  assert(capturedAuth === 'Bearer my-secret-token', `Expected 'Bearer my-secret-token', got '${capturedAuth}'`);
});

// 11. exact Content-Type application/json
await test('11. exact Content-Type application/json', async () => {
  let capturedContentType = '';
  const fetcher: NonAdvisoryOutcomeHttpFetch = async (_url, init) => {
    capturedContentType = init.headers['Content-Type'];
    return { status: 200, json: async () => ({ ok: true, taskId: 'task-100' }) };
  };
  await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
    fetcher
  );
  assert(capturedContentType === 'application/json', `Expected application/json, got ${capturedContentType}`);
});

// 12. exact Accept application/json
await test('12. exact Accept application/json', async () => {
  let capturedAccept = '';
  const fetcher: NonAdvisoryOutcomeHttpFetch = async (_url, init) => {
    capturedAccept = init.headers['Accept'];
    return { status: 200, json: async () => ({ ok: true, taskId: 'task-100' }) };
  };
  await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
    fetcher
  );
  assert(capturedAccept === 'application/json', `Expected application/json, got ${capturedAccept}`);
});

// 13. exact serialized body { outcome }
await test('13. exact serialized body { outcome }', async () => {
  let capturedBody = '';
  const fetcher: NonAdvisoryOutcomeHttpFetch = async (_url, init) => {
    capturedBody = init.body;
    return { status: 200, json: async () => ({ ok: true, taskId: 'task-100' }) };
  };
  await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
    fetcher
  );
  const parsed = JSON.parse(capturedBody);
  assert(parsed.outcome && parsed.outcome.taskId === 'task-100', 'Expected body to contain { outcome }');
  assert(Object.keys(parsed).length === 1 && Object.keys(parsed)[0] === 'outcome', 'Expected exactly one key: outcome');
});

// 14. network failure → NETWORK_FAILURE
await test('14. network failure → NETWORK_FAILURE', async () => {
  const fetcher: NonAdvisoryOutcomeHttpFetch = async () => {
    throw new Error('Connection refused');
  };
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
      fetcher
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeHttpReportTransportError, 'Expected transport error');
  assert(caught.code === 'NETWORK_FAILURE', `Expected NETWORK_FAILURE, got ${caught?.code}`);
});

// 15. non-200 → UNEXPECTED_HTTP_STATUS
await test('15. non-200 → UNEXPECTED_HTTP_STATUS', async () => {
  const fetcher: NonAdvisoryOutcomeHttpFetch = async () => ({
    status: 500,
    json: async () => ({ error: 'internal error' }),
  });
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
      fetcher
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeHttpReportTransportError, 'Expected transport error');
  assert(caught.code === 'UNEXPECTED_HTTP_STATUS', `Expected UNEXPECTED_HTTP_STATUS, got ${caught?.code}`);
});

// 16. response json failure → RESPONSE_READ_FAILED
await test('16. response json failure → RESPONSE_READ_FAILED', async () => {
  const fetcher: NonAdvisoryOutcomeHttpFetch = async () => ({
    status: 200,
    json: async () => {
      throw new Error('Unexpected token in JSON');
    },
  });
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
      fetcher
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeHttpReportTransportError, 'Expected transport error');
  assert(caught.code === 'RESPONSE_READ_FAILED', `Expected RESPONSE_READ_FAILED, got ${caught?.code}`);
});

// 17. malformed accepted response rejected
await test('17. malformed accepted response rejected', async () => {
  const fetcher: NonAdvisoryOutcomeHttpFetch = async () => ({
    status: 200,
    json: async () => ({ ok: false, taskId: 'task-100' }),
  });
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
      fetcher
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof NonAdvisoryOutcomeReportContractError, 'Expected contract error');
  assert(caught.code === 'INVALID_REPORT_RESPONSE', `Expected INVALID_REPORT_RESPONSE, got ${caught?.code}`);
});

// 18. valid accepted response parsed
await test('18. valid accepted response parsed', async () => {
  const fetcher: NonAdvisoryOutcomeHttpFetch = async () => ({
    status: 200,
    json: async () => ({ ok: true, taskId: 'task-100' }),
  });
  const res = await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'https://api.example.com/report', credential: 'valid-credential', outcome: validOutcome },
    fetcher
  );
  assert(res.ok === true && res.taskId === 'task-100', 'Expected response parsed');
});

// 19. credential is not present in thrown public error message
await test('19. credential is not present in thrown public error message', async () => {
  const secret = 'super_secret_machine_key_987654321';
  let caught: any;
  try {
    await uploadNonAdvisoryOutcomeWithFetch(
      { endpointUrl: 'https://api.example.com/report', credential: `  ${secret}  `, outcome: validOutcome },
      dummyFetch
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof Error, 'Expected error thrown');
  assert(!caught.message.includes(secret), 'Secret must not be in error message');
});

console.log(`${passedTests}/${totalTests} PASSED`);
if (failedTests > 0) {
  console.log(`${failedTests} FAILED`);
  process.exit(1);
} else {
  console.log('0 FAILED');
}
