import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  type LibraryUploadCanonicalMimeType,
  type LibraryUploadPreliminaryFormat,
} from './libraryUploadBinaryAdmission';
import {
  inspectLibraryUploadDeepStructure,
  type LibraryUploadDeepStructureRejectionCode,
} from './libraryUploadDeepStructure';

/**
 * LIB-FILE-02A — Private Quarantine Identity & Durable Receipt Contract
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Pure server-side protocol for library document quarantine identity, receipt
 *   lifecycle state transitions, ambiguous-write reconciliation, and sanitized
 *   administrative readback.
 * - Performs ZERO live Firebase Storage, Firestore, network, or PEIA operations.
 * - Quarantine receipt IDs are generated exclusively on the server using 128-bit
 *   cryptographically secure random bytes (`node:crypto` `randomBytes(16)` ->
 *   32 lowercase hex characters).
 * - Internal quarantine storage paths follow the strict server-only pattern:
 *     `library/quarantine/<32-lowercase-hex-id>/source.<pdf|docx>`
 *   Original filenames, user IDs, and caller-supplied paths are NEVER embedded
 *   in the storage path.
 * - `Quarantined` means private server-controlled quarantine storage ONLY. It
 *   NEVER implies `isSanitized`, `isVerifiedSafe`, `isRightsApproved`,
 *   `isPublished`, or `isReadyForPeia`.
 * - Sanitized administrative DTOs redact `storagePath`, `generation`, raw bytes,
 *   credentials, download tokens, and URLs.
 */

export const LIBRARY_QUARANTINE_RECEIPT_ID_BYTE_LENGTH = 16 as const;
export const LIBRARY_QUARANTINE_RECEIPT_ID_HEX_LENGTH = 32 as const;
export const LIBRARY_QUARANTINE_STORAGE_PREFIX = 'library/quarantine' as const;

export const LibraryQuarantineReceiptState = {
  Reserved: 'Reserved',
  WritePending: 'WritePending',
  Quarantined: 'Quarantined',
  NeedsReconciliation: 'NeedsReconciliation',
  Rejected: 'Rejected',
} as const;

export type LibraryQuarantineReceiptState =
  (typeof LibraryQuarantineReceiptState)[keyof typeof LibraryQuarantineReceiptState];

export type LibraryQuarantineEligibleInspectionStatus =
  | 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
  | 'PDF_REQUIRES_ISOLATED_PARSER';

export type LibraryQuarantineContractErrorCode =
  | 'INVALID_CONTRACT_INPUT'
  | 'UNTRUSTED_CALLER_FIELD'
  | 'INVALID_UPLOADER_UID'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_RECEIPT_ID'
  | 'INVALID_STORAGE_PATH'
  | 'INVALID_RECEIPT_RECORD'
  | 'BINARY_ADMISSION_OR_STRUCTURE_REJECTED'
  | 'IMMUTABLE_IDENTITY_MISMATCH'
  | 'INVALID_LIFECYCLE_TRANSITION'
  | 'INVALID_STORAGE_ATTESTATION'
  | 'STORAGE_ATTESTATION_MISMATCH'
  | 'INVALID_RECONCILIATION_REASON'
  | 'INVALID_REJECTION_REASON'
  | 'SECURITY_INVARIANT_VIOLATION';

export type LibraryQuarantineTransitionDisposition =
  | 'TRANSITIONED'
  | 'IDEMPOTENT_NOOP';

export interface ParsedLibraryQuarantineStoragePath {
  readonly storagePath: string;
  readonly receiptId: string;
  readonly format: LibraryUploadPreliminaryFormat;
  readonly canonicalExtension: 'pdf' | 'docx';
  readonly canonicalMimeType: LibraryUploadCanonicalMimeType;
}

export interface LibraryQuarantineInternalReceipt {
  readonly receiptId: string;
  readonly uploaderUid: string;
  readonly originalFilename: string;
  readonly sanitizedFilename: string;
  readonly format: LibraryUploadPreliminaryFormat;
  readonly canonicalExtension: 'pdf' | 'docx';
  readonly canonicalMimeType: LibraryUploadCanonicalMimeType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly deepInspectionStatus: LibraryQuarantineEligibleInspectionStatus;
  readonly storagePath: string;
  readonly state: LibraryQuarantineReceiptState;
  readonly generation: string | null;
  readonly reconciliationReason: string | null;
  readonly rejectionReasonCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SanitizedLibraryQuarantineAdminReceiptDto {
  readonly receiptId: string;
  readonly uploaderUid: string;
  readonly originalFilename: string;
  readonly sanitizedFilename: string;
  readonly format: LibraryUploadPreliminaryFormat;
  readonly canonicalExtension: 'pdf' | 'docx';
  readonly canonicalMimeType: LibraryUploadCanonicalMimeType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly state: LibraryQuarantineReceiptState;
  readonly deepInspectionStatus: LibraryQuarantineEligibleInspectionStatus;
  readonly hasVerifiedStorageWrite: boolean;
  readonly reconciliationRequired: boolean;
  readonly reconciliationReason: string | null;
  readonly rejectionReasonCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isQuarantinedPrivateOnly: boolean;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface ReserveLibraryQuarantineReceiptInput {
  readonly uploaderUid: string;
  readonly originalFilename: string;
  readonly claimedMimeType?: string | null;
  readonly bytes: Buffer | Uint8Array;
  readonly nowIso: string;
}

export interface TrustedStorageReadbackAttestation {
  readonly attestedReceiptId: string;
  readonly attestedUploaderUid: string;
  readonly attestedStoragePath: string;
  readonly attestedFormat: LibraryUploadPreliminaryFormat;
  readonly attestedContentType: string;
  readonly attestedByteSize: number;
  readonly attestedSha256: string;
  readonly attestedGeneration: string;
  readonly verifiedAtIso: string;
}

export interface BeginLibraryQuarantineWritePendingInput {
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly actorUid: string;
  readonly expectedReceiptId?: string;
  readonly expectedSha256?: string;
  readonly nowIso: string;
}

export interface ConfirmLibraryQuarantineWriteInput {
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly actorUid: string;
  readonly attestation: TrustedStorageReadbackAttestation;
}

export interface MarkLibraryQuarantineNeedsReconciliationInput {
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly actorUid: string;
  readonly reconciliationReason: string;
  readonly nowIso: string;
}

export interface ReconcileLibraryQuarantineWithAttestationInput {
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly actorUid: string;
  readonly attestation: TrustedStorageReadbackAttestation;
}

export interface RejectLibraryQuarantineReceiptInput {
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly actorUid: string;
  readonly rejectionReasonCode: string;
  readonly nowIso: string;
}

export interface LibraryQuarantineContractFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineContractErrorCode;
  readonly errorMessage: string;
  readonly binaryRejectionCode?: LibraryUploadDeepStructureRejectionCode;
}

export interface ReserveLibraryQuarantineReceiptSuccess {
  readonly ok: true;
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
}

export type ReserveLibraryQuarantineReceiptResult =
  | ReserveLibraryQuarantineReceiptSuccess
  | LibraryQuarantineContractFailure;

export interface LibraryQuarantineTransitionSuccess {
  readonly ok: true;
  readonly disposition: LibraryQuarantineTransitionDisposition;
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
}

export type LibraryQuarantineTransitionResult =
  | LibraryQuarantineTransitionSuccess
  | LibraryQuarantineContractFailure;

const RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const CANONICAL_QUARANTINE_PATH_REGEX =
  /^library\/quarantine\/([0-9a-f]{32})\/source\.(pdf|docx)$/;
const ISO_8601_UTC_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const CONTROL_OR_BIDI_CHAR_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;
const UPLOADER_UID_REGEX = /^[A-Za-z0-9_.:@-]{1,128}$/;
const STORAGE_GENERATION_REGEX = /^[A-Za-z0-9_.:-]{1,128}$/;
const REJECTION_REASON_CODE_REGEX = /^[A-Z0-9_]{3,80}$/;

const ALLOWED_RESERVE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'uploaderUid',
  'originalFilename',
  'claimedMimeType',
  'bytes',
  'nowIso',
]);

const ALLOWED_INTERNAL_RECEIPT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'uploaderUid',
  'originalFilename',
  'sanitizedFilename',
  'format',
  'canonicalExtension',
  'canonicalMimeType',
  'byteSize',
  'sha256',
  'deepInspectionStatus',
  'storagePath',
  'state',
  'generation',
  'reconciliationReason',
  'rejectionReasonCode',
  'createdAt',
  'updatedAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_ATTESTATION_KEYS: ReadonlySet<string> = new Set([
  'attestedReceiptId',
  'attestedUploaderUid',
  'attestedStoragePath',
  'attestedFormat',
  'attestedContentType',
  'attestedByteSize',
  'attestedSha256',
  'attestedGeneration',
  'verifiedAtIso',
]);

const ALLOWED_BEGIN_WRITE_KEYS: ReadonlySet<string> = new Set([
  'receipt',
  'actorUid',
  'expectedReceiptId',
  'expectedSha256',
  'nowIso',
]);

const ALLOWED_CONFIRM_WRITE_KEYS: ReadonlySet<string> = new Set([
  'receipt',
  'actorUid',
  'attestation',
]);

const ALLOWED_NEEDS_RECONCILIATION_KEYS: ReadonlySet<string> = new Set([
  'receipt',
  'actorUid',
  'reconciliationReason',
  'nowIso',
]);

const ALLOWED_REJECT_RECEIPT_KEYS: ReadonlySet<string> = new Set([
  'receipt',
  'actorUid',
  'rejectionReasonCode',
  'nowIso',
]);

const VALID_RECEIPT_STATES: ReadonlySet<string> = new Set([
  LibraryQuarantineReceiptState.Reserved,
  LibraryQuarantineReceiptState.WritePending,
  LibraryQuarantineReceiptState.Quarantined,
  LibraryQuarantineReceiptState.NeedsReconciliation,
  LibraryQuarantineReceiptState.Rejected,
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function makeFailure(
  errorCode: LibraryQuarantineContractErrorCode,
  errorMessage: string,
  binaryRejectionCode?: LibraryUploadDeepStructureRejectionCode
): LibraryQuarantineContractFailure {
  const base: LibraryQuarantineContractFailure =
    binaryRejectionCode !== undefined
      ? {
          ok: false,
          errorCode,
          errorMessage,
          binaryRejectionCode,
        }
      : {
          ok: false,
          errorCode,
          errorMessage,
        };
  return Object.freeze(base);
}

function findUnexpectedKey(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      return key;
    }
  }
  return null;
}

export function isValidLibraryQuarantineReceiptId(
  value: unknown
): value is string {
  return typeof value === 'string' && RECEIPT_ID_REGEX.test(value);
}

export function isValidUploaderUid(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (CONTROL_OR_BIDI_CHAR_REGEX.test(value)) {
    return false;
  }
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    return false;
  }
  return UPLOADER_UID_REGEX.test(value);
}

export function isValidIsoUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_8601_UTC_REGEX.test(value)) {
    return false;
  }
  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs);
}

function isTimestampNonDecreasing(earlierIso: string, laterIso: string): boolean {
  return Date.parse(laterIso) >= Date.parse(earlierIso);
}

/**
 * Generates a cryptographically secure 128-bit (32 lowercase hex characters)
 * server quarantine receipt identifier using `node:crypto`.
 */
export function generateLibraryQuarantineReceiptId(): string {
  const id = randomBytes(LIBRARY_QUARANTINE_RECEIPT_ID_BYTE_LENGTH)
    .toString('hex')
    .toLowerCase();
  if (!isValidLibraryQuarantineReceiptId(id)) {
    throw new Error('Failed to generate valid 128-bit lowercase hex receiptId.');
  }
  return id;
}

/**
 * Derives the canonical server-only private quarantine object path:
 * `library/quarantine/<32-lowercase-hex-id>/source.<pdf|docx>`
 */
export function deriveLibraryQuarantineStoragePath(
  receiptId: unknown,
  format: unknown
):
  | { readonly ok: true; readonly parsed: ParsedLibraryQuarantineStoragePath }
  | LibraryQuarantineContractFailure {
  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    return makeFailure(
      'INVALID_RECEIPT_ID',
      'receiptId must be a server-generated 32-character lowercase hexadecimal string.'
    );
  }

  if (format !== 'PDF' && format !== 'DOCX') {
    return makeFailure(
      'INVALID_STORAGE_PATH',
      'Quarantine storage format must be strictly "PDF" or "DOCX".'
    );
  }

  const canonicalExtension = format === 'PDF' ? 'pdf' : 'docx';
  const canonicalMimeType =
    format === 'PDF' ? CANONICAL_PDF_MIME_TYPE : CANONICAL_DOCX_MIME_TYPE;
  const storagePath = `${LIBRARY_QUARANTINE_STORAGE_PREFIX}/${receiptId}/source.${canonicalExtension}`;

  return Object.freeze({
    ok: true as const,
    parsed: Object.freeze({
      storagePath,
      receiptId,
      format,
      canonicalExtension,
      canonicalMimeType,
    }),
  });
}

/**
 * Strictly validates and parses an internal library quarantine storage path.
 * Rejects user-controlled paths, original filenames, path traversal, or other namespaces.
 */
export function parseLibraryQuarantineStoragePath(
  rawStoragePath: unknown
):
  | { readonly ok: true; readonly parsed: ParsedLibraryQuarantineStoragePath }
  | LibraryQuarantineContractFailure {
  if (typeof rawStoragePath !== 'string' || rawStoragePath.length === 0) {
    return makeFailure(
      'INVALID_STORAGE_PATH',
      'Quarantine storagePath must be a non-empty string.'
    );
  }

  if (CONTROL_OR_BIDI_CHAR_REGEX.test(rawStoragePath)) {
    return makeFailure(
      'INVALID_STORAGE_PATH',
      'Quarantine storagePath contains forbidden control or bidirectional characters.'
    );
  }

  const match = CANONICAL_QUARANTINE_PATH_REGEX.exec(rawStoragePath);
  if (!match) {
    return makeFailure(
      'INVALID_STORAGE_PATH',
      'Quarantine storagePath must match exact canonical pattern "library/quarantine/<32-lowercase-hex>/source.<pdf|docx>".'
    );
  }

  const receiptId = match[1];
  const ext = match[2] as 'pdf' | 'docx';
  const format: LibraryUploadPreliminaryFormat = ext === 'pdf' ? 'PDF' : 'DOCX';
  const canonicalMimeType: LibraryUploadCanonicalMimeType =
    ext === 'pdf' ? CANONICAL_PDF_MIME_TYPE : CANONICAL_DOCX_MIME_TYPE;

  return Object.freeze({
    ok: true as const,
    parsed: Object.freeze({
      storagePath: rawStoragePath,
      receiptId,
      format,
      canonicalExtension: ext,
      canonicalMimeType,
    }),
  });
}

/**
 * Strictly validates the structural, cryptographic, and state-dependent invariants
 * of an internal `LibraryQuarantineInternalReceipt`.
 */
export function validateLibraryQuarantineInternalReceipt(
  candidate: unknown
):
  | { readonly ok: true; readonly receipt: LibraryQuarantineInternalReceipt }
  | LibraryQuarantineContractFailure {
  if (!isPlainObject(candidate)) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      'Receipt must be a plain object.'
    );
  }

  const unexpectedKey = findUnexpectedKey(
    candidate,
    ALLOWED_INTERNAL_RECEIPT_KEYS
  );
  if (unexpectedKey !== null) {
    return makeFailure(
      'UNTRUSTED_CALLER_FIELD',
      `Receipt contains unknown or untrusted field "${unexpectedKey}".`
    );
  }

  const {
    receiptId,
    uploaderUid,
    originalFilename,
    sanitizedFilename,
    format,
    canonicalExtension,
    canonicalMimeType,
    byteSize,
    sha256,
    deepInspectionStatus,
    storagePath,
    state,
    generation,
    reconciliationReason,
    rejectionReasonCode,
    createdAt,
    updatedAt,
    isSanitized,
    isVerifiedSafe,
    isRightsApproved,
    isPublished,
    isReadyForPeia,
  } = candidate;

  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    return makeFailure(
      'INVALID_RECEIPT_ID',
      'Receipt receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }

  if (!isValidUploaderUid(uploaderUid)) {
    return makeFailure(
      'INVALID_UPLOADER_UID',
      'Receipt uploaderUid is invalid or contains forbidden characters.'
    );
  }

  if (
    typeof originalFilename !== 'string' ||
    originalFilename.trim().length === 0 ||
    CONTROL_OR_BIDI_CHAR_REGEX.test(originalFilename)
  ) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      'Receipt originalFilename must be a non-empty string without control/bidi characters.'
    );
  }

  if (
    typeof sanitizedFilename !== 'string' ||
    sanitizedFilename.trim().length === 0 ||
    CONTROL_OR_BIDI_CHAR_REGEX.test(sanitizedFilename) ||
    sanitizedFilename.includes('/') ||
    sanitizedFilename.includes('\\')
  ) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      'Receipt sanitizedFilename is invalid.'
    );
  }

  if (format !== 'PDF' && format !== 'DOCX') {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      'Receipt format must be "PDF" or "DOCX".'
    );
  }

  const expectedExt = format === 'PDF' ? 'pdf' : 'docx';
  const expectedMime =
    format === 'PDF' ? CANONICAL_PDF_MIME_TYPE : CANONICAL_DOCX_MIME_TYPE;
  const expectedInspectionStatus: LibraryQuarantineEligibleInspectionStatus =
    format === 'PDF'
      ? 'PDF_REQUIRES_ISOLATED_PARSER'
      : 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';

  if (canonicalExtension !== expectedExt) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      `Receipt canonicalExtension "${String(canonicalExtension)}" does not match format "${format}".`
    );
  }

  if (canonicalMimeType !== expectedMime) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      `Receipt canonicalMimeType "${String(canonicalMimeType)}" does not match format "${format}".`
    );
  }

  if (deepInspectionStatus !== expectedInspectionStatus) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      `Receipt deepInspectionStatus "${String(deepInspectionStatus)}" does not match format "${format}".`
    );
  }

  if (
    typeof byteSize !== 'number' ||
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > 15_000_000
  ) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      'Receipt byteSize must be a positive integer within the 15,000,000-byte admission bound.'
    );
  }

  if (typeof sha256 !== 'string' || !SHA256_HEX_REGEX.test(sha256)) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      'Receipt sha256 must be a 64-character lowercase hexadecimal digest.'
    );
  }

  const parsedPathResult = parseLibraryQuarantineStoragePath(storagePath);
  if (!parsedPathResult.ok) {
    return parsedPathResult;
  }

  if (
    parsedPathResult.parsed.receiptId !== receiptId ||
    parsedPathResult.parsed.format !== format
  ) {
    return makeFailure(
      'INVALID_STORAGE_PATH',
      'Receipt storagePath does not match receiptId and format.'
    );
  }

  if (typeof state !== 'string' || !VALID_RECEIPT_STATES.has(state)) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      `Receipt state "${String(state)}" is not a valid LibraryQuarantineReceiptState.`
    );
  }

  // State-specific invariants for generation, reconciliationReason, and rejectionReasonCode
  if (state === LibraryQuarantineReceiptState.Quarantined) {
    if (
      typeof generation !== 'string' ||
      !STORAGE_GENERATION_REGEX.test(generation)
    ) {
      return makeFailure(
        'INVALID_RECEIPT_RECORD',
        'Quarantined receipt must have a non-empty verified storage generation.'
      );
    }
    if (reconciliationReason !== null || rejectionReasonCode !== null) {
      return makeFailure(
        'INVALID_RECEIPT_RECORD',
        'Quarantined receipt must have null reconciliationReason and rejectionReasonCode.'
      );
    }
  } else {
    if (generation !== null) {
      return makeFailure(
        'INVALID_RECEIPT_RECORD',
        `Receipt in state "${state}" must not carry a verified storage generation (must be null).`
      );
    }
  }

  if (state === LibraryQuarantineReceiptState.NeedsReconciliation) {
    if (
      typeof reconciliationReason !== 'string' ||
      reconciliationReason.trim().length === 0 ||
      reconciliationReason.length > 240 ||
      CONTROL_OR_BIDI_CHAR_REGEX.test(reconciliationReason) ||
      reconciliationReason.includes(parsedPathResult.parsed.storagePath)
    ) {
      return makeFailure(
        'INVALID_RECONCILIATION_REASON',
        'NeedsReconciliation receipt must carry a non-empty, bounded reconciliationReason without internal storage paths or control characters.'
      );
    }
    if (rejectionReasonCode !== null) {
      return makeFailure(
        'INVALID_RECEIPT_RECORD',
        'NeedsReconciliation receipt must have null rejectionReasonCode.'
      );
    }
  } else if (reconciliationReason !== null) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      `Receipt in state "${state}" must have null reconciliationReason.`
    );
  }

  if (state === LibraryQuarantineReceiptState.Rejected) {
    if (
      typeof rejectionReasonCode !== 'string' ||
      !REJECTION_REASON_CODE_REGEX.test(rejectionReasonCode)
    ) {
      return makeFailure(
        'INVALID_REJECTION_REASON',
        'Rejected receipt must carry a canonical uppercase rejectionReasonCode.'
      );
    }
  } else if (rejectionReasonCode !== null) {
    return makeFailure(
      'INVALID_RECEIPT_RECORD',
      `Receipt in state "${state}" must have null rejectionReasonCode.`
    );
  }

  if (!isValidIsoUtcTimestamp(createdAt) || !isValidIsoUtcTimestamp(updatedAt)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'Receipt createdAt and updatedAt must be valid ISO-8601 UTC timestamps.'
    );
  }

  if (!isTimestampNonDecreasing(createdAt, updatedAt)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'Receipt updatedAt must not be earlier than createdAt.'
    );
  }

  if (
    isSanitized !== false ||
    isVerifiedSafe !== false ||
    isRightsApproved !== false ||
    isPublished !== false ||
    isReadyForPeia !== false
  ) {
    return makeFailure(
      'SECURITY_INVARIANT_VIOLATION',
      'Quarantine receipts must never escalate isSanitized, isVerifiedSafe, isRightsApproved, isPublished, or isReadyForPeia to true.'
    );
  }

  const validatedReceipt: LibraryQuarantineInternalReceipt = Object.freeze({
    receiptId,
    uploaderUid,
    originalFilename,
    sanitizedFilename,
    format,
    canonicalExtension: parsedPathResult.parsed.canonicalExtension,
    canonicalMimeType: parsedPathResult.parsed.canonicalMimeType,
    byteSize,
    sha256,
    deepInspectionStatus: expectedInspectionStatus,
    storagePath: parsedPathResult.parsed.storagePath,
    state: state as LibraryQuarantineReceiptState,
    generation: generation as string | null,
    reconciliationReason: reconciliationReason as string | null,
    rejectionReasonCode: rejectionReasonCode as string | null,
    createdAt,
    updatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

  return Object.freeze({
    ok: true as const,
    receipt: validatedReceipt,
  });
}

/**
 * Produces a sanitized administrative receipt DTO suitable for admin readback.
 * Strictly redacts `storagePath`, `generation`, raw bytes, credentials, and URLs.
 */
export function toSanitizedLibraryQuarantineAdminReceiptDto(
  receiptInput: unknown
):
  | { readonly ok: true; readonly dto: SanitizedLibraryQuarantineAdminReceiptDto }
  | LibraryQuarantineContractFailure {
  const validated = validateLibraryQuarantineInternalReceipt(receiptInput);
  if (!validated.ok) {
    return validated;
  }

  const r = validated.receipt;
  const dto: SanitizedLibraryQuarantineAdminReceiptDto = Object.freeze({
    receiptId: r.receiptId,
    uploaderUid: r.uploaderUid,
    originalFilename: r.originalFilename,
    sanitizedFilename: r.sanitizedFilename,
    format: r.format,
    canonicalExtension: r.canonicalExtension,
    canonicalMimeType: r.canonicalMimeType,
    byteSize: r.byteSize,
    sha256: r.sha256,
    state: r.state,
    deepInspectionStatus: r.deepInspectionStatus,
    hasVerifiedStorageWrite:
      r.state === LibraryQuarantineReceiptState.Quarantined &&
      r.generation !== null,
    reconciliationRequired:
      r.state === LibraryQuarantineReceiptState.NeedsReconciliation,
    reconciliationReason: r.reconciliationReason,
    rejectionReasonCode: r.rejectionReasonCode,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    isQuarantinedPrivateOnly:
      r.state === LibraryQuarantineReceiptState.Quarantined,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

  return Object.freeze({
    ok: true as const,
    dto,
  });
}

/**
 * Reserves a new server-authoritative quarantine receipt in `Reserved` state
 * after executing `inspectLibraryUploadDeepStructure` (01A + 01B) on the actual
 * input byte slice. Never trusts caller-supplied inspection verdicts, hashes,
 * receipt IDs, or storage paths.
 */
export function reserveLibraryQuarantineReceipt(
  input: ReserveLibraryQuarantineReceiptInput
): ReserveLibraryQuarantineReceiptResult {
  if (!isPlainObject(input)) {
    return makeFailure(
      'INVALID_CONTRACT_INPUT',
      'reserveLibraryQuarantineReceipt input must be a plain object.'
    );
  }

  const unexpectedKey = findUnexpectedKey(input, ALLOWED_RESERVE_INPUT_KEYS);
  if (unexpectedKey !== null) {
    return makeFailure(
      'UNTRUSTED_CALLER_FIELD',
      `Caller-supplied field "${unexpectedKey}" is forbidden when reserving a quarantine receipt.`
    );
  }

  if (!isValidUploaderUid(input.uploaderUid)) {
    return makeFailure(
      'INVALID_UPLOADER_UID',
      'uploaderUid must be a valid non-empty identifier without path separators or control characters.'
    );
  }

  if (!isValidIsoUtcTimestamp(input.nowIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'nowIso must be a valid ISO-8601 UTC timestamp.'
    );
  }

  const deepInspection = inspectLibraryUploadDeepStructure({
    originalFilename: input.originalFilename,
    claimedMimeType: input.claimedMimeType,
    bytes: input.bytes,
  });

  if (deepInspection.status === 'REJECTED') {
    return makeFailure(
      'BINARY_ADMISSION_OR_STRUCTURE_REJECTED',
      deepInspection.reasonDetail,
      deepInspection.reasonCode
    );
  }

  const receiptId = generateLibraryQuarantineReceiptId();
  const pathResult = deriveLibraryQuarantineStoragePath(
    receiptId,
    deepInspection.format
  );
  if (!pathResult.ok) {
    return pathResult;
  }

  const receipt: LibraryQuarantineInternalReceipt = Object.freeze({
    receiptId,
    uploaderUid: input.uploaderUid,
    originalFilename: deepInspection.candidateMetadata.originalFilename,
    sanitizedFilename: deepInspection.candidateMetadata.sanitizedFilename,
    format: deepInspection.format,
    canonicalExtension: deepInspection.candidateMetadata.canonicalExtension,
    canonicalMimeType: deepInspection.candidateMetadata.expectedCanonicalMimeType,
    byteSize: deepInspection.sizeBytes,
    sha256: deepInspection.sha256,
    deepInspectionStatus: deepInspection.status,
    storagePath: pathResult.parsed.storagePath,
    state: LibraryQuarantineReceiptState.Reserved,
    generation: null,
    reconciliationReason: null,
    rejectionReasonCode: null,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });

  const dtoResult = toSanitizedLibraryQuarantineAdminReceiptDto(receipt);
  if (!dtoResult.ok) {
    return dtoResult;
  }

  return Object.freeze({
    ok: true as const,
    receipt,
    adminReceiptDto: dtoResult.dto,
  });
}

function verifyActorAndOptionalExpectations(
  receipt: LibraryQuarantineInternalReceipt,
  actorUid: unknown,
  expectedReceiptId?: unknown,
  expectedSha256?: unknown
): LibraryQuarantineContractFailure | null {
  if (!isValidUploaderUid(actorUid)) {
    return makeFailure(
      'INVALID_UPLOADER_UID',
      'actorUid must be a valid non-empty user identifier.'
    );
  }

  if (actorUid !== receipt.uploaderUid) {
    return makeFailure(
      'IMMUTABLE_IDENTITY_MISMATCH',
      'actorUid does not match the immutable receipt uploaderUid.'
    );
  }

  if (
    expectedReceiptId !== undefined &&
    expectedReceiptId !== receipt.receiptId
  ) {
    return makeFailure(
      'IMMUTABLE_IDENTITY_MISMATCH',
      'expectedReceiptId does not match the immutable receiptId.'
    );
  }

  if (expectedSha256 !== undefined && expectedSha256 !== receipt.sha256) {
    return makeFailure(
      'IMMUTABLE_IDENTITY_MISMATCH',
      'expectedSha256 does not match the immutable receipt sha256.'
    );
  }

  return null;
}

/**
 * Transitions a `Reserved` receipt to `WritePending` immediately prior to
 * initiating a conditional private storage write (`ifGenerationMatch: 0`).
 * Idempotent if already in `WritePending` with matching identity and actor.
 */
export function beginLibraryQuarantineWritePending(
  input: BeginLibraryQuarantineWritePendingInput
): LibraryQuarantineTransitionResult {
  if (!isPlainObject(input)) {
    return makeFailure(
      'INVALID_CONTRACT_INPUT',
      'beginLibraryQuarantineWritePending input must be a plain object.'
    );
  }

  const unexpectedKey = findUnexpectedKey(input, ALLOWED_BEGIN_WRITE_KEYS);
  if (unexpectedKey !== null) {
    return makeFailure(
      'UNTRUSTED_CALLER_FIELD',
      `Unexpected field "${unexpectedKey}" in beginLibraryQuarantineWritePending.`
    );
  }

  const validated = validateLibraryQuarantineInternalReceipt(input.receipt);
  if (!validated.ok) {
    return validated;
  }
  const current = validated.receipt;

  const identityErr = verifyActorAndOptionalExpectations(
    current,
    input.actorUid,
    input.expectedReceiptId,
    input.expectedSha256
  );
  if (identityErr !== null) {
    return identityErr;
  }

  if (!isValidIsoUtcTimestamp(input.nowIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'nowIso must be a valid ISO-8601 UTC timestamp.'
    );
  }

  if (!isTimestampNonDecreasing(current.updatedAt, input.nowIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'Transition timestamp nowIso cannot be earlier than current receipt updatedAt.'
    );
  }

  if (current.state === LibraryQuarantineReceiptState.WritePending) {
    const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(current);
    if (!dtoRes.ok) {
      return dtoRes;
    }
    return Object.freeze({
      ok: true as const,
      disposition: 'IDEMPOTENT_NOOP' as const,
      receipt: current,
      adminReceiptDto: dtoRes.dto,
    });
  }

  if (current.state !== LibraryQuarantineReceiptState.Reserved) {
    return makeFailure(
      'INVALID_LIFECYCLE_TRANSITION',
      `Cannot transition receipt from "${current.state}" to "WritePending"; only "Reserved" is allowed.`
    );
  }

  const nextReceipt: LibraryQuarantineInternalReceipt = Object.freeze({
    ...current,
    state: LibraryQuarantineReceiptState.WritePending,
    updatedAt: input.nowIso,
  });

  const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(nextReceipt);
  if (!dtoRes.ok) {
    return dtoRes;
  }

  return Object.freeze({
    ok: true as const,
    disposition: 'TRANSITIONED' as const,
    receipt: nextReceipt,
    adminReceiptDto: dtoRes.dto,
  });
}

function validateAndMatchStorageAttestation(
  receipt: LibraryQuarantineInternalReceipt,
  rawAttestation: unknown
):
  | { readonly ok: true; readonly attestation: TrustedStorageReadbackAttestation }
  | LibraryQuarantineContractFailure {
  if (!isPlainObject(rawAttestation)) {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'Storage readback attestation must be a plain object.'
    );
  }

  const unexpectedKey = findUnexpectedKey(
    rawAttestation,
    ALLOWED_ATTESTATION_KEYS
  );
  if (unexpectedKey !== null) {
    return makeFailure(
      'UNTRUSTED_CALLER_FIELD',
      `Unexpected field "${unexpectedKey}" in storage readback attestation.`
    );
  }

  const {
    attestedReceiptId,
    attestedUploaderUid,
    attestedStoragePath,
    attestedFormat,
    attestedContentType,
    attestedByteSize,
    attestedSha256,
    attestedGeneration,
    verifiedAtIso,
  } = rawAttestation;

  if (!isValidLibraryQuarantineReceiptId(attestedReceiptId)) {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'attestedReceiptId in storage readback attestation is malformed.'
    );
  }

  if (!isValidUploaderUid(attestedUploaderUid)) {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'attestedUploaderUid in storage readback attestation is malformed.'
    );
  }

  if (typeof attestedStoragePath !== 'string' || attestedStoragePath.length === 0) {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'attestedStoragePath in storage readback attestation is missing.'
    );
  }

  if (attestedFormat !== 'PDF' && attestedFormat !== 'DOCX') {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'attestedFormat in storage readback attestation must be "PDF" or "DOCX".'
    );
  }

  if (typeof attestedContentType !== 'string' || attestedContentType.length === 0) {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'attestedContentType in storage readback attestation is missing.'
    );
  }

  if (
    typeof attestedByteSize !== 'number' ||
    !Number.isSafeInteger(attestedByteSize) ||
    attestedByteSize <= 0
  ) {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'attestedByteSize in storage readback attestation must be a positive safe integer.'
    );
  }

  if (typeof attestedSha256 !== 'string' || !SHA256_HEX_REGEX.test(attestedSha256)) {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'attestedSha256 in storage readback attestation must be a 64-character lowercase hex digest.'
    );
  }

  if (
    typeof attestedGeneration !== 'string' ||
    !STORAGE_GENERATION_REGEX.test(attestedGeneration)
  ) {
    return makeFailure(
      'INVALID_STORAGE_ATTESTATION',
      'attestedGeneration in storage readback attestation must be a non-empty valid generation identifier.'
    );
  }

  if (!isValidIsoUtcTimestamp(verifiedAtIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'verifiedAtIso in storage readback attestation must be a valid ISO-8601 UTC timestamp.'
    );
  }

  if (!isTimestampNonDecreasing(receipt.updatedAt, verifiedAtIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'verifiedAtIso in storage readback attestation cannot be earlier than current receipt updatedAt.'
    );
  }

  // Exact matching against immutable receipt properties
  if (attestedReceiptId !== receipt.receiptId) {
    return makeFailure(
      'STORAGE_ATTESTATION_MISMATCH',
      'Attested receiptId does not match receipt.receiptId.'
    );
  }

  if (attestedUploaderUid !== receipt.uploaderUid) {
    return makeFailure(
      'STORAGE_ATTESTATION_MISMATCH',
      'Attested uploaderUid does not match receipt.uploaderUid.'
    );
  }

  if (attestedStoragePath !== receipt.storagePath) {
    return makeFailure(
      'STORAGE_ATTESTATION_MISMATCH',
      'Attested storagePath does not match receipt.storagePath.'
    );
  }

  if (attestedFormat !== receipt.format) {
    return makeFailure(
      'STORAGE_ATTESTATION_MISMATCH',
      'Attested format does not match receipt.format.'
    );
  }

  if (attestedContentType !== receipt.canonicalMimeType) {
    return makeFailure(
      'STORAGE_ATTESTATION_MISMATCH',
      'Attested contentType does not match receipt.canonicalMimeType.'
    );
  }

  if (attestedByteSize !== receipt.byteSize) {
    return makeFailure(
      'STORAGE_ATTESTATION_MISMATCH',
      `Attested byteSize (${attestedByteSize}) does not match receipt.byteSize (${receipt.byteSize}).`
    );
  }

  if (attestedSha256 !== receipt.sha256) {
    return makeFailure(
      'STORAGE_ATTESTATION_MISMATCH',
      'Attested sha256 does not match receipt.sha256.'
    );
  }

  return Object.freeze({
    ok: true as const,
    attestation: Object.freeze({
      attestedReceiptId,
      attestedUploaderUid,
      attestedStoragePath,
      attestedFormat,
      attestedContentType,
      attestedByteSize,
      attestedSha256,
      attestedGeneration,
      verifiedAtIso,
    }),
  });
}

/**
 * Transitions a `WritePending` receipt to `Quarantined` ONLY when presented with
 * a verified server-side storage readback attestation matching ownership, path,
 * format, MIME, byteSize, sha256, and non-empty generation.
 * Idempotent if already `Quarantined` with the exact same generation.
 */
export function confirmLibraryQuarantineWriteWithAttestation(
  input: ConfirmLibraryQuarantineWriteInput
): LibraryQuarantineTransitionResult {
  if (!isPlainObject(input)) {
    return makeFailure(
      'INVALID_CONTRACT_INPUT',
      'confirmLibraryQuarantineWriteWithAttestation input must be a plain object.'
    );
  }

  const unexpectedKey = findUnexpectedKey(input, ALLOWED_CONFIRM_WRITE_KEYS);
  if (unexpectedKey !== null) {
    return makeFailure(
      'UNTRUSTED_CALLER_FIELD',
      `Unexpected field "${unexpectedKey}" in confirmLibraryQuarantineWriteWithAttestation.`
    );
  }

  const validated = validateLibraryQuarantineInternalReceipt(input.receipt);
  if (!validated.ok) {
    return validated;
  }
  const current = validated.receipt;

  const identityErr = verifyActorAndOptionalExpectations(current, input.actorUid);
  if (identityErr !== null) {
    return identityErr;
  }

  const attRes = validateAndMatchStorageAttestation(current, input.attestation);
  if (!attRes.ok) {
    return attRes;
  }
  const att = attRes.attestation;

  if (current.state === LibraryQuarantineReceiptState.Quarantined) {
    if (current.generation !== att.attestedGeneration) {
      return makeFailure(
        'STORAGE_ATTESTATION_MISMATCH',
        'Quarantined receipt generation conflicts with duplicate confirmation attestation generation.'
      );
    }
    const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(current);
    if (!dtoRes.ok) {
      return dtoRes;
    }
    return Object.freeze({
      ok: true as const,
      disposition: 'IDEMPOTENT_NOOP' as const,
      receipt: current,
      adminReceiptDto: dtoRes.dto,
    });
  }

  if (current.state !== LibraryQuarantineReceiptState.WritePending) {
    return makeFailure(
      'INVALID_LIFECYCLE_TRANSITION',
      `Cannot confirm quarantine write from state "${current.state}"; receipt must be in "WritePending".`
    );
  }

  const nextReceipt: LibraryQuarantineInternalReceipt = Object.freeze({
    ...current,
    state: LibraryQuarantineReceiptState.Quarantined,
    generation: att.attestedGeneration,
    reconciliationReason: null,
    rejectionReasonCode: null,
    updatedAt: att.verifiedAtIso,
  });

  const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(nextReceipt);
  if (!dtoRes.ok) {
    return dtoRes;
  }

  return Object.freeze({
    ok: true as const,
    disposition: 'TRANSITIONED' as const,
    receipt: nextReceipt,
    adminReceiptDto: dtoRes.dto,
  });
}

/**
 * Transitions a `WritePending` receipt to `NeedsReconciliation` when a storage
 * write or metadata readback outcome is ambiguous (e.g. timeout, connection drop).
 * Preserves the exact same `receiptId` and `storagePath` so reconciliation can
 * inspect the deterministic target object without re-uploading under a new identity.
 */
export function markLibraryQuarantineWriteNeedsReconciliation(
  input: MarkLibraryQuarantineNeedsReconciliationInput
): LibraryQuarantineTransitionResult {
  if (!isPlainObject(input)) {
    return makeFailure(
      'INVALID_CONTRACT_INPUT',
      'markLibraryQuarantineWriteNeedsReconciliation input must be a plain object.'
    );
  }

  const unexpectedKey = findUnexpectedKey(
    input,
    ALLOWED_NEEDS_RECONCILIATION_KEYS
  );
  if (unexpectedKey !== null) {
    return makeFailure(
      'UNTRUSTED_CALLER_FIELD',
      `Unexpected field "${unexpectedKey}" in markLibraryQuarantineWriteNeedsReconciliation.`
    );
  }

  const validated = validateLibraryQuarantineInternalReceipt(input.receipt);
  if (!validated.ok) {
    return validated;
  }
  const current = validated.receipt;

  const identityErr = verifyActorAndOptionalExpectations(current, input.actorUid);
  if (identityErr !== null) {
    return identityErr;
  }

  if (!isValidIsoUtcTimestamp(input.nowIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'nowIso must be a valid ISO-8601 UTC timestamp.'
    );
  }

  if (!isTimestampNonDecreasing(current.updatedAt, input.nowIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'nowIso cannot be earlier than current receipt updatedAt.'
    );
  }

  if (typeof input.reconciliationReason !== 'string') {
    return makeFailure(
      'INVALID_RECONCILIATION_REASON',
      'reconciliationReason must be a non-empty string.'
    );
  }

  const trimmedReason = input.reconciliationReason.trim();
  if (
    trimmedReason.length === 0 ||
    trimmedReason.length > 240 ||
    CONTROL_OR_BIDI_CHAR_REGEX.test(trimmedReason) ||
    trimmedReason.includes(current.storagePath) ||
    trimmedReason.includes( LIBRARY_QUARANTINE_STORAGE_PREFIX )
  ) {
    return makeFailure(
      'INVALID_RECONCILIATION_REASON',
      'reconciliationReason must be 1..240 characters, free of control characters, and must not leak internal storage paths.'
    );
  }

  if (current.state === LibraryQuarantineReceiptState.NeedsReconciliation) {
    const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(current);
    if (!dtoRes.ok) {
      return dtoRes;
    }
    return Object.freeze({
      ok: true as const,
      disposition: 'IDEMPOTENT_NOOP' as const,
      receipt: current,
      adminReceiptDto: dtoRes.dto,
    });
  }

  if (current.state !== LibraryQuarantineReceiptState.WritePending) {
    return makeFailure(
      'INVALID_LIFECYCLE_TRANSITION',
      `Cannot transition receipt from "${current.state}" to "NeedsReconciliation"; only "WritePending" is allowed.`
    );
  }

  const nextReceipt: LibraryQuarantineInternalReceipt = Object.freeze({
    ...current,
    state: LibraryQuarantineReceiptState.NeedsReconciliation,
    generation: null,
    reconciliationReason: trimmedReason,
    rejectionReasonCode: null,
    updatedAt: input.nowIso,
  });

  const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(nextReceipt);
  if (!dtoRes.ok) {
    return dtoRes;
  }

  return Object.freeze({
    ok: true as const,
    disposition: 'TRANSITIONED' as const,
    receipt: nextReceipt,
    adminReceiptDto: dtoRes.dto,
  });
}

/**
 * Reconciles a `NeedsReconciliation` receipt to `Quarantined` when subsequent
 * authoritative server-side storage readback proves the object exists at the
 * deterministic quarantine path with matching ownership, format, MIME, size,
 * SHA-256, and generation.
 */
export function reconcileLibraryQuarantineReceiptWithAttestation(
  input: ReconcileLibraryQuarantineWithAttestationInput
): LibraryQuarantineTransitionResult {
  if (!isPlainObject(input)) {
    return makeFailure(
      'INVALID_CONTRACT_INPUT',
      'reconcileLibraryQuarantineReceiptWithAttestation input must be a plain object.'
    );
  }

  const unexpectedKey = findUnexpectedKey(input, ALLOWED_CONFIRM_WRITE_KEYS);
  if (unexpectedKey !== null) {
    return makeFailure(
      'UNTRUSTED_CALLER_FIELD',
      `Unexpected field "${unexpectedKey}" in reconcileLibraryQuarantineReceiptWithAttestation.`
    );
  }

  const validated = validateLibraryQuarantineInternalReceipt(input.receipt);
  if (!validated.ok) {
    return validated;
  }
  const current = validated.receipt;

  const identityErr = verifyActorAndOptionalExpectations(current, input.actorUid);
  if (identityErr !== null) {
    return identityErr;
  }

  const attRes = validateAndMatchStorageAttestation(current, input.attestation);
  if (!attRes.ok) {
    return attRes;
  }
  const att = attRes.attestation;

  if (current.state === LibraryQuarantineReceiptState.Quarantined) {
    if (current.generation !== att.attestedGeneration) {
      return makeFailure(
        'STORAGE_ATTESTATION_MISMATCH',
        'Quarantined receipt generation conflicts with reconciliation attestation generation.'
      );
    }
    const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(current);
    if (!dtoRes.ok) {
      return dtoRes;
    }
    return Object.freeze({
      ok: true as const,
      disposition: 'IDEMPOTENT_NOOP' as const,
      receipt: current,
      adminReceiptDto: dtoRes.dto,
    });
  }

  if (current.state !== LibraryQuarantineReceiptState.NeedsReconciliation) {
    return makeFailure(
      'INVALID_LIFECYCLE_TRANSITION',
      `Cannot reconcile receipt from state "${current.state}"; receipt must be in "NeedsReconciliation".`
    );
  }

  const nextReceipt: LibraryQuarantineInternalReceipt = Object.freeze({
    ...current,
    state: LibraryQuarantineReceiptState.Quarantined,
    generation: att.attestedGeneration,
    reconciliationReason: null,
    rejectionReasonCode: null,
    updatedAt: att.verifiedAtIso,
  });

  const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(nextReceipt);
  if (!dtoRes.ok) {
    return dtoRes;
  }

  return Object.freeze({
    ok: true as const,
    disposition: 'TRANSITIONED' as const,
    receipt: nextReceipt,
    adminReceiptDto: dtoRes.dto,
  });
}

/**
 * Transitions a `Reserved`, `WritePending`, or `NeedsReconciliation` receipt to
 * terminal `Rejected` state (for example, when a conditional write definitively
 * fails before storage creation or reconciliation confirms object absence/mismatch).
 * Never transitions a `Quarantined` receipt to `Rejected` without an explicit
 * future cleanup workflow.
 */
export function rejectLibraryQuarantineReceipt(
  input: RejectLibraryQuarantineReceiptInput
): LibraryQuarantineTransitionResult {
  if (!isPlainObject(input)) {
    return makeFailure(
      'INVALID_CONTRACT_INPUT',
      'rejectLibraryQuarantineReceipt input must be a plain object.'
    );
  }

  const unexpectedKey = findUnexpectedKey(input, ALLOWED_REJECT_RECEIPT_KEYS);
  if (unexpectedKey !== null) {
    return makeFailure(
      'UNTRUSTED_CALLER_FIELD',
      `Unexpected field "${unexpectedKey}" in rejectLibraryQuarantineReceipt.`
    );
  }

  const validated = validateLibraryQuarantineInternalReceipt(input.receipt);
  if (!validated.ok) {
    return validated;
  }
  const current = validated.receipt;

  const identityErr = verifyActorAndOptionalExpectations(current, input.actorUid);
  if (identityErr !== null) {
    return identityErr;
  }

  if (
    typeof input.rejectionReasonCode !== 'string' ||
    !REJECTION_REASON_CODE_REGEX.test(input.rejectionReasonCode)
  ) {
    return makeFailure(
      'INVALID_REJECTION_REASON',
      'rejectionReasonCode must be a canonical uppercase code (3..80 chars, A-Z0-9_).'
    );
  }

  if (!isValidIsoUtcTimestamp(input.nowIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'nowIso must be a valid ISO-8601 UTC timestamp.'
    );
  }

  if (!isTimestampNonDecreasing(current.updatedAt, input.nowIso)) {
    return makeFailure(
      'INVALID_TIMESTAMP',
      'nowIso cannot be earlier than current receipt updatedAt.'
    );
  }

  if (current.state === LibraryQuarantineReceiptState.Rejected) {
    if (current.rejectionReasonCode !== input.rejectionReasonCode) {
      return makeFailure(
        'INVALID_LIFECYCLE_TRANSITION',
        `Receipt is already Rejected with code "${current.rejectionReasonCode}" and cannot be re-rejected with a different code "${input.rejectionReasonCode}".`
      );
    }
    const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(current);
    if (!dtoRes.ok) {
      return dtoRes;
    }
    return Object.freeze({
      ok: true as const,
      disposition: 'IDEMPOTENT_NOOP' as const,
      receipt: current,
      adminReceiptDto: dtoRes.dto,
    });
  }

  if (current.state === LibraryQuarantineReceiptState.Quarantined) {
    return makeFailure(
      'INVALID_LIFECYCLE_TRANSITION',
      'Cannot directly reject a Quarantined receipt that has a verified private storage object.'
    );
  }

  const nextReceipt: LibraryQuarantineInternalReceipt = Object.freeze({
    ...current,
    state: LibraryQuarantineReceiptState.Rejected,
    generation: null,
    reconciliationReason: null,
    rejectionReasonCode: input.rejectionReasonCode,
    updatedAt: input.nowIso,
  });

  const dtoRes = toSanitizedLibraryQuarantineAdminReceiptDto(nextReceipt);
  if (!dtoRes.ok) {
    return dtoRes;
  }

  return Object.freeze({
    ok: true as const,
    disposition: 'TRANSITIONED' as const,
    receipt: nextReceipt,
    adminReceiptDto: dtoRes.dto,
  });
}
