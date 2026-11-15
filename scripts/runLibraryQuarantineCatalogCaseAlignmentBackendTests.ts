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
  LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENT_SCHEMA_VERSION,
  deriveLibraryQuarantineHumanReviewEventId,
  type LibraryQuarantinePersistedHumanReviewCase,
  type LibraryQuarantinePersistedHumanReviewEvent,
} from '../functions/src/library/libraryQuarantineHumanReviewCaseContract';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
  LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
  deriveQuarantineCatalogDocumentId,
  type LibraryQuarantinePersistedCatalogHandoff,
  type LibraryQuarantinePersistedCatalogHandoffEvent,
} from '../functions/src/library/libraryQuarantineCatalogHandoffService';
import {
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENT_REASON,
  LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
  LIBRARY_QUARANTINE_LEGACY_RECOVERY_ALIGNMENT_EVENT_REASON,
  LIBRARY_QUARANTINE_LEGACY_CATALOG_CHANGE_ATTRIBUTION_STATUS,
  LibraryQuarantineCatalogCaseAlignmentService,
  deriveLibraryQuarantineCatalogCaseAlignmentEventId,
  validatePersistedLibraryQuarantineCatalogCaseAlignmentEvent,
  type LibraryQuarantinePersistedCatalogCaseAlignment,
  type LibraryQuarantinePersistedCatalogCaseAlignmentEvent,
  type LibraryQuarantinePersistedLegacyRecoveryCatalogCaseAlignmentEvent,
  type LibraryQuarantinePersistedNormalCatalogCaseAlignmentEvent,
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
        '03ad42b565cdbb22fba37d4df521e4d993a285e1',
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

  // =========================================================================
  // PASS 8: LIB-QCAT-LEGACY-R2A-SERVER-GUARD — Exceptional Forward-Recovery Guard
  // =========================================================================
  {
    const incidentReceiptId = '1183ac250d0404e921d2aeadbec1b76c';
    const incidentDocId = deriveQuarantineCatalogDocumentId(incidentReceiptId);
    const sourceIso = '2026-11-13T13:00:00.000Z';
    const handoffCaseUpdatedAt = '2026-11-13T13:26:28.891Z';
    const handoffCreatedAt = '2026-11-13T14:09:18.983Z';
    const legacyCatalogUpdatedAt = '2026-11-13T17:48:23.574Z';
    const rev6UpdatedAt = '2026-11-14T14:44:40.569Z';
    const recoveryClockIso = '2026-11-14T18:00:00.000Z';
    const sha256 = 'a'.repeat(64);

    const buildIncidentFixture = (): InMemoryAlignmentFirestoreDatabase => {
      const db = new InMemoryAlignmentFirestoreDatabase();

      const receipt: LibraryQuarantineInternalReceipt = {
        receiptId: incidentReceiptId,
        uploaderUid: ownerAdmin.id,
        originalFilename: 'marine-protection-framework-2026.pdf',
        sanitizedFilename: 'marine-protection-framework-2026.pdf',
        format: 'PDF',
        canonicalExtension: 'pdf',
        canonicalMimeType: 'application/pdf',
        byteSize: 204800,
        sha256,
        storagePath: `library/quarantine/${incidentReceiptId}/source.pdf`,
        state: LibraryQuarantineReceiptState.Quarantined,
        generation: '1731500000001',
        deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
        reconciliationReason: null,
        rejectionReasonCode: null,
        createdAt: sourceIso,
        updatedAt: sourceIso,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      };

      const envelope: LibraryQuarantinePersistedReceiptEnvelope = {
        schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
        revision: 1,
        state: receipt.state,
        receipt,
      };

      const draft: LibraryQuarantinePersistedReviewDraft = {
        schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
        receiptId: incidentReceiptId,
        sourceRevision: 1,
        sourceUpdatedAt: sourceIso,
        sourceSha256: sha256,
        format: 'PDF',
        uploaderUid: ownerAdmin.id,
        reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
        createdBy: ownerAdmin.id,
        createdAt: sourceIso,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      };

      // Exact matching 4 editorial fields between rev 6 human case and legacy-updated qcat draft
      const alignedTitleAr = 'إطار حماية البيئة البحرية والساحلية 2026';
      const alignedTitleEn = 'Marine and Coastal Environmental Protection Framework 2026';
      const alignedSummaryAr = 'وثيقة مرجعية محدثة لحماية النظم البيئية البحرية والساحلية.';
      const alignedSummaryEn = 'Updated reference framework for marine and coastal ecosystem protection.';

      const humanCaseRev6: LibraryQuarantinePersistedHumanReviewCase = {
        schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
        receiptId: incidentReceiptId,
        revision: 6,
        sourceRevision: 1,
        sourceUpdatedAt: sourceIso,
        sourceSha256: sha256,
        draftSourceRevision: 1,
        status: 'METADATA_RECORDED',
        titleAr: alignedTitleAr,
        titleEn: alignedTitleEn,
        issuingOrganization: 'Ministry of Environment',
        summaryAr: alignedSummaryAr,
        summaryEn: alignedSummaryEn,
        sourceEvidenceNotes: 'Verified official ministry publication record.',
        rightsEvidenceNotes: 'Institutional open review copy.',
        editorialNotes: 'Finalized bilingual metadata at revision 6.',
        createdBy: ownerAdmin.id,
        createdAt: '2026-11-13T13:20:32.398Z',
        updatedBy: ownerAdmin.id,
        updatedAt: rev6UpdatedAt,
      };

      const catalogHandoff: LibraryQuarantinePersistedCatalogHandoff = {
        schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
        receiptId: incidentReceiptId,
        documentId: incidentDocId,
        sourceRevision: 1,
        sourceUpdatedAt: sourceIso,
        sourceSha256: sha256,
        draftSourceRevision: 1,
        caseRevision: 3,
        caseUpdatedAt: handoffCaseUpdatedAt,
        organizationId: 'org-environment',
        sourceId: 'src-gazette',
        createdAt: handoffCreatedAt,
        createdBy: ownerAdmin.id,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      };

      const catalogHandoffEvent: LibraryQuarantinePersistedCatalogHandoffEvent = {
        schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
        eventId: incidentReceiptId,
        receiptId: incidentReceiptId,
        documentId: incidentDocId,
        eventType: 'CATALOG_DRAFT_CREATED',
        sourceRevision: 1,
        sourceUpdatedAt: sourceIso,
        sourceSha256: sha256,
        draftSourceRevision: 1,
        caseRevision: 3,
        caseUpdatedAt: handoffCaseUpdatedAt,
        organizationId: 'org-environment',
        sourceId: 'src-gazette',
        actorUid: ownerAdmin.id,
        recordedAt: handoffCreatedAt,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      };

      const catalogDoc = {
        id: incidentDocId,
        titleAr: alignedTitleAr,
        titleEn: alignedTitleEn,
        documentType: LibraryDocumentType.InstitutionalReport,
        organizationId: 'org-environment',
        sourceId: 'src-gazette',
        geographyAr: 'وطني',
        geographyEn: 'National',
        publicationDate: '2026-11-01',
        language: 'bilingual' as const,
        summaryAr: alignedSummaryAr,
        summaryEn: alignedSummaryEn,
        rightsStatus: LibraryRightsStatus.ReviewRequired,
        workflowState: WorkflowState.Draft,
        legalStatusDescriptionAr: 'مسودة قيد المراجعة',
        legalStatusDescriptionEn: 'Draft under review',
        createdAt: handoffCreatedAt,
        updatedAt: legacyCatalogUpdatedAt,
        topicsAr: ['البيئة البحرية'],
        topicsEn: ['Marine Environment'],
        environmentalDomains: ['Biodiversity'],
        versions: [
          {
            id: `ver-${incidentDocId}-1`,
            documentId: incidentDocId,
            versionNumber: '1.0',
            publishedDate: '2026-11-01',
            changeDescriptionAr: 'مسودة فهرس أولية من الحجر',
            changeDescriptionEn: 'Initial quarantine catalog draft',
          },
        ],
        workflowHistory: [],
      };

      const historicalEventSpecs: ReadonlyArray<{
        readonly revision: number;
        readonly previousRevision: number;
        readonly recordedAt: string;
        readonly eventType: 'CREATED' | 'UPDATED';
        readonly status: 'IN_REVIEW' | 'METADATA_RECORDED';
      }> = [
        {
          revision: 1,
          previousRevision: 0,
          recordedAt: '2026-11-13T13:20:32.398Z',
          eventType: 'CREATED',
          status: 'IN_REVIEW',
        },
        {
          revision: 2,
          previousRevision: 1,
          recordedAt: '2026-11-13T13:25:12.695Z',
          eventType: 'UPDATED',
          status: 'IN_REVIEW',
        },
        {
          revision: 3,
          previousRevision: 2,
          recordedAt: '2026-11-13T13:26:28.891Z',
          eventType: 'UPDATED',
          status: 'METADATA_RECORDED',
        },
        {
          revision: 4,
          previousRevision: 3,
          recordedAt: '2026-11-14T14:15:40.916Z',
          eventType: 'UPDATED',
          status: 'METADATA_RECORDED',
        },
        {
          revision: 5,
          previousRevision: 4,
          recordedAt: '2026-11-14T14:38:08.534Z',
          eventType: 'UPDATED',
          status: 'METADATA_RECORDED',
        },
        {
          revision: 6,
          previousRevision: 5,
          recordedAt: '2026-11-14T14:44:40.569Z',
          eventType: 'UPDATED',
          status: 'METADATA_RECORDED',
        },
      ];

      db.seedDoc(LIBRARY_QUARANTINE_RECEIPT_COLLECTION, incidentReceiptId, envelope);
      db.seedDoc(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION, incidentReceiptId, draft);
      db.seedDoc(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
        incidentReceiptId,
        humanCaseRev6
      );
      db.seedDoc(
        LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
        incidentReceiptId,
        catalogHandoff
      );
      db.seedDoc(
        LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION,
        incidentReceiptId,
        catalogHandoffEvent
      );
      db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, incidentDocId, catalogDoc);

      for (const spec of historicalEventSpecs) {
        const evId = deriveLibraryQuarantineHumanReviewEventId(
          incidentReceiptId,
          spec.revision
        );
        const evDoc: LibraryQuarantinePersistedHumanReviewEvent = {
          schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENT_SCHEMA_VERSION,
          eventId: evId,
          receiptId: incidentReceiptId,
          revision: spec.revision,
          previousRevision: spec.previousRevision,
          eventType: spec.eventType,
          sourceRevision: 1,
          sourceUpdatedAt: sourceIso,
          sourceSha256: sha256,
          draftSourceRevision: 1,
          status: spec.status,
          titleAr: alignedTitleAr,
          titleEn: alignedTitleEn,
          issuingOrganization: 'Ministry of Environment',
          summaryAr: alignedSummaryAr,
          summaryEn: alignedSummaryEn,
          sourceEvidenceNotes: 'Verified official ministry publication record.',
          rightsEvidenceNotes: 'Institutional open review copy.',
          editorialNotes:
            spec.revision === 6
              ? 'Finalized bilingual metadata at revision 6.'
              : `Revision ${spec.revision} note.`,
          actorUid: ownerAdmin.id,
          recordedAt: spec.recordedAt,
        };
        db.seedDoc(LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION, evId, evDoc);
      }

      return db;
    };

    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const makeServiceForDb = (
      db: InMemoryAlignmentFirestoreDatabase,
      actor: AdminUser = ownerAdmin,
      clockIso: string = recoveryClockIso
    ) =>
      new LibraryQuarantineCatalogCaseAlignmentService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => ({
            uid: actor.id,
            token: { email: actor.email },
          }),
        },
        adminRepository: adminRepo,
        db,
        clock: () => clockIso,
      });

    // 8.1: GET on historical unattributed state -> HOLD (INCONSISTENT_ALIGNMENT_STATE), 7 point reads, 0 writes
    {
      const db = buildIncidentFixture();
      const service = makeServiceForDb(db);
      db.resetCounters();

      const getRes = await service.getQuarantineCatalogCaseAlignment({
        receiptId: incidentReceiptId,
      });
      assert.equal(getRes.ok, false);
      if (!getRes.ok) {
        assert.equal(getRes.status, 'HOLD');
        assert.equal(getRes.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
      }
      assert.equal(db.pointGetCalls, 7);
      assert.equal(db.transactionCount, 0);
    }

    // 8.2: Ordinary alignQuarantineCatalogCase (no legacy acknowledgement) -> HOLD (INCONSISTENT_ALIGNMENT_STATE), 0 writes
    {
      const db = buildIncidentFixture();
      const service = makeServiceForDb(db);
      db.resetCounters();

      const ordinaryAlignRes = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
      });
      assert.equal(ordinaryAlignRes.ok, false);
      if (!ordinaryAlignRes.ok) {
        assert.equal(ordinaryAlignRes.status, 'HOLD');
        assert.equal(ordinaryAlignRes.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
      }
      assert.equal(db.txGetCalls, 8);
      assert.equal(db.txCreateCalls, 0);
      assert.equal(db.txUpdateCalls, 0);
    }

    // 8.3: Invalid or empty legacyUnattributedCatalogUpdateAcknowledgement -> HOLD (CONFIRMATION_REQUIRED), 0 reads, 0 writes
    {
      const db = buildIncidentFixture();
      const service = makeServiceForDb(db);

      for (const badAck of ['', 'WRONG_ACK', null, undefined, 123]) {
        db.resetCounters();
        const badAckRes = await service.alignQuarantineCatalogCase({
          receiptId: incidentReceiptId,
          expectedCaseRevision: 6,
          expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
          expectedAlignmentRevision: 0,
          confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
          legacyUnattributedCatalogUpdateAcknowledgement: badAck,
        });
        assert.equal(badAckRes.ok, false);
        if (!badAckRes.ok) {
          assert.equal(badAckRes.status, 'HOLD');
          assert.equal(badAckRes.errorCode, 'CONFIRMATION_REQUIRED');
        }
        assert.equal(db.pointGetCalls, 0);
        assert.equal(db.transactionCount, 0);
        assert.equal(db.txCreateCalls, 0);
        assert.equal(db.txUpdateCalls, 0);
      }
    }

    // 8.4: Acknowledgement supplied on a normal unmodified handoff draft -> HOLD (INVALID_ALIGNMENT_PAYLOAD), 0 writes
    {
      const db = new InMemoryAlignmentFirestoreDatabase();
      const seededNormal = makeSeededRecord(buildHexReceiptId(80), 2);
      seedDatabaseWithRecord(db, seededNormal);
      const service = makeServiceForDb(db);
      db.resetCounters();

      const res = await service.alignQuarantineCatalogCase({
        receiptId: seededNormal.receiptId,
        expectedCaseRevision: 2,
        expectedCatalogUpdatedAt: seededNormal.catalogDoc.updatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.status, 'HOLD');
        assert.equal(res.errorCode, 'INVALID_ALIGNMENT_PAYLOAD');
      }
      assert.equal(db.txCreateCalls, 0);
      assert.equal(db.txUpdateCalls, 0);
    }

    // 8.5: Acknowledgement supplied when an alignment doc already exists (alignmentRevision >= 1) -> HOLD (INCONSISTENT_ALIGNMENT_STATE), 0 writes
    {
      const db = new InMemoryAlignmentFirestoreDatabase();
      const seededAligned = makeSeededRecord(buildHexReceiptId(81), 2);
      seedDatabaseWithRecord(db, seededAligned);
      const service = makeServiceForDb(db);

      const firstAlign = await service.alignQuarantineCatalogCase({
        receiptId: seededAligned.receiptId,
        expectedCaseRevision: 2,
        expectedCatalogUpdatedAt: seededAligned.catalogDoc.updatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
      });
      assert.equal(firstAlign.ok, true);

      const updatedDoc = db.getRawDoc(
        LIBRARY_DOCUMENTS_COLLECTION,
        seededAligned.docId
      ) as unknown as LibraryDocument;

      db.resetCounters();
      const resWithExistingAlignment = await service.alignQuarantineCatalogCase({
        receiptId: seededAligned.receiptId,
        expectedCaseRevision: 2,
        expectedCatalogUpdatedAt: updatedDoc.updatedAt,
        expectedAlignmentRevision: 1,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(resWithExistingAlignment.ok, false);
      if (!resWithExistingAlignment.ok) {
        assert.equal(resWithExistingAlignment.status, 'HOLD');
        assert.equal(resWithExistingAlignment.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
      }
      assert.equal(db.txCreateCalls, 0);
      assert.equal(db.txUpdateCalls, 0);
    }

    // 8.6: Missing or invalid handoff audit event -> HOLD, 0 writes
    {
      const dbMissingHandoffEv = buildIncidentFixture();
      // Corrupt handoff event
      dbMissingHandoffEv.seedDoc(
        LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION,
        incidentReceiptId,
        { invalid: true }
      );
      const service = makeServiceForDb(dbMissingHandoffEv);
      dbMissingHandoffEv.resetCounters();

      const res = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.status, 'HOLD');
        assert.equal(res.errorCode, 'INVALID_PERSISTED_HANDOFF_SCHEMA');
      }
      assert.equal(dbMissingHandoffEv.txCreateCalls, 0);
      assert.equal(dbMissingHandoffEv.txUpdateCalls, 0);
    }

    // 8.7: Missing historical human-review event (<receiptId>_1 .. <receiptId>_6) -> HOLD, 0 writes
    {
      const dbMissingRev4 = buildIncidentFixture();
      // Advance case to rev 7 without seeding <receiptId>_7
      const caseDoc = dbMissingRev4.getRawDoc(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
        incidentReceiptId
      )!;
      dbMissingRev4.seedDoc(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
        incidentReceiptId,
        {
          ...caseDoc,
          revision: 7,
        }
      );
      const service = makeServiceForDb(dbMissingRev4);
      dbMissingRev4.resetCounters();

      const res = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 7,
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.status, 'HOLD');
        assert.equal(res.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
      }
      assert.equal(dbMissingRev4.txCreateCalls, 0);
      assert.equal(dbMissingRev4.txUpdateCalls, 0);
    }

    // 8.8: Tampered or source-mismatched historical human-review event -> HOLD, 0 writes
    {
      const dbTamperedEv = buildIncidentFixture();
      const rev4Id = deriveLibraryQuarantineHumanReviewEventId(incidentReceiptId, 4);
      const rev4Doc = dbTamperedEv.getRawDoc(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
        rev4Id
      )!;
      dbTamperedEv.seedDoc(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
        rev4Id,
        {
          ...rev4Doc,
          sourceRevision: 99,
          draftSourceRevision: 99,
        }
      );
      const service = makeServiceForDb(dbTamperedEv);
      dbTamperedEv.resetCounters();

      const res = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.status, 'HOLD');
        assert.equal(res.errorCode, 'CASE_SOURCE_MISMATCH');
      }
      assert.equal(dbTamperedEv.txCreateCalls, 0);
      assert.equal(dbTamperedEv.txUpdateCalls, 0);
    }

    // 8.9: Stale expectedCaseRevision or stale expectedCatalogUpdatedAt during recovery -> CONFLICT, 0 writes
    {
      const db = buildIncidentFixture();
      const service = makeServiceForDb(db);

      db.resetCounters();
      const staleCaseRes = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 5, // Stale
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(staleCaseRes.ok, false);
      if (!staleCaseRes.ok) {
        assert.equal(staleCaseRes.status, 'CONFLICT');
        assert.equal(staleCaseRes.errorCode, 'ALIGNMENT_REVISION_CONFLICT');
      }
      assert.equal(db.txCreateCalls, 0);
      assert.equal(db.txUpdateCalls, 0);

      db.resetCounters();
      const staleCatalogRes = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: handoffCreatedAt, // Stale
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(staleCatalogRes.ok, false);
      if (!staleCatalogRes.ok) {
        assert.equal(staleCatalogRes.status, 'CONFLICT');
        assert.equal(staleCatalogRes.errorCode, 'ALIGNMENT_REVISION_CONFLICT');
      }
      assert.equal(db.txCreateCalls, 0);
      assert.equal(db.txUpdateCalls, 0);
    }

    // 8.10 & 8.11: Successful authorized forward recovery for exact production incident shape + post-recovery lifecycle
    {
      const db = buildIncidentFixture();
      const service = makeServiceForDb(db, ownerAdmin, recoveryClockIso);
      db.resetCounters();

      const recoveryRes = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });

      assert.equal(recoveryRes.ok, true);
      if (recoveryRes.ok) {
        // Must NEVER take the 0-write ALREADY_ALIGNED shortcut even though all 4 fields matched
        assert.equal(recoveryRes.status, 'ALIGNED');
        assert.equal(recoveryRes.alignmentOutcome, 'ALIGNED');
        assert.equal(recoveryRes.alignmentSaved, true);
        assert.equal(recoveryRes.alignmentState, 'ALIGNED');
        assert.equal(recoveryRes.originalHandoffCaseRevision, 3);
        assert.equal(recoveryRes.effectiveAlignedCaseRevision, 6);
        assert.equal(recoveryRes.currentHumanCaseRevision, 6);
        assert.equal(recoveryRes.currentAlignmentRevision, 1);
        assert.equal(recoveryRes.catalogUpdatedAt, recoveryClockIso);
        assert.equal(recoveryRes.diff.hasAnyDifference, false);
        assert.equal(recoveryRes.isSanitized, false);
        assert.equal(recoveryRes.isVerifiedSafe, false);
        assert.equal(recoveryRes.isRightsApproved, false);
        assert.equal(recoveryRes.isPublished, false);
        assert.equal(recoveryRes.isReadyForPeia, false);
      }

      // 8 base reads + 1 handoff event read + 6 historical human-review event reads = 15 deterministic point reads
      assert.equal(db.transactionCount, 1);
      assert.equal(db.txGetCalls, 15);
      assert.equal(db.txUpdateCalls, 1);
      assert.equal(db.txCreateCalls, 2);
      assert.equal(db.txSetCalls, 0);

      // Verify persisted alignment record at alignmentRevision = 1, alignedHumanCaseRevision = 6
      const persistedAlignment = db.getRawDoc(
        LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
        incidentReceiptId
      ) as unknown as LibraryQuarantinePersistedCatalogCaseAlignment;
      assert.equal(persistedAlignment.alignmentRevision, 1);
      assert.equal(persistedAlignment.alignedHumanCaseRevision, 6);
      assert.equal(persistedAlignment.originalHandoffCaseRevision, 3);
      assert.equal(persistedAlignment.documentUpdatedAt, recoveryClockIso);
      assert.equal(persistedAlignment.isPublished, false);

      // Verify persisted recovery event has strict 27-key legacy recovery schema
      const recoveryEventId = deriveLibraryQuarantineCatalogCaseAlignmentEventId(
        incidentReceiptId,
        1
      );
      const rawRecoveryEvent = db.getRawDoc(
        LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
        recoveryEventId
      )!;
      assert.equal(Object.keys(rawRecoveryEvent).length, 27);
      const validatedRecoveryEvent =
        validatePersistedLibraryQuarantineCatalogCaseAlignmentEvent(
          rawRecoveryEvent,
          incidentReceiptId,
          1
        );
      assert.equal(validatedRecoveryEvent.ok, true);
      if (validatedRecoveryEvent.ok) {
        const ev =
          validatedRecoveryEvent.alignmentEvent as LibraryQuarantinePersistedLegacyRecoveryCatalogCaseAlignmentEvent;
        assert.equal(
          ev.reason,
          LIBRARY_QUARANTINE_LEGACY_RECOVERY_ALIGNMENT_EVENT_REASON
        );
        assert.equal(
          ev.historicalCatalogChangeAttribution,
          LIBRARY_QUARANTINE_LEGACY_CATALOG_CHANGE_ATTRIBUTION_STATUS
        );
        assert.equal(ev.fromCaseRevision, 3);
        assert.equal(ev.toCaseRevision, 6);
        assert.equal(ev.fromCatalogUpdatedAt, legacyCatalogUpdatedAt);
        assert.equal(ev.toCatalogUpdatedAt, recoveryClockIso);
        assert.equal(
          ev.preRecoveryCatalogTitleAr,
          'إطار حماية البيئة البحرية والساحلية 2026'
        );
        assert.equal(
          ev.preRecoveryCatalogTitleEn,
          'Marine and Coastal Environmental Protection Framework 2026'
        );
        assert.equal(
          ev.preRecoveryCatalogSummaryAr,
          'وثيقة مرجعية محدثة لحماية النظم البيئية البحرية والساحلية.'
        );
        assert.equal(
          ev.preRecoveryCatalogSummaryEn,
          'Updated reference framework for marine and coastal ecosystem protection.'
        );
      }

      // Verify catalog document remains Draft / ReviewRequired
      const updatedQcatDoc = db.getRawDoc(
        LIBRARY_DOCUMENTS_COLLECTION,
        incidentDocId
      ) as unknown as LibraryDocument;
      assert.equal(updatedQcatDoc.workflowState, WorkflowState.Draft);
      assert.equal(updatedQcatDoc.rightsStatus, LibraryRightsStatus.ReviewRequired);
      assert.equal(updatedQcatDoc.updatedAt, recoveryClockIso);

      // 8.11a: Subsequent getQuarantineCatalogCaseAlignment returns READY (ALIGNED) with 7 point reads
      db.resetCounters();
      const postGetRes = await service.getQuarantineCatalogCaseAlignment({
        receiptId: incidentReceiptId,
      });
      assert.equal(postGetRes.ok, true);
      if (postGetRes.ok) {
        assert.equal(postGetRes.status, 'READY');
        assert.equal(postGetRes.alignmentState, 'ALIGNED');
        assert.equal(postGetRes.currentAlignmentRevision, 1);
        assert.equal(postGetRes.effectiveAlignedCaseRevision, 6);
      }
      assert.equal(db.pointGetCalls, 7);

      // 8.11b: Subsequent normal alignQuarantineCatalogCase at rev 6 returns ALREADY_ALIGNED with 0 writes
      db.resetCounters();
      const postNormalIdempotentRes = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: recoveryClockIso,
        expectedAlignmentRevision: 1,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
      });
      assert.equal(postNormalIdempotentRes.ok, true);
      if (postNormalIdempotentRes.ok) {
        assert.equal(postNormalIdempotentRes.status, 'ALREADY_ALIGNED');
      }
      assert.equal(db.txGetCalls, 8);
      assert.equal(db.txCreateCalls, 0);
      assert.equal(db.txUpdateCalls, 0);

      // 8.11c: Subsequent human-review revision 7 followed by normal alignQuarantineCatalogCase writes alignmentRevision = 2 with normal 22-key event
      const rev7Iso = '2026-11-15T09:00:00.000Z';
      const align2ClockIso = '2026-11-15T09:05:00.000Z';
      const currentCase = db.getRawDoc(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
        incidentReceiptId
      )!;
      db.seedDoc(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
        incidentReceiptId,
        {
          ...currentCase,
          revision: 7,
          titleEn: 'Marine and Coastal Environmental Protection Framework 2026 (Rev 7)',
          updatedAt: rev7Iso,
        }
      );

      const serviceRev7 = makeServiceForDb(db, ownerAdmin, align2ClockIso);
      db.resetCounters();
      const normalAlignRev7Res = await serviceRev7.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 7,
        expectedCatalogUpdatedAt: recoveryClockIso,
        expectedAlignmentRevision: 1,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
      });
      assert.equal(normalAlignRev7Res.ok, true);
      if (normalAlignRev7Res.ok) {
        assert.equal(normalAlignRev7Res.status, 'ALIGNED');
        assert.equal(normalAlignRev7Res.currentAlignmentRevision, 2);
        assert.equal(normalAlignRev7Res.effectiveAlignedCaseRevision, 7);
      }
      assert.equal(db.txGetCalls, 8);
      assert.equal(db.txUpdateCalls, 2); // qcat doc + alignment doc
      assert.equal(db.txCreateCalls, 1); // event _2

      const event2Id = deriveLibraryQuarantineCatalogCaseAlignmentEventId(
        incidentReceiptId,
        2
      );
      const rawEvent2 = db.getRawDoc(
        LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
        event2Id
      )!;
      assert.equal(Object.keys(rawEvent2).length, 22);
      const validatedEvent2 =
        validatePersistedLibraryQuarantineCatalogCaseAlignmentEvent(
          rawEvent2,
          incidentReceiptId,
          2
        );
      assert.equal(validatedEvent2.ok, true);
      if (validatedEvent2.ok) {
        const ev2 =
          validatedEvent2.alignmentEvent as LibraryQuarantinePersistedNormalCatalogCaseAlignmentEvent;
        assert.equal(
          ev2.reason,
          LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENT_REASON
        );
        assert.equal(ev2.fromCaseRevision, 6);
        assert.equal(ev2.toCaseRevision, 7);
      }
    }

    // 8.12: Unauthorized caller attempting recovery -> denied before any Firestore reads or writes
    {
      const db = buildIncidentFixture();
      const unauthorizedService = makeServiceForDb(
        db,
        rightsReviewerOnly,
        recoveryClockIso
      );
      db.resetCounters();

      const unauthRes = await unauthorizedService.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(unauthRes.ok, false);
      if (!unauthRes.ok) {
        assert.equal(unauthRes.status, 'HOLD');
        assert.equal(unauthRes.errorCode, 'UNAUTHORIZED_ALIGNMENT_ACTOR');
      }
      assert.equal(db.pointGetCalls, 0);
      assert.equal(db.transactionCount, 0);
      assert.equal(db.txGetCalls, 0);
      assert.equal(db.txCreateCalls, 0);
      assert.equal(db.txUpdateCalls, 0);
    }

    // 8.13: Exact preservation of all four distinct pre-recovery editorial strings when differing from human-review case
    {
      const db = buildIncidentFixture();
      const rawDoc = db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, incidentDocId)!;
      const distinctPreTitleAr = 'عنوان مسودة الفهرس قبل الاسترداد المعتمد';
      const distinctPreTitleEn = 'Pre-Recovery Catalog Draft Title Before Reconciliation';
      const distinctPreSummaryAr = 'الفقرة الأولى من الملخص قبل الاسترداد.\nالفقرة الثانية المحفوظة حرفياً.';
      const distinctPreSummaryEn = 'First paragraph of pre-recovery summary.\nSecond paragraph preserved verbatim.';

      db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, incidentDocId, {
        ...rawDoc,
        titleAr: distinctPreTitleAr,
        titleEn: distinctPreTitleEn,
        summaryAr: distinctPreSummaryAr,
        summaryEn: distinctPreSummaryEn,
      });

      const service = makeServiceForDb(db, ownerAdmin, recoveryClockIso);
      db.resetCounters();

      const res = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.status, 'ALIGNED');
        assert.equal(res.alignmentSaved, true);
        assert.equal(
          res.catalogDocument.titleAr,
          'إطار حماية البيئة البحرية والساحلية 2026'
        );
        assert.equal(
          res.catalogDocument.titleEn,
          'Marine and Coastal Environmental Protection Framework 2026'
        );
      }

      const recoveryEventId = deriveLibraryQuarantineCatalogCaseAlignmentEventId(
        incidentReceiptId,
        1
      );
      const persistedEvent = db.getRawDoc(
        LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
        recoveryEventId
      ) as unknown as LibraryQuarantinePersistedLegacyRecoveryCatalogCaseAlignmentEvent;
      assert.equal(Object.keys(persistedEvent).length, 27);
      assert.equal(persistedEvent.preRecoveryCatalogTitleAr, distinctPreTitleAr);
      assert.equal(persistedEvent.preRecoveryCatalogTitleEn, distinctPreTitleEn);
      assert.equal(persistedEvent.preRecoveryCatalogSummaryAr, distinctPreSummaryAr);
      assert.equal(persistedEvent.preRecoveryCatalogSummaryEn, distinctPreSummaryEn);
    }

    // 8.14: Leading or trailing whitespace on any pre-recovery catalog editorial field is never silently discarded -> HOLD and 0 writes
    {
      const whitespaceMutations: ReadonlyArray<Record<string, string>> = [
        { titleAr: '  إطار حماية البيئة البحرية والساحلية 2026' },
        { titleAr: 'إطار حماية البيئة البحرية والساحلية 2026  ' },
        { titleEn: ' Marine and Coastal Environmental Protection Framework 2026' },
        { titleEn: 'Marine and Coastal Environmental Protection Framework 2026\t' },
        { summaryAr: '\nوثيقة مرجعية محدثة لحماية النظم البيئية البحرية والساحلية.' },
        { summaryAr: 'وثيقة مرجعية محدثة لحماية النظم البيئية البحرية والساحلية. ' },
        { summaryEn: ' Updated reference framework for marine and coastal ecosystem protection.' },
        { summaryEn: 'Updated reference framework for marine and coastal ecosystem protection.\n' },
      ];

      for (const patch of whitespaceMutations) {
        const db = buildIncidentFixture();
        const rawDoc = db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, incidentDocId)!;
        db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, incidentDocId, {
          ...rawDoc,
          ...patch,
        });

        const service = makeServiceForDb(db, ownerAdmin, recoveryClockIso);
        db.resetCounters();

        const res = await service.alignQuarantineCatalogCase({
          receiptId: incidentReceiptId,
          expectedCaseRevision: 6,
          expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
          expectedAlignmentRevision: 0,
          confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
          legacyUnattributedCatalogUpdateAcknowledgement:
            LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
        });
        assert.equal(res.ok, false);
        if (!res.ok) {
          assert.equal(res.status, 'HOLD');
          assert.equal(res.errorCode, 'INVALID_PERSISTED_ALIGNMENT_SCHEMA');
          assert.equal(res.alignmentSaved, false);
        }
        assert.equal(db.txCreateCalls, 0);
        assert.equal(db.txUpdateCalls, 0);
        assert.equal(db.txSetCalls, 0);
        assert.equal(
          db.getRawDoc(
            LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
            incidentReceiptId
          ),
          undefined
        );
      }
    }

    // 8.15: Unacceptable or unsafe original pre-recovery values -> HOLD and 0 writes
    {
      const unsafeMutations: ReadonlyArray<Record<string, string>> = [
        { titleAr: 'عنوان يحتوي على <script>alert(1)</script>' },
        { titleEn: 'Title with forbidden URL https://example.com/internal' },
        { summaryAr: 'ملخص يحتوي على محرف تحكم ثنائي الاتجاه \u202E غير مسموح' },
        { summaryEn: 'Summary referencing library/quarantine/secret/source.pdf' },
        { titleEn: 'Single-line title\nwith embedded newline' },
        { titleAr: 'أ'.repeat(301) },
        { summaryEn: 'S'.repeat(2001) },
      ];

      for (const patch of unsafeMutations) {
        const db = buildIncidentFixture();
        const rawDoc = db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, incidentDocId)!;
        db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, incidentDocId, {
          ...rawDoc,
          ...patch,
        });

        const service = makeServiceForDb(db, ownerAdmin, recoveryClockIso);
        db.resetCounters();

        const res = await service.alignQuarantineCatalogCase({
          receiptId: incidentReceiptId,
          expectedCaseRevision: 6,
          expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
          expectedAlignmentRevision: 0,
          confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
          legacyUnattributedCatalogUpdateAcknowledgement:
            LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
        });
        assert.equal(res.ok, false);
        if (!res.ok) {
          assert.equal(res.status, 'HOLD');
          assert.equal(res.errorCode, 'INVALID_PERSISTED_ALIGNMENT_SCHEMA');
          assert.equal(res.alignmentSaved, false);
        }
        assert.equal(db.txCreateCalls, 0);
        assert.equal(db.txUpdateCalls, 0);
        assert.equal(db.txSetCalls, 0);
      }
    }

    // 8.16: Commit uncertainty during legacy recovery returns UNKNOWN without automatic retries
    {
      const db = buildIncidentFixture();
      const service = makeServiceForDb(db, ownerAdmin, recoveryClockIso);
      db.resetCounters();
      db.onAfterTransactionWritesStagedHook = () => {
        throw new Error('Simulated network drop after legacy recovery writes staged');
      };

      const unknownRes = await service.alignQuarantineCatalogCase({
        receiptId: incidentReceiptId,
        expectedCaseRevision: 6,
        expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
        expectedAlignmentRevision: 0,
        confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
        legacyUnattributedCatalogUpdateAcknowledgement:
          LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
      });
      assert.equal(unknownRes.ok, false);
      if (!unknownRes.ok && unknownRes.status === 'UNKNOWN') {
        assert.equal(unknownRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
        assert.equal(unknownRes.alignmentSaved, null);
      } else {
        throw new Error('Expected UNKNOWN status on legacy recovery commit uncertainty');
      }
      assert.equal(db.transactionCount, 1, 'Must never auto-retry on uncertain legacy recovery commit');
    }

    console.log(
      'PASS 8: Exceptional server-side legacy unattributed catalog draft recovery guard and historical audit chain verification passed.'
    );

    // =========================================================================
    // PASS 9: LIB-QCAT-LEGACY-R2B — Read-Only Legacy Recovery Inspection
    // =========================================================================
    {
      // 9.1: Read-only recovery inspection on the 6-revision incident fixture performs 7 + 1 + 6 = 14 point reads and 0 writes
      {
        const db = buildIncidentFixture();
        const service = makeServiceForDb(db, ownerAdmin, recoveryClockIso);
        db.resetCounters();

        const inspectRes =
          await service.inspectQuarantineLegacyCatalogRecovery({
            receiptId: incidentReceiptId,
          });

        assert.equal(inspectRes.ok, true);
        if (inspectRes.ok) {
          assert.equal(inspectRes.status, 'INSPECTION_ONLY');
          assert.equal(inspectRes.receiptId, incidentReceiptId);
          assert.equal(inspectRes.documentId, incidentDocId);
          assert.equal(inspectRes.sourceRevision, 1);
          assert.equal(inspectRes.originalHandoffCaseRevision, 3);
          assert.equal(
            inspectRes.originalHandoffCaseUpdatedAt,
            handoffCaseUpdatedAt
          );
          assert.equal(inspectRes.originalHandoffCreatedAt, handoffCreatedAt);
          assert.equal(inspectRes.currentHumanCaseRevision, 6);
          assert.equal(inspectRes.currentHumanCaseUpdatedAt, rev6UpdatedAt);
          assert.equal(inspectRes.catalogUpdatedAt, legacyCatalogUpdatedAt);
          assert.equal(inspectRes.currentAlignmentRevision, 0);
          assert.equal(inspectRes.hasAlignmentRecord, false);
          assert.equal(inspectRes.alignment, null);
          assert.equal(
            inspectRes.historicalCatalogChangeAttribution,
            LIBRARY_QUARANTINE_LEGACY_CATALOG_CHANGE_ATTRIBUTION_STATUS
          );
          assert.equal(inspectRes.historicalChainVerified, true);
          assert.equal(inspectRes.verifiedHumanReviewEventCount, 6);
          assert.equal(inspectRes.recoveryApplied, false);
          assert.equal(inspectRes.requiresSeparateHumanAuthorization, true);
          assert.equal(inspectRes.diff.hasAnyDifference, false);
          assert.equal(
            inspectRes.diff.fields.titleAr.caseValue,
            'إطار حماية البيئة البحرية والساحلية 2026'
          );
          assert.equal(
            inspectRes.diff.fields.titleAr.catalogValue,
            'إطار حماية البيئة البحرية والساحلية 2026'
          );
          assert.equal(inspectRes.handoff.receiptId, incidentReceiptId);
          assert.equal(inspectRes.handoff.caseRevision, 3);
          assert.equal(inspectRes.catalogDocument.id, incidentDocId);
          assert.equal(
            inspectRes.catalogDocument.updatedAt,
            legacyCatalogUpdatedAt
          );
          assert.equal(inspectRes.humanReviewCase.revision, 6);
          assert.equal(inspectRes.hasRecordedRightsDecision, false);
          assert.equal(inspectRes.recordedRightsDecisionCaseRevision, null);
          assert.equal(inspectRes.rightsDecisionInvalidatedByCaseChange, false);
          assert.equal(inspectRes.requiresFreshRightsReview, true);
          assert.equal(inspectRes.isSanitized, false);
          assert.equal(inspectRes.isVerifiedSafe, false);
          assert.equal(inspectRes.isRightsApproved, false);
          assert.equal(inspectRes.isPublished, false);
          assert.equal(inspectRes.isReadyForPeia, false);
        }

        assert.equal(
          db.pointGetCalls,
          14,
          'Read-only inspection on 6-revision incident must perform 7 + 1 + 6 = 14 point reads'
        );
        assert.equal(db.transactionCount, 0);
        assert.equal(db.txGetCalls, 0);
        assert.equal(db.txCreateCalls, 0);
        assert.equal(db.txUpdateCalls, 0);
        assert.equal(db.txSetCalls, 0);

        // Verify zero secret leakage in serialized DTO
        const serializedDto = JSON.stringify(inspectRes);
        assert.equal(serializedDto.includes(sha256), false);
        assert.equal(serializedDto.includes('sourceSha256'), false);
        assert.equal(serializedDto.includes('storagePath'), false);
        assert.equal(serializedDto.includes('library/quarantine/'), false);
        assert.equal(serializedDto.includes('1731500000001'), false);
        assert.equal(serializedDto.includes('generation'), false);
        assert.equal(serializedDto.includes(ownerAdmin.id), false);
        assert.equal(serializedDto.includes(ownerAdmin.email), false);
        assert.equal(serializedDto.includes('actorUid'), false);
        assert.equal(serializedDto.includes('createdBy'), false);
        assert.equal(serializedDto.includes('updatedBy'), false);

        // Verify no alignment or event document was created and qcat doc was untouched
        assert.equal(
          db.getRawDoc(
            LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
            incidentReceiptId
          ),
          undefined
        );
        assert.equal(
          db.getRawDoc(
            LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
            deriveLibraryQuarantineCatalogCaseAlignmentEventId(
              incidentReceiptId,
              1
            )
          ),
          undefined
        );
        const qcatDocAfterInspect = db.getRawDoc(
          LIBRARY_DOCUMENTS_COLLECTION,
          incidentDocId
        ) as unknown as LibraryDocument;
        assert.equal(qcatDocAfterInspect.updatedAt, legacyCatalogUpdatedAt);

        // Ordinary GET and ordinary ALIGN still return HOLD after inspection
        db.resetCounters();
        const postInspectGet = await service.getQuarantineCatalogCaseAlignment({
          receiptId: incidentReceiptId,
        });
        assert.equal(postInspectGet.ok, false);
        if (!postInspectGet.ok) {
          assert.equal(postInspectGet.status, 'HOLD');
          assert.equal(postInspectGet.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
        }
        assert.equal(db.pointGetCalls, 7);

        db.resetCounters();
        const postInspectOrdinaryAlign =
          await service.alignQuarantineCatalogCase({
            receiptId: incidentReceiptId,
            expectedCaseRevision: 6,
            expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
            expectedAlignmentRevision: 0,
            confirmation:
              LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
          });
        assert.equal(postInspectOrdinaryAlign.ok, false);
        if (!postInspectOrdinaryAlign.ok) {
          assert.equal(postInspectOrdinaryAlign.status, 'HOLD');
          assert.equal(
            postInspectOrdinaryAlign.errorCode,
            'INCONSISTENT_ALIGNMENT_STATE'
          );
        }
        assert.equal(db.txCreateCalls, 0);
        assert.equal(db.txUpdateCalls, 0);
      }

      // 9.2: Callable executeManageLibraryDocumentsRequest for inspectQuarantineLegacyCatalogRecovery (14 point reads, 0 writes)
      {
        const db = buildIncidentFixture();
        db.resetCounters();

        const callableInspectRes = await executeManageLibraryDocumentsRequest(
          {
            auth: {
              uid: curatorWithCreate.id,
              token: { email: curatorWithCreate.email },
            },
            data: {
              action: 'inspectQuarantineLegacyCatalogRecovery',
              receiptId: incidentReceiptId,
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

        assert.equal(callableInspectRes.ok, true);
        assert.equal(callableInspectRes.status, 'INSPECTION_ONLY');
        assert.equal(callableInspectRes.verifiedHumanReviewEventCount, 6);
        assert.equal(callableInspectRes.recoveryApplied, false);
        assert.equal(callableInspectRes.requiresSeparateHumanAuthorization, true);
        assert.equal(db.pointGetCalls, 14);
        assert.equal(db.transactionCount, 0);
      }

      // 9.3: Unauthorized actor and disabled gate rejected before any Firestore reads
      {
        const db = buildIncidentFixture();
        const unauthorizedService = makeServiceForDb(
          db,
          rightsReviewerOnly,
          recoveryClockIso
        );
        db.resetCounters();

        const unauthServiceRes =
          await unauthorizedService.inspectQuarantineLegacyCatalogRecovery({
            receiptId: incidentReceiptId,
          });
        assert.equal(unauthServiceRes.ok, false);
        if (!unauthServiceRes.ok) {
          assert.equal(unauthServiceRes.status, 'HOLD');
          assert.equal(
            unauthServiceRes.errorCode,
            'UNAUTHORIZED_ALIGNMENT_ACTOR'
          );
        }
        assert.equal(db.pointGetCalls, 0);
        assert.equal(db.transactionCount, 0);

        db.resetCounters();
        await assert.rejects(
          async () => {
            await executeManageLibraryDocumentsRequest(
              {
                auth: {
                  uid: rightsReviewerOnly.id,
                  token: { email: rightsReviewerOnly.email },
                },
                data: {
                  action: 'inspectQuarantineLegacyCatalogRecovery',
                  receiptId: incidentReceiptId,
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
        assert.equal(db.pointGetCalls, 0);

        process.env[LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR] = 'false';
        db.resetCounters();
        await assert.rejects(
          async () => {
            await executeManageLibraryDocumentsRequest(
              {
                auth: {
                  uid: curatorWithCreate.id,
                  token: { email: curatorWithCreate.email },
                },
                data: {
                  action: 'inspectQuarantineLegacyCatalogRecovery',
                  receiptId: incidentReceiptId,
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
            assert.equal(
              (err as { code?: string }).code,
              'failed-precondition'
            );
            return true;
          }
        );
        assert.equal(db.pointGetCalls, 0);
        process.env[LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR] = 'true';
      }

      // 9.4: Extra or unexpected input keys on inspectQuarantineLegacyCatalogRecovery rejected with 0 reads
      {
        const db = buildIncidentFixture();
        const service = makeServiceForDb(db, ownerAdmin, recoveryClockIso);
        db.resetCounters();

        const extraKeyServiceRes =
          await service.inspectQuarantineLegacyCatalogRecovery({
            receiptId: incidentReceiptId,
            legacyUnattributedCatalogUpdateAcknowledgement:
              LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
          });
        assert.equal(extraKeyServiceRes.ok, false);
        if (!extraKeyServiceRes.ok) {
          assert.equal(extraKeyServiceRes.status, 'HOLD');
          assert.equal(
            extraKeyServiceRes.errorCode,
            'INVALID_ALIGNMENT_PAYLOAD'
          );
        }
        assert.equal(db.pointGetCalls, 0);

        db.resetCounters();
        await assert.rejects(
          async () => {
            await executeManageLibraryDocumentsRequest(
              {
                auth: {
                  uid: curatorWithCreate.id,
                  token: { email: curatorWithCreate.email },
                },
                data: {
                  action: 'inspectQuarantineLegacyCatalogRecovery',
                  receiptId: incidentReceiptId,
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
            assert.equal((err as { code?: string }).code, 'invalid-argument');
            return true;
          }
        );
        assert.equal(db.pointGetCalls, 0);
      }

      // 9.5: External Callable alignQuarantineCatalogCase rejects legacyUnattributedCatalogUpdateAcknowledgement
      {
        const db = buildIncidentFixture();
        db.resetCounters();

        await assert.rejects(
          async () => {
            await executeManageLibraryDocumentsRequest(
              {
                auth: {
                  uid: ownerAdmin.id,
                  token: { email: ownerAdmin.email },
                },
                data: {
                  action: 'alignQuarantineCatalogCase',
                  receiptId: incidentReceiptId,
                  expectedCaseRevision: 6,
                  expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
                  expectedAlignmentRevision: 0,
                  confirmation:
                    LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
                  legacyUnattributedCatalogUpdateAcknowledgement:
                    LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
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
            assert.equal((err as { code?: string }).code, 'invalid-argument');
            assert.match(
              String((err as { message?: string }).message),
              /legacyUnattributedCatalogUpdateAcknowledgement/
            );
            return true;
          }
        );
        assert.equal(db.pointGetCalls, 0);
        assert.equal(db.transactionCount, 0);
        assert.equal(db.txCreateCalls, 0);
        assert.equal(db.txUpdateCalls, 0);
      }

      // 9.6: Missing or corrupted handoff event returns HOLD
      {
        const dbCorruptHandoffEv = buildIncidentFixture();
        dbCorruptHandoffEv.seedDoc(
          LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION,
          incidentReceiptId,
          { corrupted: true }
        );
        const service = makeServiceForDb(dbCorruptHandoffEv);
        const res = await service.inspectQuarantineLegacyCatalogRecovery({
          receiptId: incidentReceiptId,
        });
        assert.equal(res.ok, false);
        if (!res.ok) {
          assert.equal(res.status, 'HOLD');
          assert.equal(res.errorCode, 'INVALID_PERSISTED_HANDOFF_SCHEMA');
        }
      }

      // 9.7: Missing or corrupted human-review event _1.._6 returns HOLD
      {
        const dbMissingEv = buildIncidentFixture();
        const rev5Id = deriveLibraryQuarantineHumanReviewEventId(
          incidentReceiptId,
          5
        );
        dbMissingEv.seedDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
          rev5Id,
          { broken: true }
        );
        const service = makeServiceForDb(dbMissingEv);
        const res = await service.inspectQuarantineLegacyCatalogRecovery({
          receiptId: incidentReceiptId,
        });
        assert.equal(res.ok, false);
        if (!res.ok) {
          assert.equal(res.status, 'HOLD');
          assert.equal(res.errorCode, 'INVALID_HUMAN_REVIEW_CASE');
        }

        // Advance case to rev 7 without seeding _7
        const dbMissingEv7 = buildIncidentFixture();
        const caseDoc = dbMissingEv7.getRawDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
          incidentReceiptId
        )!;
        dbMissingEv7.seedDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
          incidentReceiptId,
          { ...caseDoc, revision: 7 }
        );
        const resMissing7 = await makeServiceForDb(
          dbMissingEv7
        ).inspectQuarantineLegacyCatalogRecovery({
          receiptId: incidentReceiptId,
        });
        assert.equal(resMissing7.ok, false);
        if (!resMissing7.ok) {
          assert.equal(resMissing7.status, 'HOLD');
          assert.equal(resMissing7.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
        }
      }

      // 9.8: Event with mismatched sourceSha256 / sourceRevision returns HOLD
      {
        const dbSourceMismatch = buildIncidentFixture();
        const rev3Id = deriveLibraryQuarantineHumanReviewEventId(
          incidentReceiptId,
          3
        );
        const rev3Doc = dbSourceMismatch.getRawDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
          rev3Id
        )!;
        dbSourceMismatch.seedDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
          rev3Id,
          {
            ...rev3Doc,
            sourceSha256: 'b'.repeat(64),
          }
        );
        const res = await makeServiceForDb(
          dbSourceMismatch
        ).inspectQuarantineLegacyCatalogRecovery({
          receiptId: incidentReceiptId,
        });
        assert.equal(res.ok, false);
        if (!res.ok) {
          assert.equal(res.status, 'HOLD');
          assert.equal(res.errorCode, 'CASE_SOURCE_MISMATCH');
        }
      }

      // 9.9: Invalid chronology or security posture violation returns HOLD
      {
        const dbBadChronology = buildIncidentFixture();
        const rev4Id = deriveLibraryQuarantineHumanReviewEventId(
          incidentReceiptId,
          4
        );
        const rev4Doc = dbBadChronology.getRawDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
          rev4Id
        )!;
        dbBadChronology.seedDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
          rev4Id,
          {
            ...rev4Doc,
            recordedAt: '2026-11-13T13:22:00.000Z', // >= sourceUpdatedAt but older than rev 3!
          }
        );
        const resChronology = await makeServiceForDb(
          dbBadChronology
        ).inspectQuarantineLegacyCatalogRecovery({
          receiptId: incidentReceiptId,
        });
        assert.equal(resChronology.ok, false);
        if (!resChronology.ok) {
          assert.equal(resChronology.status, 'HOLD');
          assert.equal(resChronology.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
        }

        const dbPostureViolation = buildIncidentFixture();
        const handoffDoc = dbPostureViolation.getRawDoc(
          LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
          incidentReceiptId
        )!;
        dbPostureViolation.seedDoc(
          LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
          incidentReceiptId,
          {
            ...handoffDoc,
            isPublished: true,
          }
        );
        const resPosture = await makeServiceForDb(
          dbPostureViolation
        ).inspectQuarantineLegacyCatalogRecovery({
          receiptId: incidentReceiptId,
        });
        assert.equal(resPosture.ok, false);
        if (!resPosture.ok) {
          assert.equal(resPosture.status, 'HOLD');
          assert.equal(resPosture.errorCode, 'SECURITY_POSTURE_VIOLATION');
        }
      }

      // 9.10: Existing alignment document or unmodified handoff draft returns HOLD
      {
        // Unmodified handoff draft (catalogDoc.updatedAt === handoff.createdAt)
        const dbUnmodified = new InMemoryAlignmentFirestoreDatabase();
        const seededNormal = makeSeededRecord(buildHexReceiptId(90), 2);
        seedDatabaseWithRecord(dbUnmodified, seededNormal);
        const resUnmodified = await makeServiceForDb(
          dbUnmodified
        ).inspectQuarantineLegacyCatalogRecovery({
          receiptId: seededNormal.receiptId,
        });
        assert.equal(resUnmodified.ok, false);
        if (!resUnmodified.ok) {
          assert.equal(resUnmodified.status, 'HOLD');
          assert.equal(resUnmodified.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
        }

        // Existing alignment document
        const dbWithAlignment = buildIncidentFixture();
        const svc = makeServiceForDb(
          dbWithAlignment,
          ownerAdmin,
          recoveryClockIso
        );
        const recovered = await svc.alignQuarantineCatalogCase({
          receiptId: incidentReceiptId,
          expectedCaseRevision: 6,
          expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
          expectedAlignmentRevision: 0,
          confirmation:
            LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
          legacyUnattributedCatalogUpdateAcknowledgement:
            LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
        });
        assert.equal(recovered.ok, true);

        const resAfterRecovery =
          await svc.inspectQuarantineLegacyCatalogRecovery({
            receiptId: incidentReceiptId,
          });
        assert.equal(resAfterRecovery.ok, false);
        if (!resAfterRecovery.ok) {
          assert.equal(resAfterRecovery.status, 'HOLD');
          assert.equal(
            resAfterRecovery.errorCode,
            'INCONSISTENT_ALIGNMENT_STATE'
          );
        }
      }

      // 9.11: Case revision > 32 returns HOLD with 7 point reads and 0 event reads
      {
        const dbRev33 = buildIncidentFixture();
        const caseDoc = dbRev33.getRawDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
          incidentReceiptId
        )!;
        dbRev33.seedDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
          incidentReceiptId,
          {
            ...caseDoc,
            revision: 33,
          }
        );
        const svc = makeServiceForDb(dbRev33);
        dbRev33.resetCounters();
        const resRev33 = await svc.inspectQuarantineLegacyCatalogRecovery({
          receiptId: incidentReceiptId,
        });
        assert.equal(resRev33.ok, false);
        if (!resRev33.ok) {
          assert.equal(resRev33.status, 'HOLD');
          assert.equal(resRev33.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
        }
        assert.equal(dbRev33.pointGetCalls, 7);
        assert.equal(dbRev33.transactionCount, 0);
      }

      console.log(
        'PASS 9: LIB-QCAT-LEGACY-R2B read-only legacy catalog recovery inspection verified.'
      );

      // =========================================================================
      // PASS 10: LIB-QCAT-LEGACY-R2D — Callable applyQuarantineLegacyCatalogRecovery
      // =========================================================================
      // 10.1: Callable applyQuarantineLegacyCatalogRecovery rejects missing, wrong, extra, or symbol fields with 0 reads/writes
      {
        const db = buildIncidentFixture();
        db.resetCounters();

        const validBasePayload = {
          action: 'applyQuarantineLegacyCatalogRecovery',
          receiptId: incidentReceiptId,
          expectedCaseRevision: 6,
          expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
          expectedAlignmentRevision: 0,
          confirmation:
            LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
          legacyUnattributedCatalogUpdateAcknowledgement:
            LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
        };

        const invalidPayloads: Array<Record<string, unknown>> = [
          // Missing legacyUnattributedCatalogUpdateAcknowledgement
          {
            action: 'applyQuarantineLegacyCatalogRecovery',
            receiptId: incidentReceiptId,
            expectedCaseRevision: 6,
            expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
            expectedAlignmentRevision: 0,
            confirmation:
              LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
          },
          // Wrong legacyUnattributedCatalogUpdateAcknowledgement
          {
            ...validBasePayload,
            legacyUnattributedCatalogUpdateAcknowledgement:
              'APPLY_CASE_METADATA',
          },
          // Wrong confirmation
          {
            ...validBasePayload,
            confirmation: 'ACKNOWLEDGE_UNATTRIBUTED_LEGACY_CATALOG_CHANGE',
          },
          // Extra field
          {
            ...validBasePayload,
            extraField: true,
          },
          // Invalid receiptId
          {
            ...validBasePayload,
            receiptId: 'invalid-receipt-id',
          },
          // Invalid expectedCaseRevision
          {
            ...validBasePayload,
            expectedCaseRevision: 0,
          },
          // Invalid expectedCatalogUpdatedAt
          {
            ...validBasePayload,
            expectedCatalogUpdatedAt: '   ',
          },
          // Invalid expectedAlignmentRevision
          {
            ...validBasePayload,
            expectedAlignmentRevision: -1,
          },
        ];

        for (const badData of invalidPayloads) {
          await assert.rejects(
            async () => {
              await executeManageLibraryDocumentsRequest(
                {
                  auth: {
                    uid: ownerAdmin.id,
                    token: { email: ownerAdmin.email },
                  },
                  data: badData,
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
              assert.equal((err as { code?: string }).code, 'invalid-argument');
              return true;
            }
          );
        }

        const payloadWithSymbol: Record<PropertyKey, unknown> = {
          ...validBasePayload,
        };
        payloadWithSymbol[Symbol('injected')] = 'bad';
        await assert.rejects(
          async () => {
            await executeManageLibraryDocumentsRequest(
              {
                auth: {
                  uid: ownerAdmin.id,
                  token: { email: ownerAdmin.email },
                },
                data: payloadWithSymbol,
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
            assert.equal((err as { code?: string }).code, 'invalid-argument');
            return true;
          }
        );

        assert.equal(db.pointGetCalls, 0);
        assert.equal(db.transactionCount, 0);
        assert.equal(db.txCreateCalls, 0);
        assert.equal(db.txUpdateCalls, 0);
      }

      // 10.2: Callable applyQuarantineLegacyCatalogRecovery enforces release gates and Review+Create RBAC with 0 reads/writes
      {
        const db = buildIncidentFixture();
        db.resetCounters();

        // Unauthorized role (Review only, missing Create)
        await assert.rejects(
          async () => {
            await executeManageLibraryDocumentsRequest(
              {
                auth: {
                  uid: rightsReviewerOnly.id,
                  token: { email: rightsReviewerOnly.email },
                },
                data: {
                  action: 'applyQuarantineLegacyCatalogRecovery',
                  receiptId: incidentReceiptId,
                  expectedCaseRevision: 6,
                  expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
                  expectedAlignmentRevision: 0,
                  confirmation:
                    LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
                  legacyUnattributedCatalogUpdateAcknowledgement:
                    LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
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
        assert.equal(db.pointGetCalls, 0);
        assert.equal(db.transactionCount, 0);

        // Release gate disabled
        process.env[LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR] = 'false';
        await assert.rejects(
          async () => {
            await executeManageLibraryDocumentsRequest(
              {
                auth: {
                  uid: ownerAdmin.id,
                  token: { email: ownerAdmin.email },
                },
                data: {
                  action: 'applyQuarantineLegacyCatalogRecovery',
                  receiptId: incidentReceiptId,
                  expectedCaseRevision: 6,
                  expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
                  expectedAlignmentRevision: 0,
                  confirmation:
                    LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
                  legacyUnattributedCatalogUpdateAcknowledgement:
                    LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
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
            assert.equal(
              (err as { code?: string }).code,
              'failed-precondition'
            );
            return true;
          }
        );
        process.env[LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR] = 'true';
        assert.equal(db.pointGetCalls, 0);
        assert.equal(db.transactionCount, 0);
      }

      // 10.3: End-to-end Callable workflow for verified historical incident (GET HOLD -> INSPECT -> APPLY RECOVERY -> GET READY)
      {
        const db = buildIncidentFixture();

        // Step A: Ordinary GET returns HOLD (INCONSISTENT_ALIGNMENT_STATE)
        db.resetCounters();
        const stepAGet = (await executeManageLibraryDocumentsRequest(
          {
            auth: {
              uid: curatorWithCreate.id,
              token: { email: curatorWithCreate.email },
            },
            data: {
              action: 'getQuarantineCatalogCaseAlignment',
              receiptId: incidentReceiptId,
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            draftDatabase: db,
            caseAlignmentClock: () => recoveryClockIso,
          }
        )) as GetLibraryQuarantineCatalogCaseAlignmentResponse;
        assert.equal(stepAGet.ok, false);
        if (!stepAGet.ok) {
          assert.equal(stepAGet.status, 'HOLD');
          assert.equal(stepAGet.errorCode, 'INCONSISTENT_ALIGNMENT_STATE');
        }
        assert.equal(db.transactionCount, 0);

        // Step B: Read-only inspection returns INSPECTION_ONLY
        db.resetCounters();
        const stepBInspect = (await executeManageLibraryDocumentsRequest(
          {
            auth: {
              uid: curatorWithCreate.id,
              token: { email: curatorWithCreate.email },
            },
            data: {
              action: 'inspectQuarantineLegacyCatalogRecovery',
              receiptId: incidentReceiptId,
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            draftDatabase: db,
            caseAlignmentClock: () => recoveryClockIso,
          }
        )) as InspectLibraryQuarantineLegacyCatalogRecoveryResponse;
        assert.equal(stepBInspect.ok, true);
        if (!stepBInspect.ok) {
          throw new Error('Expected stepBInspect to succeed');
        }
        assert.equal(stepBInspect.status, 'INSPECTION_ONLY');
        assert.equal(stepBInspect.currentHumanCaseRevision, 6);
        assert.equal(stepBInspect.originalHandoffCaseRevision, 3);
        assert.equal(stepBInspect.currentAlignmentRevision, 0);
        assert.equal(stepBInspect.hasAlignmentRecord, false);
        assert.equal(db.pointGetCalls, 14);
        assert.equal(db.transactionCount, 0);

        // Step C: Authorized recovery via applyQuarantineLegacyCatalogRecovery
        db.resetCounters();
        const stepCRecover = (await executeManageLibraryDocumentsRequest(
          {
            auth: {
              uid: curatorWithCreate.id,
              token: { email: curatorWithCreate.email },
            },
            data: {
              action: 'applyQuarantineLegacyCatalogRecovery',
              receiptId: stepBInspect.receiptId,
              expectedCaseRevision: stepBInspect.currentHumanCaseRevision,
              expectedCatalogUpdatedAt: stepBInspect.catalogUpdatedAt,
              expectedAlignmentRevision: stepBInspect.currentAlignmentRevision,
              confirmation:
                LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
              legacyUnattributedCatalogUpdateAcknowledgement:
                LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            draftDatabase: db,
            caseAlignmentClock: () => recoveryClockIso,
          }
        )) as AlignLibraryQuarantineCatalogCaseResponse;
        assert.equal(stepCRecover.ok, true);
        if (stepCRecover.ok) {
          assert.equal(stepCRecover.status, 'ALIGNED');
          assert.equal(stepCRecover.alignmentOutcome, 'ALIGNED');
          assert.equal(stepCRecover.alignmentSaved, true);
          assert.equal(stepCRecover.currentAlignmentRevision, 1);
          assert.equal(stepCRecover.effectiveAlignedCaseRevision, 6);
          assert.equal(stepCRecover.currentHumanCaseRevision, 6);
          assert.equal(stepCRecover.catalogUpdatedAt, recoveryClockIso);
          assert.equal(stepCRecover.isSanitized, false);
          assert.equal(stepCRecover.isVerifiedSafe, false);
          assert.equal(stepCRecover.isRightsApproved, false);
          assert.equal(stepCRecover.isPublished, false);
          assert.equal(stepCRecover.isReadyForPeia, false);
        }
        assert.equal(db.transactionCount, 1);
        assert.equal(db.txGetCalls, 15);
        assert.equal(db.txUpdateCalls, 1);
        assert.equal(db.txCreateCalls, 2);

        const updatedQcat = db.getRawDoc(
          LIBRARY_DOCUMENTS_COLLECTION,
          incidentDocId
        ) as unknown as LibraryDocument;
        assert.equal(updatedQcat.workflowState, WorkflowState.Draft);
        assert.equal(
          updatedQcat.rightsStatus,
          LibraryRightsStatus.ReviewRequired
        );

        const createdEvent1Id =
          deriveLibraryQuarantineCatalogCaseAlignmentEventId(
            incidentReceiptId,
            1
          );
        const rawEvent1 = db.getRawDoc(
          LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
          createdEvent1Id
        )!;
        assert.equal(Object.keys(rawEvent1).length, 27);
        assert.equal(
          rawEvent1.reason,
          LIBRARY_QUARANTINE_LEGACY_RECOVERY_ALIGNMENT_EVENT_REASON
        );
        assert.equal(
          rawEvent1.historicalCatalogChangeAttribution,
          LIBRARY_QUARANTINE_LEGACY_CATALOG_CHANGE_ATTRIBUTION_STATUS
        );

        // Step D: Subsequent ordinary GET returns READY / ALIGNED
        db.resetCounters();
        const stepDGet = (await executeManageLibraryDocumentsRequest(
          {
            auth: {
              uid: curatorWithCreate.id,
              token: { email: curatorWithCreate.email },
            },
            data: {
              action: 'getQuarantineCatalogCaseAlignment',
              receiptId: incidentReceiptId,
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            draftDatabase: db,
            caseAlignmentClock: () => recoveryClockIso,
          }
        )) as GetLibraryQuarantineCatalogCaseAlignmentResponse;
        assert.equal(stepDGet.ok, true);
        if (stepDGet.ok) {
          assert.equal(stepDGet.status, 'READY');
          assert.equal(stepDGet.alignmentState, 'ALIGNED');
          assert.equal(stepDGet.currentAlignmentRevision, 1);
          assert.equal(stepDGet.effectiveAlignedCaseRevision, 6);
          assert.equal(stepDGet.diff.hasAnyDifference, false);
        }
        assert.equal(db.pointGetCalls, 7);
        assert.equal(db.transactionCount, 0);
      }

      // 10.4: Stale CAS tokens and post-stage commit uncertainty through Callable applyQuarantineLegacyCatalogRecovery
      {
        const db = buildIncidentFixture();

        // Stale expectedCaseRevision (5 instead of 6) -> CONFLICT with 0 writes
        db.resetCounters();
        const staleRevRes = (await executeManageLibraryDocumentsRequest(
          {
            auth: {
              uid: ownerAdmin.id,
              token: { email: ownerAdmin.email },
            },
            data: {
              action: 'applyQuarantineLegacyCatalogRecovery',
              receiptId: incidentReceiptId,
              expectedCaseRevision: 5,
              expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
              expectedAlignmentRevision: 0,
              confirmation:
                LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
              legacyUnattributedCatalogUpdateAcknowledgement:
                LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            draftDatabase: db,
            caseAlignmentClock: () => recoveryClockIso,
          }
        )) as AlignLibraryQuarantineCatalogCaseResponse;
        assert.equal(staleRevRes.ok, false);
        assert.equal(staleRevRes.status, 'CONFLICT');
        assert.equal(db.txCreateCalls, 0);
        assert.equal(db.txUpdateCalls, 0);

        // Post-stage commit failure -> UNKNOWN
        db.onAfterTransactionWritesStagedHook = () => {
          throw new Error('Simulated commit network drop');
        };
        const unknownRes = (await executeManageLibraryDocumentsRequest(
          {
            auth: {
              uid: ownerAdmin.id,
              token: { email: ownerAdmin.email },
            },
            data: {
              action: 'applyQuarantineLegacyCatalogRecovery',
              receiptId: incidentReceiptId,
              expectedCaseRevision: 6,
              expectedCatalogUpdatedAt: legacyCatalogUpdatedAt,
              expectedAlignmentRevision: 0,
              confirmation:
                LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
              legacyUnattributedCatalogUpdateAcknowledgement:
                LIBRARY_QUARANTINE_LEGACY_UNATTRIBUTED_CATALOG_CHANGE_ACKNOWLEDGEMENT_LITERAL,
            },
          },
          adminRepo,
          dummyService,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            draftDatabase: db,
            caseAlignmentClock: () => recoveryClockIso,
          }
        )) as AlignLibraryQuarantineCatalogCaseResponse;
        assert.equal(unknownRes.ok, false);
        assert.equal(unknownRes.status, 'UNKNOWN');
        if (!unknownRes.ok && unknownRes.status === 'UNKNOWN') {
          assert.equal(unknownRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
          assert.equal(unknownRes.alignmentSaved, null);
        }
      }

      console.log(
        'PASS 10: LIB-QCAT-LEGACY-R2D callable applyQuarantineLegacyCatalogRecovery verified.'
      );
    }
  }

  console.log(
    '\nALL LIB-FILE-CASE-ALIGNMENT-01 BACKEND TESTS PASSED (10/10).'
  );
}

runTests().catch((err: unknown) => {
  console.error('LIB-FILE-CASE-ALIGNMENT-01 BACKEND TESTS FAILED:', err);
  process.exit(1);
});
