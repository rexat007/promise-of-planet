import {
  LIBRARY_QUARANTINE_STORAGE_PREFIX,
  LibraryQuarantineReceiptState,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  toSanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';
import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  areLibraryQuarantineReceiptsEqual,
  validatePersistedLibraryQuarantineReceiptEnvelope,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from './firestoreLibraryQuarantineReceiptStore';
import { parseCanonicalSafeGcsGeneration } from './gcsLibraryQuarantineStorageAdapter';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES,
  areQuarantineReviewCandidatesSameSourceVersion,
  assessLibraryQuarantineReviewCandidate,
  type LibraryQuarantineReviewCandidate,
  type LibraryQuarantineReviewDraftDeferredGate,
} from './libraryQuarantineReviewDraftContract';
import type { LibraryUploadPreliminaryFormat } from './libraryUploadBinaryAdmission';

/**
 * LIB-FILE-REVIEW-01B/R1 — Durable Firestore Quarantine Review Draft Store
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Server-only, point-lookup and atomic-transaction Firestore repository for
 *   durable quarantine review drafts in `library_quarantine_review_drafts/<receiptId>`.
 * - Disallows unbounded `.get()` collection scans.
 * - Executes at most one Firestore transaction per `createReviewDraftIfAbsentAtomically`
 *   call. Inside the transaction callback:
 *   1. Performs a point-read of `library_quarantine_receipts/<receiptId>` AND a
 *      point-read of `library_quarantine_review_drafts/<receiptId>` strictly BEFORE
 *      any write.
 *   2. Re-validates the authoritative source receipt envelope using
 *      `validatePersistedLibraryQuarantineReceiptEnvelope` and verifies that its
 *      `revision`, `state` (`Quarantined`), pinned GCS `generation`, all 22 receipt
 *      fields (`areLibraryQuarantineReceiptsEqual`), and derived 01A review candidate
 *      (`areQuarantineReviewCandidatesSameSourceVersion`) match the pre-verified
 *      snapshot. Any concurrent source modification aborts with `STALE_SOURCE_HOLD`
 *      and performs ZERO writes.
 *   3. Never modifies `library_quarantine_receipts/<receiptId>` (zero receipt writes).
 *   4. Creates `library_quarantine_review_drafts/<receiptId>` ONLY when absent via
 *      `transaction.create(...)` (never `transaction.set`, `update`, or `delete`).
 *   5. If the draft document already exists, returns `IDEMPOTENT_EXISTING` ONLY after
 *      full schema/posture validation and exact source identity/version match;
 *      otherwise aborts with `EXISTING_DRAFT_CONFLICT_HOLD` or
 *      `CORRUPTED_PERSISTED_DRAFT` with zero writes.
 * - SAFE CONSTANT DIAGNOSTICS (R1-B):
 *   Store failures never interpolate raw SDK/Firestore exception `.message` strings,
 *   caller-supplied values, or unknown property names into `errorMessage`. All store
 *   failure messages are selected from a frozen compile-time catalog of non-sensitive
 *   constant strings.
 * - TRUTHFUL AMBIGUOUS COMMIT OUTCOME (R1-C):
 *   Every store failure carries an explicit `draftCreationOutcome`:
 *   - `'NOT_CREATED'` (`draftCreated: false`) when no transaction was started or when
 *     the transaction callback contractually aborted BEFORE staging any
 *     `transaction.create(...)` call in any attempt.
 *   - `'UNKNOWN'` (`draftCreated: null`) when `db.runTransaction(...)` throws an
 *     uncaught or commit-phase error or when a write was staged in an attempt whose
 *     final commit acknowledgement was lost or failed.
 *
 * EXPLICIT GCS-TO-FIRESTORE TOCTOU WARNING:
 * - Generation-pinned GCS readback verification occurs immediately prior to the
 *   Firestore transaction, because Google Cloud Storage is external to Firestore's
 *   atomic transaction boundary.
 * - This store therefore does NOT claim that the GCS object is transactionally
 *   immutable after readback. Any subsequent workflow stage that inspects,
 *   sanitizes, or consumes the quarantined binary MUST perform a fresh
 *   generation-pinned GCS readback verification against `sourceSha256` and the
 *   authoritative receipt's `generation`.
 */

export const LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION =
  'library_quarantine_review_drafts' as const;

export const LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE =
  'PENDING_HUMAN_REVIEW' as const;

export type LibraryQuarantineReviewDraftStoreErrorCode =
  | 'INVALID_DRAFT_STORE_DEPENDENCY'
  | 'INVALID_DRAFT_STORE_INPUT'
  | 'UNTRUSTED_DRAFT_STORE_FIELD'
  | 'INVALID_RECEIPT_ID'
  | 'DOCUMENT_ID_MISMATCH'
  | 'INVALID_SCHEMA_VERSION'
  | 'CORRUPTED_PERSISTED_DRAFT'
  | 'SECURITY_FLAG_ESCALATION'
  | 'DRAFT_NOT_FOUND'
  | 'STALE_SOURCE_HOLD'
  | 'EXISTING_DRAFT_CONFLICT_HOLD'
  | 'TRANSACTION_CONFLICT_OR_FAILURE';

export type LibraryQuarantineReviewDraftStoreFailureOutcome =
  | 'NOT_CREATED'
  | 'UNKNOWN';

export interface LibraryQuarantinePersistedReviewDraft {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly format: LibraryUploadPreliminaryFormat;
  readonly uploaderUid: string;
  readonly reviewState: typeof LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
  readonly createdBy: string;
  readonly createdAt: string;
}

/**
 * Collection reference restricted to point-lookup `.doc(documentId)`.
 * Unbounded `.get()` collection scans are intentionally omitted.
 */
export interface LibraryQuarantineReviewDraftFirestoreCollectionRef {
  doc(documentId: string): LibraryQuarantineFirestoreDocumentRef;
}

/**
 * Transaction contract restricted to `.get(docRef)` and `.create(docRef, data)`.
 * `.set()`, `.update()`, and `.delete()` are intentionally omitted so existing
 * documents can never be overwritten or deleted.
 */
export interface LibraryQuarantineReviewDraftFirestoreTransaction {
  get(
    docRef: LibraryQuarantineFirestoreDocumentRef
  ): Promise<LibraryQuarantineFirestoreDocumentSnapshot>;
  create(
    docRef: LibraryQuarantineFirestoreDocumentRef,
    data: Record<string, unknown>
  ): LibraryQuarantineReviewDraftFirestoreTransaction | void;
  update(
    docRef: LibraryQuarantineFirestoreDocumentRef,
    data: Record<string, unknown>
  ): LibraryQuarantineReviewDraftFirestoreTransaction | void;
}

export interface LibraryQuarantineReviewDraftFirestoreDatabase {
  collection(
    collectionName: string
  ): LibraryQuarantineReviewDraftFirestoreCollectionRef;
  runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineReviewDraftFirestoreTransaction
    ) => Promise<T>
  ): Promise<T>;
}

export interface CreateLibraryQuarantineReviewDraftAtomicallyInput {
  readonly receiptId: string;
  readonly expectedSourceEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly expectedAttestedGeneration: string;
  readonly expectedCandidate: LibraryQuarantineReviewCandidate;
  readonly createdBy: string;
  readonly createdAt: string;
}

export type CreateLibraryQuarantineReviewDraftDisposition =
  | 'CREATED'
  | 'IDEMPOTENT_EXISTING';

export interface CreateLibraryQuarantineReviewDraftSuccess {
  readonly ok: true;
  readonly disposition: CreateLibraryQuarantineReviewDraftDisposition;
  readonly draftCreationOutcome: CreateLibraryQuarantineReviewDraftDisposition;
  readonly created: boolean;
  readonly draftCreated: boolean;
  readonly draft: LibraryQuarantinePersistedReviewDraft;
  readonly sourceRevision: number;
  readonly deferredGates: readonly LibraryQuarantineReviewDraftDeferredGate[];
}

export interface LibraryQuarantineReviewDraftStoreFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineReviewDraftStoreErrorCode;
  readonly errorMessage: string;
  readonly draftCreationOutcome: LibraryQuarantineReviewDraftStoreFailureOutcome;
  readonly draftCreated: false | null;
}

export type CreateLibraryQuarantineReviewDraftResult =
  | CreateLibraryQuarantineReviewDraftSuccess
  | LibraryQuarantineReviewDraftStoreFailure;

export interface GetLibraryQuarantineReviewDraftSuccess {
  readonly ok: true;
  readonly draft: LibraryQuarantinePersistedReviewDraft;
}

export type GetLibraryQuarantineReviewDraftResult =
  | GetLibraryQuarantineReviewDraftSuccess
  | LibraryQuarantineReviewDraftStoreFailure;

export interface LibraryQuarantineReviewDraftStore {
  getReviewDraftByReceiptId(
    receiptId: unknown
  ): Promise<GetLibraryQuarantineReviewDraftResult>;
  createReviewDraftIfAbsentAtomically(
    input: unknown
  ): Promise<CreateLibraryQuarantineReviewDraftResult>;
}

const SHA256_LOWERCASE_HEX_REGEX = /^[0-9a-f]{64}$/;
const CONTROL_OR_BIDI_CHAR_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/g;

const ALLOWED_PERSISTED_DRAFT_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'format',
  'uploaderUid',
  'reviewState',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
  'createdBy',
  'createdAt',
]);

const ALLOWED_CREATE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedSourceEnvelope',
  'expectedAttestedGeneration',
  'expectedCandidate',
  'createdBy',
  'createdAt',
]);

const FORBIDDEN_SECRET_OR_INTERNAL_KEYS: ReadonlySet<string> = new Set([
  'storagePath',
  'generation',
  'attestedGeneration',
  'attestedStoragePath',
  'attestation',
  'bucket',
  'url',
  'normalizedUrl',
  'signedUrl',
  'downloadUrl',
  'mediaLink',
  'downloadTokens',
  'firebaseStorageDownloadTokens',
  'token',
  'accessToken',
  'bytes',
  'rawBytes',
  'buffer',
]);

/**
 * Predefined, non-sensitive constant messages for all draft store failure paths.
 * Raw exception `.message` strings and untrusted caller keys/values are never
 * interpolated into store failure messages.
 */
const STORE_SAFE_MESSAGES = Object.freeze({
  EXPECTED_DOCUMENT_ID_INVALID:
    'expectedDocumentId must be a valid 32-character lowercase hexadecimal receiptId.',
  PERSISTED_DRAFT_NOT_PLAIN_OBJECT:
    'Persisted quarantine review draft must be a plain non-null object.',
  PERSISTED_DRAFT_FORBIDDEN_SECRET_PATTERN:
    'Persisted quarantine review draft contains forbidden storage paths, generations, URLs, tokens, or binary buffers.',
  PERSISTED_DRAFT_UNEXPECTED_FIELD:
    'Persisted quarantine review draft contains an unexpected or forbidden property.',
  PERSISTED_DRAFT_MISSING_REQUIRED_FIELD:
    'Persisted quarantine review draft is missing one or more required canonical properties.',
  PERSISTED_DRAFT_INVALID_SCHEMA_VERSION:
    'Persisted quarantine review draft has an unsupported schemaVersion.',
  PERSISTED_DRAFT_INVALID_RECEIPT_ID:
    'Persisted quarantine review draft receiptId must be a 32-character lowercase hexadecimal string.',
  PERSISTED_DRAFT_DOCUMENT_ID_MISMATCH:
    'Persisted quarantine review draft receiptId does not match the Firestore document ID.',
  PERSISTED_DRAFT_INVALID_SOURCE_REVISION:
    'Persisted quarantine review draft sourceRevision must be a positive safe integer (>= 1).',
  PERSISTED_DRAFT_INVALID_SOURCE_UPDATED_AT:
    'Persisted quarantine review draft sourceUpdatedAt must be a valid ISO-8601 UTC timestamp.',
  PERSISTED_DRAFT_INVALID_SOURCE_SHA256:
    'Persisted quarantine review draft sourceSha256 must be a 64-character lowercase hexadecimal digest.',
  PERSISTED_DRAFT_INVALID_FORMAT:
    'Persisted quarantine review draft format must be strictly "PDF" or "DOCX".',
  PERSISTED_DRAFT_INVALID_UPLOADER_UID:
    'Persisted quarantine review draft uploaderUid is invalid.',
  PERSISTED_DRAFT_INVALID_REVIEW_STATE:
    'Persisted quarantine review draft reviewState must be strictly "PENDING_HUMAN_REVIEW".',
  PERSISTED_DRAFT_SECURITY_FLAG_ESCALATION:
    'Persisted quarantine review draft must preserve all 5 non-assurance posture flags as strictly false.',
  PERSISTED_DRAFT_INVALID_CREATED_BY:
    'Persisted quarantine review draft createdBy must be a valid canonical reviewer UID.',
  PERSISTED_DRAFT_INVALID_CREATED_AT:
    'Persisted quarantine review draft createdAt must be a valid ISO-8601 UTC timestamp not earlier than sourceUpdatedAt.',
  LOOKUP_INVALID_RECEIPT_ID:
    'receiptId must be a valid 32-character lowercase hexadecimal string.',
  STORE_DEPENDENCY_INVALID_DOC_REF:
    'Firestore collection adapter failed to provide a valid point document reference.',
  STORE_DEPENDENCY_DOCUMENT_ID_MISMATCH:
    'Firestore document reference ID does not match the requested receiptId.',
  STORE_DEPENDENCY_INVALID_TRANSACTION:
    'Firestore transaction adapter must provide valid point-read and create methods.',
  DRAFT_NOT_FOUND:
    'Requested quarantine review draft was not found in Firestore.',
  SNAPSHOT_DOCUMENT_ID_MISMATCH:
    'Firestore draft snapshot ID does not match the requested receiptId.',
  LOOKUP_READ_FAILED:
    'Firestore point-lookup failed while reading quarantine review draft.',
  CREATE_INPUT_NOT_PLAIN_OBJECT:
    'createReviewDraftIfAbsentAtomically input must be a plain non-null object.',
  CREATE_INPUT_UNEXPECTED_FIELD:
    'createReviewDraftIfAbsentAtomically input contains an unexpected or untrusted property.',
  CREATE_INPUT_INVALID_CREATED_BY:
    'createdBy must be a valid canonical reviewer UID.',
  CREATE_INPUT_INVALID_CREATED_AT:
    'createdAt must be a valid ISO-8601 UTC timestamp.',
  CREATE_INPUT_INVALID_GENERATION:
    'expectedAttestedGeneration must be a canonical positive safe-integer decimal generation string.',
  CREATE_INPUT_INVALID_SOURCE_ENVELOPE:
    'expectedSourceEnvelope failed quarantine receipt envelope validation.',
  CREATE_INPUT_SOURCE_NOT_QUARANTINED_OR_GEN_MISMATCH:
    'expectedSourceEnvelope must be in exact Quarantined state with generation matching expectedAttestedGeneration.',
  CREATE_INPUT_INVALID_CANDIDATE:
    'expectedCandidate failed 01A review candidate structural validation.',
  CREATE_INPUT_DTO_CONVERSION_FAILED:
    'expectedSourceEnvelope failed sanitized admin DTO conversion.',
  CREATE_INPUT_CANDIDATE_SOURCE_MISMATCH:
    'expectedCandidate does not match expectedSourceEnvelope.',
  CREATE_INPUT_CREATED_AT_BEFORE_SOURCE:
    'createdAt cannot be earlier than the source receipt updatedAt timestamp.',
  TX_READ_BUDGET_EXCEEDED:
    'Transaction read budget exceeded (maximum 2 point reads allowed).',
  TX_WRITE_BUDGET_EXCEEDED:
    'Transaction write budget exceeded (maximum 1 draft create allowed).',
  TX_SOURCE_MISSING:
    'Authoritative source receipt no longer exists in Firestore during transaction.',
  TX_SOURCE_ID_MISMATCH:
    'Authoritative source snapshot ID does not match the requested receiptId.',
  TX_SOURCE_ENVELOPE_INVALID:
    'Authoritative source receipt failed envelope validation inside transaction.',
  TX_SOURCE_CHANGED_SINCE_READBACK:
    'Authoritative source receipt changed between GCS readback and Firestore transaction.',
  TX_SOURCE_DTO_INVALID:
    'Authoritative source receipt failed sanitized DTO conversion inside transaction.',
  TX_SOURCE_CANDIDATE_MISMATCH:
    'Authoritative source receipt no longer produces a matching 01A review candidate inside transaction.',
  TX_EXISTING_DRAFT_ID_MISMATCH:
    'Existing review draft snapshot ID does not match the requested receiptId.',
  TX_EXISTING_DRAFT_CORRUPTED:
    'Existing persisted quarantine review draft failed schema or posture validation.',
  TX_EXISTING_DRAFT_SOURCE_CONFLICT:
    'Existing quarantine review draft does not match the authoritative source revision or digest.',
  TX_FAILED_OR_CONFLICTED:
    'Firestore transaction failed or conflicted during atomic quarantine review draft creation.',
} as const);

const ALLOWED_STORE_SAFE_MESSAGES: ReadonlySet<string> = new Set(
  Object.values(STORE_SAFE_MESSAGES)
);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1
  );
}

function hasUnexpectedPropertyOrSymbol(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): boolean {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowedKeys.has(key)) {
      return true;
    }
  }
  return Object.getOwnPropertySymbols(obj).length > 0;
}

function containsLeakedSecretOrStoragePattern(
  value: unknown,
  depth = 0
): boolean {
  if (depth > 6 || value === null || value === undefined) {
    return false;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return true;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
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

function sanitizeConstantStoreMessage(message: string): string {
  const safeBase = ALLOWED_STORE_SAFE_MESSAGES.has(message)
    ? message
    : STORE_SAFE_MESSAGES.TX_FAILED_OR_CONFLICTED;

  return safeBase
    .replace(
      /library\/quarantine\/[0-9a-f]{32}\/source\.(?:pdf|docx)/gi,
      '[REDACTED_QUARANTINE_PATH]'
    )
    .replace(
      new RegExp(LIBRARY_QUARANTINE_STORAGE_PREFIX, 'gi'),
      '[REDACTED_PREFIX]'
    )
    .replace(/https?:\/\/[^\s"']+/gi, '[REDACTED_URL]')
    .replace(/gs:\/\/[^\s"']+/gi, '[REDACTED_GS_URI]')
    .replace(CONTROL_OR_BIDI_CHAR_REGEX, ' ')
    .trim();
}

function makeDraftStoreFailure(
  errorCode: LibraryQuarantineReviewDraftStoreErrorCode,
  constantMessage: string,
  draftCreationOutcome: LibraryQuarantineReviewDraftStoreFailureOutcome = 'NOT_CREATED'
): LibraryQuarantineReviewDraftStoreFailure {
  return Object.freeze({
    ok: false as const,
    errorCode,
    errorMessage: sanitizeConstantStoreMessage(constantMessage),
    draftCreationOutcome,
    draftCreated: draftCreationOutcome === 'NOT_CREATED' ? (false as const) : null,
  });
}

class InternalDraftStoreTransactionAbortError extends Error {
  public readonly failure: LibraryQuarantineReviewDraftStoreFailure;

  constructor(failure: LibraryQuarantineReviewDraftStoreFailure) {
    super(failure.errorMessage);
    this.name = 'InternalDraftStoreTransactionAbortError';
    this.failure = failure;
  }
}

function serializeReviewDraftForFirestore(
  draft: LibraryQuarantinePersistedReviewDraft
): Record<string, unknown> {
  return {
    schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
    receiptId: draft.receiptId,
    sourceRevision: draft.sourceRevision,
    sourceUpdatedAt: draft.sourceUpdatedAt,
    sourceSha256: draft.sourceSha256,
    format: draft.format,
    uploaderUid: draft.uploaderUid,
    reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    createdBy: draft.createdBy,
    createdAt: draft.createdAt,
  };
}

/**
 * Strictly validates a persisted `library_quarantine_review_drafts/<receiptId>`
 * document against the 15-field schema and non-assurance security invariants.
 * Never silently repairs or coerces corrupted data.
 */
export function validatePersistedLibraryQuarantineReviewDraft(
  rawDraft: unknown,
  expectedDocumentId?: unknown
):
  | {
      readonly ok: true;
      readonly draft: LibraryQuarantinePersistedReviewDraft;
    }
  | LibraryQuarantineReviewDraftStoreFailure {
  if (
    expectedDocumentId !== undefined &&
    !isValidLibraryQuarantineReceiptId(expectedDocumentId)
  ) {
    return makeDraftStoreFailure(
      'INVALID_RECEIPT_ID',
      STORE_SAFE_MESSAGES.EXPECTED_DOCUMENT_ID_INVALID,
      'NOT_CREATED'
    );
  }

  if (!isPlainRecord(rawDraft)) {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_NOT_PLAIN_OBJECT,
      'NOT_CREATED'
    );
  }

  if (containsLeakedSecretOrStoragePattern(rawDraft)) {
    return makeDraftStoreFailure(
      'UNTRUSTED_DRAFT_STORE_FIELD',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_FORBIDDEN_SECRET_PATTERN,
      'NOT_CREATED'
    );
  }

  if (hasUnexpectedPropertyOrSymbol(rawDraft, ALLOWED_PERSISTED_DRAFT_KEYS)) {
    return makeDraftStoreFailure(
      'UNTRUSTED_DRAFT_STORE_FIELD',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_UNEXPECTED_FIELD,
      'NOT_CREATED'
    );
  }

  for (const requiredKey of ALLOWED_PERSISTED_DRAFT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rawDraft, requiredKey)) {
      return makeDraftStoreFailure(
        'CORRUPTED_PERSISTED_DRAFT',
        STORE_SAFE_MESSAGES.PERSISTED_DRAFT_MISSING_REQUIRED_FIELD,
        'NOT_CREATED'
      );
    }
  }

  const {
    schemaVersion,
    receiptId,
    sourceRevision,
    sourceUpdatedAt,
    sourceSha256,
    format,
    uploaderUid,
    reviewState,
    isSanitized,
    isVerifiedSafe,
    isRightsApproved,
    isPublished,
    isReadyForPeia,
    createdBy,
    createdAt,
  } = rawDraft;

  if (schemaVersion !== LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION) {
    return makeDraftStoreFailure(
      'INVALID_SCHEMA_VERSION',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_SCHEMA_VERSION,
      'NOT_CREATED'
    );
  }

  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    return makeDraftStoreFailure(
      'INVALID_RECEIPT_ID',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_RECEIPT_ID,
      'NOT_CREATED'
    );
  }

  if (expectedDocumentId !== undefined && receiptId !== expectedDocumentId) {
    return makeDraftStoreFailure(
      'DOCUMENT_ID_MISMATCH',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_DOCUMENT_ID_MISMATCH,
      'NOT_CREATED'
    );
  }

  if (!isPositiveSafeInteger(sourceRevision)) {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_SOURCE_REVISION,
      'NOT_CREATED'
    );
  }

  if (!isValidIsoUtcTimestamp(sourceUpdatedAt)) {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_SOURCE_UPDATED_AT,
      'NOT_CREATED'
    );
  }

  if (
    typeof sourceSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(sourceSha256)
  ) {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_SOURCE_SHA256,
      'NOT_CREATED'
    );
  }

  if (format !== 'PDF' && format !== 'DOCX') {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_FORMAT,
      'NOT_CREATED'
    );
  }

  if (!isValidUploaderUid(uploaderUid)) {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_UPLOADER_UID,
      'NOT_CREATED'
    );
  }

  if (reviewState !== LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE) {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_REVIEW_STATE,
      'NOT_CREATED'
    );
  }

  if (
    isSanitized !== false ||
    isVerifiedSafe !== false ||
    isRightsApproved !== false ||
    isPublished !== false ||
    isReadyForPeia !== false
  ) {
    return makeDraftStoreFailure(
      'SECURITY_FLAG_ESCALATION',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_SECURITY_FLAG_ESCALATION,
      'NOT_CREATED'
    );
  }

  if (!isValidUploaderUid(createdBy)) {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_CREATED_BY,
      'NOT_CREATED'
    );
  }

  if (
    !isValidIsoUtcTimestamp(createdAt) ||
    Date.parse(createdAt) < Date.parse(sourceUpdatedAt)
  ) {
    return makeDraftStoreFailure(
      'CORRUPTED_PERSISTED_DRAFT',
      STORE_SAFE_MESSAGES.PERSISTED_DRAFT_INVALID_CREATED_AT,
      'NOT_CREATED'
    );
  }

  const validatedDraft: LibraryQuarantinePersistedReviewDraft = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
    receiptId,
    sourceRevision,
    sourceUpdatedAt,
    sourceSha256,
    format,
    uploaderUid,
    reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    createdBy,
    createdAt,
  });

  return Object.freeze({
    ok: true as const,
    draft: validatedDraft,
  });
}

/**
 * Verifies that a validated persisted review draft matches the exact source
 * identity, revision, timestamp, digest, format, owner, and non-assurance state
 * of both the expected 01A candidate and the authoritative in-transaction source
 * receipt envelope.
 */
export function doesPersistedReviewDraftMatchCandidateAndSource(
  draft: LibraryQuarantinePersistedReviewDraft,
  candidate: LibraryQuarantineReviewCandidate,
  sourceEnvelope: LibraryQuarantinePersistedReceiptEnvelope
): boolean {
  const sourceReceipt = sourceEnvelope.receipt;
  return (
    draft.schemaVersion === LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION &&
    draft.receiptId === candidate.receiptId &&
    draft.receiptId === sourceReceipt.receiptId &&
    draft.sourceRevision === candidate.sourceRevision &&
    draft.sourceRevision === sourceEnvelope.revision &&
    draft.sourceUpdatedAt === candidate.sourceUpdatedAt &&
    draft.sourceUpdatedAt === sourceReceipt.updatedAt &&
    draft.sourceSha256 === candidate.sourceSha256 &&
    draft.sourceSha256 === sourceReceipt.sha256 &&
    draft.format === candidate.sourceFormat &&
    draft.format === sourceReceipt.format &&
    draft.uploaderUid === candidate.uploaderUid &&
    draft.uploaderUid === sourceReceipt.uploaderUid &&
    draft.reviewState === LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE &&
    draft.isSanitized === false &&
    draft.isVerifiedSafe === false &&
    draft.isRightsApproved === false &&
    draft.isPublished === false &&
    draft.isReadyForPeia === false &&
    isValidUploaderUid(draft.createdBy) &&
    isValidIsoUtcTimestamp(draft.createdAt) &&
    Date.parse(draft.createdAt) >= Date.parse(draft.sourceUpdatedAt)
  );
}

/**
 * Dependency-injected Firestore store for point-lookup and atomic transaction
 * creation of `library_quarantine_review_drafts/<receiptId>`.
 */
export class FirestoreLibraryQuarantineReviewDraftStore
  implements LibraryQuarantineReviewDraftStore
{
  public static readonly COLLECTION =
    LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION;
  public static readonly SOURCE_RECEIPT_COLLECTION =
    LIBRARY_QUARANTINE_RECEIPT_COLLECTION;
  public static readonly SCHEMA_VERSION =
    LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION;

  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;

  constructor(db: LibraryQuarantineReviewDraftFirestoreDatabase) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      throw new Error(
        'INVALID_DRAFT_STORE_DEPENDENCY: FirestoreLibraryQuarantineReviewDraftStore requires a valid Firestore database adapter with .collection() and .runTransaction().'
      );
    }
    this.db = db;
  }

  private resolvePointDocRef(
    collectionName: string,
    receiptId: string
  ):
    | { readonly ok: true; readonly docRef: LibraryQuarantineFirestoreDocumentRef }
    | LibraryQuarantineReviewDraftStoreFailure {
    let collectionRef: LibraryQuarantineReviewDraftFirestoreCollectionRef;
    try {
      collectionRef = this.db.collection(collectionName);
    } catch {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_DEPENDENCY',
        STORE_SAFE_MESSAGES.STORE_DEPENDENCY_INVALID_DOC_REF,
        'NOT_CREATED'
      );
    }

    if (!collectionRef || typeof collectionRef.doc !== 'function') {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_DEPENDENCY',
        STORE_SAFE_MESSAGES.STORE_DEPENDENCY_INVALID_DOC_REF,
        'NOT_CREATED'
      );
    }

    let docRef: LibraryQuarantineFirestoreDocumentRef;
    try {
      docRef = collectionRef.doc(receiptId);
    } catch {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_DEPENDENCY',
        STORE_SAFE_MESSAGES.STORE_DEPENDENCY_INVALID_DOC_REF,
        'NOT_CREATED'
      );
    }

    if (!docRef || typeof docRef !== 'object') {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_DEPENDENCY',
        STORE_SAFE_MESSAGES.STORE_DEPENDENCY_INVALID_DOC_REF,
        'NOT_CREATED'
      );
    }

    if (docRef.id !== receiptId) {
      return makeDraftStoreFailure(
        'DOCUMENT_ID_MISMATCH',
        STORE_SAFE_MESSAGES.STORE_DEPENDENCY_DOCUMENT_ID_MISMATCH,
        'NOT_CREATED'
      );
    }

    return { ok: true, docRef };
  }

  /**
   * Point-lookup of a single persisted quarantine review draft by its validated
   * 32-character lowercase hexadecimal `receiptId`.
   * Never performs collection scans or repairs corrupted data.
   */
  public async getReviewDraftByReceiptId(
    receiptId: unknown
  ): Promise<GetLibraryQuarantineReviewDraftResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeDraftStoreFailure(
        'INVALID_RECEIPT_ID',
        STORE_SAFE_MESSAGES.LOOKUP_INVALID_RECEIPT_ID,
        'NOT_CREATED'
      );
    }

    const docRefRes = this.resolvePointDocRef(
      FirestoreLibraryQuarantineReviewDraftStore.COLLECTION,
      receiptId
    );
    if (!docRefRes.ok) {
      return docRefRes;
    }

    const draftDocRef = docRefRes.docRef;

    try {
      let snapshot: LibraryQuarantineFirestoreDocumentSnapshot;
      if (typeof draftDocRef.get === 'function') {
        snapshot = await draftDocRef.get();
      } else {
        snapshot = await this.db.runTransaction(async (transaction) => {
          if (!transaction || typeof transaction.get !== 'function') {
            throw new InternalDraftStoreTransactionAbortError(
              makeDraftStoreFailure(
                'INVALID_DRAFT_STORE_DEPENDENCY',
                STORE_SAFE_MESSAGES.STORE_DEPENDENCY_INVALID_TRANSACTION,
                'NOT_CREATED'
              )
            );
          }
          return transaction.get(draftDocRef);
        });
      }

      if (!snapshot || !snapshot.exists) {
        return makeDraftStoreFailure(
          'DRAFT_NOT_FOUND',
          STORE_SAFE_MESSAGES.DRAFT_NOT_FOUND,
          'NOT_CREATED'
        );
      }

      if (snapshot.id !== undefined && snapshot.id !== receiptId) {
        return makeDraftStoreFailure(
          'DOCUMENT_ID_MISMATCH',
          STORE_SAFE_MESSAGES.SNAPSHOT_DOCUMENT_ID_MISMATCH,
          'NOT_CREATED'
        );
      }

      return validatePersistedLibraryQuarantineReviewDraft(
        snapshot.data(),
        receiptId
      );
    } catch (err) {
      if (err instanceof InternalDraftStoreTransactionAbortError) {
        return err.failure;
      }
      return makeDraftStoreFailure(
        'TRANSACTION_CONFLICT_OR_FAILURE',
        STORE_SAFE_MESSAGES.LOOKUP_READ_FAILED,
        'NOT_CREATED'
      );
    }
  }

  /**
   * Executes a single atomic Firestore transaction that:
   * 1. Point-reads `library_quarantine_receipts/<receiptId>` and
   *    `library_quarantine_review_drafts/<receiptId>` before any write.
   * 2. Re-validates the authoritative source receipt envelope and verifies exact
   *    match against `expectedSourceEnvelope`, `expectedAttestedGeneration`, and
   *    `expectedCandidate`.
   * 3. If the draft document does not exist, creates it once via
   *    `transaction.create(draftDocRef, serialized)` (zero receipt writes).
   * 4. If the draft document already exists, returns `IDEMPOTENT_EXISTING` only
   *    when the persisted draft passes full validation and matches the exact
   *    source version; otherwise fails closed with `EXISTING_DRAFT_CONFLICT_HOLD`.
   */
  public async createReviewDraftIfAbsentAtomically(
    rawInput: unknown
  ): Promise<CreateLibraryQuarantineReviewDraftResult> {
    if (!isPlainRecord(rawInput)) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_NOT_PLAIN_OBJECT,
        'NOT_CREATED'
      );
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_CREATE_INPUT_KEYS)) {
      return makeDraftStoreFailure(
        'UNTRUSTED_DRAFT_STORE_FIELD',
        STORE_SAFE_MESSAGES.CREATE_INPUT_UNEXPECTED_FIELD,
        'NOT_CREATED'
      );
    }

    const {
      receiptId,
      expectedSourceEnvelope,
      expectedAttestedGeneration,
      expectedCandidate,
      createdBy,
      createdAt,
    } = rawInput;

    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeDraftStoreFailure(
        'INVALID_RECEIPT_ID',
        STORE_SAFE_MESSAGES.LOOKUP_INVALID_RECEIPT_ID,
        'NOT_CREATED'
      );
    }

    if (!isValidUploaderUid(createdBy)) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_INVALID_CREATED_BY,
        'NOT_CREATED'
      );
    }

    if (!isValidIsoUtcTimestamp(createdAt)) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_INVALID_CREATED_AT,
        'NOT_CREATED'
      );
    }

    const parsedGeneration = parseCanonicalSafeGcsGeneration(
      expectedAttestedGeneration
    );
    if (
      parsedGeneration === null ||
      parsedGeneration !== expectedAttestedGeneration
    ) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_INVALID_GENERATION,
        'NOT_CREATED'
      );
    }

    const expectedEnvelopeCheck =
      validatePersistedLibraryQuarantineReceiptEnvelope(
        expectedSourceEnvelope,
        receiptId
      );
    if (!expectedEnvelopeCheck.ok) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_INVALID_SOURCE_ENVELOPE,
        'NOT_CREATED'
      );
    }

    const validatedExpectedEnvelope = expectedEnvelopeCheck.envelope;
    const validatedExpectedReceipt = validatedExpectedEnvelope.receipt;

    if (
      validatedExpectedEnvelope.state !==
        LibraryQuarantineReceiptState.Quarantined ||
      validatedExpectedReceipt.state !==
        LibraryQuarantineReceiptState.Quarantined ||
      validatedExpectedReceipt.generation !== parsedGeneration
    ) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_SOURCE_NOT_QUARANTINED_OR_GEN_MISMATCH,
        'NOT_CREATED'
      );
    }

    if (
      !areQuarantineReviewCandidatesSameSourceVersion(
        expectedCandidate,
        expectedCandidate
      )
    ) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_INVALID_CANDIDATE,
        'NOT_CREATED'
      );
    }

    const validatedCandidate =
      expectedCandidate as LibraryQuarantineReviewCandidate;

    const expectedDtoCheck = toSanitizedLibraryQuarantineAdminReceiptDto(
      validatedExpectedReceipt
    );
    if (!expectedDtoCheck.ok) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_DTO_CONVERSION_FAILED,
        'NOT_CREATED'
      );
    }

    const derivedExpectedCandidateCheck =
      assessLibraryQuarantineReviewCandidate(
        {
          revision: validatedExpectedEnvelope.revision,
          adminReceipt: expectedDtoCheck.dto,
        },
        {
          expectedReceiptId: receiptId,
          expectedRevision: validatedExpectedEnvelope.revision,
          expectedSha256: validatedExpectedReceipt.sha256,
          expectedUpdatedAt: validatedExpectedReceipt.updatedAt,
        }
      );

    if (
      !derivedExpectedCandidateCheck.ok ||
      !areQuarantineReviewCandidatesSameSourceVersion(
        validatedCandidate,
        derivedExpectedCandidateCheck.candidate
      )
    ) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_CANDIDATE_SOURCE_MISMATCH,
        'NOT_CREATED'
      );
    }

    if (Date.parse(createdAt) < Date.parse(validatedExpectedReceipt.updatedAt)) {
      return makeDraftStoreFailure(
        'INVALID_DRAFT_STORE_INPUT',
        STORE_SAFE_MESSAGES.CREATE_INPUT_CREATED_AT_BEFORE_SOURCE,
        'NOT_CREATED'
      );
    }

    const sourceRefRes = this.resolvePointDocRef(
      FirestoreLibraryQuarantineReviewDraftStore.SOURCE_RECEIPT_COLLECTION,
      receiptId
    );
    if (!sourceRefRes.ok) {
      return sourceRefRes;
    }

    const draftRefRes = this.resolvePointDocRef(
      FirestoreLibraryQuarantineReviewDraftStore.COLLECTION,
      receiptId
    );
    if (!draftRefRes.ok) {
      return draftRefRes;
    }

    const sourceReceiptDocRef = sourceRefRes.docRef;
    const draftDocRef = draftRefRes.docRef;

    let createStagedInAnyAttempt = false;

    try {
      return await this.db.runTransaction(async (transaction) => {
        if (
          !transaction ||
          typeof transaction.get !== 'function' ||
          typeof transaction.create !== 'function'
        ) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              'INVALID_DRAFT_STORE_DEPENDENCY',
              STORE_SAFE_MESSAGES.STORE_DEPENDENCY_INVALID_TRANSACTION,
              createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
            )
          );
        }

        // Enforce strict per-attempt transaction read/write budget:
        // <= 2 point reads (source receipt + draft), <= 1 create (draft only), 0 receipt writes.
        let txReadCount = 0;
        let txCreateCount = 0;

        const readPointDoc = async (
          ref: LibraryQuarantineFirestoreDocumentRef
        ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
          txReadCount += 1;
          if (txReadCount > 2) {
            throw new InternalDraftStoreTransactionAbortError(
              makeDraftStoreFailure(
                'TRANSACTION_CONFLICT_OR_FAILURE',
                STORE_SAFE_MESSAGES.TX_READ_BUDGET_EXCEEDED,
                createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
              )
            );
          }
          return transaction.get(ref);
        };

        // 1. Point-read authoritative source receipt and target draft BEFORE any write
        const sourceSnapshot = await readPointDoc(sourceReceiptDocRef);
        const draftSnapshot = await readPointDoc(draftDocRef);

        if (!sourceSnapshot || !sourceSnapshot.exists) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              'STALE_SOURCE_HOLD',
              STORE_SAFE_MESSAGES.TX_SOURCE_MISSING,
              createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
            )
          );
        }

        if (
          sourceSnapshot.id !== undefined &&
          sourceSnapshot.id !== receiptId
        ) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              'STALE_SOURCE_HOLD',
              STORE_SAFE_MESSAGES.TX_SOURCE_ID_MISMATCH,
              createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
            )
          );
        }

        const liveSourceCheck =
          validatePersistedLibraryQuarantineReceiptEnvelope(
            sourceSnapshot.data(),
            receiptId
          );
        if (!liveSourceCheck.ok) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              'STALE_SOURCE_HOLD',
              STORE_SAFE_MESSAGES.TX_SOURCE_ENVELOPE_INVALID,
              createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
            )
          );
        }

        const liveEnvelope = liveSourceCheck.envelope;
        const liveReceipt = liveEnvelope.receipt;

        if (
          liveEnvelope.revision !== validatedExpectedEnvelope.revision ||
          liveEnvelope.state !== LibraryQuarantineReceiptState.Quarantined ||
          liveReceipt.state !== LibraryQuarantineReceiptState.Quarantined ||
          liveReceipt.generation !== parsedGeneration ||
          !areLibraryQuarantineReceiptsEqual(
            liveReceipt,
            validatedExpectedReceipt
          )
        ) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              'STALE_SOURCE_HOLD',
              STORE_SAFE_MESSAGES.TX_SOURCE_CHANGED_SINCE_READBACK,
              createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
            )
          );
        }

        const liveDtoCheck =
          toSanitizedLibraryQuarantineAdminReceiptDto(liveReceipt);
        if (!liveDtoCheck.ok) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              'STALE_SOURCE_HOLD',
              STORE_SAFE_MESSAGES.TX_SOURCE_DTO_INVALID,
              createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
            )
          );
        }

        const liveCandidateCheck = assessLibraryQuarantineReviewCandidate(
          {
            revision: liveEnvelope.revision,
            adminReceipt: liveDtoCheck.dto,
          },
          {
            expectedReceiptId: receiptId,
            expectedRevision: liveEnvelope.revision,
            expectedSha256: liveReceipt.sha256,
            expectedUpdatedAt: liveReceipt.updatedAt,
          }
        );

        if (
          !liveCandidateCheck.ok ||
          !areQuarantineReviewCandidatesSameSourceVersion(
            validatedCandidate,
            liveCandidateCheck.candidate
          )
        ) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              'STALE_SOURCE_HOLD',
              STORE_SAFE_MESSAGES.TX_SOURCE_CANDIDATE_MISMATCH,
              createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
            )
          );
        }

        // 2. Inspect target draft snapshot
        if (draftSnapshot && draftSnapshot.exists) {
          if (
            draftSnapshot.id !== undefined &&
            draftSnapshot.id !== receiptId
          ) {
            throw new InternalDraftStoreTransactionAbortError(
              makeDraftStoreFailure(
                'EXISTING_DRAFT_CONFLICT_HOLD',
                STORE_SAFE_MESSAGES.TX_EXISTING_DRAFT_ID_MISMATCH,
                createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
              )
            );
          }

          const persistedDraftCheck =
            validatePersistedLibraryQuarantineReviewDraft(
              draftSnapshot.data(),
              receiptId
            );
          if (!persistedDraftCheck.ok) {
            throw new InternalDraftStoreTransactionAbortError(
              makeDraftStoreFailure(
                persistedDraftCheck.errorCode === 'SECURITY_FLAG_ESCALATION'
                  ? 'SECURITY_FLAG_ESCALATION'
                  : 'CORRUPTED_PERSISTED_DRAFT',
                STORE_SAFE_MESSAGES.TX_EXISTING_DRAFT_CORRUPTED,
                createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
              )
            );
          }

          const existingDraft = persistedDraftCheck.draft;
          if (
            !doesPersistedReviewDraftMatchCandidateAndSource(
              existingDraft,
              liveCandidateCheck.candidate,
              liveEnvelope
            )
          ) {
            throw new InternalDraftStoreTransactionAbortError(
              makeDraftStoreFailure(
                'EXISTING_DRAFT_CONFLICT_HOLD',
                STORE_SAFE_MESSAGES.TX_EXISTING_DRAFT_SOURCE_CONFLICT,
                createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
              )
            );
          }

          return Object.freeze({
            ok: true as const,
            disposition: 'IDEMPOTENT_EXISTING' as const,
            draftCreationOutcome: 'IDEMPOTENT_EXISTING' as const,
            created: false as const,
            draftCreated: false as const,
            draft: existingDraft,
            sourceRevision: liveEnvelope.revision,
            deferredGates: LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES,
          });
        }

        // 3. Create new draft document once via transaction.create (zero receipt writes)
        const candidateDraft: LibraryQuarantinePersistedReviewDraft =
          Object.freeze({
            schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
            receiptId,
            sourceRevision: liveEnvelope.revision,
            sourceUpdatedAt: liveReceipt.updatedAt,
            sourceSha256: liveReceipt.sha256,
            format: liveReceipt.format,
            uploaderUid: liveReceipt.uploaderUid,
            reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
            isSanitized: false as const,
            isVerifiedSafe: false as const,
            isRightsApproved: false as const,
            isPublished: false as const,
            isReadyForPeia: false as const,
            createdBy,
            createdAt,
          });

        const selfValidation = validatePersistedLibraryQuarantineReviewDraft(
          candidateDraft,
          receiptId
        );
        if (!selfValidation.ok) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              selfValidation.errorCode,
              selfValidation.errorMessage,
              createStagedInAnyAttempt ? 'UNKNOWN' : 'NOT_CREATED'
            )
          );
        }

        txCreateCount += 1;
        if (txCreateCount > 1) {
          throw new InternalDraftStoreTransactionAbortError(
            makeDraftStoreFailure(
              'TRANSACTION_CONFLICT_OR_FAILURE',
              STORE_SAFE_MESSAGES.TX_WRITE_BUDGET_EXCEEDED,
              'UNKNOWN'
            )
          );
        }

        const serialized = serializeReviewDraftForFirestore(
          selfValidation.draft
        );
        createStagedInAnyAttempt = true;
        transaction.create(draftDocRef, serialized);

        return Object.freeze({
          ok: true as const,
          disposition: 'CREATED' as const,
          draftCreationOutcome: 'CREATED' as const,
          created: true as const,
          draftCreated: true as const,
          draft: selfValidation.draft,
          sourceRevision: liveEnvelope.revision,
          deferredGates: LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES,
        });
      });
    } catch (err) {
      if (
        err instanceof InternalDraftStoreTransactionAbortError &&
        !createStagedInAnyAttempt
      ) {
        return err.failure;
      }
      return makeDraftStoreFailure(
        'TRANSACTION_CONFLICT_OR_FAILURE',
        STORE_SAFE_MESSAGES.TX_FAILED_OR_CONFLICTED,
        'UNKNOWN'
      );
    }
  }
}
