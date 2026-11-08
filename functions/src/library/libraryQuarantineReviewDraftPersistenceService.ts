import type { AdminRepository } from '../admin/adminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
  isValidAdminRole,
  type AdminUser,
} from '../types/admin';
import {
  LIBRARY_QUARANTINE_STORAGE_PREFIX,
  LibraryQuarantineReceiptState,
  deriveLibraryQuarantineStoragePath,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  parseLibraryQuarantineStoragePath,
  toSanitizedLibraryQuarantineAdminReceiptDto,
  type LibraryQuarantineInternalReceipt,
  type SanitizedLibraryQuarantineAdminReceiptDto,
  type TrustedStorageReadbackAttestation,
} from './libraryQuarantineReceiptContract';
import {
  validatePersistedLibraryQuarantineReceiptEnvelope,
  type LibraryQuarantinePersistedReceiptEnvelope,
  type LibraryQuarantineReceiptStore,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  parseCanonicalSafeGcsGeneration,
  type LibraryQuarantineGcsAdapterResult,
  type VerifyExistingLibraryQuarantineObjectInput,
} from './gcsLibraryQuarantineStorageAdapter';
import type { LibraryQuarantineGcsReadbackPort } from './libraryQuarantineRecoveryCoordinator';
import {
  areQuarantineReviewCandidatesSameSourceVersion,
  assessLibraryQuarantineReviewCandidate,
  type LibraryQuarantineReviewCandidate,
} from './libraryQuarantineReviewDraftContract';
import {
  doesPersistedReviewDraftMatchCandidateAndSource,
  validatePersistedLibraryQuarantineReviewDraft,
  type CreateLibraryQuarantineReviewDraftDisposition,
  type LibraryQuarantinePersistedReviewDraft,
  type LibraryQuarantineReviewDraftStore,
  type LibraryQuarantineReviewDraftStoreFailureOutcome,
} from './firestoreLibraryQuarantineReviewDraftStore';

/**
 * LIB-FILE-REVIEW-01B/R1 — Internal Server-Only Quarantine Review Draft Persistence Service
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Dependency-injected, server-internal service that links a single verified
 *   `Quarantined` upload receipt (`library_quarantine_receipts/<receiptId>`) to
 *   a durable, private review draft (`library_quarantine_review_drafts/<receiptId>`)
 *   with `reviewState: 'PENDING_HUMAN_REVIEW'`.
 * - NOT WIRED to `functions/src/index.ts`, any callable endpoint, Express route,
 *   or React UI component.
 *
 * - R1-A / SERVER-AUTHENTICATED TRUST BOUNDARY (NO CALLER-SUPPLIED AUTH/UID):
 *   1. Caller operation payload is strictly `{ receiptId }`. Any caller-supplied
 *      `auth`, `uid`, `token`, `role`, `candidate`, `generation`, `isAuthorized`,
 *      `adminUser`, or other extra property is rejected (`UNTRUSTED_CALLER_FIELD_HOLD`)
 *      before any principal resolution, `AdminRepository` lookup, receipt read, or
 *      GCS access.
 *   2. Requires an injected server-side request-scoped `trustedPrincipalProvider`
 *      (`TrustedQuarantineReviewerPrincipalProvider`) that resolves the authenticated
 *      principal `{ uid, token? }` directly from server-authenticated context rather
 *      than caller-controlled operation data.
 *   3. IMPORTANT WIRING CONTRACT: This internal-only unit does NOT wire Firebase Auth
 *      or any HTTP/callable endpoint. When a future server entry point wires this
 *      service, `trustedPrincipalProvider` MUST be instantiated per request and bound
 *      exclusively to already-verified Firebase Auth server context (e.g.
 *      `request.auth` / `verifyIdToken`). In-memory test principal providers in unit
 *      tests verify only the local service contract, NOT production Firebase Auth
 *      cryptographic token verification.
 *   4. After resolving the authenticated UID from `trustedPrincipalProvider` and
 *      rejecting any AI/automated token claims, the service loads the canonical
 *      `AdminUser` via `AdminRepository.getAdminByUid(uid)` and enforces active
 *      human Library reviewer authorization (`Owner`, `LibraryCurator`, or
 *      `RightsReviewer` with `AdminPermission.Review`, `isActive === true`, and
 *      `role !== AdminRole.AIAssistant`) BEFORE any receipt read or GCS access.
 *
 * - R1-B / SAFE FAILURE DIAGNOSTICS (NO EXCEPTION ECHO):
 *   External dependency exceptions and error bodies from `trustedPrincipalProvider`,
 *   `AdminRepository`, `receiptStore`, `storageReadbackPort`, `draftStore`, and the
 *   Firestore SDK are treated as untrusted. Result `errorMessage` strings are
 *   selected exclusively from a frozen compile-time catalog of non-sensitive
 *   constant messages. Unknown property names, caller-controlled values, and raw
 *   exception `.message` strings are never echoed into results.
 *
 * - R1-C / TRUTHFUL AMBIGUOUS COMMIT OUTCOME:
 *   - Pre-transaction failures (and contractually proven pre-create transaction
 *     aborts where no `transaction.create` was staged in any attempt) report
 *     `draftCreationOutcome: 'NOT_CREATED'` and `draftCreated: false`.
 *   - If the draft-store transaction throws, fails at commit, loses its commit
 *     acknowledgement, or fails post-transaction validation, the service reports
 *     `draftCreationOutcome: 'UNKNOWN'` and `draftCreated: null` rather than falsely
 *     asserting `draftCreated: false`. A subsequent idempotent replay converges to
 *     `IDEMPOTENT_EXISTING` with the original `createdBy` and `createdAt`.
 *
 * - EXPLICIT GCS-TO-FIRESTORE TOCTOU WARNING:
 *   Because Google Cloud Storage is external to Firestore transactions, verifying
 *   the GCS object prior to the Firestore transaction does NOT guarantee that the
 *   GCS object cannot be altered out-of-band afterward. Any future workflow that
 *   parses, sanitizes, or consumes the quarantined binary MUST perform a fresh
 *   generation-pinned GCS readback check against `sourceSha256` and the receipt's
 *   pinned `generation`. This service never emits raw bytes, `storagePath`,
 *   `generation`, `attestation`, or any URL.
 */

export const LIBRARY_QUARANTINE_REVIEW_DRAFT_REMAINING_GATES = Object.freeze([
  'HUMAN_REVIEW_UI_NOT_WIRED',
  'PDF_ISOLATED_PARSER_REQUIRED',
  'DOCX_SANITIZATION_PENDING',
  'RIGHTS_UNVERIFIED',
  'NEEDS_RECONCILIATION_HOLD',
  'NO_AUTO_PUBLICATION',
  'GCS_READBACK_REVALIDATION_REQUIRED_ON_CONSUME',
] as const);

export type LibraryQuarantineReviewDraftRemainingGate =
  (typeof LIBRARY_QUARANTINE_REVIEW_DRAFT_REMAINING_GATES)[number];

export type LibraryQuarantineReviewDraftHoldReasonCode =
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
  | 'TRANSACTION_CONFLICT_OR_FAILURE_HOLD';

export type LibraryQuarantineReviewDraftCreationOutcome =
  | CreateLibraryQuarantineReviewDraftDisposition
  | LibraryQuarantineReviewDraftStoreFailureOutcome;

/**
 * Server-authenticated principal resolved from a request-scoped trusted server
 * context (never constructed from caller-controlled operation input).
 */
export interface TrustedQuarantineAuthenticatedPrincipal {
  readonly uid: string;
  readonly token?: Readonly<Record<string, unknown>>;
}

/**
 * Request-scoped server-side provider that supplies the already-authenticated
 * principal for the current server execution context.
 *
 * NOTE: This internal module does NOT wire Firebase Auth or an endpoint. A future
 * trusted server entry point MUST instantiate this provider per request from
 * verified Firebase Auth state. Test doubles in unit tests prove only local
 * contract enforcement, not production Firebase Auth verification.
 */
export interface TrustedQuarantineReviewerPrincipalProvider {
  resolveAuthenticatedPrincipal():
    | Promise<TrustedQuarantineAuthenticatedPrincipal | null>
    | TrustedQuarantineAuthenticatedPrincipal
    | null;
}

/**
 * Caller operation payload accepts ONLY `{ receiptId }`.
 * Any `auth`, `uid`, `token`, `role`, `candidate`, `generation`, `isAuthorized`,
 * or other extra field is rejected with `UNTRUSTED_CALLER_FIELD_HOLD`.
 */
export interface LinkLibraryQuarantineReviewDraftInput {
  readonly receiptId: string;
}

export type LibraryQuarantineReceiptReadOnlyPort = Pick<
  LibraryQuarantineReceiptStore,
  'getReceiptById'
>;

export interface LibraryQuarantineReviewDraftPersistenceSuccess {
  readonly ok: true;
  readonly status: 'LINKED_PENDING_HUMAN_REVIEW';
  readonly disposition: CreateLibraryQuarantineReviewDraftDisposition;
  readonly draftCreationOutcome: CreateLibraryQuarantineReviewDraftDisposition;
  readonly created: boolean;
  readonly draftCreated: boolean;
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly draft: LibraryQuarantinePersistedReviewDraft;
  readonly candidate: LibraryQuarantineReviewCandidate;
  readonly gcsVerifyAttempted: true;
  readonly gcsSaveAttempted: false;
  readonly transactionAttempted: true;
  readonly receiptMutated: false;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
  readonly remainingDeferredGates: readonly LibraryQuarantineReviewDraftRemainingGate[];
}

export interface LibraryQuarantineReviewDraftPersistenceHold {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly holdReasonCode: LibraryQuarantineReviewDraftHoldReasonCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly sourceRevision: number | null;
  readonly gcsVerifyAttempted: boolean;
  readonly gcsSaveAttempted: false;
  readonly transactionAttempted: boolean;
  readonly draftCreationOutcome: LibraryQuarantineReviewDraftStoreFailureOutcome;
  readonly draftCreated: false | null;
  readonly receiptMutated: false;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
  readonly remainingDeferredGates: readonly LibraryQuarantineReviewDraftRemainingGate[];
}

export type LinkLibraryQuarantineReviewDraftResult =
  | LibraryQuarantineReviewDraftPersistenceSuccess
  | LibraryQuarantineReviewDraftPersistenceHold;

const ALLOWED_SERVICE_INPUT_KEYS: ReadonlySet<string> = new Set(['receiptId']);

const ALLOWED_PRINCIPAL_KEYS: ReadonlySet<string> = new Set(['uid', 'token']);

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

const ALLOWED_ATTESTATION_KEYS: ReadonlySet<string> = new Set([
  'attestedReceiptId',
  'attestedUploaderUid',
  'attestedStoragePath',
  'attestedFormat',
  'attestedContentType',
  'attestedByteSize',
  'attestedSha256',
  'attestedGeneration',
  'verifiedAtIso',
]);

const SHA256_LOWERCASE_HEX_REGEX = /^[0-9a-f]{64}$/;
const CONTROL_OR_BIDI_CHAR_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/g;

/**
 * Frozen catalog of predefined, non-sensitive constant messages for all service
 * HOLD outcomes. Dependency exception `.message` strings and caller-supplied
 * property names or values are never interpolated.
 */
const SERVICE_SAFE_MESSAGES = Object.freeze({
  INPUT_NOT_PLAIN_OBJECT:
    'Request input must be a plain non-null object containing only receiptId.',
  INPUT_UNEXPECTED_FIELD:
    'Caller-supplied input contains an unexpected or forbidden field; only receiptId is accepted.',
  INPUT_MISSING_RECEIPT_ID:
    'Request input is missing the required receiptId property.',
  INPUT_INVALID_RECEIPT_ID:
    'receiptId must be a valid 32-character lowercase hexadecimal string.',
  PRINCIPAL_RESOLUTION_FAILED:
    'Failed to resolve an authenticated reviewer principal from the server-side principal provider.',
  PRINCIPAL_UNAUTHENTICATED_OR_MALFORMED:
    'Server principal provider did not return a valid authenticated reviewer principal.',
  PRINCIPAL_UNEXPECTED_FIELD:
    'Server principal context contains an unexpected or untrusted property.',
  PRINCIPAL_TOKEN_INVALID:
    'Server principal token claims must be a plain object without override properties.',
  PRINCIPAL_AI_OR_AUTOMATED_FORBIDDEN:
    'Automated or AI principals are strictly forbidden from creating or accessing quarantine review drafts.',
  ADMIN_LOOKUP_FAILED:
    'Failed to resolve canonical AdminUser identity from server AdminRepository.',
  ADMIN_NOT_REGISTERED:
    'Authenticated principal UID is not registered as a canonical AdminUser.',
  ADMIN_ID_MISMATCH:
    'Canonical AdminUser record ID does not match the authenticated principal UID.',
  ADMIN_INACTIVE:
    'Authenticated AdminUser is inactive and holds zero effective permissions.',
  ADMIN_ROLE_INVALID:
    'Authenticated AdminUser has an unrecognized administrative role.',
  ADMIN_ROLE_AI_FORBIDDEN:
    'Automated AI Assistant accounts are forbidden from reviewing or linking quarantine drafts.',
  ADMIN_DOMAIN_NOT_AUTHORIZED:
    'Authenticated AdminUser role is not authorized for Library quarantine review.',
  ADMIN_PERMISSION_MISSING:
    'Authenticated AdminUser lacks the required Review permission.',
  CLOCK_INVALID_TIMESTAMP:
    'Server clock produced an invalid ISO-8601 UTC timestamp.',
  CLOCK_BEFORE_SOURCE_UPDATED_AT:
    'Server clock timestamp cannot be earlier than the source receipt updatedAt timestamp.',
  SOURCE_RECEIPT_NOT_FOUND:
    'Authoritative quarantine receipt was not found in Firestore.',
  SOURCE_RECEIPT_READ_OR_VALIDATION_FAILED:
    'Authoritative quarantine receipt could not be read or failed envelope validation.',
  SOURCE_RECEIPT_STORAGE_PATH_INVALID:
    'Persisted quarantine receipt storagePath failed canonical path verification.',
  SOURCE_RECEIPT_NEEDS_RECONCILIATION:
    'Quarantine receipt is in NeedsReconciliation hold and cannot be linked to a review draft.',
  SOURCE_RECEIPT_STATE_NOT_QUARANTINED:
    'Quarantine receipt is not in the required Quarantined state.',
  SOURCE_RECEIPT_GENERATION_INVALID:
    'Quarantined receipt is missing a canonical positive safe-integer decimal generation.',
  SOURCE_RECEIPT_DTO_MISMATCH:
    'Persisted quarantine receipt failed server-side sanitized admin DTO verification.',
  CANDIDATE_CONTRACT_REJECTED:
    'Quarantine receipt failed LIB-FILE-REVIEW-01A review candidate contract assessment.',
  GCS_READBACK_UNVERIFIED:
    'Generation-pinned GCS quarantine object readback verification failed or was inconclusive.',
  GCS_ATTESTATION_MISMATCH:
    'Generation-pinned GCS readback attestation did not match the authoritative Quarantined receipt.',
  TX_STALE_SOURCE_HOLD:
    'Authoritative source receipt changed between GCS readback and Firestore transaction.',
  TX_EXISTING_DRAFT_CONFLICT_HOLD:
    'Existing quarantine review draft conflicts with the authoritative source receipt version.',
  TX_CORRUPTED_PERSISTED_DRAFT_HOLD:
    'Persisted quarantine review draft failed integrity or security posture validation.',
  TX_CONFLICT_OR_FAILURE_HOLD:
    'Atomic Firestore review draft transaction failed or conflicted; commit outcome is unconfirmed.',
} as const);

const ALLOWED_SERVICE_SAFE_MESSAGES: ReadonlySet<string> = new Set(
  Object.values(SERVICE_SAFE_MESSAGES)
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

function sanitizeConstantServiceMessage(message: string): string {
  const safeBase = ALLOWED_SERVICE_SAFE_MESSAGES.has(message)
    ? message
    : SERVICE_SAFE_MESSAGES.TX_CONFLICT_OR_FAILURE_HOLD;

  return safeBase
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
    .replace(CONTROL_OR_BIDI_CHAR_REGEX, ' ')
    .trim();
}

function makeHoldResult(
  holdReasonCode: LibraryQuarantineReviewDraftHoldReasonCode,
  constantMessage: string,
  receiptId: string | null,
  sourceRevision: number | null,
  gcsVerifyAttempted: boolean,
  transactionAttempted: boolean,
  draftCreationOutcome: LibraryQuarantineReviewDraftStoreFailureOutcome = 'NOT_CREATED'
): LibraryQuarantineReviewDraftPersistenceHold {
  const resolvedOutcome: LibraryQuarantineReviewDraftStoreFailureOutcome =
    transactionAttempted ? draftCreationOutcome : 'NOT_CREATED';

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    holdReasonCode,
    errorMessage: sanitizeConstantServiceMessage(constantMessage),
    receiptId,
    sourceRevision,
    gcsVerifyAttempted,
    gcsSaveAttempted: false as const,
    transactionAttempted,
    draftCreationOutcome: resolvedOutcome,
    draftCreated: resolvedOutcome === 'NOT_CREATED' ? (false as const) : null,
    receiptMutated: false as const,
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    remainingDeferredGates: LIBRARY_QUARANTINE_REVIEW_DRAFT_REMAINING_GATES,
  });
}

function hasAutomatedOrAiTokenClaim(
  token: Readonly<Record<string, unknown>>
): boolean {
  return (
    token.role === AdminRole.AIAssistant ||
    token.isAIAssistant === true ||
    token.aiAssistant === true ||
    token.ai === true ||
    token.automated === true ||
    token.isBot === true ||
    token.principalType === 'AI' ||
    token.actorType === 'AI'
  );
}

function areSanitizedAdminDtosEqual(
  first: SanitizedLibraryQuarantineAdminReceiptDto,
  second: SanitizedLibraryQuarantineAdminReceiptDto
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
    first.state === second.state &&
    first.deepInspectionStatus === second.deepInspectionStatus &&
    first.hasVerifiedStorageWrite === second.hasVerifiedStorageWrite &&
    first.reconciliationRequired === second.reconciliationRequired &&
    first.reconciliationReason === second.reconciliationReason &&
    first.rejectionReasonCode === second.rejectionReasonCode &&
    first.createdAt === second.createdAt &&
    first.updatedAt === second.updatedAt &&
    first.isQuarantinedPrivateOnly === second.isQuarantinedPrivateOnly &&
    first.isSanitized === false &&
    second.isSanitized === false &&
    first.isVerifiedSafe === false &&
    second.isVerifiedSafe === false &&
    first.isRightsApproved === false &&
    second.isRightsApproved === false &&
    first.isPublished === false &&
    second.isPublished === false &&
    first.isReadyForPeia === false &&
    second.isReadyForPeia === false
  );
}

function verifyAttestationMatchesQuarantinedReceipt(
  attestation: unknown,
  receipt: LibraryQuarantineInternalReceipt
):
  | { readonly ok: true; readonly attestedGeneration: string }
  | { readonly ok: false } {
  if (!isPlainRecord(attestation)) {
    return { ok: false };
  }

  if (hasUnexpectedPropertyOrSymbol(attestation, ALLOWED_ATTESTATION_KEYS)) {
    return { ok: false };
  }

  for (const requiredKey of ALLOWED_ATTESTATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(attestation, requiredKey)) {
      return { ok: false };
    }
  }

  const typed = attestation as unknown as TrustedStorageReadbackAttestation;

  if (
    typed.attestedReceiptId !== receipt.receiptId ||
    typed.attestedUploaderUid !== receipt.uploaderUid ||
    typed.attestedStoragePath !== receipt.storagePath ||
    typed.attestedFormat !== receipt.format ||
    typed.attestedContentType !== receipt.canonicalMimeType
  ) {
    return { ok: false };
  }

  if (
    typeof typed.attestedByteSize !== 'number' ||
    !Number.isSafeInteger(typed.attestedByteSize) ||
    typed.attestedByteSize !== receipt.byteSize
  ) {
    return { ok: false };
  }

  if (
    typeof typed.attestedSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(typed.attestedSha256) ||
    typed.attestedSha256 !== receipt.sha256
  ) {
    return { ok: false };
  }

  const canonicalReceiptGen = parseCanonicalSafeGcsGeneration(
    receipt.generation
  );
  const canonicalAttestedGen = parseCanonicalSafeGcsGeneration(
    typed.attestedGeneration
  );

  if (
    receipt.generation === null ||
    canonicalReceiptGen === null ||
    canonicalAttestedGen === null ||
    typed.attestedGeneration !== receipt.generation ||
    canonicalAttestedGen !== canonicalReceiptGen
  ) {
    return { ok: false };
  }

  if (
    !isValidIsoUtcTimestamp(typed.verifiedAtIso) ||
    Date.parse(typed.verifiedAtIso) < Date.parse(receipt.updatedAt)
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    attestedGeneration: canonicalAttestedGen,
  };
}

/**
 * Dependency-injected, server-only persistence service for linking a verified
 * `Quarantined` upload receipt to a durable `PENDING_HUMAN_REVIEW` draft.
 */
export class LibraryQuarantineReviewDraftPersistenceService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly receiptStore: LibraryQuarantineReceiptReadOnlyPort;
  private readonly storageReadbackPort: LibraryQuarantineGcsReadbackPort;
  private readonly draftStore: LibraryQuarantineReviewDraftStore;
  private readonly clock: () => string;

  constructor(options: {
    readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
    readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
    readonly receiptStore: LibraryQuarantineReceiptReadOnlyPort;
    readonly storageReadbackPort: LibraryQuarantineGcsReadbackPort;
    readonly draftStore: LibraryQuarantineReviewDraftStore;
    readonly clock?: () => string;
  }) {
    if (
      !options ||
      !options.trustedPrincipalProvider ||
      typeof options.trustedPrincipalProvider.resolveAuthenticatedPrincipal !==
        'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineReviewDraftPersistenceService requires a request-scoped trustedPrincipalProvider implementing resolveAuthenticatedPrincipal().'
      );
    }

    if (
      !options.adminRepository ||
      typeof options.adminRepository.getAdminByUid !== 'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineReviewDraftPersistenceService requires an adminRepository implementing getAdminByUid(uid).'
      );
    }

    if (
      !options.receiptStore ||
      typeof options.receiptStore.getReceiptById !== 'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineReviewDraftPersistenceService requires a receiptStore implementing getReceiptById(receiptId).'
      );
    }

    if (
      !options.storageReadbackPort ||
      typeof options.storageReadbackPort.verifyExistingQuarantineObject !==
        'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineReviewDraftPersistenceService requires a storageReadbackPort implementing verifyExistingQuarantineObject(input).'
      );
    }

    if (
      !options.draftStore ||
      typeof options.draftStore.createReviewDraftIfAbsentAtomically !==
        'function' ||
      typeof options.draftStore.getReviewDraftByReceiptId !== 'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineReviewDraftPersistenceService requires a draftStore implementing createReviewDraftIfAbsentAtomically and getReviewDraftByReceiptId.'
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

    // Bind ONLY getReceiptById so no receipt write or CAS capability can ever be invoked.
    const underlyingReceiptStore = options.receiptStore;
    this.receiptStore = Object.freeze({
      getReceiptById: (receiptId: unknown) =>
        underlyingReceiptStore.getReceiptById(receiptId),
    });

    // Bind ONLY verifyExistingQuarantineObject so no GCS write/save/delete capability can ever be invoked.
    const underlyingStoragePort = options.storageReadbackPort;
    this.storageReadbackPort = Object.freeze({
      verifyExistingQuarantineObject: (
        input: VerifyExistingLibraryQuarantineObjectInput
      ): Promise<LibraryQuarantineGcsAdapterResult> =>
        underlyingStoragePort.verifyExistingQuarantineObject(input),
    });

    const underlyingDraftStore = options.draftStore;
    this.draftStore = Object.freeze({
      getReviewDraftByReceiptId: (receiptId: unknown) =>
        underlyingDraftStore.getReviewDraftByReceiptId(receiptId),
      createReviewDraftIfAbsentAtomically: (input: unknown) =>
        underlyingDraftStore.createReviewDraftIfAbsentAtomically(input),
    });

    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  /**
   * Alias for `linkQuarantineReceiptToReviewDraft`.
   */
  public async createOrGetQuarantineReviewDraft(
    rawInput: unknown
  ): Promise<LinkLibraryQuarantineReviewDraftResult> {
    return this.linkQuarantineReceiptToReviewDraft(rawInput);
  }

  /**
   * Validates the strict `{ receiptId }` operation input, resolves and authorizes
   * the server-authenticated human Library reviewer via `trustedPrincipalProvider`
   * and `AdminRepository`, freshly reads the canonical receipt envelope, evaluates
   * the `LIB-FILE-REVIEW-01A` candidate, verifies live generation-pinned GCS
   * readback attestation, and executes a single Firestore transaction that
   * re-verifies the source receipt and creates
   * `library_quarantine_review_drafts/<receiptId>` if absent.
   */
  public async linkQuarantineReceiptToReviewDraft(
    rawInput: unknown
  ): Promise<LinkLibraryQuarantineReviewDraftResult> {
    if (!isPlainRecord(rawInput)) {
      return makeHoldResult(
        'INVALID_SERVICE_INPUT_HOLD',
        SERVICE_SAFE_MESSAGES.INPUT_NOT_PLAIN_OBJECT,
        null,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_SERVICE_INPUT_KEYS)) {
      const candidateReceiptId = isValidLibraryQuarantineReceiptId(
        rawInput.receiptId
      )
        ? rawInput.receiptId
        : null;
      return makeHoldResult(
        'UNTRUSTED_CALLER_FIELD_HOLD',
        SERVICE_SAFE_MESSAGES.INPUT_UNEXPECTED_FIELD,
        candidateReceiptId,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    if (!Object.prototype.hasOwnProperty.call(rawInput, 'receiptId')) {
      return makeHoldResult(
        'INVALID_SERVICE_INPUT_HOLD',
        SERVICE_SAFE_MESSAGES.INPUT_MISSING_RECEIPT_ID,
        null,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    const { receiptId } = rawInput;

    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeHoldResult(
        'INVALID_RECEIPT_ID_HOLD',
        SERVICE_SAFE_MESSAGES.INPUT_INVALID_RECEIPT_ID,
        null,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    // Step 1: Resolve server-authenticated principal from injected request-scoped provider
    const principalRes = await this.resolveTrustedServerPrincipal();
    if (!principalRes.ok) {
      return makeHoldResult(
        'UNAUTHORIZED_REVIEWER_HOLD',
        principalRes.constantMessage,
        receiptId,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    // Step 2: Resolve canonical human AdminUser from trusted AdminRepository BEFORE any receipt or GCS access
    const authCheck = await this.authorizeHumanLibraryReviewer(
      principalRes.uid
    );
    if (!authCheck.ok) {
      return makeHoldResult(
        'UNAUTHORIZED_REVIEWER_HOLD',
        authCheck.constantMessage,
        receiptId,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    const authorizedAdmin = authCheck.adminUser;

    // Step 3: Validate server clock timestamp before reading receipt or probing GCS
    let nowIso: string;
    try {
      nowIso = this.clock();
    } catch {
      return makeHoldResult(
        'INVALID_TIMESTAMP_HOLD',
        SERVICE_SAFE_MESSAGES.CLOCK_INVALID_TIMESTAMP,
        receiptId,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    if (!isValidIsoUtcTimestamp(nowIso)) {
      return makeHoldResult(
        'INVALID_TIMESTAMP_HOLD',
        SERVICE_SAFE_MESSAGES.CLOCK_INVALID_TIMESTAMP,
        receiptId,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    // Step 4: Freshly read authoritative receipt envelope from receiptStore (budget: <= 1 read)
    let initialEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
    let initialAdminDto: SanitizedLibraryQuarantineAdminReceiptDto;

    try {
      const readRes = await this.receiptStore.getReceiptById(receiptId);
      if (!readRes || typeof readRes !== 'object' || !readRes.ok) {
        if (
          readRes &&
          typeof readRes === 'object' &&
          'errorCode' in readRes &&
          readRes.errorCode === 'RECEIPT_NOT_FOUND'
        ) {
          return makeHoldResult(
            'SOURCE_RECEIPT_NOT_FOUND_HOLD',
            SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_NOT_FOUND,
            receiptId,
            null,
            false,
            false,
            'NOT_CREATED'
          );
        }
        return makeHoldResult(
          'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD',
          SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_READ_OR_VALIDATION_FAILED,
          receiptId,
          null,
          false,
          false,
          'NOT_CREATED'
        );
      }
      initialEnvelope = readRes.envelope;
      initialAdminDto = readRes.adminReceiptDto;
    } catch {
      return makeHoldResult(
        'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD',
        SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_READ_OR_VALIDATION_FAILED,
        receiptId,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    const revalidatedEnvelopeCheck =
      validatePersistedLibraryQuarantineReceiptEnvelope(
        initialEnvelope,
        receiptId
      );
    if (!revalidatedEnvelopeCheck.ok) {
      return makeHoldResult(
        'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD',
        SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_READ_OR_VALIDATION_FAILED,
        receiptId,
        null,
        false,
        false,
        'NOT_CREATED'
      );
    }

    const authoritativeEnvelope = revalidatedEnvelopeCheck.envelope;
    const persistedReceipt = authoritativeEnvelope.receipt;

    // Verify canonical storagePath derivation before any further step
    const derivedPathCheck = deriveLibraryQuarantineStoragePath(
      persistedReceipt.receiptId,
      persistedReceipt.format
    );
    const parsedPathCheck = parseLibraryQuarantineStoragePath(
      persistedReceipt.storagePath
    );
    if (
      !derivedPathCheck.ok ||
      !parsedPathCheck.ok ||
      derivedPathCheck.parsed.storagePath !== persistedReceipt.storagePath ||
      parsedPathCheck.parsed.storagePath !== persistedReceipt.storagePath
    ) {
      return makeHoldResult(
        'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD',
        SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_STORAGE_PATH_INVALID,
        receiptId,
        authoritativeEnvelope.revision,
        false,
        false,
        'NOT_CREATED'
      );
    }

    // Hold on NeedsReconciliation or any non-Quarantined state BEFORE touching GCS
    if (
      persistedReceipt.state ===
        LibraryQuarantineReceiptState.NeedsReconciliation ||
      persistedReceipt.reconciliationReason !== null
    ) {
      return makeHoldResult(
        'NEEDS_RECONCILIATION_HOLD',
        SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_NEEDS_RECONCILIATION,
        receiptId,
        authoritativeEnvelope.revision,
        false,
        false,
        'NOT_CREATED'
      );
    }

    if (persistedReceipt.state !== LibraryQuarantineReceiptState.Quarantined) {
      return makeHoldResult(
        'SOURCE_STATE_NOT_ELIGIBLE_HOLD',
        SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_STATE_NOT_QUARANTINED,
        receiptId,
        authoritativeEnvelope.revision,
        false,
        false,
        'NOT_CREATED'
      );
    }

    const canonicalGen = parseCanonicalSafeGcsGeneration(
      persistedReceipt.generation
    );
    if (
      persistedReceipt.generation === null ||
      canonicalGen === null ||
      canonicalGen !== persistedReceipt.generation
    ) {
      return makeHoldResult(
        'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD',
        SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_GENERATION_INVALID,
        receiptId,
        authoritativeEnvelope.revision,
        false,
        false,
        'NOT_CREATED'
      );
    }

    const serverDtoCheck =
      toSanitizedLibraryQuarantineAdminReceiptDto(persistedReceipt);
    if (
      !serverDtoCheck.ok ||
      !areSanitizedAdminDtosEqual(serverDtoCheck.dto, initialAdminDto)
    ) {
      return makeHoldResult(
        'SOURCE_RECEIPT_CORRUPTED_OR_UNREADABLE_HOLD',
        SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_DTO_MISMATCH,
        receiptId,
        authoritativeEnvelope.revision,
        false,
        false,
        'NOT_CREATED'
      );
    }

    // Step 5: Evaluate LIB-FILE-REVIEW-01A pure review candidate contract before touching GCS
    const candidateAssessment = assessLibraryQuarantineReviewCandidate(
      {
        revision: authoritativeEnvelope.revision,
        adminReceipt: serverDtoCheck.dto,
      },
      {
        expectedReceiptId: receiptId,
        expectedRevision: authoritativeEnvelope.revision,
        expectedSha256: persistedReceipt.sha256,
        expectedUpdatedAt: persistedReceipt.updatedAt,
      }
    );

    if (!candidateAssessment.ok) {
      const holdCode: LibraryQuarantineReviewDraftHoldReasonCode =
        candidateAssessment.reasonCode === 'NEEDS_RECONCILIATION_HOLD'
          ? 'NEEDS_RECONCILIATION_HOLD'
          : 'CANDIDATE_CONTRACT_REJECTED_HOLD';
      const holdMessage =
        holdCode === 'NEEDS_RECONCILIATION_HOLD'
          ? SERVICE_SAFE_MESSAGES.SOURCE_RECEIPT_NEEDS_RECONCILIATION
          : SERVICE_SAFE_MESSAGES.CANDIDATE_CONTRACT_REJECTED;
      return makeHoldResult(
        holdCode,
        holdMessage,
        receiptId,
        authoritativeEnvelope.revision,
        false,
        false,
        'NOT_CREATED'
      );
    }

    if (Date.parse(nowIso) < Date.parse(persistedReceipt.updatedAt)) {
      return makeHoldResult(
        'INVALID_TIMESTAMP_HOLD',
        SERVICE_SAFE_MESSAGES.CLOCK_BEFORE_SOURCE_UPDATED_AT,
        receiptId,
        authoritativeEnvelope.revision,
        false,
        false,
        'NOT_CREATED'
      );
    }

    // Step 6: Perform generation-pinned GCS readback verification (budget: <= 1 call)
    let gcsOutcome: LibraryQuarantineGcsAdapterResult;
    try {
      gcsOutcome =
        await this.storageReadbackPort.verifyExistingQuarantineObject({
          receipt: persistedReceipt,
          verifiedAtIso: nowIso,
        });
    } catch {
      return makeHoldResult(
        'GCS_READBACK_UNVERIFIED_HOLD',
        SERVICE_SAFE_MESSAGES.GCS_READBACK_UNVERIFIED,
        receiptId,
        authoritativeEnvelope.revision,
        true,
        false,
        'NOT_CREATED'
      );
    }

    if (
      !gcsOutcome ||
      typeof gcsOutcome !== 'object' ||
      gcsOutcome.ok !== true ||
      gcsOutcome.status !== 'EXISTING_VERIFIED' ||
      gcsOutcome.createdNewObject !== false
    ) {
      return makeHoldResult(
        'GCS_READBACK_UNVERIFIED_HOLD',
        SERVICE_SAFE_MESSAGES.GCS_READBACK_UNVERIFIED,
        receiptId,
        authoritativeEnvelope.revision,
        true,
        false,
        'NOT_CREATED'
      );
    }

    if (
      gcsOutcome.receiptId !== receiptId ||
      gcsOutcome.bucketIamPrivacyVerified !== false ||
      gcsOutcome.isSanitized !== false ||
      gcsOutcome.isVerifiedSafe !== false ||
      gcsOutcome.isRightsApproved !== false ||
      gcsOutcome.isPublished !== false ||
      gcsOutcome.isReadyForPeia !== false
    ) {
      return makeHoldResult(
        'GCS_ATTESTATION_MISMATCH_HOLD',
        SERVICE_SAFE_MESSAGES.GCS_ATTESTATION_MISMATCH,
        receiptId,
        authoritativeEnvelope.revision,
        true,
        false,
        'NOT_CREATED'
      );
    }

    const attestationMatch = verifyAttestationMatchesQuarantinedReceipt(
      gcsOutcome.attestation,
      persistedReceipt
    );
    if (!attestationMatch.ok) {
      return makeHoldResult(
        'GCS_ATTESTATION_MISMATCH_HOLD',
        SERVICE_SAFE_MESSAGES.GCS_ATTESTATION_MISMATCH,
        receiptId,
        authoritativeEnvelope.revision,
        true,
        false,
        'NOT_CREATED'
      );
    }

    // Step 7: Execute single atomic Firestore transaction via draftStore (zero service-level retries)
    let draftStoreResult;
    try {
      draftStoreResult =
        await this.draftStore.createReviewDraftIfAbsentAtomically({
          receiptId,
          expectedSourceEnvelope: authoritativeEnvelope,
          expectedAttestedGeneration: attestationMatch.attestedGeneration,
          expectedCandidate: candidateAssessment.candidate,
          createdBy: authorizedAdmin.id,
          createdAt: nowIso,
        });
    } catch {
      return makeHoldResult(
        'TRANSACTION_CONFLICT_OR_FAILURE_HOLD',
        SERVICE_SAFE_MESSAGES.TX_CONFLICT_OR_FAILURE_HOLD,
        receiptId,
        authoritativeEnvelope.revision,
        true,
        true,
        'UNKNOWN'
      );
    }

    if (!draftStoreResult || typeof draftStoreResult !== 'object') {
      return makeHoldResult(
        'TRANSACTION_CONFLICT_OR_FAILURE_HOLD',
        SERVICE_SAFE_MESSAGES.TX_CONFLICT_OR_FAILURE_HOLD,
        receiptId,
        authoritativeEnvelope.revision,
        true,
        true,
        'UNKNOWN'
      );
    }

    if (!draftStoreResult.ok) {
      let holdReasonCode: LibraryQuarantineReviewDraftHoldReasonCode =
        'TRANSACTION_CONFLICT_OR_FAILURE_HOLD';
      let constantMessage: string =
        SERVICE_SAFE_MESSAGES.TX_CONFLICT_OR_FAILURE_HOLD;

      if (draftStoreResult.errorCode === 'STALE_SOURCE_HOLD') {
        holdReasonCode = 'STALE_SOURCE_HOLD';
        constantMessage = SERVICE_SAFE_MESSAGES.TX_STALE_SOURCE_HOLD;
      } else if (
        draftStoreResult.errorCode === 'EXISTING_DRAFT_CONFLICT_HOLD'
      ) {
        holdReasonCode = 'EXISTING_DRAFT_CONFLICT_HOLD';
        constantMessage = SERVICE_SAFE_MESSAGES.TX_EXISTING_DRAFT_CONFLICT_HOLD;
      } else if (
        draftStoreResult.errorCode === 'CORRUPTED_PERSISTED_DRAFT' ||
        draftStoreResult.errorCode === 'SECURITY_FLAG_ESCALATION' ||
        draftStoreResult.errorCode === 'INVALID_SCHEMA_VERSION' ||
        draftStoreResult.errorCode === 'DOCUMENT_ID_MISMATCH' ||
        draftStoreResult.errorCode === 'UNTRUSTED_DRAFT_STORE_FIELD'
      ) {
        holdReasonCode = 'CORRUPTED_PERSISTED_DRAFT_HOLD';
        constantMessage =
          SERVICE_SAFE_MESSAGES.TX_CORRUPTED_PERSISTED_DRAFT_HOLD;
      }

      const provenNoWrite =
        draftStoreResult.errorCode !== 'TRANSACTION_CONFLICT_OR_FAILURE' &&
        draftStoreResult.draftCreationOutcome === 'NOT_CREATED' &&
        draftStoreResult.draftCreated === false;

      return makeHoldResult(
        holdReasonCode,
        constantMessage,
        receiptId,
        authoritativeEnvelope.revision,
        true,
        true,
        provenNoWrite ? 'NOT_CREATED' : 'UNKNOWN'
      );
    }

    // Post-validate returned draft to ensure zero secret leakage and exact consistency.
    // Because the draft-store transaction already ran, any post-transaction validation
    // failure has an ambiguous persistence outcome ('UNKNOWN', draftCreated: null).
    const postDraftCheck = validatePersistedLibraryQuarantineReviewDraft(
      draftStoreResult.draft,
      receiptId
    );
    if (
      !postDraftCheck.ok ||
      (draftStoreResult.disposition !== 'CREATED' &&
        draftStoreResult.disposition !== 'IDEMPOTENT_EXISTING') ||
      draftStoreResult.created !==
        (draftStoreResult.disposition === 'CREATED') ||
      !doesPersistedReviewDraftMatchCandidateAndSource(
        postDraftCheck.draft,
        candidateAssessment.candidate,
        authoritativeEnvelope
      ) ||
      !areQuarantineReviewCandidatesSameSourceVersion(
        candidateAssessment.candidate,
        candidateAssessment.candidate
      )
    ) {
      return makeHoldResult(
        'CORRUPTED_PERSISTED_DRAFT_HOLD',
        SERVICE_SAFE_MESSAGES.TX_CORRUPTED_PERSISTED_DRAFT_HOLD,
        receiptId,
        authoritativeEnvelope.revision,
        true,
        true,
        'UNKNOWN'
      );
    }

    return Object.freeze({
      ok: true as const,
      status: 'LINKED_PENDING_HUMAN_REVIEW' as const,
      disposition: draftStoreResult.disposition,
      draftCreationOutcome: draftStoreResult.disposition,
      created: draftStoreResult.created,
      draftCreated: draftStoreResult.created,
      receiptId,
      sourceRevision: draftStoreResult.sourceRevision,
      draft: postDraftCheck.draft,
      candidate: candidateAssessment.candidate,
      gcsVerifyAttempted: true as const,
      gcsSaveAttempted: false as const,
      transactionAttempted: true as const,
      receiptMutated: false as const,
      bucketIamPrivacyVerified: false as const,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
      remainingDeferredGates: LIBRARY_QUARANTINE_REVIEW_DRAFT_REMAINING_GATES,
    });
  }

  private async resolveTrustedServerPrincipal(): Promise<
    | { readonly ok: true; readonly uid: string }
    | { readonly ok: false; readonly constantMessage: string }
  > {
    let rawPrincipal: TrustedQuarantineAuthenticatedPrincipal | null;
    try {
      rawPrincipal =
        await this.trustedPrincipalProvider.resolveAuthenticatedPrincipal();
    } catch {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.PRINCIPAL_RESOLUTION_FAILED,
      };
    }

    if (!isPlainRecord(rawPrincipal)) {
      return {
        ok: false,
        constantMessage:
          SERVICE_SAFE_MESSAGES.PRINCIPAL_UNAUTHENTICATED_OR_MALFORMED,
      };
    }

    if (
      hasUnexpectedPropertyOrSymbol(rawPrincipal, ALLOWED_PRINCIPAL_KEYS)
    ) {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.PRINCIPAL_UNEXPECTED_FIELD,
      };
    }

    const rawUid = rawPrincipal.uid;
    if (
      typeof rawUid !== 'string' ||
      rawUid.trim() !== rawUid ||
      !isValidUploaderUid(rawUid)
    ) {
      return {
        ok: false,
        constantMessage:
          SERVICE_SAFE_MESSAGES.PRINCIPAL_UNAUTHENTICATED_OR_MALFORMED,
      };
    }

    if (rawPrincipal.token !== undefined) {
      if (!isPlainRecord(rawPrincipal.token)) {
        return {
          ok: false,
          constantMessage: SERVICE_SAFE_MESSAGES.PRINCIPAL_TOKEN_INVALID,
        };
      }

      if (Object.getOwnPropertySymbols(rawPrincipal.token).length > 0) {
        return {
          ok: false,
          constantMessage: SERVICE_SAFE_MESSAGES.PRINCIPAL_TOKEN_INVALID,
        };
      }

      for (const tokenKey of Object.getOwnPropertyNames(rawPrincipal.token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(tokenKey)) {
          return {
            ok: false,
            constantMessage: SERVICE_SAFE_MESSAGES.PRINCIPAL_TOKEN_INVALID,
          };
        }
      }

      if (hasAutomatedOrAiTokenClaim(rawPrincipal.token)) {
        return {
          ok: false,
          constantMessage:
            SERVICE_SAFE_MESSAGES.PRINCIPAL_AI_OR_AUTOMATED_FORBIDDEN,
        };
      }
    }

    return {
      ok: true,
      uid: rawUid,
    };
  }

  private async authorizeHumanLibraryReviewer(
    uid: string
  ): Promise<
    | { readonly ok: true; readonly adminUser: AdminUser }
    | { readonly ok: false; readonly constantMessage: string }
  > {
    let rawAdmin: AdminUser | null = null;
    try {
      rawAdmin = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.ADMIN_LOOKUP_FAILED,
      };
    }

    if (!rawAdmin || typeof rawAdmin !== 'object' || Array.isArray(rawAdmin)) {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.ADMIN_NOT_REGISTERED,
      };
    }

    if (
      typeof rawAdmin.id !== 'string' ||
      rawAdmin.id.trim() !== uid ||
      rawAdmin.id !== uid
    ) {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.ADMIN_ID_MISMATCH,
      };
    }

    if (rawAdmin.isActive !== true) {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.ADMIN_INACTIVE,
      };
    }

    if (!isValidAdminRole(rawAdmin.role)) {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.ADMIN_ROLE_INVALID,
      };
    }

    if (rawAdmin.role === AdminRole.AIAssistant) {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.ADMIN_ROLE_AI_FORBIDDEN,
      };
    }

    const hasLibraryOrRightsDomain =
      hasDomainResponsibility(rawAdmin.role, AdminDomain.Library) ||
      rawAdmin.role === AdminRole.RightsReviewer;

    if (!hasLibraryOrRightsDomain) {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.ADMIN_DOMAIN_NOT_AUTHORIZED,
      };
    }

    if (
      !AdminAuthorizationService.hasPermission(rawAdmin, AdminPermission.Review)
    ) {
      return {
        ok: false,
        constantMessage: SERVICE_SAFE_MESSAGES.ADMIN_PERMISSION_MISSING,
      };
    }

    return {
      ok: true,
      adminUser: Object.freeze({
        id: rawAdmin.id,
        name: typeof rawAdmin.name === 'string' ? rawAdmin.name : '',
        email: typeof rawAdmin.email === 'string' ? rawAdmin.email : '',
        role: rawAdmin.role,
        isActive: true,
      }),
    };
  }
}
