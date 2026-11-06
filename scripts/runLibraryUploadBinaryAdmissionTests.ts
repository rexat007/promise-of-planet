import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  GENERIC_BINARY_MIME_TYPE,
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
  assessLibraryUploadBinaryCandidate,
  computeActualBytesSha256,
} from '../functions/src/library/libraryUploadBinaryAdmission';

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

function makeMinimalPreliminaryPdfBuffer(extraBody = ''): Buffer {
  const pdfText =
    '%PDF-1.7\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    extraBody +
    'xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \n' +
    'trailer\n<< /Size 2 /Root 1 0 R >>\n' +
    'startxref\n60\n' +
    '%%EOF\n';
  return Buffer.from(pdfText, 'latin1');
}

function makeMinimalPreliminaryZipContainerBuffer(
  entryName = '[Content_Types].xml',
  payloadText = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
): Buffer {
  const nameBuf = Buffer.from(entryName, 'utf8');
  const dataBuf = Buffer.from(payloadText, 'utf8');

  // 30-byte ZIP Local File Header
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  lfh.writeUInt16LE(20, 4); // version needed
  lfh.writeUInt16LE(0, 6); // flags
  lfh.writeUInt16LE(0, 8); // compression (0 = store)
  lfh.writeUInt16LE(0, 10); // mod time
  lfh.writeUInt16LE(0, 12); // mod date
  lfh.writeUInt32LE(0, 14); // crc32
  lfh.writeUInt32LE(dataBuf.length, 18); // compressed size
  lfh.writeUInt32LE(dataBuf.length, 22); // uncompressed size
  lfh.writeUInt16LE(nameBuf.length, 26); // filename length
  lfh.writeUInt16LE(0, 28); // extra field length

  // 46-byte Central Directory Header
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt32LE(dataBuf.length, 20);
  cdh.writeUInt32LE(dataBuf.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt32LE(0, 42); // local header offset

  const cdOffset = lfh.length + nameBuf.length + dataBuf.length;
  const cdSize = cdh.length + nameBuf.length;

  // 22-byte End of Central Directory (EOCD)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, nameBuf, dataBuf, cdh, nameBuf, eocd]);
}

function computeGitBlobSha1(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex');
}

async function runTests(): Promise<void> {
  await test('1. Valid preliminary PDF candidate with canonical MIME returns PENDING_DEEP_INSPECTION', () => {
    const pdfBytes = makeMinimalPreliminaryPdfBuffer();
    const expectedSha = createHash('sha256').update(pdfBytes).digest('hex');

    const result = assessLibraryUploadBinaryCandidate({
      originalFilename: 'environmental-water-law-2026.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: pdfBytes,
    });

    assert(result.status === 'PENDING_DEEP_INSPECTION', 'Must return PENDING_DEEP_INSPECTION');
    if (result.status === 'PENDING_DEEP_INSPECTION') {
      assert(result.format === 'PDF', 'Format must be PDF');
      assert(result.sizeBytes === pdfBytes.length, 'sizeBytes must match actual byte length');
      assert(result.sha256 === expectedSha, 'sha256 must match actual bytes');
      assert(result.preliminarySignatureKind === 'PDF_HEADER_AND_EOF', 'Signature kind is PDF_HEADER_AND_EOF');
      assert(
        result.candidateMetadata.sanitizedFilename === 'environmental-water-law-2026.pdf',
        'Sanitized filename preserved'
      );
      assert(result.candidateMetadata.canonicalExtension === 'pdf', 'Extension is pdf');
      assert(
        result.candidateMetadata.claimedMimeDisposition === 'EXACT_CANONICAL_MATCH',
        'Claimed MIME disposition is EXACT_CANONICAL_MATCH'
      );
      assert(result.deepInspectionRequired === true, 'deepInspectionRequired must be true');
      assert(result.isSanitized === false, 'isSanitized must be false');
      assert(result.isVerifiedSafe === false, 'isVerifiedSafe must be false');
      assert(result.isStored === false, 'isStored must be false');
      assert(result.isPublished === false, 'isPublished must be false');
      assert(result.isRightsApproved === false, 'isRightsApproved must be false');
      assert(result.isReadyForPeia === false, 'isReadyForPeia must be false');
    }
  });

  await test('2. Valid preliminary DOCX candidate with canonical MIME and generic/empty MIME returns PENDING_DEEP_INSPECTION only', () => {
    const docxBytes = makeMinimalPreliminaryZipContainerBuffer();
    const expectedSha = createHash('sha256').update(docxBytes).digest('hex');

    const exactMimeResult = assessLibraryUploadBinaryCandidate({
      originalFilename: 'coastal_regulation_draft_2026.DOCX',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: docxBytes,
    });

    assert(
      exactMimeResult.status === 'PENDING_DEEP_INSPECTION',
      'DOCX with canonical MIME must return PENDING_DEEP_INSPECTION'
    );
    if (exactMimeResult.status === 'PENDING_DEEP_INSPECTION') {
      assert(exactMimeResult.format === 'DOCX', 'Format must be DOCX');
      assert(exactMimeResult.sizeBytes === docxBytes.length, 'sizeBytes matches');
      assert(exactMimeResult.sha256 === expectedSha, 'sha256 matches actual bytes');
      assert(
        exactMimeResult.preliminarySignatureKind === 'ZIP_LOCAL_HEADER_ONLY',
        'Signature kind is ZIP_LOCAL_HEADER_ONLY'
      );
      assert(
        exactMimeResult.candidateMetadata.sanitizedFilename === 'coastal_regulation_draft_2026.docx',
        'Extension normalized to lowercase .docx'
      );
      assert(
        exactMimeResult.candidateMetadata.claimedMimeDisposition === 'EXACT_CANONICAL_MATCH',
        'Exact MIME match recorded'
      );
      assert(exactMimeResult.deepInspectionRequired === true, 'deepInspectionRequired must be true');
      assert(exactMimeResult.isSanitized === false, 'isSanitized must be false');
      assert(exactMimeResult.isVerifiedSafe === false, 'isVerifiedSafe must be false');
    }

    // Generic application/octet-stream or empty MIME allowed only to proceed to PENDING_DEEP_INSPECTION
    for (const genericMime of [undefined, null, '', '   ', GENERIC_BINARY_MIME_TYPE]) {
      const genericResult = assessLibraryUploadBinaryCandidate({
        originalFilename: 'coastal_regulation_draft_2026.docx',
        claimedMimeType: genericMime,
        bytes: docxBytes,
      });
      assert(
        genericResult.status === 'PENDING_DEEP_INSPECTION',
        `Generic/empty MIME (${String(genericMime)}) must proceed to PENDING_DEEP_INSPECTION`
      );
      if (genericResult.status === 'PENDING_DEEP_INSPECTION') {
        assert(
          genericResult.candidateMetadata.claimedMimeDisposition === 'GENERIC_OR_OMITTED',
          'Disposition must be GENERIC_OR_OMITTED (not treated as verified match)'
        );
      }
    }
  });

  await test('3. DOCX-like ZIP header without OpenXML structure is classified ONLY as PENDING_DEEP_INSPECTION (never verified/safe) and truncated/non-ZIP is rejected', () => {
    // Minimal ZIP with arbitrary text entry (not verified as real DOCX yet)
    const arbitraryZipAsDocx = makeMinimalPreliminaryZipContainerBuffer('hello.txt', 'plain text');
    const pendingRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'unverified-container.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: arbitraryZipAsDocx,
    });
    assert(
      pendingRes.status === 'PENDING_DEEP_INSPECTION',
      'Preliminary ZIP header is classified only as PENDING_DEEP_INSPECTION'
    );
    if (pendingRes.status === 'PENDING_DEEP_INSPECTION') {
      assert(pendingRes.preliminarySignatureKind === 'ZIP_LOCAL_HEADER_ONLY', 'Marked ZIP_LOCAL_HEADER_ONLY');
      assert(pendingRes.deepInspectionRequired === true, 'Requires deep inspection in LIB-FILE-01B');
      assert(pendingRes.isVerifiedSafe === false, 'Never marked verified safe from ZIP header alone');
      assert(
        pendingRes.admissionNotes.some((n: string) => n.includes('ZIP signature alone does NOT establish')),
        'Notes explicitly warn that ZIP signature alone does not establish valid DOCX'
      );
    }

    // Fake 4-byte PK\x03\x04 without valid Local File Header / EOCD must be rejected
    const fakeFourByteZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]);
    const fakeZipRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'truncated.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: fakeFourByteZip,
    });
    assert(fakeZipRes.status === 'REJECTED', 'Truncated fake ZIP header must be rejected');
    if (fakeZipRes.status === 'REJECTED') {
      assert(
        fakeZipRes.reasonCode === 'INVALID_ZIP_PRELIMINARY_STRUCTURE',
        'Reason must be INVALID_ZIP_PRELIMINARY_STRUCTURE'
      );
    }

    // Empty ZIP archive (PK\x05\x06) must be rejected
    const emptyZip = Buffer.alloc(64);
    emptyZip.writeUInt32LE(0x06054b50, 0);
    const emptyZipRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'empty-archive.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: emptyZip,
    });
    assert(emptyZipRes.status === 'REJECTED', 'Empty ZIP archive must be rejected');
    if (emptyZipRes.status === 'REJECTED') {
      assert(
        emptyZipRes.reasonCode === 'INVALID_ZIP_PRELIMINARY_STRUCTURE',
        'Reason must be INVALID_ZIP_PRELIMINARY_STRUCTURE'
      );
    }
  });

  await test('4. Wrong magic bytes and cross-named PDF/DOCX binaries are rejected', () => {
    const pdfBytes = makeMinimalPreliminaryPdfBuffer();
    const docxBytes = makeMinimalPreliminaryZipContainerBuffer();
    const randomBytes = Buffer.from('This is plain text pretending to be a binary document.', 'utf8');

    // Random bytes named .pdf
    const badPdfMagic = assessLibraryUploadBinaryCandidate({
      originalFilename: 'fake.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: randomBytes,
    });
    assert(
      badPdfMagic.status === 'REJECTED' && badPdfMagic.reasonCode === 'UNSUPPORTED_MAGIC_BYTES',
      'Plain text named .pdf must be rejected with UNSUPPORTED_MAGIC_BYTES'
    );

    // Random bytes named .docx
    const badDocxMagic = assessLibraryUploadBinaryCandidate({
      originalFilename: 'fake.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: randomBytes,
    });
    assert(
      badDocxMagic.status === 'REJECTED' && badDocxMagic.reasonCode === 'UNSUPPORTED_MAGIC_BYTES',
      'Plain text named .docx must be rejected with UNSUPPORTED_MAGIC_BYTES'
    );

    // PDF bytes named .docx
    const pdfNamedDocx = assessLibraryUploadBinaryCandidate({
      originalFilename: 'actually-a-pdf.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: pdfBytes,
    });
    assert(
      pdfNamedDocx.status === 'REJECTED' &&
        pdfNamedDocx.reasonCode === 'SIGNATURE_EXTENSION_MISMATCH',
      'PDF binary named .docx must be rejected with SIGNATURE_EXTENSION_MISMATCH'
    );

    // DOCX bytes named .pdf
    const docxNamedPdf = assessLibraryUploadBinaryCandidate({
      originalFilename: 'actually-a-docx.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: docxBytes,
    });
    assert(
      docxNamedPdf.status === 'REJECTED' &&
        docxNamedPdf.reasonCode === 'SIGNATURE_EXTENSION_MISMATCH',
      'DOCX binary named .pdf must be rejected with SIGNATURE_EXTENSION_MISMATCH'
    );
  });

  await test('5. Mismatched extensions and conflicting MIME claims are rejected', () => {
    const pdfBytes = makeMinimalPreliminaryPdfBuffer();
    const docxBytes = makeMinimalPreliminaryZipContainerBuffer();

    // .pdf with DOCX MIME
    const pdfWithDocxMime = assessLibraryUploadBinaryCandidate({
      originalFilename: 'report.pdf',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: pdfBytes,
    });
    assert(
      pdfWithDocxMime.status === 'REJECTED' &&
        pdfWithDocxMime.reasonCode === 'CLAIMED_MIME_MISMATCH',
      '.pdf with DOCX MIME must fail with CLAIMED_MIME_MISMATCH'
    );

    // .docx with PDF MIME
    const docxWithPdfMime = assessLibraryUploadBinaryCandidate({
      originalFilename: 'report.docx',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: docxBytes,
    });
    assert(
      docxWithPdfMime.status === 'REJECTED' &&
        docxWithPdfMime.reasonCode === 'CLAIMED_MIME_MISMATCH',
      '.docx with PDF MIME must fail with CLAIMED_MIME_MISMATCH'
    );

    // .docx with application/zip MIME
    const docxWithZipMime = assessLibraryUploadBinaryCandidate({
      originalFilename: 'report.docx',
      claimedMimeType: 'application/zip',
      bytes: docxBytes,
    });
    assert(
      docxWithZipMime.status === 'REJECTED' &&
        docxWithZipMime.reasonCode === 'CLAIMED_MIME_MISMATCH',
      '.docx with application/zip MIME must fail with CLAIMED_MIME_MISMATCH'
    );

    // Unsupported extension .zip
    const zipExtRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'archive.zip',
      claimedMimeType: 'application/zip',
      bytes: docxBytes,
    });
    assert(
      zipExtRes.status === 'REJECTED' &&
        zipExtRes.reasonCode === 'UNSUPPORTED_FILE_EXTENSION',
      '.zip extension must fail with UNSUPPORTED_FILE_EXTENSION'
    );
  });

  await test('6. Legacy .doc and macro-enabled .docm (by extension, MIME, OLE2 header, or embedded vbaProject.bin) are rejected', () => {
    const docxBytes = makeMinimalPreliminaryZipContainerBuffer();
    const ole2DocBytes = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(128, 0x20),
    ]);

    // 1. .doc extension
    const docExtRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'legacy-law-1994.doc',
      claimedMimeType: 'application/msword',
      bytes: ole2DocBytes,
    });
    assert(
      docExtRes.status === 'REJECTED' &&
        docExtRes.reasonCode === 'LEGACY_DOC_FORMAT_UNSUPPORTED',
      '.doc must be rejected with LEGACY_DOC_FORMAT_UNSUPPORTED'
    );

    // 2. OLE2 .doc renamed to .docx
    const ole2AsDocxRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'renamed-legacy.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: ole2DocBytes,
    });
    assert(
      ole2AsDocxRes.status === 'REJECTED' &&
        ole2AsDocxRes.reasonCode === 'LEGACY_DOC_FORMAT_UNSUPPORTED',
      'OLE2 binary renamed to .docx must be rejected with LEGACY_DOC_FORMAT_UNSUPPORTED'
    );

    // 3. .docm extension
    const docmExtRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'macro-report.docm',
      claimedMimeType: 'application/vnd.ms-word.document.macroEnabled.12',
      bytes: docxBytes,
    });
    assert(
      docmExtRes.status === 'REJECTED' &&
        docmExtRes.reasonCode === 'MACRO_ENABLED_FORMAT_FORBIDDEN',
      '.docm must be rejected with MACRO_ENABLED_FORMAT_FORBIDDEN'
    );

    // 4. .docx with macro MIME type
    const docxWithMacroMime = assessLibraryUploadBinaryCandidate({
      originalFilename: 'disguised.docx',
      claimedMimeType: 'application/vnd.ms-word.document.macroEnabled.12',
      bytes: docxBytes,
    });
    assert(
      docxWithMacroMime.status === 'REJECTED' &&
        docxWithMacroMime.reasonCode === 'MACRO_ENABLED_FORMAT_FORBIDDEN',
      '.docx with macro MIME must be rejected with MACRO_ENABLED_FORMAT_FORBIDDEN'
    );

    // 5. .docx containing vbaProject.bin entry
    const macroZipBytes = makeMinimalPreliminaryZipContainerBuffer('word/vbaProject.bin', 'VBA');
    const disguisedDocmRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'disguised-macro.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: macroZipBytes,
    });
    assert(
      disguisedDocmRes.status === 'REJECTED' &&
        disguisedDocmRes.reasonCode === 'MACRO_ENABLED_FORMAT_FORBIDDEN',
      '.docx containing vbaProject.bin must be rejected with MACRO_ENABLED_FORMAT_FORBIDDEN'
    );
  });

  await test('7. Empty input, exact 15,000,000-byte boundary, and oversized (> 15,000,000 bytes) input are handled correctly', () => {
    // 1. Empty 0-byte Buffer
    const emptyRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'empty.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: Buffer.alloc(0),
    });
    assert(
      emptyRes.status === 'REJECTED' &&
        emptyRes.reasonCode === 'EMPTY_BINARY' &&
        emptyRes.sizeBytes === 0 &&
        emptyRes.sha256 === null,
      '0-byte input must be rejected with EMPTY_BINARY and null sha256'
    );

    // 2. Exact 15,000,000-byte valid preliminary PDF succeeds
    const basePdf = makeMinimalPreliminaryPdfBuffer();
    const pdfPrefix = Buffer.from('%PDF-1.7\n% ', 'latin1');
    const pdfSuffix = Buffer.from(
      '\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n',
      'latin1'
    );
    const fillerLen =
      MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES - pdfPrefix.length - pdfSuffix.length;
    const exactMaxPdf = Buffer.alloc(MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES, 0x41);
    pdfPrefix.copy(exactMaxPdf, 0);
    pdfSuffix.copy(exactMaxPdf, pdfPrefix.length + fillerLen);

    const exactMaxRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'max-bound-report.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: exactMaxPdf,
    });
    assert(
      exactMaxRes.status === 'PENDING_DEEP_INSPECTION' &&
        exactMaxRes.sizeBytes === MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
      'Exact 15,000,000-byte valid preliminary PDF must be admitted as PENDING_DEEP_INSPECTION'
    );

    // 3. Oversized 15,000,001-byte buffer is rejected before hashing
    const oversizedBytes = Buffer.alloc(MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES + 1, 0x41);
    basePdf.copy(oversizedBytes, 0);
    const oversizedRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'oversized.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: oversizedBytes,
    });
    assert(
      oversizedRes.status === 'REJECTED' &&
        oversizedRes.reasonCode === 'SIZE_LIMIT_EXCEEDED' &&
        oversizedRes.sizeBytes === MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES + 1 &&
        oversizedRes.sha256 === null,
      '15,000,001-byte payload must be rejected with SIZE_LIMIT_EXCEEDED'
    );
  });

  await test('8. Legitimate Arabic and bilingual filenames are accepted and NFC-normalized', () => {
    const pdfBytes = makeMinimalPreliminaryPdfBuffer();
    const docxBytes = makeMinimalPreliminaryZipContainerBuffer();

    const arabicPdfRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'القانون_البيئي_الموحد_رقم_٤_لسنة_١٩٩٤ (نسخة محدثة).pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: pdfBytes,
    });
    assert(
      arabicPdfRes.status === 'PENDING_DEEP_INSPECTION',
      'Legitimate Arabic PDF filename must be accepted'
    );
    if (arabicPdfRes.status === 'PENDING_DEEP_INSPECTION') {
      assert(
        arabicPdfRes.candidateMetadata.sanitizedFilename ===
          'القانون_البيئي_الموحد_رقم_٤_لسنة_١٩٩٤ (نسخة محدثة).pdf',
        'Arabic filename preserved cleanly'
      );
    }

    const bilingualDocxRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'تقرير جودة المياه الساحلية - Coastal Water Report [2026].DOCX',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: docxBytes,
    });
    assert(
      bilingualDocxRes.status === 'PENDING_DEEP_INSPECTION',
      'Legitimate bilingual Arabic/English DOCX filename must be accepted'
    );
    if (bilingualDocxRes.status === 'PENDING_DEEP_INSPECTION') {
      assert(
        bilingualDocxRes.candidateMetadata.sanitizedFilename ===
          'تقرير جودة المياه الساحلية - Coastal Water Report [2026].docx',
        'Bilingual DOCX filename preserved with lowercase extension'
      );
    }
  });

  await test('9. Path traversal, separators, control/bidi characters, and deceptive double extensions are rejected', () => {
    const pdfBytes = makeMinimalPreliminaryPdfBuffer();

    const traversalFilenames = [
      '../secret.pdf',
      '..\\secret.pdf',
      'folder/report.pdf',
      'folder\\report.pdf',
      'C:\\temp\\report.pdf',
      'report.pdf:Zone.Identifier',
      '.hidden.pdf',
      'report..pdf',
    ];
    for (const badName of traversalFilenames) {
      const res = assessLibraryUploadBinaryCandidate({
        originalFilename: badName,
        claimedMimeType: CANONICAL_PDF_MIME_TYPE,
        bytes: pdfBytes,
      });
      assert(
        res.status === 'REJECTED' &&
          res.reasonCode === 'FILENAME_PATH_TRAVERSAL_OR_SEPARATOR',
        `Path/traversal filename "${badName}" must be rejected with FILENAME_PATH_TRAVERSAL_OR_SEPARATOR`
      );
    }

    const bidiAndControlFilenames = [
      'report\u202Efdp.exe.pdf', // Right-to-Left Override (RLO)
      'report\u200E.pdf', // Left-to-Right Mark (LRM)
      'report\u061C.pdf', // Arabic Letter Mark (ALM)
      'report\u2066.pdf', // Left-to-Right Isolate
      'report\u0000.pdf', // Null byte
      'report\nname.pdf', // Line feed
      'report\u200B.pdf', // Zero-width space
    ];
    for (const badName of bidiAndControlFilenames) {
      const res = assessLibraryUploadBinaryCandidate({
        originalFilename: badName,
        claimedMimeType: CANONICAL_PDF_MIME_TYPE,
        bytes: pdfBytes,
      });
      assert(
        res.status === 'REJECTED' &&
          res.reasonCode === 'FILENAME_CONTROL_OR_BIDI_CHARACTER',
        `Bidi/control filename must be rejected with FILENAME_CONTROL_OR_BIDI_CHARACTER`
      );
    }

    const deceptiveFilenames = [
      'report.exe.pdf',
      'report.pdf.docx',
      'report.docx.pdf',
      'report.docm.docx',
      'report.doc.pdf',
      'report.js.pdf',
      'report.html.pdf',
      'report.zip.docx',
    ];
    for (const badName of deceptiveFilenames) {
      const res = assessLibraryUploadBinaryCandidate({
        originalFilename: badName,
        claimedMimeType: CANONICAL_PDF_MIME_TYPE,
        bytes: pdfBytes,
      });
      assert(
        res.status === 'REJECTED' &&
          res.reasonCode === 'FILENAME_DECEPTIVE_OR_DOUBLE_EXTENSION',
        `Deceptive filename "${badName}" must be rejected with FILENAME_DECEPTIVE_OR_DOUBLE_EXTENSION`
      );
    }
  });

  await test('10. Actual-byte SHA-256 and Uint8Array view with non-zero byteOffset and custom byteLength are computed strictly from the slice', () => {
    const innerPdfBytes = makeMinimalPreliminaryPdfBuffer();
    const expectedInnerSha256 = createHash('sha256').update(innerPdfBytes).digest('hex');

    // Allocate a larger backing ArrayBuffer with prefix and suffix noise outside the view
    const prefixNoise = Buffer.from('NOISE_BEFORE_SLICE_!@#$%^&*()_1234567890', 'utf8');
    const suffixNoise = Buffer.from('NOISE_AFTER_SLICE_9876543210_ZYXWVUTSRQ', 'utf8');
    const combinedBuffer = Buffer.concat([prefixNoise, innerPdfBytes, suffixNoise]);

    const backingArrayBuffer = new ArrayBuffer(combinedBuffer.length);
    const fullView = new Uint8Array(backingArrayBuffer);
    fullView.set(combinedBuffer);

    const slicedUint8Array = new Uint8Array(
      backingArrayBuffer,
      prefixNoise.length,
      innerPdfBytes.length
    );

    assert(slicedUint8Array.byteOffset === prefixNoise.length, 'Non-zero byteOffset verified');
    assert(slicedUint8Array.byteLength === innerPdfBytes.length, 'Slice byteLength verified');

    const directSha = computeActualBytesSha256(slicedUint8Array);
    assert(
      directSha === expectedInnerSha256,
      'computeActualBytesSha256 must hash only the Uint8Array slice'
    );

    const admissionRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'offset-slice-test.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: slicedUint8Array,
    });

    assert(
      admissionRes.status === 'PENDING_DEEP_INSPECTION',
      'Uint8Array with non-zero byteOffset containing valid PDF slice must succeed'
    );
    if (admissionRes.status === 'PENDING_DEEP_INSPECTION') {
      assert(
        admissionRes.sizeBytes === innerPdfBytes.length,
        'sizeBytes must equal slice byteLength, not backing ArrayBuffer byteLength'
      );
      assert(
        admissionRes.sha256 === expectedInnerSha256,
        'sha256 must match the exact slice bytes, ignoring prefix/suffix noise in backing ArrayBuffer'
      );
    }
  });

  await test('11. PDF with active content (/JavaScript, /OpenAction, /Launch, hex-escaped /#4a#53) is rejected and never classified as sanitized', () => {
    const activeConstructs = [
      '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>\n',
      '/AA << /O << /S /Launch /F (cmd.exe) >> >>\n',
      '/Names << /EmbeddedFiles << >> >>\n',
      '/#4a#61#76#61#53#63#72#69#70#74 (escaped js)\n',
      '/XFA [ (form) ]\n',
    ];

    for (const construct of activeConstructs) {
      const activePdfBytes = makeMinimalPreliminaryPdfBuffer(construct);
      const res = assessLibraryUploadBinaryCandidate({
        originalFilename: 'active-content.pdf',
        claimedMimeType: CANONICAL_PDF_MIME_TYPE,
        bytes: activePdfBytes,
      });

      assert(res.status === 'REJECTED', `PDF with ${construct.trim()} must be REJECTED`);
      if (res.status === 'REJECTED') {
        assert(
          res.reasonCode === 'PDF_ACTIVE_CONTENT_DETECTED',
          `Reason code must be PDF_ACTIVE_CONTENT_DETECTED for ${construct.trim()}`
        );
      }
    }
  });

  await test('12. No false VERIFIED, SANITIZED, PUBLISHED, URL, or storage-path states, and untrusted extra input fields fail closed', () => {
    const pdfBytes = makeMinimalPreliminaryPdfBuffer();
    const res = assessLibraryUploadBinaryCandidate({
      originalFilename: 'clean-preliminary.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: pdfBytes,
    });

    assert(res.status === 'PENDING_DEEP_INSPECTION', 'Must be PENDING_DEEP_INSPECTION');
    const serialized = JSON.stringify(res);
    assert(!serialized.includes('"VERIFIED"'), 'Must not contain VERIFIED status');
    assert(!serialized.includes('"PRELIMINARY_VERIFIED"'), 'Must not contain PRELIMINARY_VERIFIED status');
    assert(!serialized.includes('"SANITIZED"'), 'Must not contain SANITIZED status');
    assert(!serialized.includes('"PUBLISHED"'), 'Must not contain PUBLISHED status');
    assert(!serialized.includes('gs://'), 'Must not construct gs:// storage paths');
    assert(!serialized.includes('https://'), 'Must not construct https:// public URLs');
    assert(!('storagePath' in res), 'Must not include storagePath property');
    assert(!('publicUrl' in res), 'Must not include publicUrl property');
    assert(!('referenceUrl' in res), 'Must not include referenceUrl property');

    // Untrusted caller fields (e.g. client-supplied sha256 or storagePath) must fail closed
    const spoofedInput = {
      originalFilename: 'clean-preliminary.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: pdfBytes,
      sha256: '0'.repeat(64),
    } as unknown as Parameters<typeof assessLibraryUploadBinaryCandidate>[0];

    const spoofedRes = assessLibraryUploadBinaryCandidate(spoofedInput);
    assert(
      spoofedRes.status === 'REJECTED' &&
        spoofedRes.reasonCode === 'UNTRUSTED_EXTRA_INPUT_FIELD',
      'Extra caller field sha256 must fail closed with UNTRUSTED_EXTRA_INPUT_FIELD'
    );
  });

  await test('13. Existing Library, Editorial Binary Inspector, and PEIA contracts remain untouched', () => {
    const expectedBaselineHashes: ReadonlyArray<readonly [string, string]> = [
      ['functions/src/shared/libraryContract.ts', 'cfb0849c0418ba7b075f7de49c3debe668adc724'],
      ['functions/src/library/libraryApplicationService.ts', '32b54a8946f3749c18b21ab7f4d0fb4c21b2ebcf'],
      ['functions/src/library/libraryAdminHandlers.ts', 'e8711ca2c4430fa4ea53d1e5c1005890ef33a479'],
      ['functions/src/library/firestoreLibraryRepository.ts', 'afba4876b6d736424bd0b344df1db9a5e1417327'],
      ['functions/src/news/editorialBinaryInspector.ts', '529d035c0d1fa13347168303de54d1ac0a815a0f'],
      ['functions/src/news/editorialNewsImageUploadEndpoint.ts', '2db26ba041c5d313f5c7d22ef328757a4a37ae55'],
      ['functions/src/peia/firestorePeiaTaskQueueService.ts', '70c5252cd91bdbbb72a3e4e1a77f19475be7353d'],
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
  console.log(`LIBRARY UPLOAD BINARY ADMISSION TESTS: ${passedTests}/${totalTests} PASSED`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
