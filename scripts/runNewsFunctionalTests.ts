/**
 * Standalone test runner for News Functional Tests.
 * Polyfills in-memory storage for headless Node.js execution.
 */

// Isolate test process environment BEFORE any module imports so Firebase remains unconfigured
if (typeof process !== 'undefined' && process.env) {
  delete process.env.VITE_FIREBASE_API_KEY;
  delete process.env.VITE_FIREBASE_PROJECT_ID;
}

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

async function main() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — NEWS HUB FUNCTIONAL VERIFICATION');
  console.log('=================================================================\n');

  try {
    const firebaseMod = await import('../src/services/firebase');
    if (firebaseMod.isFirebaseConfigured !== false || firebaseMod.app !== null) {
      console.error(
        `FATAL SAFETY ABORT: Firebase client is configured in test runner (isFirebaseConfigured=${firebaseMod.isFirebaseConfigured}, app=${firebaseMod.app !== null ? 'non-null' : 'null'}). Aborting immediately to prevent live Firebase calls.`
      );
      process.exit(1);
    }
    console.log('[SAFETY] Firebase test isolation verified: isFirebaseConfigured === false, app === null\n');

    const { runNewsFunctionalTests } = await import('../src/services/newsFunctionalTests');
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
