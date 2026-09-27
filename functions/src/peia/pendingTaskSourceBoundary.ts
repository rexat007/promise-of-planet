import { type AIReviewTask } from '../types/aiTask';
import { prepareAIReviewTaskForDelivery } from './aiTaskDeliveryBoundary';

export interface PendingTaskSource {
  fetchNextPendingTask(): Promise<unknown | null>;
}

/**
 * Prepares the next pending task from a trusted server source.
 * Fails closed if the source result is malformed or not in a Pending state.
 */
export async function prepareNextPendingTaskFromSource(
  source: PendingTaskSource
): Promise<AIReviewTask | null> {
  // 1. Call the source exactly once
  const rawTask = await source.fetchNextPendingTask();

  // 2. If the source returns null, return null (no task available)
  if (rawTask === null) {
    return null;
  }

  // 3. Pass the raw value to the delivery boundary for validation and eligibility check.
  // 4. Return the validated canonical AIReviewTask.
  // Any infrastructure or validation error will propagate unchanged.
  return prepareAIReviewTaskForDelivery(rawTask);
}
