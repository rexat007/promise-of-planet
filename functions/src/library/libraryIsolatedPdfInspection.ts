import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { LibraryQuarantineAvExecutionFailureReasonCode } from './libraryQuarantineAvExecutionContract';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
} from './libraryQuarantineReceiptContract';
import { deriveQuarantineCatalogDocumentId } from './libraryQuarantineCatalogHandoffService';
import { MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES } from './libraryUploadBinaryAdmission';
import { parseCanonicalSafeGcsGeneration } from './gcsLibraryQuarantineStorageAdapter';

/**
 * LIB-DIRECT-FILE-01 / PDF-SAFETY-RB1 — Isolated PDF Deep Inspection & Closed Attestation Contract
 *
 * SECURITY BOUNDARY:
 * - Parses genuine PDF cross-reference structures (`xref` tables, `/Type /XRef` streams,
 *   and compressed `/Type /ObjStm` object streams via bounded zlib inflation) and runs
 *   C++ `qpdf --json` in the isolated Cloud Run AV worker container.
 * - `qpdf --check` alone is never sufficient: exit codes != 0 (including exit 3 warnings/recovery),
 *   stderr warnings, encrypted `/Encrypt` trailers/objects, compressed object stream payloads,
 *   external URI/file references, JavaScript/launch/submit/XFA/multimedia/embedded-file
 *   constructs, and malformed or ambiguous structures all fail closed.
 * - Produces an immutable server-authored attestation in
 *   `library_quarantine_pdf_inspections/<requestId>` bound to exact receiptId, documentId,
 *   sourceRevision, sourceSha256, sourceGeneration, sourceByteSize, safetyCaseRevision,
 *   effectiveHumanCaseRevision, catalogUpdatedAt, workerRunId, and avCompletedAt.
 * - Preserves `isSanitized: false` and `isVerifiedSafe: false` unconditionally.
 */

export const LIBRARY_QUARANTINE_PDF_INSPECTIONS_COLLECTION =
  'library_quarantine_pdf_inspections' as const;

export const LIBRARY_QUARANTINE_PDF_INSPECTION_SCHEMA_VERSION = 1 as const;
export const LIBRARY_QUARANTINE_PDF_INSPECTION_POLICY_VERSION = 1 as const;
export const LIBRARY_QUARANTINE_PDF_INSPECTION_OUTCOME_VERIFIED =
  'PDF_STRUCTURE_VERIFIED' as const;

export const DEFAULT_QPDF_BINARY_PATH = '/usr/bin/qpdf' as const;
export const QPDF_PATH_ENV_VAR = 'POP_QPDF_PATH' as const;

export const PDF_INSPECTION_MAX_DECOMPRESSED_BYTES_PER_STREAM = 10_000_000 as const;
export const PDF_INSPECTION_MAX_TOTAL_DECOMPRESSED_BYTES = 25_000_000 as const;
export const PDF_INSPECTION_MAX_OBJSTM_COUNT = 256 as const;
export const PDF_INSPECTION_MAX_OBJECT_COUNT = 100_000 as const;
export const PDF_INSPECTION_MAX_XREF_CHAIN_DEPTH = 32 as const;
export const PDF_INSPECTION_MAX_NESTED_FILTER_DEPTH = 3 as const;
export const PDF_INSPECTION_MAX_VALUE_NESTING_DEPTH = 64 as const;
export const PDF_INSPECTION_QPDF_MAX_STDOUT_BYTES = 25 * 1024 * 1024;
export const PDF_INSPECTION_QPDF_MAX_STDERR_BYTES = 256 * 1024;

export type PdfXrefFormat = 'TABLE' | 'STREAM' | 'HYBRID';

export interface LibraryQuarantinePersistedPdfInspection {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_PDF_INSPECTION_SCHEMA_VERSION;
  readonly requestId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly sourceGeneration: string;
  readonly sourceByteSize: number;
  readonly sourceFormat: 'PDF';
  readonly deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER';
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly workerRunId: string;
  readonly inspectedAt: string;
  readonly avCompletedAt: string;
  readonly outcome: typeof LIBRARY_QUARANTINE_PDF_INSPECTION_OUTCOME_VERIFIED;
  readonly parserName: 'qpdf';
  readonly parserVersion: string;
  readonly structuralPolicyVersion: typeof LIBRARY_QUARANTINE_PDF_INSPECTION_POLICY_VERSION;
  readonly xrefFormat: PdfXrefFormat;
  readonly parsedObjectCount: number;
  readonly compressedObjectStreamsParsed: number;
  readonly warningCount: 0;
  readonly encrypted: false;
  readonly activeOrExternalConstructsDetected: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

const PERSISTED_PDF_INSPECTION_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'requestId',
  'receiptId',
  'documentId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'sourceGeneration',
  'sourceByteSize',
  'sourceFormat',
  'deepInspectionStatus',
  'safetyCaseRevision',
  'effectiveHumanCaseRevision',
  'catalogUpdatedAt',
  'workerRunId',
  'inspectedAt',
  'avCompletedAt',
  'outcome',
  'parserName',
  'parserVersion',
  'structuralPolicyVersion',
  'xrefFormat',
  'parsedObjectCount',
  'compressedObjectStreamsParsed',
  'warningCount',
  'encrypted',
  'activeOrExternalConstructsDetected',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const PARSER_VERSION_REGEX = /^[A-Za-z0-9][A-Za-z0-9 .+_/-]{0,63}$/;
const WORKER_RUN_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasUnexpectedKeyOrSymbol(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>
): boolean {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowed.has(key)) {
      return true;
    }
  }
  return Object.getOwnPropertySymbols(obj).length > 0;
}

export function validatePersistedLibraryQuarantinePdfInspection(
  raw: unknown,
  expectedRequestId?: string
):
  | { readonly ok: true; readonly value: LibraryQuarantinePersistedPdfInspection }
  | {
      readonly ok: false;
      readonly errorCode:
        | 'CORRUPTED_PDF_INSPECTION_ATTESTATION'
        | 'SECURITY_POSTURE_VIOLATION';
      readonly errorMessage: string;
    } {
  if (!isPlainRecord(raw)) {
    return {
      ok: false,
      errorCode: 'CORRUPTED_PDF_INSPECTION_ATTESTATION',
      errorMessage: 'PDF inspection attestation must be a plain object.',
    };
  }
  if (
    hasUnexpectedKeyOrSymbol(raw, PERSISTED_PDF_INSPECTION_KEYS) ||
    Object.keys(raw).length !== PERSISTED_PDF_INSPECTION_KEYS.size
  ) {
    return {
      ok: false,
      errorCode: 'CORRUPTED_PDF_INSPECTION_ATTESTATION',
      errorMessage: 'PDF inspection attestation does not match closed 32-field schema.',
    };
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false
  ) {
    return {
      ok: false,
      errorCode: 'SECURITY_POSTURE_VIOLATION',
      errorMessage:
        'PDF inspection attestation violated mandatory false security posture locks.',
    };
  }

  if (
    raw.schemaVersion !== LIBRARY_QUARANTINE_PDF_INSPECTION_SCHEMA_VERSION ||
    typeof raw.receiptId !== 'string' ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId) ||
    typeof raw.requestId !== 'string' ||
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    typeof raw.safetyCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.safetyCaseRevision) ||
    raw.safetyCaseRevision < 1 ||
    raw.requestId !== `${raw.receiptId}_${raw.sourceRevision}_${raw.safetyCaseRevision}` ||
    (expectedRequestId !== undefined && raw.requestId !== expectedRequestId) ||
    raw.documentId !== deriveQuarantineCatalogDocumentId(raw.receiptId) ||
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_HEX_REGEX.test(raw.sourceSha256) ||
    parseCanonicalSafeGcsGeneration(raw.sourceGeneration) !== raw.sourceGeneration ||
    typeof raw.sourceByteSize !== 'number' ||
    !Number.isSafeInteger(raw.sourceByteSize) ||
    raw.sourceByteSize < 1 ||
    raw.sourceByteSize > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES ||
    raw.sourceFormat !== 'PDF' ||
    raw.deepInspectionStatus !== 'PDF_REQUIRES_ISOLATED_PARSER' ||
    typeof raw.effectiveHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
    raw.effectiveHumanCaseRevision < 1 ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.catalogUpdatedAt) ||
    typeof raw.workerRunId !== 'string' ||
    !WORKER_RUN_ID_REGEX.test(raw.workerRunId) ||
    typeof raw.inspectedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.inspectedAt) ||
    typeof raw.avCompletedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.avCompletedAt) ||
    raw.outcome !== LIBRARY_QUARANTINE_PDF_INSPECTION_OUTCOME_VERIFIED ||
    raw.parserName !== 'qpdf' ||
    typeof raw.parserVersion !== 'string' ||
    !PARSER_VERSION_REGEX.test(raw.parserVersion) ||
    raw.structuralPolicyVersion !==
      LIBRARY_QUARANTINE_PDF_INSPECTION_POLICY_VERSION ||
    (raw.xrefFormat !== 'TABLE' &&
      raw.xrefFormat !== 'STREAM' &&
      raw.xrefFormat !== 'HYBRID') ||
    typeof raw.parsedObjectCount !== 'number' ||
    !Number.isSafeInteger(raw.parsedObjectCount) ||
    raw.parsedObjectCount < 2 ||
    raw.parsedObjectCount > PDF_INSPECTION_MAX_OBJECT_COUNT ||
    typeof raw.compressedObjectStreamsParsed !== 'number' ||
    !Number.isSafeInteger(raw.compressedObjectStreamsParsed) ||
    raw.compressedObjectStreamsParsed < 0 ||
    raw.compressedObjectStreamsParsed > PDF_INSPECTION_MAX_OBJSTM_COUNT ||
    raw.warningCount !== 0 ||
    raw.encrypted !== false ||
    raw.activeOrExternalConstructsDetected !== false
  ) {
    return {
      ok: false,
      errorCode: 'CORRUPTED_PDF_INSPECTION_ATTESTATION',
      errorMessage: 'PDF inspection attestation metadata or outcome failed validation.',
    };
  }

  return {
    ok: true,
    value: Object.freeze(raw as unknown as LibraryQuarantinePersistedPdfInspection),
  };
}

export function arePersistedPdfInspectionProvenanceIncompatible(
  persisted: LibraryQuarantinePersistedPdfInspection,
  expected: {
    readonly requestId: string;
    readonly receiptId: string;
    readonly documentId: string;
    readonly sourceRevision: number;
    readonly sourceUpdatedAt: string;
    readonly sourceSha256: string;
    readonly sourceGeneration: string;
    readonly sourceByteSize: number;
    readonly sourceFormat: string;
    readonly deepInspectionStatus: string;
    readonly safetyCaseRevision: number;
    readonly effectiveHumanCaseRevision: number;
    readonly catalogUpdatedAt: string;
    readonly workerRunId?: string | null;
    readonly avCompletedAt?: string | null;
  }
): boolean {
  return (
    persisted.requestId !== expected.requestId ||
    persisted.receiptId !== expected.receiptId ||
    persisted.documentId !== expected.documentId ||
    persisted.sourceRevision !== expected.sourceRevision ||
    persisted.sourceUpdatedAt !== expected.sourceUpdatedAt ||
    persisted.sourceSha256 !== expected.sourceSha256 ||
    persisted.sourceGeneration !== expected.sourceGeneration ||
    persisted.sourceByteSize !== expected.sourceByteSize ||
    persisted.sourceFormat !== 'PDF' ||
    expected.sourceFormat !== 'PDF' ||
    persisted.deepInspectionStatus !== 'PDF_REQUIRES_ISOLATED_PARSER' ||
    expected.deepInspectionStatus !== 'PDF_REQUIRES_ISOLATED_PARSER' ||
    persisted.safetyCaseRevision !== expected.safetyCaseRevision ||
    persisted.effectiveHumanCaseRevision !== expected.effectiveHumanCaseRevision ||
    persisted.catalogUpdatedAt !== expected.catalogUpdatedAt ||
    (expected.workerRunId !== undefined &&
      expected.workerRunId !== null &&
      persisted.workerRunId !== expected.workerRunId) ||
    (expected.avCompletedAt !== undefined &&
      expected.avCompletedAt !== null &&
      persisted.avCompletedAt !== expected.avCompletedAt) ||
    persisted.outcome !== LIBRARY_QUARANTINE_PDF_INSPECTION_OUTCOME_VERIFIED ||
    persisted.warningCount !== 0 ||
    persisted.encrypted !== false ||
    persisted.activeOrExternalConstructsDetected !== false ||
    persisted.isSanitized !== false ||
    persisted.isVerifiedSafe !== false ||
    persisted.isRightsApproved !== false ||
    persisted.isPublished !== false ||
    persisted.isReadyForPeia !== false
  );
}

// ---------------------------------------------------------------------------
// Conservative Prohibited PDF Dictionary Keys & Action/Subtype Values
// ---------------------------------------------------------------------------

const PROHIBITED_PDF_DICTIONARY_KEYS: ReadonlySet<string> = new Set([
  '/JS',
  '/JavaScript',
  '/OpenAction',
  '/AA',
  '/Launch',
  '/Win',
  '/Mac',
  '/Unix',
  '/SubmitForm',
  '/ImportData',
  '/ResetForm',
  '/XFA',
  '/GoToR',
  '/GoToE',
  '/GoTo3DView',
  '/Rendition',
  '/RichMedia',
  '/RichMediaSettings',
  '/RichMediaContent',
  '/RichMediaExecute',
  '/Sound',
  '/Movie',
  '/3D',
  '/U3D',
  '/PRC',
  '/Screen',
  '/EmbeddedFiles',
  '/EmbeddedFile',
  '/EF',
  '/Collection',
  '/FileAttachment',
  '/Filespec',
  '/URI',
  '/URL',
  '/UF',
  '/DOS',
  '/FFilter',
  '/FDecodeParams',
  '/Named',
  '/NeedsRendering',
]);

const PROHIBITED_PDF_TYPE_OR_SUBTYPE_NAMES: ReadonlySet<string> = new Set([
  '/JavaScript',
  '/Launch',
  '/SubmitForm',
  '/ImportData',
  '/ResetForm',
  '/GoToR',
  '/GoToE',
  '/GoTo3DView',
  '/URI',
  '/EmbeddedFile',
  '/Filespec',
  '/FileAttachment',
  '/Collection',
  '/RichMedia',
  '/RichMediaExecute',
  '/Rendition',
  '/Sound',
  '/Movie',
  '/Screen',
  '/3D',
  '/U3D',
  '/PRC',
  '/Named',
  '/Crypt',
  '/JBIG2Decode',
]);

const ALLOWED_PDF_STREAM_FILTERS: ReadonlySet<string> = new Set([
  '/FlateDecode',
  '/Fl',
  '/ASCIIHexDecode',
  '/AHx',
  '/ASCII85Decode',
  '/A85',
  '/RunLengthDecode',
  '/RL',
  '/DCTDecode',
  '/DCT',
  '/CCITTFaxDecode',
  '/CCF',
  '/JPXDecode',
  '/LZWDecode',
  '/LZW',
]);

type PdfToken =
  | { readonly kind: 'name'; readonly value: string; readonly start: number; readonly end: number }
  | { readonly kind: 'number'; readonly value: number; readonly raw: string; readonly start: number; readonly end: number }
  | { readonly kind: 'string'; readonly value: string; readonly start: number; readonly end: number }
  | { readonly kind: 'bool'; readonly value: boolean; readonly start: number; readonly end: number }
  | { readonly kind: 'null'; readonly start: number; readonly end: number }
  | { readonly kind: 'dictStart'; readonly start: number; readonly end: number }
  | { readonly kind: 'dictEnd'; readonly start: number; readonly end: number }
  | { readonly kind: 'arrayStart'; readonly start: number; readonly end: number }
  | { readonly kind: 'arrayEnd'; readonly start: number; readonly end: number }
  | { readonly kind: 'keyword'; readonly value: string; readonly start: number; readonly end: number };

type PdfValue =
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'null' }
  | { readonly kind: 'ref'; readonly objNum: number; readonly gen: number }
  | { readonly kind: 'array'; readonly items: readonly PdfValue[] }
  | { readonly kind: 'dict'; readonly entries: ReadonlyMap<string, PdfValue> }
  | {
      readonly kind: 'stream';
      readonly dict: ReadonlyMap<string, PdfValue>;
      readonly rawStreamBytes: Buffer;
    };

function isPdfWhitespace(byte: number): boolean {
  return (
    byte === 0x00 ||
    byte === 0x09 ||
    byte === 0x0a ||
    byte === 0x0c ||
    byte === 0x0d ||
    byte === 0x20
  );
}

function isPdfDelimiter(byte: number): boolean {
  return (
    byte === 0x28 || // (
    byte === 0x29 || // )
    byte === 0x3c || // <
    byte === 0x3e || // >
    byte === 0x5b || // [
    byte === 0x5d || // ]
    byte === 0x7b || // {
    byte === 0x7d || // }
    byte === 0x2f || // /
    byte === 0x25 // %
  );
}

function skipPdfWhitespaceAndComments(buf: Buffer, offset: number): number {
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos];
    if (isPdfWhitespace(b)) {
      pos += 1;
      continue;
    }
    if (b === 0x25) {
      // % comment until CR/LF
      pos += 1;
      while (pos < buf.length && buf[pos] !== 0x0a && buf[pos] !== 0x0d) {
        pos += 1;
      }
      continue;
    }
    break;
  }
  return pos;
}

function decodePdfNameToken(raw: string): string | null {
  // Decodes /Name including #XX hex escapes per ISO 32000-1 7.3.5
  let out = '/';
  for (let i = 1; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '#') {
      if (i + 2 >= raw.length) {
        return null;
      }
      const hex = raw.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        return null;
      }
      const code = Number.parseInt(hex, 16);
      if (code === 0) {
        return null;
      }
      out += String.fromCharCode(code);
      i += 2;
    } else {
      out += ch;
    }
  }
  return out;
}

function readNextPdfToken(
  buf: Buffer,
  offset: number
): { readonly token: PdfToken | null; readonly nextOffset: number; readonly error?: string } {
  const start = skipPdfWhitespaceAndComments(buf, offset);
  if (start >= buf.length) {
    return { token: null, nextOffset: start };
  }

  const b = buf[start];
  const bNext = start + 1 < buf.length ? buf[start + 1] : -1;

  if (b === 0x3c && bNext === 0x3c) {
    return {
      token: { kind: 'dictStart', start, end: start + 2 },
      nextOffset: start + 2,
    };
  }
  if (b === 0x3e && bNext === 0x3e) {
    return {
      token: { kind: 'dictEnd', start, end: start + 2 },
      nextOffset: start + 2,
    };
  }
  if (b === 0x5b) {
    return {
      token: { kind: 'arrayStart', start, end: start + 1 },
      nextOffset: start + 1,
    };
  }
  if (b === 0x5d) {
    return {
      token: { kind: 'arrayEnd', start, end: start + 1 },
      nextOffset: start + 1,
    };
  }

  // Literal string (...)
  if (b === 0x28) {
    let depth = 1;
    let pos = start + 1;
    while (pos < buf.length && depth > 0) {
      const c = buf[pos];
      if (c === 0x5c) {
        pos += 2;
        continue;
      }
      if (c === 0x28) {
        depth += 1;
      } else if (c === 0x29) {
        depth -= 1;
      }
      pos += 1;
    }
    if (depth !== 0) {
      return { token: null, nextOffset: pos, error: 'Unterminated PDF literal string.' };
    }
    return {
      token: {
        kind: 'string',
        value: buf.subarray(start + 1, pos - 1).toString('latin1'),
        start,
        end: pos,
      },
      nextOffset: pos,
    };
  }

  // Hex string <...>
  if (b === 0x3c) {
    let pos = start + 1;
    while (pos < buf.length && buf[pos] !== 0x3e) {
      pos += 1;
    }
    if (pos >= buf.length) {
      return { token: null, nextOffset: pos, error: 'Unterminated PDF hex string.' };
    }
    const inner = buf.subarray(start + 1, pos).toString('latin1').replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]*$/.test(inner)) {
      return { token: null, nextOffset: pos + 1, error: 'Invalid PDF hex string characters.' };
    }
    return {
      token: { kind: 'string', value: inner, start, end: pos + 1 },
      nextOffset: pos + 1,
    };
  }

  // Name /...
  if (b === 0x2f) {
    let pos = start + 1;
    while (pos < buf.length && !isPdfWhitespace(buf[pos]) && !isPdfDelimiter(buf[pos])) {
      pos += 1;
    }
    const raw = buf.subarray(start, pos).toString('latin1');
    const decoded = decodePdfNameToken(raw);
    if (!decoded) {
      return { token: null, nextOffset: pos, error: 'Invalid hex escape in PDF name.' };
    }
    return {
      token: { kind: 'name', value: decoded, start, end: pos },
      nextOffset: pos,
    };
  }

  // Unexpected single '>' or unmatched delimiter
  if (isPdfDelimiter(b)) {
    return { token: null, nextOffset: start + 1, error: `Unexpected delimiter byte 0x${b.toString(16)}.` };
  }

  // Number, bool, null, or keyword
  let pos = start;
  while (pos < buf.length && !isPdfWhitespace(buf[pos]) && !isPdfDelimiter(buf[pos])) {
    pos += 1;
  }
  const raw = buf.subarray(start, pos).toString('latin1');
  if (raw === 'true') {
    return {
      token: { kind: 'bool', value: true, start, end: pos },
      nextOffset: pos,
    };
  }
  if (raw === 'false') {
    return {
      token: { kind: 'bool', value: false, start, end: pos },
      nextOffset: pos,
    };
  }
  if (raw === 'null') {
    return {
      token: { kind: 'null', start, end: pos },
      nextOffset: pos,
    };
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      return { token: null, nextOffset: pos, error: 'Non-finite PDF number.' };
    }
    return {
      token: { kind: 'number', value: num, raw, start, end: pos },
      nextOffset: pos,
    };
  }
  return {
    token: { kind: 'keyword', value: raw, start, end: pos },
    nextOffset: pos,
  };
}

function parsePdfValue(
  buf: Buffer,
  offset: number,
  depth: number,
  allowStream: boolean
): { readonly value: PdfValue; readonly nextOffset: number } {
  if (depth > PDF_INSPECTION_MAX_VALUE_NESTING_DEPTH) {
    throw new Error('PDF_NESTING_DEPTH_EXCEEDED');
  }

  const tRes = readNextPdfToken(buf, offset);
  if (tRes.error || !tRes.token) {
    throw new Error(tRes.error ?? 'PDF_UNEXPECTED_EOF');
  }
  const tok = tRes.token;

  if (tok.kind === 'name') {
    return { value: { kind: 'name', value: tok.value }, nextOffset: tRes.nextOffset };
  }
  if (tok.kind === 'string') {
    return { value: { kind: 'string', value: tok.value }, nextOffset: tRes.nextOffset };
  }
  if (tok.kind === 'bool') {
    return { value: { kind: 'bool', value: tok.value }, nextOffset: tRes.nextOffset };
  }
  if (tok.kind === 'null') {
    return { value: { kind: 'null' }, nextOffset: tRes.nextOffset };
  }
  if (tok.kind === 'number') {
    // Check for indirect reference: int int R
    if (/^\d+$/.test(tok.raw)) {
      const t2 = readNextPdfToken(buf, tRes.nextOffset);
      if (t2.token && t2.token.kind === 'number' && /^\d+$/.test(t2.token.raw)) {
        const t3 = readNextPdfToken(buf, t2.nextOffset);
        if (t3.token && t3.token.kind === 'keyword' && t3.token.value === 'R') {
          return {
            value: {
              kind: 'ref',
              objNum: tok.value,
              gen: t2.token.value,
            },
            nextOffset: t3.nextOffset,
          };
        }
      }
    }
    return { value: { kind: 'number', value: tok.value }, nextOffset: tRes.nextOffset };
  }

  if (tok.kind === 'arrayStart') {
    const items: PdfValue[] = [];
    let cur = tRes.nextOffset;
    while (true) {
      const peek = readNextPdfToken(buf, cur);
      if (peek.error || !peek.token) {
        throw new Error(peek.error ?? 'PDF_UNTERMINATED_ARRAY');
      }
      if (peek.token.kind === 'arrayEnd') {
        cur = peek.nextOffset;
        break;
      }
      const parsedItem = parsePdfValue(buf, cur, depth + 1, false);
      items.push(parsedItem.value);
      cur = parsedItem.nextOffset;
      if (items.length > 50_000) {
        throw new Error('PDF_ARRAY_LIMIT_EXCEEDED');
      }
    }
    return { value: { kind: 'array', items }, nextOffset: cur };
  }

  if (tok.kind === 'dictStart') {
    const entries = new Map<string, PdfValue>();
    let cur = tRes.nextOffset;
    while (true) {
      const peek = readNextPdfToken(buf, cur);
      if (peek.error || !peek.token) {
        throw new Error(peek.error ?? 'PDF_UNTERMINATED_DICT');
      }
      if (peek.token.kind === 'dictEnd') {
        cur = peek.nextOffset;
        break;
      }
      if (peek.token.kind !== 'name') {
        throw new Error('PDF_EXPECTED_DICT_KEY_NAME');
      }
      const key = peek.token.value;
      const parsedVal = parsePdfValue(buf, peek.nextOffset, depth + 1, false);
      entries.set(key, parsedVal.value);
      cur = parsedVal.nextOffset;
      if (entries.size > 10_000) {
        throw new Error('PDF_DICT_LIMIT_EXCEEDED');
      }
    }

    if (allowStream) {
      const afterDict = readNextPdfToken(buf, cur);
      if (afterDict.token && afterDict.token.kind === 'keyword' && afterDict.token.value === 'stream') {
        // Stream keyword MUST be followed by \r\n or \n per ISO 32000-1 7.3.8.1
        let dataStart = afterDict.token.end;
        if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) {
          dataStart += 2;
        } else if (buf[dataStart] === 0x0a) {
          dataStart += 1;
        } else {
          throw new Error('PDF_MALFORMED_STREAM_HEADER_EOL');
        }

        const lenVal = entries.get('/Length');
        let declaredLength: number | null = null;
        if (lenVal && lenVal.kind === 'number') {
          if (!Number.isSafeInteger(lenVal.value) || lenVal.value < 0) {
            throw new Error('PDF_INVALID_STREAM_LENGTH');
          }
          declaredLength = lenVal.value;
        }

        let streamEndOffset: number;
        let nextOffsetAfterEndstream: number;
        if (declaredLength !== null) {
          streamEndOffset = dataStart + declaredLength;
          if (streamEndOffset > buf.length) {
            throw new Error('PDF_STREAM_LENGTH_OUT_OF_BOUNDS');
          }
          const endTok = readNextPdfToken(buf, streamEndOffset);
          if (!endTok.token || endTok.token.kind !== 'keyword' || endTok.token.value !== 'endstream') {
            throw new Error('PDF_MISSING_ENDSTREAM_AT_DECLARED_LENGTH');
          }
          nextOffsetAfterEndstream = endTok.nextOffset;
        } else {
          // If /Length is an indirect reference, require explicit endstream delimiter before next endobj
          const foundEnd = buf.indexOf(Buffer.from('endstream', 'latin1'), dataStart);
          if (foundEnd < 0) {
            throw new Error('PDF_MISSING_ENDSTREAM');
          }
          streamEndOffset = foundEnd;
          if (streamEndOffset > dataStart && buf[streamEndOffset - 1] === 0x0a) {
            streamEndOffset -= 1;
            if (streamEndOffset > dataStart && buf[streamEndOffset - 1] === 0x0d) {
              streamEndOffset -= 1;
            }
          } else if (streamEndOffset > dataStart && buf[streamEndOffset - 1] === 0x0d) {
            streamEndOffset -= 1;
          }
          nextOffsetAfterEndstream = foundEnd + 'endstream'.length;
        }

        const rawStreamBytes = buf.subarray(dataStart, streamEndOffset);
        return {
          value: { kind: 'stream', dict: entries, rawStreamBytes },
          nextOffset: nextOffsetAfterEndstream,
        };
      }
    }

    return { value: { kind: 'dict', entries }, nextOffset: cur };
  }

  throw new Error(`PDF_UNEXPECTED_TOKEN:${tok.kind}`);
}

function readStreamFilterChain(dict: ReadonlyMap<string, PdfValue>): string[] {
  const filterVal = dict.get('/Filter');
  if (!filterVal) {
    return [];
  }
  if (filterVal.kind === 'name') {
    return [filterVal.value];
  }
  if (filterVal.kind === 'array') {
    const out: string[] = [];
    for (const item of filterVal.items) {
      if (item.kind !== 'name') {
        throw new Error('PDF_INVALID_FILTER_ENTRY');
      }
      out.push(item.value);
    }
    return out;
  }
  throw new Error('PDF_INVALID_FILTER_TYPE');
}

function boundedFlateDecompress(
  rawBytes: Buffer,
  remainingTotalBudget: number
): Buffer {
  const maxAllowed = Math.min(
    PDF_INSPECTION_MAX_DECOMPRESSED_BYTES_PER_STREAM,
    remainingTotalBudget
  );
  if (maxAllowed < 1) {
    throw new Error('PDF_DECOMPRESSION_BUDGET_EXCEEDED');
  }
  const out = inflateSync(rawBytes, { maxOutputLength: maxAllowed });
  return out;
}

function inspectPdfValueTree(
  val: PdfValue,
  enclosingDictKeys: ReadonlySet<string> | null,
  findings: string[]
): void {
  if (val.kind === 'array') {
    for (const item of val.items) {
      inspectPdfValueTree(item, null, findings);
      if (findings.length >= 16) return;
    }
    return;
  }

  if (val.kind === 'dict' || val.kind === 'stream') {
    const dict = val.kind === 'dict' ? val.entries : val.dict;
    const keys = new Set<string>(dict.keys());

    if (val.kind === 'stream') {
      if (dict.has('/F') || dict.has('/FFilter') || dict.has('/FDecodeParams')) {
        findings.push('EXTERNAL_FILE_STREAM_PROHIBITED');
      }
      const filters = readStreamFilterChain(dict);
      if (filters.length > PDF_INSPECTION_MAX_NESTED_FILTER_DEPTH) {
        findings.push('EXCESSIVE_FILTER_CHAIN_DEPTH');
      }
      for (const f of filters) {
        if (!ALLOWED_PDF_STREAM_FILTERS.has(f)) {
          findings.push(`UNSUPPORTED_OR_DANGEROUS_FILTER:${f}`);
        }
      }
    }

    for (const [k, v] of dict.entries()) {
      if (k === '/Encrypt') {
        findings.push('ENCRYPTED_PDF_PROHIBITED');
      }
      if (PROHIBITED_PDF_DICTIONARY_KEYS.has(k)) {
        findings.push(`PROHIBITED_PDF_KEY:${k}`);
      }
      if (k === '/F') {
        // Numeric annotation bitflag `/F 4` on annotations is standard; string/dict/array `/F` or Filespec `/F` is prohibited
        const filespecType = dict.get('/Type');
        if (
          v.kind !== 'number' ||
          keys.has('/EF') ||
          keys.has('/UF') ||
          keys.has('/FS') ||
          (filespecType !== undefined &&
            filespecType.kind === 'name' &&
            filespecType.value === '/Filespec')
        ) {
          findings.push('PROHIBITED_EXTERNAL_FILESPEC_F');
        }
      }
      if (k === '/FS' && v.kind === 'name' && v.value === '/URL') {
        findings.push('EXTERNAL_URL_FILESYSTEM_PROHIBITED');
      }
      if (
        (k === '/Type' || k === '/Subtype' || k === '/S') &&
        v.kind === 'name' &&
        PROHIBITED_PDF_TYPE_OR_SUBTYPE_NAMES.has(v.value)
      ) {
        findings.push(`PROHIBITED_TYPE_OR_ACTION:${v.value}`);
      }
      if (k === '/Subtype' && v.kind === 'name' && v.value === '/Link') {
        if (dict.has('/A') || dict.has('/PA')) {
          findings.push('LINK_ACTION_PROHIBITED');
        }
      }
      if (findings.length >= 16) return;
      inspectPdfValueTree(v, keys, findings);
    }
    return;
  }

  if (
    enclosingDictKeys &&
    val.kind === 'name' &&
    PROHIBITED_PDF_TYPE_OR_SUBTYPE_NAMES.has(val.value)
  ) {
    findings.push(`PROHIBITED_NAME_TOKEN:${val.value}`);
  }
}

export interface PdfStructuralInspectionSuccess {
  readonly ok: true;
  readonly xrefFormat: PdfXrefFormat;
  readonly parsedObjectCount: number;
  readonly compressedObjectStreamsParsed: number;
  readonly warningCount: 0;
  readonly encrypted: false;
  readonly activeOrExternalConstructsDetected: false;
}

export interface PdfStructuralInspectionFailure {
  readonly ok: false;
  readonly failureReasonCode: Extract<
    LibraryQuarantineAvExecutionFailureReasonCode,
    | 'PDF_ENCRYPTED_OR_MALFORMED'
    | 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE'
    | 'PDF_INSPECTION_FAILED'
  >;
  readonly errorMessage: string;
}

export type PdfStructuralInspectionResult =
  | PdfStructuralInspectionSuccess
  | PdfStructuralInspectionFailure;

function readBigEndianUInt(buf: Buffer, offset: number, width: number): number {
  let acc = 0;
  for (let i = 0; i < width; i += 1) {
    acc = acc * 256 + buf[offset + i];
  }
  return acc;
}

export function inspectPdfBytesStructurally(
  bytes: Buffer
): PdfStructuralInspectionResult {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 32 ||
    bytes.length > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
  ) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF buffer is empty, too small, or exceeds maximum size.',
    };
  }

  // Must start strictly at byte 0 with %PDF-1.x or %PDF-2.x (blocks ZIP/HTML polyglots & BOM tricks)
  const headerSlice = bytes.subarray(0, 16).toString('latin1');
  if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(headerSlice)) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF must begin at byte offset 0 with a valid %PDF-1.x or %PDF-2.0 header.',
    };
  }

  // Verify trailing %%EOF with zero trailing payload data
  const tailWindowStart = Math.max(0, bytes.length - 1024);
  const tailSlice = bytes.subarray(tailWindowStart).toString('latin1');
  const lastEofRel = tailSlice.lastIndexOf('%%EOF');
  if (lastEofRel < 0) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF is missing trailing %%EOF marker.',
    };
  }
  const afterEof = tailSlice.slice(lastEofRel + '%%EOF'.length);
  if (afterEof.length > 64 || !/^[\r\n\t ]*$/.test(afterEof)) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE',
      errorMessage: 'PDF contains unexpected trailing data after final %%EOF.',
    };
  }

  // Extract startxref immediately preceding final %%EOF
  const beforeEof = tailSlice.slice(0, lastEofRel);
  const startXrefMatch = beforeEof.match(/startxref[\r\n\s]+(\d+)[\r\n\s]*$/);
  if (!startXrefMatch) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF is missing valid startxref pointer before %%EOF.',
    };
  }
  const initialXrefOffset = Number(startXrefMatch[1]);
  if (
    !Number.isSafeInteger(initialXrefOffset) ||
    initialXrefOffset < 8 ||
    initialXrefOffset >= bytes.length
  ) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF startxref byte offset is out of bounds.',
    };
  }

  let hasClassicXrefTable = false;
  let hasXrefStream = false;
  let rootRef: { readonly objNum: number; readonly gen: number } | null = null;
  let totalDecompressedBytes = 0;

  const visitedXrefOffsets = new Set<number>();
  const directObjectOffsets = new Map<number, { readonly gen: number; readonly offset: number }>();
  const compressedObjectRefs = new Map<number, { readonly objStmNum: number; readonly indexInStm: number }>();
  const findings: string[] = [];

  try {
    const queue: number[] = [initialXrefOffset];
    while (queue.length > 0) {
      if (visitedXrefOffsets.size >= PDF_INSPECTION_MAX_XREF_CHAIN_DEPTH) {
        return {
          ok: false,
          failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
          errorMessage: 'PDF cross-reference /Prev chain exceeded safe depth limit.',
        };
      }
      const xrefOffset = queue.shift()!;
      if (visitedXrefOffsets.has(xrefOffset)) {
        return {
          ok: false,
          failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
          errorMessage: 'Cyclic cross-reference /Prev or /XRefStm pointer detected.',
        };
      }
      visitedXrefOffsets.add(xrefOffset);

      if (xrefOffset < 0 || xrefOffset >= bytes.length) {
        return {
          ok: false,
          failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
          errorMessage: 'Referenced cross-reference offset is out of bounds.',
        };
      }

      const tokAtOffset = readNextPdfToken(bytes, xrefOffset);
      if (
        tokAtOffset.token &&
        tokAtOffset.token.kind === 'keyword' &&
        tokAtOffset.token.value === 'xref'
      ) {
        hasClassicXrefTable = true;
        let cursor = tokAtOffset.nextOffset;

        while (true) {
          const nextTok = readNextPdfToken(bytes, cursor);
          if (!nextTok.token) {
            throw new Error('PDF_XREF_TRUNCATED_BEFORE_TRAILER');
          }
          if (nextTok.token.kind === 'keyword' && nextTok.token.value === 'trailer') {
            cursor = nextTok.nextOffset;
            break;
          }
          if (
            nextTok.token.kind !== 'number' ||
            !/^\d+$/.test(nextTok.token.raw)
          ) {
            throw new Error('PDF_XREF_INVALID_SUBSECTION_START');
          }
          const countTok = readNextPdfToken(bytes, nextTok.nextOffset);
          if (
            !countTok.token ||
            countTok.token.kind !== 'number' ||
            !/^\d+$/.test(countTok.token.raw)
          ) {
            throw new Error('PDF_XREF_INVALID_SUBSECTION_COUNT');
          }
          const startObj = nextTok.token.value;
          const count = countTok.token.value;
          if (count < 0 || count > PDF_INSPECTION_MAX_OBJECT_COUNT) {
            throw new Error('PDF_XREF_COUNT_LIMIT_EXCEEDED');
          }
          cursor = countTok.nextOffset;

          for (let i = 0; i < count; i += 1) {
            const offTok = readNextPdfToken(bytes, cursor);
            const genTok = offTok.token ? readNextPdfToken(bytes, offTok.nextOffset) : null;
            const flagTok = genTok?.token ? readNextPdfToken(bytes, genTok.nextOffset) : null;
            if (
              !offTok.token ||
              offTok.token.kind !== 'number' ||
              !genTok?.token ||
              genTok.token.kind !== 'number' ||
              !flagTok?.token ||
              flagTok.token.kind !== 'keyword' ||
              (flagTok.token.value !== 'n' && flagTok.token.value !== 'f')
            ) {
              throw new Error('PDF_XREF_MALFORMED_ENTRY');
            }
            const objNum = startObj + i;
            if (flagTok.token.value === 'n') {
              if (
                !Number.isSafeInteger(offTok.token.value) ||
                offTok.token.value <= 0 ||
                offTok.token.value >= bytes.length
              ) {
                throw new Error('PDF_XREF_ENTRY_OFFSET_OUT_OF_BOUNDS');
              }
              if (!directObjectOffsets.has(objNum) && !compressedObjectRefs.has(objNum)) {
                directObjectOffsets.set(objNum, {
                  gen: genTok.token.value,
                  offset: offTok.token.value,
                });
              }
            }
            cursor = flagTok.nextOffset;
          }
        }

        const trailerParsed = parsePdfValue(bytes, cursor, 0, false);
        if (trailerParsed.value.kind !== 'dict') {
          throw new Error('PDF_TRAILER_NOT_DICTIONARY');
        }
        const trailerDict = trailerParsed.value.entries;
        inspectPdfValueTree(trailerParsed.value, null, findings);

        const rVal = trailerDict.get('/Root');
        if (rVal && rVal.kind === 'ref' && !rootRef) {
          rootRef = { objNum: rVal.objNum, gen: rVal.gen };
        }
        const prevVal = trailerDict.get('/Prev');
        if (prevVal) {
          if (prevVal.kind !== 'number' || !Number.isSafeInteger(prevVal.value)) {
            throw new Error('PDF_INVALID_PREV_OFFSET');
          }
          queue.push(prevVal.value);
        }
        const hybridStmVal = trailerDict.get('/XRefStm');
        if (hybridStmVal) {
          if (hybridStmVal.kind !== 'number' || !Number.isSafeInteger(hybridStmVal.value)) {
            throw new Error('PDF_INVALID_XREFSTM_OFFSET');
          }
          queue.push(hybridStmVal.value);
        }
      } else {
        // Expect /Type /XRef indirect stream object
        const objNumTok = tokAtOffset;
        const genTok = objNumTok.token ? readNextPdfToken(bytes, objNumTok.nextOffset) : null;
        const objKwTok = genTok?.token ? readNextPdfToken(bytes, genTok.nextOffset) : null;
        if (
          !objNumTok.token ||
          objNumTok.token.kind !== 'number' ||
          !genTok?.token ||
          genTok.token.kind !== 'number' ||
          !objKwTok?.token ||
          objKwTok.token.kind !== 'keyword' ||
          objKwTok.token.value !== 'obj'
        ) {
          throw new Error('PDF_INVALID_XREF_OFFSET_TARGET');
        }

        const parsedXrefObj = parsePdfValue(bytes, objKwTok.nextOffset, 0, true);
        if (parsedXrefObj.value.kind !== 'stream') {
          throw new Error('PDF_XREF_OBJECT_NOT_STREAM');
        }
        const dict = parsedXrefObj.value.dict;
        const xrefType = dict.get('/Type');
        if (!xrefType || xrefType.kind !== 'name' || xrefType.value !== '/XRef') {
          throw new Error('PDF_XREF_STREAM_MISSING_TYPE');
        }
        hasXrefStream = true;
        inspectPdfValueTree(parsedXrefObj.value, null, findings);

        const sizeVal = dict.get('/Size');
        const wVal = dict.get('/W');
        if (
          !sizeVal ||
          sizeVal.kind !== 'number' ||
          !Number.isSafeInteger(sizeVal.value) ||
          sizeVal.value < 1 ||
          sizeVal.value > PDF_INSPECTION_MAX_OBJECT_COUNT ||
          !wVal ||
          wVal.kind !== 'array' ||
          wVal.items.length !== 3
        ) {
          throw new Error('PDF_XREF_STREAM_INVALID_SIZE_OR_W');
        }
        const widths = wVal.items.map((item) => {
          if (
            item.kind !== 'number' ||
            !Number.isSafeInteger(item.value) ||
            item.value < 0 ||
            item.value > 8
          ) {
            throw new Error('PDF_XREF_STREAM_INVALID_W_ENTRY');
          }
          return item.value;
        });
        const entryWidth = widths[0] + widths[1] + widths[2];
        if (entryWidth < 1) {
          throw new Error('PDF_XREF_STREAM_ZERO_ENTRY_WIDTH');
        }

        const filters = readStreamFilterChain(dict);
        let decodedXrefBytes = parsedXrefObj.value.rawStreamBytes;
        if (filters.length > 0) {
          if (
            filters.length !== 1 ||
            (filters[0] !== '/FlateDecode' && filters[0] !== '/Fl')
          ) {
            throw new Error(`PDF_UNSUPPORTED_XREF_STREAM_FILTER:${filters.join(',')}`);
          }
          if (dict.has('/DecodeParms')) {
            // Conservative: /Predictor transforms in /XRef streams require deterministic exact handling;
            // reject non-trivial /XRef predictors cleanly if unsupported
            const dp = dict.get('/DecodeParms');
            if (dp && dp.kind === 'dict' && dp.entries.has('/Predictor')) {
              const predVal = dp.entries.get('/Predictor');
              if (predVal && predVal.kind === 'number' && predVal.value !== 1) {
                throw new Error('PDF_UNSUPPORTED_XREF_PREDICTOR');
              }
            }
          }
          decodedXrefBytes = boundedFlateDecompress(
            decodedXrefBytes,
            PDF_INSPECTION_MAX_TOTAL_DECOMPRESSED_BYTES - totalDecompressedBytes
          );
          totalDecompressedBytes += decodedXrefBytes.length;
        }

        const indexPairs: Array<readonly [number, number]> = [];
        const indexVal = dict.get('/Index');
        if (!indexVal) {
          indexPairs.push([0, sizeVal.value]);
        } else {
          if (indexVal.kind !== 'array' || indexVal.items.length % 2 !== 0) {
            throw new Error('PDF_XREF_STREAM_INVALID_INDEX');
          }
          for (let i = 0; i < indexVal.items.length; i += 2) {
            const s = indexVal.items[i];
            const c = indexVal.items[i + 1];
            if (
              s.kind !== 'number' ||
              c.kind !== 'number' ||
              !Number.isSafeInteger(s.value) ||
              !Number.isSafeInteger(c.value) ||
              s.value < 0 ||
              c.value < 0
            ) {
              throw new Error('PDF_XREF_STREAM_INVALID_INDEX_ENTRY');
            }
            indexPairs.push([s.value, c.value]);
          }
        }

        let rowCursor = 0;
        for (const [startObj, count] of indexPairs) {
          for (let i = 0; i < count; i += 1) {
            if (rowCursor + entryWidth > decodedXrefBytes.length) {
              throw new Error('PDF_XREF_STREAM_TRUNCATED_ROWS');
            }
            const field1 =
              widths[0] === 0
                ? 1
                : readBigEndianUInt(decodedXrefBytes, rowCursor, widths[0]);
            const field2 =
              widths[1] === 0
                ? 0
                : readBigEndianUInt(
                    decodedXrefBytes,
                    rowCursor + widths[0],
                    widths[1]
                  );
            const field3 =
              widths[2] === 0
                ? 0
                : readBigEndianUInt(
                    decodedXrefBytes,
                    rowCursor + widths[0] + widths[1],
                    widths[2]
                  );
            rowCursor += entryWidth;

            const objNum = startObj + i;
            if (field1 === 1) {
              if (field2 <= 0 || field2 >= bytes.length) {
                throw new Error('PDF_XREF_STREAM_OFFSET_OUT_OF_BOUNDS');
              }
              if (!directObjectOffsets.has(objNum) && !compressedObjectRefs.has(objNum)) {
                directObjectOffsets.set(objNum, { gen: field3, offset: field2 });
              }
            } else if (field1 === 2) {
              if (!directObjectOffsets.has(objNum) && !compressedObjectRefs.has(objNum)) {
                compressedObjectRefs.set(objNum, {
                  objStmNum: field2,
                  indexInStm: field3,
                });
              }
            }
          }
        }

        const rVal = dict.get('/Root');
        if (rVal && rVal.kind === 'ref' && !rootRef) {
          rootRef = { objNum: rVal.objNum, gen: rVal.gen };
        }
        const prevVal = dict.get('/Prev');
        if (prevVal) {
          if (prevVal.kind !== 'number' || !Number.isSafeInteger(prevVal.value)) {
            throw new Error('PDF_INVALID_PREV_OFFSET');
          }
          queue.push(prevVal.value);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PDF cross-reference parse failure.';
    return {
      ok: false,
      failureReasonCode:
        findings.some((f) => f.includes('ENCRYPTED')) ||
        msg.includes('ENCRYPTED')
          ? 'PDF_ENCRYPTED_OR_MALFORMED'
          : findings.length > 0
            ? 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE'
            : 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: msg,
    };
  }

  if (findings.some((f) => f === 'ENCRYPTED_PDF_PROHIBITED')) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'Encrypted PDF files are strictly prohibited.',
    };
  }
  if (findings.length > 0) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE',
      errorMessage: `Prohibited PDF trailer/xref construct detected (${findings[0]}).`,
    };
  }
  if (!rootRef) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF trailer is missing required /Root catalog reference.',
    };
  }

  const parsedObjects = new Map<number, PdfValue>();
  let compressedObjectStreamsParsed = 0;

  try {
    // Parse every non-free direct indirect object in the cross-reference directory
    for (const [objNum, loc] of directObjectOffsets.entries()) {
      const tNum = readNextPdfToken(bytes, loc.offset);
      const tGen = tNum.token ? readNextPdfToken(bytes, tNum.nextOffset) : null;
      const tKw = tGen?.token ? readNextPdfToken(bytes, tGen.nextOffset) : null;
      if (
        !tNum.token ||
        tNum.token.kind !== 'number' ||
        tNum.token.value !== objNum ||
        !tGen?.token ||
        tGen.token.kind !== 'number' ||
        tGen.token.value !== loc.gen ||
        !tKw?.token ||
        tKw.token.kind !== 'keyword' ||
        tKw.token.value !== 'obj'
      ) {
        throw new Error(`PDF_XREF_OBJECT_HEADER_MISMATCH:${objNum}`);
      }

      const parsedVal = parsePdfValue(bytes, tKw.nextOffset, 0, true);
      const endObjTok = readNextPdfToken(bytes, parsedVal.nextOffset);
      if (
        !endObjTok.token ||
        endObjTok.token.kind !== 'keyword' ||
        endObjTok.token.value !== 'endobj'
      ) {
        throw new Error(`PDF_MISSING_ENDOBJ:${objNum}`);
      }

      parsedObjects.set(objNum, parsedVal.value);
      inspectPdfValueTree(parsedVal.value, null, findings);
      if (findings.length > 0) break;

      // Decompress and parse every compressed object inside `/Type /ObjStm`
      const objStmType = parsedVal.value.kind === 'stream' ? parsedVal.value.dict.get('/Type') : null;
      if (
        parsedVal.value.kind === 'stream' &&
        objStmType !== null &&
        objStmType !== undefined &&
        objStmType.kind === 'name' &&
        objStmType.value === '/ObjStm'
      ) {
        compressedObjectStreamsParsed += 1;
        if (compressedObjectStreamsParsed > PDF_INSPECTION_MAX_OBJSTM_COUNT) {
          throw new Error('PDF_OBJSTM_COUNT_LIMIT_EXCEEDED');
        }
        const stmDict = parsedVal.value.dict;
        const nVal = stmDict.get('/N');
        const firstVal = stmDict.get('/First');
        if (
          !nVal ||
          nVal.kind !== 'number' ||
          !Number.isSafeInteger(nVal.value) ||
          nVal.value < 0 ||
          !firstVal ||
          firstVal.kind !== 'number' ||
          !Number.isSafeInteger(firstVal.value) ||
          firstVal.value < 0
        ) {
          throw new Error(`PDF_OBJSTM_INVALID_HEADER:${objNum}`);
        }

        const stmFilters = readStreamFilterChain(stmDict);
        let decodedStmBytes = parsedVal.value.rawStreamBytes;
        if (stmFilters.length > 0) {
          if (
            stmFilters.length !== 1 ||
            (stmFilters[0] !== '/FlateDecode' && stmFilters[0] !== '/Fl')
          ) {
            throw new Error(`PDF_UNSUPPORTED_OBJSTM_FILTER:${stmFilters.join(',')}`);
          }
          decodedStmBytes = boundedFlateDecompress(
            decodedStmBytes,
            PDF_INSPECTION_MAX_TOTAL_DECOMPRESSED_BYTES - totalDecompressedBytes
          );
          totalDecompressedBytes += decodedStmBytes.length;
        }

        if (firstVal.value > decodedStmBytes.length) {
          throw new Error(`PDF_OBJSTM_FIRST_OUT_OF_BOUNDS:${objNum}`);
        }

        let pairCursor = 0;
        const entries: Array<readonly [number, number]> = [];
        for (let k = 0; k < nVal.value; k += 1) {
          const idTok = readNextPdfToken(decodedStmBytes, pairCursor);
          const relTok = idTok.token
            ? readNextPdfToken(decodedStmBytes, idTok.nextOffset)
            : null;
          if (
            !idTok.token ||
            idTok.token.kind !== 'number' ||
            !relTok?.token ||
            relTok.token.kind !== 'number' ||
            !Number.isSafeInteger(idTok.token.value) ||
            !Number.isSafeInteger(relTok.token.value) ||
            relTok.token.value < 0
          ) {
            throw new Error(`PDF_OBJSTM_PAIR_CORRUPT:${objNum}`);
          }
          entries.push([idTok.token.value, firstVal.value + relTok.token.value]);
          pairCursor = relTok.nextOffset;
        }

        for (const [embeddedObjNum, absOffset] of entries) {
          if (absOffset >= decodedStmBytes.length) {
            throw new Error(`PDF_OBJSTM_EMBEDDED_OFFSET_OOB:${embeddedObjNum}`);
          }
          const embeddedVal = parsePdfValue(decodedStmBytes, absOffset, 0, false);
          parsedObjects.set(embeddedObjNum, embeddedVal.value);
          inspectPdfValueTree(embeddedVal.value, null, findings);
          if (findings.length > 0) break;
        }
        if (findings.length > 0) break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed parsing PDF indirect objects.';
    return {
      ok: false,
      failureReasonCode:
        findings.some((f) => f === 'ENCRYPTED_PDF_PROHIBITED')
          ? 'PDF_ENCRYPTED_OR_MALFORMED'
          : findings.length > 0
            ? 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE'
            : 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: msg,
    };
  }

  if (findings.some((f) => f === 'ENCRYPTED_PDF_PROHIBITED')) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'Encrypted PDF objects are prohibited.',
    };
  }
  if (findings.length > 0) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE',
      errorMessage: `Prohibited active/external/unsafe PDF construct detected (${findings[0]}).`,
    };
  }

  // Ensure every compressed object declared in Type 2 XRef entries was actually resolved & parsed
  for (const [compObjNum] of compressedObjectRefs.entries()) {
    if (!parsedObjects.has(compObjNum)) {
      return {
        ok: false,
        failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
        errorMessage: `Compressed object ${compObjNum} referenced in /Type /XRef was not found in any /ObjStm.`,
      };
    }
  }

  // Verify Catalog (/Root) and /Pages tree exist cleanly
  const catalogVal = parsedObjects.get(rootRef.objNum);
  if (!catalogVal || catalogVal.kind !== 'dict') {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF /Root catalog object is missing or invalid.',
    };
  }
  const catalogType = catalogVal.entries.get('/Type');
  if (
    !catalogType ||
    catalogType.kind !== 'name' ||
    catalogType.value !== '/Catalog'
  ) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF /Root object does not declare /Type /Catalog.',
    };
  }
  const pagesRef = catalogVal.entries.get('/Pages');
  if (!pagesRef || pagesRef.kind !== 'ref') {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF /Catalog is missing valid /Pages reference.',
    };
  }
  const pagesVal = parsedObjects.get(pagesRef.objNum);
  const pagesType = pagesVal?.kind === 'dict' ? pagesVal.entries.get('/Type') : null;
  if (
    !pagesVal ||
    pagesVal.kind !== 'dict' ||
    !pagesType ||
    pagesType.kind !== 'name' ||
    pagesType.value !== '/Pages'
  ) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF /Pages root tree object is missing or invalid.',
    };
  }

  const xrefFormat: PdfXrefFormat =
    hasClassicXrefTable && hasXrefStream
      ? 'HYBRID'
      : hasXrefStream
        ? 'STREAM'
        : 'TABLE';

  return {
    ok: true,
    xrefFormat,
    parsedObjectCount: parsedObjects.size,
    compressedObjectStreamsParsed,
    warningCount: 0,
    encrypted: false,
    activeOrExternalConstructsDetected: false,
  };
}

// ---------------------------------------------------------------------------
// Isolated C++ qpdf Runner + Dual-Layer PDF Inspection
// ---------------------------------------------------------------------------

export interface IsolatedPdfParserBinaryVerificationResult {
  readonly ok: true;
  readonly parserName: 'qpdf';
  readonly parserVersion: string;
}

export interface IsolatedPdfParserBinaryVerificationFailure {
  readonly ok: false;
  readonly failureReasonCode: Extract<
    LibraryQuarantineAvExecutionFailureReasonCode,
    'PDF_PARSER_BINARY_MISSING'
  >;
  readonly errorMessage: string;
}

export type VerifyPdfParserBinaryFn = (
  qpdfPathOverride?: string
) => Promise<
  | IsolatedPdfParserBinaryVerificationResult
  | IsolatedPdfParserBinaryVerificationFailure
>;

export interface QpdfJsonRunResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export type QpdfJsonRunnerFn = (params: {
  readonly qpdfPath: string;
  readonly tempFilePath: string;
  readonly timeoutMs: number;
}) => Promise<QpdfJsonRunResult>;

export interface IsolatedPdfInspectorSuccess {
  readonly ok: true;
  readonly parserName: 'qpdf';
  readonly parserVersion: string;
  readonly structuralPolicyVersion: typeof LIBRARY_QUARANTINE_PDF_INSPECTION_POLICY_VERSION;
  readonly xrefFormat: PdfXrefFormat;
  readonly parsedObjectCount: number;
  readonly compressedObjectStreamsParsed: number;
  readonly warningCount: 0;
  readonly encrypted: false;
  readonly activeOrExternalConstructsDetected: false;
}

export interface IsolatedPdfInspectorFailure {
  readonly ok: false;
  readonly failureReasonCode: Extract<
    LibraryQuarantineAvExecutionFailureReasonCode,
    | 'PDF_PARSER_BINARY_MISSING'
    | 'PDF_ENCRYPTED_OR_MALFORMED'
    | 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE'
    | 'PDF_INSPECTION_TIMEOUT'
    | 'PDF_INSPECTION_FAILED'
  >;
  readonly errorMessage: string;
}

export type IsolatedPdfInspectorFn = (params: {
  readonly tempFilePath: string;
  readonly expectedSha256: string;
  readonly expectedByteSize: number;
  readonly timeoutMs: number;
}) => Promise<IsolatedPdfInspectorSuccess | IsolatedPdfInspectorFailure>;

export function resolveQpdfBinaryPath(qpdfPathOverride?: string): string {
  const raw =
    (typeof qpdfPathOverride === 'string' && qpdfPathOverride.trim()) ||
    process.env[QPDF_PATH_ENV_VAR]?.trim() ||
    DEFAULT_QPDF_BINARY_PATH;
  return raw;
}

export function defaultVerifyPdfParserBinary(
  qpdfPathOverride?: string
): Promise<
  | IsolatedPdfParserBinaryVerificationResult
  | IsolatedPdfParserBinaryVerificationFailure
> {
  const qpdfPath = resolveQpdfBinaryPath(qpdfPathOverride);
  if (!fs.existsSync(qpdfPath)) {
    return Promise.resolve({
      ok: false,
      failureReasonCode: 'PDF_PARSER_BINARY_MISSING',
      errorMessage: `Required isolated qpdf binary not found at ${qpdfPath}.`,
    });
  }

  return new Promise((resolve) => {
    execFile(
      qpdfPath,
      ['--version'],
      {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        env: {
          PATH: '/usr/local/bin:/usr/bin:/bin',
        },
      },
      (error, stdout) => {
        if (error) {
          resolve({
            ok: false,
            failureReasonCode: 'PDF_PARSER_BINARY_MISSING',
            errorMessage: 'Failed verifying isolated qpdf executable.',
          });
          return;
        }
        const versionMatch = (stdout || '').match(
          /qpdf\s+version\s+([A-Za-z0-9._+-]{1,48})/i
        );
        const version = versionMatch
          ? versionMatch[1]
          : (stdout || '').trim().split(/\r?\n/)[0]?.slice(0, 48) || '';
        if (!version || !PARSER_VERSION_REGEX.test(version)) {
          resolve({
            ok: false,
            failureReasonCode: 'PDF_PARSER_BINARY_MISSING',
            errorMessage: 'qpdf --version did not emit a valid version identifier.',
          });
          return;
        }
        resolve({
          ok: true,
          parserName: 'qpdf',
          parserVersion: version,
        });
      }
    );
  });
}

export function defaultQpdfJsonRunner(params: {
  readonly qpdfPath: string;
  readonly tempFilePath: string;
  readonly timeoutMs: number;
}): Promise<QpdfJsonRunResult> {
  return new Promise((resolve) => {
    execFile(
      params.qpdfPath,
      ['--json', params.tempFilePath],
      {
        timeout: params.timeoutMs,
        maxBuffer: PDF_INSPECTION_QPDF_MAX_STDOUT_BYTES,
        env: {
          PATH: '/usr/local/bin:/usr/bin:/bin',
        },
      },
      (error, stdout, stderr) => {
        const stderrBounded = (stderr || '').slice(
          0,
          PDF_INSPECTION_QPDF_MAX_STDERR_BYTES
        );
        if (!error) {
          resolve({
            exitCode: 0,
            timedOut: false,
            spawnFailed: false,
            stdout: stdout || '',
            stderr: stderrBounded,
          });
          return;
        }
        const execErr = error as NodeJS.ErrnoException & {
          readonly killed?: boolean;
          readonly code?: unknown;
          readonly signal?: string | null;
        };
        if (execErr.killed || execErr.signal === 'SIGTERM' || execErr.signal === 'SIGKILL') {
          resolve({
            exitCode: -1,
            timedOut: true,
            spawnFailed: false,
            stdout: '',
            stderr: stderrBounded,
          });
          return;
        }
        if (execErr.code === 'ENOENT' || execErr.code === 'EACCES') {
          resolve({
            exitCode: -1,
            timedOut: false,
            spawnFailed: true,
            stdout: '',
            stderr: stderrBounded,
          });
          return;
        }
        const numericCode =
          typeof execErr.code === 'number' && Number.isSafeInteger(execErr.code)
            ? execErr.code
            : 2;
        resolve({
          exitCode: numericCode,
          timedOut: false,
          spawnFailed: false,
          stdout: stdout || '',
          stderr: stderrBounded,
        });
      }
    );
  });
}

function walkQpdfJsonObjectTree(
  node: unknown,
  depth: number,
  findings: string[]
): void {
  if (depth > PDF_INSPECTION_MAX_VALUE_NESTING_DEPTH || findings.length >= 16) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkQpdfJsonObjectTree(item, depth + 1, findings);
    }
    return;
  }
  if (typeof node === 'object' && node !== null) {
    const rec = node as Record<string, unknown>;
    const typeName = typeof rec['/Type'] === 'string' ? rec['/Type'] : null;
    for (const [k, v] of Object.entries(rec)) {
      if (k === '/Encrypt') {
        findings.push('ENCRYPTED_PDF_PROHIBITED');
      }
      if (PROHIBITED_PDF_DICTIONARY_KEYS.has(k)) {
        findings.push(`PROHIBITED_PDF_KEY:${k}`);
      }
      if (k === '/F') {
        if (
          typeof v !== 'number' ||
          typeName === '/Filespec' ||
          '/EF' in rec ||
          '/UF' in rec ||
          '/FS' in rec
        ) {
          findings.push('PROHIBITED_EXTERNAL_FILESPEC_F');
        }
      }
      if (
        (k === '/Type' || k === '/Subtype' || k === '/S') &&
        typeof v === 'string' &&
        PROHIBITED_PDF_TYPE_OR_SUBTYPE_NAMES.has(v)
      ) {
        findings.push(`PROHIBITED_TYPE_OR_ACTION:${v}`);
      }
      if (k === '/Subtype' && v === '/Link' && ('/A' in rec || '/PA' in rec)) {
        findings.push('LINK_ACTION_PROHIBITED');
      }
      walkQpdfJsonObjectTree(v, depth + 1, findings);
    }
  }
}

function evaluateQpdfJsonOutput(rawStdout: string):
  | { readonly ok: true; readonly qpdfObjectCount: number }
  | {
      readonly ok: false;
      readonly failureReasonCode: Extract<
        LibraryQuarantineAvExecutionFailureReasonCode,
        | 'PDF_ENCRYPTED_OR_MALFORMED'
        | 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE'
        | 'PDF_INSPECTION_FAILED'
      >;
      readonly errorMessage: string;
    } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawStdout);
  } catch {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'qpdf --json produced unparseable JSON output.',
    };
  }
  if (!isPlainRecord(parsed)) {
    return {
      ok: false,
      failureReasonCode: 'PDF_INSPECTION_FAILED',
      errorMessage: 'qpdf --json root value must be an object.',
    };
  }

  // Reject any qpdf warnings, encryption metadata, or password flags
  if (Array.isArray(parsed.warnings) && parsed.warnings.length > 0) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'qpdf emitted structural warnings on PDF input.',
    };
  }
  if (
    parsed.encrypt !== undefined &&
    parsed.encrypt !== null &&
    parsed.encrypt !== false
  ) {
    if (!isPlainRecord(parsed.encrypt) || parsed.encrypt.encrypted !== false) {
      return {
        ok: false,
        failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
        errorMessage: 'qpdf reported encryption parameters on PDF input.',
      };
    }
  }

  // Support both qpdf JSON v2 (`objects`) and v1 (`qpdf: [meta, objects]`)
  let objectsMap: Record<string, unknown> | null = null;
  if (isPlainRecord(parsed.objects)) {
    objectsMap = parsed.objects;
  } else if (Array.isArray(parsed.qpdf) && parsed.qpdf.length >= 2) {
    const meta = parsed.qpdf[0];
    if (isPlainRecord(meta)) {
      if (meta.isencrypted === true) {
        return {
          ok: false,
          failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
          errorMessage: 'qpdf reported encrypted PDF.',
        };
      }
    }
    if (isPlainRecord(parsed.qpdf[1])) {
      objectsMap = parsed.qpdf[1];
    }
  }

  if (!objectsMap || !('trailer' in objectsMap)) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'qpdf --json output is missing trailer/objects structure.',
    };
  }

  const findings: string[] = [];
  walkQpdfJsonObjectTree(objectsMap, 0, findings);
  if (findings.some((f) => f === 'ENCRYPTED_PDF_PROHIBITED')) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'Encrypted PDF trailer or object detected by qpdf.',
    };
  }
  if (findings.length > 0) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE',
      errorMessage: `Prohibited PDF structure detected in qpdf JSON (${findings[0]}).`,
    };
  }

  const qpdfObjectCount = Object.keys(objectsMap).filter((k) =>
    k.startsWith('obj:')
  ).length;
  if (qpdfObjectCount < 2) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: 'PDF must contain at least Catalog and Pages objects.',
    };
  }

  return { ok: true, qpdfObjectCount };
}

export async function defaultRunIsolatedPdfInspection(
  params: {
    readonly tempFilePath: string;
    readonly expectedSha256: string;
    readonly expectedByteSize: number;
    readonly timeoutMs: number;
  },
  deps?: {
    readonly qpdfPath?: string;
    readonly binaryVerifier?: VerifyPdfParserBinaryFn;
    readonly qpdfRunner?: QpdfJsonRunnerFn;
  }
): Promise<IsolatedPdfInspectorSuccess | IsolatedPdfInspectorFailure> {
  const verifyFn = deps?.binaryVerifier ?? defaultVerifyPdfParserBinary;
  const binRes = await verifyFn(deps?.qpdfPath);
  if (!binRes.ok) {
    return binRes;
  }

  let fileBytes: Buffer;
  try {
    const stat = fs.statSync(params.tempFilePath);
    if (
      !stat.isFile() ||
      stat.size !== params.expectedByteSize ||
      stat.size > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
    ) {
      return {
        ok: false,
        failureReasonCode: 'PDF_INSPECTION_FAILED',
        errorMessage: 'Temporary PDF size did not match expected receipt byteSize.',
      };
    }
    fileBytes = fs.readFileSync(params.tempFilePath);
  } catch {
    return {
      ok: false,
      failureReasonCode: 'PDF_INSPECTION_FAILED',
      errorMessage: 'Failed reading streamed PDF workspace file for structural inspection.',
    };
  }

  const actualSha = createHash('sha256').update(fileBytes).digest('hex');
  if (actualSha !== params.expectedSha256) {
    return {
      ok: false,
      failureReasonCode: 'PDF_INSPECTION_FAILED',
      errorMessage: 'Temporary PDF SHA-256 verification failed prior to PDF inspection.',
    };
  }

  const runFn = deps?.qpdfRunner ?? defaultQpdfJsonRunner;
  const qpdfPath = resolveQpdfBinaryPath(deps?.qpdfPath);
  const qpdfRun = await runFn({
    qpdfPath,
    tempFilePath: params.tempFilePath,
    timeoutMs: params.timeoutMs,
  });

  if (qpdfRun.spawnFailed) {
    return {
      ok: false,
      failureReasonCode: 'PDF_PARSER_BINARY_MISSING',
      errorMessage: 'Failed spawning isolated qpdf executable.',
    };
  }
  if (qpdfRun.timedOut) {
    return {
      ok: false,
      failureReasonCode: 'PDF_INSPECTION_TIMEOUT',
      errorMessage: 'Isolated qpdf PDF inspection timed out.',
    };
  }
  // Exit code 3 means qpdf emitted warnings / structural recovery — fail closed conservatively.
  if (qpdfRun.exitCode !== 0 || qpdfRun.stderr.trim().length > 0) {
    return {
      ok: false,
      failureReasonCode: 'PDF_ENCRYPTED_OR_MALFORMED',
      errorMessage: `qpdf exited with code ${qpdfRun.exitCode} or non-empty diagnostic stderr.`,
    };
  }

  const qpdfJsonRes = evaluateQpdfJsonOutput(qpdfRun.stdout);
  if (!qpdfJsonRes.ok) {
    return qpdfJsonRes;
  }

  // Layer 2: In-process genuine PDF xref + /Type /XRef + compressed /ObjStm parser & policy check
  const structuralRes = inspectPdfBytesStructurally(fileBytes);
  if (!structuralRes.ok) {
    return structuralRes;
  }

  return {
    ok: true,
    parserName: binRes.parserName,
    parserVersion: binRes.parserVersion,
    structuralPolicyVersion: LIBRARY_QUARANTINE_PDF_INSPECTION_POLICY_VERSION,
    xrefFormat: structuralRes.xrefFormat,
    parsedObjectCount: Math.max(
      structuralRes.parsedObjectCount,
      qpdfJsonRes.qpdfObjectCount
    ),
    compressedObjectStreamsParsed: structuralRes.compressedObjectStreamsParsed,
    warningCount: 0,
    encrypted: false,
    activeOrExternalConstructsDetected: false,
  };
}
