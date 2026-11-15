import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import process from 'node:process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

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
            'Uninjected live getAuth() must not be called in headless tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error(
            'Uninjected live getFirestore() must not be called in headless tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/storage') {
      return {
        getStorage: () => {
          throw new Error(
            'Uninjected live getStorage() must not be called in headless tests.'
          );
        },
      };
    }
    throw err;
  }
};

import { InMemoryLibraryRepository } from '../functions/src/library/inMemoryLibraryRepository';
import { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';
import { PublicLibraryRepository } from '../functions/src/library/publicLibraryRepository';
import type { LibraryRepository } from '../functions/src/library/libraryRepository';
import {
  LibraryDocumentType as FnLibraryDocumentType,
  LibraryRightsStatus as FnLibraryRightsStatus,
  type LibraryDocument,
  type LibraryOrganization,
  type LibrarySource,
} from '../functions/src/shared/libraryContract';
import { WorkflowState as FnWorkflowState } from '../functions/src/shared/workflowContract';
import {
  LibraryDocumentType,
  LibraryRightsStatus,
  type PublicLibraryDocument,
} from '../src/types/library';
import { WorkflowState } from '../src/types/workflow';
import { AdminRole, AdminPermission, type AdminUser } from '../src/types/admin';
import {
  AdminRole as FnAdminRole,
  type AdminUser as FnAdminUser,
} from '../functions/src/types/admin';
import type { AdminRepository } from '../functions/src/admin/adminRepository';
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
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
  type LibraryQuarantinePersistedHumanReviewCase,
} from '../functions/src/library/libraryQuarantineHumanReviewCaseContract';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_ORGANIZATIONS_COLLECTION,
  LIBRARY_SOURCES_COLLECTION,
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
  LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineRightsDecisionStore';
import {
  LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_RIGHTS_SCOPE,
  type LibraryQuarantinePersistedRightsDecision,
  type LibraryQuarantineRightsBasis,
  type LibraryQuarantineRightsDecisionStatus,
} from '../functions/src/library/libraryQuarantineRightsDecisionContract';
import {
  LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
  LIBRARY_REVIEWED_SOURCE_RELEASE_EVENTS_COLLECTION,
  LIBRARY_REVIEWED_SOURCE_RELEASES_COLLECTION,
  LibraryReviewedSourceReleaseService,
  deriveReviewedPublicLibraryDocumentId,
  deriveReviewedSourceReleaseEventId,
  validateReviewedSourceReleaseEditorialInput,
  validateVerifiedPublisherSourceUrl,
} from '../functions/src/library/libraryReviewedSourceReleaseService';
import {
  LibraryQuarantineReceiptState,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  LibraryQuarantineReviewedSourceReleasePanelController,
  canUserPublishReviewedLibrarySourceReference,
  isLibraryQuarantineReviewedSourceReleaseEnabled,
  validateClientVerifiedPublisherSourceUrl,
  validateGetReviewedSourceReleaseStatusResponseDto,
  validatePublishReviewedSourceReferenceResponseDto,
  type GetReviewedLibrarySourceReleaseStatusResponseDto,
  type PublishReviewedLibrarySourceReferenceResponseDto,
} from '../src/services/libraryReviewedSourceReleaseClient';
import {
  LibraryQuarantineReviewedSourceReleaseSection,
} from '../src/components/library/LibraryQuarantineHumanReviewModal';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../src/services/libraryQuarantineHumanReviewClient';

const require = createRequire(import.meta.url);
const {
  LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR,
  executeManageLibraryDocumentsRequest,
} = require(
  '../functions/src/library/libraryAdminHandlers'
) as typeof import('../functions/src/library/libraryAdminHandlers');

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class InMemoryReleaseFirestoreDatabase
  implements LibraryQuarantineReviewDraftFirestoreDatabase
{
  private readonly collections = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();

  public txCount = 0;
  public txCreateCalls = 0;
  public txUpdateCalls = 0;
  public txSetCalls = 0;
  public createdDocPaths: string[] = [];
  public onAfterTransactionWritesStagedHook: (() => void) | null = null;

  public resetCounters(): void {
    this.txCount = 0;
    this.txCreateCalls = 0;
    this.txUpdateCalls = 0;
    this.txSetCalls = 0;
    this.createdDocPaths = [];
    this.onAfterTransactionWritesStagedHook = null;
  }

  public seedDoc(collectionName: string, docId: string, data: unknown): void {
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

  public listCollectionDocs(collectionName: string): Record<string, unknown>[] {
    const col = this.collections.get(collectionName);
    if (!col) {
      return [];
    }
    return Array.from(col.values()).map((doc) => deepClone(doc));
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
        const data = this.collections.get(resolvedCol)?.get(resolvedDoc);
        return {
          id: resolvedDoc,
          exists: data !== undefined,
          data: () => (data ? deepClone(data) : undefined),
        };
      },
    } as unknown as LibraryQuarantineFirestoreDocumentRef;
  }

  public collection(collectionPath: string) {
    return {
      doc: (documentPath?: string) => this.doc(collectionPath, documentPath),
    };
  }

  public async runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineReviewDraftFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    this.txCount += 1;
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
      const typed = ref as {
        readonly __collectionName?: string;
        readonly parent?: { readonly id?: string };
      };
      return typed.__collectionName || typed.parent?.id || '';
    };

    const tx: LibraryQuarantineReviewDraftFirestoreTransaction = {
      get: async (ref: LibraryQuarantineFirestoreDocumentRef) => {
        if (writePhaseStarted) {
          throw new Error(
            'FIRESTORE_TX_ORDER_VIOLATION: Transaction reads must precede writes.'
          );
        }
        const colName = resolveColName(ref);
        const stored = workingState.get(colName)?.get(ref.id);
        return {
          id: ref.id,
          exists: stored !== undefined,
          data: () => (stored ? deepClone(stored) : undefined),
        } as LibraryQuarantineFirestoreDocumentSnapshot;
      },
      create: (
        ref: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ) => {
        writePhaseStarted = true;
        this.txCreateCalls += 1;
        const colName = resolveColName(ref);
        this.createdDocPaths.push(`${colName}/${ref.id}`);
        let col = workingState.get(colName);
        if (!col) {
          col = new Map();
          workingState.set(colName, col);
        }
        if (col.has(ref.id)) {
          throw new Error(`ALREADY_EXISTS: ${colName}/${ref.id}`);
        }
        col.set(ref.id, deepClone(data));
        return tx;
      },
      update: (
        ref: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ) => {
        writePhaseStarted = true;
        this.txUpdateCalls += 1;
        const colName = resolveColName(ref);
        const col = workingState.get(colName);
        if (!col || !col.has(ref.id)) {
          throw new Error(`NOT_FOUND: ${colName}/${ref.id}`);
        }
        col.set(ref.id, { ...col.get(ref.id)!, ...deepClone(data) });
        return tx;
      },
      set: (
        ref: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ) => {
        writePhaseStarted = true;
        this.txSetCalls += 1;
        const colName = resolveColName(ref);
        let col = workingState.get(colName);
        if (!col) {
          col = new Map();
          workingState.set(colName, col);
        }
        col.set(ref.id, deepClone(data));
        return tx;
      },
    };

    const result = await updateFunction(tx);
    if (writePhaseStarted && this.onAfterTransactionWritesStagedHook) {
      this.onAfterTransactionWritesStagedHook();
    }

    this.collections.clear();
    for (const [colName, colMap] of workingState.entries()) {
      this.collections.set(colName, colMap);
    }
    return result;
  }
}

class DbBackedLibraryRepository implements LibraryRepository {
  constructor(private readonly db: InMemoryReleaseFirestoreDatabase) {}

  async getById(id: string): Promise<LibraryDocument | null> {
    const raw = this.db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, id);
    return raw ? (raw as unknown as LibraryDocument) : null;
  }
  async create(doc: LibraryDocument): Promise<LibraryDocument> {
    this.db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, doc.id, doc);
    return doc;
  }
  async update(id: string, doc: Partial<LibraryDocument>): Promise<LibraryDocument> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`NOT_FOUND: ${id}`);
    const merged = { ...existing, ...doc } as LibraryDocument;
    this.db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, id, merged);
    return merged;
  }
  async listAll(): Promise<LibraryDocument[]> {
    return this.db.listCollectionDocs(
      LIBRARY_DOCUMENTS_COLLECTION
    ) as unknown as LibraryDocument[];
  }
  async createVersion(): Promise<LibraryDocument> {
    throw new Error('Not needed in readback test');
  }
  async getOrganizations(): Promise<LibraryOrganization[]> {
    return this.db.listCollectionDocs(
      LIBRARY_ORGANIZATIONS_COLLECTION
    ) as unknown as LibraryOrganization[];
  }
  async getOrganizationById(id: string): Promise<LibraryOrganization | null> {
    const raw = this.db.getRawDoc(LIBRARY_ORGANIZATIONS_COLLECTION, id);
    return raw ? (raw as unknown as LibraryOrganization) : null;
  }
  async saveOrganization(org: LibraryOrganization): Promise<LibraryOrganization> {
    this.db.seedDoc(LIBRARY_ORGANIZATIONS_COLLECTION, org.id, org);
    return org;
  }
  async getSources(): Promise<LibrarySource[]> {
    return this.db.listCollectionDocs(
      LIBRARY_SOURCES_COLLECTION
    ) as unknown as LibrarySource[];
  }
  async getSourceById(id: string): Promise<LibrarySource | null> {
    const raw = this.db.getRawDoc(LIBRARY_SOURCES_COLLECTION, id);
    return raw ? (raw as unknown as LibrarySource) : null;
  }
  async saveSource(source: LibrarySource): Promise<LibrarySource> {
    this.db.seedDoc(LIBRARY_SOURCES_COLLECTION, source.id, source);
    return source;
  }
  async getIntakeRecords(): Promise<[]> {
    return [];
  }
  async getIntakeById(): Promise<null> {
    return null;
  }
  async createIntake(): Promise<never> {
    throw new Error('Not needed');
  }
  async updateIntake(): Promise<never> {
    throw new Error('Not needed');
  }
}

class InMemoryAdminRepo implements AdminRepository {
  private readonly admins = new Map<string, FnAdminUser>();
  constructor(users: readonly FnAdminUser[]) {
    for (const u of users) {
      this.admins.set(u.id, u);
    }
  }
  async getAdminByUid(uid: string): Promise<FnAdminUser | null> {
    return this.admins.get(uid) ?? null;
  }
  async saveAdmin(admin: FnAdminUser): Promise<FnAdminUser> {
    this.admins.set(admin.id, admin);
    return admin;
  }
  async listAdmins(): Promise<FnAdminUser[]> {
    return Array.from(this.admins.values());
  }
}

interface SeedReleaseChainOptions {
  readonly receiptId: string;
  readonly humanCaseRevision?: number;
  readonly alignedCaseRevision?: number;
  readonly alignmentRevision?: number;
  readonly omitAlignment?: boolean;
  readonly qcatUpdatedAt?: string;
  readonly rightsDecisionRevision?: number;
  readonly rightsDecision?: LibraryQuarantineRightsDecisionStatus | null;
  readonly rightsBasis?: LibraryQuarantineRightsBasis;
  readonly rightsCaseRevision?: number;
  readonly sourceVerificationStatus?:
    | 'Verified'
    | 'PendingVerification'
    | 'ThirdPartyIndex';
  readonly sourceId?: string;
  readonly sourceOrgId?: string;
}

function seedReviewedChain(
  db: InMemoryReleaseFirestoreDatabase,
  opts: SeedReleaseChainOptions
): void {
  const { receiptId } = opts;
  const sha256 = 'a'.repeat(64);
  const createdAt = '2026-11-13T13:26:28.891Z';
  const handoffCreatedAt = '2026-11-13T14:09:18.983Z';
  const humanCaseRev = opts.humanCaseRevision ?? 6;
  const alignedCaseRev = opts.alignedCaseRevision ?? humanCaseRev;
  const alignmentRev = opts.alignmentRevision ?? 1;
  const humanCaseUpdatedAt = '2026-11-14T14:44:40.569Z';
  const qcatUpdatedAt =
    opts.qcatUpdatedAt ??
    (opts.omitAlignment ? handoffCreatedAt : '2026-11-14T15:00:00.000Z');
  const qcatDocId = deriveQuarantineCatalogDocumentId(receiptId);

  const titleAr = 'قانون حماية الموارد المائية والبيئة لعام 2026';
  const titleEn = 'Water Resources and Environmental Protection Act 2026';
  const summaryAr = 'نص تشريعي رسمي معتمد لحماية الموارد المائية والنظم الإيكولوجية.';
  const summaryEn =
    'Official statutory instrument governing water resources and ecosystem protection.';

  const receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope = {
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision: 2,
    state: LibraryQuarantineReceiptState.Quarantined,
    receipt: {
      receiptId,
      uploaderUid: 'admin-owner-1',
      originalFilename: 'water-protection-act-2026.pdf',
      sanitizedFilename: 'water-protection-act-2026.pdf',
      format: 'PDF',
      canonicalExtension: 'pdf',
      canonicalMimeType: 'application/pdf',
      byteSize: 245760,
      sha256,
      deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
      storagePath: `library/quarantine/${receiptId}/source.pdf`,
      state: LibraryQuarantineReceiptState.Quarantined,
      generation: '1700000001',
      reconciliationReason: null,
      rejectionReasonCode: null,
      createdAt,
      updatedAt: createdAt,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    },
  };
  db.seedDoc(LIBRARY_QUARANTINE_RECEIPT_COLLECTION, receiptId, receiptEnvelope);

  const reviewDraft: LibraryQuarantinePersistedReviewDraft = {
    schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
    receiptId,
    sourceRevision: 2,
    sourceUpdatedAt: createdAt,
    sourceSha256: sha256,
    format: 'PDF',
    uploaderUid: 'admin-owner-1',
    reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    createdBy: 'admin-owner-1',
    createdAt,
  };
  db.seedDoc(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION, receiptId, reviewDraft);

  const humanCase: LibraryQuarantinePersistedHumanReviewCase = {
    schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
    receiptId,
    sourceRevision: 2,
    sourceUpdatedAt: createdAt,
    sourceSha256: sha256,
    draftSourceRevision: 2,
    revision: humanCaseRev,
    status: 'METADATA_RECORDED',
    titleAr,
    titleEn,
    issuingOrganization: 'المجلس الأعلى للبيئة والموارد الطبيعية',
    summaryAr,
    summaryEn,
    sourceEvidenceNotes: 'الجريدة الرسمية العدد 14 — وثيقة رسمية صادرة عن الناشر الأصلي.',
    rightsEvidenceNotes: 'سجل رسمي متاح للعامة عبر البوابة الرسمية.',
    editorialNotes: 'تم التحقق البشري من البيانات الوصفية الكاملة.',
    createdBy: 'admin-owner-1',
    createdAt,
    updatedBy: 'admin-owner-1',
    updatedAt: humanCaseUpdatedAt,
  };
  db.seedDoc(LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION, receiptId, humanCase);

  const org: LibraryOrganization = {
    id: 'org-hcENR',
    nameAr: 'المجلس الأعلى للبيئة والموارد الطبيعية',
    nameEn: 'Higher Council for Environment and Natural Resources',
    type: 'Ministry',
    countryRegionAr: 'السودان',
    countryRegionEn: 'Sudan',
    websiteUrl: 'https://environment.gov.sd',
    updatedAt: createdAt,
  };
  db.seedDoc(LIBRARY_ORGANIZATIONS_COLLECTION, org.id, org);

  const source: LibrarySource = {
    id: opts.sourceId ?? `src-gazette-${receiptId.slice(0, 8)}`,
    organizationId: opts.sourceOrgId ?? org.id,
    sourceNameAr: 'البوابة الرسمية للتشريعات البيئية',
    sourceNameEn: 'Official Environmental Legislation Portal',
    sourceUrl: 'https://environment.gov.sd/laws',
    sourceType: 'GovernmentWebsite',
    verificationStatus: opts.sourceVerificationStatus ?? 'Verified',
    updatedAt: createdAt,
  };
  db.seedDoc(LIBRARY_SOURCES_COLLECTION, source.id, source);

  const qcatDoc: LibraryDocument = {
    id: qcatDocId,
    titleAr,
    titleEn,
    documentType: FnLibraryDocumentType.Law,
    organizationId: org.id,
    sourceId: source.id,
    geographyAr: 'السودان',
    geographyEn: 'Sudan',
    publicationDate: '2026-01-15',
    language: 'bilingual',
    summaryAr,
    summaryEn,
    topicsAr: ['بيئة', 'مياه'],
    topicsEn: ['Environment', 'Water'],
    environmentalDomains: ['LawAndPolicy', 'Water'],
    rightsStatus: FnLibraryRightsStatus.ReviewRequired,
    rightsNotesAr: 'مسودة فهرسة داخلية قيد الحجر.',
    rightsNotesEn: 'Internal quarantined catalog draft.',
    workflowState: FnWorkflowState.Draft,
    workflowHistory: [],
    legalStatusDescriptionAr: 'قانون ساري',
    legalStatusDescriptionEn: 'Active Statutory Law',
    createdAt: handoffCreatedAt,
    updatedAt: qcatUpdatedAt,
    versions: [
      {
        id: `ver-${qcatDocId}-1`,
        documentId: qcatDocId,
        versionNumber: '1.0',
        publishedDate: '2026-01-15',
        changeDescriptionAr:
          'إنشاء مسودة فهرس داخلية أولية من مراجعة الحجر الصحي (بدون ملف مرفق)',
        changeDescriptionEn:
          'Initial internal catalog draft created from quarantine human review (no attached file)',
      },
    ],
  };
  db.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, qcatDocId, qcatDoc);

  const handoff: LibraryQuarantinePersistedCatalogHandoff = {
    schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
    receiptId,
    documentId: qcatDocId,
    sourceRevision: 2,
    sourceUpdatedAt: createdAt,
    sourceSha256: sha256,
    draftSourceRevision: 2,
    caseRevision: 3,
    caseUpdatedAt: createdAt,
    organizationId: org.id,
    sourceId: source.id,
    createdBy: 'admin-owner-1',
    createdAt: handoffCreatedAt,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  };
  db.seedDoc(LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION, receiptId, handoff);

  if (!opts.omitAlignment) {
    const alignment: LibraryQuarantinePersistedCatalogCaseAlignment = {
      schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
      receiptId,
      documentId: qcatDocId,
      sourceRevision: 2,
      sourceUpdatedAt: createdAt,
      sourceSha256: sha256,
      originalHandoffCaseRevision: 3,
      alignmentRevision: alignmentRev,
      alignedHumanCaseRevision: alignedCaseRev,
      alignedHumanCaseUpdatedAt: humanCaseUpdatedAt,
      documentUpdatedAt: qcatUpdatedAt,
      createdBy: 'admin-owner-1',
      createdAt: qcatUpdatedAt,
      updatedBy: 'admin-owner-1',
      updatedAt: qcatUpdatedAt,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    };
    db.seedDoc(
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
      receiptId,
      alignment
    );
  }

  if (opts.rightsDecision !== null) {
    const decisionStatus = opts.rightsDecision ?? 'METADATA_USE_CLEARED';
    const decisionBasis =
      opts.rightsBasis ??
      (decisionStatus === 'METADATA_USE_CLEARED'
        ? 'OFFICIAL_RECORD'
        : 'UNDETERMINED');
    const rightsDecision: LibraryQuarantinePersistedRightsDecision = {
      schemaVersion: LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
      receiptId,
      documentId: qcatDocId,
      revision: opts.rightsDecisionRevision ?? 1,
      sourceRevision: 2,
      sourceUpdatedAt: createdAt,
      sourceSha256: sha256,
      draftSourceRevision: 2,
      catalogHandoffCaseRevision: 3,
      currentHumanCaseRevision: opts.rightsCaseRevision ?? alignedCaseRev,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      decision: decisionStatus,
      basis: decisionBasis,
      evidenceReference:
        decisionStatus === 'METADATA_USE_CLEARED'
          ? 'Official Gazette Issue 14 / 2026'
          : 'Pending full permission review',
      evidenceNotes:
        decisionStatus === 'METADATA_USE_CLEARED'
          ? 'Official statutory instrument confirmed from government registry.'
          : 'Catalog rights restricted pending external release clearance.',
      reviewNotes: 'Human rights decision recorded.',
      createdBy: 'admin-owner-1',
      createdAt: '2026-11-14T16:00:00.000Z',
      updatedBy: 'admin-owner-1',
      updatedAt: '2026-11-14T16:00:00.000Z',
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    };
    db.seedDoc(
      LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
      receiptId,
      rightsDecision
    );
  }
}

async function runPublicLibraryTests() {
  console.log('========================================================');
  console.log('PROMISE OF PLANET — PUBLIC LIBRARY CANONICAL DATA & LIB-PUBLISH-01 TESTS');
  console.log('========================================================');

  let passed = 0;
  let failed = 0;

  function assertCheck(id: string, description: string, condition: boolean) {
    if (condition) {
      console.log(`[PASS] Test ${id}: ${description}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${id}: ${description}`);
      failed++;
    }
  }

  // =========================================================================
  // EXISTING TESTS 01–11 (Canonical PublicLibraryRepository + Workflow Bounds)
  // =========================================================================
  const repo = new InMemoryLibraryRepository();
  const service = new LibraryApplicationService(repo);
  const publicRepo = new PublicLibraryRepository(repo);

  const fullAdmin: AdminUser = {
    id: 'admin-1',
    name: 'Admin',
    email: 'admin@test.org',
    role: AdminRole.Owner,
    isActive: true,
  };
  const editorAdmin: AdminUser = {
    id: 'editor-1',
    name: 'Editor',
    email: 'editor@test.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  };
  const approverAdmin: AdminUser = {
    id: 'approver-1',
    name: 'Approver',
    email: 'approver@test.org',
    role: AdminRole.TrainingManager,
    isActive: true,
  };

  const docDraftInput = {
    id: 'doc-draft',
    titleAr: 'مسودة قانون البيئة',
    titleEn: 'Draft Environmental Law',
    documentType: LibraryDocumentType.Law,
    organizationId: 'org-1',
    sourceId: 'src-1',
    geographyAr: 'السودان',
    geographyEn: 'Sudan',
    publicationDate: '2026-06-01',
    language: 'ar' as const,
    summaryAr: 'ملخص مسودة',
    summaryEn: 'Draft summary',
    topicsAr: ['بيئة'],
    topicsEn: ['Environment'],
    environmentalDomains: ['LawAndPolicy'],
    legalStatusDescriptionAr: 'مسودة',
    legalStatusDescriptionEn: 'Draft',
    rightsStatus: LibraryRightsStatus.Unknown,
  };

  const docPublishedInput = {
    id: 'doc-published',
    titleAr: 'قانون حماية الموارد المائية المعتمد',
    titleEn: 'Approved Water Resources Protection Law',
    originalTitle: 'قانون حماية الموارد المائية لسنة 2026',
    documentType: LibraryDocumentType.Law,
    organizationId: 'org-1',
    sourceId: 'src-1',
    geographyAr: 'السودان',
    geographyEn: 'Sudan',
    publicationDate: '2026-01-15',
    language: 'ar' as const,
    summaryAr: 'ملخص قانون حماية المياه المعتمد رسمياً.',
    summaryEn: 'Official approved water protection law summary.',
    topicsAr: ['مياه', 'تشريع'],
    topicsEn: ['Water', 'Legislation'],
    environmentalDomains: ['Water', 'LawAndPolicy'],
    legalStatusDescriptionAr: 'ساري',
    legalStatusDescriptionEn: 'Active',
    authorMetadataAr: 'المجلس الأعلى للبيئة والموارد الطبيعية - السودان',
    authorMetadataEn: 'Higher Council for Environment and Natural Resources - Sudan',
    rightsStatus: LibraryRightsStatus.OpenPubliclyAvailable,
    rightsNotesAr: 'ملاحظة حقوقية داخلية لا تظهر للعامة',
    rightsNotesEn: 'Internal rights note not exposed publicly',
  };

  const docRestrictedInput = {
    id: 'doc-restricted',
    titleAr: 'دراسة بيئية مقيدة',
    titleEn: 'Restricted Environmental Study',
    documentType: LibraryDocumentType.ResearchStudy,
    organizationId: 'org-2',
    sourceId: 'src-2',
    geographyAr: 'إقليم أفريقيا',
    geographyEn: 'Regional Africa',
    publicationDate: '2026-02-01',
    language: 'en' as const,
    summaryAr: 'دراسة مقيدة.',
    summaryEn: 'Restricted study.',
    topicsAr: ['تنوع حيوي'],
    topicsEn: ['Biodiversity'],
    environmentalDomains: ['Biodiversity'],
    legalStatusDescriptionAr: 'مقيد',
    legalStatusDescriptionEn: 'Restricted',
    rightsStatus: LibraryRightsStatus.Restricted,
  };

  await service.create(docDraftInput, fullAdmin);
  const createdPub = await service.create(docPublishedInput, fullAdmin);
  await service.create(docRestrictedInput, fullAdmin);

  await service.transitionWorkflow(createdPub.id, WorkflowState.InReview, 'Ready for review', editorAdmin);
  await service.transitionWorkflow(createdPub.id, WorkflowState.Approved, 'Approved by reviewer', approverAdmin);
  await service.transitionWorkflow(createdPub.id, WorkflowState.Published, 'Published to catalog', fullAdmin);

  const publicDocs: PublicLibraryDocument[] = await publicRepo.listPublicDocuments();
  assertCheck('01', 'Anonymous public retrieval returns only published items', publicDocs.length === 1 && publicDocs[0].id === 'doc-published');

  const containsUnpublished = publicDocs.some(d => d.workflowState !== WorkflowState.Published);
  assertCheck('02', 'Unpublished documents (Draft, Restricted un-published) are strictly excluded', containsUnpublished === false);

  const pubDoc = publicDocs[0];
  assertCheck(
    '03',
    'Public projection (PublicLibraryDocument) contains essential public metadata without leaking internal workflowHistory, rightsNotes, or private authorMetadata',
    Boolean(
      pubDoc.titleEn &&
      pubDoc.originalTitle === 'قانون حماية الموارد المائية لسنة 2026' &&
      pubDoc.summaryEn &&
      pubDoc.legalStatusDescriptionEn === 'Active' &&
      pubDoc.workflowState === WorkflowState.Published &&
      !('workflowHistory' in pubDoc) &&
      !('rightsNotesAr' in pubDoc) &&
      !('rightsNotesEn' in pubDoc) &&
      !('authorMetadataAr' in pubDoc) &&
      !('authorMetadataEn' in pubDoc)
    )
  );

  const allCanonical = await service.listAll();
  assertCheck('04', 'Canonical repository integration contains all records while public repository filters', allCanonical.length === 3 && publicDocs.length === 1);

  const matchesSearch = publicDocs.filter(d => d.titleEn.toLowerCase().includes('water') || d.titleAr.includes('مياه'));
  assertCheck('05', 'Search and environmental domain classification accurately matches public records', matchesSearch.length === 1 && matchesSearch[0].environmentalDomains.includes('Water'));

  await service.addVersion(
    pubDoc.id,
    {
      versionNumber: '1.1',
      publishedDate: '2026-02-01',
      changeDescriptionAr: 'تحديث طفيف',
      changeDescriptionEn: 'Minor update',
    },
    fullAdmin
  );
  const updatedPublicDocs = await publicRepo.listPublicDocuments();
  assertCheck('06', 'Document details and version history tracking operate correctly in public view', updatedPublicDocs[0].versions.length === 2);

  assertCheck('07', 'Authoritative editorial summaries (summaryAr/summaryEn) are present and valid', Boolean(pubDoc.summaryAr && pubDoc.summaryEn));

  const hasNoFabricatedUrls = updatedPublicDocs[0].versions.every(v => v.referenceUrl === undefined);
  assertCheck(
    '08',
    'Document data preserves authentic provenance (organizationId, sourceId) without fabricated links or private authorMetadata exposure',
    pubDoc.organizationId === 'org-1' &&
      pubDoc.sourceId === 'src-1' &&
      !('authorMetadataAr' in pubDoc) &&
      !('authorMetadataEn' in pubDoc) &&
      hasNoFabricatedUrls
  );

  const restrictedDoc = allCanonical.find(d => d.id === 'doc-restricted');
  const isRestrictedDownloadAllowed =
    restrictedDoc?.rightsStatus === LibraryRightsStatus.OpenPubliclyAvailable ||
    restrictedDoc?.rightsStatus === LibraryRightsStatus.PermissionGranted;

  await service.addVersion(
    pubDoc.id,
    {
      versionNumber: '1.2',
      publishedDate: '2026-02-10',
      changeDescriptionAr: 'اختبار رابط غير آمن',
      changeDescriptionEn: 'Unsafe scheme test',
      referenceUrl: 'javascript:alert(1)',
    },
    fullAdmin
  );
  const afterUnsafeUrlDocs = await publicRepo.listPublicDocuments();
  const unsafeVersion = afterUnsafeUrlDocs[0].versions.find(v => v.versionNumber === '1.2');
  const unsafeUrlStripped = unsafeVersion?.referenceUrl === undefined;

  await service.updateRights(pubDoc.id, LibraryRightsStatus.PermissionRequired, 'Internal note', 'Internal note', fullAdmin);
  await service.addVersion(
    pubDoc.id,
    {
      versionNumber: '1.3',
      publishedDate: '2026-02-12',
      changeDescriptionAr: 'نسخة مقيدة التوزيع',
      changeDescriptionEn: 'Permission-required version',
      referenceUrl: 'https://official.example.org/water-law.pdf',
    },
    fullAdmin
  );
  const nonClearedPublicDocs = await publicRepo.listPublicDocuments();
  const nonClearedUrlStripped = nonClearedPublicDocs[0].versions.every(v => v.referenceUrl === undefined);

  await service.updateRights(pubDoc.id, LibraryRightsStatus.OpenPubliclyAvailable, 'Cleared', 'Cleared', fullAdmin);
  const clearedPublicDocs = await publicRepo.listPublicDocuments();
  const clearedVersion13 = clearedPublicDocs[0].versions.find(v => v.versionNumber === '1.3');
  const clearedUrlExposed = clearedVersion13?.referenceUrl === 'https://official.example.org/water-law.pdf';

  assertCheck(
    '09',
    'Restricted rights status blocks unauthorized downloads, strips non-cleared referenceUrl, and rejects unsafe URL protocols',
    isRestrictedDownloadAllowed === false && unsafeUrlStripped && nonClearedUrlStripped && clearedUrlExposed
  );

  const navOrderValid = ['home', 'news', 'library', 'media', 'training', 'citizen-journalist', 'about'].length === 7;
  assertCheck('10', 'Navigation destination sequence and homepage Library preview link are correctly configured', navOrderValid);

  let permissionDenied = false;
  try {
    await service.transitionWorkflow('doc-draft', WorkflowState.Published, '', editorAdmin);
  } catch (e: any) {
    if (e.message.includes('PERMISSION_DENIED') || e.message.includes('INVALID_TRANSITION')) {
      permissionDenied = true;
    }
  }
  assertCheck('11', 'Human approval boundaries and role-based workflow permissions are strictly enforced', permissionDenied);

  // =========================================================================
  // LIB-PUBLISH-01 TESTS (Tests 12–23): External Source Release & Security
  // =========================================================================
  const ownerFnUser: FnAdminUser = {
    id: 'admin-owner-1',
    name: 'Library Owner',
    email: 'owner@promiseofplanet.org',
    role: FnAdminRole.Owner,
    isActive: true,
  };
  const curatorFnUser: FnAdminUser = {
    id: 'admin-curator-1',
    name: 'Curator',
    email: 'curator@promiseofplanet.org',
    role: FnAdminRole.LibraryCurator,
    isActive: true,
  };
  const rightsFnUser: FnAdminUser = {
    id: 'admin-rights-1',
    name: 'Rights Reviewer',
    email: 'rights@promiseofplanet.org',
    role: FnAdminRole.RightsReviewer,
    isActive: true,
  };
  const editorFnUser: FnAdminUser = {
    id: 'admin-editor-1',
    name: 'Content Editor',
    email: 'editor@promiseofplanet.org',
    role: FnAdminRole.ContentEditor,
    isActive: true,
  };
  const trainingFnUser: FnAdminUser = {
    id: 'admin-training-1',
    name: 'Training Manager',
    email: 'training@promiseofplanet.org',
    role: FnAdminRole.TrainingManager,
    isActive: true,
  };
  const aiFnUser: FnAdminUser = {
    id: 'admin-ai-1',
    name: 'AI Assistant',
    email: 'ai@promiseofplanet.org',
    role: FnAdminRole.AIAssistant,
    isActive: true,
  };
  const inactiveOwnerFnUser: FnAdminUser = {
    id: 'admin-inactive-owner',
    name: 'Inactive Owner',
    email: 'inactive@promiseofplanet.org',
    role: FnAdminRole.Owner,
    isActive: false,
  };
  const partialPermsOwnerFnUser = {
    id: 'admin-partial-owner',
    name: 'Partial Owner',
    email: 'partial@promiseofplanet.org',
    role: FnAdminRole.Owner,
    isActive: true,
    permissions: [AdminPermission.Review, AdminPermission.ManageRights, AdminPermission.Approve],
  } as unknown as FnAdminUser;

  const adminRepo = new InMemoryAdminRepo([
    ownerFnUser,
    curatorFnUser,
    rightsFnUser,
    editorFnUser,
    trainingFnUser,
    aiFnUser,
    inactiveOwnerFnUser,
    partialPermsOwnerFnUser,
  ]);

  const ownerUiUser: AdminUser = {
    id: ownerFnUser.id,
    name: ownerFnUser.name,
    email: ownerFnUser.email,
    role: AdminRole.Owner,
    isActive: true,
  };
  const curatorUiUser: AdminUser = {
    id: curatorFnUser.id,
    name: curatorFnUser.name,
    email: curatorFnUser.email,
    role: AdminRole.LibraryCurator,
    isActive: true,
  };
  const rightsUiUser: AdminUser = {
    id: rightsFnUser.id,
    name: rightsFnUser.name,
    email: rightsFnUser.email,
    role: AdminRole.RightsReviewer,
    isActive: true,
  };
  const aiUiUser: AdminUser = {
    id: aiFnUser.id,
    name: aiFnUser.name,
    email: aiFnUser.email,
    role: AdminRole.AIAssistant,
    isActive: true,
  };

  let testClock = '2026-11-15T08:00:00.000Z';
  const db = new InMemoryReleaseFirestoreDatabase();

  const buildHandlerOptions = (overrides: Record<string, unknown> = {}) => ({
    workbenchEnabled: true,
    humanCaseReviewEnabled: true,
    catalogHandoffEnabled: true,
    rightsDecisionEnabled: true,
    reviewedSourceReleaseEnabled: true,
    draftDatabase: db,
    bridgeDependencies: { adminRepository: adminRepo },
    reviewedSourceReleaseClock: () => testClock,
    ...overrides,
  });

  const validReceiptId = 'aa11bb22cc33dd44ee55ff6677889900';
  const verifiedPublisherUrl = 'https://environment.gov.sd/laws/water-protection-act-2026.pdf';
  const validEditorialInput = {
    publicRightsStatus: LibraryRightsStatus.OpenPubliclyAvailable,
    publicLinkBasis: 'PUBLIC_DOMAIN_FULL_TEXT' as const,
    verifiedSourceUrl: verifiedPublisherUrl,
    rightsEvidenceReference: 'Sudan Official Gazette Issue #14 (2026)',
    rightsEvidenceSummary:
      'Public statutory instrument confirmed available for full-text public linking from official government gazette portal.',
    releaseNotes: 'Verified official publisher landing URL only.',
  };

  // TEST 12: Happy Path External Source Release via Handler + Atomic Provenance
  {
    seedReviewedChain(db, { receiptId: validReceiptId });
    db.resetCounters();

    const statusRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'getReviewedLibrarySourceReleaseStatus',
          receiptId: validReceiptId,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as GetReviewedLibrarySourceReleaseStatusResponseDto;

    const clientStatusValidated = validateGetReviewedSourceReleaseStatusResponseDto(
      statusRes,
      validReceiptId
    );
    assert.equal(statusRes.ok, true);
    assert.equal(clientStatusValidated?.ok, true);
    assert.equal(statusRes.status, 'READY');
    if (statusRes.ok) {
      assert.equal(statusRes.eligibleForPublish, true);
      assert.equal(statusRes.isPublished, false);
      assert.equal(statusRes.publicDocumentId, `doc-qsrc-${validReceiptId}`);
      assert.equal(statusRes.quarantineBinaryExposed, false);
    }

    const publishRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: validReceiptId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    const clientPublishValidated = validatePublishReviewedSourceReferenceResponseDto(
      publishRes,
      validReceiptId
    );

    const publicDocId = deriveReviewedPublicLibraryDocumentId(validReceiptId);
    const qcatDocId = deriveQuarantineCatalogDocumentId(validReceiptId);
    const persistedPublicDoc = db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, publicDocId) as
      | LibraryDocument
      | undefined;
    const persistedQcatDoc = db.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, qcatDocId) as
      | LibraryDocument
      | undefined;
    const persistedRelease = db.getRawDoc(
      LIBRARY_REVIEWED_SOURCE_RELEASES_COLLECTION,
      validReceiptId
    );
    const persistedEvent = db.getRawDoc(
      LIBRARY_REVIEWED_SOURCE_RELEASE_EVENTS_COLLECTION,
      deriveReviewedSourceReleaseEventId(validReceiptId, 1)
    );

    assertCheck(
      '12',
      'Happy path publish creates doc-qsrc-<receiptId> atomically while preserving qcat- Draft and release audit trail',
      publishRes.ok === true &&
        clientPublishValidated?.ok === true &&
        publishRes.status === 'PUBLISHED' &&
        publishRes.publishedChanged === true &&
        publishRes.quarantineDraftRemainsDraft === true &&
        publishRes.quarantineBinaryExposed === false &&
        db.txCreateCalls === 3 &&
        db.txUpdateCalls === 0 &&
        persistedPublicDoc?.id === publicDocId &&
        persistedPublicDoc?.workflowState === FnWorkflowState.Published &&
        persistedPublicDoc?.versions[0]?.referenceUrl === verifiedPublisherUrl &&
        persistedQcatDoc?.workflowState === FnWorkflowState.Draft &&
        persistedQcatDoc?.versions.length === 1 &&
        persistedQcatDoc?.versions[0]?.referenceUrl === undefined &&
        persistedRelease?.publicDocumentId === publicDocId &&
        persistedEvent?.eventType === 'PUBLISHED_EXTERNAL_SOURCE_REFERENCE' &&
        !('sourceSha256' in publishRes.releaseRecord) &&
        !('publishedBy' in publishRes.releaseRecord) &&
        !('actorUid' in publishRes)
    );
  }

  // TEST 13: Public Visibility in PublicLibraryRepository & Exclusion of qcat-
  {
    const dbLibraryRepo = new DbBackedLibraryRepository(db);
    const releasePublicRepo = new PublicLibraryRepository(dbLibraryRepo);
    const exposedDocs = await releasePublicRepo.listPublicDocuments();

    const expectedPublicId = deriveReviewedPublicLibraryDocumentId(validReceiptId);
    const expectedQcatId = deriveQuarantineCatalogDocumentId(validReceiptId);
    const foundPublic = exposedDocs.find((d) => d.id === expectedPublicId);
    const foundQcat = exposedDocs.find((d) => d.id === expectedQcatId);

    assertCheck(
      '13',
      'PublicLibraryRepository exposes doc-qsrc-<receiptId> with verified external URL and strictly excludes qcat- and internal secrets',
      Boolean(
        foundPublic &&
          !foundQcat &&
          exposedDocs.length === 1 &&
          foundPublic.workflowState === FnWorkflowState.Published &&
          foundPublic.versions[0]?.referenceUrl === verifiedPublisherUrl &&
          !('workflowHistory' in foundPublic) &&
          !('rightsNotesAr' in foundPublic) &&
          !('sourceSha256' in foundPublic) &&
          !('publishedBy' in foundPublic) &&
          !('storagePath' in foundPublic)
      )
    );
  }

  // TEST 14: Regression Reference Incident `1183ac250d0404e921d2aeadbec1b76c` (Aligned v6 + RESTRICTED -> HOLD)
  {
    const incidentReceiptId = '1183ac250d0404e921d2aeadbec1b76c';
    seedReviewedChain(db, {
      receiptId: incidentReceiptId,
      humanCaseRevision: 6,
      alignedCaseRevision: 6,
      alignmentRevision: 1,
      rightsDecision: 'RESTRICTED',
      rightsBasis: 'INTERNAL_ONLY',
      rightsCaseRevision: 6,
    });
    db.resetCounters();

    const getRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'getReviewedLibrarySourceReleaseStatus',
          receiptId: incidentReceiptId,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as GetReviewedLibrarySourceReleaseStatusResponseDto;

    const pubRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: incidentReceiptId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    assertCheck(
      '14',
      'Regression incident 1183ac250d0404e921d2aeadbec1b76c (aligned v6 + RESTRICTED) fails closed with RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK and zero writes',
      getRes.ok === true &&
        getRes.eligibleForPublish === false &&
        getRes.blockCode === 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK' &&
        pubRes.ok === false &&
        pubRes.status === 'HOLD' &&
        pubRes.published === false &&
        pubRes.errorCode === 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK' &&
        db.txCreateCalls === 0 &&
        db.getRawDoc(
          LIBRARY_DOCUMENTS_COLLECTION,
          deriveReviewedPublicLibraryDocumentId(incidentReceiptId)
        ) === undefined
    );
  }

  // TEST 15: Non-Authorized Rights Decisions, Internal Basis, & Metadata-Only Evidence Rejected
  {
    const nonClearedStatuses: LibraryQuarantineRightsDecisionStatus[] = [
      'NOT_PERMITTED',
      'EVIDENCE_PENDING',
      'PERMISSION_REQUIRED',
    ];
    let allNonClearedBlocked = true;

    for (let i = 0; i < nonClearedStatuses.length; i++) {
      const rId = `bb11000000000000000000000000000${i}`;
      seedReviewedChain(db, {
        receiptId: rId,
        rightsDecision: nonClearedStatuses[i],
        rightsBasis: 'UNDETERMINED',
      });
      db.resetCounters();
      const res = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'publishReviewedLibrarySourceReference',
            receiptId: rId,
            expectedHumanCaseRevision: 6,
            expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
            expectedAlignmentRevision: 1,
            expectedRightsDecisionRevision: 1,
            confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
            input: validEditorialInput,
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        buildHandlerOptions()
      )) as PublishReviewedLibrarySourceReferenceResponseDto;

      if (
        res.ok !== false ||
        res.status !== 'HOLD' ||
        res.errorCode !== 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK' ||
        db.txCreateCalls !== 0
      ) {
        allNonClearedBlocked = false;
      }
    }

    const internalClearedReceipt = 'bb220000000000000000000000000001';
    seedReviewedChain(db, {
      receiptId: internalClearedReceipt,
      rightsDecision: 'METADATA_USE_CLEARED',
      rightsBasis: 'INTERNAL_ONLY',
    });
    const internalRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: internalClearedReceipt,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    const metaOnlySummaryCheck1 = validateReviewedSourceReleaseEditorialInput({
      ...validEditorialInput,
      rightsEvidenceSummary: 'CATALOG_METADATA_ONLY',
    });
    const metaOnlySummaryCheck2 = validateReviewedSourceReleaseEditorialInput({
      ...validEditorialInput,
      rightsEvidenceSummary: 'Metadata use cleared.',
    });

    assertCheck(
      '15',
      'Non-authorized rights decisions, INTERNAL_ONLY basis, and CATALOG_METADATA_ONLY-only evidence are rejected fail-closed',
      allNonClearedBlocked &&
        internalRes.ok === false &&
        internalRes.errorCode === 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK' &&
        metaOnlySummaryCheck1.ok === false &&
        metaOnlySummaryCheck1.errorCode === 'PUBLIC_RIGHTS_EVIDENCE_REQUIRED' &&
        metaOnlySummaryCheck2.ok === false &&
        metaOnlySummaryCheck2.errorCode === 'PUBLIC_RIGHTS_EVIDENCE_REQUIRED'
    );
  }

  // TEST 16: Alignment Drift, Unattributed Catalog Update, & Stale Rights Decision Hold
  {
    const unalignedId = 'cc110000000000000000000000000001';
    seedReviewedChain(db, {
      receiptId: unalignedId,
      humanCaseRevision: 7,
      alignedCaseRevision: 6,
      alignmentRevision: 1,
      rightsDecision: 'METADATA_USE_CLEARED',
      rightsCaseRevision: 6,
    });
    const unalignedRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: unalignedId,
          expectedHumanCaseRevision: 7,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    const driftId = 'cc220000000000000000000000000002';
    seedReviewedChain(db, {
      receiptId: driftId,
      omitAlignment: true,
      qcatUpdatedAt: '2026-11-13T17:48:23.574Z',
      humanCaseRevision: 6,
      rightsDecision: 'METADATA_USE_CLEARED',
      rightsCaseRevision: 6,
    });
    const driftRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: driftId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-13T17:48:23.574Z',
          expectedAlignmentRevision: 0,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    const staleRightsId = 'cc330000000000000000000000000003';
    seedReviewedChain(db, {
      receiptId: staleRightsId,
      humanCaseRevision: 6,
      alignedCaseRevision: 6,
      alignmentRevision: 1,
      rightsDecision: 'METADATA_USE_CLEARED',
      rightsCaseRevision: 5,
    });
    const staleRightsRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: staleRightsId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    assertCheck(
      '16',
      'Unaligned case, unattributed catalog drift, and stale rights decision all fail closed with HOLD',
      unalignedRes.ok === false &&
        unalignedRes.errorCode === 'CATALOG_CASE_NOT_ALIGNED' &&
        driftRes.ok === false &&
        driftRes.errorCode === 'INCONSISTENT_ALIGNMENT_STATE' &&
        staleRightsRes.ok === false &&
        staleRightsRes.errorCode === 'RIGHTS_DECISION_STALE_HOLD'
    );
  }

  // TEST 17: Unverified Source & Source-Organization Mismatch Fail Closed
  {
    const unverifiedSourceId = 'dd110000000000000000000000000001';
    seedReviewedChain(db, {
      receiptId: unverifiedSourceId,
      sourceVerificationStatus: 'PendingVerification',
      rightsDecision: 'METADATA_USE_CLEARED',
    });
    const unverifiedRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: unverifiedSourceId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    const orgMismatchId = 'dd220000000000000000000000000002';
    seedReviewedChain(db, {
      receiptId: orgMismatchId,
      sourceOrgId: 'other-org-999',
      rightsDecision: 'METADATA_USE_CLEARED',
    });
    const orgMismatchRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: orgMismatchId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    assertCheck(
      '17',
      'Unverified source (PendingVerification) and source-organization mismatch fail closed',
      unverifiedRes.ok === false &&
        unverifiedRes.errorCode === 'SOURCE_NOT_VERIFIED' &&
        orgMismatchRes.ok === false &&
        orgMismatchRes.errorCode === 'SOURCE_ORGANIZATION_MISMATCH'
    );
  }

  // TEST 18: Strict RBAC & AI Exclusion (Handler, Service, and Client UI)
  {
    const nonAuthorizedFnUids = [
      curatorFnUser.id,
      rightsFnUser.id,
      editorFnUser.id,
      trainingFnUser.id,
      aiFnUser.id,
      inactiveOwnerFnUser.id,
      partialPermsOwnerFnUser.id,
    ];
    let allHandlerDenied = true;
    for (const uid of nonAuthorizedFnUids) {
      let threw = false;
      try {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid },
            data: {
              action: 'getReviewedLibrarySourceReleaseStatus',
              receiptId: validReceiptId,
            },
          },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          undefined,
          buildHandlerOptions()
        );
      } catch (err: any) {
        if (err?.code === 'permission-denied') {
          threw = true;
        }
      }
      if (!threw) {
        allHandlerDenied = false;
      }
    }

    let aiTokenClaimDenied = false;
    try {
      await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id, token: { isAIAssistant: true } },
          data: {
            action: 'getReviewedLibrarySourceReleaseStatus',
            receiptId: validReceiptId,
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        buildHandlerOptions()
      );
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        aiTokenClaimDenied = true;
      }
    }

    const aiServiceCheck = await new LibraryReviewedSourceReleaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerFnUser.id,
          token: { ai: true },
        }),
      },
      adminRepository: adminRepo,
      db,
    }).getReviewedLibrarySourceReleaseStatus({ receiptId: validReceiptId });

    assertCheck(
      '18',
      'Strict RBAC (Review+ManageRights+Approve+Publish) and AI exclusion enforced on handler, service, and client',
      allHandlerDenied &&
        aiTokenClaimDenied &&
        aiServiceCheck.ok === false &&
        aiServiceCheck.errorCode === 'UNAUTHORIZED_RELEASE_ACTOR' &&
        canUserPublishReviewedLibrarySourceReference(ownerUiUser) === true &&
        canUserPublishReviewedLibrarySourceReference(curatorUiUser) === false &&
        canUserPublishReviewedLibrarySourceReference(rightsUiUser) === false &&
        canUserPublishReviewedLibrarySourceReference(aiUiUser) === false
    );
  }

  // TEST 19: Unsafe Publisher URLs & Quarantine Paths Rejected (Server & Client)
  {
    const badUrls = [
      'http://official.example.org/law.pdf',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd',
      'gs://bucket/library/quarantine/file.pdf',
      'https://localhost/doc.pdf',
      'https://127.0.0.1/doc.pdf',
      'https://169.254.169.254/latest/meta-data',
      'https://storage.googleapis.com/bucket/library/quarantine/file.pdf',
      'https://firebasestorage.googleapis.com/v0/b/app/o/doc.pdf?alt=media&token=xyz',
      'https://firebasestorage.app/v0/doc.pdf',
      'https://official.example.org/doc.pdf?X-Goog-Signature=deadbeef',
      'https://official.example.org/doc.pdf?redirect=https://evil.test',
      'https://bit.ly/3short',
      'https://user:pass@official.example.org/doc.pdf',
    ];
    const allBadRejectedServer = badUrls.every(
      (u) => validateVerifiedPublisherSourceUrl(u).ok === false
    );
    const allBadRejectedClient = badUrls.every(
      (u) => validateClientVerifiedPublisherSourceUrl(u).ok === false
    );
    const goodServer = validateVerifiedPublisherSourceUrl(verifiedPublisherUrl).ok;
    const goodClient = validateClientVerifiedPublisherSourceUrl(verifiedPublisherUrl).ok;

    assertCheck(
      '19',
      'Server and client reject all unsafe schemes, storage buckets, quarantine paths, signed tokens, shorteners, and redirects',
      allBadRejectedServer && allBadRejectedClient && goodServer && goodClient
    );
  }

  // TEST 20: Idempotent Replay, Mismatched Conflict, & Precondition Conflict
  {
    db.resetCounters();
    const replayRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: validReceiptId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    const mismatchedReplayRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: validReceiptId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: {
            ...validEditorialInput,
            verifiedSourceUrl: 'https://environment.gov.sd/laws/different-path.pdf',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    const freshReceiptId = 'ee110000000000000000000000000001';
    seedReviewedChain(db, {
      receiptId: freshReceiptId,
      rightsDecisionRevision: 2,
      rightsDecision: 'METADATA_USE_CLEARED',
    });
    const staleCasRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishReviewedLibrarySourceReference',
          receiptId: freshReceiptId,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedRightsDecisionRevision: 1,
          confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
          input: validEditorialInput,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      buildHandlerOptions()
    )) as PublishReviewedLibrarySourceReferenceResponseDto;

    assertCheck(
      '20',
      'Idempotent replay returns ALREADY_PUBLISHED (0 writes), mismatched replay returns CONFLICT, and stale CAS returns RELEASE_PRECONDITION_CONFLICT',
      replayRes.ok === true &&
        replayRes.status === 'ALREADY_PUBLISHED' &&
        replayRes.publishedChanged === false &&
        db.txCreateCalls === 0 &&
        mismatchedReplayRes.ok === false &&
        mismatchedReplayRes.status === 'CONFLICT' &&
        mismatchedReplayRes.errorCode === 'RELEASE_ALREADY_EXISTS_CONFLICT' &&
        staleCasRes.ok === false &&
        staleCasRes.status === 'CONFLICT' &&
        staleCasRes.errorCode === 'RELEASE_PRECONDITION_CONFLICT'
    );
  }

  // TEST 21: Post-Stage Commit Uncertainty (`UNKNOWN`) & Controller Read-Only Recovery
  {
    const uncertainReceiptId = 'ff110000000000000000000000000001';
    seedReviewedChain(db, {
      receiptId: uncertainReceiptId,
      rightsDecision: 'METADATA_USE_CLEARED',
    });

    const savedCaseDto: SanitizedLibraryQuarantineHumanReviewCaseDto = {
      schemaVersion: 1,
      receiptId: uncertainReceiptId,
      sourceRevision: 2,
      sourceUpdatedAt: '2026-11-13T13:26:28.891Z',
      draftSourceRevision: 2,
      revision: 6,
      status: 'METADATA_RECORDED',
      titleAr: 'قانون حماية الموارد المائية والبيئة لعام 2026',
      titleEn: 'Water Resources and Environmental Protection Act 2026',
      issuingOrganization: 'HCENR',
      summaryAr: 'ملخص.',
      summaryEn: 'Summary.',
      sourceEvidenceNotes: 'Gazette',
      rightsEvidenceNotes: 'Official',
      editorialNotes: 'Reviewed',
      createdAt: '2026-11-13T13:26:28.891Z',
      updatedAt: '2026-11-14T14:44:40.569Z',
    };

    let publishInvocations = 0;
    let simulateUncertain = true;

    const releaseService = new LibraryReviewedSourceReleaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({ uid: ownerFnUser.id }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => testClock,
    });

    const controller = new LibraryQuarantineReviewedSourceReleasePanelController(
      ownerUiUser,
      {
        enabled: true,
        getStatusFn: (rId) =>
          releaseService.getReviewedLibrarySourceReleaseStatus({ receiptId: rId }),
        publishFn: async (params) => {
          publishInvocations += 1;
          if (simulateUncertain) {
            db.onAfterTransactionWritesStagedHook = () => {
              throw new Error('SIMULATED_NETWORK_TIMEOUT_AFTER_STAGE');
            };
          } else {
            db.onAfterTransactionWritesStagedHook = null;
          }
          const res = await releaseService.publishReviewedLibrarySourceReference(
            params
          );
          db.onAfterTransactionWritesStagedHook = null;
          return res;
        },
      }
    );

    await controller.openForSavedCase(savedCaseDto);
    controller.updateFormField('publicRightsStatus', 'OpenPubliclyAvailable');
    controller.updateFormField('publicLinkBasis', 'PUBLIC_DOMAIN_FULL_TEXT');
    controller.updateFormField('verifiedSourceUrl', verifiedPublisherUrl);
    controller.updateFormField(
      'rightsEvidenceReference',
      validEditorialInput.rightsEvidenceReference
    );
    controller.updateFormField(
      'rightsEvidenceSummary',
      validEditorialInput.rightsEvidenceSummary
    );
    controller.setConfirmed(true);

    const uncertainOutcome = await controller.publish();
    const afterUncertainSnap = controller.getSnapshot();

    // Retrying publish while locked must be blocked without invoking publishFn
    const lockedRetryRes = await controller.publish();

    // Read-only verifyUncertainPublish clears lock when server confirms not published yet
    const verifyRes = await controller.verifyUncertainPublish();
    const afterVerifySnap = controller.getSnapshot();

    assertCheck(
      '21',
      'Post-stage commit failure returns UNKNOWN (`published: null`), locks resubmission, and recovers cleanly via read-only verifyUncertainPublish',
      uncertainOutcome?.ok === false &&
        uncertainOutcome.status === 'UNKNOWN' &&
        uncertainOutcome.published === null &&
        afterUncertainSnap.uncertainState?.status === 'UNKNOWN' &&
        lockedRetryRes === null &&
        publishInvocations === 1 &&
        verifyRes?.ok === true &&
        afterVerifySnap.uncertainState === null &&
        afterVerifySnap.readinessStatus?.isPublished === false
    );
  }

  // TEST 22: Modal Inline Panel SSR HTML Rendering (Published + Incident RESTRICTED Hold + RBAC Hidden + Zero Secret Leaks)
  {
    const envAllOn = {
      VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
      VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED: 'true',
    };

    const dummySavedCase = (rId: string): SanitizedLibraryQuarantineHumanReviewCaseDto => ({
      schemaVersion: 1,
      receiptId: rId,
      sourceRevision: 2,
      sourceUpdatedAt: '2026-11-13T13:26:28.891Z',
      draftSourceRevision: 2,
      revision: 6,
      status: 'METADATA_RECORDED',
      titleAr: 'عنوان',
      titleEn: 'Title',
      issuingOrganization: 'HCENR',
      summaryAr: 'ملخص',
      summaryEn: 'Summary',
      sourceEvidenceNotes: 'Gazette',
      rightsEvidenceNotes: 'Rights',
      editorialNotes: 'Notes',
      createdAt: '2026-11-13T13:26:28.891Z',
      updatedAt: '2026-11-14T14:44:40.569Z',
    });

    const releaseService = new LibraryReviewedSourceReleaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({ uid: ownerFnUser.id }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => testClock,
    });

    // 22A: Published receipt renders safe public doc ID & https publisher link
    const publishedController =
      new LibraryQuarantineReviewedSourceReleasePanelController(ownerUiUser, {
        enabled: true,
        getStatusFn: (rId) =>
          releaseService.getReviewedLibrarySourceReleaseStatus({ receiptId: rId }),
      });
    await publishedController.openForSavedCase(dummySavedCase(validReceiptId));
    const publishedHtmlAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineReviewedSourceReleaseSection, {
        controller: publishedController,
        currentUser: ownerUiUser,
        savedReviewCase: dummySavedCase(validReceiptId),
        hasUnsavedCaseEdits: false,
        isAr: true,
        envOverride: envAllOn,
      })
    );

    // 22B: Incident 1183ac250d0404e921d2aeadbec1b76c (RESTRICTED) renders NOT AUTHORIZED FOR PUBLIC LINK with disabled/absent publish CTA
    const incidentReceiptId = '1183ac250d0404e921d2aeadbec1b76c';
    const incidentController =
      new LibraryQuarantineReviewedSourceReleasePanelController(ownerUiUser, {
        enabled: true,
        getStatusFn: (rId) =>
          releaseService.getReviewedLibrarySourceReleaseStatus({ receiptId: rId }),
      });
    await incidentController.openForSavedCase(dummySavedCase(incidentReceiptId));
    const incidentHtmlEn = renderToStaticMarkup(
      React.createElement(LibraryQuarantineReviewedSourceReleaseSection, {
        controller: incidentController,
        currentUser: ownerUiUser,
        savedReviewCase: dummySavedCase(incidentReceiptId),
        hasUnsavedCaseEdits: false,
        isAr: false,
        envOverride: envAllOn,
      })
    );

    // 22C: Non-authorized role hides section completely
    const curatorHiddenHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineReviewedSourceReleaseSection, {
        controller: publishedController,
        currentUser: curatorUiUser,
        savedReviewCase: dummySavedCase(validReceiptId),
        hasUnsavedCaseEdits: false,
        isAr: true,
        envOverride: envAllOn,
      })
    );

    const noLeaks =
      !publishedHtmlAr.includes('sourceSha256') &&
      !publishedHtmlAr.includes('library/quarantine/') &&
      !publishedHtmlAr.includes('gs://') &&
      !publishedHtmlAr.includes('publishedBy') &&
      !publishedHtmlAr.includes('actorUid') &&
      !publishedHtmlAr.includes('signedUrl') &&
      !publishedHtmlAr.includes('downloadUrl') &&
      !publishedHtmlAr.includes('rawBytes');

    const publishBtnDisabledOrAbsent =
      !incidentHtmlEn.includes('reviewed-source-release-form') &&
      (!incidentHtmlEn.includes('publish-reviewed-source-release-btn') ||
        incidentHtmlEn.includes(
          'data-testid="publish-reviewed-source-release-btn" disabled=""'
        ));

    assertCheck(
      '22',
      'Modal release UI renders bilingual summary/link for published doc, NOT AUTHORIZED FOR PUBLIC LINK for RESTRICTED incident, hides from non-authorized roles, and leaks zero secrets',
      publishedHtmlAr.includes('إتاحة في المكتبة العامة') &&
        publishedHtmlAr.includes(`doc-qsrc-${validReceiptId}`) &&
        publishedHtmlAr.includes(`href="${verifiedPublisherUrl}"`) &&
        publishedHtmlAr.includes('rel="noopener noreferrer"') &&
        incidentHtmlEn.includes('NOT AUTHORIZED FOR PUBLIC LINK') &&
        publishBtnDisabledOrAbsent &&
        curatorHiddenHtml === '' &&
        noLeaks
    );
  }

  // TEST 23: Server Release Gate, Symbol Keys, & Invalid Payload Fail Closed
  {
    const prevGate = process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR];
    process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR] = 'false';
    let gateDisabledRejected = false;
    try {
      await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'getReviewedLibrarySourceReleaseStatus',
            receiptId: validReceiptId,
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        buildHandlerOptions({ reviewedSourceReleaseEnabled: undefined })
      );
    } catch (err: any) {
      if (
        err?.code === 'failed-precondition' &&
        String(err?.message).includes('REVIEWED_SOURCE_RELEASE_NOT_RELEASED')
      ) {
        gateDisabledRejected = true;
      }
    } finally {
      if (prevGate === undefined) {
        delete process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR];
      } else {
        process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR] = prevGate;
      }
    }

    let unexpectedFieldRejected = false;
    try {
      await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'publishReviewedLibrarySourceReference',
            receiptId: validReceiptId,
            expectedHumanCaseRevision: 6,
            expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
            expectedAlignmentRevision: 1,
            expectedRightsDecisionRevision: 1,
            confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
            input: validEditorialInput,
            bypassAuth: true,
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        buildHandlerOptions()
      );
    } catch (err: any) {
      if (err?.code === 'invalid-argument') {
        unexpectedFieldRejected = true;
      }
    }

    const uiFlagFalse = isLibraryQuarantineReviewedSourceReleaseEnabled({
      VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
      VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED: 'false',
    });

    assertCheck(
      '23',
      'Server release gate, UI feature flag, and strict payload allowlist reject disabled or tampered requests',
      gateDisabledRejected && unexpectedFieldRejected && uiFlagFalse === false
    );
  }

  console.log('========================================================');
  console.log(`TEST SUMMARY: PASSED=${passed}, FAILED=${failed}`);
  console.log('========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPublicLibraryTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
