import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { type AddressInfo } from 'node:net';

import { AITaskType, AITaskStatus, type AIReviewTask } from '../src/types/aiTask';
import { AIReviewTargetType } from '../src/types/aiReview';
import { validateAIReviewTask } from '../functions/src/peia/aiTaskValidator';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import { OpaqueMachineIdentityVerifier } from '../functions/src/peia/machineCredentialVerifier';
import {
  FirestoreMachineCredentialBindingRepository,
  PEIA_MACHINE_CREDENTIAL_COLLECTION,
} from '../functions/src/peia/firestoreMachineCredentialRepository';
import { createFirestoreTaskGateway } from '../functions/src/peia/firestoreTaskGatewayComposition';
import {
  executePendingTaskHttpRequest,
  type PendingTaskHttpRequest,
} from '../functions/src/peia/taskGatewayHttpRequestAdapter';
import {
  mapPendingTaskHttpSuccess,
  mapPendingTaskHttpError,
} from '../functions/src/peia/taskGatewayHttpResponseMapper';
import {
  executeFirebasePendingTaskHttpEndpoint,
  type PendingTaskHttpResponseWriter,
} from '../functions/src/peia/firebasePendingTaskHttpEndpoint';
import {
  executeAdvisoryResultSubmission,
  type AdvisoryResultSubmissionRequest,
  type AdvisoryResultSubmissionResponse,
} from '../functions/src/peia/firebaseAdvisoryResultSubmissionEndpoint';
import {
  executeNonAdvisoryOutcomeSubmission,
  type NonAdvisoryOutcomeSubmissionRequest,
  type NonAdvisoryOutcomeSubmissionResponse,
} from '../functions/src/peia/firebaseNonAdvisoryOutcomeSubmissionEndpoint';
import { createFirestoreAdvisoryResultPersistenceRuntime } from '../functions/src/peia/firestoreAdvisoryResultPersistenceComposition';
import { createFirestoreAdvisoryResultReconciliationRuntime } from '../functions/src/peia/firestoreAdvisoryResultReconciliationComposition';
import {
  FirestoreAdvisoryResultRepository,
  deriveAdvisoryResultDocumentId,
  PEIA_ADVISORY_RESULT_COLLECTION,
  PEIA_PENDING_TASK_COLLECTION,
} from '../functions/src/peia/firestoreAdvisoryResultRepository';
import { createFirestoreNonAdvisoryOutcomePersistenceRuntime } from '../functions/src/peia/firestoreNonAdvisoryOutcomePersistenceComposition';
import {
  FirestoreNonAdvisoryOutcomeRepository,
  deriveNonAdvisoryOutcomeDocumentId,
  PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
} from '../functions/src/peia/firestoreNonAdvisoryOutcomeRepository';

import { downloadAndPersistPendingTask } from '../peia-worker/src/downloadToLocalPersistence';
import { SqlitePendingTaskRepository } from '../peia-worker/src/sqlitePendingTaskRepository';
import { SqliteTaskProcessingLifecycleRepository } from '../peia-worker/src/sqliteTaskProcessingLifecycleRepository';
import { SqliteAdvisoryResultOutboxRepository } from '../peia-worker/src/sqliteAdvisoryResultOutboxRepository';
import { type StoredAdvisoryResultRecord } from '../peia-worker/src/localAdvisoryResultOutboxContract';
import { SqliteNonAdvisoryOutcomeRepository } from '../peia-worker/src/sqliteNonAdvisoryOutcomeRepository';
import { type DurableNonAdvisoryOutcomeRecord } from '../peia-worker/src/localNonAdvisoryOutcomeContract';
import { processLocalTask } from '../peia-worker/src/localTaskProcessingOrchestrator';
import { createNOAAHttpKnowledgeTransport } from '../peia-worker/src/noaaHttpKnowledgeTransport';
import { routeMultiSourceRetrieval } from '../peia-worker/src/multiSourceKnowledgeRetrievalRouter';
import { selectLocalEvidence } from '../peia-worker/src/localEvidenceSelectionFoundation';
import { TaskProcessingState } from '../peia-worker/src/localTaskProcessingLifecycleContract';
import { runResultSubmissionCycle } from '../peia-worker/src/localResultSubmissionCycle';
import { uploadAdvisoryResult } from '../peia-worker/src/advisoryResultHttpUploadTransport';
import { uploadNonAdvisoryOutcome } from '../peia-worker/src/nonAdvisoryOutcomeHttpReportTransport';
import {
  type LocalAnalysisRuntimeConfig,
} from '../peia-worker/src/localAnalysisRuntime';

export const ACCEPTANCE_BASELINE = '3b34de2d621bf8b598b5a1b4f638a5d10972eb3a';
export const TEST_TASK_ID = 'task-final-real-e2e-001';
export const TEST_TARGET_ID = 'news-final-real-e2e-001';
export const TEST_PRINCIPAL_ID = 'node-final-real-e2e';
export const TEST_RETRIEVAL_QUERY = 'sea surface temperature anomaly coastal ocean';

interface AcceptanceDiagnostics {
  taskId: string;
  loopbackPort: number;
  downloadResult: string;
  localSqliteStoredTask: string;
  requestedSources: readonly string[];
  noaaRetrievalKind: string;
  noaaEvidenceCount: number;
  firstNoaaItemId: string;
  firstNoaaHostname: string;
  selectedEvidenceCount: number;
  platform: string;
  arch: string;
  qwenExecutableBasename: string;
  modelBasename: string;
  modelSha256Status: string;
  modelAttempts: number;
  qwenProcessingWallDurationMs: number;
  processingResultKind: string;
  durableRecordPresent: boolean;
  serverSubmissionHttpResult: string;
  serverPersistedResultType: string;
  serverTaskStatus: string;
  workerFinalLifecycle: string;
  replayResult: string;
  humanReviewRequiredStatus: string;
  noAutonomousContentActionVerified: boolean;
  overallAcceptance: string;
}

function reportStageFailure(stage: string, message: string): never {
  console.error('\n==================================================');
  console.error('PEIA FINAL REAL E2E ACCEPTANCE HARNESS: STAGE FAILURE');
  console.error('==================================================');
  console.error(`STAGE: ${stage}`);
  console.error(`ERROR: ${message}`);
  console.error('EXIT CODE: 1');
  console.error('==================================================\n');
  process.exit(1);
}

function printAcceptanceReport(d: AcceptanceDiagnostics): void {
  console.log('\n==================================================');
  console.log('PEIA FINAL REAL E2E ACCEPTANCE REPORT');
  console.log('==================================================');
  console.log(`BASELINE: ${ACCEPTANCE_BASELINE}`);
  console.log(`TASK ID: ${d.taskId}`);
  console.log(`LOOPBACK PORT: ${d.loopbackPort}`);
  console.log(`DOWNLOAD RESULT: ${d.downloadResult}`);
  console.log(`LOCAL SQLITE STORED TASK: ${d.localSqliteStoredTask}`);
  console.log(`REQUESTED SOURCES: ${JSON.stringify(d.requestedSources)}`);
  console.log(`NOAA RETRIEVAL KIND: ${d.noaaRetrievalKind}`);
  console.log(`NOAA EVIDENCE COUNT: ${d.noaaEvidenceCount}`);
  console.log(`FIRST NOAA ITEM ID: ${d.firstNoaaItemId}`);
  console.log(`FIRST NOAA HOSTNAME: ${d.firstNoaaHostname}`);
  console.log(`SELECTED EVIDENCE COUNT: ${d.selectedEvidenceCount}`);
  console.log(`PLATFORM: ${d.platform}`);
  console.log(`ARCH: ${d.arch}`);
  console.log(`QWEN EXECUTABLE: ${d.qwenExecutableBasename}`);
  console.log(`MODEL: ${d.modelBasename}`);
  console.log(`MODEL SHA256: ${d.modelSha256Status}`);
  console.log(`MODEL ATTEMPTS: ${d.modelAttempts}`);
  console.log(`QWEN PROCESSING WALL DURATION: ${d.qwenProcessingWallDurationMs}ms`);
  console.log(`PROCESSING RESULT KIND: ${d.processingResultKind}`);
  console.log(`ADVISORY/NON-ADVISORY DURABLE RECORD PRESENT: ${d.durableRecordPresent ? 'YES' : 'NO'}`);
  console.log(`SERVER SUBMISSION HTTP RESULT: ${d.serverSubmissionHttpResult}`);
  console.log(`SERVER PERSISTED RESULT TYPE: ${d.serverPersistedResultType}`);
  console.log(`SERVER TASK STATUS: ${d.serverTaskStatus}`);
  console.log(`WORKER FINAL LIFECYCLE: ${d.workerFinalLifecycle}`);
  console.log(`REPLAY RESULT: ${d.replayResult}`);
  console.log(`HUMAN REVIEW REQUIRED: ${d.humanReviewRequiredStatus}`);
  console.log(`NO AUTONOMOUS PUBLISH/APPROVE/REJECT/AUTOPUBLISH: ${d.noAutonomousContentActionVerified ? 'VERIFIED' : 'FAILED'}`);
  console.log(`OVERALL ACCEPTANCE: ${d.overallAcceptance}`);
  console.log('==================================================\n');
}

function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

function generateCanonicalMachineCredential(): string {
  const rawSecret = randomBytes(32).toString('base64url').slice(0, 43);
  return `peia_v1_${rawSecret}`;
}

async function runAcceptanceHarness(): Promise<void> {
  let server: http.Server | null = null;
  let tempDir: string | null = null;
  let sqlitePendingRepo: SqlitePendingTaskRepository | null = null;
  let sqliteLifecycleRepo: SqliteTaskProcessingLifecycleRepository | null = null;
  let sqliteOutboxRepo: SqliteAdvisoryResultOutboxRepository | null = null;
  let sqliteOutcomeRepo: SqliteNonAdvisoryOutcomeRepository | null = null;

  try {
    // ----------------------------------------------------
    // STAGE 1: SERVER_SETUP
    // ----------------------------------------------------
    console.log('[STAGE: SERVER_SETUP] Initializing isolated in-memory test persistence state...');

    const tasks = new Map<string, AIReviewTask>();
    const credentials = new Map<string, unknown>();
    const advisoryResults = new Map<string, unknown>();
    const nonAdvisoryOutcomes = new Map<string, unknown>();

    // Generate in-memory machine credential (peia_v1_<43 base64url chars>)
    const credential = generateCanonicalMachineCredential();
    const credentialDigest = createHash('sha256').update(credential, 'utf8').digest('hex');

    credentials.set(credentialDigest, {
      credentialScheme: 'OPAQUE_BEARER_V1',
      principal: {
        principalId: TEST_PRINCIPAL_ID,
        isActive: true,
        capabilities: [
          PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS,
          PEIAMachineCapability.SUBMIT_ADVISORY_RESULT,
          PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME,
        ],
      },
      credentialDigest: {
        algorithm: 'SHA-256',
        value: credentialDigest,
      },
    });

    console.log(`[STAGE: SERVER_SETUP] Machine principal registered: ${TEST_PRINCIPAL_ID} with [REDACTED] credential`);

    // Create authoritative pending task matching contract
    const rawTask: AIReviewTask = {
      taskId: TEST_TASK_ID,
      taskType: AITaskType.CONTENT_REVIEW,
      status: AITaskStatus.Pending,
      createdAt: '2026-10-10T00:00:00.000Z',
      target: {
        targetType: AIReviewTargetType.News,
        targetId: TEST_TARGET_ID,
        sourceUpdatedAt: '2026-10-10T00:00:00.000Z',
      },
      contentSnapshot: {
        title: 'Observed Coastal Sea Surface Temperature Anomaly Trends',
        text: 'Recent observational records indicate significant sea surface temperature anomalies in coastal ocean regions. Historical SST data sets provide reference baselines for assessing marine thermal variations and ecosystem impacts.',
        retrievalQuery: TEST_RETRIEVAL_QUERY,
        retrievalSources: ['NOAA'],
      },
    };

    const validatedAuthoritativeTask = validateAIReviewTask(rawTask);
    tasks.set(validatedAuthoritativeTask.taskId, validatedAuthoritativeTask);

    // Build isolated databases for endpoints
    const credentialDb = {
      collection: (name: string) => {
        if (name !== PEIA_MACHINE_CREDENTIAL_COLLECTION) {
          throw new Error(`Unexpected collection: ${name}`);
        }
        return {
          doc: (id: string) => ({
            get: async () => {
              const data = credentials.get(id);
              return {
                exists: data !== undefined,
                data: () => data,
              };
            },
          }),
        };
      },
    };

    const machineVerifier = new OpaqueMachineIdentityVerifier(
      new FirestoreMachineCredentialBindingRepository(credentialDb)
    );

    // Pending task query db
    const pendingTaskDb = {
      collection: (name: string) => {
        if (name !== PEIA_PENDING_TASK_COLLECTION) {
          throw new Error(`Unexpected collection: ${name}`);
        }
        let statusFilter: unknown = null;
        let limitVal: number | null = null;
        const query = {
          where: (field: string, op: string, value: unknown) => {
            if (field === 'status' && op === '==') {
              statusFilter = value;
            }
            return query;
          },
          orderBy: () => query,
          limit: (count: number) => {
            limitVal = count;
            return query;
          },
          get: async () => {
            let docs = Array.from(tasks.values());
            if (statusFilter) {
              docs = docs.filter((t) => t.status === statusFilter);
            }
            docs.sort((a, b) => {
              const c = a.createdAt.localeCompare(b.createdAt);
              if (c !== 0) return c;
              return a.taskId.localeCompare(b.taskId);
            });
            if (limitVal !== null) {
              docs = docs.slice(0, limitVal);
            }
            return {
              docs: docs.map((docData) => ({
                data: () => docData,
              })),
            };
          },
        };
        return query;
      },
    };

    const taskGatewayHandler = createFirestoreTaskGateway({
      credentialDb,
      taskDb: pendingTaskDb,
    });

    const pendingEndpointDeps = {
      createGateway: () => taskGatewayHandler,
      executeRequest: executePendingTaskHttpRequest,
      mapSuccess: mapPendingTaskHttpSuccess,
      mapError: mapPendingTaskHttpError,
    };

    // Advisory persistence runtime setup
    const advisoryReadDb = {
      collection: (name: string) => {
        if (name !== PEIA_PENDING_TASK_COLLECTION) {
          throw new Error(`Unexpected collection: ${name}`);
        }
        let filterTaskId: string | null = null;
        let limitCount: number | null = null;
        const q = {
          where: (field: string, op: string, val: unknown) => {
            if (field === 'taskId' && op === '==') {
              filterTaskId = String(val);
            }
            return q;
          },
          limit: (count: number) => {
            limitCount = count;
            return q;
          },
          get: async () => {
            let docs = Array.from(tasks.values());
            if (filterTaskId) {
              docs = docs.filter((t) => t.taskId === filterTaskId);
            }
            if (limitCount !== null) {
              docs = docs.slice(0, limitCount);
            }
            return {
              docs: docs.map((d) => ({
                data: () => d,
              })),
            };
          },
        };
        return q;
      },
    };

    const advisoryWriteDb: any = {
      collection: (collectionName: string) => {
        return {
          doc: (docId: string) => ({
            id: docId,
            get: async () => ({
              exists: advisoryResults.has(docId),
              data: () => advisoryResults.get(docId),
            }),
            create: async (data: unknown) => {
              if (advisoryResults.has(docId)) {
                throw new Error('Document already exists');
              }
              advisoryResults.set(docId, data);
            },
          }),
          where: (field: string, _op: string, val: unknown) => {
            const filterTaskId = field === 'taskId' ? String(val) : null;
            let limitVal: number | null = null;
            const q: any = {
              _isTaskQuery: true,
              limit: (n: number) => {
                limitVal = n;
                return q;
              },
              get: async () => {
                let docs = Array.from(tasks.values());
                if (filterTaskId) docs = docs.filter((t) => t.taskId === filterTaskId);
                if (limitVal !== null) docs = docs.slice(0, limitVal);
                return {
                  docs: docs.map((t) => ({
                    ref: { id: t.taskId, _isTaskRef: true },
                    data: () => t,
                  })),
                };
              },
            };
            return q;
          },
        };
      },
      runTransaction: async <T>(updateFn: (tx: any) => Promise<T>): Promise<T> => {
        const tx = {
          get: async (target: any) => {
            if (target && (target._isTaskQuery || typeof target.where === 'function' || typeof target.limit === 'function')) {
              return target.get();
            }
            if (target && target.id) {
              const docId = target.id;
              const exists = advisoryResults.has(docId);
              return {
                exists,
                ref: target,
                data: () => advisoryResults.get(docId),
              };
            }
            return { exists: false, data: () => null };
          },
          set: (docRef: any, data: any) => {
            advisoryResults.set(docRef.id, data);
            return tx;
          },
          update: (docRef: any, data: any) => {
            if (docRef && docRef._isTaskRef) {
              const t = tasks.get(docRef.id);
              if (t) Object.assign(t, data);
            } else if (docRef && docRef.id && tasks.has(docRef.id)) {
              const t = tasks.get(docRef.id);
              if (t) Object.assign(t, data);
            } else if (docRef && docRef.id) {
              const existing = advisoryResults.get(docRef.id);
              if (existing) Object.assign(existing, data);
            }
            return tx;
          },
          create: (docRef: any, data: any) => {
            if (advisoryResults.has(docRef.id)) {
              throw new Error('Document already exists');
            }
            advisoryResults.set(docRef.id, data);
            return tx;
          },
        };
        return updateFn(tx);
      },
    };

    const advisoryReconciliationHandler = createFirestoreAdvisoryResultReconciliationRuntime(advisoryReadDb);
    const advisoryRepo = new FirestoreAdvisoryResultRepository(advisoryWriteDb);
    const advisoryPersistenceRuntime = createFirestoreAdvisoryResultPersistenceRuntime(
      advisoryReconciliationHandler,
      advisoryRepo
    );

    // Non-Advisory persistence runtime setup
    const nonAdvisoryQueryDb = {
      collection: (name: string) => {
        if (name !== PEIA_PENDING_TASK_COLLECTION) {
          throw new Error(`Unexpected collection: ${name}`);
        }
        return {
          where: (field: string, _op: string, val: unknown) => {
            const filterTaskId = field === 'taskId' ? String(val) : null;
            return {
              limit: (n: number) => ({
                get: async () => {
                  let docs = Array.from(tasks.values());
                  if (filterTaskId) docs = docs.filter((t) => t.taskId === filterTaskId);
                  docs = docs.slice(0, n);
                  return {
                    docs: docs.map((d) => ({
                      data: () => d,
                    })),
                  };
                },
              }),
            };
          },
        };
      },
    };

    const nonAdvisoryWriteDb: any = {
      collection: (collectionName: string) => {
        return {
          doc: (docId: string) => ({
            id: docId,
            get: async () => ({
              exists: nonAdvisoryOutcomes.has(docId),
              data: () => nonAdvisoryOutcomes.get(docId),
            }),
          }),
          where: (field: string, _op: string, val: unknown) => {
            const filterTaskId = field === 'taskId' ? String(val) : null;
            let limitVal: number | null = null;
            const q: any = {
              _isTaskQuery: true,
              limit: (n: number) => {
                limitVal = n;
                return q;
              },
              get: async () => {
                let docs = Array.from(tasks.values());
                if (filterTaskId) docs = docs.filter((t) => t.taskId === filterTaskId);
                if (limitVal !== null) docs = docs.slice(0, limitVal);
                return {
                  docs: docs.map((t) => ({
                    ref: { id: t.taskId, _isTaskRef: true },
                    data: () => t,
                  })),
                };
              },
            };
            return q;
          },
        };
      },
      runTransaction: async <T>(updateFn: (tx: any) => Promise<T>): Promise<T> => {
        const tx = {
          get: async (target: any) => {
            if (target && (target._isTaskQuery || typeof target.where === 'function' || typeof target.limit === 'function')) {
              return target.get();
            }
            if (target && target.id) {
              const docId = target.id;
              const exists = nonAdvisoryOutcomes.has(docId);
              return {
                exists,
                ref: target,
                data: () => nonAdvisoryOutcomes.get(docId),
              };
            }
            return { exists: false, data: () => null };
          },
          set: (docRef: any, data: any) => {
            nonAdvisoryOutcomes.set(docRef.id, data);
            return tx;
          },
          update: (docRef: any, data: any) => {
            if (docRef && docRef._isTaskRef) {
              const t = tasks.get(docRef.id);
              if (t) Object.assign(t, data);
            } else if (docRef && docRef.id && tasks.has(docRef.id)) {
              const t = tasks.get(docRef.id);
              if (t) Object.assign(t, data);
            } else if (docRef && docRef.id) {
              const existing = nonAdvisoryOutcomes.get(docRef.id);
              if (existing) Object.assign(existing, data);
            }
            return tx;
          },
          create: (docRef: any, data: any) => {
            if (nonAdvisoryOutcomes.has(docRef.id)) {
              throw new Error('Document already exists');
            }
            nonAdvisoryOutcomes.set(docRef.id, data);
            return tx;
          },
        };
        return updateFn(tx);
      },
    };

    const nonAdvisoryRepo = new FirestoreNonAdvisoryOutcomeRepository(nonAdvisoryWriteDb);
    const nonAdvisoryPersistenceRuntime = createFirestoreNonAdvisoryOutcomePersistenceRuntime(
      nonAdvisoryQueryDb,
      nonAdvisoryRepo
    );

    // Start real loopback HTTP server
    server = http.createServer(async (req, res) => {
      const urlPath = req.url || '/';
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let parsedBody: unknown = {};
      if (rawBody.trim().length > 0) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = rawBody;
        }
      }

      if (urlPath === '/pending') {
        const httpRequest: PendingTaskHttpRequest = {
          method: req.method || 'GET',
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: parsedBody,
        };
        const responseWriter: PendingTaskHttpResponseWriter = {
          setHeader(name: string, value: string) {
            res.setHeader(name, value);
          },
          status(code: number) {
            res.statusCode = code;
            return responseWriter;
          },
          json(body: unknown) {
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json');
            }
            res.end(JSON.stringify(body));
            return body;
          },
        };
        await executeFirebasePendingTaskHttpEndpoint(httpRequest, responseWriter, pendingEndpointDeps);
        return;
      }

      if (urlPath === '/advisory') {
        const submissionRequest: AdvisoryResultSubmissionRequest = {
          method: req.method || 'GET',
          get(name: string) {
            const val = req.headers[name.toLowerCase()];
            if (Array.isArray(val)) return val[0];
            return val;
          },
          body: parsedBody,
        };
        const submissionResponse: AdvisoryResultSubmissionResponse = {
          setHeader(name: string, value: string) {
            res.setHeader(name, value);
          },
          status(code: number) {
            res.statusCode = code;
            return submissionResponse;
          },
          json(body: unknown) {
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json');
            }
            res.end(JSON.stringify(body));
          },
        };
        await executeAdvisoryResultSubmission(submissionRequest, submissionResponse, {
          verifier: machineVerifier,
          persistenceRuntime: advisoryPersistenceRuntime,
        });
        return;
      }

      if (urlPath === '/non-advisory') {
        const submissionRequest: NonAdvisoryOutcomeSubmissionRequest = {
          method: req.method || 'GET',
          get(name: string) {
            const val = req.headers[name.toLowerCase()];
            if (Array.isArray(val)) return val[0];
            return val;
          },
          body: parsedBody,
        };
        const submissionResponse: NonAdvisoryOutcomeSubmissionResponse = {
          setHeader(name: string, value: string) {
            res.setHeader(name, value);
          },
          status(code: number) {
            res.statusCode = code;
            return submissionResponse;
          },
          json(body: unknown) {
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json');
            }
            res.end(JSON.stringify(body));
          },
        };
        await executeNonAdvisoryOutcomeSubmission(submissionRequest, submissionResponse, {
          verifier: machineVerifier,
          persistenceRuntime: nonAdvisoryPersistenceRuntime,
        });
        return;
      }

      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'Endpoint not found' }));
    });

    await new Promise<void>((resolve, reject) => {
      server!.listen(0, '127.0.0.1', () => resolve());
      server!.on('error', reject);
    });

    const loopbackPort = (server.address() as AddressInfo).port;
    const pendingEndpointUrl = `http://127.0.0.1:${loopbackPort}/pending`;
    const advisoryEndpointUrl = `http://127.0.0.1:${loopbackPort}/advisory`;
    const nonAdvisoryEndpointUrl = `http://127.0.0.1:${loopbackPort}/non-advisory`;

    console.log(`[STAGE: SERVER_SETUP] Loopback server listening on 127.0.0.1:${loopbackPort}`);

    // Create temporary SQLite database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peia-final-real-e2e-'));
    const tempDbPath = path.join(tempDir, 'worker.sqlite');

    sqlitePendingRepo = new SqlitePendingTaskRepository(tempDbPath);
    sqliteLifecycleRepo = new SqliteTaskProcessingLifecycleRepository(tempDbPath);
    sqliteOutboxRepo = new SqliteAdvisoryResultOutboxRepository(tempDbPath);
    sqliteOutcomeRepo = new SqliteNonAdvisoryOutcomeRepository(tempDbPath);

    console.log(`[STAGE: SERVER_SETUP] Worker temporary SQLite initialized: ${path.basename(tempDbPath)}`);

    // ----------------------------------------------------
    // STAGE 2: DOWNLOAD
    // ----------------------------------------------------
    console.log('[STAGE: DOWNLOAD] Executing production downloadAndPersistPendingTask over real HTTP loopback...');

    let downloadResult;
    try {
      downloadResult = await downloadAndPersistPendingTask(
        {
          endpointUrl: pendingEndpointUrl,
          credential,
        },
        sqlitePendingRepo
      );
    } catch (err: unknown) {
      reportStageFailure('DOWNLOAD', `HTTP download failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (downloadResult.kind !== 'STORED') {
      reportStageFailure('DOWNLOAD', `Expected STORED result from download, got: ${downloadResult.kind}`);
    }

    console.log(`[STAGE: DOWNLOAD] Task ${downloadResult.record.taskId} downloaded and saved to SQLite`);

    // ----------------------------------------------------
    // STAGE 3: SQLITE_PERSISTENCE
    // ----------------------------------------------------
    console.log('[STAGE: SQLITE_PERSISTENCE] Verifying local SQLite task record...');

    const storedTask = await sqlitePendingRepo.findByTaskId(TEST_TASK_ID);
    if (!storedTask) {
      reportStageFailure('SQLITE_PERSISTENCE', `Task ${TEST_TASK_ID} not found in SQLite repository.`);
    }

    if (storedTask.taskId !== TEST_TASK_ID) {
      reportStageFailure('SQLITE_PERSISTENCE', `Task ID mismatch in SQLite: ${storedTask.taskId}`);
    }

    if (storedTask.principalId !== TEST_PRINCIPAL_ID) {
      reportStageFailure('SQLITE_PERSISTENCE', `Principal ID mismatch in SQLite: ${storedTask.principalId}`);
    }

    const taskSnapshot = storedTask.contentSnapshot as Record<string, unknown>;
    const retrievalSources = taskSnapshot.retrievalSources as unknown[];

    if (!Array.isArray(retrievalSources) || retrievalSources.length !== 1 || retrievalSources[0] !== 'NOAA') {
      reportStageFailure(
        'SQLITE_PERSISTENCE',
        `Task retrievalSources must be exactly ['NOAA'], got: ${JSON.stringify(retrievalSources)}`
      );
    }

    if (taskSnapshot.retrievalQuery !== TEST_RETRIEVAL_QUERY) {
      reportStageFailure(
        'SQLITE_PERSISTENCE',
        `Task retrievalQuery mismatch: ${String(taskSnapshot.retrievalQuery)}`
      );
    }

    console.log('[STAGE: SQLITE_PERSISTENCE] SQLite record verified cleanly.');

    // ----------------------------------------------------
    // STAGE 4: NOAA_RETRIEVAL (Real HTTPS to NCEI)
    // ----------------------------------------------------
    console.log('[STAGE: NOAA_RETRIEVAL] Executing real HTTPS query to NOAA/NCEI...');

    let retrievalResult;
    try {
      retrievalResult = await routeMultiSourceRetrieval(
        {
          query: TEST_RETRIEVAL_QUERY,
          sources: ['NOAA'],
        },
        {
          NOAA: createNOAAHttpKnowledgeTransport(),
        }
      );
    } catch (err: unknown) {
      reportStageFailure('NOAA_RETRIEVAL', `Real NOAA retrieval failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!retrievalResult || !Array.isArray(retrievalResult.outcomes) || retrievalResult.outcomes.length !== 1) {
      reportStageFailure('NOAA_RETRIEVAL', 'Multi-source retrieval did not return exactly one outcome.');
    }

    const noaaOutcome = retrievalResult.outcomes[0];
    if (noaaOutcome.sourceId !== 'NOAA' || noaaOutcome.kind !== 'VALID_RESULTS') {
      reportStageFailure('NOAA_RETRIEVAL', `NOAA outcome was not VALID_RESULTS: ${noaaOutcome.kind}`);
    }

    const noaaItems = noaaOutcome.value.items;
    if (noaaItems.length === 0) {
      reportStageFailure('NOAA_RETRIEVAL', 'NOAA retrieval returned 0 items.');
    }

    const firstItem = noaaItems[0];
    if (firstItem.sourceId !== 'NOAA') {
      reportStageFailure('NOAA_RETRIEVAL', `First item sourceId is not NOAA: ${firstItem.sourceId}`);
    }

    if (firstItem.provenance.sourceId !== 'NOAA') {
      reportStageFailure('NOAA_RETRIEVAL', `First item provenance sourceId is not NOAA: ${firstItem.provenance.sourceId}`);
    }

    const firstUrl = new URL(firstItem.provenance.sourceUrl);
    if (firstUrl.hostname !== 'noaa.gov' && !firstUrl.hostname.endsWith('.noaa.gov')) {
      reportStageFailure('NOAA_RETRIEVAL', `First item hostname is not noaa.gov: ${firstUrl.hostname}`);
    }

    if (firstItem.provenance.canonicalItemId !== firstItem.itemId) {
      reportStageFailure('NOAA_RETRIEVAL', 'First item canonicalItemId does not equal itemId.');
    }

    console.log(
      `[STAGE: NOAA_RETRIEVAL] Real NOAA returned ${noaaItems.length} items. First item: ${firstItem.itemId} (${firstUrl.hostname})`
    );

    // ----------------------------------------------------
    // STAGE 5: EVIDENCE_SELECTION
    // ----------------------------------------------------
    console.log('[STAGE: EVIDENCE_SELECTION] Selecting local evidence foundation...');

    const evidenceSelection = selectLocalEvidence({
      retrieval: retrievalResult,
      maxItems: 5,
    });
    if (evidenceSelection.kind !== 'SELECTED_EVIDENCE' || evidenceSelection.selectedItems.length === 0) {
      reportStageFailure('EVIDENCE_SELECTION', 'Failed to select evidence from real NOAA retrieval.');
    }

    console.log(`[STAGE: EVIDENCE_SELECTION] Selected ${evidenceSelection.selectedItems.length} evidence items.`);

    // ----------------------------------------------------
    // STAGE 6: QWEN_PREFLIGHT
    // ----------------------------------------------------
    console.log('[STAGE: QWEN_PREFLIGHT] Validating local Windows Qwen configuration...');

    if (process.platform !== 'win32') {
      reportStageFailure('QWEN_PREFLIGHT', 'REAL_WINDOWS_EXECUTION_REQUIRED');
    }

    const llamaCliPath = process.env.PEIA_LLAMA_CLI_PATH;
    const modelPath = process.env.PEIA_MODEL_PATH;

    if (!llamaCliPath) {
      reportStageFailure(
        'QWEN_PREFLIGHT',
        'Required environment variable PEIA_LLAMA_CLI_PATH is missing.'
      );
    }

    if (!modelPath) {
      reportStageFailure(
        'QWEN_PREFLIGHT',
        'Required environment variable PEIA_MODEL_PATH is missing.'
      );
    }

    if (!fs.existsSync(llamaCliPath)) {
      reportStageFailure(
        'QWEN_PREFLIGHT',
        `Executable not found at PEIA_LLAMA_CLI_PATH: ${path.basename(llamaCliPath)}`
      );
    }

    if (!fs.existsSync(modelPath)) {
      reportStageFailure(
        'QWEN_PREFLIGHT',
        `Model file not found at PEIA_MODEL_PATH: ${path.basename(modelPath)}`
      );
    }

    console.log('[STAGE: QWEN_PREFLIGHT] Verifying accepted model SHA256...');
    const ACCEPTED_MODEL_SHA256 =
      '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5';

    let actualModelSha256: string;
    try {
      actualModelSha256 = await computeFileSha256(modelPath);
    } catch (err: unknown) {
      reportStageFailure(
        'QWEN_PREFLIGHT',
        `Failed to compute SHA256 for model file: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (actualModelSha256.toLowerCase() !== ACCEPTED_MODEL_SHA256) {
      console.error('MODEL SHA256: MISMATCH');
      reportStageFailure(
        'QWEN_PREFLIGHT',
        'Model file SHA256 does not match accepted model hash.'
      );
    }

    console.log('MODEL SHA256: VERIFIED');

    const cpuThreads = process.env.PEIA_CPU_THREADS
      ? parseInt(process.env.PEIA_CPU_THREADS, 10)
      : undefined;

    const analysisConfig: LocalAnalysisRuntimeConfig = {
      llamaCliPath,
      modelPath,
      contextSize: 4096,
      temperature: 0.1,
      maxTokens: 1024,
      timeoutMs: 600000,
      ...(cpuThreads !== undefined ? { cpuThreads } : {}),
    };

    console.log(
      `[STAGE: QWEN_PREFLIGHT] Verified executable (${path.basename(llamaCliPath)}) and model (${path.basename(modelPath)}).`
    );

    // ----------------------------------------------------
    // STAGE 7: QWEN_EXECUTION
    // ----------------------------------------------------
    console.log('[STAGE: QWEN_EXECUTION] Spawning real local Qwen via processLocalTask...');
    const executionStartTime = Date.now();

    let processingResult;
    try {
      processingResult = await processLocalTask(storedTask, {
        lifecycleRepository: sqliteLifecycleRepo,
        advisoryOutboxRepository: sqliteOutboxRepo,
        nonAdvisoryOutcomeRepository: sqliteOutcomeRepo,
        retrievalTransports: {
          NOAA: createNOAAHttpKnowledgeTransport(),
        },
        analysisConfig,
      });
    } catch (err: unknown) {
      reportStageFailure('QWEN_EXECUTION', `processLocalTask failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const executionDurationMs = Date.now() - executionStartTime;
    console.log(`[STAGE: QWEN_EXECUTION] Completed in ${executionDurationMs}ms with outcome: ${processingResult.kind}`);

    // ----------------------------------------------------
    // STAGE 8: LOCAL_DURABLE_RESULT
    // ----------------------------------------------------
    console.log('[STAGE: LOCAL_DURABLE_RESULT] Asserting local durable persistence record...');

    let modelAttempts = 1;
    let durableRecordPresent = false;
    let isAdvisory = false;
    let outboxRecord: StoredAdvisoryResultRecord | null = null;
    let outcomeRecord: DurableNonAdvisoryOutcomeRecord | null = null;
    let humanReviewRequiredStatus = 'UNKNOWN';
    let noAutonomousContentActionVerified = false;

    if (processingResult.kind === 'ADVISORY_PENDING_UPLOAD') {
      isAdvisory = true;
      outboxRecord = await sqliteOutboxRepo.findByTaskId(TEST_TASK_ID);
      if (!outboxRecord) {
        reportStageFailure('LOCAL_DURABLE_RESULT', 'Advisory outbox record missing from SQLite.');
      }
      durableRecordPresent = true;
      modelAttempts = processingResult.lifecycle.modelAttempts;

      if (outboxRecord.result.humanReviewRequired !== true) {
        reportStageFailure('LOCAL_DURABLE_RESULT', 'humanReviewRequired is not true on advisory record.');
      }
      humanReviewRequiredStatus = 'YES';

      const rawResult = outboxRecord.result as unknown as Record<string, unknown>;
      if (
        'publish' in rawResult ||
        'approve' in rawResult ||
        'reject' in rawResult ||
        'autoPublish' in rawResult
      ) {
        reportStageFailure('LOCAL_DURABLE_RESULT', 'Autonomous action key found in advisory record.');
      }
      noAutonomousContentActionVerified = true;

      const lifecycleRecord = await sqliteLifecycleRepo.findByTaskId(TEST_TASK_ID);
      if (!lifecycleRecord || lifecycleRecord.state !== TaskProcessingState.ADVISORY_PENDING_UPLOAD) {
        reportStageFailure('LOCAL_DURABLE_RESULT', 'Lifecycle state is not ADVISORY_PENDING_UPLOAD.');
      }
    } else if (processingResult.kind === 'NON_ADVISORY_PENDING_REPORT') {
      outcomeRecord = await sqliteOutcomeRepo.findByTaskId(TEST_TASK_ID);
      if (!outcomeRecord) {
        reportStageFailure('LOCAL_DURABLE_RESULT', 'Non-advisory outcome record missing from SQLite.');
      }
      durableRecordPresent = true;
      modelAttempts = processingResult.lifecycle.modelAttempts;

      if (outcomeRecord.kind === 'MODEL_FAILURE') {
        reportStageFailure('LOCAL_DURABLE_RESULT', 'MODEL_FAILURE is not acceptable for positive acceptance.');
      }
      humanReviewRequiredStatus = 'NOT_APPLICABLE_NON_ADVISORY';

      const rawOutcome = outcomeRecord as unknown as Record<string, unknown>;
      if (
        'publish' in rawOutcome ||
        'approve' in rawOutcome ||
        'reject' in rawOutcome ||
        'autoPublish' in rawOutcome
      ) {
        reportStageFailure('LOCAL_DURABLE_RESULT', 'Autonomous action key found in non-advisory outcome record.');
      }
      noAutonomousContentActionVerified = true;

      const lifecycleRecord = await sqliteLifecycleRepo.findByTaskId(TEST_TASK_ID);
      if (!lifecycleRecord || lifecycleRecord.state !== TaskProcessingState.NON_ADVISORY_PENDING_REPORT) {
        reportStageFailure('LOCAL_DURABLE_RESULT', 'Lifecycle state is not NON_ADVISORY_PENDING_REPORT.');
      }
    } else {
      reportStageFailure('LOCAL_DURABLE_RESULT', `Unexpected processing result kind: ${processingResult.kind}`);
    }

    console.log('[STAGE: LOCAL_DURABLE_RESULT] Durable record verified.');

    // ----------------------------------------------------
    // STAGE 9: RESULT_SUBMISSION
    // ----------------------------------------------------
    console.log('[STAGE: RESULT_SUBMISSION] Running production runResultSubmissionCycle over loopback HTTP...');

    const submissionCycleResults = await runResultSubmissionCycle({
      advisoryEndpointUrl,
      nonAdvisoryEndpointUrl,
      credential,
      outboxRepository: sqliteOutboxRepo,
      outcomeRepository: sqliteOutcomeRepo,
      lifecycleRepository: sqliteLifecycleRepo,
    });

    if (submissionCycleResults.length !== 1 || submissionCycleResults[0].status !== 'COMPLETED') {
      reportStageFailure(
        'RESULT_SUBMISSION',
        `Submission cycle did not complete successfully: ${JSON.stringify(submissionCycleResults)}`
      );
    }

    console.log('[STAGE: RESULT_SUBMISSION] Submission cycle returned COMPLETED.');

    // ----------------------------------------------------
    // STAGE 10: SERVER_PERSISTENCE
    // ----------------------------------------------------
    console.log('[STAGE: SERVER_PERSISTENCE] Verifying server authoritative persistence state...');

    const serverTask = tasks.get(TEST_TASK_ID);
    if (!serverTask) {
      reportStageFailure('SERVER_PERSISTENCE', 'Authoritative task missing from server state.');
    }

    if (serverTask.status !== AITaskStatus.Completed) {
      reportStageFailure('SERVER_PERSISTENCE', `Authoritative server task status is not Completed: ${serverTask.status}`);
    }

    let persistedType = 'UNKNOWN';
    if (isAdvisory) {
      const docId = deriveAdvisoryResultDocumentId(TEST_TASK_ID);
      const storedAdvisory = advisoryResults.get(docId) as Record<string, unknown> | undefined;
      if (!storedAdvisory) {
        reportStageFailure('SERVER_PERSISTENCE', 'Advisory result was not stored on server.');
      }
      persistedType = 'ADVISORY';
      const principal = storedAdvisory.principal as Record<string, unknown>;
      if (!principal || principal.principalId !== TEST_PRINCIPAL_ID) {
        reportStageFailure('SERVER_PERSISTENCE', 'Audit principal mismatch on stored advisory.');
      }
    } else {
      const docId = deriveNonAdvisoryOutcomeDocumentId(TEST_TASK_ID);
      const storedOutcome = nonAdvisoryOutcomes.get(docId) as Record<string, unknown> | undefined;
      if (!storedOutcome) {
        reportStageFailure('SERVER_PERSISTENCE', 'Non-advisory outcome was not stored on server.');
      }
      persistedType = 'NON_ADVISORY';
      const principal = storedOutcome.principal as Record<string, unknown>;
      if (!principal || principal.principalId !== TEST_PRINCIPAL_ID) {
        reportStageFailure('SERVER_PERSISTENCE', 'Audit principal mismatch on stored outcome.');
      }
    }

    console.log(`[STAGE: SERVER_PERSISTENCE] Server persisted ${persistedType} record; task marked Completed.`);

    // ----------------------------------------------------
    // STAGE 11: REPLAY
    // ----------------------------------------------------
    console.log('[STAGE: REPLAY] Executing idempotent replay of the exact durable result...');

    let replayOk = false;
    if (isAdvisory) {
      const outbox = await sqliteOutboxRepo.findByTaskId(TEST_TASK_ID);
      if (!outbox) reportStageFailure('REPLAY', 'Outbox record missing for replay.');
      const replayRes = await uploadAdvisoryResult({
        endpointUrl: advisoryEndpointUrl,
        credential,
        result: outbox.result,
      });
      if (replayRes.kind === 'ACCEPTED' && replayRes.value.ok === true && replayRes.value.taskId === TEST_TASK_ID) {
        replayOk = true;
      } else {
        reportStageFailure('REPLAY', `Replay failed: ${JSON.stringify(replayRes)}`);
      }
      if (advisoryResults.size !== 1) {
        reportStageFailure('REPLAY', `Replay created extra advisory results: ${advisoryResults.size}`);
      }
    } else {
      const outcome = await sqliteOutcomeRepo.findByTaskId(TEST_TASK_ID);
      if (!outcome) reportStageFailure('REPLAY', 'Outcome record missing for replay.');
      const replayRes = await uploadNonAdvisoryOutcome({
        endpointUrl: nonAdvisoryEndpointUrl,
        credential,
        outcome,
      });
      if (replayRes.kind === 'ACCEPTED' && replayRes.value.ok === true && replayRes.value.taskId === TEST_TASK_ID) {
        replayOk = true;
      } else {
        reportStageFailure('REPLAY', `Replay failed: ${JSON.stringify(replayRes)}`);
      }
      if (nonAdvisoryOutcomes.size !== 1) {
        reportStageFailure('REPLAY', `Replay created extra outcome records: ${nonAdvisoryOutcomes.size}`);
      }
    }

    console.log('[STAGE: REPLAY] Replay accepted idempotently without duplicate persistence.');

    // ----------------------------------------------------
    // STAGE 12: FINAL_STATE_ASSERTION
    // ----------------------------------------------------
    console.log('[STAGE: FINAL_STATE_ASSERTION] Verifying final worker lifecycle...');

    const finalLifecycle = await sqliteLifecycleRepo.findByTaskId(TEST_TASK_ID);
    if (!finalLifecycle || finalLifecycle.state !== TaskProcessingState.COMPLETED) {
      reportStageFailure('FINAL_STATE_ASSERTION', 'Worker lifecycle is not COMPLETED.');
    }

    const diagnostics: AcceptanceDiagnostics = {
      taskId: TEST_TASK_ID,
      loopbackPort,
      downloadResult: 'STORED',
      localSqliteStoredTask: 'VERIFIED',
      requestedSources: ['NOAA'],
      noaaRetrievalKind: noaaOutcome.kind,
      noaaEvidenceCount: noaaItems.length,
      firstNoaaItemId: firstItem.itemId,
      firstNoaaHostname: firstUrl.hostname,
      selectedEvidenceCount: evidenceSelection.selectedItems.length,
      platform: process.platform,
      arch: process.arch,
      qwenExecutableBasename: path.basename(llamaCliPath),
      modelBasename: path.basename(modelPath),
      modelSha256Status: 'VERIFIED',
      modelAttempts,
      qwenProcessingWallDurationMs: executionDurationMs,
      processingResultKind: processingResult.kind,
      durableRecordPresent,
      serverSubmissionHttpResult: 'COMPLETED (200)',
      serverPersistedResultType: persistedType,
      serverTaskStatus: serverTask.status,
      workerFinalLifecycle: finalLifecycle.state,
      replayResult: replayOk ? 'IDEMPOTENT_ACCEPTANCE' : 'FAILED',
      humanReviewRequiredStatus,
      noAutonomousContentActionVerified,
      overallAcceptance: 'ACCEPTANCE_PASSED',
    };

    printAcceptanceReport(diagnostics);

    // Clean up temporary database
    sqlitePendingRepo.close();
    sqliteLifecycleRepo.close();
    sqliteOutboxRepo.close();
    sqliteOutcomeRepo.close();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } finally {
    if (server) {
      server.close();
    }
  }
}

// Execute harness when invoked directly
runAcceptanceHarness().catch((err: unknown) => {
  reportStageFailure('FINAL_STATE_ASSERTION', err instanceof Error ? err.message : String(err));
});
