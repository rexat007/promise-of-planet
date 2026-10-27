import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import {
  AdminRole,
  isValidAdminRole,
  type AdminUser,
} from '../types/admin';

export const AdminInvitationStatus = {
  Pending: 'Pending',
  Accepted: 'Accepted',
  Revoked: 'Revoked',
  Expired: 'Expired',
} as const;

export type AdminInvitationStatus =
  typeof AdminInvitationStatus[keyof typeof AdminInvitationStatus];

export const DEFAULT_ADMIN_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MIN_ADMIN_INVITATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_ADMIN_INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export const MANAGE_ADMIN_INVITATION_ACTIONS = [
  'createInvitation',
  'revokeInvitation',
  'acceptInvitation',
] as const;

export type ManageAdminInvitationAction =
  (typeof MANAGE_ADMIN_INVITATION_ACTIONS)[number];

export type AdminIdentityCallableName =
  | 'listAdminUsers'
  | 'manageAdminInvitations'
  | 'manageAdminLifecycle';

export type AdminIdentityCallableErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'not-found'
  | 'aborted'
  | 'unavailable'
  | 'internal';

export type AdminIdentityClientFailureReason =
  | 'UNAUTHENTICATED_SESSION'
  | 'BACKEND_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'INVALID_ARGUMENT'
  | 'FAILED_PRECONDITION'
  | 'TARGET_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'SPOOFED_AUTHORITY_REJECTED'
  | 'OWNER_ACTIVATION_FORBIDDEN'
  | 'OWNER_PROMOTION_FORBIDDEN'
  | 'INVALID_SERVER_RESPONSE'
  | 'DUPLICATE_ADMIN_UID'
  | 'INVALID_ADMIN_ROLE'
  | 'MALFORMED_ADMIN_RECORD'
  | 'MALFORMED_INVITATION_RECORD'
  | 'MALFORMED_LIFECYCLE_RECORD';

const SAFE_ERROR_MESSAGES: Readonly<
  Record<AdminIdentityCallableErrorCode, string>
> = {
  unauthenticated:
    'Authentication is required to access administrative identity services.',
  'permission-denied':
    'Caller is not authorized to perform this administrative identity operation.',
  'invalid-argument':
    'Invalid administrative identity request parameters.',
  'failed-precondition':
    'Administrative identity operation precondition failed.',
  'not-found':
    'Target administrative identity not found.',
  aborted:
    'Administrative revision or transaction conflict occurred; retry with the latest revision.',
  unavailable:
    'Administrative identity service is currently unavailable.',
  internal:
    'An internal error occurred while processing the administrative identity operation.',
};

export class AdminIdentityClientError extends Error {
  public readonly code: AdminIdentityCallableErrorCode;
  public readonly reason: AdminIdentityClientFailureReason;

  constructor(
    code: AdminIdentityCallableErrorCode,
    reason: AdminIdentityClientFailureReason,
    safeMessage?: string
  ) {
    super(safeMessage ? sanitizeClientErrorMessage(safeMessage, code) : SAFE_ERROR_MESSAGES[code]);
    this.name = 'AdminIdentityClientError';
    this.code = code;
    this.reason = reason;
    // Prevent internal stack trace leakage across error serialization boundaries
    Object.defineProperty(this, 'stack', {
      value: `${this.name}: ${this.message}`,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

export interface SanitizedAdminDirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
}

export interface ListAdminUsersClientResponse {
  readonly admins: ReadonlyArray<SanitizedAdminDirectoryEntry>;
}

export interface ExplicitOwnerRoleGrantAuthorization {
  readonly confirmedOwnerRoleGrant: true;
  readonly authorizingOwnerUid: string;
}

export interface CreateAdminInvitationClientInput {
  readonly targetEmail: string;
  readonly intendedRole: AdminRole;
  readonly targetUid?: string | null;
  readonly ttlMs?: number;
  readonly explicitOwnerRoleGrant?: ExplicitOwnerRoleGrantAuthorization;
}

export interface RevokeAdminInvitationClientInput {
  readonly invitationId: string;
  readonly expectedRevision?: number;
}

export interface AcceptAdminInvitationClientInput {
  readonly invitationId: string;
  readonly expectedRevision?: number;
}

export interface SanitizedAdminInvitationDto {
  readonly invitationId: string;
  readonly targetUid: string | null;
  readonly normalizedTargetEmail: string;
  readonly intendedRole: AdminRole;
  readonly invitingOwnerUid: string;
  readonly createdAtIso: string;
  readonly expiresAtIso: string;
  readonly status: AdminInvitationStatus;
  readonly acceptedAtIso: string | null;
  readonly acceptedByUid: string | null;
  readonly revokedAtIso: string | null;
  readonly revokedByOwnerUid: string | null;
  readonly expiredAtIso: string | null;
  readonly revision: number;
}

export type SanitizedActivatedAdminDto = SanitizedAdminDirectoryEntry;

export interface CreateAdminInvitationClientResponse {
  readonly invitation: SanitizedAdminInvitationDto;
  readonly auditEventId: string;
}

export interface RevokeAdminInvitationClientResponse {
  readonly invitation: SanitizedAdminInvitationDto;
  readonly auditEventId: string;
}

export interface AcceptAdminInvitationClientResponse {
  readonly invitation: SanitizedAdminInvitationDto;
  readonly admin: SanitizedActivatedAdminDto;
  readonly auditEventId: string;
}

export type ManageAdminInvitationsClientPayload =
  | {
      readonly action: 'createInvitation';
      readonly targetEmail: string;
      readonly intendedRole: AdminRole;
      readonly targetUid?: string | null;
      readonly ttlMs?: number;
      readonly explicitOwnerRoleGrant?: ExplicitOwnerRoleGrantAuthorization;
    }
  | {
      readonly action: 'revokeInvitation';
      readonly invitationId: string;
      readonly expectedRevision?: number;
    }
  | {
      readonly action: 'acceptInvitation';
      readonly invitationId: string;
      readonly expectedRevision?: number;
    };

export const ADMIN_LIFECYCLE_OPERATIONS = [
  'ChangeRole',
  'Deactivate',
  'Reactivate',
  'InitializeRevision',
] as const;

export type AdminLifecycleOperation =
  (typeof ADMIN_LIFECYCLE_OPERATIONS)[number];

export function isValidAdminLifecycleOperation(
  op: unknown
): op is AdminLifecycleOperation {
  return (
    typeof op === 'string' &&
    (ADMIN_LIFECYCLE_OPERATIONS as readonly string[]).includes(op)
  );
}

export interface ChangeAdminRoleClientInput {
  readonly targetUid: string;
  readonly expectedRevision: number;
  readonly targetRole: AdminRole;
}

export interface DeactivateAdminClientInput {
  readonly targetUid: string;
  readonly expectedRevision: number;
}

export interface ReactivateAdminClientInput {
  readonly targetUid: string;
  readonly expectedRevision: number;
}

export interface InitializeAdminRevisionClientInput {
  readonly targetUid: string;
}

export interface SanitizedAdminIdentityLifecycleStateDto {
  readonly id: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
  readonly revision: number;
}

export interface SanitizedLifecycleAuditReceiptDto {
  readonly auditEventId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly timestamp: string;
}

export interface AdminLifecycleClientResponse {
  readonly operation: AdminLifecycleOperation;
  readonly targetUid: string;
  readonly previousRevision: number | null;
  readonly currentRevision: number;
  readonly committedAtIso: string;
  readonly admin: SanitizedAdminIdentityLifecycleStateDto;
  readonly auditReceipt: SanitizedLifecycleAuditReceiptDto;
}

export type ManageAdminLifecycleClientPayload =
  | {
      readonly operation: 'ChangeRole';
      readonly targetUid: string;
      readonly expectedRevision: number;
      readonly targetRole: AdminRole;
    }
  | {
      readonly operation: 'Deactivate';
      readonly targetUid: string;
      readonly expectedRevision: number;
    }
  | {
      readonly operation: 'Reactivate';
      readonly targetUid: string;
      readonly expectedRevision: number;
    }
  | {
      readonly operation: 'InitializeRevision';
      readonly targetUid: string;
    };

export type CallableInvoker<TReq = unknown, TRes = unknown> = (
  payload: TReq
) => Promise<{ readonly data: TRes } | TRes>;

export type GenericAdminCallableTransport = <TReq = unknown, TRes = unknown>(
  callableName: AdminIdentityCallableName,
  payload: TReq
) => Promise<{ readonly data: TRes } | TRes>;

export interface AdminIdentityClientDependencies {
  readonly isBackendConfigured?: () => boolean;
  readonly getAuthenticatedUid?: () => string | null;
  readonly listAdminUsersCallable?: CallableInvoker<Record<string, never>, unknown>;
  readonly manageAdminInvitationsCallable?: CallableInvoker<
    ManageAdminInvitationsClientPayload,
    unknown
  >;
  readonly manageAdminLifecycleCallable?: CallableInvoker<
    ManageAdminLifecycleClientPayload,
    unknown
  >;
  readonly invokeCallable?: GenericAdminCallableTransport;
}

const CANONICAL_ADMIN_DIRECTORY_KEYS = new Set<string>([
  'id',
  'name',
  'email',
  'role',
  'isActive',
]);

const CANONICAL_INVITATION_DTO_KEYS = new Set<string>([
  'invitationId',
  'targetUid',
  'normalizedTargetEmail',
  'intendedRole',
  'invitingOwnerUid',
  'createdAtIso',
  'expiresAtIso',
  'status',
  'acceptedAtIso',
  'acceptedByUid',
  'revokedAtIso',
  'revokedByOwnerUid',
  'expiredAtIso',
  'revision',
]);

const CREATE_INVITATION_CLIENT_ALLOWED_KEYS = new Set<string>([
  'targetEmail',
  'intendedRole',
  'targetUid',
  'ttlMs',
  'explicitOwnerRoleGrant',
]);

const REVOKE_INVITATION_CLIENT_ALLOWED_KEYS = new Set<string>([
  'invitationId',
  'expectedRevision',
]);

const ACCEPT_INVITATION_CLIENT_ALLOWED_KEYS = new Set<string>([
  'invitationId',
  'expectedRevision',
]);

const LIFECYCLE_CHANGE_ROLE_ALLOWED_KEYS = new Set<string>([
  'targetUid',
  'expectedRevision',
  'targetRole',
]);

const LIFECYCLE_DEACTIVATE_ALLOWED_KEYS = new Set<string>([
  'targetUid',
  'expectedRevision',
]);

const LIFECYCLE_REACTIVATE_ALLOWED_KEYS = new Set<string>([
  'targetUid',
  'expectedRevision',
]);

const LIFECYCLE_INITIALIZE_REVISION_ALLOWED_KEYS = new Set<string>([
  'targetUid',
]);

const CANONICAL_LIFECYCLE_ADMIN_DTO_KEYS = new Set<string>([
  'id',
  'role',
  'isActive',
  'revision',
]);

const CANONICAL_LIFECYCLE_AUDIT_RECEIPT_KEYS = new Set<string>([
  'auditEventId',
  'action',
  'targetType',
  'targetId',
  'timestamp',
]);

const CANONICAL_LIFECYCLE_RESPONSE_KEYS = new Set<string>([
  'operation',
  'targetUid',
  'previousRevision',
  'currentRevision',
  'committedAtIso',
  'admin',
  'auditReceipt',
]);

const PROTOTYPE_POLLUTION_KEYS = new Set<string>([
  '__proto__',
  'constructor',
  'prototype',
]);

const SPOOFED_AUTHORITY_AND_SECRET_KEYS = new Set<string>([
  'action',
  'callerUid',
  'uid',
  'invitingOwnerUid',
  'revokedByOwnerUid',
  'acceptedByUid',
  'emailVerified',
  'verifiedEmail',
  'isOwner',
  'isAdmin',
  'isActive',
  'permissions',
  'admin',
  'role',
  'status',
  'revision',
  'token',
  'idToken',
  'accessToken',
  'refreshToken',
  'secret',
  'invitationToken',
  'invitationSecret',
  'invitationUrl',
  'oobCode',
  'password',
  'credential',
  'customClaims',
  'auth',
  'actorUid',
  'actorRole',
  'activeOwnerCount',
  'trustedOwnerState',
  'explicitOwnerPromotionPolicy',
]);

const FORBIDDEN_SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /password/i,
  /token/i,
  /secret/i,
  /oobcode/i,
  /credential/i,
  /privatekey/i,
  /apikey/i,
];

const INTERNAL_LEAK_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\bat\s+[^\n]+/i,
  /\/workspace\//i,
  /\/app\/applet\//i,
  /functions\/src\//i,
  /src\/services\//i,
  /node_modules\//i,
  /[A-Za-z]:\\/,
  /\badmins\/[A-Za-z0-9_-]+/i,
  /\badmin_invitations\/[A-Za-z0-9_-]+/i,
  /\baudit_logs\/[A-Za-z0-9_-]+/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
];

const INVITATION_LOCATOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const AUDIT_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const FIREBASE_UID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let runtimeOverrides: AdminIdentityClientDependencies | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeClientErrorMessage(
  rawMessage: unknown,
  fallbackCode: AdminIdentityCallableErrorCode
): string {
  if (typeof rawMessage !== 'string') {
    return SAFE_ERROR_MESSAGES[fallbackCode];
  }
  const firstLine = rawMessage.split(/\r?\n/)[0]?.trim() ?? '';
  if (!firstLine || firstLine.length > 240) {
    return SAFE_ERROR_MESSAGES[fallbackCode];
  }
  if (INTERNAL_LEAK_MESSAGE_PATTERNS.some((pattern) => pattern.test(rawMessage))) {
    return SAFE_ERROR_MESSAGES[fallbackCode];
  }
  return firstLine;
}

function normalizeFirebaseCallableErrorCode(
  rawCode: unknown
): AdminIdentityCallableErrorCode | null {
  if (typeof rawCode !== 'string') {
    return null;
  }
  const normalized = rawCode
    .trim()
    .toLowerCase()
    .replace(/^functions\//, '');

  switch (normalized) {
    case 'unauthenticated':
      return 'unauthenticated';
    case 'permission-denied':
      return 'permission-denied';
    case 'invalid-argument':
      return 'invalid-argument';
    case 'failed-precondition':
      return 'failed-precondition';
    case 'not-found':
      return 'not-found';
    case 'aborted':
      return 'aborted';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'unavailable';
    case 'internal':
    case 'resource-exhausted':
    case 'unknown':
    case 'data-loss':
      return 'internal';
    default:
      return null;
  }
}

function mapCodeToDefaultReason(
  code: AdminIdentityCallableErrorCode
): AdminIdentityClientFailureReason {
  switch (code) {
    case 'unauthenticated':
      return 'UNAUTHENTICATED_SESSION';
    case 'permission-denied':
      return 'PERMISSION_DENIED';
    case 'invalid-argument':
      return 'INVALID_ARGUMENT';
    case 'failed-precondition':
      return 'FAILED_PRECONDITION';
    case 'not-found':
      return 'TARGET_NOT_FOUND';
    case 'aborted':
      return 'REVISION_CONFLICT';
    case 'unavailable':
      return 'SERVICE_UNAVAILABLE';
    case 'internal':
    default:
      return 'INTERNAL_ERROR';
  }
}

export function mapCallableBoundaryError(
  error: unknown
): AdminIdentityClientError {
  if (error instanceof AdminIdentityClientError) {
    return error;
  }

  if (error && typeof error === 'object') {
    const errRecord = error as Record<string, unknown>;
    const mappedCode = normalizeFirebaseCallableErrorCode(errRecord.code);
    if (mappedCode) {
      return new AdminIdentityClientError(
        mappedCode,
        mapCodeToDefaultReason(mappedCode),
        SAFE_ERROR_MESSAGES[mappedCode]
      );
    }
  }

  return new AdminIdentityClientError(
    'internal',
    'INTERNAL_ERROR',
    SAFE_ERROR_MESSAGES.internal
  );
}

function isValidAdminInvitationStatus(
  status: unknown
): status is AdminInvitationStatus {
  if (typeof status !== 'string') {
    return false;
  }
  return Object.values(AdminInvitationStatus).includes(
    status as AdminInvitationStatus
  );
}

function parseStrictUtcIsoTimestamp(
  value: unknown
): { readonly iso: string; readonly epochMs: number } | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value) {
    return null;
  }
  const epochMs = Date.parse(trimmed);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== trimmed) {
    return null;
  }
  return { iso: trimmed, epochMs };
}

function validateCanonicalUid(rawUid: unknown): string | null {
  if (typeof rawUid !== 'string') {
    return null;
  }
  const trimmed = rawUid.trim();
  if (!trimmed || trimmed !== rawUid || !FIREBASE_UID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function validateAndNormalizeEmail(rawEmail: unknown): string | null {
  if (typeof rawEmail !== 'string') {
    return null;
  }
  const normalized = rawEmail.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 254 ||
    !EMAIL_PATTERN.test(normalized) ||
    normalized.includes('..')
  ) {
    return null;
  }
  return normalized;
}

function validateInvitationLocatorId(rawId: unknown): string | null {
  if (typeof rawId !== 'string') {
    return null;
  }
  const trimmed = rawId.trim();
  if (
    !trimmed ||
    trimmed !== rawId ||
    !INVITATION_LOCATOR_ID_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function assertNoForbiddenSecretKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }
  }
}

function unwrapCallableEnvelope(rawResult: unknown): unknown {
  if (
    isPlainObject(rawResult) &&
    'data' in rawResult &&
    Object.keys(rawResult).length === 1
  ) {
    return rawResult.data;
  }
  return rawResult;
}

function validateSanitizedAdminDirectoryEntry(
  rawEntry: unknown,
  seenIds: Set<string>
): SanitizedAdminDirectoryEntry {
  if (!isPlainObject(rawEntry)) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_ADMIN_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  assertNoForbiddenSecretKeys(rawEntry);

  const keys = Object.keys(rawEntry);
  if (
    keys.length !== CANONICAL_ADMIN_DIRECTORY_KEYS.size ||
    keys.some((k) => !CANONICAL_ADMIN_DIRECTORY_KEYS.has(k))
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_ADMIN_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const id = validateCanonicalUid(rawEntry.id);
  if (!id) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_ADMIN_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (seenIds.has(id)) {
    throw new AdminIdentityClientError(
      'internal',
      'DUPLICATE_ADMIN_UID',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (!isValidAdminRole(rawEntry.role)) {
    throw new AdminIdentityClientError(
      'internal',
      'INVALID_ADMIN_ROLE',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (typeof rawEntry.isActive !== 'boolean') {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_ADMIN_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const name =
    typeof rawEntry.name === 'string' &&
    rawEntry.name.trim().length > 0 &&
    rawEntry.name === rawEntry.name.trim()
      ? rawEntry.name
      : null;

  const email =
    typeof rawEntry.email === 'string' &&
    rawEntry.email === rawEntry.email.trim() &&
    validateAndNormalizeEmail(rawEntry.email) !== null
      ? rawEntry.email
      : null;

  if (!name || !email) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_ADMIN_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  seenIds.add(id);

  return Object.freeze({
    id,
    name,
    email,
    role: rawEntry.role,
    isActive: rawEntry.isActive,
  });
}

function validateSanitizedAdminInvitationDto(
  rawDto: unknown
): SanitizedAdminInvitationDto {
  if (!isPlainObject(rawDto)) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_INVITATION_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  assertNoForbiddenSecretKeys(rawDto);

  const keys = Object.keys(rawDto);
  if (
    keys.length !== CANONICAL_INVITATION_DTO_KEYS.size ||
    keys.some((k) => !CANONICAL_INVITATION_DTO_KEYS.has(k))
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_INVITATION_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const invitationId = validateInvitationLocatorId(rawDto.invitationId);
  if (!invitationId) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_INVITATION_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const normalizedTargetEmail = validateAndNormalizeEmail(
    rawDto.normalizedTargetEmail
  );
  if (
    !normalizedTargetEmail ||
    rawDto.normalizedTargetEmail !== normalizedTargetEmail
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_INVITATION_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  let targetUid: string | null = null;
  if (rawDto.targetUid !== null) {
    const validatedTargetUid = validateCanonicalUid(rawDto.targetUid);
    if (!validatedTargetUid) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_INVITATION_RECORD',
        SAFE_ERROR_MESSAGES.internal
      );
    }
    targetUid = validatedTargetUid;
  }

  if (!isValidAdminRole(rawDto.intendedRole)) {
    throw new AdminIdentityClientError(
      'internal',
      'INVALID_ADMIN_ROLE',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const invitingOwnerUid = validateCanonicalUid(rawDto.invitingOwnerUid);
  if (!invitingOwnerUid) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_INVITATION_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const created = parseStrictUtcIsoTimestamp(rawDto.createdAtIso);
  const expires = parseStrictUtcIsoTimestamp(rawDto.expiresAtIso);
  if (!created || !expires || expires.epochMs <= created.epochMs) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_INVITATION_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (!isValidAdminInvitationStatus(rawDto.status)) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_INVITATION_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const revision = rawDto.revision;
  if (
    typeof revision !== 'number' ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_INVITATION_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const status = rawDto.status;
  let acceptedAtIso: string | null = null;
  let acceptedByUid: string | null = null;
  let revokedAtIso: string | null = null;
  let revokedByOwnerUid: string | null = null;
  let expiredAtIso: string | null = null;

  if (status === AdminInvitationStatus.Pending) {
    if (
      rawDto.acceptedAtIso !== null ||
      rawDto.acceptedByUid !== null ||
      rawDto.revokedAtIso !== null ||
      rawDto.revokedByOwnerUid !== null ||
      rawDto.expiredAtIso !== null
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_INVITATION_RECORD',
        SAFE_ERROR_MESSAGES.internal
      );
    }
  } else if (status === AdminInvitationStatus.Accepted) {
    const acceptedAt = parseStrictUtcIsoTimestamp(rawDto.acceptedAtIso);
    const validatedAcceptedBy = validateCanonicalUid(rawDto.acceptedByUid);
    if (
      !acceptedAt ||
      acceptedAt.epochMs < created.epochMs ||
      acceptedAt.epochMs >= expires.epochMs ||
      !validatedAcceptedBy ||
      !targetUid ||
      validatedAcceptedBy !== targetUid ||
      rawDto.revokedAtIso !== null ||
      rawDto.revokedByOwnerUid !== null ||
      rawDto.expiredAtIso !== null
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_INVITATION_RECORD',
        SAFE_ERROR_MESSAGES.internal
      );
    }
    acceptedAtIso = acceptedAt.iso;
    acceptedByUid = validatedAcceptedBy;
  } else if (status === AdminInvitationStatus.Revoked) {
    const revokedAt = parseStrictUtcIsoTimestamp(rawDto.revokedAtIso);
    const validatedRevokedBy = validateCanonicalUid(rawDto.revokedByOwnerUid);
    if (
      !revokedAt ||
      revokedAt.epochMs < created.epochMs ||
      !validatedRevokedBy ||
      rawDto.acceptedAtIso !== null ||
      rawDto.acceptedByUid !== null ||
      rawDto.expiredAtIso !== null
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_INVITATION_RECORD',
        SAFE_ERROR_MESSAGES.internal
      );
    }
    revokedAtIso = revokedAt.iso;
    revokedByOwnerUid = validatedRevokedBy;
  } else if (status === AdminInvitationStatus.Expired) {
    const expiredAt = parseStrictUtcIsoTimestamp(rawDto.expiredAtIso);
    if (
      !expiredAt ||
      expiredAt.epochMs < expires.epochMs ||
      rawDto.acceptedAtIso !== null ||
      rawDto.acceptedByUid !== null ||
      rawDto.revokedAtIso !== null ||
      rawDto.revokedByOwnerUid !== null
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_INVITATION_RECORD',
        SAFE_ERROR_MESSAGES.internal
      );
    }
    expiredAtIso = expiredAt.iso;
  }

  return Object.freeze({
    invitationId,
    targetUid,
    normalizedTargetEmail,
    intendedRole: rawDto.intendedRole,
    invitingOwnerUid,
    createdAtIso: created.iso,
    expiresAtIso: expires.iso,
    status,
    acceptedAtIso,
    acceptedByUid,
    revokedAtIso,
    revokedByOwnerUid,
    expiredAtIso,
    revision,
  });
}

function validateAuditEventId(rawAuditEventId: unknown): string {
  if (typeof rawAuditEventId !== 'string') {
    throw new AdminIdentityClientError(
      'internal',
      'INVALID_SERVER_RESPONSE',
      SAFE_ERROR_MESSAGES.internal
    );
  }
  const trimmed = rawAuditEventId.trim();
  if (
    !trimmed ||
    trimmed !== rawAuditEventId ||
    !AUDIT_EVENT_ID_PATTERN.test(trimmed)
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'INVALID_SERVER_RESPONSE',
      SAFE_ERROR_MESSAGES.internal
    );
  }
  return trimmed;
}

function assertAllowedClientInputKeys(
  input: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  action: ManageAdminInvitationAction
): void {
  for (const key of Object.keys(input)) {
    if (allowedKeys.has(key)) {
      continue;
    }

    if (
      SPOOFED_AUTHORITY_AND_SECRET_KEYS.has(key) ||
      FORBIDDEN_SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key)) ||
      (action === 'acceptInvitation' &&
        (key === 'email' ||
          key === 'targetEmail' ||
          key === 'normalizedTargetEmail' ||
          key === 'intendedRole' ||
          key === 'targetUid' ||
          key === 'explicitOwnerRoleGrant'))
    ) {
      throw new AdminIdentityClientError(
        'permission-denied',
        'SPOOFED_AUTHORITY_REJECTED',
        SAFE_ERROR_MESSAGES['permission-denied']
      );
    }

    throw new AdminIdentityClientError(
      'invalid-argument',
      'INVALID_ARGUMENT',
      SAFE_ERROR_MESSAGES['invalid-argument']
    );
  }
}

function validateOptionalExpectedRevision(
  rawRevision: unknown
): number | undefined {
  if (rawRevision === undefined) {
    return undefined;
  }
  if (
    typeof rawRevision !== 'number' ||
    !Number.isInteger(rawRevision) ||
    rawRevision < 1
  ) {
    throw new AdminIdentityClientError(
      'invalid-argument',
      'INVALID_ARGUMENT',
      SAFE_ERROR_MESSAGES['invalid-argument']
    );
  }
  return rawRevision;
}

function resolveEffectiveDependencies(
  deps?: AdminIdentityClientDependencies
): AdminIdentityClientDependencies {
  if (!deps && !runtimeOverrides) {
    return {};
  }
  return {
    ...(runtimeOverrides ?? {}),
    ...(deps ?? {}),
  };
}

function requireAuthenticatedFirebaseSession(
  deps: AdminIdentityClientDependencies
): string {
  const backendConfigured = deps.isBackendConfigured
    ? Boolean(deps.isBackendConfigured())
    : Boolean(isFirebaseConfigured && app);

  if (!backendConfigured) {
    throw new AdminIdentityClientError(
      'unavailable',
      'BACKEND_UNAVAILABLE',
      SAFE_ERROR_MESSAGES.unavailable
    );
  }

  const rawUid = deps.getAuthenticatedUid
    ? deps.getAuthenticatedUid()
    : (auth?.currentUser?.uid ?? null);

  const validatedUid = validateCanonicalUid(rawUid);
  if (!validatedUid) {
    throw new AdminIdentityClientError(
      'unauthenticated',
      'UNAUTHENTICATED_SESSION',
      SAFE_ERROR_MESSAGES.unauthenticated
    );
  }

  return validatedUid;
}

async function invokeListAdminUsersCallable(
  deps: AdminIdentityClientDependencies
): Promise<unknown> {
  if (deps.listAdminUsersCallable) {
    const raw = await deps.listAdminUsersCallable({});
    return unwrapCallableEnvelope(raw);
  }

  if (deps.invokeCallable) {
    const raw = await deps.invokeCallable('listAdminUsers', {});
    return unwrapCallableEnvelope(raw);
  }

  if (!isFirebaseConfigured || !app) {
    throw new AdminIdentityClientError(
      'unavailable',
      'BACKEND_UNAVAILABLE',
      SAFE_ERROR_MESSAGES.unavailable
    );
  }

  const fns = getFunctions(app);
  const callable = httpsCallable<Record<string, never>, unknown>(
    fns,
    'listAdminUsers'
  );
  const res = await callable({});
  return res.data;
}

async function invokeManageAdminInvitationsCallable(
  payload: ManageAdminInvitationsClientPayload,
  deps: AdminIdentityClientDependencies
): Promise<unknown> {
  if (deps.manageAdminInvitationsCallable) {
    const raw = await deps.manageAdminInvitationsCallable(payload);
    return unwrapCallableEnvelope(raw);
  }

  if (deps.invokeCallable) {
    const raw = await deps.invokeCallable('manageAdminInvitations', payload);
    return unwrapCallableEnvelope(raw);
  }

  if (!isFirebaseConfigured || !app) {
    throw new AdminIdentityClientError(
      'unavailable',
      'BACKEND_UNAVAILABLE',
      SAFE_ERROR_MESSAGES.unavailable
    );
  }

  const fns = getFunctions(app);
  const callable = httpsCallable<ManageAdminInvitationsClientPayload, unknown>(
    fns,
    'manageAdminInvitations'
  );
  const res = await callable(payload);
  return res.data;
}

async function invokeManageAdminLifecycleCallable(
  payload: ManageAdminLifecycleClientPayload,
  deps: AdminIdentityClientDependencies
): Promise<unknown> {
  if (deps.manageAdminLifecycleCallable) {
    const raw = await deps.manageAdminLifecycleCallable(payload);
    return unwrapCallableEnvelope(raw);
  }

  if (deps.invokeCallable) {
    const raw = await deps.invokeCallable('manageAdminLifecycle', payload);
    return unwrapCallableEnvelope(raw);
  }

  if (!isFirebaseConfigured || !app) {
    throw new AdminIdentityClientError(
      'unavailable',
      'BACKEND_UNAVAILABLE',
      SAFE_ERROR_MESSAGES.unavailable
    );
  }

  const fns = getFunctions(app);
  const callable = httpsCallable<ManageAdminLifecycleClientPayload, unknown>(
    fns,
    'manageAdminLifecycle'
  );
  const res = await callable(payload);
  return res.data;
}

export async function listAdminUsers(
  deps?: AdminIdentityClientDependencies
): Promise<ListAdminUsersClientResponse> {
  const effectiveDeps = resolveEffectiveDependencies(deps);

  try {
    requireAuthenticatedFirebaseSession(effectiveDeps);

    const rawResponse = await invokeListAdminUsersCallable(effectiveDeps);

    if (!isPlainObject(rawResponse)) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    assertNoForbiddenSecretKeys(rawResponse);

    const topKeys = Object.keys(rawResponse);
    if (topKeys.length !== 1 || topKeys[0] !== 'admins') {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    if (!Array.isArray(rawResponse.admins)) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    const seenIds = new Set<string>();
    const admins = rawResponse.admins.map((entry) =>
      validateSanitizedAdminDirectoryEntry(entry, seenIds)
    );

    return Object.freeze({
      admins: Object.freeze(admins),
    });
  } catch (error: unknown) {
    throw mapCallableBoundaryError(error);
  }
}

export async function createAdminInvitation(
  input: CreateAdminInvitationClientInput,
  deps?: AdminIdentityClientDependencies
): Promise<CreateAdminInvitationClientResponse> {
  const effectiveDeps = resolveEffectiveDependencies(deps);

  try {
    const callerUid = requireAuthenticatedFirebaseSession(effectiveDeps);

    if (!isPlainObject(input)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    assertAllowedClientInputKeys(
      input,
      CREATE_INVITATION_CLIENT_ALLOWED_KEYS,
      'createInvitation'
    );

    const normalizedTargetEmail = validateAndNormalizeEmail(input.targetEmail);
    if (!normalizedTargetEmail) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    if (!isValidAdminRole(input.intendedRole)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ADMIN_ROLE',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    let sanitizedTargetUid: string | null | undefined;
    if (input.targetUid !== undefined) {
      if (input.targetUid === null) {
        sanitizedTargetUid = null;
      } else {
        const validatedTargetUid =
          typeof input.targetUid === 'string'
            ? validateCanonicalUid(input.targetUid.trim())
            : null;
        if (!validatedTargetUid) {
          throw new AdminIdentityClientError(
            'invalid-argument',
            'INVALID_ARGUMENT',
            SAFE_ERROR_MESSAGES['invalid-argument']
          );
        }
        sanitizedTargetUid = validatedTargetUid;
      }
    }

    let sanitizedTtlMs: number | undefined;
    if (input.ttlMs !== undefined) {
      if (
        typeof input.ttlMs !== 'number' ||
        !Number.isInteger(input.ttlMs) ||
        input.ttlMs < MIN_ADMIN_INVITATION_TTL_MS ||
        input.ttlMs > MAX_ADMIN_INVITATION_TTL_MS
      ) {
        throw new AdminIdentityClientError(
          'invalid-argument',
          'INVALID_ARGUMENT',
          SAFE_ERROR_MESSAGES['invalid-argument']
        );
      }
      sanitizedTtlMs = input.ttlMs;
    }

    let sanitizedOwnerGrant: ExplicitOwnerRoleGrantAuthorization | undefined;
    if (input.explicitOwnerRoleGrant !== undefined) {
      if (!isPlainObject(input.explicitOwnerRoleGrant)) {
        throw new AdminIdentityClientError(
          'invalid-argument',
          'INVALID_ARGUMENT',
          SAFE_ERROR_MESSAGES['invalid-argument']
        );
      }
      const grantObj = input.explicitOwnerRoleGrant as Record<string, unknown>;
      const grantKeys = Object.keys(grantObj);
      if (
        grantKeys.some(
          (k) => k !== 'confirmedOwnerRoleGrant' && k !== 'authorizingOwnerUid'
        )
      ) {
        throw new AdminIdentityClientError(
          'invalid-argument',
          'INVALID_ARGUMENT',
          SAFE_ERROR_MESSAGES['invalid-argument']
        );
      }
      const authorizingUid =
        typeof grantObj.authorizingOwnerUid === 'string'
          ? validateCanonicalUid(grantObj.authorizingOwnerUid.trim())
          : null;
      if (
        grantObj.confirmedOwnerRoleGrant !== true ||
        !authorizingUid ||
        authorizingUid !== callerUid
      ) {
        throw new AdminIdentityClientError(
          'permission-denied',
          'PERMISSION_DENIED',
          SAFE_ERROR_MESSAGES['permission-denied']
        );
      }
      sanitizedOwnerGrant = {
        confirmedOwnerRoleGrant: true,
        authorizingOwnerUid: authorizingUid,
      };
    }

    if (input.intendedRole === AdminRole.Owner && !sanitizedOwnerGrant) {
      throw new AdminIdentityClientError(
        'permission-denied',
        'PERMISSION_DENIED',
        SAFE_ERROR_MESSAGES['permission-denied']
      );
    }

    const payload: ManageAdminInvitationsClientPayload = {
      action: 'createInvitation',
      targetEmail: normalizedTargetEmail,
      intendedRole: input.intendedRole,
      ...(sanitizedTargetUid !== undefined
        ? { targetUid: sanitizedTargetUid }
        : {}),
      ...(sanitizedTtlMs !== undefined ? { ttlMs: sanitizedTtlMs } : {}),
      ...(sanitizedOwnerGrant !== undefined
        ? { explicitOwnerRoleGrant: sanitizedOwnerGrant }
        : {}),
    };

    const rawResponse = await invokeManageAdminInvitationsCallable(
      payload,
      effectiveDeps
    );

    if (!isPlainObject(rawResponse)) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    assertNoForbiddenSecretKeys(rawResponse);

    const responseKeys = Object.keys(rawResponse);
    if (
      responseKeys.length !== 2 ||
      !responseKeys.includes('invitation') ||
      !responseKeys.includes('auditEventId')
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    const invitation = validateSanitizedAdminInvitationDto(
      rawResponse.invitation
    );
    const auditEventId = validateAuditEventId(rawResponse.auditEventId);

    if (
      invitation.status !== AdminInvitationStatus.Pending ||
      invitation.revision !== 1 ||
      invitation.normalizedTargetEmail !== normalizedTargetEmail ||
      invitation.intendedRole !== input.intendedRole ||
      (sanitizedTargetUid !== undefined &&
        invitation.targetUid !== sanitizedTargetUid)
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    return Object.freeze({
      invitation,
      auditEventId,
    });
  } catch (error: unknown) {
    throw mapCallableBoundaryError(error);
  }
}

export async function revokeAdminInvitation(
  input: RevokeAdminInvitationClientInput,
  deps?: AdminIdentityClientDependencies
): Promise<RevokeAdminInvitationClientResponse> {
  const effectiveDeps = resolveEffectiveDependencies(deps);

  try {
    requireAuthenticatedFirebaseSession(effectiveDeps);

    if (!isPlainObject(input)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    assertAllowedClientInputKeys(
      input,
      REVOKE_INVITATION_CLIENT_ALLOWED_KEYS,
      'revokeInvitation'
    );

    const invitationId =
      typeof input.invitationId === 'string'
        ? validateInvitationLocatorId(input.invitationId.trim())
        : null;
    if (!invitationId) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    const expectedRevision = validateOptionalExpectedRevision(
      input.expectedRevision
    );

    const payload: ManageAdminInvitationsClientPayload = {
      action: 'revokeInvitation',
      invitationId,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    };

    const rawResponse = await invokeManageAdminInvitationsCallable(
      payload,
      effectiveDeps
    );

    if (!isPlainObject(rawResponse)) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    assertNoForbiddenSecretKeys(rawResponse);

    const responseKeys = Object.keys(rawResponse);
    if (
      responseKeys.length !== 2 ||
      !responseKeys.includes('invitation') ||
      !responseKeys.includes('auditEventId')
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    const invitation = validateSanitizedAdminInvitationDto(
      rawResponse.invitation
    );
    const auditEventId = validateAuditEventId(rawResponse.auditEventId);

    if (
      invitation.invitationId !== invitationId ||
      invitation.status !== AdminInvitationStatus.Revoked ||
      invitation.revokedAtIso === null ||
      invitation.revokedByOwnerUid === null ||
      invitation.revision < 2 ||
      (expectedRevision !== undefined &&
        invitation.revision !== expectedRevision + 1)
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    return Object.freeze({
      invitation,
      auditEventId,
    });
  } catch (error: unknown) {
    throw mapCallableBoundaryError(error);
  }
}

export async function acceptAdminInvitation(
  input: AcceptAdminInvitationClientInput,
  deps?: AdminIdentityClientDependencies
): Promise<AcceptAdminInvitationClientResponse> {
  const effectiveDeps = resolveEffectiveDependencies(deps);

  try {
    const authenticatedCallerUid =
      requireAuthenticatedFirebaseSession(effectiveDeps);

    if (!isPlainObject(input)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    assertAllowedClientInputKeys(
      input,
      ACCEPT_INVITATION_CLIENT_ALLOWED_KEYS,
      'acceptInvitation'
    );

    const invitationId =
      typeof input.invitationId === 'string'
        ? validateInvitationLocatorId(input.invitationId.trim())
        : null;
    if (!invitationId) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    const expectedRevision = validateOptionalExpectedRevision(
      input.expectedRevision
    );

    const payload: ManageAdminInvitationsClientPayload = {
      action: 'acceptInvitation',
      invitationId,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    };

    const rawResponse = await invokeManageAdminInvitationsCallable(
      payload,
      effectiveDeps
    );

    if (!isPlainObject(rawResponse)) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    assertNoForbiddenSecretKeys(rawResponse);

    const responseKeys = Object.keys(rawResponse);
    if (
      responseKeys.length !== 3 ||
      !responseKeys.includes('invitation') ||
      !responseKeys.includes('admin') ||
      !responseKeys.includes('auditEventId')
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    const invitation = validateSanitizedAdminInvitationDto(
      rawResponse.invitation
    );
    const admin = validateSanitizedAdminDirectoryEntry(
      rawResponse.admin,
      new Set<string>()
    );
    const auditEventId = validateAuditEventId(rawResponse.auditEventId);

    // Owner invitations must never be activated through the invitation acceptance boundary
    if (
      invitation.intendedRole === AdminRole.Owner ||
      admin.role === AdminRole.Owner
    ) {
      throw new AdminIdentityClientError(
        'permission-denied',
        'OWNER_ACTIVATION_FORBIDDEN',
        SAFE_ERROR_MESSAGES['permission-denied']
      );
    }

    if (
      invitation.invitationId !== invitationId ||
      invitation.status !== AdminInvitationStatus.Accepted ||
      invitation.acceptedAtIso === null ||
      invitation.acceptedByUid !== authenticatedCallerUid ||
      invitation.targetUid !== authenticatedCallerUid ||
      invitation.revision < 2 ||
      (expectedRevision !== undefined &&
        invitation.revision !== expectedRevision + 1) ||
      admin.id !== authenticatedCallerUid ||
      admin.role !== invitation.intendedRole ||
      admin.isActive !== true ||
      admin.email.trim().toLowerCase() !== invitation.normalizedTargetEmail
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_SERVER_RESPONSE',
        SAFE_ERROR_MESSAGES.internal
      );
    }

    return Object.freeze({
      invitation,
      admin,
      auditEventId,
    });
  } catch (error: unknown) {
    throw mapCallableBoundaryError(error);
  }
}

function assertNoLifecycleAuthorityOrPollution(
  input: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): void {
  for (const key of Object.keys(input)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }
    if (
      SPOOFED_AUTHORITY_AND_SECRET_KEYS.has(key) ||
      FORBIDDEN_SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))
    ) {
      throw new AdminIdentityClientError(
        'permission-denied',
        'SPOOFED_AUTHORITY_REJECTED',
        SAFE_ERROR_MESSAGES['permission-denied']
      );
    }
    if (!allowedKeys.has(key)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }
  }
}

function validateRequiredExpectedRevision(rawRevision: unknown): number {
  if (
    typeof rawRevision !== 'number' ||
    !Number.isInteger(rawRevision) ||
    !Number.isSafeInteger(rawRevision) ||
    rawRevision < 1
  ) {
    throw new AdminIdentityClientError(
      'invalid-argument',
      'INVALID_ARGUMENT',
      'expectedRevision must be a positive integer >= 1.'
    );
  }
  return rawRevision;
}

function validateSanitizedAdminLifecycleResponse(
  rawResult: unknown,
  expectedOperation: AdminLifecycleOperation,
  expectedTargetUid: string,
  expectedRevision?: number,
  expectedTargetRole?: AdminRole
): AdminLifecycleClientResponse {
  if (!isPlainObject(rawResult)) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  assertNoForbiddenSecretKeys(rawResult);

  const topKeys = Object.keys(rawResult);
  if (
    topKeys.length !== CANONICAL_LIFECYCLE_RESPONSE_KEYS.size ||
    topKeys.some((k) => !CANONICAL_LIFECYCLE_RESPONSE_KEYS.has(k))
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (rawResult.operation !== expectedOperation) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const targetUid = validateCanonicalUid(rawResult.targetUid);
  if (!targetUid || targetUid !== expectedTargetUid) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const prevRev = rawResult.previousRevision;
  if (expectedOperation === 'InitializeRevision') {
    if (
      prevRev !== null &&
      (typeof prevRev !== 'number' || !Number.isInteger(prevRev) || prevRev < 1)
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_LIFECYCLE_RECORD',
        SAFE_ERROR_MESSAGES.internal
      );
    }
  } else {
    if (
      typeof prevRev !== 'number' ||
      !Number.isInteger(prevRev) ||
      !Number.isSafeInteger(prevRev) ||
      prevRev < 1 ||
      (expectedRevision !== undefined && prevRev !== expectedRevision)
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_LIFECYCLE_RECORD',
        SAFE_ERROR_MESSAGES.internal
      );
    }
  }

  const currRev = rawResult.currentRevision;
  if (
    typeof currRev !== 'number' ||
    !Number.isInteger(currRev) ||
    !Number.isSafeInteger(currRev) ||
    currRev < 1 ||
    (prevRev !== null && currRev !== prevRev + 1)
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const committedAt = parseStrictUtcIsoTimestamp(rawResult.committedAtIso);
  if (!committedAt) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  // Admin DTO check
  const rawAdmin = rawResult.admin;
  if (!isPlainObject(rawAdmin)) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }
  assertNoForbiddenSecretKeys(rawAdmin);

  const adminKeys = Object.keys(rawAdmin);
  if (
    adminKeys.length !== CANONICAL_LIFECYCLE_ADMIN_DTO_KEYS.size ||
    adminKeys.some((k) => !CANONICAL_LIFECYCLE_ADMIN_DTO_KEYS.has(k))
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const adminId = validateCanonicalUid(rawAdmin.id);
  if (!adminId || adminId !== expectedTargetUid) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (!isValidAdminRole(rawAdmin.role)) {
    throw new AdminIdentityClientError(
      'internal',
      'INVALID_ADMIN_ROLE',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (expectedTargetRole !== undefined && rawAdmin.role !== expectedTargetRole) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (typeof rawAdmin.isActive !== 'boolean') {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (expectedOperation === 'Deactivate' && rawAdmin.isActive !== false) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (expectedOperation === 'Reactivate' && rawAdmin.isActive !== true) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  if (rawAdmin.revision !== currRev) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  // Audit receipt check
  const rawReceipt = rawResult.auditReceipt;
  if (!isPlainObject(rawReceipt)) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }
  assertNoForbiddenSecretKeys(rawReceipt);

  const receiptKeys = Object.keys(rawReceipt);
  if (
    receiptKeys.length !== CANONICAL_LIFECYCLE_AUDIT_RECEIPT_KEYS.size ||
    receiptKeys.some((k) => !CANONICAL_LIFECYCLE_AUDIT_RECEIPT_KEYS.has(k))
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  const auditEventId = validateAuditEventId(rawReceipt.auditEventId);
  if (
    typeof rawReceipt.action !== 'string' ||
    !rawReceipt.action ||
    typeof rawReceipt.targetType !== 'string' ||
    !rawReceipt.targetType ||
    rawReceipt.targetId !== expectedTargetUid ||
    !parseStrictUtcIsoTimestamp(rawReceipt.timestamp)
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD',
      SAFE_ERROR_MESSAGES.internal
    );
  }

  return Object.freeze({
    operation: expectedOperation,
    targetUid: expectedTargetUid,
    previousRevision: prevRev,
    currentRevision: currRev,
    committedAtIso: committedAt.iso,
    admin: Object.freeze({
      id: adminId,
      role: rawAdmin.role as AdminRole,
      isActive: rawAdmin.isActive as boolean,
      revision: currRev,
    }),
    auditReceipt: Object.freeze({
      auditEventId,
      action: rawReceipt.action as string,
      targetType: rawReceipt.targetType as string,
      targetId: expectedTargetUid,
      timestamp: rawReceipt.timestamp as string,
    }),
  });
}

export async function changeAdminRole(
  input: ChangeAdminRoleClientInput,
  deps?: AdminIdentityClientDependencies
): Promise<AdminLifecycleClientResponse> {
  const effectiveDeps = resolveEffectiveDependencies(deps);

  try {
    requireAuthenticatedFirebaseSession(effectiveDeps);

    if (!isPlainObject(input)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    assertNoLifecycleAuthorityOrPollution(
      input as Record<string, unknown>,
      LIFECYCLE_CHANGE_ROLE_ALLOWED_KEYS
    );

    const rawTargetUid = input.targetUid;
    const targetUid = validateCanonicalUid(rawTargetUid);
    if (!targetUid || (typeof rawTargetUid === 'string' && rawTargetUid !== targetUid)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        'targetUid must be a non-empty trimmed string.'
      );
    }

    const expectedRevision = validateRequiredExpectedRevision(input.expectedRevision);

    if (!isValidAdminRole(input.targetRole)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ADMIN_ROLE',
        'Invalid or non-canonical targetRole.'
      );
    }

    if (input.targetRole === AdminRole.Owner) {
      throw new AdminIdentityClientError(
        'permission-denied',
        'OWNER_PROMOTION_FORBIDDEN',
        'Promotion to Owner is forbidden; no Owner promotion policy is established.'
      );
    }

    const payload: ManageAdminLifecycleClientPayload = {
      operation: 'ChangeRole',
      targetUid,
      expectedRevision,
      targetRole: input.targetRole,
    };

    const rawResponse = await invokeManageAdminLifecycleCallable(payload, effectiveDeps);
    return validateSanitizedAdminLifecycleResponse(
      rawResponse,
      'ChangeRole',
      targetUid,
      expectedRevision,
      input.targetRole
    );
  } catch (error: unknown) {
    throw mapCallableBoundaryError(error);
  }
}

export async function deactivateAdmin(
  input: DeactivateAdminClientInput,
  deps?: AdminIdentityClientDependencies
): Promise<AdminLifecycleClientResponse> {
  const effectiveDeps = resolveEffectiveDependencies(deps);

  try {
    requireAuthenticatedFirebaseSession(effectiveDeps);

    if (!isPlainObject(input)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    assertNoLifecycleAuthorityOrPollution(
      input as Record<string, unknown>,
      LIFECYCLE_DEACTIVATE_ALLOWED_KEYS
    );

    const rawTargetUid = input.targetUid;
    const targetUid = validateCanonicalUid(rawTargetUid);
    if (!targetUid || (typeof rawTargetUid === 'string' && rawTargetUid !== targetUid)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        'targetUid must be a non-empty trimmed string.'
      );
    }

    const expectedRevision = validateRequiredExpectedRevision(input.expectedRevision);

    const payload: ManageAdminLifecycleClientPayload = {
      operation: 'Deactivate',
      targetUid,
      expectedRevision,
    };

    const rawResponse = await invokeManageAdminLifecycleCallable(payload, effectiveDeps);
    return validateSanitizedAdminLifecycleResponse(rawResponse, 'Deactivate', targetUid, expectedRevision);
  } catch (error: unknown) {
    throw mapCallableBoundaryError(error);
  }
}

export async function reactivateAdmin(
  input: ReactivateAdminClientInput,
  deps?: AdminIdentityClientDependencies
): Promise<AdminLifecycleClientResponse> {
  const effectiveDeps = resolveEffectiveDependencies(deps);

  try {
    requireAuthenticatedFirebaseSession(effectiveDeps);

    if (!isPlainObject(input)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    assertNoLifecycleAuthorityOrPollution(
      input as Record<string, unknown>,
      LIFECYCLE_REACTIVATE_ALLOWED_KEYS
    );

    const rawTargetUid = input.targetUid;
    const targetUid = validateCanonicalUid(rawTargetUid);
    if (!targetUid || (typeof rawTargetUid === 'string' && rawTargetUid !== targetUid)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        'targetUid must be a non-empty trimmed string.'
      );
    }

    const expectedRevision = validateRequiredExpectedRevision(input.expectedRevision);

    const payload: ManageAdminLifecycleClientPayload = {
      operation: 'Reactivate',
      targetUid,
      expectedRevision,
    };

    const rawResponse = await invokeManageAdminLifecycleCallable(payload, effectiveDeps);
    return validateSanitizedAdminLifecycleResponse(rawResponse, 'Reactivate', targetUid, expectedRevision);
  } catch (error: unknown) {
    throw mapCallableBoundaryError(error);
  }
}

export async function initializeAdminRevision(
  input: InitializeAdminRevisionClientInput,
  deps?: AdminIdentityClientDependencies
): Promise<AdminLifecycleClientResponse> {
  const effectiveDeps = resolveEffectiveDependencies(deps);

  try {
    requireAuthenticatedFirebaseSession(effectiveDeps);

    if (!isPlainObject(input)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        SAFE_ERROR_MESSAGES['invalid-argument']
      );
    }

    assertNoLifecycleAuthorityOrPollution(
      input as Record<string, unknown>,
      LIFECYCLE_INITIALIZE_REVISION_ALLOWED_KEYS
    );

    const rawTargetUid = input.targetUid;
    const targetUid = validateCanonicalUid(rawTargetUid);
    if (!targetUid || (typeof rawTargetUid === 'string' && rawTargetUid !== targetUid)) {
      throw new AdminIdentityClientError(
        'invalid-argument',
        'INVALID_ARGUMENT',
        'targetUid must be a non-empty trimmed string.'
      );
    }

    const payload: ManageAdminLifecycleClientPayload = {
      operation: 'InitializeRevision',
      targetUid,
    };

    const rawResponse = await invokeManageAdminLifecycleCallable(payload, effectiveDeps);
    return validateSanitizedAdminLifecycleResponse(rawResponse, 'InitializeRevision', targetUid);
  } catch (error: unknown) {
    throw mapCallableBoundaryError(error);
  }
}

export async function manageAdminLifecycle(
  payload: ManageAdminLifecycleClientPayload,
  deps?: AdminIdentityClientDependencies
): Promise<AdminLifecycleClientResponse> {
  switch (payload.operation) {
    case 'ChangeRole':
      return changeAdminRole(
        {
          targetUid: payload.targetUid,
          expectedRevision: payload.expectedRevision,
          targetRole: payload.targetRole,
        },
        deps
      );
    case 'Deactivate':
      return deactivateAdmin(
        {
          targetUid: payload.targetUid,
          expectedRevision: payload.expectedRevision,
        },
        deps
      );
    case 'Reactivate':
      return reactivateAdmin(
        {
          targetUid: payload.targetUid,
          expectedRevision: payload.expectedRevision,
        },
        deps
      );
    case 'InitializeRevision':
      return initializeAdminRevision(
        {
          targetUid: payload.targetUid,
        },
        deps
      );
  }
}

export class AdminIdentityManagementClient {
  private readonly deps: AdminIdentityClientDependencies;

  constructor(deps: AdminIdentityClientDependencies = {}) {
    this.deps = deps;
  }

  public static setRuntimeOverrides(
    overrides: AdminIdentityClientDependencies | null
  ): void {
    runtimeOverrides = overrides;
  }

  public static resetRuntimeOverrides(): void {
    runtimeOverrides = null;
  }

  public static isSessionAuthenticated(
    deps?: AdminIdentityClientDependencies
  ): boolean {
    const effectiveDeps = resolveEffectiveDependencies(deps);
    try {
      requireAuthenticatedFirebaseSession(effectiveDeps);
      return true;
    } catch {
      return false;
    }
  }

  public static async listAdminUsers(
    deps?: AdminIdentityClientDependencies
  ): Promise<ListAdminUsersClientResponse> {
    return listAdminUsers(deps);
  }

  public static async createInvitation(
    input: CreateAdminInvitationClientInput,
    deps?: AdminIdentityClientDependencies
  ): Promise<CreateAdminInvitationClientResponse> {
    return createAdminInvitation(input, deps);
  }

  public static async revokeInvitation(
    input: RevokeAdminInvitationClientInput,
    deps?: AdminIdentityClientDependencies
  ): Promise<RevokeAdminInvitationClientResponse> {
    return revokeAdminInvitation(input, deps);
  }

  public static async acceptInvitation(
    input: AcceptAdminInvitationClientInput,
    deps?: AdminIdentityClientDependencies
  ): Promise<AcceptAdminInvitationClientResponse> {
    return acceptAdminInvitation(input, deps);
  }

  public static async changeRole(
    input: ChangeAdminRoleClientInput,
    deps?: AdminIdentityClientDependencies
  ): Promise<AdminLifecycleClientResponse> {
    return changeAdminRole(input, deps);
  }

  public static async deactivate(
    input: DeactivateAdminClientInput,
    deps?: AdminIdentityClientDependencies
  ): Promise<AdminLifecycleClientResponse> {
    return deactivateAdmin(input, deps);
  }

  public static async reactivate(
    input: ReactivateAdminClientInput,
    deps?: AdminIdentityClientDependencies
  ): Promise<AdminLifecycleClientResponse> {
    return reactivateAdmin(input, deps);
  }

  public static async initializeRevision(
    input: InitializeAdminRevisionClientInput,
    deps?: AdminIdentityClientDependencies
  ): Promise<AdminLifecycleClientResponse> {
    return initializeAdminRevision(input, deps);
  }

  public static async manageLifecycle(
    payload: ManageAdminLifecycleClientPayload,
    deps?: AdminIdentityClientDependencies
  ): Promise<AdminLifecycleClientResponse> {
    return manageAdminLifecycle(payload, deps);
  }

  public async listAdminUsers(): Promise<ListAdminUsersClientResponse> {
    return listAdminUsers(this.deps);
  }

  public async createInvitation(
    input: CreateAdminInvitationClientInput
  ): Promise<CreateAdminInvitationClientResponse> {
    return createAdminInvitation(input, this.deps);
  }

  public async revokeInvitation(
    input: RevokeAdminInvitationClientInput
  ): Promise<RevokeAdminInvitationClientResponse> {
    return revokeAdminInvitation(input, this.deps);
  }

  public async acceptInvitation(
    input: AcceptAdminInvitationClientInput
  ): Promise<AcceptAdminInvitationClientResponse> {
    return acceptAdminInvitation(input, this.deps);
  }

  public async changeRole(
    input: ChangeAdminRoleClientInput
  ): Promise<AdminLifecycleClientResponse> {
    return changeAdminRole(input, this.deps);
  }

  public async deactivate(
    input: DeactivateAdminClientInput
  ): Promise<AdminLifecycleClientResponse> {
    return deactivateAdmin(input, this.deps);
  }

  public async reactivate(
    input: ReactivateAdminClientInput
  ): Promise<AdminLifecycleClientResponse> {
    return reactivateAdmin(input, this.deps);
  }

  public async initializeRevision(
    input: InitializeAdminRevisionClientInput
  ): Promise<AdminLifecycleClientResponse> {
    return initializeAdminRevision(input, this.deps);
  }

  public async manageLifecycle(
    payload: ManageAdminLifecycleClientPayload
  ): Promise<AdminLifecycleClientResponse> {
    return manageAdminLifecycle(payload, this.deps);
  }
}

export type { AdminUser };
export { AdminRole, isValidAdminRole };
