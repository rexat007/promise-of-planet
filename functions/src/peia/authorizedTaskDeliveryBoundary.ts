import { type AIReviewTask } from '../types/aiTask';
import { prepareAIReviewTaskForDelivery } from './aiTaskDeliveryBoundary';
import { authorizePendingTaskDelivery, type VerifiedMachinePrincipal, type MachineIdentityVerifier } from './machineAuthorizationBoundary';

export interface AuthorizedPendingTaskDelivery {
  readonly principal: VerifiedMachinePrincipal;
  readonly task: AIReviewTask;
}

/**
 * Composes machine identity authorization and pending-task delivery validation into
 * a single atomic transaction. Enforces that authorization is executed prior to
 * any evaluation of the task payload.
 */
export async function authorizeAndPreparePendingTaskDelivery(
  credentialInput: unknown,
  taskInput: unknown,
  verifier: MachineIdentityVerifier
): Promise<AuthorizedPendingTaskDelivery> {
  // First, authorize the machine identity
  const principal = await authorizePendingTaskDelivery(credentialInput, verifier);

  // Task processing is strictly deferred until machine authorization completes successfully
  const task = prepareAIReviewTaskForDelivery(taskInput);

  return {
    principal,
    task,
  };
}
