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
  AIReviewTargetType,
} from '../../src/types/aiReview';
import {
  LocalAnalysisRuntimeConfig,
  QwenProcessRunner,
  analyzeTaskLocally,
  LocalAnalysisTaskInput,
  DEFAULT_LOCAL_CONTEXT_MAX_CHARS,
  assembleBoundedEvidenceContext,
  validateTaskInput,
  determineLibraryIntakeInputBasisFromSnapshot,
  SNAPSHOT_EVIDENCE_SOURCE_ID,
  SNAPSHOT_UNVERIFIED_AUTHORITY,
  LocalAnalysisError,
  type SnapshotEvidenceItem,
  type LocalRuntimeEvidenceSelectionInput,
  type LocalRuntimeSelectedEvidenceResult,
} from './localAnalysisRuntime';
import {
  selectLocalEvidence,
  MAX_LOCAL_EVIDENCE_ITEMS_LIMIT,
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
  type PEIASourceFailureDetail,
} from './localNonAdvisoryOutcomeContract';

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

const SINGLE_LINE_CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;
const MULTILINE_DISALLOWED_CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSnapshotEvidenceMode(task: StoredPendingTaskRecord): boolean {
  return (
    isPlainObject(task) &&
    isPlainObject(task.contentSnapshot) &&
    task.contentSnapshot['allowSnapshotEvidence'] === true
  );
}

function validateOptionalTrimmedSnapshotField(
  snapshot: Readonly<Record<string, unknown>>,
  key: string,
  allowMultiline = false
): { readonly valid: true; readonly value: string | undefined } | { readonly valid: false; readonly detail: string } {
  if (!Object.prototype.hasOwnProperty.call(snapshot, key) || snapshot[key] === undefined) {
    return { valid: true, value: undefined };
  }
  const raw = snapshot[key];
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw !== raw.trim()) {
    return {
      valid: false,
      detail: `Snapshot field "${key}" must be a non-empty trimmed string when present.`,
    };
  }
  const controlRegex = allowMultiline
    ? MULTILINE_DISALLOWED_CONTROL_CHAR_REGEX
    : SINGLE_LINE_CONTROL_CHAR_REGEX;
  if (controlRegex.test(raw)) {
    return {
      valid: false,
      detail: `Snapshot field "${key}" contains disallowed control characters.`,
    };
  }
  return { valid: true, value: raw };
}

type PrivateEvidenceResolutionOutcome =
  | {
      readonly kind: 'RESOLVED';
      readonly evidenceSelection: LocalRuntimeEvidenceSelectionInput;
    }
  | {
      readonly kind: 'INPUT_FAILURE';
      readonly reason:
        | 'MISSING_RETRIEVAL_QUERY'
        | 'INVALID_RETRIEVAL_QUERY'
        | 'INVALID_TASK_PAYLOAD';
      readonly detail: string;
    }
  | {
      readonly kind: 'RETRIEVAL_FAILURE';
      readonly sourceFailures: readonly PEIASourceFailureDetail[];
    }
  | {
      readonly kind: 'ABSTAINED';
      readonly reason: 'NO_EVIDENCE' | 'INSUFFICIENT_EVIDENCE';
      readonly detail: string;
    };

function buildSnapshotEvidenceForTask(
  task: LocalAnalysisTaskInput
):
  | { readonly kind: 'SNAPSHOT_ITEM'; readonly item: SnapshotEvidenceItem }
  | { readonly kind: 'INPUT_FAILURE'; readonly detail: string } {
  const snapshot = task.contentSnapshot;

  if (
    SINGLE_LINE_CONTROL_CHAR_REGEX.test(task.taskId) ||
    SINGLE_LINE_CONTROL_CHAR_REGEX.test(task.target.targetId) ||
    SINGLE_LINE_CONTROL_CHAR_REGEX.test(task.target.sourceUpdatedAt)
  ) {
    return {
      kind: 'INPUT_FAILURE',
      detail: 'Task identity fields must not contain control characters.',
    };
  }

  if (task.target.targetType === AIReviewTargetType.LibraryIntake) {
    let inputBasis;
    try {
      inputBasis = determineLibraryIntakeInputBasisFromSnapshot(snapshot);
    } catch (err: unknown) {
      return {
        kind: 'INPUT_FAILURE',
        detail: err instanceof Error ? err.message : 'Invalid LibraryIntake snapshot inputBasis or suppliedExcerpt.',
      };
    }

    const singleLineFields = [
      'title',
      'workingTitle',
      'titleAr',
      'titleEn',
      'issuingOrganization',
      'documentType',
      'fileName',
      'language',
    ] as const;
    const validatedSingleLine: Record<string, string | undefined> = {};
    for (const key of singleLineFields) {
      const check = validateOptionalTrimmedSnapshotField(snapshot, key, false);
      if (!check.valid) {
        return { kind: 'INPUT_FAILURE', detail: check.detail };
      }
      validatedSingleLine[key] = check.value;
    }

    const multilineFields = ['suppliedExcerpt', 'notes', 'sourceNotes'] as const;
    const validatedMultiline: Record<string, string | undefined> = {};
    for (const key of multilineFields) {
      const check = validateOptionalTrimmedSnapshotField(snapshot, key, true);
      if (!check.valid) {
        return { kind: 'INPUT_FAILURE', detail: check.detail };
      }
      validatedMultiline[key] = check.value;
    }

    const primaryTitle =
      validatedSingleLine['workingTitle'] ??
      validatedSingleLine['title'] ??
      validatedSingleLine['titleEn'] ??
      validatedSingleLine['titleAr'];
    const suppliedExcerpt = validatedMultiline['suppliedExcerpt'];

    if (primaryTitle === undefined && suppliedExcerpt === undefined) {
      return {
        kind: 'INPUT_FAILURE',
        detail: 'LibraryIntake snapshot requires a valid non-empty trimmed title and/or valid suppliedExcerpt.',
      };
    }

    const itemId = `intake-${task.target.targetId}`;
    const sourceUrl = `urn:peia:snapshot:library-intake:${task.target.targetId}`;
    const resolvedTitle =
      primaryTitle ?? `Supplied LibraryIntake Snapshot (${task.target.targetId})`;

    const excerptLines: string[] = [
      `Input Basis: ${inputBasis}`,
      `Provenance Notice: Supplied, unverified intake snapshot only. Full document/PDF and external URLs were not fetched or inspected.`,
    ];
    if (primaryTitle !== undefined) {
      excerptLines.push(`Supplied Title: ${primaryTitle}`);
    }
    if (
      validatedSingleLine['titleAr'] !== undefined &&
      validatedSingleLine['titleAr'] !== primaryTitle
    ) {
      excerptLines.push(`Supplied Arabic Title: ${validatedSingleLine['titleAr']}`);
    }
    if (
      validatedSingleLine['titleEn'] !== undefined &&
      validatedSingleLine['titleEn'] !== primaryTitle
    ) {
      excerptLines.push(`Supplied English Title: ${validatedSingleLine['titleEn']}`);
    }
    if (validatedSingleLine['issuingOrganization'] !== undefined) {
      excerptLines.push(`Supplied Issuing Organization: ${validatedSingleLine['issuingOrganization']}`);
    }
    if (validatedSingleLine['documentType'] !== undefined) {
      excerptLines.push(`Supplied Document Type: ${validatedSingleLine['documentType']}`);
    }
    if (
      typeof snapshot['publicationYear'] === 'number' &&
      Number.isInteger(snapshot['publicationYear'])
    ) {
      excerptLines.push(`Supplied Publication Year: ${String(snapshot['publicationYear'])}`);
    } else if (typeof snapshot['publicationYear'] === 'string') {
      const yearCheck = validateOptionalTrimmedSnapshotField(snapshot, 'publicationYear', false);
      if (!yearCheck.valid) {
        return { kind: 'INPUT_FAILURE', detail: yearCheck.detail };
      }
      if (yearCheck.value !== undefined) {
        excerptLines.push(`Supplied Publication Year: ${yearCheck.value}`);
      }
    }
    if (validatedMultiline['notes'] !== undefined) {
      excerptLines.push(`Supplied Intake Notes: ${validatedMultiline['notes']}`);
    }
    if (validatedMultiline['sourceNotes'] !== undefined) {
      excerptLines.push(`Supplied Source Notes: ${validatedMultiline['sourceNotes']}`);
    }
    if (suppliedExcerpt !== undefined) {
      excerptLines.push(`Supplied Excerpt:\n${suppliedExcerpt}`);
    }

    const item: SnapshotEvidenceItem = Object.freeze({
      sourceId: SNAPSHOT_EVIDENCE_SOURCE_ID,
      itemId,
      authority: SNAPSHOT_UNVERIFIED_AUTHORITY,
      title: resolvedTitle,
      excerpt: excerptLines.join('\n'),
      sourceUrl,
      provenance: Object.freeze({
        sourceId: SNAPSHOT_EVIDENCE_SOURCE_ID,
        authority: SNAPSHOT_UNVERIFIED_AUTHORITY,
        retrievedAt: task.target.sourceUpdatedAt,
        sourceUrl,
        canonicalItemId: itemId,
        updatedAt: task.target.sourceUpdatedAt,
      }),
      originalSourceOrder: 0,
      originalItemOrder: 0,
    });

    return { kind: 'SNAPSHOT_ITEM', item };
  }

  if (task.target.targetType === AIReviewTargetType.News) {
    const titleCheck = validateOptionalTrimmedSnapshotField(snapshot, 'title', false);
    if (!titleCheck.valid) {
      return { kind: 'INPUT_FAILURE', detail: titleCheck.detail };
    }
    const summaryCheck = validateOptionalTrimmedSnapshotField(snapshot, 'summary', true);
    if (!summaryCheck.valid) {
      return { kind: 'INPUT_FAILURE', detail: summaryCheck.detail };
    }

    const articleFields = ['body', 'articleText', 'content'] as const;
    let resolvedArticleText: string | undefined;
    for (const key of articleFields) {
      const check = validateOptionalTrimmedSnapshotField(snapshot, key, true);
      if (!check.valid) {
        return { kind: 'INPUT_FAILURE', detail: check.detail };
      }
      if (resolvedArticleText === undefined && check.value !== undefined) {
        resolvedArticleText = check.value;
      }
    }

    if (resolvedArticleText === undefined) {
      return {
        kind: 'INPUT_FAILURE',
        detail: 'News snapshot requires non-empty trimmed article text (body, articleText, or content).',
      };
    }

    const itemId = `news-${task.target.targetId}`;
    const sourceUrl = `urn:peia:snapshot:news:${task.target.targetId}`;
    const resolvedTitle =
      titleCheck.value ?? `Supplied News Snapshot (${task.target.targetId})`;

    const excerptLines: string[] = [
      `Provenance Notice: Supplied, unverified News task content snapshot.`,
    ];
    if (titleCheck.value !== undefined) {
      excerptLines.push(`Supplied Title: ${titleCheck.value}`);
    }
    if (summaryCheck.value !== undefined) {
      excerptLines.push(`Supplied Summary: ${summaryCheck.value}`);
    }
    excerptLines.push(`Article Text:\n${resolvedArticleText}`);

    const item: SnapshotEvidenceItem = Object.freeze({
      sourceId: SNAPSHOT_EVIDENCE_SOURCE_ID,
      itemId,
      authority: SNAPSHOT_UNVERIFIED_AUTHORITY,
      title: resolvedTitle,
      excerpt: excerptLines.join('\n'),
      sourceUrl,
      provenance: Object.freeze({
        sourceId: SNAPSHOT_EVIDENCE_SOURCE_ID,
        authority: SNAPSHOT_UNVERIFIED_AUTHORITY,
        retrievedAt: task.target.sourceUpdatedAt,
        sourceUrl,
        canonicalItemId: itemId,
        updatedAt: task.target.sourceUpdatedAt,
      }),
      originalSourceOrder: 0,
      originalItemOrder: 0,
    });

    return { kind: 'SNAPSHOT_ITEM', item };
  }

  return {
    kind: 'INPUT_FAILURE',
    detail: `Unsupported targetType for snapshot evidence: ${String(task.target.targetType)}.`,
  };
}

async function resolveTaskEvidenceAndPreflight(
  task: StoredPendingTaskRecord,
  options: {
    readonly retrievalTransports: MultiSourceTransports;
    readonly analysisConfig: LocalAnalysisRuntimeConfig;
    readonly selectEvidence: typeof selectLocalEvidence;
    readonly clock?: () => string;
  }
): Promise<PrivateEvidenceResolutionOutcome> {
  const { retrievalTransports, analysisConfig, selectEvidence, clock } = options;
  const maxContextChars = analysisConfig.maxContextChars ?? DEFAULT_LOCAL_CONTEXT_MAX_CHARS;

  if (isSnapshotEvidenceMode(task)) {
    let validatedTask: LocalAnalysisTaskInput;
    try {
      validatedTask = validateTaskInput(task);
    } catch (err: unknown) {
      if (err instanceof LocalAnalysisError) {
        return Object.freeze({
          kind: 'INPUT_FAILURE' as const,
          reason: 'INVALID_TASK_PAYLOAD' as const,
          detail: err.message,
        });
      }
      throw new LocalTaskProcessingOrchestratorError(
        'DEPENDENCY_FAILURE',
        `Unexpected error validating snapshot task input: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const snapshotBuild = buildSnapshotEvidenceForTask(validatedTask);
    if (snapshotBuild.kind === 'INPUT_FAILURE') {
      return Object.freeze({
        kind: 'INPUT_FAILURE' as const,
        reason: 'INVALID_TASK_PAYLOAD' as const,
        detail: snapshotBuild.detail,
      });
    }

    const evidenceRes: LocalRuntimeSelectedEvidenceResult = Object.freeze({
      kind: 'SELECTED_EVIDENCE' as const,
      query: `SNAPSHOT::${validatedTask.target.targetType}::${validatedTask.target.targetId}`,
      selectedItems: Object.freeze([snapshotBuild.item]),
      totalEligibleItems: 1,
      truncated: false,
    });

    const contextAssembly = assembleBoundedEvidenceContext(
      evidenceRes.selectedItems,
      maxContextChars
    );

    if (contextAssembly.retainedItems.length === 0) {
      return Object.freeze({
        kind: 'ABSTAINED' as const,
        reason: 'INSUFFICIENT_EVIDENCE' as const,
        detail: 'All available evidence exceeded the local context budget window.',
      });
    }

    return Object.freeze({
      kind: 'RESOLVED' as const,
      evidenceSelection: evidenceRes,
    });
  }

  let retrievalReq;
  try {
    retrievalReq = extractRetrievalRequestFromTask(task);
  } catch (err: unknown) {
    if (err instanceof TaskToRetrievalAdapterError) {
      return Object.freeze({
        kind: 'INPUT_FAILURE' as const,
        reason: err.code,
        detail: err.message,
      });
    }
    throw new LocalTaskProcessingOrchestratorError(
      'DEPENDENCY_FAILURE',
      `Unexpected error during task retrieval extraction: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let retrievalRes: MultiSourceRetrievalResult;
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

  let totalFailure = true;
  const sourceFailuresList: PEIASourceFailureDetail[] = [];
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
    return Object.freeze({
      kind: 'RETRIEVAL_FAILURE' as const,
      sourceFailures: Object.freeze(sourceFailuresList),
    });
  }

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
    return Object.freeze({
      kind: 'ABSTAINED' as const,
      reason: 'NO_EVIDENCE' as const,
      detail: 'No eligible knowledge evidence was available for this query.',
    });
  }

  const contextAssembly = assembleBoundedEvidenceContext(
    evidenceRes.selectedItems,
    maxContextChars
  );

  if (contextAssembly.retainedItems.length === 0) {
    return Object.freeze({
      kind: 'ABSTAINED' as const,
      reason: 'INSUFFICIENT_EVIDENCE' as const,
      detail: 'All available evidence exceeded the local context budget window.',
    });
  }

  return Object.freeze({
    kind: 'RESOLVED' as const,
    evidenceSelection: evidenceRes,
  });
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
      const resolution = await resolveTaskEvidenceAndPreflight(task, {
        retrievalTransports,
        analysisConfig,
        selectEvidence,
        clock,
      });

      if (resolution.kind !== 'RESOLVED') {
        throw new LocalTaskProcessingOrchestratorError(
          'RECOVERY_INCONSISTENCY',
          `Evidence resolution yielded pre-model outcome "${resolution.kind}" during PROCESSING recovery; cannot fabricate attempts=0 outcome.`
        );
      }

      const evidenceRes = resolution.evidenceSelection;
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
    const resolution = await resolveTaskEvidenceAndPreflight(task, {
      retrievalTransports,
      analysisConfig,
      selectEvidence,
      clock,
    });

    if (resolution.kind === 'INPUT_FAILURE') {
      const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
        taskId,
        kind: 'INPUT_FAILURE',
        reason: resolution.reason,
        modelAttempts: 0,
        detail: resolution.detail,
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

    if (resolution.kind === 'RETRIEVAL_FAILURE') {
      const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
        taskId,
        kind: 'RETRIEVAL_FAILURE',
        reason: 'TOTAL_RETRIEVAL_FAILURE',
        modelAttempts: 0,
        sourceFailures: resolution.sourceFailures,
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

    if (resolution.kind === 'ABSTAINED') {
      const outcome: DurableNonAdvisoryOutcomeRecord = Object.freeze({
        taskId,
        kind: 'ABSTAINED',
        reason: resolution.reason,
        modelAttempts: 0,
        detail: resolution.detail,
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

    const evidenceRes = resolution.evidenceSelection;

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
  evidenceRes: LocalRuntimeEvidenceSelectionInput,
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
