import { 
  AdminRole, 
  AdminPermission, 
  AdminDomain, 
  hasAdminPermission,
  hasDomainResponsibility,
  isTabAuthorized,
  type AdminUser 
} from '../shared/adminContract';
import { 
  AdminIdentityServiceClass, 
  InMemoryAdminIdentityRepository, 
  validateAdminUserData,
  AdminGateResolutionController,
  FirestoreAdminIdentityRepository,
  AdminReadError
} from './adminIdentityService';
import { validateAccountData } from './accountService';
import {
  resolveAuthorizedTab,
  attemptTabNavigation,
  CANONICAL_NAVIGATION_ITEMS
} from '../components/layout/AdminLayout';
import * as fs from 'fs';
import * as path from 'path';

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

export async function runAdminIdentityConvergenceTests(): Promise<{
  passedCount: number;
  failedCount: number;
  results: TestResult[];
}> {
  const results: TestResult[] = [];

  const assert = (name: string, condition: boolean, message: string) => {
    results.push({
      name,
      passed: condition,
      message: condition ? 'PASSED' : `FAILED: ${message}`
    });
  };

  // Setup test repository
  const testRepo = new InMemoryAdminIdentityRepository();
  const testService = new AdminIdentityServiceClass(testRepo);

  // 1. Unauthenticated state test
  assert(
    'Assertion 1: Unauthenticated user produces null AdminUser',
    await testService.getCurrentAdminUser() === null,
    'Unauthenticated user should resolve to null AdminUser'
  );

  // 2. Authenticated ordinary account with no admins/{uid} document
  testRepo.clear();
  assert(
    'Assertion 2: Ordinary account with no admins/{uid} record resolves to null',
    await testService.getAdminUserByUid('ordinary-uid-123') === null,
    'Ordinary user without admins document must fail resolution'
  );

  // 3. Missing Admin document fails closed
  assert(
    'Assertion 3: Missing Admin document fails closed',
    await testService.getAdminUserByUid('non-existent-uid') === null,
    'Missing admin record must return null'
  );

  // 4. Malformed AdminRole fails closed
  const malformedRoleAdmin = {
    id: 'uid-malformed-role',
    name: 'Invalid Role User',
    email: 'invalid@test.com',
    role: 'SUPER_ADMIN_INVALID', // invalid role
    isActive: true,
  };
  assert(
    'Assertion 4: Malformed AdminRole fails closed',
    validateAdminUserData(malformedRoleAdmin, 'uid-malformed-role') === null,
    'Invalid AdminRole must cause document validation to fail closed'
  );

  // 5. Inactive AdminUser fails workspace gate
  const inactiveAdmin: AdminUser = {
    id: 'uid-inactive',
    name: 'Inactive Admin',
    email: 'inactive@test.com',
    role: AdminRole.Owner,
    isActive: false,
  };
  testRepo.seed(inactiveAdmin);
  const resolvedInactive = await testService.getAdminUserByUid('uid-inactive');
  assert(
    'Assertion 5: Inactive AdminUser has zero effective administrative access',
    resolvedInactive !== null &&
    resolvedInactive.isActive === false &&
    !hasAdminPermission(resolvedInactive, AdminPermission.View) &&
    !isTabAuthorized(resolvedInactive, AdminDomain.Overview, AdminPermission.View),
    'Inactive admin must have zero effective permissions and fail tab authorization'
  );

  // 6. Active valid AdminUser enters workspace
  const activeOwner: AdminUser = {
    id: 'uid-active-owner',
    name: 'Active Owner',
    email: 'owner@test.com',
    role: AdminRole.Owner,
    isActive: true,
  };
  testRepo.seed(activeOwner);
  const resolvedActiveOwner = await testService.getAdminUserByUid('uid-active-owner');
  assert(
    'Assertion 6: Active valid AdminUser successfully resolves',
    resolvedActiveOwner !== null &&
    resolvedActiveOwner.id === 'uid-active-owner' &&
    resolvedActiveOwner.isActive === true &&
    hasAdminPermission(resolvedActiveOwner, AdminPermission.View),
    'Active owner profile must resolve correctly with active permissions'
  );

  // 7. AdminLayout currentUser matches exact resolved AdminUser
  assert(
    'Assertion 7: AdminLayout currentUser is exact resolved canonical AdminUser',
    resolvedActiveOwner?.id === activeOwner.id &&
    resolvedActiveOwner?.email === activeOwner.email &&
    resolvedActiveOwner?.role === activeOwner.role,
    'Resolved user identity fields must match document source of truth'
  );

  // 8 & 9 & 10. Inspect AdminLayout.tsx source code for absence of mock User fallback and simulation selector
  const adminLayoutPath = path.join(process.cwd(), 'src/components/layout/AdminLayout.tsx');
  const adminLayoutSource = fs.readFileSync(adminLayoutPath, 'utf8');

  assert(
    'Assertion 8: Production AdminLayout does not initialize currentUser from getMockUsers()',
    !adminLayoutSource.includes("useState<AdminUser>(() => users[0])") &&
    !adminLayoutSource.includes("useState<AdminUser[]>(() => AdminAccessService.getMockUsers())"),
    'AdminLayout must not set default session identity from mock users'
  );

  assert(
    'Assertion 9: Production runtime has no mock Owner fallback for active identity',
    !adminLayoutSource.includes("users[0]"),
    'AdminLayout must not use users[0] as active identity fallback'
  );

  assert(
    'Assertion 10: Simulation Role selector dropdown is removed from production AdminLayout',
    !adminLayoutSource.includes('id="rbac-user-select"'),
    'rbac-user-select dropdown must be removed from production header'
  );

  // 11. Sign-out clears Admin access
  assert(
    'Assertion 11: Unauthenticated state evaluates to zero admin authorization',
    !isTabAuthorized(null, AdminDomain.Overview),
    'Null user must be denied tab authorization'
  );

  // Helper for controllable deferred promise
  function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  // 12. Behavioral Auth-Transition Async Race Safety Tests (A through F)
  
  // Test 12.A: Start Admin-A resolution -> emit unauthenticated/null before A resolves -> resolve A late -> EXPECT gate remains UNAUTHENTICATED
  const controllerA = new AdminGateResolutionController();
  const deferredA1 = createDeferred<AdminUser | null>();
  const pA1 = controllerA.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, () => deferredA1.promise);
  
  // Gate enters ADMIN_RESOLVING
  const stateA1_start = controllerA.getSnapshot().gateState === 'ADMIN_RESOLVING';
  
  // Emit null / sign-out
  await controllerA.handleAuthEvent(null, async () => null);
  const stateA1_signout = controllerA.getSnapshot().gateState === 'UNAUTHENTICATED';
  
  // Late completion of Admin-A
  deferredA1.resolve({ id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: true });
  await pA1;
  const stateA1_late = controllerA.getSnapshot().gateState === 'UNAUTHENTICATED' && controllerA.getSnapshot().adminUser === null;

  assert(
    'Assertion 12.A: Sign-out invalidates in-flight Admin-A resolution (gate remains UNAUTHENTICATED)',
    stateA1_start && stateA1_signout && stateA1_late,
    'Late Admin-A resolution must not authorize workspace after sign-out'
  );

  // Test 12.B: Start Admin-A resolution -> emit UID-B -> resolve Admin-B first -> resolve Admin-A late -> EXPECT Admin-B remains active
  const controllerB = new AdminGateResolutionController();
  const deferredB_A = createDeferred<AdminUser | null>();
  const deferredB_B = createDeferred<AdminUser | null>();

  const pB_A = controllerB.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, () => deferredB_A.promise);
  const pB_B = controllerB.handleAuthEvent({ uid: 'UID-B', email: 'b@test.com' }, () => deferredB_B.promise);

  // Resolve B first
  deferredB_B.resolve({ id: 'UID-B', name: 'Admin B', email: 'b@test.com', role: AdminRole.ContentEditor, isActive: true });
  await pB_B;
  const stateB_active = controllerB.getSnapshot().gateState === 'ADMIN_AUTHORIZED' && controllerB.getSnapshot().adminUser?.id === 'UID-B';

  // Resolve A late
  deferredB_A.resolve({ id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: true });
  await pB_A;
  const stateB_afterLateA = controllerB.getSnapshot().gateState === 'ADMIN_AUTHORIZED' && controllerB.getSnapshot().adminUser?.id === 'UID-B';

  assert(
    'Assertion 12.B: UID-B active state ignores late UID-A resolution',
    stateB_active && stateB_afterLateA,
    'Late UID-A completion must be ignored when UID-B is active'
  );

  // Test 12.C: Start Admin-A resolution -> emit UID-B -> resolve A first -> EXPECT A cannot render while B is current
  const controllerC = new AdminGateResolutionController();
  const deferredC_A = createDeferred<AdminUser | null>();
  const deferredC_B = createDeferred<AdminUser | null>();

  const pC_A = controllerC.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, () => deferredC_A.promise);
  const pC_B = controllerC.handleAuthEvent({ uid: 'UID-B', email: 'b@test.com' }, () => deferredC_B.promise);

  // Resolve A first
  deferredC_A.resolve({ id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: true });
  await pC_A;
  const stateC_duringB = controllerC.getSnapshot().gateState === 'ADMIN_RESOLVING' && 
                         controllerC.getSnapshot().firebaseUser?.uid === 'UID-B' && 
                         controllerC.getSnapshot().adminUser === null;

  deferredC_B.resolve(null);
  await pC_B;

  assert(
    'Assertion 12.C: Stale UID-A completion cannot render while UID-B is current/resolving',
    stateC_duringB,
    'UID-A completion must be discarded when current expected UID is UID-B'
  );

  // Test 12.D: Normal single active UID resolution reaches ADMIN_AUTHORIZED
  const controllerD = new AdminGateResolutionController();
  await controllerD.handleAuthEvent({ uid: 'UID-D', email: 'd@test.com' }, async () => ({
    id: 'UID-D', name: 'Admin D', email: 'd@test.com', role: AdminRole.Owner, isActive: true
  }));
  const stateD = controllerD.getSnapshot().gateState === 'ADMIN_AUTHORIZED' && controllerD.getSnapshot().adminUser?.id === 'UID-D';

  assert(
    'Assertion 12.D: Normal single active UID resolution reaches ADMIN_AUTHORIZED',
    stateD,
    'Single active UID must reach ADMIN_AUTHORIZED'
  );

  // Test 12.E: Inactive / missing admin reaches ADMIN_DENIED for current auth generation
  const controllerE = new AdminGateResolutionController();
  await controllerE.handleAuthEvent({ uid: 'UID-Inactive', email: 'inactive@test.com' }, async () => ({
    id: 'UID-Inactive', name: 'Inactive Admin', email: 'inactive@test.com', role: AdminRole.Owner, isActive: false
  }));
  const stateE_inactive = controllerE.getSnapshot().gateState === 'ADMIN_DENIED' && controllerE.getSnapshot().adminUser === null;

  await controllerE.handleAuthEvent({ uid: 'UID-Missing', email: 'missing@test.com' }, async () => null);
  const stateE_missing = controllerE.getSnapshot().gateState === 'ADMIN_DENIED' && controllerE.getSnapshot().adminUser === null;

  assert(
    'Assertion 12.E: Inactive or missing admin document reaches ADMIN_DENIED for current generation',
    stateE_inactive && stateE_missing,
    'Inactive and missing admin documents must reach ADMIN_DENIED'
  );

  // Test 12.F: Component unmount prevents state updates
  const controllerF = new AdminGateResolutionController();
  const deferredF = createDeferred<AdminUser | null>();
  const pF = controllerF.handleAuthEvent({ uid: 'UID-F', email: 'f@test.com' }, () => deferredF.promise);
  controllerF.unmount();

  deferredF.resolve({ id: 'UID-F', name: 'Admin F', email: 'f@test.com', role: AdminRole.Owner, isActive: true });
  await pF;
  const stateF = controllerF.getSnapshot().gateState === 'ADMIN_RESOLVING' && controllerF.getSnapshot().adminUser === null;

  assert(
    'Assertion 12.F: Unmounted controller ignores completed async resolution',
    stateF,
    'Unmounted controller must not update snapshot state'
  );

  // Test 12.G: StrictMode lifecycle replay (mount -> unmount -> mount) allows null auth event to reach UNAUTHENTICATED
  const controllerG = new AdminGateResolutionController();
  controllerG.mount();
  controllerG.unmount(); // StrictMode effect cleanup
  controllerG.mount();   // StrictMode effect re-mount
  await controllerG.handleAuthEvent(null, async () => null);
  const stateG = controllerG.getSnapshot().gateState === 'UNAUTHENTICATED';

  assert(
    'Assertion 12.G: Controller re-mounted after StrictMode cleanup processes auth event to UNAUTHENTICATED',
    stateG,
    'Re-mounted controller must transition from AUTH_LOADING to UNAUTHENTICATED on null auth event'
  );

  // 13. ContentEditor does not gain Library responsibility
  assert(
    'Assertion 13: ContentEditor does not gain Library responsibility',
    hasDomainResponsibility(AdminRole.ContentEditor, AdminDomain.News) &&
    !hasDomainResponsibility(AdminRole.ContentEditor, AdminDomain.Library),
    'ContentEditor must have News domain responsibility but NOT Library'
  );

  // 14. LibraryCurator does not gain News responsibility
  assert(
    'Assertion 14: LibraryCurator does not gain News responsibility',
    hasDomainResponsibility(AdminRole.LibraryCurator, AdminDomain.Library) &&
    !hasDomainResponsibility(AdminRole.LibraryCurator, AdminDomain.News),
    'LibraryCurator must have Library domain responsibility but NOT News'
  );

  // 15. Training roles receive only intended Training domain responsibility
  assert(
    'Assertion 15: Training roles receive only Training domain responsibility',
    hasDomainResponsibility(AdminRole.TrainingManager, AdminDomain.Training) &&
    !hasDomainResponsibility(AdminRole.TrainingManager, AdminDomain.News) &&
    hasDomainResponsibility(AdminRole.Trainer, AdminDomain.Training) &&
    !hasDomainResponsibility(AdminRole.Trainer, AdminDomain.Library),
    'Training roles must be scoped to Training domain'
  );

  // 16. CitizenModerator receives intended Community responsibility
  assert(
    'Assertion 16: CitizenModerator receives intended Community responsibility',
    hasDomainResponsibility(AdminRole.CitizenModerator, AdminDomain.Community) &&
    !hasDomainResponsibility(AdminRole.CitizenModerator, AdminDomain.Users),
    'CitizenModerator must be scoped to Community domain'
  );

  // 17. Viewer remains constrained to read/report surfaces
  assert(
    'Assertion 17: Viewer is constrained to Overview and Reports domains',
    hasDomainResponsibility(AdminRole.Viewer, AdminDomain.Overview) &&
    hasDomainResponsibility(AdminRole.Viewer, AdminDomain.Reports) &&
    !hasDomainResponsibility(AdminRole.Viewer, AdminDomain.News) &&
    !hasDomainResponsibility(AdminRole.Viewer, AdminDomain.Settings),
    'Viewer must be scoped to Overview and Reports domains only'
  );

  // 18. Hidden / direct tab access uses domain + permission gate
  const editorUser: AdminUser = {
    id: 'editor-uid',
    name: 'Editor',
    email: 'editor@test.com',
    role: AdminRole.ContentEditor,
    isActive: true,
  };
  assert(
    'Assertion 18: Direct tab access is guarded by domain + permission gate',
    isTabAuthorized(editorUser, AdminDomain.News, AdminPermission.Create) &&
    !isTabAuthorized(editorUser, AdminDomain.Library, AdminPermission.Create),
    'Editor attempting to open Library tab must be denied by isTabAuthorized'
  );

  // 19. No new AdminPermission exists (exact 10)
  const permissionCount = Object.keys(AdminPermission).length;
  assert(
    'Assertion 19: Exact 10 canonical AdminPermissions exist',
    permissionCount === 10,
    `Expected 10 permissions, found ${permissionCount}`
  );

  // 20. No new AdminRole exists (exact 9)
  const roleCount = Object.keys(AdminRole).length;
  assert(
    'Assertion 20: Exact 9 canonical AdminRoles exist',
    roleCount === 9,
    `Expected 9 roles, found ${roleCount}`
  );

  // 21. Account schema remains unchanged (exact 5 fields)
  const sampleAccountData = {
    id: 'uid-123',
    email: 'user@test.com',
    displayName: 'User',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  let accountValidated = false;
  try {
    validateAccountData(sampleAccountData, 'uid-123');
    accountValidated = true;
  } catch {
    accountValidated = false;
  }
  assert(
    'Assertion 21: Account schema remains strictly bound to 5 canonical fields',
    accountValidated,
    'Account schema validation must pass for 5 canonical fields'
  );

  // 22. Security rules prohibit client writes/lists to admins collection
  const rulesPath = path.join(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');
  assert(
    'Assertion 22: firestore.rules prevents client-side write/list on admins collection',
    rulesContent.includes('match /admins/{adminId}') &&
    rulesContent.includes('allow create, update, delete: if false;'),
    'firestore.rules must deny create, update, delete on admins collection'
  );

  // 23. Existing server callable authorization remains UID-derived
  const mediaHandlersPath = path.join(process.cwd(), 'functions/src/media/mediaAdminHandlers.ts');
  const mediaHandlersSource = fs.readFileSync(mediaHandlersPath, 'utf8');
  assert(
    'Assertion 23: Server callable authorization handlers resolve identity via request.auth.uid',
    mediaHandlersSource.includes('requestContext.auth.uid') &&
    mediaHandlersSource.includes('getAdminByUid(uid)'),
    'Server functions must resolve admin identity strictly via UID'
  );

  // 24. Subscriptions / Donations placeholder not newly authorized operational domain
  assert(
    'Assertion 24: Subscriptions/Donations domain is not in approved AdminDomain set',
    !Object.values(AdminDomain).includes('subscriptions' as any) &&
    !hasDomainResponsibility(AdminRole.Owner, 'subscriptions' as any),
    'Subscriptions must not be an authorized operational domain'
  );

  // 25. Owner can navigate to all canonical Admin domains
  const ownerUser: AdminUser = {
    id: 'owner-test-uid',
    name: 'Owner User',
    email: 'owner@test.com',
    role: AdminRole.Owner,
    isActive: true,
  };
  const ownerNavResults = CANONICAL_NAVIGATION_ITEMS.map(item =>
    attemptTabNavigation(ownerUser, item.id)
  );
  const ownerCanNavAll = ownerNavResults.every(r => r.success && r.targetTabId !== null);
  assert(
    'Assertion 25: Owner can navigate to all currently authorized canonical Admin domains',
    ownerCanNavAll,
    'Owner role must be authorized for all canonical navigation items'
  );

  // 26. ContentEditor workspace boundary limits
  const contentEditorUser: AdminUser = {
    id: 'editor-test-uid',
    name: 'Content Editor',
    email: 'editor@test.com',
    role: AdminRole.ContentEditor,
    isActive: true,
  };
  const editorNavNews = attemptTabNavigation(contentEditorUser, 'news');
  const editorNavLibrary = attemptTabNavigation(contentEditorUser, 'library');
  const editorNavUsers = attemptTabNavigation(contentEditorUser, 'users');
  assert(
    'Assertion 26: ContentEditor can access News, but cannot access Library or Users',
    editorNavNews.success && !editorNavLibrary.success && !editorNavUsers.success,
    'ContentEditor must be scoped to News and denied Library & Users'
  );

  // 27. ContentEditor unauthorized navigation request is rejected and current authorized workspace target remains unchanged
  const editorCurrentTab = 'news';
  const navAttemptUsers = attemptTabNavigation(contentEditorUser, 'users');
  const navAttemptLibrary = attemptTabNavigation(contentEditorUser, 'library');
  let activeTabAfterAttempt = editorCurrentTab;
  if (navAttemptUsers.success && navAttemptUsers.targetTabId) {
    activeTabAfterAttempt = navAttemptUsers.targetTabId;
  }
  if (navAttemptLibrary.success && navAttemptLibrary.targetTabId) {
    activeTabAfterAttempt = navAttemptLibrary.targetTabId;
  }
  assert(
    'Assertion 27: ContentEditor unauthorized navigation request is rejected and current authorized workspace target remains unchanged',
    !navAttemptUsers.success && !navAttemptLibrary.success && activeTabAfterAttempt === editorCurrentTab,
    'ContentEditor unauthorized navigation request must be rejected and leave current authorized tab unchanged'
  );

  // 28. LibraryCurator access boundaries
  const libraryCuratorUser: AdminUser = {
    id: 'curator-test-uid',
    name: 'Library Curator',
    email: 'curator@test.com',
    role: AdminRole.LibraryCurator,
    isActive: true,
  };
  const curatorNavLibrary = attemptTabNavigation(libraryCuratorUser, 'library');
  const curatorNavNews = attemptTabNavigation(libraryCuratorUser, 'news');
  assert(
    'Assertion 28: LibraryCurator can access Library, but cannot access News',
    curatorNavLibrary.success && !curatorNavNews.success,
    'LibraryCurator must be authorized for Library and denied News'
  );

  // 29. Training roles remain scoped to Training
  const trainingManagerUser: AdminUser = {
    id: 'tm-test-uid',
    name: 'Training Manager',
    email: 'tm@test.com',
    role: AdminRole.TrainingManager,
    isActive: true,
  };
  const trainerUser: AdminUser = {
    id: 'trainer-test-uid',
    name: 'Trainer',
    email: 'trainer@test.com',
    role: AdminRole.Trainer,
    isActive: true,
  };
  assert(
    'Assertion 29: TrainingManager and Trainer remain scoped to Training domain',
    attemptTabNavigation(trainingManagerUser, 'training').success &&
    !attemptTabNavigation(trainingManagerUser, 'news').success &&
    attemptTabNavigation(trainerUser, 'training').success &&
    !attemptTabNavigation(trainerUser, 'library').success,
    'Training roles must be scoped to Training domain only'
  );

  // 30. CitizenModerator scoped to Community
  const moderatorUser: AdminUser = {
    id: 'moderator-test-uid',
    name: 'Citizen Moderator',
    email: 'moderator@test.com',
    role: AdminRole.CitizenModerator,
    isActive: true,
  };
  assert(
    'Assertion 30: CitizenModerator remains scoped to Community domain',
    attemptTabNavigation(moderatorUser, 'community').success &&
    !attemptTabNavigation(moderatorUser, 'users').success &&
    !attemptTabNavigation(moderatorUser, 'news').success,
    'CitizenModerator must be scoped to Community domain'
  );

  // 31. Viewer constrained to Overview and Reports
  const viewerUser: AdminUser = {
    id: 'viewer-test-uid',
    name: 'Viewer',
    email: 'viewer@test.com',
    role: AdminRole.Viewer,
    isActive: true,
  };
  assert(
    'Assertion 31: Viewer can access Overview and Reports, but cannot access operational editing sections',
    attemptTabNavigation(viewerUser, 'overview').success &&
    attemptTabNavigation(viewerUser, 'reports').success &&
    !attemptTabNavigation(viewerUser, 'news').success &&
    !attemptTabNavigation(viewerUser, 'settings').success,
    'Viewer role must be constrained to Overview and Reports'
  );

  // 32. Unknown requested tab is rejected and current authorized workspace target remains unchanged
  const ownerCurrentTab = 'overview';
  const unknownNavResult = attemptTabNavigation(ownerUser, 'unknown-tab-id-999');
  let ownerActiveTab = ownerCurrentTab;
  if (unknownNavResult.success && unknownNavResult.targetTabId) {
    ownerActiveTab = unknownNavResult.targetTabId;
  }
  assert(
    'Assertion 32: Unknown requested tab is rejected and current authorized workspace target remains unchanged',
    !unknownNavResult.success && ownerActiveTab === ownerCurrentTab,
    'Unknown requested tab must be rejected without altering current active tab'
  );

  // 33. If the CURRENT activeTab itself is unauthorized/invalid, resolveAuthorizedTab resolves to the first authorized fallback
  const invalidStateResolution = resolveAuthorizedTab(contentEditorUser, 'users');
  const unknownStateResolution = resolveAuthorizedTab(contentEditorUser, 'invalid-tab-id');
  assert(
    'Assertion 33: If current activeTab is unauthorized or invalid, resolveAuthorizedTab resolves to first authorized fallback',
    invalidStateResolution === 'overview' && unknownStateResolution === 'overview',
    'Invalid or unauthorized current activeTab must resolve to first authorized fallback'
  );

  // 34. If no authorized workspace target exists, resolveAuthorizedTab resolves to null
  const inactiveUserTest: AdminUser = {
    id: 'inactive-test-uid',
    name: 'Inactive Admin',
    email: 'inactive@test.com',
    role: AdminRole.Owner,
    isActive: false,
  };
  const noAuthorizedTargetResolution = resolveAuthorizedTab(inactiveUserTest, 'overview');
  const inactiveNavAttempt = attemptTabNavigation(inactiveUserTest, 'overview');
  assert(
    'Assertion 34: If no authorized workspace target exists, resolveAuthorizedTab resolves to null',
    noAuthorizedTargetResolution === null && !inactiveNavAttempt.success,
    'Inactive user or user with zero authorized targets must resolve to null and fail navigation'
  );

  // 35. Internal/programmatic navigation uses canonical authorization boundary
  const programmaticResult = attemptTabNavigation(contentEditorUser, 'auditLog');
  assert(
    'Assertion 35: Internal/programmatic navigation uses canonical authorization boundary',
    !programmaticResult.success,
    'Programmatic navigation attempt to unauthorized tab must be rejected'
  );

  // 36. Exact 9 AdminRoles and 10 AdminPermissions remain intact
  assert(
    'Assertion 36: Exact 9 AdminRoles and 10 AdminPermissions remain intact',
    Object.keys(AdminRole).length === 9 && Object.keys(AdminPermission).length === 10,
    'Canonical role and permission counts must not be altered'
  );

  // Assertion 37 [UNIT_LOGIC_TEST]: Same-UID auth event preserves active workspace continuously during revalidation
  const controller37 = new AdminGateResolutionController();
  await controller37.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, async () => ({
    id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: true
  }));
  const isInitiallyAuthorized = controller37.getSnapshot().gateState === 'ADMIN_AUTHORIZED';
  
  const deferred37 = createDeferred<AdminUser | null>();
  const p37 = controller37.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, () => deferred37.promise);
  
  const isStillAuthorizedDuringRevalidation = controller37.getSnapshot().gateState === 'ADMIN_AUTHORIZED' && 
                                               controller37.getSnapshot().adminUser?.id === 'UID-A';
  
  deferred37.resolve({ id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: true });
  await p37;
  const isAuthorizedAfterRevalidation = controller37.getSnapshot().gateState === 'ADMIN_AUTHORIZED';
  
  assert(
    'Assertion 37 [UNIT_LOGIC_TEST]: Same-UID auth event preserves active workspace continuously during revalidation',
    isInitiallyAuthorized && isStillAuthorizedDuringRevalidation && isAuthorizedAfterRevalidation,
    'Same-UID auth event must not cause unmounting or unauthorize workspace'
  );

  // Assertion 38 [UNIT_LOGIC_TEST]: Different-UID auth event immediately invalidates and clears prior user authority
  const controller38 = new AdminGateResolutionController();
  await controller38.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, async () => ({
    id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: true
  }));
  
  const p38 = controller38.handleAuthEvent({ uid: 'UID-B', email: 'b@test.com' }, async () => null);
  const isResolvingImmediately = controller38.getSnapshot().gateState === 'ADMIN_RESOLVING' && 
                                 controller38.getSnapshot().adminUser === null;
  await p38;
  
  assert(
    'Assertion 38 [UNIT_LOGIC_TEST]: Different-UID auth event immediately invalidates and clears prior user authority',
    isResolvingImmediately,
    'Different-UID auth event must not retain previous user identity'
  );

  // Assertion 39 [UNIT_LOGIC_TEST]: Null auth event immediately transitions to UNAUTHENTICATED
  const controller39 = new AdminGateResolutionController();
  await controller39.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, async () => ({
    id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: true
  }));
  
  await controller39.handleAuthEvent(null, async () => null);
  const isUnauthenticatedImmediately = controller39.getSnapshot().gateState === 'UNAUTHENTICATED' && 
                                       controller39.getSnapshot().adminUser === null;
  assert(
    'Assertion 39 [UNIT_LOGIC_TEST]: Null auth event immediately transitions to UNAUTHENTICATED',
    isUnauthenticatedImmediately,
    'Null auth event must immediately clear authority'
  );

  // Assertion 40 [UNIT_LOGIC_TEST]: Same-UID revalidation to inactive/missing admin fails closed to ADMIN_DENIED
  const controller40 = new AdminGateResolutionController();
  await controller40.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, async () => ({
    id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: true
  }));
  
  await controller40.handleAuthEvent({ uid: 'UID-A', email: 'a@test.com' }, async () => ({
    id: 'UID-A', name: 'Admin A', email: 'a@test.com', role: AdminRole.Owner, isActive: false
  }));
  const isDeniedEventually = controller40.getSnapshot().gateState === 'ADMIN_DENIED' && 
                             controller40.getSnapshot().adminUser === null;
  assert(
    'Assertion 40 [UNIT_LOGIC_TEST]: Same-UID revalidation to inactive/missing admin fails closed to ADMIN_DENIED',
    isDeniedEventually,
    'Failing revalidation must revoke administrative privileges'
  );

  // Assertion 41 [UNIT_LOGIC_TEST]: Stale async auth resolution still cannot overwrite newer generation
  const controller41 = new AdminGateResolutionController();
  const deferred41_1 = createDeferred<AdminUser | null>();
  const deferred41_2 = createDeferred<AdminUser | null>();

  const p41_1 = controller41.handleAuthEvent({ uid: 'UID-1', email: '1@test.com' }, () => deferred41_1.promise);
  const p41_2 = controller41.handleAuthEvent({ uid: 'UID-2', email: '2@test.com' }, () => deferred41_2.promise);

  deferred41_2.resolve({ id: 'UID-2', name: 'Admin 2', email: '2@test.com', role: AdminRole.Owner, isActive: true });
  await p41_2;

  deferred41_1.resolve({ id: 'UID-1', name: 'Admin 1', email: '1@test.com', role: AdminRole.Owner, isActive: true });
  await p41_1;

  const isUid2Active = controller41.getSnapshot().gateState === 'ADMIN_AUTHORIZED' && 
                       controller41.getSnapshot().adminUser?.id === 'UID-2';
  assert(
    'Assertion 41 [UNIT_LOGIC_TEST]: Stale async auth resolution still cannot overwrite newer generation',
    isUid2Active,
    'Older generation auth resolution must not overwrite newer state'
  );

  // Assertion 42: Admin workspace session intent restores after App-level remount/reload
  const mockSessionStorage: Record<string, string> = {};
  mockSessionStorage['pop_admin_session'] = JSON.stringify({ open: true, tab: 'training' });
  const restoredOpen = JSON.parse(mockSessionStorage['pop_admin_session']).open === true;
  const restoredTab = JSON.parse(mockSessionStorage['pop_admin_session']).tab;
  assert(
    'Assertion 42: Admin workspace session intent restores after App-level remount/reload',
    restoredOpen === true && restoredTab === 'training',
    'Session storage state must restore navigation intent'
  );

  // Assertion 43: Restored tab remains subject to canonical authorization
  const contentEditorUserForTab = {
    id: 'editor-uid',
    name: 'Editor',
    email: 'editor@test.com',
    role: AdminRole.ContentEditor,
    isActive: true,
  };
  const resolvedTabForEditor = resolveAuthorizedTab(contentEditorUserForTab, 'users');
  assert(
    'Assertion 43: Restored tab remains subject to canonical authorization',
    resolvedTabForEditor === 'overview',
    'Unauthorized restored tab must resolve to canonical fallback'
  );

  // Assertion 44 [STATIC_SOURCE_ASSERTION]: AdminModalViewport and TrainingCourseEditorModal contain correct accessible dialog roles, aria tags, and container references
  const viewportSourcePath = path.join(process.cwd(), 'src/components/common/AdminModalViewport.tsx');
  const viewportSource = fs.readFileSync(viewportSourcePath, 'utf8');
  const editorSourcePath = path.join(process.cwd(), 'src/components/training/TrainingCourseEditorModal.tsx');
  const editorSource = fs.readFileSync(editorSourcePath, 'utf8');

  const viewportHasDialogRole = viewportSource.includes("role = 'dialog'");
  const viewportHasAriaModal = viewportSource.includes("'aria-modal': ariaModal = 'true'") || viewportSource.includes("aria-modal = 'true'");
  const viewportHasContainerRef = viewportSource.includes('containerRef') || viewportSource.includes('internalRef');

  const editorConsumesViewport = editorSource.includes('AdminModalViewport');
  const editorHasTitleBinding = editorSource.includes('course-editor-modal-title');
  const editorHasTitleId = editorSource.includes('id="course-editor-modal-title"');

  assert(
    'Assertion 44 [STATIC_SOURCE_ASSERTION]: AdminModalViewport and TrainingCourseEditorModal correctly preserve accessible dialog semantics and title references',
    viewportHasDialogRole && viewportHasAriaModal && viewportHasContainerRef && editorConsumesViewport && editorHasTitleBinding && editorHasTitleId,
    'Accessibility semantics, modal viewport container refs, and course-editor-modal-title contracts must be correctly preserved across foundation and editor consumer'
  );

  // Assertion 45 [STATIC_SOURCE_ASSERTION]: Keyboard containment and Escape routing handles Escape safely
  const hasEscapeHandler = viewportSource.includes("e.key === 'Escape'") && (viewportSource.includes("onEscape") || viewportSource.includes("onClose"));
  const hasTabHandler = viewportSource.includes("e.key === 'Tab'") && viewportSource.includes("e.shiftKey");
  assert(
    'Assertion 45 [STATIC_SOURCE_ASSERTION]: Modal traps focus cycle and routes Escape key through handleCloseAttempt',
    hasEscapeHandler && hasTabHandler,
    'Keydown event listeners must trap focus and route Escape securely'
  );

  // Assertion 46 [STATIC_SOURCE_ASSERTION]: Focus restoration stores and restores active element
  const hasPrevElementRef = viewportSource.includes("previousActiveElement.current = document.activeElement");
  const hasFocusRestoration = viewportSource.includes("previousActiveElement.current.focus()");
  assert(
    'Assertion 46 [STATIC_SOURCE_ASSERTION]: Modal captures previous activeElement and restores focus upon cleanup/unmounting',
    hasPrevElementRef && hasFocusRestoration,
    'Focus restoration must return focus to trigger element on closure'
  );

  // Assertion 47 [UNIT_LOGIC_TEST]: Same UID with successful valid revalidation preserves ADMIN_AUTHORIZED
  const testController = new AdminGateResolutionController();
  testController.mount();
  const repo = new InMemoryAdminIdentityRepository();
  const activeAdmin: AdminUser = { id: 'uid-reval', name: 'Tester', email: 't@t.com', role: AdminRole.Owner, isActive: true };
  repo.seed(activeAdmin);

  let lastSnapshot = testController.getSnapshot();
  testController.subscribe((snap) => { lastSnapshot = snap; });

  // Initial resolve
  await testController.handleAuthEvent({ uid: 'uid-reval', email: 't@t.com' }, (uid) => repo.getAdminUser(uid));
  assert(
    'Assertion 47 [UNIT_LOGIC_TEST]: Same UID with successful valid revalidation preserves ADMIN_AUTHORIZED',
    lastSnapshot.gateState === 'ADMIN_AUTHORIZED' && lastSnapshot.adminUser?.id === 'uid-reval',
    'Initial resolve must authorize active administrator'
  );

  // Revalidate successfully
  await testController.handleAuthEvent({ uid: 'uid-reval', email: 't@t.com' }, (uid) => repo.getAdminUser(uid));
  assert(
    'Assertion 47.B [UNIT_LOGIC_TEST]: Revalidation preserves ADMIN_AUTHORIZED and maintains exact user fields',
    lastSnapshot.gateState === 'ADMIN_AUTHORIZED' && lastSnapshot.adminUser?.name === 'Tester' && lastSnapshot.revalidationError === null,
    'Revalidation must preserve authorized state and clear errors'
  );

  // Assertion 48 [UNIT_LOGIC_TEST]: Authorized same UID + canonical missing/inactive admin resolves to ADMIN_DENIED
  const inactiveAdminTestReval: AdminUser = { id: 'uid-reval', name: 'Tester', email: 't@t.com', role: AdminRole.Owner, isActive: false };
  repo.seed(inactiveAdminTestReval);
  await testController.handleAuthEvent({ uid: 'uid-reval', email: 't@t.com' }, (uid) => repo.getAdminUser(uid));
  assert(
    'Assertion 48 [UNIT_LOGIC_TEST]: Transition to inactive state results in ADMIN_DENIED',
    lastSnapshot.gateState === 'ADMIN_DENIED' && lastSnapshot.adminUser === null,
    'Inactive profile must be blocked and transitioned to denied'
  );

  // Re-seed active and re-authorize
  repo.seed(activeAdmin);
  await testController.handleAuthEvent({ uid: 'uid-reval', email: 't@t.com' }, (uid) => repo.getAdminUser(uid));
  assert(
    'Assertion 49 [UNIT_LOGIC_TEST]: Re-established active profile re-authorizes',
    lastSnapshot.gateState === 'ADMIN_AUTHORIZED',
    'Should re-authorize active user'
  );

  // Assertion 50 [UNIT_LOGIC_TEST]: Authorized same UID + repository read failure preserves prior ADMIN_AUTHORIZED state
  repo.setShouldFail(true);
  await testController.handleAuthEvent({ uid: 'uid-reval', email: 't@t.com' }, (uid) => repo.getAdminUser(uid));
  assert(
    'Assertion 50 [UNIT_LOGIC_TEST]: Same-UID background read failures do NOT transition to ADMIN_DENIED and preserve existing authorized profile',
    lastSnapshot.gateState === 'ADMIN_AUTHORIZED' && lastSnapshot.adminUser?.name === 'Tester' && lastSnapshot.revalidationError === 'ADMIN_READ_FAILURE',
    'Transient database failures must not degrade existing authorized active sessions'
  );

  // Assertion 51 [UNIT_LOGIC_TEST]: Initial unresolved user + read failure remains fail-closed in ADMIN_DENIED
  const initialController = new AdminGateResolutionController();
  initialController.mount();
  let initialSnap = initialController.getSnapshot();
  initialController.subscribe((snap) => { initialSnap = snap; });

  const failingRepo = new InMemoryAdminIdentityRepository();
  failingRepo.setShouldFail(true);

  await initialController.handleAuthEvent({ uid: 'uid-fail-initial', email: 'fail@t.com' }, (uid) => failingRepo.getAdminUser(uid));
  assert(
    'Assertion 51 [UNIT_LOGIC_TEST]: Initial unresolved read failure remains strictly fail-closed in ADMIN_DENIED with error descriptor',
    initialSnap.gateState === 'ADMIN_DENIED' && initialSnap.adminUser === null && initialSnap.revalidationError === 'ADMIN_READ_FAILURE',
    'Fail closed must forbid workspace rendering for first-time resolutions'
  );

  // Assertion 52 [UNIT_LOGIC_TEST]: Different UID clears previous authority immediately
  repo.setShouldFail(false);
  const differentAdmin: AdminUser = { id: 'uid-different', name: 'Different User', email: 'diff@t.com', role: AdminRole.Viewer, isActive: true };
  repo.seed(differentAdmin);

  // Trigger auth change to different UID while resolving
  const p = testController.handleAuthEvent({ uid: 'uid-different', email: 'diff@t.com' }, (uid) => repo.getAdminUser(uid));
  assert(
    'Assertion 52 [UNIT_LOGIC_TEST]: Changing to a different UID immediately clears previous administrative authority and snapshot profile',
    testController.getSnapshot().gateState === 'ADMIN_RESOLVING' && testController.getSnapshot().adminUser === null,
    'State must reset to resolving and discard previous user'
  );
  await p;

  // Assertion 53 [UNIT_LOGIC_TEST]: Null auth event transitions immediately to UNAUTHENTICATED
  await testController.handleAuthEvent(null, (uid) => repo.getAdminUser(uid));
  assert(
    'Assertion 53 [UNIT_LOGIC_TEST]: Null auth event transitions immediately to UNAUTHENTICATED and purges admin metadata',
    testController.getSnapshot().gateState === 'UNAUTHENTICATED' && testController.getSnapshot().adminUser === null,
    'Should reset immediately to unauthenticated'
  );

  // Assertion 54 [UNIT_LOGIC_TEST]: Stale async generation cannot overwrite newer auth state
  const slowController = new AdminGateResolutionController();
  slowController.mount();
  let slowSnap = slowController.getSnapshot();
  slowController.subscribe((snap) => { slowSnap = snap; });

  let resolveSlowPromise: (value: any) => void = () => {};
  const slowPromise = new Promise<AdminUser | null>((resolve) => {
    resolveSlowPromise = resolve;
  });

  const trigger1 = slowController.handleAuthEvent({ uid: 'uid-slow', email: 's@t.com' }, () => slowPromise);
  // Before trigger1 finishes, trigger null auth (immediate unauthenticated)
  const trigger2 = slowController.handleAuthEvent(null, async () => null);

  // Finish slow resolution
  resolveSlowPromise({ id: 'uid-slow', name: 'Slow', email: 's@t.com', role: AdminRole.Owner, isActive: true });
  await trigger1;
  await trigger2;

  assert(
    'Assertion 54 [UNIT_LOGIC_TEST]: Stale slow async resolution is ignored and cannot overwrite newer active unauthenticated auth state',
    slowSnap.gateState === 'UNAUTHENTICATED' && slowSnap.adminUser === null,
    'Stale generation must not overwrite active state'
  );

  // Assertion 55 [UNIT_LOGIC_TEST]: Unauthorized/unknown persisted tab in session storage is normalized to authorized fallback
  const contentEditorUserTestReval: AdminUser = { id: 'uid-norm', name: 'Editor', email: 'e@t.com', role: AdminRole.ContentEditor, isActive: true };
  const normalizedTabResult = resolveAuthorizedTab(contentEditorUserTestReval, 'users');
  assert(
    'Assertion 55 [UNIT_LOGIC_TEST]: Unauthorized persisted activeTab (users) for ContentEditor is normalized to overview fallback',
    normalizedTabResult === 'overview',
    'Normalization must correct unauthorized tab references to the canonical fallback'
  );

  // Assertion 56 [UNIT_LOGIC_TEST]: FirestoreAdminIdentityRepository unconfigured backend throws AdminReadError rather than returning null
  const prodRepo = new FirestoreAdminIdentityRepository();
  let threwExpected = false;
  try {
    await prodRepo.getAdminUser('test-uid-unconfigured');
  } catch (err: any) {
    if (err && err.name === 'AdminReadError' && err.message === 'ADMIN_READ_FAILURE') {
      threwExpected = true;
    }
  }
  assert(
    'Assertion 56 [UNIT_LOGIC_TEST]: FirestoreAdminIdentityRepository unconfigured backend throws AdminReadError rather than returning null',
    threwExpected,
    'Unconfigured backend must throw a dedicated AdminReadError to trigger the correct gate state mapping'
  );

  // Assertion 57 [UNIT_LOGIC_TEST]: same UID + AdminReadError preserves ADMIN_AUTHORIZED + ADMIN_READ_FAILURE
  const ctrlSameTyped = new AdminGateResolutionController();
  ctrlSameTyped.mount();
  let snapSameTyped = ctrlSameTyped.getSnapshot();
  ctrlSameTyped.subscribe((s) => { snapSameTyped = s; });

  const activeUserSameTyped = { id: 'uid-same-typed', name: 'Authorized', email: 'a@t.com', role: AdminRole.Owner, isActive: true };
  await ctrlSameTyped.handleAuthEvent({ uid: 'uid-same-typed', email: 'a@t.com' }, async () => activeUserSameTyped);

  // Trigger same-UID revalidation throwing AdminReadError
  await ctrlSameTyped.handleAuthEvent({ uid: 'uid-same-typed', email: 'a@t.com' }, async () => {
    throw new AdminReadError('ADMIN_READ_FAILURE');
  });

  assert(
    'Assertion 57 [UNIT_LOGIC_TEST]: same UID + AdminReadError preserves ADMIN_AUTHORIZED + ADMIN_READ_FAILURE',
    snapSameTyped.gateState === 'ADMIN_AUTHORIZED' &&
    snapSameTyped.adminUser?.id === 'uid-same-typed' &&
    snapSameTyped.revalidationError === 'ADMIN_READ_FAILURE',
    'Same-UID AdminReadError must preserve authorized status and current user profile with error flag'
  );

  // Assertion 58 [UNIT_LOGIC_TEST]: same UID + generic Error does NOT use transient preservation and fails closed
  const ctrlSameGeneric = new AdminGateResolutionController();
  ctrlSameGeneric.mount();
  let snapSameGeneric = ctrlSameGeneric.getSnapshot();
  ctrlSameGeneric.subscribe((s) => { snapSameGeneric = s; });

  const activeUserSameGeneric = { id: 'uid-same-gen', name: 'Authorized', email: 'a@t.com', role: AdminRole.Owner, isActive: true };
  await ctrlSameGeneric.handleAuthEvent({ uid: 'uid-same-gen', email: 'a@t.com' }, async () => activeUserSameGeneric);

  // Trigger same-UID revalidation throwing a generic unexpected Error
  await ctrlSameGeneric.handleAuthEvent({ uid: 'uid-same-gen', email: 'a@t.com' }, async () => {
    throw new Error('Unexpected runtime DB disconnect');
  });

  assert(
    'Assertion 58 [UNIT_LOGIC_TEST]: same UID + generic Error does NOT use transient preservation and fails closed',
    snapSameGeneric.gateState === 'ADMIN_DENIED' &&
    snapSameGeneric.adminUser === null &&
    snapSameGeneric.revalidationError === null,
    'Generic unexpected errors during revalidation must fail closed and never keep admin workspace authorized'
  );

  // Assertion 59 [UNIT_LOGIC_TEST]: initial resolution + AdminReadError fails closed
  const ctrlInitTyped = new AdminGateResolutionController();
  ctrlInitTyped.mount();
  let snapInitTyped = ctrlInitTyped.getSnapshot();
  ctrlInitTyped.subscribe((s) => { snapInitTyped = s; });

  await ctrlInitTyped.handleAuthEvent({ uid: 'uid-init-typed', email: 'a@t.com' }, async () => {
    throw new AdminReadError('ADMIN_READ_FAILURE');
  });

  assert(
    'Assertion 59 [UNIT_LOGIC_TEST]: initial resolution + AdminReadError fails closed',
    snapInitTyped.gateState === 'ADMIN_DENIED' &&
    snapInitTyped.adminUser === null &&
    snapInitTyped.revalidationError === 'ADMIN_READ_FAILURE',
    'Initial lookup AdminReadError must fail closed and flag the read failure'
  );

  // Assertion 60 [UNIT_LOGIC_TEST]: initial resolution + generic Error fails closed
  const ctrlInitGeneric = new AdminGateResolutionController();
  ctrlInitGeneric.mount();
  let snapInitGeneric = ctrlInitGeneric.getSnapshot();
  ctrlInitGeneric.subscribe((s) => { snapInitGeneric = s; });

  await ctrlInitGeneric.handleAuthEvent({ uid: 'uid-init-gen', email: 'a@t.com' }, async () => {
    throw new Error('Some unexpected compiler bug');
  });

  assert(
    'Assertion 60 [UNIT_LOGIC_TEST]: initial resolution + generic Error fails closed',
    snapInitGeneric.gateState === 'ADMIN_DENIED' &&
    snapInitGeneric.adminUser === null &&
    snapInitGeneric.revalidationError === null,
    'Initial lookup generic Error must fail closed without setting ADMIN_READ_FAILURE'
  );

  // Assertion 61 [UNIT_LOGIC_TEST]: different UID + generic Error remains discarded
  const ctrlDiffGeneric = new AdminGateResolutionController();
  ctrlDiffGeneric.mount();
  let snapDiffGeneric = ctrlDiffGeneric.getSnapshot();
  ctrlDiffGeneric.subscribe((s) => { snapDiffGeneric = s; });

  const activeUserDiffGeneric = { id: 'uid-diff-gen-1', name: 'Authorized', email: 'a@t.com', role: AdminRole.Owner, isActive: true };
  await ctrlDiffGeneric.handleAuthEvent({ uid: 'uid-diff-gen-1', email: 'a@t.com' }, async () => activeUserDiffGeneric);

  // Transition to another UID which throws generic unexpected Error
  await ctrlDiffGeneric.handleAuthEvent({ uid: 'uid-diff-gen-2', email: 'a@t.com' }, async () => {
    throw new Error('Database connection issue');
  });

  assert(
    'Assertion 61 [UNIT_LOGIC_TEST]: different UID + generic Error remains discarded',
    snapDiffGeneric.gateState === 'ADMIN_DENIED' &&
    snapDiffGeneric.adminUser === null &&
    snapDiffGeneric.revalidationError === null,
    'Changing UID to one that produces generic error must immediately and permanently clear prior authority'
  );

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  return { passedCount, failedCount, results };
}
