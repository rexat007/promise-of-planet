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
import type { LibraryQuarantineReviewDraftFirestoreDatabase } from './firestoreLibraryQuarantineReviewDraftStore';
import {
  FirestoreLibraryQuarantineRightsDecisionStore,
  RIGHTS_DECISION_STORE_SAFE_MESSAGES,
  type LibraryQuarantineRightsDecisionStore,
  type LibraryQuarantineRightsDecisionStoreErrorCode,
} from './firestoreLibraryQuarantineRightsDecisionStore';
import {
  LIBRARY_QUARANTINE_RIGHTS_SCOPE,
  QUARANTINE_RIGHTS_READINESS_INDICATORS,
  deriveQuarantineCatalogDocumentIdFromReceipt,
  toSanitizedLibraryQuarantineRightsDecisionDto,
  validateRightsDecisionInput,
  type LibraryQuarantineReadinessIndicatorsDto,
  type SanitizedLibraryQuarantineRightsDecisionDto,
  type SaveLibraryQuarantineRightsDecisionInput,
} from './libraryQuarantineRightsDecisionContract';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import type {
  TrustedQuarantineAuthenticatedPrincipal,
  TrustedQuarantineReviewerPrincipalProvider,
} from './libraryQuarantineReviewDraftPersistenceService';

/**
 * LIB-FILE-RIGHTS-AND-READINESS-01 — Server-Side Human Rights Review Decision Service
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Enforces server-derived principal authentication (`request.auth.uid`) and
 *   active human RBAC requiring BOTH `AdminPermission.Review` AND
 *   `AdminPermission.ManageRights` (`Owner` and `RightsReviewer` qualify by default;
 *   `LibraryCurator` without `ManageRights`, `Viewer`, `ContentEditor`,
 *   `TrainingManager`, `AIAssistant`, and inactive accounts are rejected).
 * - Never trusts caller-supplied `uid`, `role`, `permissions`, `rightsScope`,
 *   `isRightsApproved`, `isPublished`, `storagePath`, `generation`, or URLs.
 * - Preserves constant non-assurance readiness indicators
 *   (`binarySafety: 'NOT_VERIFIED'`, `fileSanitization: 'NOT_PERFORMED'`,
 *   `publication: 'BLOCKED'`, `catalogWorkflow: 'Draft'`) and all 5 security
 *   posture flags (`false`) across every response DTO.
 * - Redacts raw exceptions and never leaks internal secrets, SHA-256 digests,
 *   actor UIDs, or storage paths.
 */

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

export type LibraryQuarantineRightsDecisionErrorCode =
  | LibraryQuarantineRightsDecisionStoreErrorCode
  | 'INVALID_SERVICE_INPUT_HOLD'
  | 'UNTRUSTED_CALLER_FIELD_HOLD'
  | 'UNAUTHENTICATED_CALLER_HOLD'
  | 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD';

export const RIGHTS_DECISION_SERVICE_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineRightsDecisionErrorCode, string>
> = Object.freeze({
  ...RIGHTS_DECISION_STORE_SAFE_MESSAGES,
  INVALID_SERVICE_INPUT_HOLD:
    'Rights decision request payload must be a plain object with required fields.',
  UNTRUSTED_CALLER_FIELD_HOLD:
    'Rights decision request payload contains an unexpected, privileged, or forbidden property.',
  UNAUTHENTICATED_CALLER_HOLD:
    'Request is missing a valid server-authenticated Firebase user principal.',
  UNAUTHORIZED_RIGHTS_REVIEWER_HOLD:
    'Authenticated caller is not an active authorized human Library rights reviewer with both Review and ManageRights permissions.',
});

export interface GetLibraryQuarantineRightsDecisionInput {
  readonly receiptId: string;
}

export interface SaveLibraryQuarantineRightsDecisionServiceInput {
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly input: SaveLibraryQuarantineRightsDecisionInput;
}

export interface GetLibraryQuarantineRightsDecisionSuccessDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly currentRevision: number;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly rightsDecision: SanitizedLibraryQuarantineRightsDecisionDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineRightsDecisionHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: LibraryQuarantineRightsDecisionErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineRightsDecisionResponseDto =
  | GetLibraryQuarantineRightsDecisionSuccessDto
  | GetLibraryQuarantineRightsDecisionHoldDto;

export interface SaveLibraryQuarantineRightsDecisionSuccessDto {
  readonly ok: true;
  readonly status: 'SAVED';
  readonly decisionSaveOutcome: 'CREATED' | 'UPDATED';
  readonly decisionSaved: true;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly currentRevision: number;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly rightsDecision: SanitizedLibraryQuarantineRightsDecisionDto;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineRightsDecisionConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly decisionSaveOutcome: 'NOT_SAVED';
  readonly decisionSaved: false;
  readonly errorCode: 'RIGHTS_DECISION_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentRevision: number;
  readonly currentDecision: SanitizedLibraryQuarantineRightsDecisionDto | null;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineRightsDecisionHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly decisionSaveOutcome: 'NOT_SAVED';
  readonly decisionSaved: false;
  readonly errorCode: LibraryQuarantineRightsDecisionErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineRightsDecisionUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly decisionSaveOutcome: 'UNKNOWN';
  readonly decisionSaved: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type SaveLibraryQuarantineRightsDecisionResponseDto =
  | SaveLibraryQuarantineRightsDecisionSuccessDto
  | SaveLibraryQuarantineRightsDecisionConflictDto
  | SaveLibraryQuarantineRightsDecisionHoldDto
  | SaveLibraryQuarantineRightsDecisionUnknownDto;

export interface LibraryQuarantineRightsDecisionServiceOptions {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly decisionStore?: LibraryQuarantineRightsDecisionStore;
  readonly db?: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly clock?: () => string;
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

/**
 * Verifies that the authenticated caller is an active human Library administrator
 * who possesses BOTH `AdminPermission.Review` AND `AdminPermission.ManageRights`.
 * (`Owner` and `RightsReviewer` qualify by default; `LibraryCurator` without `ManageRights` does not.)
 */
export function isAuthorizedHumanLibraryRightsReviewer(
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
  if (
    !AdminAuthorizationService.hasPermission(user, AdminPermission.Review) ||
    !AdminAuthorizationService.hasPermission(user, AdminPermission.ManageRights)
  ) {
    return false;
  }

  const explicitPermissions = (
    user as AdminUser & { readonly permissions?: unknown }
  ).permissions;
  if (explicitPermissions !== undefined) {
    if (
      !Array.isArray(explicitPermissions) ||
      !explicitPermissions.includes(AdminPermission.Review) ||
      !explicitPermissions.includes(AdminPermission.ManageRights)
    ) {
      return false;
    }
  }

  return true;
}

function makeGetHoldDto(
  errorCode: LibraryQuarantineRightsDecisionErrorCode,
  receiptId: string | null
): GetLibraryQuarantineRightsDecisionHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    errorCode,
    errorMessage: RIGHTS_DECISION_SERVICE_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentIdFromReceipt(safeReceiptId)
      : null,
    rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
    readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeSaveHoldDto(
  errorCode: LibraryQuarantineRightsDecisionErrorCode,
  receiptId: string | null
): SaveLibraryQuarantineRightsDecisionHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    decisionSaveOutcome: 'NOT_SAVED' as const,
    decisionSaved: false as const,
    errorCode,
    errorMessage: RIGHTS_DECISION_SERVICE_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentIdFromReceipt(safeReceiptId)
      : null,
    rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
    readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeSaveUnknownDto(
  receiptId: string
): SaveLibraryQuarantineRightsDecisionUnknownDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    decisionSaveOutcome: 'UNKNOWN' as const,
    decisionSaved: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
    errorMessage:
      RIGHTS_DECISION_SERVICE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
    receiptId,
    documentId: deriveQuarantineCatalogDocumentIdFromReceipt(receiptId),
    rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
    readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

export class LibraryQuarantineRightsDecisionService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly decisionStore: LibraryQuarantineRightsDecisionStore;
  private readonly clock: () => string;

  constructor(options: LibraryQuarantineRightsDecisionServiceOptions) {
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
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineRightsDecisionService requires valid trustedPrincipalProvider and adminRepository.'
      );
    }

    const resolvedStore =
      options.decisionStore ??
      (options.db
        ? new FirestoreLibraryQuarantineRightsDecisionStore(options.db)
        : null);

    if (
      !resolvedStore ||
      typeof resolvedStore.getRightsDecisionSnapshot !== 'function' ||
      typeof resolvedStore.saveRightsDecisionTransactional !== 'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineRightsDecisionService requires either decisionStore or Firestore db.'
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

    this.decisionStore = resolvedStore;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private async resolveAndAuthorizeRightsReviewer(): Promise<
    | { readonly ok: true; readonly actorUid: string }
    | {
        readonly ok: false;
        readonly errorCode:
          | 'UNAUTHENTICATED_CALLER_HOLD'
          | 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD';
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
      return { ok: false, errorCode: 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD' };
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
        return { ok: false, errorCode: 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD' };
      }

      for (const key of Object.getOwnPropertyNames(rawPrincipal.token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(key)) {
          return { ok: false, errorCode: 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD' };
        }
      }

      if (hasAutomatedOrAiTokenClaim(rawPrincipal.token)) {
        return { ok: false, errorCode: 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD' };
      }
    }

    let adminUser: AdminUser | null;
    try {
      adminUser = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return { ok: false, errorCode: 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD' };
    }

    if (
      !adminUser ||
      typeof adminUser.id !== 'string' ||
      adminUser.id.trim() !== uid ||
      adminUser.id !== uid
    ) {
      return { ok: false, errorCode: 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD' };
    }

    if (!isAuthorizedHumanLibraryRightsReviewer(adminUser)) {
      return { ok: false, errorCode: 'UNAUTHORIZED_RIGHTS_REVIEWER_HOLD' };
    }

    return { ok: true, actorUid: uid };
  }

  /**
   * Reads the current human rights decision and readiness indicators for an
   * internal `qcat-<receiptId>` catalog draft.
   */
  public async getQuarantineRightsDecision(
    rawInput: unknown
  ): Promise<GetLibraryQuarantineRightsDecisionResponseDto> {
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

    const authResult = await this.resolveAndAuthorizeRightsReviewer();
    if (!authResult.ok) {
      return makeGetHoldDto(authResult.errorCode, receiptId);
    }

    let snapshotRes: Awaited<
      ReturnType<
        LibraryQuarantineRightsDecisionStore['getRightsDecisionSnapshot']
      >
    >;
    try {
      snapshotRes =
        await this.decisionStore.getRightsDecisionSnapshot(receiptId);
    } catch {
      return makeGetHoldDto('STORE_READ_FAILED', receiptId);
    }

    if (!snapshotRes.ok) {
      return makeGetHoldDto(snapshotRes.errorCode, receiptId);
    }

    const { snapshot } = snapshotRes;
    let sanitizedDecision: SanitizedLibraryQuarantineRightsDecisionDto | null =
      null;
    if (snapshot.rightsDecision !== null) {
      try {
        sanitizedDecision = toSanitizedLibraryQuarantineRightsDecisionDto(
          snapshot.rightsDecision
        );
      } catch {
        return makeGetHoldDto('CORRUPTED_EXISTING_RIGHTS_DECISION', receiptId);
      }
    }

    return Object.freeze({
      ok: true as const,
      status: 'READY' as const,
      receiptId,
      documentId: snapshot.documentId,
      sourceRevision: snapshot.receiptEnvelope.revision,
      catalogHandoffCaseRevision: snapshot.catalogHandoff.caseRevision,
      currentHumanCaseRevision: snapshot.humanReviewCase.revision,
      currentRevision: sanitizedDecision ? sanitizedDecision.revision : 0,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      rightsDecision: sanitizedDecision,
      readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  /**
   * Atomically creates or updates the human rights decision for an internal
   * `qcat-<receiptId>` catalog draft with compare-and-swap (`expectedRevision`)
   * and an append-only audit event.
   */
  public async saveQuarantineRightsDecision(
    rawInput: unknown
  ): Promise<SaveLibraryQuarantineRightsDecisionResponseDto> {
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

    const editorialCheck = validateRightsDecisionInput(rawInput.input);
    if (!editorialCheck.ok) {
      return makeSaveHoldDto(editorialCheck.errorCode, receiptId);
    }

    const authResult = await this.resolveAndAuthorizeRightsReviewer();
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
        LibraryQuarantineRightsDecisionStore['saveRightsDecisionTransactional']
      >
    >;
    try {
      storeResult = await this.decisionStore.saveRightsDecisionTransactional({
        receiptId,
        expectedRevision,
        actorUid: authResult.actorUid,
        nowIso,
        input: editorialCheck.value,
      });
    } catch {
      return makeSaveUnknownDto(receiptId);
    }

    if (storeResult.status === 'SAVED') {
      let sanitizedDecision: SanitizedLibraryQuarantineRightsDecisionDto;
      try {
        sanitizedDecision = toSanitizedLibraryQuarantineRightsDecisionDto(
          storeResult.rightsDecision
        );
      } catch {
        return makeSaveHoldDto('CORRUPTED_EXISTING_RIGHTS_DECISION', receiptId);
      }

      return Object.freeze({
        ok: true as const,
        status: 'SAVED' as const,
        decisionSaveOutcome: storeResult.decisionSaveOutcome,
        decisionSaved: true as const,
        receiptId,
        documentId: storeResult.documentId,
        sourceRevision: storeResult.chainSnapshot.receiptEnvelope.revision,
        catalogHandoffCaseRevision:
          storeResult.chainSnapshot.catalogHandoff.caseRevision,
        currentHumanCaseRevision:
          storeResult.chainSnapshot.humanReviewCase.revision,
        currentRevision: storeResult.currentRevision,
        rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
        rightsDecision: sanitizedDecision,
        readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (storeResult.status === 'CONFLICT') {
      let currentSanitized: SanitizedLibraryQuarantineRightsDecisionDto | null =
        null;
      if (storeResult.currentDecision !== null) {
        try {
          currentSanitized = toSanitizedLibraryQuarantineRightsDecisionDto(
            storeResult.currentDecision
          );
        } catch {
          return makeSaveHoldDto(
            'CORRUPTED_EXISTING_RIGHTS_DECISION',
            receiptId
          );
        }
      }

      return Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        decisionSaveOutcome: 'NOT_SAVED' as const,
        decisionSaved: false as const,
        errorCode: 'RIGHTS_DECISION_REVISION_CONFLICT' as const,
        errorMessage: storeResult.errorMessage,
        receiptId,
        documentId: storeResult.documentId,
        currentRevision: storeResult.currentRevision,
        currentDecision: currentSanitized,
        rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
        readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (storeResult.status === 'UNKNOWN') {
      return makeSaveUnknownDto(receiptId);
    }

    return makeSaveHoldDto(storeResult.reasonCode, receiptId);
  }
}
