import {
  LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT,
  listLatestSanitizedLibraryQuarantineReceipts,
  type LibraryQuarantineAdminReadFirestoreDatabase,
  type LibraryQuarantineAdminReadResult,
  type SanitizedLibraryQuarantineReceiptListItemDto,
} from './libraryQuarantineAdminReadService';
import {
  LibraryQuarantineReceiptState,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';
import {
  FirestoreLibraryQuarantineReviewDraftStore,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
  validatePersistedLibraryQuarantineReviewDraft,
  type GetLibraryQuarantineReviewDraftResult,
  type LibraryQuarantinePersistedReviewDraft,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftStore,
} from './firestoreLibraryQuarantineReviewDraftStore';

/**
 * LIB-FILE-WORKBENCH-01 — Server-Only Quarantine Review Workbench Read Composition Service
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Composes the bounded latest-20 private quarantine receipts read
 *   (`listLatestSanitizedLibraryQuarantineReceipts`) with point-lookup draft
 *   status resolution (`getReviewDraftByReceiptId`) on
 *   `library_quarantine_review_drafts/<receiptId>`.
 * - Performs ZERO unbounded collection scans and ZERO Google Cloud Storage reads.
 * - Reads at most 20 latest receipts once (`LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT = 20`).
 * - Performs at most ONE point lookup of `library_quarantine_review_drafts/<receiptId>`
 *   per eligible `Quarantined` receipt, and ZERO draft lookups for
 *   `NeedsReconciliation`, `Reserved`, `WritePending`, or `Rejected` receipts.
 * - Fails the ENTIRE response (`ok: false`) if the receipt read fails, if any
 *   draft lookup fails with a store/validation error, or if any persisted draft
 *   fails 15-field schema validation, security posture checks, or exact source
 *   identity/version consistency (`receiptId`, `sourceRevision`, `sourceUpdatedAt`,
 *   `sourceSha256`, `format`, `uploaderUid`) against its sanitized receipt.
 *   Never silently skips corrupted items and never fakes `NOT_LINKED` on store
 *   or infrastructure failures.
 * - Exposes only the already-sanitized `adminReceipt` DTO, `revision`, and
 *   `draftStatus` (`'NOT_LINKED' | 'PENDING_HUMAN_REVIEW' | 'NEEDS_RECONCILIATION_HOLD' | 'NOT_ELIGIBLE'`).
 *   Never exposes raw persisted draft records, `createdBy`, `storagePath`,
 *   `generation`, bucket names, signed URLs, or raw exception strings.
 */

export const LIBRARY_QUARANTINE_WORKBENCH_LIST_LIMIT =
  LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT;

export type LibraryQuarantineReviewWorkbenchDraftStatus =
  | 'NOT_LINKED'
  | 'PENDING_HUMAN_REVIEW'
  | 'NEEDS_RECONCILIATION_HOLD'
  | 'NOT_ELIGIBLE';

export const ALLOWED_LIBRARY_QUARANTINE_WORKBENCH_DRAFT_STATUSES: ReadonlySet<LibraryQuarantineReviewWorkbenchDraftStatus> =
  new Set([
    'NOT_LINKED',
    'PENDING_HUMAN_REVIEW',
    'NEEDS_RECONCILIATION_HOLD',
    'NOT_ELIGIBLE',
  ]);

export type LibraryQuarantineReviewWorkbenchReadErrorCode =
  | 'INVALID_WORKBENCH_DEPENDENCY'
  | 'RECEIPT_LIST_READ_FAILED'
  | 'RECEIPT_LIST_INVARIANT_VIOLATION'
  | 'DRAFT_LOOKUP_FAILED'
  | 'CORRUPTED_PERSISTED_DRAFT'
  | 'DRAFT_SOURCE_MISMATCH'
  | 'SECURITY_POSTURE_VIOLATION';

export interface SanitizedLibraryQuarantineReviewWorkbenchItemDto {
  readonly revision: number;
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly draftStatus: LibraryQuarantineReviewWorkbenchDraftStatus;
}

export interface ListLibraryQuarantineReviewWorkbenchResponseDto {
  readonly receipts: readonly SanitizedLibraryQuarantineReviewWorkbenchItemDto[];
}

export interface ListLibraryQuarantineReviewWorkbenchSuccess {
  readonly ok: true;
  readonly receipts: readonly SanitizedLibraryQuarantineReviewWorkbenchItemDto[];
}

export interface ListLibraryQuarantineReviewWorkbenchFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineReviewWorkbenchReadErrorCode;
  readonly errorMessage: string;
}

export type ListLibraryQuarantineReviewWorkbenchResult =
  | ListLibraryQuarantineReviewWorkbenchSuccess
  | ListLibraryQuarantineReviewWorkbenchFailure;

export type LibraryQuarantineReviewDraftReadOnlyLookupPort = Pick<
  LibraryQuarantineReviewDraftStore,
  'getReviewDraftByReceiptId'
>;

export interface LibraryQuarantineReviewWorkbenchReadDependencies {
  readonly receiptReadDatabase?: LibraryQuarantineAdminReadFirestoreDatabase;
  readonly draftDatabase?: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly listReceiptsFn?: () => Promise<LibraryQuarantineAdminReadResult>;
  readonly draftStore?: LibraryQuarantineReviewDraftReadOnlyLookupPort;
}

const WORKBENCH_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineReviewWorkbenchReadErrorCode, string>
> = Object.freeze({
  INVALID_WORKBENCH_DEPENDENCY:
    'Quarantine review workbench read dependencies are missing or invalid.',
  RECEIPT_LIST_READ_FAILED:
    'Failed to read latest sanitized quarantine receipts for the review workbench.',
  RECEIPT_LIST_INVARIANT_VIOLATION:
    'Quarantine receipt list response violated workbench cardinality, uniqueness, or sanitization invariants.',
  DRAFT_LOOKUP_FAILED:
    'Point lookup of quarantine review draft failed; refusing to synthesize link status.',
  CORRUPTED_PERSISTED_DRAFT:
    'Persisted quarantine review draft failed strict schema validation.',
  DRAFT_SOURCE_MISMATCH:
    'Persisted quarantine review draft does not match the authoritative source receipt identity or revision.',
  SECURITY_POSTURE_VIOLATION:
    'Quarantine receipt or persisted review draft violated non-assurance security posture invariants.',
});

const SHA256_LOWERCASE_HEX_REGEX = /^[0-9a-f]{64}$/;

const ALLOWED_SANITIZED_ADMIN_RECEIPT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'uploaderUid',
  'originalFilename',
  'sanitizedFilename',
  'format',
  'canonicalExtension',
  'canonicalMimeType',
  'byteSize',
  'sha256',
  'state',
  'deepInspectionStatus',
  'hasVerifiedStorageWrite',
  'reconciliationRequired',
  'reconciliationReason',
  'rejectionReasonCode',
  'createdAt',
  'updatedAt',
  'isQuarantinedPrivateOnly',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const FORBIDDEN_PRIVATE_RECEIPT_OR_DRAFT_KEYS: ReadonlySet<string> = new Set([
  'storagePath',
  'generation',
  'attestedGeneration',
  'attestedStoragePath',
  'attestation',
  'bucket',
  'signedUrl',
  'downloadUrl',
  'mediaLink',
  'downloadTokens',
  'rawBytes',
  'bytes',
  'createdBy',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function makeWorkbenchFailure(
  errorCode: LibraryQuarantineReviewWorkbenchReadErrorCode
): ListLibraryQuarantineReviewWorkbenchFailure {
  return Object.freeze({
    ok: false as const,
    errorCode,
    errorMessage: WORKBENCH_SAFE_MESSAGES[errorCode],
  });
}

function hasForbiddenPrivateLeak(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return (
      lower.includes('library/quarantine/') ||
      lower.includes('library-quarantine/') ||
      lower.includes('gs://') ||
      lower.includes('https://storage.googleapis.com') ||
      lower.includes('firebasestorage.googleapis.com')
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenPrivateLeak(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return true;
    }
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (FORBIDDEN_PRIVATE_RECEIPT_OR_DRAFT_KEYS.has(key)) {
        return true;
      }
      if (hasForbiddenPrivateLeak(nested, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function validateSanitizedReceiptItemForWorkbench(
  item: unknown
): SanitizedLibraryQuarantineReceiptListItemDto | null {
  if (!isPlainObject(item)) {
    return null;
  }
  if (Object.getOwnPropertySymbols(item).length > 0) {
    return null;
  }
  const itemKeys = Object.keys(item);
  if (
    itemKeys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(item, 'revision') ||
    !Object.prototype.hasOwnProperty.call(item, 'adminReceipt')
  ) {
    return null;
  }

  const revision = item.revision;
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    return null;
  }

  const adminReceipt = item.adminReceipt;
  if (!isPlainObject(adminReceipt)) {
    return null;
  }
  if (Object.getOwnPropertySymbols(adminReceipt).length > 0) {
    return null;
  }

  const receiptKeys = Object.keys(adminReceipt);
  if (receiptKeys.length !== ALLOWED_SANITIZED_ADMIN_RECEIPT_KEYS.size) {
    return null;
  }
  for (const key of receiptKeys) {
    if (!ALLOWED_SANITIZED_ADMIN_RECEIPT_KEYS.has(key)) {
      return null;
    }
  }

  if (hasForbiddenPrivateLeak(item)) {
    return null;
  }

  const {
    receiptId,
    uploaderUid,
    originalFilename,
    sanitizedFilename,
    format,
    canonicalExtension,
    canonicalMimeType,
    byteSize,
    sha256,
    state,
    deepInspectionStatus,
    hasVerifiedStorageWrite,
    reconciliationRequired,
    reconciliationReason,
    rejectionReasonCode,
    createdAt,
    updatedAt,
    isQuarantinedPrivateOnly,
    isSanitized,
    isVerifiedSafe,
    isRightsApproved,
    isPublished,
    isReadyForPeia,
  } = adminReceipt;

  if (
    !isValidLibraryQuarantineReceiptId(receiptId) ||
    !isValidUploaderUid(uploaderUid) ||
    typeof originalFilename !== 'string' ||
    originalFilename.trim().length === 0 ||
    typeof sanitizedFilename !== 'string' ||
    sanitizedFilename.trim().length === 0 ||
    (format !== 'PDF' && format !== 'DOCX') ||
    typeof byteSize !== 'number' ||
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > 15_000_000 ||
    typeof sha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(sha256) ||
    !isValidIsoUtcTimestamp(createdAt) ||
    !isValidIsoUtcTimestamp(updatedAt) ||
    Date.parse(updatedAt) < Date.parse(createdAt)
  ) {
    return null;
  }

  const expectedExt = format === 'PDF' ? 'pdf' : 'docx';
  const expectedMime =
    format === 'PDF'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const expectedInspection =
    format === 'PDF'
      ? 'PDF_REQUIRES_ISOLATED_PARSER'
      : 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';

  if (
    canonicalExtension !== expectedExt ||
    canonicalMimeType !== expectedMime ||
    deepInspectionStatus !== expectedInspection
  ) {
    return null;
  }

  if (
    isSanitized !== false ||
    isVerifiedSafe !== false ||
    isRightsApproved !== false ||
    isPublished !== false ||
    isReadyForPeia !== false
  ) {
    return null;
  }

  if (state === LibraryQuarantineReceiptState.Quarantined) {
    if (
      hasVerifiedStorageWrite !== true ||
      isQuarantinedPrivateOnly !== true ||
      reconciliationRequired !== false ||
      reconciliationReason !== null ||
      rejectionReasonCode !== null
    ) {
      return null;
    }
  } else if (state === LibraryQuarantineReceiptState.NeedsReconciliation) {
    if (
      hasVerifiedStorageWrite !== false ||
      isQuarantinedPrivateOnly !== false ||
      reconciliationRequired !== true ||
      typeof reconciliationReason !== 'string' ||
      reconciliationReason.trim().length === 0 ||
      rejectionReasonCode !== null
    ) {
      return null;
    }
  } else if (state === LibraryQuarantineReceiptState.Rejected) {
    if (
      hasVerifiedStorageWrite !== false ||
      isQuarantinedPrivateOnly !== false ||
      reconciliationRequired !== false ||
      reconciliationReason !== null ||
      typeof rejectionReasonCode !== 'string' ||
      rejectionReasonCode.trim().length === 0
    ) {
      return null;
    }
  } else if (
    state === LibraryQuarantineReceiptState.Reserved ||
    state === LibraryQuarantineReceiptState.WritePending
  ) {
    if (
      hasVerifiedStorageWrite !== false ||
      isQuarantinedPrivateOnly !== false ||
      reconciliationRequired !== false ||
      reconciliationReason !== null ||
      rejectionReasonCode !== null
    ) {
      return null;
    }
  } else {
    return null;
  }

  return Object.freeze({
    revision,
    adminReceipt: Object.freeze({
      receiptId,
      uploaderUid,
      originalFilename,
      sanitizedFilename,
      format,
      canonicalExtension: expectedExt,
      canonicalMimeType: expectedMime,
      byteSize,
      sha256,
      state,
      deepInspectionStatus: expectedInspection,
      hasVerifiedStorageWrite: Boolean(hasVerifiedStorageWrite),
      reconciliationRequired: Boolean(reconciliationRequired),
      reconciliationReason: reconciliationReason as string | null,
      rejectionReasonCode: rejectionReasonCode as string | null,
      createdAt,
      updatedAt,
      isQuarantinedPrivateOnly: Boolean(isQuarantinedPrivateOnly),
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    }),
  });
}

/**
 * Verifies that a validated 15-field persisted review draft matches the exact
 * identity, revision, timestamp, SHA-256 digest, format, uploader UID, and
 * non-assurance posture of the sanitized `Quarantined` admin receipt.
 */
export function doesPersistedDraftMatchSanitizedAdminReceipt(
  draft: LibraryQuarantinePersistedReviewDraft,
  revision: number,
  adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errorCode: LibraryQuarantineReviewWorkbenchReadErrorCode;
    } {
  if (
    draft.isSanitized !== false ||
    draft.isVerifiedSafe !== false ||
    draft.isRightsApproved !== false ||
    draft.isPublished !== false ||
    draft.isReadyForPeia !== false ||
    draft.reviewState !== LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE
  ) {
    return { ok: false, errorCode: 'SECURITY_POSTURE_VIOLATION' };
  }

  if (
    draft.schemaVersion !== LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION ||
    draft.receiptId !== adminReceipt.receiptId ||
    draft.sourceRevision !== revision ||
    draft.sourceUpdatedAt !== adminReceipt.updatedAt ||
    draft.sourceSha256 !== adminReceipt.sha256 ||
    draft.format !== adminReceipt.format ||
    draft.uploaderUid !== adminReceipt.uploaderUid ||
    !isValidUploaderUid(draft.createdBy) ||
    !isValidIsoUtcTimestamp(draft.createdAt) ||
    Date.parse(draft.createdAt) < Date.parse(adminReceipt.updatedAt)
  ) {
    return { ok: false, errorCode: 'DRAFT_SOURCE_MISMATCH' };
  }

  return { ok: true };
}

/**
 * Composes the bounded latest-20 sanitized quarantine receipts read with point-lookup
 * review draft status resolution.
 *
 * - Reads at most 20 latest receipts once.
 * - Makes at most 1 point lookup to `library_quarantine_review_drafts/<receiptId>`
 *   for each `Quarantined` receipt.
 * - Makes 0 draft lookups for `NeedsReconciliation` (`NEEDS_RECONCILIATION_HOLD`)
 *   and `Reserved` / `WritePending` / `Rejected` (`NOT_ELIGIBLE`).
 * - Fails the entire response (`ok: false`) with fixed safe constant messages
 *   on any receipt read failure, draft lookup failure, corrupted draft, or
 *   source/draft version mismatch.
 */
export async function listLatestLibraryQuarantineReviewWorkbenchItems(
  rawDeps: LibraryQuarantineReviewWorkbenchReadDependencies
): Promise<ListLibraryQuarantineReviewWorkbenchResult> {
  if (
    !isPlainObject(rawDeps) ||
    Object.getOwnPropertySymbols(rawDeps).length > 0
  ) {
    return makeWorkbenchFailure('INVALID_WORKBENCH_DEPENDENCY');
  }
  const deps = rawDeps as LibraryQuarantineReviewWorkbenchReadDependencies;

  let listReceiptsFn = deps.listReceiptsFn;
  if (listReceiptsFn === undefined && deps.receiptReadDatabase !== undefined) {
    const readDb = deps.receiptReadDatabase;
    if (!readDb || typeof readDb.collection !== 'function') {
      return makeWorkbenchFailure('INVALID_WORKBENCH_DEPENDENCY');
    }
    listReceiptsFn = () => listLatestSanitizedLibraryQuarantineReceipts(readDb);
  }

  let draftStore = deps.draftStore;
  if (draftStore === undefined && deps.draftDatabase !== undefined) {
    if (!deps.draftDatabase) {
      return makeWorkbenchFailure('INVALID_WORKBENCH_DEPENDENCY');
    }
    try {
      draftStore = new FirestoreLibraryQuarantineReviewDraftStore(
        deps.draftDatabase
      );
    } catch {
      return makeWorkbenchFailure('INVALID_WORKBENCH_DEPENDENCY');
    }
  }

  if (
    typeof listReceiptsFn !== 'function' ||
    !draftStore ||
    typeof draftStore.getReviewDraftByReceiptId !== 'function'
  ) {
    return makeWorkbenchFailure('INVALID_WORKBENCH_DEPENDENCY');
  }

  let listResult: LibraryQuarantineAdminReadResult;
  try {
    listResult = await listReceiptsFn();
  } catch {
    return makeWorkbenchFailure('RECEIPT_LIST_READ_FAILED');
  }

  if (!isPlainObject(listResult) || typeof listResult.ok !== 'boolean') {
    return makeWorkbenchFailure('RECEIPT_LIST_READ_FAILED');
  }

  if (!listResult.ok) {
    return makeWorkbenchFailure('RECEIPT_LIST_READ_FAILED');
  }

  const rawResponse = listResult.response;
  if (
    !isPlainObject(rawResponse) ||
    !Array.isArray(rawResponse.receipts) ||
    rawResponse.receipts.length > LIBRARY_QUARANTINE_WORKBENCH_LIST_LIMIT
  ) {
    return makeWorkbenchFailure('RECEIPT_LIST_INVARIANT_VIOLATION');
  }

  const seenReceiptIds = new Set<string>();
  const workbenchItems: SanitizedLibraryQuarantineReviewWorkbenchItemDto[] = [];

  for (const rawItem of rawResponse.receipts) {
    const validatedItem = validateSanitizedReceiptItemForWorkbench(rawItem);
    if (!validatedItem) {
      return makeWorkbenchFailure('RECEIPT_LIST_INVARIANT_VIOLATION');
    }

    const { revision, adminReceipt } = validatedItem;
    if (seenReceiptIds.has(adminReceipt.receiptId)) {
      return makeWorkbenchFailure('RECEIPT_LIST_INVARIANT_VIOLATION');
    }
    seenReceiptIds.add(adminReceipt.receiptId);

    if (
      adminReceipt.state === LibraryQuarantineReceiptState.NeedsReconciliation
    ) {
      workbenchItems.push(
        Object.freeze({
          revision,
          adminReceipt,
          draftStatus: 'NEEDS_RECONCILIATION_HOLD' as const,
        })
      );
      continue;
    }

    if (adminReceipt.state !== LibraryQuarantineReceiptState.Quarantined) {
      workbenchItems.push(
        Object.freeze({
          revision,
          adminReceipt,
          draftStatus: 'NOT_ELIGIBLE' as const,
        })
      );
      continue;
    }

    // Eligible `Quarantined` receipt: perform at most one point lookup of draft.
    let lookupResult: GetLibraryQuarantineReviewDraftResult;
    try {
      lookupResult = await draftStore.getReviewDraftByReceiptId(
        adminReceipt.receiptId
      );
    } catch {
      return makeWorkbenchFailure('DRAFT_LOOKUP_FAILED');
    }

    if (!isPlainObject(lookupResult) || typeof lookupResult.ok !== 'boolean') {
      return makeWorkbenchFailure('DRAFT_LOOKUP_FAILED');
    }

    if (!lookupResult.ok) {
      if (lookupResult.errorCode === 'DRAFT_NOT_FOUND') {
        workbenchItems.push(
          Object.freeze({
            revision,
            adminReceipt,
            draftStatus: 'NOT_LINKED' as const,
          })
        );
        continue;
      }
      if (lookupResult.errorCode === 'SECURITY_FLAG_ESCALATION') {
        return makeWorkbenchFailure('SECURITY_POSTURE_VIOLATION');
      }
      if (
        lookupResult.errorCode === 'CORRUPTED_PERSISTED_DRAFT' ||
        lookupResult.errorCode === 'INVALID_SCHEMA_VERSION' ||
        lookupResult.errorCode === 'DOCUMENT_ID_MISMATCH'
      ) {
        return makeWorkbenchFailure('CORRUPTED_PERSISTED_DRAFT');
      }
      return makeWorkbenchFailure('DRAFT_LOOKUP_FAILED');
    }

    // Defensive support in case a test stub returns `{ ok: true, draft: null }`
    const rawDraft: unknown = (lookupResult as { readonly draft?: unknown })
      .draft;
    if (rawDraft === null) {
      workbenchItems.push(
        Object.freeze({
          revision,
          adminReceipt,
          draftStatus: 'NOT_LINKED' as const,
        })
      );
      continue;
    }

    const strictDraftValidation = validatePersistedLibraryQuarantineReviewDraft(
      rawDraft,
      adminReceipt.receiptId
    );
    if (!strictDraftValidation.ok) {
      if (strictDraftValidation.errorCode === 'SECURITY_FLAG_ESCALATION') {
        return makeWorkbenchFailure('SECURITY_POSTURE_VIOLATION');
      }
      return makeWorkbenchFailure('CORRUPTED_PERSISTED_DRAFT');
    }

    const matchCheck = doesPersistedDraftMatchSanitizedAdminReceipt(
      strictDraftValidation.draft,
      revision,
      adminReceipt
    );
    if (!matchCheck.ok) {
      return makeWorkbenchFailure(matchCheck.errorCode);
    }

    workbenchItems.push(
      Object.freeze({
        revision,
        adminReceipt,
        draftStatus: 'PENDING_HUMAN_REVIEW' as const,
      })
    );
  }

  return Object.freeze({
    ok: true as const,
    receipts: Object.freeze(workbenchItems),
  });
}
