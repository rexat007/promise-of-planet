import { AuthorizedNonAdvisoryOutcomeIntake } from './authorizedNonAdvisoryOutcomeIntakeBoundary';
import { validateAIReviewTask } from './aiTaskValidator';
import { AITaskStatus, type AIReviewTask } from '../types/aiTask';

export interface NonAdvisoryOutcomeTaskSource {
  fetchTaskById(taskId: string): Promise<unknown | null>;
}

export type NonAdvisoryOutcomeTaskReconciliationErrorCode =
  | 'TASK_NOT_FOUND'
  | 'TASK_NOT_PENDING'
  | 'TASK_REFERENCE_MISMATCH';

export class NonAdvisoryOutcomeTaskReconciliationError extends Error {
  readonly code: NonAdvisoryOutcomeTaskReconciliationErrorCode;

  constructor(
    code: NonAdvisoryOutcomeTaskReconciliationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'NonAdvisoryOutcomeTaskReconciliationError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export async function reconcileNonAdvisoryOutcomeTask(
  authorizedIntake: AuthorizedNonAdvisoryOutcomeIntake,
  source: NonAdvisoryOutcomeTaskSource
): Promise<AIReviewTask> {
  const submittedTaskId = authorizedIntake.request.outcome.taskId;

  const rawTask = await source.fetchTaskById(submittedTaskId);

  if (rawTask === null) {
    throw new NonAdvisoryOutcomeTaskReconciliationError(
      'TASK_NOT_FOUND',
      'Authoritative review task was not found.'
    );
  }

  const task = validateAIReviewTask(rawTask);

  if (task.status !== AITaskStatus.Pending) {
    throw new NonAdvisoryOutcomeTaskReconciliationError(
      'TASK_NOT_PENDING',
      'Authoritative review task is not pending.'
    );
  }

  if (task.taskId !== submittedTaskId) {
    throw new NonAdvisoryOutcomeTaskReconciliationError(
      'TASK_REFERENCE_MISMATCH',
      'Submitted outcome task reference does not match the authoritative task.'
    );
  }

  return task;
}
