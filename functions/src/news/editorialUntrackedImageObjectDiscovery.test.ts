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
