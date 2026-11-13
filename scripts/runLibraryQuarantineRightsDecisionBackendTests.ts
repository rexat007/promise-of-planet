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
  LIBRARY_QUARANTINE_RIGHTS_SCOPE,
  QUARANTINE_RIGHTS_READINESS_INDICATORS,
  deriveLibraryQuarantineRightsDecisionEventId,
  validatePersistedLibraryQuarantineRightsDecision,
  validatePersistedLibraryQuarantineRightsDecisionEvent,
  validateRightsDecisionInput,
} from '../functions/src/library/libraryQuarantineRightsDecisionContract';
import {
  FirestoreLibraryQuarantineRightsDecisionStore,
  LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
  LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENTS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineRightsDecisionStore';
import {
  LibraryQuarantineRightsDecisionService,
  isAuthorizedHumanLibraryRightsReviewer,
  type GetLibraryQuarantineRightsDecisionResponseDto,
  type SaveLibraryQuarantineRightsDecisionResponseDto,
} from '../functions/src/library/libraryQuarantineRightsDecisionService';

const require = createRequire(import.meta.url);
const {
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

class InMemoryRightsFirestoreDatabase
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

  public listCollectionDocs(
    collectionName: string
  ): Array<Record<string, unknown>> {
    const col = this.collections.get(collectionName);
    if (!col) return [];
    return Array.from(col.values()).map((d) => deepClone(d));
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
    this.transactionCount += 1;

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

    const resolveColName = (ref: LibraryQuarantineFirestoreDocumentRef): string =>
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
        this.txOps.push({ kind: 'get', collectionName: colName, docId: ref.id });
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
          this.onBeforeTransactionWritesHook?.();
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
          this.onBeforeTransactionWritesHook?.();
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
        this.txOps.push({ kind: 'set', collectionName: colName, docId: ref.id });
        throw new Error('UNSAFE_TX_SET_FORBIDDEN');
      },
    };

    const result = await updateFunction(tx);

    for (const mutate of stagedMutations) {
      mutate();
    }

    // Commit to underlying store before optional post-stage hook (to simulate
    // commit acknowledgement loss after writes are staged/committed)
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
  private readonly byUid = new Map<string, AdminUser>();
  public getAdminCalls = 0;
  public throwOnLookup: Error | null = null;

  constructor(users: readonly AdminUser[]) {
    for (const u of users) {
      this.byUid.set(u.id, Object.freeze({ ...u }));
    }
  }

  public async getAdminByUid(uid: string): Promise<AdminUser | null> {
    this.getAdminCalls += 1;
    if (this.throwOnLookup) {
      throw this.throwOnLookup;
    }
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
  db: InMemoryRightsFirestoreDatabase,
  index: number,
  overrides: {
    readonly receiptState?: LibraryQuarantineReceiptState;
    readonly receiptRevision?: number;
    readonly includeDraft?: boolean;
    readonly includeCase?: boolean;
    readonly caseStatus?: LibraryQuarantineHumanReviewCaseStatus;
    readonly caseRevision?: number;
    readonly caseUpdatedAt?: string;
    readonly includeHandoff?: boolean;
    readonly handoffCaseRevision?: number;
    readonly handoffCaseUpdatedAt?: string;
    readonly includeDocument?: boolean;
    readonly documentWorkflowState?: WorkflowState;
    readonly documentRightsStatus?: LibraryRightsStatus;
    readonly documentVersionReferenceUrl?: string;
  } = {}
): {
  readonly receiptId: string;
  readonly documentId: string;
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly draft: LibraryQuarantinePersistedReviewDraft;
  readonly reviewCase: LibraryQuarantinePersistedHumanReviewCase;
  readonly handoff: LibraryQuarantinePersistedCatalogHandoff;
  readonly catalogDoc: LibraryDocument;
} {
  const receiptId = buildHexReceiptId(index);
  const documentId = deriveQuarantineCatalogDocumentId(receiptId);
  const sha256 = createHash('sha256')
    .update(Buffer.from(`Rights Decision Test Payload #${index}`, 'utf8'))
    .digest('hex');

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
    originalFilename: `marine-protection-${index}.pdf`,
    sanitizedFilename: `marine-protection-${index}.pdf`,
    format: 'PDF' as const,
    canonicalExtension: 'pdf' as const,
    canonicalMimeType: 'application/pdf',
    byteSize: 12288 + index,
    sha256,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    storagePath: `library/quarantine/${receiptId}/source.pdf`,
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
    format: 'PDF' as const,
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
    titleAr: `حماية البيئات البحرية والساحلية ${index}`,
    titleEn: `Marine and Coastal Habitat Protection ${index}`,
    issuingOrganization: 'برنامج الأمم المتحدة للبيئة (UNEP)',
    summaryAr: 'ملخص تحريري مراجع لحماية البيئات البحرية.',
    summaryEn: 'Reviewed editorial summary for marine habitat protection.',
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
    createdAt: '2026-11-10T08:30:00.000Z',
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

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
    createdAt: '2026-11-10T08:30:00.000Z',
    updatedAt: '2026-11-10T08:30:00.000Z',
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
  if (overrides.includeDraft !== false) {
    db.seedDoc(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION, receiptId, draft);
  }
  if (overrides.includeCase !== false) {
    db.seedDoc(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      receiptId,
      reviewCase
    );
  }
  if (overrides.includeHandoff !== false) {
    db.seedDoc(
      LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
      receiptId,
      handoff
    );
  }
  if (overrides.includeDocument !== false) {
    db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, documentId, catalogDoc);
  }

  return {
    receiptId,
    documentId,
    receipt,
    envelope,
    draft,
    reviewCase,
    handoff,
    catalogDoc,
  };
}

function assertRightsDtoZeroLeakage(
  dto: unknown,
  contextLabel: string,
  forbiddenLiterals: readonly string[] = []
): void {
  const serialized = JSON.stringify(dto);
  const lower = serialized.toLowerCase();

  assert.equal(
    /"(?:sourcesha256|sha256|createdby|updatedby|actoruid|uploaderuid|storagepath|generation|attestedgeneration|gcsgeneration|objectgeneration|metageneration|bucket|bucketname|signedurl|downloadurl|downloadtoken|referenceurl)"\s*:/i.test(
      serialized
    ),
    false,
    `${contextLabel}: must not contain forbidden secret or storage JSON keys`
  );
  assert.equal(
    lower.includes('library/quarantine/') ||
      lower.includes('gs://') ||
      lower.includes('http://') ||
      lower.includes('https://'),
    false,
    `${contextLabel}: must not contain storage paths or URLs`
  );

  for (const lit of forbiddenLiterals) {
    if (lit.length > 0) {
      assert.equal(
        serialized.includes(lit),
        false,
        `${contextLabel}: must not leak literal "${lit}"`
      );
    }
  }
}

async function runTests(): Promise<void> {
  console.log(
    'Running LIB-FILE-RIGHTS-AND-READINESS-01 backend tests...'
  );

  const defaultAdmins: AdminUser[] = [
    {
      id: 'admin_owner_01',
      name: 'Owner Admin',
      email: 'owner@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    },
    {
      id: 'admin_rights_01',
      name: 'Rights Reviewer',
      email: 'rights@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    },
    {
      id: 'admin_curator_01',
      name: 'Library Curator (No ManageRights)',
      email: 'curator@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
    },
    {
      id: 'admin_inactive_rights',
      name: 'Inactive Rights Reviewer',
      email: 'inactive-rights@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: false,
    },
    {
      id: 'admin_ai_assistant',
      name: 'PEIA AI Assistant',
      email: 'ai@promiseofplanet.org',
      role: AdminRole.AIAssistant,
      isActive: true,
    },
    {
      id: 'admin_content_editor',
      name: 'Content Editor',
      email: 'editor@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    },
    {
      id: 'admin_training_mgr',
      name: 'Training Manager',
      email: 'training@promiseofplanet.org',
      role: AdminRole.TrainingManager,
      isActive: true,
    },
    {
      id: 'admin_viewer_01',
      name: 'Read Only Viewer',
      email: 'viewer@promiseofplanet.org',
      role: AdminRole.Viewer,
      isActive: true,
    },
    {
      id: 'admin_narrowed_owner',
      name: 'Narrowed Owner Without ManageRights',
      email: 'narrowed@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
      permissions: [AdminPermission.View, AdminPermission.Review],
    } as unknown as AdminUser,
  ];

  // =========================================================================
  // PASS 1: 4-flag server release gates fail closed with
  //         RIGHTS_DECISION_NOT_RELEASED before any Auth/AdminRepo/Firestore I/O
  // =========================================================================
  {
    const db = new InMemoryRightsFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const dummyService = {} as unknown as LibraryApplicationService;
    const seeded = seedFullEligibleChain(db, 1);

    const envKeys = [
      LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR,
      LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR,
      LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR,
      LIBRARY_RIGHTS_DECISION_RELEASE_ENV_VAR,
    ] as const;

    const savedEnv: Record<string, string | undefined> = {};
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }

    try {
      // Every combination where at least one of the 4 flags is not 'true' must fail closed
      const disabledCombinations: Array<Record<string, string | undefined>> = [
        {},
        {
          [LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR]: 'true',
        },
        {
          [LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_RIGHTS_DECISION_RELEASE_ENV_VAR]: 'false',
        },
        {
          [LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_RIGHTS_DECISION_RELEASE_ENV_VAR]: '1',
        },
        {
          [LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR]: 'false',
          [LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_RIGHTS_DECISION_RELEASE_ENV_VAR]: 'true',
        },
        {
          [LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR]: 'false',
          [LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_RIGHTS_DECISION_RELEASE_ENV_VAR]: 'true',
        },
        {
          [LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR]: 'true',
          [LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR]: 'false',
          [LIBRARY_RIGHTS_DECISION_RELEASE_ENV_VAR]: 'true',
        },
      ];

      db.resetCounters();
      adminRepo.getAdminCalls = 0;

      for (const combo of disabledCombinations) {
        for (const k of envKeys) {
          if (combo[k] === undefined) delete process.env[k];
          else process.env[k] = combo[k];
        }

        for (const action of [
          'getQuarantineRightsDecision',
          'saveQuarantineRightsDecision',
        ] as const) {
          await assert.rejects(
            async () => {
              await executeManageLibraryDocumentsRequest(
                {
                  auth: { uid: 'admin_rights_01' },
                  data:
                    action === 'getQuarantineRightsDecision'
                      ? { action, receiptId: seeded.receiptId }
                      : {
                          action,
                          receiptId: seeded.receiptId,
                          expectedRevision: 0,
                          input: {
                            decision: 'EVIDENCE_PENDING',
                            basis: 'UNDETERMINED',
                            evidenceNotes: 'Pending verification.',
                          },
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
              assert.match(
                (err as Error).message,
                /^RIGHTS_DECISION_NOT_RELEASED:/
              );
              return true;
            }
          );
        }
      }

      assert.equal(
        adminRepo.getAdminCalls,
        0,
        'Disabled release gates must perform 0 AdminRepository lookups'
      );
      assert.equal(
        db.pointGetCalls,
        0,
        'Disabled release gates must perform 0 Firestore reads'
      );
      assert.equal(
        db.transactionCount,
        0,
        'Disabled release gates must perform 0 Firestore transactions'
      );
    } finally {
      for (const k of envKeys) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    }

    console.log(
      'PASS 1: All 4 server release gates fail closed with RIGHTS_DECISION_NOT_RELEASED before any Auth, AdminRepository, or Firestore I/O.'
    );
  }

  // =========================================================================
  // PASS 2: Authentication provenance & RBAC matrix (RightsReviewer & Owner
  //         allowed; LibraryCurator without ManageRights, Viewer, Editor,
  //         TrainingManager, AIAssistant, inactive, and spoofed payloads rejected)
  // =========================================================================
  {
    const db = new InMemoryRightsFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const dummyService = {} as unknown as LibraryApplicationService;
    const seeded = seedFullEligibleChain(db, 2);

    const enabledOptions = {
      workbenchEnabled: true,
      humanCaseReviewEnabled: true,
      catalogHandoffEnabled: true,
      rightsDecisionEnabled: true,
      draftDatabase: db,
      rightsDecisionClock: () => '2026-11-10T09:00:00.000Z',
    };

    // Unit verification of isAuthorizedHumanLibraryRightsReviewer
    assert.equal(
      isAuthorizedHumanLibraryRightsReviewer(defaultAdmins[0]),
      true,
      'Owner must be authorized'
    );
    assert.equal(
      isAuthorizedHumanLibraryRightsReviewer(defaultAdmins[1]),
      true,
      'RightsReviewer must be authorized despite lacking Create'
    );
    assert.equal(
      isAuthorizedHumanLibraryRightsReviewer(defaultAdmins[2]),
      false,
      'LibraryCurator without ManageRights must NOT be authorized for rights decisions'
    );
    assert.equal(
      isAuthorizedHumanLibraryRightsReviewer(defaultAdmins[3]),
      false,
      'Inactive RightsReviewer must NOT be authorized'
    );
    assert.equal(
      isAuthorizedHumanLibraryRightsReviewer(defaultAdmins[4]),
      false,
      'AIAssistant must NOT be authorized'
    );
    assert.equal(
      isAuthorizedHumanLibraryRightsReviewer(defaultAdmins[8]),
      false,
      'Owner with narrowed permissions lacking ManageRights must NOT be authorized'
    );

    db.resetCounters();
    adminRepo.getAdminCalls = 0;

    // 2A: Spoofed caller fields in request.data rejected before AdminRepository lookup
    const sym = Symbol('spoof');
    const symPayload: Record<PropertyKey, unknown> = {
      action: 'getQuarantineRightsDecision',
      receiptId: seeded.receiptId,
    };
    symPayload[sym] = true;

    const spoofedPayloads: Array<Record<string, unknown>> = [
      {
        action: 'getQuarantineRightsDecision',
        receiptId: seeded.receiptId,
        uid: 'admin_owner_01',
      },
      {
        action: 'getQuarantineRightsDecision',
        receiptId: seeded.receiptId,
        role: AdminRole.Owner,
      },
      {
        action: 'saveQuarantineRightsDecision',
        receiptId: seeded.receiptId,
        expectedRevision: 0,
        rightsScope: 'BINARY_PUBLICATION',
        input: {
          decision: 'EVIDENCE_PENDING',
          basis: 'UNDETERMINED',
          evidenceNotes: 'Note',
        },
      },
      symPayload as Record<string, unknown>,
    ];

    for (const dataPayload of spoofedPayloads) {
      await assert.rejects(
        async () => {
          await executeManageLibraryDocumentsRequest(
            {
              auth: { uid: 'admin_rights_01' },
              data: dataPayload,
            },
            adminRepo,
            dummyService,
            undefined,
            undefined,
            undefined,
            undefined,
            enabledOptions
          );
        },
        (err: unknown) => {
          assert.equal((err as { code?: string }).code, 'invalid-argument');
          return true;
        }
      );
    }

    assert.equal(
      adminRepo.getAdminCalls,
      0,
      'Spoofed caller fields must fail before AdminRepository lookup'
    );

    // 2B: Unauthorized roles (including LibraryCurator without ManageRights!) rejected with 0 Firestore reads
    const unauthorizedUids = [
      'admin_curator_01',
      'admin_inactive_rights',
      'admin_ai_assistant',
      'admin_content_editor',
      'admin_training_mgr',
      'admin_viewer_01',
      'admin_narrowed_owner',
      'unknown_admin_999',
    ];

    for (const uid of unauthorizedUids) {
      await assert.rejects(
        async () => {
          await executeManageLibraryDocumentsRequest(
            {
              auth: { uid },
              data: {
                action: 'getQuarantineRightsDecision',
                receiptId: seeded.receiptId,
              },
            },
            adminRepo,
            dummyService,
            undefined,
            undefined,
            undefined,
            undefined,
            enabledOptions
          );
        },
        (err: unknown) => {
          assert.equal((err as { code?: string }).code, 'permission-denied');
          return true;
        }
      );
    }

    assert.equal(
      db.pointGetCalls,
      0,
      'Unauthorized callers (including LibraryCurator without ManageRights) must perform 0 Firestore reads'
    );

    // 2C: Authorized RightsReviewer and Owner succeed
    for (const authorizedUid of ['admin_rights_01', 'admin_owner_01']) {
      const getRes = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: authorizedUid },
          data: {
            action: 'getQuarantineRightsDecision',
            receiptId: seeded.receiptId,
          },
        },
        adminRepo,
        dummyService,
        undefined,
        undefined,
        undefined,
        undefined,
        enabledOptions
      )) as GetLibraryQuarantineRightsDecisionResponseDto;

      assert.equal(getRes.ok, true);
      if (getRes.ok) {
        assert.equal(getRes.status, 'READY');
        assert.equal(getRes.currentRevision, 0);
        assert.equal(getRes.rightsDecision, null);
        assert.deepEqual(
          getRes.readiness,
          QUARANTINE_RIGHTS_READINESS_INDICATORS
        );
      }
    }

    console.log(
      'PASS 2: Authentication provenance and RBAC matrix verified (RightsReviewer and Owner allowed; LibraryCurator without ManageRights and non-human/inactive principals rejected with 0 Firestore reads).'
    );
  }

  // =========================================================================
  // PASS 3: Strict input validation & editorial rules (METADATA_USE_CLEARED,
  //         RESTRICTED, NOT_PERMITTED, plain text, no URLs/paths/HTML/bidi)
  // =========================================================================
  {
    // Valid METADATA_USE_CLEARED requires basis !== UNDETERMINED + evidenceReference + evidenceNotes
    const validCleared = validateRightsDecisionInput({
      decision: 'METADATA_USE_CLEARED',
      basis: 'OFFICIAL_RECORD',
      evidenceReference: 'Official Gazette Issue 4210 — Decision 19/2026',
      evidenceNotes:
        'Published government record; descriptive catalog metadata is cleared for indexing.',
      reviewNotes: 'Binary file remains quarantined and blocked from publication.',
    });
    assert.equal(validCleared.ok, true);

    // METADATA_USE_CLEARED with UNDETERMINED basis -> HOLD
    const clearedUndetermined = validateRightsDecisionInput({
      decision: 'METADATA_USE_CLEARED',
      basis: 'UNDETERMINED',
      evidenceReference: 'Ref-100',
      evidenceNotes: 'Some notes',
      reviewNotes: 'Some review notes',
    });
    assert.equal(clearedUndetermined.ok, false);
    if (!clearedUndetermined.ok) {
      assert.equal(
        clearedUndetermined.errorCode,
        'METADATA_USE_CLEARED_REQUIREMENTS_NOT_MET'
      );
    }

    // METADATA_USE_CLEARED with empty evidenceReference -> HOLD
    const clearedNoRef = validateRightsDecisionInput({
      decision: 'METADATA_USE_CLEARED',
      basis: 'OPEN_LICENSE',
      evidenceReference: '   ',
      evidenceNotes: 'CC BY 4.0 metadata use.',
      reviewNotes: '',
    });
    assert.equal(clearedNoRef.ok, false);
    if (!clearedNoRef.ok) {
      assert.equal(
        clearedNoRef.errorCode,
        'METADATA_USE_CLEARED_REQUIREMENTS_NOT_MET'
      );
    }

    // METADATA_USE_CLEARED with empty evidenceNotes -> HOLD
    const clearedNoNotes = validateRightsDecisionInput({
      decision: 'METADATA_USE_CLEARED',
      basis: 'OPEN_LICENSE',
      evidenceReference: 'CC-BY-4.0-REF',
      evidenceNotes: '   ',
      reviewNotes: 'Clicked approve without evidence notes',
    });
    assert.equal(clearedNoNotes.ok, false);
    if (!clearedNoNotes.ok) {
      assert.equal(
        clearedNoNotes.errorCode,
        'METADATA_USE_CLEARED_REQUIREMENTS_NOT_MET'
      );
    }

    // RESTRICTED / NOT_PERMITTED without notes -> JUSTIFICATION_NOTES_REQUIRED
    for (const dec of ['RESTRICTED', 'NOT_PERMITTED'] as const) {
      const noJust = validateRightsDecisionInput({
        decision: dec,
        basis: 'INTERNAL_ONLY',
        evidenceReference: 'REF-1',
        evidenceNotes: '',
        reviewNotes: '',
      });
      assert.equal(noJust.ok, false);
      if (!noJust.ok) {
        assert.equal(noJust.errorCode, 'JUSTIFICATION_NOTES_REQUIRED');
      }
    }

    // Completely empty fields -> EMPTY_RIGHTS_DECISION_NOT_ALLOWED
    const emptyRes = validateRightsDecisionInput({
      decision: 'EVIDENCE_PENDING',
      basis: 'UNDETERMINED',
      evidenceReference: '',
      evidenceNotes: '',
      reviewNotes: '',
    });
    assert.equal(emptyRes.ok, false);
    if (!emptyRes.ok) {
      assert.equal(emptyRes.errorCode, 'EMPTY_RIGHTS_DECISION_NOT_ALLOWED');
    }

    // Forbidden HTML, bidi, storagePath, gs://, https://, extra/privileged keys
    const forbiddenInputs: unknown[] = [
      {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceNotes: '<script>alert(1)</script>',
      },
      {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceReference: 'gs://promiseofplanet-bb325-library-quarantine/obj',
      },
      {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceReference: 'library/quarantine/0000/source.pdf',
      },
      {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceReference: 'https://storage.googleapis.com/secret',
      },
      {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceNotes: 'Bidi override \u202Eattack',
      },
      {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceNotes: 'Valid note',
        rightsScope: 'BINARY_PUBLICATION',
      },
      {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceNotes: 'Valid note',
        isRightsApproved: true,
      },
    ];

    for (const bad of forbiddenInputs) {
      const res = validateRightsDecisionInput(bad);
      assert.equal(res.ok, false);
    }

    console.log(
      'PASS 3: Strict plain-text input validation and status-specific editorial requirements verified.'
    );
  }

  // =========================================================================
  // PASS 4: Full 6-document chain eligibility & SOURCE_CASE_VERSION_DRIFT_HOLD
  // =========================================================================
  {
    const db = new InMemoryRightsFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const service = new LibraryQuarantineRightsDecisionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({ uid: 'admin_rights_01' }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T09:30:00.000Z',
    });

    // 4A: Missing catalog handoff -> CATALOG_HANDOFF_NOT_CREATED_HOLD
    const noHandoff = seedFullEligibleChain(db, 10, {
      includeHandoff: false,
      includeDocument: false,
    });
    const getNoHandoff = await service.getQuarantineRightsDecision({
      receiptId: noHandoff.receiptId,
    });
    assert.equal(getNoHandoff.ok, false);
    if (!getNoHandoff.ok) {
      assert.equal(getNoHandoff.errorCode, 'CATALOG_HANDOFF_NOT_CREATED_HOLD');
    }

    const saveNoHandoff = await service.saveQuarantineRightsDecision({
      receiptId: noHandoff.receiptId,
      expectedRevision: 0,
      input: {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceNotes: 'Waiting for catalog draft.',
      },
    });
    assert.equal(saveNoHandoff.ok, false);
    if (!saveNoHandoff.ok && saveNoHandoff.status === 'HOLD') {
      assert.equal(saveNoHandoff.errorCode, 'CATALOG_HANDOFF_NOT_CREATED_HOLD');
      assert.equal(saveNoHandoff.decisionSaved, false);
    }

    // 4B: Human review case version drifted after catalog handoff (humanCase.revision=3 vs handoff.caseRevision=2)
    // -> SOURCE_CASE_VERSION_DRIFT_HOLD with 0 writes and no auto-reconciliation!
    const drifted = seedFullEligibleChain(db, 11, {
      caseRevision: 3,
      caseUpdatedAt: '2026-11-10T08:45:00.000Z',
      handoffCaseRevision: 2,
      handoffCaseUpdatedAt: '2026-11-10T08:20:00.000Z',
    });

    const getDrifted = await service.getQuarantineRightsDecision({
      receiptId: drifted.receiptId,
    });
    assert.equal(getDrifted.ok, false);
    if (!getDrifted.ok) {
      assert.equal(getDrifted.errorCode, 'SOURCE_CASE_VERSION_DRIFT_HOLD');
    }

    db.resetCounters();
    const saveDrifted = await service.saveQuarantineRightsDecision({
      receiptId: drifted.receiptId,
      expectedRevision: 0,
      input: {
        decision: 'METADATA_USE_CLEARED',
        basis: 'OFFICIAL_RECORD',
        evidenceReference: 'Gazette 4210',
        evidenceNotes: 'Cleared metadata.',
      },
    });
    assert.equal(saveDrifted.ok, false);
    if (!saveDrifted.ok && saveDrifted.status === 'HOLD') {
      assert.equal(saveDrifted.errorCode, 'SOURCE_CASE_VERSION_DRIFT_HOLD');
      assert.equal(saveDrifted.decisionSaved, false);
    }
    assert.equal(
      db.txCreateCalls + db.txUpdateCalls,
      0,
      'SOURCE_CASE_VERSION_DRIFT_HOLD must perform 0 writes'
    );

    // 4C: Non-METADATA_RECORDED human review case -> CASE_NOT_METADATA_RECORDED
    const inReviewChain = seedFullEligibleChain(db, 12, {
      caseStatus: 'IN_REVIEW',
    });
    const getInReview = await service.getQuarantineRightsDecision({
      receiptId: inReviewChain.receiptId,
    });
    assert.equal(getInReview.ok, false);
    if (!getInReview.ok) {
      assert.equal(getInReview.errorCode, 'CASE_NOT_METADATA_RECORDED');
    }

    // 4D: NeedsReconciliation receipt -> RECEIPT_NEEDS_RECONCILIATION
    const reconChain = seedFullEligibleChain(db, 13, {
      receiptState: LibraryQuarantineReceiptState.NeedsReconciliation,
    });
    const getRecon = await service.getQuarantineRightsDecision({
      receiptId: reconChain.receiptId,
    });
    assert.equal(getRecon.ok, false);
    if (!getRecon.ok) {
      assert.equal(getRecon.errorCode, 'RECEIPT_NEEDS_RECONCILIATION');
    }

    // 4E: Tampered qcat- document with referenceUrl -> SECURITY_POSTURE_VIOLATION
    const urlDocChain = seedFullEligibleChain(db, 14, {
      documentVersionReferenceUrl: 'https://example.org/leaked.pdf',
    });
    const getUrlDoc = await service.getQuarantineRightsDecision({
      receiptId: urlDocChain.receiptId,
    });
    assert.equal(getUrlDoc.ok, false);
    if (!getUrlDoc.ok) {
      assert.equal(getUrlDoc.errorCode, 'SECURITY_POSTURE_VIOLATION');
    }

    console.log(
      'PASS 4: Full 6-document chain eligibility and SOURCE_CASE_VERSION_DRIFT_HOLD verified with zero writes on hold.'
    );
  }

  // =========================================================================
  // PASS 5: Revision lifecycle (0 -> 1 -> 2), exact point-read/write budgets,
  //         append-only audit events, and zero status/publication escalation
  // =========================================================================
  {
    const db = new InMemoryRightsFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const dummyService = {} as unknown as LibraryApplicationService;
    const seeded = seedFullEligibleChain(db, 20);
    let currentClock = '2026-11-10T10:00:00.000Z';

    const handlerOptions = {
      workbenchEnabled: true,
      humanCaseReviewEnabled: true,
      catalogHandoffEnabled: true,
      rightsDecisionEnabled: true,
      draftDatabase: db,
      rightsDecisionClock: () => currentClock,
    };

    // 5A: Revision 0 initial read (6 point reads, 0 writes)
    db.resetCounters();
    const getRev0 = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin_rights_01' },
        data: {
          action: 'getQuarantineRightsDecision',
          receiptId: seeded.receiptId,
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOptions
    )) as GetLibraryQuarantineRightsDecisionResponseDto;

    assert.equal(getRev0.ok, true);
    assert.equal(getRev0.currentRevision, 0);
    assert.equal(getRev0.rightsDecision, null);
    assert.equal(getRev0.rightsScope, LIBRARY_QUARANTINE_RIGHTS_SCOPE);
    assert.deepEqual(
      getRev0.readiness,
      QUARANTINE_RIGHTS_READINESS_INDICATORS
    );
    assert.equal(db.pointGetCalls, 7, 'get must perform exactly 7 point reads');
    assert.equal(db.transactionCount, 0);

    // 5B: Save revision 1 (expectedRevision: 0 -> CREATED)
    db.resetCounters();
    const saveRev1 = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin_rights_01' },
        data: {
          action: 'saveQuarantineRightsDecision',
          receiptId: seeded.receiptId,
          expectedRevision: 0,
          input: {
            decision: 'PERMISSION_REQUIRED',
            basis: 'UNDETERMINED',
            evidenceReference: 'Inquiry-UNEP-2026-09',
            evidenceNotes: 'Awaiting written confirmation of metadata terms.',
            reviewNotes: 'Initial rights assessment opened.',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOptions
    )) as SaveLibraryQuarantineRightsDecisionResponseDto;

    assert.equal(saveRev1.ok, true);
    assert.equal(saveRev1.status, 'SAVED');
    assert.equal(saveRev1.decisionSaveOutcome, 'CREATED');
    assert.equal(saveRev1.decisionSaved, true);
    assert.equal(saveRev1.currentRevision, 1);
    assert.equal(saveRev1.rightsDecision.revision, 1);
    assert.equal(saveRev1.rightsDecision.decision, 'PERMISSION_REQUIRED');
    assert.equal(saveRev1.rightsDecision.basis, 'UNDETERMINED');
    assert.deepEqual(
      saveRev1.readiness,
      QUARANTINE_RIGHTS_READINESS_INDICATORS
    );

    assert.equal(db.transactionCount, 1);
    assert.equal(
      db.txGetCalls,
      8,
      'save transaction must perform exactly 8 point reads before writes'
    );
    assert.equal(
      db.txCreateCalls,
      2,
      'initial save must perform 2 tx.create calls (decision + event)'
    );
    assert.equal(db.txUpdateCalls, 0);
    assert.equal(db.txSetCalls, 0);

    assertRightsDtoZeroLeakage(saveRev1, 'Save revision 1 response DTO', [
      seeded.receipt.sha256,
      seeded.receipt.storagePath,
      seeded.receipt.generation ?? '',
      'admin_rights_01',
    ]);

    // 5C: Save revision 2 (expectedRevision: 1 -> UPDATED to METADATA_USE_CLEARED by Owner)
    currentClock = '2026-11-10T10:15:00.000Z';
    db.resetCounters();
    const saveRev2 = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin_owner_01' },
        data: {
          action: 'saveQuarantineRightsDecision',
          receiptId: seeded.receiptId,
          expectedRevision: 1,
          input: {
            decision: 'METADATA_USE_CLEARED',
            basis: 'OFFICIAL_RECORD',
            evidenceReference: 'UNEP/EA.6/Res.4 Official Record',
            evidenceNotes:
              'Official UN Environment Assembly resolution record; descriptive catalog metadata is cleared for internal catalog indexing.',
            reviewNotes:
              'Cleared for catalog metadata only. Binary PDF remains quarantined and blocked from publication.',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOptions
    )) as SaveLibraryQuarantineRightsDecisionResponseDto;

    assert.equal(saveRev2.ok, true);
    assert.equal(saveRev2.status, 'SAVED');
    assert.equal(saveRev2.decisionSaveOutcome, 'UPDATED');
    assert.equal(saveRev2.decisionSaved, true);
    assert.equal(saveRev2.currentRevision, 2);
    assert.equal(saveRev2.rightsDecision.revision, 2);
    assert.equal(saveRev2.rightsDecision.decision, 'METADATA_USE_CLEARED');
    assert.equal(saveRev2.rightsDecision.basis, 'OFFICIAL_RECORD');
    assert.equal(saveRev2.rightsDecision.createdAt, '2026-11-10T10:00:00.000Z');
    assert.equal(saveRev2.rightsDecision.updatedAt, '2026-11-10T10:15:00.000Z');
    assert.deepEqual(
      saveRev2.readiness,
      QUARANTINE_RIGHTS_READINESS_INDICATORS
    );
    assert.equal(saveRev2.isRightsApproved, false);
    assert.equal(saveRev2.isPublished, false);
    assert.equal(saveRev2.isSanitized, false);
    assert.equal(saveRev2.isVerifiedSafe, false);
    assert.equal(saveRev2.isReadyForPeia, false);

    assert.equal(db.transactionCount, 1);
    assert.equal(db.txGetCalls, 8);
    assert.equal(
      db.txUpdateCalls,
      1,
      'revision 2 must call tx.update on the decision document'
    );
    assert.equal(
      db.txCreateCalls,
      1,
      'revision 2 must call tx.create on the new audit event'
    );
    assert.equal(db.txSetCalls, 0);

    // Verify persisted decision & both append-only audit events (<receiptId>_1 and <receiptId>_2)
    const rawDecision = db.getRawDoc(
      LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
      seeded.receiptId
    );
    const decisionValidation = validatePersistedLibraryQuarantineRightsDecision(
      rawDecision,
      seeded.receiptId
    );
    assert.equal(decisionValidation.ok, true);
    if (decisionValidation.ok) {
      assert.equal(decisionValidation.rightsDecision.createdBy, 'admin_rights_01');
      assert.equal(decisionValidation.rightsDecision.updatedBy, 'admin_owner_01');
    }

    const event1 = db.getRawDoc(
      LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENTS_COLLECTION,
      deriveLibraryQuarantineRightsDecisionEventId(seeded.receiptId, 1)
    );
    const event2 = db.getRawDoc(
      LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENTS_COLLECTION,
      deriveLibraryQuarantineRightsDecisionEventId(seeded.receiptId, 2)
    );
    const ev1Check = validatePersistedLibraryQuarantineRightsDecisionEvent(
      event1,
      seeded.receiptId,
      1
    );
    const ev2Check = validatePersistedLibraryQuarantineRightsDecisionEvent(
      event2,
      seeded.receiptId,
      2
    );
    assert.equal(ev1Check.ok, true);
    assert.equal(ev2Check.ok, true);
    if (ev1Check.ok && ev2Check.ok) {
      assert.equal(ev1Check.rightsEvent.eventType, 'CREATED');
      assert.equal(ev1Check.rightsEvent.previousRevision, 0);
      assert.equal(ev1Check.rightsEvent.decision, 'PERMISSION_REQUIRED');
      assert.equal(ev1Check.rightsEvent.actorUid, 'admin_rights_01');
      assert.equal(ev2Check.rightsEvent.eventType, 'UPDATED');
      assert.equal(ev2Check.rightsEvent.previousRevision, 1);
      assert.equal(ev2Check.rightsEvent.decision, 'METADATA_USE_CLEARED');
      assert.equal(ev2Check.rightsEvent.actorUid, 'admin_owner_01');
    }

    // 5D: Verify qcat- document was NOT mutated and remains blocked from workflow/rights/version/public release
    const storedQcat = db.getRawDoc(
      LIBRARY_DOCUMENTS_COLLECTION,
      seeded.documentId
    ) as unknown as LibraryDocument;
    assert.equal(storedQcat.workflowState, WorkflowState.Draft);
    assert.equal(storedQcat.rightsStatus, LibraryRightsStatus.ReviewRequired);
    assert.equal(storedQcat.versions[0].referenceUrl, undefined);

    const mockLibRepo: LibraryRepository = {
      async listAll() {
        return [storedQcat];
      },
      async getById(id: string) {
        return id === storedQcat.id ? storedQcat : null;
      },
      async create(doc: LibraryDocument) {
        return doc;
      },
      async update(doc: LibraryDocument) {
        return doc;
      },
    };

    const appService = new LibraryApplicationService(mockLibRepo);
    await assert.rejects(
      () =>
        appService.updateRights(
          seeded.documentId,
          LibraryRightsStatus.OpenPubliclyAvailable,
          'ملاحظة',
          'Note',
          defaultAdmins[0]
        ),
      /rights status is locked to ReviewRequired/
    );
    await assert.rejects(
      () =>
        appService.transitionWorkflow(
          seeded.documentId,
          WorkflowState.Published,
          'Publish attempt',
          defaultAdmins[0]
        ),
      /is locked in Draft until dedicated binary safety and rights clearance gates are released/
    );

    const pubRepo = new PublicLibraryRepository(mockLibRepo);
    const publicDocs = await pubRepo.listPublicDocuments();
    assert.equal(
      publicDocs.length,
      0,
      'qcat- document must remain excluded from PublicLibraryRepository even after METADATA_USE_CLEARED'
    );

    // 5E: Aligned case revision drift -> Stale rights decision & renewal with acknowledgedHumanCaseRevision
    // Update case to rev 3, update catalog document, and seed catalog case alignment to rev 3
    const alignmentTimestamp = '2026-11-10T10:30:00.000Z';
    currentClock = '2026-11-10T10:45:00.000Z';
    const updatedReviewCase: LibraryQuarantinePersistedHumanReviewCase = {
      ...seeded.reviewCase,
      revision: 3,
      updatedAt: alignmentTimestamp,
      titleAr: 'حماية البيئات البحرية والساحلية - مراجعة 3',
      titleEn: 'Marine and Coastal Habitat Protection - Rev 3',
      summaryAr: 'ملخص تحريري مراجع ومحدث للنسخة 3.',
      summaryEn: 'Reviewed editorial summary updated for rev 3.',
    };
    db.seedDoc(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      seeded.receiptId,
      updatedReviewCase
    );

    const updatedCatalogDoc: LibraryDocument = {
      ...seeded.catalogDoc,
      titleAr: updatedReviewCase.titleAr,
      titleEn: updatedReviewCase.titleEn,
      summaryAr: updatedReviewCase.summaryAr,
      summaryEn: updatedReviewCase.summaryEn,
      updatedAt: alignmentTimestamp,
    };
    db.seedDoc(
      LIBRARY_DOCUMENTS_COLLECTION,
      seeded.documentId,
      updatedCatalogDoc
    );

    const alignmentDoc: LibraryQuarantinePersistedCatalogCaseAlignment = {
      schemaVersion: 1,
      receiptId: seeded.receiptId,
      documentId: seeded.documentId,
      sourceRevision: seeded.envelope.revision,
      sourceUpdatedAt: seeded.receipt.updatedAt,
      sourceSha256: seeded.receipt.sha256,
      originalHandoffCaseRevision: seeded.handoff.caseRevision,
      alignmentRevision: 1,
      alignedHumanCaseRevision: 3,
      alignedHumanCaseUpdatedAt: alignmentTimestamp,
      documentUpdatedAt: alignmentTimestamp,
      createdBy: 'admin_owner_01',
      createdAt: alignmentTimestamp,
      updatedBy: 'admin_owner_01',
      updatedAt: alignmentTimestamp,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    };
    db.seedDoc(
      'library_quarantine_catalog_case_alignments',
      seeded.receiptId,
      alignmentDoc
    );

    // GET should return stale decision flags
    const staleGet = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin_rights_01' },
        data: {
          action: 'getQuarantineRightsDecision',
          receiptId: seeded.receiptId,
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOptions
    )) as GetLibraryQuarantineRightsDecisionResponseDto;

    assert.equal(staleGet.ok, true);
    assert.equal(staleGet.effectiveCaseRevision, 3);
    assert.equal(staleGet.rightsDecisionIsCurrent, false);
    assert.equal(staleGet.requiresFreshHumanRightsReview, true);

    // Save attempt without acknowledgedHumanCaseRevision fails with UNACKNOWLEDGED_CASE_REVISION_HOLD
    const unacknowledgedSave = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin_rights_01' },
        data: {
          action: 'saveQuarantineRightsDecision',
          receiptId: seeded.receiptId,
          expectedRevision: 2,
          input: {
            decision: 'METADATA_USE_CLEARED',
            basis: 'OPEN_LICENSE',
            evidenceReference: 'Gazette 4215',
            evidenceNotes: 'Re-reviewed for case revision 3.',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOptions
    )) as SaveLibraryQuarantineRightsDecisionResponseDto;

    assert.equal(unacknowledgedSave.ok, false);
    assert.equal(unacknowledgedSave.status, 'HOLD');
    assert.equal(unacknowledgedSave.errorCode, 'UNACKNOWLEDGED_CASE_REVISION_HOLD');

    // Save with acknowledgedHumanCaseRevision succeeds as revision 3
    const renewedSave = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin_rights_01' },
        data: {
          action: 'saveQuarantineRightsDecision',
          receiptId: seeded.receiptId,
          expectedRevision: 2,
          acknowledgedHumanCaseRevision: 3,
          input: {
            decision: 'METADATA_USE_CLEARED',
            basis: 'OPEN_LICENSE',
            evidenceReference: 'Gazette 4215',
            evidenceNotes: 'Re-reviewed for case revision 3 with explicit acknowledgment.',
          },
        },
      },
      adminRepo,
      dummyService,
      undefined,
      undefined,
      undefined,
      undefined,
      handlerOptions
    )) as SaveLibraryQuarantineRightsDecisionResponseDto;

    assert.equal(renewedSave.ok, true);
    assert.equal(renewedSave.currentRevision, 3);
    assert.equal(renewedSave.currentHumanCaseRevision, 3);
    assert.equal(renewedSave.rightsDecisionIsCurrent, true);
    assert.equal(renewedSave.requiresFreshHumanRightsReview, false);

    console.log(
      'PASS 5: Revision lifecycle (0 -> 1 -> 2 -> 3), stale decision invalidation, renewal with acknowledgedHumanCaseRevision, atomic read/write budgets, append-only audit events, and zero publication/rightsStatus escalation verified.'
    );
  }

  // =========================================================================
  // PASS 6: CAS conflict (CONFLICT) and commit uncertainty (UNKNOWN / decisionSaved: null)
  // =========================================================================
  {
    const db = new InMemoryRightsFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const store = new FirestoreLibraryQuarantineRightsDecisionStore(db);
    const service = new LibraryQuarantineRightsDecisionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({ uid: 'admin_rights_01' }),
      },
      adminRepository: adminRepo,
      decisionStore: store,
      clock: () => '2026-11-10T11:00:00.000Z',
    });

    const seeded = seedFullEligibleChain(db, 30);

    // Create revision 1
    const rev1 = await service.saveQuarantineRightsDecision({
      receiptId: seeded.receiptId,
      expectedRevision: 0,
      input: {
        decision: 'EVIDENCE_PENDING',
        basis: 'UNDETERMINED',
        evidenceNotes: 'Revision 1 saved.',
      },
    });
    assert.equal(rev1.ok, true);

    // 6A: Stale expectedRevision=0 when server is at revision 1 -> CONFLICT with 0 writes
    db.resetCounters();
    const conflictRes = await service.saveQuarantineRightsDecision({
      receiptId: seeded.receiptId,
      expectedRevision: 0,
      input: {
        decision: 'RESTRICTED',
        basis: 'INTERNAL_ONLY',
        reviewNotes: 'Concurrent stale save attempt.',
      },
    });
    assert.equal(conflictRes.ok, false);
    if (!conflictRes.ok && conflictRes.status === 'CONFLICT') {
      assert.equal(conflictRes.decisionSaved, false);
      assert.equal(conflictRes.decisionSaveOutcome, 'NOT_SAVED');
      assert.equal(
        conflictRes.errorCode,
        'RIGHTS_DECISION_REVISION_CONFLICT'
      );
      assert.equal(conflictRes.currentRevision, 1);
      assert.equal(conflictRes.currentDecision?.revision, 1);
      assert.equal(conflictRes.currentDecision?.decision, 'EVIDENCE_PENDING');
    } else {
      throw new Error('Expected CONFLICT response');
    }
    assert.equal(
      db.txCreateCalls + db.txUpdateCalls,
      0,
      'CAS conflict must perform 0 transaction writes'
    );

    // 6B: Pre-write transaction failure -> HOLD (decisionSaved: false)
    db.onBeforeTransactionWritesHook = () => {
      throw new Error('Simulated pre-write abort');
    };
    const preWriteFailRes = await service.saveQuarantineRightsDecision({
      receiptId: seeded.receiptId,
      expectedRevision: 1,
      input: {
        decision: 'RESTRICTED',
        basis: 'INTERNAL_ONLY',
        reviewNotes: 'Should abort before write.',
      },
    });
    db.onBeforeTransactionWritesHook = null;
    assert.equal(preWriteFailRes.ok, false);
    if (!preWriteFailRes.ok && preWriteFailRes.status === 'HOLD') {
      assert.equal(preWriteFailRes.decisionSaved, false);
      assert.equal(preWriteFailRes.decisionSaveOutcome, 'NOT_SAVED');
      assert.equal(preWriteFailRes.errorCode, 'TRANSACTION_ABORTED_NO_WRITE');
    } else {
      throw new Error('Expected HOLD on pre-write failure');
    }

    // 6C: Post-stage commit acknowledgement loss -> UNKNOWN (decisionSaved: null) with 0 auto-retries
    db.resetCounters();
    db.onAfterTransactionWritesStagedHook = () => {
      throw new Error('Simulated commit acknowledgement loss after write');
    };
    const unknownRes = await service.saveQuarantineRightsDecision({
      receiptId: seeded.receiptId,
      expectedRevision: 1,
      input: {
        decision: 'RESTRICTED',
        basis: 'INTERNAL_ONLY',
        reviewNotes: 'Committed before ack loss.',
      },
    });
    assert.equal(unknownRes.ok, false);
    if (!unknownRes.ok && unknownRes.status === 'UNKNOWN') {
      assert.equal(unknownRes.decisionSaved, null);
      assert.equal(unknownRes.decisionSaveOutcome, 'UNKNOWN');
      assert.equal(unknownRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
    } else {
      throw new Error('Expected UNKNOWN on post-stage commit loss');
    }
    assert.equal(
      db.transactionCount,
      1,
      'Service must never auto-retry on uncertain transaction commit'
    );

    console.log(
      'PASS 6: CAS revision conflict (CONFLICT) and post-stage commit uncertainty (UNKNOWN / decisionSaved: null) verified.'
    );
  }

  // =========================================================================
  // PASS 7: Cross-receipt isolation & raw exception redaction
  // =========================================================================
  {
    const db = new InMemoryRightsFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo(defaultAdmins);
    const service = new LibraryQuarantineRightsDecisionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({ uid: 'admin_rights_01' }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => '2026-11-10T11:30:00.000Z',
    });

    const receiptA = seedFullEligibleChain(db, 40);
    const receiptB = seedFullEligibleChain(db, 41);

    await service.saveQuarantineRightsDecision({
      receiptId: receiptA.receiptId,
      expectedRevision: 0,
      input: {
        decision: 'RESTRICTED',
        basis: 'INTERNAL_ONLY',
        reviewNotes: 'Receipt A restricted.',
      },
    });

    const getB = await service.getQuarantineRightsDecision({
      receiptId: receiptB.receiptId,
    });
    assert.equal(getB.ok, true);
    if (getB.ok) {
      assert.equal(
        getB.currentRevision,
        0,
        'Saving receipt A must not affect receipt B'
      );
      assert.equal(getB.rightsDecision, null);
    }

    // Raw exception redaction check
    const secretSentinel = 'RIGHTS_SECRET_SENTINEL_998877_DO_NOT_LEAK';
    db.throwOnPointGet = new Error(
      `${secretSentinel} gs://promiseofplanet-bb325-library-quarantine/secret`
    );
    const redactedGet = await service.getQuarantineRightsDecision({
      receiptId: receiptA.receiptId,
    });
    db.throwOnPointGet = null;
    assert.equal(redactedGet.ok, false);
    assertRightsDtoZeroLeakage(redactedGet, 'Redacted point-read failure DTO', [
      secretSentinel,
    ]);

    console.log(
      'PASS 7: Cross-receipt isolation and raw exception redaction verified.'
    );
  }

  // =========================================================================
  // PASS 8: Protected read-only files Git blob SHA-1 invariant verification
  // =========================================================================
  {
    const protectedFiles: ReadonlyArray<readonly [string, string]> = [
      [
        'functions/src/library/libraryQuarantineCatalogHandoffService.ts',
        '79e80cb3b9917ea9c0d3e15e23d5452235751b59',
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
        'src/services/libraryQuarantineCatalogHandoffClient.ts',
        '55a1d359c7b43768a69c7458fb7c2e24c41e929b',
      ],
      [
        'functions/src/library/libraryQuarantineRightsDecisionContract.ts',
        'b96652303ae516c2ba01f7f9d52e3c8875860f1f',
      ],
      [
        'src/components/library/AdminLibraryManagement.tsx',
        'fe71f7ac57a580da5e1309fb77e761f75695d274',
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
      'PASS 8: All 12 protected read-only manifest files verified at exact expected Git blob SHA-1s.'
    );
  }

  console.log(
    'ALL LIB-FILE-RIGHTS-AND-READINESS-01 BACKEND TESTS PASSED (8/8).'
  );
}

runTests().catch((err) => {
  console.error('LIB-FILE-RIGHTS-AND-READINESS-01 BACKEND TESTS FAILED:', err);
  process.exit(1);
});
