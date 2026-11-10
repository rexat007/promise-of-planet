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
import {
  LibraryDocumentType,
  LibraryRightsStatus,
  type LibraryDocument,
} from '../functions/src/shared/libraryContract';
import { WorkflowState } from '../functions/src/shared/workflowContract';
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
  type LibraryQuarantineHumanReviewCaseStatus,
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
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
  type LibraryQuarantinePersistedCatalogCaseAlignment,
} from '../functions/src/library/libraryQuarantineCatalogCaseAlignmentService';
import {
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
  deriveLibraryQuarantineBinarySafetyCaseEventId,
  validatePersistedLibraryQuarantineBinarySafetyCase,
  validatePersistedLibraryQuarantineBinarySafetyCaseEvent,
  validateSaveLibraryQuarantineBinarySafetyCaseInput,
} from '../functions/src/library/libraryQuarantineBinarySafetyCaseContract';
import {
  FirestoreLibraryQuarantineBinarySafetyCaseStore,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore';
import {
  LibraryQuarantineBinarySafetyCaseService,
  isAuthorizedHumanBinarySafetyOwner,
} from '../functions/src/library/libraryQuarantineBinarySafetyCaseService';

const require = createRequire(import.meta.url);
const {
  LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR,
  LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR,
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

interface RecordedTxOp {
  readonly kind: 'get' | 'create' | 'update' | 'set';
  readonly collectionName: string;
  readonly docId: string;
}

class InMemoryBinarySafetyFirestoreDatabase
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
  public onBeforeTransactionReadsHook: ((attempt: number) => void) | null =
    null;
  public onBeforeTransactionWritesHook: ((attempt: number) => void) | null =
    null;
  public onAfterTransactionWritesStagedHook:
    | ((attempt: number) => void)
    | null = null;
  public maxRetryAttempts = 1;

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

  public collection(collectionName: string): {
    doc(docId: string): LibraryQuarantineFirestoreDocumentRef;
  } {
    return {
      doc: (docId: string): LibraryQuarantineFirestoreDocumentRef => {
        const ref: LibraryQuarantineFirestoreDocumentRef & {
          readonly __collectionName: string;
        } = {
          id: docId,
          __collectionName: collectionName,
          get: async (): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
            this.pointGetCalls += 1;
            if (this.throwOnPointGet) {
              throw this.throwOnPointGet;
            }
            const stored = this.collections.get(collectionName)?.get(docId);
            return {
              id: docId,
              exists: stored !== undefined,
              data: () => (stored ? deepClone(stored) : undefined),
            };
          },
        };
        return ref;
      },
    };
  }

  public async runTransaction<T>(
    updateFunction: (
      tx: LibraryQuarantineReviewDraftFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    let lastError: unknown;
    const maxAttempts = Math.max(1, this.maxRetryAttempts);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.transactionCount += 1;
      this.onBeforeTransactionReadsHook?.(attempt);

      const workingState = new Map<
        string,
        Map<string, Record<string, unknown>>
      >();
      for (const [colName, colMap] of this.collections.entries()) {
        const clonedMap = new Map<string, Record<string, unknown>>();
        for (const [id, docData] of colMap.entries()) {
          clonedMap.set(id, deepClone(docData));
        }
        workingState.set(colName, clonedMap);
      }

      let writePhaseStarted = false;
      const stagedMutations: Array<() => void> = [];

      const resolveColName = (
        ref: LibraryQuarantineFirestoreDocumentRef
      ): string =>
        (
          ref as LibraryQuarantineFirestoreDocumentRef & {
            readonly __collectionName: string;
          }
        ).__collectionName;

      const tx: LibraryQuarantineReviewDraftFirestoreTransaction & {
        update(
          ref: LibraryQuarantineFirestoreDocumentRef,
          data: Record<string, unknown>
        ): void;
        set(
          ref: LibraryQuarantineFirestoreDocumentRef,
          data: Record<string, unknown>
        ): void;
      } = {
        get: async (
          ref: LibraryQuarantineFirestoreDocumentRef
        ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
          if (writePhaseStarted) {
            throw new Error(
              'FIRESTORE_TX_ORDER_VIOLATION: All transaction reads must complete before the first write.'
            );
          }
          this.txGetCalls += 1;
          const colName = resolveColName(ref);
          this.txOps.push({
            kind: 'get',
            collectionName: colName,
            docId: ref.id,
          });
          const stored = workingState.get(colName)?.get(ref.id);
          return {
            id: ref.id,
            exists: stored !== undefined,
            data: () => (stored ? deepClone(stored) : undefined),
          };
        },
        create: (
          ref: LibraryQuarantineFirestoreDocumentRef,
          data: Record<string, unknown>
        ): void => {
          if (!writePhaseStarted) {
            writePhaseStarted = true;
            this.onBeforeTransactionWritesHook?.(attempt);
          }
          const colName = resolveColName(ref);
          this.txCreateCalls += 1;
          this.txOps.push({
            kind: 'create',
            collectionName: colName,
            docId: ref.id,
          });
          stagedMutations.push(() => {
            let col = workingState.get(colName);
            if (!col) {
              col = new Map();
              workingState.set(colName, col);
            }
            if (col.has(ref.id)) {
              throw new Error(`ALREADY_EXISTS: ${colName}/${ref.id}`);
            }
            col.set(ref.id, deepClone(data));
          });
        },
        update: (
          ref: LibraryQuarantineFirestoreDocumentRef,
          data: Record<string, unknown>
        ): void => {
          if (!writePhaseStarted) {
            writePhaseStarted = true;
            this.onBeforeTransactionWritesHook?.(attempt);
          }
          const colName = resolveColName(ref);
          this.txUpdateCalls += 1;
          this.txOps.push({
            kind: 'update',
            collectionName: colName,
            docId: ref.id,
          });
          stagedMutations.push(() => {
            const col = workingState.get(colName);
            if (!col || !col.has(ref.id)) {
              throw new Error(`NOT_FOUND: ${colName}/${ref.id}`);
            }
            col.set(ref.id, deepClone(data));
          });
        },
        set: (
          ref: LibraryQuarantineFirestoreDocumentRef,
          _data: Record<string, unknown>
        ): void => {
          const colName = resolveColName(ref);
          this.txSetCalls += 1;
          this.txOps.push({
            kind: 'set',
            collectionName: colName,
            docId: ref.id,
          });
          throw new Error('UNSAFE_TX_SET_FORBIDDEN');
        },
      };

      try {
        const result = await updateFunction(tx);

        for (const mutate of stagedMutations) {
          mutate();
        }

        if (writePhaseStarted && this.onAfterTransactionWritesStagedHook) {
          this.onAfterTransactionWritesStagedHook(attempt);
        }

        this.collections.clear();
        for (const [colName, colMap] of workingState.entries()) {
          this.collections.set(colName, colMap);
        }

        return result;
      } catch (err: unknown) {
        lastError = err;
        if (attempt < maxAttempts && (err as { retryable?: boolean })?.retryable) {
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }
}

class InMemoryAdminRepo implements AdminRepository {
  private readonly byUid = new Map<string, AdminUser>();
  public getAdminCalls = 0;

  constructor(users: readonly AdminUser[]) {
    for (const u of users) {
      this.byUid.set(u.id, Object.freeze({ ...u }));
    }
  }

  public async getAdminByUid(uid: string): Promise<AdminUser | null> {
    this.getAdminCalls += 1;
    return this.byUid.get(uid) ?? null;
  }

  public async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    this.byUid.set(admin.id, Object.freeze({ ...admin }));
    return admin;
  }

  public async listAdmins(): Promise<AdminUser[]> {
    return Array.from(this.byUid.values());
  }
}

function seedFullEligibleChain(
  db: InMemoryBinarySafetyFirestoreDatabase,
  index: number,
  overrides: {
    readonly format?: 'PDF' | 'DOCX';
    readonly receiptState?: LibraryQuarantineReceiptState;
    readonly receiptRevision?: number;
    readonly caseStatus?: LibraryQuarantineHumanReviewCaseStatus;
    readonly caseRevision?: number;
    readonly caseUpdatedAt?: string;
    readonly handoffCaseRevision?: number;
    readonly handoffCaseUpdatedAt?: string;
    readonly documentWorkflowState?: WorkflowState;
    readonly documentRightsStatus?: LibraryRightsStatus;
    readonly documentVersionReferenceUrl?: string;
    readonly documentUpdatedAt?: string;
    readonly includeAlignment?: boolean;
    readonly alignedHumanCaseRevision?: number;
    readonly alignedHumanCaseUpdatedAt?: string;
  } = {}
) {
  const receiptId = buildHexReceiptId(index);
  const documentId = deriveQuarantineCatalogDocumentId(receiptId);
  const sha256 = createHash('sha256')
    .update(Buffer.from(`Binary Safety Test Payload #${index}`, 'utf8'))
    .digest('hex');

  const format = overrides.format ?? 'PDF';
  const canonicalExtension = format === 'PDF' ? ('pdf' as const) : ('docx' as const);
  const canonicalMimeType =
    format === 'PDF'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const deepInspectionStatus =
    format === 'PDF'
      ? ('PDF_REQUIRES_ISOLATED_PARSER' as const)
      : ('DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION' as const);

  const receiptRevision = overrides.receiptRevision ?? 2;
  const receiptState =
    overrides.receiptState ?? LibraryQuarantineReceiptState.Quarantined;
  const isQuarantined =
    receiptState === LibraryQuarantineReceiptState.Quarantined;
  const isNeedsReconciliation =
    receiptState === LibraryQuarantineReceiptState.NeedsReconciliation;

  const receipt: LibraryQuarantineInternalReceipt = Object.freeze({
    receiptId,
    uploaderUid: 'admin_curator_01',
    originalFilename: `coastal-assessment-${index}.${canonicalExtension}`,
    sanitizedFilename: `coastal-assessment-${index}.${canonicalExtension}`,
    format,
    canonicalExtension,
    canonicalMimeType,
    byteSize: 24576 + index,
    sha256,
    deepInspectionStatus,
    storagePath: `library/quarantine/${receiptId}/source.${canonicalExtension}`,
    state: receiptState,
    generation: isQuarantined ? `173120000000${index}` : null,
    reconciliationReason: isNeedsReconciliation
      ? 'GCS conditional write outcome was ambiguous.'
      : null,
    rejectionReasonCode:
      receiptState === LibraryQuarantineReceiptState.Rejected
        ? 'PDF_ACTIVE_CONTENT_DETECTED'
        : null,
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:05:00.000Z',
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

  const envelope: LibraryQuarantinePersistedReceiptEnvelope = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision: receiptRevision,
    state: receipt.state,
    receipt,
  });

  const draft: LibraryQuarantinePersistedReviewDraft = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
    receiptId,
    sourceRevision: receiptRevision,
    sourceUpdatedAt: receipt.updatedAt,
    sourceSha256: sha256,
    format,
    uploaderUid: receipt.uploaderUid,
    reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
    createdBy: 'admin_curator_01',
    createdAt: '2026-11-10T08:10:00.000Z',
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

  const caseRevision = overrides.caseRevision ?? 2;
  const caseUpdatedAt = overrides.caseUpdatedAt ?? '2026-11-10T08:20:00.000Z';
  const caseStatus = overrides.caseStatus ?? 'METADATA_RECORDED';

  const reviewCase: LibraryQuarantinePersistedHumanReviewCase = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
    receiptId,
    sourceRevision: receiptRevision,
    sourceUpdatedAt: receipt.updatedAt,
    sourceSha256: sha256,
    draftSourceRevision: receiptRevision,
    revision: caseRevision,
    status: caseStatus,
    titleAr: `تقييم السواحل والبيئة البحرية ${index}`,
    titleEn: `Coastal and Marine Assessment ${index}`,
    issuingOrganization: 'برنامج الأمم المتحدة للبيئة (UNEP)',
    summaryAr: 'ملخص تحريري مراجع لتقييم السواحل.',
    summaryEn: 'Reviewed editorial summary for coastal assessment.',
    sourceEvidenceNotes: 'وثيقة رسمية موثقة في أرشيف الأمم المتحدة.',
    rightsEvidenceNotes: 'ملاحظات أولية بانتظار مراجع الحقوق.',
    editorialNotes: 'تمت المراجعة الأولية للبيانات الوصفية.',
    createdBy: 'admin_curator_01',
    createdAt: '2026-11-10T08:15:00.000Z',
    updatedBy: 'admin_curator_01',
    updatedAt: caseUpdatedAt,
  });

  const handoffCaseRevision = overrides.handoffCaseRevision ?? caseRevision;
  const handoffCaseUpdatedAt =
    overrides.handoffCaseUpdatedAt ?? caseUpdatedAt;
  const handoffCreatedAt = '2026-11-10T08:30:00.000Z';

  const handoff: LibraryQuarantinePersistedCatalogHandoff = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
    receiptId,
    documentId,
    sourceRevision: receiptRevision,
    sourceUpdatedAt: receipt.updatedAt,
    sourceSha256: sha256,
    draftSourceRevision: receiptRevision,
    caseRevision: handoffCaseRevision,
    caseUpdatedAt: handoffCaseUpdatedAt,
    organizationId: 'org-unep',
    sourceId: 'src-unep-verified',
    createdBy: 'admin_curator_01',
    createdAt: handoffCreatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

  const docUpdatedAt = overrides.documentUpdatedAt ?? handoffCreatedAt;

  const catalogDoc: LibraryDocument = Object.freeze({
    id: documentId,
    titleAr: reviewCase.titleAr,
    titleEn: reviewCase.titleEn,
    summaryAr: reviewCase.summaryAr,
    summaryEn: reviewCase.summaryEn,
    documentType: LibraryDocumentType.InstitutionalReport,
    organizationId: 'org-unep',
    sourceId: 'src-unep-verified',
    geographyAr: 'إقليمي',
    geographyEn: 'Regional',
    publicationDate: '2026-06-01',
    language: 'bilingual' as const,
    topicsAr: ['البيئة البحرية'],
    topicsEn: ['Marine Environment'],
    environmentalDomains: ['Biodiversity'],
    rightsStatus:
      overrides.documentRightsStatus ?? LibraryRightsStatus.ReviewRequired,
    workflowState: overrides.documentWorkflowState ?? WorkflowState.Draft,
    legalStatusDescriptionAr: 'تقرير إرشادي غير ملزم',
    legalStatusDescriptionEn: 'Non-binding technical report',
    createdAt: handoffCreatedAt,
    updatedAt: docUpdatedAt,
    versions: [
      {
        id: `ver-${documentId}-1`,
        documentId,
        versionNumber: '1.0',
        publishedDate: '2026-06-01',
        changeDescriptionAr: 'مسودة فهرس أولية من الحجر',
        changeDescriptionEn: 'Initial quarantine catalog draft',
        ...(overrides.documentVersionReferenceUrl !== undefined
          ? { referenceUrl: overrides.documentVersionReferenceUrl }
          : {}),
      },
    ],
    workflowHistory: [],
  });

  db.seedDoc(LIBRARY_QUARANTINE_RECEIPT_COLLECTION, receiptId, envelope);
  db.seedDoc(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION, receiptId, draft);
  db.seedDoc(
    LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
    receiptId,
    reviewCase
  );
  db.seedDoc(
    LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
    receiptId,
    handoff
  );
  db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, documentId, catalogDoc);

  if (overrides.includeAlignment) {
    const alignedRev = overrides.alignedHumanCaseRevision ?? caseRevision;
    const alignedUpdatedAt =
      overrides.alignedHumanCaseUpdatedAt ?? caseUpdatedAt;
    const alignment: LibraryQuarantinePersistedCatalogCaseAlignment =
      Object.freeze({
        schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
        receiptId,
        documentId,
        sourceRevision: receiptRevision,
        sourceUpdatedAt: receipt.updatedAt,
        sourceSha256: sha256,
        originalHandoffCaseRevision: handoffCaseRevision,
        alignmentRevision: 1,
        alignedHumanCaseRevision: alignedRev,
        alignedHumanCaseUpdatedAt: alignedUpdatedAt,
        documentUpdatedAt: docUpdatedAt,
        createdBy: 'admin_curator_01',
        createdAt: docUpdatedAt,
        updatedBy: 'admin_curator_01',
        updatedAt: docUpdatedAt,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    db.seedDoc(
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
      receiptId,
      alignment
    );
  }

  return {
    receiptId,
    documentId,
    sha256,
    receipt,
    envelope,
    draft,
    reviewCase,
    handoff,
    catalogDoc,
  };
}

function assertZeroSecretLeakage(dto: unknown, secretSha256: string): void {
  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes(secretSha256), false);
  for (const forbidden of [
    'sourceSha256',
    'createdBy',
    'updatedBy',
    'storagePath',
    'generation',
    'signedUrl',
    'downloadUrl',
    'gs://',
    'library/quarantine/',
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `DTO leaked forbidden token: ${forbidden}`
    );
  }
}

const ownerAdmin: AdminUser = Object.freeze({
  id: 'owner_01',
  name: 'Owner Admin',
  email: 'owner@planet.org',
  role: AdminRole.Owner,
  isActive: true,
});

const inactiveOwnerAdmin: AdminUser = Object.freeze({
  id: 'owner_inactive',
  name: 'Inactive Owner',
  email: 'inactive@planet.org',
  role: AdminRole.Owner,
  isActive: false,
});

const curatorAdmin: AdminUser = Object.freeze({
  id: 'curator_01',
  name: 'Curator Admin',
  email: 'curator@planet.org',
  role: AdminRole.LibraryCurator,
  isActive: true,
});

const rightsReviewerAdmin: AdminUser = Object.freeze({
  id: 'rights_01',
  name: 'Rights Reviewer',
  email: 'rights@planet.org',
  role: AdminRole.RightsReviewer,
  isActive: true,
});

const aiAssistantAdmin: AdminUser = Object.freeze({
  id: 'ai_01',
  name: 'AI Assistant',
  email: 'ai@planet.org',
  role: AdminRole.AIAssistant,
  isActive: true,
});

async function runTests(): Promise<void> {
  console.log('STARTING LIB-FILE-BINARY-SAFETY-CASE-R1 BACKEND TESTS...');

  // =========================================================================
  // TEST 1: Release Gates OFF -> 0 AdminRepo & 0 Firestore reads; RBAC checks
  // =========================================================================
  {
    const db = new InMemoryBinarySafetyFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([
      ownerAdmin,
      inactiveOwnerAdmin,
      curatorAdmin,
      rightsReviewerAdmin,
      aiAssistantAdmin,
    ]);
    const seeded = seedFullEligibleChain(db, 1);

    delete process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR];
    delete process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR];
    delete process.env[LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR];
    delete process.env[LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR];

    await assert.rejects(
      async () => {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: ownerAdmin.id, token: {} },
            data: {
              action: 'getQuarantineBinarySafetyCase',
              receiptId: seeded.receiptId,
            },
          },
          adminRepo,
          undefined as any,
          { draftDatabase: db }
        );
      },
      (err: any) => {
        assert.equal(err.code, 'failed-precondition');
        return true;
      }
    );
    assert.equal(adminRepo.getAdminCalls, 0);
    assert.equal(db.pointGetCalls, 0);

    // RBAC helper verification: only active Owner with Review passes
    assert.equal(isAuthorizedHumanBinarySafetyOwner(ownerAdmin), true);
    assert.equal(isAuthorizedHumanBinarySafetyOwner(inactiveOwnerAdmin), false);
    assert.equal(isAuthorizedHumanBinarySafetyOwner(curatorAdmin), false);
    assert.equal(isAuthorizedHumanBinarySafetyOwner(rightsReviewerAdmin), false);
    assert.equal(isAuthorizedHumanBinarySafetyOwner(aiAssistantAdmin), false);

    // Non-owner, inactive owner, and token spoof / AI claim rejected with 0 Firestore reads
    for (const badCaller of [
      { uid: curatorAdmin.id, token: {} },
      { uid: rightsReviewerAdmin.id, token: {} },
      { uid: inactiveOwnerAdmin.id, token: {} },
      { uid: ownerAdmin.id, token: { automated: true } },
      { uid: ownerAdmin.id, token: { role: 'owner' } },
    ]) {
      db.resetCounters();
      const svc = new LibraryQuarantineBinarySafetyCaseService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => badCaller,
        },
        adminRepository: adminRepo,
        db,
      });
      const res = await svc.getQuarantineBinarySafetyCase({
        receiptId: seeded.receiptId,
      });
      assert.equal(res.ok, false);
      assert.equal(res.outcome, 'HOLD');
      assert.equal(db.pointGetCalls, 0);
    }
  }

  // =========================================================================
  // TEST 2: GET performs 7 point reads, 0 writes, returns sanitized PDF & DOCX
  // =========================================================================
  {
    const db = new InMemoryBinarySafetyFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const pdfChain = seedFullEligibleChain(db, 2, { format: 'PDF' });
    const docxChain = seedFullEligibleChain(db, 3, { format: 'DOCX' });

    const service = new LibraryQuarantineBinarySafetyCaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T09:00:00.000Z',
    });

    db.resetCounters();
    const pdfGet = await service.getQuarantineBinarySafetyCase({
      receiptId: pdfChain.receiptId,
    });
    assert.equal(pdfGet.ok, true);
    if (pdfGet.ok) {
      assert.equal(pdfGet.outcome, 'READY');
      assert.equal(pdfGet.sourceFormat, 'PDF');
      assert.equal(
        pdfGet.deepInspectionStatus,
        'PDF_REQUIRES_ISOLATED_PARSER'
      );
      assert.equal(pdfGet.currentRevision, 0);
      assert.equal(pdfGet.effectiveHumanCaseRevision, 2);
      assert.deepEqual(
        pdfGet.readiness,
        QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS
      );
      assertZeroSecretLeakage(pdfGet, pdfChain.sha256);
    }
    assert.equal(db.pointGetCalls, 7);
    assert.equal(db.transactionCount, 0);

    db.resetCounters();
    const docxGet = await service.getQuarantineBinarySafetyCase({
      receiptId: docxChain.receiptId,
    });
    assert.equal(docxGet.ok, true);
    if (docxGet.ok) {
      assert.equal(docxGet.sourceFormat, 'DOCX');
      assert.equal(
        docxGet.deepInspectionStatus,
        'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
      );
      assertZeroSecretLeakage(docxGet, docxChain.sha256);
    }
    assert.equal(db.pointGetCalls, 7);
  }

  // =========================================================================
  // TEST 3: SAVE performs 8 reads inside runTransaction before any write,
  //         2 writes (create/update + create event), zero tx.set, 0->1->2 CAS
  // =========================================================================
  {
    const db = new InMemoryBinarySafetyFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullEligibleChain(db, 4, { format: 'PDF' });

    let clockTick = '2026-11-10T09:10:00.000Z';
    const service = new LibraryQuarantineBinarySafetyCaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => clockTick,
    });

    // Revision 0 -> 1 (CREATED)
    db.resetCounters();
    const save1 = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 0,
      acknowledgedHumanCaseRevision: 2,
      input: {
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'TICKET-101',
        evidenceNotes: 'Referred to isolated PDF parser sandbox.',
        reviewNotes: 'Pending isolated parser report.',
      },
    });

    assert.equal(save1.ok, true, JSON.stringify(save1));
    if (save1.ok) {
      assert.equal(save1.outcome, 'SAVED');
      assert.equal(save1.caseSaveOutcome, 'CREATED');
      assert.equal(save1.currentRevision, 1);
      assert.equal(save1.binarySafetyCase.revision, 1);
      assert.equal(save1.binarySafetyCase.sourceFormat, 'PDF');
      assert.equal(
        save1.binarySafetyCase.catalogUpdatedAt,
        seeded.catalogDoc.updatedAt
      );
      assertZeroSecretLeakage(save1, seeded.sha256);
    }
    // Zero point reads outside transaction; all 8 reads inside transaction before 2 writes
    assert.equal(db.pointGetCalls, 0);
    assert.equal(db.transactionCount, 1);
    assert.equal(db.txGetCalls, 8);
    assert.equal(db.txCreateCalls, 2);
    assert.equal(db.txUpdateCalls, 0);
    assert.equal(db.txSetCalls, 0);

    const persisted1 = db.getRawDoc(
      LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
      seeded.receiptId
    );
    const checkedPersisted1 = validatePersistedLibraryQuarantineBinarySafetyCase(
      persisted1,
      seeded.receiptId
    );
    assert.equal(checkedPersisted1.ok, true);

    const eventId1 = deriveLibraryQuarantineBinarySafetyCaseEventId(
      seeded.receiptId,
      1
    );
    const event1 = db.getRawDoc(
      LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION,
      eventId1
    );
    const checkedEvent1 =
      validatePersistedLibraryQuarantineBinarySafetyCaseEvent(event1, eventId1);
    assert.equal(checkedEvent1.ok, true);

    // Revision 1 -> 2 (UPDATED via tx.update + tx.create)
    clockTick = '2026-11-10T09:20:00.000Z';
    db.resetCounters();
    const save2 = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      input: {
        disposition: 'EXTERNAL_REPORT_NOT_VERIFIED',
        evidenceReference: 'EXT-REP-202',
        evidenceNotes: 'External sandbox report logged without automated attestation.',
        reviewNotes: 'Keep quarantined; binary release remains blocked.',
      },
    });
    assert.equal(save2.ok, true);
    if (save2.ok) {
      assert.equal(save2.caseSaveOutcome, 'UPDATED');
      assert.equal(save2.currentRevision, 2);
      assert.equal(
        save2.binarySafetyCase.disposition,
        'EXTERNAL_REPORT_NOT_VERIFIED'
      );
    }
    assert.equal(db.pointGetCalls, 0);
    assert.equal(db.transactionCount, 1);
    assert.equal(db.txGetCalls, 8);
    assert.equal(db.txCreateCalls, 1);
    assert.equal(db.txUpdateCalls, 1);
    assert.equal(db.txSetCalls, 0);

    const eventId2 = deriveLibraryQuarantineBinarySafetyCaseEventId(
      seeded.receiptId,
      2
    );
    const event2 = db.getRawDoc(
      LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION,
      eventId2
    );
    assert.equal(
      validatePersistedLibraryQuarantineBinarySafetyCaseEvent(event2, eventId2)
        .ok,
      true
    );

    // Stale expectedRevision -> CONFLICT with 0 writes
    db.resetCounters();
    const conflictRes = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      input: {
        disposition: 'DO_NOT_PROCESS',
        reviewNotes: 'Attempt with stale revision.',
      },
    });
    assert.equal(conflictRes.ok, false);
    if (!conflictRes.ok && conflictRes.outcome === 'CONFLICT') {
      assert.equal(conflictRes.currentRevision, 2);
      assert.equal(conflictRes.currentBinarySafetyCase?.revision, 2);
    }
    assert.equal(db.txCreateCalls, 0);
    assert.equal(db.txUpdateCalls, 0);
  }

  // =========================================================================
  // TEST 4: Concurrent Drift Inside Transaction, Stale Evidence, Event Collision,
  //         and Corrupted Store -> HOLD with 0 writes
  // =========================================================================
  {
    const db = new InMemoryBinarySafetyFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullEligibleChain(db, 5, { format: 'DOCX' });

    const service = new LibraryQuarantineBinarySafetyCaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T09:30:00.000Z',
    });

    // Save initial v1 against human case v2
    const initialSave = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 0,
      acknowledgedHumanCaseRevision: 2,
      input: {
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'DOCX-REF-1',
        evidenceNotes: 'Initial DOCX inspection referral.',
        reviewNotes: 'Awaiting structural CDR.',
      },
    });
    assert.equal(initialSave.ok, true);

    // Simulate human review case advancing to v3 WITHOUT catalog alignment -> SOURCE_CASE_VERSION_DRIFT_HOLD
    db.seedDoc(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      seeded.receiptId,
      {
        ...seeded.reviewCase,
        revision: 3,
        updatedAt: '2026-11-10T09:25:00.000Z',
      }
    );
    db.resetCounters();
    const driftHold = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 1,
      acknowledgedHumanCaseRevision: 3,
      input: {
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'DOCX-REF-2',
        evidenceNotes: 'Updated notes.',
        reviewNotes: 'Updated review.',
      },
    });
    assert.equal(driftHold.ok, false);
    if (!driftHold.ok && driftHold.outcome === 'HOLD') {
      assert.equal(driftHold.errorCode, 'SOURCE_CASE_VERSION_DRIFT_HOLD');
    }
    assert.equal(db.txCreateCalls, 0);
    assert.equal(db.txUpdateCalls, 0);

    // Now align catalog draft to human case v3 -> existing safety case (v1 on case v2) becomes STALE
    const alignedDocUpdatedAt = '2026-11-10T09:26:00.000Z';
    seedFullEligibleChain(db, 5, {
      format: 'DOCX',
      caseRevision: 3,
      caseUpdatedAt: '2026-11-10T09:25:00.000Z',
      handoffCaseRevision: 2,
      handoffCaseUpdatedAt: '2026-11-10T08:20:00.000Z',
      documentUpdatedAt: alignedDocUpdatedAt,
      includeAlignment: true,
      alignedHumanCaseRevision: 3,
      alignedHumanCaseUpdatedAt: '2026-11-10T09:25:00.000Z',
    });

    const getStale = await service.getQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
    });
    assert.equal(getStale.ok, true);
    if (getStale.ok) {
      assert.equal(getStale.isCaseCurrent, false);
      assert.equal(getStale.requiresFreshEvidence, true);
      assert.equal(getStale.effectiveHumanCaseRevision, 3);
      assert.equal(getStale.catalogUpdatedAt, alignedDocUpdatedAt);
    }

    // Attempting to save with unacknowledged/old human case revision (2 instead of 3) -> HOLD
    db.resetCounters();
    const unackHold = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      input: {
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'DOCX-REF-NEW',
        evidenceNotes: 'Fresh DOCX inspection referral.',
        reviewNotes: 'Fresh review notes.',
      },
    });
    assert.equal(unackHold.ok, false);
    if (!unackHold.ok && unackHold.outcome === 'HOLD') {
      assert.equal(unackHold.errorCode, 'UNACKNOWLEDGED_CASE_REVISION_HOLD');
    }
    assert.equal(db.txCreateCalls, 0);
    assert.equal(db.txUpdateCalls, 0);

    // Attempting to reuse verbatim stale evidence when requiresFreshEvidence is true -> HOLD
    db.resetCounters();
    const verbatimStaleHold = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 1,
      acknowledgedHumanCaseRevision: 3,
      input: {
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'DOCX-REF-1',
        evidenceNotes: 'Initial DOCX inspection referral.',
        reviewNotes: 'Awaiting structural CDR.',
      },
    });
    assert.equal(verbatimStaleHold.ok, false);
    if (!verbatimStaleHold.ok && verbatimStaleHold.outcome === 'HOLD') {
      assert.equal(verbatimStaleHold.errorCode, 'STALE_BINARY_SAFETY_EVIDENCE_HOLD');
    }
    assert.equal(db.txCreateCalls, 0);
    assert.equal(db.txUpdateCalls, 0);

    // Event slot collision (<receiptId>_2 already occupied) -> AUDIT_EVENT_ALREADY_EXISTS HOLD
    const eventId2 = deriveLibraryQuarantineBinarySafetyCaseEventId(
      seeded.receiptId,
      2
    );
    db.seedDoc(
      LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION,
      eventId2,
      { occupied: true }
    );
    db.resetCounters();
    const collisionHold = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 1,
      acknowledgedHumanCaseRevision: 3,
      input: {
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'DOCX-REF-FRESH',
        evidenceNotes: 'Fresh DOCX inspection referral for case v3.',
        reviewNotes: 'Fresh review notes for case v3.',
      },
    });
    assert.equal(collisionHold.ok, false);
    if (!collisionHold.ok && collisionHold.outcome === 'HOLD') {
      assert.equal(collisionHold.errorCode, 'AUDIT_EVENT_ALREADY_EXISTS');
    }
  }

  // =========================================================================
  // TEST 5: UNKNOWN after staging writes (including multi-attempt retry where
  //         attempt 1 stages writes and throws, attempt 2 aborts pre-write)
  // =========================================================================
  {
    const db = new InMemoryBinarySafetyFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullEligibleChain(db, 6, { format: 'PDF' });

    const service = new LibraryQuarantineBinarySafetyCaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T10:00:00.000Z',
    });

    db.maxRetryAttempts = 2;
    db.onAfterTransactionWritesStagedHook = (attempt) => {
      if (attempt === 1) {
        // Attempt 1 stages writes, then mutates case to cause pre-write abort on Attempt 2
        db.seedDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
          seeded.receiptId,
          {
            ...seeded.reviewCase,
            status: 'IN_REVIEW',
          }
        );
        const retryErr = new Error('Transient commit acknowledgement failure') as Error & {
          retryable?: boolean;
        };
        retryErr.retryable = true;
        throw retryErr;
      }
    };

    const unknownRes = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 0,
      acknowledgedHumanCaseRevision: 2,
      input: {
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'TICKET-600',
        evidenceNotes: 'Testing multi-attempt retry commit uncertainty.',
        reviewNotes: 'Must return UNKNOWN, never HOLD.',
      },
    });

    assert.equal(unknownRes.ok, false);
    assert.equal(unknownRes.outcome, 'UNKNOWN');
    if (!unknownRes.ok && unknownRes.outcome === 'UNKNOWN') {
      assert.equal(unknownRes.caseSaved, null);
      assert.equal(unknownRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
    }
    assert.equal(db.transactionCount, 2);
  }

  // =========================================================================
  // TEST 6: Zero mutation to qcat-<receiptId>, receipt, or public visibility
  // =========================================================================
  {
    const db = new InMemoryBinarySafetyFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullEligibleChain(db, 7, { format: 'PDF' });

    const beforeDoc = db.getRawDoc(
      LIBRARY_DOCUMENTS_COLLECTION,
      seeded.documentId
    );
    const beforeReceipt = db.getRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      seeded.receiptId
    );

    const store = new FirestoreLibraryQuarantineBinarySafetyCaseStore(db);
    const service = new LibraryQuarantineBinarySafetyCaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      safetyCaseStore: store,
      clock: () => '2026-11-10T10:15:00.000Z',
    });

    const saveRes = await service.saveQuarantineBinarySafetyCase({
      receiptId: seeded.receiptId,
      expectedRevision: 0,
      acknowledgedHumanCaseRevision: 2,
      input: {
        disposition: 'DO_NOT_PROCESS',
        evidenceReference: 'SEC-HOLD-707',
        evidenceNotes: 'High-risk embedded stream flagged externally.',
        reviewNotes: 'Do not process or release binary file.',
      },
    });
    assert.equal(saveRes.ok, true);

    const afterDoc = db.getRawDoc(
      LIBRARY_DOCUMENTS_COLLECTION,
      seeded.documentId
    );
    const afterReceipt = db.getRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      seeded.receiptId
    );
    assert.deepEqual(afterDoc, beforeDoc);
    assert.deepEqual(afterReceipt, beforeReceipt);

    // PublicLibraryRepository must never expose Draft qcat-<receiptId> documents
    const publicRepo = new PublicLibraryRepository({
      getById: async (id: string) =>
        (db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, id) as unknown as LibraryDocument) ??
        null,
      listAll: async () => [
        db.getRawDoc(
          LIBRARY_DOCUMENTS_COLLECTION,
          seeded.documentId
        ) as unknown as LibraryDocument,
      ],
      create: async (doc: LibraryDocument) => doc,
      update: async (doc: LibraryDocument) => doc,
      delete: async () => undefined,
    } as any);

    const publicList = await publicRepo.listPublicDocuments();
    assert.equal(publicList.length, 0);

    // Input validator unit checks
    assert.equal(
      validateSaveLibraryQuarantineBinarySafetyCaseInput({
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: '',
        evidenceNotes: '',
        reviewNotes: '',
      }).ok,
      false
    );
    assert.equal(
      validateSaveLibraryQuarantineBinarySafetyCaseInput({
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'https://evil.example/payload.pdf',
        evidenceNotes: 'Note',
      }).ok,
      false
    );
  }

  console.log('ALL LIB-FILE-BINARY-SAFETY-CASE-R1 BACKEND TESTS PASSED (6/6).');
}

runTests().catch((err) => {
  console.error('Backend tests failed:', err);
  process.exit(1);
});
