import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parsePendingTaskDownloadResponse,
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
 * PEIA-17A — DOWNLOADED TASK RESPONSE CONTRACT & INTAKE BOUNDARY TEST SUITE.
 * Enforces exactly 38 real test units for worker-side response validation.
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

function assertDownloadError(
  fn: () => unknown,
  expectedCode: string
): PendingTaskDownloadResponseError {
  try {
    fn();
  } catch (err: unknown) {
    if (err instanceof PendingTaskDownloadResponseError) {
      if (err.code !== expectedCode) {
        throw new Error(
          `Expected error code "${expectedCode}", but received "${err.code}" (message: "${err.message}")`
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

async function runSuite() {
  console.log('--- PEIA-17A 38-Test Downloaded Task Response Contract Audit ---');

  // 1. parsePendingTaskDownloadResponse exists
  await test('1. parsePendingTaskDownloadResponse exists', () => {
    assert(
      typeof parsePendingTaskDownloadResponse === 'function',
      'parsePendingTaskDownloadResponse must be a function'
    );
  });

  // 2. valid 200 task response → TASK_AVAILABLE
  await test('2. valid 200 task response → TASK_AVAILABLE', () => {
    const body = {
      ok: true,
      principalId: 'worker-principal-1',
      task: validCanonicalTask,
    };
    const result = parsePendingTaskDownloadResponse(200, body);
    assert(result.kind === 'TASK_AVAILABLE', 'Expected kind to be TASK_AVAILABLE');
  });

  // 3. exact principalId preserved
  await test('3. exact principalId preserved', () => {
    const body = {
      ok: true,
      principalId: 'worker-principal-alpha-42',
      task: validCanonicalTask,
    };
    const result = parsePendingTaskDownloadResponse(200, body);
    assert(
      result.kind === 'TASK_AVAILABLE' && result.value.principalId === 'worker-principal-alpha-42',
      'principalId must match input exactly'
    );
  });

  // 4. exact task reference preserved
  await test('4. exact task reference preserved', () => {
    const body = {
      ok: true,
      principalId: 'worker-principal-1',
      task: validCanonicalTask,
    };
    const result = parsePendingTaskDownloadResponse(200, body);
    assert(
      result.kind === 'TASK_AVAILABLE' && result.value.task === validCanonicalTask,
      'Task reference must be identical to input'
    );
  });

  // 5. valid 200 null task → NO_TASK
  await test('5. valid 200 null task → NO_TASK', () => {
    const body = {
      ok: true,
      principalId: 'worker-principal-1',
      task: null,
    };
    const result = parsePendingTaskDownloadResponse(200, body);
    assert(result.kind === 'NO_TASK', 'Expected kind to be NO_TASK');
    assert(result.value.task === null, 'Task value must be null');
  });

  // 6. null task principalId preserved
  await test('6. null task principalId preserved', () => {
    const body = {
      ok: true,
      principalId: 'worker-principal-zero-9',
      task: null,
    };
    const result = parsePendingTaskDownloadResponse(200, body);
    assert(
      result.kind === 'NO_TASK' && result.value.principalId === 'worker-principal-zero-9',
      'Null task principalId must match input'
    );
  });

  // 7. status string "200" rejected
  await test('7. status string "200" rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse('200', {
          ok: true,
          principalId: 'worker-1',
          task: null,
        }),
      'INVALID_HTTP_STATUS'
    );
  });

  // 8. status undefined rejected
  await test('8. status undefined rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(undefined, {
          ok: true,
          principalId: 'worker-1',
          task: null,
        }),
      'INVALID_HTTP_STATUS'
    );
  });

  // 9. status 201 rejected
  await test('9. status 201 rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(201, {
          ok: true,
          principalId: 'worker-1',
          task: null,
        }),
      'INVALID_HTTP_STATUS'
    );
  });

  // 10. status 401 + valid safe error envelope → REMOTE_REQUEST_REJECTED
  await test('10. status 401 + valid safe error envelope → REMOTE_REQUEST_REJECTED', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(401, {
          ok: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication required.',
          },
        }),
      'REMOTE_REQUEST_REJECTED'
    );
  });

  // 11. status 403 + valid safe error envelope → REMOTE_REQUEST_REJECTED
  await test('11. status 403 + valid safe error envelope → REMOTE_REQUEST_REJECTED', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(403, {
          ok: false,
          error: {
            code: 'PERMISSION_DENIED',
            message: 'Capability not granted.',
          },
        }),
      'REMOTE_REQUEST_REJECTED'
    );
  });

  // 12. status 500 + valid safe error envelope → REMOTE_REQUEST_REJECTED
  await test('12. status 500 + valid safe error envelope → REMOTE_REQUEST_REJECTED', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(500, {
          ok: false,
          error: {
            code: 'INTERNAL',
            message: 'An internal error occurred.',
          },
        }),
      'REMOTE_REQUEST_REJECTED'
    );
  });

  // 13. remote error code does not leak into thrown message
  await test('13. remote error code does not leak into thrown message', () => {
    const error = assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(401, {
          ok: false,
          error: {
            code: 'CONFIDENTIAL_SERVER_CODE_98765',
            message: 'Public message',
          },
        }),
      'REMOTE_REQUEST_REJECTED'
    );
    assert(
      !error.message.includes('CONFIDENTIAL_SERVER_CODE_98765'),
      'Remote error code must not leak into message'
    );
  });

  // 14. remote error message does not leak into thrown message
  await test('14. remote error message does not leak into thrown message', () => {
    const error = assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(401, {
          ok: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'CONFIDENTIAL_SERVER_ERROR_DETAIL_4321',
          },
        }),
      'REMOTE_REQUEST_REJECTED'
    );
    assert(
      !error.message.includes('CONFIDENTIAL_SERVER_ERROR_DETAIL_4321'),
      'Remote error message must not leak into message'
    );
  });

  // 15. non-200 malformed body → INVALID_HTTP_STATUS
  await test('15. non-200 malformed body → INVALID_HTTP_STATUS', () => {
    assertDownloadError(
      () => parsePendingTaskDownloadResponse(400, 'malformed non-object body'),
      'INVALID_HTTP_STATUS'
    );
    assertDownloadError(
      () => parsePendingTaskDownloadResponse(404, { ok: false, error: 'not-an-object' }),
      'INVALID_HTTP_STATUS'
    );
    assertDownloadError(
      () => parsePendingTaskDownloadResponse(502, null),
      'INVALID_HTTP_STATUS'
    );
  });

  // 16. status 200 + null body → INVALID_RESPONSE_BODY
  await test('16. status 200 + null body → INVALID_RESPONSE_BODY', () => {
    assertDownloadError(
      () => parsePendingTaskDownloadResponse(200, null),
      'INVALID_RESPONSE_BODY'
    );
  });

  // 17. status 200 + array body → INVALID_RESPONSE_BODY
  await test('17. status 200 + array body → INVALID_RESPONSE_BODY', () => {
    assertDownloadError(
      () => parsePendingTaskDownloadResponse(200, [1, 2, 3]),
      'INVALID_RESPONSE_BODY'
    );
  });

  // 18. status 200 + Date/Map/Set body → INVALID_RESPONSE_BODY
  await test('18. status 200 + Date/Map/Set body → INVALID_RESPONSE_BODY', () => {
    assertDownloadError(
      () => parsePendingTaskDownloadResponse(200, new Date()),
      'INVALID_RESPONSE_BODY'
    );
    assertDownloadError(
      () => parsePendingTaskDownloadResponse(200, new Map()),
      'INVALID_RESPONSE_BODY'
    );
    assertDownloadError(
      () => parsePendingTaskDownloadResponse(200, new Set()),
      'INVALID_RESPONSE_BODY'
    );
  });

  // 19. status 200 + ok:false → INVALID_RESPONSE_BODY
  await test('19. status 200 + ok:false → INVALID_RESPONSE_BODY', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: false,
          error: { code: 'FAIL', message: 'Rejected' },
        }),
      'INVALID_RESPONSE_BODY'
    );
  });

  // 20. missing top-level response key rejected
  await test('20. missing top-level response key rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          // missing task
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          task: null,
          // missing principalId
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
  });

  // 21. extra top-level response key rejected
  await test('21. extra top-level response key rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: null,
          extraField: 'prohibited',
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
  });

  // 22. blank principalId rejected
  await test('22. blank principalId rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: '',
          task: null,
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: '    ',
          task: null,
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
  });

  // 23. whitespace-padded principalId rejected
  await test('23. whitespace-padded principalId rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: '  worker-1',
          task: null,
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'worker-1  ',
          task: null,
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
  });

  // 24. non-string principalId rejected
  await test('24. non-string principalId rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 12345,
          task: null,
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: null,
          task: null,
        }),
      'INVALID_SUCCESS_PAYLOAD'
    );
  });

  // 25. malformed task non-object rejected
  await test('25. malformed task non-object rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: 'not-an-object',
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: [validCanonicalTask],
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 26. task unknown top-level field rejected
  await test('26. task unknown top-level field rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            unknownTaskProperty: 'forbidden',
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 27. task prohibited authority field rejected
  await test('27. task prohibited authority field rejected', () => {
    const prohibitedChecks = [
      { approved: true },
      { published: true },
      { workflowState: 'Approved' },
      { desiredWorkflowState: 'Published' },
      { permission: 'admin' },
      { role: 'Admin' },
      { autoApply: true },
      { autoPublish: true },
      { decision: 'ACCEPT' },
      { suggestedAction: 'PUBLISH' },
      { workerId: 'worker-99' },
      { machineToken: 'token-secret' },
      { apiKey: 'key-secret' },
      { serviceAccount: 'sa@google.com' },
    ];

    for (const probe of prohibitedChecks) {
      assertDownloadError(
        () =>
          parsePendingTaskDownloadResponse(200, {
            ok: true,
            principalId: 'p-1',
            task: {
              ...validCanonicalTask,
              ...probe,
            },
          }),
        'INVALID_TASK_PAYLOAD'
      );
    }
  });

  // 28. invalid taskId rejected
  await test('28. invalid taskId rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, taskId: '' },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, taskId: '  ' },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, taskId: ' padded-id ' },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 29. invalid taskType rejected
  await test('29. invalid taskType rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, taskType: 'YOUTUBE_VIDEO' as any },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, taskType: 'INVALID_TASK_TYPE' as any },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 30. non-Pending task status rejected
  await test('30. non-Pending task status rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, status: 'Completed' as any },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, status: 'Failed' as any },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 31. invalid createdAt rejected
  await test('31. invalid createdAt rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, createdAt: '' },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, createdAt: '   ' },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, createdAt: ' 2026-09-28T00:00:00.000Z ' },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 32. invalid target object rejected
  await test('32. invalid target object rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: { ...validCanonicalTask, target: 'not-an-object' as any },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            target: {
              targetType: AIReviewTargetType.News,
              targetId: 'news-1',
              // missing sourceUpdatedAt
            } as any,
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            target: {
              targetType: AIReviewTargetType.News,
              targetId: 'news-1',
              sourceUpdatedAt: '2026-09-27T00:00:00.000Z',
              extraTargetProp: 'prohibited',
            } as any,
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 33. invalid targetType rejected
  await test('33. invalid targetType rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            target: {
              ...validCanonicalTask.target,
              targetType: 'INVALID_DOMAIN_TARGET' as any,
            },
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 34. invalid targetId rejected
  await test('34. invalid targetId rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            target: {
              ...validCanonicalTask.target,
              targetId: '',
            },
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            target: {
              ...validCanonicalTask.target,
              targetId: '   ',
            },
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 35. invalid sourceUpdatedAt rejected
  await test('35. invalid sourceUpdatedAt rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            target: {
              ...validCanonicalTask.target,
              sourceUpdatedAt: '',
            },
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            target: {
              ...validCanonicalTask.target,
              sourceUpdatedAt: '   ',
            },
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 36. invalid contentSnapshot rejected
  await test('36. invalid contentSnapshot rejected', () => {
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            contentSnapshot: null as any,
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            contentSnapshot: 'not-a-plain-object' as any,
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
    assertDownloadError(
      () =>
        parsePendingTaskDownloadResponse(200, {
          ok: true,
          principalId: 'p-1',
          task: {
            ...validCanonicalTask,
            contentSnapshot: [1, 2, 3] as any,
          },
        }),
      'INVALID_TASK_PAYLOAD'
    );
  });

  // 37. accepted task and nested snapshot references are not cloned/mutated
  await test('37. accepted task and nested snapshot references are not cloned/mutated', () => {
    const inputTask: AIReviewTask = {
      taskId: 'task-ref-check-37',
      taskType: AITaskType.CONTENT_REVIEW,
      status: AITaskStatus.Pending,
      createdAt: '2026-09-28T01:00:00.000Z',
      target: {
        targetType: AIReviewTargetType.TrainingCourse,
        targetId: 'course-37',
        sourceUpdatedAt: '2026-09-27T08:00:00.000Z',
      },
      contentSnapshot: {
        courseTitle: 'Environmental Science 101',
        modulesCount: 5,
      },
    };

    const inputBody = {
      ok: true,
      principalId: 'principal-ref-37',
      task: inputTask,
    };

    const before = JSON.stringify(inputBody);
    const result = parsePendingTaskDownloadResponse(200, inputBody);

    assert(
      JSON.stringify(inputBody) === before,
      'Source input was mutated'
    );
    assert(
      inputBody.principalId === 'principal-ref-37',
      'principalId was mutated'
    );
    assert(result.kind === 'TASK_AVAILABLE', 'Must be TASK_AVAILABLE');
    assert(result.value.task === inputTask, 'Task reference must be identical');
    assert(result.value.task.target === inputTask.target, 'target reference must be identical');
    assert(
      result.value.task.contentSnapshot === inputTask.contentSnapshot,
      'contentSnapshot reference must be identical'
    );
  });

  // 38. source invariants + exact final count gate
  await test('38. source invariants + exact final count gate', () => {
    const contractPath = join(process.cwd(), 'peia-worker/src/downloadTaskResponseContract.ts');
    const contractSource = readFileSync(contractPath, 'utf8');

    const forbiddenTerms = [
      'firebase-admin',
      'firebase-functions',
      'onRequest',
      'onCall',
      'getFirestore',
      'initializeApp',
      'fetch(',
      'Authorization',
      'Bearer',
      'peia_v1_',
      'sqlite',
      'better-sqlite3',
      'localStorage',
      'IndexedDB',
      'writeFile',
      'readFile',
      'console.log',
      'console.error',
      'logger',
      'Date.now',
      'Math.random',
      'randomUUID',
    ];

    for (const term of forbiddenTerms) {
      assert(
        !contractSource.includes(term),
        `Forbidden term "${term}" found in downloadTaskResponseContract.ts`
      );
    }

    const forbiddenImports = [
      'functions/src/peia/aiTaskValidator',
      'taskGatewayHttpResponseMapper',
      'taskGatewayHttpRequestAdapter',
      'firebasePendingTaskHttpEndpoint',
    ];

    for (const forbiddenImport of forbiddenImports) {
      assert(
        !contractSource.includes(forbiddenImport),
        `Forbidden import "${forbiddenImport}" found in downloadTaskResponseContract.ts`
      );
    }

    assert(totalTests === 38, `Expected exactly 38 tests, found ${totalTests}`);
    assert(passedTests === 37, `Expected 37 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 38, `Expected exactly 38 tests, found ${totalTests}`);
  assert(passedTests === 38, `Expected exactly 38 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
