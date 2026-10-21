import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeCrc32,
  computeSha256Hex,
} from '../../functions/src/news/editorialBinaryInspector';
import {
  AdminRole,
  type AdminUser,
} from '../../functions/src/shared/adminContract';
import {
  type AdminRepository,
} from '../../functions/src/admin/adminRepository';
import {
  EditorialBinaryIntakeError,
  EditorialBinaryIntakeService,
  type EditorialBinaryIntakeSession,
  type EditorialBinaryIntakeSessionStatus,
  type StorageWriteIfAbsentRequest,
} from '../../functions/src/news/editorialBinaryIntakeService';
import {
  type CallableRequestContext,
  EditorialImageRightsReviewService,
  InMemoryEditorialImageRightsReviewRunner,
} from '../../functions/src/news/editorialImageRightsReviewService';
import { InMemoryEditorialImageAssetRepository } from '../../functions/src/news/inMemoryEditorialImageAssetRepository';
import {
  FirestoreEditorialBinaryIntakeSessionStore,
  type IntakeSessionFirestoreCollectionRef,
  type IntakeSessionFirestoreDatabase,
  type IntakeSessionFirestoreDocumentRef,
  type IntakeSessionFirestoreDocumentSnapshot,
  type IntakeSessionFirestoreQuery,
  type IntakeSessionFirestoreQuerySnapshot,
  type IntakeSessionFirestoreTransaction,
} from '../../functions/src/news/firestoreEditorialBinaryIntakeSessionStore';
import {
  GcsEditorialBinaryStorageAdapter,
  type GcsDeleteOptions,
  type GcsEditorialBinaryBucket,
  type GcsEditorialBinaryFile,
  type GcsFileMetadataResponse,
  type GcsSaveOptions,
  validateAndParseCanonicalStoragePath,
} from '../../functions/src/news/gcsEditorialBinaryStorageAdapter';

// ============================================================================
// Deterministic Fixture Helpers
// ============================================================================

function buildPngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = computeCrc32(chunk, 4, 8 + data.length);
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

function buildValidPngBuffer(options?: {
  width?: number;
  height?: number;
}): Buffer {
  const width = options?.width ?? 1200;
  const height = options?.height ?? 800;
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA color type
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = buildPngChunk('IHDR', ihdrData);

  const rawScanline = Buffer.alloc(1 + width * 4, 0);
  const fakeCompressedIdat = Buffer.concat([
    Buffer.from([0x78, 0x01]),
    rawScanline.subarray(0, Math.min(rawScanline.length, 32)),
  ]);
  const idatChunk = buildPngChunk('IDAT', fakeCompressedIdat);
  const iendChunk = buildPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const SAMPLE_FINGERPRINT = 'a'.repeat(64);

function createSampleSession(
  intakeId = 'intake_test_01',
  status: EditorialBinaryIntakeSessionStatus = 'Created',
  revision = 1
): EditorialBinaryIntakeSession {
  return {
    intakeId,
    targetKind: 'editorial_image_asset',
    assetId: 'asset_2026_abc123',
    uploaderUid: 'admin_editor_1',
    uploaderRole: AdminRole.ContentEditor,
    requestFingerprint: SAMPLE_FINGERPRINT,
    status,
    revision,
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-18T12:00:00.000Z',
    expiresAt: '2026-04-18T13:00:00.000Z',
    createdQuarantineObjects: [],
    createdPrivateObjects: [],
    pendingCleanupObjects: [],
    canonicalRegistrationAttempted: false,
    canonicalRegistrationSucceeded: false,
    registrationOutcomeUnknown: false,
  };
}

class InMemoryTestAdminRepository implements AdminRepository {
  private readonly users = new Map<string, AdminUser>();

  constructor(initialUsers: readonly AdminUser[] = []) {
    for (const u of initialUsers) {
      this.users.set(u.id, { ...u });
    }
  }

  public setAdmin(user: AdminUser): void {
    this.users.set(user.id, { ...user });
  }

  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    const u = this.users.get(uid);
    return u ? { ...u } : null;
  }

  async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    const cloned = { ...admin };
    this.users.set(admin.id, cloned);
    return { ...cloned };
  }
}

const CONTENT_EDITOR_ADMIN: AdminUser = {
  id: 'admin_editor_1',
  name: 'Editorial Creator',
  email: 'editor@promiseofplanet.org',
  role: AdminRole.ContentEditor,
  isActive: true,
};

// ============================================================================
// Shared In-Memory Fake Backing Stores (Simulating Persistent Cloud Services)
// ============================================================================

/**
 * Shared in-memory data store for Firestore documents.
 * Simulates document isolation, collection queries, and transactional writes.
 */
class SharedFirestoreBackingStore {
  public readonly collections: Map<string, Map<string, Record<string, unknown>>> =
    new Map();

  public getDoc(collection: string, docId: string): Record<string, unknown> | null {
    const col = this.collections.get(collection);
    if (!col) return null;
    const doc = col.get(docId);
    if (!doc) return null;
    return JSON.parse(JSON.stringify(doc));
  }

  public setDoc(
    collection: string,
    docId: string,
    data: Record<string, unknown>
  ): void {
    let col = this.collections.get(collection);
    if (!col) {
      col = new Map();
      this.collections.set(collection, col);
    }
    col.set(docId, JSON.parse(JSON.stringify(data)));
  }

  public deleteDoc(collection: string, docId: string): boolean {
    const col = this.collections.get(collection);
    if (!col) return false;
    return col.delete(docId);
  }

  public listDocs(
    collection: string
  ): Array<{ id: string; data: Record<string, unknown> }> {
    const col = this.collections.get(collection);
    if (!col) return [];
    return Array.from(col.entries()).map(([id, data]) => ({
      id,
      data: JSON.parse(JSON.stringify(data)),
    }));
  }
}

/**
 * Creates a Fake Firestore Database wrapping the shared store.
 */
interface RecordedQuery {
  readonly collection: string;
  readonly filters: ReadonlyArray<{ field: string; op: string; val: unknown }>;
  readonly orderBys: ReadonlyArray<{ field: string; direction: 'asc' | 'desc' }>;
  readonly limit?: number;
}

function createFakeFirestoreDatabase(
  store: SharedFirestoreBackingStore,
  spyRecorder?: {
    recordQuery?(queryDesc: RecordedQuery): void;
  }
): IntakeSessionFirestoreDatabase {
  function makeQuery(
    collectionName: string,
    initialFilters: Array<{ field: string; op: string; val: unknown }> = [],
    initialOrderBys: Array<{ field: string; direction: 'asc' | 'desc' }> = []
  ): IntakeSessionFirestoreQuery {
    const filters = [...initialFilters];
    const orderBys = [...initialOrderBys];
    let queryLimit: number | undefined;

    const query: IntakeSessionFirestoreQuery = {
      where(
        nextField: string,
        nextOp: string,
        nextVal: unknown
      ): IntakeSessionFirestoreQuery {
        filters.push({ field: nextField, op: nextOp, val: nextVal });
        return query;
      },
      orderBy(
        nextField: string,
        directionStr?: 'asc' | 'desc'
      ): IntakeSessionFirestoreQuery {
        orderBys.push({ field: nextField, direction: directionStr ?? 'asc' });
        return query;
      },
      limit(limitCount: number): IntakeSessionFirestoreQuery {
        queryLimit = limitCount;
        return query;
      },
      async get(): Promise<IntakeSessionFirestoreQuerySnapshot> {
        if (spyRecorder?.recordQuery) {
          spyRecorder.recordQuery({
            collection: collectionName,
            filters: [...filters],
            orderBys: [...orderBys],
            limit: queryLimit,
          });
        }
        const allDocs = store.listDocs(collectionName);
        const matched = allDocs.filter(({ data }) => {
          for (const f of filters) {
            const docVal = data[f.field];
            if (f.op === '==' && docVal !== f.val) return false;
            if (f.op === '<=' && (docVal as any) > (f.val as any))
              return false;
            if (f.op === '>=' && (docVal as any) < (f.val as any))
              return false;
            if (f.op === '<' && (docVal as any) >= (f.val as any))
              return false;
            if (f.op === '>' && (docVal as any) <= (f.val as any))
              return false;
          }
          return true;
        });

        // Server-side ordering before limit
        if (orderBys.length > 0) {
          matched.sort((a, b) => {
            for (const ob of orderBys) {
              const valA = a.data[ob.field];
              const valB = b.data[ob.field];
              let diff = 0;
              if (typeof valA === 'string' && typeof valB === 'string') {
                diff = valA.localeCompare(valB);
              } else if (typeof valA === 'number' && typeof valB === 'number') {
                diff = valA - valB;
              }
              if (diff !== 0) {
                return ob.direction === 'desc' ? -diff : diff;
              }
            }
            return 0;
          });
        }

        const limited =
          queryLimit !== undefined
            ? matched.slice(0, queryLimit)
            : matched;
        const docSnapshots: IntakeSessionFirestoreDocumentSnapshot[] =
          limited.map(({ id, data }) => ({
            id,
            exists: true,
            data: () => data,
          }));
        return {
          empty: docSnapshots.length === 0,
          size: docSnapshots.length,
          docs: docSnapshots,
        };
      },
    };
    return query;
  }

  return {
    collection(collectionName: string): IntakeSessionFirestoreCollectionRef {
      return {
        doc(documentId: string): IntakeSessionFirestoreDocumentRef {
          return {
            id: documentId,
            async get(): Promise<IntakeSessionFirestoreDocumentSnapshot> {
              const data = store.getDoc(collectionName, documentId);
              return {
                id: documentId,
                exists: data !== null,
                data: () => data,
              };
            },
          };
        },
        where(
          fieldPath: string,
          opStr: string,
          value: unknown
        ): IntakeSessionFirestoreQuery {
          return makeQuery(
            collectionName,
            [{ field: fieldPath, op: opStr, val: value }],
            []
          );
        },
        orderBy(
          fieldPath: string,
          directionStr?: 'asc' | 'desc'
        ): IntakeSessionFirestoreQuery {
          return makeQuery(
            collectionName,
            [],
            [{ field: fieldPath, direction: directionStr ?? 'asc' }]
          );
        },
      };
    },
    async runTransaction<T>(
      updateFunction: (
        transaction: IntakeSessionFirestoreTransaction
      ) => Promise<T>
    ): Promise<T> {
      const stagedWrites = new Map<
        string,
        { collection: string; id: string; data: Record<string, unknown> }
      >();

      const transaction: IntakeSessionFirestoreTransaction = {
        async get(
          docRef: IntakeSessionFirestoreDocumentRef
        ): Promise<IntakeSessionFirestoreDocumentSnapshot> {
          const stageKey = `${FirestoreEditorialBinaryIntakeSessionStore.COLLECTION}/${docRef.id}`;
          if (stagedWrites.has(stageKey)) {
            const staged = stagedWrites.get(stageKey)!.data;
            return {
              id: docRef.id,
              exists: true,
              data: () => JSON.parse(JSON.stringify(staged)),
            };
          }
          const data = store.getDoc(
            FirestoreEditorialBinaryIntakeSessionStore.COLLECTION,
            docRef.id
          );
          return {
            id: docRef.id,
            exists: data !== null,
            data: () => data,
          };
        },
        create(
          docRef: IntakeSessionFirestoreDocumentRef,
          data: Record<string, unknown>
        ) {
          const stageKey = `${FirestoreEditorialBinaryIntakeSessionStore.COLLECTION}/${docRef.id}`;
          stagedWrites.set(stageKey, {
            collection: FirestoreEditorialBinaryIntakeSessionStore.COLLECTION,
            id: docRef.id,
            data: JSON.parse(JSON.stringify(data)),
          });
        },
        set(
          docRef: IntakeSessionFirestoreDocumentRef,
          data: Record<string, unknown>
        ) {
          const stageKey = `${FirestoreEditorialBinaryIntakeSessionStore.COLLECTION}/${docRef.id}`;
          stagedWrites.set(stageKey, {
            collection: FirestoreEditorialBinaryIntakeSessionStore.COLLECTION,
            id: docRef.id,
            data: JSON.parse(JSON.stringify(data)),
          });
        },
      };

      const result = await updateFunction(transaction);
      for (const write of stagedWrites.values()) {
        store.setDoc(write.collection, write.id, write.data);
      }
      return result;
    },
  };
}

/**
 * Shared in-memory data store for GCS objects.
 * Simulates object generations, metadata, preconditions, and conditional deletion.
 */
class SharedGcsBackingStore {
  private generationCounter = 1000;
  public readonly objects: Map<
    string,
    {
      bytes: Buffer;
      metadata: GcsFileMetadataResponse;
      generation: string;
    }
  > = new Map();

  public failNextSave = false;
  public failNextDelete = false;
  public failNextGetMetadata = false;

  public save(
    name: string,
    bytes: Buffer,
    options?: GcsSaveOptions
  ): void {
    if (this.failNextSave) {
      this.failNextSave = false;
      const err = new Error('Simulated network socket timeout during upload.');
      (err as any).code = 'ECONNRESET';
      throw err;
    }

    const ifGenMatch =
      options?.preconditionOpts?.ifGenerationMatch ??
      options?.preconditions?.ifGenerationMatch;

    const existing = this.objects.get(name);
    if (ifGenMatch === 0 || ifGenMatch === '0') {
      if (existing) {
        const err = new Error(
          `Precondition Failed: Object ${name} already exists.`
        );
        (err as any).code = 412;
        throw err;
      }
    } else if (ifGenMatch !== undefined) {
      const matchStr = String(ifGenMatch);
      if (!existing || existing.generation !== matchStr) {
        const err = new Error(
          `Precondition Failed: Generation mismatch for ${name}.`
        );
        (err as any).code = 412;
        throw err;
      }
    }

    this.generationCounter += 1;
    const newGen = String(this.generationCounter);
    const nowIso = new Date().toISOString();

    const fileMeta: GcsFileMetadataResponse = {
      generation: newGen,
      metageneration: 1,
      contentType: options?.contentType ?? 'application/octet-stream',
      size: bytes.length,
      updated: nowIso,
      timeCreated: nowIso,
      etag: `etag_${newGen}`,
      metadata: options?.metadata?.metadata ? { ...options.metadata.metadata } : {},
    };

    this.objects.set(name, {
      bytes: Buffer.from(bytes),
      metadata: fileMeta,
      generation: newGen,
    });
  }

  public getMetadata(name: string): GcsFileMetadataResponse {
    if (this.failNextGetMetadata) {
      this.failNextGetMetadata = false;
      const err = new Error('Simulated network error during metadata retrieval.');
      (err as any).code = 'ECONNRESET';
      throw err;
    }
    const existing = this.objects.get(name);
    if (!existing) {
      const err = new Error(`Not Found: ${name}`);
      (err as any).code = 404;
      throw err;
    }
    return JSON.parse(JSON.stringify(existing.metadata));
  }

  public delete(name: string, options?: GcsDeleteOptions): void {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      const err = new Error('Simulated storage error during delete.');
      (err as any).code = 'EIO';
      throw err;
    }
    const existing = this.objects.get(name);
    if (!existing) {
      const err = new Error(`Not Found: ${name}`);
      (err as any).code = 404;
      throw err;
    }
    const ifGenMatch =
      options?.preconditionOpts?.ifGenerationMatch ??
      options?.preconditions?.ifGenerationMatch;

    if (ifGenMatch !== undefined && String(ifGenMatch) !== existing.generation) {
      const err = new Error(`Precondition Failed: Generation ${ifGenMatch} !== ${existing.generation}`);
      (err as any).code = 412;
      throw err;
    }

    this.objects.delete(name);
  }

  public download(name: string): Buffer {
    const existing = this.objects.get(name);
    if (!existing) {
      const err = new Error(`Not Found: ${name}`);
      (err as any).code = 404;
      throw err;
    }
    return Buffer.from(existing.bytes);
  }
}

/**
 * Creates a Fake GCS Bucket wrapping the shared store.
 */
function createFakeGcsBucket(
  store: SharedGcsBackingStore,
  bucketName = 'test-editorial-bucket'
): GcsEditorialBinaryBucket {
  return {
    name: bucketName,
    file(name: string): GcsEditorialBinaryFile {
      return {
        name,
        async save(data: Buffer, options?: GcsSaveOptions): Promise<void> {
          store.save(name, data, options);
        },
        async getMetadata(): Promise<[GcsFileMetadataResponse, unknown]> {
          const meta = store.getMetadata(name);
          return [meta, {}];
        },
        async delete(options?: GcsDeleteOptions): Promise<[unknown] | void> {
          store.delete(name, options);
        },
        async download(): Promise<[Buffer]> {
          const data = store.download(name);
          return [data];
        },
      };
    },
  };
}

// ============================================================================
// Test Suite: Persistent Adapters for Binary Intake
// ============================================================================

describe('IMG-F3-06 — FirestoreEditorialBinaryIntakeSessionStore', () => {
  it('creates a session document with initial revision 1 and supports optimistic concurrency updates', async () => {
    const firestoreStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(firestoreStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    const initial = createSampleSession('intake_001', 'Created', 1);
    const createRes = await store.createSessionIfAbsent(initial);
    expect(createRes.created).toBe(true);
    expect(createRes.session.intakeId).toBe('intake_001');
    expect(createRes.session.revision).toBe(1);

    // Verify reading back session
    const readSession = await store.getSessionById('intake_001');
    expect(readSession).not.toBeNull();
    expect(readSession?.status).toBe('Created');
    expect(readSession?.revision).toBe(1);

    // Update with expectedRevision = 1 -> succeeds and increments revision to 2
    const updated = await store.updateSession(
      {
        ...readSession!,
        status: 'PreliminarilyVerified',
        width: 1200,
        height: 800,
      },
      1
    );
    expect(updated.revision).toBe(2);
    expect(updated.status).toBe('PreliminarilyVerified');

    // Stale update with expectedRevision = 1 -> throws STORAGE_CONFLICT
    await expect(
      store.updateSession(
        {
          ...updated,
          status: 'Promoting',
        },
        1
      )
    ).rejects.toThrow(EditorialBinaryIntakeError);
  });

  it('createSessionIfAbsent is idempotent when session already exists', async () => {
    const firestoreStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(firestoreStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    const session = createSampleSession('intake_idemp_01');
    const first = await store.createSessionIfAbsent(session);
    expect(first.created).toBe(true);

    const second = await store.createSessionIfAbsent(session);
    expect(second.created).toBe(false);
    expect(second.session.intakeId).toBe('intake_idemp_01');
  });

  it('rejects initial creation if revision is not 1', async () => {
    const firestoreStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(firestoreStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    const badRevisionSession = createSampleSession('intake_bad_rev', 'Created', 2);
    await expect(store.createSessionIfAbsent(badRevisionSession)).rejects.toThrow(
      EditorialBinaryIntakeError
    );
  });

  it('enforces immutable identity fields across session updates', async () => {
    const firestoreStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(firestoreStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    const session = createSampleSession('intake_immutable_01');
    await store.createSessionIfAbsent(session);

    // Attempt to tamper with uploaderUid
    await expect(
      store.updateSession(
        {
          ...session,
          uploaderUid: 'tampered_admin_uid',
        },
        1
      )
    ).rejects.toThrow(/immutable identity\/binding fields/);

    // Attempt to tamper with targetKind
    await expect(
      store.updateSession(
        {
          ...session,
          targetKind: 'rights_evidence_binary',
        },
        1
      )
    ).rejects.toThrow(/immutable identity\/binding fields/);

    // Attempt to tamper with assetId
    await expect(
      store.updateSession(
        {
          ...session,
          assetId: 'asset_2026_tampered',
        },
        1
      )
    ).rejects.toThrow(/immutable identity\/binding fields/);
  });

  it('preserves state across distinct newly constructed adapter instances (simulating process restart)', async () => {
    const sharedStore = new SharedFirestoreBackingStore();

    // Instance A writes session
    const storeA = new FirestoreEditorialBinaryIntakeSessionStore(
      createFakeFirestoreDatabase(sharedStore)
    );
    const session = createSampleSession('intake_restart_01');
    await storeA.createSessionIfAbsent(session);

    // Worker process restarts: Instance B initialized from scratch
    const storeB = new FirestoreEditorialBinaryIntakeSessionStore(
      createFakeFirestoreDatabase(sharedStore)
    );
    const loaded = await storeB.getSessionById('intake_restart_01');
    expect(loaded).not.toBeNull();
    expect(loaded?.intakeId).toBe('intake_restart_01');

    // Instance B performs successful revision update
    const updated = await storeB.updateSession(
      {
        ...loaded!,
        status: 'NeedsReconciliation',
      },
      1
    );
    expect(updated.revision).toBe(2);
    expect(updated.status).toBe('NeedsReconciliation');

    // Instance C created, observes revision 2
    const storeC = new FirestoreEditorialBinaryIntakeSessionStore(
      createFakeFirestoreDatabase(sharedStore)
    );
    const loadedC = await storeC.getSessionById('intake_restart_01');
    expect(loadedC?.revision).toBe(2);
  });

  it('listSessionsForReconciliation executes bounded queries, filters terminal sessions, and sorts deterministically', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    const s1: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_s1', 'NeedsReconciliation'),
      expiresAt: '2026-04-18T14:00:00.000Z',
    };
    const s2: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_s2', 'CleanupPending'),
      expiresAt: '2026-04-18T13:30:00.000Z',
    };
    const s3: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_s3', 'Completed'),
      expiresAt: '2026-04-18T12:30:00.000Z', // Completed, even if expired, must not be reconciled
    };
    const s4: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_s4', 'Registering'),
      expiresAt: '2026-04-18T15:00:00.000Z',
    };

    await store.createSessionIfAbsent(s1);
    await store.createSessionIfAbsent(s2);
    await store.createSessionIfAbsent(s3);
    await store.createSessionIfAbsent(s4);

    const results = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T14:30:00.000Z',
      limit: 10,
    });

    const ids = results.map((r) => r.intakeId);
    expect(ids).toContain('intake_s1');
    expect(ids).toContain('intake_s2');
    expect(ids).toContain('intake_s4');
    expect(ids).not.toContain('intake_s3'); // Terminal Completed session omitted

    // Verify ordering: expiresAt ascending (s2 at 13:30, s1 at 14:00, s4 at 15:00)
    expect(ids[0]).toBe('intake_s2');
    expect(ids[1]).toBe('intake_s1');
    expect(ids[2]).toBe('intake_s4');
  });

  it('fails closed when reading corrupted/tampered records in Firestore', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    sharedStore.setDoc(
      FirestoreEditorialBinaryIntakeSessionStore.COLLECTION,
      'intake_corrupt_01',
      {
        intakeId: 'intake_corrupt_01',
        status: 'BogusStatus',
      }
    );

    await expect(store.getSessionById('intake_corrupt_01')).rejects.toThrow(
      EditorialBinaryIntakeError
    );
  });

  it('discovers actionable expired Created session despite 105 older expired Completed sessions (remediation of starvation defect)', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    // 105 older expired Completed sessions
    for (let i = 0; i < 105; i++) {
      const pad = String(i).padStart(3, '0');
      const completedSession: EditorialBinaryIntakeSession = {
        ...createSampleSession(`intake_completed_${pad}`, 'Completed'),
        createdAt: '2026-04-18T09:00:00.000Z',
        updatedAt: '2026-04-18T09:30:00.000Z',
        expiresAt: `2026-04-18T10:00:${String(i % 60).padStart(2, '0')}.000Z`,
        canonicalRegistrationAttempted: true,
        canonicalRegistrationSucceeded: true,
      };
      await store.createSessionIfAbsent(completedSession);
    }

    // 1 expired unfinished Created session that is newer in expiresAt
    const actionableSession: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_created_actionable', 'Created'),
      createdAt: '2026-04-18T10:30:00.000Z',
      updatedAt: '2026-04-18T10:30:00.000Z',
      expiresAt: '2026-04-18T11:00:00.000Z',
    };
    await store.createSessionIfAbsent(actionableSession);

    // Bounded discovery call with limit = 50
    const discovered = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 50,
    });

    // The actionable session must NOT be starved by the 105 older Completed sessions!
    expect(discovered).toHaveLength(1);
    expect(discovered[0].intakeId).toBe('intake_created_actionable');
    expect(discovered[0].status).toBe('Created');
  });

  it('demonstrates repeated bounded discovery and forward progress across multiple batches without starvation', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    // Plant 120 expired Created sessions
    for (let i = 0; i < 120; i++) {
      const pad = String(i).padStart(3, '0');
      const session: EditorialBinaryIntakeSession = {
        ...createSampleSession(`intake_fwd_${pad}`, 'Created'),
        createdAt: '2026-04-18T10:00:00.000Z',
        updatedAt: '2026-04-18T10:00:00.000Z',
        expiresAt: `2026-04-18T11:00:${String(i % 60).padStart(2, '0')}.000Z`,
      };
      await store.createSessionIfAbsent(session);
    }

    // Batch 1 (limit 50): discovers first 50
    const batch1 = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 50,
    });
    expect(batch1).toHaveLength(50);

    // Simulate reconciliation worker transitioning batch 1 to Completed
    for (const s of batch1) {
      await store.updateSession(
        {
          ...s,
          status: 'Completed',
          canonicalRegistrationSucceeded: true,
        },
        s.revision
      );
    }

    // Batch 2 (limit 50): discovers next 50
    const batch2 = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 50,
    });
    expect(batch2).toHaveLength(50);
    expect(batch2[0].intakeId).not.toBe(batch1[0].intakeId);

    // Reconcile batch 2
    for (const s of batch2) {
      await store.updateSession(
        {
          ...s,
          status: 'Completed',
          canonicalRegistrationSucceeded: true,
        },
        s.revision
      );
    }

    // Batch 3 (limit 50): discovers remaining 20
    const batch3 = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 50,
    });
    expect(batch3).toHaveLength(20);

    // Reconcile batch 3
    for (const s of batch3) {
      await store.updateSession(
        {
          ...s,
          status: 'Completed',
          canonicalRegistrationSucceeded: true,
        },
        s.revision
      );
    }

    // Batch 4: zero sessions remaining
    const batch4 = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 50,
    });
    expect(batch4).toHaveLength(0);
  });

  it('structurally excludes terminal Completed and clean Failed records from occupying the discovery window', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    // Completed session
    const completedSession: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_term_completed', 'Completed'),
      expiresAt: '2026-04-18T10:00:00.000Z',
    };
    await store.createSessionIfAbsent(completedSession);

    // Clean Failed session (pendingCleanupObjects empty)
    const failedCleanSession: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_term_failed', 'Failed'),
      expiresAt: '2026-04-18T10:00:00.000Z',
      pendingCleanupObjects: [],
    };
    await store.createSessionIfAbsent(failedCleanSession);

    // Active session
    const activeSession: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_active_reconcile', 'NeedsReconciliation'),
      expiresAt: '2026-04-18T14:00:00.000Z',
    };
    await store.createSessionIfAbsent(activeSession);

    const discovered = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 10,
    });

    expect(discovered).toHaveLength(1);
    expect(discovered[0].intakeId).toBe('intake_active_reconcile');
  });

  it('fails closed and surfaces STORAGE_FAILURE when discovering a malformed session document during reconciliation', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    // Directly plant a corrupted record under an actionable status
    sharedStore.setDoc(
      FirestoreEditorialBinaryIntakeSessionStore.COLLECTION,
      'intake_malformed_recon_01',
      {
        intakeId: 'intake_malformed_recon_01',
        status: 'NeedsReconciliation',
      }
    );

    // Must NOT swallow corruption silently; must fail closed with STORAGE_FAILURE
    await expect(
      store.listSessionsForReconciliation({
        nowIso: '2026-04-18T12:00:00.000Z',
        limit: 10,
      })
    ).rejects.toThrow(EditorialBinaryIntakeError);

    try {
      await store.listSessionsForReconciliation({
        nowIso: '2026-04-18T12:00:00.000Z',
        limit: 10,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(EditorialBinaryIntakeError);
      const e = err as EditorialBinaryIntakeError;
      expect(e.code).toBe('STORAGE_FAILURE');
      expect(e.message).toContain('Corrupted intake session record encountered');
      expect(e.intakeId).toBe('intake_malformed_recon_01');
    }
  });

  it('excludes nonexpired in-flight sessions at the query level so 105 nonexpired sessions do not starve an expired actionable session', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    // Plant 105 nonexpired Created sessions (expiresAt in future: 13:00)
    for (let i = 0; i < 105; i++) {
      const pad = String(i).padStart(3, '0');
      const unexpiredSession: EditorialBinaryIntakeSession = {
        ...createSampleSession(`intake_unexpired_created_${pad}`, 'Created'),
        createdAt: '2026-04-18T11:00:00.000Z',
        updatedAt: '2026-04-18T11:00:00.000Z',
        expiresAt: `2026-04-18T13:00:${String(i % 60).padStart(2, '0')}.000Z`,
      };
      await store.createSessionIfAbsent(unexpiredSession);
    }

    // Plant 1 expired Created session (expiresAt in past: 11:30)
    const expiredSession: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_expired_created_target', 'Created'),
      createdAt: '2026-04-18T10:00:00.000Z',
      updatedAt: '2026-04-18T10:00:00.000Z',
      expiresAt: '2026-04-18T11:30:00.000Z',
    };
    await store.createSessionIfAbsent(expiredSession);

    // Bounded discovery call with limit = 50: must find the single expired session and not be filled by unexpired sessions
    const discovered50 = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 50,
    });
    expect(discovered50).toHaveLength(1);
    expect(discovered50[0].intakeId).toBe('intake_expired_created_target');
    expect(discovered50[0].status).toBe('Created');

    // Bounded discovery call with limit = 100: must still find exactly the 1 expired session
    const discovered100 = await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 100,
    });
    expect(discovered100).toHaveLength(1);
    expect(discovered100[0].intakeId).toBe('intake_expired_created_target');
  });

  it('selects directly actionable statuses regardless of expiration, while requiring expiration for in-flight active statuses', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    const futureIso = '2026-04-18T16:00:00.000Z';
    const nowIso = '2026-04-18T12:00:00.000Z';

    // 4 directly actionable statuses with future expiresAt
    const directStatuses: readonly EditorialBinaryIntakeSessionStatus[] = [
      'NeedsReconciliation',
      'CleanupPending',
      'Registering',
      'Registered',
    ];
    for (const status of directStatuses) {
      const session: EditorialBinaryIntakeSession = {
        ...createSampleSession(`intake_direct_${status}`, status),
        expiresAt: futureIso,
      };
      await store.createSessionIfAbsent(session);
    }

    // 4 in-flight active statuses with future expiresAt (NOT yet expired, should NOT be returned)
    const inFlightStatuses: readonly EditorialBinaryIntakeSessionStatus[] = [
      'Created',
      'Quarantined',
      'PreliminarilyVerified',
      'Promoting',
    ];
    for (const status of inFlightStatuses) {
      const session: EditorialBinaryIntakeSession = {
        ...createSampleSession(`intake_inflight_${status}`, status),
        expiresAt: futureIso,
      };
      await store.createSessionIfAbsent(session);
    }

    const discovered = await store.listSessionsForReconciliation({
      nowIso,
      limit: 50,
    });

    const discoveredIds = discovered.map((s) => s.intakeId);
    expect(discovered).toHaveLength(4);
    for (const status of directStatuses) {
      expect(discoveredIds).toContain(`intake_direct_${status}`);
    }
    for (const status of inFlightStatuses) {
      expect(discoveredIds).not.toContain(`intake_inflight_${status}`);
    }
  });

  it('rejects invalid or non-canonical nowIso strings with INVALID_INPUT', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const db = createFakeFirestoreDatabase(sharedStore);
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    await expect(
      store.listSessionsForReconciliation({ nowIso: 'not-a-timestamp' })
    ).rejects.toThrow(EditorialBinaryIntakeError);

    try {
      await store.listSessionsForReconciliation({ nowIso: '2026/04/18 12:00' });
    } catch (err) {
      expect(err).toBeInstanceOf(EditorialBinaryIntakeError);
      const e = err as EditorialBinaryIntakeError;
      expect(e.code).toBe('INVALID_INPUT');
      expect(e.message).toContain('Invalid nowIso timestamp');
    }
  });

  it('verifies exact query predicates, composite index configuration, and firebase.json references', async () => {
    const sharedStore = new SharedFirestoreBackingStore();
    const recordedQueries: RecordedQuery[] = [];
    const db = createFakeFirestoreDatabase(sharedStore, {
      recordQuery: (q) => recordedQueries.push(q),
    });
    const store = new FirestoreEditorialBinaryIntakeSessionStore(db);

    await store.listSessionsForReconciliation({
      nowIso: '2026-04-18T12:00:00.000Z',
      limit: 50,
    });

    // Verify directly actionable queries:
    // status == X, orderBy expiresAt asc, limit 50
    const directStatuses = [
      'NeedsReconciliation',
      'CleanupPending',
      'Registering',
      'Registered',
    ];
    for (const status of directStatuses) {
      const q = recordedQueries.find(
        (rec) =>
          rec.filters.length === 1 &&
          rec.filters[0].field === 'status' &&
          rec.filters[0].val === status
      );
      expect(q).toBeDefined();
      expect(q?.orderBys).toEqual([{ field: 'expiresAt', direction: 'asc' }]);
      expect(q?.limit).toBe(50);
    }

    // Verify expiry-gated queries:
    // status == X, expiresAt <= nowIso, orderBy expiresAt asc, limit 50
    const expiryStatuses = [
      'Created',
      'Quarantined',
      'PreliminarilyVerified',
      'Promoting',
    ];
    for (const status of expiryStatuses) {
      const q = recordedQueries.find(
        (rec) =>
          rec.filters.some((f) => f.field === 'status' && f.val === status) &&
          rec.filters.some(
            (f) =>
              f.field === 'expiresAt' &&
              f.op === '<=' &&
              f.val === '2026-04-18T12:00:00.000Z'
          )
      );
      expect(q).toBeDefined();
      expect(q?.orderBys).toEqual([{ field: 'expiresAt', direction: 'asc' }]);
      expect(q?.limit).toBe(50);
    }

    // Verify firestore.indexes.json exists, is valid JSON, and matches exact composite index spec
    const indexesContent = fs.readFileSync('firestore.indexes.json', 'utf8');
    const parsedIndexes = JSON.parse(indexesContent);
    expect(parsedIndexes).toEqual({
      indexes: [
        {
          collectionGroup: 'editorial_binary_intake_sessions',
          queryScope: 'COLLECTION',
          fields: [
            {
              fieldPath: 'status',
              order: 'ASCENDING',
            },
            {
              fieldPath: 'expiresAt',
              order: 'ASCENDING',
            },
          ],
        },
      ],
      fieldOverrides: [],
    });

    // Verify firebase.json contains the firestore.indexes configuration
    const firebaseConfigContent = fs.readFileSync('firebase.json', 'utf8');
    const parsedFirebaseConfig = JSON.parse(firebaseConfigContent);
    expect(parsedFirebaseConfig.firestore).toBeDefined();
    expect(parsedFirebaseConfig.firestore.rules).toBe('firestore.rules');
    expect(parsedFirebaseConfig.firestore.indexes).toBe('firestore.indexes.json');
  });
});

describe('IMG-F3-06 — GcsEditorialBinaryStorageAdapter', () => {
  it('validates canonical storage paths and rejects invalid namespaces, traversals, and extensions', () => {
    // Valid paths
    expect(() =>
      validateAndParseCanonicalStoragePath(
        'editorial_intake_quarantine/images/intake_001/source.png'
      )
    ).not.toThrow();
    expect(() =>
      validateAndParseCanonicalStoragePath(
        'editorial_images/private/asset_2026_abc123/thumbnail.png'
      )
    ).not.toThrow();
    expect(() =>
      validateAndParseCanonicalStoragePath(
        'editorial_rights_evidence/private/asset_2026_abc123/evidence_2026_xyz/artifact.pdf'
      )
    ).not.toThrow();

    // Invalid: path traversal
    expect(() =>
      validateAndParseCanonicalStoragePath(
        'editorial_images/private/../asset_2026_abc123/thumbnail.png'
      )
    ).toThrow(/traversal/i);

    // Invalid: disallowed variant
    expect(() =>
      validateAndParseCanonicalStoragePath(
        'editorial_images/private/asset_2026_abc123/not_a_variant.png'
      )
    ).toThrow(/invalid variantKey/i);

    // Invalid: disallowed extension
    expect(() =>
      validateAndParseCanonicalStoragePath(
        'editorial_images/private/asset_2026_abc123/thumbnail.exe'
      )
    ).toThrow(/invalid image extension/i);
  });

  it('writeIfAbsent enforces ifGenerationMatch: 0 and reports storage conflict on second write', async () => {
    const gcsStore = new SharedGcsBackingStore();
    const bucket = createFakeGcsBucket(gcsStore);
    const adapter = new GcsEditorialBinaryStorageAdapter({ bucket });

    const pngBuffer = buildValidPngBuffer();
    const sha = computeSha256Hex(pngBuffer);

    const writeReq: StorageWriteIfAbsentRequest = {
      storagePath: 'editorial_images/private/asset_2026_abc123/thumbnail.png',
      bytes: pngBuffer,
      contentType: 'image/png',
      sha256Checksum: sha,
      ownership: {
        createdByIntakeId: 'intake_001',
        uploaderUid: 'admin_editor_1',
        assetId: 'asset_2026_abc123',
        namespace: 'private',
        targetKind: 'editorial_image_asset',
      },
    };

    const first = await adapter.writeIfAbsent(writeReq);
    expect(first.created).toBe(true);
    if (!first.created) throw new Error('Expected first write created');
    expect(first.metadata.storagePath).toBe(writeReq.storagePath);
    expect(first.metadata.generation).toBeDefined();

    // Second write to same path: precondition 0 fails, returns created: false
    const second = await adapter.writeIfAbsent(writeReq);
    expect(second.created).toBe(false);
    if (second.created) throw new Error('Expected second write not created');
    expect(second.existingMetadata.generation).toBe(first.metadata.generation);
  });

  it('deleteIfGenerationMatches enforces generation match and ownership validation', async () => {
    const gcsStore = new SharedGcsBackingStore();
    const bucket = createFakeGcsBucket(gcsStore);
    const adapter = new GcsEditorialBinaryStorageAdapter({ bucket });

    const pngBuffer = buildValidPngBuffer();
    const sha = computeSha256Hex(pngBuffer);
    const path = 'editorial_images/private/asset_2026_abc123/thumbnail.png';

    const writeRes = await adapter.writeIfAbsent({
      storagePath: path,
      bytes: pngBuffer,
      contentType: 'image/png',
      sha256Checksum: sha,
      ownership: {
        createdByIntakeId: 'intake_001',
        uploaderUid: 'admin_editor_1',
        assetId: 'asset_2026_abc123',
        namespace: 'private',
        targetKind: 'editorial_image_asset',
      },
    });

    if (!writeRes.created) throw new Error('Expected writeRes created');
    const generation = writeRes.metadata.generation;

    // Attempt delete with mismatched ownership
    const mismatchOwnerRes = await adapter.deleteIfGenerationMatches({
      storagePath: path,
      expectedGeneration: generation,
      expectedIntakeId: 'different_intake_id',
    });
    expect(mismatchOwnerRes.deleted).toBe(false);
    expect(mismatchOwnerRes.reason).toBe('OWNERSHIP_MISMATCH');

    // Attempt delete with mismatched generation
    const mismatchGenRes = await adapter.deleteIfGenerationMatches({
      storagePath: path,
      expectedGeneration: '99999999',
      expectedIntakeId: 'intake_001',
    });
    expect(mismatchGenRes.deleted).toBe(false);
    expect(mismatchGenRes.reason).toBe('GENERATION_MISMATCH');

    // Successful delete with correct generation and intake ID
    const successRes = await adapter.deleteIfGenerationMatches({
      storagePath: path,
      expectedGeneration: generation,
      expectedIntakeId: 'intake_001',
    });
    expect(successRes.deleted).toBe(true);
    expect(successRes.reason).toBe('DELETED');

    // Idempotent delete on already absent file
    const secondDeleteRes = await adapter.deleteIfGenerationMatches({
      storagePath: path,
      expectedGeneration: generation,
      expectedIntakeId: 'intake_001',
    });
    expect(secondDeleteRes.deleted).toBe(false);
    expect(secondDeleteRes.reason).toBe('ALREADY_ABSENT');
  });

  it('shares state across distinct newly constructed GCS adapter instances (process restart)', async () => {
    const sharedGcs = new SharedGcsBackingStore();

    // Adapter A writes file
    const adapterA = new GcsEditorialBinaryStorageAdapter({
      bucket: createFakeGcsBucket(sharedGcs),
    });
    const pngBuffer = buildValidPngBuffer();
    const sha = computeSha256Hex(pngBuffer);
    const path = 'editorial_images/private/asset_2026_abc123/card.png';

    const writeRes = await adapterA.writeIfAbsent({
      storagePath: path,
      bytes: pngBuffer,
      contentType: 'image/png',
      sha256Checksum: sha,
      ownership: {
        createdByIntakeId: 'intake_002',
        uploaderUid: 'admin_editor_1',
        assetId: 'asset_2026_abc123',
        namespace: 'private',
        targetKind: 'editorial_image_asset',
      },
    });

    // Worker restarts: Adapter B constructed from scratch
    const adapterB = new GcsEditorialBinaryStorageAdapter({
      bucket: createFakeGcsBucket(sharedGcs),
    });

    const meta = await adapterB.readMetadata(path);
    expect(meta).not.toBeNull();
    if (!writeRes.created) throw new Error('Expected writeRes created');
    expect(meta?.generation).toBe(writeRes.metadata.generation);

    const readData = await adapterB.readBytes(path);
    expect(readData).not.toBeNull();
    expect(readData?.bytes).toEqual(pngBuffer);
  });

  it('translates network failures into STORAGE_FAILURE errors', async () => {
    const sharedGcs = new SharedGcsBackingStore();
    const adapter = new GcsEditorialBinaryStorageAdapter({
      bucket: createFakeGcsBucket(sharedGcs),
    });
    const pngBuffer = buildValidPngBuffer();
    const sha = computeSha256Hex(pngBuffer);

    sharedGcs.failNextSave = true;
    await expect(
      adapter.writeIfAbsent({
        storagePath: 'editorial_images/private/asset_2026_abc123/thumbnail.png',
        bytes: pngBuffer,
        contentType: 'image/png',
        sha256Checksum: sha,
        ownership: {
          createdByIntakeId: 'intake_001',
          uploaderUid: 'admin_editor_1',
          assetId: 'asset_2026_abc123',
          namespace: 'private',
          targetKind: 'editorial_image_asset',
        },
      })
    ).rejects.toThrow(EditorialBinaryIntakeError);
  });
});

describe('IMG-F3-06 — End-to-End Intake with Persistent Adapters', () => {
  function setupTestHarness() {
    let clockCounter = 0;
    const clock = () => {
      clockCounter += 1;
      return new Date(Date.UTC(2026, 9, 21, 12, 0, clockCounter)).toISOString();
    };

    const sharedFirestore = new SharedFirestoreBackingStore();
    const sharedGcs = new SharedGcsBackingStore();

    const sessionStore = new FirestoreEditorialBinaryIntakeSessionStore(
      createFakeFirestoreDatabase(sharedFirestore)
    );
    const storageAdapter = new GcsEditorialBinaryStorageAdapter({
      bucket: createFakeGcsBucket(sharedGcs),
      clock,
    });

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const adminRepo = new InMemoryTestAdminRepository([CONTENT_EDITOR_ADMIN]);

    const rightsRunner = new InMemoryEditorialImageRightsReviewRunner(
      undefined,
      adminRepo
    );
    const rightsService = new EditorialImageRightsReviewService({
      adminRepository: adminRepo,
      transactionRunner: rightsRunner,
      clock,
    });

    const callerContext: CallableRequestContext = {
      auth: {
        uid: CONTENT_EDITOR_ADMIN.id,
        token: {
          email: CONTENT_EDITOR_ADMIN.email,
        },
      },
    };

    const intakeService = new EditorialBinaryIntakeService({
      adminRepository: adminRepo,
      assetRepository: assetRepo,
      rightsEvidenceBridge: rightsService,
      storageAdapter,
      sessionStore,
      evidenceLookup: (evidenceId: string) =>
        rightsRunner.getEvidenceRecord(evidenceId),
      onAssetRegisteredHook: async (record) => {
        await rightsRunner.seedInitialPendingAsset(record.asset);
      },
      clock,
    });

    return {
      clock,
      sharedFirestore,
      sharedGcs,
      sessionStore,
      storageAdapter,
      intakeService,
      callerContext,
    };
  }

  it('runs complete image intake with persistent Firestore and GCS adapters, verifying final status Completed', async () => {
    const { intakeService, callerContext, sharedFirestore, sharedGcs } =
      setupTestHarness();

    const pngBuffer = buildValidPngBuffer({ width: 1400, height: 900 });

    const result = await intakeService.ingestEditorialImageBinary(
      callerContext,
      {
        intakeId: 'intake_e2e_01',
        assetId: 'asset_2026_e2e01',
        binary: pngBuffer,
        originalFilename: 'planet_banner.png',
        claimedMimeType: 'image/png',
        claimedFilenameOrExtension: 'planet_banner.png',
        origin: 'news_article',
        altAr: 'مؤتمر المناخ الكوكبي',
        altEn: 'Planetary climate conference',
        photographerCredit: 'Planet Archives',
        tags: ['planet', 'climate'],
      }
    );

    expect(result.intakeId).toBe('intake_e2e_01');
    expect(result.sessionStatus).toBe('Completed');
    expect(result.assetRecord.asset.assetId).toBe('asset_2026_e2e01');

    // Verify session in Firestore reached Completed and has tracked objects
    const sessionDoc = sharedFirestore.getDoc(
      FirestoreEditorialBinaryIntakeSessionStore.COLLECTION,
      'intake_e2e_01'
    );
    expect(sessionDoc).not.toBeNull();
    expect(sessionDoc?.status).toBe('Completed');
    const privateObjs = sessionDoc?.createdPrivateObjects as any[];
    expect(privateObjs.length).toBeGreaterThan(0);

    // Verify private objects exist in GCS
    for (const obj of privateObjs) {
      expect(sharedGcs.objects.has(obj.storagePath)).toBe(true);
    }
  });

  /**
   * CRITICAL ARCHITECTURAL TEST: Crash Window & Recovery Gap Analysis
   *
   * Demonstrates the boundary between GCS write completion and Firestore session update.
   * If a crash occurs after GCS write but before Firestore session store records the object generation,
   * reconcileIntake has no knowledge of the orphaned generation. Because conditional deletion
   * requires expectedGeneration and ownership validation, the orphaned object remains un-reconciled.
   */
  it('exposes unrecoverable crash window between GCS write and Firestore session commit (REQUIRES_FOLLOW_UP_DESIGN)', async () => {
    const {
      intakeService,
      storageAdapter,
      sessionStore,
      sharedGcs,
    } = setupTestHarness();

    const intakeId = 'intake_crash_01';
    const assetId = 'asset_2026_crash01';

    // 1. Create session at 'Promoting' in Firestore with no private objects recorded yet
    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession(intakeId, 'Promoting', 1),
      assetId,
    };
    await sessionStore.createSessionIfAbsent(session);

    // 2. Simulate worker process writing a variant object to GCS
    const pngBuffer = buildValidPngBuffer();
    const sha = computeSha256Hex(pngBuffer);
    const variantPath = `editorial_images/private/${assetId}/thumbnail.png`;

    const writeRes = await storageAdapter.writeIfAbsent({
      storagePath: variantPath,
      bytes: pngBuffer,
      contentType: 'image/png',
      sha256Checksum: sha,
      ownership: {
        createdByIntakeId: intakeId,
        uploaderUid: 'admin_editor_1',
        assetId,
        namespace: 'private',
        targetKind: 'editorial_image_asset',
      },
    });

    expect(writeRes.created).toBe(true);
    if (!writeRes.created) throw new Error('Expected writeRes created');
    const orphanedGen = writeRes.metadata.generation;
    expect(sharedGcs.objects.has(variantPath)).toBe(true);

    // 3. Worker CRASHES HERE before calling sessionStore.updateSession() to record createdPrivateObjects.
    // The Firestore session still has empty createdPrivateObjects:
    const docBefore = await sessionStore.getSessionById(intakeId);
    expect(docBefore?.createdPrivateObjects).toHaveLength(0);

    // 4. Background reconciliation runs on the session
    const reconcileOutcome = await intakeService.reconcileIntake(intakeId);

    // 5. Verification of the gap:
    // Reconcile transitions session to Failed, deletedObjectsCount is 0 because
    // the orphaned variant was never recorded in Firestore!
    expect(reconcileOutcome.currentStatus).toBe('Failed');
    expect(reconcileOutcome.deletedObjectsCount).toBe(0);
    expect(sharedGcs.objects.has(variantPath)).toBe(true);

    // The orphaned object remains in GCS with its generation intact
    const survivingMeta = await storageAdapter.readMetadata(variantPath);
    expect(survivingMeta).not.toBeNull();
    expect(survivingMeta?.generation).toBe(orphanedGen);
  });
});
