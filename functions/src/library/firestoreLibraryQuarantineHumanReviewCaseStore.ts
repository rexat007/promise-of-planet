import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION as LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot as LibraryQuarantineReviewDraftFirestoreDocumentSnapshot,
  type LibraryQuarantinePersistedReceiptEnvelope,
  validatePersistedLibraryQuarantineReceiptEnvelope,
} from './firestoreLibraryQuarantineReceiptStore';

export type LibraryQuarantineFirestoreDocumentData = Record<string, unknown>;
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION as LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
  type LibraryQuarantinePersistedReviewDraft,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftFirestoreTransaction,
  validatePersistedLibraryQuarantineReviewDraft,
} from './firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENT_SCHEMA_VERSION,
  deriveLibraryQuarantineHumanReviewEventId,
  validateHumanReviewCaseEditorialInput,
  validatePersistedLibraryQuarantineHumanReviewCase,
  validatePersistedLibraryQuarantineHumanReviewEvent,
  type LibraryQuarantineHumanReviewContractErrorCode,
  type LibraryQuarantinePersistedHumanReviewCase,
  type LibraryQuarantinePersistedHumanReviewEvent,
  type SaveLibraryQuarantineHumanReviewCaseEditorialInput,
} from './libraryQuarantineHumanReviewCaseContract';
import {
  LibraryQuarantineReceiptState,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  toSanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';

/**
 * LIB-FILE-HUMAN-CASEWORK-01 — Private Firestore Store for Human Review Cases & Audit Events
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Persists human review case records in `library_quarantine_human_review_cases/<receiptId>`
 *   and append-only, non-replaceable audit events in
 *   `library_quarantine_human_review_events/<receiptId>_<revision>`.
 * - Performs point lookups ONLY (`.doc(id)`); never executes unbounded collection scans.
 * - Executes case creation/update and audit event creation inside ONE atomic Firestore
 *   transaction after reading:
 *     1. `library_quarantine_receipts/<receiptId>`
 *     2. `library_quarantine_review_drafts/<receiptId>`
 *     3. `library_quarantine_human_review_cases/<receiptId>`
 *     4. `library_quarantine_human_review_events/<receiptId>_<targetRevision>`
 *   BEFORE any transaction write.
 * - Enforces compare-and-swap (`expectedRevision = 0` for initial creation;
 *   `expectedRevision = existingCase.revision` for updates).
 * - Never writes to `library_quarantine_receipts`, `library_quarantine_review_drafts`,
 *   Google Cloud Storage, `library_documents`, `library_intake`, or PEIA collections.
 * - Fail-closed commit uncertainty: if the transaction throws or loses commit confirmation
 *   after staging writes, returns `status: 'UNKNOWN'`, `caseSaveOutcome: 'UNKNOWN'`,
 *   `caseSaved: null` (never falsely reporting `caseSaved: false`).
 */

export const LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION =
  'library_quarantine_human_review_cases' as const;

export const LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION =
  'library_quarantine_human_review_events' as const;

const FORBIDDEN_CASE_STORE_WRITE_COLLECTIONS: ReadonlySet<string> = new Set([
  LIBRARY_QUARANTINE_RECEIPTS_COLLECTION,
  LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION,
  'library_documents',
  'library_intake',
  'peia_documents',
  'peia_bundles',
]);

export type LibraryQuarantineHumanReviewCaseErrorCode =
  | LibraryQuarantineHumanReviewContractErrorCode
  | 'INVALID_RECEIPT_ID'
  | 'INVALID_EXPECTED_REVISION'
  | 'INVALID_ACTOR_UID'
  | 'INVALID_TIMESTAMP'
  | 'DOCUMENT_ID_MISMATCH'
  | 'SOURCE_RECEIPT_NOT_FOUND'
  | 'CORRUPTED_SOURCE_RECEIPT'
  | 'SECURITY_POSTURE_VIOLATION'
  | 'RECEIPT_NEEDS_RECONCILIATION'
  | 'RECEIPT_NOT_ELIGIBLE_FOR_HUMAN_REVIEW'
  | 'REVIEW_DRAFT_NOT_LINKED'
  | 'CORRUPTED_REVIEW_DRAFT'
  | 'DRAFT_SOURCE_MISMATCH'
  | 'CORRUPTED_EXISTING_HUMAN_REVIEW_CASE'
  | 'CASE_SOURCE_STALE_OR_MISMATCHED'
  | 'CASE_REVISION_CONFLICT'
  | 'AUDIT_EVENT_ALREADY_EXISTS'
  | 'TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION'
  | 'TRANSACTION_ABORTED_NO_WRITE'
  | 'TRANSACTION_COMMIT_UNCERTAIN'
  | 'STORE_READ_FAILED';

export const HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineHumanReviewCaseErrorCode, string>
> = Object.freeze({
  INVALID_CASE_INPUT_OBJECT:
    'Human review case input must be a plain object with allowed editorial fields only.',
  UNTRUSTED_OR_FORBIDDEN_CASE_FIELD:
    'Human review case payload contains an unexpected, privileged, or forbidden property.',
  INVALID_CASE_STATUS:
    'Human review case status must be one of IN_REVIEW, NEEDS_INFORMATION, METADATA_RECORDED, or NOT_SUITABLE.',
  INVALID_PLAIN_TEXT_FIELD:
    'Human review case text fields must be plain text without HTML tags, control characters, or forbidden URI schemes.',
  FIELD_MAX_LENGTH_EXCEEDED:
    'One or more human review case text fields exceed the maximum permitted character length.',
  METADATA_RECORDED_REQUIREMENTS_NOT_MET:
    'METADATA_RECORDED requires at least one document title (Arabic or English) and non-empty source evidence notes.',
  JUSTIFICATION_NOTES_REQUIRED:
    'NEEDS_INFORMATION and NOT_SUITABLE require non-empty reviewer editorial justification notes.',
  EMPTY_REVIEW_CASE_NOT_ALLOWED:
    'Human review case must include at least one non-empty descriptive field or reviewer note.',
  INVALID_PERSISTED_CASE_SCHEMA:
    'Persisted human review case failed strict 20-field schema or integrity validation.',
  INVALID_PERSISTED_EVENT_SCHEMA:
    'Persisted human review audit event failed strict 21-field schema or integrity validation.',
  INVALID_RECEIPT_ID:
    'Quarantine receiptId must be a lowercase 32-character hexadecimal identifier.',
  INVALID_EXPECTED_REVISION:
    'expectedRevision must be a non-negative safe integer (0 for initial case creation).',
  INVALID_ACTOR_UID:
    'Reviewer actorUid must be a valid authenticated Firebase user identifier.',
  INVALID_TIMESTAMP:
    'Human review case timestamp must be a canonical UTC ISO-8601 string.',
  DOCUMENT_ID_MISMATCH:
    'Firestore document identifier does not match the expected human review record key.',
  SOURCE_RECEIPT_NOT_FOUND:
    'Authoritative quarantine receipt does not exist in library_quarantine_receipts.',
  CORRUPTED_SOURCE_RECEIPT:
    'Authoritative quarantine receipt failed strict envelope schema validation.',
  SECURITY_POSTURE_VIOLATION:
    'Source quarantine receipt or review draft violated non-assurance security posture invariants.',
  RECEIPT_NEEDS_RECONCILIATION:
    'Quarantine receipt requires storage reconciliation and is held from human case review.',
  RECEIPT_NOT_ELIGIBLE_FOR_HUMAN_REVIEW:
    'Quarantine receipt is not in an eligible Quarantined state with verified private storage write.',
  REVIEW_DRAFT_NOT_LINKED:
    'Quarantine receipt does not have a linked PENDING_HUMAN_REVIEW draft record.',
  CORRUPTED_REVIEW_DRAFT:
    'Linked quarantine review draft failed strict 15-field schema validation.',
  DRAFT_SOURCE_MISMATCH:
    'Linked quarantine review draft does not match the authoritative source receipt identity or revision.',
  CORRUPTED_EXISTING_HUMAN_REVIEW_CASE:
    'Existing persisted human review case failed strict 20-field schema validation.',
  CASE_SOURCE_STALE_OR_MISMATCHED:
    'Existing human review case does not match the current source receipt or linked draft revision.',
  CASE_REVISION_CONFLICT:
    'Human review case revision changed concurrently; reload the latest case record before saving.',
  AUDIT_EVENT_ALREADY_EXISTS:
    'Append-only human review audit event for the target revision already exists; refusing to overwrite.',
  TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION:
    'Human review case timestamp cannot precede the source receipt, linked draft, or prior case revision timestamp.',
  TRANSACTION_ABORTED_NO_WRITE:
    'Human review case transaction aborted before any write was committed.',
  TRANSACTION_COMMIT_UNCERTAIN:
    'Human review case transaction commit acknowledgement was lost after staging writes; outcome is uncertain.',
  STORE_READ_FAILED:
    'Point lookup of human review case failed in Firestore.',
});

export interface GetLibraryQuarantineHumanReviewCaseStoreSuccess {
  readonly ok: true;
  readonly reviewCase: LibraryQuarantinePersistedHumanReviewCase | null;
}

export interface GetLibraryQuarantineHumanReviewCaseStoreFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineHumanReviewCaseErrorCode;
  readonly errorMessage: string;
}

export type GetLibraryQuarantineHumanReviewCaseStoreResult =
  | GetLibraryQuarantineHumanReviewCaseStoreSuccess
  | GetLibraryQuarantineHumanReviewCaseStoreFailure;

export interface GetLibraryQuarantineHumanReviewEventStoreSuccess {
  readonly ok: true;
  readonly reviewEvent: LibraryQuarantinePersistedHumanReviewEvent | null;
}

export type GetLibraryQuarantineHumanReviewEventStoreResult =
  | GetLibraryQuarantineHumanReviewEventStoreSuccess
  | GetLibraryQuarantineHumanReviewCaseStoreFailure;

export interface SaveLibraryQuarantineHumanReviewCaseStoreInput {
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly actorUid: string;
  readonly nowIso: string;
  readonly input: SaveLibraryQuarantineHumanReviewCaseEditorialInput;
}

export interface SaveLibraryQuarantineHumanReviewCaseSavedResult {
  readonly status: 'SAVED';
  readonly caseSaveOutcome: 'CREATED' | 'UPDATED';
  readonly caseSaved: true;
  readonly receiptId: string;
  readonly currentRevision: number;
  readonly reviewCase: LibraryQuarantinePersistedHumanReviewCase;
  readonly reviewEvent: LibraryQuarantinePersistedHumanReviewEvent;
  readonly receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
}

export interface SaveLibraryQuarantineHumanReviewCaseConflictResult {
  readonly status: 'CONFLICT';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly receiptId: string;
  readonly reasonCode: 'CASE_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly currentRevision: number;
  readonly currentCase: LibraryQuarantinePersistedHumanReviewCase | null;
  readonly receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
}

export interface SaveLibraryQuarantineHumanReviewCaseHoldResult {
  readonly status: 'HOLD';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly receiptId: string;
  readonly reasonCode: LibraryQuarantineHumanReviewCaseErrorCode;
  readonly errorMessage: string;
}

export interface SaveLibraryQuarantineHumanReviewCaseUnknownResult {
  readonly status: 'UNKNOWN';
  readonly caseSaveOutcome: 'UNKNOWN';
  readonly caseSaved: null;
  readonly receiptId: string;
  readonly reasonCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
}

export type SaveLibraryQuarantineHumanReviewCaseStoreResult =
  | SaveLibraryQuarantineHumanReviewCaseSavedResult
  | SaveLibraryQuarantineHumanReviewCaseConflictResult
  | SaveLibraryQuarantineHumanReviewCaseHoldResult
  | SaveLibraryQuarantineHumanReviewCaseUnknownResult;

export interface LibraryQuarantineHumanReviewCaseStore {
  getHumanReviewCaseByReceiptId(
    receiptId: string
  ): Promise<GetLibraryQuarantineHumanReviewCaseStoreResult>;

  getHumanReviewEventById(
    receiptId: string,
    revision: number
  ): Promise<GetLibraryQuarantineHumanReviewEventStoreResult>;

  saveHumanReviewCaseAtomically(
    params: SaveLibraryQuarantineHumanReviewCaseStoreInput
  ): Promise<SaveLibraryQuarantineHumanReviewCaseStoreResult>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function makeHoldResult(
  receiptId: string,
  reasonCode: LibraryQuarantineHumanReviewCaseErrorCode
): SaveLibraryQuarantineHumanReviewCaseHoldResult {
  return Object.freeze({
    status: 'HOLD' as const,
    caseSaveOutcome: 'NOT_SAVED' as const,
    caseSaved: false as const,
    receiptId: typeof receiptId === 'string' ? receiptId : '',
    reasonCode,
    errorMessage: HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES[reasonCode],
  });
}

function makeUnknownResult(
  receiptId: string
): SaveLibraryQuarantineHumanReviewCaseUnknownResult {
  return Object.freeze({
    status: 'UNKNOWN' as const,
    caseSaveOutcome: 'UNKNOWN' as const,
    caseSaved: null,
    receiptId: typeof receiptId === 'string' ? receiptId : '',
    reasonCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
    errorMessage:
      HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
  });
}

function toFirestoreDocumentData(
  record:
    | LibraryQuarantinePersistedHumanReviewCase
    | LibraryQuarantinePersistedHumanReviewEvent
): LibraryQuarantineFirestoreDocumentData {
  return { ...(record as unknown as Record<string, unknown>) };
}

/**
 * Validates that the source receipt envelope AND linked review draft are both
 * intact, eligible (`Quarantined` + `PENDING_HUMAN_REVIEW`), consistent with
 * each other, and preserve all 5 non-assurance security posture flags (`false`).
 */
export function verifyReceiptAndDraftEligibleForHumanReviewCase(
  receiptId: string,
  receiptSnap: LibraryQuarantineReviewDraftFirestoreDocumentSnapshot,
  draftSnap: LibraryQuarantineReviewDraftFirestoreDocumentSnapshot
):
  | {
      readonly ok: true;
      readonly receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
      readonly reviewDraft: LibraryQuarantinePersistedReviewDraft;
    }
  | {
      readonly ok: false;
      readonly reasonCode: LibraryQuarantineHumanReviewCaseErrorCode;
    } {
  if (!receiptSnap.exists) {
    return { ok: false, reasonCode: 'SOURCE_RECEIPT_NOT_FOUND' };
  }
  if (receiptSnap.id !== receiptId) {
    return { ok: false, reasonCode: 'DOCUMENT_ID_MISMATCH' };
  }

  const persistedCheck = validatePersistedLibraryQuarantineReceiptEnvelope(
    receiptSnap.data(),
    receiptId
  );
  if (!persistedCheck.ok) {
    if (persistedCheck.errorCode === 'SECURITY_FLAG_ESCALATION') {
      return { ok: false, reasonCode: 'SECURITY_POSTURE_VIOLATION' };
    }
    return { ok: false, reasonCode: 'CORRUPTED_SOURCE_RECEIPT' };
  }

  const receiptEnvelope = persistedCheck.envelope;
  const receipt = receiptEnvelope.receipt;
  if (
    receipt.isSanitized !== false ||
    receipt.isVerifiedSafe !== false ||
    receipt.isRightsApproved !== false ||
    receipt.isPublished !== false ||
    receipt.isReadyForPeia !== false
  ) {
    return { ok: false, reasonCode: 'SECURITY_POSTURE_VIOLATION' };
  }

  const dtoCheck = toSanitizedLibraryQuarantineAdminReceiptDto(receipt);
  if (!dtoCheck.ok) {
    if (dtoCheck.errorCode === 'SECURITY_INVARIANT_VIOLATION') {
      return { ok: false, reasonCode: 'SECURITY_POSTURE_VIOLATION' };
    }
    return { ok: false, reasonCode: 'CORRUPTED_SOURCE_RECEIPT' };
  }
  const adminReceipt = dtoCheck.dto;

  if (
    adminReceipt.state === LibraryQuarantineReceiptState.NeedsReconciliation ||
    adminReceipt.reconciliationRequired === true
  ) {
    return { ok: false, reasonCode: 'RECEIPT_NEEDS_RECONCILIATION' };
  }

  if (
    adminReceipt.state !== LibraryQuarantineReceiptState.Quarantined ||
    adminReceipt.hasVerifiedStorageWrite !== true ||
    adminReceipt.isQuarantinedPrivateOnly !== true ||
    adminReceipt.reconciliationReason !== null ||
    adminReceipt.rejectionReasonCode !== null
  ) {
    return { ok: false, reasonCode: 'RECEIPT_NOT_ELIGIBLE_FOR_HUMAN_REVIEW' };
  }

  if (!draftSnap.exists) {
    return { ok: false, reasonCode: 'REVIEW_DRAFT_NOT_LINKED' };
  }
  if (draftSnap.id !== receiptId) {
    return { ok: false, reasonCode: 'DOCUMENT_ID_MISMATCH' };
  }

  const draftValidation = validatePersistedLibraryQuarantineReviewDraft(
    draftSnap.data(),
    receiptId
  );
  if (!draftValidation.ok) {
    if (draftValidation.errorCode === 'SECURITY_FLAG_ESCALATION') {
      return { ok: false, reasonCode: 'SECURITY_POSTURE_VIOLATION' };
    }
    return { ok: false, reasonCode: 'CORRUPTED_REVIEW_DRAFT' };
  }

  const reviewDraft = draftValidation.draft;
  if (
    reviewDraft.isSanitized !== false ||
    reviewDraft.isVerifiedSafe !== false ||
    reviewDraft.isRightsApproved !== false ||
    reviewDraft.isPublished !== false ||
    reviewDraft.isReadyForPeia !== false ||
    reviewDraft.reviewState !== LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE
  ) {
    return { ok: false, reasonCode: 'SECURITY_POSTURE_VIOLATION' };
  }

  if (
    reviewDraft.receiptId !== receipt.receiptId ||
    reviewDraft.sourceRevision !== receiptEnvelope.revision ||
    reviewDraft.sourceUpdatedAt !== receipt.updatedAt ||
    reviewDraft.sourceSha256 !== receipt.sha256 ||
    reviewDraft.format !== receipt.format ||
    reviewDraft.uploaderUid !== receipt.uploaderUid
  ) {
    return { ok: false, reasonCode: 'DRAFT_SOURCE_MISMATCH' };
  }

  return Object.freeze({
    ok: true as const,
    receiptEnvelope,
    reviewDraft,
  });
}

export class FirestoreLibraryQuarantineHumanReviewCaseStore
  implements LibraryQuarantineHumanReviewCaseStore
{
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;

  constructor(db: LibraryQuarantineReviewDraftFirestoreDatabase) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      throw new Error(
        'INVALID_FIRESTORE_DEPENDENCY: HumanReviewCaseStore requires a Firestore database with collection() and runTransaction().'
      );
    }
    this.db = db;
  }

  private assertAllowedWriteCollection(collectionName: string): void {
    if (
      FORBIDDEN_CASE_STORE_WRITE_COLLECTIONS.has(collectionName) ||
      (collectionName !== LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION &&
        collectionName !== LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION)
    ) {
      throw new Error(
        `FORBIDDEN_COLLECTION_WRITE: Attempted to write to collection "${collectionName}".`
      );
    }
  }

  async getHumanReviewCaseByReceiptId(
    receiptId: string
  ): Promise<GetLibraryQuarantineHumanReviewCaseStoreResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_RECEIPT_ID' as const,
        errorMessage: HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.INVALID_RECEIPT_ID,
      });
    }

    let snap: LibraryQuarantineReviewDraftFirestoreDocumentSnapshot;
    try {
      const ref = this.db
        .collection(LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION)
        .doc(receiptId);
      if (typeof ref.get !== 'function') {
        throw new Error('Document reference must provide get()');
      }
      snap = await ref.get();
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }

    if (!snap.exists) {
      return Object.freeze({
        ok: true as const,
        reviewCase: null,
      });
    }

    if (snap.id !== receiptId) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'DOCUMENT_ID_MISMATCH' as const,
        errorMessage:
          HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
      });
    }

    const validated = validatePersistedLibraryQuarantineHumanReviewCase(
      snap.data(),
      receiptId
    );
    if (!validated.ok) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'CORRUPTED_EXISTING_HUMAN_REVIEW_CASE' as const,
        errorMessage:
          HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.CORRUPTED_EXISTING_HUMAN_REVIEW_CASE,
      });
    }

    return Object.freeze({
      ok: true as const,
      reviewCase: validated.reviewCase,
    });
  }

  async getHumanReviewEventById(
    receiptId: string,
    revision: number
  ): Promise<GetLibraryQuarantineHumanReviewEventStoreResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_RECEIPT_ID' as const,
        errorMessage: HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.INVALID_RECEIPT_ID,
      });
    }
    if (
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_EXPECTED_REVISION' as const,
        errorMessage:
          HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.INVALID_EXPECTED_REVISION,
      });
    }

    const eventId = deriveLibraryQuarantineHumanReviewEventId(
      receiptId,
      revision
    );

    let snap: LibraryQuarantineReviewDraftFirestoreDocumentSnapshot;
    try {
      const ref = this.db
        .collection(LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION)
        .doc(eventId);
      if (typeof ref.get !== 'function') {
        throw new Error('Document reference must provide get()');
      }
      snap = await ref.get();
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }

    if (!snap.exists) {
      return Object.freeze({
        ok: true as const,
        reviewEvent: null,
      });
    }

    if (snap.id !== eventId) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'DOCUMENT_ID_MISMATCH' as const,
        errorMessage:
          HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
      });
    }

    const validated = validatePersistedLibraryQuarantineHumanReviewEvent(
      snap.data(),
      eventId
    );
    if (!validated.ok) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_PERSISTED_EVENT_SCHEMA' as const,
        errorMessage:
          HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.INVALID_PERSISTED_EVENT_SCHEMA,
      });
    }

    return Object.freeze({
      ok: true as const,
      reviewEvent: validated.reviewEvent,
    });
  }

  async saveHumanReviewCaseAtomically(
    rawParams: SaveLibraryQuarantineHumanReviewCaseStoreInput
  ): Promise<SaveLibraryQuarantineHumanReviewCaseStoreResult> {
    if (
      !isPlainObject(rawParams) ||
      Object.getOwnPropertySymbols(rawParams).length > 0
    ) {
      return makeHoldResult('', 'INVALID_CASE_INPUT_OBJECT');
    }

    const { receiptId, expectedRevision, actorUid, nowIso, input } = rawParams;

    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeHoldResult(
        typeof receiptId === 'string' ? receiptId : '',
        'INVALID_RECEIPT_ID'
      );
    }

    if (
      typeof expectedRevision !== 'number' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return makeHoldResult(receiptId, 'INVALID_EXPECTED_REVISION');
    }

    if (!isValidUploaderUid(actorUid)) {
      return makeHoldResult(receiptId, 'INVALID_ACTOR_UID');
    }

    if (!isValidIsoUtcTimestamp(nowIso)) {
      return makeHoldResult(receiptId, 'INVALID_TIMESTAMP');
    }

    const editorialValidation = validateHumanReviewCaseEditorialInput(input);
    if (!editorialValidation.ok) {
      return makeHoldResult(receiptId, editorialValidation.errorCode);
    }
    const normalizedEditorial = editorialValidation.value;

    const targetRevision = expectedRevision + 1;
    const targetEventId = deriveLibraryQuarantineHumanReviewEventId(
      receiptId,
      targetRevision
    );

    const receiptRef = this.db
      .collection(LIBRARY_QUARANTINE_RECEIPTS_COLLECTION)
      .doc(receiptId);
    const draftRef = this.db
      .collection(LIBRARY_QUARANTINE_REVIEW_DRAFTS_COLLECTION)
      .doc(receiptId);
    const caseRef = this.db
      .collection(LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION)
      .doc(receiptId);
    const eventRef = this.db
      .collection(LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION)
      .doc(targetEventId);

    let writeStagedInAnyAttempt = false;

    try {
      const txResult =
        await this.db.runTransaction<SaveLibraryQuarantineHumanReviewCaseStoreResult>(
          async (tx: LibraryQuarantineReviewDraftFirestoreTransaction) => {
            // STEP 1: Read receipt, review draft, existing case, and target audit event BEFORE any write.
            const receiptSnap = await tx.get(receiptRef);
            const draftSnap = await tx.get(draftRef);
            const caseSnap = await tx.get(caseRef);
            const eventSnap = await tx.get(eventRef);

            // STEP 2: Verify receipt and linked review draft integrity & eligibility.
            const eligibility = verifyReceiptAndDraftEligibleForHumanReviewCase(
              receiptId,
              receiptSnap,
              draftSnap
            );
            if (!eligibility.ok) {
              return makeHoldResult(receiptId, eligibility.reasonCode);
            }

            const { receiptEnvelope, reviewDraft } = eligibility;
            const receipt = receiptEnvelope.receipt;

            // STEP 3: Validate existing case (if any) and compare-and-swap `expectedRevision`.
            let existingCase: LibraryQuarantinePersistedHumanReviewCase | null =
              null;

            if (caseSnap.exists) {
              if (caseSnap.id !== receiptId) {
                return makeHoldResult(receiptId, 'DOCUMENT_ID_MISMATCH');
              }

              const existingValidation =
                validatePersistedLibraryQuarantineHumanReviewCase(
                  caseSnap.data(),
                  receiptId
                );
              if (!existingValidation.ok) {
                return makeHoldResult(
                  receiptId,
                  'CORRUPTED_EXISTING_HUMAN_REVIEW_CASE'
                );
              }
              existingCase = existingValidation.reviewCase;

              if (
                existingCase.sourceRevision !== receiptEnvelope.revision ||
                existingCase.sourceUpdatedAt !== receipt.updatedAt ||
                existingCase.sourceSha256 !== receipt.sha256 ||
                existingCase.draftSourceRevision !== reviewDraft.sourceRevision
              ) {
                return makeHoldResult(
                  receiptId,
                  'CASE_SOURCE_STALE_OR_MISMATCHED'
                );
              }

              if (expectedRevision !== existingCase.revision) {
                return Object.freeze({
                  status: 'CONFLICT' as const,
                  caseSaveOutcome: 'NOT_SAVED' as const,
                  caseSaved: false as const,
                  receiptId,
                  reasonCode: 'CASE_REVISION_CONFLICT' as const,
                  errorMessage:
                    HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.CASE_REVISION_CONFLICT,
                  currentRevision: existingCase.revision,
                  currentCase: existingCase,
                  receiptEnvelope,
                });
              }
            } else {
              if (expectedRevision !== 0) {
                return Object.freeze({
                  status: 'CONFLICT' as const,
                  caseSaveOutcome: 'NOT_SAVED' as const,
                  caseSaved: false as const,
                  receiptId,
                  reasonCode: 'CASE_REVISION_CONFLICT' as const,
                  errorMessage:
                    HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES.CASE_REVISION_CONFLICT,
                  currentRevision: 0,
                  currentCase: null,
                  receiptEnvelope,
                });
              }
            }

            // STEP 4: Ensure target append-only audit event does not already exist.
            if (eventSnap.exists) {
              return makeHoldResult(receiptId, 'AUDIT_EVENT_ALREADY_EXISTS');
            }

            // STEP 5: Enforce monotonic timestamps against source receipt, draft, and prior case revision.
            const nowMs = Date.parse(nowIso);
            const receiptUpdatedMs = Date.parse(receipt.updatedAt);
            const draftCreatedMs = Date.parse(reviewDraft.createdAt);
            const priorCaseUpdatedMs = existingCase
              ? Date.parse(existingCase.updatedAt)
              : -Infinity;

            if (
              nowMs < receiptUpdatedMs ||
              nowMs < draftCreatedMs ||
              nowMs < priorCaseUpdatedMs
            ) {
              return makeHoldResult(
                receiptId,
                'TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION'
              );
            }

            // STEP 6: Construct and strictly validate the 20-field case record and 21-field audit event.
            const createdBy = existingCase ? existingCase.createdBy : actorUid;
            const createdAt = existingCase ? existingCase.createdAt : nowIso;

            const candidateCase: LibraryQuarantinePersistedHumanReviewCase =
              Object.freeze({
                schemaVersion:
                  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
                receiptId,
                sourceRevision: receiptEnvelope.revision,
                sourceUpdatedAt: receipt.updatedAt,
                sourceSha256: receipt.sha256,
                draftSourceRevision: reviewDraft.sourceRevision,
                revision: targetRevision,
                status: normalizedEditorial.status,
                titleAr: normalizedEditorial.titleAr,
                titleEn: normalizedEditorial.titleEn,
                issuingOrganization: normalizedEditorial.issuingOrganization,
                summaryAr: normalizedEditorial.summaryAr,
                summaryEn: normalizedEditorial.summaryEn,
                sourceEvidenceNotes: normalizedEditorial.sourceEvidenceNotes,
                rightsEvidenceNotes: normalizedEditorial.rightsEvidenceNotes,
                editorialNotes: normalizedEditorial.editorialNotes,
                createdBy,
                createdAt,
                updatedBy: actorUid,
                updatedAt: nowIso,
              });

            const caseCheck = validatePersistedLibraryQuarantineHumanReviewCase(
              candidateCase,
              receiptId
            );
            if (!caseCheck.ok) {
              return makeHoldResult(receiptId, 'INVALID_PERSISTED_CASE_SCHEMA');
            }

            const eventType =
              expectedRevision === 0
                ? ('CREATED' as const)
                : ('UPDATED' as const);

            const candidateEvent: LibraryQuarantinePersistedHumanReviewEvent =
              Object.freeze({
                schemaVersion:
                  LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENT_SCHEMA_VERSION,
                eventId: targetEventId,
                receiptId,
                revision: targetRevision,
                previousRevision: expectedRevision,
                eventType,
                sourceRevision: receiptEnvelope.revision,
                sourceUpdatedAt: receipt.updatedAt,
                sourceSha256: receipt.sha256,
                draftSourceRevision: reviewDraft.sourceRevision,
                status: normalizedEditorial.status,
                titleAr: normalizedEditorial.titleAr,
                titleEn: normalizedEditorial.titleEn,
                issuingOrganization: normalizedEditorial.issuingOrganization,
                summaryAr: normalizedEditorial.summaryAr,
                summaryEn: normalizedEditorial.summaryEn,
                sourceEvidenceNotes: normalizedEditorial.sourceEvidenceNotes,
                rightsEvidenceNotes: normalizedEditorial.rightsEvidenceNotes,
                editorialNotes: normalizedEditorial.editorialNotes,
                actorUid,
                recordedAt: nowIso,
              });

            const eventCheck =
              validatePersistedLibraryQuarantineHumanReviewEvent(
                candidateEvent,
                targetEventId
              );
            if (!eventCheck.ok) {
              return makeHoldResult(
                receiptId,
                'INVALID_PERSISTED_EVENT_SCHEMA'
              );
            }

            // STEP 7: Stage atomic writes ONLY to human review case and append-only event collections.
            this.assertAllowedWriteCollection(
              LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION
            );
            this.assertAllowedWriteCollection(
              LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENTS_COLLECTION
            );

            writeStagedInAnyAttempt = true;

            if (expectedRevision === 0) {
              tx.create(caseRef, toFirestoreDocumentData(caseCheck.reviewCase));
            } else {
              const txWithUpdate = tx as LibraryQuarantineReviewDraftFirestoreTransaction & {
                update?: (
                  documentRef: LibraryQuarantineFirestoreDocumentRef,
                  data: LibraryQuarantineFirestoreDocumentData
                ) => unknown;
              };
              if (typeof txWithUpdate.update !== 'function') {
                throw new Error(
                  'TRANSACTION_UPDATE_UNSUPPORTED: Firestore transaction must support update().'
                );
              }
              txWithUpdate.update(
                caseRef,
                toFirestoreDocumentData(caseCheck.reviewCase)
              );
            }

            tx.create(
              eventRef,
              toFirestoreDocumentData(eventCheck.reviewEvent)
            );

            return Object.freeze({
              status: 'SAVED' as const,
              caseSaveOutcome:
                expectedRevision === 0
                  ? ('CREATED' as const)
                  : ('UPDATED' as const),
              caseSaved: true as const,
              receiptId,
              currentRevision: targetRevision,
              reviewCase: caseCheck.reviewCase,
              reviewEvent: eventCheck.reviewEvent,
              receiptEnvelope,
            });
          }
        );

      if (!txResult || typeof txResult !== 'object') {
        return writeStagedInAnyAttempt
          ? makeUnknownResult(receiptId)
          : makeHoldResult(receiptId, 'TRANSACTION_ABORTED_NO_WRITE');
      }

      return txResult;
    } catch {
      if (writeStagedInAnyAttempt) {
        return makeUnknownResult(receiptId);
      }
      return makeHoldResult(receiptId, 'TRANSACTION_ABORTED_NO_WRITE');
    }
  }
}
