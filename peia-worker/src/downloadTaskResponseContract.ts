import {
  AITaskType,
  AITaskStatus,
  type AIReviewTask,
} from '../../src/types/aiTask';
import {
  AIReviewTargetType,
} from '../../src/types/aiReview';

export interface DownloadedPendingTask {
  readonly principalId: string;
  readonly task: AIReviewTask;
}

export interface NoPendingTask {
  readonly principalId: string;
  readonly task: null;
}

export type PendingTaskDownloadResult =
  | {
      readonly kind: 'TASK_AVAILABLE';
      readonly value: DownloadedPendingTask;
    }
  | {
      readonly kind: 'NO_TASK';
      readonly value: NoPendingTask;
    };

export type PendingTaskDownloadResponseErrorCode =
  | 'INVALID_HTTP_STATUS'
  | 'INVALID_RESPONSE_BODY'
  | 'REMOTE_REQUEST_REJECTED'
  | 'INVALID_SUCCESS_PAYLOAD'
  | 'INVALID_TASK_PAYLOAD';

export class PendingTaskDownloadResponseError extends Error {
  readonly code: PendingTaskDownloadResponseErrorCode;

  constructor(code: PendingTaskDownloadResponseErrorCode, message: string) {
    super(message);
    this.name = 'PendingTaskDownloadResponseError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafeRemoteErrorEnvelope(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('ok') || !keys.includes('error')) {
    return false;
  }
  if (value.ok !== false) {
    return false;
  }
  if (!isPlainObject(value.error)) {
    return false;
  }
  const errorKeys = Object.keys(value.error);
  if (errorKeys.length !== 2 || !errorKeys.includes('code') || !errorKeys.includes('message')) {
    return false;
  }
  const errCode = value.error.code;
  const errMsg = value.error.message;
  return (
    typeof errCode === 'string' &&
    errCode.trim().length > 0 &&
    typeof errMsg === 'string' &&
    errMsg.trim().length > 0
  );
}

const PROHIBITED_TASK_FIELDS = [
  'approved',
  'published',
  'workflowState',
  'desiredWorkflowState',
  'permission',
  'role',
  'autoApply',
  'autoPublish',
  'decision',
  'suggestedAction',
  'workerId',
  'machineToken',
  'apiKey',
  'serviceAccount',
] as const;

const REQUIRED_RESPONSE_KEYS = ['ok', 'principalId', 'task'] as const;

const REQUIRED_TASK_KEYS = [
  'taskId',
  'taskType',
  'target',
  'contentSnapshot',
  'createdAt',
  'status',
] as const;

const REQUIRED_TARGET_KEYS = [
  'targetType',
  'targetId',
  'sourceUpdatedAt',
] as const;

export function parsePendingTaskDownloadResponse(
  status: unknown,
  body: unknown
): PendingTaskDownloadResult {
  if (typeof status !== 'number' || !Number.isFinite(status) || status !== 200) {
    if (isSafeRemoteErrorEnvelope(body)) {
      throw new PendingTaskDownloadResponseError(
        'REMOTE_REQUEST_REJECTED',
        'Remote task request was rejected.'
      );
    }
    throw new PendingTaskDownloadResponseError(
      'INVALID_HTTP_STATUS',
      'Unexpected task gateway response status.'
    );
  }

  if (!isPlainObject(body)) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_RESPONSE_BODY',
      'Task gateway response body must be a plain object.'
    );
  }

  if (body.ok === false) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_RESPONSE_BODY',
      'Task gateway response body indicated failure on 200 status.'
    );
  }

  const topKeys = Object.keys(body);
  if (
    topKeys.length !== REQUIRED_RESPONSE_KEYS.length ||
    !REQUIRED_RESPONSE_KEYS.every((k) => topKeys.includes(k))
  ) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_SUCCESS_PAYLOAD',
      'Task gateway response must contain exactly ok, principalId, and task.'
    );
  }

  if (body.ok !== true) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_SUCCESS_PAYLOAD',
      'ok field must be boolean true.'
    );
  }

  if (typeof body.principalId !== 'string') {
    throw new PendingTaskDownloadResponseError(
      'INVALID_SUCCESS_PAYLOAD',
      'principalId must be a string.'
    );
  }

  if (body.principalId.trim().length === 0) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_SUCCESS_PAYLOAD',
      'principalId must not be blank.'
    );
  }

  if (body.principalId !== body.principalId.trim()) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_SUCCESS_PAYLOAD',
      'principalId must not contain leading or trailing whitespace.'
    );
  }

  if (body.task === null) {
    return {
      kind: 'NO_TASK',
      value: {
        principalId: body.principalId,
        task: null,
      },
    };
  }

  if (!isPlainObject(body.task)) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'task must be null or a plain object.'
    );
  }

  for (const prohibited of PROHIBITED_TASK_FIELDS) {
    if (prohibited in body.task) {
      throw new PendingTaskDownloadResponseError(
        'INVALID_TASK_PAYLOAD',
        `Prohibited task field detected: ${prohibited}`
      );
    }
  }

  const taskKeys = Object.keys(body.task);
  if (
    taskKeys.length !== REQUIRED_TASK_KEYS.length ||
    !REQUIRED_TASK_KEYS.every((k) => taskKeys.includes(k))
  ) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'task must contain exactly taskId, taskType, target, contentSnapshot, createdAt, and status.'
    );
  }

  if (
    typeof body.task.taskId !== 'string' ||
    body.task.taskId.trim().length === 0 ||
    body.task.taskId !== body.task.taskId.trim()
  ) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'taskId must be a non-empty trimmed string.'
    );
  }

  if (body.task.taskType !== AITaskType.CONTENT_REVIEW) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      `taskType must be exactly ${AITaskType.CONTENT_REVIEW}.`
    );
  }

  if (body.task.status !== AITaskStatus.Pending) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      `status for downloaded pending task must be exactly ${AITaskStatus.Pending}.`
    );
  }

  if (
    typeof body.task.createdAt !== 'string' ||
    body.task.createdAt.trim().length === 0 ||
    body.task.createdAt !== body.task.createdAt.trim()
  ) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'createdAt must be a non-empty trimmed string.'
    );
  }

  if (!isPlainObject(body.task.target)) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'target must be a plain object.'
    );
  }

  const targetKeys = Object.keys(body.task.target);
  if (
    targetKeys.length !== REQUIRED_TARGET_KEYS.length ||
    !REQUIRED_TARGET_KEYS.every((k) => targetKeys.includes(k))
  ) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'target must contain exactly targetType, targetId, and sourceUpdatedAt.'
    );
  }

  const validTargetTypes = Object.values(AIReviewTargetType) as string[];
  if (
    typeof body.task.target.targetType !== 'string' ||
    !validTargetTypes.includes(body.task.target.targetType)
  ) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'targetType must be a canonical AIReviewTargetType.'
    );
  }

  if (
    typeof body.task.target.targetId !== 'string' ||
    body.task.target.targetId.trim().length === 0 ||
    body.task.target.targetId !== body.task.target.targetId.trim()
  ) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'targetId must be a non-empty trimmed string.'
    );
  }

  if (
    typeof body.task.target.sourceUpdatedAt !== 'string' ||
    body.task.target.sourceUpdatedAt.trim().length === 0 ||
    body.task.target.sourceUpdatedAt !== body.task.target.sourceUpdatedAt.trim()
  ) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'sourceUpdatedAt must be a non-empty trimmed string.'
    );
  }

  if (!isPlainObject(body.task.contentSnapshot)) {
    throw new PendingTaskDownloadResponseError(
      'INVALID_TASK_PAYLOAD',
      'contentSnapshot must be a plain object.'
    );
  }

  return {
    kind: 'TASK_AVAILABLE',
    value: {
      principalId: body.principalId,
      task: body.task as unknown as AIReviewTask,
    },
  };
}
