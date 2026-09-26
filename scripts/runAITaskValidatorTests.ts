import { validateAIReviewTask, ValidationError } from '../functions/src/peia/aiTaskValidator';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
}

const tests: TestResult[] = [];
let testCounter = 1;

function assertPasses(name: string, payload: unknown) {
  try {
    validateAIReviewTask(payload);
    tests.push({ id: testCounter++, name, passed: true });
  } catch (err: any) {
    tests.push({ id: testCounter++, name, passed: false, message: `Expected pass, got fail: ${err.message}` });
  }
}

function assertFails(name: string, payload: unknown, expectedCode: string) {
  try {
    validateAIReviewTask(payload);
    tests.push({ id: testCounter++, name, passed: false, message: `Expected fail with code ${expectedCode}, but it passed.` });
  } catch (err: any) {
    if (err instanceof ValidationError && err.code === expectedCode) {
      tests.push({ id: testCounter++, name, passed: true });
    } else if (err instanceof ValidationError) {
      tests.push({ id: testCounter++, name, passed: false, message: `Expected code ${expectedCode}, got ${err.code} (${err.message})` });
    } else {
      tests.push({ id: testCounter++, name, passed: false, message: `Expected ValidationError, got general error: ${err.message}` });
    }
  }
}

// Baseline valid task payload helper
function createValidPayload(overrides: Record<string, any> = {}): Record<string, any> {
  const base = {
    taskId: 'task-12345',
    taskType: 'CONTENT_REVIEW',
    target: {
      targetType: 'News',
      targetId: 'news-987',
      sourceUpdatedAt: '2026-09-26T01:00:00Z',
    },
    contentSnapshot: {
      title: 'Global Climate Summit 2026',
      content: 'Leaders agreed on critical biosphere targets.',
    },
    createdAt: '2026-09-26T02:00:00Z',
    status: 'Pending',
  };

  // Helper to deep override properties if needed
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

// 1. Valid minimal CONTENT_REVIEW task passes
assertPasses('1. Valid minimal CONTENT_REVIEW task passes', createValidPayload());

// 2. Empty taskId fails
const p2 = createValidPayload({ taskId: '   ' });
assertFails('2. Empty taskId fails', p2, 'INVALID_TASK_ID');

const p2_missing = createValidPayload({ taskId: undefined });
assertFails('2. Missing taskId fails', p2_missing, 'INVALID_TASK_PAYLOAD');

// 3. Unknown taskType fails
const p3 = createValidPayload({ taskType: 'LIBRARY_INGEST' });
assertFails('3. Unknown taskType fails', p3, 'INVALID_TASK_TYPE');

// 4. Unknown status fails
const p4 = createValidPayload({ status: 'InProgress' });
assertFails('4. Unknown status fails', p4, 'INVALID_TASK_STATUS');

// 5. Invalid targetType fails
const p5 = createValidPayload();
p5.target = { ...p5.target, targetType: 'UserRole' };
assertFails('5. Invalid targetType fails', p5, 'INVALID_TASK_TARGET');

// 6. Empty targetId fails
const p6 = createValidPayload();
p6.target = { ...p6.target, targetId: '   ' };
assertFails('6. Empty targetId fails', p6, 'INVALID_TASK_TARGET');

// 7. Empty sourceUpdatedAt fails
const p7 = createValidPayload();
p7.target = { ...p7.target, sourceUpdatedAt: '' };
assertFails('7. Empty sourceUpdatedAt fails', p7, 'INVALID_TASK_TARGET');

// 8. Null contentSnapshot fails
const p8 = createValidPayload();
p8.contentSnapshot = null;
assertFails('8. Null contentSnapshot fails', p8, 'INVALID_CONTENT_SNAPSHOT');

// 9. Array contentSnapshot fails
const p9 = createValidPayload();
p9.contentSnapshot = [{ block: 1 }];
assertFails('9. Array contentSnapshot fails', p9, 'INVALID_CONTENT_SNAPSHOT');

// 10. Missing required field fails
const p10 = createValidPayload();
delete p10.createdAt;
assertFails('10. Missing required field (createdAt) fails', p10, 'INVALID_TASK_PAYLOAD');

// 11. Unknown top-level field fails
const p11 = createValidPayload({ unknownField: 'arbitraryValue' });
assertFails('11. Unknown top-level field fails', p11, 'UNKNOWN_TASK_FIELD');

// 12. Prohibited authority field fails
const p12 = createValidPayload({ approved: true });
assertFails('12. Prohibited authority field (approved) fails', p12, 'PROHIBITED_TASK_FIELD');

// 13. Worker/auth field fails
const p13 = createValidPayload({ workerId: 'worker-abc' });
assertFails('13. Worker/auth field (workerId) fails', p13, 'PROHIBITED_TASK_FIELD');

const p13_b = createValidPayload({ apiKey: 'some-key-value' });
assertFails('13. Worker/auth field (apiKey) fails', p13_b, 'PROHIBITED_TASK_FIELD');

// 14. Valid Pending passes
const p14 = createValidPayload({ status: 'Pending' });
assertPasses('14. Valid Pending passes', p14);

// 15. Valid Completed passes
const p15 = createValidPayload({ status: 'Completed' });
assertPasses('15. Valid Completed passes', p15);

// 16. Valid Failed passes
const p16 = createValidPayload({ status: 'Failed' });
assertPasses('16. Valid Failed passes', p16);

// Final Execution report
console.log('====================================================');
console.log('RUNNING PEIA-16A SERVER VALIDATOR BOUNDARY TESTS');
console.log('====================================================\n');

let failed = 0;
for (const t of tests) {
  if (t.passed) {
    console.log(`✅ [${t.id}] ${t.name}`);
  } else {
    failed++;
    console.error(`❌ [${t.id}] ${t.name}`);
    console.error(`   ${t.message}`);
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
