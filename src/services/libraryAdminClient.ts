import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import type { 
  LibraryDocument, 
  LibraryRightsStatus,
  LibraryOrganization,
  LibrarySource
} from '../types/library';
import type {
  LibraryIntakeRecord,
  LibraryIntakeStatus,
  SubmitLibraryIntakeInput
} from '../../functions/src/shared/libraryContract';
import {
  AIReviewTargetType,
  AIReviewSeverity,
  PEIALibraryPreparationInputBasis,
  PEIALibrarySuggestedDocumentType,
  type PEIALibraryPreparationAdvisoryPayload,
  type ReviewTargetIdentity,
} from '../types/aiReview';
import {
  AITaskStatus,
  AITaskType,
  type AIReviewTask,
} from '../types/aiTask';
import type {
  AdvisoryResultIntakeFinding,
  AdvisoryResultIntakeResult,
  AdvisoryResultIntakeTaskReference,
} from '../../functions/src/peia/advisoryResultIntakeContract';
import {
  NonAdvisoryOutcomeKindValues,
  type CanonicalNonAdvisoryOutcome,
  type NonAdvisoryOutcomeKind,
  type SourceFailureRecord,
} from '../../functions/src/peia/nonAdvisoryOutcomeIntakeContract';
import type { WorkflowState } from '../types/workflow';

export {
  AIReviewTargetType,
  AIReviewSeverity,
  PEIALibraryPreparationInputBasis,
  PEIALibrarySuggestedDocumentType,
  AITaskStatus,
  AITaskType,
  NonAdvisoryOutcomeKindValues,
  type PEIALibraryPreparationAdvisoryPayload,
  type ReviewTargetIdentity,
  type AIReviewTask,
  type AdvisoryResultIntakeFinding,
  type AdvisoryResultIntakeResult,
  type AdvisoryResultIntakeTaskReference,
  type CanonicalNonAdvisoryOutcome,
  type NonAdvisoryOutcomeKind,
  type SourceFailureRecord,
};

export type PeiaTaskEnqueueDisposition = 'CREATED' | 'ALREADY_EXISTS';

export type LibraryIntakePeiaReviewStatus = 'NotRequested' | AITaskStatus;

export type LibraryIntakePeiaEnqueueDisposition = PeiaTaskEnqueueDisposition;

export interface RequestIntakePeiaPreparationPayload {
  readonly action: 'requestIntakePeiaPreparation';
  readonly intakeId: string;
  readonly expectedUpdatedAt: string;
}

export interface GetIntakePeiaPreparationStatusPayload {
  readonly action: 'getIntakePeiaPreparationStatus';
  readonly intakeId: string;
  readonly taskId?: string;
}

export interface SanitizedLibraryIntakePeiaPreparationStatusDto {
  readonly status: 'NotRequested' | AITaskStatus;
  readonly taskId: string;
  readonly targetType: typeof AIReviewTargetType.LibraryIntake;
  readonly targetId: string;
  readonly intakeId: string;
  readonly currentSourceUpdatedAt: string;
  readonly taskSourceUpdatedAt: string | null;
  readonly isStale: boolean;
  readonly inputBasis: PEIALibraryPreparationInputBasis | null;
  readonly task: AIReviewTask | null;
  readonly advisoryResult: AdvisoryResultIntakeResult | null;
  readonly libraryPreparation: PEIALibraryPreparationAdvisoryPayload | null;
  readonly nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome | null;
}

export type LibraryIntakePeiaPreparationStatusDto =
  SanitizedLibraryIntakePeiaPreparationStatusDto;

export interface GetLibraryIntakePeiaPreparationStatusResponseDto
  extends SanitizedLibraryIntakePeiaPreparationStatusDto {
  readonly preparationStatus: SanitizedLibraryIntakePeiaPreparationStatusDto;
  readonly reviewStatus: SanitizedLibraryIntakePeiaPreparationStatusDto;
}

export interface RequestLibraryIntakePeiaPreparationResponseDto {
  readonly disposition: PeiaTaskEnqueueDisposition;
  readonly documentId: string;
  readonly taskId: string;
  readonly intakeId: string;
  readonly inputBasis: PEIALibraryPreparationInputBasis;
  readonly task: AIReviewTask;
  readonly status: 'NotRequested' | AITaskStatus;
  readonly isStale: boolean;
  readonly advisoryResult: AdvisoryResultIntakeResult | null;
  readonly libraryPreparation: PEIALibraryPreparationAdvisoryPayload | null;
  readonly nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome | null;
  readonly preparationStatus: SanitizedLibraryIntakePeiaPreparationStatusDto;
  readonly reviewStatus: SanitizedLibraryIntakePeiaPreparationStatusDto;
}

const CANONICAL_LIBRARY_PREPARATION_KEYS: readonly (keyof PEIALibraryPreparationAdvisoryPayload)[] =
  Object.freeze([
    'inputBasis',
    'suggestedTitleAr',
    'suggestedTitleEn',
    'suggestedIssuingOrganization',
    'suggestedDocumentType',
    'suggestedEnvironmentalDomains',
    'suggestedTopicsAr',
    'suggestedTopicsEn',
    'suggestedSummaryAr',
    'suggestedSummaryEn',
    'provenanceObservationsAr',
    'provenanceObservationsEn',
    'uncertaintyNoticesAr',
    'uncertaintyNoticesEn',
  ]);

const ALLOWED_SUGGESTED_DOCUMENT_TYPES: ReadonlySet<string> = new Set(
  Object.values(PEIALibrarySuggestedDocumentType)
);

const ALLOWED_NON_ADVISORY_OUTCOME_KINDS: ReadonlySet<string> = new Set(
  NonAdvisoryOutcomeKindValues
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasAsciiControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value === value.trim() &&
    !hasAsciiControlCharacters(value)
  );
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) => typeof item === 'string' && item.trim().length > 0 && item === item.trim()
    )
  );
}

function isValidIsoTimestampString(value: unknown): value is string {
  return isNonEmptyTrimmedString(value) && !Number.isNaN(Date.parse(value));
}

function validateStrictIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`INVALID_ARGUMENT: ${fieldName} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== value ||
    hasAsciiControlCharacters(trimmed)
  ) {
    throw new Error(
      `INVALID_ARGUMENT: ${fieldName} must be a trimmed single-line identifier without control characters.`
    );
  }
  return trimmed;
}

function validateStrictExpectedUpdatedAt(value: unknown): string {
  const trimmed = validateStrictIdentifier(value, 'expectedUpdatedAt');
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new Error(
      'INVALID_ARGUMENT: expectedUpdatedAt must be a valid ISO-8601 timestamp.'
    );
  }
  return trimmed;
}

function isValidPeiaReviewStatus(
  value: unknown
): value is LibraryIntakePeiaReviewStatus {
  return (
    value === 'NotRequested' ||
    value === AITaskStatus.Pending ||
    value === AITaskStatus.Completed ||
    value === AITaskStatus.Failed
  );
}

function isValidInputBasis(
  value: unknown
): value is PEIALibraryPreparationInputBasis {
  return (
    value === PEIALibraryPreparationInputBasis.MetadataOnly ||
    value === PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata
  );
}

function validateTaskEnvelope(
  rawTask: unknown,
  expectedTaskId: string,
  expectedIntakeId: string,
  expectedSourceUpdatedAt: string,
  expectedStatus: AITaskStatus
): AIReviewTask {
  if (!isPlainObject(rawTask)) {
    throw new Error('INVALID_PEIA_RESPONSE: Missing or invalid task object in PEIA response.');
  }
  if (rawTask.taskId !== expectedTaskId) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: task.taskId (${String(rawTask.taskId)}) does not match status taskId (${expectedTaskId}).`
    );
  }
  if (rawTask.taskType !== AITaskType.CONTENT_REVIEW) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Unsupported task.taskType '${String(rawTask.taskType)}'.`
    );
  }
  if (rawTask.status !== expectedStatus) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: task.status (${String(rawTask.status)}) does not match top-level status (${expectedStatus}).`
    );
  }
  if (!isValidIsoTimestampString(rawTask.createdAt)) {
    throw new Error('INVALID_PEIA_RESPONSE: task.createdAt must be a valid ISO-8601 timestamp.');
  }
  if (!isPlainObject(rawTask.target)) {
    throw new Error('INVALID_PEIA_RESPONSE: Missing task.target object in PEIA response.');
  }
  if (rawTask.target.targetType !== AIReviewTargetType.LibraryIntake) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: task.target.targetType must be '${AIReviewTargetType.LibraryIntake}', got '${String(rawTask.target.targetType)}'.`
    );
  }
  if (rawTask.target.targetId !== expectedIntakeId) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: task.target.targetId (${String(rawTask.target.targetId)}) does not match requested intakeId (${expectedIntakeId}).`
    );
  }
  if (rawTask.target.sourceUpdatedAt !== expectedSourceUpdatedAt) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: task.target.sourceUpdatedAt (${String(rawTask.target.sourceUpdatedAt)}) does not match taskSourceUpdatedAt (${expectedSourceUpdatedAt}).`
    );
  }
  if (!isPlainObject(rawTask.contentSnapshot)) {
    throw new Error('INVALID_PEIA_RESPONSE: task.contentSnapshot must be a plain object.');
  }

  return rawTask as unknown as AIReviewTask;
}

function validateCanonicalLibraryPreparationPayload(
  rawPrep: unknown,
  expectedInputBasis: PEIALibraryPreparationInputBasis
): PEIALibraryPreparationAdvisoryPayload {
  if (!isPlainObject(rawPrep)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Completed PEIA response must include a libraryPreparation object.'
    );
  }

  const keys = Object.keys(rawPrep);
  if (
    keys.length !== CANONICAL_LIBRARY_PREPARATION_KEYS.length ||
    !CANONICAL_LIBRARY_PREPARATION_KEYS.every((k) =>
      Object.prototype.hasOwnProperty.call(rawPrep, k)
    )
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: libraryPreparation does not match the exact 14-field canonical PEIALibraryPreparationAdvisoryPayload contract.'
    );
  }

  if (rawPrep.inputBasis !== expectedInputBasis) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: libraryPreparation.inputBasis (${String(rawPrep.inputBasis)}) does not match status inputBasis (${expectedInputBasis}).`
    );
  }

  if (
    !isNonEmptyTrimmedString(rawPrep.suggestedTitleAr) ||
    !isNonEmptyTrimmedString(rawPrep.suggestedTitleEn) ||
    !isNonEmptyTrimmedString(rawPrep.suggestedIssuingOrganization)
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: libraryPreparation title and issuing organization fields must be non-empty trimmed strings.'
    );
  }

  if (
    typeof rawPrep.suggestedDocumentType !== 'string' ||
    !ALLOWED_SUGGESTED_DOCUMENT_TYPES.has(rawPrep.suggestedDocumentType)
  ) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Invalid suggestedDocumentType '${String(rawPrep.suggestedDocumentType)}' in libraryPreparation.`
    );
  }

  if (
    !isNonEmptyStringArray(rawPrep.suggestedEnvironmentalDomains) ||
    !isNonEmptyStringArray(rawPrep.suggestedTopicsAr) ||
    !isNonEmptyStringArray(rawPrep.suggestedTopicsEn) ||
    !isNonEmptyStringArray(rawPrep.provenanceObservationsAr) ||
    !isNonEmptyStringArray(rawPrep.provenanceObservationsEn) ||
    !isNonEmptyStringArray(rawPrep.uncertaintyNoticesAr) ||
    !isNonEmptyStringArray(rawPrep.uncertaintyNoticesEn)
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: libraryPreparation domain, topic, provenance, and uncertainty arrays must be non-empty string arrays.'
    );
  }

  if (expectedInputBasis === PEIALibraryPreparationInputBasis.MetadataOnly) {
    if (rawPrep.suggestedSummaryAr !== null || rawPrep.suggestedSummaryEn !== null) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: MetadataOnly libraryPreparation must preserve null suggestedSummaryAr and suggestedSummaryEn.'
      );
    }
  } else {
    if (
      !isNonEmptyTrimmedString(rawPrep.suggestedSummaryAr) ||
      !isNonEmptyTrimmedString(rawPrep.suggestedSummaryEn)
    ) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: SuppliedExcerptAndMetadata libraryPreparation must include non-empty suggestedSummaryAr and suggestedSummaryEn.'
      );
    }
  }

  return rawPrep as unknown as PEIALibraryPreparationAdvisoryPayload;
}

function validateAdvisoryResultEnvelope(
  rawAdvisory: unknown,
  expectedTaskId: string,
  expectedIntakeId: string,
  expectedSourceUpdatedAt: string,
  expectedInputBasis: PEIALibraryPreparationInputBasis
): AdvisoryResultIntakeResult {
  if (!isPlainObject(rawAdvisory)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Completed PEIA response must include an advisoryResult object.'
    );
  }
  if (rawAdvisory.schemaVersion !== 1) {
    throw new Error('INVALID_PEIA_RESPONSE: advisoryResult.schemaVersion must be 1.');
  }
  if (rawAdvisory.humanReviewRequired !== true) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: advisoryResult.humanReviewRequired must be strictly true.'
    );
  }
  if (!isPlainObject(rawAdvisory.task)) {
    throw new Error('INVALID_PEIA_RESPONSE: advisoryResult.task must be a plain object.');
  }
  if (
    rawAdvisory.task.taskId !== expectedTaskId ||
    rawAdvisory.task.taskType !== AITaskType.CONTENT_REVIEW ||
    !isPlainObject(rawAdvisory.task.target) ||
    rawAdvisory.task.target.targetType !== AIReviewTargetType.LibraryIntake ||
    rawAdvisory.task.target.targetId !== expectedIntakeId ||
    rawAdvisory.task.target.sourceUpdatedAt !== expectedSourceUpdatedAt
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: advisoryResult.task reference does not match authoritative task identity.'
    );
  }
  if (
    !isPlainObject(rawAdvisory.assessment) ||
    typeof rawAdvisory.assessment.summary !== 'string' ||
    !Array.isArray(rawAdvisory.assessment.findings) ||
    !Array.isArray(rawAdvisory.recommendations) ||
    !Array.isArray(rawAdvisory.uncertainties) ||
    !Array.isArray(rawAdvisory.limitations)
  ) {
    throw new Error('INVALID_PEIA_RESPONSE: advisoryResult assessment or lists are malformed.');
  }

  validateCanonicalLibraryPreparationPayload(
    rawAdvisory.libraryPreparation,
    expectedInputBasis
  );

  return rawAdvisory as unknown as AdvisoryResultIntakeResult;
}

const VALID_ABSTAINED_REASONS: ReadonlySet<string> = new Set([
  'NO_EVIDENCE',
  'INSUFFICIENT_EVIDENCE',
  'INVALID_MODEL_OUTPUT',
  'UNGROUNDED_MODEL_OUTPUT',
]);

function hasExactKeys(
  obj: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actualKeys = Object.keys(obj);
  if (actualKeys.length !== expectedKeys.length) {
    return false;
  }
  return expectedKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(obj, key)
  );
}

function validateAbstainedOutcomeEnvelope(
  rawOutcome: unknown,
  expectedTaskId: string
): CanonicalNonAdvisoryOutcome {
  if (!isPlainObject(rawOutcome)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Completed non-advisory PEIA response must include a valid nonAdvisoryOutcome object.'
    );
  }
  if (rawOutcome.taskId !== expectedTaskId) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: nonAdvisoryOutcome.taskId (${String(rawOutcome.taskId)}) does not match taskId (${expectedTaskId}).`
    );
  }
  if (rawOutcome.kind !== 'ABSTAINED') {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Completed non-advisory PEIA response requires nonAdvisoryOutcome.kind === 'ABSTAINED', got '${String(rawOutcome.kind)}'.`
    );
  }
  if (
    rawOutcome.exitCode !== undefined ||
    'exitCode' in rawOutcome ||
    rawOutcome.sourceFailures !== undefined ||
    'sourceFailures' in rawOutcome
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: ABSTAINED nonAdvisoryOutcome cannot include exitCode or sourceFailures.'
    );
  }
  if (rawOutcome.detail !== undefined && !isNonEmptyTrimmedString(rawOutcome.detail)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: nonAdvisoryOutcome.detail must be a non-empty trimmed string without control characters when present.'
    );
  }
  const expectedKeys =
    rawOutcome.detail !== undefined
      ? (['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt', 'detail'] as const)
      : (['taskId', 'kind', 'reason', 'modelAttempts', 'createdAt'] as const);
  if (!hasExactKeys(rawOutcome, expectedKeys)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: ABSTAINED nonAdvisoryOutcome contains unexpected or missing fields.'
    );
  }
  if (
    typeof rawOutcome.reason !== 'string' ||
    !VALID_ABSTAINED_REASONS.has(rawOutcome.reason)
  ) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Invalid ABSTAINED reason '${String(rawOutcome.reason)}'.`
    );
  }
  if (
    typeof rawOutcome.modelAttempts !== 'number' ||
    !Number.isInteger(rawOutcome.modelAttempts)
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: nonAdvisoryOutcome.modelAttempts must be an integer.'
    );
  }
  if (
    rawOutcome.reason === 'NO_EVIDENCE' ||
    rawOutcome.reason === 'INSUFFICIENT_EVIDENCE'
  ) {
    if (rawOutcome.modelAttempts !== 0) {
      throw new Error(
        `INVALID_PEIA_RESPONSE: ABSTAINED reason '${rawOutcome.reason}' requires modelAttempts === 0, got ${String(rawOutcome.modelAttempts)}.`
      );
    }
  } else {
    if (rawOutcome.modelAttempts !== 1 && rawOutcome.modelAttempts !== 2) {
      throw new Error(
        `INVALID_PEIA_RESPONSE: ABSTAINED reason '${rawOutcome.reason}' requires modelAttempts of 1 or 2, got ${String(rawOutcome.modelAttempts)}.`
      );
    }
  }
  if (
    !isValidIsoTimestampString(rawOutcome.createdAt) ||
    new Date(rawOutcome.createdAt).toISOString() !== rawOutcome.createdAt
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: nonAdvisoryOutcome.createdAt must be a canonical ISO-8601 timestamp.'
    );
  }

  return rawOutcome as unknown as CanonicalNonAdvisoryOutcome;
}

function validateNonAdvisoryOutcomeEnvelope(
  rawOutcome: unknown,
  expectedTaskId: string
): CanonicalNonAdvisoryOutcome {
  if (!isPlainObject(rawOutcome)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Failed PEIA response must include a nonAdvisoryOutcome object.'
    );
  }
  if (rawOutcome.taskId !== expectedTaskId) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: nonAdvisoryOutcome.taskId (${String(rawOutcome.taskId)}) does not match taskId (${expectedTaskId}).`
    );
  }
  if (
    typeof rawOutcome.kind !== 'string' ||
    !ALLOWED_NON_ADVISORY_OUTCOME_KINDS.has(rawOutcome.kind)
  ) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Invalid nonAdvisoryOutcome.kind '${String(rawOutcome.kind)}'.`
    );
  }
  if (rawOutcome.kind === 'ABSTAINED') {
    throw new Error(
      "INVALID_PEIA_RESPONSE: Failed status cannot have nonAdvisoryOutcome.kind 'ABSTAINED'."
    );
  }
  if (!isNonEmptyTrimmedString(rawOutcome.reason)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: nonAdvisoryOutcome.reason must be a non-empty trimmed string.'
    );
  }
  if (
    typeof rawOutcome.modelAttempts !== 'number' ||
    !Number.isInteger(rawOutcome.modelAttempts) ||
    rawOutcome.modelAttempts < 0
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: nonAdvisoryOutcome.modelAttempts must be a non-negative integer.'
    );
  }
  if (!isValidIsoTimestampString(rawOutcome.createdAt)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: nonAdvisoryOutcome.createdAt must be a valid ISO-8601 timestamp.'
    );
  }

  return rawOutcome as unknown as CanonicalNonAdvisoryOutcome;
}

function validateStatusDtoShape(
  raw: unknown,
  expectedIntakeId: string,
  expectedTaskId?: string
): SanitizedLibraryIntakePeiaPreparationStatusDto {
  if (!isPlainObject(raw)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Expected LibraryIntake PEIA status object from manageLibraryDocuments.'
    );
  }

  if (!isValidPeiaReviewStatus(raw.status)) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Unsupported PEIA review status '${String(raw.status)}'.`
    );
  }
  if (!isNonEmptyTrimmedString(raw.taskId)) {
    throw new Error('INVALID_PEIA_RESPONSE: Missing valid taskId in PEIA status response.');
  }
  if (expectedTaskId !== undefined && raw.taskId !== expectedTaskId) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Response taskId (${raw.taskId}) does not match requested taskId (${expectedTaskId}).`
    );
  }
  if (raw.targetType !== AIReviewTargetType.LibraryIntake) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Expected targetType '${AIReviewTargetType.LibraryIntake}', got '${String(raw.targetType)}'.`
    );
  }
  if (raw.targetId !== expectedIntakeId || raw.intakeId !== expectedIntakeId) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Response intake identity (targetId=${String(raw.targetId)}, intakeId=${String(raw.intakeId)}) does not match requested intakeId (${expectedIntakeId}).`
    );
  }
  if (!isValidIsoTimestampString(raw.currentSourceUpdatedAt)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Missing valid currentSourceUpdatedAt in PEIA status response.'
    );
  }
  if (typeof raw.isStale !== 'boolean') {
    throw new Error('INVALID_PEIA_RESPONSE: Missing boolean isStale flag in PEIA status response.');
  }

  const status = raw.status;
  if (status === 'NotRequested') {
    if (
      raw.taskSourceUpdatedAt !== null ||
      raw.isStale !== false ||
      raw.inputBasis !== null ||
      raw.task !== null ||
      raw.advisoryResult !== null ||
      raw.libraryPreparation !== null ||
      raw.nonAdvisoryOutcome !== null
    ) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: NotRequested status must have isStale=false and null taskSourceUpdatedAt, inputBasis, task, advisoryResult, libraryPreparation, and nonAdvisoryOutcome.'
      );
    }

    return Object.freeze({
      status: 'NotRequested',
      taskId: raw.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: expectedIntakeId,
      intakeId: expectedIntakeId,
      currentSourceUpdatedAt: raw.currentSourceUpdatedAt,
      taskSourceUpdatedAt: null,
      isStale: false,
      inputBasis: null,
      task: null,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: null,
    });
  }

  if (!isValidIsoTimestampString(raw.taskSourceUpdatedAt)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Active PEIA status response must include a valid ISO-8601 taskSourceUpdatedAt.'
    );
  }
  const expectedStale = raw.taskSourceUpdatedAt !== raw.currentSourceUpdatedAt;
  if (raw.isStale !== expectedStale) {
    throw new Error(
      `INVALID_PEIA_RESPONSE: Inconsistent isStale (${String(raw.isStale)}) for currentSourceUpdatedAt=${raw.currentSourceUpdatedAt} and taskSourceUpdatedAt=${raw.taskSourceUpdatedAt}.`
    );
  }
  if (!isValidInputBasis(raw.inputBasis)) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Active PEIA status response must include a valid inputBasis.'
    );
  }

  const validatedTask = validateTaskEnvelope(
    raw.task,
    raw.taskId,
    expectedIntakeId,
    raw.taskSourceUpdatedAt,
    status
  );

  if (
    validatedTask.contentSnapshot['inputBasis'] !== undefined &&
    validatedTask.contentSnapshot['inputBasis'] !== raw.inputBasis
  ) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Status inputBasis does not match task.contentSnapshot.inputBasis.'
    );
  }

  if (status === AITaskStatus.Pending) {
    if (
      raw.advisoryResult !== null ||
      raw.libraryPreparation !== null ||
      raw.nonAdvisoryOutcome !== null
    ) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Pending status must have null advisoryResult, libraryPreparation, and nonAdvisoryOutcome.'
      );
    }

    return Object.freeze({
      status: AITaskStatus.Pending,
      taskId: raw.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: expectedIntakeId,
      intakeId: expectedIntakeId,
      currentSourceUpdatedAt: raw.currentSourceUpdatedAt,
      taskSourceUpdatedAt: raw.taskSourceUpdatedAt,
      isStale: raw.isStale,
      inputBasis: raw.inputBasis,
      task: validatedTask,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: null,
    });
  }

  if (status === AITaskStatus.Completed) {
    if (raw.nonAdvisoryOutcome !== null) {
      if (raw.advisoryResult !== null || raw.libraryPreparation !== null) {
        throw new Error(
          'INVALID_PEIA_RESPONSE: Completed status cannot include both advisory and non-advisory artifacts.'
        );
      }
      const validatedAbstainedOutcome = validateAbstainedOutcomeEnvelope(
        raw.nonAdvisoryOutcome,
        raw.taskId
      );

      return Object.freeze({
        status: AITaskStatus.Completed,
        taskId: raw.taskId,
        targetType: AIReviewTargetType.LibraryIntake,
        targetId: expectedIntakeId,
        intakeId: expectedIntakeId,
        currentSourceUpdatedAt: raw.currentSourceUpdatedAt,
        taskSourceUpdatedAt: raw.taskSourceUpdatedAt,
        isStale: raw.isStale,
        inputBasis: raw.inputBasis,
        task: validatedTask,
        advisoryResult: null,
        libraryPreparation: null,
        nonAdvisoryOutcome: validatedAbstainedOutcome,
      });
    }

    const validatedAdvisoryResult = validateAdvisoryResultEnvelope(
      raw.advisoryResult,
      raw.taskId,
      expectedIntakeId,
      raw.taskSourceUpdatedAt,
      raw.inputBasis
    );
    const validatedLibraryPreparation = validateCanonicalLibraryPreparationPayload(
      raw.libraryPreparation,
      raw.inputBasis
    );

    const prepConsistent = CANONICAL_LIBRARY_PREPARATION_KEYS.every(
      (key) =>
        JSON.stringify(validatedAdvisoryResult.libraryPreparation?.[key]) ===
        JSON.stringify(validatedLibraryPreparation[key])
    );
    if (!prepConsistent) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Top-level libraryPreparation does not match advisoryResult.libraryPreparation.'
      );
    }

    return Object.freeze({
      status: AITaskStatus.Completed,
      taskId: raw.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: expectedIntakeId,
      intakeId: expectedIntakeId,
      currentSourceUpdatedAt: raw.currentSourceUpdatedAt,
      taskSourceUpdatedAt: raw.taskSourceUpdatedAt,
      isStale: raw.isStale,
      inputBasis: raw.inputBasis,
      task: validatedTask,
      advisoryResult: validatedAdvisoryResult,
      libraryPreparation: validatedLibraryPreparation,
      nonAdvisoryOutcome: null,
    });
  }

  if (raw.advisoryResult !== null || raw.libraryPreparation !== null) {
    throw new Error(
      'INVALID_PEIA_RESPONSE: Failed status must have null advisoryResult and libraryPreparation.'
    );
  }
  const validatedNonAdvisoryOutcome = validateNonAdvisoryOutcomeEnvelope(
    raw.nonAdvisoryOutcome,
    raw.taskId
  );

  return Object.freeze({
    status: AITaskStatus.Failed,
    taskId: raw.taskId,
    targetType: AIReviewTargetType.LibraryIntake,
    targetId: expectedIntakeId,
    intakeId: expectedIntakeId,
    currentSourceUpdatedAt: raw.currentSourceUpdatedAt,
    taskSourceUpdatedAt: raw.taskSourceUpdatedAt,
    isStale: raw.isStale,
    inputBasis: raw.inputBasis,
    task: validatedTask,
    advisoryResult: null,
    libraryPreparation: null,
    nonAdvisoryOutcome: validatedNonAdvisoryOutcome,
  });
}

function getFunctionsInstance() {
  if (!isFirebaseConfigured || !app) {
    throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
  }
  if (!auth?.currentUser) {
    throw new Error('UNAUTHENTICATED: Authentication required. Library management requires an authenticated Admin user session.');
  }
  return getFunctions(app);
}

export const LibraryAdminClient = {
  isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  },

  isAuthenticated(): boolean {
    return !!(isFirebaseConfigured && auth?.currentUser);
  },

  async listAll(): Promise<LibraryDocument[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { documents: LibraryDocument[] }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'listAll' });
    return res.data?.documents ?? [];
  },

  async getById(id: string): Promise<LibraryDocument | null> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string }, { document: LibraryDocument }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'getById', id });
    return res.data?.document ?? null;
  },

  async create(input: any): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: any }, { document: LibraryDocument }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'create', input });
    return res.data.document;
  },

  async updateMetadata(id: string, updates: any): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string; updates: any }, { document: LibraryDocument }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'updateMetadata', id, updates });
    return res.data.document;
  },

  async updateRights(id: string, rightsStatus: LibraryRightsStatus, notesAr?: string, notesEn?: string): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; id: string; rightsStatus: LibraryRightsStatus; notesAr?: string; notesEn?: string },
      { document: LibraryDocument }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'updateRights', id, rightsStatus, notesAr, notesEn });
    return res.data.document;
  },

  async transitionWorkflow(id: string, targetState: WorkflowState, comment?: string): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; id: string; targetState: WorkflowState; comment?: string },
      { document: LibraryDocument }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'transitionWorkflow', id, targetState, comment });
    return res.data.document;
  },

  async addVersion(id: string, versionInput: any): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; id: string; versionInput: any },
      { document: LibraryDocument }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'addVersion', id, versionInput });
    return res.data.document;
  },

  async listSources(): Promise<LibrarySource[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { sources: LibrarySource[] }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'listSources' });
    return res.data?.sources ?? [];
  },

  async listOrganizations(): Promise<LibraryOrganization[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { organizations: LibraryOrganization[] }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'listOrganizations' });
    return res.data?.organizations ?? [];
  },

  async registerSource(input: any): Promise<LibrarySource> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: any }, { source: LibrarySource }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'registerSource', input });
    return res.data.source;
  },

  async registerOrganization(input: any): Promise<LibraryOrganization> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: any }, { organization: LibraryOrganization }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'registerOrganization', input });
    return res.data.organization;
  },

  async verifySource(sourceId: string, status: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex'): Promise<LibrarySource> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; sourceId: string; status: string },
      { source: LibrarySource }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'verifySource', sourceId, status });
    return res.data.source;
  },

  async listIntake(): Promise<LibraryIntakeRecord[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { intakeRecords?: LibraryIntakeRecord[]; intake?: LibraryIntakeRecord[] }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'listIntake' });
    return res.data?.intakeRecords ?? res.data?.intake ?? [];
  },

  async getIntakeById(id: string): Promise<LibraryIntakeRecord | null> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string }, { intakeRecord: LibraryIntakeRecord }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'getIntakeById', id });
    return res.data?.intakeRecord ?? null;
  },

  async submitIntake(input: SubmitLibraryIntakeInput): Promise<LibraryIntakeRecord> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: SubmitLibraryIntakeInput }, { intakeRecord: LibraryIntakeRecord }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'submitIntake', input });
    return res.data.intakeRecord;
  },

  async updateIntakeStatus(intakeId: string, status: LibraryIntakeStatus, reviewNotes?: string): Promise<LibraryIntakeRecord> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; intakeId: string; status: LibraryIntakeStatus; reviewNotes?: string },
      { intakeRecord: LibraryIntakeRecord }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'updateIntakeStatus', intakeId, status, reviewNotes });
    return res.data.intakeRecord;
  },

  async generateIntakeAISuggestions(intakeId: string, suppliedExcerpt?: string): Promise<LibraryIntakeRecord> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; intakeId: string; suppliedExcerpt?: string },
      { intakeRecord: LibraryIntakeRecord }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({
      action: 'generateIntakeAISuggestions',
      intakeId,
      suppliedExcerpt: suppliedExcerpt && suppliedExcerpt.trim() !== '' ? suppliedExcerpt.trim() : undefined,
    });
    return res.data.intakeRecord;
  },

  async requestIntakePeiaPreparation(
    intakeId: string,
    expectedUpdatedAt: string
  ): Promise<RequestLibraryIntakePeiaPreparationResponseDto> {
    const validatedIntakeId = validateStrictIdentifier(intakeId, 'intakeId');
    const validatedExpectedUpdatedAt = validateStrictExpectedUpdatedAt(expectedUpdatedAt);
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      RequestIntakePeiaPreparationPayload,
      RequestLibraryIntakePeiaPreparationResponseDto
    >(fns, 'manageLibraryDocuments');

    const payload: RequestIntakePeiaPreparationPayload = {
      action: 'requestIntakePeiaPreparation',
      intakeId: validatedIntakeId,
      expectedUpdatedAt: validatedExpectedUpdatedAt,
    };

    const res = await callable(payload);
    const rawData = res?.data;
    if (!isPlainObject(rawData)) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Expected response object from requestIntakePeiaPreparation.'
      );
    }

    if (rawData.disposition !== 'CREATED' && rawData.disposition !== 'ALREADY_EXISTS') {
      throw new Error(
        `INVALID_PEIA_RESPONSE: Invalid disposition '${String(rawData.disposition)}' in requestIntakePeiaPreparation response.`
      );
    }
    if (!isNonEmptyTrimmedString(rawData.documentId)) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Missing valid documentId in requestIntakePeiaPreparation response.'
      );
    }
    if (!isNonEmptyTrimmedString(rawData.taskId)) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Missing valid taskId in requestIntakePeiaPreparation response.'
      );
    }
    if (rawData.intakeId !== validatedIntakeId) {
      throw new Error(
        `INVALID_PEIA_RESPONSE: Response intakeId '${String(rawData.intakeId)}' does not match requested intakeId '${validatedIntakeId}'.`
      );
    }
    if (!isValidInputBasis(rawData.inputBasis)) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Invalid inputBasis in requestIntakePeiaPreparation response.'
      );
    }
    if (!isPlainObject(rawData.preparationStatus) || !isPlainObject(rawData.reviewStatus)) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Missing preparationStatus or reviewStatus in requestIntakePeiaPreparation response.'
      );
    }

    const validatedPreparationStatus = validateStatusDtoShape(
      rawData.preparationStatus,
      validatedIntakeId,
      rawData.taskId
    );
    const validatedReviewStatus = validateStatusDtoShape(
      rawData.reviewStatus,
      validatedIntakeId,
      rawData.taskId
    );

    if (
      validatedPreparationStatus.status === 'NotRequested' ||
      validatedReviewStatus.status !== validatedPreparationStatus.status
    ) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Enqueued PEIA task status cannot be NotRequested or inconsistent across preparationStatus/reviewStatus.'
      );
    }

    const validatedTopTask = validateTaskEnvelope(
      rawData.task,
      rawData.taskId,
      validatedIntakeId,
      validatedExpectedUpdatedAt,
      validatedPreparationStatus.status
    );

    if (
      rawData.status !== validatedPreparationStatus.status ||
      rawData.isStale !== validatedPreparationStatus.isStale ||
      rawData.inputBasis !== validatedPreparationStatus.inputBasis
    ) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Top-level status fields do not match nested preparationStatus.'
      );
    }

    return Object.freeze({
      disposition: rawData.disposition,
      documentId: rawData.documentId,
      taskId: rawData.taskId,
      intakeId: validatedIntakeId,
      inputBasis: rawData.inputBasis,
      task: validatedTopTask,
      status: validatedPreparationStatus.status,
      isStale: validatedPreparationStatus.isStale,
      advisoryResult: validatedPreparationStatus.advisoryResult,
      libraryPreparation: validatedPreparationStatus.libraryPreparation,
      nonAdvisoryOutcome: validatedPreparationStatus.nonAdvisoryOutcome,
      preparationStatus: validatedPreparationStatus,
      reviewStatus: validatedReviewStatus,
    });
  },

  async getIntakePeiaPreparationStatus(
    intakeId: string,
    taskId?: string
  ): Promise<GetLibraryIntakePeiaPreparationStatusResponseDto> {
    const validatedIntakeId = validateStrictIdentifier(intakeId, 'intakeId');
    const validatedTaskId =
      taskId !== undefined ? validateStrictIdentifier(taskId, 'taskId') : undefined;
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      GetIntakePeiaPreparationStatusPayload,
      GetLibraryIntakePeiaPreparationStatusResponseDto
    >(fns, 'manageLibraryDocuments');

    const payload: GetIntakePeiaPreparationStatusPayload = {
      action: 'getIntakePeiaPreparationStatus',
      intakeId: validatedIntakeId,
      ...(validatedTaskId !== undefined ? { taskId: validatedTaskId } : {}),
    };

    const res = await callable(payload);
    const rawData = res?.data;
    const validatedTopStatus = validateStatusDtoShape(
      rawData,
      validatedIntakeId,
      validatedTaskId
    );

    const record = rawData as unknown as Record<string, unknown>;
    const validatedPrepStatus =
      record.preparationStatus !== undefined
        ? validateStatusDtoShape(
            record.preparationStatus,
            validatedIntakeId,
            validatedTopStatus.taskId
          )
        : validatedTopStatus;
    const validatedRevStatus =
      record.reviewStatus !== undefined
        ? validateStatusDtoShape(
            record.reviewStatus,
            validatedIntakeId,
            validatedTopStatus.taskId
          )
        : validatedTopStatus;

    if (
      validatedPrepStatus.status !== validatedTopStatus.status ||
      validatedRevStatus.status !== validatedTopStatus.status ||
      validatedPrepStatus.isStale !== validatedTopStatus.isStale ||
      validatedRevStatus.isStale !== validatedTopStatus.isStale
    ) {
      throw new Error(
        'INVALID_PEIA_RESPONSE: Top-level status and nested preparationStatus/reviewStatus are inconsistent.'
      );
    }

    return Object.freeze({
      ...validatedTopStatus,
      preparationStatus: validatedPrepStatus,
      reviewStatus: validatedRevStatus,
    });
  },
};
