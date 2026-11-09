import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import process from 'node:process';

class FallbackHttpsError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
): unknown {
  try {
    return originalModuleLoad.call(this, request, parent, isMain);
  } catch (err: unknown) {
    if (request === 'firebase-functions/v2/https') {
      return {
        HttpsError: FallbackHttpsError,
        onCall: (_opts: unknown, handler: unknown) => handler,
        onRequest: (_opts: unknown, handler: unknown) => handler,
      };
    }
    if (request === 'firebase-functions/params') {
      return {
        defineSecret: (name: string) => ({
          name,
          value: () => process.env[name] || '',
        }),
      };
    }
    if (request === 'firebase-admin/auth') {
      return {
        getAuth: () => {
          throw new Error(
            'Uninjected live getAuth() must not be called in headless backend tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error(
            'Uninjected live getFirestore() must not be called in headless backend tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/storage') {
      return {
        getStorage: () => {
          throw new Error(
            'Uninjected live getStorage() must not be called in headless backend tests.'
          );
        },
      };
    }
    throw err;
  }
};

import type { AdminRepository } from '../functions/src/admin/adminRepository';
import {
  AdminPermission,
  AdminRole,
  type AdminUser,
} from '../functions/src/types/admin';
import { CANONICAL_PDF_MIME_TYPE } from '../functions/src/library/libraryUploadBinaryAdmission';
import {
  LibraryQuarantineReceiptState,
  type LibraryQuarantineInternalReceipt,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  FirestoreLibraryQuarantineReceiptStore,
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
  type LibraryQuarantineFirestoreDatabase,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantineFirestoreTransaction,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';
import {
  GcsLibraryQuarantineStorageAdapter,
  LIBRARY_QUARANTINE_CACHE_CONTROL,
  LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
  LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
  type GcsLibraryQuarantineBucket,
  type GcsLibraryQuarantineFile,
  type GcsLibraryQuarantineFileOptions,
  type GcsLibraryQuarantineObjectMetadata,
  type GcsLibraryQuarantineReadableStream,
  type GcsLibraryQuarantineSaveOptions,
} from '../functions/src/library/gcsLibraryQuarantineStorageAdapter';
import {
  FirestoreLibraryQuarantineReviewDraftStore,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
} from '../functions/src/library/firestoreLibraryQuarantineReviewDraftStore';
import type {
  LibraryQuarantineAdminReadFirestoreDatabase,
  LibraryQuarantineAdminReadQueryDocumentSnapshot,
} from '../functions/src/library/libraryQuarantineAdminReadService';
import type { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';
import {
  LIBRARY_QUARANTINE_WORKBENCH_LIST_LIMIT,
  doesPersistedDraftMatchSanitizedAdminReceipt,
  listLatestLibraryQuarantineReviewWorkbenchItems,
} from '../functions/src/library/libraryQuarantineReviewWorkbenchService';

const require = createRequire(import.meta.url);
const {
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
  createProductionLibraryQuarantineReviewDraftBridgeRuntime,
} = require(
  '../functions/src/library/libraryQuarantineReviewDraftCallableBridge'
) as typeof import('../functions/src/library/libraryQuarantineReviewDraftCallableBridge');

const {
  LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR,
  executeManageLibraryDocumentsRequest,
} = require(
  '../functions/src/library/libraryAdminHandlers'
) as typeof import('../functions/src/library/libraryAdminHandlers');

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeValidPdfBuffer(label = 'Quarantine Workbench Spec 01'): Buffer {
  const pdfContent = [
    '%PDF-1.7',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    'endobj',
    '4 0 obj',
    `<< /Length ${label.length + 24} >>`,
    'stream',
    `BT /F1 12 Tf 72 720 Td (${label}) Tj ET`,
    'endstream',
    'endobj',
    'xref',
    '0 5',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000202 00000 n ',
    'trailer',
    '<< /Size 5 /Root 1 0 R >>',
    'startxref',
    '310',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdfContent, 'utf8');
}

function buildHexReceiptId(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function buildReceiptAndPdfBytes(
  index: number,
  overrides: Partial<LibraryQuarantineInternalReceipt> = {}
): {
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly bytes: Buffer;
} {
  const receiptId = overrides.receiptId ?? buildHexReceiptId(index);
  const bytes = makeValidPdfBuffer(`Workbench Document #${index}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const minuteStr = String(index % 60).padStart(2, '0');
  const createdAt = `2026-11-08T10:${minuteStr}:00.000Z`;
  const state = overrides.state ?? LibraryQuarantineReceiptState.Quarantined;
  const updatedAt =
    state === LibraryQuarantineReceiptState.Reserved
      ? createdAt
      : `2026-11-08T10:${minuteStr}:02.000Z`;
  const defaultRevision =
    state === LibraryQuarantineReceiptState.Reserved
      ? 1
      : state === LibraryQuarantineReceiptState.WritePending ||
          state === LibraryQuarantineReceiptState.Rejected
        ? 2
        : 3;
  const generation =
    overrides.generation !== undefined
      ? overrides.generation
      : state === LibraryQuarantineReceiptState.Quarantined
        ? `1731072000${String(index).padStart(6, '0')}`
        : null;
  const reconciliationReason =
    overrides.reconciliationReason !== undefined
      ? overrides.reconciliationReason
      : state === LibraryQuarantineReceiptState.NeedsReconciliation
        ? 'GCS conditional write outcome was ambiguous during finalize.'
        : null;
  const rejectionReasonCode =
    overrides.rejectionReasonCode !== undefined
      ? overrides.rejectionReasonCode
      : state === LibraryQuarantineReceiptState.Rejected
        ? 'PDF_ACTIVE_CONTENT_DETECTED'
        : null;

  const receipt: LibraryQuarantineInternalReceipt = Object.freeze({
    receiptId,
    uploaderUid: 'admin-curator',
    originalFilename: `environmental-policy-${index}.pdf`,
    sanitizedFilename: `environmental-policy-${index}.pdf`,
    format: 'PDF' as const,
    canonicalExtension: 'pdf' as const,
    canonicalMimeType: CANONICAL_PDF_MIME_TYPE,
    byteSize: bytes.byteLength,
    sha256,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    storagePath: `library/quarantine/${receiptId}/source.pdf`,
    state,
    generation,
    reconciliationReason,
    rejectionReasonCode,
    createdAt,
    updatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });

  const envelope: LibraryQuarantinePersistedReceiptEnvelope = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision: defaultRevision,
    state: receipt.state,
    receipt,
  });

  return { receipt, envelope, bytes };
}

class InMemoryAdminRepo implements AdminRepository {
  private readonly users = new Map<string, AdminUser>();
  public getAdminCalls = 0;

  constructor(users: readonly AdminUser[]) {
    for (const u of users) {
      this.users.set(u.id, Object.freeze({ ...u }));
    }
  }

  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    this.getAdminCalls += 1;
    return this.users.get(uid) ?? null;
  }

  async listAdmins(): Promise<AdminUser[]> {
    return Array.from(this.users.values());
  }

  async saveAdmin(_admin: AdminUser): Promise<AdminUser> {
    throw new Error('saveAdmin forbidden in workbench tests.');
  }
}

class InMemoryWorkbenchFirestoreDatabase
  implements
    LibraryQuarantineAdminReadFirestoreDatabase,
    LibraryQuarantineFirestoreDatabase,
    LibraryQuarantineReviewDraftFirestoreDatabase
{
  private readonly collections = new Map<string, Map<string, unknown>>();
  public queryGetCalls = 0;
  public receiptPointGetCalls = 0;
  public draftPointGetCalls = 0;
  public draftPointGetIds: string[] = [];
  public transactionCalls = 0;
  public receiptWriteCalls = 0;
  public draftCreateCalls = 0;
  public unboundedCollectionScanCalls = 0;
  public throwAfterStagedDraftCreate: Error | null = null;
  public onBeforeTransactionRead: (() => void) | null = null;

  private getCol(name: string): Map<string, unknown> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map<string, unknown>();
      this.collections.set(name, col);
    }
    return col;
  }

  public seedDoc(colName: string, id: string, data: unknown): void {
    this.getCol(colName).set(id, deepClone(data));
  }

  public getRawDoc(colName: string, id: string): unknown {
    const found = this.getCol(colName).get(id);
    return found !== undefined ? deepClone(found) : undefined;
  }

  public resetCounters(): void {
    this.queryGetCalls = 0;
    this.receiptPointGetCalls = 0;
    this.draftPointGetCalls = 0;
    this.draftPointGetIds = [];
    this.transactionCalls = 0;
    this.receiptWriteCalls = 0;
    this.draftCreateCalls = 0;
    this.unboundedCollectionScanCalls = 0;
    this.throwAfterStagedDraftCreate = null;
    this.onBeforeTransactionRead = null;
  }

  public collection(collectionName: string): any {
    const colMap = this.getCol(collectionName);
    return {
      get: async () => {
        this.unboundedCollectionScanCalls += 1;
        throw new Error(
          `Unbounded collection.get() on "${collectionName}" is strictly forbidden.`
        );
      },
      orderBy: (fieldPath: string, directionStr?: 'asc' | 'desc') => {
        assert.equal(collectionName, LIBRARY_QUARANTINE_RECEIPT_COLLECTION);
        assert.equal(fieldPath, 'receipt.createdAt');
        assert.equal(directionStr, 'desc');
        return {
          limit: (limitCount: number) => {
            assert.equal(limitCount, LIBRARY_QUARANTINE_WORKBENCH_LIST_LIMIT);
            return {
              get: async () => {
                this.queryGetCalls += 1;
                const entries = Array.from(colMap.entries()).map(
                  ([id, data]) => ({
                    id,
                    data: deepClone(data) as Record<string, unknown>,
                  })
                );
                entries.sort((a, b) => {
                  const aCreated = String(
                    (a.data.receipt as Record<string, unknown>)?.createdAt ?? ''
                  );
                  const bCreated = String(
                    (b.data.receipt as Record<string, unknown>)?.createdAt ?? ''
                  );
                  return bCreated.localeCompare(aCreated);
                });
                const sliced = entries.slice(0, limitCount);
                const docs: LibraryQuarantineAdminReadQueryDocumentSnapshot[] =
                  sliced.map((entry) => ({
                    id: entry.id,
                    exists: true,
                    data: () => deepClone(entry.data),
                  }));
                return {
                  empty: docs.length === 0,
                  size: docs.length,
                  docs,
                };
              },
            };
          },
        };
      },
      doc: (documentId: string): LibraryQuarantineFirestoreDocumentRef => ({
        id: documentId,
        get: async (): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
          if (collectionName === LIBRARY_QUARANTINE_RECEIPT_COLLECTION) {
            this.receiptPointGetCalls += 1;
          } else if (
            collectionName === LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION
          ) {
            this.draftPointGetCalls += 1;
            this.draftPointGetIds.push(documentId);
          }
          const raw = colMap.get(documentId);
          return {
            id: documentId,
            exists: raw !== undefined,
            data: () =>
              raw !== undefined
                ? (deepClone(raw) as Record<string, unknown>)
                : undefined,
          };
        },
      }),
    };
  }

  public async runTransaction<T>(
    updateFunction: (transaction: any) => Promise<T>
  ): Promise<T> {
    this.transactionCalls += 1;
    if (this.onBeforeTransactionRead) {
      this.onBeforeTransactionRead();
    }

    const stagedCreates: Array<{
      readonly colName: string;
      readonly docId: string;
      readonly data: Record<string, unknown>;
    }> = [];

    const resolveColName = (
      docRef: LibraryQuarantineFirestoreDocumentRef
    ): string => {
      // Determine collection by checking whether it's the source receipt or draft
      if (this.getCol(LIBRARY_QUARANTINE_RECEIPT_COLLECTION).has(docRef.id)) {
        return LIBRARY_QUARANTINE_RECEIPT_COLLECTION;
      }
      return LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION;
    };

    const tx: LibraryQuarantineFirestoreTransaction = {
      get: async (
        docRef: LibraryQuarantineFirestoreDocumentRef
      ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
        // Distinguish receipt vs draft get in transaction by checking call order in 01B store:
        // 01B store calls transaction.get(sourceReceiptRef) first, then transaction.get(draftDocRef).
        return docRef.get!();
      },
      create: (
        docRef: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ) => {
        const colName =
          data.schemaVersion === LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION &&
          'reviewState' in data
            ? LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION
            : resolveColName(docRef);
        if (colName === LIBRARY_QUARANTINE_RECEIPT_COLLECTION) {
          this.receiptWriteCalls += 1;
        } else {
          this.draftCreateCalls += 1;
        }
        stagedCreates.push({
          colName,
          docId: docRef.id,
          data: deepClone(data),
        });
      },
      set: () => {
        this.receiptWriteCalls += 1;
        throw new Error(
          'transaction.set() is forbidden during review draft linking.'
        );
      },
    };

    const result = await updateFunction(tx);

    if (this.throwAfterStagedDraftCreate && stagedCreates.length > 0) {
      throw this.throwAfterStagedDraftCreate;
    }

    for (const staged of stagedCreates) {
      const col = this.getCol(staged.colName);
      if (col.has(staged.docId)) {
        throw new Error(`Document "${staged.docId}" already exists.`);
      }
      col.set(staged.docId, staged.data);
    }

    return result;
  }
}

class InMemoryDedicatedGcsBucket implements GcsLibraryQuarantineBucket {
  public readonly name = LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME;
  private readonly objects = new Map<
    string,
    {
      readonly bytes: Buffer;
      readonly metadata: GcsLibraryQuarantineObjectMetadata;
      readonly generation: string;
    }
  >();
  public getMetadataCalls = 0;
  public readStreamCalls = 0;
  public saveCalls = 0;

  public seedObject(
    receipt: LibraryQuarantineInternalReceipt,
    bytes: Buffer
  ): void {
    const gen = receipt.generation ?? '1731072000000001';
    this.objects.set(receipt.storagePath, {
      bytes: Buffer.from(bytes),
      generation: gen,
      metadata: {
        name: receipt.storagePath,
        bucket: this.name,
        generation: gen,
        metageneration: '1',
        contentType: receipt.canonicalMimeType,
        cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
        contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
        size: String(bytes.byteLength),
        metadata: {
          receiptId: receipt.receiptId,
          uploaderUid: receipt.uploaderUid,
          sha256: receipt.sha256,
          format: receipt.format,
          quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
        },
      },
    });
  }

  public file(
    objectPath: string,
    options?: GcsLibraryQuarantineFileOptions
  ): GcsLibraryQuarantineFile {
    const pinnedGen = options?.generation;
    return {
      name: objectPath,
      ...(pinnedGen !== undefined ? { generation: pinnedGen } : {}),
      save: async (
        _data: Buffer,
        _opts: GcsLibraryQuarantineSaveOptions
      ): Promise<void> => {
        this.saveCalls += 1;
        throw new Error('GCS file.save() is forbidden in workbench tests.');
      },
      getMetadata: async (): Promise<[GcsLibraryQuarantineObjectMetadata]> => {
        this.getMetadataCalls += 1;
        const found = this.objects.get(objectPath);
        if (!found) {
          const err = new Error('Not Found') as Error & { code: number };
          err.code = 404;
          throw err;
        }
        return [deepClone(found.metadata)];
      },
      createReadStream: (): GcsLibraryQuarantineReadableStream => {
        this.readStreamCalls += 1;
        const found = this.objects.get(objectPath);
        return {
          destroy(): void {},
          async *[Symbol.asyncIterator]() {
            if (!found || (pinnedGen && pinnedGen !== found.generation)) {
              const err = new Error('Generation or object not found') as Error & {
                code: number;
              };
              err.code = 404;
              throw err;
            }
            yield found.bytes;
          },
        };
      },
    };
  }
}

function buildAdminFixtures(): Readonly<Record<string, AdminUser>> {
  return Object.freeze({
    owner: {
      id: 'admin-owner',
      email: 'owner@promiseofplanet.org',
      name: 'Owner',
      role: AdminRole.Owner,
      isActive: true,
    },
    curator: {
      id: 'admin-curator',
      email: 'curator@promiseofplanet.org',
      name: 'Library Curator',
      role: AdminRole.LibraryCurator,
      isActive: true,
    },
    rightsReviewer: {
      id: 'admin-rights',
      email: 'rights@promiseofplanet.org',
      name: 'Rights Reviewer',
      role: AdminRole.RightsReviewer,
      isActive: true,
    },
    viewOnlyLibrary: {
      id: 'admin-view-only',
      email: 'viewonly@promiseofplanet.org',
      name: 'View Only Curator',
      role: AdminRole.LibraryCurator,
      permissions: [AdminPermission.View],
      isActive: true,
    } as AdminUser,
    inactiveCurator: {
      id: 'admin-inactive',
      email: 'inactive@promiseofplanet.org',
      name: 'Inactive Curator',
      role: AdminRole.LibraryCurator,
      isActive: false,
    },
    aiAssistant: {
      id: 'admin-ai',
      email: 'ai@promiseofplanet.org',
      name: 'AI Assistant',
      role: AdminRole.AIAssistant,
      isActive: true,
    },
    newsEditor: {
      id: 'admin-news',
      email: 'content@promiseofplanet.org',
      name: 'Content Editor',
      role: AdminRole.ContentEditor,
      isActive: true,
    },
  });
}

const uncalledService = new Proxy({} as LibraryApplicationService, {
  get(_target, prop) {
    throw new Error(
      `LibraryApplicationService.${String(prop)} must never be called by quarantine review workbench actions.`
    );
  },
});

async function runTests(): Promise<void> {
  let passed = 0;
  const admins = buildAdminFixtures();

  // =========================================================================
  // TEST 1: Server Release Gate (`POP_LIBRARY_REVIEW_WORKBENCH_ENABLED === 'true'`)
  // =========================================================================
  {
    const previousEnv = process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR];
    delete process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR];

    const adminRepo = new InMemoryAdminRepo(Object.values(admins));
    const db = new InMemoryWorkbenchFirestoreDatabase();
    const bucket = new InMemoryDedicatedGcsBucket();

    try {
      await assert.rejects(
        () =>
          executeManageLibraryDocumentsRequest(
            {
              auth: { uid: admins.curator.id },
              data: { action: 'listQuarantineReviewWorkbench' },
            },
            adminRepo,
            uncalledService,
            undefined,
            undefined,
            undefined,
            db
          ),
        (err: any) =>
          err?.code === 'failed-precondition' &&
          String(err?.message).startsWith('WORKBENCH_NOT_RELEASED:')
      );

      await assert.rejects(
        () =>
          executeManageLibraryDocumentsRequest(
            {
              auth: { uid: admins.curator.id },
              data: {
                action: 'linkQuarantineReviewDraft',
                receiptId: buildHexReceiptId(1),
              },
            },
            adminRepo,
            uncalledService,
            undefined,
            undefined,
            undefined,
            db
          ),
        (err: any) =>
          err?.code === 'failed-precondition' &&
          String(err?.message).startsWith('WORKBENCH_NOT_RELEASED:')
      );

      // Zero calls to AdminRepository, Firestore, or GCS when release gate is closed
      assert.equal(adminRepo.getAdminCalls, 0);
      assert.equal(db.queryGetCalls, 0);
      assert.equal(db.draftPointGetCalls, 0);
      assert.equal(db.transactionCalls, 0);
      assert.equal(bucket.getMetadataCalls, 0);
    } finally {
      if (previousEnv === undefined) {
        delete process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR];
      } else {
        process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR] = previousEnv;
      }
    }
    passed += 1;
    console.log(
      '✓ 1. Release gate blocks listQuarantineReviewWorkbench and linkQuarantineReviewDraft with WORKBENCH_NOT_RELEASED before touching AdminRepository, Firestore, or GCS'
    );
  }

  // =========================================================================
  // TEST 2: Read composition classification, bounded 20 limit, point-lookup discipline, and zero GCS reads
  // =========================================================================
  {
    const db = new InMemoryWorkbenchFirestoreDatabase();
    const bucket = new InMemoryDedicatedGcsBucket();

    // Receipt 1: Quarantined without draft -> NOT_LINKED
    const r1 = buildReceiptAndPdfBytes(1, {
      state: LibraryQuarantineReceiptState.Quarantined,
    });
    // Receipt 2: Quarantined with valid linked draft -> PENDING_HUMAN_REVIEW
    const r2 = buildReceiptAndPdfBytes(2, {
      state: LibraryQuarantineReceiptState.Quarantined,
    });
    // Receipt 3: NeedsReconciliation -> NEEDS_RECONCILIATION_HOLD (0 draft lookups)
    const r3 = buildReceiptAndPdfBytes(3, {
      state: LibraryQuarantineReceiptState.NeedsReconciliation,
    });
    // Receipt 4: Rejected -> NOT_ELIGIBLE (0 draft lookups)
    const r4 = buildReceiptAndPdfBytes(4, {
      state: LibraryQuarantineReceiptState.Rejected,
    });
    // Receipt 5: Reserved -> NOT_ELIGIBLE (0 draft lookups)
    const r5 = buildReceiptAndPdfBytes(5, {
      state: LibraryQuarantineReceiptState.Reserved,
    });

    for (const item of [r1, r2, r3, r4, r5]) {
      db.seedDoc(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        item.receipt.receiptId,
        item.envelope
      );
    }

    // Seed valid 15-field persisted draft for r2 only
    db.seedDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      r2.receipt.receiptId,
      {
        schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
        receiptId: r2.receipt.receiptId,
        sourceRevision: r2.envelope.revision,
        sourceUpdatedAt: r2.receipt.updatedAt,
        sourceSha256: r2.receipt.sha256,
        format: r2.receipt.format,
        uploaderUid: r2.receipt.uploaderUid,
        reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
        createdBy: admins.curator.id,
        createdAt: '2026-11-08T11:00:00.000Z',
      }
    );

    const readRes = await listLatestLibraryQuarantineReviewWorkbenchItems({
      receiptReadDatabase: db,
      draftDatabase: db,
    });

    assert.equal(readRes.ok, true);
    if (readRes.ok) {
      assert.equal(readRes.receipts.length, 5);
      // Ordered newest-first: r5 (10:05), r4 (10:04), r3 (10:03), r2 (10:02), r1 (10:01)
      const byId = new Map(
        readRes.receipts.map((item) => [item.adminReceipt.receiptId, item])
      );
      assert.equal(byId.get(r1.receipt.receiptId)?.draftStatus, 'NOT_LINKED');
      assert.equal(
        byId.get(r2.receipt.receiptId)?.draftStatus,
        'PENDING_HUMAN_REVIEW'
      );
      assert.equal(
        byId.get(r3.receipt.receiptId)?.draftStatus,
        'NEEDS_RECONCILIATION_HOLD'
      );
      assert.equal(byId.get(r4.receipt.receiptId)?.draftStatus, 'NOT_ELIGIBLE');
      assert.equal(byId.get(r5.receipt.receiptId)?.draftStatus, 'NOT_ELIGIBLE');

      // Ensure no raw draft fields (`createdBy`), `storagePath`, or `generation` leaked
      const serialized = JSON.stringify(readRes.receipts);
      assert.equal(serialized.includes('createdBy'), false);
      assert.equal(serialized.includes('storagePath'), false);
      assert.equal(serialized.includes('generation'), false);
      assert.equal(serialized.includes('library/quarantine/'), false);
    }

    // Point-lookup discipline: ONLY r2 and r1 (Quarantined) triggered draft point lookups!
    assert.equal(db.queryGetCalls, 1);
    assert.equal(db.draftPointGetCalls, 2);
    assert.deepEqual(
      new Set(db.draftPointGetIds),
      new Set([r1.receipt.receiptId, r2.receipt.receiptId])
    );
    assert.equal(db.unboundedCollectionScanCalls, 0);
    assert.equal(bucket.getMetadataCalls, 0);
    assert.equal(bucket.readStreamCalls, 0);

    passed += 1;
    console.log(
      '✓ 2. Read composition classifies NOT_LINKED, PENDING_HUMAN_REVIEW, NEEDS_RECONCILIATION_HOLD, and NOT_ELIGIBLE with point-lookup discipline and 0 GCS calls'
    );
  }

  // =========================================================================
  // TEST 3: Whole-response fail-closed on corrupted draft, source mismatch, security flag escalation, or lookup error
  // =========================================================================
  {
    const r1 = buildReceiptAndPdfBytes(10);
    const r2 = buildReceiptAndPdfBytes(11);

    // 3a. Mismatched sourceRevision between draft and receipt -> DRAFT_SOURCE_MISMATCH
    const dbMismatch = new InMemoryWorkbenchFirestoreDatabase();
    dbMismatch.seedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      r1.receipt.receiptId,
      r1.envelope
    );
    dbMismatch.seedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      r2.receipt.receiptId,
      r2.envelope
    );
    dbMismatch.seedDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      r1.receipt.receiptId,
      {
        schemaVersion: 1,
        receiptId: r1.receipt.receiptId,
        sourceRevision: r1.envelope.revision + 1, // MISMATCH!
        sourceUpdatedAt: r1.receipt.updatedAt,
        sourceSha256: r1.receipt.sha256,
        format: r1.receipt.format,
        uploaderUid: r1.receipt.uploaderUid,
        reviewState: 'PENDING_HUMAN_REVIEW',
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
        createdBy: admins.curator.id,
        createdAt: '2026-11-08T12:00:00.000Z',
      }
    );

    const mismatchRes = await listLatestLibraryQuarantineReviewWorkbenchItems({
      receiptReadDatabase: dbMismatch,
      draftDatabase: dbMismatch,
    });
    assert.equal(mismatchRes.ok, false);
    if (!mismatchRes.ok) {
      assert.equal(mismatchRes.errorCode, 'DRAFT_SOURCE_MISMATCH');
    }

    // 3b. Escalated posture flag -> SECURITY_POSTURE_VIOLATION
    const dbEscalated = new InMemoryWorkbenchFirestoreDatabase();
    dbEscalated.seedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      r1.receipt.receiptId,
      r1.envelope
    );
    dbEscalated.seedDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      r1.receipt.receiptId,
      {
        schemaVersion: 1,
        receiptId: r1.receipt.receiptId,
        sourceRevision: r1.envelope.revision,
        sourceUpdatedAt: r1.receipt.updatedAt,
        sourceSha256: r1.receipt.sha256,
        format: r1.receipt.format,
        uploaderUid: r1.receipt.uploaderUid,
        reviewState: 'PENDING_HUMAN_REVIEW',
        isSanitized: true, // ESCALATED!
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
        createdBy: admins.curator.id,
        createdAt: '2026-11-08T12:00:00.000Z',
      }
    );
    const escalatedRes = await listLatestLibraryQuarantineReviewWorkbenchItems({
      receiptReadDatabase: dbEscalated,
      draftDatabase: dbEscalated,
    });
    assert.equal(escalatedRes.ok, false);
    if (!escalatedRes.ok) {
      assert.equal(escalatedRes.errorCode, 'SECURITY_POSTURE_VIOLATION');
    }

    // 3c. Draft store infrastructure failure never fakes NOT_LINKED and never leaks raw error strings
    const failingStoreRes =
      await listLatestLibraryQuarantineReviewWorkbenchItems({
        receiptReadDatabase: dbEscalated,
        draftStore: {
          getReviewDraftByReceiptId: async () => {
            throw new Error(
              'RAW_FIRESTORE_SECRET: projects/promiseofplanet-bb325/databases/(default)'
            );
          },
        },
      });
    assert.equal(failingStoreRes.ok, false);
    if (!failingStoreRes.ok) {
      assert.equal(failingStoreRes.errorCode, 'DRAFT_LOOKUP_FAILED');
      assert.equal(
        failingStoreRes.errorMessage.includes('RAW_FIRESTORE_SECRET'),
        false
      );
      assert.equal(
        failingStoreRes.errorMessage.includes('promiseofplanet-bb325'),
        false
      );
    }

    // Also verify helper `doesPersistedDraftMatchSanitizedAdminReceipt`
    assert.equal(typeof doesPersistedDraftMatchSanitizedAdminReceipt, 'function');

    passed += 1;
    console.log(
      '✓ 3. Read composition fails the entire response on draft/source mismatch, security flag escalation, or draft lookup failure without leaking raw errors'
    );
  }

  // =========================================================================
  // TEST 4: RBAC & Caller Input Validation on listQuarantineReviewWorkbench and linkQuarantineReviewDraft
  // =========================================================================
  {
    const adminRepo = new InMemoryAdminRepo(Object.values(admins));
    const db = new InMemoryWorkbenchFirestoreDatabase();
    const r1 = buildReceiptAndPdfBytes(21);
    db.seedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      r1.receipt.receiptId,
      r1.envelope
    );

    const workbenchOpts = {
      workbenchEnabled: true,
      receiptReadDatabase: db,
      draftDatabase: db,
    };

    // Unauthenticated rejected
    await assert.rejects(
      () =>
        executeManageLibraryDocumentsRequest(
          { data: { action: 'listQuarantineReviewWorkbench' } },
          adminRepo,
          uncalledService,
          undefined,
          undefined,
          undefined,
          db,
          workbenchOpts
        ),
      (err: any) => err?.code === 'unauthenticated'
    );

    // AI Assistant rejected
    await assert.rejects(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: admins.aiAssistant.id },
            data: { action: 'listQuarantineReviewWorkbench' },
          },
          adminRepo,
          uncalledService,
          undefined,
          undefined,
          undefined,
          db,
          workbenchOpts
        ),
      (err: any) => err?.code === 'permission-denied'
    );

    // NewsEditor rejected
    await assert.rejects(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: admins.newsEditor.id },
            data: { action: 'listQuarantineReviewWorkbench' },
          },
          adminRepo,
          uncalledService,
          undefined,
          undefined,
          undefined,
          db,
          workbenchOpts
        ),
      (err: any) => err?.code === 'permission-denied'
    );

    // Extra field in listQuarantineReviewWorkbench rejected
    await assert.rejects(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: admins.curator.id },
            data: {
              action: 'listQuarantineReviewWorkbench',
              extraField: 'forbidden',
            },
          },
          adminRepo,
          uncalledService,
          undefined,
          undefined,
          undefined,
          db,
          workbenchOpts
        ),
      (err: any) => err?.code === 'invalid-argument'
    );

    // View-only Library admin CAN listQuarantineReviewWorkbench, but CANNOT linkQuarantineReviewDraft!
    const viewOnlyList = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: admins.viewOnlyLibrary.id },
        data: { action: 'listQuarantineReviewWorkbench' },
      },
      adminRepo,
      uncalledService,
      undefined,
      undefined,
      undefined,
      db,
      workbenchOpts
    );
    assert.equal(viewOnlyList.receipts.length, 1);

    await assert.rejects(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: admins.viewOnlyLibrary.id },
            data: {
              action: 'linkQuarantineReviewDraft',
              receiptId: r1.receipt.receiptId,
            },
          },
          adminRepo,
          uncalledService,
          undefined,
          undefined,
          undefined,
          db,
          workbenchOpts
        ),
      (err: any) => err?.code === 'permission-denied'
    );

    // Extra caller field or forged uid in linkQuarantineReviewDraft rejected before AdminRepository lookup
    const callsBeforeForged = adminRepo.getAdminCalls;
    await assert.rejects(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: admins.curator.id },
            data: {
              action: 'linkQuarantineReviewDraft',
              receiptId: r1.receipt.receiptId,
              uid: admins.owner.id,
            },
          },
          adminRepo,
          uncalledService,
          undefined,
          undefined,
          undefined,
          db,
          workbenchOpts
        ),
      (err: any) => err?.code === 'invalid-argument'
    );
    assert.equal(adminRepo.getAdminCalls, callsBeforeForged);

    passed += 1;
    console.log(
      '✓ 4. Enforces strict View vs Review RBAC and rejects unauthenticated, AI, non-Library, or extra caller fields'
    );
  }

  // =========================================================================
  // TEST 5: Genuine End-to-End Integration of linkQuarantineReviewDraft + listQuarantineReviewWorkbench
  //         (01C Bridge + 01B Persistence + 01A Contract + Generation-Pinned GCS + Atomic Firestore Tx)
  // =========================================================================
  {
    const adminRepo = new InMemoryAdminRepo(Object.values(admins));
    const db = new InMemoryWorkbenchFirestoreDatabase();
    const bucket = new InMemoryDedicatedGcsBucket();

    const r1 = buildReceiptAndPdfBytes(31);
    db.seedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      r1.receipt.receiptId,
      r1.envelope
    );
    bucket.seedObject(r1.receipt, r1.bytes);

    // Build real 01C production runtime bound to our in-memory Firestore & dedicated GCS bucket
    const bridgeRuntime = createProductionLibraryQuarantineReviewDraftBridgeRuntime(
      {
        adminRepository: adminRepo,
        receiptStore: new FirestoreLibraryQuarantineReceiptStore(db),
        storageReadbackPort: new GcsLibraryQuarantineStorageAdapter({
          bucket,
          clock: () => '2026-11-09T12:00:00.000Z',
        }),
        draftStore: new FirestoreLibraryQuarantineReviewDraftStore(db),
        clock: () => '2026-11-09T12:00:00.000Z',
      }
    );

    const workbenchOpts = {
      workbenchEnabled: true,
      receiptReadDatabase: db,
      draftDatabase: db,
      bridgeDependencies: bridgeRuntime,
    };

    // Step A: Initial listQuarantineReviewWorkbench returns NOT_LINKED
    const initialList = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: admins.curator.id },
        data: { action: 'listQuarantineReviewWorkbench' },
      },
      adminRepo,
      uncalledService,
      undefined,
      undefined,
      undefined,
      db,
      workbenchOpts
    );
    assert.equal(initialList.receipts.length, 1);
    assert.equal(initialList.receipts[0].draftStatus, 'NOT_LINKED');

    // Step B: Execute linkQuarantineReviewDraft -> CREATED (13-key DTO)
    adminRepo.getAdminCalls = 0;
    const linkCreated = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: admins.curator.id },
        data: {
          action: 'linkQuarantineReviewDraft',
          receiptId: r1.receipt.receiptId,
        },
      },
      adminRepo,
      uncalledService,
      undefined,
      undefined,
      undefined,
      db,
      workbenchOpts
    );

    assert.equal(linkCreated.ok, true);
    assert.equal(Object.keys(linkCreated).length, 13);
    assert.equal(linkCreated.status, 'LINKED_PENDING_HUMAN_REVIEW');
    assert.equal(linkCreated.receiptId, r1.receipt.receiptId);
    assert.equal(linkCreated.sourceRevision, 3);
    assert.equal(linkCreated.reviewState, 'PENDING_HUMAN_REVIEW');
    assert.equal(linkCreated.disposition, 'CREATED');
    assert.equal(linkCreated.draftCreationOutcome, 'CREATED');
    assert.equal(linkCreated.draftCreated, true);
    assert.equal(linkCreated.isSanitized, false);
    assert.equal(linkCreated.isVerifiedSafe, false);
    assert.equal(linkCreated.isRightsApproved, false);
    assert.equal(linkCreated.isPublished, false);
    assert.equal(linkCreated.isReadyForPeia, false);

    // Single AdminRepository lookup per linkQuarantineReviewDraft invocation
    assert.equal(adminRepo.getAdminCalls, 1);
    // Zero GCS writes and zero receipt mutations
    assert.equal(bucket.saveCalls, 0);
    assert.equal(db.receiptWriteCalls, 0);
    assert.equal(db.draftCreateCalls, 1);

    // Step C: Fresh listQuarantineReviewWorkbench reflects PENDING_HUMAN_REVIEW from persisted draft
    const refreshedList = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: admins.curator.id },
        data: { action: 'listQuarantineReviewWorkbench' },
      },
      adminRepo,
      uncalledService,
      undefined,
      undefined,
      undefined,
      db,
      workbenchOpts
    );
    assert.equal(refreshedList.receipts.length, 1);
    assert.equal(
      refreshedList.receipts[0].draftStatus,
      'PENDING_HUMAN_REVIEW'
    );

    // Step D: Second linkQuarantineReviewDraft call is idempotent -> IDEMPOTENT_EXISTING
    const linkIdempotent = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: admins.rightsReviewer.id },
        data: {
          action: 'linkQuarantineReviewDraft',
          receiptId: r1.receipt.receiptId,
        },
      },
      adminRepo,
      uncalledService,
      undefined,
      undefined,
      undefined,
      db,
      workbenchOpts
    );
    assert.equal(linkIdempotent.ok, true);
    assert.equal(Object.keys(linkIdempotent).length, 13);
    assert.equal(linkIdempotent.disposition, 'IDEMPOTENT_EXISTING');
    assert.equal(linkIdempotent.draftCreationOutcome, 'IDEMPOTENT_EXISTING');
    assert.equal(linkIdempotent.draftCreated, false);
    assert.equal(db.draftCreateCalls, 1); // Still 1 create total

    passed += 1;
    console.log(
      '✓ 5. Genuine 01C/01B/01A integration creates draft atomically after generation-pinned GCS readback, updates workbench list to PENDING_HUMAN_REVIEW, and preserves idempotency'
    );
  }

  // =========================================================================
  // TEST 6: Truthful NOT_CREATED vs UNKNOWN failure outcomes through linkQuarantineReviewDraft
  // =========================================================================
  {
    const adminRepo = new InMemoryAdminRepo(Object.values(admins));
    const db = new InMemoryWorkbenchFirestoreDatabase();
    const bucket = new InMemoryDedicatedGcsBucket();

    const rHold = buildReceiptAndPdfBytes(41, {
      state: LibraryQuarantineReceiptState.NeedsReconciliation,
    });
    const rAmbiguous = buildReceiptAndPdfBytes(42, {
      state: LibraryQuarantineReceiptState.Quarantined,
    });

    db.seedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      rHold.receipt.receiptId,
      rHold.envelope
    );
    db.seedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      rAmbiguous.receipt.receiptId,
      rAmbiguous.envelope
    );
    bucket.seedObject(rAmbiguous.receipt, rAmbiguous.bytes);

    const bridgeRuntime = createProductionLibraryQuarantineReviewDraftBridgeRuntime(
      {
        adminRepository: adminRepo,
        receiptStore: new FirestoreLibraryQuarantineReceiptStore(db),
        storageReadbackPort: new GcsLibraryQuarantineStorageAdapter({
          bucket,
          clock: () => '2026-11-09T12:05:00.000Z',
        }),
        draftStore: new FirestoreLibraryQuarantineReviewDraftStore(db),
        clock: () => '2026-11-09T12:05:00.000Z',
      }
    );

    const workbenchOpts = {
      workbenchEnabled: true,
      receiptReadDatabase: db,
      draftDatabase: db,
      bridgeDependencies: bridgeRuntime,
    };

    // 6a. NeedsReconciliation receipt -> NOT_CREATED (draftCreated: false)
    const notCreatedRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: admins.curator.id },
        data: {
          action: 'linkQuarantineReviewDraft',
          receiptId: rHold.receipt.receiptId,
        },
      },
      adminRepo,
      uncalledService,
      undefined,
      undefined,
      undefined,
      db,
      workbenchOpts
    );
    assert.equal(notCreatedRes.ok, false);
    assert.equal(Object.keys(notCreatedRes).length, 13);
    assert.equal(notCreatedRes.status, 'HOLD');
    assert.equal(notCreatedRes.errorCode, 'NEEDS_RECONCILIATION_HOLD');
    assert.equal(notCreatedRes.draftCreationOutcome, 'NOT_CREATED');
    assert.equal(notCreatedRes.draftCreated, false);

    // 6b. Commit failure after transaction.create staged -> UNKNOWN (draftCreated: null)
    db.throwAfterStagedDraftCreate = new Error(
      'DEADLINE_EXCEEDED: Commit acknowledgement lost'
    );
    const unknownRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: admins.curator.id },
        data: {
          action: 'linkQuarantineReviewDraft',
          receiptId: rAmbiguous.receipt.receiptId,
        },
      },
      adminRepo,
      uncalledService,
      undefined,
      undefined,
      undefined,
      db,
      workbenchOpts
    );
    assert.equal(unknownRes.ok, false);
    assert.equal(Object.keys(unknownRes).length, 13);
    assert.equal(unknownRes.status, 'HOLD');
    assert.equal(
      unknownRes.errorCode,
      'TRANSACTION_CONFLICT_OR_FAILURE_HOLD'
    );
    assert.equal(unknownRes.draftCreationOutcome, 'UNKNOWN');
    assert.equal(unknownRes.draftCreated, null);
    assert.equal(
      unknownRes.errorMessage.includes('DEADLINE_EXCEEDED'),
      false
    );

    // Verify functions/src/index.ts remains untouched and does not export standalone callable
    const indexSource = fs.readFileSync('functions/src/index.ts', 'utf8');
    assert.equal(
      indexSource.includes('libraryQuarantineReviewDraftLinkCallable'),
      false
    );

    passed += 1;
    console.log(
      '✓ 6. Preserves truthful NOT_CREATED (draftCreated: false) vs UNKNOWN (draftCreated: null) 13-key HOLD DTOs and keeps functions/src/index.ts untouched'
    );
  }

  console.log(
    `\nALL ${passed} LIB-FILE-WORKBENCH-01 BACKEND TESTS PASSED.`
  );
}

runTests().catch((err) => {
  console.error('LIB-FILE-WORKBENCH-01 backend test failure:', err);
  process.exit(1);
});
