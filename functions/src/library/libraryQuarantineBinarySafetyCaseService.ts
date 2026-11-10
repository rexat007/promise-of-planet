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
  BINARY_SAFETY_STORE_SAFE_MESSAGES,
  FirestoreLibraryQuarantineBinarySafetyCaseStore,
  type LibraryQuarantineBinarySafetyCaseStore,
  type LibraryQuarantineBinarySafetyCaseStoreErrorCode,
} from './firestoreLibraryQuarantineBinarySafetyCaseStore';
import {
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
  deriveQuarantineCatalogDocumentIdFromReceipt,
  toSanitizedLibraryQuarantineBinarySafetyCaseDto,
  validateSaveLibraryQuarantineBinarySafetyCaseInput,
  type LibraryQuarantineBinarySafetyDeepInspectionStatus,
  type LibraryQuarantineBinarySafetySourceFormat,
  type LibraryQuarantineReadinessIndicatorsDto,
  type SanitizedLibraryQuarantineBinarySafetyCaseDto,
  type SaveLibraryQuarantineBinarySafetyCaseInput,
} from './libraryQuarantineBinarySafetyCaseContract';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import type {
  TrustedQuarantineAuthenticatedPrincipal,
  TrustedQuarantineReviewerPrincipalProvider,
} from './libraryQuarantineReviewDraftPersistenceService';

const ALLOWED_GET_INPUT_KEYS: ReadonlySet<string> = new Set(['receiptId']);

const ALLOWED_SAVE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedRevision',
  'acknowledgedHumanCaseRevision',
  'input',
]);

const ALLOWED_PRINCIPAL_KEYS: ReadonlySet<string> = new Set(['uid', 'token']);

const FORBIDDEN_TOKEN_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'role',
  'roles',
  'adminRole',
  'permissions',
  'permission',
  'adminPermissions',
  'isActive',
  'adminActive',
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

export type LibraryQuarantineBinarySafetyErrorCode =
  | LibraryQuarantineBinarySafetyCaseStoreErrorCode
  | 'INVALID_SERVICE_INPUT_HOLD'
  | 'UNTRUSTED_CALLER_FIELD_HOLD'
  | 'UNAUTHENTICATED_CALLER_HOLD'
  | 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD';

export const BINARY_SAFETY_SERVICE_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineBinarySafetyErrorCode, string>
> = Object.freeze({
  ...BINARY_SAFETY_STORE_SAFE_MESSAGES,
  INVALID_SERVICE_INPUT_HOLD:
    'Binary safety case request payload must be a plain object with required fields.',
  UNTRUSTED_CALLER_FIELD_HOLD:
    'Binary safety case request payload contains an unexpected, privileged, or forbidden property.',
  UNAUTHENTICATED_CALLER_HOLD:
    'Request is missing a valid server-authenticated Firebase user principal.',
  UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD:
    'Authenticated caller is not an active authorized human Library Owner with Review permission.',
});

export interface GetLibraryQuarantineBinarySafetyCaseInput {
  readonly receiptId: string;
}

export interface SaveLibraryQuarantineBinarySafetyCaseServiceInput {
  readonly receiptId: string;
  readonly expectedRevision: number;
  readonly acknowledgedHumanCaseRevision?: number;
  readonly input: SaveLibraryQuarantineBinarySafetyCaseInput;
}

export interface GetLibraryQuarantineBinarySafetyCaseSuccessDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly outcome: 'READY';
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly effectiveHumanCaseUpdatedAt: string;
  readonly catalogUpdatedAt: string;
  readonly currentRevision: number;
  readonly isCaseCurrent: boolean;
  readonly requiresFreshEvidence: boolean;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineBinarySafetyCaseHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly errorCode: LibraryQuarantineBinarySafetyErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineBinarySafetyCaseResponseDto =
  | GetLibraryQuarantineBinarySafetyCaseSuccessDto
  | GetLibraryQuarantineBinarySafetyCaseHoldDto;

export interface SaveLibraryQuarantineBinarySafetyCaseSuccessDto {
  readonly ok: true;
  readonly status: 'SAVED';
  readonly outcome: 'SAVED';
  readonly caseSaveOutcome: 'CREATED' | 'UPDATED';
  readonly caseSaved: true;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly currentRevision: number;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly effectiveHumanCaseUpdatedAt: string;
  readonly catalogUpdatedAt: string;
  readonly isCaseCurrent: true;
  readonly requiresFreshEvidence: false;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineBinarySafetyCaseConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly outcome: 'CONFLICT';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly errorCode: 'BINARY_SAFETY_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentRevision: number;
  readonly currentBinarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineBinarySafetyCaseHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly caseSaveOutcome: 'NOT_SAVED';
  readonly caseSaved: false;
  readonly errorCode: LibraryQuarantineBinarySafetyErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SaveLibraryQuarantineBinarySafetyCaseUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly outcome: 'UNKNOWN';
  readonly caseSaveOutcome: 'UNKNOWN';
  readonly caseSaved: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type SaveLibraryQuarantineBinarySafetyCaseResponseDto =
  | SaveLibraryQuarantineBinarySafetyCaseSuccessDto
  | SaveLibraryQuarantineBinarySafetyCaseConflictDto
  | SaveLibraryQuarantineBinarySafetyCaseHoldDto
  | SaveLibraryQuarantineBinarySafetyCaseUnknownDto;

export interface LibraryQuarantineBinarySafetyCaseServiceOptions {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly safetyCaseStore?: LibraryQuarantineBinarySafetyCaseStore;
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
 * Verifies that the authenticated caller is an active human Library Owner
 * (`AdminRole.Owner` ONLY) who possesses `AdminPermission.Review`.
 */
export function isAuthorizedHumanBinarySafetyOwner(
  user: AdminUser | null | undefined
): user is AdminUser {
  if (!user || typeof user !== 'object') {
    return false;
  }
  if (user.isActive !== true) {
    return false;
  }
  if (!isValidAdminRole(user.role) || user.role !== AdminRole.Owner) {
    return false;
  }
  if (!hasDomainResponsibility(user.role, AdminDomain.Library)) {
    return false;
  }
  if (!AdminAuthorizationService.hasPermission(user, AdminPermission.Review)) {
    return false;
  }

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
  errorCode: LibraryQuarantineBinarySafetyErrorCode,
  receiptId: string | null
): GetLibraryQuarantineBinarySafetyCaseHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    errorCode,
    errorMessage: BINARY_SAFETY_SERVICE_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentIdFromReceipt(safeReceiptId)
      : null,
    readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeSaveHoldDto(
  errorCode: LibraryQuarantineBinarySafetyErrorCode,
  receiptId: string | null
): SaveLibraryQuarantineBinarySafetyCaseHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    caseSaveOutcome: 'NOT_SAVED' as const,
    caseSaved: false as const,
    errorCode,
    errorMessage: BINARY_SAFETY_SERVICE_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentIdFromReceipt(safeReceiptId)
      : null,
    readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeSaveUnknownDto(
  receiptId: string
): SaveLibraryQuarantineBinarySafetyCaseUnknownDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    outcome: 'UNKNOWN' as const,
    caseSaveOutcome: 'UNKNOWN' as const,
    caseSaved: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
    errorMessage:
      BINARY_SAFETY_SERVICE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
    receiptId,
    documentId: deriveQuarantineCatalogDocumentIdFromReceipt(receiptId),
    readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

export class LibraryQuarantineBinarySafetyCaseService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly safetyCaseStore: LibraryQuarantineBinarySafetyCaseStore;
  private readonly clock: () => string;

  constructor(options: LibraryQuarantineBinarySafetyCaseServiceOptions) {
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
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineBinarySafetyCaseService requires valid trustedPrincipalProvider and adminRepository.'
      );
    }

    const resolvedStore =
      options.safetyCaseStore ??
      (options.db
        ? new FirestoreLibraryQuarantineBinarySafetyCaseStore(options.db)
        : null);

    if (
      !resolvedStore ||
      typeof resolvedStore.getBinarySafetyCaseSnapshot !== 'function' ||
      typeof resolvedStore.saveBinarySafetyCaseTransactional !== 'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineBinarySafetyCaseService requires either safetyCaseStore or Firestore db.'
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

    this.safetyCaseStore = resolvedStore;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private async resolveAndAuthorizeBinarySafetyOwner(): Promise<
    | { readonly ok: true; readonly actorUid: string }
    | {
        readonly ok: false;
        readonly errorCode:
          | 'UNAUTHENTICATED_CALLER_HOLD'
          | 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD';
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
      return { ok: false, errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD' };
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
        return { ok: false, errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD' };
      }

      for (const key of Object.getOwnPropertyNames(rawPrincipal.token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(key)) {
          return {
            ok: false,
            errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD',
          };
        }
      }

      if (hasAutomatedOrAiTokenClaim(rawPrincipal.token)) {
        return { ok: false, errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD' };
      }
    }

    let adminUser: AdminUser | null;
    try {
      adminUser = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return { ok: false, errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD' };
    }

    if (!adminUser || typeof adminUser !== 'object') {
      return { ok: false, errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD' };
    }

    const adminId =
      typeof adminUser.id === 'string' ? adminUser.id.trim() : '';
    const adminUid =
      typeof (adminUser as { readonly uid?: unknown }).uid === 'string'
        ? ((adminUser as { readonly uid: string }).uid).trim()
        : '';

    if (adminId !== uid && adminUid !== uid) {
      return { ok: false, errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD' };
    }

    if (!isAuthorizedHumanBinarySafetyOwner(adminUser)) {
      return { ok: false, errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD' };
    }

    return { ok: true, actorUid: uid };
  }

  /**
   * Reads the current human binary safety case and readiness indicators for an
   * internal `qcat-<receiptId>` catalog draft (7 point reads, 0 writes).
   */
  public async getQuarantineBinarySafetyCase(
    rawInput: unknown
  ): Promise<GetLibraryQuarantineBinarySafetyCaseResponseDto> {
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

    const authResult = await this.resolveAndAuthorizeBinarySafetyOwner();
    if (!authResult.ok) {
      return makeGetHoldDto(authResult.errorCode, receiptId);
    }

    let snapshotRes: Awaited<
      ReturnType<
        LibraryQuarantineBinarySafetyCaseStore['getBinarySafetyCaseSnapshot']
      >
    >;
    try {
      snapshotRes =
        await this.safetyCaseStore.getBinarySafetyCaseSnapshot(receiptId);
    } catch {
      return makeGetHoldDto('STORE_READ_FAILED', receiptId);
    }

    if (!snapshotRes.ok) {
      return makeGetHoldDto(snapshotRes.errorCode, receiptId);
    }

    const { snapshot } = snapshotRes;
    let sanitizedCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null =
      null;
    if (snapshot.binarySafetyCase !== null) {
      try {
        sanitizedCase = toSanitizedLibraryQuarantineBinarySafetyCaseDto(
          snapshot.binarySafetyCase
        );
      } catch {
        return makeGetHoldDto(
          'CORRUPTED_EXISTING_BINARY_SAFETY_CASE',
          receiptId
        );
      }
    }

    return Object.freeze({
      ok: true as const,
      status: 'READY' as const,
      outcome: 'READY' as const,
      receiptId,
      documentId: snapshot.documentId,
      sourceRevision: snapshot.receiptEnvelope.revision,
      sourceUpdatedAt: snapshot.receiptEnvelope.receipt.updatedAt,
      sourceFormat: snapshot.sourceFormat,
      deepInspectionStatus: snapshot.deepInspectionStatus,
      catalogHandoffCaseRevision: snapshot.catalogHandoff.caseRevision,
      currentHumanCaseRevision: snapshot.humanReviewCase.revision,
      effectiveHumanCaseRevision: snapshot.effectiveHumanCaseRevision,
      effectiveHumanCaseUpdatedAt: snapshot.effectiveHumanCaseUpdatedAt,
      catalogUpdatedAt: snapshot.catalogUpdatedAt,
      currentRevision: sanitizedCase ? sanitizedCase.revision : 0,
      isCaseCurrent: snapshot.isCaseCurrent,
      requiresFreshEvidence: snapshot.requiresFreshEvidence,
      readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
      binarySafetyCase: sanitizedCase,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  /**
   * Atomically creates or updates the human binary safety case for an internal
   * `qcat-<receiptId>` catalog draft inside a single 8-read, 2-write transaction.
   */
  public async saveQuarantineBinarySafetyCase(
    rawInput: unknown
  ): Promise<SaveLibraryQuarantineBinarySafetyCaseResponseDto> {
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

    const rawAckCaseRevision = rawInput.acknowledgedHumanCaseRevision;
    if (
      rawAckCaseRevision === undefined ||
      typeof rawAckCaseRevision !== 'number' ||
      !Number.isSafeInteger(rawAckCaseRevision) ||
      rawAckCaseRevision < 1
    ) {
      return makeSaveHoldDto('UNACKNOWLEDGED_CASE_REVISION_HOLD', receiptId);
    }
    const acknowledgedHumanCaseRevision = rawAckCaseRevision;

    const editorialCheck = validateSaveLibraryQuarantineBinarySafetyCaseInput(
      rawInput.input
    );
    if (!editorialCheck.ok) {
      return makeSaveHoldDto(editorialCheck.errorCode, receiptId);
    }

    const authResult = await this.resolveAndAuthorizeBinarySafetyOwner();
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
        LibraryQuarantineBinarySafetyCaseStore['saveBinarySafetyCaseTransactional']
      >
    >;
    try {
      storeResult = await this.safetyCaseStore.saveBinarySafetyCaseTransactional(
        {
          receiptId,
          expectedRevision,
          acknowledgedHumanCaseRevision,
          actorUid: authResult.actorUid,
          nowIso,
          input: editorialCheck.value,
        }
      );
    } catch {
      return makeSaveUnknownDto(receiptId);
    }

    if (storeResult.status === 'SAVED') {
      let sanitizedCase: SanitizedLibraryQuarantineBinarySafetyCaseDto;
      try {
        sanitizedCase = toSanitizedLibraryQuarantineBinarySafetyCaseDto(
          storeResult.binarySafetyCase
        );
      } catch {
        // CRITICAL: The transaction has ALREADY committed in the store (`status === 'SAVED'`).
        // Never misclassify a post-commit DTO sanitization error as HOLD / NOT_SAVED!
        return makeSaveUnknownDto(receiptId);
      }

      return Object.freeze({
        ok: true as const,
        status: 'SAVED' as const,
        outcome: 'SAVED' as const,
        caseSaveOutcome: storeResult.caseSaveOutcome,
        caseSaved: true as const,
        receiptId,
        documentId: storeResult.documentId,
        revision: storeResult.currentRevision,
        currentRevision: storeResult.currentRevision,
        sourceRevision: storeResult.chainSnapshot.receiptEnvelope.revision,
        sourceUpdatedAt:
          storeResult.chainSnapshot.receiptEnvelope.receipt.updatedAt,
        sourceFormat: storeResult.chainSnapshot.sourceFormat,
        deepInspectionStatus: storeResult.chainSnapshot.deepInspectionStatus,
        catalogHandoffCaseRevision:
          storeResult.chainSnapshot.catalogHandoff.caseRevision,
        currentHumanCaseRevision:
          storeResult.chainSnapshot.humanReviewCase.revision,
        effectiveHumanCaseRevision:
          storeResult.chainSnapshot.effectiveHumanCaseRevision,
        effectiveHumanCaseUpdatedAt:
          storeResult.chainSnapshot.effectiveHumanCaseUpdatedAt,
        catalogUpdatedAt: storeResult.chainSnapshot.catalogUpdatedAt,
        isCaseCurrent: true as const,
        requiresFreshEvidence: false as const,
        readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
        binarySafetyCase: sanitizedCase,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (storeResult.status === 'CONFLICT') {
      let currentSanitized: SanitizedLibraryQuarantineBinarySafetyCaseDto | null =
        null;
      if (storeResult.currentBinarySafetyCase !== null) {
        try {
          currentSanitized = toSanitizedLibraryQuarantineBinarySafetyCaseDto(
            storeResult.currentBinarySafetyCase
          );
        } catch {
          return makeSaveHoldDto(
            'CORRUPTED_EXISTING_BINARY_SAFETY_CASE',
            receiptId
          );
        }
      }

      return Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        outcome: 'CONFLICT' as const,
        caseSaveOutcome: 'NOT_SAVED' as const,
        caseSaved: false as const,
        errorCode: 'BINARY_SAFETY_REVISION_CONFLICT' as const,
        errorMessage: storeResult.errorMessage,
        receiptId,
        documentId: storeResult.documentId,
        currentRevision: storeResult.currentRevision,
        currentBinarySafetyCase: currentSanitized,
        readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
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
