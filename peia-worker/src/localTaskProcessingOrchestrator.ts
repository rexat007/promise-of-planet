import { StoredPendingTaskRecord } from './localPendingTaskStoreContract';
import {
  TaskProcessingLifecycleRepository,
} from './sqliteTaskProcessingLifecycleRepository';
import {
  TaskProcessingState,
  TaskProcessingTerminalOutcome,
  type TaskProcessingRecord,
} from './localTaskProcessingLifecycleContract';
import {
  LocalAdvisoryResultOutboxRepository,
} from './localAdvisoryResultOutboxContract';
import {
  LocalNonAdvisoryOutcomeRepository,
} from './sqliteNonAdvisoryOutcomeRepository';
import {
  MultiSourceTransports,
  routeMultiSourceRetrieval,
  MultiSourceRetrievalResult,
} from './multiSourceKnowledgeRetrievalRouter';
import {
  LocalAnalysisRuntimeConfig,
  QwenProcessRunner,
  analyzeTaskLocally,
  LocalAnalysisTaskInput,
  DEFAULT_LOCAL_CONTEXT_MAX_CHARS,
} from './localAnalysisRuntime';
import {
  selectLocalEvidence,
  MAX_LOCAL_EVIDENCE_ITEMS_LIMIT,
  LocalEvidenceSelectionResult,
} from './localEvidenceSelectionFoundation';
import {
  extractRetrievalRequestFromTask,
  TaskToRetrievalAdapterError,
} from './taskToRetrievalRequestAdapter';
import {
  persistLocalAnalysisResult,
} from './localAnalysisToAdvisoryPersistence';
import {
  DurableNonAdvisoryOutcomeRecord,
} from './localNonAdvisoryOutcomeContract';
import {
  assembleBoundedEvidenceContext,
} from './localAnalysisRuntime';

export type LocalTaskProcessingOrchestratorErrorCode =
  | 'PERSISTENCE_CONFLICT'
  | 'LIFECYCLE_INCONSISTENCY'
  | 'RECOVERY_INCONSISTENCY'
  | 'DOMAIN_CONTRACT_MISMATCH'
  | 'DEPENDENCY_FAILURE';

export class LocalTaskProcessingOrchestratorError extends Error {
  readonly code: LocalTaskProcessingOrchestratorErrorCode;

  constructor(code: LocalTaskProcessingOrchestratorErrorCode, message: string) {
    super(message);
    this.name = 'LocalTaskProcessingOrchestratorError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface LocalTaskProcessingOrchestratorDependencies {
  readonly lifecycleRepository: TaskProcessingLifecycleRepository;
  readonly advisoryOutboxRepository: LocalAdvisoryResultOutboxRepository;
  readonly nonAdvisoryOutcomeRepository: LocalNonAdvisoryOutcomeRepository;
  readonly retrievalTransports: MultiSourceTransports;
  readonly analysisConfig: LocalAnalysisRuntimeConfig;
  readonly qwenRunner?: QwenProcessRunner;
  readonly clock?: () => string;
  readonly selectEvidenceFn?: typeof selectLocalEvidence;
}

export type LocalTaskProcessingOrchestratorResult =
  | {
      readonly kind: 'ADVISORY_PENDING_UPLOAD';
      readonly taskId: string;
      readonly lifecycle: TaskProcessingRecord;
    }
  | {
      readonly kind: 'NON_ADVISORY_PENDING_REPORT';
      readonly taskId: string;
      readonly lifecycle: TaskProcessingRecord;
      readonly outcome: DurableNonAdvisoryOutcomeRecord;
    }
  | {
      readonly kind: 'ALREADY_COMPLETED';
      readonly taskId: string;
      readonly lifecycle: TaskProcessingRecord;
    };

function mapOutcomeKindToTerminalOutcome(
  kind: DurableNonAdvisoryOutcomeRecord['kind']
): TaskProcessingTerminalOutcome {
  if (kind === 'MODEL_FAILURE') {
    return TaskProcessingTerminalOutcome.MODEL_FAILURE;
  }
  return TaskProcessingTerminalOutcome.ABSTAINED;
}

export async function processLocalTask(
  task: StoredPendingTaskRecord,
  deps: LocalTaskProcessingOrchestratorDependencies
): Promise<LocalTaskProcessingOrchestratorResult> {
  const {
    lifecycleRepository,
    advisoryOutboxRepository,
    nonAdvisoryOutcomeRepository,
    retrievalTransports,
    analysisConfig,
    qwenRunner,
    clock,
    selectEvidenceFn,
  } = deps;

  const selectEvidence = selectEvidenceFn ?? selectLocalEvidence;

  const taskId = task.taskId;
  const now = clock ? clock() : new Date().toISOString();

  let lifecycle = await lifecycleRepository.findByTaskId(taskId);
  const advisory = await advisoryOutboxRepository.findByTaskId(taskId);
  const nonAdvisory = await nonAdvisoryOutcomeRepository.findByTaskId(taskId);

  if (!lifecycle) {
    lifecycle = await lifecycleRepository.createInitialRecord(taskId);
  }

  // 6A. BOTH advisory and non-advisory exist -> fail closed
  if (advisory && nonAdvisory) {
    throw new LocalTaskProcessingOrchestratorError(
      'PERSISTENCE_CONFLICT',
      'Both advisory and non-advisory records exist for task.'
    );
  }

  // 6B. lifecycle = COMPLETED -> ALREADY_COMPLETED
  if (lifecycle.state === TaskProcessingState.COMPLETED) {
    return Object.freeze({
      kind: 'ALREADY_COMPLETED' as const,
      taskId,
      lifecycle,
    });
  }

  // 6C. advisory exists
  if (advisory) {
    if (lifecycle.state === TaskProcessingState.PROCESSING) {
      const updatedLifecycle = await lifecycleRepository.transitionState(
        taskId,
        TaskProcessingState.ADVISORY_PENDING_UPLOAD,
        null
      );
      return Object.freeze({
        kind: 'ADVISORY_PENDING_UPLOAD' as const,
        taskId,
        lifecycle: updatedLifecycle,
      });
    }
    if (lifecycle.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD) {
      return Object.freeze({
        kind: 'ADVISORY_PENDING_UPLOAD' as const,
        taskId,
        lifecycle,
      });
    }
    throw new LocalTaskProcessingOrchestratorError(
      'LIFECYCLE_INCONSISTENCY',
      `Advisory record exists in incompatible lifecycle state: ${lifecycle.state}.`
    );
  }

  // 6D. non-advisory outcome exists
  if (nonAdvisory) {
    const mappedTerminal = mapOutcomeKindToTerminalOutcome(nonAdvisory.kind);

    if (lifecycle.state === TaskProcessingState.READY) {
      if (nonAdvisory.modelAttempts !== 0) {
        throw new LocalTaskProcessingOrchestratorError(
          'RECOVERY_INCONSISTENCY',
          'Non-advisory outcome has modelAttempts > 0 for READY lifecycle task.'
        );
      }
      const updatedLifecycle = await lifecycleRepository.transitionState(
        taskId,
        TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
        mappedTerminal
      );
      return Object.freeze({
        kind: 'NON_ADVISORY_PENDING_REPORT' as const,
        taskId,
        lifecycle: updatedLifecycle,
        outcome: nonAdvisory,
      });
    }

    if (lifecycle.state === TaskProcessingState.PROCESSING) {
      if (nonAdvisory.modelAttempts !== lifecycle.modelAttempts) {
        throw new LocalTaskProcessingOrchestratorError(
          'RECOVERY_INCONSISTENCY',
          'Non-advisory outcome modelAttempts does not match lifecycle modelAttempts.'
        );
      }
      const updatedLifecycle = await lifecycleRepository.transitionState(
        taskId,
        TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
        mappedTerminal
      );
      return Object.freeze({
        kind: 'NON_ADVISORY_PENDING_REPORT' as const,
        taskId,
        lifecycle: updatedLifecycle,
        outcome: nonAdvisory,
      });
    }

    if (lifecycle.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT) {
      if (
        nonAdvisory.modelAttempts !== lifecycle.modelAttempts ||
        lifecycle.terminalOutcome !== mappedTerminal
      ) {
        throw new LocalTaskProcessingOrchestratorError(
          'RECOVERY_INCONSISTENCY',
          'Non-advisory outcome does not match NON_ADVISORY_PENDING_REPORT lifecycle state.'
        );
      }
      return Object.freeze({
        kind: 'NON_ADVISORY_PENDING_REPORT' as const,
        taskId,
        lifecycle,
        outcome: nonAdvisory,
      });
    }

    throw new LocalTaskProcessingOrchestratorError(
      'LIFECYCLE_INCONSISTENCY',
      `Non-advisory outcome exists in incompatible lifecycle state: ${lifecycle.state}.`
    );
  }

  // 6E & 6F. Inconsistent missing records
  if (lifecycle.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD && !advisory) {
    throw new LocalTaskProcessingOrchestratorError(
      'LIFECYCLE_INCONSISTENCY',
      'Lifecycle is ADVISORY_PENDING_UPLOAD but advisory record is missing.'
    );
  }
  if (lifecycle.state === TaskProcessingState.NON_ADVISORY_PENDING_REPORT && !nonAdvisory) {
    throw new LocalTaskProcessingOrchestratorError(
      'LIFECYCLE_INCONSISTENCY',
      'Lifecycle is NON_ADVISORY_PENDING_REPORT but non-advisory record is missing.'
    );
  }

  const taskInput: LocalAnalysisTaskInput = Object.freeze({
    taskId: task.taskId,
    taskType: task.taskType,
    target: task.target,
    contentSnapshot: task.contentSnapshot,
  });

  // 7. Processing Crash Recovery with No Durable Result
  if (lifecycle.state === TaskProcessingState.PROCESSING) {
    if (lifecycle.modelAttempts === 2) {
      const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
        taskId,
        kind: 'MODEL_FAILURE',
        reason: 'INTERRUPTED_MODEL_ATTEMPT',
        modelAttempts: 2,
        detail: 'Task processing crashed or was interrupted during attempt 2 with no durable model result.',
        createdAt: now,
      });
      await nonAdvisoryOutcomeRepository.save(outcome);
      const updatedLifecycle = await lifecycleRepository.transitionState(
        taskId,
        TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
        TaskProcessingTerminalOutcome.MODEL_FAILURE
      );
      return Object.freeze({
        kind: 'NON_ADVISORY_PENDING_REPORT' as const,
        taskId,
        lifecycle: updatedLifecycle,
        outcome,
      });
    }

    if (lifecycle.modelAttempts === 1) {
      // PROCESSING attempts 1 recovery: rerun retrieval + evidence selection, preflight, recordModelAttempt (attempt 2)
      let retrievalReq;
      try {
        retrievalReq = extractRetrievalRequestFromTask(task);
      } catch (err) {
        throw new LocalTaskProcessingOrchestratorError(
          'RECOVERY_INCONSISTENCY',
          `Failed to extract retrieval request during PROCESSING recovery: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const retrievalRes = await routeMultiSourceRetrieval(
        retrievalReq,
        retrievalTransports,
        clock
      );

      // Check for pre-model failure on recovery
      let allSourcesFailed = true;
      for (const o of retrievalRes.outcomes) {
        if (o.kind !== 'SOURCE_FAILURE') {
          allSourcesFailed = false;
          break;
        }
      }
      if (allSourcesFailed && retrievalRes.outcomes.length > 0) {
        throw new LocalTaskProcessingOrchestratorError(
          'RECOVERY_INCONSISTENCY',
          'Retrieval yielded total failure during PROCESSING recovery; cannot fabricate attempts=0 outcome.'
        );
      }

      const evidenceRes = selectEvidence({
        retrieval: retrievalRes,
        maxItems: MAX_LOCAL_EVIDENCE_ITEMS_LIMIT,
      });

      if (evidenceRes.kind === 'NO_EVIDENCE' || evidenceRes.selectedItems.length === 0) {
        throw new LocalTaskProcessingOrchestratorError(
          'RECOVERY_INCONSISTENCY',
          'Evidence selection yielded NO_EVIDENCE during PROCESSING recovery.'
        );
      }

      const contextAssembly = assembleBoundedEvidenceContext(
        evidenceRes.selectedItems,
        analysisConfig.maxContextChars ?? DEFAULT_LOCAL_CONTEXT_MAX_CHARS
      );

      if (contextAssembly.retainedItems.length === 0) {
        throw new LocalTaskProcessingOrchestratorError(
          'RECOVERY_INCONSISTENCY',
          'Bounded context assembly retained zero items during PROCESSING recovery.'
        );
      }

      await lifecycleRepository.recordModelAttempt(taskId); // attempts 2
      const analysisResult = await analyzeTaskLocally(
        taskInput,
        evidenceRes,
        analysisConfig,
        qwenRunner
      );
      return handleAnalysisResult(
        analysisResult,
        task,
        evidenceRes,
        lifecycleRepository,
        nonAdvisoryOutcomeRepository,
        advisoryOutboxRepository,
        analysisConfig,
        qwenRunner,
        clock
      );
    }
  }

  // 8. Fresh READY Path
  if (lifecycle.state === TaskProcessingState.READY) {
    let retrievalReq;
    try {
      retrievalReq = extractRetrievalRequestFromTask(task);
    } catch (err: unknown) {
      if (err instanceof TaskToRetrievalAdapterError) {
        const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
          taskId,
          kind: 'INPUT_FAILURE',
          reason: err.code,
          modelAttempts: 0,
          detail: err.message,
          createdAt: now,
        });
        await nonAdvisoryOutcomeRepository.save(outcome);
        const updatedLifecycle = await lifecycleRepository.transitionState(
          taskId,
          TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
          TaskProcessingTerminalOutcome.ABSTAINED
        );
        return Object.freeze({
          kind: 'NON_ADVISORY_PENDING_REPORT' as const,
          taskId,
          lifecycle: updatedLifecycle,
          outcome,
        });
      }
      throw new LocalTaskProcessingOrchestratorError(
        'DEPENDENCY_FAILURE',
        `Unexpected error during task retrieval extraction: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let retrievalRes;
    try {
      retrievalRes = await routeMultiSourceRetrieval(
        retrievalReq,
        retrievalTransports,
        clock
      );
    } catch (err: unknown) {
      throw new LocalTaskProcessingOrchestratorError(
        'DEPENDENCY_FAILURE',
        `Multi-source retrieval routing failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 9. Check Total Retrieval Failure (all canonical requested sources failed)
    let totalFailure = true;
    const sourceFailuresList: { sourceId: 'EPA' | 'NOAA'; errorCode: 'TRANSPORT_FAILURE' | 'INVALID_SOURCE_RESPONSE' }[] = [];
    for (const out of retrievalRes.outcomes) {
      if (out.kind === 'SOURCE_FAILURE') {
        sourceFailuresList.push({
          sourceId: out.sourceId,
          errorCode: out.errorCode,
        });
      } else {
        totalFailure = false;
      }
    }

    if (totalFailure && sourceFailuresList.length > 0) {
      const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
        taskId,
        kind: 'RETRIEVAL_FAILURE',
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        sourceFailures: Object.freeze(sourceFailuresList),
        createdAt: now,
      });
      await nonAdvisoryOutcomeRepository.save(outcome);
      const updatedLifecycle = await lifecycleRepository.transitionState(
        taskId,
        TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
        TaskProcessingTerminalOutcome.ABSTAINED
      );
      return Object.freeze({
        kind: 'NON_ADVISORY_PENDING_REPORT' as const,
        taskId,
        lifecycle: updatedLifecycle,
        outcome,
      });
    }

    // 10. Evidence Selection
    let evidenceRes;
    try {
      evidenceRes = selectEvidence({
        retrieval: retrievalRes,
        maxItems: MAX_LOCAL_EVIDENCE_ITEMS_LIMIT,
      });
    } catch (err: unknown) {
      throw new LocalTaskProcessingOrchestratorError(
        'DEPENDENCY_FAILURE',
        `Local evidence selection failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (evidenceRes.kind === 'NO_EVIDENCE' || evidenceRes.selectedItems.length === 0) {
      const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
        taskId,
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        detail: 'No eligible knowledge evidence was available for this query.',
        createdAt: now,
      });
      await nonAdvisoryOutcomeRepository.save(outcome);
      const updatedLifecycle = await lifecycleRepository.transitionState(
        taskId,
        TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
        TaskProcessingTerminalOutcome.ABSTAINED
      );
      return Object.freeze({
        kind: 'NON_ADVISORY_PENDING_REPORT' as const,
        taskId,
        lifecycle: updatedLifecycle,
        outcome,
      });
    }

    // 11. Bounded Context Preflight
    const contextAssembly = assembleBoundedEvidenceContext(
      evidenceRes.selectedItems,
      analysisConfig.maxContextChars ?? DEFAULT_LOCAL_CONTEXT_MAX_CHARS
    );

    if (contextAssembly.retainedItems.length === 0) {
      const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
        taskId,
        kind: 'ABSTAINED',
        reason: 'INSUFFICIENT_EVIDENCE',
        modelAttempts: 0,
        detail: 'All available evidence exceeded the local context budget window.',
        createdAt: now,
      });
      await nonAdvisoryOutcomeRepository.save(outcome);
      const updatedLifecycle = await lifecycleRepository.transitionState(
        taskId,
        TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
        TaskProcessingTerminalOutcome.ABSTAINED
      );
      return Object.freeze({
        kind: 'NON_ADVISORY_PENDING_REPORT' as const,
        taskId,
        lifecycle: updatedLifecycle,
        outcome,
      });
    }

    // 12. Fresh Model Execution (Attempt 1 Reservation)
    await lifecycleRepository.recordModelAttempt(taskId); // PROCESSING attempts 1

    let analysisResult;
    try {
      analysisResult = await analyzeTaskLocally(
        taskInput,
        evidenceRes,
        analysisConfig,
        qwenRunner
      );
    } catch (err: unknown) {
      throw new LocalTaskProcessingOrchestratorError(
        'DEPENDENCY_FAILURE',
        `Local analysis runtime execution failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return handleAnalysisResult(
      analysisResult,
      task,
      evidenceRes,
      lifecycleRepository,
      nonAdvisoryOutcomeRepository,
      advisoryOutboxRepository,
      analysisConfig,
      qwenRunner,
      clock
    );
  }

  throw new LocalTaskProcessingOrchestratorError(
    'LIFECYCLE_INCONSISTENCY',
    `Unsupported lifecycle state for processing: ${lifecycle.state}.`
  );
}

async function handleAnalysisResult(
  analysisResult: Awaited<ReturnType<typeof analyzeTaskLocally>>,
  task: StoredPendingTaskRecord,
  evidenceRes: LocalEvidenceSelectionResult,
  lifecycleRepository: TaskProcessingLifecycleRepository,
  nonAdvisoryOutcomeRepository: LocalNonAdvisoryOutcomeRepository,
  advisoryOutboxRepository: LocalAdvisoryResultOutboxRepository,
  analysisConfig: LocalAnalysisRuntimeConfig,
  qwenRunner: QwenProcessRunner | undefined,
  clock: (() => string) | undefined
): Promise<LocalTaskProcessingOrchestratorResult> {
  const taskId = task.taskId;
  const now = clock ? clock() : new Date().toISOString();

  if (analysisResult.kind === 'ADVISORY_READY') {
    let persistRes;
    try {
      persistRes = await persistLocalAnalysisResult(
        analysisResult,
        advisoryOutboxRepository
      );
    } catch (err: unknown) {
      throw new LocalTaskProcessingOrchestratorError(
        'DEPENDENCY_FAILURE',
        `Advisory persistence failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (persistRes.kind !== 'PERSISTED_ADVISORY') {
      throw new LocalTaskProcessingOrchestratorError(
        'DEPENDENCY_FAILURE',
        'Advisory persistence did not return PERSISTED_ADVISORY.'
      );
    }

    const updatedLifecycle = await lifecycleRepository.transitionState(
      taskId,
      TaskProcessingState.ADVISORY_PENDING_UPLOAD,
      null
    );

    return Object.freeze({
      kind: 'ADVISORY_PENDING_UPLOAD' as const,
      taskId,
      lifecycle: updatedLifecycle,
    });
  }

  if (analysisResult.kind === 'ABSTAINED') {
    if (
      analysisResult.reason === 'NO_EVIDENCE' ||
      analysisResult.reason === 'INSUFFICIENT_EVIDENCE'
    ) {
      throw new LocalTaskProcessingOrchestratorError(
        'DOMAIN_CONTRACT_MISMATCH',
        `Runtime returned post-model abstention reason "${analysisResult.reason}" which durable contract requires modelAttempts=0.`
      );
    }

    const currentLifecycle = await lifecycleRepository.findByTaskId(taskId);
    const attempts = currentLifecycle ? currentLifecycle.modelAttempts : 1;

    const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
      taskId,
      kind: 'ABSTAINED',
      reason: analysisResult.reason,
      modelAttempts: attempts,
      detail: analysisResult.detail,
      createdAt: now,
    });

    await nonAdvisoryOutcomeRepository.save(outcome);
    const updatedLifecycle = await lifecycleRepository.transitionState(
      taskId,
      TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
      TaskProcessingTerminalOutcome.ABSTAINED
    );

    return Object.freeze({
      kind: 'NON_ADVISORY_PENDING_REPORT' as const,
      taskId,
      lifecycle: updatedLifecycle,
      outcome,
    });
  }

  if (analysisResult.kind === 'MODEL_FAILURE') {
    const currentLifecycle = await lifecycleRepository.findByTaskId(taskId);
    const attempts = currentLifecycle ? currentLifecycle.modelAttempts : 1;

    const isRetryable =
      attempts === 1 &&
      (analysisResult.code === 'TIMEOUT' ||
        analysisResult.code === 'NON_ZERO_EXIT' ||
        analysisResult.code === 'UNUSABLE_PROCESS_OUTPUT' ||
        analysisResult.code === 'PROCESS_ERROR');

    if (isRetryable) {
      // Retry once at attempt 2
      await lifecycleRepository.recordModelAttempt(taskId); // attempts 2
      const taskInput: LocalAnalysisTaskInput = Object.freeze({
        taskId: task.taskId,
        taskType: task.taskType,
        target: task.target,
        contentSnapshot: task.contentSnapshot,
      });

      let retryResult;
      try {
        retryResult = await analyzeTaskLocally(
          taskInput,
          evidenceRes,
          analysisConfig,
          qwenRunner
        );
      } catch (err: unknown) {
        throw new LocalTaskProcessingOrchestratorError(
          'DEPENDENCY_FAILURE',
          `Local analysis runtime retry execution failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // If retry also fails or succeeds, handle normally with attempts=2
      return handleAnalysisResult(
        retryResult,
        task,
        evidenceRes,
        lifecycleRepository,
        nonAdvisoryOutcomeRepository,
        advisoryOutboxRepository,
        analysisConfig,
        qwenRunner,
        clock
      );
    }

    // Terminal model failure (either non-retryable attempt 1 like PROCESS_LAUNCH_FAILURE or attempt 2 failure)
    const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
      taskId,
      kind: 'MODEL_FAILURE',
      reason: analysisResult.code,
      modelAttempts: attempts,
      ...(analysisResult.exitCode !== undefined && analysisResult.exitCode !== null
        ? { exitCode: analysisResult.exitCode }
        : {}),
      detail: analysisResult.message,
      createdAt: now,
    });

    await nonAdvisoryOutcomeRepository.save(outcome);
    const updatedLifecycle = await lifecycleRepository.transitionState(
      taskId,
      TaskProcessingState.NON_ADVISORY_PENDING_REPORT,
      TaskProcessingTerminalOutcome.MODEL_FAILURE
    );

    return Object.freeze({
      kind: 'NON_ADVISORY_PENDING_REPORT' as const,
      taskId,
      lifecycle: updatedLifecycle,
      outcome,
    });
  }

  throw new LocalTaskProcessingOrchestratorError(
    'DOMAIN_CONTRACT_MISMATCH',
    'Unknown local analysis result kind.'
  );
}
