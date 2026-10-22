import { describe, expect, it } from 'vitest';
import {
  type CanonicalAssetObservationStatus,
  type EditorialImageReceiptRecoveryDependencies,
  type ReceiptRecoveryAssetReader,
  type ReceiptRecoverySessionReader,
  type ReceiptRecoveryStorageReader,
  inspectEditorialImageReceiptRecovery,
} from './editorialImageReceiptRecoveryReadback';
import {
  type EditorialBinaryIntakeSession,
  EditorialBinaryIntakeError,
  type StorageObjectMetadata,
  type TrackedIntakeStorageObject,
} from './editorialBinaryIntakeService';
import {
  type EditorialImageAssetReadResult,
} from './editorialImageAssetRepository';
import { type EditorialImageAssetMetadata } from '../types/editorialImageAsset';
import { AdminRole } from '../shared/adminContract';

// ============================================================================
// Deterministic Test Helpers and In-Memory Mocks
// ============================================================================

class MockSessionStore implements ReceiptRecoverySessionReader {
  public sessions = new Map<string, EditorialBinaryIntakeSession>();
  public readCount = 0;
  public returnOnSecondRead?: EditorialBinaryIntakeSession | null;

  async getSessionById(
    intakeId: string
  ): Promise<EditorialBinaryIntakeSession | null> {
    this.readCount++;
    if (this.readCount >= 2 && this.returnOnSecondRead !== undefined) {
      return this.returnOnSecondRead;
    }
    return this.sessions.get(intakeId) ?? null;
  }
}

class MockAssetRepository implements ReceiptRecoveryAssetReader {
  public assets = new Map<string, EditorialImageAssetMetadata>();
  public revisions = new Map<string, number>();
  public readCount = 0;
  public failNextWith?: Error;
  public returnOnSecondRead?: EditorialImageAssetReadResult;

  async getById(assetId: string): Promise<EditorialImageAssetReadResult> {
    this.readCount++;
    if (this.failNextWith) {
      const err = this.failNextWith;
      this.failNextWith = undefined;
      throw err;
    }
    if (this.readCount >= 2 && this.returnOnSecondRead !== undefined) {
      return this.returnOnSecondRead;
    }
    const asset = this.assets.get(assetId);
    if (!asset) {
      return {
        ok: false,
        status: 'NOT_FOUND',
        code: 'NOT_FOUND',
        assetId,
        record: null,
      };
    }
    const revision = this.revisions.get(assetId) ?? 1;
    return {
      ok: true,
      status: 'FOUND',
      record: { assetId, revision, asset },
      asset,
      revision,
    };
  }
}

class MockStorageReader implements ReceiptRecoveryStorageReader {
  public lookups: string[] = [];
  public objects = new Map<string, StorageObjectMetadata>();

  async readMetadata(
    storagePath: string
  ): Promise<StorageObjectMetadata | null> {
    this.lookups.push(storagePath);
    return this.objects.get(storagePath) ?? null;
  }
}

function createSampleSession(
  intakeId = 'intake_2026_rec01',
  assetId = 'asset_2026_rec01',
  targetKind: 'editorial_image_asset' | 'rights_evidence_binary' = 'editorial_image_asset'
): EditorialBinaryIntakeSession {
  return {
    intakeId,
    targetKind,
    assetId,
    uploaderUid: 'editor_admin_01',
    uploaderRole: AdminRole.ContentEditor,
    requestFingerprint: 'fp_abc123',
    status: 'Created',
    revision: 1,
    createdAt: '2026-04-18T10:00:00.000Z',
    updatedAt: '2026-04-18T10:00:00.000Z',
    expiresAt: '2026-04-18T11:00:00.000Z',
    binarySha256:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    createdQuarantineObjects: [],
    createdPrivateObjects: [],
    pendingCleanupObjects: [],
    canonicalRegistrationAttempted: false,
    canonicalRegistrationSucceeded: false,
    registrationOutcomeUnknown: false,
  };
}

function createSampleCanonicalAsset(
  assetId: string,
  overrides: Partial<EditorialImageAssetMetadata> = {}
): EditorialImageAssetMetadata {
  return {
    assetId,
    createdByUid: 'editor_admin_01',
    createdAtIso: '2026-04-18T10:00:00.000Z',
    updatedAtIso: '2026-04-18T10:00:00.000Z',
    origin: 'standalone_upload',
    status: 'active',
    originalFilename: 'source.png',
    mimeType: 'image/png',
    originalSizeBytes: 2048,
    originalWidth: 1200,
    originalHeight: 800,
    aspectRatio: 1.5,
    sha256Checksum:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    rights: {
      status: 'Approved',
    },
    variants: {},
    altAr: 'وصف بديل',
    ...overrides,
  };
}

function createSampleStorageMetadata(
  storagePath: string,
  overrides: Partial<StorageObjectMetadata> = {}
): StorageObjectMetadata {
  const isQuarantine = storagePath.startsWith('editorial_intake_quarantine/');
  return {
    storagePath,
    generation: '170000000100',
    etag: 'etag_170000000100',
    contentType: isQuarantine ? 'image/png' : 'image/webp',
    sizeBytes: 1024,
    sha256Checksum:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    createdAtIso: '2026-04-18T10:00:00.000Z',
    ownership: {
      createdByIntakeId: 'intake_2026_rec01',
      targetKind: 'editorial_image_asset',
      namespace: isQuarantine ? 'quarantine' : 'private',
      assetId: 'asset_2026_rec01',
      uploaderUid: 'editor_admin_01',
    },
    ...overrides,
  };
}

// ============================================================================
// Test Suite: IMG-F3-08B Recovery Read-back & Decision Gate
// ============================================================================

describe('IMG-F3-08B — inspectEditorialImageReceiptRecovery', () => {
  it('rejects invalid intakeId format or missing session', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps: EditorialImageReceiptRecoveryDependencies = {
      sessionStore,
      assetRepository,
      storageReader,
    };

    // 1. Invalid intakeId format
    await expect(
      inspectEditorialImageReceiptRecovery('invalid intake id!!', deps)
    ).rejects.toThrow(EditorialBinaryIntakeError);

    // 2. Non-existent session
    await expect(
      inspectEditorialImageReceiptRecovery('intake_2026_missing', deps)
    ).rejects.toThrow(EditorialBinaryIntakeError);
  });

  it('rejects non-image intake session (rights_evidence_binary targetKind)', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const session = createSampleSession(
      'intake_2026_evidence',
      'asset_2026_evidence',
      'rights_evidence_binary'
    );
    sessionStore.sessions.set(session.intakeId, session);

    await expect(
      inspectEditorialImageReceiptRecovery(session.intakeId, deps)
    ).rejects.toThrow(EditorialBinaryIntakeError);
  });

  it('handles canonical repository read error as UNKNOWN_OR_STALE_HOLD, never NOT_FOUND', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const session = createSampleSession('intake_2026_err', 'asset_2026_err');
    sessionStore.sessions.set(session.intakeId, session);

    // Simulate repository failure (e.g. database network error)
    assetRepository.failNextWith = new Error('Database connection failed');

    const assessment = await inspectEditorialImageReceiptRecovery(
      session.intakeId,
      deps
    );

    expect(assessment.classification).toBe('UNKNOWN_OR_STALE_HOLD');
    expect(assessment.canonicalStatus).toBe('READ_ERROR');
    expect(assessment.reasonCode).toBe('CANONICAL_REPOSITORY_READ_ERROR');
    expect(assessment.details).toContain('Database connection failed');
    expect(assessment.requiresFreshAtomicVerification).toBe(true);
  });

  it('classifies lost quarantine receipt as CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE when canonical is NOT_FOUND', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_lostq';
    const assetId = 'asset_2026_lostq';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    // Quarantine object exists in GCS, but session missed receipt (empty createdQuarantineObjects)
    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageReader.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, {
        ownership: {
          createdByIntakeId: intakeId,
          targetKind: 'editorial_image_asset',
          namespace: 'quarantine',
          assetId,
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    expect(assessment.classification).toBe(
      'CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE'
    );
    expect(assessment.canonicalStatus).toBe('NOT_FOUND');
    expect(assessment.reasonCode).toBe('UNTRACKED_OWNED_OBJECTS_DISCOVERED');
    expect(assessment.hasUntrackedOwnedObjects).toBe(true);
    expect(assessment.untrackedOwnedCount).toBe(1);
    expect(assessment.hasConflicts).toBe(false);
    expect(assessment.requiresFreshAtomicVerification).toBe(true);
  });

  it('classifies lost private variant receipt as CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_lostp';
    const assetId = 'asset_2026_lostp';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    // Private variant exists in GCS, but session missed receipt
    const pPath = `editorial_images/private/${assetId}/thumbnail.webp`;
    storageReader.objects.set(
      pPath,
      createSampleStorageMetadata(pPath, {
        ownership: {
          createdByIntakeId: intakeId,
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId,
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    expect(assessment.classification).toBe(
      'CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE'
    );
    expect(assessment.canonicalStatus).toBe('NOT_FOUND');
    expect(assessment.untrackedOwnedCount).toBe(1);
    expect(assessment.hasConflicts).toBe(false);
  });

  it('classifies CANONICAL_FOUND_PRESERVE_HOLD when canonical asset is registered', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_found';
    const assetId = 'asset_2026_found';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    // Canonical asset exists in repository
    assetRepository.assets.set(assetId, createSampleCanonicalAsset(assetId));

    // Private variant exists in storage
    const pPath = `editorial_images/private/${assetId}/thumbnail.webp`;
    storageReader.objects.set(
      pPath,
      createSampleStorageMetadata(pPath, {
        ownership: {
          createdByIntakeId: intakeId,
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId,
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    // Must PRESERVE: FOUND does not authorize deletion and avoids claiming intake ownership
    expect(assessment.classification).toBe('CANONICAL_FOUND_PRESERVE_HOLD');
    expect(assessment.canonicalStatus).toBe('FOUND');
    expect(assessment.reasonCode).toBe('CANONICAL_ASSET_EXISTS_PRESERVE');
    expect(assessment.details).toContain('Preserving objects');
  });

  it('classifies CONFLICT_HOLD when canonical asset identity conflicts with session metadata', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_cconf';
    const assetId = 'asset_2026_cconf';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    // Canonical asset has CONTRADICTORY uploaderUid
    assetRepository.assets.set(
      assetId,
      createSampleCanonicalAsset(assetId, {
        createdByUid: 'different_uploader_999',
      })
    );

    const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    expect(assessment.classification).toBe('CONFLICT_HOLD');
    expect(assessment.reasonCode).toBe('CANONICAL_ASSET_IDENTITY_CONFLICT');
    expect(assessment.hasConflicts).toBe(true);
  });

  it('classifies TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD for Failed or Completed sessions with untracked objects', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    // 1. Failed session
    {
      const intakeId = 'intake_2026_failed';
      const assetId = 'asset_2026_failed';
      const session: EditorialBinaryIntakeSession = {
        ...createSampleSession(intakeId, assetId),
        status: 'Failed',
      };
      sessionStore.sessions.set(intakeId, session);

      const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
      storageReader.objects.set(
        qPath,
        createSampleStorageMetadata(qPath, {
          ownership: {
            createdByIntakeId: intakeId,
            targetKind: 'editorial_image_asset',
            namespace: 'quarantine',
            assetId,
            uploaderUid: 'editor_admin_01',
          },
        })
      );

      const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

      expect(assessment.classification).toBe(
        'TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD'
      );
      expect(assessment.reasonCode).toBe(
        'TERMINAL_SESSION_HAS_UNTRACKED_OBJECTS'
      );
      expect(assessment.sessionStatus).toBe('Failed');
    }

    // 2. Completed session
    {
      const intakeId = 'intake_2026_completed';
      const assetId = 'asset_2026_completed';
      const session: EditorialBinaryIntakeSession = {
        ...createSampleSession(intakeId, assetId),
        status: 'Completed',
      };
      sessionStore.sessions.set(intakeId, session);

      const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
      storageReader.objects.set(
        qPath,
        createSampleStorageMetadata(qPath, {
          ownership: {
            createdByIntakeId: intakeId,
            targetKind: 'editorial_image_asset',
            namespace: 'quarantine',
            assetId,
            uploaderUid: 'editor_admin_01',
          },
        })
      );

      const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

      expect(assessment.classification).toBe(
        'TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD'
      );
      expect(assessment.reasonCode).toBe(
        'TERMINAL_SESSION_HAS_UNTRACKED_OBJECTS'
      );
      expect(assessment.sessionStatus).toBe('Completed');
    }
  });

  it('classifies CONFLICT_HOLD when foreign ownership or contradictory receipts are detected in discovery', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_foreign';
    const assetId = 'asset_2026_foreign';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    // GCS object has foreign ownership
    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageReader.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, {
        ownership: {
          createdByIntakeId: 'foreign_intake_other', // FOREIGN OWNER!
          targetKind: 'editorial_image_asset',
          namespace: 'quarantine',
          assetId,
          uploaderUid: 'other_user',
        },
      })
    );

    const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    expect(assessment.classification).toBe('CONFLICT_HOLD');
    expect(assessment.reasonCode).toBe('DISCOVERY_CONFLICT_DETECTED');
    expect(assessment.hasConflicts).toBe(true);
    expect(assessment.conflictCount).toBe(1);
  });

  it('detects session revision, status, or receipt changes between reads as UNKNOWN_OR_STALE_HOLD', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_stale';
    const assetId = 'asset_2026_stale';
    const baseSession = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, baseSession);

    // 1. Revision changed on second read
    sessionStore.readCount = 0;
    sessionStore.returnOnSecondRead = {
      ...baseSession,
      revision: 2, // MUTATED DURING INSPECTION!
    };

    const assessmentRev = await inspectEditorialImageReceiptRecovery(
      intakeId,
      deps
    );
    expect(assessmentRev.classification).toBe('UNKNOWN_OR_STALE_HOLD');
    expect(assessmentRev.reasonCode).toBe('OBSERVED_CONCURRENT_MUTATION');
    expect(assessmentRev.details).toContain('revision mutated');

    // 2. Status changed on second read
    sessionStore.readCount = 0;
    sessionStore.returnOnSecondRead = {
      ...baseSession,
      status: 'Promoting', // MUTATED DURING INSPECTION!
    };

    const assessmentStatus = await inspectEditorialImageReceiptRecovery(
      intakeId,
      deps
    );
    expect(assessmentStatus.classification).toBe('UNKNOWN_OR_STALE_HOLD');
    expect(assessmentStatus.reasonCode).toBe('OBSERVED_CONCURRENT_MUTATION');
    expect(assessmentStatus.details).toContain('status mutated');

    // 3. Tracked receipts changed on second read
    const newTrackedObj: TrackedIntakeStorageObject = {
      storagePath: `editorial_intake_quarantine/images/${intakeId}/source.png`,
      namespace: 'quarantine',
      generation: '170000000100',
      etag: 'etag_1',
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 1024,
      contentType: 'image/png',
      createdByIntakeId: intakeId,
    };
    sessionStore.readCount = 0;
    sessionStore.returnOnSecondRead = {
      ...baseSession,
      createdQuarantineObjects: [newTrackedObj], // MUTATED RECEIPTS!
    };

    const assessmentReceipts = await inspectEditorialImageReceiptRecovery(
      intakeId,
      deps
    );
    expect(assessmentReceipts.classification).toBe('UNKNOWN_OR_STALE_HOLD');
    expect(assessmentReceipts.reasonCode).toBe('OBSERVED_CONCURRENT_MUTATION');
    expect(assessmentReceipts.details).toContain('tracked receipt lists changed');
  });

  it('detects canonical registration mutation between reads as UNKNOWN_OR_STALE_HOLD', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_canstale';
    const assetId = 'asset_2026_canstale';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    // Initial read is NOT_FOUND, but second read returns FOUND (concurrent registration committed)
    const asset = createSampleCanonicalAsset(assetId);
    assetRepository.returnOnSecondRead = {
      ok: true,
      status: 'FOUND',
      record: { assetId, revision: 1, asset },
      asset,
      revision: 1,
    };

    const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    expect(assessment.classification).toBe('UNKNOWN_OR_STALE_HOLD');
    expect(assessment.reasonCode).toBe('OBSERVED_CONCURRENT_MUTATION');
    expect(assessment.details).toContain('Canonical asset status mutated');
  });

  it('classifies NO_OWNED_UNTRACKED_OBJECTS when session is clean and no untracked objects exist', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_clean';
    const assetId = 'asset_2026_clean';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    // No GCS objects exist at any candidate path
    const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    expect(assessment.classification).toBe('NO_OWNED_UNTRACKED_OBJECTS');
    expect(assessment.reasonCode).toBe('ZERO_UNTRACKED_OWNED_OBJECTS');
    expect(assessment.hasUntrackedOwnedObjects).toBe(false);
    expect(assessment.untrackedOwnedCount).toBe(0);
    expect(assessment.hasConflicts).toBe(false);
  });

  it('strictly adheres to bounded lookups (<= 18 GCS metadata queries) and performs zero writes/deletes', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_bound';
    const assetId = 'asset_2026_bound';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    const assessment = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    expect(assessment.totalLookupsAttempted).toBe(18);
    expect(storageReader.lookups).toHaveLength(18);

    // Zero writes, deletes, or mutations exist on reader
    expect((storageReader as any).writeIfAbsent).toBeUndefined();
    expect((storageReader as any).deleteIfGenerationMatches).toBeUndefined();
    expect((sessionStore as any).updateSession).toBeUndefined();
    expect((assetRepository as any).createIfAbsent).toBeUndefined();
  });

  it('returns immutable frozen result and operates deterministically across repeated invocations', async () => {
    const sessionStore = new MockSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageReader = new MockStorageReader();
    const deps = { sessionStore, assetRepository, storageReader };

    const intakeId = 'intake_2026_det';
    const assetId = 'asset_2026_det';
    const session = createSampleSession(intakeId, assetId);
    sessionStore.sessions.set(intakeId, session);

    const assessment1 = await inspectEditorialImageReceiptRecovery(intakeId, deps);
    const assessment2 = await inspectEditorialImageReceiptRecovery(intakeId, deps);

    expect(Object.isFrozen(assessment1)).toBe(true);
    expect(assessment1.classification).toBe(assessment2.classification);
    expect(assessment1.reasonCode).toBe(assessment2.reasonCode);
    expect(assessment1.totalLookupsAttempted).toBe(assessment2.totalLookupsAttempted);
    expect(assessment1.untrackedOwnedCount).toBe(assessment2.untrackedOwnedCount);

    // Verify absolute prohibitions: no deletion instructions
    expect((assessment1 as any).shouldDelete).toBeUndefined();
    expect((assessment1 as any).safeToDelete).toBeUndefined();
    expect((assessment1 as any).deletionPlan).toBeUndefined();
  });
});
