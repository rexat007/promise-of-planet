import { describe, it, expect, afterEach } from 'vitest';
import {
  AIReviewSeverity,
  AIReviewTargetType,
  AITaskStatus,
  AITaskType,
  NewsAdminClient,
  type AdvisoryResultIntakeResult,
  type AIReviewTask,
  type CanonicalNonAdvisoryOutcome,
  type GetNewsPeiaReviewStatusResponseDto,
  type RequestNewsPeiaReviewResponseDto,
  type SanitizedNewsPeiaReviewStatusDto,
} from './newsAdminClient';

const ARTICLE_ID = 'news-article-101';
const SOURCE_UPDATED_AT = '2026-04-12T10:00:00.000Z';
const NEWER_SOURCE_UPDATED_AT = '2026-04-12T14:30:00.000Z';
const HISTORICAL_SOURCE_UPDATED_AT = '2026-04-10T08:00:00.000Z';

// Server-realistic SHA-256 derived task IDs:
// derivePeiaTaskId(AIReviewTargetType.News, 'news-article-101', '2026-04-12T10:00:00.000Z')
const SERVER_HASHED_TASK_ID = 'peia-task-56bd93fe11b289d0af7d346046ae8d0c';
// derivePeiaTaskId(AIReviewTargetType.News, 'news-article-101', '2026-04-12T14:30:00.000Z')
const SERVER_HASHED_NEWER_TASK_ID = 'peia-task-b552f19c7581b0377daefe40dd9e3f08';
// derivePeiaTaskId(AIReviewTargetType.News, 'news-article-101', '2026-04-10T08:00:00.000Z')
const SERVER_HASHED_HISTORICAL_TASK_ID = 'peia-task-70c829bcc787f879f4fb46f9e46c1072';

function buildCanonicalNewsTask(
  status: AITaskStatus,
  overrides: Partial<AIReviewTask> = {}
): AIReviewTask {
  return {
    taskId: SERVER_HASHED_TASK_ID,
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: ARTICLE_ID,
      sourceUpdatedAt: SOURCE_UPDATED_AT,
    },
    contentSnapshot: {
      id: ARTICLE_ID,
      titleAr: 'تقرير رصد مناسيب النيل الأزرق في ولاية سنار',
      titleEn: 'Blue Nile Water Level Monitoring Report in Sennar State',
      updatedAt: SOURCE_UPDATED_AT,
    },
    createdAt: '2026-04-12T10:05:00.000Z',
    status,
    ...overrides,
  };
}

function buildCanonicalNewsAdvisoryResult(
  overrides: Partial<AdvisoryResultIntakeResult> = {}
): AdvisoryResultIntakeResult {
  return {
    schemaVersion: 1,
    task: {
      taskId: SERVER_HASHED_TASK_ID,
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        sourceUpdatedAt: SOURCE_UPDATED_AT,
      },
    },
    assessment: {
      summary:
        'News article draft aligns with verified hydrological reporting in Blue Nile state.',
      findings: [
        {
          code: 'LOCATION_ATTRIBUTION_CHECK',
          severity: AIReviewSeverity.Warning,
          message:
            'Specify the exact monitoring station date for the Sennar water level measurement.',
          evidenceIds: ['ev_news_station_01', 'ev_news_bulletin_02'],
        },
      ],
    },
    recommendations: [
      'Include the official irrigation bulletin reference date in paragraph two.',
    ],
    uncertainties: ['Downstream discharge figures for April remain preliminary.'],
    limitations: [
      'Advisory assessment is restricted to retrieved text evidence and requires human editorial verification.',
    ],
    humanReviewRequired: true,
    ...overrides,
  };
}

function buildCanonicalFailureOutcome(
  overrides: Partial<CanonicalNonAdvisoryOutcome> = {}
): CanonicalNonAdvisoryOutcome {
  return {
    kind: 'RETRIEVAL_FAILURE',
    taskId: SERVER_HASHED_TASK_ID,
    reason: 'SOURCE_LOAD_FAILED',
    createdAt: '2026-04-12T10:06:30.000Z',
    modelAttempts: 0,
    exitCode: 20,
    detail: 'Evidence index snapshot could not be loaded.',
    ...overrides,
  };
}

function buildCanonicalAbstainedOutcome(
  overrides: Partial<CanonicalNonAdvisoryOutcome> = {}
): CanonicalNonAdvisoryOutcome {
  return {
    kind: 'ABSTAINED',
    taskId: SERVER_HASHED_TASK_ID,
    reason: 'NO_EVIDENCE',
    createdAt: '2026-04-12T10:06:30.000Z',
    modelAttempts: 0,
    detail:
      'Retrieval returned zero usable evidence items; model invocation skipped.',
    ...overrides,
  };
}

describe('NewsAdminClient PEIA Review Actions (NEWS-PEIA-01 & NEWS-PEIA-01-R1)', () => {
  afterEach(() => {
    NewsAdminClient.setTransport(null);
  });

  it('validates input arguments before invoking transport', async () => {
    let transportCalled = false;
    NewsAdminClient.setTransport(async () => {
      transportCalled = true;
      return {};
    });

    await expect(
      NewsAdminClient.requestPeiaReview('', SOURCE_UPDATED_AT)
    ).rejects.toThrow(/INVALID_ARGUMENT: id/);

    await expect(
      NewsAdminClient.requestPeiaReview('bad/id/with/slashes', SOURCE_UPDATED_AT)
    ).rejects.toThrow(/INVALID_ARGUMENT: id/);

    await expect(
      NewsAdminClient.requestPeiaReview(ARTICLE_ID, 'not-an-iso-date')
    ).rejects.toThrow(/INVALID_ARGUMENT: expectedUpdatedAt/);

    await expect(NewsAdminClient.getPeiaReviewStatus('')).rejects.toThrow(
      /INVALID_ARGUMENT: id/
    );

    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID, 'bad task id')
    ).rejects.toThrow(/INVALID_ARGUMENT: taskId/);

    expect(transportCalled).toBe(false);
  });

  it('calls manageNews requestPeiaReview for CREATED and ALREADY_EXISTS dispositions with server-derived hashed taskId', async () => {
    const calls: Array<{ action: string; payload: any }> = [];
    const pendingTask = buildCanonicalNewsTask(AITaskStatus.Pending);
    const reviewStatus: SanitizedNewsPeiaReviewStatusDto = {
      status: AITaskStatus.Pending,
      taskId: SERVER_HASHED_TASK_ID,
      targetType: AIReviewTargetType.News,
      targetId: ARTICLE_ID,
      currentSourceUpdatedAt: SOURCE_UPDATED_AT,
      taskSourceUpdatedAt: SOURCE_UPDATED_AT,
      isStale: false,
      task: pendingTask,
      advisoryResult: null,
      nonAdvisoryOutcome: null,
    };

    let nextDisposition: 'CREATED' | 'ALREADY_EXISTS' = 'CREATED';
    NewsAdminClient.setTransport(async (action, payload) => {
      calls.push({ action, payload });
      const res: RequestNewsPeiaReviewResponseDto = {
        disposition: nextDisposition,
        documentId: ARTICLE_ID,
        taskId: SERVER_HASHED_TASK_ID,
        task: pendingTask,
        status: AITaskStatus.Pending,
        isStale: false,
        advisoryResult: null,
        nonAdvisoryOutcome: null,
        reviewStatus,
      };
      return res;
    });

    const createdRes = await NewsAdminClient.requestPeiaReview(
      ARTICLE_ID,
      SOURCE_UPDATED_AT
    );
    expect(createdRes.disposition).toBe('CREATED');
    expect(createdRes.taskId).toBe(SERVER_HASHED_TASK_ID);
    expect(createdRes.reviewStatus.status).toBe(AITaskStatus.Pending);

    nextDisposition = 'ALREADY_EXISTS';
    const existingRes = await NewsAdminClient.requestPeiaReview(
      ARTICLE_ID,
      SOURCE_UPDATED_AT
    );
    expect(existingRes.disposition).toBe('ALREADY_EXISTS');
    expect(calls).toEqual([
      {
        action: 'requestPeiaReview',
        payload: { id: ARTICLE_ID, expectedUpdatedAt: SOURCE_UPDATED_AT },
      },
      {
        action: 'requestPeiaReview',
        payload: { id: ARTICLE_ID, expectedUpdatedAt: SOURCE_UPDATED_AT },
      },
    ]);
  });

  it('calls manageNews getPeiaReviewStatus and validates NotRequested, Pending, Completed+ADVISORY, Completed+ABSTAINED, Failed, Stale, and explicit historical taskId states with server-derived hashed task IDs', async () => {
    let mockedStatus: SanitizedNewsPeiaReviewStatusDto = {
      status: 'NotRequested',
      taskId: SERVER_HASHED_TASK_ID,
      targetType: AIReviewTargetType.News,
      targetId: ARTICLE_ID,
      currentSourceUpdatedAt: SOURCE_UPDATED_AT,
      taskSourceUpdatedAt: null,
      isStale: false,
      task: null,
      advisoryResult: null,
      nonAdvisoryOutcome: null,
    };

    const transportPayloads: any[] = [];
    NewsAdminClient.setTransport(async (action, payload) => {
      expect(action).toBe('getPeiaReviewStatus');
      transportPayloads.push(payload);
      const res: GetNewsPeiaReviewStatusResponseDto = {
        ...mockedStatus,
        reviewStatus: mockedStatus,
      };
      return res;
    });

    // 1. NotRequested (without taskId -> payload must omit taskId key and accept server SHA-256 taskId)
    const notReq = await NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID);
    expect(notReq.status).toBe('NotRequested');
    expect(notReq.taskId).toBe(SERVER_HASHED_TASK_ID);
    expect(notReq.task).toBeNull();
    expect(transportPayloads[0]).toEqual({ id: ARTICLE_ID });
    expect('taskId' in transportPayloads[0]).toBe(false);

    // 2. Pending
    mockedStatus = {
      status: AITaskStatus.Pending,
      taskId: SERVER_HASHED_TASK_ID,
      targetType: AIReviewTargetType.News,
      targetId: ARTICLE_ID,
      currentSourceUpdatedAt: SOURCE_UPDATED_AT,
      taskSourceUpdatedAt: SOURCE_UPDATED_AT,
      isStale: false,
      task: buildCanonicalNewsTask(AITaskStatus.Pending),
      advisoryResult: null,
      nonAdvisoryOutcome: null,
    };
    const pending = await NewsAdminClient.getPeiaReviewStatus(
      ARTICLE_ID,
      SERVER_HASHED_TASK_ID
    );
    expect(pending.status).toBe(AITaskStatus.Pending);
    expect(pending.taskId).toBe(SERVER_HASHED_TASK_ID);
    expect(transportPayloads[1]).toEqual({
      id: ARTICLE_ID,
      taskId: SERVER_HASHED_TASK_ID,
    });

    // 3. Completed + ADVISORY (fresh)
    const advisory = buildCanonicalNewsAdvisoryResult();
    mockedStatus = {
      status: AITaskStatus.Completed,
      taskId: SERVER_HASHED_TASK_ID,
      targetType: AIReviewTargetType.News,
      targetId: ARTICLE_ID,
      currentSourceUpdatedAt: SOURCE_UPDATED_AT,
      taskSourceUpdatedAt: SOURCE_UPDATED_AT,
      isStale: false,
      task: buildCanonicalNewsTask(AITaskStatus.Completed),
      advisoryResult: advisory,
      nonAdvisoryOutcome: null,
    };
    const completed = await NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID);
    expect(completed.status).toBe(AITaskStatus.Completed);
    expect(completed.taskId).toBe(SERVER_HASHED_TASK_ID);
    expect(completed.isStale).toBe(false);
    expect(completed.advisoryResult?.assessment.summary).toContain('Blue Nile');

    // 4. Completed + ADVISORY (stale after article update)
    mockedStatus = {
      ...mockedStatus,
      currentSourceUpdatedAt: NEWER_SOURCE_UPDATED_AT,
      taskSourceUpdatedAt: SOURCE_UPDATED_AT,
      isStale: true,
    };
    const staleCompleted = await NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID);
    expect(staleCompleted.isStale).toBe(true);
    expect(staleCompleted.taskSourceUpdatedAt).toBe(SOURCE_UPDATED_AT);
    expect(staleCompleted.currentSourceUpdatedAt).toBe(NEWER_SOURCE_UPDATED_AT);

    // 5. Completed + ABSTAINED
    const abstained = buildCanonicalAbstainedOutcome();
    mockedStatus = {
      status: AITaskStatus.Completed,
      taskId: SERVER_HASHED_TASK_ID,
      targetType: AIReviewTargetType.News,
      targetId: ARTICLE_ID,
      currentSourceUpdatedAt: SOURCE_UPDATED_AT,
      taskSourceUpdatedAt: SOURCE_UPDATED_AT,
      isStale: false,
      task: buildCanonicalNewsTask(AITaskStatus.Completed),
      advisoryResult: null,
      nonAdvisoryOutcome: abstained,
    };
    const completedAbstained =
      await NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID);
    expect(completedAbstained.status).toBe(AITaskStatus.Completed);
    expect(completedAbstained.taskId).toBe(SERVER_HASHED_TASK_ID);
    expect(completedAbstained.advisoryResult).toBeNull();
    expect(completedAbstained.nonAdvisoryOutcome?.kind).toBe('ABSTAINED');
    expect(completedAbstained.nonAdvisoryOutcome?.reason).toBe('NO_EVIDENCE');

    // 6. Failed
    const failure = buildCanonicalFailureOutcome();
    mockedStatus = {
      status: AITaskStatus.Failed,
      taskId: SERVER_HASHED_TASK_ID,
      targetType: AIReviewTargetType.News,
      targetId: ARTICLE_ID,
      currentSourceUpdatedAt: SOURCE_UPDATED_AT,
      taskSourceUpdatedAt: SOURCE_UPDATED_AT,
      isStale: false,
      task: buildCanonicalNewsTask(AITaskStatus.Failed),
      advisoryResult: null,
      nonAdvisoryOutcome: failure,
    };
    const failed = await NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID);
    expect(failed.status).toBe(AITaskStatus.Failed);
    expect(failed.taskId).toBe(SERVER_HASHED_TASK_ID);
    expect(failed.nonAdvisoryOutcome?.kind).toBe('RETRIEVAL_FAILURE');

    // 7. Explicit historical taskId lookup (stale relative to currentSourceUpdatedAt)
    const historicalTask = buildCanonicalNewsTask(AITaskStatus.Completed, {
      taskId: SERVER_HASHED_HISTORICAL_TASK_ID,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        sourceUpdatedAt: HISTORICAL_SOURCE_UPDATED_AT,
      },
    });
    const historicalAdvisory = buildCanonicalNewsAdvisoryResult({
      task: {
        taskId: SERVER_HASHED_HISTORICAL_TASK_ID,
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: AIReviewTargetType.News,
          targetId: ARTICLE_ID,
          sourceUpdatedAt: HISTORICAL_SOURCE_UPDATED_AT,
        },
      },
    });
    mockedStatus = {
      status: AITaskStatus.Completed,
      taskId: SERVER_HASHED_HISTORICAL_TASK_ID,
      targetType: AIReviewTargetType.News,
      targetId: ARTICLE_ID,
      currentSourceUpdatedAt: NEWER_SOURCE_UPDATED_AT,
      taskSourceUpdatedAt: HISTORICAL_SOURCE_UPDATED_AT,
      isStale: true,
      task: historicalTask,
      advisoryResult: historicalAdvisory,
      nonAdvisoryOutcome: null,
    };
    const historicalStatus = await NewsAdminClient.getPeiaReviewStatus(
      ARTICLE_ID,
      SERVER_HASHED_HISTORICAL_TASK_ID
    );
    expect(historicalStatus.taskId).toBe(SERVER_HASHED_HISTORICAL_TASK_ID);
    expect(historicalStatus.isStale).toBe(true);
    expect(historicalStatus.taskSourceUpdatedAt).toBe(HISTORICAL_SOURCE_UPDATED_AT);
    expect(historicalStatus.currentSourceUpdatedAt).toBe(NEWER_SOURCE_UPDATED_AT);
  });

  it('rejects mismatched taskId identities across expectedTaskId, dto.task, dto.advisoryResult.task, dto.nonAdvisoryOutcome, and requestPeiaReview top-level fields', async () => {
    // 1. dto.taskId !== expectedTaskId when caller supplies explicit taskId
    NewsAdminClient.setTransport(async () => {
      const mismatchedDto: SanitizedNewsPeiaReviewStatusDto = {
        status: AITaskStatus.Pending,
        taskId: SERVER_HASHED_NEWER_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: NEWER_SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: NEWER_SOURCE_UPDATED_AT,
        isStale: false,
        task: buildCanonicalNewsTask(AITaskStatus.Pending, {
          taskId: SERVER_HASHED_NEWER_TASK_ID,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: ARTICLE_ID,
            sourceUpdatedAt: NEWER_SOURCE_UPDATED_AT,
          },
        }),
        advisoryResult: null,
        nonAdvisoryOutcome: null,
      };
      return { ...mismatchedDto, reviewStatus: mismatchedDto };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID, SERVER_HASHED_HISTORICAL_TASK_ID)
    ).rejects.toThrow(/Expected taskId/);

    // 2. dto.task.taskId !== dto.taskId
    NewsAdminClient.setTransport(async () => {
      const badTaskIdentity: SanitizedNewsPeiaReviewStatusDto = {
        status: AITaskStatus.Pending,
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: SOURCE_UPDATED_AT,
        isStale: false,
        task: buildCanonicalNewsTask(AITaskStatus.Pending, {
          taskId: SERVER_HASHED_NEWER_TASK_ID,
        }),
        advisoryResult: null,
        nonAdvisoryOutcome: null,
      };
      return { ...badTaskIdentity, reviewStatus: badTaskIdentity };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/task record envelope does not match expected task identity/);

    // 3. dto.advisoryResult.task.taskId !== dto.taskId
    NewsAdminClient.setTransport(async () => {
      const badAdvisoryTaskIdentity: SanitizedNewsPeiaReviewStatusDto = {
        status: AITaskStatus.Completed,
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: SOURCE_UPDATED_AT,
        isStale: false,
        task: buildCanonicalNewsTask(AITaskStatus.Completed),
        advisoryResult: buildCanonicalNewsAdvisoryResult({
          task: {
            taskId: SERVER_HASHED_NEWER_TASK_ID,
            taskType: AITaskType.CONTENT_REVIEW,
            target: {
              targetType: AIReviewTargetType.News,
              targetId: ARTICLE_ID,
              sourceUpdatedAt: SOURCE_UPDATED_AT,
            },
          },
        }),
        nonAdvisoryOutcome: null,
      };
      return { ...badAdvisoryTaskIdentity, reviewStatus: badAdvisoryTaskIdentity };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/advisoryResult task\/target envelope does not match/);

    // 4. dto.nonAdvisoryOutcome.taskId !== dto.taskId (ABSTAINED under Completed)
    NewsAdminClient.setTransport(async () => {
      const badAbstainedIdentity: SanitizedNewsPeiaReviewStatusDto = {
        status: AITaskStatus.Completed,
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: SOURCE_UPDATED_AT,
        isStale: false,
        task: buildCanonicalNewsTask(AITaskStatus.Completed),
        advisoryResult: null,
        nonAdvisoryOutcome: buildCanonicalAbstainedOutcome({
          taskId: SERVER_HASHED_NEWER_TASK_ID,
        }),
      };
      return { ...badAbstainedIdentity, reviewStatus: badAbstainedIdentity };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/ABSTAINED nonAdvisoryOutcome envelope is malformed/);

    // 5. dto.nonAdvisoryOutcome.taskId !== dto.taskId (Failed outcome)
    NewsAdminClient.setTransport(async () => {
      const badFailedIdentity: SanitizedNewsPeiaReviewStatusDto = {
        status: AITaskStatus.Failed,
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: SOURCE_UPDATED_AT,
        isStale: false,
        task: buildCanonicalNewsTask(AITaskStatus.Failed),
        advisoryResult: null,
        nonAdvisoryOutcome: buildCanonicalFailureOutcome({
          taskId: SERVER_HASHED_NEWER_TASK_ID,
        }),
      };
      return { ...badFailedIdentity, reviewStatus: badFailedIdentity };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/Failed nonAdvisoryOutcome envelope is malformed/);

    // 6. requestPeiaReview top-level taskId !== reviewStatus.taskId
    NewsAdminClient.setTransport(async () => {
      const pendingTask = buildCanonicalNewsTask(AITaskStatus.Pending);
      const reviewStatus: SanitizedNewsPeiaReviewStatusDto = {
        status: AITaskStatus.Pending,
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: SOURCE_UPDATED_AT,
        isStale: false,
        task: pendingTask,
        advisoryResult: null,
        nonAdvisoryOutcome: null,
      };
      return {
        disposition: 'CREATED',
        documentId: ARTICLE_ID,
        taskId: SERVER_HASHED_NEWER_TASK_ID,
        task: pendingTask,
        status: AITaskStatus.Pending,
        isStale: false,
        advisoryResult: null,
        nonAdvisoryOutcome: null,
        reviewStatus,
      };
    });
    await expect(
      NewsAdminClient.requestPeiaReview(ARTICLE_ID, SOURCE_UPDATED_AT)
    ).rejects.toThrow(/top-level fields are inconsistent with reviewStatus/);
  });

  it('fails closed on malformed, contradictory, cross-target, or libraryPreparation-contaminated server responses', async () => {
    // 1. Wrong targetType (Library instead of News)
    NewsAdminClient.setTransport(async () => {
      const bad: any = {
        status: 'NotRequested',
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.Library,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: null,
        isStale: false,
        task: null,
        advisoryResult: null,
        nonAdvisoryOutcome: null,
      };
      return { ...bad, reviewStatus: bad };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/INVALID_SERVER_RESPONSE/);

    // 2. News advisoryResult unexpectedly contains libraryPreparation
    NewsAdminClient.setTransport(async () => {
      const badAdvisory: any = {
        ...buildCanonicalNewsAdvisoryResult(),
        libraryPreparation: {
          suggestedTitle: 'Should not exist on News',
          suggestedSummary: 'Should not exist on News',
          suggestedTags: ['water'],
          classificationNotes: 'Invalid on News target',
        },
      };
      const bad: any = {
        status: AITaskStatus.Completed,
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: SOURCE_UPDATED_AT,
        isStale: false,
        task: buildCanonicalNewsTask(AITaskStatus.Completed),
        advisoryResult: badAdvisory,
        nonAdvisoryOutcome: null,
      };
      return { ...bad, reviewStatus: bad };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/must not include libraryPreparation/);

    // 3. ABSTAINED under Failed status is rejected
    NewsAdminClient.setTransport(async () => {
      const bad: any = {
        status: AITaskStatus.Failed,
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: SOURCE_UPDATED_AT,
        isStale: false,
        task: buildCanonicalNewsTask(AITaskStatus.Failed),
        advisoryResult: null,
        nonAdvisoryOutcome: buildCanonicalAbstainedOutcome(),
      };
      return { ...bad, reviewStatus: bad };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/Failed nonAdvisoryOutcome envelope is malformed/);

    // 4. Contradictory Completed with both advisoryResult and nonAdvisoryOutcome
    NewsAdminClient.setTransport(async () => {
      const bad: any = {
        status: AITaskStatus.Completed,
        taskId: SERVER_HASHED_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: SOURCE_UPDATED_AT,
        isStale: false,
        task: buildCanonicalNewsTask(AITaskStatus.Completed),
        advisoryResult: buildCanonicalNewsAdvisoryResult(),
        nonAdvisoryOutcome: buildCanonicalAbstainedOutcome(),
      };
      return { ...bad, reviewStatus: bad };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/Completed PEIA status must include either/);

    // 5. Inconsistent isStale flag
    NewsAdminClient.setTransport(async () => {
      const bad: any = {
        status: AITaskStatus.Pending,
        taskId: SERVER_HASHED_NEWER_TASK_ID,
        targetType: AIReviewTargetType.News,
        targetId: ARTICLE_ID,
        currentSourceUpdatedAt: NEWER_SOURCE_UPDATED_AT,
        taskSourceUpdatedAt: NEWER_SOURCE_UPDATED_AT,
        isStale: true, // contradictory when timestamps match
        task: buildCanonicalNewsTask(AITaskStatus.Pending, {
          taskId: SERVER_HASHED_NEWER_TASK_ID,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: ARTICLE_ID,
            sourceUpdatedAt: NEWER_SOURCE_UPDATED_AT,
          },
        }),
        advisoryResult: null,
        nonAdvisoryOutcome: null,
      };
      return { ...bad, reviewStatus: bad };
    });
    await expect(
      NewsAdminClient.getPeiaReviewStatus(ARTICLE_ID)
    ).rejects.toThrow(/isStale flag is inconsistent/);
  });
});
