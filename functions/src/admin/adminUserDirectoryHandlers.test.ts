import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
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
  AdminDirectoryRepositoryError,
  type AdminDirectoryRepository,
  type ListAdminsOptions,
} from './adminRepository';
import {
  FirestoreAdminRepository,
  type FirestoreAdminDatabase,
  type FirestoreAdminDocumentSnapshot,
} from './firestoreAdminRepository';
import {
  executeListAdminUsers,
  listAdminUsers,
} from './adminUserDirectoryHandlers';


interface RawDocEntry {
  readonly docId: string;
  readonly exists?: boolean;
  readonly data?: Record<string, unknown>;
}

function createFakeFirestoreDatabase(
  adminDocs: ReadonlyArray<RawDocEntry>,
  publicAccountDocs: ReadonlyArray<RawDocEntry> = []
): FirestoreAdminDatabase {
  const docsById = new Map<string, RawDocEntry>();
  for (const entry of adminDocs) {
    docsById.set(entry.docId, entry);
  }

  const accountsById = new Map<string, RawDocEntry>();
  for (const entry of publicAccountDocs) {
    accountsById.set(entry.docId, entry);
  }

  const toSnapshot = (entry: RawDocEntry | undefined, requestedId: string): FirestoreAdminDocumentSnapshot => {
    if (!entry || entry.exists === false) {
      return {
        id: requestedId,
        exists: false,
        data: () => undefined,
      };
    }
    return {
      id: entry.docId,
      exists: true,
      data: () => entry.data,
    };
  };

  return {
    collection(collectionPath: string) {
      const targetMap = collectionPath === 'admins' ? docsById : accountsById;
      const targetList = collectionPath === 'admins' ? adminDocs : publicAccountDocs;

      return {
        doc(id: string) {
          return {
            async get() {
              return toSnapshot(targetMap.get(id), id);
            },
            async set() {
              throw new Error('Read-only test double does not allow writes');
            },
          };
        },
        limit(limitCount: number) {
          return {
            async get() {
              const bounded = targetList
                .filter((item) => item.exists !== false)
                .slice(0, limitCount)
                .map((item) => toSnapshot(item, item.docId));
              return { docs: bounded };
            },
          };
        },
        async get() {
          const all = targetList
            .filter((item) => item.exists !== false)
            .map((item) => toSnapshot(item, item.docId));
          return { docs: all };
        },
      };
    },
  };
}

async function expectHttpsErrorCode(
  promise: Promise<unknown>,
  expectedCode: HttpsError['code']
): Promise<HttpsError> {
  try {
    await promise;
    throw new Error(`Expected HttpsError with code '${expectedCode}', but promise resolved.`);
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(HttpsError);
    const httpsErr = err as HttpsError;
    expect(httpsErr.code).toBe(expectedCode);
    return httpsErr;
  }
}

const ACTIVE_OWNER_DOC: RawDocEntry = {
  docId: 'uid-owner-1',
  data: {
    name: 'Nadia Mansour',
    email: 'nadia@planet.org',
    role: AdminRole.Owner,
    isActive: true,
  },
};

describe('AUTH-03A Server-Authoritative Admin Directory (listAdminUsers)', () => {
  it('1. Rejects unauthenticated caller with unauthenticated', async () => {
    const db = createFakeFirestoreDatabase([ACTIVE_OWNER_DOC]);
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: undefined }, { adminRepo: repo }),
      'unauthenticated'
    );

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: '   ' } }, { adminRepo: repo }),
      'unauthenticated'
    );
  });

  it('2. Rejects authenticated user with no admins/{uid} record with permission-denied', async () => {
    const db = createFakeFirestoreDatabase([ACTIVE_OWNER_DOC]);
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-unknown-caller' } }, { adminRepo: repo }),
      'permission-denied'
    );
  });

  it('3. Rejects public accounts/{uid} user without admins/{uid} record with permission-denied', async () => {
    const db = createFakeFirestoreDatabase(
      [ACTIVE_OWNER_DOC],
      [
        {
          docId: 'uid-public-member-1',
          data: {
            uid: 'uid-public-member-1',
            email: 'member@example.com',
            displayName: 'Public Member',
            accountStatus: 'active',
            role: AdminRole.Owner, // Even if a public profile has a forged role field
          },
        },
      ]
    );
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-public-member-1' } }, { adminRepo: repo }),
      'permission-denied'
    );
  });

  it('4. Rejects inactive Owner (isActive: false) with permission-denied', async () => {
    const db = createFakeFirestoreDatabase([
      {
        docId: 'uid-inactive-owner',
        data: {
          name: 'Suspended Owner',
          email: 'suspended-owner@planet.org',
          role: AdminRole.Owner,
          isActive: false,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-inactive-owner' } }, { adminRepo: repo }),
      'permission-denied'
    );
  });

  it('5. Rejects active TrainingManager / ManagingEditor with permission-denied', async () => {
    const db = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-training-manager',
        data: {
          name: 'Tariq Hassan',
          email: 'tariq@planet.org',
          role: AdminRole.TrainingManager,
          isActive: true,
        },
      },
      {
        docId: 'uid-managing-editor',
        data: {
          name: 'Mona Managing',
          email: 'mona@planet.org',
          role: 'ManagingEditor',
          isActive: true,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-training-manager' } }, { adminRepo: repo }),
      'permission-denied'
    );

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-managing-editor' } }, { adminRepo: repo }),
      'permission-denied'
    );
  });

  it('6. Rejects active ContentEditor / LibraryCurator / Editor with permission-denied', async () => {
    const db = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-content-editor',
        data: {
          name: 'Layla Zaid',
          email: 'layla@planet.org',
          role: AdminRole.ContentEditor,
          isActive: true,
        },
      },
      {
        docId: 'uid-library-curator',
        data: {
          name: 'Rami Curator',
          email: 'rami@planet.org',
          role: AdminRole.LibraryCurator,
          isActive: true,
        },
      },
      {
        docId: 'uid-editor',
        data: {
          name: 'Legacy Editor',
          email: 'editor@planet.org',
          role: 'Editor',
          isActive: true,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-content-editor' } }, { adminRepo: repo }),
      'permission-denied'
    );

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-library-curator' } }, { adminRepo: repo }),
      'permission-denied'
    );

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-editor' } }, { adminRepo: repo }),
      'permission-denied'
    );
  });

  it('7. Rejects active Trainer / CitizenModerator / AIAssistant / Viewer / Writer with permission-denied', async () => {
    const db = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-trainer',
        data: {
          name: 'Omar Khalil',
          email: 'omar@planet.org',
          role: AdminRole.Trainer,
          isActive: true,
        },
      },
      {
        docId: 'uid-citizen-mod',
        data: {
          name: 'Dina Moderator',
          email: 'dina@planet.org',
          role: AdminRole.CitizenModerator,
          isActive: true,
        },
      },
      {
        docId: 'uid-ai-assistant',
        data: {
          name: 'AI Reviewer',
          email: 'ai@planet.org',
          role: AdminRole.AIAssistant,
          isActive: true,
        },
      },
      {
        docId: 'uid-viewer',
        data: {
          name: 'Sami Viewer',
          email: 'sami@planet.org',
          role: AdminRole.Viewer,
          isActive: true,
        },
      },
      {
        docId: 'uid-writer',
        data: {
          name: 'Writer Role',
          email: 'writer@planet.org',
          role: 'Writer',
          isActive: true,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    for (const uid of [
      'uid-trainer',
      'uid-citizen-mod',
      'uid-ai-assistant',
      'uid-viewer',
      'uid-writer',
    ]) {
      await expectHttpsErrorCode(
        executeListAdminUsers({ auth: { uid } }, { adminRepo: repo }),
        'permission-denied'
      );
    }
  });

  it('8. Rejects active RightsReviewer with permission-denied', async () => {
    const db = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-rights-reviewer',
        data: {
          name: 'Salma Farouk',
          email: 'salma@planet.org',
          role: AdminRole.RightsReviewer,
          isActive: true,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-rights-reviewer' } }, { adminRepo: repo }),
      'permission-denied'
    );
  });

  it('9. Allows active Owner (isActive: true) and returns deterministically sorted canonical records', async () => {
    const db = createFakeFirestoreDatabase([
      {
        docId: 'uid-curator-2',
        data: {
          name: 'Ziad Curator',
          email: 'ziad@planet.org',
          role: AdminRole.LibraryCurator,
          isActive: true,
        },
      },
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-rights-3',
        data: {
          name: 'Amina Rights',
          email: 'amina@planet.org',
          role: AdminRole.RightsReviewer,
          isActive: true,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    const response = await executeListAdminUsers(
      { auth: { uid: 'uid-owner-1' } },
      { adminRepo: repo }
    );

    expect(response.admins).toEqual([
      {
        id: 'uid-rights-3',
        name: 'Amina Rights',
        email: 'amina@planet.org',
        role: AdminRole.RightsReviewer,
        isActive: true,
      },
      {
        id: 'uid-owner-1',
        name: 'Nadia Mansour',
        email: 'nadia@planet.org',
        role: AdminRole.Owner,
        isActive: true,
      },
      {
        id: 'uid-curator-2',
        name: 'Ziad Curator',
        email: 'ziad@planet.org',
        role: AdminRole.LibraryCurator,
        isActive: true,
      },
    ]);
  });

  it('10. Returns both active and inactive administrative identities in the directory', async () => {
    const db = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-inactive-editor',
        data: {
          name: 'Former Editor',
          email: 'former@planet.org',
          role: AdminRole.ContentEditor,
          isActive: false,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    const response = await executeListAdminUsers(
      { auth: { uid: 'uid-owner-1' } },
      { adminRepo: repo }
    );

    expect(response.admins).toHaveLength(2);
    expect(response.admins).toContainEqual({
      id: 'uid-inactive-editor',
      name: 'Former Editor',
      email: 'former@planet.org',
      role: AdminRole.ContentEditor,
      isActive: false,
    });
    expect(response.admins).toContainEqual({
      id: 'uid-owner-1',
      name: 'Nadia Mansour',
      email: 'nadia@planet.org',
      role: AdminRole.Owner,
      isActive: true,
    });
  });

  it('11. Takes Admin UID strictly from Firestore document identity (ignoring mismatched internal id fields)', async () => {
    const db = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'canonical-doc-uid-99',
        data: {
          id: 'forged-inner-uid-000',
          name: 'Doc Bound Editor',
          email: 'bound@planet.org',
          role: AdminRole.ContentEditor,
          isActive: true,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    const response = await executeListAdminUsers(
      { auth: { uid: 'uid-owner-1' } },
      { adminRepo: repo }
    );

    const target = response.admins.find((a) => a.email === 'bound@planet.org');
    expect(target).toBeDefined();
    expect(target?.id).toBe('canonical-doc-uid-99');
  });

  it('12. Fails closed when a directory record contains an unknown role', async () => {
    const db = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-corrupt-role',
        data: {
          name: 'Unknown Role User',
          email: 'unknown@planet.org',
          role: 'ChiefModerator',
          isActive: true,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-owner-1' } }, { adminRepo: repo }),
      'failed-precondition'
    );
  });

  it("13. Fails closed when a directory record contains legacy 'SuperAdmin' or 'Admin' role strings", async () => {
    const dbSuperAdmin = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-legacy-superadmin',
        data: {
          name: 'Legacy SuperAdmin',
          email: 'superadmin@planet.org',
          role: 'SuperAdmin',
          isActive: true,
        },
      },
    ]);
    const repoSuperAdmin = new FirestoreAdminRepository(dbSuperAdmin);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-owner-1' } }, { adminRepo: repoSuperAdmin }),
      'failed-precondition'
    );

    const dbLegacyAdmin = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-legacy-admin',
        data: {
          name: 'Legacy Admin',
          email: 'legacyadmin@planet.org',
          role: 'Admin',
          isActive: true,
        },
      },
    ]);
    const repoLegacyAdmin = new FirestoreAdminRepository(dbLegacyAdmin);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-owner-1' } }, { adminRepo: repoLegacyAdmin }),
      'failed-precondition'
    );
  });

  it('14. Rejects records missing a valid UID or missing boolean isActive', async () => {
    const dbNonBooleanActive = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-bad-active',
        data: {
          name: 'String Active User',
          email: 'stringactive@planet.org',
          role: AdminRole.ContentEditor,
          isActive: 'true', // non-boolean
        },
      },
    ]);
    const repoNonBooleanActive = new FirestoreAdminRepository(dbNonBooleanActive);

    await expectHttpsErrorCode(
      executeListAdminUsers(
        { auth: { uid: 'uid-owner-1' } },
        { adminRepo: repoNonBooleanActive }
      ),
      'failed-precondition'
    );

    const dbMissingUid = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: '   ',
        data: {
          name: 'Blank UID User',
          email: 'blankuid@planet.org',
          role: AdminRole.ContentEditor,
          isActive: true,
        },
      },
    ]);
    const repoMissingUid = new FirestoreAdminRepository(dbMissingUid);

    await expectHttpsErrorCode(
      executeListAdminUsers({ auth: { uid: 'uid-owner-1' } }, { adminRepo: repoMissingUid }),
      'failed-precondition'
    );
  });

  it('15. Strips password, token, secret, and extraneous metadata fields from returned DTOs', async () => {
    const db = createFakeFirestoreDatabase([
      {
        docId: 'uid-owner-1',
        data: {
          name: 'Nadia Mansour',
          email: 'nadia@planet.org',
          role: AdminRole.Owner,
          isActive: true,
          password: 'plaintext-password-leak',
          passwordHash: '$2b$12$secretHash',
          refreshToken: 'rt_secret_999',
          apiToken: 'tok_secret_123',
          secretKey: 'sk_live_abc',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    const response = await executeListAdminUsers(
      { auth: { uid: 'uid-owner-1' } },
      { adminRepo: repo }
    );

    expect(response.admins).toHaveLength(1);
    const entry = response.admins[0] as unknown as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(['email', 'id', 'isActive', 'name', 'role']);
    expect(entry.password).toBeUndefined();
    expect(entry.passwordHash).toBeUndefined();
    expect(entry.refreshToken).toBeUndefined();
    expect(entry.apiToken).toBeUndefined();
    expect(entry.secretKey).toBeUndefined();
  });

  it('16. Rejects oversized directories with resource-exhausted rather than silently truncating results', async () => {
    const manyDocs: RawDocEntry[] = [
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-admin-2',
        data: {
          name: 'Admin Two',
          email: 'two@planet.org',
          role: AdminRole.ContentEditor,
          isActive: true,
        },
      },
      {
        docId: 'uid-admin-3',
        data: {
          name: 'Admin Three',
          email: 'three@planet.org',
          role: AdminRole.Viewer,
          isActive: true,
        },
      },
    ];
    const db = createFakeFirestoreDatabase(manyDocs);
    const repo = new FirestoreAdminRepository(db);

    await expect(repo.listAdmins({ maxResults: 2 })).rejects.toBeInstanceOf(
      AdminDirectoryRepositoryError
    );

    await expectHttpsErrorCode(
      executeListAdminUsers(
        { auth: { uid: 'uid-owner-1' } },
        { adminRepo: repo, maxResults: 2 }
      ),
      'resource-exhausted'
    );
  });

  it('17. Handles single-Owner and empty directory results deterministically', async () => {
    const singleOwnerDb = createFakeFirestoreDatabase([ACTIVE_OWNER_DOC]);
    const singleOwnerRepo = new FirestoreAdminRepository(singleOwnerDb);

    const singleResult = await executeListAdminUsers(
      { auth: { uid: 'uid-owner-1' } },
      { adminRepo: singleOwnerRepo }
    );
    expect(singleResult.admins).toEqual([
      {
        id: 'uid-owner-1',
        name: 'Nadia Mansour',
        email: 'nadia@planet.org',
        role: AdminRole.Owner,
        isActive: true,
      },
    ]);

    const emptyListingRepo: AdminDirectoryRepository = {
      async getAdminByUid(uid: string): Promise<AdminUser | null> {
        if (uid === 'uid-owner-1') {
          return {
            id: 'uid-owner-1',
            name: 'Nadia Mansour',
            email: 'nadia@planet.org',
            role: AdminRole.Owner,
            isActive: true,
          };
        }
        return null;
      },
      async saveAdmin(admin: AdminUser): Promise<AdminUser> {
        return admin;
      },
      async listAdmins(_options?: ListAdminsOptions): Promise<AdminUser[]> {
        return [];
      },
    };

    const emptyResult = await executeListAdminUsers(
      { auth: { uid: 'uid-owner-1' } },
      { adminRepo: emptyListingRepo }
    );
    expect(emptyResult.admins).toEqual([]);
  });

  it('18. Ignores request payload and auth token spoofing (callerUid, role, permissions, isActive)', async () => {
    const db = createFakeFirestoreDatabase([
      ACTIVE_OWNER_DOC,
      {
        docId: 'uid-editor-spoof',
        data: {
          name: 'Spoofing ContentEditor',
          email: 'spoof@planet.org',
          role: AdminRole.ContentEditor,
          isActive: true,
        },
      },
    ]);
    const repo = new FirestoreAdminRepository(db);

    await expectHttpsErrorCode(
      executeListAdminUsers(
        {
          auth: {
            uid: 'uid-editor-spoof',
            token: {
              role: AdminRole.Owner,
              admin: true,
              permissions: ['manageUsers'],
              isActive: true,
            },
          },
          data: {
            callerUid: 'uid-owner-1',
            uid: 'uid-owner-1',
            role: AdminRole.Owner,
            permissions: ['manageUsers'],
            isActive: true,
          },
        },
        { adminRepo: repo }
      ),
      'permission-denied'
    );

    expect(typeof listAdminUsers).toBe('function');
  });
});
