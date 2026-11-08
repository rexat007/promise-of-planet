import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
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
  LibraryQuarantineWriteCoordinator,
} from '../functions/src/library/libraryQuarantineWriteCoordinator';

let totalTests = 0;
let passedTests = 0;

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
  '<w:body><w:p><w:r><w:t>منسق الحجر الخاص لوثائق المكتبة البيئية 2026</w:t></w:r></w:p></w:body>' +
  '</w:document>';

function makeValidDocxBuffer(customText?: string): Buffer {
  const docXml = customText
    ? CANONICAL_WORD_DOCUMENT_XML.replace(
        'منسق الحجر الخاص لوثائق المكتبة البيئية 2026',
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

class FakeCoordinatorFirestoreDb implements LibraryQuarantineFirestoreDatabase {
  private readonly docs = new Map<string, { version: number; data: unknown }>();
  public readonly eventLog: string[] = [];
  public casSetsCommitted = 0;
  public failOnTransactionNumber: number | null = null;
  public transactionCount = 0;
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
      this.eventLog.push(`FIRESTORE_TX_ABORTED:${currentTxNum}`);
      throw new Error(
        `ABORTED: Simulated Firestore transaction failure on tx #${currentTxNum} for https://firestore.googleapis.com/secret_token=xyz123`
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

    return result;
  }
}

class FakeCoordinatorGcsBucket implements GcsLibraryQuarantineBucket {
  public readonly name = 'promise-of-planet-quarantine-coordinator-test';
  public readonly objects = new Map<
    string,
    { bytes: Buffer; metadata: GcsLibraryQuarantineObjectMetadata }
  >();
  public readonly eventLog: string[] = [];
  public saveCalls = 0;
  public getMetadataCalls = 0;
  public createReadStreamCalls = 0;
  public nextSaveError: unknown = null;
  public nextGetMetadataError: unknown = null;
  public onSaveInspectFirestoreState: (() => void) | null = null;
  private generationSeq = 1730990000000;

  public constructor(private readonly sharedEventLog?: string[]) {}

  private logEvent(entry: string): void {
    this.eventLog.push(entry);
    this.sharedEventLog?.push(entry);
  }

  public putExistingObject(
    objectPath: string,
    bytes: Buffer,
    metadata: GcsLibraryQuarantineObjectMetadata
  ): void {
    this.objects.set(objectPath, {
      bytes: Buffer.from(bytes),
      metadata: { ...metadata },
    });
  }

  public file(objectPath: string): GcsLibraryQuarantineFile {
    const bucket = this;
    return {
      name: objectPath,
      async save(
        data: Buffer,
        options: GcsLibraryQuarantineSaveOptions
      ): Promise<void> {
        bucket.saveCalls += 1;
        bucket.logEvent(`GCS_SAVE:${objectPath}`);

        if (bucket.onSaveInspectFirestoreState) {
          bucket.onSaveInspectFirestoreState();
        }

        if (bucket.nextSaveError !== null) {
          const err = bucket.nextSaveError;
          bucket.nextSaveError = null;
          throw err;
        }

        if (options.preconditionOpts.ifGenerationMatch !== 0) {
          throw new Error('Expected ifGenerationMatch === 0');
        }

        if (bucket.objects.has(objectPath)) {
          const precondErr = new Error(
            'Precondition Failed: conditionNotMet (412)'
          ) as Error & { code: number };
          precondErr.code = 412;
          throw precondErr;
        }

        bucket.generationSeq += 1;
        const generation = String(bucket.generationSeq);
        const copied = Buffer.from(
          data.buffer,
          data.byteOffset,
          data.byteLength
        );

        bucket.objects.set(objectPath, {
          bytes: copied,
          metadata: {
            name: objectPath,
            bucket: bucket.name,
            generation,
            contentType: options.contentType,
            cacheControl: options.metadata.cacheControl,
            contentDisposition: options.metadata.contentDisposition,
            size: String(copied.byteLength),
            metadata: { ...options.metadata.metadata },
          },
        });
      },

      async getMetadata(): Promise<
        [GcsLibraryQuarantineObjectMetadata, unknown?]
      > {
        bucket.getMetadataCalls += 1;
        bucket.logEvent(`GCS_GET_METADATA:${objectPath}`);

        if (bucket.nextGetMetadataError !== null) {
          const err = bucket.nextGetMetadataError;
          bucket.nextGetMetadataError = null;
          throw err;
        }

        const stored = bucket.objects.get(objectPath);
        if (!stored) {
          const notFound = new Error('No such object (404)') as Error & {
            code: number;
          };
          notFound.code = 404;
          throw notFound;
        }
        return [{ ...stored.metadata }, {}];
      },

      createReadStream(
        _options?: GcsLibraryQuarantineReadStreamOptions
      ): GcsLibraryQuarantineReadableStream {
        bucket.createReadStreamCalls += 1;
        bucket.logEvent(`GCS_READ_STREAM:${objectPath}`);
        let destroyed = false;
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
            for (let i = 0; i < buf.length; i += 64) {
              if (destroyed) return;
              yield buf.subarray(i, Math.min(i + 64, buf.length));
            }
          },
        };
      },
    };
  }
}

function makeSequenceClock(
  timestamps: readonly string[]
): () => string {
  let idx = 0;
  return () => {
    const val = timestamps[Math.min(idx, timestamps.length - 1)];
    idx += 1;
    return val;
  };
}

async function seedReservedReceipt(
  store: FirestoreLibraryQuarantineReceiptStore,
  options?: {
    format?: 'DOCX' | 'PDF';
    uploaderUid?: string;
    bytes?: Buffer;
    createdAt?: string;
  }
): Promise<{
  readonly reservedReceipt: LibraryQuarantineInternalReceipt;
  readonly bytes: Buffer;
}> {
  const format = options?.format ?? 'DOCX';
  const uploaderUid = options?.uploaderUid ?? 'admin_curator_01';
  const createdAt = options?.createdAt ?? '2026-11-07T14:00:00.000Z';
  const bytes =
    options?.bytes ??
    (format === 'DOCX' ? makeValidDocxBuffer() : makeValidPdfBuffer());

  const res = reserveLibraryQuarantineReceipt({
    uploaderUid,
    originalFilename:
      format === 'DOCX' ? 'biodiversity-2026.docx' : 'climate-2026.pdf',
    claimedMimeType:
      format === 'DOCX' ? CANONICAL_DOCX_MIME_TYPE : CANONICAL_PDF_MIME_TYPE,
    bytes,
    nowIso: createdAt,
  });
  if (!res.ok) {
    throw new Error(`Failed to reserve receipt: ${res.errorMessage}`);
  }

  const createRes = await store.createReceiptIfAbsent(res.receipt);
  if (!createRes.ok) {
    throw new Error(`Failed to persist Reserved receipt: ${createRes.errorMessage}`);
  }

  return {
    reservedReceipt: createRes.envelope.receipt,
    bytes,
  };
}

async function runAllTests(): Promise<void> {
  await test('1. Reserved -> WritePending -> Quarantined full converged flow', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:00:05.000Z',
      '2026-11-07T14:00:10.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store, {
      format: 'DOCX',
    });

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(result.ok, 'Expected executeReservedQuarantineWrite to succeed');
    if (!result.ok) return;

    assert(result.status === 'QUARANTINED', 'Expected status QUARANTINED');
    assert(result.revision === 3, 'Expected revision 3 (1:Reserved -> 2:WritePending -> 3:Quarantined)');
    assert(
      result.gcsDisposition === 'WRITTEN_AND_VERIFIED' &&
        result.createdNewGcsObject === true,
      'Expected WRITTEN_AND_VERIFIED with createdNewGcsObject=true'
    );
    assert(
      result.adminReceiptDto.state === LibraryQuarantineReceiptState.Quarantined &&
        result.adminReceiptDto.hasVerifiedStorageWrite === true,
      'Expected sanitized admin DTO in Quarantined state with hasVerifiedStorageWrite=true'
    );

    // Verify stored Firestore record is at revision 3 Quarantined
    const persisted = await store.getReceiptById(reservedReceipt.receiptId);
    assert(
      persisted.ok &&
        persisted.envelope.revision === 3 &&
        persisted.envelope.state === LibraryQuarantineReceiptState.Quarantined &&
        persisted.envelope.receipt.generation !== null,
      'Persisted Firestore receipt must be at revision 3 Quarantined with verified generation'
    );
  });

  await test('2. Firestore CAS (Reserved -> WritePending) occurs strictly BEFORE GCS write', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:01:05.000Z',
      '2026-11-07T14:01:10.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store, {
      format: 'PDF',
    });

    let firestoreStateDuringGcsSave: string | null = null;
    let firestoreRevDuringGcsSave: number | null = null;

    bucket.onSaveInspectFirestoreState = () => {
      const env = db.rawGetEnvelope(reservedReceipt.receiptId);
      firestoreStateDuringGcsSave = env ? String(env.state) : null;
      firestoreRevDuringGcsSave = env ? Number(env.revision) : null;
    };

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(result.ok, 'Expected execution to succeed');
    assert(
      firestoreStateDuringGcsSave ===
        LibraryQuarantineReceiptState.WritePending &&
        firestoreRevDuringGcsSave === 2,
      `Firestore receipt MUST already be committed as WritePending (rev 2) when GCS save() runs; found state=${String(firestoreStateDuringGcsSave)}, rev=${String(firestoreRevDuringGcsSave)}`
    );

    const wpCommitIdx = db.eventLog.findIndex((e) =>
      e.includes(`FIRESTORE_COMMIT:set:${reservedReceipt.receiptId}:WritePending:rev=2`)
    );
    const gcsSaveIdx = db.eventLog.findIndex((e) =>
      e.includes(`GCS_SAVE:${reservedReceipt.storagePath}`)
    );
    const quarCommitIdx = db.eventLog.findIndex((e) =>
      e.includes(`FIRESTORE_COMMIT:set:${reservedReceipt.receiptId}:Quarantined:rev=3`)
    );
    assert(
      wpCommitIdx >= 0 &&
        gcsSaveIdx > wpCommitIdx &&
        quarCommitIdx > gcsSaveIdx,
      'Event ordering must be strictly: WritePending CAS -> GCS Save -> Quarantined CAS'
    );
  });

  await test('3. Stale revision or failed WritePending CAS blocks GCS write completely', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:02:05.000Z',
      '2026-11-07T14:02:10.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);

    // Inject concurrent modification right before the Reserved -> WritePending transaction commits (tx #2)
    db.onBeforeTransactionCommit = (txNum, docId) => {
      if (txNum === 2) {
        const rej = rejectLibraryQuarantineReceipt({
          receipt: reservedReceipt,
          actorUid: reservedReceipt.uploaderUid,
          rejectionReasonCode: 'CONCURRENT_ADMIN_CANCEL',
          nowIso: '2026-11-07T14:02:01.000Z',
        });
        if (!rej.ok) throw new Error('Failed to build concurrent rejection');
        db.rawSetEnvelope(docId, {
          schemaVersion: 1,
          revision: 2,
          state: rej.receipt.state,
          receipt: rej.receipt,
        });
      }
    };

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(
      !result.ok &&
        result.status === 'WRITE_PENDING_CAS_FAILED' &&
        result.errorCode === 'WRITE_PENDING_CAS_CONFLICT_OR_FAILURE' &&
        result.gcsWriteAttempted === false,
      'Failed WritePending CAS must return WRITE_PENDING_CAS_FAILED with gcsWriteAttempted=false'
    );
    assert(
      bucket.saveCalls === 0 &&
        bucket.getMetadataCalls === 0 &&
        bucket.createReadStreamCalls === 0,
      'Zero GCS calls may occur when WritePending CAS fails'
    );
  });

  await test('4. Invalid identity, wrong owner, wrong byteSize, or mismatched SHA-256 blocks writing before any CAS or GCS call', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock(['2026-11-07T14:03:05.000Z']);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);
    const casBefore = db.casSetsCommitted;

    // 4a. Invalid receiptId
    const badIdRes = await coordinator.executeReservedQuarantineWrite({
      receiptId: 'NOT_A_VALID_HEX_ID',
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });
    assert(
      !badIdRes.ok &&
        badIdRes.status === 'PREFLIGHT_REJECTED' &&
        badIdRes.errorCode === 'INVALID_RECEIPT_ID',
      'Invalid receiptId must be rejected at preflight'
    );

    // 4b. Wrong actorUid (ownership mismatch)
    const wrongOwnerRes = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: 'intruder_admin_99',
      bytes,
    });
    assert(
      !wrongOwnerRes.ok &&
        wrongOwnerRes.status === 'PREFLIGHT_REJECTED' &&
        wrongOwnerRes.errorCode === 'ACTOR_OWNERSHIP_MISMATCH',
      'Mismatched actorUid must be rejected with ACTOR_OWNERSHIP_MISMATCH'
    );

    // 4c. Same byte length, tampered SHA-256
    const sameLenTampered = Buffer.from(bytes);
    sameLenTampered[sameLenTampered.length - 8] ^= 0xff;
    const wrongShaRes = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes: sameLenTampered,
    });
    assert(
      !wrongShaRes.ok &&
        wrongShaRes.status === 'PREFLIGHT_REJECTED' &&
        wrongShaRes.errorCode === 'INPUT_SHA256_MISMATCH',
      'Tampered bytes with same length must be rejected with INPUT_SHA256_MISMATCH'
    );

    // 4d. Wrong byte length
    const wrongSizeRes = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes: Buffer.concat([bytes, Buffer.from('EXTRA')]),
    });
    assert(
      !wrongSizeRes.ok &&
        wrongSizeRes.status === 'PREFLIGHT_REJECTED' &&
        wrongSizeRes.errorCode === 'INPUT_BYTE_SIZE_MISMATCH',
      'Wrong byteSize must be rejected with INPUT_BYTE_SIZE_MISMATCH'
    );

    // 4e. Caller-supplied untrusted field (e.g., storagePath override)
    const untrustedRes = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
      storagePath: 'library/quarantine/override/source.docx',
    });
    assert(
      !untrustedRes.ok &&
        untrustedRes.status === 'PREFLIGHT_REJECTED' &&
        untrustedRes.errorCode === 'UNTRUSTED_CALLER_FIELD',
      'Caller-supplied extra field must be rejected with UNTRUSTED_CALLER_FIELD'
    );

    assert(
      db.casSetsCommitted === casBefore && bucket.saveCalls === 0,
      'Zero Firestore CAS mutations or GCS saves may occur on preflight failures'
    );
  });

  await test('5. Non-Reserved initial states (WritePending, NeedsReconciliation, Quarantined, Rejected) block new uploads', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:04:05.000Z',
      '2026-11-07T14:04:10.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);

    // Transition receipt to WritePending in Firestore
    const wp = beginLibraryQuarantineWritePending({
      receipt: reservedReceipt,
      actorUid: reservedReceipt.uploaderUid,
      nowIso: '2026-11-07T14:04:01.000Z',
    });
    assert(wp.ok, 'wp transition must succeed');
    if (!wp.ok) return;

    await store.compareAndSwapReceipt({
      receiptId: reservedReceipt.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: reservedReceipt,
      nextReceipt: wp.receipt,
    });

    // Attempting executeReservedQuarantineWrite on an already WritePending receipt must fail closed
    const restartWpAttempt = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });
    assert(
      !restartWpAttempt.ok &&
        restartWpAttempt.status === 'PREFLIGHT_REJECTED' &&
        restartWpAttempt.errorCode === 'INVALID_INITIAL_RECEIPT_STATE' &&
        restartWpAttempt.gcsWriteAttempted === false &&
        bucket.saveCalls === 0,
      'Existing WritePending receipt must NOT be automatically restarted by executeReservedQuarantineWrite'
    );
  });

  await test('6. Verified existing GCS object converges to Quarantined without overwrite', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:05:05.000Z',
      '2026-11-07T14:05:10.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store, {
      format: 'DOCX',
    });

    // Pre-populate matching verified object at canonical path with generation '777000111'
    bucket.putExistingObject(reservedReceipt.storagePath, bytes, {
      name: reservedReceipt.storagePath,
      bucket: bucket.name,
      generation: '777000111',
      contentType: CANONICAL_DOCX_MIME_TYPE,
      cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
      contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      size: String(bytes.byteLength),
      metadata: {
        receiptId: reservedReceipt.receiptId,
        uploaderUid: reservedReceipt.uploaderUid,
        sha256: reservedReceipt.sha256,
        format: 'DOCX',
        quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      },
    });

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(result.ok, 'Expected EXISTING_VERIFIED object to converge to QUARANTINED');
    if (!result.ok) return;

    assert(
      result.status === 'QUARANTINED' &&
        result.gcsDisposition === 'EXISTING_VERIFIED' &&
        result.createdNewGcsObject === false &&
        result.revision === 3,
      'Expected QUARANTINED with EXISTING_VERIFIED and createdNewGcsObject=false'
    );
    assert(
      bucket.objects.get(reservedReceipt.storagePath)?.metadata.generation ===
        '777000111',
      'Existing GCS object generation must be preserved without overwrite'
    );
  });

  await test('7. GCS ambiguous outcome transitions Firestore receipt to NeedsReconciliation via 1 bounded CAS', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:06:05.000Z',
      '2026-11-07T14:06:10.000Z',
      '2026-11-07T14:06:15.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);

    bucket.nextSaveError = new Error(
      `ETIMEDOUT: Socket timeout writing to ${reservedReceipt.storagePath}`
    );

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(
      !result.ok &&
        result.status === 'NEEDS_RECONCILIATION' &&
        result.errorCode === 'GCS_WRITE_NEEDS_RECONCILIATION' &&
        result.reconciliationPersisted === true &&
        result.revision === 3,
      'Ambiguous GCS write must converge Firestore receipt to NeedsReconciliation at revision 3'
    );

    const persisted = await store.getReceiptById(reservedReceipt.receiptId);
    assert(
      persisted.ok &&
        persisted.envelope.state ===
          LibraryQuarantineReceiptState.NeedsReconciliation &&
        persisted.envelope.revision === 3 &&
        persisted.envelope.receipt.receiptId === reservedReceipt.receiptId &&
        persisted.envelope.receipt.storagePath === reservedReceipt.storagePath,
      'Persisted receipt must be in NeedsReconciliation with original receiptId and storagePath preserved'
    );
  });

  await test('8. GCS conflicting existing object cannot be treated as successful and transitions to NeedsReconciliation', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:07:05.000Z',
      '2026-11-07T14:07:10.000Z',
      '2026-11-07T14:07:15.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store, {
      format: 'PDF',
    });

    const conflictingBytes = makeValidPdfBuffer('CONFLICTING_OBJECT_DATA');
    bucket.putExistingObject(reservedReceipt.storagePath, conflictingBytes, {
      name: reservedReceipt.storagePath,
      bucket: bucket.name,
      generation: '888999000',
      contentType: CANONICAL_PDF_MIME_TYPE,
      cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
      contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      size: String(conflictingBytes.byteLength),
      metadata: {
        receiptId: reservedReceipt.receiptId,
        uploaderUid: 'different_uploader',
        sha256: 'a'.repeat(64),
        format: 'PDF',
        quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      },
    });

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(
      !result.ok &&
        result.status === 'NEEDS_RECONCILIATION' &&
        result.errorCode === 'GCS_OBJECT_CONFLICT_OR_MISMATCH' &&
        result.reconciliationPersisted === true,
      'Conflicting existing GCS object must fail and persist NeedsReconciliation'
    );
  });

  await test('9. Successful GCS write followed by failed final Firestore CAS NEVER returns success (returns PERSISTENCE_UNCERTAIN)', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:08:05.000Z',
      '2026-11-07T14:08:10.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);

    // Transaction #1 was seedReservedReceipt; Transaction #2 is Reserved -> WritePending;
    // Transaction #3 is WritePending -> Quarantined. Fail Transaction #3!
    db.failOnTransactionNumber = 3;

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(
      !result.ok &&
        result.status === 'PERSISTENCE_UNCERTAIN' &&
        result.errorCode === 'FINAL_QUARANTINE_CAS_FAILED' &&
        result.gcsWriteAttempted === true &&
        result.lastKnownRevision === 2 &&
        result.adminReceiptDto.state ===
          LibraryQuarantineReceiptState.WritePending,
      'Failed final CAS after verified GCS write must return PERSISTENCE_UNCERTAIN (never ok: true)'
    );

    // Confirm GCS object exists while Firestore remains in WritePending (rev 2) awaiting future reconciliation
    assert(
      bucket.objects.has(reservedReceipt.storagePath),
      'GCS object must remain in place without deletion'
    );
    const storedAfter = await store.getReceiptById(reservedReceipt.receiptId);
    assert(
      storedAfter.ok &&
        storedAfter.envelope.state ===
          LibraryQuarantineReceiptState.WritePending &&
        storedAfter.envelope.revision === 2,
      'Firestore receipt remains at revision 2 WritePending when final CAS fails'
    );
  });

  await test('10. Unknown thrown GCS adapter exception fails closed and transitions to NeedsReconciliation', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:09:05.000Z',
      '2026-11-07T14:09:10.000Z',
      '2026-11-07T14:09:15.000Z',
    ]);

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);

    const throwingAdapter = {
      async writeQuarantineObjectIfAbsent(): Promise<never> {
        throw new Error(
          `UNHANDLED_GCS_CRASH: Failed writing ${reservedReceipt.storagePath} with Bearer secret_jwt_token_999`
        );
      },
    };

    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: throwingAdapter,
      clock,
    });

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(
      !result.ok &&
        result.status === 'NEEDS_RECONCILIATION' &&
        result.errorCode === 'GCS_WRITE_NEEDS_RECONCILIATION' &&
        result.reconciliationPersisted === true,
      'Thrown GCS exception must fail closed into NeedsReconciliation'
    );
    assert(
      !result.errorMessage.includes(reservedReceipt.storagePath) &&
        !result.errorMessage.includes('secret_jwt_token_999'),
      'Thrown exception message must have storagePath and Bearer token redacted'
    );
  });

  await test('11. No automatic upload retry on GCS failure or reconciliation CAS failure', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:10:05.000Z',
      '2026-11-07T14:10:10.000Z',
      '2026-11-07T14:10:15.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);
    bucket.nextSaveError = new Error('503 Service Unavailable');

    await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(
      bucket.saveCalls === 1,
      `Coordinator must attempt GCS save once only (saveCalls=${bucket.saveCalls})`
    );
  });

  await test('12. No invented or rotated receipt identity across success, conflict, or uncertain outcomes', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:11:05.000Z',
      '2026-11-07T14:11:10.000Z',
      '2026-11-07T14:11:15.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);
    bucket.nextGetMetadataError = new Error('Socket hang up during readback');

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(
      result.receiptId === reservedReceipt.receiptId &&
        result.adminReceiptDto?.receiptId === reservedReceipt.receiptId,
      'Coordinator must preserve the exact input receiptId without generating any replacement ID'
    );
  });

  await test('13. No secret, token, URL, generation, attestation, or storage-path exposure in results', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:12:05.000Z',
      '2026-11-07T14:12:10.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);
    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(result.ok, 'Expected success');
    if (!result.ok) return;

    const serializedResult = JSON.stringify(result);
    assert(
      !serializedResult.includes(reservedReceipt.storagePath) &&
        !serializedResult.includes('library/quarantine') &&
        !serializedResult.includes('attestedGeneration') &&
        !('attestation' in (result as unknown as Record<string, unknown>)) &&
        !('storagePath' in (result.adminReceiptDto as unknown as Record<string, unknown>)) &&
        !('generation' in (result.adminReceiptDto as unknown as Record<string, unknown>)),
      'Coordinator response must never leak storagePath, generation, or raw attestation'
    );
  });

  await test('14. No publication, rights, sanitization, verifiedSafe, or PEIA escalation', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:13:05.000Z',
      '2026-11-07T14:13:10.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);
    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(result.ok, 'Expected success');
    if (!result.ok) return;

    assert(
      result.bucketIamPrivacyVerified === false &&
        result.isSanitized === false &&
        result.isVerifiedSafe === false &&
        result.isRightsApproved === false &&
        result.isPublished === false &&
        result.isReadyForPeia === false &&
        result.adminReceiptDto.isSanitized === false &&
        result.adminReceiptDto.isVerifiedSafe === false &&
        result.adminReceiptDto.isRightsApproved === false &&
        result.adminReceiptDto.isPublished === false &&
        result.adminReceiptDto.isReadyForPeia === false &&
        result.adminReceiptDto.isQuarantinedPrivateOnly === true,
      'All safety, rights, publication, PEIA, and bucket IAM flags must remain false'
    );
  });

  await test('15. Crash-boundary simulation when both GCS write and NeedsReconciliation CAS fail preserves explicit PERSISTENCE_UNCERTAIN state', async () => {
    const db = new FakeCoordinatorFirestoreDb();
    const bucket = new FakeCoordinatorGcsBucket(db.eventLog);
    const store = new FirestoreLibraryQuarantineReceiptStore(db);
    const clock = makeSequenceClock([
      '2026-11-07T14:14:05.000Z',
      '2026-11-07T14:14:10.000Z',
      '2026-11-07T14:14:15.000Z',
    ]);
    const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock,
    });
    const coordinator = new LibraryQuarantineWriteCoordinator({
      receiptStore: store,
      storageAdapter: gcsAdapter,
      clock,
    });

    const { reservedReceipt, bytes } = await seedReservedReceipt(store);

    // GCS save times out AND subsequent Firestore transaction #3 (WritePending -> NeedsReconciliation) also fails
    bucket.nextSaveError = new Error('ETIMEDOUT during GCS write');
    db.failOnTransactionNumber = 3;

    const result = await coordinator.executeReservedQuarantineWrite({
      receiptId: reservedReceipt.receiptId,
      actorUid: reservedReceipt.uploaderUid,
      bytes,
    });

    assert(
      !result.ok &&
        result.status === 'PERSISTENCE_UNCERTAIN' &&
        result.errorCode === 'RECONCILIATION_CAS_FAILED' &&
        result.reconciliationPersisted === false &&
        result.lastKnownRevision === 2 &&
        result.receiptId === reservedReceipt.receiptId,
      'When both GCS write and NeedsReconciliation CAS fail, coordinator must return PERSISTENCE_UNCERTAIN / RECONCILIATION_CAS_FAILED'
    );
  });

  await test('16. Zero real Firebase or network calls and exact SHA-1 preservation of all baseline files', async () => {
    const expectedChecksums: ReadonlyArray<{
      readonly path: string;
      readonly sha1: string;
    }> = [
      {
        path: 'functions/src/library/libraryQuarantineReceiptContract.ts',
        sha1: '4b4d5f32e5903def3a3b0dcdecd45e38083f91bb',
      },
      {
        path: 'functions/src/library/firestoreLibraryQuarantineReceiptStore.ts',
        sha1: 'd9f4114222851c62c25574efbb0ffbeeb5c355e2',
      },
      {
        path: 'functions/src/library/gcsLibraryQuarantineStorageAdapter.ts',
        sha1: '4bca554dd00a5e2efc739cc166175cc63327c5ad',
      },
      {
        path: 'functions/src/library/libraryUploadBinaryAdmission.ts',
        sha1: 'ea289629676addb05d89250e7f1599b71c5fb3d0',
      },
      {
        path: 'functions/src/library/libraryUploadDeepStructure.ts',
        sha1: '7e6ba463502bc8d6c796378d6b381cdaaf01c60e',
      },
      {
        path: 'scripts/runLibraryQuarantineReceiptContractTests.ts',
        sha1: 'c4d36b366dd5ab72eaeaf9af46c79f22217ff3c1',
      },
      {
        path: 'scripts/runLibraryQuarantineReceiptStoreTests.ts',
        sha1: '2a090efdc66d8d842776b4a817aed61f9fcbdd17',
      },
      {
        path: 'scripts/runLibraryQuarantineGcsAdapterTests.ts',
        sha1: 'c389d28576f892de296837c360f3a502cf6c3230',
      },
    ];

    for (const item of expectedChecksums) {
      const content = fs.readFileSync(item.path);
      const header = Buffer.from(`blob ${content.length}\0`, 'utf8');
      const actualSha1 = createHash('sha1')
        .update(Buffer.concat([header, content]))
        .digest('hex');
      assert(
        actualSha1 === item.sha1,
        `Baseline file ${item.path} SHA-1 mismatch: expected ${item.sha1}, got ${actualSha1}`
      );
    }
  });

  console.log('------------------------------------------------------------');
  console.log(
    `LIBRARY QUARANTINE WRITE COORDINATOR TESTS: ${passedTests}/${totalTests} PASSED`
  );
}

runAllTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exitCode = 1;
});
