import {
  LibraryQuarantineReceiptState,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  toSanitizedLibraryQuarantineAdminReceiptDto,
  validateLibraryQuarantineInternalReceipt,
  type LibraryQuarantineContractErrorCode,
  type LibraryQuarantineInternalReceipt,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';

/**
 * LIB-FILE-02B1 — Durable Firestore Quarantine Receipt Repository
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Standalone server-side Firestore persistence adapter for `LIB-FILE-02A`
 *   quarantine receipts using dependency injection.
 * - Uses the dedicated collection `library_quarantine_receipts` where each
 *   document ID is strictly the validated 32-character lowercase hex `receiptId`.
 * - Persists a versioned envelope (`schemaVersion: 1`, positive safe integer
 *   `revision`, derived `state` matching `receipt.state`, and validated
 *   `LibraryQuarantineInternalReceipt`).
 * - Never stores raw file bytes, access tokens, signed URLs, or public URLs.
 * - Performs all writes (`createReceiptIfAbsent`, `compareAndSwapReceipt`) inside
 *   Firestore transactions with strict compare-and-swap (CAS) checks on both
 *   `expectedRevision` and exact `expectedCurrentReceipt`.
 * - Fails closed on corrupted persisted envelopes without silent repair.
 * - Disallows unbounded collection scans.
 * - Structural validation of a persisted `Quarantined` state does NOT by itself
 *   prove live GCS object existence or safety; trusted GCS readback verification
 *   belongs to `LIB-FILE-02B2`.
 */

export const LIBRARY_QUARANTINE_RECEIPT_COLLECTION =
  'library_quarantine_receipts' as const;

export const LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION = 1 as const;

export type LibraryQuarantineReceiptStoreErrorCode =
  | 'INVALID_STORE_DEPENDENCY'
  | 'INVALID_STORE_INPUT'
  | 'UNTRUSTED_STORE_FIELD'
  | 'INVALID_RECEIPT_ID'
  | 'DOCUMENT_ID_MISMATCH'
  | 'INVALID_SCHEMA_VERSION'
  | 'INVALID_REVISION'
  | 'ENVELOPE_STATE_MISMATCH'
  | 'CORRUPTED_PERSISTED_RECEIPT'
  | 'INVALID_INITIAL_STATE'
  | 'RECEIPT_ALREADY_EXISTS_CONFLICT'
  | 'RECEIPT_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'CURRENT_RECEIPT_MISMATCH'
  | 'IMMUTABLE_FIELD_VIOLATION'
  | 'INVALID_LIFECYCLE_TRANSITION'
  | 'NON_MONOTONIC_TIMESTAMP'
  | 'SECURITY_FLAG_ESCALATION'
  | 'TRANSACTION_FAILURE';

export interface LibraryQuarantinePersistedReceiptEnvelope {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION;
  readonly revision: number;
  readonly state: LibraryQuarantineReceiptState;
  readonly receipt: LibraryQuarantineInternalReceipt;
}

export interface LibraryQuarantineFirestoreDocumentSnapshot {
  readonly exists: boolean;
  readonly id?: string;
  data(): unknown;
}

export interface LibraryQuarantineFirestoreDocumentRef {
  readonly id: string;
  get?(): Promise<LibraryQuarantineFirestoreDocumentSnapshot>;
}

/**
 * Collection reference restricted to point-lookup `.doc(documentId)`.
 * Unbounded `.get()` collection scans are intentionally omitted from this contract.
 */
export interface LibraryQuarantineFirestoreCollectionRef {
  doc(documentId: string): LibraryQuarantineFirestoreDocumentRef;
}

export interface LibraryQuarantineFirestoreTransaction {
  get(
    docRef: LibraryQuarantineFirestoreDocumentRef
  ): Promise<LibraryQuarantineFirestoreDocumentSnapshot>;
  create?(
    docRef: LibraryQuarantineFirestoreDocumentRef,
    data: Record<string, unknown>
  ): LibraryQuarantineFirestoreTransaction | void;
  set(
    docRef: LibraryQuarantineFirestoreDocumentRef,
    data: Record<string, unknown>
  ): LibraryQuarantineFirestoreTransaction | void;
}

export interface LibraryQuarantineFirestoreDatabase {
  collection(collectionName: string): LibraryQuarantineFirestoreCollectionRef;
  runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineFirestoreTransaction
    ) => Promise<T>
  ): Promise<T>;
}

export interface CompareAndSwapLibraryQuarantineReceiptInput {
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly expectedCurrentReceipt: LibraryQuarantineInternalReceipt;
  readonly nextReceipt: LibraryQuarantineInternalReceipt;
}

export interface LibraryQuarantineReceiptStoreFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineReceiptStoreErrorCode;
  readonly errorMessage: string;
  readonly contractErrorCode?: LibraryQuarantineContractErrorCode;
}

export type CreateLibraryQuarantineReceiptDisposition =
  | 'CREATED'
  | 'IDEMPOTENT_EXISTING';

export interface CreateLibraryQuarantineReceiptSuccess {
  readonly ok: true;
  readonly disposition: CreateLibraryQuarantineReceiptDisposition;
  readonly created: boolean;
  readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
}

export type CreateLibraryQuarantineReceiptResult =
  | CreateLibraryQuarantineReceiptSuccess
  | LibraryQuarantineReceiptStoreFailure;

export interface GetLibraryQuarantineReceiptSuccess {
  readonly ok: true;
  readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
}

export type GetLibraryQuarantineReceiptResult =
  | GetLibraryQuarantineReceiptSuccess
  | LibraryQuarantineReceiptStoreFailure;

export interface CompareAndSwapLibraryQuarantineReceiptSuccess {
  readonly ok: true;
  readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly adminReceiptDto: SanitizedLibraryQuarantineAdminReceiptDto;
}

export type CompareAndSwapLibraryQuarantineReceiptResult =
  | CompareAndSwapLibraryQuarantineReceiptSuccess
  | LibraryQuarantineReceiptStoreFailure;

export interface LibraryQuarantineReceiptStore {
  createReceiptIfAbsent(
    receipt: unknown
  ): Promise<CreateLibraryQuarantineReceiptResult>;
  getReceiptById(
    receiptId: unknown
  ): Promise<GetLibraryQuarantineReceiptResult>;
  compareAndSwapReceipt(
    input: unknown
  ): Promise<CompareAndSwapLibraryQuarantineReceiptResult>;
}

const ALLOWED_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'revision',
  'state',
  'receipt',
]);

const ALLOWED_CAS_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedRevision',
  'expectedCurrentReceipt',
  'nextReceipt',
]);

const LEGAL_NEXT_STATES_BY_CURRENT_STATE: Readonly<
  Record<LibraryQuarantineReceiptState, ReadonlySet<LibraryQuarantineReceiptState>>
> = Object.freeze({
  [LibraryQuarantineReceiptState.Reserved]: new Set<LibraryQuarantineReceiptState>([
    LibraryQuarantineReceiptState.WritePending,
    LibraryQuarantineReceiptState.Rejected,
  ]),
  [LibraryQuarantineReceiptState.WritePending]:
    new Set<LibraryQuarantineReceiptState>([
      LibraryQuarantineReceiptState.Quarantined,
      LibraryQuarantineReceiptState.NeedsReconciliation,
      LibraryQuarantineReceiptState.Rejected,
    ]),
  [LibraryQuarantineReceiptState.NeedsReconciliation]:
    new Set<LibraryQuarantineReceiptState>([
      LibraryQuarantineReceiptState.Quarantined,
      LibraryQuarantineReceiptState.Rejected,
    ]),
  [LibraryQuarantineReceiptState.Quarantined]:
    new Set<LibraryQuarantineReceiptState>([]),
  [LibraryQuarantineReceiptState.Rejected]:
    new Set<LibraryQuarantineReceiptState>([]),
});

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

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1
  );
}

function makeStoreFailure(
  errorCode: LibraryQuarantineReceiptStoreErrorCode,
  errorMessage: string,
  contractErrorCode?: LibraryQuarantineContractErrorCode
): LibraryQuarantineReceiptStoreFailure {
  const base: LibraryQuarantineReceiptStoreFailure =
    contractErrorCode !== undefined
      ? {
          ok: false,
          errorCode,
          errorMessage,
          contractErrorCode,
        }
      : {
          ok: false,
          errorCode,
          errorMessage,
        };
  return Object.freeze(base);
}

class InternalStoreTransactionAbortError extends Error {
  public readonly failure: LibraryQuarantineReceiptStoreFailure;

  constructor(failure: LibraryQuarantineReceiptStoreFailure) {
    super(failure.errorMessage);
    this.name = 'InternalStoreTransactionAbortError';
    this.failure = failure;
  }
}

function cloneReceiptRecord(
  receipt: LibraryQuarantineInternalReceipt
): LibraryQuarantineInternalReceipt {
  return Object.freeze({
    receiptId: receipt.receiptId,
    uploaderUid: receipt.uploaderUid,
    originalFilename: receipt.originalFilename,
    sanitizedFilename: receipt.sanitizedFilename,
    format: receipt.format,
    canonicalExtension: receipt.canonicalExtension,
    canonicalMimeType: receipt.canonicalMimeType,
    byteSize: receipt.byteSize,
    sha256: receipt.sha256,
    deepInspectionStatus: receipt.deepInspectionStatus,
    storagePath: receipt.storagePath,
    state: receipt.state,
    generation: receipt.generation,
    reconciliationReason: receipt.reconciliationReason,
    rejectionReasonCode: receipt.rejectionReasonCode,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function serializeEnvelopeForFirestore(
  envelope: LibraryQuarantinePersistedReceiptEnvelope
): Record<string, unknown> {
  const r = envelope.receipt;
  return {
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision: envelope.revision,
    state: envelope.state,
    receipt: {
      receiptId: r.receiptId,
      uploaderUid: r.uploaderUid,
      originalFilename: r.originalFilename,
      sanitizedFilename: r.sanitizedFilename,
      format: r.format,
      canonicalExtension: r.canonicalExtension,
      canonicalMimeType: r.canonicalMimeType,
      byteSize: r.byteSize,
      sha256: r.sha256,
      deepInspectionStatus: r.deepInspectionStatus,
      storagePath: r.storagePath,
      state: r.state,
      generation: r.generation,
      reconciliationReason: r.reconciliationReason,
      rejectionReasonCode: r.rejectionReasonCode,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    },
  };
}

/**
 * Strictly compares two validated `LibraryQuarantineInternalReceipt` records
 * across all 22 canonical fields.
 */
export function areLibraryQuarantineReceiptsEqual(
  first: LibraryQuarantineInternalReceipt,
  second: LibraryQuarantineInternalReceipt
): boolean {
  return (
    first.receiptId === second.receiptId &&
    first.uploaderUid === second.uploaderUid &&
    first.originalFilename === second.originalFilename &&
    first.sanitizedFilename === second.sanitizedFilename &&
    first.format === second.format &&
    first.canonicalExtension === second.canonicalExtension &&
    first.canonicalMimeType === second.canonicalMimeType &&
    first.byteSize === second.byteSize &&
    first.sha256 === second.sha256 &&
    first.deepInspectionStatus === second.deepInspectionStatus &&
    first.storagePath === second.storagePath &&
    first.state === second.state &&
    first.generation === second.generation &&
    first.reconciliationReason === second.reconciliationReason &&
    first.rejectionReasonCode === second.rejectionReasonCode &&
    first.createdAt === second.createdAt &&
    first.updatedAt === second.updatedAt &&
    first.isSanitized === second.isSanitized &&
    first.isVerifiedSafe === second.isVerifiedSafe &&
    first.isRightsApproved === second.isRightsApproved &&
    first.isPublished === second.isPublished &&
    first.isReadyForPeia === second.isReadyForPeia
  );
}

/**
 * Checks whether a state transition is permitted under the `LIB-FILE-02A`
 * quarantine receipt state machine.
 */
export function isAllowedLibraryQuarantineLifecycleTransition(
  currentState: LibraryQuarantineReceiptState,
  nextState: LibraryQuarantineReceiptState
): boolean {
  const allowedTargets = LEGAL_NEXT_STATES_BY_CURRENT_STATE[currentState];
  if (!allowedTargets) {
    return false;
  }
  return allowedTargets.has(nextState);
}

/**
 * Validates a persisted Firestore envelope (`schemaVersion`, `revision`, `state`,
 * `receipt`) and verifies that `receipt.receiptId` matches `expectedDocumentId`
 * when provided. Never silently repairs corrupted records.
 */
export function validatePersistedLibraryQuarantineReceiptEnvelope(
  rawEnvelope: unknown,
  expectedDocumentId?: unknown
):
  | {
      readonly ok: true;
      readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
    }
  | LibraryQuarantineReceiptStoreFailure {
  if (
    expectedDocumentId !== undefined &&
    !isValidLibraryQuarantineReceiptId(expectedDocumentId)
  ) {
    return makeStoreFailure(
      'INVALID_RECEIPT_ID',
      'expectedDocumentId must be a valid 32-character lowercase hexadecimal receiptId.'
    );
  }

  if (!isPlainRecord(rawEnvelope)) {
    return makeStoreFailure(
      'CORRUPTED_PERSISTED_RECEIPT',
      'Persisted quarantine receipt envelope must be a plain non-null object.'
    );
  }

  const unexpectedKey = findUnexpectedPropertyOrSymbol(
    rawEnvelope,
    ALLOWED_ENVELOPE_KEYS
  );
  if (unexpectedKey !== null) {
    return makeStoreFailure(
      'UNTRUSTED_STORE_FIELD',
      `Persisted quarantine receipt envelope contains unexpected field "${unexpectedKey}".`
    );
  }

  const { schemaVersion, revision, state, receipt } = rawEnvelope;

  if (schemaVersion !== LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION) {
    return makeStoreFailure(
      'INVALID_SCHEMA_VERSION',
      `Unsupported quarantine receipt envelope schemaVersion "${String(schemaVersion)}"; expected ${LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION}.`
    );
  }

  if (!isPositiveSafeInteger(revision)) {
    return makeStoreFailure(
      'INVALID_REVISION',
      `Envelope revision must be a positive safe integer (>= 1); received "${String(revision)}".`
    );
  }

  const receiptCheck = validateLibraryQuarantineInternalReceipt(receipt);
  if (!receiptCheck.ok) {
    if (receiptCheck.errorCode === 'SECURITY_INVARIANT_VIOLATION') {
      return makeStoreFailure(
        'SECURITY_FLAG_ESCALATION',
        receiptCheck.errorMessage,
        receiptCheck.errorCode
      );
    }
    return makeStoreFailure(
      'CORRUPTED_PERSISTED_RECEIPT',
      `Persisted receipt failed contract validation: ${receiptCheck.errorMessage}`,
      receiptCheck.errorCode
    );
  }

  const validatedReceipt = cloneReceiptRecord(receiptCheck.receipt);

  if (state !== validatedReceipt.state) {
    return makeStoreFailure(
      'ENVELOPE_STATE_MISMATCH',
      `Envelope top-level state "${String(state)}" does not match receipt.state "${validatedReceipt.state}".`
    );
  }

  if (
    expectedDocumentId !== undefined &&
    validatedReceipt.receiptId !== expectedDocumentId
  ) {
    return makeStoreFailure(
      'DOCUMENT_ID_MISMATCH',
      `Persisted receiptId "${validatedReceipt.receiptId}" does not match Firestore document ID "${expectedDocumentId}".`
    );
  }

  const envelope: LibraryQuarantinePersistedReceiptEnvelope = Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision,
    state: validatedReceipt.state,
    receipt: validatedReceipt,
  });

  return Object.freeze({
    ok: true as const,
    envelope,
  });
}

function verifyImmutableReceiptFieldsPreserved(
  current: LibraryQuarantineInternalReceipt,
  next: LibraryQuarantineInternalReceipt
): LibraryQuarantineReceiptStoreFailure | null {
  if (current.receiptId !== next.receiptId) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt receiptId is immutable and cannot be changed.'
    );
  }
  if (current.uploaderUid !== next.uploaderUid) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt uploaderUid is immutable and cannot be changed.'
    );
  }
  if (current.originalFilename !== next.originalFilename) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt originalFilename is immutable and cannot be changed.'
    );
  }
  if (current.sanitizedFilename !== next.sanitizedFilename) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt sanitizedFilename is immutable and cannot be changed.'
    );
  }
  if (current.format !== next.format) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt format is immutable and cannot be changed.'
    );
  }
  if (current.canonicalExtension !== next.canonicalExtension) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt canonicalExtension is immutable and cannot be changed.'
    );
  }
  if (current.canonicalMimeType !== next.canonicalMimeType) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt canonicalMimeType is immutable and cannot be changed.'
    );
  }
  if (current.byteSize !== next.byteSize) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt byteSize is immutable and cannot be changed.'
    );
  }
  if (current.sha256 !== next.sha256) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt sha256 is immutable and cannot be changed.'
    );
  }
  if (current.deepInspectionStatus !== next.deepInspectionStatus) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt deepInspectionStatus is immutable and cannot be changed.'
    );
  }
  if (current.storagePath !== next.storagePath) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt storagePath is immutable and cannot be changed.'
    );
  }
  if (current.createdAt !== next.createdAt) {
    return makeStoreFailure(
      'IMMUTABLE_FIELD_VIOLATION',
      'Receipt createdAt timestamp is immutable and cannot be changed.'
    );
  }
  return null;
}

function verifyReceiptTransitionAndTimestamps(
  current: LibraryQuarantineInternalReceipt,
  next: LibraryQuarantineInternalReceipt
): LibraryQuarantineReceiptStoreFailure | null {
  const immutableViolation = verifyImmutableReceiptFieldsPreserved(
    current,
    next
  );
  if (immutableViolation !== null) {
    return immutableViolation;
  }

  if (
    !isValidIsoUtcTimestamp(current.updatedAt) ||
    !isValidIsoUtcTimestamp(next.updatedAt)
  ) {
    return makeStoreFailure(
      'NON_MONOTONIC_TIMESTAMP',
      'Receipt updatedAt timestamps must be valid ISO-8601 UTC strings.'
    );
  }

  if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) {
    return makeStoreFailure(
      'NON_MONOTONIC_TIMESTAMP',
      `Next receipt updatedAt "${next.updatedAt}" cannot be earlier than current receipt updatedAt "${current.updatedAt}".`
    );
  }

  if (!isAllowedLibraryQuarantineLifecycleTransition(current.state, next.state)) {
    return makeStoreFailure(
      'INVALID_LIFECYCLE_TRANSITION',
      `Illegal quarantine receipt lifecycle transition from "${current.state}" to "${next.state}".`
    );
  }

  return null;
}

/**
 * Dependency-injected Firestore repository for durable library quarantine receipts.
 */
export class FirestoreLibraryQuarantineReceiptStore
  implements LibraryQuarantineReceiptStore
{
  public static readonly COLLECTION = LIBRARY_QUARANTINE_RECEIPT_COLLECTION;
  public static readonly SCHEMA_VERSION =
    LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION;

  private readonly db: LibraryQuarantineFirestoreDatabase;

  constructor(db: LibraryQuarantineFirestoreDatabase) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      throw new Error(
        'INVALID_STORE_DEPENDENCY: FirestoreLibraryQuarantineReceiptStore requires a valid Firestore database adapter with .collection() and .runTransaction().'
      );
    }
    this.db = db;
  }

  private getDocRef(receiptId: string): LibraryQuarantineFirestoreDocumentRef {
    const collectionRef = this.db.collection(
      FirestoreLibraryQuarantineReceiptStore.COLLECTION
    );
    if (!collectionRef || typeof collectionRef.doc !== 'function') {
      throw new Error(
        'INVALID_STORE_DEPENDENCY: Firestore collection adapter must provide .doc(documentId).'
      );
    }
    const docRef = collectionRef.doc(receiptId);
    if (!docRef || docRef.id !== receiptId) {
      throw new Error(
        `DOCUMENT_ID_MISMATCH: Firestore document reference ID "${String(docRef?.id)}" does not match requested receiptId "${receiptId}".`
      );
    }
    return docRef;
  }

  /**
   * Creates a new quarantine receipt document in `Reserved` state at `revision: 1`
   * inside a Firestore transaction.
   *
   * - Rejects any initial receipt that is not in `Reserved` state.
   * - If a document with the same `receiptId` already exists at `revision: 1` with
   *   an identical `LibraryQuarantineInternalReceipt`, returns `IDEMPOTENT_EXISTING`
   *   without rewriting the document.
   * - If an existing document differs in any field or revision, or is corrupted,
   *   fails closed without overwriting.
   */
  public async createReceiptIfAbsent(
    receiptInput: unknown
  ): Promise<CreateLibraryQuarantineReceiptResult> {
    const receiptCheck = validateLibraryQuarantineInternalReceipt(receiptInput);
    if (!receiptCheck.ok) {
      if (receiptCheck.errorCode === 'SECURITY_INVARIANT_VIOLATION') {
        return makeStoreFailure(
          'SECURITY_FLAG_ESCALATION',
          receiptCheck.errorMessage,
          receiptCheck.errorCode
        );
      }
      if (receiptCheck.errorCode === 'INVALID_RECEIPT_ID') {
        return makeStoreFailure(
          'INVALID_RECEIPT_ID',
          receiptCheck.errorMessage,
          receiptCheck.errorCode
        );
      }
      if (receiptCheck.errorCode === 'UNTRUSTED_CALLER_FIELD') {
        return makeStoreFailure(
          'UNTRUSTED_STORE_FIELD',
          receiptCheck.errorMessage,
          receiptCheck.errorCode
        );
      }
      return makeStoreFailure(
        'INVALID_STORE_INPUT',
        receiptCheck.errorMessage,
        receiptCheck.errorCode
      );
    }

    const candidateReceipt = cloneReceiptRecord(receiptCheck.receipt);

    if (candidateReceipt.state !== LibraryQuarantineReceiptState.Reserved) {
      return makeStoreFailure(
        'INVALID_INITIAL_STATE',
        `createReceiptIfAbsent requires a receipt in "Reserved" state; received "${candidateReceipt.state}".`
      );
    }

    let docRef: LibraryQuarantineFirestoreDocumentRef;
    try {
      docRef = this.getDocRef(candidateReceipt.receiptId);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Invalid Firestore document ref.';
      return makeStoreFailure('INVALID_STORE_DEPENDENCY', msg);
    }

    try {
      return await this.db.runTransaction(async (transaction) => {
        if (!transaction || typeof transaction.get !== 'function' || typeof transaction.set !== 'function') {
          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'INVALID_STORE_DEPENDENCY',
              'Firestore transaction adapter must provide .get() and .set().'
            )
          );
        }

        const snapshot = await transaction.get(docRef);

        if (snapshot && snapshot.exists) {
          if (
            snapshot.id !== undefined &&
            snapshot.id !== candidateReceipt.receiptId
          ) {
            throw new InternalStoreTransactionAbortError(
              makeStoreFailure(
                'DOCUMENT_ID_MISMATCH',
                `Existing Firestore snapshot ID "${snapshot.id}" does not match receiptId "${candidateReceipt.receiptId}".`
              )
            );
          }

          const persistedCheck =
            validatePersistedLibraryQuarantineReceiptEnvelope(
              snapshot.data(),
              candidateReceipt.receiptId
            );
          if (!persistedCheck.ok) {
            throw new InternalStoreTransactionAbortError(persistedCheck);
          }

          const persistedEnvelope = persistedCheck.envelope;

          if (
            persistedEnvelope.revision === 1 &&
            areLibraryQuarantineReceiptsEqual(
              persistedEnvelope.receipt,
              candidateReceipt
            )
          ) {
            const dtoCheck = toSanitizedLibraryQuarantineAdminReceiptDto(
              persistedEnvelope.receipt
            );
            if (!dtoCheck.ok) {
              throw new InternalStoreTransactionAbortError(
                makeStoreFailure(
                  'CORRUPTED_PERSISTED_RECEIPT',
                  dtoCheck.errorMessage,
                  dtoCheck.errorCode
                )
              );
            }

            return Object.freeze({
              ok: true as const,
              disposition: 'IDEMPOTENT_EXISTING' as const,
              created: false,
              envelope: persistedEnvelope,
              adminReceiptDto: dtoCheck.dto,
            });
          }

          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'RECEIPT_ALREADY_EXISTS_CONFLICT',
              `Quarantine receipt "${candidateReceipt.receiptId}" already exists with conflicting state or content and cannot be overwritten.`
            )
          );
        }

        const initialEnvelope: LibraryQuarantinePersistedReceiptEnvelope =
          Object.freeze({
            schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
            revision: 1,
            state: candidateReceipt.state,
            receipt: candidateReceipt,
          });

        const dtoCheck =
          toSanitizedLibraryQuarantineAdminReceiptDto(candidateReceipt);
        if (!dtoCheck.ok) {
          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'INVALID_STORE_INPUT',
              dtoCheck.errorMessage,
              dtoCheck.errorCode
            )
          );
        }

        const serialized = serializeEnvelopeForFirestore(initialEnvelope);
        if (typeof transaction.create === 'function') {
          transaction.create(docRef, serialized);
        } else {
          transaction.set(docRef, serialized);
        }

        return Object.freeze({
          ok: true as const,
          disposition: 'CREATED' as const,
          created: true,
          envelope: initialEnvelope,
          adminReceiptDto: dtoCheck.dto,
        });
      });
    } catch (err) {
      if (err instanceof InternalStoreTransactionAbortError) {
        return err.failure;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Unknown Firestore transaction error during createReceiptIfAbsent.';
      return makeStoreFailure(
        'TRANSACTION_FAILURE',
        `Firestore transaction failed during createReceiptIfAbsent: ${msg}`
      );
    }
  }

  /**
   * Reads a single quarantine receipt by its validated 32-character lowercase
   * hex `receiptId` and validates the entire persisted envelope.
   *
   * Never performs collection scans or silently repairs corrupted data.
   */
  public async getReceiptById(
    receiptId: unknown
  ): Promise<GetLibraryQuarantineReceiptResult> {
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeStoreFailure(
        'INVALID_RECEIPT_ID',
        'receiptId must be a valid 32-character lowercase hexadecimal string.'
      );
    }

    let docRef: LibraryQuarantineFirestoreDocumentRef;
    try {
      docRef = this.getDocRef(receiptId);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Invalid Firestore document ref.';
      return makeStoreFailure('INVALID_STORE_DEPENDENCY', msg);
    }

    try {
      let snapshot: LibraryQuarantineFirestoreDocumentSnapshot;
      if (typeof docRef.get === 'function') {
        snapshot = await docRef.get();
      } else {
        snapshot = await this.db.runTransaction(async (transaction) => {
          if (!transaction || typeof transaction.get !== 'function') {
            throw new InternalStoreTransactionAbortError(
              makeStoreFailure(
                'INVALID_STORE_DEPENDENCY',
                'Firestore transaction adapter must provide .get().'
              )
            );
          }
          return transaction.get(docRef);
        });
      }

      if (!snapshot || !snapshot.exists) {
        return makeStoreFailure(
          'RECEIPT_NOT_FOUND',
          `Quarantine receipt "${receiptId}" was not found.`
        );
      }

      if (snapshot.id !== undefined && snapshot.id !== receiptId) {
        return makeStoreFailure(
          'DOCUMENT_ID_MISMATCH',
          `Firestore document snapshot ID "${snapshot.id}" does not match requested receiptId "${receiptId}".`
        );
      }

      const persistedCheck =
        validatePersistedLibraryQuarantineReceiptEnvelope(
          snapshot.data(),
          receiptId
        );
      if (!persistedCheck.ok) {
        return persistedCheck;
      }

      const dtoCheck = toSanitizedLibraryQuarantineAdminReceiptDto(
        persistedCheck.envelope.receipt
      );
      if (!dtoCheck.ok) {
        return makeStoreFailure(
          'CORRUPTED_PERSISTED_RECEIPT',
          dtoCheck.errorMessage,
          dtoCheck.errorCode
        );
      }

      return Object.freeze({
        ok: true as const,
        envelope: persistedCheck.envelope,
        adminReceiptDto: dtoCheck.dto,
      });
    } catch (err) {
      if (err instanceof InternalStoreTransactionAbortError) {
        return err.failure;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Unknown Firestore error during getReceiptById.';
      return makeStoreFailure(
        'TRANSACTION_FAILURE',
        `Firestore read failed during getReceiptById: ${msg}`
      );
    }
  }

  /**
   * Performs an atomic compare-and-swap (CAS) lifecycle mutation inside a
   * Firestore transaction.
   *
   * - Reads the stored envelope first inside the transaction.
   * - Verifies `persisted.revision === expectedRevision`.
   * - Verifies exact field-by-field match between `persisted.receipt` and
   *   `expectedCurrentReceipt`.
   * - Verifies immutable identity, hash, size, format, and canonical storage path.
   * - Verifies the transition is allowed by `LIB-FILE-02A` and timestamps are
   *   non-decreasing.
   * - Writes `revision: expectedRevision + 1` and `state: nextReceipt.state`.
   */
  public async compareAndSwapReceipt(
    rawInput: unknown
  ): Promise<CompareAndSwapLibraryQuarantineReceiptResult> {
    if (!isPlainRecord(rawInput)) {
      return makeStoreFailure(
        'INVALID_STORE_INPUT',
        'compareAndSwapReceipt input must be a plain non-null object.'
      );
    }

    const unexpectedKey = findUnexpectedPropertyOrSymbol(
      rawInput,
      ALLOWED_CAS_INPUT_KEYS
    );
    if (unexpectedKey !== null) {
      return makeStoreFailure(
        'UNTRUSTED_STORE_FIELD',
        `Unexpected field "${unexpectedKey}" in compareAndSwapReceipt input.`
      );
    }

    const {
      receiptId,
      expectedRevision,
      expectedCurrentReceipt,
      nextReceipt,
    } = rawInput;

    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeStoreFailure(
        'INVALID_RECEIPT_ID',
        'compareAndSwapReceipt receiptId must be a valid 32-character lowercase hexadecimal string.'
      );
    }

    if (!isPositiveSafeInteger(expectedRevision)) {
      return makeStoreFailure(
        'INVALID_REVISION',
        `expectedRevision must be a positive safe integer (>= 1); received "${String(expectedRevision)}".`
      );
    }

    const nextRevision = expectedRevision + 1;
    if (!Number.isSafeInteger(nextRevision)) {
      return makeStoreFailure(
        'INVALID_REVISION',
        'expectedRevision is at Number.MAX_SAFE_INTEGER and cannot be safely incremented.'
      );
    }

    const expectedCurrentCheck = validateLibraryQuarantineInternalReceipt(
      expectedCurrentReceipt
    );
    if (!expectedCurrentCheck.ok) {
      if (expectedCurrentCheck.errorCode === 'SECURITY_INVARIANT_VIOLATION') {
        return makeStoreFailure(
          'SECURITY_FLAG_ESCALATION',
          expectedCurrentCheck.errorMessage,
          expectedCurrentCheck.errorCode
        );
      }
      return makeStoreFailure(
        'INVALID_STORE_INPUT',
        `expectedCurrentReceipt is invalid: ${expectedCurrentCheck.errorMessage}`,
        expectedCurrentCheck.errorCode
      );
    }

    const nextReceiptCheck =
      validateLibraryQuarantineInternalReceipt(nextReceipt);
    if (!nextReceiptCheck.ok) {
      if (nextReceiptCheck.errorCode === 'SECURITY_INVARIANT_VIOLATION') {
        return makeStoreFailure(
          'SECURITY_FLAG_ESCALATION',
          nextReceiptCheck.errorMessage,
          nextReceiptCheck.errorCode
        );
      }
      return makeStoreFailure(
        'INVALID_STORE_INPUT',
        `nextReceipt is invalid: ${nextReceiptCheck.errorMessage}`,
        nextReceiptCheck.errorCode
      );
    }

    const validatedExpectedCurrent = cloneReceiptRecord(
      expectedCurrentCheck.receipt
    );
    const validatedNext = cloneReceiptRecord(nextReceiptCheck.receipt);

    if (validatedExpectedCurrent.receiptId !== receiptId) {
      return makeStoreFailure(
        'DOCUMENT_ID_MISMATCH',
        `expectedCurrentReceipt.receiptId "${validatedExpectedCurrent.receiptId}" does not match receiptId "${receiptId}".`
      );
    }

    if (validatedNext.receiptId !== receiptId) {
      return makeStoreFailure(
        'IMMUTABLE_FIELD_VIOLATION',
        `nextReceipt.receiptId "${validatedNext.receiptId}" does not match receiptId "${receiptId}".`
      );
    }

    const preflightTransitionErr = verifyReceiptTransitionAndTimestamps(
      validatedExpectedCurrent,
      validatedNext
    );
    if (preflightTransitionErr !== null) {
      return preflightTransitionErr;
    }

    let docRef: LibraryQuarantineFirestoreDocumentRef;
    try {
      docRef = this.getDocRef(receiptId);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Invalid Firestore document ref.';
      return makeStoreFailure('INVALID_STORE_DEPENDENCY', msg);
    }

    try {
      return await this.db.runTransaction(async (transaction) => {
        if (
          !transaction ||
          typeof transaction.get !== 'function' ||
          typeof transaction.set !== 'function'
        ) {
          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'INVALID_STORE_DEPENDENCY',
              'Firestore transaction adapter must provide .get() and .set().'
            )
          );
        }

        const snapshot = await transaction.get(docRef);

        if (!snapshot || !snapshot.exists) {
          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'RECEIPT_NOT_FOUND',
              `Quarantine receipt "${receiptId}" does not exist.`
            )
          );
        }

        if (snapshot.id !== undefined && snapshot.id !== receiptId) {
          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'DOCUMENT_ID_MISMATCH',
              `Stored Firestore snapshot ID "${snapshot.id}" does not match receiptId "${receiptId}".`
            )
          );
        }

        const persistedCheck =
          validatePersistedLibraryQuarantineReceiptEnvelope(
            snapshot.data(),
            receiptId
          );
        if (!persistedCheck.ok) {
          throw new InternalStoreTransactionAbortError(persistedCheck);
        }

        const persistedEnvelope = persistedCheck.envelope;

        if (persistedEnvelope.revision !== expectedRevision) {
          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'REVISION_CONFLICT',
              `CAS revision conflict for receipt "${receiptId}": expected revision ${expectedRevision}, found stored revision ${persistedEnvelope.revision}.`
            )
          );
        }

        if (
          !areLibraryQuarantineReceiptsEqual(
            persistedEnvelope.receipt,
            validatedExpectedCurrent
          )
        ) {
          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'CURRENT_RECEIPT_MISMATCH',
              `CAS current-state mismatch for receipt "${receiptId}": stored receipt does not match expectedCurrentReceipt.`
            )
          );
        }

        const authoritativeTransitionErr = verifyReceiptTransitionAndTimestamps(
          persistedEnvelope.receipt,
          validatedNext
        );
        if (authoritativeTransitionErr !== null) {
          throw new InternalStoreTransactionAbortError(
            authoritativeTransitionErr
          );
        }

        const nextEnvelope: LibraryQuarantinePersistedReceiptEnvelope =
          Object.freeze({
            schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
            revision: nextRevision,
            state: validatedNext.state,
            receipt: validatedNext,
          });

        const dtoCheck =
          toSanitizedLibraryQuarantineAdminReceiptDto(validatedNext);
        if (!dtoCheck.ok) {
          throw new InternalStoreTransactionAbortError(
            makeStoreFailure(
              'INVALID_STORE_INPUT',
              dtoCheck.errorMessage,
              dtoCheck.errorCode
            )
          );
        }

        const serialized = serializeEnvelopeForFirestore(nextEnvelope);
        transaction.set(docRef, serialized);

        return Object.freeze({
          ok: true as const,
          envelope: nextEnvelope,
          adminReceiptDto: dtoCheck.dto,
        });
      });
    } catch (err) {
      if (err instanceof InternalStoreTransactionAbortError) {
        return err.failure;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Unknown Firestore transaction error during compareAndSwapReceipt.';
      return makeStoreFailure(
        'TRANSACTION_FAILURE',
        `Firestore transaction failed during compareAndSwapReceipt: ${msg}`
      );
    }
  }
}
