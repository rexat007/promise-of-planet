import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
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
import {
  LibraryDocumentType,
  LibraryRightsStatus,
  type LibraryDocument,
} from '../functions/src/shared/libraryContract';
import { WorkflowState } from '../functions/src/shared/workflowContract';
import type { LibraryRepository } from '../functions/src/library/libraryRepository';
import { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';
import { PublicLibraryRepository } from '../functions/src/library/publicLibraryRepository';
import {
  LibraryQuarantineReceiptState,
  type LibraryQuarantineInternalReceipt,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
  type LibraryQuarantinePersistedReviewDraft,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftFirestoreTransaction,
} from '../functions/src/library/firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
  type LibraryQuarantinePersistedHumanReviewCase,
} from '../functions/src/library/libraryQuarantineHumanReviewCaseContract';
import { LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION } from '../functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
  deriveQuarantineCatalogDocumentId,
  type LibraryQuarantinePersistedCatalogHandoff,
} from '../functions/src/library/libraryQuarantineCatalogHandoffService';
import {
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
  LibraryQuarantineCatalogCaseAlignmentService,
  isAuthorizedHumanLibraryCatalogAligner,
  deriveLibraryQuarantineCatalogCaseAlignmentEventId,
  type LibraryQuarantinePersistedCatalogCaseAlignment,
  type LibraryQuarantinePersistedCatalogCaseAlignmentEvent,
  type AlignQuarantineCatalogCaseResponseDto,
  type GetQuarantineCatalogCaseAlignmentResponseDto,
} from '../functions/src/library/libraryQuarantineCatalogCaseAlignmentService';

const require = createRequire(import.meta.url);
const {
  LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR,
  LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR,
  LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR,
  LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR,
  LIBRARY_RIGHTS_DECISION_RELEASE_ENV_VAR,
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

interface RecordedTxOp {
  readonly kind: 'get' | 'create' | 'update' | 'set';
  readonly collectionName: string;
  readonly docId: string;
}

class InMemoryAlignmentFirestoreDatabase
  implements LibraryQuarantineReviewDraftFirestoreDatabase
{
  private readonly collections = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();

  public pointGetCalls = 0;
  public transactionCount = 0;
  public txGetCalls = 0;
  public txCreateCalls = 0;
  public txUpdateCalls = 0;
  public txSetCalls = 0;
  public txOps: RecordedTxOp[] = [];
  public throwOnPointGet: Error | null = null;
  public onBeforeTransactionWritesHook: (() => void) | null = null;
  public onAfterTransactionWritesStagedHook: (() => void) | null = null;

  public resetCounters(): void {
    this.pointGetCalls = 0;
    this.transactionCount = 0;
    this.txGetCalls = 0;
    this.txCreateCalls = 0;
    this.txUpdateCalls = 0;
    this.txSetCalls = 0;
    this.txOps = [];
  }

  public seedDoc(
    collectionName: string,
    docId: string,
    data: unknown
  ): void {
    let col = this.collections.get(collectionName);
    if (!col) {
      col = new Map();
      this.collections.set(collectionName, col);
    }
    col.set(docId, deepClone(data as Record<string, unknown>));
  }

  public getRawDoc(
    collectionName: string,
    docId: string
  ): Record<string, unknown> | undefined {
    const raw = this.collections.get(collectionName)?.get(docId);
    return raw ? deepClone(raw) : undefined;
  }

  public doc(
    collectionPath: string,
    documentPath?: string
  ): LibraryQuarantineFirestoreDocumentRef {
    let collectionName = collectionPath;
    let docId = documentPath ?? '';
    if (!documentPath && collectionPath.includes('/')) {
      const parts = collectionPath.split('/');
      collectionName = parts[0];
      docId = parts[1];
    }
    const resolvedCol = collectionName;
    const resolvedDoc = docId;

    return {
      id: resolvedDoc,
      __collectionName: resolvedCol,
      parent: { id: resolvedCol },
      get: async (): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
        this.pointGetCalls += 1;
        if (this.throwOnPointGet) {
          throw this.throwOnPointGet;
        }
        const data = this.collections.get(resolvedCol)?.get(resolvedDoc);
        return {
          id: resolvedDoc,
          exists: data !== undefined,
          data: () => (data ? deepClone(data) : undefined),
        };
      },
    } as unknown as LibraryQuarantineFirestoreDocumentRef;
  }

  public collection(collectionPath: string): {
    doc: (documentPath?: string) => LibraryQuarantineFirestoreDocumentRef;
  } {
    return {
      doc: (documentPath?: string) => this.doc(collectionPath, documentPath),
    };
  }

  public async runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineReviewDraftFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    this.transactionCount += 1;
    let writePhaseStarted = false;

    const workingState = new Map<string, Map<string, Record<string, unknown>>>();
    for (const [colName, colMap] of this.collections.entries()) {
      const copy = new Map<string, Record<string, unknown>>();
      for (const [dId, val] of colMap.entries()) {
        copy.set(dId, deepClone(val));
      }
      workingState.set(colName, copy);
    }

    const resolveColName = (ref: unknown): string => {
      const typed = ref as { readonly __collectionName?: string; readonly parent?: { readonly id?: string } };
      return typed.__collectionName || typed.parent?.id || '';
    };

    const tx: LibraryQuarantineReviewDraftFirestoreTransaction = {
      get: async (ref: LibraryQuarantineFirestoreDocumentRef) => {
        if (writePhaseStarted) {
          throw new Error(
            'FIRESTORE_TX_ORDER_VIOLATION: All transaction reads must complete before the first write.'
          );
        }
        this.txGetCalls += 1;
        const colName = resolveColName(ref);
        this.txOps.push({ kind: 'get', collectionName: colName, docId: ref.id });
        const stored = workingState.get(colName)?.get(ref.id);
        return {
          id: ref.id,
          exists: stored !== undefined,
          data: () => (stored ? deepClone(stored) : undefined),
        } as LibraryQuarantineFirestoreDocumentSnapshot;
      },
      create: (ref: LibraryQuarantineFirestoreDocumentRef, data: Record<string, unknown>) => {
        if (!writePhaseStarted && this.onBeforeTransactionWritesHook) {
          this.onBeforeTransactionWritesHook();
        }
        writePhaseStarted = true;
        this.txCreateCalls += 1;
        const colName = resolveColName(ref);
        this.txOps.push({ kind: 'create', collectionName: colName, docId: ref.id });
        let col = workingState.get(colName);
        if (!col) {
          col = new Map();
          workingState.set(colName, col);
        }
        if (col.has(ref.id)) {
          throw new Error(`ALREADY_EXISTS: Document ${colName}/${ref.id} already exists`);
        }
        col.set(ref.id, deepClone(data));
        return tx;
      },
      update: (ref: LibraryQuarantineFirestoreDocumentRef, data: Record<string, unknown>) => {
        if (!writePhaseStarted && this.onBeforeTransactionWritesHook) {
          this.onBeforeTransactionWritesHook();
        }
        writePhaseStarted = true;
        this.txUpdateCalls += 1;
        const colName = resolveColName(ref);
        this.txOps.push({ kind: 'update', collectionName: colName, docId: ref.id });
        const col = workingState.get(colName);
        if (!col || !col.has(ref.id)) {
          throw new Error(`NOT_FOUND: Document ${colName}/${ref.id} does not exist`);
        }
        const existing = col.get(ref.id)!;
        col.set(ref.id, { ...existing, ...deepClone(data) });
        return tx;
      },
      set: (ref: LibraryQuarantineFirestoreDocumentRef, data: Record<string, unknown>) => {
        if (!writePhaseStarted && this.onBeforeTransactionWritesHook) {
          this.onBeforeTransactionWritesHook();
        }
        writePhaseStarted = true;
        this.txSetCalls += 1;
        const colName = resolveColName(ref);
        this.txOps.push({ kind: 'set', collectionName: colName, docId: ref.id });
        let col = workingState.get(colName);
        if (!col) {
          col = new Map();
          workingState.set(colName, col);
        }
        col.set(ref.id, deepClone(data));
        return tx;
      },
    } as unknown as LibraryQuarantineReviewDraftFirestoreTransaction;

    const result = await updateFunction(tx);

    this.collections.clear();
    for (const [colName, colMap] of workingState.entries()) {
      this.collections.set(colName, colMap);
    }

    if (writePhaseStarted && this.onAfterTransactionWritesStagedHook) {
      const hook = this.onAfterTransactionWritesStagedHook;
      this.onAfterTransactionWritesStagedHook = null;
      hook();
    }

    return result;
  }
}

class InMemoryAdminRepo implements AdminRepository {
  public getAdminCalls = 0;
  constructor(private readonly admins: Map<string, AdminUser>) {}
  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    this.getAdminCalls += 1;
    return this.admins.get(uid) ?? null;
  }
  async saveAdmin(): Promise<AdminUser> { throw new Error('Not implemented'); }
  async listAdmins(): Promise<AdminUser[]> { return Array.from(this.admins.values()); }
}

function makeSeededRecord(receiptId: string, caseRevision: number = 2) {
  const docId = deriveQuarantineCatalogDocumentId(receiptId);
  const nowIso = '2026-11-10T08:00:00.000Z';
  const sha256 = 'e'.repeat(64);

  const receipt: LibraryQuarantineInternalReceipt = {
    receiptId,
    uploaderUid: 'curator-user-1',
    originalFilename: 'coastal-adaptation-guide-2026.pdf',
    sanitizedFilename: 'coastal-adaptation-guide-2026.pdf',
    format: 'PDF',
    canonicalExtension: 'pdf',
    canonicalMimeType: 'application/pdf',
    byteSize: 102400,
    sha256,
    storagePath: `library/quarantine/${receiptId}/source.pdf`,
    state: LibraryQuarantineReceiptState.Quarantined,
    generation: '1731200000001',
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
    reconciliationReason: null,
    rejectionReasonCode: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  };

  const draft: LibraryQuarantinePersistedReviewDraft = {
    schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
    receiptId,
    sourceRevision: 1,
    sourceUpdatedAt: nowIso,
    sourceSha256: sha256,
    format: 'PDF',
    uploaderUid: 'curator-user-1',
    reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
    createdBy: 'curator-user-1',
    createdAt: nowIso,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  };

  const humanCase: LibraryQuarantinePersistedHumanReviewCase = {
    schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
    receiptId,
    revision: caseRevision,
    sourceRevision: 1,
    sourceUpdatedAt: nowIso,
    sourceSha256: sha256,
    draftSourceRevision: 1,
    status: 'METADATA_RECORDED',
    titleAr: 'دليل التكيف الساحلي المحدث',
    titleEn: 'Updated Coastal Adaptation Guide',
    issuingOrganization: 'Ministry of Environment',
    summaryAr: 'ملخص محدث للدليل الساحلي بعد المراجعة البشرية.',
    summaryEn: 'Updated summary of coastal guide following human review.',
    sourceEvidenceNotes: 'Official Gazette 4215.',
    rightsEvidenceNotes: 'Verified copyright status.',
    editorialNotes: 'Approved metadata.',
    createdBy: 'curator-user-1',
    createdAt: nowIso,
    updatedBy: 'curator-user-1',
    updatedAt: nowIso,
  };

  const catalogHandoff: LibraryQuarantinePersistedCatalogHandoff = {
    schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
    receiptId,
    documentId: docId,
    sourceRevision: 1,
    sourceUpdatedAt: nowIso,
    sourceSha256: sha256,
    draftSourceRevision: 1,
    caseRevision: 1,
    caseUpdatedAt: nowIso,
    organizationId: 'org-environment',
    sourceId: 'src-gazette',
    createdAt: nowIso,
    createdBy: 'curator-user-1',
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  };

  const catalogDoc = {
    id: docId,
    titleAr: 'دليل التكيف الساحلي الأولي',
    titleEn: 'Preliminary Coastal Adaptation Guide',
    documentType: LibraryDocumentType.InstitutionalReport,
    organizationId: 'org-environment',
    sourceId: 'src-gazette',
    geographyAr: 'إقليمي',
    geographyEn: 'Regional',
    publicationDate: '2026-06-01',
    language: 'bilingual' as const,
    summaryAr: 'ملخص أولي للدليل الساحلي.',
    summaryEn: 'Preliminary summary of coastal guide.',
    rightsStatus: LibraryRightsStatus.ReviewRequired,
    workflowState: WorkflowState.Draft,
    legalStatusDescriptionAr: 'تقرير إرشادي غير ملزم',
    legalStatusDescriptionEn: 'Non-binding technical report',
    createdAt: nowIso,
    updatedAt: nowIso,
    topicsAr: ['البيئة الساحلية'],
    topicsEn: ['Coastal Environment'],
    environmentalDomains: ['Biodiversity'],
    versions: [
      {
        id: `ver-${docId}-1`,
        documentId: docId,
        versionNumber: '1.0',
        publishedDate: '2026-06-01',
        changeDescriptionAr: 'مسودة فهرس أولية من الحجر',
        changeDescriptionEn: 'Initial quarantine catalog draft',
      },
    ],
    workflowHistory: [],
  };

  return {
    receiptId,
    docId,
    receipt,
    draft,
    humanCase,
    catalogHandoff,
    catalogDoc,
  };
}

function seedDatabaseWithRecord(
  db: InMemoryAlignmentFirestoreDatabase,
  record: ReturnType<typeof makeSeededRecord>
): void {
  const envelope: LibraryQuarantinePersistedReceiptEnvelope = {
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision: 1,
    state: record.receipt.state,
    receipt: record.receipt,
  };
  db.seedDoc(LIBRARY_QUARANTINE_RECEIPT_COLLECTION, record.receiptId, envelope);
  db.seedDoc(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION, record.receiptId, record.draft);
  db.seedDoc(
    LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
    record.receiptId,
    record.humanCase
  );
  db.seedDoc(
    LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
    record.receiptId,
    record.catalogHandoff
  );
  db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, record.docId, record.catalogDoc);
}

async function runTests(): Promise<void> {
  console.log('STARTING LIB-FILE-CASE-ALIGNMENT-01 BACKEND INTEGRATION TESTS...');

  const ownerAdmin: AdminUser = {
    id: 'owner-user-1',
    name: 'Admin Owner',
    email: 'owner@promise-of-planet.org',
    role: AdminRole.Owner,
    isActive: true,
  };

  const curatorWithCreate: AdminUser = {
    id: 'curator-user-1',
    name: 'Admin Curator',
    email: 'curator@promise-of-planet.org',
    role: AdminRole.LibraryCurator,
    isActive: true,
    permissions: [AdminPermission.Create, AdminPermission.Review],
  };

  const rightsReviewerOnly: AdminUser = {
    id: 'rights-reviewer-1',
    name: 'Admin Rights Reviewer',
    email: 'rights@promise-of-planet.org',
    role: AdminRole.SuperAdmin,
    isActive: true,
    permissions: [AdminPermission.ManageRights], // Denied Create
  };

  const defaultAdmins = new Map<string, AdminUser>([
    [ownerAdmin.id, ownerAdmin],
    [curatorWithCreate.id, curatorWithCreate],
    [rightsReviewerOnly.id, rightsReviewerOnly],
  ]);

  const dummyService = {} as unknown as LibraryApplicationService;

  // Enable all release gates for testing
  process.env[LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR] = 'true';
  process.env[LIBRARY_RIGHTS_DECISION_RELEASE_ENV_VAR] = 'true';
  process.env[LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR] = 'true';
  process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR] = 'true';
  process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR] = 'true';

  // =========================================================================
  // PASS 1: RBAC Enforcement & Feature Gate Zero DB Read Invariant
  // =========================================================================
  {
    const db = new InMemoryAlignmentFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);

    const seeded = makeSeededRecord(buildHexReceiptId(1));
    seedDatabaseWithRecord(db, seeded);

    // 1A: Disabled release flag -> fail closed with 0 Firestore reads
    process.env[LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR] = 'false';
    db.resetCounters();
    adminRepo.getAdminCalls = 0;

    await assert.rejects(
      async () => {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: curatorWithCreate.id, token: { email: curatorWithCreate.email } },
            data: {
              action: 'getQuarantineCatalogCaseAlignment',
              receiptId: seeded.receiptId,
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          { draftDatabase: db }
        );
      },
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'failed-precondition');
        return true;
      }
    );
    assert.equal(db.pointGetCalls, 0, 'Disabled gate must perform 0 Firestore reads');
    assert.equal(db.transactionCount, 0);

    // Re-enable gate
    process.env[LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR] = 'true';

    // 1B: RBAC: RightsReviewer without Create permission is DENIED with 0 Firestore reads
    db.resetCounters();
    await assert.rejects(
      async () => {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: rightsReviewerOnly.id, token: { email: rightsReviewerOnly.email } },
            data: {
              action: 'alignQuarantineCatalogCase',
              receiptId: seeded.receiptId,
              expectedCaseRevision: 1,
              expectedCatalogUpdatedAt: seeded.catalogDoc.updatedAt,
              expectedAlignmentRevision: 0,
              confirmation: 'APPLY_CASE_METADATA',
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          { draftDatabase: db }
        );
      },
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'permission-denied');
        return true;
      }
    );
    assert.equal(db.pointGetCalls, 0, 'Unauthorized caller must perform 0 DB reads');
    assert.equal(db.transactionCount, 0);

    console.log('PASS 1: RBAC enforcement and disabled-gate zero DB reads verified.');
  }

  // =========================================================================
  // PASS 2: GET Diff Precision — Exactly 7 Point Reads
  // =========================================================================
  {
    const db = new InMemoryAlignmentFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const service = new LibraryQuarantineCatalogCaseAlignmentService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: curatorWithCreate.id,
          token: { email: curatorWithCreate.email },
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T12:00:00.000Z',
    });

    const seeded = makeSeededRecord(buildHexReceiptId(2), 2);
    seedDatabaseWithRecord(db, seeded);

    db.resetCounters();

    const getRes = await service.getQuarantineCatalogCaseAlignment({
      receiptId: seeded.receiptId,
    });

    assert.equal(getRes.ok, true);
    if (getRes.ok) {
      assert.equal(getRes.diff.hasAnyDifference, true);
      assert.equal(getRes.currentHumanCaseRevision, 2);
      assert.equal(getRes.originalHandoffCaseRevision, 1);
      assert.equal(getRes.diff.fields.titleAr.changed, true);
      assert.equal(getRes.diff.fields.titleEn.changed, true);
      assert.equal(getRes.diff.fields.summaryAr.changed, true);
      assert.equal(getRes.diff.fields.summaryEn.changed, true);
      assert.equal(getRes.diff.fields.titleAr.caseValue, 'دليل التكيف الساحلي المحدث');
      assert.equal(getRes.diff.fields.titleAr.catalogValue, 'دليل التكيف الساحلي الأولي');
    }

    assert.equal(db.pointGetCalls, 7, 'GET must perform exactly 7 point reads');
    assert.equal(db.transactionCount, 0, 'GET must not run transactions');

    console.log('PASS 2: GET diff precision and exactly 7 point reads verified.');
  }

  // =========================================================================
  // PASS 3: Atomic Alignment — Exactly 8 Point Reads + 3 Atomic Writes
  // =========================================================================
  {
    const db = new InMemoryAlignmentFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const service = new LibraryQuarantineCatalogCaseAlignmentService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: curatorWithCreate.id,
          token: { email: curatorWithCreate.email },
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T12:00:00.000Z',
    });

    const seeded = makeSeededRecord(buildHexReceiptId(3), 2);
    seedDatabaseWithRecord(db, seeded);

    db.resetCounters();
    const alignRes = await service.alignQuarantineCatalogCase({
      receiptId: seeded.receiptId,
      expectedCaseRevision: 2,
      expectedCatalogUpdatedAt: seeded.catalogDoc.updatedAt,
      expectedAlignmentRevision: 0,
      confirmation: 'APPLY_CASE_METADATA',
    });

    assert.equal(alignRes.ok, true);
    if (alignRes.ok && alignRes.status === 'ALIGNED') {
      assert.equal(alignRes.currentHumanCaseRevision, 2);
      assert.equal(alignRes.originalHandoffCaseRevision, 1);
      assert.equal(alignRes.effectiveAlignedCaseRevision, 2);
      assert.equal(alignRes.currentAlignmentRevision, 1);
      assert.equal(alignRes.isPublished, false);
      assert.equal(alignRes.isVerifiedSafe, false);
    }

    assert.equal(db.transactionCount, 1);
    assert.equal(db.txGetCalls, 8, 'ALIGN transaction must perform exactly 8 point reads');
    assert.equal(db.txUpdateCalls, 1, 'ALIGN must update 1 catalog document');
    assert.equal(db.txCreateCalls, 2, 'ALIGN must create 1 alignment doc + 1 event doc');
    assert.equal(db.txSetCalls, 0);

    // Verify catalog document properties: referenceUrl must be undefined/null, workflowState Draft, rightsStatus ReviewRequired
    const updatedDoc = db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, seeded.docId) as unknown as LibraryDocument;
    assert.equal(updatedDoc.titleAr, 'دليل التكيف الساحلي المحدث');
    assert.equal(updatedDoc.titleEn, 'Updated Coastal Adaptation Guide');
    assert.equal(updatedDoc.summaryAr, 'ملخص محدث للدليل الساحلي بعد المراجعة البشرية.');
    assert.equal(updatedDoc.summaryEn, 'Updated summary of coastal guide following human review.');
    assert.equal((updatedDoc as Record<string, unknown>).referenceUrl, undefined);
    assert.equal(updatedDoc.workflowState, WorkflowState.Draft);
    assert.equal(updatedDoc.rightsStatus, LibraryRightsStatus.ReviewRequired);

    // Verify persisted alignment document
    const alignmentDoc = db.getRawDoc(
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
      seeded.receiptId
    ) as unknown as LibraryQuarantinePersistedCatalogCaseAlignment;
    assert.equal(alignmentDoc.schemaVersion, LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION);
    assert.equal(alignmentDoc.receiptId, seeded.receiptId);
    assert.equal(alignmentDoc.alignedHumanCaseRevision, 2);
    assert.equal(alignmentDoc.originalHandoffCaseRevision, 1);
    assert.equal(alignmentDoc.alignmentRevision, 1);
    assert.equal(alignmentDoc.createdBy, curatorWithCreate.id);

    // Verify audit event document
    const eventId = deriveLibraryQuarantineCatalogCaseAlignmentEventId(seeded.receiptId, 1);
    const eventDoc = db.getRawDoc(
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
      eventId
    ) as unknown as LibraryQuarantinePersistedCatalogCaseAlignmentEvent;
    assert.equal(eventDoc.eventId, eventId);
    assert.equal(eventDoc.toCaseRevision, 2);
    assert.equal(eventDoc.fromCaseRevision, 1);

    console.log('PASS 3: Atomic alignment 8-read / 3-write budget, catalog safety constraints, and audit event verified.');
  }

  // =========================================================================
  // PASS 4: Idempotency (ALREADY_ALIGNED) & CAS Revision Conflict (CONFLICT)
  // =========================================================================
  {
    const db = new InMemoryAlignmentFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const service = new LibraryQuarantineCatalogCaseAlignmentService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: curatorWithCreate.id,
          token: { email: curatorWithCreate.email },
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T12:00:00.000Z',
    });

    const seeded = makeSeededRecord(buildHexReceiptId(4), 2);
    seedDatabaseWithRecord(db, seeded);

    // First alignment
    const firstAlign = await service.alignQuarantineCatalogCase({
      receiptId: seeded.receiptId,
      expectedCaseRevision: 2,
      expectedCatalogUpdatedAt: seeded.catalogDoc.updatedAt,
      expectedAlignmentRevision: 0,
      confirmation: 'APPLY_CASE_METADATA',
    });
    assert.equal(firstAlign.ok, true);

    const docAfterAlign = db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, seeded.docId) as unknown as LibraryDocument;

    // 4A: Second alignment with current revision -> idempotent ALREADY_ALIGNED with 0 writes!
    db.resetCounters();
    const secondAlign = await service.alignQuarantineCatalogCase({
      receiptId: seeded.receiptId,
      expectedCaseRevision: 2,
      expectedCatalogUpdatedAt: docAfterAlign.updatedAt,
      expectedAlignmentRevision: 1,
      confirmation: 'APPLY_CASE_METADATA',
    });
    assert.equal(secondAlign.ok, true);
    if (secondAlign.ok) {
      assert.equal(secondAlign.status, 'ALREADY_ALIGNED');
      assert.equal(secondAlign.currentHumanCaseRevision, 2);
    }
    assert.equal(db.txCreateCalls, 0, 'ALREADY_ALIGNED must not create any documents');
    assert.equal(db.txUpdateCalls, 0, 'ALREADY_ALIGNED must not update any documents');

    // 4B: CAS Conflict: stale expectedCaseRevision -> CONFLICT
    db.resetCounters();
    const conflictRes = await service.alignQuarantineCatalogCase({
      receiptId: seeded.receiptId,
      expectedCaseRevision: 1, // Stale!
      expectedCatalogUpdatedAt: docAfterAlign.updatedAt,
      expectedAlignmentRevision: 1,
      confirmation: 'APPLY_CASE_METADATA',
    });
    assert.equal(conflictRes.ok, false);
    if (!conflictRes.ok) {
      assert.equal(conflictRes.status, 'CONFLICT');
      assert.equal(conflictRes.errorCode, 'ALIGNMENT_REVISION_CONFLICT');
    }
    assert.equal(db.txCreateCalls, 0);
    assert.equal(db.txUpdateCalls, 0);

    console.log('PASS 4: Idempotency (ALREADY_ALIGNED) and CAS revision conflict (CONFLICT) verified.');
  }

  // =========================================================================
  // PASS 5: Human Case Not Recorded Hold & Source Drift Hold
  // =========================================================================
  {
    const db = new InMemoryAlignmentFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const service = new LibraryQuarantineCatalogCaseAlignmentService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: curatorWithCreate.id,
          token: { email: curatorWithCreate.email },
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T12:00:00.000Z',
    });

    const seeded = makeSeededRecord(buildHexReceiptId(5), 2);
    // Mutate status to IN_REVIEW (not METADATA_RECORDED)
    seeded.humanCase.status = 'IN_REVIEW';
    seedDatabaseWithRecord(db, seeded);

    const holdRes = await service.alignQuarantineCatalogCase({
      receiptId: seeded.receiptId,
      expectedCaseRevision: 2,
      expectedCatalogUpdatedAt: seeded.catalogDoc.updatedAt,
      expectedAlignmentRevision: 0,
      confirmation: 'APPLY_CASE_METADATA',
    });
    assert.equal(holdRes.ok, false);
    if (!holdRes.ok) {
      assert.equal(holdRes.status, 'HOLD');
      assert.equal(holdRes.errorCode, 'CASE_NOT_METADATA_RECORDED');
    }

    // Source revision drift
    const seededDrift = makeSeededRecord(buildHexReceiptId(6), 2);
    seededDrift.humanCase.sourceRevision = 99; // Mismatched with receipt revision 1
    seededDrift.humanCase.draftSourceRevision = 99;
    seedDatabaseWithRecord(db, seededDrift);

    const driftRes = await service.alignQuarantineCatalogCase({
      receiptId: seededDrift.receiptId,
      expectedCaseRevision: 2,
      expectedCatalogUpdatedAt: seededDrift.catalogDoc.updatedAt,
      expectedAlignmentRevision: 0,
      confirmation: 'APPLY_CASE_METADATA',
    });
    assert.equal(driftRes.ok, false);
    if (!driftRes.ok) {
      assert.equal(driftRes.status, 'HOLD');
      assert.equal(driftRes.errorCode, 'CASE_SOURCE_MISMATCH');
    }

    console.log('PASS 5: Prerequisite holds (CASE_NOT_METADATA_RECORDED and CASE_SOURCE_MISMATCH) verified.');
  }

  // =========================================================================
  // PASS 6: Commit Uncertainty (UNKNOWN) & Staged Write Multi-Attempt Guard
  // =========================================================================
  {
    const db = new InMemoryAlignmentFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const service = new LibraryQuarantineCatalogCaseAlignmentService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: curatorWithCreate.id,
          token: { email: curatorWithCreate.email },
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T12:00:00.000Z',
    });

    const seeded = makeSeededRecord(buildHexReceiptId(7), 2);
    seedDatabaseWithRecord(db, seeded);

    db.onAfterTransactionWritesStagedHook = () => {
      throw new Error('Simulated network disruption after writes staged');
    };

    const unknownRes = await service.alignQuarantineCatalogCase({
      receiptId: seeded.receiptId,
      expectedCaseRevision: 2,
      expectedCatalogUpdatedAt: seeded.catalogDoc.updatedAt,
      expectedAlignmentRevision: 0,
      confirmation: 'APPLY_CASE_METADATA',
    });

    assert.equal(unknownRes.ok, false);
    if (!unknownRes.ok && unknownRes.status === 'UNKNOWN') {
      assert.equal(unknownRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
      assert.equal(unknownRes.alignmentSaved, null);
    } else {
      throw new Error('Expected UNKNOWN status on staged write disruption');
    }

    assert.equal(db.transactionCount, 1, 'Must never auto-retry on uncertain commit');

    console.log('PASS 6: Commit uncertainty (UNKNOWN) and zero auto-retries verified.');
  }

  // =========================================================================
  // PASS 7: Protected Read-Only Manifest Files Git Blob SHA-1 Verification
  // =========================================================================
  {
    const protectedFiles: ReadonlyArray<readonly [string, string]> = [
      [
        'functions/src/library/libraryQuarantineReviewDraftContract.ts',
        '0aeb565c7f83876dd3c2bfb5b214e9f85d9a0153',
      ],
      [
        'functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts',
        '5709952519564cb118443fd6dd59ec9cff249bb1',
      ],
      [
        'functions/src/library/libraryQuarantineHumanReviewCaseContract.ts',
        '8fe5f352736faddd3f95c0a09106a79b7bec5c89',
      ],
      [
        'functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore.ts',
        '41eeb81f9d8e903683074dc951b265cd4a54fc47',
      ],
      [
        'functions/src/library/libraryQuarantineHumanReviewService.ts',
        '10a04e5bf90c4eb4ade07c21acf2038e86d70d99',
      ],
      [
        'functions/src/library/libraryQuarantineCatalogHandoffService.ts',
        '79e80cb3b9917ea9c0d3e15e23d5452235751b59',
      ],
      [
        'functions/src/library/libraryQuarantineRightsDecisionContract.ts',
        'b96652303ae516c2ba01f7f9d52e3c8875860f1f',
      ],
      [
        'functions/src/shared/adminContract.ts',
        'f895313b46de7f1f55d3d0e1cc1aca4fc9e7391d',
      ],
      [
        'functions/src/library/libraryApplicationService.ts',
        '1f8dad76a835e9c7a48bb9108625e8826e6cff6a',
      ],
      [
        'functions/src/library/publicLibraryRepository.ts',
        'c813162307663b6fe37dc84cba9c591193f34f33',
      ],
      [
        'functions/src/index.ts',
        '5a14cada5dad8e764f8cc3092f40c386f6b09616',
      ],
      ['package.json', '923f67eebb513a6fab3e1e4d30de2ca9e48eb50b'],
    ];

    for (const [relPath, expectedSha1] of protectedFiles) {
      const raw = fs.readFileSync(relPath);
      const header = Buffer.from(`blob ${raw.byteLength}\u0000`, 'utf8');
      const actualSha1 = createHash('sha1')
        .update(Buffer.concat([header, raw]))
        .digest('hex');
      assert.equal(
        actualSha1,
        expectedSha1,
        `Protected file ${relPath} SHA-1 mismatch: expected ${expectedSha1}, got ${actualSha1}`
      );
    }

    console.log(
      'PASS 7: All 12 protected manifest files verified at exact expected Git blob SHA-1s.'
    );
  }

  console.log(
    '\nALL LIB-FILE-CASE-ALIGNMENT-01 BACKEND TESTS PASSED (7/7).'
  );
}

runTests().catch((err: unknown) => {
  console.error('LIB-FILE-CASE-ALIGNMENT-01 BACKEND TESTS FAILED:', err);
  process.exit(1);
});
