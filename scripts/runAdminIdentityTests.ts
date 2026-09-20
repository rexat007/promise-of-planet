import { runAdminIdentityConvergenceTests } from '../src/services/adminIdentityConvergenceTests';

async function main() {
  console.log('====================================================');
  console.log('RUNNING ADMIN IDENTITY & WORKSPACE ACCESS CONVERGENCE TESTS');
  console.log('====================================================\n');

  const { passedCount, failedCount, results } = await runAdminIdentityConvergenceTests();

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
