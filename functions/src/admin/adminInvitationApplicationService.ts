import { getAuth } from 'firebase-admin/auth';
import {
  normalizeAndValidateTargetEmail,
  systemInvitationClock,
  validateInvitationId,
  type AdminInvitationRecord,
  type ExplicitOwnerRoleGrantAuthorization,
  type InvitationClock,
} from './adminInvitationContract';
import {
  AdminInvitationPersistenceError,
  generateCryptographicAuditEventId,
  generateCryptographicInvitationId,
  mapContractErrorToPersistenceError,
  validateGeneratedLocatorId,
  type AcceptInvitationAtomicResult,
  type AdminInvitationRepository,
  type CreateInvitationAtomicResult,
  type CryptographicIdGenerator,
  type RevokeInvitationAtomicResult,
} from './adminInvitationRepository';
import { FirestoreAdminInvitationRepository } from './firestoreAdminInvitationRepository';
import { AdminRole, isValidAdminRole } from '../types/admin';

export interface TrustedFirebaseAuthUserRecord {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  readonly disabled: boolean;
}

export interface AdminInvitationAuthAuthority {
  getUserByUid(uid: string): Promise<TrustedFirebaseAuthUserRecord | null>;
  getUserByEmail?(email: string): Promise<TrustedFirebaseAuthUserRecord | null>;
}

export class FirebaseAdminInvitationAuthAuthority
  implements AdminInvitationAuthAuthority
{
  public async getUserByUid(
    uid: string
  ): Promise<TrustedFirebaseAuthUserRecord | null> {
    if (!uid || typeof uid !== 'string' || uid.trim() === '') {
      return null;
    }
    try {
      const record = await getAuth().getUser(uid.trim());
      return {
        uid: record.uid,
        email: record.email ?? null,
        emailVerified: Boolean(record.emailVerified),
        displayName: record.displayName ?? null,
        disabled: Boolean(record.disabled),
      };
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        return null;
      }
      throw new AdminInvitationPersistenceError(
        'PERSISTENCE_FAILURE',
        `Failed to resolve Firebase Auth user by UID (${uid}): ${err?.message || String(err)}`
      );
    }
  }

  public async getUserByEmail(
    email: string
  ): Promise<TrustedFirebaseAuthUserRecord | null> {
    if (!email || typeof email !== 'string' || email.trim() === '') {
      return null;
    }
    try {
      const record = await getAuth().getUserByEmail(email.trim().toLowerCase());
      return {
        uid: record.uid,
        email: record.email ?? null,
        emailVerified: Boolean(record.emailVerified),
        displayName: record.displayName ?? null,
        disabled: Boolean(record.disabled),
      };
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        return null;
      }
      throw new AdminInvitationPersistenceError(
        'PERSISTENCE_FAILURE',
        `Failed to resolve Firebase Auth user by email: ${err?.message || String(err)}`
      );
    }
  }
}

export interface UntrustedClientSpoofCheckPayload {
  readonly callerUid?: unknown;
  readonly uid?: unknown;
  readonly targetUid?: unknown;
  readonly role?: unknown;
  readonly intendedRole?: unknown;
  readonly emailVerified?: unknown;
  readonly email?: unknown;
  readonly isActive?: unknown;
  readonly isOwner?: unknown;
  readonly permissions?: unknown;
}

export interface CreatePendingAdminInvitationCommand {
  readonly authenticatedCallerUid: string;
  readonly targetEmail: string;
  readonly intendedRole: AdminRole;
  readonly targetUid?: string | null;
  readonly ttlMs?: number;
  readonly explicitOwnerRoleGrant?: ExplicitOwnerRoleGrantAuthorization;
  readonly untrustedClientPayload?: UntrustedClientSpoofCheckPayload;
}

export interface RevokePendingAdminInvitationCommand {
  readonly authenticatedCallerUid: string;
  readonly invitationId: string;
  readonly expectedRevision?: number;
  readonly untrustedClientPayload?: UntrustedClientSpoofCheckPayload;
}

export interface AcceptPendingAdminInvitationCommand {
  readonly authenticatedCallerUid: string;
  readonly invitationId: string;
  readonly expectedRevision?: number;
  readonly untrustedClientPayload?: UntrustedClientSpoofCheckPayload;
}

export interface AdminInvitationApplicationServiceDependencies {
  readonly repository?: AdminInvitationRepository;
  readonly authAuthority?: AdminInvitationAuthAuthority;
  readonly clock?: InvitationClock;
  readonly generateInvitationId?: CryptographicIdGenerator;
  readonly generateAuditEventId?: CryptographicIdGenerator;
}

export class AdminInvitationApplicationService {
  private readonly repository: AdminInvitationRepository;
  private readonly authAuthority: AdminInvitationAuthAuthority;
  private readonly clock: InvitationClock;
  private readonly generateInvitationId: CryptographicIdGenerator;
  private readonly generateAuditEventId: CryptographicIdGenerator;

  constructor(deps?: AdminInvitationApplicationServiceDependencies) {
    this.repository = deps?.repository ?? new FirestoreAdminInvitationRepository();
    this.authAuthority =
      deps?.authAuthority ?? new FirebaseAdminInvitationAuthAuthority();
    this.clock = deps?.clock ?? systemInvitationClock;
    this.generateInvitationId =
      deps?.generateInvitationId ?? generateCryptographicInvitationId;
    this.generateAuditEventId =
      deps?.generateAuditEventId ?? generateCryptographicAuditEventId;
  }

  public async getInvitationById(
    invitationId: string
  ): Promise<AdminInvitationRecord | null> {
    return this.repository.getInvitationById(invitationId);
  }

  public async createPendingInvitation(
    command: CreatePendingAdminInvitationCommand
  ): Promise<CreateInvitationAtomicResult> {
    try {
      const callerUid =
        typeof command?.authenticatedCallerUid === 'string'
          ? command.authenticatedCallerUid.trim()
          : '';
      if (!callerUid) {
        throw new AdminInvitationPersistenceError(
          'UNAUTHENTICATED_CALLER',
          'An authenticated Firebase UID is required to create an invitation.'
        );
      }

      if (command.untrustedClientPayload) {
        const spoofedCaller = command.untrustedClientPayload.callerUid;
        if (
          typeof spoofedCaller === 'string' &&
          spoofedCaller.trim() !== '' &&
          spoofedCaller.trim() !== callerUid
        ) {
          throw new AdminInvitationPersistenceError(
            'IDENTITY_MISMATCH',
            'Client payload callerUid does not match authenticated caller UID.'
          );
        }
      }

      const normalizedEmail = normalizeAndValidateTargetEmail(
        command.targetEmail
      );

      if (!isValidAdminRole(command.intendedRole)) {
        throw new AdminInvitationPersistenceError(
          'INVALID_INTENDED_ROLE',
          `Invalid or non-canonical AdminRole (${String(command.intendedRole)}).`
        );
      }

      let explicitTargetUid: string | null = null;
      if (command.targetUid !== undefined && command.targetUid !== null) {
        if (
          typeof command.targetUid !== 'string' ||
          command.targetUid.trim() === ''
        ) {
          throw new AdminInvitationPersistenceError(
            'INVALID_TARGET_UID',
            'targetUid must be null or a non-empty Firebase UID.'
          );
        }
        explicitTargetUid = command.targetUid.trim();
      }

      // Pre-transaction Firebase Auth lookups (never inside transaction callback)
      let preResolvedTargetUidByEmail: string | null = null;
      if (typeof this.authAuthority.getUserByEmail === 'function') {
        const authUserByEmail =
          await this.authAuthority.getUserByEmail(normalizedEmail);
        if (authUserByEmail) {
          preResolvedTargetUidByEmail = authUserByEmail.uid.trim();
          if (
            explicitTargetUid &&
            explicitTargetUid !== preResolvedTargetUidByEmail
          ) {
            throw new AdminInvitationPersistenceError(
              'IDENTITY_MISMATCH',
              `Provided targetUid (${explicitTargetUid}) does not match Firebase Auth UID (${preResolvedTargetUidByEmail}) for email (${normalizedEmail}).`
            );
          }
        }
      }

      if (explicitTargetUid && !preResolvedTargetUidByEmail) {
        const authUserByUid =
          await this.authAuthority.getUserByUid(explicitTargetUid);
        if (!authUserByUid) {
          throw new AdminInvitationPersistenceError(
            'INVALID_TARGET_UID',
            `Target Firebase Auth user (${explicitTargetUid}) does not exist.`
          );
        }
        const resolvedUidEmail = authUserByUid.email
          ? authUserByUid.email.trim().toLowerCase()
          : '';
        if (resolvedUidEmail !== normalizedEmail) {
          throw new AdminInvitationPersistenceError(
            'IDENTITY_MISMATCH',
            `Target Firebase Auth UID (${explicitTargetUid}) email does not match invitation targetEmail (${normalizedEmail}).`
          );
        }
      }

      const invitationId = validateGeneratedLocatorId(
        this.generateInvitationId(),
        'Invitation ID'
      );
      const auditEventId = validateGeneratedLocatorId(
        this.generateAuditEventId(),
        'Audit event ID'
      );

      return await this.repository.createInvitationAtomic({
        invitationId,
        auditEventId,
        authenticatedCallerUid: callerUid,
        targetEmail: normalizedEmail,
        targetUid: explicitTargetUid,
        preResolvedTargetUidByEmail,
        intendedRole: command.intendedRole,
        ttlMs: command.ttlMs,
        explicitOwnerRoleGrant: command.explicitOwnerRoleGrant,
        clock: this.clock,
      });
    } catch (error: unknown) {
      throw mapContractErrorToPersistenceError(error);
    }
  }

  public async revokePendingInvitation(
    command: RevokePendingAdminInvitationCommand
  ): Promise<RevokeInvitationAtomicResult> {
    try {
      const callerUid =
        typeof command?.authenticatedCallerUid === 'string'
          ? command.authenticatedCallerUid.trim()
          : '';
      if (!callerUid) {
        throw new AdminInvitationPersistenceError(
          'UNAUTHENTICATED_CALLER',
          'An authenticated Firebase UID is required to revoke an invitation.'
        );
      }

      if (command.untrustedClientPayload) {
        const spoofedCaller = command.untrustedClientPayload.callerUid;
        if (
          typeof spoofedCaller === 'string' &&
          spoofedCaller.trim() !== '' &&
          spoofedCaller.trim() !== callerUid
        ) {
          throw new AdminInvitationPersistenceError(
            'IDENTITY_MISMATCH',
            'Client payload callerUid does not match authenticated caller UID.'
          );
        }
      }

      const invitationId = validateInvitationId(command.invitationId);
      const auditEventId = validateGeneratedLocatorId(
        this.generateAuditEventId(),
        'Audit event ID'
      );

      return await this.repository.revokeInvitationAtomic({
        invitationId,
        auditEventId,
        authenticatedCallerUid: callerUid,
        expectedRevision: command.expectedRevision,
        clock: this.clock,
      });
    } catch (error: unknown) {
      throw mapContractErrorToPersistenceError(error);
    }
  }

  public async acceptPendingInvitation(
    command: AcceptPendingAdminInvitationCommand
  ): Promise<AcceptInvitationAtomicResult> {
    try {
      const callerUid =
        typeof command?.authenticatedCallerUid === 'string'
          ? command.authenticatedCallerUid.trim()
          : '';
      if (!callerUid) {
        throw new AdminInvitationPersistenceError(
          'UNAUTHENTICATED_CALLER',
          'An authenticated Firebase UID is required to accept an invitation.'
        );
      }

      const invitationId = validateInvitationId(command.invitationId);

      // Extract any untrusted client payload fields for anti-spoofing verification;
      // never trust client emailVerified, email, role, or UID claims as authority.
      let payloadClaimedUid: string | undefined;
      let payloadClaimedRole: unknown;

      if (command.untrustedClientPayload) {
        const rawClaimedUid =
          command.untrustedClientPayload.uid ??
          command.untrustedClientPayload.targetUid ??
          command.untrustedClientPayload.callerUid;
        if (typeof rawClaimedUid === 'string' && rawClaimedUid.trim() !== '') {
          payloadClaimedUid = rawClaimedUid.trim();
          if (payloadClaimedUid !== callerUid) {
            throw new AdminInvitationPersistenceError(
              'IDENTITY_MISMATCH',
              'Client payload UID claim does not match authenticated Firebase UID.'
            );
          }
        }

        const rawClaimedRole =
          command.untrustedClientPayload.role ??
          command.untrustedClientPayload.intendedRole;
        if (rawClaimedRole !== undefined) {
          payloadClaimedRole = rawClaimedRole;
        }

        if (command.untrustedClientPayload.isOwner === true) {
          payloadClaimedRole = AdminRole.Owner;
        }
      }

      // Resolve Firebase Auth identity via trusted server authority BEFORE transaction entry
      const authUser = await this.authAuthority.getUserByUid(callerUid);
      if (!authUser) {
        throw new AdminInvitationPersistenceError(
          'UNAUTHENTICATED_CALLER',
          `Authenticated Firebase user (${callerUid}) could not be resolved by server Auth authority.`
        );
      }

      if (
        typeof authUser.uid !== 'string' ||
        authUser.uid.trim() !== callerUid
      ) {
        throw new AdminInvitationPersistenceError(
          'IDENTITY_MISMATCH',
          'Server Auth authority returned a mismatched UID.'
        );
      }

      if (authUser.disabled === true) {
        throw new AdminInvitationPersistenceError(
          'UNAUTHENTICATED_CALLER',
          'Disabled Firebase Auth accounts cannot accept administrative invitations.'
        );
      }

      if (authUser.emailVerified !== true) {
        throw new AdminInvitationPersistenceError(
          'UNVERIFIED_TARGET_EMAIL',
          'Acceptor Firebase Auth email is not verified according to server Auth authority.'
        );
      }

      const verifiedEmail = normalizeAndValidateTargetEmail(authUser.email);
      const displayName =
        typeof authUser.displayName === 'string' &&
        authUser.displayName.trim().length > 0
          ? authUser.displayName.trim()
          : verifiedEmail;

      const auditEventId = validateGeneratedLocatorId(
        this.generateAuditEventId(),
        'Audit event ID'
      );

      return await this.repository.acceptInvitationAtomic({
        invitationId,
        auditEventId,
        expectedRevision: command.expectedRevision,
        clock: this.clock,
        verifiedAcceptor: {
          uid: callerUid,
          email: verifiedEmail,
          emailVerified: true,
          displayName,
          payloadClaimedUid,
          payloadClaimedRole,
        },
      });
    } catch (error: unknown) {
      throw mapContractErrorToPersistenceError(error);
    }
  }
}
