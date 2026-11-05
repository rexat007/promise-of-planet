import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AdminNewsManagement,
  NewsPeiaReviewController,
  canReadNewsPeiaReviewStatus,
  canRequestNewsPeiaReview,
  isSavedNewsArticleForPeia,
} from './AdminNewsManagement';
import {
  AIReviewSeverity,
  AIReviewTargetType,
  AITaskStatus,
  AITaskType,
  NewsAdminClient,
  type SanitizedNewsPeiaReviewStatusDto,
} from '../../services/newsAdminClient';
import { AdminRole, type AdminUser } from '../../types/admin';
import { WorkflowState } from '../../types/workflow';
import type { NewsItem } from '../../types/news';

const OWNER_USER: AdminUser = {
  id: 'usr-owner-1',
  name: 'Dr. Amira Al-Tayeb',
  email: 'amira.owner@pop-sudan.org',
  role: AdminRole.Owner,
  isActive: true,
};

const CONTENT_EDITOR_USER: AdminUser = {
  id: 'usr-editor-1',
  name: 'Tariq Osman',
  email: 'tariq.editor@pop-sudan.org',
  role: AdminRole.ContentEditor,
  isActive: true,
};

const RIGHTS_REVIEWER_USER: AdminUser = {
  id: 'usr-rights-1',
  name: 'Nadia Hassan',
  email: 'nadia.rights@pop-sudan.org',
  role: AdminRole.RightsReviewer,
  isActive: true,
};

const MEDIA_MANAGER_USER: AdminUser = {
  id: 'usr-media-1',
  name: 'Salma Idris',
  email: 'salma.media@pop-sudan.org',
  role: AdminRole.MediaManager,
  isActive: true,
};

const AI_ASSISTANT_USER: AdminUser = {
  id: 'usr-ai-1',
  name: 'PEIA Assistant',
  email: 'peia@pop-sudan.org',
  role: AdminRole.AIAssistant,
  isActive: true,
};

const SAVED_ARTICLE: NewsItem = {
  id: 'news-article-101',
  titleAr: 'تقرير رصد مناسيب النيل الأزرق في ولاية سنار',
  titleEn: 'Blue Nile Water Level Monitoring Report in Sennar State',
  summaryAr: 'ملخص ميداني حول مستويات التصريف المائي في محطة سنار.',
  summaryEn: 'Field summary on water discharge levels at Sennar station.',
  bodyAr: 'تفاصيل التقرير الميداني من محطة الرصد الهيدرولوجي في سنار.',
  bodyEn: 'Detailed field report from the hydrological monitoring station in Sennar.',
  author: 'Tariq Osman',
  category: 'Water & Nile Basin / المياه وحوض النيل',
  tags: ['Nile', 'Sennar'],
  sources: ['Ministry of Irrigation Bulletin'],
  workflowState: WorkflowState.Draft,
  createdAt: '2026-04-12T09:00:00.000Z',
  updatedAt: '2026-04-12T10:00:00.000Z',
  history: [],
  relatedVideoIds: [],
};

// derivePeiaTaskId(AIReviewTargetType.News, 'news-article-101', '2026-04-12T10:00:00.000Z')
const TASK_ID = 'peia-task-56bd93fe11b289d0af7d346046ae8d0c';

function buildNotRequestedStatus(): SanitizedNewsPeiaReviewStatusDto {
  return {
    status: 'NotRequested',
    taskId: TASK_ID,
    targetType: AIReviewTargetType.News,
    targetId: SAVED_ARTICLE.id,
    currentSourceUpdatedAt: SAVED_ARTICLE.updatedAt,
    taskSourceUpdatedAt: null,
    isStale: false,
    task: null,
    advisoryResult: null,
    nonAdvisoryOutcome: null,
  };
}

function buildPendingStatus(): SanitizedNewsPeiaReviewStatusDto {
  return {
    status: AITaskStatus.Pending,
    taskId: TASK_ID,
    targetType: AIReviewTargetType.News,
    targetId: SAVED_ARTICLE.id,
    currentSourceUpdatedAt: SAVED_ARTICLE.updatedAt,
    taskSourceUpdatedAt: SAVED_ARTICLE.updatedAt,
    isStale: false,
    task: {
      taskId: TASK_ID,
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: SAVED_ARTICLE.id,
        sourceUpdatedAt: SAVED_ARTICLE.updatedAt,
      },
      contentSnapshot: {
        id: SAVED_ARTICLE.id,
        titleAr: SAVED_ARTICLE.titleAr,
      },
      status: AITaskStatus.Pending,
      createdAt: '2026-04-12T10:05:00.000Z',
    },
    advisoryResult: null,
    nonAdvisoryOutcome: null,
  };
}

function buildCompletedAdvisoryStatus(
  isStale = false
): SanitizedNewsPeiaReviewStatusDto {
  const currentSourceUpdatedAt = isStale
    ? '2026-04-12T12:00:00.000Z'
    : SAVED_ARTICLE.updatedAt;
  return {
    status: AITaskStatus.Completed,
    taskId: TASK_ID,
    targetType: AIReviewTargetType.News,
    targetId: SAVED_ARTICLE.id,
    currentSourceUpdatedAt,
    taskSourceUpdatedAt: SAVED_ARTICLE.updatedAt,
    isStale,
    task: {
      taskId: TASK_ID,
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: SAVED_ARTICLE.id,
        sourceUpdatedAt: SAVED_ARTICLE.updatedAt,
      },
      contentSnapshot: {
        id: SAVED_ARTICLE.id,
        titleAr: SAVED_ARTICLE.titleAr,
      },
      status: AITaskStatus.Completed,
      createdAt: '2026-04-12T10:05:00.000Z',
    },
    advisoryResult: {
      schemaVersion: 1,
      task: {
        taskId: TASK_ID,
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: AIReviewTargetType.News,
          targetId: SAVED_ARTICLE.id,
          sourceUpdatedAt: SAVED_ARTICLE.updatedAt,
        },
      },
      assessment: {
        summary:
          'Grounded hydrological report with one minor station timestamp attribution note.',
        findings: [
          {
            code: 'STATION_DATE_PRECISION',
            severity: AIReviewSeverity.Warning,
            message: 'Include the exact reading date from the Sennar gauge station.',
            evidenceIds: ['ev_sennar_01'],
          },
        ],
      },
      recommendations: [
        'Cite the April 12 irrigation bulletin timestamp in the lead paragraph.',
      ],
      uncertainties: ['Seasonal rainfall projections remain preliminary.'],
      limitations: [
        'Advisory assessment is restricted to retrieved text evidence and requires human editorial verification.',
      ],
      humanReviewRequired: true,
    },
    nonAdvisoryOutcome: null,
  };
}

function buildCompletedAbstainedStatus(): SanitizedNewsPeiaReviewStatusDto {
  return {
    status: AITaskStatus.Completed,
    taskId: TASK_ID,
    targetType: AIReviewTargetType.News,
    targetId: SAVED_ARTICLE.id,
    currentSourceUpdatedAt: SAVED_ARTICLE.updatedAt,
    taskSourceUpdatedAt: SAVED_ARTICLE.updatedAt,
    isStale: false,
    task: {
      taskId: TASK_ID,
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: SAVED_ARTICLE.id,
        sourceUpdatedAt: SAVED_ARTICLE.updatedAt,
      },
      contentSnapshot: {
        id: SAVED_ARTICLE.id,
        titleAr: SAVED_ARTICLE.titleAr,
      },
      status: AITaskStatus.Completed,
      createdAt: '2026-04-12T10:05:00.000Z',
    },
    advisoryResult: null,
    nonAdvisoryOutcome: {
      kind: 'ABSTAINED',
      taskId: TASK_ID,
      reason: 'INSUFFICIENT_EVIDENCE',
      createdAt: '2026-04-12T10:06:00.000Z',
      modelAttempts: 0,
      detail: 'Available evidence chunks did not meet minimum grounding threshold.',
    },
  };
}

function buildFailedStatus(): SanitizedNewsPeiaReviewStatusDto {
  return {
    status: AITaskStatus.Failed,
    taskId: TASK_ID,
    targetType: AIReviewTargetType.News,
    targetId: SAVED_ARTICLE.id,
    currentSourceUpdatedAt: SAVED_ARTICLE.updatedAt,
    taskSourceUpdatedAt: SAVED_ARTICLE.updatedAt,
    isStale: false,
    task: {
      taskId: TASK_ID,
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: SAVED_ARTICLE.id,
        sourceUpdatedAt: SAVED_ARTICLE.updatedAt,
      },
      contentSnapshot: {
        id: SAVED_ARTICLE.id,
        titleAr: SAVED_ARTICLE.titleAr,
      },
      status: AITaskStatus.Failed,
      createdAt: '2026-04-12T10:05:00.000Z',
    },
    advisoryResult: null,
    nonAdvisoryOutcome: {
      kind: 'MODEL_FAILURE',
      taskId: TASK_ID,
      reason: 'RUNTIME_TIMEOUT',
      createdAt: '2026-04-12T10:06:15.000Z',
      modelAttempts: 1,
      exitCode: 30,
      detail: 'Local model inference timed out after 60s.',
    },
  };
}

describe('AdminNewsManagement PEIA Integration (NEWS-PEIA-01)', () => {
  afterEach(() => {
    NewsAdminClient.setTransport(null);
  });

  it('enforces server-aligned News PEIA read and request permissions', () => {
    expect(canReadNewsPeiaReviewStatus(OWNER_USER)).toBe(true);
    expect(canRequestNewsPeiaReview(OWNER_USER)).toBe(true);

    expect(canReadNewsPeiaReviewStatus(CONTENT_EDITOR_USER)).toBe(true);
    expect(canRequestNewsPeiaReview(CONTENT_EDITOR_USER)).toBe(true);

    // RightsReviewer has News domain + View + Review, but NOT Edit
    expect(canReadNewsPeiaReviewStatus(RIGHTS_REVIEWER_USER)).toBe(true);
    expect(canRequestNewsPeiaReview(RIGHTS_REVIEWER_USER)).toBe(false);

    // MediaManager is not responsible for AdminDomain.News
    expect(canReadNewsPeiaReviewStatus(MEDIA_MANAGER_USER)).toBe(false);
    expect(canRequestNewsPeiaReview(MEDIA_MANAGER_USER)).toBe(false);

    // AIAssistant and inactive users are denied
    expect(canReadNewsPeiaReviewStatus(AI_ASSISTANT_USER)).toBe(false);
    expect(canRequestNewsPeiaReview(AI_ASSISTANT_USER)).toBe(false);
    expect(
      canReadNewsPeiaReviewStatus({ ...OWNER_USER, isActive: false })
    ).toBe(false);
  });

  it('distinguishes saved News articles from unsaved creation state and provisional IDs', () => {
    expect(isSavedNewsArticleForPeia(SAVED_ARTICLE, false)).toBe(true);
    expect(isSavedNewsArticleForPeia(SAVED_ARTICLE, true)).toBe(false);
    expect(
      isSavedNewsArticleForPeia(
        { ...SAVED_ARTICLE, id: 'news-sudan-initial' },
        false
      )
    ).toBe(false);
    expect(
      isSavedNewsArticleForPeia(
        { ...SAVED_ARTICLE, id: 'news-sudan-provisional-123' },
        false
      )
    ).toBe(false);
    expect(
      isSavedNewsArticleForPeia({ ...SAVED_ARTICLE, id: 'temp-999' }, false)
    ).toBe(false);
  });

  it('never renders PEIA review section or request button for unsaved new articles or unauthorized roles', () => {
    // 1. Unsaved new article (initialIsCreating = true)
    const unsavedHtml = renderToStaticMarkup(
      <AdminNewsManagement
        currentUser={CONTENT_EDITOR_USER}
        initialIsCreating={true}
        initialActiveTab="workflow"
        languageOverride="en"
      />
    );
    expect(unsavedHtml).not.toContain('news-peia-review-section');
    expect(unsavedHtml).not.toContain('news-peia-request-review-btn');

    // 2. Unauthorized domain role (MediaManager)
    const mediaHtml = renderToStaticMarkup(
      <AdminNewsManagement
        currentUser={MEDIA_MANAGER_USER}
        initialActiveItem={SAVED_ARTICLE}
        initialActiveTab="workflow"
        languageOverride="en"
      />
    );
    expect(mediaHtml).not.toContain('news-peia-review-section');

    // 3. Read-only PEIA role (RightsReviewer): sees section & refresh button, but not Request button
    const rightsHtml = renderToStaticMarkup(
      <AdminNewsManagement
        currentUser={RIGHTS_REVIEWER_USER}
        initialActiveItem={SAVED_ARTICLE}
        initialActiveTab="workflow"
        initialPeiaState={{ reviewStatus: buildNotRequestedStatus() }}
        languageOverride="en"
      />
    );
    expect(rightsHtml).toContain('news-peia-review-section');
    expect(rightsHtml).toContain('news-peia-refresh-status-btn');
    expect(rightsHtml).not.toContain('news-peia-request-review-btn');
  });

  it('renders NotRequested, Pending, Completed+ADVISORY, Completed+ABSTAINED, Failed, and Stale warning states accurately', () => {
    // 1. NotRequested
    const notReqHtml = renderToStaticMarkup(
      <AdminNewsManagement
        currentUser={CONTENT_EDITOR_USER}
        initialActiveItem={SAVED_ARTICLE}
        initialActiveTab="workflow"
        initialPeiaState={{ reviewStatus: buildNotRequestedStatus() }}
        languageOverride="en"
      />
    );
    expect(notReqHtml).toContain('news-peia-status-not-requested');
    expect(notReqHtml).toContain('news-peia-request-review-btn');

    // 2. Pending + CREATED disposition
    const pendingHtml = renderToStaticMarkup(
      <AdminNewsManagement
        currentUser={CONTENT_EDITOR_USER}
        initialActiveItem={SAVED_ARTICLE}
        initialActiveTab="workflow"
        initialPeiaState={{
          reviewStatus: buildPendingStatus(),
          lastEnqueueDisposition: 'CREATED',
        }}
        languageOverride="en"
      />
    );
    expect(pendingHtml).toContain('news-peia-status-pending');
    expect(pendingHtml).toContain('news-peia-disposition-created');
    expect(pendingHtml).toContain(TASK_ID);

    // 3. Completed + ADVISORY (stale)
    const completedStaleHtml = renderToStaticMarkup(
      <AdminNewsManagement
        currentUser={OWNER_USER}
        initialActiveItem={SAVED_ARTICLE}
        initialActiveTab="workflow"
        initialPeiaState={{
          reviewStatus: buildCompletedAdvisoryStatus(true),
          lastEnqueueDisposition: 'ALREADY_EXISTS',
        }}
        languageOverride="en"
      />
    );
    expect(completedStaleHtml).toContain('news-peia-status-completed');
    expect(completedStaleHtml).toContain('news-peia-advisory-only-warning');
    expect(completedStaleHtml).toContain('news-peia-stale-warning-banner');
    expect(completedStaleHtml).toContain('news-peia-disposition-already-exists');
    expect(completedStaleHtml).toContain('STATION_DATE_PRECISION');
    expect(completedStaleHtml).toContain('ev_sennar_01');

    // 4. Completed + ABSTAINED (distinct from Failed, no fabricated advisory findings)
    const abstainedHtml = renderToStaticMarkup(
      <AdminNewsManagement
        currentUser={CONTENT_EDITOR_USER}
        initialActiveItem={SAVED_ARTICLE}
        initialActiveTab="workflow"
        initialPeiaState={{
          reviewStatus: buildCompletedAbstainedStatus(),
        }}
        languageOverride="en"
      />
    );
    expect(abstainedHtml).toContain('news-peia-status-completed-abstained');
    expect(abstainedHtml).toContain(
      'Status: Completed — No Advisory Produced (Abstained)'
    );
    expect(abstainedHtml).toContain('INSUFFICIENT_EVIDENCE');
    expect(abstainedHtml).not.toContain('news-peia-status-failed');
    expect(abstainedHtml).not.toContain('news-peia-status-completed"');

    // 5. Failed
    const failedHtml = renderToStaticMarkup(
      <AdminNewsManagement
        currentUser={CONTENT_EDITOR_USER}
        initialActiveItem={SAVED_ARTICLE}
        initialActiveTab="workflow"
        initialPeiaState={{
          reviewStatus: buildFailedStatus(),
        }}
        languageOverride="en"
      />
    );
    expect(failedHtml).toContain('news-peia-status-failed');
    expect(failedHtml).toContain('MODEL_FAILURE');
    expect(failedHtml).toContain('RUNTIME_TIMEOUT');
  });

  it('refreshes the authoritative saved article before requesting review and pauses on version mismatch', async () => {
    const controller = new NewsPeiaReviewController();
    const newerUpdatedAt = '2026-04-12T15:00:00.000Z';
    // derivePeiaTaskId(AIReviewTargetType.News, 'news-article-101', '2026-04-12T15:00:00.000Z')
    const newerTaskId = 'peia-task-0b476988cbfbb84d58cc7d09f7ff9399';

    let requestPeiaReviewCalled = false;
    let refreshedCallbackItem: NewsItem | null = null;

    NewsAdminClient.setTransport(async (action) => {
      if (action === 'getById') {
        return {
          item: {
            ...SAVED_ARTICLE,
            updatedAt: newerUpdatedAt,
          },
        };
      }
      if (action === 'getPeiaReviewStatus') {
        const status: SanitizedNewsPeiaReviewStatusDto = {
          status: 'NotRequested',
          taskId: newerTaskId,
          targetType: AIReviewTargetType.News,
          targetId: SAVED_ARTICLE.id,
          currentSourceUpdatedAt: newerUpdatedAt,
          taskSourceUpdatedAt: null,
          isStale: false,
          task: null,
          advisoryResult: null,
          nonAdvisoryOutcome: null,
        };
        return { ...status, reviewStatus: status };
      }
      if (action === 'requestPeiaReview') {
        requestPeiaReviewCalled = true;
      }
      throw new Error(`Unexpected action ${action}`);
    });

    const outcome = await controller.requestReview({
      activeArticle: SAVED_ARTICLE,
      isCreating: false,
      user: CONTENT_EDITOR_USER,
      isAr: false,
      onArticleRefreshed: (refreshed) => {
        refreshedCallbackItem = refreshed;
      },
    });

    expect(outcome.executed).toBe(false);
    expect(outcome.pausedForVersionMismatch).toBe(true);
    expect(requestPeiaReviewCalled).toBe(false);
    expect(refreshedCallbackItem?.updatedAt).toBe(newerUpdatedAt);
    expect(controller.getSnapshot().versionMismatchNotice).toContain(
      newerUpdatedAt
    );
    expect(
      controller.getSnapshot().reviewStatus?.currentSourceUpdatedAt
    ).toBe(newerUpdatedAt);
  });

  it('prevents duplicate concurrent request clicks and isolates stale async responses across article switching and modal close', async () => {
    const controller = new NewsPeiaReviewController();
    let resolveFirstGetById: ((val: any) => void) | null = null;
    let requestReviewCalls = 0;

    NewsAdminClient.setTransport(async (action) => {
      if (action === 'getById') {
        return await new Promise((resolve) => {
          resolveFirstGetById = resolve;
        });
      }
      if (action === 'requestPeiaReview') {
        requestReviewCalls += 1;
        const pendingStatus = buildPendingStatus();
        return {
          disposition: 'CREATED',
          documentId: SAVED_ARTICLE.id,
          taskId: TASK_ID,
          task: pendingStatus.task,
          status: AITaskStatus.Pending,
          isStale: false,
          advisoryResult: null,
          nonAdvisoryOutcome: null,
          reviewStatus: pendingStatus,
        };
      }
      throw new Error(`Unexpected action ${action}`);
    });

    const firstAttemptPromise = controller.requestReview({
      activeArticle: SAVED_ARTICLE,
      isCreating: false,
      user: CONTENT_EDITOR_USER,
      isAr: false,
    });

    expect(controller.getSnapshot().requestingReview).toBe(true);

    // Duplicate click while first request is in flight must be ignored
    const duplicateAttempt = await controller.requestReview({
      activeArticle: SAVED_ARTICLE,
      isCreating: false,
      user: CONTENT_EDITOR_USER,
      isAr: false,
    });
    expect(duplicateAttempt.executed).toBe(false);

    // Now close/reset modal before the in-flight getById resolves
    controller.resetSession(null);

    resolveFirstGetById!({ item: SAVED_ARTICLE });
    const firstOutcome = await firstAttemptPromise;

    expect(firstOutcome.executed).toBe(false);
    expect(requestReviewCalls).toBe(0);
    expect(controller.getSnapshot().activeArticleId).toBeNull();
    expect(controller.getSnapshot().reviewStatus).toBeNull();
  });
});
