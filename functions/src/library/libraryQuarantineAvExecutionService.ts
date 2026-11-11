import type { AdminRepository } from '../admin/adminRepository';
import { AdminRole, type AdminUser } from '../types/admin';
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
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
  verifyQuarantineBinarySafetyChainSnapshots,
} from './firestoreLibraryQuarantineBinarySafetyCaseStore';
import {
  ISOLATED_INSPECTION_STORE_SAFE_MESSAGES,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
  verifyQuarantineIsolatedInspectionChainEligibility,
  type EligibleIsolatedInspectionChainSnapshot,
  type LibraryQuarantineIsolatedInspectionStoreErrorCode,
} from './firestoreLibraryQuarantineIsolatedInspectionRequestStore';
import {
  arePersistedIsolatedInspectionRequestsIncompatible,
  toSanitizedLibraryQuarantineIsolatedInspectionRequestDto,
  validatePersistedLibraryQuarantineIsolatedInspectionRequest,
  type LibraryQuarantinePersistedIsolatedInspectionRequest,
  type SanitizedLibraryQuarantineIsolatedInspectionRequestDto,
} from './libraryQuarantineIsolatedInspectionRequestContract';
import { isAuthorizedHumanBinarySafetyOwner } from './libraryQuarantineBinarySafetyCaseService';
import {
  LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
  LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
  LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
  QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
  arePersistedAvExecutionProvenanceIncompatible,
  deriveQuarantineCatalogDocumentIdFromReceipt,
  isValidAvExecutionFailureReasonCode,
  isValidDispatchAvInspectionConfirmation,
  isValidWorkerRunId,
  parseLibraryQuarantineIsolatedInspectionRequestId,
  toSanitizedLibraryQuarantineAvExecutionDto,
  validatePersistedLibraryQuarantineAvExecution,
  type LibraryQuarantineAvDispatchConfirmationLiteral,
  type LibraryQuarantineAvExecutionFailureReasonCode,
  type LibraryQuarantineAvExecutionState,
  type LibraryQuarantineBinarySafetyDeepInspectionStatus,
  type LibraryQuarantineBinarySafetySourceFormat,
  type LibraryQuarantinePersistedAvExecution,
  type LibraryQuarantineReadinessIndicatorsDto,
  type SanitizedLibraryQuarantineAvExecutionDto,
} from './libraryQuarantineAvExecutionContract';
import {
  GoogleCloudRunQuarantineAvJobInvoker,
  type LibraryQuarantineAvJobInvoker,
} from './libraryQuarantineAvJobInvoker';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import type {
  TrustedQuarantineAuthenticatedPrincipal,
  TrustedQuarantineReviewerPrincipalProvider,
} from './libraryQuarantineReviewDraftPersistenceService';

const ALLOWED_AV_EXECUTION_WRITE_COLLECTIONS: ReadonlySet<string> = new Set([
  LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
]);

const ALLOWED_GET_STATUS_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
]);

const ALLOWED_DISPATCH_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedRequestId',
  'expectedSafetyCaseRevision',
  'acknowledgedHumanCaseRevision',
  'confirmation',
]);

const ALLOWED_PRINCIPAL_KEYS: ReadonlySet<string> = new Set(['uid', 'token']);

const FORBIDDEN_TOKEN_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'role',
  'roles',
  'adminRole',
  'permissions',
  'permission',
  'adminPermissions',
  'isActive',
  'adminActive',
  'isAuthorized',
  'authorized',
  'bypassAuth',
  'forceAuthorize',
  'allow',
  'adminUser',
  'requestedBy',
  'dispatchedBy',
  'createdBy',
  'updatedBy',
  'storagePath',
  'generation',
  'sourceGeneration',
  'sourceSha256',
  'sha256',
  'attestation',
  'candidate',
  'receipt',
  'adminReceipt',
  'url',
  'signedUrl',
  'downloadUrl',
  'bytes',
  'rawBytes',
  'buffer',
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isSanitized',
  'isVerifiedSafe',
]);

export type LibraryQuarantineAvExecutionErrorCode =
  | LibraryQuarantineIsolatedInspectionStoreErrorCode
  | LibraryQuarantineAvExecutionFailureReasonCode
  | 'INVALID_SERVICE_INPUT_HOLD'
  | 'UNTRUSTED_CALLER_FIELD_HOLD'
  | 'UNAUTHENTICATED_CALLER_HOLD'
  | 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD'
  | 'INSPECTION_REQUEST_NOT_RECORDED_HOLD'
  | 'INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE'
  | 'TIMESTAMP_BEFORE_SAFETY_CASE_HOLD'
  | 'REQUEST_ID_MISMATCH_HOLD'
  | 'CORRUPTED_EXISTING_AV_EXECUTION'
  | 'AV_EXECUTION_PROVENANCE_MISMATCH'
  | 'AV_EXECUTION_REVISION_CONFLICT'
  | 'AV_EXECUTION_NOT_FOUND';

export const AV_EXECUTION_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineAvExecutionErrorCode, string>
> = Object.freeze({
  ...ISOLATED_INSPECTION_STORE_SAFE_MESSAGES,
  SECURITY_POSTURE_VIOLATION:
    'Isolated AV execution record violated mandatory false security posture locks.',
  TRANSACTION_COMMIT_UNCERTAIN:
    'Transaction commit acknowledgement or job dispatch status was uncertain; verify state via GET before retrying.',
  STORE_READ_FAILED:
    'Point lookup of quarantine AV execution records failed in Firestore.',
  BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD:
    'Isolated AV execution is only permitted when the current saved binary safety case disposition is ISOLATED_ASSESSMENT_REQUIRED.',
  CONFIRMATION_LITERAL_REQUIRED_HOLD:
    'confirmation must equal START_REAL_ISOLATED_AV_SCAN.',
  SAFETY_CASE_REVISION_CONFLICT:
    'Saved binary safety case revision changed concurrently; reload the latest binary safety case before dispatching.',
  INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE:
    'Existing isolated inspection request record is incompatible with the authoritative source chain.',
  TIMESTAMP_BEFORE_SAFETY_CASE_HOLD:
    'Execution timestamp cannot precede the isolated inspection request or binary safety case timestamp.',
  JOB_CONFIG_MISSING_OR_INVALID:
    'Cloud Run Job configuration (projectId, region, jobName) is missing or invalid on the server.',
  IAM_PRECONDITION_FAILED:
    'Server IAM preconditions for launching the isolated Cloud Run Job failed.',
  JOB_LAUNCH_REJECTED:
    'Cloud Run Jobs API rejected the isolated AV scan job launch prior to execution.',
  JOB_LAUNCH_UNCERTAIN:
    'Cloud Run Job launch acknowledgement was lost or ambiguous; verify status via GET without re-dispatching.',
  CLAMAV_BINARY_MISSING:
    'Isolated worker could not locate a valid ClamAV scanner executable.',
  SIGNATURE_DB_MISSING:
    'Isolated worker ClamAV signature database files are missing.',
  SIGNATURE_DB_STALE:
    'Isolated worker ClamAV signature database exceeded the maximum freshness TTL.',
  QUARANTINE_BUCKET_MISMATCH:
    'Isolated worker refused to bind to a non-quarantine or default bucket.',
  QUARANTINE_OBJECT_MISSING:
    'Quarantine object for the pinned generation does not exist in the dedicated quarantine bucket.',
  QUARANTINE_OBJECT_METADATA_MISMATCH:
    'Quarantine object metadata failed generation, byteSize, contentType, or private ACL verification.',
  QUARANTINE_STREAM_TIMEOUT:
    'Streaming quarantine object bytes to isolated worker timed out.',
  QUARANTINE_BYTE_SIZE_MISMATCH:
    'Streamed quarantine byte count did not match authoritative receipt.byteSize.',
  QUARANTINE_SHA256_MISMATCH:
    'Streamed quarantine SHA-256 digest did not match authoritative receipt.sha256.',
  SCAN_TIMEOUT: 'Isolated ClamAV scan timed out and was terminated.',
  SCAN_EXECUTION_ERROR:
    'Isolated ClamAV scanner exited with an engine error (>= 2).',
  SOURCE_CHAIN_DRIFT_DURING_SCAN:
    'Source receipt, human review case, catalog draft, or binary safety case changed before or during the AV scan.',
  RECEIPT_GENERATION_DRIFT_DURING_SCAN:
    'Quarantine receipt storage generation or SHA-256 changed during the AV scan.',
  TEMP_WORKSPACE_INIT_FAILED:
    'Isolated worker failed to initialize restricted temporary workspace.',
  INVALID_SERVICE_INPUT_HOLD:
    'AV inspection execution request payload must be a plain object with required fields.',
  UNTRUSTED_CALLER_FIELD_HOLD:
    'AV inspection execution payload contains an unexpected, privileged, or forbidden property.',
  UNAUTHENTICATED_CALLER_HOLD:
    'Request is missing a valid server-authenticated Firebase user principal.',
  UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD:
    'Authenticated caller is not an active authorized human Library Owner with Review permission.',
  INSPECTION_REQUEST_NOT_RECORDED_HOLD:
    'An immutable RECORDED_NOT_DISPATCHED isolated inspection request must be recorded for the current version before dispatching AV execution.',
  REQUEST_ID_MISMATCH_HOLD:
    'expectedRequestId does not match the deterministic requestId for the current source and binary safety case revision.',
  CORRUPTED_EXISTING_AV_EXECUTION:
    'Existing persisted AV execution ledger record failed strict 33-field schema validation.',
  AV_EXECUTION_PROVENANCE_MISMATCH:
    'Existing persisted AV execution ledger record does not match the authoritative source chain.',
  AV_EXECUTION_REVISION_CONFLICT:
    'AV execution ledger revision changed concurrently.',
  AV_EXECUTION_NOT_FOUND:
    'AV execution ledger record does not exist for this requestId.',
});

export type QuarantineAvInspectionOverallStatus =
  | 'NOT_DISPATCHED'
  | LibraryQuarantineAvExecutionState;

export interface GetLibraryQuarantineAvInspectionStatusSuccessDto {
  readonly ok: true;
  readonly status: QuarantineAvInspectionOverallStatus;
  readonly outcome: QuarantineAvInspectionOverallStatus;
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly inspectionRequestRecorded: boolean;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineAvInspectionStatusHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly errorCode: LibraryQuarantineAvExecutionErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineAvInspectionStatusResponseDto =
  | GetLibraryQuarantineAvInspectionStatusSuccessDto
  | GetLibraryQuarantineAvInspectionStatusHoldDto;

export interface DispatchLibraryQuarantineAvInspectionSuccessDto {
  readonly ok: true;
  readonly status: LibraryQuarantineAvExecutionState;
  readonly outcome: 'DISPATCHED' | 'ALREADY_DISPATCHED';
  readonly dispatchOutcome: 'DISPATCHED' | 'ALREADY_DISPATCHED';
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface DispatchLibraryQuarantineAvInspectionConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly outcome: 'CONFLICT';
  readonly dispatchOutcome: 'NOT_DISPATCHED';
  readonly errorCode: 'SAFETY_CASE_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentSafetyCaseRevision: number;
  readonly currentEffectiveHumanCaseRevision: number;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface DispatchLibraryQuarantineAvInspectionHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly dispatchOutcome: 'NOT_DISPATCHED';
  readonly errorCode: LibraryQuarantineAvExecutionErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface DispatchLibraryQuarantineAvInspectionUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly outcome: 'UNKNOWN';
  readonly dispatchOutcome: 'UNKNOWN';
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' | 'JOB_LAUNCH_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string | null;
  readonly execution: SanitizedLibraryQuarantineAvExecutionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type DispatchLibraryQuarantineAvInspectionResponseDto =
  | DispatchLibraryQuarantineAvInspectionSuccessDto
  | DispatchLibraryQuarantineAvInspectionConflictDto
  | DispatchLibraryQuarantineAvInspectionHoldDto
  | DispatchLibraryQuarantineAvInspectionUnknownDto;

export interface WorkerClaimAvExecutionClaimedResult {
  readonly status: 'CLAIMED';
  readonly execution: LibraryQuarantinePersistedAvExecution;
  readonly inspectionRequest: LibraryQuarantinePersistedIsolatedInspectionRequest;
  readonly eligibleChain: EligibleIsolatedInspectionChainSnapshot;
}

export interface WorkerClaimAvExecutionSkippedResult {
  readonly status: 'ALREADY_RUNNING' | 'ALREADY_TERMINAL' | 'STALE_HOLD';
  readonly execution: LibraryQuarantinePersistedAvExecution;
}

export interface WorkerClaimAvExecutionHoldResult {
  readonly status: 'HOLD';
  readonly errorCode: LibraryQuarantineAvExecutionErrorCode;
  readonly errorMessage: string;
}

export type WorkerClaimAvExecutionResult =
  | WorkerClaimAvExecutionClaimedResult
  | WorkerClaimAvExecutionSkippedResult
  | WorkerClaimAvExecutionHoldResult;

export interface WorkerRecordAvScanOutcomeInput {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly workerRunId: string;
  readonly nowIso: string;
  readonly targetState:
    | 'AV_NO_THREAT_DETECTED'
    | 'AV_THREAT_DETECTED'
    | 'AV_SCAN_FAILED'
    | 'STALE_HOLD';
  readonly engineName: 'ClamAV' | null;
  readonly engineVersion: string | null;
  readonly signatureVersion: string | null;
  readonly signatureUpdatedAt: string | null;
  readonly scannedBytes: number | null;
  readonly exitCode: number | null;
  readonly failureReasonCode: LibraryQuarantineAvExecutionFailureReasonCode | null;
  readonly observedGcsGeneration?: string;
  readonly observedSha256?: string;
  readonly observedByteSize?: number;
}

export interface WorkerRecordAvScanOutcomeRecordedResult {
  readonly status: 'RECORDED';
  readonly execution: LibraryQuarantinePersistedAvExecution;
}

export interface WorkerRecordAvScanOutcomeHoldResult {
  readonly status: 'HOLD';
  readonly errorCode: LibraryQuarantineAvExecutionErrorCode;
  readonly errorMessage: string;
}

export type WorkerRecordAvScanOutcomeResult =
  | WorkerRecordAvScanOutcomeRecordedResult
  | WorkerRecordAvScanOutcomeHoldResult;

class PreWriteAvExecutionAbortError extends Error {
  public readonly reasonCode: LibraryQuarantineAvExecutionErrorCode;

  constructor(reasonCode: LibraryQuarantineAvExecutionErrorCode) {
    super(AV_EXECUTION_SAFE_MESSAGES[reasonCode]);
    this.name = 'PreWriteAvExecutionAbortError';
    this.reasonCode = reasonCode;
  }
}

class PreWriteAvSafetyCaseConflictError extends Error {
  public readonly currentSafetyCaseRevision: number;
  public readonly currentEffectiveHumanCaseRevision: number;

  constructor(
    currentSafetyCaseRevision: number,
    currentEffectiveHumanCaseRevision: number
  ) {
    super(AV_EXECUTION_SAFE_MESSAGES.SAFETY_CASE_REVISION_CONFLICT);
    this.name = 'PreWriteAvSafetyCaseConflictError';
    this.currentSafetyCaseRevision = currentSafetyCaseRevision;
    this.currentEffectiveHumanCaseRevision = currentEffectiveHumanCaseRevision;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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

function hasAutomatedOrAiTokenClaim(
  token: Readonly<Record<string, unknown>>
): boolean {
  const principalTypeLower =
    typeof token.principalType === 'string'
      ? token.principalType.trim().toLowerCase()
      : '';
  const actorTypeLower =
    typeof token.actorType === 'string'
      ? token.actorType.trim().toLowerCase()
      : '';
  const roleLower =
    typeof token.role === 'string' ? token.role.trim().toLowerCase() : '';

  return (
    token.role === AdminRole.AIAssistant ||
    roleLower === 'ai_assistant' ||
    roleLower === 'aiassistant' ||
    token.isAIAssistant === true ||
    token.isAiAssistant === true ||
    token.aiAssistant === true ||
    token.ai === true ||
    token.automated === true ||
    token.isBot === true ||
    principalTypeLower === 'ai' ||
    principalTypeLower === 'machine' ||
    principalTypeLower === 'bot' ||
    actorTypeLower === 'ai' ||
    actorTypeLower === 'machine' ||
    actorTypeLower === 'bot'
  );
}

function toFirestoreDocumentData(
  record: LibraryQuarantinePersistedAvExecution
): LibraryQuarantineFirestoreDocumentData {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    clone[key] = value;
  }
  return clone;
}

export class FirestoreLibraryQuarantineAvExecutionStore {
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;

  constructor(db: LibraryQuarantineReviewDraftFirestoreDatabase) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      throw new Error(
        'FirestoreLibraryQuarantineAvExecutionStore requires a Firestore database with collection() and runTransaction().'
      );
    }
    this.db = db;
  }

  private assertAllowedWriteCollection(collectionName: string): void {
    if (!ALLOWED_AV_EXECUTION_WRITE_COLLECTIONS.has(collectionName)) {
      throw new Error(
        `FORBIDDEN_COLLECTION_WRITE: Attempted to write to collection "${collectionName}".`
      );
    }
  }

  private setAvExecutionRecordInTransaction(
    tx: LibraryQuarantineReviewDraftFirestoreTransaction,
    execRef: LibraryQuarantineFirestoreDocumentRef,
    record: LibraryQuarantinePersistedAvExecution
  ): void {
    this.assertAllowedWriteCollection(
      LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION
    );
    if (execRef.id !== undefined && execRef.id !== record.requestId) {
      throw new Error(
        'DOCUMENT_ID_MISMATCH: AV execution document reference ID does not match record.requestId.'
      );
    }
    const setFn = (
      tx as Partial<{
        set(
          documentRef: LibraryQuarantineFirestoreDocumentRef,
          data: Record<string, unknown>
        ): unknown;
      }>
    )?.set;
    if (typeof setFn !== 'function') {
      throw new Error(
        'INVALID_AV_EXECUTION_TRANSACTION: Firestore transaction does not expose a set() method for AV execution CAS updates.'
      );
    }
    setFn.call(
      tx,
      execRef,
      toFirestoreDocumentData(record) as Record<string, unknown>
    );
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
   * Performs 9 point reads (`receipt`, `reviewDraft`, `humanReviewCase`,
   * `catalogHandoff`, `qcatDocument`, `alignmentOverlay`, `binarySafetyCase`,
   * `isolatedInspectionRequest`, `avExecution`) and 0 writes.
   */
  public async getAvInspectionStatusSnapshot(receiptId: string): Promise<
    | {
        readonly ok: true;
        readonly eligibleChain: EligibleIsolatedInspectionChainSnapshot;
        readonly inspectionRequest: LibraryQuarantinePersistedIsolatedInspectionRequest | null;
        readonly execution: LibraryQuarantinePersistedAvExecution | null;
      }
    | {
        readonly ok: false;
        readonly errorCode: LibraryQuarantineAvExecutionErrorCode;
        readonly errorMessage: string;
      }
  > {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return Object.freeze({
        ok: false as const,
        errorCode: 'INVALID_RECEIPT_ID' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.INVALID_RECEIPT_ID,
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
        return Object.freeze({
          ok: false as const,
          errorCode: chainResult.errorCode,
          errorMessage: AV_EXECUTION_SAFE_MESSAGES[chainResult.errorCode],
        });
      }

      const eligibilityResult =
        verifyQuarantineIsolatedInspectionChainEligibility(
          chainResult.snapshot
        );
      if (!eligibilityResult.ok) {
        return Object.freeze({
          ok: false as const,
          errorCode: eligibilityResult.errorCode,
          errorMessage: eligibilityResult.errorMessage,
        });
      }

      const { eligibleChain } = eligibilityResult;
      const { requestId } = eligibleChain;

      const requestSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
        requestId
      ).get();
      const execSnap = await this.getPointDocRef(
        LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
        requestId
      ).get();

      if (!requestSnap.exists) {
        if (execSnap.exists) {
          return Object.freeze({
            ok: false as const,
            errorCode: 'AV_EXECUTION_PROVENANCE_MISMATCH' as const,
            errorMessage:
              AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_PROVENANCE_MISMATCH,
          });
        }
        return Object.freeze({
          ok: true as const,
          eligibleChain,
          inspectionRequest: null,
          execution: null,
        });
      }

      if (requestSnap.id !== undefined && requestSnap.id !== requestId) {
        return Object.freeze({
          ok: false as const,
          errorCode: 'DOCUMENT_ID_MISMATCH' as const,
          errorMessage: AV_EXECUTION_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
        });
      }

      const validatedRequest =
        validatePersistedLibraryQuarantineIsolatedInspectionRequest(
          requestSnap.data(),
          requestId
        );
      if (!validatedRequest.ok) {
        const code =
          validatedRequest.errorCode === 'SECURITY_POSTURE_VIOLATION'
            ? 'SECURITY_POSTURE_VIOLATION'
            : 'CORRUPTED_EXISTING_INSPECTION_REQUEST';
        return Object.freeze({
          ok: false as const,
          errorCode: code,
          errorMessage: AV_EXECUTION_SAFE_MESSAGES[code],
        });
      }

      const receipt = eligibleChain.chainSnapshot.receiptEnvelope.receipt;
      const expectedProvenance = {
        requestId,
        receiptId,
        documentId: eligibleChain.chainSnapshot.documentId,
        sourceRevision: eligibleChain.chainSnapshot.receiptEnvelope.revision,
        sourceUpdatedAt: receipt.updatedAt,
        sourceSha256: receipt.sha256,
        sourceGeneration: eligibleChain.sourceGeneration,
        sourceByteSize: receipt.byteSize,
        sourceFormat: eligibleChain.chainSnapshot.sourceFormat,
        deepInspectionStatus: eligibleChain.chainSnapshot.deepInspectionStatus,
        safetyCaseRevision: eligibleChain.safetyCaseRevision,
        effectiveHumanCaseRevision:
          eligibleChain.chainSnapshot.effectiveHumanCaseRevision,
        catalogUpdatedAt: eligibleChain.chainSnapshot.catalogUpdatedAt,
      };

      if (
        arePersistedIsolatedInspectionRequestsIncompatible(
          validatedRequest.value,
          expectedProvenance
        )
      ) {
        return Object.freeze({
          ok: false as const,
          errorCode: 'INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE' as const,
          errorMessage:
            AV_EXECUTION_SAFE_MESSAGES.INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE,
        });
      }

      if (!execSnap.exists) {
        return Object.freeze({
          ok: true as const,
          eligibleChain,
          inspectionRequest: validatedRequest.value,
          execution: null,
        });
      }

      if (execSnap.id !== undefined && execSnap.id !== requestId) {
        return Object.freeze({
          ok: false as const,
          errorCode: 'DOCUMENT_ID_MISMATCH' as const,
          errorMessage: AV_EXECUTION_SAFE_MESSAGES.DOCUMENT_ID_MISMATCH,
        });
      }

      const validatedExec = validatePersistedLibraryQuarantineAvExecution(
        execSnap.data(),
        requestId
      );
      if (!validatedExec.ok) {
        const code =
          validatedExec.errorCode === 'SECURITY_POSTURE_VIOLATION'
            ? 'SECURITY_POSTURE_VIOLATION'
            : 'CORRUPTED_EXISTING_AV_EXECUTION';
        return Object.freeze({
          ok: false as const,
          errorCode: code,
          errorMessage: AV_EXECUTION_SAFE_MESSAGES[code],
        });
      }

      if (
        arePersistedAvExecutionProvenanceIncompatible(
          validatedExec.value,
          expectedProvenance
        )
      ) {
        return Object.freeze({
          ok: false as const,
          errorCode: 'AV_EXECUTION_PROVENANCE_MISMATCH' as const,
          errorMessage:
            AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_PROVENANCE_MISMATCH,
        });
      }

      return Object.freeze({
        ok: true as const,
        eligibleChain,
        inspectionRequest: validatedRequest.value,
        execution: validatedExec.value,
      });
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }
  }

  /**
   * Phase 1 of dispatch: atomically reads 9 point documents (`receipt`, `reviewDraft`,
   * `humanReviewCase`, `catalogHandoff`, `qcatDocument`, `alignmentOverlay`,
   * `binarySafetyCase`, `isolatedInspectionRequest`, `avExecution`) and either:
   * - returns `ALREADY_EXISTS` with 0 writes if an execution record already exists, or
   * - creates `library_quarantine_av_executions/<requestId>` in `DISPATCH_PENDING` (rev 1)
   *   with 1 `tx.create` write, without mutating `library_quarantine_isolated_inspection_requests`.
   */
  public async createDispatchPendingTransactional(params: {
    readonly receiptId: string;
    readonly expectedRequestId: string;
    readonly expectedSafetyCaseRevision: number;
    readonly acknowledgedHumanCaseRevision: number;
    readonly confirmation: LibraryQuarantineAvDispatchConfirmationLiteral;
    readonly actorUid: string;
    readonly nowIso: string;
  }): Promise<
    | {
        readonly status: 'CREATED_PENDING' | 'ALREADY_EXISTS';
        readonly eligibleChain: EligibleIsolatedInspectionChainSnapshot;
        readonly inspectionRequest: LibraryQuarantinePersistedIsolatedInspectionRequest;
        readonly execution: LibraryQuarantinePersistedAvExecution;
      }
    | {
        readonly status: 'CONFLICT';
        readonly currentSafetyCaseRevision: number;
        readonly currentEffectiveHumanCaseRevision: number;
      }
    | {
        readonly status: 'HOLD';
        readonly errorCode: LibraryQuarantineAvExecutionErrorCode;
        readonly errorMessage: string;
      }
    | {
        readonly status: 'UNKNOWN';
        readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
        readonly errorMessage: string;
      }
  > {
    const {
      receiptId,
      expectedRequestId,
      expectedSafetyCaseRevision,
      acknowledgedHumanCaseRevision,
      actorUid,
      nowIso,
    } = params;
    const documentId = deriveQuarantineCatalogDocumentId(receiptId);

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

          // Read 7 source chain documents
          const receiptSnap = await tx.get(receiptRef);
          const draftSnap = await tx.get(draftRef);
          const caseSnap = await tx.get(caseRef);
          const handoffSnap = await tx.get(handoffRef);
          const docSnap = await tx.get(docRef);
          const alignmentSnap = await tx.get(alignmentRef);
          const safetySnap = await tx.get(safetyRef);

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
            throw new PreWriteAvExecutionAbortError(chainResult.errorCode);
          }

          const eligibilityResult =
            verifyQuarantineIsolatedInspectionChainEligibility(
              chainResult.snapshot
            );
          if (!eligibilityResult.ok) {
            throw new PreWriteAvExecutionAbortError(
              eligibilityResult.errorCode
            );
          }

          const { eligibleChain } = eligibilityResult;
          const {
            chainSnapshot,
            safetyCaseRevision,
            requestId,
          } = eligibleChain;
          const safetyCase = chainSnapshot.binarySafetyCase;

          if (expectedSafetyCaseRevision !== safetyCaseRevision) {
            throw new PreWriteAvSafetyCaseConflictError(
              safetyCaseRevision,
              chainSnapshot.effectiveHumanCaseRevision
            );
          }

          if (
            acknowledgedHumanCaseRevision !==
            chainSnapshot.effectiveHumanCaseRevision
          ) {
            throw new PreWriteAvExecutionAbortError(
              'UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD'
            );
          }

          if (expectedRequestId !== requestId) {
            throw new PreWriteAvExecutionAbortError('REQUEST_ID_MISMATCH_HOLD');
          }

          // Read 8th & 9th point documents before staging any write
          const requestRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
            requestId
          );
          const execRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
            requestId
          );

          const requestSnap = await tx.get(requestRef);
          const execSnap = await tx.get(execRef);

          if (!requestSnap.exists) {
            throw new PreWriteAvExecutionAbortError(
              'INSPECTION_REQUEST_NOT_RECORDED_HOLD'
            );
          }

          if (requestSnap.id !== undefined && requestSnap.id !== requestId) {
            throw new PreWriteAvExecutionAbortError('DOCUMENT_ID_MISMATCH');
          }

          const validatedReq =
            validatePersistedLibraryQuarantineIsolatedInspectionRequest(
              requestSnap.data(),
              requestId
            );
          if (!validatedReq.ok) {
            throw new PreWriteAvExecutionAbortError(
              validatedReq.errorCode === 'SECURITY_POSTURE_VIOLATION'
                ? 'SECURITY_POSTURE_VIOLATION'
                : 'CORRUPTED_EXISTING_INSPECTION_REQUEST'
            );
          }

          const receipt = chainSnapshot.receiptEnvelope.receipt;
          const expectedProvenance = {
            requestId,
            receiptId,
            documentId: chainSnapshot.documentId,
            sourceRevision: chainSnapshot.receiptEnvelope.revision,
            sourceUpdatedAt: receipt.updatedAt,
            sourceSha256: receipt.sha256,
            sourceGeneration: eligibleChain.sourceGeneration,
            sourceByteSize: receipt.byteSize,
            sourceFormat: chainSnapshot.sourceFormat,
            deepInspectionStatus: chainSnapshot.deepInspectionStatus,
            safetyCaseRevision,
            effectiveHumanCaseRevision:
              chainSnapshot.effectiveHumanCaseRevision,
            catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
          };

          if (
            arePersistedIsolatedInspectionRequestsIncompatible(
              validatedReq.value,
              expectedProvenance
            )
          ) {
            throw new PreWriteAvExecutionAbortError(
              'INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE'
            );
          }

          // If an execution record already exists, validate and return ALREADY_EXISTS with 0 writes
          if (execSnap.exists) {
            if (execSnap.id !== undefined && execSnap.id !== requestId) {
              throw new PreWriteAvExecutionAbortError('DOCUMENT_ID_MISMATCH');
            }

            const validatedExisting =
              validatePersistedLibraryQuarantineAvExecution(
                execSnap.data(),
                requestId
              );
            if (!validatedExisting.ok) {
              throw new PreWriteAvExecutionAbortError(
                validatedExisting.errorCode === 'SECURITY_POSTURE_VIOLATION'
                  ? 'SECURITY_POSTURE_VIOLATION'
                  : 'CORRUPTED_EXISTING_AV_EXECUTION'
              );
            }

            if (
              arePersistedAvExecutionProvenanceIncompatible(
                validatedExisting.value,
                expectedProvenance
              )
            ) {
              throw new PreWriteAvExecutionAbortError(
                'AV_EXECUTION_PROVENANCE_MISMATCH'
              );
            }

            return Object.freeze({
              status: 'ALREADY_EXISTS' as const,
              eligibleChain,
              inspectionRequest: validatedReq.value,
              execution: validatedExisting.value,
            });
          }

          // Verify monotonic timestamp ordering
          const nowMs = Date.parse(nowIso);
          const reqMs = Date.parse(validatedReq.value.requestedAt);
          const safetyMs = safetyCase ? Date.parse(safetyCase.updatedAt) : 0;
          const sourceMs = Date.parse(receipt.updatedAt);
          const catalogMs = Date.parse(chainSnapshot.catalogUpdatedAt);
          if (
            nowMs < reqMs ||
            nowMs < safetyMs ||
            nowMs < sourceMs ||
            nowMs < catalogMs
          ) {
            throw new PreWriteAvExecutionAbortError(
              'TIMESTAMP_BEFORE_SAFETY_CASE_HOLD'
            );
          }

          const newPendingExecution: LibraryQuarantinePersistedAvExecution =
            Object.freeze({
              schemaVersion: LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
              requestId,
              receiptId,
              documentId: chainSnapshot.documentId,
              revision: 1,
              sourceRevision: chainSnapshot.receiptEnvelope.revision,
              sourceUpdatedAt: receipt.updatedAt,
              sourceSha256: receipt.sha256,
              sourceGeneration: eligibleChain.sourceGeneration,
              sourceByteSize: receipt.byteSize,
              sourceFormat: chainSnapshot.sourceFormat,
              deepInspectionStatus: chainSnapshot.deepInspectionStatus,
              safetyCaseRevision,
              effectiveHumanCaseRevision:
                chainSnapshot.effectiveHumanCaseRevision,
              catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
              state: 'DISPATCH_PENDING' as const,
              dispatchedBy: actorUid,
              dispatchedAt: nowIso,
              workerRunId: null,
              workerClaimedAt: null,
              completedAt: null,
              engineName: null,
              engineVersion: null,
              signatureVersion: null,
              signatureUpdatedAt: null,
              scannedBytes: null,
              exitCode: null,
              failureReasonCode: null,
              isSanitized: false as const,
              isVerifiedSafe: false as const,
              isRightsApproved: false as const,
              isPublished: false as const,
              isReadyForPeia: false as const,
            });

          const selfValidation = validatePersistedLibraryQuarantineAvExecution(
            newPendingExecution,
            requestId
          );
          if (!selfValidation.ok) {
            throw new PreWriteAvExecutionAbortError(
              selfValidation.errorCode === 'SECURITY_POSTURE_VIOLATION'
                ? 'SECURITY_POSTURE_VIOLATION'
                : 'CORRUPTED_EXISTING_AV_EXECUTION'
            );
          }

          this.assertAllowedWriteCollection(
            LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION
          );
          if (typeof tx.create !== 'function') {
            throw new PreWriteAvExecutionAbortError(
              'TRANSACTION_ABORTED_NO_WRITE'
            );
          }

          writeStagedInAnyAttempt = true;
          tx.create(
            execRef,
            toFirestoreDocumentData(newPendingExecution) as Record<
              string,
              unknown
            >
          );

          return Object.freeze({
            status: 'CREATED_PENDING' as const,
            eligibleChain,
            inspectionRequest: validatedReq.value,
            execution: newPendingExecution,
          });
        }
      );
    } catch (err: unknown) {
      if (err instanceof PreWriteAvSafetyCaseConflictError) {
        return Object.freeze({
          status: 'CONFLICT' as const,
          currentSafetyCaseRevision: err.currentSafetyCaseRevision,
          currentEffectiveHumanCaseRevision:
            err.currentEffectiveHumanCaseRevision,
        });
      }

      if (err instanceof PreWriteAvExecutionAbortError) {
        return Object.freeze({
          status: 'HOLD' as const,
          errorCode: err.reasonCode,
          errorMessage: AV_EXECUTION_SAFE_MESSAGES[err.reasonCode],
        });
      }

      if (writeStagedInAnyAttempt) {
        return Object.freeze({
          status: 'UNKNOWN' as const,
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
          errorMessage: AV_EXECUTION_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
        });
      }

      return Object.freeze({
        status: 'HOLD' as const,
        errorCode: 'TRANSACTION_ABORTED_NO_WRITE' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.TRANSACTION_ABORTED_NO_WRITE,
      });
    }
  }

  /**
   * Phase 2 of dispatch: CAS transition from `DISPATCH_PENDING` (revision 1)
   * after the Cloud Run Jobs API call returns.
   * Never overwrites `RUNNING` or terminal worker states if the worker already claimed/completed.
   */
  public async finalizeDispatchAfterInvokeTransactional(params: {
    readonly requestId: string;
    readonly targetState:
      | 'DISPATCHED_WAITING_WORKER'
      | 'DISPATCH_FAILED'
      | 'DISPATCH_UNKNOWN';
    readonly executionName: string | null;
    readonly failureReasonCode: LibraryQuarantineAvExecutionFailureReasonCode | null;
    readonly nowIso: string;
  }): Promise<
    | {
        readonly ok: true;
        readonly execution: LibraryQuarantinePersistedAvExecution;
      }
    | {
        readonly ok: false;
        readonly errorCode: LibraryQuarantineAvExecutionErrorCode;
        readonly errorMessage: string;
      }
  > {
    try {
      return await this.db.runTransaction(
        async (tx: LibraryQuarantineReviewDraftFirestoreTransaction) => {
          const execRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
            params.requestId
          );
          const execSnap = await tx.get(execRef);
          if (!execSnap.exists) {
            return Object.freeze({
              ok: false as const,
              errorCode: 'AV_EXECUTION_NOT_FOUND' as const,
              errorMessage: AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_NOT_FOUND,
            });
          }

          const validated = validatePersistedLibraryQuarantineAvExecution(
            execSnap.data(),
            params.requestId
          );
          if (!validated.ok) {
            return Object.freeze({
              ok: false as const,
              errorCode: 'CORRUPTED_EXISTING_AV_EXECUTION' as const,
              errorMessage:
                AV_EXECUTION_SAFE_MESSAGES.CORRUPTED_EXISTING_AV_EXECUTION,
            });
          }

          const current = validated.value;
          // If worker already claimed or finished, preserve worker state without overwriting
          if (current.state !== 'DISPATCH_PENDING') {
            return Object.freeze({
              ok: true as const,
              execution: current,
            });
          }

          const updated: LibraryQuarantinePersistedAvExecution = Object.freeze({
            ...current,
            revision: current.revision + 1,
            state: params.targetState,
            workerRunId:
              params.executionName && isValidWorkerRunId(params.executionName)
                ? params.executionName
                : current.workerRunId,
            completedAt:
              params.targetState === 'DISPATCH_FAILED' ? params.nowIso : null,
            failureReasonCode: params.failureReasonCode,
            isSanitized: false as const,
            isVerifiedSafe: false as const,
            isRightsApproved: false as const,
            isPublished: false as const,
            isReadyForPeia: false as const,
          });

          const checkUpdated = validatePersistedLibraryQuarantineAvExecution(
            updated,
            params.requestId
          );
          if (!checkUpdated.ok) {
            return Object.freeze({
              ok: false as const,
              errorCode: 'CORRUPTED_EXISTING_AV_EXECUTION' as const,
              errorMessage:
                AV_EXECUTION_SAFE_MESSAGES.CORRUPTED_EXISTING_AV_EXECUTION,
            });
          }

          this.setAvExecutionRecordInTransaction(tx, execRef, updated);

          return Object.freeze({
            ok: true as const,
            execution: updated,
          });
        }
      );
    } catch {
      return Object.freeze({
        ok: false as const,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
      });
    }
  }

  /**
   * Worker Phase 1: Atomically claims an execution record into `RUNNING` via CAS
   * after verifying the 9-document chain (`receipt`, `reviewDraft`, `humanReviewCase`,
   * `catalogHandoff`, `qcatDocument`, `alignmentOverlay`, `binarySafetyCase`,
   * `isolatedInspectionRequest`, `avExecution`).
   */
  public async claimAvExecutionForWorkerTransactional(params: {
    readonly requestId: string;
    readonly workerRunId: string;
    readonly nowIso: string;
  }): Promise<WorkerClaimAvExecutionResult> {
    const parsedId = parseLibraryQuarantineIsolatedInspectionRequestId(
      params.requestId
    );
    if (!parsedId) {
      return Object.freeze({
        status: 'HOLD' as const,
        errorCode: 'REQUEST_ID_MISMATCH_HOLD' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.REQUEST_ID_MISMATCH_HOLD,
      });
    }
    if (!isValidWorkerRunId(params.workerRunId)) {
      return Object.freeze({
        status: 'HOLD' as const,
        errorCode: 'INVALID_SERVICE_INPUT_HOLD' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.INVALID_SERVICE_INPUT_HOLD,
      });
    }
    if (!isValidIsoUtcTimestamp(params.nowIso)) {
      return Object.freeze({
        status: 'HOLD' as const,
        errorCode: 'INVALID_TIMESTAMP' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.INVALID_TIMESTAMP,
      });
    }

    const { receiptId, requestId } = parsedId;
    const documentId = deriveQuarantineCatalogDocumentId(receiptId);

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
          const requestRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
            requestId
          );
          const execRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
            requestId
          );

          // All 9 point reads before any write
          const receiptSnap = await tx.get(receiptRef);
          const draftSnap = await tx.get(draftRef);
          const caseSnap = await tx.get(caseRef);
          const handoffSnap = await tx.get(handoffRef);
          const docSnap = await tx.get(docRef);
          const alignmentSnap = await tx.get(alignmentRef);
          const safetySnap = await tx.get(safetyRef);
          const requestSnap = await tx.get(requestRef);
          const execSnap = await tx.get(execRef);

          if (!execSnap.exists) {
            return Object.freeze({
              status: 'HOLD' as const,
              errorCode: 'AV_EXECUTION_NOT_FOUND' as const,
              errorMessage: AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_NOT_FOUND,
            });
          }

          const validatedExec = validatePersistedLibraryQuarantineAvExecution(
            execSnap.data(),
            requestId
          );
          if (!validatedExec.ok) {
            return Object.freeze({
              status: 'HOLD' as const,
              errorCode: 'CORRUPTED_EXISTING_AV_EXECUTION' as const,
              errorMessage:
                AV_EXECUTION_SAFE_MESSAGES.CORRUPTED_EXISTING_AV_EXECUTION,
            });
          }

          const currentExec = validatedExec.value;

          if (
            currentExec.state === 'AV_NO_THREAT_DETECTED' ||
            currentExec.state === 'AV_THREAT_DETECTED' ||
            currentExec.state === 'AV_SCAN_FAILED' ||
            currentExec.state === 'DISPATCH_FAILED' ||
            currentExec.state === 'STALE_HOLD'
          ) {
            return Object.freeze({
              status: 'ALREADY_TERMINAL' as const,
              execution: currentExec,
            });
          }

          if (currentExec.state === 'RUNNING') {
            return Object.freeze({
              status: 'ALREADY_RUNNING' as const,
              execution: currentExec,
            });
          }

          // Verify 7-doc binary safety chain & isolated inspection request
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

          const markStaleHold = (): WorkerClaimAvExecutionSkippedResult => {
            const staleRecord: LibraryQuarantinePersistedAvExecution =
              Object.freeze({
                ...currentExec,
                revision: currentExec.revision + 1,
                state: 'STALE_HOLD' as const,
                completedAt:
                  Date.parse(params.nowIso) >=
                  Date.parse(currentExec.dispatchedAt)
                    ? params.nowIso
                    : currentExec.dispatchedAt,
                failureReasonCode: 'SOURCE_CHAIN_DRIFT_DURING_SCAN' as const,
                isSanitized: false as const,
                isVerifiedSafe: false as const,
                isRightsApproved: false as const,
                isPublished: false as const,
                isReadyForPeia: false as const,
              });
            this.setAvExecutionRecordInTransaction(tx, execRef, staleRecord);
            return Object.freeze({
              status: 'STALE_HOLD' as const,
              execution: staleRecord,
            });
          };

          if (!chainResult.ok) {
            return markStaleHold();
          }

          const eligibilityResult =
            verifyQuarantineIsolatedInspectionChainEligibility(
              chainResult.snapshot
            );
          if (
            !eligibilityResult.ok ||
            eligibilityResult.eligibleChain.requestId !== requestId
          ) {
            return markStaleHold();
          }

          const { eligibleChain } = eligibilityResult;
          const receipt = eligibleChain.chainSnapshot.receiptEnvelope.receipt;
          const expectedProvenance = {
            requestId,
            receiptId,
            documentId: eligibleChain.chainSnapshot.documentId,
            sourceRevision: eligibleChain.chainSnapshot.receiptEnvelope.revision,
            sourceUpdatedAt: receipt.updatedAt,
            sourceSha256: receipt.sha256,
            sourceGeneration: eligibleChain.sourceGeneration,
            sourceByteSize: receipt.byteSize,
            sourceFormat: eligibleChain.chainSnapshot.sourceFormat,
            deepInspectionStatus:
              eligibleChain.chainSnapshot.deepInspectionStatus,
            safetyCaseRevision: eligibleChain.safetyCaseRevision,
            effectiveHumanCaseRevision:
              eligibleChain.chainSnapshot.effectiveHumanCaseRevision,
            catalogUpdatedAt: eligibleChain.chainSnapshot.catalogUpdatedAt,
          };

          if (
            !requestSnap.exists ||
            arePersistedAvExecutionProvenanceIncompatible(
              currentExec,
              expectedProvenance
            )
          ) {
            return markStaleHold();
          }

          const validatedReq =
            validatePersistedLibraryQuarantineIsolatedInspectionRequest(
              requestSnap.data(),
              requestId
            );
          if (
            !validatedReq.ok ||
            arePersistedIsolatedInspectionRequestsIncompatible(
              validatedReq.value,
              expectedProvenance
            )
          ) {
            return markStaleHold();
          }

          const claimedAt =
            Date.parse(params.nowIso) >= Date.parse(currentExec.dispatchedAt)
              ? params.nowIso
              : currentExec.dispatchedAt;

          const claimedExec: LibraryQuarantinePersistedAvExecution =
            Object.freeze({
              ...currentExec,
              revision: currentExec.revision + 1,
              state: 'RUNNING' as const,
              workerRunId: params.workerRunId,
              workerClaimedAt: claimedAt,
              completedAt: null,
              failureReasonCode: null,
              isSanitized: false as const,
              isVerifiedSafe: false as const,
              isRightsApproved: false as const,
              isPublished: false as const,
              isReadyForPeia: false as const,
            });

          const checkClaimed = validatePersistedLibraryQuarantineAvExecution(
            claimedExec,
            requestId
          );
          if (!checkClaimed.ok) {
            return Object.freeze({
              status: 'HOLD' as const,
              errorCode: 'CORRUPTED_EXISTING_AV_EXECUTION' as const,
              errorMessage:
                AV_EXECUTION_SAFE_MESSAGES.CORRUPTED_EXISTING_AV_EXECUTION,
            });
          }

          this.setAvExecutionRecordInTransaction(tx, execRef, claimedExec);

          return Object.freeze({
            status: 'CLAIMED' as const,
            execution: claimedExec,
            inspectionRequest: validatedReq.value,
            eligibleChain,
          });
        }
      );
    } catch {
      return Object.freeze({
        status: 'HOLD' as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }
  }

  /**
   * Worker Phase 2: Re-verifies the 9-document chain and receipt generation/SHA-256
   * before committing the terminal scan outcome (`AV_NO_THREAT_DETECTED`,
   * `AV_THREAT_DETECTED`, `AV_SCAN_FAILED`, or `STALE_HOLD`) via CAS on `expectedRevision`.
   */
  public async recordWorkerAvScanOutcomeTransactional(
    params: WorkerRecordAvScanOutcomeInput
  ): Promise<WorkerRecordAvScanOutcomeResult> {
    const parsedId = parseLibraryQuarantineIsolatedInspectionRequestId(
      params.requestId
    );
    if (!parsedId) {
      return Object.freeze({
        status: 'HOLD' as const,
        errorCode: 'REQUEST_ID_MISMATCH_HOLD' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.REQUEST_ID_MISMATCH_HOLD,
      });
    }
    if (!isValidIsoUtcTimestamp(params.nowIso)) {
      return Object.freeze({
        status: 'HOLD' as const,
        errorCode: 'INVALID_TIMESTAMP' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.INVALID_TIMESTAMP,
      });
    }

    const { receiptId, requestId } = parsedId;
    const documentId = deriveQuarantineCatalogDocumentId(receiptId);

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
          const requestRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION,
            requestId
          );
          const execRef = this.getPointDocRef(
            LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
            requestId
          );

          const receiptSnap = await tx.get(receiptRef);
          const draftSnap = await tx.get(draftRef);
          const caseSnap = await tx.get(caseRef);
          const handoffSnap = await tx.get(handoffRef);
          const docSnap = await tx.get(docRef);
          const alignmentSnap = await tx.get(alignmentRef);
          const safetySnap = await tx.get(safetyRef);
          const requestSnap = await tx.get(requestRef);
          const execSnap = await tx.get(execRef);

          if (!execSnap.exists) {
            return Object.freeze({
              status: 'HOLD' as const,
              errorCode: 'AV_EXECUTION_NOT_FOUND' as const,
              errorMessage: AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_NOT_FOUND,
            });
          }

          const validatedExec = validatePersistedLibraryQuarantineAvExecution(
            execSnap.data(),
            requestId
          );
          if (!validatedExec.ok) {
            return Object.freeze({
              status: 'HOLD' as const,
              errorCode: 'CORRUPTED_EXISTING_AV_EXECUTION' as const,
              errorMessage:
                AV_EXECUTION_SAFE_MESSAGES.CORRUPTED_EXISTING_AV_EXECUTION,
            });
          }

          const currentExec = validatedExec.value;
          if (
            currentExec.state !== 'RUNNING' ||
            currentExec.revision !== params.expectedRevision ||
            currentExec.workerRunId !== params.workerRunId
          ) {
            return Object.freeze({
              status: 'HOLD' as const,
              errorCode: 'AV_EXECUTION_REVISION_CONFLICT' as const,
              errorMessage:
                AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_REVISION_CONFLICT,
            });
          }

          const completedAt =
            Date.parse(params.nowIso) >= Date.parse(currentExec.dispatchedAt)
              ? params.nowIso
              : currentExec.dispatchedAt;

          // Re-verify 7-doc chain & immutable request before committing scan outcome
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

          let effectiveTargetState = params.targetState;
          let effectiveFailureReason = params.failureReasonCode;

          if (!chainResult.ok) {
            effectiveTargetState = 'STALE_HOLD';
            effectiveFailureReason = 'SOURCE_CHAIN_DRIFT_DURING_SCAN';
          } else {
            const eligibilityResult =
              verifyQuarantineIsolatedInspectionChainEligibility(
                chainResult.snapshot
              );
            if (
              !eligibilityResult.ok ||
              eligibilityResult.eligibleChain.requestId !== requestId ||
              !requestSnap.exists
            ) {
              effectiveTargetState = 'STALE_HOLD';
              effectiveFailureReason = 'SOURCE_CHAIN_DRIFT_DURING_SCAN';
            } else {
              const { eligibleChain } = eligibilityResult;
              const receipt =
                eligibleChain.chainSnapshot.receiptEnvelope.receipt;
              const expectedProvenance = {
                requestId,
                receiptId,
                documentId: eligibleChain.chainSnapshot.documentId,
                sourceRevision:
                  eligibleChain.chainSnapshot.receiptEnvelope.revision,
                sourceUpdatedAt: receipt.updatedAt,
                sourceSha256: receipt.sha256,
                sourceGeneration: eligibleChain.sourceGeneration,
                sourceByteSize: receipt.byteSize,
                sourceFormat: eligibleChain.chainSnapshot.sourceFormat,
                deepInspectionStatus:
                  eligibleChain.chainSnapshot.deepInspectionStatus,
                safetyCaseRevision: eligibleChain.safetyCaseRevision,
                effectiveHumanCaseRevision:
                  eligibleChain.chainSnapshot.effectiveHumanCaseRevision,
                catalogUpdatedAt: eligibleChain.chainSnapshot.catalogUpdatedAt,
              };

              const validatedReq =
                validatePersistedLibraryQuarantineIsolatedInspectionRequest(
                  requestSnap.data(),
                  requestId
                );
              if (
                !validatedReq.ok ||
                arePersistedIsolatedInspectionRequestsIncompatible(
                  validatedReq.value,
                  expectedProvenance
                ) ||
                arePersistedAvExecutionProvenanceIncompatible(
                  currentExec,
                  expectedProvenance
                )
              ) {
                effectiveTargetState = 'STALE_HOLD';
                effectiveFailureReason = 'SOURCE_CHAIN_DRIFT_DURING_SCAN';
              } else if (
                receipt.generation !== eligibleChain.sourceGeneration ||
                (params.observedGcsGeneration !== undefined &&
                  params.observedGcsGeneration !==
                    eligibleChain.sourceGeneration) ||
                (params.observedSha256 !== undefined &&
                  params.observedSha256 !== receipt.sha256) ||
                (params.observedByteSize !== undefined &&
                  params.observedByteSize !== receipt.byteSize)
              ) {
                effectiveTargetState = 'STALE_HOLD';
                effectiveFailureReason = 'RECEIPT_GENERATION_DRIFT_DURING_SCAN';
              }
            }
          }

          const isCleanOrThreat =
            effectiveTargetState === 'AV_NO_THREAT_DETECTED' ||
            effectiveTargetState === 'AV_THREAT_DETECTED';

          const finalExec: LibraryQuarantinePersistedAvExecution =
            Object.freeze({
              ...currentExec,
              revision: currentExec.revision + 1,
              state: effectiveTargetState,
              completedAt,
              engineName: isCleanOrThreat ? 'ClamAV' : params.engineName,
              engineVersion: params.engineVersion,
              signatureVersion: params.signatureVersion,
              signatureUpdatedAt: params.signatureUpdatedAt,
              scannedBytes: isCleanOrThreat
                ? currentExec.sourceByteSize
                : params.scannedBytes,
              exitCode: isCleanOrThreat
                ? effectiveTargetState === 'AV_NO_THREAT_DETECTED'
                  ? 0
                  : 1
                : params.exitCode,
              failureReasonCode: isCleanOrThreat
                ? null
                : effectiveFailureReason &&
                  isValidAvExecutionFailureReasonCode(effectiveFailureReason)
                ? effectiveFailureReason
                : 'SCAN_EXECUTION_ERROR',
              isSanitized: false as const,
              isVerifiedSafe: false as const,
              isRightsApproved: false as const,
              isPublished: false as const,
              isReadyForPeia: false as const,
            });

          const checkFinal = validatePersistedLibraryQuarantineAvExecution(
            finalExec,
            requestId
          );
          if (!checkFinal.ok) {
            return Object.freeze({
              status: 'HOLD' as const,
              errorCode: 'CORRUPTED_EXISTING_AV_EXECUTION' as const,
              errorMessage:
                AV_EXECUTION_SAFE_MESSAGES.CORRUPTED_EXISTING_AV_EXECUTION,
            });
          }

          this.setAvExecutionRecordInTransaction(tx, execRef, finalExec);

          return Object.freeze({
            status: 'RECORDED' as const,
            execution: finalExec,
          });
        }
      );
    } catch {
      return Object.freeze({
        status: 'HOLD' as const,
        errorCode: 'STORE_READ_FAILED' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.STORE_READ_FAILED,
      });
    }
  }
}

export interface LibraryQuarantineAvExecutionServiceOptions {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly avExecutionStore?: FirestoreLibraryQuarantineAvExecutionStore;
  readonly db?: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly avJobInvoker?: LibraryQuarantineAvJobInvoker;
  readonly clock?: () => string;
}

function makeGetStatusHoldDto(
  errorCode: LibraryQuarantineAvExecutionErrorCode,
  receiptId: string | null
): GetLibraryQuarantineAvInspectionStatusHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    errorCode,
    errorMessage: AV_EXECUTION_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentIdFromReceipt(safeReceiptId)
      : null,
    readiness: QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeDispatchHoldDto(
  errorCode: LibraryQuarantineAvExecutionErrorCode,
  receiptId: string | null,
  execution: SanitizedLibraryQuarantineAvExecutionDto | null = null
): DispatchLibraryQuarantineAvInspectionHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    dispatchOutcome: 'NOT_DISPATCHED' as const,
    errorCode,
    errorMessage: AV_EXECUTION_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentIdFromReceipt(safeReceiptId)
      : null,
    execution,
    readiness: QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeDispatchUnknownDto(
  receiptId: string,
  errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' | 'JOB_LAUNCH_UNCERTAIN',
  requestId: string | null = null,
  execution: SanitizedLibraryQuarantineAvExecutionDto | null = null
): DispatchLibraryQuarantineAvInspectionUnknownDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    outcome: 'UNKNOWN' as const,
    dispatchOutcome: 'UNKNOWN' as const,
    errorCode,
    errorMessage: AV_EXECUTION_SAFE_MESSAGES[errorCode],
    receiptId,
    documentId: deriveQuarantineCatalogDocumentIdFromReceipt(receiptId),
    requestId,
    execution,
    readiness: QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

export class LibraryQuarantineAvExecutionService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly avExecutionStore: FirestoreLibraryQuarantineAvExecutionStore;
  private readonly avJobInvoker: LibraryQuarantineAvJobInvoker;
  private readonly clock: () => string;

  constructor(options: LibraryQuarantineAvExecutionServiceOptions) {
    if (
      !options ||
      typeof options !== 'object' ||
      !options.trustedPrincipalProvider ||
      typeof options.trustedPrincipalProvider.resolveAuthenticatedPrincipal !==
        'function' ||
      !options.adminRepository ||
      typeof options.adminRepository.getAdminByUid !== 'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineAvExecutionService requires valid trustedPrincipalProvider and adminRepository.'
      );
    }

    const resolvedStore =
      options.avExecutionStore ??
      (options.db
        ? new FirestoreLibraryQuarantineAvExecutionStore(options.db)
        : null);
    if (!resolvedStore) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineAvExecutionService requires either avExecutionStore or Firestore db.'
      );
    }

    if (options.clock !== undefined && typeof options.clock !== 'function') {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: Optional clock must be a function returning an ISO-8601 UTC timestamp.'
      );
    }

    const underlyingPrincipalProvider = options.trustedPrincipalProvider;
    this.trustedPrincipalProvider = Object.freeze({
      resolveAuthenticatedPrincipal: () =>
        underlyingPrincipalProvider.resolveAuthenticatedPrincipal(),
    });

    const underlyingAdminRepo = options.adminRepository;
    this.adminRepository = Object.freeze({
      getAdminByUid: (uid: string) => underlyingAdminRepo.getAdminByUid(uid),
    });

    this.avExecutionStore = resolvedStore;
    this.avJobInvoker =
      options.avJobInvoker ?? new GoogleCloudRunQuarantineAvJobInvoker();
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private async resolveAndAuthorizeAvExecutionOwner(): Promise<
    | { readonly ok: true; readonly actorUid: string }
    | {
        readonly ok: false;
        readonly errorCode:
          | 'UNAUTHENTICATED_CALLER_HOLD'
          | 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD';
      }
  > {
    let rawPrincipal: TrustedQuarantineAuthenticatedPrincipal | null;
    try {
      rawPrincipal =
        await this.trustedPrincipalProvider.resolveAuthenticatedPrincipal();
    } catch {
      return { ok: false, errorCode: 'UNAUTHENTICATED_CALLER_HOLD' };
    }

    if (!isPlainRecord(rawPrincipal)) {
      return { ok: false, errorCode: 'UNAUTHENTICATED_CALLER_HOLD' };
    }

    if (hasUnexpectedPropertyOrSymbol(rawPrincipal, ALLOWED_PRINCIPAL_KEYS)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
      };
    }

    const uid = rawPrincipal.uid;
    if (
      typeof uid !== 'string' ||
      uid.trim() !== uid ||
      !isValidUploaderUid(uid)
    ) {
      return { ok: false, errorCode: 'UNAUTHENTICATED_CALLER_HOLD' };
    }

    if (rawPrincipal.token !== undefined) {
      if (
        !isPlainRecord(rawPrincipal.token) ||
        Object.getOwnPropertySymbols(rawPrincipal.token).length > 0
      ) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
        };
      }

      for (const key of Object.getOwnPropertyNames(rawPrincipal.token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(key)) {
          return {
            ok: false,
            errorCode: 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
          };
        }
      }

      if (hasAutomatedOrAiTokenClaim(rawPrincipal.token)) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
        };
      }
    }

    let adminUser: AdminUser | null;
    try {
      adminUser = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
      };
    }

    if (!adminUser || typeof adminUser !== 'object') {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
      };
    }

    const adminId =
      typeof adminUser.id === 'string' ? adminUser.id.trim() : '';
    const rawOptionalUid = (adminUser as { readonly uid?: unknown }).uid;
    const adminUid =
      typeof rawOptionalUid === 'string' ? rawOptionalUid.trim() : '';

    if (!adminId || adminId !== uid || (adminUid !== '' && adminUid !== uid)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
      };
    }

    if (!isAuthorizedHumanBinarySafetyOwner(adminUser)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_AV_EXECUTION_OWNER_HOLD',
      };
    }

    return { ok: true, actorUid: uid };
  }

  /**
   * Reads the current AV inspection execution status for the active
   * `receiptId + sourceRevision + safetyCaseRevision` tuple (9 point reads, 0 writes).
   */
  public async getQuarantineAvInspectionStatus(
    rawInput: unknown
  ): Promise<GetLibraryQuarantineAvInspectionStatusResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makeGetStatusHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_GET_STATUS_INPUT_KEYS)) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeGetStatusHoldDto('UNTRUSTED_CALLER_FIELD_HOLD', candidateId);
    }

    if (!Object.prototype.hasOwnProperty.call(rawInput, 'receiptId')) {
      return makeGetStatusHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    const receiptId = rawInput.receiptId;
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeGetStatusHoldDto('INVALID_RECEIPT_ID', null);
    }

    const authResult = await this.resolveAndAuthorizeAvExecutionOwner();
    if (!authResult.ok) {
      return makeGetStatusHoldDto(authResult.errorCode, receiptId);
    }

    const snapshotRes =
      await this.avExecutionStore.getAvInspectionStatusSnapshot(receiptId);
    if (!snapshotRes.ok) {
      return makeGetStatusHoldDto(snapshotRes.errorCode, receiptId);
    }

    const { eligibleChain, inspectionRequest, execution } = snapshotRes;
    const { chainSnapshot } = eligibleChain;

    let sanitizedRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null =
      null;
    if (inspectionRequest !== null) {
      try {
        sanitizedRequest =
          toSanitizedLibraryQuarantineIsolatedInspectionRequestDto(
            inspectionRequest
          );
      } catch {
        return makeGetStatusHoldDto(
          'CORRUPTED_EXISTING_INSPECTION_REQUEST',
          receiptId
        );
      }
    }

    let sanitizedExecution: SanitizedLibraryQuarantineAvExecutionDto | null =
      null;
    if (execution !== null) {
      try {
        sanitizedExecution = toSanitizedLibraryQuarantineAvExecutionDto(
          execution
        );
      } catch {
        return makeGetStatusHoldDto(
          'CORRUPTED_EXISTING_AV_EXECUTION',
          receiptId
        );
      }
    }

    const overallStatus: QuarantineAvInspectionOverallStatus =
      sanitizedExecution ? sanitizedExecution.state : 'NOT_DISPATCHED';

    return Object.freeze({
      ok: true as const,
      status: overallStatus,
      outcome: overallStatus,
      receiptId,
      documentId: chainSnapshot.documentId,
      requestId: eligibleChain.requestId,
      sourceRevision: chainSnapshot.receiptEnvelope.revision,
      sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
      sourceFormat: chainSnapshot.sourceFormat,
      deepInspectionStatus: chainSnapshot.deepInspectionStatus,
      safetyCaseRevision: eligibleChain.safetyCaseRevision,
      effectiveHumanCaseRevision: chainSnapshot.effectiveHumanCaseRevision,
      catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
      inspectionRequestRecorded: sanitizedRequest !== null,
      inspectionRequest: sanitizedRequest,
      execution: sanitizedExecution,
      readiness: QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  /**
   * Dispatches a single isolated ClamAV Cloud Run Job execution for an existing
   * `RECORDED_NOT_DISPATCHED` isolated inspection request without mutating
   * `library_quarantine_isolated_inspection_requests/<requestId>`.
   */
  public async dispatchQuarantineAvInspection(
    rawInput: unknown
  ): Promise<DispatchLibraryQuarantineAvInspectionResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makeDispatchHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_DISPATCH_INPUT_KEYS)) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeDispatchHoldDto('UNTRUSTED_CALLER_FIELD_HOLD', candidateId);
    }

    if (
      !Object.prototype.hasOwnProperty.call(rawInput, 'receiptId') ||
      !Object.prototype.hasOwnProperty.call(rawInput, 'expectedRequestId') ||
      !Object.prototype.hasOwnProperty.call(
        rawInput,
        'expectedSafetyCaseRevision'
      ) ||
      !Object.prototype.hasOwnProperty.call(
        rawInput,
        'acknowledgedHumanCaseRevision'
      ) ||
      !Object.prototype.hasOwnProperty.call(rawInput, 'confirmation')
    ) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeDispatchHoldDto('INVALID_SERVICE_INPUT_HOLD', candidateId);
    }

    const receiptId = rawInput.receiptId;
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeDispatchHoldDto('INVALID_RECEIPT_ID', null);
    }

    const parsedExpectedRequestId =
      parseLibraryQuarantineIsolatedInspectionRequestId(
        rawInput.expectedRequestId
      );
    if (!parsedExpectedRequestId || parsedExpectedRequestId.receiptId !== receiptId) {
      return makeDispatchHoldDto('REQUEST_ID_MISMATCH_HOLD', receiptId);
    }

    const expectedSafetyCaseRevision = rawInput.expectedSafetyCaseRevision;
    if (
      typeof expectedSafetyCaseRevision !== 'number' ||
      !Number.isSafeInteger(expectedSafetyCaseRevision) ||
      expectedSafetyCaseRevision < 1
    ) {
      return makeDispatchHoldDto(
        'INVALID_EXPECTED_SAFETY_CASE_REVISION',
        receiptId
      );
    }

    const acknowledgedHumanCaseRevision =
      rawInput.acknowledgedHumanCaseRevision;
    if (
      typeof acknowledgedHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(acknowledgedHumanCaseRevision) ||
      acknowledgedHumanCaseRevision < 1
    ) {
      return makeDispatchHoldDto(
        'UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD',
        receiptId
      );
    }

    if (!isValidDispatchAvInspectionConfirmation(rawInput.confirmation)) {
      return makeDispatchHoldDto('CONFIRMATION_LITERAL_REQUIRED_HOLD', receiptId);
    }

    const authResult = await this.resolveAndAuthorizeAvExecutionOwner();
    if (!authResult.ok) {
      return makeDispatchHoldDto(authResult.errorCode, receiptId);
    }

    let nowIso: string;
    try {
      nowIso = this.clock();
    } catch {
      return makeDispatchHoldDto('INVALID_TIMESTAMP', receiptId);
    }
    if (!isValidIsoUtcTimestamp(nowIso)) {
      return makeDispatchHoldDto('INVALID_TIMESTAMP', receiptId);
    }

    // Fail closed with 0 writes if Cloud Run Job configuration is missing or invalid
    const jobConfigCheck = this.avJobInvoker.validateConfig();
    if (!jobConfigCheck.ok) {
      return makeDispatchHoldDto(jobConfigCheck.failureReasonCode, receiptId);
    }

    const phase1Result =
      await this.avExecutionStore.createDispatchPendingTransactional({
        receiptId,
        expectedRequestId: parsedExpectedRequestId.requestId,
        expectedSafetyCaseRevision,
        acknowledgedHumanCaseRevision,
        confirmation: LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
        actorUid: authResult.actorUid,
        nowIso,
      });

    if (phase1Result.status === 'CONFLICT') {
      return Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        outcome: 'CONFLICT' as const,
        dispatchOutcome: 'NOT_DISPATCHED' as const,
        errorCode: 'SAFETY_CASE_REVISION_CONFLICT' as const,
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.SAFETY_CASE_REVISION_CONFLICT,
        receiptId,
        documentId: deriveQuarantineCatalogDocumentIdFromReceipt(receiptId),
        currentSafetyCaseRevision: phase1Result.currentSafetyCaseRevision,
        currentEffectiveHumanCaseRevision:
          phase1Result.currentEffectiveHumanCaseRevision,
        readiness: QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (phase1Result.status === 'HOLD') {
      return makeDispatchHoldDto(phase1Result.errorCode, receiptId);
    }

    if (phase1Result.status === 'UNKNOWN') {
      return makeDispatchUnknownDto(
        receiptId,
        'TRANSACTION_COMMIT_UNCERTAIN',
        parsedExpectedRequestId.requestId,
        null
      );
    }

    const { eligibleChain, inspectionRequest } = phase1Result;
    const { chainSnapshot, requestId } = eligibleChain;
    const sanitizedRequest =
      toSanitizedLibraryQuarantineIsolatedInspectionRequestDto(
        inspectionRequest
      );

    // If an execution record already existed for this requestId, return idempotent status with 0 new job invocations
    if (phase1Result.status === 'ALREADY_EXISTS') {
      const sanitizedExisting = toSanitizedLibraryQuarantineAvExecutionDto(
        phase1Result.execution
      );
      if (sanitizedExisting.state === 'DISPATCH_UNKNOWN') {
        return makeDispatchUnknownDto(
          receiptId,
          'JOB_LAUNCH_UNCERTAIN',
          requestId,
          sanitizedExisting
        );
      }
      if (sanitizedExisting.state === 'DISPATCH_FAILED') {
        return makeDispatchHoldDto(
          sanitizedExisting.failureReasonCode ?? 'JOB_LAUNCH_REJECTED',
          receiptId,
          sanitizedExisting
        );
      }

      return Object.freeze({
        ok: true as const,
        status: sanitizedExisting.state,
        outcome: 'ALREADY_DISPATCHED' as const,
        dispatchOutcome: 'ALREADY_DISPATCHED' as const,
        receiptId,
        documentId: chainSnapshot.documentId,
        requestId,
        sourceRevision: chainSnapshot.receiptEnvelope.revision,
        sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
        sourceFormat: chainSnapshot.sourceFormat,
        deepInspectionStatus: chainSnapshot.deepInspectionStatus,
        safetyCaseRevision: eligibleChain.safetyCaseRevision,
        effectiveHumanCaseRevision: chainSnapshot.effectiveHumanCaseRevision,
        catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
        inspectionRequest: sanitizedRequest,
        execution: sanitizedExisting,
        readiness: QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    // Phase 2: Invoke the real isolated Cloud Run Job once (passing only requestId)
    const invokeResult = await this.avJobInvoker.invokeAvJobForRequest(
      requestId
    );

    if (invokeResult.status === 'LAUNCHED') {
      const finalizeRes =
        await this.avExecutionStore.finalizeDispatchAfterInvokeTransactional({
          requestId,
          targetState: 'DISPATCHED_WAITING_WORKER',
          executionName: invokeResult.executionName,
          failureReasonCode: null,
          nowIso,
        });

      if (!finalizeRes.ok) {
        // Job was launched, but post-launch ledger update failed -> return UNKNOWN so UI enforces GET reconciliation
        return makeDispatchUnknownDto(
          receiptId,
          'JOB_LAUNCH_UNCERTAIN',
          requestId,
          toSanitizedLibraryQuarantineAvExecutionDto(phase1Result.execution)
        );
      }

      const sanitizedUpdated = toSanitizedLibraryQuarantineAvExecutionDto(
        finalizeRes.execution
      );

      return Object.freeze({
        ok: true as const,
        status: sanitizedUpdated.state,
        outcome: 'DISPATCHED' as const,
        dispatchOutcome: 'DISPATCHED' as const,
        receiptId,
        documentId: chainSnapshot.documentId,
        requestId,
        sourceRevision: chainSnapshot.receiptEnvelope.revision,
        sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
        sourceFormat: chainSnapshot.sourceFormat,
        deepInspectionStatus: chainSnapshot.deepInspectionStatus,
        safetyCaseRevision: eligibleChain.safetyCaseRevision,
        effectiveHumanCaseRevision: chainSnapshot.effectiveHumanCaseRevision,
        catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
        inspectionRequest: sanitizedRequest,
        execution: sanitizedUpdated,
        readiness: QUARANTINE_AV_EXECUTION_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (
      invokeResult.status === 'PRE_LAUNCH_FAILED' ||
      invokeResult.status === 'API_REJECTED'
    ) {
      const finalizeFailed =
        await this.avExecutionStore.finalizeDispatchAfterInvokeTransactional({
          requestId,
          targetState: 'DISPATCH_FAILED',
          executionName: null,
          failureReasonCode: invokeResult.failureReasonCode,
          nowIso,
        });

      const failedDto = finalizeFailed.ok
        ? toSanitizedLibraryQuarantineAvExecutionDto(finalizeFailed.execution)
        : null;
      return makeDispatchHoldDto(
        invokeResult.failureReasonCode,
        receiptId,
        failedDto
      );
    }

    // invokeResult.status === 'DISPATCH_UNKNOWN'
    const finalizeUnknown =
      await this.avExecutionStore.finalizeDispatchAfterInvokeTransactional({
        requestId,
        targetState: 'DISPATCH_UNKNOWN',
        executionName: null,
        failureReasonCode: 'JOB_LAUNCH_UNCERTAIN',
        nowIso,
      });

    const unknownDto = finalizeUnknown.ok
      ? toSanitizedLibraryQuarantineAvExecutionDto(finalizeUnknown.execution)
      : toSanitizedLibraryQuarantineAvExecutionDto(phase1Result.execution);

    return makeDispatchUnknownDto(
      receiptId,
      'JOB_LAUNCH_UNCERTAIN',
      requestId,
      unknownDto
    );
  }
}
