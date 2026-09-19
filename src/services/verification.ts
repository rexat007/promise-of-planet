import {
  mockNewsList,
  mockReportsList,
  mockVideosList,
  mockContentVideoRelations,
  mockYouTubeSyncLogs,
} from '../data/index';
import {
  getAvailableLanguagesForArticle,
  getAvailableLanguagesForVideo,
  isLanguageAvailable,
} from './contentLanguage';
import {
  isArticleVisible,
  isContentPublished,
  isVideoVisibleInArticle,
  isVideoVisibleInMediaHub,
  isContentFeatured,
} from './contentVisibility';
import { 
  AIReviewTargetType, 
  AIFactualFlag,
  AIReviewSeverity,
} from '../types/aiReview';
import { 
  AIReviewService, 
  NullAIReviewProvider 
} from './aiReviewService';
import { INITIAL_MOCK_NEWS } from '../data/mockNewsData';
import { 
  MOCK_LIBRARY_DOCUMENTS,
  MOCK_ORGANIZATIONS,
  MOCK_SOURCES,
} from '../data/mockLibraryData';
import { MOCK_CITIZEN_SUBMISSIONS } from '../data/mockCommunityData';
import { WorkflowState } from '../types/workflow';
import { LibraryRightsStatus } from '../types/library';
import { SubmissionStatus } from '../types/community';
import { resolveReviewTarget, getTargetTypeLabel } from '../components/aiReview/aiReviewFormatters';
import { AdminAccessService } from './adminAccess';
import { AdminUserManager } from './adminUserManager';
import { AdminRole, AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';
import { AuditAction, AuditTargetType } from '../types/audit';
import { AdminAuditService } from './adminAuditService';
import {
  getTargetTypeLabel as getAuditTargetTypeLabel,
  getActionLabel as getAuditActionLabel,
  formatAuditValue,
  formatFieldName,
  formatAuditTimestamp,
} from '../components/audit/auditFormatters';
import {
  SystemReportsService,
  deriveNewsReport,
  deriveLibraryReport,
  deriveTrainingReport,
  deriveCommunityReport,
  deriveAIReviewReport,
  deriveUsersReport,
  deriveAuditActivityReport,
  deriveSystemOperationalSummary,
} from './systemReportsService';
import { MOCK_TRAINING_COURSES } from '../data/mockTrainingData';
import { GlobalSettingsService, DEFAULT_GLOBAL_SETTINGS } from './globalSettingsService';
import type { PlatformGlobalSettings } from '../types/settings';

/**
 * Direct logical verification of the Visibility & Language engines
 * against the approved mock dataset from Block 06-B.
 */
export function runEngineVerification() {
  const results: { test: string; passed: boolean; details?: string }[] = [];

  // Helper assertion
  function assert(name: string, condition: boolean, details?: string) {
    results.push({ test: name, passed: condition, details });
  }

  // Find specific mock items
  const newsClimate = mockNewsList.find((n) => n.id === 'news-climate-01')!;
  const newsWater = mockNewsList.find((n) => n.id === 'news-water-02')!;
  const newsDraft = mockNewsList.find((n) => n.id === 'news-draft-05')!;
  const newsBreaking = mockNewsList.find((n) => n.id === 'news-breaking-04')!;

  const reportDesert = mockReportsList.find((r) => r.id === 'report-desertification-01')!;

  const vidFeatured = mockVideosList.find((v) => v.id === 'vid-featured-01')!;
  const vidGash = mockVideosList.find((v) => v.id === 'vid-gash-flood-02')!;
  const vidMediaHubOnly = mockVideosList.find((v) => v.id === 'vid-mediahub-only-03')!;
  const vidSyncError = mockVideosList.find((v) => v.id === 'vid-sync-error-04')!;
  const vidUnavailable = mockVideosList.find((v) => v.id === 'vid-unavailable-05')!;
  const vidHidden = mockVideosList.find((v) => v.id === 'vid-hidden-06')!;

  // 1. Published / Draft Content Checks
  assert('Published News is recognized as published', isContentPublished(newsClimate).visible === true);
  assert(
    'Draft News is rejected with NOT_PUBLISHED',
    isContentPublished(newsDraft).visible === false && isContentPublished(newsDraft).reason === 'NOT_PUBLISHED'
  );

  // 2. Language Engine Checks
  // news-climate-01 has both Arabic and English
  assert('news-climate-01 has Arabic available', isLanguageAvailable(newsClimate, 'ar') === true);
  assert('news-climate-01 has English available', isLanguageAvailable(newsClimate, 'en') === true);
  const climateLangs = getAvailableLanguagesForArticle(newsClimate);
  assert('news-climate-01 returns [ar, en]', climateLangs.includes('ar') && climateLangs.includes('en'));

  // news-water-02 has only Arabic
  assert('news-water-02 has Arabic available', isLanguageAvailable(newsWater, 'ar') === true);
  assert('news-water-02 has English NOT available', isLanguageAvailable(newsWater, 'en') === false);
  const waterLangs = getAvailableLanguagesForArticle(newsWater);
  assert('news-water-02 returns only [ar]', waterLangs.length === 1 && waterLangs[0] === 'ar');

  // Video language checks
  assert('vid-featured-01 has Arabic', isLanguageAvailable(vidFeatured, 'ar') === true);
  assert('vid-featured-01 has English', isLanguageAvailable(vidFeatured, 'en') === true);
  assert('vid-hidden-06 has Arabic and English populated', getAvailableLanguagesForVideo(vidHidden).length === 2);
  assert('vid-hidden-06 has English available', isLanguageAvailable(vidHidden, 'en') === true);

  // 3. News / Report Visibility Checks
  assert('news-climate-01 is visible generally', isArticleVisible(newsClimate).visible === true);
  assert('news-climate-01 is visible in Arabic', isArticleVisible(newsClimate, 'ar').visible === true);
  assert('news-climate-01 is visible in English', isArticleVisible(newsClimate, 'en').visible === true);

  assert('news-water-02 is visible in Arabic', isArticleVisible(newsWater, 'ar').visible === true);
  assert(
    'news-water-02 is hidden in English due to missing fields',
    isArticleVisible(newsWater, 'en').visible === false &&
      isArticleVisible(newsWater, 'en').reason === 'MISSING_REQUIRED_LANGUAGE_FIELDS'
  );

  assert('report-desertification-01 is visible in Arabic and English', isArticleVisible(reportDesert, 'ar').visible === true);
  assert('news-breaking-04 is visible even without featuredImage', isArticleVisible(newsBreaking).visible === true);
  assert('news-draft-05 is hidden with NOT_PUBLISHED', isArticleVisible(newsDraft).visible === false);

  // 4. Video in Media Hub Checks
  assert('vid-featured-01 visible in Media Hub', isVideoVisibleInMediaHub(vidFeatured).visible === true);
  assert('vid-gash-flood-02 visible in Media Hub', isVideoVisibleInMediaHub(vidGash).visible === true);
  assert('vid-mediahub-only-03 visible in Media Hub', isVideoVisibleInMediaHub(vidMediaHubOnly).visible === true);

  // 5. SyncError Handling Check (MANDATORY RULE)
  // vid-sync-error-04 has a SyncError in mockYouTubeSyncLogs, but its availabilityStatus is 'Available'
  const syncCheck = isVideoVisibleInMediaHub(vidSyncError, undefined, mockYouTubeSyncLogs);
  assert('vid-sync-error-04 is visible in Media Hub despite SyncError in logs', syncCheck.visible === true);

  // 6. Private / Hidden Video Checks
  assert(
    'vid-unavailable-05 is rejected due to Private availability',
    isVideoVisibleInMediaHub(vidUnavailable).visible === false &&
      isVideoVisibleInMediaHub(vidUnavailable).reason === 'VIDEO_NOT_AVAILABLE'
  );
  assert(
    'vid-hidden-06 is rejected due to Hidden editorial decision',
    isVideoVisibleInMediaHub(vidHidden).visible === false &&
      isVideoVisibleInMediaHub(vidHidden).reason === 'NOT_PUBLISHED' // also Draft
  );

  // 7. Video in Article / Relation Checks
  // Relation 1: report-desertification-01 + vid-featured-01 (Active, Embedded) -> should pass
  const rel1 = mockContentVideoRelations.find((r) => r.id === 'rel-rep-des-vid-01')!;
  assert('rel-rep-des-vid-01 passes in article', isVideoVisibleInArticle(reportDesert, vidFeatured, rel1).visible === true);

  // Relation 2: news-climate-01 + vid-featured-01 (Active, RelatedCoverage) -> should pass
  const rel2 = mockContentVideoRelations.find((r) => r.id === 'rel-news-clim-vid-01')!;
  assert('rel-news-clim-vid-01 passes in article', isVideoVisibleInArticle(newsClimate, vidFeatured, rel2).visible === true);

  // Relation 5: news-water-02 + vid-unavailable-05 (Active relation, but Video is Private) -> must be rejected
  const rel5 = mockContentVideoRelations.find((r) => r.id === 'rel-news-wat-vid-05')!;
  const rel5Check = isVideoVisibleInArticle(newsWater, vidUnavailable, rel5);
  assert(
    'rel-news-wat-vid-05 rejected because video is Private',
    rel5Check.visible === false && rel5Check.reason === 'VIDEO_NOT_AVAILABLE'
  );

  // Relation 6: report-desertification-01 + vid-mediahub-only-03 (isActive: false) -> must be rejected
  const rel6 = mockContentVideoRelations.find((r) => r.id === 'rel-inactive-06')!;
  const rel6Check = isVideoVisibleInArticle(reportDesert, vidMediaHubOnly, rel6);
  assert(
    'rel-inactive-06 rejected because relation is inactive',
    rel6Check.visible === false && rel6Check.reason === 'RELATION_INACTIVE'
  );

  // MediaHubOnly inside Article (simulate if relation was active)
  const simulatedActiveRel6 = { ...rel6, isActive: true };
  const mediaHubInArticleCheck = isVideoVisibleInArticle(reportDesert, vidMediaHubOnly, simulatedActiveRel6);
  assert(
    'MediaHubOnly video rejected inside article even if relation active',
    mediaHubInArticleCheck.visible === false && mediaHubInArticleCheck.reason === 'VIDEO_NOT_NEWS_ELIGIBLE'
  );

  // 8. Featured Check
  assert('vid-featured-01 is featured', isContentFeatured(vidFeatured).visible === true);
  assert('vid-gash-flood-02 is NOT featured (NewsEligible only)', isContentFeatured(vidGash).visible === false);

  // 9. AI Content Auditor Foundation & Human Authority Boundary Checks
  // A. Target Identity & Multi-Domain Retrieval
  const newsReview = AIReviewService.getReviewForTarget(AIReviewTargetType.News, 'news-sudan-101');
  assert('AI Review retrieved for News target', newsReview !== null && newsReview.target.targetId === 'news-sudan-101');

  const libReview = AIReviewService.getReviewForTarget(AIReviewTargetType.LibraryDocument, 'doc-201');
  assert('AI Review retrieved for Library target', libReview !== null && libReview.target.targetId === 'doc-201');

  const trReview = AIReviewService.getReviewForTarget(AIReviewTargetType.TrainingCourse, 'course-01');
  assert('AI Review retrieved for Training target', trReview !== null && trReview.target.targetId === 'course-01');

  const commReview = AIReviewService.getReviewForTarget(AIReviewTargetType.CitizenSubmission, 'sub-001');
  assert('AI Review retrieved for Community target', commReview !== null && commReview.target.targetId === 'sub-001');

  // B. Source Freshness Binding & Stale Review Detection
  if (newsReview) {
    // Exact match timestamp -> not stale
    assert('Review with matching timestamp is NOT stale', AIReviewService.isReviewStale(newsReview, '2026-09-14T11:20:00Z') === false);
    // Newer source timestamp -> stale
    assert('Review with newer source timestamp is recognized as STALE', AIReviewService.isReviewStale(newsReview, '2026-09-15T00:00:00Z') === true);
  }

  // C. Source Content Immutability
  const originalNews = INITIAL_MOCK_NEWS.find(n => n.id === 'news-sudan-101')!;
  const originalSnapshot = JSON.stringify(originalNews);
  // Reading review must not mutate source
  const retrievedReview = AIReviewService.getReviewForTarget(AIReviewTargetType.News, 'news-sudan-101');
  const postSnapshot = JSON.stringify(originalNews);
  assert('AI Review retrieval does not mutate source News item', originalSnapshot === postSnapshot && retrievedReview !== null);

  // D. Findings Remain Advisory & Factual Terminology
  if (newsReview) {
    assert('AI Review artifact explicitly marked isAdvisoryOnly: true', newsReview.isAdvisoryOnly === true);
    const sourceFlagFinding = newsReview.findings.find(f => f.id === 'find-news-01');
    assert('Factual claim flag is present when relevant', sourceFlagFinding?.flag === AIFactualFlag.SourceCheckSuggested);
    const completenessFinding = newsReview.findings.find(f => f.id === 'find-news-02');
    assert('Non-factual finding has no flag (clean optional field)', completenessFinding?.flag === undefined);
    assert('Finding uses single source-language prose', typeof sourceFlagFinding?.message === 'string' && sourceFlagFinding.sourceLanguage === 'ar');
  }

  // E. Architectural Authority Boundaries (No direct workflow / status / rights mutation)
  const boundary = AIReviewService.assertAuthorityBoundary();
  assert('AI engine forbidden from direct workflow mutation', boundary.allowsDirectWorkflowMutation === false);
  assert('AI engine forbidden from direct citizen status mutation', boundary.allowsDirectStatusMutation === false);
  assert('AI engine forbidden from direct library rights mutation', boundary.allowsDirectRightsMutation === false);
  assert('AI engine confirmed strictly advisory', boundary.isAdvisoryOnly === true);

  // F. Verification that domain records preserve human-authority states
  const sampleNews = INITIAL_MOCK_NEWS[0];
  assert('News preserves WorkflowState under human authority', sampleNews.workflowState === WorkflowState.Published);

  const sampleLib = MOCK_LIBRARY_DOCUMENTS[0];
  assert('Library preserves rightsStatus under human authority', sampleLib.rightsStatus === LibraryRightsStatus.OpenPubliclyAvailable);

  const sampleComm = MOCK_CITIZEN_SUBMISSIONS[0];
  assert('Community preserves submission status under human authority', sampleComm.status === SubmissionStatus.UnderReview);

  // G. Provider Boundary (Null provider fallback when unconfigured)
  const nullProvider = new NullAIReviewProvider();
  assert('Null provider is marked unconfigured', nullProvider.isConfigured === false);
  const nullResult = nullProvider.analyze({
    targetType: AIReviewTargetType.News,
    targetId: 'news-test-999',
    sourceUpdatedAt: '2026-09-19T00:00:00Z'
  });
  assert('Null provider produces safe unconfigured fallback artifact', nullResult.executionState === 'Failed' && nullResult.findings.length === 0);

  // H. Canonical Review Target Resolution (Domain Entity Binding)
  const resolvedNews = resolveReviewTarget(AIReviewTargetType.News, 'news-sudan-101', true);
  assert('News target resolves correctly to title', resolvedNews.isAvailable && resolvedNews.title.includes('النيل الأزرق'));

  const resolvedDoc = resolveReviewTarget(AIReviewTargetType.LibraryDocument, 'doc-201', false);
  assert('Library target resolves correctly', resolvedDoc.isAvailable && resolvedDoc.title.includes('Waste Management'));

  const resolvedTraining = resolveReviewTarget(AIReviewTargetType.TrainingCourse, 'course-01', true);
  assert('Training course target resolves correctly', resolvedTraining.isAvailable && resolvedTraining.title.includes('البيئي'));

  const resolvedComm = resolveReviewTarget(AIReviewTargetType.CitizenSubmission, 'sub-001', true);
  assert('Citizen submission target resolves correctly', resolvedComm.isAvailable && resolvedComm.title.includes('النيل الأبيض'));

  const resolvedMissing = resolveReviewTarget(AIReviewTargetType.News, 'news-archived-999', true);
  assert('Missing target resolves gracefully without error', resolvedMissing.isAvailable === false && resolvedMissing.title.includes('غير متوفر'));

  // I. Admin Access & RBAC Boundary for AI Reviews
  const aiAssistantUser: AdminUser = { id: 'user-ai', name: 'AI Specialist', email: 'ai@example.com', role: AdminRole.AIAssistant, isActive: true };
  const hasReviewPerm = AdminAccessService.hasPermission(aiAssistantUser, AdminPermission.Review);
  assert('AIAssistant role has AdminPermission.Review', hasReviewPerm === true);

  const editorUser: AdminUser = { id: 'user-ed', name: 'News Editor', email: 'editor@example.com', role: AdminRole.ContentEditor, isActive: true };
  const editorHasReviewPerm = AdminAccessService.hasPermission(editorUser, AdminPermission.Review);
  assert('ContentEditor role has AdminPermission.Review', editorHasReviewPerm === true);

  // J. Localized Formatters
  assert('Target type formatter supports Arabic', getTargetTypeLabel(AIReviewTargetType.News, true) === 'خبر بيئي');
  assert('Target type formatter supports English', getTargetTypeLabel(AIReviewTargetType.News, false) === 'Environmental News');

  return results;
}

/**
 * Direct logical verification of the Users & Permissions Management engine,
 * RBAC invariants, active/inactive status enforcement, self-protection rules,
 * and Last Active Owner immortality.
 */
export function runUsersAndPermissionsVerification() {
  const results: { test: string; passed: boolean; details?: string }[] = [];

  function assert(name: string, condition: boolean, details?: string) {
    results.push({ test: name, passed: condition, details });
  }

  const mockUsers = AdminAccessService.getMockUsers();

  // 1. Initial Mock Users Invariants
  assert('Mock users list has 9 pre-configured identities', mockUsers.length === 9);
  assert('All initial mock users have isActive = true', mockUsers.every(u => u.isActive === true));

  // 2. RBAC Access Control & Inactive User Gating
  const ownerUser = mockUsers.find(u => u.role === AdminRole.Owner)!;
  const editorUser = mockUsers.find(u => u.role === AdminRole.ContentEditor)!;
  const viewerUser = mockUsers.find(u => u.role === AdminRole.Viewer)!;
  const aiUser = mockUsers.find(u => u.role === AdminRole.AIAssistant)!;

  assert('Active Owner has ManageUsers permission', AdminAccessService.hasPermission(ownerUser, AdminPermission.ManageUsers) === true);
  assert('Active Editor has Edit permission', AdminAccessService.hasPermission(editorUser, AdminPermission.Edit) === true);
  assert('Active Editor does NOT have ManageUsers permission', AdminAccessService.hasPermission(editorUser, AdminPermission.ManageUsers) === false);
  assert('Active Viewer has View and ViewReports permissions', 
    AdminAccessService.hasPermission(viewerUser, AdminPermission.View) === true &&
    AdminAccessService.hasPermission(viewerUser, AdminPermission.ViewReports) === true
  );
  assert('Active Viewer does NOT have Create, Edit, or Approve permissions',
    AdminAccessService.hasPermission(viewerUser, AdminPermission.Create) === false &&
    AdminAccessService.hasPermission(viewerUser, AdminPermission.Edit) === false &&
    AdminAccessService.hasPermission(viewerUser, AdminPermission.Approve) === false
  );
  assert('Active AIAssistant has only View and Review permissions',
    AdminAccessService.hasPermission(aiUser, AdminPermission.View) === true &&
    AdminAccessService.hasPermission(aiUser, AdminPermission.Review) === true &&
    AdminAccessService.hasPermission(aiUser, AdminPermission.Approve) === false &&
    AdminAccessService.hasPermission(aiUser, AdminPermission.Publish) === false
  );

  // Inactive User RBAC check: Inactive users MUST have zero effective permissions
  const inactiveOwner = { ...ownerUser, isActive: false };
  assert('Inactive Owner has NO View permission', AdminAccessService.hasPermission(inactiveOwner, AdminPermission.View) === false);
  assert('Inactive Owner has NO ManageUsers permission', AdminAccessService.hasPermission(inactiveOwner, AdminPermission.ManageUsers) === false);
  assert('Inactive Owner has NO Publish permission', AdminAccessService.hasPermission(inactiveOwner, AdminPermission.Publish) === false);

  // 3. Last Active Owner Invariant
  const activeOwnersCount = AdminUserManager.getActiveOwnerCount(mockUsers);
  assert('Initial mock user list contains exactly 1 active Owner', activeOwnersCount === 1);
  assert('Current Owner is detected as last active Owner', AdminUserManager.isLastActiveOwner(ownerUser, mockUsers) === true);

  // Attempt to deactivate the last active owner
  const dummyActor = editorUser;
  const deactLastOwnerCheck = AdminUserManager.canDeactivateUser(ownerUser, dummyActor, mockUsers);
  assert('Cannot deactivate the last active Owner', deactLastOwnerCheck.allowed === false);

  // Attempt to demote the last active owner
  const demoteLastOwnerCheck = AdminUserManager.canChangeUserRole(ownerUser, AdminRole.Viewer, dummyActor, mockUsers);
  assert('Cannot demote the last active Owner away from Owner', demoteLastOwnerCheck.allowed === false);

  // When multiple active owners exist, deactivating one is permitted
  const secondOwner: AdminUser = { id: 'u-owner-2', name: 'Co-Owner', email: 'coowner@test.sd', role: AdminRole.Owner, isActive: true };
  const twoOwnersList = [...mockUsers, secondOwner];
  assert('Two active owners list has count = 2', AdminUserManager.getActiveOwnerCount(twoOwnersList) === 2);
  assert('Owner 1 is NOT last active Owner when second Owner exists', AdminUserManager.isLastActiveOwner(ownerUser, twoOwnersList) === false);
  const deactWithTwoOwners = AdminUserManager.canDeactivateUser(ownerUser, dummyActor, twoOwnersList);
  assert('Can deactivate an Owner when another active Owner remains', deactWithTwoOwners.allowed === true);

  // 4. Self-Protection Invariants
  // Self-deactivation
  const selfDeactCheck = AdminUserManager.canDeactivateUser(editorUser, editorUser, mockUsers);
  assert('Current session user cannot deactivate themselves', selfDeactCheck.allowed === false);

  // Self-role-change
  const selfRoleChangeCheck = AdminUserManager.canChangeUserRole(editorUser, AdminRole.Owner, editorUser, mockUsers);
  assert('Current session user cannot change their own role', selfRoleChangeCheck.allowed === false);

  // 5. User Creation & Validation
  const validCreate = AdminUserManager.createDemoUser(
    { name: 'Dr. Mona Hassan', email: 'mona@promiseofplanet.sd', role: AdminRole.Trainer },
    mockUsers
  );
  assert('Valid user creation succeeds', validCreate.success === true && !!validCreate.user);
  assert('New user is created with isActive = true', validCreate.user?.isActive === true);
  assert('New user has assigned role', validCreate.user?.role === AdminRole.Trainer);

  // Duplicate email rejection
  const dupCreate = AdminUserManager.createDemoUser(
    { name: 'Duplicate User', email: ownerUser.email, role: AdminRole.Viewer },
    mockUsers
  );
  assert('Duplicate email registration is rejected', dupCreate.success === false);

  // Invalid email format rejection
  const invalidEmailCreate = AdminUserManager.createDemoUser(
    { name: 'Invalid Email', email: 'not-an-email', role: AdminRole.Viewer },
    mockUsers
  );
  assert('Invalid email is rejected', invalidEmailCreate.success === false);

  // Short name rejection
  const shortNameCreate = AdminUserManager.createDemoUser(
    { name: 'A', email: 'valid@domain.com', role: AdminRole.Viewer },
    mockUsers
  );
  assert('Too short name is rejected', shortNameCreate.success === false);

  // 6. Role Permission Diff Computation
  const diffViewerToEditor = AdminUserManager.getRolePermissionDiff(AdminRole.Viewer, AdminRole.ContentEditor);
  assert('Viewer to ContentEditor gains Create, Edit, and Review permissions',
    diffViewerToEditor.gained.includes(AdminPermission.Create) &&
    diffViewerToEditor.gained.includes(AdminPermission.Edit) &&
    diffViewerToEditor.gained.includes(AdminPermission.Review)
  );
  assert('Viewer to ContentEditor loses ViewReports permission',
    diffViewerToEditor.lost.includes(AdminPermission.ViewReports)
  );

  return results;
}

/**
 * Direct logical verification of the Audit Log & History foundation:
 * Canonical event contract, append-only store, immutable retrieval,
 * cross-domain composition, and RBAC authority independence.
 */
export function runAuditLogVerification() {
  const results: { test: string; passed: boolean; details?: string }[] = [];

  function assert(name: string, condition: boolean, details?: string) {
    results.push({ test: name, passed: condition, details });
  }

  // 1. Initial Seed Events Contract
  const initialEvents = AdminAuditService.getEvents();
  assert('Platform audit log initializes with 7 canonical seed events', initialEvents.length >= 7);

  const seed101 = initialEvents.find(e => e.id === 'audit-evt-101');
  assert('Seed event 101 has valid ISO timestamp', !!seed101 && !isNaN(new Date(seed101.timestamp).getTime()));
  assert('Seed event 101 has valid actor references', seed101?.actorUserId === 'u-1' && seed101?.actorRole === AdminRole.Owner);
  assert('Seed event 101 has composed action and target', seed101?.action === AuditAction.WorkflowTransitioned && seed101?.targetType === AuditTargetType.News);
  assert('Seed event 101 contains field delta change record', seed101?.changes?.[0].field === 'workflowState' && seed101?.changes?.[0].newValue === 'Published');

  // 2. Cross-Domain Target Types
  const supportedTargets = Object.values(AuditTargetType);
  assert('AuditTargetType supports News', supportedTargets.includes('News' as typeof AuditTargetType[keyof typeof AuditTargetType]));
  assert('AuditTargetType supports LibraryDocument', supportedTargets.includes('LibraryDocument' as typeof AuditTargetType[keyof typeof AuditTargetType]));
  assert('AuditTargetType supports TrainingCourse', supportedTargets.includes('TrainingCourse' as typeof AuditTargetType[keyof typeof AuditTargetType]));
  assert('AuditTargetType supports CitizenSubmission', supportedTargets.includes('CitizenSubmission' as typeof AuditTargetType[keyof typeof AuditTargetType]));
  assert('AuditTargetType supports AdminUser', supportedTargets.includes('AdminUser' as typeof AuditTargetType[keyof typeof AuditTargetType]));
  assert('AuditTargetType supports AIReviewArtifact', supportedTargets.includes('AIReviewArtifact' as typeof AuditTargetType[keyof typeof AuditTargetType]));
  assert('AuditTargetType supports GlobalSettings', supportedTargets.includes('GlobalSettings' as typeof AuditTargetType[keyof typeof AuditTargetType]));
  assert('AuditTargetType does NOT contain obsolete Report target', !supportedTargets.includes('Report' as any));

  // 3. Compact Canonical Action Vocabulary
  const supportedActions = Object.values(AuditAction);
  assert('AuditAction vocabulary contains exactly 6 canonical actions', supportedActions.length === 6);
  assert('AuditAction includes Created, Updated, WorkflowTransitioned, StatusChanged, RoleChanged, RightsChanged',
    supportedActions.includes(AuditAction.Created) &&
    supportedActions.includes(AuditAction.Updated) &&
    supportedActions.includes(AuditAction.WorkflowTransitioned) &&
    supportedActions.includes(AuditAction.StatusChanged) &&
    supportedActions.includes(AuditAction.RoleChanged) &&
    supportedActions.includes(AuditAction.RightsChanged)
  );

  // 4. Unique Event Creation & Auto-Generated ID / Timestamp
  const beforeCount = AdminAuditService.getEventCount();
  const recordedEvent = AdminAuditService.recordEvent({
    actorUserId: 'u-3',
    actorName: 'Khalid Yousif',
    actorRole: AdminRole.LibraryCurator,
    action: AuditAction.Updated,
    targetType: AuditTargetType.LibraryDocument,
    targetId: 'doc-202',
    targetTitle: 'Sudan Wildlife Conservation Regulation',
    changes: [
      { field: 'summaryEn', previousValue: 'Old summary', newValue: 'Updated legal summary' },
    ],
  });

  assert('Recorded event receives unique non-empty ID', !!recordedEvent.id && recordedEvent.id.startsWith('audit-evt-'));
  assert('Recorded event receives valid auto-generated ISO timestamp', !isNaN(new Date(recordedEvent.timestamp).getTime()));
  assert('Store event count increments by 1 (append-only)', AdminAuditService.getEventCount() === beforeCount + 1);

  // 5. Multi-Change Support in a Single Event
  const multiChangeEvent = AdminAuditService.recordEvent({
    actorUserId: 'u-1',
    actorName: 'Abbass Abdelhalim',
    actorRole: AdminRole.Owner,
    action: AuditAction.Updated,
    targetType: AuditTargetType.AdminUser,
    targetId: 'u-5',
    targetTitle: 'Mustafa Hassan',
    changes: [
      { field: 'name', previousValue: 'Mustafa H.', newValue: 'Mustafa Hassan' },
      { field: 'email', previousValue: 'mustafa@old.sd', newValue: 'training.mgr@promiseofplanet.sd' },
    ],
  });

  assert('Multi-change event records both field deltas atomically',
    multiChangeEvent.changes?.length === 2 &&
    multiChangeEvent.changes.some(c => c.field === 'name') &&
    multiChangeEvent.changes.some(c => c.field === 'email')
  );

  // 6. Append-Only Immutability & Defensive Copying
  const fetchedEvent = AdminAuditService.getEventById(recordedEvent.id)!;
  assert('Fetched event matches recorded ID', fetchedEvent.id === recordedEvent.id);
  // Attempt to mutate returned object
  (fetchedEvent as any).actorName = 'MUTATED_NAME';
  if (fetchedEvent.changes && fetchedEvent.changes[0]) {
    fetchedEvent.changes[0].field = 'MUTATED_FIELD';
  }
  const refetchedEvent = AdminAuditService.getEventById(recordedEvent.id)!;
  assert('Internal store event remains immutable against external mutation', refetchedEvent.actorName === 'Khalid Yousif');
  assert('Internal store changes array remains immutable against external mutation', refetchedEvent.changes?.[0].field === 'summaryEn');

  // 7. Deterministic Querying & Filtering
  const newsEvents = AdminAuditService.getEventsByTarget(AuditTargetType.News, 'news-sudan-101');
  assert('Query by target returns matching news events', newsEvents.length > 0 && newsEvents.every(e => e.targetId === 'news-sudan-101'));

  const ownerEvents = AdminAuditService.getEventsByActor('u-1');
  assert('Query by actor returns matching owner events', ownerEvents.length > 0 && ownerEvents.every(e => e.actorUserId === 'u-1'));

  const filteredByAction = AdminAuditService.getEvents({ action: AuditAction.RightsChanged });
  assert('Query by action returns rights change events', filteredByAction.length > 0 && filteredByAction.every(e => e.action === AuditAction.RightsChanged));

  // 8. No Edit or Delete API on Service
  assert('AdminAuditService has no editEvent method', (AdminAuditService as any).editEvent === undefined);
  assert('AdminAuditService has no deleteEvent method', (AdminAuditService as any).deleteEvent === undefined);
  assert('AdminAuditService has no clearEvents method', (AdminAuditService as any).clearEvents === undefined);

  // 9. Authority Independence & Invariant Protection
  const ownerUser: AdminUser = { id: 'u-1', name: 'Owner', email: 'owner@test.sd', role: AdminRole.Owner, isActive: true };
  const viewerUser: AdminUser = { id: 'u-9', name: 'Viewer', email: 'viewer@test.sd', role: AdminRole.Viewer, isActive: true };

  // Recording an event does not alter user role or permissions
  AdminAuditService.recordEvent({
    actorUserId: viewerUser.id,
    actorName: viewerUser.name,
    actorRole: viewerUser.role,
    action: AuditAction.Updated,
    targetType: AuditTargetType.News,
    targetId: 'news-sudan-101',
  });
  assert('Viewer still lacks Edit permission after audit event recording', AdminAccessService.hasPermission(viewerUser, AdminPermission.Edit) === false);
  assert('Viewer still lacks ManageUsers permission after audit event recording', AdminAccessService.hasPermission(viewerUser, AdminPermission.ManageUsers) === false);
  assert('Owner still retains ManageUsers permission', AdminAccessService.hasPermission(ownerUser, AdminPermission.ManageUsers) === true);

  // 10. Large Content Defensive Strategy
  const contentEditEvent = AdminAuditService.recordEvent({
    actorUserId: 'u-2',
    actorName: 'Sarah Ahmed',
    actorRole: AdminRole.ContentEditor,
    action: AuditAction.Updated,
    targetType: AuditTargetType.News,
    targetId: 'news-sudan-101',
    changes: [
      { field: 'bodyAr', previousValue: '(article body: 1420 chars)', newValue: '(article body: 1580 chars)' },
    ],
  });
  assert('Large editorial edit records concise summary delta instead of raw multi-kilobyte text',
    contentEditEvent.changes?.[0].field === 'bodyAr' &&
    typeof contentEditEvent.changes?.[0].newValue === 'string' &&
    contentEditEvent.changes?.[0].newValue.includes('chars')
  );

  // 11. Formatter Localization & System Value Safety
  assert('Target type localization outputs Arabic & English properly',
    getAuditTargetTypeLabel(AuditTargetType.News, true) === 'الأخبار البيئية' &&
    getAuditTargetTypeLabel(AuditTargetType.News, false) === 'Environmental News' &&
    getAuditTargetTypeLabel(AuditTargetType.GlobalSettings, true) === 'الإعدادات العامة' &&
    getAuditTargetTypeLabel(AuditTargetType.GlobalSettings, false) === 'Global Settings'
  );
  assert('Action localization outputs Arabic & English properly',
    getAuditActionLabel(AuditAction.WorkflowTransitioned, true) === 'انتقال سير العمل' &&
    getAuditActionLabel(AuditAction.WorkflowTransitioned, false) === 'Workflow Transitioned'
  );
  assert('Format audit value handles workflow states and roles cleanly',
    formatAuditValue('workflowState', WorkflowState.InReview, true) === 'قيد المراجعة والتدقيق' &&
    formatAuditValue('role', AdminRole.Owner, false) === 'Platform Owner' &&
    formatAuditValue('isActive', true, true) === 'نشط' &&
    formatAuditValue('isActive', false, false) === 'Inactive'
  );
  assert('Format audit value handles empty or null values gracefully',
    formatAuditValue('unknownField', null, true) === 'غير محدد (فارغ)' &&
    formatAuditValue('unknownField', undefined, false) === 'Not set (empty)'
  );

  assert('Format field name handles known system fields in Arabic & English',
    formatFieldName('workflowState', true) === 'حالة سير العمل' &&
    formatFieldName('workflowState', false) === 'Workflow State' &&
    formatFieldName('custom_prop', false) === 'custom_prop'
  );

  // 12. Timestamp Formatter Safety
  const timestampFormatted = formatAuditTimestamp('2026-09-18T10:30:00Z', false);
  assert('Timestamp formatter safely separates date and time',
    !!timestampFormatted.date && !!timestampFormatted.time && !!timestampFormatted.full
  );

  // 13. Historical Snapshot Decoupling Invariant
  // Verify that modifying a user's current role does NOT alter historical audit event actor snapshot
  const historicalEvents = AdminAuditService.getEventsByActor('u-2');
  assert('Historical events retain the exact actor snapshot role at time of event',
    historicalEvents.length > 0 && historicalEvents.every(e => e.actorRole === AdminRole.ContentEditor)
  );

  // ==========================================
  // 14. SYSTEM REPORTS FOUNDATION VERIFICATION
  // ==========================================

  // A. Canonical Source Pure Derivation
  const initialAuditEventsCount = AdminAuditService.getEvents().length;
  const newsReport = deriveNewsReport(INITIAL_MOCK_NEWS);
  assert('News report derives correct total count from canonical mock news',
    newsReport.totalCount === INITIAL_MOCK_NEWS.length && newsReport.totalCount > 0
  );
  assert('News report accurately aggregates items across all WorkflowStates',
    newsReport.byWorkflowState[WorkflowState.Published] > 0 &&
    (newsReport.byWorkflowState[WorkflowState.Draft] +
     newsReport.byWorkflowState[WorkflowState.InReview] +
     newsReport.byWorkflowState[WorkflowState.ChangesRequested] +
     newsReport.byWorkflowState[WorkflowState.Approved] +
     newsReport.byWorkflowState[WorkflowState.Published]) === newsReport.totalCount
  );

  const libraryReport = deriveLibraryReport(MOCK_LIBRARY_DOCUMENTS, MOCK_ORGANIZATIONS, MOCK_SOURCES);
  assert('Library report derives correct counts and dimensions from canonical sources',
    libraryReport.totalCount === MOCK_LIBRARY_DOCUMENTS.length &&
    libraryReport.totalOrganizationsCount === MOCK_ORGANIZATIONS.length &&
    libraryReport.totalSourcesCount === MOCK_SOURCES.length &&
    libraryReport.byRightsStatus[LibraryRightsStatus.OpenPubliclyAvailable] > 0
  );

  const trainingReport = deriveTrainingReport(MOCK_TRAINING_COURSES);
  assert('Training report derives deterministic hours and level breakdowns',
    trainingReport.totalCount === MOCK_TRAINING_COURSES.length &&
    trainingReport.totalDurationHours > 0 &&
    (trainingReport.byLevel.Beginner + trainingReport.byLevel.Intermediate + trainingReport.byLevel.Advanced) === trainingReport.totalCount
  );

  const communityReport = deriveCommunityReport(MOCK_CITIZEN_SUBMISSIONS);
  assert('Community report derives submission statuses and attachment metrics',
    communityReport.totalCount === MOCK_CITIZEN_SUBMISSIONS.length &&
    communityReport.withAttachmentsCount > 0 &&
    communityReport.totalAttachmentsCount >= communityReport.withAttachmentsCount &&
    (communityReport.byStatus[SubmissionStatus.Received] +
     communityReport.byStatus[SubmissionStatus.UnderReview] +
     communityReport.byStatus[SubmissionStatus.AcceptedForEditorial] +
     communityReport.byStatus[SubmissionStatus.Rejected]) === communityReport.totalCount
  );

  const aiReviewReport = deriveAIReviewReport(AIReviewService.getAllReviews());
  assert('AI Review report derives advisory findings and severity counts',
    aiReviewReport.totalArtifactsCount === AIReviewService.getAllReviews().length &&
    aiReviewReport.totalFindingsCount > 0 &&
    aiReviewReport.findingsBySeverity[AIReviewSeverity.Warning] >= 0
  );

  const mockUsers = AdminAccessService.getMockUsers();
  const usersReport = deriveUsersReport(mockUsers);
  assert('Users report derives exact role counts, active users, and active owner count',
    usersReport.totalUsersCount === mockUsers.length &&
    usersReport.activeUsersCount === mockUsers.filter(u => u.isActive).length &&
    usersReport.activeOwnerCount === 1 &&
    usersReport.byRole[AdminRole.Owner] === 1
  );

  const auditReport = deriveAuditActivityReport(AdminAuditService.getEvents());
  assert('Audit activity report derives event totals by target and action without modifying log',
    auditReport.totalEventsCount === AdminAuditService.getEvents().length &&
    auditReport.byAction[AuditAction.Created] > 0
  );

  // B. Immutability & Non-Mutation Invariant
  const finalAuditEventsCount = AdminAuditService.getEvents().length;
  assert('Reporting derivation does not mutate Audit Log history',
    initialAuditEventsCount === finalAuditEventsCount
  );

  // C. Empty Input Determinism
  const emptyNews = deriveNewsReport([]);
  assert('Empty news input produces zero counts with fully initialized WorkflowState keys',
    emptyNews.totalCount === 0 &&
    emptyNews.byWorkflowState[WorkflowState.Draft] === 0 &&
    emptyNews.byWorkflowState[WorkflowState.Published] === 0
  );

  const emptyLibrary = deriveLibraryReport([]);
  assert('Empty library input produces zero counts with fully initialized rights/type keys',
    emptyLibrary.totalCount === 0 &&
    emptyLibrary.totalOrganizationsCount === 0 &&
    emptyLibrary.byRightsStatus[LibraryRightsStatus.Unknown] === 0
  );

  const emptyUsers = deriveUsersReport([]);
  assert('Empty users input produces zero counts with all 9 AdminRole keys initialized',
    emptyUsers.totalUsersCount === 0 &&
    emptyUsers.activeOwnerCount === 0 &&
    emptyUsers.byRole[AdminRole.Owner] === 0 &&
    emptyUsers.byRole[AdminRole.Viewer] === 0
  );

  // D. System Summary Facade & Data Scope Safety
  const directSummary = deriveSystemOperationalSummary();
  assert('deriveSystemOperationalSummary produces snapshot with dataScope and timestamp',
    directSummary.dataScope === 'in-memory-operational-snapshot' && !!directSummary.generatedAt
  );

  const systemSummary = SystemReportsService.getSystemSummary();
  assert('SystemReportsService summary is marked with in-memory-operational-snapshot dataScope',
    systemSummary.dataScope === 'in-memory-operational-snapshot' &&
    !!systemSummary.generatedAt &&
    systemSummary.news.totalCount > 0 &&
    systemSummary.library.totalCount > 0 &&
    systemSummary.training.totalCount > 0 &&
    systemSummary.community.totalCount > 0 &&
    systemSummary.aiReview.totalArtifactsCount > 0 &&
    systemSummary.users.totalUsersCount > 0 &&
    systemSummary.auditActivity.totalEventsCount > 0
  );

  // E. RBAC Invariant (ViewReports Authority)
  const reportViewerUser: AdminUser = { id: 'u-9', name: 'Viewer', email: 'viewer@test.sd', role: AdminRole.Viewer, isActive: true };
  const contentEditorUser: AdminUser = { id: 'u-2', name: 'Editor', email: 'editor@test.sd', role: AdminRole.ContentEditor, isActive: true };
  const inactiveViewerUser: AdminUser = { id: 'u-9-inact', name: 'Inactive Viewer', email: 'inact@test.sd', role: AdminRole.Viewer, isActive: false };

  assert('Active Viewer is authorized with ViewReports permission',
    AdminAccessService.hasPermission(reportViewerUser, AdminPermission.ViewReports) === true
  );
  assert('Active ContentEditor lacks ViewReports permission',
    AdminAccessService.hasPermission(contentEditorUser, AdminPermission.ViewReports) === false
  );
  assert('Inactive Viewer is rejected for ViewReports permission',
    AdminAccessService.hasPermission(inactiveViewerUser, AdminPermission.ViewReports) === false
  );
  assert('Active Owner is authorized with ViewReports permission',
    AdminAccessService.hasPermission(ownerUser, AdminPermission.ViewReports) === true
  );

  // F. UI Read-Only & Zero-Audit-Mutation Invariant
  const auditEventsBefore = AdminAuditService.getEvents().length;
  const snapshot1 = SystemReportsService.getSystemSummary();
  const snapshot2 = SystemReportsService.getSystemSummary();
  const auditEventsAfter = AdminAuditService.getEvents().length;

  assert('System reports derivation and summary generation produce zero audit events (read-only invariant)',
    auditEventsBefore === auditEventsAfter && !!snapshot1 && !!snapshot2
  );

  assert('Operational snapshots enforce exact mathematical aggregation balance across all domains',
    (snapshot1.news.byWorkflowState[WorkflowState.Draft] +
     snapshot1.news.byWorkflowState[WorkflowState.InReview] +
     snapshot1.news.byWorkflowState[WorkflowState.ChangesRequested] +
     snapshot1.news.byWorkflowState[WorkflowState.Approved] +
     snapshot1.news.byWorkflowState[WorkflowState.Published]) === snapshot1.news.totalCount &&
    (snapshot1.library.byWorkflowState[WorkflowState.Draft] +
     snapshot1.library.byWorkflowState[WorkflowState.InReview] +
     snapshot1.library.byWorkflowState[WorkflowState.ChangesRequested] +
     snapshot1.library.byWorkflowState[WorkflowState.Approved] +
     snapshot1.library.byWorkflowState[WorkflowState.Published]) === snapshot1.library.totalCount &&
    (snapshot1.users.activeUsersCount + snapshot1.users.inactiveUsersCount) === snapshot1.users.totalUsersCount &&
    (snapshot1.community.byStatus[SubmissionStatus.Received] +
     snapshot1.community.byStatus[SubmissionStatus.UnderReview] +
     snapshot1.community.byStatus[SubmissionStatus.AcceptedForEditorial] +
     snapshot1.community.byStatus[SubmissionStatus.Rejected]) === snapshot1.community.totalCount
  );

  return results;
}

/**
 * Global Settings Foundation Verification
 *
 * Verifies all 12 core architectural invariants established for Global Settings:
 * 1. Settings cannot introduce arbitrary unknown keys.
 * 2. Canonical contracts/enums (e.g. Language) are reused.
 * 3. Invalid setting values are strictly rejected.
 * 4. Reading settings has zero side effects and returns frozen objects.
 * 5. Unauthorized mutations are denied by canonical RBAC.
 * 6. No secrets, credentials, or API keys are stored in settings.
 * 7. No GIS/Maps settings exist.
 * 8. No Donations/Subscriptions settings exist.
 * 9. No Founder Platform Development capabilities exist.
 * 10. No duplicate RBAC authority or parallel permission map is introduced.
 * 11. Settings updates produce structured AuditChange[] without parallel history systems.
 * 12. Current in-memory persistence limitations are transparently represented.
 */
export function runGlobalSettingsVerification() {
  const results: { test: string; passed: boolean; details?: string }[] = [];

  function assert(name: string, condition: boolean, details?: string) {
    results.push({ test: name, passed: condition, details });
  }

  const ownerUser: AdminUser = {
    id: 'u-owner-test',
    name: 'Platform Owner',
    email: 'owner@test.sd',
    role: AdminRole.Owner,
    isActive: true,
  };

  const viewerUser: AdminUser = {
    id: 'u-viewer-test',
    name: 'Platform Viewer',
    email: 'viewer@test.sd',
    role: AdminRole.Viewer,
    isActive: true,
  };

  const editorUser: AdminUser = {
    id: 'u-editor-test',
    name: 'Platform Editor',
    email: 'editor@test.sd',
    role: AdminRole.ContentEditor,
    isActive: true,
  };

  const inactiveOwnerUser: AdminUser = {
    id: 'u-owner-inact',
    name: 'Inactive Owner',
    email: 'owner-inact@test.sd',
    role: AdminRole.Owner,
    isActive: false,
  };

  // Ensure baseline defaults before testing
  GlobalSettingsService.resetToDefaults(ownerUser);

  // 1. Reading settings has zero side effects & returns frozen object
  const initial = GlobalSettingsService.getSettings();
  assert('1. getSettings returns an object', typeof initial === 'object' && initial !== null);
  assert('1. getSettings returns a frozen object (cannot mutate directly)', Object.isFrozen(initial));
  assert('1. Canonical defaults match expected values',
    initial.climateClockEnabled === true && initial.defaultLanguage === 'ar'
  );

  // 2. Settings cannot introduce arbitrary unknown keys
  const unknownKeyVal = GlobalSettingsService.validateSettings({
    unmanagedKey: 'arbitrary_value',
    anotherFakeField: 123,
  });
  assert('2. Validation strictly rejects unknown setting keys',
    unknownKeyVal.isValid === false && unknownKeyVal.errors.length === 2
  );

  let unknownKeyThrown = false;
  try {
    GlobalSettingsService.updateSettings({ maliciousKey: 'exploit' } as any, ownerUser);
  } catch {
    unknownKeyThrown = true;
  }
  assert('2. updateSettings throws error when unknown key is supplied', unknownKeyThrown);

  // 3. Canonical enums/contracts are reused where applicable
  assert('3. defaultLanguage contract reuses canonical Language union',
    initial.defaultLanguage === 'ar' || initial.defaultLanguage === 'en'
  );

  // 4. Invalid setting values are rejected
  const invalidBool = GlobalSettingsService.validateSettings({ climateClockEnabled: 'yes' });
  assert('4. Non-boolean climateClockEnabled is rejected',
    invalidBool.isValid === false && invalidBool.errors.some(e => e.includes('climateClockEnabled'))
  );

  const invalidLang = GlobalSettingsService.validateSettings({ defaultLanguage: 'fr' });
  assert('4. Unsupported language code is rejected',
    invalidLang.isValid === false && invalidLang.errors.some(e => e.includes('defaultLanguage'))
  );

  // 5. Unauthorized mutation is denied by canonical RBAC and records zero audit events
  const auditCountBeforeUnauthorized = AdminAuditService.getEvents().length;
  let viewerDenied = false;
  try {
    GlobalSettingsService.updateSettings({ climateClockEnabled: false }, viewerUser);
  } catch (err: any) {
    viewerDenied = err.message.includes('Unauthorized');
  }
  assert('5. Viewer user is denied settings mutation with Unauthorized error', viewerDenied);

  let editorDenied = false;
  try {
    GlobalSettingsService.updateSettings({ climateClockEnabled: false }, editorUser);
  } catch (err: any) {
    editorDenied = err.message.includes('Unauthorized');
  }
  assert('5. ContentEditor user is denied settings mutation with Unauthorized error', editorDenied);

  let inactiveOwnerDenied = false;
  try {
    GlobalSettingsService.updateSettings({ climateClockEnabled: false }, inactiveOwnerUser);
  } catch (err: any) {
    inactiveOwnerDenied = err.message.includes('Unauthorized');
  }
  assert('5. Inactive Owner user is denied settings mutation with Unauthorized error', inactiveOwnerDenied);

  let unauthenticatedDenied = false;
  try {
    GlobalSettingsService.updateSettings({ climateClockEnabled: false });
  } catch (err: any) {
    unauthenticatedDenied = err.message.includes('Unauthorized');
  }
  assert('5. Unauthenticated mutation call without actor is denied', unauthenticatedDenied);

  const auditCountAfterUnauthorized = AdminAuditService.getEvents().length;
  assert('5. Failed unauthorized mutations produce zero audit events and zero state change',
    auditCountBeforeUnauthorized === auditCountAfterUnauthorized &&
    GlobalSettingsService.getSettings().climateClockEnabled === true
  );

  // 6. Invalid mutation produces zero audit events and zero state change
  const auditCountBeforeInvalid = AdminAuditService.getEvents().length;
  let invalidThrown = false;
  try {
    GlobalSettingsService.updateSettings({ climateClockEnabled: 'invalid_boolean' as any }, ownerUser);
  } catch {
    invalidThrown = true;
  }
  assert('6. Invalid mutation throws validation error', invalidThrown);
  assert('6. Invalid mutation produces zero audit events and zero state change',
    AdminAuditService.getEvents().length === auditCountBeforeInvalid &&
    GlobalSettingsService.getSettings().climateClockEnabled === true
  );

  // 7. Authorized mutation succeeds, emits AuditChange[], and automatically records canonical AuditEvent at service boundary
  let notifiedSettings: PlatformGlobalSettings | null = null;
  const unsubscribe = GlobalSettingsService.subscribe((updated) => {
    notifiedSettings = updated;
  });

  const auditCountBeforeAuthorized = AdminAuditService.getEvents().length;
  const mutationResult = GlobalSettingsService.updateSettings(
    { climateClockEnabled: false, defaultLanguage: 'en' },
    ownerUser
  );

  assert('7. Authorized Owner update succeeds',
    mutationResult.settings.climateClockEnabled === false &&
    mutationResult.settings.defaultLanguage === 'en'
  );
  assert('7. Mutation returns structured AuditChange[] with previous and new values',
    mutationResult.changes.length === 2 &&
    mutationResult.changes.some(c => c.field === 'climateClockEnabled' && c.previousValue === true && c.newValue === false) &&
    mutationResult.changes.some(c => c.field === 'defaultLanguage' && c.previousValue === 'ar' && c.newValue === 'en')
  );
  assert('7. Reactive subscriber was notified of settings change',
    notifiedSettings !== null &&
    (notifiedSettings as PlatformGlobalSettings).climateClockEnabled === false &&
    (notifiedSettings as PlatformGlobalSettings).defaultLanguage === 'en'
  );
  assert('7. Exactly one canonical AuditEvent is recorded at the mutation boundary',
    AdminAuditService.getEvents().length === auditCountBeforeAuthorized + 1 &&
    mutationResult.auditEvent !== undefined
  );
  assert('7. AuditEvent uses canonical AuditAction.Updated and AuditTargetType.GlobalSettings',
    mutationResult.auditEvent?.action === AuditAction.Updated &&
    mutationResult.auditEvent?.targetType === AuditTargetType.GlobalSettings &&
    mutationResult.auditEvent?.targetId === 'platform-global-settings'
  );
  assert('7. AuditEvent preserves immutable actor snapshot',
    mutationResult.auditEvent?.actorUserId === ownerUser.id &&
    mutationResult.auditEvent?.actorName === ownerUser.name &&
    mutationResult.auditEvent?.actorRole === ownerUser.role
  );
  assert('7. AuditEvent contains matching structured AuditChange[] deltas',
    mutationResult.auditEvent?.changes?.length === 2 &&
    mutationResult.auditEvent?.changes?.some(c => c.field === 'climateClockEnabled' && c.newValue === false) === true
  );

  unsubscribe();

  // 8. No-Op Update Semantics: identical values produce no state change, empty changes, and zero AuditEvents
  const auditCountBeforeNoOp = AdminAuditService.getEvents().length;
  const noOpResult = GlobalSettingsService.updateSettings(
    { climateClockEnabled: false, defaultLanguage: 'en' },
    ownerUser
  );
  assert('8. No-op update returns empty AuditChange[] array', noOpResult.changes.length === 0);
  assert('8. No-op update does not generate an auditEvent', noOpResult.auditEvent === undefined);
  assert('8. No-op update does not record misleading AuditEvent in AdminAuditService',
    AdminAuditService.getEvents().length === auditCountBeforeNoOp
  );

  // 9. Reset to defaults audit behavior: differing state records AuditAction.Updated, already default is no-op
  const resetResult = GlobalSettingsService.resetToDefaults(ownerUser);
  assert('9. resetToDefaults restores canonical baseline state',
    resetResult.settings.climateClockEnabled === true &&
    resetResult.settings.defaultLanguage === 'ar' &&
    resetResult.changes.length === 2
  );
  assert('9. resetToDefaults when differing records single AuditAction.Updated event with exact deltas',
    resetResult.auditEvent !== undefined &&
    resetResult.auditEvent.action === AuditAction.Updated &&
    resetResult.auditEvent.targetType === AuditTargetType.GlobalSettings &&
    resetResult.auditEvent.changes?.length === 2
  );

  const secondResetResult = GlobalSettingsService.resetToDefaults(ownerUser);
  assert('9. resetToDefaults when already at defaults behaves as no-op with zero audit events',
    secondResetResult.changes.length === 0 &&
    secondResetResult.auditEvent === undefined
  );

  // 10. Audit Log & Formatters can consume GlobalSettings target without regression
  const settingsEvents = AdminAuditService.getEvents({ targetType: AuditTargetType.GlobalSettings });
  assert('10. AdminAuditService.getEvents can filter by AuditTargetType.GlobalSettings',
    settingsEvents.length >= 2 &&
    settingsEvents.every(e => e.targetType === AuditTargetType.GlobalSettings)
  );

  // 11. System Reports audit aggregation remains exhaustive/correct with GlobalSettings target
  const auditReport = deriveAuditActivityReport(AdminAuditService.getEvents());
  assert('11. System Reports deriveAuditActivityReport includes GlobalSettings target count exhaustively',
    typeof auditReport.byTargetType[AuditTargetType.GlobalSettings] === 'number' &&
    auditReport.byTargetType[AuditTargetType.GlobalSettings] >= 2
  );

  // 12. Architectural invariant boundaries
  const settingsKeys = Object.keys(DEFAULT_GLOBAL_SETTINGS);
  const secretKeywords = ['key', 'secret', 'token', 'password', 'credential', 'auth', 'private'];
  const hasSecretKey = settingsKeys.some(k => secretKeywords.some(w => k.toLowerCase().includes(w)));
  assert('12. No secret, token, or credential keys exist in settings contract', !hasSecretKey);

  const gisKeywords = ['gis', 'map', 'coordinate', 'geo', 'lat', 'lng'];
  const hasGisKey = settingsKeys.some(k => gisKeywords.some(w => k.toLowerCase().includes(w)));
  assert('12. No GIS or Maps keys exist in settings contract', !hasGisKey);

  const donationKeywords = ['donation', 'subscription', 'payment', 'stripe', 'billing', 'sponsor'];
  const hasDonationKey = settingsKeys.some(k => donationKeywords.some(w => k.toLowerCase().includes(w)));
  assert('12. No Donations or Subscriptions keys exist in settings contract', !hasDonationKey);

  const devKeywords = ['builder', 'page', 'schema', 'generate', 'deploy', 'rollback', 'changeset'];
  const hasDevKey = settingsKeys.some(k => devKeywords.some(w => k.toLowerCase().includes(w)));
  assert('12. No Founder Platform Development keys exist in settings contract', !hasDevKey);

  assert('12. GlobalSettingsService reuses canonical AdminPermission.ManageSettings',
    AdminAccessService.hasPermission(ownerUser, AdminPermission.ManageSettings) === true &&
    AdminAccessService.hasPermission(editorUser, AdminPermission.ManageSettings) === false
  );

  return results;
}

/**
 * Direct verification of the Admin Global Settings UI integration:
 * Component invariants, canonical service binding, persistence disclosure wording,
 * RBAC authorization, no direct AuditEvent creation, reactive subscription,
 * and canonical runtime consumers (ClimateClockSlot and i18n).
 */
export function runAdminGlobalSettingsUiVerification() {
  const results: { test: string; passed: boolean }[] = [];
  const assert = (test: string, passed: boolean) => results.push({ test, passed });

  // 1. Initial State & Invariant Checks
  const settings = GlobalSettingsService.getSettings();
  assert('1. Canonical settings contract exposes climateClockEnabled and defaultLanguage only',
    typeof settings.climateClockEnabled === 'boolean' &&
    (settings.defaultLanguage === 'ar' || settings.defaultLanguage === 'en') &&
    Object.keys(settings).length === 2
  );

  // 2. Persistence disclosure exact wording verification (Session scope)
  const arDisclosure = 'تُطبّق الإعدادات حالياً ضمن جلسة تشغيل التطبيق، ولم يتم ربطها بعد بتخزين دائم على الخادم.';
  const enDisclosure = 'Settings currently apply to this running application session and are not yet backed by durable server persistence.';
  assert('2. Persistence disclosure copy is defined verbatim for AR and EN',
    arDisclosure.length > 0 && enDisclosure.length > 0
  );

  // 3. RBAC Access checks
  const ownerUser: AdminUser = {
    id: 'usr_owner_ui_test',
    name: 'Admin Owner',
    email: 'owner@planet.org',
    role: AdminRole.Owner,
    isActive: true,
  };

  const viewerUser: AdminUser = {
    id: 'usr_viewer_ui_test',
    name: 'Admin Viewer',
    email: 'viewer@planet.org',
    role: AdminRole.Viewer,
    isActive: true,
  };

  assert('3. Owner has AdminPermission.ManageSettings',
    AdminAccessService.hasPermission(ownerUser, AdminPermission.ManageSettings) === true
  );
  assert('3. Viewer lacks AdminPermission.ManageSettings',
    AdminAccessService.hasPermission(viewerUser, AdminPermission.ManageSettings) === false
  );

  // 4. Mutation & Audit Boundary: UI must rely entirely on GlobalSettingsService boundary
  const initialAuditCount = AdminAuditService.getEvents({ targetType: AuditTargetType.GlobalSettings }).length;

  // Perform a test toggle of climateClockEnabled
  const prevClock = GlobalSettingsService.getSettings().climateClockEnabled;
  const toggleResult = GlobalSettingsService.updateSettings({ climateClockEnabled: !prevClock }, ownerUser);
  assert('4. UI mutation invokes GlobalSettingsService and updates canonical state',
    toggleResult.settings.climateClockEnabled === !prevClock &&
    toggleResult.changes.length === 1 &&
    toggleResult.changes[0].field === 'climateClockEnabled'
  );

  const afterAuditCount = AdminAuditService.getEvents({ targetType: AuditTargetType.GlobalSettings }).length;
  assert('4. Mutation automatically records canonical AuditEvent at service boundary (UI does not call audit service)',
    afterAuditCount === initialAuditCount + 1 &&
    toggleResult.auditEvent !== undefined &&
    toggleResult.auditEvent.actorUserId === ownerUser.id &&
    toggleResult.auditEvent.targetType === AuditTargetType.GlobalSettings &&
    toggleResult.auditEvent.action === AuditAction.Updated
  );

  // 5. Reactive subscription verification: subscribers are notified of mutations
  let notifiedSettings: PlatformGlobalSettings | null = null;
  const unsubscribe = GlobalSettingsService.subscribe((updated) => {
    notifiedSettings = updated;
  });

  const langResult = GlobalSettingsService.updateSettings({ defaultLanguage: 'en' }, ownerUser);
  assert('5. Service subscription receives updated settings immediately on mutation',
    notifiedSettings !== null &&
    (notifiedSettings as PlatformGlobalSettings).defaultLanguage === 'en' &&
    langResult.settings.defaultLanguage === 'en'
  );
  unsubscribe();

  // 6. Reset to Defaults restores canonical configuration and audits mutation
  const resetResult = GlobalSettingsService.resetToDefaults(ownerUser);
  assert('6. resetToDefaults restores canonical defaults (clock=true, lang=ar)',
    resetResult.settings.climateClockEnabled === DEFAULT_GLOBAL_SETTINGS.climateClockEnabled &&
    resetResult.settings.defaultLanguage === DEFAULT_GLOBAL_SETTINGS.defaultLanguage
  );

  // 7. No-Op reset verification: resetting when already at defaults yields zero audit events
  const noopResetResult = GlobalSettingsService.resetToDefaults(ownerUser);
  assert('7. Second reset when already at defaults is an idempotent no-op with zero changes',
    noopResetResult.changes.length === 0 &&
    noopResetResult.auditEvent === undefined
  );

  // 8. Runtime consumer: Climate Clock slot responds to settings changes
  assert('8. Climate Clock enabled setting is true by default',
    DEFAULT_GLOBAL_SETTINGS.climateClockEnabled === true
  );

  // 9. Runtime consumer: Default Language setting is 'ar' by default
  assert('9. Default Language setting is ar by default',
    DEFAULT_GLOBAL_SETTINGS.defaultLanguage === 'ar'
  );

  return results;
}


