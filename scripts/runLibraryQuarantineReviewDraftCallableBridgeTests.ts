import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import process from 'node:process';
import { deflateRawSync } from 'node:zlib';

// Intercept Firebase Functions / Admin SDK imports in headless Studio test runner
// so that any uninjected live SDK call fails closed immediately.
const recordedOnCallDefinitions: Array<{
  readonly options: Record<string, unknown>;
  readonly handler: (request: unknown) => Promise<unknown>;
}> = [];

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
        onRequest: (
          options: Record<string, unknown>,
          handler: (req: unknown, res: unknown) => Promise<void>
        ) => Object.assign(handler, { __endpointOptions: options }),
        onCall: (
          options: Record<string, unknown>,
          handler: (request: unknown) => Promise<unknown>
        ) => {
          recordedOnCallDefinitions.push({ options, handler });
          return Object.assign(handler, { __endpointOptions: options });
        },
        HttpsError: class HttpsError extends Error {
          readonly code: string;
          constructor(code: string, message: string) {
            super(message);
            this.code = code;
          }
        },
      };
    }
    if (request === 'firebase-admin/auth') {
      return {
        getAuth: () => {
          throw new Error(
            'Uninjected live getAuth() must never be called during headless tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error(
            'Uninjected live getFirestore() must never be called during headless tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/storage') {
      return {
        getStorage: () => {
          throw new Error(
            'Uninjected live getStorage() must never be called during headless tests.'
          );
        },
      };
    }
    throw err;
  }
};

import type {
  AdminRepository,
  VersionedAdminRepositoryRecord,
} from '../functions/src/admin/adminRepository';
import { AdminRole, type AdminUser } from '../functions/src/types/admin';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
} from '../functions/src/library/libraryUploadBinaryAdmission';
import { computeCrc32 } from '../functions/src/library/libraryUploadDeepStructure';
import {
  LibraryQuarantineReceiptState,
  beginLibraryQuarantineWritePending,
  confirmLibraryQuarantineWriteWithAttestation,
  markLibraryQuarantineWriteNeedsReconciliation,
  rejectLibraryQuarantineReceipt,
  reserveLibraryQuarantineReceipt,
  type LibraryQuarantineInternalReceipt,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  FirestoreLibraryQuarantineReceiptStore,
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
  type LibraryQuarantineFirestoreDatabase,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantineFirestoreTransaction,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';
import {
  GcsLibraryQuarantineStorageAdapter,
  LIBRARY_QUARANTINE_CACHE_CONTROL,
  LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
  LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
  type GcsLibraryQuarantineBucket,
  type GcsLibraryQuarantineFile,
  type GcsLibraryQuarantineFileOptions,
  type GcsLibraryQuarantineObjectMetadata,
  type GcsLibraryQuarantineReadableStream,
  type GcsLibraryQuarantineSaveOptions,
} from '../functions/src/library/gcsLibraryQuarantineStorageAdapter';
import {
  FirestoreLibraryQuarantineReviewDraftStore,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftFirestoreTransaction,
} from '../functions/src/library/firestoreLibraryQuarantineReviewDraftStore';

const require = createRequire(
  `${process.cwd()}/scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts`
);
const {
  DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS,
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_CORS_ORIGINS,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_OPTIONS,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_SERVICE_ACCOUNT,
  createProductionLibraryQuarantineReviewDraftBridgeRuntime,
  createRequestScopedCallablePrincipalProvider,
  executeLibraryQuarantineReviewDraftCallableBridge,
  libraryQuarantineReviewDraftLinkCallable,
} = require(
  '../functions/src/library/libraryQuarantineReviewDraftCallableBridge'
) as typeof import('../functions/src/library/libraryQuarantineReviewDraftCallableBridge');

const CANONICAL_CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const CANONICAL_ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const CANONICAL_WORD_DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body><w:p><w:r><w:t>جسر الاستدعاء الخادمي الموثوق لمسودة مراجعة الحجر 2026</w:t></w:r></w:p></w:body>' +
  '</w:document>';

function makeValidDocxBuffer(customText?: string): Buffer {
  const docXml = customText
    ? CANONICAL_WORD_DOCUMENT_XML.replace(
        'جسر الاستدعاء الخادمي الموثوق لمسودة مراجعة الحجر 2026',
        customText
      )
    : CANONICAL_WORD_DOCUMENT_XML;

  const entries = [
    { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
    { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
    { name: 'word/document.xml', content: docXml },
  ];

  const localChunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(raw);
    const crc = computeCrc32(raw);
    const nameBuf = Buffer.from(entry.name, 'utf8');

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);

    const localRecord = Buffer.concat([lfh, nameBuf, compressed]);
    localChunks.push(localRecord);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(compressed.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);

    cdChunks.push(Buffer.concat([cdh, nameBuf]));
    offset += localRecord.length;
  }

  const cdBuffer = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, cdBuffer, eocd]);
}

function makeValidPdfBuffer(label = 'Quarantine Callable Bridge Spec 01C'): Buffer {
  const pdfContent = [
    '%PDF-1.7',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    'endobj',
    '4 0 obj',
    `<< /Length ${label.length + 24} >>`,
    'stream',
    `BT /F1 12 Tf 72 720 Td (${label}) Tj ET`,
    'endstream',
    'endobj',
    'xref',
    '0 5',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000202 00000 n ',
    'trailer',
    '<< /Size 5 /Root 1 0 R >>',
    'startxref',
    '310',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdfContent, 'utf8');
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class InMemoryAdminRepositoryDouble implements AdminRepository {
  private readonly users = new Map<string, VersionedAdminRepositoryRecord>();
  public getAdminCalls = 0;
  public lookupHistory: string[] = [];
  public customLookupError: Error | null = null;
  public delayMsByUid = new Map<string, number>();

  constructor(initialUsers: readonly VersionedAdminRepositoryRecord[] = []) {
    for (const user of initialUsers) {
      this.users.set(user.id, Object.freeze({ ...user }));
    }
  }

  public async getAdminByUid(
    uid: string
  ): Promise<VersionedAdminRepositoryRecord | null> {
    this.getAdminCalls += 1;
    this.lookupHistory.push(uid);
    const delayMs = this.delayMsByUid.get(uid) ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (this.customLookupError) {
      throw this.customLookupError;
    }
    const found = this.users.get(uid);
    return found ? Object.freeze({ ...found }) : null;
  }

  public async saveAdmin(_admin: AdminUser): Promise<AdminUser> {
    throw new Error('saveAdmin is forbidden in 01C tests.');
  }
}

interface StoredGcsObjectEntry {
  bytes: Buffer;
  metadata: GcsLibraryQuarantineObjectMetadata;
  generation: string;
}

class InMemoryGenerationPinnedGcsBucket implements GcsLibraryQuarantineBucket {
  public readonly name: string;
  private readonly objects = new Map<string, StoredGcsObjectEntry>();
  public saveCallCount = 0;
  public deleteCallCount = 0;
  public getMetadataCallCount = 0;
  public createReadStreamCallCount = 0;
  public throwOnGetMetadata: Error | null = null;
  public throwOnReadStream: Error | null = null;

  constructor(bucketName: string = LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME) {
    this.name = bucketName;
  }

  public seedVerifiedQuarantineObject(
    receipt: LibraryQuarantineInternalReceipt,
    bytes: Buffer,
    generation = receipt.generation ?? '1731072000123456',
    metadataOverrides: Partial<GcsLibraryQuarantineObjectMetadata> = {}
  ): void {
    const metadata: GcsLibraryQuarantineObjectMetadata = {
      name: receipt.storagePath,
      bucket: this.name,
      generation,
      metageneration: '1',
      contentType: receipt.canonicalMimeType,
      cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
      contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      size: String(bytes.byteLength),
      metadata: {
        receiptId: receipt.receiptId,
        uploaderUid: receipt.uploaderUid,
        sha256: receipt.sha256,
        format: receipt.format,
        quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      },
      ...metadataOverrides,
    };
    this.objects.set(receipt.storagePath, {
      bytes: Buffer.from(bytes),
      metadata,
      generation,
    });
  }

  public file(
    objectPath: string,
    options?: GcsLibraryQuarantineFileOptions
  ): GcsLibraryQuarantineFile {
    const pinnedGen = options?.generation;

    const handle: GcsLibraryQuarantineFile = {
      name: objectPath,
      ...(pinnedGen !== undefined ? { generation: pinnedGen } : {}),
      save: async (
        _data: Buffer,
        _saveOptions: GcsLibraryQuarantineSaveOptions
      ): Promise<void> => {
        this.saveCallCount += 1;
        throw new Error(
          'GCS file.save() is strictly forbidden during LIB-FILE-REVIEW-01C draft linkage.'
        );
      },
      getMetadata: async (): Promise<[GcsLibraryQuarantineObjectMetadata]> => {
        this.getMetadataCallCount += 1;
        if (this.throwOnGetMetadata) {
          throw this.throwOnGetMetadata;
        }
        const entry = this.objects.get(objectPath);
        if (!entry) {
          const notFoundErr = new Error(
            `No such object: ${objectPath} (404 Not Found)`
          ) as Error & { code: number };
          notFoundErr.code = 404;
          throw notFoundErr;
        }
        return [deepClone(entry.metadata)];
      },
      createReadStream: (): GcsLibraryQuarantineReadableStream => {
        this.createReadStreamCallCount += 1;
        const entry = this.objects.get(objectPath);
        const streamErr = this.throwOnReadStream;

        const iterable: GcsLibraryQuarantineReadableStream = {
          destroy(): void {
            // no-op cleanup
          },
          async *[Symbol.asyncIterator]() {
            if (streamErr) {
              throw streamErr;
            }
            if (!entry) {
              const err = new Error('Object not found (404)') as Error & {
                code: number;
              };
              err.code = 404;
              throw err;
            }
            if (pinnedGen !== undefined && pinnedGen !== entry.generation) {
              const err = new Error(
                'Generation mismatch on pinned stream (404)'
              ) as Error & { code: number };
              err.code = 404;
              throw err;
            }
            const mid = Math.max(1, Math.floor(entry.bytes.byteLength / 2));
            yield entry.bytes.subarray(0, mid);
            yield entry.bytes.subarray(mid);
          },
        };
        return iterable;
      },
    };

    return handle;
  }
}

class FaultInjectingQuarantineFirestoreDatabase
  implements
    LibraryQuarantineFirestoreDatabase,
    LibraryQuarantineReviewDraftFirestoreDatabase
{
  private readonly collections = new Map<string, Map<string, unknown>>();
  public pointGetCalls = 0;
  public transactionCount = 0;
  public transactionCallbackInvocations = 0;
  public receiptGetCallsInTx = 0;
  public draftGetCallsInTx = 0;
  public receiptWriteCalls = 0;
  public draftCreateCalls = 0;
  public draftSetCalls = 0;

  public throwOnPointGet: Error | null = null;
  public onBeforeTransactionReadHook: (() => void | Promise<void>) | null =
    null;
  public onBeforeTransactionCommitHook: (() => void | Promise<void>) | null =
    null;
  public onAfterTransactionCommitHook: (() => void | Promise<void>) | null =
    null;

  private getCollectionMap(collectionName: string): Map<string, unknown> {
    let col = this.collections.get(collectionName);
    if (!col) {
      col = new Map<string, unknown>();
      this.collections.set(collectionName, col);
    }
    return col;
  }

  public seedRawDoc(
    collectionName: string,
    docId: string,
    data: unknown
  ): void {
    this.getCollectionMap(collectionName).set(docId, deepClone(data));
  }

  public getRawDoc(collectionName: string, docId: string): unknown | undefined {
    const val = this.getCollectionMap(collectionName).get(docId);
    return val !== undefined ? deepClone(val) : undefined;
  }

  public resetCounters(): void {
    this.pointGetCalls = 0;
    this.transactionCount = 0;
    this.transactionCallbackInvocations = 0;
    this.receiptGetCallsInTx = 0;
    this.draftGetCallsInTx = 0;
    this.receiptWriteCalls = 0;
    this.draftCreateCalls = 0;
    this.draftSetCalls = 0;
    this.throwOnPointGet = null;
    this.onBeforeTransactionReadHook = null;
    this.onBeforeTransactionCommitHook = null;
    this.onAfterTransactionCommitHook = null;
  }

  public collection(collectionName: string) {
    return {
      get: (): never => {
        throw new Error(
          `Unbounded collection.get() on "${collectionName}" is strictly forbidden.`
        );
      },
      doc: (
        documentId: string
      ): LibraryQuarantineFirestoreDocumentRef & {
        readonly collectionName: string;
      } => ({
        id: documentId,
        collectionName,
        get: async (): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
          this.pointGetCalls += 1;
          if (this.throwOnPointGet) {
            throw this.throwOnPointGet;
          }
          const colMap = this.getCollectionMap(collectionName);
          const hasDoc = colMap.has(documentId);
          const cloned = hasDoc
            ? deepClone(colMap.get(documentId))
            : undefined;
          return {
            exists: hasDoc,
            id: documentId,
            data: () => deepClone(cloned),
          };
        },
      }),
    };
  }

  public async runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineFirestoreTransaction &
        LibraryQuarantineReviewDraftFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    this.transactionCount += 1;
    this.transactionCallbackInvocations += 1;

    if (this.onBeforeTransactionReadHook) {
      const hook = this.onBeforeTransactionReadHook;
      this.onBeforeTransactionReadHook = null;
      await hook();
    }

    const stagedCreates: Array<{
      collectionName: string;
      docId: string;
      data: Record<string, unknown>;
    }> = [];
    const readVersions: Array<{
      collectionName: string;
      docId: string;
      snapshotJson: string | null;
    }> = [];

    const tx: LibraryQuarantineFirestoreTransaction &
      LibraryQuarantineReviewDraftFirestoreTransaction = {
      get: async (
        docRef: LibraryQuarantineFirestoreDocumentRef
      ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
        if (stagedCreates.length > 0) {
          throw new Error(
            'Firestore transaction rule violation: all reads must be executed before any writes.'
          );
        }
        const colName =
          (docRef as unknown as { collectionName?: string }).collectionName ??
          LIBRARY_QUARANTINE_RECEIPT_COLLECTION;

        if (colName === LIBRARY_QUARANTINE_RECEIPT_COLLECTION) {
          this.receiptGetCallsInTx += 1;
        } else if (colName === LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION) {
          this.draftGetCallsInTx += 1;
        }

        const colMap = this.getCollectionMap(colName);
        const exists = colMap.has(docRef.id);
        const rawVal = exists ? deepClone(colMap.get(docRef.id)) : undefined;
        readVersions.push({
          collectionName: colName,
          docId: docRef.id,
          snapshotJson: exists ? JSON.stringify(rawVal) : null,
        });

        return {
          exists,
          id: docRef.id,
          data: () => deepClone(rawVal),
        };
      },
      create: (
        docRef: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        const colName =
          (docRef as unknown as { collectionName?: string }).collectionName ??
          LIBRARY_QUARANTINE_RECEIPT_COLLECTION;

        if (colName === LIBRARY_QUARANTINE_RECEIPT_COLLECTION) {
          this.receiptWriteCalls += 1;
          throw new Error(
            'Mutating library_quarantine_receipts inside review draft transaction is strictly forbidden!'
          );
        }

        this.draftCreateCalls += 1;
        stagedCreates.push({
          collectionName: colName,
          docId: docRef.id,
          data: deepClone(data),
        });
      },
      set: (
        docRef: LibraryQuarantineFirestoreDocumentRef,
        _data: Record<string, unknown>
      ): void => {
        const colName =
          (docRef as unknown as { collectionName?: string }).collectionName ??
          LIBRARY_QUARANTINE_RECEIPT_COLLECTION;
        if (colName === LIBRARY_QUARANTINE_RECEIPT_COLLECTION) {
          this.receiptWriteCalls += 1;
        } else {
          this.draftSetCalls += 1;
        }
        throw new Error('transaction.set() is strictly forbidden.');
      },
    };

    const result = await updateFunction(tx);

    if (this.onBeforeTransactionCommitHook) {
      const commitHook = this.onBeforeTransactionCommitHook;
      this.onBeforeTransactionCommitHook = null;
      await commitHook();
    }

    for (const readRec of readVersions) {
      const colMap = this.getCollectionMap(readRec.collectionName);
      const currentExists = colMap.has(readRec.docId);
      const currentJson = currentExists
        ? JSON.stringify(colMap.get(readRec.docId))
        : null;
      if (currentJson !== readRec.snapshotJson) {
        throw new Error(
          `ABORTED: Transaction read-lock conflict on ${readRec.collectionName}/${readRec.docId}.`
        );
      }
    }

    for (const createOp of stagedCreates) {
      const colMap = this.getCollectionMap(createOp.collectionName);
      if (colMap.has(createOp.docId)) {
        throw new Error(
          `ALREADY_EXISTS: Document ${createOp.collectionName}/${createOp.docId} already exists.`
        );
      }
      colMap.set(createOp.docId, deepClone(createOp.data));
    }

    if (this.onAfterTransactionCommitHook) {
      const afterHook = this.onAfterTransactionCommitHook;
      this.onAfterTransactionCommitHook = null;
      await afterHook();
    }

    return result;
  }
}

function createVerifiedQuarantinedFixture(options: {
  readonly format: 'PDF' | 'DOCX';
  readonly uploaderUid?: string;
  readonly revision?: number;
  readonly generation?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}): {
  readonly bytes: Buffer;
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
} {
  const uploaderUid = options.uploaderUid ?? 'uploader_scientist_01';
  const createdAt = options.createdAt ?? '2026-11-09T08:00:00.000Z';
  const writePendingAt = '2026-11-09T08:01:00.000Z';
  const updatedAt = options.updatedAt ?? '2026-11-09T08:02:00.000Z';
  const generation = options.generation ?? '1731158400998877';
  const revision = options.revision ?? 3;

  const bytes =
    options.format === 'PDF'
      ? makeValidPdfBuffer(`PDF Bridge Fixture ${generation}`)
      : makeValidDocxBuffer(`DOCX Bridge Fixture ${generation}`);
  const filename =
    options.format === 'PDF'
      ? 'UNEP_Adaptation_Gap_2026.pdf'
      : 'FAO_Soil_Carbon_Protocol_2026.docx';
  const mime =
    options.format === 'PDF'
      ? CANONICAL_PDF_MIME_TYPE
      : CANONICAL_DOCX_MIME_TYPE;

  const reservedRes = reserveLibraryQuarantineReceipt({
    uploaderUid,
    originalFilename: filename,
    claimedMimeType: mime,
    bytes,
    nowIso: createdAt,
  });
  if (!reservedRes.ok) {
    throw new Error(reservedRes.errorMessage);
  }

  const pendingRes = beginLibraryQuarantineWritePending({
    receipt: reservedRes.receipt,
    actorUid: uploaderUid,
    nowIso: writePendingAt,
  });
  if (!pendingRes.ok) {
    throw new Error(pendingRes.errorMessage);
  }

  const confirmedRes = confirmLibraryQuarantineWriteWithAttestation({
    receipt: pendingRes.receipt,
    actorUid: uploaderUid,
    attestation: {
      attestedReceiptId: pendingRes.receipt.receiptId,
      attestedUploaderUid: uploaderUid,
      attestedStoragePath: pendingRes.receipt.storagePath,
      attestedFormat: pendingRes.receipt.format,
      attestedContentType: pendingRes.receipt.canonicalMimeType,
      attestedByteSize: pendingRes.receipt.byteSize,
      attestedSha256: pendingRes.receipt.sha256,
      attestedGeneration: generation,
      verifiedAtIso: updatedAt,
    },
  });
  if (!confirmedRes.ok) {
    throw new Error(confirmedRes.errorMessage);
  }

  const envelope: LibraryQuarantinePersistedReceiptEnvelope = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision,
    state: LibraryQuarantineReceiptState.Quarantined,
    receipt: confirmedRes.receipt,
  });

  return {
    bytes,
    receipt: confirmedRes.receipt,
    envelope,
  };
}

const EXPECTED_SUCCESS_DTO_KEYS = Object.freeze([
  'disposition',
  'draftCreated',
  'draftCreationOutcome',
  'isPublished',
  'isReadyForPeia',
  'isRightsApproved',
  'isSanitized',
  'isVerifiedSafe',
  'ok',
  'receiptId',
  'reviewState',
  'sourceRevision',
  'status',
]);

const EXPECTED_FAILURE_DTO_KEYS = Object.freeze([
  'callableStatus',
  'draftCreated',
  'draftCreationOutcome',
  'errorCode',
  'errorMessage',
  'isPublished',
  'isReadyForPeia',
  'isRightsApproved',
  'isSanitized',
  'isVerifiedSafe',
  'ok',
  'receiptId',
  'status',
]);

function assertBridgeDtoZeroLeakage(
  dto: unknown,
  contextLabel: string,
  forbiddenLiterals: readonly string[]
): void {
  const serialized = JSON.stringify(dto);
  const lower = serialized.toLowerCase();

  assert.equal(
    lower.includes('library/quarantine/'),
    false,
    `${contextLabel}: must not leak library/quarantine/ path`
  );
  assert.equal(
    lower.includes('storagepath'),
    false,
    `${contextLabel}: must not contain storagePath`
  );
  assert.equal(
    lower.includes('generation'),
    false,
    `${contextLabel}: must not contain generation or attestedGeneration`
  );
  assert.equal(
    lower.includes('"attestation"'),
    false,
    `${contextLabel}: must not contain attestation`
  );
  assert.equal(
    lower.includes('sourcesha256') || lower.includes('"sha256"'),
    false,
    `${contextLabel}: must not expose sourceSha256 or sha256 in bridge DTO`
  );
  assert.equal(
    lower.includes('"draft"') || lower.includes('"candidate"'),
    false,
    `${contextLabel}: must not expose raw draft or candidate object in bridge DTO`
  );
  assert.equal(
    lower.includes('uploaderuid') || lower.includes('createdby'),
    false,
    `${contextLabel}: must not expose uploaderUid or createdBy in bridge DTO`
  );
  assert.equal(
    lower.includes(LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME.toLowerCase()) ||
      lower.includes(
        FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME.toLowerCase()
      ),
    false,
    `${contextLabel}: must not expose private bucket name`
  );
  assert.equal(
    lower.includes('gs://') ||
      lower.includes('http://') ||
      lower.includes('https://'),
    false,
    `${contextLabel}: must not contain gs:// or http/https URLs`
  );
  assert.equal(
    lower.includes('signedurl') || lower.includes('downloadtoken'),
    false,
    `${contextLabel}: must not contain signedUrl or downloadToken`
  );

  for (const literal of forbiddenLiterals) {
    if (literal.length > 0) {
      assert.equal(
        serialized.includes(literal),
        false,
        `${contextLabel}: must not leak literal "${literal}"`
      );
    }
  }
}

async function runTests(): Promise<void> {
  console.log(
    'Running LIB-FILE-REVIEW-01C trusted callable bridge tests...'
  );

  const defaultAdmins: VersionedAdminRepositoryRecord[] = [
    {
      id: 'admin_owner_01',
      name: 'Owner Reviewer',
      email: 'owner@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
      revision: 1,
    },
    {
      id: 'admin_curator_01',
      name: 'Library Curator',
      email: 'curator@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
      revision: 1,
    },
    {
      id: 'admin_rights_01',
      name: 'Rights Reviewer',
      email: 'rights@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
      revision: 1,
    },
    {
      id: 'admin_inactive_curator',
      name: 'Inactive Curator',
      email: 'inactive@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: false,
      revision: 2,
    },
    {
      id: 'admin_ai_assistant',
      name: 'PEIA AI Assistant',
      email: 'ai@promiseofplanet.org',
      role: AdminRole.AIAssistant,
      isActive: true,
      revision: 1,
    },
    {
      id: 'admin_content_editor',
      name: 'News Content Editor',
      email: 'editor@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
      revision: 1,
    },
    {
      id: 'admin_training_mgr',
      name: 'Training Manager',
      email: 'training@promiseofplanet.org',
      role: AdminRole.TrainingManager,
      isActive: true,
      revision: 1,
    },
    {
      id: 'admin_viewer_01',
      name: 'Read Only Viewer',
      email: 'viewer@promiseofplanet.org',
      role: AdminRole.Viewer,
      isActive: true,
      revision: 1,
    },
  ];

  // =========================================================================
  // PASS 1: Valid Quarantined PDF & DOCX callable bridge execution, exact
  //         13-key minimal non-secret DTO, and single-operation budgets
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const runtime = createProductionLibraryQuarantineReviewDraftBridgeRuntime({
      adminRepository: adminRepo,
      getFirestore: () => db,
      getStorage: () => ({
        bucket: (name: string) => {
          assert.equal(name, LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME);
          return bucket;
        },
      }),
      clock: () => '2026-11-09T10:00:00.000Z',
    });

    const pdfFix = createVerifiedQuarantinedFixture({
      format: 'PDF',
      revision: 3,
      generation: '1731158400111222',
    });
    const docxFix = createVerifiedQuarantinedFixture({
      format: 'DOCX',
      revision: 4,
      generation: '1731158400333444',
    });

    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      pdfFix.receipt.receiptId,
      pdfFix.envelope
    );
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      docxFix.receipt.receiptId,
      docxFix.envelope
    );
    bucket.seedVerifiedQuarantineObject(pdfFix.receipt, pdfFix.bytes);
    bucket.seedVerifiedQuarantineObject(docxFix.receipt, docxFix.bytes);

    db.resetCounters();
    const pdfRes = await executeLibraryQuarantineReviewDraftCallableBridge(
      {
        auth: {
          uid: 'admin_curator_01',
          token: { email: 'curator@promiseofplanet.org', email_verified: true },
        },
        data: { receiptId: pdfFix.receipt.receiptId },
        rawRequest: {
          headers: { origin: 'https://promiseofplanet.org' },
        },
      },
      runtime
    );

    if (!pdfRes.ok) {
      throw new Error(pdfRes.errorMessage);
    }

    assert.deepEqual(
      Object.keys(pdfRes).sort(),
      EXPECTED_SUCCESS_DTO_KEYS,
      'Success DTO must contain the exact 13 allowed keys and nothing else'
    );
    assert.equal(pdfRes.ok, true);
    assert.equal(pdfRes.status, 'LINKED_PENDING_HUMAN_REVIEW');
    assert.equal(pdfRes.receiptId, pdfFix.receipt.receiptId);
    assert.equal(pdfRes.sourceRevision, 3);
    assert.equal(pdfRes.reviewState, 'PENDING_HUMAN_REVIEW');
    assert.equal(pdfRes.disposition, 'CREATED');
    assert.equal(pdfRes.draftCreationOutcome, 'CREATED');
    assert.equal(pdfRes.draftCreated, true);
    assert.equal(pdfRes.isSanitized, false);
    assert.equal(pdfRes.isVerifiedSafe, false);
    assert.equal(pdfRes.isRightsApproved, false);
    assert.equal(pdfRes.isPublished, false);
    assert.equal(pdfRes.isReadyForPeia, false);

    // Operation budget check: 1 pre-GCS receipt read, 1 GCS metadata + 1 GCS stream, 1 transaction, 0 GCS writes, 0 receipt writes
    assert.equal(db.pointGetCalls, 1);
    assert.equal(bucket.getMetadataCallCount, 1);
    assert.equal(bucket.createReadStreamCallCount, 1);
    assert.equal(bucket.saveCallCount, 0);
    assert.equal(bucket.deleteCallCount, 0);
    assert.equal(db.transactionCount, 1);
    assert.equal(db.draftCreateCalls, 1);
    assert.equal(db.receiptWriteCalls, 0);

    assertBridgeDtoZeroLeakage(pdfRes, 'PDF callable bridge success DTO', [
      pdfFix.receipt.storagePath,
      pdfFix.receipt.generation ?? '',
      pdfFix.receipt.sha256,
      pdfFix.receipt.uploaderUid,
      'admin_curator_01',
    ]);

    // Idempotent second call on PDF receipt
    db.resetCounters();
    const pdfReplayRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: pdfFix.receipt.receiptId },
        },
        runtime
      );
    if (!pdfReplayRes.ok) {
      throw new Error(pdfReplayRes.errorMessage);
    }
    assert.deepEqual(
      Object.keys(pdfReplayRes).sort(),
      EXPECTED_SUCCESS_DTO_KEYS
    );
    assert.equal(pdfReplayRes.disposition, 'IDEMPOTENT_EXISTING');
    assert.equal(pdfReplayRes.draftCreationOutcome, 'IDEMPOTENT_EXISTING');
    assert.equal(pdfReplayRes.draftCreated, false);
    assert.equal(db.draftCreateCalls, 0);
    assert.equal(db.receiptWriteCalls, 0);

    // DOCX creation via RightsReviewer
    db.resetCounters();
    const docxRes = await executeLibraryQuarantineReviewDraftCallableBridge(
      {
        auth: { uid: 'admin_rights_01' },
        data: { receiptId: docxFix.receipt.receiptId },
      },
      runtime
    );
    if (!docxRes.ok) {
      throw new Error(docxRes.errorMessage);
    }
    assert.deepEqual(Object.keys(docxRes).sort(), EXPECTED_SUCCESS_DTO_KEYS);
    assert.equal(docxRes.disposition, 'CREATED');
    assert.equal(docxRes.draftCreationOutcome, 'CREATED');
    assert.equal(docxRes.draftCreated, true);
    assert.equal(docxRes.sourceRevision, 4);
    assert.equal(db.draftCreateCalls, 1);
    assert.equal(db.receiptWriteCalls, 0);

    console.log(
      'PASS 1: Valid Quarantined PDF and DOCX callable bridge calls return the exact 13-key minimal DTO with zero secret leakage and single-invocation budgets.'
    );
  }

  // =========================================================================
  // PASS 2: SDK-trusted request.auth provenance, request.data spoofing
  //         rejection, and fail-closed authorization before receipt/GCS
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const runtime = createProductionLibraryQuarantineReviewDraftBridgeRuntime({
      adminRepository: adminRepo,
      getFirestore: () => db,
      getStorage: () => ({
        bucket: () => bucket,
      }),
      clock: () => '2026-11-09T10:05:00.000Z',
    });

    const fix = createVerifiedQuarantinedFixture({ format: 'PDF' });
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    bucket.seedVerifiedQuarantineObject(fix.receipt, fix.bytes);

    // 2A: Spoofed request.data fields (data.auth, data.uid, data.role, data.token, data.isAuthorized, symbol keys)
    const symKey = Symbol('spoofed_symbol');
    const symbolDataObj: Record<PropertyKey, unknown> = {
      receiptId: fix.receipt.receiptId,
    };
    symbolDataObj[symKey] = true;

    const spoofedDataRequests: unknown[] = [
      {
        auth: { uid: 'admin_viewer_01' },
        data: {
          receiptId: fix.receipt.receiptId,
          auth: { uid: 'admin_owner_01' },
        },
      },
      {
        auth: null,
        data: {
          receiptId: fix.receipt.receiptId,
          auth: { uid: 'admin_owner_01' },
        },
      },
      {
        auth: { uid: 'admin_viewer_01' },
        data: {
          receiptId: fix.receipt.receiptId,
          uid: 'admin_owner_01',
        },
      },
      {
        auth: { uid: 'admin_viewer_01' },
        data: {
          receiptId: fix.receipt.receiptId,
          role: AdminRole.Owner,
        },
      },
      {
        auth: { uid: 'admin_owner_01' },
        data: {
          receiptId: fix.receipt.receiptId,
          isAuthorized: true,
        },
      },
      {
        auth: { uid: 'admin_owner_01' },
        data: {
          receiptId: fix.receipt.receiptId,
          candidate: {},
        },
      },
      {
        auth: { uid: 'admin_owner_01' },
        data: {
          receiptId: fix.receipt.receiptId,
          generation: fix.receipt.generation,
        },
      },
      {
        auth: { uid: 'admin_owner_01' },
        data: {
          receiptId: fix.receipt.receiptId,
          storagePath: fix.receipt.storagePath,
        },
      },
      {
        auth: { uid: 'admin_owner_01' },
        data: symbolDataObj,
      },
    ];

    db.resetCounters();
    adminRepo.getAdminCalls = 0;

    for (const req of spoofedDataRequests) {
      const res = await executeLibraryQuarantineReviewDraftCallableBridge(
        req,
        runtime
      );
      if (res.ok) {
        throw new Error('Expected spoofed request.data payload to HOLD');
      }
      assert.deepEqual(Object.keys(res).sort(), EXPECTED_FAILURE_DTO_KEYS);
      assert.equal(res.status, 'HOLD');
      assert.equal(res.callableStatus, 'invalid-argument');
      assert.equal(res.errorCode, 'UNTRUSTED_CALLER_FIELD_HOLD');
      assert.equal(res.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(res.draftCreated, false);
    }

    assert.equal(
      adminRepo.getAdminCalls,
      0,
      'Spoofed request.data fields must fail before AdminRepository lookup'
    );
    assert.equal(db.pointGetCalls, 0);
    assert.equal(bucket.getMetadataCallCount, 0);

    // 2B: Absent or malformed request.auth -> unauthenticated (0 admin/receipt/GCS reads)
    const unauthenticatedRequests: unknown[] = [
      {
        data: { receiptId: fix.receipt.receiptId },
      },
      {
        auth: null,
        data: { receiptId: fix.receipt.receiptId },
      },
      {
        auth: { uid: '' },
        data: { receiptId: fix.receipt.receiptId },
      },
      {
        auth: { uid: '   ' },
        data: { receiptId: fix.receipt.receiptId },
      },
      {
        auth: { uid: 'invalid/uid/with/slashes' },
        data: { receiptId: fix.receipt.receiptId },
      },
    ];

    for (const req of unauthenticatedRequests) {
      const res = await executeLibraryQuarantineReviewDraftCallableBridge(
        req,
        runtime
      );
      if (res.ok) {
        throw new Error('Expected missing/malformed request.auth to HOLD');
      }
      assert.deepEqual(Object.keys(res).sort(), EXPECTED_FAILURE_DTO_KEYS);
      assert.equal(res.callableStatus, 'unauthenticated');
      assert.equal(res.errorCode, 'UNAUTHENTICATED_CALLER_HOLD');
      assert.equal(res.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(res.draftCreated, false);
    }
    assert.equal(
      adminRepo.getAdminCalls,
      0,
      'Unauthenticated requests must perform 0 AdminRepository reads'
    );
    assert.equal(db.pointGetCalls, 0);
    assert.equal(bucket.getMetadataCallCount, 0);

    // 2C: Unauthorized principals (AI claims, inactive, Viewer, Viewer with forged Owner token claim, wrong domain)
    const unauthorizedAuthContexts: unknown[] = [
      { uid: 'unknown_user_999' },
      { uid: 'admin_inactive_curator' },
      { uid: 'admin_ai_assistant' },
      { uid: 'admin_owner_01', token: { ai: true } },
      { uid: 'admin_owner_01', token: { isAIAssistant: true } },
      { uid: 'admin_owner_01', token: { isAiAssistant: true } },
      { uid: 'admin_owner_01', token: { automated: true } },
      { uid: 'admin_owner_01', token: { actorType: 'ai' } },
      { uid: 'admin_owner_01', token: { principalType: 'machine' } },
      { uid: 'admin_owner_01', token: { isAuthorized: true } },
      { uid: 'admin_owner_01', isAuthorized: true },
      { uid: 'admin_content_editor' },
      { uid: 'admin_training_mgr' },
      { uid: 'admin_viewer_01' },
      {
        uid: 'admin_viewer_01',
        token: { role: AdminRole.Owner, admin: true },
      },
    ];

    for (const authCtx of unauthorizedAuthContexts) {
      const res = await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: authCtx as { uid: string },
          data: { receiptId: fix.receipt.receiptId },
        },
        runtime
      );
      if (res.ok) {
        throw new Error('Expected unauthorized request.auth principal to HOLD');
      }
      assert.deepEqual(Object.keys(res).sort(), EXPECTED_FAILURE_DTO_KEYS);
      assert.equal(res.callableStatus, 'permission-denied');
      assert.equal(res.errorCode, 'UNAUTHORIZED_REVIEWER_HOLD');
      assert.equal(res.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(res.draftCreated, false);
    }

    // 2D: Untrusted or wildcard CORS Origin header rejected before any storage probe
    for (const badOrigin of ['https://evil.example.com', '*', '']) {
      const originRes =
        await executeLibraryQuarantineReviewDraftCallableBridge(
          {
            auth: { uid: 'admin_owner_01' },
            data: { receiptId: fix.receipt.receiptId },
            rawRequest: {
              headers: { origin: badOrigin },
            },
          },
          runtime
        );
      assert.equal(originRes.ok, false);
      if (!originRes.ok) {
        assert.equal(originRes.callableStatus, 'permission-denied');
        assert.equal(originRes.errorCode, 'CORS_ORIGIN_FORBIDDEN_HOLD');
        assert.equal(originRes.draftCreationOutcome, 'NOT_CREATED');
        assert.equal(originRes.draftCreated, false);
      }
    }

    assert.equal(
      db.pointGetCalls,
      0,
      'All unauthenticated, spoofed, unauthorized, and bad-origin calls must perform 0 Firestore receipt reads'
    );
    assert.equal(
      bucket.getMetadataCallCount,
      0,
      'All unauthenticated, spoofed, unauthorized, and bad-origin calls must perform 0 GCS metadata probes'
    );
    assert.equal(
      bucket.createReadStreamCallCount,
      0,
      'All unauthenticated, spoofed, unauthorized, and bad-origin calls must perform 0 GCS stream probes'
    );
    assert.equal(db.transactionCount, 0);
    assert.equal(db.draftCreateCalls, 0);

    console.log(
      'PASS 2: Spoofed request.data fields, absent/malformed request.auth, AI/inactive/Viewer/wrong-domain principals, and untrusted Origins fail closed with zero receipt or GCS access.'
    );
  }

  // =========================================================================
  // PASS 3: Per-request principal isolation across sequential and interleaved
  //         concurrent requests (never exchanges UIDs)
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const runtime = createProductionLibraryQuarantineReviewDraftBridgeRuntime({
      adminRepository: adminRepo,
      getFirestore: () => db,
      getStorage: () => ({
        bucket: () => bucket,
      }),
      clock: () => '2026-11-09T10:15:00.000Z',
    });

    const fixA = createVerifiedQuarantinedFixture({
      format: 'PDF',
      revision: 3,
      generation: '1731158400500001',
    });
    const fixB = createVerifiedQuarantinedFixture({
      format: 'DOCX',
      revision: 4,
      generation: '1731158400500002',
    });

    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fixA.receipt.receiptId,
      fixA.envelope
    );
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fixB.receipt.receiptId,
      fixB.envelope
    );
    bucket.seedVerifiedQuarantineObject(fixA.receipt, fixA.bytes);
    bucket.seedVerifiedQuarantineObject(fixB.receipt, fixB.bytes);

    // Direct unit check on createRequestScopedCallablePrincipalProvider isolation
    const prov1 = createRequestScopedCallablePrincipalProvider({
      uid: 'admin_owner_01',
    });
    const prov2 = createRequestScopedCallablePrincipalProvider({
      uid: 'admin_rights_01',
    });
    assert.equal(prov1.ok, true);
    assert.equal(prov2.ok, true);
    if (prov1.ok && prov2.ok) {
      const p1 = await prov1.principalProvider.resolveAuthenticatedPrincipal();
      const p2 = await prov2.principalProvider.resolveAuthenticatedPrincipal();
      assert.equal(p1?.uid, 'admin_owner_01');
      assert.equal(p2?.uid, 'admin_rights_01');
    }

    // Interleaved concurrent requests with staggered async AdminRepository delays
    adminRepo.delayMsByUid.set('admin_owner_01', 25);
    adminRepo.delayMsByUid.set('admin_viewer_01', 10);
    adminRepo.delayMsByUid.set('admin_rights_01', 5);

    const [resOwner, resViewer, resRights] = await Promise.all([
      executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: fixA.receipt.receiptId },
        },
        runtime
      ),
      executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_viewer_01' },
          data: { receiptId: fixA.receipt.receiptId },
        },
        runtime
      ),
      executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_rights_01' },
          data: { receiptId: fixB.receipt.receiptId },
        },
        runtime
      ),
    ]);

    adminRepo.delayMsByUid.clear();

    assert.equal(resOwner.ok, true);
    assert.equal(resViewer.ok, false);
    if (!resViewer.ok) {
      assert.equal(resViewer.errorCode, 'UNAUTHORIZED_REVIEWER_HOLD');
    }
    assert.equal(resRights.ok, true);

    const persistedDraftA = db.getRawDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      fixA.receipt.receiptId
    ) as Record<string, unknown>;
    const persistedDraftB = db.getRawDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      fixB.receipt.receiptId
    ) as Record<string, unknown>;

    assert.equal(
      persistedDraftA.createdBy,
      'admin_owner_01',
      'Request A must record admin_owner_01 without cross-request UID contamination'
    );
    assert.equal(
      persistedDraftB.createdBy,
      'admin_rights_01',
      'Request B must record admin_rights_01 without cross-request UID contamination'
    );

    console.log(
      'PASS 3: Sequential and interleaved concurrent requests maintain strict per-request principal isolation and never exchange UIDs.'
    );
  }

  // =========================================================================
  // PASS 4: Explicit dedicated quarantine bucket binding
  //         (promiseofplanet-bb325-library-quarantine), default-bucket
  //         rejection, and read-only bucket guard
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const dedicatedBucket = new InMemoryGenerationPinnedGcsBucket(
      LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    );
    let requestedBucketArg: string | null = null;

    const prodRuntime =
      createProductionLibraryQuarantineReviewDraftBridgeRuntime({
        getFirestore: () => db,
        getStorage: () => ({
          bucket: (name: string) => {
            requestedBucketArg = name;
            return dedicatedBucket;
          },
        }),
      });

    assert.equal(
      requestedBucketArg,
      LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    );
    assert.equal(
      prodRuntime.targetBucketName,
      LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    );

    // Reject default Firebase Storage bucket (promiseofplanet-bb325.firebasestorage.app)
    const forbiddenDefaultBucket = new InMemoryGenerationPinnedGcsBucket(
      FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME
    );
    assert.throws(() => {
      createProductionLibraryQuarantineReviewDraftBridgeRuntime({
        getFirestore: () => db,
        getStorage: () => ({
          bucket: () => forbiddenDefaultBucket,
        }),
      });
    }, /UNSAFE_BUCKET_BINDING/);

    // Reject arbitrary/mismatched or unnamed bucket handle
    const wrongBucket = new InMemoryGenerationPinnedGcsBucket(
      'some-other-bucket'
    );
    assert.throws(() => {
      createProductionLibraryQuarantineReviewDraftBridgeRuntime({
        getFirestore: () => db,
        getStorage: () => ({
          bucket: () => wrongBucket,
        }),
      });
    }, /UNSAFE_BUCKET_BINDING/);

    assert.throws(() => {
      createProductionLibraryQuarantineReviewDraftBridgeRuntime({
        getFirestore: () => db,
        getStorage: () => ({
          bucket: () => ({ file: () => ({}) }),
        }),
      });
    }, /UNSAFE_BUCKET_BINDING/);

    // Reject caller-supplied bucket / bucketName overrides
    assert.throws(() => {
      createProductionLibraryQuarantineReviewDraftBridgeRuntime({
        getFirestore: () => db,
        bucketName: 'custom-bucket',
      } as unknown as Parameters<
        typeof createProductionLibraryQuarantineReviewDraftBridgeRuntime
      >[0]);
    }, /UNSAFE_BUCKET_BINDING/);

    console.log(
      'PASS 4: Production runtime factory binds exclusively to promiseofplanet-bb325-library-quarantine and rejects default or mismatched buckets.'
    );
  }

  // =========================================================================
  // PASS 5: Truthful UNKNOWN (draftCreated: null) vs NOT_CREATED
  //         (draftCreated: false) outcome preservation & idempotent replay
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    let currentClockIso = '2026-11-09T11:00:00.000Z';
    const runtime = createProductionLibraryQuarantineReviewDraftBridgeRuntime({
      adminRepository: adminRepo,
      getFirestore: () => db,
      getStorage: () => ({
        bucket: () => bucket,
      }),
      clock: () => currentClockIso,
    });

    const fix = createVerifiedQuarantinedFixture({
      format: 'PDF',
      revision: 3,
      generation: '1731158400777888',
    });

    // 5A: Missing receipt -> NOT_CREATED / draftCreated: false
    const missingRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        runtime
      );
    assert.equal(missingRes.ok, false);
    if (!missingRes.ok) {
      assert.deepEqual(
        Object.keys(missingRes).sort(),
        EXPECTED_FAILURE_DTO_KEYS
      );
      assert.equal(missingRes.callableStatus, 'not-found');
      assert.equal(missingRes.errorCode, 'SOURCE_RECEIPT_NOT_FOUND_HOLD');
      assert.equal(missingRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(missingRes.draftCreated, false);
    }

    // 5B: Non-Quarantined states (Reserved, WritePending, NeedsReconciliation, Rejected) -> NOT_CREATED / draftCreated: false
    const uploaderUid = 'uploader_scientist_05';
    const pdfBytes = makeValidPdfBuffer('Bridge State Hold Test');
    const resReserved = reserveLibraryQuarantineReceipt({
      uploaderUid,
      originalFilename: 'bridge-state.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: pdfBytes,
      nowIso: '2026-11-09T08:00:00.000Z',
    });
    if (!resReserved.ok) throw new Error(resReserved.errorMessage);
    const resPending = beginLibraryQuarantineWritePending({
      receipt: resReserved.receipt,
      actorUid: uploaderUid,
      nowIso: '2026-11-09T08:01:00.000Z',
    });
    if (!resPending.ok) throw new Error(resPending.errorMessage);
    const resRecon = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: resPending.receipt,
      actorUid: uploaderUid,
      reconciliationReason: 'Ambiguous write outcome',
      nowIso: '2026-11-09T08:02:00.000Z',
    });
    if (!resRecon.ok) throw new Error(resRecon.errorMessage);
    const resRejected = rejectLibraryQuarantineReceipt({
      receipt: resRecon.receipt,
      actorUid: uploaderUid,
      rejectionReasonCode: 'QUARANTINE_OBJECT_MISSING',
      nowIso: '2026-11-09T08:03:00.000Z',
    });
    if (!resRejected.ok) throw new Error(resRejected.errorMessage);

    for (const [state, rec, expectedCode] of [
      [
        LibraryQuarantineReceiptState.Reserved,
        resReserved.receipt,
        'SOURCE_STATE_NOT_ELIGIBLE_HOLD',
      ],
      [
        LibraryQuarantineReceiptState.WritePending,
        resPending.receipt,
        'SOURCE_STATE_NOT_ELIGIBLE_HOLD',
      ],
      [
        LibraryQuarantineReceiptState.NeedsReconciliation,
        resRecon.receipt,
        'NEEDS_RECONCILIATION_HOLD',
      ],
      [
        LibraryQuarantineReceiptState.Rejected,
        resRejected.receipt,
        'SOURCE_STATE_NOT_ELIGIBLE_HOLD',
      ],
    ] as const) {
      db.seedRawDoc(LIBRARY_QUARANTINE_RECEIPT_COLLECTION, rec.receiptId, {
        schemaVersion: 1,
        revision: 2,
        state,
        receipt: rec,
      });
      const stateHoldRes =
        await executeLibraryQuarantineReviewDraftCallableBridge(
          {
            auth: { uid: 'admin_owner_01' },
            data: { receiptId: rec.receiptId },
          },
          runtime
        );
      assert.equal(stateHoldRes.ok, false);
      if (!stateHoldRes.ok) {
        assert.equal(stateHoldRes.callableStatus, 'failed-precondition');
        assert.equal(stateHoldRes.errorCode, expectedCode);
        assert.equal(stateHoldRes.draftCreationOutcome, 'NOT_CREATED');
        assert.equal(stateHoldRes.draftCreated, false);
      }
    }

    // 5C: In-transaction pre-create stale source abort -> NOT_CREATED / draftCreated: false
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    bucket.seedVerifiedQuarantineObject(fix.receipt, fix.bytes);
    db.onBeforeTransactionReadHook = () => {
      db.seedRawDoc(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        fix.receipt.receiptId,
        {
          ...fix.envelope,
          revision: 9,
        }
      );
    };
    const staleHoldRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_curator_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        runtime
      );
    assert.equal(staleHoldRes.ok, false);
    if (!staleHoldRes.ok) {
      assert.equal(staleHoldRes.callableStatus, 'aborted');
      assert.equal(staleHoldRes.errorCode, 'STALE_SOURCE_HOLD');
      assert.equal(staleHoldRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(staleHoldRes.draftCreated, false);
    }

    // 5D: Crash AFTER commit before response reaches caller -> UNKNOWN / draftCreated: null
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    db.resetCounters();
    currentClockIso = '2026-11-09T11:05:00.000Z';
    db.onAfterTransactionCommitHook = () => {
      throw new Error('Simulated commit acknowledgement loss after write');
    };

    const ambiguousCommitRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        runtime
      );
    assert.equal(ambiguousCommitRes.ok, false);
    if (!ambiguousCommitRes.ok) {
      assert.deepEqual(
        Object.keys(ambiguousCommitRes).sort(),
        EXPECTED_FAILURE_DTO_KEYS
      );
      assert.equal(ambiguousCommitRes.callableStatus, 'aborted');
      assert.equal(
        ambiguousCommitRes.errorCode,
        'TRANSACTION_CONFLICT_OR_FAILURE_HOLD'
      );
      assert.equal(
        ambiguousCommitRes.draftCreationOutcome,
        'UNKNOWN',
        'Post-commit crash must report draftCreationOutcome: UNKNOWN'
      );
      assert.equal(
        ambiguousCommitRes.draftCreated,
        null,
        'Post-commit crash must report draftCreated: null (never false)'
      );
    }
    assert.equal(
      db.transactionCount,
      1,
      'Bridge must not auto-retry failed/ambiguous transaction'
    );
    assert.equal(db.draftCreateCalls, 1);

    // 5E: Subsequent fresh replay converges to IDEMPOTENT_EXISTING with 0 additional writes
    db.resetCounters();
    currentClockIso = '2026-11-09T11:10:00.000Z';
    const replayAfterCrashRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_curator_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        runtime
      );
    if (!replayAfterCrashRes.ok) {
      throw new Error(replayAfterCrashRes.errorMessage);
    }
    assert.equal(replayAfterCrashRes.disposition, 'IDEMPOTENT_EXISTING');
    assert.equal(
      replayAfterCrashRes.draftCreationOutcome,
      'IDEMPOTENT_EXISTING'
    );
    assert.equal(replayAfterCrashRes.draftCreated, false);
    assert.equal(db.draftCreateCalls, 0);
    assert.equal(db.receiptWriteCalls, 0);

    const persistedDraft = db.getRawDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      fix.receipt.receiptId
    ) as Record<string, unknown>;
    assert.equal(persistedDraft.createdBy, 'admin_owner_01');
    assert.equal(persistedDraft.createdAt, '2026-11-09T11:05:00.000Z');

    console.log(
      'PASS 5: Bridge preserves truthful UNKNOWN (draftCreated: null) vs NOT_CREATED (draftCreated: false) semantics and idempotent replay with zero added retries.'
    );
  }

  // =========================================================================
  // PASS 6: Sentinel secret exception redaction, CORS configuration, and
  //         unregistered functions/src/index.ts release-gate verification
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const receiptStore = new FirestoreLibraryQuarantineReceiptStore(db);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-09T11:20:00.000Z',
    });
    const draftStore = new FirestoreLibraryQuarantineReviewDraftStore(db);

    const fix = createVerifiedQuarantinedFixture({
      format: 'PDF',
      revision: 3,
      generation: '1731158400999111',
    });
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    bucket.seedVerifiedQuarantineObject(fix.receipt, fix.bytes);

    const secretSentinel =
      'BRIDGE_SECRET_SENTINEL_2026__DO_NOT_LEAK_778899';
    const signedUrlPoison =
      'https://storage.googleapis.com/promiseofplanet-bb325-library-quarantine/secret?X-Goog-Signature=cafebabe';
    const combinedPoison = `${secretSentinel} path=${fix.receipt.storagePath} gen=${fix.receipt.generation} url=${signedUrlPoison}`;
    const forbiddenList = [
      secretSentinel,
      fix.receipt.storagePath,
      fix.receipt.generation ?? '',
      signedUrlPoison,
      'cafebabe',
      'X-Goog-Signature',
    ];

    // 6A: AdminRepository throws Error with sentinel
    adminRepo.customLookupError = new Error(combinedPoison);
    const adminSentinelRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        {
          adminRepository: adminRepo,
          receiptStore,
          storageReadbackPort: gcsAdapter,
          draftStore,
        }
      );
    adminRepo.customLookupError = null;
    assert.equal(adminSentinelRes.ok, false);
    assertBridgeDtoZeroLeakage(
      adminSentinelRes,
      'AdminRepository sentinel error',
      forbiddenList
    );

    // 6B: receiptStore throws Error with sentinel
    db.throwOnPointGet = new Error(combinedPoison);
    const receiptSentinelRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        {
          adminRepository: adminRepo,
          receiptStore,
          storageReadbackPort: gcsAdapter,
          draftStore,
        }
      );
    db.throwOnPointGet = null;
    assert.equal(receiptSentinelRes.ok, false);
    assertBridgeDtoZeroLeakage(
      receiptSentinelRes,
      'receiptStore sentinel error',
      forbiddenList
    );

    // 6C: GCS bucket getMetadata throws Error with sentinel
    bucket.throwOnGetMetadata = new Error(combinedPoison);
    const gcsSentinelRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        {
          adminRepository: adminRepo,
          receiptStore,
          storageReadbackPort: gcsAdapter,
          draftStore,
        }
      );
    bucket.throwOnGetMetadata = null;
    assert.equal(gcsSentinelRes.ok, false);
    assertBridgeDtoZeroLeakage(
      gcsSentinelRes,
      'GCS getMetadata sentinel error',
      forbiddenList
    );

    // 6D: Firestore transaction throws Error with sentinel
    db.onBeforeTransactionCommitHook = () => {
      throw new Error(combinedPoison);
    };
    const txSentinelRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        {
          adminRepository: adminRepo,
          receiptStore,
          storageReadbackPort: gcsAdapter,
          draftStore,
        }
      );
    assert.equal(txSentinelRes.ok, false);
    assertBridgeDtoZeroLeakage(
      txSentinelRes,
      'Firestore transaction sentinel error',
      forbiddenList
    );

    // 6E: Service port throws uncaught Error with sentinel -> UNKNOWN & zero leak
    const serviceThrowRes =
      await executeLibraryQuarantineReviewDraftCallableBridge(
        {
          auth: { uid: 'admin_owner_01' },
          data: { receiptId: fix.receipt.receiptId },
        },
        {
          adminRepository: adminRepo,
          receiptStore,
          storageReadbackPort: gcsAdapter,
          draftStore,
          createPersistenceService: () => ({
            async linkQuarantineReceiptToReviewDraft() {
              throw new Error(combinedPoison);
            },
          }),
        }
      );
    assert.equal(serviceThrowRes.ok, false);
    if (!serviceThrowRes.ok) {
      assert.equal(serviceThrowRes.draftCreationOutcome, 'UNKNOWN');
      assert.equal(serviceThrowRes.draftCreated, null);
    }
    assertBridgeDtoZeroLeakage(
      serviceThrowRes,
      'Uncaught service exception sentinel error',
      forbiddenList
    );

    // 6F: Verify callable options & unregistered release gate
    assert.equal(
      typeof libraryQuarantineReviewDraftLinkCallable,
      'function'
    );
    assert.equal(
      recordedOnCallDefinitions.length,
      1,
      'Exactly one local v2 onCall definition must be registered in libraryQuarantineReviewDraftCallableBridge'
    );
    assert.equal(
      recordedOnCallDefinitions[0].options,
      LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_OPTIONS
    );
    assert.equal(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_OPTIONS.serviceAccount,
      LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_SERVICE_ACCOUNT
    );
    assert.equal(
      Array.isArray(LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_OPTIONS.cors),
      true
    );
    assert.equal(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_CORS_ORIGINS.includes('*'),
      false,
      'CORS allowlist must never include wildcard *'
    );
    assert.deepEqual(
      new Set(LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_CORS_ORIGINS),
      DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS
    );

    const indexSource = fs.readFileSync('functions/src/index.ts', 'utf8');
    assert.equal(
      indexSource.includes('libraryQuarantineReviewDraftLinkCallable'),
      false,
      'functions/src/index.ts must NOT export libraryQuarantineReviewDraftLinkCallable in 01C'
    );
    assert.equal(
      indexSource.includes('libraryQuarantineReviewDraftCallableBridge'),
      false,
      'functions/src/index.ts must NOT import libraryQuarantineReviewDraftCallableBridge in 01C'
    );

    console.log(
      'PASS 6: Sentinel secret exception redaction, fixed CORS allowlist, and unregistered functions/src/index.ts release gate verified.'
    );
  }

  // =========================================================================
  // PASS 7: Read-only baseline files Git blob SHA-1 invariant check
  // =========================================================================
  {
    const expectedBaselineBlobs: ReadonlyArray<readonly [string, string]> = [
      [
        'functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts',
        '5709952519564cb118443fd6dd59ec9cff249bb1',
      ],
      [
        'functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts',
        'f481a24bda7dcbf7a63a12644e5b2d91b8626318',
      ],
      [
        'functions/src/library/libraryQuarantineUploadEndpoint.ts',
        'c400d40606d9d124c377ab3e0c536278d3fb61bc',
      ],
      [
        'functions/src/library/firestoreLibraryQuarantineReceiptStore.ts',
        'd9f4114222851c62c25574efbb0ffbeeb5c355e2',
      ],
      [
        'functions/src/library/gcsLibraryQuarantineStorageAdapter.ts',
        '4bca554dd00a5e2efc739cc166175cc63327c5ad',
      ],
      [
        'functions/src/admin/firestoreAdminRepository.ts',
        'cd118b4ea9da4d66bba8185055dbc7e31537a354',
      ],
      [
        'functions/src/index.ts',
        '5a14cada5dad8e764f8cc3092f40c386f6b09616',
      ],
      [
        'scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts',
        '360a63883f1e3eb18f0ede62ee72e31e7f3a3263',
      ],
      [
        'functions/src/library/libraryQuarantineReviewDraftContract.ts',
        '0aeb565c7f83876dd3c2bfb5b214e9f85d9a0153',
      ],
      [
        'functions/src/library/libraryQuarantineReceiptContract.ts',
        '4b4d5f32e5903def3a3b0dcdecd45e38083f91bb',
      ],
      [
        'functions/src/library/libraryQuarantineRecoveryCoordinator.ts',
        'c2105cb5c12fc27e258943374313ad9b1f1c0e9d',
      ],
      [
        'functions/src/library/libraryQuarantineAdminReadService.ts',
        'fc59ce7350c24ee76f5bd0d6b358196ce48ebc45',
      ],
      [
        'functions/src/library/libraryUploadBinaryAdmission.ts',
        'c479007641d799afb145436bf91e661a7c2d5611',
      ],
      [
        'scripts/runLibraryQuarantineReviewDraftContractTests.ts',
        '6bc6b8e1181da7b6aab0a0f87fe394776a62093f',
      ],
      [
        'scripts/runLibraryQuarantineRecoveryCoordinatorTests.ts',
        'bcab57160a4f58e896ea12c0a9d6cd0be1626787',
      ],
      ['package.json', '34cb668d837d342c9b5367461cca2ad9dd8a18e7'],
    ];

    for (const [relPath, expectedSha1] of expectedBaselineBlobs) {
      const content = fs.readFileSync(relPath);
      const header = Buffer.from(`blob ${content.byteLength}\u0000`, 'utf8');
      const actualSha1 = createHash('sha1')
        .update(Buffer.concat([header, content]))
        .digest('hex');
      assert.equal(
        actualSha1,
        expectedSha1,
        `Protected file ${relPath} SHA-1 mismatch: expected ${expectedSha1}, got ${actualSha1}`
      );
    }

    console.log(
      'PASS 7: All 16 read-only reference files verified at exact expected Git blob SHA-1s.'
    );
  }

  console.log('ALL LIB-FILE-REVIEW-01C CALLABLE BRIDGE TESTS PASSED (7/7).');
}

runTests().catch((err) => {
  console.error('LIB-FILE-REVIEW-01C CALLABLE BRIDGE TESTS FAILED:', err);
  process.exit(1);
});
