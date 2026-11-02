import {
  AIReviewTargetType,
  type PEIALibraryPreparationAdvisoryPayload,
} from '../../src/types/aiReview';
import {
  type AdvisoryResultTaskReference,
  type PEIAAdvisoryFinding,
  type PEIAAdvisoryResult,
  PEIA_ADVISORY_RESULT_SCHEMA_VERSION,
  PEIAAdvisoryResultContractError,
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
  if (
    readyResult.taskRef.target.targetType === AIReviewTargetType.LibraryIntake &&
    readyResult.advisory.libraryPreparation === undefined
  ) {
    throw new PEIAAdvisoryResultContractError();
  }

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

  const rawPrep = readyResult.advisory.libraryPreparation;
  const libraryPreparation: PEIALibraryPreparationAdvisoryPayload | undefined =
    rawPrep !== undefined && typeof rawPrep === 'object' && rawPrep !== null
      ? Object.freeze({
          inputBasis: rawPrep.inputBasis,
          suggestedTitleAr: rawPrep.suggestedTitleAr,
          suggestedTitleEn: rawPrep.suggestedTitleEn,
          suggestedIssuingOrganization: rawPrep.suggestedIssuingOrganization,
          suggestedDocumentType: rawPrep.suggestedDocumentType,
          suggestedEnvironmentalDomains: Array.isArray(rawPrep.suggestedEnvironmentalDomains)
            ? Object.freeze([...rawPrep.suggestedEnvironmentalDomains])
            : (rawPrep.suggestedEnvironmentalDomains as readonly string[]),
          suggestedTopicsAr: Array.isArray(rawPrep.suggestedTopicsAr)
            ? Object.freeze([...rawPrep.suggestedTopicsAr])
            : (rawPrep.suggestedTopicsAr as readonly string[]),
          suggestedTopicsEn: Array.isArray(rawPrep.suggestedTopicsEn)
            ? Object.freeze([...rawPrep.suggestedTopicsEn])
            : (rawPrep.suggestedTopicsEn as readonly string[]),
          suggestedSummaryAr: rawPrep.suggestedSummaryAr,
          suggestedSummaryEn: rawPrep.suggestedSummaryEn,
          provenanceObservationsAr: Array.isArray(rawPrep.provenanceObservationsAr)
            ? Object.freeze([...rawPrep.provenanceObservationsAr])
            : (rawPrep.provenanceObservationsAr as readonly string[]),
          provenanceObservationsEn: Array.isArray(rawPrep.provenanceObservationsEn)
            ? Object.freeze([...rawPrep.provenanceObservationsEn])
            : (rawPrep.provenanceObservationsEn as readonly string[]),
          uncertaintyNoticesAr: Array.isArray(rawPrep.uncertaintyNoticesAr)
            ? Object.freeze([...rawPrep.uncertaintyNoticesAr])
            : (rawPrep.uncertaintyNoticesAr as readonly string[]),
          uncertaintyNoticesEn: Array.isArray(rawPrep.uncertaintyNoticesEn)
            ? Object.freeze([...rawPrep.uncertaintyNoticesEn])
            : (rawPrep.uncertaintyNoticesEn as readonly string[]),
        })
      : undefined;

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
    ...(libraryPreparation !== undefined ? { libraryPreparation } : {}),
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
