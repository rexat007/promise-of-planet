import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  executePendingTaskHttpRequest,
  PendingTaskHttpRequestError,
} from '../functions/src/peia/taskGatewayHttpRequestAdapter';
import { type PendingTaskGatewaySuccess } from '../functions/src/peia/taskGatewayContract';

/**
 * Regression suite for PEIA-16P — HTTP REQUEST ADAPTER FOUNDATION.
 * Enforces exactly 30 test units covering HTTP parsing, bearer syntax, and source invariants.
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

async function assertAdapterError(
  fn: () => Promise<unknown>,
  expectedCode: string
) {
  let thrown: unknown = null;
  try {
    await fn();
  } catch (err: unknown) {
    thrown = err;
  }
  assert(thrown !== null, `Expected error ${expectedCode} but call returned normally`);
  assert(
    thrown instanceof PendingTaskHttpRequestError,
    `Expected PendingTaskHttpRequestError, got ${(thrown as any)?.constructor?.name}`
  );
  assert(
    (thrown as PendingTaskHttpRequestError).code === expectedCode,
    `Expected code ${expectedCode}, got ${(thrown as any)?.code}`
  );
}

const dummySuccess: PendingTaskGatewaySuccess = {
  principalId: 'p-1',
  task: {
    taskId: 'task-1',
    taskType: 'CONTENT_REVIEW',
    target: {
      targetType: 'YOUTUBE_VIDEO',
      targetId: 'vid-123',
    },
    contentSnapshot: {
      title: 'Video Title',
    },
    createdAt: '2026-09-27T00:00:00.000Z',
    sourceUpdatedAt: '2026-09-27T00:00:00.000Z',
    status: 'Pending',
  },
};

async function runSuite() {
  const adapterPath = join(process.cwd(), 'functions/src/peia/taskGatewayHttpRequestAdapter.ts');
  const adapterSource = readFileSync(adapterPath, 'utf8');

  const indexPath = join(process.cwd(), 'functions/src/index.ts');
  const indexSource = readFileSync(indexPath, 'utf8');

  console.log('--- PEIA-16P 30-Test HTTP Request Adapter Audit ---');

  // 1. Existence and Export
  await test('1. executePendingTaskHttpRequest exists', () => {
    assert(typeof executePendingTaskHttpRequest === 'function', 'executePendingTaskHttpRequest is not a function');
    assert(!adapterSource.includes('firebase-admin'), 'firebase-admin import found');
    assert(!adapterSource.includes('firebase-functions'), 'firebase-functions import found');
    assert(!adapterSource.includes('onRequest'), 'onRequest found');
    assert(!adapterSource.includes('onCall'), 'onCall found');
    assert(!adapterSource.includes('getFirestore'), 'getFirestore found');
    assert(!adapterSource.includes('initializeApp'), 'initializeApp found');

    // Invariant: imports PendingTaskGatewaySuccess from './taskGatewayContract'
    assert(
      adapterSource.includes("from './taskGatewayContract'"),
      "Must import PendingTaskGatewaySuccess from './taskGatewayContract'"
    );
    assert(
      !adapterSource.includes("PendingTaskGatewaySuccess") || !adapterSource.includes("from './taskGatewayOrchestrator'"),
      "Must not import PendingTaskGatewaySuccess from './taskGatewayOrchestrator'"
    );
  });

  // 2. Arity
  await test('2. function takes exactly two arguments', () => {
    assert(executePendingTaskHttpRequest.length === 2, `Expected arity 2, got ${executePendingTaskHttpRequest.length}`);
    assert(!indexSource.includes('executePendingTaskHttpRequest'), 'index.ts must not wire the adapter');
  });

  // 3. POST accepted
  await test('3. POST is accepted', async () => {
    let called = false;
    const res = await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer token123' } },
      async () => { called = true; return dummySuccess; }
    );
    assert(called, 'Handler was not called');
    assert(res === dummySuccess, 'Unexpected response');
  });

  // 4. lowercase post rejected
  await test('4. lowercase post is rejected with HTTP_METHOD_NOT_ALLOWED', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'post', headers: { Authorization: 'Bearer token123' } },
        async () => dummySuccess
      ),
      'HTTP_METHOD_NOT_ALLOWED'
    );
  });

  // 5. GET rejected
  await test('5. GET rejected with HTTP_METHOD_NOT_ALLOWED', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'GET', headers: { Authorization: 'Bearer token123' } },
        async () => dummySuccess
      ),
      'HTTP_METHOD_NOT_ALLOWED'
    );
  });

  // 6. undefined method rejected
  await test('6. undefined method rejected with HTTP_METHOD_NOT_ALLOWED', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: undefined, headers: { Authorization: 'Bearer token123' } },
        async () => dummySuccess
      ),
      'HTTP_METHOD_NOT_ALLOWED'
    );
  });

  // 7. undefined body accepted
  await test('7. undefined body accepted', async () => {
    let called = false;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: undefined },
      async () => { called = true; return dummySuccess; }
    );
    assert(called, 'Handler was not called for undefined body');
  });

  // 8. null body accepted
  await test('8. null body accepted', async () => {
    let called = false;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: null },
      async () => { called = true; return dummySuccess; }
    );
    assert(called, 'Handler was not called for null body');
  });

  // 9. empty object body accepted
  await test('9. empty object body accepted', async () => {
    let called = false;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: {} },
      async () => { called = true; return dummySuccess; }
    );
    assert(called, 'Handler was not called for empty object body');

    // Object.create(null) also passes
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: Object.create(null) },
      async () => { return dummySuccess; }
    );
  });

  // 10. non-empty object body rejected
  await test('10. non-empty object body rejected with HTTP_BODY_NOT_EMPTY', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: { taskId: '123' } },
        async () => dummySuccess
      ),
      'HTTP_BODY_NOT_EMPTY'
    );
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: { key: 'value' } },
        async () => dummySuccess
      ),
      'HTTP_BODY_NOT_EMPTY'
    );
    assert(!adapterSource.includes('taskId'), 'Adapter source must not contain taskId');
    assert(!adapterSource.includes('principalId'), 'Adapter source must not contain principalId');
    assert(!adapterSource.includes('workerId'), 'Adapter source must not contain workerId');
  });

  // 11. array body rejected
  await test('11. array body rejected with HTTP_BODY_NOT_EMPTY', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: [] },
        async () => dummySuccess
      ),
      'HTTP_BODY_NOT_EMPTY'
    );
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: ['item'] },
        async () => dummySuccess
      ),
      'HTTP_BODY_NOT_EMPTY'
    );
  });

  // 12. primitive body and non-plain object (Date, Map, Set) rejected
  await test('12. primitive body rejected with HTTP_BODY_NOT_EMPTY', async () => {
    // Primitives
    for (const prim of ['string', '', 123, 0, true, false]) {
      await assertAdapterError(
        () => executePendingTaskHttpRequest(
          { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: prim },
          async () => dummySuccess
        ),
        'HTTP_BODY_NOT_EMPTY'
      );
    }

    // Non-plain objects: Date, Map, Set
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: new Date() },
        async () => dummySuccess
      ),
      'HTTP_BODY_NOT_EMPTY'
    );
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: new Map() },
        async () => dummySuccess
      ),
      'HTTP_BODY_NOT_EMPTY'
    );
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token123' }, body: new Set() },
        async () => dummySuccess
      ),
      'HTTP_BODY_NOT_EMPTY'
    );
  });

  // 13. missing Authorization rejected
  await test('13. missing Authorization rejected with HTTP_AUTHORIZATION_MISSING', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: {} },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_MISSING'
    );
  });

  // 14. canonical Authorization key accepted
  await test('14. canonical Authorization key accepted', async () => {
    let received: any = null;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer token-canonical' } },
      async (inp) => { received = inp; return dummySuccess; }
    );
    assert(received?.credential === 'token-canonical', 'Canonical Authorization header not received');
  });

  // 15. lowercase authorization key accepted
  await test('15. lowercase authorization key accepted', async () => {
    let received: any = null;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { authorization: 'Bearer token-lowercase' } },
      async (inp) => { received = inp; return dummySuccess; }
    );
    assert(received?.credential === 'token-lowercase', 'Lowercase authorization header not received');
  });

  // 16. mixed-case authorization key accepted
  await test('16. mixed-case authorization key accepted', async () => {
    let received: any = null;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { AuThOrIzAtIoN: 'Bearer token-mixed' } },
      async (inp) => { received = inp; return dummySuccess; }
    );
    assert(received?.credential === 'token-mixed', 'Mixed-case authorization header not received');
  });

  // 17. duplicate case-insensitive Authorization keys rejected
  await test('17. duplicate case-insensitive Authorization keys rejected with HTTP_AUTHORIZATION_INVALID', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token-1',
            authorization: 'Bearer token-2',
          },
        },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
  });

  // 18. non-string Authorization value rejected
  await test('18. non-string Authorization value rejected with HTTP_AUTHORIZATION_INVALID', async () => {
    for (const val of [123, true, {}, [], null, undefined]) {
      await assertAdapterError(
        () => executePendingTaskHttpRequest(
          { method: 'POST', headers: { Authorization: val } },
          async () => dummySuccess
        ),
        'HTTP_AUTHORIZATION_INVALID'
      );
    }
  });

  // 19. `Bearer token` shape accepted
  await test('19. `Bearer token` shape accepted', async () => {
    let received: any = null;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer standard-token' } },
      async (inp) => { received = inp; return dummySuccess; }
    );
    assert(received?.credential === 'standard-token', 'Bearer token shape not accepted');
  });

  // 20. bearer scheme is case-insensitive
  await test('20. bearer scheme is case-insensitive', async () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'bEaReR']) {
      let received: any = null;
      await executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: `${scheme} case-token` } },
        async (inp) => { received = inp; return dummySuccess; }
      );
      assert(received?.credential === 'case-token', `Scheme ${scheme} failed to extract credential`);
    }
  });

  // 21. missing space rejected
  await test('21. missing space rejected', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearertoken' } },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
  });

  // 22. multiple spaces rejected
  await test('22. multiple spaces rejected', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer  token' } },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer   token' } },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
  });

  // 23. tab separator rejected
  await test('23. tab separator rejected', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer\ttoken' } },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
  });

  // 24. leading/trailing whitespace rejected
  await test('24. leading/trailing whitespace rejected', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: ' Bearer token' } },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token ' } },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
  });

  // 25. empty credential rejected
  await test('25. empty credential rejected', async () => {
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer ' } },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
    await assertAdapterError(
      () => executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer' } },
        async () => dummySuccess
      ),
      'HTTP_AUTHORIZATION_INVALID'
    );
  });

  // 26. adapter does NOT enforce peia_v1 credential format
  await test('26. adapter does NOT enforce peia_v1 credential format: a syntactically valid bearer value such as Bearer opaque-test-value must reach the handler unchanged', async () => {
    let received: any = null;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer opaque-test-value' } },
      async (inp) => { received = inp; return dummySuccess; }
    );
    assert(received?.credential === 'opaque-test-value', 'Opaque test value was not passed unchanged');
    assert(!adapterSource.includes('peia_v1'), 'Adapter source must not enforce peia_v1 format');
  });

  // 27. handler called exactly once for valid request
  await test('27. handler called exactly once for valid request', async () => {
    let callCount = 0;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer token-test' } },
      async () => { callCount++; return dummySuccess; }
    );
    assert(callCount === 1, `Expected 1 call, got ${callCount}`);
    assert(!adapterSource.includes('console.log'), 'Adapter must not contain console.log');
    assert(!adapterSource.includes('console.error'), 'Adapter must not contain console.error');
  });

  // 28. handler receives exactly: { credential: extractedCredential } with no extra keys
  await test('28. handler receives exactly: { credential: extractedCredential } with no extra keys', async () => {
    let capturedInput: any = null;
    await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer secret-val-999' } },
      async (inp) => { capturedInput = inp; return dummySuccess; }
    );
    assert(capturedInput !== null, 'Handler was not called');
    const keys = Object.keys(capturedInput);
    assert(keys.length === 1, `Expected 1 key, got ${keys.length}`);
    assert(keys[0] === 'credential', `Expected key "credential", got ${keys[0]}`);
    assert(capturedInput.credential === 'secret-val-999', 'Credential mismatch');
  });

  // 29. returned success object is exact same object reference returned by handler
  await test('29. returned success object is exact same object reference returned by handler', async () => {
    const customSuccess = { ...dummySuccess, principalId: 'custom-p-999' };
    const result = await executePendingTaskHttpRequest(
      { method: 'POST', headers: { Authorization: 'Bearer token-ref' } },
      async () => customSuccess
    );
    assert(result === customSuccess, 'Returned success object reference mismatch');
  });

  // 30. handler Error propagates exact same Error instance unchanged
  await test('30. handler Error propagates exact same Error instance unchanged', async () => {
    const infraError = new Error('GATEWAY_DOWN');
    let thrown: unknown = null;
    try {
      await executePendingTaskHttpRequest(
        { method: 'POST', headers: { Authorization: 'Bearer token-err' } },
        async () => { throw infraError; }
      );
    } catch (err: unknown) {
      thrown = err;
    }
    assert(thrown === infraError, 'Exact Error instance must propagate unchanged');
    assert(!/\bcatch\b/.test(adapterSource), 'Adapter must not have catch blocks wrapping handler');
  });

  // Final count gate
  assert(totalTests === 30, `Expected exactly 30 tests, found ${totalTests}`);
  assert(passedTests === 30, `Expected exactly 30 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / ${totalTests - passedTests} failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
