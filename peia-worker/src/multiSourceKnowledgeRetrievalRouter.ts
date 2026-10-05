import {
  EPA_SOURCE_ID,
  type EPASourceId,
  type EPATransport,
  type EPAValidResultsPayload,
  type EPANoResultsPayload,
  type EPAEvidenceItem,
  EPARetrievalError,
  retrieveFromEPASource,
} from './epaKnowledgeRetrievalBoundary';

import {
  NOAA_SOURCE_ID,
  type NOAASourceId,
  type NOAATransport,
  type NOAAValidResultsPayload,
  type NOAANoResultsPayload,
  type NOAAEvidenceItem,
  NOAARetrievalError,
  retrieveFromNOAASource,
} from './noaaKnowledgeRetrievalBoundary';

export type PEIAKnowledgeSourceId = 'EPA' | 'NOAA';

export const SUPPORTED_KNOWLEDGE_SOURCES: readonly PEIAKnowledgeSourceId[] = Object.freeze([
  EPA_SOURCE_ID,
  NOAA_SOURCE_ID,
]);

export const PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH = 500;
const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

export interface MultiSourceRetrievalRequest {
  readonly query: string;
  readonly sources: readonly PEIAKnowledgeSourceId[];
}

export type MultiSourceRouterErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_SOURCE'
  | 'ROUTING_CONTRACT_FAILURE';

const ERROR_MESSAGES: Record<MultiSourceRouterErrorCode, string> = {
  INVALID_REQUEST: 'Invalid multi-source retrieval request.',
  UNSUPPORTED_SOURCE: 'Unsupported knowledge source requested.',
  ROUTING_CONTRACT_FAILURE: 'Multi-source routing internal contract failure.',
};

export class MultiSourceRouterError extends Error {
  readonly code: MultiSourceRouterErrorCode;

  constructor(code: MultiSourceRouterErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'MultiSourceRouterError';
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

export function validateMultiSourceRetrievalRequest(
  input: unknown
): MultiSourceRetrievalRequest {
  if (!isPlainObject(input)) {
    throw new MultiSourceRouterError('INVALID_REQUEST');
  }

  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('query') || !keys.includes('sources')) {
    throw new MultiSourceRouterError('INVALID_REQUEST');
  }

  const queryVal = input['query'];
  if (typeof queryVal !== 'string') {
    throw new MultiSourceRouterError('INVALID_REQUEST');
  }

  if (queryVal.length === 0 || queryVal !== queryVal.trim()) {
    throw new MultiSourceRouterError('INVALID_REQUEST');
  }

  if (queryVal.length > PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH) {
    throw new MultiSourceRouterError('INVALID_REQUEST');
  }

  if (CONTROL_CHAR_REGEX.test(queryVal)) {
    throw new MultiSourceRouterError('INVALID_REQUEST');
  }

  const sourcesVal = input['sources'];
  if (!Array.isArray(sourcesVal)) {
    throw new MultiSourceRouterError('INVALID_REQUEST');
  }

  if (sourcesVal.length < 1 || sourcesVal.length > 2) {
    throw new MultiSourceRouterError('INVALID_REQUEST');
  }

  const seen = new Set<string>();
  const validatedSources: PEIAKnowledgeSourceId[] = [];

  for (const src of sourcesVal) {
    if (typeof src !== 'string') {
      throw new MultiSourceRouterError('INVALID_REQUEST');
    }
    if (src !== EPA_SOURCE_ID && src !== NOAA_SOURCE_ID) {
      throw new MultiSourceRouterError('UNSUPPORTED_SOURCE');
    }
    if (seen.has(src)) {
      throw new MultiSourceRouterError('INVALID_REQUEST');
    }
    seen.add(src);
    validatedSources.push(src);
  }

  return Object.freeze({
    query: queryVal,
    sources: Object.freeze(validatedSources),
  });
}

export type SourceFailureErrorCode = 'TRANSPORT_FAILURE' | 'INVALID_SOURCE_RESPONSE';

export interface EPASuccessOutcome {
  readonly sourceId: 'EPA';
  readonly kind: 'VALID_RESULTS';
  readonly value: EPAValidResultsPayload;
}

export interface EPANoResultsOutcome {
  readonly sourceId: 'EPA';
  readonly kind: 'NO_RESULTS';
  readonly value: EPANoResultsPayload;
}

export interface NOAASuccessOutcome {
  readonly sourceId: 'NOAA';
  readonly kind: 'VALID_RESULTS';
  readonly value: NOAAValidResultsPayload;
}

export interface NOAANoResultsOutcome {
  readonly sourceId: 'NOAA';
  readonly kind: 'NO_RESULTS';
  readonly value: NOAANoResultsPayload;
}

export interface SourceFailureOutcome {
  readonly sourceId: PEIAKnowledgeSourceId;
  readonly kind: 'SOURCE_FAILURE';
  readonly errorCode: SourceFailureErrorCode;
}

export type MultiSourceRetrievalOutcome =
  | EPASuccessOutcome
  | EPANoResultsOutcome
  | NOAASuccessOutcome
  | NOAANoResultsOutcome
  | SourceFailureOutcome;

export interface MultiSourceRetrievalResult {
  readonly query: string;
  readonly requestedSources: readonly PEIAKnowledgeSourceId[];
  readonly outcomes: readonly MultiSourceRetrievalOutcome[];
}

export interface MultiSourceTransports {
  readonly EPA?: EPATransport;
  readonly NOAA?: NOAATransport;
}

export type MultiSourceClock = () => string;

export async function routeMultiSourceRetrieval(
  requestInput: unknown,
  transports: MultiSourceTransports,
  clock?: MultiSourceClock
): Promise<MultiSourceRetrievalResult> {
  const validatedRequest = validateMultiSourceRetrievalRequest(requestInput);

  if (!isPlainObject(transports)) {
    throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
  }

  const transportKeys = Object.keys(transports);
  for (const k of transportKeys) {
    if (k !== EPA_SOURCE_ID && k !== NOAA_SOURCE_ID) {
      throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
    }
  }

  for (const requestedSource of validatedRequest.sources) {
    if (requestedSource === EPA_SOURCE_ID) {
      if (typeof transports.EPA !== 'function') {
        throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
      }
    } else if (requestedSource === NOAA_SOURCE_ID) {
      if (typeof transports.NOAA !== 'function') {
        throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
      }
    } else {
      throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
    }
  }

  const outcomes: MultiSourceRetrievalOutcome[] = [];

  for (const sourceId of validatedRequest.sources) {
    if (sourceId === EPA_SOURCE_ID) {
      const epaTransport = transports.EPA;
      if (typeof epaTransport !== 'function') {
        throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
      }
      try {
        const epaResult = await retrieveFromEPASource(
          { query: validatedRequest.query },
          epaTransport,
          clock
        );
        if (epaResult.kind === 'VALID_RESULTS') {
          outcomes.push(
            Object.freeze({
              sourceId: EPA_SOURCE_ID,
              kind: 'VALID_RESULTS',
              value: epaResult.value,
            })
          );
        } else if (epaResult.kind === 'NO_RESULTS') {
          outcomes.push(
            Object.freeze({
              sourceId: EPA_SOURCE_ID,
              kind: 'NO_RESULTS',
              value: epaResult.value,
            })
          );
        } else {
          throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
        }
      } catch (err: unknown) {
        if (err instanceof EPARetrievalError) {
          if (err.code === 'TRANSPORT_FAILURE' || err.code === 'INVALID_SOURCE_RESPONSE') {
            outcomes.push(
              Object.freeze({
                sourceId: EPA_SOURCE_ID,
                kind: 'SOURCE_FAILURE',
                errorCode: err.code,
              })
            );
          } else {
            throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
          }
        } else if (err instanceof MultiSourceRouterError) {
          throw err;
        } else {
          throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
        }
      }
    } else if (sourceId === NOAA_SOURCE_ID) {
      const noaaTransport = transports.NOAA;
      if (typeof noaaTransport !== 'function') {
        throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
      }
      try {
        const noaaResult = await retrieveFromNOAASource(
          { query: validatedRequest.query },
          noaaTransport,
          clock
        );
        if (noaaResult.kind === 'VALID_RESULTS') {
          outcomes.push(
            Object.freeze({
              sourceId: NOAA_SOURCE_ID,
              kind: 'VALID_RESULTS',
              value: noaaResult.value,
            })
          );
        } else if (noaaResult.kind === 'NO_RESULTS') {
          outcomes.push(
            Object.freeze({
              sourceId: NOAA_SOURCE_ID,
              kind: 'NO_RESULTS',
              value: noaaResult.value,
            })
          );
        } else {
          throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
        }
      } catch (err: unknown) {
        if (err instanceof NOAARetrievalError) {
          if (err.code === 'TRANSPORT_FAILURE' || err.code === 'INVALID_SOURCE_RESPONSE') {
            outcomes.push(
              Object.freeze({
                sourceId: NOAA_SOURCE_ID,
                kind: 'SOURCE_FAILURE',
                errorCode: err.code,
              })
            );
          } else {
            throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
          }
        } else if (err instanceof MultiSourceRouterError) {
          throw err;
        } else {
          throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
        }
      }
    } else {
      throw new MultiSourceRouterError('ROUTING_CONTRACT_FAILURE');
    }
  }

  return Object.freeze({
    query: validatedRequest.query,
    requestedSources: validatedRequest.sources,
    outcomes: Object.freeze(outcomes),
  });
}

export const executeMultiSourceRetrieval = routeMultiSourceRetrieval;
