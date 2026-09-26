import type { ReviewTargetIdentity } from './aiReview';

/**
 * Task family restricted strictly to advisory-only content auditing.
 */
export const AITaskType = {
  CONTENT_REVIEW: 'CONTENT_REVIEW',
} as const;

export type AITaskType = typeof AITaskType[keyof typeof AITaskType];

/**
 * Platform-side task lifecycle states.
 * CRITICAL BOUNDARY: Cancellation and retries remain deferred.
 */
export const AITaskStatus = {
  Pending: 'Pending',
  Completed: 'Completed',
  Failed: 'Failed',
} as const;

export type AITaskStatus = typeof AITaskStatus[keyof typeof AITaskStatus];

/**
 * Minimal canonical PEIA platform-side Content Review Task contract.
 * Represents an advisory-only task request.
 */
export interface AIReviewTask {
  readonly taskId: string; // Unique, platform-controlled stable identifier
  readonly taskType: typeof AITaskType.CONTENT_REVIEW;
  readonly target: ReviewTargetIdentity; // Bound target reference (type, ID, version)
  /**
   * A top-level readonly transport snapshot contract representing the task content input payload.
   * Conceptually detached from live mutable domain records.
   * This is not a deep-immutability guarantee for nested runtime values.
   */
  readonly contentSnapshot: Readonly<Record<string, unknown>>;
  readonly createdAt: string; // ISO-8601 platform task creation timestamp
  readonly status: AITaskStatus;
}
