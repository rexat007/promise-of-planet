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
  type LibraryOrganization,
  type LibrarySource,
} from '../functions/src/shared/libraryContract';
import { WorkflowState } from '../functions/src/shared/workflowContract';
import type { LibraryRepository } from '../functions/src/library/libraryRepository';
import {
  LibraryApplicationService,
  QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX,
  isQuarantineCatalogDocumentId,
} from '../functions/src/library/libraryApplicationService';
import { PublicLibraryRepository } from '../functions/src/library/publicLibraryRepository';
import {
  LibraryQuarantineReceiptState,
  type LibraryQuarantineInternalReceipt,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION as LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
  LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
  type LibraryQuarantineFirestoreDatabase,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantineFirestoreTransaction,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION as LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
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
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
  LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_ORGANIZATIONS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION,
  LIBRARY_SOURCES_COLLECTION,
  deriveQuarantineCatalogDocumentId,
  validateCreateCatalogDraftClassificationInput,
  validatePersistedCatalogDraftDocument,
  validatePersistedLibraryQuarantineCatalogHandoff,
  validatePersistedLibraryQuarantineCatalogHandoffEvent,
  type CreateLibraryQuarantineCatalogDraftClassificationInput,
  type CreateLibraryQuarantineCatalogDraftResponseDto,
  type GetLibraryQuarantineCatalogHandoffResponseDto,
} from '../functions/src/library/libraryQuarantineCatalogHandoffService';

const require = createRequire(import.meta.url);
const {
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

function buildSeededPipelineState(
  index: number,
  overrides: {
    readonly receiptState?: LibraryQuarantineReceiptState;
    readonly receiptRevision?: number;
    readonly updatedAt?: string;
    readonly includeDraft?: boolean;
    readonly draftSourceRevision?: number;
    readonly draftSourceSha256?: string;
    readonly includeCase?: boolean;
    readonly caseStatus?: LibraryQuarantineHumanReviewCaseStatus;
    readonly caseRevision?: number;
    readonly caseSourceRevision?: number;
    readonly caseDraftSourceRevision?: number;
  } = {}
): {
  readonly receiptId: string;
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly draft: LibraryQuarantinePersistedReviewDraft | null;
  readonly reviewCase: LibraryQuarantinePersistedHumanReviewCase | null;
} {
  const receiptId = buildHexReceiptId(index);
  const sha256 = createHash('sha256')
    .update(Buffer.from(`Quarantine Catalog Test #${index}`, 'utf8'))
    .digest('hex');
  const createdAt = '2026-11-09T09:00:00.000Z';
  const updatedAt = overrides.updatedAt ?? '2026-11-09T09:05:00.000Z';
  const state =
    overrides.receiptState ?? LibraryQuarantineReceiptState.Quarantined;
  const revision = overrides.receiptRevision ?? 2;

  const isQuarantined = state === LibraryQuarantineReceiptState.Quarantined;
  const isNeedsReconciliation =
    state === LibraryQuarantineReceiptState.NeedsReconciliation;

  const receipt: LibraryQuarantineInternalReceipt = Object.freeze({
    receiptId,
    uploaderUid: 'admin-curator',
    originalFilename: `coastal-resilience-${index}.pdf`,
    sanitizedFilename: `coastal-resilience-${index}.pdf`,
    format: 'PDF' as const,
    canonicalExtension: 'pdf' as const,
    canonicalMimeType: 'application/pdf',
    byteSize: 8192 + index,
    sha256,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    storagePath: `library/quarantine/${receiptId}/source.pdf`,
    state,
    generation: isQuarantined ? `${9500 + index}` : null,
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
  const draftSourceRevision = overrides.draftSourceRevision ?? revision;
  const draftSourceSha256 = overrides.draftSourceSha256 ?? sha256;
  const draft: LibraryQuarantinePersistedReviewDraft | null = includeDraft
    ? Object.freeze({
        schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
        receiptId,
        sourceRevision: draftSourceRevision,
        sourceUpdatedAt: updatedAt,
        sourceSha256: draftSourceSha256,
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

  const includeCase = overrides.includeCase ?? true;
  const caseStatus = overrides.caseStatus ?? 'METADATA_RECORDED';
  const caseRevision = overrides.caseRevision ?? 1;
  const reviewCase: LibraryQuarantinePersistedHumanReviewCase | null =
    includeCase
      ? Object.freeze({
          schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
          receiptId,
          sourceRevision: overrides.caseSourceRevision ?? revision,
          sourceUpdatedAt: updatedAt,
          sourceSha256: draftSourceSha256,
          draftSourceRevision:
            overrides.caseDraftSourceRevision ?? draftSourceRevision,
          revision: caseRevision,
          status: caseStatus,
          titleAr: 'خطة المرونة الساحلية الإقليمية 2026',
          titleEn: 'Regional Coastal Resilience Plan 2026',
          issuingOrganization: 'برنامج الأمم المتحدة للبيئة (UNEP)',
          summaryAr:
            'ملخص تحريري مراجع بشرياً لوثيقة خطة المرونة الساحلية الإقليمية.',
          summaryEn:
            'Human-reviewed editorial summary of the regional coastal resilience plan.',
          sourceEvidenceNotes:
            'مرجع رسمي موثق في سجل الاتفاقيات الإقليمية 2026.',
          rightsEvidenceNotes:
            'بانتظار المراجعة الحقوقية المستقلة قبل أي نشر عام.',
          editorialNotes: 'تمت المراجعة التحريرية الأولية بالكامل.',
          createdBy: 'admin-curator',
          createdAt: '2026-11-09T10:00:00.000Z',
          updatedBy: 'admin-curator',
          updatedAt: '2026-11-09T10:15:00.000Z',
        })
      : null;

  return { receiptId, receipt, envelope, draft, reviewCase };
}

function buildValidOrganization(
  id = 'org-unep',
  overrides: Partial<LibraryOrganization> = {}
): LibraryOrganization {
  return Object.freeze({
    id,
    nameAr: 'برنامج الأمم المتحدة للبيئة',
    nameEn: 'United Nations Environment Programme',
    type: 'InternationalBody' as const,
    countryRegionAr: 'دولي',
    countryRegionEn: 'International',
    websiteUrl: 'https://www.unep.org',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

function buildValidSource(
  id = 'src-unep-verified',
  organizationId = 'org-unep',
  verificationStatus: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex' = 'Verified'
): LibrarySource {
  return Object.freeze({
    id,
    organizationId,
    sourceNameAr: 'مستودع برنامج الأمم المتحدة للبيئة الرسمي',
    sourceNameEn: 'Official UNEP Document Repository',
    sourceUrl: 'https://wedocs.unep.org',
    sourceType: 'InstitutionalArchive' as const,
    verificationStatus,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
}

function buildValidClassificationInput(
  overrides: Partial<CreateLibraryQuarantineCatalogDraftClassificationInput> = {}
): CreateLibraryQuarantineCatalogDraftClassificationInput {
  return Object.freeze({
    titleAr: 'خطة المرونة الساحلية الإقليمية 2026',
    titleEn: 'Regional Coastal Resilience Plan 2026',
    summaryAr:
      'ملخص تحريري مراجع بشرياً لوثيقة خطة المرونة الساحلية الإقليمية.',
    summaryEn:
      'Human-reviewed editorial summary of the regional coastal resilience plan.',
    documentType: LibraryDocumentType.PolicyPaper,
    organizationId: 'org-unep',
    sourceId: 'src-unep-verified',
    geographyAr: 'غرب آسيا وحوض المتوسط',
    geographyEn: 'West Asia and Mediterranean',
    publicationDate: '2026-05-15',
    language: 'bilingual' as const,
    topicsAr: ['التكيف المناخي', 'النظم البيئية الساحلية'],
    topicsEn: ['Climate Adaptation', 'Coastal Ecosystems'],
    environmentalDomains: ['Climate', 'Biodiversity'],
    legalStatusDescriptionAr: 'وثيقة سياسات إقليمية غير ملزمة قانونياً',
    legalStatusDescriptionEn: 'Non-binding regional policy guidance document',
    ...overrides,
  });
}

class InMemoryCatalogHandoffFirestore
  implements
    LibraryQuarantineFirestoreDatabase,
    LibraryQuarantineReviewDraftFirestoreDatabase
{
  readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  readonly readCountsByCollection = new Map<string, number>();
  readonly writeCountsByCollection = new Map<string, number>();
  readonly txOperationTrace: string[] = [];
  failOnCommitAfterStagedWrite = false;

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
    this.collections.set(LIBRARY_ORGANIZATIONS_COLLECTION, new Map());
    this.collections.set(LIBRARY_SOURCES_COLLECTION, new Map());
    this.collections.set(LIBRARY_DOCUMENTS_COLLECTION, new Map());
    this.collections.set(
      LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
      new Map()
    );
    this.collections.set(
      LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION,
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

  resetCounters(): void {
    this.readCountsByCollection.clear();
    this.writeCountsByCollection.clear();
    this.txOperationTrace.length = 0;
  }

  totalReadCount(): number {
    let total = 0;
    for (const count of this.readCountsByCollection.values()) {
      total += count;
    }
    return total;
  }

  totalWriteCount(): number {
    let total = 0;
    for (const count of this.writeCountsByCollection.values()) {
      total += count;
    }
    return total;
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
      ): LibraryQuarantineFirestoreDocumentRef & {
        readonly __collectionName: string;
        create(data: Record<string, unknown>): Promise<void>;
        set(data: Record<string, unknown>): Promise<void>;
      } => ({
        id: docId,
        __collectionName: collectionName,
        get: async (): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
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
            ref: LibraryQuarantineFirestoreDocumentRef,
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
          ref: LibraryQuarantineFirestoreDocumentRef,
          data: Record<string, unknown>
        ): void;
      } = {
      get: async (
        ref: LibraryQuarantineFirestoreDocumentRef
      ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
        if (anyWriteStaged) {
          throw new Error(
            'FIRESTORE_TX_ORDER_VIOLATION: Transaction reads must precede all writes.'
          );
        }
        const colName =
          (ref as unknown as { readonly __collectionName: string })
            .__collectionName;
        this.txOperationTrace.push(`get:${colName}/${ref.id}`);
        if (typeof ref.get !== 'function') {
          throw new Error('Document reference must provide get()');
        }
        return ref.get();
      },
      create: (
        ref: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        anyWriteStaged = true;
        const colName =
          (ref as unknown as { readonly __collectionName: string })
            .__collectionName;
        this.txOperationTrace.push(`create:${colName}/${ref.id}`);
        const cloned = deepClone(data);
        stagedOps.push(() => {
          const col = this.getOrCreateCollection(colName);
          if (col.has(ref.id)) {
            throw new Error(`TX_CREATE_ALREADY_EXISTS: ${colName}/${ref.id}`);
          }
          this.incrementWrite(colName);
          col.set(ref.id, cloned);
        });
      },
      update: (
        ref: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        anyWriteStaged = true;
        const colName =
          (ref as unknown as { readonly __collectionName: string })
            .__collectionName;
        this.txOperationTrace.push(`update:${colName}/${ref.id}`);
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
        ref: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        anyWriteStaged = true;
        const colName =
          (ref as unknown as { readonly __collectionName: string })
            .__collectionName;
        this.txOperationTrace.push(`set:${colName}/${ref.id}`);
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

class InMemoryLibraryRepository implements LibraryRepository {
  readonly documents = new Map<string, LibraryDocument>();

  async getById(id: string): Promise<LibraryDocument | null> {
    const doc = this.documents.get(id);
    return doc ? deepClone(doc) : null;
  }
  async create(doc: LibraryDocument): Promise<LibraryDocument> {
    this.documents.set(doc.id, deepClone(doc));
    return deepClone(doc);
  }
  async update(doc: LibraryDocument): Promise<LibraryDocument> {
    this.documents.set(doc.id, deepClone(doc));
    return deepClone(doc);
  }
  async listAll(): Promise<LibraryDocument[]> {
    return Array.from(this.documents.values()).map((d) => deepClone(d));
  }
}

function buildAdminRepository(
  usersByUid: Record<string, AdminUser | null>
): AdminRepository {
  return {
    getAdminByUid: async (uid: string): Promise<AdminUser | null> => {
      return usersByUid[uid] ?? null;
    },
    saveAdmin: async (admin: AdminUser): Promise<AdminUser> => admin,
    listAdmins: async (): Promise<AdminUser[]> => [],
  } as unknown as AdminRepository;
}

function enableAllCatalogHandoffEnvFlags(): void {
  process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR] = 'true';
  process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR] = 'true';
  process.env[LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR] = 'true';
}

function clearAllCatalogHandoffEnvFlags(): void {
  delete process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR];
  delete process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR];
  delete process.env[LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR];
}

function assertCatalogHandoffZeroLeakage(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  const lower = serialized.toLowerCase();
  const forbiddenTokens = [
    'storagepath',
    'sourcesha256',
    'createdby',
    'updatedby',
    'uploaderuid',
    'gs://',
    'library/quarantine/',
    'referenceurl',
    'downloadurl',
    'fileurl',
    'signedurl',
    'publicurl',
  ];
  for (const token of forbiddenTokens) {
    assert.equal(
      lower.includes(token),
      false,
      `Forbidden internal token "${token}" leaked in serialized DTO: ${serialized}`
    );
  }
  assert.equal(
    /"(?:attested)?generation"\s*:/i.test(serialized),
    false,
    `Forbidden generation key leaked in serialized DTO: ${serialized}`
  );
}

async function callManageLibraryWithCatalogDb(
  requestContext: {
    readonly auth?: {
      readonly uid: string;
      readonly token?: Record<string, unknown>;
    };
    readonly data: Record<string, unknown>;
  },
  adminRepo: AdminRepository,
  db: InMemoryCatalogHandoffFirestore,
  clock?: () => string
): Promise<unknown> {
  const dummyLibraryService = {} as unknown as LibraryApplicationService;
  return executeManageLibraryDocumentsRequest(
    requestContext,
    adminRepo,
    dummyLibraryService,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      draftDatabase: db,
      ...(clock !== undefined ? { catalogHandoffClock: clock } : {}),
    }
  );
}

async function runTests(): Promise<void> {
  let passed = 0;

  const users: Record<string, AdminUser> = {
    'admin-owner': {
      id: 'admin-owner',
      email: 'owner@promiseofplanet.org',
      name: 'Owner Admin',
      role: AdminRole.Owner,
      isActive: true,
    },
    'admin-curator': {
      id: 'admin-curator',
      email: 'curator@promiseofplanet.org',
      name: 'Library Curator',
      role: AdminRole.LibraryCurator,
      isActive: true,
    },
    'admin-rights-reviewer': {
      id: 'admin-rights-reviewer',
      email: 'rights@promiseofplanet.org',
      name: 'Rights Reviewer (Review only, no Create)',
      role: AdminRole.RightsReviewer,
      isActive: true,
    },
    'admin-create-only': {
      id: 'admin-create-only',
      email: 'create-only@promiseofplanet.org',
      name: 'Create Only Curator',
      role: AdminRole.LibraryCurator,
      permissions: [AdminPermission.View, AdminPermission.Create],
      isActive: true,
    },
    'admin-media': {
      id: 'admin-media',
      email: 'media@promiseofplanet.org',
      name: 'Media Manager',
      role: AdminRole.MediaManager,
      isActive: true,
    },
    'admin-policy': {
      id: 'admin-policy',
      email: 'policy@promiseofplanet.org',
      name: 'Policy Analyst',
      role: AdminRole.PolicyAnalyst,
      isActive: true,
    },
    'admin-ai': {
      id: 'admin-ai',
      email: 'ai@promiseofplanet.org',
      name: 'AI Assistant',
      role: AdminRole.AIAssistant,
      permissions: [
        AdminPermission.View,
        AdminPermission.Review,
        AdminPermission.Create,
      ],
      isActive: true,
    },
    'admin-inactive': {
      id: 'admin-inactive',
      email: 'inactive@promiseofplanet.org',
      name: 'Inactive Curator',
      role: AdminRole.LibraryCurator,
      isActive: false,
    },
  };

  const adminRepo = buildAdminRepository(users);

  // =========================================================================
  // TEST 1: Triple Server Release Gates (Default-Off & Fail-Closed Before Reads)
  // =========================================================================
  {
    const db = new InMemoryCatalogHandoffFirestore();
    const receiptId = buildHexReceiptId(1);
    let adminLookups = 0;
    const countingAdminRepo: AdminRepository = {
      getAdminByUid: async (uid: string) => {
        adminLookups += 1;
        return adminRepo.getAdminByUid(uid);
      },
      saveAdmin: async (admin: AdminUser) => admin,
      listAdmins: async () => [],
    } as unknown as AdminRepository;

    const flagCombinations: Array<
      [string | undefined, string | undefined, string | undefined]
    > = [
      [undefined, undefined, undefined],
      ['true', 'true', undefined],
      ['true', undefined, 'true'],
      [undefined, 'true', 'true'],
      ['true', 'true', 'false'],
      ['true', 'true', '1'],
    ];

    for (const [wb, hr, ch] of flagCombinations) {
      clearAllCatalogHandoffEnvFlags();
      if (wb !== undefined)
        process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR] = wb;
      if (hr !== undefined)
        process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR] = hr;
      if (ch !== undefined)
        process.env[LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR] = ch;

      await assert.rejects(
        async () =>
          callManageLibraryWithCatalogDb(
            {
              auth: { uid: 'admin-curator' },
              data: {
                action: 'getQuarantineCatalogHandoff',
                receiptId,
              },
            },
            countingAdminRepo,
            db
          ),
        (err: unknown) => {
          const e = err as { code?: string };
          return e.code === 'failed-precondition';
        }
      );

      await assert.rejects(
        async () =>
          callManageLibraryWithCatalogDb(
            {
              auth: { uid: 'admin-curator' },
              data: {
                action: 'createQuarantineCatalogDraft',
                receiptId,
                expectedCaseRevision: 1,
                input: buildValidClassificationInput(),
              },
            },
            countingAdminRepo,
            db
          ),
        (err: unknown) => {
          const e = err as { code?: string };
          return e.code === 'failed-precondition';
        }
      );
    }

    assert.equal(
      adminLookups,
      0,
      'Release gate check must fail-closed before any AdminRepository lookup'
    );
    assert.equal(
      db.totalReadCount(),
      0,
      'Release gate check must fail-closed before any Firestore read'
    );
    assert.equal(
      db.totalWriteCount(),
      0,
      'Release gate check must perform zero writes'
    );

    passed += 1;
    console.log(
      'PASS [1/8]: Triple server release gates default-off and fail-closed with 0 Admin/Firestore reads'
    );
  }

  // =========================================================================
  // TEST 2: Dual RBAC (Requires BOTH Review AND Create) & Untrusted Key Rejection
  // =========================================================================
  {
    enableAllCatalogHandoffEnvFlags();
    const db = new InMemoryCatalogHandoffFirestore();
    const receiptId = buildHexReceiptId(2);

    // Unauthenticated
    await assert.rejects(
      async () =>
        callManageLibraryWithCatalogDb(
          {
            auth: undefined,
            data: {
              action: 'getQuarantineCatalogHandoff',
              receiptId,
            },
          },
          adminRepo,
          db
        ),
      (err: unknown) => (err as { code?: string }).code === 'unauthenticated'
    );

    // Forbidden roles / partial permissions
    const forbiddenUids = [
      'admin-rights-reviewer', // Has Review, lacks Create
      'admin-create-only', // Has Create, lacks Review
      'admin-media', // MediaManager
      'admin-policy', // PolicyAnalyst
      'admin-ai', // AIAssistant even with explicit permissions
      'admin-inactive', // Inactive curator
      'admin-nonexistent', // Missing user
    ];

    for (const uid of forbiddenUids) {
      await assert.rejects(
        async () =>
          callManageLibraryWithCatalogDb(
            {
              auth: { uid },
              data: {
                action: 'getQuarantineCatalogHandoff',
                receiptId,
              },
            },
            adminRepo,
            db
          ),
        (err: unknown) =>
          (err as { code?: string }).code === 'permission-denied',
        `Expected permission-denied for getQuarantineCatalogHandoff by ${uid}`
      );

      await assert.rejects(
        async () =>
          callManageLibraryWithCatalogDb(
            {
              auth: { uid },
              data: {
                action: 'createQuarantineCatalogDraft',
                receiptId,
                expectedCaseRevision: 1,
                input: buildValidClassificationInput(),
              },
            },
            adminRepo,
            db
          ),
        (err: unknown) =>
          (err as { code?: string }).code === 'permission-denied',
        `Expected permission-denied for createQuarantineCatalogDraft by ${uid}`
      );
    }

    assert.equal(
      db.totalReadCount(),
      0,
      'Unauthorized callers must be rejected with 0 Firestore reads'
    );

    // Top-level untrusted caller fields -> rejected by callable handler with invalid-argument
    const topLevelUntrustedPayloads: Array<Record<string, unknown>> = [
      {
        action: 'createQuarantineCatalogDraft',
        receiptId,
        expectedCaseRevision: 1,
        input: buildValidClassificationInput(),
        uid: 'admin-owner',
      },
      {
        action: 'createQuarantineCatalogDraft',
        receiptId,
        expectedCaseRevision: 1,
        input: buildValidClassificationInput(),
        rightsStatus: 'OpenPubliclyAvailable',
      },
      {
        action: 'createQuarantineCatalogDraft',
        receiptId,
        expectedCaseRevision: 1,
        input: buildValidClassificationInput(),
        workflowState: 'Published',
      },
    ];

    for (const badData of topLevelUntrustedPayloads) {
      await assert.rejects(
        async () =>
          callManageLibraryWithCatalogDb(
            {
              auth: { uid: 'admin-curator' },
              data: badData,
            },
            adminRepo,
            db
          ),
        (err: unknown) => (err as { code?: string }).code === 'invalid-argument'
      );
    }

    // Nested untrusted fields inside `input` -> rejected by service with HOLD (0 Firestore reads/writes)
    const nestedUntrustedRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId,
          expectedCaseRevision: 1,
          input: {
            ...buildValidClassificationInput(),
            referenceUrl: 'https://evil.example/file.pdf',
          },
        },
      },
      adminRepo,
      db
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(nestedUntrustedRes.ok, false);
    assert.equal(nestedUntrustedRes.status, 'HOLD');
    if (nestedUntrustedRes.status === 'HOLD') {
      assert.equal(
        nestedUntrustedRes.errorCode,
        'UNTRUSTED_OR_FORBIDDEN_CLASSIFICATION_FIELD'
      );
    }
    assert.equal(db.totalReadCount(), 0);
    assert.equal(db.totalWriteCount(), 0);

    passed += 1;
    console.log(
      'PASS [2/8]: Dual RBAC (Review + Create required) and untrusted caller key rejection verified'
    );
  }

  // =========================================================================
  // TEST 3: Plain-Text Classification Input & Persisted Schema Validation
  // =========================================================================
  {
    const valid = validateCreateCatalogDraftClassificationInput(
      buildValidClassificationInput()
    );
    assert.equal(valid.ok, true);
    if (valid.ok) {
      assert.equal(valid.value.documentType, LibraryDocumentType.PolicyPaper);
      assert.equal(valid.value.language, 'bilingual');
      assert.equal(valid.value.organizationId, 'org-unep');
      assert.equal(valid.value.sourceId, 'src-unep-verified');
    }

    const invalidClassifications: unknown[] = [
      { ...buildValidClassificationInput(), documentType: 'InvalidType' },
      { ...buildValidClassificationInput(), language: 'fr' },
      {
        ...buildValidClassificationInput(),
        organizationId: '<script>alert(1)</script>',
      },
      {
        ...buildValidClassificationInput(),
        sourceId: 'javascript:alert(1)',
      },
      { ...buildValidClassificationInput(), publicationDate: '2026/05/15' },
      { ...buildValidClassificationInput(), publicationDate: '2026-02-30' },
      { ...buildValidClassificationInput(), topicsAr: [] },
      {
        ...buildValidClassificationInput(),
        topicsEn: ['<b>mena</b>'],
      },
      {
        ...buildValidClassificationInput(),
        environmentalDomains: ['data:text/html,evil'],
      },
      {
        ...buildValidClassificationInput(),
        legalStatusDescriptionEn: 'library/quarantine/secret/source.pdf',
      },
    ];

    for (const invalidInput of invalidClassifications) {
      const res = validateCreateCatalogDraftClassificationInput(invalidInput);
      assert.equal(
        res.ok,
        false,
        `Expected classification input to fail validation: ${JSON.stringify(invalidInput)}`
      );
    }

    passed += 1;
    console.log(
      'PASS [3/8]: Classification input validation rejects HTML, URI schemes, bad dates, and empty arrays'
    );
  }

  // =========================================================================
  // TEST 4: Prerequisite Hold & Verified Source Enforcement Inside Transaction
  // =========================================================================
  {
    enableAllCatalogHandoffEnvFlags();
    const db = new InMemoryCatalogHandoffFirestore();
    const org = buildValidOrganization('org-unep');
    const verifiedSource = buildValidSource(
      'src-unep-verified',
      'org-unep',
      'Verified'
    );
    const pendingSource = buildValidSource(
      'src-unep-pending',
      'org-unep',
      'PendingVerification'
    );
    const otherOrgSource = buildValidSource(
      'src-other-org',
      'org-other',
      'Verified'
    );

    db.seedDocument(
      LIBRARY_ORGANIZATIONS_COLLECTION,
      org.id,
      org as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_SOURCES_COLLECTION,
      verifiedSource.id,
      verifiedSource as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_SOURCES_COLLECTION,
      pendingSource.id,
      pendingSource as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_SOURCES_COLLECTION,
      otherOrgSource.id,
      otherOrgSource as unknown as Record<string, unknown>
    );

    // Case 4A: NeedsReconciliation receipt -> HOLD
    const reconSeed = buildSeededPipelineState(41, {
      receiptState: LibraryQuarantineReceiptState.NeedsReconciliation,
    });
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      reconSeed.receiptId,
      reconSeed.envelope as unknown as Record<string, unknown>
    );

    const reconRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: reconSeed.receiptId,
          expectedCaseRevision: 1,
          input: buildValidClassificationInput(),
        },
      },
      adminRepo,
      db
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(reconRes.status, 'HOLD');
    assert.equal(reconRes.documentCreated, false);
    if (reconRes.status === 'HOLD') {
      assert.equal(reconRes.errorCode, 'RECEIPT_NEEDS_RECONCILIATION');
    }

    // Case 4B: Human review case status is IN_REVIEW (not METADATA_RECORDED) -> HOLD
    const inReviewSeed = buildSeededPipelineState(42, {
      caseStatus: 'IN_REVIEW',
    });
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      inReviewSeed.receiptId,
      inReviewSeed.envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      inReviewSeed.receiptId,
      inReviewSeed.draft as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      inReviewSeed.receiptId,
      inReviewSeed.reviewCase as unknown as Record<string, unknown>
    );

    const inReviewRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: inReviewSeed.receiptId,
          expectedCaseRevision: 1,
          input: buildValidClassificationInput(),
        },
      },
      adminRepo,
      db
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(inReviewRes.status, 'HOLD');
    assert.equal(inReviewRes.documentCreated, false);
    if (inReviewRes.status === 'HOLD') {
      assert.equal(inReviewRes.errorCode, 'CASE_NOT_METADATA_RECORDED');
    }

    // Case 4C: PendingVerification source -> HOLD (SOURCE_NOT_VERIFIED)
    const readySeed = buildSeededPipelineState(43, {
      caseStatus: 'METADATA_RECORDED',
    });
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      readySeed.receiptId,
      readySeed.envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      readySeed.receiptId,
      readySeed.draft as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      readySeed.receiptId,
      readySeed.reviewCase as unknown as Record<string, unknown>
    );

    const pendingSourceRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: readySeed.receiptId,
          expectedCaseRevision: 1,
          input: buildValidClassificationInput({
            sourceId: 'src-unep-pending',
          }),
        },
      },
      adminRepo,
      db
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(pendingSourceRes.status, 'HOLD');
    assert.equal(pendingSourceRes.documentCreated, false);
    if (pendingSourceRes.status === 'HOLD') {
      assert.equal(pendingSourceRes.errorCode, 'SOURCE_NOT_VERIFIED');
    }

    // Case 4D: Source organizationId mismatch -> HOLD (SOURCE_ORGANIZATION_MISMATCH)
    const orgMismatchRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: readySeed.receiptId,
          expectedCaseRevision: 1,
          input: buildValidClassificationInput({
            sourceId: 'src-other-org',
          }),
        },
      },
      adminRepo,
      db
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(orgMismatchRes.status, 'HOLD');
    assert.equal(orgMismatchRes.documentCreated, false);
    if (orgMismatchRes.status === 'HOLD') {
      assert.equal(orgMismatchRes.errorCode, 'SOURCE_ORGANIZATION_MISMATCH');
    }

    assert.equal(
      db.totalWriteCount(),
      0,
      'Failed prerequisite and source verification checks must perform 0 Firestore writes'
    );

    passed += 1;
    console.log(
      'PASS [4/8]: Prerequisite hold states and Verified-only source checks enforced with 0 writes'
    );
  }

  // =========================================================================
  // TEST 5: Atomic 8-Read / 3-Create Transaction, Zero File URLs, Zero Upstream Mutation
  // =========================================================================
  {
    enableAllCatalogHandoffEnvFlags();
    const db = new InMemoryCatalogHandoffFirestore();
    const org = buildValidOrganization('org-unep');
    const verifiedSource = buildValidSource(
      'src-unep-verified',
      'org-unep',
      'Verified'
    );
    const seed = buildSeededPipelineState(50, {
      caseStatus: 'METADATA_RECORDED',
      caseRevision: 3,
    });

    db.seedDocument(
      LIBRARY_ORGANIZATIONS_COLLECTION,
      org.id,
      org as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_SOURCES_COLLECTION,
      verifiedSource.id,
      verifiedSource as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      seed.receiptId,
      seed.envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      seed.receiptId,
      seed.draft as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      seed.receiptId,
      seed.reviewCase as unknown as Record<string, unknown>
    );

    // Pre-check getQuarantineCatalogHandoff returns READY with 5 point reads and 0 writes
    db.resetCounters();
    const readyRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'getQuarantineCatalogHandoff',
          receiptId: seed.receiptId,
        },
      },
      adminRepo,
      db
    )) as GetLibraryQuarantineCatalogHandoffResponseDto;

    assert.equal(readyRes.ok, true);
    assert.equal(readyRes.status, 'READY');
    if (readyRes.ok) {
      assert.equal(readyRes.handoffExists, false);
      assert.equal(readyRes.handoff, null);
      assert.equal(readyRes.catalogDocument, null);
      assert.equal(readyRes.isEligibleForHandoff, true);
      assert.equal(readyRes.currentCaseRevision, 3);
    }
    assert.equal(db.totalReadCount(), 5);
    assert.equal(db.totalWriteCount(), 0);

    // Execute createQuarantineCatalogDraft
    db.resetCounters();
    const createRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: seed.receiptId,
          expectedCaseRevision: 3,
          input: buildValidClassificationInput(),
        },
      },
      adminRepo,
      db,
      () => '2026-11-09T10:30:00.000Z'
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(createRes.ok, true);
    assert.equal(createRes.status, 'HANDOFF_RECORDED');
    assert.equal(createRes.documentCreated, true);
    if (createRes.status === 'HANDOFF_RECORDED') {
      assert.equal(createRes.disposition, 'CREATED');
      assert.equal(createRes.documentCreationOutcome, 'CREATED');
      assert.equal(createRes.receiptId, seed.receiptId);
    }

    // Verify exact 8 reads before 3 creates in single transaction
    assert.equal(
      db.totalReadCount(),
      8,
      'createQuarantineCatalogDraft must perform exactly 8 point reads'
    );
    assert.equal(
      db.totalWriteCount(),
      3,
      'createQuarantineCatalogDraft must perform exactly 3 creates'
    );

    const expectedDocumentId = deriveQuarantineCatalogDocumentId(seed.receiptId);
    assert.equal(
      expectedDocumentId,
      `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${seed.receiptId}`
    );
    assert.deepEqual(db.txOperationTrace, [
      `get:${LIBRARY_QUARANTINE_RECEIPTS_COLLECTION}/${seed.receiptId}`,
      `get:${LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION}/${seed.receiptId}`,
      `get:${LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION}/${seed.receiptId}`,
      `get:${LIBRARY_ORGANIZATIONS_COLLECTION}/org-unep`,
      `get:${LIBRARY_SOURCES_COLLECTION}/src-unep-verified`,
      `get:${LIBRARY_DOCUMENTS_COLLECTION}/${expectedDocumentId}`,
      `get:${LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION}/${seed.receiptId}`,
      `get:${LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION}/${seed.receiptId}`,
      `create:${LIBRARY_DOCUMENTS_COLLECTION}/${expectedDocumentId}`,
      `create:${LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION}/${seed.receiptId}`,
      `create:${LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION}/${seed.receiptId}`,
    ]);

    // Verify persisted records
    const rawDoc = db.readDocumentRaw(
      LIBRARY_DOCUMENTS_COLLECTION,
      expectedDocumentId
    );
    const rawHandoff = db.readDocumentRaw(
      LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
      seed.receiptId
    );
    const rawEvent = db.readDocumentRaw(
      LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION,
      seed.receiptId
    );

    assert.ok(rawDoc, 'LibraryDocument must be persisted');
    assert.ok(rawHandoff, 'CatalogHandoff must be persisted');
    assert.ok(rawEvent, 'CatalogHandoffEvent must be persisted');

    const validatedDocRes = validatePersistedCatalogDraftDocument(
      rawDoc,
      expectedDocumentId
    );
    assert.equal(validatedDocRes.ok, true);
    if (validatedDocRes.ok) {
      assert.equal(validatedDocRes.catalogDocument.id, expectedDocumentId);
      assert.equal(
        validatedDocRes.catalogDocument.workflowState,
        WorkflowState.Draft
      );
      assert.equal(
        validatedDocRes.catalogDocument.rightsStatus,
        LibraryRightsStatus.ReviewRequired
      );
      assert.equal(validatedDocRes.catalogDocument.versions.length, 1);
    }
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        rawDoc.versions ? (rawDoc.versions as unknown[])[0] : {},
        'referenceUrl'
      ),
      false,
      'Persisted LibraryDocument version must not have referenceUrl property'
    );

    const validatedHandoffRes = validatePersistedLibraryQuarantineCatalogHandoff(
      rawHandoff,
      seed.receiptId
    );
    assert.equal(validatedHandoffRes.ok, true);
    if (validatedHandoffRes.ok) {
      assert.equal(validatedHandoffRes.handoff.documentId, expectedDocumentId);
      assert.equal(validatedHandoffRes.handoff.isSanitized, false);
      assert.equal(validatedHandoffRes.handoff.isVerifiedSafe, false);
      assert.equal(validatedHandoffRes.handoff.isRightsApproved, false);
      assert.equal(validatedHandoffRes.handoff.isPublished, false);
      assert.equal(validatedHandoffRes.handoff.isReadyForPeia, false);
    }

    const validatedEventRes =
      validatePersistedLibraryQuarantineCatalogHandoffEvent(
        rawEvent,
        seed.receiptId
      );
    assert.equal(validatedEventRes.ok, true);
    if (validatedEventRes.ok) {
      assert.equal(
        validatedEventRes.handoffEvent.eventType,
        'CATALOG_DRAFT_CREATED'
      );
      assert.equal(validatedEventRes.handoffEvent.actorUid, 'admin-curator');
    }

    // Verify zero mutation of upstream collections
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
    assert.equal(
      db.writeCountsByCollection.get(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION
      ) ?? 0,
      0
    );

    // Verify zero leakage in response DTO
    assertCatalogHandoffZeroLeakage(createRes);

    passed += 1;
    console.log(
      'PASS [5/8]: Atomic 8-read/3-create transaction, zero file URLs, and zero leakage verified'
    );
  }

  // =========================================================================
  // TEST 6: Idempotency, CAS Conflict, Classification Conflict, and Commit Uncertainty
  // =========================================================================
  {
    enableAllCatalogHandoffEnvFlags();
    const db = new InMemoryCatalogHandoffFirestore();
    const org = buildValidOrganization('org-unep');
    const verifiedSource = buildValidSource(
      'src-unep-verified',
      'org-unep',
      'Verified'
    );
    const secondVerifiedSource = buildValidSource(
      'src-unep-verified-2',
      'org-unep',
      'Verified'
    );
    const seed = buildSeededPipelineState(60, {
      caseStatus: 'METADATA_RECORDED',
      caseRevision: 2,
    });

    db.seedDocument(
      LIBRARY_ORGANIZATIONS_COLLECTION,
      org.id,
      org as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_SOURCES_COLLECTION,
      verifiedSource.id,
      verifiedSource as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_SOURCES_COLLECTION,
      secondVerifiedSource.id,
      secondVerifiedSource as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      seed.receiptId,
      seed.envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      seed.receiptId,
      seed.draft as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      seed.receiptId,
      seed.reviewCase as unknown as Record<string, unknown>
    );

    // 6A: CAS mismatch before creation -> CASE_REVISION_CONFLICT with 0 writes
    db.resetCounters();
    const casConflictRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: seed.receiptId,
          expectedCaseRevision: 1, // actual is 2
          input: buildValidClassificationInput(),
        },
      },
      adminRepo,
      db,
      () => '2026-11-09T10:30:00.000Z'
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(casConflictRes.status, 'CONFLICT');
    assert.equal(casConflictRes.documentCreated, false);
    if (casConflictRes.status === 'CONFLICT') {
      assert.equal(casConflictRes.errorCode, 'CASE_REVISION_CONFLICT');
      assert.equal(casConflictRes.currentCaseRevision, 2);
    }
    assert.equal(db.totalWriteCount(), 0);

    // 6B: Initial creation -> CREATED
    await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: seed.receiptId,
          expectedCaseRevision: 2,
          input: buildValidClassificationInput(),
        },
      },
      adminRepo,
      db,
      () => '2026-11-09T10:30:00.000Z'
    );

    // 6C: Idempotent retry with matching expectedCaseRevision, organizationId, sourceId -> IDEMPOTENT_EXISTING with 0 writes
    db.resetCounters();
    const idempotentRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-owner' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: seed.receiptId,
          expectedCaseRevision: 2,
          input: buildValidClassificationInput(),
        },
      },
      adminRepo,
      db,
      () => '2026-11-09T10:35:00.000Z'
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(idempotentRes.status, 'HANDOFF_RECORDED');
    assert.equal(idempotentRes.documentCreated, false);
    if (idempotentRes.status === 'HANDOFF_RECORDED') {
      assert.equal(idempotentRes.disposition, 'IDEMPOTENT_EXISTING');
      assert.equal(
        idempotentRes.documentCreationOutcome,
        'IDEMPOTENT_EXISTING'
      );
    }
    assert.equal(db.totalWriteCount(), 0);

    // 6D: Retry with different sourceId after handoff exists -> HANDOFF_ALREADY_EXISTS_CONFLICT with 0 writes
    db.resetCounters();
    const handoffConflictRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-owner' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: seed.receiptId,
          expectedCaseRevision: 2,
          input: buildValidClassificationInput({
            sourceId: 'src-unep-verified-2',
          }),
        },
      },
      adminRepo,
      db,
      () => '2026-11-09T10:36:00.000Z'
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;

    assert.equal(handoffConflictRes.status, 'CONFLICT');
    assert.equal(handoffConflictRes.documentCreated, false);
    if (handoffConflictRes.status === 'CONFLICT') {
      assert.equal(
        handoffConflictRes.errorCode,
        'HANDOFF_ALREADY_EXISTS_CONFLICT'
      );
    }
    assert.equal(db.totalWriteCount(), 0);

    // 6E: Commit uncertainty after staged writes -> UNKNOWN with documentCreated: null
    const uncertainSeed = buildSeededPipelineState(61, {
      caseStatus: 'METADATA_RECORDED',
      caseRevision: 1,
    });
    db.seedDocument(
      LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
      uncertainSeed.receiptId,
      uncertainSeed.envelope as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
      uncertainSeed.receiptId,
      uncertainSeed.draft as unknown as Record<string, unknown>
    );
    db.seedDocument(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      uncertainSeed.receiptId,
      uncertainSeed.reviewCase as unknown as Record<string, unknown>
    );

    db.failOnCommitAfterStagedWrite = true;
    const unknownRes = (await callManageLibraryWithCatalogDb(
      {
        auth: { uid: 'admin-curator' },
        data: {
          action: 'createQuarantineCatalogDraft',
          receiptId: uncertainSeed.receiptId,
          expectedCaseRevision: 1,
          input: buildValidClassificationInput(),
        },
      },
      adminRepo,
      db,
      () => '2026-11-09T10:40:00.000Z'
    )) as CreateLibraryQuarantineCatalogDraftResponseDto;
    db.failOnCommitAfterStagedWrite = false;

    assert.equal(unknownRes.status, 'UNKNOWN');
    assert.equal(unknownRes.documentCreated, null);
    if (unknownRes.status === 'UNKNOWN') {
      assert.equal(unknownRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
      assert.equal(unknownRes.documentCreationOutcome, 'UNKNOWN');
    }

    passed += 1;
    console.log(
      'PASS [6/8]: Idempotency, CAS conflict, handoff conflict, and UNKNOWN commit uncertainty verified'
    );
  }

  // =========================================================================
  // TEST 7: Independent Publication & Lifecycle Guards in LibraryApplicationService
  // =========================================================================
  {
    const repo = new InMemoryLibraryRepository();
    const receiptId = buildHexReceiptId(70);
    const qcatDocId = deriveQuarantineCatalogDocumentId(receiptId);
    assert.equal(isQuarantineCatalogDocumentId(qcatDocId), true);
    assert.equal(isQuarantineCatalogDocumentId('doc-standard-123'), false);

    const qcatDoc: LibraryDocument = {
      id: qcatDocId,
      titleAr: 'مسودة مكتبة من الحجر الصحي',
      titleEn: 'Quarantine Catalog Draft Document',
      summaryAr: 'ملخص عربي للمسودة.',
      summaryEn: 'English summary of the draft.',
      documentType: LibraryDocumentType.PolicyPaper,
      language: 'bilingual',
      organizationId: 'org-unep',
      sourceId: 'src-unep-verified',
      geographyAr: 'غرب آسيا',
      geographyEn: 'West Asia',
      publicationDate: '2026-05-15',
      topicsAr: ['التكيف المناخي'],
      topicsEn: ['Climate Adaptation'],
      environmentalDomains: ['Climate'],
      rightsStatus: LibraryRightsStatus.ReviewRequired,
      workflowState: WorkflowState.Draft,
      workflowHistory: [],
      legalStatusDescriptionAr: 'وثيقة سياسات غير ملزمة',
      legalStatusDescriptionEn: 'Non-binding policy document',
      createdAt: '2026-11-09T10:30:00.000Z',
      updatedAt: '2026-11-09T10:30:00.000Z',
      versions: [
        {
          id: `ver-${qcatDocId}-1`,
          documentId: qcatDocId,
          versionNumber: '1.0',
          publishedDate: '2026-05-15',
          changeDescriptionAr: 'إنشاء مسودة أولية',
          changeDescriptionEn: 'Initial draft created',
        },
      ],
    };

    await repo.create(qcatDoc);
    const service = new LibraryApplicationService(repo);
    const ownerUser = users['admin-owner'];

    // 7A: Direct create with qcat- prefix is blocked
    await assert.rejects(
      async () =>
        service.create(
          {
            ...buildValidClassificationInput(),
            id: deriveQuarantineCatalogDocumentId(buildHexReceiptId(71)),
          },
          ownerUser
        ),
      /qcat-|quarantine catalog handoff/i
    );

    // 7B: transitionWorkflow on qcat- document is blocked
    await assert.rejects(
      async () =>
        service.transitionWorkflow(
          qcatDocId,
          WorkflowState.InReview,
          'Attempt to move quarantine draft to review',
          ownerUser
        ),
      /quarantine|cannot transition|Draft/i
    );

    // 7C: updateRights on qcat- document is blocked
    await assert.rejects(
      async () =>
        service.updateRights(
          qcatDocId,
          LibraryRightsStatus.OpenPubliclyAvailable,
          'ملاحظات',
          'Notes',
          ownerUser
        ),
      /quarantine|ReviewRequired|rights status/i
    );

    // 7D: addVersion on qcat- document is blocked
    await assert.rejects(
      async () =>
        service.addVersion(
          qcatDocId,
          {
            versionNumber: '2.0',
            publishedDate: '2026-05-16',
            changeDescriptionAr: 'محاولة إرفاق رابط',
            changeDescriptionEn: 'Attempt to attach referenceUrl',
            referenceUrl: 'https://evil.example/leak.pdf',
          },
          ownerUser
        ),
      /quarantine|versions|referenceUrl/i
    );

    // 7E: updateMetadata on qcat- document is allowed for descriptive metadata while preserving Draft + ReviewRequired + no referenceUrl
    const updatedDoc = await service.updateMetadata(
      qcatDocId,
      {
        titleEn: 'Updated Quarantine Catalog Draft Title',
      },
      ownerUser
    );
    assert.equal(updatedDoc.titleEn, 'Updated Quarantine Catalog Draft Title');
    assert.equal(updatedDoc.workflowState, WorkflowState.Draft);
    assert.equal(
      updatedDoc.rightsStatus,
      LibraryRightsStatus.ReviewRequired
    );
    assert.deepEqual(updatedDoc.workflowHistory, []);
    assert.equal(updatedDoc.versions[0].referenceUrl, undefined);

    passed += 1;
    console.log(
      'PASS [7/8]: LibraryApplicationService blocks create/transitionWorkflow/updateRights/addVersion on qcat-* documents'
    );
  }

  // =========================================================================
  // TEST 8: PublicLibraryRepository Excludes qcat-* Documents Even If Tampered
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(80);
    const qcatDocId = deriveQuarantineCatalogDocumentId(receiptId);

    const tamperedQcatDoc: LibraryDocument = {
      id: qcatDocId,
      titleAr: 'وثيقة مسربة',
      titleEn: 'Tampered Quarantine Document',
      summaryAr: 'ملخص',
      summaryEn: 'Summary',
      documentType: LibraryDocumentType.PolicyPaper,
      language: 'bilingual',
      organizationId: 'org-unep',
      sourceId: 'src-unep-verified',
      geographyAr: 'غرب آسيا',
      geographyEn: 'West Asia',
      publicationDate: '2026-05-15',
      topicsAr: ['مناخ'],
      topicsEn: ['Climate'],
      environmentalDomains: ['Climate'],
      rightsStatus: LibraryRightsStatus.OpenPubliclyAvailable,
      workflowState: WorkflowState.Published,
      workflowHistory: [],
      legalStatusDescriptionAr: 'وصف',
      legalStatusDescriptionEn: 'Description',
      createdAt: '2026-11-09T10:30:00.000Z',
      updatedAt: '2026-11-09T10:30:00.000Z',
      versions: [],
    };

    const legitimatePublicDoc: LibraryDocument = {
      ...tamperedQcatDoc,
      id: 'doc-public-legitimate-01',
      titleEn: 'Legitimate Published Document',
    };

    const repo = new InMemoryLibraryRepository();
    await repo.create(tamperedQcatDoc);
    await repo.create(legitimatePublicDoc);

    const publicRepo = new PublicLibraryRepository(repo);
    const publicDocs = await publicRepo.listPublicDocuments();

    assert.equal(publicDocs.length, 1);
    assert.equal(publicDocs[0].id, 'doc-public-legitimate-01');
    assert.equal(
      publicDocs.some((d) => isQuarantineCatalogDocumentId(d.id)),
      false,
      'PublicLibraryRepository must never expose qcat-* documents'
    );

    passed += 1;
    console.log(
      'PASS [8/8]: PublicLibraryRepository excludes qcat-* documents even if tampered to Published'
    );
  }

  console.log(
    `\nALL ${passed}/8 QUARANTINE CATALOG HANDOFF BACKEND TESTS PASSED.`
  );
}

runTests().catch((err: unknown) => {
  console.error('QUARANTINE CATALOG HANDOFF BACKEND TESTS FAILED:', err);
  process.exitCode = 1;
});
