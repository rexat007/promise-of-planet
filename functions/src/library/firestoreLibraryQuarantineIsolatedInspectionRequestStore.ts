import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftFirestoreTransaction,
} from './firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
  type LibraryQuarantineFirestoreDocumentData,
} from './firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  deriveQuarantineCatalogDocumentId,
} from './libraryQuarantineCatalogHandoffService';
import { LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION } from './libraryQuarantineCatalogCaseAlignmentService';
import {
  BINARY_SAFETY_STORE_SAFE_MESSAGES,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
  verifyQuarantineBinarySafetyChainSnapshots,
  type LibraryQuarantineBinarySafetyCaseStoreErrorCode,
  type VerifiedQuarantineBinarySafetyChainSnapshot,
} from './firestoreLibraryQuarantineBinarySafetyCaseStore';
import {
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
  arePersistedIsolatedInspectionRequestsIncompatible,
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  isValidRecordIsolatedInspectionConfirmation,
  validatePersistedLibraryQuarantineIsolatedInspectionRequest,
  type LibraryQuarantineIsolatedInspectionConfirmationLiteral,
  type LibraryQuarantineIsolatedInspectionContractErrorCode,
  type LibraryQuarantinePersistedIsolatedInspectionRequest,
} from './libraryQuarantineIsolatedInspectionRequestContract';
import {
  LibraryQuarantineReceiptState,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import { parseCanonicalSafeGcsGeneration } from './gcsLibraryQuarantineStorageAdapter';
import { LIBRARY_UPLOAD_MAX_BYTES } from './libraryUploadBinaryAdmission';
import { isValidSha256Hex } from './libraryQuarantineBinarySafetyCaseContract';

export const LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION =
  'library_quarantine_isolated_inspection_requests' as const;

const ALLOWED_ISOLATED_INSPECTION_WRITE_COLLECTIONS: ReadonlySet<string> =
  new Set([LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION]);

export type LibraryQuarantineIsolatedInspectionStoreErrorCode =
  | LibraryQuarantineBinarySafetyCaseStoreErrorCode
  | LibraryQuarantineIsolatedInspectionContractErrorCode
  | 'INVALID_INSPECTION_REQUEST_INPUT_OBJECT'
  | 'INVALID_EXPECTED_SAFETY_CASE_REVISION'
  | 'CONFIRMATION_LITERAL_REQUIRED_HOLD'
  | 'MISSING_OR_INVALID_SOURCE_GENERATION_HOLD'
  | 'BINARY_SAFETY_CASE_NOT_FOUND_HOLD'
  | 'STALE_BINARY_SAFETY_CASE_HOLD'
  | 'BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD'
  | 'SAFETY_CASE_REVISION_CONFLICT'
  | 'UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD'
  | 'CORRUPTED_EXISTING_INSPECTION_REQUEST'
  | 'INSPECTION_REQUEST_SOURCE_MISMATCH'
  | 'TIMESTAMP_BEFORE_SOURCE_OR_SAFETY_CASE';

export const ISOLATED_INSPECTION_STORE_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineIsolatedInspectionStoreErrorCode, string>
> = Object.freeze({
  ...BINARY_SAFETY_STORE_SAFE_MESSAGES,
  INVALID_PERSISTED_INSPECTION_REQUEST_SCHEMA:
    'Persisted isolated inspection request failed strict 23-field closed schema validation.',
  INVALID_SANITIZED_INSPECTION_REQUEST_DTO:
    'Sanitized isolated inspection request DTO failed strict schema validation.',
  INVALID_INSPECTION_REQUEST_INPUT_OBJECT:
    'Isolated inspection request input must be a plain object with required fields.',
  INVALID_EXPECTED_SAFETY_CASE_REVISION:
    'expectedSafetyCaseRevision must be a positive safe integer (>= 1).',
  CONFIRMATION_LITERAL_REQUIRED_HOLD:
    'Explicit confirmation literal RECORD_INSPECTION_REQUEST_ONLY is required to record an isolated inspection request.',
  MISSING_OR_INVALID_SOURCE_GENERATION_HOLD:
    'Authoritative quarantine receipt is missing a verified canonical GCS generation string.',
  BINARY_SAFETY_CASE_NOT_FOUND_HOLD:
    'A current saved binary safety case is required before recording an isolated inspection request.',
  STALE_BINARY_SAFETY_CASE_HOLD:
    'Existing binary safety case is stale relative to the current human review case or catalog draft; renew the binary safety case first.',
  BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD:
    'Isolated inspection requests can only be recorded when the current binary safety case disposition is ISOLATED_ASSESSMENT_REQUIRED.',
  SAFETY_CASE_REVISION_CONFLICT:
    'Binary safety case revision changed concurrently; reload the latest binary safety case before recording an inspection request.',
  UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD:
    'acknowledgedHumanCaseRevision does not match the current effective aligned human review case revision.',
  CORRUPTED_EXISTING_INSPECTION_REQUEST:
    'Existing persisted isolated inspection request failed strict 23-field schema validation.',
  INSPECTION_REQUEST_SOURCE_MISMATCH:
    'Existing persisted isolated inspection request does not match the current source receipt or binary safety case provenance.',
  TIMESTAMP_BEFORE_SOURCE_OR_SAFETY_CASE:
    'Isolated inspection request timestamp cannot precede the source receipt, linked draft, human review case, catalog handoff, alignment, catalog document, or binary safety case timestamp.',
});

export interface EligibleIsolatedInspectionChainSnapshot {
  readonly chainSnapshot: VerifiedQuarantineBinarySafetyChainSnapshot;
  readonly requestId: string;
  readonly sourceGeneration: string;
  readonly sourceByteSize: number;
  readonly safetyCaseRevision: number;
}

export interface GetLibraryQuarantineIsolatedInspectionSnapshotSuccess {
  readonly ok: true;
  readonly status: 'NOT_RECORDED' | 'RECORDED';
  readonly eligibleChain: EligibleIsolatedInspectionChainSnapshot;
  readonly inspectionRequest: LibraryQuarantinePersistedIsolatedInspectionRequest | null;
}

export interface GetLibraryQuarantineIsolatedInspectionSnapshotFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineIsolatedInspectionStoreErrorCode;
  readonly errorMessage: string;
}

export type GetLibraryQuarantineIsolatedInspectionSnapshotResult =
  | GetLibraryQuarantineIsolatedInspectionSnapshotSuccess
  | GetLibraryQuarantineIsolatedInspectionSnapshotFailure;

export interface RecordLibraryQuarantineIsolatedInspectionStoreInput {
  readonly receiptId: string;
  readonly expectedSafetyCaseRevision: number;
  readonly acknowledgedHumanCaseRevision: number;
  readonly confirmation: LibraryQuarantineIsolatedInspectionConfirmationLiteral;
  readonly actorUid: string;
  readonly nowIso: string;
}

export interface RecordLibraryQuarantineIsolatedInspectionRecordedResult {
  readonly status: 'RECORDED' | 'ALREADY_RECORDED';
  readonly requestOutcome: 'RECORDED' | 'ALREADY_RECORDED';
  readonly requestRecorded: true;
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly inspectionRequest: LibraryQuarantinePersistedIsolatedInspectionRequest;
  readonly eligibleChain: EligibleIsolatedInspectionChainSnapshot;
}

export interface RecordLibraryQuarantineIsolatedInspectionConflictResult {
  readonly status: 'CONFLICT';
  readonly requestOutcome: 'NOT_RECORDED';
  readonly requestRecorded: false;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: 'SAFETY_CASE_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly currentSafetyCaseRevision: number;
  readonly currentEffectiveHumanCaseRevision: number;
}

export interface RecordLibraryQuarantineIsolatedInspectionHoldResult {
  readonly status: 'HOLD';
  readonly requestOutcome: 'NOT_RECORDED';
  readonly requestRecorded: false;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: LibraryQuarantineIsolatedInspectionStoreErrorCode;
  readonly errorMessage: string;
}

export interface RecordLibraryQuarantineIsolatedInspectionUnknownResult {
  readonly status: 'UNKNOWN';
  readonly requestOutcome: 'UNKNOWN';
  readonly requestRecorded: null;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
}

export type RecordLibraryQuarantineIsolatedInspectionStoreResult =
  | RecordLibraryQuarantineIsolatedInspectionRecordedResult
  | RecordLibraryQuarantineIsolatedInspectionConflictResult
  | RecordLibraryQuarantineIsolatedInspectionHoldResult
  | RecordLibraryQuarantineIsolatedInspectionUnknownResult;

export interface LibraryQuarantineIsolatedInspectionRequestStore {
  getIsolatedInspectionRequestSnapshot(
    receiptId: string
  ): Promise<GetLibraryQuarantineIsolatedInspectionSnapshotResult>;
  recordIsolatedInspectionRequestTransactional(
    params: RecordLibraryQuarantineIsolatedInspectionStoreInput
  ): Promise<RecordLibraryQuarantineIsolatedInspectionStoreResult>;
}

class PreWriteIsolatedInspectionAbortError extends Error {
  public readonly reasonCode: LibraryQuarantineIsolatedInspectionStoreErrorCode;

  constructor(reasonCode: LibraryQuarantineIsolatedInspectionStoreErrorCode) {
    super(ISOLATED_INSPECTION_STORE_SAFE_MESSAGES[reasonCode]);
    this.name = 'PreWriteIsolatedInspectionAbortError';
    this.reasonCode = reasonCode;
  }
}

class PreWriteIsolatedInspectionConflictError extends Error {
  public readonly currentSafetyCaseRevision: number;
  public readonly currentEffectiveHumanCaseRevision: number;

  constructor(
    currentSafetyCaseRevision: number,
    currentEffectiveHumanCaseRevision: number
  ) {
    super(
      ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.SAFETY_CASE_REVISION_CONFLICT
    );
    this.name = 'PreWriteIsolatedInspectionConflictError';
    this.currentSafetyCaseRevision = currentSafetyCaseRevision;
    this.currentEffectiveHumanCaseRevision = currentEffectiveHumanCaseRevision;
  }
}

function toFirestoreDocumentData(
  record: LibraryQuarantinePersistedIsolatedInspectionRequest
): LibraryQuarantineFirestoreDocumentData {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    clone[key] = value;
  }
  return clone;
}

export function verifyQuarantineIsolatedInspectionChainEligibility(
  chainSnapshot: VerifiedQuarantineBinarySafetyChainSnapshot
):
  | {
      readonly ok: true;
      readonly eligibleChain: EligibleIsolatedInspectionChainSnapshot;
    }
  | {
      readonly ok: false;
      readonly errorCode: LibraryQuarantineIsolatedInspectionStoreErrorCode;
      readonly errorMessage: string;
    } {
  const receipt = chainSnapshot.receiptEnvelope.receipt;
  if (
    chainSnapshot.receiptEnvelope.state !==
      LibraryQuarantineReceiptState.Quarantined ||
    receipt.state !== LibraryQuarantineReceiptState.Quarantined ||
    receipt.reconciliationReason !== null ||
    receipt.rejectionReasonCode !== null
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'RECEIPT_NOT_ELIGIBLE_FOR_HUMAN_REVIEW' as const,
      errorMessage:
        ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.RECEIPT_NOT_ELIGIBLE_FOR_HUMAN_REVIEW,
    });
  }

  const canonicalGeneration = parseCanonicalSafeGcsGeneration(
    receipt.generation
  );
  if (
    canonicalGeneration === null ||
    receipt.generation !== canonicalGeneration
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'MISSING_OR_INVALID_SOURCE_GENERATION_HOLD' as const,
      errorMessage:
        ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.MISSING_OR_INVALID_SOURCE_GENERATION_HOLD,
    });
  }

  if (
    !isValidSha256Hex(receipt.sha256) ||
    typeof receipt.byteSize !== 'number' ||
    !Number.isSafeInteger(receipt.byteSize) ||
    receipt.byteSize < 1 ||
    receipt.byteSize > LIBRARY_UPLOAD_MAX_BYTES
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'CORRUPTED_SOURCE_RECEIPT' as const,
      errorMessage:
        ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.CORRUPTED_SOURCE_RECEIPT,
    });
  }

  const safetyCase = chainSnapshot.binarySafetyCase;
  if (safetyCase === null) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'BINARY_SAFETY_CASE_NOT_FOUND_HOLD' as const,
      errorMessage:
        ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.BINARY_SAFETY_CASE_NOT_FOUND_HOLD,
    });
  }

  if (
    !chainSnapshot.isCaseCurrent ||
    chainSnapshot.requiresFreshEvidence ||
    safetyCase.effectiveHumanCaseRevision !==
      chainSnapshot.effectiveHumanCaseRevision ||
    safetyCase.effectiveHumanCaseUpdatedAt !==
      chainSnapshot.effectiveHumanCaseUpdatedAt ||
    safetyCase.catalogUpdatedAt !== chainSnapshot.catalogUpdatedAt
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'STALE_BINARY_SAFETY_CASE_HOLD' as const,
      errorMessage:
        ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.STALE_BINARY_SAFETY_CASE_HOLD,
    });
  }

  if (safetyCase.disposition !== 'ISOLATED_ASSESSMENT_REQUIRED') {
    return Object.freeze({
      ok: false as const,
      errorCode: 'BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD' as const,
      errorMessage:
        ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD,
    });
  }

  const requestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
    chainSnapshot.receiptId,
    chainSnapshot.receiptEnvelope.revision,
    safetyCase.revision
  );

  return Object.freeze({
    ok: true as const,
    eligibleChain: Object.freeze({
      chainSnapshot,
      requestId,
      sourceGeneration: canonicalGeneration,
      sourceByteSize: receipt.byteSize,
      safetyCaseRevision: safetyCase.revision,
    }),
  });
}

function extractFallbackRevisionsFromRawSnapshots(
  receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  safetySnap: LibraryQuarantineFirestoreDocumentSnapshot,
  fallbackSafetyCaseRevision: number
): {
  readonly sourceRevision: number;
  readonly safetyCaseRevision: number;
} {
  let sourceRevision = 1;
  if (receiptSnap.exists) {
    const rawReceipt = receiptSnap.data();
    if (
      rawReceipt &&
      typeof rawReceipt === 'object' &&
      typeof (rawReceipt as { revision?: unknown }).revision === 'number' &&
      Number.isSafeInteger((rawReceipt as { revision: number }).revision) &&
      (rawReceipt as { revision: number }).revision >= 1
    ) {
      sourceRevision = (rawReceipt as { revision: number }).revision;
    }
  }

  let safetyCaseRevision =
    typeof fallbackSafetyCaseRevision === 'number' &&
    Number.isSafeInteger(fallbackSafetyCaseRevision) &&
    fallbackSafetyCaseRevision >= 1
      ? fallbackSafetyCaseRevision
      : 1;
  if (safetySnap.exists) {
    const rawSafety = safetySnap.data();
    if (
      rawSafety &&
      typeof rawSafety === 'object' &&
      typeof (rawSafety as { revision?: unknown }).revision === 'number' &&
      Number.isSafeInteger((rawSafety as { revision: number }).revision) &&
      (rawSafety as { revision: number }).revision >= 1
    ) {
      safetyCaseRevision = (rawSafety as { revision: number }).revision;
    }
  }

  return { sourceRevision, safetyCaseRevision };
}

export class FirestoreLibraryQuarantineIsolatedInspectionRequestStore
  implements LibraryQuarantineIsolatedInspectionRequestStore
{
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;

  constructor(db: LibraryQuarantineReviewDraftFirestoreDatabase) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      throw new Error(
        'FirestoreLibraryQuarantineIsolatedInspectionRequestStore requires a Firestore database with collection() and runTransaction().'
      );
    }
    this.db = db;
  }

  private assertAllowedWriteCollection(collectionName: string): void {
    if (!ALLOWED_ISOLATED_INSPECTION_WRITE_COLLECTIONS.has(collectionName)) {
      throw new Error(
        `FORBIDDEN_COLLECTION_WRITE: Attempted to write to collection "${collectionName}".`
      );
    }
  }

  private getPointDocRef(
    collectionName: string,
    docId: string
  ): LibraryQuarantineFirestoreDocumentRef & {
    get(): Promise<LibraryQuarantineFirestoreDocumentSnapshot>;
  } {
    const col = this.db.collection(collectionName);
    if (!col || typeof col.doc !== 'function') {
      throw new Error(
        `Collection "${collectionName}" does not support point doc() lookup.`
      );
    }
    const ref = col.doc(docId);
    if (!ref || typeof ref.get !== 'function') {
      throw new Error(
        `Document reference "${collectionName}/${docId}" does not support point get().`
      );
    }
    return ref as LibraryQuarantineFirestoreDocumentRef & {
      get(): Promise<LibraryQuarantineFirestoreDocumentSnapshot>;
    };
  }

  /**
   * Performs at most 8 point reads (`receipt`, `reviewDraft`, `humanReviewCase`,
   * `catalogHandoff`, `qcatDocument`, `alignmentOverlay`, `binarySafetyCase`,
   * and `isolatedInspectionRequest` for the current version) and 0 writes.
   */
  public async getIsolatedInspectionRequestSnapshot(
    receiptId: string
  ): Promise<GetLibraryQuarantineIsolatedInspectionSnapshotResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_RECEIPT_ID' as const,
        errorMessage: ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.INVALID_RECEIPT_ID,
      });
    }

    const documentId = deriveQuarantineCatalogDocumentId(receiptId);

    try {
      const receiptSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        receiptId
      ).get();
      const draftSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
        receiptId
      ).get();
      const caseSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
        receiptId
      ).get();
      const handoffSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
        receiptId
      ).get();
      const docSnap = await this.getPointDocRef(
        LIBRARY_DOCUMENTS_COLLECTION,
        documentId
      ).get();
      const alignmentSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
        receiptId
      ).get();
      const safetySnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
        receiptId
      ).get();

      const fallbackRevs = extractFallbackRevisionsFromRawSnapshots(
        receiptSnap,
        safetySnap,
        1
      );
      const slotRequestId =
        deriveLibraryQuarantineIsolatedInspectionRequestId(
          receiptId,
          fallbackRevs.sourceRevision,
          fallbackRevs.safetyCaseRevision
        );

      const requestSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
        slotRequestId
      ).get();

      const chainCheck = verifyQuarantineBinarySafetyChainSnapshots(receiptId, {
        receiptSnap,
        draftSnap,
        caseSnap,
        handoffSnap,
        docSnap,
        alignmentSnap,
        safetySnap,
      });
      if (!chainCheck.ok) {
        return Object.freeze({
          ok: false as const,
          errorCode: chainCheck.errorCode,
          errorMessage:
            ISOLATED_INSPECTION_STORE_SAFE_MESSAGES[chainCheck.errorCode],
        });
      }

      const eligibilityCheck =
        verifyQuarantineIsolatedInspectionChainEligibility(chainCheck.snapshot);
      if (!eligibilityCheck.ok) {
        return eligibilityCheck;
      }

      const { eligibleChain } = eligibilityCheck;

      if (!requestSnap.exists) {
        return Object.freeze({
          ok: true as const,
          status: 'NOT_RECORDED' as const,
          eligibleChain,
          inspectionRequest: null,
        });
      }

      if (
        requestSnap.id !== undefined &&
        requestSnap.id !== eligibleChain.requestId
      ) {
        return Object.freeze({
          ok: false as const,
          errorCode: 'DOCUMENT_ID_MISMATCH' as const,
          errorMessage:
            ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
        });
      }

      const validatedRequest =
        validatePersistedLibraryQuarantineIsolatedInspectionRequest(
          requestSnap.data(),
          eligibleChain.requestId
        );
      if (!validatedRequest.ok) {
        const code =
          validatedRequest.errorCode === 'SECURITY_POSTURE_VIOLATION'
            ? 'SECURITY_POSTURE_VIOLATION'
            : 'CORRUPTED_EXISTING_INSPECTION_REQUEST';
        return Object.freeze({
          ok: false as const,
          errorCode: code,
          errorMessage: ISOLATED_INSPECTION_STORE_SAFE_MESSAGES[code],
        });
      }

      const persistedRequest = validatedRequest.value;
      if (
        arePersistedIsolatedInspectionRequestsIncompatible(persistedRequest, {
          requestId: eligibleChain.requestId,
          receiptId,
          documentId,
          sourceRevision: eligibleChain.chainSnapshot.receiptEnvelope.revision,
          sourceUpdatedAt:
            eligibleChain.chainSnapshot.receiptEnvelope.receipt.updatedAt,
          sourceSha256:
            eligibleChain.chainSnapshot.receiptEnvelope.receipt.sha256,
          sourceGeneration: eligibleChain.sourceGeneration,
          sourceByteSize: eligibleChain.sourceByteSize,
          sourceFormat: eligibleChain.chainSnapshot.sourceFormat,
          deepInspectionStatus:
            eligibleChain.chainSnapshot.deepInspectionStatus,
          safetyCaseRevision: eligibleChain.safetyCaseRevision,
          effectiveHumanCaseRevision:
            eligibleChain.chainSnapshot.effectiveHumanCaseRevision,
          catalogUpdatedAt: eligibleChain.chainSnapshot.catalogUpdatedAt,
        })
      ) {
        return Object.freeze({
          ok: false as const,
          errorCode: 'INSPECTION_REQUEST_SOURCE_MISMATCH' as const,
          errorMessage:
            ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.INSPECTION_REQUEST_SOURCE_MISMATCH,
        });
      }

      return Object.freeze({
        ok: true as const,
        status: 'RECORDED' as const,
        eligibleChain,
        inspectionRequest: persistedRequest,
      });
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }
  }

  /**
   * Atomically records an immutable isolated inspection request in
   * `library_quarantine_isolated_inspection_requests/<receiptId>_<sourceRevision>_<safetyCaseRevision>`
   * inside ONE Firestore transaction:
   * - Performs 8 `tx.get(...)` calls strictly before any write.
   * - If the exact request already exists and matches all provenance invariants,
   *   returns `ALREADY_RECORDED` with 0 writes.
   * - Otherwise performs exactly 1 `tx.create(...)` write (zero `tx.set`/`tx.update`/`tx.delete`).
   */
  public async recordIsolatedInspectionRequestTransactional(
    params: RecordLibraryQuarantineIsolatedInspectionStoreInput
  ): Promise<RecordLibraryQuarantineIsolatedInspectionStoreResult> {
    const rawReceiptId =
      params && typeof params.receiptId === 'string' ? params.receiptId : '';
    const safeDocId = isValidLibraryQuarantineReceiptId(rawReceiptId)
      ? deriveQuarantineCatalogDocumentId(rawReceiptId)
      : '';

    const makeHold = (
      reasonCode: LibraryQuarantineIsolatedInspectionStoreErrorCode
    ): RecordLibraryQuarantineIsolatedInspectionHoldResult =>
      Object.freeze({
        status: 'HOLD' as const,
        requestOutcome: 'NOT_RECORDED' as const,
        requestRecorded: false as const,
        receiptId: rawReceiptId,
        documentId: safeDocId,
        reasonCode,
        errorMessage: ISOLATED_INSPECTION_STORE_SAFE_MESSAGES[reasonCode],
      });

    if (!params || typeof params !== 'object') {
      return makeHold('INVALID_INSPECTION_REQUEST_INPUT_OBJECT');
    }

    if (!isValidLibraryQuarantineReceiptId(params.receiptId)) {
      return makeHold('INVALID_RECEIPT_ID');
    }

    if (
      typeof params.expectedSafetyCaseRevision !== 'number' ||
      !Number.isSafeInteger(params.expectedSafetyCaseRevision) ||
      params.expectedSafetyCaseRevision < 1
    ) {
      return makeHold('INVALID_EXPECTED_SAFETY_CASE_REVISION');
    }

    if (
      typeof params.acknowledgedHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(params.acknowledgedHumanCaseRevision) ||
      params.acknowledgedHumanCaseRevision < 1
    ) {
      return makeHold('UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD');
    }

    if (!isValidRecordIsolatedInspectionConfirmation(params.confirmation)) {
      return makeHold('CONFIRMATION_LITERAL_REQUIRED_HOLD');
    }

    if (!isValidUploaderUid(params.actorUid)) {
      return makeHold('INVALID_ACTOR_UID');
    }

    if (!isValidIsoUtcTimestamp(params.nowIso)) {
      return makeHold('INVALID_TIMESTAMP');
    }

    const receiptId = params.receiptId;
    const documentId = deriveQuarantineCatalogDocumentId(receiptId);
    const expectedSafetyCaseRevision = params.expectedSafetyCaseRevision;
    const acknowledgedHumanCaseRevision = params.acknowledgedHumanCaseRevision;
    const actorUid = params.actorUid;
    const nowIso = params.nowIso;

    // Declared OUTSIDE transaction callback and never reset across retries
    let writeStagedInAnyAttempt = false;

    try {
      return await this.db.runTransaction(
        async (tx: LibraryQuarantineReviewDraftFirestoreTransaction) => {
          const receiptRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
            receiptId
          );
          const draftRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
            receiptId
          );
          const caseRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
            receiptId
          );
          const handoffRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
            receiptId
          );
          const docRef = this.getPointDocRef(
            LIBRARY_DOCUMENTS_COLLECTION,
            documentId
          );
          const alignmentRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
            receiptId
          );
          const safetyRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
            receiptId
          );

          // Step 1: Read all 7 provenance chain documents + 8th request slot inside the transaction BEFORE any write
          const receiptSnap = await tx.get(receiptRef);
          const draftSnap = await tx.get(draftRef);
          const caseSnap = await tx.get(caseRef);
          const handoffSnap = await tx.get(handoffRef);
          const docSnap = await tx.get(docRef);
          const alignmentSnap = await tx.get(alignmentRef);
          const safetySnap = await tx.get(safetyRef);

          const fallbackRevs = extractFallbackRevisionsFromRawSnapshots(
            receiptSnap,
            safetySnap,
            expectedSafetyCaseRevision
          );
          const slotRequestId =
            deriveLibraryQuarantineIsolatedInspectionRequestId(
              receiptId,
              fallbackRevs.sourceRevision,
              fallbackRevs.safetyCaseRevision
            );
          const requestRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
            slotRequestId
          );
          const requestSnap = await tx.get(requestRef);

          // Step 2: Verify the 7-document Binary Safety chain
          const chainCheck = verifyQuarantineBinarySafetyChainSnapshots(
            receiptId,
            {
              receiptSnap,
              draftSnap,
              caseSnap,
              handoffSnap,
              docSnap,
              alignmentSnap,
              safetySnap,
            }
          );
          if (!chainCheck.ok) {
            throw new PreWriteIsolatedInspectionAbortError(
              chainCheck.errorCode
            );
          }

          const chainSnapshot = chainCheck.snapshot;
          const liveSafetyCase = chainSnapshot.binarySafetyCase;
          if (liveSafetyCase === null) {
            throw new PreWriteIsolatedInspectionAbortError(
              'BINARY_SAFETY_CASE_NOT_FOUND_HOLD'
            );
          }

          // Step 3: Check CAS on expectedSafetyCaseRevision before checking disposition/staleness
          if (expectedSafetyCaseRevision !== liveSafetyCase.revision) {
            throw new PreWriteIsolatedInspectionConflictError(
              liveSafetyCase.revision,
              chainSnapshot.effectiveHumanCaseRevision
            );
          }

          // Step 4: Verify full isolated inspection eligibility (Quarantined + generation + current + ISOLATED_ASSESSMENT_REQUIRED)
          const eligibilityCheck =
            verifyQuarantineIsolatedInspectionChainEligibility(chainSnapshot);
          if (!eligibilityCheck.ok) {
            throw new PreWriteIsolatedInspectionAbortError(
              eligibilityCheck.errorCode
            );
          }

          const { eligibleChain } = eligibilityCheck;

          // Step 5: Verify acknowledgedHumanCaseRevision matches current effective human case revision
          if (
            acknowledgedHumanCaseRevision !==
            chainSnapshot.effectiveHumanCaseRevision
          ) {
            throw new PreWriteIsolatedInspectionAbortError(
              'UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD'
            );
          }

          const expectedProvenance = {
            requestId: eligibleChain.requestId,
            receiptId,
            documentId,
            sourceRevision: chainSnapshot.receiptEnvelope.revision,
            sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
            sourceSha256: chainSnapshot.receiptEnvelope.receipt.sha256,
            sourceGeneration: eligibleChain.sourceGeneration,
            sourceByteSize: eligibleChain.sourceByteSize,
            sourceFormat: chainSnapshot.sourceFormat,
            deepInspectionStatus: chainSnapshot.deepInspectionStatus,
            safetyCaseRevision: eligibleChain.safetyCaseRevision,
            effectiveHumanCaseRevision:
              chainSnapshot.effectiveHumanCaseRevision,
            catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
          };

          // Step 6: If the deterministic request slot already exists, verify idempotency or abort with HOLD (0 writes)
          if (requestSnap.exists) {
            if (
              requestSnap.id !== undefined &&
              requestSnap.id !== eligibleChain.requestId
            ) {
              throw new PreWriteIsolatedInspectionAbortError(
                'DOCUMENT_ID_MISMATCH'
              );
            }

            const existingValidated =
              validatePersistedLibraryQuarantineIsolatedInspectionRequest(
                requestSnap.data(),
                eligibleChain.requestId
              );
            if (!existingValidated.ok) {
              throw new PreWriteIsolatedInspectionAbortError(
                existingValidated.errorCode === 'SECURITY_POSTURE_VIOLATION'
                  ? 'SECURITY_POSTURE_VIOLATION'
                  : 'CORRUPTED_EXISTING_INSPECTION_REQUEST'
              );
            }

            if (
              arePersistedIsolatedInspectionRequestsIncompatible(
                existingValidated.value,
                expectedProvenance
              )
            ) {
              throw new PreWriteIsolatedInspectionAbortError(
                'INSPECTION_REQUEST_SOURCE_MISMATCH'
              );
            }

            return Object.freeze({
              status: 'ALREADY_RECORDED' as const,
              requestOutcome: 'ALREADY_RECORDED' as const,
              requestRecorded: true as const,
              receiptId,
              documentId,
              requestId: eligibleChain.requestId,
              inspectionRequest: existingValidated.value,
              eligibleChain,
            });
          }

          // Step 7: Verify monotonic timestamp ordering against all upstream chain timestamps
          const nowMs = Date.parse(nowIso);
          const sourceMs = Date.parse(
            chainSnapshot.receiptEnvelope.receipt.updatedAt
          );
          const draftMs = Date.parse(chainSnapshot.reviewDraft.createdAt);
          const caseMs = Date.parse(chainSnapshot.humanReviewCase.updatedAt);
          const handoffMs = Date.parse(chainSnapshot.catalogHandoff.createdAt);
          const catalogDocMs = Date.parse(chainSnapshot.catalogUpdatedAt);
          const alignmentMs = chainSnapshot.alignment
            ? Date.parse(chainSnapshot.alignment.updatedAt)
            : 0;
          const safetyCaseMs = Date.parse(liveSafetyCase.updatedAt);

          if (
            nowMs < sourceMs ||
            nowMs < draftMs ||
            nowMs < caseMs ||
            nowMs < handoffMs ||
            nowMs < catalogDocMs ||
            (chainSnapshot.alignment !== null && nowMs < alignmentMs) ||
            nowMs < safetyCaseMs
          ) {
            throw new PreWriteIsolatedInspectionAbortError(
              'TIMESTAMP_BEFORE_SOURCE_OR_SAFETY_CASE'
            );
          }

          const candidateRequest: LibraryQuarantinePersistedIsolatedInspectionRequest =
            Object.freeze({
              schemaVersion:
                LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
              requestId: eligibleChain.requestId,
              receiptId,
              documentId,
              sourceRevision: chainSnapshot.receiptEnvelope.revision,
              sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
              sourceSha256: chainSnapshot.receiptEnvelope.receipt.sha256,
              sourceGeneration: eligibleChain.sourceGeneration,
              sourceByteSize: eligibleChain.sourceByteSize,
              sourceFormat: chainSnapshot.sourceFormat,
              deepInspectionStatus: chainSnapshot.deepInspectionStatus,
              safetyCaseRevision: eligibleChain.safetyCaseRevision,
              effectiveHumanCaseRevision:
                chainSnapshot.effectiveHumanCaseRevision,
              catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
              requestedBy: actorUid,
              requestedAt: nowIso,
              state: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
              dispatched: false as const,
              scanPerformed: false as const,
              sanitized: false as const,
              isVerifiedSafe: false as const,
              isPublished: false as const,
              isReadyForPeia: false as const,
            });

          const validatedNext =
            validatePersistedLibraryQuarantineIsolatedInspectionRequest(
              candidateRequest,
              eligibleChain.requestId
            );
          if (!validatedNext.ok) {
            throw new PreWriteIsolatedInspectionAbortError(
              validatedNext.errorCode
            );
          }

          this.assertAllowedWriteCollection(
            LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION
          );

          // Step 8: Conservatively mark writeStagedInAnyAttempt = true immediately before tx.create
          writeStagedInAnyAttempt = true;
          tx.create(
            requestRef,
            toFirestoreDocumentData(validatedNext.value)
          );

          return Object.freeze({
            status: 'RECORDED' as const,
            requestOutcome: 'RECORDED' as const,
            requestRecorded: true as const,
            receiptId,
            documentId,
            requestId: eligibleChain.requestId,
            inspectionRequest: validatedNext.value,
            eligibleChain,
          });
        }
      );
    } catch (err: unknown) {
      if (writeStagedInAnyAttempt) {
        return Object.freeze({
          status: 'UNKNOWN' as const,
          requestOutcome: 'UNKNOWN' as const,
          requestRecorded: null,
          receiptId,
          documentId,
          reasonCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
          errorMessage:
            ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
        });
      }

      if (err instanceof PreWriteIsolatedInspectionConflictError) {
        return Object.freeze({
          status: 'CONFLICT' as const,
          requestOutcome: 'NOT_RECORDED' as const,
          requestRecorded: false as const,
          receiptId,
          documentId,
          reasonCode: 'SAFETY_CASE_REVISION_CONFLICT' as const,
          errorMessage:
            ISOLATED_INSPECTION_STORE_SAFE_MESSAGES.SAFETY_CASE_REVISION_CONFLICT,
          currentSafetyCaseRevision: err.currentSafetyCaseRevision,
          currentEffectiveHumanCaseRevision:
            err.currentEffectiveHumanCaseRevision,
        });
      }

      if (err instanceof PreWriteIsolatedInspectionAbortError) {
        return makeHold(err.reasonCode);
      }

      return makeHold('TRANSACTION_ABORTED_NO_WRITE');
    }
  }
}
