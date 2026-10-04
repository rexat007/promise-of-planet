export const NOAA_SOURCE_ID = 'NOAA' as const;
export type NOAASourceId = typeof NOAA_SOURCE_ID;

export const NOAA_AUTHORITY = 'National Oceanic and Atmospheric Administration' as const;
export type NOAAAuthority = typeof NOAA_AUTHORITY;

export interface NOAASourceIdentity {
  readonly sourceId: NOAASourceId;
  readonly authority: NOAAAuthority;
}

export const CANONICAL_NOAA_SOURCE: NOAASourceIdentity = Object.freeze({
  sourceId: NOAA_SOURCE_ID,
  authority: NOAA_AUTHORITY,
});

export const NOAA_QUERY_MAX_LENGTH = 500;
const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

export interface NOAARetrievalRequest {
  readonly query: string;
}

export interface NOAAProvenanceMetadata {
  readonly sourceId: NOAASourceId;
  readonly authority: NOAAAuthority;
  readonly retrievedAt: string;
  readonly sourceUrl: string;
  readonly canonicalItemId: string;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
}

export interface NOAAEvidenceItem {
  readonly itemId: string;
  readonly sourceId: NOAASourceId;
  readonly authority: NOAAAuthority;
  readonly title: string;
  readonly excerpt: string;
  readonly sourceUrl: string;
  readonly provenance: NOAAProvenanceMetadata;
}

export interface NOAAValidResultsPayload {
  readonly source: NOAASourceIdentity;
  readonly query: string;
  readonly items: readonly NOAAEvidenceItem[];
}

export interface NOAANoResultsPayload {
  readonly source: NOAASourceIdentity;
  readonly query: string;
  readonly items: readonly [];
}

export type NOAARetrievalResult =
  | {
      readonly kind: 'VALID_RESULTS';
      readonly value: NOAAValidResultsPayload;
    }
  | {
      readonly kind: 'NO_RESULTS';
      readonly value: NOAANoResultsPayload;
    };

export interface NOAATransportRequest {
  readonly query: string;
}

export interface NOAATransportResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export type NOAATransport = (
  request: NOAATransportRequest
) => Promise<NOAATransportResponse>;

export type NOAARetrievalErrorCode =
  | 'INVALID_REQUEST'
  | 'TRANSPORT_FAILURE'
  | 'INVALID_SOURCE_RESPONSE';

const ERROR_MESSAGES: Record<NOAARetrievalErrorCode, string> = {
  INVALID_REQUEST: 'Invalid NOAA retrieval request.',
  TRANSPORT_FAILURE: 'NOAA retrieval transport failed.',
  INVALID_SOURCE_RESPONSE: 'Invalid response from NOAA source.',
};

export class NOAARetrievalError extends Error {
  readonly code: NOAARetrievalErrorCode;

  constructor(code: NOAARetrievalErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'NOAARetrievalError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isValidNOAAUrl(urlStr: unknown): urlStr is string {
  if (typeof urlStr !== 'string') {
    return false;
  }
  if (urlStr.length === 0 || urlStr !== urlStr.trim()) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  return hostname === 'noaa.gov' || hostname.endsWith('.noaa.gov');
}

const STRICT_ISO_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function getDaysInMonth(month: number, year: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

export function isValidIsoTimestamp(str: unknown): str is string {
  if (typeof str !== 'string') {
    return false;
  }
  if (str.length === 0 || str !== str.trim()) {
    return false;
  }
  const match = STRICT_ISO_TIMESTAMP_REGEX.exec(str);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (year < 1 || year > 9999) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > getDaysInMonth(month, year)) {
    return false;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return false;
  }

  const parsed = Date.parse(str);
  return !Number.isNaN(parsed);
}

export function validateNOAARetrievalRequest(input: unknown): NOAARetrievalRequest {
  if (!isPlainObject(input)) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'query') {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  const rawQuery = input['query'];
  if (typeof rawQuery !== 'string') {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  if (rawQuery.length === 0) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  if (rawQuery !== rawQuery.trim()) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  if (rawQuery.length > NOAA_QUERY_MAX_LENGTH) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  if (CONTROL_CHAR_REGEX.test(rawQuery)) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  return {
    query: rawQuery,
  };
}

export function parseNOAARetrievalResponse(
  responseBody: unknown,
  query: string,
  retrievedAt: unknown
): NOAARetrievalResult {
  if (!isValidIsoTimestamp(retrievedAt)) {
    throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
  }

  if (!isPlainObject(responseBody)) {
    throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
  }

  const rawResults = responseBody['results'];
  if (!Array.isArray(rawResults)) {
    throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
  }

  if (rawResults.length === 0) {
    const noResults: NOAANoResultsPayload = {
      source: CANONICAL_NOAA_SOURCE,
      query,
      items: [],
    };
    return {
      kind: 'NO_RESULTS',
      value: noResults,
    };
  }

  const items: NOAAEvidenceItem[] = [];

  for (const rawItem of rawResults) {
    if (!isPlainObject(rawItem)) {
      throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
    }

    const idValue = rawItem['id'];
    if (typeof idValue !== 'string' || idValue.length === 0 || idValue !== idValue.trim()) {
      throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
    }

    const titleValue = rawItem['title'];
    if (typeof titleValue !== 'string' || titleValue.length === 0 || titleValue !== titleValue.trim()) {
      throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
    }

    const urlValue = rawItem['url'];
    if (!isValidNOAAUrl(urlValue)) {
      throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
    }

    const rawExcerpt = rawItem['excerpt'] !== undefined ? rawItem['excerpt'] : rawItem['text'];
    if (typeof rawExcerpt !== 'string' || rawExcerpt.length === 0 || rawExcerpt.trim().length === 0) {
      throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
    }

    let publishedAt: string | undefined = undefined;
    const rawPublishedAt = rawItem['publishedAt'];
    if (rawPublishedAt !== undefined) {
      if (!isValidIsoTimestamp(rawPublishedAt)) {
        throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
      }
      publishedAt = rawPublishedAt;
    }

    let updatedAt: string | undefined = undefined;
    const rawUpdatedAt = rawItem['updatedAt'];
    if (rawUpdatedAt !== undefined) {
      if (!isValidIsoTimestamp(rawUpdatedAt)) {
        throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
      }
      updatedAt = rawUpdatedAt;
    }

    const provenance: NOAAProvenanceMetadata = Object.freeze({
      sourceId: NOAA_SOURCE_ID,
      authority: NOAA_AUTHORITY,
      retrievedAt,
      sourceUrl: urlValue,
      canonicalItemId: idValue,
      ...(publishedAt !== undefined ? { publishedAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    });

    const evidenceItem: NOAAEvidenceItem = Object.freeze({
      itemId: idValue,
      sourceId: NOAA_SOURCE_ID,
      authority: NOAA_AUTHORITY,
      title: titleValue,
      excerpt: rawExcerpt,
      sourceUrl: urlValue,
      provenance,
    });

    items.push(evidenceItem);
  }

  const validPayload: NOAAValidResultsPayload = {
    source: CANONICAL_NOAA_SOURCE,
    query,
    items: Object.freeze(items),
  };

  return {
    kind: 'VALID_RESULTS',
    value: validPayload,
  };
}

export async function retrieveFromNOAASource(
  requestInput: unknown,
  transport: NOAATransport,
  clock: () => string = () => new Date().toISOString()
): Promise<NOAARetrievalResult> {
  const validatedRequest = validateNOAARetrievalRequest(requestInput);

  let transportResponse: NOAATransportResponse;
  try {
    transportResponse = await transport({ query: validatedRequest.query });
  } catch {
    throw new NOAARetrievalError('TRANSPORT_FAILURE');
  }

  if (typeof transportResponse !== 'object' || transportResponse === null) {
    throw new NOAARetrievalError('TRANSPORT_FAILURE');
  }

  if (transportResponse.status !== 200) {
    throw new NOAARetrievalError('TRANSPORT_FAILURE');
  }

  let rawBody: unknown;
  try {
    rawBody = await transportResponse.json();
  } catch {
    throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
  }

  let retrievedAt: string;
  try {
    retrievedAt = clock();
  } catch {
    throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
  }

  return parseNOAARetrievalResponse(rawBody, validatedRequest.query, retrievedAt);
}

export const executeNOAARetrieval = retrieveFromNOAASource;
