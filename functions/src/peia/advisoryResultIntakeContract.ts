import {
  AITaskType,
} from '../types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
  PEIALibraryPreparationInputBasis,
  PEIALibrarySuggestedDocumentType,
  type PEIALibraryPreparationAdvisoryPayload,
} from '../shared/aiReviewContract';

export interface AdvisoryResultIntakeTaskReference {
  readonly taskId: string;
  readonly taskType: typeof AITaskType.CONTENT_REVIEW;
  readonly target: {
    readonly targetType: AIReviewTargetType;
    readonly targetId: string;
    readonly sourceUpdatedAt: string;
  };
}

export interface AdvisoryResultIntakeFinding {
  readonly code: string;
  readonly message: string;
  readonly evidenceIds: readonly string[];
  readonly severity?: AIReviewSeverity;
}

export interface AdvisoryResultIntakeResult {
  readonly schemaVersion: 1;
  readonly task: AdvisoryResultIntakeTaskReference;
  readonly humanReviewRequired: true;
  readonly assessment: {
    readonly summary: string;
    readonly findings: readonly AdvisoryResultIntakeFinding[];
  };
  readonly recommendations: readonly string[];
  readonly uncertainties: readonly string[];
  readonly limitations: readonly string[];
  readonly libraryPreparation?: PEIALibraryPreparationAdvisoryPayload;
}

export interface AdvisoryResultIntakeRequest {
  readonly result: AdvisoryResultIntakeResult;
}

export type AdvisoryResultIntakeContractErrorCode =
  | 'INVALID_ADVISORY_RESULT_INTAKE';

export class AdvisoryResultIntakeContractError extends Error {
  readonly code: AdvisoryResultIntakeContractErrorCode;

  constructor(
    code: AdvisoryResultIntakeContractErrorCode = 'INVALID_ADVISORY_RESULT_INTAKE',
    message: string = 'Invalid PEIA advisory result intake request.'
  ) {
    super(message);
    this.name = 'AdvisoryResultIntakeContractError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const VALID_CODE_REGEX = /^[A-Z][A-Z0-9_]*$/;
const ALLOWED_TARGET_TYPES = new Set<string>(Object.values(AIReviewTargetType));
const ALLOWED_SEVERITIES = new Set<string>(Object.values(AIReviewSeverity));
const ALLOWED_INPUT_BASES = new Set<string>(Object.values(PEIALibraryPreparationInputBasis));
const ALLOWED_LIBRARY_DOC_TYPES = new Set<string>(Object.values(PEIALibrarySuggestedDocumentType));
const UNREAD_CONTENT_CLAIM_REGEX =
  /\b(full\s+(?:document|pdf|text)\s+(?:was\s+)?(?:read|analyzed|inspected)|according\s+to\s+page\s+\d+|article\s+\d+\s+states\s+that)\b|تمت?\s+قراءة\s+(?:كامل\s+)?(?:الوثيقة|النص\s+الكامل|ملف\s*PDF)/i;

const LIBRARY_PREPARATION_KEYS = [
  'inputBasis',
  'suggestedTitleAr',
  'suggestedTitleEn',
  'suggestedIssuingOrganization',
  'suggestedDocumentType',
  'suggestedEnvironmentalDomains',
  'suggestedTopicsAr',
  'suggestedTopicsEn',
  'suggestedSummaryAr',
  'suggestedSummaryEn',
  'provenanceObservationsAr',
  'provenanceObservationsEn',
  'uncertaintyNoticesAr',
  'uncertaintyNoticesEn',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(obj);
  if (actualKeys.length !== expectedKeys.length) {
    return false;
  }
  return expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value;
}

function isTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value;
}

function isStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => isNonEmptyTrimmedString(item));
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return isStringArray(value) && value.length > 0;
}

function validateLibraryPreparation(
  libraryPreparation: unknown,
  targetType: string,
  assessmentSummary: string
): void {
  if (targetType !== AIReviewTargetType.LibraryIntake) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isPlainObject(libraryPreparation)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!hasExactKeys(libraryPreparation, LIBRARY_PREPARATION_KEYS)) {
    throw new AdvisoryResultIntakeContractError();
  }

  const {
    inputBasis,
    suggestedTitleAr,
    suggestedTitleEn,
    suggestedIssuingOrganization,
    suggestedDocumentType,
    suggestedEnvironmentalDomains,
    suggestedTopicsAr,
    suggestedTopicsEn,
    suggestedSummaryAr,
    suggestedSummaryEn,
    provenanceObservationsAr,
    provenanceObservationsEn,
    uncertaintyNoticesAr,
    uncertaintyNoticesEn,
  } = libraryPreparation;

  if (typeof inputBasis !== 'string' || !ALLOWED_INPUT_BASES.has(inputBasis)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (
    !isNonEmptyTrimmedString(suggestedTitleAr) ||
    !isNonEmptyTrimmedString(suggestedTitleEn) ||
    !isNonEmptyTrimmedString(suggestedIssuingOrganization)
  ) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (
    typeof suggestedDocumentType !== 'string' ||
    !ALLOWED_LIBRARY_DOC_TYPES.has(suggestedDocumentType)
  ) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (
    !isNonEmptyStringArray(suggestedEnvironmentalDomains) ||
    !isNonEmptyStringArray(suggestedTopicsAr) ||
    !isNonEmptyStringArray(suggestedTopicsEn) ||
    !isNonEmptyStringArray(provenanceObservationsAr) ||
    !isNonEmptyStringArray(provenanceObservationsEn) ||
    !isNonEmptyStringArray(uncertaintyNoticesAr) ||
    !isNonEmptyStringArray(uncertaintyNoticesEn)
  ) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (inputBasis === PEIALibraryPreparationInputBasis.MetadataOnly) {
    if (suggestedSummaryAr !== null || suggestedSummaryEn !== null) {
      throw new AdvisoryResultIntakeContractError();
    }
    if (UNREAD_CONTENT_CLAIM_REGEX.test(assessmentSummary)) {
      throw new AdvisoryResultIntakeContractError();
    }
  } else {
    if (
      !isNonEmptyTrimmedString(suggestedSummaryAr) ||
      !isNonEmptyTrimmedString(suggestedSummaryEn)
    ) {
      throw new AdvisoryResultIntakeContractError();
    }
  }
}

export function validateAdvisoryResultIntakeRequest(
  input: unknown
): AdvisoryResultIntakeRequest {
  if (!isPlainObject(input)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!hasExactKeys(input, ['result'])) {
    throw new AdvisoryResultIntakeContractError();
  }

  const { result } = input;

  if (!isPlainObject(result)) {
    throw new AdvisoryResultIntakeContractError();
  }

  const hasLibraryPreparation = Object.prototype.hasOwnProperty.call(
    result,
    'libraryPreparation'
  );

  if (
    !hasExactKeys(
      result,
      hasLibraryPreparation
        ? [
            'schemaVersion',
            'task',
            'humanReviewRequired',
            'assessment',
            'recommendations',
            'uncertainties',
            'limitations',
            'libraryPreparation',
          ]
        : [
            'schemaVersion',
            'task',
            'humanReviewRequired',
            'assessment',
            'recommendations',
            'uncertainties',
            'limitations',
          ]
    )
  ) {
    throw new AdvisoryResultIntakeContractError();
  }

  const {
    schemaVersion,
    task,
    humanReviewRequired,
    assessment,
    recommendations,
    uncertainties,
    limitations,
  } = result;

  if (schemaVersion !== 1) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (humanReviewRequired !== true) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isPlainObject(task)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!hasExactKeys(task, ['taskId', 'taskType', 'target'])) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isNonEmptyTrimmedString(task.taskId)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (task.taskType !== AITaskType.CONTENT_REVIEW) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isPlainObject(task.target)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!hasExactKeys(task.target, ['targetType', 'targetId', 'sourceUpdatedAt'])) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (
    typeof task.target.targetType !== 'string' ||
    !ALLOWED_TARGET_TYPES.has(task.target.targetType)
  ) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isNonEmptyTrimmedString(task.target.targetId)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isNonEmptyTrimmedString(task.target.sourceUpdatedAt)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isPlainObject(assessment)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!hasExactKeys(assessment, ['summary', 'findings'])) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isTrimmedString(assessment.summary)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!Array.isArray(assessment.findings)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (assessment.summary === '' && assessment.findings.length === 0) {
    throw new AdvisoryResultIntakeContractError();
  }

  const seenCodes = new Set<string>();

  for (const finding of assessment.findings) {
    if (!isPlainObject(finding)) {
      throw new AdvisoryResultIntakeContractError();
    }

    const findingKeys = Object.keys(finding);
    const hasSeverity = Object.prototype.hasOwnProperty.call(finding, 'severity');

    if (hasSeverity) {
      if (
        findingKeys.length !== 4 ||
        !hasExactKeys(finding, ['code', 'message', 'evidenceIds', 'severity'])
      ) {
        throw new AdvisoryResultIntakeContractError();
      }

      if (
        typeof finding.severity !== 'string' ||
        !ALLOWED_SEVERITIES.has(finding.severity)
      ) {
        throw new AdvisoryResultIntakeContractError();
      }
    } else {
      if (
        findingKeys.length !== 3 ||
        !hasExactKeys(finding, ['code', 'message', 'evidenceIds'])
      ) {
        throw new AdvisoryResultIntakeContractError();
      }
    }

    if (
      !isNonEmptyTrimmedString(finding.code) ||
      !VALID_CODE_REGEX.test(finding.code)
    ) {
      throw new AdvisoryResultIntakeContractError();
    }

    if (seenCodes.has(finding.code)) {
      throw new AdvisoryResultIntakeContractError();
    }
    seenCodes.add(finding.code);

    if (!isNonEmptyTrimmedString(finding.message)) {
      throw new AdvisoryResultIntakeContractError();
    }

    if (!isStringArray(finding.evidenceIds)) {
      throw new AdvisoryResultIntakeContractError();
    }
  }

  if (!isStringArray(recommendations)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isStringArray(uncertainties)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (!isStringArray(limitations)) {
    throw new AdvisoryResultIntakeContractError();
  }

  if (hasLibraryPreparation) {
    validateLibraryPreparation(
      result.libraryPreparation,
      task.target.targetType,
      assessment.summary
    );
  }

  return input as unknown as AdvisoryResultIntakeRequest;
}

