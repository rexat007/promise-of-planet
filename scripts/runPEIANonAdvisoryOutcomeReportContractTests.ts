import {
  validateNonAdvisoryOutcomeReportRequest,
  parseNonAdvisoryOutcomeReportResponse,
} from '../peia-worker/src/nonAdvisoryOutcomeReportContract';
import { NonAdvisoryOutcomeKind } from '../peia-worker/src/localNonAdvisoryOutcomeContract';

console.log('--- Running PEIA Non-Advisory Outcome Report Contract Tests ---');

const now = new Date().toISOString();

const validOutcome = {
  taskId: 'task-100',
  kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
  reason: 'MISSING_RETRIEVAL_QUERY',
  modelAttempts: 0,
  createdAt: now,
};

const validRequest = {
  outcome: validOutcome,
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`[PASS] ${name}`);
  } catch (err: unknown) {
    failedTests++;
    console.error(`[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assertThrows(fn: () => void, description: string) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`Expected throw for: ${description}`);
}

test('valid request', () => {
  validateNonAdvisoryOutcomeReportRequest(validRequest);
});

test('invalid durable outcome', () => {
  assertThrows(
    () => validateNonAdvisoryOutcomeReportRequest({ outcome: { ...validOutcome, taskId: '' } }),
    'invalid durable outcome'
  );
});

test('missing outcome', () => {
  assertThrows(
    () => validateNonAdvisoryOutcomeReportRequest({}),
    'missing outcome'
  );
});

test('extra request field', () => {
  assertThrows(
    () => validateNonAdvisoryOutcomeReportRequest({ outcome: validOutcome, extra: 1 }),
    'extra request field'
  );
});

test('valid response', () => {
  parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: 'task-100' });
});

test('malformed response', () => {
  assertThrows(
    () => parseNonAdvisoryOutcomeReportResponse({ ok: true }),
    'malformed response'
  );
});

test('extra response field', () => {
  assertThrows(
    () => parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: 'task-100', extra: 1 }),
    'extra response field'
  );
});

test('ok !== true', () => {
  assertThrows(
    () => parseNonAdvisoryOutcomeReportResponse({ ok: false, taskId: 'task-100' }),
    'ok !== true'
  );
});

test('empty taskId', () => {
  assertThrows(
    () => parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: '' }),
    'empty taskId'
  );
});

test('whitespace-only taskId', () => {
  assertThrows(
    () => parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: '   ' }),
    'whitespace-only taskId'
  );
});

test('padded taskId', () => {
  assertThrows(
    () => parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: ' task-100 ' }),
    'padded taskId'
  );
});

console.log(`${passedTests}/${totalTests} PASSED`);
if (failedTests > 0) {
  console.log(`${failedTests} FAILED`);
  process.exit(1);
} else {
  console.log('0 FAILED');
}
