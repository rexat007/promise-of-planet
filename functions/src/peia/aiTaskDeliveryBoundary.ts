import { AITaskStatus, type AIReviewTask } from '../types/aiTask';
import { validateAIReviewTask } from './aiTaskValidator';

export class TaskDeliveryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TaskDeliveryError';
    this.code = code;
  }
}

/**
 * Determines whether a validated AIReviewTask is eligible to be delivered to an external worker.
 * Ensures only Pending tasks are eligible, failing closed on structural invalidity or other states.
 */
export function prepareAIReviewTaskForDelivery(input: unknown): AIReviewTask {
  // Call the accepted PEIA-16A validator to perform structural validation
  const validatedTask = validateAIReviewTask(input);

  // Reject any task that is structurally valid but is not in a Pending state
  if (validatedTask.status !== AITaskStatus.Pending) {
    throw new TaskDeliveryError(
      'TASK_NOT_DELIVERABLE',
      `Task is not deliverable. Expected status "${AITaskStatus.Pending}", but found "${validatedTask.status}".`
    );
  }

  // Return the validated canonical AIReviewTask as-is without any status mutation
  return validatedTask;
}
