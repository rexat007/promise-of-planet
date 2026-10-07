import {
  AITaskType,
} from '../../src/types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
  type ReviewTargetIdentity,
} from '../../src/types/aiReview';

export const PEIA_ADVISORY_RESULT_SCHEMA_VERSION = 1;

export interface AdvisoryResultTaskReference {
  readonly taskId: string;
  readonly taskType: typeof AITaskType.CONTENT_REVIEW;
  readonly target: ReviewTargetIdentity;
}

export interface PEIAAdvisoryFinding {
  readonly code: string;
  readonly message: string;
  readonly evidenceIds: readonly string[];
  readonly severity?: AIReviewSeverity;
}

export interface PEIAAdvisoryResult {
  readonly schemaVersion: typeof PEIA_ADVISORY_RESULT_SCHEMA_VERSION;
  readonly task: AdvisoryResultTaskReference;
  readonly humanReviewRequired: true;
  readonly assessment: {
    readonly summary: string;
    readonly findings: readonly PEIAAdvisoryFinding[];
  };
  readonly recommendations: readonly string[];
  readonly uncertainties: readonly string[];
  readonly limitations: readonly string[];
}

export type PEIAAdvisoryResultContractErrorCode =
  | 'INVALID_ADVISORY_RESULT';

export class PEIAAdvisoryResultContractError extends Error {
  readonly code: PEIAAdvisoryResultContractErrorCode;

  constructor(
    code: PEIAAdvisoryResultContractErrorCode = 'INVALID_ADVISORY_RESULT',
    message: string = 'Invalid PEIA advisory result.'
  ) {
    super(message);
    this.name = 'PEIAAdvisoryResultContractError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const VALID_CODE_REGEX = /^[A-Z][A-Z0-9_]*$/;
const ALLOWED_TARGET_TYPES = new Set<string>(Object.values(AIReviewTargetType));
const ALLOWED_SEVERITIES = new Set<string>(Object.values(AIReviewSeverity));

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

export function validatePEIAAdvisoryResult(input: unknown): PEIAAdvisoryResult {
  if (!isPlainObject(input)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (
    !hasExactKeys(input, [
      'schemaVersion',
      'task',
      'humanReviewRequired',
      'assessment',
      'recommendations',
      'uncertainties',
      'limitations',
    ])
  ) {
    throw new PEIAAdvisoryResultContractError();
  }

  const {
    schemaVersion,
    task,
    humanReviewRequired,
    assessment,
    recommendations,
    uncertainties,
    limitations,
  } = input;

  if (schemaVersion !== PEIA_ADVISORY_RESULT_SCHEMA_VERSION) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (humanReviewRequired !== true) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isPlainObject(task)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!hasExactKeys(task, ['taskId', 'taskType', 'target'])) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isNonEmptyTrimmedString(task.taskId)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (task.taskType !== AITaskType.CONTENT_REVIEW) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isPlainObject(task.target)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!hasExactKeys(task.target, ['targetType', 'targetId', 'sourceUpdatedAt'])) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (
    typeof task.target.targetType !== 'string' ||
    !ALLOWED_TARGET_TYPES.has(task.target.targetType)
  ) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isNonEmptyTrimmedString(task.target.targetId)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isNonEmptyTrimmedString(task.target.sourceUpdatedAt)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isPlainObject(assessment)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!hasExactKeys(assessment, ['summary', 'findings'])) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isTrimmedString(assessment.summary)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!Array.isArray(assessment.findings)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (assessment.summary === '' && assessment.findings.length === 0) {
    throw new PEIAAdvisoryResultContractError();
  }

  const seenCodes = new Set<string>();

  for (const finding of assessment.findings) {
    if (!isPlainObject(finding)) {
      throw new PEIAAdvisoryResultContractError();
    }

    const findingKeys = Object.keys(finding);
    const hasSeverity = Object.prototype.hasOwnProperty.call(finding, 'severity');

    if (hasSeverity) {
      if (
        findingKeys.length !== 4 ||
        !hasExactKeys(finding, ['code', 'message', 'evidenceIds', 'severity'])
      ) {
        throw new PEIAAdvisoryResultContractError();
      }

      if (
        typeof finding.severity !== 'string' ||
        !ALLOWED_SEVERITIES.has(finding.severity)
      ) {
        throw new PEIAAdvisoryResultContractError();
      }
    } else {
      if (
        findingKeys.length !== 3 ||
        !hasExactKeys(finding, ['code', 'message', 'evidenceIds'])
      ) {
        throw new PEIAAdvisoryResultContractError();
      }
    }

    if (
      !isNonEmptyTrimmedString(finding.code) ||
      !VALID_CODE_REGEX.test(finding.code)
    ) {
      throw new PEIAAdvisoryResultContractError();
    }

    if (seenCodes.has(finding.code)) {
      throw new PEIAAdvisoryResultContractError();
    }
    seenCodes.add(finding.code);

    if (!isNonEmptyTrimmedString(finding.message)) {
      throw new PEIAAdvisoryResultContractError();
    }

    if (!isStringArray(finding.evidenceIds)) {
      throw new PEIAAdvisoryResultContractError();
    }
  }

  if (!isStringArray(recommendations)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isStringArray(uncertainties)) {
    throw new PEIAAdvisoryResultContractError();
  }

  if (!isStringArray(limitations)) {
    throw new PEIAAdvisoryResultContractError();
  }

  return input as PEIAAdvisoryResult;
}
