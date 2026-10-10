import {
  validateNonAdvisoryOutcomeReportRequest,
  parseNonAdvisoryOutcomeReportResponse,
} from '../peia-worker/src/nonAdvisoryOutcomeReportContract';
import { NonAdvisoryOutcomeKind } from '../peia-worker/src/localNonAdvisoryOutcomeContract';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

function assertThrows(fn: () => void, msg: string) {
  try {
    fn();
    console.error(`FAILED (expected throw): ${msg}`);
    process.exit(1);
  } catch (err) {
    console.log(`Caught expected error: ${msg}`);
  }
}


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

function test(name: string, fn: () => void) {
    try {
        fn();
        console.log(`[PASS] ${name}`);
    } catch (e) {
        console.error(`[FAIL] ${name}: ${e}`);
        process.exit(1);
    }
}

test('valid request', () => validateNonAdvisoryOutcomeReportRequest(validRequest));
test('empty request', () => assertThrows(() => validateNonAdvisoryOutcomeReportRequest({}), 'Empty request'));
test('invalid taskId', () => assertThrows(() => validateNonAdvisoryOutcomeReportRequest({ outcome: { ...validOutcome, taskId: '' } }), 'Invalid taskId'));
test('extra outer field', () => assertThrows(() => validateNonAdvisoryOutcomeReportRequest({ outcome: validOutcome, extra: 1 }), 'Extra field'));
test('malformed response', () => assertThrows(() => parseNonAdvisoryOutcomeReportResponse({ ok: true }), 'Malformed response'));
test('extra response field', () => assertThrows(() => parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: 't1', extra: 1 }), 'Extra response field'));
test('ok false', () => assertThrows(() => parseNonAdvisoryOutcomeReportResponse({ ok: false, taskId: 't1' }), 'Ok false'));
test('empty taskId response', () => assertThrows(() => parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: '' }), 'Empty taskId response'));
test('padded taskId response', () => assertThrows(() => parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: ' t1 ' }), 'Padded taskId response'));
test('valid accepted response', () => parseNonAdvisoryOutcomeReportResponse({ ok: true, taskId: 't1' }));

console.log('PASSED: All Non-Advisory Outcome Report Contract tests passed.');
