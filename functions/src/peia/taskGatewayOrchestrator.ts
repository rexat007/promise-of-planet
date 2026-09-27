import { type MachineIdentityVerifier, authorizePendingTaskDelivery } from './machineAuthorizationBoundary';
import { type PendingTaskSource, prepareNextPendingTaskFromSource } from './pendingTaskSourceBoundary';
import {
  validatePendingTaskGatewayRequest,
  toPendingTaskGatewaySuccess,
  type PendingTaskGatewaySuccess,
} from './taskGatewayContract';

/**
 * Pure transport-neutral orchestrator that coordinates the secure pending-task delivery protocol.
 * Enforces the exact sequential boundary execution:
 * 1. Validate incoming outer request envelope
 * 2. Authenticate and authorize the machine principal
 * 3. Retrieve and validate the next pending task from a trusted server source
 * 4. Adapt internal authorized delivery to transport-neutral gateway success response
 */
export async function executePendingTaskGatewayRequest(
  input: unknown,
  verifier: MachineIdentityVerifier,
  source: PendingTaskSource
): Promise<PendingTaskGatewaySuccess> {
  // 1. Outer request shape and envelope validation occurs first
  const request = validatePendingTaskGatewayRequest(input);

  // 2. Machine authorization occurs strictly BEFORE any source access
  const principal = await authorizePendingTaskDelivery(request.credential, verifier);

  // 3. ONLY AFTER successful authorization: Retrieve and validate the next pending task
  const task = await prepareNextPendingTaskFromSource(source);

  // 4. Success adaptation to strip internal fields before sending response
  return toPendingTaskGatewaySuccess(principal, task);
}
