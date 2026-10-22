import { describe, expect, it } from 'vitest';
import {
  deriveCanonicalCandidateImageStoragePaths,
  discoverUntrackedEditorialImageObjects,
  type EditorialStorageMetadataReader,
  MAX_DISCOVERY_LOOKUP_BOUND,
} from './editorialUntrackedImageObjectDiscovery';
import {
  EditorialBinaryIntakeError,
  type EditorialBinaryIntakeSession,
  type StorageObjectMetadata,
  type TrackedIntakeStorageObject,
} from './editorialBinaryIntakeService';
import { AdminRole } from '../shared/adminContract';

// ============================================================================
// Deterministic Test Helpers and In-Memory Fakes
// ============================================================================

class FakeStorageReader implements EditorialStorageMetadataReader {
  public lookups: string[] = [];
  public objects = new Map<string, StorageObjectMetadata>();
  public failNextWith?: Error;

  async readMetadata(
    storagePath: string
  ): Promise<StorageObjectMetadata | null> {
    this.lookups.push(storagePath);
    if (this.failNextWith) {
      const err = this.failNextWith;
      this.failNextWith = undefined;
      throw err;
    }
    return this.objects.get(storagePath) ?? null;
  }
}

function createSampleSession(
  intakeId = 'intake_2026_test01',
  assetId = 'asset_2026_test01',
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
    createdQuarantineObjects: [],
    createdPrivateObjects: [],
    pendingCleanupObjects: [],
    canonicalRegistrationAttempted: false,
    canonicalRegistrationSucceeded: false,
    registrationOutcomeUnknown: false,
  };
}

function createSampleMetadata(
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
      createdByIntakeId: 'intake_2026_test01',
      targetKind: 'editorial_image_asset',
      namespace: isQuarantine ? 'quarantine' : 'private',
      assetId: 'asset_2026_test01',
      uploaderUid: 'editor_admin_01',
    },
    ...overrides,
  };
}

// ============================================================================
// Test Suite: IMG-F3-08A Bounded Read-Only GCS Orphan Receipt Discovery
// ============================================================================

describe('IMG-F3-08A — deriveCanonicalCandidateImageStoragePaths', () => {
  it('derives exactly 18 canonical candidate paths for an image session', () => {
    const paths = deriveCanonicalCandidateImageStoragePaths(
      'intake_2026_abc1',
      'asset_2026_xyz1'
    );

    // Strict 18-lookup ceiling
    expect(paths).toHaveLength(MAX_DISCOVERY_LOOKUP_BOUND);
    expect(paths).toHaveLength(18);

    // 3 quarantine paths
    const quarantinePaths = paths.filter((p) =>
      p.startsWith('editorial_intake_quarantine/')
    );
    expect(quarantinePaths).toEqual([
      'editorial_intake_quarantine/images/intake_2026_abc1/source.png',
      'editorial_intake_quarantine/images/intake_2026_abc1/source.jpg',
      'editorial_intake_quarantine/images/intake_2026_abc1/source.webp',
    ]);

    // 15 private variant paths (5 keys x 3 formats)
    const privatePaths = paths.filter((p) =>
      p.startsWith('editorial_images/private/')
    );
    expect(privatePaths).toHaveLength(15);

    // Spot-check variant keys present
    for (const key of [
      'thumbnail',
      'card',
      'article_inline',
      'article_cover',
      'original_processed',
    ]) {
      expect(
        privatePaths.some((p) =>
          p.includes(`/asset_2026_xyz1/${key}.webp`)
        )
      ).toBe(true);
    }
  });

  it('rejects invalid intakeId or assetId during candidate path generation', () => {
    expect(() =>
      deriveCanonicalCandidateImageStoragePaths('invalid intake id!', 'asset_2026_xyz1')
    ).toThrow(EditorialBinaryIntakeError);

    expect(() =>
      deriveCanonicalCandidateImageStoragePaths('intake_2026_abc1', 'invalid/asset/id')
    ).toThrow(EditorialBinaryIntakeError);
  });
});

describe('IMG-F3-08A — discoverUntrackedEditorialImageObjects — Receipt Discovery', () => {
  it('discovers untracked quarantine object when GCS write succeeded but session missed receipt', async () => {
    const session = createSampleSession('intake_2026_01', 'asset_2026_01');
    const storageReader = new FakeStorageReader();

    // Plant quarantine object in storage (write succeeded)
    const quarantinePath =
      'editorial_intake_quarantine/images/intake_2026_01/source.png';
    const metadata = createSampleMetadata(quarantinePath, {
      generation: '171000000001',
      ownership: {
        createdByIntakeId: 'intake_2026_01',
        targetKind: 'editorial_image_asset',
        namespace: 'quarantine',
        assetId: 'asset_2026_01',
        uploaderUid: 'editor_admin_01',
      },
    });
    storageReader.objects.set(quarantinePath, metadata);

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    // Exactly 18 lookups attempted
    expect(report.totalLookupsAttempted).toBe(18);
    expect(storageReader.lookups).toHaveLength(18);

    // Discovers the untracked quarantine object with its exact generation
    expect(report.hasUntrackedOwnedObjects).toBe(true);
    expect(report.untrackedOwnedObjects).toHaveLength(1);
    expect(report.untrackedOwnedObjects[0].storagePath).toBe(quarantinePath);
    expect(report.untrackedOwnedObjects[0].generation).toBe('171000000001');
    expect(report.untrackedOwnedObjects[0].namespace).toBe('quarantine');

    // No tracked objects or conflicts
    expect(report.trackedObjects).toHaveLength(0);
    expect(report.hasConflicts).toBe(false);
    expect(report.conflicts).toHaveLength(0);
  });

  it('discovers untracked private variant without conflating with other variants', async () => {
    const session = createSampleSession('intake_2026_02', 'asset_2026_02');
    const storageReader = new FakeStorageReader();

    const variantPath =
      'editorial_images/private/asset_2026_02/thumbnail.webp';
    const metadata = createSampleMetadata(variantPath, {
      generation: '172000000002',
      ownership: {
        createdByIntakeId: 'intake_2026_02',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: 'asset_2026_02',
        uploaderUid: 'editor_admin_01',
      },
    });
    storageReader.objects.set(variantPath, metadata);

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    expect(report.hasUntrackedOwnedObjects).toBe(true);
    expect(report.untrackedOwnedObjects).toHaveLength(1);
    expect(report.untrackedOwnedObjects[0].storagePath).toBe(variantPath);
    expect(report.untrackedOwnedObjects[0].generation).toBe('172000000002');
    expect(report.untrackedOwnedObjects[0].namespace).toBe('private');
  });

  it('recognizes previously tracked objects across session lists and does not report them as untracked', async () => {
    const trackedPath =
      'editorial_images/private/asset_2026_03/card.webp';
    const trackedGeneration = '173000000003';

    const trackedObject: TrackedIntakeStorageObject = {
      storagePath: trackedPath,
      namespace: 'private',
      generation: trackedGeneration,
      etag: `etag_${trackedGeneration}`,
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 2048,
      contentType: 'image/webp',
      createdByIntakeId: 'intake_2026_03',
    };

    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_2026_03', 'asset_2026_03'),
      createdPrivateObjects: [trackedObject],
    };

    const storageReader = new FakeStorageReader();
    storageReader.objects.set(
      trackedPath,
      createSampleMetadata(trackedPath, {
        generation: trackedGeneration,
        etag: `etag_${trackedGeneration}`,
        sizeBytes: 2048,
        ownership: {
          createdByIntakeId: 'intake_2026_03',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_03',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    expect(report.hasUntrackedOwnedObjects).toBe(false);
    expect(report.untrackedOwnedObjects).toHaveLength(0);
    expect(report.trackedObjects).toHaveLength(1);
    expect(report.trackedObjects[0].storagePath).toBe(trackedPath);
    expect(report.trackedObjects[0].trackedIn).toBe('createdPrivateObjects');
    expect(report.hasConflicts).toBe(false);
  });

  it('flags foreign-owned objects as conflicts and never treats them as owned', async () => {
    const session = createSampleSession('intake_2026_04', 'asset_2026_04');
    const storageReader = new FakeStorageReader();

    const candidatePath =
      'editorial_images/private/asset_2026_04/article_inline.webp';

    // Object exists at candidate path, but createdByIntakeId is a different intake
    const foreignMetadata = createSampleMetadata(candidatePath, {
      generation: '174000000004',
      ownership: {
        createdByIntakeId: 'different_intake_99',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: 'asset_2026_04',
        uploaderUid: 'editor_admin_01',
      },
    });
    storageReader.objects.set(candidatePath, foreignMetadata);

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    // Must NOT claim as untracked owned object
    expect(report.hasUntrackedOwnedObjects).toBe(false);
    expect(report.untrackedOwnedObjects).toHaveLength(0);

    // Must report conflict
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].conflictReason).toBe('FOREIGN_OWNERSHIP');
    expect(report.conflicts[0].storagePath).toBe(candidatePath);
  });

  it('detects generation conflict on previously tracked path without recommending deletion', async () => {
    const trackedPath =
      'editorial_images/private/asset_2026_05/article_cover.webp';
    const recordedGeneration = '175000000005';
    const actualStorageGeneration = '175999999999';

    const trackedObject: TrackedIntakeStorageObject = {
      storagePath: trackedPath,
      namespace: 'private',
      generation: recordedGeneration,
      etag: `etag_${recordedGeneration}`,
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 4096,
      contentType: 'image/webp',
      createdByIntakeId: 'intake_2026_05',
    };

    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_2026_05', 'asset_2026_05'),
      createdPrivateObjects: [trackedObject],
    };

    const storageReader = new FakeStorageReader();
    storageReader.objects.set(
      trackedPath,
      createSampleMetadata(trackedPath, {
        generation: actualStorageGeneration, // different generation in storage!
        ownership: {
          createdByIntakeId: 'intake_2026_05',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_05',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    // Neither untracked nor cleanly tracked
    expect(report.untrackedOwnedObjects).toHaveLength(0);
    expect(report.trackedObjects).toHaveLength(0);

    // Recorded as generation mismatch conflict
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].conflictReason).toBe('GENERATION_MISMATCH');
    expect(report.conflicts[0].existingGeneration).toBe(actualStorageGeneration);
    expect(report.conflicts[0].recordedGeneration).toBe(recordedGeneration);
  });

  it('fails closed when metadata read fails or metadata is corrupt', async () => {
    const session = createSampleSession('intake_2026_06', 'asset_2026_06');
    const storageReader = new FakeStorageReader();

    // 1. Read network / permission failure
    storageReader.failNextWith = new Error('GCS connection timeout');
    await expect(
      discoverUntrackedEditorialImageObjects(session, storageReader)
    ).rejects.toThrow(EditorialBinaryIntakeError);

    // 2. Corrupt metadata: invalid checksum
    const candidatePath =
      'editorial_images/private/asset_2026_06/thumbnail.webp';
    storageReader.objects.set(
      candidatePath,
      createSampleMetadata(candidatePath, {
        sha256Checksum: 'invalid-not-hex',
        ownership: {
          createdByIntakeId: 'intake_2026_06',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_06',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    await expect(
      discoverUntrackedEditorialImageObjects(session, storageReader)
    ).rejects.toThrow(EditorialBinaryIntakeError);
  });

  it('refuses sessions with invalid identity or targetKind rights_evidence_binary', async () => {
    const storageReader = new FakeStorageReader();

    // Refuse rights_evidence_binary session
    const evidenceSession = createSampleSession(
      'intake_2026_07',
      'asset_2026_07',
      'rights_evidence_binary'
    );
    await expect(
      discoverUntrackedEditorialImageObjects(evidenceSession, storageReader)
    ).rejects.toThrow(EditorialBinaryIntakeError);

    // Refuse session with invalid intakeId
    const invalidIdSession: EditorialBinaryIntakeSession = {
      ...createSampleSession('invalid intake id!', 'asset_2026_07'),
    };
    await expect(
      discoverUntrackedEditorialImageObjects(invalidIdSession, storageReader)
    ).rejects.toThrow(EditorialBinaryIntakeError);
  });

  it('fails closed when returned storagePath differs from requested candidatePath', async () => {
    const session = createSampleSession('intake_2026_09', 'asset_2026_09');
    const storageReader = new FakeStorageReader();

    const candidatePath =
      'editorial_images/private/asset_2026_09/thumbnail.webp';
    // Reader returns metadata for a different path
    const mismatchedPath =
      'editorial_images/private/asset_2026_09/card.webp';

    storageReader.objects.set(
      candidatePath,
      createSampleMetadata(mismatchedPath, {
        ownership: {
          createdByIntakeId: 'intake_2026_09',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_09',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    await expect(
      discoverUntrackedEditorialImageObjects(session, storageReader)
    ).rejects.toThrow(EditorialBinaryIntakeError);

    try {
      await discoverUntrackedEditorialImageObjects(session, storageReader);
    } catch (err) {
      expect(err).toBeInstanceOf(EditorialBinaryIntakeError);
      const e = err as EditorialBinaryIntakeError;
      expect(e.code).toBe('STORAGE_FAILURE');
      expect(e.message).toContain('does not match requested candidatePath');
    }
  });

  it('flags conflict when ownership namespace contradicts the candidate namespace', async () => {
    const session = createSampleSession('intake_2026_10', 'asset_2026_10');
    const storageReader = new FakeStorageReader();

    const candidatePath =
      'editorial_images/private/asset_2026_10/thumbnail.webp';

    // Object is at private path, but ownership.namespace says 'quarantine'
    storageReader.objects.set(
      candidatePath,
      createSampleMetadata(candidatePath, {
        ownership: {
          createdByIntakeId: 'intake_2026_10',
          targetKind: 'editorial_image_asset',
          namespace: 'quarantine', // CONTRADICTS PRIVATE CANONICAL PATH!
          assetId: 'asset_2026_10',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    // Must NEVER be classified as owned or tracked
    expect(report.hasUntrackedOwnedObjects).toBe(false);
    expect(report.untrackedOwnedObjects).toHaveLength(0);
    expect(report.trackedObjects).toHaveLength(0);

    // Flagged as NAMESPACE_MISMATCH conflict
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].conflictReason).toBe('NAMESPACE_MISMATCH');
    expect(report.conflicts[0].storagePath).toBe(candidatePath);
  });

  it('flags generation conflict when same tracked path has contradictory generations in session lists', async () => {
    const trackedPath =
      'editorial_images/private/asset_2026_11/thumbnail.webp';

    const sessionObjA: TrackedIntakeStorageObject = {
      storagePath: trackedPath,
      namespace: 'private',
      generation: '176000000001',
      etag: 'etag_1',
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 1024,
      contentType: 'image/webp',
      createdByIntakeId: 'intake_2026_11',
    };

    const sessionObjB: TrackedIntakeStorageObject = {
      ...sessionObjA,
      generation: '176000000002', // CONTRADICTORY GENERATION IN CLEANUP LIST!
    };

    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_2026_11', 'asset_2026_11'),
      createdPrivateObjects: [sessionObjA],
      pendingCleanupObjects: [sessionObjB],
    };

    const storageReader = new FakeStorageReader();
    storageReader.objects.set(
      trackedPath,
      createSampleMetadata(trackedPath, {
        generation: '176000000001',
        ownership: {
          createdByIntakeId: 'intake_2026_11',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_11',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    // Must NOT arbitrarily pick one or classify as clean tracked/untracked
    expect(report.trackedObjects).toHaveLength(0);
    expect(report.untrackedOwnedObjects).toHaveLength(0);

    // Explicit GENERATION_MISMATCH conflict
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].conflictReason).toBe('GENERATION_MISMATCH');
    expect(report.conflicts[0].details).toContain('conflicting tracked receipts');
  });

  it('preserves clean tracked classification when duplicate tracked receipts agree on generation', async () => {
    const trackedPath =
      'editorial_images/private/asset_2026_12/card.webp';
    const agreedGen = '177000000001';

    const sessionObjA: TrackedIntakeStorageObject = {
      storagePath: trackedPath,
      namespace: 'private',
      generation: agreedGen,
      etag: 'etag_agreed',
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 2048,
      contentType: 'image/webp',
      createdByIntakeId: 'intake_2026_12',
    };

    // Appears in createdPrivateObjects AND pendingCleanupObjects with identical generation
    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_2026_12', 'asset_2026_12'),
      createdPrivateObjects: [sessionObjA],
      pendingCleanupObjects: [{ ...sessionObjA }],
    };

    const storageReader = new FakeStorageReader();
    storageReader.objects.set(
      trackedPath,
      createSampleMetadata(trackedPath, {
        generation: agreedGen,
        etag: 'etag_agreed',
        sizeBytes: 2048,
        ownership: {
          createdByIntakeId: 'intake_2026_12',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_12',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    expect(report.hasConflicts).toBe(false);
    expect(report.untrackedOwnedObjects).toHaveLength(0);
    expect(report.trackedObjects).toHaveLength(1);
    expect(report.trackedObjects[0].storagePath).toBe(trackedPath);
    expect(report.trackedObjects[0].generation).toBe(agreedGen);
  });

  it('flags conflict when duplicate receipts have same generation but different SHA-256', async () => {
    const trackedPath =
      'editorial_images/private/asset_2026_14/card.webp';
    const agreedGen = '178000000001';

    const sessionObjA: TrackedIntakeStorageObject = {
      storagePath: trackedPath,
      namespace: 'private',
      generation: agreedGen,
      etag: 'etag_178',
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 2048,
      contentType: 'image/webp',
      createdByIntakeId: 'intake_2026_14',
    };

    const sessionObjB: TrackedIntakeStorageObject = {
      ...sessionObjA,
      sha256Checksum:
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', // CONTRADICTORY SHA-256!
    };

    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_2026_14', 'asset_2026_14'),
      createdPrivateObjects: [sessionObjA],
      pendingCleanupObjects: [sessionObjB],
    };

    const storageReader = new FakeStorageReader();
    storageReader.objects.set(
      trackedPath,
      createSampleMetadata(trackedPath, {
        generation: agreedGen,
        etag: 'etag_178',
        sha256Checksum: sessionObjA.sha256Checksum,
        sizeBytes: 2048,
        contentType: 'image/webp',
        ownership: {
          createdByIntakeId: 'intake_2026_14',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_14',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    expect(report.trackedObjects).toHaveLength(0);
    expect(report.untrackedOwnedObjects).toHaveLength(0);
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].conflictReason).toBe('RECEIPT_METADATA_MISMATCH');
    expect(report.conflicts[0].details).toContain('sha256Checksum');
  });

  it('flags conflict when duplicate receipts have same generation but different size', async () => {
    const trackedPath =
      'editorial_images/private/asset_2026_15/thumbnail.webp';
    const agreedGen = '179000000001';

    const sessionObjA: TrackedIntakeStorageObject = {
      storagePath: trackedPath,
      namespace: 'private',
      generation: agreedGen,
      etag: 'etag_179',
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 1024,
      contentType: 'image/webp',
      createdByIntakeId: 'intake_2026_15',
    };

    const sessionObjB: TrackedIntakeStorageObject = {
      ...sessionObjA,
      sizeBytes: 9999, // CONTRADICTORY SIZE!
    };

    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_2026_15', 'asset_2026_15'),
      createdPrivateObjects: [sessionObjA],
      pendingCleanupObjects: [sessionObjB],
    };

    const storageReader = new FakeStorageReader();
    storageReader.objects.set(
      trackedPath,
      createSampleMetadata(trackedPath, {
        generation: agreedGen,
        etag: 'etag_179',
        sha256Checksum: sessionObjA.sha256Checksum,
        sizeBytes: 1024,
        contentType: 'image/webp',
        ownership: {
          createdByIntakeId: 'intake_2026_15',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_15',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    expect(report.trackedObjects).toHaveLength(0);
    expect(report.untrackedOwnedObjects).toHaveLength(0);
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].conflictReason).toBe('RECEIPT_METADATA_MISMATCH');
    expect(report.conflicts[0].details).toContain('sizeBytes');
  });

  it('flags conflict when duplicate receipts have contradictory ownership or namespace', async () => {
    const trackedPath =
      'editorial_images/private/asset_2026_16/article_cover.webp';
    const agreedGen = '180000000001';

    // 1. Contradictory ownership (createdByIntakeId)
    {
      const sessionObjA: TrackedIntakeStorageObject = {
        storagePath: trackedPath,
        namespace: 'private',
        generation: agreedGen,
        etag: 'etag_180',
        sha256Checksum:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sizeBytes: 4096,
        contentType: 'image/webp',
        createdByIntakeId: 'intake_2026_16',
      };

      const sessionObjB: TrackedIntakeStorageObject = {
        ...sessionObjA,
        createdByIntakeId: 'intake_other_session', // CONTRADICTORY INTAKE ID!
      };

      const session: EditorialBinaryIntakeSession = {
        ...createSampleSession('intake_2026_16', 'asset_2026_16'),
        createdPrivateObjects: [sessionObjA],
        pendingCleanupObjects: [sessionObjB],
      };

      const storageReader = new FakeStorageReader();
      storageReader.objects.set(
        trackedPath,
        createSampleMetadata(trackedPath, {
          generation: agreedGen,
          etag: 'etag_180',
          sha256Checksum: sessionObjA.sha256Checksum,
          sizeBytes: 4096,
          contentType: 'image/webp',
          ownership: {
            createdByIntakeId: 'intake_2026_16',
            targetKind: 'editorial_image_asset',
            namespace: 'private',
            assetId: 'asset_2026_16',
            uploaderUid: 'editor_admin_01',
          },
        })
      );

      const report = await discoverUntrackedEditorialImageObjects(
        session,
        storageReader
      );

      expect(report.trackedObjects).toHaveLength(0);
      expect(report.untrackedOwnedObjects).toHaveLength(0);
      expect(report.hasConflicts).toBe(true);
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].conflictReason).toBe('RECEIPT_METADATA_MISMATCH');
      expect(report.conflicts[0].details).toContain('createdByIntakeId');
    }

    // 2. Contradictory namespace
    {
      const sessionObjA: TrackedIntakeStorageObject = {
        storagePath: trackedPath,
        namespace: 'private',
        generation: agreedGen,
        etag: 'etag_180',
        sha256Checksum:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sizeBytes: 4096,
        contentType: 'image/webp',
        createdByIntakeId: 'intake_2026_16',
      };

      const sessionObjB: TrackedIntakeStorageObject = {
        ...sessionObjA,
        namespace: 'quarantine', // CONTRADICTORY NAMESPACE!
      };

      const session: EditorialBinaryIntakeSession = {
        ...createSampleSession('intake_2026_16', 'asset_2026_16'),
        createdPrivateObjects: [sessionObjA],
        pendingCleanupObjects: [sessionObjB],
      };

      const storageReader = new FakeStorageReader();
      storageReader.objects.set(
        trackedPath,
        createSampleMetadata(trackedPath, {
          generation: agreedGen,
          etag: 'etag_180',
          sha256Checksum: sessionObjA.sha256Checksum,
          sizeBytes: 4096,
          contentType: 'image/webp',
          ownership: {
            createdByIntakeId: 'intake_2026_16',
            targetKind: 'editorial_image_asset',
            namespace: 'private',
            assetId: 'asset_2026_16',
            uploaderUid: 'editor_admin_01',
          },
        })
      );

      const report = await discoverUntrackedEditorialImageObjects(
        session,
        storageReader
      );

      expect(report.trackedObjects).toHaveLength(0);
      expect(report.untrackedOwnedObjects).toHaveLength(0);
      expect(report.hasConflicts).toBe(true);
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].conflictReason).toBe('RECEIPT_METADATA_MISMATCH');
      expect(report.conflicts[0].details).toContain('namespace');
    }
  });

  it('flags conflict when single tracked receipt matches generation but conflicts with returned storage metadata', async () => {
    const trackedPath =
      'editorial_images/private/asset_2026_17/article_inline.webp';
    const agreedGen = '181000000001';

    const sessionObj: TrackedIntakeStorageObject = {
      storagePath: trackedPath,
      namespace: 'private',
      generation: agreedGen,
      etag: 'etag_receipt',
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 2048,
      contentType: 'image/webp',
      createdByIntakeId: 'intake_2026_17',
    };

    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession('intake_2026_17', 'asset_2026_17'),
      createdPrivateObjects: [sessionObj],
    };

    // Storage object has same generation but DIFFERENT checksum and size in storage!
    const storageReader = new FakeStorageReader();
    storageReader.objects.set(
      trackedPath,
      createSampleMetadata(trackedPath, {
        generation: agreedGen,
        etag: 'etag_storage',
        sha256Checksum:
          '1111111111111111111111111111111111111111111111111111111111111111',
        sizeBytes: 4096,
        contentType: 'image/webp',
        ownership: {
          createdByIntakeId: 'intake_2026_17',
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: 'asset_2026_17',
          uploaderUid: 'editor_admin_01',
        },
      })
    );

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    // Must NOT be classified as cleanly tracked, and must NOT be classified as untrackedOwned
    expect(report.trackedObjects).toHaveLength(0);
    expect(report.untrackedOwnedObjects).toHaveLength(0);
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].conflictReason).toBe('RECEIPT_METADATA_MISMATCH');
    expect(report.conflicts[0].details).toContain('differing fields');
  });

  it('fails closed when etag, contentType, createdAtIso, or MIME compatibility is invalid', async () => {
    const session = createSampleSession('intake_2026_13', 'asset_2026_13');
    const path = 'editorial_images/private/asset_2026_13/thumbnail.webp';

    // 1. Missing etag
    {
      const reader = new FakeStorageReader();
      reader.objects.set(
        path,
        createSampleMetadata(path, {
          etag: '',
          ownership: {
            createdByIntakeId: 'intake_2026_13',
            targetKind: 'editorial_image_asset',
            namespace: 'private',
            assetId: 'asset_2026_13',
            uploaderUid: 'editor_admin_01',
          },
        })
      );
      await expect(
        discoverUntrackedEditorialImageObjects(session, reader)
      ).rejects.toThrow(EditorialBinaryIntakeError);
    }

    // 2. Missing contentType
    {
      const reader = new FakeStorageReader();
      reader.objects.set(
        path,
        createSampleMetadata(path, {
          contentType: '   ',
          ownership: {
            createdByIntakeId: 'intake_2026_13',
            targetKind: 'editorial_image_asset',
            namespace: 'private',
            assetId: 'asset_2026_13',
            uploaderUid: 'editor_admin_01',
          },
        })
      );
      await expect(
        discoverUntrackedEditorialImageObjects(session, reader)
      ).rejects.toThrow(EditorialBinaryIntakeError);
    }

    // 3. Invalid createdAtIso timestamp
    {
      const reader = new FakeStorageReader();
      reader.objects.set(
        path,
        createSampleMetadata(path, {
          createdAtIso: 'invalid-date-string',
          ownership: {
            createdByIntakeId: 'intake_2026_13',
            targetKind: 'editorial_image_asset',
            namespace: 'private',
            assetId: 'asset_2026_13',
            uploaderUid: 'editor_admin_01',
          },
        })
      );
      await expect(
        discoverUntrackedEditorialImageObjects(session, reader)
      ).rejects.toThrow(EditorialBinaryIntakeError);
    }

    // 4. Incompatible MIME with path extension (.webp path but contentType is image/png)
    {
      const reader = new FakeStorageReader();
      reader.objects.set(
        path,
        createSampleMetadata(path, {
          contentType: 'image/png', // INCOMPATIBLE WITH .webp EXTENSION!
          ownership: {
            createdByIntakeId: 'intake_2026_13',
            targetKind: 'editorial_image_asset',
            namespace: 'private',
            assetId: 'asset_2026_13',
            uploaderUid: 'editor_admin_01',
          },
        })
      );
      await expect(
        discoverUntrackedEditorialImageObjects(session, reader)
      ).rejects.toThrow(EditorialBinaryIntakeError);
    }
  });

  it('strictly adheres to the 18-lookup bound and performs zero write or delete operations', async () => {
    const session = createSampleSession('intake_2026_08', 'asset_2026_08');
    const storageReader = new FakeStorageReader();

    const report = await discoverUntrackedEditorialImageObjects(
      session,
      storageReader
    );

    // Exactly 18 lookups
    expect(report.totalLookupsAttempted).toBe(18);
    expect(report.candidatePathsChecked).toHaveLength(18);
    expect(storageReader.lookups).toHaveLength(18);

    // Storage reader only has readMetadata; no writes or deletes exist on reader
    expect((storageReader as any).writeIfAbsent).toBeUndefined();
    expect((storageReader as any).deleteIfGenerationMatches).toBeUndefined();
  });
});
