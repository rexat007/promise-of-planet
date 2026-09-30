import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  uploadAdvisoryResultWithFetch,
  uploadAdvisoryResult,
  AdvisoryResultHttpUploadTransportError,
  type AdvisoryResultHttpUploadInput,
  type AdvisoryResultHttpFetchResponse,
  type AdvisoryResultHttpFetchInit,
  type AdvisoryResultHttpFetch,
  type AdvisoryResultHttpUploadTransportErrorCode,
} from '../peia-worker/src/advisoryResultHttpUploadTransport';
import {
  AdvisoryResultUploadContractError,
} from '../peia-worker/src/advisoryResultUploadContract';
import {
  AITaskType,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
} from '../src/types/aiReview';
import type {
  PEIAAdvisoryResult,
  PEIAAdvisoryFinding,
} from '../peia-worker/src/advisoryResultContract';

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

function assertTransportError(
  fn: () => unknown,
  expectedCode: AdvisoryResultHttpUploadTransportErrorCode,
  expectedMessage: string
): AdvisoryResultHttpUploadTransportError {
  try {
    fn();
  } catch (err: unknown) {
    if (err instanceof AdvisoryResultHttpUploadTransportError) {
      if (err.code !== expectedCode) {
        throw new Error(
          `Expected transport error code "${expectedCode}", but received "${err.code}" (message: "${err.message}")`
        );
      }
      if (err.message !== expectedMessage) {
        throw new Error(
          `Expected transport error message "${expectedMessage}", but received "${err.message}"`
        );
      }
      return err;
    }
    throw err;
  }
  throw new Error(
    `Expected AdvisoryResultHttpUploadTransportError with code "${expectedCode}", but function returned normally.`
  );
}

async function assertAsyncTransportError(
  fn: () => Promise<unknown>,
  expectedCode: AdvisoryResultHttpUploadTransportErrorCode,
  expectedMessage: string
): Promise<AdvisoryResultHttpUploadTransportError> {
  try {
    await fn();
  } catch (err: unknown) {
    if (err instanceof AdvisoryResultHttpUploadTransportError) {
      if (err.code !== expectedCode) {
        throw new Error(
          `Expected transport error code "${expectedCode}", but received "${err.code}" (message: "${err.message}")`
        );
      }
      if (err.message !== expectedMessage) {
        throw new Error(
          `Expected transport error message "${expectedMessage}", but received "${err.message}"`
        );
      }
      return err;
    }
    throw err;
  }
  throw new Error(
    `Expected AdvisoryResultHttpUploadTransportError with code "${expectedCode}", but promise resolved normally.`
  );
}

const canonicalFindings: readonly PEIAAdvisoryFinding[] = [
  {
    code: 'METRIC_VERIFICATION_NEEDED',
    severity: AIReviewSeverity.Info,
    message: 'Rainfall metrics require human verification.',
  },
];

const canonicalValidResult: PEIAAdvisoryResult = {
  task: {
    taskId: 'task-canonical-upload-1',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-987',
      sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
  assessment: {
    summary: 'Upload review complete.',
    findings: canonicalFindings,
  },
};

async function runSuite() {
  console.log('--- PEIA-18G 44-Test HTTP Result Upload Transport Foundation Audit ---');

  // 1. uploadAdvisoryResultWithFetch exists
  await test('1. uploadAdvisoryResultWithFetch exists', () => {
    assert(
      typeof uploadAdvisoryResultWithFetch === 'function',
      'uploadAdvisoryResultWithFetch must be a function'
    );
  });

  // 2. uploadAdvisoryResult exists
  await test('2. uploadAdvisoryResult exists', () => {
    assert(
      typeof uploadAdvisoryResult === 'function',
      'uploadAdvisoryResult must be a function'
    );
  });

  // 3. input contract exactly endpointUrl + credential + result
  await test('3. input contract exactly endpointUrl + credential + result', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+interface\s+AdvisoryResultHttpUploadInput\s*\{([^}]+)\}/
    );
    assert(match !== null, 'Must match AdvisoryResultHttpUploadInput');
    const fields = match![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    assert(fields.length === 3, `Expected exactly 3 fields in input contract, got ${fields.length}`);
    assert(fields[0].includes('readonly endpointUrl: string'), 'Field 1 must be endpointUrl');
    assert(fields[1].includes('readonly credential: string'), 'Field 2 must be credential');
    assert(fields[2].includes('readonly result: PEIAAdvisoryResult'), 'Field 3 must be result');
  });

  // 4. fetch response contract exactly status + json
  await test('4. fetch response contract exactly status + json', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+interface\s+AdvisoryResultHttpFetchResponse\s*\{([^}]+)\}/
    );
    assert(match !== null, 'Must match AdvisoryResultHttpFetchResponse');
    const fields = match![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    assert(fields.length === 2, `Expected exactly 2 fields in fetch response contract, got ${fields.length}`);
    assert(fields[0].includes('readonly status: number'), 'Field 1 must be status');
    assert(fields[1].includes('json(): Promise<unknown>'), 'Field 2 must be json()');
  });

  // 5. fetch init contract exactly method + headers + body
  await test('5. fetch init contract exactly method + headers + body', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+interface\s+AdvisoryResultHttpFetchInit\s*\{([^}]+)\}/
    );
    assert(match !== null, 'Must match AdvisoryResultHttpFetchInit');
    const fields = match![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    assert(fields.length === 3, `Expected exactly 3 fields in fetch init contract, got ${fields.length}`);
    assert(fields[0].includes("readonly method: 'POST'"), 'Field 1 must be method');
    assert(fields[1].includes('readonly headers: Readonly<Record<string, string>>'), 'Field 2 must be headers');
    assert(fields[2].includes('readonly body: string'), 'Field 3 must be body');
  });

  // 6. fetch type exists with expected signature
  await test('6. fetch type exists with expected signature', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(
      source.includes('export type AdvisoryResultHttpFetch ='),
      'Must export AdvisoryResultHttpFetch type'
    );
    assert(source.includes('url: string'), 'Must take url: string');
    assert(source.includes('init: AdvisoryResultHttpFetchInit'), 'Must take init: AdvisoryResultHttpFetchInit');
    assert(source.includes('Promise<AdvisoryResultHttpFetchResponse>'), 'Must return Promise<AdvisoryResultHttpFetchResponse>');
  });

  // 7. error vocabulary exactly six codes
  await test('7. error vocabulary exactly six codes', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+type\s+AdvisoryResultHttpUploadTransportErrorCode\s*=\s*([\s\S]*?);/
    );
    assert(match !== null, 'Must match AdvisoryResultHttpUploadTransportErrorCode');
    const body = match![1];

    const codes = body
      .split('|')
      .map((c) => c.trim().replace(/['"]/g, ''))
      .filter((c) => c.length > 0);

    assert(codes.length === 6, `Expected exactly 6 error codes, got ${codes.length}`);
    const expectedCodes = [
      'INVALID_ENDPOINT',
      'INVALID_CREDENTIAL',
      'REQUEST_SERIALIZATION_FAILED',
      'NETWORK_FAILURE',
      'UNEXPECTED_HTTP_STATUS',
      'RESPONSE_READ_FAILED',
    ];
    for (const ec of expectedCodes) {
      assert(codes.includes(ec), `Must include error code ${ec}`);
    }
  });

  // 8. exact error messages
  await test('8. exact error messages', () => {
    assertTransportError(
      () => {
        throw new AdvisoryResultHttpUploadTransportError('INVALID_ENDPOINT', 'Invalid result upload endpoint.');
      },
      'INVALID_ENDPOINT',
      'Invalid result upload endpoint.'
    );
    assertTransportError(
      () => {
        throw new AdvisoryResultHttpUploadTransportError('INVALID_CREDENTIAL', 'Invalid machine credential.');
      },
      'INVALID_CREDENTIAL',
      'Invalid machine credential.'
    );
    assertTransportError(
      () => {
        throw new AdvisoryResultHttpUploadTransportError('REQUEST_SERIALIZATION_FAILED', 'Unable to serialize advisory result upload request.');
      },
      'REQUEST_SERIALIZATION_FAILED',
      'Unable to serialize advisory result upload request.'
    );
    assertTransportError(
      () => {
        throw new AdvisoryResultHttpUploadTransportError('NETWORK_FAILURE', 'Unable to reach result upload endpoint.');
      },
      'NETWORK_FAILURE',
      'Unable to reach result upload endpoint.'
    );
    assertTransportError(
      () => {
        throw new AdvisoryResultHttpUploadTransportError('UNEXPECTED_HTTP_STATUS', 'Result upload endpoint rejected the request.');
      },
      'UNEXPECTED_HTTP_STATUS',
      'Result upload endpoint rejected the request.'
    );
    assertTransportError(
      () => {
        throw new AdvisoryResultHttpUploadTransportError('RESPONSE_READ_FAILED', 'Unable to read result upload response.');
      },
      'RESPONSE_READ_FAILED',
      'Unable to read result upload response.'
    );
  });

  // 9. valid HTTPS endpoint accepted
  await test('9. valid HTTPS endpoint accepted', async () => {
    let called = false;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      called = true;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    const res = await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://api.example.com/upload',
        credential: 'valid-token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(called, 'Fetcher should be invoked');
    assert(res.kind === 'ACCEPTED', 'Should return accepted');
  });

  // 10. localhost HTTP accepted
  await test('10. localhost HTTP accepted', async () => {
    let called = false;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      called = true;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'http://localhost:3000/upload',
        credential: 'valid-token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(called, 'Fetcher should be invoked');
  });

  // 11. 127.0.0.1 HTTP accepted
  await test('11. 127.0.0.1 HTTP accepted', async () => {
    let called = false;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      called = true;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'http://127.0.0.1:8080/upload',
        credential: 'valid-token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(called, 'Fetcher should be invoked');
  });

  // 12. ::1 HTTP accepted
  await test('12. ::1 HTTP accepted', async () => {
    let called = false;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      called = true;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'http://[::1]/upload',
        credential: 'valid-token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(called, 'Fetcher should be invoked');
  });

  // 13. non-loopback HTTP rejected
  await test('13. non-loopback HTTP rejected', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => ({}),
    });

    await assertAsyncTransportError(
      () =>
        uploadAdvisoryResultWithFetch(
          {
            endpointUrl: 'http://example.com/upload',
            credential: 'valid-token',
            result: canonicalValidResult,
          },
          fetcher
        ),
      'INVALID_ENDPOINT',
      'Invalid result upload endpoint.'
    );
  });

  // 14. invalid protocols rejected
  await test('14. invalid protocols rejected', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => ({}),
    });

    const badUrls = ['ftp://example.com', 'file:///etc/passwd', 'data:,hello', 'javascript:alert(1)', 'ws://example.com', 'wss://example.com'];
    for (const url of badUrls) {
      await assertAsyncTransportError(
        () =>
          uploadAdvisoryResultWithFetch(
            {
              endpointUrl: url,
              credential: 'valid-token',
              result: canonicalValidResult,
            },
            fetcher
          ),
        'INVALID_ENDPOINT',
        'Invalid result upload endpoint.'
      );
    }
  });

  // 15. relative endpoint rejected
  await test('15. relative endpoint rejected', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => ({}),
    });

    await assertAsyncTransportError(
      () =>
        uploadAdvisoryResultWithFetch(
          {
            endpointUrl: '/api/upload',
            credential: 'valid-token',
            result: canonicalValidResult,
          },
          fetcher
        ),
      'INVALID_ENDPOINT',
      'Invalid result upload endpoint.'
    );
  });

  // 16. blank/padded endpoint rejected
  await test('16. blank/padded endpoint rejected', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => ({}),
    });

    const badEndpoints = ['', '   ', 'https://example.com/upload '];
    for (const ep of badEndpoints) {
      await assertAsyncTransportError(
        () =>
          uploadAdvisoryResultWithFetch(
            {
              endpointUrl: ep,
              credential: 'valid-token',
              result: canonicalValidResult,
            },
            fetcher
          ),
        'INVALID_ENDPOINT',
        'Invalid result upload endpoint.'
      );
    }
  });

  // 17. blank/whitespace/padded credential rejected
  await test('17. blank/whitespace/padded credential rejected', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => ({}),
    });

    const badCreds = ['', '   ', ' token '];
    for (const cred of badCreds) {
      await assertAsyncTransportError(
        () =>
          uploadAdvisoryResultWithFetch(
            {
              endpointUrl: 'https://example.com/upload',
              credential: cred,
              result: canonicalValidResult,
            },
            fetcher
          ),
        'INVALID_CREDENTIAL',
        'Invalid machine credential.'
      );
    }
  });

  // 18. credential with internal whitespace/CR/LF rejected
  await test('18. credential with internal whitespace/CR/LF rejected', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => ({}),
    });

    const badCreds = ['token 123', 'token\n123', 'token\r123'];
    for (const cred of badCreds) {
      await assertAsyncTransportError(
        () =>
          uploadAdvisoryResultWithFetch(
            {
              endpointUrl: 'https://example.com/upload',
              credential: cred,
              result: canonicalValidResult,
            },
            fetcher
          ),
        'INVALID_CREDENTIAL',
        'Invalid machine credential.'
      );
    }
  });

  // 19. credential does not require peia_v1_ prefix
  await test('19. credential does not require peia_v1_ prefix', async () => {
    let called = false;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      called = true;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'some-random-token-without-prefix',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(called, 'Fetcher called');
  });

  // 20. invalid endpoint prevents request creation/fetch
  await test('20. invalid endpoint prevents request creation/fetch', async () => {
    let fetchCount = 0;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      fetchCount++;
      return { status: 200, json: async () => ({}) };
    };

    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    const fnMatch = source.match(
      /export\s+async\s+function\s+uploadAdvisoryResultWithFetch\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(fnMatch !== null, 'Must find function body');
    const body = fnMatch![1];

    const validateEpIdx = body.indexOf('validateEndpointUrl');
    const createReqIdx = body.indexOf('createAdvisoryResultUploadRequest');
    const fetcherIdx = body.indexOf('fetcher(');

    assert(validateEpIdx !== -1 && createReqIdx !== -1 && fetcherIdx !== -1, 'Must find function calls');
    assert(validateEpIdx < createReqIdx, 'validateEndpointUrl must occur before createAdvisoryResultUploadRequest');
    assert(validateEpIdx < fetcherIdx, 'validateEndpointUrl must occur before fetcher');

    await assertAsyncTransportError(
      () =>
        uploadAdvisoryResultWithFetch(
          {
            endpointUrl: 'invalid-url',
            credential: 'valid-token',
            result: canonicalValidResult,
          },
          fetcher
        ),
      'INVALID_ENDPOINT',
      'Invalid result upload endpoint.'
    );
    assert(fetchCount === 0, 'Fetcher must not be called');
  });

  // 21. invalid credential prevents request creation/fetch
  await test('21. invalid credential prevents request creation/fetch', async () => {
    let fetchCount = 0;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      fetchCount++;
      return { status: 200, json: async () => ({}) };
    };

    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    const fnMatch = source.match(
      /export\s+async\s+function\s+uploadAdvisoryResultWithFetch\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(fnMatch !== null, 'Must find function body');
    const body = fnMatch![1];

    const validateCredIdx = body.indexOf('validateCredential');
    const createReqIdx = body.indexOf('createAdvisoryResultUploadRequest');
    const fetcherIdx = body.indexOf('fetcher(');

    assert(validateCredIdx !== -1 && createReqIdx !== -1 && fetcherIdx !== -1, 'Must find calls');
    assert(validateCredIdx < createReqIdx, 'validateCredential must occur before createAdvisoryResultUploadRequest');
    assert(validateCredIdx < fetcherIdx, 'validateCredential must occur before fetcher');

    await assertAsyncTransportError(
      () =>
        uploadAdvisoryResultWithFetch(
          {
            endpointUrl: 'https://example.com/upload',
            credential: '',
            result: canonicalValidResult,
          },
          fetcher
        ),
      'INVALID_CREDENTIAL',
      'Invalid machine credential.'
    );
    assert(fetchCount === 0, 'Fetcher must not be called');
  });

  // 22. canonical request creator called structurally before serialization/fetch
  await test('22. canonical request creator called structurally before serialization/fetch', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    const createIdx = source.indexOf('createAdvisoryResultUploadRequest(input.result)');
    const stringifyIdx = source.indexOf('JSON.stringify(request)');
    const fetcherIdx = source.indexOf('fetcher(');

    assert(createIdx !== -1 && stringifyIdx !== -1 && fetcherIdx !== -1, 'Must find steps');
    assert(createIdx < stringifyIdx, 'createAdvisoryResultUploadRequest must occur before JSON.stringify');
    assert(stringifyIdx < fetcherIdx, 'JSON.stringify must occur before fetcher');
  });

  // 23. fetcher called exactly once
  await test('23. fetcher called exactly once', async () => {
    let callCount = 0;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      callCount++;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'valid-token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(callCount === 1, `Expected fetcher called exactly once, got ${callCount}`);
  });

  // 24. exact endpoint string passed unchanged
  await test('24. exact endpoint string passed unchanged', async () => {
    let receivedUrl = '';
    const targetUrl = 'https://example.com/custom-upload-endpoint?foo=bar';
    const fetcher: AdvisoryResultHttpFetch = async (url) => {
      receivedUrl = url;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: targetUrl,
        credential: 'valid-token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(receivedUrl === targetUrl, 'URL passed to fetcher must be exact');
  });

  // 25. method exactly POST
  await test('25. method exactly POST', async () => {
    let receivedMethod = '';
    const fetcher: AdvisoryResultHttpFetch = async (_, init) => {
      receivedMethod = init.method;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'valid-token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(receivedMethod === 'POST', 'Method must be POST');
  });

  // 26. Authorization exactly Bearer <credential>
  await test('26. Authorization exactly Bearer <credential>', async () => {
    let authHeader = '';
    const credential = 'secret-token-xyz';
    const fetcher: AdvisoryResultHttpFetch = async (_, init) => {
      authHeader = init.headers['Authorization'];
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential,
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(authHeader === `Bearer ${credential}`, `Expected "Bearer ${credential}", got "${authHeader}"`);
  });

  // 27. Content-Type exactly application/json
  await test('27. Content-Type exactly application/json', async () => {
    let contentType = '';
    const fetcher: AdvisoryResultHttpFetch = async (_, init) => {
      contentType = init.headers['Content-Type'];
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(contentType === 'application/json', 'Content-Type must be application/json');
  });

  // 28. Accept exactly application/json
  await test('28. Accept exactly application/json', async () => {
    let accept = '';
    const fetcher: AdvisoryResultHttpFetch = async (_, init) => {
      accept = init.headers['Accept'];
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(accept === 'application/json', 'Accept must be application/json');
  });

  // 29. headers contain exactly three headers
  await test('29. headers contain exactly three headers', async () => {
    let headerKeys: string[] = [];
    const fetcher: AdvisoryResultHttpFetch = async (_, init) => {
      headerKeys = Object.keys(init.headers);
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(headerKeys.length === 3, `Expected exactly 3 headers, got ${headerKeys.length}`);
    assert(headerKeys.includes('Authorization'), 'Must include Authorization');
    assert(headerKeys.includes('Content-Type'), 'Must include Content-Type');
    assert(headerKeys.includes('Accept'), 'Must include Accept');
  });

  // 30. fetch init contains exactly method + headers + body
  await test('30. fetch init contains exactly method + headers + body', async () => {
    let initKeys: string[] = [];
    const fetcher: AdvisoryResultHttpFetch = async (_, init) => {
      initKeys = Object.keys(init);
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'token',
        result: canonicalValidResult,
      },
      fetcher
    );
    assert(initKeys.length === 3, `Expected exactly 3 init keys, got ${initKeys.length}`);
    assert(initKeys.includes('method'), 'Must include method');
    assert(initKeys.includes('headers'), 'Must include headers');
    assert(initKeys.includes('body'), 'Must include body');
  });

  // 31. body JSON shape is exactly canonical { result }
  await test('31. body JSON shape is exactly canonical { result }', async () => {
    let capturedBody = '';
    const fetcher: AdvisoryResultHttpFetch = async (_, init) => {
      capturedBody = init.body;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'token',
        result: canonicalValidResult,
      },
      fetcher
    );

    const parsedBody = JSON.parse(capturedBody);
    const keys = Object.keys(parsedBody);
    assert(keys.length === 1, `Expected exactly 1 key in body, got ${keys.length}`);
    assert(keys[0] === 'result', 'Key must be result');
    assert(parsedBody.result.task.taskId === canonicalValidResult.task.taskId, 'Result value must match');
  });

  // 32. serialized body preserves canonical result values
  await test('32. serialized body preserves canonical result values', async () => {
    let capturedBody = '';
    const fetcher: AdvisoryResultHttpFetch = async (_, init) => {
      capturedBody = init.body;
      return {
        status: 200,
        json: async () => ({ ok: true, taskId: canonicalValidResult.task.taskId }),
      };
    };

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'token',
        result: canonicalValidResult,
      },
      fetcher
    );

    const parsed = JSON.parse(capturedBody);
    const r = parsed.result;
    assert(r.task.taskId === canonicalValidResult.task.taskId, 'taskId preserved');
    assert(r.task.taskType === canonicalValidResult.task.taskType, 'taskType preserved');
    assert(r.task.target.targetType === canonicalValidResult.task.target.targetType, 'targetType preserved');
    assert(r.task.target.targetId === canonicalValidResult.task.target.targetId, 'targetId preserved');
    assert(r.task.target.sourceUpdatedAt === canonicalValidResult.task.target.sourceUpdatedAt, 'sourceUpdatedAt preserved');
    assert(r.assessment.summary === canonicalValidResult.assessment.summary, 'summary preserved');
    assert(r.assessment.findings.length === canonicalValidResult.assessment.findings.length, 'findings preserved');
  });

  // 33. serialization failure maps exact REQUEST_SERIALIZATION_FAILED
  await test('33. serialization failure maps exact REQUEST_SERIALIZATION_FAILED', async () => {
    let fetchCalled = false;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      fetchCalled = true;
      return { status: 200, json: async () => ({}) };
    };

    const sentinelError = new Error('serialization sentinel 123');
    const maliciousFinding = Object.create(
      {
        toJSON() {
          throw sentinelError;
        },
      },
      {
        code: { value: 'VALID_CODE', enumerable: true, writable: true, configurable: true },
        severity: { value: AIReviewSeverity.Info, enumerable: true, writable: true, configurable: true },
        message: { value: 'Valid message content', enumerable: true, writable: true, configurable: true },
      }
    );

    const badResult: PEIAAdvisoryResult = {
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary ok',
        findings: [maliciousFinding],
      },
    };

    let caughtError: unknown = null;
    try {
      await uploadAdvisoryResultWithFetch(
        {
          endpointUrl: 'https://example.com/upload',
          credential: 'token',
          result: badResult,
        },
        fetcher
      );
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultHttpUploadTransportError, 'Must be AdvisoryResultHttpUploadTransportError');
    assert((caughtError as AdvisoryResultHttpUploadTransportError).code === 'REQUEST_SERIALIZATION_FAILED', 'Code must be REQUEST_SERIALIZATION_FAILED');
    assert(
      (caughtError as AdvisoryResultHttpUploadTransportError).message === 'Unable to serialize advisory result upload request.',
      'Message must be exact fixed message'
    );
    assert(!fetchCalled, 'Fetcher must not be called on serialization failure');
  });

  // 34. raw serialization error does not leak
  await test('34. raw serialization error does not leak', async () => {
    let fetchCalled = false;
    const fetcher: AdvisoryResultHttpFetch = async () => {
      fetchCalled = true;
      return { status: 200, json: async () => ({}) };
    };

    const sentinelError = new Error('raw serialization sentinel secret text 999');
    const maliciousFinding = Object.create(
      {
        toJSON() {
          throw sentinelError;
        },
      },
      {
        code: { value: 'VALID_CODE', enumerable: true, writable: true, configurable: true },
        severity: { value: AIReviewSeverity.Info, enumerable: true, writable: true, configurable: true },
        message: { value: 'Valid message content', enumerable: true, writable: true, configurable: true },
      }
    );

    const badResult: PEIAAdvisoryResult = {
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary ok',
        findings: [maliciousFinding],
      },
    };

    let caughtError: unknown = null;
    try {
      await uploadAdvisoryResultWithFetch(
        {
          endpointUrl: 'https://example.com/upload',
          credential: 'token',
          result: badResult,
        },
        fetcher
      );
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultHttpUploadTransportError, 'Must be AdvisoryResultHttpUploadTransportError');
    assert((caughtError as AdvisoryResultHttpUploadTransportError).code === 'REQUEST_SERIALIZATION_FAILED', 'Code must be REQUEST_SERIALIZATION_FAILED');
    assert(
      (caughtError as AdvisoryResultHttpUploadTransportError).message === 'Unable to serialize advisory result upload request.',
      'Message must be exact fixed message'
    );
    assert(
      !(caughtError as AdvisoryResultHttpUploadTransportError).message.includes('raw serialization sentinel secret text 999'),
      'Must not leak raw sentinel error text'
    );
    assert(!fetchCalled, 'Fetcher must not be called');
  });

  // 35. fetch rejection maps exact NETWORK_FAILURE
  await test('35. fetch rejection maps exact NETWORK_FAILURE', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => {
      throw new Error('network timeout socket hang up');
    };

    await assertAsyncTransportError(
      () =>
        uploadAdvisoryResultWithFetch(
          {
            endpointUrl: 'https://example.com/upload',
            credential: 'token',
            result: canonicalValidResult,
          },
          fetcher
        ),
      'NETWORK_FAILURE',
      'Unable to reach result upload endpoint.'
    );
  });

  // 36. raw network error does not leak
  await test('36. raw network error does not leak', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => {
      throw new Error('secret-network-stack-trace-leak');
    };

    let caughtError: unknown = null;
    try {
      await uploadAdvisoryResultWithFetch(
        {
          endpointUrl: 'https://example.com/upload',
          credential: 'token',
          result: canonicalValidResult,
        },
        fetcher
      );
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultHttpUploadTransportError, 'Must be AdvisoryResultHttpUploadTransportError');
    assert((caughtError as AdvisoryResultHttpUploadTransportError).code === 'NETWORK_FAILURE', 'Code must be NETWORK_FAILURE');
    assert(
      (caughtError as AdvisoryResultHttpUploadTransportError).message === 'Unable to reach result upload endpoint.',
      'Message must be exact fixed message'
    );
    assert(
      !(caughtError as AdvisoryResultHttpUploadTransportError).message.includes('secret-network-stack-trace-leak'),
      'Must not leak raw network error message'
    );
  });

  // 37. non-200 status maps exact UNEXPECTED_HTTP_STATUS (201, 400, 401, 403, 404, 409, 422, 429, 500, 503)
  await test('37. non-200 status maps exact UNEXPECTED_HTTP_STATUS', async () => {
    const statuses = [201, 400, 401, 403, 404, 409, 422, 429, 500, 503];
    for (const status of statuses) {
      const fetcher: AdvisoryResultHttpFetch = async () => ({
        status,
        json: async () => ({ error: 'server error' }),
      });

      await assertAsyncTransportError(
        () =>
          uploadAdvisoryResultWithFetch(
            {
              endpointUrl: 'https://example.com/upload',
              credential: 'token',
              result: canonicalValidResult,
            },
            fetcher
          ),
        'UNEXPECTED_HTTP_STATUS',
        'Result upload endpoint rejected the request.'
      );
    }
  });

  // 38. non-200 response json() is NOT called
  await test('38. non-200 response json() is NOT called', async () => {
    let jsonCallCount = 0;
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 500,
      json: async () => {
        jsonCallCount++;
        return {};
      },
    });

    let caughtError: unknown = null;
    try {
      await uploadAdvisoryResultWithFetch(
        {
          endpointUrl: 'https://example.com/upload',
          credential: 'token',
          result: canonicalValidResult,
        },
        fetcher
      );
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultHttpUploadTransportError, 'Must be AdvisoryResultHttpUploadTransportError');
    assert((caughtError as AdvisoryResultHttpUploadTransportError).code === 'UNEXPECTED_HTTP_STATUS', 'Code must be UNEXPECTED_HTTP_STATUS');
    assert(
      (caughtError as AdvisoryResultHttpUploadTransportError).message === 'Result upload endpoint rejected the request.',
      'Message must be exact fixed message'
    );
    assert(jsonCallCount === 0, `Expected json() call count 0 for non-200, got ${jsonCallCount}`);
  });

  // 39. HTTP 200 response json() called exactly once
  await test('39. HTTP 200 response json() called exactly once', async () => {
    let jsonCallCount = 0;
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => {
        jsonCallCount++;
        return { ok: true, taskId: canonicalValidResult.task.taskId };
      },
    });

    await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'token',
        result: canonicalValidResult,
      },
      fetcher
    );

    assert(jsonCallCount === 1, `Expected json() call count 1 for 200, got ${jsonCallCount}`);
  });

  // 40. response.json rejection maps exact RESPONSE_READ_FAILED
  await test('40. response.json rejection maps exact RESPONSE_READ_FAILED', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => {
        throw new Error('stream read error');
      },
    });

    await assertAsyncTransportError(
      () =>
        uploadAdvisoryResultWithFetch(
          {
            endpointUrl: 'https://example.com/upload',
            credential: 'token',
            result: canonicalValidResult,
          },
          fetcher
        ),
      'RESPONSE_READ_FAILED',
      'Unable to read result upload response.'
    );
  });

  // 41. raw response-read error does not leak
  await test('41. raw response-read error does not leak', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => {
        throw new Error('secret-stream-read-leak');
      },
    });

    let caughtError: unknown = null;
    try {
      await uploadAdvisoryResultWithFetch(
        {
          endpointUrl: 'https://example.com/upload',
          credential: 'token',
          result: canonicalValidResult,
        },
        fetcher
      );
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultHttpUploadTransportError, 'Must be AdvisoryResultHttpUploadTransportError');
    assert((caughtError as AdvisoryResultHttpUploadTransportError).code === 'RESPONSE_READ_FAILED', 'Code must be RESPONSE_READ_FAILED');
    assert(
      (caughtError as AdvisoryResultHttpUploadTransportError).message === 'Unable to read result upload response.',
      'Message must be exact fixed message'
    );
    assert(
      !(caughtError as AdvisoryResultHttpUploadTransportError).message.includes('secret-stream-read-leak'),
      'Must not leak raw read error message'
    );
  });

  // 42. valid PEIA-18F response returns ACCEPTED and exact response reference
  await test('42. valid PEIA-18F response returns ACCEPTED and exact response reference', async () => {
    const responseBody = {
      ok: true as const,
      taskId: canonicalValidResult.task.taskId,
    };
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => responseBody,
    });

    const res = await uploadAdvisoryResultWithFetch(
      {
        endpointUrl: 'https://example.com/upload',
        credential: 'token',
        result: canonicalValidResult,
      },
      fetcher
    );

    assert(res.kind === 'ACCEPTED', 'kind must be ACCEPTED');
    assert(res.value === responseBody, 'res.value must be exact reference to responseBody');
  });

  // 43. invalid PEIA-18F body propagates AdvisoryResultUploadContractError unchanged with structural proof
  await test('43. invalid PEIA-18F body propagates AdvisoryResultUploadContractError unchanged with structural proof', async () => {
    const fetcher: AdvisoryResultHttpFetch = async () => ({
      status: 200,
      json: async () => ({ ok: false }),
    });

    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    const fnMatch = source.match(
      /export\s+async\s+function\s+uploadAdvisoryResultWithFetch\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(fnMatch !== null, 'Must find function body');
    const body = fnMatch![1];

    const serializeTryIdx = body.indexOf('try {');
    const serializeCatchIdx = body.indexOf('} catch', serializeTryIdx);
    const netTryIdx = body.indexOf('try {', serializeCatchIdx);
    const netCatchIdx = body.indexOf('} catch', netTryIdx);
    const statusGateIdx = body.indexOf('response.status !== 200');
    const readTryIdx = body.indexOf('try {', netCatchIdx);
    const readCatchIdx = body.indexOf('} catch', readTryIdx);
    const parseIdx = body.indexOf('parseAdvisoryResultUploadResponse(responseBody)');

    assert(
      serializeTryIdx !== -1 &&
      serializeCatchIdx !== -1 &&
      netTryIdx !== -1 &&
      netCatchIdx !== -1 &&
      statusGateIdx !== -1 &&
      readTryIdx !== -1 &&
      readCatchIdx !== -1 &&
      parseIdx !== -1,
      'Must find all structural blocks'
    );

    assert(serializeTryIdx < serializeCatchIdx, 'serialize try before catch');
    assert(serializeCatchIdx < netTryIdx, 'serialize catch before network try');
    assert(netTryIdx < netCatchIdx, 'network try before catch');
    assert(netCatchIdx < statusGateIdx, 'status gate after network try/catch');
    assert(statusGateIdx < readTryIdx, 'read try after status gate');
    assert(readTryIdx < readCatchIdx, 'read try before catch');
    assert(readCatchIdx < parseIdx, 'parser invocation must be AFTER the closing boundary of response-read catch');

    const codeAfterParser = body.substring(parseIdx);
    assert(!codeAfterParser.includes('catch'), 'Parser invocation must not be followed by any catch block');

    let caughtError: unknown = null;
    try {
      await uploadAdvisoryResultWithFetch(
        {
          endpointUrl: 'https://example.com/upload',
          credential: 'token',
          result: canonicalValidResult,
        },
        fetcher
      );
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must be AdvisoryResultUploadContractError');
    assert(!(caughtError instanceof AdvisoryResultHttpUploadTransportError), 'Must NOT be wrapped in transport error');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.',
      'Message must be exact fixed message'
    );
  });

  // 44. final self-contained source invariant + exact test-count gate
  await test('44. final self-contained source invariant + exact test-count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultHttpUploadTransport.ts');
    const source = readFileSync(filePath, 'utf8');

    // A. EXACT INPUT CONTRACT
    const inputMatch = source.match(
      /export\s+interface\s+AdvisoryResultHttpUploadInput\s*\{([^}]+)\}/
    );
    assert(inputMatch !== null, 'Match input contract');
    const inputFields = inputMatch![1].split(';').map(s => s.trim()).filter(s => s.length > 0);
    assert(inputFields.length === 3, 'Input contract has 3 fields');
    assert(inputFields[0].includes('readonly endpointUrl: string'), 'Field 1');
    assert(inputFields[1].includes('readonly credential: string'), 'Field 2');
    assert(inputFields[2].includes('readonly result: PEIAAdvisoryResult'), 'Field 3');

    // B. EXACT FETCH RESPONSE CONTRACT
    const respMatch = source.match(
      /export\s+interface\s+AdvisoryResultHttpFetchResponse\s*\{([^}]+)\}/
    );
    assert(respMatch !== null, 'Match fetch response contract');
    const respFields = respMatch![1].split(';').map(s => s.trim()).filter(s => s.length > 0);
    assert(respFields.length === 2, 'Fetch response has 2 members');
    assert(respFields[0].includes('readonly status: number'), 'Member 1');
    assert(respFields[1].includes('json(): Promise<unknown>'), 'Member 2');

    // C. EXACT FETCH INIT CONTRACT
    const initMatch = source.match(
      /export\s+interface\s+AdvisoryResultHttpFetchInit\s*\{([^}]+)\}/
    );
    assert(initMatch !== null, 'Match fetch init contract');
    const initFields = initMatch![1].split(';').map(s => s.trim()).filter(s => s.length > 0);
    assert(initFields.length === 3, 'Fetch init has 3 members');
    assert(initFields[0].includes("readonly method: 'POST'"), 'Member 1');
    assert(initFields[1].includes('readonly headers: Readonly<Record<string, string>>'), 'Member 2');
    assert(initFields[2].includes('readonly body: string'), 'Member 3');

    // D. EXACT FETCH TYPE
    assert(source.includes('export type AdvisoryResultHttpFetch ='), 'Fetch type exported');
    assert(source.includes('url: string'), 'Fetch type url');
    assert(source.includes('init: AdvisoryResultHttpFetchInit'), 'Fetch type init');
    assert(source.includes('Promise<AdvisoryResultHttpFetchResponse>'), 'Fetch type return');

    // E. EXACT ERROR VOCABULARY
    const codeMatch = source.match(
      /export\s+type\s+AdvisoryResultHttpUploadTransportErrorCode\s*=\s*([\s\S]*?);/
    );
    assert(codeMatch !== null, 'Match error codes');
    const codes = codeMatch![1].split('|').map(s => s.trim().replace(/['"]/g, '')).filter(s => s.length > 0);
    assert(codes.length === 6, 'Exactly 6 error codes');
    const expectedCodes = [
      'INVALID_ENDPOINT',
      'INVALID_CREDENTIAL',
      'REQUEST_SERIALIZATION_FAILED',
      'NETWORK_FAILURE',
      'UNEXPECTED_HTTP_STATUS',
      'RESPONSE_READ_FAILED',
    ];
    for (const ec of expectedCodes) {
      assert(codes.includes(ec), `Contains ${ec}`);
    }

    // F. EXACT FIXED MESSAGES
    assert(source.includes('Invalid result upload endpoint.'), 'Msg 1');
    assert(source.includes('Invalid machine credential.'), 'Msg 2');
    assert(source.includes('Unable to serialize advisory result upload request.'), 'Msg 3');
    assert(source.includes('Unable to reach result upload endpoint.'), 'Msg 4');
    assert(source.includes('Result upload endpoint rejected the request.'), 'Msg 5');
    assert(source.includes('Unable to read result upload response.'), 'Msg 6');

    // G. ENDPOINT POLICY
    assert(source.includes("typeof endpointUrl !== 'string'"), 'Endpoint type check');
    assert(source.includes('endpointUrl.length === 0'), 'Endpoint length check');
    assert(source.includes('endpointUrl !== endpointUrl.trim()'), 'Endpoint trim check');
    assert(source.includes('new URL(endpointUrl)'), 'Endpoint URL constructor');
    assert(source.includes("protocol === 'https:'"), 'HTTPS check');
    assert(source.includes("protocol === 'http:'"), 'HTTP check');
    assert(source.includes('localhost'), 'localhost check');
    assert(source.includes('127.0.0.1'), '127.0.0.1 check');
    assert(source.includes('::1'), '::1 check');
    assert(source.includes('[::1]'), '[::1] check');
    assert(source.includes('return endpointUrl;'), 'Returns endpointUrl');

    // H. CREDENTIAL POLICY
    assert(source.includes("typeof credential !== 'string'"), 'Credential type check');
    assert(source.includes('credential.length === 0'), 'Credential length check');
    assert(source.includes('credential !== credential.trim()'), 'Credential trim check');
    assert(source.includes('/\\s/.test(credential)'), 'Credential whitespace check');
    assert(source.includes("credential.includes('\\r')"), 'Credential CR check');
    assert(source.includes("credential.includes('\\n')"), 'Credential LF check');
    assert(source.includes('return credential;'), 'Returns credential');
    assert(!source.includes('peia_v1_'), 'No peia_v1_ prefix requirement');

    // I. STRICT EXECUTION ORDER & COUNTS
    const fnMatch = source.match(
      /export\s+async\s+function\s+uploadAdvisoryResultWithFetch\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(fnMatch !== null, 'Match uploadAdvisoryResultWithFetch');
    const fnBody = fnMatch![1];

    const valEp = fnBody.indexOf('validateEndpointUrl(input.endpointUrl)');
    const valCred = fnBody.indexOf('validateCredential(input.credential)');
    const createReq = fnBody.indexOf('createAdvisoryResultUploadRequest(input.result)');
    const stringify = fnBody.indexOf('JSON.stringify(request)');
    const fetchCall = fnBody.indexOf('fetcher(input.endpointUrl');

    assert(valEp !== -1 && valCred !== -1 && createReq !== -1 && stringify !== -1 && fetchCall !== -1, 'Find execution steps');
    assert(valEp < valCred, 'valEp < valCred');
    assert(valCred < createReq, 'valCred < createReq');
    assert(createReq < stringify, 'createReq < stringify');
    assert(stringify < fetchCall, 'stringify < fetchCall');

    const countMatches = (str: string, sub: string) => (str.match(new RegExp(sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    assert(countMatches(fnBody, 'createAdvisoryResultUploadRequest(input.result)') === 1, 'createAdvisoryResultUploadRequest count === 1');
    assert(countMatches(fnBody, 'JSON.stringify(request)') === 1, 'JSON.stringify(request) count === 1');
    assert(countMatches(fnBody, 'fetcher(input.endpointUrl') === 1, 'fetcher call count === 1');

    // J. EXACT HTTP INIT (Structural proof)
    const fetchCallFullIdx = fnBody.indexOf('fetcher(');
    assert(fetchCallFullIdx !== -1, 'Find fetcher call');
    const fetchArgOpen = fnBody.indexOf('{', fetchCallFullIdx);
    assert(fetchArgOpen !== -1, 'Find fetch init object');
    const fetchArgClose = fnBody.indexOf('});', fetchArgOpen);
    assert(fetchArgClose !== -1, 'Find fetch init closing');
    const fetchInitBlock = fnBody.substring(fetchArgOpen, fetchArgClose);

    assert(fetchInitBlock.includes('method:'), 'Init has method');
    assert(fetchInitBlock.includes('headers:'), 'Init has headers');
    assert(fetchInitBlock.includes('body'), 'Init has body');
    assert(fetchInitBlock.includes("method: 'POST'"), 'Method is POST');

    const headersOpen = fetchInitBlock.indexOf('headers:');
    assert(headersOpen !== -1, 'Find headers property');
    const braceOpen = fetchInitBlock.indexOf('{', headersOpen + 8);
    const braceClose = fetchInitBlock.lastIndexOf('}');
    assert(braceClose !== -1, 'Find headers close brace');
    const headersBlock = fetchInitBlock.substring(braceOpen + 1, braceClose);

    const authCount = (headersBlock.match(/Authorization\s*:/g) || []).length;
    const ctCount = (headersBlock.match(/(?:Content-Type|'Content-Type')\s*:/g) || []).length;
    const acceptCount = (headersBlock.match(/Accept\s*:/g) || []).length;
    assert(authCount === 1, 'Exactly one Authorization header');
    assert(ctCount === 1, 'Exactly one Content-Type header');
    assert(acceptCount === 1, 'Exactly one Accept header');

    assert(headersBlock.includes('Authorization: `Bearer ${input.credential}`'), 'Authorization header exact');
    assert(headersBlock.includes("'Content-Type': 'application/json'"), 'Content-Type header exact');
    assert(headersBlock.includes("Accept: 'application/json'"), 'Accept header exact');

    // K. BODY OWNERSHIP
    assert(countMatches(fnBody, 'createAdvisoryResultUploadRequest(input.result)') === 1, 'createAdvisoryResultUploadRequest once');
    assert(countMatches(fnBody, 'JSON.stringify(request)') === 1, 'JSON.stringify(request) once');
    assert(!fnBody.includes('result: input.result'), 'No independent envelope construction');
    assert(!fnBody.includes('JSON.stringify(input.result)'), 'No direct result stringify');
    assert(!fnBody.includes('JSON.stringify(input)'), 'No direct input stringify');

    // L. SERIALIZATION ERROR BOUNDARY (Structural try/catch proof)
    const serTry = fnBody.indexOf('try {', stringify - 100);
    const serStringify = fnBody.indexOf('JSON.stringify(request)', serTry);
    const serCatch = fnBody.indexOf('} catch', serStringify);
    const netTry = fnBody.indexOf('try {', serCatch);

    assert(serTry !== -1 && serStringify !== -1 && serCatch !== -1 && netTry !== -1, 'Find serialization boundary markers');
    assert(serTry < serStringify, 'serialization try < JSON.stringify');
    assert(serStringify < serCatch, 'JSON.stringify < serialization catch');
    assert(serCatch < netTry, 'serialization catch < network try');

    const serCatchBlock = fnBody.substring(serCatch, netTry);
    assert(serCatchBlock.includes('REQUEST_SERIALIZATION_FAILED'), 'REQUEST_SERIALIZATION_FAILED in serialization catch');
    assert(serCatchBlock.includes('Unable to serialize advisory result upload request.'), 'Exact message in serialization catch');

    // M. NETWORK ERROR BOUNDARY (Structural try/catch proof)
    const netFetchCall = fnBody.indexOf('fetcher(', netTry);
    const netCatch = fnBody.indexOf('} catch', netFetchCall);
    const statusGate = fnBody.indexOf('response.status !== 200');

    assert(netTry !== -1 && netFetchCall !== -1 && netCatch !== -1 && statusGate !== -1, 'Find network boundary markers');
    assert(netTry < netFetchCall, 'network try < fetcher call');
    assert(netFetchCall < netCatch, 'fetcher call < network catch');
    assert(netCatch < statusGate, 'network catch < status gate');

    const netCatchBlock = fnBody.substring(netCatch, statusGate);
    assert(netCatchBlock.includes('NETWORK_FAILURE'), 'NETWORK_FAILURE in network catch');
    assert(netCatchBlock.includes('Unable to reach result upload endpoint.'), 'Exact message in network catch');

    // N. STATUS GATE (Structural order proof)
    assert(netFetchCall < netCatch, 'fetch < net catch');
    assert(netCatch < statusGate, 'net catch < status gate');
    const jsonCallInStatus = fnBody.indexOf('await response.json()', statusGate);
    assert(jsonCallInStatus !== -1, 'Find await response.json() after status gate');
    assert(statusGate < jsonCallInStatus, 'status gate < response.json()');
    const non200Branch = fnBody.substring(statusGate, jsonCallInStatus);
    assert(non200Branch.includes('UNEXPECTED_HTTP_STATUS'), 'UNEXPECTED_HTTP_STATUS in status gate');
    assert(non200Branch.includes('Result upload endpoint rejected the request.'), 'Exact message in status gate');

    // O. RESPONSE READ BOUNDARY (Structural try/catch proof)
    const readTry = fnBody.indexOf('try {', statusGate);
    const readJson = fnBody.indexOf('await response.json()', readTry);
    const readCatch = fnBody.indexOf('} catch', readJson);
    const parseInvocation = fnBody.indexOf('parseAdvisoryResultUploadResponse(responseBody)', readCatch);

    assert(readTry !== -1 && readJson !== -1 && readCatch !== -1 && parseInvocation !== -1, 'Find response read boundary markers');
    assert(statusGate < readTry, 'status gate < read try');
    assert(readTry < readJson, 'read try < response.json()');
    assert(readJson < readCatch, 'response.json() < read catch');
    assert(readCatch < parseInvocation, 'read catch < parse invocation');

    const readCatchBlock = fnBody.substring(readCatch, parseInvocation);
    assert(readCatchBlock.includes('RESPONSE_READ_FAILED'), 'RESPONSE_READ_FAILED in read catch');
    assert(readCatchBlock.includes('Unable to read result upload response.'), 'Exact message in read catch');

    // P. PARSER DELEGATION (Outside transport catches)
    const codeAfterReadCatch = fnBody.substring(parseInvocation);
    assert(!codeAfterReadCatch.includes('catch'), 'Parser invocation must not be followed by any catch block');

    // Q. REAL GLOBAL FETCH ADAPTER (Strict invocation count proof)
    const realFnMatch = source.match(
      /export\s+async\s+function\s+uploadAdvisoryResult\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(realFnMatch !== null, 'Match uploadAdvisoryResult');
    const realBody = realFnMatch![1];

    assert(realBody.includes("typeof globalThis.fetch !== 'function'"), 'Typeof fetch check present');
    const typeofCount = countMatches(realBody, "typeof globalThis.fetch !== 'function'");
    assert(typeofCount === 1, 'Exactly one typeof fetch check');

    const fetchCallMatches = (realBody.match(/globalThis\.fetch\s*\(/g) || []).length;
    assert(fetchCallMatches === 1, `Expected exactly 1 globalThis.fetch( invocation, found ${fetchCallMatches}`);

    assert(realBody.includes('NETWORK_FAILURE'), 'Adapter network failure');
    assert(realBody.includes('method: init.method'), 'Forwards method');
    assert(realBody.includes('headers: init.headers'), 'Forwards headers');
    assert(realBody.includes('body: init.body'), 'Forwards body');
    assert(realBody.includes('uploadAdvisoryResultWithFetch(input, productionFetch)'), 'Delegates to withFetch');

    // R–U. Forbid server/outbox/retry/metadata
    const forbidden = [
      'PEIAMachineCapability',
      'FETCH_PENDING_REVIEW_TASKS',
      'UPLOAD_ADVISORY_RESULT',
      'VerifiedMachinePrincipal',
      'MachineIdentityVerifier',
      'authorize',
      'permission',
      'role',
      'Firestore',
      'firebase',
      'onRequest',
      'onCall',
      'getFirestore',
      'initializeApp',
      'SqliteAdvisoryResultOutboxRepository',
      'LocalAdvisoryResultOutboxRepository',
      'PendingUpload',
      'localState',
      'markUploaded',
      'uploadedAt',
      'DELETE FROM',
      'UPDATE',
      'retry',
      'backoff',
      'poll',
      'setInterval',
      'setTimeout',
      'cron',
      'schedule',
      'claim',
      'lease',
      'workerLoop',
      'resultId',
      'generatedAt',
      'createdAt',
      'updatedAt',
      'queuedAt',
      'uploadedAt',
      'attemptCount',
      'retryCount',
      'lastError',
      'providerId',
      'principalId',
      'workerId',
      '...result',
      '...input',
      '...request',
      '...response',
      'structuredClone',
      'JSON.parse',
    ];
    for (const f of forbidden) {
      assert(!source.includes(f), `Production must not include forbidden token: "${f}"`);
    }

    assert(countMatches(source, 'JSON.stringify') === 1, 'JSON.stringify occurrence count === 1 in production source');
    assert(source.includes('JSON.stringify(request)'), 'Exact JSON.stringify occurrence is JSON.stringify(request)');

    // V. Final test count gate
    assert(totalTests === 44, `Expected exactly 44 tests, found ${totalTests}`);
    assert(passedTests === 43, `Expected 43 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 44, `Expected exactly 44 tests, found ${totalTests}`);
  assert(passedTests === 44, `Expected exactly 44 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
