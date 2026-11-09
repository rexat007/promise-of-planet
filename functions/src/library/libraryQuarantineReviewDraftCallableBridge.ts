import { Buffer } from 'node:buffer';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { AdminRepository } from '../admin/adminRepository';
import {
  FirestoreAdminRepository,
  type FirestoreAdminDatabase,
} from '../admin/firestoreAdminRepository';
import { AdminRole } from '../types/admin';
import {
  LIBRARY_QUARANTINE_STORAGE_PREFIX,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import {
  FirestoreLibraryQuarantineReceiptStore,
  type LibraryQuarantineFirestoreDatabase,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  GcsLibraryQuarantineStorageAdapter,
  type GcsLibraryQuarantineBucket,
  type GcsLibraryQuarantineFile,
  type GcsLibraryQuarantineFileOptions,
  type GcsLibraryQuarantineSaveOptions,
} from './gcsLibraryQuarantineStorageAdapter';
import type { LibraryQuarantineGcsReadbackPort } from './libraryQuarantineRecoveryCoordinator';
import {
  DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS,
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
} from './libraryQuarantineUploadEndpoint';
import {
  FirestoreLibraryQuarantineReviewDraftStore,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
  type CreateLibraryQuarantineReviewDraftDisposition,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftStore,
  type LibraryQuarantineReviewDraftStoreFailureOutcome,
} from './firestoreLibraryQuarantineReviewDraftStore';
import {
  LibraryQuarantineReviewDraftPersistenceService,
  type LibraryQuarantineReceiptReadOnlyPort,
  type LibraryQuarantineReviewDraftHoldReasonCode,
  type LinkLibraryQuarantineReviewDraftResult,
  type TrustedQuarantineAuthenticatedPrincipal,
  type TrustedQuarantineReviewerPrincipalProvider,
} from './libraryQuarantineReviewDraftPersistenceService';

/**
 * LIB-FILE-REVIEW-01C — Internal Server-Only Trusted Callable Bridge
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Provides an internal, testable Firebase Functions v2 `onCall` bridge for
 *   linking an existing verified `Quarantined` upload receipt
 *   (`library_quarantine_receipts/<receiptId>`) to its durable review draft
 *   (`library_quarantine_review_drafts/<receiptId>`) with
 *   `reviewState: 'PENDING_HUMAN_REVIEW'`.
 * - NOT EXPORTED from `functions/src/index.ts`, NOT deployed to Firebase, and
 *   NOT wired to any frontend client. Live registration/deployment is deferred
 *   to a separate, explicitly approved release gate.
 * - SDK-TRUSTED AUTH PROVENANCE ONLY:
 *   1. The bridge accepts `request.auth` exclusively from the Firebase Functions
 *      v2 callable server context (`CallableRequest`).
 *   2. Caller payload `request.data` must be an exact plain object `{ receiptId }`.
 *      Any caller-supplied `auth`, `uid`, `token`, `role`, `candidate`,
 *      `generation`, `storagePath`, `isAuthorized`, or symbol property in
 *      `request.data` is rejected (`UNTRUSTED_CALLER_FIELD_HOLD`) before any
 *      principal resolution, `AdminRepository` lookup, receipt read, or GCS access.
 *   3. Each invocation constructs a fresh, request-scoped
 *      `TrustedQuarantineReviewerPrincipalProvider` bound solely to that
 *      invocation's `request.auth` (`uid` and sanitized `token`). No authenticated
 *      principal or provider is ever cached across requests or stored in module
 *      globals.
 *   4. IMPORTANT VERIFICATION NOTE: `executeLibraryQuarantineReviewDraftCallableBridge`
 *      enforces the server adapter contract given a callable `request` envelope.
 *      Unit tests with mock `request.auth` objects verify local bridge/service
 *      isolation and authorization logic, NOT live Firebase Auth cryptographic
 *      JWT signature verification.
 * - DEDICATED QUARANTINE BUCKET BINDING & ZERO GCS WRITES:
 *   `createProductionLibraryQuarantineReviewDraftBridgeRuntime` binds explicitly
 *   to `getStorage().bucket('promiseofplanet-bb325-library-quarantine')`, verifies
 *   the bucket handle and name, rejects default bucket fallback
 *   (`promiseofplanet-bb325.firebasestorage.app`), and wraps the bucket in a
 *   read-only guard that forbids `file.save()`.
 * - MINIMAL NON-SECRET RESPONSE DTO:
 *   - Success returns only the 13 non-secret status fields (`ok`, `status`,
 *     `receiptId`, `sourceRevision`, `reviewState`, `disposition`,
 *     `draftCreationOutcome`, `draftCreated`, `isSanitized`, `isVerifiedSafe`,
 *     `isRightsApproved`, `isPublished`, `isReadyForPeia`).
 *   - Failure returns only a fixed safe error code, canonical callable status,
 *     predefined constant message, `receiptId`, truthful `draftCreationOutcome`
 *     (`'NOT_CREATED'` vs `'UNKNOWN'`), `draftCreated` (`false` vs `null`), and
 *     the 5 `false` non-assurance flags.
 *   - Never exposes the persisted `draft` record, `candidate`, `sourceSha256`,
 *     `storagePath`, `generation`, `attestation`, bucket name, URLs, tokens, or
 *     raw dependency exception messages.
 */

export {
  DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS,
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
};

export const LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_SERVICE_ACCOUNT =
  'pop-library-upload@promiseofplanet-bb325.iam.gserviceaccount.com' as const;

export const LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_CORS_ORIGINS: readonly string[] =
  Object.freeze(Array.from(DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS));

export const LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_OPTIONS = Object.freeze({
  serviceAccount: LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_SERVICE_ACCOUNT,
  cors: [...LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_CORS_ORIGINS],
  maxInstances: 10,
  memory: '256MiB' as const,
  timeoutSeconds: 30,
});

export type LibraryQuarantineReviewDraftCallableErrorStatus =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted'
  | 'internal';

export type LibraryQuarantineReviewDraftCallableBridgeErrorCode =
  | 'UNAUTHENTICATED_CALLER_HOLD'
  | 'CORS_ORIGIN_FORBIDDEN_HOLD'
  | 'UNSAFE_BUCKET_BINDING_HOLD'
  | 'BRIDGE_DEPENDENCY_INVALID_HOLD'
  | LibraryQuarantineReviewDraftHoldReasonCode;

export interface LibraryQuarantineReviewDraftCallableAuthContext {
  readonly uid: string;
  readonly token?: Readonly<Record<string, unknown>>;
}

export interface LibraryQuarantineReviewDraftCallableRequest {
  readonly auth?: LibraryQuarantineReviewDraftCallableAuthContext | null;
  readonly data?: unknown;
  readonly rawRequest?: {
    readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  };
}

export interface LibraryQuarantineReviewDraftCallableBridgeSuccessDto {
  readonly ok: true;
  readonly status: 'LINKED_PENDING_HUMAN_REVIEW';
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly reviewState: typeof LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE;
  readonly disposition: CreateLibraryQuarantineReviewDraftDisposition;
  readonly draftCreationOutcome: CreateLibraryQuarantineReviewDraftDisposition;
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
  readonly errorCode: LibraryQuarantineReviewDraftCallableBridgeErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly draftCreationOutcome: LibraryQuarantineReviewDraftStoreFailureOutcome;
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

export interface LibraryQuarantineReviewDraftServicePort {
  linkQuarantineReceiptToReviewDraft(
    rawInput: unknown
  ): Promise<LinkLibraryQuarantineReviewDraftResult>;
}

export interface ProductionLibraryQuarantineReviewDraftBridgeRuntime {
  readonly targetBucketName: typeof LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly receiptStore: LibraryQuarantineReceiptReadOnlyPort;
  readonly storageReadbackPort: LibraryQuarantineGcsReadbackPort;
  readonly draftStore: LibraryQuarantineReviewDraftStore;
  readonly clock?: () => string;
}

export interface ProductionLibraryQuarantineReviewDraftBridgeRuntimeOverrides {
  readonly adminRepository?: Pick<AdminRepository, 'getAdminByUid'>;
  readonly receiptStore?: LibraryQuarantineReceiptReadOnlyPort;
  readonly storageReadbackPort?: LibraryQuarantineGcsReadbackPort;
  readonly draftStore?: LibraryQuarantineReviewDraftStore;
  readonly getFirestore?: () => unknown;
  readonly getStorage?: () => {
    bucket: (name: string) => unknown;
  };
  readonly clock?: () => string;
}

export interface LibraryQuarantineReviewDraftCallableBridgeDependencies {
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly receiptStore: LibraryQuarantineReceiptReadOnlyPort;
  readonly storageReadbackPort: LibraryQuarantineGcsReadbackPort;
  readonly draftStore: LibraryQuarantineReviewDraftStore;
  readonly trustedOrigins?: ReadonlySet<string>;
  readonly clock?: () => string;
  readonly createPersistenceService?: (params: {
    readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
    readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
    readonly receiptStore: LibraryQuarantineReceiptReadOnlyPort;
    readonly storageReadbackPort: LibraryQuarantineGcsReadbackPort;
    readonly draftStore: LibraryQuarantineReviewDraftStore;
    readonly clock?: () => string;
  }) => LibraryQuarantineReviewDraftServicePort;
}

const ALLOWED_CALLABLE_DATA_KEYS: ReadonlySet<string> = new Set(['receiptId']);

const ALLOWED_CALLABLE_AUTH_KEYS: ReadonlySet<string> = new Set([
  'uid',
  'token',
  'rawToken',
]);

const ALLOWED_RUNTIME_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'adminRepository',
  'receiptStore',
  'storageReadbackPort',
  'draftStore',
  'getFirestore',
  'getStorage',
  'clock',
]);

const FORBIDDEN_TOKEN_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'isAuthorized',
  'authorized',
  'bypassAuth',
  'forceAuthorize',
  'allow',
  'adminUser',
  'createdBy',
  'storagePath',
  'generation',
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
]);

const ALLOWED_SUCCESS_DTO_KEYS: ReadonlySet<string> = new Set([
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

const BIDI_OR_FORMAT_CHAR_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/g;

function stripControlAndBidiChars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
      out += ' ';
    } else {
      out += value[i];
    }
  }
  return out.replace(BIDI_OR_FORMAT_CHAR_REGEX, ' ');
}

/**
 * Frozen catalog of predefined, non-sensitive constant messages for all callable
 * bridge HOLD outcomes. Raw SDK/Firestore/GCS/AdminRepository exception strings
 * and untrusted caller property names/values are never interpolated.
 */
const BRIDGE_SAFE_MESSAGES = Object.freeze({
  CORS_ORIGIN_FORBIDDEN:
    'Callable request Origin is not permitted for Library quarantine review draft linkage.',
  REQUEST_ENVELOPE_INVALID:
    'Callable request envelope must be a valid server request object.',
  DATA_NOT_PLAIN_OBJECT:
    'Callable request.data must be a plain non-null object containing only receiptId.',
  DATA_UNEXPECTED_FIELD:
    'Caller-supplied request.data contains an unexpected or forbidden field; only receiptId is accepted.',
  DATA_MISSING_RECEIPT_ID:
    'Callable request.data is missing the required receiptId property.',
  DATA_INVALID_RECEIPT_ID:
    'receiptId must be a valid 32-character lowercase hexadecimal string.',
  AUTH_MISSING_OR_MALFORMED:
    'Callable request is missing a valid server-authenticated Firebase principal.',
  AUTH_UNEXPECTED_FIELD:
    'Callable request.auth context contains an unexpected or untrusted property.',
  AUTH_TOKEN_INVALID:
    'Callable request.auth.token claims must be a plain object without override properties.',
  AUTH_AI_OR_AUTOMATED_FORBIDDEN:
    'Automated or AI principals are strictly forbidden from creating or accessing quarantine review drafts.',
  UNAUTHORIZED_REVIEWER:
    'Authenticated caller is not an active authorized human Library reviewer.',
  INVALID_TIMESTAMP:
    'Server clock produced an invalid or non-monotonic ISO-8601 UTC timestamp.',
  SOURCE_RECEIPT_NOT_FOUND:
    'Authoritative quarantine receipt was not found in Firestore.',
  SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE:
    'Authoritative quarantine receipt could not be read or failed envelope validation.',
  NEEDS_RECONCILIATION_HOLD:
    'Quarantine receipt is in NeedsReconciliation hold and cannot be linked to a review draft.',
  SOURCE_STATE_NOT_ELIGIBLE:
    'Quarantine receipt is not in the required Quarantined state.',
  CANDIDATE_CONTRACT_REJECTED:
    'Quarantine receipt failed LIB-FILE-REVIEW-01A review candidate contract assessment.',
  GCS_READBACK_UNVERIFIED:
    'Generation-pinned GCS quarantine object readback verification failed or was inconclusive.',
  GCS_ATTESTATION_MISMATCH:
    'Generation-pinned GCS readback attestation did not match the authoritative Quarantined receipt.',
  STALE_SOURCE_HOLD:
    'Authoritative source receipt changed between GCS readback and Firestore transaction.',
  EXISTING_DRAFT_CONFLICT_HOLD:
    'Existing quarantine review draft conflicts with the authoritative source receipt version.',
  CORRUPTED_PERSISTED_DRAFT_HOLD:
    'Persisted quarantine review draft failed integrity or security posture validation.',
  TRANSACTION_CONFLICT_OR_FAILURE_HOLD:
    'Atomic Firestore review draft transaction failed or conflicted; commit outcome is unconfirmed.',
  UNSAFE_BUCKET_BINDING_HOLD:
    'Dedicated quarantine storage bucket binding failed safety verification.',
  BRIDGE_DEPENDENCY_INVALID_HOLD:
    'Callable bridge runtime dependencies failed initialization or contract validation.',
} as const);

const ALLOWED_BRIDGE_SAFE_MESSAGES: ReadonlySet<string> = new Set(
  Object.values(BRIDGE_SAFE_MESSAGES)
);

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

function sanitizeConstantBridgeMessage(message: string): string {
  const safeBase = ALLOWED_BRIDGE_SAFE_MESSAGES.has(message)
    ? message
    : BRIDGE_SAFE_MESSAGES.TRANSACTION_CONFLICT_OR_FAILURE_HOLD;

  const redacted = safeBase
    .replace(
      /library\/quarantine\/[0-9a-f]{32}\/source\.(?:pdf|docx)/gi,
      '[REDACTED_QUARANTINE_PATH]'
    )
    .replace(
      new RegExp(LIBRARY_QUARANTINE_STORAGE_PREFIX, 'gi'),
      '[REDACTED_PREFIX]'
    )
    .replace(/https?:\/\/[^\s"']+/gi, '[REDACTED_URL]')
    .replace(/gs:\/\/[^\s"']+/gi, '[REDACTED_GS_URI]');

  return stripControlAndBidiChars(redacted).trim();
}

function mapErrorCodeToCallableStatus(
  errorCode: LibraryQuarantineReviewDraftCallableBridgeErrorCode
): LibraryQuarantineReviewDraftCallableErrorStatus {
  switch (errorCode) {
    case 'UNAUTHENTICATED_CALLER_HOLD':
      return 'unauthenticated';
    case 'CORS_ORIGIN_FORBIDDEN_HOLD':
    case 'UNAUTHORIZED_REVIEWER_HOLD':
      return 'permission-denied';
    case 'INVALID_SERVICE_INPUT_HOLD':
    case 'UNTRUSTED_CALLER_FIELD_HOLD':
    case 'INVALID_RECEIPT_ID_HOLD':
      return 'invalid-argument';
    case 'SOURCE_RECEIPT_NOT_FOUND_HOLD':
      return 'not-found';
    case 'INVALID_TIMESTAMP_HOLD':
    case 'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD':
    case 'NEEDS_RECONCILIATION_HOLD':
    case 'SOURCE_STATE_NOT_ELIGIBLE_HOLD':
    case 'CANDIDATE_CONTRACT_REJECTED_HOLD':
    case 'GCS_READBACK_UNVERIFIED_HOLD':
    case 'GCS_ATTESTATION_MISMATCH_HOLD':
      return 'failed-precondition';
    case 'STALE_SOURCE_HOLD':
    case 'EXISTING_DRAFT_CONFLICT_HOLD':
    case 'TRANSACTION_CONFLICT_OR_FAILURE_HOLD':
      return 'aborted';
    case 'CORRUPTED_PERSISTED_DRAFT_HOLD':
    case 'UNSAFE_BUCKET_BINDING_HOLD':
    case 'BRIDGE_DEPENDENCY_INVALID_HOLD':
      return 'internal';
  }
}

function mapHoldReasonCodeToSafeBridgeMessage(
  holdReasonCode: LibraryQuarantineReviewDraftHoldReasonCode
): string {
  switch (holdReasonCode) {
    case 'INVALID_SERVICE_INPUT_HOLD':
      return BRIDGE_SAFE_MESSAGES.DATA_NOT_PLAIN_OBJECT;
    case 'UNTRUSTED_CALLER_FIELD_HOLD':
      return BRIDGE_SAFE_MESSAGES.DATA_UNEXPECTED_FIELD;
    case 'INVALID_RECEIPT_ID_HOLD':
      return BRIDGE_SAFE_MESSAGES.DATA_INVALID_RECEIPT_ID;
    case 'UNAUTHORIZED_REVIEWER_HOLD':
      return BRIDGE_SAFE_MESSAGES.UNAUTHORIZED_REVIEWER;
    case 'INVALID_TIMESTAMP_HOLD':
      return BRIDGE_SAFE_MESSAGES.INVALID_TIMESTAMP;
    case 'SOURCE_RECEIPT_NOT_FOUND_HOLD':
      return BRIDGE_SAFE_MESSAGES.SOURCE_RECEIPT_NOT_FOUND;
    case 'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD':
      return BRIDGE_SAFE_MESSAGES.SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE;
    case 'NEEDS_RECONCILIATION_HOLD':
      return BRIDGE_SAFE_MESSAGES.NEEDS_RECONCILIATION_HOLD;
    case 'SOURCE_STATE_NOT_ELIGIBLE_HOLD':
      return BRIDGE_SAFE_MESSAGES.SOURCE_STATE_NOT_ELIGIBLE;
    case 'CANDIDATE_CONTRACT_REJECTED_HOLD':
      return BRIDGE_SAFE_MESSAGES.CANDIDATE_CONTRACT_REJECTED;
    case 'GCS_READBACK_UNVERIFIED_HOLD':
      return BRIDGE_SAFE_MESSAGES.GCS_READBACK_UNVERIFIED;
    case 'GCS_ATTESTATION_MISMATCH_HOLD':
      return BRIDGE_SAFE_MESSAGES.GCS_ATTESTATION_MISMATCH;
    case 'STALE_SOURCE_HOLD':
      return BRIDGE_SAFE_MESSAGES.STALE_SOURCE_HOLD;
    case 'EXISTING_DRAFT_CONFLICT_HOLD':
      return BRIDGE_SAFE_MESSAGES.EXISTING_DRAFT_CONFLICT_HOLD;
    case 'CORRUPTED_PERSISTED_DRAFT_HOLD':
      return BRIDGE_SAFE_MESSAGES.CORRUPTED_PERSISTED_DRAFT_HOLD;
    case 'TRANSACTION_CONFLICT_OR_FAILURE_HOLD':
      return BRIDGE_SAFE_MESSAGES.TRANSACTION_CONFLICT_OR_FAILURE_HOLD;
  }
}

function makeBridgeFailureDto(
  errorCode: LibraryQuarantineReviewDraftCallableBridgeErrorCode,
  constantMessage: string,
  receiptId: string | null,
  draftCreationOutcome: LibraryQuarantineReviewDraftStoreFailureOutcome = 'NOT_CREATED'
): LibraryQuarantineReviewDraftCallableBridgeFailureDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    callableStatus: mapErrorCodeToCallableStatus(errorCode),
    errorCode,
    errorMessage: sanitizeConstantBridgeMessage(constantMessage),
    receiptId: safeReceiptId,
    draftCreationOutcome,
    draftCreated: draftCreationOutcome === 'NOT_CREATED' ? (false as const) : null,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
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

/**
 * Wraps the dedicated quarantine bucket handle so that `file(...).save(...)`
 * is unconditionally blocked during review draft linkage. Only generation-pinned
 * `getMetadata()` and `createReadStream()` are permitted.
 */
function createReadOnlyQuarantineBucketView(
  underlyingBucket: GcsLibraryQuarantineBucket
): GcsLibraryQuarantineBucket {
  return Object.freeze({
    name: underlyingBucket.name,
    file(
      objectPath: string,
      options?: GcsLibraryQuarantineFileOptions
    ): GcsLibraryQuarantineFile {
      const underlyingFile = underlyingBucket.file(objectPath, options);
      if (
        !underlyingFile ||
        typeof underlyingFile !== 'object' ||
        typeof underlyingFile.getMetadata !== 'function' ||
        typeof underlyingFile.createReadStream !== 'function'
      ) {
        throw new Error(
          'UNSAFE_BUCKET_BINDING: Underlying GCS file handle is invalid.'
        );
      }
      return Object.freeze({
        name: underlyingFile.name,
        ...(underlyingFile.generation !== undefined
          ? { generation: underlyingFile.generation }
          : {}),
        async save(
          _data: Buffer,
          _options: GcsLibraryQuarantineSaveOptions
        ): Promise<void> {
          throw new Error(
            'GCS_WRITE_FORBIDDEN: GCS file.save() is strictly forbidden in LIB-FILE-REVIEW-01C callable bridge.'
          );
        },
        getMetadata: () => underlyingFile.getMetadata(),
        createReadStream: () => underlyingFile.createReadStream(),
      });
    },
  });
}

/**
 * Validates and extracts a request-scoped `TrustedQuarantineReviewerPrincipalProvider`
 * from the Firebase Functions v2 callable `request.auth` context.
 *
 * Never reads from `request.data`, headers, or shared globals.
 */
export function createRequestScopedCallablePrincipalProvider(
  rawCallableAuth: unknown
):
  | {
      readonly ok: true;
      readonly principalProvider: TrustedQuarantineReviewerPrincipalProvider;
    }
  | {
      readonly ok: false;
      readonly errorCode:
        | 'UNAUTHENTICATED_CALLER_HOLD'
        | 'UNAUTHORIZED_REVIEWER_HOLD';
      readonly constantMessage: string;
    } {
  if (!isPlainRecord(rawCallableAuth)) {
    return {
      ok: false,
      errorCode: 'UNAUTHENTICATED_CALLER_HOLD',
      constantMessage: BRIDGE_SAFE_MESSAGES.AUTH_MISSING_OR_MALFORMED,
    };
  }

  if (
    hasUnexpectedPropertyOrSymbol(rawCallableAuth, ALLOWED_CALLABLE_AUTH_KEYS)
  ) {
    return {
      ok: false,
      errorCode: 'UNAUTHORIZED_REVIEWER_HOLD',
      constantMessage: BRIDGE_SAFE_MESSAGES.AUTH_UNEXPECTED_FIELD,
    };
  }

  const rawUid = rawCallableAuth.uid;
  if (
    typeof rawUid !== 'string' ||
    rawUid.trim() !== rawUid ||
    !isValidUploaderUid(rawUid)
  ) {
    return {
      ok: false,
      errorCode: 'UNAUTHENTICATED_CALLER_HOLD',
      constantMessage: BRIDGE_SAFE_MESSAGES.AUTH_MISSING_OR_MALFORMED,
    };
  }

  let sanitizedToken: Readonly<Record<string, unknown>> | undefined;
  if (rawCallableAuth.token !== undefined) {
    if (!isPlainRecord(rawCallableAuth.token)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_REVIEWER_HOLD',
        constantMessage: BRIDGE_SAFE_MESSAGES.AUTH_TOKEN_INVALID,
      };
    }

    if (Object.getOwnPropertySymbols(rawCallableAuth.token).length > 0) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_REVIEWER_HOLD',
        constantMessage: BRIDGE_SAFE_MESSAGES.AUTH_TOKEN_INVALID,
      };
    }

    for (const tokenKey of Object.getOwnPropertyNames(rawCallableAuth.token)) {
      if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(tokenKey)) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_REVIEWER_HOLD',
          constantMessage: BRIDGE_SAFE_MESSAGES.AUTH_TOKEN_INVALID,
        };
      }
    }

    if (hasAutomatedOrAiTokenClaim(rawCallableAuth.token)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_REVIEWER_HOLD',
        constantMessage: BRIDGE_SAFE_MESSAGES.AUTH_AI_OR_AUTOMATED_FORBIDDEN,
      };
    }

    const tokenCopy: Record<string, unknown> = {};
    for (const key of Object.keys(rawCallableAuth.token)) {
      tokenCopy[key] = rawCallableAuth.token[key];
    }
    sanitizedToken = Object.freeze(tokenCopy);
  }

  const frozenPrincipal: TrustedQuarantineAuthenticatedPrincipal = Object.freeze(
    sanitizedToken !== undefined
      ? { uid: rawUid, token: sanitizedToken }
      : { uid: rawUid }
  );

  const principalProvider: TrustedQuarantineReviewerPrincipalProvider =
    Object.freeze({
      resolveAuthenticatedPrincipal(): TrustedQuarantineAuthenticatedPrincipal {
        return frozenPrincipal;
      },
    });

  return {
    ok: true,
    principalProvider,
  };
}

/**
 * Assembles the production dependency graph for the Library Quarantine Review
 * Draft Callable Bridge, binding explicitly and exclusively to the dedicated
 * quarantine bucket `promiseofplanet-bb325-library-quarantine`.
 *
 * NEVER calls `storage.bucket()` without an explicit bucket name, NEVER binds
 * to `promiseofplanet-bb325.firebasestorage.app`, and NEVER caches any
 * authenticated principal across requests.
 */
export function createProductionLibraryQuarantineReviewDraftBridgeRuntime(
  overrides?: ProductionLibraryQuarantineReviewDraftBridgeRuntimeOverrides
): ProductionLibraryQuarantineReviewDraftBridgeRuntime {
  const rawOverrides: unknown = overrides;
  if (rawOverrides !== undefined) {
    if (
      !isPlainRecord(rawOverrides) ||
      hasUnexpectedPropertyOrSymbol(rawOverrides, ALLOWED_RUNTIME_OVERRIDE_KEYS)
    ) {
      throw new Error(
        'UNSAFE_BUCKET_BINDING: Unexpected or forbidden property in bridge runtime overrides.'
      );
    }
  }

  const needsFirestore =
    !overrides?.adminRepository ||
    !overrides?.receiptStore ||
    !overrides?.draftStore;

  const firestoreInstance = needsFirestore
    ? (overrides?.getFirestore ?? getFirestore)()
    : undefined;

  let storageReadbackPort: LibraryQuarantineGcsReadbackPort;
  if (overrides?.storageReadbackPort !== undefined) {
    if (
      !overrides.storageReadbackPort ||
      typeof overrides.storageReadbackPort.verifyExistingQuarantineObject !==
        'function'
    ) {
      throw new Error(
        'INVALID_BRIDGE_DEPENDENCY: Provided storageReadbackPort must implement verifyExistingQuarantineObject(input).'
      );
    }
    storageReadbackPort = overrides.storageReadbackPort;
  } else {
    const resolveStorage = overrides?.getStorage ?? getStorage;
    const storageInstance = resolveStorage();
    if (
      !storageInstance ||
      typeof storageInstance !== 'object' ||
      typeof storageInstance.bucket !== 'function'
    ) {
      throw new Error(
        'UNSAFE_BUCKET_BINDING: Storage SDK instance is missing a valid bucket(name) method.'
      );
    }

    const rawBucket = storageInstance.bucket(
      LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    ) as GcsLibraryQuarantineBucket | null | undefined;

    if (
      !rawBucket ||
      typeof rawBucket !== 'object' ||
      typeof rawBucket.file !== 'function'
    ) {
      throw new Error(
        'UNSAFE_BUCKET_BINDING: Dedicated library quarantine bucket handle is invalid.'
      );
    }

    const resolvedBucketName = rawBucket.name;
    if (
      typeof resolvedBucketName !== 'string' ||
      resolvedBucketName.trim() === '' ||
      resolvedBucketName === FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME ||
      resolvedBucketName !== LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    ) {
      throw new Error(
        `UNSAFE_BUCKET_BINDING: Resolved bucket name does not match required dedicated quarantine bucket "${LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME}".`
      );
    }

    const readOnlyBucket = createReadOnlyQuarantineBucketView(rawBucket);
    storageReadbackPort = new GcsLibraryQuarantineStorageAdapter({
      bucket: readOnlyBucket,
      ...(overrides?.clock !== undefined ? { clock: overrides.clock } : {}),
    });
  }

  const adminRepository: Pick<AdminRepository, 'getAdminByUid'> =
    overrides?.adminRepository ??
    new FirestoreAdminRepository(firestoreInstance as FirestoreAdminDatabase);

  const receiptStore: LibraryQuarantineReceiptReadOnlyPort =
    overrides?.receiptStore ??
    new FirestoreLibraryQuarantineReceiptStore(
      firestoreInstance as LibraryQuarantineFirestoreDatabase
    );

  const draftStore: LibraryQuarantineReviewDraftStore =
    overrides?.draftStore ??
    new FirestoreLibraryQuarantineReviewDraftStore(
      firestoreInstance as LibraryQuarantineReviewDraftFirestoreDatabase
    );

  if (
    !adminRepository ||
    typeof adminRepository.getAdminByUid !== 'function' ||
    !receiptStore ||
    typeof receiptStore.getReceiptById !== 'function' ||
    !draftStore ||
    typeof draftStore.createReviewDraftIfAbsentAtomically !== 'function' ||
    typeof draftStore.getReviewDraftByReceiptId !== 'function'
  ) {
    throw new Error(
      'INVALID_BRIDGE_DEPENDENCY: Production bridge runtime dependencies failed interface validation.'
    );
  }

  return Object.freeze({
    targetBucketName: LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
    adminRepository,
    receiptStore,
    storageReadbackPort,
    draftStore,
    ...(overrides?.clock !== undefined ? { clock: overrides.clock } : {}),
  });
}

function validateOptionalOriginHeader(
  request: LibraryQuarantineReviewDraftCallableRequest,
  trustedOrigins: ReadonlySet<string>
): boolean {
  const headers = request.rawRequest?.headers;
  if (!headers || typeof headers !== 'object') {
    return true;
  }

  for (const [key, rawVal] of Object.entries(headers)) {
    if (key.toLowerCase() === 'origin' && rawVal !== undefined) {
      if (typeof rawVal !== 'string') {
        return false;
      }
      const trimmed = rawVal.trim();
      if (
        trimmed === '' ||
        trimmed === '*' ||
        !trustedOrigins.has(trimmed)
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Executes the server-side callable bridge for a single request:
 * 1. Validates optional `Origin` header against the fixed allowlist (no wildcard).
 * 2. Validates `request.data` as an exact plain `{ receiptId }` object before
 *    touching auth, AdminRepository, Firestore receipts, or GCS.
 * 3. Validates `request.auth` from the callable SDK context and constructs a
 *    fresh request-scoped `TrustedQuarantineReviewerPrincipalProvider`.
 * 4. Instantiates `LibraryQuarantineReviewDraftPersistenceService` for this
 *    request and delegates once to `linkQuarantineReceiptToReviewDraft({ receiptId })`.
 * 5. Projects the outcome into the minimal 13-key sanitized response DTO.
 */
export async function executeLibraryQuarantineReviewDraftCallableBridge(
  request: unknown,
  dependencies: LibraryQuarantineReviewDraftCallableBridgeDependencies
): Promise<LibraryQuarantineReviewDraftCallableBridgeResponseDto> {
  if (
    !dependencies ||
    typeof dependencies !== 'object' ||
    !dependencies.adminRepository ||
    typeof dependencies.adminRepository.getAdminByUid !== 'function' ||
    !dependencies.receiptStore ||
    typeof dependencies.receiptStore.getReceiptById !== 'function' ||
    !dependencies.storageReadbackPort ||
    typeof dependencies.storageReadbackPort.verifyExistingQuarantineObject !==
      'function' ||
    !dependencies.draftStore ||
    typeof dependencies.draftStore.createReviewDraftIfAbsentAtomically !==
      'function' ||
    typeof dependencies.draftStore.getReviewDraftByReceiptId !== 'function'
  ) {
    return makeBridgeFailureDto(
      'BRIDGE_DEPENDENCY_INVALID_HOLD',
      BRIDGE_SAFE_MESSAGES.BRIDGE_DEPENDENCY_INVALID_HOLD,
      null,
      'NOT_CREATED'
    );
  }

  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request)
  ) {
    return makeBridgeFailureDto(
      'INVALID_SERVICE_INPUT_HOLD',
      BRIDGE_SAFE_MESSAGES.REQUEST_ENVELOPE_INVALID,
      null,
      'NOT_CREATED'
    );
  }

  const callableReq = request as LibraryQuarantineReviewDraftCallableRequest;
  const trustedOrigins =
    dependencies.trustedOrigins ?? DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS;

  if (!validateOptionalOriginHeader(callableReq, trustedOrigins)) {
    return makeBridgeFailureDto(
      'CORS_ORIGIN_FORBIDDEN_HOLD',
      BRIDGE_SAFE_MESSAGES.CORS_ORIGIN_FORBIDDEN,
      null,
      'NOT_CREATED'
    );
  }

  // Step 1: Validate request.data strictly as an exact plain { receiptId } object
  // BEFORE any principal resolution, AdminRepository lookup, receipt read, or GCS access.
  const rawData = callableReq.data;
  if (!isPlainRecord(rawData)) {
    return makeBridgeFailureDto(
      'INVALID_SERVICE_INPUT_HOLD',
      BRIDGE_SAFE_MESSAGES.DATA_NOT_PLAIN_OBJECT,
      null,
      'NOT_CREATED'
    );
  }

  if (hasUnexpectedPropertyOrSymbol(rawData, ALLOWED_CALLABLE_DATA_KEYS)) {
    const candidateReceiptId = isValidLibraryQuarantineReceiptId(
      rawData.receiptId
    )
      ? rawData.receiptId
      : null;
    return makeBridgeFailureDto(
      'UNTRUSTED_CALLER_FIELD_HOLD',
      BRIDGE_SAFE_MESSAGES.DATA_UNEXPECTED_FIELD,
      candidateReceiptId,
      'NOT_CREATED'
    );
  }

  if (!Object.prototype.hasOwnProperty.call(rawData, 'receiptId')) {
    return makeBridgeFailureDto(
      'INVALID_SERVICE_INPUT_HOLD',
      BRIDGE_SAFE_MESSAGES.DATA_MISSING_RECEIPT_ID,
      null,
      'NOT_CREATED'
    );
  }

  const rawReceiptId = rawData.receiptId;
  if (!isValidLibraryQuarantineReceiptId(rawReceiptId)) {
    return makeBridgeFailureDto(
      'INVALID_RECEIPT_ID_HOLD',
      BRIDGE_SAFE_MESSAGES.DATA_INVALID_RECEIPT_ID,
      null,
      'NOT_CREATED'
    );
  }

  const receiptId: string = rawReceiptId;

  // Step 2: Resolve request-scoped principal provider exclusively from callable request.auth
  const providerSetup = createRequestScopedCallablePrincipalProvider(
    callableReq.auth
  );
  if (!providerSetup.ok) {
    return makeBridgeFailureDto(
      providerSetup.errorCode,
      providerSetup.constantMessage,
      receiptId,
      'NOT_CREATED'
    );
  }

  // Step 3: Instantiate request-scoped service and invoke linkQuarantineReceiptToReviewDraft once
  let service: LibraryQuarantineReviewDraftServicePort;
  try {
    service = dependencies.createPersistenceService
      ? dependencies.createPersistenceService({
          trustedPrincipalProvider: providerSetup.principalProvider,
          adminRepository: dependencies.adminRepository,
          receiptStore: dependencies.receiptStore,
          storageReadbackPort: dependencies.storageReadbackPort,
          draftStore: dependencies.draftStore,
          ...(dependencies.clock !== undefined
            ? { clock: dependencies.clock }
            : {}),
        })
      : new LibraryQuarantineReviewDraftPersistenceService({
          trustedPrincipalProvider: providerSetup.principalProvider,
          adminRepository: dependencies.adminRepository,
          receiptStore: dependencies.receiptStore,
          storageReadbackPort: dependencies.storageReadbackPort,
          draftStore: dependencies.draftStore,
          ...(dependencies.clock !== undefined
            ? { clock: dependencies.clock }
            : {}),
        });
  } catch {
    return makeBridgeFailureDto(
      'BRIDGE_DEPENDENCY_INVALID_HOLD',
      BRIDGE_SAFE_MESSAGES.BRIDGE_DEPENDENCY_INVALID_HOLD,
      receiptId,
      'NOT_CREATED'
    );
  }

  let serviceResult: LinkLibraryQuarantineReviewDraftResult;
  try {
    serviceResult = await service.linkQuarantineReceiptToReviewDraft(
      Object.freeze({ receiptId })
    );
  } catch {
    return makeBridgeFailureDto(
      'TRANSACTION_CONFLICT_OR_FAILURE_HOLD',
      BRIDGE_SAFE_MESSAGES.TRANSACTION_CONFLICT_OR_FAILURE_HOLD,
      receiptId,
      'UNKNOWN'
    );
  }

  if (!serviceResult || typeof serviceResult !== 'object') {
    return makeBridgeFailureDto(
      'TRANSACTION_CONFLICT_OR_FAILURE_HOLD',
      BRIDGE_SAFE_MESSAGES.TRANSACTION_CONFLICT_OR_FAILURE_HOLD,
      receiptId,
      'UNKNOWN'
    );
  }

  if (!serviceResult.ok) {
    const holdCode: LibraryQuarantineReviewDraftHoldReasonCode =
      serviceResult.holdReasonCode ?? 'TRANSACTION_CONFLICT_OR_FAILURE_HOLD';
    const outcome: LibraryQuarantineReviewDraftStoreFailureOutcome =
      serviceResult.draftCreationOutcome === 'NOT_CREATED' &&
      serviceResult.draftCreated === false &&
      serviceResult.transactionAttempted === false
        ? 'NOT_CREATED'
        : serviceResult.draftCreationOutcome === 'NOT_CREATED' &&
            serviceResult.draftCreated === false &&
            holdCode !== 'TRANSACTION_CONFLICT_OR_FAILURE_HOLD'
          ? 'NOT_CREATED'
          : 'UNKNOWN';

    return makeBridgeFailureDto(
      holdCode,
      mapHoldReasonCodeToSafeBridgeMessage(holdCode),
      receiptId,
      outcome
    );
  }

  // Step 4: Verify strict invariants on service success result before projecting minimal DTO
  const validDisposition =
    serviceResult.disposition === 'CREATED' ||
    serviceResult.disposition === 'IDEMPOTENT_EXISTING';
  const expectedCreatedBool = serviceResult.disposition === 'CREATED';

  if (
    serviceResult.status !== 'LINKED_PENDING_HUMAN_REVIEW' ||
    serviceResult.receiptId !== receiptId ||
    typeof serviceResult.sourceRevision !== 'number' ||
    !Number.isSafeInteger(serviceResult.sourceRevision) ||
    serviceResult.sourceRevision < 1 ||
    !validDisposition ||
    serviceResult.draftCreationOutcome !== serviceResult.disposition ||
    serviceResult.created !== expectedCreatedBool ||
    serviceResult.draftCreated !== expectedCreatedBool ||
    !serviceResult.draft ||
    typeof serviceResult.draft !== 'object' ||
    serviceResult.draft.receiptId !== receiptId ||
    serviceResult.draft.sourceRevision !== serviceResult.sourceRevision ||
    serviceResult.draft.reviewState !==
      LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE ||
    serviceResult.draft.isSanitized !== false ||
    serviceResult.draft.isVerifiedSafe !== false ||
    serviceResult.draft.isRightsApproved !== false ||
    serviceResult.draft.isPublished !== false ||
    serviceResult.draft.isReadyForPeia !== false ||
    serviceResult.isSanitized !== false ||
    serviceResult.isVerifiedSafe !== false ||
    serviceResult.isRightsApproved !== false ||
    serviceResult.isPublished !== false ||
    serviceResult.isReadyForPeia !== false
  ) {
    return makeBridgeFailureDto(
      'CORRUPTED_PERSISTED_DRAFT_HOLD',
      BRIDGE_SAFE_MESSAGES.CORRUPTED_PERSISTED_DRAFT_HOLD,
      receiptId,
      'UNKNOWN'
    );
  }

  const responseDto: LibraryQuarantineReviewDraftCallableBridgeSuccessDto =
    Object.freeze({
      ok: true as const,
      status: 'LINKED_PENDING_HUMAN_REVIEW' as const,
      receiptId,
      sourceRevision: serviceResult.sourceRevision,
      reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
      disposition: serviceResult.disposition,
      draftCreationOutcome: serviceResult.draftCreationOutcome,
      draftCreated: serviceResult.draftCreated,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });

  if (
    hasUnexpectedPropertyOrSymbol(
      responseDto as unknown as Record<string, unknown>,
      ALLOWED_SUCCESS_DTO_KEYS
    )
  ) {
    return makeBridgeFailureDto(
      'CORRUPTED_PERSISTED_DRAFT_HOLD',
      BRIDGE_SAFE_MESSAGES.CORRUPTED_PERSISTED_DRAFT_HOLD,
      receiptId,
      'UNKNOWN'
    );
  }

  return responseDto;
}

let cachedProductionBridgeRuntime: ProductionLibraryQuarantineReviewDraftBridgeRuntime | null =
  null;

function getOrCreateProductionLibraryQuarantineReviewDraftBridgeRuntime(): ProductionLibraryQuarantineReviewDraftBridgeRuntime {
  if (!cachedProductionBridgeRuntime) {
    cachedProductionBridgeRuntime =
      createProductionLibraryQuarantineReviewDraftBridgeRuntime();
  }
  return cachedProductionBridgeRuntime;
}

/**
 * Unregistered Firebase Functions v2 callable declaration for linking a verified
 * `Quarantined` upload receipt to its durable `PENDING_HUMAN_REVIEW` draft.
 *
 * RELEASE GATE NOTE:
 * This symbol is intentionally NOT exported from `functions/src/index.ts` and is
 * NOT deployed in `LIB-FILE-REVIEW-01C`.
 */
export const libraryQuarantineReviewDraftLinkCallable = onCall(
  LIBRARY_QUARANTINE_REVIEW_DRAFT_CALLABLE_OPTIONS,
  async (
    request: CallableRequest<unknown>
  ): Promise<LibraryQuarantineReviewDraftCallableBridgeResponseDto> => {
    let runtime: ProductionLibraryQuarantineReviewDraftBridgeRuntime;
    try {
      runtime =
        getOrCreateProductionLibraryQuarantineReviewDraftBridgeRuntime();
    } catch {
      return makeBridgeFailureDto(
        'UNSAFE_BUCKET_BINDING_HOLD',
        BRIDGE_SAFE_MESSAGES.UNSAFE_BUCKET_BINDING_HOLD,
        null,
        'NOT_CREATED'
      );
    }

    return executeLibraryQuarantineReviewDraftCallableBridge(
      {
        auth: request.auth
          ? {
              uid: request.auth.uid,
              token: request.auth.token as Readonly<Record<string, unknown>>,
            }
          : null,
        data: request.data,
        rawRequest: request.rawRequest
          ? {
              headers: request.rawRequest.headers as Readonly<
                Record<string, string | string[] | undefined>
              >,
            }
          : undefined,
      },
      {
        adminRepository: runtime.adminRepository,
        receiptStore: runtime.receiptStore,
        storageReadbackPort: runtime.storageReadbackPort,
        draftStore: runtime.draftStore,
        ...(runtime.clock !== undefined ? { clock: runtime.clock } : {}),
      }
    );
  }
);
