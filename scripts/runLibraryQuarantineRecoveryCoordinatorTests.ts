import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';
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
  type LibraryQuarantineFirestoreCollectionRef,
  type LibraryQuarantineFirestoreDatabase,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantineFirestoreTransaction,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';
import {
  GcsLibraryQuarantineStorageAdapter,
  LIBRARY_QUARANTINE_CACHE_CONTROL,
  LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
  LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
  type GcsLibraryQuarantineBucket,
  type GcsLibraryQuarantineFile,
  type GcsLibraryQuarantineObjectMetadata,
  type GcsLibraryQuarantineReadStreamOptions,
  type GcsLibraryQuarantineReadableStream,
  type GcsLibraryQuarantineSaveOptions,
} from '../functions/src/library/gcsLibraryQuarantineStorageAdapter';
import {
  LibraryQuarantineRecoveryCoordinator,
} from '../functions/src/library/libraryQuarantineRecoveryCoordinator';

let totalTests = 0;
let passedTests = 0;
let globalSaveCallCount = 0;
let globalDeleteCallCount = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function test(
  name: string,
  fn: () => void | Promise<void>
): Promise<void> {
  totalTests += 1;
  try {
    await fn();
    passedTests += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

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
  '<w:body><w:p><w:r><w:t>منسق استعادة إيصالات الحجر الخاص لوثائق المكتبة 2026</w:t></w:r></w:p></w:body>' +
  '</w:document>';

function makeValidDocxBuffer(customText?: string): Buffer {
  const docXml = customText
    ? CANONICAL_WORD_DOCUMENT_XML.replace(
        'منسق استعادة إيصالات الحجر الخاص لوثائق المكتبة 2026',
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

function makeValidPdfBuffer(extraComment = ''): Buffer {
  return Buffer.from(
    `%PDF-1.7\n%${extraComment}\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 3 >>\nstartxref\n110\n%%EOF\n`,
    'utf8'
  );
}

function deepClonePlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepClonePlain);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = deepClonePlain((value as Record<string, unknown>)[key]);
  }
  return out;
}

class FakeRecoveryFirestoreDb implements LibraryQuarantineFirestoreDatabase {
  private readonly docs = new Map<string, { version: number; data: unknown }>();
  public readonly eventLog: string[] = [];
  public getCalls = 0;
  public casSetsCommitted = 0;
  public transactionCount = 0;
  public failOnTransactionNumber: number | null = null;
  public throwAfterCommitOnTransactionNumber: number | null = null;
  public onBeforeTransactionCommit:
    | ((txNumber: number, docId: string) => Promise<void> | void)
    | null = null;

  public rawGetEnvelope(docId: string): Record<string, unknown> | undefined {
    return this.docs.get(docId)?.data as Record<string, unknown> | undefined;
  }

  public rawSetEnvelope(docId: string, data: unknown): void {
    const existing = this.docs.get(docId);
    this.docs.set(docId, {
      version: (existing?.version ?? 0) + 1,
      data: deepClonePlain(data),
    });
  }

  public collection(
    collectionName: string
  ): LibraryQuarantineFirestoreCollectionRef {
    if (collectionName !== LIBRARY_QUARANTINE_RECEIPT_COLLECTION) {
      throw new Error(`Unexpected collection name "${collectionName}"`);
    }
    const self = this;
    return {
      doc(documentId: string): LibraryQuarantineFirestoreDocumentRef {
        return {
          id: documentId,
          async get(): Promise<LibraryQuarantineFirestoreDocumentSnapshot> {
            self.getCalls += 1;
            self.eventLog.push(`FIRESTORE_GET:${documentId}`);
            const entry = self.docs.get(documentId);
            if (!entry) {
              return { exists: false, id: documentId, data: () => undefined };
            }
            const cloned = deepClonePlain(entry.data);
            return {
              exists: true,
              id: documentId,
              data: () => deepClonePlain(cloned),
            };
          },
        };
      },
    };
  }

  public async runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    this.transactionCount += 1;
    const currentTxNum = this.transactionCount;

    if (this.failOnTransactionNumber === currentTxNum) {
      this.failOnTransactionNumber = null;
      this.eventLog.push(`FIRESTORE_TX_ABORTED_BEFORE_COMMIT:${currentTxNum}`);
      throw new Error(
        `ABORTED: Simulated Firestore transaction failure before commit on tx #${currentTxNum} for https://firestore.googleapis.com/v1/projects/secret-project?token=secret999`
      );
    }

    const readVersions = new Map<string, number>();
    const stagedWrites = new Map<
      string,
      { op: 'create' | 'set'; docId: string; data: Record<string, unknown> }
    >();

    const tx: LibraryQuarantineFirestoreTransaction = {
      get: async (
        docRef: LibraryQuarantineFirestoreDocumentRef
      ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
        const entry = this.docs.get(docRef.id);
        readVersions.set(docRef.id, entry ? entry.version : 0);
        if (!entry) {
          return { exists: false, id: docRef.id, data: () => undefined };
        }
        const cloned = deepClonePlain(entry.data);
        return {
          exists: true,
          id: docRef.id,
          data: () => deepClonePlain(cloned),
        };
      },
      create: (
        docRef: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        stagedWrites.set(docRef.id, {
          op: 'create',
          docId: docRef.id,
          data: deepClonePlain(data) as Record<string, unknown>,
        });
      },
      set: (
        docRef: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ): void => {
        stagedWrites.set(docRef.id, {
          op: 'set',
          docId: docRef.id,
          data: deepClonePlain(data) as Record<string, unknown>,
        });
      },
    };

    const result = await updateFunction(tx);

    for (const write of stagedWrites.values()) {
      if (this.onBeforeTransactionCommit) {
        await this.onBeforeTransactionCommit(currentTxNum, write.docId);
      }

      const readVersion = readVersions.get(write.docId) ?? 0;
      const currentVersion = this.docs.get(write.docId)?.version ?? 0;
      if (currentVersion !== readVersion) {
        this.eventLog.push(`FIRESTORE_TX_VERSION_CONFLICT:${write.docId}`);
        throw new Error(
          `ABORTED: Optimistic lock conflict on "${write.docId}".`
        );
      }

      const nextState = String(write.data.state ?? '');
      this.docs.set(write.docId, {
        version: currentVersion + 1,
        data: deepClonePlain(write.data),
      });
      if (write.op === 'set') {
        this.casSetsCommitted += 1;
      }
      this.eventLog.push(
        `FIRESTORE_COMMIT:${write.op}:${write.docId}:${nextState}:rev=${String(write.data.revision)}`
      );
    }

    if (this.throwAfterCommitOnTransactionNumber === currentTxNum) {
      this.throwAfterCommitOnTransactionNumber = null;
      this.eventLog.push(`FIRESTORE_TX_LOST_RESPONSE_AFTER_COMMIT:${currentTxNum}`);
      throw new Error(
        `DEADLINE_EXCEEDED: Simulated network drop after Firestore commit on tx #${currentTxNum} for gs://secret-quarantine-bucket/path`
      );
    }

    return result;
  }
}

class FakeRecoveryGcsBucket implements GcsLibraryQuarantineBucket {
  public readonly name = 'promise-of-planet-private-recovery-bucket-secret';
  public readonly objects = new Map<
    string,
    { bytes: Buffer; metadata: GcsLibraryQuarantineObjectMetadata }
  >();
  public readonly eventLog: string[] = [];
  public saveCalls = 0;
  public deleteCalls = 0;
  public getMetadataCalls = 0;
  public createReadStreamCalls = 0;
  public interruptStreamAfterBytes: number | null = null;

  public putCanonicalQuarantineObject(
    receipt: LibraryQuarantineInternalReceipt,
    bytes: Buffer,
    generation = '1731000000101',
    metadataOverrides?: Partial<GcsLibraryQuarantineObjectMetadata>
  ): void {
    const baseMetadata: GcsLibraryQuarantineObjectMetadata = {
      name: receipt.storagePath,
      bucket: this.name,
      generation,
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
      metadata: baseMetadata,
    });
  }

  public file(objectPath: string): GcsLibraryQuarantineFile {
    const bucket = this;
    const fileHandle: GcsLibraryQuarantineFile & {
      delete?: () => Promise<void>;
    } = {
      name: objectPath,
      async save(
        _data: Buffer,
        _options: GcsLibraryQuarantineSaveOptions
      ): Promise<void> {
        bucket.saveCalls += 1;
        globalSaveCallCount += 1;
        bucket.eventLog.push(`FORBIDDEN_GCS_SAVE:${objectPath}`);
        throw new Error('Recovery coordinator must NEVER call GCS save()!');
      },
      async delete(): Promise<void> {
        bucket.deleteCalls += 1;
        globalDeleteCallCount += 1;
        bucket.eventLog.push(`FORBIDDEN_GCS_DELETE:${objectPath}`);
        throw new Error('Recovery coordinator must NEVER call GCS delete()!');
      },
      async getMetadata(): Promise<
        [GcsLibraryQuarantineObjectMetadata, unknown?]
      > {
        bucket.getMetadataCalls += 1;
        bucket.eventLog.push(`GCS_GET_METADATA:${objectPath}`);
        const stored = bucket.objects.get(objectPath);
        if (!stored) {
          const notFound = new Error(
            `No such object: gs://${bucket.name}/${objectPath} (404)`
          ) as Error & { code: number };
          notFound.code = 404;
          throw notFound;
        }
        return [{ ...stored.metadata }, {}];
      },
      createReadStream(
        _options?: GcsLibraryQuarantineReadStreamOptions
      ): GcsLibraryQuarantineReadableStream {
        bucket.createReadStreamCalls += 1;
        bucket.eventLog.push(`GCS_READ_STREAM:${objectPath}`);
        let destroyed = false;
        const interruptLimit = bucket.interruptStreamAfterBytes;
        return {
          destroy(): void {
            destroyed = true;
          },
          async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
            const stored = bucket.objects.get(objectPath);
            if (!stored) {
              throw new Error('Missing object during read stream');
            }
            const buf = stored.bytes;
            let emitted = 0;
            for (let i = 0; i < buf.length; i += 64) {
              if (destroyed) return;
              const chunk = buf.subarray(i, Math.min(i + 64, buf.length));
              emitted += chunk.byteLength;
              if (interruptLimit !== null && emitted > interruptLimit) {
                throw new Error(
                  `ECONNRESET: Simulated stream interruption reading https://storage.googleapis.com/${bucket.name}/${objectPath}?token=secretStreamToken`
                );
              }
              yield chunk;
            }
          },
        };
      },
    };
    return fileHandle;
  }
}

interface RecoveryTestFixture {
  readonly db: FakeRecoveryFirestoreDb;
  readonly bucket: FakeRecoveryGcsBucket;
  readonly receiptStore: FirestoreLibraryQuarantineReceiptStore;
  readonly gcsAdapter: GcsLibraryQuarantineStorageAdapter;
  readonly coordinator: LibraryQuarantineRecoveryCoordinator;
  advanceClock(seconds?: number): string;
  setClockTimestamp(iso: string): void;
  seedReservedReceipt(
    format?: 'PDF' | 'DOCX',
    uploaderUid?: string
  ): Promise<{
    receipt: LibraryQuarantineInternalReceipt;
    bytes: Buffer;
    revision: number;
  }>;
  seedWritePendingReceipt(
    format?: 'PDF' | 'DOCX',
    uploaderUid?: string
  ): Promise<{
    receipt: LibraryQuarantineInternalReceipt;
    bytes: Buffer;
    revision: number;
  }>;
  seedNeedsReconciliationReceipt(
    format?: 'PDF' | 'DOCX',
    uploaderUid?: string
  ): Promise<{
    receipt: LibraryQuarantineInternalReceipt;
    bytes: Buffer;
    revision: number;
  }>;
  seedQuarantinedReceipt(
    generation?: string,
    format?: 'PDF' | 'DOCX',
    uploaderUid?: string
  ): Promise<{
    receipt: LibraryQuarantineInternalReceipt;
    bytes: Buffer;
    revision: number;
  }>;
  seedRejectedReceipt(
    format?: 'PDF' | 'DOCX',
    uploaderUid?: string
  ): Promise<{
    receipt: LibraryQuarantineInternalReceipt;
    bytes: Buffer;
    revision: number;
  }>;
}

function createRecoveryTestFixture(): RecoveryTestFixture {
  let currentEpochMs = Date.parse('2026-11-07T14:00:00.000Z');
  let overrideTimestamp: string | null = null;

  const advanceClock = (seconds = 5): string => {
    if (overrideTimestamp !== null) {
      return overrideTimestamp;
    }
    currentEpochMs += seconds * 1000;
    return new Date(currentEpochMs).toISOString();
  };

  const setClockTimestamp = (iso: string): void => {
    overrideTimestamp = iso;
  };

  const db = new FakeRecoveryFirestoreDb();
  const bucket = new FakeRecoveryGcsBucket();
  const receiptStore = new FirestoreLibraryQuarantineReceiptStore(db);
  const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
    bucket,
    clock: () => advanceClock(1),
  });
  const coordinator = new LibraryQuarantineRecoveryCoordinator({
    receiptStore,
    storageReadbackPort: gcsAdapter,
    clock: () => advanceClock(2),
  });

  const seedReservedReceipt = async (
    format: 'PDF' | 'DOCX' = 'PDF',
    uploaderUid = 'user_recovery_owner_01'
  ) => {
    const bytes =
      format === 'PDF'
        ? makeValidPdfBuffer('Recovery coordinator test PDF')
        : makeValidDocxBuffer('وثيقة اختبار استعادة الحجر');
    const reservedRes = reserveLibraryQuarantineReceipt({
      uploaderUid,
      originalFilename:
        format === 'PDF' ? 'recovery-climate-report.pdf' : 'recovery-study.docx',
      claimedMimeType:
        format === 'PDF' ? CANONICAL_PDF_MIME_TYPE : CANONICAL_DOCX_MIME_TYPE,
      bytes,
      nowIso: advanceClock(1),
    });
    assert(reservedRes.ok, 'Expected reserveLibraryQuarantineReceipt to succeed');
    if (!reservedRes.ok) throw new Error(reservedRes.errorMessage);

    const createRes = await receiptStore.createReceiptIfAbsent(
      reservedRes.receipt
    );
    assert(createRes.ok, 'Expected createReceiptIfAbsent to succeed');
    if (!createRes.ok) throw new Error(createRes.errorMessage);

    return {
      receipt: createRes.envelope.receipt,
      bytes,
      revision: createRes.envelope.revision,
    };
  };

  const seedWritePendingReceipt = async (
    format: 'PDF' | 'DOCX' = 'PDF',
    uploaderUid = 'user_recovery_owner_01'
  ) => {
    const seeded = await seedReservedReceipt(format, uploaderUid);
    const wpRes = beginLibraryQuarantineWritePending({
      receipt: seeded.receipt,
      actorUid: uploaderUid,
      expectedReceiptId: seeded.receipt.receiptId,
      expectedSha256: seeded.receipt.sha256,
      nowIso: advanceClock(2),
    });
    assert(wpRes.ok, 'Expected beginLibraryQuarantineWritePending to succeed');
    if (!wpRes.ok) throw new Error(wpRes.errorMessage);

    const casRes = await receiptStore.compareAndSwapReceipt({
      receiptId: seeded.receipt.receiptId,
      expectedRevision: seeded.revision,
      expectedCurrentReceipt: seeded.receipt,
      nextReceipt: wpRes.receipt,
    });
    assert(casRes.ok, 'Expected CAS to WritePending to succeed');
    if (!casRes.ok) throw new Error(casRes.errorMessage);

    return {
      receipt: casRes.envelope.receipt,
      bytes: seeded.bytes,
      revision: casRes.envelope.revision,
    };
  };

  const seedNeedsReconciliationReceipt = async (
    format: 'PDF' | 'DOCX' = 'DOCX',
    uploaderUid = 'user_recovery_owner_01'
  ) => {
    const wp = await seedWritePendingReceipt(format, uploaderUid);
    const reconRes = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: wp.receipt,
      actorUid: uploaderUid,
      reconciliationReason:
        'Prior upload connection timed out before readback confirmation.',
      nowIso: advanceClock(2),
    });
    assert(
      reconRes.ok,
      'Expected markLibraryQuarantineWriteNeedsReconciliation to succeed'
    );
    if (!reconRes.ok) throw new Error(reconRes.errorMessage);

    const casRes = await receiptStore.compareAndSwapReceipt({
      receiptId: wp.receipt.receiptId,
      expectedRevision: wp.revision,
      expectedCurrentReceipt: wp.receipt,
      nextReceipt: reconRes.receipt,
    });
    assert(casRes.ok, 'Expected CAS to NeedsReconciliation to succeed');
    if (!casRes.ok) throw new Error(casRes.errorMessage);

    return {
      receipt: casRes.envelope.receipt,
      bytes: wp.bytes,
      revision: casRes.envelope.revision,
    };
  };

  const seedQuarantinedReceipt = async (
    generation = '1731000000777',
    format: 'PDF' | 'DOCX' = 'PDF',
    uploaderUid = 'user_recovery_owner_01'
  ) => {
    const wp = await seedWritePendingReceipt(format, uploaderUid);
    const confirmRes = confirmLibraryQuarantineWriteWithAttestation({
      receipt: wp.receipt,
      actorUid: uploaderUid,
      attestation: {
        attestedReceiptId: wp.receipt.receiptId,
        attestedUploaderUid: wp.receipt.uploaderUid,
        attestedStoragePath: wp.receipt.storagePath,
        attestedFormat: wp.receipt.format,
        attestedContentType: wp.receipt.canonicalMimeType,
        attestedByteSize: wp.receipt.byteSize,
        attestedSha256: wp.receipt.sha256,
        attestedGeneration: generation,
        verifiedAtIso: advanceClock(2),
      },
    });
    assert(
      confirmRes.ok,
      'Expected confirmLibraryQuarantineWriteWithAttestation to succeed'
    );
    if (!confirmRes.ok) throw new Error(confirmRes.errorMessage);

    const casRes = await receiptStore.compareAndSwapReceipt({
      receiptId: wp.receipt.receiptId,
      expectedRevision: wp.revision,
      expectedCurrentReceipt: wp.receipt,
      nextReceipt: confirmRes.receipt,
    });
    assert(casRes.ok, 'Expected CAS to Quarantined to succeed');
    if (!casRes.ok) throw new Error(casRes.errorMessage);

    return {
      receipt: casRes.envelope.receipt,
      bytes: wp.bytes,
      revision: casRes.envelope.revision,
    };
  };

  const seedRejectedReceipt = async (
    format: 'PDF' | 'DOCX' = 'PDF',
    uploaderUid = 'user_recovery_owner_01'
  ) => {
    const reserved = await seedReservedReceipt(format, uploaderUid);
    const rejRes = rejectLibraryQuarantineReceipt({
      receipt: reserved.receipt,
      actorUid: uploaderUid,
      rejectionReasonCode: 'STORAGE_PRECONDITION_FAILED',
      nowIso: advanceClock(2),
    });
    assert(rejRes.ok, 'Expected rejectLibraryQuarantineReceipt to succeed');
    if (!rejRes.ok) throw new Error(rejRes.errorMessage);

    const casRes = await receiptStore.compareAndSwapReceipt({
      receiptId: reserved.receipt.receiptId,
      expectedRevision: reserved.revision,
      expectedCurrentReceipt: reserved.receipt,
      nextReceipt: rejRes.receipt,
    });
    assert(casRes.ok, 'Expected CAS to Rejected to succeed');
    if (!casRes.ok) throw new Error(casRes.errorMessage);

    return {
      receipt: casRes.envelope.receipt,
      bytes: reserved.bytes,
      revision: casRes.envelope.revision,
    };
  };

  return {
    db,
    bucket,
    receiptStore,
    gcsAdapter,
    coordinator,
    advanceClock,
    setClockTimestamp,
    seedReservedReceipt,
    seedWritePendingReceipt,
    seedNeedsReconciliationReceipt,
    seedQuarantinedReceipt,
    seedRejectedReceipt,
  };
}

function assertNoSecretLeakage(
  result: unknown,
  forbiddenSubstrings: readonly string[]
): void {
  const serialized = JSON.stringify(result);
  for (const needle of forbiddenSubstrings) {
    if (needle.length > 0) {
      assert(
        !serialized.includes(needle),
        `Sanitized output leaked forbidden substring "${needle}" in: ${serialized}`
      );
    }
  }
  assert(
    !serialized.includes('library/quarantine/'),
    `Output leaked quarantine prefix in: ${serialized}`
  );
  assert(
    !serialized.includes('storagePath'),
    `Output leaked storagePath property in: ${serialized}`
  );
  assert(
    !serialized.includes('attestedGeneration'),
    `Output leaked attestedGeneration in: ${serialized}`
  );
}

function assertAllSecurityFlagsFalse(result: {
  readonly bucketIamPrivacyVerified: boolean;
  readonly isSanitized: boolean;
  readonly isVerifiedSafe: boolean;
  readonly isRightsApproved: boolean;
  readonly isPublished: boolean;
  readonly isReadyForPeia: boolean;
  readonly adminReceiptDto: {
    readonly isSanitized: boolean;
    readonly isVerifiedSafe: boolean;
    readonly isRightsApproved: boolean;
    readonly isPublished: boolean;
    readonly isReadyForPeia: boolean;
  } | null;
}): void {
  assert(
    result.bucketIamPrivacyVerified === false,
    'bucketIamPrivacyVerified must be false'
  );
  assert(result.isSanitized === false, 'isSanitized must be false');
  assert(result.isVerifiedSafe === false, 'isVerifiedSafe must be false');
  assert(result.isRightsApproved === false, 'isRightsApproved must be false');
  assert(result.isPublished === false, 'isPublished must be false');
  assert(result.isReadyForPeia === false, 'isReadyForPeia must be false');
  if (result.adminReceiptDto !== null) {
    assert(
      result.adminReceiptDto.isSanitized === false,
      'dto.isSanitized must be false'
    );
    assert(
      result.adminReceiptDto.isVerifiedSafe === false,
      'dto.isVerifiedSafe must be false'
    );
    assert(
      result.adminReceiptDto.isRightsApproved === false,
      'dto.isRightsApproved must be false'
    );
    assert(
      result.adminReceiptDto.isPublished === false,
      'dto.isPublished must be false'
    );
    assert(
      result.adminReceiptDto.isReadyForPeia === false,
      'dto.isReadyForPeia must be false'
    );
  }
}

async function runAllTests(): Promise<void> {
  // Test 1: Valid WritePending receipt + valid existing GCS object -> Quarantined
  await test('1. Valid WritePending receipt + valid existing GCS object recovers to Quarantined via single CAS and zero GCS writes', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('PDF', 'user_wp_recover_01');
    const expectedGeneration = '1731000111222';
    fx.bucket.putCanonicalQuarantineObject(
      wp.receipt,
      wp.bytes,
      expectedGeneration
    );

    const txBefore = fx.db.transactionCount;
    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: wp.receipt.receiptId,
      actorUid: 'user_wp_recover_01',
    });

    assert(res.ok === true, 'Expected WritePending recovery to succeed');
    if (!res.ok) return;

    assert(
      res.status === 'RECOVERED_TO_QUARANTINED',
      `Expected status RECOVERED_TO_QUARANTINED, got ${res.status}`
    );
    assert(
      res.receiptId === wp.receipt.receiptId,
      'receiptId must remain unchanged'
    );
    assert(
      res.previousState === LibraryQuarantineReceiptState.WritePending,
      'previousState must be WritePending'
    );
    assert(
      res.state === LibraryQuarantineReceiptState.Quarantined,
      'state must be Quarantined'
    );
    assert(res.revision === wp.revision + 1, 'revision must increment by 1');
    assert(res.gcsReadbackAttempted === true, 'gcsReadbackAttempted must be true');
    assert(res.gcsSaveAttempted === false, 'gcsSaveAttempted must be false');
    assert(res.casPerformed === true, 'casPerformed must be true');
    assert(res.convergedViaReread === false, 'convergedViaReread must be false');
    assert(fx.bucket.saveCalls === 0, 'GCS saveCalls must be 0');
    assert(fx.bucket.deleteCalls === 0, 'GCS deleteCalls must be 0');
    assert(
      fx.db.transactionCount === txBefore + 1,
      'Exactly 1 Firestore CAS transaction must be executed'
    );

    const persisted = await fx.receiptStore.getReceiptById(wp.receipt.receiptId);
    assert(persisted.ok, 'Expected persisted receipt readback to succeed');
    if (persisted.ok) {
      assert(
        persisted.envelope.state === LibraryQuarantineReceiptState.Quarantined,
        'Persisted state must be Quarantined'
      );
      assert(
        persisted.envelope.receipt.generation === expectedGeneration,
        'Persisted generation must equal attestedGeneration'
      );
    }
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [
      wp.receipt.storagePath,
      expectedGeneration,
      fx.bucket.name,
    ]);
  });

  // Test 2: Valid NeedsReconciliation receipt + valid existing GCS object -> Quarantined
  await test('2. Valid NeedsReconciliation receipt + valid existing GCS object recovers to Quarantined via single CAS and zero GCS writes', async () => {
    const fx = createRecoveryTestFixture();
    const recon = await fx.seedNeedsReconciliationReceipt(
      'DOCX',
      'user_recon_recover_02'
    );
    const expectedGeneration = '1731000222333';
    fx.bucket.putCanonicalQuarantineObject(
      recon.receipt,
      recon.bytes,
      expectedGeneration
    );

    const txBefore = fx.db.transactionCount;
    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: recon.receipt.receiptId,
      actorUid: 'user_recon_recover_02',
    });

    assert(res.ok === true, 'Expected NeedsReconciliation recovery to succeed');
    if (!res.ok) return;

    assert(
      res.status === 'RECOVERED_TO_QUARANTINED',
      `Expected status RECOVERED_TO_QUARANTINED, got ${res.status}`
    );
    assert(
      res.receiptId === recon.receipt.receiptId,
      'receiptId must remain unchanged'
    );
    assert(
      res.previousState === LibraryQuarantineReceiptState.NeedsReconciliation,
      'previousState must be NeedsReconciliation'
    );
    assert(
      res.state === LibraryQuarantineReceiptState.Quarantined,
      'state must be Quarantined'
    );
    assert(
      res.revision === recon.revision + 1,
      'revision must increment by 1'
    );
    assert(res.casPerformed === true, 'casPerformed must be true');
    assert(
      res.adminReceiptDto.reconciliationRequired === false &&
        res.adminReceiptDto.reconciliationReason === null,
      'reconciliation fields must be cleared on Quarantined DTO'
    );
    assert(fx.bucket.saveCalls === 0, 'GCS saveCalls must be 0');
    assert(
      fx.db.transactionCount === txBefore + 1,
      'Exactly 1 Firestore CAS transaction must be executed'
    );
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [
      recon.receipt.storagePath,
      expectedGeneration,
      fx.bucket.name,
    ]);
  });

  // Test 3: Quarantined receipt + matching existing GCS object and matching generation -> idempotent verified result without Firestore mutation
  await test('3. Quarantined receipt + matching GCS object and matching generation returns idempotent ALREADY_QUARANTINED_VERIFIED without Firestore CAS', async () => {
    const fx = createRecoveryTestFixture();
    const generation = '1731000333444';
    const quar = await fx.seedQuarantinedReceipt(
      generation,
      'PDF',
      'user_quar_idempotent_03'
    );
    fx.bucket.putCanonicalQuarantineObject(
      quar.receipt,
      quar.bytes,
      generation
    );

    const txBefore = fx.db.transactionCount;
    const casBefore = fx.db.casSetsCommitted;

    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: quar.receipt.receiptId,
      actorUid: 'user_quar_idempotent_03',
    });

    assert(res.ok === true, 'Expected Quarantined verification to succeed');
    if (!res.ok) return;

    assert(
      res.status === 'ALREADY_QUARANTINED_VERIFIED',
      `Expected ALREADY_QUARANTINED_VERIFIED, got ${res.status}`
    );
    assert(
      res.previousState === LibraryQuarantineReceiptState.Quarantined,
      'previousState must be Quarantined'
    );
    assert(
      res.state === LibraryQuarantineReceiptState.Quarantined,
      'state must be Quarantined'
    );
    assert(
      res.revision === quar.revision,
      'revision must NOT change on idempotent Quarantined check'
    );
    assert(res.casPerformed === false, 'casPerformed must be false');
    assert(res.convergedViaReread === false, 'convergedViaReread must be false');
    assert(
      fx.db.transactionCount === txBefore &&
        fx.db.casSetsCommitted === casBefore,
      'Zero Firestore transactions or CAS writes may occur for already Quarantined receipt'
    );
    assert(fx.bucket.saveCalls === 0, 'GCS saveCalls must be 0');
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [
      quar.receipt.storagePath,
      generation,
      fx.bucket.name,
    ]);
  });

  // Test 4: Quarantined receipt + mismatched GCS generation -> explicit integrity failure, no overwrite or silent acceptance
  await test('4. Quarantined receipt + mismatched GCS generation returns QUARANTINED_INTEGRITY_FAILURE without rewriting receipt', async () => {
    const fx = createRecoveryTestFixture();
    const storedGeneration = '1731000444555';
    const mismatchedGcsGeneration = '1731000999888';
    const quar = await fx.seedQuarantinedReceipt(
      storedGeneration,
      'PDF',
      'user_quar_mismatch_04'
    );
    fx.bucket.putCanonicalQuarantineObject(
      quar.receipt,
      quar.bytes,
      mismatchedGcsGeneration
    );

    const txBefore = fx.db.transactionCount;
    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: quar.receipt.receiptId,
      actorUid: 'user_quar_mismatch_04',
    });

    assert(
      res.ok === false,
      'Expected generation mismatch on Quarantined receipt to fail'
    );
    if (res.ok) return;

    assert(
      res.status === 'QUARANTINED_INTEGRITY_FAILURE',
      `Expected status QUARANTINED_INTEGRITY_FAILURE, got ${res.status}`
    );
    assert(
      res.errorCode === 'QUARANTINED_GENERATION_MISMATCH',
      `Expected errorCode QUARANTINED_GENERATION_MISMATCH, got ${res.errorCode}`
    );
    assert(res.casPerformed === false, 'casPerformed must be false');
    assert(
      fx.db.transactionCount === txBefore,
      'Firestore receipt must not be modified on integrity failure'
    );
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [
      quar.receipt.storagePath,
      storedGeneration,
      mismatchedGcsGeneration,
      fx.bucket.name,
    ]);
  });

  // Test 5: Reserved receipt -> NOT_RECOVERABLE_STATE, zero GCS calls
  await test('5. Reserved receipt returns NOT_RECOVERABLE_STATE with zero GCS calls and zero CAS mutations', async () => {
    const fx = createRecoveryTestFixture();
    const reserved = await fx.seedReservedReceipt(
      'PDF',
      'user_reserved_deny_05'
    );

    const txBefore = fx.db.transactionCount;
    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: reserved.receipt.receiptId,
      actorUid: 'user_reserved_deny_05',
    });

    assert(res.ok === false, 'Expected Reserved receipt recovery to be denied');
    if (res.ok) return;

    assert(
      res.status === 'NOT_RECOVERABLE_STATE',
      `Expected NOT_RECOVERABLE_STATE, got ${res.status}`
    );
    assert(
      res.errorCode === 'RESERVED_STATE_NOT_RECOVERABLE',
      `Expected RESERVED_STATE_NOT_RECOVERABLE, got ${res.errorCode}`
    );
    assert(res.gcsReadbackAttempted === false, 'Must not probe GCS');
    assert(res.casPerformed === false, 'Must not perform CAS');
    assert(
      fx.bucket.getMetadataCalls === 0 &&
        fx.bucket.createReadStreamCalls === 0 &&
        fx.bucket.saveCalls === 0,
      'Zero GCS operations allowed for Reserved state'
    );
    assert(
      fx.db.transactionCount === txBefore,
      'Zero Firestore CAS transactions allowed for Reserved state'
    );
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [reserved.receipt.storagePath, fx.bucket.name]);
  });

  // Test 6: Rejected receipt -> rejected/not recoverable, zero GCS calls
  await test('6. Rejected receipt returns NOT_RECOVERABLE_STATE (REJECTED_STATE_TERMINAL) with zero GCS calls and zero CAS mutations', async () => {
    const fx = createRecoveryTestFixture();
    const rejected = await fx.seedRejectedReceipt(
      'PDF',
      'user_rejected_deny_06'
    );

    const txBefore = fx.db.transactionCount;
    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: rejected.receipt.receiptId,
      actorUid: 'user_rejected_deny_06',
    });

    assert(res.ok === false, 'Expected Rejected receipt recovery to be denied');
    if (res.ok) return;

    assert(
      res.status === 'NOT_RECOVERABLE_STATE',
      `Expected NOT_RECOVERABLE_STATE, got ${res.status}`
    );
    assert(
      res.errorCode === 'REJECTED_STATE_TERMINAL',
      `Expected REJECTED_STATE_TERMINAL, got ${res.errorCode}`
    );
    assert(res.gcsReadbackAttempted === false, 'Must not probe GCS');
    assert(res.casPerformed === false, 'Must not perform CAS');
    assert(
      fx.bucket.getMetadataCalls === 0 &&
        fx.bucket.createReadStreamCalls === 0 &&
        fx.bucket.saveCalls === 0,
      'Zero GCS operations allowed for Rejected state'
    );
    assert(
      fx.db.transactionCount === txBefore,
      'Zero Firestore CAS transactions allowed for Rejected state'
    );
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [rejected.receipt.storagePath, fx.bucket.name]);
  });

  // Test 7: actorUid !== receipt.uploaderUid -> rejected, zero GCS calls and zero CAS mutations
  await test('7. actorUid !== receipt.uploaderUid is rejected before any GCS probe or CAS mutation', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('PDF', 'user_true_owner_07');
    fx.bucket.putCanonicalQuarantineObject(
      wp.receipt,
      wp.bytes,
      '1731000777000'
    );

    const txBefore = fx.db.transactionCount;
    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: wp.receipt.receiptId,
      actorUid: 'user_intruder_07',
    });

    assert(res.ok === false, 'Expected mismatched actorUid to fail');
    if (res.ok) return;

    assert(
      res.status === 'PREFLIGHT_REJECTED',
      `Expected PREFLIGHT_REJECTED, got ${res.status}`
    );
    assert(
      res.errorCode === 'ACTOR_OWNERSHIP_MISMATCH',
      `Expected ACTOR_OWNERSHIP_MISMATCH, got ${res.errorCode}`
    );
    assert(res.gcsReadbackAttempted === false, 'Must not probe GCS');
    assert(res.casPerformed === false, 'Must not perform CAS');
    assert(
      fx.bucket.getMetadataCalls === 0 &&
        fx.bucket.createReadStreamCalls === 0,
      'Zero GCS calls allowed when actorUid does not match uploaderUid'
    );
    assert(
      fx.db.transactionCount === txBefore,
      'Zero Firestore CAS transactions allowed when actorUid mismatches'
    );
    assertAllSecurityFlagsFalse(res);
  });

  // Test 8: Caller-supplied untrusted fields -> rejected
  await test('8. Caller-supplied untrusted fields (storagePath, generation, attestation, state, sha256, bytes, force) are rejected', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('PDF', 'user_untrusted_08');

    const forbiddenFields = [
      { storagePath: wp.receipt.storagePath },
      { generation: '1731000888000' },
      { attestation: {} },
      { state: 'Quarantined' },
      { sha256: wp.receipt.sha256 },
      { bytes: wp.bytes },
      { force: true },
      { receipt: wp.receipt },
      { reconcile: true },
      { reject: false },
    ];

    for (const extra of forbiddenFields) {
      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: wp.receipt.receiptId,
        actorUid: 'user_untrusted_08',
        ...extra,
      });
      assert(res.ok === false, 'Expected untrusted caller field to be rejected');
      if (!res.ok) {
        assert(
          res.status === 'PREFLIGHT_REJECTED' &&
            res.errorCode === 'UNTRUSTED_CALLER_FIELD',
          `Expected UNTRUSTED_CALLER_FIELD, got ${res.errorCode}`
        );
      }
    }
    assert(
      fx.bucket.getMetadataCalls === 0,
      'Zero GCS calls allowed on untrusted input'
    );
  });

  // Test 9: WritePending + missing GCS object (404) -> single CAS to NeedsReconciliation, not Rejected, zero uploads
  await test('9. WritePending + missing GCS object (404) transitions via single CAS to NeedsReconciliation (never Rejected, zero uploads)', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('PDF', 'user_wp_missing_09');

    const txBefore = fx.db.transactionCount;
    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: wp.receipt.receiptId,
      actorUid: 'user_wp_missing_09',
    });

    assert(res.ok === false, 'Expected missing GCS object to fail recovery');
    if (res.ok) return;

    assert(
      res.status === 'TRANSITIONED_TO_NEEDS_RECONCILIATION',
      `Expected TRANSITIONED_TO_NEEDS_RECONCILIATION, got ${res.status}`
    );
    assert(
      res.errorCode === 'STORED_OBJECT_NOT_FOUND',
      `Expected STORED_OBJECT_NOT_FOUND, got ${res.errorCode}`
    );
    assert(
      res.previousState === LibraryQuarantineReceiptState.WritePending,
      'previousState must be WritePending'
    );
    assert(
      res.state === LibraryQuarantineReceiptState.NeedsReconciliation,
      'state must be NeedsReconciliation (never Rejected)'
    );
    assert(res.casPerformed === true, 'casPerformed must be true');
    assert(
      fx.db.transactionCount === txBefore + 1,
      'Exactly 1 CAS transaction to NeedsReconciliation must occur'
    );
    assert(fx.bucket.saveCalls === 0, 'Zero GCS uploads allowed');

    const stored = await fx.receiptStore.getReceiptById(wp.receipt.receiptId);
    assert(
      stored.ok &&
        stored.envelope.state ===
          LibraryQuarantineReceiptState.NeedsReconciliation,
      'Persisted receipt must be in NeedsReconciliation'
    );
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [wp.receipt.storagePath, fx.bucket.name]);
  });

  // Test 10: NeedsReconciliation + missing GCS object (404) -> remains NeedsReconciliation, no new CAS, not Rejected, zero uploads
  await test('10. NeedsReconciliation + missing GCS object (404) preserves NeedsReconciliation with zero CAS mutations and never rejects', async () => {
    const fx = createRecoveryTestFixture();
    const recon = await fx.seedNeedsReconciliationReceipt(
      'DOCX',
      'user_recon_missing_10'
    );

    const txBefore = fx.db.transactionCount;
    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: recon.receipt.receiptId,
      actorUid: 'user_recon_missing_10',
    });

    assert(res.ok === false, 'Expected missing GCS object to remain unresolved');
    if (res.ok) return;

    assert(
      res.status === 'UNRESOLVED_NEEDS_RECONCILIATION',
      `Expected UNRESOLVED_NEEDS_RECONCILIATION, got ${res.status}`
    );
    assert(
      res.errorCode === 'STORED_OBJECT_NOT_FOUND',
      `Expected STORED_OBJECT_NOT_FOUND, got ${res.errorCode}`
    );
    assert(
      res.state === LibraryQuarantineReceiptState.NeedsReconciliation,
      'state must remain NeedsReconciliation'
    );
    assert(
      res.revision === recon.revision,
      'revision must remain unchanged without new CAS'
    );
    assert(res.casPerformed === false, 'casPerformed must be false');
    assert(
      fx.db.transactionCount === txBefore,
      'Zero new CAS transactions allowed when already in NeedsReconciliation'
    );
    assert(fx.bucket.saveCalls === 0, 'Zero GCS uploads allowed');
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [recon.receipt.storagePath, fx.bucket.name]);
  });

  // Test 11: Existing GCS object with wrong SHA-256, wrong size, wrong MIME, wrong owner metadata, public ACL or Firebase download token -> rejected/preserved as reconciliation or integrity failure; never Quarantined
  await test('11. Existing GCS object with wrong SHA-256, wrong size, wrong MIME, wrong owner, public ACL, or Firebase download token is never Quarantined', async () => {
    // 11a: Wrong SHA-256 (tampered bytes of same length)
    {
      const fx = createRecoveryTestFixture();
      const recon = await fx.seedNeedsReconciliationReceipt(
        'PDF',
        'user_tamper_sha_11'
      );
      const tamperedBytes = Buffer.from(recon.bytes);
      const idx = tamperedBytes.indexOf('Catalog');
      tamperedBytes.write('atalogX', idx, 'utf8');
      fx.bucket.putCanonicalQuarantineObject(
        recon.receipt,
        tamperedBytes,
        '1731001100001'
      );

      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: recon.receipt.receiptId,
        actorUid: 'user_tamper_sha_11',
      });
      assert(
        !res.ok &&
          res.status === 'UNRESOLVED_NEEDS_RECONCILIATION' &&
          res.errorCode === 'GCS_OBJECT_CONFLICT_OR_MISMATCH',
        'Tampered SHA-256 bytes must be rejected'
      );
    }

    // 11b: Wrong byteSize
    {
      const fx = createRecoveryTestFixture();
      const recon = await fx.seedNeedsReconciliationReceipt(
        'PDF',
        'user_tamper_size_11'
      );
      const paddedBytes = Buffer.concat([recon.bytes, Buffer.from('\n%extra')]);
      fx.bucket.putCanonicalQuarantineObject(
        recon.receipt,
        paddedBytes,
        '1731001100002'
      );

      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: recon.receipt.receiptId,
        actorUid: 'user_tamper_size_11',
      });
      assert(
        !res.ok &&
          res.status === 'UNRESOLVED_NEEDS_RECONCILIATION' &&
          res.errorCode === 'GCS_OBJECT_CONFLICT_OR_MISMATCH',
        'Mismatched byteSize must be rejected'
      );
    }

    // 11c: Wrong MIME type
    {
      const fx = createRecoveryTestFixture();
      const recon = await fx.seedNeedsReconciliationReceipt(
        'PDF',
        'user_tamper_mime_11'
      );
      fx.bucket.putCanonicalQuarantineObject(
        recon.receipt,
        recon.bytes,
        '1731001100003',
        { contentType: 'text/html' }
      );

      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: recon.receipt.receiptId,
        actorUid: 'user_tamper_mime_11',
      });
      assert(
        !res.ok &&
          res.status === 'UNRESOLVED_NEEDS_RECONCILIATION' &&
          res.errorCode === 'GCS_OBJECT_CONFLICT_OR_MISMATCH',
        'Mismatched MIME must be rejected'
      );
    }

    // 11d: Wrong owner metadata in GCS
    {
      const fx = createRecoveryTestFixture();
      const recon = await fx.seedNeedsReconciliationReceipt(
        'PDF',
        'user_tamper_owner_11'
      );
      fx.bucket.putCanonicalQuarantineObject(
        recon.receipt,
        recon.bytes,
        '1731001100004',
        {
          metadata: {
            receiptId: recon.receipt.receiptId,
            uploaderUid: 'different_uploader_uid',
            sha256: recon.receipt.sha256,
            format: recon.receipt.format,
            quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
          },
        }
      );

      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: recon.receipt.receiptId,
        actorUid: 'user_tamper_owner_11',
      });
      assert(
        !res.ok &&
          res.status === 'UNRESOLVED_NEEDS_RECONCILIATION' &&
          res.errorCode === 'GCS_OBJECT_CONFLICT_OR_MISMATCH',
        'Mismatched GCS owner metadata must be rejected'
      );
    }

    // 11e: Public ACL grant on GCS object
    {
      const fx = createRecoveryTestFixture();
      const wp = await fx.seedWritePendingReceipt('PDF', 'user_public_acl_11');
      fx.bucket.putCanonicalQuarantineObject(
        wp.receipt,
        wp.bytes,
        '1731001100005',
        {
          acl: [{ entity: 'allUsers', role: 'READER' }],
        }
      );

      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: wp.receipt.receiptId,
        actorUid: 'user_public_acl_11',
      });
      assert(
        !res.ok &&
          res.status === 'TRANSITIONED_TO_NEEDS_RECONCILIATION' &&
          res.errorCode === 'GCS_OBJECT_CONFLICT_OR_MISMATCH',
        'Public ACL on GCS object must transition WritePending to NeedsReconciliation'
      );
    }

    // 11f: Firebase download token present on GCS object
    {
      const fx = createRecoveryTestFixture();
      const quar = await fx.seedQuarantinedReceipt(
        '1731001100006',
        'PDF',
        'user_token_11'
      );
      fx.bucket.putCanonicalQuarantineObject(
        quar.receipt,
        quar.bytes,
        '1731001100006',
        {
          firebaseStorageDownloadTokens: 'secret-firebase-download-token-12345',
        }
      );

      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: quar.receipt.receiptId,
        actorUid: 'user_token_11',
      });
      assert(
        !res.ok &&
          res.status === 'QUARANTINED_INTEGRITY_FAILURE' &&
          res.errorCode === 'GCS_OBJECT_CONFLICT_OR_MISMATCH',
        'Firebase download token on Quarantined object must fail integrity check'
      );
      assertNoSecretLeakage(res, [
        'secret-firebase-download-token-12345',
        quar.receipt.storagePath,
      ]);
    }
  });

  // Test 12: Interrupted GCS read stream during verification -> NeedsReconciliation / unresolved, never Quarantined
  await test('12. Interrupted GCS read stream during verification transitions WritePending to NeedsReconciliation and keeps NeedsReconciliation unresolved', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('PDF', 'user_stream_drop_12');
    fx.bucket.putCanonicalQuarantineObject(
      wp.receipt,
      wp.bytes,
      '1731001200001'
    );
    fx.bucket.interruptStreamAfterBytes = 32;

    const resWp = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: wp.receipt.receiptId,
      actorUid: 'user_stream_drop_12',
    });
    assert(
      !resWp.ok &&
        resWp.status === 'TRANSITIONED_TO_NEEDS_RECONCILIATION' &&
        resWp.errorCode === 'GCS_READBACK_UNCERTAIN',
      'Interrupted stream on WritePending must transition to NeedsReconciliation with GCS_READBACK_UNCERTAIN'
    );
    assertNoSecretLeakage(resWp, [
      wp.receipt.storagePath,
      fx.bucket.name,
      'secretStreamToken',
    ]);

    // Second call (now in NeedsReconciliation) with stream still failing preserves NeedsReconciliation without new CAS
    const txBeforeSecond = fx.db.transactionCount;
    const resRecon =
      await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: wp.receipt.receiptId,
        actorUid: 'user_stream_drop_12',
      });
    assert(
      !resRecon.ok &&
        resRecon.status === 'UNRESOLVED_NEEDS_RECONCILIATION' &&
        resRecon.errorCode === 'GCS_READBACK_UNCERTAIN' &&
        resRecon.casPerformed === false,
      'Interrupted stream on NeedsReconciliation must remain UNRESOLVED_NEEDS_RECONCILIATION without CAS'
    );
    assert(
      fx.db.transactionCount === txBeforeSecond,
      'Zero CAS mutations on unresolved NeedsReconciliation'
    );
  });

  // Test 13: Malformed persisted Firestore receipt -> rejected before GCS probe
  await test('13. Malformed persisted Firestore receipt is rejected before any GCS probe', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('PDF', 'user_malformed_13');

    // Corrupt the stored document in Firestore directly
    const rawDoc = fx.db.rawGetEnvelope(wp.receipt.receiptId);
    assert(rawDoc !== undefined, 'Expected raw document in fake Firestore');
    fx.db.rawSetEnvelope(wp.receipt.receiptId, {
      ...rawDoc,
      storagePath: 'library/public/evil.pdf',
    });

    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: wp.receipt.receiptId,
      actorUid: 'user_malformed_13',
    });

    assert(res.ok === false, 'Malformed persisted receipt must be rejected');
    if (res.ok) return;

    assert(
      res.status === 'PREFLIGHT_REJECTED' &&
        res.errorCode === 'RECEIPT_STORE_READ_FAILED',
      `Expected PREFLIGHT_REJECTED / RECEIPT_STORE_READ_FAILED, got ${res.status} / ${res.errorCode}`
    );
    assert(
      res.gcsReadbackAttempted === false &&
        fx.bucket.getMetadataCalls === 0 &&
        fx.bucket.createReadStreamCalls === 0,
      'Must not probe GCS when persisted receipt is malformed'
    );
  });

  // Test 14: CAS failure where transaction actually committed Quarantined with matching generation -> bounded single reread classifies as converged without a second write
  await test('14. CAS failure where transaction actually committed Quarantined with matching generation converges via single bounded reread without second write', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('PDF', 'user_lost_ack_14');
    const expectedGeneration = '1731001400777';
    fx.bucket.putCanonicalQuarantineObject(
      wp.receipt,
      wp.bytes,
      expectedGeneration
    );

    const nextTxNum = fx.db.transactionCount + 1;
    fx.db.throwAfterCommitOnTransactionNumber = nextTxNum;
    const getCallsBefore = fx.db.getCalls;

    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: wp.receipt.receiptId,
      actorUid: 'user_lost_ack_14',
    });

    assert(
      res.ok === true,
      'Expected post-commit lost response to converge via single reread'
    );
    if (!res.ok) return;

    assert(
      res.status === 'RECOVERED_TO_QUARANTINED',
      `Expected RECOVERED_TO_QUARANTINED, got ${res.status}`
    );
    assert(
      res.convergedViaReread === true,
      'convergedViaReread must be true when classified via post-CAS reread'
    );
    assert(res.casPerformed === true, 'casPerformed must be true');
    assert(res.revision === wp.revision + 1, 'revision must be wp.revision + 1');
    assert(
      fx.db.transactionCount === nextTxNum,
      'Coordinator must NOT perform a second CAS transaction'
    );
    assert(
      fx.db.getCalls === getCallsBefore + 2,
      'Coordinator must perform initial read + at most 1 classification reread'
    );
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [
      wp.receipt.storagePath,
      expectedGeneration,
      fx.bucket.name,
    ]);
  });

  // Test 15: CAS failure where transaction did not commit -> bounded single reread returns PERSISTENCE_UNCERTAIN
  await test('15. CAS failure where transaction did not commit returns PERSISTENCE_UNCERTAIN after single bounded reread', async () => {
    const fx = createRecoveryTestFixture();
    const recon = await fx.seedNeedsReconciliationReceipt(
      'DOCX',
      'user_cas_abort_15'
    );
    const expectedGeneration = '1731001500888';
    fx.bucket.putCanonicalQuarantineObject(
      recon.receipt,
      recon.bytes,
      expectedGeneration
    );

    const nextTxNum = fx.db.transactionCount + 1;
    fx.db.failOnTransactionNumber = nextTxNum;
    const getCallsBefore = fx.db.getCalls;

    const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
      receiptId: recon.receipt.receiptId,
      actorUid: 'user_cas_abort_15',
    });

    assert(
      res.ok === false,
      'Expected aborted CAS transaction to return ok: false'
    );
    if (res.ok) return;

    assert(
      res.status === 'PERSISTENCE_UNCERTAIN',
      `Expected PERSISTENCE_UNCERTAIN, got ${res.status}`
    );
    if (res.status !== 'PERSISTENCE_UNCERTAIN') return;
    assert(
      res.errorCode === 'RECOVERY_QUARANTINE_CAS_FAILED',
      `Expected RECOVERY_QUARANTINE_CAS_FAILED, got ${res.errorCode}`
    );
    assert(
      res.lastKnownRevision === recon.revision,
      'lastKnownRevision must match pre-CAS revision'
    );
    assert(
      fx.db.transactionCount === nextTxNum,
      'Coordinator must NOT retry CAS transaction'
    );
    assert(
      fx.db.getCalls === getCallsBefore + 2,
      'Coordinator must perform initial read + 1 classification reread only'
    );
    assertAllSecurityFlagsFalse(res);
    assertNoSecretLeakage(res, [
      recon.receipt.storagePath,
      expectedGeneration,
      fx.bucket.name,
      'secret999',
    ]);
  });

  // Test 16: Concurrent transition to Rejected or different generation -> bounded reread detects conflict and never reports success
  await test('16. Concurrent transition to Rejected or different Quarantined generation is classified as CONCURRENT_STATE_CONFLICT and never success', async () => {
    // 16a: Concurrent transition to Rejected during recovery CAS
    {
      const fx = createRecoveryTestFixture();
      const recon = await fx.seedNeedsReconciliationReceipt(
        'PDF',
        'user_concurrent_reject_16'
      );
      fx.bucket.putCanonicalQuarantineObject(
        recon.receipt,
        recon.bytes,
        '1731001600111'
      );

      fx.db.onBeforeTransactionCommit = () => {
        fx.db.onBeforeTransactionCommit = null;
        const rejRes = rejectLibraryQuarantineReceipt({
          receipt: recon.receipt,
          actorUid: 'user_concurrent_reject_16',
          rejectionReasonCode: 'ADMIN_CANCELLED_CONCURRENTLY',
          nowIso: fx.advanceClock(1),
        });
        if (!rejRes.ok) throw new Error(rejRes.errorMessage);
        const raw = fx.db.rawGetEnvelope(recon.receipt.receiptId);
        fx.db.rawSetEnvelope(recon.receipt.receiptId, {
          ...raw,
          state: LibraryQuarantineReceiptState.Rejected,
          revision: recon.revision + 1,
          receipt: rejRes.receipt,
        });
      };

      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: recon.receipt.receiptId,
        actorUid: 'user_concurrent_reject_16',
      });

      assert(
        !res.ok &&
          res.status === 'CONCURRENT_STATE_CONFLICT' &&
          res.errorCode === 'CONCURRENT_STATE_CHANGE' &&
          res.state === LibraryQuarantineReceiptState.Rejected,
        'Concurrent transition to Rejected must return CONCURRENT_STATE_CONFLICT'
      );
    }

    // 16b: Concurrent transition to Quarantined with a DIFFERENT generation
    {
      const fx = createRecoveryTestFixture();
      const wp = await fx.seedWritePendingReceipt(
        'PDF',
        'user_concurrent_gen_16'
      );
      const readbackGeneration = '1731001600222';
      const competingGeneration = '1731001600999';
      fx.bucket.putCanonicalQuarantineObject(
        wp.receipt,
        wp.bytes,
        readbackGeneration
      );

      fx.db.onBeforeTransactionCommit = () => {
        fx.db.onBeforeTransactionCommit = null;
        const competingConfirm = confirmLibraryQuarantineWriteWithAttestation({
          receipt: wp.receipt,
          actorUid: 'user_concurrent_gen_16',
          attestation: {
            attestedReceiptId: wp.receipt.receiptId,
            attestedUploaderUid: wp.receipt.uploaderUid,
            attestedStoragePath: wp.receipt.storagePath,
            attestedFormat: wp.receipt.format,
            attestedContentType: wp.receipt.canonicalMimeType,
            attestedByteSize: wp.receipt.byteSize,
            attestedSha256: wp.receipt.sha256,
            attestedGeneration: competingGeneration,
            verifiedAtIso: fx.advanceClock(1),
          },
        });
        if (!competingConfirm.ok) throw new Error(competingConfirm.errorMessage);
        const raw = fx.db.rawGetEnvelope(wp.receipt.receiptId);
        fx.db.rawSetEnvelope(wp.receipt.receiptId, {
          ...raw,
          state: LibraryQuarantineReceiptState.Quarantined,
          revision: wp.revision + 1,
          receipt: competingConfirm.receipt,
        });
      };

      const res = await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: wp.receipt.receiptId,
        actorUid: 'user_concurrent_gen_16',
      });

      assert(
        !res.ok &&
          res.status === 'CONCURRENT_STATE_CONFLICT' &&
          res.errorCode === 'CONCURRENT_STATE_CHANGE',
        'Competing Quarantined generation must return CONCURRENT_STATE_CONFLICT and never claim convergence'
      );
      assertNoSecretLeakage(res, [
        wp.receipt.storagePath,
        readbackGeneration,
        competingGeneration,
      ]);
    }
  });

  // Test 17: Invalid or non-monotonic clock timestamps are rejected
  await test('17. Invalid or non-monotonic clock timestamps are rejected before any GCS probe or CAS mutation', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('PDF', 'user_clock_17');
    fx.bucket.putCanonicalQuarantineObject(
      wp.receipt,
      wp.bytes,
      '1731001700111'
    );

    // Non-monotonic timestamp earlier than wp.receipt.updatedAt
    fx.setClockTimestamp('2020-01-01T00:00:00.000Z');
    const resEarlier =
      await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: wp.receipt.receiptId,
        actorUid: 'user_clock_17',
      });

    assert(
      !resEarlier.ok &&
        resEarlier.status === 'PREFLIGHT_REJECTED' &&
        resEarlier.errorCode === 'INVALID_TIMESTAMP' &&
        resEarlier.gcsReadbackAttempted === false &&
        resEarlier.casPerformed === false,
      'Non-monotonic clock timestamp must be rejected with INVALID_TIMESTAMP'
    );

    // Malformed timestamp
    fx.setClockTimestamp('not-a-valid-iso-timestamp');
    const resMalformed =
      await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: wp.receipt.receiptId,
        actorUid: 'user_clock_17',
      });

    assert(
      !resMalformed.ok &&
        resMalformed.status === 'PREFLIGHT_REJECTED' &&
        resMalformed.errorCode === 'INVALID_TIMESTAMP' &&
        resMalformed.gcsReadbackAttempted === false,
      'Malformed clock timestamp must be rejected with INVALID_TIMESTAMP'
    );
    assert(
      fx.bucket.getMetadataCalls === 0,
      'Zero GCS calls allowed when clock is invalid or non-monotonic'
    );
  });

  // Test 18: Sanitized output contains no storagePath, generation, raw bytes, download token, signed URL, bucket name or raw stack trace
  await test('18. Sanitized output across success and failure paths leaks no storagePath, generation, raw bytes, token, URL, bucket name, or stack trace', async () => {
    const fx = createRecoveryTestFixture();
    const wp = await fx.seedWritePendingReceipt('DOCX', 'user_redact_18');
    const secretGeneration = '9876543210987654321';
    fx.bucket.putCanonicalQuarantineObject(
      wp.receipt,
      wp.bytes,
      secretGeneration
    );

    const successRes =
      await fx.coordinator.recoverExistingLibraryQuarantineReceipt({
        receiptId: wp.receipt.receiptId,
        actorUid: 'user_redact_18',
      });

    assert(successRes.ok, 'Expected recovery to succeed');
    assertNoSecretLeakage(successRes, [
      wp.receipt.storagePath,
      secretGeneration,
      fx.bucket.name,
      'Bearer ',
      'https://',
      'gs://',
    ]);

    const dtoKeys = Object.keys(successRes.adminReceiptDto ?? {});
    assert(
      !dtoKeys.includes('storagePath') &&
        !dtoKeys.includes('generation') &&
        !dtoKeys.includes('bytes'),
      'adminReceiptDto must not include storagePath, generation, or bytes'
    );
  });

  // Test 19: Across all tests, GCS save() and delete calls equal 0, receiptId never changes, and module is pure/isolated
  await test('19. Across all tests, GCS save() and delete() calls equal 0, receiptId is immutable, and recovery coordinator has zero live SDK or write calls', async () => {
    assert(
      globalSaveCallCount === 0,
      `Expected 0 GCS save() calls across entire test suite, found ${globalSaveCallCount}`
    );
    assert(
      globalDeleteCallCount === 0,
      `Expected 0 GCS delete() calls across entire test suite, found ${globalDeleteCallCount}`
    );

    const coordinatorSource = fs.readFileSync(
      'functions/src/library/libraryQuarantineRecoveryCoordinator.ts',
      'utf8'
    );

    assert(
      !coordinatorSource.includes('firebase-admin') &&
        !coordinatorSource.includes('@google-cloud/storage') &&
        !coordinatorSource.includes('node:http') &&
        !coordinatorSource.includes('node:https') &&
        !coordinatorSource.includes('fetch('),
      'Recovery coordinator source must not import live Firebase/GCS SDKs or network modules'
    );

    // Strip comments before checking for forbidden write method tokens
    const codeWithoutComments = coordinatorSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    assert(
      !codeWithoutComments.includes('writeQuarantineObjectIfAbsent') &&
        !codeWithoutComments.includes('.save(') &&
        !codeWithoutComments.includes('.delete(') &&
        !codeWithoutComments.includes('createReceiptIfAbsent') &&
        !codeWithoutComments.includes('createReservedReceipt'),
      'Executable code in recovery coordinator must never reference writeQuarantineObjectIfAbsent, .save(, .delete(, createReceiptIfAbsent, or createReservedReceipt'
    );
  });

  console.log(
    `\nALL ${passedTests}/${totalTests} LIB-FILE-02B2B2 QUARANTINE RECOVERY COORDINATOR TESTS PASSED.`
  );
}

runAllTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
