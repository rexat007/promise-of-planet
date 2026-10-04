import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { executeAdvisoryResultSubmission, type AdvisoryResultSubmissionRequest, type AdvisoryResultSubmissionResponse } from '../functions/src/peia/firebaseAdvisoryResultSubmissionEndpoint';
import { AITaskType, AITaskStatus } from '../src/types/aiTask';
import { AIReviewTargetType, AIReviewSeverity } from '../src/types/aiReview';
import { PEIAMachineCapability, MachineAuthorizationError, VerifiedMachinePrincipal, MachineIdentityVerifier } from '../functions/src/peia/machineAuthorizationBoundary';
import { OpaqueMachineIdentityVerifier, MachineCredentialBindingRepository } from '../functions/src/peia/machineCredentialVerifier';
import { PEIA_MACHINE_CREDENTIAL_COLLECTION } from '../functions/src/peia/firestoreMachineCredentialRepository';
import { ValidatedMachineCredentialDigest, MachineCredentialBinding } from '../functions/src/peia/machineCredentialContract';
import { AdvisoryResultPersistenceResult, AdvisoryResultPersistenceError } from '../functions/src/peia/advisoryResultPersistenceBoundary';
import { AdvisoryResultTaskReconciliationError } from '../functions/src/peia/advisoryResultTaskReconciliationBoundary';
import { ValidationError } from '../functions/src/peia/aiTaskValidator';
import { AuthorizedAdvisoryResultIntake } from '../functions/src/peia/authorizedAdvisoryResultIntakeBoundary';
import {
  createFirestoreAdvisoryResultPersistenceRuntime,
  FirestoreAdvisoryResultPersistenceHandler,
} from '../functions/src/peia/firestoreAdvisoryResultPersistenceComposition';
import {
  createFirestoreAdvisoryResultReconciliationRuntime,
} from '../functions/src/peia/firestoreAdvisoryResultReconciliationComposition';
import {
  FirestoreAdvisoryResultRepository,
  deriveAdvisoryResultDocumentId,
  type FirestoreDatabase,
} from '../functions/src/peia/firestoreAdvisoryResultRepository';
import {
  type AdvisoryResultFirestoreReadDatabase,
  type AdvisoryResultFirestoreQuery,
} from '../functions/src/peia/firestoreAdvisoryResultTaskSource';
import {
  uploadAdvisoryResultWithFetch,
  type AdvisoryResultHttpUploadInput,
  type AdvisoryResultHttpFetch,
  type AdvisoryResultHttpFetchInit,
  type AdvisoryResultHttpFetchResponse,
} from '../peia-worker/src/advisoryResultHttpUploadTransport';
import { type PEIAAdvisoryResult } from '../peia-worker/src/advisoryResultContract';

const tests: { name: string; run: () => Promise<void> }[] = [];
let passedCount = 0;
let failedCount = 0;

async function registerTest(name: string, run: () => Promise<void>) {
  tests.push({ name, run });
}

// Mock Request/Response classes
class MockRequest implements AdvisoryResultSubmissionRequest {
  public method: string = 'POST';
  public headers: Record<string, string> = {};
  public body: unknown = {};
  
  constructor(options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
    this.method = options.method || 'POST';
    this.headers = options.headers || {};
    this.body = options.body || {};
  }

  get(name: string): string | undefined {
    const key = name.toLowerCase();
    const found = Object.keys(this.headers).find(k => k.toLowerCase() === key);
    return found ? this.headers[found] : undefined;
  }
}

class MockResponse implements AdvisoryResultSubmissionResponse {
  public statusCode: number = 200;
  public headers: Record<string, string> = {};
  public body: unknown = null;
  public finished: boolean = false;

  status(code: number): MockResponse {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  json(data: unknown): void {
    this.body = data;
    this.finished = true;
  }
}

// Integration Fakes for Firestore
const collections: Record<string, Record<string, unknown>> = {};

// Helper to seed a machine credential
const VALID_TOKEN = 'peia_v1_1234567890123456789012345678901234567890123';

class FakeMachineCredentialRepository implements MachineCredentialBindingRepository {
    async findByCredentialDigest(digest: ValidatedMachineCredentialDigest): Promise<MachineCredentialBinding | null> {
        const record = collections[PEIA_MACHINE_CREDENTIAL_COLLECTION]?.[digest.value];
        if (!record || typeof record !== 'object') return null;
        const r = record as Record<string, unknown>;
        const principal = r.principal as VerifiedMachinePrincipal;
        return {
            credentialDigest: digest,
            principal
        };
    }
}

// Actually, 'VerifiedMachinePrincipal' has many fields. I'll just return it properly.

function seedMachine(principalId: string, credential: string = VALID_TOKEN, capabilities: string[] = [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT]) {
  const digest = createHash('sha256').update(credential, 'utf8').digest('hex');
  if (!collections[PEIA_MACHINE_CREDENTIAL_COLLECTION]) collections[PEIA_MACHINE_CREDENTIAL_COLLECTION] = {};
  collections[PEIA_MACHINE_CREDENTIAL_COLLECTION][digest] = {
    credentialScheme: 'OPAQUE_BEARER_V1',
    principal: {
      principalId,
      isActive: true,
      capabilities,
    },
    credentialDigest: {
      algorithm: 'SHA-256',
      value: digest,
    }
  };
}

function clearCollections(): void {
  for (const key in collections) delete collections[key];
}

// Setup common dependencies
function getDeps(persistenceMock?: (intake: AuthorizedAdvisoryResultIntake) => Promise<AdvisoryResultPersistenceResult>) {
  const repo = new FakeMachineCredentialRepository();
  const verifier = new OpaqueMachineIdentityVerifier(repo);
  const persistenceRuntime: FirestoreAdvisoryResultPersistenceHandler = persistenceMock || (async (intake: AuthorizedAdvisoryResultIntake): Promise<AdvisoryResultPersistenceResult> => {
    const taskId = (intake.request.result.task.taskId) || 't1';
    return { disposition: 'STORED', taskId };
  });
  return { verifier, persistenceRuntime };
}

function createValidResult() {
    return {
        result: {
            task: {
                taskId: 't1',
                taskType: AITaskType.CONTENT_REVIEW,
                target: {
                    targetType: AIReviewTargetType.News,
                    targetId: 'news1',
                    sourceUpdatedAt: '2024-01-01T12:00:00Z'
                }
            },
            assessment: {
                summary: 'OK',
                findings: []
            }
        }
    };
}

// 1. accepted HTTP method reaches submission flow
registerTest('1. accepted HTTP method reaches submission flow', async () => {
  clearCollections();
  seedMachine('m1', VALID_TOKEN);
  const req = new MockRequest({
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
    body: createValidResult()
  });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
});

// 2. unsupported method is rejected before authorization/persistence
registerTest('2. unsupported method is rejected before authorization/persistence', async () => {
  const req = new MockRequest({ method: 'GET' });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 405) throw new Error('Expected 405');
});

// 3. missing credential rejected
registerTest('3. missing credential rejected', async () => {
  const req = new MockRequest({});
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 401) throw new Error('Expected 401');
});

// 4. invalid credential rejected
registerTest('4. invalid credential rejected', async () => {
  clearCollections();
  const req = new MockRequest({ headers: { 'Authorization': `Bearer peia_v1_invalid_format_too_short` } });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 401) throw new Error('Expected 401');
});

// 5. inactive machine rejected
registerTest('5. inactive machine rejected', async () => {
  clearCollections();
  const credential = VALID_TOKEN;
  const digest = createHash('sha256').update(credential, 'utf8').digest('hex');
  collections[PEIA_MACHINE_CREDENTIAL_COLLECTION] = {
    [digest]: { 
        credentialScheme: 'OPAQUE_BEARER_V1',
        principal: { principalId: 'm1', isActive: false, capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT] }, 
        credentialDigest: { algorithm: 'SHA-256', value: digest } 
    }
  };
  const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` } });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 403) throw new Error(`Expected 403, got ${res.statusCode}`);
});

// 6. machine lacking SUBMIT_ADVISORY_RESULT rejected
registerTest('6. machine lacking SUBMIT_ADVISORY_RESULT rejected', async () => {
  clearCollections();
  seedMachine('m1', VALID_TOKEN, [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS]);
  const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` } });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 403) throw new Error(`Expected 403, got ${res.statusCode}`);
});

// 7. malformed body rejected
registerTest('7. malformed body rejected', async () => {
  clearCollections();
  seedMachine('m1', VALID_TOKEN);
  const req = new MockRequest({
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
    body: { not_result: {} }
  });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
});

// 8. invalid advisory result payload rejected
registerTest('8. invalid advisory result payload rejected', async () => {
    clearCollections();
    seedMachine('m1', VALID_TOKEN);
    const body = createValidResult();
    const invalidBody = JSON.parse(JSON.stringify(body));
    invalidBody.result.task.taskId = ''; // invalid
    const req = new MockRequest({
        headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
        body: invalidBody
    });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps());
    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
});

// 10. request-body principal cannot override server-authoritative principal
registerTest('10. request-body principal cannot override server-authoritative principal', async () => {
  clearCollections();
  seedMachine('m1', VALID_TOKEN);
  const req = new MockRequest({
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
    body: { ...createValidResult(), principal: { principalId: 'attacker' } }
  });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 400) throw new Error('Expected 400 due to strict validation of body');
});

// 12. STORED maps to 200
registerTest('12. STORED maps to 200', async () => {
    clearCollections();
    seedMachine('m1', VALID_TOKEN);
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps());
    if (res.statusCode !== 200) throw new Error('Expected 200');
});

// 13. ALREADY_IDENTICAL maps to 200
registerTest('13. ALREADY_IDENTICAL maps to 200', async () => {
    clearCollections();
    seedMachine('m1', VALID_TOKEN);
    const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => ({ disposition: 'ALREADY_IDENTICAL', taskId: 't1' });
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
    if (res.statusCode !== 200) throw new Error('Expected 200');
});

// 14. TASK_NOT_FOUND maps according to accepted HTTP policy
registerTest('14. TASK_NOT_FOUND maps according to accepted HTTP policy', async () => {
  const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { throw new AdvisoryResultTaskReconciliationError('TASK_NOT_FOUND', 'Not found'); };
  clearCollections();
  seedMachine('m1', VALID_TOKEN);
  const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
  if (res.statusCode !== 404) throw new Error(`Expected 404, got ${res.statusCode}`);
});

// 15. canonical validation failure maps to 400
registerTest('15. canonical validation failure maps to 400', async () => {
    const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { throw new ValidationError('Invalid task structure'); };
    clearCollections();
    seedMachine('m1', VALID_TOKEN);
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
    const bodyStr = JSON.stringify(res.body);
    if (bodyStr.includes('Invalid task structure')) throw new Error('Raw validation message leaked');
    const parsed = JSON.parse(bodyStr);
    if (parsed.error.message !== 'Invalid request.') throw new Error(`Expected "Invalid request.", got ${parsed.error.message}`);
});

// 16. TASK_NOT_PENDING maps according to accepted HTTP policy
registerTest('16. TASK_NOT_PENDING maps according to accepted HTTP policy', async () => {
  const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { throw new AdvisoryResultTaskReconciliationError('TASK_NOT_PENDING', 'Not pending'); };
  seedMachine('m1', VALID_TOKEN);
  const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
  if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
  const bodyStr = JSON.stringify(res.body);
  if (bodyStr.includes('Not pending')) throw new Error('Raw reconciliation message leaked');
  const parsed = JSON.parse(bodyStr);
  if (parsed.error.message !== 'Invalid request.') throw new Error(`Expected "Invalid request.", got ${parsed.error.message}`);
});

// 17. INVALID_EXISTING_RECORD maps according to accepted HTTP policy
registerTest('17. INVALID_EXISTING_RECORD maps according to accepted HTTP policy', async () => {
    const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { throw new AdvisoryResultPersistenceError('INVALID_EXISTING_RECORD', 'Invalid record'); };
    seedMachine('m1', VALID_TOKEN);
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
});

// 18. TASK_IDENTITY_MISMATCH maps according to accepted HTTP policy
registerTest('18. TASK_IDENTITY_MISMATCH maps according to accepted HTTP policy', async () => {
    const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { throw new AdvisoryResultPersistenceError('TASK_IDENTITY_MISMATCH', 'Mismatch'); };
    seedMachine('m1', VALID_TOKEN);
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
    if (res.statusCode !== 409) throw new Error(`Expected 409, got ${res.statusCode}`);
});

// 19. RESULT_CONFLICT maps according to accepted HTTP policy
registerTest('19. RESULT_CONFLICT maps according to accepted HTTP policy', async () => {
  const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { throw new AdvisoryResultPersistenceError('RESULT_CONFLICT', 'Conflict'); };
  seedMachine('m1', VALID_TOKEN);
  const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
  if (res.statusCode !== 409) throw new Error(`Expected 409, got ${res.statusCode}`);
});

// 20. Firestore/infrastructure read failure does not leak internals
registerTest('20. Firestore/infrastructure read failure does not leak internals', async () => {
    const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { throw new Error('internal_secret_info'); };
    clearCollections();
    seedMachine('m1', VALID_TOKEN);
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
    if (res.statusCode !== 500) throw new Error('Expected 500');
    const bodyStr = JSON.stringify(res.body);
    if (bodyStr.includes('internal_secret_info')) throw new Error('Info leaked');
});

// 22. concurrent ALREADY_EXISTS-style create race follows infrastructure error policy
registerTest('22. concurrent ALREADY_EXISTS-style create race follows infrastructure error policy', async () => {
    const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { 
        const err = new Error('Already exists');
        // Simulate gRPC ALREADY_EXISTS code
        Object.defineProperty(err, 'code', { value: 6 });
        throw err;
    };
    clearCollections();
    seedMachine('m1', VALID_TOKEN);
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
    if (res.statusCode !== 500) throw new Error('Expected 500 for race per prompt policy');
});

// 23. credential/token is never returned in success response
registerTest('23. credential/token is never returned in success response', async () => {
  clearCollections();
  seedMachine('m1', VALID_TOKEN);
  const req = new MockRequest({
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
    body: createValidResult()
  });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  const bodyStr = JSON.stringify(res.body);
  if (bodyStr.includes(VALID_TOKEN)) throw new Error('Token leaked in success response');
});

// 24. credential/token is never returned in error response
registerTest('24. credential/token is never returned in error response', async () => {
  clearCollections();
  const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` } });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  const bodyStr = JSON.stringify(res.body);
  if (bodyStr.includes(VALID_TOKEN)) throw new Error('Token leaked in error response');
});

// 27. persistence is not called on any authorization failure
registerTest('27. persistence is not called on any authorization failure', async () => {
    let called = false;
    const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { called = true; return { disposition: 'STORED', taskId: 't1' }; };
    const req = new MockRequest({ headers: { 'Authorization': `Bearer peia_v1_invalid_format_too_short` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
    if (called) throw new Error('Persistence called on auth failure');
});

// 28. persistence is not called on invalid body
registerTest('28. persistence is not called on invalid body', async () => {
    let called = false;
    const persistenceMock = async (): Promise<AdvisoryResultPersistenceResult> => { called = true; return { disposition: 'STORED', taskId: 't1' }; };
    clearCollections();
    seedMachine('m1', VALID_TOKEN);
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: { malformed: true } });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps(persistenceMock));
    if (called) throw new Error('Persistence called on invalid body');
});

// 29. endpoint does not mutate request payload
registerTest('29. endpoint does not mutate request payload', async () => {
    clearCollections();
    seedMachine('m1', VALID_TOKEN);
    const body = createValidResult();
    const original = JSON.stringify(body);
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps());
    if (JSON.stringify(body) !== original) throw new Error('Payload mutated');
});

// Integration Test: valid machine + valid result -> STORED -> ALREADY_IDENTICAL
registerTest('Integration: full cycle', async () => {
  clearCollections();
  seedMachine('m1', VALID_TOKEN);

  const taskId = 't1';
  const validBody = createValidResult();

  const authoritativeTask = {
    taskId,
    taskType: AITaskType.CONTENT_REVIEW,
    status: AITaskStatus.Pending,
    createdAt: '2024-01-01T12:00:00Z',
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news1',
      sourceUpdatedAt: '2024-01-01T12:00:00Z',
    },
    contentSnapshot: { title: 'Authoritative Snapshot' },
  };

  const tasksStorage: Record<string, Record<string, unknown>> = {
    [taskId]: authoritativeTask,
  };
  const resultsStorage: Record<string, unknown> = {};

  class FirestoreAlreadyExistsError extends Error {
    readonly code = 6;
    constructor() {
      super('Document already exists');
      this.name = 'FirestoreAlreadyExistsError';
    }
  }

  const fakeTaskReadDb: AdvisoryResultFirestoreReadDatabase = {
    collection: (_name: string) => {
      const q: AdvisoryResultFirestoreQuery = {
        where: (field: string, _op: string, value: unknown) => {
          const matching = Object.values(tasksStorage)
            .filter((t) => t[field] === value)
            .map((data) => ({ data: () => data }));
          const filteredQuery: AdvisoryResultFirestoreQuery = {
            where: () => filteredQuery,
            limit: () => filteredQuery,
            get: async () => ({ docs: matching }),
          };
          return filteredQuery;
        },
        limit: () => q,
        get: async () => ({ docs: [] }),
      };
      return q;
    },
  };

  const fakeResultWriteDb: FirestoreDatabase = {
    collection: (_name: string) => ({
      doc: (docId: string) => ({
        get: async () => ({
          exists: docId in resultsStorage,
          data: () => resultsStorage[docId],
        }),
        create: async (data: unknown) => {
          if (docId in resultsStorage) {
            throw new FirestoreAlreadyExistsError();
          }
          resultsStorage[docId] = data;
          return {};
        },
      }),
    }),
  };

  const credentialRepo = new FakeMachineCredentialRepository();
  const verifier = new OpaqueMachineIdentityVerifier(credentialRepo);

  const reconciliationHandler = createFirestoreAdvisoryResultReconciliationRuntime(fakeTaskReadDb);
  const repository = new FirestoreAdvisoryResultRepository(fakeResultWriteDb);
  const persistenceRuntime = createFirestoreAdvisoryResultPersistenceRuntime(
    reconciliationHandler,
    repository
  );

  const req1 = new MockRequest({
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
    body: validBody,
  });
  const res1 = new MockResponse();
  await executeAdvisoryResultSubmission(req1, res1, { verifier, persistenceRuntime });
  if (res1.statusCode !== 200) throw new Error(`First call failed: ${res1.statusCode}`);

  const docId = deriveAdvisoryResultDocumentId(taskId);
  if (!resultsStorage[docId]) throw new Error('Result was not stored');

  const res2 = new MockResponse();
  await executeAdvisoryResultSubmission(req1, res2, { verifier, persistenceRuntime });
  if (res2.statusCode !== 200) throw new Error(`Second call failed: ${res2.statusCode}`);
  if (!resultsStorage[docId]) throw new Error('Result did not remain');
});

// Worker Compatibility Assert
registerTest('Worker Compatibility Assertion', async () => {
  clearCollections();
  seedMachine('m1', VALID_TOKEN);

  const submittedTaskId = 'worker-compat-task-1';
  const workerResult: PEIAAdvisoryResult = {
    task: {
      taskId: submittedTaskId,
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'news-worker-compat-1',
        sourceUpdatedAt: '2024-01-01T12:00:00Z',
      },
    },
    assessment: {
      summary: 'Worker verified content successfully.',
      findings: [],
    },
  };

  let capturedMethod = '';
  let capturedAuthHeader: string | undefined = undefined;
  let capturedContentType: string | undefined = undefined;
  let capturedAccept: string | undefined = undefined;
  let capturedBodyString = '';
  let serverStatusCode = 0;

  const fakeFetcher: AdvisoryResultHttpFetch = async (_url: string, init: AdvisoryResultHttpFetchInit): Promise<AdvisoryResultHttpFetchResponse> => {
    capturedMethod = init.method;
    capturedAuthHeader = init.headers['Authorization'];
    capturedContentType = init.headers['Content-Type'];
    capturedAccept = init.headers['Accept'];
    capturedBodyString = init.body;

    const parsedBody: unknown = JSON.parse(init.body);
    const req = new MockRequest({
      method: init.method,
      headers: { ...init.headers },
      body: parsedBody,
    });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, getDeps());
    serverStatusCode = res.statusCode;

    return {
      status: res.statusCode,
      json: async () => res.body,
    };
  };

  const uploadInput: AdvisoryResultHttpUploadInput = {
    endpointUrl: 'https://localhost/api/peia/advisory-result',
    credential: VALID_TOKEN,
    result: workerResult,
  };

  const workerResponse = await uploadAdvisoryResultWithFetch(uploadInput, fakeFetcher);

  // 1. actual worker transport emits POST
  if (capturedMethod !== 'POST') {
    throw new Error(`Expected POST, got ${capturedMethod}`);
  }

  // 2. actual worker transport emits Authorization: Bearer <credential>
  if (capturedAuthHeader !== `Bearer ${VALID_TOKEN}`) {
    throw new Error(`Expected Bearer header, got ${capturedAuthHeader}`);
  }

  // 3. actual worker transport emits Content-Type: application/json
  if (capturedContentType !== 'application/json') {
    throw new Error(`Expected application/json Content-Type, got ${capturedContentType}`);
  }

  // 4. actual worker transport emits Accept: application/json
  if (capturedAccept !== 'application/json') {
    throw new Error(`Expected application/json Accept, got ${capturedAccept}`);
  }

  // 5. the actual serialized worker body is accepted by the server endpoint
  if (!capturedBodyString || capturedBodyString.length === 0) {
    throw new Error('Worker transport did not emit serialized body');
  }

  // 6. server returns HTTP 200
  if (serverStatusCode !== 200) {
    throw new Error(`Server returned status ${serverStatusCode}, expected 200`);
  }

  // 7 & 8. actual worker transport successfully parses server response and result is ACCEPTED
  if (workerResponse.kind !== 'ACCEPTED') {
    throw new Error(`Expected ACCEPTED, got ${workerResponse.kind}`);
  }
  if (workerResponse.value.ok !== true) {
    throw new Error('Expected ok: true in accepted response');
  }

  // 9. returned taskId is exactly the submitted taskId
  if (workerResponse.value.taskId !== submittedTaskId) {
    throw new Error(`Expected taskId ${submittedTaskId}, got ${workerResponse.value.taskId}`);
  }
});

// Index Export Assertion
registerTest('Index Export Assertion', async () => {
  const indexPath = path.join(process.cwd(), 'functions/src/index.ts');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  if (!indexContent.includes('export { peiaAdvisoryResultSubmission }')) {
    throw new Error('Endpoint not exported in index.ts');
  }
});

// 11. machine authentication system failure maps to 503
registerTest('11. machine authentication system failure maps to 503', async () => {
    const persistenceMock: FirestoreAdvisoryResultPersistenceHandler = async (): Promise<AdvisoryResultPersistenceResult> => ({ disposition: 'STORED', taskId: 't1' });
    const authError = new MachineAuthorizationError('MACHINE_AUTHENTICATION_FAILED', 'System busy');
    const verifierMock: MachineIdentityVerifier = {
        verify: async () => { throw authError; }
    };
    const req = new MockRequest({ headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }, body: createValidResult() });
    const res = new MockResponse();
    await executeAdvisoryResultSubmission(req, res, { verifier: verifierMock, persistenceRuntime: persistenceMock });
    if (res.statusCode !== 503) throw new Error(`Expected 503, got ${res.statusCode}`);
});

// 25. WWW-Authenticate header present on 401
registerTest('25. WWW-Authenticate header present on 401', async () => {
  const req = new MockRequest({});
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 401) throw new Error('Expected 401');
  if (res.headers['WWW-Authenticate'] !== 'Bearer') throw new Error('Missing WWW-Authenticate header');
});

// 26. Allow header present on 405
registerTest('26. Allow header present on 405', async () => {
  const req = new MockRequest({ method: 'PUT' });
  const res = new MockResponse();
  await executeAdvisoryResultSubmission(req, res, getDeps());
  if (res.statusCode !== 405) throw new Error('Expected 405');
  if (res.headers['Allow'] !== 'POST') throw new Error('Missing Allow header');
});

async function runTests() {
  console.log('Running PEIA Advisory Result HTTP Endpoint Tests...');
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

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
