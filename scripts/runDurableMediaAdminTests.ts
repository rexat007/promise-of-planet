import { runDurableMediaAdminTestSuite } from '../src/services/durableMediaAdminTests';

async function main() {
  console.log('==================================================');
  console.log('RUNNING DURABLE MEDIA ADMIN & ACCEPT TEST SUITE');
  console.log('==================================================');
  const results = await runDurableMediaAdminTestSuite();
  let passedCount = 0;
  let failedCount = 0;

  for (const r of results) {
    if (r.passed) {
      console.log(`[PASS] ${r.name}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${r.name} - Error: ${r.error}`);
      failedCount++;
    }
  }

  console.log('==================================================');
  console.log(`TEST RESULTS: ${passedCount} passed, ${failedCount} failed.`);
  console.log('==================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
