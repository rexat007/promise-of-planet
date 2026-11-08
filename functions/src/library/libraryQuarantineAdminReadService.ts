import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  validatePersistedLibraryQuarantineReceiptEnvelope,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  isValidLibraryQuarantineReceiptId,
  toSanitizedLibraryQuarantineAdminReceiptDto,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';

/**
 * LIB-FILE-INBOX-01 — Private Quarantine Receipts Read-Only Administrative Service
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Dedicated read-only query service for `library_quarantine_receipts` that preserves
 *   `FirestoreLibraryQuarantineReceiptStore` as a strict point-lookup/CAS repository.
 * - Executes ONLY bounded queries ordered by `receipt.createdAt` descending with a hard
 *   limit of 20 records (`LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT = 20`).
 * - Never performs an unbounded `.get()` collection scan, never writes to Firestore,
 *   never reads or writes Google Cloud Storage objects, never generates download URLs
 *   or signed tokens, and never mutates `library_intake`, `library_documents`, or PEIA.
 * - Every returned document snapshot is validated fail-closed:
 *   1. Document ID (`doc.id`) must be a valid 32-char lowercase hex `receiptId` and match
 *      `envelope.receipt.receiptId`.
 *   2. Persisted envelope is validated via `validatePersistedLibraryQuarantineReceiptEnvelope`.
 *   3. Internal receipt is converted strictly via `toSanitizedLibraryQuarantineAdminReceiptDto`,
 *      redacting `storagePath`, `generation`, and all internal storage identifiers.
 *   4. Any corrupt or invalid document fails closed immediately without silently skipping,
 *      repairing, or deleting records.
 */

export const LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT = 20 as const;
export const LIBRARY_QUARANTINE_RECEIPT_CREATED_AT_ORDER_FIELD =
  'receipt.createdAt' as const;
export const LIBRARY_QUARANTINE_RECEIPT_ORDER_DIRECTION = 'desc' as const;

export type LibraryQuarantineAdminReadErrorCode =
  | 'INVALID_DATABASE_ADAPTER'
  | 'FIRESTORE_QUERY_FAILED'
  | 'UNBOUNDED_QUERY_RESULT_REJECTED'
  | 'INVALID_QUERY_DOCUMENT_ID'
  | 'CORRUPT_PERSISTED_RECEIPT_ENVELOPE'
  | 'SANITIZATION_INVARIANT_FAILED';

export interface SanitizedLibraryQuarantineReceiptListItemDto {
  readonly revision: number;
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
}

export interface ListLibraryQuarantineReceiptsResponseDto {
  readonly receipts: readonly SanitizedLibraryQuarantineReceiptListItemDto[];
}

export interface LibraryQuarantineAdminReadSuccess {
  readonly ok: true;
  readonly response: ListLibraryQuarantineReceiptsResponseDto;
}

export interface LibraryQuarantineAdminReadFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineAdminReadErrorCode;
  readonly errorMessage: string;
  readonly offendingDocumentId?: string;
}

export type LibraryQuarantineAdminReadResult =
  | LibraryQuarantineAdminReadSuccess
  | LibraryQuarantineAdminReadFailure;

export interface LibraryQuarantineAdminReadQueryDocumentSnapshot {
  readonly id: string;
  data(): unknown;
}

export interface LibraryQuarantineAdminReadQuerySnapshot {
  readonly docs: readonly LibraryQuarantineAdminReadQueryDocumentSnapshot[];
}

export interface LibraryQuarantineAdminReadLimitedQuery {
  get(): Promise<LibraryQuarantineAdminReadQuerySnapshot>;
}

export interface LibraryQuarantineAdminReadOrderedQuery {
  limit(limit: number): LibraryQuarantineAdminReadLimitedQuery;
}

export interface LibraryQuarantineAdminReadCollectionReference {
  orderBy(
    fieldPath: string,
    directionStr?: 'asc' | 'desc'
  ): LibraryQuarantineAdminReadOrderedQuery;
}

export interface LibraryQuarantineAdminReadFirestoreDatabase {
  collection(
    collectionPath: string
  ): LibraryQuarantineAdminReadCollectionReference;
}

function makeReadFailure(
  errorCode: LibraryQuarantineAdminReadErrorCode,
  errorMessage: string,
  offendingDocumentId?: string
): LibraryQuarantineAdminReadFailure {
  const base: LibraryQuarantineAdminReadFailure =
    offendingDocumentId !== undefined
      ? {
          ok: false,
          errorCode,
          errorMessage,
          offendingDocumentId,
        }
      : {
          ok: false,
          errorCode,
          errorMessage,
        };
  return Object.freeze(base);
}

function isReadFirestoreDatabase(
  candidate: unknown
): candidate is LibraryQuarantineAdminReadFirestoreDatabase {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const db = candidate as Partial<LibraryQuarantineAdminReadFirestoreDatabase>;
  return typeof db.collection === 'function';
}

/**
 * Reads the latest 20 private quarantine receipts from `library_quarantine_receipts`,
 * validates each persisted envelope fail-closed, and returns only sanitized
 * administrative receipt DTOs (`{ receipts: [{ revision, adminReceipt }] }`).
 */
export async function listLatestSanitizedLibraryQuarantineReceipts(
  db: unknown
): Promise<LibraryQuarantineAdminReadResult> {
  if (!isReadFirestoreDatabase(db)) {
    return makeReadFailure(
      'INVALID_DATABASE_ADAPTER',
      'Quarantine receipt read service requires a valid Firestore database adapter with collection().'
    );
  }

  let snapshot: LibraryQuarantineAdminReadQuerySnapshot;
  try {
    const collectionRef = db.collection(LIBRARY_QUARANTINE_RECEIPT_COLLECTION);
    if (
      typeof collectionRef !== 'object' ||
      collectionRef === null ||
      typeof collectionRef.orderBy !== 'function'
    ) {
      return makeReadFailure(
        'INVALID_DATABASE_ADAPTER',
        `Collection reference for "${LIBRARY_QUARANTINE_RECEIPT_COLLECTION}" must support bounded orderBy() queries.`
      );
    }

    const orderedQuery = collectionRef.orderBy(
      LIBRARY_QUARANTINE_RECEIPT_CREATED_AT_ORDER_FIELD,
      LIBRARY_QUARANTINE_RECEIPT_ORDER_DIRECTION
    );
    if (
      typeof orderedQuery !== 'object' ||
      orderedQuery === null ||
      typeof orderedQuery.limit !== 'function'
    ) {
      return makeReadFailure(
        'INVALID_DATABASE_ADAPTER',
        'Quarantine receipt query must support hard limit(20) before get().'
      );
    }

    const limitedQuery = orderedQuery.limit(LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT);
    if (
      typeof limitedQuery !== 'object' ||
      limitedQuery === null ||
      typeof limitedQuery.get !== 'function'
    ) {
      return makeReadFailure(
        'INVALID_DATABASE_ADAPTER',
        'Quarantine receipt bounded query must provide get().'
      );
    }

    snapshot = await limitedQuery.get();
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return makeReadFailure(
      'FIRESTORE_QUERY_FAILED',
      `Failed to execute bounded query on "${LIBRARY_QUARANTINE_RECEIPT_COLLECTION}": ${detail}`
    );
  }

  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    !Array.isArray(snapshot.docs)
  ) {
    return makeReadFailure(
      'FIRESTORE_QUERY_FAILED',
      'Firestore query snapshot is missing a valid docs array.'
    );
  }

  if (snapshot.docs.length > LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT) {
    return makeReadFailure(
      'UNBOUNDED_QUERY_RESULT_REJECTED',
      `Query returned ${snapshot.docs.length} documents, exceeding hard limit ${LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT}.`
    );
  }

  const sanitizedItems: SanitizedLibraryQuarantineReceiptListItemDto[] = [];
  const seenReceiptIds = new Set<string>();

  for (const docSnap of snapshot.docs) {
    if (
      typeof docSnap !== 'object' ||
      docSnap === null ||
      typeof docSnap.id !== 'string' ||
      typeof docSnap.data !== 'function'
    ) {
      return makeReadFailure(
        'CORRUPT_PERSISTED_RECEIPT_ENVELOPE',
        'Query snapshot contains a malformed document snapshot entry.'
      );
    }

    const docId = docSnap.id;
    if (!isValidLibraryQuarantineReceiptId(docId)) {
      return makeReadFailure(
        'INVALID_QUERY_DOCUMENT_ID',
        `Persisted quarantine receipt document ID "${docId}" is not a valid 32-character lowercase hexadecimal receiptId.`,
        docId
      );
    }

    if (seenReceiptIds.has(docId)) {
      return makeReadFailure(
        'CORRUPT_PERSISTED_RECEIPT_ENVELOPE',
        `Duplicate quarantine receipt document ID "${docId}" encountered in query result.`,
        docId
      );
    }
    seenReceiptIds.add(docId);

    const rawData = docSnap.data();
    const envelopeValidation = validatePersistedLibraryQuarantineReceiptEnvelope(
      rawData,
      docId
    );
    if (!envelopeValidation.ok) {
      return makeReadFailure(
        'CORRUPT_PERSISTED_RECEIPT_ENVELOPE',
        `Persisted quarantine receipt "${docId}" failed envelope validation (${envelopeValidation.errorCode}): ${envelopeValidation.errorMessage}`,
        docId
      );
    }

    if (envelopeValidation.envelope.receipt.receiptId !== docId) {
      return makeReadFailure(
        'CORRUPT_PERSISTED_RECEIPT_ENVELOPE',
        `Persisted quarantine receipt "${docId}" has mismatched internal receiptId "${envelopeValidation.envelope.receipt.receiptId}".`,
        docId
      );
    }

    const sanitizedResult = toSanitizedLibraryQuarantineAdminReceiptDto(
      envelopeValidation.envelope.receipt
    );
    if (!sanitizedResult.ok) {
      return makeReadFailure(
        'SANITIZATION_INVARIANT_FAILED',
        `Persisted quarantine receipt "${docId}" failed sanitization conversion (${sanitizedResult.errorCode}): ${sanitizedResult.errorMessage}`,
        docId
      );
    }

    sanitizedItems.push(
      Object.freeze({
        revision: envelopeValidation.envelope.revision,
        adminReceipt: sanitizedResult.dto,
      })
    );
  }

  return Object.freeze({
    ok: true as const,
    response: Object.freeze({
      receipts: Object.freeze(sanitizedItems),
    }),
  });
}
