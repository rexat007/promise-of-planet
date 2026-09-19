import {
  runEngineVerification,
  runUsersAndPermissionsVerification,
  runAuditLogVerification,
  runGlobalSettingsVerification,
  runAdminGlobalSettingsUiVerification,
} from "../src/services/verification";

const suites = [
  { name: "Engine Verification", runner: runEngineVerification },
  { name: "Users & Permissions Verification", runner: runUsersAndPermissionsVerification },
  { name: "Audit Log Verification", runner: runAuditLogVerification },
  { name: "Global Settings Verification", runner: runGlobalSettingsVerification },
  { name: "Admin Global Settings UI Verification", runner: runAdminGlobalSettingsUiVerification },
];

let totalPassed = 0;
let totalFailed = 0;
let totalCount = 0;

console.log("=== RUNNING PROMISE OF PLANET CORE VERIFICATION SUITES ===");

for (const suite of suites) {
  const results = suite.runner();
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  totalPassed += passed;
  totalFailed += failed;
  totalCount += results.length;
  console.log(`- ${suite.name}: ${passed} / ${results.length} passed`);
}

console.log("=========================================================");
console.log(`TOTAL PASSED: ${totalPassed} / ${totalCount}`);
console.log(`TOTAL FAILED: ${totalFailed}`);

if (totalFailed === 0 && totalCount === 195) {
  process.exit(0);
} else {
  process.exit(1);
}
