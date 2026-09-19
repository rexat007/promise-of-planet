import { runDurableMediaTests } from '../src/services/durableMediaTests';

async function main() {
  try {
    const results = await runDurableMediaTests();
    let passedCount = 0;
    let failedCount = 0;

    for (const res of results) {
      if (res.passed) {
        passedCount++;
        console.log(`[PASS] ${res.test} - ${res.details || ''}`);
      } else {
        failedCount++;
        console.log(`[FAIL] ${res.test} - ${res.details || ''}`);
      }
    }

    console.log('\n=========================================================');
    console.log(`TOTAL PASSED: ${passedCount} / ${results.length}`);
    console.log(`TOTAL FAILED: ${failedCount}`);
    console.log('=========================================================');

    if (failedCount === 0) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

main();
