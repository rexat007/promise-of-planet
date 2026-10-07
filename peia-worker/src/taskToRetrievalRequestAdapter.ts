import {
  type MultiSourceRetrievalRequest,
  SUPPORTED_KNOWLEDGE_SOURCES,
  PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH,
} from './multiSourceKnowledgeRetrievalRouter';

export type TaskToRetrievalAdapterErrorCode =
  | 'INVALID_TASK_PAYLOAD'
  | 'MISSING_RETRIEVAL_QUERY'
  | 'INVALID_RETRIEVAL_QUERY';

const ERROR_MESSAGES: Record<TaskToRetrievalAdapterErrorCode, string> = {
  INVALID_TASK_PAYLOAD: 'Task payload is malformed or not a valid object.',
  MISSING_RETRIEVAL_QUERY: 'contentSnapshot is missing required retrievalQuery field.',
  INVALID_RETRIEVAL_QUERY: 'retrievalQuery is invalid (must be a non-empty trimmed string <= 500 characters with no control characters).',
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
 * - Targets the canonical supported sources: ['EPA', 'NOAA'].
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

  return {
    query: retrievalQuery,
    sources: SUPPORTED_KNOWLEDGE_SOURCES,
  };
}
