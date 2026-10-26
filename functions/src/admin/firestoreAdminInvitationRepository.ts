import { getFirestore } from 'firebase-admin/firestore';
import {
  AdminInvitationStatus,
  createAdminInvitationIntent,
  transitionInvitationToAccepted,
  transitionInvitationToRevoked,
  validateInvitationId,
  validateOwnerInvitationAuthority,
  validatePersistedAdminInvitationRecord,
  type AdminInvitationRecord,
} from './adminInvitationContract';
import {
  ADMINS_COLLECTION,
  ADMIN_AUDIT_LOGS_COLLECTION,
  ADMIN_INVITATIONS_COLLECTION,
  AdminInvitationPersistenceError,
  buildInvitationAcceptedAuditEvent,
  buildInvitationCreatedAuditEvent,
  buildInvitationRevokedAuditEvent,
  isInvitationLogicallyExpired,
  mapContractErrorToPersistenceError,
  serializeInvitationRecordForPersistence,
  validateGeneratedLocatorId,
  type AcceptInvitationAtomicParams,
  type AcceptInvitationAtomicResult,
  type AdminInvitationAuditEvent,
  type AdminInvitationRepository,
  type CreateInvitationAtomicParams,
  type CreateInvitationAtomicResult,
  type RevokeInvitationAtomicParams,
  type RevokeInvitationAtomicResult,
} from './adminInvitationRepository';
import { AdminRole, isValidAdminRole, type AdminUser } from '../types/admin';

export interface AdminInvitationFirestoreDocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface AdminInvitationFirestoreDocumentRef {
  readonly id: string;
  get(): Promise<AdminInvitationFirestoreDocumentSnapshot>;
}

export interface AdminInvitationFirestoreCollectionRef {
  doc(documentId: string): AdminInvitationFirestoreDocumentRef;
}

/**
 * Structural Firestore transaction interface.
 * Intentionally omits `{ merge: true }` on `set()` so privilege assignment and
 * invitation state transitions never perform partial field merges.
 */
export interface AdminInvitationFirestoreTransaction {
  get(
    docRef: AdminInvitationFirestoreDocumentRef
  ): Promise<AdminInvitationFirestoreDocumentSnapshot>;
  create(
    docRef: AdminInvitationFirestoreDocumentRef,
    data: Record<string, unknown>
  ): AdminInvitationFirestoreTransaction | void;
  set(
    docRef: AdminInvitationFirestoreDocumentRef,
    data: Record<string, unknown>
  ): AdminInvitationFirestoreTransaction | void;
}

export interface AdminInvitationFirestoreDatabase {
  collection(collectionName: string): AdminInvitationFirestoreCollectionRef;
  runTransaction<T>(
    updateFunction: (
      transaction: AdminInvitationFirestoreTransaction
    ) => Promise<T>
  ): Promise<T>;
}

function parseSnapshotToCanonicalAdminUser(
  snapshot: AdminInvitationFirestoreDocumentSnapshot
): AdminUser | null {
  if (!snapshot || !snapshot.exists) {
    return null;
  }

  const canonicalUid =
    typeof snapshot.id === 'string' ? snapshot.id.trim() : '';
  if (!canonicalUid) {
    throw new AdminInvitationPersistenceError(
      'INVALID_INVITATION_RECORD',
      'Admin document snapshot is missing a valid document ID.'
    );
  }

  const data = snapshot.data();
  if (!data || typeof data !== 'object') {
    throw new AdminInvitationPersistenceError(
      'INVALID_INVITATION_RECORD',
      `Admin document (${canonicalUid}) has empty or non-object data.`
    );
  }

  if (!isValidAdminRole(data.role)) {
    throw new AdminInvitationPersistenceError(
      'UNAUTHORIZED_INVITER',
      `Invalid or non-canonical AdminRole (${String(data.role)}) on admin record (${canonicalUid}).`
    );
  }

  if (typeof data.isActive !== 'boolean') {
    throw new AdminInvitationPersistenceError(
      'UNAUTHORIZED_INVITER',
      `Invalid or non-boolean isActive flag on admin record (${canonicalUid}).`
    );
  }

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (!name || !email) {
    throw new AdminInvitationPersistenceError(
      'UNAUTHORIZED_INVITER',
      `Missing or invalid name/email on admin record (${canonicalUid}).`
    );
  }

  return {
    id: canonicalUid,
    name,
    email,
    role: data.role,
    isActive: data.isActive,
  };
}

function serializeAuditEventForPersistence(
  event: AdminInvitationAuditEvent
): Record<string, unknown> {
  return {
    id: event.id,
    timestamp: event.timestamp,
    actorUserId: event.actorUserId,
    actorName: event.actorName,
    actorRole: event.actorRole,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    targetTitle: event.targetTitle ?? null,
    eventType: event.eventType,
    invitationId: event.invitationId,
    targetUid: event.targetUid,
    normalizedTargetEmail: event.normalizedTargetEmail,
    intendedRole: event.intendedRole,
    invitingOwnerUid: event.invitingOwnerUid,
    invitationRevision: event.invitationRevision,
    changes: event.changes ? event.changes.map((c) => ({ ...c })) : [],
    metadata: event.metadata ? { ...event.metadata } : {},
  };
}

export class FirestoreAdminInvitationRepository
  implements AdminInvitationRepository
{
  private readonly db: AdminInvitationFirestoreDatabase;

  constructor(db?: AdminInvitationFirestoreDatabase) {
    this.db =
      db ?? (getFirestore() as unknown as AdminInvitationFirestoreDatabase);
  }

  public async getInvitationById(
    rawInvitationId: string
  ): Promise<AdminInvitationRecord | null> {
    try {
      const invitationId = validateInvitationId(rawInvitationId);
      const docRef = this.db
        .collection(ADMIN_INVITATIONS_COLLECTION)
        .doc(invitationId);
      const snapshot = await docRef.get();
      if (!snapshot.exists) {
        return null;
      }
      const data = snapshot.data();
      if (!data || typeof data !== 'object') {
        throw new AdminInvitationPersistenceError(
          'INVALID_INVITATION_RECORD',
          `Invitation document (${invitationId}) has empty or invalid data.`
        );
      }
      const validated = validatePersistedAdminInvitationRecord(data);
      if (validated.invitationId !== snapshot.id.trim()) {
        throw new AdminInvitationPersistenceError(
          'INVALID_INVITATION_RECORD',
          `Invitation document ID (${snapshot.id}) does not match internal invitationId (${validated.invitationId}).`
        );
      }
      return validated;
    } catch (error: unknown) {
      throw mapContractErrorToPersistenceError(error);
    }
  }

  public async createInvitationAtomic(
    params: CreateInvitationAtomicParams
  ): Promise<CreateInvitationAtomicResult> {
    try {
      const invitationId = validateGeneratedLocatorId(
        params.invitationId,
        'Invitation ID'
      );
      const auditEventId = validateGeneratedLocatorId(
        params.auditEventId,
        'Audit event ID'
      );
      const callerUid =
        typeof params.authenticatedCallerUid === 'string'
          ? params.authenticatedCallerUid.trim()
          : '';

      if (!callerUid) {
        throw new AdminInvitationPersistenceError(
          'UNAUTHENTICATED_CALLER',
          'Authenticated caller UID is required to create an invitation.'
        );
      }

      return await this.db.runTransaction(async (tx) => {
        const adminsCol = this.db.collection(ADMINS_COLLECTION);
        const invitationsCol = this.db.collection(ADMIN_INVITATIONS_COLLECTION);
        const auditLogsCol = this.db.collection(ADMIN_AUDIT_LOGS_COLLECTION);

        // 1. Read caller admin identity atomically
        const callerSnap = await tx.get(adminsCol.doc(callerUid));
        const callerAdmin = parseSnapshotToCanonicalAdminUser(callerSnap);

        const authorizedOwner = validateOwnerInvitationAuthority(
          callerUid,
          callerAdmin
        );

        // 2. Check existing target admin if targetUid or pre-resolved UID is present
        const candidateTargetUid =
          (typeof params.targetUid === 'string' && params.targetUid.trim()
            ? params.targetUid.trim()
            : null) ??
          (typeof params.preResolvedTargetUidByEmail === 'string' &&
          params.preResolvedTargetUidByEmail.trim()
            ? params.preResolvedTargetUidByEmail.trim()
            : null);

        let existingTargetAdmin: AdminUser | null = null;
        if (candidateTargetUid) {
          const targetAdminSnap = await tx.get(
            adminsCol.doc(candidateTargetUid)
          );
          if (targetAdminSnap.exists) {
            existingTargetAdmin =
              parseSnapshotToCanonicalAdminUser(targetAdminSnap) ?? {
                id: candidateTargetUid,
                name: 'Existing Admin',
                email: params.targetEmail,
                role: AdminRole.Viewer,
                isActive: true,
              };
          }
        }

        // 3. Ensure invitationId does not already exist
        const invitationRef = invitationsCol.doc(invitationId);
        const existingInvitationSnap = await tx.get(invitationRef);
        if (existingInvitationSnap.exists) {
          throw new AdminInvitationPersistenceError(
            'INVITATION_ALREADY_EXISTS',
            `Invitation (${invitationId}) already exists.`
          );
        }

        // 4. Validate and build Pending invitation via AUTH-03B1 contract
        const invitation = createAdminInvitationIntent(
          {
            invitationId,
            authenticatedCallerUid: callerUid,
            resolvedCallerAdmin: authorizedOwner,
            targetEmail: params.targetEmail,
            targetUid:
              params.targetUid !== undefined
                ? params.targetUid
                : candidateTargetUid,
            intendedRole: params.intendedRole,
            ttlMs: params.ttlMs,
            existingTargetAdmin,
            explicitOwnerRoleGrant: params.explicitOwnerRoleGrant,
          },
          params.clock
        );

        // 5. Build immutable InvitationCreated audit event
        const auditEvent = buildInvitationCreatedAuditEvent({
          auditEventId,
          inviter: authorizedOwner,
          invitation,
        });

        const auditRef = auditLogsCol.doc(auditEvent.id);

        // 6. Stage atomic creates (no partial merges)
        tx.create(
          invitationRef,
          serializeInvitationRecordForPersistence(invitation)
        );
        tx.create(auditRef, serializeAuditEventForPersistence(auditEvent));

        return {
          invitation,
          auditEvent,
        };
      });
    } catch (error: unknown) {
      throw mapContractErrorToPersistenceError(error);
    }
  }

  public async revokeInvitationAtomic(
    params: RevokeInvitationAtomicParams
  ): Promise<RevokeInvitationAtomicResult> {
    try {
      const invitationId = validateInvitationId(params.invitationId);
      const auditEventId = validateGeneratedLocatorId(
        params.auditEventId,
        'Audit event ID'
      );
      const callerUid =
        typeof params.authenticatedCallerUid === 'string'
          ? params.authenticatedCallerUid.trim()
          : '';

      if (!callerUid) {
        throw new AdminInvitationPersistenceError(
          'UNAUTHENTICATED_CALLER',
          'Authenticated caller UID is required to revoke an invitation.'
        );
      }

      return await this.db.runTransaction(async (tx) => {
        const adminsCol = this.db.collection(ADMINS_COLLECTION);
        const invitationsCol = this.db.collection(ADMIN_INVITATIONS_COLLECTION);
        const auditLogsCol = this.db.collection(ADMIN_AUDIT_LOGS_COLLECTION);

        // 1. Read and authorize caller as active Owner with ManageUsers
        const callerSnap = await tx.get(adminsCol.doc(callerUid));
        const callerAdmin = parseSnapshotToCanonicalAdminUser(callerSnap);
        const authorizedOwner = validateOwnerInvitationAuthority(
          callerUid,
          callerAdmin
        );

        // 2. Read target invitation
        const invitationRef = invitationsCol.doc(invitationId);
        const invitationSnap = await tx.get(invitationRef);
        if (!invitationSnap.exists) {
          throw new AdminInvitationPersistenceError(
            'INVITATION_NOT_FOUND',
            `Invitation (${invitationId}) was not found.`
          );
        }

        const currentInvitation = validatePersistedAdminInvitationRecord(
          invitationSnap.data()
        );
        if (currentInvitation.invitationId !== invitationSnap.id.trim()) {
          throw new AdminInvitationPersistenceError(
            'INVALID_INVITATION_RECORD',
            `Invitation document ID (${invitationSnap.id}) mismatch.`
          );
        }

        // 3. Validate and transition Pending -> Revoked
        const revokedInvitation = transitionInvitationToRevoked(
          {
            invitation: currentInvitation,
            authenticatedCallerUid: callerUid,
            resolvedCallerAdmin: authorizedOwner,
            expectedRevision: params.expectedRevision,
          },
          params.clock
        );

        // 4. Build immutable InvitationRevoked audit event
        const auditEvent = buildInvitationRevokedAuditEvent({
          auditEventId,
          revoker: authorizedOwner,
          invitation: revokedInvitation,
        });

        const auditRef = auditLogsCol.doc(auditEvent.id);

        // 5. Stage atomic updates without touching admins/{uid}
        tx.set(
          invitationRef,
          serializeInvitationRecordForPersistence(revokedInvitation)
        );
        tx.create(auditRef, serializeAuditEventForPersistence(auditEvent));

        return {
          invitation: revokedInvitation,
          auditEvent,
        };
      });
    } catch (error: unknown) {
      throw mapContractErrorToPersistenceError(error);
    }
  }

  public async acceptInvitationAtomic(
    params: AcceptInvitationAtomicParams
  ): Promise<AcceptInvitationAtomicResult> {
    try {
      const invitationId = validateInvitationId(params.invitationId);
      const auditEventId = validateGeneratedLocatorId(
        params.auditEventId,
        'Audit event ID'
      );
      const acceptor = params.verifiedAcceptor;
      const authenticatedUid =
        typeof acceptor?.uid === 'string' ? acceptor.uid.trim() : '';

      if (!authenticatedUid) {
        throw new AdminInvitationPersistenceError(
          'UNAUTHENTICATED_CALLER',
          'Authenticated Firebase UID is required to accept an invitation.'
        );
      }

      return await this.db.runTransaction(async (tx) => {
        const invitationsCol = this.db.collection(ADMIN_INVITATIONS_COLLECTION);
        const adminsCol = this.db.collection(ADMINS_COLLECTION);
        const auditLogsCol = this.db.collection(ADMIN_AUDIT_LOGS_COLLECTION);

        // 1. Read the invitation
        const invitationRef = invitationsCol.doc(invitationId);
        const invitationSnap = await tx.get(invitationRef);
        if (!invitationSnap.exists) {
          throw new AdminInvitationPersistenceError(
            'INVITATION_NOT_FOUND',
            `Invitation (${invitationId}) does not exist.`
          );
        }

        const currentInvitation = validatePersistedAdminInvitationRecord(
          invitationSnap.data()
        );
        if (currentInvitation.invitationId !== invitationSnap.id.trim()) {
          throw new AdminInvitationPersistenceError(
            'INVALID_INVITATION_RECORD',
            `Invitation document ID (${invitationSnap.id}) does not match internal invitationId (${currentInvitation.invitationId}).`
          );
        }

        // 2. Validate current status and revision
        if (
          params.expectedRevision !== undefined &&
          params.expectedRevision !== currentInvitation.revision
        ) {
          throw new AdminInvitationPersistenceError(
            'CONCURRENT_MODIFICATION_CONFLICT',
            `Expected invitation revision ${params.expectedRevision}, but found ${currentInvitation.revision}.`
          );
        }

        if (currentInvitation.status === AdminInvitationStatus.Accepted) {
          throw new AdminInvitationPersistenceError(
            'INVITATION_ALREADY_ACCEPTED',
            `Invitation (${invitationId}) has already been accepted.`
          );
        }

        if (currentInvitation.status === AdminInvitationStatus.Revoked) {
          throw new AdminInvitationPersistenceError(
            'INVITATION_REVOKED',
            `Invitation (${invitationId}) has been revoked.`
          );
        }

        if (currentInvitation.status === AdminInvitationStatus.Expired) {
          throw new AdminInvitationPersistenceError(
            'INVITATION_EXPIRED',
            `Invitation (${invitationId}) is expired.`
          );
        }

        // 3. Validate expiration against trusted server time
        if (isInvitationLogicallyExpired(currentInvitation, params.clock)) {
          throw new AdminInvitationPersistenceError(
            'INVITATION_EXPIRED',
            `Invitation (${invitationId}) expired at ${currentInvitation.expiresAtIso}.`
          );
        }

        // 4. Fail closed on Owner role activation (Section 6 Owner role safety)
        if (currentInvitation.intendedRole === AdminRole.Owner) {
          throw new AdminInvitationPersistenceError(
            'OWNER_ACTIVATION_FORBIDDEN',
            'Activating invitations with intendedRole === Owner is forbidden until a dedicated Owner lifecycle and last-active-Owner policy is enabled.'
          );
        }

        // 5. Read admins/{authenticatedUid} and fail closed if an admin record already exists
        const adminDocRef = adminsCol.doc(authenticatedUid);
        const existingAdminSnap = await tx.get(adminDocRef);
        if (existingAdminSnap.exists) {
          throw new AdminInvitationPersistenceError(
            'EXISTING_ADMIN_CONFLICT',
            `Administrative identity already exists at admins/${authenticatedUid}; refusing to overwrite existing admin record.`
          );
        }

        // 6. Validate transition to Accepted via AUTH-03B1 contract
        const acceptedInvitation = transitionInvitationToAccepted(
          {
            invitation: currentInvitation,
            expectedRevision: currentInvitation.revision,
            existingTargetAdmin: null,
            acceptorIdentity: {
              authenticatedUid,
              verifiedEmail: acceptor.email,
              emailVerified: acceptor.emailVerified,
              boundInvitationId: invitationId,
              payloadClaimedUid: acceptor.payloadClaimedUid,
              payloadClaimedRole: acceptor.payloadClaimedRole,
            },
          },
          params.clock
        );

        const resolvedDisplayName =
          typeof acceptor.displayName === 'string' &&
          acceptor.displayName.trim().length > 0
            ? acceptor.displayName.trim()
            : acceptedInvitation.normalizedTargetEmail;

        const activatedAdmin: AdminUser = {
          id: authenticatedUid,
          name: resolvedDisplayName,
          email: acceptedInvitation.normalizedTargetEmail,
          role: acceptedInvitation.intendedRole,
          isActive: true,
        };

        // 7. Create admins/{authenticatedUid} with intended canonical role (create-only, no merge)
        tx.create(adminDocRef, {
          id: activatedAdmin.id,
          name: activatedAdmin.name,
          email: activatedAdmin.email,
          role: activatedAdmin.role,
          isActive: true,
          createdAt: acceptedInvitation.acceptedAtIso,
          updatedAt: acceptedInvitation.acceptedAtIso,
          provisionedViaInvitationId: acceptedInvitation.invitationId,
        });

        // 8. Update the invitation to Accepted (full replacement, no merge)
        tx.set(
          invitationRef,
          serializeInvitationRecordForPersistence(acceptedInvitation)
        );

        // 9. Write durable administrative audit event
        const auditEvent = buildInvitationAcceptedAuditEvent({
          auditEventId,
          activatedAdmin,
          invitation: acceptedInvitation,
        });
        const auditRef = auditLogsCol.doc(auditEvent.id);
        tx.create(auditRef, serializeAuditEventForPersistence(auditEvent));

        return {
          invitation: acceptedInvitation,
          activatedAdmin,
          auditEvent,
        };
      });
    } catch (error: unknown) {
      throw mapContractErrorToPersistenceError(error);
    }
  }
}
