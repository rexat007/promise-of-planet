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
  LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
  validatePersistedLibraryQuarantineReviewDraft,
  type LibraryQuarantineReviewDraftStore,
} from './firestoreLibraryQuarantineReviewDraftStore';
import {
  HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES,
  type LibraryQuarantineHumanReviewCaseErrorCode,
  type LibraryQuarantineHumanReviewCaseStore,
} from './firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  HUMAN_REVIEW_CONTRACT_SAFE_MESSAGES,
  toSanitizedLibraryQuarantineHumanReviewCaseDto,
  validateHumanReviewCaseEditorialInput,
  validatePersistedLibraryQuarantineHumanReviewCase,
  type SanitizedLibraryQuarantineHumanReviewCaseDto,
  type SaveLibraryQuarantineHumanReviewCaseEditorialInput,
} from './libraryQuarantineHumanReviewCaseContract';
import {
  LibraryQuarantineReceiptState,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  toSanitizedLibraryQuarantineAdminReceiptDto,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';
import type {
  LibraryQuarantineReceiptReadOnlyPort,
  TrustedQuarantineAuthenticatedPrincipal,
  TrustedQuarantineReviewerPrincipalProvider,
} from './libraryQuarantineReviewDraftPersistenceService';

/**
 * LIB-FILE-HUMAN-CASEWORK-01 — Server-Side Human Review Case Service
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Provides two bounded, server-only operations for authorized human Library
 *   reviewers (`AdminPermission.Review` on `AdminDomain.Library`):
 *   1. `getQuarantineHumanReviewCase({ receiptId })` — reads the authoritative
 *      `Quarantined` receipt, verifies its linked `PENDING_HUMAN_REVIEW` draft,
 *      and returns the sanitized receipt DTO and sanitized human review case DTO
 *      (or `null` with `currentRevision: 0` when not yet recorded).
 *   2. `saveQuarantineHumanReviewCase({ receiptId, expectedRevision, input })` —
 *      validates plain-text editorial metadata and preliminary status
 *      (`IN_REVIEW | NEEDS_INFORMATION | METADATA_RECORDED | NOT_SUITABLE`),
 *      executes an atomic Firestore transaction with CAS (`expectedRevision`) and
 *      append-only audit event creation, and returns a deterministic sanitized
 *      response (`SAVED | CONFLICT | HOLD | UNKNOWN`).
 * - SDK-TRUSTED AUTH PROVENANCE ONLY:
 *   Caller UID is resolved exclusively from the request-scoped
 *   `trustedPrincipalProvider` (bound to verified Firebase Functions SDK
 *   `request.auth`) and verified via `AdminRepository.getAdminByUid(uid)`.
 *   Caller-supplied `uid`, `auth`, `role`, `permissions`, or `token` fields in
 *   operation payloads are rejected before any principal or Firestore lookup.
 * - NON-ASSURANCE INVARIANT:
 *   All responses maintain `isSanitized: false`, `isVerifiedSafe: false`,
 *   `isRightsApproved: false`, `isPublished: false`, `isReadyForPeia: false`.
 *   Never accesses or mutates GCS, never mutates receipts or review drafts, and
 *   never exposes `storagePath`, `generation`, `sourceSha256`, `createdBy`,
 *   `updatedBy`, signed URLs, or raw exception strings.
 */

export type LibraryQuarantineHumanReviewServiceErrorCode =
  | LibraryQuarantineHumanReviewCaseErrorCode
  | 'INVALID_SERVICE_INPUT_HOLD'
  | 'UNTRUSTED_CALLER_FIELD_HOLD'
  | 'UNAUTHENTICATED_CALLER_HOLD'
  | 'UNAUTHORIZED_REVIEWER_HOLD';

export const HUMAN_REVIEW_SERVICE_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineHumanReviewServiceErrorCode, string>
> = Object.freeze({
  ...HUMAN_REVIEW_CONTRACT_SAFE_MESSAGES,
  ...HUMAN_REVIEW_CASE_STORE_SAFE_MESSAGES,
  INVALID_SERVICE_INPUT_HOLD:
    'Human review case request payload must be a plain object with required fields.',
  UNTRUSTED_CALLER_FIELD_HOLD:
    'Human review case request payload contains an unexpected, privileged, or forbidden property.',
  UNAUTHENTICATED_CALLER_HOLD:
    'Request is missing a valid server-authenticated Firebase user principal.',
  UNAUTHORIZED_REVIEWER_HOLD:
    'Authenticated caller is not an active authorized human Library reviewer with Review permission.',
});

export interface GetLibraryQuarantineHumanReviewCaseInput {
  readonly receiptId: string;
}

export interface SaveLibraryQuarantineHumanReviewCaseInput {
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly input: SaveLibraryQuarantineHumanReviewCaseEditorialInput;
}

export interface GetLibraryQuarantineHumanReviewCaseSuccessDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly draftStatus: 'PENDING_HUMAN_REVIEW';
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly currentRevision: number;
  readonly reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineHumanReviewCaseHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: LibraryQuarantineHumanReviewServiceErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineHumanReviewCaseResponseDto =
  | GetLibraryQuarantineHumanReviewCaseSuccessDto
  | GetLibraryQuarantineHumanReviewCaseHoldDto;

export interface SaveLibraryQuarantineHumanReviewCaseSavedDto {
  readonly ok: true;
  readonly status: 'SAVED';
  readonly caseSaveOutcome: 'CREATED' | 'UPDATED';
  readonly caseSaved: true;
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly currentRevision: number;
  readonly reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineHumanReviewCaseConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly errorCode: 'CASE_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly currentRevision: number;
  readonly currentCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineHumanReviewCaseHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly errorCode: LibraryQuarantineHumanReviewServiceErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineHumanReviewCaseUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly caseSaveOutcome: 'UNKNOWN';
  readonly caseSaved: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type SaveLibraryQuarantineHumanReviewCaseResponseDto =
  | SaveLibraryQuarantineHumanReviewCaseSavedDto
  | SaveLibraryQuarantineHumanReviewCaseConflictDto
  | SaveLibraryQuarantineHumanReviewCaseHoldDto
  | SaveLibraryQuarantineHumanReviewCaseUnknownDto;

export type LibraryQuarantineReviewDraftReadOnlyPort = Pick<
  LibraryQuarantineReviewDraftStore,
  'getReviewDraftByReceiptId'
>;

export type LibraryQuarantineHumanReviewCaseStorePort = Pick<
  LibraryQuarantineHumanReviewCaseStore,
  'getHumanReviewCaseByReceiptId' | 'saveHumanReviewCaseAtomically'
>;

export interface LibraryQuarantineHumanReviewServiceOptions {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly receiptStore: LibraryQuarantineReceiptReadOnlyPort;
  readonly draftStore: LibraryQuarantineReviewDraftReadOnlyPort;
  readonly caseStore: LibraryQuarantineHumanReviewCaseStorePort;
  readonly clock?: () => string;
}

const ALLOWED_GET_INPUT_KEYS: ReadonlySet<string> = new Set(['receiptId']);

const ALLOWED_SAVE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedRevision',
  'input',
]);

const ALLOWED_PRINCIPAL_KEYS: ReadonlySet<string> = new Set(['uid', 'token']);

const FORBIDDEN_TOKEN_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'isAuthorized',
  'authorized',
  'bypassAuth',
  'forceAuthorize',
  'allow',
  'adminUser',
  'createdBy',
  'updatedBy',
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

function isAuthorizedHumanLibraryCaseReviewer(
  user: AdminUser | null | undefined
): user is AdminUser {
  if (!user || typeof user !== 'object') {
    return false;
  }
  if (user.isActive !== true) {
    return false;
  }
  if (!isValidAdminRole(user.role) || user.role === AdminRole.AIAssistant) {
    return false;
  }
  const hasLibraryOrRightsDomain =
    hasDomainResponsibility(user.role, AdminDomain.Library) ||
    user.role === AdminRole.RightsReviewer;
  if (!hasLibraryOrRightsDomain) {
    return false;
  }
  if (!AdminAuthorizationService.hasPermission(user, AdminPermission.Review)) {
    return false;
  }

  // Enforce optional explicit per-user permissions restriction array if present
  const explicitPermissions = (
    user as AdminUser & { readonly permissions?: unknown }
  ).permissions;
  if (explicitPermissions !== undefined) {
    if (
      !Array.isArray(explicitPermissions) ||
      !explicitPermissions.includes(AdminPermission.Review)
    ) {
      return false;
    }
  }

  return true;
}

function makeGetHoldDto(
  errorCode: LibraryQuarantineHumanReviewServiceErrorCode,
  receiptId: string | null
): GetLibraryQuarantineHumanReviewCaseHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    errorCode,
    errorMessage: HUMAN_REVIEW_SERVICE_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeSaveHoldDto(
  errorCode: LibraryQuarantineHumanReviewServiceErrorCode,
  receiptId: string | null
): SaveLibraryQuarantineHumanReviewCaseHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    caseSaveOutcome: 'NOT_SAVED' as const,
    caseSaved: false as const,
    errorCode,
    errorMessage: HUMAN_REVIEW_SERVICE_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

export class LibraryQuarantineHumanReviewService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly receiptStore: LibraryQuarantineReceiptReadOnlyPort;
  private readonly draftStore: LibraryQuarantineReviewDraftReadOnlyPort;
  private readonly caseStore: LibraryQuarantineHumanReviewCaseStorePort;
  private readonly clock: () => string;

  constructor(options: LibraryQuarantineHumanReviewServiceOptions) {
    if (
      !options ||
      typeof options !== 'object' ||
      !options.trustedPrincipalProvider ||
      typeof options.trustedPrincipalProvider.resolveAuthenticatedPrincipal !==
        'function' ||
      !options.adminRepository ||
      typeof options.adminRepository.getAdminByUid !== 'function' ||
      !options.receiptStore ||
      typeof options.receiptStore.getReceiptById !== 'function' ||
      !options.draftStore ||
      typeof options.draftStore.getReviewDraftByReceiptId !== 'function' ||
      !options.caseStore ||
      typeof options.caseStore.getHumanReviewCaseByReceiptId !== 'function' ||
      typeof options.caseStore.saveHumanReviewCaseAtomically !== 'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineHumanReviewService requires valid trustedPrincipalProvider, adminRepository, receiptStore, draftStore, and caseStore.'
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

    const underlyingReceiptStore = options.receiptStore;
    this.receiptStore = Object.freeze({
      getReceiptById: (receiptId: string) =>
        underlyingReceiptStore.getReceiptById(receiptId),
    });

    const underlyingDraftStore = options.draftStore;
    this.draftStore = Object.freeze({
      getReviewDraftByReceiptId: (receiptId: string) =>
        underlyingDraftStore.getReviewDraftByReceiptId(receiptId),
    });

    const underlyingCaseStore = options.caseStore;
    this.caseStore = Object.freeze({
      getHumanReviewCaseByReceiptId: (receiptId: string) =>
        underlyingCaseStore.getHumanReviewCaseByReceiptId(receiptId),
      saveHumanReviewCaseAtomically: (params) =>
        underlyingCaseStore.saveHumanReviewCaseAtomically(params),
    });

    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private async resolveAndAuthorizeReviewer(): Promise<
    | { readonly ok: true; readonly reviewerUid: string }
    | {
        readonly ok: false;
        readonly errorCode:
          | 'UNAUTHENTICATED_CALLER_HOLD'
          | 'UNAUTHORIZED_REVIEWER_HOLD';
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
      return { ok: false, errorCode: 'UNAUTHORIZED_REVIEWER_HOLD' };
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
        return { ok: false, errorCode: 'UNAUTHORIZED_REVIEWER_HOLD' };
      }

      for (const key of Object.getOwnPropertyNames(rawPrincipal.token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(key)) {
          return { ok: false, errorCode: 'UNAUTHORIZED_REVIEWER_HOLD' };
        }
      }

      if (hasAutomatedOrAiTokenClaim(rawPrincipal.token)) {
        return { ok: false, errorCode: 'UNAUTHORIZED_REVIEWER_HOLD' };
      }
    }

    let adminUser: AdminUser | null;
    try {
      adminUser = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return { ok: false, errorCode: 'UNAUTHORIZED_REVIEWER_HOLD' };
    }

    if (
      !adminUser ||
      typeof adminUser.id !== 'string' ||
      adminUser.id.trim() !== uid ||
      adminUser.id !== uid
    ) {
      return { ok: false, errorCode: 'UNAUTHORIZED_REVIEWER_HOLD' };
    }

    if (!isAuthorizedHumanLibraryCaseReviewer(adminUser)) {
      return { ok: false, errorCode: 'UNAUTHORIZED_REVIEWER_HOLD' };
    }

    return { ok: true, reviewerUid: uid };
  }

  /**
   * Reads the sanitized administrative receipt and the current sanitized human
   * review case (if any) for an eligible `Quarantined` receipt linked to a
   * `PENDING_HUMAN_REVIEW` draft.
   */
  public async getQuarantineHumanReviewCase(
    rawInput: unknown
  ): Promise<GetLibraryQuarantineHumanReviewCaseResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makeGetHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_GET_INPUT_KEYS)) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeGetHoldDto('UNTRUSTED_CALLER_FIELD_HOLD', candidateId);
    }

    if (!Object.prototype.hasOwnProperty.call(rawInput, 'receiptId')) {
      return makeGetHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    const receiptId = rawInput.receiptId;
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeGetHoldDto('INVALID_RECEIPT_ID', null);
    }

    const authResult = await this.resolveAndAuthorizeReviewer();
    if (!authResult.ok) {
      return makeGetHoldDto(authResult.errorCode, receiptId);
    }

    // 1. Read authoritative source receipt
    let receiptLookup: Awaited<
      ReturnType<LibraryQuarantineReceiptReadOnlyPort['getReceiptById']>
    >;
    try {
      receiptLookup = await this.receiptStore.getReceiptById(receiptId);
    } catch {
      return makeGetHoldDto('CORRUPTED_SOURCE_RECEIPT', receiptId);
    }

    if (!receiptLookup || typeof receiptLookup !== 'object') {
      return makeGetHoldDto('CORRUPTED_SOURCE_RECEIPT', receiptId);
    }

    if (!receiptLookup.ok) {
      if (receiptLookup.errorCode === 'RECEIPT_NOT_FOUND') {
        return makeGetHoldDto('SOURCE_RECEIPT_NOT_FOUND', receiptId);
      }
      if (receiptLookup.errorCode === 'SECURITY_FLAG_ESCALATION') {
        return makeGetHoldDto('SECURITY_POSTURE_VIOLATION', receiptId);
      }
      return makeGetHoldDto('CORRUPTED_SOURCE_RECEIPT', receiptId);
    }

    const receiptEnvelope = receiptLookup.envelope;
    const receipt = receiptEnvelope?.receipt;
    if (
      !receipt ||
      receipt.receiptId !== receiptId ||
      typeof receiptEnvelope.revision !== 'number' ||
      !Number.isSafeInteger(receiptEnvelope.revision) ||
      receiptEnvelope.revision < 1
    ) {
      return makeGetHoldDto('CORRUPTED_SOURCE_RECEIPT', receiptId);
    }

    if (
      receipt.isSanitized !== false ||
      receipt.isVerifiedSafe !== false ||
      receipt.isRightsApproved !== false ||
      receipt.isPublished !== false ||
      receipt.isReadyForPeia !== false
    ) {
      return makeGetHoldDto('SECURITY_POSTURE_VIOLATION', receiptId);
    }

    const dtoCheck = toSanitizedLibraryQuarantineAdminReceiptDto(receipt);
    if (!dtoCheck.ok) {
      if (dtoCheck.errorCode === 'SECURITY_INVARIANT_VIOLATION') {
        return makeGetHoldDto('SECURITY_POSTURE_VIOLATION', receiptId);
      }
      return makeGetHoldDto('CORRUPTED_SOURCE_RECEIPT', receiptId);
    }
    const sanitizedReceipt = dtoCheck.dto;

    if (
      sanitizedReceipt.state ===
        LibraryQuarantineReceiptState.NeedsReconciliation ||
      sanitizedReceipt.reconciliationRequired === true
    ) {
      return makeGetHoldDto('RECEIPT_NEEDS_RECONCILIATION', receiptId);
    }

    if (
      sanitizedReceipt.state !== LibraryQuarantineReceiptState.Quarantined ||
      sanitizedReceipt.hasVerifiedStorageWrite !== true ||
      sanitizedReceipt.isQuarantinedPrivateOnly !== true ||
      sanitizedReceipt.reconciliationReason !== null ||
      sanitizedReceipt.rejectionReasonCode !== null
    ) {
      return makeGetHoldDto('RECEIPT_NOT_ELIGIBLE_FOR_HUMAN_REVIEW', receiptId);
    }

    // 2. Read and verify linked review draft
    let draftLookup: Awaited<
      ReturnType<
        LibraryQuarantineReviewDraftReadOnlyPort['getReviewDraftByReceiptId']
      >
    >;
    try {
      draftLookup = await this.draftStore.getReviewDraftByReceiptId(receiptId);
    } catch {
      return makeGetHoldDto('CORRUPTED_REVIEW_DRAFT', receiptId);
    }

    if (!draftLookup || typeof draftLookup !== 'object') {
      return makeGetHoldDto('CORRUPTED_REVIEW_DRAFT', receiptId);
    }

    if (!draftLookup.ok) {
      if (draftLookup.errorCode === 'DRAFT_NOT_FOUND') {
        return makeGetHoldDto('REVIEW_DRAFT_NOT_LINKED', receiptId);
      }
      if (draftLookup.errorCode === 'SECURITY_FLAG_ESCALATION') {
        return makeGetHoldDto('SECURITY_POSTURE_VIOLATION', receiptId);
      }
      return makeGetHoldDto('CORRUPTED_REVIEW_DRAFT', receiptId);
    }

    const draftValidation = validatePersistedLibraryQuarantineReviewDraft(
      draftLookup.draft,
      receiptId
    );
    if (!draftValidation.ok) {
      if (draftValidation.errorCode === 'SECURITY_FLAG_ESCALATION') {
        return makeGetHoldDto('SECURITY_POSTURE_VIOLATION', receiptId);
      }
      return makeGetHoldDto('CORRUPTED_REVIEW_DRAFT', receiptId);
    }

    const reviewDraft = draftValidation.draft;
    if (
      reviewDraft.schemaVersion !==
        LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION ||
      reviewDraft.reviewState !== LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE ||
      reviewDraft.isSanitized !== false ||
      reviewDraft.isVerifiedSafe !== false ||
      reviewDraft.isRightsApproved !== false ||
      reviewDraft.isPublished !== false ||
      reviewDraft.isReadyForPeia !== false
    ) {
      return makeGetHoldDto('SECURITY_POSTURE_VIOLATION', receiptId);
    }

    if (
      reviewDraft.receiptId !== receipt.receiptId ||
      reviewDraft.sourceRevision !== receiptEnvelope.revision ||
      reviewDraft.sourceUpdatedAt !== receipt.updatedAt ||
      reviewDraft.sourceSha256 !== receipt.sha256 ||
      reviewDraft.format !== receipt.format ||
      reviewDraft.uploaderUid !== receipt.uploaderUid
    ) {
      return makeGetHoldDto('DRAFT_SOURCE_MISMATCH', receiptId);
    }

    // 3. Read optional persisted human review case
    let caseLookup: Awaited<
      ReturnType<
        LibraryQuarantineHumanReviewCaseStorePort['getHumanReviewCaseByReceiptId']
      >
    >;
    try {
      caseLookup =
        await this.caseStore.getHumanReviewCaseByReceiptId(receiptId);
    } catch {
      return makeGetHoldDto('STORE_READ_FAILED', receiptId);
    }

    if (!caseLookup || typeof caseLookup !== 'object' || !caseLookup.ok) {
      return makeGetHoldDto(
        caseLookup && !caseLookup.ok
          ? caseLookup.errorCode
          : 'STORE_READ_FAILED',
        receiptId
      );
    }

    let sanitizedCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null =
      null;
    let currentRevision = 0;

    if (caseLookup.reviewCase !== null) {
      const strictCaseCheck = validatePersistedLibraryQuarantineHumanReviewCase(
        caseLookup.reviewCase,
        receiptId
      );
      if (!strictCaseCheck.ok) {
        return makeGetHoldDto('CORRUPTED_EXISTING_HUMAN_REVIEW_CASE', receiptId);
      }

      const persistedCase = strictCaseCheck.reviewCase;
      if (
        persistedCase.sourceRevision !== receiptEnvelope.revision ||
        persistedCase.sourceUpdatedAt !== receipt.updatedAt ||
        persistedCase.sourceSha256 !== receipt.sha256 ||
        persistedCase.draftSourceRevision !== reviewDraft.sourceRevision
      ) {
        return makeGetHoldDto('CASE_SOURCE_STALE_OR_MISMATCHED', receiptId);
      }

      sanitizedCase = toSanitizedLibraryQuarantineHumanReviewCaseDto(
        persistedCase
      );
      currentRevision = sanitizedCase.revision;
    }

    return Object.freeze({
      ok: true as const,
      status: 'READY' as const,
      receiptId,
      sourceRevision: receiptEnvelope.revision,
      draftStatus: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
      adminReceipt: sanitizedReceipt,
      currentRevision,
      reviewCase: sanitizedCase,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  /**
   * Validates and saves human review editorial metadata and preliminary status
   * for an eligible `Quarantined` receipt linked to a `PENDING_HUMAN_REVIEW`
   * draft, enforcing compare-and-swap (`expectedRevision`) and recording an
   * append-only audit event.
   */
  public async saveQuarantineHumanReviewCase(
    rawInput: unknown
  ): Promise<SaveLibraryQuarantineHumanReviewCaseResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makeSaveHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_SAVE_INPUT_KEYS)) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeSaveHoldDto('UNTRUSTED_CALLER_FIELD_HOLD', candidateId);
    }

    if (
      !Object.prototype.hasOwnProperty.call(rawInput, 'receiptId') ||
      !Object.prototype.hasOwnProperty.call(rawInput, 'expectedRevision') ||
      !Object.prototype.hasOwnProperty.call(rawInput, 'input')
    ) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeSaveHoldDto('INVALID_SERVICE_INPUT_HOLD', candidateId);
    }

    const receiptId = rawInput.receiptId;
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeSaveHoldDto('INVALID_RECEIPT_ID', null);
    }

    const expectedRevision = rawInput.expectedRevision;
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return makeSaveHoldDto('INVALID_EXPECTED_REVISION', receiptId);
    }

    const editorialValidation = validateHumanReviewCaseEditorialInput(
      rawInput.input
    );
    if (!editorialValidation.ok) {
      return makeSaveHoldDto(editorialValidation.errorCode, receiptId);
    }

    const authResult = await this.resolveAndAuthorizeReviewer();
    if (!authResult.ok) {
      return makeSaveHoldDto(authResult.errorCode, receiptId);
    }

    let nowIso: string;
    try {
      nowIso = this.clock();
    } catch {
      return makeSaveHoldDto('INVALID_TIMESTAMP', receiptId);
    }
    if (!isValidIsoUtcTimestamp(nowIso)) {
      return makeSaveHoldDto('INVALID_TIMESTAMP', receiptId);
    }

    let storeResult: Awaited<
      ReturnType<
        LibraryQuarantineHumanReviewCaseStorePort['saveHumanReviewCaseAtomically']
      >
    >;
    try {
      storeResult = await this.caseStore.saveHumanReviewCaseAtomically({
        receiptId,
        expectedRevision,
        actorUid: authResult.reviewerUid,
        nowIso,
        input: editorialValidation.value,
      });
    } catch {
      return Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        caseSaveOutcome: 'UNKNOWN' as const,
        caseSaved: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage:
          HUMAN_REVIEW_SERVICE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
        receiptId,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (!storeResult || typeof storeResult !== 'object') {
      return Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        caseSaveOutcome: 'UNKNOWN' as const,
        caseSaved: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage:
          HUMAN_REVIEW_SERVICE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
        receiptId,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (storeResult.status === 'UNKNOWN') {
      return Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        caseSaveOutcome: 'UNKNOWN' as const,
        caseSaved: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage:
          HUMAN_REVIEW_SERVICE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
        receiptId,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (storeResult.status === 'HOLD') {
      return makeSaveHoldDto(storeResult.reasonCode, receiptId);
    }

    if (storeResult.status === 'CONFLICT') {
      let currentCaseDto: SanitizedLibraryQuarantineHumanReviewCaseDto | null =
        null;
      if (storeResult.currentCase !== null) {
        try {
          currentCaseDto = toSanitizedLibraryQuarantineHumanReviewCaseDto(
            storeResult.currentCase
          );
        } catch {
          return makeSaveHoldDto(
            'CORRUPTED_EXISTING_HUMAN_REVIEW_CASE',
            receiptId
          );
        }
      }

      return Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        caseSaveOutcome: 'NOT_SAVED' as const,
        caseSaved: false as const,
        errorCode: 'CASE_REVISION_CONFLICT' as const,
        errorMessage:
          HUMAN_REVIEW_SERVICE_SAFE_MESSAGES.CASE_REVISION_CONFLICT,
        receiptId,
        currentRevision: storeResult.currentRevision,
        currentCase: currentCaseDto,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    // status === 'SAVED'
    let sanitizedSavedCase: SanitizedLibraryQuarantineHumanReviewCaseDto;
    try {
      sanitizedSavedCase = toSanitizedLibraryQuarantineHumanReviewCaseDto(
        storeResult.reviewCase
      );
    } catch {
      return Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        caseSaveOutcome: 'UNKNOWN' as const,
        caseSaved: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage:
          HUMAN_REVIEW_SERVICE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
        receiptId,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    return Object.freeze({
      ok: true as const,
      status: 'SAVED' as const,
      caseSaveOutcome: storeResult.caseSaveOutcome,
      caseSaved: true as const,
      receiptId,
      sourceRevision: storeResult.receiptEnvelope.revision,
      currentRevision: storeResult.currentRevision,
      reviewCase: sanitizedSavedCase,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }
}
