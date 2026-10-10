import {
  NonAdvisoryOutcomePersistenceError,
  NonAdvisoryOutcomePersistenceResult,
} from './nonAdvisoryOutcomePersistenceBoundary';
import { NonAdvisoryOutcomeTaskReconciliationError } from './nonAdvisoryOutcomeTaskReconciliationBoundary';
import { NonAdvisoryOutcomeContractError } from './nonAdvisoryOutcomeIntakeContract';
import { MachineAuthorizationError, MachineIdentityVerifier } from './machineAuthorizationBoundary';
import { ValidationError } from './aiTaskValidator';
import { NonAdvisoryOutcomeRepositoryError } from './firestoreNonAdvisoryOutcomeRepository';
import {
  authorizeAndValidateNonAdvisoryOutcomeIntake,
} from './authorizedNonAdvisoryOutcomeIntakeBoundary';
import {
  OpaqueMachineIdentityVerifier,
} from './machineCredentialVerifier';
import {
  FirestoreMachineCredentialBindingRepository,
} from './firestoreMachineCredentialRepository';
import {
  createProductionNonAdvisoryOutcomePersistenceRuntime,
  FirestoreNonAdvisoryOutcomePersistenceHandler,
} from './firestoreNonAdvisoryOutcomePersistenceComposition';

let onRequest: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  onRequest = require('firebase-functions/v2/https').onRequest;
} catch {
  onRequest = (_opts: any, handler: any) => handler;
}

let getFirestore: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  getFirestore = require('firebase-admin/firestore').getFirestore;
} catch {
  getFirestore = () => ({});
}

export interface NonAdvisoryOutcomeHttpResponse<TBody = unknown> {
  readonly status: number;
  readonly body: TBody;
}

export interface NonAdvisoryOutcomeHttpSuccessBody {
  readonly ok: true;
  readonly taskId: string;
}

export interface NonAdvisoryOutcomeHttpErrorBody {
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

export function mapNonAdvisoryOutcomeHttpSuccess(
  result: NonAdvisoryOutcomePersistenceResult
): NonAdvisoryOutcomeHttpResponse<NonAdvisoryOutcomeHttpSuccessBody> {
  return {
    status: 200,
    body: {
      ok: true,
      taskId: result.taskId,
    },
  };
}

export function mapNonAdvisoryOutcomeHttpError(
  error: unknown
): NonAdvisoryOutcomeHttpResponse<NonAdvisoryOutcomeHttpErrorBody> {
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

  if (error instanceof NonAdvisoryOutcomeContractError) {
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

  if (error instanceof NonAdvisoryOutcomeTaskReconciliationError) {
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

  if (error instanceof NonAdvisoryOutcomeRepositoryError) {
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
      error.code === 'TASK_IDENTITY_MISMATCH'
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

  if (error instanceof NonAdvisoryOutcomePersistenceError) {
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

export interface NonAdvisoryOutcomeSubmissionResponse {
  setHeader(name: string, value: string): void;
  status(code: number): NonAdvisoryOutcomeSubmissionResponse;
  json(body: unknown): void;
}

export interface NonAdvisoryOutcomeSubmissionRequest {
  method: string;
  get(name: string): string | undefined;
  body: unknown;
}

export async function executeNonAdvisoryOutcomeSubmission(
  request: NonAdvisoryOutcomeSubmissionRequest,
  response: NonAdvisoryOutcomeSubmissionResponse,
  dependencies: {
    verifier: MachineIdentityVerifier;
    persistenceRuntime: FirestoreNonAdvisoryOutcomePersistenceHandler;
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

    const authorizedIntake = await authorizeAndValidateNonAdvisoryOutcomeIntake(
      credential,
      request.body,
      dependencies.verifier
    );

    const result = await dependencies.persistenceRuntime(authorizedIntake);
    const mapped = mapNonAdvisoryOutcomeHttpSuccess(result);
    response.status(mapped.status).json(mapped.body);

  } catch (error: unknown) {
    const mapped = mapNonAdvisoryOutcomeHttpError(error);
    if (mapped.status === 401) {
      response.setHeader('WWW-Authenticate', 'Bearer');
    }
    response.status(mapped.status).json(mapped.body);
  }
}

export const peiaNonAdvisoryOutcomeSubmission = onRequest(
  {
    cors: false,
  },
  async (request: any, response: any) => {
    const db = getFirestore();
    const readDb = { collection: (name: string) => db.collection(name) };
    const repo = new FirestoreMachineCredentialBindingRepository(readDb);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const persistenceRuntime = createProductionNonAdvisoryOutcomePersistenceRuntime();

    await executeNonAdvisoryOutcomeSubmission(request, response, {
      verifier,
      persistenceRuntime,
    });
  }
);
