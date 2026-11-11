import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
  type LibraryQuarantinePersistedReviewDraft,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftFirestoreTransaction,
} from './firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
  verifyReceiptAndDraftEligibleForHumanReviewCase,
  type LibraryQuarantineFirestoreDocumentData,
  type LibraryQuarantineHumanReviewCaseErrorCode,
} from './firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  validatePersistedLibraryQuarantineHumanReviewCase,
  type LibraryQuarantinePersistedHumanReviewCase,
} from './libraryQuarantineHumanReviewCaseContract';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  deriveQuarantineCatalogDocumentId,
  validatePersistedCatalogDraftDocument,
  validatePersistedLibraryQuarantineCatalogHandoff,
  type LibraryQuarantinePersistedCatalogHandoff,
  type SanitizedLibraryQuarantineCatalogDocumentDto,
} from './libraryQuarantineCatalogHandoffService';
import {
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
  computeLibraryQuarantineCatalogCaseFourFieldDiff,
  validatePersistedLibraryQuarantineCatalogCaseAlignment,
  type LibraryQuarantinePersistedCatalogCaseAlignment,
} from './libraryQuarantineCatalogCaseAlignmentService';
import {
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
  deriveLibraryQuarantineBinarySafetyCaseEventId,
  isMatchingSourceFormatAndDeepInspection,
  validatePersistedLibraryQuarantineBinarySafetyCase,
  validatePersistedLibraryQuarantineBinarySafetyCaseEvent,
  validateSaveLibraryQuarantineBinarySafetyCaseInput,
  type LibraryQuarantineBinarySafetyCaseAuditEventType,
  type LibraryQuarantineBinarySafetyCaseContractErrorCode,
  type LibraryQuarantineBinarySafetyDeepInspectionStatus,
  type LibraryQuarantineBinarySafetySourceFormat,
  type LibraryQuarantinePersistedBinarySafetyCase,
  type LibraryQuarantinePersistedBinarySafetyCaseEvent,
  type SaveLibraryQuarantineBinarySafetyCaseInput,
} from './libraryQuarantineBinarySafetyCaseContract';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';

export const LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION =
  'library_quarantine_binary_safety_cases' as const;

export const LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION =
  'library_quarantine_binary_safety_case_events' as const;

const ALLOWED_BINARY_SAFETY_WRITE_COLLECTIONS: ReadonlySet<string> = new Set([
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION,
]);

export type LibraryQuarantineBinarySafetyCaseStoreErrorCode =
  | LibraryQuarantineBinarySafetyCaseContractErrorCode
  | LibraryQuarantineHumanReviewCaseErrorCode
  | 'HUMAN_REVIEW_CASE_NOT_FOUND'
  | 'CASE_NOT_METADATA_RECORDED'
  | 'CATALOG_HANDOFF_NOT_CREATED_HOLD'
  | 'INCONSISTENT_EXISTING_HANDOFF_STATE'
  | 'INVALID_PERSISTED_HANDOFF_SCHEMA'
  | 'HANDOFF_SOURCE_MISMATCH'
  | 'SOURCE_CASE_VERSION_DRIFT_HOLD'
  | 'UNACKNOWLEDGED_CASE_REVISION_HOLD'
  | 'STALE_BINARY_SAFETY_EVIDENCE_HOLD'
  | 'CORRUPTED_EXISTING_BINARY_SAFETY_CASE'
  | 'BINARY_SAFETY_SOURCE_MISMATCH'
  | 'BINARY_SAFETY_REVISION_CONFLICT'
  | 'AUDIT_EVENT_ALREADY_EXISTS'
  | 'TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION'
  | 'TRANSACTION_ABORTED_NO_WRITE'
  | 'TRANSACTION_COMMIT_UNCERTAIN'
  | 'STORE_READ_FAILED';

export const BINARY_SAFETY_STORE_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineBinarySafetyCaseStoreErrorCode, string>
> = Object.freeze({
  INVALID_BINARY_SAFETY_INPUT_OBJECT:
    'Binary safety input must be a plain object with allowed editorial fields only.',
  UNTRUSTED_OR_FORBIDDEN_BINARY_SAFETY_FIELD:
    'Binary safety payload contains an unexpected, privileged, or forbidden property.',
  INVALID_BINARY_SAFETY_DISPOSITION:
    'Binary safety disposition must be one of ISOLATED_ASSESSMENT_REQUIRED, EXTERNAL_REPORT_NOT_VERIFIED, or DO_NOT_PROCESS.',
  INVALID_PLAIN_TEXT_FIELD:
    'Binary safety text fields must be valid plain strings without HTML tags, control characters, or bidi overrides.',
  FIELD_MAX_LENGTH_EXCEEDED:
    'Binary safety text field exceeds maximum allowed character length.',
  EXTERNAL_REPORT_REQUIREMENTS_NOT_MET:
    'EXTERNAL_REPORT_NOT_VERIFIED requires both evidenceReference and evidenceNotes.',
  DO_NOT_PROCESS_JUSTIFICATION_REQUIRED:
    'DO_NOT_PROCESS disposition requires non-empty reviewNotes justification.',
  EMPTY_BINARY_SAFETY_CASE_NOT_ALLOWED:
    'Binary safety case requires at least one non-empty evidenceReference, evidenceNotes, or reviewNotes field.',
  INVALID_PERSISTED_BINARY_SAFETY_SCHEMA:
    'Persisted binary safety case failed strict 25-field schema validation.',
  INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA:
    'Persisted binary safety audit event failed strict 26-field schema validation.',
  SECURITY_POSTURE_VIOLATION:
    'Binary safety record violated mandatory false security posture locks.',
  INVALID_CASE_INPUT_OBJECT:
    'Human review case input must be a plain object with allowed editorial fields only.',
  UNTRUSTED_OR_FORBIDDEN_CASE_FIELD:
    'Human review case payload contains an unexpected, privileged, or forbidden property.',
  INVALID_CASE_STATUS:
    'Human review case status must be one of IN_REVIEW, NEEDS_INFORMATION, METADATA_RECORDED, or NOT_SUITABLE.',
  METADATA_RECORDED_REQUIREMENTS_NOT_MET:
    'METADATA_RECORDED requires at least one document title and non-empty source evidence notes.',
  JUSTIFICATION_NOTES_REQUIRED:
    'NEEDS_INFORMATION and NOT_SUITABLE statuses require non-empty reviewerNotes justification.',
  EMPTY_REVIEW_CASE_NOT_ALLOWED:
    'Human review case must include at least one non-empty descriptive field or reviewer note.',
  INVALID_PERSISTED_CASE_SCHEMA:
    'Persisted human review case failed strict 20-field schema validation.',
  INVALID_PERSISTED_EVENT_SCHEMA:
    'Persisted human review audit event failed strict 21-field schema validation.',
  INVALID_RECEIPT_ID:
    'Quarantine receiptId must be a lowercase 32-character hexadecimal identifier.',
  INVALID_EXPECTED_REVISION:
    'expectedRevision must be a non-negative safe integer (0 for initial binary safety case creation).',
  INVALID_ACTOR_UID:
    'Binary safety reviewer actorUid must be a valid authenticated Firebase user identifier.',
  INVALID_TIMESTAMP:
    'Binary safety case timestamp must be a canonical UTC ISO-8601 string.',
  DOCUMENT_ID_MISMATCH:
    'Firestore document identifier does not match the expected quarantine binary safety record key.',
  SOURCE_RECEIPT_NOT_FOUND:
    'Authoritative quarantine receipt does not exist in library_quarantine_receipts.',
  CORRUPTED_SOURCE_RECEIPT:
    'Authoritative quarantine receipt failed strict envelope schema validation.',
  RECEIPT_NEEDS_RECONCILIATION:
    'Quarantine receipt requires storage reconciliation and is held from binary safety casework.',
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
    'Human review case revision changed concurrently.',
  HUMAN_REVIEW_CASE_NOT_FOUND:
    'Human review case has not been recorded yet for this quarantine receipt.',
  CASE_NOT_METADATA_RECORDED:
    'Human review case must be saved in METADATA_RECORDED status before binary safety casework.',
  CATALOG_HANDOFF_NOT_CREATED_HOLD:
    'Internal catalog draft (qcat-) has not been created yet; create the catalog draft first before recording a binary safety case.',
  INCONSISTENT_EXISTING_HANDOFF_STATE:
    'Existing catalog handoff or qcat- draft document is incomplete, corrupted, or violated Draft/ReviewRequired/no-URL locks.',
  INVALID_PERSISTED_HANDOFF_SCHEMA:
    'Persisted catalog handoff link failed strict 18-field schema validation.',
  HANDOFF_SOURCE_MISMATCH:
    'Existing catalog handoff record does not match the current quarantine receipt or review draft revision.',
  SOURCE_CASE_VERSION_DRIFT_HOLD:
    'Current human review case revision or timestamp has drifted from the effective aligned catalog draft revision; align the catalog draft with the saved human review case before recording binary safety evidence.',
  UNACKNOWLEDGED_CASE_REVISION_HOLD:
    'Explicit acknowledgement of the current effective aligned human review case revision (acknowledgedHumanCaseRevision) is required before recording or renewing binary safety evidence.',
  STALE_BINARY_SAFETY_EVIDENCE_HOLD:
    'Existing binary safety evidence is stale for the current human review case revision; provide fresh evidence rather than reusing stale evidence verbatim.',
  CORRUPTED_EXISTING_BINARY_SAFETY_CASE:
    'Existing persisted binary safety case failed strict 25-field schema validation.',
  BINARY_SAFETY_SOURCE_MISMATCH:
    'Existing persisted binary safety case does not match the authoritative source receipt provenance.',
  BINARY_SAFETY_REVISION_CONFLICT:
    'Binary safety case revision changed concurrently; reload the latest binary safety record before saving.',
  AUDIT_EVENT_ALREADY_EXISTS:
    'Append-only binary safety audit event for the target revision already exists; refusing to overwrite.',
  TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION:
    'Binary safety case timestamp cannot precede the source receipt, linked draft, human review case, catalog handoff, alignment, catalog document, or prior binary safety case timestamp.',
  TRANSACTION_ABORTED_NO_WRITE:
    'Binary safety transaction aborted before any write was committed.',
  TRANSACTION_COMMIT_UNCERTAIN:
    'Binary safety transaction commit acknowledgement was lost after staging writes; verify record state via GET before retrying.',
  STORE_READ_FAILED:
    'Point lookup of quarantine binary safety records failed in Firestore.',
});

export interface VerifiedQuarantineBinarySafetyChainSnapshot {
  readonly receiptId: string;
  readonly documentId: string;
  readonly receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly reviewDraft: LibraryQuarantinePersistedReviewDraft;
  readonly humanReviewCase: LibraryQuarantinePersistedHumanReviewCase;
  readonly catalogHandoff: LibraryQuarantinePersistedCatalogHandoff;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly effectiveHumanCaseRevision: number;
  readonly effectiveHumanCaseUpdatedAt: string;
  readonly catalogUpdatedAt: string;
  readonly binarySafetyCase: LibraryQuarantinePersistedBinarySafetyCase | null;
  readonly isCaseCurrent: boolean;
  readonly requiresFreshEvidence: boolean;
}

export interface GetLibraryQuarantineBinarySafetySnapshotSuccess {
  readonly ok: true;
  readonly snapshot: VerifiedQuarantineBinarySafetyChainSnapshot;
}

export interface GetLibraryQuarantineBinarySafetySnapshotFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineBinarySafetyCaseStoreErrorCode;
  readonly errorMessage: string;
}

export type GetLibraryQuarantineBinarySafetySnapshotResult =
  | GetLibraryQuarantineBinarySafetySnapshotSuccess
  | GetLibraryQuarantineBinarySafetySnapshotFailure;

export interface GetLibraryQuarantineBinarySafetyEventStoreSuccess {
  readonly ok: true;
  readonly safetyEvent: LibraryQuarantinePersistedBinarySafetyCaseEvent | null;
}

export type GetLibraryQuarantineBinarySafetyEventStoreResult =
  | GetLibraryQuarantineBinarySafetyEventStoreSuccess
  | GetLibraryQuarantineBinarySafetySnapshotFailure;

export interface SaveLibraryQuarantineBinarySafetyStoreInput {
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly acknowledgedHumanCaseRevision?: number;
  readonly actorUid: string;
  readonly nowIso: string;
  readonly input: SaveLibraryQuarantineBinarySafetyCaseInput;
}

export interface SaveLibraryQuarantineBinarySafetySavedResult {
  readonly status: 'SAVED';
  readonly caseSaveOutcome: 'CREATED' | 'UPDATED';
  readonly caseSaved: true;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentRevision: number;
  readonly binarySafetyCase: LibraryQuarantinePersistedBinarySafetyCase;
  readonly binarySafetyEvent: LibraryQuarantinePersistedBinarySafetyCaseEvent;
  readonly chainSnapshot: VerifiedQuarantineBinarySafetyChainSnapshot;
}

export interface SaveLibraryQuarantineBinarySafetyConflictResult {
  readonly status: 'CONFLICT';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: 'BINARY_SAFETY_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly currentRevision: number;
  readonly currentBinarySafetyCase: LibraryQuarantinePersistedBinarySafetyCase | null;
  readonly chainSnapshot: VerifiedQuarantineBinarySafetyChainSnapshot;
}

export interface SaveLibraryQuarantineBinarySafetyHoldResult {
  readonly status: 'HOLD';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: LibraryQuarantineBinarySafetyCaseStoreErrorCode;
  readonly errorMessage: string;
}

export interface SaveLibraryQuarantineBinarySafetyUnknownResult {
  readonly status: 'UNKNOWN';
  readonly caseSaveOutcome: 'UNKNOWN';
  readonly caseSaved: null;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
}

export type SaveLibraryQuarantineBinarySafetyStoreResult =
  | SaveLibraryQuarantineBinarySafetySavedResult
  | SaveLibraryQuarantineBinarySafetyConflictResult
  | SaveLibraryQuarantineBinarySafetyHoldResult
  | SaveLibraryQuarantineBinarySafetyUnknownResult;

export interface LibraryQuarantineBinarySafetyCaseStore {
  getBinarySafetyCaseSnapshot(
    receiptId: string
  ): Promise<GetLibraryQuarantineBinarySafetySnapshotResult>;
  getBinarySafetyCaseEventByReceiptAndRevision(
    receiptId: string,
    revision: number
  ): Promise<GetLibraryQuarantineBinarySafetyEventStoreResult>;
  saveBinarySafetyCaseTransactional(
    params: SaveLibraryQuarantineBinarySafetyStoreInput
  ): Promise<SaveLibraryQuarantineBinarySafetyStoreResult>;
}

export type LibraryQuarantineBinarySafetyCaseFirestoreDatabase =
  LibraryQuarantineReviewDraftFirestoreDatabase;

class PreWriteBinarySafetyTransactionAbortError extends Error {
  public readonly reasonCode: LibraryQuarantineBinarySafetyCaseStoreErrorCode;

  constructor(reasonCode: LibraryQuarantineBinarySafetyCaseStoreErrorCode) {
    super(BINARY_SAFETY_STORE_SAFE_MESSAGES[reasonCode]);
    this.name = 'PreWriteBinarySafetyTransactionAbortError';
    this.reasonCode = reasonCode;
  }
}

class PreWriteBinarySafetyRevisionConflictError extends Error {
  public readonly currentRevision: number;
  public readonly currentBinarySafetyCase: LibraryQuarantinePersistedBinarySafetyCase | null;
  public readonly chainSnapshot: VerifiedQuarantineBinarySafetyChainSnapshot;

  constructor(
    currentRevision: number,
    currentBinarySafetyCase: LibraryQuarantinePersistedBinarySafetyCase | null,
    chainSnapshot: VerifiedQuarantineBinarySafetyChainSnapshot
  ) {
    super(BINARY_SAFETY_STORE_SAFE_MESSAGES.BINARY_SAFETY_REVISION_CONFLICT);
    this.name = 'PreWriteBinarySafetyRevisionConflictError';
    this.currentRevision = currentRevision;
    this.currentBinarySafetyCase = currentBinarySafetyCase;
    this.chainSnapshot = chainSnapshot;
  }
}

function toFirestoreDocumentData(
  record:
    | LibraryQuarantinePersistedBinarySafetyCase
    | LibraryQuarantinePersistedBinarySafetyCaseEvent
): LibraryQuarantineFirestoreDocumentData {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    clone[key] = value;
  }
  return clone;
}

export function verifyQuarantineBinarySafetyChainSnapshots(
  receiptId: string,
  snapshots: {
    readonly receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly draftSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly caseSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly handoffSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly docSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly alignmentSnap?: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly safetySnap: LibraryQuarantineFirestoreDocumentSnapshot;
  }
): GetLibraryQuarantineBinarySafetySnapshotResult {
  const eligibility = verifyReceiptAndDraftEligibleForHumanReviewCase(
    receiptId,
    snapshots.receiptSnap,
    snapshots.draftSnap
  );
  if (!eligibility.ok) {
    return Object.freeze({
      ok: false as const,
      errorCode: eligibility.reasonCode,
      errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES[eligibility.reasonCode],
    });
  }

  const { receiptEnvelope, reviewDraft } = eligibility;
  const receipt = receiptEnvelope.receipt;
  const documentId = deriveQuarantineCatalogDocumentId(receiptId);

  if (
    !isMatchingSourceFormatAndDeepInspection(
      receipt.format,
      receipt.deepInspectionStatus
    )
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'CORRUPTED_SOURCE_RECEIPT' as const,
      errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.CORRUPTED_SOURCE_RECEIPT,
    });
  }

  const sourceFormat = receipt.format;
  const deepInspectionStatus =
    receipt.deepInspectionStatus as LibraryQuarantineBinarySafetyDeepInspectionStatus;

  if (!snapshots.caseSnap.exists) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'HUMAN_REVIEW_CASE_NOT_FOUND' as const,
      errorMessage:
        BINARY_SAFETY_STORE_SAFE_MESSAGES.HUMAN_REVIEW_CASE_NOT_FOUND,
    });
  }

  if (snapshots.caseSnap.id !== undefined && snapshots.caseSnap.id !== receiptId) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'DOCUMENT_ID_MISMATCH' as const,
      errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
    });
  }

  const caseValidation = validatePersistedLibraryQuarantineHumanReviewCase(
    snapshots.caseSnap.data(),
    receiptId
  );
  if (!caseValidation.ok) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'CORRUPTED_EXISTING_HUMAN_REVIEW_CASE' as const,
      errorMessage:
        BINARY_SAFETY_STORE_SAFE_MESSAGES.CORRUPTED_EXISTING_HUMAN_REVIEW_CASE,
    });
  }

  const humanReviewCase = caseValidation.reviewCase;
  if (
    humanReviewCase.sourceRevision !== receiptEnvelope.revision ||
    humanReviewCase.sourceUpdatedAt !== receipt.updatedAt ||
    humanReviewCase.sourceSha256 !== receipt.sha256 ||
    humanReviewCase.draftSourceRevision !== reviewDraft.sourceRevision
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'CASE_SOURCE_STALE_OR_MISMATCHED' as const,
      errorMessage:
        BINARY_SAFETY_STORE_SAFE_MESSAGES.CASE_SOURCE_STALE_OR_MISMATCHED,
    });
  }

  if (
    humanReviewCase.status !== 'METADATA_RECORDED' ||
    humanReviewCase.sourceEvidenceNotes.trim().length === 0 ||
    (humanReviewCase.titleAr.trim().length === 0 &&
      humanReviewCase.titleEn.trim().length === 0)
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'CASE_NOT_METADATA_RECORDED' as const,
      errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.CASE_NOT_METADATA_RECORDED,
    });
  }

  if (!snapshots.handoffSnap.exists && !snapshots.docSnap.exists) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'CATALOG_HANDOFF_NOT_CREATED_HOLD' as const,
      errorMessage:
        BINARY_SAFETY_STORE_SAFE_MESSAGES.CATALOG_HANDOFF_NOT_CREATED_HOLD,
    });
  }

  if (!snapshots.handoffSnap.exists || !snapshots.docSnap.exists) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' as const,
      errorMessage:
        BINARY_SAFETY_STORE_SAFE_MESSAGES.INCONSISTENT_EXISTING_HANDOFF_STATE,
    });
  }

  if (
    (snapshots.handoffSnap.id !== undefined &&
      snapshots.handoffSnap.id !== receiptId) ||
    (snapshots.docSnap.id !== undefined && snapshots.docSnap.id !== documentId)
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'DOCUMENT_ID_MISMATCH' as const,
      errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
    });
  }

  const handoffCheck = validatePersistedLibraryQuarantineCatalogHandoff(
    snapshots.handoffSnap.data(),
    receiptId
  );
  if (!handoffCheck.ok) {
    return Object.freeze({
      ok: false as const,
      errorCode: handoffCheck.errorCode,
      errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES[handoffCheck.errorCode],
    });
  }

  const catalogHandoff = handoffCheck.handoff;
  if (
    catalogHandoff.sourceRevision !== receiptEnvelope.revision ||
    catalogHandoff.sourceUpdatedAt !== receipt.updatedAt ||
    catalogHandoff.sourceSha256 !== receipt.sha256 ||
    catalogHandoff.draftSourceRevision !== reviewDraft.sourceRevision
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'HANDOFF_SOURCE_MISMATCH' as const,
      errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.HANDOFF_SOURCE_MISMATCH,
    });
  }

  const docCheck = validatePersistedCatalogDraftDocument(
    snapshots.docSnap.data(),
    documentId
  );
  if (!docCheck.ok) {
    return Object.freeze({
      ok: false as const,
      errorCode: docCheck.errorCode,
      errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES[docCheck.errorCode],
    });
  }

  const catalogDocument = docCheck.catalogDocument;
  if (
    catalogDocument.organizationId !== catalogHandoff.organizationId ||
    catalogDocument.sourceId !== catalogHandoff.sourceId ||
    catalogDocument.createdAt !== catalogHandoff.createdAt ||
    Date.parse(catalogDocument.updatedAt) < Date.parse(catalogHandoff.createdAt)
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' as const,
      errorMessage:
        BINARY_SAFETY_STORE_SAFE_MESSAGES.INCONSISTENT_EXISTING_HANDOFF_STATE,
    });
  }

  let alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null = null;
  let effectiveHumanCaseRevision = catalogHandoff.caseRevision;
  let effectiveHumanCaseUpdatedAt = catalogHandoff.caseUpdatedAt;

  if (snapshots.alignmentSnap && snapshots.alignmentSnap.exists) {
    if (
      snapshots.alignmentSnap.id !== undefined &&
      snapshots.alignmentSnap.id !== receiptId
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'DOCUMENT_ID_MISMATCH' as const,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
      });
    }

    const alignmentCheck = validatePersistedLibraryQuarantineCatalogCaseAlignment(
      snapshots.alignmentSnap.data(),
      receiptId
    );
    if (!alignmentCheck.ok) {
      const code =
        alignmentCheck.errorCode === 'SECURITY_POSTURE_VIOLATION'
          ? 'SECURITY_POSTURE_VIOLATION'
          : 'SOURCE_CASE_VERSION_DRIFT_HOLD';
      return Object.freeze({
        ok: false as const,
        errorCode: code,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES[code],
      });
    }

    alignment = alignmentCheck.alignment;
    if (
      alignment.documentId !== documentId ||
      alignment.sourceRevision !== receiptEnvelope.revision ||
      alignment.sourceUpdatedAt !== receipt.updatedAt ||
      alignment.sourceSha256 !== receipt.sha256 ||
      alignment.originalHandoffCaseRevision !== catalogHandoff.caseRevision ||
      alignment.alignedHumanCaseRevision < catalogHandoff.caseRevision ||
      Date.parse(alignment.alignedHumanCaseUpdatedAt) <
        Date.parse(catalogHandoff.caseUpdatedAt) ||
      alignment.documentUpdatedAt !== catalogDocument.updatedAt
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
        errorMessage:
          BINARY_SAFETY_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
      });
    }

    effectiveHumanCaseRevision = alignment.alignedHumanCaseRevision;
    effectiveHumanCaseUpdatedAt = alignment.alignedHumanCaseUpdatedAt;
  } else {
    if (catalogDocument.updatedAt !== catalogHandoff.createdAt) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
        errorMessage:
          BINARY_SAFETY_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
      });
    }
  }

  if (
    humanReviewCase.revision !== effectiveHumanCaseRevision ||
    humanReviewCase.updatedAt !== effectiveHumanCaseUpdatedAt
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
      errorMessage:
        BINARY_SAFETY_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
    });
  }

  const fourFieldDiff = computeLibraryQuarantineCatalogCaseFourFieldDiff(
    humanReviewCase,
    catalogDocument
  );
  if (fourFieldDiff.hasAnyDifference) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
      errorMessage:
        BINARY_SAFETY_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
    });
  }

  const catalogUpdatedAt = catalogDocument.updatedAt;

  let binarySafetyCase: LibraryQuarantinePersistedBinarySafetyCase | null = null;
  let isCaseCurrent = true;
  let requiresFreshEvidence = false;

  if (snapshots.safetySnap.exists) {
    if (
      snapshots.safetySnap.id !== undefined &&
      snapshots.safetySnap.id !== receiptId
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'DOCUMENT_ID_MISMATCH' as const,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
      });
    }

    const safetyCheck = validatePersistedLibraryQuarantineBinarySafetyCase(
      snapshots.safetySnap.data(),
      receiptId
    );
    if (!safetyCheck.ok) {
      const code =
        safetyCheck.errorCode === 'SECURITY_POSTURE_VIOLATION'
          ? 'SECURITY_POSTURE_VIOLATION'
          : 'CORRUPTED_EXISTING_BINARY_SAFETY_CASE';
      return Object.freeze({
        ok: false as const,
        errorCode: code,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES[code],
      });
    }

    binarySafetyCase = safetyCheck.value;
    if (
      binarySafetyCase.sourceRevision !== receiptEnvelope.revision ||
      binarySafetyCase.sourceUpdatedAt !== receipt.updatedAt ||
      binarySafetyCase.sourceSha256 !== receipt.sha256 ||
      binarySafetyCase.sourceFormat !== sourceFormat ||
      binarySafetyCase.deepInspectionStatus !== deepInspectionStatus
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'BINARY_SAFETY_SOURCE_MISMATCH' as const,
        errorMessage:
          BINARY_SAFETY_STORE_SAFE_MESSAGES.BINARY_SAFETY_SOURCE_MISMATCH,
      });
    }

    if (
      binarySafetyCase.effectiveHumanCaseRevision < catalogHandoff.caseRevision ||
      binarySafetyCase.effectiveHumanCaseRevision > effectiveHumanCaseRevision ||
      Date.parse(binarySafetyCase.effectiveHumanCaseUpdatedAt) >
        Date.parse(effectiveHumanCaseUpdatedAt) ||
      Date.parse(binarySafetyCase.catalogUpdatedAt) > Date.parse(catalogUpdatedAt)
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
        errorMessage:
          BINARY_SAFETY_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
      });
    }

    if (
      binarySafetyCase.effectiveHumanCaseRevision === effectiveHumanCaseRevision &&
      binarySafetyCase.effectiveHumanCaseUpdatedAt === effectiveHumanCaseUpdatedAt &&
      binarySafetyCase.catalogUpdatedAt === catalogUpdatedAt
    ) {
      isCaseCurrent = true;
      requiresFreshEvidence = false;
    } else {
      isCaseCurrent = false;
      requiresFreshEvidence = true;
    }
  }

  return Object.freeze({
    ok: true as const,
    snapshot: Object.freeze({
      receiptId,
      documentId,
      receiptEnvelope,
      reviewDraft,
      humanReviewCase,
      catalogHandoff,
      catalogDocument,
      alignment,
      sourceFormat,
      deepInspectionStatus,
      effectiveHumanCaseRevision,
      effectiveHumanCaseUpdatedAt,
      catalogUpdatedAt,
      binarySafetyCase,
      isCaseCurrent,
      requiresFreshEvidence,
    }),
  });
}

export class FirestoreLibraryQuarantineBinarySafetyCaseStore
  implements LibraryQuarantineBinarySafetyCaseStore
{
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;

  constructor(db: LibraryQuarantineReviewDraftFirestoreDatabase) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      throw new Error(
        'FirestoreLibraryQuarantineBinarySafetyCaseStore requires a Firestore database with collection() and runTransaction().'
      );
    }
    this.db = db;
  }

  private assertAllowedWriteCollection(collectionName: string): void {
    if (!ALLOWED_BINARY_SAFETY_WRITE_COLLECTIONS.has(collectionName)) {
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
   * Performs 7 point reads (`receipt`, `reviewDraft`, `humanReviewCase`,
   * `catalogHandoff`, `qcatDocument`, `alignmentOverlay`, `binarySafetyCase`) and 0 writes.
   */
  public async getBinarySafetyCaseSnapshot(
    receiptId: string
  ): Promise<GetLibraryQuarantineBinarySafetySnapshotResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_RECEIPT_ID' as const,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.INVALID_RECEIPT_ID,
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

      return verifyQuarantineBinarySafetyChainSnapshots(receiptId, {
        receiptSnap,
        draftSnap,
        caseSnap,
        handoffSnap,
        docSnap,
        alignmentSnap,
        safetySnap,
      });
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }
  }

  public async getBinarySafetyCaseEventByReceiptAndRevision(
    receiptId: string,
    revision: number
  ): Promise<GetLibraryQuarantineBinarySafetyEventStoreResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_RECEIPT_ID' as const,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.INVALID_RECEIPT_ID,
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
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.INVALID_EXPECTED_REVISION,
      });
    }

    const eventId = deriveLibraryQuarantineBinarySafetyCaseEventId(
      receiptId,
      revision
    );

    try {
      const snap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION,
        eventId
      ).get();

      if (!snap.exists) {
        return Object.freeze({
          ok: true as const,
          safetyEvent: null,
        });
      }

      if (snap.id !== undefined && snap.id !== eventId) {
        return Object.freeze({
          ok: false as const,
          errorCode: 'DOCUMENT_ID_MISMATCH' as const,
          errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
        });
      }

      const validated = validatePersistedLibraryQuarantineBinarySafetyCaseEvent(
        snap.data(),
        eventId
      );
      if (!validated.ok) {
        return Object.freeze({
          ok: false as const,
          errorCode: validated.errorCode,
          errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES[validated.errorCode],
        });
      }

      return Object.freeze({
        ok: true as const,
        safetyEvent: validated.value,
      });
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }
  }

  /**
   * Atomically creates or updates `library_quarantine_binary_safety_cases/<receiptId>`
   * and appends `library_quarantine_binary_safety_case_events/<receiptId>_<revision>`
   * inside ONE Firestore transaction after reading all 8 point references.
   */
  public async saveBinarySafetyCaseTransactional(
    params: SaveLibraryQuarantineBinarySafetyStoreInput
  ): Promise<SaveLibraryQuarantineBinarySafetyStoreResult> {
    const rawReceiptId =
      params && typeof params.receiptId === 'string' ? params.receiptId : '';
    const safeDocId = isValidLibraryQuarantineReceiptId(rawReceiptId)
      ? deriveQuarantineCatalogDocumentId(rawReceiptId)
      : '';

    const makeHold = (
      reasonCode: LibraryQuarantineBinarySafetyCaseStoreErrorCode
    ): SaveLibraryQuarantineBinarySafetyHoldResult =>
      Object.freeze({
        status: 'HOLD' as const,
        caseSaveOutcome: 'NOT_SAVED' as const,
        caseSaved: false as const,
        receiptId: rawReceiptId,
        documentId: safeDocId,
        reasonCode,
        errorMessage: BINARY_SAFETY_STORE_SAFE_MESSAGES[reasonCode],
      });

    if (!params || typeof params !== 'object') {
      return makeHold('INVALID_BINARY_SAFETY_INPUT_OBJECT');
    }

    if (!isValidLibraryQuarantineReceiptId(params.receiptId)) {
      return makeHold('INVALID_RECEIPT_ID');
    }

    if (
      typeof params.expectedRevision !== 'number' ||
      !Number.isSafeInteger(params.expectedRevision) ||
      params.expectedRevision < 0
    ) {
      return makeHold('INVALID_EXPECTED_REVISION');
    }

    if (
      params.acknowledgedHumanCaseRevision === undefined ||
      typeof params.acknowledgedHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(params.acknowledgedHumanCaseRevision) ||
      params.acknowledgedHumanCaseRevision < 1
    ) {
      return makeHold('UNACKNOWLEDGED_CASE_REVISION_HOLD');
    }

    if (!isValidUploaderUid(params.actorUid)) {
      return makeHold('INVALID_ACTOR_UID');
    }

    if (!isValidIsoUtcTimestamp(params.nowIso)) {
      return makeHold('INVALID_TIMESTAMP');
    }

    const editorialCheck = validateSaveLibraryQuarantineBinarySafetyCaseInput(
      params.input
    );
    if (!editorialCheck.ok) {
      return makeHold(editorialCheck.errorCode);
    }

    const normalizedEditorial = editorialCheck.value;
    const receiptId = params.receiptId;
    const documentId = deriveQuarantineCatalogDocumentId(receiptId);
    const expectedRevision = params.expectedRevision;
    const acknowledgedHumanCaseRevision = params.acknowledgedHumanCaseRevision;
    const targetRevision = expectedRevision + 1;
    const targetEventId = deriveLibraryQuarantineBinarySafetyCaseEventId(
      receiptId,
      targetRevision
    );
    const actorUid = params.actorUid;
    const nowIso = params.nowIso;

    // Track whether ANY transaction attempt staged writes (declared outside callback, never reset)
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
          const eventRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION,
            targetEventId
          );

          // Step 1: Read all 8 point references inside the transaction callback BEFORE staging any write
          const receiptSnap = await tx.get(receiptRef);
          const draftSnap = await tx.get(draftRef);
          const caseSnap = await tx.get(caseRef);
          const handoffSnap = await tx.get(handoffRef);
          const docSnap = await tx.get(docRef);
          const alignmentSnap = await tx.get(alignmentRef);
          const safetySnap = await tx.get(safetyRef);
          const eventSnap = await tx.get(eventRef);

          // Step 2: Verify the 7-document provenance chain and drift invariants
          const chainResult = verifyQuarantineBinarySafetyChainSnapshots(
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
          if (!chainResult.ok) {
            throw new PreWriteBinarySafetyTransactionAbortError(
              chainResult.errorCode
            );
          }

          const chainSnapshot = chainResult.snapshot;
          const existingSafetyCase = chainSnapshot.binarySafetyCase;
          const currentRevision = existingSafetyCase
            ? existingSafetyCase.revision
            : 0;

          // Step 3: Compare-and-swap (CAS) check on expectedRevision
          if (expectedRevision !== currentRevision) {
            throw new PreWriteBinarySafetyRevisionConflictError(
              currentRevision,
              existingSafetyCase,
              chainSnapshot
            );
          }

          // Step 3b: Enforce acknowledgedHumanCaseRevision matching effectiveHumanCaseRevision
          if (
            acknowledgedHumanCaseRevision !==
            chainSnapshot.effectiveHumanCaseRevision
          ) {
            throw new PreWriteBinarySafetyTransactionAbortError(
              'UNACKNOWLEDGED_CASE_REVISION_HOLD'
            );
          }

          // Step 3c: When renewing a stale safety case (recorded against an older case/qcat version),
          // forbid verbatim reuse of stale evidence without fresh evidence notes/reference
          if (
            existingSafetyCase !== null &&
            chainSnapshot.requiresFreshEvidence &&
            existingSafetyCase.disposition === normalizedEditorial.disposition &&
            existingSafetyCase.evidenceReference ===
              normalizedEditorial.evidenceReference &&
            existingSafetyCase.evidenceNotes ===
              normalizedEditorial.evidenceNotes &&
            existingSafetyCase.reviewNotes === normalizedEditorial.reviewNotes
          ) {
            throw new PreWriteBinarySafetyTransactionAbortError(
              'STALE_BINARY_SAFETY_EVIDENCE_HOLD'
            );
          }

          // Step 4: Verify append-only audit event slot is unoccupied
          if (eventSnap.exists) {
            throw new PreWriteBinarySafetyTransactionAbortError(
              'AUDIT_EVENT_ALREADY_EXISTS'
            );
          }

          // Step 5: Verify monotonic timestamp ordering
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
          const priorSafetyMs = existingSafetyCase
            ? Date.parse(existingSafetyCase.updatedAt)
            : 0;

          if (
            nowMs < sourceMs ||
            nowMs < draftMs ||
            nowMs < caseMs ||
            nowMs < handoffMs ||
            nowMs < catalogDocMs ||
            (chainSnapshot.alignment !== null && nowMs < alignmentMs) ||
            (existingSafetyCase !== null && nowMs < priorSafetyMs)
          ) {
            throw new PreWriteBinarySafetyTransactionAbortError(
              'TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION'
            );
          }

          const createdBy = existingSafetyCase
            ? existingSafetyCase.createdBy
            : actorUid;
          const createdAt = existingSafetyCase
            ? existingSafetyCase.createdAt
            : nowIso;
          const eventType: LibraryQuarantineBinarySafetyCaseAuditEventType =
            targetRevision === 1 ? 'CREATED' : 'UPDATED';

          const candidateCase: LibraryQuarantinePersistedBinarySafetyCase =
            Object.freeze({
              schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
              receiptId,
              documentId,
              revision: targetRevision,
              sourceRevision: chainSnapshot.receiptEnvelope.revision,
              sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
              sourceSha256: chainSnapshot.receiptEnvelope.receipt.sha256,
              sourceFormat: chainSnapshot.sourceFormat,
              deepInspectionStatus: chainSnapshot.deepInspectionStatus,
              effectiveHumanCaseRevision:
                chainSnapshot.effectiveHumanCaseRevision,
              effectiveHumanCaseUpdatedAt:
                chainSnapshot.effectiveHumanCaseUpdatedAt,
              catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
              disposition: normalizedEditorial.disposition,
              evidenceReference: normalizedEditorial.evidenceReference,
              evidenceNotes: normalizedEditorial.evidenceNotes,
              reviewNotes: normalizedEditorial.reviewNotes,
              createdBy,
              createdAt,
              updatedBy: actorUid,
              updatedAt: nowIso,
              isSanitized: false as const,
              isVerifiedSafe: false as const,
              isRightsApproved: false as const,
              isPublished: false as const,
              isReadyForPeia: false as const,
            });

          const validatedNextCase =
            validatePersistedLibraryQuarantineBinarySafetyCase(
              candidateCase,
              receiptId
            );
          if (!validatedNextCase.ok) {
            throw new PreWriteBinarySafetyTransactionAbortError(
              validatedNextCase.errorCode
            );
          }

          const candidateEvent: LibraryQuarantinePersistedBinarySafetyCaseEvent =
            Object.freeze({
              schemaVersion:
                LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENT_SCHEMA_VERSION,
              eventId: targetEventId,
              receiptId,
              documentId,
              revision: targetRevision,
              previousRevision: currentRevision,
              eventType,
              sourceRevision: chainSnapshot.receiptEnvelope.revision,
              sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
              sourceSha256: chainSnapshot.receiptEnvelope.receipt.sha256,
              sourceFormat: chainSnapshot.sourceFormat,
              deepInspectionStatus: chainSnapshot.deepInspectionStatus,
              effectiveHumanCaseRevision:
                chainSnapshot.effectiveHumanCaseRevision,
              effectiveHumanCaseUpdatedAt:
                chainSnapshot.effectiveHumanCaseUpdatedAt,
              catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
              disposition: normalizedEditorial.disposition,
              evidenceReference: normalizedEditorial.evidenceReference,
              evidenceNotes: normalizedEditorial.evidenceNotes,
              reviewNotes: normalizedEditorial.reviewNotes,
              actorUid,
              recordedAt: nowIso,
              isSanitized: false as const,
              isVerifiedSafe: false as const,
              isRightsApproved: false as const,
              isPublished: false as const,
              isReadyForPeia: false as const,
            });

          const validatedNextEvent =
            validatePersistedLibraryQuarantineBinarySafetyCaseEvent(
              candidateEvent,
              targetEventId
            );
          if (!validatedNextEvent.ok) {
            throw new PreWriteBinarySafetyTransactionAbortError(
              validatedNextEvent.errorCode
            );
          }

          this.assertAllowedWriteCollection(
            LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION
          );
          this.assertAllowedWriteCollection(
            LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION
          );

          // Step 6: Conservatively mark writeStagedInAnyAttempt = true immediately before first write
          // (tx.create or tx.update on safetyRef + tx.create on eventRef; NEVER tx.set)
          if (existingSafetyCase === null) {
            writeStagedInAnyAttempt = true;
            tx.create(
              safetyRef,
              toFirestoreDocumentData(validatedNextCase.value)
            );
          } else {
            const txWithUpdate =
              tx as LibraryQuarantineReviewDraftFirestoreTransaction & {
                update?: (
                  documentRef: LibraryQuarantineFirestoreDocumentRef,
                  data: LibraryQuarantineFirestoreDocumentData
                ) => unknown;
              };
            if (typeof txWithUpdate.update !== 'function') {
              throw new Error(
                'Firestore transaction must support update() for existing binary safety case revisions.'
              );
            }
            writeStagedInAnyAttempt = true;
            txWithUpdate.update(
              safetyRef,
              toFirestoreDocumentData(validatedNextCase.value)
            );
          }

          tx.create(
            eventRef,
            toFirestoreDocumentData(validatedNextEvent.value)
          );

          const updatedChainSnapshot: VerifiedQuarantineBinarySafetyChainSnapshot =
            Object.freeze({
              ...chainSnapshot,
              binarySafetyCase: validatedNextCase.value,
              isCaseCurrent: true,
              requiresFreshEvidence: false,
            });

          return Object.freeze({
            status: 'SAVED' as const,
            caseSaveOutcome: eventType,
            caseSaved: true as const,
            receiptId,
            documentId,
            currentRevision: targetRevision,
            binarySafetyCase: validatedNextCase.value,
            binarySafetyEvent: validatedNextEvent.value,
            chainSnapshot: updatedChainSnapshot,
          });
        }
      );
    } catch (err: unknown) {
      if (writeStagedInAnyAttempt) {
        return Object.freeze({
          status: 'UNKNOWN' as const,
          caseSaveOutcome: 'UNKNOWN' as const,
          caseSaved: null,
          receiptId,
          documentId,
          reasonCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
          errorMessage:
            BINARY_SAFETY_STORE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
        });
      }

      if (err instanceof PreWriteBinarySafetyRevisionConflictError) {
        return Object.freeze({
          status: 'CONFLICT' as const,
          caseSaveOutcome: 'NOT_SAVED' as const,
          caseSaved: false as const,
          receiptId,
          documentId,
          reasonCode: 'BINARY_SAFETY_REVISION_CONFLICT' as const,
          errorMessage:
            BINARY_SAFETY_STORE_SAFE_MESSAGES.BINARY_SAFETY_REVISION_CONFLICT,
          currentRevision: err.currentRevision,
          currentBinarySafetyCase: err.currentBinarySafetyCase,
          chainSnapshot: err.chainSnapshot,
        });
      }

      if (err instanceof PreWriteBinarySafetyTransactionAbortError) {
        return makeHold(err.reasonCode);
      }

      return makeHold('TRANSACTION_ABORTED_NO_WRITE');
    }
  }
}
