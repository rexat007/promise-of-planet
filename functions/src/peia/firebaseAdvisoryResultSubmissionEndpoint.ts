let onRequest: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  onRequest = require('firebase-functions/v2/https').onRequest;
} catch {
  onRequest = (_opts: any, handler: any) => handler;
}
import {
  AdvisoryResultPersistenceError,
  AdvisoryResultPersistenceResult,
} from './advisoryResultPersistenceBoundary';
import { AdvisoryResultTaskReconciliationError } from './advisoryResultTaskReconciliationBoundary';
import { AdvisoryResultRepositoryError } from './firestoreAdvisoryResultRepository';
import { AdvisoryResultIntakeContractError } from './advisoryResultIntakeContract';
import { MachineAuthorizationError, MachineIdentityVerifier } from './machineAuthorizationBoundary';
import { ValidationError } from './aiTaskValidator';
import {
  authorizeAndValidateAdvisoryResultIntake,
} from './authorizedAdvisoryResultIntakeBoundary';
import {
  OpaqueMachineIdentityVerifier,
} from './machineCredentialVerifier';
import {
  FirestoreMachineCredentialBindingRepository,
} from './firestoreMachineCredentialRepository';
import {
  createProductionAdvisoryResultPersistenceRuntime,
  FirestoreAdvisoryResultPersistenceHandler,
} from './firestoreAdvisoryResultPersistenceComposition';

// --- Mapper ---

export interface AdvisoryResultHttpResponse<TBody = unknown> {
  readonly status: number;
  readonly body: TBody;
}

export interface AdvisoryResultHttpSuccessBody {
  readonly ok: true;
  readonly taskId: string;
}

export interface AdvisoryResultHttpErrorBody {
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
  CONFLICT: 'Persistence conflict.',
  INTERNAL_ERROR: 'Internal server error.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable.',
} as const;

export function mapAdvisoryResultHttpSuccess(
  result: AdvisoryResultPersistenceResult
): AdvisoryResultHttpResponse<AdvisoryResultHttpSuccessBody> {
  return {
    status: 200,
    body: {
      ok: true,
      taskId: result.taskId,
    },
  };
}

export function mapAdvisoryResultHttpError(
  error: unknown
): AdvisoryResultHttpResponse<AdvisoryResultHttpErrorBody> {
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
  }

  if (error instanceof AdvisoryResultIntakeContractError) {
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

  if (error instanceof AdvisoryResultTaskReconciliationError) {
    if (error.code === 'TASK_NOT_FOUND') {
      return {
        status: 404,
        body: {
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task not found.',
          },
        },
      };
    }
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

  if (error instanceof AdvisoryResultRepositoryError) {
    if (error.code === 'TASK_NOT_FOUND') {
      return {
        status: 404,
        body: {
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task not found.',
          },
        },
      };
    }
    if (
      error.code === 'RESULT_CONFLICT' ||
      error.code === 'TASK_IDENTITY_MISMATCH' ||
      error.code === 'TASK_STATUS_INCONSISTENT'
    ) {
      return {
        status: 409,
        body: {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: PUBLIC_MESSAGES.CONFLICT,
          },
        },
      };
    }
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

  if (error instanceof AdvisoryResultPersistenceError) {
    if (
      error.code === 'TASK_IDENTITY_MISMATCH' ||
      error.code === 'RESULT_CONFLICT'
    ) {
      return {
        status: 409,
        body: {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: PUBLIC_MESSAGES.CONFLICT,
          },
        },
      };
    }
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

// --- Handler ---

export interface AdvisoryResultSubmissionResponse {
  setHeader(name: string, value: string): void;
  status(code: number): AdvisoryResultSubmissionResponse;
  json(body: unknown): void;
}

export interface AdvisoryResultSubmissionRequest {
  method: string;
  get(name: string): string | undefined;
  body: unknown;
}

export async function executeAdvisoryResultSubmission(
  request: AdvisoryResultSubmissionRequest,
  response: AdvisoryResultSubmissionResponse,
  dependencies: {
    verifier: MachineIdentityVerifier;
    persistenceRuntime: FirestoreAdvisoryResultPersistenceHandler;
  }
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({
      ok: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed.',
      },
    });
    return;
  }

  try {
    const authHeader = request.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(401).json({
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
      return;
    }
    const credential = authHeader.substring(7).trim();
    if (!credential) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(401).json({
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
      return;
    }

    const authorizedIntake = await authorizeAndValidateAdvisoryResultIntake(
      credential,
      request.body,
      dependencies.verifier
    );

    const result = await dependencies.persistenceRuntime(authorizedIntake);
    const mapped = mapAdvisoryResultHttpSuccess(result);
    response.status(mapped.status).json(mapped.body);

  } catch (error: unknown) {
    const mapped = mapAdvisoryResultHttpError(error);
    if (mapped.status === 401) {
      response.setHeader('WWW-Authenticate', 'Bearer');
    }
    response.status(mapped.status).json(mapped.body);
  }
}

// --- Endpoint ---

/**
 * PEIA Advisory Result Submission Endpoint.
 */
export const peiaAdvisoryResultSubmission = onRequest(
  {
    cors: false,
  },
  async (request, response) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getFirestore } = require('firebase-admin/firestore');
    const db = getFirestore();
    const readDb = { collection: (name: string) => db.collection(name) };
    const repo = new FirestoreMachineCredentialBindingRepository(readDb);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const persistenceRuntime = createProductionAdvisoryResultPersistenceRuntime();

    await executeAdvisoryResultSubmission(request, response, {
      verifier,
      persistenceRuntime,
    });
  }
);
