import { Buffer } from 'node:buffer';
import {
  AdminPermission,
  AdminRole,
  AdminUser,
  hasAdminPermission,
  isValidAdminRole,
} from '../shared/adminContract';
import { AdminRepository } from '../admin/adminRepository';
import type { CallableRequestContext } from './editorialImageRightsReviewService';
import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
  validateAssetId,
} from '../shared/editorialImageAssetContract';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetMetadata,
  type EditorialImageAssetOrigin,
  type EditorialImageAssetValidationLimits,
  type EditorialImageAssetVariant,
  type EditorialImageAssetVariantKey,
} from '../types/editorialImageAsset';
import {
  EditorialImageAssetRepository,
  EditorialImageAssetRepositoryRecord,
} from './editorialImageAssetRepository';
import {
  type EditorialImageRightsEvidenceRecord,
  type EditorialImageRightsEvidenceSourceKind,
  type RegisterEditorialImageRightsEvidenceInput,
  validateEvidenceId,
} from './editorialImageRightsEvidenceContract';
import {
  computeSha256Hex,
  EditorialBinaryRejectionCode,
  EditorialImageBinaryVerifiedResult,
  EditorialImageInspectionPolicy,
  inspectEditorialImageBinary,
  inspectRightsEvidenceBinary,
  RightsEvidenceBinaryVerifiedResult,
} from './editorialBinaryInspector';
import {
  processEditorialImageVariants,
  EditorialImageVariantProcessingError,
  type ProcessEditorialImageVariantsResult,
} from './editorialImageVariantProcessor';

export const EDITORIAL_IMAGE_ASSET_REQUIRED_VARIANT_KEYS: readonly EditorialImageAssetVariantKey[] =
  Object.freeze([
    'thumbnail',
    'card',
    'article_inline',
    'article_cover',
    'original_processed',
  ]);

/**
 * IMG-F3-05 — Recoverable Editorial Binary Intake Core
 *
 * BOUNDED LOCAL IMPLEMENTATION — NO PRODUCTION WIRING:
 * - Zero live Firebase Storage or Firestore SDK instantiation.
 * - Uses strict Dependency Injection for Storage, Session Persistence,
 *   Admin Authorization, Asset Repository, and Rights Evidence Registration.
 * - Implements an explicit 10-state recoverable saga with generation-checked
 *   conditional storage deletes and canonical read-back before rollback on
 *   ambiguous registration commits.
 */

export type EditorialBinaryIntakeTargetKind =
  | 'editorial_image_asset'
  | 'rights_evidence_binary';

export type EditorialBinaryIntakeSessionStatus =
  | 'Created'
  | 'Quarantined'
  | 'PreliminarilyVerified'
  | 'Promoting'
  | 'Registering'
  | 'Registered'
  | 'CleanupPending'
  | 'Completed'
  | 'Failed'
  | 'NeedsReconciliation';

export type EditorialBinaryStorageNamespace = 'quarantine' | 'private';

export type EditorialBinaryIntakeErrorCode =
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'BINARY_REJECTED'
  | 'INTAKE_ID_CONFLICT'
  | 'ASSET_ALREADY_EXISTS'
  | 'EVIDENCE_ALREADY_EXISTS'
  | 'STORAGE_CONFLICT'
  | 'STORAGE_FAILURE'
  | 'REGISTRATION_FAILURE'
  | 'CLEANUP_INCOMPLETE'
  | 'RECONCILIATION_REQUIRED'
  | 'NOT_FOUND';

export class EditorialBinaryIntakeError extends Error {
  public readonly code: EditorialBinaryIntakeErrorCode;
  public readonly intakeId?: string;
  public readonly sessionStatus?: EditorialBinaryIntakeSessionStatus;
  public readonly rejectionCode?: EditorialBinaryRejectionCode;
  public readonly details: readonly string[];

  constructor(params: {
    code: EditorialBinaryIntakeErrorCode;
    message: string;
    intakeId?: string;
    sessionStatus?: EditorialBinaryIntakeSessionStatus;
    rejectionCode?: EditorialBinaryRejectionCode;
    details?: readonly string[];
  }) {
    super(params.message);
    this.name = 'EditorialBinaryIntakeError';
    this.code = params.code;
    this.intakeId = params.intakeId;
    this.sessionStatus = params.sessionStatus;
    this.rejectionCode = params.rejectionCode;
    this.details = Object.freeze([...(params.details ?? [params.message])]);
    Object.setPrototypeOf(this, EditorialBinaryIntakeError.prototype);
  }
}

export interface StorageObjectOwnershipMetadata {
  readonly createdByIntakeId: string;
  readonly targetKind: EditorialBinaryIntakeTargetKind;
  readonly namespace: EditorialBinaryStorageNamespace;
  readonly assetId: string;
  readonly evidenceId?: string;
  readonly uploaderUid: string;
}

export interface StorageWriteIfAbsentRequest {
  readonly storagePath: string;
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly sha256Checksum: string;
  readonly ownership: StorageObjectOwnershipMetadata;
}

export interface StorageObjectMetadata {
  readonly storagePath: string;
  readonly generation: string;
  readonly etag: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256Checksum: string;
  readonly createdAtIso: string;
  readonly ownership: StorageObjectOwnershipMetadata;
}

export type StorageWriteIfAbsentOutcome =
  | {
      readonly created: true;
      readonly metadata: StorageObjectMetadata;
    }
  | {
      readonly created: false;
      readonly existingMetadata: StorageObjectMetadata;
    };

export interface ConditionalStorageDeleteRequest {
  readonly storagePath: string;
  readonly expectedGeneration: string;
  readonly expectedIntakeId: string;
}

export interface ConditionalStorageDeleteOutcome {
  readonly deleted: boolean;
  readonly reason:
    | 'DELETED'
    | 'ALREADY_ABSENT'
    | 'GENERATION_MISMATCH'
    | 'OWNERSHIP_MISMATCH';
}

/**
 * Storage adapter contract supporting create-if-absent (`ifGenerationMatch: 0`)
 * and generation/ownership-verified conditional deletion so a failed intake
 * never overwrites or deletes objects owned by another intake or existing asset.
 */
export interface EditorialBinaryStorageAdapter {
  writeIfAbsent(
    request: StorageWriteIfAbsentRequest
  ): Promise<StorageWriteIfAbsentOutcome>;
  readMetadata(storagePath: string): Promise<StorageObjectMetadata | null>;
  readBytes(
    storagePath: string
  ): Promise<{ bytes: Buffer; metadata: StorageObjectMetadata } | null>;
  deleteIfGenerationMatches(
    request: ConditionalStorageDeleteRequest
  ): Promise<ConditionalStorageDeleteOutcome>;
}

export interface TrackedIntakeStorageObject {
  readonly storagePath: string;
  readonly namespace: EditorialBinaryStorageNamespace;
  readonly generation: string;
  readonly etag: string;
  readonly sha256Checksum: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly createdByIntakeId: string;
}

export interface EditorialBinaryIntakeSession {
  readonly intakeId: string;
  readonly targetKind: EditorialBinaryIntakeTargetKind;
  readonly assetId: string;
  readonly evidenceId?: string;
  readonly uploaderUid: string;
  readonly uploaderRole: AdminRole;
  readonly requestFingerprint: string;
  readonly status: EditorialBinaryIntakeSessionStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly binarySha256?: string;
  readonly detectedMimeType?: string;
  readonly binarySizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly aspectRatio?: number;
  readonly createdQuarantineObjects: readonly TrackedIntakeStorageObject[];
  readonly createdPrivateObjects: readonly TrackedIntakeStorageObject[];
  readonly pendingCleanupObjects: readonly TrackedIntakeStorageObject[];
  readonly canonicalRegistrationAttempted: boolean;
  readonly canonicalRegistrationSucceeded: boolean;
  readonly registrationOutcomeUnknown: boolean;
  readonly rejectionCode?: EditorialBinaryRejectionCode;
  readonly lastErrorCode?: EditorialBinaryIntakeErrorCode;
  readonly lastErrorMessage?: string;
}

/**
 * Durable-adapter-ready interface for persisting and querying intake saga sessions.
 * Note: Production wiring requires a durable Firestore backing implementation;
 * `InMemoryIntakeSessionStore` is provided strictly for local tests.
 */
export interface IntakeSessionStore {
  createSessionIfAbsent(
    session: EditorialBinaryIntakeSession
  ): Promise<{
    readonly created: boolean;
    readonly session: EditorialBinaryIntakeSession;
  }>;
  getSessionById(
    intakeId: string
  ): Promise<EditorialBinaryIntakeSession | null>;
  updateSession(
    session: EditorialBinaryIntakeSession,
    expectedRevision: number
  ): Promise<EditorialBinaryIntakeSession>;
  listSessionsForReconciliation(options?: {
    readonly nowIso?: string;
    readonly limit?: number;
  }): Promise<readonly EditorialBinaryIntakeSession[]>;
}

/**
 * Bridge interface to the accepted `EditorialImageRightsReviewService`
 * for registering rights evidence metadata and checking persisted evidence records
 * during lost-commit recovery.
 */
export interface EditorialRightsEvidenceRegistrationBridge {
  registerRightsEvidence(
    requestContext: CallableRequestContext,
    rawInput: RegisterEditorialImageRightsEvidenceInput
  ): Promise<EditorialImageRightsEvidenceRecord>;
  getEvidenceRecord?(
    evidenceId: string
  ): Promise<EditorialImageRightsEvidenceRecord | null>;
}

export interface EditorialBinaryIntakeStageFaultInjection {
  readonly failBeforeQuarantineWrite?: boolean;
  readonly failAfterQuarantineWrite?: boolean;
  readonly failBeforePrivateWrite?: boolean;
  readonly failDuringPrivateWriteAfterCount?: number;
  readonly failBeforeCanonicalRegistration?: boolean;
  readonly failAfterCanonicalRegistrationUnknownOutcome?: boolean;
  readonly failDuringQuarantineCleanup?: boolean;
  readonly failDuringRollbackCleanup?: boolean;
}

export interface IngestEditorialImageBinaryInput {
  readonly intakeId: string;
  readonly assetId: string;
  readonly binary: Buffer | Uint8Array;
  readonly originalFilename: string;
  readonly claimedMimeType?: string;
  readonly claimedFilenameOrExtension?: string;
  readonly origin: EditorialImageAssetOrigin;
  readonly altAr: string;
  readonly altEn?: string;
  readonly captionAr?: string;
  readonly captionEn?: string;
  readonly photographerCredit?: string;
  readonly licensingInfo?: string;
  readonly tags?: readonly string[];
  readonly associatedArticleIds?: readonly string[];
}

export interface IngestRightsEvidenceBinaryInput {
  readonly intakeId: string;
  readonly assetId: string;
  readonly evidenceId: string;
  readonly binary: Buffer | Uint8Array;
  readonly claimedMimeType?: string;
  readonly claimedFilenameOrExtension?: string;
  readonly sourceKind: EditorialImageRightsEvidenceSourceKind;
  readonly sourceReference: string;
  readonly summary: string;
}

export interface EditorialImageBinaryIntakeResult {
  readonly intakeId: string;
  readonly sessionStatus: 'Completed' | 'CleanupPending';
  readonly binaryInspectionStatus: 'PRELIMINARY_VERIFIED';
  readonly fullPixelDecodePerformed: true;
  readonly reencodedOrStripped: true;
  /**
   * Discloses that genuine WebP variants were produced via Sharp native pipeline
   * rather than provisional identical copies.
   */
  readonly provisionalIdenticalVariants: false;
  readonly assetRecord: EditorialImageAssetRepositoryRecord;
  readonly inspection: EditorialImageBinaryVerifiedResult;
}

export interface RightsEvidenceBinaryIntakeResult {
  readonly intakeId: string;
  readonly sessionStatus: 'Completed' | 'CleanupPending';
  readonly binaryInspectionStatus: 'PRELIMINARY_VERIFIED';
  readonly binaryPreliminarilyInspected: true;
  readonly metadataEvidenceRegistered: true;
  readonly fullSanitizationPerformed: false;
  readonly heuristicPdfScreening: boolean;
  readonly evidenceRecord: EditorialImageRightsEvidenceRecord;
  readonly inspection: Omit<
    RightsEvidenceBinaryVerifiedResult,
    'targetKind'
  > & {
    readonly targetKind: 'rights_evidence_binary';
  };
}

export interface ReconcileIntakeOutcome {
  readonly intakeId: string;
  readonly previousStatus: EditorialBinaryIntakeSessionStatus;
  readonly currentStatus: EditorialBinaryIntakeSessionStatus;
  readonly canonicalRegistrationVerified: boolean;
  readonly deletedObjectsCount: number;
  readonly remainingCleanupObjectsCount: number;
  readonly session: EditorialBinaryIntakeSession;
}

const INTAKE_ID_REGEX = /^[A-Za-z0-9_.:-]{1,128}$/;
const UID_CHARS_REGEX = /^[A-Za-z0-9_.:-]{1,128}$/;

const ALLOWED_IMAGE_INTAKE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'intakeId',
  'assetId',
  'binary',
  'originalFilename',
  'claimedMimeType',
  'claimedFilenameOrExtension',
  'origin',
  'altAr',
  'altEn',
  'captionAr',
  'captionEn',
  'photographerCredit',
  'licensingInfo',
  'tags',
  'associatedArticleIds',
]);

const ALLOWED_EVIDENCE_INTAKE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'intakeId',
  'assetId',
  'evidenceId',
  'binary',
  'claimedMimeType',
  'claimedFilenameOrExtension',
  'sourceKind',
  'sourceReference',
  'summary',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneTrackedObjects(
  items: readonly TrackedIntakeStorageObject[]
): readonly TrackedIntakeStorageObject[] {
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

function cloneIntakeSession(
  session: EditorialBinaryIntakeSession
): EditorialBinaryIntakeSession {
  return Object.freeze({
    ...session,
    createdQuarantineObjects: cloneTrackedObjects(
      session.createdQuarantineObjects
    ),
    createdPrivateObjects: cloneTrackedObjects(session.createdPrivateObjects),
    pendingCleanupObjects: cloneTrackedObjects(session.pendingCleanupObjects),
  });
}

export function validateIntakeId(intakeId: unknown): string {
  if (typeof intakeId !== 'string' || intakeId.trim().length === 0) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'intakeId must be a non-empty string.',
    });
  }
  if (
    intakeId !== intakeId.trim() ||
    !INTAKE_ID_REGEX.test(intakeId) ||
    intakeId.includes('/') ||
    intakeId.includes('..')
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message:
        'intakeId contains invalid characters or path segments; only alphanumeric, "_", "-", ".", and ":" (1..128 chars) are permitted.',
    });
  }
  return intakeId;
}

export function buildQuarantineImageStoragePath(
  intakeId: string,
  canonicalExtension: 'png' | 'jpg' | 'webp'
): string {
  const validIntakeId = validateIntakeId(intakeId);
  return `editorial_intake_quarantine/images/${validIntakeId}/source.${canonicalExtension}`;
}

export function buildQuarantineEvidenceStoragePath(
  intakeId: string,
  canonicalExtension: 'pdf' | 'png' | 'jpg' | 'webp'
): string {
  const validIntakeId = validateIntakeId(intakeId);
  return `editorial_intake_quarantine/rights_evidence/${validIntakeId}/source.${canonicalExtension}`;
}

/**
 * Builds the confidential private storage path for a rights-evidence binary.
 * Note: This path is strictly isolated from `editorial_images/private/...`
 * and is never returned in client-facing evidence records or responses.
 */
export function buildPrivateRightsEvidenceStoragePath(
  assetId: string,
  evidenceId: string,
  canonicalExtension: 'pdf' | 'png' | 'jpg' | 'webp',
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): string {
  const assetCheck = validateAssetId(assetId, limits);
  if (!assetCheck.valid) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Invalid assetId "${assetId}".`,
      details: assetCheck.errors,
    });
  }
  const evCheck = validateEvidenceId(evidenceId, limits);
  if (!evCheck.valid) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Invalid evidenceId "${evidenceId}".`,
      details: evCheck.errors,
    });
  }
  return `editorial_rights_evidence/private/${assetId}/${evidenceId}/artifact.${canonicalExtension}`;
}

/**
 * In-memory implementation of `EditorialBinaryStorageAdapter` for local unit,
 * fault-injection, and concurrency tests. Enforces `ifGenerationMatch: 0`
 * create-if-absent semantics and generation/ownership-checked conditional deletes.
 */
export class InMemoryEditorialBinaryStorageAdapter
  implements EditorialBinaryStorageAdapter
{
  private readonly objects: Map<
    string,
    {
      readonly bytes: Buffer;
      readonly metadata: StorageObjectMetadata;
    }
  > = new Map();

  private generationCounter = 0;
  private readonly clock: () => string;
  private writeFaultPaths: Set<string> = new Set();
  private deleteFaultPaths: Set<string> = new Set();

  constructor(options?: { readonly clock?: () => string }) {
    this.clock = options?.clock ?? (() => new Date().toISOString());
  }

  public failWriteForPathOnce(storagePath: string): void {
    this.writeFaultPaths.add(storagePath);
  }

  public failDeleteForPathOnce(storagePath: string): void {
    this.deleteFaultPaths.add(storagePath);
  }

  public listStoredPaths(): string[] {
    return Array.from(this.objects.keys()).sort();
  }

  public getStoredObjectCount(): number {
    return this.objects.size;
  }

  async writeIfAbsent(
    request: StorageWriteIfAbsentRequest
  ): Promise<StorageWriteIfAbsentOutcome> {
    if (this.writeFaultPaths.has(request.storagePath)) {
      this.writeFaultPaths.delete(request.storagePath);
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Simulated storage write failure at path "${request.storagePath}".`,
      });
    }

    const existing = this.objects.get(request.storagePath);
    if (existing) {
      return {
        created: false,
        existingMetadata: {
          ...existing.metadata,
          ownership: { ...existing.metadata.ownership },
        },
      };
    }

    this.generationCounter += 1;
    const generation = `gen_${this.generationCounter}`;
    const etag = `etag_${generation}_${request.sha256Checksum.slice(0, 12)}`;
    const metadata: StorageObjectMetadata = Object.freeze({
      storagePath: request.storagePath,
      generation,
      etag,
      contentType: request.contentType,
      sizeBytes: request.bytes.length,
      sha256Checksum: request.sha256Checksum,
      createdAtIso: this.clock(),
      ownership: Object.freeze({ ...request.ownership }),
    });

    this.objects.set(request.storagePath, {
      bytes: Buffer.from(request.bytes),
      metadata,
    });

    return {
      created: true,
      metadata,
    };
  }

  async readMetadata(
    storagePath: string
  ): Promise<StorageObjectMetadata | null> {
    const entry = this.objects.get(storagePath);
    if (!entry) {
      return null;
    }
    return {
      ...entry.metadata,
      ownership: { ...entry.metadata.ownership },
    };
  }

  async readBytes(
    storagePath: string
  ): Promise<{ bytes: Buffer; metadata: StorageObjectMetadata } | null> {
    const entry = this.objects.get(storagePath);
    if (!entry) {
      return null;
    }
    return {
      bytes: Buffer.from(entry.bytes),
      metadata: {
        ...entry.metadata,
        ownership: { ...entry.metadata.ownership },
      },
    };
  }

  async deleteIfGenerationMatches(
    request: ConditionalStorageDeleteRequest
  ): Promise<ConditionalStorageDeleteOutcome> {
    if (this.deleteFaultPaths.has(request.storagePath)) {
      this.deleteFaultPaths.delete(request.storagePath);
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Simulated conditional delete failure at path "${request.storagePath}".`,
      });
    }

    const existing = this.objects.get(request.storagePath);
    if (!existing) {
      return { deleted: false, reason: 'ALREADY_ABSENT' };
    }

    if (
      existing.metadata.ownership.createdByIntakeId !== request.expectedIntakeId
    ) {
      return { deleted: false, reason: 'OWNERSHIP_MISMATCH' };
    }

    if (existing.metadata.generation !== request.expectedGeneration) {
      return { deleted: false, reason: 'GENERATION_MISMATCH' };
    }

    this.objects.delete(request.storagePath);
    return { deleted: true, reason: 'DELETED' };
  }
}

/**
 * In-memory implementation of `IntakeSessionStore` for local testing.
 * Enforces optimistic concurrency (`expectedRevision`) and deep immutability.
 */
export class InMemoryIntakeSessionStore implements IntakeSessionStore {
  private readonly sessions: Map<string, EditorialBinaryIntakeSession> =
    new Map();

  async createSessionIfAbsent(
    session: EditorialBinaryIntakeSession
  ): Promise<{
    readonly created: boolean;
    readonly session: EditorialBinaryIntakeSession;
  }> {
    const existing = this.sessions.get(session.intakeId);
    if (existing) {
      return {
        created: false,
        session: cloneIntakeSession(existing),
      };
    }
    const cloned = cloneIntakeSession(session);
    this.sessions.set(session.intakeId, cloned);
    return {
      created: true,
      session: cloneIntakeSession(cloned),
    };
  }

  async getSessionById(
    intakeId: string
  ): Promise<EditorialBinaryIntakeSession | null> {
    const existing = this.sessions.get(intakeId);
    return existing ? cloneIntakeSession(existing) : null;
  }

  async updateSession(
    session: EditorialBinaryIntakeSession,
    expectedRevision: number
  ): Promise<EditorialBinaryIntakeSession> {
    const existing = this.sessions.get(session.intakeId);
    if (!existing) {
      throw new EditorialBinaryIntakeError({
        code: 'NOT_FOUND',
        message: `Intake session "${session.intakeId}" does not exist.`,
        intakeId: session.intakeId,
      });
    }
    if (existing.revision !== expectedRevision) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_CONFLICT',
        message: `Intake session "${session.intakeId}" revision conflict: expected ${expectedRevision}, found ${existing.revision}.`,
        intakeId: session.intakeId,
        sessionStatus: existing.status,
      });
    }
    const nextSession: EditorialBinaryIntakeSession = cloneIntakeSession({
      ...session,
      revision: expectedRevision + 1,
    });
    this.sessions.set(session.intakeId, nextSession);
    return cloneIntakeSession(nextSession);
  }

  async listSessionsForReconciliation(options?: {
    readonly nowIso?: string;
    readonly limit?: number;
  }): Promise<readonly EditorialBinaryIntakeSession[]> {
    const nowMs = options?.nowIso ? Date.parse(options.nowIso) : null;
    const results: EditorialBinaryIntakeSession[] = [];

    for (const session of this.sessions.values()) {
      const isDirectlyReconcilable =
        session.status === 'NeedsReconciliation' ||
        session.status === 'CleanupPending' ||
        session.status === 'Registering' ||
        session.status === 'Registered';

      const isExpiredActive =
        nowMs !== null &&
        !Number.isNaN(nowMs) &&
        Date.parse(session.expiresAt) <= nowMs &&
        session.status !== 'Completed' &&
        session.status !== 'Failed';

      if (isDirectlyReconcilable || isExpiredActive) {
        results.push(cloneIntakeSession(session));
      }
      if (options?.limit && results.length >= options.limit) {
        break;
      }
    }

    return Object.freeze(results);
  }
}

export interface EditorialBinaryIntakeServiceOptions {
  readonly adminRepository: AdminRepository;
  readonly assetRepository: EditorialImageAssetRepository;
  readonly rightsEvidenceBridge: EditorialRightsEvidenceRegistrationBridge;
  readonly storageAdapter: EditorialBinaryStorageAdapter;
  readonly sessionStore: IntakeSessionStore;
  readonly evidenceLookup?: (
    evidenceId: string
  ) => Promise<EditorialImageRightsEvidenceRecord | null>;
  readonly onAssetRegisteredHook?: (
    record: EditorialImageAssetRepositoryRecord
  ) => Promise<void> | void;
  readonly clock?: () => string;
  readonly sessionTtlMs?: number;
  readonly limits?: EditorialImageAssetValidationLimits;
  readonly inspectionPolicy?: Partial<EditorialImageInspectionPolicy>;
}

export class EditorialBinaryIntakeService {
  private readonly adminRepo: AdminRepository;
  private readonly assetRepo: EditorialImageAssetRepository;
  private readonly rightsEvidenceBridge: EditorialRightsEvidenceRegistrationBridge;
  private readonly storage: EditorialBinaryStorageAdapter;
  private readonly sessionStore: IntakeSessionStore;
  private readonly evidenceLookup?: (
    evidenceId: string
  ) => Promise<EditorialImageRightsEvidenceRecord | null>;
  private readonly onAssetRegisteredHook?: (
    record: EditorialImageAssetRepositoryRecord
  ) => Promise<void> | void;
  private readonly clock: () => string;
  private readonly sessionTtlMs: number;
  private readonly limits: EditorialImageAssetValidationLimits;
  private readonly inspectionPolicy?: Partial<EditorialImageInspectionPolicy>;
  private oneShotFault: EditorialBinaryIntakeStageFaultInjection | null = null;

  constructor(options: EditorialBinaryIntakeServiceOptions) {
    if (
      !options ||
      !options.adminRepository ||
      !options.assetRepository ||
      !options.rightsEvidenceBridge ||
      !options.storageAdapter ||
      !options.sessionStore
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message:
          'EditorialBinaryIntakeService requires adminRepository, assetRepository, rightsEvidenceBridge, storageAdapter, and sessionStore.',
      });
    }
    this.adminRepo = options.adminRepository;
    this.assetRepo = options.assetRepository;
    this.rightsEvidenceBridge = options.rightsEvidenceBridge;
    this.storage = options.storageAdapter;
    this.sessionStore = options.sessionStore;
    this.evidenceLookup =
      options.evidenceLookup ??
      (typeof options.rightsEvidenceBridge.getEvidenceRecord === 'function'
        ? (id: string) => options.rightsEvidenceBridge.getEvidenceRecord!(id)
        : undefined);
    this.onAssetRegisteredHook = options.onAssetRegisteredHook;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.sessionTtlMs = options.sessionTtlMs ?? 15 * 60 * 1000; // 15 minutes default
    this.limits = options.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;
    this.inspectionPolicy = options.inspectionPolicy;
  }

  public injectStageFaultOnce(
    fault: EditorialBinaryIntakeStageFaultInjection
  ): void {
    this.oneShotFault = { ...fault };
  }

  private consumeFault(): EditorialBinaryIntakeStageFaultInjection | null {
    const f = this.oneShotFault;
    this.oneShotFault = null;
    return f;
  }

  private computeExpiresAtIso(nowIso: string): string {
    const ms = Date.parse(nowIso);
    const baseMs = Number.isNaN(ms) ? Date.now() : ms;
    return new Date(baseMs + this.sessionTtlMs).toISOString();
  }

  private async authenticateHumanCaller(
    requestContext: CallableRequestContext | null | undefined,
    targetKind: EditorialBinaryIntakeTargetKind
  ): Promise<AdminUser> {
    if (
      !requestContext ||
      !requestContext.auth ||
      typeof requestContext.auth.uid !== 'string' ||
      requestContext.auth.uid.trim().length === 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'UNAUTHENTICATED',
        message:
          'UNAUTHENTICATED: Trusted server authentication is required for binary intake.',
      });
    }

    const uid = requestContext.auth.uid;
    if (uid !== uid.trim() || !UID_CHARS_REGEX.test(uid)) {
      throw new EditorialBinaryIntakeError({
        code: 'UNAUTHENTICATED',
        message: 'UNAUTHENTICATED: Authenticated caller UID format is invalid.',
      });
    }

    const admin = await this.adminRepo.getAdminByUid(uid);
    if (!admin || ! isPlainObject(admin as unknown)) {
      throw new EditorialBinaryIntakeError({
        code: 'PERMISSION_DENIED',
        message:
          'PERMISSION_DENIED: Administrative account is not registered.',
      });
    }

    if (admin.id !== uid) {
      throw new EditorialBinaryIntakeError({
        code: 'PERMISSION_DENIED',
        message:
          'PERMISSION_DENIED: Persisted admin record ID does not match authenticated UID.',
      });
    }

    if (admin.isActive !== true) {
      throw new EditorialBinaryIntakeError({
        code: 'PERMISSION_DENIED',
        message: 'PERMISSION_DENIED: Administrative account is inactive.',
      });
    }

    if (!isValidAdminRole(admin.role)) {
      throw new EditorialBinaryIntakeError({
        code: 'PERMISSION_DENIED',
        message: 'PERMISSION_DENIED: Administrative role is invalid.',
      });
    }

    if (admin.role === AdminRole.AIAssistant) {
      throw new EditorialBinaryIntakeError({
        code: 'PERMISSION_DENIED',
        message:
          'PERMISSION_DENIED: AIAssistant role is prohibited from binary intake and rights evidence operations.',
      });
    }

    if (targetKind === 'rights_evidence_binary') {
      if (!hasAdminPermission(admin, AdminPermission.ManageRights)) {
        throw new EditorialBinaryIntakeError({
          code: 'PERMISSION_DENIED',
          message:
            'PERMISSION_DENIED: Confidential rights evidence binary intake requires ManageRights permission.',
        });
      }
    } else {
      const canIngestImage =
        hasAdminPermission(admin, AdminPermission.Create) ||
        hasAdminPermission(admin, AdminPermission.Edit) ||
        hasAdminPermission(admin, AdminPermission.ManageRights);
      if (!canIngestImage) {
        throw new EditorialBinaryIntakeError({
          code: 'PERMISSION_DENIED',
          message:
            'PERMISSION_DENIED: Editorial image binary intake requires Create, Edit, or ManageRights permission.',
        });
      }
    }

    return admin;
  }

  private assertNoUnexpectedKeys(
    rawInput: unknown,
    allowedKeys: ReadonlySet<string>,
    label: string
  ): Record<string, unknown> {
    if (!isPlainObject(rawInput)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `${label} must be a non-null plain object.`,
      });
    }
    const unexpected = Object.keys(rawInput).filter(
      (k) => !allowedKeys.has(k)
    );
    if (unexpected.length > 0) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `${label} contains forbidden or spoofed fields: ${unexpected.join(', ')}. Server-derived fields (UID, role, checksum, dimensions, size, MIME, storagePath, rights) must not be supplied by the caller.`,
        details: unexpected.map(
          (k) => `Forbidden caller-supplied field "${k}".`
        ),
      });
    }
    return rawInput;
  }

  private computeImageIntakeFingerprint(
    input: IngestEditorialImageBinaryInput,
    uploaderUid: string,
    binarySha256: string
  ): string {
    const payload = JSON.stringify({
      targetKind: 'editorial_image_asset',
      intakeId: input.intakeId,
      assetId: input.assetId,
      uploaderUid,
      binarySha256,
      originalFilename: input.originalFilename,
      origin: input.origin,
      altAr: input.altAr,
      altEn: input.altEn ?? null,
      captionAr: input.captionAr ?? null,
      captionEn: input.captionEn ?? null,
      photographerCredit: input.photographerCredit ?? null,
      licensingInfo: input.licensingInfo ?? null,
      tags: input.tags ?? [],
      associatedArticleIds: input.associatedArticleIds ?? [],
    });
    return computeSha256Hex(Buffer.from(payload, 'utf8'));
  }

  private computeEvidenceIntakeFingerprint(
    input: IngestRightsEvidenceBinaryInput,
    uploaderUid: string,
    binarySha256: string
  ): string {
    const payload = JSON.stringify({
      targetKind: 'rights_evidence_binary',
      intakeId: input.intakeId,
      assetId: input.assetId,
      evidenceId: input.evidenceId,
      uploaderUid,
      binarySha256,
      sourceKind: input.sourceKind,
      sourceReference: input.sourceReference,
      summary: input.summary,
    });
    return computeSha256Hex(Buffer.from(payload, 'utf8'));
  }

  private verifyExistingSessionOwnershipAndBinding(
    existing: EditorialBinaryIntakeSession,
    expected: {
      readonly intakeId: string;
      readonly targetKind: EditorialBinaryIntakeTargetKind;
      readonly assetId: string;
      readonly evidenceId?: string;
      readonly uploaderUid: string;
      readonly requestFingerprint: string;
    }
  ): void {
    const sameBinding =
      existing.intakeId === expected.intakeId &&
      existing.targetKind === expected.targetKind &&
      existing.assetId === expected.assetId &&
      existing.evidenceId === expected.evidenceId &&
      existing.uploaderUid === expected.uploaderUid &&
      existing.requestFingerprint === expected.requestFingerprint;

    if (!sameBinding) {
      throw new EditorialBinaryIntakeError({
        code: 'INTAKE_ID_CONFLICT',
        message: `Intake ID "${expected.intakeId}" is already bound to a different target, asset, evidence ID, actor, or payload fingerprint and cannot be reused.`,
        intakeId: expected.intakeId,
        sessionStatus: existing.status,
      });
    }
  }

  private async cleanupTrackedObjects(
    intakeId: string,
    objectsToDelete: readonly TrackedIntakeStorageObject[],
    simulateCleanupFailure: boolean
  ): Promise<{
    readonly remaining: readonly TrackedIntakeStorageObject[];
    readonly deletedCount: number;
  }> {
    const remaining: TrackedIntakeStorageObject[] = [];
    let deletedCount = 0;

    for (let i = 0; i < objectsToDelete.length; i += 1) {
      const obj = objectsToDelete[i];
      if (simulateCleanupFailure && i === 0) {
        remaining.push(obj);
        continue;
      }
      try {
        const res = await this.storage.deleteIfGenerationMatches({
          storagePath: obj.storagePath,
          expectedGeneration: obj.generation,
          expectedIntakeId: intakeId,
        });
        if (
          res.deleted ||
          res.reason === 'ALREADY_ABSENT'
        ) {
          deletedCount += res.deleted ? 1 : 0;
        } else {
          // Ownership or generation mismatch: do NOT retry deleting an object owned by someone else
        }
      } catch {
        remaining.push(obj);
      }
    }

    return {
      remaining: Object.freeze(remaining),
      deletedCount,
    };
  }

  private async rollbackUnregisteredIntakeSession(
    session: EditorialBinaryIntakeSession,
    errorCode: EditorialBinaryIntakeErrorCode,
    errorMessage: string,
    simulateRollbackCleanupFailure: boolean,
    rejectionCode?: EditorialBinaryRejectionCode
  ): Promise<EditorialBinaryIntakeSession> {
    const allCreatedObjects: TrackedIntakeStorageObject[] = [
      ...session.createdPrivateObjects,
      ...session.createdQuarantineObjects,
    ];

    const cleanupOutcome = await this.cleanupTrackedObjects(
      session.intakeId,
      allCreatedObjects,
      simulateRollbackCleanupFailure
    );

    const nextStatus: EditorialBinaryIntakeSessionStatus =
      cleanupOutcome.remaining.length === 0 ? 'Failed' : 'CleanupPending';

    return this.sessionStore.updateSession(
      {
        ...session,
        status: nextStatus,
        updatedAt: this.clock(),
        pendingCleanupObjects: cleanupOutcome.remaining,
        rejectionCode: rejectionCode ?? session.rejectionCode,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
      },
      session.revision
    );
  }

  /**
   * Executes the recoverable intake saga for an editorial image binary:
   * 1. Authenticates human caller via AdminRepository (`Create`, `Edit`, or `ManageRights`).
   * 2. Validates `intakeId` and `assetId`, rejecting any spoofed server fields.
   * 3. Persists `Created` session with immutable ownership binding `{intakeId, assetId, uploaderUid}`.
   * 4. Stages raw bytes into quarantine namespace (`Quarantined`).
   * 5. Runs preliminary binary inspection (`inspectEditorialImageBinary`) -> `PreliminarilyVerified`.
   * 6. Verifies `assetId` is not already registered and promotes variant objects into private storage
   *    using `writeIfAbsent` (`Promoting`).
   * 7. Transitions to `Registering` and commits the canonical `EditorialImageAssetMetadata` record
   *    via `EditorialImageAssetRepository.createIfAbsent`.
   * 8. Transitions to `Registered`, cleans up the quarantine object, and finalizes as `Completed`
   *    (or `CleanupPending` if quarantine cleanup fails).
   */
  async ingestEditorialImageBinary(
    requestContext: CallableRequestContext,
    rawInput: IngestEditorialImageBinaryInput
  ): Promise<EditorialImageBinaryIntakeResult> {
    const admin = await this.authenticateHumanCaller(
      requestContext,
      'editorial_image_asset'
    );
    this.assertNoUnexpectedKeys(
      rawInput,
      ALLOWED_IMAGE_INTAKE_INPUT_KEYS,
      'Editorial image binary intake input'
    );

    const intakeId = validateIntakeId(rawInput.intakeId);
    const assetIdCheck = validateAssetId(rawInput.assetId, this.limits);
    if (!assetIdCheck.valid) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid assetId "${rawInput.assetId}".`,
        intakeId,
        details: assetIdCheck.errors,
      });
    }

    if (
      !Buffer.isBuffer(rawInput.binary) &&
      !(rawInput.binary instanceof Uint8Array)
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'binary must be a Buffer or Uint8Array.',
        intakeId,
      });
    }

    const binaryBuffer = Buffer.isBuffer(rawInput.binary)
      ? Buffer.from(rawInput.binary)
      : Buffer.from(
          rawInput.binary.buffer,
          rawInput.binary.byteOffset,
          rawInput.binary.byteLength
        );

    const rawSha256 =
      binaryBuffer.length > 0 ? computeSha256Hex(binaryBuffer) : 'empty';
    const requestFingerprint = this.computeImageIntakeFingerprint(
      rawInput,
      admin.id,
      rawSha256
    );

    const nowIso = this.clock();
    const initialSession: EditorialBinaryIntakeSession = {
      intakeId,
      targetKind: 'editorial_image_asset',
      assetId: rawInput.assetId,
      uploaderUid: admin.id,
      uploaderRole: admin.role,
      requestFingerprint,
      status: 'Created',
      revision: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: this.computeExpiresAtIso(nowIso),
      createdQuarantineObjects: [],
      createdPrivateObjects: [],
      pendingCleanupObjects: [],
      canonicalRegistrationAttempted: false,
      canonicalRegistrationSucceeded: false,
      registrationOutcomeUnknown: false,
    };

    const sessionCreation =
      await this.sessionStore.createSessionIfAbsent(initialSession);
    if (!sessionCreation.created) {
      this.verifyExistingSessionOwnershipAndBinding(sessionCreation.session, {
        intakeId,
        targetKind: 'editorial_image_asset',
        assetId: rawInput.assetId,
        uploaderUid: admin.id,
        requestFingerprint,
      });
      throw new EditorialBinaryIntakeError({
        code: 'INTAKE_ID_CONFLICT',
        message: `Intake session "${intakeId}" already exists with status "${sessionCreation.session.status}". Use reconcileIntake("${intakeId}") to inspect or recover an existing session.`,
        intakeId,
        sessionStatus: sessionCreation.session.status,
      });
    }

    let session = sessionCreation.session;
    const fault = this.consumeFault();

    // Check pre-existing canonical asset BEFORE writing any objects so we never collide with or touch existing assets
    const preExistingAsset = await this.assetRepo.getById(rawInput.assetId);
    if (preExistingAsset.status === 'FOUND') {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'ASSET_ALREADY_EXISTS',
        `Editorial image asset "${rawInput.assetId}" already exists.`,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'ASSET_ALREADY_EXISTS',
        message: `Editorial image asset "${rawInput.assetId}" already exists.`,
        intakeId,
        sessionStatus: session.status,
      });
    }

    if (fault?.failBeforeQuarantineWrite) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        'Simulated failure before quarantine storage write.',
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: 'Simulated failure before quarantine storage write.',
        intakeId,
        sessionStatus: session.status,
      });
    }

    // Preliminary inspection is performed alongside quarantine staging
    const inspection = inspectEditorialImageBinary(binaryBuffer, {
      claimedMimeType: rawInput.claimedMimeType,
      claimedFilenameOrExtension: rawInput.claimedFilenameOrExtension,
      policy: this.inspectionPolicy,
    });

    if (inspection.status === 'REJECTED') {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'BINARY_REJECTED',
        inspection.rejectionReason,
        Boolean(fault?.failDuringRollbackCleanup),
        inspection.rejectionCode
      );
      throw new EditorialBinaryIntakeError({
        code: 'BINARY_REJECTED',
        message: inspection.rejectionReason,
        intakeId,
        sessionStatus: session.status,
        rejectionCode: inspection.rejectionCode,
      });
    }

    // Stage into quarantine namespace
    const quarantinePath = buildQuarantineImageStoragePath(
      intakeId,
      inspection.canonicalExtension
    );

    let quarantineWrite: StorageWriteIfAbsentOutcome;
    try {
      quarantineWrite = await this.storage.writeIfAbsent({
        storagePath: quarantinePath,
        bytes: binaryBuffer,
        contentType: inspection.detectedMimeType,
        sha256Checksum: inspection.sha256Checksum,
        ownership: {
          createdByIntakeId: intakeId,
          targetKind: 'editorial_image_asset',
          namespace: 'quarantine',
          assetId: rawInput.assetId,
          uploaderUid: admin.id,
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Quarantine storage write failed.';
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        msg,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: msg,
        intakeId,
        sessionStatus: session.status,
      });
    }

    if (!quarantineWrite.created) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_CONFLICT',
        `Quarantine storage path "${quarantinePath}" already exists.`,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_CONFLICT',
        message: `Quarantine storage path "${quarantinePath}" already exists.`,
        intakeId,
        sessionStatus: session.status,
      });
    }

    const trackedQuarantineObj: TrackedIntakeStorageObject = {
      storagePath: quarantineWrite.metadata.storagePath,
      namespace: 'quarantine',
      generation: quarantineWrite.metadata.generation,
      etag: quarantineWrite.metadata.etag,
      sha256Checksum: quarantineWrite.metadata.sha256Checksum,
      sizeBytes: quarantineWrite.metadata.sizeBytes,
      contentType: quarantineWrite.metadata.contentType,
      createdByIntakeId: intakeId,
    };

    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'Quarantined',
        updatedAt: this.clock(),
        createdQuarantineObjects: [trackedQuarantineObj],
      },
      session.revision
    );

    if (fault?.failAfterQuarantineWrite) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        'Simulated failure after quarantine storage write.',
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: 'Simulated failure after quarantine storage write.',
        intakeId,
        sessionStatus: session.status,
      });
    }

    // Record PreliminarilyVerified state
    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'PreliminarilyVerified',
        updatedAt: this.clock(),
        binarySha256: inspection.sha256Checksum,
        detectedMimeType: inspection.detectedMimeType,
        binarySizeBytes: inspection.sizeBytes,
        width: inspection.width,
        height: inspection.height,
        aspectRatio: inspection.aspectRatio,
      },
      session.revision
    );

    if (fault?.failBeforePrivateWrite) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        'Simulated failure before private variant promotion.',
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: 'Simulated failure before private variant promotion.',
        intakeId,
        sessionStatus: session.status,
      });
    }

    // Process genuine WebP variants using Sharp native pipeline
    let variantProcessingResult: ProcessEditorialImageVariantsResult;
    try {
      variantProcessingResult = await processEditorialImageVariants({
        assetId: rawInput.assetId,
        binary: binaryBuffer,
        claimedMimeType: rawInput.claimedMimeType,
        claimedFilenameOrExtension: rawInput.claimedFilenameOrExtension,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Editorial image variant processing failed.';
      const rejectionCode =
        err instanceof EditorialImageVariantProcessingError
          ? err.rejectionCode
          : undefined;
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'BINARY_REJECTED',
        msg,
        Boolean(fault?.failDuringRollbackCleanup),
        rejectionCode
      );
      throw new EditorialBinaryIntakeError({
        code: 'BINARY_REJECTED',
        message: msg,
        intakeId,
        sessionStatus: session.status,
        rejectionCode,
      });
    }

    // Transition to Promoting and write private variant objects with create-if-absent
    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'Promoting',
        updatedAt: this.clock(),
      },
      session.revision
    );

    const createdPrivateObjects: TrackedIntakeStorageObject[] = [];
    const variantsMap: Record<string, EditorialImageAssetVariant> = {};

    for (
      let i = 0;
      i < variantProcessingResult.variants.length;
      i += 1
    ) {
      if (
        typeof fault?.failDuringPrivateWriteAfterCount === 'number' &&
        i >= fault.failDuringPrivateWriteAfterCount
      ) {
        session = await this.sessionStore.updateSession(
          {
            ...session,
            updatedAt: this.clock(),
            createdPrivateObjects,
          },
          session.revision
        );
        session = await this.rollbackUnregisteredIntakeSession(
          session,
          'STORAGE_FAILURE',
          `Simulated failure during private variant promotion after ${i} variant(s).`,
          Boolean(fault?.failDuringRollbackCleanup)
        );
        throw new EditorialBinaryIntakeError({
          code: 'STORAGE_FAILURE',
          message: `Simulated failure during private variant promotion after ${i} variant(s).`,
          intakeId,
          sessionStatus: session.status,
        });
      }

      const variant = variantProcessingResult.variants[i];
      const privatePath = variant.storagePath;

      let privateWrite: StorageWriteIfAbsentOutcome;
      try {
        privateWrite = await this.storage.writeIfAbsent({
          storagePath: privatePath,
          bytes: variant.bytes,
          contentType: variant.mimeType,
          sha256Checksum: variant.sha256Checksum,
          ownership: {
            createdByIntakeId: intakeId,
            targetKind: 'editorial_image_asset',
            namespace: 'private',
            assetId: rawInput.assetId,
            uploaderUid: admin.id,
          },
        });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : `Failed writing private variant "${variant.variantKey}".`;
        session = await this.sessionStore.updateSession(
          {
            ...session,
            updatedAt: this.clock(),
            createdPrivateObjects,
          },
          session.revision
        );
        session = await this.rollbackUnregisteredIntakeSession(
          session,
          'STORAGE_FAILURE',
          msg,
          Boolean(fault?.failDuringRollbackCleanup)
        );
        throw new EditorialBinaryIntakeError({
          code: 'STORAGE_FAILURE',
          message: msg,
          intakeId,
          sessionStatus: session.status,
        });
      }

      if (!privateWrite.created) {
        // Object already exists at deterministic path (owned by another intake or pre-existing asset).
        // Do NOT add to createdPrivateObjects so rollback never deletes the pre-existing object!
        session = await this.sessionStore.updateSession(
          {
            ...session,
            updatedAt: this.clock(),
            createdPrivateObjects,
          },
          session.revision
        );
        session = await this.rollbackUnregisteredIntakeSession(
          session,
          'STORAGE_CONFLICT',
          `Private storage path "${privatePath}" already exists (created by intake "${privateWrite.existingMetadata.ownership.createdByIntakeId}").`,
          Boolean(fault?.failDuringRollbackCleanup)
        );
        throw new EditorialBinaryIntakeError({
          code: 'STORAGE_CONFLICT',
          message: `Private storage path "${privatePath}" already exists.`,
          intakeId,
          sessionStatus: session.status,
        });
      }

      createdPrivateObjects.push({
        storagePath: privateWrite.metadata.storagePath,
        namespace: 'private',
        generation: privateWrite.metadata.generation,
        etag: privateWrite.metadata.etag,
        sha256Checksum: privateWrite.metadata.sha256Checksum,
        sizeBytes: privateWrite.metadata.sizeBytes,
        contentType: privateWrite.metadata.contentType,
        createdByIntakeId: intakeId,
      });

      variantsMap[variant.variantKey] = {
        variantKey: variant.variantKey,
        storagePath: privatePath,
        width: variant.width,
        height: variant.height,
        sizeBytes: variant.sizeBytes,
        mimeType: variant.mimeType,
        sha256Checksum: variant.sha256Checksum,
      };
    }

    session = await this.sessionStore.updateSession(
      {
        ...session,
        updatedAt: this.clock(),
        createdPrivateObjects,
      },
      session.revision
    );

    // Build and validate the canonical EditorialImageAssetMetadata before attempting registration
    let candidateAssetRecord: EditorialImageAssetMetadata;
    try {
      const createdAtIso = this.clock();
      candidateAssetRecord = createEditorialImageAssetRecord(
        {
          assetId: rawInput.assetId,
          createdByUid: admin.id,
          origin: rawInput.origin,
          originalFilename: rawInput.originalFilename,
          mimeType: inspection.detectedMimeType,
          originalSizeBytes: inspection.sizeBytes,
          originalWidth: inspection.width,
          originalHeight: inspection.height,
          sha256Checksum: inspection.sha256Checksum,
          variants: variantsMap,
          altAr: rawInput.altAr,
          altEn: rawInput.altEn,
          captionAr: rawInput.captionAr,
          captionEn: rawInput.captionEn,
          photographerCredit: rawInput.photographerCredit,
          licensingInfo: rawInput.licensingInfo,
          tags: rawInput.tags ? [...rawInput.tags] : undefined,
          associatedArticleIds: rawInput.associatedArticleIds
            ? [...rawInput.associatedArticleIds]
            : undefined,
          createdAtIso,
          updatedAtIso: createdAtIso,
        },
        this.limits
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Canonical asset metadata validation failed.';
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'INVALID_INPUT',
        msg,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: msg,
        intakeId,
        sessionStatus: session.status,
      });
    }

    if (fault?.failBeforeCanonicalRegistration) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'REGISTRATION_FAILURE',
        'Simulated failure before canonical asset registration.',
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'REGISTRATION_FAILURE',
        message: 'Simulated failure before canonical asset registration.',
        intakeId,
        sessionStatus: session.status,
      });
    }

    // Transition to Registering
    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'Registering',
        updatedAt: this.clock(),
        canonicalRegistrationAttempted: true,
      },
      session.revision
    );

    let registeredAssetEnvelope: EditorialImageAssetRepositoryRecord;
    try {
      registeredAssetEnvelope =
        await this.assetRepo.createIfAbsent(candidateAssetRecord);
      if (this.onAssetRegisteredHook) {
        await this.onAssetRegisteredHook(registeredAssetEnvelope);
      }

      if (fault?.failAfterCanonicalRegistrationUnknownOutcome) {
        throw new Error(
          'Simulated lost commit response after canonical asset registration.'
        );
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Canonical asset registration failed.';

      // Because registration was attempted, we MUST read back canonical state before touching private objects!
      const readBack = await this.assetRepo
        .getById(rawInput.assetId)
        .catch(() => null);

      if (
        readBack &&
        readBack.status === 'FOUND' &&
        readBack.record.asset.sha256Checksum === inspection.sha256Checksum &&
        readBack.record.asset.createdByUid === admin.id
      ) {
        // The commit actually succeeded despite the error/timeout!
        // Preserve private objects; transition to NeedsReconciliation so reconcileIntake can finalize cleanly.
        session = await this.sessionStore.updateSession(
          {
            ...session,
            status: 'NeedsReconciliation',
            updatedAt: this.clock(),
            canonicalRegistrationSucceeded: true,
            registrationOutcomeUnknown: true,
            pendingCleanupObjects: session.createdQuarantineObjects,
            lastErrorCode: 'RECONCILIATION_REQUIRED',
            lastErrorMessage: msg,
          },
          session.revision
        );
        throw new EditorialBinaryIntakeError({
          code: 'RECONCILIATION_REQUIRED',
          message: `Canonical asset registration committed, but post-commit acknowledgement was interrupted: ${msg}`,
          intakeId,
          sessionStatus: session.status,
        });
      }

      if (readBack === null) {
        // Read-back itself failed; outcome is unknown -> DO NOT delete private objects yet!
        session = await this.sessionStore.updateSession(
          {
            ...session,
            status: 'NeedsReconciliation',
            updatedAt: this.clock(),
            registrationOutcomeUnknown: true,
            lastErrorCode: 'RECONCILIATION_REQUIRED',
            lastErrorMessage: msg,
          },
          session.revision
        );
        throw new EditorialBinaryIntakeError({
          code: 'RECONCILIATION_REQUIRED',
          message: `Canonical registration outcome is unknown; reconciliation is required before private cleanup: ${msg}`,
          intakeId,
          sessionStatus: session.status,
        });
      }

      // Read-back confirmed canonical registration did NOT commit for this intake -> safe to roll back our private & quarantine objects
      const errCode: EditorialBinaryIntakeErrorCode =
        readBack.status === 'FOUND'
          ? 'ASSET_ALREADY_EXISTS'
          : 'REGISTRATION_FAILURE';
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        errCode,
        msg,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: errCode,
        message: msg,
        intakeId,
        sessionStatus: session.status,
      });
    }

    // Registration confirmed -> transition to Registered
    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'Registered',
        updatedAt: this.clock(),
        canonicalRegistrationSucceeded: true,
        registrationOutcomeUnknown: false,
      },
      session.revision
    );

    // Clean up only the quarantine object(s)
    const quarantineCleanup = await this.cleanupTrackedObjects(
      intakeId,
      session.createdQuarantineObjects,
      Boolean(fault?.failDuringQuarantineCleanup)
    );

    const finalStatus: 'Completed' | 'CleanupPending' =
      quarantineCleanup.remaining.length === 0 ? 'Completed' : 'CleanupPending';

    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: finalStatus,
        updatedAt: this.clock(),
        pendingCleanupObjects: quarantineCleanup.remaining,
        lastErrorCode:
          finalStatus === 'CleanupPending' ? 'CLEANUP_INCOMPLETE' : undefined,
        lastErrorMessage:
          finalStatus === 'CleanupPending'
            ? 'Canonical asset registered, but quarantine object cleanup is still pending.'
            : undefined,
      },
      session.revision
    );

    return {
      intakeId,
      sessionStatus: finalStatus,
      binaryInspectionStatus: 'PRELIMINARY_VERIFIED',
      fullPixelDecodePerformed: true,
      reencodedOrStripped: true,
      provisionalIdenticalVariants: false,
      assetRecord: registeredAssetEnvelope,
      inspection,
    };
  }

  /**
   * Executes the recoverable intake saga for a confidential rights-evidence binary:
   * 1. Authenticates human caller via AdminRepository with `ManageRights` permission.
   * 2. Validates `intakeId`, `assetId`, and `evidenceId`, rejecting any spoofed server fields.
   * 3. Persists `Created` session with immutable ownership binding `{intakeId, assetId, evidenceId, uploaderUid}`.
   * 4. Runs preliminary binary inspection (`inspectRightsEvidenceBinary`) including PDF heuristic active-content screening.
   * 5. Stages raw bytes into quarantine namespace (`Quarantined` -> `PreliminarilyVerified`).
   * 6. Promotes binary into confidential private storage (`editorial_rights_evidence/private/{assetId}/{evidenceId}/artifact.{ext}`)
   *    using `writeIfAbsent` (`Promoting`).
   * 7. Registers the canonical `EditorialImageRightsEvidenceRecord` via `EditorialRightsEvidenceRegistrationBridge.registerRightsEvidence`
   *    binding the server-computed `artifactSha256` (`Registering` -> `Registered`).
   * 8. Cleans up the quarantine object and finalizes as `Completed` (or `CleanupPending`), without exposing internal storage paths.
   */
  async ingestRightsEvidenceBinary(
    requestContext: CallableRequestContext,
    rawInput: IngestRightsEvidenceBinaryInput
  ): Promise<RightsEvidenceBinaryIntakeResult> {
    const admin = await this.authenticateHumanCaller(
      requestContext,
      'rights_evidence_binary'
    );
    this.assertNoUnexpectedKeys(
      rawInput,
      ALLOWED_EVIDENCE_INTAKE_INPUT_KEYS,
      'Rights evidence binary intake input'
    );

    const intakeId = validateIntakeId(rawInput.intakeId);
    const assetIdCheck = validateAssetId(rawInput.assetId, this.limits);
    if (!assetIdCheck.valid) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid assetId "${rawInput.assetId}".`,
        intakeId,
        details: assetIdCheck.errors,
      });
    }

    const evIdCheck = validateEvidenceId(rawInput.evidenceId, this.limits);
    if (!evIdCheck.valid) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid evidenceId "${rawInput.evidenceId}".`,
        intakeId,
        details: evIdCheck.errors,
      });
    }

    if (
      !Buffer.isBuffer(rawInput.binary) &&
      !(rawInput.binary instanceof Uint8Array)
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'binary must be a Buffer or Uint8Array.',
        intakeId,
      });
    }

    const binaryBuffer = Buffer.isBuffer(rawInput.binary)
      ? Buffer.from(rawInput.binary)
      : Buffer.from(
          rawInput.binary.buffer,
          rawInput.binary.byteOffset,
          rawInput.binary.byteLength
        );

    const rawSha256 =
      binaryBuffer.length > 0 ? computeSha256Hex(binaryBuffer) : 'empty';
    const requestFingerprint = this.computeEvidenceIntakeFingerprint(
      rawInput,
      admin.id,
      rawSha256
    );

    const nowIso = this.clock();
    const initialSession: EditorialBinaryIntakeSession = {
      intakeId,
      targetKind: 'rights_evidence_binary',
      assetId: rawInput.assetId,
      evidenceId: rawInput.evidenceId,
      uploaderUid: admin.id,
      uploaderRole: admin.role,
      requestFingerprint,
      status: 'Created',
      revision: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: this.computeExpiresAtIso(nowIso),
      createdQuarantineObjects: [],
      createdPrivateObjects: [],
      pendingCleanupObjects: [],
      canonicalRegistrationAttempted: false,
      canonicalRegistrationSucceeded: false,
      registrationOutcomeUnknown: false,
    };

    const sessionCreation =
      await this.sessionStore.createSessionIfAbsent(initialSession);
    if (!sessionCreation.created) {
      this.verifyExistingSessionOwnershipAndBinding(sessionCreation.session, {
        intakeId,
        targetKind: 'rights_evidence_binary',
        assetId: rawInput.assetId,
        evidenceId: rawInput.evidenceId,
        uploaderUid: admin.id,
        requestFingerprint,
      });
      throw new EditorialBinaryIntakeError({
        code: 'INTAKE_ID_CONFLICT',
        message: `Intake session "${intakeId}" already exists with status "${sessionCreation.session.status}". Use reconcileIntake("${intakeId}") to inspect or recover an existing session.`,
        intakeId,
        sessionStatus: sessionCreation.session.status,
      });
    }

    let session = sessionCreation.session;
    const fault = this.consumeFault();

    // Verify target asset exists before staging confidential evidence binary
    const targetAsset = await this.assetRepo.getById(rawInput.assetId);
    if (targetAsset.status !== 'FOUND') {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'NOT_FOUND',
        `Target editorial image asset "${rawInput.assetId}" was not found.`,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'NOT_FOUND',
        message: `Target editorial image asset "${rawInput.assetId}" was not found.`,
        intakeId,
        sessionStatus: session.status,
      });
    }

    // Check if evidenceId is already registered before writing private storage
    if (this.evidenceLookup) {
      const existingEv = await this.evidenceLookup(rawInput.evidenceId);
      if (existingEv) {
        session = await this.rollbackUnregisteredIntakeSession(
          session,
          'EVIDENCE_ALREADY_EXISTS',
          `Rights evidence record "${rawInput.evidenceId}" already exists.`,
          Boolean(fault?.failDuringRollbackCleanup)
        );
        throw new EditorialBinaryIntakeError({
          code: 'EVIDENCE_ALREADY_EXISTS',
          message: `Rights evidence record "${rawInput.evidenceId}" already exists.`,
          intakeId,
          sessionStatus: session.status,
        });
      }
    }

    if (fault?.failBeforeQuarantineWrite) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        'Simulated failure before quarantine evidence write.',
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: 'Simulated failure before quarantine evidence write.',
        intakeId,
        sessionStatus: session.status,
      });
    }

    const inspection = inspectRightsEvidenceBinary(binaryBuffer, {
      claimedMimeType: rawInput.claimedMimeType,
      claimedFilenameOrExtension: rawInput.claimedFilenameOrExtension,
      policy: this.inspectionPolicy,
    });

    if (inspection.status === 'REJECTED') {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'BINARY_REJECTED',
        inspection.rejectionReason,
        Boolean(fault?.failDuringRollbackCleanup),
        inspection.rejectionCode
      );
      throw new EditorialBinaryIntakeError({
        code: 'BINARY_REJECTED',
        message: inspection.rejectionReason,
        intakeId,
        sessionStatus: session.status,
        rejectionCode: inspection.rejectionCode,
      });
    }

    const quarantinePath = buildQuarantineEvidenceStoragePath(
      intakeId,
      inspection.canonicalExtension
    );

    let quarantineWrite: StorageWriteIfAbsentOutcome;
    try {
      quarantineWrite = await this.storage.writeIfAbsent({
        storagePath: quarantinePath,
        bytes: binaryBuffer,
        contentType: inspection.detectedMimeType,
        sha256Checksum: inspection.sha256Checksum,
        ownership: {
          createdByIntakeId: intakeId,
          targetKind: 'rights_evidence_binary',
          namespace: 'quarantine',
          assetId: rawInput.assetId,
          evidenceId: rawInput.evidenceId,
          uploaderUid: admin.id,
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Quarantine evidence storage write failed.';
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        msg,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: msg,
        intakeId,
        sessionStatus: session.status,
      });
    }

    if (!quarantineWrite.created) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_CONFLICT',
        `Quarantine evidence storage path "${quarantinePath}" already exists.`,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_CONFLICT',
        message: `Quarantine evidence storage path "${quarantinePath}" already exists.`,
        intakeId,
        sessionStatus: session.status,
      });
    }

    const trackedQuarantineObj: TrackedIntakeStorageObject = {
      storagePath: quarantineWrite.metadata.storagePath,
      namespace: 'quarantine',
      generation: quarantineWrite.metadata.generation,
      etag: quarantineWrite.metadata.etag,
      sha256Checksum: quarantineWrite.metadata.sha256Checksum,
      sizeBytes: quarantineWrite.metadata.sizeBytes,
      contentType: quarantineWrite.metadata.contentType,
      createdByIntakeId: intakeId,
    };

    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'Quarantined',
        updatedAt: this.clock(),
        createdQuarantineObjects: [trackedQuarantineObj],
      },
      session.revision
    );

    if (fault?.failAfterQuarantineWrite) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        'Simulated failure after quarantine evidence write.',
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: 'Simulated failure after quarantine evidence write.',
        intakeId,
        sessionStatus: session.status,
      });
    }

    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'PreliminarilyVerified',
        updatedAt: this.clock(),
        binarySha256: inspection.sha256Checksum,
        detectedMimeType: inspection.detectedMimeType,
        binarySizeBytes: inspection.sizeBytes,
        width: inspection.width,
        height: inspection.height,
        aspectRatio: inspection.aspectRatio,
      },
      session.revision
    );

    if (fault?.failBeforePrivateWrite) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        'Simulated failure before private evidence write.',
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: 'Simulated failure before private evidence write.',
        intakeId,
        sessionStatus: session.status,
      });
    }

    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'Promoting',
        updatedAt: this.clock(),
      },
      session.revision
    );

    const privateEvidencePath = buildPrivateRightsEvidenceStoragePath(
      rawInput.assetId,
      rawInput.evidenceId,
      inspection.canonicalExtension,
      this.limits
    );

    let privateWrite: StorageWriteIfAbsentOutcome;
    try {
      privateWrite = await this.storage.writeIfAbsent({
        storagePath: privateEvidencePath,
        bytes: binaryBuffer,
        contentType: inspection.detectedMimeType,
        sha256Checksum: inspection.sha256Checksum,
        ownership: {
          createdByIntakeId: intakeId,
          targetKind: 'rights_evidence_binary',
          namespace: 'private',
          assetId: rawInput.assetId,
          evidenceId: rawInput.evidenceId,
          uploaderUid: admin.id,
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Private evidence storage write failed.';
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_FAILURE',
        msg,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: msg,
        intakeId,
        sessionStatus: session.status,
      });
    }

    if (!privateWrite.created) {
      // Do NOT add pre-existing object to createdPrivateObjects so rollback never deletes it!
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'STORAGE_CONFLICT',
        `Confidential evidence storage path "${privateEvidencePath}" already exists.`,
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_CONFLICT',
        message: `Confidential evidence storage path "${privateEvidencePath}" already exists.`,
        intakeId,
        sessionStatus: session.status,
      });
    }

    const trackedPrivateObj: TrackedIntakeStorageObject = {
      storagePath: privateWrite.metadata.storagePath,
      namespace: 'private',
      generation: privateWrite.metadata.generation,
      etag: privateWrite.metadata.etag,
      sha256Checksum: privateWrite.metadata.sha256Checksum,
      sizeBytes: privateWrite.metadata.sizeBytes,
      contentType: privateWrite.metadata.contentType,
      createdByIntakeId: intakeId,
    };

    session = await this.sessionStore.updateSession(
      {
        ...session,
        updatedAt: this.clock(),
        createdPrivateObjects: [trackedPrivateObj],
      },
      session.revision
    );

    if (fault?.failBeforeCanonicalRegistration) {
      session = await this.rollbackUnregisteredIntakeSession(
        session,
        'REGISTRATION_FAILURE',
        'Simulated failure before canonical evidence registration.',
        Boolean(fault?.failDuringRollbackCleanup)
      );
      throw new EditorialBinaryIntakeError({
        code: 'REGISTRATION_FAILURE',
        message: 'Simulated failure before canonical evidence registration.',
        intakeId,
        sessionStatus: session.status,
      });
    }

    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'Registering',
        updatedAt: this.clock(),
        canonicalRegistrationAttempted: true,
      },
      session.revision
    );

    const registerInput: RegisterEditorialImageRightsEvidenceInput = {
      evidenceId: rawInput.evidenceId,
      assetId: rawInput.assetId,
      sourceKind: rawInput.sourceKind,
      sourceReference: rawInput.sourceReference,
      summary: rawInput.summary,
      artifactSha256: inspection.sha256Checksum,
    };

    let evidenceRecord: EditorialImageRightsEvidenceRecord;
    try {
      evidenceRecord = await this.rightsEvidenceBridge.registerRightsEvidence(
        requestContext,
        registerInput
      );

      if (fault?.failAfterCanonicalRegistrationUnknownOutcome) {
        throw new Error(
          'Simulated lost commit response after canonical evidence registration.'
        );
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Canonical evidence registration failed.';

      if (this.evidenceLookup) {
        const persistedEv = await this.evidenceLookup(
          rawInput.evidenceId
        ).catch(() => undefined);

        if (
          persistedEv &&
          persistedEv.assetId === rawInput.assetId &&
          persistedEv.artifactSha256 === inspection.sha256Checksum &&
          persistedEv.recordedByUid === admin.id
        ) {
          // Evidence registration actually committed! Preserve private object; mark for reconciliation.
          session = await this.sessionStore.updateSession(
            {
              ...session,
              status: 'NeedsReconciliation',
              updatedAt: this.clock(),
              canonicalRegistrationSucceeded: true,
              registrationOutcomeUnknown: true,
              pendingCleanupObjects: session.createdQuarantineObjects,
              lastErrorCode: 'RECONCILIATION_REQUIRED',
              lastErrorMessage: msg,
            },
            session.revision
          );
          throw new EditorialBinaryIntakeError({
            code: 'RECONCILIATION_REQUIRED',
            message: `Canonical evidence registration committed, but post-commit acknowledgement was interrupted: ${msg}`,
            intakeId,
            sessionStatus: session.status,
          });
        }

        if (persistedEv === undefined) {
          // Read-back itself failed -> outcome unknown, preserve private object
          session = await this.sessionStore.updateSession(
            {
              ...session,
              status: 'NeedsReconciliation',
              updatedAt: this.clock(),
              registrationOutcomeUnknown: true,
              lastErrorCode: 'RECONCILIATION_REQUIRED',
              lastErrorMessage: msg,
            },
            session.revision
          );
          throw new EditorialBinaryIntakeError({
            code: 'RECONCILIATION_REQUIRED',
            message: `Canonical evidence registration outcome is unknown; reconciliation is required: ${msg}`,
            intakeId,
            sessionStatus: session.status,
          });
        }

        // Persisted evidence is null or belongs to a different record -> safe to roll back our private & quarantine objects
        const errCode: EditorialBinaryIntakeErrorCode = persistedEv
          ? 'EVIDENCE_ALREADY_EXISTS'
          : 'REGISTRATION_FAILURE';
        session = await this.rollbackUnregisteredIntakeSession(
          session,
          errCode,
          msg,
          Boolean(fault?.failDuringRollbackCleanup)
        );
        throw new EditorialBinaryIntakeError({
          code: errCode,
          message: msg,
          intakeId,
          sessionStatus: session.status,
        });
      }

      // If no evidenceLookup is configured, treat post-attempt failure conservatively as NeedsReconciliation
      session = await this.sessionStore.updateSession(
        {
          ...session,
          status: 'NeedsReconciliation',
          updatedAt: this.clock(),
          registrationOutcomeUnknown: true,
          lastErrorCode: 'RECONCILIATION_REQUIRED',
          lastErrorMessage: msg,
        },
        session.revision
      );
      throw new EditorialBinaryIntakeError({
        code: 'RECONCILIATION_REQUIRED',
        message: msg,
        intakeId,
        sessionStatus: session.status,
      });
    }

    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: 'Registered',
        updatedAt: this.clock(),
        canonicalRegistrationSucceeded: true,
        registrationOutcomeUnknown: false,
      },
      session.revision
    );

    const quarantineCleanup = await this.cleanupTrackedObjects(
      intakeId,
      session.createdQuarantineObjects,
      Boolean(fault?.failDuringQuarantineCleanup)
    );

    const finalStatus: 'Completed' | 'CleanupPending' =
      quarantineCleanup.remaining.length === 0 ? 'Completed' : 'CleanupPending';

    session = await this.sessionStore.updateSession(
      {
        ...session,
        status: finalStatus,
        updatedAt: this.clock(),
        pendingCleanupObjects: quarantineCleanup.remaining,
        lastErrorCode:
          finalStatus === 'CleanupPending' ? 'CLEANUP_INCOMPLETE' : undefined,
        lastErrorMessage:
          finalStatus === 'CleanupPending'
            ? 'Canonical evidence registered, but quarantine object cleanup is still pending.'
            : undefined,
      },
      session.revision
    );

    return {
      intakeId,
      sessionStatus: finalStatus,
      binaryInspectionStatus: 'PRELIMINARY_VERIFIED',
      binaryPreliminarilyInspected: true,
      metadataEvidenceRegistered: true,
      fullSanitizationPerformed: false,
      heuristicPdfScreening: inspection.heuristicPdfScreening,
      evidenceRecord,
      inspection,
    };
  }

  /**
   * Reconciles a single intake session by reading back canonical state first
   * (if registration was attempted or is in doubt), preserving private objects
   * when canonical registration succeeded, or rolling back owned private and
   * quarantine objects (by generation) when canonical registration did not commit.
   *
   * Strictly idempotent across repeated invocations.
   */
  async reconcileIntake(intakeId: string): Promise<ReconcileIntakeOutcome> {
    const validIntakeId = validateIntakeId(intakeId);
    const session = await this.sessionStore.getSessionById(validIntakeId);
    if (!session) {
      throw new EditorialBinaryIntakeError({
        code: 'NOT_FOUND',
        message: `Intake session "${validIntakeId}" was not found.`,
        intakeId: validIntakeId,
      });
    }

    const previousStatus = session.status;

    if (
      session.status === 'Completed' ||
      (session.status === 'Failed' &&
        session.pendingCleanupObjects.length === 0)
    ) {
      return {
        intakeId: validIntakeId,
        previousStatus,
        currentStatus: session.status,
        canonicalRegistrationVerified: session.canonicalRegistrationSucceeded,
        deletedObjectsCount: 0,
        remainingCleanupObjectsCount: 0,
        session,
      };
    }

    const fault = this.consumeFault();

    // Determine whether canonical registration actually committed in the repository
    let canonicalVerified = session.canonicalRegistrationSucceeded;

    if (
      !canonicalVerified &&
      (session.canonicalRegistrationAttempted ||
        session.registrationOutcomeUnknown ||
        session.status === 'Registering' ||
        session.status === 'NeedsReconciliation')
    ) {
      if (session.targetKind === 'editorial_image_asset') {
        const assetRead = await this.assetRepo.getById(session.assetId);
        if (
          assetRead.status === 'FOUND' &&
          assetRead.record.asset.sha256Checksum === session.binarySha256 &&
          assetRead.record.asset.createdByUid === session.uploaderUid
        ) {
          canonicalVerified = true;
        }
      } else if (
        session.targetKind === 'rights_evidence_binary' &&
        session.evidenceId &&
        this.evidenceLookup
      ) {
        const evRead = await this.evidenceLookup(session.evidenceId);
        if (
          evRead &&
          evRead.assetId === session.assetId &&
          evRead.artifactSha256 === session.binarySha256 &&
          evRead.recordedByUid === session.uploaderUid
        ) {
          canonicalVerified = true;
        }
      }
    }

    if (canonicalVerified) {
      // Canonical registration SUCCEEDED!
      // NEVER delete private objects; only clean up quarantine objects.
      const quarantineToClean =
        session.pendingCleanupObjects.length > 0
          ? session.pendingCleanupObjects.filter(
              (o) => o.namespace === 'quarantine'
            )
          : session.createdQuarantineObjects;

      const cleanup = await this.cleanupTrackedObjects(
        validIntakeId,
        quarantineToClean,
        Boolean(fault?.failDuringQuarantineCleanup)
      );

      const nextStatus: EditorialBinaryIntakeSessionStatus =
        cleanup.remaining.length === 0 ? 'Completed' : 'CleanupPending';

      const updated = await this.sessionStore.updateSession(
        {
          ...session,
          status: nextStatus,
          updatedAt: this.clock(),
          canonicalRegistrationSucceeded: true,
          registrationOutcomeUnknown: false,
          pendingCleanupObjects: cleanup.remaining,
          lastErrorCode:
            nextStatus === 'Completed' ? undefined : 'CLEANUP_INCOMPLETE',
          lastErrorMessage:
            nextStatus === 'Completed'
              ? undefined
              : 'Quarantine cleanup remains pending after reconciliation.',
        },
        session.revision
      );

      return {
        intakeId: validIntakeId,
        previousStatus,
        currentStatus: updated.status,
        canonicalRegistrationVerified: true,
        deletedObjectsCount: cleanup.deletedCount,
        remainingCleanupObjectsCount: cleanup.remaining.length,
        session: updated,
      };
    }

    // Canonical registration did NOT succeed -> clean up both private and quarantine objects created by this intake
    const objectsToClean: readonly TrackedIntakeStorageObject[] =
      session.pendingCleanupObjects.length > 0
        ? session.pendingCleanupObjects
        : [...session.createdPrivateObjects, ...session.createdQuarantineObjects];

    const cleanup = await this.cleanupTrackedObjects(
      validIntakeId,
      objectsToClean,
      Boolean(fault?.failDuringRollbackCleanup)
    );

    const nextStatus: EditorialBinaryIntakeSessionStatus =
      cleanup.remaining.length === 0 ? 'Failed' : 'CleanupPending';

    const updated = await this.sessionStore.updateSession(
      {
        ...session,
        status: nextStatus,
        updatedAt: this.clock(),
        canonicalRegistrationSucceeded: false,
        registrationOutcomeUnknown: false,
        pendingCleanupObjects: cleanup.remaining,
        lastErrorCode:
          nextStatus === 'Failed'
            ? (session.lastErrorCode ?? 'REGISTRATION_FAILURE')
            : 'CLEANUP_INCOMPLETE',
        lastErrorMessage:
          nextStatus === 'Failed'
            ? (session.lastErrorMessage ??
              'Session rolled back during reconciliation.')
            : 'Rollback cleanup remains pending after reconciliation.',
      },
      session.revision
    );

    return {
      intakeId: validIntakeId,
      previousStatus,
      currentStatus: updated.status,
      canonicalRegistrationVerified: false,
      deletedObjectsCount: cleanup.deletedCount,
      remainingCleanupObjectsCount: cleanup.remaining.length,
      session: updated,
    };
  }

  /**
   * Scans and reconciles all sessions requiring reconciliation or expired
   * incomplete sessions as of `nowIso`.
   */
  async reconcileExpiredIntakes(options?: {
    readonly nowIso?: string;
    readonly limit?: number;
  }): Promise<readonly ReconcileIntakeOutcome[]> {
    const candidates = await this.sessionStore.listSessionsForReconciliation({
      nowIso: options?.nowIso ?? this.clock(),
      limit: options?.limit,
    });

    const outcomes: ReconcileIntakeOutcome[] = [];
    for (const candidate of candidates) {
      const outcome = await this.reconcileIntake(candidate.intakeId);
      outcomes.push(outcome);
    }
    return Object.freeze(outcomes);
  }
}
