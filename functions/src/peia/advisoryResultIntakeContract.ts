import {
  AITaskType,
} from '../types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
} from '../../../src/types/aiReview';

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
  readonly severity: AIReviewSeverity;
  readonly message: string;
}

export interface AdvisoryResultIntakeResult {
  readonly task: AdvisoryResultIntakeTaskReference;
  readonly assessment: {
    readonly summary: string;
    readonly findings: readonly AdvisoryResultIntakeFinding[];
  };
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

  if (!hasExactKeys(result, ['task', 'assessment'])) {
    throw new AdvisoryResultIntakeContractError();
  }

  const { task, assessment } = result;

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

    if (!hasExactKeys(finding, ['code', 'severity', 'message'])) {
      throw new AdvisoryResultIntakeContractError();
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

    if (
      typeof finding.severity !== 'string' ||
      !ALLOWED_SEVERITIES.has(finding.severity)
    ) {
      throw new AdvisoryResultIntakeContractError();
    }

    if (!isNonEmptyTrimmedString(finding.message)) {
      throw new AdvisoryResultIntakeContractError();
    }
  }

  return input as unknown as AdvisoryResultIntakeRequest;
}
