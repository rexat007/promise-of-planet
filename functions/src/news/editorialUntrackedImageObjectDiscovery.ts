import {
  type EditorialBinaryIntakeSession,
  EditorialBinaryIntakeError,
  type EditorialBinaryStorageAdapter,
  type EditorialBinaryStorageNamespace,
  type StorageObjectMetadata,
  type TrackedIntakeStorageObject,
  buildQuarantineImageStoragePath,
  validateIntakeId,
} from './editorialBinaryIntakeService';
import {
  CANONICAL_SHA256_CHECKSUM_REGEX,
  type EditorialImageAssetVariantKey,
} from '../types/editorialImageAsset';
import {
  buildEditorialImageVariantStoragePath,
  validateAssetId,
} from '../shared/editorialImageAssetContract';
import { validateAndParseCanonicalStoragePath } from './gcsEditorialBinaryStorageAdapter';

/**
 * IMG-F3-08A — Bounded Read-Only GCS Orphan Receipt Discovery
 *
 * SCOPE AND SAFETY INVARIANTS:
 * - Read-only helper: strictly queries GCS metadata for bounded deterministic paths.
 * - Zero GCS deletion, zero GCS writes, zero Firestore mutations.
 * - Strictly bounded: tests exactly 18 canonical candidate paths per invocation.
 * - Never lists entire buckets, pages through directories, or accepts user-supplied paths.
 * - Distinguishes already-tracked objects, untracked owned objects (receipt missed),
 *   and ownership/generation conflicts.
 * - Fail-closed: malformed metadata or read failures propagate errors immediately.
 * - This helper DOES NOT decide cleanup/deletion; that requires canonical registration
 *   read-back and generation-verified concurrency control in a subsequent phase.
 */

export const CANONICAL_QUARANTINE_IMAGE_EXTENSIONS = ['png', 'jpg', 'webp'] as const;

export const CANONICAL_IMAGE_VARIANT_KEYS: readonly EditorialImageAssetVariantKey[] = [
  'thumbnail',
  'card',
  'article_inline',
  'article_cover',
  'original_processed',
] as const;

export const CANONICAL_IMAGE_VARIANT_FORMATS = [
  'image/webp',
  'image/jpeg',
  'image/png',
] as const;

export const MAX_DISCOVERY_LOOKUP_BOUND = 18 as const;

export interface DiscoveredUntrackedStorageObject {
  readonly storagePath: string;
  readonly namespace: EditorialBinaryStorageNamespace;
  readonly generation: string;
  readonly etag: string;
  readonly sha256Checksum: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly createdByIntakeId: string;
  readonly assetId: string;
  readonly uploaderUid: string;
  readonly createdAtIso: string;
}

export interface DiscoveredTrackedStorageObject {
  readonly storagePath: string;
  readonly namespace: EditorialBinaryStorageNamespace;
  readonly generation: string;
  readonly etag: string;
  readonly sha256Checksum: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly trackedIn:
    | 'createdQuarantineObjects'
    | 'createdPrivateObjects'
    | 'pendingCleanupObjects';
}

export type DiscoveredConflictReason =
  | 'FOREIGN_OWNERSHIP'
  | 'GENERATION_MISMATCH'
  | 'NAMESPACE_MISMATCH'
  | 'TARGET_KIND_MISMATCH'
  | 'ASSET_ID_MISMATCH'
  | 'UPLOADER_MISMATCH';

export interface DiscoveredStorageObjectConflict {
  readonly storagePath: string;
  readonly conflictReason: DiscoveredConflictReason;
  readonly details: string;
  readonly existingGeneration: string;
  readonly recordedGeneration?: string;
}

export interface EditorialUntrackedImageObjectDiscoveryReport {
  readonly intakeId: string;
  readonly assetId: string;
  readonly totalLookupsAttempted: number;
  readonly candidatePathsChecked: readonly string[];
  readonly trackedObjects: readonly DiscoveredTrackedStorageObject[];
  readonly untrackedOwnedObjects: readonly DiscoveredUntrackedStorageObject[];
  readonly conflicts: readonly DiscoveredStorageObjectConflict[];
  readonly hasUntrackedOwnedObjects: boolean;
  readonly hasConflicts: boolean;
}

export type EditorialStorageMetadataReader = Pick<
  EditorialBinaryStorageAdapter,
  'readMetadata'
>;

/**
 * Derives the exact finite set of 18 candidate storage paths for an image intake session:
 * - 3 quarantine paths (source.png, source.jpg, source.webp)
 * - 15 private variant paths (5 keys x 3 formats)
 */
export function deriveCanonicalCandidateImageStoragePaths(
  intakeId: string,
  assetId: string
): readonly string[] {
  const validIntakeId = validateIntakeId(intakeId);
  const idValidation = validateAssetId(assetId);
  if (!idValidation.valid) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Invalid assetId for candidate path generation: ${idValidation.errors.join(' ')}`,
      intakeId: validIntakeId,
    });
  }

  const paths: string[] = [];

  // 1. Quarantine candidate paths (3)
  for (const ext of CANONICAL_QUARANTINE_IMAGE_EXTENSIONS) {
    paths.push(buildQuarantineImageStoragePath(validIntakeId, ext));
  }

  // 2. Private variant candidate paths (5 keys x 3 formats = 15)
  for (const variantKey of CANONICAL_IMAGE_VARIANT_KEYS) {
    for (const format of CANONICAL_IMAGE_VARIANT_FORMATS) {
      paths.push(
        buildEditorialImageVariantStoragePath(assetId, variantKey, format)
      );
    }
  }

  // Strictly enforce 18-lookup ceiling
  if (paths.length > MAX_DISCOVERY_LOOKUP_BOUND) {
    throw new EditorialBinaryIntakeError({
      code: 'STORAGE_FAILURE',
      message: `Candidate paths exceeded maximum lookup bound of ${MAX_DISCOVERY_LOOKUP_BOUND} (got ${paths.length}).`,
      intakeId: validIntakeId,
    });
  }

  return Object.freeze([...new Set(paths)]);
}

/**
 * Discovers untracked GCS objects belonging to an image intake session whose
 * write succeeded but whose generation receipt was not recorded in Firestore.
 *
 * Performs bounded, read-only metadata lookups over at most 18 canonical candidate paths.
 */
export async function discoverUntrackedEditorialImageObjects(
  session: EditorialBinaryIntakeSession,
  storageReader: EditorialStorageMetadataReader
): Promise<EditorialUntrackedImageObjectDiscoveryReport> {
  // 1. Session identity and contract validation
  if (!session || typeof session !== 'object') {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Intake session must be a non-null object.',
    });
  }

  if (session.targetKind !== 'editorial_image_asset') {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Image object discovery only supports targetKind "editorial_image_asset", received "${String(session.targetKind)}".`,
      intakeId: typeof session.intakeId === 'string' ? session.intakeId : undefined,
    });
  }

  const validIntakeId = validateIntakeId(session.intakeId);

  const assetIdValidation = validateAssetId(session.assetId);
  if (!assetIdValidation.valid) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Session assetId is invalid: ${assetIdValidation.errors.join(' ')}`,
      intakeId: validIntakeId,
    });
  }

  if (
    typeof session.uploaderUid !== 'string' ||
    session.uploaderUid.trim().length === 0
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session uploaderUid must be a non-empty string.',
      intakeId: validIntakeId,
    });
  }

  if (
    !storageReader ||
    typeof storageReader.readMetadata !== 'function'
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'STORAGE_FAILURE',
      message: 'Storage reader must provide a valid readMetadata function.',
      intakeId: validIntakeId,
    });
  }

  // 2. Generate finite candidate paths (bounded to 18)
  const candidatePaths = deriveCanonicalCandidateImageStoragePaths(
    validIntakeId,
    session.assetId
  );

  // 3. Index existing tracked session objects across all three lists
  const trackedByPath = new Map<
    string,
    {
      readonly tracked: TrackedIntakeStorageObject;
      readonly trackedIn:
        | 'createdQuarantineObjects'
        | 'createdPrivateObjects'
        | 'pendingCleanupObjects';
    }
  >();

  if (Array.isArray(session.createdQuarantineObjects)) {
    for (const obj of session.createdQuarantineObjects) {
      if (obj && typeof obj.storagePath === 'string') {
        trackedByPath.set(obj.storagePath, {
          tracked: obj,
          trackedIn: 'createdQuarantineObjects',
        });
      }
    }
  }

  if (Array.isArray(session.createdPrivateObjects)) {
    for (const obj of session.createdPrivateObjects) {
      if (obj && typeof obj.storagePath === 'string') {
        trackedByPath.set(obj.storagePath, {
          tracked: obj,
          trackedIn: 'createdPrivateObjects',
        });
      }
    }
  }

  if (Array.isArray(session.pendingCleanupObjects)) {
    for (const obj of session.pendingCleanupObjects) {
      if (obj && typeof obj.storagePath === 'string') {
        trackedByPath.set(obj.storagePath, {
          tracked: obj,
          trackedIn: 'pendingCleanupObjects',
        });
      }
    }
  }

  const trackedResults: DiscoveredTrackedStorageObject[] = [];
  const untrackedResults: DiscoveredUntrackedStorageObject[] = [];
  const conflicts: DiscoveredStorageObjectConflict[] = [];

  let lookupsAttempted = 0;

  // 4. Sequential bounded metadata inspection
  for (const candidatePath of candidatePaths) {
    lookupsAttempted += 1;

    let metadata: StorageObjectMetadata | null;
    try {
      metadata = await storageReader.readMetadata(candidatePath);
    } catch (err) {
      if (err instanceof EditorialBinaryIntakeError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Storage metadata read failed during discovery for "${candidatePath}": ${msg}`,
        intakeId: validIntakeId,
      });
    }

    // Object does not exist at this path
    if (metadata === null) {
      continue;
    }

    // Validate structural integrity of returned metadata
    if (!metadata || typeof metadata !== 'object') {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Corrupt metadata structure returned for "${candidatePath}".`,
        intakeId: validIntakeId,
      });
    }

    if (
      typeof metadata.generation !== 'string' ||
      metadata.generation.trim().length === 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Discovered object at "${candidatePath}" lacks a valid generation string.`,
        intakeId: validIntakeId,
      });
    }

    if (
      typeof metadata.sha256Checksum !== 'string' ||
      !CANONICAL_SHA256_CHECKSUM_REGEX.test(metadata.sha256Checksum)
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Discovered object at "${candidatePath}" has invalid sha256Checksum.`,
        intakeId: validIntakeId,
      });
    }

    if (
      typeof metadata.sizeBytes !== 'number' ||
      !Number.isSafeInteger(metadata.sizeBytes) ||
      metadata.sizeBytes <= 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Discovered object at "${candidatePath}" has invalid sizeBytes (${metadata.sizeBytes}).`,
        intakeId: validIntakeId,
      });
    }

    // Verify storage path conforms to canonical namespace rules
    const parsedPath = validateAndParseCanonicalStoragePath(metadata.storagePath);
    const expectedNamespace: EditorialBinaryStorageNamespace =
      candidatePath.startsWith('editorial_intake_quarantine/')
        ? 'quarantine'
        : 'private';

    if (parsedPath.namespace !== expectedNamespace) {
      conflicts.push(
        Object.freeze({
          storagePath: candidatePath,
          conflictReason: 'NAMESPACE_MISMATCH',
          details: `Object namespace "${parsedPath.namespace}" does not match expected "${expectedNamespace}".`,
          existingGeneration: metadata.generation,
        })
      );
      continue;
    }

    // Verify ownership metadata presence
    const ownership = metadata.ownership;
    if (!ownership || typeof ownership !== 'object') {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Discovered object at "${candidatePath}" lacks ownership metadata.`,
        intakeId: validIntakeId,
      });
    }

    // Ownership verification against session identity
    if (ownership.createdByIntakeId !== validIntakeId) {
      conflicts.push(
        Object.freeze({
          storagePath: candidatePath,
          conflictReason: 'FOREIGN_OWNERSHIP',
          details: `Object owned by intake "${ownership.createdByIntakeId}", not current session "${validIntakeId}".`,
          existingGeneration: metadata.generation,
        })
      );
      continue;
    }

    if (ownership.targetKind !== 'editorial_image_asset') {
      conflicts.push(
        Object.freeze({
          storagePath: candidatePath,
          conflictReason: 'TARGET_KIND_MISMATCH',
          details: `Object targetKind "${ownership.targetKind}" does not match session "editorial_image_asset".`,
          existingGeneration: metadata.generation,
        })
      );
      continue;
    }

    if (ownership.assetId !== session.assetId) {
      conflicts.push(
        Object.freeze({
          storagePath: candidatePath,
          conflictReason: 'ASSET_ID_MISMATCH',
          details: `Object assetId "${ownership.assetId}" does not match session assetId "${session.assetId}".`,
          existingGeneration: metadata.generation,
        })
      );
      continue;
    }

    if (ownership.uploaderUid !== session.uploaderUid) {
      conflicts.push(
        Object.freeze({
          storagePath: candidatePath,
          conflictReason: 'UPLOADER_MISMATCH',
          details: `Object uploaderUid "${ownership.uploaderUid}" does not match session uploaderUid "${session.uploaderUid}".`,
          existingGeneration: metadata.generation,
        })
      );
      continue;
    }

    // 5. Compare against session tracked lists
    const trackedEntry = trackedByPath.get(candidatePath);

    if (trackedEntry) {
      // Already tracked in session: verify generation consistency
      if (trackedEntry.tracked.generation !== metadata.generation) {
        conflicts.push(
          Object.freeze({
            storagePath: candidatePath,
            conflictReason: 'GENERATION_MISMATCH',
            details: `Tracked generation "${trackedEntry.tracked.generation}" differs from actual storage generation "${metadata.generation}".`,
            existingGeneration: metadata.generation,
            recordedGeneration: trackedEntry.tracked.generation,
          })
        );
      } else {
        trackedResults.push(
          Object.freeze({
            storagePath: candidatePath,
            namespace: expectedNamespace,
            generation: metadata.generation,
            etag: metadata.etag,
            sha256Checksum: metadata.sha256Checksum,
            sizeBytes: metadata.sizeBytes,
            contentType: metadata.contentType,
            trackedIn: trackedEntry.trackedIn,
          })
        );
      }
    } else {
      // Matching owned object not tracked in session (lost receipt discovered)
      untrackedResults.push(
        Object.freeze({
          storagePath: candidatePath,
          namespace: expectedNamespace,
          generation: metadata.generation,
          etag: metadata.etag,
          sha256Checksum: metadata.sha256Checksum,
          sizeBytes: metadata.sizeBytes,
          contentType: metadata.contentType,
          createdByIntakeId: ownership.createdByIntakeId,
          assetId: ownership.assetId,
          uploaderUid: ownership.uploaderUid,
          createdAtIso: metadata.createdAtIso,
        })
      );
    }
  }

  return Object.freeze({
    intakeId: validIntakeId,
    assetId: session.assetId,
    totalLookupsAttempted: lookupsAttempted,
    candidatePathsChecked: candidatePaths,
    trackedObjects: Object.freeze(trackedResults),
    untrackedOwnedObjects: Object.freeze(untrackedResults),
    conflicts: Object.freeze(conflicts),
    hasUntrackedOwnedObjects: untrackedResults.length > 0,
    hasConflicts: conflicts.length > 0,
  });
}
