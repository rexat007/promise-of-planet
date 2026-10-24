import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EDITORIAL_IMAGE_PREVIEW_VARIANT,
  EditorialImagePreviewService,
  MAX_EDITORIAL_IMAGE_PREVIEW_BYTES,
  buildEditorialImagePreviewRequestUrl,
  createEditorialDraftPreviewSessionController,
  extractPersistedEditorialImageAssetIds,
  extractPersistedEditorialImageAssetIdsFromDocument,
  isValidPersistedPreviewAssetId,
  isValidPreviewEndpointUrl,
  isValidWebpPreviewBinary,
  mergePersistedAndStagedPreviewUrlMaps,
} from './editorialImagePreviewService';
import { NewsAdminClient, NewsEditorImageSessionController } from './newsAdminClient';
import { AdminNewsManagement } from '../components/news/AdminNewsManagement';
import { AdminRole, type AdminUser } from '../types/admin';
import type { NewsItem } from '../types/news';
import type { RichNewsDocumentWrapperV2 } from '../types/richNewsDocument';
import { WorkflowState } from '../types/workflow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'ar',
      changeLanguage: async () => {},
    },
  }),
}));

const TEST_PREVIEW_ENDPOINT =
  'https://us-central1-promise-of-planet.cloudfunctions.net/editorialImagePreviewEndpoint';
const TEST_ID_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.valid-admin-preview-id-token';

const TEST_ADMIN_USER: AdminUser = {
  id: 'admin-editor-01',
  name: 'محرر وعد الكوكب',
  email: 'editor@promiseofplanet.org',
  role: AdminRole.ContentEditor,
  isActive: true,
};

function createValidWebpBytes(byteLength = 64): Uint8Array {
  const safeLen = Math.max(16, byteLength);
  const bytes = new Uint8Array(safeLen);
  // 'RIFF'
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  // file size - 8 (little endian)
  const riffPayloadSize = safeLen - 8;
  bytes[4] = riffPayloadSize & 0xff;
  bytes[5] = (riffPayloadSize >> 8) & 0xff;
  bytes[6] = (riffPayloadSize >> 16) & 0xff;
  bytes[7] = (riffPayloadSize >> 24) & 0xff;
  // 'WEBP'
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  // 'VP8 '
  bytes.set([0x56, 0x50, 0x38, 0x20], 12);
  return bytes;
}

function createWebpResponse(
  bytes: Uint8Array = createValidWebpBytes(),
  status = 200,
  headers: Record<string, string> = { 'Content-Type': 'image/webp' }
): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy.buffer, {
    status,
    headers,
  });
}

function createSampleV2RichDoc(
  assetIds: readonly string[],
  dir: 'rtl' | 'ltr' = 'rtl'
): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { dir },
          content: [{ type: 'text', text: dir === 'rtl' ? 'فقرة أولى' : 'First paragraph' }],
        },
        ...assetIds.map((assetId, idx) => ({
          type: 'editorialImage' as const,
          attrs: {
            assetId,
            altAr: `وصف بديل للصورة ${idx + 1}`,
            altEn: `Alt text for image ${idx + 1}`,
            captionAr: `تعليق توضيحي ${idx + 1}`,
            captionEn: `Caption ${idx + 1}`,
            width: '50%' as const,
            layout: 'float-start' as const,
          },
        })),
      ],
    },
  };
}

describe('IMG-F3-09/D2-E3-B2 — Authenticated Private Image Preview Client Integration', () => {
  beforeEach(() => {
    EditorialImagePreviewService.clear();
    NewsAdminClient.clear();
    NewsAdminClient.setTransport(null);
  });

  afterEach(() => {
    EditorialImagePreviewService.clear();
    NewsAdminClient.clear();
    NewsAdminClient.setTransport(null);
    vi.restoreAllMocks();
  });

  describe('1. AssetId & Endpoint Configuration Validation', () => {
    it('accepts valid canonical assetIds and rejects malformed, traversal, or URL-bearing assetIds', () => {
      expect(isValidPersistedPreviewAssetId('asset_news_1710000000000_abcd1234')).toBe(true);
      expect(isValidPersistedPreviewAssetId('asset_20261024_valid01')).toBe(true);

      expect(isValidPersistedPreviewAssetId('')).toBe(false);
      expect(isValidPersistedPreviewAssetId('a'.repeat(129))).toBe(false); // > maxAssetIdLength (128)
      expect(isValidPersistedPreviewAssetId(' asset_news_123 ')).toBe(false);
      expect(isValidPersistedPreviewAssetId('asset/../../secret')).toBe(false);
      expect(isValidPersistedPreviewAssetId('asset\\secret')).toBe(false);
      expect(isValidPersistedPreviewAssetId('asset..secret')).toBe(false);
      expect(isValidPersistedPreviewAssetId('asset%2Fsecret')).toBe(false);
      expect(isValidPersistedPreviewAssetId('https://example.com/image.webp')).toBe(false);
      expect(isValidPersistedPreviewAssetId('blob:https://example.com/123')).toBe(false);
      expect(isValidPersistedPreviewAssetId(null)).toBe(false);
      expect(isValidPersistedPreviewAssetId(undefined)).toBe(false);
    });

    it('requires an explicitly configured HTTPS endpoint for production and allows localhost HTTP only for local dev', () => {
      expect(isValidPreviewEndpointUrl(TEST_PREVIEW_ENDPOINT)).toBe(true);
      expect(
        isValidPreviewEndpointUrl('http://localhost:5001/demo/us-central1/editorialImagePreviewEndpoint')
      ).toBe(true);
      expect(
        isValidPreviewEndpointUrl('http://127.0.0.1:5001/demo/us-central1/editorialImagePreviewEndpoint')
      ).toBe(true);

      // Rejects unconfigured, non-HTTPS remote URLs, credentials in URL, query strings, fragments, whitespace
      expect(isValidPreviewEndpointUrl('')).toBe(false);
      expect(isValidPreviewEndpointUrl(null)).toBe(false);
      expect(isValidPreviewEndpointUrl(undefined)).toBe(false);
      expect(
        isValidPreviewEndpointUrl('http://us-central1-promise-of-planet.cloudfunctions.net/preview')
      ).toBe(false);
      expect(
        isValidPreviewEndpointUrl('https://user:pass@example.com/editorialImagePreviewEndpoint')
      ).toBe(false);
      expect(
        isValidPreviewEndpointUrl(`${TEST_PREVIEW_ENDPOINT}?token=secret`)
      ).toBe(false);
      expect(
        isValidPreviewEndpointUrl(`${TEST_PREVIEW_ENDPOINT}#fragment`)
      ).toBe(false);
      expect(isValidPreviewEndpointUrl(` ${TEST_PREVIEW_ENDPOINT} `)).toBe(false);
    });

    it('never guesses or fabricates a Cloud Functions URL when VITE_EDITORIAL_IMAGE_PREVIEW_URL is unconfigured', () => {
      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: null,
      });
      expect(EditorialImagePreviewService.getConfiguredEndpointUrl()).toBeNull();
      expect(EditorialImagePreviewService.isPreviewEndpointConfigured()).toBe(false);
    });

    it('builds GET request URLs with only canonical assetId and variant=card and zero credentials', () => {
      const assetId = 'asset_news_1710000000000_card01';
      const urlStr = buildEditorialImagePreviewRequestUrl(TEST_PREVIEW_ENDPOINT, assetId);
      expect(urlStr).toBe(
        `${TEST_PREVIEW_ENDPOINT}?assetId=${assetId}&variant=${EDITORIAL_IMAGE_PREVIEW_VARIANT}`
      );
      const parsed = new URL(urlStr!);
      expect(Array.from(parsed.searchParams.keys())).toEqual(['assetId', 'variant']);
      expect(parsed.searchParams.get('assetId')).toBe(assetId);
      expect(parsed.searchParams.get('variant')).toBe('card');
      expect(parsed.username).toBe('');
      expect(parsed.password).toBe('');
    });
  });

  describe('2. Pure AssetId Extraction across richBodyAr and richBodyEn', () => {
    it('extracts unique valid editorialImage assetIds across both richBodyAr and richBodyEn in deterministic order without mutating documents', () => {
      const richBodyAr: RichNewsDocumentWrapperV2 = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { dir: 'rtl' },
              content: [{ type: 'text', text: 'مقدمة المقال' }],
            },
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_1001_ar_first',
                altAr: 'صورة ١',
                width: '50%',
                layout: 'float-start',
              },
            },
            {
              type: 'blockquote',
              attrs: { dir: 'rtl' },
              content: [
                {
                  type: 'editorialImage',
                  attrs: {
                    assetId: 'asset_news_1002_shared',
                    altAr: 'صورة ٢ مشتركة',
                    width: '100%',
                    layout: 'block-full',
                  },
                },
              ],
            },
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_1001_ar_first',
                altAr: 'صورة ١ مكررة',
                width: '50%',
                layout: 'float-end',
              },
            },
          ],
        },
      };

      const richBodyEn: RichNewsDocumentWrapperV2 = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_1002_shared',
                altAr: 'صورة ٢ مشتركة',
                altEn: 'Shared image 2',
                width: '75%',
                layout: 'block-center',
              },
            },
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_1003_en_only',
                altAr: 'صورة ٣',
                altEn: 'Image 3 English',
                width: '25%',
                layout: 'float-start',
              },
            },
          ],
        },
      };

      const snapshotArBefore = JSON.stringify(richBodyAr);
      const snapshotEnBefore = JSON.stringify(richBodyEn);

      const extracted = extractPersistedEditorialImageAssetIds(richBodyAr, richBodyEn);

      expect(extracted).toEqual([
        'asset_news_1001_ar_first',
        'asset_news_1002_shared',
        'asset_news_1003_en_only',
      ]);

      // Verify zero mutation and no preview URLs injected into document JSON
      expect(JSON.stringify(richBodyAr)).toBe(snapshotArBefore);
      expect(JSON.stringify(richBodyEn)).toBe(snapshotEnBefore);
      expect(JSON.stringify(richBodyAr)).not.toContain('blob:');
      expect(JSON.stringify(richBodyEn)).not.toContain('blob:');
    });

    it('ignores V1 documents, malformed editorialImage nodes, nodes with injected preview URLs, or invalid attributes', () => {
      const v1Doc = {
        schemaVersion: 1,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_v1_ignored',
                altAr: 'صورة',
                width: '50%',
                layout: 'float-start',
              },
            },
          ],
        },
      };

      expect(extractPersistedEditorialImageAssetIdsFromDocument(v1Doc)).toEqual([]);

      const v2WithMalformedNodes = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            // Missing altAr
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_missing_alt',
                width: '50%',
                layout: 'float-start',
              },
            },
            // Invalid width
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_bad_width',
                altAr: 'صورة',
                width: '60%',
                layout: 'float-start',
              },
            },
            // Extra forbidden node key (e.g. previewUrl on node)
            {
              type: 'editorialImage',
              previewUrl: 'blob:https://example.com/123',
              attrs: {
                assetId: 'asset_news_extra_node_key',
                altAr: 'صورة',
                width: '50%',
                layout: 'float-start',
              },
            },
            // Extra forbidden attr key (e.g. src in attrs)
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_extra_attr_key',
                altAr: 'صورة',
                width: '50%',
                layout: 'float-start',
                src: 'https://storage.googleapis.com/bucket/card.webp',
              },
            },
            // Path traversal assetId
            {
              type: 'editorialImage',
              attrs: {
                assetId: '../editorial_images/private/card',
                altAr: 'صورة',
                width: '50%',
                layout: 'float-start',
              },
            },
            // Unsupported block type wrapping an editorialImage
            {
              type: 'scriptBlock',
              content: [
                {
                  type: 'editorialImage',
                  attrs: {
                    assetId: 'asset_news_inside_unsupported',
                    altAr: 'صورة',
                    width: '50%',
                    layout: 'float-start',
                  },
                },
              ],
            },
            // One genuine valid node
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_news_valid_survivor_01',
                altAr: 'صورة صحيحة',
                width: '50%',
                layout: 'float-start',
              },
            },
          ],
        },
      };

      expect(
        extractPersistedEditorialImageAssetIds(v1Doc, v2WithMalformedNodes)
      ).toEqual(['asset_news_valid_survivor_01']);
    });
  });

  describe('3. Authenticated Preview HTTP Client Security & Validation', () => {
    it('sends GET with ?assetId=<id>&variant=card and Authorization: Bearer <token> without leaking tokens in URLs', async () => {
      const fetchSpy = vi.fn<typeof fetch>(async () =>
        createWebpResponse(createValidWebpBytes(128))
      );

      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: TEST_PREVIEW_ENDPOINT,
        getRefreshedAdminIdToken: async () => TEST_ID_TOKEN,
        fetchImpl: fetchSpy,
      });

      const controller = new AbortController();
      const outcome = await EditorialImagePreviewService.fetchPreviewImage({
        assetId: 'asset_news_20261024_authcheck',
        signal: controller.signal,
      });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.assetId).toBe('asset_news_20261024_authcheck');
        expect(outcome.variant).toBe('card');
        expect(outcome.mimeType).toBe('image/webp');
        expect(outcome.byteLength).toBe(128);
        expect(outcome.blob.type).toBe('image/webp');
      }

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(String(calledUrl)).toBe(
        `${TEST_PREVIEW_ENDPOINT}?assetId=asset_news_20261024_authcheck&variant=card`
      );
      expect(String(calledUrl)).not.toContain(TEST_ID_TOKEN);
      expect(String(calledUrl)).not.toContain('token=');
      expect(calledInit?.method).toBe('GET');
      expect((calledInit?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${TEST_ID_TOKEN}`
      );
      expect((calledInit?.headers as Record<string, string>).Accept).toBe('image/webp');
      expect(calledInit?.signal).toBe(controller.signal);
    });

    it('uses NewsAdminClient.getRefreshedAdminIdToken() by default when no token override is injected', async () => {
      const fetchSpy = vi.fn<typeof fetch>(async () =>
        createWebpResponse(createValidWebpBytes(64))
      );
      const tokenSpy = vi
        .spyOn(NewsAdminClient, 'getRefreshedAdminIdToken')
        .mockResolvedValue('refreshed_token_from_news_admin_client');

      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: TEST_PREVIEW_ENDPOINT,
        fetchImpl: fetchSpy,
      });

      const outcome = await EditorialImagePreviewService.fetchPreviewImage({
        assetId: 'asset_news_20261024_defaultauth',
      });

      expect(outcome.ok).toBe(true);
      expect(tokenSpy).toHaveBeenCalledTimes(1);
      const [, calledInit] = fetchSpy.mock.calls[0];
      expect((calledInit?.headers as Record<string, string>).Authorization).toBe(
        'Bearer refreshed_token_from_news_admin_client'
      );
    });

    it('validates assetId and endpoint before making any network or token calls', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      const tokenSpy = vi.fn(async () => TEST_ID_TOKEN);

      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: TEST_PREVIEW_ENDPOINT,
        getRefreshedAdminIdToken: tokenSpy,
        fetchImpl: fetchSpy,
      });

      const badIdRes = await EditorialImagePreviewService.fetchPreviewImage({
        assetId: '../invalid_asset_id',
      });
      expect(badIdRes).toEqual({
        ok: false,
        assetId: '../invalid_asset_id',
        errorCode: 'INVALID_ASSET_ID',
      });
      expect(tokenSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();

      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: null,
        getRefreshedAdminIdToken: tokenSpy,
        fetchImpl: fetchSpy,
      });

      const unconfRes = await EditorialImagePreviewService.fetchPreviewImage({
        assetId: 'asset_news_20261024_valid01',
      });
      expect(unconfRes).toEqual({
        ok: false,
        assetId: 'asset_news_20261024_valid01',
        errorCode: 'PREVIEW_ENDPOINT_UNCONFIGURED',
      });
      expect(tokenSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([400, 401, 403, 404, 405, 500, 503])(
      'rejects non-200 HTTP status %i cleanly without throwing',
      async (statusCode) => {
        const fetchSpy = vi.fn<typeof fetch>(async () =>
          new Response(JSON.stringify({ ok: false, errorCode: 'DENIED' }), {
            status: statusCode,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        EditorialImagePreviewService.setRuntimeOverrides({
          endpointUrl: TEST_PREVIEW_ENDPOINT,
          getRefreshedAdminIdToken: async () => TEST_ID_TOKEN,
          fetchImpl: fetchSpy,
        });

        const outcome = await EditorialImagePreviewService.fetchPreviewImage({
          assetId: 'asset_news_20261024_statuscheck',
        });

        expect(outcome).toEqual({
          ok: false,
          assetId: 'asset_news_20261024_statuscheck',
          errorCode: 'HTTP_STATUS_REJECTED',
          httpStatus: statusCode,
        });
      }
    );

    it('rejects responses with non-image/webp Content-Type, empty bodies, oversized bodies, or malformed non-WebP bytes', async () => {
      // 1. Invalid MIME type (e.g. image/png or text/html)
      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: TEST_PREVIEW_ENDPOINT,
        getRefreshedAdminIdToken: async () => TEST_ID_TOKEN,
        fetchImpl: async () =>
          createWebpResponse(createValidWebpBytes(64), 200, {
            'Content-Type': 'image/png',
          }),
      });

      const wrongMime = await EditorialImagePreviewService.fetchPreviewImage({
        assetId: 'asset_news_20261024_mime',
      });
      expect(wrongMime).toEqual({
        ok: false,
        assetId: 'asset_news_20261024_mime',
        errorCode: 'INVALID_CONTENT_TYPE',
        httpStatus: 200,
      });

      // 2. Empty body (0 bytes)
      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: TEST_PREVIEW_ENDPOINT,
        getRefreshedAdminIdToken: async () => TEST_ID_TOKEN,
        fetchImpl: async () =>
          new Response(new Uint8Array(0), {
            status: 200,
            headers: { 'Content-Type': 'image/webp' },
          }),
      });

      const emptyBody = await EditorialImagePreviewService.fetchPreviewImage({
        assetId: 'asset_news_20261024_empty',
      });
      expect(emptyBody).toEqual({
        ok: false,
        assetId: 'asset_news_20261024_empty',
        errorCode: 'EMPTY_RESPONSE_BODY',
        httpStatus: 200,
      });

      // 3. Oversized body via Content-Length or stream exceeding maxBytes
      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: TEST_PREVIEW_ENDPOINT,
        getRefreshedAdminIdToken: async () => TEST_ID_TOKEN,
        maxBytes: 256,
        fetchImpl: async () =>
          createWebpResponse(createValidWebpBytes(512), 200, {
            'Content-Type': 'image/webp',
          }),
      });

      const oversized = await EditorialImagePreviewService.fetchPreviewImage({
        assetId: 'asset_news_20261024_oversized',
      });
      expect(oversized).toEqual({
        ok: false,
        assetId: 'asset_news_20261024_oversized',
        errorCode: 'SIZE_LIMIT_EXCEEDED',
        httpStatus: 200,
      });

      // 4. Malformed non-WebP bytes (e.g. PNG magic bytes disguised with Content-Type: image/webp)
      const fakeWebp = new Uint8Array(64);
      fakeWebp.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      expect(isValidWebpPreviewBinary(fakeWebp, MAX_EDITORIAL_IMAGE_PREVIEW_BYTES)).toBe(false);

      EditorialImagePreviewService.setRuntimeOverrides({
        endpointUrl: TEST_PREVIEW_ENDPOINT,
        getRefreshedAdminIdToken: async () => TEST_ID_TOKEN,
        fetchImpl: async () =>
          createWebpResponse(fakeWebp, 200, {
            'Content-Type': 'image/webp',
          }),
      });

      const malformed = await EditorialImagePreviewService.fetchPreviewImage({
        assetId: 'asset_news_20261024_malformed',
      });
      expect(malformed).toEqual({
        ok: false,
        assetId: 'asset_news_20261024_malformed',
        errorCode: 'MALFORMED_IMAGE_BINARY',
        httpStatus: 200,
      });
    });
  });

  describe('4. Lifecycle, Cancellation, Generation Guard, Registry Revocation & Staged Preview Precedence', () => {
    it('fetches each unique assetId across AR and EN once, registers blob URLs in createOwnedPreviewUrlRegistry, and revokes all on reset/close', async () => {
      const createdUrls: string[] = [];
      const revokedUrls: string[] = [];
      const requestedAssetIds: string[] = [];

      const session = createEditorialDraftPreviewSessionController({
        createObjectUrl: () => {
          const url = `blob:https://promiseofplanet.org/preview-${createdUrls.length + 1}`;
          createdUrls.push(url);
          return url;
        },
        revokeObjectUrl: (url) => {
          revokedUrls.push(url);
        },
        fetchPreview: async ({ assetId }) => {
          requestedAssetIds.push(assetId);
          const bytes = createValidWebpBytes(64);
          return {
            ok: true,
            assetId,
            variant: 'card',
            mimeType: 'image/webp',
            byteLength: bytes.byteLength,
            bytes,
            blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'image/webp' }),
          };
        },
      });

      const richBodyAr = createSampleV2RichDoc(
        ['asset_news_shared_01', 'asset_news_ar_02'],
        'rtl'
      );
      const richBodyEn = createSampleV2RichDoc(
        ['asset_news_shared_01', 'asset_news_en_03'],
        'ltr'
      );

      const updates: Array<Readonly<Record<string, string>>> = [];
      const finalMap = await session.loadPersistedPreviewsForDraft({
        richBodyAr,
        richBodyEn,
        onPreviewMapUpdated: (map) => updates.push(map),
      });

      // Deduplicated across AR and EN: 3 unique assetIds fetched once each
      expect(requestedAssetIds).toEqual([
        'asset_news_shared_01',
        'asset_news_ar_02',
        'asset_news_en_03',
      ]);
      expect(createdUrls).toHaveLength(3);
      expect(Object.keys(finalMap)).toEqual([
        'asset_news_shared_01',
        'asset_news_ar_02',
        'asset_news_en_03',
      ]);
      expect(session.getRegistry().isUrlOwned('asset_news_shared_01')).toBe(true);
      expect(session.getRegistry().isUrlOwned('asset_news_ar_02')).toBe(true);
      expect(session.getRegistry().isUrlOwned('asset_news_en_03')).toBe(true);
      expect(revokedUrls).toHaveLength(0);

      // Closing editor / resetting session revokes all owned preview URLs
      session.resetAndRevokeAll();
      expect(revokedUrls).toEqual(createdUrls);
      expect(session.getPersistedPreviewMap()).toEqual({});
    });

    it('aborts pending requests, increments generation counter, and ignores/revokes late async responses when switching drafts', async () => {
      const createdUrls: string[] = [];
      const revokedUrls: string[] = [];
      const abortSignals: Record<string, AbortSignal | undefined> = {};

      let resolveDraftA!: (value: any) => void;
      const draftAPromise = new Promise<any>((resolve) => {
        resolveDraftA = resolve;
      });

      const session = createEditorialDraftPreviewSessionController({
        createObjectUrl: () => {
          const url = `blob:https://promiseofplanet.org/gen-${createdUrls.length + 1}`;
          createdUrls.push(url);
          return url;
        },
        revokeObjectUrl: (url) => {
          revokedUrls.push(url);
        },
        fetchPreview: async ({ assetId, signal }) => {
          abortSignals[assetId] = signal;
          if (assetId === 'asset_news_slow_draft_a') {
            return draftAPromise;
          }
          const bytes = createValidWebpBytes(64);
          return {
            ok: true,
            assetId,
            variant: 'card',
            mimeType: 'image/webp',
            byteLength: bytes.byteLength,
            bytes,
            blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'image/webp' }),
          };
        },
      });

      const stateSnapshots: Array<Readonly<Record<string, string>>> = [];

      // Start loading Draft A (slow in-flight request)
      const loadA = session.loadPersistedPreviewsForDraft({
        richBodyAr: createSampleV2RichDoc(['asset_news_slow_draft_a'], 'rtl'),
        onPreviewMapUpdated: (map) => stateSnapshots.push(map),
      });
      const genA = session.getGeneration();

      // Switch immediately to Draft B before Draft A finishes
      const loadB = await session.loadPersistedPreviewsForDraft({
        richBodyAr: createSampleV2RichDoc(['asset_news_fast_draft_b'], 'rtl'),
        onPreviewMapUpdated: (map) => stateSnapshots.push(map),
      });
      const genB = session.getGeneration();

      expect(genB).toBeGreaterThan(genA);
      expect(abortSignals['asset_news_slow_draft_a']?.aborted).toBe(true);
      expect(loadB).toEqual({
        asset_news_fast_draft_b: 'blob:https://promiseofplanet.org/gen-1',
      });

      // Now let stale Draft A response resolve late
      const bytesA = createValidWebpBytes(64);
      resolveDraftA({
        ok: true,
        assetId: 'asset_news_slow_draft_a',
        variant: 'card',
        mimeType: 'image/webp',
        byteLength: bytesA.byteLength,
        bytes: bytesA,
        blob: new Blob([bytesA.buffer as ArrayBuffer], { type: 'image/webp' }),
      });
      await loadA;

      // Late response from Draft A must NOT enter the registry or overwrite Draft B state
      expect(session.getPersistedPreviewMap()).toEqual({
        asset_news_fast_draft_b: 'blob:https://promiseofplanet.org/gen-1',
      });
      expect(session.getPersistedPreviewMap()['asset_news_slow_draft_a']).toBeUndefined();
      expect(createdUrls).toHaveLength(1);
    });

    it('never overwrites an actively staged session-owned image preview mapping', async () => {
      const stagedSessionMap: Record<string, string> = {
        asset_news_actively_staged_01: 'blob:https://promiseofplanet.org/staged-live-01',
      };

      const fetchSpy = vi.fn(async ({ assetId }: { readonly assetId: string }) => {
        const bytes = createValidWebpBytes(64);
        return {
          ok: true as const,
          assetId,
          variant: 'card' as const,
          mimeType: 'image/webp' as const,
          byteLength: bytes.byteLength,
          bytes,
          blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'image/webp' }),
        };
      });

      const session = createEditorialDraftPreviewSessionController({
        createObjectUrl: () => 'blob:https://promiseofplanet.org/persisted-fetched-02',
        revokeObjectUrl: () => {},
        fetchPreview: fetchSpy,
      });

      const persistedMap = await session.loadPersistedPreviewsForDraft({
        richBodyAr: createSampleV2RichDoc(
          ['asset_news_actively_staged_01', 'asset_news_persisted_02'],
          'rtl'
        ),
        getStagedSessionPreviewMap: () => stagedSessionMap,
      });

      // Actively staged asset was skipped by persisted loader
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: 'asset_news_persisted_02' })
      );
      expect(persistedMap['asset_news_actively_staged_01']).toBeUndefined();
      expect(persistedMap['asset_news_persisted_02']).toBe(
        'blob:https://promiseofplanet.org/persisted-fetched-02'
      );

      // Even if both maps contain the same key, mergePersistedAndStagedPreviewUrlMaps preserves the staged URL
      const merged = mergePersistedAndStagedPreviewUrlMaps(
        {
          asset_news_actively_staged_01: 'blob:https://promiseofplanet.org/stale-persisted',
          asset_news_persisted_02: 'blob:https://promiseofplanet.org/persisted-fetched-02',
        },
        stagedSessionMap
      );

      expect(merged).toEqual({
        asset_news_actively_staged_01: 'blob:https://promiseofplanet.org/staged-live-01',
        asset_news_persisted_02: 'blob:https://promiseofplanet.org/persisted-fetched-02',
      });
    });

    it('keeps article editable and saveable and preserves canonical richBody JSON without temporary preview URLs when preview fails or succeeds', async () => {
      const savedPayloads: any[] = [];
      NewsAdminClient.setTransport(async (action, payload) => {
        if (action === 'saveDraft') {
          savedPayloads.push(payload);
          return {
            item: {
              ...payload.item,
              id: payload.item.id || 'news-draft-saved-201',
              workflowState: WorkflowState.Draft,
              createdAt: '2026-10-24T10:00:00.000Z',
              updatedAt: '2026-10-24T10:05:00.000Z',
              history: [],
            },
          };
        }
        return { items: [] };
      });

      const richBodyAr = createSampleV2RichDoc(['asset_news_persisted_save_01'], 'rtl');
      const richBodyEn = createSampleV2RichDoc(['asset_news_persisted_save_01'], 'ltr');

      const draftArticle: NewsItem = {
        id: 'news-draft-201',
        titleAr: 'مسودة خبر تحتوي على صورة محفوظة',
        titleEn: 'Draft article with persisted editorial image',
        summaryAr: 'ملخص الخبر',
        summaryEn: 'Article summary',
        bodyAr: 'فقرة أولى',
        bodyEn: 'First paragraph',
        richBodyAr,
        richBodyEn,
        category: 'Climate',
        author: TEST_ADMIN_USER.name,
        tags: ['مناخ'],
        sources: ['وعد الكوكب'],
        workflowState: WorkflowState.Draft,
        createdAt: '2026-10-24T10:00:00.000Z',
        updatedAt: '2026-10-24T10:00:00.000Z',
        history: [],
      };

      // Render AdminNewsManagement with reopened draft when preview endpoint is unconfigured
      const markup = renderToStaticMarkup(
        React.createElement(AdminNewsManagement, {
          currentUser: TEST_ADMIN_USER,
          initialActiveItem: draftArticle,
          initialIsCreating: false,
        })
      );
      expect(markup).toContain('مسودة خبر تحتوي على صورة محفوظة');

      // Verify saving the draft preserves canonical V2 richBody without any blob: or preview URLs
      const imageSession = new NewsEditorImageSessionController();
      const saveOutcome = await imageSession.executeSaveWorkflow({
        isDraft: true,
        isCreating: false,
        activeItem: draftArticle,
        editForm: {
          ...draftArticle,
          titleAr: 'مسودة خبر محدثة بعد فتح المعاينة',
          bodyArHasEdited: true,
          bodyEnHasEdited: true,
        },
        tagsInput: 'مناخ',
        sourcesInput: 'وعد الكوكب',
        currentUser: TEST_ADMIN_USER,
        isAr: true,
      });

      expect(saveOutcome.ok).toBe(true);
      expect(savedPayloads).toHaveLength(1);
      const serializedSavedPayload = JSON.stringify(savedPayloads[0]);
      expect(serializedSavedPayload).toContain('asset_news_persisted_save_01');
      expect(serializedSavedPayload).not.toContain('blob:');
      expect(serializedSavedPayload).not.toContain('editorial_images/private');
    });
  });
});
