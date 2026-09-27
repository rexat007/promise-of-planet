import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFirestoreTaskGateway,
  type FirestoreTaskGatewayDependencies,
} from '../functions/src/peia/firestoreTaskGatewayComposition';
import { PEIA_MACHINE_CREDENTIAL_COLLECTION } from '../functions/src/peia/firestoreMachineCredentialRepository';
import { PEIA_PENDING_TASK_COLLECTION } from '../functions/src/peia/firestorePendingTaskSource';
import { AITaskStatus } from '../functions/src/types/aiTask';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';

// --- Test Framework ---
let passedTests = 0;
let totalTests = 0;

async function test(name: string, fn: () => Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
  } catch (err: any) {
    console.error(`FAILED: ${name}`);
    console.error(err);
    throw err;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// --- Fakes ---

class FakeDoc {
  constructor(private readonly dataValue: any) {}
  async get() {
    return {
      exists: this.dataValue !== undefined,
      data: () => this.dataValue,
    };
  }
}

class FakeCredentialDb {
  data: Record<string, any> = {};
  lastCollection: string | null = null;
  lastDocId: string | null = null;
  queryCount = 0;

  collection(name: string) {
    this.lastCollection = name;
    return {
      doc: (id: string) => {
        this.lastDocId = id;
        this.queryCount++;
        return new FakeDoc(this.data[id]);
      },
    };
  }
}

class FakeTaskDb {
  tasks: any[] = [];
  lastCollection: string | null = null;
  wheres: any[] = [];
  orderBys: any[] = [];
  limitVal: number | null = null;
  queryCount = 0;

  collection(name: string) {
    this.lastCollection = name;
    this.queryCount++;
    const query: any = {
      where: (f: string, op: string, v: unknown) => {
        this.wheres.push({ f, op, v });
        return query;
      },
      orderBy: (f: string, d: string) => {
        this.orderBys.push({ f, d });
        return query;
      },
      limit: (n: number) => {
        this.limitVal = n;
        return query;
      },
      get: async () => ({
        docs: this.tasks.map(t => ({ data: () => t })),
      }),
    };
    return query;
  }
}

// --- Suite ---

async function runSuite() {
  const credentialDb = new FakeCredentialDb();
  const taskDb = new FakeTaskDb();
  const deps: FirestoreTaskGatewayDependencies = { credentialDb: credentialDb as any, taskDb: taskDb as any };

  const validCredential = 'peia_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const validDigest = 'e11419fd6f8b8d253bbffa1251f34a34e8d59f16611484e59f505bf6be3f82f5';

  const validTask = {
    taskId: 'task-1',
    taskType: 'CONTENT_REVIEW',
    target: { targetType: 'News', targetId: 'p1', sourceUpdatedAt: '2023-01-01T00:00:00Z' },
    contentSnapshot: { text: 'hello' },
    createdAt: '2023-01-01T00:00:00Z',
    status: AITaskStatus.Pending,
  };

  const validRecord: any = {
    credentialScheme: 'OPAQUE_BEARER_V1',
    credentialDigest: { algorithm: 'SHA-256', value: validDigest },
    principal: {
      principalId: 'machine-1',
      isActive: true,
      capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
    }
  };

  const handler = createFirestoreTaskGateway(deps);
  const sourcePath = join(process.cwd(), 'functions/src/peia/firestoreTaskGatewayComposition.ts');
  const sourceCode = readFileSync(sourcePath, 'utf8');
  const indexCode = readFileSync(join(process.cwd(), 'functions/src/index.ts'), 'utf8');

  // --- Start Tests ---

  await test('1. Factory and handler structure', async () => {
    assert(typeof createFirestoreTaskGateway === 'function', 'Factory missing');
    assert(createFirestoreTaskGateway.length === 1, 'Factory arity mismatch');
    assert(typeof handler === 'function', 'Handler missing');
  });

  await test('2. Dependency structure', async () => {
    assert('credentialDb' in deps && 'taskDb' in deps, 'Deps incomplete');
  });

  await test('3. No Firebase SDK imports', async () => {
    assert(!sourceCode.includes('firebase-admin'), 'admin import found');
    assert(!sourceCode.includes('firebase-functions'), 'functions import found');
  });

  await test('4. No Firebase runtime initialization', async () => {
    assert(!sourceCode.includes('getFirestore'), 'getFirestore found');
    assert(!sourceCode.includes('initializeApp'), 'initializeApp found');
  });

  await test('5. No transport-layer logic', async () => {
    assert(!sourceCode.includes('express'), 'express found');
    assert(!sourceCode.includes('onRequest'), 'onRequest found');
  });

  await test('6. Read-only constraint (no writes)', async () => {
    assert(!sourceCode.includes('.set('), 'set found');
    assert(!sourceCode.includes('.update('), 'update found');
    assert(!sourceCode.includes('.delete('), 'delete found');
  });

  await test('7. Orchestrator delegation', async () => {
    assert(sourceCode.includes('executePendingTaskGatewayRequest'), 'orchestrator call missing');
  });

  await test('8. Authorization boundary encapsulation', async () => {
    assert(!sourceCode.includes('authorizePendingTaskDelivery'), 'boundary leak');
  });

  await test('9. Task query boundary encapsulation', async () => {
    assert(!sourceCode.includes('PEIA_PENDING_TASK_COLLECTION'), 'collection leak');
  });

  await test('10. index.ts remains unwired', async () => {
    assert(!indexCode.includes('createFirestoreTaskGateway'), 'index wired');
  });

  await test('11. Null input error (taskDb not queried)', async () => {
    taskDb.queryCount = 0;
    try { await handler(null); assert(false, 'Accepted null'); } catch (err: any) { 
      assert(err.name === 'TaskGatewayContractError', 'Wrong error name'); 
      assert(taskDb.queryCount === 0, 'Task DB should not be touched');
    }
  });

  await test('12. Missing credential field error (taskDb not queried)', async () => {
    taskDb.queryCount = 0;
    try { await handler({}); assert(false, 'Accepted empty'); } catch (err: any) { 
      assert(err.code === 'MISSING_GATEWAY_FIELD', 'Wrong error code'); 
      assert(taskDb.queryCount === 0, 'Task DB should not be touched');
    }
  });

  await test('13. Unknown fields error (taskDb not queried)', async () => {
    taskDb.queryCount = 0;
    try { await handler({ credential: 'x', extra: 'y' }); assert(false, 'Accepted extra'); } catch (err: any) { 
      assert(err.code === 'UNKNOWN_GATEWAY_FIELD', 'Wrong error code'); 
      assert(taskDb.queryCount === 0, 'Task DB should not be touched');
    }
  });

  await test('14. Prohibited fields error (taskDb not queried)', async () => {
    taskDb.queryCount = 0;
    try { await handler({ credential: 'x', task: 'y' }); assert(false, 'Accepted prohibited'); } catch (err: any) { 
      assert(err.code === 'PROHIBITED_GATEWAY_FIELD', 'Wrong error code'); 
      assert(taskDb.queryCount === 0, 'Task DB should not be touched');
    }
  });

  await test('15. Machine unauthenticated failure (taskDb not queried)', async () => {
    credentialDb.data = {};
    taskDb.queryCount = 0;
    try { await handler({ credential: validCredential }); assert(false, 'Accepted unknown'); } catch (err: any) { 
      assert(err.code === 'MACHINE_UNAUTHENTICATED', 'Wrong error code'); 
      assert(taskDb.queryCount === 0, 'Task DB should not be touched');
    }
  });

  await test('16. Machine inactive failure (taskDb not queried)', async () => {
    credentialDb.data[validDigest] = { ...validRecord, principal: { ...validRecord.principal, isActive: false } };
    taskDb.queryCount = 0;
    try { await handler({ credential: validCredential }); assert(false, 'Accepted inactive'); } catch (err: any) { 
      assert(err.code === 'MACHINE_INACTIVE', 'Wrong error code');
      assert(taskDb.queryCount === 0, 'Task DB should not be touched');
    }
  });

  await test('17. Capability denied failure (taskDb not queried)', async () => {
    credentialDb.data[validDigest] = { ...validRecord, principal: { ...validRecord.principal, capabilities: [] } };
    taskDb.queryCount = 0;
    try { await handler({ credential: validCredential }); assert(false, 'Accepted no-cap'); } catch (err: any) { 
      assert(err.code === 'MACHINE_CAPABILITY_DENIED', 'Wrong error code');
      assert(taskDb.queryCount === 0, 'Task DB should not be touched');
    }
  });

  await test('18. Empty queue (task: null)', async () => {
    credentialDb.data[validDigest] = validRecord;
    taskDb.tasks = [];
    const res = await handler({ credential: validCredential });
    assert(res.principalId === 'machine-1' && res.task === null, 'Shape mismatch');
  });

  await test('19. Task delivery success', async () => {
    taskDb.tasks = [validTask];
    const res = await handler({ credential: validCredential });
    assert(res.task?.taskId === 'task-1', 'Task ID mismatch');
  });

  await test('20. Credential repository collection use', async () => {
    assert(credentialDb.lastCollection === PEIA_MACHINE_CREDENTIAL_COLLECTION, 'Collection mismatch');
  });

  await test('21. Pending task source collection use', async () => {
    assert(taskDb.lastCollection === PEIA_PENDING_TASK_COLLECTION, 'Collection mismatch');
  });

  await test('22. Status filter presence', async () => {
    assert(taskDb.wheres.some(w => w.f === 'status' && w.v === AITaskStatus.Pending), 'Status filter missing');
  });

  await test('23. Chronological ordering (oldest first)', async () => {
    assert(taskDb.orderBys.some(o => o.f === 'createdAt' && o.d === 'asc'), 'Ordering missing');
  });

  await test('24. Deterministic tie-break ordering', async () => {
    assert(taskDb.orderBys.some(o => o.f === 'taskId' && o.d === 'asc'), 'Tie-break missing');
  });

  await test('25. Queue batch limit (1)', async () => {
    assert(taskDb.limitVal === 1, 'Limit mismatch');
  });

  await test('26. Factory lifetime proof (runtime + source invariant)', async () => {
    // A. Runtime verification
    credentialDb.queryCount = 0;
    taskDb.queryCount = 0;
    credentialDb.data[validDigest] = validRecord;
    taskDb.tasks = [validTask];
    
    const r1 = await handler({ credential: validCredential });
    const r2 = await handler({ credential: validCredential });
    
    assert(r1.principalId === 'machine-1' && r2.principalId === 'machine-1', 'Execution failure');
    assert(credentialDb.queryCount === 2, 'Credential DB lookups should persist across calls');
    assert(taskDb.queryCount === 2, 'Task DB lookups should persist across calls');

    // B. Source invariant verification
    const handlerReturnMarker = 'return async (input: unknown) => {';
    const repoConstructor = 'new FirestoreMachineCredentialBindingRepository(';
    const verifierConstructor = 'new OpaqueMachineIdentityVerifier(';
    const sourceConstructor = 'new FirestorePendingTaskSource(';

    const returnIdx = sourceCode.indexOf(handlerReturnMarker);
    const repoIdx = sourceCode.indexOf(repoConstructor);
    const verifierIdx = sourceCode.indexOf(verifierConstructor);
    const sourceIdx = sourceCode.indexOf(sourceConstructor);

    assert(returnIdx !== -1, 'Handler return marker missing');
    assert(repoIdx !== -1 && repoIdx < returnIdx, 'Repository constructor must precede handler');
    assert(verifierIdx !== -1 && verifierIdx < returnIdx, 'Verifier constructor must precede handler');
    assert(sourceIdx !== -1 && sourceIdx < returnIdx, 'Source constructor must precede handler');

    // Check no duplicate constructors inside handler
    const handlerBody = sourceCode.slice(returnIdx);
    assert(!handlerBody.includes(repoConstructor), 'Repository must not be recreated in handler');
    assert(!handlerBody.includes(verifierConstructor), 'Verifier must not be recreated in handler');
    assert(!handlerBody.includes(sourceConstructor), 'Source must not be recreated in handler');
  });

  await test('27. Repository error wrapping (MACHINE_AUTHENTICATION_FAILED)', async () => {
    const orig = credentialDb.collection;
    credentialDb.collection = () => { throw new Error('AUTH_DB_ERROR'); };
    try {
      await handler({ credential: validCredential });
      assert(false, 'Failed to catch error');
    } catch (err: any) {
      assert(err.code === 'MACHINE_AUTHENTICATION_FAILED', 'Should be wrapped as authentication failure');
    } finally {
      credentialDb.collection = orig;
    }
  });

  await test('28. Source infrastructure error exact identity propagation', async () => {
    const infraError = new Error('SOURCE_DOWN');
    const orig = taskDb.collection;
    taskDb.collection = () => { throw infraError; };
    try {
      await handler({ credential: validCredential });
      assert(false, 'Accepted broken source');
    } catch (err: any) {
      assert(err === infraError, 'Exact error object identity must propagate');
    } finally {
      taskDb.collection = orig;
    }
  });

  await test('29. Digest-based document lookup', async () => {
    assert(credentialDb.lastDocId === validDigest, 'Lookup must use hashed digest');
  });

  await test('30. Output contract integrity', async () => {
    taskDb.tasks = [validTask];
    const res = await handler({ credential: validCredential });
    const keys = Object.keys(res);
    assert(keys.length === 2 && keys.includes('principalId') && keys.includes('task'), 'Exposed extra fields');
  });

  // --- End Tests ---

  assert(totalTests === 30, `Expected exactly 30 tests, found ${totalTests}`);
  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / ${totalTests - passedTests} failed`);
}

runSuite().catch(err => {
  console.error(err);
  process.exit(1);
});
