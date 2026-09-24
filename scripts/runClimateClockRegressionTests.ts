import { runClimateClockRegressionTests } from '../src/services/climateClockRegressionTests';

async function main() {
  console.log('====================================================');
  console.log('RUNNING CLIMATE CLOCK REGRESSION TESTS');
  console.log('====================================================\n');

  const results = runClimateClockRegressionTests();
  let passedCount = 0;
  let failedCount = 0;

  for (const r of results) {
    if (r.passed) {
      passedCount++;
      console.log(`✅ [${r.id}] [${r.classification}] ${r.name}`);
    } else {
      failedCount++;
      console.error(`❌ [${r.id}] [${r.classification}] ${r.name}`);
      if (r.message) {
        console.error(`   Message: ${r.message}`);
      }
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY: ${passedCount} passed / ${results.length} total / ${failedCount} failed`);
  console.log('----------------------------------------------------\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
