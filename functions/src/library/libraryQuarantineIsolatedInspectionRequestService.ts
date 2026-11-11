import type { AdminRepository } from '../admin/adminRepository';
import { AdminRole, type AdminUser } from '../types/admin';
import type { LibraryQuarantineReviewDraftFirestoreDatabase } from './firestoreLibraryQuarantineReviewDraftStore';
import { isAuthorizedHumanBinarySafetyOwner } from './libraryQuarantineBinarySafetyCaseService';
import {
  FirestoreLibraryQuarantineIsolatedInspectionRequestStore,
  ISOLATED_INSPECTION_STORE_SAFE_MESSAGES,
  type LibraryQuarantineIsolatedInspectionRequestStore,
  type LibraryQuarantineIsolatedInspectionStoreErrorCode,
} from './firestoreLibraryQuarantineIsolatedInspectionRequestStore';
import {
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
  QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
  deriveQuarantineCatalogDocumentIdFromReceipt,
  isValidRecordIsolatedInspectionConfirmation,
  toSanitizedLibraryQuarantineIsolatedInspectionRequestDto,
  type LibraryQuarantineBinarySafetyDeepInspectionStatus,
  type LibraryQuarantineBinarySafetySourceFormat,
  type LibraryQuarantineIsolatedInspectionConfirmationLiteral,
  type LibraryQuarantineReadinessIndicatorsDto,
  type SanitizedLibraryQuarantineIsolatedInspectionRequestDto,
} from './libraryQuarantineIsolatedInspectionRequestContract';
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

const ALLOWED_RECORD_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedSafetyCaseRevision',
  'acknowledgedHumanCaseRevision',
  'confirmation',
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
  'requestedBy',
  'createdBy',
  'updatedBy',
  'storagePath',
  'generation',
  'sourceGeneration',
  'sourceSha256',
  'sha256',
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
  'dispatched',
  'scanPerformed',
  'sanitized',
  'isVerifiedSafe',
]);

export type LibraryQuarantineIsolatedInspectionErrorCode =
  | LibraryQuarantineIsolatedInspectionStoreErrorCode
  | 'INVALID_SERVICE_INPUT_HOLD'
  | 'UNTRUSTED_CALLER_FIELD_HOLD'
  | 'UNAUTHENTICATED_CALLER_HOLD'
  | 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD';

export const ISOLATED_INSPECTION_SERVICE_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineIsolatedInspectionErrorCode, string>
> = Object.freeze({
  ...ISOLATED_INSPECTION_STORE_SAFE_MESSAGES,
  INVALID_SERVICE_INPUT_HOLD:
    'Isolated inspection request payload must be a plain object with required fields.',
  UNTRUSTED_CALLER_FIELD_HOLD:
    'Isolated inspection request payload contains an unexpected, privileged, or forbidden property.',
  UNAUTHENTICATED_CALLER_HOLD:
    'Request is missing a valid server-authenticated Firebase user principal.',
  UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD:
    'Authenticated caller is not an active authorized human Library Owner with Review permission.',
});

export interface GetLibraryQuarantineIsolatedInspectionRequestInput {
  readonly receiptId: string;
}

export interface RecordLibraryQuarantineIsolatedInspectionRequestInput {
  readonly receiptId: string;
  readonly expectedSafetyCaseRevision: number;
  readonly acknowledgedHumanCaseRevision: number;
  readonly confirmation: LibraryQuarantineIsolatedInspectionConfirmationLiteral;
}

export interface GetLibraryQuarantineIsolatedInspectionRequestSuccessDto {
  readonly ok: true;
  readonly status: 'NOT_RECORDED' | 'RECORDED';
  readonly outcome: 'NOT_RECORDED' | 'RECORDED';
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineIsolatedInspectionRequestHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly errorCode: LibraryQuarantineIsolatedInspectionErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineIsolatedInspectionRequestResponseDto =
  | GetLibraryQuarantineIsolatedInspectionRequestSuccessDto
  | GetLibraryQuarantineIsolatedInspectionRequestHoldDto;

export interface RecordLibraryQuarantineIsolatedInspectionRequestSuccessDto {
  readonly ok: true;
  readonly status: 'RECORDED' | 'ALREADY_RECORDED';
  readonly outcome: 'RECORDED' | 'ALREADY_RECORDED';
  readonly requestOutcome: 'RECORDED' | 'ALREADY_RECORDED';
  readonly requestRecorded: true;
  readonly receiptId: string;
  readonly documentId: string;
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly safetyCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly catalogUpdatedAt: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly inspectionRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface RecordLibraryQuarantineIsolatedInspectionRequestConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly outcome: 'CONFLICT';
  readonly requestOutcome: 'NOT_RECORDED';
  readonly requestRecorded: false;
  readonly errorCode: 'SAFETY_CASE_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentSafetyCaseRevision: number;
  readonly currentEffectiveHumanCaseRevision: number;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface RecordLibraryQuarantineIsolatedInspectionRequestHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly outcome: 'HOLD';
  readonly requestOutcome: 'NOT_RECORDED';
  readonly requestRecorded: false;
  readonly errorCode: LibraryQuarantineIsolatedInspectionErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface RecordLibraryQuarantineIsolatedInspectionRequestUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly outcome: 'UNKNOWN';
  readonly requestOutcome: 'UNKNOWN';
  readonly requestRecorded: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly dispatched: false;
  readonly scanPerformed: false;
  readonly sanitized: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type RecordLibraryQuarantineIsolatedInspectionRequestResponseDto =
  | RecordLibraryQuarantineIsolatedInspectionRequestSuccessDto
  | RecordLibraryQuarantineIsolatedInspectionRequestConflictDto
  | RecordLibraryQuarantineIsolatedInspectionRequestHoldDto
  | RecordLibraryQuarantineIsolatedInspectionRequestUnknownDto;

export interface LibraryQuarantineIsolatedInspectionRequestServiceOptions {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly inspectionRequestStore?: LibraryQuarantineIsolatedInspectionRequestStore;
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

export function isAuthorizedHumanIsolatedInspectionOwner(
  user: AdminUser | null | undefined
): user is AdminUser {
  return isAuthorizedHumanBinarySafetyOwner(user);
}

function makeGetHoldDto(
  errorCode: LibraryQuarantineIsolatedInspectionErrorCode,
  receiptId: string | null
): GetLibraryQuarantineIsolatedInspectionRequestHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    errorCode,
    errorMessage: ISOLATED_INSPECTION_SERVICE_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentIdFromReceipt(safeReceiptId)
      : null,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    dispatched: false as const,
    scanPerformed: false as const,
    sanitized: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeRecordHoldDto(
  errorCode: LibraryQuarantineIsolatedInspectionErrorCode,
  receiptId: string | null
): RecordLibraryQuarantineIsolatedInspectionRequestHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    outcome: 'HOLD' as const,
    requestOutcome: 'NOT_RECORDED' as const,
    requestRecorded: false as const,
    errorCode,
    errorMessage: ISOLATED_INSPECTION_SERVICE_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentIdFromReceipt(safeReceiptId)
      : null,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    dispatched: false as const,
    scanPerformed: false as const,
    sanitized: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeRecordUnknownDto(
  receiptId: string
): RecordLibraryQuarantineIsolatedInspectionRequestUnknownDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    outcome: 'UNKNOWN' as const,
    requestOutcome: 'UNKNOWN' as const,
    requestRecorded: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
    errorMessage:
      ISOLATED_INSPECTION_SERVICE_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
    receiptId,
    documentId: deriveQuarantineCatalogDocumentIdFromReceipt(receiptId),
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    dispatched: false as const,
    scanPerformed: false as const,
    sanitized: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

export class LibraryQuarantineIsolatedInspectionRequestService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly inspectionRequestStore: LibraryQuarantineIsolatedInspectionRequestStore;
  private readonly clock: () => string;

  constructor(options: LibraryQuarantineIsolatedInspectionRequestServiceOptions) {
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
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineIsolatedInspectionRequestService requires valid trustedPrincipalProvider and adminRepository.'
      );
    }

    const resolvedStore =
      options.inspectionRequestStore ??
      (options.db
        ? new FirestoreLibraryQuarantineIsolatedInspectionRequestStore(
            options.db
          )
        : null);

    if (
      !resolvedStore ||
      typeof resolvedStore.getIsolatedInspectionRequestSnapshot !==
        'function' ||
      typeof resolvedStore.recordIsolatedInspectionRequestTransactional !==
        'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineIsolatedInspectionRequestService requires either inspectionRequestStore or Firestore db.'
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

    this.inspectionRequestStore = resolvedStore;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private async resolveAndAuthorizeInspectionOwner(): Promise<
    | { readonly ok: true; readonly actorUid: string }
    | {
        readonly ok: false;
        readonly errorCode:
          | 'UNAUTHENTICATED_CALLER_HOLD'
          | 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD';
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
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
      };
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
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
        };
      }

      for (const key of Object.getOwnPropertyNames(rawPrincipal.token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(key)) {
          return {
            ok: false,
            errorCode: 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
          };
        }
      }

      if (hasAutomatedOrAiTokenClaim(rawPrincipal.token)) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
        };
      }
    }

    let adminUser: AdminUser | null;
    try {
      adminUser = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
      };
    }

    if (!adminUser || typeof adminUser !== 'object') {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
      };
    }

    const adminId =
      typeof adminUser.id === 'string' ? adminUser.id.trim() : '';
    const adminUid =
      typeof (adminUser as { readonly uid?: unknown }).uid === 'string'
        ? ((adminUser as { readonly uid: string }).uid).trim()
        : '';

    if (adminId !== uid && adminUid !== uid) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
      };
    }

    if (!isAuthorizedHumanIsolatedInspectionOwner(adminUser)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_ISOLATED_INSPECTION_OWNER_HOLD',
      };
    }

    return { ok: true, actorUid: uid };
  }

  /**
   * Reads the current isolated inspection request status for the active
   * `receiptId + sourceRevision + safetyCaseRevision` tuple (8 point reads, 0 writes).
   */
  public async getQuarantineIsolatedInspectionRequest(
    rawInput: unknown
  ): Promise<GetLibraryQuarantineIsolatedInspectionRequestResponseDto> {
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

    const authResult = await this.resolveAndAuthorizeInspectionOwner();
    if (!authResult.ok) {
      return makeGetHoldDto(authResult.errorCode, receiptId);
    }

    let snapshotRes: Awaited<
      ReturnType<
        LibraryQuarantineIsolatedInspectionRequestStore['getIsolatedInspectionRequestSnapshot']
      >
    >;
    try {
      snapshotRes =
        await this.inspectionRequestStore.getIsolatedInspectionRequestSnapshot(
          receiptId
        );
    } catch {
      return makeGetHoldDto('STORE_READ_FAILED', receiptId);
    }

    if (!snapshotRes.ok) {
      return makeGetHoldDto(snapshotRes.errorCode, receiptId);
    }

    const { eligibleChain, status, inspectionRequest } = snapshotRes;
    const { chainSnapshot } = eligibleChain;

    let sanitizedRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto | null =
      null;
    if (inspectionRequest !== null) {
      try {
        sanitizedRequest =
          toSanitizedLibraryQuarantineIsolatedInspectionRequestDto(
            inspectionRequest
          );
      } catch {
        return makeGetHoldDto(
          'CORRUPTED_EXISTING_INSPECTION_REQUEST',
          receiptId
        );
      }
    }

    return Object.freeze({
      ok: true as const,
      status,
      outcome: status,
      receiptId,
      documentId: chainSnapshot.documentId,
      requestId: eligibleChain.requestId,
      sourceRevision: chainSnapshot.receiptEnvelope.revision,
      sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
      sourceFormat: chainSnapshot.sourceFormat,
      deepInspectionStatus: chainSnapshot.deepInspectionStatus,
      safetyCaseRevision: eligibleChain.safetyCaseRevision,
      effectiveHumanCaseRevision: chainSnapshot.effectiveHumanCaseRevision,
      catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
      readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
      inspectionRequest: sanitizedRequest,
      dispatched: false as const,
      scanPerformed: false as const,
      sanitized: false as const,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  /**
   * Atomically records an immutable isolated inspection request for the active
   * `receiptId + sourceRevision + safetyCaseRevision` tuple inside a single
   * 8-read, 1-create transaction (without dispatching any worker or accessing GCS).
   */
  public async recordQuarantineIsolatedInspectionRequest(
    rawInput: unknown
  ): Promise<RecordLibraryQuarantineIsolatedInspectionRequestResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makeRecordHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_RECORD_INPUT_KEYS)) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeRecordHoldDto('UNTRUSTED_CALLER_FIELD_HOLD', candidateId);
    }

    if (
      !Object.prototype.hasOwnProperty.call(rawInput, 'receiptId') ||
      !Object.prototype.hasOwnProperty.call(
        rawInput,
        'expectedSafetyCaseRevision'
      ) ||
      !Object.prototype.hasOwnProperty.call(
        rawInput,
        'acknowledgedHumanCaseRevision'
      ) ||
      !Object.prototype.hasOwnProperty.call(rawInput, 'confirmation')
    ) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeRecordHoldDto('INVALID_SERVICE_INPUT_HOLD', candidateId);
    }

    const receiptId = rawInput.receiptId;
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeRecordHoldDto('INVALID_RECEIPT_ID', null);
    }

    const expectedSafetyCaseRevision = rawInput.expectedSafetyCaseRevision;
    if (
      typeof expectedSafetyCaseRevision !== 'number' ||
      !Number.isSafeInteger(expectedSafetyCaseRevision) ||
      expectedSafetyCaseRevision < 1
    ) {
      return makeRecordHoldDto(
        'INVALID_EXPECTED_SAFETY_CASE_REVISION',
        receiptId
      );
    }

    const acknowledgedHumanCaseRevision =
      rawInput.acknowledgedHumanCaseRevision;
    if (
      typeof acknowledgedHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(acknowledgedHumanCaseRevision) ||
      acknowledgedHumanCaseRevision < 1
    ) {
      return makeRecordHoldDto(
        'UNACKNOWLEDGED_HUMAN_CASE_REVISION_HOLD',
        receiptId
      );
    }

    const confirmation = rawInput.confirmation;
    if (!isValidRecordIsolatedInspectionConfirmation(confirmation)) {
      return makeRecordHoldDto(
        'CONFIRMATION_LITERAL_REQUIRED_HOLD',
        receiptId
      );
    }

    const authResult = await this.resolveAndAuthorizeInspectionOwner();
    if (!authResult.ok) {
      return makeRecordHoldDto(authResult.errorCode, receiptId);
    }

    let nowIso: string;
    try {
      nowIso = this.clock();
    } catch {
      return makeRecordHoldDto('INVALID_TIMESTAMP', receiptId);
    }

    if (!isValidIsoUtcTimestamp(nowIso)) {
      return makeRecordHoldDto('INVALID_TIMESTAMP', receiptId);
    }

    let storeResult: Awaited<
      ReturnType<
        LibraryQuarantineIsolatedInspectionRequestStore['recordIsolatedInspectionRequestTransactional']
      >
    >;
    try {
      storeResult =
        await this.inspectionRequestStore.recordIsolatedInspectionRequestTransactional(
          {
            receiptId,
            expectedSafetyCaseRevision,
            acknowledgedHumanCaseRevision,
            confirmation:
              LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
            actorUid: authResult.actorUid,
            nowIso,
          }
        );
    } catch {
      return makeRecordUnknownDto(receiptId);
    }

    if (
      storeResult.status === 'RECORDED' ||
      storeResult.status === 'ALREADY_RECORDED'
    ) {
      let sanitizedRequest: SanitizedLibraryQuarantineIsolatedInspectionRequestDto;
      try {
        sanitizedRequest =
          toSanitizedLibraryQuarantineIsolatedInspectionRequestDto(
            storeResult.inspectionRequest
          );
      } catch {
        return makeRecordUnknownDto(receiptId);
      }

      const { chainSnapshot } = storeResult.eligibleChain;

      return Object.freeze({
        ok: true as const,
        status: storeResult.status,
        outcome: storeResult.status,
        requestOutcome: storeResult.requestOutcome,
        requestRecorded: true as const,
        receiptId,
        documentId: storeResult.documentId,
        requestId: storeResult.requestId,
        sourceRevision: chainSnapshot.receiptEnvelope.revision,
        sourceUpdatedAt: chainSnapshot.receiptEnvelope.receipt.updatedAt,
        sourceFormat: chainSnapshot.sourceFormat,
        deepInspectionStatus: chainSnapshot.deepInspectionStatus,
        safetyCaseRevision: storeResult.eligibleChain.safetyCaseRevision,
        effectiveHumanCaseRevision: chainSnapshot.effectiveHumanCaseRevision,
        catalogUpdatedAt: chainSnapshot.catalogUpdatedAt,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        inspectionRequest: sanitizedRequest,
        dispatched: false as const,
        scanPerformed: false as const,
        sanitized: false as const,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (storeResult.status === 'CONFLICT') {
      return Object.freeze({
        ok: false as const,
        status: 'CONFLICT' as const,
        outcome: 'CONFLICT' as const,
        requestOutcome: 'NOT_RECORDED' as const,
        requestRecorded: false as const,
        errorCode: 'SAFETY_CASE_REVISION_CONFLICT' as const,
        errorMessage: storeResult.errorMessage,
        receiptId,
        documentId: storeResult.documentId,
        currentSafetyCaseRevision: storeResult.currentSafetyCaseRevision,
        currentEffectiveHumanCaseRevision:
          storeResult.currentEffectiveHumanCaseRevision,
        readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
        dispatched: false as const,
        scanPerformed: false as const,
        sanitized: false as const,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (storeResult.status === 'UNKNOWN') {
      return makeRecordUnknownDto(receiptId);
    }

    return makeRecordHoldDto(storeResult.reasonCode, receiptId);
  }
}
