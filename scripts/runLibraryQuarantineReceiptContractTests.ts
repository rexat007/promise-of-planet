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
  LIBRARY_QUARANTINE_RECEIPT_ID_HEX_LENGTH,
  LibraryQuarantineReceiptState,
  beginLibraryQuarantineWritePending,
  confirmLibraryQuarantineWriteWithAttestation,
  deriveLibraryQuarantineStoragePath,
  generateLibraryQuarantineReceiptId,
  isValidLibraryQuarantineReceiptId,
  markLibraryQuarantineWriteNeedsReconciliation,
  parseLibraryQuarantineStoragePath,
  reconcileLibraryQuarantineReceiptWithAttestation,
  rejectLibraryQuarantineReceipt,
  reserveLibraryQuarantineReceipt,
  toSanitizedLibraryQuarantineAdminReceiptDto,
  validateLibraryQuarantineInternalReceipt,
  type LibraryQuarantineInternalReceipt,
  type TrustedStorageReadbackAttestation,
} from '../functions/src/library/libraryQuarantineReceiptContract';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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
  '<w:body><w:p><w:r><w:t>اتفاقية حماية التنوع البيولوجي البحري 2026</w:t></w:r></w:p></w:body>' +
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

  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

function makeMinimalPreliminaryPdfBuffer(): Buffer {
  const pdfText =
    '%PDF-1.7\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    'xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \n' +
    'trailer\n<< /Size 2 /Root 1 0 R >>\n' +
    'startxref\n60\n' +
    '%%EOF\n';
  return Buffer.from(pdfText, 'latin1');
}

function makeMatchingAttestation(
  receipt: LibraryQuarantineInternalReceipt,
  generation = '1730901234567890',
  verifiedAtIso = '2026-11-06T14:05:00.000Z'
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

function computeGitBlobSha1(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex');
}

async function runTests(): Promise<void> {
  await test('1. Secure server-generated 128-bit quarantine identity and canonical path derivation', () => {
    const seenIds = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      const id = generateLibraryQuarantineReceiptId();
      assert(
        id.length === LIBRARY_QUARANTINE_RECEIPT_ID_HEX_LENGTH,
        'Receipt ID must be 32 hex chars (128 bits)'
      );
      assert(/^[0-9a-f]{32}$/.test(id), 'Receipt ID must be lowercase hex');
      assert(isValidLibraryQuarantineReceiptId(id), 'Validator must accept generated ID');
      assert(!seenIds.has(id), 'Generated 128-bit IDs must not collide');
      seenIds.add(id);
    }

    const sampleId = generateLibraryQuarantineReceiptId();
    const pdfPathRes = deriveLibraryQuarantineStoragePath(sampleId, 'PDF');
    assert(pdfPathRes.ok, 'PDF path derivation must succeed');
    if (pdfPathRes.ok) {
      assert(
        pdfPathRes.parsed.storagePath === `library/quarantine/${sampleId}/source.pdf`,
        'Canonical PDF quarantine path must match library/quarantine/<32-hex>/source.pdf'
      );
      assert(pdfPathRes.parsed.canonicalExtension === 'pdf', 'Extension is pdf');
      assert(pdfPathRes.parsed.canonicalMimeType === CANONICAL_PDF_MIME_TYPE, 'MIME is application/pdf');
    }

    const docxPathRes = deriveLibraryQuarantineStoragePath(sampleId, 'DOCX');
    assert(docxPathRes.ok, 'DOCX path derivation must succeed');
    if (docxPathRes.ok) {
      assert(
        docxPathRes.parsed.storagePath === `library/quarantine/${sampleId}/source.docx`,
        'Canonical DOCX quarantine path must match library/quarantine/<32-hex>/source.docx'
      );
      assert(docxPathRes.parsed.canonicalExtension === 'docx', 'Extension is docx');
      assert(
        docxPathRes.parsed.canonicalMimeType === CANONICAL_DOCX_MIME_TYPE,
        'MIME is canonical DOCX MIME'
      );
    }
  });

  await test('2. PDF and DOCX path isolation and preservation of LIB-FILE-01A / 01B inspection semantics', () => {
    const pdfBytes = makeMinimalPreliminaryPdfBuffer();
    const docxBytes = makeValidDocxBuffer();

    const pdfReserve = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_library_curator_01',
      originalFilename: 'قانون_المياه_الوطني_2026.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: pdfBytes,
      nowIso: '2026-11-06T14:00:00.000Z',
    });

    assert(pdfReserve.ok, 'PDF reservation must succeed in Reserved state');
    if (pdfReserve.ok) {
      assert(
        pdfReserve.receipt.state === LibraryQuarantineReceiptState.Reserved,
        'Initial state must be Reserved (never implying completed upload)'
      );
      assert(
        pdfReserve.receipt.deepInspectionStatus === 'PDF_REQUIRES_ISOLATED_PARSER',
        'PDF deepInspectionStatus must remain PDF_REQUIRES_ISOLATED_PARSER'
      );
      assert(
        pdfReserve.receipt.storagePath ===
          `library/quarantine/${pdfReserve.receipt.receiptId}/source.pdf`,
        'PDF storagePath uses isolated source.pdf and never includes original filename'
      );
      assert(
        !pdfReserve.receipt.storagePath.includes('قانون') &&
          !pdfReserve.receipt.storagePath.includes('admin_library_curator_01'),
        'Storage path must never embed original filename or uploaderUid'
      );
      assert(pdfReserve.receipt.generation === null, 'Initial generation must be null');
    }

    const docxReserve = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_library_curator_01',
      originalFilename: 'تقرير_التنوع_البيولوجي_2026.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: docxBytes,
      nowIso: '2026-11-06T14:00:00.000Z',
    });

    assert(docxReserve.ok, 'DOCX reservation must succeed in Reserved state');
    if (docxReserve.ok) {
      assert(
        docxReserve.receipt.state === LibraryQuarantineReceiptState.Reserved,
        'Initial state must be Reserved'
      );
      assert(
        docxReserve.receipt.deepInspectionStatus ===
          'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
        'DOCX deepInspectionStatus must remain DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
      );
      assert(
        docxReserve.receipt.storagePath ===
          `library/quarantine/${docxReserve.receipt.receiptId}/source.docx`,
        'DOCX storagePath uses isolated source.docx'
      );
    }
  });

  await test('3. Rejection of user-controlled storage paths, foreign namespaces, and caller-supplied identifiers or verdicts', () => {
    const validId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const invalidPaths = [
      '',
      `library/quarantine/${validId}/report.pdf`,
      `library/quarantine/${validId}/../../etc/passwd`,
      `/library/quarantine/${validId}/source.pdf`,
      `library/quarantine/${validId}/source.pdf/`,
      `library/quarantine/${validId.toUpperCase()}/source.pdf`,
      `library/quarantine/shortid/source.pdf`,
      `library/quarantine/${validId}/source.docm`,
      `library/quarantine/${validId}/source.exe`,
      `branding/platform-logo/source.pdf`,
      `citizen_submissions/user1/${validId}/source.pdf`,
      `editorial/quarantine/${validId}/source.pdf`,
      `library/public/${validId}/source.pdf`,
    ];

    for (const badPath of invalidPaths) {
      const parsed = parseLibraryQuarantineStoragePath(badPath);
      assert(
        !parsed.ok && parsed.errorCode === 'INVALID_STORAGE_PATH',
        `User-controlled or non-canonical path "${badPath}" must be rejected with INVALID_STORAGE_PATH`
      );
    }

    const docxBytes = makeValidDocxBuffer();
    const callerSpoofedFields = [
      { receiptId: validId },
      { storagePath: `library/quarantine/${validId}/source.docx` },
      { sha256: '0'.repeat(64) },
      { byteSize: 123 },
      { state: 'Quarantined' },
      { generation: '99999' },
      { deepInspectionStatus: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION' },
      { isVerifiedSafe: true },
    ];

    for (const extraField of callerSpoofedFields) {
      const spoofedInput = {
        uploaderUid: 'admin_01',
        originalFilename: 'document.docx',
        claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
        bytes: docxBytes,
        nowIso: '2026-11-06T14:00:00.000Z',
        ...extraField,
      } as unknown as Parameters<typeof reserveLibraryQuarantineReceipt>[0];

      const res = reserveLibraryQuarantineReceipt(spoofedInput);
      assert(
        !res.ok && res.errorCode === 'UNTRUSTED_CALLER_FIELD',
        `Spoofed caller field ${Object.keys(extraField)[0]} must be rejected with UNTRUSTED_CALLER_FIELD`
      );
    }
  });

  await test('4. Immutable owner, receiptId, SHA-256, byteSize, format, and Uint8Array slice integrity across transitions', () => {
    const innerDocx = makeValidDocxBuffer();
    const expectedSha256 = createHash('sha256').update(innerDocx).digest('hex');

    // Wrap in Uint8Array with non-zero byteOffset and surrounding noise
    const prefix = Buffer.from('PREFIX_NOISE_99999999', 'utf8');
    const suffix = Buffer.from('SUFFIX_NOISE_88888888', 'utf8');
    const full = Buffer.concat([prefix, innerDocx, suffix]);
    const ab = new ArrayBuffer(full.length);
    new Uint8Array(ab).set(full);
    const slicedBytes = new Uint8Array(ab, prefix.length, innerDocx.length);

    const reserved = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_owner_immutable',
      originalFilename: 'immutable-check.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: slicedBytes,
      nowIso: '2026-11-06T14:00:00.000Z',
    });
    assert(reserved.ok, 'Reserve from Uint8Array slice must succeed');
    if (!reserved.ok) return;

    const r0 = reserved.receipt;
    assert(r0.sha256 === expectedSha256, 'SHA-256 must match exact Uint8Array slice');
    assert(r0.byteSize === innerDocx.length, 'byteSize must match exact Uint8Array slice length');

    // Transition to WritePending
    const wpRes = beginLibraryQuarantineWritePending({
      receipt: r0,
      actorUid: 'admin_owner_immutable',
      expectedReceiptId: r0.receiptId,
      expectedSha256: r0.sha256,
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(wpRes.ok, 'Transition Reserved -> WritePending must succeed');
    if (!wpRes.ok) return;

    // Wrong actorUid must fail closed
    const wrongActorRes = beginLibraryQuarantineWritePending({
      receipt: r0,
      actorUid: 'different_admin_uid',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(
      !wrongActorRes.ok && wrongActorRes.errorCode === 'IMMUTABLE_IDENTITY_MISMATCH',
      'Different actorUid must fail with IMMUTABLE_IDENTITY_MISMATCH'
    );

    // Wrong expectedSha256 must fail closed
    const wrongShaRes = beginLibraryQuarantineWritePending({
      receipt: r0,
      actorUid: 'admin_owner_immutable',
      expectedSha256: 'f'.repeat(64),
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(
      !wrongShaRes.ok && wrongShaRes.errorCode === 'IMMUTABLE_IDENTITY_MISMATCH',
      'Mismatched expectedSha256 must fail with IMMUTABLE_IDENTITY_MISMATCH'
    );

    // Transition WritePending -> Quarantined
    const qRes = confirmLibraryQuarantineWriteWithAttestation({
      receipt: wpRes.receipt,
      actorUid: 'admin_owner_immutable',
      attestation: makeMatchingAttestation(wpRes.receipt, 'gen_1001', '2026-11-06T14:02:00.000Z'),
    });
    assert(qRes.ok, 'Transition WritePending -> Quarantined must succeed');
    if (!qRes.ok) return;

    const rFinal = qRes.receipt;
    assert(rFinal.receiptId === r0.receiptId, 'receiptId immutable');
    assert(rFinal.uploaderUid === r0.uploaderUid, 'uploaderUid immutable');
    assert(rFinal.sha256 === r0.sha256, 'sha256 immutable');
    assert(rFinal.byteSize === r0.byteSize, 'byteSize immutable');
    assert(rFinal.format === r0.format, 'format immutable');
    assert(rFinal.canonicalMimeType === r0.canonicalMimeType, 'canonicalMimeType immutable');
    assert(rFinal.storagePath === r0.storagePath, 'storagePath immutable');
    assert(rFinal.createdAt === r0.createdAt, 'createdAt immutable');
  });

  await test('5. Valid and invalid lifecycle state transitions and timestamp monotonicity', () => {
    const reserved = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_lifecycle',
      originalFilename: 'lifecycle.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: makeMinimalPreliminaryPdfBuffer(),
      nowIso: '2026-11-06T14:00:00.000Z',
    });
    assert(reserved.ok, 'Reservation must succeed');
    if (!reserved.ok) return;

    const rReserved = reserved.receipt;

    // Invalid: Reserved -> Quarantined directly (skipping WritePending)
    const skipWp = confirmLibraryQuarantineWriteWithAttestation({
      receipt: rReserved,
      actorUid: 'admin_lifecycle',
      attestation: makeMatchingAttestation(rReserved, 'gen_direct', '2026-11-06T14:01:00.000Z'),
    });
    assert(
      !skipWp.ok && skipWp.errorCode === 'INVALID_LIFECYCLE_TRANSITION',
      'Reserved -> Quarantined skipping WritePending must be rejected'
    );

    // Invalid: Reserved -> NeedsReconciliation directly
    const skipToRecon = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: rReserved,
      actorUid: 'admin_lifecycle',
      reconciliationReason: 'Write timeout before WritePending',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(
      !skipToRecon.ok && skipToRecon.errorCode === 'INVALID_LIFECYCLE_TRANSITION',
      'Reserved -> NeedsReconciliation must be rejected'
    );

    // Valid: Reserved -> Rejected
    const rejectedFromReserved = rejectLibraryQuarantineReceipt({
      receipt: rReserved,
      actorUid: 'admin_lifecycle',
      rejectionReasonCode: 'PRECONDITION_ABORTED',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(
      rejectedFromReserved.ok &&
        rejectedFromReserved.receipt.state === LibraryQuarantineReceiptState.Rejected,
      'Reserved -> Rejected must succeed'
    );

    // Invalid: Rejected -> WritePending
    if (rejectedFromReserved.ok) {
      const reviveRejected = beginLibraryQuarantineWritePending({
        receipt: rejectedFromReserved.receipt,
        actorUid: 'admin_lifecycle',
        nowIso: '2026-11-06T14:02:00.000Z',
      });
      assert(
        !reviveRejected.ok && reviveRejected.errorCode === 'INVALID_LIFECYCLE_TRANSITION',
        'Rejected -> WritePending must be rejected'
      );
    }

    // Valid: Reserved -> WritePending -> Quarantined
    const wp = beginLibraryQuarantineWritePending({
      receipt: rReserved,
      actorUid: 'admin_lifecycle',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(wp.ok, 'Reserved -> WritePending succeeds');
    if (!wp.ok) return;

    // Invalid: decreasing timestamp
    const backwardsClock = confirmLibraryQuarantineWriteWithAttestation({
      receipt: wp.receipt,
      actorUid: 'admin_lifecycle',
      attestation: makeMatchingAttestation(wp.receipt, 'gen_1', '2026-11-06T13:59:59.000Z'),
    });
    assert(
      !backwardsClock.ok && backwardsClock.errorCode === 'INVALID_TIMESTAMP',
      'Decreasing timestamp must be rejected with INVALID_TIMESTAMP'
    );

    const quarantined = confirmLibraryQuarantineWriteWithAttestation({
      receipt: wp.receipt,
      actorUid: 'admin_lifecycle',
      attestation: makeMatchingAttestation(wp.receipt, 'gen_1', '2026-11-06T14:02:00.000Z'),
    });
    assert(quarantined.ok, 'WritePending -> Quarantined succeeds');
    if (!quarantined.ok) return;

    // Invalid: Quarantined -> Rejected directly without cleanup workflow
    const rejectQuarantined = rejectLibraryQuarantineReceipt({
      receipt: quarantined.receipt,
      actorUid: 'admin_lifecycle',
      rejectionReasonCode: 'LATE_REJECT',
      nowIso: '2026-11-06T14:03:00.000Z',
    });
    assert(
      !rejectQuarantined.ok &&
        rejectQuarantined.errorCode === 'INVALID_LIFECYCLE_TRANSITION',
      'Quarantined -> Rejected directly must be blocked'
    );
  });

  await test('6. Matching and mismatching storage readback attestation verification', () => {
    const reserved = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_attest',
      originalFilename: 'attestation-test.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: makeValidDocxBuffer(),
      nowIso: '2026-11-06T14:00:00.000Z',
    });
    assert(reserved.ok, 'Reserve succeeds');
    if (!reserved.ok) return;

    const wp = beginLibraryQuarantineWritePending({
      receipt: reserved.receipt,
      actorUid: 'admin_attest',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(wp.ok, 'WritePending succeeds');
    if (!wp.ok) return;

    const baseAtt = makeMatchingAttestation(wp.receipt, 'gen_777', '2026-11-06T14:02:00.000Z');

    const mismatchCases: ReadonlyArray<{
      readonly label: string;
      readonly patch: Partial<TrustedStorageReadbackAttestation>;
      readonly expectedError: string;
    }> = [
      {
        label: 'mismatched receiptId',
        patch: { attestedReceiptId: '0'.repeat(32) },
        expectedError: 'STORAGE_ATTESTATION_MISMATCH',
      },
      {
        label: 'mismatched uploaderUid',
        patch: { attestedUploaderUid: 'other_admin' },
        expectedError: 'STORAGE_ATTESTATION_MISMATCH',
      },
      {
        label: 'mismatched storagePath',
        patch: {
          attestedStoragePath: `library/quarantine/${'0'.repeat(32)}/source.docx`,
        },
        expectedError: 'STORAGE_ATTESTATION_MISMATCH',
      },
      {
        label: 'mismatched format',
        patch: { attestedFormat: 'PDF' },
        expectedError: 'STORAGE_ATTESTATION_MISMATCH',
      },
      {
        label: 'mismatched contentType',
        patch: { attestedContentType: CANONICAL_PDF_MIME_TYPE },
        expectedError: 'STORAGE_ATTESTATION_MISMATCH',
      },
      {
        label: 'mismatched byteSize',
        patch: { attestedByteSize: wp.receipt.byteSize + 1 },
        expectedError: 'STORAGE_ATTESTATION_MISMATCH',
      },
      {
        label: 'mismatched sha256',
        patch: { attestedSha256: 'e'.repeat(64) },
        expectedError: 'STORAGE_ATTESTATION_MISMATCH',
      },
      {
        label: 'empty generation',
        patch: { attestedGeneration: '' },
        expectedError: 'INVALID_STORAGE_ATTESTATION',
      },
    ];

    for (const tc of mismatchCases) {
      const res = confirmLibraryQuarantineWriteWithAttestation({
        receipt: wp.receipt,
        actorUid: 'admin_attest',
        attestation: { ...baseAtt, ...tc.patch },
      });
      assert(
        !res.ok && res.errorCode === tc.expectedError,
        `Attestation with ${tc.label} must fail with ${tc.expectedError}`
      );
    }
  });

  await test('7. Ambiguous write handling and deterministic reconciliation without identity rotation', () => {
    const reserved = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_recon',
      originalFilename: 'ambiguous-write.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: makeMinimalPreliminaryPdfBuffer(),
      nowIso: '2026-11-06T14:00:00.000Z',
    });
    assert(reserved.ok, 'Reserve succeeds');
    if (!reserved.ok) return;

    const wp = beginLibraryQuarantineWritePending({
      receipt: reserved.receipt,
      actorUid: 'admin_recon',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(wp.ok, 'WritePending succeeds');
    if (!wp.ok) return;

    // Simulate network timeout / ambiguous write outcome -> NeedsReconciliation
    const reconPending = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: wp.receipt,
      actorUid: 'admin_recon',
      reconciliationReason: 'GCS conditional save timed out before metadata confirmation.',
      nowIso: '2026-11-06T14:02:00.000Z',
    });
    assert(
      reconPending.ok &&
        reconPending.receipt.state === LibraryQuarantineReceiptState.NeedsReconciliation,
      'Ambiguous write must transition to NeedsReconciliation'
    );
    if (!reconPending.ok) return;

    assert(
      reconPending.receipt.receiptId === reserved.receipt.receiptId &&
        reconPending.receipt.storagePath === reserved.receipt.storagePath,
      'NeedsReconciliation must preserve the exact same receiptId and storagePath'
    );
    assert(reconPending.receipt.generation === null, 'generation remains null while unconfirmed');
    assert(
      reconPending.adminReceiptDto.hasVerifiedStorageWrite === false &&
        reconPending.adminReceiptDto.reconciliationRequired === true,
      'Admin DTO indicates reconciliationRequired=true and hasVerifiedStorageWrite=false'
    );

    // Path A: Server metadata readback finds matching object -> reconcile to Quarantined
    const reconciledQuarantined = reconcileLibraryQuarantineReceiptWithAttestation({
      receipt: reconPending.receipt,
      actorUid: 'admin_recon',
      attestation: makeMatchingAttestation(
        reconPending.receipt,
        'gen_reconciled_42',
        '2026-11-06T14:03:00.000Z'
      ),
    });
    assert(
      reconciledQuarantined.ok &&
        reconciledQuarantined.receipt.state === LibraryQuarantineReceiptState.Quarantined &&
        reconciledQuarantined.receipt.generation === 'gen_reconciled_42' &&
        reconciledQuarantined.receipt.reconciliationReason === null,
      'Reconciliation with matching storage readback attestation transitions to Quarantined'
    );

    // Path B: Server metadata readback confirms object was never written (404) -> reconcile to Rejected
    const reconciledRejected = rejectLibraryQuarantineReceipt({
      receipt: reconPending.receipt,
      actorUid: 'admin_recon',
      rejectionReasonCode: 'RECONCILIATION_OBJECT_ABSENT',
      nowIso: '2026-11-06T14:03:00.000Z',
    });
    assert(
      reconciledRejected.ok &&
        reconciledRejected.receipt.state === LibraryQuarantineReceiptState.Rejected &&
        reconciledRejected.receipt.rejectionReasonCode === 'RECONCILIATION_OBJECT_ABSENT' &&
        reconciledRejected.receipt.reconciliationReason === null,
      'Reconciliation confirming object absence transitions to Rejected'
    );
  });

  await test('8. Duplicate / idempotent operation handling and conflicting duplicate detection', () => {
    const reserved = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_idem',
      originalFilename: 'idempotent.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: makeValidDocxBuffer(),
      nowIso: '2026-11-06T14:00:00.000Z',
    });
    assert(reserved.ok, 'Reserve succeeds');
    if (!reserved.ok) return;

    const wp1 = beginLibraryQuarantineWritePending({
      receipt: reserved.receipt,
      actorUid: 'admin_idem',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(wp1.ok && wp1.disposition === 'TRANSITIONED', 'First WritePending transitions');
    if (!wp1.ok) return;

    const wp2 = beginLibraryQuarantineWritePending({
      receipt: wp1.receipt,
      actorUid: 'admin_idem',
      nowIso: '2026-11-06T14:01:30.000Z',
    });
    assert(
      wp2.ok && wp2.disposition === 'IDEMPOTENT_NOOP',
      'Duplicate WritePending returns IDEMPOTENT_NOOP'
    );

    const att1 = makeMatchingAttestation(wp1.receipt, 'gen_555', '2026-11-06T14:02:00.000Z');
    const q1 = confirmLibraryQuarantineWriteWithAttestation({
      receipt: wp1.receipt,
      actorUid: 'admin_idem',
      attestation: att1,
    });
    assert(q1.ok && q1.disposition === 'TRANSITIONED', 'First confirmation transitions');
    if (!q1.ok) return;

    // Duplicate confirmation with identical generation -> IDEMPOTENT_NOOP
    const q2 = confirmLibraryQuarantineWriteWithAttestation({
      receipt: q1.receipt,
      actorUid: 'admin_idem',
      attestation: att1,
    });
    assert(
      q2.ok && q2.disposition === 'IDEMPOTENT_NOOP',
      'Duplicate confirmation with same generation returns IDEMPOTENT_NOOP'
    );

    // Duplicate confirmation with DIFFERENT generation -> STORAGE_ATTESTATION_MISMATCH
    const conflictingGen = confirmLibraryQuarantineWriteWithAttestation({
      receipt: q1.receipt,
      actorUid: 'admin_idem',
      attestation: makeMatchingAttestation(q1.receipt, 'gen_999_different', '2026-11-06T14:03:00.000Z'),
    });
    assert(
      !conflictingGen.ok &&
        conflictingGen.errorCode === 'STORAGE_ATTESTATION_MISMATCH',
      'Duplicate confirmation with different generation must fail with STORAGE_ATTESTATION_MISMATCH'
    );
  });

  await test('9. Administrative DTO redaction of storagePath, generation, tokens, URLs, and raw bytes', () => {
    const reserved = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_redaction',
      originalFilename: 'وثيقة_سرية_للمراجعة.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: makeMinimalPreliminaryPdfBuffer(),
      nowIso: '2026-11-06T14:00:00.000Z',
    });
    assert(reserved.ok, 'Reserve succeeds');
    if (!reserved.ok) return;

    const wp = beginLibraryQuarantineWritePending({
      receipt: reserved.receipt,
      actorUid: 'admin_redaction',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(wp.ok, 'WritePending succeeds');
    if (!wp.ok) return;

    const quarantined = confirmLibraryQuarantineWriteWithAttestation({
      receipt: wp.receipt,
      actorUid: 'admin_redaction',
      attestation: makeMatchingAttestation(
        wp.receipt,
        'secret_gcs_generation_987654321',
        '2026-11-06T14:02:00.000Z'
      ),
    });
    assert(quarantined.ok, 'Quarantined succeeds');
    if (!quarantined.ok) return;

    const dto = quarantined.adminReceiptDto;
    const serializedDto = JSON.stringify(dto);

    assert(!('storagePath' in dto), 'DTO must not contain storagePath property');
    assert(!('generation' in dto), 'DTO must not contain generation property');
    assert(!('bytes' in dto), 'DTO must not contain bytes property');
    assert(!('signedUrl' in dto), 'DTO must not contain signedUrl property');
    assert(!('publicUrl' in dto), 'DTO must not contain publicUrl property');
    assert(!('downloadToken' in dto), 'DTO must not contain downloadToken property');
    assert(
      !serializedDto.includes('library/quarantine'),
      'Serialized DTO must not leak library/quarantine internal path prefix'
    );
    assert(
      !serializedDto.includes('secret_gcs_generation_987654321'),
      'Serialized DTO must not leak GCS generation value'
    );
    assert(!serializedDto.includes('gs://'), 'Serialized DTO must not contain gs://');
    assert(!serializedDto.includes('https://'), 'Serialized DTO must not contain https://');

    // Also verify reconciliationReason cannot leak internal storage path
    const leakAttempt = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: wp.receipt,
      actorUid: 'admin_redaction',
      reconciliationReason: `Timeout writing to ${wp.receipt.storagePath}`,
      nowIso: '2026-11-06T14:02:00.000Z',
    });
    assert(
      !leakAttempt.ok && leakAttempt.errorCode === 'INVALID_RECONCILIATION_REASON',
      'reconciliationReason containing internal storagePath must be rejected'
    );
  });

  await test('10. Strict security state separation: Quarantined never implies safe, sanitized, rights-approved, published, or ready for PEIA', () => {
    const reserved = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_sec_flags',
      originalFilename: 'quarantined-only.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: makeValidDocxBuffer(),
      nowIso: '2026-11-06T14:00:00.000Z',
    });
    assert(reserved.ok, 'Reserve succeeds');
    if (!reserved.ok) return;

    const wp = beginLibraryQuarantineWritePending({
      receipt: reserved.receipt,
      actorUid: 'admin_sec_flags',
      nowIso: '2026-11-06T14:01:00.000Z',
    });
    assert(wp.ok, 'WritePending succeeds');
    if (!wp.ok) return;

    const q = confirmLibraryQuarantineWriteWithAttestation({
      receipt: wp.receipt,
      actorUid: 'admin_sec_flags',
      attestation: makeMatchingAttestation(wp.receipt, 'gen_sec_1', '2026-11-06T14:02:00.000Z'),
    });
    assert(q.ok, 'Quarantined succeeds');
    if (!q.ok) return;

    for (const r of [reserved.receipt, wp.receipt, q.receipt]) {
      assert(r.isSanitized === false, `isSanitized must be false in state ${r.state}`);
      assert(r.isVerifiedSafe === false, `isVerifiedSafe must be false in state ${r.state}`);
      assert(r.isRightsApproved === false, `isRightsApproved must be false in state ${r.state}`);
      assert(r.isPublished === false, `isPublished must be false in state ${r.state}`);
      assert(r.isReadyForPeia === false, `isReadyForPeia must be false in state ${r.state}`);
    }

    assert(q.adminReceiptDto.isQuarantinedPrivateOnly === true, 'Quarantined DTO marks isQuarantinedPrivateOnly=true');
    assert(q.adminReceiptDto.hasVerifiedStorageWrite === true, 'Quarantined DTO marks hasVerifiedStorageWrite=true');
    assert(q.adminReceiptDto.isSanitized === false, 'DTO isSanitized=false');
    assert(q.adminReceiptDto.isVerifiedSafe === false, 'DTO isVerifiedSafe=false');
    assert(q.adminReceiptDto.isRightsApproved === false, 'DTO isRightsApproved=false');
    assert(q.adminReceiptDto.isPublished === false, 'DTO isPublished=false');
    assert(q.adminReceiptDto.isReadyForPeia === false, 'DTO isReadyForPeia=false');

    // Tampering with any security boolean on an internal receipt must fail validation
    const tamperedFlags = [
      { isSanitized: true },
      { isVerifiedSafe: true },
      { isRightsApproved: true },
      { isPublished: true },
      { isReadyForPeia: true },
    ];
    for (const patch of tamperedFlags) {
      const check = validateLibraryQuarantineInternalReceipt({
        ...q.receipt,
        ...patch,
      });
      assert(
        !check.ok && check.errorCode === 'SECURITY_INVARIANT_VIOLATION',
        `Tampered security flag ${Object.keys(patch)[0]}=true must fail with SECURITY_INVARIANT_VIOLATION`
      );
    }
  });

  await test('11. Rejection of malformed contract inputs and invalid binary candidates via 01A / 01B re-execution', () => {
    // 11a. Invalid binary candidate (counterfeit single-entry ZIP that fails 01B)
    const counterfeitDocx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const badBinaryRes = reserveLibraryQuarantineReceipt({
      uploaderUid: 'admin_01',
      originalFilename: 'counterfeit.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: counterfeitDocx,
      nowIso: '2026-11-06T14:00:00.000Z',
    });
    assert(
      !badBinaryRes.ok &&
        badBinaryRes.errorCode === 'BINARY_ADMISSION_OR_STRUCTURE_REJECTED',
      'Invalid binary candidate must be rejected with BINARY_ADMISSION_OR_STRUCTURE_REJECTED'
    );

    // 11b. Invalid uploaderUid (path traversal or empty)
    for (const badUid of ['', '   ', '../admin', 'admin/01', 'admin\u0000']) {
      const res = reserveLibraryQuarantineReceipt({
        uploaderUid: badUid,
        originalFilename: 'valid.pdf',
        claimedMimeType: CANONICAL_PDF_MIME_TYPE,
        bytes: makeMinimalPreliminaryPdfBuffer(),
        nowIso: '2026-11-06T14:00:00.000Z',
      });
      assert(
        !res.ok && res.errorCode === 'INVALID_UPLOADER_UID',
        `Invalid uploaderUid "${badUid}" must be rejected with INVALID_UPLOADER_UID`
      );
    }

    // 11c. Invalid ISO-8601 UTC timestamp
    for (const badTs of ['', '2026-11-06', '2026-11-06T14:00:00+02:00', 'not-a-date']) {
      const res = reserveLibraryQuarantineReceipt({
        uploaderUid: 'admin_01',
        originalFilename: 'valid.pdf',
        claimedMimeType: CANONICAL_PDF_MIME_TYPE,
        bytes: makeMinimalPreliminaryPdfBuffer(),
        nowIso: badTs,
      });
      assert(
        !res.ok && res.errorCode === 'INVALID_TIMESTAMP',
        `Non-UTC or malformed timestamp "${badTs}" must be rejected with INVALID_TIMESTAMP`
      );
    }
  });

  await test('12. Zero storage, database, or network side effects and baseline file SHA-1 preservation', () => {
    const expectedBaselineHashes: ReadonlyArray<readonly [string, string]> = [
      ['functions/src/library/libraryUploadBinaryAdmission.ts', 'c479007641d799afb145436bf91e661a7c2d5611'],
      ['functions/src/library/libraryUploadDeepStructure.ts', '7e6ba463502bc8d6c796378d6b381cdaaf01c60e'],
      ['scripts/runLibraryUploadBinaryAdmissionTests.ts', 'daaaeee64e31dcbd0d9ef126769875829a6f75a5'],
      ['scripts/runLibraryUploadDeepStructureTests.ts', 'c46e8edd64456dc8db09652921ad957b9dbf1921'],
      ['functions/src/shared/libraryContract.ts', 'cfb0849c0418ba7b075f7de49c3debe668adc724'],
      ['functions/src/news/editorialBinaryIntakeService.ts', 'c905d500df376e546b71e6a091d1624890f39542'],
      ['functions/src/news/gcsEditorialBinaryStorageAdapter.ts', '4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e'],
      ['storage.rules', 'd77548e6b505d8db3858634cc2937937393a9864'],
      ['functions/package.json', '420e933933f4f582a4ded415727152021faf5400'],
      ['functions/tsconfig.json', 'eb3212ee4cd1c4acaa70618850e9c0fa0346dbf6'],
    ];

    for (const [filePath, expectedHash] of expectedBaselineHashes) {
      const actualHash = computeGitBlobSha1(filePath);
      assert(
        actualHash === expectedHash,
        `${filePath} Git blob SHA-1 must remain ${expectedHash} (got ${actualHash})`
      );
    }
  });

  console.log('------------------------------------------------------------');
  console.log(`LIBRARY QUARANTINE RECEIPT CONTRACT TESTS: ${passedTests}/${totalTests} PASSED`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
