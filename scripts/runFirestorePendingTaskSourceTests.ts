import * as fs from 'fs';
import * as path from 'path';
import { 
  FirestorePendingTaskSource, 
  FirestorePendingTaskSourceError, 
  PEIA_PENDING_TASK_COLLECTION 
} from '../functions/src/peia/firestorePendingTaskSource';
import { AITaskStatus } from '../functions/src/types/aiTask';

const tests: (() => Promise<void>)[] = [];

function registerTest(name: string, fn: () => Promise<void>) {
  tests.push(async () => {
    try {
      await fn();
      console.log(`✅ [${tests.indexOf(fn) + 1}] ${name}`);
    } catch (err: any) {
      console.error(`❌ [${tests.indexOf(fn) + 1}] ${name}`);
      console.error(`   ${err.message}`);
      throw err;
    }
  });
}

class RecordingQuery {
  calls: { name: string; args: any[] }[] = [];
  resultDocs: any[] = [];
  shouldThrow: Error | null = null;

  where(field: string, op: string, value: unknown) {
    this.calls.push({ name: 'where', args: [field, op, value] });
    return this;
  }
  orderBy(field: string, direction: string) {
    this.calls.push({ name: 'orderBy', args: [field, direction] });
    return this;
  }
  limit(count: number) {
    this.calls.push({ name: 'limit', args: [count] });
    return this;
  }
  async get() {
    this.calls.push({ name: 'get', args: [] });
    if (this.shouldThrow) throw this.shouldThrow;
    return { docs: this.resultDocs };
  }
}

class RecordingDb {
  calls: { name: string; args: any[] }[] = [];
  query = new RecordingQuery();

  collection(name: string) {
    this.calls.push({ name: 'collection', args: [name] });
    return this.query;
  }
}

// 1. canonical collection name is peiaReviewTasks
registerTest('1. canonical collection name is peiaReviewTasks', async () => {
  if (PEIA_PENDING_TASK_COLLECTION !== 'peiaReviewTasks') throw new Error('Collection name mismatch');
});

// 2. source implements fetchNextPendingTask
registerTest('2. source implements fetchNextPendingTask', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  if (typeof source.fetchNextPendingTask !== 'function') throw new Error('Method not found');
});

// 3. fetchNextPendingTask takes zero arguments
registerTest('3. fetchNextPendingTask takes zero arguments', async () => {
  if (FirestorePendingTaskSource.prototype.fetchNextPendingTask.length !== 0) throw new Error('Expected zero arguments');
});

// 4. collection called exactly once
registerTest('4. collection called exactly once', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const collectionCalls = db.calls.filter(c => c.name === 'collection');
  if (collectionCalls.length !== 1) throw new Error(`Called ${collectionCalls.length} times`);
});

// 5. collection called with peiaReviewTasks
registerTest('5. collection called with peiaReviewTasks', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  if (db.calls[0].args[0] !== 'peiaReviewTasks') throw new Error('Wrong collection name');
});

// 6. first where field is status
registerTest('6. first where field is status', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const call = db.query.calls.find(c => c.name === 'where');
  if (call?.args[0] !== 'status') throw new Error('Wrong field');
});

// 7. where operator is ==
registerTest('7. where operator is ==', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const call = db.query.calls.find(c => c.name === 'where');
  if (call?.args[1] !== '==') throw new Error('Wrong operator');
});

// 8. where value is AITaskStatus.Pending
registerTest('8. where value is AITaskStatus.Pending', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const call = db.query.calls.find(c => c.name === 'where');
  if (call?.args[2] !== AITaskStatus.Pending) throw new Error('Wrong value');
});

// 9. first orderBy field is createdAt
registerTest('9. first orderBy field is createdAt', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const call = db.query.calls.filter(c => c.name === 'orderBy')[0];
  if (call?.args[0] !== 'createdAt') throw new Error('Wrong field');
});

// 10. first orderBy direction is asc
registerTest('10. first orderBy direction is asc', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const call = db.query.calls.filter(c => c.name === 'orderBy')[0];
  if (call?.args[1] !== 'asc') throw new Error('Wrong direction');
});

// 11. second orderBy field is taskId
registerTest('11. second orderBy field is taskId', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const call = db.query.calls.filter(c => c.name === 'orderBy')[1];
  if (call?.args[0] !== 'taskId') throw new Error('Wrong field');
});

// 12. second orderBy direction is asc
registerTest('12. second orderBy direction is asc', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const call = db.query.calls.filter(c => c.name === 'orderBy')[1];
  if (call?.args[1] !== 'asc') throw new Error('Wrong direction');
});

// 13. limit called exactly once
registerTest('13. limit called exactly once', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const limitCalls = db.query.calls.filter(c => c.name === 'limit');
  if (limitCalls.length !== 1) throw new Error(`Called ${limitCalls.length} times`);
});

// 14. limit value is exactly 1
registerTest('14. limit value is exactly 1', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const call = db.query.calls.find(c => c.name === 'limit');
  if (call?.args[0] !== 1) throw new Error('Wrong limit value');
});

// 15. get called exactly once
registerTest('15. get called exactly once', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  const getCalls = db.query.calls.filter(c => c.name === 'get');
  if (getCalls.length !== 1) throw new Error(`Called ${getCalls.length} times`);
});

// 16. query operation ordering is exactly: collection, where, orderBy(createdAt), orderBy(taskId), limit, get
registerTest('16. query operation ordering is exactly: collection, where, orderBy(createdAt), orderBy(taskId), limit, get', async () => {
  const db = new RecordingDb();
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  
  const actualOrder = [
    db.calls[0].name,
    ...db.query.calls.map(c => {
      if (c.name === 'orderBy') return `orderBy(${c.args[0]})`;
      return c.name;
    })
  ];
  
  const expectedOrder = [
    'collection',
    'where',
    'orderBy(createdAt)',
    'orderBy(taskId)',
    'limit',
    'get'
  ];
  
  if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error(`Order mismatch: ${actualOrder.join(' -> ')}`);
  }
});

// 17. zero docs returns null
registerTest('17. zero docs returns null', async () => {
  const db = new RecordingDb();
  db.query.resultDocs = [];
  const source = new FirestorePendingTaskSource(db as any);
  const result = await source.fetchNextPendingTask();
  if (result !== null) throw new Error('Should return null');
});

// 18. zero docs does not call data()
registerTest('18. zero docs does not call data()', async () => {
  const db = new RecordingDb();
  let dataCallCount = 0;
  const trapDoc = { data: () => { dataCallCount++; return {}; } };
  
  const emptyDocsTrap = new Proxy([] as any[], {
    get(target, prop, receiver) {
      if (prop === '0') {
        return trapDoc;
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  db.query.resultDocs = emptyDocsTrap;
  const source = new FirestorePendingTaskSource(db as any);
  const result = await source.fetchNextPendingTask();

  if (result !== null) throw new Error('Should return null');
  if (dataCallCount !== 0) throw new Error('data() called despite zero docs');
});

// 19. one doc returns exact data object reference
registerTest('19. one doc returns exact data object reference', async () => {
  const db = new RecordingDb();
  const mockData = { taskId: 't1' };
  db.query.resultDocs = [{ data: () => mockData }];
  const source = new FirestorePendingTaskSource(db as any);
  const result = await source.fetchNextPendingTask();
  if (result !== mockData) throw new Error('Data reference mismatch');
});

// 20. one doc calls data() exactly once
registerTest('20. one doc calls data() exactly once', async () => {
  const db = new RecordingDb();
  let callCount = 0;
  db.query.resultDocs = [{ 
    data: () => { 
      callCount++; 
      return { id: '1' }; 
    } 
  }];
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  if (callCount !== 1) throw new Error(`data() called ${callCount} times`);
});

// 21. returned task data is not cloned
registerTest('21. returned task data is not cloned', async () => {
  const db = new RecordingDb();
  const mockData = { id: '1' };
  db.query.resultDocs = [{ data: () => mockData }];
  const source = new FirestorePendingTaskSource(db as any);
  const result = await source.fetchNextPendingTask();
  if (result !== mockData) throw new Error('Data was cloned');
});

// 22. returned task data is not mutated
registerTest('22. returned task data is not mutated', async () => {
  const db = new RecordingDb();
  const mockData = { id: '1' };
  const originalJson = JSON.stringify(mockData);
  db.query.resultDocs = [{ data: () => mockData }];
  const source = new FirestorePendingTaskSource(db as any);
  await source.fetchNextPendingTask();
  if (JSON.stringify(mockData) !== originalJson) throw new Error('Data was mutated');
});

// 23. undefined document data throws PENDING_TASK_RECORD_MISSING_DATA
registerTest('23. undefined document data throws PENDING_TASK_RECORD_MISSING_DATA', async () => {
  const db = new RecordingDb();
  db.query.resultDocs = [{ data: () => undefined }];
  const source = new FirestorePendingTaskSource(db as any);
  try {
    await source.fetchNextPendingTask();
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.code !== 'PENDING_TASK_RECORD_MISSING_DATA') throw err;
  }
});

// 24. null document data throws PENDING_TASK_RECORD_MISSING_DATA
registerTest('24. null document data throws PENDING_TASK_RECORD_MISSING_DATA', async () => {
  const db = new RecordingDb();
  db.query.resultDocs = [{ data: () => null }];
  const source = new FirestorePendingTaskSource(db as any);
  try {
    await source.fetchNextPendingTask();
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.code !== 'PENDING_TASK_RECORD_MISSING_DATA') throw err;
  }
});

// 25. missing-data error is FirestorePendingTaskSourceError
registerTest('25. missing-data error is FirestorePendingTaskSourceError', async () => {
  const db = new RecordingDb();
  db.query.resultDocs = [{ data: () => null }];
  const source = new FirestorePendingTaskSource(db as any);
  try {
    await source.fetchNextPendingTask();
    throw new Error('Should have failed missing data check');
  } catch (err: any) {
    if (!(err instanceof FirestorePendingTaskSourceError)) throw new Error('Wrong error class');
    if (err.code !== 'PENDING_TASK_RECORD_MISSING_DATA') throw new Error(`Wrong code: ${err.code}`);
  }
});

// 26. missing-data error message does not expose document data
registerTest('26. missing-data error message does not expose document data', async () => {
  const db = new RecordingDb();
  const sentinel = 'SECRET_SENTINEL_VALUE';
  const mockDoc = { 
    data: () => null,
    context: sentinel // Sentinel is tied to the doc context
  };
  db.query.resultDocs = [mockDoc];
  const source = new FirestorePendingTaskSource(db as any);
  try {
    await source.fetchNextPendingTask();
    throw new Error('Should have failed missing data check');
  } catch (err: any) {
    if (!(err instanceof FirestorePendingTaskSourceError)) throw new Error('Wrong error class');
    if (err.code !== 'PENDING_TASK_RECORD_MISSING_DATA') throw new Error(`Wrong code: ${err.code}`);
    if (err.message.includes(sentinel)) throw new Error('Secret data leaked in error message');
  }
});

// 27. more than one doc throws PENDING_TASK_QUERY_CARDINALITY_INVALID
registerTest('27. more than one doc throws PENDING_TASK_QUERY_CARDINALITY_INVALID', async () => {
  const db = new RecordingDb();
  db.query.resultDocs = [{ data: () => ({}) }, { data: () => ({}) }];
  const source = new FirestorePendingTaskSource(db as any);
  try {
    await source.fetchNextPendingTask();
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.code !== 'PENDING_TASK_QUERY_CARDINALITY_INVALID') throw err;
  }
});

// 28. cardinality error is FirestorePendingTaskSourceError
registerTest('28. cardinality error is FirestorePendingTaskSourceError', async () => {
  const db = new RecordingDb();
  db.query.resultDocs = [{ data: () => ({}) }, { data: () => ({}) }];
  const source = new FirestorePendingTaskSource(db as any);
  try {
    await source.fetchNextPendingTask();
    throw new Error('Should have failed cardinality check');
  } catch (err: any) {
    if (!(err instanceof FirestorePendingTaskSourceError)) throw new Error('Wrong error class');
    if (err.code !== 'PENDING_TASK_QUERY_CARDINALITY_INVALID') throw new Error(`Wrong code: ${err.code}`);
  }
});

// 29. cardinality failure does not call any doc.data()
registerTest('29. cardinality failure does not call any doc.data()', async () => {
  const db = new RecordingDb();
  let callCount = 0;
  db.query.resultDocs = [
    { data: () => { callCount++; return {}; } },
    { data: () => { callCount++; return {}; } }
  ];
  const source = new FirestorePendingTaskSource(db as any);
  try {
    await source.fetchNextPendingTask();
    throw new Error('Should have failed cardinality check');
  } catch (err: any) {
    if (err.code !== 'PENDING_TASK_QUERY_CARDINALITY_INVALID') throw err;
  }
  if (callCount !== 0) throw new Error('data() called on cardinality failure');
});

// 30. infrastructure Error from get() propagates exact same Error instance
registerTest('30. infrastructure Error from get() propagates exact same Error instance', async () => {
  const db = new RecordingDb();
  const infraError = new Error('Database down');
  db.query.shouldThrow = infraError;
  const source = new FirestorePendingTaskSource(db as any);
  try {
    await source.fetchNextPendingTask();
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err !== infraError) throw new Error('Error reference mismatch');
  }
});

// 31. infrastructure Error is not converted to null
registerTest('31. infrastructure Error is not converted to null', async () => {
  const db = new RecordingDb();
  const infraError = new Error('Database connection failed');
  db.query.shouldThrow = infraError;
  const source = new FirestorePendingTaskSource(db as any);
  try {
    const res = await source.fetchNextPendingTask();
    throw new Error(`Should have thrown infrastructure error but returned: ${JSON.stringify(res)}`);
  } catch (err: any) {
    if (err !== infraError) throw new Error('Error identity mismatch: original error not propagated');
  }
});

// 32. production file does not import firebase-admin/firestore, firebase-admin, or firebase-functions
registerTest('32. production file does not import firebase-admin/firestore, firebase-admin, or firebase-functions', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/firestorePendingTaskSource.ts'), 'utf8');
  const forbidden = ['firebase-admin', 'firebase-functions'];
  for (const f of forbidden) {
    if (content.includes(f)) throw new Error(`Forbidden import found: ${f}`);
  }
});

// 33. production file contains no write operations
registerTest('33. production file contains no write operations', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/firestorePendingTaskSource.ts'), 'utf8');
  const prohibited = ['.set(', '.update(', '.delete(', '.add(', '.create(', 'transaction(', 'batch('];
  for (const p of prohibited) {
    if (content.includes(p)) throw new Error(`Prohibited write operation: ${p}`);
  }
});

// 34. production file does not import/call: validateAIReviewTask, prepareAIReviewTaskForDelivery, prepareNextPendingTaskFromSource
registerTest('34. production file does not import/call: validateAIReviewTask, prepareAIReviewTaskForDelivery, prepareNextPendingTaskFromSource', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/firestorePendingTaskSource.ts'), 'utf8');
  const prohibited = ['validateAIReviewTask', 'prepareAIReviewTaskForDelivery', 'prepareNextPendingTaskFromSource'];
  for (const p of prohibited) {
    if (content.includes(p)) throw new Error(`Prohibited reference: ${p}`);
  }
});

// 35. production file contains no machine credential, machine authorization, or human RBAC logic
registerTest('35. production file contains no machine credential, machine authorization, or human RBAC logic', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/firestorePendingTaskSource.ts'), 'utf8');
  const prohibited = [
    'MachineIdentityVerifier', 'VerifiedMachinePrincipal', 'PEIAMachineCapability', 
    'credential', 'principalId', 'workerId', 'AdminRole', 'AdminPermission', 'AdminUser'
  ];
  for (const p of prohibited) {
    if (content.includes(p)) throw new Error(`Prohibited logic reference: ${p}`);
  }
});

// 36. functions/src/index.ts remains unwired
registerTest('36. functions/src/index.ts remains unwired', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/index.ts'), 'utf8');
  if (content.includes('FirestorePendingTaskSource')) throw new Error('Leaked into index.ts');
  if (content.includes('PEIA_PENDING_TASK_COLLECTION')) throw new Error('Leaked into index.ts');
});

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING PEIA-16M FIRESTORE PENDING TASK SOURCE TESTS');
  console.log('====================================================');
  
  if (tests.length !== 36) {
    console.error(`FATAL: Expected 36 tests, but found ${tests.length}`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (e) {
      failed++;
    }
  }
  
  console.log('----------------------------------------------------');
  console.log(`SUMMARY: ${passed} passed / ${tests.length} total / ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
