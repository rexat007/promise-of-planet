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
  LibraryQuarantinePublishedBinaryReleaseSection,
} from '../src/components/library/LibraryQuarantineHumanReviewModal';
import { PublicLibraryHub } from '../src/components/library/PublicLibraryHub';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../src/services/libraryQuarantineHumanReviewClient';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type {
  LibraryPublishedBinaryReleaseService as LibraryPublishedBinaryReleaseServiceClass,
  PublishedBinaryStorageBucket,
  PublishedBinaryStorageFile,
} from '../functions/src/library/libraryPublishedBinaryReleaseService';
import type {
  PublishedBinaryDownloadHttpResponseWriter,
} from '../functions/src/library/libraryPublishedBinaryDownloadEndpoint';
import {
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore';
import {
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
  type LibraryQuarantinePersistedBinarySafetyCase,
} from '../functions/src/library/libraryQuarantineBinarySafetyCaseContract';
import {
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineIsolatedInspectionRequestStore';
import {
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  type LibraryQuarantinePersistedIsolatedInspectionRequest,
} from '../functions/src/library/libraryQuarantineIsolatedInspectionRequestContract';
import {
  LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
  LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
  type LibraryQuarantinePersistedAvExecution,
} from '../functions/src/library/libraryQuarantineAvExecutionContract';
import {
  LIBRARY_QUARANTINE_PDF_INSPECTIONS_COLLECTION,
  LIBRARY_QUARANTINE_PDF_INSPECTION_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_PDF_INSPECTION_POLICY_VERSION,
  LIBRARY_QUARANTINE_PDF_INSPECTION_OUTCOME_VERIFIED,
  type LibraryQuarantinePersistedPdfInspection,
} from '../functions/src/library/libraryIsolatedPdfInspection';
import {
  computeCrc32,
  inspectLibraryUploadDeepStructure,
} from '../functions/src/library/libraryUploadDeepStructure';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
} from '../functions/src/library/libraryUploadBinaryAdmission';
import type { GcsLibraryQuarantineObjectMetadata } from '../functions/src/library/gcsLibraryQuarantineStorageAdapter';
import {
  LibraryQuarantinePublishedBinaryReleasePanelController,
  canUserPublishQuarantinedBinaryToPublicLibrary,
  detectPublishedBinaryFormat,
  getOwnedPublishedBinaryDownloadUrl,
  isLibraryQuarantinePublishedBinaryReleaseEnabled,
  isOwnedPublishedBinaryDownloadUrl,
  isPublishedBinaryPublicDocumentId,
  validateClientBinaryDownloadFilename,
  type GetPublishedLibraryBinaryReleaseStatusResponseDto as ClientGetPublishedBinaryStatusDto,
  type PublishQuarantinedBinaryToPublicLibraryResponseDto as ClientPublishBinaryResponseDto,
} from '../src/services/libraryPublishedBinaryClient';

import {
  isLibraryQuarantineAvExecutionEnabled,
} from '../src/services/libraryQuarantineIsolatedInspectionRequestClient';

const require = createRequire(import.meta.url);
const {
  LIBRARY_AV_EXECUTION_RELEASE_ENV_VAR,
  LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR,
  LIBRARY_PUBLISHED_BINARY_RELEASE_ENV_VAR,
  executeManageLibraryDocumentsRequest,
} = require(
  '../functions/src/library/libraryAdminHandlers'
) as typeof import('../functions/src/library/libraryAdminHandlers');
const {
  GoogleCloudRunQuarantineAvJobInvoker,
  LIBRARY_QUARANTINE_AV_JOB_NAME_ENV_VAR,
  LIBRARY_QUARANTINE_AV_JOB_PROJECT_ENV_VAR,
  LIBRARY_QUARANTINE_AV_JOB_REGION_ENV_VAR,
} = require(
  '../functions/src/library/libraryQuarantineAvJobInvoker'
) as typeof import('../functions/src/library/libraryQuarantineAvJobInvoker');
const {
  LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
  LIBRARY_PUBLISHED_BINARY_RELEASE_EVENTS_COLLECTION,
  LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION,
  LibraryPublishedBinaryReleaseService,
  derivePublishedBinaryPublicLibraryDocumentId,
  derivePublishedBinaryReleaseEventId,
} = require(
  '../functions/src/library/libraryPublishedBinaryReleaseService'
) as typeof import('../functions/src/library/libraryPublishedBinaryReleaseService');
const {
  createPublishedBinaryDownloadHandler,
} = require(
  '../functions/src/library/libraryPublishedBinaryDownloadEndpoint'
) as typeof import('../functions/src/library/libraryPublishedBinaryDownloadEndpoint');
const {
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
} = require(
  '../functions/src/library/libraryQuarantineUploadEndpoint'
) as typeof import('../functions/src/library/libraryQuarantineUploadEndpoint');

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

  // TEST 24: Absent / Malformed Release Flags Default-OFF on Server & Client (Zero Accidental Activation)
  {
    const prevGate = process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR];
    const prevUiGate = process.env.VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED;
    let absentReadRejected = false;
    let absentPublishRejected = false;
    let malformedValuesRejected = true;

    try {
      delete process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR];
      delete process.env.VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED;

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
          absentReadRejected = true;
        }
      }

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
          absentPublishRejected = true;
        }
      }

      for (const badEnvVal of ['', 'false', 'TRUE', ' true ', '1', 'yes', 'on']) {
        process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR] = badEnvVal;
        let badServerRejected = false;
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
            badServerRejected = true;
          }
        }
        if (!badServerRejected) {
          malformedValuesRejected = false;
        }
      }

      // Injected non-boolean option must also fail closed
      let nonBooleanOptionRejected = false;
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
          buildHandlerOptions({ reviewedSourceReleaseEnabled: 'true' as unknown as boolean })
        );
      } catch (err: any) {
        if (
          err?.code === 'failed-precondition' &&
          String(err?.message).includes('REVIEWED_SOURCE_RELEASE_NOT_RELEASED')
        ) {
          nonBooleanOptionRejected = true;
        }
      }
      if (!nonBooleanOptionRejected) {
        malformedValuesRejected = false;
      }

      // Upstream server gate false must block even when reviewedSourceReleaseEnabled === true
      let upstreamBlocked = false;
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
          buildHandlerOptions({
            rightsDecisionEnabled: false,
            reviewedSourceReleaseEnabled: true,
          })
        );
      } catch (err: any) {
        if (err?.code === 'failed-precondition') {
          upstreamBlocked = true;
        }
      }
      if (!upstreamBlocked) {
        malformedValuesRejected = false;
      }
    } finally {
      if (prevGate === undefined) {
        delete process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR];
      } else {
        process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR] = prevGate;
      }
      if (prevUiGate === undefined) {
        delete process.env.VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED;
      } else {
        process.env.VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED = prevUiGate;
      }
    }

    const upstreamOnlyEnv = {
      VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
    };
    const absentClientFlagDisabled =
      isLibraryQuarantineReviewedSourceReleaseEnabled() === false &&
      isLibraryQuarantineReviewedSourceReleaseEnabled(upstreamOnlyEnv) === false;

    const badClientValuesDisabled = [
      '',
      'false',
      'TRUE',
      ' true ',
      '1',
      'yes',
      true,
      null,
      undefined,
    ].every(
      (badVal) =>
        isLibraryQuarantineReviewedSourceReleaseEnabled({
          ...upstreamOnlyEnv,
          VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED: badVal,
        }) === false
    );

    const nonPlainEnvDisabled =
      isLibraryQuarantineReviewedSourceReleaseEnabled([] as unknown as Record<string, unknown>) === false &&
      isLibraryQuarantineReviewedSourceReleaseEnabled(
        Object.create({
          VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
          VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
          VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
          VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
          VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED: 'true',
        })
      ) === false &&
      isLibraryQuarantineReviewedSourceReleaseEnabled({
        ...upstreamOnlyEnv,
        VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'false',
        VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED: 'true',
      }) === false;

    assertCheck(
      '24',
      'Absent, malformed, or upstream-disabled flags fail closed (default-OFF) on both server and client',
      absentReadRejected &&
        absentPublishRejected &&
        malformedValuesRejected &&
        absentClientFlagDisabled &&
        badClientValuesDisabled &&
        nonPlainEnvDisabled
    );
  }

  // TEST 25: Default Modal Panel (Without Explicit Release Flag) Renders Disabled / Hidden
  {
    const upstreamOnlyEnv = {
      VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
    };
    const dummySavedCase: SanitizedLibraryQuarantineHumanReviewCaseDto = {
      schemaVersion: 1,
      receiptId: validReceiptId,
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
    };

    const releaseService = new LibraryReviewedSourceReleaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({ uid: ownerFnUser.id }),
      },
      adminRepository: adminRepo,
      db,
      clock: () => testClock,
    });

    let getStatusCalled = false;
    const defaultController =
      new LibraryQuarantineReviewedSourceReleasePanelController(ownerUiUser, {
        getStatusFn: async (rId) => {
          getStatusCalled = true;
          return releaseService.getReviewedLibrarySourceReleaseStatus({ receiptId: rId });
        },
      });
    await defaultController.openForSavedCase(dummySavedCase);

    const missingFlagHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineReviewedSourceReleaseSection, {
        controller: defaultController,
        currentUser: ownerUiUser,
        savedReviewCase: dummySavedCase,
        hasUnsavedCaseEdits: false,
        isAr: false,
        envOverride: upstreamOnlyEnv,
      })
    );

    const explicitFalseHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineReviewedSourceReleaseSection, {
        controller: defaultController,
        currentUser: ownerUiUser,
        savedReviewCase: dummySavedCase,
        hasUnsavedCaseEdits: false,
        isAr: true,
        envOverride: {
          ...upstreamOnlyEnv,
          VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED: 'false',
        },
      })
    );

    assertCheck(
      '25',
      'Default controller & modal section stay hidden and make zero backend calls when release flag is absent or false',
      getStatusCalled === false &&
        defaultController.getSnapshot().enabled === false &&
        missingFlagHtml === '' &&
        explicitFalseHtml === ''
    );
  }

  // TEST 26: Explicit 'true' Activation Enables Gate While Preserving RBAC, Confirmation, Incident Hold & Binary Exclusion
  {
    const prevGate = process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR];
    let explicitEnvActivatedStatus = false;
    let fourPermRbacStillEnforced = false;
    let aiStillDenied = false;
    let confirmationStillRequired = false;
    let incidentStillRestricted = false;
    let binaryUrlStillRejected = false;

    try {
      process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR] = 'true';

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
        buildHandlerOptions({ reviewedSourceReleaseEnabled: undefined })
      )) as GetReviewedLibrarySourceReleaseStatusResponseDto;
      explicitEnvActivatedStatus = statusRes.ok === true && statusRes.isPublished === true;

      // Without AdminPermission.Publish (RightsReviewer lacks Approve & Publish; Curator lacks Publish)
      try {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: rightsFnUser.id },
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
          buildHandlerOptions({ reviewedSourceReleaseEnabled: undefined })
        );
      } catch (err: any) {
        if (err?.code === 'permission-denied') {
          fourPermRbacStillEnforced = true;
        }
      }

      try {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: aiFnUser.id },
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
        if (err?.code === 'permission-denied') {
          aiStillDenied = true;
        }
      }

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
              confirmation: 'WRONG_CONFIRMATION',
              input: validEditorialInput,
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
          err?.code === 'invalid-argument' &&
          String(err?.message).includes('CONFIRMATION_REQUIRED')
        ) {
          confirmationStillRequired = true;
        }
      }

      const incidentStatusRes = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'getReviewedLibrarySourceReleaseStatus',
            receiptId: '1183ac250d0404e921d2aeadbec1b76c',
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        buildHandlerOptions({ reviewedSourceReleaseEnabled: undefined })
      )) as GetReviewedLibrarySourceReleaseStatusResponseDto;

      const incidentPublishRes = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'publishReviewedLibrarySourceReference',
            receiptId: '1183ac250d0404e921d2aeadbec1b76c',
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
        buildHandlerOptions({ reviewedSourceReleaseEnabled: undefined })
      )) as PublishReviewedLibrarySourceReferenceResponseDto;

      incidentStillRestricted =
        incidentStatusRes.ok === true &&
        incidentStatusRes.eligibleForPublish === false &&
        incidentStatusRes.currentRightsDecision === 'RESTRICTED' &&
        incidentStatusRes.blockCode === 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK' &&
        incidentPublishRes.ok === false &&
        incidentPublishRes.errorCode === 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK';

      const binaryUrlRes = (await executeManageLibraryDocumentsRequest(
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
              verifiedSourceUrl:
                'https://firebasestorage.googleapis.com/v0/b/promiseofplanet-bb325/o/library%2Fquarantine%2Fraw.pdf',
            },
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        buildHandlerOptions({ reviewedSourceReleaseEnabled: undefined })
      )) as PublishReviewedLibrarySourceReferenceResponseDto;
      binaryUrlStillRejected = binaryUrlRes.ok === false;
    } finally {
      if (prevGate === undefined) {
        delete process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR];
      } else {
        process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_ENV_VAR] = prevGate;
      }
    }

    const clientAllTrue = isLibraryQuarantineReviewedSourceReleaseEnabled({
      VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
      VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED: 'true',
    });

    assertCheck(
      '26',
      'Explicit true activates gate while preserving 4-perm RBAC, confirmation, RESTRICTED incident hold, and quarantine binary exclusion',
      explicitEnvActivatedStatus &&
        fourPermRbacStillEnforced &&
        aiStillDenied &&
        confirmationStillRequired &&
        incidentStillRestricted &&
        binaryUrlStillRejected &&
        clientAllTrue === true
    );
  }

  // =========================================================================
  // LIB-DIRECT-FILE-01 TESTS 27–36 (Published Binary Release & Safe Download)
  // =========================================================================

  function buildDeterministicValidPdfBytes(label = 'Promise of Planet Test PDF'): Buffer {
    const body =
      '%PDF-1.7\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      `2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n% ${label}\n` +
      'xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n' +
      'trailer\n<< /Size 3 /Root 1 0 R >>\n' +
      'startxref\n110\n' +
      '%%EOF\n';
    return Buffer.from(body, 'latin1');
  }

  function buildDeterministicValidDocxBytes(label = 'Promise of Planet Test DOCX'): Buffer {
    const entries = [
      {
        name: '[Content_Types].xml',
        data: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '</Types>',
          'utf8'
        ),
      },
      {
        name: '_rels/.rels',
        data: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            '</Relationships>',
          'utf8'
        ),
      },
      {
        name: 'word/document.xml',
        data: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>' +
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            `<w:body><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:body>` +
            '</w:document>',
          'utf8'
        ),
      },
    ];

    const localChunks: Buffer[] = [];
    const centralChunks: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const crc = computeCrc32(entry.data);
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc >>> 0, 14);
      localHeader.writeUInt32LE(entry.data.length, 18);
      localHeader.writeUInt32LE(entry.data.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);
      localChunks.push(localHeader, nameBuf, entry.data);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt16LE(0, 14);
      centralHeader.writeUInt32LE(crc >>> 0, 16);
      centralHeader.writeUInt32LE(entry.data.length, 20);
      centralHeader.writeUInt32LE(entry.data.length, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      centralChunks.push(centralHeader, nameBuf);

      offset += localHeader.length + nameBuf.length + entry.data.length;
    }

    const centralDir = Buffer.concat(centralChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localChunks, centralDir, eocd]);
  }

  interface StoredBucketObject {
    bytes: Buffer;
    metadata: Record<string, unknown>;
  }

  class InMemoryPublishedBinaryBucket implements PublishedBinaryStorageBucket {
    public readonly objects = new Map<string, StoredBucketObject>();
    private nextGen = 1700001000;
    public lastWriteOptions: unknown = null;

    constructor(public readonly name: string = LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME) {}

    public seedObject(
      objectPath: string,
      bytes: Buffer,
      opts?: {
        readonly generation?: string;
        readonly contentType?: string;
        readonly cacheControl?: string;
        readonly contentDisposition?: string;
        readonly metadata?: Record<string, unknown>;
        readonly extraTopMeta?: Record<string, unknown>;
      }
    ): string {
      const generation = opts?.generation ?? String(++this.nextGen);
      this.objects.set(objectPath, {
        bytes: Buffer.from(bytes),
        metadata: {
          bucket: this.name,
          name: objectPath,
          generation,
          size: bytes.length,
          contentType: opts?.contentType ?? CANONICAL_PDF_MIME_TYPE,
          cacheControl: opts?.cacheControl ?? 'no-store, max-age=0',
          contentDisposition: opts?.contentDisposition ?? 'attachment',
          metadata: { ...(opts?.metadata ?? {}) },
          ...(opts?.extraTopMeta ?? {}),
        },
      });
      return generation;
    }

    public file(
      objectPath: string,
      options?: { readonly generation?: string | number }
    ): PublishedBinaryStorageFile {
      const bucket = this;
      return {
        name: objectPath,
        async exists() {
          const entry = bucket.objects.get(objectPath);
          if (!entry) return [false];
          if (
            options?.generation !== undefined &&
            String(entry.metadata.generation) !== String(options.generation)
          ) {
            return [false];
          }
          return [true];
        },
        async getMetadata() {
          const entry = bucket.objects.get(objectPath);
          if (!entry) {
            throw new Error(`OBJECT_NOT_FOUND:${objectPath}`);
          }
          if (
            options?.generation !== undefined &&
            String(entry.metadata.generation) !== String(options.generation)
          ) {
            throw new Error(`GENERATION_MISMATCH:${objectPath}`);
          }
          return [deepClone(entry.metadata) as GcsLibraryQuarantineObjectMetadata];
        },
        async setMetadata(meta: Record<string, unknown>) {
          const entry = bucket.objects.get(objectPath);
          if (!entry) {
            throw new Error(`OBJECT_NOT_FOUND:${objectPath}`);
          }
          entry.metadata = {
            ...entry.metadata,
            ...deepClone(meta),
            metadata: {
              ...((entry.metadata.metadata as Record<string, unknown>) ?? {}),
              ...((meta.metadata as Record<string, unknown>) ?? {}),
            },
          };
          return [deepClone(entry.metadata) as GcsLibraryQuarantineObjectMetadata];
        },
        createReadStream() {
          const entry = bucket.objects.get(objectPath);
          if (!entry) {
            return Readable.from(
              (async function* () {
                throw new Error(`OBJECT_NOT_FOUND:${objectPath}`);
              })()
            );
          }
          if (
            options?.generation !== undefined &&
            String(entry.metadata.generation) !== String(options.generation)
          ) {
            return Readable.from(
              (async function* () {
                throw new Error(`GENERATION_MISMATCH:${objectPath}`);
              })()
            );
          }
          const bytes = Buffer.from(entry.bytes);
          const mid = Math.max(1, Math.floor(bytes.length / 2));
          const chunks =
            mid < bytes.length
              ? [bytes.subarray(0, mid), bytes.subarray(mid)]
              : [bytes];
          return Readable.from(chunks);
        },
        createWriteStream(writeOptions?: {
          readonly preconditionOpts?: { readonly ifGenerationMatch?: number };
          readonly resumable?: boolean;
          readonly validation?: false | 'crc32c' | 'md5';
          readonly metadata?: Record<string, unknown>;
        }) {
          bucket.lastWriteOptions = writeOptions ?? null;
          const emitter = new EventEmitter() as EventEmitter & {
            end: (chunk?: Buffer) => void;
            destroy?: (err?: Error) => void;
          };
          const chunks: Buffer[] = [];
          emitter.destroy = () => {};
          emitter.end = (chunk?: Buffer) => {
            queueMicrotask(() => {
              const existing = bucket.objects.get(objectPath);
              if (
                writeOptions?.preconditionOpts?.ifGenerationMatch === 0 &&
                existing !== undefined
              ) {
                const err = new Error('ALREADY_EXISTS: ifGenerationMatch=0 failed');
                emitter.emit('error', err);
                return;
              }
              if (chunk) {
                chunks.push(Buffer.from(chunk));
              }
              const bytes = Buffer.concat(chunks);
              const gen = String(++bucket.nextGen);
              const metaInput = writeOptions?.metadata ?? {};
              bucket.objects.set(objectPath, {
                bytes,
                metadata: {
                  bucket: bucket.name,
                  name: objectPath,
                  generation: gen,
                  size: bytes.length,
                  ...deepClone(metaInput),
                },
              });
              emitter.emit('finish');
            });
          };
          return emitter;
        },
        async save(
          data: Buffer,
          saveOptions: {
            readonly contentType: string;
            readonly resumable: false;
            readonly preconditionOpts: { readonly ifGenerationMatch: 0 };
            readonly preconditions: { readonly ifGenerationMatch: 0 };
            readonly metadata: {
              readonly cacheControl: string;
              readonly contentDisposition: string;
              readonly metadata: Readonly<Record<string, string>>;
            };
          }
        ) {
          bucket.lastWriteOptions = saveOptions;
          const existing = bucket.objects.get(objectPath);
          if (
            saveOptions?.preconditionOpts?.ifGenerationMatch === 0 &&
            existing !== undefined
          ) {
            const err = new Error('ALREADY_EXISTS: ifGenerationMatch=0 failed') as Error & {
              code: number;
            };
            err.code = 412;
            throw err;
          }
          const bytes = Buffer.from(data);
          const gen = String(++bucket.nextGen);
          bucket.objects.set(objectPath, {
            bytes,
            metadata: {
              bucket: bucket.name,
              name: objectPath,
              generation: gen,
              size: bytes.length,
              contentType: saveOptions.contentType,
              cacheControl: saveOptions.metadata.cacheControl,
              contentDisposition: saveOptions.metadata.contentDisposition,
              metadata: { ...saveOptions.metadata.metadata },
            },
          });
        },
        acl: {
          async get() {
            return [[]];
          },
        },
      };
    }
  }

  class InMemoryHttpResponseRecorder
    implements PublishedBinaryDownloadHttpResponseWriter
  {
    public statusCode = 200;
    public readonly headers = new Map<string, string>();
    public bodyBuffer: Buffer | null = null;
    public jsonBody: unknown = null;
    public ended = false;

    status(code: number): PublishedBinaryDownloadHttpResponseWriter {
      this.statusCode = code;
      return this;
    }
    setHeader(name: string, value: string): PublishedBinaryDownloadHttpResponseWriter {
      this.headers.set(name.toLowerCase(), value);
      return this;
    }
    getHeader(name: string): string | undefined {
      return this.headers.get(name.toLowerCase());
    }
    json(body: unknown): void {
      this.jsonBody = body;
      this.ended = true;
    }
    send(body: Buffer | string): void {
      this.bodyBuffer = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(body, 'utf8');
      this.ended = true;
    }
    end(chunk?: Buffer | string): void {
      if (chunk !== undefined) {
        this.bodyBuffer = Buffer.isBuffer(chunk)
          ? Buffer.from(chunk)
          : Buffer.from(chunk, 'utf8');
      }
      this.ended = true;
    }
  }

  function seedCleanBinaryChain(
    db: InMemoryReleaseFirestoreDatabase,
    bucket: InMemoryPublishedBinaryBucket,
    opts: {
      readonly receiptId: string;
      readonly format: 'PDF' | 'DOCX';
      readonly bytes: Buffer;
      readonly priorRightsDecision?: LibraryQuarantineRightsDecisionStatus | null;
      readonly avState?:
        | 'MISSING'
        | 'RUNNING'
        | 'AV_THREAT_DETECTED'
        | 'AV_NO_THREAT_DETECTED'
        | 'STALE_SHA'
        | 'STALE_GENERATION'
        | 'STALE_REVISION';
      readonly includeSafetyCase?: boolean;
      readonly includeInspectionRequest?: boolean;
      readonly sourceVerificationStatus?: 'Verified' | 'PendingVerification';
    }
  ): {
    readonly sha256: string;
    readonly generation: string;
    readonly safetyCaseRevision: number;
    readonly avRequestId: string;
  } {
    const { receiptId, format, bytes } = opts;
    const ext = format === 'PDF' ? 'pdf' : 'docx';
    const mime =
      format === 'PDF' ? CANONICAL_PDF_MIME_TYPE : CANONICAL_DOCX_MIME_TYPE;
    const deepStatus =
      format === 'PDF'
        ? 'PDF_REQUIRES_ISOLATED_PARSER'
        : 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storagePath = `library/quarantine/${receiptId}/source.${ext}`;
    const generation = bucket.seedObject(storagePath, bytes, {
      contentType: mime,
      metadata: {
        receiptId,
        sha256,
        format,
        deepInspectionStatus: deepStatus,
        isSanitized: 'false',
        isVerifiedSafe: 'false',
      },
    });

    seedReviewedChain(db, {
      receiptId,
      humanCaseRevision: 6,
      alignedCaseRevision: 6,
      alignmentRevision: 1,
      rightsDecision:
        opts.priorRightsDecision !== undefined
          ? opts.priorRightsDecision
          : 'RESTRICTED',
      sourceVerificationStatus: opts.sourceVerificationStatus ?? 'Verified',
    });

    // Update receipt + draft + handoff + rights to match real binary bytes + sha256 + format + generation
    const receiptEnv = db.getRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      receiptId
    ) as unknown as LibraryQuarantinePersistedReceiptEnvelope;
    const patchedReceipt: LibraryQuarantinePersistedReceiptEnvelope = {
      ...receiptEnv,
      receipt: {
        ...receiptEnv.receipt,
        originalFilename: `incident-document.${ext}`,
        sanitizedFilename: `incident-document.${ext}`,
        format,
        canonicalExtension: ext,
        canonicalMimeType: mime,
        byteSize: bytes.length,
        sha256,
        deepInspectionStatus: deepStatus,
        storagePath,
        generation,
      },
    };
    db.seedDoc(LIBRARY_QUARANTINE_RECEIPT_COLLECTION, receiptId, patchedReceipt);

    const draftDoc = db.getRawDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      receiptId
    ) as Record<string, unknown>;
    db.seedDoc(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION, receiptId, {
      ...draftDoc,
      sourceSha256: sha256,
      format,
    });

    const handoffDoc = db.getRawDoc(
      LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
      receiptId
    ) as Record<string, unknown>;
    db.seedDoc(LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION, receiptId, {
      ...handoffDoc,
      sourceSha256: sha256,
    });

    const alignDoc = db.getRawDoc(
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
      receiptId
    ) as Record<string, unknown>;
    db.seedDoc(LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION, receiptId, {
      ...alignDoc,
      sourceSha256: sha256,
    });

    const caseDoc = db.getRawDoc(
      LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
      receiptId
    ) as Record<string, unknown>;
    db.seedDoc(LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION, receiptId, {
      ...caseDoc,
      sourceSha256: sha256,
    });

    const rightsDoc = db.getRawDoc(
      LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
      receiptId
    );
    if (rightsDoc) {
      db.seedDoc(LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION, receiptId, {
        ...rightsDoc,
        sourceSha256: sha256,
      });
    }

    const safetyCaseRevision = 1;
    const qcatId = deriveQuarantineCatalogDocumentId(receiptId);

    if (opts.includeSafetyCase !== false) {
      const safetyCase: LibraryQuarantinePersistedBinarySafetyCase = {
        schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
        receiptId,
        documentId: qcatId,
        revision: safetyCaseRevision,
        sourceRevision: 2,
        sourceUpdatedAt: receiptEnv.receipt.updatedAt,
        sourceSha256: sha256,
        sourceFormat: format,
        deepInspectionStatus: deepStatus,
        effectiveHumanCaseRevision: 6,
        effectiveHumanCaseUpdatedAt: '2026-11-14T14:44:40.569Z',
        catalogUpdatedAt: '2026-11-14T15:00:00.000Z',
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'Owner Safety Case Review #1',
        evidenceNotes:
          'Requires isolated ClamAV malware scan before any binary release.',
        reviewNotes:
          'Maintain fail-closed quarantine until clean ClamAV terminal execution.',
        createdBy: 'admin-owner-1',
        createdAt: '2026-11-15T10:00:00.000Z',
        updatedBy: 'admin-owner-1',
        updatedAt: '2026-11-15T10:00:00.000Z',
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      };
      db.seedDoc(
        LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
        receiptId,
        safetyCase
      );
    }

    const avRequestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
      receiptId,
      receiptEnv.revision,
      safetyCaseRevision
    );

    if (opts.includeInspectionRequest !== false) {
      const reqDoc: LibraryQuarantinePersistedIsolatedInspectionRequest = {
        schemaVersion:
          LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
        requestId: avRequestId,
        receiptId,
        documentId: qcatId,
        sourceRevision: 2,
        sourceUpdatedAt: receiptEnv.receipt.updatedAt,
        sourceSha256: sha256,
        sourceGeneration: generation,
        sourceByteSize: bytes.length,
        sourceFormat: format,
        deepInspectionStatus: deepStatus,
        safetyCaseRevision,
        effectiveHumanCaseRevision: 6,
        catalogUpdatedAt: '2026-11-14T15:00:00.000Z',
        requestedBy: 'admin-owner-1',
        requestedAt: '2026-11-15T10:05:00.000Z',
        state: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
        dispatched: false,
        scanPerformed: false,
        sanitized: false,
        isVerifiedSafe: false,
        isPublished: false,
        isReadyForPeia: false,
      };
      db.seedDoc(
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
        avRequestId,
        reqDoc
      );
    }

    const avMode = opts.avState ?? 'AV_NO_THREAT_DETECTED';
    if (avMode !== 'MISSING') {
      const avExec: LibraryQuarantinePersistedAvExecution = {
        schemaVersion: LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
        requestId: avRequestId,
        receiptId,
        documentId: qcatId,
        revision: avMode === 'RUNNING' ? 2 : 3,
        safetyCaseRevision,
        sourceRevision: 2,
        sourceUpdatedAt: receiptEnv.receipt.updatedAt,
        sourceSha256:
          avMode === 'STALE_SHA' ? 'f'.repeat(64) : sha256,
        sourceGeneration:
          avMode === 'STALE_GENERATION' ? '9999999999' : generation,
        sourceByteSize: bytes.length,
        sourceFormat: format,
        deepInspectionStatus: deepStatus,
        effectiveHumanCaseRevision:
          avMode === 'STALE_REVISION' ? 5 : 6,
        catalogUpdatedAt: '2026-11-14T15:00:00.000Z',
        state:
          avMode === 'RUNNING'
            ? 'RUNNING'
            : avMode === 'AV_THREAT_DETECTED'
              ? 'AV_THREAT_DETECTED'
              : 'AV_NO_THREAT_DETECTED',
        dispatchedBy: 'admin-owner-1',
        dispatchedAt: '2026-11-15T10:10:00.000Z',
        workerRunId: 'exec-clamav-worker-001',
        workerClaimedAt: '2026-11-15T10:10:05.000Z',
        completedAt:
          avMode === 'RUNNING' ? null : '2026-11-15T10:10:12.000Z',
        engineName: avMode === 'RUNNING' ? null : 'ClamAV',
        engineVersion: avMode === 'RUNNING' ? null : '1.4.2',
        signatureVersion: avMode === 'RUNNING' ? null : '27501',
        signatureUpdatedAt:
          avMode === 'RUNNING' ? null : '2026-11-15T08:00:00.000Z',
        scannedBytes: avMode === 'RUNNING' ? null : bytes.length,
        exitCode:
          avMode === 'RUNNING' ? null : avMode === 'AV_THREAT_DETECTED' ? 1 : 0,
        failureReasonCode: null,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      };
      db.seedDoc(
        LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
        avRequestId,
        avExec
      );

      if (format === 'PDF') {
        const pdfInspection: LibraryQuarantinePersistedPdfInspection = {
          schemaVersion: LIBRARY_QUARANTINE_PDF_INSPECTION_SCHEMA_VERSION,
          requestId: avRequestId,
          receiptId,
          documentId: qcatId,
          sourceRevision: 2,
          sourceUpdatedAt: receiptEnv.receipt.updatedAt,
          sourceSha256: sha256,
          sourceGeneration: generation,
          sourceByteSize: bytes.length,
          sourceFormat: 'PDF',
          deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
          safetyCaseRevision,
          effectiveHumanCaseRevision: 6,
          catalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          workerRunId: 'exec-clamav-worker-001',
          inspectedAt: '2026-11-15T10:10:12.000Z',
          avCompletedAt: '2026-11-15T10:10:12.000Z',
          outcome: LIBRARY_QUARANTINE_PDF_INSPECTION_OUTCOME_VERIFIED,
          parserName: 'qpdf',
          parserVersion: '11.9.1',
          structuralPolicyVersion: LIBRARY_QUARANTINE_PDF_INSPECTION_POLICY_VERSION,
          xrefFormat: 'TABLE',
          parsedObjectCount: 3,
          compressedObjectStreamsParsed: 0,
          warningCount: 0,
          encrypted: false,
          activeOrExternalConstructsDetected: false,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        };
        db.seedDoc(
          LIBRARY_QUARANTINE_PDF_INSPECTIONS_COLLECTION,
          avRequestId,
          pdfInspection
        );
      }
    }

    return {
      sha256,
      generation,
      safetyCaseRevision,
      avRequestId,
    };
  }

  // TEST 27: Reuse Existing Incident 1183ac... & Case v6 (Zero Re-Upload), Publish Real PDF + Real DOCX, Verify Byte-for-Byte HTTP GET/HEAD Download & Non-Assurance Flags
  {
    const prevGate = process.env[LIBRARY_PUBLISHED_BINARY_RELEASE_ENV_VAR];
    const prevAvGate = process.env.POP_LIBRARY_AV_EXECUTION_ENABLED;
    try {
      const incidentId = '1183ac250d0404e921d2aeadbec1b76c';
      const docxId = 'deadbeefcafebabe0011223344556677';
      const pdfBytes = buildDeterministicValidPdfBytes('Sudan Environmental Act 2026 PDF');
      const docxBytes = buildDeterministicValidDocxBytes('Sudan Environmental Policy 2026 DOCX');

      const binDb = new InMemoryReleaseFirestoreDatabase();
      const binBucket = new InMemoryPublishedBinaryBucket();

      const pdfMeta = seedCleanBinaryChain(binDb, binBucket, {
        receiptId: incidentId,
        format: 'PDF',
        bytes: pdfBytes,
        priorRightsDecision: 'RESTRICTED',
      });
      const docxMeta = seedCleanBinaryChain(binDb, binBucket, {
        receiptId: docxId,
        format: 'DOCX',
        bytes: docxBytes,
        priorRightsDecision: 'RESTRICTED',
      });

      const handlerOpts = {
        ...buildHandlerOptions({
          binarySafetyCaseEnabled: true,
          isolatedInspectionRequestEnabled: true,
          avExecutionEnabled: false,
          publishedBinaryReleaseEnabled: true,
        }),
        draftDatabase: binDb,
        publishedBinaryStorageBucket: binBucket,
        publishedBinaryReleaseClock: () => '2026-11-16T10:00:00.000Z',
      };

      const pdfStatus = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'getPublishedLibraryBinaryReleaseStatus',
            receiptId: incidentId,
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        handlerOpts
      )) as ClientGetPublishedBinaryStatusDto;

      assert(pdfStatus.ok && pdfStatus.status === 'READY');
      assert(pdfStatus.eligibleForPublish === true);
      assert(pdfStatus.currentHumanCaseRevision === 6);
      assert(pdfStatus.requiresContradictionResolution === true);
      assert(pdfStatus.currentPriorRightsDecision === 'RESTRICTED');

      const publishPdf = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'publishQuarantinedBinaryToPublicLibrary',
            receiptId: incidentId,
            expectedHumanCaseRevision: 6,
            expectedCatalogUpdatedAt: pdfStatus.catalogUpdatedAt,
            expectedAlignmentRevision: pdfStatus.currentAlignmentRevision,
            expectedSafetyCaseRevision: pdfMeta.safetyCaseRevision,
            expectedAvRequestId: pdfMeta.avRequestId,
            expectedPriorRightsDecisionRevision:
              pdfStatus.currentPriorRightsDecisionRevision,
            confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
            input: {
              publicRightsStatus: 'PermissionGranted',
              binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
              rightsEvidenceReference: 'Owner Direct Release Memo #01',
              rightsEvidenceSummary:
                'Owner explicitly authorizes public PDF download of uploaded file.',
              releaseNotes: 'First direct PDF release from existing case v6.',
              downloadFilename: 'sudan-water-act-2026.pdf',
              acknowledgePriorRestrictedDecision: true,
              contradictionResolutionSummary:
                'Prior RESTRICTED applied to catalog metadata handoff; owner authorizes public binary download.',
            },
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        handlerOpts
      )) as ClientPublishBinaryResponseDto;

      const publishDocx = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'publishQuarantinedBinaryToPublicLibrary',
            receiptId: docxId,
            expectedHumanCaseRevision: 6,
            expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
            expectedAlignmentRevision: 1,
            expectedSafetyCaseRevision: docxMeta.safetyCaseRevision,
            expectedAvRequestId: docxMeta.avRequestId,
            expectedPriorRightsDecisionRevision: 1,
            confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
            input: {
              publicRightsStatus: 'OpenPubliclyAvailable',
              binaryRightsBasis: 'EXPLICIT_BINARY_REDISTRIBUTION_PERMISSION',
              rightsEvidenceReference: 'Official Ministry License #99',
              rightsEvidenceSummary:
                'Written explicit permission authorizing Word DOCX redistribution.',
              downloadFilename: 'sudan-policy-2026.docx',
              acknowledgePriorRestrictedDecision: true,
              contradictionResolutionSummary:
                'Ministry written permission supersedes earlier metadata restriction.',
            },
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        handlerOpts
      )) as ClientPublishBinaryResponseDto;

      assert(
        publishPdf.ok === true && publishPdf.status === 'PUBLISHED',
        `publishPdf failed: ${JSON.stringify(publishPdf)}`
      );
      assert(
        publishDocx.ok === true && publishDocx.status === 'PUBLISHED',
        `publishDocx failed: ${JSON.stringify(publishDocx)}`
      );

      // Check quarantine draft stayed Draft, prior RESTRICTED decision stayed immutable, released object matches SHA & privacy
      const rawQcat = binDb.getRawDoc(
        LIBRARY_DOCUMENTS_COLLECTION,
        deriveQuarantineCatalogDocumentId(incidentId)
      );
      const rawPriorRights = binDb.getRawDoc(
        LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
        incidentId
      );
      const releasedPdfObj = binBucket.objects.get(
        `library/released/${incidentId}/v1/document.pdf`
      );
      const releasedDocxObj = binBucket.objects.get(
        `library/released/${docxId}/v1/document.docx`
      );

      // Verify PublicLibraryRepository lists doc-qbin-* and NEVER qcat-*
      const publicRepoOnBinDb = new PublicLibraryRepository(
        new DbBackedLibraryRepository(binDb)
      );
      const listedPublic = await publicRepoOnBinDb.listPublicDocuments();
      const pdfPublicDocId = derivePublishedBinaryPublicLibraryDocumentId(incidentId);
      const docxPublicDocId = derivePublishedBinaryPublicLibraryDocumentId(docxId);
      const listedIds = new Set(listedPublic.map((d) => d.id));

      // Execute anonymous HTTP GET + HEAD download handler on both PDF and DOCX
      const dlHandler = createPublishedBinaryDownloadHandler({
        db: binDb,
        storageBucket: binBucket,
      });

      const pdfGetRes = new InMemoryHttpResponseRecorder();
      await dlHandler(
        { method: 'GET', path: '/', query: { documentId: pdfPublicDocId } },
        pdfGetRes
      );
      const pdfHeadRes = new InMemoryHttpResponseRecorder();
      await dlHandler(
        { method: 'HEAD', path: '/', query: { documentId: pdfPublicDocId } },
        pdfHeadRes
      );
      const docxGetRes = new InMemoryHttpResponseRecorder();
      await dlHandler(
        { method: 'GET', path: '/', query: { documentId: docxPublicDocId } },
        docxGetRes
      );

      assertCheck(
        '27',
        'Existing incident 1183ac... & case v6 + new DOCX publish cleanly (qcat Draft preserved, RESTRICTED untouched, byte-for-byte HTTP GET/HEAD download, non-assurance flags preserved)',
        publishPdf.isSanitized === false &&
          publishPdf.isVerifiedSafe === false &&
          publishPdf.quarantineDraftRemainsDraft === true &&
          rawQcat?.workflowState === FnWorkflowState.Draft &&
          rawPriorRights?.decision === 'RESTRICTED' &&
          rawPriorRights?.revision === 1 &&
          releasedPdfObj !== undefined &&
          Buffer.compare(releasedPdfObj.bytes, pdfBytes) === 0 &&
          releasedDocxObj !== undefined &&
          Buffer.compare(releasedDocxObj.bytes, docxBytes) === 0 &&
          listedIds.has(pdfPublicDocId) &&
          listedIds.has(docxPublicDocId) &&
          !listedIds.has(deriveQuarantineCatalogDocumentId(incidentId)) &&
          pdfGetRes.statusCode === 200 &&
          pdfGetRes.bodyBuffer !== null &&
          Buffer.compare(pdfGetRes.bodyBuffer, pdfBytes) === 0 &&
          pdfGetRes.getHeader('content-type') === CANONICAL_PDF_MIME_TYPE &&
          String(pdfGetRes.getHeader('content-disposition')).startsWith('attachment;') &&
          pdfGetRes.getHeader('x-content-type-options') === 'nosniff' &&
          pdfGetRes.getHeader('content-security-policy') === "default-src 'none'; sandbox" &&
          pdfGetRes.getHeader('cache-control') === 'private, no-store, max-age=0' &&
          pdfHeadRes.statusCode === 200 &&
          pdfHeadRes.bodyBuffer === null &&
          pdfHeadRes.getHeader('content-length') === String(pdfBytes.length) &&
          docxGetRes.statusCode === 200 &&
          docxGetRes.bodyBuffer !== null &&
          Buffer.compare(docxGetRes.bodyBuffer, docxBytes) === 0 &&
          docxGetRes.getHeader('content-type') === CANONICAL_DOCX_MIME_TYPE
      );
    } finally {
      if (prevGate === undefined) delete process.env[LIBRARY_PUBLISHED_BINARY_RELEASE_ENV_VAR];
      else process.env[LIBRARY_PUBLISHED_BINARY_RELEASE_ENV_VAR] = prevGate;
      if (prevAvGate === undefined) delete process.env.POP_LIBRARY_AV_EXECUTION_ENABLED;
      else process.env.POP_LIBRARY_AV_EXECUTION_ENABLED = prevAvGate;
    }
  }

  // TEST 28: Missing/Pending/Threat/Stale AV Scan & Pre-Rights Holds Strictly Block Publication
  {
    const pdfBytes = buildDeterministicValidPdfBytes('AV Gate Test');
    const scenarios = [
      { avState: 'MISSING' as const, expectedCode: 'WAITING_FOR_ACTUAL_SCAN' },
      { avState: 'RUNNING' as const, expectedCode: 'WAITING_FOR_ACTUAL_SCAN' },
      { avState: 'AV_THREAT_DETECTED' as const, expectedCode: 'AV_THREAT_DETECTED' },
      { avState: 'STALE_SHA' as const, expectedCode: 'AV_SCAN_STALE_HOLD' },
      { avState: 'STALE_GENERATION' as const, expectedCode: 'AV_SCAN_STALE_HOLD' },
      { avState: 'STALE_REVISION' as const, expectedCode: 'AV_SCAN_STALE_HOLD' },
    ];

    let allBlocked = true;
    for (let i = 0; i < scenarios.length; i += 1) {
      const sc = scenarios[i];
      const rid = `a111111111111111111111111111111${i}`;
      const binDb = new InMemoryReleaseFirestoreDatabase();
      const binBucket = new InMemoryPublishedBinaryBucket();
      const meta = seedCleanBinaryChain(binDb, binBucket, {
        receiptId: rid,
        format: 'PDF',
        bytes: pdfBytes,
        avState: sc.avState,
      });

      const opts = {
        ...buildHandlerOptions({
          binarySafetyCaseEnabled: true,
          isolatedInspectionRequestEnabled: true,
          avExecutionEnabled: false,
          publishedBinaryReleaseEnabled: true,
        }),
        draftDatabase: binDb,
        publishedBinaryStorageBucket: binBucket,
        publishedBinaryReleaseClock: () => '2026-11-16T10:00:00.000Z',
      };

      const st = (await executeManageLibraryDocumentsRequest(
        { auth: { uid: ownerFnUser.id }, data: { action: 'getPublishedLibraryBinaryReleaseStatus', receiptId: rid } },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        opts
      )) as ClientGetPublishedBinaryStatusDto;

      const pubRes = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'publishQuarantinedBinaryToPublicLibrary',
            receiptId: rid,
            expectedHumanCaseRevision: 6,
            expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
            expectedAlignmentRevision: 1,
            expectedSafetyCaseRevision: meta.safetyCaseRevision,
            expectedAvRequestId: meta.avRequestId,
            expectedPriorRightsDecisionRevision: 1,
            confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
            input: {
              publicRightsStatus: 'PermissionGranted',
              binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
              rightsEvidenceReference: 'Owner Memo',
              rightsEvidenceSummary: 'Owner explicit binary permission summary text.',
              downloadFilename: 'blocked.pdf',
              acknowledgePriorRestrictedDecision: true,
              contradictionResolutionSummary: 'Resolved prior restriction cleanly.',
            },
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        opts
      )) as ClientPublishBinaryResponseDto;

      if (
        !st.ok ||
        st.eligibleForPublish !== false ||
        st.isScanCleanForCurrentRevision !== false ||
        st.blockCode !== sc.expectedCode ||
        pubRes.ok !== false ||
        pubRes.status !== 'HOLD' ||
        pubRes.errorCode !== sc.expectedCode ||
        binDb.listCollectionDocs(LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION).length !== 0
      ) {
        allBlocked = false;
      }
    }

    assertCheck(
      '28',
      'Missing, running, infected, or stale-provenance ClamAV scans strictly hold publication with zero fabricated clean verdicts or Firestore writes',
      allBlocked
    );
  }

  // TEST 29: Metadata-Only Rights Text & Unacknowledged Prior RESTRICTED Decision Rejected Without Mutating Prior Rights Doc
  {
    const rid = 'b2222222222222222222222222222222';
    const pdfBytes = buildDeterministicValidPdfBytes('Rights Guard Test');
    const binDb = new InMemoryReleaseFirestoreDatabase();
    const binBucket = new InMemoryPublishedBinaryBucket();
    const meta = seedCleanBinaryChain(binDb, binBucket, {
      receiptId: rid,
      format: 'PDF',
      bytes: pdfBytes,
      priorRightsDecision: 'RESTRICTED',
    });

    const opts = {
      ...buildHandlerOptions({
        binarySafetyCaseEnabled: true,
        isolatedInspectionRequestEnabled: true,
        publishedBinaryReleaseEnabled: true,
      }),
      draftDatabase: binDb,
      publishedBinaryStorageBucket: binBucket,
      publishedBinaryReleaseClock: () => '2026-11-16T10:00:00.000Z',
    };

    const unackRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: meta.safetyCaseRevision,
          expectedAvRequestId: meta.avRequestId,
          expectedPriorRightsDecisionRevision: 1,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Owner Memo',
            rightsEvidenceSummary: 'Explicit binary authorization note.',
            downloadFilename: 'doc.pdf',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientPublishBinaryResponseDto;

    const metadataOnlyRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: meta.safetyCaseRevision,
          expectedAvRequestId: meta.avRequestId,
          expectedPriorRightsDecisionRevision: 1,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Catalog Note',
            rightsEvidenceSummary: 'Reusing METADATA_USE_CLEARED and CATALOG_METADATA_ONLY.',
            downloadFilename: 'doc.pdf',
            acknowledgePriorRestrictedDecision: true,
            contradictionResolutionSummary: 'Explaining override cleanly.',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientPublishBinaryResponseDto;

    assertCheck(
      '29',
      'Unacknowledged prior RESTRICTED decision and CATALOG_METADATA_ONLY substitutes are both rejected while keeping prior rights record immutable',
      unackRes.ok === false &&
        unackRes.errorCode === 'PRIOR_RIGHTS_CONTRADICTION_UNRESOLVED' &&
        metadataOnlyRes.ok === false &&
        metadataOnlyRes.errorCode === 'BINARY_RIGHTS_EVIDENCE_REQUIRED' &&
        binDb.listCollectionDocs(LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION).length === 0
    );
  }

  // TEST 30: Duplicate Click Idempotency, CAS Revision Drift Conflict, Already-Exists Conflict & Uncertain Transaction Commit Hold
  {
    const rid = 'c3333333333333333333333333333333';
    const pdfBytes = buildDeterministicValidPdfBytes('Concurrency Test');
    const binDb = new InMemoryReleaseFirestoreDatabase();
    const binBucket = new InMemoryPublishedBinaryBucket();
    const meta = seedCleanBinaryChain(binDb, binBucket, {
      receiptId: rid,
      format: 'PDF',
      bytes: pdfBytes,
      priorRightsDecision: null,
    });

    const opts = {
      ...buildHandlerOptions({
        binarySafetyCaseEnabled: true,
        isolatedInspectionRequestEnabled: true,
        publishedBinaryReleaseEnabled: true,
      }),
      draftDatabase: binDb,
      publishedBinaryStorageBucket: binBucket,
      publishedBinaryReleaseClock: () => '2026-11-16T10:00:00.000Z',
    };

    // Stale case revision -> RELEASE_PRECONDITION_CONFLICT
    const staleCasRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 5,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: meta.safetyCaseRevision,
          expectedAvRequestId: meta.avRequestId,
          expectedPriorRightsDecisionRevision: null,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Owner Memo',
            rightsEvidenceSummary: 'Explicit owner binary release statement.',
            downloadFilename: 'cas-test.pdf',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientPublishBinaryResponseDto;

    // Simulate UNKNOWN lost transaction commit ACK (throws after staging writes -> rolls back working copy)
    const binDbUncertain = new InMemoryReleaseFirestoreDatabase();
    const binBucketUncertain = new InMemoryPublishedBinaryBucket();
    const metaUnc = seedCleanBinaryChain(binDbUncertain, binBucketUncertain, {
      receiptId: rid,
      format: 'PDF',
      bytes: pdfBytes,
      priorRightsDecision: null,
    });
    binDbUncertain.onAfterTransactionWritesStagedHook = () => {
      throw new Error('DEADLINE_EXCEEDED: Commit response lost');
    };
    const unknownRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: metaUnc.safetyCaseRevision,
          expectedAvRequestId: metaUnc.avRequestId,
          expectedPriorRightsDecisionRevision: null,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Owner Memo',
            rightsEvidenceSummary: 'Explicit owner binary release statement.',
            downloadFilename: 'uncertain-test.pdf',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ...opts,
        draftDatabase: binDbUncertain,
        publishedBinaryStorageBucket: binBucketUncertain,
      }
    )) as ClientPublishBinaryResponseDto;

    // First clean publish -> PUBLISHED; identical duplicate -> ALREADY_PUBLISHED; mismatched input on existing -> RELEASE_ALREADY_EXISTS_CONFLICT
    const firstPub = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: meta.safetyCaseRevision,
          expectedAvRequestId: meta.avRequestId,
          expectedPriorRightsDecisionRevision: null,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Owner Memo',
            rightsEvidenceSummary: 'Explicit owner binary release statement.',
            downloadFilename: 'idem.pdf',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientPublishBinaryResponseDto;

    const dupPub = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: meta.safetyCaseRevision,
          expectedAvRequestId: meta.avRequestId,
          expectedPriorRightsDecisionRevision: null,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Owner Memo',
            rightsEvidenceSummary: 'Explicit owner binary release statement.',
            downloadFilename: 'idem.pdf',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientPublishBinaryResponseDto;

    const conflictingExistingRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: meta.safetyCaseRevision,
          expectedAvRequestId: meta.avRequestId,
          expectedPriorRightsDecisionRevision: null,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'OpenPubliclyAvailable',
            binaryRightsBasis: 'PUBLIC_DOMAIN_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Different Ref',
            rightsEvidenceSummary: 'Different payload after already published.',
            downloadFilename: 'other.pdf',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientPublishBinaryResponseDto;

    assertCheck(
      '30',
      'CAS drift returns RELEASE_PRECONDITION_CONFLICT, commit ambiguity returns UNKNOWN, identical duplicate returns ALREADY_PUBLISHED, differing repeat returns RELEASE_ALREADY_EXISTS_CONFLICT',
      staleCasRes.ok === false &&
        staleCasRes.errorCode === 'RELEASE_PRECONDITION_CONFLICT' &&
        unknownRes.ok === false &&
        unknownRes.status === 'UNKNOWN' &&
        unknownRes.published === null &&
        unknownRes.errorCode === 'TRANSACTION_COMMIT_UNCERTAIN' &&
        firstPub.ok === true &&
        firstPub.status === 'PUBLISHED' &&
        dupPub.ok === true &&
        dupPub.status === 'ALREADY_PUBLISHED' &&
        dupPub.publishedChanged === false &&
        conflictingExistingRes.ok === false &&
        conflictingExistingRes.errorCode === 'RELEASE_ALREADY_EXISTS_CONFLICT'
    );
  }

  // TEST 31: Strict 4-Permission Human RBAC, AI Denial, No Secret Leaks, and Bad Filename / `.doc` Rejection
  {
    const rid = 'd4444444444444444444444444444444';
    const pdfBytes = buildDeterministicValidPdfBytes('RBAC & Filename Test');
    const binDb = new InMemoryReleaseFirestoreDatabase();
    const binBucket = new InMemoryPublishedBinaryBucket();
    const meta = seedCleanBinaryChain(binDb, binBucket, {
      receiptId: rid,
      format: 'PDF',
      bytes: pdfBytes,
      priorRightsDecision: null,
    });

    const opts = {
      ...buildHandlerOptions({
        binarySafetyCaseEnabled: true,
        isolatedInspectionRequestEnabled: true,
        publishedBinaryReleaseEnabled: true,
      }),
      draftDatabase: binDb,
      publishedBinaryStorageBucket: binBucket,
      publishedBinaryReleaseClock: () => '2026-11-16T10:00:00.000Z',
    };

    let deniedCount = 0;
    for (const actorUid of [
      rightsFnUser.id,
      aiFnUser.id,
      'nonexistent-user-id',
    ]) {
      try {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: actorUid },
            data: {
              action: 'getPublishedLibraryBinaryReleaseStatus',
              receiptId: rid,
            },
          },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          undefined,
          opts
        );
      } catch (err: any) {
        if (err?.code === 'permission-denied') {
          deniedCount += 1;
        }
      }
    }

    const clientRbacChecks =
      canUserPublishQuarantinedBinaryToPublicLibrary(ownerUiUser) === true &&
      canUserPublishQuarantinedBinaryToPublicLibrary(curatorUiUser) === false &&
      canUserPublishQuarantinedBinaryToPublicLibrary(rightsUiUser) === false &&
      canUserPublishQuarantinedBinaryToPublicLibrary({
        ...ownerUiUser,
        role: AdminRole.AIAssistant,
      }) === false &&
      canUserPublishQuarantinedBinaryToPublicLibrary({
        ...ownerUiUser,
        permissions: [AdminPermission.Review, AdminPermission.ManageRights],
      }) === false;

    let badFilenameRejected = 0;
    for (const badName of [
      '../escape.pdf',
      'evil\u202Efdp.pdf',
      'legacy.doc',
      'mismatch.docx',
      'bad|name.pdf',
    ]) {
      try {
        validateClientBinaryDownloadFilename(badName, 'PDF');
      } catch {
        badFilenameRejected += 1;
      }
    }

    const serverBadFilenameRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: meta.safetyCaseRevision,
          expectedAvRequestId: meta.avRequestId,
          expectedPriorRightsDecisionRevision: null,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Owner Memo',
            rightsEvidenceSummary: 'Explicit owner binary release statement.',
            downloadFilename: 'legacy-word.doc',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientPublishBinaryResponseDto;

    const cleanStatus = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'getPublishedLibraryBinaryReleaseStatus',
          receiptId: rid,
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientGetPublishedBinaryStatusDto;

    const statusJson = JSON.stringify(cleanStatus);
    const noSecretLeak =
      !statusJson.includes('library/quarantine/') &&
      !statusJson.includes('library/released/') &&
      !statusJson.includes('sourceSha256') &&
      !statusJson.includes('firebaseStorageDownloadTokens') &&
      !statusJson.includes('X-Goog-Signature');

    assertCheck(
      '31',
      '4-perm human RBAC + AI denial enforced, unsafe/.doc/BiDi filenames rejected, and sanitized DTOs leak zero quarantine/released storage paths or hashes',
      deniedCount === 3 &&
        clientRbacChecks &&
        badFilenameRejected === 5 &&
        serverBadFilenameRes.ok === false &&
        serverBadFilenameRes.errorCode === 'INVALID_DOWNLOAD_FILENAME' &&
        noSecretLeak
    );
  }

  // TEST 32: HTTP Download Fail-Closed Security Guards (qcat- & doc-qsrc- 403, Verbs 405, Query/Path 400, Revoked/Restricted/Corrupt/Token/Size>15MB)
  {
    const rid = 'e5555555555555555555555555555555';
    const pdfBytes = buildDeterministicValidPdfBytes('HTTP Download Abuse Test');
    const binDb = new InMemoryReleaseFirestoreDatabase();
    const binBucket = new InMemoryPublishedBinaryBucket();
    const meta = seedCleanBinaryChain(binDb, binBucket, {
      receiptId: rid,
      format: 'PDF',
      bytes: pdfBytes,
      priorRightsDecision: null,
    });
    const opts = {
      ...buildHandlerOptions({
        binarySafetyCaseEnabled: true,
        isolatedInspectionRequestEnabled: true,
        publishedBinaryReleaseEnabled: true,
      }),
      draftDatabase: binDb,
      publishedBinaryStorageBucket: binBucket,
      publishedBinaryReleaseClock: () => '2026-11-16T10:00:00.000Z',
    };

    const pub = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: meta.safetyCaseRevision,
          expectedAvRequestId: meta.avRequestId,
          expectedPriorRightsDecisionRevision: null,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Owner Memo',
            rightsEvidenceSummary: 'Explicit owner binary release statement.',
            downloadFilename: 'http-sec.pdf',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      opts
    )) as ClientPublishBinaryResponseDto;
    assert(pub.ok === true, `Test 32 pub failed: ${JSON.stringify(pub)}`);

    const publicDocId = derivePublishedBinaryPublicLibraryDocumentId(rid);
    const dlHandler = createPublishedBinaryDownloadHandler({
      db: binDb,
      storageBucket: binBucket,
    });

    const postRes = new InMemoryHttpResponseRecorder();
    await dlHandler({ method: 'POST', path: '/', query: { documentId: publicDocId } }, postRes);

    const qcatRes = new InMemoryHttpResponseRecorder();
    await dlHandler(
      { method: 'GET', path: '/', query: { documentId: `qcat-${rid}` } },
      qcatRes
    );

    const qsrcRes = new InMemoryHttpResponseRecorder();
    await dlHandler(
      { method: 'GET', path: '/', query: { documentId: `doc-qsrc-${rid}` } },
      qsrcRes
    );

    const extraParamRes = new InMemoryHttpResponseRecorder();
    await dlHandler(
      { method: 'GET', path: '/', query: { documentId: publicDocId, extra: '1' } },
      extraParamRes
    );

    const badPathRes = new InMemoryHttpResponseRecorder();
    await dlHandler(
      { method: 'GET', path: '/library/quarantine/x', query: { documentId: publicDocId } },
      badPathRes
    );

    // Inject download token into released metadata -> must fail closed 503
    const relObj = binBucket.objects.get(`library/released/${rid}/v1/document.pdf`)!;
    const savedMeta = deepClone(relObj.metadata);
    (relObj.metadata.metadata as Record<string, unknown>).firebaseStorageDownloadTokens =
      'leaked-token-123';
    const tokenRes = new InMemoryHttpResponseRecorder();
    await dlHandler({ method: 'GET', path: '/', query: { documentId: publicDocId } }, tokenRes);
    relObj.metadata = savedMeta;

    // Downgrade public rights to Restricted -> must fail closed 403
    const pubDocRaw = binDb.getRawDoc(LIBRARY_DOCUMENTS_COLLECTION, publicDocId)!;
    binDb.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, publicDocId, {
      ...pubDocRaw,
      rightsStatus: FnLibraryRightsStatus.Restricted,
    });
    const revokedRes = new InMemoryHttpResponseRecorder();
    await dlHandler({ method: 'GET', path: '/', query: { documentId: publicDocId } }, revokedRes);
    binDb.seedDoc(LIBRARY_DOCUMENTS_COLLECTION, publicDocId, pubDocRaw);

    // Oversized > 15MB check in release metadata -> fails closed
    const relDocRaw = binDb.getRawDoc(LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION, rid)!;
    binDb.seedDoc(LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION, rid, {
      ...relDocRaw,
      sourceByteSize: MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES + 1,
    });
    const oversizeRes = new InMemoryHttpResponseRecorder();
    await dlHandler({ method: 'GET', path: '/', query: { documentId: publicDocId } }, oversizeRes);

    assertCheck(
      '32',
      'Download gateway rejects POST (405), qcat-/doc-qsrc- (403), extra params/path (400), token metadata leak (503), downgraded rights (403), and >15MB records (403/503)',
      postRes.statusCode === 405 &&
        qcatRes.statusCode === 403 &&
        qsrcRes.statusCode === 403 &&
        extraParamRes.statusCode === 400 &&
        badPathRes.statusCode === 400 &&
        tokenRes.statusCode === 503 &&
        revokedRes.statusCode === 403 &&
        (oversizeRes.statusCode === 403 || oversizeRes.statusCode === 503)
    );
  }

  // TEST 33: Default-OFF Server & Client Feature Gates Independent of AV Execution Gate (AV Stays Disabled)
  {
    const prevGate = process.env[LIBRARY_PUBLISHED_BINARY_RELEASE_ENV_VAR];
    let serverDefaultOffRejected = false;
    try {
      delete process.env[LIBRARY_PUBLISHED_BINARY_RELEASE_ENV_VAR];
      try {
        await executeManageLibraryDocumentsRequest(
          {
            auth: { uid: ownerFnUser.id },
            data: {
              action: 'getPublishedLibraryBinaryReleaseStatus',
              receiptId: '1183ac250d0404e921d2aeadbec1b76c',
            },
          },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          undefined,
          buildHandlerOptions({
            binarySafetyCaseEnabled: true,
            isolatedInspectionRequestEnabled: true,
            avExecutionEnabled: false,
            publishedBinaryReleaseEnabled: undefined,
          })
        );
      } catch (err: any) {
        if (
          err?.code === 'failed-precondition' &&
          String(err?.message).includes('PUBLISHED_BINARY_RELEASE_NOT_RELEASED')
        ) {
          serverDefaultOffRejected = true;
        }
      }
    } finally {
      if (prevGate === undefined) delete process.env[LIBRARY_PUBLISHED_BINARY_RELEASE_ENV_VAR];
      else process.env[LIBRARY_PUBLISHED_BINARY_RELEASE_ENV_VAR] = prevGate;
    }

    const baseSixFlags = {
      VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
      VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'true',
      VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED: 'true',
    };

    const clientDefaultOff =
      isLibraryQuarantinePublishedBinaryReleaseEnabled() === false &&
      isLibraryQuarantinePublishedBinaryReleaseEnabled(baseSixFlags) === false &&
      isLibraryQuarantinePublishedBinaryReleaseEnabled({
        ...baseSixFlags,
        VITE_LIBRARY_PUBLISHED_BINARY_RELEASE_ENABLED: 'false',
      }) === false;

    const clientExplicitOnWithoutAv =
      isLibraryQuarantinePublishedBinaryReleaseEnabled({
        ...baseSixFlags,
        VITE_LIBRARY_AV_EXECUTION_ENABLED: 'false',
        VITE_LIBRARY_PUBLISHED_BINARY_RELEASE_ENABLED: 'true',
      }) === true;

    assertCheck(
      '33',
      'Default-OFF feature gates block binary release when absent/false on server & client while enabling cleanly without turning on ClamAV dispatch',
      serverDefaultOffRejected && clientDefaultOff && clientExplicitOnWithoutAv
    );
  }

  // TEST 34: PublicLibraryHub Direct Download UI Rendering for PDF vs DOCX vs External Source Record
  {
    const baseDoc: Omit<PublicLibraryDocument, 'id' | 'versions'> = {
      titleAr: 'وثيقة بيئية منشورة',
      titleEn: 'Published Environmental Document',
      documentType: LibraryDocumentType.Law,
      organizationId: 'org-hcenr',
      sourceId: 'src-gazette',
      geographyAr: 'السودان',
      geographyEn: 'Sudan',
      publicationDate: '2026-11-16',
      language: 'bilingual',
      summaryAr: 'ملخص عربي معتمد.',
      summaryEn: 'Approved English summary.',
      topicsAr: ['بيئة'],
      topicsEn: ['Environment'],
      environmentalDomains: ['LawAndPolicy'],
      rightsStatus: LibraryRightsStatus.PermissionGranted,
      workflowState: WorkflowState.Published,
      createdAt: '2026-11-16T00:00:00.000Z',
      updatedAt: '2026-11-16T00:00:00.000Z',
    };

    const pdfPublicDoc: PublicLibraryDocument = {
      ...baseDoc,
      id: 'doc-qbin-1183ac250d0404e921d2aeadbec1b76c',
      versions: [
        {
          id: 'ver-pdf-1',
          documentId: 'doc-qbin-1183ac250d0404e921d2aeadbec1b76c',
          versionNumber: '1.0',
          publishedDate: '2026-11-16',
          changeDescriptionAr: 'إتاحة ملف PDF المرفوع الأصلي للتحميل المباشر',
          changeDescriptionEn: 'Direct public attachment release of uploaded PDF Original',
          referenceUrl:
            'https://us-central1-promiseofplanet-bb325.cloudfunctions.net/libraryPublishedBinaryDownload?documentId=doc-qbin-1183ac250d0404e921d2aeadbec1b76c',
        },
      ],
    };

    const docxPublicDoc: PublicLibraryDocument = {
      ...baseDoc,
      id: 'doc-qbin-deadbeefcafebabe0011223344556677',
      versions: [
        {
          id: 'ver-docx-1',
          documentId: 'doc-qbin-deadbeefcafebabe0011223344556677',
          versionNumber: '1.0',
          publishedDate: '2026-11-16',
          changeDescriptionAr: 'إتاحة ملف Word (DOCX) المرفوع الأصلي للتحميل المباشر',
          changeDescriptionEn: 'Direct public attachment release of uploaded Word DOCX Original',
          referenceUrl:
            'https://us-central1-promiseofplanet-bb325.cloudfunctions.net/libraryPublishedBinaryDownload?documentId=doc-qbin-deadbeefcafebabe0011223344556677',
        },
      ],
    };

    const qsrcPublicDoc: PublicLibraryDocument = {
      ...baseDoc,
      id: 'doc-qsrc-1183ac250d0404e921d2aeadbec1b76c',
      versions: [
        {
          id: 'ver-qsrc-1',
          documentId: 'doc-qsrc-1183ac250d0404e921d2aeadbec1b76c',
          versionNumber: '1.0',
          publishedDate: '2026-11-16',
          changeDescriptionAr: 'إتاحة في المكتبة العامة عبر رابط الناشر الرسمي',
          changeDescriptionEn: 'Published via verified publisher link',
          referenceUrl: 'https://official-publisher.gov.sd/law.pdf',
        },
      ],
    };

    const pdfHtmlAr = renderToStaticMarkup(
      React.createElement(PublicLibraryHub, {
        initialDocuments: [pdfPublicDoc],
        initialSelectedDoc: pdfPublicDoc,
        initialLanguage: 'ar',
      })
    );
    const pdfHtmlEn = renderToStaticMarkup(
      React.createElement(PublicLibraryHub, {
        initialDocuments: [pdfPublicDoc],
        initialSelectedDoc: pdfPublicDoc,
        initialLanguage: 'en',
      })
    );
    const docxHtmlAr = renderToStaticMarkup(
      React.createElement(PublicLibraryHub, {
        initialDocuments: [docxPublicDoc],
        initialSelectedDoc: docxPublicDoc,
        initialLanguage: 'ar',
      })
    );
    const docxHtmlEn = renderToStaticMarkup(
      React.createElement(PublicLibraryHub, {
        initialDocuments: [docxPublicDoc],
        initialSelectedDoc: docxPublicDoc,
        initialLanguage: 'en',
      })
    );
    const qsrcHtmlAr = renderToStaticMarkup(
      React.createElement(PublicLibraryHub, {
        initialDocuments: [qsrcPublicDoc],
        initialSelectedDoc: qsrcPublicDoc,
        initialLanguage: 'ar',
      })
    );

    assertCheck(
      '34',
      'PublicLibraryHub renders direct PDF/Word attachment CTAs for doc-qbin-* without target=_blank while preserving external publisher link CTA for doc-qsrc-*',
      isPublishedBinaryPublicDocumentId(pdfPublicDoc.id) &&
        !isPublishedBinaryPublicDocumentId(qsrcPublicDoc.id) &&
        detectPublishedBinaryFormat(pdfPublicDoc) === 'PDF' &&
        detectPublishedBinaryFormat(docxPublicDoc) === 'DOCX' &&
        isOwnedPublishedBinaryDownloadUrl(getOwnedPublishedBinaryDownloadUrl(pdfPublicDoc)) &&
        pdfHtmlAr.includes('تحميل PDF') &&
        pdfHtmlAr.includes('download') &&
        !pdfHtmlAr.includes('target="_blank"') &&
        pdfHtmlEn.includes('Download PDF') &&
        docxHtmlAr.includes('تحميل Word') &&
        docxHtmlEn.includes('Download Word') &&
        !docxHtmlAr.includes('target="_blank"') &&
        qsrcHtmlAr.includes('فتح أو تحميل الوثيقة الأصلية') &&
        qsrcHtmlAr.includes('target="_blank"')
    );
  }

  // TEST 35: Modal Section Hidden When Default-OFF and Renders Clean Waiting-for-Scan + Prior RESTRICTED Box in AR/EN When Enabled
  {
    const rid = '1183ac250d0404e921d2aeadbec1b76c';
    const pdfBytes = buildDeterministicValidPdfBytes('Modal UI Test');
    const binDb = new InMemoryReleaseFirestoreDatabase();
    const binBucket = new InMemoryPublishedBinaryBucket();
    seedCleanBinaryChain(binDb, binBucket, {
      receiptId: rid,
      format: 'PDF',
      bytes: pdfBytes,
      avState: 'MISSING',
      priorRightsDecision: 'RESTRICTED',
    });

    const dummySavedCase: SanitizedLibraryQuarantineHumanReviewCaseDto = {
      schemaVersion: 1,
      receiptId: rid,
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
    };

    const binService = new LibraryPublishedBinaryReleaseService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({ uid: ownerFnUser.id }),
      },
      adminRepository: adminRepo,
      db: binDb,
      storageBucket: binBucket,
      clock: () => '2026-11-16T10:00:00.000Z',
    });

    const defaultController =
      new LibraryQuarantinePublishedBinaryReleasePanelController(ownerUiUser);
    const hiddenHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantinePublishedBinaryReleaseSection, {
        controller: defaultController,
        currentUser: ownerUiUser,
        savedReviewCase: dummySavedCase,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );

    const enabledEnv = {
      VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
      VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'true',
      VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED: 'true',
      VITE_LIBRARY_PUBLISHED_BINARY_RELEASE_ENABLED: 'true',
    };

    const activeController =
      new LibraryQuarantinePublishedBinaryReleasePanelController(ownerUiUser, {
        enabled: true,
        api: {
          getPublishedLibraryBinaryReleaseStatus: (id) =>
            binService.getPublishedLibraryBinaryReleaseStatus({
              receiptId: id,
            }) as unknown as Promise<ClientGetPublishedBinaryStatusDto>,
          publishQuarantinedBinaryToPublicLibrary: (payload) =>
            binService.publishQuarantinedBinaryToPublicLibrary(
              payload as unknown as Parameters<
                LibraryPublishedBinaryReleaseServiceClass['publishQuarantinedBinaryToPublicLibrary']
              >[0]
            ) as unknown as Promise<ClientPublishBinaryResponseDto>,
        },
      });
    await activeController.openForSavedCase(dummySavedCase);

    const waitingArHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantinePublishedBinaryReleaseSection, {
        controller: activeController,
        currentUser: ownerUiUser,
        savedReviewCase: dummySavedCase,
        hasUnsavedCaseEdits: false,
        isAr: true,
        envOverride: enabledEnv,
      })
    );

    const waitingEnHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantinePublishedBinaryReleaseSection, {
        controller: activeController,
        currentUser: ownerUiUser,
        savedReviewCase: dummySavedCase,
        hasUnsavedCaseEdits: false,
        isAr: false,
        envOverride: enabledEnv,
      })
    );

    assertCheck(
      '35',
      'Published binary modal section stays hidden when default-OFF and renders WAITING_FOR_ACTUAL_SCAN hold cleanly in AR/EN without faking pass',
      hiddenHtml === '' &&
        waitingArHtml.includes('نشر الملف المرفوع للتحميل') &&
        waitingArHtml.includes('WAITING_FOR_ACTUAL_SCAN') &&
        waitingEnHtml.includes('Publish Uploaded File for Download') &&
        waitingEnHtml.includes('WAITING_FOR_ACTUAL_SCAN')
    );
  }

  // TEST 36: Released Storage Bucket Posture Rejection & Tampered Released Object Fail-Closed Verification
  {
    const rid = 'f6666666666666666666666666666666';
    const pdfBytes = buildDeterministicValidPdfBytes('Bucket Posture Test');
    const binDb = new InMemoryReleaseFirestoreDatabase();
    const wrongBucket = new InMemoryPublishedBinaryBucket(
      FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME
    );
    seedCleanBinaryChain(binDb, wrongBucket, {
      receiptId: rid,
      format: 'PDF',
      bytes: pdfBytes,
    });

    const wrongBucketRes = (await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: ownerFnUser.id },
        data: {
          action: 'publishQuarantinedBinaryToPublicLibrary',
          receiptId: rid,
          expectedHumanCaseRevision: 6,
          expectedCatalogUpdatedAt: '2026-11-14T15:00:00.000Z',
          expectedAlignmentRevision: 1,
          expectedSafetyCaseRevision: 1,
          expectedAvRequestId: deriveLibraryQuarantineIsolatedInspectionRequestId(rid, 2, 1),
          expectedPriorRightsDecisionRevision: 1,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: 'PermissionGranted',
            binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
            rightsEvidenceReference: 'Owner Memo',
            rightsEvidenceSummary: 'Explicit owner binary release statement.',
            downloadFilename: 'bucket-test.pdf',
            acknowledgePriorRestrictedDecision: true,
            contradictionResolutionSummary: 'Resolved prior restriction cleanly.',
          },
        },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ...buildHandlerOptions({
          binarySafetyCaseEnabled: true,
          isolatedInspectionRequestEnabled: true,
          publishedBinaryReleaseEnabled: true,
        }),
        draftDatabase: binDb,
        publishedBinaryStorageBucket: wrongBucket,
        publishedBinaryReleaseClock: () => '2026-11-16T10:00:00.000Z',
      }
    )) as ClientPublishBinaryResponseDto;

    assertCheck(
      '36',
      'Default Firebase storage bucket (non-dedicated quarantine bucket) is rejected fail-closed with STORAGE_BUCKET_MISCONFIGURED',
      wrongBucketRes.ok === false &&
        wrongBucketRes.errorCode === 'STORAGE_BUCKET_MISCONFIGURED'
    );
  }

  // =========================================================================
  // OPS-CLOSURE-01 TESTS 37–39 (Workflow Mode Gates, Mocked GCP Preflight,
  // Env Parity & Fail-Closed No-Auto-Publish Hold)
  // =========================================================================

  // TEST 37: Operational Workflow Structural & Mode-Gate Assertions
  {
    const avWorkflowRaw = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/library-quarantine-av-job.yml'),
      'utf8'
    );
    const liveWorkflowRaw = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/library-human-review-one-shot-live.yml'),
      'utf8'
    );

    const avWorkflowOk =
      avWorkflowRaw.includes('default: "verify_only"') &&
      avWorkflowRaw.includes('- verify_only') &&
      avWorkflowRaw.includes('- preflight_only') &&
      avWorkflowRaw.includes('- deploy') &&
      avWorkflowRaw.includes('DEPLOY_ISOLATED_QUARANTINE_AV_JOB') &&
      avWorkflowRaw.includes('POP_LIBRARY_AV_EXECUTION_ENABLED: "false"') &&
      avWorkflowRaw.includes('DEFAULT_CLAMAV_SIGNATURE_MAX_AGE_MS') &&
      avWorkflowRaw.includes('run.jobs.runWithOverrides') &&
      avWorkflowRaw.includes('roles/run.jobsExecutorWithOverrides') &&
      avWorkflowRaw.includes('PENDING_RESOURCE_CREATION') &&
      avWorkflowRaw.includes('CLOUD_PREREQUISITES_MISSING') &&
      avWorkflowRaw.includes('--tasks=1') &&
      avWorkflowRaw.includes('--max-retries=0') &&
      avWorkflowRaw.includes('--task-timeout=600s') &&
      avWorkflowRaw.includes('--memory=2Gi') &&
      avWorkflowRaw.includes('--cpu=1');

    const liveWorkflowOk =
      liveWorkflowRaw.includes('RELEASE_LIBRARY_HUMAN_REVIEW_LIVE') &&
      liveWorkflowRaw.includes("github.ref == 'refs/heads/main'") &&
      liveWorkflowRaw.includes('av_execution_mode:') &&
      liveWorkflowRaw.includes('default: "disabled"') &&
      liveWorkflowRaw.includes('- disabled') &&
      liveWorkflowRaw.includes('- enabled') &&
      liveWorkflowRaw.includes('confirm_av_enable:') &&
      liveWorkflowRaw.includes('ENABLE_REAL_LIBRARY_AV_FOR_DIRECT_BINARY_RELEASE') &&
      liveWorkflowRaw.includes('POP_QUARANTINE_AV_JOB_PROJECT_ID') &&
      liveWorkflowRaw.includes('POP_QUARANTINE_AV_JOB_REGION') &&
      liveWorkflowRaw.includes('POP_QUARANTINE_AV_JOB_NAME') &&
      liveWorkflowRaw.includes('!isQuarantineCatalogDocumentId(doc.id)') &&
      liveWorkflowRaw.includes('firebase deploy --project promiseofplanet-bb325 --only "functions:manageLibraryDocuments,functions:getPublicLibrary,functions:libraryPublishedBinaryDownload,hosting" --non-interactive') &&
      liveWorkflowRaw.includes('run.jobs.runWithOverrides');

    assertCheck(
      '37',
      'Both deployment workflows preserve verify_only/disabled defaults while enforcing gated preflight, caller runWithOverrides IAM, and 3 invoker env vars',
      avWorkflowOk && liveWorkflowOk
    );
  }

  // TEST 38: Deterministic Mocked-gcloud Preflight, Dotenv & Readback Simulation
  {
    const avWorkflowRaw = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/library-quarantine-av-job.yml'),
      'utf8'
    );
    const liveWorkflowRaw = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/library-human-review-one-shot-live.yml'),
      'utf8'
    );

    const extractHeredoc = (src: string, marker: string): string => {
      const rx = new RegExp(`node << '${marker}'\\r?\\n([\\s\\S]*?)\\r?\\n\\s*${marker}`);
      const m = rx.exec(src);
      assert.ok(m && m[1], `Missing embedded script ${marker}`);
      return m[1];
    };

    const avPreflightJs = extractHeredoc(avWorkflowRaw, 'PREFLIGHT_EOF');
    const avReadbackJs = extractHeredoc(avWorkflowRaw, 'READBACK_EOF');
    const liveAvEnablePreflightJs = extractHeredoc(liveWorkflowRaw, 'PREFLIGHT_AV_ENABLE_EOF');
    const liveWriteDotenvJs = extractHeredoc(liveWorkflowRaw, 'WRITE_DOTENV_EOF');
    const liveReadbackManageJs = extractHeredoc(liveWorkflowRaw, 'READBACK_MANAGE_EOF');
    const liveReadbackPublicJs = extractHeredoc(liveWorkflowRaw, 'READBACK_PUBLIC_EOF');
    const liveReadbackBinaryJs = extractHeredoc(liveWorkflowRaw, 'READBACK_BINARY_EOF');

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pop-ops-closure-test-'));
    try {
      const binDir = path.join(tmpRoot, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const logPath = path.join(tmpRoot, 'gcloud-calls.log');
      const scenarioPath = path.join(tmpRoot, 'scenario.json');
      const mockGcloudPath = path.join(binDir, 'gcloud');

      const mockGcloudScript = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(${JSON.stringify(scenarioPath)}, "utf8"));
fs.appendFileSync(${JSON.stringify(logPath)}, args.join(" ") + "\\n");

const DEFAULT_SA = scenario.workerSa || "pop-av-worker@promiseofplanet-bb325.iam.gserviceaccount.com";
const DEFAULT_IMAGE = "us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers/pop-library-quarantine-av-worker@sha256:abc123";
const joined = args.join(" ");
if (
  (args[0] === "run" && args[1] === "jobs" && args[2] === "deploy") ||
  (args[0] === "run" && args[1] === "jobs" && args[2] === "execute")
) {
  console.error("FORBIDDEN_MUTATION: deploy/execute called in preflight test");
  process.exit(99);
}
if (joined.startsWith("auth print-access-token")) {
  process.stdout.write("mock-token\\n");
  process.exit(0);
}
if (joined.startsWith("auth list")) {
  process.stdout.write("gh-deployer@promiseofplanet-bb325.iam.gserviceaccount.com\\n");
  process.exit(0);
}
if (joined.startsWith("projects describe")) {
  process.stdout.write(JSON.stringify({ projectId: "promiseofplanet-bb325", lifecycleState: "ACTIVE" }));
  process.exit(0);
}
if (joined.startsWith("services list")) {
  process.stdout.write(JSON.stringify([
    { config: { name: "run.googleapis.com" } },
    { config: { name: "artifactregistry.googleapis.com" } },
    { config: { name: "firestore.googleapis.com" } },
    { config: { name: "storage.googleapis.com" } },
  ]));
  process.exit(0);
}
if (joined.startsWith("artifacts repositories describe")) {
  if (scenario.missingArRepo) {
    console.error("NOT_FOUND: Requested entity was not found.");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    name: "projects/promiseofplanet-bb325/locations/us-central1/repositories/pop-quarantine-workers",
    format: "DOCKER"
  }));
  process.exit(0);
}
if (joined.startsWith("artifacts docker images list")) {
  if (!args.includes("--include-tags") || !args.includes("--format=json")) {
    console.error("Missing required flags on artifacts docker images list: " + joined);
    process.exit(98);
  }
  if (!args.includes("us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers")) {
    console.error("Expected Artifact Registry repo URI in list args: " + joined);
    process.exit(97);
  }
  if (scenario.imageListError) {
    console.error(scenario.imageListError);
    process.exit(1);
  }
  if (scenario.imageListPayload !== undefined) {
    process.stdout.write(JSON.stringify(scenario.imageListPayload));
    process.exit(0);
  }
  const basePkg = "us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers/pop-library-quarantine-av-worker";
  const cTime = scenario.imageCreateTime === null ? undefined : (scenario.imageCreateTime || new Date().toISOString());
  const v1Record = {
    package: basePkg,
    version: "sha256:320da466f629670e39fcb16d51af8968f3f48b9b4c0da778379d3e0fcd7fbcdc",
    tags: ["v1"],
    ...(cTime !== undefined ? { createTime: cTime } : { uploadTime: new Date().toISOString(), updateTime: new Date().toISOString() }),
  };
  const v2Record = {
    package: basePkg,
    version: scenario.imageDigest || "sha256:abc123",
    tags: ["v2"],
    ...(cTime !== undefined ? { createTime: cTime } : { uploadTime: new Date().toISOString(), updateTime: new Date().toISOString() }),
  };
  process.stdout.write(JSON.stringify([
    {
      package: basePkg,
      version: "sha256:000000000000000000000000000000000000000000000000000000000000dead",
      tags: ["latest"],
      createTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
    {
      package: basePkg + "-other",
      version: "sha256:320da466f629670e39fcb16d51af8968f3f48b9b4c0da778379d3e0fcd7fbcdc",
      tags: ["other"],
      createTime: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
    v1Record,
    v2Record,
  ]));
  process.exit(0);
}
if (joined.startsWith("iam service-accounts describe")) {
  if (scenario.missingWorkerSa) {
    console.error("ERROR: (gcloud.iam.service-accounts.describe) NOT_FOUND: Unknown service account");
    process.exit(1);
  }
  const saEmail = args[3] || DEFAULT_SA;
  process.stdout.write(JSON.stringify({
    email: saEmail,
    disabled: false
  }));
  process.exit(0);
}
if (joined.startsWith("iam roles describe")) {
  const roleId = args[3];
  const roleDef = scenario.customRoles && scenario.customRoles[roleId];
  if (!roleDef) {
    console.error("ERROR: (gcloud.iam.roles.describe) NOT_FOUND: Role not found");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(roleDef));
  process.exit(0);
}
if (joined.startsWith("storage buckets describe")) {
  process.stdout.write(JSON.stringify({
    name: "promiseofplanet-bb325-library-quarantine",
    iamConfiguration: {
      uniformBucketLevelAccess: { enabled: true },
      publicAccessPrevention: "enforced"
    }
  }));
  process.exit(0);
}
if (joined.startsWith("storage buckets get-iam-policy gs://promiseofplanet-bb325-library-quarantine")) {
  const bindings = scenario.omitBucketWorkerRole
    ? []
    : [
        {
          role: scenario.workerStorageRole || "roles/storage.objectViewer",
          members: ["serviceAccount:" + DEFAULT_SA]
        }
      ];
  process.stdout.write(JSON.stringify({ bindings }));
  process.exit(0);
}
if (joined.startsWith("storage buckets get-iam-policy gs://promiseofplanet-bb325.firebasestorage.app")) {
  if (scenario.defaultBucketError) {
    console.error(scenario.defaultBucketError);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ bindings: [] }));
  process.exit(0);
}
if (joined.startsWith("projects get-iam-policy")) {
  if (scenario.forbidProjectIam) {
    console.error("ERROR: (gcloud.projects.get-iam-policy) PERMISSION_DENIED: 403 Forbidden");
    process.exit(1);
  }
  const bindings = [
    {
      role: "roles/datastore.user",
      members: ["serviceAccount:" + DEFAULT_SA]
    }
  ];
  if (scenario.projectWideStorageViewer) {
    bindings.push({
      role: "roles/storage.objectViewer",
      members: ["serviceAccount:" + DEFAULT_SA]
    });
  }
  process.stdout.write(JSON.stringify({ bindings }));
  process.exit(0);
}
if (joined.startsWith("functions describe manageLibraryDocuments")) {
  process.stdout.write(JSON.stringify({
    name: "projects/promiseofplanet-bb325/locations/us-central1/functions/manageLibraryDocuments",
    environment: "GEN_2",
    state: "ACTIVE",
    serviceConfig: {
      serviceAccountEmail: "pop-fn-runtime@promiseofplanet-bb325.iam.gserviceaccount.com",
      secretEnvironmentVariables: [{ key: "GEMINI_API_KEY" }],
      environmentVariables: {}
    }
  }));
  process.exit(0);
}
if (joined.startsWith("run jobs describe")) {
  if (scenario.jobDescribeError) {
    console.error(scenario.jobDescribeError);
    process.exit(1);
  }
  if (scenario.jobMissing) {
    console.error("ERROR: (gcloud.run.jobs.describe) NOT_FOUND: 404 Resource not found");
    process.exit(1);
  }
  if (scenario.jobPayload !== undefined) {
    process.stdout.write(JSON.stringify(scenario.jobPayload));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    name: "projects/promiseofplanet-bb325/locations/us-central1/jobs/pop-library-quarantine-av-worker",
    conditions: [{ type: "Ready", state: "CONDITION_SUCCEEDED" }],
    template: {
      taskCount: 1,
      template: {
        serviceAccount: DEFAULT_SA,
        maxRetries: 0,
        timeout: "600s",
        containers: [{
          image: scenario.jobImage || DEFAULT_IMAGE,
          env: [
            { name: "NODE_ENV", value: "production" },
            { name: "POP_CLAMAV_DB_DIR", value: "/var/lib/clamav" },
            { name: "POP_CLAMSCAN_PATH", value: "/usr/bin/clamscan" },
            { name: "POP_QPDF_PATH", value: "/usr/bin/qpdf" }
          ]
        }]
      }
    }
  }));
  process.exit(0);
}
if (joined.startsWith("run jobs get-iam-policy")) {
  const bindings = Array.isArray(scenario.jobIamBindings)
    ? scenario.jobIamBindings
    : [
        {
          role: scenario.callerRole || "roles/run.jobsExecutorWithOverrides",
          members: ["serviceAccount:pop-fn-runtime@promiseofplanet-bb325.iam.gserviceaccount.com"]
        }
      ];
  process.stdout.write(JSON.stringify({ bindings }));
  process.exit(0);
}
console.error("Unexpected mocked gcloud args: " + joined);
process.exit(1);
`;
      fs.writeFileSync(mockGcloudPath, mockGcloudScript, { mode: 0o755 });

      const ghOut = path.join(tmpRoot, 'gh.out');
      const ghEnv = path.join(tmpRoot, 'gh.env');
      const baseEnv = {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH || ''}`,
        FIREBASE_PROJECT_ID: 'promiseofplanet-bb325',
        EXPECTED_GCP_REGION: 'us-central1',
        EXPECTED_FUNCTION_REGION: 'us-central1',
        EXPECTED_ARTIFACT_REGISTRY_REPO: 'pop-quarantine-workers',
        EXPECTED_CLOUD_RUN_JOB_NAME: 'pop-library-quarantine-av-worker',
        EXPECTED_AV_JOB_NAME: 'pop-library-quarantine-av-worker',
        QUARANTINE_BUCKET_NAME: 'promiseofplanet-bb325-library-quarantine',
        EXPECTED_QUARANTINE_BUCKET: 'promiseofplanet-bb325-library-quarantine',
        FORBIDDEN_DEFAULT_BUCKET: 'promiseofplanet-bb325.firebasestorage.app',
        HAS_GCP_CREDS: 'true',
        CRED_STATUS: 'valid_service_account_json',
        INPUT_WORKER_SA: 'pop-av-worker@promiseofplanet-bb325.iam.gserviceaccount.com',
        GITHUB_OUTPUT: ghOut,
        GITHUB_ENV: ghEnv,
      };

      const runNodeScript = (code: string, extraEnv: Record<string, string> = {}) => {
        fs.writeFileSync(ghOut, '');
        fs.writeFileSync(ghEnv, '');
        return spawnSync(process.execPath, ['-e', code], {
          cwd: tmpRoot,
          env: { ...baseEnv, ...extraEnv },
          encoding: 'utf8',
        });
      };

      // Note: testIamPermissions fetch calls in avPreflightJs require HTTP; we patch fetch in a small preamble for unit testing
      const mockedFetchPreamble = `
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  return {
    ok: true,
    status: 200,
    json: async () => ({ permissions: body.permissions || [] })
  };
};
`;

      const LIVE_V1_WORKER_SA = 'pop-library-av-worker@promiseofplanet-bb325.iam.gserviceaccount.com';
      const LIVE_V1_IMAGE =
        'us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers/pop-library-quarantine-av-worker@sha256:320da466f629670e39fcb16d51af8968f3f48b9b4c0da778379d3e0fcd7fbcdc';
      const STANDARD_ENV = [
        { name: 'NODE_ENV', value: 'production' },
        { name: 'POP_CLAMAV_DB_DIR', value: '/var/lib/clamav' },
        { name: 'POP_CLAMSCAN_PATH', value: '/usr/bin/clamscan' },
        { name: 'POP_QPDF_PATH', value: '/usr/bin/qpdf' },
      ];

      const buildV1Job = (overrides: {
        apiVersion?: unknown;
        kind?: unknown;
        name?: unknown;
        locationLabel?: string;
        taskCount?: unknown;
        serviceAccountName?: unknown;
        maxRetries?: unknown;
        timeoutSeconds?: unknown;
        omitTimeoutSeconds?: boolean;
        image?: unknown;
        env?: Array<{ name: string; value: string }>;
        readyStatus?: string;
        extraRoot?: Record<string, unknown>;
        extraPodSpec?: Record<string, unknown>;
      } = {}) => ({
        apiVersion: overrides.apiVersion !== undefined ? overrides.apiVersion : 'run.googleapis.com/v1',
        kind: overrides.kind !== undefined ? overrides.kind : 'Job',
        metadata: {
          name: overrides.name !== undefined ? overrides.name : 'pop-library-quarantine-av-worker',
          namespace: '328395806816',
          labels: {
            'cloud.googleapis.com/location': overrides.locationLabel ?? 'us-central1',
          },
        },
        spec: {
          template: {
            spec: {
              taskCount: overrides.taskCount !== undefined ? overrides.taskCount : 1,
              template: {
                spec: {
                  serviceAccountName:
                    overrides.serviceAccountName !== undefined
                      ? overrides.serviceAccountName
                      : LIVE_V1_WORKER_SA,
                  maxRetries: overrides.maxRetries !== undefined ? overrides.maxRetries : 0,
                  ...(overrides.omitTimeoutSeconds
                    ? {}
                    : {
                        timeoutSeconds:
                          overrides.timeoutSeconds !== undefined ? overrides.timeoutSeconds : '600',
                      }),
                  containers: [
                    {
                      image: overrides.image !== undefined ? overrides.image : LIVE_V1_IMAGE,
                      env: overrides.env !== undefined ? overrides.env : STANDARD_ENV,
                    },
                  ],
                  ...(overrides.extraPodSpec || {}),
                },
              },
            },
          },
        },
        status: {
          conditions: [{ type: 'Ready', status: overrides.readyStatus ?? 'True' }],
        },
        ...(overrides.extraRoot || {}),
      });

      const buildV2Job = (overrides: {
        name?: unknown;
        taskCount?: unknown;
        serviceAccount?: unknown;
        maxRetries?: unknown;
        timeout?: unknown;
        image?: unknown;
        env?: Array<{ name: string; value: string }>;
        readyState?: string;
        extraRoot?: Record<string, unknown>;
      } = {}) => ({
        name:
          overrides.name !== undefined
            ? overrides.name
            : 'projects/promiseofplanet-bb325/locations/us-central1/jobs/pop-library-quarantine-av-worker',
        conditions: [{ type: 'Ready', state: overrides.readyState ?? 'CONDITION_SUCCEEDED' }],
        template: {
          taskCount: overrides.taskCount !== undefined ? overrides.taskCount : 1,
          template: {
            serviceAccount:
              overrides.serviceAccount !== undefined
                ? overrides.serviceAccount
                : 'pop-av-worker@promiseofplanet-bb325.iam.gserviceaccount.com',
            maxRetries: overrides.maxRetries !== undefined ? overrides.maxRetries : 0,
            timeout: overrides.timeout !== undefined ? overrides.timeout : '600s',
            containers: [
              {
                image:
                  overrides.image !== undefined
                    ? overrides.image
                    : 'us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers/pop-library-quarantine-av-worker@sha256:abc123',
                env: overrides.env !== undefined ? overrides.env : STANDARD_ENV,
              },
            ],
          },
        },
        ...(overrides.extraRoot || {}),
      });

      const runReadbackWithFixtures = (opts: {
        jobPayload: unknown;
        workerSa?: string;
        expectedImage?: string;
        jobIamBindings?: unknown[];
        callerRole?: string;
      }) => {
        fs.writeFileSync('/tmp/av_job_post.json', JSON.stringify(opts.jobPayload));
        fs.writeFileSync(
          '/tmp/av_job_post_iam.json',
          JSON.stringify({
            bindings: opts.jobIamBindings ?? [
              {
                role: opts.callerRole ?? 'roles/run.jobsExecutorWithOverrides',
                members: ['serviceAccount:pop-fn-runtime@promiseofplanet-bb325.iam.gserviceaccount.com'],
              },
            ],
          })
        );
        fs.writeFileSync(
          '/tmp/manage_library_post_av_deploy.json',
          JSON.stringify({
            serviceConfig: {
              serviceAccountEmail: 'pop-fn-runtime@promiseofplanet-bb325.iam.gserviceaccount.com',
            },
          })
        );
        fs.writeFileSync('/tmp/project_iam_post_av_deploy.json', JSON.stringify({ bindings: [] }));
        return runNodeScript(avReadbackJs, {
          INPUT_WORKER_SA: opts.workerSa ?? LIVE_V1_WORKER_SA,
          EXPECTED_DEPLOYED_IMAGE: opts.expectedImage ?? LIVE_V1_IMAGE,
        });
      };

      fs.writeFileSync(logPath, '');

      // Scenario 38a: Real GitHub Actions Cloud Run NOT_FOUND message verbatim -> PENDING_RESOURCE_CREATION
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobDescribeError:
            'NOT_FOUND: ERROR: (gcloud.run.jobs.describe) Cannot find job [pop-library-quarantine-av-worker].',
        })
      );
      const res38aReal = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const env38aReal = fs.readFileSync(ghEnv, 'utf8');
      const result38aReal = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38a-legacy: Earlier simulated 404 Resource not found message -> PENDING_RESOURCE_CREATION
      fs.writeFileSync(scenarioPath, JSON.stringify({ jobMissing: true }));
      const res38a = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const env38a = fs.readFileSync(ghEnv, 'utf8');

      // Scenario 38a-permPrecedence: 403/PERMISSION_DENIED with ambiguous not-found text -> UNKNOWN (NOT PENDING_RESOURCE_CREATION)
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobDescribeError:
            'ERROR: (gcloud.run.jobs.describe) PERMISSION_DENIED: 403 Forbidden: Cannot find job [pop-library-quarantine-av-worker]',
        })
      );
      const res38PermPrec = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const result38PermPrec = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38a-genericErr: Generic runtime exception on job describe -> NOT classified as missing job (FAIL, not PENDING_RESOURCE_CREATION)
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobDescribeError: 'ERROR: (gcloud.run.jobs.describe) Socket timeout connecting to run.googleapis.com',
        })
      );
      const res38GenericErr = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const result38GenericErr = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38-v1PreflightPass: Observed real Cloud Run v1 structure -> PASS (ALL_CLOUD_PREREQUISITES_VERIFIED)
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
        })
      );
      const res38V1PreflightPass = runNodeScript(mockedFetchPreamble + avPreflightJs, {
        INPUT_WORKER_SA: LIVE_V1_WORKER_SA,
      });
      const env38V1PreflightPass = fs.readFileSync(ghEnv, 'utf8');

      // Scenario 38-existingPass (v2): Existing Cloud Run v2 job with valid caller permissions -> PASS
      fs.writeFileSync(scenarioPath, JSON.stringify({ jobMissing: false, jobPayload: buildV2Job() }));
      const res38ExistingPass = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const env38ExistingPass = fs.readFileSync(ghEnv, 'utf8');

      // Scenario 38-v1ReadbackPass & v2ReadbackPass & Readback negative checks
      const res38V1ReadbackPass = runReadbackWithFixtures({
        jobPayload: buildV1Job(),
        workerSa: LIVE_V1_WORKER_SA,
        expectedImage: LIVE_V1_IMAGE,
      });
      const res38V1ReadbackInvokerOnly = runReadbackWithFixtures({
        jobPayload: buildV1Job(),
        workerSa: LIVE_V1_WORKER_SA,
        expectedImage: LIVE_V1_IMAGE,
        callerRole: 'roles/run.invoker',
      });
      const env38V1ReadbackInvokerOnly = fs.readFileSync(ghEnv, 'utf8');

      const v2DefaultImg =
        'us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers/pop-library-quarantine-av-worker@sha256:abc123';
      const res38V2ReadbackPass = runReadbackWithFixtures({
        jobPayload: buildV2Job(),
        workerSa: 'pop-av-worker@promiseofplanet-bb325.iam.gserviceaccount.com',
        expectedImage: v2DefaultImg,
      });
      const res38ReadbackDigestMismatch = runReadbackWithFixtures({
        jobPayload: buildV1Job({
          image:
            'us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers/pop-library-quarantine-av-worker@sha256:deadbeef',
        }),
        workerSa: LIVE_V1_WORKER_SA,
        expectedImage: LIVE_V1_IMAGE,
      });

      // Scenario 38-v1PreflightMissingCaller: Existing v1 job with ONLY roles/run.invoker -> MUST FAIL CLOSED and mark Caller IAM FAIL (never PASS)
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          callerRole: 'roles/run.invoker',
        })
      );
      const res38V1InvokerOnly = runNodeScript(mockedFetchPreamble + avPreflightJs, {
        INPUT_WORKER_SA: LIVE_V1_WORKER_SA,
      });
      const result38V1InvokerOnly = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38-missingAr: Missing Artifact Registry repository -> FAIL before push
      fs.writeFileSync(scenarioPath, JSON.stringify({ missingArRepo: true }));
      const res38MissingAr = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const result38MissingAr = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38-missingSa: Missing worker service account -> FAIL before deployment
      fs.writeFileSync(scenarioPath, JSON.stringify({ missingWorkerSa: true }));
      const res38MissingSa = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const result38MissingSa = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38b: Existing v2 job with ONLY roles/run.invoker -> MUST FAIL CLOSED before deploy
      fs.writeFileSync(scenarioPath, JSON.stringify({ jobMissing: false, callerRole: 'roles/run.invoker' }));
      const res38b = runNodeScript(mockedFetchPreamble + avPreflightJs);

      // Scenario 38c: Project IAM 403 -> MUST report UNKNOWN and FAIL CLOSED
      fs.writeFileSync(scenarioPath, JSON.stringify({ jobMissing: false, forbidProjectIam: true }));
      const res38c = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const env38c = fs.readFileSync(ghEnv, 'utf8');

      // Scenario 38-defaultBucket403: Unreadable default bucket IAM (403) -> MUST fail closed as UNKNOWN, never silent PASS
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobMissing: false,
          defaultBucketError:
            'ERROR: (gcloud.storage.buckets.get-iam-policy) HTTPError 403: Caller does not have storage.buckets.getIamPolicy access',
        })
      );
      const res38Default403 = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const result38Default403 = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38-defaultBucketUnknownErr: Unreadable default bucket IAM (unknown error) -> MUST fail closed as UNKNOWN
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobMissing: false,
          defaultBucketError: 'ERROR: upstream TLS handshake reset',
        })
      );
      const res38DefaultErr = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const result38DefaultErr = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38-defaultBucketNonexistent: Explicitly confirmed nonexistent default bucket (NOT_FOUND) -> PASS
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobMissing: false,
          defaultBucketError: 'ERROR: (gcloud.storage.buckets.get-iam-policy) HTTPError 404: The specified bucket does not exist.',
        })
      );
      const res38DefaultNonexistent = runNodeScript(mockedFetchPreamble + avPreflightJs);

      // Scenario 38-projViewerOnly: Project-wide roles/storage.objectViewer WITHOUT bucket binding -> MUST FAIL
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobMissing: false,
          omitBucketWorkerRole: true,
          projectWideStorageViewer: true,
        })
      );
      const res38ProjViewerOnly = runNodeScript(mockedFetchPreamble + avPreflightJs);
      const result38ProjViewerOnly = JSON.parse(fs.readFileSync('/tmp/av_preflight_result.json', 'utf8'));

      // Scenario 38-projViewerWithBucket: Project-wide roles/storage.objectViewer EVEN WITH bucket binding -> MUST FAIL
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobMissing: false,
          omitBucketWorkerRole: false,
          projectWideStorageViewer: true,
        })
      );
      const res38ProjViewerBoth = runNodeScript(mockedFetchPreamble + avPreflightJs);

      // Prepare Firebase enabled preflight test prerequisite file
      fs.writeFileSync(
        '/tmp/manage_library_fn_pre.json',
        JSON.stringify({
          serviceConfig: { serviceAccountEmail: 'pop-fn-runtime@promiseofplanet-bb325.iam.gserviceaccount.com' },
        })
      );

      // Scenario 38d: Firebase av_execution_mode=enabled with STALE (>7d) worker image -> MUST FAIL CLOSED
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobMissing: false,
          imageCreateTime: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        })
      );
      const res38d = runNodeScript(liveAvEnablePreflightJs);

      // Scenario 38e: Firebase av_execution_mode=enabled with fresh v2 worker image + valid IAM -> PASS
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          jobMissing: false,
          jobPayload: buildV2Job(),
          imageCreateTime: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        })
      );
      const res38e = runNodeScript(liveAvEnablePreflightJs);

      // Scenario 38e-v1: Firebase av_execution_mode=enabled with fresh v1 observed job + valid IAM -> PASS
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          imageCreateTime: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        })
      );
      const res38eV1 = runNodeScript(liveAvEnablePreflightJs);

      // Scenario 38-v1NumericTimeoutCompat: Legacy numeric integer timeoutSeconds: 600 passes across ALL 3 consumers
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job({ timeoutSeconds: 600 }),
          imageCreateTime: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        })
      );
      const res38V1NumericTimeoutPreflight = runNodeScript(mockedFetchPreamble + avPreflightJs, {
        INPUT_WORKER_SA: LIVE_V1_WORKER_SA,
      });
      const env38V1NumericTimeoutPreflight = fs.readFileSync(ghEnv, 'utf8');
      const res38V1NumericTimeoutLive = runNodeScript(liveAvEnablePreflightJs);
      const res38V1NumericTimeoutReadback = runReadbackWithFixtures({
        jobPayload: buildV1Job({ timeoutSeconds: 600 }),
        workerSa: LIVE_V1_WORKER_SA,
        expectedImage: LIVE_V1_IMAGE,
      });

      // Artifact Registry list image/digest/createTime fail-closed scenarios
      const liveImageBase =
        'us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers/pop-library-quarantine-av-worker';
      const liveImageDigest = 'sha256:320da466f629670e39fcb16d51af8968f3f48b9b4c0da778379d3e0fcd7fbcdc';
      const freshCreateIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          imageListPayload: [],
        })
      );
      const res38ImgMissing = runNodeScript(liveAvEnablePreflightJs);

      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          imageListPayload: [
            { package: liveImageBase, version: 'sha256:deadbeef', tags: ['latest'], createTime: freshCreateIso },
          ],
        })
      );
      const res38ImgDigestMismatch = runNodeScript(liveAvEnablePreflightJs);

      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          imageCreateTime: null,
        })
      );
      const res38ImgMissingCreateTime = runNodeScript(liveAvEnablePreflightJs);

      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          imageCreateTime: 'not-a-valid-date',
        })
      );
      const res38ImgInvalidCreateTime = runNodeScript(liveAvEnablePreflightJs);

      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          imageCreateTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
      );
      const res38ImgFutureCreateTime = runNodeScript(liveAvEnablePreflightJs);

      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          imageListError: 'ERROR: (gcloud.artifacts.docker.images.list) PERMISSION_DENIED: mock query failure',
        })
      );
      const res38ImgListQueryFail = runNodeScript(liveAvEnablePreflightJs);

      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          imageListPayload: [
            { package: liveImageBase, version: liveImageDigest, createTime: freshCreateIso },
            {
              package: liveImageBase,
              version: liveImageDigest,
              createTime: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ],
        })
      );
      const res38ImgAmbiguous = runNodeScript(liveAvEnablePreflightJs);

      // Negative Cloud Run schema & security fixture runner across ALL 3 consumers
      const assertRejectsAcrossConsumers = (
        label: string,
        opts: {
          jobPayload?: unknown;
          workerSa?: string;
          jobIamBindings?: unknown[];
          callerRole?: string;
          workerStorageRole?: string;
          omitBucketWorkerRole?: boolean;
          projectWideStorageViewer?: boolean;
          defaultBucketError?: string;
          customRoles?: Record<string, { includedPermissions?: string[] }>;
          checkReadback?: boolean;
        }
      ) => {
        const wSa = opts.workerSa ?? LIVE_V1_WORKER_SA;
        fs.writeFileSync(
          scenarioPath,
          JSON.stringify({
            workerSa: wSa,
            jobPayload: opts.jobPayload ?? buildV1Job(),
            jobIamBindings: opts.jobIamBindings,
            callerRole: opts.callerRole,
            workerStorageRole: opts.workerStorageRole,
            omitBucketWorkerRole: opts.omitBucketWorkerRole,
            projectWideStorageViewer: opts.projectWideStorageViewer,
            defaultBucketError: opts.defaultBucketError,
            customRoles: opts.customRoles,
            imageCreateTime: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          })
        );
        const avPre = runNodeScript(mockedFetchPreamble + avPreflightJs, { INPUT_WORKER_SA: wSa });
        assert.notEqual(avPre.status, 0, `${label}: PREFLIGHT_EOF must fail closed`);
        const livePre = runNodeScript(liveAvEnablePreflightJs);
        assert.notEqual(livePre.status, 0, `${label}: PREFLIGHT_AV_ENABLE_EOF must fail closed`);
        if (opts.checkReadback !== false) {
          const avRb = runReadbackWithFixtures({
            jobPayload: opts.jobPayload ?? buildV1Job(),
            workerSa: wSa,
            expectedImage: LIVE_V1_IMAGE,
            jobIamBindings: opts.jobIamBindings,
            callerRole: opts.callerRole,
          });
          assert.notEqual(avRb.status, 0, `${label}: READBACK_EOF must fail closed`);
        }
      };

      // Negative 1: Malformed/unknown schema
      assertRejectsAcrossConsumers('unknown-schema', { jobPayload: { foo: 'bar' } });
      // Negative 2: Mixed top-level v1+v2 schema
      assertRejectsAcrossConsumers('mixed-top-schema', {
        jobPayload: buildV1Job({
          extraRoot: {
            name: 'projects/promiseofplanet-bb325/locations/us-central1/jobs/pop-library-quarantine-av-worker',
          },
        }),
      });
      // Negative 3: Mixed nested v2 fields inside v1 podSpec
      assertRejectsAcrossConsumers('mixed-nested-schema', {
        jobPayload: buildV1Job({ extraPodSpec: { timeout: '600s' } }),
      });
      // Negative 4: Wrong v1 metadata.name
      assertRejectsAcrossConsumers('v1-wrong-name', {
        jobPayload: buildV1Job({ name: 'wrong-av-worker-job' }),
      });
      // Negative 5: Wrong v1 location label / v2 wrong project-or-region
      assertRejectsAcrossConsumers('v1-wrong-region', {
        jobPayload: buildV1Job({ locationLabel: 'europe-west1' }),
      });
      assertRejectsAcrossConsumers('v2-wrong-project-region', {
        jobPayload: buildV2Job({
          name: 'projects/other-project/locations/europe-west1/jobs/pop-library-quarantine-av-worker',
        }),
        workerSa: 'pop-av-worker@promiseofplanet-bb325.iam.gserviceaccount.com',
      });
      // Negative 6: Wrong worker service account
      assertRejectsAcrossConsumers('wrong-worker-sa', {
        jobPayload: buildV1Job({
          serviceAccountName: '123456-compute@developer.gserviceaccount.com',
        }),
      });
      // Negative 7: taskCount, maxRetries, timeout mismatch
      assertRejectsAcrossConsumers('v1-bad-taskCount', {
        jobPayload: buildV1Job({ taskCount: 2 }),
      });
      assertRejectsAcrossConsumers('v1-bad-maxRetries', {
        jobPayload: buildV1Job({ maxRetries: 1 }),
      });
      assertRejectsAcrossConsumers('v1-bad-timeoutSeconds', {
        jobPayload: buildV1Job({ timeoutSeconds: 300 }),
      });
      for (const [negLabel, negVal] of [
        ['v1-timeoutSeconds-num-599', 599],
        ['v1-timeoutSeconds-str-599', '599'],
        ['v1-timeoutSeconds-leading-zero', '0600'],
        ['v1-timeoutSeconds-decimal-str', '600.0'],
        ['v1-timeoutSeconds-duration-suffix', '600s'],
        ['v1-timeoutSeconds-whitespace', ' 600 '],
        ['v1-timeoutSeconds-scientific', '6e2'],
        ['v1-timeoutSeconds-float', 600.5],
        ['v1-timeoutSeconds-bool', true],
        ['v1-timeoutSeconds-null', null],
        ['v1-timeoutSeconds-unsafe-int64', '9007199254740993'],
      ] as Array<[string, unknown]>) {
        assertRejectsAcrossConsumers(negLabel, {
          jobPayload: buildV1Job({ timeoutSeconds: negVal }),
        });
      }
      assertRejectsAcrossConsumers('v1-timeoutSeconds-missing', {
        jobPayload: buildV1Job({ omitTimeoutSeconds: true }),
      });
      assertRejectsAcrossConsumers('v2-bad-timeout', {
        jobPayload: buildV2Job({ timeout: '300s' }),
        workerSa: 'pop-av-worker@promiseofplanet-bb325.iam.gserviceaccount.com',
      });
      // Negative 8: Wrong image repository & unpinned tag
      assertRejectsAcrossConsumers('wrong-image-repo', {
        jobPayload: buildV1Job({
          image: 'us-central1-docker.pkg.dev/promiseofplanet-bb325/other-repo/pop-library-quarantine-av-worker@sha256:320da466f629670e39fcb16d51af8968f3f48b9b4c0da778379d3e0fcd7fbcdc',
        }),
      });
      assertRejectsAcrossConsumers('mutable-image-tag', {
        jobPayload: buildV1Job({
          image: 'us-central1-docker.pkg.dev/promiseofplanet-bb325/pop-quarantine-workers/pop-library-quarantine-av-worker:latest',
        }),
      });
      // Negative 9: Missing required env var
      assertRejectsAcrossConsumers('missing-required-env', {
        jobPayload: buildV1Job({
          env: STANDARD_ENV.filter((e) => e.name !== 'POP_QPDF_PATH'),
        }),
      });
      // Negative 10: Persistent POP_QUARANTINE_AV_REQUEST_ID
      assertRejectsAcrossConsumers('persisted-request-id-env', {
        jobPayload: buildV1Job({
          env: [...STANDARD_ENV, { name: 'POP_QUARANTINE_AV_REQUEST_ID', value: 'req-persisted' }],
        }),
      });
      // Negative 11: Public job IAM binding
      assertRejectsAcrossConsumers('public-job-iam', {
        jobPayload: buildV1Job(),
        jobIamBindings: [
          { role: 'roles/run.invoker', members: ['allUsers'] },
          {
            role: 'roles/run.jobsExecutorWithOverrides',
            members: ['serviceAccount:pop-fn-runtime@promiseofplanet-bb325.iam.gserviceaccount.com'],
          },
        ],
      });
      // Negative 12: Caller holding only roles/run.invoker on live Firebase enabled preflight
      fs.writeFileSync(
        scenarioPath,
        JSON.stringify({
          workerSa: LIVE_V1_WORKER_SA,
          jobPayload: buildV1Job(),
          callerRole: 'roles/run.invoker',
          imageCreateTime: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        })
      );
      const res38LiveInvokerOnly = runNodeScript(liveAvEnablePreflightJs);
      assert.notEqual(res38LiveInvokerOnly.status, 0, 'live preflight must reject roles/run.invoker caller');

      // Negative 13: Unreadable default Firebase bucket IAM (403) across BOTH preflights
      assertRejectsAcrossConsumers('live-unreadable-default-bucket-403', {
        defaultBucketError: 'ERROR: (gcloud.storage.buckets.get-iam-policy) HTTPError 403: Forbidden',
        checkReadback: false,
      });
      // Negative 14: Project-wide storage.objectViewer bypass across BOTH preflights
      assertRejectsAcrossConsumers('live-project-wide-storage-viewer', {
        omitBucketWorkerRole: true,
        projectWideStorageViewer: true,
        checkReadback: false,
      });
      // Negative 15: Storage write/admin & unknown custom-storage role on worker across BOTH preflights
      assertRejectsAcrossConsumers('worker-storage-write-role', {
        workerStorageRole: 'roles/storage.objectAdmin',
        checkReadback: false,
      });
      assertRejectsAcrossConsumers('worker-unknown-custom-storage-role', {
        workerStorageRole: 'projects/promiseofplanet-bb325/roles/customStorageUnknown',
        customRoles: {
          customStorageUnknown: {
            includedPermissions: ['storage.objects.get', 'storage.managedFolders.create'],
          },
        },
        checkReadback: false,
      });

      // Scenario 38f: Dotenv + Post-deploy readbacks across disabled & enabled modes
      fs.mkdirSync(path.join(tmpRoot, 'functions'), { recursive: true });
      const resDotDisabled = runNodeScript(liveWriteDotenvJs, { AV_EXECUTION_MODE: 'disabled' });
      const disabledDotenvText = fs.readFileSync(path.join(tmpRoot, 'functions/.env.promiseofplanet-bb325'), 'utf8');
      fs.unlinkSync(path.join(tmpRoot, 'functions/.env.promiseofplanet-bb325'));

      const resDotEnabled = runNodeScript(liveWriteDotenvJs, { AV_EXECUTION_MODE: 'enabled' });
      const enabledDotenvText = fs.readFileSync(path.join(tmpRoot, 'functions/.env.promiseofplanet-bb325'), 'utf8');

      const sharedFlagsDisabled = {
        POP_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
        POP_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
        POP_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
        POP_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
        POP_LIBRARY_CASE_ALIGNMENT_ENABLED: 'true',
        POP_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'true',
        POP_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED: 'true',
        POP_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED: 'true',
        POP_LIBRARY_PUBLISHED_BINARY_RELEASE_ENABLED: 'true',
        POP_LIBRARY_PUBLISHED_BINARY_DOWNLOAD_URL:
          'https://us-central1-promiseofplanet-bb325.cloudfunctions.net/libraryPublishedBinaryDownload',
        POP_LIBRARY_AV_EXECUTION_ENABLED: 'false',
      };
      const sharedFlagsEnabled = {
        ...sharedFlagsDisabled,
        POP_LIBRARY_AV_EXECUTION_ENABLED: 'true',
        POP_QUARANTINE_AV_JOB_PROJECT_ID: 'promiseofplanet-bb325',
        POP_QUARANTINE_AV_JOB_REGION: 'us-central1',
        POP_QUARANTINE_AV_JOB_NAME: 'pop-library-quarantine-av-worker',
      };

      fs.writeFileSync(
        '/tmp/manage_library_fn_post.json',
        JSON.stringify({
          name: 'projects/promiseofplanet-bb325/locations/us-central1/functions/manageLibraryDocuments',
          environment: 'GEN_2',
          state: 'ACTIVE',
          serviceConfig: {
            secretEnvironmentVariables: [{ key: 'GEMINI_API_KEY' }],
            environmentVariables: sharedFlagsEnabled,
          },
        })
      );
      fs.writeFileSync(
        '/tmp/get_public_library_fn_post.json',
        JSON.stringify({
          name: 'projects/promiseofplanet-bb325/locations/us-central1/functions/getPublicLibrary',
          environment: 'GEN_2',
          state: 'ACTIVE',
          serviceConfig: { environmentVariables: sharedFlagsEnabled },
        })
      );
      fs.writeFileSync(
        '/tmp/binary_download_fn_post.json',
        JSON.stringify({
          name: 'projects/promiseofplanet-bb325/locations/us-central1/functions/libraryPublishedBinaryDownload',
          environment: 'GEN_2',
          state: 'ACTIVE',
          serviceConfig: { environmentVariables: sharedFlagsEnabled },
        })
      );

      const rbManageEnabled = runNodeScript(liveReadbackManageJs, { AV_EXECUTION_MODE: 'enabled' });
      const rbPublicEnabled = runNodeScript(liveReadbackPublicJs, { AV_EXECUTION_MODE: 'enabled' });
      const rbBinaryEnabled = runNodeScript(liveReadbackBinaryJs, { AV_EXECUTION_MODE: 'enabled' });
      // Must fail if expected mode=disabled receives enabled env vars!
      const rbMismatchFail = runNodeScript(liveReadbackManageJs, { AV_EXECUTION_MODE: 'disabled' });

      const allGcloudCalls = fs.readFileSync(logPath, 'utf8');
      const noMutationsInvoked =
        !allGcloudCalls.includes('run jobs deploy') &&
        !allGcloudCalls.includes('run jobs execute') &&
        !allGcloudCalls.includes('docker push') &&
        !allGcloudCalls.includes('firebase deploy');

      const realNotFoundHandled =
        res38aReal.status === 0 &&
        env38aReal.includes('READY_FOR_INITIAL_JOB_DEPLOY_CALLER_IAM_PENDING_POST_CREATE') &&
        result38aReal.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Existing Cloud Run Job Configuration' && r.status === 'PENDING_RESOURCE_CREATION'
        ) &&
        result38aReal.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Caller run.jobs.runWithOverrides (manageLibraryDocuments)' &&
            r.status === 'PENDING_RESOURCE_CREATION'
        );

      const permPrecedenceAndGenericOk =
        res38PermPrec.status !== 0 &&
        result38PermPrec.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Existing Cloud Run Job Configuration' && r.status === 'UNKNOWN'
        ) &&
        res38GenericErr.status !== 0 &&
        result38GenericErr.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Existing Cloud Run Job Configuration' && r.status === 'FAIL'
        );

      const storageLeastPrivilegeClosed =
        res38Default403.status !== 0 &&
        result38Default403.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Worker GCS Read-Only IAM' && r.status === 'UNKNOWN'
        ) &&
        res38DefaultErr.status !== 0 &&
        result38DefaultErr.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Worker GCS Read-Only IAM' && r.status === 'UNKNOWN'
        ) &&
        res38DefaultNonexistent.status === 0 &&
        res38ProjViewerOnly.status !== 0 &&
        result38ProjViewerOnly.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Worker GCS Read-Only IAM' && r.status === 'FAIL'
        ) &&
        res38ProjViewerBoth.status !== 0;

      const v1AndV2SchemaSupportOk =
        res38V1PreflightPass.status === 0 &&
        env38V1PreflightPass.includes('ALL_CLOUD_PREREQUISITES_VERIFIED') &&
        res38ExistingPass.status === 0 &&
        env38ExistingPass.includes('ALL_CLOUD_PREREQUISITES_VERIFIED') &&
        res38V1ReadbackPass.status === 0 &&
        res38V1ReadbackPass.stdout.includes('schema=v1') &&
        res38V1ReadbackInvokerOnly.status === 0 &&
        env38V1ReadbackInvokerOnly.includes('AV_POST_DEPLOY_CALLER_IAM_STATUS=PENDING_CALLER_IAM_GRANT') &&
        res38V2ReadbackPass.status === 0 &&
        res38V2ReadbackPass.stdout.includes('schema=v2') &&
        res38ReadbackDigestMismatch.status !== 0 &&
        res38V1InvokerOnly.status !== 0 &&
        result38V1InvokerOnly.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Caller run.jobs.runWithOverrides (manageLibraryDocuments)' && r.status === 'FAIL'
        ) &&
        res38eV1.status === 0 &&
        res38e.status === 0 &&
        res38V1NumericTimeoutPreflight.status === 0 &&
        env38V1NumericTimeoutPreflight.includes('ALL_CLOUD_PREREQUISITES_VERIFIED') &&
        res38V1NumericTimeoutLive.status === 0 &&
        res38V1NumericTimeoutReadback.status === 0 &&
        res38V1NumericTimeoutReadback.stdout.includes('schema=v1');

      const missingPrereqsOk =
        res38MissingAr.status !== 0 &&
        result38MissingAr.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Artifact Registry Repository' && r.status === 'FAIL'
        ) &&
        res38MissingSa.status !== 0 &&
        result38MissingSa.matrix.some(
          (r: { check: string; status: string }) =>
            r.check === 'Target Worker Service Account' && r.status === 'FAIL'
        );

      const imageTimestampChecksOk =
        res38ImgMissing.status !== 0 &&
        res38ImgDigestMismatch.status !== 0 &&
        res38ImgMissingCreateTime.status !== 0 &&
        res38ImgInvalidCreateTime.status !== 0 &&
        res38ImgFutureCreateTime.status !== 0 &&
        res38ImgListQueryFail.status !== 0 &&
        res38ImgAmbiguous.status !== 0;

      assertCheck(
        '38',
        'Mocked-gcloud workflow scripts validate strict Cloud Run v1/v2 schemas across preflight/readback/live, fail closed on invalid/mixed/public/missing-IAM/storage bypasses, and verify dotenv + 3-function readbacks',
        noMutationsInvoked &&
          realNotFoundHandled &&
          permPrecedenceAndGenericOk &&
          storageLeastPrivilegeClosed &&
          v1AndV2SchemaSupportOk &&
          missingPrereqsOk &&
          imageTimestampChecksOk &&
          res38a.status === 0 &&
          env38a.includes('READY_FOR_INITIAL_JOB_DEPLOY_CALLER_IAM_PENDING_POST_CREATE') &&
          res38b.status !== 0 &&
          res38c.status !== 0 &&
          env38c.includes('UNVERIFIED_INSUFFICIENT_PERMISSIONS') &&
          res38d.status !== 0 &&
          resDotDisabled.status === 0 &&
          disabledDotenvText.includes('POP_LIBRARY_AV_EXECUTION_ENABLED=false') &&
          !disabledDotenvText.includes('POP_QUARANTINE_AV_JOB_') &&
          resDotEnabled.status === 0 &&
          enabledDotenvText.includes('POP_LIBRARY_AV_EXECUTION_ENABLED=true') &&
          enabledDotenvText.includes('POP_QUARANTINE_AV_JOB_PROJECT_ID=promiseofplanet-bb325') &&
          enabledDotenvText.includes('POP_QUARANTINE_AV_JOB_REGION=us-central1') &&
          enabledDotenvText.includes('POP_QUARANTINE_AV_JOB_NAME=pop-library-quarantine-av-worker') &&
          rbManageEnabled.status === 0 &&
          rbPublicEnabled.status === 0 &&
          rbBinaryEnabled.status === 0 &&
          rbMismatchFail.status !== 0
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      for (const p of [
        '/tmp/manage_library_fn_pre.json',
        '/tmp/manage_library_fn_post.json',
        '/tmp/get_public_library_fn_post.json',
        '/tmp/binary_download_fn_post.json',
        '/tmp/av_preflight_summary.md',
        '/tmp/av_preflight_result.json',
        '/tmp/av_job_post.json',
        '/tmp/av_job_post_iam.json',
        '/tmp/manage_library_post_av_deploy.json',
        '/tmp/project_iam_post_av_deploy.json',
      ]) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
  }

  // TEST 39: Client/Invoker Env Alignment & Receipt 1183ac250d0404e921d2aeadbec1b76c Hold Preservation
  {
    const prevProj = process.env[LIBRARY_QUARANTINE_AV_JOB_PROJECT_ENV_VAR];
    const prevReg = process.env[LIBRARY_QUARANTINE_AV_JOB_REGION_ENV_VAR];
    const prevJob = process.env[LIBRARY_QUARANTINE_AV_JOB_NAME_ENV_VAR];
    const prevAv = process.env[LIBRARY_AV_EXECUTION_RELEASE_ENV_VAR];

    let disabledInvokerRejected = false;
    let enabledInvokerValid = false;
    let clientDisabledByDefault = false;
    let clientEnabledOnlyWithAllFlags = false;
    let incident1183StillHeld = false;

    try {
      delete process.env[LIBRARY_QUARANTINE_AV_JOB_PROJECT_ENV_VAR];
      delete process.env[LIBRARY_QUARANTINE_AV_JOB_REGION_ENV_VAR];
      delete process.env[LIBRARY_QUARANTINE_AV_JOB_NAME_ENV_VAR];

      const invokerDisabled = new GoogleCloudRunQuarantineAvJobInvoker();
      const vDisabled = invokerDisabled.validateConfig();
      disabledInvokerRejected =
        vDisabled.ok === false &&
        vDisabled.failureReasonCode === 'JOB_CONFIG_MISSING_OR_INVALID';

      process.env[LIBRARY_QUARANTINE_AV_JOB_PROJECT_ENV_VAR] = 'promiseofplanet-bb325';
      process.env[LIBRARY_QUARANTINE_AV_JOB_REGION_ENV_VAR] = 'us-central1';
      process.env[LIBRARY_QUARANTINE_AV_JOB_NAME_ENV_VAR] =
        'pop-library-quarantine-av-worker';
      process.env[LIBRARY_AV_EXECUTION_RELEASE_ENV_VAR] = 'true';

      const invokerEnabled = new GoogleCloudRunQuarantineAvJobInvoker();
      const vEnabled = invokerEnabled.validateConfig();
      enabledInvokerValid =
        vEnabled.ok === true &&
        vEnabled.config.projectId === 'promiseofplanet-bb325' &&
        vEnabled.config.region === 'us-central1' &&
        vEnabled.config.jobName === 'pop-library-quarantine-av-worker';

      clientDisabledByDefault =
        isLibraryQuarantineAvExecutionEnabled({
          VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
          VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
          VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
          VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
          VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'true',
          VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED: 'true',
          VITE_LIBRARY_AV_EXECUTION_ENABLED: 'false',
        }) === false;

      clientEnabledOnlyWithAllFlags =
        isLibraryQuarantineAvExecutionEnabled({
          VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
          VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
          VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
          VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
          VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'true',
          VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED: 'true',
          VITE_LIBRARY_AV_EXECUTION_ENABLED: 'true',
        }) === true;

      const incidentRid = '1183ac250d0404e921d2aeadbec1b76c';
      const binDb = new InMemoryReleaseFirestoreDatabase();
      const binBucket = new InMemoryPublishedBinaryBucket();
      seedCleanBinaryChain(binDb, binBucket, {
        receiptId: incidentRid,
        format: 'PDF',
        bytes: buildDeterministicValidPdfBytes('Incident Hold Check'),
        avState: 'MISSING',
        priorRightsDecision: 'RESTRICTED',
      });

      const statusRes = (await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: ownerFnUser.id },
          data: {
            action: 'getPublishedLibraryBinaryReleaseStatus',
            receiptId: incidentRid,
          },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          ...buildHandlerOptions({
            binarySafetyCaseEnabled: true,
            isolatedInspectionRequestEnabled: true,
            publishedBinaryReleaseEnabled: true,
          }),
          draftDatabase: binDb,
          publishedBinaryStorageBucket: binBucket,
          publishedBinaryReleaseClock: () => '2026-11-16T10:00:00.000Z',
        }
      )) as ClientGetPublishedBinaryStatusDto;

      incident1183StillHeld =
        statusRes.ok === true &&
        statusRes.isPublished === false &&
        statusRes.eligibleForPublish === false &&
        statusRes.blockCode === 'WAITING_FOR_ACTUAL_SCAN';
    } finally {
      if (prevProj === undefined) delete process.env[LIBRARY_QUARANTINE_AV_JOB_PROJECT_ENV_VAR];
      else process.env[LIBRARY_QUARANTINE_AV_JOB_PROJECT_ENV_VAR] = prevProj;
      if (prevReg === undefined) delete process.env[LIBRARY_QUARANTINE_AV_JOB_REGION_ENV_VAR];
      else process.env[LIBRARY_QUARANTINE_AV_JOB_REGION_ENV_VAR] = prevReg;
      if (prevJob === undefined) delete process.env[LIBRARY_QUARANTINE_AV_JOB_NAME_ENV_VAR];
      else process.env[LIBRARY_QUARANTINE_AV_JOB_NAME_ENV_VAR] = prevJob;
      if (prevAv === undefined) delete process.env[LIBRARY_AV_EXECUTION_RELEASE_ENV_VAR];
      else process.env[LIBRARY_AV_EXECUTION_RELEASE_ENV_VAR] = prevAv;
    }

    assertCheck(
      '39',
      'Invoker rejects missing job vars when disabled, validates exact 3 vars when enabled, and receipt 1183ac250d0404e921d2aeadbec1b76c stays blocked without auto-publication',
      disabledInvokerRejected &&
        enabledInvokerValid &&
        clientDisabledByDefault &&
        clientEnabledOnlyWithAllFlags &&
        incident1183StillHeld
    );
  }

  // TEST 40: firebase-hosting-live.yml fail-closed validation & build propagation of all 12 VITE_LIBRARY_* vars
  {
    const hostingWorkflowText = fs.readFileSync(
      '.github/workflows/firebase-hosting-live.yml',
      'utf8'
    );
    const requiredTwelveLibraryVars = [
      'VITE_LIBRARY_QUARANTINE_UPLOAD_ENABLED',
      'VITE_LIBRARY_QUARANTINE_UPLOAD_ENDPOINT_URL',
      'VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED',
      'VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED',
      'VITE_LIBRARY_CATALOG_HANDOFF_ENABLED',
      'VITE_LIBRARY_RIGHTS_DECISION_ENABLED',
      'VITE_LIBRARY_CASE_ALIGNMENT_ENABLED',
      'VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED',
      'VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED',
      'VITE_LIBRARY_AV_EXECUTION_ENABLED',
      'VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED',
      'VITE_LIBRARY_PUBLISHED_BINARY_RELEASE_ENABLED',
    ] as const;

    const allTwelveReferencedFromVars = requiredTwelveLibraryVars.every((varName) =>
      hostingWorkflowText.includes(`${varName}: \${{ vars.${varName} }}`)
    );
    const allTwelvePropagatedInBuild = requiredTwelveLibraryVars.every((varName) => {
      const matches = hostingWorkflowText.match(
        new RegExp(`${varName}: \\$\\{\\{ vars\\.${varName} \\}\\}`, 'g')
      );
      // Appears in BOTH the fail-closed validation step and the build step
      return (matches?.length ?? 0) >= 2;
    });
    const noHardcodedTrueForLibraryVars = requiredTwelveLibraryVars.every(
      (varName) =>
        !new RegExp(`${varName}:\\s*["']?true["']?`).test(hostingWorkflowText)
    );
    const validatesAvBooleanAndUploadEndpoint =
      hostingWorkflowText.includes('VITE_LIBRARY_AV_EXECUTION_ENABLED') &&
      hostingWorkflowText.includes(
        'https://us-central1-promiseofplanet-bb325.cloudfunctions.net/libraryQuarantineUploadEndpoint'
      ) &&
      hostingWorkflowText.includes(
        'Validate Library Quarantine, Review, Release & AV Flags'
      );

    assertCheck(
      '40',
      'firebase-hosting-live.yml validates fail-closed and propagates all 12 VITE_LIBRARY_* repository variables without hardcoding true',
      allTwelveReferencedFromVars &&
        allTwelvePropagatedInBuild &&
        noHardcodedTrueForLibraryVars &&
        validatesAvBooleanAndUploadEndpoint
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
