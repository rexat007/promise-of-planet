import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFirebaseTaskGatewayRuntimeWithDependencies,
  createFirebaseTaskGatewayRuntime,
} from '../functions/src/peia/firebaseTaskGatewayRuntime';

/**
 * Regression suite for PEIA-16O — FIREBASE RUNTIME BINDING FOUNDATION.
 * Enforces exactly 24 test units covering runtime behavior and source invariants.
 */

let passedTests = 0;
let totalTests = 0;

function test(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
  } catch (err: any) {
    console.error(`FAILED Test ${totalTests}: ${name}`);
    console.error(err);
    throw err;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runSuite() {
  const runtimePath = join(process.cwd(), 'functions/src/peia/firebaseTaskGatewayRuntime.ts');
  const runtimeCode = readFileSync(runtimePath, 'utf8');
  
  const indexPath = join(process.cwd(), 'functions/src/index.ts');
  const indexCode = readFileSync(indexPath, 'utf8');

  console.log('--- PEIA-16O 24-Test Runtime Binding Audit ---');

  // --- 1. Existence and Export ---
  test('1. createFirebaseTaskGatewayRuntimeWithDependencies exists', () => {
    assert(typeof createFirebaseTaskGatewayRuntimeWithDependencies === 'function', 'DI Factory missing');
  });

  test('2. createFirebaseTaskGatewayRuntime exists', () => {
    assert(typeof createFirebaseTaskGatewayRuntime === 'function', 'Convenience Factory missing');
  });

  test('3. injected factory takes exactly one dependencies argument', () => {
    assert(createFirebaseTaskGatewayRuntimeWithDependencies.length === 1, 'DI Factory arity mismatch');
  });

  // --- 2. Runtime Behavior (4-15) ---
  
  test('4. getFirestore called exactly once per factory invocation', () => {
    let callCount = 0;
    createFirebaseTaskGatewayRuntimeWithDependencies({
      getFirestore: () => { callCount++; return {}; },
      createGateway: () => (async () => ({} as any)),
    });
    assert(callCount === 1, `Expected 1 call, got ${callCount}`);
  });

  test('5. createGateway called exactly once per factory invocation', () => {
    let callCount = 0;
    createFirebaseTaskGatewayRuntimeWithDependencies({
      getFirestore: () => ({}),
      createGateway: () => { callCount++; return (async () => ({} as any)); },
    });
    assert(callCount === 1, `Expected 1 call, got ${callCount}`);
  });

  test('6. same Firestore object passed as credentialDb', () => {
    const mockDb = { id: 'mock' };
    let passedDb: any = null;
    createFirebaseTaskGatewayRuntimeWithDependencies({
      getFirestore: () => mockDb,
      createGateway: (deps: any) => { passedDb = deps.credentialDb; return (async () => ({} as any)); },
    });
    assert(passedDb === mockDb, 'Credential DB reference mismatch');
  });

  test('7. same Firestore object passed as taskDb', () => {
    const mockDb = { id: 'mock' };
    let passedDb: any = null;
    createFirebaseTaskGatewayRuntimeWithDependencies({
      getFirestore: () => mockDb,
      createGateway: (deps: any) => { passedDb = deps.taskDb; return (async () => ({} as any)); },
    });
    assert(passedDb === mockDb, 'Task DB reference mismatch');
  });

  test('8. credentialDb and taskDb are exact same reference', () => {
    let credDb: any, taskDb: any;
    createFirebaseTaskGatewayRuntimeWithDependencies({
      getFirestore: () => ({}),
      createGateway: (deps: any) => { credDb = deps.credentialDb; taskDb = deps.taskDb; return (async () => ({} as any)); },
    });
    assert(credDb === taskDb, 'Databases must be the same object reference');
  });

  test('9. returned handler is exact same handler object returned by createGateway', () => {
    const mockHandler = async () => ({} as any);
    const result = createFirebaseTaskGatewayRuntimeWithDependencies({
      getFirestore: () => ({}),
      createGateway: () => mockHandler,
    });
    assert(result === mockHandler, 'Handler reference mismatch');
  });

  test('10. getFirestore Error exact same Error instance propagates', () => {
    const infraError = new Error('FS_DOWN');
    try {
      createFirebaseTaskGatewayRuntimeWithDependencies({
        getFirestore: () => { throw infraError; },
        createGateway: () => (async () => ({} as any)),
      });
      assert(false, 'Should have thrown');
    } catch (err: any) {
      assert(err === infraError, 'Exact error identity mismatch');
    }
  });

  test('11. createGateway Error exact same Error instance propagates', () => {
    const infraError = new Error('GATEWAY_FAIL');
    try {
      createFirebaseTaskGatewayRuntimeWithDependencies({
        getFirestore: () => ({}),
        createGateway: () => { throw infraError; },
      });
      assert(false, 'Should have thrown');
    } catch (err: any) {
      assert(err === infraError, 'Exact error identity mismatch');
    }
  });

  test('12. createGateway not called when getFirestore throws', () => {
    let callCount = 0;
    const infraError = new Error('INJECTED_FS_FAIL');
    try {
      createFirebaseTaskGatewayRuntimeWithDependencies({
        getFirestore: () => { throw infraError; },
        createGateway: () => { callCount++; return (async () => ({} as any)); },
      });
      assert(false, 'Should have thrown');
    } catch (err: any) {
      assert(err === infraError, 'Exact error identity mismatch');
    }
    assert(callCount === 0, 'createGateway should not be called');
  });

  test('13. second factory invocation calls getFirestore one additional time', () => {
    let callCount = 0;
    const deps = {
      getFirestore: () => { callCount++; return {}; },
      createGateway: () => (async () => ({} as any)),
    };
    createFirebaseTaskGatewayRuntimeWithDependencies(deps);
    createFirebaseTaskGatewayRuntimeWithDependencies(deps);
    assert(callCount === 2, `Expected 2 calls, got ${callCount}`);
  });

  test('14. second factory invocation calls createGateway one additional time', () => {
    let callCount = 0;
    const deps = {
      getFirestore: () => ({}),
      createGateway: () => { callCount++; return (async () => ({} as any)); },
    };
    createFirebaseTaskGatewayRuntimeWithDependencies(deps);
    createFirebaseTaskGatewayRuntimeWithDependencies(deps);
    assert(callCount === 2, `Expected 2 calls, got ${callCount}`);
  });

  test('15. first invocation handler remains unchanged after second invocation', () => {
    const h1 = async () => ({} as any);
    const h2 = async () => ({} as any);
    let current = h1;
    const deps = {
      getFirestore: () => ({}),
      createGateway: () => current,
    };
    const res1 = createFirebaseTaskGatewayRuntimeWithDependencies(deps);
    current = h2;
    const res2 = createFirebaseTaskGatewayRuntimeWithDependencies(deps);
    assert(res1 === h1 && res2 === h2 && res1 !== res2, 'Handlers should be independent');
  });

  // --- 3. Source Invariants (16-23) ---

  test('16. production convenience factory uses getFirestore', () => {
    assert(runtimeCode.includes('getFirestore,'), 'Convenience factory should use real getFirestore');
  });

  test('17. production convenience factory delegates to injected factory', () => {
    assert(runtimeCode.includes('return createFirebaseTaskGatewayRuntimeWithDependencies('), 'Delegation missing');
  });

  test('18. production convenience factory uses createFirestoreTaskGateway', () => {
    assert(runtimeCode.includes('createGateway: createFirestoreTaskGateway'), 'Convenience factory should use real composition');
  });

  test('19. runtime source contains no initializeApp or broad any-casts', () => {
    assert(!runtimeCode.includes('initializeApp'), 'initializeApp found');
    assert(!runtimeCode.includes('as any'), 'Broad "as any" cast found in production');
  });

  test('20. runtime source contains no HTTP/transport logic', () => {
    assert(!runtimeCode.includes('express') && !runtimeCode.includes('onRequest') && !runtimeCode.includes('onCall'), 'Transport logic found');
  });

  test('21. runtime source contains no credential/auth/task business logic', () => {
    // Check for absence of business logic keywords
    assert(!runtimeCode.includes('digest') && !runtimeCode.includes('principalId') && !runtimeCode.includes('AITaskStatus'), 'Business logic found');
  });

  test('22. runtime source contains no collection names/task query logic', () => {
    assert(!runtimeCode.includes('peiaMachineCredentials') && !runtimeCode.includes('peiaReviewTasks') && !runtimeCode.includes('where('), 'Database/Query logic found');
  });

  test('23. runtime source contains no writes', () => {
    assert(!runtimeCode.includes('.set(') && !runtimeCode.includes('.update(') && !runtimeCode.includes('.delete('), 'Write logic found');
  });

  // --- 4. Integration State (24) ---

  test('24. functions/src/index.ts remains unwired', () => {
    assert(!indexCode.includes('createFirebaseTaskGatewayRuntime'), 'index.ts wired prematurely');
  });

  // --- Final Count Gate ---
  assert(totalTests === 24, `Expected exactly 24 tests, found ${totalTests}`);
  
  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / ${totalTests - passedTests} failed`);
}

runSuite().catch(err => {
  console.error(err);
  process.exit(1);
});
