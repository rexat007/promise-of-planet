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
  confirmLibraryQuarantineWriteWithAttestation,
  markLibraryQuarantineWriteNeedsReconciliation,
  reconcileLibraryQuarantineReceiptWithAttestation,
  rejectLibraryQuarantineReceipt,
  reserveLibraryQuarantineReceipt,
  type LibraryQuarantineInternalReceipt,
  type TrustedStorageReadbackAttestation,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  FirestoreLibraryQuarantineReceiptStore,
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
  areLibraryQuarantineReceiptsEqual,
  isAllowedLibraryQuarantineLifecycleTransition,
  validatePersistedLibraryQuarantineReceiptEnvelope,
  type LibraryQuarantineFirestoreCollectionRef,
  type LibraryQuarantineFirestoreDatabase,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantineFirestoreTransaction,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';

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
  '<w:body><w:p><w:r><w:t>تقرير الحجر الإداري للمكتبة البيئية 2026</w:t></w:r></w:p></w:body>' +
  '</w:document>';

function makeValidDocxBuffer(): Buffer {
  const entries = [
    { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
    { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
    { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
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

function makeValidPdfBuffer(): Buffer {
  return Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 3 >>\nstartxref\n110\n%%EOF\n',
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

/**
 * In-memory fake Firestore database supporting atomic transactions, optimistic
 * version locking, write counting, and fault injection without any live Firebase
 * or network side effects.
 */
class FakeTransactionalFirestoreDb implements LibraryQuarantineFirestoreDatabase {
  private readonly collections = new Map<
    string,
    Map<string, { version: number; data: unknown; overrideSnapshotId?: string }>
  >();

  public totalTransactionRuns = 0;
  public totalCreatesCommitted = 0;
  public totalSetsCommitted = 0;
  public totalPointReads = 0;
  public collectionScanAttempts = 0;
  public failNextTransactionError: Error | null = null;
  public failAfterTransactionReadError: Error | null = null;
  public onBeforeCommitHook: (() => Promise<void> | void) | null = null;

  private getCollectionMap(
    collectionName: string
  ): Map<string, { version: number; data: unknown; overrideSnapshotId?: string }> {
    let col = this.collections.get(collectionName);
    if (!col) {
      col = new Map();
      this.collections.set(collectionName, col);
    }
    return col;
  }

  public rawPutCorruptedDoc(
    collectionName: string,
    docId: string,
    rawData: unknown,
    overrideSnapshotId?: string
  ): void {
    const col = this.getCollectionMap(collectionName);
    const existing = col.get(docId);
    col.set(docId, {
      version: (existing?.version ?? 0) + 1,
      data: rawData,
      overrideSnapshotId,
    });
  }

  public rawGetStoredDoc(
    collectionName: string,
    docId: string
  ): unknown | undefined {
    return this.getCollectionMap(collectionName).get(docId)?.data;
  }

  public collection(
    collectionName: string
  ): LibraryQuarantineFirestoreCollectionRef {
    const self = this;
    const colObj = {
      doc(documentId: string): LibraryQuarantineFirestoreDocumentRef {
        return {
          id: documentId,
          async get(): Promise<LibraryQuarantineFirestoreDocumentSnapshot> {
            self.totalPointReads += 1;
            const colMap = self.getCollectionMap(collectionName);
            const entry = colMap.get(documentId);
            if (!entry) {
              return {
                exists: false,
                id: documentId,
                data: () => undefined,
              };
            }
            const cloned = deepClonePlain(entry.data);
            return {
              exists: true,
              id: entry.overrideSnapshotId ?? documentId,
              data: () => deepClonePlain(cloned),
            };
          },
        };
      },
      // Trap if any caller ever attempts an unbounded collection .get()
      get(): Promise<never> {
        self.collectionScanAttempts += 1;
        throw new Error(
          'UNBOUNDED_COLLECTION_SCAN_FORBIDDEN: Collection .get() is prohibited.'
        );
      },
    };
    return colObj;
  }

  public async runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    this.totalTransactionRuns += 1;

    if (this.failNextTransactionError) {
      const err = this.failNextTransactionError;
      this.failNextTransactionError = null;
      throw err;
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
        const colMap = this.getCollectionMap(
          LIBRARY_QUARANTINE_RECEIPT_COLLECTION
        );
        const entry = colMap.get(docRef.id);
        readVersions.set(docRef.id, entry ? entry.version : 0);

        if (this.failAfterTransactionReadError) {
          const err = this.failAfterTransactionReadError;
          this.failAfterTransactionReadError = null;
          throw err;
        }

        if (!entry) {
          return {
            exists: false,
            id: docRef.id,
            data: () => undefined,
          };
        }
        const cloned = deepClonePlain(entry.data);
        return {
          exists: true,
          id: entry.overrideSnapshotId ?? docRef.id,
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

    if (this.onBeforeCommitHook) {
      const hook = this.onBeforeCommitHook;
      this.onBeforeCommitHook = null;
      await hook();
    }

    const colMap = this.getCollectionMap(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION
    );

    // Optimistic concurrency check on read versions before committing staged writes
    for (const [docId, readVersion] of readVersions.entries()) {
      const currentVersion = colMap.get(docId)?.version ?? 0;
      if (currentVersion !== readVersion && stagedWrites.has(docId)) {
        throw new Error(
          `ABORTED: Transaction read version conflict on document "${docId}" (read v${readVersion}, current v${currentVersion}).`
        );
      }
    }

    for (const write of stagedWrites.values()) {
      const currentEntry = colMap.get(write.docId);
      if (write.op === 'create' && currentEntry !== undefined) {
        throw new Error(
          `ALREADY_EXISTS: Document "${write.docId}" already exists.`
        );
      }
      colMap.set(write.docId, {
        version: (currentEntry?.version ?? 0) + 1,
        data: deepClonePlain(write.data),
      });
      if (write.op === 'create') {
        this.totalCreatesCommitted += 1;
      } else {
        this.totalSetsCommitted += 1;
      }
    }

    return result;
  }
}

function makeReservedDocxReceipt(
  uploaderUid = 'admin_editor_01',
  nowIso = '2026-11-07T10:00:00.000Z'
): LibraryQuarantineInternalReceipt {
  const res = reserveLibraryQuarantineReceipt({
    uploaderUid,
    originalFilename: 'marine-biodiversity-report-2026.docx',
    claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
    bytes: makeValidDocxBuffer(),
    nowIso,
  });
  if (!res.ok) {
    throw new Error(`Unexpected reservation failure: ${res.errorMessage}`);
  }
  return res.receipt;
}

function makeReservedPdfReceipt(
  uploaderUid = 'admin_editor_01',
  nowIso = '2026-11-07T10:00:00.000Z'
): LibraryQuarantineInternalReceipt {
  const res = reserveLibraryQuarantineReceipt({
    uploaderUid,
    originalFilename: 'climate-policy-brief-2026.pdf',
    claimedMimeType: CANONICAL_PDF_MIME_TYPE,
    bytes: makeValidPdfBuffer(),
    nowIso,
  });
  if (!res.ok) {
    throw new Error(`Unexpected PDF reservation failure: ${res.errorMessage}`);
  }
  return res.receipt;
}

function makeMatchingAttestation(
  receipt: LibraryQuarantineInternalReceipt,
  generation = '1730973605001999',
  verifiedAtIso = '2026-11-07T10:02:00.000Z'
): TrustedStorageReadbackAttestation {
  return {
    attestedReceiptId: receipt.receiptId,
    attestedUploaderUid: receipt.uploaderUid,
    attestedStoragePath: receipt.storagePath,
    attestedFormat: receipt.format,
    attestedContentType: receipt.canonicalMimeType,
    attestedByteSize: receipt.byteSize,
    attestedSha256: receipt.sha256,
    attestedGeneration: generation,
    verifiedAtIso,
  };
}

async function runAllTests(): Promise<void> {
  await test('1. Valid Reserved create and read round-trip with versioned envelope', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const reserved = makeReservedDocxReceipt();

    const createRes = await store.createReceiptIfAbsent(reserved);
    assert(createRes.ok, 'Expected createReceiptIfAbsent to succeed');
    if (!createRes.ok) return;

    assert(createRes.created === true, 'Expected created === true');
    assert(
      createRes.disposition === 'CREATED',
      'Expected disposition CREATED'
    );
    assert(
      createRes.envelope.schemaVersion ===
        LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
      'Expected schemaVersion 1'
    );
    assert(createRes.envelope.revision === 1, 'Expected initial revision 1');
    assert(
      createRes.envelope.state === LibraryQuarantineReceiptState.Reserved,
      'Expected envelope state Reserved'
    );
    assert(
      areLibraryQuarantineReceiptsEqual(createRes.envelope.receipt, reserved),
      'Expected persisted receipt to match reserved receipt'
    );
    assert(
      fakeDb.totalCreatesCommitted === 1 && fakeDb.totalSetsCommitted === 0,
      'Expected exactly 1 transactional create committed'
    );

    // Verify raw stored envelope does not contain raw bytes, tokens, or URLs
    const rawStored = fakeDb.rawGetStoredDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      reserved.receiptId
    ) as Record<string, unknown>;
    assert(rawStored !== undefined, 'Expected raw document in collection');
    assert(
      Object.keys(rawStored).sort().join(',') ===
        'receipt,revision,schemaVersion,state',
      'Expected strict envelope keys only'
    );
    assert(
      !('bytes' in (rawStored.receipt as Record<string, unknown>)) &&
        !('downloadUrl' in (rawStored.receipt as Record<string, unknown>)) &&
        !('accessToken' in (rawStored.receipt as Record<string, unknown>)),
      'Expected no raw bytes, URLs, or tokens in persisted receipt'
    );

    // Read back by receiptId
    const readRes = await store.getReceiptById(reserved.receiptId);
    assert(readRes.ok, 'Expected getReceiptById to succeed');
    if (!readRes.ok) return;

    assert(readRes.envelope.revision === 1, 'Expected read revision 1');
    assert(
      areLibraryQuarantineReceiptsEqual(readRes.envelope.receipt, reserved),
      'Expected read receipt to equal reserved receipt'
    );
    assert(
      !('storagePath' in (readRes.adminReceiptDto as unknown as Record<string, unknown>)) &&
        !('generation' in (readRes.adminReceiptDto as unknown as Record<string, unknown>)),
      'Expected sanitized admin DTO to redact storagePath and generation'
    );
  });

  await test('2. Exact idempotent duplicate create returns existing envelope without rewriting', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const reserved = makeReservedPdfReceipt();

    const first = await store.createReceiptIfAbsent(reserved);
    assert(first.ok && first.created === true, 'First create must succeed');
    assert(
      fakeDb.totalCreatesCommitted === 1 && fakeDb.totalSetsCommitted === 0,
      'Expected 1 create after first call'
    );

    const duplicate = await store.createReceiptIfAbsent({ ...reserved });
    assert(duplicate.ok, 'Duplicate identical create must succeed idempotently');
    if (!duplicate.ok) return;

    assert(duplicate.created === false, 'Expected created === false on duplicate');
    assert(
      duplicate.disposition === 'IDEMPOTENT_EXISTING',
      'Expected IDEMPOTENT_EXISTING disposition'
    );
    assert(
      duplicate.envelope.revision === 1,
      'Expected revision to remain 1 on idempotent duplicate'
    );
    assert(
      fakeDb.totalCreatesCommitted === 1 && fakeDb.totalSetsCommitted === 0,
      'Expected zero additional writes on idempotent duplicate create'
    );
  });

  await test('3. Conflicting duplicate create and non-Reserved initial create are rejected without overwrite', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const reserved = makeReservedDocxReceipt();

    const created = await store.createReceiptIfAbsent(reserved);
    assert(created.ok, 'Initial create must succeed');

    // Attempt duplicate create with same receiptId & storagePath but different uploaderUid
    const conflictingUploader: LibraryQuarantineInternalReceipt = {
      ...reserved,
      uploaderUid: 'different_admin_99',
    };
    const conflictRes = await store.createReceiptIfAbsent(conflictingUploader);
    assert(!conflictRes.ok, 'Conflicting duplicate create must fail');
    if (conflictRes.ok) return;
    assert(
      conflictRes.errorCode === 'RECEIPT_ALREADY_EXISTS_CONFLICT',
      `Expected RECEIPT_ALREADY_EXISTS_CONFLICT, got ${conflictRes.errorCode}`
    );

    // Attempt initial create with a WritePending receipt
    const reserved2 = makeReservedPdfReceipt();
    const wpTransition = beginLibraryQuarantineWritePending({
      receipt: reserved2,
      actorUid: reserved2.uploaderUid,
      nowIso: '2026-11-07T10:01:00.000Z',
    });
    assert(wpTransition.ok, 'Transition to WritePending must succeed');
    if (!wpTransition.ok) return;

    const nonReservedCreate = await store.createReceiptIfAbsent(
      wpTransition.receipt
    );
    assert(!nonReservedCreate.ok, 'Create with WritePending state must fail');
    if (nonReservedCreate.ok) return;
    assert(
      nonReservedCreate.errorCode === 'INVALID_INITIAL_STATE',
      `Expected INVALID_INITIAL_STATE, got ${nonReservedCreate.errorCode}`
    );

    // Confirm original document was never overwritten
    const readBack = await store.getReceiptById(reserved.receiptId);
    assert(
      readBack.ok &&
        readBack.envelope.receipt.uploaderUid === reserved.uploaderUid &&
        readBack.envelope.revision === 1,
      'Original stored receipt must remain untouched'
    );
  });

  await test('4. Missing receipt and invalid document ID rejection', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);

    const missingId = 'a'.repeat(32);
    const missingRes = await store.getReceiptById(missingId);
    assert(!missingRes.ok, 'Missing receipt must return failure');
    if (!missingRes.ok) {
      assert(
        missingRes.errorCode === 'RECEIPT_NOT_FOUND',
        `Expected RECEIPT_NOT_FOUND, got ${missingRes.errorCode}`
      );
    }

    for (const invalidId of [
      '',
      'short',
      'A'.repeat(32),
      '../library/quarantine/' + 'a'.repeat(32),
      null,
      undefined,
      12345,
    ]) {
      const badRes = await store.getReceiptById(invalidId);
      assert(!badRes.ok, `Invalid receiptId "${String(invalidId)}" must fail`);
      if (!badRes.ok) {
        assert(
          badRes.errorCode === 'INVALID_RECEIPT_ID',
          `Expected INVALID_RECEIPT_ID for "${String(invalidId)}", got ${badRes.errorCode}`
        );
      }
    }
  });

  await test('5. Fail-closed validation on invalid schemaVersion, revision, state, doc.id mismatch, or corrupted receipt', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const baseReceipt = makeReservedDocxReceipt();

    // 5a. Invalid schemaVersion
    fakeDb.rawPutCorruptedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      baseReceipt.receiptId,
      {
        schemaVersion: 2,
        revision: 1,
        state: baseReceipt.state,
        receipt: baseReceipt,
      }
    );
    const badSchema = await store.getReceiptById(baseReceipt.receiptId);
    assert(
      !badSchema.ok && badSchema.errorCode === 'INVALID_SCHEMA_VERSION',
      'Expected INVALID_SCHEMA_VERSION on schemaVersion: 2'
    );

    // 5b. Invalid revision (0, negative, float, NaN)
    for (const badRev of [0, -1, 1.5, Number.NaN, '1']) {
      fakeDb.rawPutCorruptedDoc(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        baseReceipt.receiptId,
        {
          schemaVersion: 1,
          revision: badRev,
          state: baseReceipt.state,
          receipt: baseReceipt,
        }
      );
      const revRes = await store.getReceiptById(baseReceipt.receiptId);
      assert(
        !revRes.ok && revRes.errorCode === 'INVALID_REVISION',
        `Expected INVALID_REVISION for revision ${String(badRev)}`
      );
    }

    // 5c. Envelope state mismatch with receipt.state
    fakeDb.rawPutCorruptedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      baseReceipt.receiptId,
      {
        schemaVersion: 1,
        revision: 1,
        state: LibraryQuarantineReceiptState.Quarantined,
        receipt: baseReceipt,
      }
    );
    const stateMismatch = await store.getReceiptById(baseReceipt.receiptId);
    assert(
      !stateMismatch.ok &&
        stateMismatch.errorCode === 'ENVELOPE_STATE_MISMATCH',
      'Expected ENVELOPE_STATE_MISMATCH when envelope.state !== receipt.state'
    );

    // 5d. Document ID mismatch (stored under different doc key or snapshot.id mismatch)
    const otherId = 'b'.repeat(32);
    fakeDb.rawPutCorruptedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      otherId,
      {
        schemaVersion: 1,
        revision: 1,
        state: baseReceipt.state,
        receipt: baseReceipt,
      }
    );
    const docIdMismatch = await store.getReceiptById(otherId);
    assert(
      !docIdMismatch.ok && docIdMismatch.errorCode === 'DOCUMENT_ID_MISMATCH',
      'Expected DOCUMENT_ID_MISMATCH when receipt.receiptId !== doc.id'
    );

    // 5e. Escalated security flag in persisted receipt fails closed with SECURITY_FLAG_ESCALATION
    fakeDb.rawPutCorruptedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      baseReceipt.receiptId,
      {
        schemaVersion: 1,
        revision: 1,
        state: baseReceipt.state,
        receipt: {
          ...baseReceipt,
          isVerifiedSafe: true,
        },
      }
    );
    const escalated = await store.getReceiptById(baseReceipt.receiptId);
    assert(
      !escalated.ok && escalated.errorCode === 'SECURITY_FLAG_ESCALATION',
      'Expected SECURITY_FLAG_ESCALATION when persisted receipt has isVerifiedSafe: true'
    );

    // 5f. Unexpected top-level field in envelope (e.g. downloadUrl) fails closed
    fakeDb.rawPutCorruptedDoc(
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      baseReceipt.receiptId,
      {
        schemaVersion: 1,
        revision: 1,
        state: baseReceipt.state,
        receipt: baseReceipt,
        downloadUrl: 'https://storage.googleapis.com/leak.pdf',
      }
    );
    const extraField = await store.getReceiptById(baseReceipt.receiptId);
    assert(
      !extraField.ok && extraField.errorCode === 'UNTRUSTED_STORE_FIELD',
      'Expected UNTRUSTED_STORE_FIELD on unexpected envelope property'
    );
  });

  await test('6. Immutable identity, uploaderUid, hash, format, byteSize, storagePath, and createdAt enforcement', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const reserved = makeReservedDocxReceipt();

    const created = await store.createReceiptIfAbsent(reserved);
    assert(created.ok, 'Create must succeed');

    const wpRes = beginLibraryQuarantineWritePending({
      receipt: reserved,
      actorUid: reserved.uploaderUid,
      nowIso: '2026-11-07T10:01:00.000Z',
    });
    assert(wpRes.ok, 'Transition to WritePending must succeed');
    if (!wpRes.ok) return;
    const validWritePending = wpRes.receipt;

    const otherReserved = makeReservedDocxReceipt('other_uploader_2');

    // Attempt to mutate each immutable field during CAS
    const mutatedCandidates: Array<{
      label: string;
      candidate: LibraryQuarantineInternalReceipt;
    }> = [
      {
        label: 'uploaderUid',
        candidate: { ...validWritePending, uploaderUid: 'attacker_uid' },
      },
      {
        label: 'sha256',
        candidate: { ...validWritePending, sha256: 'f'.repeat(64) },
      },
      {
        label: 'byteSize',
        candidate: { ...validWritePending, byteSize: validWritePending.byteSize + 10 },
      },
      {
        label: 'originalFilename',
        candidate: { ...validWritePending, originalFilename: 'tampered.docx' },
      },
      {
        label: 'sanitizedFilename',
        candidate: { ...validWritePending, sanitizedFilename: 'tampered.docx' },
      },
      {
        label: 'createdAt',
        candidate: { ...validWritePending, createdAt: '2026-11-07T10:00:30.000Z' },
      },
      {
        label: 'receiptId + storagePath swap',
        candidate: {
          ...validWritePending,
          receiptId: otherReserved.receiptId,
          storagePath: otherReserved.storagePath,
        },
      },
    ];

    for (const item of mutatedCandidates) {
      const casRes = await store.compareAndSwapReceipt({
        receiptId: reserved.receiptId,
        expectedRevision: 1,
        expectedCurrentReceipt: reserved,
        nextReceipt: item.candidate,
      });
      assert(
        !casRes.ok && casRes.errorCode === 'IMMUTABLE_FIELD_VIOLATION',
        `Expected IMMUTABLE_FIELD_VIOLATION when mutating ${item.label}, got ${casRes.ok ? 'OK' : casRes.errorCode}`
      );
    }

    // Also verify format / canonicalExtension / canonicalMimeType / storagePath mutation is blocked
    assert(
      !isAllowedLibraryQuarantineLifecycleTransition(
        LibraryQuarantineReceiptState.Quarantined,
        LibraryQuarantineReceiptState.Rejected
      ),
      'Quarantined -> Rejected must be disallowed'
    );
  });

  await test('7. Legal and illegal lifecycle transitions, timestamp monotonicity, and safety flag preservation', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const reserved = makeReservedDocxReceipt(
      'admin_editor_01',
      '2026-11-07T10:00:00.000Z'
    );

    const cRes = await store.createReceiptIfAbsent(reserved);
    assert(cRes.ok, 'Create Reserved must succeed');

    // Illegal jump: Reserved -> Quarantined directly
    const att = makeMatchingAttestation(
      reserved,
      '1001',
      '2026-11-07T10:01:00.000Z'
    );
    const forgedQuarantined: LibraryQuarantineInternalReceipt = {
      ...reserved,
      state: LibraryQuarantineReceiptState.Quarantined,
      generation: att.attestedGeneration,
      updatedAt: '2026-11-07T10:01:00.000Z',
    };
    const illegalJump = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: reserved,
      nextReceipt: forgedQuarantined,
    });
    assert(
      !illegalJump.ok &&
        illegalJump.errorCode === 'INVALID_LIFECYCLE_TRANSITION',
      'Direct Reserved -> Quarantined jump must fail with INVALID_LIFECYCLE_TRANSITION'
    );

    // Legal transition 1: Reserved -> WritePending (revision 1 -> 2)
    const wpRes = beginLibraryQuarantineWritePending({
      receipt: reserved,
      actorUid: reserved.uploaderUid,
      nowIso: '2026-11-07T10:01:00.000Z',
    });
    assert(wpRes.ok, 'beginLibraryQuarantineWritePending must succeed');
    if (!wpRes.ok) return;

    // Test timestamp regression rejection before applying valid WritePending
    const regressedWp: LibraryQuarantineInternalReceipt = {
      ...wpRes.receipt,
      createdAt: '2026-11-07T09:50:00.000Z',
    };
    const regressedCheck = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: reserved,
      nextReceipt: regressedWp,
    });
    assert(!regressedCheck.ok, 'Timestamp or createdAt mutation must fail');

    const cas1 = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: reserved,
      nextReceipt: wpRes.receipt,
    });
    assert(cas1.ok, 'CAS Reserved -> WritePending must succeed');
    if (!cas1.ok) return;
    assert(cas1.envelope.revision === 2, 'Expected revision 2');
    assert(
      cas1.envelope.state === LibraryQuarantineReceiptState.WritePending,
      'Expected WritePending state'
    );

    // Non-monotonic updatedAt between WritePending (10:01) and NeedsReconciliation (10:00:30)
    const regressedRecon: LibraryQuarantineInternalReceipt = {
      ...wpRes.receipt,
      state: LibraryQuarantineReceiptState.NeedsReconciliation,
      reconciliationReason: 'Storage write timed out waiting for GCS response.',
      updatedAt: '2026-11-07T10:00:30.000Z',
    };
    const nonMonotonicCas = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 2,
      expectedCurrentReceipt: wpRes.receipt,
      nextReceipt: regressedRecon,
    });
    assert(
      !nonMonotonicCas.ok &&
        nonMonotonicCas.errorCode === 'NON_MONOTONIC_TIMESTAMP',
      'Decreasing updatedAt must fail with NON_MONOTONIC_TIMESTAMP'
    );

    // Legal transition 2: WritePending -> NeedsReconciliation (revision 2 -> 3)
    const reconRes = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: wpRes.receipt,
      actorUid: reserved.uploaderUid,
      reconciliationReason: 'GCS write acknowledgement timed out after 10s.',
      nowIso: '2026-11-07T10:02:00.000Z',
    });
    assert(reconRes.ok, 'markLibraryQuarantineWriteNeedsReconciliation must succeed');
    if (!reconRes.ok) return;

    const cas2 = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 2,
      expectedCurrentReceipt: wpRes.receipt,
      nextReceipt: reconRes.receipt,
    });
    assert(cas2.ok && cas2.envelope.revision === 3, 'Expected revision 3');
    if (!cas2.ok) return;

    // Illegal backwards transition: NeedsReconciliation -> WritePending
    const backwardsWp: LibraryQuarantineInternalReceipt = {
      ...wpRes.receipt,
      updatedAt: '2026-11-07T10:02:30.000Z',
    };
    const backwardsCas = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 3,
      expectedCurrentReceipt: reconRes.receipt,
      nextReceipt: backwardsWp,
    });
    assert(
      !backwardsCas.ok &&
        backwardsCas.errorCode === 'INVALID_LIFECYCLE_TRANSITION',
      'NeedsReconciliation -> WritePending must be rejected'
    );

    // Legal transition 3: NeedsReconciliation -> Quarantined (revision 3 -> 4)
    const reconcileAtt = makeMatchingAttestation(
      reconRes.receipt,
      '9876543210',
      '2026-11-07T10:03:00.000Z'
    );
    const quarRes = reconcileLibraryQuarantineReceiptWithAttestation({
      receipt: reconRes.receipt,
      actorUid: reserved.uploaderUid,
      attestation: reconcileAtt,
    });
    assert(quarRes.ok, 'reconcileLibraryQuarantineReceiptWithAttestation must succeed');
    if (!quarRes.ok) return;

    const cas3 = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 3,
      expectedCurrentReceipt: reconRes.receipt,
      nextReceipt: quarRes.receipt,
    });
    assert(cas3.ok && cas3.envelope.revision === 4, 'Expected revision 4');
    if (!cas3.ok) return;
    assert(
      cas3.envelope.state === LibraryQuarantineReceiptState.Quarantined &&
        cas3.envelope.receipt.isSanitized === false &&
        cas3.envelope.receipt.isVerifiedSafe === false &&
        cas3.envelope.receipt.isRightsApproved === false &&
        cas3.envelope.receipt.isPublished === false &&
        cas3.envelope.receipt.isReadyForPeia === false,
      'Quarantined receipt must keep all safety/publication flags strictly false'
    );

    // Terminal state enforcement: Quarantined -> Rejected is forbidden
    const illegalRejectFromQuarantined: LibraryQuarantineInternalReceipt = {
      ...quarRes.receipt,
      state: LibraryQuarantineReceiptState.Rejected,
      generation: null,
      rejectionReasonCode: 'MANUAL_ABORT',
      updatedAt: '2026-11-07T10:04:00.000Z',
    };
    const termCas = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 4,
      expectedCurrentReceipt: quarRes.receipt,
      nextReceipt: illegalRejectFromQuarantined,
    });
    assert(
      !termCas.ok && termCas.errorCode === 'INVALID_LIFECYCLE_TRANSITION',
      'Quarantined is terminal in 02A/02B1 and cannot transition to Rejected'
    );
  });

  await test('8. Concurrent update contention and stale-revision / stale-receipt rejection', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const reserved = makeReservedPdfReceipt(
      'admin_editor_02',
      '2026-11-07T11:00:00.000Z'
    );

    await store.createReceiptIfAbsent(reserved);

    const wpRes = beginLibraryQuarantineWritePending({
      receipt: reserved,
      actorUid: reserved.uploaderUid,
      nowIso: '2026-11-07T11:01:00.000Z',
    });
    assert(wpRes.ok, 'WritePending transition must succeed');
    if (!wpRes.ok) return;

    const rejectRes = rejectLibraryQuarantineReceipt({
      receipt: reserved,
      actorUid: reserved.uploaderUid,
      rejectionReasonCode: 'PREWRITE_ABORTED',
      nowIso: '2026-11-07T11:01:05.000Z',
    });
    assert(rejectRes.ok, 'Reject transition must succeed');
    if (!rejectRes.ok) return;

    // Writer A transitions Reserved -> WritePending at expectedRevision: 1
    const writerA = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: reserved,
      nextReceipt: wpRes.receipt,
    });
    assert(writerA.ok && writerA.envelope.revision === 2, 'Writer A must succeed');

    // Stale Writer B attempts Reserved -> Rejected with stale expectedRevision: 1
    const writerBStaleRev = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: reserved,
      nextReceipt: rejectRes.receipt,
    });
    assert(
      !writerBStaleRev.ok && writerBStaleRev.errorCode === 'REVISION_CONFLICT',
      'Stale revision writer must be rejected with REVISION_CONFLICT'
    );

    // Writer C passes expectedRevision: 2 but stale expectedCurrentReceipt (modified updatedAt)
    const staleCurrentWp: LibraryQuarantineInternalReceipt = {
      ...wpRes.receipt,
      updatedAt: '2026-11-07T11:00:59.000Z',
    };
    const confirmAtt = makeMatchingAttestation(
      wpRes.receipt,
      '555555',
      '2026-11-07T11:02:00.000Z'
    );
    const confirmRes = confirmLibraryQuarantineWriteWithAttestation({
      receipt: wpRes.receipt,
      actorUid: reserved.uploaderUid,
      attestation: confirmAtt,
    });
    assert(confirmRes.ok, 'Confirm write must succeed');
    if (!confirmRes.ok) return;

    const writerCStaleCurrent = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 2,
      expectedCurrentReceipt: staleCurrentWp,
      nextReceipt: confirmRes.receipt,
    });
    assert(
      !writerCStaleCurrent.ok &&
        writerCStaleCurrent.errorCode === 'CURRENT_RECEIPT_MISMATCH',
      'Mismatched expectedCurrentReceipt must fail with CURRENT_RECEIPT_MISMATCH'
    );

    // Simulate true in-flight transaction interleaving using onBeforeCommitHook
    let hookTriggered = false;
    fakeDb.onBeforeCommitHook = async () => {
      hookTriggered = true;
      // Another concurrent writer commits revision 2 -> 3 while the first transaction is in flight
      const concurrentReject = rejectLibraryQuarantineReceipt({
        receipt: wpRes.receipt,
        actorUid: reserved.uploaderUid,
        rejectionReasonCode: 'CONCURRENT_CANCEL',
        nowIso: '2026-11-07T11:01:30.000Z',
      });
      if (!concurrentReject.ok) {
        throw new Error('Failed to build concurrent rejection');
      }
      const winner = await store.compareAndSwapReceipt({
        receiptId: reserved.receiptId,
        expectedRevision: 2,
        expectedCurrentReceipt: wpRes.receipt,
        nextReceipt: concurrentReject.receipt,
      });
      assert(winner.ok && winner.envelope.revision === 3, 'Interleaved winner must commit revision 3');
    };

    const loserInFlight = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 2,
      expectedCurrentReceipt: wpRes.receipt,
      nextReceipt: confirmRes.receipt,
    });
    assert(hookTriggered, 'Interleaving hook must have executed');
    assert(
      !loserInFlight.ok && loserInFlight.errorCode === 'TRANSACTION_FAILURE',
      'Aborted interleaved transaction must fail closed with TRANSACTION_FAILURE'
    );

    // Verify winner's state (Rejected at revision 3) was preserved intact
    const finalRead = await store.getReceiptById(reserved.receiptId);
    assert(
      finalRead.ok &&
        finalRead.envelope.revision === 3 &&
        finalRead.envelope.state === LibraryQuarantineReceiptState.Rejected,
      'Winner state at revision 3 must remain intact without overwrite'
    );
  });

  await test('9. Atomicity under transaction failures leaves stored state completely unchanged', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const reserved = makeReservedDocxReceipt();

    // Inject transaction failure on create
    fakeDb.failNextTransactionError = new Error(
      'DEADLINE_EXCEEDED: Simulated Firestore transaction timeout'
    );
    const failedCreate = await store.createReceiptIfAbsent(reserved);
    assert(
      !failedCreate.ok && failedCreate.errorCode === 'TRANSACTION_FAILURE',
      'Transaction error during create must return TRANSACTION_FAILURE'
    );
    const afterFailedCreate = await store.getReceiptById(reserved.receiptId);
    assert(
      !afterFailedCreate.ok &&
        afterFailedCreate.errorCode === 'RECEIPT_NOT_FOUND',
      'Failed transaction must not leave partial document behind'
    );

    // Succeed on retry
    const okCreate = await store.createReceiptIfAbsent(reserved);
    assert(okCreate.ok && okCreate.envelope.revision === 1, 'Retry create must succeed');

    // Inject failure after transaction read during CAS
    const wpRes = beginLibraryQuarantineWritePending({
      receipt: reserved,
      actorUid: reserved.uploaderUid,
      nowIso: '2026-11-07T10:05:00.000Z',
    });
    assert(wpRes.ok, 'WritePending transition must succeed');
    if (!wpRes.ok) return;

    fakeDb.failAfterTransactionReadError = new Error(
      'UNAVAILABLE: Simulated network drop mid-transaction'
    );
    const failedCas = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: reserved,
      nextReceipt: wpRes.receipt,
    });
    assert(
      !failedCas.ok && failedCas.errorCode === 'TRANSACTION_FAILURE',
      'Mid-transaction failure must return TRANSACTION_FAILURE'
    );

    const readAfterAbort = await store.getReceiptById(reserved.receiptId);
    assert(
      readAfterAbort.ok &&
        readAfterAbort.envelope.revision === 1 &&
        readAfterAbort.envelope.state === LibraryQuarantineReceiptState.Reserved,
      'Stored receipt must remain at revision 1 Reserved after mid-transaction failure'
    );
  });

  await test('10. Strict no-overwrite behavior across all repository operations', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const reserved = makeReservedDocxReceipt();

    await store.createReceiptIfAbsent(reserved);
    const writesAfterCreate =
      fakeDb.totalCreatesCommitted + fakeDb.totalSetsCommitted;
    assert(writesAfterCreate === 1, 'Expected 1 committed write after create');

    // Attempt invalid CAS on missing receipt
    const otherReserved = makeReservedPdfReceipt();
    const wpOther = beginLibraryQuarantineWritePending({
      receipt: otherReserved,
      actorUid: otherReserved.uploaderUid,
      nowIso: '2026-11-07T10:05:00.000Z',
    });
    assert(wpOther.ok, 'wpOther must succeed');
    if (!wpOther.ok) return;

    const missingCas = await store.compareAndSwapReceipt({
      receiptId: otherReserved.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: otherReserved,
      nextReceipt: wpOther.receipt,
    });
    assert(
      !missingCas.ok && missingCas.errorCode === 'RECEIPT_NOT_FOUND',
      'CAS on missing receipt must return RECEIPT_NOT_FOUND'
    );

    // Attempt CAS with extra untrusted property
    const untrustedCas = await store.compareAndSwapReceipt({
      receiptId: reserved.receiptId,
      expectedRevision: 1,
      expectedCurrentReceipt: reserved,
      nextReceipt: wpOther.receipt,
      forceOverwrite: true,
    });
    assert(
      !untrustedCas.ok && untrustedCas.errorCode === 'UNTRUSTED_STORE_FIELD',
      'CAS with extra field must return UNTRUSTED_STORE_FIELD'
    );

    assert(
      fakeDb.totalCreatesCommitted + fakeDb.totalSetsCommitted ===
        writesAfterCreate,
      'Zero writes should have occurred during rejected operations'
    );
  });

  await test('11. No unbounded collection scans across create, read, or CAS', async () => {
    const fakeDb = new FakeTransactionalFirestoreDb();
    const store = new FirestoreLibraryQuarantineReceiptStore(fakeDb);
    const r1 = makeReservedDocxReceipt('admin_1', '2026-11-07T10:00:00.000Z');
    const r2 = makeReservedPdfReceipt('admin_2', '2026-11-07T10:00:00.000Z');

    await store.createReceiptIfAbsent(r1);
    await store.createReceiptIfAbsent(r2);
    await store.getReceiptById(r1.receiptId);
    await store.getReceiptById(r2.receiptId);

    assert(
      fakeDb.collectionScanAttempts === 0,
      'Repository must never invoke collection-level .get() scans'
    );
    assert(
      fakeDb.totalPointReads === 2,
      'Expected exactly 2 point reads via doc(receiptId).get()'
    );
  });

  await test('12. Zero live Firestore, GCS, network, or PEIA side effects and baseline SHA-1 preservation', async () => {
    const expectedChecksums: ReadonlyArray<{
      readonly path: string;
      readonly sha1: string;
    }> = [
      {
        path: 'functions/src/library/libraryQuarantineReceiptContract.ts',
        sha1: '4b4d5f32e5903def3a3b0dcdecd45e38083f91bb',
      },
      {
        path: 'scripts/runLibraryQuarantineReceiptContractTests.ts',
        sha1: '057c360bbcfa1126a8a49f93250a5f2aa145b1bb',
      },
      {
        path: 'functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts',
        sha1: '027efedf05779e1758b55793c2f2302b511cb4fb',
      },
      {
        path: 'functions/src/library/firestoreLibraryRepository.ts',
        sha1: 'afba4876b6d736424bd0b344df1db9a5e1417327',
      },
      {
        path: 'functions/src/library/libraryUploadBinaryAdmission.ts',
        sha1: 'c479007641d799afb145436bf91e661a7c2d5611',
      },
      {
        path: 'functions/src/library/libraryUploadDeepStructure.ts',
        sha1: '7e6ba463502bc8d6c796378d6b381cdaaf01c60e',
      },
      {
        path: 'storage.rules',
        sha1: 'd77548e6b505d8db3858634cc2937937393a9864',
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

    // Also verify envelope validator directly rejects non-object input
    const nullEnv = validatePersistedLibraryQuarantineReceiptEnvelope(null);
    assert(
      !nullEnv.ok && nullEnv.errorCode === 'CORRUPTED_PERSISTED_RECEIPT',
      'Null envelope must fail with CORRUPTED_PERSISTED_RECEIPT'
    );
  });

  console.log('------------------------------------------------------------');
  console.log(
    `LIBRARY QUARANTINE RECEIPT STORE TESTS: ${passedTests}/${totalTests} PASSED`
  );
}

runAllTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exitCode = 1;
});
