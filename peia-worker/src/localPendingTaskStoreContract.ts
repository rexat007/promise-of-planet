import {
  AITaskType,
  AITaskStatus,
} from '../../src/types/aiTask';
import {
  AIReviewTargetType,
} from '../../src/types/aiReview';
import type {
  DownloadedPendingTask,
} from './downloadTaskResponseContract';

export const LocalPendingTaskState = {
  Downloaded: 'Downloaded',
} as const;

export type LocalPendingTaskState =
  typeof LocalPendingTaskState[keyof typeof LocalPendingTaskState];

export interface StoredPendingTaskRecord {
  readonly taskId: string;
  readonly principalId: string;
  readonly taskType: typeof AITaskType.CONTENT_REVIEW;
  readonly target: {
    readonly targetType: AIReviewTargetType;
    readonly targetId: string;
    readonly sourceUpdatedAt: string;
  };
  readonly contentSnapshot: Readonly<Record<string, unknown>>;
  readonly remoteCreatedAt: string;
  readonly remoteStatus: typeof AITaskStatus.Pending;
  readonly localState: typeof LocalPendingTaskState.Downloaded;
}

export type LocalPendingTaskStoreContractErrorCode =
  | 'INVALID_DOWNLOADED_TASK'
  | 'INVALID_STORED_RECORD';

export class LocalPendingTaskStoreContractError extends Error {
  readonly code: LocalPendingTaskStoreContractErrorCode;

  constructor(
    code: LocalPendingTaskStoreContractErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'LocalPendingTaskStoreContractError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function validateJsonCompatibility(
  value: unknown,
  visited: Set<object>,
  isTopLevel: boolean
): void {
  if (value === null) {
    if (isTopLevel) {
      throw new Error('Top-level contentSnapshot must be a plain object');
    }
    return;
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    if (isTopLevel) {
      throw new Error('Top-level contentSnapshot must be a plain object');
    }
    return;
  }

  if (typeof value === 'number') {
    if (isTopLevel) {
      throw new Error('Top-level contentSnapshot must be a plain object');
    }
    if (!Number.isFinite(value)) {
      throw new Error('Non-finite numbers are not JSON-compatible');
    }
    return;
  }

  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new Error('Disallowed JSON value type');
  }

  if (typeof value === 'object') {
    if (visited.has(value)) {
      throw new Error('Cyclic reference detected');
    }
    visited.add(value);

    try {
      if (Array.isArray(value)) {
        if (isTopLevel) {
          throw new Error('Top-level contentSnapshot must be a plain object');
        }
        for (let i = 0; i < value.length; i++) {
          validateJsonCompatibility(value[i], visited, false);
        }
        return;
      }

      if (!isPlainObject(value)) {
        throw new Error('Object is not a plain object or array');
      }

      const keys = Object.keys(value);
      for (const key of keys) {
        validateJsonCompatibility(value[key], visited, false);
      }
    } finally {
      visited.delete(value);
    }
    return;
  }

  throw new Error('Unsupported JSON value');
}

function isAIReviewTargetType(
  value: unknown
): value is AIReviewTargetType {
  return (
    typeof value === 'string' &&
    (Object.values(AIReviewTargetType) as readonly string[]).includes(value)
  );
}

function assertValidTarget(
  target: unknown,
  errorFactory: () => LocalPendingTaskStoreContractError
): {
  targetType: AIReviewTargetType;
  targetId: string;
  sourceUpdatedAt: string;
} {
  if (!isPlainObject(target)) {
    throw errorFactory();
  }

  const keys = Object.keys(target).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'sourceUpdatedAt' ||
    keys[1] !== 'targetId' ||
    keys[2] !== 'targetType'
  ) {
    throw errorFactory();
  }

  const { targetType, targetId, sourceUpdatedAt } = target as {
    targetType: unknown;
    targetId: unknown;
    sourceUpdatedAt: unknown;
  };

  if (
    !isAIReviewTargetType(targetType) ||
    !isNonEmptyTrimmedString(targetId) ||
    !isNonEmptyTrimmedString(sourceUpdatedAt)
  ) {
    throw errorFactory();
  }

  return {
    targetType,
    targetId,
    sourceUpdatedAt,
  };
}

export function createStoredPendingTaskRecord(
  downloaded: DownloadedPendingTask
): StoredPendingTaskRecord {
  const downloadError = () =>
    new LocalPendingTaskStoreContractError(
      'INVALID_DOWNLOADED_TASK',
      'Invalid downloaded pending task.'
    );

  if (!isPlainObject(downloaded)) {
    throw downloadError();
  }

  const downloadedKeys = Object.keys(downloaded).sort();
  if (
    downloadedKeys.length !== 2 ||
    downloadedKeys[0] !== 'principalId' ||
    downloadedKeys[1] !== 'task'
  ) {
    throw downloadError();
  }

  if (!isNonEmptyTrimmedString(downloaded.principalId)) {
    throw downloadError();
  }

  const task = downloaded.task;
  if (!isPlainObject(task)) {
    throw downloadError();
  }

  const taskKeys = Object.keys(task).sort();
  if (
    taskKeys.length !== 6 ||
    taskKeys[0] !== 'contentSnapshot' ||
    taskKeys[1] !== 'createdAt' ||
    taskKeys[2] !== 'status' ||
    taskKeys[3] !== 'target' ||
    taskKeys[4] !== 'taskId' ||
    taskKeys[5] !== 'taskType'
  ) {
    throw downloadError();
  }

  if (!isNonEmptyTrimmedString(task.taskId)) {
    throw downloadError();
  }

  if (task.taskType !== AITaskType.CONTENT_REVIEW) {
    throw downloadError();
  }

  if (task.status !== AITaskStatus.Pending) {
    throw downloadError();
  }

  if (!isNonEmptyTrimmedString(task.createdAt)) {
    throw downloadError();
  }

  assertValidTarget(task.target, downloadError);

  if (!isPlainObject(task.contentSnapshot)) {
    throw downloadError();
  }

  try {
    validateJsonCompatibility(task.contentSnapshot, new Set<object>(), true);
  } catch {
    throw downloadError();
  }

  return {
    taskId: task.taskId,
    principalId: downloaded.principalId,
    taskType: task.taskType,
    target: task.target as StoredPendingTaskRecord['target'],
    contentSnapshot: task.contentSnapshot,
    remoteCreatedAt: task.createdAt,
    remoteStatus: task.status,
    localState: LocalPendingTaskState.Downloaded,
  };
}

export function validateStoredPendingTaskRecord(
  input: unknown
): StoredPendingTaskRecord {
  const storedError = () =>
    new LocalPendingTaskStoreContractError(
      'INVALID_STORED_RECORD',
      'Invalid stored pending task record.'
    );

  if (!isPlainObject(input)) {
    throw storedError();
  }

  const keys = Object.keys(input).sort();
  if (
    keys.length !== 8 ||
    keys[0] !== 'contentSnapshot' ||
    keys[1] !== 'localState' ||
    keys[2] !== 'principalId' ||
    keys[3] !== 'remoteCreatedAt' ||
    keys[4] !== 'remoteStatus' ||
    keys[5] !== 'target' ||
    keys[6] !== 'taskId' ||
    keys[7] !== 'taskType'
  ) {
    throw storedError();
  }

  const record = input as unknown as StoredPendingTaskRecord;

  if (!isNonEmptyTrimmedString(record.taskId)) {
    throw storedError();
  }

  if (!isNonEmptyTrimmedString(record.principalId)) {
    throw storedError();
  }

  if (record.taskType !== AITaskType.CONTENT_REVIEW) {
    throw storedError();
  }

  assertValidTarget(record.target, storedError);

  if (!isPlainObject(record.contentSnapshot)) {
    throw storedError();
  }

  try {
    validateJsonCompatibility(record.contentSnapshot, new Set<object>(), true);
  } catch {
    throw storedError();
  }

  if (!isNonEmptyTrimmedString(record.remoteCreatedAt)) {
    throw storedError();
  }

  if (record.remoteStatus !== AITaskStatus.Pending) {
    throw storedError();
  }

  if (record.localState !== LocalPendingTaskState.Downloaded) {
    throw storedError();
  }

  return record;
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== typeof b) {
    return false;
  }
  if (typeof a !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualJson(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA).sort();
  const keysB = Object.keys(objB).sort();
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (key !== keysB[i]) {
      return false;
    }
    if (!deepEqualJson(objA[key], objB[key])) {
      return false;
    }
  }
  return true;
}

export function isSameStoredPendingTaskRecord(
  left: StoredPendingTaskRecord,
  right: StoredPendingTaskRecord
): boolean {
  return (
    left.taskId === right.taskId &&
    left.principalId === right.principalId &&
    left.taskType === right.taskType &&
    left.remoteCreatedAt === right.remoteCreatedAt &&
    left.remoteStatus === right.remoteStatus &&
    left.localState === right.localState &&
    left.target.targetType === right.target.targetType &&
    left.target.targetId === right.target.targetId &&
    left.target.sourceUpdatedAt === right.target.sourceUpdatedAt &&
    deepEqualJson(left.contentSnapshot, right.contentSnapshot)
  );
}

/**
 * save(record) is DUPLICATE-SAFE by taskId.
 *
 * Required future adapter behavior:
 * - first save inserts record
 * - re-saving the EXACT SAME canonical record is idempotent
 * - same taskId with conflicting persisted content MUST fail closed
 * - save MUST NOT silently overwrite conflicting records
 */
export interface LocalPendingTaskRepository {
  save(record: StoredPendingTaskRecord): Promise<void>;

  findByTaskId(taskId: string): Promise<StoredPendingTaskRecord | null>;

  listDownloaded(): Promise<readonly StoredPendingTaskRecord[]>;
}
