import {
  type DurableNonAdvisoryOutcomeRecord,
  validateDurableNonAdvisoryOutcomeRecord,
} from './localNonAdvisoryOutcomeContract';

export type NonAdvisoryOutcomeReportContractErrorCode =
  | 'INVALID_REPORT_REQUEST'
  | 'INVALID_REPORT_RESPONSE';

export class NonAdvisoryOutcomeReportContractError extends Error {
  readonly code: NonAdvisoryOutcomeReportContractErrorCode;

  constructor(
    code: NonAdvisoryOutcomeReportContractErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'NonAdvisoryOutcomeReportContractError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface NonAdvisoryOutcomeReportRequest {
  readonly outcome: DurableNonAdvisoryOutcomeRecord;
}

export function createNonAdvisoryOutcomeReportRequest(
  outcome: DurableNonAdvisoryOutcomeRecord
): NonAdvisoryOutcomeReportRequest {
  validateDurableNonAdvisoryOutcomeRecord(outcome);
  return { outcome };
}

export interface NonAdvisoryOutcomeReportResponse {
  readonly ok: true;
  readonly taskId: string;
}

export function parseNonAdvisoryOutcomeReportResponse(
  response: unknown
): NonAdvisoryOutcomeReportResponse {
  if (
    typeof response !== 'object' ||
    response === null ||
    Object.keys(response).length !== 2 ||
    !( 'ok' in response) ||
    (response as any).ok !== true ||
    typeof (response as any).taskId !== 'string' ||
    (response as any).taskId.trim().length === 0 ||
    (response as any).taskId !== (response as any).taskId.trim()
  ) {
    throw new NonAdvisoryOutcomeReportContractError('INVALID_REPORT_RESPONSE', 'Invalid non-advisory outcome report response');
  }
  return response as NonAdvisoryOutcomeReportResponse;
}

export function validateNonAdvisoryOutcomeReportRequest(
  input: unknown
): NonAdvisoryOutcomeReportRequest {
  if (
    typeof input !== 'object' ||
    input === null ||
    Object.keys(input).length !== 1 ||
    !('outcome' in input)
  ) {
    throw new NonAdvisoryOutcomeReportContractError('INVALID_REPORT_REQUEST', 'Invalid non-advisory outcome report request');
  }
  validateDurableNonAdvisoryOutcomeRecord((input as any).outcome);
  return input as NonAdvisoryOutcomeReportRequest;
}
