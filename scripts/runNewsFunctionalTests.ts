/**
 * Standalone test runner for News Functional Tests.
 * Polyfills in-memory storage for headless Node.js execution.
 */

// Headless polyfill for localStorage
if (typeof globalThis.localStorage === 'undefined') {
  const memoryStore = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => memoryStore.get(k) || null,
    setItem: (k: string, v: string) => memoryStore.set(k, String(v)),
    removeItem: (k: string) => memoryStore.delete(k),
    clear: () => memoryStore.clear(),
  };
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    location: {
      origin: 'https://promiseofplanet.org',
    },
  };
}

import { runNewsFunctionalTests } from '../src/services/newsFunctionalTests';

async function main() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — NEWS HUB FUNCTIONAL VERIFICATION');
  console.log('=================================================================\n');

  try {
    const results = await runNewsFunctionalTests();
    let allPassed = true;

    for (const res of results) {
      const statusIcon = res.passed ? '✓' : '✗';
      console.log(`[${statusIcon}] ${res.id}: ${res.name}`);
      console.log(`    ${res.details}\n`);
      if (!res.passed) {
        allPassed = false;
      }
    }

    console.log('=================================================================');
    if (allPassed) {
      console.log(` SUMMARY: ALL ${results.length} NEWS SPECIFICATION TESTS PASSED.`);
      console.log('=================================================================');
      process.exit(0);
    } else {
      console.error(` SUMMARY: SOME NEWS SPECIFICATION TESTS FAILED.`);
      console.log('=================================================================');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Test execution encountered fatal error:', err);
    process.exit(1);
  }
}

main();
