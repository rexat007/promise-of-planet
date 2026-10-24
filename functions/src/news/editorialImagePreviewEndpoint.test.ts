import { Buffer } from 'node:buffer';
import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { InMemoryAdminRepository } from '../admin/inMemoryAdminRepository';
import { AdminRole, type AdminUser } from '../shared/adminContract';
import { computeSha256Hex } from './editorialBinaryInspector';
import {
  type EditorialBinaryStorageAdapter,
  InMemoryEditorialBinaryStorageAdapter,
} from './editorialBinaryIntakeService';
import { InMemoryEditorialImageAssetRepository } from './inMemoryEditorialImageAssetRepository';
import {
  createProductionEditorialImagePreviewRuntime,
  type DecodedFirebaseIdToken,
  type EditorialImagePreviewHttpRequest,
  type EditorialImagePreviewHttpResponseWriter,
  executeEditorialImagePreviewEndpoint,
} from './editorialImagePreviewEndpoint';
import type {
  EditorialImageAssetMetadata,
  EditorialImageAssetVariant,
} from '../types/editorialImageAsset';

interface MockResponseState {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  binaryBuffer: Buffer | null;
}

function createMockResponseWriter(): {
  writer: EditorialImagePreviewHttpResponseWriter;
  state: MockResponseState;
} {
  const state: MockResponseState = {
    statusCode: 200,
    headers: {},
    body: null,
    binaryBuffer: null,
  };

  const writer: EditorialImagePreviewHttpResponseWriter = {
    status(code: number) {
      state.statusCode = code;
      return writer;
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return writer;
    },
    getHeader(name: string) {
      return state.headers[name.toLowerCase()];
    },
    json(body: unknown) {
      state.body = body;
    },
    send(body: Buffer | string) {
      if (Buffer.isBuffer(body)) {
        state.binaryBuffer = body;
      } else {
        state.body = body;
      }
    },
    end(chunk?: Buffer | string) {
      if (chunk && Buffer.isBuffer(chunk)) {
        state.binaryBuffer = chunk;
      }
    },
  };

  return { writer, state };
}

describe('IMG-F3-09/D2-E3-B1 — Private Editorial Image Preview Endpoint', () => {
  const TEST_ASSET_ID = 'asset_20261024_testpreview001';
  const CARD_PATH = `editorial_images/private/${TEST_ASSET_ID}/card.webp`;
  const THUMBNAIL_PATH = `editorial_images/private/${TEST_ASSET_ID}/thumbnail.webp`;

  const viewerUser: AdminUser = {
    id: 'uid_viewer_001',
    name: 'Editorial Viewer',
    email: 'viewer@promiseofplanet.org',
    role: AdminRole.Viewer,
    isActive: true,
  };

  const editorUser: AdminUser = {
    id: 'uid_editor_001',
    name: 'Content Editor',
    email: 'editor@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  };

  const inactiveUser: AdminUser = {
    id: 'uid_inactive_001',
    name: 'Inactive Admin',
    email: 'inactive@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: false,
  };

  const aiUser: AdminUser = {
    id: 'uid_ai_001',
    name: 'AI Agent',
    email: 'ai@promiseofplanet.org',
    role: AdminRole.AIAssistant,
    isActive: true,
  };

  let sampleWebpBytes: Buffer;
  let sampleWebpSha256: string;

  beforeAll(async () => {
    sampleWebpBytes = await sharp({
      create: {
        width: 800,
        height: 450,
        channels: 3,
        background: { r: 24, g: 130, b: 190 },
      },
    })
      .webp({ quality: 85 })
      .toBuffer();
    sampleWebpSha256 = computeSha256Hex(sampleWebpBytes);
  });

  function createTestHarness() {
    const adminRepo = new InMemoryAdminRepository();
    adminRepo.setRawAdmin(viewerUser.id, viewerUser);
    adminRepo.setRawAdmin(editorUser.id, editorUser);
    adminRepo.setRawAdmin(inactiveUser.id, inactiveUser);
    adminRepo.setRawAdmin(aiUser.id, aiUser);

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();

    const verifyIdToken = async (
      token: string
    ): Promise<DecodedFirebaseIdToken> => {
      if (token === 'token_viewer') {
        return { uid: viewerUser.id };
      }
      if (token === 'token_editor') {
        return { uid: editorUser.id };
      }
      if (token === 'token_inactive') {
        return { uid: inactiveUser.id };
      }
      if (token === 'token_ai') {
        return { uid: aiUser.id, role: AdminRole.AIAssistant };
      }
      if (token === 'token_ai_claim') {
        return { uid: viewerUser.id, isAiAssistant: true };
      }
      throw new Error('Invalid token');
    };

    const cardVariant: EditorialImageAssetVariant = {
      variantKey: 'card',
      storagePath: CARD_PATH,
      mimeType: 'image/webp',
      width: 800,
      height: 450,
      sizeBytes: sampleWebpBytes.length,
      sha256Checksum: sampleWebpSha256,
    };

    const thumbnailVariant: EditorialImageAssetVariant = {
      variantKey: 'thumbnail',
      storagePath: THUMBNAIL_PATH,
      mimeType: 'image/webp',
      width: 320,
      height: 180,
      sizeBytes: sampleWebpBytes.length,
      sha256Checksum: sampleWebpSha256,
    };

    const activeAsset: EditorialImageAssetMetadata = {
      assetId: TEST_ASSET_ID,
      createdByUid: editorUser.id,
      createdAtIso: '2026-10-24T10:00:00.000Z',
      updatedAtIso: '2026-10-24T10:00:00.000Z',
      origin: 'news_article',
      status: 'active',
      rights: {
        status: 'PendingReview',
      },
      originalFilename: 'ocean_conservation.png',
      mimeType: 'image/webp',
      originalSizeBytes: sampleWebpBytes.length,
      originalWidth: 1920,
      originalHeight: 1080,
      aspectRatio: 1.7777777777777777,
      sha256Checksum: sampleWebpSha256,
      variants: {
        card: cardVariant,
        thumbnail: thumbnailVariant,
      },
      altAr: 'صورة لحماية المحيطات',
      altEn: 'Ocean conservation image',
    };

    return {
      adminRepo,
      assetRepo,
      storageAdapter,
      verifyIdToken,
      activeAsset,
    };
  }

  // 1. Trusted CORS preflight
  it('1. handles trusted CORS preflight with HTTP 204 and explicit CORS headers', async () => {
    const harness = createTestHarness();
    const { writer, state } = createMockResponseWriter();

    await executeEditorialImagePreviewEndpoint(
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://promiseofplanet.org',
          'access-control-request-method': 'GET',
        },
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      }
    );

    expect(state.statusCode).toBe(204);
    expect(state.headers['access-control-allow-origin']).toBe(
      'https://promiseofplanet.org'
    );
    expect(state.headers['vary']).toBe('Origin');
    expect(state.headers['access-control-allow-methods']).toContain('GET');
  });

  // 2. Forbidden Origin
  it('2. rejects forbidden or wildcard Origin with HTTP 403', async () => {
    const harness = createTestHarness();

    for (const badOrigin of ['https://malicious-site.com', '*', 'null']) {
      const { writer, state } = createMockResponseWriter();

      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: TEST_ASSET_ID, variant: 'card' },
          headers: {
            origin: badOrigin,
            authorization: 'Bearer token_viewer',
          },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );

      expect(state.statusCode).toBe(403);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'CORS_ORIGIN_FORBIDDEN'
      );
      expect(state.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  // 3. Missing token
  it('3. rejects requests with missing Authorization header with HTTP 401', async () => {
    const harness = createTestHarness();
    const { writer, state } = createMockResponseWriter();

    await executeEditorialImagePreviewEndpoint(
      {
        method: 'GET',
        query: { assetId: TEST_ASSET_ID, variant: 'card' },
        headers: {},
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      }
    );

    expect(state.statusCode).toBe(401);
    expect((state.body as { errorCode: string }).errorCode).toBe(
      'UNAUTHENTICATED'
    );
  });

  // 4. Invalid token
  it('4. rejects invalid or expired Firebase ID token with HTTP 401', async () => {
    const harness = createTestHarness();
    const { writer, state } = createMockResponseWriter();

    await executeEditorialImagePreviewEndpoint(
      {
        method: 'GET',
        query: { assetId: TEST_ASSET_ID, variant: 'card' },
        headers: {
          authorization: 'Bearer invalid_or_expired_token',
        },
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      }
    );

    expect(state.statusCode).toBe(401);
    expect((state.body as { errorCode: string }).errorCode).toBe(
      'UNAUTHENTICATED'
    );
  });

  // 5. Inactive administrator
  it('5. rejects inactive administrator accounts with HTTP 403', async () => {
    const harness = createTestHarness();
    const { writer, state } = createMockResponseWriter();

    await executeEditorialImagePreviewEndpoint(
      {
        method: 'GET',
        query: { assetId: TEST_ASSET_ID, variant: 'card' },
        headers: {
          authorization: 'Bearer token_inactive',
        },
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      }
    );

    expect(state.statusCode).toBe(403);
    expect((state.body as { errorCode: string }).errorCode).toBe(
      'PERMISSION_DENIED'
    );
  });

  // 6. Viewer/editor authority according to canonical permissions
  it('6. authorizes both Viewer and ContentEditor administrators with AdminPermission.View', async () => {
    const harness = createTestHarness();
    await harness.assetRepo.createIfAbsent(harness.activeAsset);
    await harness.storageAdapter.writeIfAbsent({
      storagePath: CARD_PATH,
      bytes: sampleWebpBytes,
      contentType: 'image/webp',
      sha256Checksum: sampleWebpSha256,
      ownership: {
        createdByIntakeId: 'intake_20261024_0001',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: TEST_ASSET_ID,
        uploaderUid: editorUser.id,
      },
    });

    for (const token of ['token_viewer', 'token_editor']) {
      const { writer, state } = createMockResponseWriter();

      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: TEST_ASSET_ID, variant: 'card' },
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );

      expect(state.statusCode).toBe(200);
      expect(state.headers['content-type']).toBe('image/webp');
      expect(state.binaryBuffer).toBeDefined();
      expect(state.binaryBuffer?.length).toBe(sampleWebpBytes.length);
    }
  });

  // 7. AI principal rejection
  it('7. strictly rejects AI assistant identities with HTTP 403', async () => {
    const harness = createTestHarness();

    // Rejection by persisted admin role AIAssistant
    {
      const { writer, state } = createMockResponseWriter();
      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: TEST_ASSET_ID, variant: 'card' },
          headers: { authorization: 'Bearer token_ai' },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );
      expect(state.statusCode).toBe(403);
    }

    // Rejection by token claim isAiAssistant: true
    {
      const { writer, state } = createMockResponseWriter();
      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: TEST_ASSET_ID, variant: 'card' },
          headers: { authorization: 'Bearer token_ai_claim' },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );
      expect(state.statusCode).toBe(403);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'AI_PRINCIPAL_FORBIDDEN'
      );
    }
  });

  // 8. Invalid asset ID
  it('8. rejects malformed or whitespace assetId with HTTP 400', async () => {
    const harness = createTestHarness();

    for (const badId of [' asset_123', 'asset 123', '', '!!!invalid$$$']) {
      const { writer, state } = createMockResponseWriter();

      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: badId, variant: 'card' },
          headers: { authorization: 'Bearer token_viewer' },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );

      expect(state.statusCode).toBe(400);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'INVALID_ASSET_ID'
      );
    }
  });

  // 9. Path traversal
  it('9. rejects path traversal sequences in assetId with HTTP 400', async () => {
    const harness = createTestHarness();

    for (const traversalId of [
      '../evil',
      '..\\evil',
      '/etc/passwd',
      'asset_001/../../secret',
    ]) {
      const { writer, state } = createMockResponseWriter();

      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: traversalId, variant: 'card' },
          headers: { authorization: 'Bearer token_viewer' },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );

      expect(state.statusCode).toBe(400);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'INVALID_ASSET_ID'
      );
    }
  });

  // 10. Unknown variant
  it('10. rejects unknown variant names with HTTP 400', async () => {
    const harness = createTestHarness();

    for (const badVariant of ['original', 'banner', 'hero', 'huge', '']) {
      const { writer, state } = createMockResponseWriter();

      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: TEST_ASSET_ID, variant: badVariant },
          headers: { authorization: 'Bearer token_viewer' },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );

      expect(state.statusCode).toBe(400);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'INVALID_VARIANT'
      );
    }
  });

  // 11. Duplicate query values
  it('11. rejects duplicate query parameters (array inputs) with HTTP 400', async () => {
    const harness = createTestHarness();

    // Duplicate assetId
    {
      const { writer, state } = createMockResponseWriter();
      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: ['id1', 'id2'], variant: 'card' },
          headers: { authorization: 'Bearer token_viewer' },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );
      expect(state.statusCode).toBe(400);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'DUPLICATE_QUERY_PARAMETER'
      );
    }

    // Duplicate variant
    {
      const { writer, state } = createMockResponseWriter();
      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: TEST_ASSET_ID, variant: ['card', 'thumbnail'] },
          headers: { authorization: 'Bearer token_viewer' },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );
      expect(state.statusCode).toBe(400);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'DUPLICATE_QUERY_PARAMETER'
      );
    }
  });

  // 12. Missing asset
  it('12. returns HTTP 404 when requested asset does not exist in repository', async () => {
    const harness = createTestHarness();
    const { writer, state } = createMockResponseWriter();

    await executeEditorialImagePreviewEndpoint(
      {
        method: 'GET',
        query: { assetId: 'asset_20261024_nonexistent001', variant: 'card' },
        headers: { authorization: 'Bearer token_viewer' },
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      }
    );

    expect(state.statusCode).toBe(404);
    expect((state.body as { errorCode: string }).errorCode).toBe(
      'ASSET_NOT_FOUND'
    );
  });

  // 13. Non-active asset
  it('13. returns HTTP 404 when asset status is archived or deleted', async () => {
    const harness = createTestHarness();

    for (const status of ['archived', 'deleted'] as const) {
      const inactiveId = `asset_20261024_${status}001`;
      const inactiveAsset: EditorialImageAssetMetadata = {
        ...harness.activeAsset,
        assetId: inactiveId,
        status,
        variants: {
          card: {
            ...harness.activeAsset.variants.card!,
            storagePath: `editorial_images/private/${inactiveId}/card.webp`,
          },
          thumbnail: {
            ...harness.activeAsset.variants.thumbnail!,
            storagePath: `editorial_images/private/${inactiveId}/thumbnail.webp`,
          },
        },
      };
      harness.assetRepo.corruptStoredRecordForTesting(inactiveId, {
        assetId: inactiveId,
        revision: 1,
        asset: inactiveAsset,
      });

      const { writer, state } = createMockResponseWriter();
      await executeEditorialImagePreviewEndpoint(
        {
          method: 'GET',
          query: { assetId: inactiveAsset.assetId, variant: 'card' },
          headers: { authorization: 'Bearer token_viewer' },
        },
        writer,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepo,
          assetRepository: harness.assetRepo,
          storageAdapter: harness.storageAdapter,
        }
      );

      expect(state.statusCode).toBe(404);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'ASSET_NOT_ACTIVE'
      );
    }
  });

  // 14. Missing variant in asset
  it('14. returns HTTP 404 when asset does not contain the requested variant', async () => {
    const harness = createTestHarness();
    const noThumbId = 'asset_20261024_nothumbnail001';
    const assetWithoutThumbnail: EditorialImageAssetMetadata = {
      ...harness.activeAsset,
      assetId: noThumbId,
      variants: {
        card: {
          ...harness.activeAsset.variants.card!,
          storagePath: `editorial_images/private/${noThumbId}/card.webp`,
        },
      },
    };
    await harness.assetRepo.createIfAbsent(assetWithoutThumbnail);

    const { writer, state } = createMockResponseWriter();
    await executeEditorialImagePreviewEndpoint(
      {
        method: 'GET',
        query: { assetId: assetWithoutThumbnail.assetId, variant: 'thumbnail' },
        headers: { authorization: 'Bearer token_viewer' },
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      }
    );

    expect(state.statusCode).toBe(404);
    expect((state.body as { errorCode: string }).errorCode).toBe(
      'VARIANT_NOT_FOUND'
    );
  });

  // 15. Storage read failure
  it('15. returns sanitized HTTP 500 when storage read fails unexpectedly', async () => {
    const harness = createTestHarness();
    await harness.assetRepo.createIfAbsent(harness.activeAsset);

    const failingStorageAdapter: EditorialBinaryStorageAdapter = {
      writeIfAbsent: harness.storageAdapter.writeIfAbsent.bind(
        harness.storageAdapter
      ),
      readMetadata: harness.storageAdapter.readMetadata.bind(
        harness.storageAdapter
      ),
      readBytes: async () => {
        throw new Error('Simulated GCS network outage: gs://bucket/secret/path');
      },
      deleteIfGenerationMatches:
        harness.storageAdapter.deleteIfGenerationMatches.bind(
          harness.storageAdapter
        ),
    };

    const { writer, state } = createMockResponseWriter();
    await executeEditorialImagePreviewEndpoint(
      {
        method: 'GET',
        query: { assetId: TEST_ASSET_ID, variant: 'card' },
        headers: { authorization: 'Bearer token_viewer' },
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: failingStorageAdapter,
      }
    );

    expect(state.statusCode).toBe(500);
    expect((state.body as { errorCode: string }).errorCode).toBe(
      'STORAGE_FAILURE'
    );
    // Crucial: ensure no private GCS path or stack trace is leaked in response
    const rawResponseBody = JSON.stringify(state.body);
    expect(rawResponseBody).not.toContain('gs://');
    expect(rawResponseBody).not.toContain('secret/path');
    expect(rawResponseBody).not.toContain('Simulated GCS');
  });

  // 16. Successful 200 WebP binary response
  it('16. delivers genuine WebP binary with HTTP 200 and strict security headers', async () => {
    const harness = createTestHarness();
    await harness.assetRepo.createIfAbsent(harness.activeAsset);
    await harness.storageAdapter.writeIfAbsent({
      storagePath: CARD_PATH,
      bytes: sampleWebpBytes,
      contentType: 'image/webp',
      sha256Checksum: sampleWebpSha256,
      ownership: {
        createdByIntakeId: 'intake_20261024_0001',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: TEST_ASSET_ID,
        uploaderUid: editorUser.id,
      },
    });

    const { writer, state } = createMockResponseWriter();
    await executeEditorialImagePreviewEndpoint(
      {
        method: 'GET',
        query: { assetId: TEST_ASSET_ID, variant: 'card' },
        headers: {
          authorization: 'Bearer token_viewer',
          origin: 'https://promiseofplanet.org',
        },
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      }
    );

    expect(state.statusCode).toBe(200);
    expect(state.headers['content-type']).toBe('image/webp');
    expect(state.headers['cache-control']).toBe('no-store');
    expect(state.headers['x-content-type-options']).toBe('nosniff');
    expect(state.headers['content-security-policy']).toBe("default-src 'none'");
    expect(state.headers['access-control-allow-origin']).toBe(
      'https://promiseofplanet.org'
    );
    expect(state.binaryBuffer).toEqual(sampleWebpBytes);
  });

  // 17. Verify no storage path disclosure
  it('17. never discloses private storage paths or bucket names in any headers or error responses', async () => {
    const harness = createTestHarness();
    await harness.assetRepo.createIfAbsent(harness.activeAsset);

    const testRequests: Array<{
      method: string;
      query: Record<string, unknown>;
      headers: Record<string, string>;
    }> = [
      {
        method: 'GET',
        query: { assetId: 'unknown_asset', variant: 'card' },
        headers: { authorization: 'Bearer token_viewer' },
      },
      {
        method: 'GET',
        query: { assetId: TEST_ASSET_ID, variant: 'unknown' },
        headers: { authorization: 'Bearer token_viewer' },
      },
      {
        method: 'POST',
        query: { assetId: TEST_ASSET_ID, variant: 'card' },
        headers: { authorization: 'Bearer token_viewer' },
      },
    ];

    for (const req of testRequests) {
      const { writer, state } = createMockResponseWriter();
      await executeEditorialImagePreviewEndpoint(req, writer, {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      });

      const bodyStr = JSON.stringify(state.body ?? {});
      const headersStr = JSON.stringify(state.headers);

      expect(bodyStr).not.toContain('editorial_images/private');
      expect(bodyStr).not.toContain('gs://');
      expect(headersStr).not.toContain('editorial_images/private');
      expect(headersStr).not.toContain('gs://');
    }
  });

  // 18. Verify no Firestore/Storage mutation on GET
  it('18. guarantees zero Firestore database or Storage mutations on GET preview requests', async () => {
    const harness = createTestHarness();
    await harness.assetRepo.createIfAbsent(harness.activeAsset);
    await harness.storageAdapter.writeIfAbsent({
      storagePath: CARD_PATH,
      bytes: sampleWebpBytes,
      contentType: 'image/webp',
      sha256Checksum: sampleWebpSha256,
      ownership: {
        createdByIntakeId: 'intake_20261024_0001',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: TEST_ASSET_ID,
        uploaderUid: editorUser.id,
      },
    });

    const beforeAssetResult = await harness.assetRepo.getById(TEST_ASSET_ID);
    expect(beforeAssetResult.ok).toBe(true);
    const beforeRevision = beforeAssetResult.revision;

    const { writer, state } = createMockResponseWriter();
    await executeEditorialImagePreviewEndpoint(
      {
        method: 'GET',
        query: { assetId: TEST_ASSET_ID, variant: 'card' },
        headers: { authorization: 'Bearer token_viewer' },
      },
      writer,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepo,
        assetRepository: harness.assetRepo,
        storageAdapter: harness.storageAdapter,
      }
    );

    expect(state.statusCode).toBe(200);

    const afterAssetResult = await harness.assetRepo.getById(TEST_ASSET_ID);
    expect(afterAssetResult.ok).toBe(true);
    expect(afterAssetResult.revision).toBe(beforeRevision);
    expect(afterAssetResult.asset).toEqual(beforeAssetResult.asset);
  });

  // 19. Production runtime factory smoke test
  it('19. constructs production runtime cleanly without dependency errors', async () => {
    const fakeFirestore = {
      collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
      runTransaction: async () => {},
    };
    const fakeBucket = {
      name: 'test-bucket',
      file: () => ({ name: 'test-file' }),
    };
    const fakeStorage = {
      bucket: () => fakeBucket,
    };
    let checkRevokedPassed = false;
    const fakeAuth = {
      verifyIdToken: async (idToken: string, checkRevoked?: boolean) => {
        checkRevokedPassed = checkRevoked === true;
        return { uid: `uid_${idToken}` };
      },
    };

    const runtime = createProductionEditorialImagePreviewRuntime({
      adminRepository: new InMemoryAdminRepository(),
      getFirestore: () => fakeFirestore,
      getStorage: () => fakeStorage,
      getAuth: () => fakeAuth,
    });

    expect(runtime).toBeDefined();
    expect(typeof runtime.verifyIdToken).toBe('function');
    expect(runtime.adminRepository).toBeDefined();
    expect(runtime.assetRepository).toBeDefined();
    expect(runtime.storageAdapter).toBeDefined();

    const verified = await runtime.verifyIdToken('sample');
    expect(verified.uid).toBe('uid_sample');
    expect(checkRevokedPassed).toBe(true);
  });
});
