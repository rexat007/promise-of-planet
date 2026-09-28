import { PendingTaskHttpRequestError } from './taskGatewayHttpRequestAdapter';
import { MachineAuthorizationError } from './machineAuthorizationBoundary';
import { TaskGatewayContractError, type PendingTaskGatewaySuccess } from './taskGatewayContract';
import { ValidationError } from './aiTaskValidator';
import { TaskDeliveryError } from './aiTaskDeliveryBoundary';
import { FirestorePendingTaskSourceError } from './firestorePendingTaskSource';

export interface PendingTaskHttpResponse<TBody = unknown> {
  readonly status: number;
  readonly body: TBody;
}

export interface PendingTaskHttpSuccessBody {
  readonly ok: true;
  readonly principalId: string;
  readonly task: PendingTaskGatewaySuccess['task'];
}

export interface PendingTaskHttpErrorBody {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

const PUBLIC_MESSAGES = {
  METHOD_NOT_ALLOWED: 'Method not allowed.',
  UNAUTHENTICATED_REQUIRED: 'Authentication required.',
  UNAUTHENTICATED_FAILED: 'Authentication failed.',
  FORBIDDEN: 'Access denied.',
  INVALID_REQUEST: 'Invalid request.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable.',
  TASK_NOT_AVAILABLE: 'Task is not available for delivery.',
  INTERNAL_ERROR: 'Internal server error.',
} as const;

export function mapPendingTaskHttpSuccess(
  success: PendingTaskGatewaySuccess
): PendingTaskHttpResponse<PendingTaskHttpSuccessBody> {
  return {
    status: 200,
    body: {
      ok: true,
      principalId: success.principalId,
      task: success.task,
    },
  };
}

export function mapPendingTaskHttpError(
  error: unknown
): PendingTaskHttpResponse<PendingTaskHttpErrorBody> {
  if (error instanceof PendingTaskHttpRequestError) {
    if (error.code === 'HTTP_METHOD_NOT_ALLOWED') {
      return {
        status: 405,
        body: {
          ok: false,
          error: {
            code: 'METHOD_NOT_ALLOWED',
            message: PUBLIC_MESSAGES.METHOD_NOT_ALLOWED,
          },
        },
      };
    }

    if (
      error.code === 'HTTP_AUTHORIZATION_MISSING' ||
      error.code === 'HTTP_AUTHORIZATION_INVALID'
    ) {
      return {
        status: 401,
        body: {
          ok: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: PUBLIC_MESSAGES.UNAUTHENTICATED_REQUIRED,
          },
        },
      };
    }

    if (error.code === 'HTTP_BODY_NOT_EMPTY') {
      return {
        status: 400,
        body: {
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: PUBLIC_MESSAGES.INVALID_REQUEST,
          },
        },
      };
    }

    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: PUBLIC_MESSAGES.INTERNAL_ERROR,
        },
      },
    };
  }

  if (error instanceof MachineAuthorizationError) {
    if (error.code === 'MACHINE_UNAUTHENTICATED') {
      return {
        status: 401,
        body: {
          ok: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: PUBLIC_MESSAGES.UNAUTHENTICATED_FAILED,
          },
        },
      };
    }

    if (
      error.code === 'MACHINE_INACTIVE' ||
      error.code === 'MACHINE_CAPABILITY_DENIED' ||
      error.code === 'MACHINE_PRINCIPAL_INVALID'
    ) {
      return {
        status: 403,
        body: {
          ok: false,
          error: {
            code: 'FORBIDDEN',
            message: PUBLIC_MESSAGES.FORBIDDEN,
          },
        },
      };
    }

    if (error.code === 'MACHINE_AUTHENTICATION_FAILED') {
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: PUBLIC_MESSAGES.SERVICE_UNAVAILABLE,
          },
        },
      };
    }

    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: PUBLIC_MESSAGES.INTERNAL_ERROR,
        },
      },
    };
  }

  if (error instanceof TaskGatewayContractError) {
    return {
      status: 400,
      body: {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: PUBLIC_MESSAGES.INVALID_REQUEST,
        },
      },
    };
  }

  if (error instanceof ValidationError) {
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: PUBLIC_MESSAGES.INTERNAL_ERROR,
        },
      },
    };
  }

  if (error instanceof TaskDeliveryError) {
    return {
      status: 409,
      body: {
        ok: false,
        error: {
          code: 'TASK_NOT_AVAILABLE',
          message: PUBLIC_MESSAGES.TASK_NOT_AVAILABLE,
        },
      },
    };
  }

  if (error instanceof FirestorePendingTaskSourceError) {
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: PUBLIC_MESSAGES.INTERNAL_ERROR,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: PUBLIC_MESSAGES.INTERNAL_ERROR,
      },
    },
  };
}
