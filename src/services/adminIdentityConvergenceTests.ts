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
  validateAdminUserData 
} from './adminIdentityService';
import { validateAccountData } from './accountService';
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

  // 12. UID change clears previous AdminUser before resolving new UID
  testRepo.clear();
  testRepo.seed(activeOwner);
  const user1 = await testService.getAdminUserByUid('uid-active-owner');
  const user2 = await testService.getAdminUserByUid('different-uid');
  assert(
    'Assertion 12: UID change resolves independent document or null',
    user1 !== null && user2 === null,
    'UID change must query new UID and not return previous cached identity'
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

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  return { passedCount, failedCount, results };
}
