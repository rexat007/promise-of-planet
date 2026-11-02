import { createHash } from 'node:crypto';
import { AITaskStatus, AITaskType, type AIReviewTask } from '../types/aiTask';
import {
  AIReviewTargetType,
  PEIALibraryPreparationInputBasis,
  type ReviewTargetIdentity,
} from '../shared/aiReviewContract';
import { validateAIReviewTask } from './aiTaskValidator';
import { PEIA_PENDING_TASK_COLLECTION } from './firestorePendingTaskSource';
import {
  PEIA_ADVISORY_RESULT_COLLECTION,
  deriveAdvisoryResultDocumentId,
} from './firestoreAdvisoryResultRepository';
import {
  PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
  deriveNonAdvisoryOutcomeDocumentId,
} from './firestoreNonAdvisoryOutcomeRepository';
import {
  type AdvisoryResultIntakeResult,
} from './advisoryResultIntakeContract';
import {
  validateExistingRecord as validateExistingAdvisoryRecord,
  isTaskReferenceEqual,
} from './advisoryResultPersistenceBoundary';
import {
  type CanonicalNonAdvisoryOutcome,
} from './nonAdvisoryOutcomeIntakeContract';
import {
  validateExistingRecord as validateExistingNonAdvisoryRecord,
  computeConvergedTaskStatus,
} from './nonAdvisoryOutcomePersistenceBoundary';

/**
 * Maximum character budget for a formatted evidence block in peia-worker
 * (`DEFAULT_LOCAL_CONTEXT_MAX_CHARS = 8000` in `peia-worker/src/localAnalysisRuntime.ts`).
 */
export const MAX_WORKER_EVIDENCE_CONTEXT_CHARS = 8000;

export const MAX_SNAPSHOT_TITLE_CHARS = 300;
export const MAX_NEWS_SUMMARY_CHARS = 1500;
export const MAX_NEWS_BODY_CHARS = 6500;
export const MAX_LIBRARY_ISSUING_ORG_CHARS = 300;
export const MAX_LIBRARY_NOTES_CHARS = 2000;
export const MAX_LIBRARY_SOURCE_NOTES_CHARS = 1500;
export const MAX_LIBRARY_SUPPLIED_EXCERPT_CHARS = 6000;

const SINGLE_LINE_CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;
const MULTILINE_DISALLOWED_CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const ALLOWED_LIBRARY_LANGUAGES = new Set<string>(['ar', 'en', 'bilingual', 'other']);

const PROHIBITED_CALLER_FIELDS = new Set<string>([
  'taskId',
  'taskType',
  'status',
  'createdAt',
  'approved',
  'published',
  'workflowState',
  'desiredWorkflowState',
  'permission',
  'role',
  'autoApply',
  'autoPublish',
  'decision',
  'suggestedAction',
  'workerId',
  'machineToken',
  'apiKey',
  'serviceAccount',
  'suggestedSummaryAr',
  'suggestedSummaryEn',
  'documentSummary',
  'fullText',
]);

export type PeiaTaskQueueErrorCode =
  | 'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD'
  | 'INVALID_TARGET_IDENTITY'
  | 'INVALID_SNAPSHOT_INPUT'
  | 'SNAPSHOT_OVERSIZED'
  | 'INVALID_CLOCK_TIMESTAMP'
  | 'TRANSACTION_REQUIRED'
  | 'TASK_QUERY_CARDINALITY_INVALID'
  | 'INVALID_EXISTING_TASK_RECORD'
  | 'TASK_PAYLOAD_CONFLICT'
  | 'RECONCILIATION_INTEGRITY_ERROR';

export class PeiaTaskQueueError extends Error {
  readonly code: PeiaTaskQueueErrorCode;

  constructor(code: PeiaTaskQueueErrorCode, message: string) {
    super(message);
    this.name = 'PeiaTaskQueueError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Trusted server-only input for constructing a News PEIA review task.
 *
 * TRUST BOUNDARY:
 * Callers MUST be server-side application services that have already authenticated
 * a human administrator and loaded the authoritative News document from Firestore.
 * Client payloads must never be passed directly to this interface.
 */
export interface AuthoritativeNewsSnapshotInput {
  readonly targetId: string;
  readonly sourceUpdatedAt: string;
  readonly title: string;
  readonly body: string;
  readonly summary?: string;
}

/**
 * Trusted server-only input for constructing a LibraryIntake PEIA preparation task.
 *
 * TRUST BOUNDARY:
 * Callers MUST be server-side application services that have already authenticated
 * a human administrator and loaded the authoritative LibraryIntake record (and any
 * linked organization/source metadata) from Firestore.
 * Client payloads must never be passed directly to this interface.
 */
export interface AuthoritativeLibraryIntakeSnapshotInput {
  readonly targetId: string;
  readonly sourceUpdatedAt: string;
  readonly inputBasis: PEIALibraryPreparationInputBasis;
  readonly title: string;
  readonly suppliedExcerpt?: string;
  readonly notes?: string;
  readonly issuingOrganization?: string;
  readonly language?: string;
  readonly sourceNotes?: string;
}

export interface ValidatedNewsContentSnapshot extends Readonly<Record<string, unknown>> {
  readonly allowSnapshotEvidence: true;
  readonly title: string;
  readonly body: string;
  readonly summary?: string;
}

export interface ValidatedLibraryIntakeContentSnapshot extends Readonly<Record<string, unknown>> {
  readonly allowSnapshotEvidence: true;
  readonly inputBasis: PEIALibraryPreparationInputBasis;
  readonly title: string;
  readonly issuingOrganization?: string;
  readonly language?: string;
  readonly notes?: string;
  readonly sourceNotes?: string;
  readonly suppliedExcerpt?: string;
}

export type PeiaTaskEnqueueDisposition = 'CREATED' | 'ALREADY_EXISTS';

export interface PeiaTaskEnqueueResult {
  readonly task: AIReviewTask;
  readonly documentId: string;
  readonly disposition: PeiaTaskEnqueueDisposition;
}

export interface ReconcilePeiaTaskStatusInput {
  readonly taskId: string;
  readonly targetType: AIReviewTargetType;
  readonly targetId: string;
  readonly currentSourceUpdatedAt: string;
}

export type ReconciledPeiaTaskStatusResult =
  | {
      readonly status: 'NotRequested';
      readonly taskId: string;
      readonly targetType: AIReviewTargetType;
      readonly targetId: string;
      readonly currentSourceUpdatedAt: string;
      readonly isStale: false;
    }
  | {
      readonly status: typeof AITaskStatus.Pending;
      readonly taskId: string;
      readonly task: AIReviewTask;
      readonly isStale: boolean;
    }
  | {
      readonly status: typeof AITaskStatus.Completed;
      readonly taskId: string;
      readonly task: AIReviewTask;
      readonly advisoryResult: AdvisoryResultIntakeResult;
      readonly isStale: boolean;
    }
  | {
      readonly status: typeof AITaskStatus.Failed;
      readonly taskId: string;
      readonly task: AIReviewTask;
      readonly nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome;
      readonly isStale: boolean;
    };

export interface PeiaTaskQueueDocumentSnapshot {
  readonly exists: boolean;
  readonly ref?: PeiaTaskQueueDocumentRef;
  data(): unknown;
}

export interface PeiaTaskQueueQuerySnapshot {
  readonly docs: readonly PeiaTaskQueueDocumentSnapshot[];
}

export interface PeiaTaskQueueDocumentRef {
  readonly id: string;
}

export interface PeiaTaskQueueQuery {
  where(field: string, op: string, value: unknown): PeiaTaskQueueQuery;
  limit(count: number): PeiaTaskQueueQuery;
}

export interface PeiaTaskQueueCollectionRef {
  doc(documentId: string): PeiaTaskQueueDocumentRef;
  where(field: string, op: string, value: unknown): PeiaTaskQueueQuery;
}

export interface PeiaTaskQueueTransaction {
  get(target: PeiaTaskQueueDocumentRef | PeiaTaskQueueQuery): Promise<any>;
  create(docRef: PeiaTaskQueueDocumentRef, data: unknown): PeiaTaskQueueTransaction;
}

export interface PeiaTaskQueueFirestoreDatabase {
  collection(collectionName: string): PeiaTaskQueueCollectionRef;
  runTransaction<T>(updateFunction: (transaction: PeiaTaskQueueTransaction) => Promise<T>): Promise<T>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return false;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!isDeepEqual(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

function canonicalJsonSerialize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonSerialize(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const sortedKeys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    const entries = sortedKeys.map(
      (k) => `${JSON.stringify(k)}:${canonicalJsonSerialize(value[k])}`
    );
    return `{${entries.join(',')}}`;
  }
  throw new PeiaTaskQueueError(
    'INVALID_SNAPSHOT_INPUT',
    'Snapshot contains unsupported non-JSON value.'
  );
}

function assertAllowedInputKeys(
  input: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  contextLabel: string
): void {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      if (PROHIBITED_CALLER_FIELDS.has(key)) {
        throw new PeiaTaskQueueError(
          'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD',
          `Prohibited caller field "${key}" is not allowed in ${contextLabel}.`
        );
      }
      throw new PeiaTaskQueueError(
        'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD',
        `Unknown field "${key}" is not allowed in ${contextLabel}.`
      );
    }
  }
}

function validateIsoTimestamp(value: unknown, fieldName: string, errorCode: PeiaTaskQueueErrorCode): string {
  if (typeof value !== 'string') {
    throw new PeiaTaskQueueError(errorCode, `${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== value) {
    throw new PeiaTaskQueueError(
      errorCode,
      `${fieldName} must be a non-empty trimmed ISO-8601 timestamp.`
    );
  }
  if (SINGLE_LINE_CONTROL_CHAR_REGEX.test(trimmed)) {
    throw new PeiaTaskQueueError(
      errorCode,
      `${fieldName} must not contain control characters.`
    );
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new PeiaTaskQueueError(
      errorCode,
      `${fieldName} must be a valid ISO-8601 timestamp.`
    );
  }
  return trimmed;
}

function validateTargetIdentityInput(
  targetType: AIReviewTargetType,
  targetId: unknown,
  sourceUpdatedAt: unknown
): ReviewTargetIdentity {
  if (
    targetType !== AIReviewTargetType.News &&
    targetType !== AIReviewTargetType.LibraryIntake &&
    targetType !== AIReviewTargetType.LibraryDocument &&
    targetType !== AIReviewTargetType.TrainingCourse &&
    targetType !== AIReviewTargetType.CitizenSubmission
  ) {
    throw new PeiaTaskQueueError(
      'INVALID_TARGET_IDENTITY',
      'targetType must be a canonical AIReviewTargetType.'
    );
  }

  if (typeof targetId !== 'string') {
    throw new PeiaTaskQueueError('INVALID_TARGET_IDENTITY', 'targetId must be a string.');
  }
  const trimmedTargetId = targetId.trim();
  if (trimmedTargetId.length === 0 || trimmedTargetId !== targetId) {
    throw new PeiaTaskQueueError(
      'INVALID_TARGET_IDENTITY',
      'targetId must be a non-empty trimmed string.'
    );
  }
  if (SINGLE_LINE_CONTROL_CHAR_REGEX.test(trimmedTargetId)) {
    throw new PeiaTaskQueueError(
      'INVALID_TARGET_IDENTITY',
      'targetId must not contain control characters or line breaks.'
    );
  }

  const validatedUpdatedAt = validateIsoTimestamp(
    sourceUpdatedAt,
    'sourceUpdatedAt',
    'INVALID_TARGET_IDENTITY'
  );

  return Object.freeze({
    targetType,
    targetId: trimmedTargetId,
    sourceUpdatedAt: validatedUpdatedAt,
  });
}

function sanitizeRequiredSingleLineField(
  value: unknown,
  fieldName: string,
  maxChars: number
): string {
  if (typeof value !== 'string') {
    throw new PeiaTaskQueueError('INVALID_SNAPSHOT_INPUT', `${fieldName} must be a string.`);
  }
  if (SINGLE_LINE_CONTROL_CHAR_REGEX.test(value)) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      `${fieldName} must be a single-line string without control characters.`
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      `${fieldName} must be a non-empty string.`
    );
  }
  if (trimmed.length > maxChars) {
    throw new PeiaTaskQueueError(
      'SNAPSHOT_OVERSIZED',
      `${fieldName} exceeds maximum length of ${maxChars} characters.`
    );
  }
  return trimmed;
}

function sanitizeOptionalSingleLineField(
  value: unknown,
  fieldName: string,
  maxChars: number
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new PeiaTaskQueueError('INVALID_SNAPSHOT_INPUT', `${fieldName} must be a string when provided.`);
  }
  if (SINGLE_LINE_CONTROL_CHAR_REGEX.test(value)) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      `${fieldName} must be a single-line string without control characters.`
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > maxChars) {
    throw new PeiaTaskQueueError(
      'SNAPSHOT_OVERSIZED',
      `${fieldName} exceeds maximum length of ${maxChars} characters.`
    );
  }
  return trimmed;
}

function sanitizeRequiredMultilineField(
  value: unknown,
  fieldName: string,
  maxChars: number
): string {
  if (typeof value !== 'string') {
    throw new PeiaTaskQueueError('INVALID_SNAPSHOT_INPUT', `${fieldName} must be a string.`);
  }
  const normalized = value.replace(/\r\n?/g, '\n');
  if (MULTILINE_DISALLOWED_CONTROL_CHAR_REGEX.test(normalized)) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      `${fieldName} contains disallowed control characters.`
    );
  }
  const trimmed = normalized.trim();
  if (trimmed.length === 0) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      `${fieldName} must be a non-empty string.`
    );
  }
  if (trimmed.length > maxChars) {
    throw new PeiaTaskQueueError(
      'SNAPSHOT_OVERSIZED',
      `${fieldName} exceeds maximum length of ${maxChars} characters.`
    );
  }
  return trimmed;
}

function sanitizeOptionalMultilineField(
  value: unknown,
  fieldName: string,
  maxChars: number
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new PeiaTaskQueueError('INVALID_SNAPSHOT_INPUT', `${fieldName} must be a string when provided.`);
  }
  const normalized = value.replace(/\r\n?/g, '\n');
  if (MULTILINE_DISALLOWED_CONTROL_CHAR_REGEX.test(normalized)) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      `${fieldName} contains disallowed control characters.`
    );
  }
  const trimmed = normalized.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > maxChars) {
    throw new PeiaTaskQueueError(
      'SNAPSHOT_OVERSIZED',
      `${fieldName} exceeds maximum length of ${maxChars} characters.`
    );
  }
  return trimmed;
}

/**
 * Computes the exact formatted character length of the evidence block produced
 * by `peia-worker`'s `buildSnapshotEvidenceForTask` + `assembleBoundedEvidenceContext`.
 */
export function computeFormattedWorkerEvidenceLength(
  target: ReviewTargetIdentity,
  contentSnapshot: Readonly<Record<string, unknown>>
): number {
  let itemId: string;
  let sourceUrl: string;
  let resolvedTitle: string;
  const excerptLines: string[] = [];

  if (target.targetType === AIReviewTargetType.News) {
    itemId = `news-${target.targetId}`;
    sourceUrl = `urn:peia:snapshot:news:${target.targetId}`;
    const title = typeof contentSnapshot['title'] === 'string' ? contentSnapshot['title'] : undefined;
    const summary = typeof contentSnapshot['summary'] === 'string' ? contentSnapshot['summary'] : undefined;
    const body = typeof contentSnapshot['body'] === 'string' ? contentSnapshot['body'] : '';

    resolvedTitle = title ?? `Supplied News Snapshot (${target.targetId})`;
    excerptLines.push('Provenance Notice: Supplied, unverified News task content snapshot.');
    if (title !== undefined) {
      excerptLines.push(`Supplied Title: ${title}`);
    }
    if (summary !== undefined) {
      excerptLines.push(`Supplied Summary: ${summary}`);
    }
    excerptLines.push(`Article Text:\n${body}`);
  } else if (target.targetType === AIReviewTargetType.LibraryIntake) {
    itemId = `intake-${target.targetId}`;
    sourceUrl = `urn:peia:snapshot:library-intake:${target.targetId}`;
    const inputBasis = String(contentSnapshot['inputBasis']);
    const title = typeof contentSnapshot['title'] === 'string' ? contentSnapshot['title'] : undefined;
    const issuingOrganization =
      typeof contentSnapshot['issuingOrganization'] === 'string'
        ? contentSnapshot['issuingOrganization']
        : undefined;
    const notes = typeof contentSnapshot['notes'] === 'string' ? contentSnapshot['notes'] : undefined;
    const sourceNotes =
      typeof contentSnapshot['sourceNotes'] === 'string' ? contentSnapshot['sourceNotes'] : undefined;
    const suppliedExcerpt =
      typeof contentSnapshot['suppliedExcerpt'] === 'string'
        ? contentSnapshot['suppliedExcerpt']
        : undefined;

    resolvedTitle = title ?? `Supplied LibraryIntake Snapshot (${target.targetId})`;
    excerptLines.push(`Input Basis: ${inputBasis}`);
    excerptLines.push(
      'Provenance Notice: Supplied, unverified intake snapshot only. Full document/PDF and external URLs were not fetched or inspected.'
    );
    if (title !== undefined) {
      excerptLines.push(`Supplied Title: ${title}`);
    }
    if (issuingOrganization !== undefined) {
      excerptLines.push(`Supplied Issuing Organization: ${issuingOrganization}`);
    }
    if (notes !== undefined) {
      excerptLines.push(`Supplied Intake Notes: ${notes}`);
    }
    if (sourceNotes !== undefined) {
      excerptLines.push(`Supplied Source Notes: ${sourceNotes}`);
    }
    if (suppliedExcerpt !== undefined) {
      excerptLines.push(`Supplied Excerpt:\n${suppliedExcerpt}`);
    }
  } else {
    throw new PeiaTaskQueueError(
      'INVALID_TARGET_IDENTITY',
      `Snapshot evidence formatting is only supported for News and LibraryIntake (got ${target.targetType}).`
    );
  }

  const ref = `TASK_CONTENT_SNAPSHOT::${itemId}`;
  const excerpt = excerptLines.join('\n');
  const block =
    `--- EVIDENCE ITEM ---\n` +
    `Reference: ${ref}\n` +
    `Source: TASK_CONTENT_SNAPSHOT\n` +
    `Authority: UnverifiedTaskSnapshot\n` +
    `Title: ${resolvedTitle}\n` +
    `Source URL: ${sourceUrl}\n` +
    `Retrieved At: ${target.sourceUpdatedAt}\n` +
    `Updated At: ${target.sourceUpdatedAt}\n` +
    `Content Excerpt:\n${excerpt}\n`;

  return block.length;
}

const NEWS_INPUT_ALLOWED_KEYS = new Set<string>([
  'targetId',
  'sourceUpdatedAt',
  'title',
  'body',
  'summary',
]);

/**
 * Validates and constructs a worker-compatible News contentSnapshot and target identity.
 */
export function buildNewsTaskSnapshot(input: unknown): {
  readonly target: ReviewTargetIdentity;
  readonly contentSnapshot: ValidatedNewsContentSnapshot;
} {
  if (!isPlainObject(input)) {
    throw new PeiaTaskQueueError('INVALID_SNAPSHOT_INPUT', 'News task input must be a plain object.');
  }
  assertAllowedInputKeys(input, NEWS_INPUT_ALLOWED_KEYS, 'AuthoritativeNewsSnapshotInput');

  const target = validateTargetIdentityInput(
    AIReviewTargetType.News,
    input['targetId'],
    input['sourceUpdatedAt']
  );

  const title = sanitizeRequiredSingleLineField(input['title'], 'title', MAX_SNAPSHOT_TITLE_CHARS);
  const body = sanitizeRequiredMultilineField(input['body'], 'body', MAX_NEWS_BODY_CHARS);
  const summary = sanitizeOptionalMultilineField(input['summary'], 'summary', MAX_NEWS_SUMMARY_CHARS);

  const snapshotObj: Record<string, unknown> = {
    allowSnapshotEvidence: true,
    title,
    body,
  };
  if (summary !== undefined) {
    snapshotObj['summary'] = summary;
  }

  const contentSnapshot = Object.freeze(snapshotObj) as ValidatedNewsContentSnapshot;
  const formattedLength = computeFormattedWorkerEvidenceLength(target, contentSnapshot);
  if (formattedLength > MAX_WORKER_EVIDENCE_CONTEXT_CHARS) {
    throw new PeiaTaskQueueError(
      'SNAPSHOT_OVERSIZED',
      `Formatted News snapshot evidence (${formattedLength} chars) exceeds worker context limit (${MAX_WORKER_EVIDENCE_CONTEXT_CHARS} chars).`
    );
  }

  return Object.freeze({ target, contentSnapshot });
}

const LIBRARY_INTAKE_INPUT_ALLOWED_KEYS = new Set<string>([
  'targetId',
  'sourceUpdatedAt',
  'inputBasis',
  'title',
  'suppliedExcerpt',
  'notes',
  'issuingOrganization',
  'language',
  'sourceNotes',
]);

/**
 * Validates and constructs a worker-compatible LibraryIntake contentSnapshot and target identity.
 */
export function buildLibraryIntakeTaskSnapshot(input: unknown): {
  readonly target: ReviewTargetIdentity;
  readonly contentSnapshot: ValidatedLibraryIntakeContentSnapshot;
} {
  if (!isPlainObject(input)) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      'LibraryIntake task input must be a plain object.'
    );
  }
  assertAllowedInputKeys(
    input,
    LIBRARY_INTAKE_INPUT_ALLOWED_KEYS,
    'AuthoritativeLibraryIntakeSnapshotInput'
  );

  const target = validateTargetIdentityInput(
    AIReviewTargetType.LibraryIntake,
    input['targetId'],
    input['sourceUpdatedAt']
  );

  const inputBasis = input['inputBasis'];
  if (
    inputBasis !== PEIALibraryPreparationInputBasis.MetadataOnly &&
    inputBasis !== PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata
  ) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      'inputBasis must be MetadataOnly or SuppliedExcerptAndMetadata.'
    );
  }

  const title = sanitizeRequiredSingleLineField(input['title'], 'title', MAX_SNAPSHOT_TITLE_CHARS);
  const issuingOrganization = sanitizeOptionalSingleLineField(
    input['issuingOrganization'],
    'issuingOrganization',
    MAX_LIBRARY_ISSUING_ORG_CHARS
  );
  const language = sanitizeOptionalSingleLineField(input['language'], 'language', 32);
  if (language !== undefined && !ALLOWED_LIBRARY_LANGUAGES.has(language)) {
    throw new PeiaTaskQueueError(
      'INVALID_SNAPSHOT_INPUT',
      `language must be one of ar, en, bilingual, other (got "${language}").`
    );
  }

  const notes = sanitizeOptionalMultilineField(input['notes'], 'notes', MAX_LIBRARY_NOTES_CHARS);
  const sourceNotes = sanitizeOptionalMultilineField(
    input['sourceNotes'],
    'sourceNotes',
    MAX_LIBRARY_SOURCE_NOTES_CHARS
  );

  let suppliedExcerpt: string | undefined;
  if (inputBasis === PEIALibraryPreparationInputBasis.MetadataOnly) {
    if (
      Object.prototype.hasOwnProperty.call(input, 'suppliedExcerpt') &&
      input['suppliedExcerpt'] !== undefined
    ) {
      throw new PeiaTaskQueueError(
        'INVALID_SNAPSHOT_INPUT',
        'MetadataOnly LibraryIntake snapshot must not include suppliedExcerpt.'
      );
    }
  } else {
    suppliedExcerpt = sanitizeRequiredMultilineField(
      input['suppliedExcerpt'],
      'suppliedExcerpt',
      MAX_LIBRARY_SUPPLIED_EXCERPT_CHARS
    );
  }

  const snapshotObj: Record<string, unknown> = {
    allowSnapshotEvidence: true,
    inputBasis,
    title,
  };
  if (issuingOrganization !== undefined) {
    snapshotObj['issuingOrganization'] = issuingOrganization;
  }
  if (language !== undefined) {
    snapshotObj['language'] = language;
  }
  if (notes !== undefined) {
    snapshotObj['notes'] = notes;
  }
  if (sourceNotes !== undefined) {
    snapshotObj['sourceNotes'] = sourceNotes;
  }
  if (suppliedExcerpt !== undefined) {
    snapshotObj['suppliedExcerpt'] = suppliedExcerpt;
  }

  const contentSnapshot = Object.freeze(snapshotObj) as ValidatedLibraryIntakeContentSnapshot;
  const formattedLength = computeFormattedWorkerEvidenceLength(target, contentSnapshot);
  if (formattedLength > MAX_WORKER_EVIDENCE_CONTEXT_CHARS) {
    throw new PeiaTaskQueueError(
      'SNAPSHOT_OVERSIZED',
      `Formatted LibraryIntake snapshot evidence (${formattedLength} chars) exceeds worker context limit (${MAX_WORKER_EVIDENCE_CONTEXT_CHARS} chars).`
    );
  }

  return Object.freeze({ target, contentSnapshot });
}

/**
 * Computes a deterministic SHA-256 fingerprint of a validated contentSnapshot.
 */
export function computeSnapshotFingerprint(contentSnapshot: Readonly<Record<string, unknown>>): string {
  if (!isPlainObject(contentSnapshot)) {
    throw new PeiaTaskQueueError('INVALID_SNAPSHOT_INPUT', 'contentSnapshot must be a plain object.');
  }
  return createHash('sha256').update(canonicalJsonSerialize(contentSnapshot), 'utf8').digest('hex');
}

/**
 * Derives a deterministic PEIA taskId strictly from validated source version identity:
 * `targetType + targetId + sourceUpdatedAt`.
 *
 * Snapshot fingerprint is NOT embedded in `taskId`; `contentSnapshot` (when supplied)
 * is validated via `computeSnapshotFingerprint` and used strictly for payload validation
 * and conflict detection.
 *
 * SOURCE-VERSION INTEGRITY NOTE:
 * A single source version `(targetType, targetId, sourceUpdatedAt)` maps to at most one
 * PEIA task. For `LibraryIntake`, different `suppliedExcerpt` values (or any modified
 * metadata) must NOT be submitted under an identical `sourceUpdatedAt`; any excerpt or
 * metadata change must first be persisted as a new authoritative source version by an
 * authorized domain admin action before enqueueing.
 */
export function derivePeiaTaskId(
  target: ReviewTargetIdentity,
  contentSnapshot?: Readonly<Record<string, unknown>>
): string {
  const validatedTarget = validateTargetIdentityInput(
    target.targetType,
    target.targetId,
    target.sourceUpdatedAt
  );
  if (contentSnapshot !== undefined) {
    computeSnapshotFingerprint(contentSnapshot);
  }
  const canonicalIdentityMaterial = `${validatedTarget.targetType}::${validatedTarget.targetId}::${validatedTarget.sourceUpdatedAt}`;
  const digest = createHash('sha256').update(canonicalIdentityMaterial, 'utf8').digest('hex').slice(0, 32);
  return `peia-task-${digest}`;
}

/**
 * Derives the Firestore document ID in `peiaReviewTasks` consistently with
 * `deriveAdvisoryResultDocumentId` and `deriveNonAdvisoryOutcomeDocumentId`.
 */
export function derivePeiaTaskDocumentId(taskId: string): string {
  if (typeof taskId !== 'string' || taskId.trim() === '' || taskId !== taskId.trim()) {
    throw new PeiaTaskQueueError('INVALID_TARGET_IDENTITY', 'taskId must be a non-empty trimmed string.');
  }
  return createHash('sha256').update(taskId, 'utf8').digest('hex');
}

const RECONCILE_INPUT_ALLOWED_KEYS = new Set<string>([
  'taskId',
  'targetType',
  'targetId',
  'currentSourceUpdatedAt',
]);

/**
 * Shared server-side PEIA task queue service for News and LibraryIntake.
 * Strictly operates on canonical PEIA collections (`peiaReviewTasks`,
 * `peiaAdvisoryResults`, `peiaNonAdvisoryOutcomes`) and never mutates
 * domain source records (`news`, `library_intake`) or workflow states.
 *
 * Enforces strict one-task-per-source-version (`targetType + targetId + sourceUpdatedAt`).
 * Any change to a `LibraryIntake` excerpt or `News` content must first become part of a
 * new authoritative source version with an updated `sourceUpdatedAt`; this service never
 * silently alters `sourceUpdatedAt` or generates synthetic version timestamps.
 */
export class FirestorePeiaTaskQueueService {
  private readonly clock: () => string;

  constructor(
    private readonly db: PeiaTaskQueueFirestoreDatabase,
    options?: { readonly clock?: () => string }
  ) {
    this.clock = options?.clock ?? (() => new Date().toISOString());
  }

  /**
   * Enqueues a validated News CONTENT_REVIEW task transactionally and idempotently.
   */
  async enqueueNewsTask(input: AuthoritativeNewsSnapshotInput): Promise<PeiaTaskEnqueueResult> {
    const { target, contentSnapshot } = buildNewsTaskSnapshot(input);
    return this.enqueueValidatedSnapshot(target, contentSnapshot);
  }

  /**
   * Enqueues a validated LibraryIntake CONTENT_REVIEW task transactionally and idempotently.
   *
   * Note: Do not submit different `suppliedExcerpt` values under an identical `sourceUpdatedAt`.
   * A changed excerpt must first be saved as a new authoritative `library_intake` source version.
   */
  async enqueueLibraryIntakeTask(
    input: AuthoritativeLibraryIntakeSnapshotInput
  ): Promise<PeiaTaskEnqueueResult> {
    const { target, contentSnapshot } = buildLibraryIntakeTaskSnapshot(input);
    return this.enqueueValidatedSnapshot(target, contentSnapshot);
  }

  private async enqueueValidatedSnapshot(
    target: ReviewTargetIdentity,
    contentSnapshot: Readonly<Record<string, unknown>>
  ): Promise<PeiaTaskEnqueueResult> {
    if (typeof this.db?.runTransaction !== 'function') {
      throw new PeiaTaskQueueError(
        'TRANSACTION_REQUIRED',
        'Firestore transaction support is required for PEIA task enqueueing.'
      );
    }

    const candidateSnapshotFingerprint = computeSnapshotFingerprint(contentSnapshot);
    const taskId = derivePeiaTaskId(target, contentSnapshot);
    const docId = derivePeiaTaskDocumentId(taskId);

    const taskCollection = this.db.collection(PEIA_PENDING_TASK_COLLECTION);
    const taskDocRef = taskCollection.doc(docId);
    const byTaskIdQuery = taskCollection.where('taskId', '==', taskId).limit(2);

    return this.db.runTransaction(async (transaction) => {
      // Perform all transactional reads strictly before any write
      const docSnap: PeiaTaskQueueDocumentSnapshot = await transaction.get(taskDocRef);
      const taskIdQuerySnap: PeiaTaskQueueQuerySnapshot = await transaction.get(byTaskIdQuery);

      if (taskIdQuerySnap.docs.length > 1) {
        throw new PeiaTaskQueueError(
          'TASK_QUERY_CARDINALITY_INVALID',
          `Multiple task documents found in ${PEIA_PENDING_TASK_COLLECTION} for taskId "${taskId}".`
        );
      }

      if (
        docSnap.exists &&
        taskIdQuerySnap.docs.length === 1 &&
        taskIdQuerySnap.docs[0].ref?.id !== undefined &&
        taskIdQuerySnap.docs[0].ref.id !== docId
      ) {
        throw new PeiaTaskQueueError(
          'TASK_QUERY_CARDINALITY_INVALID',
          `Conflicting document IDs found in ${PEIA_PENDING_TASK_COLLECTION} for taskId "${taskId}".`
        );
      }

      const createdAt = validateIsoTimestamp(
        this.clock(),
        'createdAt',
        'INVALID_CLOCK_TIMESTAMP'
      );

      const candidateTask: AIReviewTask = validateAIReviewTask({
        taskId,
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: target.targetType,
          targetId: target.targetId,
          sourceUpdatedAt: target.sourceUpdatedAt,
        },
        contentSnapshot,
        createdAt,
        status: AITaskStatus.Pending,
      });

      const existingSnapshot = docSnap.exists
        ? docSnap
        : taskIdQuerySnap.docs.length === 1
          ? taskIdQuerySnap.docs[0]
          : null;

      if (existingSnapshot !== null) {
        const existingRaw = existingSnapshot.data();
        let existingTask: AIReviewTask;
        let existingCanonicalTaskId: string;
        let existingSnapshotFingerprint: string;
        try {
          existingTask = validateAIReviewTask(existingRaw);
          existingCanonicalTaskId = derivePeiaTaskId(
            existingTask.target,
            existingTask.contentSnapshot
          );
          existingSnapshotFingerprint = computeSnapshotFingerprint(existingTask.contentSnapshot);
        } catch {
          throw new PeiaTaskQueueError(
            'INVALID_EXISTING_TASK_RECORD',
            `Stored task record for taskId "${taskId}" failed canonical validation.`
          );
        }

        if (
          existingTask.taskId !== candidateTask.taskId ||
          existingCanonicalTaskId !== candidateTask.taskId ||
          !isTaskReferenceEqual(existingTask, candidateTask) ||
          existingSnapshotFingerprint !== candidateSnapshotFingerprint ||
          !isDeepEqual(existingTask.contentSnapshot, candidateTask.contentSnapshot)
        ) {
          throw new PeiaTaskQueueError(
            'TASK_PAYLOAD_CONFLICT',
            `Divergent task payload detected under identical source-version task identity "${taskId}".`
          );
        }

        // Idempotent replay: return existing task without overwriting createdAt or status
        return Object.freeze({
          task: existingTask,
          documentId: docId,
          disposition: 'ALREADY_EXISTS' as const,
        });
      }

      transaction.create(taskDocRef, candidateTask);

      return Object.freeze({
        task: candidateTask,
        documentId: docId,
        disposition: 'CREATED' as const,
      });
    });
  }

  /**
   * Read-only reconciliation of task lifecycle status, advisory result, non-advisory outcome,
   * and stale-source detection. Never mutates task or domain documents.
   */
  async reconcileTaskStatus(
    input: ReconcilePeiaTaskStatusInput
  ): Promise<ReconciledPeiaTaskStatusResult> {
    if (!isPlainObject(input)) {
      throw new PeiaTaskQueueError(
        'INVALID_TARGET_IDENTITY',
        'Reconciliation input must be a plain object.'
      );
    }
    assertAllowedInputKeys(input, RECONCILE_INPUT_ALLOWED_KEYS, 'ReconcilePeiaTaskStatusInput');

    if (typeof this.db?.runTransaction !== 'function') {
      throw new PeiaTaskQueueError(
        'TRANSACTION_REQUIRED',
        'Firestore transaction support is required for PEIA status reconciliation.'
      );
    }

    const target = validateTargetIdentityInput(
      input.targetType,
      input.targetId,
      input.currentSourceUpdatedAt
    );

    if (typeof input.taskId !== 'string') {
      throw new PeiaTaskQueueError('INVALID_TARGET_IDENTITY', 'taskId must be a string.');
    }
    const taskId = input.taskId.trim();
    if (taskId.length === 0 || taskId !== input.taskId || SINGLE_LINE_CONTROL_CHAR_REGEX.test(taskId)) {
      throw new PeiaTaskQueueError(
        'INVALID_TARGET_IDENTITY',
        'taskId must be a non-empty trimmed single-line string.'
      );
    }

    const taskDocId = derivePeiaTaskDocumentId(taskId);
    const advisoryDocId = deriveAdvisoryResultDocumentId(taskId);
    const nonAdvisoryDocId = deriveNonAdvisoryOutcomeDocumentId(taskId);

    const taskCollection = this.db.collection(PEIA_PENDING_TASK_COLLECTION);
    const taskDocRef = taskCollection.doc(taskDocId);
    const taskQuery = taskCollection.where('taskId', '==', taskId).limit(2);
    const advisoryDocRef = this.db.collection(PEIA_ADVISORY_RESULT_COLLECTION).doc(advisoryDocId);
    const nonAdvisoryDocRef = this.db
      .collection(PEIA_NON_ADVISORY_OUTCOME_COLLECTION)
      .doc(nonAdvisoryDocId);

    return this.db.runTransaction(async (transaction) => {
      const taskDocSnap: PeiaTaskQueueDocumentSnapshot = await transaction.get(taskDocRef);
      const taskQuerySnap: PeiaTaskQueueQuerySnapshot = await transaction.get(taskQuery);
      const advisorySnap: PeiaTaskQueueDocumentSnapshot = await transaction.get(advisoryDocRef);
      const nonAdvisorySnap: PeiaTaskQueueDocumentSnapshot = await transaction.get(nonAdvisoryDocRef);

      if (taskQuerySnap.docs.length > 1) {
        throw new PeiaTaskQueueError(
          'RECONCILIATION_INTEGRITY_ERROR',
          `Multiple task documents found for taskId "${taskId}".`
        );
      }

      if (
        taskDocSnap.exists &&
        taskQuerySnap.docs.length === 1 &&
        taskQuerySnap.docs[0].ref?.id !== undefined &&
        taskQuerySnap.docs[0].ref.id !== taskDocId
      ) {
        throw new PeiaTaskQueueError(
          'RECONCILIATION_INTEGRITY_ERROR',
          `Conflicting task document references found for taskId "${taskId}".`
        );
      }

      const resolvedTaskSnap = taskDocSnap.exists
        ? taskDocSnap
        : taskQuerySnap.docs.length === 1
          ? taskQuerySnap.docs[0]
          : null;

      if (resolvedTaskSnap === null) {
        if (advisorySnap.exists || nonAdvisorySnap.exists) {
          throw new PeiaTaskQueueError(
            'RECONCILIATION_INTEGRITY_ERROR',
            `Orphaned result or outcome artifact exists for taskId "${taskId}" without an authoritative task.`
          );
        }

        return Object.freeze({
          status: 'NotRequested' as const,
          taskId,
          targetType: target.targetType,
          targetId: target.targetId,
          currentSourceUpdatedAt: target.sourceUpdatedAt,
          isStale: false as const,
        });
      }

      let task: AIReviewTask;
      try {
        task = validateAIReviewTask(resolvedTaskSnap.data());
      } catch {
        throw new PeiaTaskQueueError(
          'RECONCILIATION_INTEGRITY_ERROR',
          `Authoritative task record for taskId "${taskId}" failed canonical validation.`
        );
      }

      if (
        task.taskId !== taskId ||
        task.target.targetType !== target.targetType ||
        task.target.targetId !== target.targetId
      ) {
        throw new PeiaTaskQueueError(
          'RECONCILIATION_INTEGRITY_ERROR',
          `Authoritative task target (${task.target.targetType}:${task.target.targetId}) does not match requested target (${target.targetType}:${target.targetId}).`
        );
      }

      if (advisorySnap.exists && nonAdvisorySnap.exists) {
        throw new PeiaTaskQueueError(
          'RECONCILIATION_INTEGRITY_ERROR',
          `Conflicting advisory result and non-advisory outcome artifacts exist simultaneously for taskId "${taskId}".`
        );
      }

      const isStale = task.target.sourceUpdatedAt !== target.sourceUpdatedAt;

      if (task.status === AITaskStatus.Pending) {
        if (advisorySnap.exists || nonAdvisorySnap.exists) {
          throw new PeiaTaskQueueError(
            'RECONCILIATION_INTEGRITY_ERROR',
            `Task "${taskId}" is Pending, but an outcome artifact already exists.`
          );
        }

        return Object.freeze({
          status: AITaskStatus.Pending,
          taskId: task.taskId,
          task,
          isStale,
        });
      }

      if (task.status === AITaskStatus.Completed) {
        if (!advisorySnap.exists) {
          throw new PeiaTaskQueueError(
            'RECONCILIATION_INTEGRITY_ERROR',
            `Task "${taskId}" is marked Completed, but the corresponding advisory result artifact is missing.`
          );
        }

        let validatedAdvisoryRecord;
        try {
          validatedAdvisoryRecord = validateExistingAdvisoryRecord(task.taskId, advisorySnap.data());
        } catch {
          throw new PeiaTaskQueueError(
            'RECONCILIATION_INTEGRITY_ERROR',
            `Stored advisory result for Completed task "${taskId}" failed validation.`
          );
        }

        if (
          !isTaskReferenceEqual(task, validatedAdvisoryRecord.reconciledTask) ||
          !isTaskReferenceEqual(task, validatedAdvisoryRecord.advisoryResult.task)
        ) {
          throw new PeiaTaskQueueError(
            'RECONCILIATION_INTEGRITY_ERROR',
            `Stored advisory result reference does not match authoritative task "${taskId}".`
          );
        }

        if (task.target.targetType === AIReviewTargetType.LibraryIntake) {
          const prep = validatedAdvisoryRecord.advisoryResult.libraryPreparation;
          const expectedBasis = task.contentSnapshot['inputBasis'];
          if (!prep || (expectedBasis !== undefined && prep.inputBasis !== expectedBasis)) {
            throw new PeiaTaskQueueError(
              'RECONCILIATION_INTEGRITY_ERROR',
              `LibraryIntake advisory result inputBasis does not match authoritative task snapshot.`
            );
          }
        }

        return Object.freeze({
          status: AITaskStatus.Completed,
          taskId: task.taskId,
          task,
          advisoryResult: validatedAdvisoryRecord.advisoryResult,
          isStale,
        });
      }

      if (task.status === AITaskStatus.Failed) {
        if (!nonAdvisorySnap.exists) {
          throw new PeiaTaskQueueError(
            'RECONCILIATION_INTEGRITY_ERROR',
            `Task "${taskId}" is marked Failed, but the corresponding non-advisory outcome artifact is missing.`
          );
        }

        let validatedNonAdvisoryRecord;
        try {
          validatedNonAdvisoryRecord = validateExistingNonAdvisoryRecord(
            task.taskId,
            nonAdvisorySnap.data()
          );
        } catch {
          throw new PeiaTaskQueueError(
            'RECONCILIATION_INTEGRITY_ERROR',
            `Stored non-advisory outcome for Failed task "${taskId}" failed validation.`
          );
        }

        const expectedStatus = computeConvergedTaskStatus(
          validatedNonAdvisoryRecord.nonAdvisoryOutcome.kind
        );
        if (
          expectedStatus !== AITaskStatus.Failed ||
          validatedNonAdvisoryRecord.convergedStatus !== AITaskStatus.Failed ||
          !isTaskReferenceEqual(task, validatedNonAdvisoryRecord.reconciledTask)
        ) {
          throw new PeiaTaskQueueError(
            'RECONCILIATION_INTEGRITY_ERROR',
            `Stored non-advisory outcome is not coherent with Failed task "${taskId}".`
          );
        }

        return Object.freeze({
          status: AITaskStatus.Failed,
          taskId: task.taskId,
          task,
          nonAdvisoryOutcome: validatedNonAdvisoryRecord.nonAdvisoryOutcome,
          isStale,
        });
      }

      throw new PeiaTaskQueueError(
        'RECONCILIATION_INTEGRITY_ERROR',
        `Unsupported task status "${String(task.status)}".`
      );
    });
  }
}
