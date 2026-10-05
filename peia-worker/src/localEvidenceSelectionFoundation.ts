import {
  EPA_SOURCE_ID,
  type EPASourceId,
  EPA_AUTHORITY,
  type EPAAuthority,
  CANONICAL_EPA_SOURCE,
  type EPAEvidenceItem,
  type EPAProvenanceMetadata,
  isValidEPAUrl,
  isValidIsoTimestamp,
} from './epaKnowledgeRetrievalBoundary';

import {
  NOAA_SOURCE_ID,
  type NOAASourceId,
  NOAA_AUTHORITY,
  type NOAAAuthority,
  CANONICAL_NOAA_SOURCE,
  type NOAAEvidenceItem,
  type NOAAProvenanceMetadata,
  isValidNOAAUrl,
} from './noaaKnowledgeRetrievalBoundary';

import {
  type PEIAKnowledgeSourceId,
  PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH,
  type MultiSourceRetrievalResult,
  type MultiSourceRetrievalOutcome,
} from './multiSourceKnowledgeRetrievalRouter';

export const MAX_LOCAL_EVIDENCE_ITEMS_LIMIT = 20;
export const LOCAL_EVIDENCE_SELECTION_MAX_ITEMS_LIMIT = MAX_LOCAL_EVIDENCE_ITEMS_LIMIT;

const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

export interface LocalEvidenceSelectionRequest {
  readonly retrieval: MultiSourceRetrievalResult;
  readonly maxItems: number;
}

export interface SelectedEvidenceItem {
  readonly sourceId: PEIAKnowledgeSourceId;
  readonly itemId: string;
  readonly authority: string;
  readonly title: string;
  readonly excerpt: string;
  readonly sourceUrl: string;
  readonly provenance: EPAProvenanceMetadata | NOAAProvenanceMetadata;
  readonly originalSourceOrder: number;
  readonly originalItemOrder: number;
}

export interface NoEvidenceResult {
  readonly kind: 'NO_EVIDENCE';
  readonly query: string;
  readonly selectedItems: readonly [];
  readonly totalEligibleItems: 0;
}

export interface SelectedEvidenceResult {
  readonly kind: 'SELECTED_EVIDENCE';
  readonly query: string;
  readonly selectedItems: readonly SelectedEvidenceItem[];
  readonly totalEligibleItems: number;
  readonly truncated: boolean;
}

export type LocalEvidenceSelectionResult =
  | NoEvidenceResult
  | SelectedEvidenceResult;

export type LocalEvidenceSelectionErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_RETRIEVAL_RESULT'
  | 'SELECTION_CONTRACT_FAILURE';

const ERROR_MESSAGES: Record<LocalEvidenceSelectionErrorCode, string> = {
  INVALID_REQUEST: 'Invalid local evidence selection request.',
  INVALID_RETRIEVAL_RESULT: 'Invalid multi-source retrieval result provided for evidence selection.',
  SELECTION_CONTRACT_FAILURE: 'Local evidence selection contract failure.',
};

export class LocalEvidenceSelectionError extends Error {
  readonly code: LocalEvidenceSelectionErrorCode;

  constructor(code: LocalEvidenceSelectionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'LocalEvidenceSelectionError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const LocalEvidenceSelectorError = LocalEvidenceSelectionError;
export type LocalEvidenceSelectorErrorCode = LocalEvidenceSelectionErrorCode;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateEvidenceItem(
  item: unknown,
  expectedSourceId: 'EPA'
): EPAEvidenceItem;
function validateEvidenceItem(
  item: unknown,
  expectedSourceId: 'NOAA'
): NOAAEvidenceItem;
function validateEvidenceItem(
  item: unknown,
  expectedSourceId: PEIAKnowledgeSourceId
): EPAEvidenceItem | NOAAEvidenceItem;
function validateEvidenceItem(
  item: unknown,
  expectedSourceId: PEIAKnowledgeSourceId
): EPAEvidenceItem | NOAAEvidenceItem {
  if (!isPlainObject(item)) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const keys = Object.keys(item);
  if (
    keys.length !== 7 ||
    !keys.includes('itemId') ||
    !keys.includes('sourceId') ||
    !keys.includes('authority') ||
    !keys.includes('title') ||
    !keys.includes('excerpt') ||
    !keys.includes('sourceUrl') ||
    !keys.includes('provenance')
  ) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const itemId = item['itemId'];
  if (
    typeof itemId !== 'string' ||
    itemId.length === 0 ||
    itemId !== itemId.trim()
  ) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const sourceId = item['sourceId'];
  if (sourceId !== expectedSourceId) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const authority = item['authority'];
  const expectedAuthority =
    expectedSourceId === EPA_SOURCE_ID ? EPA_AUTHORITY : NOAA_AUTHORITY;
  if (authority !== expectedAuthority) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const title = item['title'];
  if (
    typeof title !== 'string' ||
    title.length === 0 ||
    title !== title.trim()
  ) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const excerpt = item['excerpt'];
  if (
    typeof excerpt !== 'string' ||
    excerpt.length === 0 ||
    excerpt.trim().length === 0
  ) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const sourceUrl = item['sourceUrl'];
  if (typeof sourceUrl !== 'string') {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }
  if (expectedSourceId === EPA_SOURCE_ID) {
    if (!isValidEPAUrl(sourceUrl)) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
  } else {
    if (!isValidNOAAUrl(sourceUrl)) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
  }

  const provenance = item['provenance'];
  if (!isPlainObject(provenance)) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const provKeys = Object.keys(provenance);
  const allowedProvKeys = new Set([
    'sourceId',
    'authority',
    'retrievedAt',
    'sourceUrl',
    'canonicalItemId',
    'publishedAt',
    'updatedAt',
  ]);
  for (const k of provKeys) {
    if (!allowedProvKeys.has(k)) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
  }

  if (
    provenance['sourceId'] !== expectedSourceId ||
    provenance['authority'] !== expectedAuthority ||
    provenance['canonicalItemId'] !== itemId ||
    provenance['sourceUrl'] !== sourceUrl
  ) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const retrievedAtVal = provenance['retrievedAt'];
  if (typeof retrievedAtVal !== 'string' || !isValidIsoTimestamp(retrievedAtVal)) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  let publishedAt: string | undefined = undefined;
  if (provenance['publishedAt'] !== undefined) {
    const pubVal = provenance['publishedAt'];
    if (typeof pubVal !== 'string' || !isValidIsoTimestamp(pubVal)) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
    publishedAt = pubVal;
  }

  let updatedAt: string | undefined = undefined;
  if (provenance['updatedAt'] !== undefined) {
    const updVal = provenance['updatedAt'];
    if (typeof updVal !== 'string' || !isValidIsoTimestamp(updVal)) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
    updatedAt = updVal;
  }

  if (expectedSourceId === EPA_SOURCE_ID) {
    const epaProv: EPAProvenanceMetadata = Object.freeze({
      sourceId: EPA_SOURCE_ID,
      authority: EPA_AUTHORITY,
      retrievedAt: retrievedAtVal,
      sourceUrl,
      canonicalItemId: itemId,
      ...(publishedAt !== undefined ? { publishedAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    });
    return Object.freeze({
      itemId,
      sourceId: EPA_SOURCE_ID,
      authority: EPA_AUTHORITY,
      title,
      excerpt,
      sourceUrl,
      provenance: epaProv,
    });
  } else {
    const noaaProv: NOAAProvenanceMetadata = Object.freeze({
      sourceId: NOAA_SOURCE_ID,
      authority: NOAA_AUTHORITY,
      retrievedAt: retrievedAtVal,
      sourceUrl,
      canonicalItemId: itemId,
      ...(publishedAt !== undefined ? { publishedAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    });
    return Object.freeze({
      itemId,
      sourceId: NOAA_SOURCE_ID,
      authority: NOAA_AUTHORITY,
      title,
      excerpt,
      sourceUrl,
      provenance: noaaProv,
    });
  }
}

export function validateRetrievalResult(
  retrievalInput: unknown
): MultiSourceRetrievalResult {
  if (!isPlainObject(retrievalInput)) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const keys = Object.keys(retrievalInput);
  if (
    keys.length !== 3 ||
    !keys.includes('query') ||
    !keys.includes('requestedSources') ||
    !keys.includes('outcomes')
  ) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const queryVal = retrievalInput['query'];
  if (
    typeof queryVal !== 'string' ||
    queryVal.length === 0 ||
    queryVal !== queryVal.trim() ||
    queryVal.length > PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH ||
    CONTROL_CHAR_REGEX.test(queryVal)
  ) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const reqSourcesVal = retrievalInput['requestedSources'];
  if (!Array.isArray(reqSourcesVal) || reqSourcesVal.length < 1 || reqSourcesVal.length > 2) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const validatedSources: PEIAKnowledgeSourceId[] = [];
  const seenSources = new Set<string>();
  for (const s of reqSourcesVal) {
    if (typeof s !== 'string') {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
    if (s !== EPA_SOURCE_ID && s !== NOAA_SOURCE_ID) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
    if (seenSources.has(s)) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
    seenSources.add(s);
    validatedSources.push(s);
  }

  const outcomesVal = retrievalInput['outcomes'];
  if (!Array.isArray(outcomesVal) || outcomesVal.length !== validatedSources.length) {
    throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
  }

  const validatedOutcomes: MultiSourceRetrievalOutcome[] = [];

  for (let i = 0; i < validatedSources.length; i++) {
    const expectedSource = validatedSources[i];
    const outcome = outcomesVal[i];
    if (!isPlainObject(outcome)) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }

    if (outcome['sourceId'] !== expectedSource) {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }

    const kind = outcome['kind'];
    if (kind === 'VALID_RESULTS') {
      const outcomeKeys = Object.keys(outcome);
      if (
        outcomeKeys.length !== 3 ||
        !outcomeKeys.includes('sourceId') ||
        !outcomeKeys.includes('kind') ||
        !outcomeKeys.includes('value')
      ) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const val = outcome['value'];
      if (!isPlainObject(val)) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const valKeys = Object.keys(val);
      if (
        valKeys.length !== 3 ||
        !valKeys.includes('source') ||
        !valKeys.includes('query') ||
        !valKeys.includes('items')
      ) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      if (val['query'] !== queryVal) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const src = val['source'];
      if (!isPlainObject(src)) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }
      const srcKeys = Object.keys(src);
      if (
        srcKeys.length !== 2 ||
        src['sourceId'] !== expectedSource ||
        src['authority'] !== (expectedSource === EPA_SOURCE_ID ? EPA_AUTHORITY : NOAA_AUTHORITY)
      ) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const items = val['items'];
      if (!Array.isArray(items)) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      if (expectedSource === EPA_SOURCE_ID) {
        const validatedItems: EPAEvidenceItem[] = [];
        for (const it of items) {
          validatedItems.push(validateEvidenceItem(it, EPA_SOURCE_ID));
        }
        validatedOutcomes.push(
          Object.freeze({
            sourceId: EPA_SOURCE_ID,
            kind: 'VALID_RESULTS',
            value: Object.freeze({
              source: CANONICAL_EPA_SOURCE,
              query: queryVal,
              items: Object.freeze(validatedItems),
            }),
          })
        );
      } else {
        const validatedItems: NOAAEvidenceItem[] = [];
        for (const it of items) {
          validatedItems.push(validateEvidenceItem(it, NOAA_SOURCE_ID));
        }
        validatedOutcomes.push(
          Object.freeze({
            sourceId: NOAA_SOURCE_ID,
            kind: 'VALID_RESULTS',
            value: Object.freeze({
              source: CANONICAL_NOAA_SOURCE,
              query: queryVal,
              items: Object.freeze(validatedItems),
            }),
          })
        );
      }
    } else if (kind === 'NO_RESULTS') {
      const outcomeKeys = Object.keys(outcome);
      if (
        outcomeKeys.length !== 3 ||
        !outcomeKeys.includes('sourceId') ||
        !outcomeKeys.includes('kind') ||
        !outcomeKeys.includes('value')
      ) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const val = outcome['value'];
      if (!isPlainObject(val)) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const valKeys = Object.keys(val);
      if (
        valKeys.length !== 3 ||
        !valKeys.includes('source') ||
        !valKeys.includes('query') ||
        !valKeys.includes('items')
      ) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      if (val['query'] !== queryVal) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const src = val['source'];
      if (!isPlainObject(src)) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }
      const srcKeys = Object.keys(src);
      if (
        srcKeys.length !== 2 ||
        src['sourceId'] !== expectedSource ||
        src['authority'] !== (expectedSource === EPA_SOURCE_ID ? EPA_AUTHORITY : NOAA_AUTHORITY)
      ) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const items = val['items'];
      if (!Array.isArray(items) || items.length !== 0) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      if (expectedSource === EPA_SOURCE_ID) {
        validatedOutcomes.push(
          Object.freeze({
            sourceId: EPA_SOURCE_ID,
            kind: 'NO_RESULTS',
            value: Object.freeze({
              source: CANONICAL_EPA_SOURCE,
              query: queryVal,
              items: Object.freeze([] as const),
            }),
          })
        );
      } else {
        validatedOutcomes.push(
          Object.freeze({
            sourceId: NOAA_SOURCE_ID,
            kind: 'NO_RESULTS',
            value: Object.freeze({
              source: CANONICAL_NOAA_SOURCE,
              query: queryVal,
              items: Object.freeze([] as const),
            }),
          })
        );
      }
    } else if (kind === 'SOURCE_FAILURE') {
      const outcomeKeys = Object.keys(outcome);
      if (
        outcomeKeys.length !== 3 ||
        !outcomeKeys.includes('sourceId') ||
        !outcomeKeys.includes('kind') ||
        !outcomeKeys.includes('errorCode')
      ) {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      const errCode = outcome['errorCode'];
      if (errCode !== 'TRANSPORT_FAILURE' && errCode !== 'INVALID_SOURCE_RESPONSE') {
        throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
      }

      validatedOutcomes.push(
        Object.freeze({
          sourceId: expectedSource,
          kind: 'SOURCE_FAILURE',
          errorCode: errCode,
        })
      );
    } else {
      throw new LocalEvidenceSelectionError('INVALID_RETRIEVAL_RESULT');
    }
  }

  return Object.freeze({
    query: queryVal,
    requestedSources: Object.freeze(validatedSources),
    outcomes: Object.freeze(validatedOutcomes),
  });
}

export function validateLocalEvidenceSelectionRequest(
  input: unknown
): LocalEvidenceSelectionRequest {
  if (!isPlainObject(input)) {
    throw new LocalEvidenceSelectionError('INVALID_REQUEST');
  }

  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('retrieval') || !keys.includes('maxItems')) {
    throw new LocalEvidenceSelectionError('INVALID_REQUEST');
  }

  const maxItems = input['maxItems'];
  if (
    typeof maxItems !== 'number' ||
    !Number.isInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > MAX_LOCAL_EVIDENCE_ITEMS_LIMIT
  ) {
    throw new LocalEvidenceSelectionError('INVALID_REQUEST');
  }

  const retrieval = validateRetrievalResult(input['retrieval']);

  return Object.freeze({
    retrieval,
    maxItems,
  });
}

export function selectLocalEvidence(
  requestInput: unknown
): LocalEvidenceSelectionResult {
  const validatedRequest = validateLocalEvidenceSelectionRequest(requestInput);
  const { retrieval, maxItems } = validatedRequest;

  const eligibleItems: SelectedEvidenceItem[] = [];

  for (let sourceIdx = 0; sourceIdx < retrieval.outcomes.length; sourceIdx++) {
    const outcome = retrieval.outcomes[sourceIdx];
    if (outcome.kind === 'VALID_RESULTS') {
      const items = outcome.value.items;
      for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
        const item = items[itemIdx];
        const selectedItem: SelectedEvidenceItem = Object.freeze({
          sourceId: item.sourceId,
          itemId: item.itemId,
          authority: item.authority,
          title: item.title,
          excerpt: item.excerpt,
          sourceUrl: item.sourceUrl,
          provenance: item.provenance,
          originalSourceOrder: sourceIdx,
          originalItemOrder: itemIdx,
        });
        eligibleItems.push(selectedItem);
      }
    }
  }

  const totalEligibleItems = eligibleItems.length;

  if (totalEligibleItems === 0) {
    return Object.freeze({
      kind: 'NO_EVIDENCE' as const,
      query: retrieval.query,
      selectedItems: Object.freeze([]) as readonly [],
      totalEligibleItems: 0 as const,
    });
  }

  const selectedItems = eligibleItems.slice(0, maxItems);
  const truncated = totalEligibleItems > selectedItems.length;

  return Object.freeze({
    kind: 'SELECTED_EVIDENCE' as const,
    query: retrieval.query,
    selectedItems: Object.freeze(selectedItems),
    totalEligibleItems,
    truncated,
  });
}

export const executeLocalEvidenceSelection = selectLocalEvidence;
