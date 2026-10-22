import {
  type EditorialBinaryIntakeSession,
  type EditorialBinaryIntakeSessionStatus,
  EditorialBinaryIntakeError,
  type EditorialBinaryStorageAdapter,
  type IntakeSessionStore,
  type StorageObjectMetadata,
  type TrackedIntakeStorageObject,
  validateIntakeId,
} from './editorialBinaryIntakeService';
import {
  type EditorialImageAssetReadResult,
  type EditorialImageAssetRepository,
} from './editorialImageAssetRepository';
import {
  inspectEditorialImageReceiptRecovery,
  type EditorialImageReceiptRecoveryAssessment,
} from './editorialImageReceiptRecoveryReadback';
import { validateAssetId } from '../shared/editorialImageAssetContract';

/**
 * IMG-F3-08B/B2 — Safe Append-Only Receipt Reattachment
 *
 * SCOPE AND READ-ONLY/APPEND-ONLY INVARIANTS:
 * - Append-only recovery: appends verified GCS receipts to Firestore intake session.
 * - Zero GCS writes, zero GCS deletions, zero Firestore asset modifications.
 * - Never lists entire buckets, pages through directories, or accepts user-supplied paths.
 * - Enforces strict lookup budget: at most 36 GCS metadata queries per invocation
 *   (up to 18 B1 discovery lookups + up to 18 fresh verification lookups).
 * - Always runs a fresh B1 recovery assessment; never trusts caller-supplied state.
 * - Permitted session statuses: Created, Quarantined, PreliminarilyVerified (quarantine only),
 *   Promoting (quarantine + private). All other statuses HOLD.
 * - Re-reads session snapshot and canonical asset repository before CAS mutation.
 * - Uses at most one updateSession(nextSession, expectedRevision) CAS operation.
 * - If CAS fails, does not retry automatically.
 * - Idempotent: repeated invocation after successful reattachment returns NO_OP_ALREADY_TRACKED
 *   only after fresh verification of all live metadata against session receipts.
 */

export const MAX_REATTACHMENT_METADATA_LOOKUPS = 36 as const;

export const ELIGIBLE_REATTACHMENT_SESSION_STATUSES: readonly EditorialBinaryIntakeSessionStatus[] =
  Object.freeze([
    'Created',
    'Quarantined',
    'PreliminarilyVerified',
    'Promoting',
  ]);

export type EditorialReceiptReattachmentOutcome =
  | 'REATTACHED'
  | 'NO_OP_ALREADY_TRACKED'
  | 'HOLD';

export interface EditorialImageReceiptReattachmentResult {
  readonly intakeId: string;
  readonly outcome: EditorialReceiptReattachmentOutcome;
  readonly reasonCode: string;
  readonly details: string;
  readonly sessionRevisionBefore: number;
  readonly sessionRevisionAfter: number;
  readonly sessionStatus: EditorialBinaryIntakeSessionStatus;
  readonly reattachedReceipts: readonly TrackedIntakeStorageObject[];
  readonly reattachedCount: number;
  readonly totalMetadataLookupsAttempted: number;
  readonly session?: EditorialBinaryIntakeSession;
  readonly executedAtIso: string;
}

export interface EditorialImageReceiptReattachmentDependencies {
  readonly sessionStore: IntakeSessionStore;
  readonly assetRepository: Pick<EditorialImageAssetRepository, 'getById'>;
  readonly storageAdapter: Pick<EditorialBinaryStorageAdapter, 'readMetadata'>;
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
      message: `Session targetKind "${session.targetKind}" is rejected for image receipt reattachment (expected "editorial_image_asset").`,
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

function verifyStorageMetadataMatchesReceipt(
  meta: StorageObjectMetadata,
  receipt: TrackedIntakeStorageObject,
  expectedIntakeId: string,
  expectedAssetId: string,
  expectedUploaderUid: string
): boolean {
  if (meta.storagePath !== receipt.storagePath) return false;
  if (meta.generation !== receipt.generation) return false;
  if (meta.etag !== receipt.etag) return false;
  if (meta.sha256Checksum !== receipt.sha256Checksum) return false;
  if (meta.sizeBytes !== receipt.sizeBytes) return false;
  if (meta.contentType !== receipt.contentType) return false;
  if (meta.ownership?.namespace !== receipt.namespace) return false;
  if (meta.ownership?.createdByIntakeId !== expectedIntakeId) return false;
  if (meta.ownership?.assetId !== expectedAssetId) return false;
  if (meta.ownership?.uploaderUid !== expectedUploaderUid) return false;
  return true;
}

function createHoldResult(
  intakeId: string,
  reasonCode: string,
  details: string,
  session: EditorialBinaryIntakeSession,
  lookupsAttempted: number
): EditorialImageReceiptReattachmentResult {
  return Object.freeze({
    intakeId,
    outcome: 'HOLD',
    reasonCode,
    details,
    sessionRevisionBefore: session.revision,
    sessionRevisionAfter: session.revision,
    sessionStatus: session.status,
    reattachedReceipts: Object.freeze([]),
    reattachedCount: 0,
    totalMetadataLookupsAttempted: lookupsAttempted,
    session,
    executedAtIso: new Date().toISOString(),
  });
}

/**
 * Reattaches discovered uncommitted GCS receipts to an eligible intake session
 * using a single atomic CAS update.
 */
export async function reattachDiscoveredEditorialImageReceipts(
  intakeId: string,
  deps: EditorialImageReceiptReattachmentDependencies
): Promise<EditorialImageReceiptReattachmentResult> {
  const validIntakeId = validateIntakeId(intakeId);

  if (!deps || !deps.sessionStore || !deps.assetRepository || !deps.storageAdapter) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Missing required dependencies for receipt reattachment.',
      intakeId: validIntakeId,
    });
  }

  // 1. Initial snapshot read of persisted session
  const initialSnapshot = await deps.sessionStore.getSessionById(validIntakeId);
  if (!initialSnapshot) {
    throw new EditorialBinaryIntakeError({
      code: 'NOT_FOUND',
      message: `Intake session "${validIntakeId}" not found for receipt reattachment.`,
      intakeId: validIntakeId,
    });
  }

  validateSessionIntegrity(initialSnapshot, validIntakeId);

  // 2. Fresh B1 recovery assessment execution
  const b1Assessment: EditorialImageReceiptRecoveryAssessment =
    await inspectEditorialImageReceiptRecovery(validIntakeId, {
      sessionStore: deps.sessionStore,
      assetRepository: deps.assetRepository,
      storageReader: deps.storageAdapter,
    });

  let lookupsAttempted = b1Assessment.totalLookupsAttempted;

  // 3. Handle Idempotent Case: NO_OWNED_UNTRACKED_OBJECTS
  if (b1Assessment.classification === 'NO_OWNED_UNTRACKED_OBJECTS') {
    if (b1Assessment.canonicalStatus !== 'NOT_FOUND') {
      return createHoldResult(
        validIntakeId,
        'CANONICAL_ASSET_STATUS_NOT_ABSENT',
        `Canonical asset status is "${b1Assessment.canonicalStatus}", expected "NOT_FOUND".`,
        initialSnapshot,
        lookupsAttempted
      );
    }

    if (b1Assessment.hasConflicts) {
      return createHoldResult(
        validIntakeId,
        'CONFLICT_HOLD',
        'Conflicts were detected during assessment.',
        initialSnapshot,
        lookupsAttempted
      );
    }

    const trackedQuarantine = initialSnapshot.createdQuarantineObjects;
    const trackedPrivate = initialSnapshot.createdPrivateObjects;
    const totalTrackedReceipts = trackedQuarantine.length + trackedPrivate.length;

    if (totalTrackedReceipts === 0) {
      return createHoldResult(
        validIntakeId,
        'NO_ACTIONABLE_RECEIPT',
        'No untracked objects discovered and no tracked receipts exist in session.',
        initialSnapshot,
        lookupsAttempted
      );
    }

    // Pre-verification fresh session read
    const freshSession = await deps.sessionStore.getSessionById(validIntakeId);
    if (!freshSession) {
      return createHoldResult(
        validIntakeId,
        'SESSION_MUTATED_OR_DELETED',
        'Session was deleted during reattachment inspection.',
        initialSnapshot,
        lookupsAttempted
      );
    }

    // Verify session snapshot consistency
    if (
      freshSession.revision !== initialSnapshot.revision ||
      freshSession.status !== initialSnapshot.status ||
      freshSession.assetId !== initialSnapshot.assetId ||
      freshSession.uploaderUid !== initialSnapshot.uploaderUid ||
      freshSession.requestFingerprint !== initialSnapshot.requestFingerprint ||
      freshSession.canonicalRegistrationAttempted !== initialSnapshot.canonicalRegistrationAttempted ||
      freshSession.canonicalRegistrationSucceeded !== initialSnapshot.canonicalRegistrationSucceeded ||
      freshSession.registrationOutcomeUnknown !== initialSnapshot.registrationOutcomeUnknown ||
      !areReceiptListsIdentical(freshSession.createdQuarantineObjects, initialSnapshot.createdQuarantineObjects) ||
      !areReceiptListsIdentical(freshSession.createdPrivateObjects, initialSnapshot.createdPrivateObjects) ||
      !areReceiptListsIdentical(freshSession.pendingCleanupObjects, initialSnapshot.pendingCleanupObjects)
    ) {
      return createHoldResult(
        validIntakeId,
        'SESSION_SNAPSHOT_MISMATCH',
        'Session snapshot mutated between reads during idempotency verification.',
        initialSnapshot,
        lookupsAttempted
      );
    }

    // Fresh verify all tracked receipts against live storage metadata
    let freshCanonicalResult: EditorialImageAssetReadResult;
    try {
      freshCanonicalResult = await deps.assetRepository.getById(freshSession.assetId);
    } catch (err) {
      return createHoldResult(
        validIntakeId,
        'CANONICAL_REPOSITORY_READ_ERROR',
        `Canonical repository read failed: ${err instanceof Error ? err.message : String(err)}`,
        freshSession,
        lookupsAttempted
      );
    }

    if (freshCanonicalResult.status !== 'NOT_FOUND') {
      return createHoldResult(
        validIntakeId,
        'CANONICAL_REGISTRATION_CHANGED_OR_ERROR',
        `Canonical asset status changed to "${freshCanonicalResult.status}".`,
        freshSession,
        lookupsAttempted
      );
    }

    const allTracked = [...freshSession.createdQuarantineObjects, ...freshSession.createdPrivateObjects];
    for (const receipt of allTracked) {
      lookupsAttempted++;
      if (lookupsAttempted > MAX_REATTACHMENT_METADATA_LOOKUPS) {
        throw new EditorialBinaryIntakeError({
          code: 'STORAGE_FAILURE',
          message: `Total metadata lookups exceeded hard limit of ${MAX_REATTACHMENT_METADATA_LOOKUPS}.`,
          intakeId: validIntakeId,
        });
      }

      let meta: StorageObjectMetadata | null = null;
      try {
        meta = await deps.storageAdapter.readMetadata(receipt.storagePath);
      } catch (err) {
        return createHoldResult(
          validIntakeId,
          'STORAGE_READ_ERROR',
          `Failed reading metadata for tracked receipt "${receipt.storagePath}": ${err instanceof Error ? err.message : String(err)}`,
          freshSession,
          lookupsAttempted
        );
      }

      if (!meta || !verifyStorageMetadataMatchesReceipt(
        meta,
        receipt,
        validIntakeId,
        freshSession.assetId,
        freshSession.uploaderUid
      )) {
        return createHoldResult(
          validIntakeId,
          'TRACKED_RECEIPT_METADATA_DISCREPANCY',
          `Live storage metadata for tracked receipt "${receipt.storagePath}" does not match session receipt.`,
          freshSession,
          lookupsAttempted
        );
      }
    }

    return Object.freeze({
      intakeId: validIntakeId,
      outcome: 'NO_OP_ALREADY_TRACKED',
      reasonCode: 'ALL_RECEIPTS_ALREADY_TRACKED_AND_VERIFIED',
      details: `All ${totalTrackedReceipts} tracked receipt(s) are already persisted and verified against live GCS metadata with canonical NOT_FOUND.`,
      sessionRevisionBefore: freshSession.revision,
      sessionRevisionAfter: freshSession.revision,
      sessionStatus: freshSession.status,
      reattachedReceipts: Object.freeze([]),
      reattachedCount: 0,
      totalMetadataLookupsAttempted: lookupsAttempted,
      session: freshSession,
      executedAtIso: new Date().toISOString(),
    });
  }

  // 4. Validate Candidate Eligibility
  if (b1Assessment.classification === 'CONFLICT_HOLD') {
    return createHoldResult(
      validIntakeId,
      'CONFLICT_HOLD',
      `Assessment classification is CONFLICT_HOLD: ${b1Assessment.details}`,
      initialSnapshot,
      lookupsAttempted
    );
  }

  if (b1Assessment.classification === 'CANONICAL_FOUND_PRESERVE_HOLD') {
    return createHoldResult(
      validIntakeId,
      'CANONICAL_FOUND_PRESERVE_HOLD',
      `Assessment classification is CANONICAL_FOUND_PRESERVE_HOLD: ${b1Assessment.details}`,
      initialSnapshot,
      lookupsAttempted
    );
  }

  if (b1Assessment.classification === 'TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD') {
    return createHoldResult(
      validIntakeId,
      'TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD',
      `Assessment classification is TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD: ${b1Assessment.details}`,
      initialSnapshot,
      lookupsAttempted
    );
  }

  if (b1Assessment.classification === 'UNKNOWN_OR_STALE_HOLD') {
    return createHoldResult(
      validIntakeId,
      'UNKNOWN_OR_STALE_HOLD',
      `Assessment classification is UNKNOWN_OR_STALE_HOLD: ${b1Assessment.details}`,
      initialSnapshot,
      lookupsAttempted
    );
  }

  if (b1Assessment.classification !== 'CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE') {
    return createHoldResult(
      validIntakeId,
      b1Assessment.reasonCode || 'INELIGIBLE_RECOVERY_CLASSIFICATION',
      `Assessment classification "${b1Assessment.classification}" is not eligible for receipt reattachment (${b1Assessment.details}).`,
      initialSnapshot,
      lookupsAttempted
    );
  }

  if (b1Assessment.canonicalStatus !== 'NOT_FOUND') {
    return createHoldResult(
      validIntakeId,
      'CANONICAL_ASSET_STATUS_NOT_ABSENT',
      `Canonical asset status is "${b1Assessment.canonicalStatus}", expected "NOT_FOUND".`,
      initialSnapshot,
      lookupsAttempted
    );
  }

  if (b1Assessment.hasConflicts || b1Assessment.conflictCount > 0) {
    return createHoldResult(
      validIntakeId,
      'CONFLICT_HOLD',
      `Recovery assessment reported ${b1Assessment.conflictCount} conflict(s).`,
      initialSnapshot,
      lookupsAttempted
    );
  }

  if (b1Assessment.untrackedOwnedCount === 0) {
    return createHoldResult(
      validIntakeId,
      'NO_ACTIONABLE_RECEIPT',
      'Zero untracked owned objects available for reattachment.',
      initialSnapshot,
      lookupsAttempted
    );
  }

  // 5. Check Session Status Whitelist
  if (!ELIGIBLE_REATTACHMENT_SESSION_STATUSES.includes(initialSnapshot.status)) {
    return createHoldResult(
      validIntakeId,
      'SESSION_STATUS_NOT_ELIGIBLE',
      `Session status "${initialSnapshot.status}" is not eligible for receipt reattachment.`,
      initialSnapshot,
      lookupsAttempted
    );
  }

  const candidateObjects = b1Assessment.discoveryReport.untrackedOwnedObjects;

  // In Created, Quarantined, PreliminarilyVerified: quarantine objects ONLY
  if (
    initialSnapshot.status === 'Created' ||
    initialSnapshot.status === 'Quarantined' ||
    initialSnapshot.status === 'PreliminarilyVerified'
  ) {
    const hasPrivateCandidate = candidateObjects.some((c) => c.namespace === 'private');
    if (hasPrivateCandidate) {
      return createHoldResult(
        validIntakeId,
        'OBJECT_NAMESPACE_INCOMPATIBLE_WITH_STATUS',
        `Session status "${initialSnapshot.status}" only permits quarantine receipts; private variant objects discovered.`,
        initialSnapshot,
        lookupsAttempted
      );
    }
  }

  // 6. Pre-mutation Fresh Re-read of Session & Canonical Asset
  const freshSession = await deps.sessionStore.getSessionById(validIntakeId);
  if (!freshSession) {
    return createHoldResult(
      validIntakeId,
      'SESSION_MUTATED_OR_DELETED',
      'Session was deleted during reattachment inspection.',
      initialSnapshot,
      lookupsAttempted
    );
  }

  if (
    freshSession.revision !== initialSnapshot.revision ||
    freshSession.status !== initialSnapshot.status ||
    freshSession.assetId !== initialSnapshot.assetId ||
    freshSession.uploaderUid !== initialSnapshot.uploaderUid ||
    freshSession.requestFingerprint !== initialSnapshot.requestFingerprint ||
    freshSession.canonicalRegistrationAttempted !== initialSnapshot.canonicalRegistrationAttempted ||
    freshSession.canonicalRegistrationSucceeded !== initialSnapshot.canonicalRegistrationSucceeded ||
    freshSession.registrationOutcomeUnknown !== initialSnapshot.registrationOutcomeUnknown ||
    !areReceiptListsIdentical(freshSession.createdQuarantineObjects, initialSnapshot.createdQuarantineObjects) ||
    !areReceiptListsIdentical(freshSession.createdPrivateObjects, initialSnapshot.createdPrivateObjects) ||
    !areReceiptListsIdentical(freshSession.pendingCleanupObjects, initialSnapshot.pendingCleanupObjects)
  ) {
    return createHoldResult(
      validIntakeId,
      'SESSION_SNAPSHOT_MISMATCH',
      'Session mutated between discovery and pre-mutation re-read.',
      initialSnapshot,
      lookupsAttempted
    );
  }

  let freshCanonicalResult: EditorialImageAssetReadResult;
  try {
    freshCanonicalResult = await deps.assetRepository.getById(freshSession.assetId);
  } catch (err) {
    return createHoldResult(
      validIntakeId,
      'CANONICAL_REPOSITORY_READ_ERROR',
      `Canonical repository read failed: ${err instanceof Error ? err.message : String(err)}`,
      freshSession,
      lookupsAttempted
    );
  }

  if (freshCanonicalResult.status !== 'NOT_FOUND') {
    return createHoldResult(
      validIntakeId,
      'CANONICAL_REGISTRATION_CHANGED_OR_ERROR',
      `Canonical asset status changed to "${freshCanonicalResult.status}".`,
      freshSession,
      lookupsAttempted
    );
  }

  // 7. Fresh Verification of Candidate GCS Metadata
  const newReceipts: TrackedIntakeStorageObject[] = [];

  for (const candidate of candidateObjects) {
    lookupsAttempted++;
    if (lookupsAttempted > MAX_REATTACHMENT_METADATA_LOOKUPS) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Total metadata lookups exceeded hard limit of ${MAX_REATTACHMENT_METADATA_LOOKUPS}.`,
        intakeId: validIntakeId,
      });
    }

    let meta: StorageObjectMetadata | null = null;
    try {
      meta = await deps.storageAdapter.readMetadata(candidate.storagePath);
    } catch (err) {
      return createHoldResult(
        validIntakeId,
        'STORAGE_READ_ERROR',
        `Failed reading fresh metadata for candidate "${candidate.storagePath}": ${err instanceof Error ? err.message : String(err)}`,
        freshSession,
        lookupsAttempted
      );
    }

    if (!meta) {
      return createHoldResult(
        validIntakeId,
        'CANDIDATE_METADATA_MUTATED_OR_DISAPPEARED',
        `Candidate object at "${candidate.storagePath}" disappeared before reattachment.`,
        freshSession,
        lookupsAttempted
      );
    }

    // Verify metadata match
    if (
      meta.storagePath !== candidate.storagePath ||
      meta.generation !== candidate.generation ||
      meta.etag !== candidate.etag ||
      meta.sha256Checksum !== candidate.sha256Checksum ||
      meta.sizeBytes !== candidate.sizeBytes ||
      meta.contentType !== candidate.contentType ||
      meta.ownership?.namespace !== candidate.namespace ||
      meta.ownership?.createdByIntakeId !== validIntakeId ||
      meta.ownership?.assetId !== freshSession.assetId ||
      meta.ownership?.uploaderUid !== freshSession.uploaderUid
    ) {
      return createHoldResult(
        validIntakeId,
        'CANDIDATE_METADATA_MUTATED_OR_DISAPPEARED',
        `Candidate object metadata at "${candidate.storagePath}" mutated before reattachment.`,
        freshSession,
        lookupsAttempted
      );
    }

    // Build verified receipt from live storage metadata
    const receipt: TrackedIntakeStorageObject = Object.freeze({
      storagePath: meta.storagePath,
      namespace: meta.ownership.namespace,
      generation: meta.generation,
      etag: meta.etag,
      sha256Checksum: meta.sha256Checksum,
      sizeBytes: meta.sizeBytes,
      contentType: meta.contentType,
      createdByIntakeId: validIntakeId,
    });

    newReceipts.push(receipt);
  }

  // 8. Construct Updated Session with Appended Receipts
  const existingQuarantinePaths = new Set(
    freshSession.createdQuarantineObjects.map((o) => o.storagePath)
  );
  const existingPrivatePaths = new Set(
    freshSession.createdPrivateObjects.map((o) => o.storagePath)
  );

  const quarantineToAppend = newReceipts.filter(
    (r) => r.namespace === 'quarantine' && !existingQuarantinePaths.has(r.storagePath)
  );
  const privateToAppend = newReceipts.filter(
    (r) => r.namespace === 'private' && !existingPrivatePaths.has(r.storagePath)
  );

  const updatedQuarantine = Object.freeze([
    ...freshSession.createdQuarantineObjects,
    ...quarantineToAppend,
  ]);
  const updatedPrivate = Object.freeze([
    ...freshSession.createdPrivateObjects,
    ...privateToAppend,
  ]);

  const nextSession: EditorialBinaryIntakeSession = Object.freeze({
    ...freshSession,
    createdQuarantineObjects: updatedQuarantine,
    createdPrivateObjects: updatedPrivate,
    updatedAt: new Date().toISOString(),
  });

  // 9. Single Atomic CAS Operation
  let persistedSession: EditorialBinaryIntakeSession;
  try {
    persistedSession = await deps.sessionStore.updateSession(
      nextSession,
      freshSession.revision
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return createHoldResult(
      validIntakeId,
      'CAS_REVISION_CONFLICT',
      `Session CAS update failed for expected revision ${freshSession.revision}: ${msg}`,
      freshSession,
      lookupsAttempted
    );
  }

  return Object.freeze({
    intakeId: validIntakeId,
    outcome: 'REATTACHED',
    reasonCode: 'RECEIPTS_REATTACHED_SUCCESSFULLY',
    details: `Successfully reattached ${newReceipts.length} receipt(s) via CAS update (revision ${freshSession.revision} -> ${persistedSession.revision}).`,
    sessionRevisionBefore: freshSession.revision,
    sessionRevisionAfter: persistedSession.revision,
    sessionStatus: persistedSession.status,
    reattachedReceipts: Object.freeze(newReceipts),
    reattachedCount: newReceipts.length,
    totalMetadataLookupsAttempted: lookupsAttempted,
    session: persistedSession,
    executedAtIso: new Date().toISOString(),
  });
}
