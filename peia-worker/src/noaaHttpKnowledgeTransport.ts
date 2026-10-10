import {
  NOAA_SOURCE_ID,
  NOAA_AUTHORITY,
  NOAA_QUERY_MAX_LENGTH,
  CANONICAL_NOAA_SOURCE,
  NOAARetrievalError,
  type NOAATransportRequest,
  type NOAATransportResponse,
} from './noaaKnowledgeRetrievalBoundary';

export const NCEI_DATASETS_ENDPOINT = 'https://www.ncei.noaa.gov/access/services/search/v1/datasets';

const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

/**
 * Validates whether a URL satisfies the canonical NOAA validator contract:
 * Must start with https://noaa.gov/ or https://*.noaa.gov/.
 */
export function isValidNOAAUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url !== url.trim()) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'noaa.gov' || hostname.endsWith('.noaa.gov');
  } catch {
    return false;
  }
}

/**
 * Validates a NOAA transport request query fail-closed.
 */
export function validateNOAATransportRequest(request: unknown): { readonly query: string } {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  const { query } = request as Record<string, unknown>;

  if (typeof query !== 'string') {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  if (query.length === 0) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  if (query !== query.trim()) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  if (query.length > NOAA_QUERY_MAX_LENGTH) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  if (CONTROL_CHAR_REGEX.test(query)) {
    throw new NOAARetrievalError('INVALID_REQUEST');
  }

  return { query };
}

export type FetchFunction = (
  input: string | URL,
  init?: RequestInit
) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export interface NOAAHttpTransportOptions {
  readonly fetchFn?: FetchFunction;
  readonly timeoutMs?: number;
}

/**
 * Creates a real production NOAA transport backed by the NOAA/NCEI Common Access Search Service.
 */
export function createNOAAHttpKnowledgeTransport(
  options: NOAAHttpTransportOptions = {}
): (request: NOAATransportRequest) => Promise<NOAATransportResponse> {
  const fetchFn: FetchFunction = options.fetchFn || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10000;

  return async function noaaHttpTransport(request: NOAATransportRequest): Promise<NOAATransportResponse> {
    const validated = validateNOAATransportRequest(request);

    const endpointUrl = `${NCEI_DATASETS_ENDPOINT}?text=${encodeURIComponent(validated.query)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await fetchFn(endpointUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PromiseOfPlanet-PEIA/1.0',
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('NOAA request timed out.');
      }
      throw err;
    }

    if (response.status !== 200) {
      clearTimeout(timeoutId);
      return {
        status: response.status,
        json: async () => {
          clearTimeout(timeoutId);
          return await response.json();
        },
      };
    }

    return {
      status: response.status,
      json: async () => {
        if (controller.signal.aborted) {
          clearTimeout(timeoutId);
          throw new Error('NOAA request timed out.');
        }
        try {
          const result = await Promise.race([
            response.json(),
            new Promise((_, reject) => {
              const listener = () => {
                reject(new Error('NOAA request timed out.'));
              };
              if (controller.signal.aborted) {
                reject(new Error('NOAA request timed out.'));
              } else {
                controller.signal.addEventListener('abort', listener, { once: true });
              }
            }),
          ]);
          clearTimeout(timeoutId);
          return parseNCEIDatasetsResponse(result, validated.query);
        } catch (err: unknown) {
          clearTimeout(timeoutId);
          if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('timed out'))) {
            throw new Error('NOAA request timed out.');
          }
          throw err;
        }
      },
    };
  };
}

/**
 * Parses an upstream NCEI JSON response and maps valid records into the exact response shape
 * expected by parseNOAARetrievalResponse in noaaKnowledgeRetrievalBoundary.ts:
 * {
 *   results: [
 *     {
 *       id: string,
 *       title: string,
 *       url: string,
 *       excerpt: string,
 *       publishedAt?: string,
 *       updatedAt?: string
 *     }
 *   ]
 * }
 */
export function parseNCEIDatasetsResponse(
  rawJson: unknown,
  _query: string
): {
  readonly results: readonly {
    readonly id: string;
    readonly title: string;
    readonly url: string;
    readonly excerpt: string;
    readonly publishedAt?: string;
    readonly updatedAt?: string;
  }[];
} {
  if (typeof rawJson !== 'object' || rawJson === null || Array.isArray(rawJson)) {
    throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
  }

  const { results } = rawJson as Record<string, unknown>;
  if (!Array.isArray(results)) {
    throw new NOAARetrievalError('INVALID_SOURCE_RESPONSE');
  }

  const mappedResults: {
    readonly id: string;
    readonly title: string;
    readonly url: string;
    readonly excerpt: string;
    readonly publishedAt?: string;
    readonly updatedAt?: string;
  }[] = [];

  for (const item of results) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;

    // 1. ID resolution: fileId if valid/non-empty, else id
    const fileId = record['fileId'];
    const idVal = record['id'];
    let canonicalItemId = '';
    if (typeof fileId === 'string' && fileId.trim().length > 0) {
      canonicalItemId = fileId.trim();
    } else if (typeof idVal === 'string' && idVal.trim().length > 0) {
      canonicalItemId = idVal.trim();
    }
    if (!canonicalItemId) {
      continue;
    }

    // 2. Title resolution: name field mapped to `title` (matching boundary field expectation)
    const nameVal = record['name'];
    if (typeof nameVal !== 'string' || nameVal.trim().length === 0) {
      continue;
    }
    const title = nameVal.trim();

    // 3. Excerpt resolution: description field mapped to `excerpt` (matching boundary field expectation)
    const descVal = record['description'];
    if (typeof descVal !== 'string' || descVal.trim().length === 0) {
      continue;
    }
    const excerpt = descVal.trim();

    // 4. URL resolution: search links (access, documentation, other) or doiLink mapped to `url`
    let validSourceUrl = '';
    const candidateUrls: unknown[] = [];

    if (record['doiLink']) {
      candidateUrls.push(record['doiLink']);
    }

    const linksObj = record['links'];
    if (linksObj && typeof linksObj === 'object' && !Array.isArray(linksObj)) {
      for (const linkCategory of Object.values(linksObj as Record<string, unknown>)) {
        if (Array.isArray(linkCategory)) {
          for (const linkEntry of linkCategory) {
            if (linkEntry && typeof linkEntry === 'object' && !Array.isArray(linkEntry)) {
              const u = (linkEntry as Record<string, unknown>)['url'];
              if (u) {
                candidateUrls.push(u);
              }
            }
          }
        }
      }
    }

    for (const cand of candidateUrls) {
      if (isValidNOAAUrl(cand)) {
        validSourceUrl = cand;
        break;
      }
    }

    if (!validSourceUrl) {
      continue;
    }



    const mappedItem = Object.freeze({
      id: canonicalItemId,
      title,
      url: validSourceUrl,
      excerpt,
    });

    mappedResults.push(mappedItem);

    if (mappedResults.length >= 5) {
      break;
    }
  }

  return Object.freeze({
    results: Object.freeze(mappedResults),
  });
}
