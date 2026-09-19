import { runYoutubeFoundationVerification } from "../src/services/youtubeFoundationTests";

async function execute() {
  console.log("=== RUNNING PROMISE OF PLANET YOUTUBE PERSISTENT FOUNDATION TESTS ===");
  try {
    const results = await runYoutubeFoundationVerification();
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

    console.log("=========================================================");
    console.log(`TOTAL PASSED: ${passedCount} / ${results.length}`);
    console.log(`TOTAL FAILED: ${failedCount}`);

    if (failedCount === 0) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (e: any) {
    console.error("Test runner crashed with error:", e);
    process.exit(1);
  }
}

execute();
