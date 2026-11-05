import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { LibraryApplicationService } from './libraryApplicationService';
import { FirestoreLibraryRepository } from './firestoreLibraryRepository';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
  type AdminUser,
} from '../types/admin';
import { PublicLibraryRepository } from './publicLibraryRepository';
import {
  LibraryIntakeStatus,
  type LibraryIntakeRecord,
  type LibraryOrganization,
  type LibrarySource,
  type PublicLibraryDocument,
} from '../shared/libraryContract';
import {
  AIReviewTargetType,
  PEIALibraryPreparationInputBasis,
  type PEIALibraryPreparationAdvisoryPayload,
} from '../shared/aiReviewContract';
import { AITaskStatus, type AIReviewTask } from '../types/aiTask';
import type { AdvisoryResultIntakeResult } from '../peia/advisoryResultIntakeContract';
import type { CanonicalNonAdvisoryOutcome } from '../peia/nonAdvisoryOutcomeIntakeContract';
import {
  FirestorePeiaTaskQueueService,
  PeiaTaskQueueError,
  derivePeiaTaskId,
  type AuthoritativeLibraryIntakeSnapshotInput,
  type PeiaTaskEnqueueDisposition,
  type PeiaTaskQueueDocumentSnapshot,
  type PeiaTaskQueueFirestoreDatabase,
  type PeiaTaskQueueTransaction,
  type ReconciledPeiaTaskStatusResult,
} from '../peia/firestorePeiaTaskQueueService';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export interface LibraryAdminRequestContext {
  readonly auth?: {
    readonly uid: string;
    readonly token?: Record<string, unknown>;
  };
  readonly data?: Record<string, any>;
}

const LIBRARY_PEIA_PREPARATION_ACTIONS: ReadonlySet<string> = new Set([
  'requestIntakePeiaPreparation',
  'getIntakePeiaPreparationStatus',
]);

const REQUEST_INTAKE_PEIA_PREPARATION_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'action',
  'intakeId',
  'expectedUpdatedAt',
]);

const GET_INTAKE_PEIA_PREPARATION_STATUS_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'action',
  'intakeId',
  'taskId',
]);

const LIBRARY_EDITORIAL_CURATION_PERMISSIONS: readonly AdminPermission[] = Object.freeze([
  AdminPermission.Create,
  AdminPermission.Edit,
  AdminPermission.Review,
  AdminPermission.Approve,
  AdminPermission.ManageRights,
]);

const SINGLE_LINE_CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

export interface SanitizedLibraryIntakePeiaPreparationStatusDto {
  readonly status: 'NotRequested' | AITaskStatus;
  readonly taskId: string;
  readonly targetType: typeof AIReviewTargetType.LibraryIntake;
  readonly targetId: string;
  readonly intakeId: string;
  readonly currentSourceUpdatedAt: string;
  readonly taskSourceUpdatedAt: string | null;
  readonly isStale: boolean;
  readonly inputBasis: PEIALibraryPreparationInputBasis | null;
  readonly task: AIReviewTask | null;
  readonly advisoryResult: AdvisoryResultIntakeResult | null;
  readonly libraryPreparation: PEIALibraryPreparationAdvisoryPayload | null;
  readonly nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome | null;
}

export interface RequestLibraryIntakePeiaPreparationResponseDto {
  readonly disposition: PeiaTaskEnqueueDisposition;
  readonly documentId: string;
  readonly taskId: string;
  readonly intakeId: string;
  readonly inputBasis: PEIALibraryPreparationInputBasis;
  readonly task: AIReviewTask;
  readonly status: 'NotRequested' | AITaskStatus;
  readonly isStale: boolean;
  readonly advisoryResult: AdvisoryResultIntakeResult | null;
  readonly libraryPreparation: PEIALibraryPreparationAdvisoryPayload | null;
  readonly nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome | null;
  readonly preparationStatus: SanitizedLibraryIntakePeiaPreparationStatusDto;
  readonly reviewStatus: SanitizedLibraryIntakePeiaPreparationStatusDto;
}

export function createProductionLibraryPeiaTaskQueueDatabase(): PeiaTaskQueueFirestoreDatabase {
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

function hasAutomatedOrAiTokenClaim(
  token: Record<string, unknown> | undefined
): boolean {
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

async function authenticateHumanAdminForLibraryPeiaAction(
  requestContext: LibraryAdminRequestContext,
  requiredAnyPermissions: readonly AdminPermission[],
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
      'AI_ACTION_FORBIDDEN: Automated AI accounts are forbidden from performing Library Intake PEIA preparation actions'
    );
  }

  const uid = requestContext.auth.uid.trim();
  let adminUser: AdminUser | null = null;
  try {
    adminUser = await adminRepo.getAdminByUid(uid);
  } catch {
    throw new HttpsError(
      'internal',
      'ADMIN_LOOKUP_FAILED: Failed to verify admin identity'
    );
  }

  if (!adminUser) {
    throw new HttpsError(
      'permission-denied',
      'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser'
    );
  }

  if (!adminUser.isActive) {
    throw new HttpsError(
      'permission-denied',
      'ADMIN_INACTIVE: AdminUser account is inactive'
    );
  }

  if (adminUser.role === AdminRole.AIAssistant) {
    throw new HttpsError(
      'permission-denied',
      'AI_ACTION_FORBIDDEN: Automated AI accounts are forbidden from performing Library Intake PEIA preparation actions'
    );
  }

  const hasLibraryDomainAccess =
    hasDomainResponsibility(adminUser.role, AdminDomain.Library) ||
    adminUser.role === AdminRole.RightsReviewer;
  if (!hasLibraryDomainAccess) {
    throw new HttpsError(
      'permission-denied',
      'PERMISSION_DENIED: AdminUser lacks Library domain responsibility'
    );
  }

  const hasAnyRequiredPermission = requiredAnyPermissions.some((perm) =>
    AdminAuthorizationService.hasPermission(adminUser, perm)
  );
  if (!hasAnyRequiredPermission) {
    throw new HttpsError(
      'permission-denied',
      'PERMISSION_DENIED: AdminUser lacks required Library permission for this PEIA preparation action'
    );
  }

  return adminUser;
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
        `UNTRUSTED_OR_UNKNOWN_INPUT_FIELD: Field '${key}' is not permitted in ${actionName}`
      );
    }
  }

  return record;
}

function validateStrictSingleLineId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      `INVALID_ARGUMENT: ${fieldName} must be a non-empty string`
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
      `INVALID_ARGUMENT: ${fieldName} must be a trimmed single-line string without control characters`
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

function normalizeOptionalReferenceId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new HttpsError(
      'failed-precondition',
      'INVALID_INTAKE_RECORD: Stored reference ID on library_intake must be a string'
    );
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatAuthoritativeIssuingOrganization(
  org: LibraryOrganization | null
): string | undefined {
  if (!org) {
    return undefined;
  }
  const nameAr = typeof org.nameAr === 'string' ? org.nameAr.trim() : '';
  const nameEn = typeof org.nameEn === 'string' ? org.nameEn.trim() : '';
  if (nameAr.length > 0 && nameEn.length > 0 && nameAr !== nameEn) {
    const combined = `${nameAr} (${nameEn})`;
    return combined.length <= 300 ? combined : nameAr.slice(0, 300);
  }
  if (nameAr.length > 0) {
    return nameAr.slice(0, 300);
  }
  if (nameEn.length > 0) {
    return nameEn.slice(0, 300);
  }
  return undefined;
}

function formatAuthoritativeSourceNotes(
  source: LibrarySource | null
): string | undefined {
  if (!source) {
    return undefined;
  }
  const nameAr =
    typeof source.sourceNameAr === 'string' ? source.sourceNameAr.trim() : '';
  const nameEn =
    typeof source.sourceNameEn === 'string' ? source.sourceNameEn.trim() : '';
  const namePart =
    nameAr.length > 0 && nameEn.length > 0 && nameAr !== nameEn
      ? `${nameAr} (${nameEn})`
      : nameAr || nameEn;

  const segments: string[] = [];
  if (namePart.length > 0) {
    segments.push(namePart);
  }
  if (typeof source.sourceType === 'string' && source.sourceType.trim().length > 0) {
    segments.push(`type=${source.sourceType.trim()}`);
  }
  if (
    typeof source.verificationStatus === 'string' &&
    source.verificationStatus.trim().length > 0
  ) {
    segments.push(`verificationStatus=${source.verificationStatus.trim()}`);
  }
  if (typeof source.sourceUrl === 'string' && source.sourceUrl.trim().length > 0) {
    segments.push(`url=${source.sourceUrl.trim()}`);
  }

  if (segments.length === 0) {
    return undefined;
  }
  const joined = segments.join(' | ');
  return joined.length <= 1500 ? joined : joined.slice(0, 1500);
}

function extractAuthoritativeLibraryIntakeSnapshotInput(
  record: LibraryIntakeRecord,
  linkedOrg: LibraryOrganization | null,
  linkedSource: LibrarySource | null
): AuthoritativeLibraryIntakeSnapshotInput {
  if (!record || typeof record !== 'object') {
    throw new HttpsError(
      'not-found',
      'NOT_FOUND: Library intake record is missing'
    );
  }

  if (record.status === LibraryIntakeStatus.Rejected) {
    throw new HttpsError(
      'failed-precondition',
      `INTAKE_REJECTED: Cannot request PEIA preparation for Rejected intake record ${record.id}`
    );
  }

  if (
    record.status !== LibraryIntakeStatus.PendingReview &&
    record.status !== LibraryIntakeStatus.InPreparation
  ) {
    throw new HttpsError(
      'failed-precondition',
      `INVALID_INTAKE_STATUS: Library intake record ${record.id} has unsupported status '${String(record.status)}'`
    );
  }

  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (title.length === 0) {
    throw new HttpsError(
      'failed-precondition',
      `INVALID_INTAKE_RECORD: Library intake record ${record.id} is missing a valid title`
    );
  }

  let suppliedExcerpt: string | undefined;
  if (record.suppliedExcerpt !== undefined && record.suppliedExcerpt !== null) {
    if (typeof record.suppliedExcerpt !== 'string') {
      throw new HttpsError(
        'failed-precondition',
        `INVALID_INTAKE_RECORD: Library intake record ${record.id} has non-string suppliedExcerpt`
      );
    }
    const normalizedExcerpt = record.suppliedExcerpt.replace(/\r\n?/g, '\n').trim();
    if (normalizedExcerpt.length > 0) {
      suppliedExcerpt = normalizedExcerpt;
    }
  }

  const inputBasis =
    suppliedExcerpt !== undefined
      ? PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata
      : PEIALibraryPreparationInputBasis.MetadataOnly;

  let notes: string | undefined;
  if (typeof record.notes === 'string') {
    const normalizedNotes = record.notes.replace(/\r\n?/g, '\n').trim();
    if (normalizedNotes.length > 0) {
      notes = normalizedNotes;
    }
  }

  const language =
    typeof record.language === 'string' && record.language.trim().length > 0
      ? record.language.trim()
      : undefined;

  const issuingOrganization = formatAuthoritativeIssuingOrganization(linkedOrg);
  const sourceNotes = formatAuthoritativeSourceNotes(linkedSource);

  return Object.freeze({
    targetId: record.id,
    sourceUpdatedAt: record.updatedAt,
    inputBasis,
    title,
    ...(suppliedExcerpt !== undefined ? { suppliedExcerpt } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(issuingOrganization !== undefined ? { issuingOrganization } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(sourceNotes !== undefined ? { sourceNotes } : {}),
  });
}

function isAuthoritativeLibraryIntakeSnapshotInputEqual(
  a: AuthoritativeLibraryIntakeSnapshotInput,
  b: AuthoritativeLibraryIntakeSnapshotInput
): boolean {
  return (
    a.targetId === b.targetId &&
    a.sourceUpdatedAt === b.sourceUpdatedAt &&
    a.inputBasis === b.inputBasis &&
    a.title === b.title &&
    a.suppliedExcerpt === b.suppliedExcerpt &&
    a.notes === b.notes &&
    a.issuingOrganization === b.issuingOrganization &&
    a.language === b.language &&
    a.sourceNotes === b.sourceNotes
  );
}

function isLibraryOrganizationConsistent(
  a: LibraryOrganization,
  b: LibraryOrganization
): boolean {
  return (
    a.id === b.id &&
    a.nameAr === b.nameAr &&
    a.nameEn === b.nameEn &&
    a.type === b.type &&
    a.countryRegionAr === b.countryRegionAr &&
    a.countryRegionEn === b.countryRegionEn &&
    (a.websiteUrl ?? undefined) === (b.websiteUrl ?? undefined) &&
    (a.updatedAt ?? undefined) === (b.updatedAt ?? undefined)
  );
}

function isLibrarySourceConsistent(
  a: LibrarySource,
  b: LibrarySource
): boolean {
  return (
    a.id === b.id &&
    a.organizationId === b.organizationId &&
    a.sourceNameAr === b.sourceNameAr &&
    a.sourceNameEn === b.sourceNameEn &&
    (a.sourceUrl ?? undefined) === (b.sourceUrl ?? undefined) &&
    a.sourceType === b.sourceType &&
    a.verificationStatus === b.verificationStatus &&
    (a.updatedAt ?? undefined) === (b.updatedAt ?? undefined)
  );
}

interface GuardedLibraryIntakeSourceExpectations {
  readonly expectedIntakeId: string;
  readonly expectedUpdatedAt: string;
  readonly expectedStatus: LibraryIntakeStatus;
  readonly expectedOrganizationId: string | undefined;
  readonly expectedSourceId: string | undefined;
  readonly expectedOrganization: LibraryOrganization | null;
  readonly expectedSource: LibrarySource | null;
  readonly expectedSnapshotInput: AuthoritativeLibraryIntakeSnapshotInput;
}

/**
 * Wraps the PEIA Firestore database so that `runTransaction` places
 * `library_intake/{intakeId}` (and any referenced `library_organizations/{organizationId}`
 * and `library_sources/{sourceId}` documents) into the SAME Firestore transaction read set
 * strictly before `FirestorePeiaTaskQueueService` reads `peiaReviewTasks` or writes a task.
 *
 * All verification inside the transaction uses `transaction.get(...)` directly and never
 * substitutes an independent non-transactional `getIntakeById`, `getOrganizationById`,
 * or `getSourceById` call.
 */
function createSourceVersionGuardedLibraryPeiaDatabase(
  baseDb: PeiaTaskQueueFirestoreDatabase,
  expectations: GuardedLibraryIntakeSourceExpectations
): PeiaTaskQueueFirestoreDatabase {
  const {
    expectedIntakeId,
    expectedUpdatedAt,
    expectedStatus,
    expectedOrganizationId,
    expectedSourceId,
    expectedOrganization,
    expectedSource,
    expectedSnapshotInput,
  } = expectations;

  return {
    collection(collectionName: string) {
      return baseDb.collection(collectionName);
    },
    runTransaction<T>(
      updateFunction: (transaction: PeiaTaskQueueTransaction) => Promise<T>
    ): Promise<T> {
      return baseDb.runTransaction(async (transaction) => {
        // 1. Place library_intake/{intakeId} in the Firestore transaction read set before any write
        const intakeDocRef = baseDb
          .collection(FirestoreLibraryRepository.INTAKE_COLLECTION)
          .doc(expectedIntakeId);
        const txIntakeSnap: PeiaTaskQueueDocumentSnapshot =
          await transaction.get(intakeDocRef);

        if (!txIntakeSnap || !txIntakeSnap.exists) {
          throw new HttpsError(
            'not-found',
            `NOT_FOUND: Library intake record ${expectedIntakeId} not found during transactional verification`
          );
        }

        const rawIntakeData = txIntakeSnap.data() as LibraryIntakeRecord | undefined;
        if (!rawIntakeData || typeof rawIntakeData !== 'object') {
          throw new HttpsError(
            'not-found',
            `NOT_FOUND: Library intake record ${expectedIntakeId} data is empty during transactional verification`
          );
        }

        const txIntakeRecord: LibraryIntakeRecord = {
          ...rawIntakeData,
          id: rawIntakeData.id || expectedIntakeId,
        };

        if (txIntakeRecord.status === LibraryIntakeStatus.Rejected) {
          throw new HttpsError(
            'failed-precondition',
            `INTAKE_REJECTED: Cannot request PEIA preparation for Rejected intake record ${expectedIntakeId}`
          );
        }

        if (txIntakeRecord.updatedAt !== expectedUpdatedAt) {
          throw new HttpsError(
            'failed-precondition',
            `STALE_SOURCE_VERSION: Library intake record ${expectedIntakeId} updatedAt changed concurrently (expected ${expectedUpdatedAt}, actual ${String(txIntakeRecord.updatedAt)})`
          );
        }

        if (txIntakeRecord.status !== expectedStatus) {
          throw new HttpsError(
            'failed-precondition',
            `STALE_SOURCE_VERSION: Library intake record ${expectedIntakeId} status changed concurrently (expected ${expectedStatus}, actual ${String(txIntakeRecord.status)})`
          );
        }

        const txOrgId = normalizeOptionalReferenceId(txIntakeRecord.organizationId);
        const txSourceId = normalizeOptionalReferenceId(txIntakeRecord.sourceId);

        if (txOrgId !== expectedOrganizationId || txSourceId !== expectedSourceId) {
          throw new HttpsError(
            'failed-precondition',
            `STALE_SOURCE_VERSION: Library intake record ${expectedIntakeId} organization/source references changed concurrently`
          );
        }

        // 2. If organization metadata is referenced, place library_organizations/{orgId}
        // in the same Firestore transaction read set and verify all relevant fields.
        let txOrganization: LibraryOrganization | null = null;
        if (expectedOrganizationId !== undefined) {
          const orgDocRef = baseDb
            .collection(FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION)
            .doc(expectedOrganizationId);
          const txOrgSnap: PeiaTaskQueueDocumentSnapshot =
            await transaction.get(orgDocRef);

          if (!txOrgSnap || !txOrgSnap.exists) {
            throw new HttpsError(
              'failed-precondition',
              `BROKEN_ORGANIZATION_REFERENCE: Referenced organization ${expectedOrganizationId} does not exist`
            );
          }

          const rawOrgData = txOrgSnap.data() as LibraryOrganization | undefined;
          if (!rawOrgData || typeof rawOrgData !== 'object') {
            throw new HttpsError(
              'failed-precondition',
              `BROKEN_ORGANIZATION_REFERENCE: Referenced organization ${expectedOrganizationId} has invalid data`
            );
          }

          txOrganization = {
            ...rawOrgData,
            id: rawOrgData.id || expectedOrganizationId,
          };

          if (
            !expectedOrganization ||
            !isLibraryOrganizationConsistent(txOrganization, expectedOrganization)
          ) {
            throw new HttpsError(
              'failed-precondition',
              `STALE_METADATA_VERSION: Referenced organization ${expectedOrganizationId} was modified concurrently prior to task enqueue`
            );
          }
        }

        // 3. If source metadata is referenced, place library_sources/{sourceId}
        // in the same Firestore transaction read set and verify all relevant fields.
        let txSource: LibrarySource | null = null;
        if (expectedSourceId !== undefined) {
          const sourceDocRef = baseDb
            .collection(FirestoreLibraryRepository.SOURCES_COLLECTION)
            .doc(expectedSourceId);
          const txSourceSnap: PeiaTaskQueueDocumentSnapshot =
            await transaction.get(sourceDocRef);

          if (!txSourceSnap || !txSourceSnap.exists) {
            throw new HttpsError(
              'failed-precondition',
              `BROKEN_SOURCE_REFERENCE: Referenced source ${expectedSourceId} does not exist`
            );
          }

          const rawSourceData = txSourceSnap.data() as LibrarySource | undefined;
          if (!rawSourceData || typeof rawSourceData !== 'object') {
            throw new HttpsError(
              'failed-precondition',
              `BROKEN_SOURCE_REFERENCE: Referenced source ${expectedSourceId} has invalid data`
            );
          }

          txSource = {
            ...rawSourceData,
            id: rawSourceData.id || expectedSourceId,
          };

          if (
            !expectedSource ||
            !isLibrarySourceConsistent(txSource, expectedSource)
          ) {
            throw new HttpsError(
              'failed-precondition',
              `STALE_METADATA_VERSION: Referenced source ${expectedSourceId} was modified concurrently prior to task enqueue`
            );
          }
        }

        // 4. Recompute the snapshot input strictly from the transactionally read records
        // and verify exact equality with the snapshot input being enqueued.
        const txSnapshotInput = extractAuthoritativeLibraryIntakeSnapshotInput(
          txIntakeRecord,
          txOrganization,
          txSource
        );
        if (
          !isAuthoritativeLibraryIntakeSnapshotInputEqual(
            txSnapshotInput,
            expectedSnapshotInput
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            `STALE_SOURCE_VERSION: Library intake record ${expectedIntakeId} content or metadata changed concurrently prior to task enqueue`
          );
        }

        // 5. Proceed with canonical PeiaTaskQueueService transactional reads and task creation
        return updateFunction(transaction);
      });
    },
  };
}

function toSanitizedLibraryIntakePeiaPreparationStatusDto(
  reconciled: ReconciledPeiaTaskStatusResult,
  currentSourceUpdatedAt: string
): SanitizedLibraryIntakePeiaPreparationStatusDto {
  if (reconciled.status === 'NotRequested') {
    return Object.freeze({
      status: 'NotRequested' as const,
      taskId: reconciled.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: reconciled.targetId,
      intakeId: reconciled.targetId,
      currentSourceUpdatedAt,
      taskSourceUpdatedAt: null,
      isStale: false,
      inputBasis: null,
      task: null,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: null,
    });
  }

  const rawBasis = reconciled.task.contentSnapshot['inputBasis'];
  const inputBasis =
    rawBasis === PEIALibraryPreparationInputBasis.MetadataOnly ||
    rawBasis === PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata
      ? rawBasis
      : null;

  const advisoryResult =
    reconciled.status === AITaskStatus.Completed
      ? reconciled.advisoryResult
      : null;
  const libraryPreparation =
    reconciled.status === AITaskStatus.Completed &&
    reconciled.advisoryResult !== null
      ? reconciled.advisoryResult.libraryPreparation ?? null
      : null;
  const nonAdvisoryOutcome =
    reconciled.status === AITaskStatus.Completed ||
    reconciled.status === AITaskStatus.Failed
      ? reconciled.nonAdvisoryOutcome
      : null;

  return Object.freeze({
    status: reconciled.status,
    taskId: reconciled.taskId,
    targetType: AIReviewTargetType.LibraryIntake,
    targetId: reconciled.task.target.targetId,
    intakeId: reconciled.task.target.targetId,
    currentSourceUpdatedAt,
    taskSourceUpdatedAt: reconciled.task.target.sourceUpdatedAt,
    isStale: reconciled.isStale,
    inputBasis,
    task: reconciled.task,
    advisoryResult,
    libraryPreparation,
    nonAdvisoryOutcome,
  });
}

function mapLibraryPeiaTaskQueueErrorToHttpsError(err: unknown): HttpsError {
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
    'PEIA_OPERATION_FAILED: Library Intake PEIA task queue operation failed.'
  );
}

export async function executeManageLibraryDocumentsRequest(
  requestContext: LibraryAdminRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  service: LibraryApplicationService = new LibraryApplicationService(
    new FirestoreLibraryRepository()
  ),
  peiaQueueDatabase?: PeiaTaskQueueFirestoreDatabase,
  peiaQueueServiceOptions?: { readonly clock?: () => string },
  geminiOptions?: {
    readonly apiKey?: string;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  }
): Promise<any> {
  const data =
    requestContext &&
    typeof requestContext.data === 'object' &&
    requestContext.data !== null &&
    !Array.isArray(requestContext.data)
      ? requestContext.data
      : {};
  const action = data.action;

  if (typeof action === 'string' && LIBRARY_PEIA_PREPARATION_ACTIONS.has(action)) {
    try {
      const effectivePeiaDb =
        peiaQueueDatabase ?? createProductionLibraryPeiaTaskQueueDatabase();

      if (action === 'requestIntakePeiaPreparation') {
        await authenticateHumanAdminForLibraryPeiaAction(
          requestContext,
          LIBRARY_EDITORIAL_CURATION_PERMISSIONS,
          adminRepo
        );

        const validatedPayload = assertStrictAllowedCallerKeys(
          requestContext.data,
          REQUEST_INTAKE_PEIA_PREPARATION_ALLOWED_KEYS,
          'requestIntakePeiaPreparation'
        );
        const intakeId = validateStrictSingleLineId(
          validatedPayload.intakeId,
          'intakeId'
        );
        const expectedUpdatedAt = validateStrictIsoTimestamp(
          validatedPayload.expectedUpdatedAt,
          'expectedUpdatedAt'
        );

        const record = await service.getIntakeById(intakeId);
        if (!record) {
          throw new HttpsError(
            'not-found',
            `NOT_FOUND: Library intake record ${intakeId} not found`
          );
        }

        if (record.status === LibraryIntakeStatus.Rejected) {
          throw new HttpsError(
            'failed-precondition',
            `INTAKE_REJECTED: Cannot request PEIA preparation for Rejected intake record ${intakeId}`
          );
        }

        if (record.updatedAt !== expectedUpdatedAt) {
          throw new HttpsError(
            'failed-precondition',
            `STALE_SOURCE_VERSION: Library intake record ${intakeId} updatedAt (${record.updatedAt}) does not match expectedUpdatedAt (${expectedUpdatedAt})`
          );
        }

        const expectedOrganizationId = normalizeOptionalReferenceId(
          record.organizationId
        );
        const expectedSourceId = normalizeOptionalReferenceId(record.sourceId);

        let linkedOrg: LibraryOrganization | null = null;
        if (expectedOrganizationId !== undefined) {
          linkedOrg = await service.getOrganizationById(expectedOrganizationId);
          if (!linkedOrg) {
            throw new HttpsError(
              'failed-precondition',
              `BROKEN_ORGANIZATION_REFERENCE: Referenced organization ${expectedOrganizationId} does not exist`
            );
          }
        }

        let linkedSource: LibrarySource | null = null;
        if (expectedSourceId !== undefined) {
          linkedSource = await service.getSourceById(expectedSourceId);
          if (!linkedSource) {
            throw new HttpsError(
              'failed-precondition',
              `BROKEN_SOURCE_REFERENCE: Referenced source ${expectedSourceId} does not exist`
            );
          }
        }

        const snapshotInput = extractAuthoritativeLibraryIntakeSnapshotInput(
          record,
          linkedOrg,
          linkedSource
        );

        const guardedDb = createSourceVersionGuardedLibraryPeiaDatabase(
          effectivePeiaDb,
          {
            expectedIntakeId: intakeId,
            expectedUpdatedAt,
            expectedStatus: record.status,
            expectedOrganizationId,
            expectedSourceId,
            expectedOrganization: linkedOrg,
            expectedSource: linkedSource,
            expectedSnapshotInput: snapshotInput,
          }
        );

        const guardedQueueService = new FirestorePeiaTaskQueueService(
          guardedDb,
          peiaQueueServiceOptions
        );

        const enqueueResult =
          await guardedQueueService.enqueueLibraryIntakeTask(snapshotInput);

        const latestRecordAfterEnqueue = await service.getIntakeById(intakeId);
        const currentUpdatedAt = latestRecordAfterEnqueue
          ? latestRecordAfterEnqueue.updatedAt
          : record.updatedAt;

        const readQueueService = new FirestorePeiaTaskQueueService(
          effectivePeiaDb,
          peiaQueueServiceOptions
        );
        const reconciled = await readQueueService.reconcileTaskStatus({
          taskId: enqueueResult.task.taskId,
          targetType: AIReviewTargetType.LibraryIntake,
          targetId: intakeId,
          currentSourceUpdatedAt: currentUpdatedAt,
        });

        const preparationStatus =
          toSanitizedLibraryIntakePeiaPreparationStatusDto(
            reconciled,
            currentUpdatedAt
          );

        const response: RequestLibraryIntakePeiaPreparationResponseDto =
          Object.freeze({
            disposition: enqueueResult.disposition,
            documentId: enqueueResult.documentId,
            taskId: enqueueResult.task.taskId,
            intakeId,
            inputBasis: snapshotInput.inputBasis,
            task: enqueueResult.task,
            status: preparationStatus.status,
            isStale: preparationStatus.isStale,
            advisoryResult: preparationStatus.advisoryResult,
            libraryPreparation: preparationStatus.libraryPreparation,
            nonAdvisoryOutcome: preparationStatus.nonAdvisoryOutcome,
            preparationStatus,
            reviewStatus: preparationStatus,
          });

        return response;
      }

      if (action === 'getIntakePeiaPreparationStatus') {
        await authenticateHumanAdminForLibraryPeiaAction(
          requestContext,
          [AdminPermission.View],
          adminRepo
        );

        const validatedPayload = assertStrictAllowedCallerKeys(
          requestContext.data,
          GET_INTAKE_PEIA_PREPARATION_STATUS_ALLOWED_KEYS,
          'getIntakePeiaPreparationStatus'
        );
        const intakeId = validateStrictSingleLineId(
          validatedPayload.intakeId,
          'intakeId'
        );

        const hasExplicitTaskId =
          Object.prototype.hasOwnProperty.call(validatedPayload, 'taskId') &&
          validatedPayload.taskId !== undefined;
        const explicitTaskId = hasExplicitTaskId
          ? validateStrictSingleLineId(validatedPayload.taskId, 'taskId')
          : undefined;

        const record = await service.getIntakeById(intakeId);
        if (!record) {
          throw new HttpsError(
            'not-found',
            `NOT_FOUND: Library intake record ${intakeId} not found`
          );
        }

        const currentVersionTaskId = derivePeiaTaskId({
          targetType: AIReviewTargetType.LibraryIntake,
          targetId: record.id,
          sourceUpdatedAt: record.updatedAt,
        });
        const resolvedTaskId = explicitTaskId ?? currentVersionTaskId;

        const readQueueService = new FirestorePeiaTaskQueueService(
          effectivePeiaDb,
          peiaQueueServiceOptions
        );
        const reconciled = await readQueueService.reconcileTaskStatus({
          taskId: resolvedTaskId,
          targetType: AIReviewTargetType.LibraryIntake,
          targetId: record.id,
          currentSourceUpdatedAt: record.updatedAt,
        });

        // Cross-intake / cross-domain isolation: an explicit taskId that differs
        // from the current version's deterministic taskId MUST correspond to a
        // stored task for this exact LibraryIntake record; otherwise fail closed.
        if (
          explicitTaskId !== undefined &&
          explicitTaskId !== currentVersionTaskId &&
          reconciled.status === 'NotRequested'
        ) {
          throw new HttpsError(
            'failed-precondition',
            `CROSS_ITEM_OR_UNKNOWN_TASK_ID: Task '${explicitTaskId}' does not exist for Library intake record '${record.id}'`
          );
        }

        const preparationStatus =
          toSanitizedLibraryIntakePeiaPreparationStatusDto(
            reconciled,
            record.updatedAt
          );

        return Object.freeze({
          ...preparationStatus,
          preparationStatus,
          reviewStatus: preparationStatus,
        });
      }
    } catch (err: unknown) {
      throw mapLibraryPeiaTaskQueueErrorToHttpsError(err);
    }
  }

  const { auth } = requestContext;
  if (!auth) throw new HttpsError('unauthenticated', 'User not authenticated');

  const adminUser = await adminRepo.getAdminByUid(auth.uid);

  if (!adminUser || !adminUser.isActive) {
    throw new HttpsError('permission-denied', 'Admin user not found or inactive');
  }

  try {
    switch (data.action) {
      case 'listAll':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { documents: await service.listAll() };
      case 'getById':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.getById(data.id) };
      case 'create':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.create(data.input, adminUser) };
      case 'updateMetadata':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Edit)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.updateMetadata(data.id, data.updates, adminUser) };
      case 'updateRights':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.updateRights(data.id, data.rightsStatus, data.notesAr, data.notesEn, adminUser) };
      case 'transitionWorkflow':
        return { document: await service.transitionWorkflow(data.id, data.targetState, data.comment, adminUser) };
      case 'addVersion':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Edit)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.addVersion(data.id, data.versionInput, adminUser) };
      case 'listSources':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { sources: await service.listSources() };
      case 'listOrganizations':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { organizations: await service.listOrganizations() };
      case 'registerSource':
      case 'createSource':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Missing permission to register source');
        }
        return { source: await service.registerSource(data.input, adminUser) };
      case 'registerOrganization':
      case 'createOrganization':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Missing permission to register organization');
        }
        return { organization: await service.registerOrganization(data.input, adminUser) };
      case 'verifySource':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Only rights reviewers or owners may verify sources');
        }
        return { source: await service.verifySource(data.sourceId, data.status, adminUser) };
      case 'listIntake':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        {
          const intakeRecords = await service.listIntake();
          return { intakeRecords, intake: intakeRecords };
        }
      case 'getIntakeById':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { intakeRecord: await service.getIntakeById(data.id) };
      case 'submitIntake':
      case 'createIntake':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Edit)) {
          throw new HttpsError('permission-denied', 'Missing permission to submit intake reference');
        }
        return { intakeRecord: await service.submitIntake(data.input, adminUser) };
      case 'updateIntakeStatus':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Review) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Approve) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Only reviewers or rights managers may update intake status');
        }
        return { intakeRecord: await service.updateIntakeStatus(data.intakeId || data.id, data.status, data.reviewNotes, adminUser) };
      case 'generateIntakeAISuggestions':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Edit) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Review) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Approve) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Missing editorial or curation permission to generate AI preparation suggestions');
        }
        {
          let secretKey = '';
          if (geminiOptions?.apiKey !== undefined) {
            secretKey = geminiOptions.apiKey;
          } else {
            try {
              secretKey = geminiApiKey.value() || '';
            } catch {
              secretKey = process.env.GEMINI_API_KEY || '';
            }
          }
          const intakeRecord = await service.generateIntakeAISuggestions(
            {
              intakeId: data.intakeId || data.id || data.input?.intakeId,
              suppliedExcerpt: data.suppliedExcerpt ?? data.input?.suppliedExcerpt,
            },
            adminUser,
            {
              apiKey: secretKey,
              ...(geminiOptions?.fetchImpl !== undefined ? { fetchImpl: geminiOptions.fetchImpl } : {}),
              ...(geminiOptions?.timeoutMs !== undefined ? { timeoutMs: geminiOptions.timeoutMs } : {}),
            }
          );
          return { intakeRecord };
        }
      default:
        throw new HttpsError('invalid-argument', 'Invalid action');
    }
  } catch (error: any) {
    if (error instanceof HttpsError) {
      throw error;
    }
    const msg = error?.message || 'Internal server error';
    if (msg.startsWith('VALIDATION_ERROR') || msg.startsWith('INVALID_ARGUMENT') || msg.startsWith('INVALID_TRANSITION')) {
      throw new HttpsError('invalid-argument', msg);
    }
    if (msg.startsWith('PERMISSION_DENIED')) {
      throw new HttpsError('permission-denied', msg);
    }
    if (msg.startsWith('NOT_FOUND')) {
      throw new HttpsError('not-found', msg);
    }
    if (msg.startsWith('DUPLICATE_INTAKE') || msg.startsWith('DUPLICATE_DOCUMENT') || msg.startsWith('DUPLICATE_ORGANIZATION') || msg.startsWith('DUPLICATE_SOURCE')) {
      throw new HttpsError('already-exists', msg);
    }
    if (msg.startsWith('CONFIG_ERROR')) {
      throw new HttpsError('failed-precondition', msg);
    }
    if (msg.startsWith('CONFLICT')) {
      throw new HttpsError('aborted', msg);
    }
    if (msg.startsWith('AI_PROVIDER_ERROR')) {
      throw new HttpsError('unavailable', msg);
    }
    throw new HttpsError('internal', msg);
  }
}

export const manageLibraryDocuments = onCall({ secrets: [geminiApiKey] }, async (request) => {
  return executeManageLibraryDocumentsRequest({
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

export const getPublicLibrary = onCall({ cors: true }, async (_request): Promise<{ documents: PublicLibraryDocument[] }> => {
  try {
    const pubRepo = new PublicLibraryRepository();
    const documents = await pubRepo.listPublicDocuments();
    return { documents };
  } catch (error: any) {
    throw new HttpsError('internal', error.message || 'Failed to retrieve public library documents');
  }
});



