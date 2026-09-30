import {
  type PEIAAdvisoryResult,
  validatePEIAAdvisoryResult,
} from './advisoryResultContract';

export interface AdvisoryResultUploadRequest {
  readonly result: PEIAAdvisoryResult;
}

export interface AdvisoryResultUploadAccepted {
  readonly ok: true;
  readonly taskId: string;
}

export type AdvisoryResultUploadResponse = {
  readonly kind: 'ACCEPTED';
  readonly value: AdvisoryResultUploadAccepted;
};

export type AdvisoryResultUploadContractErrorCode =
  | 'INVALID_UPLOAD_REQUEST'
  | 'INVALID_UPLOAD_RESPONSE';

const ERROR_MESSAGES: Record<AdvisoryResultUploadContractErrorCode, string> = {
  INVALID_UPLOAD_REQUEST: 'Invalid PEIA advisory result upload request.',
  INVALID_UPLOAD_RESPONSE: 'Invalid PEIA advisory result upload response.',
};

export class AdvisoryResultUploadContractError extends Error {
  readonly code: AdvisoryResultUploadContractErrorCode;

  constructor(code: AdvisoryResultUploadContractErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AdvisoryResultUploadContractError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createAdvisoryResultUploadRequest(
  result: PEIAAdvisoryResult
): AdvisoryResultUploadRequest {
  try {
    validatePEIAAdvisoryResult(result);
  } catch {
    throw new AdvisoryResultUploadContractError('INVALID_UPLOAD_REQUEST');
  }
  return {
    result,
  };
}

export function validateAdvisoryResultUploadRequest(
  input: unknown
): AdvisoryResultUploadRequest {
  if (!isPlainObject(input)) {
    throw new AdvisoryResultUploadContractError('INVALID_UPLOAD_REQUEST');
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'result') {
    throw new AdvisoryResultUploadContractError('INVALID_UPLOAD_REQUEST');
  }
  try {
    validatePEIAAdvisoryResult(input.result);
  } catch {
    throw new AdvisoryResultUploadContractError('INVALID_UPLOAD_REQUEST');
  }
  return input as unknown as AdvisoryResultUploadRequest;
}

export function parseAdvisoryResultUploadResponse(
  input: unknown
): AdvisoryResultUploadResponse {
  if (!isPlainObject(input)) {
    throw new AdvisoryResultUploadContractError('INVALID_UPLOAD_RESPONSE');
  }
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('ok') || !keys.includes('taskId')) {
    throw new AdvisoryResultUploadContractError('INVALID_UPLOAD_RESPONSE');
  }
  if (input.ok !== true) {
    throw new AdvisoryResultUploadContractError('INVALID_UPLOAD_RESPONSE');
  }
  if (
    typeof input.taskId !== 'string' ||
    input.taskId.length === 0 ||
    input.taskId !== input.taskId.trim()
  ) {
    throw new AdvisoryResultUploadContractError('INVALID_UPLOAD_RESPONSE');
  }
  return {
    kind: 'ACCEPTED',
    value: input as unknown as AdvisoryResultUploadAccepted,
  };
}
