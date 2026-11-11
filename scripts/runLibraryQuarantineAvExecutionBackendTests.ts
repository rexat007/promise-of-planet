import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';

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

const firebaseAdminRuntimeMock: {
  enabled: boolean;
  apps: Array<{ readonly name: string }>;
  throwOnGetApps: Error | null;
  throwOnInitializeApp: Error | null;
  firestoreProvider: (() => unknown) | null;
  storageBucketProvider: ((bucketName: string) => unknown) | null;
  callOrder: string[];
  getAppsCalls: number;
  initializeAppCalls: number;
  getFirestoreCalls: number;
  getStorageCalls: number;
  requestedBucketNames: string[];
  interceptedModuleSpecifiers: string[];
} = {
  enabled: false,
  apps: [],
  throwOnGetApps: null,
  throwOnInitializeApp: null,
  firestoreProvider: null,
  storageBucketProvider: null,
  callOrder: [],
  getAppsCalls: 0,
  initializeAppCalls: 0,
  getFirestoreCalls: 0,
  getStorageCalls: 0,
  requestedBucketNames: [],
  interceptedModuleSpecifiers: [],
};

const firebaseAdminAppMockModule = Object.freeze({
  getApps: () => {
    firebaseAdminRuntimeMock.getAppsCalls += 1;
    firebaseAdminRuntimeMock.callOrder.push('getApps');
    if (!firebaseAdminRuntimeMock.enabled) {
      throw new Error(
        'Uninjected live getApps() must not be called in headless backend tests.'
      );
    }
    if (firebaseAdminRuntimeMock.throwOnGetApps) {
      throw firebaseAdminRuntimeMock.throwOnGetApps;
    }
    return [...firebaseAdminRuntimeMock.apps];
  },
  initializeApp: () => {
    firebaseAdminRuntimeMock.initializeAppCalls += 1;
    firebaseAdminRuntimeMock.callOrder.push('initializeApp');
    if (!firebaseAdminRuntimeMock.enabled) {
      throw new Error(
        'Uninjected live initializeApp() must not be called in headless backend tests.'
      );
    }
    if (firebaseAdminRuntimeMock.throwOnInitializeApp) {
      throw firebaseAdminRuntimeMock.throwOnInitializeApp;
    }
    const createdApp = Object.freeze({ name: '[DEFAULT]' });
    firebaseAdminRuntimeMock.apps.push(createdApp);
    return createdApp;
  },
});

const firebaseAdminAuthMockModule = Object.freeze({
  getAuth: () => {
    throw new Error(
      'Uninjected live getAuth() must not be called in headless backend tests.'
    );
  },
});

const firebaseAdminFirestoreMockModule = Object.freeze({
  getFirestore: () => {
    firebaseAdminRuntimeMock.getFirestoreCalls += 1;
    firebaseAdminRuntimeMock.callOrder.push('getFirestore');
    if (
      !firebaseAdminRuntimeMock.enabled ||
      !firebaseAdminRuntimeMock.firestoreProvider
    ) {
      throw new Error(
        'Uninjected live getFirestore() must not be called in headless backend tests.'
      );
    }
    if (firebaseAdminRuntimeMock.apps.length === 0) {
      throw new Error(
        'The default Firebase app does not exist. Make sure you call initializeApp() before using any of the Firebase services.'
      );
    }
    return firebaseAdminRuntimeMock.firestoreProvider();
  },
});

const firebaseAdminStorageMockModule = Object.freeze({
  getStorage: () => {
    firebaseAdminRuntimeMock.getStorageCalls += 1;
    firebaseAdminRuntimeMock.callOrder.push('getStorage');
    if (
      !firebaseAdminRuntimeMock.enabled ||
      !firebaseAdminRuntimeMock.storageBucketProvider
    ) {
      throw new Error(
        'Uninjected live getStorage() must not be called in headless backend tests.'
      );
    }
    if (firebaseAdminRuntimeMock.apps.length === 0) {
      throw new Error(
        'The default Firebase app does not exist. Make sure you call initializeApp() before using any of the Firebase services.'
      );
    }
    return {
      bucket: (bucketName: string) => {
        firebaseAdminRuntimeMock.requestedBucketNames.push(bucketName);
        return firebaseAdminRuntimeMock.storageBucketProvider!(bucketName);
      },
    };
  },
});

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
): unknown {
  if (request === 'firebase-admin/app') {
    firebaseAdminRuntimeMock.interceptedModuleSpecifiers.push(request);
    return firebaseAdminAppMockModule;
  }
  if (request === 'firebase-admin/auth') {
    firebaseAdminRuntimeMock.interceptedModuleSpecifiers.push(request);
    return firebaseAdminAuthMockModule;
  }
  if (request === 'firebase-admin/firestore') {
    firebaseAdminRuntimeMock.interceptedModuleSpecifiers.push(request);
    return firebaseAdminFirestoreMockModule;
  }
  if (request === 'firebase-admin/storage') {
    firebaseAdminRuntimeMock.interceptedModuleSpecifiers.push(request);
    return firebaseAdminStorageMockModule;
  }

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
  LibraryQuarantineCatalogCaseAlignmentService,
  type LibraryQuarantinePersistedCatalogCaseAlignment,
} from '../functions/src/library/libraryQuarantineCatalogCaseAlignmentService';
import {
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
  type LibraryQuarantineBinarySafetyDisposition,
  type LibraryQuarantinePersistedBinarySafetyCase,
} from '../functions/src/library/libraryQuarantineBinarySafetyCaseContract';
import {
  BINARY_SAFETY_STORE_SAFE_MESSAGES,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore';
import { LibraryQuarantineBinarySafetyCaseService } from '../functions/src/library/libraryQuarantineBinarySafetyCaseService';
import {
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  validatePersistedLibraryQuarantineIsolatedInspectionRequest,
  type LibraryQuarantinePersistedIsolatedInspectionRequest,
} from '../functions/src/library/libraryQuarantineIsolatedInspectionRequestContract';
import {
  ISOLATED_INSPECTION_STORE_SAFE_MESSAGES,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
} from '../functions/src/library/firestoreLibraryQuarantineIsolatedInspectionRequestStore';
import { LibraryQuarantineIsolatedInspectionRequestService } from '../functions/src/library/libraryQuarantineIsolatedInspectionRequestService';
import { MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES } from '../functions/src/library/libraryUploadBinaryAdmission';
import {
  LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
  LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
  LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
  QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
  toSanitizedLibraryQuarantineAvExecutionDto,
  validatePersistedLibraryQuarantineAvExecution,
} from '../functions/src/library/libraryQuarantineAvExecutionContract';
import {
  GoogleCloudRunQuarantineAvJobInvoker,
  LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR,
  buildCloudRunJobRunRequestBody,
  type InvokeQuarantineAvJobResult,
  type LibraryQuarantineAvJobInvoker,
} from '../functions/src/library/libraryQuarantineAvJobInvoker';
import {
  AV_EXECUTION_SAFE_MESSAGES,
  FirestoreLibraryQuarantineAvExecutionStore,
  LibraryQuarantineAvExecutionService,
} from '../functions/src/library/libraryQuarantineAvExecutionService';
import type {
  GenerationPinnedQuarantineBucket,
} from '../functions/src/library/libraryQuarantineAvWorker';
import {
  LIBRARY_QUARANTINE_CACHE_CONTROL,
  LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
  LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
  type GcsLibraryQuarantineObjectMetadata,
} from '../functions/src/library/gcsLibraryQuarantineStorageAdapter';

const require = createRequire(import.meta.url);
const {
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
} = require(
  '../functions/src/library/libraryQuarantineUploadEndpoint'
) as typeof import('../functions/src/library/libraryQuarantineUploadEndpoint');
const {
  LIBRARY_AV_EXECUTION_RELEASE_ENV_VAR,
  LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR,
  LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR,
  LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR,
  LIBRARY_ISOLATED_INSPECTION_REQUEST_RELEASE_ENV_VAR,
  LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR,
  executeManageLibraryDocumentsRequest,
} = require(
  '../functions/src/library/libraryAdminHandlers'
) as typeof import('../functions/src/library/libraryAdminHandlers');

const {
  executeLibraryQuarantineAvWorkerTask,
  runLibraryQuarantineAvWorkerCli,
} = require(
  '../functions/src/library/libraryQuarantineAvWorker'
) as typeof import('../functions/src/library/libraryQuarantineAvWorker');

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildHexReceiptId(index: number): string {
  return index.toString(16).padStart(32, '0');
}

interface RecordedTxOp {
  readonly kind: 'get' | 'create' | 'set' | 'update';
  readonly collectionName: string;
  readonly docId: string;
}

class InMemoryAvExecutionFirestoreDatabase
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
  public txSetCalls = 0;
  public txUpdateCalls = 0;
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
    this.txSetCalls = 0;
    this.txUpdateCalls = 0;
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
        set(
          ref: LibraryQuarantineFirestoreDocumentRef,
          data: Record<string, unknown>
        ): void;
        update(
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
          if (colName !== LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION) {
            throw new Error(
              `UNAUTHORIZED_WRITE_COLLECTION: ${colName}/${ref.id}`
            );
          }
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
        set: (
          ref: LibraryQuarantineFirestoreDocumentRef,
          data: Record<string, unknown>
        ): void => {
          if (!writePhaseStarted) {
            writePhaseStarted = true;
            this.onBeforeTransactionWritesHook?.(attempt);
          }
          const colName = resolveColName(ref);
          if (colName !== LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION) {
            throw new Error(
              `UNAUTHORIZED_WRITE_COLLECTION: ${colName}/${ref.id}`
            );
          }
          this.txSetCalls += 1;
          this.txOps.push({
            kind: 'set',
            collectionName: colName,
            docId: ref.id,
          });
          stagedMutations.push(() => {
            let col = workingState.get(colName);
            if (!col) {
              col = new Map();
              workingState.set(colName, col);
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

function seedFullEightDocChain(
  db: InMemoryAvExecutionFirestoreDatabase,
  index: number,
  overrides: {
    readonly format?: 'PDF' | 'DOCX';
    readonly payloadBytes?: Buffer;
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
    readonly includeInspectionRequest?: boolean;
    readonly inspectionRequestRequestedAt?: string;
  } = {}
) {
  const receiptId = buildHexReceiptId(index);
  const documentId = deriveQuarantineCatalogDocumentId(receiptId);
  const format = overrides.format ?? 'PDF';
  const payloadBytes =
    overrides.payloadBytes ??
    Buffer.from(
      format === 'PDF'
        ? `%PDF-1.7\n% Quarantined Binary Payload #${index}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n`
        : `PK\x03\x04 Quarantined DOCX Payload #${index}`,
      'utf8'
    );
  const sha256 = createHash('sha256').update(payloadBytes).digest('hex');

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
      ? `173135000000${index}`
      : null;

  const receipt: LibraryQuarantineInternalReceipt = Object.freeze({
    receiptId,
    uploaderUid: 'admin_curator_01',
    originalFilename: `coastal-assessment-${index}.${canonicalExtension}`,
    sanitizedFilename: `coastal-assessment-${index}.${canonicalExtension}`,
    format,
    canonicalExtension,
    canonicalMimeType,
    byteSize: payloadBytes.byteLength,
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
  const safetyRev = overrides.safetyCaseRevision ?? 1;
  let safetyCase: LibraryQuarantinePersistedBinarySafetyCase | null = null;

  if (includeSafetyCase) {
    const safetyCreatedAt = '2026-11-11T08:40:00.000Z';
    const safetyUpdatedAt =
      safetyRev === 1 ? safetyCreatedAt : '2026-11-11T08:45:00.000Z';

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

  const requestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
    receiptId,
    receiptRevision,
    safetyRev
  );

  const includeInspectionRequest = overrides.includeInspectionRequest ?? true;
  let inspectionRequest: LibraryQuarantinePersistedIsolatedInspectionRequest | null =
    null;

  if (includeInspectionRequest && safetyCase && generation) {
    const requestedAt =
      overrides.inspectionRequestRequestedAt ?? '2026-11-11T08:50:00.000Z';
    inspectionRequest = Object.freeze({
      schemaVersion:
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
      requestId,
      receiptId,
      documentId,
      sourceRevision: receiptRevision,
      sourceUpdatedAt: receipt.updatedAt,
      sourceSha256: sha256,
      sourceGeneration: generation,
      sourceByteSize: receipt.byteSize,
      sourceFormat: format,
      deepInspectionStatus,
      safetyCaseRevision: safetyCase.revision,
      effectiveHumanCaseRevision: safetyCase.effectiveHumanCaseRevision,
      catalogUpdatedAt: safetyCase.catalogUpdatedAt,
      requestedBy: 'owner_01',
      requestedAt,
      state: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
      dispatched: false as const,
      scanPerformed: false as const,
      sanitized: false as const,
      isVerifiedSafe: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });

    db.seedDoc(
      LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
      requestId,
      inspectionRequest
    );
  }

  return {
    receiptId,
    documentId,
    requestId,
    payloadBytes,
    sha256,
    generation,
    receipt,
    envelope,
    draft,
    reviewCase,
    handoff,
    catalogDoc,
    safetyCase,
    inspectionRequest,
  };
}

function createFakeGenerationPinnedBucket(params: {
  readonly bucketName?: string;
  readonly expectedStoragePath: string;
  readonly expectedGeneration: string;
  readonly payloadBytes: Buffer;
  readonly metadataOverrides?: Partial<GcsLibraryQuarantineObjectMetadata>;
  readonly streamModifier?: (bytes: Buffer) => Buffer;
  readonly onGetMetadata?: (callIndex: number) => Partial<GcsLibraryQuarantineObjectMetadata> | void;
}): GenerationPinnedQuarantineBucket & {
  requestedPaths: string[];
  requestedGenerations: Array<string | number | undefined>;
  metadataCalls: number;
  streamCalls: number;
} {
  const bucketName =
    params.bucketName ?? LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME;
  const requestedPaths: string[] = [];
  const requestedGenerations: Array<string | number | undefined> = [];
  let metadataCalls = 0;
  let streamCalls = 0;

  return {
    name: bucketName,
    get requestedPaths() {
      return requestedPaths;
    },
    get requestedGenerations() {
      return requestedGenerations;
    },
    get metadataCalls() {
      return metadataCalls;
    },
    get streamCalls() {
      return streamCalls;
    },
    file(objectPath: string, options?: { readonly generation?: string | number }) {
      requestedPaths.push(objectPath);
      requestedGenerations.push(options?.generation);

      const matchesTarget =
        objectPath === params.expectedStoragePath &&
        String(options?.generation ?? '') === params.expectedGeneration;

      return {
        async exists(): Promise<readonly [boolean]> {
          return [matchesTarget] as const;
        },
        async getMetadata(): Promise<readonly [GcsLibraryQuarantineObjectMetadata]> {
          metadataCalls += 1;
          const hookOverride = params.onGetMetadata?.(metadataCalls) ?? {};
          const ext = params.expectedStoragePath.endsWith('.docx')
            ? 'docx'
            : 'pdf';
          const mime =
            ext === 'docx'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : 'application/pdf';
          const receiptId = params.expectedStoragePath.split('/')[2] ?? '';

          const baseMeta: GcsLibraryQuarantineObjectMetadata = {
            bucket: bucketName,
            name: objectPath,
            generation: String(options?.generation ?? params.expectedGeneration),
            size: String(params.payloadBytes.byteLength),
            contentType: mime,
            contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
            cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
            metadata: {
              quarantineReceiptId: receiptId,
              quarantineSha256: createHash('sha256')
                .update(params.payloadBytes)
                .digest('hex'),
              quarantineFormat: ext === 'docx' ? 'DOCX' : 'PDF',
              quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
              uploaderUid: 'admin_curator_01',
            },
            ...params.metadataOverrides,
            ...hookOverride,
          };
          return [baseMeta] as const;
        },
        createReadStream(): NodeJS.ReadableStream {
          streamCalls += 1;
          const bytesToStream = params.streamModifier
            ? params.streamModifier(params.payloadBytes)
            : params.payloadBytes;
          return Readable.from([bytesToStream]);
        },
      };
    },
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
    'dispatchedBy',
    'workerRunId',
    'createdBy',
    'updatedBy',
    'storagePath',
    'generation',
    'byteSize',
    'signedUrl',
    'downloadUrl',
    'gs://',
    'library/quarantine/',
    '/tmp/',
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
    'functions/src/library/libraryUploadBinaryAdmission.ts',
    'c479007641d799afb145436bf91e661a7c2d5611',
  ],
  [
    'functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts',
    'cb679848608d7000b564ad3863ee23f7c888b970',
  ],
  [
    'functions/src/library/libraryQuarantineAvExecutionContract.ts',
    'e909ad973da54d6c327892a259e0f0957dbc9582',
  ],
  [
    'functions/src/library/libraryQuarantineReceiptContract.ts',
    '4b4d5f32e5903def3a3b0dcdecd45e38083f91bb',
  ],
  [
    'functions/src/library/libraryQuarantineHumanReviewCaseContract.ts',
    '8fe5f352736faddd3f95c0a09106a79b7bec5c89',
  ],
  [
    'functions/src/library/libraryQuarantineAvJobInvoker.ts',
    '15a462b427f3e3c49de7d1aa5376328f9782265e',
  ],
  [
    'functions/src/library/gcsLibraryQuarantineStorageAdapter.ts',
    '4bca554dd00a5e2efc739cc166175cc63327c5ad',
  ],
  [
    'functions/src/library/libraryQuarantineBinarySafetyCaseContract.ts',
    'f1fdeb09b2b98baa98ea636d58552c59bf81ea72',
  ],
  [
    'functions/src/library/firestoreLibraryQuarantineReceiptStore.ts',
    'd9f4114222851c62c25574efbb0ffbeeb5c355e2',
  ],
  [
    'functions/src/library/libraryQuarantineUploadEndpoint.ts',
    'c400d40606d9d124c377ab3e0c536278d3fb61bc',
  ],
  [
    'functions/src/library/libraryQuarantineCatalogHandoffService.ts',
    '79e80cb3b9917ea9c0d3e15e23d5452235751b59',
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
    'functions/src/types/admin.ts',
    '8064d1393b6e519f9df4be13ad35ece6d07907c0',
  ],
  ['src/types/admin.ts', '226e5fa017f1123181deb8bee259cb294adb8683'],
  ['functions/src/index.ts', '5a14cada5dad8e764f8cc3092f40c386f6b09616'],
  [
    'functions/library-av-worker.Dockerfile',
    '7d15c7f825169a7d78d71345e1e1046509b0cd00',
  ],
  [
    '.github/workflows/library-quarantine-av-job.yml',
    '4ae529cd83e3fa22d9e5616e4b05178626bf7270',
  ],
  [
    'functions/package.json',
    '420e933933f4f582a4ded415727152021faf5400',
  ],
  [
    'functions/tsconfig.json',
    'eb3212ee4cd1c4acaa70618850e9c0fa0346dbf6',
  ],
]);

async function runTests(): Promise<void> {
  console.log('STARTING LIB-FILE-ISOLATED-AV-EXECUTION-M1 BACKEND TESTS...');

  // =========================================================================
  // TEST 1: 6-Flag Release Gate OFF -> 0 AdminRepo & 0 Firestore reads;
  //         Owner-Only RBAC rejects non-Owner, inactive Owner, and token spoof
  // =========================================================================
  {
    const db = new InMemoryAvExecutionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([
      ownerAdmin,
      inactiveOwnerAdmin,
      curatorAdmin,
      rightsReviewerAdmin,
      aiAssistantAdmin,
    ]);
    const seeded = seedFullEightDocChain(db, 1);

    assert.equal(
      LIBRARY_AV_EXECUTION_RELEASE_ENV_VAR,
      'POP_LIBRARY_AV_EXECUTION_ENABLED'
    );

    // Enable first 5 gates, leave 6th gate OFF -> must fail closed with AV_EXECUTION_NOT_RELEASED
    process.env[LIBRARY_REVIEW_WORKBENCH_RELEASE_ENV_VAR] = 'true';
    process.env[LIBRARY_HUMAN_CASE_REVIEW_RELEASE_ENV_VAR] = 'true';
    process.env[LIBRARY_CATALOG_HANDOFF_RELEASE_ENV_VAR] = 'true';
    process.env[LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR] = 'true';
    process.env[LIBRARY_ISOLATED_INSPECTION_REQUEST_RELEASE_ENV_VAR] = 'true';
    delete process.env[LIBRARY_AV_EXECUTION_RELEASE_ENV_VAR];

    for (const action of [
      'getQuarantineAvInspectionStatus',
      'dispatchQuarantineAvInspection',
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
              err.message.includes('AV_EXECUTION_NOT_RELEASED'),
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
    delete process.env[LIBRARY_ISOLATED_INSPECTION_REQUEST_RELEASE_ENV_VAR];

    // Non-owner, inactive owner, and token spoof rejected with 0 Firestore reads
    for (const badCaller of [
      { uid: curatorAdmin.id, token: {} },
      { uid: rightsReviewerAdmin.id, token: {} },
      { uid: inactiveOwnerAdmin.id, token: {} },
      { uid: aiAssistantAdmin.id, token: {} },
      { uid: ownerAdmin.id, token: { automated: true } },
      { uid: ownerAdmin.id, token: { role: 'owner' } },
      { uid: ownerAdmin.id, token: { dispatchedBy: 'owner_01' } },
    ]) {
      db.resetCounters();
      const svc = new LibraryQuarantineAvExecutionService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => badCaller,
        },
        adminRepository: adminRepo,
        db,
      });

      const getRes = await svc.getQuarantineAvInspectionStatus({
        receiptId: seeded.receiptId,
      });
      assert.equal(getRes.ok, false);
      assert.equal(getRes.outcome, 'HOLD');
      assert.equal(db.pointGetCalls, 0);

      const dispRes = await svc.dispatchQuarantineAvInspection({
        receiptId: seeded.receiptId,
        expectedRequestId: seeded.requestId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
      });
      assert.equal(dispRes.ok, false);
      assert.equal(dispRes.outcome, 'HOLD');
      assert.equal(db.pointGetCalls, 0);
      assert.equal(db.transactionCount, 0);
    }
  }

  // =========================================================================
  // TEST 2: GET Status performs 9 point reads, 0 writes, returns NOT_DISPATCHED
  //         when request exists without execution, and fails closed on missing
  //         or drifted chain documents
  // =========================================================================
  {
    const db = new InMemoryAvExecutionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullEightDocChain(db, 2, { format: 'PDF' });

    const service = new LibraryQuarantineAvExecutionService({
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
    const statusRes = await service.getQuarantineAvInspectionStatus({
      receiptId: seeded.receiptId,
    });
    assert.equal(statusRes.ok, true, JSON.stringify(statusRes));
    if (statusRes.ok) {
      assert.equal(statusRes.status, 'NOT_DISPATCHED');
      assert.equal(statusRes.outcome, 'NOT_DISPATCHED');
      assert.equal(statusRes.requestId, seeded.requestId);
      assert.equal(statusRes.inspectionRequestRecorded, true);
      assert.equal(statusRes.execution, null);
      assert.deepEqual(
        statusRes.readiness,
        QUARANTINE_AV_EXECUTION_READINESS_INDICATORS
      );
      assertZeroSecretLeakage(statusRes, seeded.sha256, seeded.generation);
    }
    assert.equal(db.pointGetCalls, 9);
    assert.equal(db.transactionCount, 0);
  }

  // =========================================================================
  // TEST 3: Cloud Run Job v2 Invoker Payload Contract, Pre-Launch Config/IAM
  //         Validation, API_REJECTED (4xx), and DISPATCH_UNKNOWN (5xx/timeout)
  // =========================================================================
  {
    const requestId = `${buildHexReceiptId(3)}_2_1`;
    const body = buildCloudRunJobRunRequestBody(requestId);
    assert.deepEqual(body, {
      overrides: {
        containerOverrides: [
          {
            env: [
              {
                name: LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR,
                value: requestId,
              },
            ],
          },
        ],
        taskCount: 1,
        timeout: '600s',
      },
    });
    assert.equal(JSON.stringify(body).includes('storagePath'), false);
    assert.equal(JSON.stringify(body).includes('generation'), false);
    assert.equal(JSON.stringify(body).includes('sha256'), false);

    // Missing job config -> PRE_LAUNCH_FAILED with 0 HTTP calls
    let fetchCalls = 0;
    const missingCfgInvoker = new GoogleCloudRunQuarantineAvJobInvoker({
      projectId: '',
      region: 'europe-west1',
      jobName: 'pop-quarantine-av-worker',
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
    const preLaunchCfgRes =
      await missingCfgInvoker.invokeAvJobForRequest(requestId);
    assert.equal(preLaunchCfgRes.status, 'PRE_LAUNCH_FAILED');
    if (preLaunchCfgRes.status === 'PRE_LAUNCH_FAILED') {
      assert.equal(
        preLaunchCfgRes.failureReasonCode,
        'JOB_CONFIG_MISSING_OR_INVALID'
      );
    }
    assert.equal(fetchCalls, 0);

    // 200 OK -> LAUNCHED
    let capturedUrl = '';
    let capturedPayload = '';
    const okInvoker = new GoogleCloudRunQuarantineAvJobInvoker({
      projectId: 'promiseofplanet-bb325',
      region: 'europe-west1',
      jobName: 'pop-quarantine-av-worker',
      accessTokenProvider: async () => 'ya29.test-server-token',
      fetchImpl: (async (url: unknown, init?: RequestInit) => {
        fetchCalls += 1;
        capturedUrl = String(url);
        capturedPayload = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            name: 'projects/promiseofplanet-bb325/locations/europe-west1/jobs/pop-quarantine-av-worker/executions/exec-001',
          }),
          { status: 200 }
        );
      }) as typeof fetch,
    });
    const launchedRes = await okInvoker.invokeAvJobForRequest(requestId);
    assert.equal(launchedRes.status, 'LAUNCHED');
    assert.equal(
      capturedUrl,
      'https://run.googleapis.com/v2/projects/promiseofplanet-bb325/locations/europe-west1/jobs/pop-quarantine-av-worker:run'
    );
    assert.deepEqual(JSON.parse(capturedPayload), body);

    // 403 Forbidden -> API_REJECTED (IAM_PRECONDITION_FAILED)
    const rejectedInvoker = new GoogleCloudRunQuarantineAvJobInvoker({
      projectId: 'promiseofplanet-bb325',
      region: 'europe-west1',
      jobName: 'pop-quarantine-av-worker',
      accessTokenProvider: async () => 'ya29.test-server-token',
      fetchImpl: (async () =>
        new Response('Permission denied', { status: 403 })) as typeof fetch,
    });
    const rejectedRes = await rejectedInvoker.invokeAvJobForRequest(requestId);
    assert.equal(rejectedRes.status, 'API_REJECTED');
    if (rejectedRes.status === 'API_REJECTED') {
      assert.equal(rejectedRes.failureReasonCode, 'IAM_PRECONDITION_FAILED');
    }

    // 503 Unavailable -> DISPATCH_UNKNOWN (JOB_LAUNCH_UNCERTAIN)
    const unknownInvoker = new GoogleCloudRunQuarantineAvJobInvoker({
      projectId: 'promiseofplanet-bb325',
      region: 'europe-west1',
      jobName: 'pop-quarantine-av-worker',
      accessTokenProvider: async () => 'ya29.test-server-token',
      fetchImpl: (async () =>
        new Response('Service unavailable', { status: 503 })) as typeof fetch,
    });
    const unknownRes = await unknownInvoker.invokeAvJobForRequest(requestId);
    assert.equal(unknownRes.status, 'DISPATCH_UNKNOWN');
  }

  // =========================================================================
  // TEST 4: Dispatch Transaction (9 reads before 1 create), Single-Dispatch
  //         Idempotency, Immutable Inspection Request Preservation, and
  //         Pre-Launch vs Ambiguous Invoker Handling
  // =========================================================================
  {
    const db = new InMemoryAvExecutionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const seeded = seedFullEightDocChain(db, 4, { format: 'PDF' });

    // 4A: Missing job config fails BEFORE any transaction or ledger write
    const badCfgService = new LibraryQuarantineAvExecutionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      avJobInvoker: {
        validateConfig: () => ({
          ok: false,
          failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID',
          errorMessage: 'Cloud Run Job configuration is missing.',
        }),
        invokeAvJobForRequest: async () => {
          throw new Error('Must not be called when validateConfig fails');
        },
      },
    });

    db.resetCounters();
    const badCfgRes = await badCfgService.dispatchQuarantineAvInspection({
      receiptId: seeded.receiptId,
      expectedRequestId: seeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    assert.equal(badCfgRes.ok, false);
    if (!badCfgRes.ok && badCfgRes.status === 'HOLD') {
      assert.equal(badCfgRes.errorCode, 'JOB_CONFIG_MISSING_OR_INVALID');
    }
    assert.equal(db.transactionCount, 0);
    assert.equal(
      db.getRawDoc(LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION, seeded.requestId),
      undefined
    );

    // 4B: Valid dispatch -> Phase 1 (9 tx.get + 1 tx.create DISPATCH_PENDING)
    //     + Phase 2 invoker LAUNCHED -> CAS to DISPATCHED_WAITING_WORKER (rev 2)
    let invokerCalls = 0;
    const mockInvoker: LibraryQuarantineAvJobInvoker = {
      validateConfig: () => ({
        ok: true,
        config: {
          projectId: 'promiseofplanet-bb325',
          region: 'europe-west1',
          jobName: 'pop-quarantine-av-worker',
        },
      }),
      invokeAvJobForRequest: async (reqId: string) => {
        invokerCalls += 1;
        assert.equal(reqId, seeded.requestId);
        return {
          status: 'LAUNCHED',
          executionName: 'exec-004',
        };
      },
    };

    const service = new LibraryQuarantineAvExecutionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      avJobInvoker: mockInvoker,
      clock: () => '2026-11-11T09:10:00.000Z',
    });

    db.resetCounters();
    const disp1 = await service.dispatchQuarantineAvInspection({
      receiptId: seeded.receiptId,
      expectedRequestId: seeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });

    assert.equal(disp1.ok, true, JSON.stringify(disp1));
    if (disp1.ok) {
      assert.equal(disp1.status, 'DISPATCHED_WAITING_WORKER');
      assert.equal(disp1.outcome, 'DISPATCHED');
      assert.equal(disp1.dispatchOutcome, 'DISPATCHED');
      assert.equal(disp1.execution.state, 'DISPATCHED_WAITING_WORKER');
      assert.equal(disp1.execution.revision, 2);
      assert.equal(
        disp1.inspectionRequest.state,
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE
      );
      assert.equal(disp1.inspectionRequest.dispatched, false);
      assert.equal(disp1.inspectionRequest.scanPerformed, false);
      assertZeroSecretLeakage(disp1, seeded.sha256, seeded.generation);
    }
    assert.equal(invokerCalls, 1);

    // Verify Phase 1 transaction performed 9 reads before 1 create
    const firstNineOps = db.txOps.slice(0, 9);
    assert.equal(
      firstNineOps.every((op) => op.kind === 'get'),
      true
    );
    assert.equal(db.txOps[9]?.kind, 'create');
    assert.equal(
      db.txOps[9]?.collectionName,
      LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION
    );

    // Verify immutable inspection request was NEVER modified in Firestore
    const storedReq = db.getRawDoc(
      LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
      seeded.requestId
    );
    assert.deepEqual(storedReq, seeded.inspectionRequest);

    // 4C: Second dispatch for same requestId -> ALREADY_DISPATCHED with 0 new job invocations & 0 writes
    db.resetCounters();
    const disp2 = await service.dispatchQuarantineAvInspection({
      receiptId: seeded.receiptId,
      expectedRequestId: seeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    assert.equal(disp2.ok, true);
    if (disp2.ok) {
      assert.equal(disp2.outcome, 'ALREADY_DISPATCHED');
      assert.equal(disp2.dispatchOutcome, 'ALREADY_DISPATCHED');
      assert.equal(disp2.status, 'DISPATCHED_WAITING_WORKER');
    }
    assert.equal(invokerCalls, 1);
    assert.equal(db.txCreateCalls, 0);
    assert.equal(db.txSetCalls, 0);

    // 4D: Ambiguous Cloud Run Job launch -> returns UNKNOWN and records DISPATCH_UNKNOWN in ledger without auto-retry
    const seededUnknown = seedFullEightDocChain(db, 5, { format: 'PDF' });
    let unknownInvokerCalls = 0;
    const unknownService = new LibraryQuarantineAvExecutionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      avJobInvoker: {
        validateConfig: () => ({
          ok: true,
          config: {
            projectId: 'promiseofplanet-bb325',
            region: 'europe-west1',
            jobName: 'pop-quarantine-av-worker',
          },
        }),
        invokeAvJobForRequest: async (): Promise<InvokeQuarantineAvJobResult> => {
          unknownInvokerCalls += 1;
          return {
            status: 'DISPATCH_UNKNOWN',
            failureReasonCode: 'JOB_LAUNCH_UNCERTAIN',
            errorMessage: 'Cloud Run Jobs API timed out.',
          };
        },
      },
      clock: () => '2026-11-11T09:12:00.000Z',
    });

    const dispUnknown = await unknownService.dispatchQuarantineAvInspection({
      receiptId: seededUnknown.receiptId,
      expectedRequestId: seededUnknown.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    assert.equal(dispUnknown.ok, false);
    assert.equal(dispUnknown.status, 'UNKNOWN');
    assert.equal(unknownInvokerCalls, 1);
    if (!dispUnknown.ok && dispUnknown.status === 'UNKNOWN') {
      assert.equal(dispUnknown.errorCode, 'JOB_LAUNCH_UNCERTAIN');
      assert.equal(dispUnknown.execution?.state, 'DISPATCH_UNKNOWN');
    }
  }

  // =========================================================================
  // TEST 5: Real Isolated ClamAV Worker — Clean PDF (Exit 0 => AV_NO_THREAT_DETECTED),
  //         Infected DOCX (Exit 1 => AV_THREAT_DETECTED), Generation-Pinned
  //         Streaming, SHA-256 Verification, Guaranteed Temp File Cleanup,
  //         and Zero Readiness/Posture Escalation
  // =========================================================================
  {
    const db = new InMemoryAvExecutionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);
    const pdfSeeded = seedFullEightDocChain(db, 6, { format: 'PDF' });
    const docxSeeded = seedFullEightDocChain(db, 7, { format: 'DOCX' });

    const service = new LibraryQuarantineAvExecutionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      avJobInvoker: {
        validateConfig: () => ({
          ok: true,
          config: {
            projectId: 'promiseofplanet-bb325',
            region: 'europe-west1',
            jobName: 'pop-quarantine-av-worker',
          },
        }),
        invokeAvJobForRequest: async () => ({
          status: 'LAUNCHED',
          executionName: 'exec-worker-test',
        }),
      },
      clock: () => '2026-11-11T09:20:00.000Z',
    });

    // Dispatch both PDF and DOCX requests
    await service.dispatchQuarantineAvInspection({
      receiptId: pdfSeeded.receiptId,
      expectedRequestId: pdfSeeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    await service.dispatchQuarantineAvInspection({
      receiptId: docxSeeded.receiptId,
      expectedRequestId: docxSeeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });

    // 5A: Worker executes clean PDF scan (exit 0 -> AV_NO_THREAT_DETECTED)
    const pdfBucket = createFakeGenerationPinnedBucket({
      expectedStoragePath: pdfSeeded.receipt.storagePath,
      expectedGeneration: pdfSeeded.generation!,
      payloadBytes: pdfSeeded.payloadBytes,
    });

    let createdPdfTempPath = '';
    const pdfWorkerResult = await executeLibraryQuarantineAvWorkerTask({
      requestId: pdfSeeded.requestId,
      workerRunId: 'worker_run_pdf_clean_01',
      db,
      bucket: pdfBucket,
      clock: () => '2026-11-11T09:25:00.000Z',
      tempRootDir: os.tmpdir(),
      onTempFileCreated: (tempPath) => {
        createdPdfTempPath = tempPath;
        assert.equal(tempPath.endsWith('input.pdf'), true);
        assert.equal(fs.existsSync(tempPath), true);
      },
      signatureVerifier: async () => ({
        ok: true,
        engineVersion: 'ClamAV 1.3.1/27455',
        signatureVersion: 'daily.cvd:27455',
        signatureUpdatedAt: '2026-11-11T06:00:00.000Z',
      }),
      clamAvRunner: async ({ tempFilePath }) => {
        const diskBytes = fs.readFileSync(tempFilePath);
        assert.deepEqual(diskBytes, pdfSeeded.payloadBytes);
        return {
          exitCode: 0,
          timedOut: false,
          spawnFailed: false,
        };
      },
    });

    assert.equal(pdfWorkerResult.ok, true, JSON.stringify(pdfWorkerResult));
    assert.equal(pdfWorkerResult.status, 'COMPLETED_CLEAN');
    assert.equal(pdfWorkerResult.execution?.state, 'AV_NO_THREAT_DETECTED');
    assert.equal(pdfWorkerResult.execution?.exitCode, 0);
    assert.equal(
      pdfWorkerResult.execution?.scannedBytes,
      pdfSeeded.payloadBytes.byteLength
    );
    assert.equal(pdfWorkerResult.execution?.isSanitized, false);
    assert.equal(pdfWorkerResult.execution?.isVerifiedSafe, false);
    assert.equal(pdfWorkerResult.execution?.isRightsApproved, false);
    assert.equal(pdfWorkerResult.execution?.isPublished, false);
    assert.equal(pdfWorkerResult.execution?.isReadyForPeia, false);

    // Verify generation-pinned bucket access & temp file cleanup
    assert.deepEqual(pdfBucket.requestedPaths, [pdfSeeded.receipt.storagePath]);
    assert.deepEqual(pdfBucket.requestedGenerations, [pdfSeeded.generation!]);
    assert.equal(createdPdfTempPath.length > 0, true);
    assert.equal(fs.existsSync(createdPdfTempPath), false);
    assert.equal(fs.existsSync(path.dirname(createdPdfTempPath)), false);

    // Verify persisted 33-field closed schema & sanitized 28-field DTO
    const persistedPdfExec = db.getRawDoc(
      LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
      pdfSeeded.requestId
    );
    const validatedPdfExec = validatePersistedLibraryQuarantineAvExecution(
      persistedPdfExec,
      pdfSeeded.requestId
    );
    assert.equal(validatedPdfExec.ok, true);
    if (validatedPdfExec.ok) {
      assert.equal(
        validatedPdfExec.value.schemaVersion,
        LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION
      );
      const sanitizedDto = toSanitizedLibraryQuarantineAvExecutionDto(
        validatedPdfExec.value
      );
      assert.equal(Object.keys(sanitizedDto).length, 28);
      assertZeroSecretLeakage(
        sanitizedDto,
        pdfSeeded.sha256,
        pdfSeeded.generation
      );
    }

    // 5B: Worker executes infected DOCX scan (exit 1 -> AV_THREAT_DETECTED)
    const docxBucket = createFakeGenerationPinnedBucket({
      expectedStoragePath: docxSeeded.receipt.storagePath,
      expectedGeneration: docxSeeded.generation!,
      payloadBytes: docxSeeded.payloadBytes,
    });

    let createdDocxTempPath = '';
    const docxWorkerResult = await executeLibraryQuarantineAvWorkerTask({
      requestId: docxSeeded.requestId,
      workerRunId: 'worker_run_docx_threat_01',
      db,
      bucket: docxBucket,
      clock: () => '2026-11-11T09:26:00.000Z',
      tempRootDir: os.tmpdir(),
      onTempFileCreated: (tempPath) => {
        createdDocxTempPath = tempPath;
        assert.equal(tempPath.endsWith('input.docx'), true);
      },
      signatureVerifier: async () => ({
        ok: true,
        engineVersion: 'ClamAV 1.3.1/27455',
        signatureVersion: 'daily.cvd:27455',
        signatureUpdatedAt: '2026-11-11T06:00:00.000Z',
      }),
      clamAvRunner: async () => ({
        exitCode: 1,
        timedOut: false,
        spawnFailed: false,
      }),
    });

    assert.equal(docxWorkerResult.ok, true);
    assert.equal(docxWorkerResult.status, 'COMPLETED_THREAT');
    assert.equal(docxWorkerResult.execution?.state, 'AV_THREAT_DETECTED');
    assert.equal(docxWorkerResult.execution?.exitCode, 1);
    assert.equal(docxWorkerResult.execution?.failureReasonCode, null);
    assert.equal(fs.existsSync(createdDocxTempPath), false);
  }

  // =========================================================================
  // TEST 6: Worker Fail-Closed Scenarios:
  //         - Stale / Missing ClamAV Signature DB (SIGNATURE_DB_STALE)
  //         - SHA-256 Mismatch During Stream (SOURCE_SHA256_MISMATCH)
  //         - ClamAV Exit >= 2 / Timeout (CLAMAV_EXECUTION_ERROR / CLAMAV_SCAN_TIMEOUT)
  //         - Forbidden Default Bucket Rejection
  //         - Post-Scan Source / Generation Drift -> STALE_HOLD
  // =========================================================================
  {
    const db = new InMemoryAvExecutionFirestoreDatabase();
    const adminRepo = new InMemoryAdminRepo([ownerAdmin]);

    const invokeStub: LibraryQuarantineAvJobInvoker = {
      validateConfig: () => ({
        ok: true,
        config: {
          projectId: 'promiseofplanet-bb325',
          region: 'europe-west1',
          jobName: 'pop-quarantine-av-worker',
        },
      }),
      invokeAvJobForRequest: async () => ({
        status: 'LAUNCHED',
        executionName: 'exec-fail-closed',
      }),
    };

    const service = new LibraryQuarantineAvExecutionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo,
      db,
      avJobInvoker: invokeStub,
      clock: () => '2026-11-11T09:30:00.000Z',
    });

    // 6A: Stale signature database -> AV_SCAN_FAILED (SIGNATURE_DB_STALE) with 0 GCS stream calls
    const staleSigSeeded = seedFullEightDocChain(db, 8, { format: 'PDF' });
    await service.dispatchQuarantineAvInspection({
      receiptId: staleSigSeeded.receiptId,
      expectedRequestId: staleSigSeeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    const staleSigBucket = createFakeGenerationPinnedBucket({
      expectedStoragePath: staleSigSeeded.receipt.storagePath,
      expectedGeneration: staleSigSeeded.generation!,
      payloadBytes: staleSigSeeded.payloadBytes,
    });
    const staleSigRes = await executeLibraryQuarantineAvWorkerTask({
      requestId: staleSigSeeded.requestId,
      workerRunId: 'worker_stale_sig_01',
      db,
      bucket: staleSigBucket,
      clock: () => '2026-11-11T09:31:00.000Z',
      signatureVerifier: async () => ({
        ok: false,
        failureReasonCode: 'SIGNATURE_DB_STALE',
        errorMessage: 'ClamAV signature DB exceeded TTL.',
      }),
    });
    assert.equal(staleSigRes.ok, false);
    assert.equal(staleSigRes.status, 'FAILED_CLOSED');
    assert.equal(staleSigRes.execution?.state, 'AV_SCAN_FAILED');
    assert.equal(
      staleSigRes.execution?.failureReasonCode,
      'SIGNATURE_DB_STALE'
    );
    assert.equal(staleSigBucket.streamCalls, 0);

    // 6B: SHA-256 mismatch on streamed bytes -> AV_SCAN_FAILED (SOURCE_SHA256_MISMATCH) & temp cleaned
    const badShaSeeded = seedFullEightDocChain(db, 9, { format: 'PDF' });
    await service.dispatchQuarantineAvInspection({
      receiptId: badShaSeeded.receiptId,
      expectedRequestId: badShaSeeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    const badShaBucket = createFakeGenerationPinnedBucket({
      expectedStoragePath: badShaSeeded.receipt.storagePath,
      expectedGeneration: badShaSeeded.generation!,
      payloadBytes: badShaSeeded.payloadBytes,
      streamModifier: (orig) => {
        const mutated = Buffer.from(orig);
        mutated[mutated.length - 1] ^= 0xff;
        return mutated;
      },
    });
    let badShaTempPath = '';
    let clamScanCalledOnBadSha = false;
    const badShaRes = await executeLibraryQuarantineAvWorkerTask({
      requestId: badShaSeeded.requestId,
      workerRunId: 'worker_bad_sha_01',
      db,
      bucket: badShaBucket,
      clock: () => '2026-11-11T09:32:00.000Z',
      onTempFileCreated: (p) => {
        badShaTempPath = p;
      },
      signatureVerifier: async () => ({
        ok: true,
        engineVersion: 'ClamAV 1.3.1/27455',
        signatureVersion: 'daily.cvd:27455',
        signatureUpdatedAt: '2026-11-11T06:00:00.000Z',
      }),
      clamAvRunner: async () => {
        clamScanCalledOnBadSha = true;
        return { exitCode: 0, timedOut: false, spawnFailed: false };
      },
    });
    assert.equal(badShaRes.ok, false);
    assert.equal(badShaRes.execution?.state, 'AV_SCAN_FAILED');
    assert.equal(
      badShaRes.execution?.failureReasonCode,
      'QUARANTINE_SHA256_MISMATCH'
    );
    assert.equal(clamScanCalledOnBadSha, false);
    assert.equal(fs.existsSync(badShaTempPath), false);

    // 6C: ClamAV exit code 2 -> AV_SCAN_FAILED (SCAN_EXECUTION_ERROR)
    const exit2Seeded = seedFullEightDocChain(db, 10, { format: 'PDF' });
    await service.dispatchQuarantineAvInspection({
      receiptId: exit2Seeded.receiptId,
      expectedRequestId: exit2Seeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    const exit2Bucket = createFakeGenerationPinnedBucket({
      expectedStoragePath: exit2Seeded.receipt.storagePath,
      expectedGeneration: exit2Seeded.generation!,
      payloadBytes: exit2Seeded.payloadBytes,
    });
    const exit2Res = await executeLibraryQuarantineAvWorkerTask({
      requestId: exit2Seeded.requestId,
      workerRunId: 'worker_exit2_01',
      db,
      bucket: exit2Bucket,
      clock: () => '2026-11-11T09:33:00.000Z',
      signatureVerifier: async () => ({
        ok: true,
        engineVersion: 'ClamAV 1.3.1/27455',
        signatureVersion: 'daily.cvd:27455',
        signatureUpdatedAt: '2026-11-11T06:00:00.000Z',
      }),
      clamAvRunner: async () => ({
        exitCode: 2,
        timedOut: false,
        spawnFailed: false,
      }),
    });
    assert.equal(exit2Res.ok, false);
    assert.equal(exit2Res.execution?.state, 'AV_SCAN_FAILED');
    assert.equal(exit2Res.execution?.exitCode, 2);
    assert.equal(
      exit2Res.execution?.failureReasonCode,
      'SCAN_EXECUTION_ERROR'
    );

    // 6D: Post-scan GCS generation or source chain drift -> STALE_HOLD
    const driftSeeded = seedFullEightDocChain(db, 11, { format: 'PDF' });
    await service.dispatchQuarantineAvInspection({
      receiptId: driftSeeded.receiptId,
      expectedRequestId: driftSeeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    const driftBucket = createFakeGenerationPinnedBucket({
      expectedStoragePath: driftSeeded.receipt.storagePath,
      expectedGeneration: driftSeeded.generation!,
      payloadBytes: driftSeeded.payloadBytes,
      onGetMetadata: (callIndex) => {
        if (callIndex === 2) {
          // Simulate GCS generation drift detected on post-scan re-verification
          return { generation: '9999999999999' };
        }
        return undefined;
      },
    });
    const driftRes = await executeLibraryQuarantineAvWorkerTask({
      requestId: driftSeeded.requestId,
      workerRunId: 'worker_drift_01',
      db,
      bucket: driftBucket,
      clock: () => '2026-11-11T09:34:00.000Z',
      signatureVerifier: async () => ({
        ok: true,
        engineVersion: 'ClamAV 1.3.1/27455',
        signatureVersion: 'daily.cvd:27455',
        signatureUpdatedAt: '2026-11-11T06:00:00.000Z',
      }),
      clamAvRunner: async () => ({
        exitCode: 0,
        timedOut: false,
        spawnFailed: false,
      }),
    });
    assert.equal(driftRes.ok, false);
    assert.equal(driftRes.execution?.state, 'STALE_HOLD');
    assert.equal(
      driftRes.execution?.failureReasonCode,
      'RECEIPT_GENERATION_DRIFT_DURING_SCAN'
    );

    // 6E: Forbidden default bucket name is rejected before any file read
    const wrongBucketSeeded = seedFullEightDocChain(db, 12, { format: 'PDF' });
    await service.dispatchQuarantineAvInspection({
      receiptId: wrongBucketSeeded.receiptId,
      expectedRequestId: wrongBucketSeeded.requestId,
      expectedSafetyCaseRevision: 1,
      acknowledgedHumanCaseRevision: 2,
      confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
    });
    const forbiddenBucket = createFakeGenerationPinnedBucket({
      bucketName: FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
      expectedStoragePath: wrongBucketSeeded.receipt.storagePath,
      expectedGeneration: wrongBucketSeeded.generation!,
      payloadBytes: wrongBucketSeeded.payloadBytes,
    });
    const wrongBucketRes = await executeLibraryQuarantineAvWorkerTask({
      requestId: wrongBucketSeeded.requestId,
      workerRunId: 'worker_wrong_bucket_01',
      db,
      bucket: forbiddenBucket,
      clock: () => '2026-11-11T09:35:00.000Z',
      signatureVerifier: async () => ({
        ok: true,
        engineVersion: 'ClamAV 1.3.1/27455',
        signatureVersion: 'daily.cvd:27455',
        signatureUpdatedAt: '2026-11-11T06:00:00.000Z',
      }),
    });
    assert.equal(wrongBucketRes.ok, false);
    assert.equal(wrongBucketRes.execution?.state, 'AV_SCAN_FAILED');
    assert.equal(
      wrongBucketRes.execution?.failureReasonCode,
      'QUARANTINE_BUCKET_MISMATCH'
    );
    assert.equal(forbiddenBucket.streamCalls, 0);

    // Verify that all injected tests (Tests 1-6) never invoked live Firebase Admin SDK functions
    assert.equal(firebaseAdminRuntimeMock.getAppsCalls, 0);
    assert.equal(firebaseAdminRuntimeMock.initializeAppCalls, 0);
    assert.equal(firebaseAdminRuntimeMock.getFirestoreCalls, 0);
    assert.equal(firebaseAdminRuntimeMock.getStorageCalls, 0);
  }

  // =========================================================================
  // TEST 7: Standalone CLI Bootstrap & Firebase Admin SDK Initialization
  //         Lifecycle (Cold Start, Existing Default App, and Fail-Closed Init)
  // =========================================================================
  {
    const cliFixtureDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pop-qav-cli-test-')
    );
    const prevRequestIdEnv = process.env[LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR];
    const prevClamDbDirEnv = process.env.POP_CLAMAV_DB_DIR;
    const prevClamScanPathEnv = process.env.POP_CLAMSCAN_PATH;
    const workerModulePath = require.resolve(
      '../functions/src/library/libraryQuarantineAvWorker'
    );

    try {
      const clamDbDir = path.join(cliFixtureDir, 'clamav-db');
      fs.mkdirSync(clamDbDir, { recursive: true });
      fs.writeFileSync(path.join(clamDbDir, 'main.cvd'), 'FAKE_MAIN_CVD_DATA');
      fs.writeFileSync(path.join(clamDbDir, 'daily.cvd'), 'FAKE_DAILY_CVD_DATA');

      const scanCountFile = path.join(cliFixtureDir, 'scan-count.txt');
      fs.writeFileSync(scanCountFile, '0', 'utf8');

      const fakeClamScanBin = path.join(cliFixtureDir, 'fake-clamscan.js');
      fs.writeFileSync(
        fakeClamScanBin,
        [
          '#!/usr/bin/env node',
          'const fs = require("fs");',
          'const args = process.argv.slice(2);',
          'if (args.includes("--version")) {',
          '  process.stdout.write("ClamAV 1.3.1/27455/Mon Nov 11 08:00:00 2026\\n");',
          '  process.exit(0);',
          '}',
          `const countPath = ${JSON.stringify(scanCountFile)};`,
          'const current = Number(fs.readFileSync(countPath, "utf8") || "0");',
          'fs.writeFileSync(countPath, String(current + 1), "utf8");',
          'const targetFile = args[args.length - 1];',
          'if (!targetFile || !fs.existsSync(targetFile)) {',
          '  process.exit(2);',
          '}',
          'process.exit(0);',
        ].join('\n'),
        { mode: 0o755 }
      );
      fs.chmodSync(fakeClamScanBin, 0o755);

      process.env.POP_CLAMAV_DB_DIR = clamDbDir;
      process.env.POP_CLAMSCAN_PATH = fakeClamScanBin;

      const createCliDispatchService = (
        targetDb: InMemoryAvExecutionFirestoreDatabase,
        adminRepo: InMemoryAdminRepo
      ) =>
        new LibraryQuarantineAvExecutionService({
          trustedPrincipalProvider: {
            resolveAuthenticatedPrincipal: () => ({
              uid: ownerAdmin.id,
              token: {},
            }),
          },
          adminRepository: adminRepo,
          db: targetDb,
          avJobInvoker: {
            validateConfig: () => ({
              ok: true,
              config: {
                projectId: 'promiseofplanet-bb325',
                region: 'europe-west1',
                jobName: 'pop-quarantine-av-worker',
              },
            }),
            invokeAvJobForRequest: async (): Promise<InvokeQuarantineAvJobResult> => ({
              status: 'LAUNCHED',
              executionName: 'exec-cli-run',
            }),
          },
          clock: () => '2026-11-11T09:40:00.000Z',
        });

      // 7A: Cold-start standalone CLI execution (`require.main === module`)
      //     initializes Firebase Admin once BEFORE first getFirestore() and getStorage()
      const coldDb = new InMemoryAvExecutionFirestoreDatabase();
      const coldAdminRepo = new InMemoryAdminRepo([ownerAdmin]);
      const coldSeeded = seedFullEightDocChain(coldDb, 701, { format: 'PDF' });
      const coldService = createCliDispatchService(coldDb, coldAdminRepo);

      const coldDisp = await coldService.dispatchQuarantineAvInspection({
        receiptId: coldSeeded.receiptId,
        expectedRequestId: coldSeeded.requestId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
      });
      assert.equal(coldDisp.ok, true);

      const coldBucket = createFakeGenerationPinnedBucket({
        expectedStoragePath: coldSeeded.receipt.storagePath,
        expectedGeneration: coldSeeded.generation!,
        payloadBytes: coldSeeded.payloadBytes,
      });

      firebaseAdminRuntimeMock.enabled = true;
      firebaseAdminRuntimeMock.apps = [];
      firebaseAdminRuntimeMock.throwOnGetApps = null;
      firebaseAdminRuntimeMock.throwOnInitializeApp = null;
      firebaseAdminRuntimeMock.firestoreProvider = () => coldDb;
      firebaseAdminRuntimeMock.storageBucketProvider = (bucketName: string) => {
        assert.equal(bucketName, LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME);
        return coldBucket;
      };
      firebaseAdminRuntimeMock.callOrder = [];
      firebaseAdminRuntimeMock.getAppsCalls = 0;
      firebaseAdminRuntimeMock.initializeAppCalls = 0;
      firebaseAdminRuntimeMock.getFirestoreCalls = 0;
      firebaseAdminRuntimeMock.getStorageCalls = 0;
      firebaseAdminRuntimeMock.requestedBucketNames = [];
      firebaseAdminRuntimeMock.interceptedModuleSpecifiers = [];

      // Verify deterministic mock selection for all 4 firebase-admin/* modules
      // BEFORE attempting originalModuleLoad, regardless of whether firebase-admin is installed
      assert.equal(
        moduleWithLoad._load('firebase-admin/app', null, false),
        firebaseAdminAppMockModule
      );
      assert.equal(
        moduleWithLoad._load('firebase-admin/auth', null, false),
        firebaseAdminAuthMockModule
      );
      assert.equal(
        moduleWithLoad._load('firebase-admin/firestore', null, false),
        firebaseAdminFirestoreMockModule
      );
      assert.equal(
        moduleWithLoad._load('firebase-admin/storage', null, false),
        firebaseAdminStorageMockModule
      );
      firebaseAdminRuntimeMock.interceptedModuleSpecifiers = [];

      process.env[LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR] =
        coldSeeded.requestId;

      // Execute actual `if (require.main === module)` entrypoint by loading module with isMain=true
      const coldExitCode = await new Promise<number>((resolve, reject) => {
        const originalExit = process.exit;
        const timeout = setTimeout(() => {
          process.exit = originalExit;
          reject(new Error('Standalone CLI entrypoint timed out'));
        }, 10_000);

        process.exit = ((code?: number) => {
          clearTimeout(timeout);
          process.exit = originalExit;
          resolve(typeof code === 'number' ? code : 0);
        }) as typeof process.exit;

        delete require.cache[workerModulePath];
        moduleWithLoad._load(workerModulePath, null, true);
      });

      assert.equal(coldExitCode, 0);
      assert.deepEqual(firebaseAdminRuntimeMock.interceptedModuleSpecifiers, [
        'firebase-admin/app',
        'firebase-admin/firestore',
        'firebase-admin/storage',
      ]);
      assert.equal(firebaseAdminRuntimeMock.initializeAppCalls, 1);
      assert.equal(firebaseAdminRuntimeMock.getFirestoreCalls, 1);
      assert.equal(firebaseAdminRuntimeMock.getStorageCalls, 1);
      assert.deepEqual(firebaseAdminRuntimeMock.requestedBucketNames, [
        LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
      ]);

      const initIdx = firebaseAdminRuntimeMock.callOrder.indexOf('initializeApp');
      const firstFirestoreIdx =
        firebaseAdminRuntimeMock.callOrder.indexOf('getFirestore');
      const firstStorageIdx =
        firebaseAdminRuntimeMock.callOrder.indexOf('getStorage');
      assert.equal(firebaseAdminRuntimeMock.callOrder[0], 'getApps');
      assert.equal(initIdx, 1);
      assert.equal(initIdx < firstFirestoreIdx, true);
      assert.equal(initIdx < firstStorageIdx, true);
      assert.equal(firstFirestoreIdx < firstStorageIdx, true);
      assert.equal(fs.readFileSync(scanCountFile, 'utf8'), '1');

      const coldSavedExec = coldDb.getRawDoc(
        LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
        coldSeeded.requestId
      );
      assert.equal(coldSavedExec?.state, 'AV_NO_THREAT_DETECTED');
      assert.equal(coldSavedExec?.exitCode, 0);
      assert.equal(coldSavedExec?.isSanitized, false);
      assert.equal(coldSavedExec?.isVerifiedSafe, false);
      assert.equal(coldSavedExec?.isRightsApproved, false);
      assert.equal(coldSavedExec?.isPublished, false);
      assert.equal(coldSavedExec?.isReadyForPeia, false);

      // 7B: Pre-existing default Firebase app -> zero duplicate initializeApp() calls
      const warmDb = new InMemoryAvExecutionFirestoreDatabase();
      const warmSeeded = seedFullEightDocChain(warmDb, 702, { format: 'PDF' });
      const warmService = createCliDispatchService(warmDb, coldAdminRepo);

      const warmDisp = await warmService.dispatchQuarantineAvInspection({
        receiptId: warmSeeded.receiptId,
        expectedRequestId: warmSeeded.requestId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
      });
      assert.equal(warmDisp.ok, true);

      const warmBucket = createFakeGenerationPinnedBucket({
        expectedStoragePath: warmSeeded.receipt.storagePath,
        expectedGeneration: warmSeeded.generation!,
        payloadBytes: warmSeeded.payloadBytes,
      });

      firebaseAdminRuntimeMock.apps = [Object.freeze({ name: '[DEFAULT]' })];
      firebaseAdminRuntimeMock.firestoreProvider = () => warmDb;
      firebaseAdminRuntimeMock.storageBucketProvider = () => warmBucket;
      firebaseAdminRuntimeMock.callOrder = [];
      firebaseAdminRuntimeMock.getAppsCalls = 0;
      firebaseAdminRuntimeMock.initializeAppCalls = 0;
      firebaseAdminRuntimeMock.getFirestoreCalls = 0;
      firebaseAdminRuntimeMock.getStorageCalls = 0;
      firebaseAdminRuntimeMock.requestedBucketNames = [];

      process.env[LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR] =
        warmSeeded.requestId;

      let recordedWarmExitCode: number | null = null;
      const warmReturnCode = await runLibraryQuarantineAvWorkerCli({
        exit: (code: number) => {
          recordedWarmExitCode = code;
        },
      });

      assert.equal(warmReturnCode, 0);
      assert.equal(recordedWarmExitCode, 0);
      assert.equal(firebaseAdminRuntimeMock.getAppsCalls >= 1, true);
      assert.equal(firebaseAdminRuntimeMock.initializeAppCalls, 0);
      assert.equal(firebaseAdminRuntimeMock.getFirestoreCalls, 1);
      assert.equal(firebaseAdminRuntimeMock.getStorageCalls, 1);
      assert.equal(fs.readFileSync(scanCountFile, 'utf8'), '2');

      const warmSavedExec = warmDb.getRawDoc(
        LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
        warmSeeded.requestId
      );
      assert.equal(warmSavedExec?.state, 'AV_NO_THREAT_DETECTED');

      // 7C: Initialization failure -> fail-closed exit (1), zero scan execution,
      //     zero Firestore/Storage calls or writes, and zero secret/metadata leakage
      const failInitDb = new InMemoryAvExecutionFirestoreDatabase();
      const failInitSeeded = seedFullEightDocChain(failInitDb, 703, {
        format: 'PDF',
      });
      const failInitService = createCliDispatchService(
        failInitDb,
        coldAdminRepo
      );

      const failDisp = await failInitService.dispatchQuarantineAvInspection({
        receiptId: failInitSeeded.receiptId,
        expectedRequestId: failInitSeeded.requestId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
      });
      assert.equal(failDisp.ok, true);

      const failInitBucket = createFakeGenerationPinnedBucket({
        expectedStoragePath: failInitSeeded.receipt.storagePath,
        expectedGeneration: failInitSeeded.generation!,
        payloadBytes: failInitSeeded.payloadBytes,
      });

      const txCountBeforeFailInit = failInitDb.transactionCount;
      const txUpdateBeforeFailInit = failInitDb.txUpdateCalls;
      const txSetBeforeFailInit = failInitDb.txSetCalls;
      const txCreateBeforeFailInit = failInitDb.txCreateCalls;

      const secretInitMessage =
        'ADC_SECRET_CREDENTIALS_FAILURE:/var/run/secrets/private_sa_key.json';
      firebaseAdminRuntimeMock.apps = [];
      firebaseAdminRuntimeMock.throwOnInitializeApp = new Error(
        secretInitMessage
      );
      firebaseAdminRuntimeMock.firestoreProvider = () => failInitDb;
      firebaseAdminRuntimeMock.storageBucketProvider = () => failInitBucket;
      firebaseAdminRuntimeMock.callOrder = [];
      firebaseAdminRuntimeMock.getAppsCalls = 0;
      firebaseAdminRuntimeMock.initializeAppCalls = 0;
      firebaseAdminRuntimeMock.getFirestoreCalls = 0;
      firebaseAdminRuntimeMock.getStorageCalls = 0;

      process.env[LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR] =
        failInitSeeded.requestId;

      let recordedFailExitCode: number | null = null;
      const failReturnCode = await runLibraryQuarantineAvWorkerCli({
        exit: (code: number) => {
          recordedFailExitCode = code;
        },
      });

      assert.equal(failReturnCode, 1);
      assert.equal(recordedFailExitCode, 1);
      assert.equal(firebaseAdminRuntimeMock.getAppsCalls, 1);
      assert.equal(firebaseAdminRuntimeMock.initializeAppCalls, 1);
      assert.equal(firebaseAdminRuntimeMock.getFirestoreCalls, 0);
      assert.equal(firebaseAdminRuntimeMock.getStorageCalls, 0);
      assert.equal(failInitBucket.metadataCalls, 0);
      assert.equal(failInitBucket.streamCalls, 0);
      assert.equal(fs.readFileSync(scanCountFile, 'utf8'), '2');
      assert.equal(failInitDb.transactionCount, txCountBeforeFailInit);
      assert.equal(failInitDb.txUpdateCalls, txUpdateBeforeFailInit);
      assert.equal(failInitDb.txSetCalls, txSetBeforeFailInit);
      assert.equal(failInitDb.txCreateCalls, txCreateBeforeFailInit);

      const directTaskInitFail = await executeLibraryQuarantineAvWorkerTask({
        requestId: failInitSeeded.requestId,
      });
      assert.equal(directTaskInitFail.ok, false);
      assert.equal(directTaskInitFail.status, 'HOLD');
      assert.equal(directTaskInitFail.execution, null);
      assert.equal(
        JSON.stringify(directTaskInitFail).includes(secretInitMessage),
        false
      );
      assert.equal(
        JSON.stringify(directTaskInitFail).includes(failInitSeeded.sha256),
        false
      );
      assert.equal(firebaseAdminRuntimeMock.getFirestoreCalls, 0);
      assert.equal(firebaseAdminRuntimeMock.getStorageCalls, 0);

      const failInitExecAfter = failInitDb.getRawDoc(
        LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
        failInitSeeded.requestId
      );
      assert.equal(failInitExecAfter?.state, 'DISPATCHED_WAITING_WORKER');
    } finally {
      firebaseAdminRuntimeMock.enabled = false;
      firebaseAdminRuntimeMock.apps = [];
      firebaseAdminRuntimeMock.throwOnGetApps = null;
      firebaseAdminRuntimeMock.throwOnInitializeApp = null;
      firebaseAdminRuntimeMock.firestoreProvider = null;
      firebaseAdminRuntimeMock.storageBucketProvider = null;

      if (prevRequestIdEnv === undefined) {
        delete process.env[LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR];
      } else {
        process.env[LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR] = prevRequestIdEnv;
      }
      if (prevClamDbDirEnv === undefined) {
        delete process.env.POP_CLAMAV_DB_DIR;
      } else {
        process.env.POP_CLAMAV_DB_DIR = prevClamDbDirEnv;
      }
      if (prevClamScanPathEnv === undefined) {
        delete process.env.POP_CLAMSCAN_PATH;
      } else {
        process.env.POP_CLAMSCAN_PATH = prevClamScanPathEnv;
      }
      fs.rmSync(cliFixtureDir, { recursive: true, force: true });
    }
  }

  // =========================================================================
  // TEST 8: CI-TYPE-CLOSURE Regressions (Items A-H):
  //   - Inherited error-message maps (JUSTIFICATION_NOTES_REQUIRED,
  //     INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE, TIMESTAMP_BEFORE_SAFETY_CASE_HOLD)
  //   - MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES (15,000,000) ceiling enforcement
  //   - Generation-null HOLD / valid pinned generation
  //   - AV transaction set() guard when tx.set is missing
  //   - Owner identity id !== uid fail-closed across all 3 services
  //   - Unexpected isolated-inspection store result branch fail-closed
  //   - Catalog alignment missing point-get guard
  // =========================================================================
  {
    // 8A: Inherited safe error messages across BinarySafety, IsolatedInspection, and AvExecution
    assert.equal(
      typeof BINARY_SAFETY_STORE_SAFE_MESSAGES.JUSTIFICATION_NOTES_REQUIRED,
      'string'
    );
    assert.equal(
      BINARY_SAFETY_STORE_SAFE_MESSAGES.JUSTIFICATION_NOTES_REQUIRED.length > 0,
      true
    );
    assert.equal(
      ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.JUSTIFICATION_NOTES_REQUIRED,
      BINARY_SAFETY_STORE_SAFE_MESSAGES.JUSTIFICATION_NOTES_REQUIRED
    );
    assert.equal(
      AV_EXECUTION_SAFE_MESSAGES.JUSTIFICATION_NOTES_REQUIRED,
      BINARY_SAFETY_STORE_SAFE_MESSAGES.JUSTIFICATION_NOTES_REQUIRED
    );
    assert.equal(
      typeof AV_EXECUTION_SAFE_MESSAGES.INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE,
      'string'
    );
    assert.equal(
      typeof AV_EXECUTION_SAFE_MESSAGES.TIMESTAMP_BEFORE_SAFETY_CASE_HOLD,
      'string'
    );
    assert.equal(
      'BINARY_SAFETY_CASE_NOT_RECORDED_HOLD' in AV_EXECUTION_SAFE_MESSAGES,
      false
    );

    // 8B: MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES (15,000,000) byte ceiling enforcement
    assert.equal(MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES, 15_000_000);
    const db8B = new InMemoryAvExecutionFirestoreDatabase();
    const seeded8B = seedFullEightDocChain(db8B, 801);
    const validReqRaw = db8B.getRawDoc(
      LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
      seeded8B.requestId
    )!;
    const atCeilingRes = validatePersistedLibraryQuarantineIsolatedInspectionRequest(
      {
        ...validReqRaw,
        sourceByteSize: MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
      },
      seeded8B.requestId
    );
    assert.equal(atCeilingRes.ok, true);
    const overCeilingRes = validatePersistedLibraryQuarantineIsolatedInspectionRequest(
      {
        ...validReqRaw,
        sourceByteSize: MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES + 1,
      },
      seeded8B.requestId
    );
    assert.equal(overCeilingRes.ok, false);

    // 8C: Generation-null / non-canonical generation HOLD in AV GET status and dispatch
    const db8C = new InMemoryAvExecutionFirestoreDatabase();
    const adminRepo8C = new InMemoryAdminRepo([ownerAdmin]);
    const seeded8CNull = seedFullEightDocChain(db8C, 802, {
      receiptGeneration: null,
    });
    const seeded8CNonCanonical = seedFullEightDocChain(db8C, 804, {
      receiptGeneration: '00123',
    });
    const avService8C = new LibraryQuarantineAvExecutionService({
      trustedPrincipalProvider: {
        resolveAuthenticatedPrincipal: () => ({
          uid: ownerAdmin.id,
          token: {},
        }),
      },
      adminRepository: adminRepo8C,
      db: db8C,
      avJobInvoker: {
        validateConfig: () => ({
          ok: true,
          config: {
            projectId: 'promiseofplanet-bb325',
            region: 'europe-west1',
            jobName: 'pop-quarantine-av-worker',
          },
        }),
        invokeAvJobForRequest: async () => {
          throw new Error('Invoker must not be called when source generation is invalid');
        },
      },
      clock: () => '2026-11-11T09:30:00.000Z',
    });
    const nullGenStatus = await avService8C.getQuarantineAvInspectionStatus({
      receiptId: seeded8CNull.receiptId,
    });
    assert.equal(nullGenStatus.ok, false);
    if (!nullGenStatus.ok) {
      assert.equal(nullGenStatus.errorCode, 'CORRUPTED_SOURCE_RECEIPT');
    }

    const nonCanonGenStatus = await avService8C.getQuarantineAvInspectionStatus(
      {
        receiptId: seeded8CNonCanonical.receiptId,
      }
    );
    assert.equal(nonCanonGenStatus.ok, false);
    if (!nonCanonGenStatus.ok) {
      assert.equal(
        nonCanonGenStatus.errorCode,
        'MISSING_OR_INVALID_SOURCE_GENERATION_HOLD'
      );
    }
    const nonCanonGenDispatch =
      await avService8C.dispatchQuarantineAvInspection({
        receiptId: seeded8CNonCanonical.receiptId,
        expectedRequestId: seeded8CNonCanonical.requestId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
      });
    assert.equal(nonCanonGenDispatch.ok, false);
    if (!nonCanonGenDispatch.ok && nonCanonGenDispatch.status === 'HOLD') {
      assert.equal(
        nonCanonGenDispatch.errorCode,
        'MISSING_OR_INVALID_SOURCE_GENERATION_HOLD'
      );
    }

    // 8D: AV transaction set() guard fails closed when transaction object omits set()
    const db8D = new InMemoryAvExecutionFirestoreDatabase();
    const seeded8D = seedFullEightDocChain(db8D, 803);
    const avStoreOnDb8D = new FirestoreLibraryQuarantineAvExecutionStore(db8D);
    const pendingRes8D =
      await avStoreOnDb8D.createDispatchPendingTransactional({
        receiptId: seeded8D.receiptId,
        expectedRequestId: seeded8D.requestId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
        actorUid: ownerAdmin.id,
        nowIso: '2026-11-11T09:10:00.000Z',
      });
    assert.equal(pendingRes8D.status, 'CREATED_PENDING');

    const dbWithoutTxSet: LibraryQuarantineReviewDraftFirestoreDatabase = {
      collection: (name: string) => db8D.collection(name),
      runTransaction: async <T>(
        updateFn: (
          tx: LibraryQuarantineReviewDraftFirestoreTransaction
        ) => Promise<T>
      ): Promise<T> => {
        return db8D.runTransaction(async (innerTx) => {
          const narrowTx: LibraryQuarantineReviewDraftFirestoreTransaction = {
            get: (ref) => innerTx.get(ref),
            create: (ref, data) => innerTx.create(ref, data),
            update: (ref, data) => innerTx.update(ref, data),
          };
          return updateFn(narrowTx);
        });
      },
    };
    const storeWithoutSet = new FirestoreLibraryQuarantineAvExecutionStore(
      dbWithoutTxSet
    );
    const transitionNoSetRes =
      await storeWithoutSet.finalizeDispatchAfterInvokeTransactional({
        requestId: seeded8D.requestId,
        targetState: 'DISPATCHED_WAITING_WORKER',
        executionName: 'exec-no-set',
        failureReasonCode: null,
        nowIso: '2026-11-11T09:11:00.000Z',
      });
    assert.equal(transitionNoSetRes.ok, false);
    if (!transitionNoSetRes.ok) {
      assert.equal(transitionNoSetRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
    }
    const rawExec8D = db8D.getRawDoc(
      LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
      seeded8D.requestId
    );
    assert.equal(rawExec8D?.state, 'DISPATCH_PENDING');
    assert.equal(rawExec8D?.revision, 1);

    // 8E: Owner identity id !== uid or conflicting optional uid fails closed across all 3 services
    const mismatchedIdAdmin = Object.freeze({
      ...ownerAdmin,
      id: 'different_admin_id',
      uid: ownerAdmin.id,
    }) as unknown as AdminUser;
    const conflictingUidAdmin = Object.freeze({
      ...ownerAdmin,
      id: ownerAdmin.id,
      uid: 'conflicting_optional_uid',
    }) as unknown as AdminUser;

    for (const badAdminRecord of [mismatchedIdAdmin, conflictingUidAdmin]) {
      const singleBadAdminRepo: AdminRepository = {
        getAdminByUid: async () => badAdminRecord,
        getAllAdmins: async () => [badAdminRecord],
        saveAdmin: async () => undefined,
        updateAdminStatus: async () => undefined,
      };

      const binarySafetySvc = new LibraryQuarantineBinarySafetyCaseService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => ({
            uid: ownerAdmin.id,
            token: {},
          }),
        },
        adminRepository: singleBadAdminRepo,
        db: db8B,
      });
      const bsRes = await binarySafetySvc.getQuarantineBinarySafetyCase({
        receiptId: seeded8B.receiptId,
      });
      assert.equal(bsRes.ok, false);
      if (!bsRes.ok) {
        assert.equal(bsRes.errorCode, 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD');
      }

      const isoReqSvc = new LibraryQuarantineIsolatedInspectionRequestService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => ({
            uid: ownerAdmin.id,
            token: {},
          }),
        },
        adminRepository: singleBadAdminRepo,
        db: db8B,
      });
      const isoRes = await isoReqSvc.getQuarantineIsolatedInspectionRequest({
        receiptId: seeded8B.receiptId,
      });
      assert.equal(isoRes.ok, false);
      if (!isoRes.ok) {
        assert.equal(
          isoRes.errorCode,
          'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD'
        );
      }

      const avExecSvc = new LibraryQuarantineAvExecutionService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => ({
            uid: ownerAdmin.id,
            token: {},
          }),
        },
        adminRepository: singleBadAdminRepo,
        db: db8B,
      });
      const avRes = await avExecSvc.getQuarantineAvInspectionStatus({
        receiptId: seeded8B.receiptId,
      });
      assert.equal(avRes.ok, false);
      if (!avRes.ok) {
        assert.equal(avRes.errorCode, 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD');
      }
    }

    // 8F: Unexpected isolated-inspection store result branch fails closed with HOLD
    const unexpectedStoreSvc =
      new LibraryQuarantineIsolatedInspectionRequestService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => ({
            uid: ownerAdmin.id,
            token: {},
          }),
        },
        adminRepository: new InMemoryAdminRepo([ownerAdmin]),
        inspectionRequestStore: {
          getIsolatedInspectionRequestSnapshot: async () => ({
            ok: false as const,
            errorCode: 'STORE_READ_FAILED' as const,
            errorMessage: 'Not used in this test.',
          }),
          recordIsolatedInspectionRequestTransactional: async () =>
            ({
              status: 'UNEXPECTED_FUTURE_STATUS',
            }) as unknown as Awaited<
              ReturnType<
                import('../functions/src/library/firestoreLibraryQuarantineIsolatedInspectionRequestStore').FirestoreLibraryQuarantineIsolatedInspectionRequestStore['recordIsolatedInspectionRequestTransactional']
              >
            >,
        } as unknown as import('../functions/src/library/firestoreLibraryQuarantineIsolatedInspectionRequestStore').FirestoreLibraryQuarantineIsolatedInspectionRequestStore,
        clock: () => '2026-11-11T09:40:00.000Z',
      });
    const unexpectedBranchRes =
      await unexpectedStoreSvc.recordQuarantineIsolatedInspectionRequest({
        receiptId: seeded8B.receiptId,
        expectedSafetyCaseRevision: 1,
        acknowledgedHumanCaseRevision: 2,
        confirmation:
          LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
      });
    assert.equal(unexpectedBranchRes.ok, false);
    if (!unexpectedBranchRes.ok) {
      assert.equal(unexpectedBranchRes.status, 'HOLD');
      assert.equal(
        unexpectedBranchRes.errorCode,
        'TRANSACTION_ABORTED_NO_WRITE'
      );
    }

    // 8G: Catalog alignment missing point-get guard fails closed with ALIGNMENT_PERSISTENCE_FAILED
    const dbMissingPointGet: LibraryQuarantineReviewDraftFirestoreDatabase = {
      collection: (_collectionName: string) => ({
        doc: (id: string) => ({ id }),
      }),
      runTransaction: async <T>(
        _updateFn: (
          tx: LibraryQuarantineReviewDraftFirestoreTransaction
        ) => Promise<T>
      ): Promise<T> => {
        throw new Error('runTransaction must not be called in GET status.');
      },
    };
    const alignmentServiceMissingGet =
      new LibraryQuarantineCatalogCaseAlignmentService({
        trustedPrincipalProvider: {
          resolveAuthenticatedPrincipal: () => ({
            uid: ownerAdmin.id,
            token: {},
          }),
        },
        adminRepository: new InMemoryAdminRepo([ownerAdmin]),
        db: dbMissingPointGet,
      });
    const alignMissingGetRes =
      await alignmentServiceMissingGet.getQuarantineCatalogCaseAlignment({
        receiptId: seeded8B.receiptId,
      });
    assert.equal(alignMissingGetRes.ok, false);
    assert.equal(alignMissingGetRes.status, 'HOLD');
    if (!alignMissingGetRes.ok) {
      assert.equal(alignMissingGetRes.errorCode, 'ALIGNMENT_PERSISTENCE_FAILED');
    }
  }

  // =========================================================================
  // TEST 9: Verify all 20 READ_ONLY files match their pinned Git blob SHA-1s
  // =========================================================================
  {
    for (const [relPath, expectedBlobSha1] of READ_ONLY_MANIFEST_EXPECTED_BLOBS) {
      const absPath = path.resolve(process.cwd(), relPath);
      const rawBytes = fs.readFileSync(absPath);
      const header = Buffer.from(`blob ${rawBytes.byteLength}\0`, 'utf8');
      const actualBlobSha1 = createHash('sha1')
        .update(Buffer.concat([header, rawBytes]))
        .digest('hex');
      assert.equal(
        actualBlobSha1,
        expectedBlobSha1,
        `READ_ONLY file ${relPath} drifted from expected SHA-1 ${expectedBlobSha1}`
      );
    }
  }

  console.log(
    'ALL LIB-FILE-ISOLATED-AV-EXECUTION-M1 BACKEND TESTS PASSED (9/9).'
  );
}

runTests().catch((err) => {
  console.error('Isolated AV execution backend tests failed:', err);
  process.exit(1);
});
