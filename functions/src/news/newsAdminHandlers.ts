import { onCall, HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { NewsApplicationService } from './newsApplicationService';
import { FirestoreNewsRepository } from './firestoreNewsRepository';
import {
  FirestoreEditorialImageAssetRepository,
  type EditorialImageFirestoreDatabase,
  type EditorialImageFirestoreTransaction,
} from './firestoreEditorialImageAssetRepository';
import {
  EditorialImageAssetRepositoryError,
  validatePersistedEditorialImageAssetEnvelope,
  type EditorialImageAssetRepository,
  type EditorialImageAssetRepositoryRecord,
} from './editorialImageAssetRepository';
import {
  EditorialImageRightsReviewError,
  EditorialImageRightsReviewService,
  FirestoreEditorialImageRightsReviewRunner,
  type EditorialImageRightsDecisionInput,
  type EditorialImageRightsReviewErrorCode,
  type RegisterEditorialImageRightsEvidenceInput,
  type RevokeEditorialImageRightsEvidenceInput,
  type SubmitEditorialImageRightsReviewRequestInput,
} from './editorialImageRightsReviewService';
import { validateAssetId } from '../shared/editorialImageAssetContract';
import type {
  EditorialImageAssetMetadata,
  EditorialImageAssetOrigin,
  EditorialImageAssetStatus,
  EditorialImageAssetVariantFormat,
  EditorialImageRightsRecord,
} from '../types/editorialImageAsset';
import { PublicNewsRepository } from './publicNewsRepository';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
} from '../types/admin';
import type { AdminUser } from '../types/admin';
import type { CommunityRepository } from '../community/communityRepository';
import type { NewsItemBackend } from './newsRepository';
import { AIReviewTargetType } from '../shared/aiReviewContract';
import { AITaskStatus, type AIReviewTask } from '../types/aiTask';
import type { AdvisoryResultIntakeResult } from '../peia/advisoryResultIntakeContract';
import type { CanonicalNonAdvisoryOutcome } from '../peia/nonAdvisoryOutcomeIntakeContract';
import {
  FirestorePeiaTaskQueueService,
  PeiaTaskQueueError,
  derivePeiaTaskId,
  type AuthoritativeNewsSnapshotInput,
  type PeiaTaskEnqueueDisposition,
  type PeiaTaskQueueDocumentSnapshot,
  type PeiaTaskQueueFirestoreDatabase,
  type PeiaTaskQueueTransaction,
  type ReconciledPeiaTaskStatusResult,
} from '../peia/firestorePeiaTaskQueueService';

export const MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS = 20 as const;
export const GET_EDITORIAL_IMAGE_RIGHTS_CONCURRENCY = 5 as const;

export interface AdminRequestContext {
  auth?: {
    uid: string;
    token?: Record<string, unknown>;
  };
  data?: any;
}

export interface SanitizedEditorialImageAssetAdminMetadata {
  readonly assetId: string;
  readonly createdByUid: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly origin: EditorialImageAssetOrigin;
  readonly status: EditorialImageAssetStatus;
  readonly rights: EditorialImageRightsRecord;
  readonly originalFilename: string;
  readonly mimeType: EditorialImageAssetVariantFormat;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly aspectRatio: number;
  readonly altAr: string;
  readonly altEn?: string;
  readonly captionAr?: string;
  readonly captionEn?: string;
  readonly photographerCredit?: string;
  readonly licensingInfo?: string;
  readonly tags?: string[];
  readonly associatedArticleIds?: string[];
}

export interface SanitizedEditorialImageAssetAdminRecord {
  readonly assetId: string;
  readonly revision: number;
  readonly asset: SanitizedEditorialImageAssetAdminMetadata;
}

export interface SanitizedEditorialImageRightsAdminDto {
  readonly assetId: string;
  readonly found: boolean;
  readonly revision: number | null;
  readonly status: EditorialImageAssetStatus | 'NOT_FOUND';
  readonly createdByUid: string | null;
  readonly rights: EditorialImageRightsRecord | null;
  readonly altAr: string | null;
  readonly altEn?: string;
  readonly captionAr?: string;
  readonly captionEn?: string;
  readonly originalFilename: string | null;
  readonly mimeType: EditorialImageAssetVariantFormat | null;
  readonly originalWidth: number | null;
  readonly originalHeight: number | null;
  readonly aspectRatio: number | null;
  readonly asset: SanitizedEditorialImageAssetAdminMetadata | null;
}

export function createProductionEditorialImageFirestoreDatabase(): EditorialImageFirestoreDatabase {
  return {
    collection(collectionName: string) {
      const db = getFirestore() as unknown as EditorialImageFirestoreDatabase;
      return db.collection(collectionName);
    },
    runTransaction<T>(
      updateFunction: (
        transaction: EditorialImageFirestoreTransaction
      ) => Promise<T>
    ): Promise<T> {
      const db = getFirestore() as unknown as EditorialImageFirestoreDatabase;
      return db.runTransaction(updateFunction);
    },
  };
}

export function createProductionEditorialImageAssetRepository(): EditorialImageAssetRepository {
  return new FirestoreEditorialImageAssetRepository(
    createProductionEditorialImageFirestoreDatabase()
  );
}

export function createProductionNewsApplicationService(): NewsApplicationService {
  return new NewsApplicationService(
    new FirestoreNewsRepository(),
    createProductionEditorialImageAssetRepository()
  );
}

export function createProductionEditorialImageRightsReviewService(
  adminRepo: AdminRepository = new FirestoreAdminRepository()
): EditorialImageRightsReviewService {
  const db = createProductionEditorialImageFirestoreDatabase();
  const transactionRunner = new FirestoreEditorialImageRightsReviewRunner(db);
  return new EditorialImageRightsReviewService({
    adminRepository: adminRepo,
    transactionRunner,
  });
}

async function authenticateAndAuthorize(
  requestContext: AdminRequestContext,
  requiredPermission: AdminPermission,
  adminRepo: AdminRepository
): Promise<AdminUser> {
  if (!requestContext.auth || !requestContext.auth.uid || requestContext.auth.uid.trim() === '') {
    throw new HttpsError('unauthenticated', 'UNAUTHENTICATED: Request missing valid Firebase Authentication token');
  }

  const uid = requestContext.auth.uid.trim();
  let admin: AdminUser | null = null;
  try {
    admin = await adminRepo.getAdminByUid(uid);
  } catch (_err) {
    throw new HttpsError('internal', 'ADMIN_LOOKUP_FAILED: Failed to verify admin identity');
  }

  if (!admin) {
    throw new HttpsError('permission-denied', 'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser');
  }

  if (!admin.isActive) {
    throw new HttpsError('permission-denied', 'ADMIN_INACTIVE: AdminUser account is inactive');
  }

  const isAuthorized = AdminAuthorizationService.hasPermission(admin, requiredPermission);
  if (!isAuthorized) {
    throw new HttpsError('permission-denied', `PERMISSION_DENIED: AdminUser lacks required ${requiredPermission} permission`);
  }

  return admin;
}

function hasAutomatedOrAiTokenClaim(token: Record<string, unknown> | undefined): boolean {
  if (!token || typeof token !== 'object') {
    return false;
  }
  return (
    token.role === AdminRole.AIAssistant ||
    token.isAIAssistant === true ||
    token.aiAssistant === true ||
    token.ai === true ||
    token.automated === true
  );
}

async function authenticateHumanAdminForRightsAction(
  requestContext: AdminRequestContext,
  requiredPermission: AdminPermission,
  adminRepo: AdminRepository
): Promise<AdminUser> {
  if (
    !requestContext ||
    !requestContext.auth ||
    typeof requestContext.auth.uid !== 'string' ||
    requestContext.auth.uid.trim() === '' ||
    requestContext.auth.uid !== requestContext.auth.uid.trim()
  ) {
    throw new HttpsError(
      'unauthenticated',
      'UNAUTHENTICATED: Request missing valid Firebase Authentication token'
    );
  }

  if (hasAutomatedOrAiTokenClaim(requestContext.auth.token)) {
    throw new HttpsError(
      'permission-denied',
      'AI_APPROVAL_FORBIDDEN: Automated AI accounts are forbidden from performing editorial image rights operations'
    );
  }

  const uid = requestContext.auth.uid.trim();
  let admin: AdminUser | null = null;
  try {
    admin = await adminRepo.getAdminByUid(uid);
  } catch (_err) {
    throw new HttpsError(
      'internal',
      'ADMIN_LOOKUP_FAILED: Failed to verify admin identity'
    );
  }

  if (!admin) {
    throw new HttpsError(
      'permission-denied',
      'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser'
    );
  }

  if (!admin.isActive) {
    throw new HttpsError(
      'permission-denied',
      'ADMIN_INACTIVE: AdminUser account is inactive'
    );
  }

  if (admin.role === AdminRole.AIAssistant) {
    throw new HttpsError(
      'permission-denied',
      'AI_APPROVAL_FORBIDDEN: Automated AI accounts are forbidden from performing editorial image rights operations'
    );
  }

  const isAuthorized = AdminAuthorizationService.hasPermission(
    admin,
    requiredPermission
  );
  if (!isAuthorized) {
    throw new HttpsError(
      'permission-denied',
      `PERMISSION_DENIED: AdminUser lacks required ${requiredPermission} permission`
    );
  }

  return admin;
}

function sanitizeRightsRecordForAdmin(
  rights: EditorialImageRightsRecord
): EditorialImageRightsRecord {
  return {
    status: rights.status,
    ...(rights.licenseType !== undefined ? { licenseType: rights.licenseType } : {}),
    ...(rights.licenseDetails !== undefined
      ? { licenseDetails: rights.licenseDetails }
      : {}),
    ...(rights.rightsHolder !== undefined ? { rightsHolder: rights.rightsHolder } : {}),
    ...(rights.documentedException !== undefined
      ? { documentedException: rights.documentedException }
      : {}),
    ...(rights.sourceAttributionAr !== undefined
      ? { sourceAttributionAr: rights.sourceAttributionAr }
      : {}),
    ...(rights.sourceAttributionEn !== undefined
      ? { sourceAttributionEn: rights.sourceAttributionEn }
      : {}),
    ...(rights.evidenceRefs !== undefined
      ? { evidenceRefs: [...rights.evidenceRefs] }
      : {}),
    ...(rights.usageScope !== undefined
      ? {
          usageScope: {
            scopeType: rights.usageScope.scopeType,
            ...(rights.usageScope.articleIds !== undefined
              ? { articleIds: [...rights.usageScope.articleIds] }
              : {}),
          },
        }
      : {}),
    ...(rights.reviewedByUid !== undefined
      ? { reviewedByUid: rights.reviewedByUid }
      : {}),
    ...(rights.reviewedAtIso !== undefined
      ? { reviewedAtIso: rights.reviewedAtIso }
      : {}),
    ...(rights.reviewReason !== undefined ? { reviewReason: rights.reviewReason } : {}),
  };
}

export function sanitizeEditorialImageAssetMetadataForAdmin(
  asset: EditorialImageAssetMetadata
): SanitizedEditorialImageAssetAdminMetadata {
  return {
    assetId: asset.assetId,
    createdByUid: asset.createdByUid,
    createdAtIso: asset.createdAtIso,
    updatedAtIso: asset.updatedAtIso,
    origin: asset.origin,
    status: asset.status,
    rights: sanitizeRightsRecordForAdmin(asset.rights),
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    originalWidth: asset.originalWidth,
    originalHeight: asset.originalHeight,
    aspectRatio: asset.aspectRatio,
    altAr: asset.altAr,
    ...(asset.altEn !== undefined ? { altEn: asset.altEn } : {}),
    ...(asset.captionAr !== undefined ? { captionAr: asset.captionAr } : {}),
    ...(asset.captionEn !== undefined ? { captionEn: asset.captionEn } : {}),
    ...(asset.photographerCredit !== undefined
      ? { photographerCredit: asset.photographerCredit }
      : {}),
    ...(asset.licensingInfo !== undefined
      ? { licensingInfo: asset.licensingInfo }
      : {}),
    ...(asset.tags !== undefined ? { tags: [...asset.tags] } : {}),
    ...(asset.associatedArticleIds !== undefined
      ? { associatedArticleIds: [...asset.associatedArticleIds] }
      : {}),
  };
}

export function sanitizeEditorialImageAssetRecordForAdminResponse(
  record: EditorialImageAssetRepositoryRecord
): SanitizedEditorialImageAssetAdminRecord {
  return {
    assetId: record.assetId,
    revision: record.revision,
    asset: sanitizeEditorialImageAssetMetadataForAdmin(record.asset),
  };
}

function buildSanitizedFoundRightsAdminDto(
  record: EditorialImageAssetRepositoryRecord
): SanitizedEditorialImageRightsAdminDto {
  const sanitizedAsset = sanitizeEditorialImageAssetMetadataForAdmin(record.asset);
  return {
    assetId: record.assetId,
    found: true,
    revision: record.revision,
    status: sanitizedAsset.status,
    createdByUid: sanitizedAsset.createdByUid,
    rights: sanitizedAsset.rights,
    altAr: sanitizedAsset.altAr,
    ...(sanitizedAsset.altEn !== undefined ? { altEn: sanitizedAsset.altEn } : {}),
    ...(sanitizedAsset.captionAr !== undefined
      ? { captionAr: sanitizedAsset.captionAr }
      : {}),
    ...(sanitizedAsset.captionEn !== undefined
      ? { captionEn: sanitizedAsset.captionEn }
      : {}),
    originalFilename: sanitizedAsset.originalFilename,
    mimeType: sanitizedAsset.mimeType,
    originalWidth: sanitizedAsset.originalWidth,
    originalHeight: sanitizedAsset.originalHeight,
    aspectRatio: sanitizedAsset.aspectRatio,
    asset: sanitizedAsset,
  };
}

function buildSanitizedMissingRightsAdminDto(
  assetId: string
): SanitizedEditorialImageRightsAdminDto {
  return {
    assetId,
    found: false,
    revision: null,
    status: 'NOT_FOUND',
    createdByUid: null,
    rights: null,
    altAr: null,
    originalFilename: null,
    mimeType: null,
    originalWidth: null,
    originalHeight: null,
    aspectRatio: null,
    asset: null,
  };
}

function validateGetEditorialImageRightsAssetIds(rawAssetIds: unknown): string[] {
  if (!Array.isArray(rawAssetIds)) {
    throw new HttpsError(
      'invalid-argument',
      'INVALID_ARGUMENT: assetIds must be an array of 1 to 20 unique canonical asset IDs.'
    );
  }

  if (
    rawAssetIds.length < 1 ||
    rawAssetIds.length > MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS
  ) {
    throw new HttpsError(
      'invalid-argument',
      `INVALID_ARGUMENT: assetIds must contain between 1 and ${MAX_GET_EDITORIAL_IMAGE_RIGHTS_ASSET_IDS} asset IDs.`
    );
  }

  const seen = new Set<string>();
  const validated: string[] = [];

  for (let i = 0; i < rawAssetIds.length; i++) {
    const candidate = rawAssetIds[i];
    const check = validateAssetId(candidate);
    if (!check.valid || typeof candidate !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        `INVALID_ARGUMENT: assetIds[${i}] is not a valid canonical asset ID.`
      );
    }
    if (seen.has(candidate)) {
      throw new HttpsError(
        'invalid-argument',
        `INVALID_ARGUMENT: assetIds contains duplicate asset ID "${candidate}".`
      );
    }
    seen.add(candidate);
    validated.push(candidate);
  }

  return validated;
}

async function readSanitizedEditorialImageRightsBatch(
  assetIds: readonly string[],
  assetRepo: EditorialImageAssetRepository
): Promise<{
  readonly items: SanitizedEditorialImageRightsAdminDto[];
  readonly assetsById: Record<string, SanitizedEditorialImageRightsAdminDto>;
}> {
  const items: SanitizedEditorialImageRightsAdminDto[] = new Array(assetIds.length);
  const workerCount = Math.min(
    GET_EDITORIAL_IMAGE_RIGHTS_CONCURRENCY,
    assetIds.length
  );
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < assetIds.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const assetId = assetIds[currentIndex];
      const readResult = await assetRepo.getById(assetId);

      if (!readResult || typeof readResult !== 'object') {
        throw new EditorialImageAssetRepositoryError(
          'PERSISTENCE_FAILURE',
          'Invalid repository read response.'
        );
      }

      if (!readResult.ok) {
        items[currentIndex] = buildSanitizedMissingRightsAdminDto(assetId);
        continue;
      }

      const rawResultObj = readResult as unknown as Record<string, unknown>;
      const rawEnvelope =
        rawResultObj.record ??
        ({
          assetId,
          revision: rawResultObj.revision,
          asset: rawResultObj.asset,
        } as unknown);

      const validatedRecord = validatePersistedEditorialImageAssetEnvelope(
        assetId,
        rawEnvelope
      );
      items[currentIndex] = buildSanitizedFoundRightsAdminDto(validatedRecord);
    }
  });

  await Promise.all(workers);

  const assetsById: Record<string, SanitizedEditorialImageRightsAdminDto> = {};
  for (const dto of items) {
    assetsById[dto.assetId] = dto;
  }

  return { items, assetsById };
}

function extractRightsActionPayload<T>(
  data: Record<string, unknown>,
  primaryKey: 'input' | 'decision'
): T {
  if (Object.prototype.hasOwnProperty.call(data, primaryKey)) {
    return data[primaryKey] as T;
  }
  if (
    primaryKey === 'decision' &&
    Object.prototype.hasOwnProperty.call(data, 'input')
  ) {
    return data.input as T;
  }

  const rest: Record<string, unknown> = {};
  let hasOtherKeys = false;
  for (const [key, val] of Object.entries(data)) {
    if (key !== 'action') {
      rest[key] = val;
      hasOtherKeys = true;
    }
  }
  return (hasOtherKeys ? rest : undefined) as unknown as T;
}

function redactSensitiveStoragePathsFromMessage(message: string): string {
  return message
    .replace(/editorial_images\/private[^\s"']*/gi, '[REDACTED_STORAGE_PATH]')
    .replace(/editorial_images\/[^\s"']*/gi, '[REDACTED_STORAGE_PATH]')
    .replace(/gs:\/\/[^\s"']*/gi, '[REDACTED_BUCKET_URI]');
}

const RIGHTS_ERROR_CODE_TO_HTTPS_CODE: Readonly<
  Record<EditorialImageRightsReviewErrorCode, FunctionsErrorCode>
> = {
  UNAUTHENTICATED: 'unauthenticated',
  PERMISSION_DENIED: 'permission-denied',
  SELF_APPROVAL_FORBIDDEN: 'permission-denied',
  NOT_FOUND: 'not-found',
  ALREADY_EXISTS: 'already-exists',
  CONFLICT: 'aborted',
  REVIEW_REQUEST_CONSUMED: 'aborted',
  INVALID_INPUT: 'invalid-argument',
  INVALID_TRANSITION: 'failed-precondition',
  INVALID_ASSET: 'failed-precondition',
  INVALID_EVIDENCE: 'failed-precondition',
  INVALID_REVIEW_REQUEST: 'failed-precondition',
  REVIEW_REQUEST_REQUIRED: 'failed-precondition',
  CLOCK_ROLLBACK: 'failed-precondition',
  PERSISTENCE_FAILURE: 'internal',
};

function mapEditorialImageRightsErrorToHttpsError(err: unknown): HttpsError {
  if (err instanceof HttpsError) {
    return err;
  }

  if (err instanceof EditorialImageRightsReviewError) {
    const httpsCode =
      RIGHTS_ERROR_CODE_TO_HTTPS_CODE[err.code] ?? 'internal';
    if (err.code === 'PERSISTENCE_FAILURE' || httpsCode === 'internal') {
      return new HttpsError(
        'internal',
        'PERSISTENCE_FAILURE: Editorial image rights persistence operation failed.'
      );
    }
    const safeMsg = redactSensitiveStoragePathsFromMessage(err.message);
    const prefix = safeMsg.startsWith(err.code) ? '' : `${err.code}: `;
    return new HttpsError(httpsCode, `${prefix}${safeMsg}`);
  }

  if (err instanceof EditorialImageAssetRepositoryError) {
    if (err.code === 'NOT_FOUND') {
      return new HttpsError(
        'not-found',
        `NOT_FOUND: ${redactSensitiveStoragePathsFromMessage(err.message)}`
      );
    }
    if (err.code === 'ALREADY_EXISTS') {
      return new HttpsError(
        'already-exists',
        `ALREADY_EXISTS: ${redactSensitiveStoragePathsFromMessage(err.message)}`
      );
    }
    if (err.code === 'CONFLICT') {
      return new HttpsError(
        'aborted',
        `CONFLICT: ${redactSensitiveStoragePathsFromMessage(err.message)}`
      );
    }
    if (err.code === 'INVALID_PATCH') {
      return new HttpsError(
        'invalid-argument',
        `INVALID_INPUT: ${redactSensitiveStoragePathsFromMessage(err.message)}`
      );
    }
    if (err.code === 'INVALID_ASSET') {
      return new HttpsError(
        'failed-precondition',
        `INVALID_ASSET: ${redactSensitiveStoragePathsFromMessage(err.message)}`
      );
    }
    return new HttpsError(
      'internal',
      'PERSISTENCE_FAILURE: Editorial image asset repository operation failed.'
    );
  }

  return new HttpsError(
    'internal',
    'PERSISTENCE_FAILURE: Editorial image rights operation failed.'
  );
}

const EDITORIAL_IMAGE_RIGHTS_ACTIONS: ReadonlySet<string> = new Set([
  'getEditorialImageRights',
  'registerImageRightsEvidence',
  'revokeImageRightsEvidence',
  'submitImageRightsReviewRequest',
  'transitionImageRights',
]);

const NEWS_PEIA_REVIEW_ACTIONS: ReadonlySet<string> = new Set([
  'requestPeiaReview',
  'getPeiaReviewStatus',
]);

const REQUEST_PEIA_REVIEW_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'action',
  'id',
  'expectedUpdatedAt',
]);

const GET_PEIA_REVIEW_STATUS_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'action',
  'id',
  'taskId',
]);

const SINGLE_LINE_CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

export interface SanitizedNewsPeiaReviewStatusDto {
  readonly status: 'NotRequested' | AITaskStatus;
  readonly taskId: string;
  readonly targetType: typeof AIReviewTargetType.News;
  readonly targetId: string;
  readonly currentSourceUpdatedAt: string;
  readonly taskSourceUpdatedAt: string | null;
  readonly isStale: boolean;
  readonly task: AIReviewTask | null;
  readonly advisoryResult: AdvisoryResultIntakeResult | null;
  readonly nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome | null;
}

export interface RequestNewsPeiaReviewResponseDto {
  readonly disposition: PeiaTaskEnqueueDisposition;
  readonly documentId: string;
  readonly taskId: string;
  readonly task: AIReviewTask;
  readonly status: 'NotRequested' | AITaskStatus;
  readonly isStale: boolean;
  readonly advisoryResult: AdvisoryResultIntakeResult | null;
  readonly nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome | null;
  readonly reviewStatus: SanitizedNewsPeiaReviewStatusDto;
}

export function createProductionPeiaTaskQueueDatabase(): PeiaTaskQueueFirestoreDatabase {
  return {
    collection(collectionName: string) {
      const db = getFirestore() as unknown as PeiaTaskQueueFirestoreDatabase;
      return db.collection(collectionName);
    },
    runTransaction<T>(
      updateFunction: (transaction: PeiaTaskQueueTransaction) => Promise<T>
    ): Promise<T> {
      const db = getFirestore() as unknown as PeiaTaskQueueFirestoreDatabase;
      return db.runTransaction(updateFunction);
    },
  };
}

async function authenticateHumanAdminForPeiaAction(
  requestContext: AdminRequestContext,
  requiredPermissions: readonly AdminPermission[],
  adminRepo: AdminRepository
): Promise<AdminUser> {
  if (
    !requestContext ||
    !requestContext.auth ||
    typeof requestContext.auth.uid !== 'string' ||
    requestContext.auth.uid.trim() === '' ||
    requestContext.auth.uid !== requestContext.auth.uid.trim()
  ) {
    throw new HttpsError(
      'unauthenticated',
      'UNAUTHENTICATED: Request missing valid Firebase Authentication token'
    );
  }

  if (hasAutomatedOrAiTokenClaim(requestContext.auth.token)) {
    throw new HttpsError(
      'permission-denied',
      'AI_ACTION_FORBIDDEN: Automated AI accounts are forbidden from performing News PEIA review actions'
    );
  }

  const uid = requestContext.auth.uid.trim();
  let admin: AdminUser | null = null;
  try {
    admin = await adminRepo.getAdminByUid(uid);
  } catch (_err) {
    throw new HttpsError(
      'internal',
      'ADMIN_LOOKUP_FAILED: Failed to verify admin identity'
    );
  }

  if (!admin) {
    throw new HttpsError(
      'permission-denied',
      'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser'
    );
  }

  if (!admin.isActive) {
    throw new HttpsError(
      'permission-denied',
      'ADMIN_INACTIVE: AdminUser account is inactive'
    );
  }

  if (admin.role === AdminRole.AIAssistant) {
    throw new HttpsError(
      'permission-denied',
      'AI_ACTION_FORBIDDEN: Automated AI accounts are forbidden from performing News PEIA review actions'
    );
  }

  if (!hasDomainResponsibility(admin.role, AdminDomain.News)) {
    throw new HttpsError(
      'permission-denied',
      'PERMISSION_DENIED: AdminUser lacks News domain responsibility'
    );
  }

  for (const requiredPermission of requiredPermissions) {
    if (!AdminAuthorizationService.hasPermission(admin, requiredPermission)) {
      throw new HttpsError(
        'permission-denied',
        `PERMISSION_DENIED: AdminUser lacks required ${requiredPermission} permission`
      );
    }
  }

  return admin;
}

function assertStrictAllowedCallerKeys(
  rawData: unknown,
  allowedKeys: ReadonlySet<string>,
  actionName: string
): Record<string, unknown> {
  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
    throw new HttpsError(
      'invalid-argument',
      `INVALID_ARGUMENT: Request payload for ${actionName} must be a plain object`
    );
  }
  const proto = Object.getPrototypeOf(rawData);
  if (proto !== Object.prototype && proto !== null) {
    throw new HttpsError(
      'invalid-argument',
      `INVALID_ARGUMENT: Request payload for ${actionName} must be a plain object`
    );
  }

  const record = rawData as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new HttpsError(
        'invalid-argument',
        `UNTRUSTED_OR_UNKNOWN_INPUT_FIELD: Field '${key}' is not allowed in ${actionName}`
      );
    }
  }
  return record;
}

function validateStrictSingleLineId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      `INVALID_ARGUMENT: ${fieldName} must be a non-empty trimmed string`
    );
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== value ||
    SINGLE_LINE_CONTROL_CHAR_REGEX.test(trimmed)
  ) {
    throw new HttpsError(
      'invalid-argument',
      `INVALID_ARGUMENT: ${fieldName} must be a non-empty trimmed single-line string`
    );
  }
  return trimmed;
}

function validateStrictIsoTimestamp(value: unknown, fieldName: string): string {
  const trimmed = validateStrictSingleLineId(value, fieldName);
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new HttpsError(
      'invalid-argument',
      `INVALID_ARGUMENT: ${fieldName} must be a valid ISO-8601 timestamp`
    );
  }
  return trimmed;
}

export function extractAuthoritativeNewsSnapshotInput(
  item: NewsItemBackend
): AuthoritativeNewsSnapshotInput {
  if (!item || typeof item !== 'object') {
    throw new HttpsError('not-found', 'NOT_FOUND: News item not found');
  }

  const title =
    typeof item.titleAr === 'string' && item.titleAr.trim().length > 0
      ? item.titleAr.trim()
      : typeof item.titleEn === 'string'
        ? item.titleEn.trim()
        : '';

  const body =
    typeof item.bodyAr === 'string' && item.bodyAr.trim().length > 0
      ? item.bodyAr
      : typeof item.bodyEn === 'string'
        ? item.bodyEn
        : '';

  const summary =
    typeof item.summaryAr === 'string' && item.summaryAr.trim().length > 0
      ? item.summaryAr
      : typeof item.summaryEn === 'string' && item.summaryEn.trim().length > 0
        ? item.summaryEn
        : undefined;

  return Object.freeze({
    targetId: item.id,
    sourceUpdatedAt: item.updatedAt,
    title,
    body,
    ...(summary !== undefined ? { summary } : {}),
  });
}

function isAuthoritativeNewsSnapshotInputEqual(
  a: AuthoritativeNewsSnapshotInput,
  b: AuthoritativeNewsSnapshotInput
): boolean {
  return (
    a.targetId === b.targetId &&
    a.sourceUpdatedAt === b.sourceUpdatedAt &&
    a.title === b.title &&
    a.body === b.body &&
    a.summary === b.summary
  );
}

function createSourceVersionGuardedPeiaDatabase(
  baseDb: PeiaTaskQueueFirestoreDatabase,
  newsService: NewsApplicationService,
  expectedNewsId: string,
  expectedUpdatedAt: string,
  expectedSnapshotInput: AuthoritativeNewsSnapshotInput
): PeiaTaskQueueFirestoreDatabase {
  return {
    collection(collectionName: string) {
      return baseDb.collection(collectionName);
    },
    runTransaction<T>(
      updateFunction: (transaction: PeiaTaskQueueTransaction) => Promise<T>
    ): Promise<T> {
      return baseDb.runTransaction(async (transaction) => {
        // 1. Place news/{id} in the Firestore transaction read set strictly before any write
        const newsDocRef = baseDb.collection('news').doc(expectedNewsId);
        const txNewsSnap: PeiaTaskQueueDocumentSnapshot =
          await transaction.get(newsDocRef);

        if (txNewsSnap && txNewsSnap.exists) {
          const txNewsData = txNewsSnap.data() as NewsItemBackend | undefined;
          if (!txNewsData || typeof txNewsData !== 'object') {
            throw new HttpsError(
              'not-found',
              `NOT_FOUND: News item ${expectedNewsId} not found during transactional verification`
            );
          }
          if (txNewsData.updatedAt !== expectedUpdatedAt) {
            throw new HttpsError(
              'failed-precondition',
              `STALE_SOURCE_VERSION: News item ${expectedNewsId} updatedAt changed concurrently (expected ${expectedUpdatedAt}, actual ${String(txNewsData.updatedAt)})`
            );
          }
          const txSnapshotInput = extractAuthoritativeNewsSnapshotInput({
            ...txNewsData,
            id: txNewsData.id || expectedNewsId,
          });
          if (
            !isAuthoritativeNewsSnapshotInputEqual(
              txSnapshotInput,
              expectedSnapshotInput
            )
          ) {
            throw new HttpsError(
              'failed-precondition',
              `STALE_SOURCE_VERSION: News item ${expectedNewsId} content changed concurrently prior to task enqueue`
            );
          }
        }

        // 2. Also re-verify authoritative News record via newsService before any write
        const latestServiceItem = await newsService.getById(expectedNewsId);
        if (!latestServiceItem) {
          throw new HttpsError(
            'not-found',
            `NOT_FOUND: News item ${expectedNewsId} not found`
          );
        }
        if (latestServiceItem.updatedAt !== expectedUpdatedAt) {
          throw new HttpsError(
            'failed-precondition',
            `STALE_SOURCE_VERSION: News item ${expectedNewsId} updatedAt changed concurrently (expected ${expectedUpdatedAt}, actual ${latestServiceItem.updatedAt})`
          );
        }
        const latestSnapshotInput =
          extractAuthoritativeNewsSnapshotInput(latestServiceItem);
        if (
          !isAuthoritativeNewsSnapshotInputEqual(
            latestSnapshotInput,
            expectedSnapshotInput
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            `STALE_SOURCE_VERSION: News item ${expectedNewsId} content changed concurrently prior to task enqueue`
          );
        }

        // 3. Proceed with canonical PeiaTaskQueueService transactional reads and task creation
        return updateFunction(transaction);
      });
    },
  };
}

function toSanitizedNewsPeiaReviewStatusDto(
  reconciled: ReconciledPeiaTaskStatusResult,
  currentSourceUpdatedAt: string
): SanitizedNewsPeiaReviewStatusDto {
  if (reconciled.status === 'NotRequested') {
    return Object.freeze({
      status: 'NotRequested' as const,
      taskId: reconciled.taskId,
      targetType: AIReviewTargetType.News,
      targetId: reconciled.targetId,
      currentSourceUpdatedAt,
      taskSourceUpdatedAt: null,
      isStale: false,
      task: null,
      advisoryResult: null,
      nonAdvisoryOutcome: null,
    });
  }

  return Object.freeze({
    status: reconciled.status,
    taskId: reconciled.taskId,
    targetType: AIReviewTargetType.News,
    targetId: reconciled.task.target.targetId,
    currentSourceUpdatedAt,
    taskSourceUpdatedAt: reconciled.task.target.sourceUpdatedAt,
    isStale: reconciled.isStale,
    task: reconciled.task,
    advisoryResult:
      reconciled.status === AITaskStatus.Completed
        ? reconciled.advisoryResult
        : null,
    nonAdvisoryOutcome:
      reconciled.status === AITaskStatus.Completed ||
      reconciled.status === AITaskStatus.Failed
        ? reconciled.nonAdvisoryOutcome
        : null,
  });
}

function mapPeiaTaskQueueErrorToHttpsError(err: unknown): HttpsError {
  if (err instanceof HttpsError) {
    return err;
  }

  if (err instanceof PeiaTaskQueueError) {
    const code = err.code;
    const message = `${code}: ${err.message}`;
    switch (code) {
      case 'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD':
      case 'INVALID_TARGET_IDENTITY':
      case 'INVALID_SNAPSHOT_INPUT':
      case 'SNAPSHOT_OVERSIZED':
        return new HttpsError('invalid-argument', message);
      case 'TASK_PAYLOAD_CONFLICT':
        return new HttpsError('already-exists', message);
      case 'RECONCILIATION_INTEGRITY_ERROR':
      case 'INVALID_EXISTING_TASK_RECORD':
      case 'TASK_QUERY_CARDINALITY_INVALID':
        return new HttpsError('failed-precondition', message);
      case 'TRANSACTION_REQUIRED':
      case 'INVALID_CLOCK_TIMESTAMP':
      default:
        return new HttpsError('internal', message);
    }
  }

  return new HttpsError(
    'internal',
    'PEIA_OPERATION_FAILED: News PEIA task queue operation failed.'
  );
}

export async function executeManageNewsRequest(
  requestContext: AdminRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  newsService: NewsApplicationService = createProductionNewsApplicationService(),
  rightsService?: EditorialImageRightsReviewService,
  assetRepo?: EditorialImageAssetRepository,
  communityRepo?: CommunityRepository,
  peiaQueueDatabase?: PeiaTaskQueueFirestoreDatabase,
  peiaQueueServiceOptions?: { readonly clock?: () => string }
): Promise<any> {
  const data =
    requestContext &&
    typeof requestContext.data === 'object' &&
    requestContext.data !== null
      ? requestContext.data
      : {};
  const action = data.action;

  if (!action || typeof action !== 'string') {
    throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Action parameter is required');
  }

  if (NEWS_PEIA_REVIEW_ACTIONS.has(action)) {
    try {
      const effectivePeiaDb =
        peiaQueueDatabase ?? createProductionPeiaTaskQueueDatabase();

      if (action === 'requestPeiaReview') {
        await authenticateHumanAdminForPeiaAction(
          requestContext,
          [AdminPermission.Edit, AdminPermission.Review],
          adminRepo
        );

        const validatedPayload = assertStrictAllowedCallerKeys(
          requestContext.data,
          REQUEST_PEIA_REVIEW_ALLOWED_KEYS,
          'requestPeiaReview'
        );
        const newsId = validateStrictSingleLineId(validatedPayload.id, 'id');
        const expectedUpdatedAt = validateStrictIsoTimestamp(
          validatedPayload.expectedUpdatedAt,
          'expectedUpdatedAt'
        );

        const item = await newsService.getById(newsId);
        if (!item) {
          throw new HttpsError(
            'not-found',
            `NOT_FOUND: News item ${newsId} not found`
          );
        }

        if (item.updatedAt !== expectedUpdatedAt) {
          throw new HttpsError(
            'failed-precondition',
            `STALE_SOURCE_VERSION: News item ${newsId} updatedAt (${item.updatedAt}) does not match expectedUpdatedAt (${expectedUpdatedAt})`
          );
        }

        const snapshotInput = extractAuthoritativeNewsSnapshotInput(item);
        const guardedDb = createSourceVersionGuardedPeiaDatabase(
          effectivePeiaDb,
          newsService,
          newsId,
          expectedUpdatedAt,
          snapshotInput
        );
        const guardedQueueService = new FirestorePeiaTaskQueueService(
          guardedDb,
          peiaQueueServiceOptions
        );

        const enqueueResult =
          await guardedQueueService.enqueueNewsTask(snapshotInput);

        const latestItemAfterEnqueue = await newsService.getById(newsId);
        const currentUpdatedAt = latestItemAfterEnqueue
          ? latestItemAfterEnqueue.updatedAt
          : item.updatedAt;

        const readQueueService = new FirestorePeiaTaskQueueService(
          effectivePeiaDb,
          peiaQueueServiceOptions
        );
        const reconciled = await readQueueService.reconcileTaskStatus({
          taskId: enqueueResult.task.taskId,
          targetType: AIReviewTargetType.News,
          targetId: newsId,
          currentSourceUpdatedAt: currentUpdatedAt,
        });

        const reviewStatus = toSanitizedNewsPeiaReviewStatusDto(
          reconciled,
          currentUpdatedAt
        );

        const response: RequestNewsPeiaReviewResponseDto = Object.freeze({
          disposition: enqueueResult.disposition,
          documentId: enqueueResult.documentId,
          taskId: enqueueResult.task.taskId,
          task: enqueueResult.task,
          status: reviewStatus.status,
          isStale: reviewStatus.isStale,
          advisoryResult: reviewStatus.advisoryResult,
          nonAdvisoryOutcome: reviewStatus.nonAdvisoryOutcome,
          reviewStatus,
        });

        return response;
      }

      if (action === 'getPeiaReviewStatus') {
        await authenticateHumanAdminForPeiaAction(
          requestContext,
          [AdminPermission.View, AdminPermission.Review],
          adminRepo
        );

        const validatedPayload = assertStrictAllowedCallerKeys(
          requestContext.data,
          GET_PEIA_REVIEW_STATUS_ALLOWED_KEYS,
          'getPeiaReviewStatus'
        );
        const newsId = validateStrictSingleLineId(validatedPayload.id, 'id');

        const hasExplicitTaskId =
          Object.prototype.hasOwnProperty.call(validatedPayload, 'taskId') &&
          validatedPayload.taskId !== undefined;
        const explicitTaskId = hasExplicitTaskId
          ? validateStrictSingleLineId(validatedPayload.taskId, 'taskId')
          : undefined;

        const item = await newsService.getById(newsId);
        if (!item) {
          throw new HttpsError(
            'not-found',
            `NOT_FOUND: News item ${newsId} not found`
          );
        }

        const currentVersionTaskId = derivePeiaTaskId({
          targetType: AIReviewTargetType.News,
          targetId: item.id,
          sourceUpdatedAt: item.updatedAt,
        });
        const resolvedTaskId = explicitTaskId ?? currentVersionTaskId;

        const readQueueService = new FirestorePeiaTaskQueueService(
          effectivePeiaDb,
          peiaQueueServiceOptions
        );
        const reconciled = await readQueueService.reconcileTaskStatus({
          taskId: resolvedTaskId,
          targetType: AIReviewTargetType.News,
          targetId: item.id,
          currentSourceUpdatedAt: item.updatedAt,
        });

        // Cross-item / foreign taskId isolation: an explicit taskId that differs from
        // the current version's deterministic taskId MUST correspond to a stored task
        // for this exact News item; if no such task exists, fail closed.
        if (
          explicitTaskId !== undefined &&
          explicitTaskId !== currentVersionTaskId &&
          reconciled.status === 'NotRequested'
        ) {
          throw new HttpsError(
            'failed-precondition',
            `CROSS_ITEM_OR_UNKNOWN_TASK_ID: Task '${explicitTaskId}' does not exist for News item '${item.id}'`
          );
        }

        const reviewStatus = toSanitizedNewsPeiaReviewStatusDto(
          reconciled,
          item.updatedAt
        );

        return Object.freeze({
          ...reviewStatus,
          reviewStatus,
        });
      }
    } catch (err: unknown) {
      throw mapPeiaTaskQueueErrorToHttpsError(err);
    }
  }

  if (EDITORIAL_IMAGE_RIGHTS_ACTIONS.has(action)) {
    try {
      if (action === 'getEditorialImageRights') {
        await authenticateHumanAdminForRightsAction(
          requestContext,
          AdminPermission.View,
          adminRepo
        );
        const validatedAssetIds = validateGetEditorialImageRightsAssetIds(
          data.assetIds
        );
        const effectiveAssetRepo =
          assetRepo ?? createProductionEditorialImageAssetRepository();
        return await readSanitizedEditorialImageRightsBatch(
          validatedAssetIds,
          effectiveAssetRepo
        );
      }

      await authenticateHumanAdminForRightsAction(
        requestContext,
        AdminPermission.ManageRights,
        adminRepo
      );

      const effectiveRightsService =
        rightsService ??
        createProductionEditorialImageRightsReviewService(adminRepo);

      if (action === 'registerImageRightsEvidence') {
        const input =
          extractRightsActionPayload<RegisterEditorialImageRightsEvidenceInput>(
            data,
            'input'
          );
        const evidence = await effectiveRightsService.registerRightsEvidence(
          requestContext,
          input
        );
        return { evidence };
      }

      if (action === 'revokeImageRightsEvidence') {
        const input =
          extractRightsActionPayload<RevokeEditorialImageRightsEvidenceInput>(
            data,
            'input'
          );
        const evidence = await effectiveRightsService.revokeRightsEvidence(
          requestContext,
          input
        );
        return { evidence };
      }

      if (action === 'submitImageRightsReviewRequest') {
        const input =
          extractRightsActionPayload<SubmitEditorialImageRightsReviewRequestInput>(
            data,
            'input'
          );
        const reviewRequest =
          await effectiveRightsService.submitRightsReviewRequest(
            requestContext,
            input
          );
        return { reviewRequest };
      }

      if (action === 'transitionImageRights') {
        const decision =
          extractRightsActionPayload<EditorialImageRightsDecisionInput>(
            data,
            'decision'
          );
        const result =
          await effectiveRightsService.transitionEditorialImageRights(
            requestContext,
            decision
          );
        return {
          record: sanitizeEditorialImageAssetRecordForAdminResponse(
            result.record
          ),
          auditEvent: result.auditEvent,
          ...(result.consumedReviewRequest !== undefined
            ? { consumedReviewRequest: result.consumedReviewRequest }
            : {}),
        };
      }
    } catch (err: unknown) {
      throw mapEditorialImageRightsErrorToHttpsError(err);
    }
  }

  try {
    if (action === 'listAll') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      const items = await newsService.listAll();
      return { items };
    }

    if (action === 'getById') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      if (!data.id || typeof data.id !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Item id is required');
      }
      const item = await newsService.getById(data.id.trim());
      return { item };
    }

    if (action === 'saveDraft') {
      const payload = data.item;
      if (!payload) {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: item payload is required');
      }

      const isUpdate = Boolean(payload.id);
      const requiredPermission = isUpdate ? AdminPermission.Edit : AdminPermission.Create;
      const admin = await authenticateAndAuthorize(requestContext, requiredPermission, adminRepo);

      const actor = {
        uid: admin.id,
        name: admin.name,
        role: admin.role,
      };

      if (payload.id) {
        const updated = await newsService.updateDraft(payload.id, payload, actor);
        return { item: updated };
      } else {
        const created = await newsService.createDraft(payload, actor);
        return { item: created };
      }
    }

    if (action === 'transitionWorkflow') {
      const { id, targetState, comment } = data;
      if (!id || !targetState) {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: id and targetState are required');
      }

      if (targetState === 'Draft') {
        if (!requestContext.auth || !requestContext.auth.uid || requestContext.auth.uid.trim() === '') {
          throw new HttpsError('unauthenticated', 'UNAUTHENTICATED: Request missing valid Firebase Authentication token');
        }

        const uid = requestContext.auth.uid.trim();
        let candidateAdmin: AdminUser | null = null;
        try {
          candidateAdmin = await adminRepo.getAdminByUid(uid);
        } catch (_err) {
          throw new HttpsError('internal', 'ADMIN_LOOKUP_FAILED: Failed to verify admin identity');
        }

        if (!candidateAdmin) {
          throw new HttpsError('permission-denied', 'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser');
        }

        if (!candidateAdmin.isActive) {
          throw new HttpsError('permission-denied', 'ADMIN_INACTIVE: AdminUser account is inactive');
        }

        const existingArticle = await newsService.getById(id);
        if (existingArticle && existingArticle.workflowState === 'Published') {
          if (
            candidateAdmin.role !== AdminRole.Owner ||
            !AdminAuthorizationService.hasPermission(candidateAdmin, AdminPermission.Publish)
          ) {
            throw new HttpsError(
              'permission-denied',
              'PERMISSION_DENIED: Only an active Owner may withdraw a published article to Draft'
            );
          }

          const actor = {
            uid: candidateAdmin.id,
            name: candidateAdmin.name,
            role: candidateAdmin.role,
          };

          const transitioned = await newsService.transitionWorkflow(id, targetState, actor, comment);
          return { item: transitioned };
        }
      }

      // Check required permission based on target state
      let requiredPermission: AdminPermission = AdminPermission.Edit;
      if (targetState === 'Approved') {
        requiredPermission = AdminPermission.Approve;
      } else if (targetState === 'Published') {
        requiredPermission = AdminPermission.Publish;
      }

      const admin = await authenticateAndAuthorize(requestContext, requiredPermission, adminRepo);
      const actor = {
        uid: admin.id,
        name: admin.name,
        role: admin.role,
      };

      const transitioned = await newsService.transitionWorkflow(id, targetState, actor, comment);
      return { item: transitioned };
    }

    if (action === 'createDraftFromCitizenSubmission') {
      const submissionId = data.submissionId || data.id;
      if (!submissionId || typeof submissionId !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: submissionId is required');
      }

      const admin = await authenticateAndAuthorize(requestContext, AdminPermission.Create, adminRepo);
      const actor = {
        uid: admin.id,
        name: admin.name,
        role: admin.role,
      };

      const result = await newsService.createDraftFromCitizenSubmission(submissionId.trim(), actor, communityRepo);
      return {
        item: result.item,
        alreadyExisted: result.alreadyExisted,
      };
    }

    throw new HttpsError('invalid-argument', `INVALID_ARGUMENT: Unrecognized action '${action}'`);
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    const msg = err?.message || 'Operation failed';
    if (msg.startsWith('NOT_FOUND')) {
      throw new HttpsError('not-found', msg);
    }
    if (msg.startsWith('FAILED_PRECONDITION')) {
      throw new HttpsError('failed-precondition', msg);
    }
    if (msg.startsWith('INVALID_ARGUMENT')) {
      throw new HttpsError('invalid-argument', msg);
    }
    throw new HttpsError('internal', msg);
  }
}

/**
 * Callable Firebase Cloud Function for Newsroom administration.
 */
export const manageNews = onCall({ cors: true }, async (request) => {
  return executeManageNewsRequest({
    auth: request.auth
      ? {
          uid: request.auth.uid,
          ...(request.auth.token
            ? { token: request.auth.token as Record<string, unknown> }
            : {}),
        }
      : undefined,
    data: request.data,
  });
});

/**
 * Public Callable Cloud Function to retrieve sanitized, published news.
 */
export const getPublicNews = onCall({ cors: true }, async (request) => {
  try {
    const language = request.data?.lang === 'en' ? 'en' : 'ar';
    const repo = new PublicNewsRepository();
    const articles = await repo.listPublicNews(language);
    return { articles };
  } catch (error: any) {
    throw new HttpsError('internal', error.message || 'Failed to retrieve public news');
  }
});

