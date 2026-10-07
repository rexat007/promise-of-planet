import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AdvisoryResultUploadRequest,
  type AdvisoryResultUploadAccepted,
  type AdvisoryResultUploadResponse,
  type AdvisoryResultUploadContractErrorCode,
  AdvisoryResultUploadContractError,
  createAdvisoryResultUploadRequest,
  validateAdvisoryResultUploadRequest,
  parseAdvisoryResultUploadResponse,
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

const canonicalFindings: readonly PEIAAdvisoryFinding[] = [
  {
    code: 'METRIC_VERIFICATION_NEEDED',
    severity: AIReviewSeverity.Info,
    message: 'Rainfall metrics require human verification against official records.',
    evidenceIds: ['EPA::rain-metrics-2026'],
  },
  {
    code: 'CITATION_SOURCE_OUTDATED',
    severity: AIReviewSeverity.Warning,
    message: 'Referenced policy guideline was revised in 2025.',
    evidenceIds: ['EPA::cwa-guideline-2025'],
  },
];

const canonicalValidResult: PEIAAdvisoryResult = {
  schemaVersion: 1,
  task: {
    taskId: 'task-canonical-404',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-987',
      sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
  humanReviewRequired: true,
  assessment: {
    summary: 'Comprehensive review completed.',
    findings: canonicalFindings,
  },
  recommendations: ['Update citations to 2026 standards.'],
  uncertainties: ['Preliminary rainfall metrics.'],
  limitations: ['Limited to public EPA data.'],
};

async function runSuite() {
  console.log('--- PEIA-18F 42-Test Advisory Result Upload Contract Audit ---');

  // 1. AdvisoryResultUploadRequest exists
  await test('1. AdvisoryResultUploadRequest exists', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(
      source.includes('export interface AdvisoryResultUploadRequest'),
      'Must export interface AdvisoryResultUploadRequest'
    );
  });

  // 2. request contract has exactly one readonly field: result
  await test('2. request contract has exactly one readonly field: result', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+interface\s+AdvisoryResultUploadRequest\s*\{([^}]+)\}/
    );
    assert(match !== null, 'Must match AdvisoryResultUploadRequest');
    const fields = match![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    assert(fields.length === 1, `Expected exactly 1 field in upload request contract, got ${fields.length}`);
    assert(fields[0].includes('readonly result: PEIAAdvisoryResult'), 'Field 1 must be readonly result: PEIAAdvisoryResult');
  });

  // 3. AdvisoryResultUploadAccepted exists
  await test('3. AdvisoryResultUploadAccepted exists', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(
      source.includes('export interface AdvisoryResultUploadAccepted'),
      'Must export interface AdvisoryResultUploadAccepted'
    );
  });

  // 4. accepted response contract has exactly ok + taskId
  await test('4. accepted response contract has exactly ok + taskId', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+interface\s+AdvisoryResultUploadAccepted\s*\{([^}]+)\}/
    );
    assert(match !== null, 'Must match AdvisoryResultUploadAccepted');
    const fields = match![1]
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    assert(fields.length === 2, `Expected exactly 2 fields in accepted response contract, got ${fields.length}`);
    assert(fields[0].includes('readonly ok: true'), 'Field 1 must be readonly ok: true');
    assert(fields[1].includes('readonly taskId: string'), 'Field 2 must be readonly taskId: string');
  });

  // 5. AdvisoryResultUploadResponse exists
  await test('5. AdvisoryResultUploadResponse exists', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(
      source.includes('export type AdvisoryResultUploadResponse'),
      'Must export type AdvisoryResultUploadResponse'
    );
  });

  // 6. response union vocabulary is ACCEPTED only
  await test('6. response union vocabulary is ACCEPTED only', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+type\s+AdvisoryResultUploadResponse\s*=\s*([\s\S]*?);/
    );
    assert(match !== null, 'Must match AdvisoryResultUploadResponse');
    const body = match![1];

    assert(body.includes("kind: 'ACCEPTED'"), "Must contain kind: 'ACCEPTED'");

    const forbiddenKinds = [
      'REJECTED',
      'FAILED',
      'RETRY',
      'PENDING',
      'UPLOADED',
      'APPROVED',
      'COMPLETED',
      'NO_TASK',
    ];
    for (const k of forbiddenKinds) {
      assert(!body.includes(k), `Forbidden response union kind found: "${k}"`);
    }
  });

  // 7. error class exists
  await test('7. error class exists', () => {
    assert(
      typeof AdvisoryResultUploadContractError === 'function',
      'AdvisoryResultUploadContractError must be a class constructor'
    );
  });

  // 8. error-code vocabulary is exactly two codes
  await test('8. error-code vocabulary is exactly two codes', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const match = source.match(
      /export\s+type\s+AdvisoryResultUploadContractErrorCode\s*=\s*([\s\S]*?);/
    );
    assert(match !== null, 'Must match AdvisoryResultUploadContractErrorCode');
    const body = match![1];

    const codes = body
      .split('|')
      .map((c) => c.trim().replace(/['"]/g, ''))
      .filter((c) => c.length > 0);

    assert(codes.length === 2, `Expected exactly 2 error codes, got ${codes.length}`);
    assert(codes.includes('INVALID_UPLOAD_REQUEST'), 'Must contain INVALID_UPLOAD_REQUEST');
    assert(codes.includes('INVALID_UPLOAD_RESPONSE'), 'Must contain INVALID_UPLOAD_RESPONSE');
  });

  // 9. exact fixed message for INVALID_UPLOAD_REQUEST
  await test('9. exact fixed message for INVALID_UPLOAD_REQUEST', () => {
    const err = new AdvisoryResultUploadContractError('INVALID_UPLOAD_REQUEST');
    assert(err.code === 'INVALID_UPLOAD_REQUEST', 'Error code must be INVALID_UPLOAD_REQUEST');
    assert(
      err.message === 'Invalid PEIA advisory result upload request.',
      `Expected message "Invalid PEIA advisory result upload request.", got "${err.message}"`
    );
  });

  // 10. exact fixed message for INVALID_UPLOAD_RESPONSE
  await test('10. exact fixed message for INVALID_UPLOAD_RESPONSE', () => {
    const err = new AdvisoryResultUploadContractError('INVALID_UPLOAD_RESPONSE');
    assert(err.code === 'INVALID_UPLOAD_RESPONSE', 'Error code must be INVALID_UPLOAD_RESPONSE');
    assert(
      err.message === 'Invalid PEIA advisory result upload response.',
      `Expected message "Invalid PEIA advisory result upload response.", got "${err.message}"`
    );
  });

  // 11. error constructor accepts code only
  await test('11. error constructor accepts code only', () => {
    const err = new AdvisoryResultUploadContractError('INVALID_UPLOAD_REQUEST');
    assert(err.name === 'AdvisoryResultUploadContractError', 'Error name must be AdvisoryResultUploadContractError');
    assert(err.constructor.length === 1, 'Constructor must accept exactly 1 parameter');

    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');
    assert(
      source.includes('constructor(code: AdvisoryResultUploadContractErrorCode)'),
      'Constructor signature must be exactly constructor(code: AdvisoryResultUploadContractErrorCode)'
    );
  });

  // 12. valid result creates upload request
  await test('12. valid result creates upload request', () => {
    const req = createAdvisoryResultUploadRequest(canonicalValidResult);
    assert(req !== undefined, 'Request must be defined');
    assert(req.result !== undefined, 'req.result must be defined');
  });

  // 13. created request has exactly result key
  await test('13. created request has exactly result key', () => {
    const req = createAdvisoryResultUploadRequest(canonicalValidResult);
    const keys = Object.keys(req);
    assert(keys.length === 1, `Expected exactly 1 key on request, got ${keys.length}`);
    assert(keys[0] === 'result', 'Key must be result');
  });

  // 14. created request preserves exact result reference
  await test('14. created request preserves exact result reference', () => {
    const req = createAdvisoryResultUploadRequest(canonicalValidResult);
    assert(req.result === canonicalValidResult, 'req.result must be exact reference to canonicalValidResult');
  });

  // 15. request creation does not mutate result
  await test('15. request creation does not mutate result', () => {
    const taskCopy = { ...canonicalValidResult.task };
    const summaryCopy = canonicalValidResult.assessment.summary;
    const findingsLength = canonicalValidResult.assessment.findings.length;

    const req = createAdvisoryResultUploadRequest(canonicalValidResult);

    assert(req.result === canonicalValidResult, 'Result reference preserved');
    assert(canonicalValidResult.task.taskId === taskCopy.taskId, 'Task taskId unchanged');
    assert(canonicalValidResult.task.taskType === taskCopy.taskType, 'Task taskType unchanged');
    assert(canonicalValidResult.assessment.summary === summaryCopy, 'Summary unchanged');
    assert(canonicalValidResult.assessment.findings.length === findingsLength, 'Findings length unchanged');
  });

  // 16. invalid result creation throws exact INVALID_UPLOAD_REQUEST
  await test('16. invalid result creation throws exact INVALID_UPLOAD_REQUEST', () => {
    const malformedResult = {
      task: { taskId: '' },
    } as unknown as PEIAAdvisoryResult;

    let caughtError: unknown = null;
    try {
      createAdvisoryResultUploadRequest(malformedResult);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof AdvisoryResultUploadContractError,
      'Caught error must be instanceof AdvisoryResultUploadContractError'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_REQUEST',
      'Error code must be INVALID_UPLOAD_REQUEST'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload request.',
      'Message must match fixed string'
    );
  });

  // 17. request validator accepts canonical request
  await test('17. request validator accepts canonical request', () => {
    const req: AdvisoryResultUploadRequest = {
      result: canonicalValidResult,
    };
    const validated = validateAdvisoryResultUploadRequest(req);
    assert(validated.result === canonicalValidResult, 'Validated request result must match');
  });

  // 18. request validator returns exact same request reference
  await test('18. request validator returns exact same request reference', () => {
    const request = {
      result: canonicalValidResult,
    };
    const validated = validateAdvisoryResultUploadRequest(request);
    assert(validated === request, 'Validator must return exact same request reference');
  });

  // 19. request validator rejects null
  await test('19. request validator rejects null', () => {
    let caughtError: unknown = null;
    try {
      validateAdvisoryResultUploadRequest(null);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof AdvisoryResultUploadContractError,
      'Must throw AdvisoryResultUploadContractError'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_REQUEST',
      'Error code must be INVALID_UPLOAD_REQUEST'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload request.',
      'Error message must be exact'
    );
  });

  // 20. request validator rejects array
  await test('20. request validator rejects array', () => {
    let caughtError: unknown = null;
    try {
      validateAdvisoryResultUploadRequest([canonicalValidResult]);
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof AdvisoryResultUploadContractError,
      'Must throw AdvisoryResultUploadContractError'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_REQUEST',
      'Error code must be INVALID_UPLOAD_REQUEST'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload request.',
      'Error message must be exact'
    );
  });

  // 21. request validator rejects primitive
  await test('21. request validator rejects primitive', () => {
    let caughtError: unknown = null;
    try {
      validateAdvisoryResultUploadRequest('some string');
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof AdvisoryResultUploadContractError,
      'Must throw AdvisoryResultUploadContractError'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_REQUEST',
      'Error code must be INVALID_UPLOAD_REQUEST'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload request.',
      'Error message must be exact'
    );
  });

  // 22. request validator rejects missing result
  await test('22. request validator rejects missing result', () => {
    let caughtError: unknown = null;
    try {
      validateAdvisoryResultUploadRequest({});
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof AdvisoryResultUploadContractError,
      'Must throw AdvisoryResultUploadContractError'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_REQUEST',
      'Error code must be INVALID_UPLOAD_REQUEST'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload request.',
      'Error message must be exact'
    );
  });

  // 23. request validator rejects extra key
  await test('23. request validator rejects extra key', () => {
    let caughtError: unknown = null;
    try {
      validateAdvisoryResultUploadRequest({
        result: canonicalValidResult,
        taskId: 'task-canonical-404',
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof AdvisoryResultUploadContractError,
      'Must throw AdvisoryResultUploadContractError'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_REQUEST',
      'Error code must be INVALID_UPLOAD_REQUEST'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload request.',
      'Error message must be exact'
    );
  });

  // 24. request validator rejects invalid nested result
  await test('24. request validator rejects invalid nested result', () => {
    let caughtError: unknown = null;
    try {
      validateAdvisoryResultUploadRequest({
        result: {
          task: { taskId: '' },
        },
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof AdvisoryResultUploadContractError,
      'Must throw AdvisoryResultUploadContractError'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_REQUEST',
      'Error code must be INVALID_UPLOAD_REQUEST'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload request.',
      'Error message must be exact'
    );
  });

  // 25. nested canonical error maps to exact INVALID_UPLOAD_REQUEST
  await test('25. nested canonical error maps to exact INVALID_UPLOAD_REQUEST', () => {
    const invalidAssessmentResult = {
      ...canonicalValidResult,
      assessment: {
        summary: '',
        findings: [],
      },
    } as unknown as PEIAAdvisoryResult;

    let caughtError: unknown = null;
    try {
      validateAdvisoryResultUploadRequest({
        result: invalidAssessmentResult,
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(
      caughtError instanceof AdvisoryResultUploadContractError,
      'Must throw AdvisoryResultUploadContractError'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_REQUEST',
      'Error code must be INVALID_UPLOAD_REQUEST'
    );
    assert(
      (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload request.',
      'Error message must be exact'
    );
  });

  // 26. response parser accepts { ok: true, taskId }
  await test('26. response parser accepts { ok: true, taskId }', () => {
    const response = {
      ok: true as const,
      taskId: 'task-canonical-404',
    };
    const parsed = parseAdvisoryResultUploadResponse(response);
    assert(parsed.kind === 'ACCEPTED', 'kind must be ACCEPTED');
    assert(parsed.value.ok === true, 'value.ok must be true');
    assert(parsed.value.taskId === 'task-canonical-404', 'value.taskId must match');
  });

  // 27. parsed kind is exactly ACCEPTED
  await test('27. parsed kind is exactly ACCEPTED', () => {
    const response = {
      ok: true as const,
      taskId: 'task-canonical-404',
    };
    const parsed = parseAdvisoryResultUploadResponse(response);
    assert(parsed.kind === 'ACCEPTED', "kind must be 'ACCEPTED'");
  });

  // 28. parsed.value is exact original response reference
  await test('28. parsed.value is exact original response reference', () => {
    const response = {
      ok: true as const,
      taskId: 'task-canonical-404',
    };
    const parsed = parseAdvisoryResultUploadResponse(response);
    assert(parsed.value === response, 'parsed.value must be exact reference to response');
  });

  // 29. parser preserves exact taskId
  await test('29. parser preserves exact taskId', () => {
    const response = {
      ok: true as const,
      taskId: 'task-unique-string-12345',
    };
    const parsed = parseAdvisoryResultUploadResponse(response);
    assert(parsed.value.taskId === 'task-unique-string-12345', 'taskId must match exactly');
  });

  // 30. rejects ok false
  await test('30. rejects ok false', () => {
    let caughtError: unknown = null;
    try {
      parseAdvisoryResultUploadResponse({
        ok: false,
        taskId: 'task-1',
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must throw AdvisoryResultUploadContractError');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert((caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.', 'Message must be exact');
  });

  // 31. rejects missing ok
  await test('31. rejects missing ok', () => {
    let caughtError: unknown = null;
    try {
      parseAdvisoryResultUploadResponse({
        taskId: 'task-1',
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must throw AdvisoryResultUploadContractError');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert((caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.', 'Message must be exact');
  });

  // 32. rejects missing taskId
  await test('32. rejects missing taskId', () => {
    let caughtError: unknown = null;
    try {
      parseAdvisoryResultUploadResponse({
        ok: true,
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must throw AdvisoryResultUploadContractError');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert((caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.', 'Message must be exact');
  });

  // 33. rejects blank taskId
  await test('33. rejects blank taskId', () => {
    let caughtError: unknown = null;
    try {
      parseAdvisoryResultUploadResponse({
        ok: true,
        taskId: '',
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must throw AdvisoryResultUploadContractError');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert((caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.', 'Message must be exact');
  });

  // 34. rejects whitespace-only taskId
  await test('34. rejects whitespace-only taskId', () => {
    let caughtError: unknown = null;
    try {
      parseAdvisoryResultUploadResponse({
        ok: true,
        taskId: '   ',
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must throw AdvisoryResultUploadContractError');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert((caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.', 'Message must be exact');
  });

  // 35. rejects padded taskId
  await test('35. rejects padded taskId', () => {
    let caughtError: unknown = null;
    try {
      parseAdvisoryResultUploadResponse({
        ok: true,
        taskId: ' task-1 ',
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must throw AdvisoryResultUploadContractError');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert((caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.', 'Message must be exact');
  });

  // 36. rejects non-string taskId
  await test('36. rejects non-string taskId', () => {
    let caughtError: unknown = null;
    try {
      parseAdvisoryResultUploadResponse({
        ok: true,
        taskId: 12345,
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must throw AdvisoryResultUploadContractError');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert((caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.', 'Message must be exact');
  });

  // 37. rejects extra response key
  await test('37. rejects extra response key', () => {
    let caughtError: unknown = null;
    try {
      parseAdvisoryResultUploadResponse({
        ok: true,
        taskId: 'task-1',
        status: 'ACCEPTED',
      });
    } catch (err: unknown) {
      caughtError = err;
    }

    assert(caughtError instanceof AdvisoryResultUploadContractError, 'Must throw AdvisoryResultUploadContractError');
    assert((caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE', 'Code must be INVALID_UPLOAD_RESPONSE');
    assert((caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.', 'Message must be exact');
  });

  // 38. all invalid responses map exact INVALID_UPLOAD_RESPONSE
  await test('38. all invalid responses map exact INVALID_UPLOAD_RESPONSE', () => {
    const invalidCandidates: unknown[] = [
      null,
      undefined,
      123,
      'accepted',
      [],
      {},
      { ok: true },
      { taskId: 'task-1' },
      { ok: false, taskId: 'task-1' },
      { ok: 'true', taskId: 'task-1' },
      { ok: true, taskId: '' },
      { ok: true, taskId: '   ' },
      { ok: true, taskId: ' padded ' },
      { ok: true, taskId: null },
      { ok: true, taskId: 'task-1', extra: true },
    ];

    for (const candidate of invalidCandidates) {
      let caughtError: unknown = null;
      try {
        parseAdvisoryResultUploadResponse(candidate);
      } catch (err: unknown) {
        caughtError = err;
      }

      assert(
        caughtError instanceof AdvisoryResultUploadContractError,
        `Candidate must throw AdvisoryResultUploadContractError: ${JSON.stringify(candidate)}`
      );
      assert(
        (caughtError as AdvisoryResultUploadContractError).code === 'INVALID_UPLOAD_RESPONSE',
        `Candidate error code must be INVALID_UPLOAD_RESPONSE: ${JSON.stringify(candidate)}`
      );
      assert(
        (caughtError as AdvisoryResultUploadContractError).message === 'Invalid PEIA advisory result upload response.',
        `Candidate error message must be exact: ${JSON.stringify(candidate)}`
      );
    }
  });

  // 39. source reuses canonical PEIA validator and defines no duplicate task identity
  await test('39. source reuses canonical PEIA validator and defines no duplicate task identity', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    assert(source.includes("from './advisoryResultContract'"), "Must import from './advisoryResultContract'");
    assert(source.includes('PEIAAdvisoryResult'), 'Must import PEIAAdvisoryResult');
    assert(source.includes('validatePEIAAdvisoryResult'), 'Must import validatePEIAAdvisoryResult');
    assert(source.includes('validatePEIAAdvisoryResult(result)'), 'createAdvisoryResultUploadRequest must invoke validatePEIAAdvisoryResult(result)');
    assert(source.includes('validatePEIAAdvisoryResult(input.result)'), 'validateAdvisoryResultUploadRequest must invoke validatePEIAAdvisoryResult(input.result)');

    const reqMatch = source.match(
      /export\s+interface\s+AdvisoryResultUploadRequest\s*\{([^}]+)\}/
    );
    assert(reqMatch !== null, 'Must match AdvisoryResultUploadRequest');
    const reqBody = reqMatch![1];
    const reqFields = reqBody.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    assert(reqFields.length === 1, `Request must have exactly one field, got ${reqFields.length}`);
    assert(reqFields[0].includes('readonly result: PEIAAdvisoryResult'), 'Field must be readonly result: PEIAAdvisoryResult');
    assert(!reqBody.includes('taskId'), 'AdvisoryResultUploadRequest must not have top-level taskId');
  });

  // 40. source contains no credential/outbox/network/server/authority behavior
  await test('40. source contains no credential/outbox/network/server/authority behavior', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'credential',
      'token',
      'machineToken',
      'apiKey',
      'Authorization',
      'Bearer',
      'principalId',
      'workerId',
      'PendingUpload',
      'localState',
      'markUploaded',
      'uploadedAt',
      'attemptCount',
      'retryCount',
      'lastError',
      'fetch(',
      'globalThis.fetch',
      'endpointUrl',
      'onRequest',
      'Firestore',
      'firebase',
      'getFirestore',
      'AIReviewArtifact',
      'AIReviewFinding',
      'approved',
      'rejected',
      'published',
      'decision',
      'workflowState',
      'humanDecision',
      'autoApply',
      'autoPublish',
      'override',
      'execute',
    ];

    for (const f of forbidden) {
      assert(!source.includes(f), `Forbidden token found in source: "${f}"`);
    }
  });

  // 41. source contains no metadata/time/randomness/serialization/clone
  await test('41. source contains no metadata/time/randomness/serialization/clone', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'resultId',
      'providerId',
      'generatedAt',
      'createdAt',
      'updatedAt',
      'queuedAt',
      'serverStatus',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'JSON.stringify',
      'JSON.parse',
      'structuredClone',
    ];

    for (const f of forbidden) {
      assert(!source.includes(f), `Forbidden token found in source: "${f}"`);
    }

    assert(!source.includes('...input'), 'Must not spread clone input');
    assert(!source.includes('...result'), 'Must not spread clone result');
    assert(!source.includes('...response'), 'Must not spread clone response');
  });

  // 42. final self-contained source invariant + exact test-count gate
  await test('42. final self-contained source invariant + exact test-count gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultUploadContract.ts');
    const source = readFileSync(filePath, 'utf8');

    // A. EXACT REQUEST CONTRACT
    const reqMatch = source.match(
      /export\s+interface\s+AdvisoryResultUploadRequest\s*\{([^}]+)\}/
    );
    assert(reqMatch !== null, 'Must match AdvisoryResultUploadRequest');
    const reqBody = reqMatch![1];
    const reqFields = reqBody.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    assert(reqFields.length === 1, `Request must have exactly 1 field, got ${reqFields.length}`);
    assert(reqFields[0].includes('readonly result: PEIAAdvisoryResult'), 'Request must have readonly result: PEIAAdvisoryResult');
    assert(!reqBody.includes('taskId'), 'Request must have no top-level taskId');
    assert(!reqBody.includes('credential'), 'Request must have no credential');
    assert(!reqBody.includes('principalId'), 'Request must have no principalId');
    assert(!reqBody.includes('workerId'), 'Request must have no workerId');

    // B. EXACT ACCEPTED RESPONSE CONTRACT
    const acceptedMatch = source.match(
      /export\s+interface\s+AdvisoryResultUploadAccepted\s*\{([^}]+)\}/
    );
    assert(acceptedMatch !== null, 'Must match AdvisoryResultUploadAccepted');
    const acceptedFields = acceptedMatch![1].split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    assert(acceptedFields.length === 2, `Accepted response must have exactly 2 fields, got ${acceptedFields.length}`);
    assert(acceptedFields[0].includes('readonly ok: true'), 'Accepted field 1 must be readonly ok: true');
    assert(acceptedFields[1].includes('readonly taskId: string'), 'Accepted field 2 must be readonly taskId: string');

    // C. EXACT RESPONSE UNION
    const resUnionMatch = source.match(
      /export\s+type\s+AdvisoryResultUploadResponse\s*=\s*([\s\S]*?);/
    );
    assert(resUnionMatch !== null, 'Must match AdvisoryResultUploadResponse');
    const resUnionBody = resUnionMatch![1];
    assert(resUnionBody.includes("kind: 'ACCEPTED'"), 'Response union must have ACCEPTED');
    const forbiddenKinds = ['REJECTED', 'FAILED', 'RETRY', 'PENDING', 'UPLOADED', 'APPROVED', 'COMPLETED', 'NO_TASK'];
    for (const fk of forbiddenKinds) {
      assert(!resUnionBody.includes(fk), `Response union must not include ${fk}`);
    }

    // D. EXACT ERROR CONTRACT
    const errorCodeMatch = source.match(
      /export\s+type\s+AdvisoryResultUploadContractErrorCode\s*=\s*([\s\S]*?);/
    );
    assert(errorCodeMatch !== null, 'Must match AdvisoryResultUploadContractErrorCode');
    const errorCodeBody = errorCodeMatch![1];
    const codes = errorCodeBody
      .split('|')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((s) => s.length > 0);
    assert(codes.length === 2, `Expected exactly 2 error codes, got ${codes.length}`);
    assert(codes.includes('INVALID_UPLOAD_REQUEST'), 'Must contain INVALID_UPLOAD_REQUEST');
    assert(codes.includes('INVALID_UPLOAD_RESPONSE'), 'Must contain INVALID_UPLOAD_RESPONSE');
    assert(!codes.includes('INVALID_ARGUMENT'), 'Must not contain unexpected error code');

    assert(source.includes("'INVALID_UPLOAD_REQUEST'"), 'Must include INVALID_UPLOAD_REQUEST');
    assert(source.includes("'INVALID_UPLOAD_RESPONSE'"), 'Must include INVALID_UPLOAD_RESPONSE');
    assert(source.includes('Invalid PEIA advisory result upload request.'), 'Must include exact request error message');
    assert(source.includes('Invalid PEIA advisory result upload response.'), 'Must include exact response error message');
    assert(source.includes('constructor(code: AdvisoryResultUploadContractErrorCode)'), 'Constructor must be constructor(code: AdvisoryResultUploadContractErrorCode)');

    // E. CANONICAL REQUEST CREATION
    const createFnMatch = source.match(
      /export\s+function\s+createAdvisoryResultUploadRequest\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(createFnMatch !== null, 'Must find createAdvisoryResultUploadRequest');
    const createBody = createFnMatch![1];
    assert(createBody.includes('validatePEIAAdvisoryResult(result)'), 'createAdvisoryResultUploadRequest must call validatePEIAAdvisoryResult');
    assert(
      createBody.includes('return {\n    result,\n  };') ||
      createBody.includes('return {\n  result,\n};') ||
      createBody.includes('return {\n      result,\n    };'),
      'Must return structural { result }'
    );
    assert(!createBody.includes('...result'), 'No spread result');
    assert(!createBody.includes('...input'), 'No spread input');
    assert(!createBody.includes('structuredClone'), 'No structuredClone');
    assert(!createBody.includes('JSON.stringify'), 'No serialization');
    assert(!createBody.includes('JSON.parse'), 'No parsing');

    // F. REQUEST VALIDATION
    const validateFnMatch = source.match(
      /export\s+function\s+validateAdvisoryResultUploadRequest\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(validateFnMatch !== null, 'Must find validateAdvisoryResultUploadRequest');
    const validateBody = validateFnMatch![1];
    assert(validateBody.includes('isPlainObject(input)'), 'Must check isPlainObject');
    assert(validateBody.includes('Object.keys(input)'), 'Must check Object.keys');
    assert(validateBody.includes('keys.length !== 1'), 'Must check keys.length !== 1');
    assert(validateBody.includes("keys[0] !== 'result'"), 'Must check key is result');
    assert(validateBody.includes('validatePEIAAdvisoryResult(input.result)'), 'Must validate nested result');
    assert(validateBody.includes('INVALID_UPLOAD_REQUEST'), 'Must throw INVALID_UPLOAD_REQUEST on failure');
    assert(validateBody.includes('return input as'), 'Must return same input object reference');

    // G. RESPONSE PARSING
    const parseFnMatch = source.match(
      /export\s+function\s+parseAdvisoryResultUploadResponse\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    );
    assert(parseFnMatch !== null, 'Must find parseAdvisoryResultUploadResponse');
    const parseBody = parseFnMatch![1];
    assert(parseBody.includes('isPlainObject(input)'), 'Must check isPlainObject');
    assert(parseBody.includes('Object.keys(input)'), 'Must check Object.keys');
    assert(parseBody.includes('keys.length !== 2'), 'Must check exactly 2 keys');
    assert(parseBody.includes("keys.includes('ok')"), 'Must check keys include ok');
    assert(parseBody.includes("keys.includes('taskId')"), 'Must check keys include taskId');
    assert(parseBody.includes('input.ok !== true'), 'Must check ok === true');
    assert(parseBody.includes("typeof input.taskId !== 'string'"), 'Must check string taskId');
    assert(parseBody.includes('input.taskId.length === 0'), 'Must check non-empty taskId');
    assert(parseBody.includes('input.taskId !== input.taskId.trim()'), 'Must check exact trim match');
    assert(parseBody.includes("kind: 'ACCEPTED'"), 'Must return ACCEPTED kind');
    assert(parseBody.includes('value: input as'), 'value must be original input reference');
    assert(!parseBody.includes('taskId ='), 'No taskId assignment');
    assert(!parseBody.includes('.trim() ='), 'No trim assignment');
    assert(!parseBody.includes('randomUUID'), 'No randomUUID');
    assert(!parseBody.includes('Date.now'), 'No Date.now');
    assert(!parseBody.includes('JSON.stringify'), 'No JSON.stringify');
    assert(!parseBody.includes('JSON.parse'), 'No JSON.parse');
    assert(!parseBody.includes('structuredClone'), 'No structuredClone');
    assert(!parseBody.includes('...input'), 'No spread input');
    assert(!parseBody.includes('...response'), 'No spread response');

    // H. NO CREDENTIAL / MACHINE ID BODY FIELDS
    const forbiddenCredentials = ['credential', 'token', 'machineToken', 'apiKey', 'Authorization', 'Bearer', 'principalId', 'workerId'];
    for (const cred of forbiddenCredentials) {
      assert(!source.includes(cred), `Forbidden credential token "${cred}" found`);
    }

    // I. NO OUTBOX LIFECYCLE
    const forbiddenOutbox = ['PendingUpload', 'localState', 'markUploaded', 'uploadedAt', 'attemptCount', 'retryCount', 'lastError'];
    for (const out of forbiddenOutbox) {
      assert(!source.includes(out), `Forbidden outbox token "${out}" found`);
    }

    // J. NO NETWORK / SERVER
    const forbiddenNet = ['globalThis.fetch', 'endpointUrl', 'onRequest', 'Firestore', 'firebase', 'getFirestore'];
    for (const net of forbiddenNet) {
      assert(!source.includes(net), `Forbidden network/server token "${net}" found`);
    }
    assert(!/\bfetch\s*\(/.test(source), 'No fetch call');

    // K. NO AUTHORITY / PLATFORM ARTIFACT
    const forbiddenAuth = ['AIReviewArtifact', 'AIReviewFinding', 'approved', 'rejected', 'published', 'decision', 'workflowState', 'humanDecision', 'autoApply', 'autoPublish', 'override', 'execute'];
    for (const a of forbiddenAuth) {
      assert(!source.includes(a), `Forbidden authority token "${a}" found`);
    }

    // L. NO GENERATED METADATA
    const forbiddenMeta = ['resultId', 'providerId', 'generatedAt', 'createdAt', 'updatedAt', 'queuedAt', 'serverStatus'];
    for (const m of forbiddenMeta) {
      assert(!source.includes(m), `Forbidden metadata token "${m}" found`);
    }

    // M. NO TIME / RANDOMNESS / SERIALIZATION / CLONE
    const forbiddenMisc = ['Date.now', 'new Date', 'Math.random', 'randomUUID', 'JSON.stringify', 'JSON.parse', 'structuredClone'];
    for (const mi of forbiddenMisc) {
      assert(!source.includes(mi), `Forbidden token "${mi}" found`);
    }
    assert(!source.includes('...input'), 'Must not spread clone input');
    assert(!source.includes('...result'), 'Must not spread clone result');
    assert(!source.includes('...response'), 'Must not spread clone response');

    // N. FINAL COUNT
    assert(totalTests === 42, `Expected exactly 42 tests, found ${totalTests}`);
    assert(passedTests === 41, `Expected 41 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 42, `Expected exactly 42 tests, found ${totalTests}`);
  assert(passedTests === 42, `Expected exactly 42 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
