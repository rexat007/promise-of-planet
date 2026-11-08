import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

/**
 * LIB-FILE-01A — Standalone Preliminary Binary Admission Boundary for Library Uploads
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Evaluates server-received binary candidates (`Buffer | Uint8Array`) for initial
 *   format eligibility (`.pdf` and `.docx` only), conservative byte-size bounds
 *   (`<= 15,000,000` bytes), filename safety (supporting Arabic and English while
 *   blocking path traversal, control/bidi characters, and deceptive extensions),
 *   claimed MIME consistency, preliminary magic/container signatures, and actual-byte
 *   SHA-256 calculation.
 * - Returns ONLY `REJECTED` (with a canonical `reasonCode`) or `PENDING_DEEP_INSPECTION`.
 * - `PENDING_DEEP_INSPECTION` NEVER implies that the candidate is safe, sanitized,
 *   verified, stored in Cloud Storage, rights-cleared, published, or ready for PEIA.
 * - A ZIP local header (`PK\x03\x04`) for a `.docx` candidate NEVER establishes that
 *   the OpenXML container is valid or free of zip bombs, macros, or external relationships.
 * - Never constructs public URLs, intake URLs, or Cloud Storage object paths.
 */

export const MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES = 15_000_000 as const;
export const MAX_LIBRARY_UPLOAD_FILENAME_CHARS = 200 as const;
export const MAX_LIBRARY_UPLOAD_FILENAME_UTF8_BYTES = 255 as const;
export const MIN_PRELIMINARY_PDF_BYTES = 32 as const;
export const MIN_PRELIMINARY_DOCX_ZIP_BYTES = 52 as const;

export const CANONICAL_PDF_MIME_TYPE = 'application/pdf' as const;
export const CANONICAL_DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
export const GENERIC_BINARY_MIME_TYPE = 'application/octet-stream' as const;

export type LibraryUploadPreliminaryFormat = 'PDF' | 'DOCX';

export type LibraryUploadCanonicalMimeType =
  | typeof CANONICAL_PDF_MIME_TYPE
  | typeof CANONICAL_DOCX_MIME_TYPE;

export type LibraryUploadAdmissionStatus =
  | 'PENDING_DEEP_INSPECTION'
  | 'REJECTED';

export type LibraryUploadRejectionReasonCode =
  | 'INVALID_CANDIDATE_INPUT'
  | 'UNTRUSTED_EXTRA_INPUT_FIELD'
  | 'INVALID_BINARY_BYTES'
  | 'EMPTY_BINARY'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'INVALID_FILENAME'
  | 'FILENAME_TOO_LONG'
  | 'FILENAME_PATH_TRAVERSAL_OR_SEPARATOR'
  | 'FILENAME_CONTROL_OR_BIDI_CHARACTER'
  | 'FILENAME_DECEPTIVE_OR_DOUBLE_EXTENSION'
  | 'LEGACY_DOC_FORMAT_UNSUPPORTED'
  | 'MACRO_ENABLED_FORMAT_FORBIDDEN'
  | 'UNSUPPORTED_FILE_EXTENSION'
  | 'INVALID_CLAIMED_MIME_TYPE'
  | 'CLAIMED_MIME_MISMATCH'
  | 'UNSUPPORTED_MAGIC_BYTES'
  | 'SIGNATURE_EXTENSION_MISMATCH'
  | 'INVALID_PDF_PRELIMINARY_STRUCTURE'
  | 'PDF_ACTIVE_CONTENT_DETECTED'
  | 'INVALID_ZIP_PRELIMINARY_STRUCTURE'
  | 'POLYGLOT_OR_SCRIPT_SIGNATURE_DETECTED';

export interface AssessLibraryUploadBinaryCandidateInput {
  readonly originalFilename: string;
  readonly claimedMimeType?: string | null;
  readonly bytes: Buffer | Uint8Array;
}

export interface LibraryUploadCandidateMetadata {
  readonly originalFilename: string;
  readonly sanitizedFilename: string;
  readonly canonicalExtension: 'pdf' | 'docx';
  readonly claimedMimeType: string | null;
  readonly claimedMimeDisposition: 'EXACT_CANONICAL_MATCH' | 'GENERIC_OR_OMITTED';
  readonly expectedCanonicalMimeType: LibraryUploadCanonicalMimeType;
}

export interface LibraryUploadPendingDeepInspectionResult {
  readonly status: 'PENDING_DEEP_INSPECTION';
  readonly format: LibraryUploadPreliminaryFormat;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly candidateMetadata: LibraryUploadCandidateMetadata;
  readonly preliminarySignatureKind: 'PDF_HEADER_AND_EOF' | 'ZIP_LOCAL_HEADER_ONLY';
  readonly deepInspectionRequired: true;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isStored: false;
  readonly isPublished: false;
  readonly isRightsApproved: false;
  readonly isReadyForPeia: false;
  readonly admissionNotes: readonly string[];
}

export interface LibraryUploadRejectedResult {
  readonly status: 'REJECTED';
  readonly reasonCode: LibraryUploadRejectionReasonCode;
  readonly reasonDetail: string;
  readonly sizeBytes: number;
  readonly sha256: string | null;
}

export type LibraryUploadBinaryAdmissionResult =
  | LibraryUploadPendingDeepInspectionResult
  | LibraryUploadRejectedResult;

const ALLOWED_CANDIDATE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'originalFilename',
  'claimedMimeType',
  'bytes',
]);

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const ZIP_LOCAL_FILE_HEADER_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_ARCHIVE_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP_SPANNED_ARCHIVE_MAGIC = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
const OLE2_COMPOUND_MAGIC = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

/**
 * Control characters (C0, DEL, C1), zero-width formatting characters, and Unicode
 * bidirectional override/embedding/isolate controls (including RLO U+202E).
 */
const CONTROL_OR_BIDI_CHAR_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

/**
 * Forbidden shell, filesystem, or markup characters in filenames.
 */
const FORBIDDEN_FILENAME_METACHAR_REGEX = /[<>:"|?*;&$!`'"%~@#^{}+=]/;

/**
 * Allowed characters in a sanitized filename stem:
 * - Unicode letters (\p{L}) and combining marks (\p{M}), including Arabic and Latin
 * - Unicode decimal digits (\p{Nd}), including ASCII and Arabic-Indic digits
 * - Spaces, hyphens (-), en/em dashes (–, —), underscores (_), parentheses (), brackets [],
 *   Arabic comma (،), and single internal dots (.) when not forming a deceptive extension.
 */
const ALLOWED_STEM_CHARS_REGEX =
  /^[\p{L}\p{M}\p{Nd} _\-–—()[\]،.]+$/u;

const WINDOWS_RESERVED_DEVICE_STEMS: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const LEGACY_WORD_EXTENSIONS: ReadonlySet<string> = new Set(['doc', 'dot']);

const MACRO_OR_TEMPLATE_EXTENSIONS: ReadonlySet<string> = new Set([
  'docm',
  'dotm',
  'dotx',
  'xlsm',
  'xltm',
  'pptm',
  'potm',
  'ppam',
  'sldm',
]);

const DECEPTIVE_SECONDARY_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'docx',
  'doc',
  'docm',
  'dot',
  'dotx',
  'dotm',
  'xls',
  'xlsx',
  'xlsm',
  'ppt',
  'pptx',
  'pptm',
  'rtf',
  'odt',
  'txt',
  'csv',
  'xml',
  'json',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'iso',
  'cab',
  'jar',
  'war',
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
  'JSE',
  'mjs',
  'cjs',
  'ts',
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
  'asp',
  'aspx',
  'jsp',
  'html',
  'htm',
  'xhtml',
  'svg',
  'swf',
]);

const LEGACY_WORD_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/msword',
  'application/vnd.ms-word',
  'application/x-msword',
]);

const MACRO_OR_TEMPLATE_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
]);

const FORBIDDEN_PDF_ACTIVE_CONSTRUCT_PATTERNS: readonly {
  readonly regex: RegExp;
  readonly label: string;
}[] = Object.freeze([
  { regex: /\/JavaScript(?![A-Za-z0-9_])/i, label: '/JavaScript' },
  { regex: /\/JS(?![A-Za-z0-9_])/i, label: '/JS' },
  { regex: /\/Launch(?![A-Za-z0-9_])/i, label: '/Launch' },
  { regex: /\/EmbeddedFiles(?![A-Za-z0-9_])/i, label: '/EmbeddedFiles' },
  { regex: /\/EmbeddedFile(?![A-Za-z0-9_])/i, label: '/EmbeddedFile' },
  { regex: /\/RichMedia(?![A-Za-z0-9_])/i, label: '/RichMedia' },
  { regex: /\/SubmitForm(?![A-Za-z0-9_])/i, label: '/SubmitForm' },
  { regex: /\/ImportData(?![A-Za-z0-9_])/i, label: '/ImportData' },
  { regex: /\/GoToR(?![A-Za-z0-9_])/i, label: '/GoToR' },
  { regex: /\/GoToE(?![A-Za-z0-9_])/i, label: '/GoToE' },
  { regex: /\/OpenAction(?![A-Za-z0-9_])/i, label: '/OpenAction' },
  { regex: /\/AA(?![A-Za-z0-9_])/i, label: '/AA' },
  { regex: /\/XFA(?![A-Za-z0-9_])/i, label: '/XFA' },
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function makeRejectedResult(
  reasonCode: LibraryUploadRejectionReasonCode,
  reasonDetail: string,
  sizeBytes = 0,
  sha256: string | null = null
): LibraryUploadRejectedResult {
  return Object.freeze({
    status: 'REJECTED' as const,
    reasonCode,
    reasonDetail,
    sizeBytes,
    sha256,
  });
}

function extractExactByteSlice(rawBytes: unknown): Buffer | null {
  if (Buffer.isBuffer(rawBytes)) {
    return Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  }
  if (rawBytes instanceof Uint8Array) {
    return Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  }
  return null;
}

export function computeActualBytesSha256(bytes: Buffer | Uint8Array): string {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return createHash('sha256').update(view).digest('hex').toLowerCase();
}

interface ValidatedFilenameResult {
  readonly ok: true;
  readonly originalFilename: string;
  readonly sanitizedFilename: string;
  readonly canonicalExtension: 'pdf' | 'docx';
  readonly preliminaryFormat: LibraryUploadPreliminaryFormat;
  readonly expectedCanonicalMimeType: LibraryUploadCanonicalMimeType;
}

interface ValidatedFilenameFailure {
  readonly ok: false;
  readonly reasonCode: LibraryUploadRejectionReasonCode;
  readonly reasonDetail: string;
}

function validateAndSanitizeCandidateFilename(
  rawFilename: unknown
): ValidatedFilenameResult | ValidatedFilenameFailure {
  if (typeof rawFilename !== 'string' || rawFilename.length === 0) {
    return {
      ok: false,
      reasonCode: 'INVALID_FILENAME',
      reasonDetail: 'originalFilename must be a non-empty string.',
    };
  }

  // Reject unpaired UTF-16 surrogates
  if (Buffer.from(rawFilename, 'utf8').toString('utf8') !== rawFilename) {
    return {
      ok: false,
      reasonCode: 'INVALID_FILENAME',
      reasonDetail: 'originalFilename contains ill-formed UTF-16 surrogate code units.',
    };
  }

  // Check control and bidirectional override characters before any normalization
  if (CONTROL_OR_BIDI_CHAR_REGEX.test(rawFilename)) {
    return {
      ok: false,
      reasonCode: 'FILENAME_CONTROL_OR_BIDI_CHARACTER',
      reasonDetail:
        'originalFilename contains forbidden control, zero-width, or Unicode bidirectional override/isolate characters.',
    };
  }

  // Reject leading or trailing whitespace or trailing dots
  if (rawFilename !== rawFilename.trim() || rawFilename.endsWith('.')) {
    return {
      ok: false,
      reasonCode: 'INVALID_FILENAME',
      reasonDetail:
        'originalFilename must not start or end with whitespace or end with a trailing dot.',
    };
  }

  const normalized = rawFilename.normalize('NFC');

  if (CONTROL_OR_BIDI_CHAR_REGEX.test(normalized)) {
    return {
      ok: false,
      reasonCode: 'FILENAME_CONTROL_OR_BIDI_CHARACTER',
      reasonDetail:
        'Normalized originalFilename contains forbidden control or bidirectional formatting characters.',
    };
  }

  // Check path separators and drive/stream colons before length or extension checks
  if (
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes(':')
  ) {
    return {
      ok: false,
      reasonCode: 'FILENAME_PATH_TRAVERSAL_OR_SEPARATOR',
      reasonDetail:
        'originalFilename must not contain path separators (/, \\) or drive/stream colons (:).',
    };
  }

  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('.') ||
    normalized.includes('..')
  ) {
    return {
      ok: false,
      reasonCode: 'FILENAME_PATH_TRAVERSAL_OR_SEPARATOR',
      reasonDetail:
        'originalFilename must not start with a dot or contain relative path traversal sequences (..).',
    };
  }

  if (
    normalized.length > MAX_LIBRARY_UPLOAD_FILENAME_CHARS ||
    Buffer.byteLength(normalized, 'utf8') > MAX_LIBRARY_UPLOAD_FILENAME_UTF8_BYTES
  ) {
    return {
      ok: false,
      reasonCode: 'FILENAME_TOO_LONG',
      reasonDetail: `originalFilename exceeds maximum length (${MAX_LIBRARY_UPLOAD_FILENAME_CHARS} characters / ${MAX_LIBRARY_UPLOAD_FILENAME_UTF8_BYTES} UTF-8 bytes).`,
    };
  }

  if (FORBIDDEN_FILENAME_METACHAR_REGEX.test(normalized)) {
    return {
      ok: false,
      reasonCode: 'INVALID_FILENAME',
      reasonDetail:
        'originalFilename contains forbidden shell, filesystem, or markup metacharacters.',
    };
  }

  const lastDotIdx = normalized.lastIndexOf('.');
  if (lastDotIdx <= 0 || lastDotIdx === normalized.length - 1) {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_FILE_EXTENSION',
      reasonDetail: 'originalFilename must include a non-empty stem and a valid extension (.pdf or .docx).',
    };
  }

  const rawStem = normalized.slice(0, lastDotIdx);
  const rawExtension = normalized.slice(lastDotIdx + 1).toLowerCase();

  if (rawStem.trim().length === 0 || rawStem !== rawStem.trim() || rawStem.endsWith('.')) {
    return {
      ok: false,
      reasonCode: 'INVALID_FILENAME',
      reasonDetail: 'Filename stem before extension must be non-empty and must not end with space or dot.',
    };
  }

  if (WINDOWS_RESERVED_DEVICE_STEMS.has(rawStem.toLowerCase())) {
    return {
      ok: false,
      reasonCode: 'INVALID_FILENAME',
      reasonDetail: `Filename stem "${rawStem}" is a reserved operating-system device name.`,
    };
  }

  // Check secondary dot segments in the stem for deceptive or double extensions
  const stemSegments = rawStem.split('.');
  if (WINDOWS_RESERVED_DEVICE_STEMS.has(stemSegments[0].trim().toLowerCase())) {
    return {
      ok: false,
      reasonCode: 'INVALID_FILENAME',
      reasonDetail: `Filename leading segment "${stemSegments[0]}" is a reserved operating-system device name.`,
    };
  }

  for (let i = 1; i < stemSegments.length; i += 1) {
    const seg = stemSegments[i].trim().toLowerCase();
    if (seg.length === 0 || DECEPTIVE_SECONDARY_EXTENSIONS.has(seg)) {
      return {
        ok: false,
        reasonCode: 'FILENAME_DECEPTIVE_OR_DOUBLE_EXTENSION',
        reasonDetail: `Filename "${normalized}" contains a deceptive or ambiguous secondary extension ".${seg}".`,
      };
    }
  }

  if (!ALLOWED_STEM_CHARS_REGEX.test(rawStem)) {
    return {
      ok: false,
      reasonCode: 'INVALID_FILENAME',
      reasonDetail:
        'Filename stem contains unsupported characters; only Arabic/Latin letters, digits, spaces, hyphens, underscores, parentheses, and brackets are allowed.',
    };
  }

  if (LEGACY_WORD_EXTENSIONS.has(rawExtension)) {
    return {
      ok: false,
      reasonCode: 'LEGACY_DOC_FORMAT_UNSUPPORTED',
      reasonDetail: `Legacy Word format (.${rawExtension}) is not supported; only .pdf and .docx are admitted for preliminary inspection.`,
    };
  }

  if (MACRO_OR_TEMPLATE_EXTENSIONS.has(rawExtension)) {
    return {
      ok: false,
      reasonCode: 'MACRO_ENABLED_FORMAT_FORBIDDEN',
      reasonDetail: `Macro-enabled or template Office format (.${rawExtension}) is strictly forbidden.`,
    };
  }

  if (rawExtension !== 'pdf' && rawExtension !== 'docx') {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_FILE_EXTENSION',
      reasonDetail: `File extension ".${rawExtension}" is not supported; only .pdf and .docx are permitted.`,
    };
  }

  const collapsedStem = rawStem.replace(/\s+/g, ' ').trim();
  const sanitizedFilename = `${collapsedStem}.${rawExtension}`;

  if (rawExtension === 'pdf') {
    return {
      ok: true,
      originalFilename: normalized,
      sanitizedFilename,
      canonicalExtension: 'pdf',
      preliminaryFormat: 'PDF',
      expectedCanonicalMimeType: CANONICAL_PDF_MIME_TYPE,
    };
  }

  return {
    ok: true,
    originalFilename: normalized,
    sanitizedFilename,
    canonicalExtension: 'docx',
    preliminaryFormat: 'DOCX',
    expectedCanonicalMimeType: CANONICAL_DOCX_MIME_TYPE,
  };
}

interface ValidatedMimeResult {
  readonly ok: true;
  readonly claimedMimeType: string | null;
  readonly claimedMimeDisposition: 'EXACT_CANONICAL_MATCH' | 'GENERIC_OR_OMITTED';
}

interface ValidatedMimeFailure {
  readonly ok: false;
  readonly reasonCode: LibraryUploadRejectionReasonCode;
  readonly reasonDetail: string;
}

function validateClaimedMimeType(
  rawClaimedMimeType: unknown,
  preliminaryFormat: LibraryUploadPreliminaryFormat,
  expectedCanonicalMimeType: LibraryUploadCanonicalMimeType
): ValidatedMimeResult | ValidatedMimeFailure {
  if (rawClaimedMimeType === undefined || rawClaimedMimeType === null) {
    return {
      ok: true,
      claimedMimeType: null,
      claimedMimeDisposition: 'GENERIC_OR_OMITTED',
    };
  }

  if (typeof rawClaimedMimeType !== 'string') {
    return {
      ok: false,
      reasonCode: 'INVALID_CLAIMED_MIME_TYPE',
      reasonDetail: 'claimedMimeType must be a string when provided.',
    };
  }

  if (CONTROL_OR_BIDI_CHAR_REGEX.test(rawClaimedMimeType)) {
    return {
      ok: false,
      reasonCode: 'INVALID_CLAIMED_MIME_TYPE',
      reasonDetail: 'claimedMimeType contains forbidden control characters.',
    };
  }

  const trimmedMime = rawClaimedMimeType.trim().toLowerCase();
  if (trimmedMime.length === 0) {
    return {
      ok: true,
      claimedMimeType: null,
      claimedMimeDisposition: 'GENERIC_OR_OMITTED',
    };
  }

  if (!/^[a-z0-9!#$&-^_.+]+\/[a-z0-9!#$&-^_.+]+$/.test(trimmedMime)) {
    return {
      ok: false,
      reasonCode: 'INVALID_CLAIMED_MIME_TYPE',
      reasonDetail: `claimedMimeType "${rawClaimedMimeType}" is not a syntactically valid media type.`,
    };
  }

  if (LEGACY_WORD_MIME_TYPES.has(trimmedMime)) {
    return {
      ok: false,
      reasonCode: 'LEGACY_DOC_FORMAT_UNSUPPORTED',
      reasonDetail: `Claimed MIME type "${trimmedMime}" corresponds to unsupported legacy Word (.doc) format.`,
    };
  }

  if (MACRO_OR_TEMPLATE_MIME_TYPES.has(trimmedMime)) {
    return {
      ok: false,
      reasonCode: 'MACRO_ENABLED_FORMAT_FORBIDDEN',
      reasonDetail: `Claimed MIME type "${trimmedMime}" corresponds to a forbidden macro-enabled or template Office format.`,
    };
  }

  if (trimmedMime === GENERIC_BINARY_MIME_TYPE) {
    return {
      ok: true,
      claimedMimeType: GENERIC_BINARY_MIME_TYPE,
      claimedMimeDisposition: 'GENERIC_OR_OMITTED',
    };
  }

  if (trimmedMime === expectedCanonicalMimeType) {
    return {
      ok: true,
      claimedMimeType: expectedCanonicalMimeType,
      claimedMimeDisposition: 'EXACT_CANONICAL_MATCH',
    };
  }

  return {
    ok: false,
    reasonCode: 'CLAIMED_MIME_MISMATCH',
    reasonDetail: `Claimed MIME type "${trimmedMime}" conflicts with expected ${preliminaryFormat} MIME type "${expectedCanonicalMimeType}".`,
  };
}

function normalizePdfNameHexEscapes(latin1Text: string): string {
  return latin1Text.replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return String.fromCharCode(code);
  });
}

function containsHtmlOrScriptPolyglot(buffer: Buffer): string | null {
  const scanLen = Math.min(buffer.length, 65536);
  const lowerBuf = Buffer.allocUnsafe(scanLen);
  for (let i = 0; i < scanLen; i += 1) {
    const b = buffer[i];
    lowerBuf[i] = b >= 0x41 && b <= 0x5a ? b + 0x20 : b;
  }

  const patterns: readonly Buffer[] = [
    Buffer.from('<script', 'ascii'),
    Buffer.from('<html', 'ascii'),
    Buffer.from('<!doctype html', 'ascii'),
  ];

  for (const pat of patterns) {
    if (lowerBuf.indexOf(pat) !== -1) {
      return `Detected polyglot HTML/script marker (${pat.toString('ascii')}) in binary candidate.`;
    }
  }
  return null;
}

interface PreliminaryBinaryCheckSuccess {
  readonly ok: true;
  readonly preliminarySignatureKind: 'PDF_HEADER_AND_EOF' | 'ZIP_LOCAL_HEADER_ONLY';
  readonly notes: readonly string[];
}

interface PreliminaryBinaryCheckFailure {
  readonly ok: false;
  readonly reasonCode: LibraryUploadRejectionReasonCode;
  readonly reasonDetail: string;
}

function inspectPreliminaryPdfCandidate(
  buffer: Buffer
): PreliminaryBinaryCheckSuccess | PreliminaryBinaryCheckFailure {
  if (
    buffer.length >= OLE2_COMPOUND_MAGIC.length &&
    buffer.subarray(0, OLE2_COMPOUND_MAGIC.length).equals(OLE2_COMPOUND_MAGIC)
  ) {
    return {
      ok: false,
      reasonCode: 'LEGACY_DOC_FORMAT_UNSUPPORTED',
      reasonDetail: 'Binary starts with legacy OLE2 Compound File magic bytes instead of PDF.',
    };
  }

  if (
    buffer.length >= 4 &&
    (buffer.subarray(0, 4).equals(ZIP_LOCAL_FILE_HEADER_MAGIC) ||
      buffer.subarray(0, 4).equals(ZIP_EMPTY_ARCHIVE_MAGIC) ||
      buffer.subarray(0, 4).equals(ZIP_SPANNED_ARCHIVE_MAGIC))
  ) {
    return {
      ok: false,
      reasonCode: 'SIGNATURE_EXTENSION_MISMATCH',
      reasonDetail: 'Candidate has .pdf extension but starts with ZIP/DOCX container magic bytes.',
    };
  }

  if (
    buffer.length < PDF_MAGIC.length ||
    !buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
  ) {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_MAGIC_BYTES',
      reasonDetail: 'PDF candidate must start with "%PDF-" magic bytes at offset 0.',
    };
  }

  if (buffer.length < MIN_PRELIMINARY_PDF_BYTES) {
    return {
      ok: false,
      reasonCode: 'INVALID_PDF_PRELIMINARY_STRUCTURE',
      reasonDetail: 'PDF candidate is shorter than minimum valid PDF header and trailer structure.',
    };
  }

  const headerAscii = buffer.toString('ascii', 0, Math.min(16, buffer.length));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(headerAscii)) {
    return {
      ok: false,
      reasonCode: 'INVALID_PDF_PRELIMINARY_STRUCTURE',
      reasonDetail: 'PDF header at offset 0 must declare a valid %PDF-1.x or %PDF-2.0 version line.',
    };
  }

  const polyglotError = containsHtmlOrScriptPolyglot(buffer);
  if (polyglotError !== null) {
    return {
      ok: false,
      reasonCode: 'POLYGLOT_OR_SCRIPT_SIGNATURE_DETECTED',
      reasonDetail: polyglotError,
    };
  }

  const latin1Content = buffer.toString('latin1');
  const normalizedContent = normalizePdfNameHexEscapes(latin1Content);

  for (const { regex, label } of FORBIDDEN_PDF_ACTIVE_CONSTRUCT_PATTERNS) {
    if (regex.test(normalizedContent)) {
      return {
        ok: false,
        reasonCode: 'PDF_ACTIVE_CONTENT_DETECTED',
        reasonDetail: `Preliminary PDF screening rejected active or external construct (${label}).`,
      };
    }
  }

  const hasXref =
    /\bxref\b/.test(normalizedContent) ||
    /\/Type\s*\/XRef(?![A-Za-z0-9_])/.test(normalizedContent);
  const hasStartXref = /\bstartxref\b/.test(normalizedContent);

  if (!hasXref || !hasStartXref) {
    return {
      ok: false,
      reasonCode: 'INVALID_PDF_PRELIMINARY_STRUCTURE',
      reasonDetail: 'PDF candidate is missing required xref table/stream or startxref marker.',
    };
  }

  const lastEofIdx = latin1Content.lastIndexOf('%%EOF');
  if (lastEofIdx === -1) {
    return {
      ok: false,
      reasonCode: 'INVALID_PDF_PRELIMINARY_STRUCTURE',
      reasonDetail: 'PDF candidate is missing required %%EOF trailer marker.',
    };
  }

  const trailingAfterEof = latin1Content.slice(lastEofIdx + 5);
  if (trailingAfterEof.length > 8 || !/^[\r\n \t]*$/.test(trailingAfterEof)) {
    return {
      ok: false,
      reasonCode: 'INVALID_PDF_PRELIMINARY_STRUCTURE',
      reasonDetail: 'Detected non-whitespace or excessive trailing data after PDF %%EOF marker.',
    };
  }

  return {
    ok: true,
    preliminarySignatureKind: 'PDF_HEADER_AND_EOF',
    notes: Object.freeze([
      'Preliminary %PDF- header, xref/startxref markers, and %%EOF trailer verified.',
      'Candidate remains PENDING_DEEP_INSPECTION: not sanitized, not stored, not rights-approved, and not ready for PEIA.',
    ]),
  };
}

function inspectPreliminaryDocxCandidate(
  buffer: Buffer
): PreliminaryBinaryCheckSuccess | PreliminaryBinaryCheckFailure {
  if (
    buffer.length >= OLE2_COMPOUND_MAGIC.length &&
    buffer.subarray(0, OLE2_COMPOUND_MAGIC.length).equals(OLE2_COMPOUND_MAGIC)
  ) {
    return {
      ok: false,
      reasonCode: 'LEGACY_DOC_FORMAT_UNSUPPORTED',
      reasonDetail:
        'Candidate has .docx extension but starts with legacy OLE2 Compound File (.doc) magic bytes.',
    };
  }

  if (
    buffer.length >= PDF_MAGIC.length &&
    buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
  ) {
    return {
      ok: false,
      reasonCode: 'SIGNATURE_EXTENSION_MISMATCH',
      reasonDetail: 'Candidate has .docx extension but starts with %PDF- magic bytes.',
    };
  }

  if (
    buffer.length >= 4 &&
    (buffer.subarray(0, 4).equals(ZIP_EMPTY_ARCHIVE_MAGIC) ||
      buffer.subarray(0, 4).equals(ZIP_SPANNED_ARCHIVE_MAGIC))
  ) {
    return {
      ok: false,
      reasonCode: 'INVALID_ZIP_PRELIMINARY_STRUCTURE',
      reasonDetail:
        'Empty or spanned ZIP archive signature cannot be a valid DOCX candidate.',
    };
  }

  if (
    buffer.length < ZIP_LOCAL_FILE_HEADER_MAGIC.length ||
    !buffer.subarray(0, 4).equals(ZIP_LOCAL_FILE_HEADER_MAGIC)
  ) {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_MAGIC_BYTES',
      reasonDetail:
        'DOCX candidate must start with a ZIP Local File Header signature (PK\\x03\\x04) at offset 0.',
    };
  }

  if (buffer.length < MIN_PRELIMINARY_DOCX_ZIP_BYTES) {
    return {
      ok: false,
      reasonCode: 'INVALID_ZIP_PRELIMINARY_STRUCTURE',
      reasonDetail:
        'DOCX candidate is shorter than the minimum valid ZIP Local File Header and End of Central Directory structure.',
    };
  }

  // First Local File Header sanity check (30-byte fixed header)
  const firstEntryNameLen = buffer.readUInt16LE(26);
  const firstEntryExtraLen = buffer.readUInt16LE(28);
  if (
    firstEntryNameLen === 0 ||
    30 + firstEntryNameLen + firstEntryExtraLen > buffer.length
  ) {
    return {
      ok: false,
      reasonCode: 'INVALID_ZIP_PRELIMINARY_STRUCTURE',
      reasonDetail: 'DOCX ZIP Local File Header has an empty or out-of-bounds entry filename length.',
    };
  }

  // Require an End of Central Directory (PK\x05\x06) marker within the valid tail window (max 65557 bytes)
  const tailWindowStart = Math.max(0, buffer.length - 65557);
  const tailView = buffer.subarray(tailWindowStart);
  const eocdRelIdx = tailView.lastIndexOf(ZIP_EMPTY_ARCHIVE_MAGIC);
  if (eocdRelIdx === -1 || tailView.length - eocdRelIdx < 22) {
    return {
      ok: false,
      reasonCode: 'INVALID_ZIP_PRELIMINARY_STRUCTURE',
      reasonDetail: 'DOCX ZIP candidate is missing a valid End of Central Directory (EOCD) record.',
    };
  }

  const polyglotError = containsHtmlOrScriptPolyglot(buffer);
  if (polyglotError !== null) {
    return {
      ok: false,
      reasonCode: 'POLYGLOT_OR_SCRIPT_SIGNATURE_DETECTED',
      reasonDetail: polyglotError,
    };
  }

  // Reject obvious macro project payload (vbaProject.bin) disguised inside a .docx container
  const latin1Content = buffer.toString('latin1');
  if (/vbaProject\.bin/i.test(latin1Content)) {
    return {
      ok: false,
      reasonCode: 'MACRO_ENABLED_FORMAT_FORBIDDEN',
      reasonDetail:
        'Detected vbaProject.bin macro payload inside .docx candidate; macro-enabled Word documents are forbidden.',
    };
  }

  return {
    ok: true,
    preliminarySignatureKind: 'ZIP_LOCAL_HEADER_ONLY',
    notes: Object.freeze([
      'Preliminary ZIP local file header (PK\\x03\\x04) and EOCD presence verified for .docx candidate.',
      'ZIP signature alone does NOT establish valid OpenXML DOCX structure or absence of zip bombs, macros, or external relationships.',
      'Candidate remains PENDING_DEEP_INSPECTION: not sanitized, not stored, not rights-approved, and not ready for PEIA.',
    ]),
  };
}

/**
 * Pure server-side preliminary admission check for Library PDF and DOCX upload candidates.
 */
export function assessLibraryUploadBinaryCandidate(
  candidateInput: AssessLibraryUploadBinaryCandidateInput
): LibraryUploadBinaryAdmissionResult {
  if (!isPlainObject(candidateInput)) {
    return makeRejectedResult(
      'INVALID_CANDIDATE_INPUT',
      'Candidate input must be a plain object containing { originalFilename, claimedMimeType?, bytes }.'
    );
  }

  for (const key of Object.keys(candidateInput)) {
    if (!ALLOWED_CANDIDATE_INPUT_KEYS.has(key)) {
      return makeRejectedResult(
        'UNTRUSTED_EXTRA_INPUT_FIELD',
        `Untrusted or unknown field "${key}" is not permitted in assessLibraryUploadBinaryCandidate.`
      );
    }
  }

  const byteSlice = extractExactByteSlice(candidateInput.bytes);
  if (byteSlice === null) {
    return makeRejectedResult(
      'INVALID_BINARY_BYTES',
      'bytes must be a valid Node.js Buffer or Uint8Array.'
    );
  }

  const actualSizeBytes = byteSlice.byteLength;
  if (actualSizeBytes <= 0) {
    return makeRejectedResult(
      'EMPTY_BINARY',
      'Candidate binary payload is empty (0 bytes).',
      0,
      null
    );
  }

  if (actualSizeBytes > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES) {
    return makeRejectedResult(
      'SIZE_LIMIT_EXCEEDED',
      `Candidate binary size (${actualSizeBytes} bytes) exceeds preliminary admission maximum (${MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES} bytes).`,
      actualSizeBytes,
      null
    );
  }

  const actualSha256 = computeActualBytesSha256(byteSlice);

  const filenameCheck = validateAndSanitizeCandidateFilename(
    candidateInput.originalFilename
  );
  if (!filenameCheck.ok) {
    return makeRejectedResult(
      filenameCheck.reasonCode,
      filenameCheck.reasonDetail,
      actualSizeBytes,
      actualSha256
    );
  }

  const mimeCheck = validateClaimedMimeType(
    candidateInput.claimedMimeType,
    filenameCheck.preliminaryFormat,
    filenameCheck.expectedCanonicalMimeType
  );
  if (!mimeCheck.ok) {
    return makeRejectedResult(
      mimeCheck.reasonCode,
      mimeCheck.reasonDetail,
      actualSizeBytes,
      actualSha256
    );
  }

  const binaryCheck =
    filenameCheck.preliminaryFormat === 'PDF'
      ? inspectPreliminaryPdfCandidate(byteSlice)
      : inspectPreliminaryDocxCandidate(byteSlice);

  if (!binaryCheck.ok) {
    return makeRejectedResult(
      binaryCheck.reasonCode,
      binaryCheck.reasonDetail,
      actualSizeBytes,
      actualSha256
    );
  }

  const candidateMetadata: LibraryUploadCandidateMetadata = Object.freeze({
    originalFilename: filenameCheck.originalFilename,
    sanitizedFilename: filenameCheck.sanitizedFilename,
    canonicalExtension: filenameCheck.canonicalExtension,
    claimedMimeType: mimeCheck.claimedMimeType,
    claimedMimeDisposition: mimeCheck.claimedMimeDisposition,
    expectedCanonicalMimeType: filenameCheck.expectedCanonicalMimeType,
  });

  return Object.freeze({
    status: 'PENDING_DEEP_INSPECTION' as const,
    format: filenameCheck.preliminaryFormat,
    sizeBytes: actualSizeBytes,
    sha256: actualSha256,
    candidateMetadata,
    preliminarySignatureKind: binaryCheck.preliminarySignatureKind,
    deepInspectionRequired: true as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isStored: false as const,
    isPublished: false as const,
    isRightsApproved: false as const,
    isReadyForPeia: false as const,
    admissionNotes: binaryCheck.notes,
  });
}
