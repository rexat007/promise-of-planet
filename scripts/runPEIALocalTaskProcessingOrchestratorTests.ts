import {
  processLocalTask,
  LocalTaskProcessingOrchestratorError,
} from '../peia-worker/src/localTaskProcessingOrchestrator';
import {
  SqliteTaskProcessingLifecycleRepository,
} from '../peia-worker/src/sqliteTaskProcessingLifecycleRepository';
import {
  SqliteNonAdvisoryOutcomeRepository,
} from '../peia-worker/src/sqliteNonAdvisoryOutcomeRepository';
import {
  SqliteAdvisoryResultOutboxRepository,
} from '../peia-worker/src/sqliteAdvisoryResultOutboxRepository';
import {
  StoredPendingTaskRecord,
  LocalPendingTaskState,
} from '../peia-worker/src/localPendingTaskStoreContract';
import {
  TaskProcessingState,
  TaskProcessingTerminalOutcome,
} from '../peia-worker/src/localTaskProcessingLifecycleContract';
import {
  createStoredAdvisoryResultRecord,
} from '../peia-worker/src/localAdvisoryResultOutboxContract';
import {
  PEIAAdvisoryResult,
  PEIA_ADVISORY_RESULT_SCHEMA_VERSION,
} from '../peia-worker/src/advisoryResultContract';
import {
  AITaskType,
  AITaskStatus,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
} from '../src/types/aiReview';
import {
  MultiSourceTransports,
  MultiSourceRouterError,
} from '../peia-worker/src/multiSourceKnowledgeRetrievalRouter';
import {
  LocalEvidenceSelectionError,
} from '../peia-worker/src/localEvidenceSelectionFoundation';
import {
  LocalAnalysisRuntimeConfig,
  QwenProcessRunner,
} from '../peia-worker/src/localAnalysisRuntime';
import * as fs from 'node:fs';
import * as path from 'node:path';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`[PASS] ${totalTests}. ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${totalTests}. ${name}`);
    console.error(err);
    throw err;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function createSampleStoredTask(
  taskId = 'task-orch-101',
  retrievalQuery = 'air quality compliance'
): StoredPendingTaskRecord {
  return Object.freeze({
    taskId,
    principalId: 'principal-1',
    taskType: AITaskType.CONTENT_REVIEW,
    target: Object.freeze({
      targetType: AIReviewTargetType.News,
      targetId: 'news-01',
      sourceUpdatedAt: '2026-10-01T00:00:00.000Z',
    }),
    contentSnapshot: Object.freeze({
      retrievalQuery,
      body: 'Facility emission review required.',
    }),
    remoteCreatedAt: '2026-10-07T00:00:00.000Z',
    remoteStatus: AITaskStatus.Pending,
    localState: LocalPendingTaskState.Downloaded,
  });
}

function createSampleAdvisoryResult(taskId: string): PEIAAdvisoryResult {
  return Object.freeze({
    schemaVersion: PEIA_ADVISORY_RESULT_SCHEMA_VERSION,
    task: Object.freeze({
      taskId,
      taskType: AITaskType.CONTENT_REVIEW,
      target: Object.freeze({
        targetType: AIReviewTargetType.News,
        targetId: 'news-01',
        sourceUpdatedAt: '2026-10-01T00:00:00.000Z',
      }),
    }),
    humanReviewRequired: true,
    assessment: Object.freeze({
      summary: 'Summary',
      findings: Object.freeze([
        Object.freeze({
          code: 'PEIA_FINDING_001',
          message: 'Finding',
          evidenceIds: Object.freeze(['EPA::epa-item-1']),
        }),
      ]),
    }),
    recommendations: Object.freeze([]),
    uncertainties: Object.freeze([]),
    limitations: Object.freeze([]),
  });
}

function createSuccessTransports(): MultiSourceTransports {
  return Object.freeze({
    EPA: async () => ({
      status: 200,
      json: async () => ({
        results: [
          {
            id: 'epa-item-1',
            title: 'EPA Air Compliance Report',
            url: 'https://www.epa.gov/compliance/report-1',
            excerpt: 'Facility met all air quality standards for particulate emissions.',
            publishedAt: '2026-01-15T08:00:00Z',
          },
        ],
      }),
    }),
    NOAA: async () => ({
      status: 200,
      json: async () => ({
        results: [
          {
            id: 'noaa-item-1',
            title: 'NOAA Meteorological Data',
            url: 'https://www.noaa.gov/weather/data-1',
            excerpt: 'Wind and dispersion conditions were favorable during review period.',
            publishedAt: '2026-02-10T14:30:00Z',
          },
        ],
      }),
    }),
  });
}

function createSuccessRunner(advisoryJson?: string): QwenProcessRunner {
  const jsonOutput =
    advisoryJson ??
    JSON.stringify({
      status: 'READY',
      summary: 'Facility complies with air quality standards based on EPA records.',
      findings: [
        {
          claim: 'Facility met all air quality standards for particulate emissions.',
          evidenceIds: ['EPA::epa-item-1'],
          severity: AIReviewSeverity.Warning,
        },
      ],
      recommendations: ['Maintain current emissions controls.'],
      uncertainties: ['Weather conditions may vary seasonally.'],
    });

  return async () => ({
    exitCode: 0,
    stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${jsonOutput}\n`,
    stderr: '',
    timedOut: false,
  });
}

(async () => {
  console.log('--- RUNNING PEIA LOCAL TASK PROCESSING ORCHESTRATOR 49-SCENARIO TESTS ---');

  const tmpDir = path.join(process.cwd(), 'test_orch_tmp');
  const cleanup = () => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  };

  cleanup();
  fs.mkdirSync(tmpDir, { recursive: true });

  const getDbPaths = (name: string) => ({
    lifecycle: path.join(tmpDir, `${name}_life.db`),
    nonAdvisory: path.join(tmpDir, `${name}_nonadv.db`),
    advisory: path.join(tmpDir, `${name}_adv.db`),
  });

  const defaultConfig: LocalAnalysisRuntimeConfig = {
    llamaCliPath: '/dummy/llama-cli',
    modelPath: '/dummy/qwen.gguf',
  };

  // ==================================================
  // RECOVERY & STARTUP MATRIX (1-12)
  // ==================================================

  await test('1. fresh task creates READY lifecycle and proceeds', async () => {
    const paths = getDbPaths('test_1');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-1');
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: createSuccessRunner(),
      clock: () => '2026-10-07T00:00:00.000Z',
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'result kind');
    assert(result.lifecycle.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD, 'lifecycle state');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('2. COMPLETED task returns ALREADY_COMPLETED', async () => {
    const paths = getDbPaths('test_2');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-2');
    await lifeRepo.createInitialRecord('task-2');
    await lifeRepo.recordModelAttempt('task-2');
    await lifeRepo.transitionState('task-2', TaskProcessingState.ADVISORY_PENDING_UPLOAD, null);
    await lifeRepo.transitionState('task-2', TaskProcessingState.COMPLETED, null);

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: createSuccessRunner(),
    });

    assert(result.kind === 'ALREADY_COMPLETED', 'already completed');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('3. advisory + PROCESSING recovers to ADVISORY_PENDING_UPLOAD without Qwen', async () => {
    const paths = getDbPaths('test_3');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-3');
    await lifeRepo.createInitialRecord('task-3');
    await lifeRepo.recordModelAttempt('task-3');

    await advRepo.save(createStoredAdvisoryResultRecord(createSampleAdvisoryResult('task-3')));

    let qwenCalled = false;
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: async () => {
        qwenCalled = true;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'advisory pending');
    assert(!qwenCalled, 'Qwen must not be called on advisory recovery');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('4. advisory + ADVISORY_PENDING_UPLOAD returns without Qwen', async () => {
    const paths = getDbPaths('test_4');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-4');
    await lifeRepo.createInitialRecord('task-4');
    await lifeRepo.recordModelAttempt('task-4');
    await lifeRepo.transitionState('task-4', TaskProcessingState.ADVISORY_PENDING_UPLOAD, null);

    await advRepo.save(createStoredAdvisoryResultRecord(createSampleAdvisoryResult('task-4')));

    let qwenCalled = false;
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: async () => {
        qwenCalled = true;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'advisory pending');
    assert(!qwenCalled, 'Qwen must not be called');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('5. non-advisory attempts0 + READY recovers without Qwen', async () => {
    const paths = getDbPaths('test_5');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-5');
    await lifeRepo.createInitialRecord('task-5');
    await nonAdvRepo.save({
      taskId: 'task-5',
      kind: 'ABSTAINED',
      reason: 'NO_EVIDENCE',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    let qwenCalled = false;
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: async () => {
        qwenCalled = true;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory report');
    assert(!qwenCalled, 'Qwen must not be called');
    assert(result.lifecycle.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'reconciled state');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('6. non-advisory + PROCESSING matching attempts recovers without Qwen', async () => {
    const paths = getDbPaths('test_6');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-6');
    await lifeRepo.createInitialRecord('task-6');
    await lifeRepo.recordModelAttempt('task-6'); // attempts 1
    await nonAdvRepo.save({
      taskId: 'task-6',
      kind: 'ABSTAINED',
      reason: 'INVALID_MODEL_OUTPUT',
      modelAttempts: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    let qwenCalled = false;
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: async () => {
        qwenCalled = true;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory report');
    assert(!qwenCalled, 'Qwen must not be called');
    assert(result.lifecycle.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'reconciled state');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('7. non-advisory + NON_ADVISORY_PENDING_REPORT validates and returns without Qwen', async () => {
    const paths = getDbPaths('test_7');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-7');
    await lifeRepo.createInitialRecord('task-7');
    await lifeRepo.transitionState('task-7', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, TaskProcessingTerminalOutcome.ABSTAINED);
    await nonAdvRepo.save({
      taskId: 'task-7',
      kind: 'ABSTAINED',
      reason: 'NO_EVIDENCE',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    let qwenCalled = false;
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: async () => {
        qwenCalled = true;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory report');
    assert(!qwenCalled, 'Qwen must not be called');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('8. advisory + non-advisory both exist -> fail closed PERSISTENCE_CONFLICT', async () => {
    const paths = getDbPaths('test_8');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-8');
    await lifeRepo.createInitialRecord('task-8');
    await advRepo.save(createStoredAdvisoryResultRecord(createSampleAdvisoryResult('task-8')));
    await nonAdvRepo.save({
      taskId: 'task-8',
      kind: 'ABSTAINED',
      reason: 'NO_EVIDENCE',
      modelAttempts: 0,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
      });
      assert(false, 'Should have failed with persistence conflict');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'PERSISTENCE_CONFLICT', 'error code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('9. ADVISORY_PENDING_UPLOAD missing advisory -> fail closed LIFECYCLE_INCONSISTENCY', async () => {
    const paths = getDbPaths('test_9');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-9');
    await lifeRepo.createInitialRecord('task-9');
    await lifeRepo.recordModelAttempt('task-9');
    await lifeRepo.transitionState('task-9', TaskProcessingState.ADVISORY_PENDING_UPLOAD, null);

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'LIFECYCLE_INCONSISTENCY', 'error code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('10. NON_ADVISORY_PENDING_REPORT missing non-advisory -> fail closed LIFECYCLE_INCONSISTENCY', async () => {
    const paths = getDbPaths('test_10');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-10');
    await lifeRepo.createInitialRecord('task-10');
    await lifeRepo.transitionState('task-10', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, TaskProcessingTerminalOutcome.ABSTAINED);

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'LIFECYCLE_INCONSISTENCY', 'error code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('11. incompatible attempt counts -> fail closed RECOVERY_INCONSISTENCY', async () => {
    const paths = getDbPaths('test_11');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-11');
    await lifeRepo.createInitialRecord('task-11');
    await lifeRepo.recordModelAttempt('task-11'); // attempts 1 in lifecycle
    await nonAdvRepo.save({
      taskId: 'task-11',
      kind: 'MODEL_FAILURE',
      reason: 'NON_ZERO_EXIT',
      modelAttempts: 2, // mismatch with lifecycle attempts 1
      exitCode: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'RECOVERY_INCONSISTENCY', 'error code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('12. PROCESSING attempts2 no durable result -> INTERRUPTED_MODEL_ATTEMPT', async () => {
    const paths = getDbPaths('test_12');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-12');
    await lifeRepo.createInitialRecord('task-12');
    await lifeRepo.recordModelAttempt('task-12');
    await lifeRepo.recordModelAttempt('task-12'); // PROCESSING attempts 2

    let qwenCalled = false;
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: async () => {
        qwenCalled = true;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
      clock: () => '2026-10-07T00:00:00.000Z',
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory report');
    assert(!qwenCalled, 'Qwen must not be called');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'MODEL_FAILURE', 'model failure');
      assert(result.outcome.reason === 'INTERRUPTED_MODEL_ATTEMPT', 'interrupted reason');
      assert(result.outcome.modelAttempts === 2, 'model attempts 2');
      assert(!('exitCode' in result.outcome), 'exitCode must be absent');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  // ==================================================
  // INPUT VALIDATION MATRIX (13-15)
  // ==================================================

  await test('13. missing retrievalQuery -> INPUT_FAILURE attempts0', async () => {
    const paths = getDbPaths('test_13');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = Object.freeze({
      ...createSampleStoredTask('task-13'),
      contentSnapshot: Object.freeze({ body: 'no retrieval query here' }),
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'INPUT_FAILURE', 'input failure');
      assert(result.outcome.reason === 'MISSING_RETRIEVAL_QUERY', 'reason');
      assert(result.outcome.modelAttempts === 0, 'attempts 0');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('14. invalid retrievalQuery -> INPUT_FAILURE attempts0', async () => {
    const paths = getDbPaths('test_14');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = Object.freeze({
      ...createSampleStoredTask('task-14'),
      contentSnapshot: Object.freeze({ retrievalQuery: ' untrimmed query ' }),
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'INPUT_FAILURE', 'input failure');
      assert(result.outcome.reason === 'INVALID_RETRIEVAL_QUERY', 'reason');
      assert(result.outcome.modelAttempts === 0, 'attempts 0');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('15. malformed task payload -> INPUT_FAILURE attempts0', async () => {
    const paths = getDbPaths('test_15');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = Object.freeze({
      ...createSampleStoredTask('task-15'),
      contentSnapshot: null as any,
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'INPUT_FAILURE', 'input failure');
      assert(result.outcome.reason === 'INVALID_TASK_PAYLOAD', 'reason');
      assert(result.outcome.modelAttempts === 0, 'attempts 0');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  // ==================================================
  // RETRIEVAL OUTCOMES MATRIX (16-21)
  // ==================================================

  await test('16. both EPA+NOAA SOURCE_FAILURE -> RETRIEVAL_FAILURE attempts0', async () => {
    const paths = getDbPaths('test_16');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-16');
    const failingTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => { throw new (class extends Error { code = 'TRANSPORT_FAILURE'; name = 'EPARetrievalError'; })('EPA down'); },
      NOAA: async () => { throw new (class extends Error { code = 'TRANSPORT_FAILURE'; name = 'NOAARetrievalError'; })('NOAA down'); },
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: failingTransports,
      analysisConfig: defaultConfig,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'RETRIEVAL_FAILURE', 'retrieval failure');
      assert(result.outcome.reason === 'TOTAL_RETRIEVAL_FAILURE', 'total retrieval failure');
      assert(result.outcome.modelAttempts === 0, 'model attempts 0');
      assert(result.outcome.kind === 'RETRIEVAL_FAILURE' && result.outcome.sourceFailures.length === 2, 'two failures');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('17. both NO_RESULTS -> NO_EVIDENCE attempts0', async () => {
    const paths = getDbPaths('test_17');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-17');
    const noResultTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
      NOAA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: noResultTransports,
      analysisConfig: defaultConfig,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'ABSTAINED', 'abstained');
      assert(result.outcome.reason === 'NO_EVIDENCE', 'no evidence');
      assert(result.outcome.modelAttempts === 0, 'model attempts 0');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('18. EPA NO_RESULTS + NOAA SOURCE_FAILURE -> NOT TOTAL_RETRIEVAL_FAILURE -> NO_EVIDENCE attempts0', async () => {
    const paths = getDbPaths('test_18');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-18');
    const mixedTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
      NOAA: async () => { throw new (class extends Error { code = 'TRANSPORT_FAILURE'; name = 'NOAARetrievalError'; })('NOAA down'); },
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: mixedTransports,
      analysisConfig: defaultConfig,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'ABSTAINED', 'abstained, not retrieval failure');
      assert(result.outcome.reason === 'NO_EVIDENCE', 'no evidence');
      assert(result.outcome.modelAttempts === 0, 'attempts 0');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('19. EPA SOURCE_FAILURE + NOAA NO_RESULTS -> NOT TOTAL_RETRIEVAL_FAILURE -> NO_EVIDENCE attempts0', async () => {
    const paths = getDbPaths('test_19');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-19');
    const mixedTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => { throw new (class extends Error { code = 'TRANSPORT_FAILURE'; name = 'EPARetrievalError'; })('EPA down'); },
      NOAA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: mixedTransports,
      analysisConfig: defaultConfig,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'ABSTAINED', 'abstained');
      assert(result.outcome.reason === 'NO_EVIDENCE', 'no evidence');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('20. EPA VALID_RESULTS + NOAA SOURCE_FAILURE -> processing continues to model path', async () => {
    const paths = getDbPaths('test_20');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-20');
    const mixedTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => ({
        status: 200,
        json: async () => ({
          results: [{ id: 'epa-item-1', title: 'Title', url: 'https://www.epa.gov/r', excerpt: 'Excerpt', publishedAt: '2026-01-01T00:00:00Z' }],
        }),
      }),
      NOAA: async () => { throw new (class extends Error { code = 'TRANSPORT_FAILURE'; name = 'NOAARetrievalError'; })('NOAA down'); },
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: mixedTransports,
      analysisConfig: defaultConfig,
      qwenRunner: createSuccessRunner(),
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'proceeds to advisory success');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('21. EPA SOURCE_FAILURE + NOAA VALID_RESULTS -> processing continues to model path', async () => {
    const paths = getDbPaths('test_21');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-21');
    const mixedTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => { throw new (class extends Error { code = 'TRANSPORT_FAILURE'; name = 'EPARetrievalError'; })('EPA down'); },
      NOAA: async () => ({
        status: 200,
        json: async () => ({
          results: [{ id: 'noaa-1', title: 'Title', url: 'https://www.noaa.gov/r', excerpt: 'Excerpt', publishedAt: '2026-01-01T00:00:00Z' }],
        }),
      }),
    });

    const runner = async () => ({
      exitCode: 0,
      stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${JSON.stringify({
        status: 'READY',
        summary: 'NOAA review complete',
        findings: [{ claim: 'NOAA findings', evidenceIds: ['NOAA::noaa-1'], severity: AIReviewSeverity.Info }],
        recommendations: [],
        uncertainties: [],
      })}\n`,
      stderr: '',
      timedOut: false,
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: mixedTransports,
      analysisConfig: defaultConfig,
      qwenRunner: runner,
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'proceeds to advisory success');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  // ==================================================
  // EVIDENCE PRE-FLIGHT MATRIX (22-24)
  // ==================================================

  await test('22. selected evidence exists but all evidence exceeds bounded context -> INSUFFICIENT_EVIDENCE attempts0, zero Qwen', async () => {
    const paths = getDbPaths('test_22');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-22');
    let qwenCalled = false;

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: { ...defaultConfig, maxContextChars: 10 }, // tiny maxContextChars forces 0 retained items
      qwenRunner: async () => {
        qwenCalled = true;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory report');
    assert(!qwenCalled, 'zero Qwen calls');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'ABSTAINED', 'abstained');
      assert(result.outcome.reason === 'INSUFFICIENT_EVIDENCE', 'insufficient evidence reason');
      assert(result.outcome.modelAttempts === 0, 'model attempts 0');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('23. pre-model NO_EVIDENCE consumes zero model attempts', async () => {
    const paths = getDbPaths('test_23');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-23');
    const noResultTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
      NOAA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: noResultTransports,
      analysisConfig: defaultConfig,
    });

    assert(result.lifecycle.modelAttempts === 0, 'consumed zero model attempts');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('24. pre-model INSUFFICIENT_EVIDENCE consumes zero model attempts', async () => {
    const paths = getDbPaths('test_24_pre');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-24-pre');
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: { ...defaultConfig, maxContextChars: 5 },
    });

    assert(result.lifecycle.modelAttempts === 0, 'consumed zero model attempts');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  // ==================================================
  // MODEL & PERSISTENCE ORDER MATRIX (25-30)
  // ==================================================

  await test('25. fresh advisory success uses attempts1', async () => {
    const paths = getDbPaths('test_25');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-25');
    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: createSuccessRunner(),
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'advisory pending');
    assert(result.lifecycle.modelAttempts === 1, 'model attempts 1');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('26. advisory persisted before lifecycle transition', async () => {
    const paths = getDbPaths('test_26');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-26');
    
    // Test hook: inspect that when outbox save occurs, lifecycle is still PROCESSING
    let lifecycleStateAtOutboxSave: string | null = null;
    const originalSave = advRepo.save.bind(advRepo);
    advRepo.save = async (rec) => {
      const currentLife = await lifeRepo.findByTaskId('task-26');
      lifecycleStateAtOutboxSave = currentLife ? currentLife.state : null;
      await originalSave(rec);
    };

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: createSuccessRunner(),
    });

    assert(lifecycleStateAtOutboxSave === TaskProcessingState.PROCESSING, 'lifecycle was PROCESSING when outbox saved');
    assert(result.lifecycle.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD, 'final state');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('27. INVALID_MODEL_OUTPUT after Qwen -> durable ABSTAINED with actual attempts1', async () => {
    const paths = getDbPaths('test_27');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-27');
    const badJsonRunner = async () => ({
      exitCode: 0,
      stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n{ not_valid_schema }\n`,
      stderr: '',
      timedOut: false,
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: badJsonRunner,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'ABSTAINED', 'abstained');
      assert(result.outcome.reason === 'INVALID_MODEL_OUTPUT', 'invalid model output reason');
      assert(result.outcome.modelAttempts === 1, 'actual model attempts 1 preserved');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('28. UNGROUNDED_MODEL_OUTPUT after Qwen -> durable ABSTAINED with actual attempts1', async () => {
    const paths = getDbPaths('test_28_ungrounded');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-28-ungrounded');
    const ungroundedRunner = async () => ({
      exitCode: 0,
      stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${JSON.stringify({
        status: 'READY',
        summary: 'Summary',
        findings: [{ claim: 'Hallucinated claim', evidenceIds: ['EPA::fabricated-id-999'], severity: AIReviewSeverity.Info }],
        recommendations: [],
        uncertainties: [],
      })}\n`,
      stderr: '',
      timedOut: false,
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: ungroundedRunner,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'ABSTAINED', 'abstained');
      assert(result.outcome.reason === 'UNGROUNDED_MODEL_OUTPUT', 'ungrounded reason');
      assert(result.outcome.modelAttempts === 1, 'actual model attempts 1');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('29. model-generated NO_EVIDENCE after Qwen -> fail closed DOMAIN_CONTRACT_MISMATCH', async () => {
    const paths = getDbPaths('test_29');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-29');
    const abstainingRunner = async () => ({
      exitCode: 0,
      stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${JSON.stringify({ status: 'ABSTAIN', abstainReason: 'NO_EVIDENCE', summary: 'No evidence found' })}\n`,
      stderr: '',
      timedOut: false,
    });

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
        qwenRunner: abstainingRunner,
      });
      assert(false, 'Should have failed with domain contract mismatch');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'DOMAIN_CONTRACT_MISMATCH', 'contract mismatch code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('30. model-generated INSUFFICIENT_EVIDENCE after Qwen -> fail closed DOMAIN_CONTRACT_MISMATCH', async () => {
    const paths = getDbPaths('test_30_insuff');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-30-insuff');
    const abstainingRunner = async () => ({
      exitCode: 0,
      stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${JSON.stringify({ status: 'ABSTAIN', abstainReason: 'INSUFFICIENT_EVIDENCE', summary: 'Insufficient evidence' })}\n`,
      stderr: '',
      timedOut: false,
    });

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
        qwenRunner: abstainingRunner,
      });
      assert(false, 'Should have failed with domain contract mismatch');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'DOMAIN_CONTRACT_MISMATCH', 'contract mismatch code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  // ==================================================
  // RETRY MATRIX (31-37)
  // ==================================================

  await test('31. TIMEOUT attempt1 retries once and succeeds on attempt 2', async () => {
    const paths = getDbPaths('test_31');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-31');
    let callCount = 0;
    const retryingRunner: QwenProcessRunner = async () => {
      callCount++;
      if (callCount === 1) {
        return { exitCode: null, stdout: '', stderr: '', timedOut: true };
      }
      return {
        exitCode: 0,
        stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${JSON.stringify({
          status: 'READY',
          summary: 'Success on retry',
          findings: [{ claim: 'Passed review on attempt 2', evidenceIds: ['EPA::epa-item-1'], severity: AIReviewSeverity.Warning }],
          recommendations: [],
          uncertainties: [],
        })}\n`,
        stderr: '',
        timedOut: false,
      };
    };

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: retryingRunner,
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'advisory pending after retry');
    assert(result.lifecycle.modelAttempts === 2, 'model attempts 2 after retry');
    assert(callCount === 2, 'called twice');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('32. NON_ZERO_EXIT attempt1 retries once and succeeds on attempt 2', async () => {
    const paths = getDbPaths('test_32');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-32');
    let callCount = 0;
    const retryingRunner: QwenProcessRunner = async () => {
      callCount++;
      if (callCount === 1) {
        return { exitCode: 1, stdout: '', stderr: 'error', timedOut: false };
      }
      return {
        exitCode: 0,
        stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${JSON.stringify({
          status: 'READY',
          summary: 'Success on retry',
          findings: [{ claim: 'Passed review on attempt 2', evidenceIds: ['EPA::epa-item-1'], severity: AIReviewSeverity.Warning }],
          recommendations: [],
          uncertainties: [],
        })}\n`,
        stderr: '',
        timedOut: false,
      };
    };

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: retryingRunner,
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'advisory pending after retry');
    assert(result.lifecycle.modelAttempts === 2, 'model attempts 2 after retry');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('33. UNUSABLE_PROCESS_OUTPUT attempt1 retries once', async () => {
    const paths = getDbPaths('test_33_unusable');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-33-unusable');
    let callCount = 0;
    const retryingRunner: QwenProcessRunner = async () => {
      callCount++;
      if (callCount === 1) {
        return { exitCode: 0, stdout: '   ', stderr: '', timedOut: false };
      }
      return {
        exitCode: 0,
        stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${JSON.stringify({
          status: 'READY',
          summary: 'Success on retry',
          findings: [{ claim: 'Passed review on attempt 2', evidenceIds: ['EPA::epa-item-1'], severity: AIReviewSeverity.Warning }],
          recommendations: [],
          uncertainties: [],
        })}\n`,
        stderr: '',
        timedOut: false,
      };
    };

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: retryingRunner,
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'advisory pending');
    assert(callCount === 2, 'retried once');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('34. PROCESS_LAUNCH_FAILURE attempt1 terminal without retry', async () => {
    const paths = getDbPaths('test_34');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-34');
    let callCount = 0;
    const failingRunner: QwenProcessRunner = async () => {
      callCount++;
      return {
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        launchError: 'ENOENT binary not found',
      };
    };

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: failingRunner,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending report');
    assert(callCount === 1, 'called only once (non-retryable)');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'MODEL_FAILURE', 'model failure');
      assert(result.outcome.reason === 'PROCESS_LAUNCH_FAILURE', 'reason');
      assert(result.outcome.modelAttempts === 1, 'model attempts 1');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('35. retry success advisory at attempt2', async () => {
    const paths = getDbPaths('test_35');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-35');
    let callCount = 0;
    const runner: QwenProcessRunner = async () => {
      callCount++;
      if (callCount === 1) {
        return { exitCode: 1, stdout: '', stderr: '', timedOut: false };
      }
      return {
        exitCode: 0,
        stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${JSON.stringify({
          status: 'READY',
          summary: 'Attempt 2 success',
          findings: [{ claim: 'Claim 2', evidenceIds: ['EPA::epa-item-1'], severity: AIReviewSeverity.Info }],
          recommendations: [],
          uncertainties: [],
        })}\n`,
        stderr: '',
        timedOut: false,
      };
    };

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: runner,
    });

    assert(result.kind === 'ADVISORY_PENDING_UPLOAD', 'advisory pending');
    assert(result.lifecycle.modelAttempts === 2, 'model attempts 2');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('36. retry final MODEL_FAILURE persists attempts2', async () => {
    const paths = getDbPaths('test_36');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-36');
    const runner: QwenProcessRunner = async () => ({
      exitCode: 137,
      stdout: 'Killed',
      stderr: 'OOM',
      timedOut: false,
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: runner,
    });

    assert(result.kind === 'NON_ADVISORY_PENDING_REPORT', 'non advisory pending report');
    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.kind === 'MODEL_FAILURE', 'model failure');
      assert(result.outcome.modelAttempts === 2, 'persisted attempts 2');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('37. max attempts - recordModelAttempt never called beyond total 2', async () => {
    const paths = getDbPaths('test_37');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-37');
    let recordCallCount = 0;
    const originalRecord = lifeRepo.recordModelAttempt.bind(lifeRepo);
    lifeRepo.recordModelAttempt = async (id) => {
      recordCallCount++;
      return originalRecord(id);
    };

    const runner: QwenProcessRunner = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'fail',
      timedOut: false,
    });

    await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: runner,
    });

    assert(recordCallCount === 2, `recordModelAttempt called exactly 2 times, got ${recordCallCount}`);

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  // ==================================================
  // CRASH RECOVERY MATRIX (38-42)
  // ==================================================

  await test('38. PROCESSING attempts1 recovery reruns retrieval and preflight before attempt2', async () => {
    const paths = getDbPaths('test_38');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-38');
    await lifeRepo.createInitialRecord('task-38');
    await lifeRepo.recordModelAttempt('task-38'); // PROCESSING attempts 1

    let retrievalCalled = false;
    const customTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => {
        retrievalCalled = true;
        return { status: 200, json: async () => ({ results: [{ id: 'epa-1', title: 'Title', url: 'https://www.epa.gov/r', excerpt: 'E', publishedAt: '2026-01-01T00:00:00Z' }] }) };
      },
      NOAA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
    });

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: customTransports,
      analysisConfig: defaultConfig,
      qwenRunner: createSuccessRunner(),
    });

    assert(retrievalCalled, 'retrieval was rerun before attempt2');
    assert(result.lifecycle.modelAttempts === 2, 'attempt2 reserved');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('39. PROCESSING attempts1 recovery + rerun yields NO_EVIDENCE -> fail closed RECOVERY_INCONSISTENCY', async () => {
    const paths = getDbPaths('test_39');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-39');
    await lifeRepo.createInitialRecord('task-39');
    await lifeRepo.recordModelAttempt('task-39'); // PROCESSING attempts 1

    const noResultTransports: MultiSourceTransports = Object.freeze({
      EPA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
      NOAA: async () => ({ status: 200, json: async () => ({ results: [] }) }),
    });

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: noResultTransports,
        analysisConfig: defaultConfig,
      });
      assert(false, 'Should have failed with recovery inconsistency');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'RECOVERY_INCONSISTENCY', 'recovery inconsistency code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('40. PROCESSING attempts1 recovery + rerun yields INSUFFICIENT_EVIDENCE -> fail closed RECOVERY_INCONSISTENCY', async () => {
    const paths = getDbPaths('test_40');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-40');
    await lifeRepo.createInitialRecord('task-40');
    await lifeRepo.recordModelAttempt('task-40'); // PROCESSING attempts 1

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: { ...defaultConfig, maxContextChars: 5 }, // forces INSUFFICIENT_EVIDENCE
      });
      assert(false, 'Should have failed with recovery inconsistency');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'RECOVERY_INCONSISTENCY', 'recovery inconsistency code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('41. PROCESSING attempts2 recovery -> zero Qwen calls', async () => {
    const paths = getDbPaths('test_41_zero_qwen');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-41-zero-qwen');
    await lifeRepo.createInitialRecord('task-41-zero-qwen');
    await lifeRepo.recordModelAttempt('task-41-zero-qwen');
    await lifeRepo.recordModelAttempt('task-41-zero-qwen'); // attempts 2

    let qwenCalled = false;
    await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
      qwenRunner: async () => {
        qwenCalled = true;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });

    assert(!qwenCalled, 'Qwen must not be called during attempts2 recovery');

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('42. INTERRUPTED_MODEL_ATTEMPT record has no exitCode field', async () => {
    const paths = getDbPaths('test_42');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-42');
    await lifeRepo.createInitialRecord('task-42');
    await lifeRepo.recordModelAttempt('task-42');
    await lifeRepo.recordModelAttempt('task-42'); // attempts 2

    const result = await processLocalTask(task, {
      lifecycleRepository: lifeRepo,
      nonAdvisoryOutcomeRepository: nonAdvRepo,
      advisoryOutboxRepository: advRepo,
      retrievalTransports: createSuccessTransports(),
      analysisConfig: defaultConfig,
    });

    if (result.kind === 'NON_ADVISORY_PENDING_REPORT') {
      assert(result.outcome.reason === 'INTERRUPTED_MODEL_ATTEMPT', 'reason');
      assert(!('exitCode' in result.outcome), 'exitCode field must be absent');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  // ==================================================
  // FAIL-CLOSED DEPENDENCY / CONTRACT MATRIX (43-46)
  // ==================================================

  await test('43. router contract failure -> fail closed DEPENDENCY_FAILURE', async () => {
    const paths = getDbPaths('test_43');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-43');
    const badTransports = {} as MultiSourceTransports; // missing EPA/NOAA transports

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: badTransports,
        analysisConfig: defaultConfig,
      });
      assert(false, 'Should have failed with dependency failure');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'DEPENDENCY_FAILURE', 'dependency failure code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('44. evidence selection failure -> fail closed DEPENDENCY_FAILURE', async () => {
    const paths = getDbPaths('test_44');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-44');
    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
        selectEvidenceFn: () => {
          throw new LocalEvidenceSelectionError('SELECTION_CONTRACT_FAILURE');
        },
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof LocalTaskProcessingOrchestratorError, 'orchestrator error');
      assert((err as LocalTaskProcessingOrchestratorError).code === 'DEPENDENCY_FAILURE', 'dependency failure code');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  await test('45. repository failure -> fail closed DEPENDENCY_FAILURE', async () => {
    const paths = getDbPaths('test_45');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-45');
    lifeRepo.close(); // closing repo before operation forces repository failure

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err !== undefined, 'error thrown');
    }

    nonAdvRepo.close();
    advRepo.close();
  });

  await test('46. unsupported lifecycle state -> fail closed LIFECYCLE_INCONSISTENCY', async () => {
    const paths = getDbPaths('test_46');
    const lifeRepo = new SqliteTaskProcessingLifecycleRepository(paths.lifecycle);
    const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(paths.nonAdvisory);
    const advRepo = new SqliteAdvisoryResultOutboxRepository(paths.advisory);

    const task = createSampleStoredTask('task-46');
    // Manually force an invalid lifecycle state in SQLite
    await lifeRepo.createInitialRecord('task-46');
    const rawDb = (lifeRepo as any).db;
    rawDb.exec("UPDATE peia_task_processing SET state = 'UNKNOWN_STATE' WHERE task_id = 'task-46'");

    try {
      await processLocalTask(task, {
        lifecycleRepository: lifeRepo,
        nonAdvisoryOutcomeRepository: nonAdvRepo,
        advisoryOutboxRepository: advRepo,
        retrievalTransports: createSuccessTransports(),
        analysisConfig: defaultConfig,
      });
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err !== undefined, 'error thrown');
    }

    lifeRepo.close();
    nonAdvRepo.close();
    advRepo.close();
  });

  // ==================================================
  // AUTHORITY BOUNDARY MATRIX (47-49)
  // ==================================================

  await test('47. authority check: no server reporting dependency in orchestrator source', () => {
    const sourcePath = path.join(process.cwd(), 'peia-worker/src/localTaskProcessingOrchestrator.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert(!source.includes('fetch('), 'no fetch calls');
    assert(!source.includes('http://'), 'no http endpoints');
    assert(!source.includes('https://'), 'no https endpoints');
  });

  await test('48. authority check: no Firestore dependency in orchestrator source', () => {
    const sourcePath = path.join(process.cwd(), 'peia-worker/src/localTaskProcessingOrchestrator.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert(!source.includes('firestore'), 'no firestore reference');
    assert(!source.includes('firebase'), 'no firebase reference');
  });

  await test('49. authority check: no publish/approve/reject action path in orchestrator source', () => {
    const sourcePath = path.join(process.cwd(), 'peia-worker/src/localTaskProcessingOrchestrator.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert(!source.includes('.publish('), 'no publish methods');
    assert(!source.includes('.approve('), 'no approve methods');
    assert(!source.includes('.reject('), 'no reject methods');
  });

  cleanup();

  console.log(`\nALL ORCHESTRATOR 49-SCENARIO TESTS COMPLETED: ${passedTests}/${totalTests} PASSED`);
})();
