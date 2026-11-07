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
  rejectLibraryQuarantineReceipt,
  reserveLibraryQuarantineReceipt,
  type LibraryQuarantineInternalReceipt,
} from '../functions/src/library/libraryQuarantineReceiptContract';
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
  '<w:body><w:p><w:r><w:t>دراسة التنوع البيولوجي وحماية المحميات الطبيعية 2026</w:t></w:r></w:p></w:body>' +
  '</w:document>';

function makeValidDocxBuffer(customText?: string): Buffer {
  const docXml = customText
    ? CANONICAL_WORD_DOCUMENT_XML.replace(
        'دراسة التنوع البيولوجي وحماية المحميات الطبيعية 2026',
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

interface StoredFakeGcsObject {
  bytes: Buffer;
  metadata: GcsLibraryQuarantineObjectMetadata;
  lastSaveOptions?: GcsLibraryQuarantineSaveOptions;
}

class FakeQuarantineGcsBucket implements GcsLibraryQuarantineBucket {
  public readonly name = 'promise-of-planet-private-quarantine-test';
  public readonly objects = new Map<string, StoredFakeGcsObject>();

  public saveCalls = 0;
  public getMetadataCalls = 0;
  public createReadStreamCalls = 0;
  public downloadCalls = 0;
  public lastDestroyedStream = false;
  public chunksEmittedOnLastStream = 0;

  public nextSaveError: unknown = null;
  public nextGetMetadataError: unknown = null;
  public nextStreamErrorAfterFirstChunk: Error | null = null;
  public customStreamChunksOverride: readonly Buffer[] | null = null;
  public streamChunkSize = 64;
  private generationCounter = 1730980000000;

  public putRawObject(
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

    const fileHandle: GcsLibraryQuarantineFile & {
      download?: () => Promise<[Buffer]>;
    } = {
      name: objectPath,
      async save(
        data: Buffer,
        options: GcsLibraryQuarantineSaveOptions
      ): Promise<void> {
        bucket.saveCalls += 1;

        if (bucket.nextSaveError !== null) {
          const err = bucket.nextSaveError;
          bucket.nextSaveError = null;
          throw err;
        }

        const genMatch =
          options?.preconditionOpts?.ifGenerationMatch ??
          options?.preconditions?.ifGenerationMatch;

        if (genMatch !== 0) {
          throw new Error(
            `UNSAFE_UNCONDITIONAL_WRITE: Expected ifGenerationMatch === 0, got ${String(genMatch)}`
          );
        }

        if (bucket.objects.has(objectPath)) {
          const precondErr = new Error(
            'Precondition Failed: conditionNotMet (412)'
          ) as Error & { code: number };
          precondErr.code = 412;
          throw precondErr;
        }

        bucket.generationCounter += 1;
        const generation = String(bucket.generationCounter);
        const copiedBytes = Buffer.from(
          data.buffer,
          data.byteOffset,
          data.byteLength
        );

        bucket.objects.set(objectPath, {
          bytes: copiedBytes,
          lastSaveOptions: options,
          metadata: {
            name: objectPath,
            bucket: bucket.name,
            generation,
            metageneration: '1',
            etag: `etag_${generation}`,
            contentType: options.contentType,
            cacheControl: options.metadata.cacheControl,
            contentDisposition: options.metadata.contentDisposition,
            size: String(copiedBytes.byteLength),
            timeCreated: '2026-11-07T12:00:00.000Z',
            updated: '2026-11-07T12:00:00.000Z',
            metadata: { ...options.metadata.metadata },
          },
        });
      },

      async getMetadata(): Promise<[GcsLibraryQuarantineObjectMetadata, unknown?]> {
        bucket.getMetadataCalls += 1;

        if (bucket.nextGetMetadataError !== null) {
          const err = bucket.nextGetMetadataError;
          bucket.nextGetMetadataError = null;
          throw err;
        }

        const existing = bucket.objects.get(objectPath);
        if (!existing) {
          const notFoundErr = new Error(
            `No such object: ${objectPath} (404)`
          ) as Error & { code: number };
          notFoundErr.code = 404;
          throw notFoundErr;
        }

        return [{ ...existing.metadata }, {}];
      },

      createReadStream(
        _options?: GcsLibraryQuarantineReadStreamOptions
      ): GcsLibraryQuarantineReadableStream {
        bucket.createReadStreamCalls += 1;
        bucket.lastDestroyedStream = false;
        bucket.chunksEmittedOnLastStream = 0;

        let destroyed = false;

        const stream: GcsLibraryQuarantineReadableStream = {
          destroy(): void {
            destroyed = true;
            bucket.lastDestroyedStream = true;
          },
          async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
            const existing = bucket.objects.get(objectPath);
            if (!existing && !bucket.customStreamChunksOverride) {
              const notFoundErr = new Error(
                'Object disappeared before stream read (404)'
              ) as Error & { code: number };
              notFoundErr.code = 404;
              throw notFoundErr;
            }

            if (bucket.customStreamChunksOverride) {
              const chunks = bucket.customStreamChunksOverride;
              bucket.customStreamChunksOverride = null;
              for (const chunk of chunks) {
                if (destroyed) {
                  return;
                }
                bucket.chunksEmittedOnLastStream += 1;
                yield chunk;
                if (destroyed) {
                  return;
                }
              }
              return;
            }

            const fullBuf = existing!.bytes;
            const step = Math.max(1, bucket.streamChunkSize);
            for (let offset = 0; offset < fullBuf.length; offset += step) {
              if (destroyed) {
                return;
              }
              const slice = fullBuf.subarray(
                offset,
                Math.min(offset + step, fullBuf.length)
              );
              bucket.chunksEmittedOnLastStream += 1;
              yield slice;
              if (bucket.nextStreamErrorAfterFirstChunk !== null) {
                const streamErr = bucket.nextStreamErrorAfterFirstChunk;
                bucket.nextStreamErrorAfterFirstChunk = null;
                throw streamErr;
              }
            }
          },
        };

        return stream;
      },

      async download(): Promise<[Buffer]> {
        bucket.downloadCalls += 1;
        throw new Error(
          'FORBIDDEN_UNBOUNDED_DOWNLOAD: Adapter must never call file.download()'
        );
      },
    };

    return fileHandle;
  }
}

function makeWritePendingReceiptAndBytes(options?: {
  format?: 'DOCX' | 'PDF';
  uploaderUid?: string;
  bytesOverride?: Buffer | Uint8Array;
  createdAt?: string;
  writePendingAt?: string;
}): {
  readonly reserved: LibraryQuarantineInternalReceipt;
  readonly writePending: LibraryQuarantineInternalReceipt;
  readonly bytes: Buffer | Uint8Array;
} {
  const format = options?.format ?? 'DOCX';
  const uploaderUid = options?.uploaderUid ?? 'admin_curator_01';
  const createdAt = options?.createdAt ?? '2026-11-07T12:00:00.000Z';
  const writePendingAt = options?.writePendingAt ?? '2026-11-07T12:00:05.000Z';
  const bytes =
    options?.bytesOverride ??
    (format === 'DOCX' ? makeValidDocxBuffer() : makeValidPdfBuffer());

  const res = reserveLibraryQuarantineReceipt({
    uploaderUid,
    originalFilename:
      format === 'DOCX' ? 'biodiversity-2026.docx' : 'climate-report-2026.pdf',
    claimedMimeType:
      format === 'DOCX' ? CANONICAL_DOCX_MIME_TYPE : CANONICAL_PDF_MIME_TYPE,
    bytes,
    nowIso: createdAt,
  });

  if (!res.ok) {
    throw new Error(`Reservation failed: ${res.errorMessage}`);
  }

  const wp = beginLibraryQuarantineWritePending({
    receipt: res.receipt,
    actorUid: uploaderUid,
    nowIso: writePendingAt,
  });

  if (!wp.ok) {
    throw new Error(`WritePending transition failed: ${wp.errorMessage}`);
  }

  return {
    reserved: res.receipt,
    writePending: wp.receipt,
    bytes,
  };
}

async function runAllTests(): Promise<void> {
  await test('1. Conditional write with generation precondition 0, private headers, and verified readback attestation', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:00:10.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'DOCX',
    });

    const outcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });

    assert(outcome.ok, 'Expected writeQuarantineObjectIfAbsent to succeed');
    if (!outcome.ok) return;

    assert(
      outcome.status === 'WRITTEN_AND_VERIFIED' &&
        outcome.createdNewObject === true,
      'Expected WRITTEN_AND_VERIFIED with createdNewObject=true'
    );
    assert(
      bucket.saveCalls === 1 &&
        bucket.getMetadataCalls === 1 &&
        bucket.createReadStreamCalls === 1 &&
        bucket.downloadCalls === 0,
      'Expected exactly 1 save, 1 getMetadata, 1 createReadStream, and 0 download calls'
    );

    const stored = bucket.objects.get(writePending.storagePath);
    assert(stored !== undefined, 'Expected object stored at canonical path');
    assert(
      stored?.lastSaveOptions?.preconditionOpts.ifGenerationMatch === 0 &&
        stored?.lastSaveOptions?.preconditions.ifGenerationMatch === 0,
      'Expected ifGenerationMatch: 0 precondition on save'
    );
    assert(
      stored?.lastSaveOptions?.resumable === false,
      'Expected resumable: false'
    );
    assert(
      stored?.metadata.cacheControl === LIBRARY_QUARANTINE_CACHE_CONTROL &&
        stored?.metadata.contentDisposition ===
          LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      'Expected private cacheControl and attachment contentDisposition'
    );
    assert(
      stored?.metadata.metadata?.receiptId === writePending.receiptId &&
        stored?.metadata.metadata?.uploaderUid === writePending.uploaderUid &&
        stored?.metadata.metadata?.sha256 === writePending.sha256 &&
        stored?.metadata.metadata?.format === 'DOCX' &&
        stored?.metadata.metadata?.quarantineState ===
          LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      'Expected server-owned immutable custom metadata'
    );

    // Verify returned attestation is directly accepted by LIB-FILE-02A confirmLibraryQuarantineWriteWithAttestation
    const confirmRes = confirmLibraryQuarantineWriteWithAttestation({
      receipt: writePending,
      actorUid: writePending.uploaderUid,
      attestation: outcome.attestation,
    });
    assert(
      confirmRes.ok &&
        confirmRes.receipt.state === LibraryQuarantineReceiptState.Quarantined,
      'Returned attestation must be accepted by confirmLibraryQuarantineWriteWithAttestation'
    );
  });

  await test('2. Correct owner and canonical path identity enforcement for both PDF and DOCX', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:01:00.000Z',
    });

    const pdfCase = makeWritePendingReceiptAndBytes({
      format: 'PDF',
      uploaderUid: 'admin_pdf_owner_77',
    });

    const outcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: pdfCase.writePending,
      bytes: pdfCase.bytes,
    });

    assert(outcome.ok, 'Expected PDF conditional write to succeed');
    if (!outcome.ok) return;

    assert(
      outcome.attestation.attestedStoragePath ===
        `library/quarantine/${pdfCase.writePending.receiptId}/source.pdf`,
      'Expected canonical PDF quarantine path'
    );
    assert(
      outcome.attestation.attestedUploaderUid === 'admin_pdf_owner_77' &&
        outcome.attestation.attestedFormat === 'PDF' &&
        outcome.attestation.attestedContentType === CANONICAL_PDF_MIME_TYPE,
      'Expected exact owner, format, and canonical PDF MIME in attestation'
    );
  });

  await test('3. Actual-byte SHA-256 verification rejects tampered stored bytes even when custom metadata sha256 matches', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:02:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'PDF',
    });

    // Override the stream readback bytes to simulate storage bit-rot or spoofed metadata
    // while metadata.metadata.sha256 and metadata.size still claim the expected values!
    const corruptedBytes = Buffer.from(bytes);
    corruptedBytes[corruptedBytes.length - 10] ^= 0xff;
    bucket.customStreamChunksOverride = [corruptedBytes];

    const outcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });

    assert(
      !outcome.ok &&
        outcome.status === 'CONFLICT_OR_MISMATCH' &&
        outcome.errorCode === 'STORED_SHA256_MISMATCH',
      `Expected STORED_SHA256_MISMATCH when actual streamed bytes differ from metadata sha256, got ${outcome.ok ? 'OK' : outcome.errorCode}`
    );
  });

  await test('4. Uint8Array byteOffset and custom byteLength slice correctness', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:03:00.000Z',
    });

    const rawDocx = makeValidDocxBuffer('اختبار شريحة البايتات المعزولة');
    const prefixNoise = Buffer.from('NOISE_PREFIX_1234567890', 'utf8');
    const suffixNoise = Buffer.from('NOISE_SUFFIX_0987654321', 'utf8');
    const compositeBacking = Buffer.concat([prefixNoise, rawDocx, suffixNoise]);

    const sliceView = new Uint8Array(
      compositeBacking.buffer,
      compositeBacking.byteOffset + prefixNoise.length,
      rawDocx.length
    );

    const { writePending } = makeWritePendingReceiptAndBytes({
      format: 'DOCX',
      bytesOverride: sliceView,
    });

    const outcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes: sliceView,
    });

    assert(outcome.ok, 'Expected Uint8Array slice write to succeed');
    if (!outcome.ok) return;

    const expectedSha = createHash('sha256')
      .update(rawDocx)
      .digest('hex')
      .toLowerCase();
    assert(
      outcome.attestation.attestedSha256 === expectedSha &&
        outcome.attestation.attestedByteSize === rawDocx.length,
      'Attested SHA-256 and byteSize must match only the exact Uint8Array view slice'
    );
  });

  await test('5. Rejection of invalid receipts, non-WritePending states, mismatched input bytes, and caller-supplied extra fields', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:04:00.000Z',
    });

    const { reserved, writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'DOCX',
    });

    // 5a. Reserved state rejected for write
    const reservedAttempt = await adapter.writeQuarantineObjectIfAbsent({
      receipt: reserved,
      bytes,
    });
    assert(
      !reservedAttempt.ok &&
        reservedAttempt.status === 'PREWRITE_REJECTED' &&
        reservedAttempt.errorCode === 'INVALID_RECEIPT_STATE_FOR_WRITE',
      'Reserved receipt must be rejected before writing'
    );

    // 5b. Rejected state rejected for write
    const rejectedTransition = rejectLibraryQuarantineReceipt({
      receipt: reserved,
      actorUid: reserved.uploaderUid,
      rejectionReasonCode: 'CANCELLED',
      nowIso: '2026-11-07T12:00:02.000Z',
    });
    assert(rejectedTransition.ok, 'Reject transition must succeed');
    if (!rejectedTransition.ok) return;

    const rejectedAttempt = await adapter.writeQuarantineObjectIfAbsent({
      receipt: rejectedTransition.receipt,
      bytes,
    });
    assert(
      !rejectedAttempt.ok &&
        rejectedAttempt.errorCode === 'INVALID_RECEIPT_STATE_FOR_WRITE',
      'Rejected receipt must be rejected before writing'
    );

    // 5c. Caller-supplied extra field (e.g., storagePath override) rejected
    const extraFieldAttempt = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
      storagePath: 'public/evil.docx',
    });
    assert(
      !extraFieldAttempt.ok &&
        extraFieldAttempt.errorCode === 'UNTRUSTED_CALLER_FIELD',
      'Caller-supplied extra field must be rejected'
    );

    // 5d. Input bytes differing from receipt.sha256 rejected before write
    const wrongDocx = makeValidDocxBuffer('محتوى مختلف تماماً');
    const wrongBytesAttempt = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes: wrongDocx,
    });
    assert(
      !wrongBytesAttempt.ok &&
        (wrongBytesAttempt.errorCode === 'INPUT_BYTE_SIZE_MISMATCH' ||
          wrongBytesAttempt.errorCode === 'INPUT_SHA256_MISMATCH'),
      'Mismatched input bytes must be rejected prior to GCS save'
    );

    assert(
      bucket.saveCalls === 0,
      'Zero GCS save calls should occur on pre-write rejections'
    );
  });

  await test('6. Existing matching object returns EXISTING_VERIFIED without overwriting', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:05:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'DOCX',
    });

    const firstWrite = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });
    assert(
      firstWrite.ok &&
        firstWrite.status === 'WRITTEN_AND_VERIFIED' &&
        firstWrite.createdNewObject === true,
      'First write must create object'
    );
    if (!firstWrite.ok) return;
    const firstGen = firstWrite.attestation.attestedGeneration;

    // Second write attempt hits 412 Precondition Failed and verifies existing object
    const secondWrite = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });
    assert(
      secondWrite.ok &&
        secondWrite.status === 'EXISTING_VERIFIED' &&
        secondWrite.createdNewObject === false &&
        secondWrite.attestation.attestedGeneration === firstGen,
      'Second write with identical object must return EXISTING_VERIFIED with same generation'
    );

    // Also test verifyExistingQuarantineObject directly (no save call)
    const saveCallsBeforeVerify = bucket.saveCalls;
    const verifiedExisting = await adapter.verifyExistingQuarantineObject({
      receipt: writePending,
    });
    assert(
      verifiedExisting.ok &&
        verifiedExisting.status === 'EXISTING_VERIFIED' &&
        verifiedExisting.createdNewObject === false &&
        bucket.saveCalls === saveCallsBeforeVerify,
      'verifyExistingQuarantineObject must verify without calling save()'
    );
  });

  await test('7. Existing conflicting object is rejected without overwrite', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:06:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'PDF',
    });

    const otherPdfBytes = makeValidPdfBuffer('DIFFERENT_CONTENT_PADDING_12345');
    const otherSha = createHash('sha256')
      .update(otherPdfBytes)
      .digest('hex')
      .toLowerCase();

    // Pre-populate conflicting object at the target path
    bucket.putRawObject(writePending.storagePath, otherPdfBytes, {
      name: writePending.storagePath,
      bucket: bucket.name,
      generation: '999000111',
      contentType: CANONICAL_PDF_MIME_TYPE,
      cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
      contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      size: String(otherPdfBytes.byteLength),
      metadata: {
        receiptId: writePending.receiptId,
        uploaderUid: writePending.uploaderUid,
        sha256: otherSha,
        format: 'PDF',
        quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      },
    });

    const conflictOutcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });

    assert(
      !conflictOutcome.ok &&
        conflictOutcome.status === 'CONFLICT_OR_MISMATCH' &&
        conflictOutcome.errorCode === 'EXISTING_OBJECT_CONFLICT',
      `Expected EXISTING_OBJECT_CONFLICT, got ${conflictOutcome.ok ? 'OK' : conflictOutcome.errorCode}`
    );

    // Confirm existing conflicting object was not overwritten
    const storedAfter = bucket.objects.get(writePending.storagePath);
    assert(
      storedAfter?.metadata.generation === '999000111',
      'Existing object generation must remain untouched on conflict'
    );
  });

  await test('8. Mismatched stored size, owner, MIME, or invalid generation fail closed on readback', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:07:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'PDF',
    });
    const rawBuf = Buffer.from(bytes);

    // 8a. Invalid generation ('0' or empty)
    bucket.putRawObject(writePending.storagePath, rawBuf, {
      name: writePending.storagePath,
      generation: '0',
      contentType: CANONICAL_PDF_MIME_TYPE,
      cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
      contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      size: String(rawBuf.length),
      metadata: {
        receiptId: writePending.receiptId,
        uploaderUid: writePending.uploaderUid,
        sha256: writePending.sha256,
        format: 'PDF',
        quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      },
    });
    const badGen = await adapter.verifyExistingQuarantineObject({
      receipt: writePending,
    });
    assert(
      !badGen.ok && badGen.errorCode === 'STORED_GENERATION_INVALID',
      'Expected STORED_GENERATION_INVALID for generation "0"'
    );

    // 8b. Wrong MIME type
    bucket.putRawObject(writePending.storagePath, rawBuf, {
      name: writePending.storagePath,
      generation: '123456',
      contentType: 'application/octet-stream',
      cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
      contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      size: String(rawBuf.length),
      metadata: {
        receiptId: writePending.receiptId,
        uploaderUid: writePending.uploaderUid,
        sha256: writePending.sha256,
        format: 'PDF',
        quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      },
    });
    const badMime = await adapter.verifyExistingQuarantineObject({
      receipt: writePending,
    });
    assert(
      !badMime.ok && badMime.errorCode === 'STORED_MIME_MISMATCH',
      'Expected STORED_MIME_MISMATCH for wrong contentType'
    );

    // 8c. Wrong owner in custom metadata
    bucket.putRawObject(writePending.storagePath, rawBuf, {
      name: writePending.storagePath,
      generation: '123456',
      contentType: CANONICAL_PDF_MIME_TYPE,
      cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
      contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      size: String(rawBuf.length),
      metadata: {
        receiptId: writePending.receiptId,
        uploaderUid: 'different_owner_uid',
        sha256: writePending.sha256,
        format: 'PDF',
        quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      },
    });
    const badOwner = await adapter.verifyExistingQuarantineObject({
      receipt: writePending,
    });
    assert(
      !badOwner.ok && badOwner.errorCode === 'EXISTING_OBJECT_CONFLICT',
      'Expected EXISTING_OBJECT_CONFLICT for mismatched owner'
    );
  });

  await test('9. Bounded readback aborts stream early when stored stream emits excess bytes', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:08:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'PDF',
    });
    const rawBuf = Buffer.from(bytes);

    // Simulate a deceptive stream that yields 5 chunks where chunk 2 already exceeds receipt.byteSize
    const chunk1 = rawBuf.subarray(0, 100);
    const chunk2 = Buffer.alloc(rawBuf.length + 50, 0x41);
    const chunk3 = Buffer.alloc(10_000, 0x42);
    const chunk4 = Buffer.alloc(10_000, 0x43);
    bucket.customStreamChunksOverride = [chunk1, chunk2, chunk3, chunk4];

    const outcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });

    assert(
      !outcome.ok &&
        outcome.status === 'CONFLICT_OR_MISMATCH' &&
        outcome.errorCode === 'STORED_BYTE_SIZE_EXCEEDED_OR_MISMATCH',
      'Expected STORED_BYTE_SIZE_EXCEEDED_OR_MISMATCH on excess streamed bytes'
    );
    assert(
      bucket.lastDestroyedStream === true &&
        bucket.chunksEmittedOnLastStream === 2,
      `Expected stream.destroy() to abort early at chunk 2 without reading chunks 3 and 4 (emitted=${bucket.chunksEmittedOnLastStream})`
    );
  });

  await test('10. Interrupted readback or ambiguous write returns NEEDS_RECONCILIATION without retrying, deleting, or rotating receiptId', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:09:00.000Z',
    });

    // 10a. Ambiguous network timeout during save()
    const caseA = makeWritePendingReceiptAndBytes({ format: 'DOCX' });
    bucket.nextSaveError = new Error(
      `ETIMEDOUT: Socket timeout writing to https://storage.googleapis.com/${caseA.writePending.storagePath}`
    );

    const saveTimeoutRes = await adapter.writeQuarantineObjectIfAbsent({
      receipt: caseA.writePending,
      bytes: caseA.bytes,
    });
    assert(
      !saveTimeoutRes.ok &&
        saveTimeoutRes.status === 'NEEDS_RECONCILIATION' &&
        saveTimeoutRes.errorCode === 'AMBIGUOUS_WRITE_OUTCOME',
      'Expected NEEDS_RECONCILIATION / AMBIGUOUS_WRITE_OUTCOME on save timeout'
    );
    if (saveTimeoutRes.ok || saveTimeoutRes.status !== 'NEEDS_RECONCILIATION') {
      return;
    }
    assert(
      saveTimeoutRes.receiptId === caseA.writePending.receiptId,
      'Receipt ID must be preserved without rotation on ambiguous write'
    );
    assert(
      !saveTimeoutRes.reconciliationReason.includes(
        caseA.writePending.storagePath
      ) &&
        !saveTimeoutRes.reconciliationReason.includes('library/quarantine') &&
        !saveTimeoutRes.reconciliationReason.includes('https://'),
      'reconciliationReason must redact internal storage paths and URLs'
    );
    assert(
      bucket.saveCalls === 1,
      'Adapter must not blindly retry save() on ambiguous write failure'
    );

    // Verify reconciliationReason is directly accepted by LIB-FILE-02A markLibraryQuarantineWriteNeedsReconciliation
    const markRecon = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: caseA.writePending,
      actorUid: caseA.writePending.uploaderUid,
      reconciliationReason: saveTimeoutRes.reconciliationReason,
      nowIso: '2026-11-07T12:09:15.000Z',
    });
    assert(
      markRecon.ok &&
        markRecon.receipt.state ===
          LibraryQuarantineReceiptState.NeedsReconciliation,
      'Sanitized reconciliationReason must be accepted by markLibraryQuarantineWriteNeedsReconciliation'
    );

    // 10b. Save succeeds, but stream readback drops mid-stream
    const caseB = makeWritePendingReceiptAndBytes({ format: 'PDF' });
    bucket.nextStreamErrorAfterFirstChunk = new Error(
      'ECONNRESET: Stream closed prematurely during readback'
    );

    const streamDropRes = await adapter.writeQuarantineObjectIfAbsent({
      receipt: caseB.writePending,
      bytes: caseB.bytes,
    });
    assert(
      !streamDropRes.ok &&
        streamDropRes.status === 'NEEDS_RECONCILIATION' &&
        streamDropRes.errorCode === 'READBACK_INTERRUPTED_AFTER_WRITE',
      'Expected READBACK_INTERRUPTED_AFTER_WRITE when stream drops mid-readback'
    );
    assert(
      bucket.objects.has(caseB.writePending.storagePath),
      'Adapter must NOT delete the written object when readback is interrupted'
    );
  });

  await test('11. Download-token, visible public-ACL, and insecure cache policy rejection', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:10:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'DOCX',
    });
    const rawBuf = Buffer.from(bytes);

    const baseMeta: GcsLibraryQuarantineObjectMetadata = {
      name: writePending.storagePath,
      generation: '777888999',
      contentType: CANONICAL_DOCX_MIME_TYPE,
      cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
      contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
      size: String(rawBuf.length),
      metadata: {
        receiptId: writePending.receiptId,
        uploaderUid: writePending.uploaderUid,
        sha256: writePending.sha256,
        format: 'DOCX',
        quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
      },
    };

    // 11a. firebaseStorageDownloadTokens in custom metadata
    bucket.putRawObject(writePending.storagePath, rawBuf, {
      ...baseMeta,
      metadata: {
        ...baseMeta.metadata,
        firebaseStorageDownloadTokens: 'secret-token-uuid-1234',
      },
    });
    const tokenRes = await adapter.verifyExistingQuarantineObject({
      receipt: writePending,
    });
    assert(
      !tokenRes.ok &&
        tokenRes.errorCode === 'PUBLIC_EXPOSURE_OR_TOKEN_DETECTED',
      'Expected PUBLIC_EXPOSURE_OR_TOKEN_DETECTED when firebaseStorageDownloadTokens is present'
    );

    // 11b. Visible allUsers ACL entry
    bucket.putRawObject(writePending.storagePath, rawBuf, {
      ...baseMeta,
      acl: [{ entity: 'allUsers', role: 'READER' }],
    });
    const aclRes = await adapter.verifyExistingQuarantineObject({
      receipt: writePending,
    });
    assert(
      !aclRes.ok && aclRes.errorCode === 'PUBLIC_EXPOSURE_OR_TOKEN_DETECTED',
      'Expected PUBLIC_EXPOSURE_OR_TOKEN_DETECTED when allUsers ACL is present'
    );

    // 11c. Non-private cacheControl
    bucket.putRawObject(writePending.storagePath, rawBuf, {
      ...baseMeta,
      cacheControl: 'public, max-age=3600',
    });
    const cacheRes = await adapter.verifyExistingQuarantineObject({
      receipt: writePending,
    });
    assert(
      !cacheRes.ok &&
        cacheRes.errorCode === 'INSECURE_CACHE_OR_DISPOSITION_POLICY',
      'Expected INSECURE_CACHE_OR_DISPOSITION_POLICY on public cacheControl'
    );
  });

  await test('12. No invented URLs, public storage paths, or bucket-level IAM false claims', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:11:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'PDF',
    });

    const outcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });
    assert(outcome.ok, 'Expected write to succeed');
    if (!outcome.ok) return;

    const outcomeRecord = outcome as unknown as Record<string, unknown>;
    const attestationRecord = outcome.attestation as unknown as Record<
      string,
      unknown
    >;

    for (const forbiddenKey of [
      'publicUrl',
      'signedUrl',
      'downloadUrl',
      'mediaLink',
      'selfLink',
      'downloadToken',
      'firebaseStorageDownloadTokens',
    ]) {
      assert(
        !(forbiddenKey in outcomeRecord) &&
          !(forbiddenKey in attestationRecord),
        `Forbidden URL/token property "${forbiddenKey}" must never appear on outcome or attestation`
      );
    }

    assert(
      outcome.bucketIamPrivacyVerified === false,
      'Adapter must explicitly report bucketIamPrivacyVerified: false (bucket IAM requires deployment verification)'
    );
  });

  await test('13. Zero Firestore mutations or real network calls and input receipt immutability', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:12:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'DOCX',
    });
    const snapshotBefore = JSON.stringify(writePending);

    const outcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });
    assert(outcome.ok, 'Expected write to succeed');

    // Input receipt state must remain WritePending (adapter does not mutate receipt or Firestore)
    assert(
      writePending.state === LibraryQuarantineReceiptState.WritePending &&
        JSON.stringify(writePending) === snapshotBefore,
      'Input WritePending receipt must remain completely unmutated'
    );
  });

  await test('14. No escalation to sanitized, verifiedSafe, rightsApproved, published, or readyForPeia, and baseline SHA-1 preservation', async () => {
    const bucket = new FakeQuarantineGcsBucket();
    const adapter = new GcsLibraryQuarantineStorageAdapter({
      bucket,
      clock: () => '2026-11-07T12:13:00.000Z',
    });

    const { writePending, bytes } = makeWritePendingReceiptAndBytes({
      format: 'DOCX',
    });

    const outcome = await adapter.writeQuarantineObjectIfAbsent({
      receipt: writePending,
      bytes,
    });
    assert(outcome.ok, 'Expected write to succeed');
    if (!outcome.ok) return;

    assert(
      outcome.isSanitized === false &&
        outcome.isVerifiedSafe === false &&
        outcome.isRightsApproved === false &&
        outcome.isPublished === false &&
        outcome.isReadyForPeia === false,
      'All safety, publication, and PEIA flags must remain strictly false'
    );

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
        path: 'functions/src/library/libraryUploadBinaryAdmission.ts',
        sha1: 'ea289629676addb05d89250e7f1599b71c5fb3d0',
      },
      {
        path: 'functions/src/library/libraryUploadDeepStructure.ts',
        sha1: '7e6ba463502bc8d6c796378d6b381cdaaf01c60e',
      },
      {
        path: 'functions/src/news/gcsEditorialBinaryStorageAdapter.ts',
        sha1: '4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e',
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
  });

  console.log('------------------------------------------------------------');
  console.log(
    `LIBRARY QUARANTINE GCS ADAPTER TESTS: ${passedTests}/${totalTests} PASSED`
  );
}

runAllTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exitCode = 1;
});
