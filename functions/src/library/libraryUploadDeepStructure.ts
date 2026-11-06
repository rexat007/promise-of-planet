import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import {
  assessLibraryUploadBinaryCandidate,
  type AssessLibraryUploadBinaryCandidateInput,
  type LibraryUploadCandidateMetadata,
  type LibraryUploadPreliminaryFormat,
  type LibraryUploadRejectionReasonCode,
} from './libraryUploadBinaryAdmission';

/**
 * LIB-FILE-01B — Bounded DOCX Deep Structure Inspection Boundary
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Pure server-side structural gate for library upload binary candidates.
 * - Always re-runs `assessLibraryUploadBinaryCandidate` on the actual input byte slice;
 *   never trusts any caller-supplied preliminary verdict or precomputed hash.
 * - For DOCX: parses the ZIP End of Central Directory (EOCD), Central Directory headers,
 *   and Local File Headers with strict bounds checks; forbids ZIP64, multi-disk archives,
 *   encryption, streaming data descriptors, unsupported compression methods, overlapping
 *   or unindexed gaps, path traversal, symlinks, duplicate/case-colliding entry names,
 *   and ZIP bombs; verifies CRC-32 and uncompressed sizes via bounded `node:zlib`
 *   decompression; and validates mandatory OOXML parts (`[Content_Types].xml`,
 *   `_rels/.rels`, `word/document.xml`) and all package relationships/XML trees using a
 *   deterministic, bounded XML parser that rejects DTDs, entities, external relationships,
 *   macros (`vbaProject.bin`), ActiveX, OLE, and embedded objects.
 * - For PDF: explicitly returns `PDF_REQUIRES_ISOLATED_PARSER` after preliminary admission.
 *   Never claims PDF deep structural verification from heuristic scanning.
 * - Never writes to Firestore or Cloud Storage, never generates URLs or storage paths,
 *   and always sets `isVerifiedSafe: false`, `isStored: false`, `isPublished: false`,
 *   `isRightsApproved: false`, and `isReadyForPeia: false`.
 */

export const MAX_DOCX_ZIP_ENTRIES = 256 as const;
export const MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES = 8_000_000 as const;
export const MAX_DOCX_XML_PART_UNCOMPRESSED_BYTES = 4_000_000 as const;
export const MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES = 25_000_000 as const;
export const MAX_DOCX_COMPRESSION_RATIO = 100 as const;
export const COMPRESSION_RATIO_EXEMPT_THRESHOLD_BYTES = 4_096 as const;
export const MAX_DOCX_ENTRY_NAME_UTF8_BYTES = 240 as const;
export const MAX_OOXML_ELEMENTS_PER_PART = 50_000 as const;
export const MAX_OOXML_ATTRIBUTES_PER_ELEMENT = 64 as const;
export const MAX_OOXML_NESTING_DEPTH = 64 as const;

export type LibraryUploadDeepStructureStatus =
  | 'REJECTED'
  | 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
  | 'PDF_REQUIRES_ISOLATED_PARSER';

export type LibraryUploadDeepStructureRejectionCode =
  | LibraryUploadRejectionReasonCode
  | 'MALFORMED_ZIP_EOCD'
  | 'ZIP64_ARCHIVE_UNSUPPORTED'
  | 'MULTI_DISK_ARCHIVE_UNSUPPORTED'
  | 'ZIP_ENTRY_COUNT_EXCEEDED'
  | 'MALFORMED_CENTRAL_DIRECTORY'
  | 'MALFORMED_LOCAL_FILE_HEADER'
  | 'CENTRAL_LOCAL_HEADER_MISMATCH'
  | 'ENCRYPTED_ARCHIVE_FORBIDDEN'
  | 'DATA_DESCRIPTOR_STREAMING_UNSUPPORTED'
  | 'UNSUPPORTED_COMPRESSION_METHOD'
  | 'OVERLAPPING_OR_GAP_ENTRY_RANGES'
  | 'DUPLICATE_OR_COLLIDING_ENTRY_NAME'
  | 'UNSAFE_ZIP_ENTRY_PATH'
  | 'SYMLINK_OR_SPECIAL_ENTRY_FORBIDDEN'
  | 'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED'
  | 'CRC_OR_DECOMPRESSION_MISMATCH'
  | 'MISSING_OR_INVALID_OOXML_PARTS'
  | 'MALFORMED_OOXML_XML'
  | 'XML_DTD_OR_ENTITY_FORBIDDEN'
  | 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN'
  | 'MACRO_CONTENT_FORBIDDEN'
  | 'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN';

export type InspectLibraryUploadDeepStructureInput =
  AssessLibraryUploadBinaryCandidateInput;

export interface DocxDeepStructuralSummary {
  readonly entryCount: number;
  readonly totalCompressedBytes: number;
  readonly totalUncompressedBytes: number;
  readonly maxEntryCompressionRatio: number;
  readonly inspectedXmlPartCount: number;
  readonly inspectedRelationshipPartCount: number;
  readonly mainDocumentPartPath: 'word/document.xml';
}

export interface LibraryUploadDeepStructureRejectedResult {
  readonly status: 'REJECTED';
  readonly reasonCode: LibraryUploadDeepStructureRejectionCode;
  readonly reasonDetail: string;
  readonly format?: LibraryUploadPreliminaryFormat;
  readonly sizeBytes: number;
  readonly sha256: string | null;
}

export interface LibraryUploadDocxStructureCheckedResult {
  readonly status: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';
  readonly format: 'DOCX';
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly candidateMetadata: LibraryUploadCandidateMetadata;
  readonly docxStructureSummary: DocxDeepStructuralSummary;
  readonly deepInspectionNotes: readonly string[];
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isStored: false;
  readonly isPublished: false;
  readonly isRightsApproved: false;
  readonly isReadyForPeia: false;
}

export interface LibraryUploadPdfRequiresIsolatedParserResult {
  readonly status: 'PDF_REQUIRES_ISOLATED_PARSER';
  readonly format: 'PDF';
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly candidateMetadata: LibraryUploadCandidateMetadata;
  readonly deepInspectionNotes: readonly string[];
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isStored: false;
  readonly isPublished: false;
  readonly isRightsApproved: false;
  readonly isReadyForPeia: false;
}

export type LibraryUploadDeepStructureResult =
  | LibraryUploadDeepStructureRejectedResult
  | LibraryUploadDocxStructureCheckedResult
  | LibraryUploadPdfRequiresIsolatedParserResult;

const ZIP_LOCAL_FILE_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_RECORD_SIG = 0x06064b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;
const ZIP_EOCD_MAGIC_BYTES = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

const OOXML_CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types';
const OOXML_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const OOXML_OFFICE_DOCUMENT_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const OOXML_WORD_MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const OOXML_WORDPROCESSINGML_MAIN_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CONTROL_OR_BIDI_CHAR_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const FORBIDDEN_PACKAGE_ENTRY_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe',
  'dll',
  'so',
  'dylib',
  'bat',
  'cmd',
  'ps1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'mjs',
  'cjs',
  'wsf',
  'wsh',
  'scr',
  'com',
  'pif',
  'msi',
  'msp',
  'lnk',
  'hta',
  'chm',
  'reg',
  'sh',
  'bash',
  'py',
  'pl',
  'rb',
  'php',
  'jar',
  'war',
  'class',
  'ocx',
  'docm',
  'dotm',
  'xlsm',
  'pptm',
]);

/**
 * Precomputed IEEE 802.3 CRC-32 lookup table.
 */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Buffer | Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    const byte = bytes[i];
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeRejected(
  reasonCode: LibraryUploadDeepStructureRejectionCode,
  reasonDetail: string,
  sizeBytes: number,
  sha256: string | null,
  format?: LibraryUploadPreliminaryFormat
): LibraryUploadDeepStructureRejectedResult {
  const base: LibraryUploadDeepStructureRejectedResult =
    format !== undefined
      ? {
          status: 'REJECTED',
          reasonCode,
          reasonDetail,
          format,
          sizeBytes,
          sha256,
        }
      : {
          status: 'REJECTED',
          reasonCode,
          reasonDetail,
          sizeBytes,
          sha256,
        };
  return Object.freeze(base);
}

interface ParsedZipEntryDescriptor {
  readonly name: string;
  readonly normalizedLowerName: string;
  readonly versionMadeBy: number;
  readonly versionNeeded: number;
  readonly flags: number;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly dataStartOffset: number;
  readonly dataEndOffset: number;
  readonly externalAttributes: number;
}

function hasZip64ExtraField(extraField: Buffer): boolean {
  let offset = 0;
  while (offset + 4 <= extraField.length) {
    const headerId = extraField.readUInt16LE(offset);
    const dataSize = extraField.readUInt16LE(offset + 2);
    if (headerId === 0x0001) {
      return true;
    }
    if (offset + 4 + dataSize > extraField.length) {
      // Malformed extra field; treat conservatively
      return false;
    }
    offset += 4 + dataSize;
  }
  return false;
}

function isMalformedExtraField(extraField: Buffer): boolean {
  let offset = 0;
  while (offset < extraField.length) {
    if (offset + 4 > extraField.length) {
      return true;
    }
    const dataSize = extraField.readUInt16LE(offset + 2);
    if (offset + 4 + dataSize > extraField.length) {
      return true;
    }
    offset += 4 + dataSize;
  }
  return false;
}

function validateZipEntryPath(
  nameBytes: Buffer
):
  | { readonly ok: true; readonly name: string; readonly normalizedLowerName: string }
  | { readonly ok: false; readonly reasonCode: LibraryUploadDeepStructureRejectionCode; readonly reasonDetail: string } {
  if (
    nameBytes.length === 0 ||
    nameBytes.length > MAX_DOCX_ENTRY_NAME_UTF8_BYTES
  ) {
    return {
      ok: false,
      reasonCode: 'UNSAFE_ZIP_ENTRY_PATH',
      reasonDetail: `ZIP entry path length (${nameBytes.length} bytes) is empty or exceeds ${MAX_DOCX_ENTRY_NAME_UTF8_BYTES} bytes.`,
    };
  }

  const decoded = nameBytes.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(nameBytes)) {
    return {
      ok: false,
      reasonCode: 'UNSAFE_ZIP_ENTRY_PATH',
      reasonDetail: 'ZIP entry path contains invalid UTF-8 byte sequences.',
    };
  }

  if (
    CONTROL_OR_BIDI_CHAR_REGEX.test(decoded) ||
    CONTROL_OR_BIDI_CHAR_REGEX.test(decoded.normalize('NFC'))
  ) {
    return {
      ok: false,
      reasonCode: 'UNSAFE_ZIP_ENTRY_PATH',
      reasonDetail:
        'ZIP entry path contains forbidden control, zero-width, or Unicode bidirectional override characters.',
    };
  }

  if (
    decoded.startsWith('/') ||
    decoded.startsWith('\\') ||
    decoded.endsWith('/') ||
    decoded.includes('\\') ||
    decoded.includes(':') ||
    decoded.includes('//')
  ) {
    return {
      ok: false,
      reasonCode: 'UNSAFE_ZIP_ENTRY_PATH',
      reasonDetail: `ZIP entry path "${decoded}" uses forbidden absolute, directory, drive, or backslash syntax.`,
    };
  }

  const segments = decoded.split('/');
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (
      seg.length === 0 ||
      trimmed.length === 0 ||
      seg === '.' ||
      seg === '..' ||
      seg.includes('..')
    ) {
      return {
        ok: false,
        reasonCode: 'UNSAFE_ZIP_ENTRY_PATH',
        reasonDetail: `ZIP entry path "${decoded}" contains path traversal or empty segment.`,
      };
    }
  }

  const normalizedLowerName = decoded.normalize('NFC').toLowerCase();
  return {
    ok: true,
    name: decoded,
    normalizedLowerName,
  };
}

function isSymlinkOrSpecialFileEntry(
  versionMadeBy: number,
  externalAttributes: number
): boolean {
  const hostOs = (versionMadeBy >>> 8) & 0xff;
  // Unix (3) or macOS/Darwin (19) high 16 bits store POSIX st_mode
  if (hostOs === 3 || hostOs === 19) {
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const fileTypeBits = unixMode & 0o170000;
    // Only regular file (0o100000) or 0 (unspecified) is permitted
    if (fileTypeBits !== 0 && fileTypeBits !== 0o100000) {
      return true;
    }
  }
  // MS-DOS/Windows FILE_ATTRIBUTE_REPARSE_POINT (0x0400) or DEVICE (0x0040)
  const dosAttrs = externalAttributes & 0xffff;
  if ((dosAttrs & 0x0400) !== 0 || (dosAttrs & 0x0040) !== 0) {
    return true;
  }
  return false;
}

function classifyForbiddenPackageEntryPath(
  normalizedLowerName: string
): {
  readonly reasonCode: LibraryUploadDeepStructureRejectionCode;
  readonly reasonDetail: string;
} | null {
  if (
    normalizedLowerName.includes('vbaproject') ||
    normalizedLowerName.includes('vbadata') ||
    normalizedLowerName.endsWith('.bas') ||
    normalizedLowerName.endsWith('.frm') ||
    normalizedLowerName.endsWith('.cls')
  ) {
    return {
      reasonCode: 'MACRO_CONTENT_FORBIDDEN',
      reasonDetail: `Package entry "${normalizedLowerName}" is a forbidden VBA macro part.`,
    };
  }

  if (
    normalizedLowerName.includes('activex/') ||
    normalizedLowerName.startsWith('activex') ||
    normalizedLowerName.includes('/activex') ||
    normalizedLowerName.includes('embeddings/') ||
    normalizedLowerName.startsWith('embeddings') ||
    normalizedLowerName.includes('oleobject')
  ) {
    return {
      reasonCode: 'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN',
      reasonDetail: `Package entry "${normalizedLowerName}" is a forbidden ActiveX or embedded OLE object part.`,
    };
  }

  const lastSlash = normalizedLowerName.lastIndexOf('/');
  const baseName =
    lastSlash >= 0 ? normalizedLowerName.slice(lastSlash + 1) : normalizedLowerName;
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx > 0) {
    const ext = baseName.slice(dotIdx + 1);
    if (FORBIDDEN_PACKAGE_ENTRY_EXTENSIONS.has(ext)) {
      if (ext === 'docm' || ext === 'dotm' || ext === 'xlsm' || ext === 'pptm') {
        return {
          reasonCode: 'MACRO_CONTENT_FORBIDDEN',
          reasonDetail: `Package entry "${normalizedLowerName}" uses a macro-enabled Office extension (.${ext}).`,
        };
      }
      return {
        reasonCode: 'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN',
        reasonDetail: `Package entry "${normalizedLowerName}" uses a forbidden executable or control extension (.${ext}).`,
      };
    }
    if (ext === 'bin') {
      return {
        reasonCode: 'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN',
        reasonDetail: `Binary package stream "${normalizedLowerName}" (.bin) is forbidden in library DOCX candidates.`,
      };
    }
  }

  return null;
}

interface ParsedXmlElement {
  readonly rawName: string;
  readonly localName: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly ParsedXmlElement[];
}

function getLocalXmlName(rawName: string): string {
  const colonIdx = rawName.indexOf(':');
  return colonIdx >= 0 ? rawName.slice(colonIdx + 1) : rawName;
}

function decodeStrictXmlEntities(
  rawText: string
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reasonCode: LibraryUploadDeepStructureRejectionCode; readonly reasonDetail: string } {
  let result = '';
  let i = 0;
  while (i < rawText.length) {
    const ampIdx = rawText.indexOf('&', i);
    if (ampIdx === -1) {
      result += rawText.slice(i);
      break;
    }
    result += rawText.slice(i, ampIdx);
    const semiIdx = rawText.indexOf(';', ampIdx + 1);
    if (semiIdx === -1 || semiIdx - ampIdx > 16) {
      return {
        ok: false,
        reasonCode: 'MALFORMED_OOXML_XML',
        reasonDetail: 'Malformed or unterminated XML entity reference.',
      };
    }
    const entityBody = rawText.slice(ampIdx + 1, semiIdx);
    if (entityBody === 'amp') {
      result += '&';
    } else if (entityBody === 'lt') {
      result += '<';
    } else if (entityBody === 'gt') {
      result += '>';
    } else if (entityBody === 'quot') {
      result += '"';
    } else if (entityBody === 'apos') {
      result += "'";
    } else if (entityBody.startsWith('#x') || entityBody.startsWith('#X')) {
      const hex = entityBody.slice(2);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Invalid hexadecimal character reference "&${entityBody};".`,
        };
      }
      const codePoint = Number.parseInt(hex, 16);
      if (
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        (codePoint < 0x20 &&
          codePoint !== 0x09 &&
          codePoint !== 0x0a &&
          codePoint !== 0x0d)
      ) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Forbidden XML control or surrogate character reference "&${entityBody};".`,
        };
      }
      result += String.fromCodePoint(codePoint);
    } else if (entityBody.startsWith('#')) {
      const dec = entityBody.slice(1);
      if (!/^[0-9]{1,7}$/.test(dec)) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Invalid decimal character reference "&${entityBody};".`,
        };
      }
      const codePoint = Number.parseInt(dec, 10);
      if (
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        (codePoint < 0x20 &&
          codePoint !== 0x09 &&
          codePoint !== 0x0a &&
          codePoint !== 0x0d)
      ) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Forbidden XML control or surrogate character reference "&${entityBody};".`,
        };
      }
      result += String.fromCodePoint(codePoint);
    } else {
      return {
        ok: false,
        reasonCode: 'XML_DTD_OR_ENTITY_FORBIDDEN',
        reasonDetail: `Custom or external XML entity reference "&${entityBody};" is forbidden.`,
      };
    }
    i = semiIdx + 1;
  }
  return { ok: true, value: result };
}

const VALID_XML_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/**
 * Deterministic, bounded XML structural parser for OOXML package parts.
 * Forbids DOCTYPE, ENTITY, ELEMENT, ATTLIST, NOTATION, custom entity references,
 * unbalanced tags, duplicate attributes, and excessive nesting or element counts.
 */
function parseBoundedOoxmlDocument(
  xmlBytes: Buffer,
  partPath: string
):
  | { readonly ok: true; readonly root: ParsedXmlElement }
  | {
      readonly ok: false;
      readonly reasonCode: LibraryUploadDeepStructureRejectionCode;
      readonly reasonDetail: string;
    } {
  if (xmlBytes.length === 0 || xmlBytes.length > MAX_DOCX_XML_PART_UNCOMPRESSED_BYTES) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_OOXML_XML',
      reasonDetail: `OOXML part "${partPath}" is empty or exceeds ${MAX_DOCX_XML_PART_UNCOMPRESSED_BYTES} bytes.`,
    };
  }

  // Reject UTF-16 BOMs or NUL bytes (all OOXML XML parts must be valid UTF-8)
  if (
    (xmlBytes.length >= 2 &&
      ((xmlBytes[0] === 0xff && xmlBytes[1] === 0xfe) ||
        (xmlBytes[0] === 0xfe && xmlBytes[1] === 0xff))) ||
    xmlBytes.indexOf(0x00) !== -1
  ) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_OOXML_XML',
      reasonDetail: `OOXML part "${partPath}" contains NUL bytes or unsupported UTF-16 encoding.`,
    };
  }

  // Strip optional UTF-8 BOM (EF BB BF)
  const slice =
    xmlBytes.length >= 3 &&
    xmlBytes[0] === 0xef &&
    xmlBytes[1] === 0xbb &&
    xmlBytes[2] === 0xbf
      ? xmlBytes.subarray(3)
      : xmlBytes;

  const text = slice.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(slice)) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_OOXML_XML',
      reasonDetail: `OOXML part "${partPath}" contains invalid UTF-8 byte sequences.`,
    };
  }

  // Fast pre-check for DTD / ENTITY / XXE / CDATA declarations anywhere in the text
  if (/<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)\b/i.test(text)) {
    return {
      ok: false,
      reasonCode: 'XML_DTD_OR_ENTITY_FORBIDDEN',
      reasonDetail: `OOXML part "${partPath}" contains a forbidden DTD or ENTITY declaration.`,
    };
  }

  if (text.includes('<![CDATA[')) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_OOXML_XML',
      reasonDetail: `OOXML part "${partPath}" contains forbidden CDATA sections.`,
    };
  }

  const len = text.length;
  let pos = 0;
  let totalElements = 0;

  interface MutableStackFrame {
    readonly rawName: string;
    readonly localName: string;
    readonly attributes: Map<string, string>;
    readonly children: ParsedXmlElement[];
  }

  const stack: MutableStackFrame[] = [];
  let rootElement: ParsedXmlElement | null = null;

  const skipWhitespace = (): void => {
    while (pos < len) {
      const ch = text.charCodeAt(pos);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
        pos += 1;
      } else {
        break;
      }
    }
  };

  skipWhitespace();

  // Optional XML declaration <?xml ...?>
  if (text.startsWith('<?xml', pos)) {
    const declEnd = text.indexOf('?>', pos + 5);
    if (declEnd === -1) {
      return {
        ok: false,
        reasonCode: 'MALFORMED_OOXML_XML',
        reasonDetail: `Unterminated XML declaration in "${partPath}".`,
      };
    }
    const declBody = text.slice(pos + 5, declEnd);
    const encodingMatch = /\bencoding\s*=\s*["']([^"']+)["']/i.exec(declBody);
    if (
      encodingMatch &&
      encodingMatch[1].trim().toLowerCase() !== 'utf-8' &&
      encodingMatch[1].trim().toLowerCase() !== 'utf8' &&
      encodingMatch[1].trim().toLowerCase() !== 'us-ascii'
    ) {
      return {
        ok: false,
        reasonCode: 'MALFORMED_OOXML_XML',
        reasonDetail: `Unsupported XML encoding "${encodingMatch[1]}" in "${partPath}".`,
      };
    }
    pos = declEnd + 2;
  }

  while (pos < len) {
    const ltIdx = text.indexOf('<', pos);
    if (ltIdx === -1) {
      const trailing = text.slice(pos);
      if (stack.length > 0) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unclosed XML element <${stack[stack.length - 1].rawName}> in "${partPath}".`,
        };
      }
      if (trailing.trim().length > 0) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unexpected character data outside root element in "${partPath}".`,
        };
      }
      break;
    }

    if (ltIdx > pos) {
      const textSegment = text.slice(pos, ltIdx);
      if (textSegment.includes('>')) {
        // Check if unescaped '>' inside text isn't malformed markup; validate entities in text
      }
      if (stack.length === 0 && textSegment.trim().length > 0) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unexpected text before or after root XML element in "${partPath}".`,
        };
      }
      const entityCheck = decodeStrictXmlEntities(textSegment);
      if (!entityCheck.ok) {
        return entityCheck;
      }
    }

    pos = ltIdx;

    // Comment <!-- ... -->
    if (text.startsWith('<!--', pos)) {
      const commentEnd = text.indexOf('-->', pos + 4);
      if (commentEnd === -1) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unterminated XML comment in "${partPath}".`,
        };
      }
      const commentBody = text.slice(pos + 4, commentEnd);
      if (commentBody.includes('--')) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Invalid "--" sequence inside XML comment in "${partPath}".`,
        };
      }
      pos = commentEnd + 3;
      continue;
    }

    // Any other '<!' construct (DOCTYPE, ENTITY, CDATA, etc.) is forbidden
    if (text.startsWith('<!', pos)) {
      return {
        ok: false,
        reasonCode: 'XML_DTD_OR_ENTITY_FORBIDDEN',
        reasonDetail: `Forbidden XML declaration or DTD construct in "${partPath}".`,
      };
    }

    // Processing instruction <?...?>
    if (text.startsWith('<?', pos)) {
      return {
        ok: false,
        reasonCode: 'MALFORMED_OOXML_XML',
        reasonDetail: `Unexpected XML processing instruction in "${partPath}".`,
      };
    }

    // Closing tag </name>
    if (text.startsWith('</', pos)) {
      const gtIdx = text.indexOf('>', pos + 2);
      if (gtIdx === -1) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unterminated closing XML tag in "${partPath}".`,
        };
      }
      const closeName = text.slice(pos + 2, gtIdx).trim();
      if (stack.length === 0) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unexpected closing tag </${closeName}> with empty stack in "${partPath}".`,
        };
      }
      const top = stack.pop()!;
      if (top.rawName !== closeName) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Mismatched XML closing tag </${closeName}> for opening tag <${top.rawName}> in "${partPath}".`,
        };
      }
      const completed: ParsedXmlElement = Object.freeze({
        rawName: top.rawName,
        localName: top.localName,
        attributes: top.attributes,
        children: Object.freeze(top.children),
      });
      if (stack.length === 0) {
        rootElement = completed;
      } else {
        stack[stack.length - 1].children.push(completed);
      }
      pos = gtIdx + 1;
      continue;
    }

    // Opening tag <name attr="val" ...> or <name .../>
    if (rootElement !== null && stack.length === 0) {
      return {
        ok: false,
        reasonCode: 'MALFORMED_OOXML_XML',
        reasonDetail: `Multiple root elements detected in "${partPath}".`,
      };
    }

    totalElements += 1;
    if (totalElements > MAX_OOXML_ELEMENTS_PER_PART) {
      return {
        ok: false,
        reasonCode: 'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
        reasonDetail: `OOXML part "${partPath}" exceeds maximum XML element count (${MAX_OOXML_ELEMENTS_PER_PART}).`,
      };
    }

    if (stack.length + 1 > MAX_OOXML_NESTING_DEPTH) {
      return {
        ok: false,
        reasonCode: 'MALFORMED_OOXML_XML',
        reasonDetail: `OOXML part "${partPath}" exceeds maximum XML nesting depth (${MAX_OOXML_NESTING_DEPTH}).`,
      };
    }

    pos += 1; // skip '<'
    const nameStart = pos;
    while (pos < len) {
      const ch = text.charCodeAt(pos);
      if (
        ch === 0x20 ||
        ch === 0x09 ||
        ch === 0x0a ||
        ch === 0x0d ||
        ch === 0x2f || // '/'
        ch === 0x3e // '>'
      ) {
        break;
      }
      pos += 1;
    }

    const rawTagName = text.slice(nameStart, pos);
    if (!VALID_XML_NAME_REGEX.test(rawTagName)) {
      return {
        ok: false,
        reasonCode: 'MALFORMED_OOXML_XML',
        reasonDetail: `Invalid XML element name "${rawTagName}" in "${partPath}".`,
      };
    }

    const attributes = new Map<string, string>();
    let selfClosing = false;

    while (pos < len) {
      skipWhitespace();
      if (pos >= len) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unterminated opening tag <${rawTagName}> in "${partPath}".`,
        };
      }

      if (text.startsWith('/>', pos)) {
        selfClosing = true;
        pos += 2;
        break;
      }

      if (text.charCodeAt(pos) === 0x3e) {
        // '>'
        pos += 1;
        break;
      }

      // Parse attribute name
      const attrStart = pos;
      while (pos < len) {
        const ch = text.charCodeAt(pos);
        if (
          ch === 0x3d || // '='
          ch === 0x20 ||
          ch === 0x09 ||
          ch === 0x0a ||
          ch === 0x0d ||
          ch === 0x2f ||
          ch === 0x3e
        ) {
          break;
        }
        pos += 1;
      }

      const attrName = text.slice(attrStart, pos);
      if (!VALID_XML_NAME_REGEX.test(attrName)) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Invalid XML attribute name "${attrName}" on <${rawTagName}> in "${partPath}".`,
        };
      }

      if (attributes.has(attrName)) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Duplicate XML attribute "${attrName}" on <${rawTagName}> in "${partPath}".`,
        };
      }

      if (attributes.size + 1 > MAX_OOXML_ATTRIBUTES_PER_ELEMENT) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Element <${rawTagName}> exceeds maximum attribute count (${MAX_OOXML_ATTRIBUTES_PER_ELEMENT}) in "${partPath}".`,
        };
      }

      skipWhitespace();
      if (pos >= len || text.charCodeAt(pos) !== 0x3d) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Missing "=" after attribute "${attrName}" on <${rawTagName}> in "${partPath}".`,
        };
      }
      pos += 1; // skip '='
      skipWhitespace();

      if (pos >= len) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Missing value for attribute "${attrName}" on <${rawTagName}> in "${partPath}".`,
        };
      }

      const quoteChar = text.charAt(pos);
      if (quoteChar !== '"' && quoteChar !== "'") {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Attribute "${attrName}" on <${rawTagName}> must be quoted in "${partPath}".`,
        };
      }
      pos += 1;
      const valEnd = text.indexOf(quoteChar, pos);
      if (valEnd === -1) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unterminated attribute value for "${attrName}" on <${rawTagName}> in "${partPath}".`,
        };
      }

      const rawAttrVal = text.slice(pos, valEnd);
      if (rawAttrVal.includes('<')) {
        return {
          ok: false,
          reasonCode: 'MALFORMED_OOXML_XML',
          reasonDetail: `Unescaped "<" inside attribute "${attrName}" on <${rawTagName}> in "${partPath}".`,
        };
      }

      const decodedAttr = decodeStrictXmlEntities(rawAttrVal);
      if (!decodedAttr.ok) {
        return decodedAttr;
      }

      attributes.set(attrName, decodedAttr.value);
      pos = valEnd + 1;
    }

    const localName = getLocalXmlName(rawTagName);
    if (selfClosing) {
      const completed: ParsedXmlElement = Object.freeze({
        rawName: rawTagName,
        localName,
        attributes,
        children: Object.freeze([]),
      });
      if (stack.length === 0) {
        rootElement = completed;
      } else {
        stack[stack.length - 1].children.push(completed);
      }
    } else {
      stack.push({
        rawName: rawTagName,
        localName,
        attributes,
        children: [],
      });
    }
  }

  if (stack.length > 0 || rootElement === null) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_OOXML_XML',
      reasonDetail: `Incomplete or empty XML element tree in "${partPath}".`,
    };
  }

  return {
    ok: true,
    root: rootElement,
  };
}

function resolvePackageRelationshipTarget(
  relsFilePath: string,
  rawTarget: string
):
  | { readonly ok: true; readonly resolvedPath: string }
  | {
      readonly ok: false;
      readonly reasonCode: LibraryUploadDeepStructureRejectionCode;
      readonly reasonDetail: string;
    } {
  const trimmed = rawTarget.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      reasonCode: 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
      reasonDetail: `Empty relationship Target in "${relsFilePath}".`,
    };
  }

  // Reject URI schemes (http:, https:, file:, ftp:, mailto:, javascript:, mhtml:, etc.) or UNC paths
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('\\') ||
    trimmed.includes('\\')
  ) {
    return {
      ok: false,
      reasonCode: 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
      reasonDetail: `External or unsafe URI/UNC relationship Target "${trimmed}" in "${relsFilePath}".`,
    };
  }

  // Strip intra-document fragment if present (e.g. #section)
  const hashIdx = trimmed.indexOf('#');
  const pathPart = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  if (pathPart.length === 0) {
    // Pure internal bookmark fragment
    return { ok: true, resolvedPath: '' };
  }

  // Determine base directory of the source part that owns this .rels file
  // e.g. "_rels/.rels" -> base "", "word/_rels/document.xml.rels" -> base "word"
  let baseSegments: string[] = [];
  if (!pathPart.startsWith('/')) {
    const relsSegments = relsFilePath.split('/');
    const relsDirIdx = relsSegments.lastIndexOf('_rels');
    if (relsDirIdx > 0) {
      baseSegments = relsSegments.slice(0, relsDirIdx);
    }
  }

  const rawSegments = (pathPart.startsWith('/') ? pathPart.slice(1) : pathPart).split('/');
  const resolvedSegments = [...baseSegments];

  for (const seg of rawSegments) {
    if (seg.length === 0 || seg === '.') {
      return {
        ok: false,
        reasonCode: 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
        reasonDetail: `Ambiguous segment in relationship Target "${rawTarget}" in "${relsFilePath}".`,
      };
    }
    if (seg === '..') {
      if (resolvedSegments.length === 0) {
        return {
          ok: false,
          reasonCode: 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
          reasonDetail: `Relationship Target "${rawTarget}" traverses outside package root in "${relsFilePath}".`,
        };
      }
      resolvedSegments.pop();
    } else {
      resolvedSegments.push(seg);
    }
  }

  if (resolvedSegments.length === 0) {
    return {
      ok: false,
      reasonCode: 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
      reasonDetail: `Relationship Target "${rawTarget}" resolves to empty package root in "${relsFilePath}".`,
    };
  }

  return {
    ok: true,
    resolvedPath: resolvedSegments.join('/'),
  };
}

function inspectXmlTreeForForbiddenConstructs(
  root: ParsedXmlElement,
  partPath: string
): {
  readonly reasonCode: LibraryUploadDeepStructureRejectionCode;
  readonly reasonDetail: string;
} | null {
  const stack: ParsedXmlElement[] = [root];
  while (stack.length > 0) {
    const elem = stack.pop()!;
    const lowerLocal = elem.localName.toLowerCase();

    if (
      lowerLocal === 'oleobject' ||
      lowerLocal === 'control' ||
      lowerLocal === 'activex' ||
      lowerLocal === 'ocx' ||
      lowerLocal === 'movie' ||
      lowerLocal === 'objectembed' ||
      lowerLocal === 'objectlink' ||
      lowerLocal === 'subdoc' ||
      lowerLocal === 'altchunk'
    ) {
      return {
        reasonCode: 'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN',
        reasonDetail: `OOXML part "${partPath}" contains forbidden embedded/active element <${elem.rawName}>.`,
      };
    }

    if (lowerLocal === 'script' || lowerLocal === 'iframe') {
      return {
        reasonCode: 'MALFORMED_OOXML_XML',
        reasonDetail: `OOXML part "${partPath}" contains forbidden script/HTML element <${elem.rawName}>.`,
      };
    }

    for (const [attrName, attrVal] of elem.attributes.entries()) {
      const lowerAttr = attrName.toLowerCase();
      const lowerVal = attrVal.toLowerCase();
      if (lowerVal.includes('vbaproject') || lowerVal.includes('macroenabled')) {
        return {
          reasonCode: 'MACRO_CONTENT_FORBIDDEN',
          reasonDetail: `OOXML part "${partPath}" attribute "${attrName}" references forbidden macro content.`,
        };
      }
      if (
        lowerAttr.includes('script') ||
        lowerVal.startsWith('javascript:') ||
        lowerVal.startsWith('vbscript:')
      ) {
        return {
          reasonCode: 'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
          reasonDetail: `OOXML part "${partPath}" attribute "${attrName}" contains forbidden script URI.`,
        };
      }
    }

    for (let i = elem.children.length - 1; i >= 0; i -= 1) {
      stack.push(elem.children[i]);
    }
  }
  return null;
}

function inspectDeepDocxStructure(
  buffer: Buffer,
  sha256: string,
  candidateMetadata: LibraryUploadCandidateMetadata
): LibraryUploadDocxStructureCheckedResult | LibraryUploadDeepStructureRejectedResult {
  const sizeBytes = buffer.byteLength;

  // 1. Locate and validate End of Central Directory (EOCD)
  const tailWindowStart = Math.max(0, sizeBytes - 65557);
  const tailView = buffer.subarray(tailWindowStart);
  const eocdRelIdx = tailView.lastIndexOf(ZIP_EOCD_MAGIC_BYTES);
  if (eocdRelIdx === -1) {
    return makeRejected(
      'MALFORMED_ZIP_EOCD',
      'DOCX archive is missing End of Central Directory (PK\\x05\\x06) signature.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  const eocdOffset = tailWindowStart + eocdRelIdx;
  if (sizeBytes - eocdOffset < 22) {
    return makeRejected(
      'MALFORMED_ZIP_EOCD',
      'DOCX End of Central Directory record is truncated (< 22 bytes).',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  const eocdCommentLen = buffer.readUInt16LE(eocdOffset + 20);
  if (eocdOffset + 22 + eocdCommentLen !== sizeBytes) {
    return makeRejected(
      'MALFORMED_ZIP_EOCD',
      'DOCX End of Central Directory comment length does not match actual end of buffer (trailing data or ambiguous EOCD).',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  // Check for ZIP64 EOCD Locator (20 bytes before EOCD) or ZIP64 EOCD Record
  if (eocdOffset >= 20) {
    const possibleLocatorSig = buffer.readUInt32LE(eocdOffset - 20);
    if (possibleLocatorSig === ZIP64_EOCD_LOCATOR_SIG) {
      return makeRejected(
        'ZIP64_ARCHIVE_UNSUPPORTED',
        'ZIP64 End of Central Directory Locator detected; ZIP64 archives are unsupported for library DOCX uploads.',
        sizeBytes,
        sha256,
        'DOCX'
      );
    }
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const cdStartDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    diskNumber === 0xffff ||
    cdStartDisk === 0xffff ||
    diskEntries === 0xffff ||
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    return makeRejected(
      'ZIP64_ARCHIVE_UNSUPPORTED',
      'EOCD record contains 0xFFFF/0xFFFFFFFF ZIP64 sentinel values; ZIP64 archives are unsupported.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  if (diskNumber !== 0 || cdStartDisk !== 0 || diskEntries !== totalEntries) {
    return makeRejected(
      'MULTI_DISK_ARCHIVE_UNSUPPORTED',
      'Multi-disk or split ZIP archives are forbidden.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  if (totalEntries === 0) {
    return makeRejected(
      'MALFORMED_ZIP_EOCD',
      'DOCX archive declares 0 entries in End of Central Directory.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  if (totalEntries > MAX_DOCX_ZIP_ENTRIES) {
    return makeRejected(
      'ZIP_ENTRY_COUNT_EXCEEDED',
      `DOCX archive declares ${totalEntries} entries, exceeding maximum allowed (${MAX_DOCX_ZIP_ENTRIES}).`,
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  if (cdSize === 0 || cdOffset >= eocdOffset || cdOffset + cdSize !== eocdOffset) {
    return makeRejected(
      'MALFORMED_CENTRAL_DIRECTORY',
      'Central Directory offset and size do not align cleanly with End of Central Directory.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  // 2. Parse Central Directory entries and cross-check Local File Headers
  const entries: ParsedZipEntryDescriptor[] = [];
  const seenNormalizedLowerNames = new Set<string>();
  let cdCursor = cdOffset;
  let declaredTotalCompressedBytes = 0;
  let declaredTotalUncompressedBytes = 0;
  let maxEntryCompressionRatio = 1;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cdCursor + 46 > eocdOffset) {
      return makeRejected(
        'MALFORMED_CENTRAL_DIRECTORY',
        `Central Directory entry #${i} is truncated before fixed 46-byte header.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const sig = buffer.readUInt32LE(cdCursor);
    if (sig === ZIP64_EOCD_RECORD_SIG || sig === ZIP64_EOCD_LOCATOR_SIG) {
      return makeRejected(
        'ZIP64_ARCHIVE_UNSUPPORTED',
        'ZIP64 structure encountered inside Central Directory.',
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (sig !== ZIP_CENTRAL_DIR_HEADER_SIG) {
      return makeRejected(
        'MALFORMED_CENTRAL_DIRECTORY',
        `Central Directory entry #${i} has invalid signature 0x${sig.toString(16)}.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const versionMadeBy = buffer.readUInt16LE(cdCursor + 4);
    const versionNeeded = buffer.readUInt16LE(cdCursor + 6);
    const flags = buffer.readUInt16LE(cdCursor + 8);
    const compressionMethod = buffer.readUInt16LE(cdCursor + 10);
    const crc32 = buffer.readUInt32LE(cdCursor + 16);
    const compressedSize = buffer.readUInt32LE(cdCursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cdCursor + 24);
    const nameLen = buffer.readUInt16LE(cdCursor + 28);
    const extraLen = buffer.readUInt16LE(cdCursor + 30);
    const commentLen = buffer.readUInt16LE(cdCursor + 32);
    const entryDiskStart = buffer.readUInt16LE(cdCursor + 34);
    const externalAttributes = buffer.readUInt32LE(cdCursor + 38);
    const localHeaderOffset = buffer.readUInt32LE(cdCursor + 42);

    const cdRecordEnd = cdCursor + 46 + nameLen + extraLen + commentLen;
    if (cdRecordEnd > eocdOffset) {
      return makeRejected(
        'MALFORMED_CENTRAL_DIRECTORY',
        `Central Directory entry #${i} variable fields extend beyond Central Directory bounds.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const cdNameBytes = buffer.subarray(cdCursor + 46, cdCursor + 46 + nameLen);
    const cdExtraBytes = buffer.subarray(
      cdCursor + 46 + nameLen,
      cdCursor + 46 + nameLen + extraLen
    );

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      entryDiskStart === 0xffff ||
      hasZip64ExtraField(cdExtraBytes)
    ) {
      return makeRejected(
        'ZIP64_ARCHIVE_UNSUPPORTED',
        `Entry #${i} uses ZIP64 sizes, offsets, or extra field.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (isMalformedExtraField(cdExtraBytes)) {
      return makeRejected(
        'MALFORMED_CENTRAL_DIRECTORY',
        `Central Directory entry #${i} has a malformed extra field.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (entryDiskStart !== 0) {
      return makeRejected(
        'MULTI_DISK_ARCHIVE_UNSUPPORTED',
        `Entry #${i} references non-zero disk number ${entryDiskStart}.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    // Encryption bits: bit 0 (encrypted), bit 6 (strong encryption), bit 13 (central dir encrypted)
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || (flags & 0x2000) !== 0) {
      return makeRejected(
        'ENCRYPTED_ARCHIVE_FORBIDDEN',
        `ZIP entry #${i} has encryption flags set (0x${flags.toString(16)}).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    // Streaming data descriptor (bit 3) or compressed patched data (bit 5)
    if ((flags & 0x0008) !== 0 || (flags & 0x0020) !== 0) {
      return makeRejected(
        'DATA_DESCRIPTOR_STREAMING_UNSUPPORTED',
        `ZIP entry #${i} uses streaming data descriptors or patched data flags (0x${flags.toString(16)}).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (compressionMethod !== 0 && compressionMethod !== 8) {
      return makeRejected(
        'UNSUPPORTED_COMPRESSION_METHOD',
        `ZIP entry #${i} uses unsupported compression method ${compressionMethod}; only Stored (0) and Deflate (8) are allowed.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (compressionMethod === 0 && compressedSize !== uncompressedSize) {
      return makeRejected(
        'CENTRAL_LOCAL_HEADER_MISMATCH',
        `Stored (method 0) ZIP entry #${i} has unequal compressedSize (${compressedSize}) and uncompressedSize (${uncompressedSize}).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (isSymlinkOrSpecialFileEntry(versionMadeBy, externalAttributes)) {
      return makeRejected(
        'SYMLINK_OR_SPECIAL_ENTRY_FORBIDDEN',
        `ZIP entry #${i} has symbolic link, device, or reparse-point external attributes.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const pathValidation = validateZipEntryPath(cdNameBytes);
    if (!pathValidation.ok) {
      return makeRejected(
        pathValidation.reasonCode,
        pathValidation.reasonDetail,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const { name, normalizedLowerName } = pathValidation;
    if (seenNormalizedLowerNames.has(normalizedLowerName)) {
      return makeRejected(
        'DUPLICATE_OR_COLLIDING_ENTRY_NAME',
        `Duplicate or case/NFC-colliding ZIP entry path "${name}".`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }
    seenNormalizedLowerNames.add(normalizedLowerName);

    const forbiddenEntry = classifyForbiddenPackageEntryPath(normalizedLowerName);
    if (forbiddenEntry !== null) {
      return makeRejected(
        forbiddenEntry.reasonCode,
        forbiddenEntry.reasonDetail,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    // Check ZIP-bomb single-entry and cumulative budgets
    if (uncompressedSize > MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES) {
      return makeRejected(
        'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
        `ZIP entry "${name}" uncompressed size (${uncompressedSize} bytes) exceeds per-entry limit (${MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES} bytes).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (uncompressedSize > 0 && compressedSize === 0) {
      return makeRejected(
        'MALFORMED_CENTRAL_DIRECTORY',
        `ZIP entry "${name}" declares non-zero uncompressedSize (${uncompressedSize}) with 0 compressedSize.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const entryRatio =
      compressedSize > 0 ? uncompressedSize / compressedSize : 1;
    if (entryRatio > maxEntryCompressionRatio) {
      maxEntryCompressionRatio = entryRatio;
    }

    if (
      uncompressedSize > COMPRESSION_RATIO_EXEMPT_THRESHOLD_BYTES &&
      entryRatio > MAX_DOCX_COMPRESSION_RATIO
    ) {
      return makeRejected(
        'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
        `ZIP entry "${name}" compression ratio (${entryRatio.toFixed(1)}:1) exceeds maximum allowed (${MAX_DOCX_COMPRESSION_RATIO}:1).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    declaredTotalCompressedBytes += compressedSize;
    declaredTotalUncompressedBytes += uncompressedSize;

    if (declaredTotalUncompressedBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES) {
      return makeRejected(
        'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
        `Cumulative uncompressed size (${declaredTotalUncompressedBytes} bytes) exceeds archive limit (${MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES} bytes).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    // Validate corresponding Local File Header
    if (localHeaderOffset + 30 > cdOffset) {
      return makeRejected(
        'MALFORMED_LOCAL_FILE_HEADER',
        `Local File Header for "${name}" at offset ${localHeaderOffset} is out of bounds.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const lfhSig = buffer.readUInt32LE(localHeaderOffset);
    if (lfhSig !== ZIP_LOCAL_FILE_HEADER_SIG) {
      return makeRejected(
        'MALFORMED_LOCAL_FILE_HEADER',
        `Local File Header for "${name}" at offset ${localHeaderOffset} has invalid signature 0x${lfhSig.toString(16)}.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const lfhVersionNeeded = buffer.readUInt16LE(localHeaderOffset + 4);
    const lfhFlags = buffer.readUInt16LE(localHeaderOffset + 6);
    const lfhMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    const lfhCrc32 = buffer.readUInt32LE(localHeaderOffset + 14);
    const lfhCompressedSize = buffer.readUInt32LE(localHeaderOffset + 18);
    const lfhUncompressedSize = buffer.readUInt32LE(localHeaderOffset + 22);
    const lfhNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const lfhExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);

    const dataStartOffset = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const dataEndOffset = dataStartOffset + compressedSize;

    if (dataStartOffset > cdOffset || dataEndOffset > cdOffset) {
      return makeRejected(
        'MALFORMED_LOCAL_FILE_HEADER',
        `Local File Header or data payload for "${name}" extends beyond Central Directory offset.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const lfhNameBytes = buffer.subarray(
      localHeaderOffset + 30,
      localHeaderOffset + 30 + lfhNameLen
    );
    const lfhExtraBytes = buffer.subarray(
      localHeaderOffset + 30 + lfhNameLen,
      dataStartOffset
    );

    if (hasZip64ExtraField(lfhExtraBytes)) {
      return makeRejected(
        'ZIP64_ARCHIVE_UNSUPPORTED',
        `Local File Header for "${name}" contains a ZIP64 extra field.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (isMalformedExtraField(lfhExtraBytes)) {
      return makeRejected(
        'MALFORMED_LOCAL_FILE_HEADER',
        `Local File Header for "${name}" contains a malformed extra field.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (
      lfhVersionNeeded !== versionNeeded ||
      lfhFlags !== flags ||
      lfhMethod !== compressionMethod ||
      lfhCrc32 !== crc32 ||
      lfhCompressedSize !== compressedSize ||
      lfhUncompressedSize !== uncompressedSize ||
      !lfhNameBytes.equals(cdNameBytes)
    ) {
      return makeRejected(
        'CENTRAL_LOCAL_HEADER_MISMATCH',
        `Local File Header and Central Directory Header disagree on metadata, sizes, CRC, or filename for "${name}".`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    entries.push({
      name,
      normalizedLowerName,
      versionMadeBy,
      versionNeeded,
      flags,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataStartOffset,
      dataEndOffset,
      externalAttributes,
    });

    cdCursor = cdRecordEnd;
  }

  if (cdCursor !== eocdOffset) {
    return makeRejected(
      'MALFORMED_CENTRAL_DIRECTORY',
      'Central Directory records do not exactly fill the declared Central Directory size.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  // 3. Verify non-overlapping, contiguous entry spans from offset 0 to cdOffset
  const sortedByOffset = [...entries].sort(
    (a, b) => a.localHeaderOffset - b.localHeaderOffset
  );

  if (sortedByOffset[0].localHeaderOffset !== 0) {
    return makeRejected(
      'OVERLAPPING_OR_GAP_ENTRY_RANGES',
      `First ZIP entry does not start at offset 0 (starts at ${sortedByOffset[0].localHeaderOffset}).`,
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  for (let i = 0; i < sortedByOffset.length; i += 1) {
    const current = sortedByOffset[i];
    if (i > 0) {
      const prev = sortedByOffset[i - 1];
      if (current.localHeaderOffset < prev.dataEndOffset) {
        return makeRejected(
          'OVERLAPPING_OR_GAP_ENTRY_RANGES',
          `ZIP entries "${prev.name}" and "${current.name}" have overlapping byte ranges.`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }
      if (current.localHeaderOffset !== prev.dataEndOffset) {
        return makeRejected(
          'OVERLAPPING_OR_GAP_ENTRY_RANGES',
          `Unindexed byte gap detected between ZIP entries "${prev.name}" and "${current.name}".`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }
    }
  }

  const lastEntry = sortedByOffset[sortedByOffset.length - 1];
  if (lastEntry.dataEndOffset !== cdOffset) {
    return makeRejected(
      'OVERLAPPING_OR_GAP_ENTRY_RANGES',
      `Unindexed byte gap detected between last ZIP entry "${lastEntry.name}" and Central Directory.`,
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  // 4. Bounded decompression & CRC-32 verification for all entries
  const decompressedEntries = new Map<string, Buffer>();
  const entryLookupByLower = new Map<string, ParsedZipEntryDescriptor>();
  let actualTotalUncompressedBytes = 0;

  for (const entry of entries) {
    entryLookupByLower.set(entry.normalizedLowerName, entry);
    const compressedSlice = buffer.subarray(
      entry.dataStartOffset,
      entry.dataEndOffset
    );

    let uncompressedBuf: Buffer;
    if (entry.compressionMethod === 0) {
      uncompressedBuf = compressedSlice;
    } else {
      const remainingArchiveBudget =
        MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES - actualTotalUncompressedBytes;
      const allowedMaxOutput = Math.min(
        MAX_DOCX_SINGLE_ENTRY_UNCOMPRESSED_BYTES,
        remainingArchiveBudget
      );
      try {
        uncompressedBuf = inflateRawSync(compressedSlice, {
          maxOutputLength: allowedMaxOutput,
        });
      } catch (err: unknown) {
        const errCode =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code)
            : '';
        if (errCode === 'ERR_BUFFER_TOO_LARGE') {
          return makeRejected(
            'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
            `Decompression of entry "${entry.name}" exceeded bounded memory limit (${allowedMaxOutput} bytes).`,
            sizeBytes,
            sha256,
            'DOCX'
          );
        }
        return makeRejected(
          'CRC_OR_DECOMPRESSION_MISMATCH',
          `Deflate decompression failed for entry "${entry.name}".`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }
    }

    if (uncompressedBuf.byteLength !== entry.uncompressedSize) {
      return makeRejected(
        'CRC_OR_DECOMPRESSION_MISMATCH',
        `Decompressed byte length (${uncompressedBuf.byteLength}) for "${entry.name}" does not match declared uncompressedSize (${entry.uncompressedSize}).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    actualTotalUncompressedBytes += uncompressedBuf.byteLength;
    if (actualTotalUncompressedBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES) {
      return makeRejected(
        'ZIP_BOMB_OR_EXPANSION_LIMIT_EXCEEDED',
        `Actual decompressed byte total (${actualTotalUncompressedBytes}) exceeds limit (${MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES}).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const actualCrc32 = computeCrc32(uncompressedBuf);
    if (actualCrc32 !== entry.crc32) {
      return makeRejected(
        'CRC_OR_DECOMPRESSION_MISMATCH',
        `CRC-32 mismatch for entry "${entry.name}" (expected 0x${entry.crc32.toString(16)}, got 0x${actualCrc32.toString(16)}).`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    decompressedEntries.set(entry.normalizedLowerName, uncompressedBuf);
  }

  // 5. Verify mandatory OOXML package parts exist with canonical casing
  const contentTypesEntry = entryLookupByLower.get('[content_types].xml');
  const rootRelsEntry = entryLookupByLower.get('_rels/.rels');
  const mainDocEntry = entryLookupByLower.get('word/document.xml');

  if (
    !contentTypesEntry ||
    contentTypesEntry.name !== '[Content_Types].xml' ||
    !rootRelsEntry ||
    rootRelsEntry.name !== '_rels/.rels' ||
    !mainDocEntry ||
    mainDocEntry.name !== 'word/document.xml'
  ) {
    return makeRejected(
      'MISSING_OR_INVALID_OOXML_PARTS',
      'DOCX package is missing one or more mandatory canonical OOXML parts ([Content_Types].xml, _rels/.rels, word/document.xml).',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  // 6. Parse and validate all XML and .rels parts in the package
  const parsedXmlParts = new Map<string, ParsedXmlElement>();
  let inspectedXmlPartCount = 0;
  let inspectedRelationshipPartCount = 0;

  for (const entry of entries) {
    const isXmlOrRels =
      entry.normalizedLowerName.endsWith('.xml') ||
      entry.normalizedLowerName.endsWith('.rels');
    if (!isXmlOrRels) {
      continue;
    }

    const partBytes = decompressedEntries.get(entry.normalizedLowerName)!;
    const parsed = parseBoundedOoxmlDocument(partBytes, entry.name);
    if (!parsed.ok) {
      return makeRejected(
        parsed.reasonCode,
        parsed.reasonDetail,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const forbiddenConstruct = inspectXmlTreeForForbiddenConstructs(
      parsed.root,
      entry.name
    );
    if (forbiddenConstruct !== null) {
      return makeRejected(
        forbiddenConstruct.reasonCode,
        forbiddenConstruct.reasonDetail,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    parsedXmlParts.set(entry.normalizedLowerName, parsed.root);
    if (entry.normalizedLowerName.endsWith('.rels')) {
      inspectedRelationshipPartCount += 1;
    } else {
      inspectedXmlPartCount += 1;
    }
  }

  // 7. Validate [Content_Types].xml structure and declarations
  const contentTypesRoot = parsedXmlParts.get('[content_types].xml')!;
  if (
    contentTypesRoot.localName !== 'Types' ||
    contentTypesRoot.attributes.get('xmlns') !== OOXML_CONTENT_TYPES_NAMESPACE
  ) {
    return makeRejected(
      'MISSING_OR_INVALID_OOXML_PARTS',
      '[Content_Types].xml root element must be <Types> in the canonical OpenXML content-types namespace.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  let hasWordMainContentTypeOverride = false;
  for (const child of contentTypesRoot.children) {
    if (child.localName !== 'Default' && child.localName !== 'Override') {
      return makeRejected(
        'MISSING_OR_INVALID_OOXML_PARTS',
        `Unexpected child element <${child.rawName}> inside [Content_Types].xml.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const contentType = (child.attributes.get('ContentType') ?? '').trim();
    const lowerContentType = contentType.toLowerCase();
    if (contentType.length === 0) {
      return makeRejected(
        'MISSING_OR_INVALID_OOXML_PARTS',
        `Element <${child.rawName}> in [Content_Types].xml is missing a ContentType attribute.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (
      lowerContentType.includes('macroenabled') ||
      lowerContentType.includes('vbaproject') ||
      lowerContentType.includes('vbadata')
    ) {
      return makeRejected(
        'MACRO_CONTENT_FORBIDDEN',
        `[Content_Types].xml declares forbidden macro content type "${contentType}".`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (
      lowerContentType.includes('activex') ||
      lowerContentType.includes('oleobject') ||
      lowerContentType === 'application/vnd.openxmlformats-officedocument.oleobject'
    ) {
      return makeRejected(
        'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN',
        `[Content_Types].xml declares forbidden ActiveX/OLE content type "${contentType}".`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    if (child.localName === 'Override') {
      const partName = (child.attributes.get('PartName') ?? '').trim();
      if (!partName.startsWith('/')) {
        return makeRejected(
          'MISSING_OR_INVALID_OOXML_PARTS',
          `[Content_Types].xml <Override> PartName "${partName}" must start with "/".`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }
      if (partName.toLowerCase() === '/word/document.xml') {
        if (contentType !== OOXML_WORD_MAIN_CONTENT_TYPE) {
          return makeRejected(
            'MISSING_OR_INVALID_OOXML_PARTS',
            `[Content_Types].xml declares non-canonical ContentType "${contentType}" for /word/document.xml.`,
            sizeBytes,
            sha256,
            'DOCX'
          );
        }
        hasWordMainContentTypeOverride = true;
      }
    }
  }

  if (!hasWordMainContentTypeOverride) {
    return makeRejected(
      'MISSING_OR_INVALID_OOXML_PARTS',
      '[Content_Types].xml is missing the mandatory Override for PartName="/word/document.xml" with WordprocessingML main content type.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  // 8. Validate all .rels parts (including _rels/.rels) for safe internal targets and main document binding
  let foundMainOfficeDocumentRel = false;
  for (const entry of entries) {
    if (!entry.normalizedLowerName.endsWith('.rels')) {
      continue;
    }

    const relsRoot = parsedXmlParts.get(entry.normalizedLowerName)!;
    if (
      relsRoot.localName !== 'Relationships' ||
      relsRoot.attributes.get('xmlns') !== OOXML_RELATIONSHIPS_NAMESPACE
    ) {
      return makeRejected(
        'MISSING_OR_INVALID_OOXML_PARTS',
        `Relationship part "${entry.name}" root must be <Relationships> in the canonical OpenXML relationships namespace.`,
        sizeBytes,
        sha256,
        'DOCX'
      );
    }

    const seenRelIds = new Set<string>();
    for (const relElem of relsRoot.children) {
      if (relElem.localName !== 'Relationship') {
        return makeRejected(
          'MISSING_OR_INVALID_OOXML_PARTS',
          `Unexpected element <${relElem.rawName}> in relationship part "${entry.name}".`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }

      const relId = (relElem.attributes.get('Id') ?? '').trim();
      const relType = (relElem.attributes.get('Type') ?? '').trim();
      const relTarget = (relElem.attributes.get('Target') ?? '').trim();
      const relTargetMode = (relElem.attributes.get('TargetMode') ?? '').trim();

      if (relId.length === 0 || relType.length === 0 || relTarget.length === 0) {
        return makeRejected(
          'MISSING_OR_INVALID_OOXML_PARTS',
          `Relationship element in "${entry.name}" is missing required Id, Type, or Target attribute.`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }

      if (seenRelIds.has(relId)) {
        return makeRejected(
          'MISSING_OR_INVALID_OOXML_PARTS',
          `Duplicate Relationship Id "${relId}" in "${entry.name}".`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }
      seenRelIds.add(relId);

      if (relTargetMode.length > 0 && relTargetMode.toLowerCase() !== 'internal') {
        return makeRejected(
          'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
          `External relationship (TargetMode="${relTargetMode}", Target="${relTarget}") in "${entry.name}" is forbidden.`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }

      const lowerRelType = relType.toLowerCase();
      if (
        lowerRelType.includes('vbaproject') ||
        lowerRelType.includes('vbadata') ||
        lowerRelType.includes('macro')
      ) {
        return makeRejected(
          'MACRO_CONTENT_FORBIDDEN',
          `Forbidden macro relationship Type "${relType}" in "${entry.name}".`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }

      if (
        lowerRelType.includes('oleobject') ||
        lowerRelType.includes('activex') ||
        lowerRelType.endsWith('/control') ||
        lowerRelType.endsWith('/package')
      ) {
        return makeRejected(
          'ACTIVEX_OR_OLE_OBJECT_FORBIDDEN',
          `Forbidden ActiveX/OLE/package relationship Type "${relType}" in "${entry.name}".`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }

      if (
        lowerRelType.endsWith('/attachedtemplate') ||
        lowerRelType.endsWith('/subdocument') ||
        lowerRelType.endsWith('/frame')
      ) {
        return makeRejected(
          'EXTERNAL_OR_UNSAFE_RELATIONSHIP_FORBIDDEN',
          `Forbidden template/subDocument/frame relationship Type "${relType}" in "${entry.name}".`,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }

      const resolvedTarget = resolvePackageRelationshipTarget(entry.name, relTarget);
      if (!resolvedTarget.ok) {
        return makeRejected(
          resolvedTarget.reasonCode,
          resolvedTarget.reasonDetail,
          sizeBytes,
          sha256,
          'DOCX'
        );
      }

      if (resolvedTarget.resolvedPath.length > 0) {
        const targetLower = resolvedTarget.resolvedPath.normalize('NFC').toLowerCase();
        if (!entryLookupByLower.has(targetLower)) {
          return makeRejected(
            'MISSING_OR_INVALID_OOXML_PARTS',
            `Relationship "${relId}" in "${entry.name}" points to missing package entry "${resolvedTarget.resolvedPath}".`,
            sizeBytes,
            sha256,
            'DOCX'
          );
        }

        if (
          entry.normalizedLowerName === '_rels/.rels' &&
          relType === OOXML_OFFICE_DOCUMENT_REL_TYPE
        ) {
          if (resolvedTarget.resolvedPath !== 'word/document.xml') {
            return makeRejected(
              'MISSING_OR_INVALID_OOXML_PARTS',
              `Root officeDocument relationship in _rels/.rels must resolve to "word/document.xml" (got "${resolvedTarget.resolvedPath}").`,
              sizeBytes,
              sha256,
              'DOCX'
            );
          }
          foundMainOfficeDocumentRel = true;
        }
      }
    }
  }

  if (!foundMainOfficeDocumentRel) {
    return makeRejected(
      'MISSING_OR_INVALID_OOXML_PARTS',
      'Root _rels/.rels is missing the mandatory officeDocument relationship targeting word/document.xml.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  // 9. Validate word/document.xml root and body structure
  const mainDocRoot = parsedXmlParts.get('word/document.xml')!;
  const hasWordMainNs = Array.from(mainDocRoot.attributes.entries()).some(
    ([attrKey, attrVal]) =>
      (attrKey === 'xmlns' || attrKey.startsWith('xmlns:')) &&
      attrVal === OOXML_WORDPROCESSINGML_MAIN_NAMESPACE
  );
  const hasBodyChild = mainDocRoot.children.some(
    (child) => child.localName === 'body'
  );

  if (
    mainDocRoot.localName !== 'document' ||
    !hasWordMainNs ||
    !hasBodyChild
  ) {
    return makeRejected(
      'MISSING_OR_INVALID_OOXML_PARTS',
      'word/document.xml must have a <w:document> root in the WordprocessingML main namespace containing a <w:body> element.',
      sizeBytes,
      sha256,
      'DOCX'
    );
  }

  const docxStructureSummary: DocxDeepStructuralSummary = Object.freeze({
    entryCount: entries.length,
    totalCompressedBytes: declaredTotalCompressedBytes,
    totalUncompressedBytes: actualTotalUncompressedBytes,
    maxEntryCompressionRatio: Number(maxEntryCompressionRatio.toFixed(4)),
    inspectedXmlPartCount,
    inspectedRelationshipPartCount,
    mainDocumentPartPath: 'word/document.xml' as const,
  });

  return Object.freeze({
    status: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION' as const,
    format: 'DOCX' as const,
    sizeBytes,
    sha256,
    candidateMetadata,
    docxStructureSummary,
    deepInspectionNotes: Object.freeze([
      'ZIP Central Directory, Local File Headers, contiguous byte spans, and CRC-32 checksums verified.',
      'OOXML mandatory parts ([Content_Types].xml, _rels/.rels, word/document.xml) and internal relationships verified without DTDs, external relationships, macros, ActiveX, or OLE objects.',
      'Candidate remains DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION: not sanitized, not verified safe, not stored, not rights-approved, not published, and not ready for PEIA.',
    ]),
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isStored: false as const,
    isPublished: false as const,
    isRightsApproved: false as const,
    isReadyForPeia: false as const,
  });
}

/**
 * Pure server-side deep structural inspection boundary for Library PDF and DOCX candidates.
 * Always re-runs LIB-FILE-01A preliminary binary admission on the actual input bytes.
 */
export function inspectLibraryUploadDeepStructure(
  candidateInput: InspectLibraryUploadDeepStructureInput
): LibraryUploadDeepStructureResult {
  const preliminaryResult = assessLibraryUploadBinaryCandidate(candidateInput);

  if (preliminaryResult.status === 'REJECTED') {
    return makeRejected(
      preliminaryResult.reasonCode,
      preliminaryResult.reasonDetail,
      preliminaryResult.sizeBytes,
      preliminaryResult.sha256
    );
  }

  if (preliminaryResult.format === 'PDF') {
    return Object.freeze({
      status: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
      format: 'PDF' as const,
      sizeBytes: preliminaryResult.sizeBytes,
      sha256: preliminaryResult.sha256,
      candidateMetadata: preliminaryResult.candidateMetadata,
      deepInspectionNotes: Object.freeze([
        'Preliminary PDF admission passed, but deep PDF object-graph, cross-reference, and compressed stream parsing require an isolated PDF parser.',
        'PDF_REQUIRES_ISOLATED_PARSER does NOT represent completed deep inspection, sanitization, storage authorization, rights clearance, publication, or PEIA readiness.',
      ]),
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isStored: false as const,
      isPublished: false as const,
      isRightsApproved: false as const,
      isReadyForPeia: false as const,
    });
  }

  const exactByteSlice = Buffer.from(
    candidateInput.bytes.buffer,
    candidateInput.bytes.byteOffset,
    candidateInput.bytes.byteLength
  );

  return inspectDeepDocxStructure(
    exactByteSlice,
    preliminaryResult.sha256,
    preliminaryResult.candidateMetadata
  );
}
