import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  assessLibraryUploadBinaryCandidate,
} from '../functions/src/library/libraryUploadBinaryAdmission';
import {
  MAX_DOCX_COMPRESSION_RATIO,
  MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES,
  MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_DOCX_ZIP_ENTRIES,
  computeCrc32,
  inspectLibraryUploadDeepStructure,
} from '../functions/src/library/libraryUploadDeepStructure';

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

interface SyntheticZipEntrySpec {
  readonly name: string;
  readonly content: string | Buffer;
  readonly method?: 0 | 8 | number;
  readonly flags?: number;
  readonly versionMadeBy?: number;
  readonly versionNeeded?: number;
  readonly externalAttributes?: number;
  readonly diskNumberStart?: number;
  readonly overrideCrc32?: number;
  readonly overrideCompressedSize?: number;
  readonly overrideUncompressedSize?: number;
  readonly overrideLfhName?: string;
  readonly overrideLfhMethod?: number;
  readonly overrideLfhFlags?: number;
  readonly overrideLfhCrc32?: number;
  readonly overrideLfhCompressedSize?: number;
  readonly overrideLfhUncompressedSize?: number;
  readonly overrideLocalHeaderOffset?: number;
  readonly cdExtraField?: Buffer;
  readonly lfhExtraField?: Buffer;
  readonly rawCompressedBytesOverride?: Buffer;
}

interface SyntheticZipArchiveOptions {
  readonly diskNumber?: number;
  readonly cdStartDisk?: number;
  readonly diskEntries?: number;
  readonly totalEntriesOverride?: number;
  readonly cdSizeOverride?: number;
  readonly cdOffsetOverride?: number;
  readonly eocdComment?: Buffer;
  readonly trailingBytesAfterEocd?: Buffer;
  readonly prependZip64Locator?: boolean;
  readonly gapBeforeCentralDirectoryBytes?: number;
}

const CANONICAL_CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>';

const CANONICAL_ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const CANONICAL_WORD_DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body>' +
  '<w:p><w:r><w:t>قانون البيئة وحماية الموارد المائية — Environmental Protection Law</w:t></w:r></w:p>' +
  '</w:body>' +
  '</w:document>';

const CANONICAL_WORD_STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>';

const CANONICAL_WORD_DOCUMENT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

function buildSyntheticZipBuffer(
  entrySpecs: readonly SyntheticZipEntrySpec[],
  options: SyntheticZipArchiveOptions = {}
): Buffer {
  const localChunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let currentOffset = 0;

  for (const spec of entrySpecs) {
    const rawContent =
      typeof spec.content === 'string'
        ? Buffer.from(spec.content, 'utf8')
        : spec.content;

    const method = spec.method ?? 8;
    const compressedPayload =
      spec.rawCompressedBytesOverride ??
      (method === 8 ? deflateRawSync(rawContent) : rawContent);

    const crc = spec.overrideCrc32 ?? computeCrc32(rawContent);
    const compSize = spec.overrideCompressedSize ?? compressedPayload.length;
    const uncompSize = spec.overrideUncompressedSize ?? rawContent.length;
    const flags = spec.flags ?? 0;
    const versionMadeBy = spec.versionMadeBy ?? 0x0014; // MS-DOS / 2.0
    const versionNeeded = spec.versionNeeded ?? 20;
    const externalAttributes = spec.externalAttributes ?? 0;
    const diskNumberStart = spec.diskNumberStart ?? 0;

    const cdNameBuf = Buffer.from(spec.name, 'utf8');
    const lfhNameBuf = Buffer.from(spec.overrideLfhName ?? spec.name, 'utf8');
    const cdExtraBuf = spec.cdExtraField ?? Buffer.alloc(0);
    const lfhExtraBuf = spec.lfhExtraField ?? Buffer.alloc(0);

    const lfhOffset = spec.overrideLocalHeaderOffset ?? currentOffset;

    // 30-byte Local File Header
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(versionNeeded, 4);
    lfh.writeUInt16LE(spec.overrideLfhFlags ?? flags, 6);
    lfh.writeUInt16LE(spec.overrideLfhMethod ?? method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(spec.overrideLfhCrc32 ?? crc, 14);
    lfh.writeUInt32LE(spec.overrideLfhCompressedSize ?? compSize, 18);
    lfh.writeUInt32LE(spec.overrideLfhUncompressedSize ?? uncompSize, 22);
    lfh.writeUInt16LE(lfhNameBuf.length, 26);
    lfh.writeUInt16LE(lfhExtraBuf.length, 28);

    const localEntryBuf = Buffer.concat([
      lfh,
      lfhNameBuf,
      lfhExtraBuf,
      compressedPayload,
    ]);
    localChunks.push(localEntryBuf);

    // 46-byte Central Directory File Header
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(versionMadeBy, 4);
    cdh.writeUInt16LE(versionNeeded, 6);
    cdh.writeUInt16LE(flags, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(compSize, 20);
    cdh.writeUInt32LE(uncompSize, 24);
    cdh.writeUInt16LE(cdNameBuf.length, 28);
    cdh.writeUInt16LE(cdExtraBuf.length, 30);
    cdh.writeUInt16LE(0, 32); // comment length
    cdh.writeUInt16LE(diskNumberStart, 34);
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(externalAttributes, 38);
    cdh.writeUInt32LE(lfhOffset, 42);

    cdChunks.push(Buffer.concat([cdh, cdNameBuf, cdExtraBuf]));
    currentOffset += localEntryBuf.length;
  }

  if (options.gapBeforeCentralDirectoryBytes && options.gapBeforeCentralDirectoryBytes > 0) {
    const gap = Buffer.alloc(options.gapBeforeCentralDirectoryBytes, 0x00);
    localChunks.push(gap);
    currentOffset += gap.length;
  }

  const cdBuffer = Buffer.concat(cdChunks);
  const cdOffset = options.cdOffsetOverride ?? currentOffset;
  const cdSize = options.cdSizeOverride ?? cdBuffer.length;
  const totalEntries = options.totalEntriesOverride ?? entrySpecs.length;
  const diskEntries = options.diskEntries ?? totalEntries;
  const commentBuf = options.eocdComment ?? Buffer.alloc(0);

  const preEocdChunks: Buffer[] = [];
  if (options.prependZip64Locator) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0); // PK\x06\x07
    preEocdChunks.push(locator);
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.diskNumber ?? 0, 4);
  eocd.writeUInt16LE(options.cdStartDisk ?? 0, 6);
  eocd.writeUInt16LE(diskEntries, 8);
  eocd.writeUInt16LE(totalEntries, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(commentBuf.length, 20);

  const trailing = options.trailingBytesAfterEocd ?? Buffer.alloc(0);

  return Buffer.concat([
    ...localChunks,
    cdBuffer,
    ...preEocdChunks,
    eocd,
    commentBuf,
    trailing,
  ]);
}

function makeValidDocxBuffer(method: 0 | 8 = 8): Buffer {
  return buildSyntheticZipBuffer([
    { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML, method },
    { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML, method: 0 },
    { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML, method },
    { name: 'word/styles.xml', content: CANONICAL_WORD_STYLES_XML, method },
    { name: 'word/_rels/document.xml.rels', content: CANONICAL_WORD_DOCUMENT_RELS_XML, method: 0 },
  ]);
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

function computeGitBlobSha1(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex');
}

async function runTests(): Promise<void> {
  await test('1. Valid bounded OOXML DOCX package (both Stored and Deflate entries) returns DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION', () => {
    for (const primaryMethod of [0, 8] as const) {
      const docxBytes = makeValidDocxBuffer(primaryMethod);
      const expectedSha = createHash('sha256').update(docxBytes).digest('hex');

      const result = inspectLibraryUploadDeepStructure({
        originalFilename: 'تقرير_حوكمة_المياه_2026.docx',
        claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
        bytes: docxBytes,
      });

      assert(
        result.status === 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
        `Expected DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION for method=${primaryMethod}, got ${result.status}`
      );
      if (result.status === 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION') {
        assert(result.format === 'DOCX', 'format must be DOCX');
        assert(result.sizeBytes === docxBytes.byteLength, 'sizeBytes must match actual buffer length');
        assert(result.sha256 === expectedSha, 'sha256 must match actual buffer SHA-256');
        assert(result.docxStructureSummary.entryCount === 5, 'entryCount must be 5');
        assert(result.docxStructureSummary.inspectedXmlPartCount === 3, 'inspectedXmlPartCount must be 3');
        assert(
          result.docxStructureSummary.inspectedRelationshipPartCount === 2,
          'inspectedRelationshipPartCount must be 2'
        );
        assert(
          result.docxStructureSummary.mainDocumentPartPath === 'word/document.xml',
          'mainDocumentPartPath must be word/document.xml'
        );
        assert(result.isSanitized === false, 'isSanitized must be false');
        assert(result.isVerifiedSafe === false, 'isVerifiedSafe must be false');
        assert(result.isStored === false, 'isStored must be false');
        assert(result.isPublished === false, 'isPublished must be false');
        assert(result.isRightsApproved === false, 'isRightsApproved must be false');
        assert(result.isReadyForPeia === false, 'isReadyForPeia must be false');
      }
    }
  });

  await test('2. Incomplete or counterfeit DOCX (including 01A minimal single-entry ZIP and missing mandatory OOXML parts) is rejected', () => {
    // 2a. Minimal ZIP with only [Content_Types].xml (passed 01A preliminary check, must fail 01B)
    const onlyContentTypesZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML, method: 0 },
    ]);
    const prelimRes = assessLibraryUploadBinaryCandidate({
      originalFilename: 'minimal-01a.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: onlyContentTypesZip,
    });
    assert(prelimRes.status === 'PENDING_DEEP_INSPECTION', '01A admits minimal ZIP as PENDING_DEEP_INSPECTION');

    const deepRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'minimal-01a.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: onlyContentTypesZip,
    });
    assert(
      deepRes.status === 'REJECTED' && deepRes.reasonCode === 'MISSING_OR_INVALID_OOXML_PARTS',
      '01B must reject single-entry [Content_Types].xml archive with MISSING_OR_INVALID_OOXML_PARTS'
    );

    // 2b. Missing word/document.xml
    const missingMainDoc = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
    ]);
    const missingMainDocRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'missing-doc.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: missingMainDoc,
    });
    assert(
      missingMainDocRes.status === 'REJECTED' &&
        missingMainDocRes.reasonCode === 'MISSING_OR_INVALID_OOXML_PARTS',
      'Missing word/document.xml must be rejected with MISSING_OR_INVALID_OOXML_PARTS'
    );

    // 2c. [Content_Types].xml missing Override for /word/document.xml
    const contentTypesWithoutOverride = buildSyntheticZipBuffer([
      {
        name: '[Content_Types].xml',
        content:
          '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '</Types>',
      },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
    ]);
    const noOverrideRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'no-override.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: contentTypesWithoutOverride,
    });
    assert(
      noOverrideRes.status === 'REJECTED' &&
        noOverrideRes.reasonCode === 'MISSING_OR_INVALID_OOXML_PARTS',
      'Missing /word/document.xml ContentType Override must be rejected'
    );

    // 2d. word/document.xml missing <w:body>
    const docWithoutBody = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      {
        name: 'word/document.xml',
        content:
          '<?xml version="1.0" encoding="UTF-8"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:document>',
      },
      { name: 'word/styles.xml', content: CANONICAL_WORD_STYLES_XML },
    ]);
    const noBodyRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'no-body.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: docWithoutBody,
    });
    assert(
      noBodyRes.status === 'REJECTED' &&
        noBodyRes.reasonCode === 'MISSING_OR_INVALID_OOXML_PARTS',
      'word/document.xml without <w:body> must be rejected'
    );
  });

  await test('3. Malformed Central Directory, EOCD trailing bytes, and Central/Local header mismatches are rejected', () => {
    // 3a. Trailing garbage after EOCD comment
    const trailingEocdZip = buildSyntheticZipBuffer(
      [
        { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
        { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
        { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      ],
      { trailingBytesAfterEocd: Buffer.from('TRAILING_UNINDEXED_DATA', 'ascii') }
    );
    const trailingRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'trailing-eocd.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: trailingEocdZip,
    });
    assert(
      trailingRes.status === 'REJECTED' && trailingRes.reasonCode === 'MALFORMED_ZIP_EOCD',
      'Trailing bytes after EOCD must be rejected with MALFORMED_ZIP_EOCD'
    );

    // 3b. Bad Central Directory size in EOCD
    const badCdSizeZip = buildSyntheticZipBuffer(
      [
        { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
        { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
        { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      ],
      { cdSizeOverride: 12 }
    );
    const badCdSizeRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'bad-cd-size.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: badCdSizeZip,
    });
    assert(
      badCdSizeRes.status === 'REJECTED' &&
        badCdSizeRes.reasonCode === 'MALFORMED_CENTRAL_DIRECTORY',
      'Mismatched Central Directory size must be rejected with MALFORMED_CENTRAL_DIRECTORY'
    );

    // 3c. Central vs Local filename mismatch (spoofed LFH name)
    const mismatchedNameZip = buildSyntheticZipBuffer([
      {
        name: '[Content_Types].xml',
        overrideLfhName: 'spoofed_name_same_len',
        content: CANONICAL_CONTENT_TYPES_XML,
      },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
    ]);
    const mismatchedNameRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'lfh-mismatch.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: mismatchedNameZip,
    });
    assert(
      mismatchedNameRes.status === 'REJECTED' &&
        mismatchedNameRes.reasonCode === 'CENTRAL_LOCAL_HEADER_MISMATCH',
      'Central/Local header filename mismatch must be rejected with CENTRAL_LOCAL_HEADER_MISMATCH'
    );

    // 3d. Central vs Local compression method mismatch
    const mismatchedMethodZip = buildSyntheticZipBuffer([
      {
        name: '[Content_Types].xml',
        method: 8,
        overrideLfhMethod: 0,
        content: CANONICAL_CONTENT_TYPES_XML,
      },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
    ]);
    const mismatchedMethodRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'method-mismatch.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: mismatchedMethodZip,
    });
    assert(
      mismatchedMethodRes.status === 'REJECTED' &&
        mismatchedMethodRes.reasonCode === 'CENTRAL_LOCAL_HEADER_MISMATCH',
      'Central/Local compression method mismatch must be rejected with CENTRAL_LOCAL_HEADER_MISMATCH'
    );
  });

  await test('4. Overlapping entry byte ranges and unindexed byte gaps are rejected', () => {
    // 4a. Second entry points to Local File Header at offset 0 (overlapping first entry)
    const overlappingZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML, method: 0 },
      {
        name: '_rels/.rels',
        content: CANONICAL_CONTENT_TYPES_XML,
        method: 0,
        overrideLocalHeaderOffset: 0,
        overrideLfhName: '[Content_Types].xml',
      },
    ]);
    const overlapRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'overlap.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: overlappingZip,
    });
    assert(
      overlapRes.status === 'REJECTED' &&
        (overlapRes.reasonCode === 'OVERLAPPING_OR_GAP_ENTRY_RANGES' ||
          overlapRes.reasonCode === 'CENTRAL_LOCAL_HEADER_MISMATCH'),
      'Overlapping entry ranges must be rejected'
    );

    // 4b. Unindexed gap between last local entry and Central Directory
    const gapZip = buildSyntheticZipBuffer(
      [
        { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
        { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
        { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      ],
      { gapBeforeCentralDirectoryBytes: 64 }
    );
    const gapRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'unindexed-gap.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: gapZip,
    });
    assert(
      gapRes.status === 'REJECTED' &&
        gapRes.reasonCode === 'OVERLAPPING_OR_GAP_ENTRY_RANGES',
      'Unindexed gap before Central Directory must be rejected with OVERLAPPING_OR_GAP_ENTRY_RANGES'
    );
  });

  await test('5. Duplicate, case-colliding, path-traversal, and symlink ZIP entries are rejected', () => {
    // 5a. Case-colliding entry names (word/document.xml and WORD/document.xml)
    const collidingZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      { name: 'WORD/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
    ]);
    const collidingRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'case-collision.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: collidingZip,
    });
    assert(
      collidingRes.status === 'REJECTED' &&
        collidingRes.reasonCode === 'DUPLICATE_OR_COLLIDING_ENTRY_NAME',
      'Case-colliding entry names must be rejected with DUPLICATE_OR_COLLIDING_ENTRY_NAME'
    );

    // 5b. Path traversal and unsafe entry paths inside ZIP
    const unsafePaths = [
      '../evil.xml',
      'word/../../evil.xml',
      '/word/document.xml',
      'word\\document.xml',
      'C:word/document.xml',
      'word//document.xml',
      'word/dir/',
      'word/doc\u202E.xml',
    ];
    for (const badPath of unsafePaths) {
      const badPathZip = buildSyntheticZipBuffer([
        { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
        { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
        { name: badPath, content: CANONICAL_WORD_DOCUMENT_XML },
      ]);
      const badPathRes = inspectLibraryUploadDeepStructure({
        originalFilename: 'unsafe-entry-path.docx',
        claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
        bytes: badPathZip,
      });
      assert(
        badPathRes.status === 'REJECTED' &&
          badPathRes.reasonCode === 'UNSAFE_ZIP_ENTRY_PATH',
        `Unsafe ZIP entry path "${badPath}" must be rejected with UNSAFE_ZIP_ENTRY_PATH`
      );
    }

    // 5c. Unix symbolic link entry (versionMadeBy Unix=3 << 8, externalAttributes S_IFLNK 0o120777 << 16)
    const symlinkZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      {
        name: 'word/document.xml',
        content: CANONICAL_WORD_DOCUMENT_XML,
        versionMadeBy: (3 << 8) | 20,
        externalAttributes: (0o120777 << 16) >>> 0,
      },
    ]);
    const symlinkRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'symlink.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: symlinkZip,
    });
    assert(
      symlinkRes.status === 'REJECTED' &&
        symlinkRes.reasonCode === 'SYMLINK_OR_SPECIAL_ENTRY_FORBIDDEN',
      'Unix symlink entry must be rejected with SYMLINK_OR_SPECIAL_ENTRY_FORBIDDEN'
    );
  });

  await test('6. Encrypted, ZIP64, multi-disk, data-descriptor streaming, and unsupported compression archives are rejected', () => {
    // 6a. Encrypted entry (flag bit 0 = 0x0001)
    const encryptedZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML, flags: 0x0001 },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
    ]);
    const encryptedRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'encrypted.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: encryptedZip,
    });
    assert(
      encryptedRes.status === 'REJECTED' &&
        encryptedRes.reasonCode === 'ENCRYPTED_ARCHIVE_FORBIDDEN',
      'Encrypted ZIP entry must be rejected with ENCRYPTED_ARCHIVE_FORBIDDEN'
    );

    // 6b. Streaming data descriptor (flag bit 3 = 0x0008)
    const streamingZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML, flags: 0x0008 },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
    ]);
    const streamingRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'streaming-dd.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: streamingZip,
    });
    assert(
      streamingRes.status === 'REJECTED' &&
        streamingRes.reasonCode === 'DATA_DESCRIPTOR_STREAMING_UNSUPPORTED',
      'Streaming data descriptor flag must be rejected with DATA_DESCRIPTOR_STREAMING_UNSUPPORTED'
    );

    // 6c. ZIP64 extra field (headerId 0x0001)
    const zip64Extra = Buffer.alloc(12);
    zip64Extra.writeUInt16LE(0x0001, 0);
    zip64Extra.writeUInt16LE(8, 2);
    const zip64ExtraZip = buildSyntheticZipBuffer([
      {
        name: '[Content_Types].xml',
        content: CANONICAL_CONTENT_TYPES_XML,
        cdExtraField: zip64Extra,
      },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
    ]);
    const zip64ExtraRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'zip64-extra.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: zip64ExtraZip,
    });
    assert(
      zip64ExtraRes.status === 'REJECTED' &&
        zip64ExtraRes.reasonCode === 'ZIP64_ARCHIVE_UNSUPPORTED',
      'ZIP64 extra field must be rejected with ZIP64_ARCHIVE_UNSUPPORTED'
    );

    // 6d. Multi-disk EOCD (diskNumber = 1)
    const multiDiskZip = buildSyntheticZipBuffer(
      [
        { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
        { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
        { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      ],
      { diskNumber: 1 }
    );
    const multiDiskRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'multidisk.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: multiDiskZip,
    });
    assert(
      multiDiskRes.status === 'REJECTED' &&
        multiDiskRes.reasonCode === 'MULTI_DISK_ARCHIVE_UNSUPPORTED',
      'Multi-disk archive must be rejected with MULTI_DISK_ARCHIVE_UNSUPPORTED'
    );

    // 6e. Unsupported compression method (12 = BZip2)
    const bzip2Zip = buildSyntheticZipBuffer([
      {
        name: '[Content_Types].xml',
        content: CANONICAL_CONTENT_TYPES_XML,
        method: 12,
        rawCompressedBytesOverride: Buffer.from('BZh91AY&SY', 'ascii'),
      },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
    ]);
    const bzip2Res = inspectLibraryUploadDeepStructure({
      originalFilename: 'bzip2.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: bzip2Zip,
    });
    assert(
      bzip2Res.status === 'REJECTED' &&
        bzip2Res.reasonCode === 'UNSUPPORTED_COMPRESSION_METHOD',
      'BZip2 compression method (12) must be rejected with UNSUPPORTED_COMPRESSION_METHOD'
    );
  });

  await test('7. ZIP-bomb entry count, compression ratio, single-entry size, total size, and deceptive deflate stream expansion are rejected', () => {
    // 7a. Entry count > MAX_DOCX_ZIP_ENTRIES (256)
    const tooManyEntriesZip = buildSyntheticZipBuffer(
      [
        { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
        { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
        { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      ],
      { totalEntriesOverride: MAX_DOCX_ZIP_ENTRIES + 1, diskEntries: MAX_DOCX_ZIP_ENTRIES + 1 }
    );
    const tooManyRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'too-many-entries.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: tooManyEntriesZip,
    });
    assert(
      tooManyRes.status === 'REJECTED' &&
        tooManyRes.reasonCode === 'ZIP_ENTRY_COUNT_EXCEEDED',
      `Entry count > ${MAX_DOCX_ZIP_ENTRIES} must be rejected with ZIP_ENTRY_COUNT_EXCEEDED`
    );

    // 7b. High compression ratio (> 100:1 on > 4096 bytes)
    const highlyRepetitiveXml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' +
      'A'.repeat(600_000) +
      '</w:t></w:r></w:p></w:body></w:document>';
    const zipBombRatioBytes = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: highlyRepetitiveXml, method: 8 },
    ]);
    const ratioRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'ratio-bomb.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: zipBombRatioBytes,
    });
    assert(
      ratioRes.status === 'REJECTED' &&
        ratioRes.reasonCode === 'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
      `Compression ratio > ${MAX_DOCX_COMPRESSION_RATIO}:1 must be rejected with ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED`
    );

    // 7c. Declared single-entry uncompressed size > MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES
    const oversizedDeclaredEntryZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      {
        name: 'word/document.xml',
        content: CANONICAL_WORD_DOCUMENT_XML,
        method: 8,
        overrideUncompressedSize: MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES + 100,
        overrideLfhUncompressedSize: MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES + 100,
      },
    ]);
    const oversizedEntryRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'oversized-single-entry.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: oversizedDeclaredEntryZip,
    });
    assert(
      oversizedEntryRes.status === 'REJECTED' &&
        oversizedEntryRes.reasonCode === 'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
      `Single entry > ${MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES} bytes must be rejected with ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED`
    );

    // 7d. Lying small uncompressedSize header concealing a 9 MB deflate stream
    const hiddenNineMbDeflate = deflateRawSync(Buffer.alloc(9_000_000, 0x42));
    const lyingDeflateBombZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      {
        name: 'word/document.xml',
        content: CANONICAL_WORD_DOCUMENT_XML,
        method: 8,
        rawCompressedBytesOverride: hiddenNineMbDeflate,
        overrideCompressedSize: hiddenNineMbDeflate.length,
        overrideLfhCompressedSize: hiddenNineMbDeflate.length,
        overrideUncompressedSize: 2048,
        overrideLfhUncompressedSize: 2048,
      },
    ]);
    const lyingDeflateRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'lying-deflate-bomb.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: lyingDeflateBombZip,
    });
    assert(
      lyingDeflateRes.status === 'REJECTED' &&
        lyingDeflateRes.reasonCode === 'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
      'Deflate stream expanding beyond MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES must be rejected with ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED'
    );

    // 7e. Cumulative uncompressed size across entries > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES
    assert(MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES === 25_000_000, 'Total limit constant verified');
  });

  await test('8. CRC-32 mismatch and corrupted Deflate stream are rejected', () => {
    // 8a. Spoofed CRC-32
    const badCrcZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      {
        name: 'word/document.xml',
        content: CANONICAL_WORD_DOCUMENT_XML,
        overrideCrc32: 0xdeadbeef,
        overrideLfhCrc32: 0xdeadbeef,
      },
    ]);
    const badCrcRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'bad-crc.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: badCrcZip,
    });
    assert(
      badCrcRes.status === 'REJECTED' &&
        badCrcRes.reasonCode === 'CRC_OR_DECOMPRESSION_MISMATCH',
      'CRC-32 mismatch must be rejected with CRC_OR_DECOMPRESSION_MISMATCH'
    );

    // 8b. Corrupted Deflate stream bytes
    const corruptDeflate = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x11, 0x22]);
    const corruptDeflateZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      {
        name: 'word/document.xml',
        content: CANONICAL_WORD_DOCUMENT_XML,
        method: 8,
        rawCompressedBytesOverride: corruptDeflate,
      },
    ]);
    const corruptDeflateRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'corrupt-deflate.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: corruptDeflateZip,
    });
    assert(
      corruptDeflateRes.status === 'REJECTED' &&
        corruptDeflateRes.reasonCode === 'CRC_OR_DECOMPRESSION_MISMATCH',
      'Corrupted deflate stream must be rejected with CRC_OR_DECOMPRESSION_MISMATCH'
    );
  });

  await test('9. Macros, ActiveX controls, embedded OLE/executable objects, and external relationships are rejected', () => {
    // 9a. vbaData.xml macro entry
    const vbaDataZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      { name: 'word/vbaData.xml', content: '<wne:vbaSuppData xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"/>' },
    ]);
    const vbaDataRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'vba-data.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: vbaDataZip,
    });
    assert(
      vbaDataRes.status === 'REJECTED' &&
        vbaDataRes.reasonCode === 'MACRO_CONTENT_FORBIDDEN',
      'word/vbaData.xml must be rejected with MACRO_CONTENT_FORBIDDEN'
    );

    // 9b. ActiveX XML part inside package
    const activeXZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      { name: 'word/activeX/activeX1.xml', content: '<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX"/>' },
    ]);
    const activeXRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'activex.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: activeXZip,
    });
    assert(
      activeXRes.status === 'REJECTED' &&
        activeXRes.reasonCode === 'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN',
      'word/activeX/activeX1.xml must be rejected with ACTIVEX_OR_OLE_OBJECT_FORBIDDEN'
    );

    // 9c. Embedded OLE object element <o:OLEObject> inside word/document.xml
    const oleInDocXml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:o="urn:schemas-microsoft-com:office:office">' +
      '<w:body><w:p><w:r><w:object><o:OLEObject Type="Embed" ProgID="Package"/></w:object></w:r></w:p></w:body>' +
      '</w:document>';
    const oleDocZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: oleInDocXml },
      { name: 'word/styles.xml', content: CANONICAL_WORD_STYLES_XML },
    ]);
    const oleDocRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'ole-object.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: oleDocZip,
    });
    assert(
      oleDocRes.status === 'REJECTED' &&
        oleDocRes.reasonCode === 'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN',
      '<o:OLEObject> in word/document.xml must be rejected with ACTIVEX_OR_OLE_OBJECT_FORBIDDEN'
    );

    // 9d. External relationship (TargetMode="External" / remote URL) in word/_rels/document.xml.rels
    const externalRelRels =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://evil.example.org/payload" TargetMode="External"/>' +
      '</Relationships>';
    const externalRelZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      { name: 'word/styles.xml', content: CANONICAL_WORD_STYLES_XML },
      { name: 'word/_rels/document.xml.rels', content: externalRelRels },
    ]);
    const externalRelRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'external-rel.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: externalRelZip,
    });
    assert(
      externalRelRes.status === 'REJECTED' &&
        externalRelRes.reasonCode === 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
      'TargetMode="External" relationship must be rejected with EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN'
    );

    // 9e. External URI Target without TargetMode="External" (e.g. file:// or \\UNC)
    const fileUriRelRels =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdFile" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="file:///etc/passwd"/>' +
      '</Relationships>';
    const fileUriRelZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: CANONICAL_WORD_DOCUMENT_XML },
      { name: 'word/styles.xml', content: CANONICAL_WORD_STYLES_XML },
      { name: 'word/_rels/document.xml.rels', content: fileUriRelRels },
    ]);
    const fileUriRelRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'file-uri-rel.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: fileUriRelZip,
    });
    assert(
      fileUriRelRes.status === 'REJECTED' &&
        fileUriRelRes.reasonCode === 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
      'file:// URI in relationship Target must be rejected with EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN'
    );
  });

  await test('10. XML DTD, ENTITY declarations, custom entity expansion (XXE/Billion Laughs), and malformed XML are rejected', () => {
    // 10a. DOCTYPE / ENTITY in word/document.xml
    const dtdXml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<!DOCTYPE w:document [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:t>&xxe;</w:t></w:p></w:body></w:document>';
    const dtdZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: dtdXml },
      { name: 'word/styles.xml', content: CANONICAL_WORD_STYLES_XML },
    ]);
    const dtdRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'xxe-dtd.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: dtdZip,
    });
    assert(
      dtdRes.status === 'REJECTED' &&
        dtdRes.reasonCode === 'XML_DTD_OR_ENTITY_FORBIDDEN',
      'DOCTYPE/ENTITY declaration must be rejected with XML_DTD_OR_ENTITY_FORBIDDEN'
    );

    // 10b. Undeclared custom entity reference &customEntity; without DOCTYPE
    const customEntityXml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:t>&customEntity;</w:t></w:p></w:body></w:document>';
    const customEntityZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: customEntityXml },
      { name: 'word/styles.xml', content: CANONICAL_WORD_STYLES_XML },
    ]);
    const customEntityRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'custom-entity.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: customEntityZip,
    });
    assert(
      customEntityRes.status === 'REJECTED' &&
        customEntityRes.reasonCode === 'XML_DTD_OR_ENTITY_FORBIDDEN',
      'Custom XML entity reference must be rejected with XML_DTD_OR_ENTITY_FORBIDDEN'
    );

    // 10c. Malformed / unclosed XML tags in word/document.xml
    const malformedXml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:t>Unclosed paragraph</w:body></w:document>';
    const malformedXmlZip = buildSyntheticZipBuffer([
      { name: '[Content_Types].xml', content: CANONICAL_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: CANONICAL_ROOT_RELS_XML },
      { name: 'word/document.xml', content: malformedXml },
      { name: 'word/styles.xml', content: CANONICAL_WORD_STYLES_XML },
    ]);
    const malformedXmlRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'malformed-xml.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: malformedXmlZip,
    });
    assert(
      malformedXmlRes.status === 'REJECTED' &&
        malformedXmlRes.reasonCode === 'MALFORMED_OOXML_XML',
      'Mismatched/unclosed XML tags must be rejected with MALFORMED_OOXML_XML'
    );
  });

  await test('11. Exact SHA-256 is preserved for Uint8Array byte slices with non-zero byteOffset and custom byteLength', () => {
    const innerDocx = makeValidDocxBuffer(8);
    const expectedInnerSha256 = createHash('sha256').update(innerDocx).digest('hex');

    const prefixNoise = Buffer.from('SENTINEL_PREFIX_BYTES_0123456789_ABCDEF', 'utf8');
    const suffixNoise = Buffer.from('SENTINEL_SUFFIX_BYTES_FEDCBA_9876543210', 'utf8');
    const combined = Buffer.concat([prefixNoise, innerDocx, suffixNoise]);

    const backingBuffer = new ArrayBuffer(combined.length);
    new Uint8Array(backingBuffer).set(combined);

    const slicedView = new Uint8Array(
      backingBuffer,
      prefixNoise.length,
      innerDocx.length
    );

    const res = inspectLibraryUploadDeepStructure({
      originalFilename: 'sliced-docx-test.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: slicedView,
    });

    assert(
      res.status === 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
      'Valid DOCX inside Uint8Array slice must succeed'
    );
    if (res.status === 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION') {
      assert(res.sizeBytes === innerDocx.length, 'sizeBytes must match slice byteLength');
      assert(
        res.sha256 === expectedInnerSha256,
        'sha256 must match exact slice bytes without prefix/suffix sentinel bytes'
      );
    }
  });

  await test('12. PDF candidates passing 01A (including PDFs with /URI links) return PDF_REQUIRES_ISOLATED_PARSER (never verified safe), and unsafe PDFs or spoofed caller fields are rejected', () => {
    const cleanPreliminaryPdf = makeMinimalPreliminaryPdfBuffer();
    const expectedPdfSha = createHash('sha256').update(cleanPreliminaryPdf).digest('hex');

    const pdfRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'environmental-agreement-2026.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: cleanPreliminaryPdf,
    });

    assert(
      pdfRes.status === 'PDF_REQUIRES_ISOLATED_PARSER',
      'Preliminary valid PDF must return PDF_REQUIRES_ISOLATED_PARSER'
    );
    if (pdfRes.status === 'PDF_REQUIRES_ISOLATED_PARSER') {
      assert(pdfRes.format === 'PDF', 'format must be PDF');
      assert(pdfRes.sizeBytes === cleanPreliminaryPdf.length, 'sizeBytes matches');
      assert(pdfRes.sha256 === expectedPdfSha, 'sha256 preserved');
      assert(pdfRes.isSanitized === false, 'isSanitized must be false');
      assert(pdfRes.isVerifiedSafe === false, 'isVerifiedSafe must be false');
      assert(pdfRes.isStored === false, 'isStored must be false');
      assert(pdfRes.isPublished === false, 'isPublished must be false');
      assert(pdfRes.isRightsApproved === false, 'isRightsApproved must be false');
      assert(pdfRes.isReadyForPeia === false, 'isReadyForPeia must be false');
    }

    // LIB-FILE-PDF-URI-R1: PDF containing 4 ordinary /URI links returns PDF_REQUIRES_ISOLATED_PARSER with all safety flags false
    const fourUriObjects =
      '3 0 obj\n<< /Type /Annot /Subtype /Link /A << /Type /Action /S /URI /URI (https://doi.org/10.1000/env-2026-01) >> >>\nendobj\n' +
      '4 0 obj\n<< /Type /Annot /Subtype /Link /A << /Type /Action /S /URI /URI (https://doi.org/10.1000/env-2026-02) >> >>\nendobj\n' +
      '5 0 obj\n<< /Type /Annot /Subtype /Link /A << /Type /Action /S /URI /URI (https://doi.org/10.1000/env-2026-03) >> >>\nendobj\n' +
      '6 0 obj\n<< /Type /Annot /Subtype /Link /A << /Type /Action /S /URI /URI (https://doi.org/10.1000/env-2026-04) >> >>\nendobj\n';
    const uriPdfBytes = makeMinimalPreliminaryPdfBuffer(fourUriObjects);
    const expectedUriPdfSha = createHash('sha256').update(uriPdfBytes).digest('hex');

    const uriPdfRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'scholarly-environmental-report-with-links.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: uriPdfBytes,
    });

    assert(
      uriPdfRes.status === 'PDF_REQUIRES_ISOLATED_PARSER',
      'PDF containing ordinary /URI links must return PDF_REQUIRES_ISOLATED_PARSER'
    );
    if (uriPdfRes.status === 'PDF_REQUIRES_ISOLATED_PARSER') {
      assert(uriPdfRes.format === 'PDF', 'format must be PDF');
      assert(uriPdfRes.sizeBytes === uriPdfBytes.length, 'sizeBytes matches');
      assert(uriPdfRes.sha256 === expectedUriPdfSha, 'sha256 preserved');
      assert(uriPdfRes.isSanitized === false, 'isSanitized must be false');
      assert(uriPdfRes.isVerifiedSafe === false, 'isVerifiedSafe must be false');
      assert(uriPdfRes.isStored === false, 'isStored must be false');
      assert(uriPdfRes.isPublished === false, 'isPublished must be false');
      assert(uriPdfRes.isRightsApproved === false, 'isRightsApproved must be false');
      assert(uriPdfRes.isReadyForPeia === false, 'isReadyForPeia must be false');
    }

    // PDF with active content (/JavaScript, /Launch, or /URI + /OpenAction) must still be REJECTED via 01A re-execution
    for (const maliciousSnippet of [
      '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>\n',
      '/AA << /O << /S /Launch /F (cmd.exe) >> >>\n',
      fourUriObjects + '7 0 obj\n<< /Type /Catalog /OpenAction 3 0 R >>\nendobj\n',
      fourUriObjects + '7 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n',
    ]) {
      const activePdf = makeMinimalPreliminaryPdfBuffer(maliciousSnippet);
      const activePdfRes = inspectLibraryUploadDeepStructure({
        originalFilename: 'malicious.pdf',
        claimedMimeType: CANONICAL_PDF_MIME_TYPE,
        bytes: activePdf,
      });
      assert(
        activePdfRes.status === 'REJECTED' &&
          activePdfRes.reasonCode === 'PDF_ACTIVE_CONTENT_DETECTED',
        'Malicious PDF with active content must be rejected with PDF_ACTIVE_CONTENT_DETECTED'
      );
    }

    // Caller attempting to pass pre-verified status or extra fields must be rejected
    const spoofedCallerInput = {
      originalFilename: 'spoofed.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: makeValidDocxBuffer(8),
      status: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
    } as unknown as Parameters<typeof inspectLibraryUploadDeepStructure>[0];

    const spoofedRes = inspectLibraryUploadDeepStructure(spoofedCallerInput);
    assert(
      spoofedRes.status === 'REJECTED' &&
        spoofedRes.reasonCode === 'UNTRUSTED_EXTRA_INPUT_FIELD',
      'Caller-supplied extra fields must be rejected with UNTRUSTED_EXTRA_INPUT_FIELD'
    );
  });

  await test('13. No storage paths, public URLs, download tokens, or side effects on LIB-FILE-01A and baseline files', () => {
    const docxRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'clean-structure.docx',
      claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
      bytes: makeValidDocxBuffer(8),
    });
    const pdfRes = inspectLibraryUploadDeepStructure({
      originalFilename: 'clean-preliminary.pdf',
      claimedMimeType: CANONICAL_PDF_MIME_TYPE,
      bytes: makeMinimalPreliminaryPdfBuffer(),
    });

    for (const res of [docxRes, pdfRes]) {
      const json = JSON.stringify(res);
      assert(!json.includes('gs://'), 'Result must not contain gs:// storage paths');
      assert(!json.includes('https://'), 'Result must not contain https:// URLs');
      assert(!json.includes('http://'), 'Result must not contain http:// URLs');
      assert(!json.includes('downloadToken'), 'Result must not contain downloadToken');
      assert(!('storagePath' in res), 'Result must not have storagePath field');
      assert(!('publicUrl' in res), 'Result must not have publicUrl field');
      assert(!('referenceUrl' in res), 'Result must not have referenceUrl field');
    }

    const expectedHashes: ReadonlyArray<readonly [string, string]> = [
      ['functions/src/library/libraryUploadBinaryAdmission.ts', 'c479007641d799afb145436bf91e661a7c2d5611'],
      ['scripts/runLibraryUploadBinaryAdmissionTests.ts', 'daaaeee64e31dcbd0d9ef126769875829a6f75a5'],
      ['functions/src/shared/libraryContract.ts', 'cfb0849c0418ba7b075f7de49c3debe668adc724'],
      ['functions/src/library/libraryApplicationService.ts', '32b54a8946f3749c18b21ab7f4d0fb4c21b2ebcf'],
      ['functions/src/library/libraryAdminHandlers.ts', 'e8711ca2c4430fa4ea53d1e5c1005890ef33a479'],
      ['functions/src/news/editorialBinaryInspector.ts', '529d035c0d1fa13347168303de54d1ac0a815a0f'],
    ];

    for (const [filePath, expectedHash] of expectedHashes) {
      const actualHash = computeGitBlobSha1(filePath);
      assert(
        actualHash === expectedHash,
        `${filePath} Git blob SHA-1 must remain ${expectedHash} (got ${actualHash})`
      );
    }
  });

  console.log('------------------------------------------------------------');
  console.log(`LIBRARY UPLOAD DEEP STRUCTURE TESTS: ${passedTests}/${totalTests} PASSED`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
