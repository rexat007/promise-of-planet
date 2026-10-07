import {
  type AdvisoryResultTaskReference,
  type PEIAAdvisoryFinding,
  type PEIAAdvisoryResult,
  PEIA_ADVISORY_RESULT_SCHEMA_VERSION,
  validatePEIAAdvisoryResult,
} from './advisoryResultContract';
import {
  type LocalAdvisoryResultOutboxRepository,
  type StoredAdvisoryResultRecord,
} from './localAdvisoryResultOutboxContract';
import {
  persistAdvisoryResultToOutbox,
} from './advisoryResultToOutboxPersistence';
import {
  type LocalAnalysisResult,
  type AdvisoryReadyResult,
  type LocalAnalysisAbstainReason,
  type LocalAnalysisModelFailureCode,
  type LocalModelTrace,
} from './localAnalysisRuntime';

export interface PersistedAdvisoryOutcome {
  readonly kind: 'PERSISTED_ADVISORY';
  readonly taskRef: AdvisoryResultTaskReference;
  readonly advisoryResult: PEIAAdvisoryResult;
  readonly storedRecord: StoredAdvisoryResultRecord;
  readonly modelTrace?: LocalModelTrace;
}

export interface NotPersistedAbstainedOutcome {
  readonly kind: 'NOT_PERSISTED_ABSTAINED';
  readonly taskRef: AdvisoryResultTaskReference;
  readonly reason: LocalAnalysisAbstainReason;
  readonly detail: string;
  readonly limitations: readonly string[];
  readonly modelTrace?: LocalModelTrace;
}

export interface NotPersistedModelFailureOutcome {
  readonly kind: 'NOT_PERSISTED_MODEL_FAILURE';
  readonly taskRef: AdvisoryResultTaskReference;
  readonly code: LocalAnalysisModelFailureCode;
  readonly message: string;
  readonly exitCode?: number | null;
  readonly modelTrace?: LocalModelTrace;
}

export type LocalAnalysisToAdvisoryPersistenceResult =
  | PersistedAdvisoryOutcome
  | NotPersistedAbstainedOutcome
  | NotPersistedModelFailureOutcome;

export function convertAdvisoryReadyToPEIAAdvisoryResult(
  readyResult: AdvisoryReadyResult
): PEIAAdvisoryResult {
  const findings: PEIAAdvisoryFinding[] = readyResult.advisory.findings.map(
    (finding, index) => {
      const codeIndex = String(index + 1).padStart(3, '0');
      const code = `PEIA_FINDING_${codeIndex}`;

      return Object.freeze({
        code,
        message: finding.claim,
        evidenceIds: Object.freeze([...finding.evidenceIds]),
        ...(finding.severity !== undefined ? { severity: finding.severity } : {}),
      });
    }
  );

  const advisoryResult: PEIAAdvisoryResult = Object.freeze({
    schemaVersion: PEIA_ADVISORY_RESULT_SCHEMA_VERSION,
    task: Object.freeze({
      taskId: readyResult.taskRef.taskId,
      taskType: readyResult.taskRef.taskType,
      target: Object.freeze({
        targetType: readyResult.taskRef.target.targetType,
        targetId: readyResult.taskRef.target.targetId,
        sourceUpdatedAt: readyResult.taskRef.target.sourceUpdatedAt,
      }),
    }),
    humanReviewRequired: true,
    assessment: Object.freeze({
      summary: readyResult.advisory.summary,
      findings: Object.freeze(findings),
    }),
    recommendations: Object.freeze([...readyResult.advisory.recommendations]),
    uncertainties: Object.freeze([...readyResult.advisory.uncertainties]),
    limitations: Object.freeze([...readyResult.limitations]),
  });

  return validatePEIAAdvisoryResult(advisoryResult);
}

export async function persistLocalAnalysisResult(
  analysisResult: LocalAnalysisResult,
  repository: LocalAdvisoryResultOutboxRepository
): Promise<LocalAnalysisToAdvisoryPersistenceResult> {
  if (analysisResult.kind === 'ABSTAINED') {
    return Object.freeze({
      kind: 'NOT_PERSISTED_ABSTAINED' as const,
      taskRef: analysisResult.taskRef,
      reason: analysisResult.reason,
      detail: analysisResult.detail,
      limitations: analysisResult.limitations,
      modelTrace: analysisResult.modelTrace,
    });
  }

  if (analysisResult.kind === 'MODEL_FAILURE') {
    return Object.freeze({
      kind: 'NOT_PERSISTED_MODEL_FAILURE' as const,
      taskRef: analysisResult.taskRef,
      code: analysisResult.code,
      message: analysisResult.message,
      exitCode: analysisResult.exitCode,
      modelTrace: analysisResult.modelTrace,
    });
  }

  const advisoryResult = convertAdvisoryReadyToPEIAAdvisoryResult(analysisResult);
  const persistenceResult = await persistAdvisoryResultToOutbox(
    advisoryResult,
    repository
  );

  return Object.freeze({
    kind: 'PERSISTED_ADVISORY' as const,
    taskRef: analysisResult.taskRef,
    advisoryResult,
    storedRecord: persistenceResult.record,
    modelTrace: analysisResult.modelTrace,
  });
}
