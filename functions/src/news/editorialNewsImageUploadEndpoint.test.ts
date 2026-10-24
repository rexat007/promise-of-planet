import { Buffer } from 'node:buffer';
import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { InMemoryAdminRepository } from '../admin/inMemoryAdminRepository';
import { AdminRole, type AdminUser } from '../shared/adminContract';
import { buildEditorialImageVariantStoragePath } from '../shared/editorialImageAssetContract';
import {
  EDITORIAL_IMAGE_ASSET_REQUIRED_VARIANT_KEYS,
  EditorialBinaryIntakeService,
  InMemoryEditorialBinaryStorageAdapter,
  InMemoryIntakeSessionStore,
} from './editorialBinaryIntakeService';
import {
  EditorialImageRightsReviewService,
  InMemoryEditorialImageRightsReviewRunner,
} from './editorialImageRightsReviewService';
import { FirestoreEditorialBinaryIntakeSessionStore } from './firestoreEditorialBinaryIntakeSessionStore';
import { FirestoreEditorialImageAssetRepository } from './firestoreEditorialImageAssetRepository';
import { GcsEditorialBinaryStorageAdapter } from './gcsEditorialBinaryStorageAdapter';
import { InMemoryEditorialImageAssetRepository } from './inMemoryEditorialImageAssetRepository';
import {
  createProductionEditorialNewsImageUploadRuntime,
  type DecodedFirebaseIdToken,
  type EditorialNewsImageUploadEndpointDependencies,
  type EditorialNewsImageUploadHttpRequest,
  type EditorialNewsImageUploadHttpResponseWriter,
  type EditorialNewsImageUploadResponseBody,
  executeEditorialNewsImageUploadEndpoint,
} from './editorialNewsImageUploadEndpoint';

/**
 * IMG-F3-09/B — Secure News Image Binary Intake Endpoint Tests
 *
 * Covers:
 * - Production dependency assembly proof (zero mocks in production factory)
 * - Valid human admin uploads for PNG, JPEG, and WebP
 * - Successful 5-variant WebP processing and PendingReview rights default
 * - Unauthorized, unregistered, and inactive accounts
 * - AI assistant rejection (both via token claim and persisted AdminRole.AIAssistant)
 * - Missing, malformed, or invalid Firebase ID token
 * - Safe handling of HTTP methods, Content-Type headers, and trusted-origin CORS
 * - Oversized, empty, and corrupt image binaries
 * - Invalid identifiers (intakeId, assetId, originalFilename, origin, spoofed fields)
 * - GCS object collision and no unauthorized deletion of pre-existing objects
 * - Storage and canonical registration failures + lost-commit fail-closed CAS semantics
 * - Strict response sanitization (no private bucket paths, raw bytes, session state, or public URLs)
 */

let validPngBuffer: Buffer;
let validJpegBuffer: Buffer;
let validWebpBuffer: Buffer;

beforeAll(async () => {
  validPngBuffer = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 4,
      background: { r: 30, g: 120, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  validJpegBuffer = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 200, g: 80, b: 40 },
    },
  })
    .jpeg({ quality: 88 })
    .toBuffer();

  validWebpBuffer = await sharp({
    create: {
      width: 500,
      height: 400,
      channels: 3,
      background: { r: 40, g: 170, b: 110 },
    },
  })
    .webp({ quality: 85 })
    .toBuffer();
});

class MockResponseCapture implements EditorialNewsImageUploadHttpResponseWriter {
  public statusCode = 200;
  public readonly headers = new Map<string, string>();
  public body: EditorialNewsImageUploadResponseBody | undefined = undefined;
  public ended = false;

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  status(code: number): EditorialNewsImageUploadHttpResponseWriter {
    this.statusCode = code;
    return this;
  }

  json(body: EditorialNewsImageUploadResponseBody): unknown {
    this.body = body;
    return this;
  }

  end(): unknown {
    this.ended = true;
    return this;
  }
}

interface TestHarness {
  readonly adminRepo: InMemoryAdminRepository;
  readonly assetRepo: InMemoryEditorialImageAssetRepository;
  readonly rightsRunner: InMemoryEditorialImageRightsReviewRunner;
  readonly rightsService: EditorialImageRightsReviewService;
  readonly storage: InMemoryEditorialBinaryStorageAdapter;
  readonly sessionStore: InMemoryIntakeSessionStore;
  readonly intakeService: EditorialBinaryIntakeService;
  readonly tokens: Map<string, DecodedFirebaseIdToken>;
  readonly deps: EditorialNewsImageUploadEndpointDependencies;
}

async function createEndpointHarness(options?: {
  readonly maxUploadBytes?: number;
}): Promise<TestHarness> {
  const adminRepo = new InMemoryAdminRepository();
  const assetRepo = new InMemoryEditorialImageAssetRepository();
  const rightsRunner = new InMemoryEditorialImageRightsReviewRunner(
    undefined,
    adminRepo
  );
  const rightsService = new EditorialImageRightsReviewService({
    adminRepository: adminRepo,
    transactionRunner: rightsRunner,
    clock: () => '2026-10-22T10:00:00.000Z',
  });
  const storage = new InMemoryEditorialBinaryStorageAdapter({
    clock: () => '2026-10-22T10:00:00.000Z',
  });
  const sessionStore = new InMemoryIntakeSessionStore();

  const intakeService = new EditorialBinaryIntakeService({
    adminRepository: adminRepo,
    assetRepository: assetRepo,
    rightsEvidenceBridge: rightsService,
    storageAdapter: storage,
    sessionStore,
    clock: () => '2026-10-22T10:00:00.000Z',
  });

  const activeEditor: AdminUser = {
    id: 'admin_editor_1',
    name: 'Nadia Mansour',
    email: 'nadia@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  };
  const activeWriter: AdminUser = {
    id: 'admin_writer_1',
    name: 'Karim Saleh',
    email: 'karim@promiseofplanet.org',
    role: AdminRole.RightsReviewer,
    isActive: true,
  };
  const inactiveEditor: AdminUser = {
    id: 'admin_inactive_1',
    name: 'Inactive Editor',
    email: 'inactive@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: false,
  };
  const viewerOnly: AdminUser = {
    id: 'admin_viewer_1',
    name: 'Read Only Viewer',
    email: 'viewer@promiseofplanet.org',
    role: AdminRole.Viewer,
    isActive: true,
  };
  const aiAssistantUser: AdminUser = {
    id: 'admin_ai_1',
    name: 'Editorial AI Bot',
    email: 'ai@promiseofplanet.org',
    role: AdminRole.AIAssistant,
    isActive: true,
  };

  await adminRepo.saveAdmin(activeEditor);
  await adminRepo.saveAdmin(activeWriter);
  await adminRepo.saveAdmin(inactiveEditor);
  await adminRepo.saveAdmin(viewerOnly);
  await adminRepo.saveAdmin(aiAssistantUser);

  const tokens = new Map<string, DecodedFirebaseIdToken>([
    ['valid_editor_token', { uid: 'admin_editor_1' }],
    ['valid_writer_token', { uid: 'admin_writer_1' }],
    ['inactive_editor_token', { uid: 'admin_inactive_1' }],
    ['viewer_only_token', { uid: 'admin_viewer_1' }],
    ['ai_role_record_token', { uid: 'admin_ai_1' }],
    [
      'ai_claim_token',
      { uid: 'admin_editor_1', role: AdminRole.AIAssistant, isAiAssistant: true },
    ],
    ['unregistered_user_token', { uid: 'unregistered_uid_99' }],
  ]);

  const deps: EditorialNewsImageUploadEndpointDependencies = {
    verifyIdToken: async (token: string) => {
      const found = tokens.get(token);
      if (!found) {
        throw new Error('Firebase ID token is invalid or expired.');
      }
      return found;
    },
    adminRepository: adminRepo,
    intakeService,
    ...(options?.maxUploadBytes !== undefined
      ? { maxUploadBytes: options.maxUploadBytes }
      : {}),
  };

  return {
    adminRepo,
    assetRepo,
    rightsRunner,
    rightsService,
    storage,
    sessionStore,
    intakeService,
    tokens,
    deps,
  };
}

function buildMetadataHeader(meta: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(meta));
}

describe('IMG-F3-09/B — Dependency Assembly Gate & Production Runtime Proof', () => {
  it('assembles all required EditorialBinaryIntakeService dependencies using genuine production adapters without mocks', async () => {
    const fakeFirestore = {
      collection: (_name: string) => ({
        doc: (id: string) => ({ id }),
        where: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }) }),
            limit: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }),
          }),
          orderBy: () => ({ limit: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }) }),
          limit: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }),
        }),
      }),
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({
          get: async () => ({ exists: false, data: () => undefined }),
          create: () => undefined,
          set: () => undefined,
        }),
    };

    const fakeBucket = {
      name: 'pop-private-bucket',
      file: (name: string) => ({
        name,
        save: async () => undefined,
        getMetadata: async () => [{ generation: '1', size: 100 }],
        delete: async () => undefined,
      }),
    };

    let verifyCalledWithRevocationCheck = false;
    const runtime = createProductionEditorialNewsImageUploadRuntime({
      adminRepository: new InMemoryAdminRepository(),
      getFirestore: () => fakeFirestore,
      getStorage: () => ({ bucket: () => fakeBucket }),
      getAuth: () => ({
        verifyIdToken: async (idToken: string, checkRevoked?: boolean) => {
          verifyCalledWithRevocationCheck = checkRevoked === true;
          return { uid: `verified_${idToken}` };
        },
      }),
    });

    expect(runtime.assetRepository).toBeInstanceOf(
      FirestoreEditorialImageAssetRepository
    );
    expect(runtime.rightsEvidenceBridge).toBeInstanceOf(
      EditorialImageRightsReviewService
    );
    expect(runtime.storageAdapter).toBeInstanceOf(
      GcsEditorialBinaryStorageAdapter
    );
    expect(runtime.sessionStore).toBeInstanceOf(
      FirestoreEditorialBinaryIntakeSessionStore
    );
    expect(runtime.intakeService).toBeInstanceOf(EditorialBinaryIntakeService);
    expect(typeof runtime. rightsEvidenceBridge.registerRightsEvidence).toBe(
      'function'
    );

    const decoded = await runtime.verifyIdToken('tok_123');
    expect(decoded.uid).toBe('verified_tok_123');
    expect(verifyCalledWithRevocationCheck).toBe(true);
  });
});

describe('IMG-F3-09/B — Valid Human Admin Uploads (PNG, JPEG, WebP) & 5-Variant Processing', () => {
  it('uploads PNG, JPEG, and WebP images for an active human admin, processes 5 WebP variants, defaults rights to PendingReview, and returns a minimal sanitized response', async () => {
    const harness = await createEndpointHarness();

    const cases = [
      {
        label: 'PNG',
        intakeId: 'intake_png_001',
        assetId: 'asset_png_001',
        filename: 'forest-canopy.png',
        mime: 'image/png',
        buffer: validPngBuffer,
      },
      {
        label: 'JPEG',
        intakeId: 'intake_jpg_001',
        assetId: 'asset_jpg_001',
        filename: 'desert-solar.jpg',
        mime: 'image/jpeg',
        buffer: validJpegBuffer,
      },
      {
        label: 'WebP',
        intakeId: 'intake_webp_001',
        assetId: 'asset_webp_001',
        filename: 'coastal-reef.webp',
        mime: 'image/webp',
        buffer: validWebpBuffer,
      },
    ] as const;

    for (const c of cases) {
      const req: EditorialNewsImageUploadHttpRequest = {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          Origin: 'https://promiseofplanet.org',
          'Content-Type': c.mime,
          'Content-Length': String(c.buffer.byteLength),
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: c.intakeId,
            assetId: c.assetId,
            originalFilename: c.filename,
            origin: 'news_article',
            altAr: 'صورة بيئية توثيقية للمقال الإخباري',
            altEn: 'Documentary environmental image for news article',
            captionAr: 'لقطة ميدانية',
            photographerCredit: 'Promise of Planet Lens',
          }),
        },
        rawBody: c.buffer,
      };

      const res = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(req, res, harness.deps);

      expect(res.statusCode).toBe(201);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://promiseofplanet.org'
      );
      expect(res.body).toEqual({
        ok: true,
        intakeId: c.intakeId,
        assetId: c.assetId,
        status: 'Completed',
      });

      // Verify response never exposes private bucket paths, raw bytes, session state, or rights approval
      const serializedResponse = JSON.stringify(res.body);
      expect(serializedResponse).not.toContain('editorial_images/private');
      expect(serializedResponse).not.toContain('editorial_intake_quarantine');
      expect(serializedResponse).not.toContain('gs://');
      expect(serializedResponse).not.toContain('https://');
      expect(serializedResponse).not.toContain('Approved');
      expect(serializedResponse).not.toContain('storagePath');

      // Verify all 5 processed WebP variants exist in private storage and differ from source bytes
      for (const variantKey of EDITORIAL_IMAGE_ASSET_REQUIRED_VARIANT_KEYS) {
        const expectedPath = buildEditorialImageVariantStoragePath(
          c.assetId,
          variantKey,
          'image/webp'
        );
        const storedObj = await harness.storage.readBytes(expectedPath);
        expect(storedObj).not.toBeNull();
        expect(storedObj!.metadata.contentType).toBe('image/webp');
        expect(storedObj!.metadata.ownership.namespace).toBe('private');
        expect(storedObj!.metadata.ownership.createdByIntakeId).toBe(c.intakeId);

        const decodedMeta = await sharp(storedObj!.bytes).metadata();
        expect(decodedMeta.format).toBe('webp');
      }

      // Verify quarantine object was cleaned up upon completion
      const session = await harness.sessionStore.getSessionById(c.intakeId);
      expect(session?.status).toBe('Completed');
      expect(session?.pendingCleanupObjects).toHaveLength(0);

      // Verify canonical asset record in repository has PendingReview rights status
      const assetRead = await harness.assetRepo.getById(c.assetId);
      expect(assetRead.status).toBe('FOUND');
      if (assetRead.status === 'FOUND') {
        expect(assetRead.record.asset.rights.status).toBe('PendingReview');
        expect(assetRead.record.asset.createdByUid).toBe('admin_editor_1');
        expect(assetRead.record.asset.mimeType).toBe(c.mime);
      }
    }
  });
});

describe('IMG-F3-09/B — Authentication, Authorization & AI Assistant Rejection', () => {
  it('rejects missing, malformed, or invalid Firebase ID tokens with 401 and WWW-Authenticate: Bearer', async () => {
    const harness = await createEndpointHarness();

    const invalidAuthHeaders: Array<Record<string, string | undefined>> = [
      {},
      { Authorization: '' },
      { Authorization: 'Basic dXNlcjpwYXNz' },
      { Authorization: 'Bearer ' },
      { Authorization: 'Bearer expired_or_unknown_token' },
      { Authorization: '  Bearer valid_editor_token' },
    ];

    for (const authHeader of invalidAuthHeaders) {
      const res = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method: 'POST',
          headers: {
            ...authHeader,
            'Content-Type': 'image/png',
            'X-Editorial-Image-Metadata': buildMetadataHeader({
              intakeId: 'intake_unauth_1',
              assetId: 'asset_unauth_1',
              originalFilename: 'photo.png',
              origin: 'news_article',
              altAr: 'وصف الصورة',
            }),
          },
          rawBody: validPngBuffer,
        },
        res,
        harness.deps
      );

      expect(res.statusCode).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(res.body).toEqual({
        ok: false,
        intakeId: 'intake_unauth_1',
        assetId: 'asset_unauth_1',
        status: 'Rejected',
        errorCode: 'UNAUTHENTICATED',
      });
    }

    // Confirm zero sessions or storage objects were created
    expect(harness.storage.getStoredObjectCount()).toBe(0);
    expect(
      await harness.sessionStore.getSessionById('intake_unauth_1')
    ).toBeNull();
  });

  it('rejects unregistered, inactive, and viewer-only accounts with 403 PERMISSION_DENIED', async () => {
    const harness = await createEndpointHarness();

    const forbiddenTokens = [
      'unregistered_user_token',
      'inactive_editor_token',
      'viewer_only_token',
    ];

    for (const token of forbiddenTokens) {
      const res = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'image/png',
            'X-Editorial-Image-Metadata': buildMetadataHeader({
              intakeId: `intake_forbid_${token}`,
              assetId: `asset_forbid_${token}`,
              originalFilename: 'photo.png',
              origin: 'news_article',
              altAr: 'وصف الصورة',
            }),
          },
          rawBody: validPngBuffer,
        },
        res,
        harness.deps
      );

      expect(res.statusCode).toBe(403);
      expect(res.body?.ok).toBe(false);
      expect(res.body?.errorCode).toBe('PERMISSION_DENIED');
    }

    expect(harness.storage.getStoredObjectCount()).toBe(0);
  });

  it('strictly rejects AI assistant identities both from token claims and from AdminRepository role records', async () => {
    const harness = await createEndpointHarness();

    for (const aiToken of ['ai_role_record_token', 'ai_claim_token']) {
      const res = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aiToken}`,
            'Content-Type': 'image/png',
            'X-Editorial-Image-Metadata': buildMetadataHeader({
              intakeId: `intake_${aiToken}`,
              assetId: `asset_${aiToken}`,
              originalFilename: 'photo.png',
              origin: 'news_article',
              altAr: 'وصف الصورة',
            }),
          },
          rawBody: validPngBuffer,
        },
        res,
        harness.deps
      );

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        ok: false,
        intakeId: `intake_${aiToken}`,
        assetId: `asset_${aiToken}`,
        status: 'Rejected',
        errorCode: 'PERMISSION_DENIED',
      });
    }

    expect(harness.storage.getStoredObjectCount()).toBe(0);
  });
});

describe('IMG-F3-09/B — HTTP Method, Content-Type, and Trusted Origin / CORS Enforcement', () => {
  it('enforces POST-only method and returns 405 with Allow: POST for GET, PUT, DELETE, PATCH, and non-preflight OPTIONS', async () => {
    const harness = await createEndpointHarness();

    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const res = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method,
          headers: {
            Authorization: 'Bearer valid_editor_token',
          },
        },
        res,
        harness.deps
      );

      expect(res.statusCode).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expect(res.body).toEqual({
        ok: false,
        status: 'Rejected',
        errorCode: 'HTTP_METHOD_NOT_ALLOWED',
      });
    }
  });

  it('enforces explicit trusted-origin CORS policy, rejecting untrusted or wildcard origins with 403 and handling valid preflight OPTIONS with 204', async () => {
    const harness = await createEndpointHarness();

    // 1. Untrusted origin on POST -> 403
    const untrustedRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Origin: 'https://evil-attacker.example.com',
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
        },
        rawBody: validPngBuffer,
      },
      untrustedRes,
      harness.deps
    );
    expect(untrustedRes.statusCode).toBe(403);
    expect(untrustedRes.headers.get('access-control-allow-origin')).toBeUndefined();
    expect(untrustedRes.body).toEqual({
      ok: false,
      status: 'Rejected',
      errorCode: 'CORS_ORIGIN_FORBIDDEN',
    });

    // 2. Wildcard Origin header -> 403
    const wildcardRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Origin: '*',
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
        },
        rawBody: validPngBuffer,
      },
      wildcardRes,
      harness.deps
    );
    expect(wildcardRes.statusCode).toBe(403);
    expect(wildcardRes.body?.errorCode).toBe('CORS_ORIGIN_FORBIDDEN');

    // 3. Valid trusted origin preflight OPTIONS -> 204
    const preflightRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://promiseofplanet.org',
          'Access-Control-Request-Method': 'POST',
        },
      },
      preflightRes,
      harness.deps
    );
    expect(preflightRes.statusCode).toBe(204);
    expect(preflightRes.ended).toBe(true);
    expect(preflightRes.headers.get('access-control-allow-origin')).toBe(
      'https://promiseofplanet.org'
    );
    expect(preflightRes.headers.get('vary')).toBe('Origin');
  });

  it('allows production hosting origins (https://promiseofplanet-bb325.web.app and https://promiseofplanet-bb325.firebaseapp.com) via CORS preflight while preserving auth gate for POST', async () => {
    const harness = await createEndpointHarness();

    const productionOrigins = [
      'https://promiseofplanet-bb325.web.app',
      'https://promiseofplanet-bb325.firebaseapp.com',
    ];

    for (const origin of productionOrigins) {
      // 1. OPTIONS preflight succeeds with 204 and exact Access-Control-Allow-Origin
      const preflightRes = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
          },
        },
        preflightRes,
        harness.deps
      );
      expect(preflightRes.statusCode).toBe(204);
      expect(preflightRes.ended).toBe(true);
      expect(preflightRes.headers.get('access-control-allow-origin')).toBe(origin);
      expect(preflightRes.headers.get('vary')).toBe('Origin');
      expect(preflightRes.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');

      // 2. POST from production origin without auth header is rejected with 401 UNAUTHENTICATED
      const unauthPostRes = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'image/png',
          },
          rawBody: validPngBuffer,
        },
        unauthPostRes,
        harness.deps
      );
      expect(unauthPostRes.statusCode).toBe(401);
      expect(unauthPostRes.headers.get('access-control-allow-origin')).toBe(origin);
      expect(unauthPostRes.body?.errorCode).toBe('UNAUTHENTICATED');

      // 3. POST from production origin with viewer-only role is rejected with 403 PERMISSION_DENIED
      const viewerPostRes = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Origin: origin,
            Authorization: 'Bearer viewer_only_token',
            'Content-Type': 'image/png',
          },
          rawBody: validPngBuffer,
        },
        viewerPostRes,
        harness.deps
      );
      expect(viewerPostRes.statusCode).toBe(403);
      expect(viewerPostRes.headers.get('access-control-allow-origin')).toBe(origin);
      expect(viewerPostRes.body?.errorCode).toBe('PERMISSION_DENIED');
    }

    // 4. Unknown Origin remains rejected with HTTP 403 and no CORS headers
    for (const badOrigin of [
      'https://promiseofplanet-bb325.other.com',
      'https://malicious-site.example.org',
      'https://bb325.web.app',
    ]) {
      const badOriginRes = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method: 'OPTIONS',
          headers: {
            Origin: badOrigin,
            'Access-Control-Request-Method': 'POST',
          },
        },
        badOriginRes,
        harness.deps
      );
      expect(badOriginRes.statusCode).toBe(403);
      expect(badOriginRes.headers.get('access-control-allow-origin')).toBeUndefined();
      expect(badOriginRes.body).toEqual({
        ok: false,
        status: 'Rejected',
        errorCode: 'CORS_ORIGIN_FORBIDDEN',
      });
    }
  });

  it('rejects JSON, base64, multipart, or missing Content-Type headers with 415 UNSUPPORTED_CONTENT_TYPE', async () => {
    const harness = await createEndpointHarness();

    const disallowedContentTypes = [
      undefined,
      'application/json',
      'multipart/form-data; boundary=---123',
      'text/plain',
      'application/x-www-form-urlencoded',
      'image/png; encoding=base64',
      'image/svg+xml',
    ];

    for (const ct of disallowedContentTypes) {
      const res = new MockResponseCapture();
      await executeEditorialNewsImageUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid_editor_token',
            ...(ct !== undefined ? { 'Content-Type': ct } : {}),
            'X-Editorial-Image-Metadata': buildMetadataHeader({
              intakeId: 'intake_ct_test',
              assetId: 'asset_ct_test',
              originalFilename: 'photo.png',
              origin: 'news_article',
              altAr: 'وصف الصورة',
            }),
          },
          rawBody: validPngBuffer,
        },
        res,
        harness.deps
      );

      expect(res.statusCode).toBe(415);
      expect(res.body).toEqual({
        ok: false,
        intakeId: 'intake_ct_test',
        assetId: 'asset_ct_test',
        status: 'Rejected',
        errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      });
    }
  });
});

describe('IMG-F3-09/B — Binary Size Limits, Corrupt Payloads & Identifier Validation', () => {
  it('rejects oversized binaries (via Content-Length or rawBody length) with 413 SIZE_LIMIT_EXCEEDED and empty bodies with 400 EMPTY_BINARY', async () => {
    const harness = await createEndpointHarness({ maxUploadBytes: 2048 });

    // 1. Oversized buffer (> 2048 bytes)
    const oversizedRes = new MockResponseCapture();
    const largeBuf = Buffer.alloc(4096, 0x41);
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_oversized_1',
            assetId: 'asset_oversized_1',
            originalFilename: 'huge.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: largeBuf,
      },
      oversizedRes,
      harness.deps
    );

    expect(oversizedRes.statusCode).toBe(413);
    expect(oversizedRes.body).toEqual({
      ok: false,
      intakeId: 'intake_oversized_1',
      assetId: 'asset_oversized_1',
      status: 'Rejected',
      errorCode: 'SIZE_LIMIT_EXCEEDED',
      rejectionCode: 'SIZE_LIMIT_EXCEEDED',
    });

    // 2. Empty binary buffer -> 400 EMPTY_BINARY
    const emptyRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_empty_1',
            assetId: 'asset_empty_1',
            originalFilename: 'empty.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: Buffer.alloc(0),
      },
      emptyRes,
      harness.deps
    );

    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.body).toEqual({
      ok: false,
      intakeId: 'intake_empty_1',
      assetId: 'asset_empty_1',
      status: 'Rejected',
      errorCode: 'EMPTY_BINARY',
      rejectionCode: 'EMPTY_BINARY',
    });
  });

  it('rejects corrupt image bytes or MIME/signature mismatch with 422 BINARY_REJECTED and leaves zero orphaned objects', async () => {
    const harness = await createEndpointHarness();

    // Claim image/png with non-PNG garbage bytes
    const badMagicRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_corrupt_magic',
            assetId: 'asset_corrupt_magic',
            originalFilename: 'corrupt.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: Buffer.from('not-a-valid-png-binary-payload-at-all', 'utf8'),
      },
      badMagicRes,
      harness.deps
    );

    expect(badMagicRes.statusCode).toBe(422);
    expect(badMagicRes.body).toEqual({
      ok: false,
      intakeId: 'intake_corrupt_magic',
      assetId: 'asset_corrupt_magic',
      status: 'Failed',
      errorCode: 'BINARY_REJECTED',
      rejectionCode: 'UNSUPPORTED_MAGIC_BYTES',
    });
    expect(harness.storage.getStoredObjectCount()).toBe(0);

    // Valid PNG header with corrupted pixel stream (Sharp decode failure after quarantine stage)
    const truncatedPixelPng = Buffer.from(validPngBuffer);
    // Corrupt bytes inside IDAT data without fixing CRC -> caught by inspector or processor
    truncatedPixelPng[truncatedPixelPng.length - 20] ^= 0xff;
    const corruptStreamRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_corrupt_stream',
            assetId: 'asset_corrupt_stream',
            originalFilename: 'corrupt-stream.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: truncatedPixelPng,
      },
      corruptStreamRes,
      harness.deps
    );

    expect(corruptStreamRes.statusCode).toBe(422);
    expect(corruptStreamRes.body?.ok).toBe(false);
    expect(corruptStreamRes.body?.errorCode).toBe('BINARY_REJECTED');
    expect(harness.storage.getStoredObjectCount()).toBe(0);
  });

  it('rejects invalid intakeId/assetId, path traversal filenames, user-supplied GCS path headers, and spoofed metadata fields with 400 INVALID_INPUT', async () => {
    const harness = await createEndpointHarness();

    // 1. Invalid assetId with path traversal
    const badAssetIdRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_valid_id_1',
            assetId: '../evil_path',
            originalFilename: 'photo.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: validPngBuffer,
      },
      badAssetIdRes,
      harness.deps
    );
    expect(badAssetIdRes.statusCode).toBe(400);
    expect(badAssetIdRes.body).toEqual({
      ok: false,
      intakeId: 'intake_valid_id_1',
      status: 'Rejected',
      errorCode: 'INVALID_INPUT',
    });

    // 2. Spoofed rights/storagePath field in metadata envelope
    const spoofedMetaRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_spoof_1',
            assetId: 'asset_spoof_1',
            originalFilename: 'photo.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
            storagePath: 'editorial_images/public/hacked.webp',
            rightsStatus: 'Approved',
          }),
        },
        rawBody: validPngBuffer,
      },
      spoofedMetaRes,
      harness.deps
    );
    expect(spoofedMetaRes.statusCode).toBe(400);
    expect(spoofedMetaRes.body?.errorCode).toBe('INVALID_INPUT');

    // 3. Forbidden X-Storage-Path header
    const forbiddenHeaderRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Storage-Path': 'custom/bucket/path.webp',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_forbid_hdr',
            assetId: 'asset_forbid_hdr',
            originalFilename: 'photo.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: validPngBuffer,
      },
      forbiddenHeaderRes,
      harness.deps
    );
    expect(forbiddenHeaderRes.statusCode).toBe(400);
    expect(forbiddenHeaderRes.body?.errorCode).toBe('INVALID_INPUT');
  });
});

describe('IMG-F3-09/B — Collisions, Fault Injection, CAS Semantics & No Unauthorized GCS Deletion', () => {
  it('never overwrites or deletes pre-existing private GCS objects on storage collision and returns 409 STORAGE_CONFLICT', async () => {
    const harness = await createEndpointHarness();

    const collidingPath = buildEditorialImageVariantStoragePath(
      'asset_collision_target',
      'card',
      'image/webp'
    );
    const preExistingBytes = Buffer.from('pre-existing-protected-webp-bytes');
    await harness.storage.writeIfAbsent({
      storagePath: collidingPath,
      bytes: preExistingBytes,
      contentType: 'image/webp',
      sha256Checksum:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ownership: {
        createdByIntakeId: 'earlier_other_intake',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: 'asset_collision_target',
        uploaderUid: 'admin_writer_1',
      },
    });

    const res = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_colliding_attempt',
            assetId: 'asset_collision_target',
            originalFilename: 'photo.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: validPngBuffer,
      },
      res,
      harness.deps
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      intakeId: 'intake_colliding_attempt',
      assetId: 'asset_collision_target',
      status: 'Failed',
      errorCode: 'STORAGE_CONFLICT',
    });

    // Verify pre-existing object owned by earlier_other_intake was NOT deleted or overwritten
    const preserved = await harness.storage.readBytes(collidingPath);
    expect(preserved).not.toBeNull();
    expect(preserved!.bytes.equals(preExistingBytes)).toBe(true);
    expect(preserved!.metadata.ownership.createdByIntakeId).toBe(
      'earlier_other_intake'
    );
    // And our own partial objects (quarantine + thumbnail) were rolled back cleanly
    expect(harness.storage.listStoredPaths()).toEqual([collidingPath]);
  });

  it('handles storage write failure and lost-commit registration interruption with fail-closed CAS semantics', async () => {
    const harness = await createEndpointHarness();

    // 1. Storage failure during private variant promotion -> 500 STORAGE_FAILURE & clean rollback
    harness.intakeService.injectStageFaultOnce({
      failDuringPrivateWriteAfterCount: 2,
    });

    const storageFailRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_storage_fail_1',
            assetId: 'asset_storage_fail_1',
            originalFilename: 'photo.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: validPngBuffer,
      },
      storageFailRes,
      harness.deps
    );

    expect(storageFailRes.statusCode).toBe(500);
    expect(storageFailRes.body).toEqual({
      ok: false,
      intakeId: 'intake_storage_fail_1',
      assetId: 'asset_storage_fail_1',
      status: 'Failed',
      errorCode: 'STORAGE_FAILURE',
    });
    expect(harness.storage.getStoredObjectCount()).toBe(0);

    // 2. Lost-commit interruption after canonical asset registration -> 503 RECONCILIATION_REQUIRED & preserves private variants
    harness.intakeService.injectStageFaultOnce({
      failAfterCanonicalRegistrationUnknownOutcome: true,
    });

    const lostCommitRes = new MockResponseCapture();
    await executeEditorialNewsImageUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid_editor_token',
          'Content-Type': 'image/png',
          'X-Editorial-Image-Metadata': buildMetadataHeader({
            intakeId: 'intake_lost_commit_1',
            assetId: 'asset_lost_commit_1',
            originalFilename: 'photo.png',
            origin: 'news_article',
            altAr: 'وصف الصورة',
          }),
        },
        rawBody: validPngBuffer,
      },
      lostCommitRes,
      harness.deps
    );

    expect(lostCommitRes.statusCode).toBe(503);
    expect(lostCommitRes.body).toEqual({
      ok: false,
      intakeId: 'intake_lost_commit_1',
      assetId: 'asset_lost_commit_1',
      status: 'NeedsReconciliation',
      errorCode: 'RECONCILIATION_REQUIRED',
    });

    // Verify canonical asset and all 5 private variants were preserved (NOT deleted)
    const assetRead = await harness.assetRepo.getById('asset_lost_commit_1');
    expect(assetRead.status).toBe('FOUND');
    const session = await harness.sessionStore.getSessionById(
      'intake_lost_commit_1'
    );
    expect(session?.status).toBe('NeedsReconciliation');
    expect(session?.createdPrivateObjects).toHaveLength(5);
  });
});
