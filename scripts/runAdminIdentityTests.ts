import { runAdminIdentityConvergenceTests } from '../src/services/adminIdentityConvergenceTests';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  ROLE_DOMAINS_MAP,
  ROLE_PERMISSIONS_MAP,
  canAccessCommunitySubmissions,
  canCreateNewsDraftFromAcceptedCitizenSubmission,
  canModerateCommunitySubmissions,
  type AdminUser,
} from '../functions/src/shared/adminContract';

function runNarrowCommunityRbacPolicyTests(): Array<{ name: string; passed: boolean; message: string }> {
  const checks: Array<{ name: string; passed: boolean; message: string }> = [];
  const allRoles = Object.values(AdminRole);

  // 1. canAccessCommunitySubmissions & canModerateCommunitySubmissions: ONLY active Owner & CitizenModerator
  const accessFailures: string[] = [];
  const moderateFailures: string[] = [];
  const handoffFailures: string[] = [];

  for (const role of allRoles) {
    const activeUser: AdminUser = {
      id: `admin_${role}`,
      name: `Admin ${role}`,
      email: `${role.toLowerCase()}@promiseofplanet.org`,
      role,
      isActive: true,
    };
    const inactiveUser: AdminUser = { ...activeUser, isActive: false };

    const expectCommunityAdmin = role === AdminRole.Owner || role === AdminRole.CitizenModerator;
    const expectHandoff =
      role === AdminRole.Owner ||
      role === AdminRole.CitizenModerator ||
      role === AdminRole.ContentEditor;

    if (canAccessCommunitySubmissions(activeUser) !== expectCommunityAdmin) {
      accessFailures.push(`active ${role}: expected ${expectCommunityAdmin}`);
    }
    if (canAccessCommunitySubmissions(inactiveUser) !== false) {
      accessFailures.push(`inactive ${role}: expected false`);
    }

    if (canModerateCommunitySubmissions(activeUser) !== expectCommunityAdmin) {
      moderateFailures.push(`active ${role}: expected ${expectCommunityAdmin}`);
    }
    if (canModerateCommunitySubmissions(inactiveUser) !== false) {
      moderateFailures.push(`inactive ${role}: expected false`);
    }

    if (canCreateNewsDraftFromAcceptedCitizenSubmission(activeUser) !== expectHandoff) {
      handoffFailures.push(`active ${role}: expected ${expectHandoff}`);
    }
    if (canCreateNewsDraftFromAcceptedCitizenSubmission(inactiveUser) !== false) {
      handoffFailures.push(`inactive ${role}: expected false`);
    }
  }

  // Null/undefined users always denied
  if (
    canAccessCommunitySubmissions(null) ||
    canModerateCommunitySubmissions(undefined) ||
    canCreateNewsDraftFromAcceptedCitizenSubmission(null)
  ) {
    accessFailures.push('null/undefined user must return false');
  }

  // Verify ROLE_PERMISSIONS_MAP / ROLE_DOMAINS_MAP were NOT broadened for ContentEditor, Viewer, Trainer, LibraryCurator, AIAssistant
  const noBroadeningOk =
    !ROLE_DOMAINS_MAP[AdminRole.ContentEditor].has(AdminDomain.Community) &&
    !ROLE_DOMAINS_MAP[AdminRole.LibraryCurator].has(AdminDomain.Community) &&
    !ROLE_DOMAINS_MAP[AdminRole.Trainer].has(AdminDomain.Community) &&
    !ROLE_DOMAINS_MAP[AdminRole.TrainingManager].has(AdminDomain.Community) &&
    !ROLE_DOMAINS_MAP[AdminRole.Viewer].has(AdminDomain.Community) &&
    !ROLE_PERMISSIONS_MAP[AdminRole.AIAssistant].has(AdminPermission.Publish) &&
    !ROLE_PERMISSIONS_MAP[AdminRole.AIAssistant].has(AdminPermission.Approve);

  checks.push({
    name: 'Narrow Community RBAC: canAccessCommunitySubmissions restricts to active Owner & CitizenModerator across all 9 roles',
    passed: accessFailures.length === 0,
    message: accessFailures.join('; '),
  });
  checks.push({
    name: 'Narrow Community RBAC: canModerateCommunitySubmissions restricts to active Owner & CitizenModerator across all 9 roles',
    passed: moderateFailures.length === 0,
    message: moderateFailures.join('; '),
  });
  checks.push({
    name: 'Narrow Community RBAC: canCreateNewsDraftFromAcceptedCitizenSubmission restricts to active Owner, CitizenModerator & ContentEditor',
    passed: handoffFailures.length === 0,
    message: handoffFailures.join('; '),
  });
  checks.push({
    name: 'RBAC Integrity: ROLE_PERMISSIONS_MAP and ROLE_DOMAINS_MAP not broadened; AI Assistant remains non-publishing',
    passed: noBroadeningOk,
    message: noBroadeningOk ? 'OK' : 'Unexpected role map broadening detected',
  });

  return checks;
}

async function main() {
  console.log('====================================================');
  console.log('RUNNING ADMIN IDENTITY & WORKSPACE ACCESS CONVERGENCE TESTS');
  console.log('====================================================\n');

  const base = await runAdminIdentityConvergenceTests();
  const rbacChecks = runNarrowCommunityRbacPolicyTests();
  const results = [...base.results, ...rbacChecks];
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  results.forEach(r => {
    console.log(`${r.passed ? '✅ [PASS]' : '❌ [FAIL]'} ${r.name}`);
    if (!r.passed) {
      console.log(`   ${r.message}`);
    }
  });

  console.log('\n====================================================');
  console.log(`TOTAL: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner threw error:', err);
  process.exit(1);
});

