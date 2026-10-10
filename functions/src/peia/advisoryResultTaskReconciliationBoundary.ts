import { AuthorizedAdvisoryResultIntake } from './authorizedAdvisoryResultIntakeBoundary';
import { validateAIReviewTask } from './aiTaskValidator';
import { AITaskStatus, type AIReviewTask } from '../types/aiTask';

export interface AdvisoryResultTaskSource {
  fetchTaskById(taskId: string): Promise<unknown | null>;
}

export interface ReconciledAdvisoryResultIntake {
  readonly authorizedIntake: AuthorizedAdvisoryResultIntake;
  readonly task: AIReviewTask;
}

export type AdvisoryResultTaskReconciliationErrorCode =
  | 'TASK_NOT_FOUND'
  | 'TASK_REFERENCE_MISMATCH';

export class AdvisoryResultTaskReconciliationError extends Error {
  readonly code: AdvisoryResultTaskReconciliationErrorCode;

  constructor(
    code: AdvisoryResultTaskReconciliationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AdvisoryResultTaskReconciliationError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export async function reconcileAdvisoryResultTask(
  authorizedIntake: AuthorizedAdvisoryResultIntake,
  source: AdvisoryResultTaskSource
): Promise<ReconciledAdvisoryResultIntake> {
  const submittedTask = authorizedIntake.request.result.task;

  const rawTask = await source.fetchTaskById(submittedTask.taskId);

  if (rawTask === null) {
    throw new AdvisoryResultTaskReconciliationError(
      'TASK_NOT_FOUND',
      'Authoritative advisory review task was not found.'
    );
  }

  const task = validateAIReviewTask(rawTask);

  const rawAuthoritativeTask = rawTask as AIReviewTask;

  if (
    task.taskId !== submittedTask.taskId ||
    task.taskType !== submittedTask.taskType ||
    task.target.targetType !== submittedTask.target.targetType ||
    task.target.targetId !== submittedTask.target.targetId ||
    task.target.sourceUpdatedAt !== submittedTask.target.sourceUpdatedAt ||
    rawAuthoritativeTask.taskId !== submittedTask.taskId ||
    rawAuthoritativeTask.taskType !== submittedTask.taskType ||
    rawAuthoritativeTask.target.targetType !== submittedTask.target.targetType ||
    rawAuthoritativeTask.target.targetId !== submittedTask.target.targetId ||
    rawAuthoritativeTask.target.sourceUpdatedAt !== submittedTask.target.sourceUpdatedAt
  ) {
    throw new AdvisoryResultTaskReconciliationError(
      'TASK_REFERENCE_MISMATCH',
      'Submitted advisory result task reference does not match the authoritative task.'
    );
  }

  return {
    authorizedIntake,
    task,
  };
}
