import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import type { AdminRepository } from '../admin/adminRepository';
import {
  AdminPermission,
  AdminRole,
  isValidAdminRole,
  type AdminUser,
} from '../shared/adminContract';

export interface EditorialImageRightsRequestContext {
  readonly auth?: {
    readonly uid: string;
    readonly token?: Record<string, unknown>;
  };
}

export type CallableRequestContext = EditorialImageRightsRequestContext;
import { AuditAction } from '../shared/auditContract';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetMetadata,
  type EditorialImageAssetValidationLimits,
  type EditorialImageLicenseType,
  type EditorialImageRightsRecord,
  type EditorialImageUsageScope,
  type RightsReviewStatus,
} from '../types/editorialImageAsset';
import {
  isValidCanonicalUtcTimestamp,
  sanitizeEditorialImageAssetMetadata,
  validateAssetId,
  validateEditorialImageAsset,
  validateEditorialImageRights,
} from '../shared/editorialImageAssetContract';
import {
  cloneRepositoryRecord,
  EDITORIAL_IMAGE_ASSET_COLLECTION,
  EditorialImageAssetRepositoryError,
  INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
  isPositiveSafeIntegerRevision,
  serializeEnvelopeForPersistence,
  validateAndCloneInitialAssetForCreate,
  validateExpectedRevision,
  validatePersistedEditorialImageAssetEnvelope,
  validateRepositoryAssetId,
  type EditorialImageAssetRepositoryRecord,
} from './editorialImageAssetRepository';
import type {
  EditorialImageFirestoreDatabase,
  EditorialImageFirestoreDocumentRef,
} from './firestoreEditorialImageAssetRepository';
import {
  CANONICAL_EVIDENCE_SOURCE_KINDS,
  CANONICAL_EVIDENCE_STATUSES,
  cloneEditorialImageRightsEvidenceRecord,
  EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION,
  isValidEvidenceSourceKind,
  isValidEvidenceStatus,
  serializeEvidenceRecordForPersistence,
  validateEditorialImageRightsEvidenceRecord,
  validateEvidenceId,
  validateRegisterEvidenceInputContract,
  validateRevokeEvidenceInputContract,
  type EditorialImageRightsEvidenceRecord,
  type EditorialImageRightsEvidenceSourceKind,
  type EditorialImageRightsEvidenceStatus,
  type RegisterEditorialImageRightsEvidenceInput,
  type RevokeEditorialImageRightsEvidenceInput,
} from './editorialImageRightsEvidenceContract';

export {
  CANONICAL_EVIDENCE_SOURCE_KINDS,
  CANONICAL_EVIDENCE_STATUSES,
  cloneEditorialImageRightsEvidenceRecord,
  EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION,
  isValidEvidenceSourceKind,
  isValidEvidenceStatus,
  serializeEvidenceRecordForPersistence,
  validateEditorialImageRightsEvidenceRecord,
  validateEvidenceId,
  type EditorialImageRightsEvidenceRecord,
  type EditorialImageRightsEvidenceSourceKind,
  type EditorialImageRightsEvidenceStatus,
  type RegisterEditorialImageRightsEvidenceInput,
  type RevokeEditorialImageRightsEvidenceInput,
};

export const EDITORIAL_IMAGE_ADMINS_COLLECTION = 'admins' as const;

export const EDITORIAL_IMAGE_RIGHTS_REVIEW_REQUEST_COLLECTION =
  'editorial_image_rights_review_requests' as const;

export const EDITORIAL_IMAGE_RIGHTS_AUDIT_COLLECTION =
  'editorial_image_rights_audit_events' as const;

/**
 * Explicit audit target identity for editorial image assets.
 * Never substitutes `AuditTargetType.News` for image asset rights transitions.
 *
 * Compatibility note: `functions/src/shared/auditContract.ts` defines a closed
 * `AuditTargetType` union without `EditorialImageAsset`. To preserve the
 * owner-accepted shared audit contract untouched, image rights transitions emit
 * `EditorialImageAssetRightsAuditEvent` with explicit targetType
 * `'EditorialImageAsset'`.
 */
export const EDITORIAL_IMAGE_AUDIT_TARGET_TYPE = 'EditorialImageAsset' as const;
export type EditorialImageAuditTargetType =
  typeof EDITORIAL_IMAGE_AUDIT_TARGET_TYPE;

export const CANONICAL_RIGHTS_REVIEW_STATUSES: readonly RightsReviewStatus[] = [
  'PendingReview',
  'Approved',
  'Rejected',
  'Revoked',
] as const;

export type RightsDecisionTargetStatus = 'Approved' | 'Rejected' | 'Revoked';

export type ReapprovableRightsStatus = 'Rejected' | 'Revoked';

export type EditorialImageRightsReviewRequestStatus = 'Pending' | 'Consumed';

export type EditorialImageRightsReviewErrorCode =
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_INPUT'
  | 'INVALID_ASSET'
  | 'INVALID_TRANSITION'
  | 'REVIEW_REQUEST_REQUIRED'
  | 'INVALID_REVIEW_REQUEST'
  | 'REVIEW_REQUEST_CONSUMED'
  | 'INVALID_EVIDENCE'
  | 'CONFLICT'
  | 'CLOCK_ROLLBACK'
  | 'PERSISTENCE_FAILURE';

export class EditorialImageRightsReviewError extends Error {
  public readonly code: EditorialImageRightsReviewErrorCode;
  public readonly details: readonly string[];
  public readonly cause?: unknown;

  constructor(
    code: EditorialImageRightsReviewErrorCode,
    message: string,
    details: readonly string[] = [],
    cause?: unknown
  ) {
    super(message);
    this.name = 'EditorialImageRightsReviewError';
    this.code = code;
    this.details = [...details];
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Server-persisted, single-use review request required before transitioning
 * an editorial image asset from `Rejected` or `Revoked` to `Approved`.
 *
 * Security boundary note: Every `submittedEvidenceRefs` entry is verified
 * transactionally against `editorial_image_rights_evidence/{evidenceId}` to
 * confirm an active server-registered evidence record bound to `assetId`, with
 * at least one active record registered strictly after `priorReviewedAtIso`
 * and not present in `priorEvidenceRefs`. That registry proves administrative
 * registration metadata, not legal validity or binary authenticity of external
 * documents.
 */
export interface EditorialImageRightsReviewRequestRecord {
  readonly requestId: string;
  readonly assetId: string;
  readonly assetRevision: number;
  readonly priorRightsStatus: ReapprovableRightsStatus;
  readonly priorReviewedAtIso: string;
  readonly priorEvidenceRefs: readonly string[];
  readonly requestedByUid: string;
  readonly requestedByName: string;
  readonly requestedByRole: AdminRole;
  readonly requestedAtIso: string;
  readonly rationale: string;
  readonly submittedEvidenceRefs: readonly string[];
  readonly status: EditorialImageRightsReviewRequestStatus;
  readonly consumedByUid?: string;
  readonly consumedAtIso?: string;
  readonly consumedByAuditId?: string;
  readonly consumedAtAssetRevision?: number;
}

/**
 * Immutable domain-specific audit record persisted atomically with every
 * editorial image rights state transition.
 */
export interface EditorialImageAssetRightsAuditEvent {
  readonly id: string;
  readonly targetType: EditorialImageAuditTargetType;
  readonly targetId: string;
  readonly assetId: string;
  readonly action: typeof AuditAction.RightsChanged;
  readonly previousRightsStatus: RightsReviewStatus;
  readonly newRightsStatus: RightsReviewStatus;
  readonly previousRevision: number;
  readonly newRevision: number;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly actorRole: AdminRole;
  readonly timestamp: string;
  readonly reviewReason: string;
  readonly reviewRequestId?: string;
  readonly evidenceRefs: readonly string[];
  readonly selfApprovedByOwner: boolean;
}

export interface SubmitEditorialImageRightsReviewRequestInput {
  readonly requestId?: string;
  readonly assetId: string;
  readonly expectedRevision: number;
  readonly rationale: string;
  readonly submittedEvidenceRefs: readonly string[];
}

export interface EditorialImageRightsDecisionInput {
  readonly assetId: string;
  readonly expectedRevision: number;
  readonly targetStatus: RightsDecisionTargetStatus;
  readonly reviewReason: string;
  readonly reviewRequestId?: string;
  readonly licenseType?: EditorialImageLicenseType;
  readonly licenseDetails?: string;
  readonly rightsHolder?: string;
  readonly documentedException?: string;
  readonly sourceAttributionAr?: string;
  readonly sourceAttributionEn?: string;
  readonly evidenceRefs?: readonly string[];
  readonly usageScope?: EditorialImageUsageScope;
}

export interface EditorialImageRightsTransitionResult {
  readonly record: EditorialImageAssetRepositoryRecord;
  readonly auditEvent: EditorialImageAssetRightsAuditEvent;
  readonly consumedReviewRequest?: EditorialImageRightsReviewRequestRecord;
}

export interface AuthenticatedHumanReviewer {
  readonly uid: string;
  readonly name: string;
  readonly email: string;
  readonly role: AdminRole;
}

export interface RegisterAtomicEvidenceParams {
  readonly recorder: AuthenticatedHumanReviewer;
  readonly input: RegisterEditorialImageRightsEvidenceInput;
  readonly evidenceId: string;
  readonly recordedAtIso: string;
}

export interface RevokeAtomicEvidenceParams {
  readonly revoker: AuthenticatedHumanReviewer;
  readonly input: RevokeEditorialImageRightsEvidenceInput;
  readonly revokedAtIso: string;
}

export interface ExecuteAtomicRightsTransitionParams {
  readonly reviewer: AuthenticatedHumanReviewer;
  readonly decision: EditorialImageRightsDecisionInput;
  readonly decisionTimestampIso: string;
  readonly auditEventId: string;
}

export interface CreateAtomicReviewRequestParams {
  readonly requester: AuthenticatedHumanReviewer;
  readonly input: SubmitEditorialImageRightsReviewRequestInput;
  readonly requestId: string;
  readonly requestedAtIso: string;
}

/**
 * Dedicated atomic transaction boundary for editorial image rights evidence
 * registration/revocation, review requests, and rights transitions.
 * Does not expose unrestricted asset replacement on the generic repository.
 */
export interface EditorialImageRightsReviewTransactionRunner {
  registerEvidenceAtomic(
    params: RegisterAtomicEvidenceParams
  ): Promise<EditorialImageRightsEvidenceRecord>;
  revokeEvidenceAtomic(
    params: RevokeAtomicEvidenceParams
  ): Promise<EditorialImageRightsEvidenceRecord>;
  submitReviewRequestAtomic(
    params: CreateAtomicReviewRequestParams
  ): Promise<EditorialImageRightsReviewRequestRecord>;
  transitionRightsAtomic(
    params: ExecuteAtomicRightsTransitionParams
  ): Promise<EditorialImageRightsTransitionResult>;
}

const UID_CHARS_REGEX = /^[a-zA-Z0-9_-]+$/;
const EVIDENCE_REF_CHARS_REGEX = /^[a-zA-Z0-9_.:-]+$/;

const PROHIBITED_URL_OR_TOKEN_PATTERNS = [
  /https?:\/\//i,
  /gs:\/\//i,
  /file:\/\//i,
  /ftp:\/\//i,
  /data:/i,
  /blob:/i,
  /javascript:/i,
  /vbscript:/i,
  /token=/i,
  /access_token=/i,
  /alt=media/i,
  /x-goog-/i,
];

const PROHIBITED_EVIDENCE_PATTERNS = [
  ...PROHIBITED_URL_OR_TOKEN_PATTERNS,
  /^\/\//,
  /[?#]/,
  /editorial_images/i,
  /[\\/]/,
  /\.\./,
  /%/,
  /bearer/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /credential/i,
  /signature/i,
  /access[_-]?token/i,
  /id[_-]?token/i,
  /refresh[_-]?token/i,
];

const ALLOWED_SUBMIT_REQUEST_INPUT_KEYS: ReadonlySet<string> = new Set([
  'requestId',
  'assetId',
  'expectedRevision',
  'rationale',
  'submittedEvidenceRefs',
]);

const ALLOWED_DECISION_INPUT_KEYS: ReadonlySet<string> = new Set([
  'assetId',
  'expectedRevision',
  'targetStatus',
  'reviewReason',
  'reviewRequestId',
  'licenseType',
  'licenseDetails',
  'rightsHolder',
  'documentedException',
  'sourceAttributionAr',
  'sourceAttributionEn',
  'evidenceRefs',
  'usageScope',
]);

const ALLOWED_PERSISTED_REQUEST_KEYS: ReadonlySet<string> = new Set([
  'requestId',
  'assetId',
  'assetRevision',
  'priorRightsStatus',
  'priorReviewedAtIso',
  'priorEvidenceRefs',
  'requestedByUid',
  'requestedByName',
  'requestedByRole',
  'requestedAtIso',
  'rationale',
  'submittedEvidenceRefs',
  'status',
  'consumedByUid',
  'consumedAtIso',
  'consumedByAuditId',
  'consumedAtAssetRevision',
]);

const ALLOWED_PERSISTED_AUDIT_KEYS: ReadonlySet<string> = new Set([
  'id',
  'targetType',
  'targetId',
  'assetId',
  'action',
  'previousRightsStatus',
  'newRightsStatus',
  'previousRevision',
  'newRevision',
  'actorUserId',
  'actorName',
  'actorRole',
  'timestamp',
  'reviewReason',
  'reviewRequestId',
  'evidenceRefs',
  'selfApprovedByOwner',
]);

const VALID_CANONICAL_RIGHTS_STATUS_SET: ReadonlySet<string> = new Set(
  CANONICAL_RIGHTS_REVIEW_STATUSES
);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function getUnexpectedObjectKeys(
  obj: object,
  allowedKeys: ReadonlySet<string>
): string[] {
  const unexpected: string[] = [];
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowedKeys.has(key)) {
      unexpected.push(key);
    }
  }
  for (const sym of Object.getOwnPropertySymbols(obj)) {
    unexpected.push(String(sym));
  }
  return unexpected;
}

function containsProhibitedUrlPattern(value: string): boolean {
  return PROHIBITED_URL_OR_TOKEN_PATTERNS.some((pattern) => pattern.test(value));
}

function containsProhibitedEvidencePattern(value: string): boolean {
  return PROHIBITED_EVIDENCE_PATTERNS.some((pattern) => pattern.test(value));
}

function stripUndefinedRecursively<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedRecursively(entry)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        cleaned[key] = stripUndefinedRecursively(val);
      }
    }
    return cleaned as unknown as T;
  }
  return value;
}

function mapRepositoryError(err: unknown): EditorialImageRightsReviewError {
  if (err instanceof EditorialImageRightsReviewError) {
    return err;
  }
  if (err instanceof EditorialImageAssetRepositoryError) {
    const codeMap: Record<
      EditorialImageAssetRepositoryError['code'],
      EditorialImageRightsReviewErrorCode
    > = {
      NOT_FOUND: 'NOT_FOUND',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      INVALID_ASSET: 'INVALID_ASSET',
      INVALID_PATCH: 'INVALID_INPUT',
      CONFLICT: 'CONFLICT',
      PERSISTENCE_FAILURE: 'PERSISTENCE_FAILURE',
    };
    return new EditorialImageRightsReviewError(
      codeMap[err.code] ?? 'PERSISTENCE_FAILURE',
      err.message,
      err.details,
      err
    );
  }
  const msg =
    err instanceof Error
      ? err.message
      : 'Unexpected rights review persistence failure.';
  return new EditorialImageRightsReviewError(
    'PERSISTENCE_FAILURE',
    msg,
    [msg],
    err
  );
}

export function isAllowedRightsTransition(
  fromStatus: unknown,
  toStatus: unknown
): boolean {
  if (
    typeof fromStatus !== 'string' ||
    typeof toStatus !== 'string' ||
    !VALID_CANONICAL_RIGHTS_STATUS_SET.has(fromStatus) ||
    !VALID_CANONICAL_RIGHTS_STATUS_SET.has(toStatus)
  ) {
    return false;
  }

  if (fromStatus === 'PendingReview') {
    return toStatus === 'Approved' || toStatus === 'Rejected';
  }
  if (fromStatus === 'Approved') {
    return toStatus === 'Revoked';
  }
  if (fromStatus === 'Rejected') {
    return toStatus === 'Approved';
  }
  if (fromStatus === 'Revoked') {
    return toStatus === 'Approved';
  }
  return false;
}

export function validateEvidenceRefsArray(
  refs: unknown,
  fieldLabel: string,
  requireNonEmpty: boolean,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): string[] {
  const maxCount =
    limits.maxEvidenceRefsCount ??
    DEFAULT_ASSET_VALIDATION_LIMITS.maxEvidenceRefsCount ??
    50;
  const maxLen =
    limits.maxEvidenceRefLength ??
    DEFAULT_ASSET_VALIDATION_LIMITS.maxEvidenceRefLength ??
    128;

  if (!Array.isArray(refs)) {
    const detail = `${fieldLabel} must be an array of opaque evidence reference strings.`;
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }

  if (requireNonEmpty && refs.length === 0) {
    const detail = `${fieldLabel} must contain at least one evidence reference.`;
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }

  if (refs.length > maxCount) {
    const detail = `${fieldLabel} count must not exceed ${maxCount}.`;
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const validated: string[] = [];

  refs.forEach((ref, idx) => {
    if (typeof ref !== 'string' || ref.trim().length === 0) {
      errors.push(`${fieldLabel}[${idx}] must be a non-empty string.`);
      return;
    }
    if (ref !== ref.trim() || /\s/.test(ref)) {
      errors.push(`${fieldLabel}[${idx}] must not contain whitespace.`);
      return;
    }
    if (ref.length > maxLen) {
      errors.push(
        `${fieldLabel}[${idx}] length must not exceed ${maxLen} characters.`
      );
      return;
    }
    if (containsProhibitedEvidencePattern(ref)) {
      errors.push(
        `${fieldLabel}[${idx}] must be an opaque identifier and must not contain URLs, paths, tokens, or credentials.`
      );
      return;
    }
    if (!EVIDENCE_REF_CHARS_REGEX.test(ref)) {
      errors.push(
        `${fieldLabel}[${idx}] contains disallowed characters; only alphanumeric, '_', '-', '.', and ':' are permitted.`
      );
      return;
    }
    if (seen.has(ref)) {
      errors.push(
        `${fieldLabel} contains duplicate evidence reference "${ref}".`
      );
      return;
    }
    seen.add(ref);
    validated.push(ref);
  });

  if (errors.length > 0) {
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Invalid ${fieldLabel}:\n- ${errors.join('\n- ')}`,
      errors
    );
  }

  return validated;
}

function validateNonEmptyReasonText(
  value: unknown,
  fieldLabel: string,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): string {
  const maxReasonLength =
    limits.maxReviewReasonLength ??
    DEFAULT_ASSET_VALIDATION_LIMITS.maxReviewReasonLength ??
    1000;

  if (typeof value !== 'string' || value.trim().length === 0) {
    const detail = `${fieldLabel} must be a non-empty string.`;
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }
  if (value !== value.trim()) {
    const detail = `${fieldLabel} must not contain leading or trailing whitespace.`;
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }
  if (value.length > maxReasonLength) {
    const detail = `${fieldLabel} length must not exceed ${maxReasonLength} characters.`;
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }
  if (containsProhibitedUrlPattern(value)) {
    const detail = `${fieldLabel} contains prohibited URL or token patterns.`;
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }
  return value;
}

export function validateSubmitReviewRequestInput(
  rawInput: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): SubmitEditorialImageRightsReviewRequestInput {
  if (!isPlainObject(rawInput)) {
    const detail =
      'Review request submission input must be a plain non-null object.';
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }

  const unexpectedKeys = getUnexpectedObjectKeys(
    rawInput,
    ALLOWED_SUBMIT_REQUEST_INPUT_KEYS
  );
  if (unexpectedKeys.length > 0) {
    const details = unexpectedKeys.map(
      (key) =>
        `Unexpected or spoofed field "${key}" on review request submission input.`
    );
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Disallowed fields in review request submission input:\n- ${details.join('\n- ')}`,
      details
    );
  }

  const assetIdValidation = validateAssetId(rawInput.assetId, limits);
  if (!assetIdValidation.valid) {
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Invalid assetId: ${assetIdValidation.errors.join(' ')}`,
      assetIdValidation.errors
    );
  }

  if (!isPositiveSafeIntegerRevision(rawInput.expectedRevision)) {
    const detail = 'expectedRevision must be a positive safe integer (>= 1).';
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }

  let validatedRequestId: string | undefined;
  if (rawInput.requestId !== undefined) {
    const reqIdValidation = validateAssetId(rawInput.requestId, limits);
    if (!reqIdValidation.valid) {
      const details = reqIdValidation.errors.map(
        (e) => `Invalid requestId: ${e}`
      );
      throw new EditorialImageRightsReviewError(
        'INVALID_INPUT',
        details.join(' '),
        details
      );
    }
    validatedRequestId = rawInput.requestId as string;
  }

  const rationale = validateNonEmptyReasonText(
    rawInput.rationale,
    'rationale',
    limits
  );
  const submittedEvidenceRefs = validateEvidenceRefsArray(
    rawInput.submittedEvidenceRefs,
    'submittedEvidenceRefs',
    true,
    limits
  );

  const result: SubmitEditorialImageRightsReviewRequestInput = {
    assetId: rawInput.assetId as string,
    expectedRevision: rawInput.expectedRevision,
    rationale,
    submittedEvidenceRefs,
    ...(validatedRequestId !== undefined
      ? { requestId: validatedRequestId }
      : {}),
  };

  return result;
}

export function validateRightsDecisionInput(
  rawInput: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageRightsDecisionInput {
  if (!isPlainObject(rawInput)) {
    const detail = 'Rights review decision input must be a plain non-null object.';
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }

  const unexpectedKeys = getUnexpectedObjectKeys(
    rawInput,
    ALLOWED_DECISION_INPUT_KEYS
  );
  if (unexpectedKeys.length > 0) {
    const details = unexpectedKeys.map(
      (key) =>
        `Unexpected or spoofed field "${key}" on rights review decision input.`
    );
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Disallowed fields in rights review decision input:\n- ${details.join('\n- ')}`,
      details
    );
  }

  const assetIdValidation = validateAssetId(rawInput.assetId, limits);
  if (!assetIdValidation.valid) {
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Invalid assetId: ${assetIdValidation.errors.join(' ')}`,
      assetIdValidation.errors
    );
  }

  if (!isPositiveSafeIntegerRevision(rawInput.expectedRevision)) {
    const detail = 'expectedRevision must be a positive safe integer (>= 1).';
    throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
      detail,
    ]);
  }

  if (
    typeof rawInput.targetStatus !== 'string' ||
    !VALID_CANONICAL_RIGHTS_STATUS_SET.has(rawInput.targetStatus)
  ) {
    const detail = `targetStatus must be a valid canonical rights status (${CANONICAL_RIGHTS_REVIEW_STATUSES.join(', ')}), received "${String(rawInput.targetStatus)}".`;
    throw new EditorialImageRightsReviewError('INVALID_TRANSITION', detail, [
      detail,
    ]);
  }

  if (rawInput.targetStatus === 'PendingReview') {
    const detail =
      'Cannot transition an editorial image asset back to "PendingReview".';
    throw new EditorialImageRightsReviewError('INVALID_TRANSITION', detail, [
      detail,
    ]);
  }

  const targetStatus = rawInput.targetStatus as RightsDecisionTargetStatus;
  const reviewReason = validateNonEmptyReasonText(
    rawInput.reviewReason,
    'reviewReason',
    limits
  );

  let reviewRequestId: string | undefined;
  if (rawInput.reviewRequestId !== undefined) {
    const reqIdCheck = validateAssetId(rawInput.reviewRequestId, limits);
    if (!reqIdCheck.valid) {
      const details = reqIdCheck.errors.map(
        (e) => `Invalid reviewRequestId: ${e}`
      );
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        details.join(' '),
        details
      );
    }
    reviewRequestId = rawInput.reviewRequestId as string;
  }

  let evidenceRefs: readonly string[] | undefined;
  if (rawInput.evidenceRefs !== undefined) {
    evidenceRefs = validateEvidenceRefsArray(
      rawInput.evidenceRefs,
      'evidenceRefs',
      false,
      limits
    );
  }

  let clonedUsageScope: EditorialImageUsageScope | undefined;
  if (rawInput.usageScope !== undefined) {
    if (!isPlainObject(rawInput.usageScope)) {
      const detail = 'usageScope must be a plain non-null object.';
      throw new EditorialImageRightsReviewError('INVALID_INPUT', detail, [
        detail,
      ]);
    }
    clonedUsageScope = {
      scopeType: rawInput.usageScope.scopeType as EditorialImageUsageScope['scopeType'],
      ...(rawInput.usageScope.articleIds !== undefined
        ? {
            articleIds: Array.isArray(rawInput.usageScope.articleIds)
              ? ([...rawInput.usageScope.articleIds] as string[])
              : (rawInput.usageScope.articleIds as unknown as string[]),
          }
        : {}),
    };
  }

  return {
    assetId: rawInput.assetId as string,
    expectedRevision: rawInput.expectedRevision,
    targetStatus,
    reviewReason,
    ...(reviewRequestId !== undefined ? { reviewRequestId } : {}),
    ...(rawInput.licenseType !== undefined
      ? { licenseType: rawInput.licenseType as EditorialImageLicenseType }
      : {}),
    ...(rawInput.licenseDetails !== undefined
      ? { licenseDetails: rawInput.licenseDetails as string }
      : {}),
    ...(rawInput.rightsHolder !== undefined
      ? { rightsHolder: rawInput.rightsHolder as string }
      : {}),
    ...(rawInput.documentedException !== undefined
      ? { documentedException: rawInput.documentedException as string }
      : {}),
    ...(rawInput.sourceAttributionAr !== undefined
      ? { sourceAttributionAr: rawInput.sourceAttributionAr as string }
      : {}),
    ...(rawInput.sourceAttributionEn !== undefined
      ? { sourceAttributionEn: rawInput.sourceAttributionEn as string }
      : {}),
    ...(evidenceRefs !== undefined ? { evidenceRefs } : {}),
    ...(clonedUsageScope !== undefined ? { usageScope: clonedUsageScope } : {}),
  };
}

export function validatePersistedReviewRequestRecord(
  expectedRequestId: string,
  rawRecord: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageRightsReviewRequestRecord {
  const reqIdValidation = validateAssetId(expectedRequestId, limits);
  if (!reqIdValidation.valid) {
    throw new EditorialImageRightsReviewError(
      'INVALID_REVIEW_REQUEST',
      `Invalid reviewRequestId "${expectedRequestId}".`,
      reqIdValidation.errors
    );
  }

  if (!isPlainObject(rawRecord)) {
    const detail = `Corrupted review request "${expectedRequestId}": record must be a plain object.`;
    throw new EditorialImageRightsReviewError(
      'INVALID_REVIEW_REQUEST',
      detail,
      [detail]
    );
  }

  const errors: string[] = [];
  const unexpectedKeys = getUnexpectedObjectKeys(
    rawRecord,
    ALLOWED_PERSISTED_REQUEST_KEYS
  );
  for (const key of unexpectedKeys) {
    errors.push(`Unexpected field "${key}" on persisted review request.`);
  }

  if (rawRecord.requestId !== expectedRequestId) {
    errors.push(
      `Persisted review request ID "${String(rawRecord.requestId)}" does not match expected ID "${expectedRequestId}".`
    );
  }

  const assetIdCheck = validateAssetId(rawRecord.assetId, limits);
  if (!assetIdCheck.valid) {
    errors.push(...assetIdCheck.errors);
  }

  if (!isPositiveSafeIntegerRevision(rawRecord.assetRevision)) {
    errors.push('Persisted review request assetRevision must be a positive safe integer.');
  }

  if (
    rawRecord.priorRightsStatus !== 'Rejected' &&
    rawRecord.priorRightsStatus !== 'Revoked'
  ) {
    errors.push(
      'Persisted review request priorRightsStatus must be "Rejected" or "Revoked".'
    );
  }

  if (!isValidCanonicalUtcTimestamp(rawRecord.priorReviewedAtIso)) {
    errors.push(
      'Persisted review request priorReviewedAtIso must be a valid canonical UTC timestamp.'
    );
  }

  if (
    typeof rawRecord.requestedByUid !== 'string' ||
    !UID_CHARS_REGEX.test(rawRecord.requestedByUid)
  ) {
    errors.push('Persisted review request requestedByUid is invalid.');
  }

  if (
    typeof rawRecord.requestedByName !== 'string' ||
    rawRecord.requestedByName.trim().length === 0
  ) {
    errors.push('Persisted review request requestedByName must be a non-empty string.');
  }

  if (
    !isValidAdminRole(rawRecord.requestedByRole) ||
    rawRecord.requestedByRole === AdminRole.AIAssistant
  ) {
    errors.push('Persisted review request requestedByRole must be a valid human AdminRole.');
  }

  if (!isValidCanonicalUtcTimestamp(rawRecord.requestedAtIso)) {
    errors.push(
      'Persisted review request requestedAtIso must be a valid canonical UTC timestamp.'
    );
  }

  if (
    isValidCanonicalUtcTimestamp(rawRecord.priorReviewedAtIso) &&
    isValidCanonicalUtcTimestamp(rawRecord.requestedAtIso) &&
    Date.parse(rawRecord.requestedAtIso) <=
      Date.parse(rawRecord.priorReviewedAtIso)
  ) {
    errors.push(
      'Persisted review request requestedAtIso must be strictly later than priorReviewedAtIso.'
    );
  }

  let priorEvidenceRefs: string[] = [];
  try {
    priorEvidenceRefs = validateEvidenceRefsArray(
      rawRecord.priorEvidenceRefs,
      'priorEvidenceRefs',
      false,
      limits
    );
  } catch (err) {
    if (err instanceof EditorialImageRightsReviewError) {
      errors.push(...err.details);
    } else {
      errors.push('Invalid priorEvidenceRefs on persisted review request.');
    }
  }

  let submittedEvidenceRefs: string[] = [];
  try {
    submittedEvidenceRefs = validateEvidenceRefsArray(
      rawRecord.submittedEvidenceRefs,
      'submittedEvidenceRefs',
      true,
      limits
    );
  } catch (err) {
    if (err instanceof EditorialImageRightsReviewError) {
      errors.push(...err.details);
    } else {
      errors.push('Invalid submittedEvidenceRefs on persisted review request.');
    }
  }

  let rationale = '';
  try {
    rationale = validateNonEmptyReasonText(
      rawRecord.rationale,
      'rationale',
      limits
    );
  } catch (err) {
    if (err instanceof EditorialImageRightsReviewError) {
      errors.push(...err.details);
    } else {
      errors.push('Invalid rationale on persisted review request.');
    }
  }

  if (rawRecord.status !== 'Pending' && rawRecord.status !== 'Consumed') {
    errors.push('Persisted review request status must be "Pending" or "Consumed".');
  } else if (rawRecord.status === 'Pending') {
    if (
      rawRecord.consumedByUid !== undefined ||
      rawRecord.consumedAtIso !== undefined ||
      rawRecord.consumedByAuditId !== undefined ||
      rawRecord.consumedAtAssetRevision !== undefined
    ) {
      errors.push(
        'Pending review request must not contain consumption metadata.'
      );
    }
  } else if (rawRecord.status === 'Consumed') {
    if (
      typeof rawRecord.consumedByUid !== 'string' ||
      !UID_CHARS_REGEX.test(rawRecord.consumedByUid)
    ) {
      errors.push('Consumed review request requires valid consumedByUid.');
    }
    if (!isValidCanonicalUtcTimestamp(rawRecord.consumedAtIso)) {
      errors.push('Consumed review request requires valid consumedAtIso.');
    }
    if (
      typeof rawRecord.consumedByAuditId !== 'string' ||
      rawRecord.consumedByAuditId.trim().length === 0
    ) {
      errors.push('Consumed review request requires valid consumedByAuditId.');
    }
    if (!isPositiveSafeIntegerRevision(rawRecord.consumedAtAssetRevision)) {
      errors.push(
        'Consumed review request requires positive safe integer consumedAtAssetRevision.'
      );
    }
  }

  if (errors.length > 0) {
    throw new EditorialImageRightsReviewError(
      'INVALID_REVIEW_REQUEST',
      `Invalid persisted review request "${expectedRequestId}":\n- ${errors.join('\n- ')}`,
      errors
    );
  }

  return {
    requestId: expectedRequestId,
    assetId: rawRecord.assetId as string,
    assetRevision: rawRecord.assetRevision as number,
    priorRightsStatus: rawRecord.priorRightsStatus as ReapprovableRightsStatus,
    priorReviewedAtIso: rawRecord.priorReviewedAtIso as string,
    priorEvidenceRefs: [...priorEvidenceRefs],
    requestedByUid: rawRecord.requestedByUid as string,
    requestedByName: (rawRecord.requestedByName as string).trim(),
    requestedByRole: rawRecord.requestedByRole as AdminRole,
    requestedAtIso: rawRecord.requestedAtIso as string,
    rationale,
    submittedEvidenceRefs: [...submittedEvidenceRefs],
    status: rawRecord.status as EditorialImageRightsReviewRequestStatus,
    ...(rawRecord.consumedByUid !== undefined
      ? { consumedByUid: rawRecord.consumedByUid as string }
      : {}),
    ...(rawRecord.consumedAtIso !== undefined
      ? { consumedAtIso: rawRecord.consumedAtIso as string }
      : {}),
    ...(rawRecord.consumedByAuditId !== undefined
      ? { consumedByAuditId: rawRecord.consumedByAuditId as string }
      : {}),
    ...(rawRecord.consumedAtAssetRevision !== undefined
      ? { consumedAtAssetRevision: rawRecord.consumedAtAssetRevision as number }
      : {}),
  };
}

export function cloneReviewRequestRecord(
  record: EditorialImageRightsReviewRequestRecord,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageRightsReviewRequestRecord {
  return validatePersistedReviewRequestRecord(record.requestId, record, limits);
}

export function validateAuditEventRecord(
  rawAudit: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetRightsAuditEvent {
  if (!isPlainObject(rawAudit)) {
    const detail = 'Editorial image rights audit event must be a plain object.';
    throw new EditorialImageRightsReviewError('PERSISTENCE_FAILURE', detail, [
      detail,
    ]);
  }

  const errors: string[] = [];
  const unexpectedKeys = getUnexpectedObjectKeys(
    rawAudit,
    ALLOWED_PERSISTED_AUDIT_KEYS
  );
  for (const key of unexpectedKeys) {
    errors.push(`Unexpected property "${key}" on rights audit event.`);
  }

  if (typeof rawAudit.id !== 'string' || rawAudit.id.trim().length === 0) {
    errors.push('Audit event id must be a non-empty string.');
  }

  if (rawAudit.targetType !== EDITORIAL_IMAGE_AUDIT_TARGET_TYPE) {
    errors.push(
      `Audit event targetType must be "${EDITORIAL_IMAGE_AUDIT_TARGET_TYPE}", received "${String(rawAudit.targetType)}".`
    );
  }

  const assetIdCheck = validateAssetId(rawAudit.assetId, limits);
  if (!assetIdCheck.valid) {
    errors.push(...assetIdCheck.errors);
  }

  if (rawAudit.targetId !== rawAudit.assetId) {
    errors.push('Audit event targetId must equal assetId.');
  }

  if (rawAudit.action !== AuditAction.RightsChanged) {
    errors.push(
      `Audit event action must be "${AuditAction.RightsChanged}", received "${String(rawAudit.action)}".`
    );
  }

  if (
    typeof rawAudit.previousRightsStatus !== 'string' ||
    !VALID_CANONICAL_RIGHTS_STATUS_SET.has(rawAudit.previousRightsStatus)
  ) {
    errors.push('Audit event previousRightsStatus is invalid.');
  }

  if (
    typeof rawAudit.newRightsStatus !== 'string' ||
    !VALID_CANONICAL_RIGHTS_STATUS_SET.has(rawAudit.newRightsStatus)
  ) {
    errors.push('Audit event newRightsStatus is invalid.');
  }

  if (
    !isPositiveSafeIntegerRevision(rawAudit.previousRevision) ||
    !isPositiveSafeIntegerRevision(rawAudit.newRevision) ||
    rawAudit.newRevision !== rawAudit.previousRevision + 1
  ) {
    errors.push(
      'Audit event revisions must be positive safe integers with newRevision === previousRevision + 1.'
    );
  }

  if (
    typeof rawAudit.actorUserId !== 'string' ||
    !UID_CHARS_REGEX.test(rawAudit.actorUserId)
  ) {
    errors.push('Audit event actorUserId must be a valid UID.');
  }

  if (
    typeof rawAudit.actorName !== 'string' ||
    rawAudit.actorName.trim().length === 0
  ) {
    errors.push('Audit event actorName must be a non-empty string.');
  }

  if (
    !isValidAdminRole(rawAudit.actorRole) ||
    rawAudit.actorRole === AdminRole.AIAssistant
  ) {
    errors.push('Audit event actorRole must be a valid human AdminRole.');
  }

  if (!isValidCanonicalUtcTimestamp(rawAudit.timestamp)) {
    errors.push('Audit event timestamp must be a valid canonical UTC timestamp.');
  }

  let reviewReason = '';
  try {
    reviewReason = validateNonEmptyReasonText(
      rawAudit.reviewReason,
      'auditEvent.reviewReason',
      limits
    );
  } catch (err) {
    if (err instanceof EditorialImageRightsReviewError) {
      errors.push(...err.details);
    } else {
      errors.push('Invalid reviewReason on audit event.');
    }
  }

  if (rawAudit.reviewRequestId !== undefined) {
    const reqIdCheck = validateAssetId(rawAudit.reviewRequestId, limits);
    if (!reqIdCheck.valid) {
      errors.push(...reqIdCheck.errors);
    }
  }

  let evidenceRefs: string[] = [];
  try {
    evidenceRefs = validateEvidenceRefsArray(
      rawAudit.evidenceRefs,
      'auditEvent.evidenceRefs',
      rawAudit.newRightsStatus === 'Approved',
      limits
    );
  } catch (err) {
    if (err instanceof EditorialImageRightsReviewError) {
      errors.push(...err.details);
    } else {
      errors.push('Invalid evidenceRefs on audit event.');
    }
  }

  if (typeof rawAudit.selfApprovedByOwner !== 'boolean') {
    errors.push('Audit event selfApprovedByOwner must be a boolean.');
  }

  if (errors.length > 0) {
    throw new EditorialImageRightsReviewError(
      'PERSISTENCE_FAILURE',
      `Invalid editorial image rights audit event:\n- ${errors.join('\n- ')}`,
      errors
    );
  }

  return {
    id: rawAudit.id as string,
    targetType: EDITORIAL_IMAGE_AUDIT_TARGET_TYPE,
    targetId: rawAudit.targetId as string,
    assetId: rawAudit.assetId as string,
    action: AuditAction.RightsChanged,
    previousRightsStatus: rawAudit.previousRightsStatus as RightsReviewStatus,
    newRightsStatus: rawAudit.newRightsStatus as RightsReviewStatus,
    previousRevision: rawAudit.previousRevision as number,
    newRevision: rawAudit.newRevision as number,
    actorUserId: rawAudit.actorUserId as string,
    actorName: (rawAudit.actorName as string).trim(),
    actorRole: rawAudit.actorRole as AdminRole,
    timestamp: rawAudit.timestamp as string,
    reviewReason,
    ...(rawAudit.reviewRequestId !== undefined
      ? { reviewRequestId: rawAudit.reviewRequestId as string }
      : {}),
    evidenceRefs: [...evidenceRefs],
    selfApprovedByOwner: rawAudit.selfApprovedByOwner as boolean,
  };
}

export function validateAdminRecordForRightsManagement(
  expectedUid: string,
  rawAdmin: unknown
): AuthenticatedHumanReviewer {
  if (!isPlainObject(rawAdmin)) {
    const detail =
      'PERMISSION_DENIED: Administrative account is not registered (ADMIN_NOT_REGISTERED).';
    throw new EditorialImageRightsReviewError('PERMISSION_DENIED', detail, [
      detail,
    ]);
  }

  if (
    typeof rawAdmin.id !== 'string' ||
    rawAdmin.id.trim().length === 0 ||
    rawAdmin.id.trim() !== expectedUid ||
    !UID_CHARS_REGEX.test(rawAdmin.id.trim())
  ) {
    const detail =
      'PERMISSION_DENIED: Canonical AdminUser record has an invalid or mismatched UID.';
    throw new EditorialImageRightsReviewError('PERMISSION_DENIED', detail, [
      detail,
    ]);
  }

  if (rawAdmin.isActive !== true) {
    const detail =
      'PERMISSION_DENIED: Administrative account is inactive (ADMIN_INACTIVE).';
    throw new EditorialImageRightsReviewError('PERMISSION_DENIED', detail, [
      detail,
    ]);
  }

  if (!isValidAdminRole(rawAdmin.role)) {
    const detail =
      'PERMISSION_DENIED: Administrative account does not have a valid canonical role (INVALID_ADMIN_ROLE).';
    throw new EditorialImageRightsReviewError('PERMISSION_DENIED', detail, [
      detail,
    ]);
  }

  if (rawAdmin.role === AdminRole.AIAssistant) {
    const detail =
      'PERMISSION_DENIED: Automated AI accounts are forbidden from performing editorial image rights operations (AI_APPROVAL_FORBIDDEN).';
    throw new EditorialImageRightsReviewError('PERMISSION_DENIED', detail, [
      detail,
    ]);
  }

  const candidateAdmin: AdminUser = {
    id: rawAdmin.id.trim(),
    name:
      typeof rawAdmin.name === 'string' && rawAdmin.name.trim().length > 0
        ? rawAdmin.name.trim()
        : rawAdmin.id.trim(),
    email: typeof rawAdmin.email === 'string' ? rawAdmin.email.trim() : '',
    role: rawAdmin.role,
    isActive: true,
  };

  if (
    !AdminAuthorizationService.hasPermission(
      candidateAdmin,
      AdminPermission.ManageRights
    )
  ) {
    const detail = `PERMISSION_DENIED: Insufficient permissions. Required: ${AdminPermission.ManageRights} (INSUFFICIENT_PERMISSION).`;
    throw new EditorialImageRightsReviewError('PERMISSION_DENIED', detail, [
      detail,
    ]);
  }

  return {
    uid: candidateAdmin.id,
    name: candidateAdmin.name,
    email: candidateAdmin.email,
    role: candidateAdmin.role,
  };
}

export function validatePersistedEvidenceRecord(
  expectedEvidenceId: string,
  rawRecord: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageRightsEvidenceRecord {
  const idValidation = validateEvidenceId(expectedEvidenceId, limits);
  if (!idValidation.valid) {
    throw new EditorialImageRightsReviewError(
      'INVALID_EVIDENCE',
      `Invalid evidenceId "${expectedEvidenceId}".`,
      idValidation.errors
    );
  }

  if (!isPlainObject(rawRecord)) {
    const detail = `Corrupted rights evidence record "${expectedEvidenceId}": record must be a plain object.`;
    throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
      detail,
    ]);
  }

  const recordValidation = validateEditorialImageRightsEvidenceRecord(
    rawRecord,
    limits
  );
  const errors = [...recordValidation.errors];
  if (rawRecord.evidenceId !== expectedEvidenceId) {
    errors.push(
      `Persisted evidence record ID "${String(rawRecord.evidenceId)}" does not match expected ID "${expectedEvidenceId}".`
    );
  }

  if (errors.length > 0) {
    throw new EditorialImageRightsReviewError(
      'INVALID_EVIDENCE',
      `Invalid persisted rights evidence record "${expectedEvidenceId}":\n- ${errors.join('\n- ')}`,
      errors
    );
  }

  return cloneEditorialImageRightsEvidenceRecord(
    rawRecord as unknown as EditorialImageRightsEvidenceRecord
  );
}

export function validateRegisterEvidenceInput(
  rawInput: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): RegisterEditorialImageRightsEvidenceInput {
  const res = validateRegisterEvidenceInputContract(rawInput, limits);
  if (!res.valid || !res.value) {
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Invalid evidence registration input:\n- ${res.errors.join('\n- ')}`,
      res.errors
    );
  }
  return res.value;
}

export function validateRevokeEvidenceInput(
  rawInput: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): RevokeEditorialImageRightsEvidenceInput {
  const res = validateRevokeEvidenceInputContract(rawInput, limits);
  if (!res.valid || !res.value) {
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Invalid evidence revocation input:\n- ${res.errors.join('\n- ')}`,
      res.errors
    );
  }
  return res.value;
}

export function buildValidatedEvidenceRegistration(
  currentRecord: EditorialImageAssetRepositoryRecord,
  params: RegisterAtomicEvidenceParams,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageRightsEvidenceRecord {
  const { recorder, input, evidenceId, recordedAtIso } = params;

  if (!isValidCanonicalUtcTimestamp(recordedAtIso)) {
    const detail =
      'Server clock produced a non-canonical UTC timestamp for evidence registration.';
    throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
      detail,
    ]);
  }

  if (currentRecord.asset.status !== 'active') {
    const detail = `Cannot register rights evidence for asset "${currentRecord.assetId}" because its lifecycle status is "${currentRecord.asset.status}" (must be "active").`;
    throw new EditorialImageRightsReviewError('INVALID_TRANSITION', detail, [
      detail,
    ]);
  }

  if (Date.parse(recordedAtIso) < Date.parse(currentRecord.asset.createdAtIso)) {
    const detail = `Clock rollback detected when registering evidence for asset "${currentRecord.assetId}": recordedAtIso (${recordedAtIso}) precedes asset createdAtIso (${currentRecord.asset.createdAtIso}).`;
    throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
      detail,
    ]);
  }

  const candidate: EditorialImageRightsEvidenceRecord = {
    evidenceId,
    assetId: currentRecord.assetId,
    status: 'Active',
    sourceKind: input.sourceKind,
    sourceReference: input.sourceReference,
    summary: input.summary,
    ...(input.artifactSha256 !== undefined
      ? { artifactSha256: input.artifactSha256 }
      : {}),
    recordedByUid: recorder.uid,
    recordedAtIso,
  };

  return validatePersistedEvidenceRecord(evidenceId, candidate, limits);
}

export function buildValidatedEvidenceRevocation(
  existingEvidence: EditorialImageRightsEvidenceRecord,
  params: RevokeAtomicEvidenceParams,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageRightsEvidenceRecord {
  const { revoker, input, revokedAtIso } = params;

  if (!isValidCanonicalUtcTimestamp(revokedAtIso)) {
    const detail =
      'Server clock produced a non-canonical UTC timestamp for evidence revocation.';
    throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
      detail,
    ]);
  }

  if (
    input.assetId !== undefined &&
    existingEvidence.assetId !== input.assetId
  ) {
    const detail = `Evidence record "${existingEvidence.evidenceId}" belongs to asset "${existingEvidence.assetId}", not "${input.assetId}".`;
    throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
      detail,
    ]);
  }

  if (existingEvidence.status !== 'Active') {
    const detail = `Evidence record "${existingEvidence.evidenceId}" is already "${existingEvidence.status}" and cannot be revoked again.`;
    throw new EditorialImageRightsReviewError('CONFLICT', detail, [detail]);
  }

  if (Date.parse(revokedAtIso) < Date.parse(existingEvidence.recordedAtIso)) {
    const detail = `Clock rollback detected when revoking evidence "${existingEvidence.evidenceId}": revokedAtIso (${revokedAtIso}) precedes recordedAtIso (${existingEvidence.recordedAtIso}).`;
    throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
      detail,
    ]);
  }

  const candidate: EditorialImageRightsEvidenceRecord = {
    ...existingEvidence,
    status: 'Revoked',
    revokedByUid: revoker.uid,
    revokedAtIso,
    revocationReason: input.revocationReason,
  };

  return validatePersistedEvidenceRecord(
    existingEvidence.evidenceId,
    candidate,
    limits
  );
}

export function verifyEvidenceRecordsForReviewRequest(
  currentRecord: EditorialImageAssetRepositoryRecord,
  requestRecord: EditorialImageRightsReviewRequestRecord,
  rawEvidenceMap: ReadonlyMap<string, unknown>,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): void {
  const requestedAtMs = Date.parse(requestRecord.requestedAtIso);
  const priorReviewedAtMs = Date.parse(requestRecord.priorReviewedAtIso);
  const priorEvidenceSet = new Set(requestRecord.priorEvidenceRefs);

  const verifiedNewPostDecisionRecords: EditorialImageRightsEvidenceRecord[] =
    [];

  for (const evidenceId of requestRecord.submittedEvidenceRefs) {
    if (!rawEvidenceMap.has(evidenceId)) {
      const detail = `Referenced rights evidence "${evidenceId}" is not registered in "${EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION}".`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }

    const evRecord = validatePersistedEvidenceRecord(
      evidenceId,
      rawEvidenceMap.get(evidenceId),
      limits
    );

    if (evRecord.assetId !== currentRecord.assetId) {
      const detail = `Referenced rights evidence "${evidenceId}" is bound to asset "${evRecord.assetId}", not "${currentRecord.assetId}".`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }

    if (evRecord.status !== 'Active') {
      const detail = `Referenced rights evidence "${evidenceId}" has status "${evRecord.status}" (must be "Active").`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }

    const recordedAtMs = Date.parse(evRecord.recordedAtIso);
    if (recordedAtMs > requestedAtMs) {
      const detail = `Referenced rights evidence "${evidenceId}" has future recordedAtIso (${evRecord.recordedAtIso}) relative to review request timestamp (${requestRecord.requestedAtIso}).`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }

    if (!priorEvidenceSet.has(evidenceId) && recordedAtMs > priorReviewedAtMs) {
      verifiedNewPostDecisionRecords.push(evRecord);
    }
  }

  if (verifiedNewPostDecisionRecords.length === 0) {
    const detail = `Review request "${requestRecord.requestId}" for "${requestRecord.priorRightsStatus}" asset "${currentRecord.assetId}" requires at least one active evidence record registered strictly after the prior decision timestamp (${requestRecord.priorReviewedAtIso}) and not present in priorEvidenceRefs.`;
    throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
      detail,
    ]);
  }
}

export function verifyEvidenceRecordsForRightsTransition(
  currentRecord: EditorialImageAssetRepositoryRecord,
  persistedReviewRequest: EditorialImageRightsReviewRequestRecord | null,
  decision: EditorialImageRightsDecisionInput,
  transitionResult: EditorialImageRightsTransitionResult,
  rawEvidenceMap: ReadonlyMap<string, unknown>,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): void {
  const fromStatus = currentRecord.asset.rights.status;
  const toStatus = decision.targetStatus;
  const decisionMs = Date.parse(transitionResult.auditEvent.timestamp);

  // Determine which evidence references require transactional verification:
  // - All evidenceRefs on an 'Approved' transition
  // - Any evidenceRefs explicitly provided on the decision input
  // - All submittedEvidenceRefs on a consumed review request
  const requiresVerification =
    toStatus === 'Approved' || decision.evidenceRefs !== undefined;

  if (!requiresVerification) {
    return;
  }

  const effectiveRefs =
    decision.evidenceRefs !== undefined
      ? decision.evidenceRefs
      : (transitionResult.record.asset.rights.evidenceRefs ?? []);

  const refsToVerify = Array.from(
    new Set([
      ...effectiveRefs,
      ...(persistedReviewRequest?.submittedEvidenceRefs ?? []),
    ])
  );

  const verifiedRecords = new Map<string, EditorialImageRightsEvidenceRecord>();

  for (const evidenceId of refsToVerify) {
    if (!rawEvidenceMap.has(evidenceId)) {
      const detail = `Referenced rights evidence "${evidenceId}" is not registered in "${EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION}".`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }

    const evRecord = validatePersistedEvidenceRecord(
      evidenceId,
      rawEvidenceMap.get(evidenceId),
      limits
    );

    if (evRecord.assetId !== currentRecord.assetId) {
      const detail = `Referenced rights evidence "${evidenceId}" is bound to asset "${evRecord.assetId}", not "${currentRecord.assetId}".`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }

    if (evRecord.status !== 'Active') {
      const detail = `Referenced rights evidence "${evidenceId}" has status "${evRecord.status}" (must be "Active").`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }

    const recordedAtMs = Date.parse(evRecord.recordedAtIso);
    if (recordedAtMs > decisionMs) {
      const detail = `Referenced rights evidence "${evidenceId}" has future recordedAtIso (${evRecord.recordedAtIso}) relative to decision timestamp (${transitionResult.auditEvent.timestamp}).`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }

    verifiedRecords.set(evidenceId, evRecord);
  }

  if (
    (fromStatus === 'Rejected' || fromStatus === 'Revoked') &&
    toStatus === 'Approved'
  ) {
    const priorReviewedAtIso = currentRecord.asset.rights.reviewedAtIso!;
    const priorReviewedAtMs = Date.parse(priorReviewedAtIso);
    const priorEvidenceSet = new Set(
      currentRecord.asset.rights.evidenceRefs ?? []
    );

    const hasFreshPostDecisionEvidence = effectiveRefs.some((ref) => {
      if (priorEvidenceSet.has(ref)) {
        return false;
      }
      const evRecord = verifiedRecords.get(ref);
      return (
        evRecord !== undefined &&
        Date.parse(evRecord.recordedAtIso) > priorReviewedAtMs
      );
    });

    if (!hasFreshPostDecisionEvidence) {
      const detail = `Re-approval of "${fromStatus}" asset "${currentRecord.assetId}" requires at least one active evidence record registered strictly after the prior decision timestamp (${priorReviewedAtIso}) and not present in priorEvidenceRefs.`;
      throw new EditorialImageRightsReviewError('INVALID_EVIDENCE', detail, [
        detail,
      ]);
    }
  }
}

/**
 * Pure domain validator and builder for new documented review requests.
 */
export function buildValidatedReviewRequestRecord(
  currentRecord: EditorialImageAssetRepositoryRecord,
  params: CreateAtomicReviewRequestParams,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageRightsReviewRequestRecord {
  const { requester, input, requestId, requestedAtIso } = params;

  if (!isValidCanonicalUtcTimestamp(requestedAtIso)) {
    const detail =
      'Server clock produced a non-canonical UTC timestamp for review request submission.';
    throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
      detail,
    ]);
  }

  if (currentRecord.asset.status !== 'active') {
    const detail = `Cannot submit a rights review request for asset "${currentRecord.assetId}" because its lifecycle status is "${currentRecord.asset.status}" (must be "active").`;
    throw new EditorialImageRightsReviewError('INVALID_TRANSITION', detail, [
      detail,
    ]);
  }

  if (currentRecord.revision !== input.expectedRevision) {
    const detail = `Revision conflict when submitting review request for asset "${currentRecord.assetId}": expected revision ${input.expectedRevision}, stored revision is ${currentRecord.revision}.`;
    throw new EditorialImageRightsReviewError('CONFLICT', detail, [detail]);
  }

  const currentStatus = currentRecord.asset.rights.status;
  if (currentStatus !== 'Rejected' && currentStatus !== 'Revoked') {
    const detail = `Documented re-review requests are only permitted for assets in "Rejected" or "Revoked" rights status; asset "${currentRecord.assetId}" is currently "${currentStatus}".`;
    throw new EditorialImageRightsReviewError('INVALID_TRANSITION', detail, [
      detail,
    ]);
  }

  const priorReviewedAtIso = currentRecord.asset.rights.reviewedAtIso;
  if (!isValidCanonicalUtcTimestamp(priorReviewedAtIso)) {
    const detail = `Asset "${currentRecord.assetId}" in "${currentStatus}" state is missing a valid prior reviewedAtIso timestamp.`;
    throw new EditorialImageRightsReviewError('INVALID_ASSET', detail, [
      detail,
    ]);
  }

  const requestedAtMs = Date.parse(requestedAtIso);
  const priorReviewedAtMs = Date.parse(priorReviewedAtIso);
  const assetUpdatedAtMs = Date.parse(currentRecord.asset.updatedAtIso);
  const assetCreatedAtMs = Date.parse(currentRecord.asset.createdAtIso);

  if (requestedAtMs < assetCreatedAtMs || requestedAtMs < assetUpdatedAtMs) {
    const detail = `Clock rollback detected when submitting review request for asset "${currentRecord.assetId}": requestedAtIso (${requestedAtIso}) precedes asset updatedAtIso (${currentRecord.asset.updatedAtIso}).`;
    throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
      detail,
    ]);
  }

  if (requestedAtMs <= priorReviewedAtMs) {
    const detail = `Review request timestamp (${requestedAtIso}) must be strictly later than the prior rights decision timestamp (${priorReviewedAtIso}).`;
    throw new EditorialImageRightsReviewError(
      'INVALID_REVIEW_REQUEST',
      detail,
      [detail]
    );
  }

  const priorEvidenceRefs = currentRecord.asset.rights.evidenceRefs ?? [];
  const priorEvidenceSet = new Set(priorEvidenceRefs);
  const hasNewEvidence = input.submittedEvidenceRefs.some(
    (ref) => !priorEvidenceSet.has(ref)
  );
  if (!hasNewEvidence) {
    const detail = `Review request for "${currentStatus}" asset "${currentRecord.assetId}" must include at least one new evidence reference not present in the prior rights decision.`;
    throw new EditorialImageRightsReviewError(
      'INVALID_REVIEW_REQUEST',
      detail,
      [detail]
    );
  }

  const candidate: EditorialImageRightsReviewRequestRecord = {
    requestId,
    assetId: currentRecord.assetId,
    assetRevision: currentRecord.revision,
    priorRightsStatus: currentStatus,
    priorReviewedAtIso,
    priorEvidenceRefs: [...priorEvidenceRefs],
    requestedByUid: requester.uid,
    requestedByName: requester.name,
    requestedByRole: requester.role,
    requestedAtIso,
    rationale: input.rationale,
    submittedEvidenceRefs: [...input.submittedEvidenceRefs],
    status: 'Pending',
  };

  return validatePersistedReviewRequestRecord(requestId, candidate, limits);
}

/**
 * Pure domain validator and builder for atomic rights transitions.
 */
export function buildValidatedRightsTransition(
  currentRecord: EditorialImageAssetRepositoryRecord,
  persistedReviewRequest: EditorialImageRightsReviewRequestRecord | null,
  params: ExecuteAtomicRightsTransitionParams,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageRightsTransitionResult {
  const { reviewer, decision, decisionTimestampIso, auditEventId } = params;

  if (!isValidCanonicalUtcTimestamp(decisionTimestampIso)) {
    const detail =
      'Server clock produced an invalid or non-canonical UTC timestamp for rights decision.';
    throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
      detail,
    ]);
  }

  if (currentRecord.asset.status !== 'active') {
    const detail = `Cannot review rights for editorial image asset "${currentRecord.assetId}" because its lifecycle status is "${currentRecord.asset.status}" (must be "active").`;
    throw new EditorialImageRightsReviewError('INVALID_TRANSITION', detail, [
      detail,
    ]);
  }

  if (currentRecord.revision !== decision.expectedRevision) {
    const detail = `Revision conflict for editorial image asset "${currentRecord.assetId}": expected revision ${decision.expectedRevision}, but current stored revision is ${currentRecord.revision}.`;
    throw new EditorialImageRightsReviewError('CONFLICT', detail, [detail]);
  }

  const fromStatus = currentRecord.asset.rights.status;
  const toStatus = decision.targetStatus;

  if (!isAllowedRightsTransition(fromStatus, toStatus)) {
    const detail = `Forbidden editorial image rights status transition from "${fromStatus}" to "${toStatus}" for asset "${currentRecord.assetId}".`;
    throw new EditorialImageRightsReviewError('INVALID_TRANSITION', detail, [
      detail,
    ]);
  }

  // Chronology & clock rollback checks against stored asset timestamps
  const decisionMs = Date.parse(decisionTimestampIso);
  const createdMs = Date.parse(currentRecord.asset.createdAtIso);
  const updatedMs = Date.parse(currentRecord.asset.updatedAtIso);

  if (decisionMs < createdMs || decisionMs < updatedMs) {
    const detail = `Clock rollback detected for asset "${currentRecord.assetId}": decision timestamp (${decisionTimestampIso}) precedes stored asset timestamp (${currentRecord.asset.updatedAtIso}).`;
    throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
      detail,
    ]);
  }

  if (currentRecord.asset.rights.reviewedAtIso !== undefined) {
    const priorReviewedMs = Date.parse(currentRecord.asset.rights.reviewedAtIso);
    if (decisionMs < priorReviewedMs) {
      const detail = `Clock rollback detected for asset "${currentRecord.assetId}": decision timestamp (${decisionTimestampIso}) precedes prior reviewedAtIso (${currentRecord.asset.rights.reviewedAtIso}).`;
      throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
        detail,
      ]);
    }
  }

  // Self-approval policy enforcement (UID-based only; never display name or email)
  let selfApprovedByOwner = false;
  if (toStatus === 'Approved') {
    if (reviewer.uid === currentRecord.asset.createdByUid) {
      if (reviewer.role !== AdminRole.Owner) {
        const detail = `Self-approval is forbidden: reviewer "${reviewer.uid}" with role "${reviewer.role}" cannot approve asset "${currentRecord.assetId}" created by "${currentRecord.asset.createdByUid}". Only AdminRole.Owner may self-approve.`;
        throw new EditorialImageRightsReviewError(
          'SELF_APPROVAL_FORBIDDEN',
          detail,
          [detail]
        );
      }
      selfApprovedByOwner = true;
    }
  }

  // Review request verification for Rejected -> Approved and Revoked -> Approved
  const requiresReviewRequest =
    (fromStatus === 'Rejected' || fromStatus === 'Revoked') &&
    toStatus === 'Approved';

  let consumedReviewRequest: EditorialImageRightsReviewRequestRecord | undefined;
  const nextRevision = currentRecord.revision + 1;

  if (!requiresReviewRequest && decision.reviewRequestId !== undefined) {
    const detail = `reviewRequestId is only applicable when transitioning from "Rejected" or "Revoked" to "Approved" (current transition: "${fromStatus}" -> "${toStatus}").`;
    throw new EditorialImageRightsReviewError(
      'INVALID_REVIEW_REQUEST',
      detail,
      [detail]
    );
  }

  if (requiresReviewRequest) {
    if (!decision.reviewRequestId) {
      const detail = `Transitioning asset "${currentRecord.assetId}" from "${fromStatus}" to "Approved" requires a persisted, unconsumed reviewRequestId.`;
      throw new EditorialImageRightsReviewError(
        'REVIEW_REQUEST_REQUIRED',
        detail,
        [detail]
      );
    }

    if (!persistedReviewRequest) {
      const detail = `Persisted review request "${decision.reviewRequestId}" was not found.`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    if (persistedReviewRequest.status !== 'Pending') {
      const detail = `Review request "${persistedReviewRequest.requestId}" has already been consumed and cannot be replayed.`;
      throw new EditorialImageRightsReviewError(
        'REVIEW_REQUEST_CONSUMED',
        detail,
        [detail]
      );
    }

    if (persistedReviewRequest.assetId !== currentRecord.assetId) {
      const detail = `Review request "${persistedReviewRequest.requestId}" belongs to asset "${persistedReviewRequest.assetId}", not "${currentRecord.assetId}".`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    if (persistedReviewRequest.assetRevision !== currentRecord.revision) {
      const detail = `Review request "${persistedReviewRequest.requestId}" is stale: created for revision ${persistedReviewRequest.assetRevision}, but asset "${currentRecord.assetId}" is at revision ${currentRecord.revision}.`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    if (persistedReviewRequest.priorRightsStatus !== fromStatus) {
      const detail = `Review request "${persistedReviewRequest.requestId}" priorRightsStatus ("${persistedReviewRequest.priorRightsStatus}") does not match current asset status ("${fromStatus}").`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    const priorReviewedAtIso = currentRecord.asset.rights.reviewedAtIso;
    if (
      !priorReviewedAtIso ||
      persistedReviewRequest.priorReviewedAtIso !== priorReviewedAtIso ||
      Date.parse(persistedReviewRequest.requestedAtIso) <=
        Date.parse(priorReviewedAtIso)
    ) {
      const detail = `Review request "${persistedReviewRequest.requestId}" timestamp (${persistedReviewRequest.requestedAtIso}) is not strictly later than prior rights decision (${String(priorReviewedAtIso)}).`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    if (decisionMs < Date.parse(persistedReviewRequest.requestedAtIso)) {
      const detail = `Clock rollback detected: decision timestamp (${decisionTimestampIso}) precedes review request timestamp (${persistedReviewRequest.requestedAtIso}).`;
      throw new EditorialImageRightsReviewError('CLOCK_ROLLBACK', detail, [
        detail,
      ]);
    }

    const priorEvidenceSet = new Set(
      currentRecord.asset.rights.evidenceRefs ?? []
    );
    const requestHasNewEvidence =
      persistedReviewRequest.submittedEvidenceRefs.some(
        (ref) => !priorEvidenceSet.has(ref)
      );
    if (!requestHasNewEvidence) {
      const detail = `Review request "${persistedReviewRequest.requestId}" does not contain any new evidence reference relative to the prior "${fromStatus}" decision.`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    if (!decision.evidenceRefs || decision.evidenceRefs.length === 0) {
      const detail = `Re-approval of "${fromStatus}" asset "${currentRecord.assetId}" requires explicit evidenceRefs including the submitted review request evidence.`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    const decisionEvidenceSet = new Set(decision.evidenceRefs);
    const missingSubmittedRefs =
      persistedReviewRequest.submittedEvidenceRefs.filter(
        (ref) => !decisionEvidenceSet.has(ref)
      );
    if (missingSubmittedRefs.length > 0) {
      const detail = `Re-approval decision for asset "${currentRecord.assetId}" must include all evidence references submitted in review request "${persistedReviewRequest.requestId}" (missing: ${missingSubmittedRefs.join(', ')}).`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    const decisionHasNewEvidence = decision.evidenceRefs.some(
      (ref) => !priorEvidenceSet.has(ref)
    );
    if (!decisionHasNewEvidence) {
      const detail = `Re-approval decision for asset "${currentRecord.assetId}" must include at least one new evidence reference relative to the prior decision.`;
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        detail,
        [detail]
      );
    }

    consumedReviewRequest = validatePersistedReviewRequestRecord(
      persistedReviewRequest.requestId,
      {
        ...persistedReviewRequest,
        status: 'Consumed',
        consumedByUid: reviewer.uid,
        consumedAtIso: decisionTimestampIso,
        consumedByAuditId: auditEventId,
        consumedAtAssetRevision: nextRevision,
      },
      limits
    );
  }

  // Construct next rights record
  const currentRights = currentRecord.asset.rights;
  const nextLicenseType =
    decision.licenseType !== undefined
      ? decision.licenseType
      : currentRights.licenseType;
  const nextLicenseDetails =
    decision.licenseDetails !== undefined
      ? decision.licenseDetails
      : currentRights.licenseDetails;
  const nextRightsHolder =
    decision.rightsHolder !== undefined
      ? decision.rightsHolder
      : currentRights.rightsHolder;
  const nextDocumentedException =
    decision.documentedException !== undefined
      ? decision.documentedException
      : currentRights.documentedException;
  const nextSourceAttributionAr =
    decision.sourceAttributionAr !== undefined
      ? decision.sourceAttributionAr
      : currentRights.sourceAttributionAr;
  const nextSourceAttributionEn =
    decision.sourceAttributionEn !== undefined
      ? decision.sourceAttributionEn
      : currentRights.sourceAttributionEn;
  const nextEvidenceRefs =
    decision.evidenceRefs !== undefined
      ? [...decision.evidenceRefs]
      : currentRights.evidenceRefs !== undefined
        ? [...currentRights.evidenceRefs]
        : undefined;
  const nextUsageScope =
    decision.usageScope !== undefined
      ? decision.usageScope
      : currentRights.usageScope;

  const nextRights: EditorialImageRightsRecord = {
    status: toStatus,
    ...(nextLicenseType !== undefined ? { licenseType: nextLicenseType } : {}),
    ...(nextLicenseDetails !== undefined
      ? { licenseDetails: nextLicenseDetails }
      : {}),
    ...(nextRightsHolder !== undefined
      ? { rightsHolder: nextRightsHolder }
      : {}),
    ...(nextDocumentedException !== undefined
      ? { documentedException: nextDocumentedException }
      : {}),
    ...(nextSourceAttributionAr !== undefined
      ? { sourceAttributionAr: nextSourceAttributionAr }
      : {}),
    ...(nextSourceAttributionEn !== undefined
      ? { sourceAttributionEn: nextSourceAttributionEn }
      : {}),
    ...(nextEvidenceRefs !== undefined
      ? { evidenceRefs: nextEvidenceRefs }
      : {}),
    ...(nextUsageScope !== undefined ? { usageScope: nextUsageScope } : {}),
    reviewedByUid: reviewer.uid,
    reviewedAtIso: decisionTimestampIso,
    reviewReason: decision.reviewReason,
  };

  const rightsValidation = validateEditorialImageRights(nextRights, limits);
  if (!rightsValidation.valid) {
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Invalid editorial image rights record for target status "${toStatus}":\n- ${rightsValidation.errors.join('\n- ')}`,
      rightsValidation.errors
    );
  }

  const nextAssetCandidate: EditorialImageAssetMetadata = {
    ...currentRecord.asset,
    updatedAtIso: decisionTimestampIso,
    rights: nextRights,
  };

  const assetValidation = validateEditorialImageAsset(
    nextAssetCandidate,
    limits
  );
  if (!assetValidation.valid) {
    throw new EditorialImageRightsReviewError(
      'INVALID_INPUT',
      `Updated editorial image asset failed canonical contract validation:\n- ${assetValidation.errors.join('\n- ')}`,
      assetValidation.errors
    );
  }

  const sanitizedAsset = sanitizeEditorialImageAssetMetadata(
    nextAssetCandidate,
    limits
  );

  const nextEnvelope: EditorialImageAssetRepositoryRecord =
    validatePersistedEditorialImageAssetEnvelope(
      sanitizedAsset.assetId,
      {
        assetId: sanitizedAsset.assetId,
        revision: nextRevision,
        asset: sanitizedAsset,
      },
      limits
    );

  const auditEvent = validateAuditEventRecord(
    {
      id: auditEventId,
      targetType: EDITORIAL_IMAGE_AUDIT_TARGET_TYPE,
      targetId: sanitizedAsset.assetId,
      assetId: sanitizedAsset.assetId,
      action: AuditAction.RightsChanged,
      previousRightsStatus: fromStatus,
      newRightsStatus: toStatus,
      previousRevision: currentRecord.revision,
      newRevision: nextRevision,
      actorUserId: reviewer.uid,
      actorName: reviewer.name,
      actorRole: reviewer.role,
      timestamp: decisionTimestampIso,
      reviewReason: decision.reviewReason,
      ...(consumedReviewRequest !== undefined
        ? { reviewRequestId: consumedReviewRequest.requestId }
        : {}),
      evidenceRefs: sanitizedAsset.rights.evidenceRefs
        ? [...sanitizedAsset.rights.evidenceRefs]
        : [],
      selfApprovedByOwner,
    },
    limits
  );

  return {
    record: cloneRepositoryRecord(nextEnvelope, limits),
    auditEvent,
    ...(consumedReviewRequest !== undefined ? { consumedReviewRequest } : {}),
  };
}

/**
 * Production Firestore atomic transaction runner for editorial image rights
 * evidence registry, review requests, rights transitions, and immutable
 * image-specific audit records.
 *
 * Enforces all-reads-before-first-write and revalidates `admins/{verifiedUid}`
 * and `editorial_image_rights_evidence/{evidenceId}` inside every transaction.
 */
export class FirestoreEditorialImageRightsReviewRunner
  implements EditorialImageRightsReviewTransactionRunner
{
  public static readonly ADMINS_COLLECTION = EDITORIAL_IMAGE_ADMINS_COLLECTION;
  public static readonly ASSET_COLLECTION = EDITORIAL_IMAGE_ASSET_COLLECTION;
  public static readonly EVIDENCE_COLLECTION =
    EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION;
  public static readonly REVIEW_REQUEST_COLLECTION =
    EDITORIAL_IMAGE_RIGHTS_REVIEW_REQUEST_COLLECTION;
  public static readonly AUDIT_COLLECTION =
    EDITORIAL_IMAGE_RIGHTS_AUDIT_COLLECTION;

  private readonly db: EditorialImageFirestoreDatabase;
  private readonly limits: EditorialImageAssetValidationLimits;

  constructor(
    db: EditorialImageFirestoreDatabase,
    limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
  ) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      const detail =
        'FirestoreEditorialImageRightsReviewRunner requires a valid transactional Firestore database adapter.';
      throw new EditorialImageRightsReviewError(
        'PERSISTENCE_FAILURE',
        detail,
        [detail]
      );
    }
    this.db = db;
    this.limits = limits;
  }

  private getAdminDocRef(uid: string): EditorialImageFirestoreDocumentRef {
    return this.db
      .collection(FirestoreEditorialImageRightsReviewRunner.ADMINS_COLLECTION)
      .doc(uid);
  }

  private getAssetDocRef(assetId: string): EditorialImageFirestoreDocumentRef {
    return this.db
      .collection(FirestoreEditorialImageRightsReviewRunner.ASSET_COLLECTION)
      .doc(assetId);
  }

  private getEvidenceDocRef(
    evidenceId: string
  ): EditorialImageFirestoreDocumentRef {
    return this.db
      .collection(FirestoreEditorialImageRightsReviewRunner.EVIDENCE_COLLECTION)
      .doc(evidenceId);
  }

  private getRequestDocRef(
    requestId: string
  ): EditorialImageFirestoreDocumentRef {
    return this.db
      .collection(
        FirestoreEditorialImageRightsReviewRunner.REVIEW_REQUEST_COLLECTION
      )
      .doc(requestId);
  }

  private getAuditDocRef(auditId: string): EditorialImageFirestoreDocumentRef {
    return this.db
      .collection(FirestoreEditorialImageRightsReviewRunner.AUDIT_COLLECTION)
      .doc(auditId);
  }

  async registerEvidenceAtomic(
    params: RegisterAtomicEvidenceParams
  ): Promise<EditorialImageRightsEvidenceRecord> {
    const validAssetId = validateRepositoryAssetId(
      params.input.assetId,
      this.limits
    );
    const idCheck = validateEvidenceId(params.evidenceId, this.limits);
    if (!idCheck.valid) {
      throw new EditorialImageRightsReviewError(
        'INVALID_INPUT',
        `Invalid evidenceId "${params.evidenceId}".`,
        idCheck.errors
      );
    }

    const adminDocRef = this.getAdminDocRef(params.recorder.uid);
    const assetDocRef = this.getAssetDocRef(validAssetId);
    const evidenceDocRef = this.getEvidenceDocRef(params.evidenceId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        // 1. Read admin, asset, and target evidence doc before any write
        const adminSnap = await transaction.get(adminDocRef);
        const assetSnap = await transaction.get(assetDocRef);
        const existingEvidenceSnap = await transaction.get(evidenceDocRef);

        if (!adminSnap || typeof adminSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for admin "${params.recorder.uid}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (!adminSnap.exists) {
          const detail =
            'PERMISSION_DENIED: Administrative account is not registered (ADMIN_NOT_REGISTERED).';
          throw new EditorialImageRightsReviewError(
            'PERMISSION_DENIED',
            detail,
            [detail]
          );
        }
        const verifiedRecorder = validateAdminRecordForRightsManagement(
          params.recorder.uid,
          adminSnap.data()
        );

        if (!assetSnap || typeof assetSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for asset "${validAssetId}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (!assetSnap.exists) {
          const detail = `Editorial image asset "${validAssetId}" was not found.`;
          throw new EditorialImageRightsReviewError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        if (
          !existingEvidenceSnap ||
          typeof existingEvidenceSnap.exists !== 'boolean'
        ) {
          const detail = `Invalid Firestore snapshot returned for evidence "${params.evidenceId}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (existingEvidenceSnap.exists) {
          const detail = `Rights evidence record "${params.evidenceId}" already exists.`;
          throw new EditorialImageRightsReviewError('ALREADY_EXISTS', detail, [
            detail,
          ]);
        }

        const currentRecord = validatePersistedEditorialImageAssetEnvelope(
          validAssetId,
          assetSnap.data(),
          this.limits
        );

        const evidenceRecord = buildValidatedEvidenceRegistration(
          currentRecord,
          {
            ...params,
            recorder: verifiedRecorder,
          },
          this.limits
        );

        transaction.create(
          evidenceDocRef,
          serializeEvidenceRecordForPersistence(evidenceRecord)
        );

        return cloneEditorialImageRightsEvidenceRecord(evidenceRecord);
      });
    } catch (err) {
      throw mapRepositoryError(err);
    }
  }

  async revokeEvidenceAtomic(
    params: RevokeAtomicEvidenceParams
  ): Promise<EditorialImageRightsEvidenceRecord> {
    const idCheck = validateEvidenceId(params.input.evidenceId, this.limits);
    if (!idCheck.valid) {
      throw new EditorialImageRightsReviewError(
        'INVALID_INPUT',
        `Invalid evidenceId "${params.input.evidenceId}".`,
        idCheck.errors
      );
    }

    const adminDocRef = this.getAdminDocRef(params.revoker.uid);
    const evidenceDocRef = this.getEvidenceDocRef(params.input.evidenceId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        // 1. Read admin and evidence doc before any write
        const adminSnap = await transaction.get(adminDocRef);
        const evidenceSnap = await transaction.get(evidenceDocRef);

        if (!adminSnap || typeof adminSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for admin "${params.revoker.uid}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (!adminSnap.exists) {
          const detail =
            'PERMISSION_DENIED: Administrative account is not registered (ADMIN_NOT_REGISTERED).';
          throw new EditorialImageRightsReviewError(
            'PERMISSION_DENIED',
            detail,
            [detail]
          );
        }
        const verifiedRevoker = validateAdminRecordForRightsManagement(
          params.revoker.uid,
          adminSnap.data()
        );

        if (!evidenceSnap || typeof evidenceSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for evidence "${params.input.evidenceId}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (!evidenceSnap.exists) {
          const detail = `Rights evidence record "${params.input.evidenceId}" was not found.`;
          throw new EditorialImageRightsReviewError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        const existingEvidence = validatePersistedEvidenceRecord(
          params.input.evidenceId,
          evidenceSnap.data(),
          this.limits
        );

        const revokedRecord = buildValidatedEvidenceRevocation(
          existingEvidence,
          {
            ...params,
            revoker: verifiedRevoker,
          },
          this.limits
        );

        transaction.set(
          evidenceDocRef,
          serializeEvidenceRecordForPersistence(revokedRecord)
        );

        return cloneEditorialImageRightsEvidenceRecord(revokedRecord);
      });
    } catch (err) {
      throw mapRepositoryError(err);
    }
  }

  async submitReviewRequestAtomic(
    params: CreateAtomicReviewRequestParams
  ): Promise<EditorialImageRightsReviewRequestRecord> {
    const validAssetId = validateRepositoryAssetId(
      params.input.assetId,
      this.limits
    );
    validateExpectedRevision(params.input.expectedRevision);
    const adminDocRef = this.getAdminDocRef(params.requester.uid);
    const assetDocRef = this.getAssetDocRef(validAssetId);
    const requestDocRef = this.getRequestDocRef(params.requestId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        // 1. Read admin, asset, request, and all submitted evidence docs before any write
        const adminSnap = await transaction.get(adminDocRef);
        const assetSnap = await transaction.get(assetDocRef);
        const existingRequestSnap = await transaction.get(requestDocRef);

        const rawEvidenceMap = new Map<string, unknown>();
        for (const evidenceId of params.input.submittedEvidenceRefs) {
          const evSnap = await transaction.get(
            this.getEvidenceDocRef(evidenceId)
          );
          if (!evSnap || typeof evSnap.exists !== 'boolean') {
            const detail = `Invalid Firestore snapshot returned for evidence "${evidenceId}".`;
            throw new EditorialImageRightsReviewError(
              'PERSISTENCE_FAILURE',
              detail,
              [detail]
            );
          }
          if (evSnap.exists) {
            rawEvidenceMap.set(evidenceId, evSnap.data());
          }
        }

        // 2. Validate transactional admin authorization
        if (!adminSnap || typeof adminSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for admin "${params.requester.uid}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (!adminSnap.exists) {
          const detail =
            'PERMISSION_DENIED: Administrative account is not registered (ADMIN_NOT_REGISTERED).';
          throw new EditorialImageRightsReviewError(
            'PERMISSION_DENIED',
            detail,
            [detail]
          );
        }
        const verifiedRequester = validateAdminRecordForRightsManagement(
          params.requester.uid,
          adminSnap.data()
        );

        // 3. Validate asset and request snapshots
        if (!assetSnap || typeof assetSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for asset "${validAssetId}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (!assetSnap.exists) {
          const detail = `Editorial image asset "${validAssetId}" was not found.`;
          throw new EditorialImageRightsReviewError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        if (
          !existingRequestSnap ||
          typeof existingRequestSnap.exists !== 'boolean'
        ) {
          const detail = `Invalid Firestore snapshot returned for review request "${params.requestId}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (existingRequestSnap.exists) {
          const detail = `Review request "${params.requestId}" already exists.`;
          throw new EditorialImageRightsReviewError('ALREADY_EXISTS', detail, [
            detail,
          ]);
        }

        const currentRecord = validatePersistedEditorialImageAssetEnvelope(
          validAssetId,
          assetSnap.data(),
          this.limits
        );

        const requestRecord = buildValidatedReviewRequestRecord(
          currentRecord,
          {
            ...params,
            requester: verifiedRequester,
          },
          this.limits
        );

        // 4. Verify durable evidence registry records for submittedEvidenceRefs
        verifyEvidenceRecordsForReviewRequest(
          currentRecord,
          requestRecord,
          rawEvidenceMap,
          this.limits
        );

        // 5. Write after all reads and validations succeed
        transaction.create(
          requestDocRef,
          stripUndefinedRecursively({ ...requestRecord })
        );

        return cloneReviewRequestRecord(requestRecord, this.limits);
      });
    } catch (err) {
      throw mapRepositoryError(err);
    }
  }

  async transitionRightsAtomic(
    params: ExecuteAtomicRightsTransitionParams
  ): Promise<EditorialImageRightsTransitionResult> {
    const validAssetId = validateRepositoryAssetId(
      params.decision.assetId,
      this.limits
    );
    validateExpectedRevision(params.decision.expectedRevision);
    const adminDocRef = this.getAdminDocRef(params.reviewer.uid);
    const assetDocRef = this.getAssetDocRef(validAssetId);
    const auditDocRef = this.getAuditDocRef(params.auditEventId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        // 1. Read admin, asset, optional review request, audit event, and all referenced evidence docs BEFORE any write
        const adminSnap = await transaction.get(adminDocRef);
        const assetSnap = await transaction.get(assetDocRef);

        let requestDocRef: EditorialImageFirestoreDocumentRef | null = null;
        let reqSnap: { exists: boolean; data(): unknown } | null = null;
        if (params.decision.reviewRequestId !== undefined) {
          requestDocRef = this.getRequestDocRef(params.decision.reviewRequestId);
          reqSnap = await transaction.get(requestDocRef);
        }

        const auditSnap = await transaction.get(auditDocRef);

        // Determine all candidate evidence IDs that could be evaluated so they are read before any write
        const candidateEvidenceIds = new Set<string>(
          params.decision.evidenceRefs ?? []
        );
        if (assetSnap && assetSnap.exists) {
          const rawAssetData = assetSnap.data();
          if (
            isPlainObject(rawAssetData) &&
            isPlainObject(rawAssetData.asset) &&
            isPlainObject(rawAssetData.asset.rights) &&
            Array.isArray(rawAssetData.asset.rights.evidenceRefs)
          ) {
            for (const ref of rawAssetData.asset.rights.evidenceRefs) {
              if (typeof ref === 'string') {
                candidateEvidenceIds.add(ref);
              }
            }
          }
        }
        if (reqSnap && reqSnap.exists) {
          const rawReqData = reqSnap.data();
          if (
            isPlainObject(rawReqData) &&
            Array.isArray(rawReqData.submittedEvidenceRefs)
          ) {
            for (const ref of rawReqData.submittedEvidenceRefs) {
              if (typeof ref === 'string') {
                candidateEvidenceIds.add(ref);
              }
            }
          }
        }

        const rawEvidenceMap = new Map<string, unknown>();
        for (const evidenceId of candidateEvidenceIds) {
          const evSnap = await transaction.get(
            this.getEvidenceDocRef(evidenceId)
          );
          if (!evSnap || typeof evSnap.exists !== 'boolean') {
            const detail = `Invalid Firestore snapshot returned for evidence "${evidenceId}".`;
            throw new EditorialImageRightsReviewError(
              'PERSISTENCE_FAILURE',
              detail,
              [detail]
            );
          }
          if (evSnap.exists) {
            rawEvidenceMap.set(evidenceId, evSnap.data());
          }
        }

        // 2. Validate transactional admin authorization
        if (!adminSnap || typeof adminSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for admin "${params.reviewer.uid}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (!adminSnap.exists) {
          const detail =
            'PERMISSION_DENIED: Administrative account is not registered (ADMIN_NOT_REGISTERED).';
          throw new EditorialImageRightsReviewError(
            'PERMISSION_DENIED',
            detail,
            [detail]
          );
        }
        const verifiedReviewer = validateAdminRecordForRightsManagement(
          params.reviewer.uid,
          adminSnap.data()
        );

        // 3. Validate canonical asset envelope
        if (!assetSnap || typeof assetSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for asset "${validAssetId}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (!assetSnap.exists) {
          const detail = `Editorial image asset "${validAssetId}" was not found.`;
          throw new EditorialImageRightsReviewError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        const currentRecord = validatePersistedEditorialImageAssetEnvelope(
          validAssetId,
          assetSnap.data(),
          this.limits
        );

        // 4. Validate review request if supplied
        let persistedRequest: EditorialImageRightsReviewRequestRecord | null =
          null;
        if (params.decision.reviewRequestId !== undefined) {
          if (!reqSnap || typeof reqSnap.exists !== 'boolean') {
            const detail = `Invalid Firestore snapshot returned for review request "${params.decision.reviewRequestId}".`;
            throw new EditorialImageRightsReviewError(
              'PERSISTENCE_FAILURE',
              detail,
              [detail]
            );
          }
          if (reqSnap.exists) {
            persistedRequest = validatePersistedReviewRequestRecord(
              params.decision.reviewRequestId,
              reqSnap.data(),
              this.limits
            );
          }
        }

        // 5. Verify audit event ID does not already exist
        if (!auditSnap || typeof auditSnap.exists !== 'boolean') {
          const detail = `Invalid Firestore snapshot returned for audit event "${params.auditEventId}".`;
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }
        if (auditSnap.exists) {
          const detail = `Audit event "${params.auditEventId}" already exists.`;
          throw new EditorialImageRightsReviewError('ALREADY_EXISTS', detail, [
            detail,
          ]);
        }

        // 6. Enforce policy, chronology, and build validated next records using transactional verifiedReviewer
        const transitionResult = buildValidatedRightsTransition(
          currentRecord,
          persistedRequest,
          {
            ...params,
            reviewer: verifiedReviewer,
          },
          this.limits
        );

        // 7. Verify durable evidence registry records for the transition
        verifyEvidenceRecordsForRightsTransition(
          currentRecord,
          persistedRequest,
          params.decision,
          transitionResult,
          rawEvidenceMap,
          this.limits
        );

        // 8. Stage atomic writes: asset envelope, immutable audit event, and consumed request
        const serializedEnvelope = serializeEnvelopeForPersistence(
          transitionResult.record,
          this.limits
        );
        transaction.set(assetDocRef, serializedEnvelope);

        transaction.create(
          auditDocRef,
          stripUndefinedRecursively({ ...transitionResult.auditEvent })
        );

        if (transitionResult.consumedReviewRequest && requestDocRef) {
          transaction.set(
            requestDocRef,
            stripUndefinedRecursively({
              ...transitionResult.consumedReviewRequest,
            })
          );
        }

        return transitionResult;
      });
    } catch (err) {
      throw mapRepositoryError(err);
    }
  }
}

export interface InMemoryRightsReviewFaultInjection {
  readonly failOnAssetWrite?: boolean;
  readonly failOnAuditWrite?: boolean;
  readonly failOnRequestConsumeWrite?: boolean;
  readonly failOnRequestCreateWrite?: boolean;
  readonly failOnEvidenceCreateWrite?: boolean;
  readonly failOnEvidenceRevokeWrite?: boolean;
}

/**
 * In-memory atomic transaction runner with full snapshot rollback,
 * in-transaction admin revalidation, durable evidence registry storage, and
 * deterministic fault injection for testing all-or-nothing guarantees.
 */
export class InMemoryEditorialImageRightsReviewRunner
  implements EditorialImageRightsReviewTransactionRunner
{
  private readonly assets: Map<string, unknown> = new Map();
  private readonly evidenceRecords: Map<string, unknown> = new Map();
  private readonly reviewRequests: Map<string, unknown> = new Map();
  private readonly auditEvents: Map<string, unknown> = new Map();
  private readonly limits: EditorialImageAssetValidationLimits;
  private adminRepo: AdminRepository | null = null;
  private transactionTail: Promise<void> = Promise.resolve();
  private oneShotFault: InMemoryRightsReviewFaultInjection | null = null;
  private beforeNextTransactionHook: (() => Promise<void> | void) | null = null;

  constructor(
    limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS,
    adminRepository?: AdminRepository
  ) {
    this.limits = limits;
    if (adminRepository) {
      this.adminRepo = adminRepository;
    }
  }

  public bindAdminRepository(adminRepository: AdminRepository): void {
    this.adminRepo = adminRepository;
  }

  public bindAdminRepositoryIfUnset(adminRepository: AdminRepository): void {
    if (!this.adminRepo) {
      this.adminRepo = adminRepository;
    }
  }

  public setBeforeNextTransactionHook(
    hook: (() => Promise<void> | void) | null
  ): void {
    this.beforeNextTransactionHook = hook;
  }

  private async verifyTransactionalActor(
    fallbackActor: AuthenticatedHumanReviewer
  ): Promise<AuthenticatedHumanReviewer> {
    if (!this.adminRepo) {
      return validateAdminRecordForRightsManagement(fallbackActor.uid, {
        id: fallbackActor.uid,
        name: fallbackActor.name,
        email: fallbackActor.email,
        role: fallbackActor.role,
        isActive: true,
      });
    }
    const liveAdmin = await this.adminRepo.getAdminByUid(fallbackActor.uid);
    return validateAdminRecordForRightsManagement(fallbackActor.uid, liveAdmin);
  }

  private runSerializedTransaction<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let releaseLock!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    return previous.then(async () => {
      try {
        return await work();
      } finally {
        releaseLock();
      }
    });
  }

  private takeStateSnapshot(): {
    assets: Map<string, unknown>;
    evidenceRecords: Map<string, unknown>;
    reviewRequests: Map<string, unknown>;
    auditEvents: Map<string, unknown>;
  } {
    return {
      assets: new Map(
        Array.from(this.assets.entries()).map(([k, v]) => [
          k,
          JSON.parse(JSON.stringify(v)),
        ])
      ),
      evidenceRecords: new Map(
        Array.from(this.evidenceRecords.entries()).map(([k, v]) => [
          k,
          JSON.parse(JSON.stringify(v)),
        ])
      ),
      reviewRequests: new Map(
        Array.from(this.reviewRequests.entries()).map(([k, v]) => [
          k,
          JSON.parse(JSON.stringify(v)),
        ])
      ),
      auditEvents: new Map(
        Array.from(this.auditEvents.entries()).map(([k, v]) => [
          k,
          JSON.parse(JSON.stringify(v)),
        ])
      ),
    };
  }

  private restoreStateSnapshot(snapshot: {
    assets: Map<string, unknown>;
    evidenceRecords: Map<string, unknown>;
    reviewRequests: Map<string, unknown>;
    auditEvents: Map<string, unknown>;
  }): void {
    this.assets.clear();
    for (const [k, v] of snapshot.assets.entries()) {
      this.assets.set(k, v);
    }
    this.evidenceRecords.clear();
    for (const [k, v] of snapshot.evidenceRecords.entries()) {
      this.evidenceRecords.set(k, v);
    }
    this.reviewRequests.clear();
    for (const [k, v] of snapshot.reviewRequests.entries()) {
      this.reviewRequests.set(k, v);
    }
    this.auditEvents.clear();
    for (const [k, v] of snapshot.auditEvents.entries()) {
      this.auditEvents.set(k, v);
    }
  }

  public injectFaultForNextTransaction(
    fault: InMemoryRightsReviewFaultInjection
  ): void {
    this.oneShotFault = { ...fault };
  }

  public async seedInitialPendingAsset(
    asset: EditorialImageAssetMetadata
  ): Promise<EditorialImageAssetRepositoryRecord> {
    const validatedAsset = validateAndCloneInitialAssetForCreate(
      asset,
      this.limits
    );

    return this.runSerializedTransaction(async () => {
      if (this.assets.has(validatedAsset.assetId)) {
        const detail = `Editorial image asset "${validatedAsset.assetId}" already exists.`;
        throw new EditorialImageRightsReviewError('ALREADY_EXISTS', detail, [
          detail,
        ]);
      }

      const initialEnvelope: EditorialImageAssetRepositoryRecord = {
        assetId: validatedAsset.assetId,
        revision: INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
        asset: validatedAsset,
      };

      this.assets.set(
        validatedAsset.assetId,
        serializeEnvelopeForPersistence(initialEnvelope, this.limits)
      );

      return cloneRepositoryRecord(initialEnvelope, this.limits);
    });
  }

  public async seedEvidenceRecord(
    record: EditorialImageRightsEvidenceRecord
  ): Promise<EditorialImageRightsEvidenceRecord> {
    const validated = validatePersistedEvidenceRecord(
      record.evidenceId,
      record,
      this.limits
    );
    return this.runSerializedTransaction(async () => {
      this.evidenceRecords.set(
        validated.evidenceId,
        serializeEvidenceRecordForPersistence(validated)
      );
      return cloneEditorialImageRightsEvidenceRecord(validated);
    });
  }

  public async getEvidenceRecord(
    evidenceId: string
  ): Promise<EditorialImageRightsEvidenceRecord | null> {
    return this.runSerializedTransaction(async () => {
      if (!this.evidenceRecords.has(evidenceId)) {
        return null;
      }
      return validatePersistedEvidenceRecord(
        evidenceId,
        this.evidenceRecords.get(evidenceId),
        this.limits
      );
    });
  }

  public async getAssetRecord(
    assetId: string
  ): Promise<EditorialImageAssetRepositoryRecord | null> {
    const validId = validateRepositoryAssetId(assetId, this.limits);
    return this.runSerializedTransaction(async () => {
      if (!this.assets.has(validId)) {
        return null;
      }
      const raw = this.assets.get(validId);
      const validated = validatePersistedEditorialImageAssetEnvelope(
        validId,
        raw,
        this.limits
      );
      return cloneRepositoryRecord(validated, this.limits);
    });
  }

  public async getReviewRequest(
    requestId: string
  ): Promise<EditorialImageRightsReviewRequestRecord | null> {
    return this.runSerializedTransaction(async () => {
      if (!this.reviewRequests.has(requestId)) {
        return null;
      }
      return validatePersistedReviewRequestRecord(
        requestId,
        this.reviewRequests.get(requestId),
        this.limits
      );
    });
  }

  public async listAuditEventsForAsset(
    assetId: string
  ): Promise<EditorialImageAssetRightsAuditEvent[]> {
    return this.runSerializedTransaction(async () => {
      const results: EditorialImageAssetRightsAuditEvent[] = [];
      for (const raw of this.auditEvents.values()) {
        const validated = validateAuditEventRecord(raw, this.limits);
        if (validated.assetId === assetId) {
          results.push(validated);
        }
      }
      return results;
    });
  }

  async registerEvidenceAtomic(
    params: RegisterAtomicEvidenceParams
  ): Promise<EditorialImageRightsEvidenceRecord> {
    const validAssetId = validateRepositoryAssetId(
      params.input.assetId,
      this.limits
    );
    const idCheck = validateEvidenceId(params.evidenceId, this.limits);
    if (!idCheck.valid) {
      throw new EditorialImageRightsReviewError(
        'INVALID_INPUT',
        `Invalid evidenceId "${params.evidenceId}".`,
        idCheck.errors
      );
    }

    return this.runSerializedTransaction(async () => {
      const fault = this.oneShotFault;
      this.oneShotFault = null;
      const hook = this.beforeNextTransactionHook;
      this.beforeNextTransactionHook = null;
      const snapshot = this.takeStateSnapshot();

      try {
        if (hook) {
          await hook();
        }

        const verifiedRecorder = await this.verifyTransactionalActor(
          params.recorder
        );

        if (!this.assets.has(validAssetId)) {
          const detail = `Editorial image asset "${validAssetId}" was not found.`;
          throw new EditorialImageRightsReviewError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        if (this.evidenceRecords.has(params.evidenceId)) {
          const detail = `Rights evidence record "${params.evidenceId}" already exists.`;
          throw new EditorialImageRightsReviewError('ALREADY_EXISTS', detail, [
            detail,
          ]);
        }

        const currentRecord = validatePersistedEditorialImageAssetEnvelope(
          validAssetId,
          this.assets.get(validAssetId),
          this.limits
        );

        const evidenceRecord = buildValidatedEvidenceRegistration(
          currentRecord,
          {
            ...params,
            recorder: verifiedRecorder,
          },
          this.limits
        );

        if (fault?.failOnEvidenceCreateWrite) {
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            'Simulated failure while creating evidence record.'
          );
        }

        this.evidenceRecords.set(
          params.evidenceId,
          serializeEvidenceRecordForPersistence(evidenceRecord)
        );

        return cloneEditorialImageRightsEvidenceRecord(evidenceRecord);
      } catch (err) {
        this.restoreStateSnapshot(snapshot);
        throw mapRepositoryError(err);
      }
    });
  }

  async revokeEvidenceAtomic(
    params: RevokeAtomicEvidenceParams
  ): Promise<EditorialImageRightsEvidenceRecord> {
    const idCheck = validateEvidenceId(params.input.evidenceId, this.limits);
    if (!idCheck.valid) {
      throw new EditorialImageRightsReviewError(
        'INVALID_INPUT',
        `Invalid evidenceId "${params.input.evidenceId}".`,
        idCheck.errors
      );
    }

    return this.runSerializedTransaction(async () => {
      const fault = this.oneShotFault;
      this.oneShotFault = null;
      const hook = this.beforeNextTransactionHook;
      this.beforeNextTransactionHook = null;
      const snapshot = this.takeStateSnapshot();

      try {
        if (hook) {
          await hook();
        }

        const verifiedRevoker = await this.verifyTransactionalActor(
          params.revoker
        );

        if (!this.evidenceRecords.has(params.input.evidenceId)) {
          const detail = `Rights evidence record "${params.input.evidenceId}" was not found.`;
          throw new EditorialImageRightsReviewError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        const existingEvidence = validatePersistedEvidenceRecord(
          params.input.evidenceId,
          this.evidenceRecords.get(params.input.evidenceId),
          this.limits
        );

        const revokedRecord = buildValidatedEvidenceRevocation(
          existingEvidence,
          {
            ...params,
            revoker: verifiedRevoker,
          },
          this.limits
        );

        if (fault?.failOnEvidenceRevokeWrite) {
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            'Simulated failure while revoking evidence record.'
          );
        }

        this.evidenceRecords.set(
          params.input.evidenceId,
          serializeEvidenceRecordForPersistence(revokedRecord)
        );

        return cloneEditorialImageRightsEvidenceRecord(revokedRecord);
      } catch (err) {
        this.restoreStateSnapshot(snapshot);
        throw mapRepositoryError(err);
      }
    });
  }

  async submitReviewRequestAtomic(
    params: CreateAtomicReviewRequestParams
  ): Promise<EditorialImageRightsReviewRequestRecord> {
    const validAssetId = validateRepositoryAssetId(
      params.input.assetId,
      this.limits
    );
    validateExpectedRevision(params.input.expectedRevision);

    return this.runSerializedTransaction(async () => {
      const fault = this.oneShotFault;
      this.oneShotFault = null;
      const hook = this.beforeNextTransactionHook;
      this.beforeNextTransactionHook = null;
      const snapshot = this.takeStateSnapshot();

      try {
        if (hook) {
          await hook();
        }

        const verifiedRequester = await this.verifyTransactionalActor(
          params.requester
        );

        if (!this.assets.has(validAssetId)) {
          const detail = `Editorial image asset "${validAssetId}" was not found.`;
          throw new EditorialImageRightsReviewError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        if (this.reviewRequests.has(params.requestId)) {
          const detail = `Review request "${params.requestId}" already exists.`;
          throw new EditorialImageRightsReviewError('ALREADY_EXISTS', detail, [
            detail,
          ]);
        }

        const currentRecord = validatePersistedEditorialImageAssetEnvelope(
          validAssetId,
          this.assets.get(validAssetId),
          this.limits
        );

        const requestRecord = buildValidatedReviewRequestRecord(
          currentRecord,
          {
            ...params,
            requester: verifiedRequester,
          },
          this.limits
        );

        verifyEvidenceRecordsForReviewRequest(
          currentRecord,
          requestRecord,
          this.evidenceRecords,
          this.limits
        );

        if (fault?.failOnRequestCreateWrite) {
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            'Simulated failure while writing review request.'
          );
        }

        this.reviewRequests.set(
          params.requestId,
          stripUndefinedRecursively({ ...requestRecord })
        );

        return cloneReviewRequestRecord(requestRecord, this.limits);
      } catch (err) {
        this.restoreStateSnapshot(snapshot);
        throw mapRepositoryError(err);
      }
    });
  }

  async transitionRightsAtomic(
    params: ExecuteAtomicRightsTransitionParams
  ): Promise<EditorialImageRightsTransitionResult> {
    const validAssetId = validateRepositoryAssetId(
      params.decision.assetId,
      this.limits
    );
    validateExpectedRevision(params.decision.expectedRevision);

    return this.runSerializedTransaction(async () => {
      const fault = this.oneShotFault;
      this.oneShotFault = null;
      const hook = this.beforeNextTransactionHook;
      this.beforeNextTransactionHook = null;
      const snapshot = this.takeStateSnapshot();

      try {
        if (hook) {
          await hook();
        }

        const verifiedReviewer = await this.verifyTransactionalActor(
          params.reviewer
        );

        if (!this.assets.has(validAssetId)) {
          const detail = `Editorial image asset "${validAssetId}" was not found.`;
          throw new EditorialImageRightsReviewError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        const currentRecord = validatePersistedEditorialImageAssetEnvelope(
          validAssetId,
          this.assets.get(validAssetId),
          this.limits
        );

        let persistedRequest: EditorialImageRightsReviewRequestRecord | null =
          null;
        if (params.decision.reviewRequestId !== undefined) {
          if (this.reviewRequests.has(params.decision.reviewRequestId)) {
            persistedRequest = validatePersistedReviewRequestRecord(
              params.decision.reviewRequestId,
              this.reviewRequests.get(params.decision.reviewRequestId),
              this.limits
            );
          }
        }

        if (this.auditEvents.has(params.auditEventId)) {
          const detail = `Audit event "${params.auditEventId}" already exists.`;
          throw new EditorialImageRightsReviewError('ALREADY_EXISTS', detail, [
            detail,
          ]);
        }

        const transitionResult = buildValidatedRightsTransition(
          currentRecord,
          persistedRequest,
          {
            ...params,
            reviewer: verifiedReviewer,
          },
          this.limits
        );

        verifyEvidenceRecordsForRightsTransition(
          currentRecord,
          persistedRequest,
          params.decision,
          transitionResult,
          this.evidenceRecords,
          this.limits
        );

        // Step 1: Write updated asset envelope
        if (fault?.failOnAssetWrite) {
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            'Simulated failure during asset envelope write.'
          );
        }
        this.assets.set(
          validAssetId,
          serializeEnvelopeForPersistence(transitionResult.record, this.limits)
        );

        // Step 2: Write immutable audit event
        if (fault?.failOnAuditWrite) {
          throw new EditorialImageRightsReviewError(
            'PERSISTENCE_FAILURE',
            'Simulated failure during audit event write.'
          );
        }
        this.auditEvents.set(
          transitionResult.auditEvent.id,
          stripUndefinedRecursively({ ...transitionResult.auditEvent })
        );

        // Step 3: Mark review request consumed if applicable
        if (transitionResult.consumedReviewRequest) {
          if (fault?.failOnRequestConsumeWrite) {
            throw new EditorialImageRightsReviewError(
              'PERSISTENCE_FAILURE',
              'Simulated failure during review request consumption write.'
            );
          }
          this.reviewRequests.set(
            transitionResult.consumedReviewRequest.requestId,
            stripUndefinedRecursively({
              ...transitionResult.consumedReviewRequest,
            })
          );
        }

        return transitionResult;
      } catch (err) {
        this.restoreStateSnapshot(snapshot);
        throw mapRepositoryError(err);
      }
    });
  }
}

export interface EditorialImageRightsReviewServiceOptions {
  readonly adminRepository: AdminRepository;
  readonly transactionRunner: EditorialImageRightsReviewTransactionRunner;
  readonly clock?: () => string;
  readonly idGenerator?: (prefix: string) => string;
  readonly limits?: EditorialImageAssetValidationLimits;
}

/**
 * Trusted server application service for editorial image rights evidence
 * registration/revocation, review requests, human rights decisions, and atomic
 * image-specific audit logging.
 */
export class EditorialImageRightsReviewService {
  private readonly adminRepo: AdminRepository;
  private readonly runner: EditorialImageRightsReviewTransactionRunner;
  private readonly clock: () => string;
  private readonly idGenerator: (prefix: string) => string;
  private readonly limits: EditorialImageAssetValidationLimits;
  private idCounter = 0;

  constructor(options: EditorialImageRightsReviewServiceOptions) {
    if (!options || !options.adminRepository || !options.transactionRunner) {
      const detail =
        'EditorialImageRightsReviewService requires both an AdminRepository and an EditorialImageRightsReviewTransactionRunner.';
      throw new EditorialImageRightsReviewError(
        'PERSISTENCE_FAILURE',
        detail,
        [detail]
      );
    }
    this.adminRepo = options.adminRepository;
    this.runner = options.transactionRunner;
    if (this.runner instanceof InMemoryEditorialImageRightsReviewRunner) {
      this.runner.bindAdminRepositoryIfUnset(this.adminRepo);
    }
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.limits = options.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;
    this.idGenerator =
      options.idGenerator ??
      ((prefix: string) => {
        this.idCounter += 1;
        return `${prefix}_${Date.now()}_${this.idCounter}`;
      });
  }

  /**
   * Resolves and verifies the human caller exclusively from the trusted
   * server request context and the canonical AdminRepository.
   */
  private async authenticateHumanWithManageRights(
    requestContext: CallableRequestContext | null | undefined
  ): Promise<AuthenticatedHumanReviewer> {
    if (
      !requestContext ||
      !requestContext.auth ||
      typeof requestContext.auth.uid !== 'string' ||
      requestContext.auth.uid.trim().length === 0
    ) {
      const detail =
        'UNAUTHENTICATED: Trusted server authentication is required for editorial image rights operations.';
      throw new EditorialImageRightsReviewError('UNAUTHENTICATED', detail, [
        detail,
      ]);
    }

    const rawUid = requestContext.auth.uid;
    if (rawUid !== rawUid.trim() || !UID_CHARS_REGEX.test(rawUid)) {
      const detail =
        'UNAUTHENTICATED: Authenticated caller UID format is invalid.';
      throw new EditorialImageRightsReviewError('UNAUTHENTICATED', detail, [
        detail,
      ]);
    }

    const admin: AdminUser | null = await this.adminRepo.getAdminByUid(rawUid);
    return validateAdminRecordForRightsManagement(rawUid, admin);
  }

  /**
   * Registers a durable rights evidence record bound to an active editorial
   * image asset inside an atomic server transaction.
   */
  async registerRightsEvidence(
    requestContext: CallableRequestContext,
    rawInput: RegisterEditorialImageRightsEvidenceInput
  ): Promise<EditorialImageRightsEvidenceRecord> {
    const recorder =
      await this.authenticateHumanWithManageRights(requestContext);
    const validatedInput = validateRegisterEvidenceInput(rawInput, this.limits);

    const evidenceId =
      validatedInput.evidenceId ??
      this.idGenerator(`ev_${validatedInput.assetId}`);
    const idCheck = validateEvidenceId(evidenceId, this.limits);
    if (!idCheck.valid) {
      throw new EditorialImageRightsReviewError(
        'INVALID_INPUT',
        `Generated or supplied evidenceId "${evidenceId}" is invalid.`,
        idCheck.errors
      );
    }

    const recordedAtIso = this.clock();

    return this.runner.registerEvidenceAtomic({
      recorder,
      input: validatedInput,
      evidenceId,
      recordedAtIso,
    });
  }

  /**
   * Revokes an active rights evidence record inside an atomic server
   * transaction without deleting its historical registry entry.
   */
  async revokeRightsEvidence(
    requestContext: CallableRequestContext,
    rawInput: RevokeEditorialImageRightsEvidenceInput
  ): Promise<EditorialImageRightsEvidenceRecord> {
    const revoker =
      await this.authenticateHumanWithManageRights(requestContext);
    const validatedInput = validateRevokeEvidenceInput(rawInput, this.limits);
    const revokedAtIso = this.clock();

    return this.runner.revokeEvidenceAtomic({
      revoker,
      input: validatedInput,
      revokedAtIso,
    });
  }

  /**
   * Submits a server-controlled, persisted review request for an asset in
   * `Rejected` or `Revoked` state with documented rationale and at least one
   * new active evidence record registered after the prior decision.
   */
  async submitRightsReviewRequest(
    requestContext: CallableRequestContext,
    rawInput: SubmitEditorialImageRightsReviewRequestInput
  ): Promise<EditorialImageRightsReviewRequestRecord> {
    const requester =
      await this.authenticateHumanWithManageRights(requestContext);
    const validatedInput = validateSubmitReviewRequestInput(
      rawInput,
      this.limits
    );

    const requestId =
      validatedInput.requestId ??
      this.idGenerator(`img_req_${validatedInput.assetId}`);
    const reqIdCheck = validateAssetId(requestId, this.limits);
    if (!reqIdCheck.valid) {
      throw new EditorialImageRightsReviewError(
        'INVALID_REVIEW_REQUEST',
        `Generated or supplied requestId "${requestId}" is invalid.`,
        reqIdCheck.errors
      );
    }

    const requestedAtIso = this.clock();

    return this.runner.submitReviewRequestAtomic({
      requester,
      input: validatedInput,
      requestId,
      requestedAtIso,
    });
  }

  /**
   * Executes an authorized human rights review transition and atomically
   * persists the updated asset envelope, immutable image-specific audit record,
   * and review-request consumption where applicable.
   */
  async transitionEditorialImageRights(
    requestContext: CallableRequestContext,
    rawDecision: EditorialImageRightsDecisionInput
  ): Promise<EditorialImageRightsTransitionResult> {
    const reviewer =
      await this.authenticateHumanWithManageRights(requestContext);
    const validatedDecision = validateRightsDecisionInput(
      rawDecision,
      this.limits
    );

    const decisionTimestampIso = this.clock();
    const auditEventId = this.idGenerator(
      `img_audit_${validatedDecision.assetId}_r${validatedDecision.expectedRevision + 1}`
    );

    return this.runner.transitionRightsAtomic({
      reviewer,
      decision: validatedDecision,
      decisionTimestampIso,
      auditEventId,
    });
  }
}

