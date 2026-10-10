import {
  executeNonAdvisoryOutcomeSubmission,
  mapNonAdvisoryOutcomeHttpSuccess,
  mapNonAdvisoryOutcomeHttpError,
} from '../functions/src/peia/firebaseNonAdvisoryOutcomeSubmissionEndpoint';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import { NonAdvisoryOutcomePersistenceError } from '../functions/src/peia/nonAdvisoryOutcomePersistenceBoundary';
import { createFirestoreNonAdvisoryOutcomePersistenceRuntime } from '../functions/src/peia/firestoreNonAdvisoryOutcomePersistenceComposition';
import {
  FirestoreNonAdvisoryOutcomeRepository,
  deriveNonAdvisoryOutcomeDocumentId,
} from '../functions/src/peia/firestoreNonAdvisoryOutcomeRepository';
import { AITaskStatus, AITaskType, AIReviewTask } from '../functions/src/types/aiTask';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- Running PEIA Non-Advisory Outcome Endpoint Tests ---');

const mockVerifier = {
  verify: async (token: unknown) => {
    if (token === 'valid-token') {
      return {
        principalId: 'p-1',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      };
    }
    return null;
  },
};

const mockPersistenceRuntime = async (authorizedIntake: any) => {
  return {
    taskId: authorizedIntake.request.outcome.taskId,
    disposition: 'STORED' as const,
    convergedStatus: 'Completed' as const,
  };
};

class MockResponse {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public jsonBody: any = null;

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: any) {
    this.jsonBody = body;
  }
}

async function testHttpSuccess() {
  const req = {
    method: 'POST',
    get: (headerName: string) => {
      if (headerName.toLowerCase() === 'authorization') {
        return 'Bearer valid-token';
      }
      return undefined;
    },
    body: {
      outcome: {
        taskId: 'task-endpoint-1',
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: new Date().toISOString(),
      },
    },
  };

  const res = new MockResponse();

  await executeNonAdvisoryOutcomeSubmission(req as any, res as any, {
    verifier: mockVerifier,
    persistenceRuntime: mockPersistenceRuntime,
  });

  assert(res.statusCode === 200, 'HTTP status is 200');
  assert(res.jsonBody?.ok === true, 'Response ok is true');
  assert(res.jsonBody?.taskId === 'task-endpoint-1', 'Response taskId matches');
}

async function testHttpUnauthenticated() {
  const req = {
    method: 'POST',
    get: () => undefined,
    body: {},
  };

  const res = new MockResponse();

  await executeNonAdvisoryOutcomeSubmission(req as any, res as any, {
    verifier: mockVerifier,
    persistenceRuntime: mockPersistenceRuntime,
  });

  assert(res.statusCode === 401, 'HTTP status is 401 for missing token');
  assert(res.jsonBody?.ok === false, 'Response ok is false');
  assert(res.jsonBody?.error?.code === 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');
}

async function testHttpAlreadyIdentical() {
  const req = {
    method: 'POST',
    get: (headerName: string) => {
      if (headerName.toLowerCase() === 'authorization') {
        return 'Bearer valid-token';
      }
      return undefined;
    },
    body: {
      outcome: {
        taskId: 'task-endpoint-1',
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: new Date().toISOString(),
      },
    },
  };

  const res = new MockResponse();

  const identicalRuntime = async (authorizedIntake: any) => ({
    taskId: authorizedIntake.request.outcome.taskId,
    disposition: 'ALREADY_IDENTICAL' as const,
    convergedStatus: 'Completed' as const,
  });

  await executeNonAdvisoryOutcomeSubmission(req as any, res as any, {
    verifier: mockVerifier,
    persistenceRuntime: identicalRuntime,
  });

  assert(res.statusCode === 200, 'HTTP status is 200 for ALREADY_IDENTICAL');
  assert(res.jsonBody?.ok === true, 'Response ok is true');
  assert(res.jsonBody?.taskId === 'task-endpoint-1', 'Response taskId matches');
}

async function testHttpResultConflict() {
  const req = {
    method: 'POST',
    get: (headerName: string) => {
      if (headerName.toLowerCase() === 'authorization') {
        return 'Bearer valid-token';
      }
      return undefined;
    },
    body: {
      outcome: {
        taskId: 'task-endpoint-1',
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: new Date().toISOString(),
      },
    },
  };

  const res = new MockResponse();

  const conflictRuntime = async () => {
    throw new NonAdvisoryOutcomePersistenceError('RESULT_CONFLICT', 'Divergent outcome for taskId.');
  };

  await executeNonAdvisoryOutcomeSubmission(req as any, res as any, {
    verifier: mockVerifier,
    persistenceRuntime: conflictRuntime,
  });

  assert(res.statusCode === 409, 'HTTP status is 409 for RESULT_CONFLICT');
  assert(res.jsonBody?.ok === false, 'Response ok is false');
  assert(res.jsonBody?.error?.code === 'CONFLICT', 'Error code is CONFLICT');
}

async function testHttpRealCompositionLostResponseReplay() {
  const taskId = 'task-endpoint-real-comp-1';
  const now = new Date().toISOString();

  // Create mock DB harness for real composition
  class EndpointMockFirestoreDb {
    public docsMap = new Map<string, any>();
    public taskDocs = new Map<string, { id: string; data: any }>();
    public createCount = 0;
    public updateCount = 0;

    constructor() {
      const initialTask: AIReviewTask = {
        taskId,
        taskType: AITaskType.CONTENT_REVIEW,
        status: AITaskStatus.Pending,
        target: {
          targetType: 'News' as any,
          targetId: 'target-endpoint-real-1',
          sourceUpdatedAt: now,
        },
        contentSnapshot: { title: 'T', body: 'B' },
        createdAt: now,
      };
      this.taskDocs.set('task-doc-ep-1', {
        id: 'task-doc-ep-1',
        data: initialTask,
      });
    }

    collection(collName: string) {
      const self = this;
      return {
        doc(docId: string) {
          return { id: docId };
        },
        where(field: string, op: string, value: any) {
          return {
            limit(count: number) {
              return {
                _isTaskQuery: true,
                collName,
                field,
                op,
                value,
                limitCount: count,
                async get() {
                  const matches = Array.from(self.taskDocs.values())
                    .filter((t) => t.data.taskId === value)
                    .map((t) => ({
                      ref: { id: t.id },
                      data: () => t.data,
                    }));
                  return { docs: matches.slice(0, count) };
                },
              };
            },
          };
        },
      };
    }

    async runTransaction<T>(updateFn: (tx: any) => Promise<T>): Promise<T> {
      const self = this;
      const tx = {
        async get(target: any) {
          if (target && target._isTaskQuery) {
            const matches = Array.from(self.taskDocs.values())
              .filter((t) => t.data.taskId === target.value)
              .map((t) => ({
                ref: { id: t.id },
                data: () => t.data,
              }));
            return { docs: matches.slice(0, target.limitCount) };
          }
          const docId = target.id;
          const existing = self.docsMap.get(docId);
          return {
            exists: existing !== undefined,
            data: () => existing,
          };
        },
        create(ref: any, data: any) {
          if (self.docsMap.has(ref.id)) {
            const err: any = new Error(`Document ${ref.id} already exists`);
            err.code = 6;
            throw err;
          }
          self.createCount++;
          self.docsMap.set(ref.id, JSON.parse(JSON.stringify(data)));
        },
        update(ref: any, data: any) {
          const existing = self.taskDocs.get(ref.id);
          if (!existing) {
            throw new Error(`Task document ${ref.id} not found`);
          }
          self.updateCount++;
          Object.assign(existing.data, data);
        },
      };
      return updateFn(tx);
    }
  }

  const db = new EndpointMockFirestoreDb();
  const repo = new FirestoreNonAdvisoryOutcomeRepository(db as any);
  const realCompositionRuntime = createFirestoreNonAdvisoryOutcomePersistenceRuntime(db as any, repo);

  const req1 = {
    method: 'POST',
    get: (headerName: string) => {
      if (headerName.toLowerCase() === 'authorization') {
        return 'Bearer valid-token';
      }
      return undefined;
    },
    body: {
      outcome: {
        taskId,
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: now,
      },
    },
  };

  const res1 = new MockResponse();

  // REQUEST 1: First submission -> HTTP 200
  await executeNonAdvisoryOutcomeSubmission(req1 as any, res1 as any, {
    verifier: mockVerifier,
    persistenceRuntime: realCompositionRuntime,
  });

  assert(res1.statusCode === 200, 'Request 1: HTTP status is 200');
  assert(res1.jsonBody?.ok === true, 'Request 1: response ok is true');
  assert(res1.jsonBody?.taskId === taskId, 'Request 1: taskId matches');
  assert(res1.jsonBody?.disposition === undefined, 'Request 1: disposition remains hidden');

  const outcomeDocId = deriveNonAdvisoryOutcomeDocumentId(taskId);
  assert(db.docsMap.has(outcomeDocId), 'Request 1: outcome doc persisted');
  assert(db.createCount === 1, 'Request 1: createCount is 1');
  assert(db.updateCount === 1, 'Request 1: updateCount is 1 (task transitioned)');
  assert(db.taskDocs.get('task-doc-ep-1')?.data.status === AITaskStatus.Completed, 'Request 1: task is Completed');

  const storedOutcome1 = db.docsMap.get(outcomeDocId);
  const originalConvergedAt = storedOutcome1.convergedAt;

  // REQUEST 2: Exact same request after first persistence completes (lost-response replay)
  const req2 = {
    method: 'POST',
    get: (headerName: string) => {
      if (headerName.toLowerCase() === 'authorization') {
        return 'Bearer valid-token';
      }
      return undefined;
    },
    body: {
      outcome: {
        taskId,
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: now,
      },
    },
  };

  const res2 = new MockResponse();

  await executeNonAdvisoryOutcomeSubmission(req2 as any, res2 as any, {
    verifier: mockVerifier,
    persistenceRuntime: realCompositionRuntime,
  });

  assert(res2.statusCode === 200, 'Request 2: HTTP status is 200 on lost-response replay');
  assert(res2.jsonBody?.ok === true, 'Request 2: response ok is true');
  assert(res2.jsonBody?.taskId === taskId, 'Request 2: taskId matches');
  assert(res2.jsonBody?.disposition === undefined, 'Request 2: disposition remains hidden');

  // Verify zero additional creates or updates
  assert(db.createCount === 1, 'Request 2: zero duplicate outcome writes (createCount still 1)');
  assert(db.updateCount === 1, 'Request 2: zero task rewrites (updateCount still 1)');

  const storedOutcome2 = db.docsMap.get(outcomeDocId);
  assert(storedOutcome2.convergedAt === originalConvergedAt, 'Request 2: original convergedAt preserved');
}

async function run() {
  await testHttpSuccess();
  await testHttpUnauthenticated();
  await testHttpAlreadyIdentical();
  await testHttpResultConflict();
  await testHttpRealCompositionLostResponseReplay();
  console.log('PASSED: All PEIA Non-Advisory Outcome Endpoint tests passed.');
}

run().catch((err) => {
  console.error('FAILED with error:', err);
  process.exit(1);
});
