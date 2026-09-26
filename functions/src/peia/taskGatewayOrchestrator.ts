import { type MachineIdentityVerifier } from './machineAuthorizationBoundary';
import { authorizeAndPreparePendingTaskDelivery } from './authorizedTaskDeliveryBoundary';
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
 * 3. Validate and prepare task for delivery
 * 4. Adapt internal authorized delivery to transport-neutral gateway success response
 */
export async function executePendingTaskGatewayRequest(
  input: unknown,
  verifier: MachineIdentityVerifier
): Promise<PendingTaskGatewaySuccess> {
  // 1. Outer request shape and envelope validation occurs first
  const request = validatePendingTaskGatewayRequest(input);

  // 2. Machine authorization followed by task validation & delivery filtering
  const delivery = await authorizeAndPreparePendingTaskDelivery(
    request.credential,
    request.task,
    verifier
  );

  // 3. Success adaptation to strip internal fields before sending response
  return toPendingTaskGatewaySuccess(delivery);
}
