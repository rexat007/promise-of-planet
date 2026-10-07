import {
  ReconciledAdvisoryResultIntake,
} from './advisoryResultTaskReconciliationBoundary';
import { AITaskStatus, type AIReviewTask } from '../types/aiTask';
import {
  VerifiedMachinePrincipal,
  PEIAMachineCapability,
} from './machineAuthorizationBoundary';
import {
  AdvisoryResultIntakeResult,
  validateAdvisoryResultIntakeRequest,
} from './advisoryResultIntakeContract';
import { validateAIReviewTask } from './aiTaskValidator';

export type AdvisoryResultPersistenceErrorCode =
  | 'INVALID_EXISTING_RECORD'
  | 'TASK_IDENTITY_MISMATCH'
  | 'RESULT_CONFLICT';

export interface ReconciledAdvisoryResultPersistenceRecord {
  readonly taskId: string;
  readonly reconciledTask: AIReviewTask;
  readonly principal: VerifiedMachinePrincipal;
  readonly advisoryResult: AdvisoryResultIntakeResult;
}

export interface AdvisoryResultRepository {
  findByTaskId(taskId: string): Promise<unknown | null>;
  save(record: ReconciledAdvisoryResultPersistenceRecord): Promise<void>;
}

export class AdvisoryResultPersistenceError extends Error {
  constructor(
    public readonly code: AdvisoryResultPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AdvisoryResultPersistenceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type AdvisoryResultPersistenceDisposition = 'STORED' | 'ALREADY_IDENTICAL';

export interface AdvisoryResultPersistenceResult {
  readonly taskId: string;
  readonly disposition: AdvisoryResultPersistenceDisposition;
}

function isAdvisoryResultEqual(
  a: AdvisoryResultIntakeResult,
  b: AdvisoryResultIntakeResult
): boolean {
  if (a.schemaVersion !== b.schemaVersion) {
    return false;
  }

  if (a.humanReviewRequired !== b.humanReviewRequired) {
    return false;
  }

  if (
    a.task.taskId !== b.task.taskId ||
    a.task.taskType !== b.task.taskType ||
    a.task.target.targetType !== b.task.target.targetType ||
    a.task.target.targetId !== b.task.target.targetId ||
    a.task.target.sourceUpdatedAt !== b.task.target.sourceUpdatedAt
  ) {
    return false;
  }

  if (a.assessment.summary !== b.assessment.summary) {
    return false;
  }

  if (a.assessment.findings.length !== b.assessment.findings.length) {
    return false;
  }

  for (let i = 0; i < a.assessment.findings.length; i++) {
    const fA = a.assessment.findings[i];
    const fB = b.assessment.findings[i];

    if (
      fA.code !== fB.code ||
      fA.message !== fB.message ||
      fA.severity !== fB.severity
    ) {
      return false;
    }

    if (fA.evidenceIds.length !== fB.evidenceIds.length) {
      return false;
    }
    for (let j = 0; j < fA.evidenceIds.length; j++) {
      if (fA.evidenceIds[j] !== fB.evidenceIds[j]) {
        return false;
      }
    }
  }

  if (a.recommendations.length !== b.recommendations.length) {
    return false;
  }
  for (let i = 0; i < a.recommendations.length; i++) {
    if (a.recommendations[i] !== b.recommendations[i]) {
      return false;
    }
  }

  if (a.uncertainties.length !== b.uncertainties.length) {
    return false;
  }
  for (let i = 0; i < a.uncertainties.length; i++) {
    if (a.uncertainties[i] !== b.uncertainties[i]) {
      return false;
    }
  }

  if (a.limitations.length !== b.limitations.length) {
    return false;
  }
  for (let i = 0; i < a.limitations.length; i++) {
    if (a.limitations[i] !== b.limitations[i]) {
      return false;
    }
  }

  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === null) return b === null;
  if (typeof a === 'string') return typeof b === 'string' && a === b;
  if (typeof a === 'boolean') return typeof b === 'boolean' && a === b;
  if (typeof a === 'number') {
    return Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b) && a === b;
  }

  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!isDeepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

function validateExistingPrincipal(principal: unknown): VerifiedMachinePrincipal {
  if (
    typeof principal !== 'object' ||
    principal === null ||
    Array.isArray(principal) ||
    !isPlainObject(principal)
  ) {
    throw new AdvisoryResultPersistenceError(
      'INVALID_EXISTING_RECORD',
      'Existing record principal snapshot is invalid.'
    );
  }

  const p = principal as Record<string, unknown>;
  const expectedKeys = ['principalId', 'isActive', 'capabilities'];
  const actualKeys = Object.keys(p);

  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every(k => Object.prototype.hasOwnProperty.call(p, k))
  ) {
    throw new AdvisoryResultPersistenceError(
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
    !p.capabilities.every(cap => typeof cap === 'string' && validCapabilities.includes(cap)) ||
    !p.capabilities.includes(PEIAMachineCapability.SUBMIT_ADVISORY_RESULT)
  ) {
    throw new AdvisoryResultPersistenceError(
      'INVALID_EXISTING_RECORD',
      'Existing record principal snapshot is invalid.'
    );
  }

  return principal as VerifiedMachinePrincipal;
}

function validateExistingRecord(
  taskId: string,
  record: unknown
): ReconciledAdvisoryResultPersistenceRecord {
  if (typeof record !== 'object' || record === null || Array.isArray(record) || !isPlainObject(record)) {
    throw new AdvisoryResultPersistenceError('INVALID_EXISTING_RECORD', 'Malformed record.');
  }

  const r = record as Record<string, unknown>;
  const expectedKeys = ['taskId', 'reconciledTask', 'principal', 'advisoryResult'];
  const actualKeys = Object.keys(r);

  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every(k => Object.prototype.hasOwnProperty.call(r, k))
  ) {
    throw new AdvisoryResultPersistenceError('INVALID_EXISTING_RECORD', 'Record has invalid shape.');
  }

  if (typeof r.taskId !== 'string' || r.taskId.trim() === '') {
    throw new AdvisoryResultPersistenceError('INVALID_EXISTING_RECORD', 'Malformed taskId.');
  }

  if (r.taskId !== taskId) {
    throw new AdvisoryResultPersistenceError('TASK_IDENTITY_MISMATCH', 'TaskId mismatch.');
  }

  const principal = validateExistingPrincipal(r.principal);
  
  let reconciledTask: AIReviewTask;
  try {
    reconciledTask = validateAIReviewTask(r.reconciledTask);
  } catch {
      throw new AdvisoryResultPersistenceError('INVALID_EXISTING_RECORD', 'Malformed task.');
  }

  if (
    typeof r.advisoryResult !== 'object' ||
    r.advisoryResult === null ||
    !isPlainObject(r.advisoryResult)
  ) {
    throw new AdvisoryResultPersistenceError(
      'INVALID_EXISTING_RECORD',
      'Existing advisory result is malformed.'
    );
  }
  
  try {
    validateAdvisoryResultIntakeRequest({ result: r.advisoryResult });
  } catch (e) {
    throw new AdvisoryResultPersistenceError(
      'INVALID_EXISTING_RECORD',
      'Existing advisory result is malformed.'
    );
  }
  
  const advisoryResult = r.advisoryResult as unknown as AdvisoryResultIntakeResult;

  // Internal Task identity consistency check (stored task vs stored result task)
  if (
    reconciledTask.taskId !== taskId ||
    reconciledTask.taskId !== advisoryResult.task.taskId ||
    reconciledTask.taskType !== advisoryResult.task.taskType ||
    reconciledTask.target.targetType !== advisoryResult.task.target.targetType ||
    reconciledTask.target.targetId !== advisoryResult.task.target.targetId ||
    reconciledTask.target.sourceUpdatedAt !== advisoryResult.task.target.sourceUpdatedAt
  ) {
    throw new AdvisoryResultPersistenceError('TASK_IDENTITY_MISMATCH', 'Internal task identity mismatch.');
  }

  return {
    taskId: r.taskId,
    reconciledTask,
    principal,
    advisoryResult,
  };
}

function isTaskReferenceEqual(a: { taskId: string; taskType: string; target: { targetType: string; targetId: string; sourceUpdatedAt: string } }, b: { taskId: string; taskType: string; target: { targetType: string; targetId: string; sourceUpdatedAt: string } }): boolean {
  return (
    a.taskId === b.taskId &&
    a.taskType === b.taskType &&
    a.target.targetType === b.target.targetType &&
    a.target.targetId === b.target.targetId &&
    a.target.sourceUpdatedAt === b.target.sourceUpdatedAt
  );
}

function isTaskEqual(a: AIReviewTask, b: AIReviewTask): boolean {
  if (!isTaskReferenceEqual(a, b) || a.status !== b.status || a.createdAt !== b.createdAt) {
    return false;
  }
  return isDeepEqual(a.contentSnapshot, b.contentSnapshot);
}

function areCapabilitiesEqual(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const cap of setA) {
    if (!setB.has(cap)) return false;
  }
  return true;
}

export async function persistReconciledAdvisoryResult(
  intake: ReconciledAdvisoryResultIntake,
  repository: AdvisoryResultRepository
): Promise<AdvisoryResultPersistenceResult> {
  const record: ReconciledAdvisoryResultPersistenceRecord = {
    taskId: intake.task.taskId,
    reconciledTask: intake.task,
    principal: intake.authorizedIntake.principal,
    advisoryResult: intake.authorizedIntake.request.result,
  };

  const rawExisting = await repository.findByTaskId(record.taskId);

  if (rawExisting !== null) {
    const existing = validateExistingRecord(record.taskId, rawExisting);

    // Identity verification against CURRENT canonical task
    if (
      !isTaskReferenceEqual(existing.reconciledTask, intake.task) ||
      !isTaskReferenceEqual(existing.advisoryResult.task, intake.task)
    ) {
      throw new AdvisoryResultPersistenceError(
        'TASK_IDENTITY_MISMATCH',
        'Stored task reference does not match current authoritative task.'
      );
    }

    // Structural Equality Check
    const isPrincipalEqual = 
      existing.principal.principalId === record.principal.principalId &&
      existing.principal.isActive === record.principal.isActive &&
      areCapabilitiesEqual(existing.principal.capabilities, record.principal.capabilities);

    const isTaskEqualResult = isTaskEqual(existing.reconciledTask, record.reconciledTask);
    const isResultEqual = isAdvisoryResultEqual(existing.advisoryResult, record.advisoryResult);

    if (isPrincipalEqual && isTaskEqualResult && isResultEqual) {
      return { taskId: record.taskId, disposition: 'ALREADY_IDENTICAL' };
    }
    
    throw new AdvisoryResultPersistenceError(
      'RESULT_CONFLICT',
      'Divergent advisory result for taskId.'
    );
  }

  await repository.save(record);
  return { taskId: record.taskId, disposition: 'STORED' };
}
