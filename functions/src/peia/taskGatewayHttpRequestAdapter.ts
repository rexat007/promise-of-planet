import { type FirestoreTaskGatewayHandler } from './firestoreTaskGatewayComposition';
import { type PendingTaskGatewaySuccess } from './taskGatewayContract';

/**
 * Transport-neutral HTTP request representation for the PEIA task gateway.
 * Contains no cookies, session info, query parameters, or authenticated human identities.
 */
export interface PendingTaskHttpRequest {
  readonly method: unknown;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

/**
 * Transport-level error for HTTP request validation failures.
 * Never leaks credentials or sensitive gateway state.
 */
export class PendingTaskHttpRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PendingTaskHttpRequestError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Validates an incoming HTTP-like request and executes the task gateway handler.
 *
 * Sequence:
 * 1. Validate request.method === 'POST'
 * 2. Validate request.body is empty (undefined, null, or plain empty object {})
 * 3. Resolve exactly one case-insensitive Authorization header
 * 4. Parse Bearer syntax and extract opaque credential
 * 5. Call handler with { credential }
 * 6. Return handler result directly (propagating errors directly)
 */
export async function executePendingTaskHttpRequest(
  request: PendingTaskHttpRequest,
  handler: FirestoreTaskGatewayHandler
): Promise<PendingTaskGatewaySuccess> {
  // 1. validate method === 'POST'
  if (request.method !== 'POST') {
    throw new PendingTaskHttpRequestError(
      'HTTP_METHOD_NOT_ALLOWED',
      'Method not allowed'
    );
  }

  // 2. validate body is empty according to contract
  const body = request.body;
  if (body !== undefined && body !== null) {
    if (typeof body !== 'object' || Array.isArray(body)) {
      throw new PendingTaskHttpRequestError(
        'HTTP_BODY_NOT_EMPTY',
        'Request body must be empty'
      );
    }
    const proto = Object.getPrototypeOf(body);
    if (proto !== Object.prototype && proto !== null) {
      throw new PendingTaskHttpRequestError(
        'HTTP_BODY_NOT_EMPTY',
        'Request body must be empty'
      );
    }
    if (Object.keys(body).length > 0) {
      throw new PendingTaskHttpRequestError(
        'HTTP_BODY_NOT_EMPTY',
        'Request body must be empty'
      );
    }
  }

  // 3. resolve exactly one case-insensitive Authorization header
  const headers = request.headers;
  const headerKeys = headers ? Object.keys(headers) : [];
  const authKeys = headerKeys.filter((key) => key.toLowerCase() === 'authorization');

  if (authKeys.length === 0) {
    throw new PendingTaskHttpRequestError(
      'HTTP_AUTHORIZATION_MISSING',
      'Authorization header is missing'
    );
  }

  if (authKeys.length > 1) {
    throw new PendingTaskHttpRequestError(
      'HTTP_AUTHORIZATION_INVALID',
      'Multiple Authorization headers detected'
    );
  }

  const rawAuthorization = headers[authKeys[0]];
  if (typeof rawAuthorization !== 'string') {
    throw new PendingTaskHttpRequestError(
      'HTTP_AUTHORIZATION_INVALID',
      'Authorization header must be a string'
    );
  }

  // 4. parse Bearer transport syntax
  if (
    rawAuthorization.startsWith(' ') ||
    rawAuthorization.endsWith(' ') ||
    rawAuthorization.includes('\t') ||
    rawAuthorization.includes('\n') ||
    rawAuthorization.includes('\r')
  ) {
    throw new PendingTaskHttpRequestError(
      'HTTP_AUTHORIZATION_INVALID',
      'Invalid Authorization header format'
    );
  }

  const parts = rawAuthorization.split(' ');
  if (parts.length !== 2) {
    throw new PendingTaskHttpRequestError(
      'HTTP_AUTHORIZATION_INVALID',
      'Invalid Authorization header format'
    );
  }

  const [scheme, credential] = parts;
  if (scheme.toLowerCase() !== 'bearer') {
    throw new PendingTaskHttpRequestError(
      'HTTP_AUTHORIZATION_INVALID',
      'Invalid Authorization scheme'
    );
  }

  if (!credential || credential.length === 0 || /\s/.test(credential)) {
    throw new PendingTaskHttpRequestError(
      'HTTP_AUTHORIZATION_INVALID',
      'Bearer credential must not be empty'
    );
  }

  // 5. call handler EXACTLY ONCE with { credential }
  // 6. return EXACTLY the handler result directly
  return handler({
    credential,
  });
}
