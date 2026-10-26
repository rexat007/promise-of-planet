import { describe, expect, it, vi } from 'vitest';

const firestoreModuleSpy = vi.fn(() => {
  throw new Error(
    'LIVE_FIRESTORE_FORBIDDEN: Production getFirestore() must never be called during tests.'
  );
});

const authModuleSpy = vi.fn(() => {
  throw new Error(
    'LIVE_AUTH_FORBIDDEN: Firebase Auth getAuth() must never be called by lifecycle persistence.'
  );
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => firestoreModuleSpy(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => authModuleSpy(),
}));

import { AdminRole } from '../types/admin';
import {
  AuditAction,
  AuditTargetType,
} from '../shared/auditContract';
import * as lifecycleContractModule from './adminIdentityLifecycleContract';
import {
  AdminIdentityLifecycleTransitionType,
} from './adminIdentityLifecycleContract';
import {
  ADMINS_COLLECTION,
  ADMIN_AUDIT_LOGS_COLLECTION,
  AdminIdentityLifecycleAuditEventType,
  AdminIdentityLifecyclePersistenceError,
  generateCryptographicLifecycleAuditEventId,
  type AdminIdentityLifecyclePersistenceErrorCode,
} from './adminIdentityLifecycleRepository';
import {
  FirestoreAdminIdentityLifecycleRepository,
  type AdminLifecycleFirestoreCollectionRef,
  type AdminLifecycleFirestoreDatabase,
  type AdminLifecycleFirestoreDocumentRef,
  type AdminLifecycleFirestoreDocumentSnapshot,
  type AdminLifecycleFirestoreQuery,
  type AdminLifecycleFirestoreQuerySnapshot,
  type AdminLifecycleFirestoreTransaction,
} from './firestoreAdminIdentityLifecycleRepository';

const BASE_TIME_ISO = '2026-10-26T10:00:00.000Z';
const BASE_TIME_MS = Date.parse(BASE_TIME_ISO);

function fixedClock(isoOrMs: string | number = BASE_TIME_ISO) {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  return () => new Date(ms);
}

interface SeedAdminDoc {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
  readonly revision?: unknown;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly provisionedViaInvitationId?: string;
  readonly [extraKey: string]: unknown;
}

const OWNER_PRIMARY: SeedAdminDoc = {
  id: 'uid-owner-primary',
  name: 'Nadia Mansour',
  email: 'nadia@planet.org',
  role: AdminRole.Owner,
  isActive: true,
  revision: 1,
};

const OWNER_SECONDARY: SeedAdminDoc = {
  id: 'uid-owner-secondary',
  name: 'Tariq Hassan',
  email: 'tariq@planet.org',
  role: AdminRole.Owner,
  isActive: true,
  revision: 1,
};

const ACTIVE_EDITOR: SeedAdminDoc = {
  id: 'uid-editor-1',
  name: 'Layla Haddad',
  email: 'layla@planet.org',
  role: AdminRole.ContentEditor,
  isActive: true,
  revision: 1,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  provisionedViaInvitationId: 'inv_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
};

const INACTIVE_CURATOR: SeedAdminDoc = {
  id: 'uid-curator-inactive',
  name: 'Rami Saleh',
  email: 'rami@planet.org',
  role: AdminRole.LibraryCurator,
  isActive: false,
  revision: 3,
  createdAt: '2026-09-15T12:00:00.000Z',
  updatedAt: '2026-10-10T15:30:00.000Z',
};

const LEGACY_UNVERSIONED_ADMIN: SeedAdminDoc = {
  id: 'uid-legacy-trainer',
  name: 'Salma Zaki',
  email: 'salma@planet.org',
  role: AdminRole.Trainer,
  isActive: true,
  createdAt: '2025-11-20T09:00:00.000Z',
  updatedAt: '2025-12-01T11:15:00.000Z',
  provisionedViaInvitationId: 'inv_11223344556677889900aabbccddeeff',
};

interface VersionedStoredDoc {
  version: number;
  data: Record<string, unknown>;
}

interface StagedWrite {
  readonly op: 'create' | 'set';
  readonly collectionName: string;
  readonly docId: string;
  readonly data: Record<string, unknown>;
}

interface OccTransactionalFakeStore {
  readonly db: AdminLifecycleFirestoreDatabase;
  readonly collections: Record<string, Map<string, VersionedStoredDoc>>;
  readonly setOperationCalls: Array<{
    collectionName: string;
    docId: string;
    optionsPassed: number;
  }>;
  attemptCount: number;
  conflictRetryCount: number;
  failOnCollectionCommit: string | null;
  forceTruncatedQuerySnapshot: boolean;
  omitDocIdsFromCollectionQuery: Set<string>;
  onBeforeFirstCommitAttempt?: (attemptNumber: number) => Promise<void> | void;
  getDocData(
    collectionName: string,
    docId: string
  ): Record<string, unknown> | undefined;
  setDirectOutsideTx(
    collectionName: string,
    docId: string,
    data: Record<string, unknown>
  ): void;
}

function cloneRecord(
  data: Record<string, unknown>
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    copy[key] = data[key];
  }
  return copy;
}

/**
 * Realistic Optimistic Concurrency Control (OCC) Firestore transaction harness:
 * - Tracks per-document commit versions (`version`) and collection query read-sets.
 * - Enforces Firestore's read-before-write rule inside every transaction attempt.
 * - Detects concurrent modifications to any document or collection query in a
 *   transaction's read-set before committing staged writes.
 * - Discards all staged writes on conflict and retries the transaction callback
 *   against the newly committed state (up to `maxAttempts`).
 */
function createOccTransactionalFirestoreFake(
  initialAdmins: ReadonlyArray<SeedAdminDoc> = [OWNER_PRIMARY, ACTIVE_EDITOR],
  options?: { readonly maxAttempts?: number }
): OccTransactionalFakeStore {
  const maxAttempts = options?.maxAttempts ?? 5;
  const collections: Record<string, Map<string, VersionedStoredDoc>> = {
    [ADMINS_COLLECTION]: new Map(),
    [ADMIN_AUDIT_LOGS_COLLECTION]: new Map(),
  };

  for (const admin of initialAdmins) {
    collections[ADMINS_COLLECTION].set(admin.id, {
      version: 1,
      data: cloneRecord(admin as Record<string, unknown>),
    });
  }

  const setOperationCalls: Array<{
    collectionName: string;
    docId: string;
    optionsPassed: number;
  }> = [];

  function ensureCollection(
    name: string
  ): Map<string, VersionedStoredDoc> {
    if (!collections[name]) {
      collections[name] = new Map();
    }
    return collections[name];
  }

  function snapshotCollectionVersions(
    colMap: Map<string, VersionedStoredDoc>
  ): Map<string, number> {
    const snap = new Map<string, number>();
    for (const [docId, entry] of colMap.entries()) {
      snap.set(docId, entry.version);
    }
    return snap;
  }

  const store: OccTransactionalFakeStore = {
    collections,
    setOperationCalls,
    attemptCount: 0,
    conflictRetryCount: 0,
    failOnCollectionCommit: null,
    forceTruncatedQuerySnapshot: false,
    omitDocIdsFromCollectionQuery: new Set<string>(),
    onBeforeFirstCommitAttempt: undefined,

    getDocData(collectionName: string, docId: string) {
      const entry = ensureCollection(collectionName).get(docId);
      return entry ? cloneRecord(entry.data) : undefined;
    },

    setDirectOutsideTx(
      collectionName: string,
      docId: string,
      data: Record<string, unknown>
    ) {
      const colMap = ensureCollection(collectionName);
      const prevVersion = colMap.get(docId)?.version ?? 0;
      colMap.set(docId, {
        version: prevVersion + 1,
        data: cloneRecord(data),
      });
    },

    db: {
      collection(collectionName: string): AdminLifecycleFirestoreCollectionRef {
        const colMap = ensureCollection(collectionName);

        const buildQuery = (
          limitCount?: number
        ): AdminLifecycleFirestoreQuery => ({
          async get(): Promise<AdminLifecycleFirestoreQuerySnapshot> {
            const allEntries = Array.from(colMap.entries()).filter(
              ([docId]) => !store.omitDocIdsFromCollectionQuery.has(docId)
            );
            const boundedEntries =
              typeof limitCount === 'number'
                ? allEntries.slice(0, limitCount)
                : allEntries;

            const docs: AdminLifecycleFirestoreDocumentSnapshot[] =
              boundedEntries.map(([docId, entry]) => ({
                id: docId,
                exists: true,
                data: () => cloneRecord(entry.data),
              }));

            return {
              docs,
              ...(store.forceTruncatedQuerySnapshot ? { truncated: true } : {}),
            };
          },
        });

        return {
          doc(documentId: string): AdminLifecycleFirestoreDocumentRef {
            const ref = {
              id: documentId,
              __collectionName: collectionName,
              async get(): Promise<AdminLifecycleFirestoreDocumentSnapshot> {
                const existing = colMap.get(documentId);
                return {
                  id: documentId,
                  exists: existing !== undefined,
                  data: () =>
                    existing ? cloneRecord(existing.data) : undefined,
                };
              },
            };
            return ref as AdminLifecycleFirestoreDocumentRef;
          },
          limit(limitCount: number): AdminLifecycleFirestoreQuery {
            const q = buildQuery(limitCount) as AdminLifecycleFirestoreQuery & {
              __collectionName?: string;
            };
            q.__collectionName = collectionName;
            return q;
          },
          async get(): Promise<AdminLifecycleFirestoreQuerySnapshot> {
            return buildQuery().get();
          },
          __collectionName: collectionName,
        } as AdminLifecycleFirestoreCollectionRef;
      },

      async runTransaction<T>(
        updateFunction: (
          transaction: AdminLifecycleFirestoreTransaction
        ) => Promise<T>
      ): Promise<T> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          store.attemptCount += 1;
          const stagedWrites: StagedWrite[] = [];
          const readDocVersions = new Map<string, number>();
          const readCollectionVersions = new Map<
            string,
            Map<string, number>
          >();
          let hasStagedWrite = false;

          const tx: AdminLifecycleFirestoreTransaction = {
            async get(
              target:
                | AdminLifecycleFirestoreDocumentRef
                | AdminLifecycleFirestoreQuery
            ): Promise<any> {
              if (hasStagedWrite) {
                throw new AdminIdentityLifecyclePersistenceError(
                  'READ_AFTER_WRITE_FORBIDDEN',
                  'Firestore transactions require all reads to be executed before all writes.'
                );
              }

              // Distinguish DocumentRef (has string `id`) from Query/CollectionRef
              if (
                'id' in target &&
                typeof (target as AdminLifecycleFirestoreDocumentRef).id ===
                  'string'
              ) {
                const docRef = target as AdminLifecycleFirestoreDocumentRef;
                const colName =
                  (docRef as unknown as { __collectionName?: string })
                    .__collectionName ?? ADMINS_COLLECTION;
                const colMap = ensureCollection(colName);
                const key = `${colName}/${docRef.id}`;
                const currentEntry = colMap.get(docRef.id);
                if (!readDocVersions.has(key)) {
                  readDocVersions.set(key, currentEntry?.version ?? 0);
                }
                return docRef.get();
              }

              const queryTarget = target as AdminLifecycleFirestoreQuery;
              const colName =
                (queryTarget as unknown as { __collectionName?: string })
                  .__collectionName ?? ADMINS_COLLECTION;
              const colMap = ensureCollection(colName);

              if (!readCollectionVersions.has(colName)) {
                readCollectionVersions.set(
                  colName,
                  snapshotCollectionVersions(colMap)
                );
              }

              const querySnap = await queryTarget.get();
              for (const docSnap of querySnap.docs) {
                const key = `${colName}/${docSnap.id}`;
                if (!readDocVersions.has(key)) {
                  const currentEntry = colMap.get(docSnap.id);
                  readDocVersions.set(key, currentEntry?.version ?? 0);
                }
              }
              return querySnap;
            },

            create(
              docRef: AdminLifecycleFirestoreDocumentRef,
              data: Record<string, unknown>
            ) {
              hasStagedWrite = true;
              const colName =
                (docRef as unknown as { __collectionName?: string })
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
              docRef: AdminLifecycleFirestoreDocumentRef,
              data: Record<string, unknown>,
              ...extraArgs: unknown[]
            ) {
              hasStagedWrite = true;
              const colName =
                (docRef as unknown as { __collectionName?: string })
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

          const result = await updateFunction(tx);

          if (attempt === 1 && store.onBeforeFirstCommitAttempt) {
            const hook = store.onBeforeFirstCommitAttempt;
            store.onBeforeFirstCommitAttempt = undefined;
            await hook(attempt);
          }

          // Check OCC read-set conflicts before committing any staged writes
          let hasConflict = false;

          for (const [key, readVersion] of readDocVersions.entries()) {
            const slashIdx = key.indexOf('/');
            const colName = key.slice(0, slashIdx);
            const docId = key.slice(slashIdx + 1);
            const currentVersion =
              ensureCollection(colName).get(docId)?.version ?? 0;
            if (currentVersion !== readVersion) {
              hasConflict = true;
              break;
            }
          }

          if (!hasConflict) {
            for (const [
              colName,
              expectedMap,
            ] of readCollectionVersions.entries()) {
              const currentMap = snapshotCollectionVersions(
                ensureCollection(colName)
              );
              if (currentMap.size !== expectedMap.size) {
                hasConflict = true;
                break;
              }
              for (const [docId, expectedVer] of expectedMap.entries()) {
                if (currentMap.get(docId) !== expectedVer) {
                  hasConflict = true;
                  break;
                }
              }
              if (hasConflict) {
                break;
              }
            }
          }

          if (hasConflict) {
            store.conflictRetryCount += 1;
            if (attempt < maxAttempts) {
              continue;
            }
            const abortErr = new Error(
              'Transaction aborted due to concurrent read-set modification.'
            ) as Error & { code?: string };
            abortErr.code = 'ABORTED';
            throw abortErr;
          }

          // Validate all staged writes before applying any write (all-or-nothing commit)
          for (const write of stagedWrites) {
            if (store.failOnCollectionCommit === write.collectionName) {
              throw new Error(
                `Simulated atomic commit failure on collection '${write.collectionName}'`
              );
            }
            const colMap = ensureCollection(write.collectionName);
            if (write.op === 'create' && colMap.has(write.docId)) {
              const existsErr = new Error(
                `Document ${write.collectionName}/${write.docId} already exists`
              ) as Error & { code?: string };
              existsErr.code = 'ALREADY_EXISTS';
              throw existsErr;
            }
          }

          // Commit all staged writes atomically
          for (const write of stagedWrites) {
            const colMap = ensureCollection(write.collectionName);
            const prevVersion = colMap.get(write.docId)?.version ?? 0;
            colMap.set(write.docId, {
              version: prevVersion + 1,
              data: cloneRecord(write.data),
            });
          }

          return result;
        }

        const exhaustedErr = new Error(
          'Transaction retries exhausted.'
        ) as Error & { code?: string };
        exhaustedErr.code = 'ABORTED';
        throw exhaustedErr;
      },
    },
  };

  return store;
}

async function expectLifecyclePersistenceError(
  promise: Promise<unknown>,
  expectedCode: AdminIdentityLifecyclePersistenceErrorCode
): Promise<AdminIdentityLifecyclePersistenceError> {
  try {
    await promise;
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(AdminIdentityLifecyclePersistenceError);
    const typed = err as AdminIdentityLifecyclePersistenceError;
    expect(typed.code).toBe(expectedCode);
    return typed;
  }
  throw new Error(
    `Expected promise to reject with AdminIdentityLifecyclePersistenceError(${expectedCode}), but it resolved.`
  );
}

describe('AUTH-04A2-S2 Atomic Administrative Identity Lifecycle Persistence', () => {
  it('1. Valid role transition: atomically changes role, preserves provenance, increments revision, and writes RoleChanged audit event without merge', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);
    const auditEventId = generateCryptographicLifecycleAuditEventId();

    const result = await repo.changeAdminRoleAtomic({
      auditEventId,
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 1,
      targetRole: AdminRole.TrainingManager,
      clock: fixedClock(BASE_TIME_ISO),
    });

    expect(result.transitionType).toBe(
      AdminIdentityLifecycleTransitionType.ChangeRole
    );
    expect(result.previousState.role).toBe(AdminRole.ContentEditor);
    expect(result.currentState.role).toBe(AdminRole.TrainingManager);
    expect(result.previousRevision).toBe(1);
    expect(result.currentRevision).toBe(2);
    expect(result.verifiedActiveOwnerCount).toBe(1);

    const persistedTarget = store.getDocData(
      ADMINS_COLLECTION,
      ACTIVE_EDITOR.id
    );
    expect(persistedTarget).toEqual({
      id: ACTIVE_EDITOR.id,
      name: ACTIVE_EDITOR.name,
      email: ACTIVE_EDITOR.email,
      role: AdminRole.TrainingManager,
      isActive: true,
      revision: 2,
      createdAt: ACTIVE_EDITOR.createdAt,
      updatedAt: BASE_TIME_ISO,
      provisionedViaInvitationId: ACTIVE_EDITOR.provisionedViaInvitationId,
    });

    expect(
      store.setOperationCalls.every((call) => call.optionsPassed === 0)
    ).toBe(true);
  });

  it('2. Valid deactivation: atomically sets isActive=false, increments revision, and writes StatusChanged audit event', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);
    const auditEventId = generateCryptographicLifecycleAuditEventId();

    const result = await repo.deactivateAdminAtomic({
      auditEventId,
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 1,
      clock: fixedClock(BASE_TIME_ISO),
    });

    expect(result.transitionType).toBe(
      AdminIdentityLifecycleTransitionType.Deactivate
    );
    expect(result.previousState.isActive).toBe(true);
    expect(result.currentState.isActive).toBe(false);
    expect(result.currentRevision).toBe(2);

    const persistedTarget = store.getDocData(
      ADMINS_COLLECTION,
      ACTIVE_EDITOR.id
    );
    expect(persistedTarget?.isActive).toBe(false);
    expect(persistedTarget?.revision).toBe(2);
    expect(persistedTarget?.role).toBe(AdminRole.ContentEditor);
  });

  it('3. Valid reactivation: atomically sets isActive=true for an inactive non-Owner and increments revision', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      INACTIVE_CURATOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);
    const auditEventId = generateCryptographicLifecycleAuditEventId();

    const result = await repo.reactivateAdminAtomic({
      auditEventId,
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: INACTIVE_CURATOR.id,
      expectedRevision: 3,
      clock: fixedClock(BASE_TIME_ISO),
    });

    expect(result.transitionType).toBe(
      AdminIdentityLifecycleTransitionType.Reactivate
    );
    expect(result.previousState.isActive).toBe(false);
    expect(result.currentState.isActive).toBe(true);
    expect(result.previousRevision).toBe(3);
    expect(result.currentRevision).toBe(4);

    const persistedTarget = store.getDocData(
      ADMINS_COLLECTION,
      INACTIVE_CURATOR.id
    );
    expect(persistedTarget?.isActive).toBe(true);
    expect(persistedTarget?.revision).toBe(4);
  });

  it('4. Unauthorized actor: rejects non-Owner canonical roles, unknown UIDs, and unauthenticated callers with zero writes', async () => {
    const nonOwnerRoles: ReadonlyArray<AdminRole> = [
      AdminRole.ContentEditor,
      AdminRole.LibraryCurator,
      AdminRole.RightsReviewer,
      AdminRole.TrainingManager,
      AdminRole.Trainer,
      AdminRole.CitizenModerator,
      AdminRole.AIAssistant,
      AdminRole.Viewer,
    ];

    for (const nonOwnerRole of nonOwnerRoles) {
      const actorId = `uid-actor-${nonOwnerRole}`;
      const store = createOccTransactionalFirestoreFake([
        OWNER_PRIMARY,
        ACTIVE_EDITOR,
        {
          id: actorId,
          name: `Actor ${nonOwnerRole}`,
          email: `${nonOwnerRole.toLowerCase()}@planet.org`,
          role: nonOwnerRole,
          isActive: true,
          revision: 1,
        },
      ]);
      const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

      await expectLifecyclePersistenceError(
        repo.changeAdminRoleAtomic({
          auditEventId: generateCryptographicLifecycleAuditEventId(),
          authenticatedActorUid: actorId,
          targetUid: ACTIVE_EDITOR.id,
          expectedRevision: 1,
          targetRole: AdminRole.Trainer,
          clock: fixedClock(BASE_TIME_ISO),
        }),
        'UNAUTHORIZED_ACTOR'
      );

      expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
    }

    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: 'uid-unknown-caller',
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'UNAUTHORIZED_ACTOR'
    );

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: '   ',
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'UNAUTHENTICATED_ACTOR'
    );
  });

  it('5. Inactive Owner: rejects lifecycle mutations and revision initialization by an inactive Owner', async () => {
    const inactiveOwner: SeedAdminDoc = {
      id: 'uid-owner-inactive',
      name: 'Inactive Owner',
      email: 'inactive.owner@planet.org',
      role: AdminRole.Owner,
      isActive: false,
      revision: 2,
    };
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      inactiveOwner,
      ACTIVE_EDITOR,
      LEGACY_UNVERSIONED_ADMIN,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: inactiveOwner.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INACTIVE_ACTOR'
    );

    await expectLifecyclePersistenceError(
      repo.initializeLegacyAdminRevisionAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: inactiveOwner.id,
        targetUid: LEGACY_UNVERSIONED_ADMIN.id,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INACTIVE_ACTOR'
    );

    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('6. Self-deactivation: prevents an active Owner from deactivating their own account even when another active Owner exists', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      OWNER_SECONDARY,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: OWNER_PRIMARY.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'SELF_DEACTIVATION_FORBIDDEN'
    );

    expect(
      store.getDocData(ADMINS_COLLECTION, OWNER_PRIMARY.id)?.isActive
    ).toBe(true);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('7. Self-demotion: prevents an active Owner from changing their own role even when another active Owner exists', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      OWNER_SECONDARY,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.changeAdminRoleAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: OWNER_PRIMARY.id,
        expectedRevision: 1,
        targetRole: AdminRole.TrainingManager,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'SELF_DEMOTION_FORBIDDEN'
    );

    expect(store.getDocData(ADMINS_COLLECTION, OWNER_PRIMARY.id)?.role).toBe(
      AdminRole.Owner
    );
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('8. Last active Owner deactivation: forbids deactivating an Owner when no other active Owner would remain, and allows when a second active Owner exists', async () => {
    // When two active Owners exist, OWNER_PRIMARY can deactivate OWNER_SECONDARY
    const twoOwnerStore = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      OWNER_SECONDARY,
    ]);
    const twoOwnerRepo = new FirestoreAdminIdentityLifecycleRepository(
      twoOwnerStore.db
    );

    const success = await twoOwnerRepo.deactivateAdminAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: OWNER_SECONDARY.id,
      expectedRevision: 1,
      clock: fixedClock(BASE_TIME_ISO),
    });
    expect(success.currentState.isActive).toBe(false);

    // Verify that if only 1 active Owner exists in the transactional snapshot, deactivating an active Owner target fails closed
    const singleActiveOwnerWithCorruptedSnapshotAttempt = () =>
      lifecycleContractModule.validateAdminIdentityLifecycleTransition(
        {
          authenticatedActorUid: OWNER_PRIMARY.id,
          resolvedActorAdmin: {
            id: OWNER_PRIMARY.id,
            name: OWNER_PRIMARY.name,
            email: OWNER_PRIMARY.email,
            role: AdminRole.Owner,
            isActive: true,
            revision: 1,
          },
          targetUid: OWNER_SECONDARY.id,
          resolvedTargetAdmin: {
            id: OWNER_SECONDARY.id,
            name: OWNER_SECONDARY.name,
            email: OWNER_SECONDARY.email,
            role: AdminRole.Owner,
            isActive: true,
            revision: 1,
          },
          expectedRevision: 1,
          transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
          trustedOwnerState: {
            origin:
              lifecycleContractModule.TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
            activeOwnerUids: [OWNER_SECONDARY.id],
          },
        },
        fixedClock(BASE_TIME_ISO)
      );

    expect(singleActiveOwnerWithCorruptedSnapshotAttempt).toThrowError(
      expect.objectContaining({
        code: 'LAST_ACTIVE_OWNER_DEACTIVATION_FORBIDDEN',
      })
    );
  });

  it('9. Last active Owner demotion: forbids demoting an Owner when no other active Owner would remain, and allows when a second active Owner exists', async () => {
    const twoOwnerStore = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      OWNER_SECONDARY,
    ]);
    const twoOwnerRepo = new FirestoreAdminIdentityLifecycleRepository(
      twoOwnerStore.db
    );

    const demoted = await twoOwnerRepo.changeAdminRoleAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: OWNER_SECONDARY.id,
      expectedRevision: 1,
      targetRole: AdminRole.TrainingManager,
      clock: fixedClock(BASE_TIME_ISO),
    });
    expect(demoted.currentState.role).toBe(AdminRole.TrainingManager);

    const lastOwnerDemotionAttempt = () =>
      lifecycleContractModule.validateAdminIdentityLifecycleTransition(
        {
          authenticatedActorUid: OWNER_PRIMARY.id,
          resolvedActorAdmin: {
            id: OWNER_PRIMARY.id,
            name: OWNER_PRIMARY.name,
            email: OWNER_PRIMARY.email,
            role: AdminRole.Owner,
            isActive: true,
            revision: 1,
          },
          targetUid: OWNER_SECONDARY.id,
          resolvedTargetAdmin: {
            id: OWNER_SECONDARY.id,
            name: OWNER_SECONDARY.name,
            email: OWNER_SECONDARY.email,
            role: AdminRole.Owner,
            isActive: true,
            revision: 1,
          },
          expectedRevision: 1,
          transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
          targetRole: AdminRole.TrainingManager,
          trustedOwnerState: {
            origin:
              lifecycleContractModule.TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
            activeOwnerUids: [OWNER_SECONDARY.id],
          },
        },
        fixedClock(BASE_TIME_ISO)
      );

    expect(lastOwnerDemotionAttempt).toThrowError(
      expect.objectContaining({
        code: 'LAST_ACTIVE_OWNER_DEMOTION_FORBIDDEN',
      })
    );
  });

  it('10. Owner promotion denied: rejects ChangeRole to Owner, Reactivate of inactive Owner, and any explicitOwnerPromotionPolicy override', async () => {
    const inactiveOwner: SeedAdminDoc = {
      id: 'uid-owner-inactive',
      name: 'Dormant Owner',
      email: 'dormant@planet.org',
      role: AdminRole.Owner,
      isActive: false,
      revision: 2,
    };
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
      inactiveOwner,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.changeAdminRoleAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        targetRole: AdminRole.Owner,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED'
    );

    await expectLifecyclePersistenceError(
      repo.reactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: inactiveOwner.id,
        expectedRevision: 2,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED'
    );

    await expectLifecyclePersistenceError(
      repo.changeAdminRoleAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        targetRole: AdminRole.LibraryCurator,
        explicitOwnerPromotionPolicy: { allowOwnerPromotion: true },
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED'
    );

    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('11. Missing revision rejected: ordinary transitions on unversioned legacy records fail closed without auto-initializing revision', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      LEGACY_UNVERSIONED_ADMIN,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.changeAdminRoleAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: LEGACY_UNVERSIONED_ADMIN.id,
        expectedRevision: 1,
        targetRole: AdminRole.ContentEditor,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INVALID_REVISION'
    );

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: LEGACY_UNVERSIONED_ADMIN.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INVALID_REVISION'
    );

    const untouchedLegacy = store.getDocData(
      ADMINS_COLLECTION,
      LEGACY_UNVERSIONED_ADMIN.id
    );
    expect(untouchedLegacy?.revision).toBeUndefined();
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('12. Stale revision rejected: fails closed with REVISION_CONFLICT when expectedRevision does not match current target revision', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      INACTIVE_CURATOR, // revision: 3
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.reactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: INACTIVE_CURATOR.id,
        expectedRevision: 2,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'REVISION_CONFLICT'
    );

    expect(
      store.getDocData(ADMINS_COLLECTION, INACTIVE_CURATOR.id)?.revision
    ).toBe(3);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('13. Revision increments exactly once per committed transition', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    const step1 = await repo.changeAdminRoleAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 1,
      targetRole: AdminRole.LibraryCurator,
      clock: fixedClock(BASE_TIME_MS),
    });
    expect(step1.previousRevision).toBe(1);
    expect(step1.currentRevision).toBe(2);

    const step2 = await repo.deactivateAdminAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 2,
      clock: fixedClock(BASE_TIME_MS + 5_000),
    });
    expect(step2.previousRevision).toBe(2);
    expect(step2.currentRevision).toBe(3);

    const step3 = await repo.reactivateAdminAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 3,
      clock: fixedClock(BASE_TIME_MS + 10_000),
    });
    expect(step3.previousRevision).toBe(3);
    expect(step3.currentRevision).toBe(4);

    const finalDoc = store.getDocData(ADMINS_COLLECTION, ACTIVE_EDITOR.id);
    expect(finalDoc?.revision).toBe(4);
  });

  it('14. Invalid target denied: rejects non-existent target, malformed target UID, and invalid target role', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: 'uid-does-not-exist',
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'TARGET_ADMIN_NOT_FOUND'
    );

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: '  uid-editor-1  ',
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INVALID_TARGET_UID'
    );

    await expectLifecyclePersistenceError(
      repo.changeAdminRoleAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        targetRole: 'SuperAdmin' as unknown as AdminRole,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INVALID_TARGET_ROLE'
    );
  });

  it('15. No-op denied: rejects ChangeRole to current role, Deactivate of inactive admin, and Reactivate of active admin', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
      INACTIVE_CURATOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.changeAdminRoleAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        targetRole: AdminRole.ContentEditor,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'NO_OP_TRANSITION'
    );

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: INACTIVE_CURATOR.id,
        expectedRevision: 3,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'ALREADY_INACTIVE'
    );

    await expectLifecyclePersistenceError(
      repo.reactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'ALREADY_ACTIVE'
    );

    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('16. Explicit legacy revision initialization: initializes revision=1 inside a transaction and enables subsequent revision-guarded transitions', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      LEGACY_UNVERSIONED_ADMIN,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);
    const initAuditId = generateCryptographicLifecycleAuditEventId();

    const initResult = await repo.initializeLegacyAdminRevisionAtomic({
      auditEventId: initAuditId,
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: LEGACY_UNVERSIONED_ADMIN.id,
      clock: fixedClock(BASE_TIME_ISO),
    });

    expect(initResult.transitionType).toBe('InitializeRevision');
    expect(initResult.previousRevision).toBeNull();
    expect(initResult.currentRevision).toBe(1);
    expect(initResult.initializedState.revision).toBe(1);

    // Subsequent lifecycle transition now succeeds with expectedRevision: 1
    const roleChangeResult = await repo.changeAdminRoleAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: LEGACY_UNVERSIONED_ADMIN.id,
      expectedRevision: 1,
      targetRole: AdminRole.TrainingManager,
      clock: fixedClock(BASE_TIME_MS + 10_000),
    });

    expect(roleChangeResult.currentRevision).toBe(2);
    expect(roleChangeResult.currentState.role).toBe(AdminRole.TrainingManager);
  });

  it('17. Repeated initialization denied: rejects already initialized records and malformed revision values', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR, // already revision: 1
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await expectLifecyclePersistenceError(
      repo.initializeLegacyAdminRevisionAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'REVISION_ALREADY_INITIALIZED'
    );

    const malformedRevisionValues: ReadonlyArray<unknown> = [
      0,
      -1,
      1.5,
      '1',
      null,
      NaN,
    ];

    for (const badRev of malformedRevisionValues) {
      const badStore = createOccTransactionalFirestoreFake([
        OWNER_PRIMARY,
        {
          ...LEGACY_UNVERSIONED_ADMIN,
          revision: badRev,
        },
      ]);
      const badRepo = new FirestoreAdminIdentityLifecycleRepository(
        badStore.db
      );

      await expectLifecyclePersistenceError(
        badRepo.initializeLegacyAdminRevisionAtomic({
          auditEventId: generateCryptographicLifecycleAuditEventId(),
          authenticatedActorUid: OWNER_PRIMARY.id,
          targetUid: LEGACY_UNVERSIONED_ADMIN.id,
          clock: fixedClock(BASE_TIME_ISO),
        }),
        'INVALID_REVISION'
      );
    }
  });

  it('18. Legacy initialization preserves original fields: preserves role, isActive, identity, and provenance fields untouched while adding revision: 1 only', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      LEGACY_UNVERSIONED_ADMIN,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await repo.initializeLegacyAdminRevisionAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: LEGACY_UNVERSIONED_ADMIN.id,
      clock: fixedClock(BASE_TIME_ISO),
    });

    const persisted = store.getDocData(
      ADMINS_COLLECTION,
      LEGACY_UNVERSIONED_ADMIN.id
    );

    expect(persisted).toEqual({
      id: LEGACY_UNVERSIONED_ADMIN.id,
      name: LEGACY_UNVERSIONED_ADMIN.name,
      email: LEGACY_UNVERSIONED_ADMIN.email,
      role: LEGACY_UNVERSIONED_ADMIN.role,
      isActive: LEGACY_UNVERSIONED_ADMIN.isActive,
      createdAt: LEGACY_UNVERSIONED_ADMIN.createdAt,
      updatedAt: LEGACY_UNVERSIONED_ADMIN.updatedAt,
      provisionedViaInvitationId:
        LEGACY_UNVERSIONED_ADMIN.provisionedViaInvitationId,
      revision: 1,
    });
  });

  it('19. Audit written atomically on success: persists canonical AuditEvent with actor, target, state changes, revision, and timestamp', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);
    const auditEventId = generateCryptographicLifecycleAuditEventId();

    const result = await repo.changeAdminRoleAtomic({
      auditEventId,
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 1,
      targetRole: AdminRole.LibraryCurator,
      clock: fixedClock(BASE_TIME_ISO),
    });

    const persistedAudit = store.getDocData(
      ADMIN_AUDIT_LOGS_COLLECTION,
      auditEventId
    );
    expect(persistedAudit).toBeDefined();
    expect(persistedAudit).toEqual({
      id: auditEventId,
      timestamp: BASE_TIME_ISO,
      actorUserId: OWNER_PRIMARY.id,
      actorName: OWNER_PRIMARY.name,
      actorRole: AdminRole.Owner,
      action: AuditAction.RoleChanged,
      targetType: AuditTargetType.AdminUser,
      targetId: ACTIVE_EDITOR.id,
      targetTitle: `${ACTIVE_EDITOR.email} (${AdminRole.LibraryCurator})`,
      changes: [
        {
          field: 'role',
          previousValue: AdminRole.ContentEditor,
          newValue: AdminRole.LibraryCurator,
        },
      ],
      metadata: {
        eventType: AdminIdentityLifecycleAuditEventType.ChangeRole,
        transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
        targetUid: ACTIVE_EDITOR.id,
        previousRole: AdminRole.ContentEditor,
        nextRole: AdminRole.LibraryCurator,
        previousIsActive: true,
        nextIsActive: true,
        previousRevision: 1,
        nextRevision: 2,
      },
    });
    expect(result.auditEvent.id).toBe(auditEventId);
  });

  it('20. Audit absent after rollback: neither admin mutation nor audit event is persisted if transaction commit fails', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    store.failOnCollectionCommit = ADMIN_AUDIT_LOGS_COLLECTION;
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);
    const auditEventId = generateCryptographicLifecycleAuditEventId();

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId,
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'PERSISTENCE_FAILURE'
    );

    const targetAfterRollback = store.getDocData(
      ADMINS_COLLECTION,
      ACTIVE_EDITOR.id
    );
    expect(targetAfterRollback?.isActive).toBe(true);
    expect(targetAfterRollback?.revision).toBe(1);
    expect(
      store.getDocData(ADMIN_AUDIT_LOGS_COLLECTION, auditEventId)
    ).toBeUndefined();
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('21. Concurrent changes to the same target: detects OCC conflict, retries against updated state, and rejects second mutation with REVISION_CONFLICT', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    // Simulate a competing transaction committing a change to ACTIVE_EDITOR after the first transaction's reads complete
    store.onBeforeFirstCommitAttempt = async () => {
      store.setDirectOutsideTx(ADMINS_COLLECTION, ACTIVE_EDITOR.id, {
        ...ACTIVE_EDITOR,
        role: AdminRole.LibraryCurator,
        revision: 2,
      });
    };

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'REVISION_CONFLICT'
    );

    expect(store.conflictRetryCount).toBe(1);
    expect(store.attemptCount).toBe(2);
    const persisted = store.getDocData(ADMINS_COLLECTION, ACTIVE_EDITOR.id);
    expect(persisted?.role).toBe(AdminRole.LibraryCurator);
    expect(persisted?.isActive).toBe(true);
    expect(persisted?.revision).toBe(2);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('22. Concurrent mutations of two different Owners: preserves last-active-Owner invariant when two Owners concurrently deactivate or demote each other', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      OWNER_SECONDARY,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    // Transaction 2 (OWNER_SECONDARY deactivating OWNER_PRIMARY) reads initial state (2 active Owners).
    // Right before Transaction 2 commits its first attempt, Transaction 1 (OWNER_PRIMARY deactivating OWNER_SECONDARY) commits!
    let tx1Result: Awaited<ReturnType<typeof repo.deactivateAdminAtomic>> | null =
      null;

    store.onBeforeFirstCommitAttempt = async () => {
      tx1Result = await repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: OWNER_SECONDARY.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      });
    };

    // Transaction 2 detects the read-set conflict on the admins collection / Owner records,
    // aborts attempt #1, retries attempt #2 against Transaction 1's committed state,
    // and fails closed because OWNER_SECONDARY is now inactive (and OWNER_PRIMARY is the last active Owner).
    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_SECONDARY.id,
        targetUid: OWNER_PRIMARY.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INACTIVE_ACTOR'
    );

    expect(tx1Result).not.toBeNull();
    expect(store.conflictRetryCount).toBe(1);

    const ownerPrimaryAfter = store.getDocData(
      ADMINS_COLLECTION,
      OWNER_PRIMARY.id
    );
    const ownerSecondaryAfter = store.getDocData(
      ADMINS_COLLECTION,
      OWNER_SECONDARY.id
    );

    expect(ownerPrimaryAfter?.isActive).toBe(true);
    expect(ownerPrimaryAfter?.role).toBe(AdminRole.Owner);
    expect(ownerSecondaryAfter?.isActive).toBe(false);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(1);
  });

  it('23. Truncated administrative snapshot rejected: fails closed when admins collection exceeds bounded scan limit or omits verified records', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      OWNER_SECONDARY,
      ACTIVE_EDITOR,
    ]);

    // Case A: Directory size exceeds maxAdminScanLimit (2 < 3 records)
    const boundedRepo = new FirestoreAdminIdentityLifecycleRepository(
      store.db,
      { maxAdminScanLimit: 2 }
    );

    await expectLifecyclePersistenceError(
      boundedRepo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INCOMPLETE_OWNER_SNAPSHOT'
    );

    // Case B: Query snapshot explicitly flagged truncated
    const standardRepo = new FirestoreAdminIdentityLifecycleRepository(
      store.db
    );
    store.forceTruncatedQuerySnapshot = true;

    await expectLifecyclePersistenceError(
      standardRepo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INCOMPLETE_OWNER_SNAPSHOT'
    );
    store.forceTruncatedQuerySnapshot = false;

    // Case C: Query snapshot omits the verified target document
    store.omitDocIdsFromCollectionQuery.add(ACTIVE_EDITOR.id);
    await expectLifecyclePersistenceError(
      standardRepo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'INCOMPLETE_OWNER_SNAPSHOT'
    );
    store.omitDocIdsFromCollectionQuery.clear();

    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('24. Transaction retry revalidates authorization: fails closed on retry when actor loses Owner role concurrently before commit', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      OWNER_SECONDARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    // Before OWNER_SECONDARY's transaction commits attempt #1, OWNER_PRIMARY demotes OWNER_SECONDARY to TrainingManager
    store.onBeforeFirstCommitAttempt = async () => {
      store.setDirectOutsideTx(ADMINS_COLLECTION, OWNER_SECONDARY.id, {
        ...OWNER_SECONDARY,
        role: AdminRole.TrainingManager,
        revision: 2,
      });
    };

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_SECONDARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 1,
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'UNAUTHORIZED_ACTOR'
    );

    expect(store.conflictRetryCount).toBe(1);
    expect(store.attemptCount).toBe(2);
    expect(
      store.getDocData(ADMINS_COLLECTION, ACTIVE_EDITOR.id)?.isActive
    ).toBe(true);
    expect(store.collections[ADMIN_AUDIT_LOGS_COLLECTION].size).toBe(0);
  });

  it('25. No Firebase Auth account mutation: executes transitions and revision initialization with zero calls to firebase-admin/auth', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
      LEGACY_UNVERSIONED_ADMIN,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await repo.initializeLegacyAdminRevisionAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: LEGACY_UNVERSIONED_ADMIN.id,
      clock: fixedClock(BASE_TIME_ISO),
    });

    await repo.deactivateAdminAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 1,
      clock: fixedClock(BASE_TIME_ISO),
    });

    expect(authModuleSpy).not.toHaveBeenCalled();
  });

  it('26. No production Firestore access: never invokes getFirestore() when operating on injected database adapter', async () => {
    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await repo.changeAdminRoleAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 1,
      targetRole: AdminRole.Trainer,
      clock: fixedClock(BASE_TIME_ISO),
    });

    expect(firestoreModuleSpy).not.toHaveBeenCalled();
  });

  it('27. No bypass of AUTH-04A1 transition rules: delegates validation to validateAdminIdentityLifecycleTransition and rejects client privilege spoofing', async () => {
    const contractSpy = vi.spyOn(
      lifecycleContractModule,
      'validateAdminIdentityLifecycleTransition'
    );

    const store = createOccTransactionalFirestoreFake([
      OWNER_PRIMARY,
      ACTIVE_EDITOR,
    ]);
    const repo = new FirestoreAdminIdentityLifecycleRepository(store.db);

    await repo.changeAdminRoleAtomic({
      auditEventId: generateCryptographicLifecycleAuditEventId(),
      authenticatedActorUid: OWNER_PRIMARY.id,
      targetUid: ACTIVE_EDITOR.id,
      expectedRevision: 1,
      targetRole: AdminRole.LibraryCurator,
      clock: fixedClock(BASE_TIME_ISO),
    });

    expect(contractSpy).toHaveBeenCalledTimes(1);

    await expectLifecyclePersistenceError(
      repo.deactivateAdminAtomic({
        auditEventId: generateCryptographicLifecycleAuditEventId(),
        authenticatedActorUid: OWNER_PRIMARY.id,
        targetUid: ACTIVE_EDITOR.id,
        expectedRevision: 2,
        untrustedClientClaims: {
          isOwner: true,
          activeOwnerCount: 99,
        },
        clock: fixedClock(BASE_TIME_ISO),
      }),
      'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED'
    );

    contractSpy.mockRestore();
  });
});
