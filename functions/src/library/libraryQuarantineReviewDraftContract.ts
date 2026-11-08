import {
  LibraryQuarantineReceiptState,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  type LibraryQuarantineEligibleInspectionStatus,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';
import type { SanitizedLibraryQuarantineReceiptListItemDto } from './libraryQuarantineAdminReadService';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
  type LibraryUploadCanonicalMimeType,
  type LibraryUploadPreliminaryFormat,
} from './libraryUploadBinaryAdmission';

/**
 * LIB-FILE-REVIEW-01A — Pure Internal Quarantine Review Candidate Contract
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Pure, deterministic, in-memory server-side contract that assesses whether a
 *   `SanitizedLibraryQuarantineReceiptListItemDto` (`{ revision, adminReceipt }`)
 *   satisfies all structural, cryptographic, and posture preconditions to form an
 *   internal `LibraryQuarantineReviewCandidate` (`decision: 'PENDING_HUMAN_REVIEW'`).
 * - NOT A SECURITY ENTITLEMENT OR FRESHNESS GUARANTEE:
 *   A sanitized DTO in memory is never sufficient on its own to authorize durable
 *   draft creation, rights clearance, or publication. Any subsequent persistence
 *   layer MUST re-read the authoritative Firestore envelope in
 *   `library_quarantine_receipts/<receiptId>` and verify live Google Cloud Storage
 *   readback attestation on the server before executing a compare-and-swap (CAS)
 *   transaction.
 * - STRICT ISOLATION FROM URL-BASED INTAKE & PUBLIC ENTITIES:
 *   Never fabricates or links to `LibraryIntakeRecord.url`, public `LibraryDocument`
 *   entities, signed URLs, download tokens, `storagePath`, `generation`, or raw file
 *   bytes.
 * - EXPLICIT NON-ASSURANCE POSTURE:
 *   Every eligible candidate preserves `isSanitized: false`, `isVerifiedSafe: false`,
 *   `isRightsApproved: false`, `isPublished: false`, and `isReadyForPeia: false`,
 *   alongside the explicit deferred security/governance gates.
 */

export const LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES = Object.freeze([
  'DURABLE_DRAFT_LINK_NOT_WIRED',
  'HUMAN_REVIEW_UI_NOT_WIRED',
  'PDF_ISOLATED_PARSER_REQUIRED',
  'DOCX_SANITIZATION_PENDING',
  'RIGHTS_UNVERIFIED',
  'NEEDS_RECONCILIATION_HOLD',
  'NO_AUTO_PUBLICATION',
] as const);

export type LibraryQuarantineReviewDraftDeferredGate =
  (typeof LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES)[number];

export type LibraryQuarantineReviewCandidateRejectionCode =
  | 'INVALID_ASSESSMENT_INPUT'
  | 'UNTRUSTED_OR_SECRET_FIELD_DETECTED'
  | 'INVALID_SOURCE_REVISION'
  | 'INVALID_RECEIPT_ID'
  | 'INVALID_UPLOADER_UID'
  | 'INVALID_FILENAME'
  | 'NEEDS_RECONCILIATION_HOLD'
  | 'RECEIPT_STATE_NOT_ELIGIBLE'
  | 'UNVERIFIED_QUARANTINE_STORAGE_POSTURE'
  | 'SECURITY_POSTURE_ESCALATION_DETECTED'
  | 'INVALID_FILE_FORMAT_OR_MIME'
  | 'INVALID_BYTE_SIZE'
  | 'INVALID_SHA256_DIGEST'
  | 'INVALID_SOURCE_TIMESTAMPS'
  | 'SOURCE_VERSION_OR_DIGEST_MISMATCH';

export interface LibraryQuarantineReviewCandidate {
  readonly candidateKind: 'QUARANTINE_PRIVATE_REVIEW_CANDIDATE';
  readonly decision: 'PENDING_HUMAN_REVIEW';
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly sourceCreatedAt: string;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly sourceByteSize: number;
  readonly sourceFormat: LibraryUploadPreliminaryFormat;
  readonly sourceCanonicalExtension: 'pdf' | 'docx';
  readonly sourceCanonicalMimeType: LibraryUploadCanonicalMimeType;
  readonly sourceDeepInspectionStatus: LibraryQuarantineEligibleInspectionStatus;
  readonly uploaderUid: string;
  readonly sourceOriginalFilename: string;
  readonly sourceSanitizedFilename: string;
  readonly isQuarantinedPrivateOnly: true;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
  readonly deferredGates: readonly LibraryQuarantineReviewDraftDeferredGate[];
}

export interface LibraryQuarantineReviewSourceExpectations {
  readonly expectedReceiptId?: string;
  readonly expectedRevision?: number;
  readonly expectedSha256?: string;
  readonly expectedUpdatedAt?: string;
}

export interface AssessLibraryQuarantineReviewCandidateSuccess {
  readonly ok: true;
  readonly status: 'ELIGIBLE_FOR_HUMAN_REVIEW_CANDIDATE';
  readonly candidate: LibraryQuarantineReviewCandidate;
}

export interface AssessLibraryQuarantineReviewCandidateFailure {
  readonly ok: false;
  readonly status: 'REJECTED';
  readonly reasonCode: LibraryQuarantineReviewCandidateRejectionCode;
  readonly errorMessage: string;
}

export type AssessLibraryQuarantineReviewCandidateResult =
  | AssessLibraryQuarantineReviewCandidateSuccess
  | AssessLibraryQuarantineReviewCandidateFailure;

const SHA256_LOWERCASE_HEX_REGEX = /^[0-9a-f]{64}$/;
const CONTROL_OR_BIDI_CHAR_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;
const HTML_OR_SCRIPT_FRAGMENT_REGEX = /<|>|javascript:|data:|vbscript:/i;
const MAX_SAFE_FILENAME_LENGTH = 180 as const;

const ALLOWED_LIST_ITEM_KEYS: ReadonlySet<string> = new Set([
  'revision',
  'adminReceipt',
]);

const ALLOWED_ADMIN_RECEIPT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'uploaderUid',
  'originalFilename',
  'sanitizedFilename',
  'format',
  'canonicalExtension',
  'canonicalMimeType',
  'byteSize',
  'sha256',
  'state',
  'deepInspectionStatus',
  'hasVerifiedStorageWrite',
  'reconciliationRequired',
  'reconciliationReason',
  'rejectionReasonCode',
  'createdAt',
  'updatedAt',
  'isQuarantinedPrivateOnly',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_EXPECTATIONS_KEYS: ReadonlySet<string> = new Set([
  'expectedReceiptId',
  'expectedRevision',
  'expectedSha256',
  'expectedUpdatedAt',
]);

const FORBIDDEN_SECRET_OR_INTERNAL_KEYS: ReadonlySet<string> = new Set([
  'storagePath',
  'generation',
  'bucket',
  'url',
  'normalizedUrl',
  'signedUrl',
  'downloadUrl',
  'mediaLink',
  'downloadTokens',
  'token',
  'accessToken',
  'bytes',
  'rawBytes',
  'buffer',
]);

const ALLOWED_CANDIDATE_KEYS: ReadonlySet<string> = new Set([
  'candidateKind',
  'decision',
  'receiptId',
  'sourceRevision',
  'sourceCreatedAt',
  'sourceUpdatedAt',
  'sourceSha256',
  'sourceByteSize',
  'sourceFormat',
  'sourceCanonicalExtension',
  'sourceCanonicalMimeType',
  'sourceDeepInspectionStatus',
  'uploaderUid',
  'sourceOriginalFilename',
  'sourceSanitizedFilename',
  'isQuarantinedPrivateOnly',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
  'deferredGates',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function makeRejection(
  reasonCode: LibraryQuarantineReviewCandidateRejectionCode,
  errorMessage: string
): AssessLibraryQuarantineReviewCandidateFailure {
  return Object.freeze({
    ok: false as const,
    status: 'REJECTED' as const,
    reasonCode,
    errorMessage,
  });
}

function isBinaryLikeValue(value: unknown): boolean {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return true;
  }
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function containsLeakedSecretOrStoragePattern(
  value: unknown,
  depth = 0
): boolean {
  if (depth > 6 || value === null || value === undefined) {
    return false;
  }
  if (isBinaryLikeValue(value)) {
    return true;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return (
      lower.includes('library/quarantine/') ||
      lower.includes('library-quarantine/') ||
      lower.includes('gs://') ||
      lower.includes('http://') ||
      lower.includes('https://') ||
      lower.includes('storage.googleapis.com') ||
      lower.includes('firebasestorage.googleapis.com')
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) =>
      containsLeakedSecretOrStoragePattern(item, depth + 1)
    );
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_SECRET_OR_INTERNAL_KEYS.has(key)) {
        return true;
      }
      if (containsLeakedSecretOrStoragePattern(record[key], depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function normalizeAndValidateDisplayFilename(
  rawFilename: unknown,
  expectedExtension: 'pdf' | 'docx',
  requireNoSpacesOrUnsafeChars: boolean
): string | null {
  if (typeof rawFilename !== 'string') {
    return null;
  }
  const normalized = rawFilename.normalize('NFC').trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_SAFE_FILENAME_LENGTH ||
    normalized !== rawFilename.trim()
  ) {
    return null;
  }
  if (
    CONTROL_OR_BIDI_CHAR_REGEX.test(normalized) ||
    HTML_OR_SCRIPT_FRAGMENT_REGEX.test(normalized)
  ) {
    return null;
  }
  if (
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('..') ||
    normalized.startsWith('.')
  ) {
    return null;
  }

  const lower = normalized.toLowerCase();
  const suffix = `.${expectedExtension}`;
  if (!lower.endsWith(suffix) || normalized.length <= suffix.length) {
    return null;
  }

  if (requireNoSpacesOrUnsafeChars) {
    // Sanitized filename must not contain HTML, quotes, or path/query delimiters
    if (/["'`?#*<>|:]/.test(normalized)) {
      return null;
    }
  }

  return normalized;
}

/**
 * Pure, deterministic assessment of a `SanitizedLibraryQuarantineReceiptListItemDto`
 * to produce an internal `LibraryQuarantineReviewCandidate` (`PENDING_HUMAN_REVIEW`).
 *
 * Fails closed without side effects or secret leakage on any non-Quarantined state,
 * `NeedsReconciliation` hold, unverified write flag, escalated posture flag,
 * invalid revision/hash/size/format/MIME/timestamp/UID/filename, or leaked internal field.
 */
export function assessLibraryQuarantineReviewCandidate(
  input: SanitizedLibraryQuarantineReceiptListItemDto | unknown,
  expectations?: LibraryQuarantineReviewSourceExpectations
): AssessLibraryQuarantineReviewCandidateResult {
  if (!isPlainObject(input)) {
    return makeRejection(
      'INVALID_ASSESSMENT_INPUT',
      'Assessment input must be a plain object containing revision and adminReceipt.'
    );
  }

  if (containsLeakedSecretOrStoragePattern(input)) {
    return makeRejection(
      'UNTRUSTED_OR_SECRET_FIELD_DETECTED',
      'Assessment input contains forbidden storage paths, generations, URLs, binary payloads, or secret keys.'
    );
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_LIST_ITEM_KEYS.has(key)) {
      return makeRejection(
        'UNTRUSTED_OR_SECRET_FIELD_DETECTED',
        'Assessment input contains unknown or untrusted top-level fields.'
      );
    }
  }

  if (!('revision' in input) || !('adminReceipt' in input)) {
    return makeRejection(
      'INVALID_ASSESSMENT_INPUT',
      'Assessment input is missing required revision or adminReceipt property.'
    );
  }

  if (expectations !== undefined) {
    if (!isPlainObject(expectations)) {
      return makeRejection(
        'INVALID_ASSESSMENT_INPUT',
        'Optional source expectations must be a plain object.'
      );
    }
    for (const key of Object.keys(expectations)) {
      if (!ALLOWED_EXPECTATIONS_KEYS.has(key)) {
        return makeRejection(
          'UNTRUSTED_OR_SECRET_FIELD_DETECTED',
          'Source expectations object contains unknown or untrusted fields.'
        );
      }
    }
  }

  const rawRevision = input.revision;
  if (
    typeof rawRevision !== 'number' ||
    !Number.isSafeInteger(rawRevision) ||
    rawRevision < 1
  ) {
    return makeRejection(
      'INVALID_SOURCE_REVISION',
      'Source receipt revision must be a positive safe integer (>= 1).'
    );
  }

  const rawReceipt = input.adminReceipt;
  if (!isPlainObject(rawReceipt)) {
    return makeRejection(
      'INVALID_ASSESSMENT_INPUT',
      'adminReceipt must be a plain object.'
    );
  }

  for (const key of Object.keys(rawReceipt)) {
    if (!ALLOWED_ADMIN_RECEIPT_KEYS.has(key)) {
      return makeRejection(
        'UNTRUSTED_OR_SECRET_FIELD_DETECTED',
        'adminReceipt contains unknown or untrusted fields.'
      );
    }
  }

  for (const requiredKey of ALLOWED_ADMIN_RECEIPT_KEYS) {
    if (!(requiredKey in rawReceipt)) {
      return makeRejection(
        'INVALID_ASSESSMENT_INPUT',
        'adminReceipt is missing one or more required contract properties.'
      );
    }
  }

  const receipt =
    rawReceipt as unknown as SanitizedLibraryQuarantineAdminReceiptDto;

  // 1. Validate receiptId
  if (!isValidLibraryQuarantineReceiptId(receipt.receiptId)) {
    return makeRejection(
      'INVALID_RECEIPT_ID',
      'receiptId must be a 32-character lowercase hexadecimal identifier.'
    );
  }

  // 2. Validate uploaderUid
  if (!isValidUploaderUid(receipt.uploaderUid)) {
    return makeRejection(
      'INVALID_UPLOADER_UID',
      'uploaderUid must be a non-empty canonical user identifier without path or control characters.'
    );
  }

  // 3. Enforce NeedsReconciliation hold first (even if other flags claim verified storage)
  if (
    receipt.state === LibraryQuarantineReceiptState.NeedsReconciliation ||
    receipt.reconciliationRequired !== false ||
    receipt.reconciliationReason !== null
  ) {
    return makeRejection(
      'NEEDS_RECONCILIATION_HOLD',
      'Receipt is under NeedsReconciliation hold and cannot form a review candidate.'
    );
  }

  // 4. Enforce exact Quarantined state (blocks Reserved, WritePending, Rejected, and unknown states)
  if (receipt.state !== LibraryQuarantineReceiptState.Quarantined) {
    return makeRejection(
      'RECEIPT_STATE_NOT_ELIGIBLE',
      'Only receipts in exact Quarantined state are eligible for review candidate assessment.'
    );
  }

  // 5. Enforce verified private quarantine storage posture & null rejectionReasonCode
  if (
    receipt.hasVerifiedStorageWrite !== true ||
    receipt.isQuarantinedPrivateOnly !== true ||
    receipt.rejectionReasonCode !== null
  ) {
    return makeRejection(
      'UNVERIFIED_QUARANTINE_STORAGE_POSTURE',
      'Receipt lacks verified private quarantine storage posture or carries a rejection reason.'
    );
  }

  // 6. Enforce all 5 non-assurance security/governance flags are strictly false
  if (
    receipt.isSanitized !== false ||
    receipt.isVerifiedSafe !== false ||
    receipt.isRightsApproved !== false ||
    receipt.isPublished !== false ||
    receipt.isReadyForPeia !== false
  ) {
    return makeRejection(
      'SECURITY_POSTURE_ESCALATION_DETECTED',
      'Quarantine receipt posture flags (isSanitized, isVerifiedSafe, isRightsApproved, isPublished, isReadyForPeia) must all be strictly false.'
    );
  }

  // 7. Validate format, canonicalExtension, canonicalMimeType, and deepInspectionStatus
  if (receipt.format !== 'PDF' && receipt.format !== 'DOCX') {
    return makeRejection(
      'INVALID_FILE_FORMAT_OR_MIME',
      'Receipt format must be strictly PDF or DOCX.'
    );
  }

  const expectedExt: 'pdf' | 'docx' =
    receipt.format === 'PDF' ? 'pdf' : 'docx';
  const expectedMime: LibraryUploadCanonicalMimeType =
    receipt.format === 'PDF'
      ? CANONICAL_PDF_MIME_TYPE
      : CANONICAL_DOCX_MIME_TYPE;
  const expectedInspectionStatus: LibraryQuarantineEligibleInspectionStatus =
    receipt.format === 'PDF'
      ? 'PDF_REQUIRES_ISOLATED_PARSER'
      : 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';

  if (
    receipt.canonicalExtension !== expectedExt ||
    receipt.canonicalMimeType !== expectedMime ||
    receipt.deepInspectionStatus !== expectedInspectionStatus
  ) {
    return makeRejection(
      'INVALID_FILE_FORMAT_OR_MIME',
      'Receipt canonicalExtension, canonicalMimeType, or deepInspectionStatus does not match its format.'
    );
  }

  // 8. Validate byteSize within 1..15,000,000
  if (
    typeof receipt.byteSize !== 'number' ||
    !Number.isSafeInteger(receipt.byteSize) ||
    receipt.byteSize < 1 ||
    receipt.byteSize > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
  ) {
    return makeRejection(
      'INVALID_BYTE_SIZE',
      'Receipt byteSize must be a safe integer between 1 and 15,000,000 bytes.'
    );
  }

  // 9. Validate sha256 lowercase hex 64
  if (
    typeof receipt.sha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(receipt.sha256)
  ) {
    return makeRejection(
      'INVALID_SHA256_DIGEST',
      'Receipt sha256 must be a 64-character lowercase hexadecimal digest.'
    );
  }

  // 10. Validate createdAt & updatedAt ISO-8601 UTC timestamps and monotonic order
  if (
    !isValidIsoUtcTimestamp(receipt.createdAt) ||
    !isValidIsoUtcTimestamp(receipt.updatedAt) ||
    Date.parse(receipt.updatedAt) < Date.parse(receipt.createdAt)
  ) {
    return makeRejection(
      'INVALID_SOURCE_TIMESTAMPS',
      'Receipt createdAt and updatedAt must be valid ISO-8601 UTC timestamps with updatedAt >= createdAt.'
    );
  }

  // 11. Validate and sanitize filenames
  const normalizedOriginalFilename = normalizeAndValidateDisplayFilename(
    receipt.originalFilename,
    expectedExt,
    false
  );
  const normalizedSanitizedFilename = normalizeAndValidateDisplayFilename(
    receipt.sanitizedFilename,
    expectedExt,
    true
  );

  if (
    normalizedOriginalFilename === null ||
    normalizedSanitizedFilename === null
  ) {
    return makeRejection(
      'INVALID_FILENAME',
      'Receipt originalFilename and sanitizedFilename must be safe non-empty filenames matching the canonical extension without control characters, HTML fragments, or path separators.'
    );
  }

  // 12. Verify optional expected source version / identity constraints
  if (expectations !== undefined) {
    if (
      expectations.expectedReceiptId !== undefined &&
      expectations.expectedReceiptId !== receipt.receiptId
    ) {
      return makeRejection(
        'SOURCE_VERSION_OR_DIGEST_MISMATCH',
        'Source receiptId does not match expectedReceiptId.'
      );
    }
    if (
      expectations.expectedRevision !== undefined &&
      expectations.expectedRevision !== rawRevision
    ) {
      return makeRejection(
        'SOURCE_VERSION_OR_DIGEST_MISMATCH',
        'Source revision does not match expectedRevision.'
      );
    }
    if (
      expectations.expectedSha256 !== undefined &&
      expectations.expectedSha256 !== receipt.sha256
    ) {
      return makeRejection(
        'SOURCE_VERSION_OR_DIGEST_MISMATCH',
        'Source sha256 digest does not match expectedSha256.'
      );
    }
    if (
      expectations.expectedUpdatedAt !== undefined &&
      expectations.expectedUpdatedAt !== receipt.updatedAt
    ) {
      return makeRejection(
        'SOURCE_VERSION_OR_DIGEST_MISMATCH',
        'Source updatedAt timestamp does not match expectedUpdatedAt.'
      );
    }
  }

  const candidate: LibraryQuarantineReviewCandidate = Object.freeze({
    candidateKind: 'QUARANTINE_PRIVATE_REVIEW_CANDIDATE' as const,
    decision: 'PENDING_HUMAN_REVIEW' as const,
    receiptId: receipt.receiptId,
    sourceRevision: rawRevision,
    sourceCreatedAt: receipt.createdAt,
    sourceUpdatedAt: receipt.updatedAt,
    sourceSha256: receipt.sha256,
    sourceByteSize: receipt.byteSize,
    sourceFormat: receipt.format,
    sourceCanonicalExtension: expectedExt,
    sourceCanonicalMimeType: expectedMime,
    sourceDeepInspectionStatus: expectedInspectionStatus,
    uploaderUid: receipt.uploaderUid,
    sourceOriginalFilename: normalizedOriginalFilename,
    sourceSanitizedFilename: normalizedSanitizedFilename,
    isQuarantinedPrivateOnly: true as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    deferredGates: LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES,
  });

  return Object.freeze({
    ok: true as const,
    status: 'ELIGIBLE_FOR_HUMAN_REVIEW_CANDIDATE' as const,
    candidate,
  });
}

const CANONICAL_DEFERRED_GATES_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES
);

function isValidDeferredGatesArray(
  value: unknown
): value is readonly LibraryQuarantineReviewDraftDeferredGate[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return false;
  }

  const expectedLen = LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES.length;
  if (value.length !== expectedLen) {
    return false;
  }

  // Reject extra own properties or symbols attached to the array instance
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedLen + 1) {
    return false;
  }

  const seenGates = new Set<string>();
  for (let i = 0; i < expectedLen; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) {
      return false;
    }
    const gate = value[i];
    if (
      typeof gate !== 'string' ||
      !CANONICAL_DEFERRED_GATES_SET.has(gate) ||
      seenGates.has(gate)
    ) {
      return false;
    }
    seenGates.add(gate);
  }

  return seenGates.size === expectedLen;
}

function isValidReviewCandidateObject(
  value: unknown
): value is LibraryQuarantineReviewCandidate {
  if (!isPlainObject(value)) {
    return false;
  }

  if (containsLeakedSecretOrStoragePattern(value)) {
    return false;
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== ALLOWED_CANDIDATE_KEYS.size) {
    return false;
  }

  for (const key of ownKeys) {
    if (typeof key !== 'string' || !ALLOWED_CANDIDATE_KEYS.has(key)) {
      return false;
    }
  }

  for (const reqKey of ALLOWED_CANDIDATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, reqKey)) {
      return false;
    }
  }

  if (
    value.candidateKind !== 'QUARANTINE_PRIVATE_REVIEW_CANDIDATE' ||
    value.decision !== 'PENDING_HUMAN_REVIEW'
  ) {
    return false;
  }

  if (!isValidLibraryQuarantineReceiptId(value.receiptId)) {
    return false;
  }

  if (
    typeof value.sourceRevision !== 'number' ||
    !Number.isSafeInteger(value.sourceRevision) ||
    value.sourceRevision < 1
  ) {
    return false;
  }

  if (!isValidUploaderUid(value.uploaderUid)) {
    return false;
  }

  if (
    typeof value.sourceSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(value.sourceSha256)
  ) {
    return false;
  }

  if (
    typeof value.sourceByteSize !== 'number' ||
    !Number.isSafeInteger(value.sourceByteSize) ||
    value.sourceByteSize < 1 ||
    value.sourceByteSize > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
  ) {
    return false;
  }

  if (value.sourceFormat !== 'PDF' && value.sourceFormat !== 'DOCX') {
    return false;
  }

  const expectedExt: 'pdf' | 'docx' =
    value.sourceFormat === 'PDF' ? 'pdf' : 'docx';
  const expectedMime: LibraryUploadCanonicalMimeType =
    value.sourceFormat === 'PDF'
      ? CANONICAL_PDF_MIME_TYPE
      : CANONICAL_DOCX_MIME_TYPE;
  const expectedInspectionStatus: LibraryQuarantineEligibleInspectionStatus =
    value.sourceFormat === 'PDF'
      ? 'PDF_REQUIRES_ISOLATED_PARSER'
      : 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';

  if (
    value.sourceCanonicalExtension !== expectedExt ||
    value.sourceCanonicalMimeType !== expectedMime ||
    value.sourceDeepInspectionStatus !== expectedInspectionStatus
  ) {
    return false;
  }

  const normalizedOriginalFilename = normalizeAndValidateDisplayFilename(
    value.sourceOriginalFilename,
    expectedExt,
    false
  );
  const normalizedSanitizedFilename = normalizeAndValidateDisplayFilename(
    value.sourceSanitizedFilename,
    expectedExt,
    true
  );

  if (
    normalizedOriginalFilename === null ||
    normalizedOriginalFilename !== value.sourceOriginalFilename ||
    normalizedSanitizedFilename === null ||
    normalizedSanitizedFilename !== value.sourceSanitizedFilename
  ) {
    return false;
  }

  if (
    !isValidIsoUtcTimestamp(value.sourceCreatedAt) ||
    !isValidIsoUtcTimestamp(value.sourceUpdatedAt) ||
    Date.parse(value.sourceUpdatedAt) < Date.parse(value.sourceCreatedAt)
  ) {
    return false;
  }

  if (
    value.isQuarantinedPrivateOnly !== true ||
    value.isSanitized !== false ||
    value.isVerifiedSafe !== false ||
    value.isRightsApproved !== false ||
    value.isPublished !== false ||
    value.isReadyForPeia !== false
  ) {
    return false;
  }

  if (!isValidDeferredGatesArray(value.deferredGates)) {
    return false;
  }

  return true;
}

/**
 * Pure, deterministic comparison checking whether two `LibraryQuarantineReviewCandidate`
 * instances represent the exact same receipt identity, revision, cryptographic digest,
 * timestamp, format, size, and owner.
 * Returns `false` if either input is malformed or if revision, sha256, or any source
 * identity/version property differs.
 */
export function areQuarantineReviewCandidatesSameSourceVersion(
  first: unknown,
  second: unknown
): boolean {
  if (
    !isValidReviewCandidateObject(first) ||
    !isValidReviewCandidateObject(second)
  ) {
    return false;
  }

  return (
    first.receiptId === second.receiptId &&
    first.sourceRevision === second.sourceRevision &&
    first.sourceSha256 === second.sourceSha256 &&
    first.sourceCreatedAt === second.sourceCreatedAt &&
    first.sourceUpdatedAt === second.sourceUpdatedAt &&
    first.sourceByteSize === second.sourceByteSize &&
    first.sourceFormat === second.sourceFormat &&
    first.sourceCanonicalExtension === second.sourceCanonicalExtension &&
    first.sourceCanonicalMimeType === second.sourceCanonicalMimeType &&
    first.sourceDeepInspectionStatus === second.sourceDeepInspectionStatus &&
    first.uploaderUid === second.uploaderUid &&
    first.sourceOriginalFilename === second.sourceOriginalFilename &&
    first.sourceSanitizedFilename === second.sourceSanitizedFilename
  );
}
