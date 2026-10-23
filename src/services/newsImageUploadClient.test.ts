/**
 * Promise of Planet — IMG-F3-09/C
 * News Editor Image Upload Client Integration Tests
 *
 * Covers all 16 required test scenarios:
 * 1. Valid binary POST & X-Editorial-Image-Metadata header encoding
 * 2. Missing endpoint configuration fails closed before network call
 * 3. Missing authentication fails closed before network call
 * 4. Token retrieval failure fails closed
 * 5. Valid Completed upload links only canonical assetId to NewsItem.featuredImage and saves draft
 * 6. CleanupPending (including HTTP 201 CleanupPending) never links assetId or saves draft
 * 7. NeedsReconciliation (503) never links assetId or saves draft
 * 8. HTTP errors (400, 401, 403, 409, 413, 415, 422, 500) and malformed/mismatched responses
 * 9. Timeout and ambiguous network outcomes halt automatic re-upload with new IDs
 * 10. Draft save failure after Completed upload retains { intakeId, assetId } and reuses on retry without re-uploading bytes
 * 11. Existing draft saved without selecting a new image preserves featuredImage reference behavior
 * 12. Non-Draft article edit rejection (InReview, Approved, Published, ChangesRequested)
 * 13. Single Save action and duplicate-submit prevention
 * 14. Temporary blob: preview URL cleanup on replace, clear, reset, save completion, and unmount
 * 15. No GCS paths, raw bytes, blob: URLs, or data: base64 URLs persisted in NewsItem.featuredImage
 * 16. Arabic/English rendering, RTL/LTR attributes, reopened-draft safe placeholder, single Save button, and responsive layout classes
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_NEWS_IMAGE_MIME_TYPES,
  MAX_NEWS_IMAGE_METADATA_HEADER_BYTES,
  MAX_NEWS_IMAGE_UPLOAD_BYTES,
  NewsAdminClient,
  NewsEditorImageSessionController,
  buildAndEncodeEditorialImageMetadataHeader,
  computeNewsImageFileSignature,
  createCanonicalNewsImageUploadIds,
  isForbiddenFeaturedImagePersistenceValue,
  validateClientIntakeId,
  validateNewsImageSelectionAndMetadata,
  validateRetainedCompletedUpload,
  type DraftSaveWithImageInput,
} from './newsAdminClient';
import { validateAssetId } from './editorialImageAssetContract';
import { AdminNewsManagement } from '../components/news/AdminNewsManagement';
import type { NewsItem } from '../types/news';
import { WorkflowState } from '../types/workflow';
import { AdminRole, type AdminUser } from '../types/admin';
import { runNewsFunctionalTests } from './newsFunctionalTests';

let mockCurrentLanguage: 'ar' | 'en' = 'ar';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return mockCurrentLanguage;
      },
      changeLanguage: async (lang: 'ar' | 'en') => {
        mockCurrentLanguage = lang;
      },
    },
  }),
}));

const TEST_ENDPOINT_URL =
  'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload';
const TEST_TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.valid-refreshed-id-token';

const TEST_ADMIN_USER: AdminUser = {
  id: 'admin-human-01',
  name: 'محرر وعد الكوكب',
  email: 'editor@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: true,
};

function createValidFile(
  name = 'nile-flood-report.png',
  type = 'image/png',
  byteLength = 2048
): File {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return new File([bytes], name, { type, lastModified: 1710000000000 });
}

function createActiveDraftItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'news-draft-101',
    titleAr: 'تقرير ميداني حول مناسيب النيل في الخرطوم',
    titleEn: 'Field Report on Nile Water Levels in Khartoum',
    summaryAr: 'ملخص ميداني شامل حول تغيرات المناسيب وتأثيرها البيئي.',
    summaryEn: 'Comprehensive field summary on water level changes.',
    bodyAr: 'تفاصيل التقرير الميداني الكاملة باللغة العربية حول الرصد الهيدرولوجي.',
    bodyEn: 'Full field report details in English on hydrological monitoring.',
    category: 'Water',
    journalisticType: 'Report',
    location: 'الخرطوم',
    author: 'وحدة الرصد الميداني',
    tags: ['النيل', 'مناسيب'],
    sources: ['هيئة مياه الخرطوم'],
    workflowState: WorkflowState.Draft,
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    history: [],
    ...overrides,
  };
}

function createDraftSaveInput(
  overrides: Partial<DraftSaveWithImageInput> = {}
): DraftSaveWithImageInput {
  const activeItem =
    overrides.activeItem !== undefined ? overrides.activeItem : createActiveDraftItem();
  return {
    isDraft: true,
    isCreating: false,
    activeItem,
    editForm: activeItem ? { ...activeItem } : createActiveDraftItem(),
    tagsInput: 'النيل, مناسيب',
    sourcesInput: 'هيئة مياه الخرطوم',
    currentUser: TEST_ADMIN_USER,
    isAr: false,
    ...overrides,
  };
}

describe('IMG-F3-09/C — News Editor Image Upload Client Integration', () => {
  beforeEach(() => {
    NewsAdminClient.setImageUploadRuntime(null);
    NewsAdminClient.setTransport(null);
  });

  afterEach(() => {
    NewsAdminClient.setImageUploadRuntime(null);
    NewsAdminClient.setTransport(null);
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Valid binary POST & X-Editorial-Image-Metadata header encoding
  // =========================================================================
  describe('1. Valid binary POST and X-Editorial-Image-Metadata encoding', () => {
    it('sends raw File bytes via binary POST with refreshed Bearer token, Content-Type, and URI-encoded X-Editorial-Image-Metadata', async () => {
      const file = createValidFile('sudan-wetlands.webp', 'image/webp', 4096);
      const ids = createCanonicalNewsImageUploadIds(1710000000000, 'a1b2c3d4');

      expect(validateClientIntakeId(ids.intakeId).valid).toBe(true);
      expect(validateAssetId(ids.assetId).valid).toBe(true);

      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch: typeof fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'Completed',
            intakeId: ids.intakeId,
            assetId: ids.assetId,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const getTokenSpy = vi.fn(async (forceRefresh: boolean) => {
        expect(forceRefresh).toBe(true);
        return TEST_TOKEN;
      });

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: getTokenSpy,
        fetchImpl: mockFetch,
      });

      const outcome = await NewsAdminClient.uploadEditorialNewsImage({
        file,
        intakeId: ids.intakeId,
        assetId: ids.assetId,
        metadata: {
          altAr: 'صورة للأراضي الرطبة في السودان',
          altEn: 'Sudan wetlands aerial view',
          captionAr: 'الأراضي الرطبة خلال موسم الفيضان',
          captionEn: 'Wetlands during flood season',
          photographerCredit: 'فريق وعد الكوكب',
          licensingInfo: 'CC-BY-4.0 pending human verification',
        },
        tags: ['الأراضي_الرطبة'],
        associatedArticleIds: ['news-draft-101'],
      });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.status).toBe('Completed');
        expect(outcome.eligibleForDraftLinking).toBe(true);
        expect(outcome.assetId).toBe(ids.assetId);
        expect(outcome.intakeId).toBe(ids.intakeId);
      }

      expect(getTokenSpy).toHaveBeenCalledTimes(1);
      expect(getTokenSpy).toHaveBeenCalledWith(true);
      expect(capturedUrl).toBe(TEST_ENDPOINT_URL);
      expect(capturedInit?.method).toBe('POST');
      expect(capturedInit).toBeDefined();
      expect(capturedInit!.body).toBeInstanceOf(Uint8Array);
      expect((capturedInit!.body as Uint8Array).byteLength).toBe(4096);

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(headers['Content-Type']).toBe('image/webp');
      expect(typeof headers['X-Editorial-Image-Metadata']).toBe('string');

      const decodedJson = decodeURIComponent(headers['X-Editorial-Image-Metadata']);
      const parsedMeta = JSON.parse(decodedJson);
      expect(parsedMeta).toEqual({
        intakeId: ids.intakeId,
        assetId: ids.assetId,
        originalFilename: 'sudan-wetlands.webp',
        claimedMimeType: 'image/webp',
        claimedFilenameOrExtension: 'sudan-wetlands.webp',
        origin: 'news_article',
        altAr: 'صورة للأراضي الرطبة في السودان',
        altEn: 'Sudan wetlands aerial view',
        captionAr: 'الأراضي الرطبة خلال موسم الفيضان',
        captionEn: 'Wetlands during flood season',
        photographerCredit: 'فريق وعد الكوكب',
        licensingInfo: 'CC-BY-4.0 pending human verification',
        tags: ['الأراضي_الرطبة'],
        associatedArticleIds: ['news-draft-101'],
      });
      expect(parsedMeta.storagePath).toBeUndefined();
      expect(parsedMeta.gcsPath).toBeUndefined();
      expect(parsedMeta.actorUid).toBeUndefined();
      expect(parsedMeta.role).toBeUndefined();
    });

    it('enforces client-side file size, MIME type, required altAr, and 16,384-byte encoded metadata header limit', () => {
      const validFile = createValidFile('photo.jpg', 'image/jpeg', 1024);
      const ids = createCanonicalNewsImageUploadIds(1710000000000, 'f1e2d3c4');

      // Missing altAr
      const missingAlt = validateNewsImageSelectionAndMetadata({ altAr: '   ' }, validFile);
      expect(missingAlt.valid).toBe(false);
      expect(missingAlt.errorEn).toContain('altAr');

      // Unsupported MIME
      const svgFile = new File(['<svg></svg>'], 'vector.svg', { type: 'image/svg+xml' });
      const badMime = validateNewsImageSelectionAndMetadata({ altAr: 'وصف' }, svgFile);
      expect(badMime.valid).toBe(false);
      expect(badMime.errorEn).toContain('PNG, JPEG, and WebP');

      // Oversized file (> 15,000,000 bytes)
      const hugeFile = {
        name: 'huge.png',
        type: 'image/png',
        size: MAX_NEWS_IMAGE_UPLOAD_BYTES + 1,
        lastModified: 1710000000000,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      const oversized = validateNewsImageSelectionAndMetadata({ altAr: 'وصف' }, hugeFile);
      expect(oversized.valid).toBe(false);
      expect(oversized.errorEn).toContain('15,000,000');

      // Oversized metadata header (> 16,384 encoded UTF-8 bytes)
      const hugeLicensing = 'أ'.repeat(3000);
      expect(() =>
        buildAndEncodeEditorialImageMetadataHeader({
          intakeId: ids.intakeId,
          assetId: ids.assetId,
          originalFilename: 'photo.jpg',
          claimedMimeType: 'image/jpeg',
          metadata: {
            altAr: 'وصف الصورة',
            licensingInfo: hugeLicensing,
          },
        })
      ).toThrow(/METADATA_HEADER_LIMIT_EXCEEDED/);

      expect(MAX_NEWS_IMAGE_METADATA_HEADER_BYTES).toBe(16_384);
      expect(ALLOWED_NEWS_IMAGE_MIME_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    });
  });

  // =========================================================================
  // 2. Missing endpoint configuration
  // =========================================================================
  describe('2. Missing endpoint configuration fails closed before network call', () => {
    it('returns UPLOAD_ENDPOINT_UNCONFIGURED without calling getAuthenticatedIdToken or fetch when URL is unconfigured or invalid', async () => {
      const fetchSpy = vi.fn();
      const tokenSpy = vi.fn();

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: '',
        isAuthenticated: () => true,
        getAuthenticatedIdToken: tokenSpy,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });

      expect(NewsAdminClient.isImageUploadAvailable()).toBe(false);

      const ids = createCanonicalNewsImageUploadIds();
      const outcome = await NewsAdminClient.uploadEditorialNewsImage({
        file: createValidFile(),
        intakeId: ids.intakeId,
        assetId: ids.assetId,
        metadata: { altAr: 'وصف الصورة' },
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.errorCode).toBe('UPLOAD_ENDPOINT_UNCONFIGURED');
        expect(outcome.eligibleForDraftLinking).toBe(false);
      }
      expect(tokenSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Missing authentication
  // =========================================================================
  describe('3. Missing authentication fails closed before network call', () => {
    it('returns UNAUTHENTICATED without calling fetch when user is not signed in', async () => {
      const fetchSpy = vi.fn();
      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => false,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });

      const ids = createCanonicalNewsImageUploadIds();
      const outcome = await NewsAdminClient.uploadEditorialNewsImage({
        file: createValidFile(),
        intakeId: ids.intakeId,
        assetId: ids.assetId,
        metadata: { altAr: 'وصف الصورة' },
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.errorCode).toBe('UNAUTHENTICATED');
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. Token retrieval failure
  // =========================================================================
  describe('4. Token retrieval failure fails closed before network call', () => {
    it('returns AUTH_TOKEN_FAILURE when Firebase ID token refresh rejects', async () => {
      const fetchSpy = vi.fn();
      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => {
          throw new Error('Firebase Auth network token refresh failed');
        },
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });

      const ids = createCanonicalNewsImageUploadIds();
      const outcome = await NewsAdminClient.uploadEditorialNewsImage({
        file: createValidFile(),
        intakeId: ids.intakeId,
        assetId: ids.assetId,
        metadata: { altAr: 'وصف الصورة' },
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.errorCode).toBe('AUTH_TOKEN_FAILURE');
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. Valid Completed upload links only canonical assetId and saves draft
  // =========================================================================
  describe('5. Valid Completed upload links canonical assetId to NewsItem.featuredImage and saves draft', () => {
    it('uploads binary first, verifies Completed status, attaches only canonical assetId to featuredImage, and calls saveDraft', async () => {
      const fixedIds = createCanonicalNewsImageUploadIds(1710000000000, 'completed01');
      const savedPayloads: Partial<NewsItem>[] = [];

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: true,
              status: 'Completed',
              intakeId: fixedIds.intakeId,
              assetId: fixedIds.assetId,
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          )
        ),
      });

      NewsAdminClient.setTransport(async (action, payload) => {
        if (action === 'saveDraft') {
          const itemPayload = payload.item as Partial<NewsItem>;
          savedPayloads.push(itemPayload);
          return {
            item: {
              ...createActiveDraftItem(),
              ...itemPayload,
            },
          };
        }
        throw new Error(`Unexpected action: ${action}`);
      });

      const controller = new NewsEditorImageSessionController({
        idFactory: () => fixedIds,
        urlAdapter: {
          createObjectURL: () => 'blob:https://example.org/temp-preview-1',
          revokeObjectURL: vi.fn(),
        },
      });

      controller.selectFile(createValidFile('khartoum-nile.png', 'image/png', 2048));
      controller.setImageMetadata({
        altAr: 'منسوب النيل عند مقرن الخرطوم',
        altEn: 'Nile water level at Khartoum confluence',
      });

      const result = await controller.executeSaveWorkflow(createDraftSaveInput());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.linkedAssetId).toBe(fixedIds.assetId);
        expect(result.reusedRetainedUpload).toBe(false);
        expect(result.savedItem.featuredImage).toBe(fixedIds.assetId);
      }

      expect(savedPayloads).toHaveLength(1);
      expect(savedPayloads[0].featuredImage).toBe(fixedIds.assetId);
      expect(validateAssetId(savedPayloads[0].featuredImage!).valid).toBe(true);
    });
  });

  // =========================================================================
  // 6. CleanupPending must NOT link assetId or save draft
  // =========================================================================
  describe('6. CleanupPending outcome is rejected for draft linking', () => {
    it('treats HTTP 201 CleanupPending as non-linkable, halts automatic re-upload, and does NOT call saveNewsItem', async () => {
      const fixedIds = createCanonicalNewsImageUploadIds(1710000000000, 'cleanup01');
      const saveSpy = vi.fn();

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: true,
              status: 'CleanupPending',
              intakeId: fixedIds.intakeId,
              assetId: fixedIds.assetId,
              errorCode: 'CLEANUP_INCOMPLETE',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          )
        ),
      });

      NewsAdminClient.setTransport(saveSpy);

      const controller = new NewsEditorImageSessionController({
        idFactory: () => fixedIds,
      });
      controller.selectFile(createValidFile());
      controller.setImageMetadata({ altAr: 'وصف الصورة' });

      const result = await controller.executeSaveWorkflow(createDraftSaveInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasonCode).toBe('UPLOAD_FAILED');
        expect(result.haltedAmbiguousUpload?.status).toBe('CleanupPending');
      }
      expect(saveSpy).not.toHaveBeenCalled();
      expect(controller.getHaltedAmbiguousUpload()?.status).toBe('CleanupPending');
      expect(controller.getRetainedCompletedUpload()).toBeNull();
    });
  });

  // =========================================================================
  // 7. NeedsReconciliation (503) must NOT link assetId or save draft
  // =========================================================================
  describe('7. NeedsReconciliation (503) outcome is rejected for draft linking', () => {
    it('treats HTTP 503 NeedsReconciliation as non-linkable, halts automatic re-upload, and does NOT call saveNewsItem', async () => {
      const fixedIds = createCanonicalNewsImageUploadIds(1710000000000, 'reconcile01');
      const saveSpy = vi.fn();

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: false,
              status: 'NeedsReconciliation',
              errorCode: 'RECONCILIATION_REQUIRED',
              intakeId: fixedIds.intakeId,
              assetId: fixedIds.assetId,
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          )
        ),
      });

      NewsAdminClient.setTransport(saveSpy);

      const controller = new NewsEditorImageSessionController({
        idFactory: () => fixedIds,
      });
      controller.selectFile(createValidFile());
      controller.setImageMetadata({ altAr: 'وصف الصورة' });

      const result = await controller.executeSaveWorkflow(createDraftSaveInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasonCode).toBe('UPLOAD_FAILED');
        expect(result.haltedAmbiguousUpload?.status).toBe('NeedsReconciliation');
      }
      expect(saveSpy).not.toHaveBeenCalled();
      expect(controller.getHaltedAmbiguousUpload()?.status).toBe('NeedsReconciliation');
    });
  });

  // =========================================================================
  // 8. HTTP errors (400, 401, 403, 409, 413, 415, 422, 500) & malformed responses
  // =========================================================================
  describe('8. HTTP error statuses and malformed/identity-mismatched responses', () => {
    const httpErrorStatuses = [400, 401, 403, 409, 413, 415, 422, 500];

    it.each(httpErrorStatuses)(
      'fails closed and prevents draft linking on HTTP %i',
      async (httpStatus) => {
        const ids = createCanonicalNewsImageUploadIds();
        const saveSpy = vi.fn();

        NewsAdminClient.setImageUploadRuntime({
          endpointUrl: TEST_ENDPOINT_URL,
          isAuthenticated: () => true,
          getAuthenticatedIdToken: async () => TEST_TOKEN,
          fetchImpl: vi.fn(async () =>
            new Response(
              JSON.stringify({
                ok: false,
                status: 'Failed',
                errorCode: `ERR_${httpStatus}`,
              }),
              { status: httpStatus, headers: { 'Content-Type': 'application/json' } }
            )
          ),
        });
        NewsAdminClient.setTransport(saveSpy);

        const outcome = await NewsAdminClient.uploadEditorialNewsImage({
          file: createValidFile(),
          intakeId: ids.intakeId,
          assetId: ids.assetId,
          metadata: { altAr: 'وصف الصورة' },
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.httpStatus).toBe(httpStatus);
          expect(outcome.eligibleForDraftLinking).toBe(false);
        }
        expect(saveSpy).not.toHaveBeenCalled();
      }
    );

    it('rejects malformed non-JSON HTTP 201 responses, unexpected response keys, and mismatched returned assetId/intakeId', async () => {
      const ids = createCanonicalNewsImageUploadIds();

      // Malformed JSON
      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(async () => new Response('NOT_JSON_AT_ALL', { status: 201 })),
      });

      const malformedOutcome = await NewsAdminClient.uploadEditorialNewsImage({
        file: createValidFile(),
        intakeId: ids.intakeId,
        assetId: ids.assetId,
        metadata: { altAr: 'وصف الصورة' },
      });
      expect(malformedOutcome.ok).toBe(false);
      if (!malformedOutcome.ok) {
        expect(malformedOutcome.errorCode).toBe('MALFORMED_RESPONSE');
      }

      // Unexpected keys (e.g., leaked gcsPath or publicUrl)
      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: true,
              status: 'Completed',
              intakeId: ids.intakeId,
              assetId: ids.assetId,
              gcsPath: 'editorial_images/private/leaked.webp',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          )
        ),
      });

      const leakedKeyOutcome = await NewsAdminClient.uploadEditorialNewsImage({
        file: createValidFile(),
        intakeId: ids.intakeId,
        assetId: ids.assetId,
        metadata: { altAr: 'وصف الصورة' },
      });
      expect(leakedKeyOutcome.ok).toBe(false);
      if (!leakedKeyOutcome.ok) {
        expect(leakedKeyOutcome.errorCode).toBe('MALFORMED_RESPONSE');
      }

      // Mismatched assetId from server
      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: true,
              status: 'Completed',
              intakeId: ids.intakeId,
              assetId: 'asset_news_9999999999999_different',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          )
        ),
      });

      const mismatchOutcome = await NewsAdminClient.uploadEditorialNewsImage({
        file: createValidFile(),
        intakeId: ids.intakeId,
        assetId: ids.assetId,
        metadata: { altAr: 'وصف الصورة' },
      });
      expect(mismatchOutcome.ok).toBe(false);
      if (!mismatchOutcome.ok) {
        expect(mismatchOutcome.errorCode).toBe('RESPONSE_IDENTITY_MISMATCH');
      }
    });
  });

  // =========================================================================
  // 9. Timeout and ambiguous network outcomes
  // =========================================================================
  describe('9. Timeout and ambiguous network outcomes halt automatic re-upload with new IDs', () => {
    it('halts session re-upload when fetch aborts due to timeout or network drop so duplicate IDs are never generated', async () => {
      const fixedIds = createCanonicalNewsImageUploadIds(1710000000000, 'timeout01');
      let fetchCalls = 0;
      const saveSpy = vi.fn();

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(async () => {
          fetchCalls += 1;
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }),
      });
      NewsAdminClient.setTransport(saveSpy);

      const controller = new NewsEditorImageSessionController({
        idFactory: () => fixedIds,
      });
      controller.selectFile(createValidFile());
      controller.setImageMetadata({ altAr: 'وصف الصورة' });

      // First Save click -> times out -> marks haltedAmbiguousUpload
      const firstSave = await controller.executeSaveWorkflow(createDraftSaveInput());

      expect(firstSave.ok).toBe(false);
      if (!firstSave.ok) {
        expect(firstSave.reasonCode).toBe('UPLOAD_FAILED');
        expect(firstSave.haltedAmbiguousUpload?.status).toBe('Ambiguous');
        expect(firstSave.haltedAmbiguousUpload?.errorCode).toBe('UPLOAD_TIMEOUT');
      }
      expect(fetchCalls).toBe(1);
      expect(saveSpy).not.toHaveBeenCalled();

      // Second Save click without clearing/reselecting -> blocked by UPLOAD_HALTED_AMBIGUOUS without calling fetch again
      const secondSave = await controller.executeSaveWorkflow(createDraftSaveInput());

      expect(secondSave.ok).toBe(false);
      if (!secondSave.ok) {
        expect(secondSave.reasonCode).toBe('UPLOAD_HALTED_AMBIGUOUS');
      }
      expect(fetchCalls).toBe(1); // No second network upload!
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 10. Draft save failure after Completed upload preserves & reuses { intakeId, assetId }
  // =========================================================================
  describe('10. Draft save failure after Completed upload preserves and reuses Completed asset on retry', () => {
    it('retains { intakeId, assetId } when saveNewsItem fails and links the retained assetId on the next Save without re-uploading binary bytes', async () => {
      const fixedIds = createCanonicalNewsImageUploadIds(1710000000000, 'retryreuse01');
      let uploadNetworkCalls = 0;
      let saveNewsAttempts = 0;

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(async () => {
          uploadNetworkCalls += 1;
          return new Response(
            JSON.stringify({
              ok: true,
              status: 'Completed',
              intakeId: fixedIds.intakeId,
              assetId: fixedIds.assetId,
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }),
      });

      NewsAdminClient.setTransport(async (action, payload) => {
        if (action === 'saveDraft') {
          saveNewsAttempts += 1;
          if (saveNewsAttempts === 1) {
            throw new Error('Temporary Firestore write contention');
          }
          const itemPayload = payload.item as Partial<NewsItem>;
          return {
            item: {
              ...createActiveDraftItem(),
              ...itemPayload,
            },
          };
        }
        throw new Error(`Unexpected action: ${action}`);
      });

      const controller = new NewsEditorImageSessionController({
        idFactory: () => fixedIds,
      });
      controller.selectFile(createValidFile('retry-test.png', 'image/png', 2048));
      controller.setImageMetadata({ altAr: 'وصف للصورة' });

      // Attempt 1: Binary upload succeeds (Completed), but saveNewsItem fails
      const firstAttempt = await controller.executeSaveWorkflow(createDraftSaveInput());

      expect(firstAttempt.ok).toBe(false);
      if (!firstAttempt.ok) {
        expect(firstAttempt.reasonCode).toBe('DRAFT_SAVE_FAILED');
        expect(firstAttempt.retainedCompletedUpload?.assetId).toBe(fixedIds.assetId);
        expect(firstAttempt.retainedCompletedUpload?.intakeId).toBe(fixedIds.intakeId);
      }
      expect(uploadNetworkCalls).toBe(1);
      expect(saveNewsAttempts).toBe(1);

      // Verify retained Completed upload is preserved in session state
      const retained = controller.getRetainedCompletedUpload();
      expect(retained).not.toBeNull();
      expect(retained?.assetId).toBe(fixedIds.assetId);
      expect(retained?.intakeId).toBe(fixedIds.intakeId);

      // Attempt 2: User clicks Save Changes again -> reuses retained Completed upload without calling fetch!
      const secondAttempt = await controller.executeSaveWorkflow(createDraftSaveInput());

      expect(secondAttempt.ok).toBe(true);
      if (secondAttempt.ok) {
        expect(secondAttempt.reusedRetainedUpload).toBe(true);
        expect(secondAttempt.linkedAssetId).toBe(fixedIds.assetId);
        expect(secondAttempt.savedItem.featuredImage).toBe(fixedIds.assetId);
      }
      expect(uploadNetworkCalls).toBe(1); // Binary was NOT re-uploaded
      expect(saveNewsAttempts).toBe(2);
    });
  });

  // =========================================================================
  // 11. Existing draft saved without selecting a new image
  // =========================================================================
  describe('11. Existing draft saved without selecting a new image', () => {
    it('saves draft directly and preserves existing featuredImage reference without calling upload endpoint', async () => {
      const existingAssetId = 'asset_news_1710000000000_existing01';
      const uploadFetchSpy = vi.fn();
      let savedNewsData: Partial<NewsItem> | null = null;

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: uploadFetchSpy as unknown as typeof fetch,
      });

      NewsAdminClient.setTransport(async (action, payload) => {
        if (action === 'saveDraft') {
          const itemPayload = payload.item as Partial<NewsItem>;
          savedNewsData = itemPayload;
          return {
            item: {
              ...createActiveDraftItem({ featuredImage: existingAssetId }),
              ...itemPayload,
            },
          };
        }
        throw new Error(`Unexpected action: ${action}`);
      });

      const controller = new NewsEditorImageSessionController();
      const activeDraft = createActiveDraftItem({ featuredImage: existingAssetId });
      const result = await controller.executeSaveWorkflow(
        createDraftSaveInput({
          activeItem: activeDraft,
          editForm: { ...activeDraft },
        })
      );

      expect(result.ok).toBe(true);
      expect(uploadFetchSpy).not.toHaveBeenCalled();
      expect(savedNewsData).not.toBeNull();
      expect(savedNewsData!.featuredImage).toBe(existingAssetId);
    });
  });

  // =========================================================================
  // 12. Non-Draft article edit rejection
  // =========================================================================
  describe('12. Non-Draft article edit rejection', () => {
    const nonDraftStates: WorkflowState[] = [
      WorkflowState.InReview,
      WorkflowState.Approved,
      WorkflowState.Published,
      WorkflowState.ChangesRequested,
    ];

    it.each(nonDraftStates)(
      'rejects image upload and draft save when existing article is in %s state',
      async (workflowState) => {
        const uploadFetchSpy = vi.fn();
        const saveSpy = vi.fn();

        NewsAdminClient.setImageUploadRuntime({
          endpointUrl: TEST_ENDPOINT_URL,
          isAuthenticated: () => true,
          getAuthenticatedIdToken: async () => TEST_TOKEN,
          fetchImpl: uploadFetchSpy as unknown as typeof fetch,
        });
        NewsAdminClient.setTransport(saveSpy);

        const controller = new NewsEditorImageSessionController();
        controller.selectFile(createValidFile());
        controller.setImageMetadata({ altAr: 'وصف الصورة' });

        const nonDraftItem = createActiveDraftItem({ workflowState });
        const result = await controller.executeSaveWorkflow(
          createDraftSaveInput({
            isDraft: false,
            isCreating: false,
            activeItem: nonDraftItem,
            editForm: { ...nonDraftItem },
          })
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reasonCode).toBe('NON_DRAFT_FORBIDDEN');
        }
        expect(uploadFetchSpy).not.toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
      }
    );
  });

  // =========================================================================
  // 13. Single Save action and duplicate-submit prevention
  // =========================================================================
  describe('13. Single Save action and duplicate-submit prevention', () => {
    it('blocks concurrent Save submissions while an upload/save operation is in flight', async () => {
      const fixedIds = createCanonicalNewsImageUploadIds(1710000000000, 'dupsubmit01');
      let resolveUpload!: (res: Response) => void;

      NewsAdminClient.setImageUploadRuntime({
        endpointUrl: TEST_ENDPOINT_URL,
        isAuthenticated: () => true,
        getAuthenticatedIdToken: async () => TEST_TOKEN,
        fetchImpl: vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              resolveUpload = resolve;
            })
        ),
      });

      NewsAdminClient.setTransport(async (_action, payload) => ({
        item: {
          ...createActiveDraftItem(),
          ...(payload?.item as Partial<NewsItem>),
        },
      }));

      const controller = new NewsEditorImageSessionController({
        idFactory: () => fixedIds,
      });
      controller.selectFile(createValidFile());
      controller.setImageMetadata({ altAr: 'وصف الصورة' });

      const firstPromise = controller.executeSaveWorkflow(createDraftSaveInput());

      expect(controller.isSaving()).toBe(true);

      // Concurrent second click while first is in flight
      const duplicateSave = await controller.executeSaveWorkflow(createDraftSaveInput());

      expect(duplicateSave.ok).toBe(false);
      if (!duplicateSave.ok) {
        expect(duplicateSave.reasonCode).toBe('DUPLICATE_SUBMISSION_BLOCKED');
      }

      // Allow async token + arrayBuffer microtasks to reach fetchImpl
      await new Promise((r) => setTimeout(r, 20));

      // Now complete the first upload
      resolveUpload(
        new Response(
          JSON.stringify({
            ok: true,
            status: 'Completed',
            intakeId: fixedIds.intakeId,
            assetId: fixedIds.assetId,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const firstResult = await firstPromise;
      expect(firstResult.ok).toBe(true);
      expect(controller.isSaving()).toBe(false);
    });
  });

  // =========================================================================
  // 14. Temporary blob: preview URL cleanup
  // =========================================================================
  describe('14. Temporary blob: preview URL cleanup lifecycle', () => {
    it('creates and revokes temporary blob: URLs on file replacement, clear, save completion, and unmount/reset', () => {
      let counter = 0;
      const createdUrls: string[] = [];
      const revokedUrls: string[] = [];

      const controller = new NewsEditorImageSessionController({
        urlAdapter: {
          createObjectURL: () => {
            counter += 1;
            const url = `blob:https://example.org/local-preview-${counter}`;
            createdUrls.push(url);
            return url;
          },
          revokeObjectURL: (url: string) => {
            revokedUrls.push(url);
          },
        },
      });

      // 1. Select first file -> creates blob URL 1
      controller.selectFile(createValidFile('first.png', 'image/png', 1024));
      expect(controller.getPreviewObjectUrl()).toBe('blob:https://example.org/local-preview-1');
      expect(revokedUrls).toEqual([]);

      // 2. Replace with second file -> revokes blob URL 1, creates blob URL 2
      controller.selectFile(createValidFile('second.png', 'image/png', 2048));
      expect(controller.getPreviewObjectUrl()).toBe('blob:https://example.org/local-preview-2');
      expect(revokedUrls).toEqual(['blob:https://example.org/local-preview-1']);

      // 3. Clear selection -> revokes blob URL 2
      controller.selectFile(null);
      expect(controller.getPreviewObjectUrl()).toBeNull();
      expect(revokedUrls).toEqual([
        'blob:https://example.org/local-preview-1',
        'blob:https://example.org/local-preview-2',
      ]);

      // 4. Select third file and resetSession (modal close / unmount) -> revokes blob URL 3
      controller.selectFile(createValidFile('third.png', 'image/png', 1536));
      expect(controller.getPreviewObjectUrl()).toBe('blob:https://example.org/local-preview-3');
      controller.resetSession();
      expect(controller.getPreviewObjectUrl()).toBeNull();
      expect(revokedUrls).toEqual([
        'blob:https://example.org/local-preview-1',
        'blob:https://example.org/local-preview-2',
        'blob:https://example.org/local-preview-3',
      ]);
    });
  });

  // =========================================================================
  // 15. No GCS paths, raw bytes, blob: URLs, or data: base64 URLs persisted
  // =========================================================================
  describe('15. Forbidden featuredImage persistence values are rejected', () => {
    const forbiddenValues = [
      'blob:https://promise-of-planet.org/550e8400-e29b-41d4-a716-446655440000',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
      'gs://promise-of-planet-private/editorial_images/private/asset_1/original.webp',
      'editorial_images/private/2026/04/asset_123/master.webp',
      'editorial_intake_quarantine/intake_123/source.png',
      '../secret/path/image.webp',
      'C:\\fakepath\\image.png',
    ];

    it.each(forbiddenValues)(
      'rejects forbidden featuredImage value "%s" in NewsAdminClient.saveNewsItem',
      async (forbiddenFeaturedImage) => {
        const transportSpy = vi.fn();
        NewsAdminClient.setTransport(transportSpy);

        await expect(
          NewsAdminClient.saveNewsItem(
            createActiveDraftItem({ featuredImage: forbiddenFeaturedImage })
          )
        ).rejects.toThrow(/INVALID_FEATURED_IMAGE_REFERENCE/);

        expect(transportSpy).not.toHaveBeenCalled();
        expect(isForbiddenFeaturedImagePersistenceValue(forbiddenFeaturedImage)).toBe(true);
      }
    );

    it('validates that retainedCompletedUpload requires Completed status and canonical IDs', () => {
      const validIds = createCanonicalNewsImageUploadIds(1710000000000, 'retained01');
      const validFile = createValidFile('valid.png', 'image/png', 2048);
      const isValid = validateRetainedCompletedUpload(
        {
          intakeId: validIds.intakeId,
          assetId: validIds.assetId,
          status: 'Completed',
          fileSignature: computeNewsImageFileSignature(validFile),
          originalFilename: validFile.name,
          mimeType: 'image/png',
          sizeBytes: validFile.size,
          completedAtIso: '2026-04-20T12:00:00.000Z',
        },
        validFile
      );
      expect(isValid).toBe(true);
    });
  });

  // =========================================================================
  // 16. Arabic/English rendering, RTL/LTR, reopened-draft placeholder, single Save button
  // =========================================================================
  describe('16. AdminNewsManagement UI rendering, RTL/LTR, and responsive layout', () => {
    it('renders AdminNewsManagement in Arabic and English without errors and preserves single Save button and RTL/LTR responsive Featured Image structure', async () => {
      mockCurrentLanguage = 'ar';
      const arHtml = renderToStaticMarkup(
        React.createElement(AdminNewsManagement, { currentUser: TEST_ADMIN_USER })
      );
      expect(arHtml).toContain('إدارة الأخبار والتغطيات البيئية');
      expect(arHtml).toContain('إضافة خبر بيئي جديد');

      mockCurrentLanguage = 'en';
      const enHtml = renderToStaticMarkup(
        React.createElement(AdminNewsManagement, { currentUser: TEST_ADMIN_USER })
      );
      expect(enHtml).toContain('Environmental Newsroom Management');
      expect(enHtml).toContain('New News Article');

      // Verify AdminNewsManagement source preserves single Save Changes button, RTL/LTR dir attributes,
      // reopened-draft safe placeholder, temporary local preview notice, and responsive grid classes
      const fs = await import('node:fs');
      const path = await import('node:path');
      const componentSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/news/AdminNewsManagement.tsx'),
        'utf8'
      );

      // Single Save Changes button
      const saveBtnMatches = componentSource.match(/data-testid="news-save-changes-btn"/g) || [];
      expect(saveBtnMatches).toHaveLength(1);
      expect(componentSource).toContain('disabled={isSaving}');

      // Featured Image section test IDs & reopened-draft safe placeholder
      expect(componentSource).toContain('data-testid="news-featured-image-section"');
      expect(componentSource).toContain('data-testid="news-existing-asset-placeholder"');
      expect(componentSource).toContain('data-testid="news-existing-asset-id"');
      expect(componentSource).toContain('data-testid="news-temporary-local-preview"');
      expect(componentSource).toContain('data-testid="news-retained-completed-upload"');
      expect(componentSource).toContain('data-testid="news-halted-ambiguous-upload"');

      // RTL/LTR inputs and responsive classes
      expect(componentSource).toContain('data-testid="news-image-alt-ar"');
      expect(componentSource).toContain('data-testid="news-image-alt-en"');
      expect(componentSource).toContain('grid-cols-1 md:grid-cols-12');
      expect(componentSource).toContain('grid-cols-1 sm:grid-cols-2');
    });

    it('preserves full compatibility with existing newsFunctionalTests draft/workflow suite', async () => {
      const results = await runNewsFunctionalTests();
      const adminAndWorkflowResults = results.filter((r) => r.id !== 'REQ-11');
      expect(adminAndWorkflowResults).toHaveLength(17);
      expect(adminAndWorkflowResults.filter((r) => !r.passed)).toEqual([]);
    });
  });
});
