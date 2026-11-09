import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
  type AdminUser,
} from '../types/admin';
import { AdminAccessService } from './adminAccess';
import {
  validateSanitizedLibraryQuarantineReceiptListItem,
  type SanitizedLibraryQuarantineAdminReceiptDto,
  type SanitizedLibraryQuarantineReceiptListItemDto,
} from './libraryAdminClient';

/**
 * LIB-FILE-WORKBENCH-01 — Browser-Safe Typed Client for the Library Quarantine Review Workbench
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Calls ONLY the existing `manageLibraryDocuments` Firebase callable with exact
 *   minimal payloads (`{ action: 'listQuarantineReviewWorkbench' }` and
 *   `{ action: 'linkQuarantineReviewDraft', receiptId }`).
 * - Never accesses Firestore or Google Cloud Storage directly from the browser.
 * - Enforces hard 20-item bound, unique 32-hex `receiptId`s, existing sanitized
 *   `adminReceipt` contract (reusing `validateSanitizedLibraryQuarantineReceiptListItem`),
 *   allowed `draftStatus` values, permitted receipt-state -> draft-status mappings,
 *   and the exact 13-key 01C bridge response DTO including `UNKNOWN` (`draftCreated: null`)
 *   vs `NOT_CREATED` (`draftCreated: false`).
 * - Rejects any extra fields, symbol properties, private storage paths, GCS
 *   generations, bucket names, signed/download URLs, raw draft payloads, or
 *   escalated security posture flags.
 * - Uses fixed safe constant UI error messages and performs zero automatic retries
 *   and zero browser storage persistence.
 */

export const LIBRARY_REVIEW_WORKBENCH_UI_ENV_VAR =
  'VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED' as const;

export const MAX_WORKBENCH_RECEIPT_LIST_ITEMS = 20 as const;

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;

export type LibraryQuarantineReviewWorkbenchDraftStatus =
  | 'NOT_LINKED'
  | 'PENDING_HUMAN_REVIEW'
  | 'NEEDS_RECONCILIATION_HOLD'
  | 'NOT_ELIGIBLE';

export type LibraryQuarantineReviewWorkbenchDisplayStatus =
  | LibraryQuarantineReviewWorkbenchDraftStatus
  | 'UNAVAILABLE';

export interface SanitizedLibraryQuarantineReviewWorkbenchItemDto {
  readonly revision: number;
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly draftStatus: LibraryQuarantineReviewWorkbenchDraftStatus;
}

export interface ListLibraryQuarantineReviewWorkbenchResponseDto {
  readonly receipts: readonly SanitizedLibraryQuarantineReviewWorkbenchItemDto[];
}

export type LibraryQuarantineReviewDraftLinkDisposition =
  | 'CREATED'
  | 'IDEMPOTENT_EXISTING';

export type LibraryQuarantineReviewDraftLinkFailureOutcome =
  | 'NOT_CREATED'
  | 'UNKNOWN';

export type LibraryQuarantineReviewDraftCallableErrorStatus =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted'
  | 'internal';

export type LibraryQuarantineReviewDraftLinkErrorCode =
  | 'UNAUTHENTICATED_CALLER_HOLD'
  | 'CORS_ORIGIN_FORBIDDEN_HOLD'
  | 'UNSAFE_BUCKET_BINDING_HOLD'
  | 'BRIDGE_DEPENDENCY_INVALID_HOLD'
  | 'INVALID_SERVICE_INPUT_HOLD'
  | 'UNTRUSTED_CALLER_FIELD_HOLD'
  | 'INVALID_RECEIPT_ID_HOLD'
  | 'UNAUTHORIZED_REVIEWER_HOLD'
  | 'INVALID_TIMESTAMP_HOLD'
  | 'SOURCE_RECEIPT_NOT_FOUND_HOLD'
  | 'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD'
  | 'NEEDS_RECONCILIATION_HOLD'
  | 'SOURCE_STATE_NOT_ELIGIBLE_HOLD'
  | 'CANDIDATE_CONTRACT_REJECTED_HOLD'
  | 'GCS_READBACK_UNVERIFIED_HOLD'
  | 'GCS_ATTESTATION_MISMATCH_HOLD'
  | 'STALE_SOURCE_HOLD'
  | 'EXISTING_DRAFT_CONFLICT_HOLD'
  | 'CORRUPTED_PERSISTED_DRAFT_HOLD'
  | 'TRANSACTION_CONFLICT_OR_FAILURE_HOLD'
  | 'INVALID_SERVICE_DEPENDENCY_HOLD'
  | 'UNAUTHENTICATED_REVIEWER_HOLD'
  | 'ADMIN_LOOKUP_FAILED_HOLD'
  | 'UNAUTHORIZED_REVIEWER_ROLE_HOLD'
  | 'RECEIPT_NOT_FOUND_HOLD'
  | 'RECEIPT_LOOKUP_FAILED_HOLD'
  | 'CORRUPTED_SOURCE_RECEIPT_HOLD'
  | 'INELIGIBLE_SOURCE_RECEIPT_HOLD'
  | 'MISSING_PINNED_GCS_IDENTITY_HOLD'
  | 'CANDIDATE_ASSESSMENT_HOLD'
  | 'SECURITY_FLAG_ESCALATION_HOLD'
  | 'DRAFT_STORE_WRITE_FAILED_HOLD';

export interface LibraryQuarantineReviewDraftCallableBridgeSuccessDto {
  readonly ok: true;
  readonly status: 'LINKED_PENDING_HUMAN_REVIEW';
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly reviewState: 'PENDING_HUMAN_REVIEW';
  readonly disposition: LibraryQuarantineReviewDraftLinkDisposition;
  readonly draftCreationOutcome: LibraryQuarantineReviewDraftLinkDisposition;
  readonly draftCreated: boolean;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineReviewDraftCallableBridgeFailureDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly callableStatus: LibraryQuarantineReviewDraftCallableErrorStatus;
  readonly errorCode: LibraryQuarantineReviewDraftLinkErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly draftCreationOutcome: LibraryQuarantineReviewDraftLinkFailureOutcome;
  readonly draftCreated: false | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type LibraryQuarantineReviewDraftCallableBridgeResponseDto =
  | LibraryQuarantineReviewDraftCallableBridgeSuccessDto
  | LibraryQuarantineReviewDraftCallableBridgeFailureDto;

export interface ListQuarantineReviewWorkbenchActionPayload {
  readonly action: 'listQuarantineReviewWorkbench';
}

export interface LinkQuarantineReviewDraftActionPayload {
  readonly action: 'linkQuarantineReviewDraft';
  readonly receiptId: string;
}

export type ManageLibraryDocumentsCallableInvoker = (
  payload:
    | ListQuarantineReviewWorkbenchActionPayload
    | LinkQuarantineReviewDraftActionPayload
) => Promise<{ readonly data: unknown }>;

export const WORKBENCH_CLIENT_SAFE_ERRORS = Object.freeze({
  BACKEND_UNAVAILABLE:
    'WORKBENCH_BACKEND_UNAVAILABLE: Secure Library backend or authenticated admin session is unavailable.',
  WORKBENCH_NOT_RELEASED:
    'WORKBENCH_NOT_RELEASED: Library quarantine review workbench is not enabled on the server.',
  INVALID_RECEIPT_ID:
    'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hexadecimal string.',
  LIST_CONTRACT_INVALID:
    'WORKBENCH_LIST_CONTRACT_INVALID: Server response violated quarantine review workbench list contract.',
  LIST_CALL_FAILED:
    'WORKBENCH_LIST_READ_FAILED: Failed to read quarantine review workbench items from server.',
  LINK_CONTRACT_INVALID:
    'WORKBENCH_LINK_CONTRACT_INVALID: Server response violated 13-key quarantine review draft link contract.',
  LINK_CALL_FAILED:
    'WORKBENCH_LINK_CALL_FAILED: Failed to execute quarantine review draft link request.',
});

const ALLOWED_WORKBENCH_ITEM_KEYS: ReadonlySet<string> = new Set([
  'revision',
  'adminReceipt',
  'draftStatus',
]);

const ALLOWED_WORKBENCH_DRAFT_STATUSES: ReadonlySet<LibraryQuarantineReviewWorkbenchDraftStatus> =
  new Set([
    'NOT_LINKED',
    'PENDING_HUMAN_REVIEW',
    'NEEDS_RECONCILIATION_HOLD',
    'NOT_ELIGIBLE',
  ]);

const ALLOWED_BRIDGE_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'receiptId',
  'sourceRevision',
  'reviewState',
  'disposition',
  'draftCreationOutcome',
  'draftCreated',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_BRIDGE_FAILURE_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'callableStatus',
  'errorCode',
  'errorMessage',
  'receiptId',
  'draftCreationOutcome',
  'draftCreated',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_CALLABLE_ERROR_STATUSES: ReadonlySet<LibraryQuarantineReviewDraftCallableErrorStatus> =
  new Set([
    'unauthenticated',
    'permission-denied',
    'invalid-argument',
    'not-found',
    'failed-precondition',
    'aborted',
    'internal',
  ]);

const ALLOWED_BRIDGE_FAILURE_ERROR_CODES: ReadonlySet<LibraryQuarantineReviewDraftLinkErrorCode> =
  new Set([
    'UNAUTHENTICATED_CALLER_HOLD',
    'CORS_ORIGIN_FORBIDDEN_HOLD',
    'UNSAFE_BUCKET_BINDING_HOLD',
    'BRIDGE_DEPENDENCY_INVALID_HOLD',
    'INVALID_SERVICE_INPUT_HOLD',
    'UNTRUSTED_CALLER_FIELD_HOLD',
    'INVALID_RECEIPT_ID_HOLD',
    'UNAUTHORIZED_REVIEWER_HOLD',
    'INVALID_TIMESTAMP_HOLD',
    'SOURCE_RECEIPT_NOT_FOUND_HOLD',
    'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD',
    'NEEDS_RECONCILIATION_HOLD',
    'SOURCE_STATE_NOT_ELIGIBLE_HOLD',
    'CANDIDATE_CONTRACT_REJECTED_HOLD',
    'GCS_READBACK_UNVERIFIED_HOLD',
    'GCS_ATTESTATION_MISMATCH_HOLD',
    'STALE_SOURCE_HOLD',
    'EXISTING_DRAFT_CONFLICT_HOLD',
    'CORRUPTED_PERSISTED_DRAFT_HOLD',
    'TRANSACTION_CONFLICT_OR_FAILURE_HOLD',
    'INVALID_SERVICE_DEPENDENCY_HOLD',
    'UNAUTHENTICATED_REVIEWER_HOLD',
    'ADMIN_LOOKUP_FAILED_HOLD',
    'UNAUTHORIZED_REVIEWER_ROLE_HOLD',
    'RECEIPT_NOT_FOUND_HOLD',
    'RECEIPT_LOOKUP_FAILED_HOLD',
    'CORRUPTED_SOURCE_RECEIPT_HOLD',
    'INELIGIBLE_SOURCE_RECEIPT_HOLD',
    'MISSING_PINNED_GCS_IDENTITY_HOLD',
    'CANDIDATE_ASSESSMENT_HOLD',
    'SECURITY_FLAG_ESCALATION_HOLD',
    'DRAFT_STORE_WRITE_FAILED_HOLD',
  ]);

const FORBIDDEN_PRIVATE_WORKBENCH_KEYS: ReadonlySet<string> = new Set([
  'storagePath',
  'generation',
  'attestedGeneration',
  'attestedStoragePath',
  'attestation',
  'bucket',
  'targetBucketName',
  'signedUrl',
  'downloadUrl',
  'mediaLink',
  'downloadTokens',
  'rawBytes',
  'bytes',
  'draft',
  'candidate',
  'sourceSha256',
  'createdBy',
  'createdAt',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

export function hasForbiddenPrivateLeakInWorkbenchPayload(
  value: unknown,
  depth = 0
): boolean {
  if (depth > 6 || value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return (
      lower.includes('library/quarantine/') ||
      lower.includes('library-quarantine/') ||
      lower.includes('promiseofplanet-bb325-library-quarantine') ||
      lower.includes('promiseofplanet-bb325.firebasestorage.app') ||
      lower.includes('gs://') ||
      lower.includes('https://storage.googleapis.com') ||
      lower.includes('firebasestorage.googleapis.com')
    );
  }
  if (Array.isArray(value)) {
    return value.some((entry) =>
      hasForbiddenPrivateLeakInWorkbenchPayload(entry, depth + 1)
    );
  }
  if (typeof value === 'object') {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return true;
    }
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (FORBIDDEN_PRIVATE_WORKBENCH_KEYS.has(key)) {
        return true;
      }
      if (hasForbiddenPrivateLeakInWorkbenchPayload(nested, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function assertExactPlainObjectKeys(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  errorMessage: string
): Record<string, unknown> {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(errorMessage);
  }
  const keys = Object.keys(value);
  if (keys.length !== allowedKeys.size) {
    throw new Error(errorMessage);
  }
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new Error(errorMessage);
    }
  }
  return value;
}

/**
 * Checks whether the client UI release flag `VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED === 'true'`
 * is active. Defaults to `false` when unset or set to any other value.
 */
export function isLibraryQuarantineReviewWorkbenchEnabled(
  envOverride?: Readonly<Record<string, unknown>>
): boolean {
  if (envOverride !== undefined) {
    if (!isPlainObject(envOverride)) {
      return false;
    }
    return envOverride[LIBRARY_REVIEW_WORKBENCH_UI_ENV_VAR] === 'true';
  }
  const viteEnv = (
    import.meta as unknown as { readonly env?: Record<string, unknown> }
  )?.env;
  if (!viteEnv || typeof viteEnv !== 'object') {
    return false;
  }
  return viteEnv[LIBRARY_REVIEW_WORKBENCH_UI_ENV_VAR] === 'true';
}

/**
 * Canonical role & permission check for preparing/linking a private quarantine
 * review draft (`action: 'linkQuarantineReviewDraft'`).
 * Matches server-side `authenticateHumanAdminForLibraryPeiaAction(..., [AdminPermission.Review])`
 * and 01B/01C reviewer authorization:
 * - Active human admin (`isActive === true` and `role !== AdminRole.AIAssistant`)
 * - Library domain responsibility (`Owner`, `LibraryCurator`) or `RightsReviewer`
 * - `AdminPermission.Review`
 */
export function canPrepareLibraryQuarantineReviewDraft(
  user: AdminUser | null | undefined
): boolean {
  if (!user || user.isActive !== true) {
    return false;
  }
  if (user.role === AdminRole.AIAssistant) {
    return false;
  }
  const hasLibraryDomainAccess =
    hasDomainResponsibility(user.role, AdminDomain.Library) ||
    user.role === AdminRole.RightsReviewer;
  if (!hasLibraryDomainAccess) {
    return false;
  }
  const explicitPermissions = (
    user as { readonly permissions?: unknown }
  ).permissions;
  if (
    Array.isArray(explicitPermissions) &&
    !explicitPermissions.includes(AdminPermission.Review)
  ) {
    return false;
  }
  return AdminAccessService.hasPermission(user, AdminPermission.Review);
}

/**
 * Checks whether a specific workbench row is eligible for the manual
 * "Prepare review draft" action (`Quarantined` state AND `NOT_LINKED` draft status).
 */
export function isQuarantineWorkbenchItemEligibleForDraftLink(
  item:
    | {
        readonly adminReceipt: Pick<
          SanitizedLibraryQuarantineAdminReceiptDto,
          'state'
        >;
        readonly draftStatus: LibraryQuarantineReviewWorkbenchDisplayStatus;
      }
    | null
    | undefined
): boolean {
  if (!item || !item.adminReceipt) {
    return false;
  }
  return (
    item.adminReceipt.state === 'Quarantined' &&
    item.draftStatus === 'NOT_LINKED'
  );
}

/**
 * Converts fallback receipt-only items (`listQuarantineReceipts`) into display items
 * with explicit `'UNAVAILABLE'` review link status so the UI never fakes `'NOT_LINKED'`
 * or `'PENDING_HUMAN_REVIEW'` when the workbench server endpoint is disabled.
 */
export function toFallbackUnavailableWorkbenchDisplayItems(
  receipts: readonly SanitizedLibraryQuarantineReceiptListItemDto[]
): readonly {
  readonly revision: number;
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly draftStatus: 'UNAVAILABLE';
}[] {
  return Object.freeze(
    receipts.map((item) =>
      Object.freeze({
        revision: item.revision,
        adminReceipt: item.adminReceipt,
        draftStatus: 'UNAVAILABLE' as const,
      })
    )
  );
}

export function isWorkbenchNotReleasedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const msg =
    typeof (err as { readonly message?: unknown }).message === 'string'
      ? (err as { readonly message: string }).message
      : '';
  return msg.includes('WORKBENCH_NOT_RELEASED');
}

export function buildListQuarantineReviewWorkbenchPayload(): ListQuarantineReviewWorkbenchActionPayload {
  return Object.freeze({
    action: 'listQuarantineReviewWorkbench' as const,
  });
}

export function buildLinkQuarantineReviewDraftPayload(
  receiptId: unknown
): LinkQuarantineReviewDraftActionPayload {
  if (
    typeof receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)
  ) {
    throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }
  return Object.freeze({
    action: 'linkQuarantineReviewDraft' as const,
    receiptId,
  });
}

export function isDraftStatusPermittedForReceiptState(
  receiptState: SanitizedLibraryQuarantineAdminReceiptDto['state'],
  draftStatus: LibraryQuarantineReviewWorkbenchDraftStatus
): boolean {
  if (receiptState === 'Quarantined') {
    return (
      draftStatus === 'NOT_LINKED' || draftStatus === 'PENDING_HUMAN_REVIEW'
    );
  }
  if (receiptState === 'NeedsReconciliation') {
    return draftStatus === 'NEEDS_RECONCILIATION_HOLD';
  }
  if (
    receiptState === 'Reserved' ||
    receiptState === 'WritePending' ||
    receiptState === 'Rejected'
  ) {
    return draftStatus === 'NOT_ELIGIBLE';
  }
  return false;
}

export function validateLibraryQuarantineReviewWorkbenchItem(
  candidate: unknown
): SanitizedLibraryQuarantineReviewWorkbenchItemDto {
  const obj = assertExactPlainObjectKeys(
    candidate,
    ALLOWED_WORKBENCH_ITEM_KEYS,
    WORKBENCH_CLIENT_SAFE_ERRORS.LIST_CONTRACT_INVALID
  );

  // Check for private leaks on the wrapper before delegating `adminReceipt`
  // (note: `adminReceipt` legitimately has `createdAt`, which is validated by
  // `validateSanitizedLibraryQuarantineReceiptListItem`).
  const draftStatus = obj.draftStatus;
  if (
    typeof draftStatus !== 'string' ||
    !ALLOWED_WORKBENCH_DRAFT_STATUSES.has(
      draftStatus as LibraryQuarantineReviewWorkbenchDraftStatus
    )
  ) {
    throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LIST_CONTRACT_INVALID);
  }

  let validatedBase: SanitizedLibraryQuarantineReceiptListItemDto;
  try {
    validatedBase = validateSanitizedLibraryQuarantineReceiptListItem({
      revision: obj.revision,
      adminReceipt: obj.adminReceipt,
    });
  } catch {
    throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LIST_CONTRACT_INVALID);
  }

  const typedStatus =
    draftStatus as LibraryQuarantineReviewWorkbenchDraftStatus;
  if (
    !isDraftStatusPermittedForReceiptState(
      validatedBase.adminReceipt.state,
      typedStatus
    )
  ) {
    throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LIST_CONTRACT_INVALID);
  }

  return Object.freeze({
    revision: validatedBase.revision,
    adminReceipt: validatedBase.adminReceipt,
    draftStatus: typedStatus,
  });
}

export function validateLibraryQuarantineReviewWorkbenchListResponse(
  rawData: unknown
): readonly SanitizedLibraryQuarantineReviewWorkbenchItemDto[] {
  const envelope = assertExactPlainObjectKeys(
    rawData,
    new Set(['receipts']),
    WORKBENCH_CLIENT_SAFE_ERRORS.LIST_CONTRACT_INVALID
  );

  if (
    !Array.isArray(envelope.receipts) ||
    envelope.receipts.length > MAX_WORKBENCH_RECEIPT_LIST_ITEMS
  ) {
    throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LIST_CONTRACT_INVALID);
  }

  const seenIds = new Set<string>();
  const items: SanitizedLibraryQuarantineReviewWorkbenchItemDto[] = [];

  for (const rawItem of envelope.receipts) {
    const validated = validateLibraryQuarantineReviewWorkbenchItem(rawItem);
    if (seenIds.has(validated.adminReceipt.receiptId)) {
      throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LIST_CONTRACT_INVALID);
    }
    seenIds.add(validated.adminReceipt.receiptId);
    items.push(validated);
  }

  return Object.freeze(items);
}

export function validateLibraryQuarantineReviewDraftLinkResponse(
  rawData: unknown,
  expectedReceiptId: string
): LibraryQuarantineReviewDraftCallableBridgeResponseDto {
  if (
    typeof expectedReceiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(expectedReceiptId)
  ) {
    throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
  }

  if (
    !isPlainObject(rawData) ||
    Object.getOwnPropertySymbols(rawData).length > 0 ||
    hasForbiddenPrivateLeakInWorkbenchPayload(rawData)
  ) {
    throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CONTRACT_INVALID);
  }

  if (rawData.ok === true) {
    const obj = assertExactPlainObjectKeys(
      rawData,
      ALLOWED_BRIDGE_SUCCESS_KEYS,
      WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CONTRACT_INVALID
    );

    const {
      status,
      receiptId,
      sourceRevision,
      reviewState,
      disposition,
      draftCreationOutcome,
      draftCreated,
      isSanitized,
      isVerifiedSafe,
      isRightsApproved,
      isPublished,
      isReadyForPeia,
    } = obj;

    if (
      status !== 'LINKED_PENDING_HUMAN_REVIEW' ||
      receiptId !== expectedReceiptId ||
      typeof sourceRevision !== 'number' ||
      !Number.isSafeInteger(sourceRevision) ||
      sourceRevision < 1 ||
      reviewState !== 'PENDING_HUMAN_REVIEW' ||
      isSanitized !== false ||
      isVerifiedSafe !== false ||
      isRightsApproved !== false ||
      isPublished !== false ||
      isReadyForPeia !== false
    ) {
      throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CONTRACT_INVALID);
    }

    const isValidCreated =
      disposition === 'CREATED' &&
      draftCreationOutcome === 'CREATED' &&
      draftCreated === true;
    const isValidIdempotent =
      disposition === 'IDEMPOTENT_EXISTING' &&
      draftCreationOutcome === 'IDEMPOTENT_EXISTING' &&
      draftCreated === false;

    if (!isValidCreated && !isValidIdempotent) {
      throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CONTRACT_INVALID);
    }

    return Object.freeze({
      ok: true as const,
      status: 'LINKED_PENDING_HUMAN_REVIEW' as const,
      receiptId: expectedReceiptId,
      sourceRevision,
      reviewState: 'PENDING_HUMAN_REVIEW' as const,
      disposition: disposition as LibraryQuarantineReviewDraftLinkDisposition,
      draftCreationOutcome:
        draftCreationOutcome as LibraryQuarantineReviewDraftLinkDisposition,
      draftCreated: Boolean(draftCreated),
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (rawData.ok === false) {
    const obj = assertExactPlainObjectKeys(
      rawData,
      ALLOWED_BRIDGE_FAILURE_KEYS,
      WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CONTRACT_INVALID
    );

    const {
      status,
      callableStatus,
      errorCode,
      errorMessage,
      receiptId,
      draftCreationOutcome,
      draftCreated,
      isSanitized,
      isVerifiedSafe,
      isRightsApproved,
      isPublished,
      isReadyForPeia,
    } = obj;

    if (
      status !== 'HOLD' ||
      typeof callableStatus !== 'string' ||
      !ALLOWED_CALLABLE_ERROR_STATUSES.has(
        callableStatus as LibraryQuarantineReviewDraftCallableErrorStatus
      ) ||
      typeof errorCode !== 'string' ||
      !ALLOWED_BRIDGE_FAILURE_ERROR_CODES.has(
        errorCode as LibraryQuarantineReviewDraftLinkErrorCode
      ) ||
      typeof errorMessage !== 'string' ||
      errorMessage.trim().length === 0 ||
      errorMessage.length > 240 ||
      hasControlCharacters(errorMessage) ||
      hasForbiddenPrivateLeakInWorkbenchPayload(errorMessage) ||
      (receiptId !== expectedReceiptId && receiptId !== null) ||
      isSanitized !== false ||
      isVerifiedSafe !== false ||
      isRightsApproved !== false ||
      isPublished !== false ||
      isReadyForPeia !== false
    ) {
      throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CONTRACT_INVALID);
    }

    const isNotCreated =
      draftCreationOutcome === 'NOT_CREATED' && draftCreated === false;
    const isUnknown =
      draftCreationOutcome === 'UNKNOWN' && draftCreated === null;

    if (!isNotCreated && !isUnknown) {
      throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CONTRACT_INVALID);
    }

    return Object.freeze({
      ok: false as const,
      status: 'HOLD' as const,
      callableStatus:
        callableStatus as LibraryQuarantineReviewDraftCallableErrorStatus,
      errorCode: errorCode as LibraryQuarantineReviewDraftLinkErrorCode,
      errorMessage,
      receiptId: (receiptId as string | null) ?? null,
      draftCreationOutcome:
        draftCreationOutcome as LibraryQuarantineReviewDraftLinkFailureOutcome,
      draftCreated: draftCreated as false | null,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CONTRACT_INVALID);
}

function createDefaultManageLibraryDocumentsInvoker(): ManageLibraryDocumentsCallableInvoker {
  if (!isFirebaseConfigured || !app || !auth?.currentUser) {
    throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE);
  }
  const fns = getFunctions(app, 'us-central1');
  const callable = httpsCallable<Record<string, unknown>, unknown>(
    fns,
    'manageLibraryDocuments'
  );
  return async (payload) => {
    const res = await callable(payload as unknown as Record<string, unknown>);
    return { data: res?.data };
  };
}

export const LibraryQuarantineReviewWorkbenchClient = {
  isWorkbenchEnabled(envOverride?: Readonly<Record<string, unknown>>): boolean {
    return isLibraryQuarantineReviewWorkbenchEnabled(envOverride);
  },

  async listQuarantineReviewWorkbench(options?: {
    readonly invoker?: ManageLibraryDocumentsCallableInvoker;
  }): Promise<readonly SanitizedLibraryQuarantineReviewWorkbenchItemDto[]> {
    const payload = buildListQuarantineReviewWorkbenchPayload();
    const invoker =
      options?.invoker ?? createDefaultManageLibraryDocumentsInvoker();

    let rawResult: { readonly data: unknown };
    try {
      rawResult = await invoker(payload);
    } catch (err: unknown) {
      if (isWorkbenchNotReleasedError(err)) {
        throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.WORKBENCH_NOT_RELEASED);
      }
      throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LIST_CALL_FAILED);
    }

    return validateLibraryQuarantineReviewWorkbenchListResponse(
      rawResult?.data
    );
  },

  async linkQuarantineReviewDraft(
    receiptId: string,
    options?: {
      readonly invoker?: ManageLibraryDocumentsCallableInvoker;
    }
  ): Promise<LibraryQuarantineReviewDraftCallableBridgeResponseDto> {
    const payload = buildLinkQuarantineReviewDraftPayload(receiptId);
    const invoker =
      options?.invoker ?? createDefaultManageLibraryDocumentsInvoker();

    let rawResult: { readonly data: unknown };
    try {
      rawResult = await invoker(payload);
    } catch (err: unknown) {
      if (isWorkbenchNotReleasedError(err)) {
        throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.WORKBENCH_NOT_RELEASED);
      }
      throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.LINK_CALL_FAILED);
    }

    return validateLibraryQuarantineReviewDraftLinkResponse(
      rawResult?.data,
      payload.receiptId
    );
  },
};
