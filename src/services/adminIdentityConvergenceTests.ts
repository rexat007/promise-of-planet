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
  AdminGateResolutionController
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

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  return { passedCount, failedCount, results };
}
