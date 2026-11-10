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
  LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_RIGHTS_SCOPE,
  RIGHTS_DECISION_CONTRACT_SAFE_MESSAGES,
  deriveLibraryQuarantineRightsDecisionEventId,
  toSanitizedLibraryQuarantineRightsDecisionDto,
  validatePersistedLibraryQuarantineRightsDecisionEvent,
  validateRightsDecisionInput,
  type LibraryQuarantinePersistedRightsDecision,
  type LibraryQuarantinePersistedRightsDecisionEvent,
  type LibraryQuarantineRightsDecisionAuditEventType,
  type LibraryQuarantineRightsDecisionContractErrorCode,
  type SanitizedLibraryQuarantineRightsDecisionDto,
  type SaveLibraryQuarantineRightsDecisionInput,
} from './libraryQuarantineRightsDecisionContract';
import {
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
  computeLibraryQuarantineCatalogCaseFourFieldDiff,
  validateAlignmentAwarePersistedRightsDecision,
  validatePersistedLibraryQuarantineCatalogCaseAlignment,
  type LibraryQuarantinePersistedCatalogCaseAlignment,
} from './libraryQuarantineCatalogCaseAlignmentService';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';

/**
 * LIB-FILE-RIGHTS-AND-READINESS-01 + LIB-FILE-CASE-ALIGNMENT-01 — Private
 * Firestore Store for Human Rights Review Decisions & Append-Only Audit Events
 */

export const LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION =
  'library_quarantine_rights_decisions' as const;

export const LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENTS_COLLECTION =
  'library_quarantine_rights_decision_events' as const;

const ALLOWED_RIGHTS_STORE_WRITE_COLLECTIONS: ReadonlySet<string> = new Set([
  LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
  LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENTS_COLLECTION,
]);

export type LibraryQuarantineRightsDecisionStoreErrorCode =
  | LibraryQuarantineRightsDecisionContractErrorCode
  | LibraryQuarantineHumanReviewCaseErrorCode
  | 'HUMAN_REVIEW_CASE_NOT_FOUND'
  | 'CASE_NOT_METADATA_RECORDED'
  | 'CATALOG_HANDOFF_NOT_CREATED_HOLD'
  | 'INCONSISTENT_EXISTING_HANDOFF_STATE'
  | 'INVALID_PERSISTED_HANDOFF_SCHEMA'
  | 'HANDOFF_SOURCE_MISMATCH'
  | 'SOURCE_CASE_VERSION_DRIFT_HOLD'
  | 'UNACKNOWLEDGED_CASE_REVISION_HOLD'
  | 'CORRUPTED_EXISTING_RIGHTS_DECISION'
  | 'RIGHTS_DECISION_SOURCE_MISMATCH'
  | 'RIGHTS_DECISION_REVISION_CONFLICT';

export const RIGHTS_DECISION_STORE_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineRightsDecisionStoreErrorCode, string>
> = Object.freeze({
  ...RIGHTS_DECISION_CONTRACT_SAFE_MESSAGES,
  INVALID_CASE_INPUT_OBJECT:
    'Human review case input must be a plain object with allowed editorial fields only.',
  UNTRUSTED_OR_FORBIDDEN_CASE_FIELD:
    'Human review case payload contains an unexpected, privileged, or forbidden property.',
  INVALID_CASE_STATUS:
    'Human review case status must be one of IN_REVIEW, NEEDS_INFORMATION, METADATA_RECORDED, or NOT_SUITABLE.',
  METADATA_RECORDED_REQUIREMENTS_NOT_MET:
    'METADATA_RECORDED requires at least one document title (Arabic or English) and non-empty source evidence notes.',
  EMPTY_REVIEW_CASE_NOT_ALLOWED:
    'Human review case must include at least one non-empty descriptive field or reviewer note.',
  INVALID_PERSISTED_CASE_SCHEMA:
    'Persisted human review case failed strict 20-field schema or integrity validation.',
  INVALID_PERSISTED_EVENT_SCHEMA:
    'Persisted human review audit event failed strict 21-field schema or integrity validation.',
  INVALID_RECEIPT_ID:
    'Quarantine receiptId must be a lowercase 32-character hexadecimal identifier.',
  INVALID_EXPECTED_REVISION:
    'expectedRevision must be a non-negative safe integer (0 for initial rights decision creation).',
  INVALID_ACTOR_UID:
    'Rights reviewer actorUid must be a valid authenticated Firebase user identifier.',
  INVALID_TIMESTAMP:
    'Rights decision timestamp must be a canonical UTC ISO-8601 string.',
  DOCUMENT_ID_MISMATCH:
    'Firestore document identifier does not match the expected quarantine rights record key.',
  SOURCE_RECEIPT_NOT_FOUND:
    'Authoritative quarantine receipt does not exist in library_quarantine_receipts.',
  CORRUPTED_SOURCE_RECEIPT:
    'Authoritative quarantine receipt failed strict envelope schema validation.',
  RECEIPT_NEEDS_RECONCILIATION:
    'Quarantine receipt requires storage reconciliation and is held from rights review.',
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
    'Human review case must be saved in METADATA_RECORDED status before rights review.',
  CATALOG_HANDOFF_NOT_CREATED_HOLD:
    'Internal catalog draft (qcat-) has not been created yet by an authorized curator; create the catalog draft first before recording a rights decision.',
  INCONSISTENT_EXISTING_HANDOFF_STATE:
    'Existing catalog handoff or qcat- draft document is incomplete, corrupted, or violated Draft/ReviewRequired/no-URL locks.',
  INVALID_PERSISTED_HANDOFF_SCHEMA:
    'Persisted catalog handoff link failed strict 18-field schema validation.',
  HANDOFF_SOURCE_MISMATCH:
    'Existing catalog handoff record does not match the current quarantine receipt or review draft revision.',
  SOURCE_CASE_VERSION_DRIFT_HOLD:
    'Current human review case revision or timestamp has drifted from the effective aligned catalog draft revision; align the catalog draft with the saved human review case before recording a rights decision.',
  UNACKNOWLEDGED_CASE_REVISION_HOLD:
    'Explicit acknowledgement of the current effective aligned human review case revision (acknowledgedHumanCaseRevision) is required before recording or renewing a rights decision.',
  CORRUPTED_EXISTING_RIGHTS_DECISION:
    'Existing persisted rights decision record failed strict 25-field schema validation.',
  RIGHTS_DECISION_SOURCE_MISMATCH:
    'Existing persisted rights decision record does not match the authoritative source receipt or linked draft revision.',
  RIGHTS_DECISION_REVISION_CONFLICT:
    'Rights decision revision changed concurrently; reload the latest rights decision before saving.',
  AUDIT_EVENT_ALREADY_EXISTS:
    'Append-only rights decision audit event for the target revision already exists; refusing to overwrite.',
  TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION:
    'Rights decision timestamp cannot precede the source receipt, linked draft, human review case, catalog handoff, or prior rights decision timestamp.',
  TRANSACTION_ABORTED_NO_WRITE:
    'Rights decision transaction aborted before any write was committed.',
  TRANSACTION_COMMIT_UNCERTAIN:
    'Rights decision transaction commit acknowledgement was lost after staging writes; verify decision state before retrying.',
  STORE_READ_FAILED:
    'Point lookup of quarantine rights decision records failed in Firestore.',
});

export function validateAlignmentAwarePersistedRightsDecisionEvent(
  raw: unknown,
  expectedReceiptId?: string,
  expectedRevision?: number
): ReturnType<typeof validatePersistedLibraryQuarantineRightsDecisionEvent> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return validatePersistedLibraryQuarantineRightsDecisionEvent(
      raw,
      expectedReceiptId,
      expectedRevision
    );
  }
  const record = raw as Record<string, unknown>;
  const handoffRev = record.catalogHandoffCaseRevision;
  const currentCaseRev = record.currentHumanCaseRevision;
  if (
    typeof handoffRev !== 'number' ||
    !Number.isSafeInteger(handoffRev) ||
    handoffRev < 1 ||
    typeof currentCaseRev !== 'number' ||
    !Number.isSafeInteger(currentCaseRev) ||
    currentCaseRev < handoffRev
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA',
      errorMessage: 'Persisted rights decision event schema revision or alignment revision is invalid.',
    };
  }
  const normalizedForBaseContract: Record<string, unknown> = {
    ...record,
    currentHumanCaseRevision: handoffRev,
  };
  const baseResult = validatePersistedLibraryQuarantineRightsDecisionEvent(
    normalizedForBaseContract,
    expectedReceiptId,
    expectedRevision
  );
  if (!baseResult.ok) {
    return baseResult;
  }
  const hydrated: LibraryQuarantinePersistedRightsDecisionEvent = Object.freeze({
    ...baseResult.rightsEvent,
    currentHumanCaseRevision: currentCaseRev,
  });
  return {
    ok: true,
    rightsEvent: hydrated,
  };
}

export function toAlignmentAwareSanitizedRightsDecisionDto(
  persisted: LibraryQuarantinePersistedRightsDecision
): SanitizedLibraryQuarantineRightsDecisionDto {
  const checked = validateAlignmentAwarePersistedRightsDecision(
    persisted,
    persisted?.receiptId
  );
  if (!checked.ok) {
    throw new Error(RIGHTS_DECISION_CONTRACT_SAFE_MESSAGES[checked.errorCode]);
  }
  const d = checked.rightsDecision;
  const baseNormalized: LibraryQuarantinePersistedRightsDecision = Object.freeze({
    ...d,
    currentHumanCaseRevision: d.catalogHandoffCaseRevision,
  });
  const baseDto = toSanitizedLibraryQuarantineRightsDecisionDto(baseNormalized);
  return Object.freeze({
    ...baseDto,
    currentHumanCaseRevision: d.currentHumanCaseRevision,
  });
}

export interface VerifiedQuarantineRightsChainSnapshot {
  readonly receiptId: string;
  readonly documentId: string;
  readonly receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly reviewDraft: LibraryQuarantinePersistedReviewDraft;
  readonly humanReviewCase: LibraryQuarantinePersistedHumanReviewCase;
  readonly catalogHandoff: LibraryQuarantinePersistedCatalogHandoff;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null;
  readonly effectiveCaseRevision: number;
  readonly effectiveCaseUpdatedAt: string;
  readonly rightsDecision: LibraryQuarantinePersistedRightsDecision | null;
  readonly rightsDecisionIsCurrent: boolean;
  readonly requiresFreshHumanRightsReview: boolean;
}

export interface GetLibraryQuarantineRightsDecisionSnapshotSuccess {
  readonly ok: true;
  readonly snapshot: VerifiedQuarantineRightsChainSnapshot;
}

export interface GetLibraryQuarantineRightsDecisionSnapshotFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineRightsDecisionStoreErrorCode;
  readonly errorMessage: string;
}

export type GetLibraryQuarantineRightsDecisionSnapshotResult =
  | GetLibraryQuarantineRightsDecisionSnapshotSuccess
  | GetLibraryQuarantineRightsDecisionSnapshotFailure;

export interface GetLibraryQuarantineRightsDecisionEventStoreSuccess {
  readonly ok: true;
  readonly rightsEvent: LibraryQuarantinePersistedRightsDecisionEvent | null;
}

export type GetLibraryQuarantineRightsDecisionEventStoreResult =
  | GetLibraryQuarantineRightsDecisionEventStoreSuccess
  | GetLibraryQuarantineRightsDecisionSnapshotFailure;

export interface SaveLibraryQuarantineRightsDecisionStoreInput {
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly acknowledgedHumanCaseRevision?: number;
  readonly actorUid: string;
  readonly nowIso: string;
  readonly input: SaveLibraryQuarantineRightsDecisionInput;
}

export interface SaveLibraryQuarantineRightsDecisionSavedResult {
  readonly status: 'SAVED';
  readonly decisionSaveOutcome: 'CREATED' | 'UPDATED';
  readonly decisionSaved: true;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentRevision: number;
  readonly rightsDecision: LibraryQuarantinePersistedRightsDecision;
  readonly rightsEvent: LibraryQuarantinePersistedRightsDecisionEvent;
  readonly chainSnapshot: VerifiedQuarantineRightsChainSnapshot;
}

export interface SaveLibraryQuarantineRightsDecisionConflictResult {
  readonly status: 'CONFLICT';
  readonly decisionSaveOutcome: 'NOT_SAVED';
  readonly decisionSaved: false;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: 'RIGHTS_DECISION_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly currentRevision: number;
  readonly currentDecision: LibraryQuarantinePersistedRightsDecision | null;
  readonly chainSnapshot: VerifiedQuarantineRightsChainSnapshot;
}

export interface SaveLibraryQuarantineRightsDecisionHoldResult {
  readonly status: 'HOLD';
  readonly decisionSaveOutcome: 'NOT_SAVED';
  readonly decisionSaved: false;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: LibraryQuarantineRightsDecisionStoreErrorCode;
  readonly errorMessage: string;
}

export interface SaveLibraryQuarantineRightsDecisionUnknownResult {
  readonly status: 'UNKNOWN';
  readonly decisionSaveOutcome: 'UNKNOWN';
  readonly decisionSaved: null;
  readonly receiptId: string;
  readonly documentId: string;
  readonly reasonCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
}

export type SaveLibraryQuarantineRightsDecisionStoreResult =
  | SaveLibraryQuarantineRightsDecisionSavedResult
  | SaveLibraryQuarantineRightsDecisionConflictResult
  | SaveLibraryQuarantineRightsDecisionHoldResult
  | SaveLibraryQuarantineRightsDecisionUnknownResult;

export interface LibraryQuarantineRightsDecisionStore {
  getRightsDecisionSnapshot(
    receiptId: string
  ): Promise<GetLibraryQuarantineRightsDecisionSnapshotResult>;
  getRightsDecisionEventByReceiptAndRevision(
    receiptId: string,
    revision: number
  ): Promise<GetLibraryQuarantineRightsDecisionEventStoreResult>;
  saveRightsDecisionTransactional(
    params: SaveLibraryQuarantineRightsDecisionStoreInput
  ): Promise<SaveLibraryQuarantineRightsDecisionStoreResult>;
}

class PreWriteRightsTransactionAbortError extends Error {
  public readonly reasonCode: LibraryQuarantineRightsDecisionStoreErrorCode;

  constructor(reasonCode: LibraryQuarantineRightsDecisionStoreErrorCode) {
    super(RIGHTS_DECISION_STORE_SAFE_MESSAGES[reasonCode]);
    this.name = 'PreWriteRightsTransactionAbortError';
    this.reasonCode = reasonCode;
  }
}

class PreWriteRightsRevisionConflictError extends Error {
  public readonly currentRevision: number;
  public readonly currentDecision: LibraryQuarantinePersistedRightsDecision | null;
  public readonly chainSnapshot: VerifiedQuarantineRightsChainSnapshot;

  constructor(
    currentRevision: number,
    currentDecision: LibraryQuarantinePersistedRightsDecision | null,
    chainSnapshot: VerifiedQuarantineRightsChainSnapshot
  ) {
    super(
      RIGHTS_DECISION_STORE_SAFE_MESSAGES.RIGHTS_DECISION_REVISION_CONFLICT
    );
    this.name = 'PreWriteRightsRevisionConflictError';
    this.currentRevision = currentRevision;
    this.currentDecision = currentDecision;
    this.chainSnapshot = chainSnapshot;
  }
}

function toFirestoreDocumentData(
  record:
    | LibraryQuarantinePersistedRightsDecision
    | LibraryQuarantinePersistedRightsDecisionEvent
): LibraryQuarantineFirestoreDocumentData {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    clone[key] = value;
  }
  return clone;
}

/**
 * Verifies the full 7-document chain (`receipt`, `reviewDraft`, `humanReviewCase`,
 * `catalogHandoff`, `qcatDocument`, optional `alignmentOverlay`, and optional
 * `rightsDecision`) for a given `receiptId`.
 */
export function verifyQuarantineRightsChainSnapshots(
  receiptId: string,
  snapshots: {
    readonly receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly draftSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly caseSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly handoffSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly docSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly alignmentSnap?: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly decisionSnap: LibraryQuarantineFirestoreDocumentSnapshot;
  }
): GetLibraryQuarantineRightsDecisionSnapshotResult {
  const eligibility = verifyReceiptAndDraftEligibleForHumanReviewCase(
    receiptId,
    snapshots.receiptSnap,
    snapshots.draftSnap
  );
  if (!eligibility.ok) {
    return Object.freeze({
      ok: false as const,
      errorCode: eligibility.reasonCode,
      errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES[eligibility.reasonCode],
    });
  }

  const { receiptEnvelope, reviewDraft } = eligibility;
  const receipt = receiptEnvelope.receipt;
  const documentId = deriveQuarantineCatalogDocumentId(receiptId);

  if (!snapshots.caseSnap.exists) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'HUMAN_REVIEW_CASE_NOT_FOUND' as const,
      errorMessage:
        RIGHTS_DECISION_STORE_SAFE_MESSAGES.HUMAN_REVIEW_CASE_NOT_FOUND,
    });
  }

  if (snapshots.caseSnap.id !== receiptId) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'DOCUMENT_ID_MISMATCH' as const,
      errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
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
        RIGHTS_DECISION_STORE_SAFE_MESSAGES.CORRUPTED_EXISTING_HUMAN_REVIEW_CASE,
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
        RIGHTS_DECISION_STORE_SAFE_MESSAGES.CASE_SOURCE_STALE_OR_MISMATCHED,
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
      errorMessage:
        RIGHTS_DECISION_STORE_SAFE_MESSAGES.CASE_NOT_METADATA_RECORDED,
    });
  }

  if (!snapshots.handoffSnap.exists && !snapshots.docSnap.exists) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'CATALOG_HANDOFF_NOT_CREATED_HOLD' as const,
      errorMessage:
        RIGHTS_DECISION_STORE_SAFE_MESSAGES.CATALOG_HANDOFF_NOT_CREATED_HOLD,
    });
  }

  if (!snapshots.handoffSnap.exists || !snapshots.docSnap.exists) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' as const,
      errorMessage:
        RIGHTS_DECISION_STORE_SAFE_MESSAGES.INCONSISTENT_EXISTING_HANDOFF_STATE,
    });
  }

  if (
    snapshots.handoffSnap.id !== receiptId ||
    snapshots.docSnap.id !== documentId
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'DOCUMENT_ID_MISMATCH' as const,
      errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
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
      errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES[handoffCheck.errorCode],
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
      errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.HANDOFF_SOURCE_MISMATCH,
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
      errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES[docCheck.errorCode],
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
        RIGHTS_DECISION_STORE_SAFE_MESSAGES.INCONSISTENT_EXISTING_HANDOFF_STATE,
    });
  }

  let alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null = null;
  let effectiveCaseRevision = catalogHandoff.caseRevision;
  let effectiveCaseUpdatedAt = catalogHandoff.caseUpdatedAt;

  if (snapshots.alignmentSnap && snapshots.alignmentSnap.exists) {
    if (snapshots.alignmentSnap.id !== receiptId) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'DOCUMENT_ID_MISMATCH' as const,
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
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
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES[code],
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
          RIGHTS_DECISION_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
      });
    }

    effectiveCaseRevision = alignment.alignedHumanCaseRevision;
    effectiveCaseUpdatedAt = alignment.alignedHumanCaseUpdatedAt;

    const fourFieldDiff = computeLibraryQuarantineCatalogCaseFourFieldDiff(
      humanReviewCase,
      catalogDocument
    );
    if (
      humanReviewCase.revision === effectiveCaseRevision &&
      fourFieldDiff.hasAnyDifference
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
        errorMessage:
          RIGHTS_DECISION_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
      });
    }
  } else {
    if (catalogDocument.updatedAt !== catalogHandoff.createdAt) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
        errorMessage:
          RIGHTS_DECISION_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
      });
    }
  }

  // Source/case version drift guard: human review case must match the effective
  // aligned case revision and timestamp (either original handoff or verified alignment overlay).
  if (
    humanReviewCase.revision !== effectiveCaseRevision ||
    humanReviewCase.updatedAt !== effectiveCaseUpdatedAt
  ) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
      errorMessage:
        RIGHTS_DECISION_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
    });
  }

  let rightsDecision: LibraryQuarantinePersistedRightsDecision | null = null;
  let rightsDecisionIsCurrent = false;
  let requiresFreshHumanRightsReview = true;

  if (snapshots.decisionSnap.exists) {
    if (snapshots.decisionSnap.id !== receiptId) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'DOCUMENT_ID_MISMATCH' as const,
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
      });
    }

    const decisionCheck = validateAlignmentAwarePersistedRightsDecision(
      snapshots.decisionSnap.data(),
      receiptId
    );
    if (!decisionCheck.ok) {
      const code =
        decisionCheck.errorCode === 'SECURITY_POSTURE_VIOLATION'
          ? 'SECURITY_POSTURE_VIOLATION'
          : 'CORRUPTED_EXISTING_RIGHTS_DECISION';
      return Object.freeze({
        ok: false as const,
        errorCode: code,
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES[code],
      });
    }

    rightsDecision = decisionCheck.rightsDecision;
    if (
      rightsDecision.sourceRevision !== receiptEnvelope.revision ||
      rightsDecision.sourceUpdatedAt !== receipt.updatedAt ||
      rightsDecision.sourceSha256 !== receipt.sha256 ||
      rightsDecision.draftSourceRevision !== reviewDraft.sourceRevision
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'RIGHTS_DECISION_SOURCE_MISMATCH' as const,
        errorMessage:
          RIGHTS_DECISION_STORE_SAFE_MESSAGES.RIGHTS_DECISION_SOURCE_MISMATCH,
      });
    }

    if (
      rightsDecision.catalogHandoffCaseRevision !== catalogHandoff.caseRevision ||
      rightsDecision.currentHumanCaseRevision < catalogHandoff.caseRevision ||
      rightsDecision.currentHumanCaseRevision > effectiveCaseRevision
    ) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD' as const,
        errorMessage:
          RIGHTS_DECISION_STORE_SAFE_MESSAGES.SOURCE_CASE_VERSION_DRIFT_HOLD,
      });
    }

    if (rightsDecision.currentHumanCaseRevision === effectiveCaseRevision) {
      rightsDecisionIsCurrent = true;
      requiresFreshHumanRightsReview = false;
    } else {
      // Stale prior rights decision recorded for an older case revision before realignment.
      // Retained for audit history only; not effective for the current aligned case.
      rightsDecisionIsCurrent = false;
      requiresFreshHumanRightsReview = true;
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
      effectiveCaseRevision,
      effectiveCaseUpdatedAt,
      rightsDecision,
      rightsDecisionIsCurrent,
      requiresFreshHumanRightsReview,
    }),
  });
}

export class FirestoreLibraryQuarantineRightsDecisionStore
  implements LibraryQuarantineRightsDecisionStore
{
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;

  constructor(db: LibraryQuarantineReviewDraftFirestoreDatabase) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      throw new Error(
        'FirestoreLibraryQuarantineRightsDecisionStore requires a Firestore database with collection() and runTransaction().'
      );
    }
    this.db = db;
  }

  private assertAllowedWriteCollection(collectionName: string): void {
    if (!ALLOWED_RIGHTS_STORE_WRITE_COLLECTIONS.has(collectionName)) {
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
   * `catalogHandoff`, `qcatDocument`, `alignmentOverlay`, `rightsDecision`) and 0 writes.
   */
  public async getRightsDecisionSnapshot(
    receiptId: string
  ): Promise<GetLibraryQuarantineRightsDecisionSnapshotResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_RECEIPT_ID' as const,
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.INVALID_RECEIPT_ID,
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
      const decisionSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
        receiptId
      ).get();

      return verifyQuarantineRightsChainSnapshots(receiptId, {
        receiptSnap,
        draftSnap,
        caseSnap,
        handoffSnap,
        docSnap,
        alignmentSnap,
        decisionSnap,
      });
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }
  }

  /**
   * Point lookup of a single append-only audit event in
   * `library_quarantine_rights_decision_events/<receiptId>_<revision>`.
   */
  public async getRightsDecisionEventByReceiptAndRevision(
    receiptId: string,
    revision: number
  ): Promise<GetLibraryQuarantineRightsDecisionEventStoreResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_RECEIPT_ID' as const,
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.INVALID_RECEIPT_ID,
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
          RIGHTS_DECISION_STORE_SAFE_MESSAGES.INVALID_EXPECTED_REVISION,
      });
    }

    const eventId = deriveLibraryQuarantineRightsDecisionEventId(
      receiptId,
      revision
    );

    try {
      const snap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENTS_COLLECTION,
        eventId
      ).get();

      if (!snap.exists) {
        return Object.freeze({
          ok: true as const,
          rightsEvent: null,
        });
      }

      if (snap.id !== eventId) {
        return Object.freeze({
          ok: false as const,
          errorCode: 'DOCUMENT_ID_MISMATCH' as const,
          errorMessage:
            RIGHTS_DECISION_STORE_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
        });
      }

      const validated = validateAlignmentAwarePersistedRightsDecisionEvent(
        snap.data(),
        receiptId,
        revision
      );
      if (!validated.ok) {
        return Object.freeze({
          ok: false as const,
          errorCode: validated.errorCode,
          errorMessage:
            RIGHTS_DECISION_STORE_SAFE_MESSAGES[validated.errorCode],
        });
      }

      return Object.freeze({
        ok: true as const,
        rightsEvent: validated.rightsEvent,
      });
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }
  }

  /**
   * Atomically creates or updates `library_quarantine_rights_decisions/<receiptId>`
   * and appends `library_quarantine_rights_decision_events/<receiptId>_<revision>`
   * inside ONE Firestore transaction after reading all 8 point references.
   */
  public async saveRightsDecisionTransactional(
    params: SaveLibraryQuarantineRightsDecisionStoreInput
  ): Promise<SaveLibraryQuarantineRightsDecisionStoreResult> {
    const rawReceiptId =
      params && typeof params.receiptId === 'string' ? params.receiptId : '';
    const safeDocId = isValidLibraryQuarantineReceiptId(rawReceiptId)
      ? deriveQuarantineCatalogDocumentId(rawReceiptId)
      : '';

    const makeHold = (
      reasonCode: LibraryQuarantineRightsDecisionStoreErrorCode
    ): SaveLibraryQuarantineRightsDecisionHoldResult =>
      Object.freeze({
        status: 'HOLD' as const,
        decisionSaveOutcome: 'NOT_SAVED' as const,
        decisionSaved: false as const,
        receiptId: rawReceiptId,
        documentId: safeDocId,
        reasonCode,
        errorMessage: RIGHTS_DECISION_STORE_SAFE_MESSAGES[reasonCode],
      });

    if (!params || typeof params !== 'object') {
      return makeHold('INVALID_RIGHTS_DECISION_INPUT_OBJECT');
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
      params.acknowledgedHumanCaseRevision !== undefined &&
      (typeof params.acknowledgedHumanCaseRevision !== 'number' ||
        !Number.isSafeInteger(params.acknowledgedHumanCaseRevision) ||
        params.acknowledgedHumanCaseRevision < 1)
    ) {
      return makeHold('UNACKNOWLEDGED_CASE_REVISION_HOLD');
    }

    if (!isValidUploaderUid(params.actorUid)) {
      return makeHold('INVALID_ACTOR_UID');
    }

    if (!isValidIsoUtcTimestamp(params.nowIso)) {
      return makeHold('INVALID_TIMESTAMP');
    }

    const editorialCheck = validateRightsDecisionInput(params.input);
    if (!editorialCheck.ok) {
      return makeHold(editorialCheck.errorCode);
    }

    const normalizedEditorial = editorialCheck.value;
    const receiptId = params.receiptId;
    const documentId = deriveQuarantineCatalogDocumentId(receiptId);
    const expectedRevision = params.expectedRevision;
    const acknowledgedHumanCaseRevision = params.acknowledgedHumanCaseRevision;
    const targetRevision = expectedRevision + 1;
    const targetEventId = deriveLibraryQuarantineRightsDecisionEventId(
      receiptId,
      targetRevision
    );
    const actorUid = params.actorUid;
    const nowIso = params.nowIso;

    // Track whether ANY transaction attempt staged writes (never reset inside callback)
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
          const decisionRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
            receiptId
          );
          const eventRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENTS_COLLECTION,
            targetEventId
          );

          // Step 1: Read all 8 point references BEFORE staging any write
          const receiptSnap = await tx.get(receiptRef);
          const draftSnap = await tx.get(draftRef);
          const caseSnap = await tx.get(caseRef);
          const handoffSnap = await tx.get(handoffRef);
          const docSnap = await tx.get(docRef);
          const alignmentSnap = await tx.get(alignmentRef);
          const decisionSnap = await tx.get(decisionRef);
          const eventSnap = await tx.get(eventRef);

          // Step 2: Verify the 7-document provenance chain and drift invariants
          const chainResult = verifyQuarantineRightsChainSnapshots(receiptId, {
            receiptSnap,
            draftSnap,
            caseSnap,
            handoffSnap,
            docSnap,
            alignmentSnap,
            decisionSnap,
          });
          if (!chainResult.ok) {
            throw new PreWriteRightsTransactionAbortError(chainResult.errorCode);
          }

          const chainSnapshot = chainResult.snapshot;
          const existingDecision = chainSnapshot.rightsDecision;
          const currentRevision = existingDecision
            ? existingDecision.revision
            : 0;

          // Step 3: Compare-and-swap (CAS) check on expectedRevision
          if (expectedRevision !== currentRevision) {
            throw new PreWriteRightsRevisionConflictError(
              currentRevision,
              existingDecision,
              chainSnapshot
            );
          }

          // Step 3b: Enforce acknowledgedHumanCaseRevision matching effectiveCaseRevision
          const requiresExplicitCaseRevisionAck =
            chainSnapshot.effectiveCaseRevision !==
              chainSnapshot.catalogHandoff.caseRevision ||
            (existingDecision !== null && !chainSnapshot.rightsDecisionIsCurrent);

          if (
            acknowledgedHumanCaseRevision !== undefined &&
            acknowledgedHumanCaseRevision !== chainSnapshot.effectiveCaseRevision
          ) {
            throw new PreWriteRightsTransactionAbortError(
              'UNACKNOWLEDGED_CASE_REVISION_HOLD'
            );
          }

          if (
            requiresExplicitCaseRevisionAck &&
            acknowledgedHumanCaseRevision !== chainSnapshot.effectiveCaseRevision
          ) {
            throw new PreWriteRightsTransactionAbortError(
              'UNACKNOWLEDGED_CASE_REVISION_HOLD'
            );
          }

          // Step 4: Verify append-only audit event slot is unoccupied
          if (eventSnap.exists) {
            throw new PreWriteRightsTransactionAbortError(
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
          const alignmentMs = chainSnapshot.alignment
            ? Date.parse(chainSnapshot.alignment.updatedAt)
            : 0;
          const priorDecisionMs = existingDecision
            ? Date.parse(existingDecision.updatedAt)
            : 0;

          if (
            nowMs < sourceMs ||
            nowMs < draftMs ||
            nowMs < caseMs ||
            nowMs < handoffMs ||
            (chainSnapshot.alignment !== null && nowMs < alignmentMs) ||
            (existingDecision !== null && nowMs < priorDecisionMs)
          ) {
            throw new PreWriteRightsTransactionAbortError(
              'TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION'
            );
          }

          const createdBy = existingDecision
            ? existingDecision.createdBy
            : actorUid;
          const createdAt = existingDecision
            ? existingDecision.createdAt
            : nowIso;
          const eventType: LibraryQuarantineRightsDecisionAuditEventType =
            targetRevision === 1 ? 'CREATED' : 'UPDATED';

          const candidateDecision: LibraryQuarantinePersistedRightsDecision =
            Object.freeze({
              schemaVersion: LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
              receiptId,
              documentId,
              revision: targetRevision,
              sourceRevision: chainSnapshot.receiptEnvelope.revision,
              sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
              sourceSha256: chainSnapshot.receiptEnvelope.receipt.sha256,
              draftSourceRevision: chainSnapshot.reviewDraft.sourceRevision,
              catalogHandoffCaseRevision:
                chainSnapshot.catalogHandoff.caseRevision,
              currentHumanCaseRevision: chainSnapshot.effectiveCaseRevision,
              rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
              decision: normalizedEditorial.decision,
              basis: normalizedEditorial.basis,
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

          const validatedNextDecision =
            validateAlignmentAwarePersistedRightsDecision(
              candidateDecision,
              receiptId
            );
          if (!validatedNextDecision.ok) {
            throw new PreWriteRightsTransactionAbortError(
              validatedNextDecision.errorCode
            );
          }

          const candidateEvent: LibraryQuarantinePersistedRightsDecisionEvent =
            Object.freeze({
              schemaVersion:
                LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENT_SCHEMA_VERSION,
              eventId: targetEventId,
              receiptId,
              documentId,
              revision: targetRevision,
              previousRevision: currentRevision,
              eventType,
              sourceRevision: chainSnapshot.receiptEnvelope.revision,
              sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
              sourceSha256: chainSnapshot.receiptEnvelope.receipt.sha256,
              draftSourceRevision: chainSnapshot.reviewDraft.sourceRevision,
              catalogHandoffCaseRevision:
                chainSnapshot.catalogHandoff.caseRevision,
              currentHumanCaseRevision: chainSnapshot.effectiveCaseRevision,
              rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
              decision: normalizedEditorial.decision,
              basis: normalizedEditorial.basis,
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
            validateAlignmentAwarePersistedRightsDecisionEvent(
              candidateEvent,
              receiptId,
              targetRevision
            );
          if (!validatedNextEvent.ok) {
            throw new PreWriteRightsTransactionAbortError(
              validatedNextEvent.errorCode
            );
          }

          this.assertAllowedWriteCollection(
            LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION
          );
          this.assertAllowedWriteCollection(
            LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENTS_COLLECTION
          );

          // Step 6: Stage atomic writes (tx.create or tx.update on decision + tx.create on event; NEVER tx.set)
          if (existingDecision === null) {
            tx.create(
              decisionRef,
              toFirestoreDocumentData(validatedNextDecision.rightsDecision)
            );
            writeStagedInAnyAttempt = true;
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
                'Firestore transaction must support update() for existing rights decision revisions.'
              );
            }
            txWithUpdate.update(
              decisionRef,
              toFirestoreDocumentData(validatedNextDecision.rightsDecision)
            );
            writeStagedInAnyAttempt = true;
          }

          tx.create(
            eventRef,
            toFirestoreDocumentData(validatedNextEvent.rightsEvent)
          );

          const updatedChainSnapshot: VerifiedQuarantineRightsChainSnapshot =
            Object.freeze({
              ...chainSnapshot,
              rightsDecision: validatedNextDecision.rightsDecision,
              rightsDecisionIsCurrent: true,
              requiresFreshHumanRightsReview: false,
            });

          return Object.freeze({
            status: 'SAVED' as const,
            decisionSaveOutcome: eventType,
            decisionSaved: true as const,
            receiptId,
            documentId,
            currentRevision: targetRevision,
            rightsDecision: validatedNextDecision.rightsDecision,
            rightsEvent: validatedNextEvent.rightsEvent,
            chainSnapshot: updatedChainSnapshot,
          });
        }
      );
    } catch (err: unknown) {
      // CRITICAL: If any transaction attempt staged a write before failing or retrying,
      // commit status is uncertain and MUST be reported as UNKNOWN (decisionSaved: null),
      // even if a subsequent retry attempt aborted pre-write.
      if (writeStagedInAnyAttempt) {
        return Object.freeze({
          status: 'UNKNOWN' as const,
          decisionSaveOutcome: 'UNKNOWN' as const,
          decisionSaved: null,
          receiptId,
          documentId,
          reasonCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
          errorMessage:
            RIGHTS_DECISION_STORE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
        });
      }

      if (err instanceof PreWriteRightsRevisionConflictError) {
        return Object.freeze({
          status: 'CONFLICT' as const,
          decisionSaveOutcome: 'NOT_SAVED' as const,
          decisionSaved: false as const,
          receiptId,
          documentId,
          reasonCode: 'RIGHTS_DECISION_REVISION_CONFLICT' as const,
          errorMessage:
            RIGHTS_DECISION_STORE_SAFE_MESSAGES.RIGHTS_DECISION_REVISION_CONFLICT,
          currentRevision: err.currentRevision,
          currentDecision: err.currentDecision,
          chainSnapshot: err.chainSnapshot,
        });
      }

      if (err instanceof PreWriteRightsTransactionAbortError) {
        return makeHold(err.reasonCode);
      }

      return makeHold('TRANSACTION_ABORTED_NO_WRITE');
    }
  }
}
