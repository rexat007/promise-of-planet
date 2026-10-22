import { describe, expect, it } from 'vitest';
import {
  type EditorialImageReceiptReattachmentDependencies,
  reattachDiscoveredEditorialImageReceipts,
  MAX_REATTACHMENT_METADATA_LOOKUPS,
} from './editorialImageReceiptReattachment';
import {
  type EditorialBinaryIntakeSession,
  EditorialBinaryIntakeError,
  type IntakeSessionStore,
  type StorageObjectMetadata,
  type TrackedIntakeStorageObject,
} from './editorialBinaryIntakeService';
import {
  type EditorialImageAssetReadResult,
  type EditorialImageAssetRepository,
} from './editorialImageAssetRepository';
import { type EditorialImageAssetMetadata } from '../types/editorialImageAsset';
import { AdminRole } from '../shared/adminContract';

// ============================================================================
// Deterministic Test Helpers and In-Memory Mocks
// ============================================================================

class MockIntakeSessionStore implements IntakeSessionStore {
  public sessions = new Map<string, EditorialBinaryIntakeSession>();
  public readCount = 0;
  public updateCount = 0;
  public failUpdateWithRevisionConflict = false;
  public mutateSessionBetweenReads?: Partial<EditorialBinaryIntakeSession>;

  async getSessionById(
    intakeId: string
  ): Promise<EditorialBinaryIntakeSession | null> {
    this.readCount++;
    const s = this.sessions.get(intakeId);
    if (!s) return null;

    if (this.readCount >= 2 && this.mutateSessionBetweenReads) {
      return { ...s, ...this.mutateSessionBetweenReads };
    }
    return s;
  }

  async updateSession(
    session: EditorialBinaryIntakeSession,
    expectedRevision: number
  ): Promise<EditorialBinaryIntakeSession> {
    this.updateCount++;
    const existing = this.sessions.get(session.intakeId);
    if (!existing) {
      throw new EditorialBinaryIntakeError({
        code: 'NOT_FOUND',
        message: 'Session not found',
        intakeId: session.intakeId,
      });
    }

    if (this.failUpdateWithRevisionConflict || existing.revision !== expectedRevision) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_CONFLICT',
        message: `Revision conflict: expected ${expectedRevision}, actual ${existing.revision}`,
        intakeId: session.intakeId,
      });
    }

    const updated: EditorialBinaryIntakeSession = {
      ...session,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(session.intakeId, updated);
    return updated;
  }

  async createSessionIfAbsent(
    session: EditorialBinaryIntakeSession
  ): Promise<{ created: boolean; session: EditorialBinaryIntakeSession }> {
    if (this.sessions.has(session.intakeId)) {
      return { created: false, session: this.sessions.get(session.intakeId)! };
    }
    this.sessions.set(session.intakeId, session);
    return { created: true, session };
  }

  async listSessionsForReconciliation(): Promise<readonly EditorialBinaryIntakeSession[]> {
    return Array.from(this.sessions.values());
  }
}

class MockAssetRepository implements Pick<EditorialImageAssetRepository, 'getById'> {
  public assets = new Map<string, EditorialImageAssetMetadata>();
  public revisions = new Map<string, number>();
  public readCount = 0;
  public failNextWith?: Error;
  public returnFoundOnSecondRead = false;

  async getById(assetId: string): Promise<EditorialImageAssetReadResult> {
    this.readCount++;
    if (this.failNextWith) {
      const err = this.failNextWith;
      this.failNextWith = undefined;
      throw err;
    }

    if (this.returnFoundOnSecondRead && this.readCount >= 2) {
      const asset = createSampleCanonicalAsset(assetId);
      return {
        ok: true,
        status: 'FOUND',
        record: { assetId, revision: 1, asset },
        asset,
        revision: 1,
      };
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

class MockStorageAdapter {
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
  intakeId = 'intake_2026_reattach01',
  assetId = 'asset_2026_reattach01',
  status: EditorialBinaryIntakeSession['status'] = 'Created'
): EditorialBinaryIntakeSession {
  return {
    intakeId,
    targetKind: 'editorial_image_asset',
    assetId,
    uploaderUid: 'editor_admin_01',
    uploaderRole: AdminRole.ContentEditor,
    requestFingerprint: 'fp_abc123',
    status,
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
  intakeId: string,
  assetId: string,
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
      createdByIntakeId: intakeId,
      targetKind: 'editorial_image_asset',
      namespace: isQuarantine ? 'quarantine' : 'private',
      assetId,
      uploaderUid: 'editor_admin_01',
    },
    ...overrides,
  };
}

// ============================================================================
// Test Suite: IMG-F3-08B/B2 Safe Append-Only Receipt Reattachment
// ============================================================================

describe('IMG-F3-08B/B2 — reattachDiscoveredEditorialImageReceipts', () => {
  it('successfully recovers lost quarantine receipt in Created status via exact CAS revision increment', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps: EditorialImageReceiptReattachmentDependencies = {
      sessionStore,
      assetRepository,
      storageAdapter,
    };

    const intakeId = 'intake_2026_qrec';
    const assetId = 'asset_2026_qrec';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    // GCS contains quarantine object, but session missed receipt
    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageAdapter.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, intakeId, assetId)
    );

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.outcome).toBe('REATTACHED');
    expect(result.reasonCode).toBe('RECEIPTS_REATTACHED_SUCCESSFULLY');
    expect(result.sessionRevisionBefore).toBe(1);
    expect(result.sessionRevisionAfter).toBe(2);
    expect(result.sessionStatus).toBe('Created');
    expect(result.reattachedCount).toBe(1);
    expect(result.reattachedReceipts[0].storagePath).toBe(qPath);
    expect(result.reattachedReceipts[0].namespace).toBe('quarantine');
    expect(result.reattachedReceipts[0].generation).toBe('170000000100');

    // Verify session store was mutated exactly once via CAS
    expect(sessionStore.updateCount).toBe(1);
    const updated = sessionStore.sessions.get(intakeId)!;
    expect(updated.revision).toBe(2);
    expect(updated.createdQuarantineObjects).toHaveLength(1);
    expect(updated.createdQuarantineObjects[0].storagePath).toBe(qPath);
    expect(updated.status).toBe('Created'); // Status preserved!
    expect(updated.assetId).toBe(assetId); // Immutable fields preserved!
    expect(updated.uploaderUid).toBe(session.uploaderUid);
  });

  it('successfully recovers lost private variant receipt in Promoting status', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps: EditorialImageReceiptReattachmentDependencies = {
      sessionStore,
      assetRepository,
      storageAdapter,
    };

    const intakeId = 'intake_2026_prec';
    const assetId = 'asset_2026_prec';
    const session = createSampleSession(intakeId, assetId, 'Promoting');
    sessionStore.sessions.set(intakeId, session);

    // GCS contains private variant object
    const pPath = `editorial_images/private/${assetId}/thumbnail.webp`;
    storageAdapter.objects.set(
      pPath,
      createSampleStorageMetadata(pPath, intakeId, assetId)
    );

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.outcome).toBe('REATTACHED');
    expect(result.reattachedCount).toBe(1);
    expect(result.reattachedReceipts[0].storagePath).toBe(pPath);
    expect(result.reattachedReceipts[0].namespace).toBe('private');

    const updated = sessionStore.sessions.get(intakeId)!;
    expect(updated.revision).toBe(2);
    expect(updated.createdPrivateObjects).toHaveLength(1);
    expect(updated.createdPrivateObjects[0].storagePath).toBe(pPath);
    expect(updated.status).toBe('Promoting');
  });

  it('is idempotent on repeated invocation: returns NO_OP_ALREADY_TRACKED without duplicate lists or extra writes', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_idem';
    const assetId = 'asset_2026_idem';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageAdapter.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, intakeId, assetId)
    );

    // First invocation: reattaches receipt
    const firstResult = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);
    expect(firstResult.outcome).toBe('REATTACHED');
    expect(sessionStore.updateCount).toBe(1);

    // Second invocation: already tracked, live metadata verified
    const secondResult = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);
    expect(secondResult.outcome).toBe('NO_OP_ALREADY_TRACKED');
    expect(secondResult.reasonCode).toBe('ALL_RECEIPTS_ALREADY_TRACKED_AND_VERIFIED');
    expect(secondResult.reattachedCount).toBe(0);

    // Zero additional CAS writes occurred!
    expect(sessionStore.updateCount).toBe(1);

    // Session receipts list was not duplicated
    const finalSession = sessionStore.sessions.get(intakeId)!;
    expect(finalSession.createdQuarantineObjects).toHaveLength(1);
    expect(finalSession.revision).toBe(2);
  });

  it('handles post-CAS crash recovery: second invocation produces verified NO_OP_ALREADY_TRACKED', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_postcrash';
    const assetId = 'asset_2026_postcrash';

    // Simulate state where CAS previously committed at revision 2, but worker crashed before returning response
    const trackedReceipt: TrackedIntakeStorageObject = {
      storagePath: `editorial_intake_quarantine/images/${intakeId}/source.png`,
      namespace: 'quarantine',
      generation: '170000000100',
      etag: 'etag_170000000100',
      sha256Checksum:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 1024,
      contentType: 'image/png',
      createdByIntakeId: intakeId,
    };

    const session: EditorialBinaryIntakeSession = {
      ...createSampleSession(intakeId, assetId, 'Created'),
      revision: 2,
      createdQuarantineObjects: [trackedReceipt],
    };
    sessionStore.sessions.set(intakeId, session);

    // Live object in GCS matches receipt
    storageAdapter.objects.set(
      trackedReceipt.storagePath,
      createSampleStorageMetadata(trackedReceipt.storagePath, intakeId, assetId)
    );

    // Reattachment invocation verifies live metadata and detects already tracked
    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.outcome).toBe('NO_OP_ALREADY_TRACKED');
    expect(result.sessionRevisionBefore).toBe(2);
    expect(result.sessionRevisionAfter).toBe(2);
    expect(sessionStore.updateCount).toBe(0); // Zero writes
  });

  it('holds safely when CAS revision conflict occurs (no automatic write retry)', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_casrace';
    const assetId = 'asset_2026_casrace';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageAdapter.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, intakeId, assetId)
    );

    // Simulate CAS failure in sessionStore
    sessionStore.failUpdateWithRevisionConflict = true;

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.outcome).toBe('HOLD');
    expect(result.reasonCode).toBe('CAS_REVISION_CONFLICT');
    expect(result.details).toContain('Session CAS update failed');
    expect(sessionStore.updateCount).toBe(1); // Attempted once, never retried!
  });

  it('holds when canonical asset is FOUND or repository fails with READ_ERROR', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_canhold';
    const assetId = 'asset_2026_canhold';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageAdapter.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, intakeId, assetId)
    );

    // 1. Canonical asset is FOUND
    assetRepository.assets.set(assetId, createSampleCanonicalAsset(assetId));
    const resultFound = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);
    expect(resultFound.outcome).toBe('HOLD');
    expect(sessionStore.updateCount).toBe(0);

    // 2. Canonical repository read error
    assetRepository.assets.clear();
    assetRepository.failNextWith = new Error('Firestore connection timeout');
    const resultErr = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);
    expect(resultErr.outcome).toBe('HOLD');
    expect(sessionStore.updateCount).toBe(0);
  });

  it('holds when canonical registration occurs concurrently between discovery and pre-mutation re-read', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_concreg';
    const assetId = 'asset_2026_concreg';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageAdapter.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, intakeId, assetId)
    );

    // Initial read in B1 returns NOT_FOUND, but subsequent read returns FOUND
    assetRepository.returnFoundOnSecondRead = true;

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.outcome).toBe('HOLD');
    expect(sessionStore.updateCount).toBe(0);
  });

  it('holds for terminal sessions (Failed, Completed) and ineligible non-terminal statuses', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const ineligibleStatuses: EditorialBinaryIntakeSession['status'][] = [
      'Failed',
      'Completed',
      'Registering',
      'Registered',
      'CleanupPending',
      'NeedsReconciliation',
    ];

    for (const st of ineligibleStatuses) {
      sessionStore.updateCount = 0;
      const intakeId = `intake_2026_${st.toLowerCase()}`;
      const assetId = `asset_2026_${st.toLowerCase()}`;
      const session = createSampleSession(intakeId, assetId, st);
      sessionStore.sessions.set(intakeId, session);

      const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
      storageAdapter.objects.set(
        qPath,
        createSampleStorageMetadata(qPath, intakeId, assetId)
      );

      const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

      expect(result.outcome).toBe('HOLD');
      expect(sessionStore.updateCount).toBe(0);
    }
  });

  it('holds when candidate object namespace is incompatible with session status (private object in Created status)', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_incompat';
    const assetId = 'asset_2026_incompat';
    const session = createSampleSession(intakeId, assetId, 'Created'); // Created only allows quarantine
    sessionStore.sessions.set(intakeId, session);

    // Private object in storage
    const pPath = `editorial_images/private/${assetId}/thumbnail.webp`;
    storageAdapter.objects.set(
      pPath,
      createSampleStorageMetadata(pPath, intakeId, assetId)
    );

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.outcome).toBe('HOLD');
    expect(result.reasonCode).toBe('OBJECT_NAMESPACE_INCOMPATIBLE_WITH_STATUS');
    expect(sessionStore.updateCount).toBe(0);
  });

  it('holds when candidate object metadata mutates or object disappears between discovery and fresh verification', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_metaalter';
    const assetId = 'asset_2026_metaalter';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    const initialMeta = createSampleStorageMetadata(qPath, intakeId, assetId);
    storageAdapter.objects.set(qPath, initialMeta);

    // Wrap readMetadata to alter metadata on the fresh verification lookup (lookup #19)
    let callIdx = 0;
    const origReadMetadata = storageAdapter.readMetadata.bind(storageAdapter);
    storageAdapter.readMetadata = async (path: string) => {
      callIdx++;
      if (callIdx > 18 && path === qPath) {
        // Mutate generation on fresh candidate verification!
        return {
          ...initialMeta,
          generation: '999999999999', // CONTRADICTORY GENERATION!
        };
      }
      return origReadMetadata(path);
    };

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.outcome).toBe('HOLD');
    expect(result.reasonCode).toBe('CANDIDATE_METADATA_MUTATED_OR_DISAPPEARED');
    expect(sessionStore.updateCount).toBe(0);
  });

  it('holds when discovery detects foreign ownership or contradictory receipts', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_forhold';
    const assetId = 'asset_2026_forhold';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    // Foreign ownership
    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageAdapter.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, 'foreign_intake_owner', assetId)
    );

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.outcome).toBe('HOLD');
    expect(result.reasonCode).toBe('CONFLICT_HOLD');
    expect(sessionStore.updateCount).toBe(0);
  });

  it('strictly adheres to bounded lookups (<= 36 total metadata reads)', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_bound36';
    const assetId = 'asset_2026_bound36';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    const qPath = `editorial_intake_quarantine/images/${intakeId}/source.png`;
    storageAdapter.objects.set(
      qPath,
      createSampleStorageMetadata(qPath, intakeId, assetId)
    );

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    expect(result.totalMetadataLookupsAttempted).toBeLessThanOrEqual(
      MAX_REATTACHMENT_METADATA_LOOKUPS
    );
    expect(result.totalMetadataLookupsAttempted).toBeLessThanOrEqual(36);
    expect(storageAdapter.lookups.length).toBeLessThanOrEqual(36);
  });

  it('enforces zero GCS deletions/writes and zero public delivery', async () => {
    const sessionStore = new MockIntakeSessionStore();
    const assetRepository = new MockAssetRepository();
    const storageAdapter = new MockStorageAdapter();
    const deps = { sessionStore, assetRepository, storageAdapter };

    const intakeId = 'intake_2026_zeromut';
    const assetId = 'asset_2026_zeromut';
    const session = createSampleSession(intakeId, assetId, 'Created');
    sessionStore.sessions.set(intakeId, session);

    const result = await reattachDiscoveredEditorialImageReceipts(intakeId, deps);

    // Verify storage adapter has NO write or delete operations
    expect((storageAdapter as any).writeIfAbsent).toBeUndefined();
    expect((storageAdapter as any).deleteIfGenerationMatches).toBeUndefined();
    expect((assetRepository as any).createIfAbsent).toBeUndefined();

    // Verify result contains no public delivery URLs or deletion commands
    expect((result as any).publicUrl).toBeUndefined();
    expect((result as any).shouldDelete).toBeUndefined();
    expect((result as any).safeToDelete).toBeUndefined();
    expect((result as any).deletionPlan).toBeUndefined();
  });
});
