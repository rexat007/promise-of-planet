import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    public readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
      this.code = code;
    }
  },
}));

import { HttpsError } from 'firebase-functions/v2/https';
import { AdminRole, type AdminUser } from '../types/admin';
import {
  AdminInvitationStatus,
  DEFAULT_ADMIN_INVITATION_TTL_MS,
} from './adminInvitationContract';
import {
  ADMINS_COLLECTION,
  ADMIN_AUDIT_LOGS_COLLECTION,
  ADMIN_INVITATIONS_COLLECTION,
} from './adminInvitationRepository';
import {
  FirestoreAdminInvitationRepository,
  type AdminInvitationFirestoreDatabase,
  type AdminInvitationFirestoreDocumentRef,
  type AdminInvitationFirestoreDocumentSnapshot,
  type AdminInvitationFirestoreTransaction,
} from './firestoreAdminInvitationRepository';
import {
  type AdminInvitationAuthAuthority,
  type TrustedFirebaseAuthUserRecord,
} from './adminInvitationApplicationService';
import {
  executeManageAdminInvitations,
  manageAdminInvitations,
  type AcceptAdminInvitationCallableResponse,
  type CreateAdminInvitationCallableResponse,
  type RevokeAdminInvitationCallableResponse,
} from './adminInvitationHandlers';

const BASE_TIME_ISO = '2026-10-26T10:00:00.000Z';
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

  const store: TransactionalFakeStore = {
    collections,
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
            data: Record<string, unknown>
          ) {
            const colName =
              (docRef as unknown as { __collectionName: string })
                .__collectionName ?? '';
            stagedWrites.push({
              op: 'set',
              collectionName: colName,
              docId: docRef.id,
              data: cloneRecord(data),
            });
            return tx;
          },
        };

        const result = await updateFunction(tx);

        for (const write of stagedWrites) {
          if (
            write.op === 'create' &&
            store.failOnCollectionCreate === write.collectionName
          ) {
            throw new Error(
              `Simulated commit failure on ${write.collectionName}/${write.docId}`
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
      },
    },
  };

  return store;
}

function createFakeAuthAuthority(
  users: ReadonlyArray<TrustedFirebaseAuthUserRecord> = []
): AdminInvitationAuthAuthority {
  const byUid = new Map<string, TrustedFirebaseAuthUserRecord>();
  const byEmail = new Map<string, TrustedFirebaseAuthUserRecord>();

  for (const u of users) {
    byUid.set(u.uid, u);
    if (u.email) {
      byEmail.set(u.email.trim().toLowerCase(), u);
    }
  }

  return {
    async getUserByUid(
      uid: string
    ): Promise<TrustedFirebaseAuthUserRecord | null> {
      return byUid.get(uid.trim()) ?? null;
    },
    async getUserByEmail(
      email: string
    ): Promise<TrustedFirebaseAuthUserRecord | null> {
      return byEmail.get(email.trim().toLowerCase()) ?? null;
    },
  };
}

async function expectHttpsErrorCode(
  promise: Promise<unknown>,
  expectedCode: HttpsError['code']
): Promise<HttpsError> {
  try {
    await promise;
    throw new Error(
      `Expected HttpsError(${expectedCode}), but promise resolved.`
    );
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(HttpsError);
    const httpsErr = err as HttpsError;
    expect(httpsErr.code).toBe(expectedCode);
    // Ensure error message never leaks Firestore collection paths or stack traces
    expect(httpsErr.message).not.toMatch(/admin_invitations\/|admins\/|audit_logs\//);
    return httpsErr;
  }
}

describe('AUTH-03B3 Secure Administrative Invitation Callable Boundary (manageAdminInvitations)', () => {
  it('1. Active Owner creates a Pending invitation via createInvitation', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority();

    const response = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: '  Salma.Rights@Planet.org ',
          intendedRole: AdminRole.RightsReviewer,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    expect(response.invitation.invitationId).toMatch(/^inv_[0-9a-f]{32}$/);
    expect(response.invitation.status).toBe(AdminInvitationStatus.Pending);
    expect(response.invitation.normalizedTargetEmail).toBe(
      'salma.rights@planet.org'
    );
    expect(response.invitation.intendedRole).toBe(AdminRole.RightsReviewer);
    expect(response.invitation.invitingOwnerUid).toBe(ACTIVE_OWNER.id);
    expect(response.invitation.revision).toBe(1);
    expect(response.auditEventId).toMatch(/^aud_inv_[0-9a-f]{32}$/);
  });

  it('2. Inactive Owner is denied with permission-denied', async () => {
    const inactiveOwner: AdminUser = {
      id: 'uid-inactive-owner',
      name: 'Suspended Owner',
      email: 'suspended@planet.org',
      role: AdminRole.Owner,
      isActive: false,
    };
    const store = createTransactionalFirestoreFake([inactiveOwner]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: inactiveOwner.id },
          data: {
            action: 'createInvitation',
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.ContentEditor,
          },
        },
        {
          repository,
          authAuthority: createFakeAuthAuthority(),
          clock: fixedClock(BASE_TIME_ISO),
        }
      ),
      'permission-denied'
    );
  });

  it('3. Active ContentEditor is denied invitation creation with permission-denied', async () => {
    const contentEditor: AdminUser = {
      id: 'uid-content-editor',
      name: 'Layla Editor',
      email: 'layla@planet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };
    const store = createTransactionalFirestoreFake([
      ACTIVE_OWNER,
      contentEditor,
    ]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: contentEditor.id },
          data: {
            action: 'createInvitation',
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.Viewer,
          },
        },
        {
          repository,
          authAuthority: createFakeAuthAuthority(),
          clock: fixedClock(BASE_TIME_ISO),
        }
      ),
      'permission-denied'
    );
  });

  it('4. Active RightsReviewer is denied invitation creation with permission-denied', async () => {
    const rightsReviewer: AdminUser = {
      id: 'uid-rights-reviewer',
      name: 'Salma Rights',
      email: 'salma@planet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    };
    const store = createTransactionalFirestoreFake([
      ACTIVE_OWNER,
      rightsReviewer,
    ]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: rightsReviewer.id },
          data: {
            action: 'createInvitation',
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.Viewer,
          },
        },
        {
          repository,
          authAuthority: createFakeAuthAuthority(),
          clock: fixedClock(BASE_TIME_ISO),
        }
      ),
      'permission-denied'
    );
  });

  it('5. Unauthenticated creation request is denied with unauthenticated', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: undefined,
          data: {
            action: 'createInvitation',
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.Viewer,
          },
        },
        {
          repository,
          authAuthority: createFakeAuthAuthority(),
          clock: fixedClock(BASE_TIME_ISO),
        }
      ),
      'unauthenticated'
    );
  });

  it('6. Forged Owner claims in request.data or auth.token are denied with permission-denied', async () => {
    const viewerAdmin: AdminUser = {
      id: 'uid-viewer-1',
      name: 'Sami Viewer',
      email: 'sami@planet.org',
      role: AdminRole.Viewer,
      isActive: true,
    };
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER, viewerAdmin]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    // 1. Forged callerUid / isOwner / permissions in request.data
    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: viewerAdmin.id },
          data: {
            action: 'createInvitation',
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.Viewer,
            callerUid: ACTIVE_OWNER.id,
            isOwner: true,
            permissions: ['manageUsers'],
          },
        },
        {
          repository,
          authAuthority: createFakeAuthAuthority(),
          clock: fixedClock(BASE_TIME_ISO),
        }
      ),
      'permission-denied'
    );

    // 2. Forged auth.token custom claims with clean payload
    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: {
            uid: viewerAdmin.id,
            token: {
              role: AdminRole.Owner,
              isOwner: true,
              permissions: ['manageUsers'],
            },
          },
          data: {
            action: 'createInvitation',
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.Viewer,
          },
        },
        {
          repository,
          authAuthority: createFakeAuthAuthority(),
          clock: fixedClock(BASE_TIME_ISO),
        }
      ),
      'permission-denied'
    );
  });

  it('7. Invalid or non-canonical role is denied with invalid-argument', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    for (const badRole of [
      'SuperAdmin',
      'Admin',
      'ManagingEditor',
      'Editor',
      'Writer',
      'UnknownRole',
    ]) {
      await expectHttpsErrorCode(
        executeManageAdminInvitations(
          {
            auth: { uid: ACTIVE_OWNER.id },
            data: {
              action: 'createInvitation',
              targetEmail: 'candidate@planet.org',
              intendedRole: badRole,
            },
          },
          {
            repository,
            authAuthority: createFakeAuthAuthority(),
            clock: fixedClock(BASE_TIME_ISO),
          }
        ),
        'invalid-argument'
      );
    }
  });

  it('8. Owner activation is forbidden even when an Owner-role invitation exists', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: 'uid-co-owner-candidate',
        email: 'coowner@planet.org',
        emailVerified: true,
        displayName: 'Co-Owner Candidate',
        disabled: false,
      },
    ]);

    // Creating an Owner invitation without explicit grant fails with permission-denied
    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: ACTIVE_OWNER.id },
          data: {
            action: 'createInvitation',
            targetEmail: 'coowner@planet.org',
            intendedRole: AdminRole.Owner,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_ISO),
        }
      ),
      'permission-denied'
    );

    // Even if created with explicitOwnerRoleGrant, accepting it to activate an Owner is forbidden
    const createdOwnerInvite = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'coowner@planet.org',
          intendedRole: AdminRole.Owner,
          explicitOwnerRoleGrant: {
            confirmedOwnerRoleGrant: true,
            authorizingOwnerUid: ACTIVE_OWNER.id,
          },
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: 'uid-co-owner-candidate' },
          data: {
            action: 'acceptInvitation',
            invitationId: createdOwnerInvite.invitation.invitationId,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_MS + 10_000),
        }
      ),
      'permission-denied'
    );

    expect(
      store.collections[ADMINS_COLLECTION].has('uid-co-owner-candidate')
    ).toBe(false);
  });

  it('9. Invitation creation does not create any admins/{uid} records', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'pending.only@planet.org',
          intendedRole: AdminRole.LibraryCurator,
        },
      },
      {
        repository,
        authAuthority: createFakeAuthAuthority(),
        clock: fixedClock(BASE_TIME_ISO),
      }
    );

    expect(store.collections[ADMINS_COLLECTION].size).toBe(1);
    expect(store.collections[ADMINS_COLLECTION].has(ACTIVE_OWNER.id)).toBe(
      true
    );
  });

  it('10. Active Owner revokes a Pending invitation via revokeInvitation', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    let currentClockMs = BASE_TIME_MS;

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'revoke.me@planet.org',
          intendedRole: AdminRole.Trainer,
        },
      },
      {
        repository,
        authAuthority: createFakeAuthAuthority(),
        clock: () => new Date(currentClockMs),
      }
    )) as CreateAdminInvitationCallableResponse;

    currentClockMs = BASE_TIME_MS + 30_000;

    const revoked = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'revokeInvitation',
          invitationId: created.invitation.invitationId,
          expectedRevision: 1,
        },
      },
      {
        repository,
        authAuthority: createFakeAuthAuthority(),
        clock: () => new Date(currentClockMs),
      }
    )) as RevokeAdminInvitationCallableResponse;

    expect(revoked.invitation.status).toBe(AdminInvitationStatus.Revoked);
    expect(revoked.invitation.revokedByOwnerUid).toBe(ACTIVE_OWNER.id);
    expect(revoked.invitation.revision).toBe(2);
    expect(store.collections[ADMINS_COLLECTION].size).toBe(1);
  });

  it('11. Non-Owner revocation is denied with permission-denied', async () => {
    const editor: AdminUser = {
      id: 'uid-editor-1',
      name: 'Editor One',
      email: 'editor1@planet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER, editor]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'candidate@planet.org',
          intendedRole: AdminRole.Viewer,
        },
      },
      {
        repository,
        authAuthority: createFakeAuthAuthority(),
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: editor.id },
          data: {
            action: 'revokeInvitation',
            invitationId: created.invitation.invitationId,
          },
        },
        {
          repository,
          authAuthority: createFakeAuthAuthority(),
          clock: fixedClock(BASE_TIME_MS + 10_000),
        }
      ),
      'permission-denied'
    );
  });

  it('12. Revoking an already revoked, expired, or previously accepted invitation is denied with failed-precondition', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: 'uid-acceptor-1',
        email: 'accepted@planet.org',
        emailVerified: true,
        displayName: 'Accepted User',
        disabled: false,
      },
    ]);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'accepted@planet.org',
          intendedRole: AdminRole.Viewer,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    await executeManageAdminInvitations(
      {
        auth: { uid: 'uid-acceptor-1' },
        data: {
          action: 'acceptInvitation',
          invitationId: created.invitation.invitationId,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_MS + 10_000),
      }
    );

    // Attempting to revoke an already accepted invitation -> failed-precondition
    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: ACTIVE_OWNER.id },
          data: {
            action: 'revokeInvitation',
            invitationId: created.invitation.invitationId,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_MS + 20_000),
        }
      ),
      'failed-precondition'
    );
  });

  it('13. Authenticated user with verified matching email accepts a Pending invitation and activates canonical admin', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: 'uid-verified-curator',
        email: 'curator@planet.org',
        emailVerified: true,
        displayName: 'Amina Curator',
        disabled: false,
      },
    ]);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'curator@planet.org',
          intendedRole: AdminRole.LibraryCurator,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    const accepted = (await executeManageAdminInvitations(
      {
        auth: { uid: 'uid-verified-curator' },
        data: {
          action: 'acceptInvitation',
          invitationId: created.invitation.invitationId,
          expectedRevision: 1,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_MS + 15_000),
      }
    )) as AcceptAdminInvitationCallableResponse;

    expect(accepted.invitation.status).toBe(AdminInvitationStatus.Accepted);
    expect(accepted.invitation.targetUid).toBe('uid-verified-curator');
    expect(accepted.invitation.acceptedByUid).toBe('uid-verified-curator');
    expect(accepted.invitation.revision).toBe(2);
    expect(accepted.admin).toEqual({
      id: 'uid-verified-curator',
      name: 'Amina Curator',
      email: 'curator@planet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
    });
  });

  it('14. Wrong Firebase UID is denied with permission-denied for a UID-bound invitation', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const createAuth = createFakeAuthAuthority([
      {
        uid: 'uid-intended-target',
        email: 'target@planet.org',
        emailVerified: true,
        displayName: 'Intended Target',
        disabled: false,
      },
    ]);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'target@planet.org',
          targetUid: 'uid-intended-target',
          intendedRole: AdminRole.RightsReviewer,
        },
      },
      {
        repository,
        authAuthority: createAuth,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    // Different UID attempting to accept
    const wrongUidAuth = createFakeAuthAuthority([
      {
        uid: 'uid-wrong-caller',
        email: 'target@planet.org',
        emailVerified: true,
        displayName: 'Wrong Caller',
        disabled: false,
      },
    ]);

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: 'uid-wrong-caller' },
          data: {
            action: 'acceptInvitation',
            invitationId: created.invitation.invitationId,
          },
        },
        {
          repository,
          authAuthority: wrongUidAuth,
          clock: fixedClock(BASE_TIME_MS + 10_000),
        }
      ),
      'permission-denied'
    );
  });

  it('15. Unverified email in Firebase Auth is denied with failed-precondition', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: 'uid-unverified-1',
        email: 'unverified@planet.org',
        emailVerified: false,
        displayName: 'Unverified Candidate',
        disabled: false,
      },
    ]);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'unverified@planet.org',
          intendedRole: AdminRole.Viewer,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: 'uid-unverified-1' },
          data: {
            action: 'acceptInvitation',
            invitationId: created.invitation.invitationId,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_MS + 10_000),
        }
      ),
      'failed-precondition'
    );
  });

  it('16. Client-side spoofed verification, email, or role claims in acceptInvitation are denied with permission-denied', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: 'uid-spoofing-acceptor',
        email: 'spoof@planet.org',
        emailVerified: false,
        displayName: 'Spoofing Acceptor',
        disabled: false,
      },
    ]);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'spoof@planet.org',
          intendedRole: AdminRole.Viewer,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: 'uid-spoofing-acceptor' },
          data: {
            action: 'acceptInvitation',
            invitationId: created.invitation.invitationId,
            emailVerified: true,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_MS + 10_000),
        }
      ),
      'permission-denied'
    );

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: 'uid-spoofing-acceptor' },
          data: {
            action: 'acceptInvitation',
            invitationId: created.invitation.invitationId,
            email: 'spoof@planet.org',
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_MS + 10_000),
        }
      ),
      'permission-denied'
    );

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: 'uid-spoofing-acceptor' },
          data: {
            action: 'acceptInvitation',
            invitationId: created.invitation.invitationId,
            role: AdminRole.Owner,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_MS + 10_000),
        }
      ),
      'permission-denied'
    );
  });

  it('17. Existing admin target is rejected with failed-precondition without overwriting existing role', async () => {
    const existingAdmin: AdminUser = {
      id: 'uid-existing-admin',
      name: 'Existing RightsReviewer',
      email: 'existing@planet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    };
    const store = createTransactionalFirestoreFake([
      ACTIVE_OWNER,
      existingAdmin,
    ]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: existingAdmin.id,
        email: existingAdmin.email,
        emailVerified: true,
        displayName: existingAdmin.name,
        disabled: false,
      },
    ]);

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: ACTIVE_OWNER.id },
          data: {
            action: 'createInvitation',
            targetEmail: existingAdmin.email,
            intendedRole: AdminRole.Viewer,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_ISO),
        }
      ),
      'failed-precondition'
    );

    expect(
      store.collections[ADMINS_COLLECTION].get(existingAdmin.id)?.role
    ).toBe(AdminRole.RightsReviewer);
  });

  it('18. Concurrent or repeated acceptance preserves single-use and rejects second attempt with failed-precondition', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: 'uid-single-use-user',
        email: 'singleuse@planet.org',
        emailVerified: true,
        displayName: 'Single Use User',
        disabled: false,
      },
    ]);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'singleuse@planet.org',
          intendedRole: AdminRole.ContentEditor,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    await executeManageAdminInvitations(
      {
        auth: { uid: 'uid-single-use-user' },
        data: {
          action: 'acceptInvitation',
          invitationId: created.invitation.invitationId,
          expectedRevision: 1,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_MS + 10_000),
      }
    );

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: 'uid-single-use-user' },
          data: {
            action: 'acceptInvitation',
            invitationId: created.invitation.invitationId,
            expectedRevision: 1,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_MS + 15_000),
        }
      ),
      'failed-precondition'
    );

    expect(store.collections[ADMINS_COLLECTION].size).toBe(2);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(2);
  });

  it('19. Transaction failure returns internal HttpsError with no false success or partial activation', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: 'uid-tx-fail-user',
        email: 'txfail@planet.org',
        emailVerified: true,
        displayName: 'Tx Fail User',
        disabled: false,
      },
    ]);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'txfail@planet.org',
          intendedRole: AdminRole.ContentEditor,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    store.failOnCollectionCreate = ADMIN_AUDIT_LOGS_COLLECTION;

    await expectHttpsErrorCode(
      executeManageAdminInvitations(
        {
          auth: { uid: 'uid-tx-fail-user' },
          data: {
            action: 'acceptInvitation',
            invitationId: created.invitation.invitationId,
          },
        },
        {
          repository,
          authAuthority,
          clock: fixedClock(BASE_TIME_MS + 10_000),
        }
      ),
      'internal'
    );

    expect(store.collections[ADMINS_COLLECTION].has('uid-tx-fail-user')).toBe(
      false
    );
    expect(
      store.collections[ADMIN_INVITATIONS_COLLECTION].get(
        created.invitation.invitationId
      )?.status
    ).toBe(AdminInvitationStatus.Pending);
  });

  it('20. Rejects invalid or unknown actions and malformed payloads with invalid-argument', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);

    for (const invalidData of [
      null,
      undefined,
      [],
      {},
      { action: 'listInvitations' },
      { action: 'deleteInvitation' },
      {
        action: 'createInvitation',
        targetEmail: 'valid@planet.org',
        intendedRole: AdminRole.Viewer,
        unexpectedExtraField: 'not-allowed',
      },
    ]) {
      await expectHttpsErrorCode(
        executeManageAdminInvitations(
          {
            auth: { uid: ACTIVE_OWNER.id },
            data: invalidData,
          },
          {
            repository,
            authAuthority: createFakeAuthAuthority(),
            clock: fixedClock(BASE_TIME_ISO),
          }
        ),
        'invalid-argument'
      );
    }
  });

  it('21. Callable responses contain strictly sanitized DTO fields and zero secrets or tokens', async () => {
    const store = createTransactionalFirestoreFake([ACTIVE_OWNER]);
    const repository = new FirestoreAdminInvitationRepository(store.db);
    const authAuthority = createFakeAuthAuthority([
      {
        uid: 'uid-clean-acceptor',
        email: 'clean@planet.org',
        emailVerified: true,
        displayName: 'Clean Acceptor',
        disabled: false,
      },
    ]);

    const created = (await executeManageAdminInvitations(
      {
        auth: { uid: ACTIVE_OWNER.id },
        data: {
          action: 'createInvitation',
          targetEmail: 'clean@planet.org',
          intendedRole: AdminRole.TrainingManager,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_ISO),
      }
    )) as CreateAdminInvitationCallableResponse;

    expect(Object.keys(created).sort()).toEqual(['auditEventId', 'invitation']);
    expect(Object.keys(created.invitation).sort()).toEqual([
      'acceptedAtIso',
      'acceptedByUid',
      'createdAtIso',
      'expiredAtIso',
      'expiresAtIso',
      'intendedRole',
      'invitationId',
      'invitingOwnerUid',
      'normalizedTargetEmail',
      'revision',
      'revokedAtIso',
      'revokedByOwnerUid',
      'status',
      'targetUid',
    ]);

    const accepted = (await executeManageAdminInvitations(
      {
        auth: { uid: 'uid-clean-acceptor' },
        data: {
          action: 'acceptInvitation',
          invitationId: created.invitation.invitationId,
        },
      },
      {
        repository,
        authAuthority,
        clock: fixedClock(BASE_TIME_MS + DEFAULT_ADMIN_INVITATION_TTL_MS - 5000),
      }
    )) as AcceptAdminInvitationCallableResponse;

    expect(Object.keys(accepted).sort()).toEqual([
      'admin',
      'auditEventId',
      'invitation',
    ]);
    expect(Object.keys(accepted.admin).sort()).toEqual([
      'email',
      'id',
      'isActive',
      'name',
      'role',
    ]);

    const serialized = JSON.stringify(accepted);
    expect(serialized).not.toMatch(/password|token|secret|oobCode/i);
  });

  it('22. Exports manageAdminInvitations as a callable function compatible with AUTH-03A/B1/B2', () => {
    expect(typeof manageAdminInvitations).toBe('function');
  });
});
