import { AITaskType, AITaskStatus, type AIReviewTask } from '../types/aiTask';
import { AIReviewTargetType } from '../../../src/types/aiReview';

export class ValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates untrusted task request shape and canonical vocabulary at runtime.
 * Fails closed on any structural divergence, unknown top-level field, or prohibited field.
 */
export function validateAIReviewTask(input: unknown): AIReviewTask {
  if (!isPlainObject(input)) {
    throw new ValidationError('INVALID_TASK_PAYLOAD', 'Input must be a non-null plain object');
  }

  const keys = Object.keys(input);
  const requiredKeys = ['taskId', 'taskType', 'target', 'contentSnapshot', 'createdAt', 'status'];

  // Prohibited fields list (explicit second layer of defense)
  const prohibitedFields = [
    'approved', 'published', 'workflowState', 'desiredWorkflowState',
    'permission', 'role', 'autoApply', 'autoPublish', 'decision', 'suggestedAction',
    'workerId', 'machineToken', 'apiKey', 'serviceAccount'
  ];

  // Check for prohibited fields or any unknown top-level fields (Fail-closed)
  for (const key of keys) {
    if (prohibitedFields.includes(key)) {
      throw new ValidationError('PROHIBITED_TASK_FIELD', `Prohibited authority or authentication field detected: ${key}`);
    }
    if (!requiredKeys.includes(key)) {
      throw new ValidationError('UNKNOWN_TASK_FIELD', `Unknown top-level field detected: ${key}`);
    }
  }

  // Check for missing required fields
  for (const reqKey of requiredKeys) {
    if (!(reqKey in input)) {
      throw new ValidationError('INVALID_TASK_PAYLOAD', `Missing required field: ${reqKey}`);
    }
  }

  // Validate taskId
  const taskId = input.taskId;
  if (typeof taskId !== 'string' || taskId.trim() === '') {
    throw new ValidationError('INVALID_TASK_ID', 'taskId must be a non-empty trimmed string');
  }

  // Validate taskType
  const taskType = input.taskType;
  if (taskType !== AITaskType.CONTENT_REVIEW) {
    throw new ValidationError('INVALID_TASK_TYPE', `taskType must be exactly ${AITaskType.CONTENT_REVIEW}`);
  }

  // Validate status
  const status = input.status;
  if (status !== AITaskStatus.Pending && status !== AITaskStatus.Completed && status !== AITaskStatus.Failed) {
    throw new ValidationError('INVALID_TASK_STATUS', 'status must be a valid AITaskStatus (Pending, Completed, Failed)');
  }

  // Validate createdAt
  const createdAt = input.createdAt;
  if (typeof createdAt !== 'string' || createdAt.trim() === '') {
    throw new ValidationError('INVALID_TASK_PAYLOAD', 'createdAt must be a non-empty trimmed string');
  }

  // Validate target
  const target = input.target;
  if (!isPlainObject(target)) {
    throw new ValidationError('INVALID_TASK_TARGET', 'target must be a non-null plain object');
  }

  const targetKeys = Object.keys(target);
  const requiredTargetKeys = ['targetType', 'targetId', 'sourceUpdatedAt'];
  for (const tKey of targetKeys) {
    if (!requiredTargetKeys.includes(tKey)) {
      throw new ValidationError('INVALID_TASK_TARGET', `Unknown field in target object: ${tKey}`);
    }
  }
  for (const reqTKey of requiredTargetKeys) {
    if (!(reqTKey in target)) {
      throw new ValidationError('INVALID_TASK_TARGET', `Missing required target property: ${reqTKey}`);
    }
  }

  // Validate targetType
  const targetType = target.targetType;
  if (
    targetType !== AIReviewTargetType.News &&
    targetType !== AIReviewTargetType.LibraryDocument &&
    targetType !== AIReviewTargetType.TrainingCourse &&
    targetType !== AIReviewTargetType.CitizenSubmission
  ) {
    throw new ValidationError('INVALID_TASK_TARGET', 'targetType must be a valid canonical AIReviewTargetType');
  }

  // Validate targetId
  const targetId = target.targetId;
  if (typeof targetId !== 'string' || targetId.trim() === '') {
    throw new ValidationError('INVALID_TASK_TARGET', 'targetId must be a non-empty trimmed string');
  }

  // Validate sourceUpdatedAt
  const sourceUpdatedAt = target.sourceUpdatedAt;
  if (typeof sourceUpdatedAt !== 'string' || sourceUpdatedAt.trim() === '') {
    throw new ValidationError('INVALID_TASK_TARGET', 'sourceUpdatedAt must be a non-empty trimmed string');
  }

  // Validate contentSnapshot
  const contentSnapshot = input.contentSnapshot;
  if (!isPlainObject(contentSnapshot)) {
    throw new ValidationError('INVALID_CONTENT_SNAPSHOT', 'contentSnapshot must be a non-null plain object');
  }

  return {
    taskId: taskId.trim(),
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType,
      targetId: targetId.trim(),
      sourceUpdatedAt: sourceUpdatedAt.trim(),
    },
    contentSnapshot,
    createdAt: createdAt.trim(),
    status,
  };
}
