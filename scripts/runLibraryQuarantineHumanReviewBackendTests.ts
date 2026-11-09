import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
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
import type { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';
import {
  LibraryQuarantineReceiptState,
  type LibraryQuarantineInternalReceipt,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  FirestoreLibraryQuarantineReceiptStore,
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION as LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
  LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
  type LibraryQuarantineFirestoreDatabase,
  type LibraryQuarantineFirestoreDocumentRef as LibraryQuarantineReviewDraftFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot as LibraryQuarantineReviewDraftFirestoreDocumentSnapshot,
  type LibraryQuarantineFirestoreTransaction,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';
import {
  FirestoreLibraryQuarantineReviewDraftStore,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION as LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
  type LibraryQuarantinePersistedReviewDraft,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftFirestoreTransaction,
} from '../functions/src/library/firestoreLibraryQuarantineReviewDraftStore';
import {
  ALLOWED_SANITIZED_HUMAN_REVIEW_CASE_DTO_KEYS,
  deriveLibraryQuarantineHumanReviewEventId,
  toSanitizedLibraryQuarantineHumanReviewCaseDto,
  validateHumanReviewCaseEditorialInput,
  validatePersistedLibraryQuarantineHumanReviewCase,
  validatePersistedLibraryQuarantineHumanReviewEvent,
} from '../functions/src/library/libraryQuarantineHumanReviewCaseContract';
import {
  FirestoreLibraryQuarantineHumanReviewCaseStore,
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
  LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore';

const require = createRequire(import.meta.url);
const {
  LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR,
  LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR,
  executeManageLibraryDocumentsRequest,
} = require(
  '../functions/src/library/libraryAdminHandlers'
) as typeof import('../functions/src/library/libraryAdminHandlers');

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildHexReceiptId(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function buildReceiptEnvelopeAndDraft(
  index: number,
  overrides: {
    readonly state?: LibraryQuarantineReceiptState;
    readonly revision?: number;
    readonly updatedAt?: string;
    readonly includeDraft?: boolean;
    readonly draftSourceRevision?: number;
    readonly draftSourceSha256?: string;
  } = {}
): {
  readonly receiptId: string;
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly draft: LibraryQuarantinePersistedReviewDraft | null;
} {
  const receiptId = buildHexReceiptId(index);
  const sha256 = createHash('sha256')
    .update(Buffer.from(`Quarantine Document #${index}`, 'utf8'))
    .digest('hex');
  const createdAt = '2026-11-09T09:00:00.000Z';
  const updatedAt = overrides.updatedAt ?? '2026-11-09T09:05:00.000Z';
  const state = overrides.state ?? LibraryQuarantineReceiptState.Quarantined;
  const revision = overrides.revision ?? 2;

  const isQuarantined = state === LibraryQuarantineReceiptState.Quarantined;
  const isNeedsReconciliation =
    state === LibraryQuarantineReceiptState.NeedsReconciliation;

  const receipt: LibraryQuarantineInternalReceipt = Object.freeze({
    receiptId,
    uploaderUid: 'admin-curator',
    originalFilename: `environmental-decree-${index}.pdf`,
    sanitizedFilename: `environmental-decree-${index}.pdf`,
    format: 'PDF' as const,
    canonicalExtension: 'pdf' as const,
    canonicalMimeType: 'application/pdf',
    byteSize: 4096 + index,
    sha256,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    storagePath: `library/quarantine/${receiptId}/source.pdf`,
    state,
    generation: isQuarantined ? `${9000 + index}` : null,
    reconciliationReason: isNeedsReconciliation
      ? 'GCS conditional write outcome was ambiguous.'
      : null,
    rejectionReasonCode:
      state === LibraryQuarantineReceiptState.Rejected
        ? 'PDF_ACTIVE_CONTENT_DETECTED'
        : null,
    createdAt,
    updatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

  const envelope: LibraryQuarantinePersistedReceiptEnvelope = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision,
    state: receipt.state,
    receipt,
  });

  const includeDraft = overrides.includeDraft ?? true;
  const draft: LibraryQuarantinePersistedReviewDraft | null = includeDraft
    ? Object.freeze({
        schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
        receiptId,
        sourceRevision: overrides.draftSourceRevision ?? revision,
        sourceUpdatedAt: updatedAt,
        sourceSha256: overrides.draftSourceSha256 ?? sha256,
        format: 'PDF' as const,
        uploaderUid: receipt.uploaderUid,
        reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
        createdBy: 'admin-curator',
        createdAt: '2026-11-09T09:10:00.000Z',
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      })
    : null;

  return { receiptId, receipt, envelope, draft };
}

class InMemoryHumanReviewFirestore
  implements
    LibraryQuarantineFirestoreDatabase,
    LibraryQuarantineReviewDraftFirestoreDatabase
{
  readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  readonly readCountsByCollection = new Map<string, number>();
  readonly writeCountsByCollection = new Map<string, number>();
  readonly eventOverwriteAttempts: string[] = [];
  failOnCommitAfterStagedWrite = false;
  onBeforeStageWrite?: (
    collectionMap: Map<string, Map<string, Record<string, unknown>>>
  ) => void;

  constructor() {
    this.collections.set(LIBRARY_QUARANTINE_RECEIPTS_COLLECTION, new Map());
    this.collections.set(LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION, new Map());
    this.collections.set(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      new Map()
    );
    this.collections.set(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
      new Map()
    );
  }

  private getOrCreateCollection(
    name: string
  ): Map<string, Record<string, unknown>> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map();
      this.collections.set(name, col);
    }
    return col;
  }

  private incrementRead(collectionName: string): void {
    this.readCountsByCollection.set(
      collectionName,
      (this.readCountsByCollection.get(collectionName) ?? 0) + 1
    );
  }

  private incrementWrite(collectionName: string): void {
    this.writeCountsByCollection.set(
      collectionName,
      (this.writeCountsByCollection.get(collectionName) ?? 0) + 1
    );
  }

  seedDocument(
    collectionName: string,
    docId: string,
    data: Record<string, unknown>
  ): void {
    this.getOrCreateCollection(collectionName).set(docId, deepClone(data));
  }

  readDocumentRaw(
    collectionName: string,
    docId: string
  ): Record<string, unknown> | undefined {
    const raw = this.getOrCreateCollection(collectionName).get(docId);
    return raw ? deepClone(raw) : undefined;
  }

  collection(collectionName: string) {
    return {
      doc: (
        docId: string
      ): LibraryQuarantineReviewDraftFirestoreDocumentRef & {
        readonly __collectionName: string;
        create(data: Record<string, unknown>): Promise<void>;
        set(data: Record<string, unknown>): Promise<void>;
      } => ({
        id: docId,
        __collectionName: collectionName,
        get: async (): Promise<LibraryQuarantineReviewDraftFirestoreDocumentSnapshot> => {
          this.incrementRead(collectionName);
          const raw = this.getOrCreateCollection(collectionName).get(docId);
          return {
            exists: raw !== undefined,
            id: docId,
            data: () => (raw !== undefined ? deepClone(raw) : undefined),
          };
        },
        create: async (data: Record<string, unknown>): Promise<void> => {
          const col = this.getOrCreateCollection(collectionName);
          if (col.has(docId)) {
            throw new Error(`ALREADY_EXISTS: ${collectionName}/${docId}`);
          }
          this.incrementWrite(collectionName);
          col.set(docId, deepClone(data));
        },
        set: async (data: Record<string, unknown>): Promise<void> => {
          this.incrementWrite(collectionName);
          this.getOrCreateCollection(collectionName).set(
            docId,
            deepClone(data)
          );
        },
      }),
    };
  }

  async runTransaction<T>(
    updateFn: (
      tx: LibraryQuarantineFirestoreTransaction &
        LibraryQuarantineReviewDraftFirestoreTransaction & {
          update(
            ref: LibraryQuarantineReviewDraftFirestoreDocumentRef,
            data: Record<string, unknown>
          ): void;
        }
    ) => Promise<T>
  ): Promise<T> {
    let anyWriteStaged = false;
    const stagedOps: Array<() => void> = [];

    const tx: LibraryQuarantineFirestoreTransaction &
      LibraryQuarantineReviewDraftFirestoreTransaction & {
        update(
          ref: LibraryQuarantineReviewDraftFirestoreDocumentRef,
          data: Record<string, unknown>
        ): void;
      } = {
      get: async (
        ref: LibraryQuarantineReviewDraftFirestoreDocumentRef
      ): Promise<LibraryQuarantineReviewDraftFirestoreDocumentSnapshot> => {
        if (anyWriteStaged) {
          throw new Error(
            'FIRESTORE_TX_ORDER_VIOLATION: Transaction reads must precede all writes.'
          );
        }
        if (typeof ref.get !== 'function') {
          throw new Error('Document reference must provide get()');
        }
        return ref.get();
      },
      create: (
        ref: LibraryQuarantineReviewDraftFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        if (!anyWriteStaged && this.onBeforeStageWrite) {
          this.onBeforeStageWrite(this.collections);
        }
        anyWriteStaged = true;
        const colName =
          (ref as unknown as { readonly __collectionName: string })
            .__collectionName;
        const cloned = deepClone(data);
        stagedOps.push(() => {
          const col = this.getOrCreateCollection(colName);
          if (col.has(ref.id)) {
            if (colName === LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION) {
              this.eventOverwriteAttempts.push(ref.id);
            }
            throw new Error(`TX_CREATE_ALREADY_EXISTS: ${colName}/${ref.id}`);
          }
          this.incrementWrite(colName);
          col.set(ref.id, cloned);
        });
      },
      update: (
        ref: LibraryQuarantineReviewDraftFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        if (!anyWriteStaged && this.onBeforeStageWrite) {
          this.onBeforeStageWrite(this.collections);
        }
        anyWriteStaged = true;
        const colName =
          (ref as unknown as { readonly __collectionName: string })
            .__collectionName;
        if (colName === LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION) {
          this.eventOverwriteAttempts.push(ref.id);
          throw new Error('AUDIT_EVENT_UPDATE_FORBIDDEN');
        }
        const cloned = deepClone(data);
        stagedOps.push(() => {
          const col = this.getOrCreateCollection(colName);
          if (!col.has(ref.id)) {
            throw new Error(`TX_UPDATE_NOT_FOUND: ${colName}/${ref.id}`);
          }
          this.incrementWrite(colName);
          col.set(ref.id, cloned);
        });
      },
      set: (
        ref: LibraryQuarantineReviewDraftFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        if (!anyWriteStaged && this.onBeforeStageWrite) {
          this.onBeforeStageWrite(this.collections);
        }
        anyWriteStaged = true;
        const colName =
          (ref as unknown as { readonly __collectionName: string })
            .__collectionName;
        if (colName === LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION) {
          this.eventOverwriteAttempts.push(ref.id);
          throw new Error('AUDIT_EVENT_SET_FORBIDDEN');
        }
        const cloned = deepClone(data);
        stagedOps.push(() => {
          this.incrementWrite(colName);
          this.getOrCreateCollection(colName).set(ref.id, cloned);
        });
      },
    };

    const result = await updateFn(tx);

    if (anyWriteStaged && this.failOnCommitAfterStagedWrite) {
      throw new Error('SIMULATED_COMMIT_CONFIRMATION_LOST');
    }

    for (const op of stagedOps) {
      op();
    }

    return result;
  }
}

function buildAdminDirectory(): {
  readonly users: Readonly<Record<string, AdminUser>>;
  readonly createRepo: (counter?: { lookups: number }) => AdminRepository;
} {
  const makeUser = (
    uid: string,
    role: AdminRole,
    isActive = true,
    extra: Record<string, unknown> = {}
  ): AdminUser =>
    Object.freeze({
      id: uid,
      uid,
      email: `${uid}@promiseofplanet.org`,
      displayName: `Admin ${uid}`,
      role,
      isActive,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...extra,
    }) as unknown as AdminUser;

  const users: Record<string, AdminUser> = {
    'admin-owner': makeUser('admin-owner', AdminRole.Owner),
    'admin-curator': makeUser('admin-curator', AdminRole.LibraryCurator),
    'admin-rights': makeUser('admin-rights', AdminRole.RightsReviewer),
    'admin-curator-view-only': makeUser(
      'admin-curator-view-only',
      AdminRole.LibraryCurator,
      true,
      { permissions: [AdminPermission.View] }
    ),
    'admin-inactive': makeUser(
      'admin-inactive',
      AdminRole.LibraryCurator,
      false
    ),
    'admin-ai': makeUser('admin-ai', AdminRole.AIAssistant),
    'admin-content': makeUser('admin-content', AdminRole.ContentEditor),
    'admin-viewer': makeUser('admin-viewer', AdminRole.Viewer),
  };

  return {
    users,
    createRepo(counter?: { lookups: number }): AdminRepository {
      return {
        async getAdminByUid(uid: string): Promise<AdminUser | null> {
          if (counter) {
            counter.lookups += 1;
          }
          return users[uid] ?? null;
        },
        async saveAdmin(admin: AdminUser): Promise<AdminUser> {
          return admin;
        },
        async listAdmins(): Promise<AdminUser[]> {
          return Object.values(users);
        },
      };
    },
  };
}

const dummyService = {} as unknown as LibraryApplicationService;

async function runTests(): Promise<void> {
  let passed = 0;
  const directory = buildAdminDirectory();

  // =========================================================================
  // TEST 1: Dual Server Release Gates Checked BEFORE Any Auth/Firestore/GCS
  // =========================================================================
  {
    const db = new InMemoryHumanReviewFirestore();
    const { receiptId } = buildReceiptEnvelopeAndDraft(1);
    const lookupCounter = { lookups: 0 };
    const adminRepo = directory.createRepo(lookupCounter);

    delete process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR];
    delete process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR];

    // 1a. Both env vars unset -> fails with WORKBENCH_NOT_RELEASED before touching AdminRepo or Firestore
    await assert.rejects(
      async () => {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: 'admin-curator' },
            data: { action: 'getQuarantineHumanReviewCase', receiptId },
          },
          adminRepo,
          dummyService
        );
      },
      (err: unknown) =>
        err instanceof Error && err.message.includes('WORKBENCH_NOT_RELEASED')
    );

    // 1b. Workbench enabled, Human Case Review disabled -> fails with HUMAN_CASE_REVIEW_NOT_RELEASED
    await assert.rejects(
      async () => {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: 'admin-curator' },
            data: {
              action: 'saveQuarantineHumanReviewCase',
              receiptId,
              expectedRevision: 0,
              input: {
                status: 'IN_REVIEW',
                titleAr: 'عنوان تجريبي',
              },
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            workbenchEnabled: true,
            humanCaseReviewEnabled: false,
            draftDatabase: db,
          }
        );
      },
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes('HUMAN_CASE_REVIEW_NOT_RELEASED')
    );

    assert.equal(lookupCounter.lookups, 0);
    assert.equal(db.readCountsByCollection.size, 0);
    assert.equal(db.writeCountsByCollection.size, 0);

    passed += 1;
    console.log(
      'PASS [1/7]: Dual server release gates checked before any AdminRepository or Firestore access'
    );
  }

  // =========================================================================
  // TEST 2: SDK Auth Provenance, Role & Permission Enforcement, Forbidden Keys
  // =========================================================================
  {
    const db = new InMemoryHumanReviewFirestore();
    const { receiptId, envelope, draft } = buildReceiptEnvelopeAndDraft(2);
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      receiptId,
      envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      receiptId,
      draft as unknown as Record<string, unknown>
    );

    const adminRepo = directory.createRepo();
    const handlerOpts = {
      workbenchEnabled: true,
      humanCaseReviewEnabled: true,
      draftDatabase: db,
      receiptStore: new FirestoreLibraryQuarantineReceiptStore(db),
      draftStore: new FirestoreLibraryQuarantineReviewDraftStore(db),
      humanReviewCaseStore: new FirestoreLibraryQuarantineHumanReviewCaseStore(
        db
      ),
      humanReviewClock: () => '2026-11-09T10:00:00.000Z',
    };

    // Denied callers: unauthenticated, AIAssistant, inactive, view-only, ContentEditor, Viewer
    for (const deniedUid of [
      '',
      'admin-ai',
      'admin-inactive',
      'admin-curator-view-only',
      'admin-content',
      'admin-viewer',
    ]) {
      await assert.rejects(async () => {
        await executeManageLibraryDocumentsRequest(
          {
            auth: deniedUid ? { uid: deniedUid } : undefined,
            data: { action: 'getQuarantineHumanReviewCase', receiptId },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          handlerOpts
        );
      });

      await assert.rejects(async () => {
        await executeManageLibraryDocumentsRequest(
          {
            auth: deniedUid ? { uid: deniedUid } : undefined,
            data: {
              action: 'saveQuarantineHumanReviewCase',
              receiptId,
              expectedRevision: 0,
              input: { status: 'IN_REVIEW', titleAr: 'وثيقة' },
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          handlerOpts
        );
      });
    }

    // Spoofed caller fields in data (`uid`, `role`, `auth`, `storagePath`) rejected before any write
    for (const extraField of ['uid', 'role', 'auth', 'storagePath', 'createdBy']) {
      await assert.rejects(async () => {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: 'admin-curator' },
            data: {
              action: 'saveQuarantineHumanReviewCase',
              receiptId,
              expectedRevision: 0,
              input: { status: 'IN_REVIEW', titleAr: 'وثيقة' },
              [extraField]: 'spoofed',
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          handlerOpts
        );
      });
    }

    assert.equal(
      db.writeCountsByCollection.get(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION
      ) ?? 0,
      0
    );

    passed += 1;
    console.log(
      'PASS [2/7]: SDK auth provenance, role/permission matrix, and spoofed caller field rejection verified'
    );
  }

  // =========================================================================
  // TEST 3: Create (Rev 0 -> 1), Sequential Update (Rev 1 -> 2), Append-Only Events, No Secret Leaks
  // =========================================================================
  {
    const db = new InMemoryHumanReviewFirestore();
    const { receiptId, envelope, draft } = buildReceiptEnvelopeAndDraft(3);
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      receiptId,
      envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      receiptId,
      draft as unknown as Record<string, unknown>
    );

    let clockTick = '2026-11-09T10:15:00.000Z';
    const adminRepo = directory.createRepo();
    const handlerOpts = {
      workbenchEnabled: true,
      humanCaseReviewEnabled: true,
      draftDatabase: db,
      receiptStore: new FirestoreLibraryQuarantineReceiptStore(db),
      draftStore: new FirestoreLibraryQuarantineReviewDraftStore(db),
      humanReviewCaseStore: new FirestoreLibraryQuarantineHumanReviewCaseStore(
        db
      ),
      humanReviewClock: () => clockTick,
    };

    // Initial GET returns READY with reviewCase: null and currentRevision: 0
    const initialGet = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: { action: 'getQuarantineHumanReviewCase', receiptId },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOpts
    );
    assert.equal(initialGet.ok, true);
    assert.equal(initialGet.status, 'READY');
    assert.equal(initialGet.currentRevision, 0);
    assert.equal(initialGet.reviewCase, null);

    // First Save (expectedRevision: 0 -> revision: 1) by admin-curator
    const createRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'saveQuarantineHumanReviewCase',
          receiptId,
          expectedRevision: 0,
          input: {
            status: 'IN_REVIEW',
            titleAr: 'القانون الوطني لحماية التنوع الحيوي',
            titleEn: 'National Biodiversity Protection Act',
            issuingOrganization: 'وزارة البيئة',
            summaryAr: 'ملخص أولي لمواد القانون.',
            summaryEn: 'Preliminary summary of the act articles.',
            sourceEvidenceNotes: 'الجريدة الرسمية العدد 412',
            rightsEvidenceNotes: 'وثيقة تشريعية حكومية',
            editorialNotes: 'قيد استكمال مراجعة الملاحق.',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOpts
    );

    assert.equal(createRes.ok, true);
    assert.equal(createRes.status, 'SAVED');
    assert.equal(createRes.caseSaveOutcome, 'CREATED');
    assert.equal(createRes.caseSaved, true);
    assert.equal(createRes.currentRevision, 1);
    assert.equal(createRes.reviewCase.revision, 1);
    assert.equal(createRes.reviewCase.status, 'IN_REVIEW');
    assert.equal(createRes.isSanitized, false);
    assert.equal(createRes.isVerifiedSafe, false);
    assert.equal(createRes.isRightsApproved, false);
    assert.equal(createRes.isPublished, false);
    assert.equal(createRes.isReadyForPeia, false);

    // Ensure sanitized DTO has exact 17 keys and omits sourceSha256, createdBy, updatedBy
    const dtoKeys = Object.keys(createRes.reviewCase);
    assert.equal(dtoKeys.length, ALLOWED_SANITIZED_HUMAN_REVIEW_CASE_DTO_KEYS.size);
    assert.equal('sourceSha256' in createRes.reviewCase, false);
    assert.equal('createdBy' in createRes.reviewCase, false);
    assert.equal('updatedBy' in createRes.reviewCase, false);
    assert.equal('storagePath' in createRes.reviewCase, false);

    // Second Save (expectedRevision: 1 -> revision: 2) by admin-rights
    clockTick = '2026-11-09T10:25:00.000Z';
    const updateRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-rights' },
        data: {
          action: 'saveQuarantineHumanReviewCase',
          receiptId,
          expectedRevision: 1,
          input: {
            status: 'METADATA_RECORDED',
            titleAr: 'القانون الوطني لحماية التنوع الحيوي',
            titleEn: 'National Biodiversity Protection Act',
            issuingOrganization: 'وزارة البيئة',
            summaryAr: 'ملخص أولي مكتمل للمواد.',
            summaryEn: 'Completed preliminary summary.',
            sourceEvidenceNotes: 'الجريدة الرسمية العدد 412 لسنة 2026',
            rightsEvidenceNotes: 'وثيقة تشريعية عامة — بانتظار التدقيق الحقوقي المستقل',
            editorialNotes: 'اكتملت البيانات الوصفية الأولية فقط.',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOpts
    );

    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.status, 'SAVED');
    assert.equal(updateRes.caseSaveOutcome, 'UPDATED');
    assert.equal(updateRes.caseSaved, true);
    assert.equal(updateRes.currentRevision, 2);
    assert.equal(updateRes.reviewCase.status, 'METADATA_RECORDED');
    assert.equal(updateRes.reviewCase.createdAt, '2026-11-09T10:15:00.000Z');
    assert.equal(updateRes.reviewCase.updatedAt, '2026-11-09T10:25:00.000Z');

    // Verify persisted case in Firestore preserves createdBy='admin-curator' and sets updatedBy='admin-rights'
    const rawPersistedCase = db.readDocumentRaw(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      receiptId
    );
    const validatedCase = validatePersistedLibraryQuarantineHumanReviewCase(
      rawPersistedCase,
      receiptId
    );
    assert.equal(validatedCase.ok, true);
    if (validatedCase.ok) {
      assert.equal(validatedCase.reviewCase.createdBy, 'admin-curator');
      assert.equal(validatedCase.reviewCase.updatedBy, 'admin-rights');
      assert.equal(validatedCase.reviewCase.revision, 2);
    }

    // Verify both append-only audit events exist and are intact
    const event1Id = deriveLibraryQuarantineHumanReviewEventId(receiptId, 1);
    const event2Id = deriveLibraryQuarantineHumanReviewEventId(receiptId, 2);
    const rawEvent1 = db.readDocumentRaw(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
      event1Id
    );
    const rawEvent2 = db.readDocumentRaw(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
      event2Id
    );
    const vEvent1 = validatePersistedLibraryQuarantineHumanReviewEvent(
      rawEvent1,
      event1Id
    );
    const vEvent2 = validatePersistedLibraryQuarantineHumanReviewEvent(
      rawEvent2,
      event2Id
    );
    assert.equal(vEvent1.ok, true);
    assert.equal(vEvent2.ok, true);
    if (vEvent1.ok && vEvent2.ok) {
      assert.equal(vEvent1.reviewEvent.eventType, 'CREATED');
      assert.equal(vEvent1.reviewEvent.previousRevision, 0);
      assert.equal(vEvent1.reviewEvent.actorUid, 'admin-curator');
      assert.equal(vEvent2.reviewEvent.eventType, 'UPDATED');
      assert.equal(vEvent2.reviewEvent.previousRevision, 1);
      assert.equal(vEvent2.reviewEvent.actorUid, 'admin-rights');
    }
    assert.equal(db.eventOverwriteAttempts.length, 0);

    // Zero writes to receipts, review drafts, or any other collection
    assert.equal(
      db.writeCountsByCollection.get(LIBRARY_QUARANTINE_RECEIPTS_COLLECTION) ?? 0,
      0
    );
    assert.equal(
      db.writeCountsByCollection.get(
        LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION
      ) ?? 0,
      0
    );

    passed += 1;
    console.log(
      'PASS [3/7]: Create (Rev 0->1), sequential update (Rev 1->2), append-only audit events, and zero receipt/draft writes verified'
    );
  }

  // =========================================================================
  // TEST 4: Compare-and-Swap (CAS) Revision Conflict Detection
  // =========================================================================
  {
    const db = new InMemoryHumanReviewFirestore();
    const { receiptId, envelope, draft } = buildReceiptEnvelopeAndDraft(4);
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      receiptId,
      envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      receiptId,
      draft as unknown as Record<string, unknown>
    );

    const adminRepo = directory.createRepo();
    const handlerOpts = {
      workbenchEnabled: true,
      humanCaseReviewEnabled: true,
      draftDatabase: db,
      receiptStore: new FirestoreLibraryQuarantineReceiptStore(db),
      draftStore: new FirestoreLibraryQuarantineReviewDraftStore(db),
      humanReviewCaseStore: new FirestoreLibraryQuarantineHumanReviewCaseStore(
        db
      ),
      humanReviewClock: () => '2026-11-09T11:00:00.000Z',
    };

    // Save initial revision 1
    const firstSave = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-owner' },
        data: {
          action: 'saveQuarantineHumanReviewCase',
          receiptId,
          expectedRevision: 0,
          input: {
            status: 'IN_REVIEW',
            titleAr: 'النسخة الأولى',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOpts
    );
    assert.equal(firstSave.status, 'SAVED');
    assert.equal(firstSave.currentRevision, 1);

    // Stale save with expectedRevision: 0 when currentRevision is 1 -> CONFLICT
    const conflictRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'saveQuarantineHumanReviewCase',
          receiptId,
          expectedRevision: 0,
          input: {
            status: 'IN_REVIEW',
            titleAr: 'كتابة متنافسة متأخرة',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOpts
    );

    assert.equal(conflictRes.ok, false);
    assert.equal(conflictRes.status, 'CONFLICT');
    assert.equal(conflictRes.caseSaveOutcome, 'NOT_SAVED');
    assert.equal(conflictRes.caseSaved, false);
    assert.equal(conflictRes.errorCode, 'CASE_REVISION_CONFLICT');
    assert.equal(conflictRes.currentRevision, 1);
    assert.equal(conflictRes.currentCase?.titleAr, 'النسخة الأولى');

    // Stored case remains untouched at revision 1
    const storedAfterConflict = db.readDocumentRaw(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      receiptId
    );
    assert.equal(storedAfterConflict?.revision, 1);
    assert.equal(storedAfterConflict?.titleAr, 'النسخة الأولى');

    passed += 1;
    console.log(
      'PASS [4/7]: CAS expectedRevision conflict halts write without overwriting existing case'
    );
  }

  // =========================================================================
  // TEST 5: Plain-Text, Forbidden HTML/Schemes, and Status Requirements
  // =========================================================================
  {
    // 5a. METADATA_RECORDED without sourceEvidenceNotes -> rejected
    const missingSourceEvidence = validateHumanReviewCaseEditorialInput({
      status: 'METADATA_RECORDED',
      titleAr: 'عنوان الوثيقة',
      sourceEvidenceNotes: '   ',
    });
    assert.equal(missingSourceEvidence.ok, false);
    if (!missingSourceEvidence.ok) {
      assert.equal(
        missingSourceEvidence.errorCode,
        'METADATA_RECORDED_REQUIREMENTS_NOT_MET'
      );
    }

    // 5b. NEEDS_INFORMATION and NOT_SUITABLE without editorialNotes -> rejected
    for (const status of ['NEEDS_INFORMATION', 'NOT_SUITABLE'] as const) {
      const missingJustification = validateHumanReviewCaseEditorialInput({
        status,
        titleAr: 'عنوان الوثيقة',
        editorialNotes: '',
      });
      assert.equal(missingJustification.ok, false);
      if (!missingJustification.ok) {
        assert.equal(
          missingJustification.errorCode,
          'JUSTIFICATION_NOTES_REQUIRED'
        );
      }
    }

    // 5c. HTML tags, control chars, or forbidden paths/schemes -> rejected
    for (const badText of [
      '<script>alert(1)</script>',
      'javascript:alert(1)',
      'library/quarantine/00000000000000000000000000000001/source.pdf',
      'gs://promiseofplanet-bb325-library-quarantine/file.pdf',
      'Line with null\u0000byte',
    ]) {
      const badCheck = validateHumanReviewCaseEditorialInput({
        status: 'IN_REVIEW',
        titleAr: badText,
      });
      assert.equal(badCheck.ok, false);
    }

    // 5d. Forbidden status values (e.g., APPROVED, PUBLISHED) -> rejected
    for (const forbiddenStatus of [
      'APPROVED',
      'PUBLISHED',
      'SAFE',
      'RIGHTS_CLEARED',
    ]) {
      const statusCheck = validateHumanReviewCaseEditorialInput({
        status: forbiddenStatus as never,
        titleAr: 'عنوان',
      });
      assert.equal(statusCheck.ok, false);
      if (!statusCheck.ok) {
        assert.equal(statusCheck.errorCode, 'INVALID_CASE_STATUS');
      }
    }

    passed += 1;
    console.log(
      'PASS [5/7]: Plain-text validation, HTML/URI rejection, and status-specific requirements verified'
    );
  }

  // =========================================================================
  // TEST 6: Ineligible Receipt, Unlinked Draft, and Stale Source/Draft Hold
  // =========================================================================
  {
    const db = new InMemoryHumanReviewFirestore();
    const adminRepo = directory.createRepo();
    const makeOpts = () => ({
      workbenchEnabled: true,
      humanCaseReviewEnabled: true,
      draftDatabase: db,
      receiptStore: new FirestoreLibraryQuarantineReceiptStore(db),
      draftStore: new FirestoreLibraryQuarantineReviewDraftStore(db),
      humanReviewCaseStore: new FirestoreLibraryQuarantineHumanReviewCaseStore(
        db
      ),
      humanReviewClock: () => '2026-11-09T11:30:00.000Z',
    });

    // 6a. NeedsReconciliation receipt -> HOLD
    const recon = buildReceiptEnvelopeAndDraft(61, {
      state: LibraryQuarantineReceiptState.NeedsReconciliation,
      includeDraft: false,
    });
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      recon.receiptId,
      recon.envelope as unknown as Record<string, unknown>
    );

    const reconRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'saveQuarantineHumanReviewCase',
          receiptId: recon.receiptId,
          expectedRevision: 0,
          input: { status: 'IN_REVIEW', titleAr: 'تجربة' },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      makeOpts()
    );
    assert.equal(reconRes.ok, false);
    assert.equal(reconRes.status, 'HOLD');
    assert.equal(reconRes.errorCode, 'RECEIPT_NEEDS_RECONCILIATION');

    // 6b. Quarantined receipt without linked draft -> HOLD (REVIEW_DRAFT_NOT_LINKED)
    const noDraft = buildReceiptEnvelopeAndDraft(62, { includeDraft: false });
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      noDraft.receiptId,
      noDraft.envelope as unknown as Record<string, unknown>
    );

    const noDraftRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'saveQuarantineHumanReviewCase',
          receiptId: noDraft.receiptId,
          expectedRevision: 0,
          input: { status: 'IN_REVIEW', titleAr: 'تجربة' },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      makeOpts()
    );
    assert.equal(noDraftRes.ok, false);
    assert.equal(noDraftRes.status, 'HOLD');
    assert.equal(noDraftRes.errorCode, 'REVIEW_DRAFT_NOT_LINKED');

    // 6c. Stale draft sourceRevision mismatch -> HOLD (DRAFT_SOURCE_MISMATCH)
    const staleDraft = buildReceiptEnvelopeAndDraft(63, {
      revision: 3,
      draftSourceRevision: 2,
    });
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      staleDraft.receiptId,
      staleDraft.envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      staleDraft.receiptId,
      staleDraft.draft as unknown as Record<string, unknown>
    );

    const staleRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'saveQuarantineHumanReviewCase',
          receiptId: staleDraft.receiptId,
          expectedRevision: 0,
          input: { status: 'IN_REVIEW', titleAr: 'تجربة' },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      makeOpts()
    );
    assert.equal(staleRes.ok, false);
    assert.equal(staleRes.status, 'HOLD');
    assert.equal(staleRes.errorCode, 'DRAFT_SOURCE_MISMATCH');

    passed += 1;
    console.log(
      'PASS [6/7]: Ineligible receipt, unlinked draft, and stale source/draft version mismatch rejected with zero writes'
    );
  }

  // =========================================================================
  // TEST 7: Commit Confirmation Loss -> UNKNOWN (caseSaved: null, Never False)
  // =========================================================================
  {
    const db = new InMemoryHumanReviewFirestore();
    const { receiptId, envelope, draft } = buildReceiptEnvelopeAndDraft(7);
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      receiptId,
      envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      receiptId,
      draft as unknown as Record<string, unknown>
    );

    db.failOnCommitAfterStagedWrite = true;

    const adminRepo = directory.createRepo();
    const handlerOpts = {
      workbenchEnabled: true,
      humanCaseReviewEnabled: true,
      draftDatabase: db,
      receiptStore: new FirestoreLibraryQuarantineReceiptStore(db),
      draftStore: new FirestoreLibraryQuarantineReviewDraftStore(db),
      humanReviewCaseStore: new FirestoreLibraryQuarantineHumanReviewCaseStore(
        db
      ),
      humanReviewClock: () => '2026-11-09T12:00:00.000Z',
    };

    const unknownRes = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'saveQuarantineHumanReviewCase',
          receiptId,
          expectedRevision: 0,
          input: {
            status: 'IN_REVIEW',
            titleAr: 'اختبار انقطاع تأكيد الالتزام',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOpts
    );

    assert.equal(unknownRes.ok, false);
    assert.equal(unknownRes.status, 'UNKNOWN');
    assert.equal(unknownRes.caseSaveOutcome, 'UNKNOWN');
    assert.equal(unknownRes.caseSaved, null);
    assert.equal(unknownRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
    assert.equal(unknownRes.isSanitized, false);
    assert.equal(unknownRes.isVerifiedSafe, false);
    assert.equal(unknownRes.isRightsApproved, false);
    assert.equal(unknownRes.isPublished, false);
    assert.equal(unknownRes.isReadyForPeia, false);

    // Also verify toSanitizedLibraryQuarantineHumanReviewCaseDto rejects invalid records
    assert.throws(() => {
      toSanitizedLibraryQuarantineHumanReviewCaseDto({} as never);
    });

    passed += 1;
    console.log(
      'PASS [7/7]: Commit confirmation loss after staging writes returns status=UNKNOWN and caseSaved=null'
    );
  }

  console.log(
    `\nALL ${passed}/7 LIB-FILE-HUMAN-CASEWORK-01 BACKEND TESTS PASSED.`
  );
}

runTests().catch((err) => {
  console.error('LIB-FILE-HUMAN-CASEWORK-01 BACKEND TESTS FAILED:', err);
  process.exit(1);
});
