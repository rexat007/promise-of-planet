import { AdminAuthorizationService } from './adminAuthorizationService';
import {
  AdminPermission,
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

export type AdminInvitationErrorCode =
  | 'UNAUTHENTICATED_CALLER'
  | 'UNAUTHORIZED_INVITER'
  | 'INACTIVE_INVITER'
  | 'IDENTITY_MISMATCH'
  | 'INVALID_INVITATION_ID'
  | 'INVALID_TARGET_EMAIL'
  | 'INVALID_TARGET_UID'
  | 'INVALID_INTENDED_ROLE'
  | 'OWNER_ROLE_ASSIGNMENT_REQUIRES_EXPLICIT_AUTHORIZATION'
  | 'EXISTING_ADMIN_CONFLICT'
  | 'INVALID_TIMESTAMPS'
  | 'INVALID_INVITATION_RECORD'
  | 'FORBIDDEN_SECRET_FIELD_DETECTED'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_REVOKED'
  | 'INVITATION_ALREADY_ACCEPTED'
  | 'INVALID_STATE_TRANSITION'
  | 'UNVERIFIED_TARGET_EMAIL'
  | 'EMAIL_MISMATCH'
  | 'CONCURRENT_MODIFICATION_CONFLICT';

export class AdminInvitationContractError extends Error {
  public readonly code: AdminInvitationErrorCode;

  constructor(code: AdminInvitationErrorCode, message: string) {
    super(message);
    this.name = 'AdminInvitationContractError';
    this.code = code;
  }
}

export type InvitationClock = () => Date;

export const systemInvitationClock: InvitationClock = () => new Date();

export interface AdminInvitationRecord {
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

export interface ExplicitOwnerRoleGrantAuthorization {
  readonly confirmedOwnerRoleGrant: true;
  readonly authorizingOwnerUid: string;
}

export interface CreateAdminInvitationIntentInput {
  readonly invitationId: string;
  readonly authenticatedCallerUid: string;
  readonly resolvedCallerAdmin: AdminUser | null | undefined;
  readonly targetEmail: string;
  readonly targetUid?: string | null;
  readonly intendedRole: AdminRole;
  readonly ttlMs?: number;
  readonly existingTargetAdmin?: AdminUser | null;
  readonly explicitOwnerRoleGrant?: ExplicitOwnerRoleGrantAuthorization;
}

export interface ServerVerifiedAcceptanceIdentity {
  readonly authenticatedUid: string;
  readonly verifiedEmail: string;
  readonly emailVerified: boolean;
  readonly boundInvitationId: string;
  readonly payloadClaimedUid?: string;
  readonly payloadClaimedRole?: unknown;
}

export interface AcceptAdminInvitationInput {
  readonly invitation: AdminInvitationRecord;
  readonly acceptorIdentity: ServerVerifiedAcceptanceIdentity;
  readonly existingTargetAdmin?: AdminUser | null;
  readonly expectedRevision?: number;
}

export interface RevokeAdminInvitationInput {
  readonly invitation: AdminInvitationRecord;
  readonly authenticatedCallerUid: string;
  readonly resolvedCallerAdmin: AdminUser | null | undefined;
  readonly expectedRevision?: number;
}

export interface ExpireAdminInvitationInput {
  readonly invitation: AdminInvitationRecord;
  readonly expectedRevision?: number;
}

const CANONICAL_INVITATION_KEYS = new Set<string>([
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

const FORBIDDEN_SECRET_FIELD_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /oobcode/i,
  /credential/i,
  /privatekey/i,
  /apikey/i,
];

const INVITATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidAdminInvitationStatus(
  status: unknown
): status is AdminInvitationStatus {
  if (typeof status !== 'string') {
    return false;
  }
  return Object.values(AdminInvitationStatus).includes(
    status as AdminInvitationStatus
  );
}

export function normalizeAndValidateTargetEmail(rawEmail: unknown): string {
  if (typeof rawEmail !== 'string') {
    throw new AdminInvitationContractError(
      'INVALID_TARGET_EMAIL',
      'Target email must be a string.'
    );
  }

  const normalized = rawEmail.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 254 ||
    !EMAIL_PATTERN.test(normalized) ||
    normalized.includes('..')
  ) {
    throw new AdminInvitationContractError(
      'INVALID_TARGET_EMAIL',
      `Invalid target email address (${rawEmail}).`
    );
  }

  return normalized;
}

export function validateInvitationId(rawId: unknown): string {
  if (typeof rawId !== 'string') {
    throw new AdminInvitationContractError(
      'INVALID_INVITATION_ID',
      'Invitation ID must be a string.'
    );
  }

  const trimmed = rawId.trim();
  if (!INVITATION_ID_PATTERN.test(trimmed)) {
    throw new AdminInvitationContractError(
      'INVALID_INVITATION_ID',
      'Invitation ID must be 8-128 characters of alphanumeric, underscore, or hyphen characters.'
    );
  }

  return trimmed;
}

function parseStrictIsoTimestamp(
  value: unknown,
  fieldName: string
): { readonly iso: string; readonly epochMs: number } {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AdminInvitationContractError(
      'INVALID_TIMESTAMPS',
      `${fieldName} must be a non-empty ISO-8601 timestamp string.`
    );
  }

  const trimmed = value.trim();
  const epochMs = Date.parse(trimmed);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== trimmed) {
    throw new AdminInvitationContractError(
      'INVALID_TIMESTAMPS',
      `${fieldName} (${value}) is not a canonical UTC ISO-8601 timestamp.`
    );
  }

  return { iso: trimmed, epochMs };
}

function resolveClockIso(clock: InvitationClock): {
  readonly iso: string;
  readonly epochMs: number;
} {
  const date = clock();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new AdminInvitationContractError(
      'INVALID_TIMESTAMPS',
      'Injected clock returned an invalid Date instance.'
    );
  }
  const epochMs = date.getTime();
  return { iso: new Date(epochMs).toISOString(), epochMs };
}

export function validateOwnerInvitationAuthority(
  authenticatedCallerUid: unknown,
  resolvedCallerAdmin: AdminUser | null | undefined
): AdminUser {
  const callerUid =
    typeof authenticatedCallerUid === 'string'
      ? authenticatedCallerUid.trim()
      : '';

  if (!callerUid) {
    throw new AdminInvitationContractError(
      'UNAUTHENTICATED_CALLER',
      'An authenticated Firebase UID is required.'
    );
  }

  if (!resolvedCallerAdmin || typeof resolvedCallerAdmin !== 'object') {
    throw new AdminInvitationContractError(
      'UNAUTHORIZED_INVITER',
      'Caller does not hold a canonical administrative identity in admins/{uid}.'
    );
  }

  const adminId =
    typeof resolvedCallerAdmin.id === 'string'
      ? resolvedCallerAdmin.id.trim()
      : '';
  if (!adminId || adminId !== callerUid) {
    throw new AdminInvitationContractError(
      'IDENTITY_MISMATCH',
      'Resolved administrative record UID does not match authenticated caller UID.'
    );
  }

  if (!isValidAdminRole(resolvedCallerAdmin.role)) {
    throw new AdminInvitationContractError(
      'UNAUTHORIZED_INVITER',
      'Caller administrative role is invalid or non-canonical.'
    );
  }

  if (
    typeof resolvedCallerAdmin.isActive !== 'boolean' ||
    resolvedCallerAdmin.isActive !== true
  ) {
    throw new AdminInvitationContractError(
      'INACTIVE_INVITER',
      'Inactive administrative accounts cannot create or manage invitations.'
    );
  }

  if (
    resolvedCallerAdmin.role !== AdminRole.Owner ||
    !AdminAuthorizationService.hasPermission(
      resolvedCallerAdmin,
      AdminPermission.ManageUsers
    )
  ) {
    throw new AdminInvitationContractError(
      'UNAUTHORIZED_INVITER',
      'Only an active canonical Owner with ManageUsers permission is authorized.'
    );
  }

  return resolvedCallerAdmin;
}

export function validatePersistedAdminInvitationRecord(
  raw: unknown
): AdminInvitationRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AdminInvitationContractError(
      'INVALID_INVITATION_RECORD',
      'Invitation record must be a non-null object.'
    );
  }

  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (
      FORBIDDEN_SECRET_FIELD_PATTERNS.some((pattern) => pattern.test(key))
    ) {
      throw new AdminInvitationContractError(
        'FORBIDDEN_SECRET_FIELD_DETECTED',
        `Forbidden secret, token, or password field '${key}' is not permitted in invitation records.`
      );
    }
    if (!CANONICAL_INVITATION_KEYS.has(key)) {
      throw new AdminInvitationContractError(
        'INVALID_INVITATION_RECORD',
        `Unexpected non-canonical property '${key}' found in invitation record.`
      );
    }
  }

  const invitationId = validateInvitationId(obj.invitationId);
  const normalizedTargetEmail = normalizeAndValidateTargetEmail(
    obj.normalizedTargetEmail
  );

  if (obj. normalizedTargetEmail !== normalizedTargetEmail) {
    throw new AdminInvitationContractError(
      'INVALID_TARGET_EMAIL',
      'Persisted normalizedTargetEmail must be lowercase and trimmed.'
    );
  }

  let targetUid: string | null = null;
  if (obj.targetUid !== null && obj.targetUid !== undefined) {
    if (typeof obj.targetUid !== 'string' || obj.targetUid.trim() === '') {
      throw new AdminInvitationContractError(
        'INVALID_TARGET_UID',
        'targetUid must be null or a non-empty trimmed Firebase UID.'
      );
    }
    targetUid = obj.targetUid.trim();
  }

  if (!isValidAdminRole(obj.intendedRole)) {
    throw new AdminInvitationContractError(
      'INVALID_INTENDED_ROLE',
      `Invalid or non-canonical intendedRole (${String(obj.intendedRole)}).`
    );
  }

  const invitingOwnerUid =
    typeof obj.invitingOwnerUid === 'string' ? obj.invitingOwnerUid.trim() : '';
  if (!invitingOwnerUid) {
    throw new AdminInvitationContractError(
      'INVALID_INVITATION_RECORD',
      'invitingOwnerUid must be a non-empty string.'
    );
  }

  const created = parseStrictIsoTimestamp(obj.createdAtIso, 'createdAtIso');
  const expires = parseStrictIsoTimestamp(obj.expiresAtIso, 'expiresAtIso');

  if (expires.epochMs <= created.epochMs) {
    throw new AdminInvitationContractError(
      'INVALID_TIMESTAMPS',
      'expiresAtIso must be strictly after createdAtIso.'
    );
  }

  if (!isValidAdminInvitationStatus(obj.status)) {
    throw new AdminInvitationContractError(
      'INVALID_INVITATION_RECORD',
      `Invalid invitation status (${String(obj.status)}).`
    );
  }

  const revision = obj.revision;
  if (
    typeof revision !== 'number' ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    throw new AdminInvitationContractError(
      'INVALID_INVITATION_RECORD',
      'revision must be a positive integer >= 1.'
    );
  }

  const status = obj.status;
  let acceptedAtIso: string | null = null;
  let acceptedByUid: string | null = null;
  let revokedAtIso: string | null = null;
  let revokedByOwnerUid: string | null = null;
  let expiredAtIso: string | null = null;

  if (status === AdminInvitationStatus.Pending) {
    if (
      obj.acceptedAtIso !== null ||
      obj.acceptedByUid !== null ||
      obj.revokedAtIso !== null ||
      obj.revokedByOwnerUid !== null ||
      obj.expiredAtIso !== null
    ) {
      throw new AdminInvitationContractError(
        'INVALID_INVITATION_RECORD',
        'Pending invitation must have null transition timestamps and actors.'
      );
    }
  } else if (status === AdminInvitationStatus.Accepted) {
    const acceptedAt = parseStrictIsoTimestamp(
      obj.acceptedAtIso,
      'acceptedAtIso'
    );
    if (
      acceptedAt.epochMs < created.epochMs ||
      acceptedAt.epochMs >= expires.epochMs
    ) {
      throw new AdminInvitationContractError(
        'INVALID_TIMESTAMPS',
        'acceptedAtIso must be >= createdAtIso and < expiresAtIso.'
      );
    }
    const rawAcceptedBy =
      typeof obj.acceptedByUid === 'string' ? obj.acceptedByUid.trim() : '';
    if (!rawAcceptedBy || !targetUid || rawAcceptedBy !== targetUid) {
      throw new AdminInvitationContractError(
        'INVALID_INVITATION_RECORD',
        'Accepted invitation must have non-empty matching targetUid and acceptedByUid.'
      );
    }
    if (
      obj.revokedAtIso !== null ||
      obj.revokedByOwnerUid !== null ||
      obj.expiredAtIso !== null
    ) {
      throw new AdminInvitationContractError(
        'INVALID_INVITATION_RECORD',
        'Accepted invitation cannot have revoked or expired transition metadata.'
      );
    }
    acceptedAtIso = acceptedAt.iso;
    acceptedByUid = rawAcceptedBy;
  } else if (status === AdminInvitationStatus.Revoked) {
    const revokedAt = parseStrictIsoTimestamp(obj.revokedAtIso, 'revokedAtIso');
    if (revokedAt.epochMs < created.epochMs) {
      throw new AdminInvitationContractError(
        'INVALID_TIMESTAMPS',
        'revokedAtIso cannot precede createdAtIso.'
      );
    }
    const rawRevokedBy =
      typeof obj.revokedByOwnerUid === 'string'
        ? obj.revokedByOwnerUid.trim()
        : '';
    if (!rawRevokedBy) {
      throw new AdminInvitationContractError(
        'INVALID_INVITATION_RECORD',
        'Revoked invitation must record revokedByOwnerUid.'
      );
    }
    if (
      obj.acceptedAtIso !== null ||
      obj.acceptedByUid !== null ||
      obj.expiredAtIso !== null
    ) {
      throw new AdminInvitationContractError(
        'INVALID_INVITATION_RECORD',
        'Revoked invitation cannot have accepted or expired transition metadata.'
      );
    }
    revokedAtIso = revokedAt.iso;
    revokedByOwnerUid = rawRevokedBy;
  } else if (status === AdminInvitationStatus.Expired) {
    const expiredAt = parseStrictIsoTimestamp(obj.expiredAtIso, 'expiredAtIso');
    if (expiredAt.epochMs < expires.epochMs) {
      throw new AdminInvitationContractError(
        'INVALID_TIMESTAMPS',
        'expiredAtIso must be >= expiresAtIso.'
      );
    }
    if (
      obj.acceptedAtIso !== null ||
      obj.acceptedByUid !== null ||
      obj.revokedAtIso !== null ||
      obj.revokedByOwnerUid !== null
    ) {
      throw new AdminInvitationContractError(
        'INVALID_INVITATION_RECORD',
        'Expired invitation cannot have accepted or revoked transition metadata.'
      );
    }
    expiredAtIso = expiredAt.iso;
  }

  return {
    invitationId,
    targetUid,
    normalizedTargetEmail,
    intendedRole: obj.intendedRole,
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
  };
}

export function createAdminInvitationIntent(
  input: CreateAdminInvitationIntentInput,
  clock: InvitationClock = systemInvitationClock
): AdminInvitationRecord {
  const inviter = validateOwnerInvitationAuthority(
    input.authenticatedCallerUid,
    input.resolvedCallerAdmin
  );

  const invitationId = validateInvitationId(input.invitationId);
  const normalizedTargetEmail = normalizeAndValidateTargetEmail(
    input.targetEmail
  );

  if (!isValidAdminRole(input.intendedRole)) {
    throw new AdminInvitationContractError(
      'INVALID_INTENDED_ROLE',
      `Invalid or non-canonical AdminRole (${String(input.intendedRole)}).`
    );
  }

  let targetUid: string | null = null;
  if (input.targetUid !== undefined && input.targetUid !== null) {
    if (typeof input.targetUid !== 'string' || input.targetUid.trim() === '') {
      throw new AdminInvitationContractError(
        'INVALID_TARGET_UID',
        'targetUid must be null or a non-empty Firebase Auth UID.'
      );
    }
    targetUid = input.targetUid.trim();
  }

  if (targetUid === inviter.id || normalizedTargetEmail === inviter.email.trim().toLowerCase()) {
    throw new AdminInvitationContractError(
      'EXISTING_ADMIN_CONFLICT',
      'Inviter cannot issue an administrative invitation to their own existing Owner identity.'
    );
  }

  if (input.existingTargetAdmin) {
    throw new AdminInvitationContractError(
      'EXISTING_ADMIN_CONFLICT',
      `Target identity already holds an administrative record (${input.existingTargetAdmin.id}) with role '${input.existingTargetAdmin.role}'. Invitations cannot silently overwrite existing admin roles.`
    );
  }

  if (input.intendedRole === AdminRole.Owner) {
    const grant = input.explicitOwnerRoleGrant;
    if (
      !grant ||
      grant.confirmedOwnerRoleGrant !== true ||
      typeof grant.authorizingOwnerUid !== 'string' ||
      grant.authorizingOwnerUid.trim() !== inviter.id
    ) {
      throw new AdminInvitationContractError(
        'OWNER_ROLE_ASSIGNMENT_REQUIRES_EXPLICIT_AUTHORIZATION',
        'Assigning the Owner role via invitation requires separate explicit Owner role grant confirmation.'
      );
    }
  }

  const ttlMs = input.ttlMs ?? DEFAULT_ADMIN_INVITATION_TTL_MS;
  if (
    typeof ttlMs !== 'number' ||
    !Number.isInteger(ttlMs) ||
    ttlMs < MIN_ADMIN_INVITATION_TTL_MS ||
    ttlMs > MAX_ADMIN_INVITATION_TTL_MS
  ) {
    throw new AdminInvitationContractError(
      'INVALID_TIMESTAMPS',
      `Invalid invitation TTL (${String(ttlMs)}). Must be an integer between ${MIN_ADMIN_INVITATION_TTL_MS}ms and ${MAX_ADMIN_INVITATION_TTL_MS}ms.`
    );
  }

  const now = resolveClockIso(clock);
  const expiresAtIso = new Date(now.epochMs + ttlMs).toISOString();

  const record: AdminInvitationRecord = {
    invitationId,
    targetUid,
    normalizedTargetEmail,
    intendedRole: input.intendedRole,
    invitingOwnerUid: inviter.id,
    createdAtIso: now.iso,
    expiresAtIso,
    status: AdminInvitationStatus.Pending,
    acceptedAtIso: null,
    acceptedByUid: null,
    revokedAtIso: null,
    revokedByOwnerUid: null,
    expiredAtIso: null,
    revision: 1,
  };

  return validatePersistedAdminInvitationRecord(record);
}

export function transitionInvitationToAccepted(
  input: AcceptAdminInvitationInput,
  clock: InvitationClock = systemInvitationClock
): AdminInvitationRecord {
  const current = validatePersistedAdminInvitationRecord(input.invitation);
  const now = resolveClockIso(clock);

  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== current.revision
  ) {
    throw new AdminInvitationContractError(
      'CONCURRENT_MODIFICATION_CONFLICT',
      `Expected invitation revision ${input.expectedRevision}, but found ${current.revision}.`
    );
  }

  const identity = input.acceptorIdentity;
  if (!identity || typeof identity !== 'object') {
    throw new AdminInvitationContractError(
      'UNAUTHENTICATED_CALLER',
      'Authenticated server-verified acceptor identity is required.'
    );
  }

  const authenticatedUid =
    typeof identity.authenticatedUid === 'string'
      ? identity.authenticatedUid.trim()
      : '';
  if (!authenticatedUid) {
    throw new AdminInvitationContractError(
      'UNAUTHENTICATED_CALLER',
      'Acceptor must have a non-empty authenticated Firebase UID.'
    );
  }

  if (
    identity.payloadClaimedUid !== undefined &&
    identity.payloadClaimedUid.trim() !== authenticatedUid
  ) {
    throw new AdminInvitationContractError(
      'IDENTITY_MISMATCH',
      'Client payload UID does not match authenticated Firebase UID.'
    );
  }

  if (
    identity.payloadClaimedRole !== undefined &&
    identity.payloadClaimedRole !== current.intendedRole
  ) {
    throw new AdminInvitationContractError(
      'IDENTITY_MISMATCH',
      'Client payload attempted to forge or override the invitation intendedRole.'
    );
  }

  if (
    typeof identity.boundInvitationId !== 'string' ||
    identity.boundInvitationId.trim() !== current.invitationId
  ) {
    throw new AdminInvitationContractError(
      'IDENTITY_MISMATCH',
      'Server-verified acceptance binding does not match target invitationId.'
    );
  }

  if (current.status === AdminInvitationStatus.Accepted) {
    throw new AdminInvitationContractError(
      'INVITATION_ALREADY_ACCEPTED',
      `Invitation (${current.invitationId}) has already been accepted and is single-use.`
    );
  }

  if (current.status === AdminInvitationStatus.Revoked) {
    throw new AdminInvitationContractError(
      'INVITATION_REVOKED',
      `Invitation (${current.invitationId}) has been revoked and cannot be accepted.`
    );
  }

  if (current.status === AdminInvitationStatus.Expired) {
    throw new AdminInvitationContractError(
      'INVITATION_EXPIRED',
      `Invitation (${current.invitationId}) is already in Expired status.`
    );
  }

  const expiresEpochMs = Date.parse(current.expiresAtIso);
  if (now.epochMs >= expiresEpochMs) {
    throw new AdminInvitationContractError(
      'INVITATION_EXPIRED',
      `Invitation (${current.invitationId}) expired at ${current.expiresAtIso}.`
    );
  }

  if (identity.emailVerified !== true) {
    throw new AdminInvitationContractError(
      'UNVERIFIED_TARGET_EMAIL',
      'Acceptor Firebase Auth email must be verified before accepting an administrative invitation.'
    );
  }

  const normalizedAcceptorEmail = normalizeAndValidateTargetEmail(
    identity.verifiedEmail
  );
  if (normalizedAcceptorEmail !== current.normalizedTargetEmail) {
    throw new AdminInvitationContractError(
      'EMAIL_MISMATCH',
      'Authenticated user verified email does not match invitation target email.'
    );
  }

  if (current.targetUid !== null && current.targetUid !== authenticatedUid) {
    throw new AdminInvitationContractError(
      'IDENTITY_MISMATCH',
      `Invitation (${current.invitationId}) is bound to UID (${current.targetUid}) and cannot be accepted by UID (${authenticatedUid}).`
    );
  }

  if (input.existingTargetAdmin) {
    throw new AdminInvitationContractError(
      'EXISTING_ADMIN_CONFLICT',
      `Authenticated user (${authenticatedUid}) already has an administrative record with role '${input.existingTargetAdmin.role}'.`
    );
  }

  const updated: AdminInvitationRecord = {
    ...current,
    targetUid: authenticatedUid,
    status: AdminInvitationStatus.Accepted,
    acceptedAtIso: now.iso,
    acceptedByUid: authenticatedUid,
    revision: current.revision + 1,
  };

  return validatePersistedAdminInvitationRecord(updated);
}

export function transitionInvitationToRevoked(
  input: RevokeAdminInvitationInput,
  clock: InvitationClock = systemInvitationClock
): AdminInvitationRecord {
  const current = validatePersistedAdminInvitationRecord(input.invitation);
  const revokingOwner = validateOwnerInvitationAuthority(
    input.authenticatedCallerUid,
    input.resolvedCallerAdmin
  );
  const now = resolveClockIso(clock);

  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== current.revision
  ) {
    throw new AdminInvitationContractError(
      'CONCURRENT_MODIFICATION_CONFLICT',
      `Expected invitation revision ${input.expectedRevision}, but found ${current.revision}.`
    );
  }

  if (current.status !== AdminInvitationStatus.Pending) {
    throw new AdminInvitationContractError(
      'INVALID_STATE_TRANSITION',
      `Cannot revoke invitation (${current.invitationId}) from terminal status '${current.status}'.`
    );
  }

  if (now.epochMs < Date.parse(current.createdAtIso)) {
    throw new AdminInvitationContractError(
      'INVALID_TIMESTAMPS',
      'Revocation timestamp cannot precede invitation creation timestamp.'
    );
  }

  const updated: AdminInvitationRecord = {
    ...current,
    status: AdminInvitationStatus.Revoked,
    revokedAtIso: now.iso,
    revokedByOwnerUid: revokingOwner.id,
    revision: current.revision + 1,
  };

  return validatePersistedAdminInvitationRecord(updated);
}

export function transitionInvitationToExpired(
  input: ExpireAdminInvitationInput,
  clock: InvitationClock = systemInvitationClock
): AdminInvitationRecord {
  const current = validatePersistedAdminInvitationRecord(input.invitation);
  const now = resolveClockIso(clock);

  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== current.revision
  ) {
    throw new AdminInvitationContractError(
      'CONCURRENT_MODIFICATION_CONFLICT',
      `Expected invitation revision ${input.expectedRevision}, but found ${current.revision}.`
    );
  }

  if (current.status !== AdminInvitationStatus.Pending) {
    throw new AdminInvitationContractError(
      'INVALID_STATE_TRANSITION',
      `Cannot transition invitation (${current.invitationId}) to Expired from terminal status '${current.status}'.`
    );
  }

  if (now.epochMs < Date.parse(current.expiresAtIso)) {
    throw new AdminInvitationContractError(
      'INVALID_STATE_TRANSITION',
      `Cannot mark invitation (${current.invitationId}) as Expired before its expiresAtIso (${current.expiresAtIso}).`
    );
  }

  const updated: AdminInvitationRecord = {
    ...current,
    status: AdminInvitationStatus.Expired,
    expiredAtIso: now.iso,
    revision: current.revision + 1,
  };

  return validatePersistedAdminInvitationRecord(updated);
}
