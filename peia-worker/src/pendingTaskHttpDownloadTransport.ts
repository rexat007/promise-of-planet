import {
  parsePendingTaskDownloadResponse,
  type PendingTaskDownloadResult,
} from './downloadTaskResponseContract';

export interface PendingTaskHttpDownloadInput {
  readonly endpointUrl: string;
  readonly credential: string;
}

export interface PendingTaskHttpFetchResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export interface PendingTaskHttpFetchInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
}

export type PendingTaskHttpFetch = (
  url: string,
  init: PendingTaskHttpFetchInit
) => Promise<PendingTaskHttpFetchResponse>;

export type PendingTaskHttpDownloadTransportErrorCode =
  | 'INVALID_ENDPOINT'
  | 'INVALID_CREDENTIAL'
  | 'NETWORK_FAILURE'
  | 'RESPONSE_READ_FAILED';

export class PendingTaskHttpDownloadTransportError extends Error {
  readonly code: PendingTaskHttpDownloadTransportErrorCode;

  constructor(
    code: PendingTaskHttpDownloadTransportErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PendingTaskHttpDownloadTransportError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function validateEndpointUrl(endpointUrl: unknown): string {
  if (typeof endpointUrl !== 'string') {
    throw new PendingTaskHttpDownloadTransportError(
      'INVALID_ENDPOINT',
      'Invalid task gateway endpoint.'
    );
  }

  if (endpointUrl.length === 0 || endpointUrl !== endpointUrl.trim()) {
    throw new PendingTaskHttpDownloadTransportError(
      'INVALID_ENDPOINT',
      'Invalid task gateway endpoint.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw new PendingTaskHttpDownloadTransportError(
      'INVALID_ENDPOINT',
      'Invalid task gateway endpoint.'
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

  throw new PendingTaskHttpDownloadTransportError(
    'INVALID_ENDPOINT',
    'Invalid task gateway endpoint.'
  );
}

function validateCredential(credential: unknown): string {
  if (typeof credential !== 'string') {
    throw new PendingTaskHttpDownloadTransportError(
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
    throw new PendingTaskHttpDownloadTransportError(
      'INVALID_CREDENTIAL',
      'Invalid machine credential.'
    );
  }

  return credential;
}

export async function downloadPendingTaskWithFetch(
  input: PendingTaskHttpDownloadInput,
  fetcher: PendingTaskHttpFetch
): Promise<PendingTaskDownloadResult> {
  validateEndpointUrl(input.endpointUrl);
  validateCredential(input.credential);

  let response: PendingTaskHttpFetchResponse;
  try {
    response = await fetcher(input.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.credential}`,
        Accept: 'application/json',
      },
    });
  } catch {
    throw new PendingTaskHttpDownloadTransportError(
      'NETWORK_FAILURE',
      'Unable to reach task gateway.'
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PendingTaskHttpDownloadTransportError(
      'RESPONSE_READ_FAILED',
      'Unable to read task gateway response.'
    );
  }

  return parsePendingTaskDownloadResponse(response.status, body);
}

export async function downloadPendingTask(
  input: PendingTaskHttpDownloadInput
): Promise<PendingTaskDownloadResult> {
  if (typeof globalThis.fetch !== 'function') {
    throw new PendingTaskHttpDownloadTransportError(
      'NETWORK_FAILURE',
      'Unable to reach task gateway.'
    );
  }

  const productionFetch: PendingTaskHttpFetch = async (url, init) => {
    const response = await globalThis.fetch(url, init);
    return {
      status: response.status,
      json: () => response.json(),
    };
  };

  return downloadPendingTaskWithFetch(input, productionFetch);
}
