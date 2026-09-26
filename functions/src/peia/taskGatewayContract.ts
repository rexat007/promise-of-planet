import { type AIReviewTask } from '../types/aiTask';
import { type AuthorizedPendingTaskDelivery } from './authorizedTaskDeliveryBoundary';

export interface PendingTaskGatewayRequest {
  readonly credential: unknown;
  readonly task: unknown;
}

export interface PendingTaskGatewaySuccess {
  readonly principalId: string;
  readonly task: AIReviewTask;
}

export class TaskGatewayContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TaskGatewayContractError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the outer envelope of a PendingTaskGatewayRequest.
 * Enforces strict key control, rejecting unknown or prohibited transport fields.
 * Downstream task internal validation remains separate.
 */
export function validatePendingTaskGatewayRequest(input: unknown): PendingTaskGatewayRequest {
  if (!isPlainObject(input)) {
    throw new TaskGatewayContractError(
      'INVALID_GATEWAY_REQUEST',
      'Gateway request must be a non-null, non-array object.'
    );
  }

  const keys = Object.keys(input);
  const acceptedKeys = ['credential', 'task'];

  const prohibitedFields = [
    'principalId', 'workerId', 'role', 'permission', 'adminRole', 'adminPermission',
    'approved', 'published', 'autoPublish', 'serviceAccount', 'apiKey', 'machineToken', 'jwt'
  ];

  // Check for prohibited or unknown fields
  for (const key of keys) {
    if (prohibitedFields.includes(key)) {
      throw new TaskGatewayContractError(
        'PROHIBITED_GATEWAY_FIELD',
        `Prohibited authority or identification field detected in gateway request envelope: "${key}".`
      );
    }
    if (!acceptedKeys.includes(key)) {
      throw new TaskGatewayContractError(
        'UNKNOWN_GATEWAY_FIELD',
        `Unknown field detected in gateway request envelope: "${key}".`
      );
    }
  }

  // Ensure both required fields exist
  if (!('credential' in input)) {
    throw new TaskGatewayContractError(
      'MISSING_GATEWAY_FIELD',
      'Gateway request is missing required field: "credential".'
    );
  }

  if (!('task' in input)) {
    throw new TaskGatewayContractError(
      'MISSING_GATEWAY_FIELD',
      'Gateway request is missing required field: "task".'
    );
  }

  return {
    credential: input.credential,
    task: input.task,
  };
}

/**
 * Transforms an authorized internal delivery outcome into a transport-neutral gateway success contract.
 * Filters out internal machine capabilities, active states, and credentials.
 */
export function toPendingTaskGatewaySuccess(
  delivery: AuthorizedPendingTaskDelivery
): PendingTaskGatewaySuccess {
  return {
    principalId: delivery.principal.principalId,
    task: delivery.task,
  };
}
