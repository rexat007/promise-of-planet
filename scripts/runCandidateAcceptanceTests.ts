import { runCandidateAcceptanceTests } from '../src/services/candidateAcceptanceTests';

async function main() {
  const results = await runCandidateAcceptanceTests();
  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.passed) {
      console.log(`[PASS] ${r.test} - ${r.details || ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${r.test} - ${r.details || ''}`);
      failed++;
    }
  }

  console.log('\n=========================================================');
  console.log(`TOTAL PASSED: ${passed} / ${results.length}`);
  console.log(`TOTAL FAILED: ${failed}`);
  console.log('=========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
