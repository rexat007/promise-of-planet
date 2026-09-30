import {
  FirestoreAdvisoryResultTaskSource,
  FirestoreAdvisoryResultTaskSourceError,
} from '../functions/src/peia/firestoreAdvisoryResultTaskSource';
import { AdvisoryResultTaskSource } from '../functions/src/peia/advisoryResultTaskReconciliationBoundary';
import { PEIA_PENDING_TASK_COLLECTION } from '../functions/src/peia/firestorePendingTaskSource';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
}

const tests: TestResult[] = [];
let testCounter = 1;

function createMockDb(docs: Array<{ data: () => unknown }> = [{ data: () => ({ taskId: 'task-100', status: 'Pending' }) }]) {
  let collectionCalls = 0;
  let collectionNamePassed = '';
  let whereCalls = 0;
  let whereArgsPassed: { field: string; op: string; value: unknown } | null = null;
  let limitCalls = 0;
  let limitValuePassed: number | null = null;
  let getCalls = 0;
  let dataCalls = 0;

  const mockDocs = docs.map((doc) => ({
    data() {
      dataCalls++;
      return doc.data();
    },
  }));

  const mockQuery = {
    where(field: string, op: string, value: unknown) {
      whereCalls++;
      whereArgsPassed = { field, op, value };
      return mockQuery;
    },
    limit(count: number) {
      limitCalls++;
      limitValuePassed = count;
      return mockQuery;
    },
    async get() {
      getCalls++;
      return { docs: mockDocs };
    },
  };

  const mockDb = {
    collection(name: string) {
      collectionCalls++;
      collectionNamePassed = name;
      return mockQuery;
    },
  };

  return {
    db: mockDb,
    get collectionCalls() { return collectionCalls; },
    get collectionNamePassed() { return collectionNamePassed; },
    get whereCalls() { return whereCalls; },
    get whereArgsPassed() { return whereArgsPassed; },
    get limitCalls() { return limitCalls; },
    get limitValuePassed() { return limitValuePassed; },
    get getCalls() { return getCalls; },
    get dataCalls() { return dataCalls; },
  };
}

async function run() {
  // 1. FirestoreAdvisoryResultTaskSource exists
  try {
    const passed = typeof FirestoreAdvisoryResultTaskSource === 'function';
    tests.push({ id: testCounter++, name: '1. FirestoreAdvisoryResultTaskSource exists', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '1. FirestoreAdvisoryResultTaskSource exists', passed: false, message: err.message });
  }

  // 2. implements AdvisoryResultTaskSource structurally
  try {
    const mock = createMockDb();
    const source: AdvisoryResultTaskSource = new FirestoreAdvisoryResultTaskSource(mock.db);
    const passed = typeof source.fetchTaskById === 'function';
    tests.push({ id: testCounter++, name: '2. implements AdvisoryResultTaskSource structurally', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '2. implements AdvisoryResultTaskSource structurally', passed: false, message: err.message });
  }

  // 3. PEIA_PENDING_TASK_COLLECTION is reused from accepted adapter
  try {
    const passed = PEIA_PENDING_TASK_COLLECTION === 'peiaReviewTasks';
    tests.push({ id: testCounter++, name: '3. PEIA_PENDING_TASK_COLLECTION is reused from accepted adapter', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '3. PEIA_PENDING_TASK_COLLECTION is reused from accepted adapter', passed: false, message: err.message });
  }

  // 4. collection called exactly once
  try {
    const mock = createMockDb();
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    await source.fetchTaskById('task-100');
    const passed = mock.collectionCalls === 1;
    tests.push({ id: testCounter++, name: '4. collection called exactly once', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '4. collection called exactly once', passed: false, message: err.message });
  }

  // 5. collection receives exactly: peiaReviewTasks
  try {
    const mock = createMockDb();
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    await source.fetchTaskById('task-100');
    const passed = mock.collectionNamePassed === PEIA_PENDING_TASK_COLLECTION && mock.collectionNamePassed === 'peiaReviewTasks';
    tests.push({ id: testCounter++, name: '5. collection receives exactly: peiaReviewTasks', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '5. collection receives exactly: peiaReviewTasks', passed: false, message: err.message });
  }

  // 6. where called exactly once
  try {
    const mock = createMockDb();
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    await source.fetchTaskById('task-100');
    const passed = mock.whereCalls === 1;
    tests.push({ id: testCounter++, name: '6. where called exactly once', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '6. where called exactly once', passed: false, message: err.message });
  }

  // 7. where receives exactly: field = taskId, op = ==, value = supplied taskId
  try {
    const mock = createMockDb();
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    await source.fetchTaskById('task-100');
    const passed = !!mock.whereArgsPassed &&
                   mock.whereArgsPassed.field === 'taskId' &&
                   mock.whereArgsPassed.op === '==' &&
                   mock.whereArgsPassed.value === 'task-100';
    tests.push({ id: testCounter++, name: '7. where receives exactly: field = taskId, op = ==, value = supplied taskId', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '7. where receives exactly: field = taskId, op = ==, value = supplied taskId', passed: false, message: err.message });
  }

  // 8. supplied taskId reference/value is not trimmed or normalized
  try {
    const mock = createMockDb();
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    const paddedInput = ' task-raw-01 ';
    await source.fetchTaskById(paddedInput);
    const passed = !!mock.whereArgsPassed && mock.whereArgsPassed.value === paddedInput;
    tests.push({ id: testCounter++, name: '8. supplied taskId reference/value is not trimmed or normalized', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '8. supplied taskId reference/value is not trimmed or normalized', passed: false, message: err.message });
  }

  // 9. limit called exactly once
  try {
    const mock = createMockDb();
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    await source.fetchTaskById('task-100');
    const passed = mock.limitCalls === 1;
    tests.push({ id: testCounter++, name: '9. limit called exactly once', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '9. limit called exactly once', passed: false, message: err.message });
  }

  // 10. limit receives exactly 2
  try {
    const mock = createMockDb();
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    await source.fetchTaskById('task-100');
    const passed = mock.limitValuePassed === 2;
    tests.push({ id: testCounter++, name: '10. limit receives exactly 2', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '10. limit receives exactly 2', passed: false, message: err.message });
  }

  // 11. get called exactly once
  try {
    const mock = createMockDb();
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    await source.fetchTaskById('task-100');
    const passed = mock.getCalls === 1;
    tests.push({ id: testCounter++, name: '11. get called exactly once', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '11. get called exactly once', passed: false, message: err.message });
  }

  // 12. 0 docs returns null
  try {
    const mock = createMockDb([]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    const result = await source.fetchTaskById('task-absent');
    const passed = result === null;
    tests.push({ id: testCounter++, name: '12. 0 docs returns null', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '12. 0 docs returns null', passed: false, message: err.message });
  }

  // 13. 1 doc returns data successfully
  try {
    const expectedData = { taskId: 'task-100', status: 'Pending' };
    const mock = createMockDb([{ data: () => expectedData }]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    const result = await source.fetchTaskById('task-100');
    const passed = result === expectedData;
    tests.push({ id: testCounter++, name: '13. 1 doc returns data successfully', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '13. 1 doc returns data successfully', passed: false, message: err.message });
  }

  // 14. returned value preserves exact data() object reference
  try {
    const exactRef = { taskId: 'task-ref', arbitrary: 'object' };
    const mock = createMockDb([{ data: () => exactRef }]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    const result = await source.fetchTaskById('task-ref');
    const passed = result === exactRef;
    tests.push({ id: testCounter++, name: '14. returned value preserves exact data() object reference', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '14. returned value preserves exact data() object reference', passed: false, message: err.message });
  }

  // 15. data() called exactly once for one document
  try {
    const mock = createMockDb([{ data: () => ({ taskId: 'task-100' }) }]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    await source.fetchTaskById('task-100');
    const passed = mock.dataCalls === 1;
    tests.push({ id: testCounter++, name: '15. data() called exactly once for one document', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '15. data() called exactly once for one document', passed: false, message: err.message });
  }

  // 16. 2 docs → exact cardinality error
  try {
    const mock = createMockDb([
      { data: () => ({ taskId: 'task-dup' }) },
      { data: () => ({ taskId: 'task-dup' }) },
    ]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    let passed = false;
    try {
      await source.fetchTaskById('task-dup');
    } catch (err: any) {
      passed = err instanceof FirestoreAdvisoryResultTaskSourceError &&
               err.code === 'ADVISORY_RESULT_TASK_QUERY_CARDINALITY_INVALID' &&
               err.message === 'Firestore advisory result task lookup returned multiple records for one taskId.';
    }
    tests.push({ id: testCounter++, name: '16. 2 docs → exact cardinality error', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '16. 2 docs → exact cardinality error', passed: false, message: err.message });
  }

  // 17. 3 docs → exact cardinality error
  try {
    const mock = createMockDb([
      { data: () => ({ taskId: 'task-triple' }) },
      { data: () => ({ taskId: 'task-triple' }) },
      { data: () => ({ taskId: 'task-triple' }) },
    ]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    let passed = false;
    try {
      await source.fetchTaskById('task-triple');
    } catch (err: any) {
      passed = err instanceof FirestoreAdvisoryResultTaskSourceError &&
               err.code === 'ADVISORY_RESULT_TASK_QUERY_CARDINALITY_INVALID' &&
               err.message === 'Firestore advisory result task lookup returned multiple records for one taskId.';
    }
    tests.push({ id: testCounter++, name: '17. 3 docs → exact cardinality error', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '17. 3 docs → exact cardinality error', passed: false, message: err.message });
  }

  // 18. multiple-doc error occurs before any data() call
  try {
    const mock = createMockDb([
      { data: () => ({ taskId: 'task-dup' }) },
      { data: () => ({ taskId: 'task-dup' }) },
    ]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    let caughtError: any = null;
    try {
      await source.fetchTaskById('task-dup');
    } catch (err) {
      caughtError = err;
    }
    const passed = caughtError instanceof FirestoreAdvisoryResultTaskSourceError &&
                   caughtError.code === 'ADVISORY_RESULT_TASK_QUERY_CARDINALITY_INVALID' &&
                   caughtError.message === 'Firestore advisory result task lookup returned multiple records for one taskId.' &&
                   mock.dataCalls === 0;
    tests.push({ id: testCounter++, name: '18. multiple-doc error occurs before any data() call', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '18. multiple-doc error occurs before any data() call', passed: false, message: err.message });
  }

  // 19. one doc with null data → exact missing-data error
  try {
    const mock = createMockDb([{ data: () => null }]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    let passed = false;
    try {
      await source.fetchTaskById('task-null-data');
    } catch (err: any) {
      passed = err instanceof FirestoreAdvisoryResultTaskSourceError &&
               err.code === 'ADVISORY_RESULT_TASK_RECORD_MISSING_DATA' &&
               err.message === 'Firestore advisory result task record exists but contains null or undefined data.';
    }
    tests.push({ id: testCounter++, name: '19. one doc with null data → exact missing-data error', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '19. one doc with null data → exact missing-data error', passed: false, message: err.message });
  }

  // 20. one doc with undefined data → exact missing-data error
  try {
    const mock = createMockDb([{ data: () => undefined }]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    let passed = false;
    try {
      await source.fetchTaskById('task-undef-data');
    } catch (err: any) {
      passed = err instanceof FirestoreAdvisoryResultTaskSourceError &&
               err.code === 'ADVISORY_RESULT_TASK_RECORD_MISSING_DATA' &&
               err.message === 'Firestore advisory result task record exists but contains null or undefined data.';
    }
    tests.push({ id: testCounter++, name: '20. one doc with undefined data → exact missing-data error', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '20. one doc with undefined data → exact missing-data error', passed: false, message: err.message });
  }

  // 21. collection infrastructure throw propagates unchanged
  try {
    const infraErr = new Error('Firestore collection connection lost');
    const mockDb = {
      collection() {
        throw infraErr;
      },
    };
    const source = new FirestoreAdvisoryResultTaskSource(mockDb as any);
    let passed = false;
    try {
      await source.fetchTaskById('task-100');
    } catch (err: any) {
      passed = err === infraErr;
    }
    tests.push({ id: testCounter++, name: '21. collection infrastructure throw propagates unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '21. collection infrastructure throw propagates unchanged', passed: false, message: err.message });
  }

  // 22. where infrastructure throw propagates unchanged
  try {
    const infraErr = new Error('Firestore where clause invalid index');
    const mockQuery = {
      where() {
        throw infraErr;
      },
    };
    const mockDb = {
      collection() {
        return mockQuery;
      },
    };
    const source = new FirestoreAdvisoryResultTaskSource(mockDb as any);
    let passed = false;
    try {
      await source.fetchTaskById('task-100');
    } catch (err: any) {
      passed = err === infraErr;
    }
    tests.push({ id: testCounter++, name: '22. where infrastructure throw propagates unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '22. where infrastructure throw propagates unchanged', passed: false, message: err.message });
  }

  // 23. get infrastructure rejection propagates unchanged
  try {
    const infraErr = new Error('Firestore network timeout');
    const mockQuery = {
      where() { return mockQuery; },
      limit() { return mockQuery; },
      async get() { throw infraErr; },
    };
    const mockDb = { collection() { return mockQuery; } };
    const source = new FirestoreAdvisoryResultTaskSource(mockDb as any);
    let passed = false;
    try {
      await source.fetchTaskById('task-100');
    } catch (err: any) {
      passed = err === infraErr;
    }
    tests.push({ id: testCounter++, name: '23. get infrastructure rejection propagates unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '23. get infrastructure rejection propagates unchanged', passed: false, message: err.message });
  }

  // 24. data() throw propagates unchanged
  try {
    const dataErr = new Error('Corrupted document deserialization error');
    const mockDb = createMockDb([{ data() { throw dataErr; } }]);
    const source = new FirestoreAdvisoryResultTaskSource(mockDb.db);
    let passed = false;
    try {
      await source.fetchTaskById('task-100');
    } catch (err: any) {
      passed = err === dataErr;
    }
    tests.push({ id: testCounter++, name: '24. data() throw propagates unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '24. data() throw propagates unchanged', passed: false, message: err.message });
  }

  // 25. Completed task raw object is returned unchanged
  try {
    const completedTask = { taskId: 'task-completed', status: 'Completed', assessment: { summary: 'Done' } };
    const mock = createMockDb([{ data: () => completedTask }]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    const res = await source.fetchTaskById('task-completed');
    const passed = res === completedTask;
    tests.push({ id: testCounter++, name: '25. Completed task raw object is returned unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '25. Completed task raw object is returned unchanged', passed: false, message: err.message });
  }

  // 26. Failed task raw object is returned unchanged
  try {
    const failedTask = { taskId: 'task-failed', status: 'Failed', error: 'Internal worker crash' };
    const mock = createMockDb([{ data: () => failedTask }]);
    const source = new FirestoreAdvisoryResultTaskSource(mock.db);
    const res = await source.fetchTaskById('task-failed');
    const passed = res === failedTask;
    tests.push({ id: testCounter++, name: '26. Failed task raw object is returned unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '26. Failed task raw object is returned unchanged', passed: false, message: err.message });
  }

  // 27. production contains no status filtering / validation / Firebase runtime / writes
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultTaskSource.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');

    const noStatusFilter = !code.includes(".where('status'");
    const noValidation = !code.includes('AITaskStatus') &&
                         !code.includes('validateAIReviewTask') &&
                         !code.includes('reconcileAdvisoryResultTask');
    const noAuth = !code.includes('MachineIdentityVerifier') &&
                   !code.includes('authorizeAdvisoryResultSubmission');
    const noRuntime = !code.includes('firebase-admin') &&
                      !code.includes('firebase-functions') &&
                      !code.includes('getFirestore') &&
                      !code.includes('initializeApp');
    const noWrites = !code.includes('set(') &&
                     !code.includes('add(') &&
                     !code.includes('update(') &&
                     !code.includes('delete(') &&
                     !code.includes('transaction') &&
                     !code.includes('batch');
    const noCloningOrTrimming = !code.includes('JSON.parse') &&
                                !code.includes('JSON.stringify') &&
                                !code.includes('structuredClone') &&
                                !code.includes('.trim()');
    const noFetchHttp = !code.includes('fetch(');

    const passed = noStatusFilter && noValidation && noAuth && noRuntime && noWrites && noCloningOrTrimming && noFetchHttp;
    tests.push({ id: testCounter++, name: '27. production contains no status filtering / validation / Firebase runtime / writes', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '27. production contains no status filtering / validation / Firebase runtime / writes', passed: false, message: err.message });
  }

  // 28. final self-contained invariant + exact test-count gate
  try {
    const preCountMatch = tests.length === 27 && testCounter === 28;

    const sourcePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultTaskSource.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');

    // A. imports AdvisoryResultTaskSource as type
    const aMatch = code.includes('import type { AdvisoryResultTaskSource }') ||
                   code.includes('import { type AdvisoryResultTaskSource }') ||
                   (code.includes('AdvisoryResultTaskSource') && code.includes("from './advisoryResultTaskReconciliationBoundary'"));

    // B. imports PEIA_PENDING_TASK_COLLECTION from ./firestorePendingTaskSource
    const bMatch = code.includes('PEIA_PENDING_TASK_COLLECTION') &&
                   code.includes("from './firestorePendingTaskSource'");

    // C. AdvisoryResultFirestoreDocumentSnapshot exists
    const cMatch = code.includes('export interface AdvisoryResultFirestoreDocumentSnapshot');

    // D. document snapshot interface contains exactly one member: data(): unknown;
    const snapStart = code.indexOf('export interface AdvisoryResultFirestoreDocumentSnapshot');
    const snapSub = snapStart !== -1 ? code.slice(snapStart) : '';
    const snapEnd = snapSub.indexOf('}');
    const snapBlock = snapStart !== -1 && snapEnd !== -1 ? snapSub.slice(0, snapEnd + 1) : '';
    const snapMembers = snapBlock
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('export interface') && !line.startsWith('{') && !line.startsWith('}'));
    const dMatch = snapStart !== -1 &&
                   snapMembers.length === 1 &&
                   snapMembers[0] === 'data(): unknown;';

    // E. AdvisoryResultFirestoreQuerySnapshot exists
    const eMatch = code.includes('export interface AdvisoryResultFirestoreQuerySnapshot');

    // F. query snapshot contains exactly one field: readonly docs: readonly AdvisoryResultFirestoreDocumentSnapshot[];
    const qSnapStart = code.indexOf('export interface AdvisoryResultFirestoreQuerySnapshot');
    const qSnapSub = qSnapStart !== -1 ? code.slice(qSnapStart) : '';
    const qSnapEnd = qSnapSub.indexOf('}');
    const qSnapBlock = qSnapStart !== -1 && qSnapEnd !== -1 ? qSnapSub.slice(0, qSnapEnd + 1) : '';
    const qSnapMembers = qSnapBlock
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('export interface') && !line.startsWith('{') && !line.startsWith('}'));
    const fMatch = qSnapStart !== -1 &&
                   qSnapMembers.length === 1 &&
                   qSnapMembers[0] === 'readonly docs: readonly AdvisoryResultFirestoreDocumentSnapshot[];';

    // G. AdvisoryResultFirestoreQuery exists
    const gMatch = code.includes('export interface AdvisoryResultFirestoreQuery {') ||
                   code.includes('export interface AdvisoryResultFirestoreQuery\n');

    // H. query interface contains exactly three method declarations: where, limit, get
    const queryStart = code.indexOf('export interface AdvisoryResultFirestoreQuery {');
    const querySub = queryStart !== -1 ? code.slice(queryStart) : '';
    const queryEnd = querySub.indexOf('}');
    const queryBlock = queryStart !== -1 && queryEnd !== -1 ? querySub.slice(0, queryEnd + 1) : '';
    const queryMethods = queryBlock
      .split(';')
      .map((m) => m.replace(/\s+/g, ' ').trim())
      .filter((m) => m.includes('('));
    const hMatch = queryStart !== -1 &&
                   queryMethods.length === 3 &&
                   queryBlock.includes('where(') &&
                   queryBlock.includes('limit(count: number): AdvisoryResultFirestoreQuery;') &&
                   queryBlock.includes('get(): Promise<AdvisoryResultFirestoreQuerySnapshot>;');

    // I. no orderBy method in this adapter query interface
    const iMatch = !queryBlock.includes('orderBy');

    // J. AdvisoryResultFirestoreReadDatabase exists
    const jMatch = code.includes('export interface AdvisoryResultFirestoreReadDatabase');

    // K. database interface contains exactly one member: collection(name: string): AdvisoryResultFirestoreQuery;
    const dbStart = code.indexOf('export interface AdvisoryResultFirestoreReadDatabase');
    const dbSub = dbStart !== -1 ? code.slice(dbStart) : '';
    const dbEnd = dbSub.indexOf('}');
    const dbBlock = dbStart !== -1 && dbEnd !== -1 ? dbSub.slice(0, dbEnd + 1) : '';
    const dbMembers = dbBlock
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('export interface') && !line.startsWith('{') && !line.startsWith('}'));
    const kMatch = dbStart !== -1 &&
                   dbMembers.length === 1 &&
                   dbMembers[0] === 'collection(name: string): AdvisoryResultFirestoreQuery;';

    // L. error-code union contains exactly TWO codes
    const typeStart = code.indexOf('export type FirestoreAdvisoryResultTaskSourceErrorCode');
    const typeSub = typeStart !== -1 ? code.slice(typeStart) : '';
    const typeEnd = typeSub.indexOf(';');
    const typeBlock = typeStart !== -1 && typeEnd !== -1 ? typeSub.slice(0, typeEnd) : '';
    const codes = typeBlock
      .split('=')[1]
      ?.split('|')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean) || [];
    const lMatch = codes.length === 2 &&
                   codes.includes('ADVISORY_RESULT_TASK_QUERY_CARDINALITY_INVALID') &&
                   codes.includes('ADVISORY_RESULT_TASK_RECORD_MISSING_DATA');

    // M. both exact error messages exist
    const mMatch = code.includes("'Firestore advisory result task lookup returned multiple records for one taskId.'") &&
                   code.includes("'Firestore advisory result task record exists but contains null or undefined data.'");

    // N. FirestoreAdvisoryResultTaskSource implements AdvisoryResultTaskSource
    const nMatch = code.includes('export class FirestoreAdvisoryResultTaskSource') &&
                   code.includes('implements AdvisoryResultTaskSource');

    // O. constructor receives exactly one parameter: private readonly db: AdvisoryResultFirestoreReadDatabase
    const classStart = code.indexOf('export class FirestoreAdvisoryResultTaskSource\n');
    const classCode = classStart !== -1 ? code.slice(classStart) : code;
    const ctorStart = classCode.indexOf('constructor(');
    const ctorEnd = ctorStart !== -1 ? classCode.indexOf(')', ctorStart) : -1;
    const ctorParamListStr = ctorStart !== -1 && ctorEnd !== -1 ? classCode.slice(ctorStart + 'constructor('.length, ctorEnd).replace(/\s+/g, ' ').trim() : '';
    const ctorParams = ctorParamListStr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const oMatch = ctorStart !== -1 &&
                   ctorParams.length === 1 &&
                   ctorParams[0] === 'private readonly db: AdvisoryResultFirestoreReadDatabase';

    // P. fetchTaskById receives exactly one parameter: taskId: string and returns Promise<unknown | null>
    const fnStart = code.indexOf('async fetchTaskById(');
    const fnEnd = fnStart !== -1 ? code.indexOf('): Promise<unknown | null>', fnStart) : -1;
    const fnParamListStr = fnStart !== -1 && fnEnd !== -1 ? code.slice(fnStart + 'async fetchTaskById('.length, fnEnd) : '';
    const fnParams = fnParamListStr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const pMatch = fnStart !== -1 &&
                   fnEnd !== -1 &&
                   fnParams.length === 1 &&
                   fnParams[0] === 'taskId: string' &&
                   code.includes('async fetchTaskById(taskId: string): Promise<unknown | null>');

    // Q. collection(PEIA_PENDING_TASK_COLLECTION) occurs exactly once
    const qMatch = (code.match(/\.collection\(PEIA_PENDING_TASK_COLLECTION\)/g) || []).length === 1;

    // R. where('taskId', '==', taskId) occurs exactly once
    const rMatch = (code.match(/\.where\('taskId',\s*'==',\s*taskId\)/g) || []).length === 1;

    // S. limit(2) occurs exactly once
    const sMatch = (code.match(/\.limit\(2\)/g) || []).length === 1;

    // T. get() occurs exactly once
    const tMatch = (code.match(/\.get\(\)/g) || []).length === 1;

    // U. 0 docs returns null
    const uMatch = code.includes('snapshot.docs.length === 0') && code.includes('return null;');

    // V. docs.length > 1 throws exact cardinality error
    const vMatch = code.includes('snapshot.docs.length > 1') &&
                   code.includes("'ADVISORY_RESULT_TASK_QUERY_CARDINALITY_INVALID'");

    // W. exactly-one-doc data() called after cardinality checks
    const dataIdx = code.indexOf('snapshot.docs[0].data()');
    const cardIdx = code.indexOf('ADVISORY_RESULT_TASK_QUERY_CARDINALITY_INVALID');
    const wMatch = dataIdx !== -1 && cardIdx !== -1 && cardIdx < dataIdx;

    // X. null AND undefined check required for missing-data error
    const xMatch = code.includes('data === null') &&
                   code.includes('data === undefined') &&
                   code.includes("'ADVISORY_RESULT_TASK_RECORD_MISSING_DATA'");

    // Y. complete negative coupling gate
    const yMatch = code.includes('return data;') &&
                   !code.includes(".where('status'") &&
                   !code.includes('AITaskStatus') &&
                   !code.includes('validateAIReviewTask') &&
                   !code.includes('reconcileAdvisoryResultTask(') &&
                   !code.includes('MachineIdentityVerifier') &&
                   !code.includes('authorizeAdvisoryResultSubmission') &&
                   !code.includes('firebase-admin') &&
                   !code.includes('firebase-functions') &&
                   !code.includes('getFirestore') &&
                   !code.includes('initializeApp') &&
                   !code.includes('structuredClone') &&
                   !code.includes('JSON.parse') &&
                   !code.includes('JSON.stringify') &&
                   !code.includes('.trim()') &&
                   !code.includes('.set(') &&
                   !code.includes('.add(') &&
                   !code.includes('.update(') &&
                   !code.includes('.delete(') &&
                   !code.includes('transaction') &&
                   !code.includes('batch');

    const allMatched = preCountMatch && aMatch && bMatch && cMatch && dMatch && eMatch &&
                       fMatch && gMatch && hMatch && iMatch && jMatch && kMatch && lMatch &&
                       mMatch && nMatch && oMatch && pMatch && qMatch && rMatch && sMatch &&
                       tMatch && uMatch && vMatch && wMatch && xMatch && yMatch;

    tests.push({
      id: testCounter++,
      name: '28. final self-contained invariant + exact test-count gate',
      passed: allMatched,
      message: allMatched ? undefined : `pre:${preCountMatch} A:${aMatch} B:${bMatch} C:${cMatch} D:${dMatch} E:${eMatch} F:${fMatch} G:${gMatch} H:${hMatch} I:${iMatch} J:${jMatch} K:${kMatch} L:${lMatch} M:${mMatch} N:${nMatch} O:${oMatch} P:${pMatch} Q:${qMatch} R:${rMatch} S:${sMatch} T:${tMatch} U:${uMatch} V:${vMatch} W:${wMatch} X:${xMatch} Y:${yMatch}`,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '28. final self-contained invariant', passed: false, message: err.message });
  }

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA FIRESTORE ADVISORY RESULT TASK SOURCE TESTS');
  console.log('====================================================\n');

  let failed = 0;
  for (const t of tests) {
    if (t.passed) {
      console.log(`✅ [${t.id}] ${t.name}`);
    } else {
      failed++;
      console.error(`❌ [${t.id}] ${t.name}`);
      if (t.message) {
        console.error(`   ${t.message}`);
      }
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY: ${tests.length - failed} passed / ${tests.length} total / ${failed} failed`);
  console.log('----------------------------------------------------');

  if (failed > 0 || tests.length !== 28 || testCounter !== 29) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
