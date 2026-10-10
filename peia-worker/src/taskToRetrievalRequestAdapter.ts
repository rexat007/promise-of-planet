import {
  type MultiSourceRetrievalRequest,
  type PEIAKnowledgeSourceId,
  SUPPORTED_KNOWLEDGE_SOURCES,
  PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH,
} from './multiSourceKnowledgeRetrievalRouter';

export type TaskToRetrievalAdapterErrorCode =
  | 'INVALID_TASK_PAYLOAD'
  | 'MISSING_RETRIEVAL_QUERY'
  | 'INVALID_RETRIEVAL_QUERY'
  | 'INVALID_RETRIEVAL_SOURCES'
  | 'UNSUPPORTED_RETRIEVAL_SOURCE';

const ERROR_MESSAGES: Record<TaskToRetrievalAdapterErrorCode, string> = {
  INVALID_TASK_PAYLOAD: 'Task payload is malformed or not a valid object.',
  MISSING_RETRIEVAL_QUERY: 'contentSnapshot is missing required retrievalQuery field.',
  INVALID_RETRIEVAL_QUERY: 'retrievalQuery is invalid (must be a non-empty trimmed string <= 500 characters with no control characters).',
  INVALID_RETRIEVAL_SOURCES: 'retrievalSources is invalid (must be a non-empty array of unique supported knowledge sources).',
  UNSUPPORTED_RETRIEVAL_SOURCE: 'Unsupported knowledge source requested in retrievalSources.',
};

export class TaskToRetrievalAdapterError extends Error {
  readonly code: TaskToRetrievalAdapterErrorCode;

  constructor(code: TaskToRetrievalAdapterErrorCode, message: string = ERROR_MESSAGES[code]) {
    super(message);
    this.name = 'TaskToRetrievalAdapterError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts a MultiSourceRetrievalRequest from an AIReviewTask's contentSnapshot.
 * 
 * Rules:
 * - Uses ONLY contentSnapshot.retrievalQuery.
 * - No heuristic fallbacks to title, body, text, or claims.
 * - Fails closed if retrievalQuery is absent, non-string, untrimmed, empty, > 500 chars, or contains control chars.
 * - When contentSnapshot.retrievalSources is absent: preserves legacy behavior, targeting canonical SUPPORTED_KNOWLEDGE_SOURCES (['EPA', 'NOAA']).
 * - When contentSnapshot.retrievalSources is present: validates as a non-empty array of unique canonical supported knowledge sources.
 */
export function extractRetrievalRequestFromTask(task: unknown): MultiSourceRetrievalRequest {
  if (!isPlainObject(task)) {
    throw new TaskToRetrievalAdapterError('INVALID_TASK_PAYLOAD');
  }

  const { contentSnapshot } = task;
  if (!isPlainObject(contentSnapshot)) {
    throw new TaskToRetrievalAdapterError('INVALID_TASK_PAYLOAD', 'contentSnapshot must be a plain object.');
  }

  if (!('retrievalQuery' in contentSnapshot)) {
    throw new TaskToRetrievalAdapterError('MISSING_RETRIEVAL_QUERY');
  }

  const { retrievalQuery } = contentSnapshot;
  if (typeof retrievalQuery !== 'string') {
    throw new TaskToRetrievalAdapterError('INVALID_RETRIEVAL_QUERY', 'retrievalQuery must be a string.');
  }

  if (retrievalQuery.length === 0) {
    throw new TaskToRetrievalAdapterError('INVALID_RETRIEVAL_QUERY', 'retrievalQuery cannot be empty.');
  }

  if (retrievalQuery !== retrievalQuery.trim()) {
    throw new TaskToRetrievalAdapterError(
      'INVALID_RETRIEVAL_QUERY',
      'retrievalQuery must be already trimmed without leading or trailing whitespace.'
    );
  }

  if (retrievalQuery.length > PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH) {
    throw new TaskToRetrievalAdapterError(
      'INVALID_RETRIEVAL_QUERY',
      `retrievalQuery length exceeds maximum allowed length of ${PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH} characters.`
    );
  }

  if (CONTROL_CHAR_REGEX.test(retrievalQuery)) {
    throw new TaskToRetrievalAdapterError('INVALID_RETRIEVAL_QUERY', 'retrievalQuery must not contain control characters.');
  }

  let sources: readonly PEIAKnowledgeSourceId[] = SUPPORTED_KNOWLEDGE_SOURCES;

  if ('retrievalSources' in contentSnapshot && contentSnapshot.retrievalSources !== undefined) {
    const rawSources = contentSnapshot.retrievalSources;
    if (!Array.isArray(rawSources)) {
      throw new TaskToRetrievalAdapterError('INVALID_RETRIEVAL_SOURCES', 'retrievalSources must be an array.');
    }

    if (rawSources.length === 0) {
      throw new TaskToRetrievalAdapterError('INVALID_RETRIEVAL_SOURCES', 'retrievalSources cannot be empty.');
    }

    if (rawSources.length > SUPPORTED_KNOWLEDGE_SOURCES.length) {
      throw new TaskToRetrievalAdapterError(
        'INVALID_RETRIEVAL_SOURCES',
        `retrievalSources cannot contain more than ${SUPPORTED_KNOWLEDGE_SOURCES.length} sources.`
      );
    }

    const seen = new Set<string>();
    const validatedSources: PEIAKnowledgeSourceId[] = [];

    for (const src of rawSources) {
      if (typeof src !== 'string') {
        throw new TaskToRetrievalAdapterError('INVALID_RETRIEVAL_SOURCES', 'retrievalSources items must be strings.');
      }

      if (src.length === 0) {
        throw new TaskToRetrievalAdapterError('INVALID_RETRIEVAL_SOURCES', 'retrievalSources items cannot be empty strings.');
      }

      if (src !== src.trim()) {
        throw new TaskToRetrievalAdapterError(
          'INVALID_RETRIEVAL_SOURCES',
          'retrievalSources items must not have leading or trailing whitespace.'
        );
      }

      if (seen.has(src)) {
        throw new TaskToRetrievalAdapterError('INVALID_RETRIEVAL_SOURCES', `Duplicate retrieval source: ${src}.`);
      }
      seen.add(src);

      if (!SUPPORTED_KNOWLEDGE_SOURCES.includes(src as PEIAKnowledgeSourceId)) {
        throw new TaskToRetrievalAdapterError('UNSUPPORTED_RETRIEVAL_SOURCE', `Unsupported retrieval source: ${src}.`);
      }

      validatedSources.push(src as PEIAKnowledgeSourceId);
    }

    sources = Object.freeze(validatedSources);
  }

  return {
    query: retrievalQuery,
    sources,
  };
}
