import {
  AdminInvitationContractError,
  AdminInvitationStatus,
  validateInvitationId,
  validatePersistedAdminInvitationRecord,
  type AdminInvitationErrorCode,
  type AdminInvitationRecord,
  type ExplicitOwnerRoleGrantAuthorization,
  type InvitationClock,
} from './adminInvitationContract';
import type { AdminRole, AdminUser } from '../types/admin';
import {
  AuditAction,
  AuditTargetType,
  type AuditChange,
  type AuditEvent,
} from '../shared/auditContract';

export const ADMIN_INVITATIONS_COLLECTION = 'admin_invitations' as const;
export const ADMINS_COLLECTION = 'admins' as const;
export const ADMIN_AUDIT_LOGS_COLLECTION = 'audit_logs' as const;

export type AdminInvitationAuditEventType =
  | 'InvitationCreated'
  | 'InvitationRevoked'
  | 'InvitationAccepted';

export interface AdminInvitationAuditEvent extends AuditEvent {
  readonly eventType: AdminInvitationAuditEventType;
  readonly invitationId: string;
  readonly targetUid: string | null;
  readonly normalizedTargetEmail: string;
  readonly intendedRole: AdminRole;
  readonly invitingOwnerUid: string;
  readonly invitationRevision: number;
}

export type AdminInvitationPersistenceErrorCode =
  | AdminInvitationErrorCode
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_ALREADY_EXISTS'
  | 'OWNER_ACTIVATION_FORBIDDEN'
  | 'UNTRUSTED_ID_GENERATOR'
  | 'TRANSACTION_ABORTED'
  | 'PERSISTENCE_FAILURE';

export class AdminInvitationPersistenceError extends Error {
  public readonly code: AdminInvitationPersistenceErrorCode;

  constructor(code: AdminInvitationPersistenceErrorCode, message: string) {
    super(message);
    this.name = 'AdminInvitationPersistenceError';
    this.code = code;
  }
}

export type CryptographicIdGenerator = () => string;

function generateCsprngHex(byteLength: number): string {
  const cryptoObj = (
    globalThis as unknown as {
      crypto?: { getRandomValues?: (buf: Uint8Array) => Uint8Array };
    }
  ).crypto;

  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new AdminInvitationPersistenceError(
      'UNTRUSTED_ID_GENERATOR',
      'Cryptographically secure random number generator (globalThis.crypto.getRandomValues) is unavailable.'
    );
  }

  const bytes = new Uint8Array(byteLength);
  cryptoObj.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Generates a cryptographically random record locator ID using the runtime CSPRNG.
 * Invitation IDs are record locators in admin_invitations/{invitationId},
 * never authentication tokens or secrets.
 */
export function generateCryptographicInvitationId(): string {
  return `inv_${generateCsprngHex(16)}`;
}

export function generateCryptographicAuditEventId(): string {
  return `aud_inv_${generateCsprngHex(16)}`;
}


const WEAK_SEQUENTIAL_OR_TIMESTAMP_ID_REGEX = /^(?:inv_)?\d{8,}$/;

export function validateGeneratedLocatorId(
  rawId: unknown,
  label: string
): string {
  const validated = validateInvitationId(rawId);
  if (WEAK_SEQUENTIAL_OR_TIMESTAMP_ID_REGEX.test(validated)) {
    throw new AdminInvitationPersistenceError(
      'UNTRUSTED_ID_GENERATOR',
      `${label} (${validated}) appears to be a purely numeric/timestamp identifier rather than a cryptographically random locator.`
    );
  }
  return validated;
}

export function isInvitationLogicallyExpired(
  invitation: AdminInvitationRecord,
  clock: InvitationClock
): boolean {
  if (invitation.status === AdminInvitationStatus.Expired) {
    return true;
  }
  if (invitation.status !== AdminInvitationStatus.Pending) {
    return false;
  }
  const now = clock();
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(nowMs)) {
    throw new AdminInvitationPersistenceError(
      'INVALID_TIMESTAMPS',
      'Server clock returned an invalid timestamp during expiration check.'
    );
  }
  return nowMs >= Date.parse(invitation.expiresAtIso);
}

export function serializeInvitationRecordForPersistence(
  record: AdminInvitationRecord
): Record<string, unknown> {
  const validated = validatePersistedAdminInvitationRecord(record);
  return {
    invitationId: validated.invitationId,
    targetUid: validated.targetUid,
    normalizedTargetEmail: validated.normalizedTargetEmail,
    intendedRole: validated.intendedRole,
    invitingOwnerUid: validated.invitingOwnerUid,
    createdAtIso: validated.createdAtIso,
    expiresAtIso: validated.expiresAtIso,
    status: validated.status,
    acceptedAtIso: validated.acceptedAtIso,
    acceptedByUid: validated.acceptedByUid,
    revokedAtIso: validated.revokedAtIso,
    revokedByOwnerUid: validated.revokedByOwnerUid,
    expiredAtIso: validated.expiredAtIso,
    revision: validated.revision,
  };
}

export function buildInvitationCreatedAuditEvent(params: {
  readonly auditEventId: string;
  readonly inviter: AdminUser;
  readonly invitation: AdminInvitationRecord;
}): AdminInvitationAuditEvent {
  const { auditEventId, inviter, invitation } = params;
  const changes: AuditChange[] = [
    {
      field: 'status',
      previousValue: null,
      newValue: AdminInvitationStatus.Pending,
    },
    {
      field: 'intendedRole',
      previousValue: null,
      newValue: invitation.intendedRole,
    },
  ];

  return {
    id: validateGeneratedLocatorId(auditEventId, 'Audit event ID'),
    timestamp: invitation.createdAtIso,
    actorUserId: inviter.id,
    actorName: inviter.name,
    actorRole: inviter.role,
    action: AuditAction.Created,
    targetType: AuditTargetType.AdminUser,
    targetId: invitation.targetUid ?? invitation.invitationId,
    targetTitle: `${invitation.normalizedTargetEmail} (${invitation.intendedRole})`,
    eventType: 'InvitationCreated',
    invitationId: invitation.invitationId,
    targetUid: invitation.targetUid,
    normalizedTargetEmail: invitation.normalizedTargetEmail,
    intendedRole: invitation.intendedRole,
    invitingOwnerUid: invitation.invitingOwnerUid,
    invitationRevision: invitation.revision,
    changes,
    metadata: {
      eventType: 'InvitationCreated',
      invitationId: invitation.invitationId,
      targetUid: invitation.targetUid,
      normalizedTargetEmail: invitation.normalizedTargetEmail,
      intendedRole: invitation.intendedRole,
      invitingOwnerUid: invitation.invitingOwnerUid,
      invitationRevision: invitation.revision,
    },
  };
}

export function buildInvitationRevokedAuditEvent(params: {
  readonly auditEventId: string;
  readonly revoker: AdminUser;
  readonly invitation: AdminInvitationRecord;
}): AdminInvitationAuditEvent {
  const { auditEventId, revoker, invitation } = params;
  const timestamp = invitation.revokedAtIso;
  if (!timestamp) {
    throw new AdminInvitationPersistenceError(
      'INVALID_INVITATION_RECORD',
      'Revoked invitation is missing revokedAtIso timestamp.'
    );
  }

  const changes: AuditChange[] = [
    {
      field: 'status',
      previousValue: AdminInvitationStatus.Pending,
      newValue: AdminInvitationStatus.Revoked,
    },
  ];

  return {
    id: validateGeneratedLocatorId(auditEventId, 'Audit event ID'),
    timestamp,
    actorUserId: revoker.id,
    actorName: revoker.name,
    actorRole: revoker.role,
    action: AuditAction.StatusChanged,
    targetType: AuditTargetType.AdminUser,
    targetId: invitation.targetUid ?? invitation.invitationId,
    targetTitle: `${invitation.normalizedTargetEmail} (${invitation.intendedRole})`,
    eventType: 'InvitationRevoked',
    invitationId: invitation.invitationId,
    targetUid: invitation.targetUid,
    normalizedTargetEmail: invitation.normalizedTargetEmail,
    intendedRole: invitation.intendedRole,
    invitingOwnerUid: invitation.invitingOwnerUid,
    invitationRevision: invitation.revision,
    changes,
    metadata: {
      eventType: 'InvitationRevoked',
      invitationId: invitation.invitationId,
      targetUid: invitation.targetUid,
      normalizedTargetEmail: invitation.normalizedTargetEmail,
      intendedRole: invitation.intendedRole,
      invitingOwnerUid: invitation.invitingOwnerUid,
      invitationRevision: invitation.revision,
    },
  };
}

export function buildInvitationAcceptedAuditEvent(params: {
  readonly auditEventId: string;
  readonly activatedAdmin: AdminUser;
  readonly invitation: AdminInvitationRecord;
}): AdminInvitationAuditEvent {
  const { auditEventId, activatedAdmin, invitation } = params;
  const timestamp = invitation.acceptedAtIso;
  if (!timestamp || !invitation.acceptedByUid) {
    throw new AdminInvitationPersistenceError(
      'INVALID_INVITATION_RECORD',
      'Accepted invitation is missing acceptedAtIso or acceptedByUid.'
    );
  }

  const changes: AuditChange[] = [
    {
      field: 'status',
      previousValue: AdminInvitationStatus.Pending,
      newValue: AdminInvitationStatus.Accepted,
    },
    {
      field: 'role',
      previousValue: null,
      newValue: activatedAdmin.role,
    },
    {
      field: 'isActive',
      previousValue: null,
      newValue: true,
    },
  ];

  return {
    id: validateGeneratedLocatorId(auditEventId, 'Audit event ID'),
    timestamp,
    actorUserId: activatedAdmin.id,
    actorName: activatedAdmin.name,
    actorRole: activatedAdmin.role,
    action: AuditAction.Created,
    targetType: AuditTargetType.AdminUser,
    targetId: activatedAdmin.id,
    targetTitle: `${activatedAdmin.name} (${activatedAdmin.email})`,
    eventType: 'InvitationAccepted',
    invitationId: invitation.invitationId,
    targetUid: activatedAdmin.id,
    normalizedTargetEmail: invitation.normalizedTargetEmail,
    intendedRole: invitation.intendedRole,
    invitingOwnerUid: invitation.invitingOwnerUid,
    invitationRevision: invitation.revision,
    changes,
    metadata: {
      eventType: 'InvitationAccepted',
      invitationId: invitation.invitationId,
      targetUid: activatedAdmin.id,
      normalizedTargetEmail: invitation.normalizedTargetEmail,
      intendedRole: invitation.intendedRole,
      invitingOwnerUid: invitation.invitingOwnerUid,
      invitationRevision: invitation.revision,
    },
  };
}

export function mapContractErrorToPersistenceError(
  error: unknown
): AdminInvitationPersistenceError {
  if (error instanceof AdminInvitationPersistenceError) {
    return error;
  }
  if (error instanceof AdminInvitationContractError) {
    return new AdminInvitationPersistenceError(error.code, error.message);
  }
  const message =
    error instanceof Error
      ? error.message
      : 'Unexpected administrative invitation persistence error.';
  return new AdminInvitationPersistenceError('PERSISTENCE_FAILURE', message);
}

export interface CreateInvitationAtomicParams {
  readonly invitationId: string;
  readonly auditEventId: string;
  readonly authenticatedCallerUid: string;
  readonly targetEmail: string;
  readonly targetUid?: string | null;
  readonly intendedRole: AdminRole;
  readonly ttlMs?: number;
  readonly explicitOwnerRoleGrant?: ExplicitOwnerRoleGrantAuthorization;
  readonly preResolvedTargetUidByEmail?: string | null;
  readonly clock: InvitationClock;
}

export interface CreateInvitationAtomicResult {
  readonly invitation: AdminInvitationRecord;
  readonly auditEvent: AdminInvitationAuditEvent;
}

export interface RevokeInvitationAtomicParams {
  readonly invitationId: string;
  readonly auditEventId: string;
  readonly authenticatedCallerUid: string;
  readonly expectedRevision?: number;
  readonly clock: InvitationClock;
}

export interface RevokeInvitationAtomicResult {
  readonly invitation: AdminInvitationRecord;
  readonly auditEvent: AdminInvitationAuditEvent;
}

export interface VerifiedAcceptorAuthProfile {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string;
  readonly payloadClaimedUid?: string;
  readonly payloadClaimedRole?: unknown;
}

export interface AcceptInvitationAtomicParams {
  readonly invitationId: string;
  readonly auditEventId: string;
  readonly verifiedAcceptor: VerifiedAcceptorAuthProfile;
  readonly expectedRevision?: number;
  readonly clock: InvitationClock;
}

export interface AcceptInvitationAtomicResult {
  readonly invitation: AdminInvitationRecord;
  readonly activatedAdmin: AdminUser;
  readonly auditEvent: AdminInvitationAuditEvent;
}

export interface AdminInvitationRepository {
  getInvitationById(
    invitationId: string
  ): Promise<AdminInvitationRecord | null>;

  createInvitationAtomic(
    params: CreateInvitationAtomicParams
  ): Promise<CreateInvitationAtomicResult>;

  revokeInvitationAtomic(
    params: RevokeInvitationAtomicParams
  ): Promise<RevokeInvitationAtomicResult>;

  acceptInvitationAtomic(
    params: AcceptInvitationAtomicParams
  ): Promise<AcceptInvitationAtomicResult>;
}
