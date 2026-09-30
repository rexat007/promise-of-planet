import {
  type PEIAAdvisoryResult,
} from './advisoryResultContract';
import {
  createAdvisoryResultUploadRequest,
  parseAdvisoryResultUploadResponse,
  type AdvisoryResultUploadResponse,
} from './advisoryResultUploadContract';

export interface AdvisoryResultHttpUploadInput {
  readonly endpointUrl: string;
  readonly credential: string;
  readonly result: PEIAAdvisoryResult;
}

export interface AdvisoryResultHttpFetchResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export interface AdvisoryResultHttpFetchInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type AdvisoryResultHttpFetch = (
  url: string,
  init: AdvisoryResultHttpFetchInit
) => Promise<AdvisoryResultHttpFetchResponse>;

export type AdvisoryResultHttpUploadTransportErrorCode =
  | 'INVALID_ENDPOINT'
  | 'INVALID_CREDENTIAL'
  | 'REQUEST_SERIALIZATION_FAILED'
  | 'NETWORK_FAILURE'
  | 'UNEXPECTED_HTTP_STATUS'
  | 'RESPONSE_READ_FAILED';

const ERROR_MESSAGES: Record<AdvisoryResultHttpUploadTransportErrorCode, string> = {
  INVALID_ENDPOINT: 'Invalid result upload endpoint.',
  INVALID_CREDENTIAL: 'Invalid machine credential.',
  REQUEST_SERIALIZATION_FAILED: 'Unable to serialize advisory result upload request.',
  NETWORK_FAILURE: 'Unable to reach result upload endpoint.',
  UNEXPECTED_HTTP_STATUS: 'Result upload endpoint rejected the request.',
  RESPONSE_READ_FAILED: 'Unable to read result upload response.',
};

export class AdvisoryResultHttpUploadTransportError extends Error {
  readonly code: AdvisoryResultHttpUploadTransportErrorCode;

  constructor(
    code: AdvisoryResultHttpUploadTransportErrorCode,
    message: string = ERROR_MESSAGES[code]
  ) {
    super(message);
    this.name = 'AdvisoryResultHttpUploadTransportError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function validateEndpointUrl(endpointUrl: unknown): string {
  if (typeof endpointUrl !== 'string') {
    throw new AdvisoryResultHttpUploadTransportError(
      'INVALID_ENDPOINT',
      'Invalid result upload endpoint.'
    );
  }

  if (endpointUrl.length === 0 || endpointUrl !== endpointUrl.trim()) {
    throw new AdvisoryResultHttpUploadTransportError(
      'INVALID_ENDPOINT',
      'Invalid result upload endpoint.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw new AdvisoryResultHttpUploadTransportError(
      'INVALID_ENDPOINT',
      'Invalid result upload endpoint.'
    );
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

  throw new AdvisoryResultHttpUploadTransportError(
    'INVALID_ENDPOINT',
    'Invalid result upload endpoint.'
  );
}

function validateCredential(credential: unknown): string {
  if (typeof credential !== 'string') {
    throw new AdvisoryResultHttpUploadTransportError(
      'INVALID_CREDENTIAL',
      'Invalid machine credential.'
    );
  }

  if (
    credential.length === 0 ||
    credential !== credential.trim() ||
    /\s/.test(credential) ||
    credential.includes('\r') ||
    credential.includes('\n')
  ) {
    throw new AdvisoryResultHttpUploadTransportError(
      'INVALID_CREDENTIAL',
      'Invalid machine credential.'
    );
  }

  return credential;
}

export async function uploadAdvisoryResultWithFetch(
  input: AdvisoryResultHttpUploadInput,
  fetcher: AdvisoryResultHttpFetch
): Promise<AdvisoryResultUploadResponse> {
  validateEndpointUrl(input.endpointUrl);
  validateCredential(input.credential);

  const request = createAdvisoryResultUploadRequest(input.result);

  let body: string;
  try {
    body = JSON.stringify(request);
  } catch {
    throw new AdvisoryResultHttpUploadTransportError(
      'REQUEST_SERIALIZATION_FAILED',
      'Unable to serialize advisory result upload request.'
    );
  }

  let response: AdvisoryResultHttpFetchResponse;
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
    throw new AdvisoryResultHttpUploadTransportError(
      'NETWORK_FAILURE',
      'Unable to reach result upload endpoint.'
    );
  }

  if (response.status !== 200) {
    throw new AdvisoryResultHttpUploadTransportError(
      'UNEXPECTED_HTTP_STATUS',
      'Result upload endpoint rejected the request.'
    );
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new AdvisoryResultHttpUploadTransportError(
      'RESPONSE_READ_FAILED',
      'Unable to read result upload response.'
    );
  }

  return parseAdvisoryResultUploadResponse(responseBody);
}

export async function uploadAdvisoryResult(
  input: AdvisoryResultHttpUploadInput
): Promise<AdvisoryResultUploadResponse> {
  if (typeof globalThis.fetch !== 'function') {
    throw new AdvisoryResultHttpUploadTransportError(
      'NETWORK_FAILURE',
      'Unable to reach result upload endpoint.'
    );
  }

  const productionFetch: AdvisoryResultHttpFetch = async (url, init) => {
    const res = await globalThis.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    return {
      status: res.status,
      json: () => res.json(),
    };
  };

  return uploadAdvisoryResultWithFetch(input, productionFetch);
}
