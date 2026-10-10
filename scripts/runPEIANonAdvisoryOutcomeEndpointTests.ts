import {
  executeNonAdvisoryOutcomeSubmission,
  mapNonAdvisoryOutcomeHttpSuccess,
  mapNonAdvisoryOutcomeHttpError,
} from '../functions/src/peia/firebaseNonAdvisoryOutcomeSubmissionEndpoint';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import { NonAdvisoryOutcomePersistenceError } from '../functions/src/peia/nonAdvisoryOutcomePersistenceBoundary';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- Running PEIA Non-Advisory Outcome Endpoint Tests ---');

const mockVerifier = {
  verify: async (token: unknown) => {
    if (token === 'valid-token') {
      return {
        principalId: 'p-1',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      };
    }
    return null;
  },
};

const mockPersistenceRuntime = async (authorizedIntake: any) => {
  return {
    taskId: authorizedIntake.request.outcome.taskId,
    disposition: 'STORED' as const,
    convergedStatus: 'Completed' as const,
  };
};

class MockResponse {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public jsonBody: any = null;

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: any) {
    this.jsonBody = body;
  }
}

async function testHttpSuccess() {
  const req = {
    method: 'POST',
    get: (headerName: string) => {
      if (headerName.toLowerCase() === 'authorization') {
        return 'Bearer valid-token';
      }
      return undefined;
    },
    body: {
      outcome: {
        taskId: 'task-endpoint-1',
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: new Date().toISOString(),
      },
    },
  };

  const res = new MockResponse();

  await executeNonAdvisoryOutcomeSubmission(req as any, res as any, {
    verifier: mockVerifier,
    persistenceRuntime: mockPersistenceRuntime,
  });

  assert(res.statusCode === 200, 'HTTP status is 200');
  assert(res.jsonBody?.ok === true, 'Response ok is true');
  assert(res.jsonBody?.taskId === 'task-endpoint-1', 'Response taskId matches');
}

async function testHttpUnauthenticated() {
  const req = {
    method: 'POST',
    get: () => undefined,
    body: {},
  };

  const res = new MockResponse();

  await executeNonAdvisoryOutcomeSubmission(req as any, res as any, {
    verifier: mockVerifier,
    persistenceRuntime: mockPersistenceRuntime,
  });

  assert(res.statusCode === 401, 'HTTP status is 401 for missing token');
  assert(res.jsonBody?.ok === false, 'Response ok is false');
  assert(res.jsonBody?.error?.code === 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');
}

async function testHttpAlreadyIdentical() {
  const req = {
    method: 'POST',
    get: (headerName: string) => {
      if (headerName.toLowerCase() === 'authorization') {
        return 'Bearer valid-token';
      }
      return undefined;
    },
    body: {
      outcome: {
        taskId: 'task-endpoint-1',
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: new Date().toISOString(),
      },
    },
  };

  const res = new MockResponse();

  const identicalRuntime = async (authorizedIntake: any) => ({
    taskId: authorizedIntake.request.outcome.taskId,
    disposition: 'ALREADY_IDENTICAL' as const,
    convergedStatus: 'Completed' as const,
  });

  await executeNonAdvisoryOutcomeSubmission(req as any, res as any, {
    verifier: mockVerifier,
    persistenceRuntime: identicalRuntime,
  });

  assert(res.statusCode === 200, 'HTTP status is 200 for ALREADY_IDENTICAL');
  assert(res.jsonBody?.ok === true, 'Response ok is true');
  assert(res.jsonBody?.taskId === 'task-endpoint-1', 'Response taskId matches');
}

async function testHttpResultConflict() {
  const req = {
    method: 'POST',
    get: (headerName: string) => {
      if (headerName.toLowerCase() === 'authorization') {
        return 'Bearer valid-token';
      }
      return undefined;
    },
    body: {
      outcome: {
        taskId: 'task-endpoint-1',
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: new Date().toISOString(),
      },
    },
  };

  const res = new MockResponse();

  const conflictRuntime = async () => {
    throw new NonAdvisoryOutcomePersistenceError('RESULT_CONFLICT', 'Divergent outcome for taskId.');
  };

  await executeNonAdvisoryOutcomeSubmission(req as any, res as any, {
    verifier: mockVerifier,
    persistenceRuntime: conflictRuntime,
  });

  assert(res.statusCode === 409, 'HTTP status is 409 for RESULT_CONFLICT');
  assert(res.jsonBody?.ok === false, 'Response ok is false');
  assert(res.jsonBody?.error?.code === 'CONFLICT', 'Error code is CONFLICT');
}

async function run() {
  await testHttpSuccess();
  await testHttpUnauthenticated();
  await testHttpAlreadyIdentical();
  await testHttpResultConflict();
  console.log('PASSED: All PEIA Non-Advisory Outcome Endpoint tests passed.');
}

run().catch((err) => {
  console.error('FAILED with error:', err);
  process.exit(1);
});
