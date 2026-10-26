import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}),
}));

import { AdminRole, type AdminUser } from '../types/admin';
import {
  AdminInvitationStatus,
  DEFAULT_ADMIN_INVITATION_TTL_MS,
  type AdminInvitationRecord,
} from './adminInvitationContract';
import {
  ADMINS_COLLECTION,
  ADMIN_AUDIT_LOGS_COLLECTION,
  ADMIN_INVITATIONS_COLLECTION,
  AdminInvitationPersistenceError,
  generateCryptographicAuditEventId,
  generateCryptographicInvitationId,
  isInvitationLogicallyExpired,
  type AdminInvitationPersistenceErrorCode,
} from './adminInvitationRepository';
import {
  FirestoreAdminInvitationRepository,
  type AdminInvitationFirestoreDatabase,
  type AdminInvitationFirestoreDocumentRef,
  type AdminInvitationFirestoreDocumentSnapshot,
  type AdminInvitationFirestoreTransaction,
} from './firestoreAdminInvitationRepository';
import {
  AdminInvitationApplicationService,
  type AdminInvitationAuthAuthority,
  type TrustedFirebaseAuthUserRecord,
} from './adminInvitationApplicationService';

const BASE_TIME_ISO = '2026-10-26T09:00:00.000Z';
const BASE_TIME_MS = Date.parse(BASE_TIME_ISO);

function fixedClock(isoOrMs: string | number) {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  return () => new Date(ms);
}

const ACTIVE_OWNER: AdminUser = {
  id: 'uid-owner-1',
  name: 'Nadia Mansour',
  email: 'nadia@planet.org',
  role: AdminRole.Owner,
  isActive: true,
};

interface StagedWrite {
  readonly op: 'create' | 'set';
  readonly collectionName: string;
  readonly docId: string;
  readonly data: Record<string, unknown>;
}

interface TransactionalFakeStore {
  readonly db: AdminInvitationFirestoreDatabase;
  readonly collections: Record<string, Map<string, Record<string, unknown>>>;
  readonly setOperationCalls: Array<{
    collectionName: string;
    docId: string;
    optionsPassed: number;
  }>;
  inTransaction: boolean;
  failOnCollectionCreate: string | null;
}

function cloneRecord(
  data: Record<string, unknown>
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data));
}

function createTransactionalFirestoreFake(
  initialAdmins: ReadonlyArray<AdminUser> = [ACTIVE_OWNER]
): TransactionalFakeStore {
  const collections: Record<string, Map<string, Record<string, unknown>>> = {
    [ADMINS_COLLECTION]: new Map(),
    [ADMIN_INVITATIONS_COLLECTION]: new Map(),
    [ADMIN_AUDIT_LOGS_COLLECTION]: new Map(),
  };

  for (const admin of initialAdmins) {
    collections[ADMINS_COLLECTION].set(admin.id, {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: admin.isActive,
    });
  }

  const setOperationCalls: Array<{
    collectionName: string;
    docId: string;
    optionsPassed: number;
  }> = [];

  const store: TransactionalFakeStore = {
    collections,
    setOperationCalls,
    inTransaction: false,
    failOnCollectionCreate: null,
    db: {
      collection(collectionName: string) {
        if (!collections[collectionName]) {
          collections[collectionName] = new Map();
        }
        const colMap = collections[collectionName];

        return {
          doc(documentId: string): AdminInvitationFirestoreDocumentRef {
            const ref = {
              id: documentId,
              __collectionName: collectionName,
              async get(): Promise<AdminInvitationFirestoreDocumentSnapshot> {
                const existing = colMap.get(documentId);
                return {
                  id: documentId,
                  exists: existing !== undefined,
                  data: () => (existing ? cloneRecord(existing) : undefined),
                };
              },
            };
            return ref as AdminInvitationFirestoreDocumentRef;
          },
        };
      },
      async runTransaction<T>(
        updateFunction: (
          transaction: AdminInvitationFirestoreTransaction
        ) => Promise<T>
      ): Promise<T> {
        const stagedWrites: StagedWrite[] = [];
        store.inTransaction = true;

        const tx: AdminInvitationFirestoreTransaction = {
          async get(docRef: AdminInvitationFirestoreDocumentRef) {
            return docRef.get();
          },
          create(
            docRef: AdminInvitationFirestoreDocumentRef,
            data: Record<string, unknown>
          ) {
            const colName =
              (docRef as unknown as { __collectionName: string })
                .__collectionName ?? '';
            stagedWrites.push({
              op: 'create',
              collectionName: colName,
              docId: docRef.id,
              data: cloneRecord(data),
            });
            return tx;
          },
          set(
            docRef: AdminInvitationFirestoreDocumentRef,
            data: Record<string, unknown>,
            ...extraArgs: unknown[]
          ) {
            const colName =
              (docRef as unknown as { __collectionName: string })
                .__collectionName ?? '';
            setOperationCalls.push({
              collectionName: colName,
              docId: docRef.id,
              optionsPassed: extraArgs.length,
            });
            stagedWrites.push({
              op: 'set',
              collectionName: colName,
              docId: docRef.id,
              data: cloneRecord(data),
            });
            return tx;
          },
        };

        try {
          const result = await updateFunction(tx);

          // Validate all staged writes before committing any of them (atomic commit)
          for (const write of stagedWrites) {
            if (
              write.op === 'create' &&
              store.failOnCollectionCreate === write.collectionName
            ) {
              throw new Error(
                `Simulated atomic commit failure on collection '${write.collectionName}'`
              );
            }
            const colMap = collections[write.collectionName];
            if (write.op === 'create' && colMap.has(write.docId)) {
              const err = new Error(
                `Document ${write.collectionName}/${write.docId} already exists`
              ) as Error & { code?: string };
              err.code = 'ALREADY_EXISTS';
              throw err;
            }
          }

          for (const write of stagedWrites) {
            const colMap = collections[write.collectionName];
            colMap.set(write.docId, cloneRecord(write.data));
          }

          return result;
        } finally {
          store.inTransaction = false;
        }
      },
    },
  };

  return store;
}

function createFakeAuthAuthority(
  users: ReadonlyArray<TrustedFirebaseAuthUserRecord>,
  store?: TransactionalFakeStore
): AdminInvitationAuthAuthority & {
  callsDuringTransaction: number;
  totalCalls: number;
} {
  const byUid = new Map<string, TrustedFirebaseAuthUserRecord>();
  const byEmail = new Map<string, TrustedFirebaseAuthUserRecord>();

  for (const u of users) {
    byUid.set(u.uid, u);
    if (u.email) {
      byEmail.set(u.email.trim().toLowerCase(), u);
    }
  }

  const authority = {
    callsDuringTransaction: 0,
    totalCalls: 0,
    async getUserByUid(
      uid: string
    ): Promise<TrustedFirebaseAuthUserRecord | null> {
      authority.totalCalls += 1;
      if (store?.inTransaction) {
        authority.callsDuringTransaction += 1;
      }
      return byUid.get(uid.trim()) ?? null;
    },
    async getUserByEmail(
      email: string
    ): Promise<TrustedFirebaseAuthUserRecord | null> {
      authority.totalCalls += 1;
      if (store?.inTransaction) {
        authority.callsDuringTransaction += 1;
      }
      return byEmail.get(email.trim().toLowerCase()) ?? null;
    },
  };

  return authority;
}

async function expectPersistenceError(
  promise: Promise<unknown>,
  expectedCode: AdminInvitationPersistenceErrorCode
): Promise<AdminInvitationPersistenceError> {
  try {
    await promise;
    throw new Error(
      `Expected AdminInvitationPersistenceError(${expectedCode}), but promise resolved.`
    );
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(AdminInvitationPersistenceError);
    const typed = err as AdminInvitationPersistenceError;
    expect(typed.code).toBe(expectedCode);
    return typed;
  }
}

describe('AUTH-03B2 Durable Administrative Invitations & Atomic Acceptance', () => {
  it('1. Persists a valid Pending invitation and InvitationCreated audit record without creating an active admin', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority([], store);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_ISO),
    });

    const result = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: '  Salma.Rights@Planet.org ',
      intendedRole: AdminRole.RightsReviewer,
    });

    expect(result.invitation.invitationId).toMatch(/^inv_[0-9a-f]{32}$/);
    expect(result.invitation.status).toBe(AdminInvitationStatus.Pending);
    expect(result.invitation.normalizedTargetEmail).toBe(
      'salma.rights@planet.org'
    );
    expect(result.invitation.intendedRole).toBe(AdminRole.RightsReviewer);
    expect(result.invitation.invitingOwnerUid).toBe(ACTIVE_OWNER.id);
    expect(result.invitation.revision).toBe(1);

    // Persisted in admin_invitations/{invitationId}
    const storedInvitation = await service.getInvitationById(
      result.invitation.invitationId
    );
    expect(storedInvitation).toEqual(result.invitation);

    // No new admin document created in admins/{uid}
    expect(store.collections[ADMINS_COLLECTION].size).toBe(1);
    expect(store.collections[ADMINS_COLLECTION].has(ACTIVE_OWNER.id)).toBe(
      true
    );

    // Durable InvitationCreated audit event written to audit_logs
    expect(result.auditEvent.eventType).toBe('InvitationCreated');
    expect(result.auditEvent.actorUserId).toBe(ACTIVE_OWNER.id);
    expect(result.auditEvent.invitationId).toBe(result.invitation.invitationId);
    expect(
      store.collections[ADMIN_AUDIT_LOGS_COLLECTION].has(result.auditEvent.id)
    ).toBe(true);
    expect(authAuthority.callsDuringTransaction).toBe(0);
  });

  it('2. Denies invitation creation by non-Owner roles and non-admin users with zero writes', async () => {
    const nonOwnerRoles: AdminRole[] = [
      AdminRole.ContentEditor,
      AdminRole.LibraryCurator,
      AdminRole.RightsReviewer,
      AdminRole.TrainingManager,
      AdminRole.Trainer,
      AdminRole.CitizenModerator,
      AdminRole.AIAssistant,
      AdminRole.Viewer,
    ];

    const nonOwnerAdmins: AdminUser[] = nonOwnerRoles.map((role) => ({
      id: `uid-${role}`,
      name: `Admin ${role}`,
      email: `${role.toLowerCase()}@planet.org`,
      role,
      isActive: true,
    }));

    const store = createTransactionalFirestoreFake([
      ACTIVE_OWNER,
      ...nonOwnerAdmins,
    ]);
    const authAuthority = createFakeAuthAuthority([], store);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_ISO),
    });

    for (const nonOwner of nonOwnerAdmins) {
      await expectPersistenceError(
        service.createPendingInvitation({
          authenticatedCallerUid: nonOwner.id,
          targetEmail: 'candidate@planet.org',
          intendedRole: AdminRole.Viewer,
        }),
        'UNAUTHORIZED_INVITER'
      );
    }

    await expectPersistenceError(
      service.createPendingInvitation({
        authenticatedCallerUid: 'uid-public-user-only',
        targetEmail: 'candidate@planet.org',
        intendedRole: AdminRole.Viewer,
      }),
      'UNAUTHORIZED_INVITER'
    );

    expect(store.collections[ADMIN_INVITATIONS_COLLECTION].size).toBe(0);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('3. Denies invitation creation and revocation by an inactive Owner (isActive: false)', async () => {
    const inactiveOwner: AdminUser = {
      id: 'uid-owner-inactive',
      name: 'Inactive Owner',
      email: 'inactive.owner@planet.org',
      role: AdminRole.Owner,
      isActive: false,
    };

    const store = createTransactionalFirestoreFake([
      ACTIVE_OWNER,
      inactiveOwner,
    ]);
    const authAuthority = createFakeAuthAuthority([], store);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_ISO),
    });

    await expectPersistenceError(
      service.createPendingInvitation({
        authenticatedCallerUid: inactiveOwner.id,
        targetEmail: 'candidate@planet.org',
        intendedRole: AdminRole.ContentEditor,
      }),
      'INACTIVE_INVITER'
    );

    const createdByActive = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'candidate@planet.org',
      intendedRole: AdminRole.ContentEditor,
    });

    await expectPersistenceError(
      service.revokePendingInvitation({
        authenticatedCallerUid: inactiveOwner.id,
        invitationId: createdByActive.invitation.invitationId,
      }),
      'INACTIVE_INVITER'
    );

    expect(store.collections[ADMIN_INVITATIONS_COLLECTION].size).toBe(1);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(1);
  });

  it('4. Rejects invalid or non-canonical roles and invalid target emails at persistence boundary', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority([], store);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_ISO),
    });

    for (const invalidRole of ['SuperAdmin', 'Admin', 'ManagingEditor', 'Editor', 'Writer']) {
      await expectPersistenceError(
        service.createPendingInvitation({
          authenticatedCallerUid: ACTIVE_OWNER.id,
          targetEmail: 'candidate@planet.org',
          intendedRole: invalidRole as AdminRole,
        }),
        'INVALID_INTENDED_ROLE'
      );
    }

    await expectPersistenceError(
      service.createPendingInvitation({
        authenticatedCallerUid: ACTIVE_OWNER.id,
        targetEmail: 'invalid-email-address',
        intendedRole: AdminRole.Viewer,
      }),
      'INVALID_TARGET_EMAIL'
    );

    expect(store.collections[ADMIN_INVITATIONS_COLLECTION].size).toBe(0);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('5. Atomically accepts a valid Pending invitation, creates admins/{uid}, updates invitation, and writes InvitationAccepted audit event without merge', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-new-curator-1',
          email: 'curator@planet.org',
          emailVerified: true,
          displayName: 'Rami Curator',
          disabled: false,
        },
      ],
      store
    );

    let currentClockMs = BASE_TIME_MS;
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: () => new Date(currentClockMs),
    });

    const created = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'Curator@Planet.org',
      intendedRole: AdminRole.LibraryCurator,
    });

    currentClockMs = BASE_TIME_MS + 120_000;

    const acceptedResult = await service.acceptPendingInvitation({
      authenticatedCallerUid: 'uid-new-curator-1',
      invitationId: created.invitation.invitationId,
      expectedRevision: 1,
    });

    // 1. Invitation transitioned to Accepted with revision 2
    expect(acceptedResult.invitation.status).toBe(
      AdminInvitationStatus.Accepted
    );
    expect(acceptedResult.invitation.revision).toBe(2);
    expect(acceptedResult.invitation.targetUid).toBe('uid-new-curator-1');
    expect(acceptedResult.invitation.acceptedByUid).toBe('uid-new-curator-1');
    expect(acceptedResult.invitation.acceptedAtIso).toBe(
      new Date(currentClockMs).toISOString()
    );

    // 2. Canonical admin record created at admins/uid-new-curator-1
    expect(acceptedResult.activatedAdmin).toEqual({
      id: 'uid-new-curator-1',
      name: 'Rami Curator',
      email: 'curator@planet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
    });

    const persistedNewAdmin =
      store.collections[ADMINS_COLLECTION].get('uid-new-curator-1');
    expect(persistedNewAdmin).toBeDefined();
    expect(persistedNewAdmin?.id).toBe('uid-new-curator-1');
    expect(persistedNewAdmin?.role).toBe(AdminRole.LibraryCurator);
    expect(persistedNewAdmin?.isActive).toBe(true);
    expect(persistedNewAdmin?.revision).toBe(1);
    expect(persistedNewAdmin?.provisionedViaInvitationId).toBe(
      created.invitation.invitationId
    );

    // 3. Existing Owner record preserved untouched
    const persistedOwner = store.collections[ADMINS_COLLECTION].get(
      ACTIVE_OWNER.id
    );
    expect(persistedOwner).toEqual({
      id: ACTIVE_OWNER.id,
      name: ACTIVE_OWNER.name,
      email: ACTIVE_OWNER.email,
      role: AdminRole.Owner,
      isActive: true,
    });

    // 4. Durable InvitationAccepted audit event written
    expect(acceptedResult.auditEvent.eventType).toBe('InvitationAccepted');
    expect(acceptedResult.auditEvent.actorUserId).toBe('uid-new-curator-1');
    expect(acceptedResult.auditEvent.targetId).toBe('uid-new-curator-1');
    expect(acceptedResult.auditEvent.invitationId).toBe(
      created.invitation.invitationId
    );
    expect(acceptedResult.auditEvent.invitationRevision).toBe(2);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(2);

    // 5. Verify no { merge: true } options were ever passed to tx.set, and zero Auth calls occurred inside transactions
    expect(store.setOperationCalls.every((c) => c.optionsPassed === 0)).toBe(
      true
    );
    expect(authAuthority.callsDuringTransaction).toBe(0);
  });

  it('6. Rejects double acceptance and concurrent revision conflicts without creating duplicate admin or audit records', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-editor-new',
          email: 'editor@planet.org',
          emailVerified: true,
          displayName: 'Layla Editor',
          disabled: false,
        },
      ],
      store
    );

    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_MS + 10_000),
    });

    const created = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'editor@planet.org',
      intendedRole: AdminRole.ContentEditor,
    });

    await service.acceptPendingInvitation({
      authenticatedCallerUid: 'uid-editor-new',
      invitationId: created.invitation.invitationId,
      expectedRevision: 1,
    });

    // Second acceptance without expectedRevision -> INVITATION_ALREADY_ACCEPTED
    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-editor-new',
        invitationId: created.invitation.invitationId,
      }),
      'INVITATION_ALREADY_ACCEPTED'
    );

    // Concurrent acceptance with stale expectedRevision: 1 -> CONCURRENT_MODIFICATION_CONFLICT
    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-editor-new',
        invitationId: created.invitation.invitationId,
        expectedRevision: 1,
      }),
      'CONCURRENT_MODIFICATION_CONFLICT'
    );

    // Exactly 2 admins (Owner + 1 new editor) and 2 audit events (1 Created + 1 Accepted)
    expect(store.collections[ADMINS_COLLECTION].size).toBe(2);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(2);
  });

  it('7. Atomically revokes a Pending invitation, writes InvitationRevoked audit event, leaves admins/{uid} untouched, and blocks subsequent acceptance', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-trainer-candidate',
          email: 'trainer@planet.org',
          emailVerified: true,
          displayName: 'Omar Trainer',
          disabled: false,
        },
      ],
      store
    );

    let currentClockMs = BASE_TIME_MS;
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: () => new Date(currentClockMs),
    });

    const created = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'trainer@planet.org',
      intendedRole: AdminRole.Trainer,
    });

    currentClockMs = BASE_TIME_MS + 60_000;

    const revoked = await service.revokePendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      invitationId: created.invitation.invitationId,
      expectedRevision: 1,
    });

    expect(revoked.invitation.status).toBe(AdminInvitationStatus.Revoked);
    expect(revoked.invitation.revokedByOwnerUid).toBe(ACTIVE_OWNER.id);
    expect(revoked.invitation.revision).toBe(2);
    expect(revoked.auditEvent.eventType).toBe('InvitationRevoked');

    // Cannot revoke again
    await expectPersistenceError(
      service.revokePendingInvitation({
        authenticatedCallerUid: ACTIVE_OWNER.id,
        invitationId: created.invitation.invitationId,
      }),
      'INVALID_STATE_TRANSITION'
    );

    // Candidate cannot accept revoked invitation
    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-trainer-candidate',
        invitationId: created.invitation.invitationId,
      }),
      'INVITATION_REVOKED'
    );

    expect(
      store.collections[ADMINS_COLLECTION].has('uid-trainer-candidate')
    ).toBe(false);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(2);
  });

  it('8. Enforces server-clock expiration and blocks acceptance of logically expired invitations', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-late-candidate',
          email: 'late@planet.org',
          emailVerified: true,
          displayName: 'Late Candidate',
          disabled: false,
        },
      ],
      store
    );

    let currentClockMs = BASE_TIME_MS;
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: () => new Date(currentClockMs),
    });

    const created = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'late@planet.org',
      intendedRole: AdminRole.Viewer,
    });

    expect(
      isInvitationLogicallyExpired(created.invitation, () => new Date(currentClockMs))
    ).toBe(false);

    // Advance server clock to exact expiration instant
    currentClockMs = BASE_TIME_MS + DEFAULT_ADMIN_INVITATION_TTL_MS;

    expect(
      isInvitationLogicallyExpired(created.invitation, () => new Date(currentClockMs))
    ).toBe(true);

    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-late-candidate',
        invitationId: created.invitation.invitationId,
      }),
      'INVITATION_EXPIRED'
    );

    expect(
      store.collections[ADMINS_COLLECTION].has('uid-late-candidate')
    ).toBe(false);
  });

  it('9. Rejects acceptance when Firebase Auth authority reports emailVerified === false even if client payload claims emailVerified === true', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-unverified-user',
          email: 'unverified@planet.org',
          emailVerified: false, // Server Auth truth
          displayName: 'Unverified User',
          disabled: false,
        },
      ],
      store
    );

    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_MS + 5_000),
    });

    const created = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'unverified@planet.org',
      intendedRole: AdminRole.CitizenModerator,
    });

    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-unverified-user',
        invitationId: created.invitation.invitationId,
        untrustedClientPayload: {
          emailVerified: true, // Spoofed client claim
        },
      }),
      'UNVERIFIED_TARGET_EMAIL'
    );

    expect(
      store.collections[ADMINS_COLLECTION].has('uid-unverified-user')
    ).toBe(false);
  });

  it('10. Rejects cross-user acceptance attempts (email mismatch or pre-bound targetUid mismatch)', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-bound-target',
          email: 'bound@planet.org',
          emailVerified: true,
          displayName: 'Bound Target',
          disabled: false,
        },
        {
          uid: 'uid-other-person',
          email: 'other@planet.org',
          emailVerified: true,
          displayName: 'Other Person',
          disabled: false,
        },
      ],
      store
    );

    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_MS + 5_000),
    });

    const created = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'bound@planet.org',
      targetUid: 'uid-bound-target',
      intendedRole: AdminRole.RightsReviewer,
    });

    // Different authenticated user with different email -> EMAIL_MISMATCH
    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-other-person',
        invitationId: created.invitation.invitationId,
      }),
      'EMAIL_MISMATCH'
    );

    // Even if another UID somehow had the same email in Auth, targetUid binding blocks acceptance -> IDENTITY_MISMATCH
    const collisionAuth = createFakeAuthAuthority(
      [
        {
          uid: 'uid-impersonator',
          email: 'bound@planet.org',
          emailVerified: true,
          displayName: 'Impersonator',
          disabled: false,
        },
      ],
      store
    );
    const collisionService = new AdminInvitationApplicationService({
      repository,
      authAuthority: collisionAuth,
      clock: fixedClock(BASE_TIME_MS + 5_000),
    });

    await expectPersistenceError(
      collisionService.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-impersonator',
        invitationId: created.invitation.invitationId,
      }),
      'IDENTITY_MISMATCH'
    );

    expect(store.collections[ADMINS_COLLECTION].size).toBe(1);
  });

  it('11. Fails closed on existing admin conflicts during both creation and acceptance without overwriting existing admin roles', async () => {
    const existingRightsReviewer: AdminUser = {
      id: 'uid-existing-rights',
      name: 'Salma Rights',
      email: 'salma@planet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    };

    const store = createTransactionalFirestoreFake([
      ACTIVE_OWNER,
      existingRightsReviewer,
    ]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: existingRightsReviewer.id,
          email: existingRightsReviewer.email,
          emailVerified: true,
          displayName: existingRightsReviewer.name,
          disabled: false,
        },
        {
          uid: 'uid-promoted-before-accept',
          email: 'promoted@planet.org',
          emailVerified: true,
          displayName: 'Promoted User',
          disabled: false,
        },
      ],
      store
    );

    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_MS + 5_000),
    });

    // 1. Creation conflict when existing admin is resolved by email via Auth authority
    await expectPersistenceError(
      service.createPendingInvitation({
        authenticatedCallerUid: ACTIVE_OWNER.id,
        targetEmail: existingRightsReviewer.email,
        intendedRole: AdminRole.Viewer,
      }),
      'EXISTING_ADMIN_CONFLICT'
    );

    // 2. Acceptance conflict when admins/{uid} was created after the invitation was issued
    const createdForNewUser = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'promoted@planet.org',
      intendedRole: AdminRole.Viewer,
    });

    // Simulate user already having an admins/{uid} record with TrainingManager role before accepting
    store.collections[ADMINS_COLLECTION].set('uid-promoted-before-accept', {
      id: 'uid-promoted-before-accept',
      name: 'Promoted User',
      email: 'promoted@planet.org',
      role: AdminRole.TrainingManager,
      isActive: true,
    });

    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-promoted-before-accept',
        invitationId: createdForNewUser.invitation.invitationId,
      }),
      'EXISTING_ADMIN_CONFLICT'
    );

    // Existing TrainingManager role was NOT overwritten to Viewer
    expect(
      store.collections[ADMINS_COLLECTION].get('uid-promoted-before-accept')
        ?.role
    ).toBe(AdminRole.TrainingManager);
  });

  it('12. Enforces Section 6 Owner role safety: fails closed on activating invitations with intendedRole === Owner', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-co-owner-candidate',
          email: 'coowner@planet.org',
          emailVerified: true,
          displayName: 'Co-Owner Candidate',
          disabled: false,
        },
      ],
      store
    );

    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_MS + 5_000),
    });

    // Creating an Owner invitation without explicit grant fails closed
    await expectPersistenceError(
      service.createPendingInvitation({
        authenticatedCallerUid: ACTIVE_OWNER.id,
        targetEmail: 'coowner@planet.org',
        intendedRole: AdminRole.Owner,
      }),
      'OWNER_ROLE_ASSIGNMENT_REQUIRES_EXPLICIT_AUTHORIZATION'
    );

    // Even when a Pending Owner invitation exists (created with explicitOwnerRoleGrant),
    // acceptance fails closed with OWNER_ACTIVATION_FORBIDDEN in AUTH-03B2
    const ownerInvitation = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'coowner@planet.org',
      intendedRole: AdminRole.Owner,
      explicitOwnerRoleGrant: {
        confirmedOwnerRoleGrant: true,
        authorizingOwnerUid: ACTIVE_OWNER.id,
      },
    });

    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-co-owner-candidate',
        invitationId: ownerInvitation.invitation.invitationId,
      }),
      'OWNER_ACTIVATION_FORBIDDEN'
    );

    // No additional Owner activated; existing Owner preserved
    expect(store.collections[ADMINS_COLLECTION].size).toBe(1);
    expect(
      store.collections[ADMINS_COLLECTION].has('uid-co-owner-candidate')
    ).toBe(false);
  });

  it('13. Rejects client payload spoofing of UID, role, or Owner authority during creation and acceptance', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-viewer-candidate',
          email: 'viewer@planet.org',
          emailVerified: true,
          displayName: 'Viewer Candidate',
          disabled: false,
        },
      ],
      store
    );

    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_MS + 5_000),
    });

    // Spoofed callerUid in createPendingInvitation
    await expectPersistenceError(
      service.createPendingInvitation({
        authenticatedCallerUid: ACTIVE_OWNER.id,
        targetEmail: 'viewer@planet.org',
        intendedRole: AdminRole.Viewer,
        untrustedClientPayload: {
          callerUid: 'uid-someone-else',
        },
      }),
      'IDENTITY_MISMATCH'
    );

    const created = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'viewer@planet.org',
      intendedRole: AdminRole.Viewer,
    });

    // Spoofed role escalation in acceptPendingInvitation
    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-viewer-candidate',
        invitationId: created.invitation.invitationId,
        untrustedClientPayload: {
          role: AdminRole.Owner,
        },
      }),
      'IDENTITY_MISMATCH'
    );

    // Spoofed UID in acceptPendingInvitation
    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-viewer-candidate',
        invitationId: created.invitation.invitationId,
        untrustedClientPayload: {
          uid: 'uid-owner-1',
        },
      }),
      'IDENTITY_MISMATCH'
    );
  });

  it('14. Rolls back all staged writes atomically if transaction fails mid-flight (no partial admin activation or orphan audit event)', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority(
      [
        {
          uid: 'uid-rollback-candidate',
          email: 'rollback@planet.org',
          emailVerified: true,
          displayName: 'Rollback Candidate',
          disabled: false,
        },
      ],
      store
    );

    const repository = new FirestoreAdminInvitationRepository(store.db);
    const service = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_MS + 5_000),
    });

    const created = await service.createPendingInvitation({
      authenticatedCallerUid: ACTIVE_OWNER.id,
      targetEmail: 'rollback@planet.org',
      intendedRole: AdminRole.ContentEditor,
    });

    // Simulate failure when writing the InvitationAccepted audit event
    store.failOnCollectionCreate = ADMIN_AUDIT_LOGS_COLLECTION;

    await expectPersistenceError(
      service.acceptPendingInvitation({
        authenticatedCallerUid: 'uid-rollback-candidate',
        invitationId: created.invitation.invitationId,
      }),
      'PERSISTENCE_FAILURE'
    );

    // Verify neither admins/uid-rollback-candidate nor Accepted status was committed
    expect(
      store.collections[ADMINS_COLLECTION].has('uid-rollback-candidate')
    ).toBe(false);
    const storedAfterFailure = await service.getInvitationById(
      created.invitation.invitationId
    );
    expect(storedAfterFailure?.status).toBe(AdminInvitationStatus.Pending);
    expect(storedAfterFailure?.revision).toBe(1);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(1);
  });

  it('15. Generates cryptographically random locator IDs and rejects sequential/timestamp IDs', async () => {
    const invId1 = generateCryptographicInvitationId();
    const invId2 = generateCryptographicInvitationId();
    const audId1 = generateCryptographicAuditEventId();

    expect(invId1).toMatch(/^inv_[0-9a-f]{32}$/);
    expect(invId2).toMatch(/^inv_[0-9a-f]{32}$/);
    expect(invId1).not.toBe(invId2);
    expect(audId1).toMatch(/^aud_inv_[0-9a-f]{32}$/);

    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const authAuthority = createFakeAuthAuthority([], store);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const weakIdService = new AdminInvitationApplicationService({
      repository,
      authAuthority,
      clock: fixedClock(BASE_TIME_ISO),
      generateInvitationId: () => 'inv_1730000000000', // weak numeric/timestamp ID
    });

    await expectPersistenceError(
      weakIdService.createPendingInvitation({
        authenticatedCallerUid: ACTIVE_OWNER.id,
        targetEmail: 'candidate@planet.org',
        intendedRole: AdminRole.Viewer,
      }),
      'UNTRUSTED_ID_GENERATOR'
    );
  });
});
