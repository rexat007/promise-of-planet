import { AITaskStatus, type AIReviewTask } from '../types/aiTask';
import {
  VerifiedMachinePrincipal,
  PEIAMachineCapability,
} from './machineAuthorizationBoundary';
import {
  CanonicalNonAdvisoryOutcome,
  validateNonAdvisoryOutcomeIntakeRequest,
  SourceFailureRecord,
  NonAdvisoryOutcomeKind,
} from './nonAdvisoryOutcomeIntakeContract';
import { validateAIReviewTask } from './aiTaskValidator';

export type NonAdvisoryOutcomePersistenceErrorCode =
  | 'INVALID_EXISTING_RECORD'
  | 'TASK_IDENTITY_MISMATCH'
  | 'RESULT_CONFLICT'
  | 'TASK_STATUS_INCONSISTENT';

export interface ReconciledNonAdvisoryOutcomePersistenceRecord {
  readonly taskId: string;
  readonly reconciledTask: AIReviewTask;
  readonly principal: VerifiedMachinePrincipal;
  readonly nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome;
  readonly convergedStatus: typeof AITaskStatus.Completed | typeof AITaskStatus.Failed;
  readonly convergedAt: string;
}

export interface NonAdvisoryOutcomeSaveResult {
  readonly disposition: NonAdvisoryOutcomePersistenceDisposition;
}

export interface NonAdvisoryOutcomeRepository {
  findByTaskId(taskId: string): Promise<unknown | null>;
  saveWithTaskConvergence(
    record: ReconciledNonAdvisoryOutcomePersistenceRecord
  ): Promise<NonAdvisoryOutcomeSaveResult | void>;
}

export class NonAdvisoryOutcomePersistenceError extends Error {
  constructor(
    public readonly code: NonAdvisoryOutcomePersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'NonAdvisoryOutcomePersistenceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type NonAdvisoryOutcomePersistenceDisposition = 'STORED' | 'ALREADY_IDENTICAL';

export interface NonAdvisoryOutcomePersistenceResult {
  readonly taskId: string;
  readonly disposition: NonAdvisoryOutcomePersistenceDisposition;
  readonly convergedStatus: typeof AITaskStatus.Completed | typeof AITaskStatus.Failed;
}

export function computeConvergedTaskStatus(
  kind: NonAdvisoryOutcomeKind
): typeof AITaskStatus.Completed | typeof AITaskStatus.Failed {
  if (kind === 'ABSTAINED') {
    return AITaskStatus.Completed;
  }
  return AITaskStatus.Failed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSourceFailuresEqual(
  a: readonly SourceFailureRecord[] | undefined,
  b: readonly SourceFailureRecord[] | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== 2 || b.length !== 2) return false;

  const aEpa = a.find((s) => s.sourceId === 'EPA');
  const bEpa = b.find((s) => s.sourceId === 'EPA');
  if (!aEpa || !bEpa || aEpa.errorCode !== bEpa.errorCode) return false;

  const aNoaa = a.find((s) => s.sourceId === 'NOAA');
  const bNoaa = b.find((s) => s.sourceId === 'NOAA');
  if (!aNoaa || !bNoaa || aNoaa.errorCode !== bNoaa.errorCode) return false;

  return true;
}

export function isOutcomeEqual(
  a: CanonicalNonAdvisoryOutcome,
  b: CanonicalNonAdvisoryOutcome
): boolean {
  if (a.taskId !== b.taskId) return false;
  if (a.kind !== b.kind) return false;
  if (a.reason !== b.reason) return false;
  if (a.modelAttempts !== b.modelAttempts) return false;
  if (a.createdAt !== b.createdAt) return false;
  if (a.detail !== b.detail) return false;
  if (a.exitCode !== b.exitCode) return false;
  if (!isSourceFailuresEqual(a.sourceFailures, b.sourceFailures)) return false;
  return true;
}

function validateExistingPrincipal(principal: unknown): VerifiedMachinePrincipal {
  if (!isPlainObject(principal)) {
    throw new NonAdvisoryOutcomePersistenceError(
      'INVALID_EXISTING_RECORD',
      'Existing record principal snapshot is invalid.'
    );
  }

  const p = principal as Record<string, unknown>;
  const expectedKeys = ['principalId', 'isActive', 'capabilities'];
  const actualKeys = Object.keys(p);

  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every((k) => Object.prototype.hasOwnProperty.call(p, k))
  ) {
    throw new NonAdvisoryOutcomePersistenceError(
      'INVALID_EXISTING_RECORD',
      'Existing record principal snapshot has invalid shape.'
    );
  }

  const validCapabilities = Object.values(PEIAMachineCapability) as string[];

  if (
    typeof p.principalId !== 'string' ||
    p.principalId.trim() === '' ||
    p.isActive !== true ||
    !Array.isArray(p.capabilities) ||
    new Set(p.capabilities).size !== p.capabilities.length ||
    !p.capabilities.every((cap) => typeof cap === 'string' && validCapabilities.includes(cap)) ||
    !p.capabilities.includes(PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME)
  ) {
    throw new NonAdvisoryOutcomePersistenceError(
      'INVALID_EXISTING_RECORD',
      'Existing record principal snapshot is invalid.'
    );
  }

  return principal as unknown as VerifiedMachinePrincipal;
}

export function validateExistingRecord(
  taskId: string,
  record: unknown
): ReconciledNonAdvisoryOutcomePersistenceRecord {
  if (!isPlainObject(record)) {
    throw new NonAdvisoryOutcomePersistenceError('INVALID_EXISTING_RECORD', 'Malformed record.');
  }

  const r = record as Record<string, unknown>;
  const expectedKeys = [
    'taskId',
    'reconciledTask',
    'principal',
    'nonAdvisoryOutcome',
    'convergedStatus',
    'convergedAt',
  ];
  const actualKeys = Object.keys(r);

  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every((k) => Object.prototype.hasOwnProperty.call(r, k))
  ) {
    throw new NonAdvisoryOutcomePersistenceError('INVALID_EXISTING_RECORD', 'Record has invalid shape.');
  }

  if (typeof r.taskId !== 'string' || r.taskId.trim() === '') {
    throw new NonAdvisoryOutcomePersistenceError('INVALID_EXISTING_RECORD', 'Malformed taskId.');
  }

  if (r.taskId !== taskId) {
    throw new NonAdvisoryOutcomePersistenceError('TASK_IDENTITY_MISMATCH', 'TaskId mismatch.');
  }

  const principal = validateExistingPrincipal(r.principal);

  let reconciledTask: AIReviewTask;
  try {
    reconciledTask = validateAIReviewTask(r.reconciledTask);
  } catch {
    throw new NonAdvisoryOutcomePersistenceError('INVALID_EXISTING_RECORD', 'Malformed task.');
  }

  if (!isPlainObject(r.nonAdvisoryOutcome)) {
    throw new NonAdvisoryOutcomePersistenceError('INVALID_EXISTING_RECORD', 'Existing outcome is malformed.');
  }

  try {
    validateNonAdvisoryOutcomeIntakeRequest({ outcome: r.nonAdvisoryOutcome });
  } catch {
    throw new NonAdvisoryOutcomePersistenceError('INVALID_EXISTING_RECORD', 'Existing outcome is malformed.');
  }

  const nonAdvisoryOutcome = r.nonAdvisoryOutcome as unknown as CanonicalNonAdvisoryOutcome;

  if (reconciledTask.taskId !== taskId || nonAdvisoryOutcome.taskId !== taskId) {
    throw new NonAdvisoryOutcomePersistenceError('TASK_IDENTITY_MISMATCH', 'Internal task identity mismatch.');
  }

  const expectedConvergedStatus = computeConvergedTaskStatus(nonAdvisoryOutcome.kind);
  if (r.convergedStatus !== expectedConvergedStatus) {
    throw new NonAdvisoryOutcomePersistenceError('INVALID_EXISTING_RECORD', 'Task status does not match outcome kind.');
  }

  if (typeof r.convergedAt !== 'string' || isNaN(new Date(r.convergedAt as string).getTime())) {
    throw new NonAdvisoryOutcomePersistenceError('INVALID_EXISTING_RECORD', 'Invalid convergedAt timestamp.');
  }

  return {
    taskId: r.taskId,
    reconciledTask,
    principal,
    nonAdvisoryOutcome,
    convergedStatus: expectedConvergedStatus,
    convergedAt: r.convergedAt as string,
  };
}

export async function persistNonAdvisoryOutcome(
  taskId: string,
  authoritativeTask: AIReviewTask,
  principal: VerifiedMachinePrincipal,
  outcome: CanonicalNonAdvisoryOutcome,
  repository: NonAdvisoryOutcomeRepository
): Promise<NonAdvisoryOutcomePersistenceResult> {
  if (taskId !== authoritativeTask.taskId || taskId !== outcome.taskId) {
    throw new NonAdvisoryOutcomePersistenceError('TASK_IDENTITY_MISMATCH', 'TaskId mismatch.');
  }

  const convergedStatus = computeConvergedTaskStatus(outcome.kind);
  const convergedAt = new Date().toISOString();

  const record: ReconciledNonAdvisoryOutcomePersistenceRecord = {
    taskId,
    reconciledTask: authoritativeTask,
    principal,
    nonAdvisoryOutcome: outcome,
    convergedStatus,
    convergedAt,
  };

  const saveResult = await repository.saveWithTaskConvergence(record);

  return {
    taskId,
    disposition: saveResult?.disposition ?? 'STORED',
    convergedStatus,
  };
}
