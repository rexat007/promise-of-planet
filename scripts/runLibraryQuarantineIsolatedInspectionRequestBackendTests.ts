import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
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
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
  type LibraryQuarantineBinarySafetyDisposition,
  type LibraryQuarantinePersistedBinarySafetyCase,
} from '../functions/src/library/libraryQuarantineBinarySafetyCaseContract';
import { LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION } from '../functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore';
import {
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
  QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  parseLibraryQuarantineIsolatedInspectionRequestId,
  validatePersistedLibraryQuarantineIsolatedInspectionRequest,
} from '../functions/src/library/libraryQuarantineIsolatedInspectionRequestContract';
import {
  FirestoreLibraryQuarantineIsolatedInspectionRequestStore,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineIsolatedInspectionRequestStore';
import {
  LibraryQuarantineIsolatedInspectionRequestService,
  isAuthorizedHumanIsolatedInspectionOwner,
} from '../functions/src/library/libraryQuarantineIsolatedInspectionRequestService';

const require = createRequire(import.meta.url);
const {
  LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR,
  LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR,
  LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR,
  LIBRARY_ISOLATED_INSPECTION_REQUEST_RELEASE_ENV_VAR,
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

class InMemoryIsolatedInspectionFirestoreDatabase
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
          _data: Record<string, unknown>
        ): void => {
          const colName = resolveColName(ref);
          this.txUpdateCalls += 1;
          this.txOps.push({
            kind: 'update',
            collectionName: colName,
            docId: ref.id,
          });
          throw new Error('UNSAFE_TX_UPDATE_FORBIDDEN');
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
        if (
          attempt < maxAttempts &&
          (err as { retryable?: boolean })?.retryable
        ) {
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

function seedFullSevenDocChain(
  db: InMemoryIsolatedInspectionFirestoreDatabase,
  index: number,
  overrides: {
    readonly format?: 'PDF' | 'DOCX';
    readonly receiptState?: LibraryQuarantineReceiptState;
    readonly receiptRevision?: number;
    readonly receiptGeneration?: string | null;
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
    readonly includeSafetyCase?: boolean;
    readonly safetyCaseRevision?: number;
    readonly safetyCaseDisposition?: LibraryQuarantineBinarySafetyDisposition;
    readonly safetyCaseEffectiveHumanCaseRevision?: number;
    readonly safetyCaseEffectiveHumanCaseUpdatedAt?: string;
    readonly safetyCaseCatalogUpdatedAt?: string;
    readonly safetyCaseUpdatedAt?: string;
  } = {}
) {
  const receiptId = buildHexReceiptId(index);
  const documentId = deriveQuarantineCatalogDocumentId(receiptId);
  const sha256 = createHash('sha256')
    .update(Buffer.from(`Isolated Inspection Test Payload #${index}`, 'utf8'))
    .digest('hex');

  const format = overrides.format ?? 'PDF';
  const canonicalExtension =
    format === 'PDF' ? ('pdf' as const) : ('docx' as const);
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
  const generation =
    overrides.receiptGeneration !== undefined
      ? overrides.receiptGeneration
      : isQuarantined
      ? `173130000000${index}`
      : null;

  const receipt: LibraryQuarantineInternalReceipt = Object.freeze({
    receiptId,
    uploaderUid: 'admin_curator_01',
    originalFilename: `coastal-assessment-${index}.${canonicalExtension}`,
    sanitizedFilename: `coastal-assessment-${index}.${canonicalExtension}`,
    format,
    canonicalExtension,
    canonicalMimeType,
    byteSize: 32768 + index,
    sha256,
    deepInspectionStatus,
    storagePath: `library/quarantine/${receiptId}/source.${canonicalExtension}`,
    state: receiptState,
    generation,
    reconciliationReason:
      receiptState === LibraryQuarantineReceiptState.NeedsReconciliation
        ? 'GCS conditional write outcome was ambiguous.'
        : null,
    rejectionReasonCode:
      receiptState === LibraryQuarantineReceiptState.Rejected
        ? 'PDF_ACTIVE_CONTENT_DETECTED'
        : null,
    createdAt: '2026-11-11T08:00:00.000Z',
    updatedAt: '2026-11-11T08:05:00.000Z',
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
    createdAt: '2026-11-11T08:10:00.000Z',
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

  const caseRevision = overrides.caseRevision ?? 2;
  const caseUpdatedAt = overrides.caseUpdatedAt ?? '2026-11-11T08:20:00.000Z';
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
    createdAt: '2026-11-11T08:15:00.000Z',
    updatedBy: 'admin_curator_01',
    updatedAt: caseUpdatedAt,
  });

  const handoffCaseRevision = overrides.handoffCaseRevision ?? caseRevision;
  const handoffCaseUpdatedAt =
    overrides.handoffCaseUpdatedAt ?? caseUpdatedAt;
  const handoffCreatedAt = '2026-11-11T08:30:00.000Z';

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

  const effectiveCaseRev = overrides.includeAlignment
    ? overrides.alignedHumanCaseRevision ?? caseRevision
    : handoffCaseRevision;
  const effectiveCaseUpdatedAt = overrides.includeAlignment
    ? overrides.alignedHumanCaseUpdatedAt ?? caseUpdatedAt
    : handoffCaseUpdatedAt;

  if (overrides.includeAlignment) {
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
        alignedHumanCaseRevision: effectiveCaseRev,
        alignedHumanCaseUpdatedAt: effectiveCaseUpdatedAt,
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

  const includeSafetyCase = overrides.includeSafetyCase ?? true;
  let safetyCase: LibraryQuarantinePersistedBinarySafetyCase | null = null;

  if (includeSafetyCase) {
    const safetyRev = overrides.safetyCaseRevision ?? 1;
    const safetyCreatedAt = '2026-11-11T08:40:00.000Z';
    const safetyUpdatedAt =
      overrides.safetyCaseUpdatedAt ??
      (safetyRev === 1 ? safetyCreatedAt : '2026-11-11T08:45:00.000Z');

    safetyCase = Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
      receiptId,
      documentId,
      revision: safetyRev,
      sourceRevision: receiptRevision,
      sourceUpdatedAt: receipt.updatedAt,
      sourceSha256: sha256,
      sourceFormat: format,
      deepInspectionStatus,
      effectiveHumanCaseRevision:
        overrides.safetyCaseEffectiveHumanCaseRevision ?? effectiveCaseRev,
      effectiveHumanCaseUpdatedAt:
        overrides.safetyCaseEffectiveHumanCaseUpdatedAt ??
        effectiveCaseUpdatedAt,
      catalogUpdatedAt: overrides.safetyCaseCatalogUpdatedAt ?? docUpdatedAt,
      disposition:
        overrides.safetyCaseDisposition ?? 'ISOLATED_ASSESSMENT_REQUIRED',
      evidenceReference: `TICKET-ISO-${index}`,
      evidenceNotes: 'Referred to isolated inspection queue.',
      reviewNotes: 'Pending isolated parser execution.',
      createdBy: 'owner_01',
      createdAt: safetyCreatedAt,
      updatedBy: 'owner_01',
      updatedAt: safetyUpdatedAt,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });

    db.seedDoc(
      LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
      receiptId,
      safetyCase
    );
  }

  return {
    receiptId,
    documentId,
    sha256,
    generation,
    receipt,
    envelope,
    draft,
    reviewCase,
    handoff,
    catalogDoc,
    safetyCase,
  };
}

function assertZeroSecretLeakage(
  dto: unknown,
  secretSha256: string,
  secretGeneration: string | null
): void {
  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes(secretSha256), false);
  if (secretGeneration) {
    assert.equal(serialized.includes(secretGeneration), false);
  }
  for (const forbidden of [
    'sourceSha256',
    'sourceGeneration',
    'sourceByteSize',
    'requestedBy',
    'createdBy',
    'updatedBy',
    'storagePath',
    'generation',
    'byteSize',
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

const READ_ONLY_MANIFEST_EXPECTED_BLOBS: ReadonlyArray<
  readonly [string, string]
> = Object.freeze([
  [
    'functions/src/library/libraryQuarantineBinarySafetyCaseContract.ts',
    'f1fdeb09b2b98baa98ea636d58552c59bf81ea72',
  ],
  [
    'functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore.ts',
    'd790b208205ca96a00ec3a021125ae9297c6b2b0',
  ],
  [
    'functions/src/library/libraryQuarantineBinarySafetyCaseService.ts',
    'ea8bc12a224d8ec3b9810d8923b1597f53c8d17a',
  ],
  [
    'src/services/libraryQuarantineBinarySafetyCaseClient.ts',
    '397c97ca61fa6d7eaddec2b4842882a1f41cd4cc',
  ],
  [
    'functions/src/library/libraryQuarantineReceiptContract.ts',
    '4b4d5f32e5903def3a3b0dcdecd45e38083f91bb',
  ],
  [
    'functions/src/library/firestoreLibraryQuarantineReceiptStore.ts',
    'd9f4114222851c62c25574efbb0ffbeeb5c355e2',
  ],
  [
    'functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts',
    '5709952519564cb118443fd6dd59ec9cff249bb1',
  ],
  [
    'functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts',
    'cb679848608d7000b564ad3863ee23f7c888b970',
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
    'functions/src/library/libraryQuarantineCatalogHandoffService.ts',
    '79e80cb3b9917ea9c0d3e15e23d5452235751b59',
  ],
  [
    'functions/src/library/libraryQuarantineCatalogCaseAlignmentService.ts',
    'bfce0d697eb6b433ec109f3be4a92be274f82062',
  ],
  [
    'functions/src/library/libraryQuarantineRightsDecisionService.ts',
    '61f6b32dd565c5ccf7d489cde5551675647c50a6',
  ],
  [
    'functions/src/library/publicLibraryRepository.ts',
    'c813162307663b6fe37dc84cba9c591193f34f33',
  ],
  [
    'functions/src/shared/libraryContract.ts',
    'cfb0849c0418ba7b075f7de49c3debe668adc724',
  ],
  [
    'functions/src/shared/workflowContract.ts',
    'f4eabd5c862c90586609f545d8cb9e19867d1ade',
  ],
  [
    'functions/src/types/admin.ts',
    '8064d1393b6e519f9df4be13ad35ece6d07907c0',
  ],
  ['src/types/admin.ts', '226e5fa017f1123181deb8bee259cb294adb8683'],
]);

async function runTests(): Promise<void> {
  console.log(
    'STARTING LIB-FILE-ISOLATED-INSPECTION-REQUEST-01 BACKEND TESTS...'
  );

  // =========================================================================
  // TEST 1: 5-Flag Release Gate OFF -> 0 AdminRepo & 0 Firestore reads; RBAC
  // =========================================================================
  {
    const db = new InMemoryIsolatedInspectionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([
      ownerAdmin,
      inactiveOwnerAdmin,
      curatorAdmin,
      rightsReviewerAdmin,
      aiAssistantAdmin,
    ]);
    const seeded = seedFullSevenDocChain(db, 1);

    assert.equal(
      LIBRARY_ISOLATED_INSPECTION_REQUEST_RELEASE_ENV_VAR,
      'POP_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED'
    );

    // Enable first 4 gates, leave 5th gate OFF -> must fail closed with ISOLATED_INSPECTION_REQUEST_NOT_RELEASED
    process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR] = 'true';
    process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR] = 'true';
    process.env[LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR] = 'true';
    process.env[LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR] = 'true';
    delete process.env[LIBRARY_ISOLATED_INSPECTION_REQUEST_RELEASE_ENV_VAR];

    for (const action of [
      'getQuarantineIsolatedInspectionRequest',
      'recordQuarantineIsolatedInspectionRequest',
    ] as const) {
      await assert.rejects(
        async () => {
          await executeManageLibraryDocumentsRequest(
            {
              auth: { uid: ownerAdmin.id, token: {} },
              data: {
                action,
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
          assert.equal(
            typeof err.message === 'string' &&
              err.message.includes('ISOLATED_INSPECTION_REQUEST_NOT_RELEASED'),
            true
          );
          return true;
        }
      );
    }
    assert.equal(adminRepo.getAdminCalls, 0);
    assert.equal(db.pointGetCalls, 0);
    assert.equal(db.transactionCount, 0);

    delete process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR];
    delete process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR];
    delete process.env[LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR];
    delete process.env[LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR];

    // RBAC helper verification: only active Owner with Review passes
    assert.equal(isAuthorizedHumanIsolatedInspectionOwner(ownerAdmin), true);
    assert.equal(
      isAuthorizedHumanIsolatedInspectionOwner(inactiveOwnerAdmin),
      false
    );
    assert.equal(isAuthorizedHumanIsolatedInspectionOwner(curatorAdmin), false);
    assert.equal(
      isAuthorizedHumanIsolatedInspectionOwner(rightsReviewerAdmin),
      false
    );
    assert.equal(
      isAuthorizedHumanIsolatedInspectionOwner(aiAssistantAdmin),
      false
    );
    assert.equal(
      isAuthorizedHumanIsolatedInspectionOwner({
        ...ownerAdmin,
        permissions: [AdminPermission.View],
      } as AdminUser),
      false
    );

    // Non-owner, inactive owner, and token spoof / AI claim rejected with 0 Firestore reads
    for (const badCaller of [
      { uid: curatorAdmin.id, token: {} },
      { uid: rightsReviewerAdmin.id, token: {} },
      { uid: inactiveOwnerAdmin.id, token: {} },
      { uid: aiAssistantAdmin.id, token: {} },
      { uid: ownerAdmin.id, token: { automated: true } },
      { uid: ownerAdmin.id, token: { role: 'owner' } },
      { uid: ownerAdmin.id, token: { dispatched: true } },
    ]) {
      db.resetCounters();
      const svc = new LibraryQuarantineIsolatedInspectionRequestService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => badCaller,
        },
        adminRepository: adminRepo,
        db,
      });
      const getRes = await svc.getQuarantineIsolatedInspectionRequest({
        receiptId: seeded.receiptId,
      });
      assert.equal(getRes.ok, false);
      assert.equal(getRes.outcome, 'HOLD');
      assert.equal(db.pointGetCalls, 0);

      const recRes = await svc.recordQuarantineIsolatedInspectionRequest({
        receiptId: seeded.receiptId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation:
          LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
      });
      assert.equal(recRes.ok, false);
      assert.equal(recRes.outcome, 'HOLD');
      assert.equal(db.pointGetCalls, 0);
      assert.equal(db.transactionCount, 0);
    }
  }

  // =========================================================================
  // TEST 2: GET performs 8 point reads, 0 writes, returns NOT_RECORDED for
  //         eligible PDF & DOCX chains with zero secret leakage
  // =========================================================================
  {
    const db = new InMemoryIsolatedInspectionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const pdfChain = seedFullSevenDocChain(db, 2, { format: 'PDF' });
    const docxChain = seedFullSevenDocChain(db, 3, { format: 'DOCX' });

    const service = new LibraryQuarantineIsolatedInspectionRequestService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-11T09:00:00.000Z',
    });

    db.resetCounters();
    const pdfGet = await service.getQuarantineIsolatedInspectionRequest({
      receiptId: pdfChain.receiptId,
    });
    assert.equal(pdfGet.ok, true, JSON.stringify(pdfGet));
    if (pdfGet.ok) {
      assert.equal(pdfGet.status, 'NOT_RECORDED');
      assert.equal(pdfGet.outcome, 'NOT_RECORDED');
      assert.equal(
        pdfGet.requestId,
        `${pdfChain.receiptId}_${pdfChain.envelope.revision}_1`
      );
      assert.equal(pdfGet.sourceFormat, 'PDF');
      assert.equal(
        pdfGet.deepInspectionStatus,
        'PDF_REQUIRES_ISOLATED_PARSER'
      );
      assert.equal(pdfGet.safetyCaseRevision, 1);
      assert.equal(pdfGet.effectiveHumanCaseRevision, 2);
      assert.equal(pdfGet.inspectionRequest, null);
      assert.equal(pdfGet.dispatched, false);
      assert.equal(pdfGet.scanPerformed, false);
      assert.equal(pdfGet.sanitized, false);
      assert.deepEqual(
        pdfGet.readiness,
        QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS
      );
      assertZeroSecretLeakage(pdfGet, pdfChain.sha256, pdfChain.generation);
    }
    assert.equal(db.pointGetCalls, 8);
    assert.equal(db.transactionCount, 0);

    db.resetCounters();
    const docxGet = await service.getQuarantineIsolatedInspectionRequest({
      receiptId: docxChain.receiptId,
    });
    assert.equal(docxGet.ok, true);
    if (docxGet.ok) {
      assert.equal(docxGet.status, 'NOT_RECORDED');
      assert.equal(docxGet.sourceFormat, 'DOCX');
      assert.equal(
        docxGet.deepInspectionStatus,
        'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
      );
      assertZeroSecretLeakage(docxGet, docxChain.sha256, docxChain.generation);
    }
    assert.equal(db.pointGetCalls, 8);
    assert.equal(db.transactionCount, 0);
  }

  // =========================================================================
  // TEST 3: RECORD performs 8 tx.get reads inside runTransaction strictly
  //         before 1 tx.create write (RECORDED); second identical call returns
  //         ALREADY_RECORDED with 8 tx.get reads and 0 writes (true idempotency)
  // =========================================================================
  {
    const db = new InMemoryIsolatedInspectionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullSevenDocChain(db, 4, { format: 'PDF' });

    const service = new LibraryQuarantineIsolatedInspectionRequestService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-11T09:15:00.000Z',
    });

    // First RECORD -> RECORDED (8 tx.get + 1 tx.create)
    db.resetCounters();
    const rec1 = await service.recordQuarantineIsolatedInspectionRequest({
      receiptId: seeded.receiptId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
    });

    assert.equal(rec1.ok, true, JSON.stringify(rec1));
    if (rec1.ok) {
      assert.equal(rec1.status, 'RECORDED');
      assert.equal(rec1.outcome, 'RECORDED');
      assert.equal(rec1.requestOutcome, 'RECORDED');
      assert.equal(rec1.requestRecorded, true);
      assert.equal(
        rec1.requestId,
        deriveLibraryQuarantineIsolatedInspectionRequestId(
          seeded.receiptId,
          2,
          1
        )
      );
      assert.equal(
        rec1.inspectionRequest.state,
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE
      );
      assert.equal(rec1.inspectionRequest.dispatched, false);
      assert.equal(rec1.inspectionRequest.scanPerformed, false);
      assert.equal(rec1.inspectionRequest.sanitized, false);
      assertZeroSecretLeakage(rec1, seeded.sha256, seeded.generation);
    }

    assert.equal(db.pointGetCalls, 0);
    assert.equal(db.transactionCount, 1);
    assert.equal(db.txGetCalls, 8);
    assert.equal(db.txCreateCalls, 1);
    assert.equal(db.txUpdateCalls, 0);
    assert.equal(db.txSetCalls, 0);

    // Verify persisted 23-field closed schema in Firestore
    const expectedRequestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
      seeded.receiptId,
      2,
      1
    );
    const rawPersisted = db.getRawDoc(
      LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
      expectedRequestId
    );
    const validatedPersisted =
      validatePersistedLibraryQuarantineIsolatedInspectionRequest(
        rawPersisted,
        expectedRequestId
      );
    assert.equal(validatedPersisted.ok, true);
    if (validatedPersisted.ok) {
      assert.equal(
        validatedPersisted.value.schemaVersion,
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION
      );
      assert.equal(validatedPersisted.value.sourceSha256, seeded.sha256);
      assert.equal(
        validatedPersisted.value.sourceGeneration,
        seeded.generation
      );
      assert.equal(
        validatedPersisted.value.sourceByteSize,
        seeded.receipt.byteSize
      );
      assert.equal(validatedPersisted.value.requestedBy, ownerAdmin.id);
    }

    // Second identical RECORD -> ALREADY_RECORDED with 8 tx.get and 0 writes
    db.resetCounters();
    const rec2 = await service.recordQuarantineIsolatedInspectionRequest({
      receiptId: seeded.receiptId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
    });
    assert.equal(rec2.ok, true, JSON.stringify(rec2));
    if (rec2.ok) {
      assert.equal(rec2.status, 'ALREADY_RECORDED');
      assert.equal(rec2.outcome, 'ALREADY_RECORDED');
      assert.equal(rec2.requestOutcome, 'ALREADY_RECORDED');
      assert.equal(rec2.requestRecorded, true);
      assert.equal(rec2.requestId, expectedRequestId);
      assertZeroSecretLeakage(rec2, seeded.sha256, seeded.generation);
    }
    assert.equal(db.pointGetCalls, 0);
    assert.equal(db.transactionCount, 1);
    assert.equal(db.txGetCalls, 8);
    assert.equal(db.txCreateCalls, 0);
    assert.equal(db.txUpdateCalls, 0);
    assert.equal(db.txSetCalls, 0);

    // Subsequent GET -> RECORDED (8 point reads, 0 writes)
    db.resetCounters();
    const getAfterRecord = await service.getQuarantineIsolatedInspectionRequest({
      receiptId: seeded.receiptId,
    });
    assert.equal(getAfterRecord.ok, true);
    if (getAfterRecord.ok) {
      assert.equal(getAfterRecord.status, 'RECORDED');
      assert.equal(
        getAfterRecord.inspectionRequest?.requestId,
        expectedRequestId
      );
      assertZeroSecretLeakage(
        getAfterRecord,
        seeded.sha256,
        seeded.generation
      );
    }
    assert.equal(db.pointGetCalls, 8);
    assert.equal(db.transactionCount, 0);
  }

  // =========================================================================
  // TEST 4: Eligibility & Provenance Holds, CAS Conflict, Corrupted Store
  // =========================================================================
  {
    const db = new InMemoryIsolatedInspectionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);

    const service = new LibraryQuarantineIsolatedInspectionRequestService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-11T09:30:00.000Z',
    });

    // 4a. Missing Binary Safety Case -> BINARY_SAFETY_CASE_NOT_FOUND_HOLD (0 writes)
    const noSafetyChain = seedFullSevenDocChain(db, 5, {
      includeSafetyCase: false,
    });
    db.resetCounters();
    const noSafetyRes = await service.recordQuarantineIsolatedInspectionRequest({
      receiptId: noSafetyChain.receiptId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
    });
    assert.equal(noSafetyRes.ok, false);
    if (!noSafetyRes.ok && noSafetyRes.outcome === 'HOLD') {
      assert.equal(
        noSafetyRes.errorCode,
        'BINARY_SAFETY_CASE_NOT_FOUND_HOLD'
      );
    }
    assert.equal(db.txCreateCalls, 0);

    // 4b. Non-eligible dispositions (EXTERNAL_REPORT_NOT_VERIFIED, DO_NOT_PROCESS) -> HOLD
    for (const [idx, disp] of [
      [6, 'EXTERNAL_REPORT_NOT_VERIFIED'],
      [7, 'DO_NOT_PROCESS'],
    ] as const) {
      const ineligibleChain = seedFullSevenDocChain(db, idx, {
        safetyCaseDisposition: disp,
      });
      db.resetCounters();
      const res = await service.recordQuarantineIsolatedInspectionRequest({
        receiptId: ineligibleChain.receiptId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation:
          LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
      });
      assert.equal(res.ok, false);
      if (!res.ok && res.outcome === 'HOLD') {
        assert.equal(
          res.errorCode,
          'BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD'
        );
      }
      assert.equal(db.txCreateCalls, 0);
    }

    // 4c. Stale safety case after human case + alignment advances to v3 -> STALE_BINARY_SAFETY_CASE_HOLD
    const staleSafetyChain = seedFullSevenDocChain(db, 8, {
      caseRevision: 3,
      caseUpdatedAt: '2026-11-11T09:20:00.000Z',
      handoffCaseRevision: 2,
      handoffCaseUpdatedAt: '2026-11-11T08:20:00.000Z',
      documentUpdatedAt: '2026-11-11T09:22:00.000Z',
      includeAlignment: true,
      alignedHumanCaseRevision: 3,
      alignedHumanCaseUpdatedAt: '2026-11-11T09:20:00.000Z',
      safetyCaseRevision: 1,
      safetyCaseEffectiveHumanCaseRevision: 2,
      safetyCaseEffectiveHumanCaseUpdatedAt: '2026-11-11T08:20:00.000Z',
      safetyCaseCatalogUpdatedAt: '2026-11-11T08:30:00.000Z',
    });
    db.resetCounters();
    const staleSafetyRes =
      await service.recordQuarantineIsolatedInspectionRequest({
        receiptId: staleSafetyChain.receiptId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 3,
        confirmation:
          LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
      });
    assert.equal(staleSafetyRes.ok, false);
    if (!staleSafetyRes.ok && staleSafetyRes.outcome === 'HOLD') {
      assert.equal(
        staleSafetyRes.errorCode,
        'STALE_BINARY_SAFETY_CASE_HOLD'
      );
    }
    assert.equal(db.txCreateCalls, 0);

    // 4d. CAS conflict on expectedSafetyCaseRevision -> CONFLICT (0 writes)
    const v2SafetyChain = seedFullSevenDocChain(db, 9, {
      safetyCaseRevision: 2,
    });
    db.resetCounters();
    const conflictRes = await service.recordQuarantineIsolatedInspectionRequest(
      {
        receiptId: v2SafetyChain.receiptId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation:
          LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
      }
    );
    assert.equal(conflictRes.ok, false);
    if (!conflictRes.ok && conflictRes.outcome === 'CONFLICT') {
      assert.equal(conflictRes.errorCode, 'SAFETY_CASE_REVISION_CONFLICT');
      assert.equal(conflictRes.currentSafetyCaseRevision, 2);
      assert.equal(conflictRes.currentEffectiveHumanCaseRevision, 2);
    }
    assert.equal(db.txCreateCalls, 0);

    // 4e. Unacknowledged human case revision -> UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD (0 writes)
    db.resetCounters();
    const unackRes = await service.recordQuarantineIsolatedInspectionRequest({
      receiptId: v2SafetyChain.receiptId,
      expectedSafetyCaseRevision: 2,
      acknowledgedHumanCaseRevision: 1,
      confirmation:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
    });
    assert.equal(unackRes.ok, false);
    if (!unackRes.ok && unackRes.outcome === 'HOLD') {
      assert.equal(
        unackRes.errorCode,
        'UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD'
      );
    }
    assert.equal(db.txCreateCalls, 0);

    // 4f. Corrupted existing inspection request at slot -> CORRUPTED_EXISTING_INSPECTION_REQUEST HOLD
    const corruptedSlotId = deriveLibraryQuarantineIsolatedInspectionRequestId(
      v2SafetyChain.receiptId,
      2,
      2
    );
    db.seedDoc(
      LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
      corruptedSlotId,
      { corrupted: true }
    );
    db.resetCounters();
    const corruptedGet = await service.getQuarantineIsolatedInspectionRequest({
      receiptId: v2SafetyChain.receiptId,
    });
    assert.equal(corruptedGet.ok, false);
    if (!corruptedGet.ok) {
      assert.equal(
        corruptedGet.errorCode,
        'CORRUPTED_EXISTING_INSPECTION_REQUEST'
      );
    }
  }

  // =========================================================================
  // TEST 5: UNKNOWN after staging tx.create (multi-attempt retry where
  //         attempt 1 stages tx.create and throws, attempt 2 aborts pre-write)
  // =========================================================================
  {
    const db = new InMemoryIsolatedInspectionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullSevenDocChain(db, 10, { format: 'PDF' });

    const service = new LibraryQuarantineIsolatedInspectionRequestService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-11T10:00:00.000Z',
    });

    db.maxRetryAttempts = 2;
    db.onAfterTransactionWritesStagedHook = (attempt) => {
      if (attempt === 1) {
        // Attempt 1 stages tx.create, then mutates case to cause pre-write abort on Attempt 2
        db.seedDoc(
          LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
          seeded.receiptId,
          {
            ...seeded.reviewCase,
            status: 'IN_REVIEW',
          }
        );
        const retryErr = new Error(
          'Transient commit acknowledgement failure'
        ) as Error & {
          retryable?: boolean;
        };
        retryErr.retryable = true;
        throw retryErr;
      }
    };

    const unknownRes = await service.recordQuarantineIsolatedInspectionRequest({
      receiptId: seeded.receiptId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
    });

    assert.equal(unknownRes.ok, false);
    assert.equal(unknownRes.outcome, 'UNKNOWN');
    if (!unknownRes.ok && unknownRes.outcome === 'UNKNOWN') {
      assert.equal(unknownRes.requestRecorded, null);
      assert.equal(unknownRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
    }
    assert.equal(db.transactionCount, 2);
  }

  // =========================================================================
  // TEST 6: Zero mutation to qcat-<receiptId>, receipt, safety case, or public
  //         visibility + Read-Only Manifest SHA-1 Verification
  // =========================================================================
  {
    const db = new InMemoryIsolatedInspectionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullSevenDocChain(db, 11, { format: 'DOCX' });

    const beforeDoc = db.getRawDoc(
      LIBRARY_DOCUMENTS_COLLECTION,
      seeded.documentId
    );
    const beforeReceipt = db.getRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      seeded.receiptId
    );
    const beforeSafetyCase = db.getRawDoc(
      LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
      seeded.receiptId
    );

    const store = new FirestoreLibraryQuarantineIsolatedInspectionRequestStore(
      db
    );
    const service = new LibraryQuarantineIsolatedInspectionRequestService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      inspectionRequestStore: store,
      clock: () => '2026-11-11T10:15:00.000Z',
    });

    const recordRes = await service.recordQuarantineIsolatedInspectionRequest({
      receiptId: seeded.receiptId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
    });
    assert.equal(recordRes.ok, true);

    const afterDoc = db.getRawDoc(
      LIBRARY_DOCUMENTS_COLLECTION,
      seeded.documentId
    );
    const afterReceipt = db.getRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      seeded.receiptId
    );
    const afterSafetyCase = db.getRawDoc(
      LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
      seeded.receiptId
    );
    assert.deepEqual(afterDoc, beforeDoc);
    assert.deepEqual(afterReceipt, beforeReceipt);
    assert.deepEqual(afterSafetyCase, beforeSafetyCase);

    // PublicLibraryRepository must never expose Draft qcat-<receiptId> documents
    const publicRepo = new PublicLibraryRepository({
      getById: async (id: string) =>
        (db.getRawDoc(
          LIBRARY_DOCUMENTS_COLLECTION,
          id
        ) as unknown as LibraryDocument) ?? null,
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

    // Contract parser unit check
    assert.equal(
      parseLibraryQuarantineIsolatedInspectionRequestId(
        `${seeded.receiptId}_0_1`
      ),
      null
    );
    assert.notEqual(
      parseLibraryQuarantineIsolatedInspectionRequestId(
        `${seeded.receiptId}_2_1`
      ),
      null
    );

    // Verify all 18 READ_ONLY manifest files remain untouched at exact expected Git blob SHA-1s
    for (const [relPath, expectedBlobSha] of READ_ONLY_MANIFEST_EXPECTED_BLOBS) {
      const fullPath = path.resolve(process.cwd(), relPath);
      const buf = fs.readFileSync(fullPath);
      const actualBlobSha = createHash('sha1')
        .update(`blob ${buf.length}\0`)
        .update(buf)
        .digest('hex');
      assert.equal(
        actualBlobSha,
        expectedBlobSha,
        `READ_ONLY file modified: ${relPath}`
      );
    }
  }

  console.log(
    'ALL LIB-FILE-ISOLATED-INSPECTION-REQUEST-01 BACKEND TESTS PASSED (6/6).'
  );
}

runTests().catch((err) => {
  console.error('Isolated inspection backend tests failed:', err);
  process.exit(1);
});
