/**
 * Standalone test runner for Citizen Journalism & Navigation Integration.
 */
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
      hash: '',
    },
  };
}

import { runCitizenJournalismFunctionalTests } from '../src/services/citizenJournalismFunctionalTests';

async function main() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — CITIZEN JOURNALISM & NAVIGATION VERIFICATION');
  console.log('=================================================================\n');

  try {
    const results = await runCitizenJournalismFunctionalTests();
    let allPassed = true;

    for (const res of results) {
      const icon = res.passed ? '✓' : '✗';
      console.log(`[${icon}] ${res.id}: ${res.name}`);
      console.log(`    ${res.details}\n`);
      if (!res.passed) {
        allPassed = false;
      }
    }

    console.log('=================================================================');
    if (allPassed) {
      console.log(` SUMMARY: ALL ${results.length} CITIZEN JOURNALISM & NAVIGATION TESTS PASSED.`);
      console.log('=================================================================');
      process.exit(0);
    } else {
      console.error(' SUMMARY: SOME CITIZEN JOURNALISM TESTS FAILED.');
      console.log('=================================================================');
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error running Citizen Journalism tests:', err);
    process.exit(1);
  }
}

main();
