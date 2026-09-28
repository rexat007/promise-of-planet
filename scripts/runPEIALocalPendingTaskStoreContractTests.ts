import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LocalPendingTaskState,
  createStoredPendingTaskRecord,
  validateStoredPendingTaskRecord,
  isSameStoredPendingTaskRecord,
  LocalPendingTaskStoreContractError,
  type StoredPendingTaskRecord,
} from '../peia-worker/src/localPendingTaskStoreContract';
import type { DownloadedPendingTask } from '../peia-worker/src/downloadTaskResponseContract';
import {
  AITaskType,
  AITaskStatus,
  type AIReviewTask,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
} from '../src/types/aiReview';

/**
 * PEIA-17C — LOCAL PENDING TASK PERSISTENCE CONTRACT TEST SUITE.
 * Enforces exactly 42 real test units covering local record mapping,
 * JSON-compatibility validation, cycle detection, repository contracts, and invariants.
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

function assertStoreError(
  fn: () => unknown,
  expectedCode: string
): LocalPendingTaskStoreContractError {
  try {
    fn();
  } catch (err: unknown) {
    if (err instanceof LocalPendingTaskStoreContractError) {
      if (err.code !== expectedCode) {
        throw new Error(
          `Expected store error code "${expectedCode}", but received "${err.code}" (message: "${err.message}")`
        );
      }
      return err;
    }
    throw err;
  }
  throw new Error(
    `Expected LocalPendingTaskStoreContractError with code "${expectedCode}", but function returned normally.`
  );
}

const canonicalValidTask: AIReviewTask = {
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
    title: 'Climate Report',
    metrics: {
      temperature: 32.5,
      active: true,
    },
    tags: ['climate', 'sudan'],
    notes: null,
  },
};

const canonicalDownloadedTask: DownloadedPendingTask = {
  principalId: 'worker-principal-alpha-1',
  task: canonicalValidTask,
};

async function runSuite() {
  console.log('--- PEIA-17C 42-Test Local Persistence Contract Audit ---');

  // 1. LocalPendingTaskState.Downloaded exists
  await test('1. LocalPendingTaskState.Downloaded exists', () => {
    assert(
      LocalPendingTaskState.Downloaded === 'Downloaded',
      'LocalPendingTaskState.Downloaded must be "Downloaded"'
    );
  });

  // 2. createStoredPendingTaskRecord exists
  await test('2. createStoredPendingTaskRecord exists', () => {
    assert(
      typeof createStoredPendingTaskRecord === 'function',
      'createStoredPendingTaskRecord must be a function'
    );
  });

  // 3. validateStoredPendingTaskRecord exists
  await test('3. validateStoredPendingTaskRecord exists', () => {
    assert(
      typeof validateStoredPendingTaskRecord === 'function',
      'validateStoredPendingTaskRecord must be a function'
    );
  });

  // 4. isSameStoredPendingTaskRecord exists
  await test('4. isSameStoredPendingTaskRecord exists', () => {
    assert(
      typeof isSameStoredPendingTaskRecord === 'function',
      'isSameStoredPendingTaskRecord must be a function'
    );
  });

  // 5. valid DownloadedPendingTask converts successfully
  await test('5. valid DownloadedPendingTask converts successfully', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(typeof record === 'object' && record !== null, 'Expected record object');
  });

  // 6. mapping preserves exact taskId
  await test('6. mapping preserves exact taskId', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(
      record.taskId === canonicalValidTask.taskId,
      'taskId must match canonical task exactly'
    );
  });

  // 7. mapping preserves exact principalId
  await test('7. mapping preserves exact principalId', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(
      record.principalId === canonicalDownloadedTask.principalId,
      'principalId must match input exactly'
    );
  });

  // 8. mapping preserves exact taskType
  await test('8. mapping preserves exact taskType', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(
      record.taskType === AITaskType.CONTENT_REVIEW,
      'taskType must be CONTENT_REVIEW'
    );
  });

  // 9. mapping preserves exact target reference
  await test('9. mapping preserves exact target reference', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(
      record.target === canonicalValidTask.target,
      'target object reference must be preserved'
    );
  });

  // 10. mapping preserves exact contentSnapshot reference
  await test('10. mapping preserves exact contentSnapshot reference', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(
      record.contentSnapshot === canonicalValidTask.contentSnapshot,
      'contentSnapshot object reference must be preserved'
    );
  });

  // 11. remoteCreatedAt maps from task.createdAt
  await test('11. remoteCreatedAt maps from task.createdAt', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(
      record.remoteCreatedAt === canonicalValidTask.createdAt,
      'remoteCreatedAt must match task.createdAt'
    );
  });

  // 12. remoteStatus remains Pending
  await test('12. remoteStatus remains Pending', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(
      record.remoteStatus === AITaskStatus.Pending,
      'remoteStatus must remain Pending'
    );
  });

  // 13. localState becomes Downloaded
  await test('13. localState becomes Downloaded', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(
      record.localState === LocalPendingTaskState.Downloaded,
      'localState must be Downloaded'
    );
  });

  // 14. conversion output does not contain nested task property
  await test('14. conversion output does not contain nested task property', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assert(!('task' in record), 'Record must not contain nested task property');
  });

  // 15. conversion output does not contain credential/endpoint/authority fields
  await test('15. conversion output does not contain credential/endpoint/authority fields', () => {
    const record = createStoredPendingTaskRecord(canonicalDownloadedTask) as unknown as Record<string, unknown>;
    const forbidden = [
      'credential',
      'Authorization',
      'Bearer',
      'token',
      'machineToken',
      'apiKey',
      'serviceAccount',
      'endpointUrl',
      'approved',
      'published',
      'decision',
      'workflowState',
      'desiredWorkflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
      'suggestedAction',
    ];
    for (const key of forbidden) {
      assert(!(key in record), `Stored record must not contain key "${key}"`);
    }
  });

  // 16. conversion does not mutate downloaded input
  await test('16. conversion does not mutate downloaded input', () => {
    const input: DownloadedPendingTask = {
      principalId: 'p-mutation-check',
      task: {
        taskId: 't-mutation-check',
        taskType: AITaskType.CONTENT_REVIEW,
        status: AITaskStatus.Pending,
        createdAt: '2026-09-28T00:00:00.000Z',
        target: {
          targetType: AIReviewTargetType.News,
          targetId: 'news-111',
          sourceUpdatedAt: '2026-09-27T00:00:00.000Z',
        },
        contentSnapshot: { text: 'immutable' },
      },
    };
    const before = JSON.stringify(input);
    createStoredPendingTaskRecord(input);
    assert(JSON.stringify(input) === before, 'Input object must not be mutated');
  });

  // 17. blank principalId rejected → INVALID_DOWNLOADED_TASK
  await test('17. blank principalId rejected → INVALID_DOWNLOADED_TASK', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: '',
          task: canonicalValidTask,
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: '   ',
          task: canonicalValidTask,
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: ' padded-principal ',
          task: canonicalValidTask,
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 18. invalid taskId rejected
  await test('18. invalid taskId rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, taskId: '' },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, taskId: '  padded-task  ' },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 19. invalid taskType rejected
  await test('19. invalid taskType rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, taskType: 'YOUTUBE_VIDEO' as unknown as typeof AITaskType.CONTENT_REVIEW },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 20. non-Pending remote status rejected
  await test('20. non-Pending remote status rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, status: AITaskStatus.Completed },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, status: AITaskStatus.Failed },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 21. invalid target rejected
  await test('21. invalid target rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, target: 'not-an-object' as unknown as AIReviewTask['target'] },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: {
            ...canonicalValidTask,
            target: {
              targetType: AIReviewTargetType.News,
              targetId: 'news-1',
              // missing sourceUpdatedAt
            } as unknown as AIReviewTask['target'],
          },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: {
            ...canonicalValidTask,
            target: {
              targetType: AIReviewTargetType.News,
              targetId: 'news-1',
              sourceUpdatedAt: '2026-09-27T00:00:00.000Z',
              extraTargetKey: 'forbidden',
            } as unknown as AIReviewTask['target'],
          },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 22. invalid targetType rejected and all canonical target types accepted
  await test('22. invalid targetType rejected and all canonical target types accepted', () => {
    const canonicalTypes = [
      AIReviewTargetType.News,
      AIReviewTargetType.LibraryDocument,
      AIReviewTargetType.TrainingCourse,
      AIReviewTargetType.CitizenSubmission,
    ];

    for (const targetType of canonicalTypes) {
      const downloaded: DownloadedPendingTask = {
        principalId: 'p-1',
        task: {
          ...canonicalValidTask,
          target: {
            ...canonicalValidTask.target,
            targetType,
          },
        },
      };
      const record = createStoredPendingTaskRecord(downloaded);
      assert(
        record.target.targetType === targetType,
        `Expected targetType ${targetType} to be preserved in stored record`
      );

      // validateStoredPendingTaskRecord accepts record with this targetType
      const validated = validateStoredPendingTaskRecord(record);
      assert(
        validated.target.targetType === targetType,
        `validateStoredPendingTaskRecord must accept canonical targetType ${targetType}`
      );
    }

    // Negative assertion on createStoredPendingTaskRecord
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: {
            ...canonicalValidTask,
            target: {
              ...canonicalValidTask.target,
              targetType: 'INVALID_TARGET_TYPE' as unknown as AIReviewTargetType,
            },
          },
        }),
      'INVALID_DOWNLOADED_TASK'
    );

    // Negative assertion on validateStoredPendingTaskRecord
    const storedWithInvalidTargetType = {
      ...createStoredPendingTaskRecord(canonicalDownloadedTask),
      target: {
        ...canonicalValidTask.target,
        targetType: 'INVENTED_TARGET_TYPE',
      },
    };
    assertStoreError(
      () => validateStoredPendingTaskRecord(storedWithInvalidTargetType),
      'INVALID_STORED_RECORD'
    );
  });

  // 23. invalid targetId rejected
  await test('23. invalid targetId rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: {
            ...canonicalValidTask,
            target: {
              ...canonicalValidTask.target,
              targetId: '',
            },
          },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: {
            ...canonicalValidTask,
            target: {
              ...canonicalValidTask.target,
              targetId: '   ',
            },
          },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 24. invalid sourceUpdatedAt rejected
  await test('24. invalid sourceUpdatedAt rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: {
            ...canonicalValidTask,
            target: {
              ...canonicalValidTask.target,
              sourceUpdatedAt: '',
            },
          },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: {
            ...canonicalValidTask,
            target: {
              ...canonicalValidTask.target,
              sourceUpdatedAt: ' padded ',
            },
          },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 25. invalid createdAt rejected
  await test('25. invalid createdAt rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, createdAt: '' },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, createdAt: '  ' },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 26. non-plain contentSnapshot rejected
  await test('26. non-plain contentSnapshot rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: null as unknown as Record<string, unknown> },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: 'string' as unknown as Record<string, unknown> },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: [1, 2, 3] as unknown as Record<string, unknown> },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 27. nested Date/Map/Set/class instance rejected
  await test('27. nested Date/Map/Set/class instance rejected', () => {
    class CustomClass {
      val = 1;
    }
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { d: new Date() } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { m: new Map() } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { s: new Set() } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { c: new CustomClass() } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 28. nested undefined/function/symbol/bigint rejected
  await test('28. nested undefined/function/symbol/bigint rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { u: undefined } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { fn: () => 123 } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { sym: Symbol('s') } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { b: BigInt(99) } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 29. nested NaN/Infinity rejected
  await test('29. nested NaN/Infinity rejected', () => {
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { nan: Number.NaN } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { inf: Number.POSITIVE_INFINITY } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: { ninf: Number.NEGATIVE_INFINITY } },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 30. cyclic contentSnapshot rejected
  await test('30. cyclic contentSnapshot rejected', () => {
    const cyclicObj: Record<string, unknown> = { a: 1 };
    cyclicObj.self = cyclicObj;
    assertStoreError(
      () =>
        createStoredPendingTaskRecord({
          principalId: 'p-1',
          task: { ...canonicalValidTask, contentSnapshot: cyclicObj },
        }),
      'INVALID_DOWNLOADED_TASK'
    );
  });

  // 31. nested arrays + finite numbers + booleans + null accepted
  await test('31. nested arrays + finite numbers + booleans + null accepted', () => {
    const validComplexSnapshot = {
      str: 'text',
      num: 123.456,
      zero: 0,
      neg: -99,
      boolTrue: true,
      boolFalse: false,
      nullVal: null,
      arr: [1, 'two', false, null, { nested: [true] }],
    };
    const record = createStoredPendingTaskRecord({
      principalId: 'p-1',
      task: { ...canonicalValidTask, contentSnapshot: validComplexSnapshot },
    });
    assert(record.contentSnapshot === validComplexSnapshot, 'Valid complex snapshot accepted');
  });

  // 32. shared non-cyclic object reference accepted
  await test('32. shared non-cyclic object reference accepted', () => {
    const shared = { title: 'shared-data' };
    const snapshotWithShared = {
      first: shared,
      second: shared,
      list: [shared, shared],
    };
    const record = createStoredPendingTaskRecord({
      principalId: 'p-1',
      task: { ...canonicalValidTask, contentSnapshot: snapshotWithShared },
    });
    assert(record.contentSnapshot === snapshotWithShared, 'Shared non-cyclic references accepted');
  });

  // 33. validateStoredPendingTaskRecord accepts valid record
  await test('33. validateStoredPendingTaskRecord accepts valid record', () => {
    const stored = createStoredPendingTaskRecord(canonicalDownloadedTask);
    const validated = validateStoredPendingTaskRecord(stored);
    assert(validated.taskId === stored.taskId, 'Valid stored record passes validation');
  });

  // 34. validator returns exact accepted record reference
  await test('34. validator returns exact accepted record reference', () => {
    const stored = createStoredPendingTaskRecord(canonicalDownloadedTask);
    const validated = validateStoredPendingTaskRecord(stored);
    assert(validated === stored, 'Validator must return exact input record reference');
  });

  // 35. missing stored key rejected
  await test('35. missing stored key rejected', () => {
    const stored = createStoredPendingTaskRecord(canonicalDownloadedTask);
    const missingTaskId = { ...stored } as Record<string, unknown>;
    delete missingTaskId.taskId;
    assertStoreError(() => validateStoredPendingTaskRecord(missingTaskId), 'INVALID_STORED_RECORD');

    const missingLocalState = { ...stored } as Record<string, unknown>;
    delete missingLocalState.localState;
    assertStoreError(() => validateStoredPendingTaskRecord(missingLocalState), 'INVALID_STORED_RECORD');
  });

  // 36. extra stored key rejected
  await test('36. extra stored key rejected', () => {
    const stored = createStoredPendingTaskRecord(canonicalDownloadedTask);
    const withExtra = { ...stored, extraKey: 'forbidden' };
    assertStoreError(() => validateStoredPendingTaskRecord(withExtra), 'INVALID_STORED_RECORD');
  });

  // 37. invalid remoteStatus/localState rejected
  await test('37. invalid remoteStatus/localState rejected', () => {
    const stored = createStoredPendingTaskRecord(canonicalDownloadedTask);
    assertStoreError(
      () =>
        validateStoredPendingTaskRecord({
          ...stored,
          remoteStatus: 'Completed',
        }),
      'INVALID_STORED_RECORD'
    );
    assertStoreError(
      () =>
        validateStoredPendingTaskRecord({
          ...stored,
          localState: 'Processing',
        }),
      'INVALID_STORED_RECORD'
    );
  });

  // 38. stored record containing secret/authority extra field rejected
  await test('38. stored record containing secret/authority extra field rejected', () => {
    const stored = createStoredPendingTaskRecord(canonicalDownloadedTask);
    const secretKeys = [
      { credential: 'secret' },
      { Authorization: 'Bearer x' },
      { Bearer: 'token' },
      { token: 'opaque' },
      { endpointUrl: 'https://gateway' },
      { approved: true },
      { published: true },
      { decision: 'APPROVE' },
      { workflowState: 'Approved' },
      { desiredWorkflowState: 'Published' },
      { role: 'admin' },
      { permission: 'all' },
      { autoApply: true },
      { autoPublish: true },
    ];
    for (const extra of secretKeys) {
      assertStoreError(
        () => validateStoredPendingTaskRecord({ ...stored, ...extra }),
        'INVALID_STORED_RECORD'
      );
    }
  });

  // 39. isSameStoredPendingTaskRecord true for structurally equal distinct records
  await test('39. isSameStoredPendingTaskRecord true for structurally equal distinct records', () => {
    const left: StoredPendingTaskRecord = {
      taskId: 't-39',
      principalId: 'p-39',
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'news-39',
        sourceUpdatedAt: '2026-09-27T00:00:00.000Z',
      },
      contentSnapshot: { title: 'News 39', counts: [1, 2, 3] },
      remoteCreatedAt: '2026-09-28T00:00:00.000Z',
      remoteStatus: AITaskStatus.Pending,
      localState: LocalPendingTaskState.Downloaded,
    };

    const right: StoredPendingTaskRecord = {
      taskId: 't-39',
      principalId: 'p-39',
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'news-39',
        sourceUpdatedAt: '2026-09-27T00:00:00.000Z',
      },
      contentSnapshot: { title: 'News 39', counts: [1, 2, 3] },
      remoteCreatedAt: '2026-09-28T00:00:00.000Z',
      remoteStatus: AITaskStatus.Pending,
      localState: LocalPendingTaskState.Downloaded,
    };

    assert(left !== right, 'Objects must have different references');
    assert(isSameStoredPendingTaskRecord(left, right) === true, 'Structurally equal distinct records must return true');
  });

  // 40. isSameStoredPendingTaskRecord false for same taskId but changed canonical content
  await test('40. isSameStoredPendingTaskRecord false for same taskId but changed canonical content', () => {
    const base: StoredPendingTaskRecord = {
      taskId: 't-40',
      principalId: 'p-40',
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'news-40',
        sourceUpdatedAt: '2026-09-27T00:00:00.000Z',
      },
      contentSnapshot: { title: 'Original' },
      remoteCreatedAt: '2026-09-28T00:00:00.000Z',
      remoteStatus: AITaskStatus.Pending,
      localState: LocalPendingTaskState.Downloaded,
    };

    const changedTarget = {
      ...base,
      target: { ...base.target, targetId: 'news-changed' },
    };
    assert(isSameStoredPendingTaskRecord(base, changedTarget) === false, 'Changed target must return false');

    const changedSnapshot = {
      ...base,
      contentSnapshot: { title: 'Modified' },
    };
    assert(isSameStoredPendingTaskRecord(base, changedSnapshot) === false, 'Changed snapshot must return false');
  });

  // 41. LocalPendingTaskRepository interface source contract contains exactly: save, findByTaskId, listDownloaded and no mutation lifecycle methods
  await test('41. LocalPendingTaskRepository interface source contract contains exactly save, findByTaskId, listDownloaded', () => {
    const contractPath = join(process.cwd(), 'peia-worker/src/localPendingTaskStoreContract.ts');
    const source = readFileSync(contractPath, 'utf8');

    const ifaceStart = source.indexOf('export interface LocalPendingTaskRepository {');
    assert(ifaceStart !== -1, 'LocalPendingTaskRepository interface not found');
    const ifaceEnd = source.indexOf('}', ifaceStart);
    assert(ifaceEnd !== -1, 'End of LocalPendingTaskRepository interface not found');

    const ifaceBody = source.slice(ifaceStart, ifaceEnd);

    assert(ifaceBody.includes('save(record: StoredPendingTaskRecord): Promise<void>;'), 'save method missing');
    assert(ifaceBody.includes('findByTaskId(taskId: string): Promise<StoredPendingTaskRecord | null>;'), 'findByTaskId method missing');
    assert(ifaceBody.includes('listDownloaded(): Promise<readonly StoredPendingTaskRecord[]>;'), 'listDownloaded method missing');

    const forbiddenMethods = [
      'delete(',
      'remove(',
      'update(',
      'markComplete(',
      'markFailed(',
      'claim(',
      'lease(',
      'retry(',
      'clear(',
      'purge(',
    ];
    for (const method of forbiddenMethods) {
      assert(!ifaceBody.includes(method), `Forbidden lifecycle method "${method}" found in repository interface`);
    }
  });

  // 42. source invariants + exact final count gate
  await test('42. source invariants + exact final count gate', () => {
    const contractPath = join(process.cwd(), 'peia-worker/src/localPendingTaskStoreContract.ts');
    const source = readFileSync(contractPath, 'utf8');

    const forbiddenGlobals = [
      'firebase-admin',
      'firebase-functions',
      'functions/src/',
      'fetch',
      'globalThis.fetch',
      'Authorization',
      'Bearer',
      'endpointUrl',
      'node:fs',
      "from 'fs'",
      'from "fs"',
      'readFile',
      'writeFile',
      'appendFile',
      'mkdir',
      'sqlite',
      'better-sqlite3',
      'Database',
      'CREATE TABLE',
      'INSERT',
      'UPDATE',
      'DELETE',
      'localStorage',
      'IndexedDB',
      'console.log',
      'console.error',
      'logger',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'approved',
      'published',
      'workflowState',
      'desiredWorkflowState',
      'autoPublish',
      'autoApply',
      'credential',
      'machineToken',
      'apiKey',
      'serviceAccount',
    ];

    for (const term of forbiddenGlobals) {
      assert(!source.includes(term), `Forbidden term "${term}" found in localPendingTaskStoreContract.ts`);
    }

    // Verify exactly one local state: Downloaded
    const localStates = Object.keys(LocalPendingTaskState);
    assert(
      localStates.length === 1 && localStates[0] === 'Downloaded',
      `Expected exactly one LocalPendingTaskState (Downloaded), found ${JSON.stringify(localStates)}`
    );

    // Verify StoredPendingTaskRecord keys definition
    const storedRecordTypeCheck = [
      'permission',
      'role',
      'decision',
      'suggestedAction',
    ];
    for (const prohibited of storedRecordTypeCheck) {
      assert(
        !source.includes(`readonly ${prohibited}:`),
        `Prohibited authority field "${prohibited}" must not be part of StoredPendingTaskRecord`
      );
    }

    // Verify production derives target membership from canonical AIReviewTargetType
    assert(
      source.includes('Object.values(AIReviewTargetType)'),
      'Production must derive target membership from Object.values(AIReviewTargetType)'
    );

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
