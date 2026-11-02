import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

import {
  UnifiedWorkerCliMode,
  UnifiedWorkerCliError,
  parseUnifiedWorkerCliArgs,
  loadUnifiedWorkerConfigForMode,
  runUnifiedWorkerCycleCliWithDependencies,
  OFFLINE_PROHIBITED_TRANSPORTS,
  isOfflineSnapshotCapableTask,
} from '../peia-worker/src/runUnifiedWorkerCycleCli';
import { WorkerRuntimeConfigError } from '../peia-worker/src/workerRuntimeConfig';
import { SqlitePendingTaskRepository } from '../peia-worker/src/sqlitePendingTaskRepository';
import { SqliteTaskProcessingLifecycleRepository } from '../peia-worker/src/sqliteTaskProcessingLifecycleRepository';
import { SqliteAdvisoryResultOutboxRepository } from '../peia-worker/src/sqliteAdvisoryResultOutboxRepository';
import { SqliteNonAdvisoryOutcomeRepository } from '../peia-worker/src/sqliteNonAdvisoryOutcomeRepository';
import { TaskProcessingState } from '../peia-worker/src/localTaskProcessingLifecycleContract';
import {
  LocalPendingTaskState,
  type StoredPendingTaskRecord,
} from '../peia-worker/src/localPendingTaskStoreContract';
import { NonAdvisoryOutcomeKind } from '../peia-worker/src/localNonAdvisoryOutcomeContract';
import type { QwenProcessRunner } from '../peia-worker/src/localAnalysisRuntime';
import { PendingTaskHttpDownloadTransportError } from '../peia-worker/src/pendingTaskHttpDownloadTransport';
import { AITaskType, AITaskStatus } from '../src/types/aiTask';
import { AIReviewTargetType, AIReviewSeverity } from '../src/types/aiReview';

const FIXED_CLOCK = () => '2026-10-08T12:00:00.000Z';

function createTempDbPath(prefix: string): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `peia-unified-cli-${prefix}-`));
  const dbPath = path.join(dir, 'peia-worker.sqlite');
  return {
    dir,
    dbPath,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    },
  };
}

function makeNewsSnapshotTask(taskId: string, targetId = `news-${taskId}`): StoredPendingTaskRecord {
  return Object.freeze({
    taskId,
    principalId: 'principal-1',
    taskType: AITaskType.CONTENT_REVIEW,
    target: Object.freeze({
      targetType: AIReviewTargetType.News,
      targetId,
      sourceUpdatedAt: '2026-10-08T10:00:00.000Z',
    }),
    contentSnapshot: Object.freeze({
      allowSnapshotEvidence: true,
      title: `CONFIDENTIAL_NEWS_TITLE_${taskId}`,
      summary: `CONFIDENTIAL_NEWS_SUMMARY_${taskId}`,
      body: `CONFIDENTIAL_NEWS_BODY_${taskId}_DO_NOT_LEAK_TO_STDOUT`,
    }),
    remoteCreatedAt: '2026-10-08T10:05:00.000Z',
    remoteStatus: AITaskStatus.Pending,
    localState: LocalPendingTaskState.Downloaded,
  });
}

function makeLibrarySnapshotTask(
  taskId: string,
  inputBasis: 'MetadataOnly' | 'SuppliedExcerptAndMetadata' = 'SuppliedExcerptAndMetadata',
  targetId = `intake-${taskId}`
): StoredPendingTaskRecord {
  return Object.freeze({
    taskId,
    principalId: 'principal-1',
    taskType: AITaskType.CONTENT_REVIEW,
    target: Object.freeze({
      targetType: AIReviewTargetType.LibraryIntake,
      targetId,
      sourceUpdatedAt: '2026-10-08T10:00:00.000Z',
    }),
    contentSnapshot: Object.freeze({
      allowSnapshotEvidence: true,
      workingTitle: `SECRET_LIBRARY_TITLE_${taskId}`,
      issuingOrganization: 'Ministry of Environment',
      notes: `SECRET_LIBRARY_NOTES_${taskId}_NEVER_LOG_THIS`,
      ...(inputBasis === 'SuppliedExcerptAndMetadata'
        ? { suppliedExcerpt: `SECRET_SUPPLIED_EXCERPT_${taskId}_DO_NOT_LOG` }
        : {}),
    }),
    remoteCreatedAt: '2026-10-08T10:05:00.000Z',
    remoteStatus: AITaskStatus.Pending,
    localState: LocalPendingTaskState.Downloaded,
  });
}

function makeExternalRetrievalTask(taskId: string, targetId = `ext-news-${taskId}`): StoredPendingTaskRecord {
  return Object.freeze({
    taskId,
    principalId: 'principal-1',
    taskType: AITaskType.CONTENT_REVIEW,
    target: Object.freeze({
      targetType: AIReviewTargetType.News,
      targetId,
      sourceUpdatedAt: '2026-10-08T10:00:00.000Z',
    }),
    contentSnapshot: Object.freeze({
      retrievalQuery: 'air quality compliance',
      body: `EXTERNAL_EPA_TASK_BODY_${taskId}`,
    }),
    remoteCreatedAt: '2026-10-08T10:05:00.000Z',
    remoteStatus: AITaskStatus.Pending,
    localState: LocalPendingTaskState.Downloaded,
  });
}

function createValidLibraryPrepPayload(
  inputBasis: 'MetadataOnly' | 'SuppliedExcerptAndMetadata'
) {
  return {
    inputBasis,
    suggestedTitleAr: 'اللائحة التنفيذية لحماية البيئة البحرية والساحلية ٢٠٢٦',
    suggestedTitleEn: 'Executive Regulation for Marine and Coastal Environmental Protection 2026',
    suggestedIssuingOrganization: 'Ministry of Environment',
    suggestedDocumentType: 'ExecutiveRegulation',
    suggestedEnvironmentalDomains: ['Marine Protection', 'Water Quality'],
    suggestedTopicsAr: ['حماية السواحل', 'جودة المياه'],
    suggestedTopicsEn: ['Coastal Protection', 'Water Quality'],
    suggestedSummaryAr:
      inputBasis === 'MetadataOnly'
        ? null
        : 'ملخص مستند إلى المقتطف المقدم حول معايير تصريف المياه في المناطق الساحلية.',
    suggestedSummaryEn:
      inputBasis === 'MetadataOnly'
        ? null
        : 'Summary grounded in the supplied excerpt covering coastal discharge monitoring standards.',
    provenanceObservationsAr: [
      'البيانات مستمدة من لقطة الإدخال المقدمة غير المتحققة خارجياً.',
    ],
    provenanceObservationsEn: [
      'Derived strictly from the supplied unverified intake snapshot metadata.',
    ],
    uncertaintyNoticesAr: ['لم يتم فحص النص الكامل لملف PDF أو أي رابط خارجي.'],
    uncertaintyNoticesEn: ['Full PDF document and external URLs were not fetched or inspected.'],
  };
}

function extractSnapshotEvidenceIdFromPrompt(prompt: string): string {
  const match = prompt.match(/\[(SNAPSHOT::[^\]]+)\]/);
  return match ? match[1] : 'SNAPSHOT::news-default';
}

function createSmartQwenRunner(callLog?: string[]): QwenProcessRunner {
  return async (req) => {
    const pIndex = req.args.indexOf('-p');
    const prompt = pIndex >= 0 && pIndex + 1 < req.args.length ? req.args[pIndex + 1] : req.args.join(' ');
    if (callLog) {
      callLog.push(prompt);
    }
    const evidenceId = extractSnapshotEvidenceIdFromPrompt(prompt);
    const isLibraryTask = prompt.includes('LibraryIntake');

    if (isLibraryTask) {
      const hasSuppliedExcerpt = prompt.includes('SECRET_SUPPLIED_EXCERPT_');
      const inputBasis: 'MetadataOnly' | 'SuppliedExcerptAndMetadata' = hasSuppliedExcerpt
        ? 'SuppliedExcerptAndMetadata'
        : 'MetadataOnly';
      const jsonOutput = JSON.stringify({
        status: 'READY',
        summary: `Prepared LibraryIntake (${inputBasis}) advisory from supplied offline snapshot.`,
        findings: [
          {
            claim: 'Supplied intake snapshot identifies marine and coastal environmental regulation.',
            evidenceIds: [evidenceId],
            severity: AIReviewSeverity.Info,
          },
        ],
        recommendations: ['Human editor must verify issuing authority against official gazette.'],
        uncertainties: ['Prepared offline from supplied snapshot without external retrieval.'],
        libraryPreparation: createValidLibraryPrepPayload(inputBasis),
      });
      return {
        exitCode: 0,
        stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${jsonOutput}\n`,
        stderr: '',
        timedOut: false,
      };
    }

    const jsonOutput = JSON.stringify({
      status: 'READY',
      summary: 'Reviewed News item against supplied content snapshot.',
      findings: [
        {
          claim: 'Supplied article reports environmental monitoring improvements.',
          evidenceIds: [evidenceId],
          severity: AIReviewSeverity.Info,
        },
      ],
      recommendations: ['Verify monitoring station citations before publication.'],
      uncertainties: ['Offline snapshot review only; external agency feeds were not queried.'],
    });
    return {
      exitCode: 0,
      stdout: `=== YOUR AUDIT RESPONSE (RAW JSON ONLY) ===\n${jsonOutput}\n`,
      stderr: '',
      timedOut: false,
    };
  };
}

async function runTests(): Promise<void> {
  let passed = 0;

  // =========================================================================
  // 1. Existing run:once remains unchanged
  // =========================================================================
  {
    const pkgPath = path.resolve(SCRIPT_DIR, '../peia-worker/package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(
      pkgJson.scripts['run:once'],
      'node dist/peia-worker/src/runSingleDownloadCycleCli.js',
      'peia-worker/package.json must preserve exact run:once script'
    );

    const legacyCliPath = path.resolve(SCRIPT_DIR, '../peia-worker/src/runSingleDownloadCycleCli.ts');
    const legacyCliBytes = fs.readFileSync(legacyCliPath);
    const gitBlobHeader = Buffer.from(`blob ${legacyCliBytes.length}\0`, 'utf8');
    const sha1 = crypto.createHash('sha1').update(gitBlobHeader).update(legacyCliBytes).digest('hex');
    assert.equal(
      sha1,
      'c9b09877960f1bc03d0fd3e21e465e0d43c8954d',
      'runSingleDownloadCycleCli.ts must remain byte-for-byte unchanged'
    );
    console.log('PASS [1/15]: Existing run:once and runSingleDownloadCycleCli.ts remain unchanged');
    passed++;
  }

  // =========================================================================
  // 2. Mode argument validation & mode-scoped config validation
  // =========================================================================
  {
    assert.deepEqual(parseUnifiedWorkerCliArgs(['download']), { mode: UnifiedWorkerCliMode.Download });
    assert.deepEqual(parseUnifiedWorkerCliArgs(['process']), { mode: UnifiedWorkerCliMode.Process });
    assert.deepEqual(parseUnifiedWorkerCliArgs(['submit']), { mode: UnifiedWorkerCliMode.Submit });
    assert.deepEqual(parseUnifiedWorkerCliArgs(['full']), { mode: UnifiedWorkerCliMode.Full });

    assert.deepEqual(parseUnifiedWorkerCliArgs(['--mode', 'download', '--max-tasks', '5']), {
      mode: UnifiedWorkerCliMode.Download,
      maxTasks: 5,
    });
    assert.deepEqual(parseUnifiedWorkerCliArgs(['--mode=process', '--max-tasks=12']), {
      mode: UnifiedWorkerCliMode.Process,
      maxTasks: 12,
    });

    const invalidArgVectors: string[][] = [
      [],
      ['unknown'],
      ['download', 'process'],
      ['--mode'],
      ['--mode', 'invalid'],
      ['--mode=invalid'],
      ['--mode=download', 'submit'],
      ['--unknown-flag'],
      ['download', '--max-tasks'],
      ['download', '--max-tasks', '0'],
      ['download', '--max-tasks', '51'],
      ['download', '--max-tasks', '-1'],
      ['download', '--max-tasks', 'abc'],
      ['download\n'],
      [' download '],
    ];

    for (const argv of invalidArgVectors) {
      assert.throws(
        () => parseUnifiedWorkerCliArgs(argv),
        (err: unknown) => err instanceof UnifiedWorkerCliError && err.code === 'INVALID_CLI_ARGUMENTS',
        `Expected INVALID_CLI_ARGUMENTS for argv=${JSON.stringify(argv)}`
      );
    }

    const processCfg = loadUnifiedWorkerConfigForMode(
      {
        PEIA_LOCAL_DATABASE_PATH: '/tmp/peia.sqlite',
        PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
        PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
      },
      { mode: UnifiedWorkerCliMode.Process }
    );
    assert.equal(processCfg.mode, 'process');
    assert.equal(processCfg.download, undefined);
    assert.equal(processCfg.submit, undefined);
    assert.ok(processCfg.process);

    assert.throws(
      () =>
        loadUnifiedWorkerConfigForMode(
          {
            PEIA_LOCAL_DATABASE_PATH: '/tmp/peia.sqlite',
            PEIA_TASK_ENDPOINT_URL: 'https://api.example.org/tasks',
            PEIA_MACHINE_CREDENTIAL: 'valid-secret-token-123',
            PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
            PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
            // Missing PEIA_ADVISORY_RESULT_ENDPOINT_URL & PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL
          },
          { mode: UnifiedWorkerCliMode.Full }
        ),
      (err: unknown) => err instanceof WorkerRuntimeConfigError
    );

    assert.throws(
      () =>
        loadUnifiedWorkerConfigForMode(
          {
            PEIA_LOCAL_DATABASE_PATH: '/tmp/peia.sqlite',
            PEIA_TASK_ENDPOINT_URL: 'http://remote.example.org/tasks',
            PEIA_MACHINE_CREDENTIAL: 'valid-secret-token-123',
          },
          { mode: UnifiedWorkerCliMode.Download }
        ),
      (err: unknown) => err instanceof WorkerRuntimeConfigError
    );

    console.log('PASS [2/15]: Mode argument validation & mode-scoped config validation');
    passed++;
  }

  // =========================================================================
  // 3. Download-only invokes no inference or upload
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('download-only');
    try {
      let downloadCalls = 0;
      let processCalls = 0;
      let submitCalls = 0;
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['download', '--max-tasks', '2'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_TASK_ENDPOINT_URL: 'https://api.example.org/peia/tasks',
          PEIA_MACHINE_CREDENTIAL: 'TOP_SECRET_CREDENTIAL_DL_01',
        },
        {
          runDownloadCycle: async (cfg) => {
            downloadCalls++;
            if (downloadCalls === 1) {
              const repo = new SqlitePendingTaskRepository(cfg.databasePath);
              const task = makeNewsSnapshotTask('dl-task-1');
              await repo.save(task);
              repo.close();
              return { kind: 'TASK_STORED', record: task };
            }
            return { kind: 'NO_TASK' };
          },
          processTask: async () => {
            processCalls++;
            throw new Error('processTask must not be called in download mode');
          },
          runSubmissionCycle: async () => {
            submitCalls++;
            throw new Error('runSubmissionCycle must not be called in download mode');
          },
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCode, 0);
      assert.equal(downloadCalls, 2);
      assert.equal(processCalls, 0);
      assert.equal(submitCalls, 0);
      assert.equal(stderrLines.length, 0);
      assert.equal(stdoutLines.length, 1);

      const summary = JSON.parse(stdoutLines[0]);
      assert.equal(summary.ok, true);
      assert.equal(summary.mode, 'download');
      assert.deepEqual(summary.stagesExecuted, ['download']);
      assert.equal(summary.download.downloadedCount, 1);
      assert.deepEqual(summary.download.storedTaskIds, ['dl-task-1']);
      assert.equal(summary.download.stoppedReason, 'NO_TASK');
      assert.equal(summary.process, undefined);
      assert.equal(summary.submit, undefined);

      console.log('PASS [3/15]: Download-only invokes no inference or upload');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 4. Process-only performs zero network calls
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('process-zero-net');
    try {
      const pendingRepo = new SqlitePendingTaskRepository(dbPath);
      await pendingRepo.save(makeNewsSnapshotTask('offline-net-check-1'));
      pendingRepo.close();

      let downloadCalls = 0;
      let submitCalls = 0;
      let fetchAttemptedInsideQwenRunner = false;
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      await assert.rejects(
        () => OFFLINE_PROHIBITED_TRANSPORTS.EPA!({} as never),
        (err: unknown) => err instanceof UnifiedWorkerCliError && err.code === 'OFFLINE_NETWORK_VIOLATION'
      );
      await assert.rejects(
        () => OFFLINE_PROHIBITED_TRANSPORTS.NOAA!({} as never),
        (err: unknown) => err instanceof UnifiedWorkerCliError && err.code === 'OFFLINE_NETWORK_VIOLATION'
      );

      const baseRunner = createSmartQwenRunner();
      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['process'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
          PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
        },
        {
          runDownloadCycle: async () => {
            downloadCalls++;
            throw new Error('Must not download in process mode');
          },
          runSubmissionCycle: async () => {
            submitCalls++;
            throw new Error('Must not submit in process mode');
          },
          qwenRunner: async (args) => {
            try {
              await globalThis.fetch('https://example.com');
            } catch (err) {
              if (err instanceof UnifiedWorkerCliError && err.code === 'OFFLINE_NETWORK_VIOLATION') {
                fetchAttemptedInsideQwenRunner = true;
              }
            }
            return baseRunner(args);
          },
          clock: FIXED_CLOCK,
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCode, 0);
      assert.equal(downloadCalls, 0);
      assert.equal(submitCalls, 0);
      assert.equal(fetchAttemptedInsideQwenRunner, true, 'globalThis.fetch must be blocked during process stage');
      assert.equal(stderrLines.length, 0);

      console.log('PASS [4/15]: Process-only performs zero network calls and enforces offline fetch/transport guard');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 5. Submit-only performs no inference or download
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('submit-only');
    try {
      let downloadCalls = 0;
      let processCalls = 0;
      let submitCalls = 0;
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['submit'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_ADVISORY_RESULT_ENDPOINT_URL: 'https://api.example.org/peia/advisory',
          PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL: 'https://api.example.org/peia/non-advisory',
          PEIA_MACHINE_CREDENTIAL: 'SECRET_SUBMIT_TOKEN_01',
        },
        {
          runDownloadCycle: async () => {
            downloadCalls++;
            throw new Error('Must not download in submit mode');
          },
          processTask: async () => {
            processCalls++;
            throw new Error('Must not process in submit mode');
          },
          runSubmissionCycle: async () => {
            submitCalls++;
            return [{ taskId: 'sub-task-1', status: 'COMPLETED' }];
          },
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCode, 0);
      assert.equal(downloadCalls, 0);
      assert.equal(processCalls, 0);
      assert.equal(submitCalls, 1);
      assert.equal(stderrLines.length, 0);

      const summary = JSON.parse(stdoutLines[0]);
      assert.equal(summary.ok, true);
      assert.equal(summary.mode, 'submit');
      assert.deepEqual(summary.stagesExecuted, ['submit']);
      assert.equal(summary.submit.completedCount, 1);

      console.log('PASS [5/15]: Submit-only performs no inference or download');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 6. Full mode stage order (download -> process -> submit)
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('full-stage-order');
    try {
      const stageOrder: string[] = [];
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['full', '--max-tasks', '1'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_TASK_ENDPOINT_URL: 'https://api.example.org/peia/tasks',
          PEIA_ADVISORY_RESULT_ENDPOINT_URL: 'https://api.example.org/peia/advisory',
          PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL: 'https://api.example.org/peia/non-advisory',
          PEIA_MACHINE_CREDENTIAL: 'FULL_MODE_CREDENTIAL_99',
          PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
          PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
        },
        {
          runDownloadCycle: async (cfg) => {
            stageOrder.push('download');
            const repo = new SqlitePendingTaskRepository(cfg.databasePath);
            const task = makeNewsSnapshotTask('full-order-task-1');
            await repo.save(task);
            repo.close();
            return { kind: 'TASK_STORED', record: task };
          },
          qwenRunner: async (args) => {
            stageOrder.push('process');
            return createSmartQwenRunner()(args);
          },
          runSubmissionCycle: async () => {
            stageOrder.push('submit');
            return [{ taskId: 'full-order-task-1', status: 'COMPLETED' }];
          },
          clock: FIXED_CLOCK,
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCode, 0);
      assert.deepEqual(stageOrder, ['download', 'process', 'submit']);
      const summary = JSON.parse(stdoutLines[0]);
      assert.deepEqual(summary.stagesExecuted, ['download', 'process', 'submit']);

      console.log('PASS [6/15]: Full mode enforces sequential stage order (download -> process -> submit)');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 7. Offline News snapshot task processing
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('offline-news-snapshot');
    try {
      const pendingRepo = new SqlitePendingTaskRepository(dbPath);
      await pendingRepo.save(makeNewsSnapshotTask('news-snap-01'));
      pendingRepo.close();

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['process'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
          PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
        },
        {
          qwenRunner: createSmartQwenRunner(),
          clock: FIXED_CLOCK,
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCode, 0);
      assert.equal(stderrLines.length, 0);
      const summary = JSON.parse(stdoutLines[0]);
      assert.equal(summary.process.processedCount, 1);
      assert.equal(summary.process.deferredCount, 0);
      assert.deepEqual(summary.process.outcomes, [
        { taskId: 'news-snap-01', status: 'ADVISORY_PENDING_UPLOAD' },
      ]);

      const outboxRepo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const storedAdvisory = await outboxRepo.findByTaskId('news-snap-01');
      outboxRepo.close();

      assert.ok(storedAdvisory, 'News advisory result must be persisted in SQLite outbox');
      assert.equal(storedAdvisory.result.task.taskId, 'news-snap-01');
      assert.equal(storedAdvisory.result.task.target.targetType, AIReviewTargetType.News);
      assert.equal(storedAdvisory.result.libraryPreparation, undefined);

      console.log('PASS [7/15]: Offline News snapshot task processed and persisted in SQLite outbox');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 8. Offline LibraryIntake snapshot task processing (MetadataOnly + SuppliedExcerptAndMetadata)
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('offline-library-snapshot');
    try {
      const pendingRepo = new SqlitePendingTaskRepository(dbPath);
      await pendingRepo.save(makeLibrarySnapshotTask('lib-snap-meta-01', 'MetadataOnly'));
      await pendingRepo.save(makeLibrarySnapshotTask('lib-snap-excerpt-02', 'SuppliedExcerptAndMetadata'));
      pendingRepo.close();

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['process'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
          PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
        },
        {
          qwenRunner: createSmartQwenRunner(),
          clock: FIXED_CLOCK,
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCode, 0);
      assert.equal(stderrLines.length, 0);
      const summary = JSON.parse(stdoutLines[0]);
      assert.equal(summary.process.processedCount, 2);
      assert.equal(summary.process.deferredCount, 0);

      const outboxRepo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const storedMeta = await outboxRepo.findByTaskId('lib-snap-meta-01');
      const storedExcerpt = await outboxRepo.findByTaskId('lib-snap-excerpt-02');
      outboxRepo.close();

      assert.ok(storedMeta?.result.libraryPreparation, 'MetadataOnly task must preserve libraryPreparation in outbox');
      assert.equal(storedMeta.result.libraryPreparation.inputBasis, 'MetadataOnly');
      assert.equal(storedMeta.result.libraryPreparation.suggestedSummaryAr, null);
      assert.equal(storedMeta.result.libraryPreparation.suggestedSummaryEn, null);

      assert.ok(storedExcerpt?.result.libraryPreparation, 'SuppliedExcerptAndMetadata task must preserve libraryPreparation in outbox');
      assert.equal(storedExcerpt.result.libraryPreparation.inputBasis, 'SuppliedExcerptAndMetadata');
      assert.equal(
        storedExcerpt.result.libraryPreparation.suggestedTitleEn,
        'Executive Regulation for Marine and Coastal Environmental Protection 2026'
      );

      console.log('PASS [8/15]: Offline LibraryIntake snapshot tasks processed and libraryPreparation preserved in SQLite outbox');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 9. External-only tasks are deferred safely while offline
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('external-deferred');
    try {
      const pendingRepo = new SqlitePendingTaskRepository(dbPath);
      const epaTask = makeExternalRetrievalTask('epa-ext-01');
      const snapTask = makeNewsSnapshotTask('news-snap-02');
      await pendingRepo.save(epaTask);
      await pendingRepo.save(snapTask);
      pendingRepo.close();

      assert.equal(isOfflineSnapshotCapableTask(epaTask), false);
      assert.equal(isOfflineSnapshotCapableTask(snapTask), true);

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['process'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
          PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
        },
        {
          qwenRunner: createSmartQwenRunner(),
          clock: FIXED_CLOCK,
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCode, 0);
      assert.equal(stderrLines.length, 0);

      const summary = JSON.parse(stdoutLines[0]);
      assert.equal(summary.process.processedCount, 1);
      assert.equal(summary.process.deferredCount, 1);
      assert.deepEqual(summary.process.deferredTaskIds, ['epa-ext-01']);
      assert.deepEqual(summary.process.outcomes, [
        { taskId: 'epa-ext-01', status: 'DEFERRED_EXTERNAL_EVIDENCE_REQUIRED' },
        { taskId: 'news-snap-02', status: 'ADVISORY_PENDING_UPLOAD' },
      ]);

      const lifecycleRepo = new SqliteTaskProcessingLifecycleRepository(dbPath);
      const epaLife = await lifecycleRepo.findByTaskId('epa-ext-01');
      const snapLife = await lifecycleRepo.findByTaskId('news-snap-02');
      lifecycleRepo.close();

      assert.equal(epaLife, null, 'Deferred external task must remain untouched in lifecycle store');
      assert.equal(snapLife?.state, TaskProcessingState.ADVISORY_PENDING_UPLOAD);

      console.log('PASS [9/15]: External-only tasks are deferred safely while offline without mutating lifecycle state');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 10. Restart resumes pending durable work across process and submit
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('restart-resume');
    try {
      const pendingRepo = new SqlitePendingTaskRepository(dbPath);
      const lifecycleRepo = new SqliteTaskProcessingLifecycleRepository(dbPath);

      // Task A: Interrupted in PROCESSING with modelAttempts === 1 (should resume attempt 2 offline)
      const taskAttempt1 = makeNewsSnapshotTask('crash-attempt1-task');
      await pendingRepo.save(taskAttempt1);
      await lifecycleRepo.createInitialRecord('crash-attempt1-task');
      await lifecycleRepo.recordModelAttempt('crash-attempt1-task');

      // Task B: Interrupted in PROCESSING with modelAttempts === 2 and no durable record (should settle as MODEL_FAILURE without running Qwen)
      const taskAttempt2 = makeExternalRetrievalTask('crash-attempt2-task');
      await pendingRepo.save(taskAttempt2);
      await lifecycleRepo.createInitialRecord('crash-attempt2-task');
      await lifecycleRepo.recordModelAttempt('crash-attempt2-task');
      await lifecycleRepo.recordModelAttempt('crash-attempt2-task');

      pendingRepo.close();
      lifecycleRepo.close();

      const qwenCalls: string[] = [];
      const stdoutLines: string[] = [];

      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['process'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
          PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
        },
        {
          qwenRunner: createSmartQwenRunner(qwenCalls),
          clock: FIXED_CLOCK,
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: () => {},
        }
      );

      assert.equal(exitCode, 0);
      assert.equal(qwenCalls.length, 1, 'Only attempt-1 task should invoke Qwen; attempt-2 crash task settles deterministically');

      const summary = JSON.parse(stdoutLines[0]);
      assert.equal(summary.process.processedCount, 2);
      assert.deepEqual(summary.process.outcomes, [
        { taskId: 'crash-attempt1-task', status: 'ADVISORY_PENDING_UPLOAD' },
        { taskId: 'crash-attempt2-task', status: 'NON_ADVISORY_PENDING_REPORT' },
      ]);

      const nonAdvRepo = new SqliteNonAdvisoryOutcomeRepository(dbPath);
      const attempt2Outcome = await nonAdvRepo.findByTaskId('crash-attempt2-task');
      nonAdvRepo.close();
      assert.equal(attempt2Outcome?.kind, NonAdvisoryOutcomeKind.MODEL_FAILURE);
      assert.equal(attempt2Outcome?.reason, 'INTERRUPTED_MODEL_ATTEMPT');

      console.log('PASS [10/15]: Restart resumes pending durable work across crash recovery states');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 11. Duplicate task download is safe
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('duplicate-download');
    try {
      const stdoutLines: string[] = [];
      let callCount = 0;

      const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
        ['download', '--max-tasks', '5'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_TASK_ENDPOINT_URL: 'https://api.example.org/peia/tasks',
          PEIA_MACHINE_CREDENTIAL: 'DUP_TEST_CREDENTIAL_01',
        },
        {
          runDownloadCycle: async (cfg) => {
            callCount++;
            const repo = new SqlitePendingTaskRepository(cfg.databasePath);
            const sameTask = makeNewsSnapshotTask('dup-task-01');
            await repo.save(sameTask);
            repo.close();
            return { kind: 'TASK_STORED', record: sameTask };
          },
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: () => {},
        }
      );

      assert.equal(exitCode, 0);
      assert.equal(callCount, 2, 'Should stop immediately when server returns the same unacknowledged taskId twice in a batch');

      const summary = JSON.parse(stdoutLines[0]);
      assert.equal(summary.download.downloadedCount, 1);
      assert.deepEqual(summary.download.storedTaskIds, ['dup-task-01']);
      assert.equal(summary.download.stoppedReason, 'DUPLICATE_TASK_IDEMPOTENT');

      const pendingRepo = new SqlitePendingTaskRepository(dbPath);
      const allPending = await pendingRepo.listDownloaded();
      pendingRepo.close();
      assert.equal(allPending.length, 1);

      console.log('PASS [11/15]: Duplicate task download is idempotent and terminates batch loop cleanly');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 12. Same result is never lost after failed upload & 13. Server acknowledgment controls completion
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('upload-retry-and-ack');
    try {
      const pendingRepo = new SqlitePendingTaskRepository(dbPath);
      await pendingRepo.save(makeLibrarySnapshotTask('lib-upload-retry-01', 'SuppliedExcerptAndMetadata'));
      pendingRepo.close();

      await runUnifiedWorkerCycleCliWithDependencies(
        ['process'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
          PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
        },
        {
          qwenRunner: createSmartQwenRunner(),
          clock: FIXED_CLOCK,
          writeStdout: () => {},
          writeStderr: () => {},
        }
      );

      const outboxBefore = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const recordBeforeUpload = await outboxBefore.findByTaskId('lib-upload-retry-01');
      outboxBefore.close();
      assert.ok(recordBeforeUpload);

      const originalFetch = globalThis.fetch;
      const uploadedPayloads: Array<{ result: unknown }> = [];
      let fetchMode: 'FAIL_503' | 'REJECT_UNACKED' | 'ACK_OK' = 'FAIL_503';

      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        if (init?.body && typeof init.body === 'string') {
          uploadedPayloads.push(JSON.parse(init.body));
        }
        if (fetchMode === 'FAIL_503') {
          return new Response('Service Unavailable', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
          });
        }
        if (fetchMode === 'REJECT_UNACKED') {
          return new Response(
            JSON.stringify({
              ok: false,
              taskId: 'lib-upload-retry-01',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            taskId: 'lib-upload-retry-01',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      }) as typeof globalThis.fetch;

      try {
        // Attempt 1: HTTP 503 -> exit code 3, lifecycle stays ADVISORY_PENDING_UPLOAD, outbox intact
        const stdout1: string[] = [];
        const exitCode1 = await runUnifiedWorkerCycleCliWithDependencies(
          ['submit'],
          {
            PEIA_LOCAL_DATABASE_PATH: dbPath,
            PEIA_ADVISORY_RESULT_ENDPOINT_URL: 'https://api.example.org/peia/advisory',
            PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL: 'https://api.example.org/peia/non-advisory',
            PEIA_MACHINE_CREDENTIAL: 'RETRY_CREDENTIAL_01',
          },
          {
            writeStdout: (line) => stdout1.push(line),
            writeStderr: () => {},
          }
        );

        assert.equal(exitCode1, 3, 'Failed submission must return exit code 3');
        const summary1 = JSON.parse(stdout1[0]);
        assert.equal(summary1.ok, false);
        assert.equal(summary1.submit.failedCount, 1);
        assert.equal(summary1.submit.completedCount, 0);

        const lifeRepo1 = new SqliteTaskProcessingLifecycleRepository(dbPath);
        const lifeAfterFail = await lifeRepo1.findByTaskId('lib-upload-retry-01');
        lifeRepo1.close();
        assert.equal(
          lifeAfterFail?.state,
          TaskProcessingState.ADVISORY_PENDING_UPLOAD,
          'Lifecycle state must remain ADVISORY_PENDING_UPLOAD after failed upload'
        );

        // Attempt 2: Server returns 200 but ok: false (unacknowledged) -> must NOT mark COMPLETED
        fetchMode = 'REJECT_UNACKED';
        const stdout2: string[] = [];
        const exitCode2 = await runUnifiedWorkerCycleCliWithDependencies(
          ['submit'],
          {
            PEIA_LOCAL_DATABASE_PATH: dbPath,
            PEIA_ADVISORY_RESULT_ENDPOINT_URL: 'https://api.example.org/peia/advisory',
            PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL: 'https://api.example.org/peia/non-advisory',
            PEIA_MACHINE_CREDENTIAL: 'RETRY_CREDENTIAL_01',
          },
          {
            writeStdout: (line) => stdout2.push(line),
            writeStderr: () => {},
          }
        );

        assert.equal(exitCode2, 3, 'Unacknowledged response must return exit code 3');
        const lifeRepo2 = new SqliteTaskProcessingLifecycleRepository(dbPath);
        const lifeAfterUnacked = await lifeRepo2.findByTaskId('lib-upload-retry-01');
        lifeRepo2.close();
        assert.equal(
          lifeAfterUnacked?.state,
          TaskProcessingState.ADVISORY_PENDING_UPLOAD,
          'Lifecycle state must NOT become COMPLETED without verified server acknowledgment'
        );

        // Attempt 3: Server returns valid acknowledgment -> transitions to COMPLETED and uploads exact same payload
        fetchMode = 'ACK_OK';
        const stdout3: string[] = [];
        const exitCode3 = await runUnifiedWorkerCycleCliWithDependencies(
          ['submit'],
          {
            PEIA_LOCAL_DATABASE_PATH: dbPath,
            PEIA_ADVISORY_RESULT_ENDPOINT_URL: 'https://api.example.org/peia/advisory',
            PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL: 'https://api.example.org/peia/non-advisory',
            PEIA_MACHINE_CREDENTIAL: 'RETRY_CREDENTIAL_01',
          },
          {
            writeStdout: (line) => stdout3.push(line),
            writeStderr: () => {},
          }
        );

        assert.equal(exitCode3, 0, 'Acknowledged retry must return exit code 0');
        const summary3 = JSON.parse(stdout3[0]);
        assert.equal(summary3.ok, true);
        assert.equal(summary3.submit.completedCount, 1);
        assert.equal(summary3.submit.failedCount, 0);

        const lifeRepo3 = new SqliteTaskProcessingLifecycleRepository(dbPath);
        const lifeAfterAck = await lifeRepo3.findByTaskId('lib-upload-retry-01');
        lifeRepo3.close();
        assert.equal(lifeAfterAck?.state, TaskProcessingState.COMPLETED);

        assert.equal(uploadedPayloads.length, 3);
        assert.deepEqual(
          uploadedPayloads[0],
          uploadedPayloads[2],
          'Retry after failed upload must upload the exact same durable advisory result'
        );
        assert.deepEqual(uploadedPayloads[2].result, recordBeforeUpload.result);
      } finally {
        globalThis.fetch = originalFetch;
      }

      console.log('PASS [12/15]: Same result is never lost after failed upload and retries deterministically');
      passed++;
      console.log('PASS [13/15]: Server acknowledgment strictly controls COMPLETED transition');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 14. No secret or source-content logging in stdout or stderr
  // =========================================================================
  {
    const { dbPath, cleanup } = createTempDbPath('no-secret-logging');
    try {
      const secretCredential = 'ULTRA_SENSITIVE_BEARER_SECRET_99887766';
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const exitCodeSuccess = await runUnifiedWorkerCycleCliWithDependencies(
        ['full', '--max-tasks', '1'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_TASK_ENDPOINT_URL: 'https://api.example.org/peia/tasks',
          PEIA_ADVISORY_RESULT_ENDPOINT_URL: 'https://api.example.org/peia/advisory',
          PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL: 'https://api.example.org/peia/non-advisory',
          PEIA_MACHINE_CREDENTIAL: secretCredential,
          PEIA_LLAMA_CLI_PATH: '/opt/llama/llama-cli',
          PEIA_MODEL_PATH: '/opt/models/qwen.gguf',
        },
        {
          runDownloadCycle: async (cfg) => {
            const repo = new SqlitePendingTaskRepository(cfg.databasePath);
            const task = makeLibrarySnapshotTask('sec-task-01', 'SuppliedExcerptAndMetadata');
            await repo.save(task);
            repo.close();
            return { kind: 'TASK_STORED', record: task };
          },
          qwenRunner: createSmartQwenRunner(),
          runSubmissionCycle: async () => [{ taskId: 'sec-task-01', status: 'COMPLETED' }],
          clock: FIXED_CLOCK,
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCodeSuccess, 0);

      const exitCodeFail = await runUnifiedWorkerCycleCliWithDependencies(
        ['download'],
        {
          PEIA_LOCAL_DATABASE_PATH: dbPath,
          PEIA_TASK_ENDPOINT_URL: 'https://api.example.org/peia/tasks',
          PEIA_MACHINE_CREDENTIAL: secretCredential,
        },
        {
          runDownloadCycle: async () => {
            throw new PendingTaskHttpDownloadTransportError(
              'HTTP_STATUS_ERROR',
              'Task download failed with status 500.'
            );
          },
          writeStdout: (line) => stdoutLines.push(line),
          writeStderr: (line) => stderrLines.push(line),
        }
      );

      assert.equal(exitCodeFail, 3);

      const combinedOutput = [...stdoutLines, ...stderrLines].join('\n');
      assert.equal(
        combinedOutput.includes(secretCredential),
        false,
        'Output must never contain PEIA_MACHINE_CREDENTIAL'
      );
      assert.equal(
        combinedOutput.includes('SECRET_LIBRARY_TITLE_sec-task-01'),
        false,
        'Output must never contain task contentSnapshot title'
      );
      assert.equal(
        combinedOutput.includes('SECRET_LIBRARY_NOTES_sec-task-01_NEVER_LOG_THIS'),
        false,
        'Output must never contain task contentSnapshot notes'
      );
      assert.equal(
        combinedOutput.includes('SECRET_SUPPLIED_EXCERPT_sec-task-01_DO_NOT_LOG'),
        false,
        'Output must never contain task contentSnapshot suppliedExcerpt'
      );
      assert.equal(
        combinedOutput.includes('Executive Regulation for Marine and Coastal Environmental Protection 2026'),
        false,
        'Output must never contain advisory result body text'
      );

      console.log('PASS [14/15]: No secret credential or source-content logging on stdout or stderr');
      passed++;
    } finally {
      cleanup();
    }
  }

  // =========================================================================
  // 15. No destructive SQLite operations
  // =========================================================================
  {
    const cliSourcePath = path.resolve(SCRIPT_DIR, '../peia-worker/src/runUnifiedWorkerCycleCli.ts');
    const cliSource = fs.readFileSync(cliSourcePath, 'utf8');

    const prohibitedPatterns = [
      /\bDROP\s+TABLE\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /\bunlinkSync\b/,
      /\brmSync\b/,
    ];

    for (const pattern of prohibitedPatterns) {
      assert.equal(
        pattern.test(cliSource),
        false,
        `runUnifiedWorkerCycleCli.ts must not contain destructive pattern ${pattern}`
      );
    }

    console.log('PASS [15/15]: No destructive SQLite or file deletion operations in unified CLI');
    passed++;
  }

  console.log(`\nALL ${passed}/15 UNIFIED WORKER CLI TEST SUITES PASSED.`);
}

runTests().catch((err) => {
  console.error('UNIFIED WORKER CLI TESTS FAILED:', err);
  process.exit(1);
});
