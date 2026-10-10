import {
  type DurableNonAdvisoryOutcomeRecord,
} from './localNonAdvisoryOutcomeContract';
import {
  createNonAdvisoryOutcomeReportRequest,
  parseNonAdvisoryOutcomeReportResponse,
  type NonAdvisoryOutcomeReportResponse,
} from './nonAdvisoryOutcomeReportContract';

export interface NonAdvisoryOutcomeHttpReportInput {
  readonly endpointUrl: string;
  readonly credential: string;
  readonly outcome: DurableNonAdvisoryOutcomeRecord;
}

export interface NonAdvisoryOutcomeHttpFetchResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export interface NonAdvisoryOutcomeHttpFetchInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type NonAdvisoryOutcomeHttpFetch = (
  url: string,
  init: NonAdvisoryOutcomeHttpFetchInit
) => Promise<NonAdvisoryOutcomeHttpFetchResponse>;

export type NonAdvisoryOutcomeHttpReportTransportErrorCode =
  | 'INVALID_ENDPOINT'
  | 'INVALID_CREDENTIAL'
  | 'REQUEST_SERIALIZATION_FAILED'
  | 'NETWORK_FAILURE'
  | 'UNEXPECTED_HTTP_STATUS'
  | 'RESPONSE_READ_FAILED';

export class NonAdvisoryOutcomeHttpReportTransportError extends Error {
  readonly code: NonAdvisoryOutcomeHttpReportTransportErrorCode;

  constructor(
    code: NonAdvisoryOutcomeHttpReportTransportErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'NonAdvisoryOutcomeHttpReportTransportError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function validateEndpointUrl(endpointUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw new NonAdvisoryOutcomeHttpReportTransportError('INVALID_ENDPOINT', 'Invalid endpoint URL.');
  }

  const protocol = parsed.protocol;
  if (protocol === 'https:') {
    return endpointUrl;
  }

  if (protocol === 'http:') {
    const hostname = parsed.hostname;
    const isLoopback =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]';
    if (isLoopback) {
      return endpointUrl;
    }
  }

  throw new NonAdvisoryOutcomeHttpReportTransportError('INVALID_ENDPOINT', 'Invalid endpoint URL.');
}

function validateCredential(credential: string): string {
  if (credential.length === 0 || credential !== credential.trim() || /\s/.test(credential)) {
    throw new NonAdvisoryOutcomeHttpReportTransportError('INVALID_CREDENTIAL', 'Invalid machine credential.');
  }
  return credential;
}

export async function uploadNonAdvisoryOutcomeWithFetch(
  input: NonAdvisoryOutcomeHttpReportInput,
  fetcher: NonAdvisoryOutcomeHttpFetch
): Promise<NonAdvisoryOutcomeReportResponse> {
  validateEndpointUrl(input.endpointUrl);
  validateCredential(input.credential);

  const request = createNonAdvisoryOutcomeReportRequest(input.outcome);

  let body: string;
  try {
    body = JSON.stringify(request);
  } catch {
    throw new NonAdvisoryOutcomeHttpReportTransportError('REQUEST_SERIALIZATION_FAILED', 'Serialization failed.');
  }

  let response: NonAdvisoryOutcomeHttpFetchResponse;
  try {
    response = await fetcher(input.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.credential}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
  } catch {
    throw new NonAdvisoryOutcomeHttpReportTransportError('NETWORK_FAILURE', 'Network failure.');
  }

  if (response.status !== 200) {
    throw new NonAdvisoryOutcomeHttpReportTransportError('UNEXPECTED_HTTP_STATUS', 'Endpoint rejected request.');
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new NonAdvisoryOutcomeHttpReportTransportError('RESPONSE_READ_FAILED', 'Read response failed.');
  }

  return parseNonAdvisoryOutcomeReportResponse(responseBody);
}

export async function uploadNonAdvisoryOutcome(
  input: NonAdvisoryOutcomeHttpReportInput
): Promise<NonAdvisoryOutcomeReportResponse> {
  if (typeof globalThis.fetch !== 'function') {
    throw new NonAdvisoryOutcomeHttpReportTransportError('NETWORK_FAILURE', 'Fetch not available.');
  }
  
  return uploadNonAdvisoryOutcomeWithFetch(input, async (url, init) => {
    const res = await globalThis.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    return {
      status: res.status,
      json: () => res.json(),
    };
  });
}
