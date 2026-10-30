import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    public readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
      this.code = code;
    }
  },
}));

// Mock react-i18next for deterministic SSR rendering in both English and Arabic
const mockI18nState = { language: 'en' };
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return mockI18nState.language;
      },
      changeLanguage: vi.fn((lang: string) => {
        mockI18nState.language = lang;
      }),
    },
  }),
}));

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AdminRole,
  AdminPermission,
  AdminDomain,
  ROLE_DOMAINS_MAP,
  getPermissionsForRole,
  hasAdminPermission,
  hasDomainResponsibility,
  isTabAuthorized,
  type AdminUser,
} from '../../types/admin';
import {
  AdminLayout,
  CANONICAL_NAVIGATION_ITEMS,
  resolveAuthorizedTab,
  attemptTabNavigation,
} from './AdminLayout';
import {
  AdminNewsManagement,
  MAX_NEWS_TRANSITION_COMMENT_LENGTH,
  getServerRequiredNewsTransitionPermission,
  isNewsArticleTransitionAuthorized,
  getAuthorizedNewsArticleTransitions,
  canSelectNewsTransition,
  canConfirmNewsTransitionComment,
} from '../news/AdminNewsManagement';
import {
  EditorialImageRightsReviewPanel,
  createInitialAssetFormBundle,
  type EditorialImageRightsPanelSnapshot,
} from '../news/EditorialImageRightsReviewPanel';
import { ALLOWED_TRANSITIONS, WorkflowEngine } from '../../services/workflowEngine';
import { WorkflowState, WorkflowAction } from '../../types/workflow';
import type { NewsItem } from '../../types/news';
import { convertPlainTextToRichDocument } from '../../services/richNewsDocumentContract';
import { runAdminIdentityConvergenceTests } from '../../services/adminIdentityConvergenceTests';
import { executeManageNewsRequest } from '../../../functions/src/news/newsAdminHandlers';
import {
  NewsApplicationService,
  REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS,
} from '../../../functions/src/news/newsApplicationService';
import type {
  NewsRepository,
  NewsItemBackend,
} from '../../../functions/src/news/newsRepository';
import type { AdminRepository } from '../../../functions/src/admin/adminRepository';
import { InMemoryEditorialImageAssetRepository } from '../../../functions/src/news/inMemoryEditorialImageAssetRepository';
import {
  EditorialImageRightsReviewService,
  InMemoryEditorialImageRightsReviewRunner,
} from '../../../functions/src/news/editorialImageRightsReviewService';
import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
} from '../../../functions/src/shared/editorialImageAssetContract';
import type { EditorialImageAssetVariant } from '../../../functions/src/types/editorialImageAsset';
import type { FoundEditorialImageRightsAdminDto } from '../../services/newsAdminClient';

// ---------------------------------------------------------------------------
// Canonical Test Users Across All 9 Roles
// ---------------------------------------------------------------------------

function makeUser(
  role: AdminRole,
  overrides: Partial<AdminUser> = {}
): AdminUser {
  return {
    id: `uid-${role.toLowerCase()}`,
    name: `${role} Test User`,
    email: `${role.toLowerCase()}@promiseofplanet.sd`,
    role,
    isActive: true,
    ...overrides,
  };
}

const OWNER_USER = makeUser(AdminRole.Owner, { id: 'uid-owner-1', name: 'Abbass Abdelhalim' });
const CONTENT_EDITOR_USER = makeUser(AdminRole.ContentEditor, { id: 'uid-editor-1', name: 'Sarah Ahmed' });
const RIGHTS_REVIEWER_USER = makeUser(AdminRole.RightsReviewer, { id: 'uid-reviewer-1', name: 'Amna Al-Bashir' });
const LIBRARY_CURATOR_USER = makeUser(AdminRole.LibraryCurator);
const TRAINING_MANAGER_USER = makeUser(AdminRole.TrainingManager);
const TRAINER_USER = makeUser(AdminRole.Trainer);
const CITIZEN_MODERATOR_USER = makeUser(AdminRole.CitizenModerator);
const AI_ASSISTANT_USER = makeUser(AdminRole.AIAssistant);
const VIEWER_USER = makeUser(AdminRole.Viewer);
const INACTIVE_RIGHTS_REVIEWER_USER = makeUser(AdminRole.RightsReviewer, {
  id: 'uid-reviewer-inactive',
  isActive: false,
});
const INACTIVE_OWNER_USER = makeUser(AdminRole.Owner, {
  id: 'uid-owner-inactive',
  isActive: false,
});

function makeArticleFixture(
  workflowState: WorkflowState = WorkflowState.InReview,
  overrides: Partial<NewsItem> = {}
): NewsItem {
  return {
    id: 'news-persisted-101',
    titleAr: 'تقرير رصد التنوع الحيوي في ولاية البحر الأحمر',
    titleEn: 'Red Sea Biodiversity Observation Report',
    summaryAr: 'ملخص التقرير البيئي الميداني.',
    summaryEn: 'Summary of the field environmental report.',
    bodyAr: 'نص التقرير الكامل بالعربية.',
    bodyEn: 'Full article body in English.',
    richBodyAr: convertPlainTextToRichDocument('نص التقرير الكامل بالعربية.', 'rtl'),
    richBodyEn: convertPlainTextToRichDocument('Full article body in English.', 'ltr'),
    author: CONTENT_EDITOR_USER.name,
    category: 'Biodiversity',
    tags: ['Red Sea', 'Biodiversity'],
    sources: ['Marine Research Institute'],
    featuredImage: 'asset_featured_red_sea_01',
    workflowState,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-02T12:00:00.000Z',
    history: [],
    ...overrides,
  };
}

function buildCanonicalVariantsMap(assetId: string): Record<string, EditorialImageAssetVariant> {
  const variants: Record<string, EditorialImageAssetVariant> = {};
  for (const key of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
    variants[key] = {
      variantKey: key,
      storagePath: buildEditorialImageVariantStoragePath(assetId, key, 'image/webp'),
      mimeType: 'image/webp',
      width: 1200,
      height: 800,
      sizeBytes: 32768,
      sha256Checksum: 'a'.repeat(64),
    };
  }
  return variants;
}

function makeLoadedRightsSnapshot(
  assetId: string,
  canManageRights = true
): EditorialImageRightsPanelSnapshot {
  const dto: FoundEditorialImageRightsAdminDto = {
    assetId,
    found: true,
    revision: 1,
    status: 'active',
    createdByUid: CONTENT_EDITOR_USER.id,
    rights: {
      status: 'PendingReview',
    },
    altAr: 'شعاب مرجانية في البحر الأحمر',
    altEn: 'Coral reefs in the Red Sea',
    originalFilename: 'red-sea-coral.webp',
    mimeType: 'image/webp',
    originalWidth: 1600,
    originalHeight: 1200,
    aspectRatio: Number((1600 / 1200).toFixed(4)),
    asset: {
      assetId,
      createdByUid: CONTENT_EDITOR_USER.id,
      createdAtIso: '2026-03-01T09:00:00.000Z',
      updatedAtIso: '2026-03-01T09:00:00.000Z',
      origin: 'news_article',
      status: 'active',
      rights: {
        status: 'PendingReview',
      },
      originalFilename: 'red-sea-coral.webp',
      mimeType: 'image/webp',
      originalWidth: 1600,
      originalHeight: 1200,
      aspectRatio: Number((1600 / 1200).toFixed(4)),
      altAr: 'شعاب مرجانية في البحر الأحمر',
      altEn: 'Coral reefs in the Red Sea',
    },
  };

  const allAssets = [{ assetId, role: 'cover' as const }];

  return {
    discovery: {
      allAssets,
      batchAssets: allAssets,
      batchAssetIds: [assetId],
      excessAssetIds: [],
      hasExcessAssets: false,
      isCompleteArticleReviewClaimable: true,
    },
    canView: true,
    canManageRights,
    loading: false,
    loadError: null,
    assetsById: { [assetId]: dto },
    previewUrlsByAssetId: {},
    previewErrorsByAssetId: {},
    formsByAssetId: { [assetId]: createInitialAssetFormBundle(dto, 'news-persisted-101') },
    sessionEvidenceByAssetId: {},
    sessionReviewRequestsByAssetId: {},
    sessionAuditEventsByAssetId: {},
    generation: 1,
  };
}

describe('IMG-F3-09/D3-B2-B4-R1 — RightsReviewer News Access & Workflow UI Guard', () => {
  // -------------------------------------------------------------------------
  // 1. Canonical Role Domain & Permission Invariants
  // -------------------------------------------------------------------------
  it('1. grants AdminDomain.News to RightsReviewer while preserving exact permissions (View, Review, ManageRights only)', () => {
    expect(hasDomainResponsibility(AdminRole.RightsReviewer, AdminDomain.Overview)).toBe(true);
    expect(hasDomainResponsibility(AdminRole.RightsReviewer, AdminDomain.News)).toBe(true);
    expect(hasDomainResponsibility(AdminRole.RightsReviewer, AdminDomain.Media)).toBe(true);
    expect(Array.from(ROLE_DOMAINS_MAP[AdminRole.RightsReviewer]).sort()).toEqual(
      [AdminDomain.Overview, AdminDomain.News, AdminDomain.Media].sort()
    );

    const reviewerPerms = getPermissionsForRole(AdminRole.RightsReviewer);
    expect(Array.from(reviewerPerms).sort()).toEqual(
      [AdminPermission.View, AdminPermission.Review, AdminPermission.ManageRights].sort()
    );
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.View)).toBe(true);
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.Review)).toBe(true);
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.ManageRights)).toBe(true);

    // Explicitly forbidden permissions for RightsReviewer
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.Create)).toBe(false);
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.Edit)).toBe(false);
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.Approve)).toBe(false);
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.Publish)).toBe(false);
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.ManageUsers)).toBe(false);
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.ManageSettings)).toBe(false);
    expect(hasAdminPermission(RIGHTS_REVIEWER_USER, AdminPermission.ViewReports)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 2. Canonical Navigation Boundary & Exclusivity
  // -------------------------------------------------------------------------
  it('2. authorizes RightsReviewer for the canonical news navigation item without creating a duplicate item or expanding other roles', () => {
    const newsNavItems = CANONICAL_NAVIGATION_ITEMS.filter(
      (item) => item.id === 'news' || item.domain === AdminDomain.News
    );
    expect(newsNavItems).toHaveLength(1);
    expect(newsNavItems[0].id).toBe('news');
    expect(newsNavItems[0].domain).toBe(AdminDomain.News);
    expect(newsNavItems[0].requiredPermission).toBe(AdminPermission.View);

    const authorizedReviewerTabs = CANONICAL_NAVIGATION_ITEMS.filter((item) =>
      isTabAuthorized(RIGHTS_REVIEWER_USER, item.domain, item.requiredPermission)
    ).map((item) => item.id);
    expect(authorizedReviewerTabs).toEqual(['overview', 'news', 'media']);

    expect(attemptTabNavigation(RIGHTS_REVIEWER_USER, 'news')).toEqual({
      success: true,
      targetTabId: 'news',
    });
    expect(resolveAuthorizedTab(RIGHTS_REVIEWER_USER, 'news')).toBe('news');

    // Unauthorized tabs for RightsReviewer fall back via canonical resolveAuthorizedTab
    expect(attemptTabNavigation(RIGHTS_REVIEWER_USER, 'library')).toEqual({
      success: false,
      targetTabId: null,
    });
    expect(attemptTabNavigation(RIGHTS_REVIEWER_USER, 'users')).toEqual({
      success: false,
      targetTabId: null,
    });
    expect(resolveAuthorizedTab(RIGHTS_REVIEWER_USER, 'users')).toBe('overview');
  });

  it('3. ensures only Owner, ContentEditor, and RightsReviewer can access News navigation; Viewer and unrelated roles remain blocked', () => {
    const allRoleUsers: AdminUser[] = [
      OWNER_USER,
      CONTENT_EDITOR_USER,
      RIGHTS_REVIEWER_USER,
      LIBRARY_CURATOR_USER,
      TRAINING_MANAGER_USER,
      TRAINER_USER,
      CITIZEN_MODERATOR_USER,
      AI_ASSISTANT_USER,
      VIEWER_USER,
    ];

    const rolesWithNewsAccess = allRoleUsers
      .filter((u) => attemptTabNavigation(u, 'news').success)
      .map((u) => u.role);

    expect(rolesWithNewsAccess).toEqual([
      AdminRole.Owner,
      AdminRole.ContentEditor,
      AdminRole.RightsReviewer,
    ]);

    for (const unrelated of [
      LIBRARY_CURATOR_USER,
      TRAINING_MANAGER_USER,
      TRAINER_USER,
      CITIZEN_MODERATOR_USER,
      AI_ASSISTANT_USER,
      VIEWER_USER,
    ]) {
      expect(hasDomainResponsibility(unrelated.role, AdminDomain.News)).toBe(false);
      expect(isTabAuthorized(unrelated, AdminDomain.News, AdminPermission.View)).toBe(false);
      expect(attemptTabNavigation(unrelated, 'news')).toEqual({
        success: false,
        targetTabId: null,
      });
      expect(resolveAuthorizedTab(unrelated, 'news')).not.toBe('news');
    }
  });

  it('4. blocks inactive users and null/undefined users across isTabAuthorized, attemptTabNavigation, and resolveAuthorizedTab', () => {
    for (const blockedUser of [INACTIVE_RIGHTS_REVIEWER_USER, INACTIVE_OWNER_USER, null, undefined]) {
      expect(isTabAuthorized(blockedUser, AdminDomain.News, AdminPermission.View)).toBe(false);
      expect(attemptTabNavigation(blockedUser, 'news')).toEqual({
        success: false,
        targetTabId: null,
      });
      expect(resolveAuthorizedTab(blockedUser, 'news')).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // 3. Combined Article Workflow Transition Authorization (Client/Server Alignment)
  // -------------------------------------------------------------------------
  it('5. prevents RightsReviewer from executing InReview -> ChangesRequested or any other article workflow transition', () => {
    // Verify WorkflowEngine itself remains unchanged (still lists RequestChanges under Review permission)
    const rawEngineTransitionsForReviewer = WorkflowEngine.getAuthorizedTransitions(
      WorkflowState.InReview,
      RIGHTS_REVIEWER_USER
    );
    expect(rawEngineTransitionsForReviewer.map((t) => t.action)).toEqual([
      WorkflowAction.RequestChanges,
    ]);

    // Verify server-equivalent permission helper matches newsAdminHandlers.ts
    expect(getServerRequiredNewsTransitionPermission(WorkflowState.InReview)).toBe(
      AdminPermission.Edit
    );
    expect(getServerRequiredNewsTransitionPermission(WorkflowState.ChangesRequested)).toBe(
      AdminPermission.Edit
    );
    expect(getServerRequiredNewsTransitionPermission(WorkflowState.Draft)).toBe(
      AdminPermission.Edit
    );
    expect(getServerRequiredNewsTransitionPermission(WorkflowState.Approved)).toBe(
      AdminPermission.Approve
    );
    expect(getServerRequiredNewsTransitionPermission(WorkflowState.Published)).toBe(
      AdminPermission.Publish
    );

    // Combined Newsroom transition check denies RightsReviewer across ALL states & targets
    const allStates = Object.values(WorkflowState);
    for (const fromState of allStates) {
      expect(getAuthorizedNewsArticleTransitions(fromState, RIGHTS_REVIEWER_USER)).toEqual([]);
      for (const toState of allStates) {
        expect(isNewsArticleTransitionAuthorized(fromState, toState, RIGHTS_REVIEWER_USER)).toBe(
          false
        );
      }
    }

    const requestChangesConfig = ALLOWED_TRANSITIONS.find(
      (t) => t.action === WorkflowAction.RequestChanges
    )!;
    expect(
      canSelectNewsTransition(WorkflowState.InReview, requestChangesConfig, RIGHTS_REVIEWER_USER)
    ).toBe(false);
    expect(
      canConfirmNewsTransitionComment(
        WorkflowState.InReview,
        requestChangesConfig,
        'Rights issue found, requesting changes',
        RIGHTS_REVIEWER_USER
      )
    ).toBe(false);
  });

  it('6. preserves ContentEditor and Owner article workflow transitions according to server rules', () => {
    const requestChangesConfig = ALLOWED_TRANSITIONS.find(
      (t) => t.action === WorkflowAction.RequestChanges
    )!;

    // ContentEditor (has View, Create, Edit, Review; lacks Approve, Publish)
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.Draft, CONTENT_EDITOR_USER).map(
        (t) => t.toState
      )
    ).toEqual([WorkflowState.InReview]);
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.InReview, CONTENT_EDITOR_USER).map(
        (t) => t.toState
      )
    ).toEqual([WorkflowState.ChangesRequested]);
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.ChangesRequested, CONTENT_EDITOR_USER).map(
        (t) => t.toState
      )
    ).toEqual([WorkflowState.Draft]);
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.Approved, CONTENT_EDITOR_USER)
    ).toEqual([]);

    expect(
      canSelectNewsTransition(WorkflowState.InReview, requestChangesConfig, CONTENT_EDITOR_USER)
    ).toBe(true);
    expect(
      canConfirmNewsTransitionComment(
        WorkflowState.InReview,
        requestChangesConfig,
        'Please update paragraph 2 citations',
        CONTENT_EDITOR_USER
      )
    ).toBe(true);
    expect(
      canConfirmNewsTransitionComment(
        WorkflowState.InReview,
        requestChangesConfig,
        '   ',
        CONTENT_EDITOR_USER
      )
    ).toBe(false);

    // Owner (has all permissions)
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.Draft, OWNER_USER).map((t) => t.toState)
    ).toEqual([WorkflowState.InReview]);
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.InReview, OWNER_USER).map((t) => t.toState)
    ).toEqual([WorkflowState.ChangesRequested, WorkflowState.Approved]);
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.ChangesRequested, OWNER_USER).map(
        (t) => t.toState
      )
    ).toEqual([WorkflowState.Draft]);
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.Approved, OWNER_USER).map((t) => t.toState)
    ).toEqual([WorkflowState.Published]);
  });

  // -------------------------------------------------------------------------
  // 4. UI Rendering & Read-Only Newsroom Isolation for RightsReviewer
  // -------------------------------------------------------------------------
  it('7. renders AdminLayout with Environmental News navigation item for RightsReviewer and reaches EditorialImageRightsReviewPanel in workflow tab', () => {
    const layoutHtml = renderToStaticMarkup(
      createElement(AdminLayout, {
        currentUser: RIGHTS_REVIEWER_USER,
        onExitAdmin: () => {},
      })
    );
    expect(layoutHtml).toContain('Overview Dashboard');
    expect(layoutHtml).toContain('Environmental News');
    expect(layoutHtml).toContain('Media &amp; Videos');
    expect(layoutHtml).not.toContain('Knowledge Library');
    expect(layoutHtml).not.toContain('Users &amp; Permissions');

    // List view in AdminNewsManagement for RightsReviewer: no "New News Article" button
    const listHtml = renderToStaticMarkup(
      createElement(AdminNewsManagement, {
        currentUser: RIGHTS_REVIEWER_USER,
      })
    );
    expect(listHtml).toContain('Environmental Newsroom Management');
    expect(listHtml).not.toContain('New News Article');

    // Attempt to force initialIsCreating=true for RightsReviewer is blocked by canCreate guard
    const forcedCreateHtml = renderToStaticMarkup(
      createElement(AdminNewsManagement, {
        currentUser: RIGHTS_REVIEWER_USER,
        initialIsCreating: true,
      })
    );
    expect(forcedCreateHtml).not.toContain('Create New News Article');
    expect(forcedCreateHtml).not.toContain('data-testid="news-save-changes-btn"');

    // Opening an existing Draft article in content tab for RightsReviewer: read-only, no Save Changes button
    const draftArticle = makeArticleFixture(WorkflowState.Draft);
    const contentTabHtml = renderToStaticMarkup(
      createElement(AdminNewsManagement, {
        currentUser: RIGHTS_REVIEWER_USER,
        initialActiveItem: draftArticle,
        initialActiveTab: 'content',
      })
    );
    expect(contentTabHtml).toContain('Red Sea Biodiversity Observation Report');
    expect(contentTabHtml).not.toContain('data-testid="news-save-changes-btn"');
    expect(contentTabHtml).toContain('data-testid="news-open-image-rights-panel-btn"');

    // Opening an InReview article in workflow tab for RightsReviewer:
    // - Reaches existing EditorialImageRightsReviewPanel
    // - Both Request Changes and Approve Content buttons are disabled
    // - Even if initialPendingTransition is passed, the comment confirmation drawer is NOT rendered
    const inReviewArticle = makeArticleFixture(WorkflowState.InReview);
    const requestChangesConfig = ALLOWED_TRANSITIONS.find(
      (t) => t.action === WorkflowAction.RequestChanges
    )!;
    const workflowTabHtml = renderToStaticMarkup(
      createElement(AdminNewsManagement, {
        currentUser: RIGHTS_REVIEWER_USER,
        initialActiveItem: inReviewArticle,
        initialActiveTab: 'workflow',
        initialPendingTransition: requestChangesConfig,
      })
    );

    expect(workflowTabHtml).toContain('data-testid="editorial-image-rights-review-panel"');
    expect(workflowTabHtml).toContain('data-testid="rights-asset-card-asset_featured_red_sea_01"');

    expect(workflowTabHtml).not.toContain('data-testid="news-workflow-comment-drawer"');
    expect(workflowTabHtml).not.toContain('data-testid="news-workflow-confirm-comment-btn"');

    expect(workflowTabHtml).toMatch(
      /<button[^>]*data-testid="news-workflow-transition-btn-ChangesRequested"[^>]*disabled=""/
    );
    expect(workflowTabHtml).toMatch(
      /<button[^>]*data-testid="news-workflow-transition-btn-Approved"[^>]*disabled=""/
    );

    // Verify EditorialImageRightsReviewPanel with loaded asset snapshot renders full ManageRights action controls for RightsReviewer
    const loadedSnapshot = makeLoadedRightsSnapshot('asset_featured_red_sea_01', true);
    const reviewerPanelHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: RIGHTS_REVIEWER_USER,
        articleId: inReviewArticle.id,
        featuredImage: inReviewArticle.featuredImage,
        isAr: false,
        initialSnapshot: loadedSnapshot,
      })
    );
    expect(reviewerPanelHtml).toContain(
      'data-testid="rights-open-register-evidence-asset_featured_red_sea_01"'
    );
    expect(reviewerPanelHtml).toContain(
      'data-testid="rights-open-approve-asset_featured_red_sea_01"'
    );
    expect(reviewerPanelHtml).toContain('Rights Management Authorized (RightsReviewer)');
  });

  it('8. renders enabled Request Changes transition and comment confirmation drawer for ContentEditor and Owner on InReview article', () => {
    const inReviewArticle = makeArticleFixture(WorkflowState.InReview);
    const requestChangesConfig = ALLOWED_TRANSITIONS.find(
      (t) => t.action === WorkflowAction.RequestChanges
    )!;

    const editorWorkflowHtml = renderToStaticMarkup(
      createElement(AdminNewsManagement, {
        currentUser: CONTENT_EDITOR_USER,
        initialActiveItem: inReviewArticle,
        initialActiveTab: 'workflow',
        initialPendingTransition: requestChangesConfig,
      })
    );

    expect(editorWorkflowHtml).toContain('data-testid="news-workflow-transition-btn-ChangesRequested"');
    expect(editorWorkflowHtml).not.toMatch(
      /<button[^>]*data-testid="news-workflow-transition-btn-ChangesRequested"[^>]*disabled=""/
    );
    expect(editorWorkflowHtml).toMatch(
      /<button[^>]*data-testid="news-workflow-transition-btn-Approved"[^>]*disabled=""/
    );
    expect(editorWorkflowHtml).toContain('data-testid="news-workflow-comment-drawer"');
    expect(editorWorkflowHtml).toContain('data-testid="news-workflow-confirm-comment-btn"');

    // ContentEditor sees read-only inspection inside EditorialImageRightsReviewPanel (no ManageRights)
    const loadedSnapshot = makeLoadedRightsSnapshot('asset_featured_red_sea_01', false);
    const editorPanelHtml = renderToStaticMarkup(
      createElement(EditorialImageRightsReviewPanel, {
        currentUser: CONTENT_EDITOR_USER,
        articleId: inReviewArticle.id,
        featuredImage: inReviewArticle.featuredImage,
        isAr: false,
        initialSnapshot: loadedSnapshot,
      })
    );
    expect(editorPanelHtml).toContain('Read-Only Inspection (ContentEditor)');
    expect(editorPanelHtml).not.toContain(
      'data-testid="rights-open-approve-asset_featured_red_sea_01"'
    );
  });

  // -------------------------------------------------------------------------
  // 5. Handler-Level Guards & Server Authority Verification
  // -------------------------------------------------------------------------
  it('9. enforces handler-level guards in AdminNewsManagement.tsx, blocks server news mutations by RightsReviewer, and preserves ManageRights authority', async () => {
    const adminNewsSource = readFileSync(
      resolve(process.cwd(), 'src/components/news/AdminNewsManagement.tsx'),
      'utf8'
    );

    // Verify handler-level guards in source
    expect(adminNewsSource).toContain('const handleStartCreate = () => {\n    if (!canCreate) {\n      return;\n    }');
    expect(adminNewsSource).toContain('const handleSaveForm = async () => {\n    if (!canSaveContent || imageSessionRef.current.isSaving()) {\n      return;\n    }');
    expect(adminNewsSource).toContain('if (!canSelectNewsTransition(activeItem.workflowState, config, currentUser)) {\n      setPendingTransition(null);\n      setTransitionComment(\'\');\n      return;\n    }');

    // Verify server-side manageNews handler continues to reject RightsReviewer on saveDraft and transitionWorkflow
    const items = new Map<string, NewsItemBackend>();
    const seededInReview: NewsItemBackend = {
      id: 'news-101',
      titleAr: 'خبر قيد المراجعة',
      titleEn: 'In Review News',
      summaryAr: 'ملخص',
      summaryEn: 'Summary',
      bodyAr: 'محتوى الخبر',
      bodyEn: 'Article body',
      author: CONTENT_EDITOR_USER.name,
      category: 'Water',
      tags: [],
      sources: [],
      workflowState: 'InReview',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      history: [],
    };
    items.set(seededInReview.id, seededInReview);

    const mockNewsRepo: NewsRepository = {
      getById: async (id) => items.get(id) ?? null,
      save: async (item) => {
        items.set(item.id, item);
      },
      listAll: async () => Array.from(items.values()),
      listPublished: async () =>
        Array.from(items.values()).filter((i) => i.workflowState === 'Published'),
      delete: async (id) => {
        items.delete(id);
      },
    };

    const adminsById = new Map<string, AdminUser>([
      [RIGHTS_REVIEWER_USER.id, RIGHTS_REVIEWER_USER],
      [CONTENT_EDITOR_USER.id, CONTENT_EDITOR_USER],
      [OWNER_USER.id, OWNER_USER],
    ]);

    const mockAdminRepo: AdminRepository = {
      getAdminByUid: async (uid) => adminsById.get(uid) ?? null,
      listAdmins: async () => Array.from(adminsById.values()),
      saveAdmin: async (admin) => {
        adminsById.set(admin.id, admin);
      },
      deactivateAdmin: async (uid) => {
        const u = adminsById.get(uid);
        if (u) adminsById.set(uid, { ...u, isActive: false });
      },
      verifyAdminAccess: async (uid) => {
        const u = adminsById.get(uid);
        return Boolean(u && u.isActive);
      },
    };

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const assetId = 'asset_featured_red_sea_01';
    const createdAsset = createEditorialImageAssetRecord({
      assetId,
      createdByUid: CONTENT_EDITOR_USER.id,
      createdAtIso: '2026-03-01T09:00:00.000Z',
      updatedAtIso: '2026-03-01T09:00:00.000Z',
      origin: 'news_article',
      originalFilename: 'red-sea-coral.webp',
      mimeType: 'image/webp',
      originalWidth: 1600,
      originalHeight: 1200,
      originalSizeBytes: 120000,
      sha256Checksum: 'a'.repeat(64),
      altAr: 'شعاب مرجانية في البحر الأحمر',
      altEn: 'Coral reefs in the Red Sea',
      variants: buildCanonicalVariantsMap(assetId),
    });
    await assetRepo.createIfAbsent(createdAsset);

    const runner = new InMemoryEditorialImageRightsReviewRunner(undefined, mockAdminRepo);
    await runner.seedInitialPendingAsset(createdAsset);

    const rightsReviewService = new EditorialImageRightsReviewService({
      adminRepository: mockAdminRepo,
      transactionRunner: runner,
      clock: () => '2026-03-03T10:00:00.000Z',
    });
    const newsService = new NewsApplicationService(mockNewsRepo, assetRepo);

    // RightsReviewer CAN listAll and getById (AdminPermission.View)
    const listRes = await executeManageNewsRequest(
      { auth: { uid: RIGHTS_REVIEWER_USER.id }, data: { action: 'listAll' } },
      mockAdminRepo,
      newsService,
      rightsReviewService,
      assetRepo
    );
    expect(listRes.items).toHaveLength(1);

    // RightsReviewer CANNOT create draft (requires Create)
    await expect(
      executeManageNewsRequest(
        {
          auth: { uid: RIGHTS_REVIEWER_USER.id },
          data: {
            action: 'saveDraft',
            item: {
              titleAr: 'محاولة إنشاء',
              summaryAr: 'ملخص',
              bodyAr: 'نص',
              category: 'Water',
            },
          },
        },
        mockAdminRepo,
        newsService,
        rightsReviewService,
        assetRepo
      )
    ).rejects.toThrow(/PERMISSION_DENIED: AdminUser lacks required create permission/);

    // RightsReviewer CANNOT update draft (requires Edit)
    await expect(
      executeManageNewsRequest(
        {
          auth: { uid: RIGHTS_REVIEWER_USER.id },
          data: {
            action: 'saveDraft',
            item: {
              id: 'news-101',
              titleAr: 'محاولة تعديل',
              summaryAr: 'ملخص',
              bodyAr: 'نص',
              category: 'Water',
            },
          },
        },
        mockAdminRepo,
        newsService,
        rightsReviewService,
        assetRepo
      )
    ).rejects.toThrow(/PERMISSION_DENIED: AdminUser lacks required edit permission/);

    // RightsReviewer CANNOT transition workflow to ChangesRequested, Approved, Published, Draft, or InReview
    for (const targetState of ['ChangesRequested', 'Approved', 'Published', 'Draft', 'InReview']) {
      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: RIGHTS_REVIEWER_USER.id },
            data: {
              action: 'transitionWorkflow',
              id: 'news-101',
              targetState,
              comment: 'Attempted by RightsReviewer',
            },
          },
          mockAdminRepo,
          newsService,
          rightsReviewService,
          assetRepo
        )
      ).rejects.toThrow(/PERMISSION_DENIED: AdminUser lacks required/);
    }
    expect(items.get('news-101')?.workflowState).toBe('InReview');

    // RightsReviewer CAN read image rights, register evidence, and approve image rights via ManageRights
    const getRightsRes = await executeManageNewsRequest(
      {
        auth: { uid: RIGHTS_REVIEWER_USER.id },
        data: { action: 'getEditorialImageRights', assetIds: [assetId] },
      },
      mockAdminRepo,
      newsService,
      rightsReviewService,
      assetRepo
    );
    expect(getRightsRes.assetsById[assetId].found).toBe(true);
    expect(getRightsRes.assetsById[assetId].rights.status).toBe('PendingReview');

    const regEvidenceRes = await executeManageNewsRequest(
      {
        auth: { uid: RIGHTS_REVIEWER_USER.id },
        data: {
          action: 'registerImageRightsEvidence',
          input: {
            evidenceId: 'ev_red_sea_release_01',
            assetId,
            sourceKind: 'PhotographerWrittenRelease',
            sourceReference: 'REL-2026-REDSEA-01',
            summary: 'Signed written release from field marine photographer.',
          },
        },
      },
      mockAdminRepo,
      newsService,
      rightsReviewService,
      assetRepo
    );
    expect(regEvidenceRes.evidence.evidenceId).toBe('ev_red_sea_release_01');
    expect(regEvidenceRes.evidence.status).toBe('Active');

    const approveRightsRes = await executeManageNewsRequest(
      {
        auth: { uid: RIGHTS_REVIEWER_USER.id },
        data: {
          action: 'transitionImageRights',
          decision: {
            assetId,
            expectedRevision: 1,
            targetStatus: 'Approved',
            reviewReason: 'Verified written photographer release for Red Sea biodiversity report.',
            licenseType: 'DirectLicense',
            licenseDetails: 'Signed written release #REL-2026-REDSEA-01 from Marine Research Institute',
            rightsHolder: 'Marine Research Institute',
            sourceAttributionAr: 'معهد أبحاث البحار',
            sourceAttributionEn: 'Marine Research Institute',
            evidenceRefs: ['ev_red_sea_release_01'],
            usageScope: {
              scopeType: 'ArticleRestricted',
              articleIds: ['news-101'],
            },
          },
        },
      },
      mockAdminRepo,
      newsService,
      rightsReviewService,
      assetRepo
    );
    expect(approveRightsRes.record.asset.rights.status).toBe('Approved');
    expect(approveRightsRes.auditEvent.actorUserId).toBe(RIGHTS_REVIEWER_USER.id);
    expect(approveRightsRes.auditEvent.actorRole).toBe(AdminRole.RightsReviewer);
  });

  // -------------------------------------------------------------------------
  // 6. Existing Admin Identity & Navigation Convergence Suite Regression Check
  // -------------------------------------------------------------------------
  it('10. passes all assertions in runAdminIdentityConvergenceTests', async () => {
    const convergence = await runAdminIdentityConvergenceTests();
    expect(convergence.failedCount).toBe(0);
    expect(convergence.passedCount).toBeGreaterThanOrEqual(60);
  });

  // -------------------------------------------------------------------------
  // 7. NEWS-REVISION-01 — Owner-Only Published Withdrawal & Redraft
  // -------------------------------------------------------------------------
  it('11. authorizes Published -> Draft withdrawal exclusively for active Owner across WorkflowEngine and AdminNewsManagement helpers', () => {
    const withdrawConfig = ALLOWED_TRANSITIONS.find(
      (t) => t.action === WorkflowAction.WithdrawForRevision
    )!;
    expect(withdrawConfig).toBeDefined();
    expect(withdrawConfig.fromState).toBe(WorkflowState.Published);
    expect(withdrawConfig.toState).toBe(WorkflowState.Draft);
    expect(withdrawConfig.requiresComment).toBe(true);
    expect(withdrawConfig.labelAr).toBe('سحب من النشر وإعادة إلى المسودة');
    expect(withdrawConfig.labelEn).toBe('Withdraw Publication and Return to Draft');

    // Active Owner is authorized for Published -> Draft
    expect(
      WorkflowEngine.getAuthorizedTransitions(WorkflowState.Published, OWNER_USER).map(
        (t) => t.action
      )
    ).toEqual([WorkflowAction.WithdrawForRevision]);
    expect(
      isNewsArticleTransitionAuthorized(WorkflowState.Published, WorkflowState.Draft, OWNER_USER)
    ).toBe(true);
    expect(
      getAuthorizedNewsArticleTransitions(WorkflowState.Published, OWNER_USER).map(
        (t) => t.action
      )
    ).toEqual([WorkflowAction.WithdrawForRevision]);
    expect(canSelectNewsTransition(WorkflowState.Published, withdrawConfig, OWNER_USER)).toBe(true);

    // Inactive Owner and all non-Owner roles are denied Published -> Draft
    for (const nonAuthorized of [
      INACTIVE_OWNER_USER,
      CONTENT_EDITOR_USER,
      RIGHTS_REVIEWER_USER,
      LIBRARY_CURATOR_USER,
      TRAINING_MANAGER_USER,
      TRAINER_USER,
      CITIZEN_MODERATOR_USER,
      AI_ASSISTANT_USER,
      VIEWER_USER,
    ]) {
      expect(
        WorkflowEngine.getAuthorizedTransitions(WorkflowState.Published, nonAuthorized)
      ).toEqual([]);
      expect(
        WorkflowEngine.canExecuteTransition(
          WorkflowState.Published,
          WorkflowState.Draft,
          nonAuthorized
        ).allowed
      ).toBe(false);
      expect(
        isNewsArticleTransitionAuthorized(
          WorkflowState.Published,
          WorkflowState.Draft,
          nonAuthorized
        )
      ).toBe(false);
      expect(
        getAuthorizedNewsArticleTransitions(WorkflowState.Published, nonAuthorized)
      ).toEqual([]);
      expect(
        canSelectNewsTransition(WorkflowState.Published, withdrawConfig, nonAuthorized)
      ).toBe(false);
      expect(
        canConfirmNewsTransitionComment(
          WorkflowState.Published,
          withdrawConfig,
          'Valid reason text',
          nonAuthorized
        )
      ).toBe(false);
    }

    // Comment confirmation requires non-empty trimmed reason <= 2000 chars for active Owner
    expect(
      canConfirmNewsTransitionComment(WorkflowState.Published, withdrawConfig, '', OWNER_USER)
    ).toBe(false);
    expect(
      canConfirmNewsTransitionComment(WorkflowState.Published, withdrawConfig, '   \n\t ', OWNER_USER)
    ).toBe(false);
    expect(
      canConfirmNewsTransitionComment(
        WorkflowState.Published,
        withdrawConfig,
        'x'.repeat(MAX_NEWS_TRANSITION_COMMENT_LENGTH + 1),
        OWNER_USER
      )
    ).toBe(false);
    expect(
      canConfirmNewsTransitionComment(
        WorkflowState.Published,
        withdrawConfig,
        'x'.repeat(MAX_NEWS_TRANSITION_COMMENT_LENGTH),
        OWNER_USER
      )
    ).toBe(true);
    expect(
      canConfirmNewsTransitionComment(
        WorkflowState.Published,
        withdrawConfig,
        'سحب المقال لتحديث البيانات الإحصائية',
        OWNER_USER
      )
    ).toBe(true);
  });

  it('12. enforces server-verified active Owner authorization and mandatory reason in executeManageNewsRequest before invoking transitionWorkflow', async () => {
    const usersById: Record<string, AdminUser> = {
      [OWNER_USER.id]: OWNER_USER,
      [INACTIVE_OWNER_USER.id]: INACTIVE_OWNER_USER,
      [CONTENT_EDITOR_USER.id]: CONTENT_EDITOR_USER,
      [RIGHTS_REVIEWER_USER.id]: RIGHTS_REVIEWER_USER,
      [LIBRARY_CURATOR_USER.id]: LIBRARY_CURATOR_USER,
      [TRAINING_MANAGER_USER.id]: TRAINING_MANAGER_USER,
      [TRAINER_USER.id]: TRAINER_USER,
      [CITIZEN_MODERATOR_USER.id]: CITIZEN_MODERATOR_USER,
      [AI_ASSISTANT_USER.id]: AI_ASSISTANT_USER,
      [VIEWER_USER.id]: VIEWER_USER,
    };

    const mockAdminRepo: AdminRepository = {
      async getAdminByUid(uid: string) {
        return usersById[uid] ?? null;
      },
      async getAdminByEmail() {
        return null;
      },
      async listAllAdmins() {
        return Object.values(usersById);
      },
      async saveAdmin() {},
    };

    const items = new Map<string, NewsItemBackend>();
    items.set('news-pub-201', {
      id: 'news-pub-201',
      titleAr: 'خبر منشور حول الطاقة الشمسية في الولاية الشمالية',
      titleEn: 'Published News on Solar Energy in Northern State',
      summaryAr: 'ملخص الخبر المنشور.',
      summaryEn: 'Summary of the published news.',
      bodyAr: 'النص الكامل للخبر المنشور.',
      bodyEn: 'Full body of the published news.',
      author: CONTENT_EDITOR_USER.name,
      category: 'Climate',
      tags: ['Solar'],
      sources: ['Ministry of Energy'],
      workflowState: 'Published',
      createdAt: '2026-03-10T08:00:00.000Z',
      updatedAt: '2026-03-10T10:00:00.000Z',
      publishedAt: '2026-03-10T10:00:00.000Z',
      history: [
        {
          id: 'tr-pub-1',
          fromState: 'Approved',
          toState: 'Published',
          action: 'publish',
          actorName: OWNER_USER.name,
          actorRole: AdminRole.Owner,
          timestamp: '2026-03-10T10:00:00.000Z',
        },
      ],
    });

    const mockNewsRepo: NewsRepository = {
      async getById(id: string) {
        const found = items.get(id);
        return found ? JSON.parse(JSON.stringify(found)) : null;
      },
      async save(item: NewsItemBackend) {
        items.set(item.id, JSON.parse(JSON.stringify(item)));
      },
      async listAll() {
        return Array.from(items.values());
      },
      async listPublished() {
        return Array.from(items.values()).filter((i) => i.workflowState === 'Published');
      },
      async delete(id: string) {
        items.delete(id);
      },
    };

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const newsService = new NewsApplicationService(mockNewsRepo, assetRepo);
    const transitionSpy = vi.spyOn(newsService, 'transitionWorkflow');
    const saveSpy = vi.spyOn(mockNewsRepo, 'save');

    // Inactive Owner is rejected before invoking transitionWorkflow
    await expect(
      executeManageNewsRequest(
        {
          auth: { uid: INACTIVE_OWNER_USER.id },
          data: {
            action: 'transitionWorkflow',
            id: 'news-pub-201',
            targetState: 'Draft',
            comment: 'محاولة سحب من حساب مالك غير نشط',
          },
        },
        mockAdminRepo,
        newsService
      )
    ).rejects.toThrow(/ADMIN_INACTIVE/);

    // Every non-Owner role (even if client supplies fake role='Owner' in data/token) is rejected before invoking transitionWorkflow
    for (const nonOwner of [
      CONTENT_EDITOR_USER,
      RIGHTS_REVIEWER_USER,
      LIBRARY_CURATOR_USER,
      TRAINING_MANAGER_USER,
      TRAINER_USER,
      CITIZEN_MODERATOR_USER,
      AI_ASSISTANT_USER,
      VIEWER_USER,
    ]) {
      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: nonOwner.id, token: { role: 'Owner' } },
            data: {
              action: 'transitionWorkflow',
              id: 'news-pub-201',
              targetState: 'Draft',
              comment: 'Attempted withdrawal by non-Owner',
              role: 'Owner',
            },
          },
          mockAdminRepo,
          newsService
        )
      ).rejects.toThrow(/PERMISSION_DENIED: Only an active Owner may withdraw a published article to Draft/);
    }

    expect(transitionSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(items.get('news-pub-201')?.workflowState).toBe('Published');

    // Active Owner with missing/whitespace/oversized reason is rejected without write
    for (const badReason of ['', '   ', 'x'.repeat(MAX_NEWS_TRANSITION_COMMENT_LENGTH + 1)]) {
      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: OWNER_USER.id },
            data: {
              action: 'transitionWorkflow',
              id: 'news-pub-201',
              targetState: 'Draft',
              comment: badReason,
            },
          },
          mockAdminRepo,
          newsService
        )
      ).rejects.toThrow(/VALIDATION_ERROR/);
    }
    expect(saveSpy).not.toHaveBeenCalled();

    // Active Owner with valid written reason succeeds
    const withdrawRes = await executeManageNewsRequest(
      {
        auth: { uid: OWNER_USER.id },
        data: {
          action: 'transitionWorkflow',
          id: 'news-pub-201',
          targetState: 'Draft',
          comment: 'سحب رسمي لتصحيح بيانات قدرات التوليد الشمسي قبل إعادة المراجعة',
        },
      },
      mockAdminRepo,
      newsService
    );
    expect(withdrawRes.item.workflowState).toBe('Draft');
    expect(withdrawRes.item.history).toHaveLength(2);
    expect(withdrawRes.item.history[1].action).toBe('withdraw_for_revision');
    expect(withdrawRes.item.history[1].actorRole).toBe(AdminRole.Owner);
    expect(withdrawRes.item.history[1].comment).toBe(
      'سحب رسمي لتصحيح بيانات قدرات التوليد الشمسي قبل إعادة المراجعة'
    );
  });

  it('13. renders bilingual Owner-only withdrawal action and confirmation UI on Published articles while hiding it for non-Owners and non-Published states', () => {
    const publishedArticle = makeArticleFixture(WorkflowState.Published);
    const withdrawConfig = ALLOWED_TRANSITIONS.find(
      (t) => t.action === WorkflowAction.WithdrawForRevision
    )!;

    try {
      // 1. English SSR for active Owner on Published article (with confirmation drawer open)
      mockI18nState.language = 'en';
      const ownerPublishedEnHtml = renderToStaticMarkup(
        createElement(AdminNewsManagement, {
          currentUser: OWNER_USER,
          initialActiveItem: publishedArticle,
          initialActiveTab: 'workflow',
          initialPendingTransition: withdrawConfig,
        })
      );
      expect(ownerPublishedEnHtml).toContain('data-testid="news-workflow-transition-btn-Draft"');
      expect(ownerPublishedEnHtml).toContain('Withdraw Publication and Return to Draft');
      expect(ownerPublishedEnHtml).toContain('data-testid="news-workflow-comment-drawer"');
      expect(ownerPublishedEnHtml).toContain('data-testid="news-withdrawal-public-warning"');
      expect(ownerPublishedEnHtml).toContain(
        'Important Warning: This action will immediately withdraw the article from public news and return it to Draft state for revision.'
      );
      expect(ownerPublishedEnHtml).toContain('data-testid="news-workflow-comment-input"');
      expect(ownerPublishedEnHtml).toContain('data-testid="news-workflow-cancel-comment-btn"');
      expect(ownerPublishedEnHtml).toContain('Confirm Withdrawal to Draft');
      expect(ownerPublishedEnHtml).toMatch(
        /<button[^>]*data-testid="news-workflow-confirm-comment-btn"[^>]*disabled=""/
      );

      // Content tab while Published does NOT enable Save Changes even for Owner
      const ownerPublishedContentHtml = renderToStaticMarkup(
        createElement(AdminNewsManagement, {
          currentUser: OWNER_USER,
          initialActiveItem: publishedArticle,
          initialActiveTab: 'content',
        })
      );
      expect(ownerPublishedContentHtml).not.toContain('data-testid="news-save-changes-btn"');

      // Once returned to Draft, Content tab enables Save Changes for Owner
      const ownerDraftContentHtml = renderToStaticMarkup(
        createElement(AdminNewsManagement, {
          currentUser: OWNER_USER,
          initialActiveItem: makeArticleFixture(WorkflowState.Draft),
          initialActiveTab: 'content',
        })
      );
      expect(ownerDraftContentHtml).toContain('data-testid="news-save-changes-btn"');

      // 2. Arabic SSR for active Owner on Published article (with confirmation drawer open)
      mockI18nState.language = 'ar';
      const ownerPublishedArHtml = renderToStaticMarkup(
        createElement(AdminNewsManagement, {
          currentUser: OWNER_USER,
          initialActiveItem: publishedArticle,
          initialActiveTab: 'workflow',
          initialPendingTransition: withdrawConfig,
        })
      );
      expect(ownerPublishedArHtml).toContain('data-testid="news-workflow-transition-btn-Draft"');
      expect(ownerPublishedArHtml).toContain('سحب من النشر وإعادة إلى المسودة');
      expect(ownerPublishedArHtml).toContain('data-testid="news-withdrawal-public-warning"');
      expect(ownerPublishedArHtml).toContain(
        'تحذير هام: سيؤدي هذا الإجراء إلى سحب المقال فوراً من بوابة الأخبار العامة وإخفائه عن الجمهور'
      );
      expect(ownerPublishedArHtml).toContain('تأكيد سحب النشر وإعادة المسودة');

      // 3. Non-Owner users and inactive Owner on Published article: withdrawal action is NOT rendered
      mockI18nState.language = 'en';
      for (const nonOwner of [
        INACTIVE_OWNER_USER,
        CONTENT_EDITOR_USER,
        RIGHTS_REVIEWER_USER,
        TRAINING_MANAGER_USER,
        VIEWER_USER,
      ]) {
        const nonOwnerPublishedHtml = renderToStaticMarkup(
          createElement(AdminNewsManagement, {
            currentUser: nonOwner,
            initialActiveItem: publishedArticle,
            initialActiveTab: 'workflow',
            initialPendingTransition: withdrawConfig,
          })
        );
        expect(nonOwnerPublishedHtml).not.toContain(
          'data-testid="news-workflow-transition-btn-Draft"'
        );
        expect(nonOwnerPublishedHtml).not.toContain('Withdraw Publication and Return to Draft');
        expect(nonOwnerPublishedHtml).not.toContain('data-testid="news-workflow-comment-drawer"');
        expect(nonOwnerPublishedHtml).not.toContain('data-testid="news-withdrawal-public-warning"');
        expect(nonOwnerPublishedHtml).toContain('This article is in its terminal state.');
      }

      // 4. Articles not in Published state do not show the withdrawal action even for active Owner
      for (const nonPublishedState of [
        WorkflowState.Draft,
        WorkflowState.InReview,
        WorkflowState.ChangesRequested,
        WorkflowState.Approved,
      ]) {
        const html = renderToStaticMarkup(
          createElement(AdminNewsManagement, {
            currentUser: OWNER_USER,
            initialActiveItem: makeArticleFixture(nonPublishedState),
            initialActiveTab: 'workflow',
          })
        );
        expect(html).not.toContain('Withdraw Publication and Return to Draft');
        expect(html).not.toContain('سحب من النشر وإعادة إلى المسودة');
      }
    } finally {
      mockI18nState.language = 'en';
    }
  });
});

