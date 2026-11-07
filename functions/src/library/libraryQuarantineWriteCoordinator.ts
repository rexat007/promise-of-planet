import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES } from './libraryUploadBinaryAdmission';
import { inspectLibraryUploadDeepStructure } from './libraryUploadDeepStructure';
import {
  LIBRARY_QUARANTINE_STORAGE_PREFIX,
  LibraryQuarantineReceiptState,
  beginLibraryQuarantineWritePending,
  confirmLibraryQuarantineWriteWithAttestation,
  deriveLibraryQuarantineStoragePath,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  markLibraryQuarantineWriteNeedsReconciliation,
  parseLibraryQuarantineStoragePath,
  type LibraryQuarantineInternalReceipt,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';
import {
  type LibraryQuarantinePersistedReceiptEnvelope,
  type LibraryQuarantineReceiptStore,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  type LibraryQuarantineGcsAdapterResult,
  type WriteLibraryQuarantineObjectInput,
} from './gcsLibraryQuarantineStorageAdapter';

/**
 * LIB-FILE-02B2B1 — Firestore + GCS Quarantine Write Coordinator
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Server-internal coordinator connecting:
 *   1. `LIB-FILE-02A` quarantine receipt lifecycle state machine.
 *   2. `LIB-FILE-02B1` durable Firestore receipt repository (CAS transactions).
 *   3. `LIB-FILE-02B2A` private GCS quarantine storage adapter.
 * - Guarantees that a GCS write is NEVER attempted unless `Reserved -> WritePending`
 *   has been durably committed in Firestore via CAS (`compareAndSwapReceipt`).
 * - Guarantees that a verified GCS write or verified existing object NEVER
 *   produces a successful coordinator outcome unless `WritePending -> Quarantined`
 *   has also been durably committed in Firestore via CAS.
 * - Attempts the conditional GCS write (`ifGenerationMatch: 0`) at most once per
 *   execution; never retries uploads, never overwrites or deletes objects, and
 *   never rotates or invents a replacement `receiptId`.
 * - On ambiguous GCS outcomes, post-write conflicts, or unexpected GCS exceptions,
 *   attempts one bounded CAS transition `WritePending -> NeedsReconciliation`.
 *   If final or reconciliation CAS fails, returns explicit `PERSISTENCE_UNCERTAIN`.
 * - Never restarts receipts already in `WritePending`, `NeedsReconciliation`,
 *   `Quarantined`, or `Rejected`.
 * - Redacts `storagePath`, `generation`, raw bytes, attestations, URLs, tokens,
 *   credentials, and unredacted internal exception strings from all responses.
 */

export interface LibraryQuarantineGcsWritePort {
  writeQuarantineObjectIfAbsent(
    input: WriteLibraryQuarantineObjectInput
  ): Promise<LibraryQuarantineGcsAdapterResult>;
}

export interface ExecuteReservedQuarantineWriteInput {
  readonly receiptId: string;
  readonly actorUid: string;
  readonly bytes: Buffer | Uint8Array;
}

export type LibraryQuarantineWriteCoordinatorErrorCode =
  | 'INVALID_COORDINATOR_DEPENDENCY'
  | 'INVALID_COORDINATOR_INPUT'
  | 'UNTRUSTED_CALLER_FIELD'
  | 'INVALID_RECEIPT_ID'
  | 'INVALID_ACTOR_UID'
  | 'INVALID_BINARY_BYTES'
  | 'INVALID_TIMESTAMP'
  | 'RECEIPT_NOT_FOUND'
  | 'RECEIPT_STORE_PREFLIGHT_FAILED'
  | 'INVALID_INITIAL_RECEIPT_STATE'
  | 'ACTOR_OWNERSHIP_MISMATCH'
  | 'INPUT_BYTE_SIZE_MISMATCH'
  | 'INPUT_SHA256_MISMATCH'
  | 'BINARY_ADMISSION_OR_STRUCTURE_REJECTED'
  | 'WRITE_PENDING_TRANSITION_REJECTED'
  | 'WRITE_PENDING_CAS_CONFLICT_OR_FAILURE'
  | 'GCS_WRITE_NEEDS_RECONCILIATION'
  | 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
  | 'ATTESTATION_CONFIRMATION_REJECTED'
  | 'FINAL_QUARANTINE_CAS_FAILED'
  | 'RECONCILIATION_CAS_FAILED';

export interface LibraryQuarantineCoordinatorQuarantinedSuccess {
  readonly ok: true;
  readonly status: 'QUARANTINED';
  readonly receiptId: string;
  readonly revision: number;
  readonly gcsWriteAttempted: true;
  readonly gcsDisposition: 'WRITTEN_AND_VERIFIED' | 'EXISTING_VERIFIED';
  readonly createdNewGcsObject: boolean;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineCoordinatorPreflightOrCasFailure {
  readonly ok: false;
  readonly status: 'PREFLIGHT_REJECTED' | 'WRITE_PENDING_CAS_FAILED';
  readonly errorCode:
    | 'INVALID_COORDINATOR_DEPENDENCY'
    | 'INVALID_COORDINATOR_INPUT'
    | 'UNTRUSTED_CALLER_FIELD'
    | 'INVALID_RECEIPT_ID'
    | 'INVALID_ACTOR_UID'
    | 'INVALID_BINARY_BYTES'
    | 'INVALID_TIMESTAMP'
    | 'RECEIPT_NOT_FOUND'
    | 'RECEIPT_STORE_PREFLIGHT_FAILED'
    | 'INVALID_INITIAL_RECEIPT_STATE'
    | 'ACTOR_OWNERSHIP_MISMATCH'
    | 'INPUT_BYTE_SIZE_MISMATCH'
    | 'INPUT_SHA256_MISMATCH'
    | 'BINARY_ADMISSION_OR_STRUCTURE_REJECTED'
    | 'WRITE_PENDING_TRANSITION_REJECTED'
    | 'WRITE_PENDING_CAS_CONFLICT_OR_FAILURE';
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly gcsWriteAttempted: false;
  readonly reconciliationPersisted: false;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto | null;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineCoordinatorNeedsReconciliationFailure {
  readonly ok: false;
  readonly status: 'NEEDS_RECONCILIATION';
  readonly errorCode:
    | 'GCS_WRITE_NEEDS_RECONCILIATION'
    | 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
    | 'ATTESTATION_CONFIRMATION_REJECTED';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly revision: number;
  readonly gcsWriteAttempted: true;
  readonly reconciliationPersisted: true;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineCoordinatorPersistenceUncertainFailure {
  readonly ok: false;
  readonly status: 'PERSISTENCE_UNCERTAIN';
  readonly errorCode:
    | 'FINAL_QUARANTINE_CAS_FAILED'
    | 'RECONCILIATION_CAS_FAILED';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly lastKnownRevision: number;
  readonly gcsWriteAttempted: true;
  readonly reconciliationPersisted: false;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type ExecuteReservedQuarantineWriteResult =
  | LibraryQuarantineCoordinatorQuarantinedSuccess
  | LibraryQuarantineCoordinatorPreflightOrCasFailure
  | LibraryQuarantineCoordinatorNeedsReconciliationFailure
  | LibraryQuarantineCoordinatorPersistenceUncertainFailure;

const ALLOWED_EXECUTE_WRITE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'actorUid',
  'bytes',
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

function extractExactByteSlice(rawBytes: unknown): Buffer | null {
  if (rawBytes instanceof Uint8Array) {
    return Buffer.from(
      rawBytes.buffer,
      rawBytes.byteOffset,
      rawBytes.byteLength
    );
  }
  return null;
}

function sanitizeCoordinatorMessage(
  rawMessage: string,
  internalStoragePath?: string
): string {
  let cleaned = rawMessage;
  if (internalStoragePath && internalStoragePath.length > 0) {
    cleaned = cleaned.split(internalStoragePath).join('[REDACTED_STORAGE_PATH]');
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
      /(?:token|secret|password|key|signature|credential)\s*[:=]\s*[^\s,;]+/gi,
      '[REDACTED_CREDENTIAL]'
    )
    .replace(CONTROL_OR_BIDI_CHAR_REGEX, ' ')
    .trim();

  if (cleaned.length === 0) {
    return 'Quarantine write coordination failed.';
  }
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}...` : cleaned;
}

function makePreflightOrCasFailure(
  status: 'PREFLIGHT_REJECTED' | 'WRITE_PENDING_CAS_FAILED',
  errorCode: LibraryQuarantineCoordinatorPreflightOrCasFailure['errorCode'],
  errorMessage: string,
  receiptId: string | null,
  adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto | null = null,
  internalStoragePath?: string
): LibraryQuarantineCoordinatorPreflightOrCasFailure {
  return Object.freeze({
    ok: false as const,
    status,
    errorCode,
    errorMessage: sanitizeCoordinatorMessage(errorMessage, internalStoragePath),
    receiptId,
    gcsWriteAttempted: false as const,
    reconciliationPersisted: false as const,
    adminReceiptDto: adminReceiptDto ? Object.freeze({ ...adminReceiptDto }) : null,
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeNeedsReconciliationResult(
  errorCode: LibraryQuarantineCoordinatorNeedsReconciliationFailure['errorCode'],
  errorMessage: string,
  receiptId: string,
  revision: number,
  adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto,
  internalStoragePath?: string
): LibraryQuarantineCoordinatorNeedsReconciliationFailure {
  return Object.freeze({
    ok: false as const,
    status: 'NEEDS_RECONCILIATION' as const,
    errorCode,
    errorMessage: sanitizeCoordinatorMessage(errorMessage, internalStoragePath),
    receiptId,
    revision,
    gcsWriteAttempted: true as const,
    reconciliationPersisted: true as const,
    adminReceiptDto: Object.freeze({ ...adminReceiptDto }),
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makePersistenceUncertainResult(
  errorCode: LibraryQuarantineCoordinatorPersistenceUncertainFailure['errorCode'],
  errorMessage: string,
  receiptId: string,
  lastKnownRevision: number,
  adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto,
  internalStoragePath?: string
): LibraryQuarantineCoordinatorPersistenceUncertainFailure {
  return Object.freeze({
    ok: false as const,
    status: 'PERSISTENCE_UNCERTAIN' as const,
    errorCode,
    errorMessage: sanitizeCoordinatorMessage(errorMessage, internalStoragePath),
    receiptId,
    lastKnownRevision,
    gcsWriteAttempted: true as const,
    reconciliationPersisted: false as const,
    adminReceiptDto: Object.freeze({ ...adminReceiptDto }),
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeQuarantinedSuccessResult(
  receiptId: string,
  revision: number,
  gcsDisposition: 'WRITTEN_AND_VERIFIED' | 'EXISTING_VERIFIED',
  createdNewGcsObject: boolean,
  adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto
): LibraryQuarantineCoordinatorQuarantinedSuccess {
  return Object.freeze({
    ok: true as const,
    status: 'QUARANTINED' as const,
    receiptId,
    revision,
    gcsWriteAttempted: true as const,
    gcsDisposition,
    createdNewGcsObject,
    adminReceiptDto: Object.freeze({ ...adminReceiptDto }),
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

/**
 * Dependency-injected server-internal coordinator for reserved quarantine writes.
 */
export class LibraryQuarantineWriteCoordinator {
  private readonly receiptStore: LibraryQuarantineReceiptStore;
  private readonly storageAdapter: LibraryQuarantineGcsWritePort;
  private readonly clock: () => string;

  constructor(options: {
    readonly receiptStore: LibraryQuarantineReceiptStore;
    readonly storageAdapter: LibraryQuarantineGcsWritePort;
    readonly clock?: () => string;
  }) {
    if (
      !options ||
      !options.receiptStore ||
      typeof options.receiptStore.getReceiptById !== 'function' ||
      typeof options.receiptStore.compareAndSwapReceipt !== 'function'
    ) {
      throw new Error(
        'INVALID_COORDINATOR_DEPENDENCY: LibraryQuarantineWriteCoordinator requires a valid receiptStore implementing getReceiptById and compareAndSwapReceipt.'
      );
    }

    if (
      !options.storageAdapter ||
      typeof options.storageAdapter.writeQuarantineObjectIfAbsent !== 'function'
    ) {
      throw new Error(
        'INVALID_COORDINATOR_DEPENDENCY: LibraryQuarantineWriteCoordinator requires a valid storageAdapter implementing writeQuarantineObjectIfAbsent.'
      );
    }

    if (options.clock !== undefined && typeof options.clock !== 'function') {
      throw new Error(
        'INVALID_COORDINATOR_DEPENDENCY: Optional clock must be a function returning an ISO-8601 UTC timestamp.'
      );
    }

    this.receiptStore = options.receiptStore;
    this.storageAdapter = options.storageAdapter;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  /**
   * Executes the server-internal quarantine write sequence for a `Reserved` receipt:
   * 1. Preflight validation against the authoritative Firestore receipt and actual bytes.
   * 2. Atomic Firestore CAS (`Reserved -> WritePending`) BEFORE invoking GCS.
   * 3. Single conditional GCS write attempt (`ifGenerationMatch: 0`) + bounded readback.
   * 4. Atomic Firestore CAS (`WritePending -> Quarantined`) ONLY upon verified attestation,
   *    or bounded CAS (`WritePending -> NeedsReconciliation`) upon ambiguous/conflicting GCS outcome.
   */
  public async executeReservedQuarantineWrite(
    rawInput: unknown
  ): Promise<ExecuteReservedQuarantineWriteResult> {
    if (!isPlainRecord(rawInput)) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_COORDINATOR_INPUT',
        'executeReservedQuarantineWrite input must be a plain non-null object.',
        null
      );
    }

    const unexpectedKey = findUnexpectedPropertyOrSymbol(
      rawInput,
      ALLOWED_EXECUTE_WRITE_INPUT_KEYS
    );
    if (unexpectedKey !== null) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'UNTRUSTED_CALLER_FIELD',
        `Caller-supplied field "${unexpectedKey}" is forbidden in executeReservedQuarantineWrite.`,
        null
      );
    }

    const { receiptId, actorUid, bytes } = rawInput;

    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_RECEIPT_ID',
        'receiptId must be a valid 32-character lowercase hexadecimal string.',
        null
      );
    }

    if (!isValidUploaderUid(actorUid)) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_ACTOR_UID',
        'actorUid must be a valid non-empty server-authenticated user identifier.',
        receiptId
      );
    }

    const byteSlice = extractExactByteSlice(bytes);
    if (byteSlice === null) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_BINARY_BYTES',
        'bytes must be a Buffer or Uint8Array.',
        receiptId
      );
    }

    if (
      byteSlice.byteLength <= 0 ||
      byteSlice.byteLength > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
    ) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INPUT_BYTE_SIZE_MISMATCH',
        `Binary payload byteLength (${byteSlice.byteLength}) is outside the allowed 1..${MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES} byte range.`,
        receiptId
      );
    }

    // Step A: Read authoritative receipt from Firestore by receiptId
    let storedEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
    let storedAdminDto: SanitizedLibraryQuarantineAdminReceiptDto;

    try {
      const readRes = await this.receiptStore.getReceiptById(receiptId);
      if (!readRes.ok) {
        if (readRes.errorCode === 'RECEIPT_NOT_FOUND') {
          return makePreflightOrCasFailure(
            'PREFLIGHT_REJECTED',
            'RECEIPT_NOT_FOUND',
            `Quarantine receipt "${receiptId}" was not found in Firestore.`,
            receiptId
          );
        }
        return makePreflightOrCasFailure(
          'PREFLIGHT_REJECTED',
          'RECEIPT_STORE_PREFLIGHT_FAILED',
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
          : 'Unknown error reading receipt from Firestore.';
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'RECEIPT_STORE_PREFLIGHT_FAILED',
        msg,
        receiptId
      );
    }

    const reservedReceipt: LibraryQuarantineInternalReceipt =
      storedEnvelope.receipt;

    // Require Reserved state before any write; never automatically restart WritePending or NeedsReconciliation
    if (reservedReceipt.state !== LibraryQuarantineReceiptState.Reserved) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_INITIAL_RECEIPT_STATE',
        `Receipt "${receiptId}" must be in "Reserved" state to start a quarantine write; found "${reservedReceipt.state}".`,
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    if (actorUid !== reservedReceipt.uploaderUid) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'ACTOR_OWNERSHIP_MISMATCH',
        'actorUid does not match the authoritative receipt uploaderUid.',
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    // Verify canonical storagePath integrity on stored receipt
    const derivedPath = deriveLibraryQuarantineStoragePath(
      reservedReceipt.receiptId,
      reservedReceipt.format
    );
    const parsedPath = parseLibraryQuarantineStoragePath(
      reservedReceipt.storagePath
    );
    if (
      !derivedPath.ok ||
      !parsedPath.ok ||
      derivedPath.parsed.storagePath !== reservedReceipt.storagePath ||
      parsedPath.parsed.storagePath !== reservedReceipt.storagePath
    ) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'RECEIPT_STORE_PREFLIGHT_FAILED',
        'Stored receipt storagePath failed canonical quarantine path verification.',
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    // Verify byte size and actual-byte SHA-256 against stored receipt
    if (byteSlice.byteLength !== reservedReceipt.byteSize) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INPUT_BYTE_SIZE_MISMATCH',
        `Supplied byteLength (${byteSlice.byteLength}) does not match stored receipt byteSize (${reservedReceipt.byteSize}).`,
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    const actualSha256 = createHash('sha256')
      .update(byteSlice)
      .digest('hex')
      .toLowerCase();

    if (actualSha256 !== reservedReceipt.sha256) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INPUT_SHA256_MISMATCH',
        'Supplied binary SHA-256 does not match stored receipt sha256.',
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    // Re-execute established 01A + 01B binary/deep structure inspection rules on the exact byte slice
    const deepInspection = inspectLibraryUploadDeepStructure({
      originalFilename: reservedReceipt.originalFilename,
      claimedMimeType: reservedReceipt.canonicalMimeType,
      bytes: byteSlice,
    });

    if (
      deepInspection.status === 'REJECTED' ||
      deepInspection.status !== reservedReceipt.deepInspectionStatus ||
      deepInspection.format !== reservedReceipt.format ||
      deepInspection.sizeBytes !== reservedReceipt.byteSize ||
      deepInspection.sha256 !== reservedReceipt.sha256
    ) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'BINARY_ADMISSION_OR_STRUCTURE_REJECTED',
        deepInspection.status === 'REJECTED'
          ? deepInspection.reasonDetail
          : 'Binary deep structure inspection verdict does not match stored receipt.',
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    // Step B: Transition Reserved -> WritePending and commit via Firestore CAS BEFORE touching GCS
    const writePendingAtIso = this.clock();
    if (!isValidIsoUtcTimestamp(writePendingAtIso)) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'INVALID_TIMESTAMP',
        'Server clock produced an invalid ISO-8601 UTC timestamp for WritePending transition.',
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    const wpTransition = beginLibraryQuarantineWritePending({
      receipt: reservedReceipt,
      actorUid,
      expectedReceiptId: receiptId,
      expectedSha256: reservedReceipt.sha256,
      nowIso: writePendingAtIso,
    });

    if (!wpTransition.ok) {
      return makePreflightOrCasFailure(
        'PREFLIGHT_REJECTED',
        'WRITE_PENDING_TRANSITION_REJECTED',
        wpTransition.errorMessage,
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    let writePendingEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
    let writePendingAdminDto: SanitizedLibraryQuarantineAdminReceiptDto;

    try {
      const wpCasRes = await this.receiptStore.compareAndSwapReceipt({
        receiptId,
        expectedRevision: storedEnvelope.revision,
        expectedCurrentReceipt: reservedReceipt,
        nextReceipt: wpTransition.receipt,
      });

      if (
        !wpCasRes.ok ||
        wpCasRes.envelope.state !== LibraryQuarantineReceiptState.WritePending
      ) {
        return makePreflightOrCasFailure(
          'WRITE_PENDING_CAS_FAILED',
          'WRITE_PENDING_CAS_CONFLICT_OR_FAILURE',
          wpCasRes.ok
            ? 'WritePending CAS did not converge to WritePending state.'
            : wpCasRes.errorMessage,
          receiptId,
          storedAdminDto,
          reservedReceipt.storagePath
        );
      }

      writePendingEnvelope = wpCasRes.envelope;
      writePendingAdminDto = wpCasRes.adminReceiptDto;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unexpected Firestore error during WritePending CAS.';
      return makePreflightOrCasFailure(
        'WRITE_PENDING_CAS_FAILED',
        'WRITE_PENDING_CAS_CONFLICT_OR_FAILURE',
        msg,
        receiptId,
        storedAdminDto,
        reservedReceipt.storagePath
      );
    }

    const writePendingReceipt = writePendingEnvelope.receipt;

    // Step C: Conditional GCS write (attempted ONCE only, passing the receipt from successful CAS)
    const verifiedAtIso = this.clock();
    if (
      !isValidIsoUtcTimestamp(verifiedAtIso) ||
      Date.parse(verifiedAtIso) < Date.parse(writePendingReceipt.updatedAt)
    ) {
      return this.persistNeedsReconciliationBounded(
        writePendingEnvelope,
        writePendingAdminDto,
        actorUid,
        'GCS_WRITE_NEEDS_RECONCILIATION',
        'Server clock produced an invalid or non-monotonic timestamp prior to GCS verification.',
        writePendingReceipt.updatedAt
      );
    }

    let gcsOutcome: LibraryQuarantineGcsAdapterResult;
    try {
      gcsOutcome = await this.storageAdapter.writeQuarantineObjectIfAbsent({
        receipt: writePendingReceipt,
        bytes: byteSlice,
        verifiedAtIso,
      });
    } catch (err) {
      const rawErrMsg =
        err instanceof Error
          ? err.message
          : 'Unexpected exception thrown by GCS quarantine storage adapter.';
      return this.persistNeedsReconciliationBounded(
        writePendingEnvelope,
        writePendingAdminDto,
        actorUid,
        'GCS_WRITE_NEEDS_RECONCILIATION',
        `Unexpected exception during GCS quarantine write: ${rawErrMsg}`,
        verifiedAtIso
      );
    }

    // Step D: Verified GCS result (WRITTEN_AND_VERIFIED or EXISTING_VERIFIED)
    if (
      gcsOutcome.ok &&
      (gcsOutcome.status === 'WRITTEN_AND_VERIFIED' ||
        gcsOutcome.status === 'EXISTING_VERIFIED')
    ) {
      const confirmTransition = confirmLibraryQuarantineWriteWithAttestation({
        receipt: writePendingReceipt,
        actorUid,
        attestation: gcsOutcome.attestation,
      });

      if (!confirmTransition.ok) {
        return this.persistNeedsReconciliationBounded(
          writePendingEnvelope,
          writePendingAdminDto,
          actorUid,
          'ATTESTATION_CONFIRMATION_REJECTED',
          `GCS readback attestation was rejected by receipt contract: ${confirmTransition.errorMessage}`,
          verifiedAtIso
        );
      }

      try {
        const finalCasRes = await this.receiptStore.compareAndSwapReceipt({
          receiptId,
          expectedRevision: writePendingEnvelope.revision,
          expectedCurrentReceipt: writePendingReceipt,
          nextReceipt: confirmTransition.receipt,
        });

        if (
          !finalCasRes.ok ||
          finalCasRes.envelope.state !==
            LibraryQuarantineReceiptState.Quarantined
        ) {
          return makePersistenceUncertainResult(
            'FINAL_QUARANTINE_CAS_FAILED',
            finalCasRes.ok
              ? 'Final CAS did not converge to Quarantined state after verified GCS write.'
              : `GCS write was verified, but final Firestore CAS to Quarantined failed: ${finalCasRes.errorMessage}`,
            receiptId,
            writePendingEnvelope.revision,
            writePendingAdminDto,
            writePendingReceipt.storagePath
          );
        }

        return makeQuarantinedSuccessResult(
          receiptId,
          finalCasRes.envelope.revision,
          gcsOutcome.status,
          gcsOutcome.createdNewObject,
          finalCasRes.adminReceiptDto
        );
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unexpected exception during final Quarantined CAS.';
        return makePersistenceUncertainResult(
          'FINAL_QUARANTINE_CAS_FAILED',
          `GCS write was verified, but final Firestore CAS threw an error: ${msg}`,
          receiptId,
          writePendingEnvelope.revision,
          writePendingAdminDto,
          writePendingReceipt.storagePath
        );
      }
    }

    // Step E: Uncertain or conflicting GCS result -> transition WritePending -> NeedsReconciliation via 1 bounded CAS
    const isConflictOrMismatch =
      !gcsOutcome.ok && gcsOutcome.status === 'CONFLICT_OR_MISMATCH';

    const coordinatorErrCode:
      | 'GCS_WRITE_NEEDS_RECONCILIATION'
      | 'GCS_OBJECT_CONFLICT_OR_MISMATCH' = isConflictOrMismatch
      ? 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
      : 'GCS_WRITE_NEEDS_RECONCILIATION';

    const reasonText =
      !gcsOutcome.ok && gcsOutcome.status === 'NEEDS_RECONCILIATION'
        ? gcsOutcome.reconciliationReason
        : !gcsOutcome.ok
          ? gcsOutcome.errorMessage
          : 'GCS quarantine write returned an unrecognized outcome.';

    return this.persistNeedsReconciliationBounded(
      writePendingEnvelope,
      writePendingAdminDto,
      actorUid,
      coordinatorErrCode,
      reasonText,
      verifiedAtIso
    );
  }

  private async persistNeedsReconciliationBounded(
    writePendingEnvelope: LibraryQuarantinePersistedReceiptEnvelope,
    writePendingAdminDto: SanitizedLibraryQuarantineAdminReceiptDto,
    actorUid: string,
    coordinatorErrorCode:
      | 'GCS_WRITE_NEEDS_RECONCILIATION'
      | 'GCS_OBJECT_CONFLICT_OR_MISMATCH'
      | 'ATTESTATION_CONFIRMATION_REJECTED',
    rawReason: string,
    fallbackTimestampIso: string
  ): Promise<
    | LibraryQuarantineCoordinatorNeedsReconciliationFailure
    | LibraryQuarantineCoordinatorPersistenceUncertainFailure
  > {
    const writePendingReceipt = writePendingEnvelope.receipt;
    const receiptId = writePendingReceipt.receiptId;

    const candidateClockIso = this.clock();
    const reconNowIso =
      isValidIsoUtcTimestamp(candidateClockIso) &&
      Date.parse(candidateClockIso) >= Date.parse(writePendingReceipt.updatedAt)
        ? candidateClockIso
        : isValidIsoUtcTimestamp(fallbackTimestampIso) &&
            Date.parse(fallbackTimestampIso) >=
              Date.parse(writePendingReceipt.updatedAt)
          ? fallbackTimestampIso
          : writePendingReceipt.updatedAt;

    const sanitizedReason = sanitizeCoordinatorMessage(
      rawReason,
      writePendingReceipt.storagePath
    );

    const reconTransition = markLibraryQuarantineWriteNeedsReconciliation({
      receipt: writePendingReceipt,
      actorUid,
      reconciliationReason: sanitizedReason,
      nowIso: reconNowIso,
    });

    if (!reconTransition.ok) {
      return makePersistenceUncertainResult(
        'RECONCILIATION_CAS_FAILED',
        `Unable to construct NeedsReconciliation transition: ${reconTransition.errorMessage}`,
        receiptId,
        writePendingEnvelope.revision,
        writePendingAdminDto,
        writePendingReceipt.storagePath
      );
    }

    try {
      const reconCasRes = await this.receiptStore.compareAndSwapReceipt({
        receiptId,
        expectedRevision: writePendingEnvelope.revision,
        expectedCurrentReceipt: writePendingReceipt,
        nextReceipt: reconTransition.receipt,
      });

      if (
        !reconCasRes.ok ||
        reconCasRes.envelope.state !==
          LibraryQuarantineReceiptState.NeedsReconciliation
      ) {
        return makePersistenceUncertainResult(
          'RECONCILIATION_CAS_FAILED',
          reconCasRes.ok
            ? 'Reconciliation CAS did not converge to NeedsReconciliation state.'
            : `Failed to persist NeedsReconciliation state via CAS: ${reconCasRes.errorMessage}`,
          receiptId,
          writePendingEnvelope.revision,
          writePendingAdminDto,
          writePendingReceipt.storagePath
        );
      }

      return makeNeedsReconciliationResult(
        coordinatorErrorCode,
        sanitizedReason,
        receiptId,
        reconCasRes.envelope.revision,
        reconCasRes.adminReceiptDto,
        writePendingReceipt.storagePath
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unexpected Firestore error during NeedsReconciliation CAS.';
      return makePersistenceUncertainResult(
        'RECONCILIATION_CAS_FAILED',
        `Exception while persisting NeedsReconciliation state via CAS: ${msg}`,
        receiptId,
        writePendingEnvelope.revision,
        writePendingAdminDto,
        writePendingReceipt.storagePath
      );
    }
  }
}
