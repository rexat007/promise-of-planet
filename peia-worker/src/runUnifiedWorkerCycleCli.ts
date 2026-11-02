import { WorkerRuntimeConfigError } from './workerRuntimeConfig';
import { runSingleDownloadCycle } from './singleDownloadCycle';
import { PendingTaskHttpDownloadTransportError } from './pendingTaskHttpDownloadTransport';
import { PendingTaskDownloadResponseError } from './downloadTaskResponseContract';
import {
  SqlitePendingTaskRepository,
  SqlitePendingTaskRepositoryError,
} from './sqlitePendingTaskRepository';
import {
  LocalPendingTaskStoreContractError,
  type StoredPendingTaskRecord,
} from './localPendingTaskStoreContract';
import {
  SqliteTaskProcessingLifecycleRepository,
  SqliteTaskProcessingLifecycleRepositoryError,
} from './sqliteTaskProcessingLifecycleRepository';
import {
  TaskProcessingState,
  LocalTaskProcessingLifecycleContractError,
} from './localTaskProcessingLifecycleContract';
import {
  SqliteAdvisoryResultOutboxRepository,
  SqliteAdvisoryResultOutboxRepositoryError,
} from './sqliteAdvisoryResultOutboxRepository';
import { LocalAdvisoryResultOutboxContractError } from './localAdvisoryResultOutboxContract';
import {
  SqliteNonAdvisoryOutcomeRepository,
  SqliteNonAdvisoryOutcomeRepositoryError,
} from './sqliteNonAdvisoryOutcomeRepository';
import { LocalNonAdvisoryOutcomeContractError } from './localNonAdvisoryOutcomeContract';
import {
  processLocalTask,
  LocalTaskProcessingOrchestratorError,
  type LocalTaskProcessingOrchestratorDependencies,
  type LocalTaskProcessingOrchestratorResult,
} from './localTaskProcessingOrchestrator';
import {
  type LocalAnalysisRuntimeConfig,
  type QwenProcessRunner,
} from './localAnalysisRuntime';
import {
  type MultiSourceTransports,
} from './multiSourceKnowledgeRetrievalRouter';
import {
  runResultSubmissionCycle,
  type SubmissionCycleConfig,
  type SubmissionResult,
} from './localResultSubmissionCycle';
import { AdvisoryResultHttpUploadTransportError } from './advisoryResultHttpUploadTransport';
import { NonAdvisoryOutcomeHttpReportTransportError } from './nonAdvisoryOutcomeHttpReportTransport';

export const UnifiedWorkerCliMode = {
  Download: 'download',
  Process: 'process',
  Submit: 'submit',
  Full: 'full',
} as const;

export type UnifiedWorkerCliMode =
  typeof UnifiedWorkerCliMode[keyof typeof UnifiedWorkerCliMode];

const ALLOWED_MODES = new Set<string>([
  UnifiedWorkerCliMode.Download,
  UnifiedWorkerCliMode.Process,
  UnifiedWorkerCliMode.Submit,
  UnifiedWorkerCliMode.Full,
]);

export const DEFAULT_DOWNLOAD_MAX_TASKS = 1;
export const DEFAULT_PROCESS_MAX_TASKS = 10;
export const MAX_BOUNDED_BATCH_LIMIT = 50;

const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

export type UnifiedWorkerCliErrorCode =
  | 'INVALID_CLI_ARGUMENTS'
  | 'INVALID_RUNTIME_CONFIG'
  | 'OFFLINE_NETWORK_VIOLATION';

export class UnifiedWorkerCliError extends Error {
  readonly code: UnifiedWorkerCliErrorCode;

  constructor(code: UnifiedWorkerCliErrorCode, message: string) {
    super(message);
    this.name = 'UnifiedWorkerCliError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ParsedUnifiedCliArgs {
  readonly mode: UnifiedWorkerCliMode;
  readonly maxTasks?: number;
}

export function parseUnifiedWorkerCliArgs(
  argv: readonly string[]
): ParsedUnifiedCliArgs {
  if (!Array.isArray(argv)) {
    throw new UnifiedWorkerCliError(
      'INVALID_CLI_ARGUMENTS',
      'CLI arguments must be an array.'
    );
  }

  let resolvedMode: UnifiedWorkerCliMode | undefined;
  let resolvedMaxTasks: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (
      typeof arg !== 'string' ||
      arg.length === 0 ||
      arg !== arg.trim() ||
      CONTROL_CHAR_REGEX.test(arg)
    ) {
      throw new UnifiedWorkerCliError(
        'INVALID_CLI_ARGUMENTS',
        'Invalid or unsafe CLI argument supplied.'
      );
    }

    if (arg === '--mode') {
      if (i + 1 >= argv.length) {
        throw new UnifiedWorkerCliError(
          'INVALID_CLI_ARGUMENTS',
          'Missing value for --mode flag.'
        );
      }
      const nextVal = argv[++i];
      if (
        typeof nextVal !== 'string' ||
        !ALLOWED_MODES.has(nextVal) ||
        resolvedMode !== undefined
      ) {
        throw new UnifiedWorkerCliError(
          'INVALID_CLI_ARGUMENTS',
          'Invalid or duplicate CLI mode specified.'
        );
      }
      resolvedMode = nextVal as UnifiedWorkerCliMode;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      const modeVal = arg.slice('--mode='.length);
      if (!ALLOWED_MODES.has(modeVal) || resolvedMode !== undefined) {
        throw new UnifiedWorkerCliError(
          'INVALID_CLI_ARGUMENTS',
          'Invalid or duplicate CLI mode specified.'
        );
      }
      resolvedMode = modeVal as UnifiedWorkerCliMode;
      continue;
    }

    if (arg === '--max-tasks') {
      if (i + 1 >= argv.length) {
        throw new UnifiedWorkerCliError(
          'INVALID_CLI_ARGUMENTS',
          'Missing value for --max-tasks flag.'
        );
      }
      const nextVal = argv[++i];
      resolvedMaxTasks = parseBoundedMaxTasksValue(nextVal, '--max-tasks');
      continue;
    }

    if (arg.startsWith('--max-tasks=')) {
      const rawMax = arg.slice('--max-tasks='.length);
      resolvedMaxTasks = parseBoundedMaxTasksValue(rawMax, '--max-tasks');
      continue;
    }

    if (arg.startsWith('-')) {
      throw new UnifiedWorkerCliError(
        'INVALID_CLI_ARGUMENTS',
        'Unknown CLI flag supplied.'
      );
    }

    if (!ALLOWED_MODES.has(arg) || resolvedMode !== undefined) {
      throw new UnifiedWorkerCliError(
        'INVALID_CLI_ARGUMENTS',
        'Unknown or duplicate CLI mode argument.'
      );
    }

    resolvedMode = arg as UnifiedWorkerCliMode;
  }

  if (resolvedMode === undefined) {
    throw new UnifiedWorkerCliError(
      'INVALID_CLI_ARGUMENTS',
      'Explicit CLI mode is required (download, process, submit, or full).'
    );
  }

  return Object.freeze({
    mode: resolvedMode,
    ...(resolvedMaxTasks !== undefined ? { maxTasks: resolvedMaxTasks } : {}),
  });
}

function parseBoundedMaxTasksValue(raw: unknown, label: string): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new UnifiedWorkerCliError(
      'INVALID_CLI_ARGUMENTS',
      `Invalid ${label}: must be a positive integer between 1 and ${MAX_BOUNDED_BATCH_LIMIT}.`
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_BOUNDED_BATCH_LIMIT
  ) {
    throw new UnifiedWorkerCliError(
      'INVALID_CLI_ARGUMENTS',
      `Invalid ${label}: must be between 1 and ${MAX_BOUNDED_BATCH_LIMIT}.`
    );
  }
  return parsed;
}

function validateNonEmptyTrimmedConfigString(
  value: unknown,
  varName: string
): string {
  if (typeof value !== 'string') {
    throw new WorkerRuntimeConfigError(
      `Invalid configuration: ${varName} is missing or not a string.`
    );
  }
  if (
    value.length === 0 ||
    value !== value.trim() ||
    CONTROL_CHAR_REGEX.test(value)
  ) {
    throw new WorkerRuntimeConfigError(
      `Invalid configuration: ${varName} must be a non-empty, trimmed string without control characters.`
    );
  }
  return value;
}

function validateCredentialConfigString(
  value: unknown,
  varName: string
): string {
  if (typeof value !== 'string') {
    throw new WorkerRuntimeConfigError(
      `Invalid configuration: ${varName} is missing or not a string.`
    );
  }
  if (
    value.length === 0 ||
    value !== value.trim() ||
    /\s/.test(value) ||
    CONTROL_CHAR_REGEX.test(value)
  ) {
    throw new WorkerRuntimeConfigError(
      `Invalid configuration: ${varName} must be a non-empty string with no whitespace, CR, or LF.`
    );
  }
  return value;
}

function validateHttpsOrLoopbackUrlConfigString(
  value: unknown,
  varName: string
): string {
  const trimmed = validateNonEmptyTrimmedConfigString(value, varName);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WorkerRuntimeConfigError(
      `Invalid configuration: ${varName} is not a valid URL.`
    );
  }

  if (parsed.protocol === 'https:') {
    return trimmed;
  }

  if (parsed.protocol === 'http:') {
    const host = parsed.hostname;
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]'
    ) {
      return trimmed;
    }
  }

  throw new WorkerRuntimeConfigError(
    `Invalid configuration: ${varName} must use HTTPS or loopback HTTP.`
  );
}

export interface UnifiedDownloadStageConfig {
  readonly databasePath: string;
  readonly endpointUrl: string;
  readonly credential: string;
  readonly maxTasks: number;
}

export interface UnifiedProcessStageConfig {
  readonly databasePath: string;
  readonly analysisConfig: LocalAnalysisRuntimeConfig;
  readonly maxTasks: number;
}

export interface UnifiedSubmitStageConfig {
  readonly databasePath: string;
  readonly advisoryEndpointUrl: string;
  readonly nonAdvisoryEndpointUrl: string;
  readonly credential: string;
}

export interface UnifiedValidatedModeConfig {
  readonly mode: UnifiedWorkerCliMode;
  readonly databasePath: string;
  readonly download?: UnifiedDownloadStageConfig;
  readonly process?: UnifiedProcessStageConfig;
  readonly submit?: UnifiedSubmitStageConfig;
}

export function loadUnifiedWorkerConfigForMode(
  env: Readonly<Record<string, string | undefined>>,
  parsedArgs: ParsedUnifiedCliArgs
): UnifiedValidatedModeConfig {
  const databasePath = validateNonEmptyTrimmedConfigString(
    env.PEIA_LOCAL_DATABASE_PATH,
    'PEIA_LOCAL_DATABASE_PATH'
  );

  let envMaxTasks: number | undefined;
  if (
    env.PEIA_MAX_BATCH_TASKS !== undefined &&
    env.PEIA_MAX_BATCH_TASKS !== ''
  ) {
    if (
      typeof env.PEIA_MAX_BATCH_TASKS !== 'string' ||
      !/^\d+$/.test(env.PEIA_MAX_BATCH_TASKS)
    ) {
      throw new WorkerRuntimeConfigError(
        `Invalid configuration: PEIA_MAX_BATCH_TASKS must be an integer between 1 and ${MAX_BOUNDED_BATCH_LIMIT}.`
      );
    }
    const parsedBatch = Number.parseInt(env.PEIA_MAX_BATCH_TASKS, 10);
    if (
      !Number.isInteger(parsedBatch) ||
      parsedBatch < 1 ||
      parsedBatch > MAX_BOUNDED_BATCH_LIMIT
    ) {
      throw new WorkerRuntimeConfigError(
        `Invalid configuration: PEIA_MAX_BATCH_TASKS must be between 1 and ${MAX_BOUNDED_BATCH_LIMIT}.`
      );
    }
    envMaxTasks = parsedBatch;
  }

  const effectiveDownloadMaxTasks =
    parsedArgs.maxTasks ?? envMaxTasks ?? DEFAULT_DOWNLOAD_MAX_TASKS;
  const effectiveProcessMaxTasks =
    parsedArgs.maxTasks ?? envMaxTasks ?? DEFAULT_PROCESS_MAX_TASKS;

  const needsDownload =
    parsedArgs.mode === UnifiedWorkerCliMode.Download ||
    parsedArgs.mode === UnifiedWorkerCliMode.Full;
  const needsProcess =
    parsedArgs.mode === UnifiedWorkerCliMode.Process ||
    parsedArgs.mode === UnifiedWorkerCliMode.Full;
  const needsSubmit =
    parsedArgs.mode === UnifiedWorkerCliMode.Submit ||
    parsedArgs.mode === UnifiedWorkerCliMode.Full;

  let downloadConfig: UnifiedDownloadStageConfig | undefined;
  if (needsDownload) {
    const endpointUrl = validateHttpsOrLoopbackUrlConfigString(
      env.PEIA_TASK_ENDPOINT_URL,
      'PEIA_TASK_ENDPOINT_URL'
    );
    const credential = validateCredentialConfigString(
      env.PEIA_MACHINE_CREDENTIAL,
      'PEIA_MACHINE_CREDENTIAL'
    );
    downloadConfig = Object.freeze({
      databasePath,
      endpointUrl,
      credential,
      maxTasks: effectiveDownloadMaxTasks,
    });
  }

  let processConfig: UnifiedProcessStageConfig | undefined;
  if (needsProcess) {
    const llamaCliPath = validateNonEmptyTrimmedConfigString(
      env.PEIA_LLAMA_CLI_PATH,
      'PEIA_LLAMA_CLI_PATH'
    );
    const modelPath = validateNonEmptyTrimmedConfigString(
      env.PEIA_MODEL_PATH,
      'PEIA_MODEL_PATH'
    );

    let cpuThreads: number | undefined;
    if (env.PEIA_CPU_THREADS !== undefined && env.PEIA_CPU_THREADS !== '') {
      if (!/^\d+$/.test(env.PEIA_CPU_THREADS)) {
        throw new WorkerRuntimeConfigError(
          'Invalid configuration: PEIA_CPU_THREADS must be a positive integer.'
        );
      }
      const parsedThreads = Number.parseInt(env.PEIA_CPU_THREADS, 10);
      if (!Number.isInteger(parsedThreads) || parsedThreads <= 0) {
        throw new WorkerRuntimeConfigError(
          'Invalid configuration: PEIA_CPU_THREADS must be a positive integer.'
        );
      }
      cpuThreads = parsedThreads;
    }

    const analysisConfig: LocalAnalysisRuntimeConfig = Object.freeze({
      llamaCliPath,
      modelPath,
      ...(cpuThreads !== undefined ? { cpuThreads } : {}),
    });

    processConfig = Object.freeze({
      databasePath,
      analysisConfig,
      maxTasks: effectiveProcessMaxTasks,
    });
  }

  let submitConfig: UnifiedSubmitStageConfig | undefined;
  if (needsSubmit) {
    const advisoryEndpointUrl = validateHttpsOrLoopbackUrlConfigString(
      env.PEIA_ADVISORY_RESULT_ENDPOINT_URL,
      'PEIA_ADVISORY_RESULT_ENDPOINT_URL'
    );
    const nonAdvisoryEndpointUrl = validateHttpsOrLoopbackUrlConfigString(
      env.PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL,
      'PEIA_NON_ADVISORY_OUTCOME_ENDPOINT_URL'
    );
    const credential = validateCredentialConfigString(
      env.PEIA_MACHINE_CREDENTIAL,
      'PEIA_MACHINE_CREDENTIAL'
    );

    submitConfig = Object.freeze({
      databasePath,
      advisoryEndpointUrl,
      nonAdvisoryEndpointUrl,
      credential,
    });
  }

  return Object.freeze({
    mode: parsedArgs.mode,
    databasePath,
    ...(downloadConfig !== undefined ? { download: downloadConfig } : {}),
    ...(processConfig !== undefined ? { process: processConfig } : {}),
    ...(submitConfig !== undefined ? { submit: submitConfig } : {}),
  });
}

export const OFFLINE_PROHIBITED_TRANSPORTS: MultiSourceTransports = Object.freeze({
  EPA: async () => {
    throw new UnifiedWorkerCliError(
      'OFFLINE_NETWORK_VIOLATION',
      'Offline process mode prohibits EPA network retrieval.'
    );
  },
  NOAA: async () => {
    throw new UnifiedWorkerCliError(
      'OFFLINE_NETWORK_VIOLATION',
      'Offline process mode prohibits NOAA network retrieval.'
    );
  },
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isOfflineSnapshotCapableTask(
  task: StoredPendingTaskRecord
): boolean {
  return (
    isPlainObject(task) &&
    isPlainObject(task.contentSnapshot) &&
    task.contentSnapshot['allowSnapshotEvidence'] === true
  );
}

export interface DownloadStageSummary {
  readonly stage: 'download';
  readonly downloadedCount: number;
  readonly storedTaskIds: readonly string[];
  readonly stoppedReason:
    | 'NO_TASK'
    | 'MAX_TASKS_REACHED'
    | 'DUPLICATE_TASK_IDEMPOTENT';
}

export type ProcessTaskExecutionStatus =
  | 'ADVISORY_PENDING_UPLOAD'
  | 'NON_ADVISORY_PENDING_REPORT'
  | 'ALREADY_COMPLETED'
  | 'DEFERRED_EXTERNAL_EVIDENCE_REQUIRED';

export interface ProcessStageTaskOutcome {
  readonly taskId: string;
  readonly status: ProcessTaskExecutionStatus;
}

export interface ProcessStageSummary {
  readonly stage: 'process';
  readonly processedCount: number;
  readonly deferredCount: number;
  readonly outcomes: readonly ProcessStageTaskOutcome[];
  readonly deferredTaskIds: readonly string[];
}

export interface SubmitStageSummary {
  readonly stage: 'submit';
  readonly totalAttempted: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly localInconsistencyCount: number;
  readonly results: readonly {
    readonly taskId: string;
    readonly status: SubmissionResult['status'];
  }[];
}

export interface UnifiedWorkerCliDependencies {
  readonly runDownloadCycle: typeof runSingleDownloadCycle;
  readonly processTask: (
    task: StoredPendingTaskRecord,
    deps: LocalTaskProcessingOrchestratorDependencies
  ) => Promise<LocalTaskProcessingOrchestratorResult>;
  readonly runSubmissionCycle: (
    config: SubmissionCycleConfig
  ) => Promise<readonly SubmissionResult[]>;
  readonly createPendingTaskRepository: (
    databasePath: string
  ) => SqlitePendingTaskRepository;
  readonly createLifecycleRepository: (
    databasePath: string
  ) => SqliteTaskProcessingLifecycleRepository;
  readonly createAdvisoryOutboxRepository: (
    databasePath: string
  ) => SqliteAdvisoryResultOutboxRepository;
  readonly createNonAdvisoryOutcomeRepository: (
    databasePath: string
  ) => SqliteNonAdvisoryOutcomeRepository;
  readonly qwenRunner?: QwenProcessRunner;
  readonly clock?: () => string;
  readonly writeStdout: (data: string) => void;
  readonly writeStderr: (data: string) => void;
}

export function createDefaultUnifiedWorkerCliDependencies(): UnifiedWorkerCliDependencies {
  return Object.freeze({
    runDownloadCycle: runSingleDownloadCycle,
    processTask: processLocalTask,
    runSubmissionCycle: runResultSubmissionCycle,
    createPendingTaskRepository: (dbPath: string) =>
      new SqlitePendingTaskRepository(dbPath),
    createLifecycleRepository: (dbPath: string) =>
      new SqliteTaskProcessingLifecycleRepository(dbPath),
    createAdvisoryOutboxRepository: (dbPath: string) =>
      new SqliteAdvisoryResultOutboxRepository(dbPath),
    createNonAdvisoryOutcomeRepository: (dbPath: string) =>
      new SqliteNonAdvisoryOutcomeRepository(dbPath),
    writeStdout: (line: string) => console.log(line),
    writeStderr: (line: string) => console.error(line),
  });
}

async function executeBoundedDownloadStage(
  config: UnifiedDownloadStageConfig,
  deps: UnifiedWorkerCliDependencies
): Promise<DownloadStageSummary> {
  const storedTaskIds: string[] = [];
  const seenInBatch = new Set<string>();
  let stoppedReason: DownloadStageSummary['stoppedReason'] = 'MAX_TASKS_REACHED';

  for (let i = 0; i < config.maxTasks; i++) {
    const res = await deps.runDownloadCycle({
      databasePath: config.databasePath,
      download: {
        endpointUrl: config.endpointUrl,
        credential: config.credential,
      },
    });

    if (res.kind === 'NO_TASK') {
      stoppedReason = 'NO_TASK';
      break;
    }

    const taskId = res.record.taskId;
    if (seenInBatch.has(taskId)) {
      stoppedReason = 'DUPLICATE_TASK_IDEMPOTENT';
      break;
    }

    seenInBatch.add(taskId);
    storedTaskIds.push(taskId);
  }

  return Object.freeze({
    stage: 'download' as const,
    downloadedCount: storedTaskIds.length,
    storedTaskIds: Object.freeze(storedTaskIds),
    stoppedReason,
  });
}

async function executeOfflineProcessStage(
  config: UnifiedProcessStageConfig,
  deps: UnifiedWorkerCliDependencies
): Promise<ProcessStageSummary> {
  const originalFetch = globalThis.fetch;
  const offlineGuardFetch = (async () => {
    throw new UnifiedWorkerCliError(
      'OFFLINE_NETWORK_VIOLATION',
      'Network access is strictly prohibited during offline process mode.'
    );
  }) as unknown as typeof globalThis.fetch;

  globalThis.fetch = offlineGuardFetch;

  let pendingRepo: SqlitePendingTaskRepository | null = null;
  let lifecycleRepo: SqliteTaskProcessingLifecycleRepository | null = null;
  let advisoryRepo: SqliteAdvisoryResultOutboxRepository | null = null;
  let nonAdvisoryRepo: SqliteNonAdvisoryOutcomeRepository | null = null;

  try {
    pendingRepo = deps.createPendingTaskRepository(config.databasePath);
    lifecycleRepo = deps.createLifecycleRepository(config.databasePath);
    advisoryRepo = deps.createAdvisoryOutboxRepository(config.databasePath);
    nonAdvisoryRepo = deps.createNonAdvisoryOutcomeRepository(config.databasePath);

    const candidateTasks: StoredPendingTaskRecord[] = [];
    const queuedIds = new Set<string>();

    const resumableLifecycleRecords = await lifecycleRepo.listResumableRecords();
    for (const lifeRec of resumableLifecycleRecords) {
      if (candidateTasks.length >= config.maxTasks) {
        break;
      }

      const storedAdvisory = await advisoryRepo.findByTaskId(lifeRec.taskId);
      const storedNonAdvisory = await nonAdvisoryRepo.findByTaskId(lifeRec.taskId);

      const isAlreadySettledForSubmit =
        !(storedAdvisory && storedNonAdvisory) &&
        ((lifeRec.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD &&
          storedAdvisory !== null) ||
          (lifeRec.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT &&
            storedNonAdvisory !== null));

      if (isAlreadySettledForSubmit) {
        continue;
      }

      const pendingTask = await pendingRepo.findByTaskId(lifeRec.taskId);
      if (!pendingTask) {
        throw new LocalTaskProcessingOrchestratorError(
          'LIFECYCLE_INCONSISTENCY',
          `Pending task record missing for resumable lifecycle task: ${lifeRec.taskId}.`
        );
      }

      queuedIds.add(pendingTask.taskId);
      candidateTasks.push(pendingTask);
    }

    const downloadedTasks = await pendingRepo.listDownloaded();
    for (const task of downloadedTasks) {
      if (candidateTasks.length >= config.maxTasks) {
        break;
      }
      if (queuedIds.has(task.taskId)) {
        continue;
      }

      const lifeRec = await lifecycleRepo.findByTaskId(task.taskId);
      const storedAdvisory = await advisoryRepo.findByTaskId(task.taskId);
      const storedNonAdvisory = await nonAdvisoryRepo.findByTaskId(task.taskId);

      if (
        lifeRec &&
        !(storedAdvisory && storedNonAdvisory) &&
        (lifeRec.state === TaskProcessingState.COMPLETED ||
          (lifeRec.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD &&
            storedAdvisory !== null) ||
          (lifeRec.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT &&
            storedNonAdvisory !== null))
      ) {
        continue;
      }

      queuedIds.add(task.taskId);
      candidateTasks.push(task);
    }

    const outcomes: ProcessStageTaskOutcome[] = [];
    const deferredTaskIds: string[] = [];
    let processedCount = 0;

    for (const task of candidateTasks) {
      const lifeRec = await lifecycleRepo.findByTaskId(task.taskId);
      const storedAdvisory = await advisoryRepo.findByTaskId(task.taskId);
      const storedNonAdvisory = await nonAdvisoryRepo.findByTaskId(task.taskId);

      const hasDurableRecoveryRecord =
        storedAdvisory !== null || storedNonAdvisory !== null;
      const isAttempt2CrashRecovery =
        lifeRec !== null &&
        lifeRec.state === TaskProcessingState.PROCESSING &&
        lifeRec.modelAttempts === 2;

      if (
        !hasDurableRecoveryRecord &&
        !isAttempt2CrashRecovery &&
        !isOfflineSnapshotCapableTask(task)
      ) {
        deferredTaskIds.push(task.taskId);
        outcomes.push(
          Object.freeze({
            taskId: task.taskId,
            status: 'DEFERRED_EXTERNAL_EVIDENCE_REQUIRED' as const,
          })
        );
        continue;
      }

      const orchResult = await deps.processTask(task, {
        lifecycleRepository: lifecycleRepo,
        advisoryOutboxRepository: advisoryRepo,
        nonAdvisoryOutcomeRepository: nonAdvisoryRepo,
        retrievalTransports: OFFLINE_PROHIBITED_TRANSPORTS,
        analysisConfig: config.analysisConfig,
        ...(deps.qwenRunner !== undefined ? { qwenRunner: deps.qwenRunner } : {}),
        ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
      });

      processedCount++;
      outcomes.push(
        Object.freeze({
          taskId: task.taskId,
          status: orchResult.kind,
        })
      );
    }

    return Object.freeze({
      stage: 'process' as const,
      processedCount,
      deferredCount: deferredTaskIds.length,
      outcomes: Object.freeze(outcomes),
      deferredTaskIds: Object.freeze(deferredTaskIds),
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (pendingRepo) {
      try {
        pendingRepo.close();
      } catch {
        // ignore close error
      }
    }
    if (lifecycleRepo) {
      try {
        lifecycleRepo.close();
      } catch {
        // ignore close error
      }
    }
    if (advisoryRepo) {
      try {
        advisoryRepo.close();
      } catch {
        // ignore close error
      }
    }
    if (nonAdvisoryRepo) {
      try {
        nonAdvisoryRepo.close();
      } catch {
        // ignore close error
      }
    }
  }
}

async function executeOnlineSubmitStage(
  config: UnifiedSubmitStageConfig,
  deps: UnifiedWorkerCliDependencies
): Promise<SubmitStageSummary> {
  let lifecycleRepo: SqliteTaskProcessingLifecycleRepository | null = null;
  let advisoryRepo: SqliteAdvisoryResultOutboxRepository | null = null;
  let nonAdvisoryRepo: SqliteNonAdvisoryOutcomeRepository | null = null;

  try {
    lifecycleRepo = deps.createLifecycleRepository(config.databasePath);
    advisoryRepo = deps.createAdvisoryOutboxRepository(config.databasePath);
    nonAdvisoryRepo = deps.createNonAdvisoryOutcomeRepository(config.databasePath);

    const submissionResults = await deps.runSubmissionCycle({
      advisoryEndpointUrl: config.advisoryEndpointUrl,
      nonAdvisoryEndpointUrl: config.nonAdvisoryEndpointUrl,
      credential: config.credential,
      outboxRepository: advisoryRepo,
      outcomeRepository: nonAdvisoryRepo,
      lifecycleRepository: lifecycleRepo,
    });

    let completedCount = 0;
    let failedCount = 0;
    let localInconsistencyCount = 0;

    const sanitizedResults = submissionResults.map((item) => {
      if (item.status === 'COMPLETED') {
        completedCount++;
      } else if (item.status === 'SUBMISSION_FAILED') {
        failedCount++;
      } else if (item.status === 'LOCAL_INCONSISTENCY') {
        localInconsistencyCount++;
      }
      return Object.freeze({
        taskId: item.taskId,
        status: item.status,
      });
    });

    return Object.freeze({
      stage: 'submit' as const,
      totalAttempted: sanitizedResults.length,
      completedCount,
      failedCount,
      localInconsistencyCount,
      results: Object.freeze(sanitizedResults),
    });
  } finally {
    if (lifecycleRepo) {
      try {
        lifecycleRepo.close();
      } catch {
        // ignore close error
      }
    }
    if (advisoryRepo) {
      try {
        advisoryRepo.close();
      } catch {
        // ignore close error
      }
    }
    if (nonAdvisoryRepo) {
      try {
        nonAdvisoryRepo.close();
      } catch {
        // ignore close error
      }
    }
  }
}

export async function runUnifiedWorkerCycleCliWithDependencies(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  customDeps?: Partial<UnifiedWorkerCliDependencies>
): Promise<number> {
  const deps: UnifiedWorkerCliDependencies = {
    ...createDefaultUnifiedWorkerCliDependencies(),
    ...(customDeps ?? {}),
  };

  try {
    const parsedArgs = parseUnifiedWorkerCliArgs(argv);
    const validatedConfig = loadUnifiedWorkerConfigForMode(env, parsedArgs);

    const stagesExecuted: string[] = [];
    let downloadSummary: DownloadStageSummary | undefined;
    let processSummary: ProcessStageSummary | undefined;
    let submitSummary: SubmitStageSummary | undefined;

    if (
      validatedConfig.mode === UnifiedWorkerCliMode.Download ||
      validatedConfig.mode === UnifiedWorkerCliMode.Full
    ) {
      downloadSummary = await executeBoundedDownloadStage(
        validatedConfig.download!,
        deps
      );
      stagesExecuted.push('download');
    }

    if (
      validatedConfig.mode === UnifiedWorkerCliMode.Process ||
      validatedConfig.mode === UnifiedWorkerCliMode.Full
    ) {
      processSummary = await executeOfflineProcessStage(
        validatedConfig.process!,
        deps
      );
      stagesExecuted.push('process');
    }

    if (
      validatedConfig.mode === UnifiedWorkerCliMode.Submit ||
      validatedConfig.mode === UnifiedWorkerCliMode.Full
    ) {
      submitSummary = await executeOnlineSubmitStage(
        validatedConfig.submit!,
        deps
      );
      stagesExecuted.push('submit');
    }

    const outputPayload = {
      ok:
        submitSummary === undefined ||
        (submitSummary.failedCount === 0 &&
          submitSummary.localInconsistencyCount === 0),
      mode: validatedConfig.mode,
      stagesExecuted,
      ...(downloadSummary !== undefined ? { download: downloadSummary } : {}),
      ...(processSummary !== undefined ? { process: processSummary } : {}),
      ...(submitSummary !== undefined ? { submit: submitSummary } : {}),
    };

    deps.writeStdout(JSON.stringify(outputPayload));

    if (submitSummary !== undefined) {
      if (submitSummary.localInconsistencyCount > 0) {
        return 4;
      }
      if (submitSummary.failedCount > 0) {
        return 3;
      }
    }

    return 0;
  } catch (error: unknown) {
    let exitCode = 5;
    let category = 'UNEXPECTED';
    let code = 'UNEXPECTED_ERROR';
    let message = 'An unexpected error occurred.';

    if (error instanceof UnifiedWorkerCliError) {
      if (
        error.code === 'INVALID_CLI_ARGUMENTS' ||
        error.code === 'INVALID_RUNTIME_CONFIG'
      ) {
        exitCode = 2;
        category = 'CONFIG';
        code = error.code;
        message = error.message;
      } else if (error.code === 'OFFLINE_NETWORK_VIOLATION') {
        exitCode = 3;
        category = 'OFFLINE_ISOLATION';
        code = error.code;
        message = 'Network access is prohibited in offline process mode.';
      }
    } else if (error instanceof WorkerRuntimeConfigError) {
      exitCode = 2;
      category = 'CONFIG';
      code = error.code;
      message = error.message;
    } else if (
      error instanceof PendingTaskHttpDownloadTransportError ||
      error instanceof PendingTaskDownloadResponseError ||
      error instanceof AdvisoryResultHttpUploadTransportError ||
      error instanceof NonAdvisoryOutcomeHttpReportTransportError
    ) {
      exitCode = 3;
      category = 'NETWORK_OR_RESPONSE';
      code = error.code;
      message = error.message;
    } else if (
      error instanceof SqlitePendingTaskRepositoryError ||
      error instanceof LocalPendingTaskStoreContractError ||
      error instanceof SqliteTaskProcessingLifecycleRepositoryError ||
      error instanceof LocalTaskProcessingLifecycleContractError ||
      error instanceof SqliteAdvisoryResultOutboxRepositoryError ||
      error instanceof LocalAdvisoryResultOutboxContractError ||
      error instanceof SqliteNonAdvisoryOutcomeRepositoryError ||
      error instanceof LocalNonAdvisoryOutcomeContractError ||
      error instanceof LocalTaskProcessingOrchestratorError
    ) {
      exitCode = 4;
      category = 'LOCAL_STORE';
      code = error.code;
      message = 'Local SQLite store or processing lifecycle error.';
    }

    deps.writeStderr(
      JSON.stringify({
        category,
        code,
        message,
      })
    );
    return exitCode;
  }
}

async function main(): Promise<void> {
  const exitCode = await runUnifiedWorkerCycleCliWithDependencies(
    process.argv.slice(2),
    process.env
  );
  process.exit(exitCode);
}

function isMainEntrypoint(): boolean {
  try {
    if (
      typeof require !== 'undefined' &&
      typeof module !== 'undefined' &&
      require.main === module
    ) {
      return true;
    }
  } catch {
    // ignore in ESM context
  }
  const entryArg = process.argv[1];
  if (typeof entryArg === 'string' && entryArg.length > 0) {
    return (
      entryArg.endsWith('runUnifiedWorkerCycleCli.ts') ||
      entryArg.endsWith('runUnifiedWorkerCycleCli.js')
    );
  }
  return false;
}

if (isMainEntrypoint()) {
  main();
}
