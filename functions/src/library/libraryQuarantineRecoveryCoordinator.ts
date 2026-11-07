import {
  LIBRARY_QUARANTINE_STORAGE_PREFIX,
  LibraryQuarantineReceiptState,
  confirmLibraryQuarantineWriteWithAttestation,
  deriveLibraryQuarantineStoragePath,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  markLibraryQuarantineWriteNeedsReconciliation,
  parseLibraryQuarantineStoragePath,
  reconcileLibraryQuarantineReceiptWithAttestation,
  type LibraryQuarantineInternalReceipt,
  type SanitizedLibraryQuarantineAdminReceiptDto,
  type TrustedStorageReadbackAttestation,
} from './libraryQuarantineReceiptContract';
import {
  type LibraryQuarantinePersistedReceiptEnvelope,
  type LibraryQuarantineReceiptStore,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  type LibraryQuarantineGcsAdapterResult,
  type VerifyExistingLibraryQuarantineObjectInput,
} from './gcsLibraryQuarantineStorageAdapter';

/**
 * LIB-FILE-02B2B2 — Readback-Only Quarantine Recovery Coordinator
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Server-internal, dependency-injected recovery coordinator for existing
 *   Library quarantine receipts persisted in Firestore (`WritePending`,
 *   `NeedsReconciliation`, and idempotent verification of `Quarantined`).
 * - READBACK-ONLY STORAGE BOUNDARY: Exposes and invokes ONLY
 *   `verifyExistingQuarantineObject(...)` on the GCS quarantine adapter port.
 *   Never uploads, overwrites, deletes, or creates any GCS object, and never
 *   rotates or creates a new `receiptId` or Firestore document.
 * - Strictly validates caller input (`{ receiptId, actorUid }`), rejecting any
 *   caller-supplied receipt, state, storagePath, bytes, sha256, generation,
 *   attestation, or storage verdict.
 * - Requires `actorUid === persistedReceipt.uploaderUid` before any GCS probe
 *   or state transition.
 * - Refuses to probe GCS or mutate Firestore when a receipt is in `Reserved`
 *   or terminal `Rejected` state.
 * - Never automatically transitions a receipt to `Rejected` when an object is
 *   missing or unreadable (preserving recovery safety while a prior writer may
 *   still be in flight or object visibility is uncertain).
 * - Performs at most ONE Firestore CAS (`compareAndSwapReceipt`) per invocation.
 *   If CAS fails or throws after verified GCS readback, performs at most ONE
 *   bounded authoritative Firestore reread for classification only (detecting
 *   already-committed convergence with matching generation vs. concurrent state
 *   conflict vs. `PERSISTENCE_UNCERTAIN`), never issuing a second mutation.
 * - Redacts `storagePath`, `generation`, raw bytes, attestations, bucket names,
 *   URLs, tokens, credentials, and raw exception strings from all outputs.
 */

/**
 * Readback-only GCS port for quarantine recovery.
 * Intentionally omits `writeQuarantineObjectIfAbsent`, `save`, and `delete`.
 */
export interface LibraryQuarantineGcsReadbackPort {
  verifyExistingQuarantineObject(
    input: VerifyExistingLibraryQuarantineObjectInput
  ): Promise<LibraryQuarantineGcsAdapterResult>;
}

export interface RecoverExistingQuarantineReceiptInput {
  readonly receiptId: string;
  readonly actorUid: string;
}

export type LibraryQuarantineRecoveryErrorCode =
  | 'INVALID_COORDINATOR_DEPENDENCY'
  | 'INVALID_RECOVERY_INPUT'
  | 'UNTRUSTED_CALLER_FIELD'
  | 'INVALID_RECEIPT_ID'
  | 'INVALID_ACTOR_UID'
  | 'INVALID_TIMESTAMP'
  | 'RECEIPT_NOT_FOUND'
  | 'RECEIPT_STORE_READ_FAILED'
  | 'ACTOR_OWNERSHIP_MISMATCH'
  | 'RESERVED_STATE_NOT_RECOVERABLE'
  | 'REJECTED_STATE_TERMINAL'
  | 'STORED_OBJECT_NOT_FOUND'
  | 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
  | 'GCS_READBACK_UNCERTAIN'
  | 'ATTESTATION_TRANSITION_REJECTED'
  | 'QUARANTINED_GENERATION_MISMATCH'
  | 'RECOVERY_QUARANTINE_CAS_FAILED'
  | 'RECOVERY_RECONCILIATION_CAS_FAILED'
  | 'CONCURRENT_STATE_CHANGE';

export interface LibraryQuarantineRecoverySuccess {
  readonly ok: true;
  readonly status:
    | 'RECOVERED_TO_QUARANTINED'
    | 'ALREADY_QUARANTINED_VERIFIED';
  readonly receiptId: string;
  readonly previousState:
    | 'WritePending'
    | 'NeedsReconciliation'
    | 'Quarantined';
  readonly state: 'Quarantined';
  readonly revision: number;
  readonly gcsReadbackAttempted: true;
  readonly gcsSaveAttempted: false;
  readonly casPerformed: boolean;
  readonly convergedViaReread: boolean;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineRecoveryPreflightOrStateFailure {
  readonly ok: false;
  readonly status: 'PREFLIGHT_REJECTED' | 'NOT_RECOVERABLE_STATE';
  readonly errorCode:
    | 'INVALID_COORDINATOR_DEPENDENCY'
    | 'INVALID_RECOVERY_INPUT'
    | 'UNTRUSTED_CALLER_FIELD'
    | 'INVALID_RECEIPT_ID'
    | 'INVALID_ACTOR_UID'
    | 'INVALID_TIMESTAMP'
    | 'RECEIPT_NOT_FOUND'
    | 'RECEIPT_STORE_READ_FAILED'
    | 'ACTOR_OWNERSHIP_MISMATCH'
    | 'RESERVED_STATE_NOT_RECOVERABLE'
    | 'REJECTED_STATE_TERMINAL';
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly previousState: LibraryQuarantineReceiptState | null;
  readonly state: LibraryQuarantineReceiptState | null;
  readonly revision: number | null;
  readonly gcsReadbackAttempted: false;
  readonly gcsSaveAttempted: false;
  readonly casPerformed: false;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto | null;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineRecoveryReconciliationOrIntegrityFailure {
  readonly ok: false;
  readonly status:
    | 'TRANSITIONED_TO_NEEDS_RECONCILIATION'
    | 'UNRESOLVED_NEEDS_RECONCILIATION'
    | 'QUARANTINED_INTEGRITY_FAILURE';
  readonly errorCode:
    | 'STORED_OBJECT_NOT_FOUND'
    | 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
    | 'GCS_READBACK_UNCERTAIN'
    | 'ATTESTATION_TRANSITION_REJECTED'
    | 'QUARANTINED_GENERATION_MISMATCH';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly previousState:
    | 'WritePending'
    | 'NeedsReconciliation'
    | 'Quarantined';
  readonly state:
    | 'NeedsReconciliation'
    | 'Quarantined';
  readonly revision: number;
  readonly gcsReadbackAttempted: true;
  readonly gcsSaveAttempted: false;
  readonly casPerformed: boolean;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineRecoveryPersistenceOrConflictFailure {
  readonly ok: false;
  readonly status: 'PERSISTENCE_UNCERTAIN' | 'CONCURRENT_STATE_CONFLICT';
  readonly errorCode:
    | 'RECOVERY_QUARANTINE_CAS_FAILED'
    | 'RECOVERY_RECONCILIATION_CAS_FAILED'
    | 'CONCURRENT_STATE_CHANGE';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly previousState:
    | 'WritePending'
    | 'NeedsReconciliation';
  readonly state: LibraryQuarantineReceiptState;
  readonly revision: number;
  readonly lastKnownRevision: number;
  readonly gcsReadbackAttempted: true;
  readonly gcsSaveAttempted: false;
  readonly casPerformed: true;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type RecoverExistingQuarantineReceiptResult =
  | LibraryQuarantineRecoverySuccess
  | LibraryQuarantineRecoveryPreflightOrStateFailure
  | LibraryQuarantineRecoveryReconciliationOrIntegrityFailure
  | LibraryQuarantineRecoveryPersistenceOrConflictFailure;

const ALLOWED_RECOVERY_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'actorUid',
]);

const CONTROL_OR_BIDI_CHAR_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/g;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function findUnexpectedPropertyOrSymbol(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): string | null {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowedKeys.has(key)) {
      return key;
    }
  }
  const symbols = Object.getOwnPropertySymbols(obj);
  if (symbols.length > 0) {
    return String(symbols[0]);
  }
  return null;
}

function sanitizeRecoveryMessage(
  rawMessage: string,
  internalStoragePath?: string,
  redactedStrings?: readonly (string | null | undefined)[]
): string {
  let cleaned = rawMessage;
  if (internalStoragePath && internalStoragePath.length > 0) {
    cleaned = cleaned.split(internalStoragePath).join('[REDACTED_STORAGE_PATH]');
  }
  if (redactedStrings) {
    for (const secret of redactedStrings) {
      if (typeof secret === 'string' && secret.length > 0) {
        cleaned = cleaned.split(secret).join('[REDACTED]');
      }
    }
  }
  cleaned = cleaned
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
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED_TOKEN]')
    .replace(
      /(?:token|secret|password|key|signature|credential|bucket)\s*[:=]\s*[^\s,;]+/gi,
      '[REDACTED_CREDENTIAL]'
    )
    .replace(CONTROL_OR_BIDI_CHAR_REGEX, ' ')
    .trim();

  if (cleaned.length === 0) {
    return 'Quarantine receipt recovery failed.';
  }
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}...` : cleaned;
}

function makePreflightOrStateFailure(
  status: 'PREFLIGHT_REJECTED' | 'NOT_RECOVERABLE_STATE',
  errorCode: LibraryQuarantineRecoveryPreflightOrStateFailure['errorCode'],
  errorMessage: string,
  receiptId: string | null,
  previousState: LibraryQuarantineReceiptState | null = null,
  revision: number | null = null,
  adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto | null = null,
  internalStoragePath?: string,
  extraRedactions?: readonly (string | null | undefined)[]
): LibraryQuarantineRecoveryPreflightOrStateFailure {
  return Object.freeze({
    ok: false as const,
    status,
    errorCode,
    errorMessage: sanitizeRecoveryMessage(
      errorMessage,
      internalStoragePath,
      extraRedactions
    ),
    receiptId,
    previousState,
    state: previousState,
    revision,
    gcsReadbackAttempted: false as const,
    gcsSaveAttempted: false as const,
    casPerformed: false as const,
    adminReceiptDto: adminReceiptDto
      ? Object.freeze({ ...adminReceiptDto })
      : null,
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeReconciliationOrIntegrityFailure(
  status: LibraryQuarantineRecoveryReconciliationOrIntegrityFailure['status'],
  errorCode: LibraryQuarantineRecoveryReconciliationOrIntegrityFailure['errorCode'],
  errorMessage: string,
  receiptId: string,
  previousState: LibraryQuarantineRecoveryReconciliationOrIntegrityFailure['previousState'],
  state: LibraryQuarantineRecoveryReconciliationOrIntegrityFailure['state'],
  revision: number,
  casPerformed: boolean,
  adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto,
  internalStoragePath?: string,
  extraRedactions?: readonly (string | null | undefined)[]
): LibraryQuarantineRecoveryReconciliationOrIntegrityFailure {
  return Object.freeze({
    ok: false as const,
    status,
    errorCode,
    errorMessage: sanitizeRecoveryMessage(
      errorMessage,
      internalStoragePath,
      extraRedactions
    ),
    receiptId,
    previousState,
    state,
    revision,
    gcsReadbackAttempted: true as const,
    gcsSaveAttempted: false as const,
    casPerformed,
    adminReceiptDto: Object.freeze({ ...adminReceiptDto }),
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makePersistenceOrConflictFailure(
  status: LibraryQuarantineRecoveryPersistenceOrConflictFailure['status'],
  errorCode: LibraryQuarantineRecoveryPersistenceOrConflictFailure['errorCode'],
  errorMessage: string,
  receiptId: string,
  previousState: LibraryQuarantineRecoveryPersistenceOrConflictFailure['previousState'],
  state: LibraryQuarantineReceiptState,
  lastKnownRevision: number,
  adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto,
  internalStoragePath?: string,
  extraRedactions?: readonly (string | null | undefined)[]
): LibraryQuarantineRecoveryPersistenceOrConflictFailure {
  return Object.freeze({
    ok: false as const,
    status,
    errorCode,
    errorMessage: sanitizeRecoveryMessage(
      errorMessage,
      internalStoragePath,
      extraRedactions
    ),
    receiptId,
    previousState,
    state,
    revision: lastKnownRevision,
    lastKnownRevision,
    gcsReadbackAttempted: true as const,
    gcsSaveAttempted: false as const,
    casPerformed: true as const,
    adminReceiptDto: Object.freeze({ ...adminReceiptDto }),
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeRecoverySuccess(
  status: LibraryQuarantineRecoverySuccess['status'],
  receiptId: string,
  previousState: LibraryQuarantineRecoverySuccess['previousState'],
  revision: number,
  casPerformed: boolean,
  convergedViaReread: boolean,
  adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto
): LibraryQuarantineRecoverySuccess {
  return Object.freeze({
    ok: true as const,
    status,
    receiptId,
    previousState,
    state: LibraryQuarantineReceiptState.Quarantined,
    revision,
    gcsReadbackAttempted: true as const,
    gcsSaveAttempted: false as const,
    casPerformed,
    convergedViaReread,
    adminReceiptDto: Object.freeze({ ...adminReceiptDto }),
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function classifyGcsFailureErrorCode(
  gcsOutcome: Exclude<
    LibraryQuarantineGcsAdapterResult,
    { readonly ok: true }
  >
):
  | 'STORED_OBJECT_NOT_FOUND'
  | 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
  | 'GCS_READBACK_UNCERTAIN' {
  if (gcsOutcome.status === 'NEEDS_RECONCILIATION') {
    return 'GCS_READBACK_UNCERTAIN';
  }
  if (gcsOutcome.errorCode === 'STORED_OBJECT_NOT_FOUND') {
    return 'STORED_OBJECT_NOT_FOUND';
  }
  return 'GCS_OBJECT_CONFLICT_OR_MISMATCH';
}

function extractGcsFailureReason(
  gcsOutcome: Exclude<
    LibraryQuarantineGcsAdapterResult,
    { readonly ok: true }
  >
): string {
  if (gcsOutcome.status === 'NEEDS_RECONCILIATION') {
    return gcsOutcome.reconciliationReason;
  }
  return gcsOutcome.errorMessage;
}

function doesReceiptMatchImmutableIdentityAndAttestation(
  candidate: LibraryQuarantineInternalReceipt,
  baseline: LibraryQuarantineInternalReceipt,
  attestation: TrustedStorageReadbackAttestation
): boolean {
  return (
    candidate.receiptId === baseline.receiptId &&
    candidate.uploaderUid === baseline.uploaderUid &&
    candidate.originalFilename === baseline.originalFilename &&
    candidate.sanitizedFilename === baseline.sanitizedFilename &&
    candidate.format === baseline.format &&
    candidate.canonicalExtension === baseline.canonicalExtension &&
    candidate.canonicalMimeType === baseline.canonicalMimeType &&
    candidate.byteSize === baseline.byteSize &&
    candidate.sha256 === baseline.sha256 &&
    candidate.deepInspectionStatus === baseline.deepInspectionStatus &&
    candidate.storagePath === baseline.storagePath &&
    candidate.createdAt === baseline.createdAt &&
    candidate.state === LibraryQuarantineReceiptState.Quarantined &&
    candidate.generation === attestation.attestedGeneration &&
    candidate.reconciliationReason === null &&
    candidate.rejectionReasonCode === null &&
    candidate.isSanitized === false &&
    candidate.isVerifiedSafe === false &&
    candidate.isRightsApproved === false &&
    candidate.isPublished === false &&
    candidate.isReadyForPeia === false
  );
}

/**
 * Dependency-injected, readback-only recovery coordinator for existing Library
 * quarantine receipts.
 */
export class LibraryQuarantineRecoveryCoordinator {
  private readonly receiptStore: LibraryQuarantineReceiptStore;
  private readonly storageReadbackPort: LibraryQuarantineGcsReadbackPort;
  private readonly clock: () => string;

  constructor(options: {
    readonly receiptStore: LibraryQuarantineReceiptStore;
    readonly storageReadbackPort: LibraryQuarantineGcsReadbackPort;
    readonly clock?: () => string;
  }) {
    if (
      !options ||
      !options.receiptStore ||
      typeof options.receiptStore.getReceiptById !== 'function' ||
      typeof options.receiptStore.compareAndSwapReceipt !== 'function'
    ) {
      throw new Error(
        'INVALID_COORDINATOR_DEPENDENCY: LibraryQuarantineRecoveryCoordinator requires a valid receiptStore implementing getReceiptById and compareAndSwapReceipt.'
      );
    }

    if (
      !options.storageReadbackPort ||
      typeof options.storageReadbackPort.verifyExistingQuarantineObject !==
        'function'
    ) {
      throw new Error(
        'INVALID_COORDINATOR_DEPENDENCY: LibraryQuarantineRecoveryCoordinator requires a valid storageReadbackPort implementing verifyExistingQuarantineObject.'
      );
    }

    if (options.clock !== undefined && typeof options.clock !== 'function') {
      throw new Error(
        'INVALID_COORDINATOR_DEPENDENCY: Optional clock must be a function returning an ISO-8601 UTC timestamp.'
      );
    }

    this.receiptStore = options.receiptStore;
    // Bind only verifyExistingQuarantineObject so no write capability can ever be invoked through the port.
    const underlyingPort = options.storageReadbackPort;
    this.storageReadbackPort = Object.freeze({
      verifyExistingQuarantineObject: (
        input: VerifyExistingLibraryQuarantineObjectInput
      ): Promise<LibraryQuarantineGcsAdapterResult> =>
        underlyingPort.verifyExistingQuarantineObject(input),
    });
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  /**
   * Recovers or verifies an existing quarantine receipt by reading the
   * authoritative Firestore record and performing a bounded readback check of
   * the existing GCS object. Never writes, overwrites, or deletes storage objects.
   */
  public async recoverExistingLibraryQuarantineReceipt(
    rawInput: unknown
  ): Promise<RecoverExistingQuarantineReceiptResult> {
    if (!isPlainRecord(rawInput)) {
      return makePreflightOrStateFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_RECOVERY_INPUT',
        'recoverExistingLibraryQuarantineReceipt input must be a plain non-null object.',
        null
      );
    }

    const unexpectedKey = findUnexpectedPropertyOrSymbol(
      rawInput,
      ALLOWED_RECOVERY_INPUT_KEYS
    );
    if (unexpectedKey !== null) {
      return makePreflightOrStateFailure(
        'PREFLIGHT_REJECTED',
        'UNTRUSTED_CALLER_FIELD',
        `Caller-supplied field "${unexpectedKey}" is forbidden in recoverExistingLibraryQuarantineReceipt.`,
        null
      );
    }

    const { receiptId, actorUid } = rawInput;

    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makePreflightOrStateFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_RECEIPT_ID',
        'receiptId must be a valid 32-character lowercase hexadecimal string.',
        null
      );
    }

    if (!isValidUploaderUid(actorUid)) {
      return makePreflightOrStateFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_ACTOR_UID',
        'actorUid must be a valid non-empty server-authenticated user identifier.',
        receiptId
      );
    }

    // Step 1: Load authoritative receipt envelope from Firestore
    let storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
    let storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto;

    try {
      const readRes = await this.receiptStore.getReceiptById(receiptId);
      if (!readRes.ok) {
        if (readRes.errorCode === 'RECEIPT_NOT_FOUND') {
          return makePreflightOrStateFailure(
            'PREFLIGHT_REJECTED',
            'RECEIPT_NOT_FOUND',
            `Quarantine receipt "${receiptId}" was not found in Firestore.`,
            receiptId
          );
        }
        return makePreflightOrStateFailure(
          'PREFLIGHT_REJECTED',
          'RECEIPT_STORE_READ_FAILED',
          readRes.errorMessage,
          receiptId
        );
      }
      storedEnvelope = readRes.envelope;
      storedAdminDto = readRes.adminReceiptDto;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unknown error reading quarantine receipt from Firestore.';
      return makePreflightOrStateFailure(
        'PREFLIGHT_REJECTED',
        'RECEIPT_STORE_READ_FAILED',
        msg,
        receiptId
      );
    }

    const persistedReceipt = storedEnvelope.receipt;

    // Verify canonical storagePath integrity on the persisted receipt before any action
    const derivedPath = deriveLibraryQuarantineStoragePath(
      persistedReceipt.receiptId,
      persistedReceipt.format
    );
    const parsedPath = parseLibraryQuarantineStoragePath(
      persistedReceipt.storagePath
    );
    if (
      !derivedPath.ok ||
      !parsedPath.ok ||
      derivedPath.parsed.storagePath !== persistedReceipt.storagePath ||
      parsedPath.parsed.storagePath !== persistedReceipt.storagePath
    ) {
      return makePreflightOrStateFailure(
        'PREFLIGHT_REJECTED',
        'RECEIPT_STORE_READ_FAILED',
        'Persisted quarantine receipt storagePath failed canonical path verification.',
        receiptId,
        null,
        null,
        null,
        persistedReceipt.storagePath,
        [persistedReceipt.generation]
      );
    }

    // Step 2: Enforce ownership before any state branch or GCS probe
    if (actorUid !== persistedReceipt.uploaderUid) {
      return makePreflightOrStateFailure(
        'PREFLIGHT_REJECTED',
        'ACTOR_OWNERSHIP_MISMATCH',
        'actorUid does not match the authoritative receipt uploaderUid.',
        receiptId,
        persistedReceipt.state,
        storedEnvelope.revision,
        storedAdminDto,
        persistedReceipt.storagePath,
        [persistedReceipt.generation]
      );
    }

    // Step 3: Handle non-recoverable states (Reserved, Rejected) without touching GCS
    if (persistedReceipt.state === LibraryQuarantineReceiptState.Reserved) {
      return makePreflightOrStateFailure(
        'NOT_RECOVERABLE_STATE',
        'RESERVED_STATE_NOT_RECOVERABLE',
        `Receipt "${receiptId}" is in "Reserved" state; recovery cannot initiate an upload or probe storage before WritePending.`,
        receiptId,
        LibraryQuarantineReceiptState.Reserved,
        storedEnvelope.revision,
        storedAdminDto,
        persistedReceipt.storagePath
      );
    }

    if (persistedReceipt.state === LibraryQuarantineReceiptState.Rejected) {
      return makePreflightOrStateFailure(
        'NOT_RECOVERABLE_STATE',
        'REJECTED_STATE_TERMINAL',
        `Receipt "${receiptId}" is in terminal "Rejected" state and cannot be recovered.`,
        receiptId,
        LibraryQuarantineReceiptState.Rejected,
        storedEnvelope.revision,
        storedAdminDto,
        persistedReceipt.storagePath
      );
    }

    // Step 4: Validate monotonic server clock timestamp before probing GCS
    const verifiedAtIso = this.clock();
    if (
      !isValidIsoUtcTimestamp(verifiedAtIso) ||
      Date.parse(verifiedAtIso) < Date.parse(persistedReceipt.updatedAt)
    ) {
      return makePreflightOrStateFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_TIMESTAMP',
        'Server clock produced an invalid or non-monotonic ISO-8601 UTC timestamp for recovery verification.',
        receiptId,
        persistedReceipt.state,
        storedEnvelope.revision,
        storedAdminDto,
        persistedReceipt.storagePath,
        [persistedReceipt.generation]
      );
    }

    // Step 5: Perform bounded readback-only GCS verification
    let gcsOutcome: LibraryQuarantineGcsAdapterResult;
    try {
      gcsOutcome =
        await this.storageReadbackPort.verifyExistingQuarantineObject({
          receipt: persistedReceipt,
          verifiedAtIso,
        });
    } catch (err) {
      const rawErrMsg =
        err instanceof Error
          ? err.message
          : 'Unexpected exception thrown during GCS readback verification.';
      return this.handleFailedOrAmbiguousReadback(
        storedEnvelope,
        storedAdminDto,
        actorUid,
        'GCS_READBACK_UNCERTAIN',
        `GCS readback verification threw an unexpected error: ${rawErrMsg}`,
        verifiedAtIso
      );
    }

    // Step 6: Branch by persisted state
    if (persistedReceipt.state === LibraryQuarantineReceiptState.Quarantined) {
      return this.handleQuarantinedVerification(
        storedEnvelope,
        storedAdminDto,
        gcsOutcome
      );
    }

    if (persistedReceipt.state === LibraryQuarantineReceiptState.WritePending) {
      return this.handleWritePendingRecovery(
        storedEnvelope,
        storedAdminDto,
        actorUid,
        verifiedAtIso,
        gcsOutcome
      );
    }

    // NeedsReconciliation
    return this.handleNeedsReconciliationRecovery(
      storedEnvelope,
      storedAdminDto,
      actorUid,
      gcsOutcome
    );
  }

  private handleQuarantinedVerification(
    storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope,
    storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto,
    gcsOutcome: LibraryQuarantineGcsAdapterResult
  ):
    | LibraryQuarantineRecoverySuccess
    | LibraryQuarantineRecoveryReconciliationOrIntegrityFailure {
    const persistedReceipt = storedEnvelope.receipt;
    const receiptId = persistedReceipt.receiptId;

    if (!gcsOutcome.ok) {
      const errCode = classifyGcsFailureErrorCode(gcsOutcome);
      const rawReason = extractGcsFailureReason(gcsOutcome);
      return makeReconciliationOrIntegrityFailure(
        'QUARANTINED_INTEGRITY_FAILURE',
        errCode,
        `Quarantined receipt verification failed: ${rawReason}`,
        receiptId,
        LibraryQuarantineReceiptState.Quarantined,
        LibraryQuarantineReceiptState.Quarantined,
        storedEnvelope.revision,
        false,
        storedAdminDto,
        persistedReceipt.storagePath,
        [persistedReceipt.generation]
      );
    }

    const att = gcsOutcome.attestation;

    if (
      persistedReceipt.generation === null ||
      att.attestedGeneration !== persistedReceipt.generation
    ) {
      return makeReconciliationOrIntegrityFailure(
        'QUARANTINED_INTEGRITY_FAILURE',
        'QUARANTINED_GENERATION_MISMATCH',
        'Stored GCS object generation does not match the authoritative Quarantined receipt generation.',
        receiptId,
        LibraryQuarantineReceiptState.Quarantined,
        LibraryQuarantineReceiptState.Quarantined,
        storedEnvelope.revision,
        false,
        storedAdminDto,
        persistedReceipt.storagePath,
        [persistedReceipt.generation, att.attestedGeneration]
      );
    }

    if (
      !doesReceiptMatchImmutableIdentityAndAttestation(
        persistedReceipt,
        persistedReceipt,
        att
      )
    ) {
      return makeReconciliationOrIntegrityFailure(
        'QUARANTINED_INTEGRITY_FAILURE',
        'GCS_OBJECT_CONFLICT_OR_MISMATCH',
        'Stored GCS object attestation does not match the authoritative Quarantined receipt identity.',
        receiptId,
        LibraryQuarantineReceiptState.Quarantined,
        LibraryQuarantineReceiptState.Quarantined,
        storedEnvelope.revision,
        false,
        storedAdminDto,
        persistedReceipt.storagePath,
        [persistedReceipt.generation, att.attestedGeneration]
      );
    }

    return makeRecoverySuccess(
      'ALREADY_QUARANTINED_VERIFIED',
      receiptId,
      LibraryQuarantineReceiptState.Quarantined,
      storedEnvelope.revision,
      false,
      false,
      storedAdminDto
    );
  }

  private async handleWritePendingRecovery(
    storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope,
    storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto,
    actorUid: string,
    verifiedAtIso: string,
    gcsOutcome: LibraryQuarantineGcsAdapterResult
  ): Promise<RecoverExistingQuarantineReceiptResult> {
    const persistedReceipt = storedEnvelope.receipt;

    if (gcsOutcome.ok) {
      const confirmTransition = confirmLibraryQuarantineWriteWithAttestation({
        receipt: persistedReceipt,
        actorUid,
        attestation: gcsOutcome.attestation,
      });

      if (!confirmTransition.ok) {
        return this.persistWritePendingToNeedsReconciliationBounded(
          storedEnvelope,
          storedAdminDto,
          actorUid,
          'ATTESTATION_TRANSITION_REJECTED',
          `GCS readback attestation was rejected by receipt contract: ${confirmTransition.errorMessage}`,
          verifiedAtIso,
          [gcsOutcome.attestation.attestedGeneration]
        );
      }

      return this.commitQuarantinedTransitionWithBoundedReread(
        storedEnvelope,
        storedAdminDto,
        LibraryQuarantineReceiptState.WritePending,
        confirmTransition.receipt,
        gcsOutcome.attestation
      );
    }

    const errCode = classifyGcsFailureErrorCode(gcsOutcome);
    const reasonText = extractGcsFailureReason(gcsOutcome);

    return this.persistWritePendingToNeedsReconciliationBounded(
      storedEnvelope,
      storedAdminDto,
      actorUid,
      errCode,
      reasonText,
      verifiedAtIso
    );
  }

  private async handleNeedsReconciliationRecovery(
    storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope,
    storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto,
    actorUid: string,
    gcsOutcome: LibraryQuarantineGcsAdapterResult
  ): Promise<RecoverExistingQuarantineReceiptResult> {
    const persistedReceipt = storedEnvelope.receipt;
    const receiptId = persistedReceipt.receiptId;

    if (gcsOutcome.ok) {
      const reconcileTransition =
        reconcileLibraryQuarantineReceiptWithAttestation({
          receipt: persistedReceipt,
          actorUid,
          attestation: gcsOutcome.attestation,
        });

      if (!reconcileTransition.ok) {
        return makeReconciliationOrIntegrityFailure(
          'UNRESOLVED_NEEDS_RECONCILIATION',
          'ATTESTATION_TRANSITION_REJECTED',
          `GCS readback attestation was rejected during reconciliation: ${reconcileTransition.errorMessage}`,
          receiptId,
          LibraryQuarantineReceiptState.NeedsReconciliation,
          LibraryQuarantineReceiptState.NeedsReconciliation,
          storedEnvelope.revision,
          false,
          storedAdminDto,
          persistedReceipt.storagePath,
          [gcsOutcome.attestation.attestedGeneration]
        );
      }

      return this.commitQuarantinedTransitionWithBoundedReread(
        storedEnvelope,
        storedAdminDto,
        LibraryQuarantineReceiptState.NeedsReconciliation,
        reconcileTransition.receipt,
        gcsOutcome.attestation
      );
    }

    const errCode = classifyGcsFailureErrorCode(gcsOutcome);
    const reasonText = extractGcsFailureReason(gcsOutcome);

    // Preserve NeedsReconciliation without any new CAS mutation or automatic Rejected transition
    return makeReconciliationOrIntegrityFailure(
      'UNRESOLVED_NEEDS_RECONCILIATION',
      errCode,
      reasonText,
      receiptId,
      LibraryQuarantineReceiptState.NeedsReconciliation,
      LibraryQuarantineReceiptState.NeedsReconciliation,
      storedEnvelope.revision,
      false,
      storedAdminDto,
      persistedReceipt.storagePath
    );
  }

  private async handleFailedOrAmbiguousReadback(
    storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope,
    storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto,
    actorUid: string,
    errorCode:
      | 'STORED_OBJECT_NOT_FOUND'
      | 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
      | 'GCS_READBACK_UNCERTAIN',
    rawReason: string,
    fallbackTimestampIso: string
  ): Promise<RecoverExistingQuarantineReceiptResult> {
    const persistedReceipt = storedEnvelope.receipt;
    const receiptId = persistedReceipt.receiptId;

    if (persistedReceipt.state === LibraryQuarantineReceiptState.Quarantined) {
      return makeReconciliationOrIntegrityFailure(
        'QUARANTINED_INTEGRITY_FAILURE',
        errorCode,
        rawReason,
        receiptId,
        LibraryQuarantineReceiptState.Quarantined,
        LibraryQuarantineReceiptState.Quarantined,
        storedEnvelope.revision,
        false,
        storedAdminDto,
        persistedReceipt.storagePath,
        [persistedReceipt.generation]
      );
    }

    if (persistedReceipt.state === LibraryQuarantineReceiptState.WritePending) {
      return this.persistWritePendingToNeedsReconciliationBounded(
        storedEnvelope,
        storedAdminDto,
        actorUid,
        errorCode,
        rawReason,
        fallbackTimestampIso
      );
    }

    return makeReconciliationOrIntegrityFailure(
      'UNRESOLVED_NEEDS_RECONCILIATION',
      errorCode,
      rawReason,
      receiptId,
      LibraryQuarantineReceiptState.NeedsReconciliation,
      LibraryQuarantineReceiptState.NeedsReconciliation,
      storedEnvelope.revision,
      false,
      storedAdminDto,
      persistedReceipt.storagePath
    );
  }

  private async commitQuarantinedTransitionWithBoundedReread(
    storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope,
    storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto,
    previousState: 'WritePending' | 'NeedsReconciliation',
    nextQuarantinedReceipt: LibraryQuarantineInternalReceipt,
    attestation: TrustedStorageReadbackAttestation
  ): Promise<
    | LibraryQuarantineRecoverySuccess
    | LibraryQuarantineRecoveryPersistenceOrConflictFailure
  > {
    const persistedReceipt = storedEnvelope.receipt;
    const receiptId = persistedReceipt.receiptId;
    const expectedNextRevision = storedEnvelope.revision + 1;

    let casFailureMessage =
      'Firestore CAS to Quarantined did not return a verified convergence envelope.';

    try {
      const casRes = await this.receiptStore.compareAndSwapReceipt({
        receiptId,
        expectedRevision: storedEnvelope.revision,
        expectedCurrentReceipt: persistedReceipt,
        nextReceipt: nextQuarantinedReceipt,
      });

      if (
        casRes.ok &&
        casRes.envelope.receipt.receiptId === receiptId &&
        casRes.envelope.state === LibraryQuarantineReceiptState.Quarantined &&
        casRes.envelope.revision === expectedNextRevision &&
        doesReceiptMatchImmutableIdentityAndAttestation(
          casRes.envelope.receipt,
          persistedReceipt,
          attestation
        )
      ) {
        return makeRecoverySuccess(
          'RECOVERED_TO_QUARANTINED',
          receiptId,
          previousState,
          casRes.envelope.revision,
          true,
          false,
          casRes.adminReceiptDto
        );
      }

      if (!casRes.ok) {
        casFailureMessage = casRes.errorMessage;
      }
    } catch (err) {
      casFailureMessage =
        err instanceof Error
          ? err.message
          : 'Unexpected exception during Firestore CAS to Quarantined.';
    }

    // Bounded single reread for classification only (never performs a second mutation)
    return this.classifyPostQuarantineCasUncertaintyViaSingleReread(
      storedEnvelope,
      storedAdminDto,
      previousState,
      attestation,
      casFailureMessage
    );
  }

  private async classifyPostQuarantineCasUncertaintyViaSingleReread(
    storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope,
    storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto,
    previousState: 'WritePending' | 'NeedsReconciliation',
    attestation: TrustedStorageReadbackAttestation,
    casFailureMessage: string
  ): Promise<
    | LibraryQuarantineRecoverySuccess
    | LibraryQuarantineRecoveryPersistenceOrConflictFailure
  > {
    const persistedReceipt = storedEnvelope.receipt;
    const receiptId = persistedReceipt.receiptId;

    try {
      const rereadRes = await this.receiptStore.getReceiptById(receiptId);
      if (rereadRes.ok) {
        const latestEnvelope = rereadRes.envelope;
        const latestReceipt = latestEnvelope.receipt;

        // Case A: The CAS actually committed (or an identical recovery committed the exact same generation)
        if (
          latestEnvelope.revision >= storedEnvelope.revision + 1 &&
          doesReceiptMatchImmutableIdentityAndAttestation(
            latestReceipt,
            persistedReceipt,
            attestation
          )
        ) {
          return makeRecoverySuccess(
            'RECOVERED_TO_QUARANTINED',
            receiptId,
            previousState,
            latestEnvelope.revision,
            true,
            true,
            rereadRes.adminReceiptDto
          );
        }

        // Case B: A competing concurrent state/revision change occurred (e.g. Rejected or different generation)
        if (
          latestEnvelope.revision !== storedEnvelope.revision ||
          latestReceipt.state !== persistedReceipt.state
        ) {
          return makePersistenceOrConflictFailure(
            'CONCURRENT_STATE_CONFLICT',
            'CONCURRENT_STATE_CHANGE',
            `Concurrent state or revision change detected during recovery (current state "${latestReceipt.state}", revision ${latestEnvelope.revision}).`,
            receiptId,
            previousState,
            latestReceipt.state,
            latestEnvelope.revision,
            rereadRes.adminReceiptDto,
            persistedReceipt.storagePath,
            [
              persistedReceipt.generation,
              latestReceipt.generation,
              attestation.attestedGeneration,
            ]
          );
        }
      }
    } catch {
      // Fall through to PERSISTENCE_UNCERTAIN if the single classification reread itself threw
    }

    return makePersistenceOrConflictFailure(
      'PERSISTENCE_UNCERTAIN',
      'RECOVERY_QUARANTINE_CAS_FAILED',
      `GCS object was verified, but Firestore CAS to Quarantined could not be confirmed: ${casFailureMessage}`,
      receiptId,
      previousState,
      persistedReceipt.state,
      storedEnvelope.revision,
      storedAdminDto,
      persistedReceipt.storagePath,
      [persistedReceipt.generation, attestation.attestedGeneration]
    );
  }

  private async persistWritePendingToNeedsReconciliationBounded(
    storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope,
    storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto,
    actorUid: string,
    errorCode:
      | 'STORED_OBJECT_NOT_FOUND'
      | 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
      | 'GCS_READBACK_UNCERTAIN'
      | 'ATTESTATION_TRANSITION_REJECTED',
    rawReason: string,
    fallbackTimestampIso: string,
    extraRedactions?: readonly (string | null | undefined)[]
  ): Promise<
    | LibraryQuarantineRecoveryReconciliationOrIntegrityFailure
    | LibraryQuarantineRecoveryPersistenceOrConflictFailure
  > {
    const writePendingReceipt = storedEnvelope.receipt;
    const receiptId = writePendingReceipt.receiptId;
    const expectedNextRevision = storedEnvelope.revision + 1;

    const sanitizedReason = sanitizeRecoveryMessage(
      rawReason,
      writePendingReceipt.storagePath,
      extraRedactions
    );

    const reconTransition = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: writePendingReceipt,
      actorUid,
      reconciliationReason: sanitizedReason,
      nowIso: fallbackTimestampIso,
    });

    if (!reconTransition.ok) {
      return makePersistenceOrConflictFailure(
        'PERSISTENCE_UNCERTAIN',
        'RECOVERY_RECONCILIATION_CAS_FAILED',
        `Unable to construct NeedsReconciliation transition during recovery: ${reconTransition.errorMessage}`,
        receiptId,
        LibraryQuarantineReceiptState.WritePending,
        writePendingReceipt.state,
        storedEnvelope.revision,
        storedAdminDto,
        writePendingReceipt.storagePath,
        extraRedactions
      );
    }

    let casFailureMessage =
      'Firestore CAS to NeedsReconciliation did not converge.';

    try {
      const casRes = await this.receiptStore.compareAndSwapReceipt({
        receiptId,
        expectedRevision: storedEnvelope.revision,
        expectedCurrentReceipt: writePendingReceipt,
        nextReceipt: reconTransition.receipt,
      });

      if (
        casRes.ok &&
        casRes.envelope.receipt.receiptId === receiptId &&
        casRes.envelope.state ===
          LibraryQuarantineReceiptState.NeedsReconciliation &&
        casRes.envelope.revision === expectedNextRevision
      ) {
        return makeReconciliationOrIntegrityFailure(
          'TRANSITIONED_TO_NEEDS_RECONCILIATION',
          errorCode,
          sanitizedReason,
          receiptId,
          LibraryQuarantineReceiptState.WritePending,
          LibraryQuarantineReceiptState.NeedsReconciliation,
          casRes.envelope.revision,
          true,
          casRes.adminReceiptDto,
          writePendingReceipt.storagePath,
          extraRedactions
        );
      }

      if (!casRes.ok) {
        casFailureMessage = casRes.errorMessage;
      }
    } catch (err) {
      casFailureMessage =
        err instanceof Error
          ? err.message
          : 'Unexpected exception during NeedsReconciliation CAS.';
    }

    // Bounded single reread for classification only (never performs a second mutation)
    try {
      const rereadRes = await this.receiptStore.getReceiptById(receiptId);
      if (rereadRes.ok) {
        const latestEnvelope = rereadRes.envelope;
        const latestReceipt = latestEnvelope.receipt;

        if (
          latestEnvelope.revision !== storedEnvelope.revision ||
          latestReceipt.state !== writePendingReceipt.state
        ) {
          return makePersistenceOrConflictFailure(
            'CONCURRENT_STATE_CONFLICT',
            'CONCURRENT_STATE_CHANGE',
            `Concurrent state or revision change detected while transitioning WritePending to NeedsReconciliation (current state "${latestReceipt.state}", revision ${latestEnvelope.revision}).`,
            receiptId,
            LibraryQuarantineReceiptState.WritePending,
            latestReceipt.state,
            latestEnvelope.revision,
            rereadRes.adminReceiptDto,
            writePendingReceipt.storagePath,
            [
              ...(extraRedactions ?? []),
              writePendingReceipt.generation,
              latestReceipt.generation,
            ]
          );
        }
      }
    } catch {
      // Fall through to PERSISTENCE_UNCERTAIN if single reread threw
    }

    return makePersistenceOrConflictFailure(
      'PERSISTENCE_UNCERTAIN',
      'RECOVERY_RECONCILIATION_CAS_FAILED',
      `Failed to persist NeedsReconciliation state during recovery: ${casFailureMessage}`,
      receiptId,
      LibraryQuarantineReceiptState.WritePending,
      writePendingReceipt.state,
      storedEnvelope.revision,
      storedAdminDto,
      writePendingReceipt.storagePath,
      extraRedactions
    );
  }
}
