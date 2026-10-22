import {
  type EditorialBinaryIntakeSession,
  type EditorialBinaryIntakeSessionStatus,
  EditorialBinaryIntakeError,
  type EditorialBinaryStorageAdapter,
  type IntakeSessionStore,
  type TrackedIntakeStorageObject,
  validateIntakeId,
} from './editorialBinaryIntakeService';
import {
  type EditorialImageAssetReadResult,
  type EditorialImageAssetRepository,
} from './editorialImageAssetRepository';
import {
  discoverUntrackedEditorialImageObjects,
  type EditorialUntrackedImageObjectDiscoveryReport,
} from './editorialUntrackedImageObjectDiscovery';
import { validateAssetId } from '../shared/editorialImageAssetContract';

/**
 * IMG-F3-08B — Bounded Read-Only Receipt Recovery Read-back & Decision Gate
 *
 * SCOPE AND READ-ONLY INVARIANTS:
 * - Read-only assessment: strictly queries session store, canonical asset repository,
 *   and GCS storage metadata.
 * - Zero GCS writes, zero GCS deletions, zero Firestore mutations.
 * - Strictly bounded: executes exactly one IMG-F3-08A discovery per invocation (<= 18 GCS lookups).
 * - Implements race detection: re-reads persisted session and canonical asset after discovery.
 *   Any observed concurrent revision/status/receipt change marks the observation as STALE.
 * - Canonical asset FOUND does not prove originating intakeId (preserves objects, avoids false clean).
 * - Canonical asset NOT_FOUND does not authorize deletion (observational reattachment candidate only).
 * - Terminal Failed/Completed sessions with untracked objects are placed on hold, never marked clean.
 * - Absolutely zero deletion instructions (shouldDelete/safeToDelete) are ever returned.
 * - requiresFreshAtomicVerification is always true.
 */

export type EditorialImageRecoveryClassification =
  | 'NO_OWNED_UNTRACKED_OBJECTS'
  | 'CONFLICT_HOLD'
  | 'CANONICAL_FOUND_PRESERVE_HOLD'
  | 'CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE'
  | 'TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD'
  | 'UNKNOWN_OR_STALE_HOLD';

export type CanonicalAssetObservationStatus =
  | 'FOUND'
  | 'NOT_FOUND'
  | 'READ_ERROR'
  | 'AMBIGUOUS';

export interface EditorialImageReceiptRecoveryAssessment {
  readonly intakeId: string;
  readonly assetId: string;
  readonly classification: EditorialImageRecoveryClassification;
  readonly reasonCode: string;
  readonly details: string;
  readonly sessionStatus: EditorialBinaryIntakeSessionStatus;
  readonly sessionRevision: number;
  readonly canonicalStatus: CanonicalAssetObservationStatus;
  readonly canonicalRevision?: number;
  readonly canonicalBinarySha256Matches?: boolean;
  readonly canonicalUploaderUidMatches?: boolean;
  readonly discoveryReport: EditorialUntrackedImageObjectDiscoveryReport;
  readonly totalLookupsAttempted: number;
  readonly hasUntrackedOwnedObjects: boolean;
  readonly hasConflicts: boolean;
  readonly untrackedOwnedCount: number;
  readonly trackedCount: number;
  readonly conflictCount: number;
  readonly requiresFreshAtomicVerification: true;
  readonly observedAtIso: string;
}

export type ReceiptRecoverySessionReader = Pick<IntakeSessionStore, 'getSessionById'>;
export type ReceiptRecoveryAssetReader = Pick<EditorialImageAssetRepository, 'getById'>;
export type ReceiptRecoveryStorageReader = Pick<EditorialBinaryStorageAdapter, 'readMetadata'>;

export interface EditorialImageReceiptRecoveryDependencies {
  readonly sessionStore: ReceiptRecoverySessionReader;
  readonly assetRepository: ReceiptRecoveryAssetReader;
  readonly storageReader: ReceiptRecoveryStorageReader;
}

function validateSessionIntegrity(
  session: EditorialBinaryIntakeSession,
  expectedIntakeId: string
): void {
  if (!session || typeof session !== 'object') {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Persisted session "${expectedIntakeId}" is not a valid object.`,
      intakeId: expectedIntakeId,
    });
  }

  if (session.intakeId !== expectedIntakeId) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Session intakeId "${session.intakeId}" does not match requested "${expectedIntakeId}".`,
      intakeId: expectedIntakeId,
    });
  }

  if (session.targetKind !== 'editorial_image_asset') {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Session targetKind "${session.targetKind}" is rejected for image receipt recovery readback (expected "editorial_image_asset").`,
      intakeId: expectedIntakeId,
    });
  }

  const assetIdValidation = validateAssetId(session.assetId);
  if (!assetIdValidation.valid) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Session assetId "${session.assetId}" is invalid: ${assetIdValidation.errors.join(' ')}`,
      intakeId: expectedIntakeId,
    });
  }

  if (
    typeof session.revision !== 'number' ||
    !Number.isSafeInteger(session.revision) ||
    session.revision < 1
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Session revision "${session.revision}" is not a valid positive integer.`,
      intakeId: expectedIntakeId,
    });
  }

  if (
    !Array.isArray(session.createdQuarantineObjects) ||
    !Array.isArray(session.createdPrivateObjects) ||
    !Array.isArray(session.pendingCleanupObjects)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Session "${expectedIntakeId}" contains malformed tracked object arrays.`,
      intakeId: expectedIntakeId,
    });
  }

  if (typeof session.uploaderUid !== 'string' || session.uploaderUid.trim().length === 0) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Session "${expectedIntakeId}" lacks a valid uploaderUid.`,
      intakeId: expectedIntakeId,
    });
  }

  if (typeof session.status !== 'string' || session.status.trim().length === 0) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Session "${expectedIntakeId}" lacks a valid status.`,
      intakeId: expectedIntakeId,
    });
  }
}

function areReceiptListsIdentical(
  a: readonly TrackedIntakeStorageObject[],
  b: readonly TrackedIntakeStorageObject[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (
      ra.storagePath !== rb.storagePath ||
      ra.generation !== rb.generation ||
      ra.namespace !== rb.namespace ||
      ra.etag !== rb.etag ||
      ra.sha256Checksum !== rb.sha256Checksum ||
      ra.sizeBytes !== rb.sizeBytes ||
      ra.contentType !== rb.contentType ||
      ra.createdByIntakeId !== rb.createdByIntakeId
    ) {
      return false;
    }
  }
  return true;
}

function detectConcurrentMutation(
  firstSession: EditorialBinaryIntakeSession,
  secondSession: EditorialBinaryIntakeSession | null,
  firstAssetResult: EditorialImageAssetReadResult | null,
  secondAssetResult: EditorialImageAssetReadResult | null
): { isStale: boolean; reason: string } {
  if (!secondSession) {
    return {
      isStale: true,
      reason: 'Session was deleted between read-back operations.',
    };
  }

  if (secondSession.revision !== firstSession.revision) {
    return {
      isStale: true,
      reason: `Session revision mutated from ${firstSession.revision} to ${secondSession.revision}.`,
    };
  }

  if (secondSession.status !== firstSession.status) {
    return {
      isStale: true,
      reason: `Session status mutated from "${firstSession.status}" to "${secondSession.status}".`,
    };
  }

  if (
    secondSession.intakeId !== firstSession.intakeId ||
    secondSession.assetId !== firstSession.assetId ||
    secondSession.uploaderUid !== firstSession.uploaderUid
  ) {
    return {
      isStale: true,
      reason: 'Session immutable identity fields changed between read-back operations.',
    };
  }

  if (
    !areReceiptListsIdentical(
      firstSession.createdQuarantineObjects,
      secondSession.createdQuarantineObjects
    ) ||
    !areReceiptListsIdentical(
      firstSession.createdPrivateObjects,
      secondSession.createdPrivateObjects
    ) ||
    !areReceiptListsIdentical(
      firstSession.pendingCleanupObjects,
      secondSession.pendingCleanupObjects
    )
  ) {
    return {
      isStale: true,
      reason: 'Session tracked receipt lists changed between read-back operations.',
    };
  }

  // Canonical asset comparison
  if (firstAssetResult && secondAssetResult) {
    if (firstAssetResult.status !== secondAssetResult.status) {
      return {
        isStale: true,
        reason: `Canonical asset status mutated from "${firstAssetResult.status}" to "${secondAssetResult.status}".`,
      };
    }
    if (firstAssetResult.status === 'FOUND' && secondAssetResult.status === 'FOUND') {
      if (firstAssetResult.revision !== secondAssetResult.revision) {
        return {
          isStale: true,
          reason: `Canonical asset revision mutated from ${firstAssetResult.revision} to ${secondAssetResult.revision}.`,
        };
      }
      if (
        firstAssetResult.asset.sha256Checksum !== secondAssetResult.asset.sha256Checksum
      ) {
        return {
          isStale: true,
          reason: 'Canonical asset checksum changed between read-back operations.',
        };
      }
    }
  }

  return { isStale: false, reason: '' };
}

/**
 * Inspects an image intake session for lost GCS receipts and returns a strictly
 * read-only assessment without mutating any storage object or Firestore session.
 */
export async function inspectEditorialImageReceiptRecovery(
  intakeId: string,
  deps: EditorialImageReceiptRecoveryDependencies
): Promise<EditorialImageReceiptRecoveryAssessment> {
  const validIntakeId = validateIntakeId(intakeId);

  if (!deps || !deps.sessionStore || !deps.assetRepository || !deps.storageReader) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Missing required read-only dependencies for recovery read-back.',
      intakeId: validIntakeId,
    });
  }

  // 1. Initial read of persisted session
  const initialSession = await deps.sessionStore.getSessionById(validIntakeId);
  if (!initialSession) {
    throw new EditorialBinaryIntakeError({
      code: 'NOT_FOUND',
      message: `Intake session "${validIntakeId}" not found.`,
      intakeId: validIntakeId,
    });
  }

  validateSessionIntegrity(initialSession, validIntakeId);

  // 2. Initial read of canonical image-asset repository
  let firstAssetResult: EditorialImageAssetReadResult | null = null;
  let firstAssetReadError: Error | null = null;
  try {
    firstAssetResult = await deps.assetRepository.getById(initialSession.assetId);
  } catch (err) {
    firstAssetReadError = err instanceof Error ? err : new Error(String(err));
  }

  // 3. Exactly one bounded GCS metadata discovery invocation
  const discoveryReport = await discoverUntrackedEditorialImageObjects(
    initialSession,
    deps.storageReader
  );

  // 4. Second read of session and canonical asset (race / staleness detection)
  let secondSession: EditorialBinaryIntakeSession | null = null;
  try {
    secondSession = await deps.sessionStore.getSessionById(validIntakeId);
  } catch (err) {
    throw new EditorialBinaryIntakeError({
      code: 'RECONCILIATION_REQUIRED',
      message: `Failed second session read-back during recovery inspection: ${err instanceof Error ? err.message : String(err)}`,
      intakeId: validIntakeId,
    });
  }

  let secondAssetResult: EditorialImageAssetReadResult | null = null;
  let secondAssetReadError: Error | null = null;
  try {
    secondAssetResult = await deps.assetRepository.getById(initialSession.assetId);
  } catch (err) {
    secondAssetReadError = err instanceof Error ? err : new Error(String(err));
  }

  // 5. Evaluate Staleness & Canonical Status
  const stalenessCheck = detectConcurrentMutation(
    initialSession,
    secondSession,
    firstAssetResult,
    secondAssetResult
  );

  let canonicalStatus: CanonicalAssetObservationStatus = 'NOT_FOUND';
  let canonicalRevision: number | undefined;
  let canonicalBinarySha256Matches: boolean | undefined;
  let canonicalUploaderUidMatches: boolean | undefined;
  let canonicalIdentityConflict: string | null = null;

  if (firstAssetReadError || secondAssetReadError) {
    canonicalStatus = 'READ_ERROR';
  } else if (firstAssetResult && firstAssetResult.status === 'FOUND') {
    canonicalStatus = 'FOUND';
    canonicalRevision = firstAssetResult.revision;
    const foundAsset = firstAssetResult.asset;

    canonicalUploaderUidMatches = foundAsset.createdByUid === initialSession.uploaderUid;
    if (initialSession.binarySha256 && foundAsset.sha256Checksum) {
      canonicalBinarySha256Matches = foundAsset.sha256Checksum === initialSession.binarySha256;
    }

    // Check identity consistency
    if (foundAsset.assetId !== initialSession.assetId) {
      canonicalIdentityConflict = `Canonical assetId "${foundAsset.assetId}" differs from session assetId "${initialSession.assetId}".`;
    } else if (!canonicalUploaderUidMatches) {
      canonicalIdentityConflict = `Canonical createdByUid "${foundAsset.createdByUid}" differs from session uploaderUid "${initialSession.uploaderUid}".`;
    } else if (
      initialSession.binarySha256 &&
      foundAsset.sha256Checksum &&
      !canonicalBinarySha256Matches
    ) {
      canonicalIdentityConflict = `Canonical sha256Checksum "${foundAsset.sha256Checksum}" differs from session binarySha256 "${initialSession.binarySha256}".`;
    }
  } else if (firstAssetResult && firstAssetResult.status === 'NOT_FOUND') {
    canonicalStatus = 'NOT_FOUND';
  } else {
    canonicalStatus = 'AMBIGUOUS';
  }

  // 6. Classification decision tree with strict precedence
  let classification: EditorialImageRecoveryClassification;
  let reasonCode: string;
  let details: string;

  const untrackedOwnedCount = discoveryReport.untrackedOwnedObjects.length;
  const trackedCount = discoveryReport.trackedObjects.length;
  const conflictCount = discoveryReport.conflicts.length;
  const isTerminalSession =
    initialSession.status === 'Failed' || initialSession.status === 'Completed';

  if (stalenessCheck.isStale) {
    classification = 'UNKNOWN_OR_STALE_HOLD';
    reasonCode = 'OBSERVED_CONCURRENT_MUTATION';
    details = stalenessCheck.reason;
  } else if (canonicalStatus === 'READ_ERROR' || canonicalStatus === 'AMBIGUOUS') {
    classification = 'UNKNOWN_OR_STALE_HOLD';
    reasonCode = 'CANONICAL_REPOSITORY_READ_ERROR';
    details = `Canonical image asset repository read failed or returned ambiguous state: ${firstAssetReadError?.message ?? secondAssetReadError?.message ?? 'Ambiguous response'}.`;
  } else if (canonicalIdentityConflict !== null) {
    classification = 'CONFLICT_HOLD';
    reasonCode = 'CANONICAL_ASSET_IDENTITY_CONFLICT';
    details = canonicalIdentityConflict;
  } else if (discoveryReport.hasConflicts) {
    classification = 'CONFLICT_HOLD';
    reasonCode = 'DISCOVERY_CONFLICT_DETECTED';
    details = `Discovery detected ${conflictCount} conflict(s) on storage candidates.`;
  } else if (isTerminalSession && untrackedOwnedCount > 0) {
    classification = 'TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD';
    reasonCode = 'TERMINAL_SESSION_HAS_UNTRACKED_OBJECTS';
    details = `Session is in terminal status "${initialSession.status}" but GCS contains ${untrackedOwnedCount} untracked owned object(s).`;
  } else if (canonicalStatus === 'FOUND') {
    classification = 'CANONICAL_FOUND_PRESERVE_HOLD';
    reasonCode = 'CANONICAL_ASSET_EXISTS_PRESERVE';
    details = `Canonical asset "${initialSession.assetId}" is registered in repository. Preserving objects; canonical registration does not prove intake association.`;
  } else if (untrackedOwnedCount > 0) {
    // Canonical is NOT_FOUND, non-terminal session, valid untracked owned objects discovered
    classification = 'CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE';
    reasonCode = 'UNTRACKED_OWNED_OBJECTS_DISCOVERED';
    details = `Canonical asset is NOT_FOUND and session has ${untrackedOwnedCount} untracked owned object(s); candidate for CAS receipt reattachment.`;
  } else {
    classification = 'NO_OWNED_UNTRACKED_OBJECTS';
    reasonCode = 'ZERO_UNTRACKED_OWNED_OBJECTS';
    details = 'No untracked owned objects discovered across candidate paths.';
  }

  const assessment: EditorialImageReceiptRecoveryAssessment = Object.freeze({
    intakeId: validIntakeId,
    assetId: initialSession.assetId,
    classification,
    reasonCode,
    details,
    sessionStatus: initialSession.status,
    sessionRevision: initialSession.revision,
    canonicalStatus,
    canonicalRevision,
    canonicalBinarySha256Matches,
    canonicalUploaderUidMatches,
    discoveryReport,
    totalLookupsAttempted: discoveryReport.totalLookupsAttempted,
    hasUntrackedOwnedObjects: untrackedOwnedCount > 0,
    hasConflicts: conflictCount > 0 || canonicalIdentityConflict !== null,
    untrackedOwnedCount,
    trackedCount,
    conflictCount,
    requiresFreshAtomicVerification: true,
    observedAtIso: new Date().toISOString(),
  });

  return assessment;
}
