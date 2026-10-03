import * as fs from 'fs';
import * as path from 'path';
import {
  createFirestoreAdvisoryResultPersistenceRuntime,
  createProductionAdvisoryResultPersistenceRuntime,
} from '../functions/src/peia/firestoreAdvisoryResultPersistenceComposition';
import {
  createFirestoreAdvisoryResultReconciliationRuntime,
  FirestoreAdvisoryResultReconciliationHandler,
} from '../functions/src/peia/firestoreAdvisoryResultReconciliationComposition';
import {
  ReconciledAdvisoryResultIntake,
  AdvisoryResultTaskReconciliationError,
  reconcileAdvisoryResultTask,
} from '../functions/src/peia/advisoryResultTaskReconciliationBoundary';
import {
  AdvisoryResultPersistenceResult,
  AdvisoryResultPersistenceError,
  persistReconciledAdvisoryResult,
  AdvisoryResultRepository,
  ReconciledAdvisoryResultPersistenceRecord,
} from '../functions/src/peia/advisoryResultPersistenceBoundary';
import { AuthorizedAdvisoryResultIntake } from '../functions/src/peia/authorizedAdvisoryResultIntakeBoundary';
import { AITaskType, AITaskStatus } from '../src/types/aiTask';
import { AIReviewTargetType } from '../src/types/aiReview';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import {
  FirestoreAdvisoryResultRepository,
  type FirestoreDatabase,
  type FirestoreCollection,
  type FirestoreDocument,
  type FirestoreDocumentSnapshot,
} from '../functions/src/peia/firestoreAdvisoryResultRepository';
import { FirestoreAdvisoryResultTaskSource, type AdvisoryResultFirestoreQuery, type AdvisoryResultFirestoreReadDatabase } from '../functions/src/peia/firestoreAdvisoryResultTaskSource';
import { ValidationError } from '../functions/src/peia/aiTaskValidator';

const tests: { name: string; run: () => Promise<void> }[] = [];
let passedCount = 0;
let failedCount = 0;

async function registerTest(name: string, run: () => Promise<void>) {
  tests.push({ name, run });
}

// Fakes
function createFakeAuthorizedIntake(taskId: string): AuthorizedAdvisoryResultIntake {
  return {
    principal: {
      principalId: 'node-1',
      isActive: true,
      capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
    },
    request: {
      result: {
        task: {
          taskId,
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: 'news-1',
            sourceUpdatedAt: '2024-01-01T11:00:00Z',
          },
        },
        assessment: {
          summary: 'Safe',
          findings: [],
        },
      },
    },
  };
}

function createFakeReconciledIntake(authorizedIntake: AuthorizedAdvisoryResultIntake): ReconciledAdvisoryResultIntake {
  return {
    authorizedIntake,
    task: {
      taskId: authorizedIntake.request.result.task.taskId,
      taskType: authorizedIntake.request.result.task.taskType,
      status: AITaskStatus.Pending,
      createdAt: '2024-01-01T12:00:00Z',
      target: { ...authorizedIntake.request.result.task.target },
      contentSnapshot: { title: 'Auth' },
    },
  };
}

class FakeRepository implements AdvisoryResultRepository {
    public findCalls = 0;
    public saveCalls = 0;
    public savedRecord: ReconciledAdvisoryResultPersistenceRecord | null = null;
    public existingRecord: unknown | null = null;
    
    async findByTaskId(_taskId: string): Promise<unknown | null> {
        this.findCalls++;
        return this.existingRecord;
    }
    
    async save(record: ReconciledAdvisoryResultPersistenceRecord): Promise<void> {
        this.saveCalls++;
        this.savedRecord = record;
    }
}

// Repository error implementation for race safety
class FirestoreAlreadyExistsError extends Error {
  readonly code = 6;
  constructor() {
    super('Document already exists');
    this.name = 'FirestoreAlreadyExistsError';
  }
}

// 1. delegates reconciliation exactly once
registerTest('1. delegates reconciliation exactly once', async () => {
  let reconCalls = 0;
  const reconHandler = async (intake: AuthorizedAdvisoryResultIntake) => {
    reconCalls++;
    return createFakeReconciledIntake(intake);
  };
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  await runtime(createFakeAuthorizedIntake('task-1'));
  if (reconCalls !== 1) throw new Error(`Reconciliation called ${reconCalls} times`);
});

// 2. passes exact authorized intake into reconciliation
registerTest('2. passes exact authorized intake into reconciliation', async () => {
  const intake = createFakeAuthorizedIntake('task-1');
  const reconHandler = async (received: AuthorizedAdvisoryResultIntake) => {
    if (received !== intake) throw new Error('Intake mismatch');
    return createFakeReconciledIntake(received);
  };
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  await runtime(intake);
});

// 3. passes exact reconciled intake into persistence
registerTest('3. passes exact reconciled intake into persistence', async () => {
  const intake = createFakeAuthorizedIntake('task-1');
  const reconciled = createFakeReconciledIntake(intake);
  const reconHandler = async () => reconciled;
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  await runtime(intake);
  if (!repo.savedRecord || repo.savedRecord.reconciledTask !== reconciled.task) throw new Error('Task mismatch in persistence');
});

// 4. persistence called exactly once
registerTest('4. persistence called exactly once', async () => {
  const reconHandler = async (intake: AuthorizedAdvisoryResultIntake) => createFakeReconciledIntake(intake);
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  await runtime(createFakeAuthorizedIntake('task-1'));
  if (repo.saveCalls !== 1) throw new Error(`Save called ${repo.saveCalls} times`);
});

// 5. STORED returned unchanged
registerTest('5. STORED returned unchanged', async () => {
  const reconHandler = async (intake: AuthorizedAdvisoryResultIntake) => createFakeReconciledIntake(intake);
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  const result = await runtime(createFakeAuthorizedIntake('task-1'));
  if (result.disposition !== 'STORED') throw new Error(`Disposition mismatch: ${result.disposition}`);
});

// 6. ALREADY_IDENTICAL returned unchanged
registerTest('6. ALREADY_IDENTICAL returned unchanged', async () => {
  const intake = createFakeAuthorizedIntake('task-1');
  const reconciled = createFakeReconciledIntake(intake);
  const reconHandler = async () => reconciled;
  const repo = new FakeRepository();
  repo.existingRecord = {
      taskId: 'task-1',
      reconciledTask: reconciled.task,
      principal: intake.principal,
      advisoryResult: intake.request.result
  };
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  const result = await runtime(intake);
  if (result.disposition !== 'ALREADY_IDENTICAL') throw new Error(`Disposition mismatch: ${result.disposition}`);
});

// 7. reconciliation TASK_NOT_FOUND / equivalent propagates unchanged
registerTest('7. reconciliation TASK_NOT_FOUND / equivalent propagates unchanged', async () => {
  const reconHandler = async () => {
      throw new AdvisoryResultTaskReconciliationError('TASK_NOT_FOUND', 'Missing');
  };
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  try {
    await runtime(createFakeAuthorizedIntake('task-1'));
    throw new Error('Should have thrown');
  } catch (err: unknown) {
    if (!(err instanceof AdvisoryResultTaskReconciliationError) || err.code !== 'TASK_NOT_FOUND') {
        throw new Error('Wrong error propagated');
    }
  }
});

// 8. reconciliation canonical task validation failure propagates unchanged
registerTest('8. reconciliation canonical task validation failure propagates unchanged', async () => {
    const intake = createFakeAuthorizedIntake('task-1');
    const db: AdvisoryResultFirestoreReadDatabase = {
        collection: () => {
            const query: AdvisoryResultFirestoreQuery = {
                where: () => query,
                limit: () => query,
                get: async () => ({
                    docs: [{ data: () => ({ malformed: true }) }]
                })
            };
            return query;
        }
    };
    const reconHandler = createFirestoreAdvisoryResultReconciliationRuntime(db);
    const repo = new FakeRepository();
    const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);

    try {
        await runtime(intake);
        throw new Error('Should have thrown');
    } catch (err: unknown) {
        if (!(err instanceof ValidationError)) {
            throw new Error(`Expected ValidationError, got ${err instanceof Error ? err.name : typeof err}`);
        }
    }
});

// 9. reconciliation task-status failure propagates unchanged
registerTest('9. reconciliation task-status failure propagates unchanged', async () => {
    const intake = createFakeAuthorizedIntake('task-1');
    const task = createFakeReconciledIntake(intake).task;
    const db: AdvisoryResultFirestoreReadDatabase = {
        collection: () => {
            const query: AdvisoryResultFirestoreQuery = {
                where: () => query,
                limit: () => query,
                get: async () => ({
                    docs: [{ data: () => ({ ...task, status: AITaskStatus.Failed }) }]
                })
            };
            return query;
        }
    };
    const reconHandler = createFirestoreAdvisoryResultReconciliationRuntime(db);
    const repo = new FakeRepository();
    const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);

    try {
        await runtime(intake);
        throw new Error('Should have thrown');
    } catch (err: unknown) {
        if (!(err instanceof AdvisoryResultTaskReconciliationError) || err.code !== 'TASK_NOT_PENDING') {
            throw new Error('Expected TASK_NOT_PENDING');
        }
    }
});

// 10. persistence INVALID_EXISTING_RECORD propagates unchanged
registerTest('10. persistence INVALID_EXISTING_RECORD propagates unchanged', async () => {
  const reconHandler = async (intake: AuthorizedAdvisoryResultIntake) => createFakeReconciledIntake(intake);
  const repo = new FakeRepository();
  repo.existingRecord = { invalid: true };
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  try {
    await runtime(createFakeAuthorizedIntake('task-1'));
    throw new Error('Should have thrown');
  } catch (err: unknown) {
    if (!(err instanceof AdvisoryResultPersistenceError) || err.code !== 'INVALID_EXISTING_RECORD') {
        throw new Error('Wrong error propagated');
    }
  }
});

// 11. persistence TASK_IDENTITY_MISMATCH propagates unchanged
registerTest('11. persistence TASK_IDENTITY_MISMATCH propagates unchanged', async () => {
    const intake = createFakeAuthorizedIntake('task-1');
    const reconciled = createFakeReconciledIntake(intake);
    const reconHandler = async () => reconciled;
    
    const repo = new FakeRepository();
    const otherTask = { ...reconciled.task, taskId: 'other-id' };
    repo.existingRecord = {
        taskId: reconciled.task.taskId,
        reconciledTask: otherTask, // identity mismatch
        principal: intake.principal,
        advisoryResult: intake.request.result
    };
    
    const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
    
    try {
        await runtime(intake);
        throw new Error('Should have thrown');
    } catch (err: unknown) {
        if (!(err instanceof AdvisoryResultPersistenceError) || err.code !== 'TASK_IDENTITY_MISMATCH') {
            throw new Error(`Expected TASK_IDENTITY_MISMATCH, got ${err instanceof AdvisoryResultPersistenceError ? err.code : 'unknown'}`);
        }
    }
});

// 12. persistence RESULT_CONFLICT propagates unchanged
registerTest('12. persistence RESULT_CONFLICT propagates unchanged', async () => {
    const intake = createFakeAuthorizedIntake('task-1');
    const reconciled = createFakeReconciledIntake(intake);
    const reconHandler = async () => reconciled;
    
    const repo = new FakeRepository();
    repo.existingRecord = {
        taskId: reconciled.task.taskId,
        reconciledTask: reconciled.task,
        principal: { ...intake.principal, principalId: 'divergent-node' }, // divergent principal
        advisoryResult: intake.request.result
    };
    
    const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
    
    try {
        await runtime(intake);
        throw new Error('Should have thrown');
    } catch (err: unknown) {
        if (!(err instanceof AdvisoryResultPersistenceError) || err.code !== 'RESULT_CONFLICT') {
            throw new Error(`Expected RESULT_CONFLICT, got ${err instanceof AdvisoryResultPersistenceError ? err.code : 'unknown'}`);
        }
    }
});

// 13. Firestore read failure propagates unchanged
registerTest('13. Firestore read failure propagates unchanged', async () => {
    const intake = createFakeAuthorizedIntake('task-1');
    const expectedError = new Error('Database down');
    const db: AdvisoryResultFirestoreReadDatabase = {
        collection: () => {
            const query: AdvisoryResultFirestoreQuery = {
                where: () => query,
                limit: () => query,
                get: async () => { throw expectedError; }
            };
            return query;
        }
    };
    const reconHandler = createFirestoreAdvisoryResultReconciliationRuntime(db);
    const repo = new FakeRepository();
    const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);

    try {
        await runtime(intake);
        throw new Error('Should have thrown');
    } catch (err: unknown) {
        if (err !== expectedError) throw new Error('Error identity mismatch');
    }
});

// 14. Firestore create/write failure propagates unchanged
registerTest('14. Firestore create/write failure propagates unchanged', async () => {
  const infraError = new Error('Infra');
  const reconHandler = async (intake: AuthorizedAdvisoryResultIntake) => createFakeReconciledIntake(intake);
  const repo = new FakeRepository();
  repo.save = async () => { throw infraError; };
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  try {
    await runtime(createFakeAuthorizedIntake('task-1'));
    throw new Error('Should have thrown');
  } catch (err: unknown) {
    if (err !== infraError) throw new Error('Error mismatch');
  }
});

// 15. concurrent ALREADY_EXISTS-style create error propagates exact same object
registerTest('15. concurrent ALREADY_EXISTS-style create error propagates exact same object', async () => {
  const existsError = new FirestoreAlreadyExistsError();
  const reconHandler = async (intake: AuthorizedAdvisoryResultIntake) => createFakeReconciledIntake(intake);
  const repo = new FakeRepository();
  repo.save = async () => { throw existsError; };
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  try {
    await runtime(createFakeAuthorizedIntake('task-1'));
    throw new Error('Should have thrown');
  } catch (err: unknown) {
    if (err !== existsError) throw new Error('Error mismatch');
  }
});

// 16. authorized intake not mutated
registerTest('16. authorized intake not mutated', async () => {
  const intake = createFakeAuthorizedIntake('task-1');
  const originalJson = JSON.stringify(intake);
  const reconHandler = async (received: AuthorizedAdvisoryResultIntake) => createFakeReconciledIntake(received);
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  await runtime(intake);
  if (JSON.stringify(intake) !== originalJson) throw new Error('Intake mutated');
});

// 17. reconciled intake is not mutated
registerTest('17. reconciled intake is not mutated', async () => {
    const intake = createFakeAuthorizedIntake('task-1');
    const reconciled = createFakeReconciledIntake(intake);
    const snapshot = JSON.stringify(reconciled);
    const reconHandler = async () => reconciled;
    const repo = new FakeRepository();
    const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);

    await runtime(intake);
    if (JSON.stringify(reconciled) !== snapshot) {
        throw new Error('Reconciled intake was mutated');
    }
});

// 18. no prohibited workflow fields added
registerTest('18. no prohibited workflow fields added', async () => {
  const reconHandler = async (intake: AuthorizedAdvisoryResultIntake) => createFakeReconciledIntake(intake);
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  await runtime(createFakeAuthorizedIntake('task-1'));
  const saved = repo.savedRecord;
  if (!saved) throw new Error('Nothing saved');
  const stored: Record<string, unknown> = JSON.parse(JSON.stringify(saved));
  const prohibited = ['status', 'approved', 'rejected', 'published', 'completed', 'humanDecision'];
  for (const p of prohibited) {
      if (stored && p in stored) throw new Error(`Prohibited field found: ${p}`);
  }
});

// 19. no credential / secret / token / authorization exposure or storage
registerTest('19. no credential / secret / token / authorization exposure or storage', async () => {
  const reconHandler = async (intake: AuthorizedAdvisoryResultIntake) => createFakeReconciledIntake(intake);
  const repo = new FakeRepository();
  const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
  
  await runtime(createFakeAuthorizedIntake('task-1'));
  const saved = repo.savedRecord;
  if (!saved) throw new Error('Nothing saved');
  const stored: Record<string, unknown> = JSON.parse(JSON.stringify(saved));
  const prohibited = ['credential', 'secret', 'token', 'authorization'];
  for (const p of prohibited) {
      if (stored && p in stored) throw new Error(`Prohibited field found: ${p}`);
  }
});

// 20. no HTTP request/response contract introduced
registerTest('20. no HTTP request/response contract introduced', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultPersistenceComposition.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const prohibited = [
      'onRequest(',
      'Request',
      'Response',
      'express',
      'firebase-functions'
  ];
  for (const p of prohibited) {
      if (source.includes(p)) {
          const regex = new RegExp(`\\b${p.replace('(', '\\(')}`, 'g');
          if (regex.test(source)) {
              throw new Error(`Prohibited HTTP/Function term found: ${p}`);
          }
      }
  }
});

// 21. no Firebase onRequest / HTTP trigger introduced
registerTest('21. no Firebase onRequest / HTTP trigger introduced', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultPersistenceComposition.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  if (source.includes('onRequest')) throw new Error('onRequest found');
  if (source.includes('https.on')) throw new Error('Function trigger found');
});

// 22. production runtime wrapper uses accepted Firestore task-source and repository wiring
registerTest('22. production runtime wrapper uses accepted Firestore task-source and repository wiring', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultPersistenceComposition.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const expected = [
      'createFirestoreAdvisoryResultReconciliationRuntime',
      'FirestoreAdvisoryResultRepository',
      'createFirestoreAdvisoryResultPersistenceRuntime'
  ];
  for (const e of expected) {
      if (!source.includes(e)) throw new Error(`Missing expected wiring: ${e}`);
  }
});

// 23. Integration: full flow proof (hardened)
registerTest('23. Integration: full flow proof (hardened)', async () => {
    const intake = createFakeAuthorizedIntake('task-integration-1');
    const task = createFakeReconciledIntake(intake).task;
    
    const collections: Record<string, Record<string, { data: unknown }>> = {};
    
    const readDb: AdvisoryResultFirestoreReadDatabase = {
        collection: (name: string) => {
            const docs = collections[name] || {};
            return {
                where: (field: string, _op: string, value: unknown) => {
                    const filteredDocs = Object.values(docs).filter(d => {
                        if (typeof d.data === 'object' && d.data !== null) {
                            return (d.data as Record<string, unknown>)[field] === value;
                        }
                        return false;
                    });
                    const q: AdvisoryResultFirestoreQuery = {
                        where: (_f: string, _o: string, _v: unknown) => q,
                        limit: (_c: number) => q,
                        get: async () => ({
                            docs: filteredDocs.map(m => ({ data: () => m.data }))
                        })
                    };
                    return q;
                },
                limit: (_count: number) => {
                    const q: AdvisoryResultFirestoreQuery = {
                        where: (_f: string, _o: string, _v: unknown) => q,
                        limit: (_c: number) => q,
                        get: async () => ({ docs: [] })
                    };
                    return q;
                },
                get: async () => ({ docs: [] })
            };
        }
    };

    const writeDb: FirestoreDatabase = {
        collection: (name: string) => ({
            doc: (id: string) => {
                if (!collections[name]) collections[name] = {};
                const docs = collections[name];
                if (!docs[id]) {
                    docs[id] = { data: null };
                }
                return {
                    get: async () => ({ exists: docs[id].data !== null, data: () => docs[id].data }),
                    create: async (d: unknown) => { 
                        if (docs[id].data !== null) throw new FirestoreAlreadyExistsError(); 
                        docs[id].data = d; 
                        return {}; 
                    }
                };
            }
        })
    };
    
    const taskDoc = writeDb.collection('peiaReviewTasks').doc('authoritative-task-doc');
    await taskDoc.create(task);
    
    const reconciliationHandler = createFirestoreAdvisoryResultReconciliationRuntime(readDb);
    const repository = new FirestoreAdvisoryResultRepository(writeDb);
    const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconciliationHandler, repository);
    
    // Call 1: STORED
    const result1 = await runtime(intake);
    if (result1.disposition !== 'STORED') throw new Error(`Expected STORED, got ${result1.disposition}`);
    
    // Call 2: ALREADY_IDENTICAL
    const result2 = await runtime(intake);
    if (result2.disposition !== 'ALREADY_IDENTICAL') throw new Error(`Expected ALREADY_IDENTICAL, got ${result2.disposition}`);
});

// 24. concurrent create-only persistence error propagates unchanged
registerTest('24. concurrent create-only persistence error propagates unchanged', async () => {
    const intake = createFakeAuthorizedIntake('task-race-1');
    const reconciled = createFakeReconciledIntake(intake);
    const reconHandler = async () => reconciled;
    
    const existsError = new FirestoreAlreadyExistsError();
    const repo: AdvisoryResultRepository = {
        findByTaskId: async () => null, // simulate read-gap
        save: async () => { throw existsError; } // simulate race loss
    };
    
    const runtime = createFirestoreAdvisoryResultPersistenceRuntime(reconHandler, repo);
    
    try {
        await runtime(intake);
        throw new Error('Should have thrown');
    } catch (err: unknown) {
        if (err !== existsError) throw new Error('Error not propagated exactly');
    }
});


async function runTests() {
  console.log('Running PEIA Firestore Advisory Result Persistence Composition Tests...');
  for (const test of tests) {
    try {
      await test.run();
      console.log(`PASSED: ${test.name}`);
      passedCount++;
    } catch (err) {
      console.error(`FAILED: ${test.name}`);
      console.error(err);
      failedCount++;
    }
  }

  console.log('\n==================================================');
  console.log(`SUMMARY: ${passedCount} passed / ${tests.length} total / ${failedCount} failed`);
  console.log('==================================================\n');

  if (failedCount > 0 || tests.length < 23) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
