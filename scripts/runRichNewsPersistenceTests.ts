/**
 * Standalone test runner for Rich News Persistence Tests.
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

import { runRichNewsPersistenceTests } from '../src/services/richNewsPersistenceTests';

async function main() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — RICH NEWS PERSISTENCE VERIFICATION');
  console.log('=================================================================\n');

  try {
    const results = await runRichNewsPersistenceTests();
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
      console.log(` SUMMARY: ALL ${results.length} RICH PERSISTENCE TESTS PASSED.`);
      console.log('=================================================================');
      process.exit(0);
    } else {
      console.error(` SUMMARY: SOME RICH PERSISTENCE TESTS FAILED.`);
      console.log('=================================================================');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Test execution encountered fatal error:', err);
    process.exit(1);
  }
}

main();
