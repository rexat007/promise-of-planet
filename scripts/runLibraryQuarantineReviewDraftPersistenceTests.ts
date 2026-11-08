import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';
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
  type TrustedStorageReadbackAttestation,
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
  type LibraryQuarantineGcsAdapterResult,
  type VerifyExistingLibraryQuarantineObjectInput,
} from '../functions/src/library/gcsLibraryQuarantineStorageAdapter';
import {
  FirestoreLibraryQuarantineReviewDraftStore,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
  validatePersistedLibraryQuarantineReviewDraft,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftFirestoreTransaction,
} from '../functions/src/library/firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_REMAINING_GATES,
  LibraryQuarantineReviewDraftPersistenceService,
  type TrustedQuarantineAuthenticatedPrincipal,
  type TrustedQuarantineReviewerPrincipalProvider,
} from '../functions/src/library/libraryQuarantineReviewDraftPersistenceService';

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
  '<w:body><w:p><w:r><w:t>مسودة مراجعة داخلية دائمة لوثائق الحجر الخاص 2026</w:t></w:r></w:p></w:body>' +
  '</w:document>';

function makeValidDocxBuffer(customText?: string): Buffer {
  const docXml = customText
    ? CANONICAL_WORD_DOCUMENT_XML.replace(
        'مسودة مراجعة داخلية دائمة لوثائق الحجر الخاص 2026',
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

function makeValidPdfBuffer(label = 'Quarantine Review Draft Spec 01B'): Buffer {
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

class InMemoryTrustedPrincipalProviderDouble
  implements TrustedQuarantineReviewerPrincipalProvider
{
  private currentPrincipal: TrustedQuarantineAuthenticatedPrincipal | null;
  public resolveCalls = 0;
  public throwOnResolve: Error | null = null;

  constructor(
    initialPrincipal: TrustedQuarantineAuthenticatedPrincipal | null = {
      uid: 'admin_owner_01',
    }
  ) {
    this.currentPrincipal = initialPrincipal;
  }

  public setPrincipal(
    principal: TrustedQuarantineAuthenticatedPrincipal | null
  ): void {
    this.currentPrincipal = principal;
  }

  public async resolveAuthenticatedPrincipal(): Promise<TrustedQuarantineAuthenticatedPrincipal | null> {
    this.resolveCalls += 1;
    if (this.throwOnResolve) {
      throw this.throwOnResolve;
    }
    return this.currentPrincipal;
  }
}

class InMemoryAdminRepositoryDouble implements AdminRepository {
  private readonly users = new Map<string, VersionedAdminRepositoryRecord>();
  public getAdminCalls = 0;
  public throwOnLookup = false;
  public customLookupError: Error | null = null;

  constructor(initialUsers: readonly VersionedAdminRepositoryRecord[] = []) {
    for (const user of initialUsers) {
      this.users.set(user.id, Object.freeze({ ...user }));
    }
  }

  public seedAdmin(user: VersionedAdminRepositoryRecord): void {
    this.users.set(user.id, Object.freeze({ ...user }));
  }

  public async getAdminByUid(
    uid: string
  ): Promise<VersionedAdminRepositoryRecord | null> {
    this.getAdminCalls += 1;
    if (this.customLookupError) {
      throw this.customLookupError;
    }
    if (this.throwOnLookup) {
      throw new Error('Simulated Firestore AdminRepository lookup outage.');
    }
    const found = this.users.get(uid);
    return found ? Object.freeze({ ...found }) : null;
  }

  public async saveAdmin(_admin: AdminUser): Promise<AdminUser> {
    throw new Error('saveAdmin is forbidden in 01B tests.');
  }
}

interface StoredGcsObjectEntry {
  bytes: Buffer;
  metadata: GcsLibraryQuarantineObjectMetadata;
  generation: string;
}

class InMemoryGenerationPinnedGcsBucket implements GcsLibraryQuarantineBucket {
  public readonly name = 'pop-quarantine-private-bucket';
  private readonly objects = new Map<string, StoredGcsObjectEntry>();
  public saveCallCount = 0;
  public deleteCallCount = 0;
  public getMetadataCallCount = 0;
  public createReadStreamCallCount = 0;
  public throwOnGetMetadata: Error | null = null;
  public throwOnReadStream: Error | null = null;

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

  public mutateStoredObject(
    storagePath: string,
    mutator: (entry: StoredGcsObjectEntry) => void
  ): void {
    const entry = this.objects.get(storagePath);
    if (!entry) {
      throw new Error(`No stored object at ${storagePath}`);
    }
    mutator(entry);
  }

  public removeStoredObject(storagePath: string): void {
    this.objects.delete(storagePath);
  }

  public file(
    objectPath: string,
    options?: GcsLibraryQuarantineFileOptions
  ): GcsLibraryQuarantineFile {
    const self = this;
    const pinnedGen = options?.generation;

    const handle: GcsLibraryQuarantineFile = {
      name: objectPath,
      ...(pinnedGen !== undefined ? { generation: pinnedGen } : {}),
      async save(
        _data: Buffer,
        _saveOptions: GcsLibraryQuarantineSaveOptions
      ): Promise<void> {
        self.saveCallCount += 1;
        throw new Error(
          'GCS file.save() is strictly forbidden during LIB-FILE-REVIEW-01B draft linkage.'
        );
      },
      async getMetadata(): Promise<[GcsLibraryQuarantineObjectMetadata]> {
        self.getMetadataCallCount += 1;
        if (self.throwOnGetMetadata) {
          throw self.throwOnGetMetadata;
        }
        const entry = self.objects.get(objectPath);
        if (!entry) {
          const notFoundErr = new Error(
            `No such object: ${objectPath} (404 Not Found)`
          ) as Error & { code: number };
          notFoundErr.code = 404;
          throw notFoundErr;
        }
        return [deepClone(entry.metadata)];
      },
      createReadStream(): GcsLibraryQuarantineReadableStream {
        self.createReadStreamCallCount += 1;
        const entry = self.objects.get(objectPath);
        const streamErr = self.throwOnReadStream;

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
  public draftUpdateOrDeleteCalls = 0;

  public throwOnPointGet: Error | null = null;
  public onBeforeTransactionReadHook: (() => void | Promise<void>) | null =
    null;
  public onBeforeTransactionCommitHook: (() => void | Promise<void>) | null =
    null;
  public onAfterTransactionCommitHook: (() => void | Promise<void>) | null =
    null;
  public simulateSdkRetryOnceHook: (() => void | Promise<void>) | null = null;

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

  public deleteRawDoc(collectionName: string, docId: string): void {
    this.getCollectionMap(collectionName).delete(docId);
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
    this.draftUpdateOrDeleteCalls = 0;
    this.throwOnPointGet = null;
    this.onBeforeTransactionReadHook = null;
    this.onBeforeTransactionCommitHook = null;
    this.onAfterTransactionCommitHook = null;
    this.simulateSdkRetryOnceHook = null;
  }

  public collection(collectionName: string) {
    const self = this;
    return {
      get(): never {
        throw new Error(
          `Unbounded collection.get() on "${collectionName}" is strictly forbidden.`
        );
      },
      doc(documentId: string): LibraryQuarantineFirestoreDocumentRef & {
        readonly collectionName: string;
      } {
        return {
          id: documentId,
          collectionName,
          async get(): Promise<LibraryQuarantineFirestoreDocumentSnapshot> {
            self.pointGetCalls += 1;
            if (self.throwOnPointGet) {
              throw self.throwOnPointGet;
            }
            const colMap = self.getCollectionMap(collectionName);
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
        };
      },
    };
  }

  public async runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineFirestoreTransaction &
        LibraryQuarantineReviewDraftFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    this.transactionCount += 1;

    const executeSingleAttempt = async (): Promise<{
      result: T;
      stagedCreates: Array<{
        collectionName: string;
        docId: string;
        data: Record<string, unknown>;
      }>;
      readVersions: Array<{
        collectionName: string;
        docId: string;
        snapshotJson: string | null;
      }>;
    }> => {
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
          throw new Error(
            'transaction.set() is strictly forbidden in LIB-FILE-REVIEW-01B; only transaction.create() is allowed for drafts.'
          );
        },
      };

      const result = await updateFunction(tx);
      return { result, stagedCreates, readVersions };
    };

    let attemptOutcome = await executeSingleAttempt();

    if (this.simulateSdkRetryOnceHook) {
      const retryHook = this.simulateSdkRetryOnceHook;
      this.simulateSdkRetryOnceHook = null;
      await retryHook();
      attemptOutcome = await executeSingleAttempt();
    }

    if (this.onBeforeTransactionCommitHook) {
      const commitHook = this.onBeforeTransactionCommitHook;
      this.onBeforeTransactionCommitHook = null;
      await commitHook();
    }

    // Verify optimistic concurrency on all read documents before committing staged creates
    for (const readRec of attemptOutcome.readVersions) {
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

    // Apply staged creates (verifying target still does not exist)
    for (const createOp of attemptOutcome.stagedCreates) {
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

    return attemptOutcome.result;
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
  const createdAt = options.createdAt ?? '2026-11-08T09:00:00.000Z';
  const writePendingAt = '2026-11-08T09:01:00.000Z';
  const updatedAt = options.updatedAt ?? '2026-11-08T09:02:00.000Z';
  const generation = options.generation ?? '1731072000998877';
  const revision = options.revision ?? 3;

  const bytes =
    options.format === 'PDF'
      ? makeValidPdfBuffer(`PDF Fixture ${generation}`)
      : makeValidDocxBuffer(`DOCX Fixture ${generation}`);
  const filename =
    options.format === 'PDF'
      ? 'IPCC_Water_Balance_2026.pdf'
      : 'UN_Biodiversity_Assessment_2026.docx';
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
    assert.fail(reservedRes.errorMessage);
  }

  const pendingRes = beginLibraryQuarantineWritePending({
    receipt: reservedRes.receipt,
    actorUid: uploaderUid,
    nowIso: writePendingAt,
  });
  if (!pendingRes.ok) {
    assert.fail(pendingRes.errorMessage);
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
    assert.fail(confirmedRes.errorMessage);
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

function assertZeroPrivateOrUrlLeakage(
  serializedJson: string,
  contextLabel: string,
  forbiddenLiterals: readonly string[]
): void {
  const lower = serializedJson.toLowerCase();
  assert.equal(
    lower.includes('library/quarantine/'),
    false,
    `${contextLabel}: must not leak library/quarantine/ path`
  );
  assert.equal(
    lower.includes('storagepath'),
    false,
    `${contextLabel}: must not contain storagePath key`
  );
  assert.equal(
    lower.includes('"generation"'),
    false,
    `${contextLabel}: must not contain generation key`
  );
  assert.equal(
    lower.includes('attestedgeneration'),
    false,
    `${contextLabel}: must not contain attestedGeneration key`
  );
  assert.equal(
    lower.includes('"attestation"'),
    false,
    `${contextLabel}: must not contain attestation key`
  );
  assert.equal(
    lower.includes('gs://'),
    false,
    `${contextLabel}: must not contain gs:// URI`
  );
  assert.equal(
    lower.includes('http://') || lower.includes('https://'),
    false,
    `${contextLabel}: must not contain http/https URL`
  );
  assert.equal(
    lower.includes('signedurl') || lower.includes('downloadtoken'),
    false,
    `${contextLabel}: must not contain signedUrl or downloadToken`
  );
  for (const literal of forbiddenLiterals) {
    if (literal.length > 0) {
      assert.equal(
        serializedJson.includes(literal),
        false,
        `${contextLabel}: must not leak literal "${literal}"`
      );
    }
  }
}

async function runTests(): Promise<void> {
  console.log(
    'Running LIB-FILE-REVIEW-01B/R1 durable quarantine review draft persistence tests...'
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
  // PASS 1: Valid PDF and DOCX durable review draft creation across authorized
  //         human Library roles (Owner, LibraryCurator, RightsReviewer) via
  //         request-scoped server principal provider and {receiptId}-only input
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const principalProvider = new InMemoryTrustedPrincipalProviderDouble({
      uid: 'admin_curator_01',
    });
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const receiptStore = new FirestoreLibraryQuarantineReceiptStore(db);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-08T10:30:00.000Z',
    });
    const draftStore = new FirestoreLibraryQuarantineReviewDraftStore(db);
    const service = new LibraryQuarantineReviewDraftPersistenceService({
      trustedPrincipalProvider: principalProvider,
      adminRepository: adminRepo,
      receiptStore,
      storageReadbackPort: gcsAdapter,
      draftStore,
      clock: () => '2026-11-08T10:30:00.000Z',
    });

    const pdfFix = createVerifiedQuarantinedFixture({
      format: 'PDF',
      revision: 3,
      generation: '1731072000111222',
    });
    const docxFix = createVerifiedQuarantinedFixture({
      format: 'DOCX',
      revision: 4,
      generation: '1731072000333444',
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
    const pdfRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: pdfFix.receipt.receiptId,
    });

    if (!pdfRes.ok) {
      assert.fail(pdfRes.errorMessage);
    }
    assert.equal(pdfRes.status, 'LINKED_PENDING_HUMAN_REVIEW');
    assert.equal(pdfRes.disposition, 'CREATED');
    assert.equal(pdfRes.draftCreationOutcome, 'CREATED');
    assert.equal(pdfRes.created, true);
    assert.equal(pdfRes.draftCreated, true);
    assert.equal(pdfRes.receiptId, pdfFix.receipt.receiptId);
    assert.equal(pdfRes.sourceRevision, 3);
    assert.equal(pdfRes.gcsVerifyAttempted, true);
    assert.equal(pdfRes.gcsSaveAttempted, false);
    assert.equal(pdfRes.transactionAttempted, true);
    assert.equal(pdfRes.receiptMutated, false);
    assert.equal(pdfRes.bucketIamPrivacyVerified, false);
    assert.equal(pdfRes.isSanitized, false);
    assert.equal(pdfRes.isVerifiedSafe, false);
    assert.equal(pdfRes.isRightsApproved, false);
    assert.equal(pdfRes.isPublished, false);
    assert.equal(pdfRes.isReadyForPeia, false);
    assert.deepEqual(
      pdfRes.remainingDeferredGates,
      LIBRARY_QUARANTINE_REVIEW_DRAFT_REMAINING_GATES
    );

    // Verify bounded operation budgets for single PDF link call
    assert.equal(db.pointGetCalls, 1, 'Exactly 1 pre-GCS source receipt point read');
    assert.equal(bucket.getMetadataCallCount, 1, 'Exactly 1 GCS getMetadata call');
    assert.equal(
      bucket.createReadStreamCallCount,
      1,
      'Exactly 1 generation-pinned GCS stream readback'
    );
    assert.equal(bucket.saveCallCount, 0, 'Zero GCS save calls');
    assert.equal(bucket.deleteCallCount, 0, 'Zero GCS delete calls');
    assert.equal(db.transactionCount, 1, 'Exactly 1 Firestore transaction');
    assert.equal(
      db.receiptGetCallsInTx,
      1,
      'Exactly 1 source receipt read inside transaction'
    );
    assert.equal(
      db.draftGetCallsInTx,
      1,
      'Exactly 1 draft read inside transaction'
    );
    assert.equal(
      db.draftCreateCalls,
      1,
      'Exactly 1 transaction.create on draft collection'
    );
    assert.equal(db.draftSetCalls, 0, 'Zero transaction.set calls');
    assert.equal(db.receiptWriteCalls, 0, 'Zero source receipt mutations');

    // Verify persisted draft schema and exact 15 keys
    const rawPersistedPdfDraft = db.getRawDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      pdfFix.receipt.receiptId
    ) as Record<string, unknown>;
    assert.ok(rawPersistedPdfDraft, 'Persisted PDF draft must exist at documentId=receiptId');
    assert.deepEqual(
      Object.keys(rawPersistedPdfDraft).sort(),
      [
        'createdAt',
        'createdBy',
        'format',
        'isPublished',
        'isReadyForPeia',
        'isRightsApproved',
        'isSanitized',
        'isVerifiedSafe',
        'receiptId',
        'reviewState',
        'schemaVersion',
        'sourceRevision',
        'sourceSha256',
        'sourceUpdatedAt',
        'uploaderUid',
      ],
      'Persisted draft must contain the exact 15 allowed keys and nothing else'
    );
    assert.equal(
      rawPersistedPdfDraft.schemaVersion,
      LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION
    );
    assert.equal(rawPersistedPdfDraft.receiptId, pdfFix.receipt.receiptId);
    assert.equal(rawPersistedPdfDraft.sourceRevision, 3);
    assert.equal(rawPersistedPdfDraft.sourceUpdatedAt, pdfFix.receipt.updatedAt);
    assert.equal(rawPersistedPdfDraft.sourceSha256, pdfFix.receipt.sha256);
    assert.equal(rawPersistedPdfDraft.format, 'PDF');
    assert.equal(rawPersistedPdfDraft.uploaderUid, pdfFix.receipt.uploaderUid);
    assert.equal(
      rawPersistedPdfDraft.reviewState,
      LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE
    );
    assert.equal(rawPersistedPdfDraft.createdBy, 'admin_curator_01');
    assert.equal(rawPersistedPdfDraft.createdAt, '2026-11-08T10:30:00.000Z');

    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(pdfRes),
      'PDF success response',
      [pdfFix.receipt.storagePath, pdfFix.receipt.generation ?? '']
    );
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(rawPersistedPdfDraft),
      'PDF persisted Firestore draft',
      [pdfFix.receipt.storagePath, pdfFix.receipt.generation ?? '']
    );

    // Point lookup via draftStore.getReviewDraftByReceiptId
    const lookupRes = await draftStore.getReviewDraftByReceiptId(
      pdfFix.receipt.receiptId
    );
    assert.equal(lookupRes.ok, true);
    if (lookupRes.ok) {
      assert.deepEqual(lookupRes.draft, pdfRes.draft);
    }

    // Create DOCX review draft via RightsReviewer role
    db.resetCounters();
    principalProvider.setPrincipal({ uid: 'admin_rights_01' });
    const docxRes = await service.createOrGetQuarantineReviewDraft({
      receiptId: docxFix.receipt.receiptId,
    });
    if (!docxRes.ok) {
      assert.fail(docxRes.errorMessage);
    }
    assert.equal(docxRes.disposition, 'CREATED');
    assert.equal(docxRes.draftCreationOutcome, 'CREATED');
    assert.equal(docxRes.created, true);
    assert.equal(docxRes.draftCreated, true);
    assert.equal(docxRes.draft.format, 'DOCX');
    assert.equal(docxRes.draft.sourceRevision, 4);
    assert.equal(docxRes.draft.createdBy, 'admin_rights_01');
    assert.equal(db.receiptWriteCalls, 0);

    console.log(
      'PASS 1: Valid Quarantined PDF and DOCX create durable PENDING_HUMAN_REVIEW drafts with exact 15-field schema, zero receipt mutation, and zero secret leakage.'
    );
  }

  // =========================================================================
  // PASS 2: R1-A Trusted server principal boundary & R1-B Zero secret echo
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const principalProvider = new InMemoryTrustedPrincipalProviderDouble({
      uid: 'admin_viewer_01',
    });
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const receiptStore = new FirestoreLibraryQuarantineReceiptStore(db);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-08T10:35:00.000Z',
    });
    const draftStore = new FirestoreLibraryQuarantineReviewDraftStore(db);

    // Constructor rejects missing trustedPrincipalProvider
    assert.throws(() => {
      new LibraryQuarantineReviewDraftPersistenceService({
        trustedPrincipalProvider:
          null as unknown as TrustedQuarantineReviewerPrincipalProvider,
        adminRepository: adminRepo,
        receiptStore,
        storageReadbackPort: gcsAdapter,
        draftStore,
      });
    }, /INVALID_SERVICE_DEPENDENCY/);

    const service = new LibraryQuarantineReviewDraftPersistenceService({
      trustedPrincipalProvider: principalProvider,
      adminRepository: adminRepo,
      receiptStore,
      storageReadbackPort: gcsAdapter,
      draftStore,
      clock: () => '2026-11-08T10:35:00.000Z',
    });

    const pdfFix = createVerifiedQuarantinedFixture({ format: 'PDF' });
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      pdfFix.receipt.receiptId,
      pdfFix.envelope
    );
    bucket.seedVerifiedQuarantineObject(pdfFix.receipt, pdfFix.bytes);

    // 2A: Caller-supplied auth/uid/role/candidate/generation/isAuthorized fields are rejected
    //     BEFORE trustedPrincipalProvider, AdminRepository, receiptStore, or GCS access,
    //     including when an authenticated Viewer attempts to claim Owner UID!
    const callerSpoofPayloads: unknown[] = [
      {
        receiptId: pdfFix.receipt.receiptId,
        auth: { uid: 'admin_owner_01' },
      },
      {
        receiptId: pdfFix.receipt.receiptId,
        uid: 'admin_owner_01',
      },
      {
        receiptId: pdfFix.receipt.receiptId,
        role: AdminRole.Owner,
      },
      {
        receiptId: pdfFix.receipt.receiptId,
        isAuthorized: true,
      },
      {
        receiptId: pdfFix.receipt.receiptId,
        candidate: {},
      },
      {
        receiptId: pdfFix.receipt.receiptId,
        generation: pdfFix.receipt.generation,
      },
      {
        receiptId: pdfFix.receipt.receiptId,
        storagePath: pdfFix.receipt.storagePath,
      },
      {
        receiptId: pdfFix.receipt.receiptId,
        token: { uid: 'admin_owner_01', role: AdminRole.Owner },
      },
      {
        receiptId: pdfFix.receipt.receiptId,
        SECRET_ATTACKER_KEY_2026: 'SPOOF_ATTEMPT_VALUE_2026',
      },
    ];

    db.resetCounters();
    principalProvider.resolveCalls = 0;
    adminRepo.getAdminCalls = 0;

    for (const spoofPayload of callerSpoofPayloads) {
      const res = await service.linkQuarantineReceiptToReviewDraft(spoofPayload);
      if (res.ok) {
        assert.fail('Expected caller-supplied extra field payload to HOLD');
      }
      assert.equal(res.status, 'HOLD');
      assert.equal(res.holdReasonCode, 'UNTRUSTED_CALLER_FIELD_HOLD');
      assert.equal(res.gcsVerifyAttempted, false);
      assert.equal(res.transactionAttempted, false);
      assert.equal(res.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(res.draftCreated, false);
      assertZeroPrivateOrUrlLeakage(
        JSON.stringify(res),
        'Caller spoof payload rejection',
        [
          'SECRET_ATTACKER_KEY_2026',
          'SPOOF_ATTEMPT_VALUE_2026',
          'admin_owner_01',
          pdfFix.receipt.storagePath,
          pdfFix.receipt.generation ?? '',
        ]
      );
    }

    assert.equal(
      principalProvider.resolveCalls,
      0,
      'Caller-supplied extra fields must be rejected before resolving server principal'
    );
    assert.equal(
      adminRepo.getAdminCalls,
      0,
      'Caller-supplied extra fields must be rejected before calling AdminRepository'
    );
    assert.equal(db.pointGetCalls, 0);
    assert.equal(bucket.getMetadataCallCount, 0);

    // 2B: Server principal provider variations (unauthenticated, malformed, AI/automated, non-Library roles, Viewer with forged token claim)
    const unauthorizedPrincipals: Array<TrustedQuarantineAuthenticatedPrincipal | null> =
      [
        null,
        { uid: '' },
        { uid: '   ' },
        { uid: 'bad/uid/with/slashes' },
        { uid: 'unknown_user_999' },
        { uid: 'admin_inactive_curator' },
        { uid: 'admin_ai_assistant' },
        { uid: 'admin_owner_01', token: { ai: true } },
        { uid: 'admin_owner_01', token: { isAIAssistant: true } },
        { uid: 'admin_owner_01', token: { automated: true } },
        { uid: 'admin_owner_01', token: { isAuthorized: true } },
        { uid: 'admin_content_editor' },
        { uid: 'admin_training_mgr' },
        { uid: 'admin_viewer_01' },
        // Authenticated Viewer with forged Owner claim in token -> still rejected via authoritative AdminRepository
        {
          uid: 'admin_viewer_01',
          token: { role: AdminRole.Owner, admin: true },
        },
        // Unexpected property on principal object
        {
          uid: 'admin_owner_01',
          isAuthorized: true,
        } as unknown as TrustedQuarantineAuthenticatedPrincipal,
      ];

    for (const principal of unauthorizedPrincipals) {
      principalProvider.setPrincipal(principal);
      const res = await service.linkQuarantineReceiptToReviewDraft({
        receiptId: pdfFix.receipt.receiptId,
      });
      if (res.ok) {
        assert.fail('Expected unauthorized server principal to HOLD');
      }
      assert.equal(res.status, 'HOLD');
      assert.equal(res.holdReasonCode, 'UNAUTHORIZED_REVIEWER_HOLD');
      assert.equal(res.gcsVerifyAttempted, false);
      assert.equal(res.transactionAttempted, false);
      assert.equal(res.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(res.draftCreated, false);
    }

    assert.equal(
      db.pointGetCalls,
      0,
      'Unauthorized principals must perform 0 Firestore receipt reads'
    );
    assert.equal(
      bucket.getMetadataCallCount,
      0,
      'Unauthorized principals must perform 0 GCS metadata probes'
    );
    assert.equal(
      bucket.createReadStreamCallCount,
      0,
      'Unauthorized principals must perform 0 GCS stream probes'
    );
    assert.equal(
      db.transactionCount,
      0,
      'Unauthorized principals must perform 0 Firestore transactions'
    );
    assert.equal(
      db.draftCreateCalls,
      0,
      'Unauthorized principals must perform 0 draft writes'
    );

    // 2C: R1-B Sentinel secret injection across ALL dependency boundaries
    const secretSentinel = 'INTERNAL_SECRET_MARKER_2026__NOT_FOR_CLIENT_9f8e7d6c';
    const privatePathLiteral = pdfFix.receipt.storagePath;
    const generationLiteral = pdfFix.receipt.generation ?? '1731072000998877';
    const signedUrlLiteral =
      'https://storage.googleapis.com/pop-quarantine-private-bucket/secret?X-Goog-Signature=deadbeef';
    const combinedPoison = `${secretSentinel} path=${privatePathLiteral} gen=${generationLiteral} url=${signedUrlLiteral}`;
    const forbiddenSentinels = [
      secretSentinel,
      privatePathLiteral,
      generationLiteral,
      signedUrlLiteral,
      'X-Goog-Signature',
      'deadbeef',
    ];

    // Sentinel 1: trustedPrincipalProvider throws Error with sentinel
    principalProvider.throwOnResolve = new Error(combinedPoison);
    const providerErrRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: pdfFix.receipt.receiptId,
    });
    principalProvider.throwOnResolve = null;
    assert.equal(providerErrRes.ok, false);
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(providerErrRes),
      'Principal provider exception sentinel check',
      forbiddenSentinels
    );

    // Sentinel 2: AdminRepository throws Error with sentinel
    principalProvider.setPrincipal({ uid: 'admin_owner_01' });
    adminRepo.customLookupError = new Error(combinedPoison);
    const adminErrRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: pdfFix.receipt.receiptId,
    });
    adminRepo.customLookupError = null;
    assert.equal(adminErrRes.ok, false);
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(adminErrRes),
      'AdminRepository exception sentinel check',
      forbiddenSentinels
    );

    // Sentinel 3: receiptStore throws Error with sentinel AND returns failure with sentinel
    const receiptThrowService = new LibraryQuarantineReviewDraftPersistenceService({
      trustedPrincipalProvider: principalProvider,
      adminRepository: adminRepo,
      receiptStore: {
        async getReceiptById() {
          throw new Error(combinedPoison);
        },
      },
      storageReadbackPort: gcsAdapter,
      draftStore,
      clock: () => '2026-11-08T10:35:00.000Z',
    });
    const receiptThrowRes =
      await receiptThrowService.linkQuarantineReceiptToReviewDraft({
        receiptId: pdfFix.receipt.receiptId,
      });
    assert.equal(receiptThrowRes.ok, false);
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(receiptThrowRes),
      'receiptStore thrown exception sentinel check',
      forbiddenSentinels
    );

    const receiptFailDtoService =
      new LibraryQuarantineReviewDraftPersistenceService({
        trustedPrincipalProvider: principalProvider,
        adminRepository: adminRepo,
        receiptStore: {
          async getReceiptById() {
            return {
              ok: false as const,
              errorCode: 'TRANSACTION_FAILURE' as const,
              errorMessage: combinedPoison,
            };
          },
        },
        storageReadbackPort: gcsAdapter,
        draftStore,
        clock: () => '2026-11-08T10:35:00.000Z',
      });
    const receiptFailDtoRes =
      await receiptFailDtoService.linkQuarantineReceiptToReviewDraft({
        receiptId: pdfFix.receipt.receiptId,
      });
    assert.equal(receiptFailDtoRes.ok, false);
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(receiptFailDtoRes),
      'receiptStore failure DTO sentinel check',
      forbiddenSentinels
    );

    // Sentinel 4: GCS readback port throws Error with sentinel AND returns failure with sentinel
    bucket.throwOnGetMetadata = new Error(combinedPoison);
    const gcsThrowRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: pdfFix.receipt.receiptId,
    });
    bucket.throwOnGetMetadata = null;
    assert.equal(gcsThrowRes.ok, false);
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(gcsThrowRes),
      'GCS getMetadata thrown exception sentinel check',
      forbiddenSentinels
    );

    const gcsDirectThrowService =
      new LibraryQuarantineReviewDraftPersistenceService({
        trustedPrincipalProvider: principalProvider,
        adminRepository: adminRepo,
        receiptStore,
        storageReadbackPort: {
          async verifyExistingQuarantineObject() {
            throw new Error(combinedPoison);
          },
        },
        draftStore,
        clock: () => '2026-11-08T10:35:00.000Z',
      });
    const gcsDirectThrowRes =
      await gcsDirectThrowService.linkQuarantineReceiptToReviewDraft({
        receiptId: pdfFix.receipt.receiptId,
      });
    assert.equal(gcsDirectThrowRes.ok, false);
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(gcsDirectThrowRes),
      'storageReadbackPort thrown exception sentinel check',
      forbiddenSentinels
    );

    // Sentinel 5: draftStore and Firestore SDK throw Error with sentinel
    db.onBeforeTransactionCommitHook = () => {
      throw new Error(combinedPoison);
    };
    const txSentinelRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: pdfFix.receipt.receiptId,
    });
    assert.equal(txSentinelRes.ok, false);
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(txSentinelRes),
      'Firestore transaction exception sentinel check',
      forbiddenSentinels
    );

    db.throwOnPointGet = new Error(combinedPoison);
    const directStoreLookupRes = await draftStore.getReviewDraftByReceiptId(
      pdfFix.receipt.receiptId
    );
    db.throwOnPointGet = null;
    assert.equal(directStoreLookupRes.ok, false);
    assertZeroPrivateOrUrlLeakage(
      JSON.stringify(directStoreLookupRes),
      'Direct draftStore.getReviewDraftByReceiptId exception sentinel check',
      forbiddenSentinels
    );

    console.log(
      'PASS 2: R1-A request-scoped server principal boundary and R1-B zero secret/sentinel exception leakage verified.'
    );
  }

  // =========================================================================
  // PASS 3: Non-Quarantined states (Reserved, WritePending, NeedsReconciliation,
  //         Rejected) and corrupted/escalated receipts HOLD before GCS access
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const principalProvider = new InMemoryTrustedPrincipalProviderDouble({
      uid: 'admin_owner_01',
    });
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const receiptStore = new FirestoreLibraryQuarantineReceiptStore(db);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-08T10:40:00.000Z',
    });
    const draftStore = new FirestoreLibraryQuarantineReviewDraftStore(db);
    const service = new LibraryQuarantineReviewDraftPersistenceService({
      trustedPrincipalProvider: principalProvider,
      adminRepository: adminRepo,
      receiptStore,
      storageReadbackPort: gcsAdapter,
      draftStore,
      clock: () => '2026-11-08T10:40:00.000Z',
    });

    const uploaderUid = 'uploader_scientist_02';
    const pdfBytes = makeValidPdfBuffer('State Hold Test');

    // 1. Reserved receipt
    const resReserved = reserveLibraryQuarantineReceipt({
      uploaderUid,
      originalFilename: 'state-test.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: pdfBytes,
      nowIso: '2026-11-08T09:00:00.000Z',
    });
    if (!resReserved.ok) assert.fail(resReserved.errorMessage);

    // 2. WritePending receipt
    const resPending = beginLibraryQuarantineWritePending({
      receipt: resReserved.receipt,
      actorUid: uploaderUid,
      nowIso: '2026-11-08T09:01:00.000Z',
    });
    if (!resPending.ok) assert.fail(resPending.errorMessage);

    // 3. NeedsReconciliation receipt
    const resRecon = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: resPending.receipt,
      actorUid: uploaderUid,
      reconciliationReason:
        'GCS conditional write outcome was ambiguous during upload.',
      nowIso: '2026-11-08T09:02:00.000Z',
    });
    if (!resRecon.ok) assert.fail(resRecon.errorMessage);

    // 4. Rejected receipt
    const resRejected = rejectLibraryQuarantineReceipt({
      receipt: resRecon.receipt,
      actorUid: uploaderUid,
      rejectionReasonCode: 'QUARANTINE_OBJECT_MISSING',
      nowIso: '2026-11-08T09:03:00.000Z',
    });
    if (!resRejected.ok) assert.fail(resRejected.errorMessage);

    const checkNonQuarantinedHold = async (
      envelope: unknown,
      receiptId: string,
      expectedHoldCode: string
    ): Promise<void> => {
      db.seedRawDoc(LIBRARY_QUARANTINE_RECEIPT_COLLECTION, receiptId, envelope);
      const outcome = await service.linkQuarantineReceiptToReviewDraft({
        receiptId,
      });
      if (outcome.ok) {
        assert.fail(`Expected HOLD for ${expectedHoldCode}`);
      }
      assert.equal(outcome.status, 'HOLD');
      assert.equal(outcome.holdReasonCode, expectedHoldCode);
      assert.equal(outcome.gcsVerifyAttempted, false);
      assert.equal(outcome.transactionAttempted, false);
      assert.equal(outcome.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(outcome.draftCreated, false);
    };

    // Missing receipt
    const missingId = 'f'.repeat(32);
    const missingOutcome = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: missingId,
    });
    assert.equal(missingOutcome.ok, false);
    if (!missingOutcome.ok) {
      assert.equal(
        missingOutcome.holdReasonCode,
        'SOURCE_RECEIPT_NOT_FOUND_HOLD'
      );
      assert.equal(missingOutcome.gcsVerifyAttempted, false);
      assert.equal(missingOutcome.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(missingOutcome.draftCreated, false);
    }

    await checkNonQuarantinedHold(
      {
        schemaVersion: 1,
        revision: 1,
        state: LibraryQuarantineReceiptState.Reserved,
        receipt: resReserved.receipt,
      },
      resReserved.receipt.receiptId,
      'SOURCE_STATE_NOT_ELIGIBLE_HOLD'
    );

    await checkNonQuarantinedHold(
      {
        schemaVersion: 1,
        revision: 2,
        state: LibraryQuarantineReceiptState.WritePending,
        receipt: resPending.receipt,
      },
      resPending.receipt.receiptId,
      'SOURCE_STATE_NOT_ELIGIBLE_HOLD'
    );

    await checkNonQuarantinedHold(
      {
        schemaVersion: 1,
        revision: 3,
        state: LibraryQuarantineReceiptState.NeedsReconciliation,
        receipt: resRecon.receipt,
      },
      resRecon.receipt.receiptId,
      'NEEDS_RECONCILIATION_HOLD'
    );

    await checkNonQuarantinedHold(
      {
        schemaVersion: 1,
        revision: 4,
        state: LibraryQuarantineReceiptState.Rejected,
        receipt: resRejected.receipt,
      },
      resRejected.receipt.receiptId,
      'SOURCE_STATE_NOT_ELIGIBLE_HOLD'
    );

    // Forged true security flag in persisted receipt
    const forgedFix = createVerifiedQuarantinedFixture({ format: 'PDF' });
    await checkNonQuarantinedHold(
      {
        ...forgedFix.envelope,
        receipt: {
          ...forgedFix.receipt,
          isRightsApproved: true,
        },
      },
      forgedFix.receipt.receiptId,
      'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD'
    );

    // Non-canonical generation on Quarantined receipt (e.g. non-numeric string)
    await checkNonQuarantinedHold(
      {
        ...forgedFix.envelope,
        receipt: {
          ...forgedFix.receipt,
          generation: 'gen-non-decimal-99',
        },
      },
      forgedFix.receipt.receiptId,
      'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD'
    );

    assert.equal(
      bucket.getMetadataCallCount,
      0,
      'Non-Quarantined and corrupted receipts must perform 0 GCS probes'
    );
    assert.equal(
      db.transactionCount,
      0,
      'Non-Quarantined and corrupted receipts must perform 0 Firestore transactions'
    );

    console.log(
      'PASS 3: Missing, Reserved, WritePending, NeedsReconciliation, Rejected, and corrupted/escalated receipts HOLD before touching GCS.'
    );
  }

  // =========================================================================
  // PASS 4: Generation-pinned GCS readback & attestation mismatch holds
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const principalProvider = new InMemoryTrustedPrincipalProviderDouble({
      uid: 'admin_owner_01',
    });
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const receiptStore = new FirestoreLibraryQuarantineReceiptStore(db);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-08T10:45:00.000Z',
    });
    const draftStore = new FirestoreLibraryQuarantineReviewDraftStore(db);
    const service = new LibraryQuarantineReviewDraftPersistenceService({
      trustedPrincipalProvider: principalProvider,
      adminRepository: adminRepo,
      receiptStore,
      storageReadbackPort: gcsAdapter,
      draftStore,
      clock: () => '2026-11-08T10:45:00.000Z',
    });

    const fix = createVerifiedQuarantinedFixture({
      format: 'PDF',
      generation: '1731072000555666',
    });
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );

    // 4A: Object missing in GCS
    const missingObjRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fix.receipt.receiptId,
    });
    assert.equal(missingObjRes.ok, false);
    if (!missingObjRes.ok) {
      assert.equal(
        missingObjRes.holdReasonCode,
        'GCS_READBACK_UNVERIFIED_HOLD'
      );
      assert.equal(missingObjRes.gcsVerifyAttempted, true);
      assert.equal(missingObjRes.transactionAttempted, false);
      assert.equal(missingObjRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(missingObjRes.draftCreated, false);
      assertZeroPrivateOrUrlLeakage(
        JSON.stringify(missingObjRes),
        'Missing GCS object hold',
        [fix.receipt.storagePath, fix.receipt.generation ?? '']
      );
    }

    // 4B: Stored object has different generation than receipt.generation
    bucket.seedVerifiedQuarantineObject(
      fix.receipt,
      fix.bytes,
      '1731072000999999'
    );
    const genDriftRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fix.receipt.receiptId,
    });
    assert.equal(genDriftRes.ok, false);
    if (!genDriftRes.ok) {
      assert.equal(genDriftRes.holdReasonCode, 'GCS_ATTESTATION_MISMATCH_HOLD');
      assert.equal(genDriftRes.gcsVerifyAttempted, true);
      assert.equal(genDriftRes.transactionAttempted, false);
      assert.equal(genDriftRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(genDriftRes.draftCreated, false);
      assertZeroPrivateOrUrlLeakage(
        JSON.stringify(genDriftRes),
        'Generation mismatch hold',
        [
          fix.receipt.storagePath,
          fix.receipt.generation ?? '',
          '1731072000999999',
        ]
      );
    }

    // 4C: Stored object has modified bytes (SHA-256 mismatch)
    bucket.seedVerifiedQuarantineObject(fix.receipt, fix.bytes);
    bucket.mutateStoredObject(fix.receipt.storagePath, (entry) => {
      const tampered = Buffer.from(entry.bytes);
      tampered[tampered.length - 1] ^= 0xff;
      entry.bytes = tampered;
    });
    const shaMismatchRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fix.receipt.receiptId,
    });
    assert.equal(shaMismatchRes.ok, false);
    if (!shaMismatchRes.ok) {
      assert.equal(
        shaMismatchRes.holdReasonCode,
        'GCS_READBACK_UNVERIFIED_HOLD'
      );
      assert.equal(shaMismatchRes.transactionAttempted, false);
      assert.equal(shaMismatchRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(shaMismatchRes.draftCreated, false);
    }

    // 4D: Stored object has firebaseStorageDownloadTokens (public exposure)
    bucket.seedVerifiedQuarantineObject(fix.receipt, fix.bytes, undefined, {
      firebaseStorageDownloadTokens: 'secret-token-12345',
    });
    const tokenExposedRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fix.receipt.receiptId,
    });
    assert.equal(tokenExposedRes.ok, false);
    if (!tokenExposedRes.ok) {
      assert.equal(
        tokenExposedRes.holdReasonCode,
        'GCS_READBACK_UNVERIFIED_HOLD'
      );
      assert.equal(tokenExposedRes.transactionAttempted, false);
      assert.equal(tokenExposedRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(tokenExposedRes.draftCreated, false);
    }

    // 4E: GCS stream interrupted during readback (NEEDS_RECONCILIATION from adapter)
    bucket.seedVerifiedQuarantineObject(fix.receipt, fix.bytes);
    bucket.throwOnReadStream = new Error(
      `Stream reset while reading ${fix.receipt.storagePath}`
    );
    const streamInterruptedRes =
      await service.linkQuarantineReceiptToReviewDraft({
        receiptId: fix.receipt.receiptId,
      });
    bucket.throwOnReadStream = null;
    assert.equal(streamInterruptedRes.ok, false);
    if (!streamInterruptedRes.ok) {
      assert.equal(
        streamInterruptedRes.holdReasonCode,
        'GCS_READBACK_UNVERIFIED_HOLD'
      );
      assert.equal(streamInterruptedRes.transactionAttempted, false);
      assert.equal(streamInterruptedRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(streamInterruptedRes.draftCreated, false);
      assertZeroPrivateOrUrlLeakage(
        JSON.stringify(streamInterruptedRes),
        'Interrupted stream hold',
        [fix.receipt.storagePath, fix.receipt.generation ?? '']
      );
    }

    // 4F: Custom attestation port returning individual field mismatches
    const baseAttestation: TrustedStorageReadbackAttestation = {
      attestedReceiptId: fix.receipt.receiptId,
      attestedUploaderUid: fix.receipt.uploaderUid,
      attestedStoragePath: fix.receipt.storagePath,
      attestedFormat: fix.receipt.format,
      attestedContentType: fix.receipt.canonicalMimeType,
      attestedByteSize: fix.receipt.byteSize,
      attestedSha256: fix.receipt.sha256,
      attestedGeneration: fix.receipt.generation ?? '1731072000555666',
      verifiedAtIso: '2026-11-08T10:45:00.000Z',
    };

    const tamperedAttestations: Array<Partial<TrustedStorageReadbackAttestation>> =
      [
        { attestedReceiptId: '0'.repeat(32) },
        { attestedUploaderUid: 'different_uploader' },
        {
          attestedStoragePath: `library/quarantine/${'0'.repeat(32)}/source.pdf`,
        },
        { attestedFormat: 'DOCX' },
        { attestedContentType: CANONICAL_DOCX_MIME_TYPE },
        { attestedByteSize: fix.receipt.byteSize + 1 },
        { attestedSha256: 'b'.repeat(64) },
        { attestedGeneration: '1731072000777888' },
      ];

    for (const override of tamperedAttestations) {
      let portCalls = 0;
      const customService = new LibraryQuarantineReviewDraftPersistenceService({
        trustedPrincipalProvider: principalProvider,
        adminRepository: adminRepo,
        receiptStore,
        storageReadbackPort: {
          async verifyExistingQuarantineObject(
            _input: VerifyExistingLibraryQuarantineObjectInput
          ): Promise<LibraryQuarantineGcsAdapterResult> {
            portCalls += 1;
            return {
              ok: true,
              status: 'EXISTING_VERIFIED',
              createdNewObject: false,
              receiptId: fix.receipt.receiptId,
              attestation: {
                ...baseAttestation,
                ...override,
              },
              bucketIamPrivacyVerified: false,
              isSanitized: false,
              isVerifiedSafe: false,
              isRightsApproved: false,
              isPublished: false,
              isReadyForPeia: false,
            };
          },
        },
        draftStore,
        clock: () => '2026-11-08T10:45:00.000Z',
      });

      const attRes = await customService.linkQuarantineReceiptToReviewDraft({
        receiptId: fix.receipt.receiptId,
      });
      assert.equal(portCalls, 1);
      assert.equal(attRes.ok, false);
      if (!attRes.ok) {
        assert.equal(attRes.holdReasonCode, 'GCS_ATTESTATION_MISMATCH_HOLD');
        assert.equal(attRes.transactionAttempted, false);
        assert.equal(attRes.draftCreationOutcome, 'NOT_CREATED');
        assert.equal(attRes.draftCreated, false);
      }
    }

    assert.equal(
      db.transactionCount,
      0,
      'All GCS readback / attestation failures must stop before starting any Firestore transaction'
    );
    assert.equal(db.draftCreateCalls, 0);

    console.log(
      'PASS 4: All GCS readback failures, public exposure flags, and every attested field mismatch fail closed before starting a Firestore transaction.'
    );
  }

  // =========================================================================
  // PASS 5: Atomic Firestore source guard & concurrent source mutation (TOCTOU)
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const principalProvider = new InMemoryTrustedPrincipalProviderDouble({
      uid: 'admin_curator_01',
    });
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const receiptStore = new FirestoreLibraryQuarantineReceiptStore(db);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-08T10:50:00.000Z',
    });
    const draftStore = new FirestoreLibraryQuarantineReviewDraftStore(db);
    const service = new LibraryQuarantineReviewDraftPersistenceService({
      trustedPrincipalProvider: principalProvider,
      adminRepository: adminRepo,
      receiptStore,
      storageReadbackPort: gcsAdapter,
      draftStore,
      clock: () => '2026-11-08T10:50:00.000Z',
    });

    const fix = createVerifiedQuarantinedFixture({
      format: 'PDF',
      revision: 3,
      generation: '1731072000777111',
    });
    bucket.seedVerifiedQuarantineObject(fix.receipt, fix.bytes);

    // 5A: Source revision mutated between GCS readback and Firestore transaction
    //     (contractually aborted inside callback before transaction.create -> NOT_CREATED)
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    db.resetCounters();
    db.onBeforeTransactionReadHook = () => {
      db.seedRawDoc(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        fix.receipt.receiptId,
        {
          ...fix.envelope,
          revision: 4,
        }
      );
    };

    const revMutatedRes =
      await service.linkQuarantineReceiptToReviewDraft({
        receiptId: fix.receipt.receiptId,
      });
    assert.equal(revMutatedRes.ok, false);
    if (!revMutatedRes.ok) {
      assert.equal(revMutatedRes.holdReasonCode, 'STALE_SOURCE_HOLD');
      assert.equal(revMutatedRes.gcsVerifyAttempted, true);
      assert.equal(revMutatedRes.transactionAttempted, true);
      assert.equal(revMutatedRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(revMutatedRes.draftCreated, false);
    }
    assert.equal(db.draftCreateCalls, 0, 'Zero draft writes on stale source revision');

    // 5B: Source receipt generation or sha256 mutated before transaction read
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    db.resetCounters();
    db.onBeforeTransactionReadHook = () => {
      db.seedRawDoc(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        fix.receipt.receiptId,
        {
          ...fix.envelope,
          receipt: {
            ...fix.receipt,
            generation: '1731072000888999',
          },
        }
      );
    };

    const genMutatedInTxRes =
      await service.linkQuarantineReceiptToReviewDraft({
        receiptId: fix.receipt.receiptId,
      });
    assert.equal(genMutatedInTxRes.ok, false);
    if (!genMutatedInTxRes.ok) {
      assert.equal(genMutatedInTxRes.holdReasonCode, 'STALE_SOURCE_HOLD');
      assert.equal(genMutatedInTxRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(genMutatedInTxRes.draftCreated, false);
      assertZeroPrivateOrUrlLeakage(
        JSON.stringify(genMutatedInTxRes),
        'In-tx generation mutation hold',
        [
          fix.receipt.storagePath,
          fix.receipt.generation ?? '',
          '1731072000888999',
        ]
      );
    }
    assert.equal(db.draftCreateCalls, 0);

    // 5C: Source receipt deleted between GCS readback and Firestore transaction
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    db.resetCounters();
    db.onBeforeTransactionReadHook = () => {
      db.deleteRawDoc(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        fix.receipt.receiptId
      );
    };

    const deletedInTxRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fix.receipt.receiptId,
    });
    assert.equal(deletedInTxRes.ok, false);
    if (!deletedInTxRes.ok) {
      assert.equal(deletedInTxRes.holdReasonCode, 'STALE_SOURCE_HOLD');
      assert.equal(deletedInTxRes.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(deletedInTxRes.draftCreated, false);
    }
    assert.equal(db.draftCreateCalls, 0);

    // 5D: Source receipt modified AFTER transaction.get and AFTER transaction.create was staged
    //     (optimistic read-lock abort at commit -> outcome is UNKNOWN / draftCreated: null)
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    db.resetCounters();
    db.onBeforeTransactionCommitHook = () => {
      db.seedRawDoc(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        fix.receipt.receiptId,
        {
          ...fix.envelope,
          revision: 9,
        }
      );
    };

    const readLockConflictRes =
      await service.linkQuarantineReceiptToReviewDraft({
        receiptId: fix.receipt.receiptId,
      });
    assert.equal(readLockConflictRes.ok, false);
    if (!readLockConflictRes.ok) {
      assert.equal(
        readLockConflictRes.holdReasonCode,
        'TRANSACTION_CONFLICT_OR_FAILURE_HOLD'
      );
      assert.equal(readLockConflictRes.draftCreationOutcome, 'UNKNOWN');
      assert.equal(readLockConflictRes.draftCreated, null);
    }
    assert.equal(
      db.getRawDoc(
        LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
        fix.receipt.receiptId
      ),
      undefined,
      'Read-lock conflict on source receipt must abort draft commit'
    );
    assert.equal(db.transactionCount, 1, 'Service must not auto-retry failed transaction');

    console.log(
      'PASS 5: In-transaction source receipt re-read and optimistic lock guard prevent stale or concurrent source mutations with zero draft writes.'
    );
  }

  // =========================================================================
  // PASS 6: R1-C Truthful ambiguous commit outcome (UNKNOWN vs NOT_CREATED),
  //         idempotent existing draft, crash before/after commit replay,
  //         SDK callback retry, and concurrency
  // =========================================================================
  {
    const db = new FaultInjectingQuarantineFirestoreDatabase();
    const bucket = new InMemoryGenerationPinnedGcsBucket();
    const principalProvider = new InMemoryTrustedPrincipalProviderDouble({
      uid: 'admin_owner_01',
    });
    const adminRepo = new InMemoryAdminRepositoryDouble(defaultAdmins);
    const receiptStore = new FirestoreLibraryQuarantineReceiptStore(db);
    let currentClockIso = '2026-11-08T11:00:00.000Z';
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => currentClockIso,
    });
    const draftStore = new FirestoreLibraryQuarantineReviewDraftStore(db);
    const service = new LibraryQuarantineReviewDraftPersistenceService({
      trustedPrincipalProvider: principalProvider,
      adminRepository: adminRepo,
      receiptStore,
      storageReadbackPort: gcsAdapter,
      draftStore,
      clock: () => currentClockIso,
    });

    const fix = createVerifiedQuarantinedFixture({
      format: 'PDF',
      revision: 3,
      generation: '1731072000444555',
    });
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fix.receipt.receiptId,
      fix.envelope
    );
    bucket.seedVerifiedQuarantineObject(fix.receipt, fix.bytes);

    // 6A: Crash at commit time (after transaction.create staged) -> returns HOLD with
    //     draftCreationOutcome: 'UNKNOWN' and draftCreated: null; draft not persisted
    db.resetCounters();
    db.onBeforeTransactionCommitHook = () => {
      throw new Error('Simulated Firestore network drop during commit');
    };
    const crashBeforeRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fix.receipt.receiptId,
    });
    assert.equal(crashBeforeRes.ok, false);
    if (!crashBeforeRes.ok) {
      assert.equal(
        crashBeforeRes.holdReasonCode,
        'TRANSACTION_CONFLICT_OR_FAILURE_HOLD'
      );
      assert.equal(crashBeforeRes.transactionAttempted, true);
      assert.equal(crashBeforeRes.draftCreationOutcome, 'UNKNOWN');
      assert.equal(crashBeforeRes.draftCreated, null);
    }
    assert.equal(db.transactionCount, 1, 'Zero automatic retries on crash during commit');
    assert.equal(
      db.getRawDoc(
        LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
        fix.receipt.receiptId
      ),
      undefined
    );

    // 6B: Crash AFTER commit (before reply reaches caller) -> first call MUST report
    //     draftCreationOutcome: 'UNKNOWN' and draftCreated: null (never false!);
    //     fresh replay at a later timestamp returns IDEMPOTENT_EXISTING with original createdAt/createdBy
    db.resetCounters();
    currentClockIso = '2026-11-08T11:01:00.000Z';
    principalProvider.setPrincipal({ uid: 'admin_owner_01' });
    db.onAfterTransactionCommitHook = () => {
      throw new Error(
        'Simulated deadline-exceeded after commit before response received'
      );
    };
    const crashAfterCommitRes =
      await service.linkQuarantineReceiptToReviewDraft({
        receiptId: fix.receipt.receiptId,
      });
    assert.equal(crashAfterCommitRes.ok, false);
    if (!crashAfterCommitRes.ok) {
      assert.equal(
        crashAfterCommitRes.holdReasonCode,
        'TRANSACTION_CONFLICT_OR_FAILURE_HOLD'
      );
      assert.equal(crashAfterCommitRes.transactionAttempted, true);
      assert.equal(
        crashAfterCommitRes.draftCreationOutcome,
        'UNKNOWN',
        'Post-commit crash must report UNKNOWN draftCreationOutcome'
      );
      assert.equal(
        crashAfterCommitRes.draftCreated,
        null,
        'Post-commit crash must report draftCreated: null rather than false'
      );
    }
    assert.equal(db.transactionCount, 1);
    assert.equal(db.draftCreateCalls, 1);

    // Fresh replay at later timestamp by another authorized reviewer (LibraryCurator)
    db.resetCounters();
    currentClockIso = '2026-11-08T11:05:00.000Z';
    principalProvider.setPrincipal({ uid: 'admin_curator_01' });
    const replayRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fix.receipt.receiptId,
    });
    if (!replayRes.ok) {
      assert.fail(replayRes.errorMessage);
    }
    assert.equal(replayRes.disposition, 'IDEMPOTENT_EXISTING');
    assert.equal(replayRes.draftCreationOutcome, 'IDEMPOTENT_EXISTING');
    assert.equal(replayRes.created, false);
    assert.equal(replayRes.draftCreated, false);
    assert.equal(replayRes.draft.createdBy, 'admin_owner_01');
    assert.equal(replayRes.draft.createdAt, '2026-11-08T11:01:00.000Z');
    assert.equal(
      db.draftCreateCalls,
      0,
      'Idempotent replay must perform 0 draft creates'
    );
    assert.equal(db.receiptWriteCalls, 0);

    // 6C: Conflicting / stale existing draft (sourceRevision mismatch or forged flag) ->
    //     aborts inside callback before transaction.create -> draftCreationOutcome: 'NOT_CREATED', draftCreated: false
    db.seedRawDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      fix.receipt.receiptId,
      {
        ...replayRes.draft,
        sourceRevision: 2,
      }
    );
    db.resetCounters();
    const staleDraftHold = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fix.receipt.receiptId,
    });
    assert.equal(staleDraftHold.ok, false);
    if (!staleDraftHold.ok) {
      assert.equal(
        staleDraftHold.holdReasonCode,
        'EXISTING_DRAFT_CONFLICT_HOLD'
      );
      assert.equal(staleDraftHold.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(staleDraftHold.draftCreated, false);
    }
    assert.equal(db.draftCreateCalls, 0);

    // Corrupted existing draft with escalated isPublished: true -> CORRUPTED_PERSISTED_DRAFT_HOLD
    db.seedRawDoc(
      LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
      fix.receipt.receiptId,
      {
        ...replayRes.draft,
        isPublished: true,
      }
    );
    const escalatedDraftHold = await service.linkQuarantineReceiptToReviewDraft(
      {
        receiptId: fix.receipt.receiptId,
      }
    );
    assert.equal(escalatedDraftHold.ok, false);
    if (!escalatedDraftHold.ok) {
      assert.equal(
        escalatedDraftHold.holdReasonCode,
        'CORRUPTED_PERSISTED_DRAFT_HOLD'
      );
      assert.equal(escalatedDraftHold.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(escalatedDraftHold.draftCreated, false);
    }

    // Post-transaction validation failure (if store returned corrupted draft after transaction) -> UNKNOWN
    const postTxCorruptService =
      new LibraryQuarantineReviewDraftPersistenceService({
        trustedPrincipalProvider: principalProvider,
        adminRepository: adminRepo,
        receiptStore,
        storageReadbackPort: gcsAdapter,
        draftStore: {
          getReviewDraftByReceiptId: (id) =>
            draftStore.getReviewDraftByReceiptId(id),
          async createReviewDraftIfAbsentAtomically() {
            return {
              ok: true as const,
              disposition: 'CREATED' as const,
              draftCreationOutcome: 'CREATED' as const,
              created: true,
              draftCreated: true,
              draft: {
                ...replayRes.draft,
                sourceRevision: 999,
              },
              sourceRevision: 3,
              deferredGates: [],
            };
          },
        },
        clock: () => currentClockIso,
      });
    const postTxCorruptRes =
      await postTxCorruptService.linkQuarantineReceiptToReviewDraft({
        receiptId: fix.receipt.receiptId,
      });
    assert.equal(postTxCorruptRes.ok, false);
    if (!postTxCorruptRes.ok) {
      assert.equal(
        postTxCorruptRes.holdReasonCode,
        'CORRUPTED_PERSISTED_DRAFT_HOLD'
      );
      assert.equal(postTxCorruptRes.transactionAttempted, true);
      assert.equal(postTxCorruptRes.draftCreationOutcome, 'UNKNOWN');
      assert.equal(postTxCorruptRes.draftCreated, null);
    }

    // Direct validatePersistedLibraryQuarantineReviewDraft checks
    const validCheck = validatePersistedLibraryQuarantineReviewDraft(
      replayRes.draft,
      fix.receipt.receiptId
    );
    assert.equal(validCheck.ok, true);
    const leakedKeyCheck = validatePersistedLibraryQuarantineReviewDraft(
      {
        ...replayRes.draft,
        storagePath: fix.receipt.storagePath,
      },
      fix.receipt.receiptId
    );
    assert.equal(leakedKeyCheck.ok, false);

    // 6D: SDK internal transaction callback retry when another writer created the matching draft
    const fixRetry = createVerifiedQuarantinedFixture({
      format: 'DOCX',
      revision: 5,
      generation: '1731072000666777',
    });
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fixRetry.receipt.receiptId,
      fixRetry.envelope
    );
    bucket.seedVerifiedQuarantineObject(fixRetry.receipt, fixRetry.bytes);

    db.resetCounters();
    db.simulateSdkRetryOnceHook = () => {
      // Simulate concurrent transaction committing the exact matching draft before retry attempt 2
      db.seedRawDoc(
        LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
        fixRetry.receipt.receiptId,
        {
          schemaVersion: 1,
          receiptId: fixRetry.receipt.receiptId,
          sourceRevision: 5,
          sourceUpdatedAt: fixRetry.receipt.updatedAt,
          sourceSha256: fixRetry.receipt.sha256,
          format: 'DOCX',
          uploaderUid: fixRetry.receipt.uploaderUid,
          reviewState: 'PENDING_HUMAN_REVIEW',
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
          createdBy: 'admin_owner_01',
          createdAt: '2026-11-08T11:04:00.000Z',
        }
      );
    };

    const sdkRetryConverged = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fixRetry.receipt.receiptId,
    });
    assert.equal(sdkRetryConverged.ok, true);
    if (sdkRetryConverged.ok) {
      assert.equal(sdkRetryConverged.disposition, 'IDEMPOTENT_EXISTING');
      assert.equal(sdkRetryConverged.draftCreationOutcome, 'IDEMPOTENT_EXISTING');
      assert.equal(sdkRetryConverged.created, false);
      assert.equal(sdkRetryConverged.draftCreated, false);
    }
    assert.equal(db.transactionCount, 1);
    assert.equal(db.transactionCallbackInvocations, 2);

    // 6E: Double concurrent invocation on a fresh receipt -> 1 CREATED winner + 1 transaction-race HOLD
    //     (with draftCreationOutcome: 'UNKNOWN', draftCreated: null), followed by IDEMPOTENT_EXISTING
    const fixConcurrent = createVerifiedQuarantinedFixture({
      format: 'PDF',
      revision: 2,
      generation: '1731072000123987',
    });
    db.seedRawDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      fixConcurrent.receipt.receiptId,
      fixConcurrent.envelope
    );
    bucket.seedVerifiedQuarantineObject(
      fixConcurrent.receipt,
      fixConcurrent.bytes
    );

    db.resetCounters();
    const [concA, concB] = await Promise.all([
      service.linkQuarantineReceiptToReviewDraft({
        receiptId: fixConcurrent.receipt.receiptId,
      }),
      service.linkQuarantineReceiptToReviewDraft({
        receiptId: fixConcurrent.receipt.receiptId,
      }),
    ]);

    const successes = [concA, concB].filter((r) => r.ok);
    const holds = [concA, concB].filter((r) => !r.ok);
    assert.equal(
      successes.length,
      1,
      'Exactly one concurrent caller must win the create race'
    );
    assert.equal(
      holds.length,
      1,
      'Competing concurrent caller must HOLD on transaction conflict without auto-retry'
    );
    if (successes[0]?.ok) {
      assert.equal(successes[0].disposition, 'CREATED');
      assert.equal(successes[0].draftCreationOutcome, 'CREATED');
      assert.equal(successes[0].created, true);
      assert.equal(successes[0].draftCreated, true);
    }
    if (holds[0] && !holds[0].ok) {
      assert.equal(
        holds[0].holdReasonCode,
        'TRANSACTION_CONFLICT_OR_FAILURE_HOLD'
      );
      assert.equal(holds[0].draftCreationOutcome, 'UNKNOWN');
      assert.equal(holds[0].draftCreated, null);
    }
    assert.equal(db.receiptWriteCalls, 0);

    // Follow-up call after concurrent race converges to IDEMPOTENT_EXISTING with 0 additional writes
    const postRaceRes = await service.linkQuarantineReceiptToReviewDraft({
      receiptId: fixConcurrent.receipt.receiptId,
    });
    assert.equal(postRaceRes.ok, true);
    if (postRaceRes.ok) {
      assert.equal(postRaceRes.disposition, 'IDEMPOTENT_EXISTING');
      assert.equal(postRaceRes.draftCreationOutcome, 'IDEMPOTENT_EXISTING');
      assert.equal(postRaceRes.created, false);
      assert.equal(postRaceRes.draftCreated, false);
    }

    console.log(
      'PASS 6: R1-C truthful UNKNOWN vs NOT_CREATED outcome, create-once idempotency, crash before/after commit replay, SDK callback retry, and concurrent invocation safety verified.'
    );
  }

  // =========================================================================
  // PASS 7: Read-only protected files Git blob SHA-1 invariant check
  // =========================================================================
  {
    const expectedBaselineBlobs: ReadonlyArray<readonly [string, string]> = [
      [
        'functions/src/library/libraryQuarantineReviewDraftContract.ts',
        '0aeb565c7f83876dd3c2bfb5b214e9f85d9a0153',
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
        'functions/src/library/gcsLibraryQuarantineStorageAdapter.ts',
        '4bca554dd00a5e2efc739cc166175cc63327c5ad',
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
      'PASS 7: All 10 read-only reference files verified at exact expected Git blob SHA-1s.'
    );
  }

  console.log('ALL LIB-FILE-REVIEW-01B/R1 PERSISTENCE TESTS PASSED (7/7).');
}

runTests().catch((err) => {
  console.error('LIB-FILE-REVIEW-01B/R1 PERSISTENCE TESTS FAILED:', err);
  process.exit(1);
});
