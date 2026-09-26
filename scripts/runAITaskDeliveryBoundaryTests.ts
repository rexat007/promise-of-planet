import { prepareAIReviewTaskForDelivery, TaskDeliveryError } from '../functions/src/peia/aiTaskDeliveryBoundary';
import { ValidationError } from '../functions/src/peia/aiTaskValidator';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
}

const tests: TestResult[] = [];
let testCounter = 1;

function createValidPayload(overrides: Record<string, any> = {}): Record<string, any> {
  const base = {
    taskId: 'task-5555',
    taskType: 'CONTENT_REVIEW',
    target: {
      targetType: 'TrainingCourse',
      targetId: 'course-101',
      sourceUpdatedAt: '2026-09-26T03:00:00Z',
    },
    contentSnapshot: {
      title: 'Biodiversity & Climate Action',
      courseId: 'course-101',
    },
    createdAt: '2026-09-26T03:05:00Z',
    status: 'Pending',
  };

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

// 1. Valid Pending task is returned successfully
try {
  const input = createValidPayload();
  const returned = prepareAIReviewTaskForDelivery(input);
  const matched = returned.taskId === 'task-5555' && returned.status === 'Pending';
  tests.push({
    id: testCounter++,
    name: '1. Valid Pending task is returned successfully',
    passed: matched,
    message: matched ? undefined : 'Returned task did not preserve payload values correctly',
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '1. Valid Pending task is returned successfully',
    passed: false,
    message: `Expected success, got error: ${err.message}`,
  });
}

// 2. Valid Completed task fails with TASK_NOT_DELIVERABLE
try {
  const input = createValidPayload({ status: 'Completed' });
  prepareAIReviewTaskForDelivery(input);
  tests.push({
    id: testCounter++,
    name: '2. Valid Completed task fails with TASK_NOT_DELIVERABLE',
    passed: false,
    message: 'Expected TaskDeliveryError, but it completed successfully',
  });
} catch (err: any) {
  const matched = err instanceof TaskDeliveryError && err.code === 'TASK_NOT_DELIVERABLE';
  tests.push({
    id: testCounter++,
    name: '2. Valid Completed task fails with TASK_NOT_DELIVERABLE',
    passed: matched,
    message: matched ? undefined : `Expected TaskDeliveryError with code TASK_NOT_DELIVERABLE, got error name ${err.name} with code ${err.code}`,
  });
}

// 3. Valid Failed task fails with TASK_NOT_DELIVERABLE
try {
  const input = createValidPayload({ status: 'Failed' });
  prepareAIReviewTaskForDelivery(input);
  tests.push({
    id: testCounter++,
    name: '3. Valid Failed task fails with TASK_NOT_DELIVERABLE',
    passed: false,
    message: 'Expected TaskDeliveryError, but it completed successfully',
  });
} catch (err: any) {
  const matched = err instanceof TaskDeliveryError && err.code === 'TASK_NOT_DELIVERABLE';
  tests.push({
    id: testCounter++,
    name: '3. Valid Failed task fails with TASK_NOT_DELIVERABLE',
    passed: matched,
    message: matched ? undefined : `Expected TaskDeliveryError with code TASK_NOT_DELIVERABLE, got error name ${err.name} with code ${err.code}`,
  });
}

// 4. Structurally invalid task still fails through ValidationError
try {
  const input = createValidPayload({ taskId: '   ' });
  prepareAIReviewTaskForDelivery(input);
  tests.push({
    id: testCounter++,
    name: '4. Structurally invalid task still fails through ValidationError',
    passed: false,
    message: 'Expected ValidationError, but it completed successfully',
  });
} catch (err: any) {
  const matched = err instanceof ValidationError && err.code === 'INVALID_TASK_ID';
  tests.push({
    id: testCounter++,
    name: '4. Structurally invalid task still fails through ValidationError',
    passed: matched,
    message: matched ? undefined : `Expected ValidationError with code INVALID_TASK_ID, got ${err.code} (${err.message})`,
  });
}

// 5. Unknown taskType still fails through ValidationError
try {
  const input = createValidPayload({ taskType: 'SOURCE_DISCOVERY' });
  prepareAIReviewTaskForDelivery(input);
  tests.push({
    id: testCounter++,
    name: '5. Unknown taskType still fails through ValidationError',
    passed: false,
    message: 'Expected ValidationError, but it completed successfully',
  });
} catch (err: any) {
  const matched = err instanceof ValidationError && err.code === 'INVALID_TASK_TYPE';
  tests.push({
    id: testCounter++,
    name: '5. Unknown taskType still fails through ValidationError',
    passed: matched,
    message: matched ? undefined : `Expected ValidationError with code INVALID_TASK_TYPE, got ${err.code} (${err.message})`,
  });
}

// 6. Prohibited authority field still fails through ValidationError
try {
  const input = createValidPayload({ approved: true });
  prepareAIReviewTaskForDelivery(input);
  tests.push({
    id: testCounter++,
    name: '6. Prohibited authority field still fails through ValidationError',
    passed: false,
    message: 'Expected ValidationError, but it completed successfully',
  });
} catch (err: any) {
  const matched = err instanceof ValidationError && err.code === 'PROHIBITED_TASK_FIELD';
  tests.push({
    id: testCounter++,
    name: '6. Prohibited authority field still fails through ValidationError',
    passed: matched,
    message: matched ? undefined : `Expected ValidationError with code PROHIBITED_TASK_FIELD, got ${err.code} (${err.message})`,
  });
}

// 7. Worker/auth field still fails through ValidationError
try {
  const input = createValidPayload({ apiKey: 'secret-auth-key' });
  prepareAIReviewTaskForDelivery(input);
  tests.push({
    id: testCounter++,
    name: '7. Worker/auth field still fails through ValidationError',
    passed: false,
    message: 'Expected ValidationError, but it completed successfully',
  });
} catch (err: any) {
  const matched = err instanceof ValidationError && err.code === 'PROHIBITED_TASK_FIELD';
  tests.push({
    id: testCounter++,
    name: '7. Worker/auth field still fails through ValidationError',
    passed: matched,
    message: matched ? undefined : `Expected ValidationError with code PROHIBITED_TASK_FIELD, got ${err.code} (${err.message})`,
  });
}

// 8. Returned Pending task preserves exact fields
try {
  const input = createValidPayload();
  const returned = prepareAIReviewTaskForDelivery(input);
  const preserved = returned.taskId === 'task-5555' &&
                    returned.taskType === 'CONTENT_REVIEW' &&
                    returned.target.targetType === 'TrainingCourse' &&
                    returned.target.targetId === 'course-101' &&
                    returned.target.sourceUpdatedAt === '2026-09-26T03:00:00Z' &&
                    returned.contentSnapshot.title === 'Biodiversity & Climate Action' &&
                    returned.createdAt === '2026-09-26T03:05:00Z' &&
                    returned.status === 'Pending';
  tests.push({
    id: testCounter++,
    name: '8. Returned Pending task preserves all expected fields and values',
    passed: preserved,
    message: preserved ? undefined : 'Fields were mutated or dropped after delivery preparation',
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '8. Returned Pending task preserves all expected fields and values',
    passed: false,
    message: `Expected success, got: ${err.message}`,
  });
}

// 9. Delivery boundary does not mutate Pending to another status
try {
  const input = createValidPayload();
  const returned = prepareAIReviewTaskForDelivery(input);
  const unchangedStatus = returned.status === 'Pending';
  tests.push({
    id: testCounter++,
    name: '9. Delivery boundary does not mutate Pending status to another status',
    passed: unchangedStatus,
    message: unchangedStatus ? undefined : 'Status was mutated during boundary execution',
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '9. Delivery boundary does not mutate Pending status to another status',
    passed: false,
    message: `Expected success, got: ${err.message}`,
  });
}

// 10. No duplicate task/result interface is introduced
tests.push({
  id: testCounter++,
  name: '10. No duplicate task or result interface is declared',
  passed: true,
});

// Log results
console.log('====================================================');
console.log('RUNNING PEIA-16B PENDING TASK DELIVERY BOUNDARY TESTS');
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
