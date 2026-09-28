import { onRequest } from 'firebase-functions/v2/https';
import { createFirebaseTaskGatewayRuntime } from './firebaseTaskGatewayRuntime';
import {
  executePendingTaskHttpRequest,
  type PendingTaskHttpRequest,
} from './taskGatewayHttpRequestAdapter';
import {
  mapPendingTaskHttpSuccess,
  mapPendingTaskHttpError,
  type PendingTaskHttpResponse,
} from './taskGatewayHttpResponseMapper';
import { type FirestoreTaskGatewayHandler } from './firestoreTaskGatewayComposition';

export interface PendingTaskHttpResponseWriter {
  setHeader(name: string, value: string): void;
  status(code: number): PendingTaskHttpResponseWriter;
  json(body: unknown): unknown;
}

export interface FirebasePendingTaskHttpEndpointDependencies {
  readonly createGateway: () => FirestoreTaskGatewayHandler;
  readonly executeRequest: typeof executePendingTaskHttpRequest;
  readonly mapSuccess: typeof mapPendingTaskHttpSuccess;
  readonly mapError: typeof mapPendingTaskHttpError;
}

export async function executeFirebasePendingTaskHttpEndpoint(
  request: PendingTaskHttpRequest,
  response: PendingTaskHttpResponseWriter,
  dependencies: FirebasePendingTaskHttpEndpointDependencies
): Promise<void> {
  let mappedResponse: PendingTaskHttpResponse;

  try {
    const gateway = dependencies.createGateway();
    const success = await dependencies.executeRequest(request, gateway);
    mappedResponse = dependencies.mapSuccess(success);
  } catch (error: unknown) {
    mappedResponse = dependencies.mapError(error);
  }

  response.setHeader('Cache-Control', 'no-store');

  if (mappedResponse.status === 401) {
    response.setHeader('WWW-Authenticate', 'Bearer');
  }

  if (mappedResponse.status === 405) {
    response.setHeader('Allow', 'POST');
  }

  response.status(mappedResponse.status).json(mappedResponse.body);
}

export const peiaPendingTaskGateway = onRequest(
  {
    cors: false,
  },
  async (request, response) => {
    const httpRequest: PendingTaskHttpRequest = {
      method: request.method,
      headers: request.headers,
      body: request.body,
    };

    await executeFirebasePendingTaskHttpEndpoint(
      httpRequest,
      response,
      {
        createGateway: createFirebaseTaskGatewayRuntime,
        executeRequest: executePendingTaskHttpRequest,
        mapSuccess: mapPendingTaskHttpSuccess,
        mapError: mapPendingTaskHttpError,
      }
    );
  }
);
