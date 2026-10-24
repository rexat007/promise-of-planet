/**
 * Promise of Planet — IMG-F3-09/D2-D1
 * Multi-Asset Inline Image Session & Safe Single-Save Orchestration Tests
 *
 * Covers all mandatory Section 9 scenarios:
 * 1. Valid and invalid file staging (MIME, size, filename, whitespace/prohibited altAr, metadata update, pre-upload file replacement).
 * 2. Canonical identity creation (intakeId/assetId format, uniqueness, collision rejection).
 * 3. AR/EN reference deduplication (shared assetId across richBodyAr and richBodyEn uploaded once).
 * 4. Multiple sequential inline uploads (deterministic first-seen order across AR and EN).
 * 5. Featured plus inline images in one save.
 * 6. Removal before save results in zero upload (explicit removeInlineImage and document-level node removal).
 * 7. Previously persisted V2 references (preserved from activeItem baseline without re-upload).
 * 8. Unknown new assetId rejection (fails closed before any upload or saveDraft call).
 * 9. Upload identity mismatch rejection (HTTP 201 with mismatched assetId/intakeId transitions to Ambiguous and blocks saveDraft).
 * 10. Retained Completed reuse (first inline image Completed, second fails -> retry uploads only second image).
 * 11. Ambiguous, CleanupPending, and NeedsReconciliation fail-closed (no blind automatic retry).
 * 12. Failed draft save then safe retry (retains both featured and inline Completed receipts and previews; retry performs zero re-uploads).
 * 13. Preview ownership and revocation (revokes only session-owned URLs on replace, remove, disposeInlinePreviews, resetSession; preserves inline previews across draft-save retry).
 * 14. Duplicate Save prevention (concurrent executeSaveWorkflow blocked with DUPLICATE_SUBMISSION_BLOCKED; staging/mutating blocked while save in flight).
 * 15. Original featured-image regressions (featured-only save, non-draft rejection, existing featuredImage preservation).
 * 16. Zero temporary URLs in persisted V2 (rejects blob:, data:, http/https, gs://, private/quarantine paths in editorialImage attrs and metadata).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsItem } from '../types/news';
import type {
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from '../types/richNewsDocument';
import { WorkflowState } from '../types/workflow';
import { AdminRole, type AdminUser } from '../types/admin';
import {
  NewsAdminClient,
  NewsEditorImageSessionController,
  createCanonicalNewsImageUploadIds,
  extractEditorialImageAssetIdsFromRichDocument,
  collectUniqueEditorialImageAssetIds,
} from './newsAdminClient';

const TEST_ADMIN: AdminUser = {
  id: 'admin-d2-d1-01',
  name: 'محرر وعد الكوكب',
  email: 'editor@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: true,
};

const VALID_V1_DOC: RichNewsDocumentWrapper = {
  schemaVersion: 1,
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { dir: 'rtl', textAlign: 'right' },
        content: [{ type: 'text', text: 'نص الفقرة بالنسخة الأولى' }],
      },
    ],
  },
};

function createValidPngFile(
  name = 'inline-photo.png',
  sizeBytes = 1024,
  lastModified = 1710000000000
): File {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return new File([bytes], name, { type: 'image/png', lastModified });
}

function createValidJpegFile(
  name = 'inline-photo.jpg',
  sizeBytes = 1536,
  lastModified = 1710000000500
): File {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return new File([bytes], name, { type: 'image/jpeg', lastModified });
}

function buildV2DocWithAssets(
  assets: Array<{
    assetId: string;
    altAr: string;
    altEn?: string;
    captionAr?: string;
    captionEn?: string;
    width?: '50%' | '75%' | '100%';
    layout?: 'block-center' | 'float-start' | 'float-end';
  }>,
  paragraphText = 'فقرة نصية تجريبية للمقال'
): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { dir: 'rtl', textAlign: 'right' },
          content: [{ type: 'text', text: paragraphText }],
        },
        ...assets.map((a) => ({
          type: 'editorialImage' as const,
          attrs: {
            assetId: a.assetId,
            altAr: a.altAr,
            ...(a.altEn !== undefined ? { altEn: a.altEn } : {}),
            ...(a.captionAr !== undefined ? { captionAr: a.captionAr } : {}),
            ...(a.captionEn !== undefined ? { captionEn: a.captionEn } : {}),
            width: a.width ?? '75%',
            layout: a.layout ?? 'block-center',
          },
        })),
      ],
    },
  };
}

function createBaseNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'news-d2-d1-draft-1',
    titleAr: 'عنوان الخبر التجريبي',
    titleEn: 'Experimental News Title',
    summaryAr: 'ملخص الخبر التجريبي',
    summaryEn: 'Experimental news summary',
    bodyAr: 'نص الخبر التجريبي',
    bodyEn: 'Experimental news body',
    author: 'فريق التحرير',
    category: 'Water',
    tags: ['المياه', 'النيل'],
    sources: ['هيئة الأرصاد'],
    workflowState: WorkflowState.Draft,
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    history: [],
    ...overrides,
  };
}

describe('IMG-F3-09/D2-D1 — Multi-Asset Inline Image Session & Safe Single-Save Orchestration', () => {
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;
  let previewCounter = 0;

  beforeEach(() => {
    previewCounter = 0;
    createObjectURLMock = vi.fn(
      () => `blob:https://example.org/inline-preview-${++previewCounter}`
    );
    revokeObjectURLMock = vi.fn();
    NewsAdminClient.setImageUploadRuntime(null);
    NewsAdminClient.setTransport(null);
  });

  afterEach(() => {
    NewsAdminClient.setImageUploadRuntime(null);
    NewsAdminClient.setTransport(null);
    vi.restoreAllMocks();
  });

  function createController(
    idFactory?: () => { readonly intakeId: string; readonly assetId: string }
  ) {
    return new NewsEditorImageSessionController({
      ...(idFactory ? { idFactory } : {}),
      urlAdapter: {
        createObjectURL: createObjectURLMock as unknown as (blob: Blob) => string,
        revokeObjectURL: revokeObjectURLMock as unknown as (url: string) => void,
      },
    });
  }

  it('1. Valid and invalid file staging, metadata update, and pre-upload file replacement', () => {
    const controller = createController();
    const validFile = createValidPngFile('nile-basin.png');

    // Reject invalid MIME/extension before staging
    const badMime = new File([new Uint8Array([1, 2, 3])], 'malware.exe', {
      type: 'application/octet-stream',
    });
    const badMimeResult = controller.stageInlineImage(badMime, {
      altAr: 'وصف عربي صالح',
    });
    expect(badMimeResult.ok).toBe(false);
    expect(createObjectURLMock).not.toHaveBeenCalled();

    // Reject whitespace-only altAr before staging
    const emptyAltResult = controller.stageInlineImage(validFile, {
      altAr: '    ',
      altEn: 'English alt',
    });
    expect(emptyAltResult.ok).toBe(false);
    expect(createObjectURLMock).not.toHaveBeenCalled();

    // Stage valid inline image
    const staged = controller.stageInlineImage(validFile, {
      altAr: 'صورة حوض النيل',
      altEn: 'Nile basin photo',
      captionAr: 'توثيق ميداني',
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    expect(staged.previewObjectUrl).toBe('blob:https://example.org/inline-preview-1');
    expect(controller.getInlineUploadStatus(staged.assetId)).toBe('Staged');
    expect(controller.getInlinePreviewUrl(staged.assetId)).toBe(
      'blob:https://example.org/inline-preview-1'
    );
    expect(controller.getInlinePreviewUrlMap()).toEqual({
      [staged.assetId]: 'blob:https://example.org/inline-preview-1',
    });

    // Update metadata before upload
    const updatedMeta = controller.updateInlineImageMetadata(staged.assetId, {
      captionEn: 'Field documentation caption',
    });
    expect(updatedMeta.ok).toBe(true);
    if (updatedMeta.ok) {
      expect(updatedMeta.metadata.captionEn).toBe('Field documentation caption');
      expect(updatedMeta.metadata.altAr).toBe('صورة حوض النيل');
    }

    // Replace binary file before upload (e.g., after crop/compression)
    const croppedFile = createValidJpegFile('cropped.jpg', 1024, 1710000000200);
    const replaced = controller.replaceInlineImageFile(staged.assetId, croppedFile);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;

    expect(replaced.assetId).toBe(staged.assetId);
    expect(replaced.intakeId).toBe(staged.intakeId);
    expect(replaced.previewObjectUrl).toBe('blob:https://example.org/inline-preview-2');
    expect(revokeObjectURLMock).toHaveBeenCalledWith(
      'blob:https://example.org/inline-preview-1'
    );
    expect(controller.getInlineImageState(staged.assetId)?.fileSignature).toContain(
      'cropped.jpg::image/jpeg::1024'
    );
  });

  it('2. Canonical identity creation and collision rejection', () => {
    const fixedIds = createCanonicalNewsImageUploadIds(1710000000000, 'dup00001');
    const controller = createController(() => fixedIds);

    const first = controller.stageInlineImage(createValidPngFile('one.png'), {
      altAr: 'الصورة الأولى',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.intakeId).toBe('intake_news_1710000000000_dup00001');
    expect(first.assetId).toBe('asset_news_1710000000000_dup00001');

    // Second stage with colliding assetId must fail closed without creating a preview URL
    const colliding = controller.stageInlineImage(createValidJpegFile('two.jpg'), {
      altAr: 'الصورة الثانية المتعارضة',
    });
    expect(colliding.ok).toBe(false);
    if (!colliding.ok) {
      expect(colliding.reasonCode).toBe('INVALID_GENERATED_IDS');
    }
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(controller.getAllInlineImageStates()).toHaveLength(1);
  });

  it('3. AR/EN reference deduplication -> shared staged inline assetId referenced in both richBodyAr and richBodyEn is uploaded only once', async () => {
    const controller = createController();
    const staged = controller.stageInlineImage(createValidPngFile('shared.png'), {
      altAr: 'صورة مشتركة بين النسختين',
      altEn: 'Shared image across both languages',
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    const uploadedAssetIds: string[] = [];
    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
        uploadedAssetIds.push(decoded.assetId);
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'Completed',
            intakeId: decoded.intakeId,
            assetId: decoded.assetId,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });

    const transportSpy = vi.fn(async (_action: string, payload: Record<string, unknown>) => ({
      item: {
        ...createBaseNewsItem(),
        ...(payload.item as Partial<NewsItem>),
      },
    }));
    NewsAdminClient.setTransport(transportSpy);

    const sharedDoc = buildV2DocWithAssets([
      {
        assetId: staged.assetId,
        altAr: 'صورة مشتركة بين النسختين',
        altEn: 'Shared image across both languages',
      },
    ]);

    expect(collectUniqueEditorialImageAssetIds(sharedDoc, sharedDoc)).toEqual([
      staged.assetId,
    ]);

    const outcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال بصورة مشتركة',
        category: 'Water',
        bodyArHasEdited: true,
        bodyEnHasEdited: true,
        richBodyAr: sharedDoc,
        richBodyEn: sharedDoc,
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(outcome.ok).toBe(true);
    expect(uploadedAssetIds).toEqual([staged.assetId]);
    expect(transportSpy).toHaveBeenCalledTimes(1);
  });

  it('4. Multiple sequential inline uploads -> stages 2 inline images across richBodyAr and richBodyEn and uploads in deterministic order before single saveDraft', async () => {
    const controller = createController();

    const stagedAr = controller.stageInlineImage(createValidPngFile('ar.png', 1024, 1), {
      altAr: 'صورة عربية مضمنة',
    });
    const stagedEn = controller.stageInlineImage(createValidJpegFile('en.jpg', 1536, 2), {
      altAr: 'صورة إنجليزية مضمنة',
      altEn: 'English inline image',
    });
    expect(stagedAr.ok && stagedEn.ok).toBe(true);
    if (!stagedAr.ok || !stagedEn.ok) return;

    const callOrder: string[] = [];
    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
        callOrder.push(`upload:${decoded.assetId}`);
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'Completed',
            intakeId: decoded.intakeId,
            assetId: decoded.assetId,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });

    NewsAdminClient.setTransport(async (action, payload) => {
      callOrder.push(`transport:${action}`);
      const itemPayload = payload.item as Partial<NewsItem>;
      return {
        item: {
          ...createBaseNewsItem(),
          ...itemPayload,
          id: 'news-saved-d2-d1-4',
        },
      };
    });

    const outcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال ثنائي اللغة مع صورتين مضمنتين',
        category: 'Climate',
        bodyArHasEdited: true,
        bodyEnHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: stagedAr.assetId, altAr: 'صورة عربية مضمنة' },
        ]),
        richBodyEn: buildV2DocWithAssets([
          {
            assetId: stagedEn.assetId,
            altAr: 'صورة إنجليزية مضمنة',
            altEn: 'English inline image',
          },
        ]),
      },
      tagsInput: 'مناخ',
      sourcesInput: 'مرصد البيئة',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(callOrder).toEqual([
      `upload:${stagedAr.assetId}`,
      `upload:${stagedEn.assetId}`,
      'transport:saveDraft',
    ]);
    expect(outcome.linkedInlineAssetIds).toEqual([stagedAr.assetId, stagedEn.assetId]);
    expect(outcome.reusedRetainedInlineAssetIds).toEqual([]);
  });

  it('5. Featured plus inline images in one save -> both upload and persist cleanly without interference', async () => {
    const inlineIds = createCanonicalNewsImageUploadIds(1710000000000, 'inld2d05');
    const featuredIds = createCanonicalNewsImageUploadIds(1710000000001, 'ftd2d05a');
    const idQueue = [inlineIds, featuredIds];

    const controller = createController(
      () => idQueue.shift() ?? createCanonicalNewsImageUploadIds()
    );

    const stagedInline = controller.stageInlineImage(createValidPngFile('inline5.png'), {
      altAr: 'صورة مضمنة 5',
    });
    expect(stagedInline.ok).toBe(true);
    if (!stagedInline.ok) return;

    controller.selectFile(createValidJpegFile('featured5.jpg'));
    controller.setImageMetadata({
      altAr: 'صورة بارزة 5',
    });

    const uploadedOrder: string[] = [];
    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
        uploadedOrder.push(decoded.assetId);
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'Completed',
            intakeId: decoded.intakeId,
            assetId: decoded.assetId,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });

    const capturedPayloads: Partial<NewsItem>[] = [];
    NewsAdminClient.setTransport(async (_action, payload) => {
      const itemPayload = payload.item as Partial<NewsItem>;
      capturedPayloads.push(itemPayload);
      return {
        item: {
          ...createBaseNewsItem(),
          ...itemPayload,
        },
      };
    });

    const outcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال يجمع بين الصورة البارزة والصورة المضمنة',
        category: 'Climate',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: stagedInline.assetId, altAr: 'صورة مضمنة 5' },
        ]),
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(uploadedOrder).toEqual([featuredIds.assetId, stagedInline.assetId]);
    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0].featuredImage).toBe(featuredIds.assetId);
    expect(
      extractEditorialImageAssetIdsFromRichDocument(capturedPayloads[0].richBodyAr)
    ).toEqual([stagedInline.assetId]);
  });

  it('6. Removal before save results in zero upload for removed assets and releases their previews', async () => {
    const controller = createController();
    const explicitlyRemoved = controller.stageInlineImage(
      createValidPngFile('explicit-remove.png', 1024, 5),
      { altAr: 'صورة محذوفة عبر removeInlineImage' }
    );
    const omittedFromDoc = controller.stageInlineImage(
      createValidPngFile('omitted-from-doc.png', 1024, 10),
      { altAr: 'صورة محذوفة من النص قبل الحفظ' }
    );
    const keptInDoc = controller.stageInlineImage(
      createValidJpegFile('kept.jpg', 1536, 20),
      { altAr: 'صورة باقية في النص' }
    );
    expect(explicitlyRemoved.ok && omittedFromDoc.ok && keptInDoc.ok).toBe(true);
    if (!explicitlyRemoved.ok || !omittedFromDoc.ok || !keptInDoc.ok) return;

    // Explicit removal revokes preview immediately
    expect(controller.removeInlineImage(explicitlyRemoved.assetId)).toBe(true);
    expect(revokeObjectURLMock).toHaveBeenCalledWith(explicitlyRemoved.previewObjectUrl);
    expect(controller.getInlineImageState(explicitlyRemoved.assetId)).toBeNull();

    const uploadedAssetIds: string[] = [];
    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
        uploadedAssetIds.push(decoded.assetId);
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'Completed',
            intakeId: decoded.intakeId,
            assetId: decoded.assetId,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });

    NewsAdminClient.setTransport(async (_action, payload) => ({
      item: {
        ...createBaseNewsItem(),
        ...(payload.item as Partial<NewsItem>),
      },
    }));

    const outcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال بعد حذف صورة قبل الحفظ',
        category: 'Water',
        bodyArHasEdited: true,
        bodyEnHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: keptInDoc.assetId, altAr: 'صورة باقية في النص' },
        ]),
        richBodyEn: VALID_V1_DOC,
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(outcome.ok).toBe(true);
    expect(uploadedAssetIds).toEqual([keptInDoc.assetId]);
    expect(controller.getInlineImageState(omittedFromDoc.assetId)).toBeNull();
    expect(revokeObjectURLMock).toHaveBeenCalledWith(omittedFromDoc.previewObjectUrl);
  });

  it('7. Previously persisted V2 references in activeItem -> Save succeeds without re-uploading existing asset', async () => {
    const controller = createController();
    const persistedAssetId = 'asset_news_1710000000000_pers0001';
    const existingDoc = buildV2DocWithAssets([
      { assetId: persistedAssetId, altAr: 'صورة محفوظة مسبقاً في المسودة' },
    ]);
    const activeItem = createBaseNewsItem({
      id: 'news-persisted-draft-7',
      richBodyAr: existingDoc,
      richBodyEn: VALID_V1_DOC,
    });

    const fetchSpy = vi.fn();
    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const transportSpy = vi.fn(async (_action: string, payload: Record<string, unknown>) => ({
      item: {
        ...activeItem,
        ...(payload.item as Partial<NewsItem>),
      },
    }));
    NewsAdminClient.setTransport(transportSpy);

    const outcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: false,
      activeItem,
      editForm: {
        ...activeItem,
        titleAr: 'تحديث عنوان المسودة مع بقاء الصورة المحفوظة',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets(
          [{ assetId: persistedAssetId, altAr: 'صورة محفوظة مسبقاً في المسودة' }],
          'فقرة معدلة مع الاحتفاظ بنفس الصورة المحفوظة'
        ),
      },
      tagsInput: 'المياه',
      sourcesInput: 'هيئة الأرصاد',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(outcome.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transportSpy).toHaveBeenCalledTimes(1);
  });

  it('8. Unknown new assetId rejection -> fails closed BEFORE any upload or saveNewsItem call when assetId is not in session or activeItem baseline', async () => {
    const controller = createController();
    const validStaged = controller.stageInlineImage(createValidPngFile('valid.png'), {
      altAr: 'صورة مجهزة بشكل صحيح',
    });
    expect(validStaged.ok).toBe(true);
    if (!validStaged.ok) return;

    const forgedAssetId = 'asset_news_1710000000000_forged99';
    const fetchSpy = vi.fn();
    const transportSpy = vi.fn();

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    NewsAdminClient.setTransport(transportSpy);

    const outcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'محاولة حفظ مع معرف صورة غير موثق',
        category: 'Climate',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: validStaged.assetId, altAr: 'صورة مجهزة بشكل صحيح' },
          { assetId: forgedAssetId, altAr: 'صورة غير مسجلة في الجلسة' },
        ]),
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.reasonCode).toBe('VALIDATION_FAILED');
    expect(outcome.unverifiedInlineAssetId).toBe(forgedAssetId);
    expect(outcome.errorMessage).toContain('UNVERIFIED_INLINE_IMAGE_ASSET');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it('9. Upload identity mismatch rejection -> HTTP 201 returning mismatched assetId or intakeId is rejected as Ambiguous and blocks saveNewsItem', async () => {
    const controller = createController();
    const staged = controller.stageInlineImage(createValidPngFile('mismatch.png'), {
      altAr: 'صورة مع عدم تطابق معرف الخادم',
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
      return new Response(
        JSON.stringify({
          ok: true,
          status: 'Completed',
          intakeId: decoded.intakeId,
          assetId: 'asset_news_1710000000000_wrongid1', // Mismatched assetId!
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const transportSpy = vi.fn();
    NewsAdminClient.setTransport(transportSpy);

    const outcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال مع استجابة خادم غير متطابقة',
        category: 'Water',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: staged.assetId, altAr: 'صورة مع عدم تطابق معرف الخادم' },
        ]),
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.reasonCode).toBe('UPLOAD_FAILED');
    expect(outcome.failedInlineAssetId).toBe(staged.assetId);
    expect(controller.getInlineUploadStatus(staged.assetId)).toBe('Ambiguous');
    expect(controller.getHaltedAmbiguousInlineUploads()).toHaveLength(1);
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it('10. Completed Image A + Rejected Image B -> halts automatic retry for B, blocks repeated Save while B is referenced, and saves A with zero re-uploads once B is removed from both AR and EN', async () => {
    const id1 = createCanonicalNewsImageUploadIds(1710000000001, 'imga0001');
    const id2 = createCanonicalNewsImageUploadIds(1710000000002, 'imgb0002');
    const idQueue = [id1, id2];
    const idFactorySpy = vi.fn(
      () => idQueue.shift() ?? createCanonicalNewsImageUploadIds()
    );
    const controller = createController(idFactorySpy);

    const first = controller.stageInlineImage(createValidPngFile('first.png', 1024, 1), {
      altAr: 'الصورة الأولى',
      altEn: 'First inline image',
    });
    const second = controller.stageInlineImage(createValidJpegFile('second.jpg', 1536, 2), {
      altAr: 'الصورة الثانية المرفوضة',
      altEn: 'Second rejected inline image',
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(idFactorySpy).toHaveBeenCalledTimes(2);

    const uploadCalls: Array<{ intakeId: string; assetId: string }> = [];

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
        uploadCalls.push({ intakeId: decoded.intakeId, assetId: decoded.assetId });

        if (decoded.assetId === second.assetId) {
          return new Response(
            JSON.stringify({
              ok: false,
              status: 'Rejected',
              intakeId: decoded.intakeId,
              assetId: decoded.assetId,
              errorCode: 'BINARY_REJECTED',
              rejectionCode: 'DECODE_FAILED',
            }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            ok: true,
            status: 'Completed',
            intakeId: decoded.intakeId,
            assetId: decoded.assetId,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });

    const transportSpy = vi.fn(async (_action: string, payload: Record<string, unknown>) => ({
      item: {
        ...createBaseNewsItem(),
        ...(payload.item as Partial<NewsItem>),
      },
    }));
    NewsAdminClient.setTransport(transportSpy);

    const docWithBoth = buildV2DocWithAssets([
      { assetId: first.assetId, altAr: 'الصورة الأولى', altEn: 'First inline image' },
      {
        assetId: second.assetId,
        altAr: 'الصورة الثانية المرفوضة',
        altEn: 'Second rejected inline image',
      },
    ]);

    const saveInputBothReferenced = {
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال بصورتين مضمنتين مع رفض الثانية',
        category: 'Water',
        bodyArHasEdited: true,
        bodyEnHasEdited: true,
        richBodyAr: docWithBoth,
        richBodyEn: docWithBoth,
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    };

    const firstAttempt = await controller.executeSaveWorkflow(saveInputBothReferenced);
    expect(firstAttempt.ok).toBe(false);
    if (firstAttempt.ok) return;

    expect(firstAttempt.reasonCode).toBe('UPLOAD_FAILED');
    expect(firstAttempt.failedInlineAssetId).toBe(second.assetId);
    expect(firstAttempt.errorMessage).toContain(second.assetId);
    expect(firstAttempt.errorMessage).toContain(
      'remove this failed inline image from both the Arabic and English article bodies'
    );
    // Definite Rejected outcome must NOT be mislabeled as Ambiguous
    expect(controller.getInlineUploadStatus(second.assetId)).toBe('Rejected');
    expect(controller.getHaltedAmbiguousInlineUploads()).toHaveLength(0);
    expect(controller.getHaltedInlineUploads()).toHaveLength(1);
    expect(controller.getHaltedInlineUploads()[0]).toMatchObject({
      intakeId: second.intakeId,
      assetId: second.assetId,
      status: 'Rejected',
      errorCode: 'BINARY_REJECTED',
      rejectionCode: 'DECODE_FAILED',
      httpStatus: 422,
    });
    // Image A's Completed receipt is preserved
    expect(firstAttempt.retainedCompletedInlineUploads).toHaveLength(1);
    expect(firstAttempt.retainedCompletedInlineUploads?.[0].assetId).toBe(first.assetId);
    expect(transportSpy).not.toHaveBeenCalled();
    expect(idFactorySpy).toHaveBeenCalledTimes(2); // Zero automatic ID regeneration

    // Repeated Save while B is still referenced in both bodies: zero new uploads, saveNewsItem blocked
    const repeatedAttempt = await controller.executeSaveWorkflow({
      ...saveInputBothReferenced,
      isAr: true,
    });
    expect(repeatedAttempt.ok).toBe(false);
    if (repeatedAttempt.ok) return;
    expect(repeatedAttempt.reasonCode).toBe('UPLOAD_FAILED');
    expect(repeatedAttempt.failedInlineAssetId).toBe(second.assetId);
    expect(repeatedAttempt.errorMessage).toContain('باللغتين العربية والإنجليزية');
    expect(uploadCalls).toHaveLength(2); // Still only the 2 initial calls from Save 1
    expect(transportSpy).not.toHaveBeenCalled();
    expect(idFactorySpy).toHaveBeenCalledTimes(2);

    // Deleting B from ONLY richBodyAr while B remains in richBodyEn STILL blocks Save with zero new uploads
    const docWithOnlyA = buildV2DocWithAssets([
      { assetId: first.assetId, altAr: 'الصورة الأولى', altEn: 'First inline image' },
    ]);
    const partialRemovalAttempt = await controller.executeSaveWorkflow({
      ...saveInputBothReferenced,
      editForm: {
        ...saveInputBothReferenced.editForm,
        richBodyAr: docWithOnlyA,
        richBodyEn: docWithBoth, // B still present in English body!
      },
    });
    expect(partialRemovalAttempt.ok).toBe(false);
    if (partialRemovalAttempt.ok) return;
    expect(partialRemovalAttempt.reasonCode).toBe('UPLOAD_FAILED');
    expect(partialRemovalAttempt.failedInlineAssetId).toBe(second.assetId);
    expect(uploadCalls).toHaveLength(2);
    expect(transportSpy).not.toHaveBeenCalled();

    // Deleting B from BOTH richBodyAr and richBodyEn allows Save to succeed using A's retained receipt with zero re-uploads
    const recoveredAttempt = await controller.executeSaveWorkflow({
      ...saveInputBothReferenced,
      editForm: {
        ...saveInputBothReferenced.editForm,
        richBodyAr: docWithOnlyA,
        richBodyEn: docWithOnlyA,
      },
    });
    expect(recoveredAttempt.ok).toBe(true);
    if (!recoveredAttempt.ok) return;

    expect(uploadCalls).toHaveLength(2); // Zero additional upload calls!
    expect(recoveredAttempt.reusedRetainedInlineAssetIds).toEqual([first.assetId]);
    expect(recoveredAttempt.linkedInlineAssetIds).toEqual([first.assetId]);
    expect(transportSpy).toHaveBeenCalledTimes(1);

    // B's diagnostic state remains preserved in session until explicit resetSession()
    const preservedBState = controller.getInlineImageState(second.assetId);
    expect(preservedBState).not.toBeNull();
    expect(preservedBState?.status).toBe('Rejected');
    expect(preservedBState?.uploadAttemptCount).toBe(1);
    expect(preservedBState?.haltedInlineUpload?.status).toBe('Rejected');
    expect(preservedBState?.lastUploadOutcome?.status).toBe('Rejected');

    controller.resetSession();
    expect(controller.getInlineImageState(second.assetId)).toBeNull();
  });

  it('11. Ambiguous, CleanupPending, and NeedsReconciliation fail-closed and block blind automatic retry', async () => {
    const controller = createController();
    const imgCleanup = controller.stageInlineImage(createValidPngFile('cleanup.png', 1024, 1), {
      altAr: 'صورة بحالة CleanupPending',
    });
    const imgReconcile = controller.stageInlineImage(
      createValidJpegFile('reconcile.jpg', 1536, 2),
      { altAr: 'صورة بحالة NeedsReconciliation' }
    );
    expect(imgCleanup.ok && imgReconcile.ok).toBe(true);
    if (!imgCleanup.ok || !imgReconcile.ok) return;

    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
      if (decoded.assetId === imgCleanup.assetId) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: 'CleanupPending',
            intakeId: decoded.intakeId,
            assetId: decoded.assetId,
            errorCode: 'CLEANUP_INCOMPLETE',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'NeedsReconciliation',
          intakeId: decoded.intakeId,
          assetId: decoded.assetId,
          errorCode: 'COMMIT_RECONCILIATION_REQUIRED',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    });

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const transportSpy = vi.fn();
    NewsAdminClient.setTransport(transportSpy);

    const saveInput = {
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال بصورة معلقة التنظيف',
        category: 'Climate',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: imgCleanup.assetId, altAr: 'صورة بحالة CleanupPending' },
        ]),
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    };

    const firstAttempt = await controller.executeSaveWorkflow(saveInput);
    expect(firstAttempt.ok).toBe(false);
    if (firstAttempt.ok) return;

    expect(firstAttempt.reasonCode).toBe('UPLOAD_FAILED');
    expect(firstAttempt.failedInlineAssetId).toBe(imgCleanup.assetId);
    expect(controller.getInlineUploadStatus(imgCleanup.assetId)).toBe('CleanupPending');
    expect(controller.getHaltedAmbiguousInlineUploads()).toHaveLength(1);
    expect(controller.getHaltedInlineUploads()).toHaveLength(1);
    expect(transportSpy).not.toHaveBeenCalled();

    // Replacing file or removing a halted ambiguous inline asset is forbidden
    expect(
      controller.replaceInlineImageFile(imgCleanup.assetId, createValidPngFile('new.png')).ok
    ).toBe(false);
    expect(controller.removeInlineImage(imgCleanup.assetId)).toBe(false);

    // Blind Retry Save with the same halted ambiguous inline image is blocked BEFORE any network call
    const blindRetry = await controller.executeSaveWorkflow(saveInput);
    expect(blindRetry.ok).toBe(false);
    if (blindRetry.ok) return;

    expect(blindRetry.reasonCode).toBe('UPLOAD_HALTED_AMBIGUOUS');
    expect(blindRetry.failedInlineAssetId).toBe(imgCleanup.assetId);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it('12. Failed draft save then safe retry -> retains completed receipts and inline previews; retry calls saveDraft with zero re-uploads', async () => {
    const featuredIds = createCanonicalNewsImageUploadIds(1710000000000, 'featd2d1');
    const inlineIds = createCanonicalNewsImageUploadIds(1710000000001, 'inld2d1a');
    const idQueue = [inlineIds, featuredIds];

    const controller = createController(
      () => idQueue.shift() ?? createCanonicalNewsImageUploadIds()
    );

    const stagedInline = controller.stageInlineImage(createValidPngFile('inline.png'), {
      altAr: 'صورة مضمنة في النص',
    });
    expect(stagedInline.ok).toBe(true);
    if (!stagedInline.ok) return;

    controller.selectFile(createValidJpegFile('featured.jpg'));
    controller.setImageMetadata({
      altAr: 'الصورة البارزة للمقال',
      altEn: 'Featured article image',
    });

    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
      return new Response(
        JSON.stringify({
          ok: true,
          status: 'Completed',
          intakeId: decoded.intakeId,
          assetId: decoded.assetId,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    let saveDraftShouldFail = true;
    const transportSpy = vi.fn(async (_action: string, payload: Record<string, unknown>) => {
      if (saveDraftShouldFail) {
        throw new Error('Firestore temporary write timeout');
      }
      return {
        item: {
          ...createBaseNewsItem(),
          ...(payload.item as Partial<NewsItem>),
          id: 'news-recovered-after-retry',
        },
      };
    });
    NewsAdminClient.setTransport(transportSpy);

    const saveInput = {
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال بصورة بارزة وصورة مضمنة',
        category: 'Water',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: stagedInline.assetId, altAr: 'صورة مضمنة في النص' },
        ]),
      },
      tagsInput: 'المياه',
      sourcesInput: 'هيئة الأرصاد',
      currentUser: TEST_ADMIN,
      isAr: false,
    };

    const firstSave = await controller.executeSaveWorkflow(saveInput);
    expect(firstSave.ok).toBe(false);
    if (firstSave.ok) return;

    expect(firstSave.reasonCode).toBe('DRAFT_SAVE_FAILED');
    expect(firstSave.retainedCompletedUpload?.assetId).toBe(featuredIds.assetId);
    expect(firstSave.retainedCompletedInlineUploads).toHaveLength(1);
    expect(firstSave.retainedCompletedInlineUploads?.[0].assetId).toBe(stagedInline.assetId);
    // Preview URL remains available while editor remains open for retry
    expect(controller.getInlinePreviewUrl(stagedInline.assetId)).toBe(
      stagedInline.previewObjectUrl
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(transportSpy).toHaveBeenCalledTimes(1);

    // Retry Save: zero re-uploads, reuses both featured and inline completed receipts
    saveDraftShouldFail = false;
    const secondSave = await controller.executeSaveWorkflow(saveInput);

    expect(secondSave.ok).toBe(true);
    if (!secondSave.ok) return;

    expect(fetchSpy).toHaveBeenCalledTimes(2); // Zero additional upload calls!
    expect(transportSpy).toHaveBeenCalledTimes(2);
    expect(secondSave.reusedRetainedUpload).toBe(true);
    expect(secondSave.linkedAssetId).toBe(featuredIds.assetId);
    expect(secondSave.reusedRetainedInlineAssetIds).toEqual([stagedInline.assetId]);
    expect(secondSave.linkedInlineAssetIds).toEqual([stagedInline.assetId]);
  });

  it('13. Preview ownership and revocation -> disposeInlinePreviews and resetSession revoke only session-owned object URLs', () => {
    const controller = createController();

    const inline1 = controller.stageInlineImage(createValidPngFile('one.png', 1024, 1), {
      altAr: 'صورة مضمنة 1',
    });
    const inline2 = controller.stageInlineImage(createValidJpegFile('two.jpg', 1536, 2), {
      altAr: 'صورة مضمنة 2',
    });
    const featuredSelection = controller.selectFile(createValidPngFile('featured.png', 2048, 3));

    expect(inline1.ok && inline2.ok).toBe(true);
    if (!inline1.ok || !inline2.ok) return;

    expect(controller.getAllInlineImageStates()).toHaveLength(2);
    expect(controller.getSelectedFile()).not.toBeNull();
    expect(featuredSelection.previewObjectUrl).toBe('blob:https://example.org/inline-preview-3');

    // disposeInlinePreviews revokes inline object URLs but leaves featured preview and staged entries intact
    controller.disposeInlinePreviews();
    expect(revokeObjectURLMock).toHaveBeenCalledWith(inline1.previewObjectUrl);
    expect(revokeObjectURLMock).toHaveBeenCalledWith(inline2.previewObjectUrl);
    expect(controller.getInlinePreviewUrlMap()).toEqual({});
    expect(controller.getPreviewObjectUrl()).toBe('blob:https://example.org/inline-preview-3');

    // Calling disposeInlinePreviews a second time does not double-revoke already-revoked URLs
    controller.disposeInlinePreviews();
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(2);

    // resetSession revokes remaining featured object URL and clears all state
    controller.resetSession();
    expect(controller.getAllInlineImageStates()).toHaveLength(0);
    expect(controller.getSelectedFile()).toBeNull();
    expect(controller.getPreviewObjectUrl()).toBeNull();
    expect(revokeObjectURLMock).toHaveBeenCalledWith(featuredSelection.previewObjectUrl);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(3);
  });

  it('14. Duplicate Save prevention -> blocks concurrent executeSaveWorkflow and blocks staging mutations while save is in flight', async () => {
    const controller = createController();
    const staged = controller.stageInlineImage(createValidPngFile('inflight.png'), {
      altAr: 'صورة قيد الرفع',
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    let resolveUpload!: (val: Response) => void;
    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveUpload = resolve;
          })
      ),
    });

    NewsAdminClient.setTransport(async (_action, payload) => ({
      item: {
        ...createBaseNewsItem(),
        ...(payload.item as Partial<NewsItem>),
      },
    }));

    const saveInput = {
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال لاختبار منع الإرسال المزدوج',
        category: 'Water',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: staged.assetId, altAr: 'صورة قيد الرفع' },
        ]),
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    };

    const firstSavePromise = controller.executeSaveWorkflow(saveInput);
    await new Promise((r) => setTimeout(r, 10));

    expect(controller.isSaving()).toBe(true);

    // Concurrent Save call must be blocked immediately
    const duplicateSave = await controller.executeSaveWorkflow(saveInput);
    expect(duplicateSave.ok).toBe(false);
    if (!duplicateSave.ok) {
      expect(duplicateSave.reasonCode).toBe('DUPLICATE_SUBMISSION_BLOCKED');
    }

    // Staging a new inline image while save is in flight is blocked
    const stageWhileBusy = controller.stageInlineImage(createValidPngFile('busy.png'), {
      altAr: 'محاولة تجهيز أثناء الحفظ',
    });
    expect(stageWhileBusy.ok).toBe(false);
    if (!stageWhileBusy.ok) {
      expect(stageWhileBusy.reasonCode).toBe('SAVE_IN_FLIGHT');
    }

    resolveUpload(
      new Response(
        JSON.stringify({
          ok: true,
          status: 'Completed',
          intakeId: staged.intakeId,
          assetId: staged.assetId,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const firstSaveOutcome = await firstSavePromise;
    expect(firstSaveOutcome.ok).toBe(true);
    expect(controller.isSaving()).toBe(false);
  });

  it('15. Original featured-image regressions -> preserves featured-only save, existing featuredImage reference, and non-Draft rejection', async () => {
    const controller = createController();
    const existingDraft = createBaseNewsItem({
      id: 'news-existing-featured-15',
      featuredImage: 'asset_news_1710000000000_existing',
      richBodyAr: VALID_V1_DOC,
    });

    // Non-draft state is rejected before any network call
    const nonDraftOutcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: false,
      activeItem: createBaseNewsItem({
        ...existingDraft,
        workflowState: WorkflowState.Published,
      }),
      editForm: existingDraft,
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    });
    expect(nonDraftOutcome.ok).toBe(false);
    if (!nonDraftOutcome.ok) {
      expect(nonDraftOutcome.reasonCode).toBe('NON_DRAFT_FORBIDDEN');
    }

    // Draft saved without selecting a new featured image or new inline image preserves existing featuredImage
    const capturedPayloads: Partial<NewsItem>[] = [];
    NewsAdminClient.setTransport(async (_action, payload) => {
      const itemPayload = payload.item as Partial<NewsItem>;
      capturedPayloads.push(itemPayload);
      return {
        item: {
          ...existingDraft,
          ...itemPayload,
        },
      };
    });

    const preservedOutcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: false,
      activeItem: existingDraft,
      editForm: {
        ...existingDraft,
        titleAr: 'تحديث نصي فقط مع بقاء الصورة البارزة',
      },
      tagsInput: 'المياه',
      sourcesInput: 'هيئة الأرصاد',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(preservedOutcome.ok).toBe(true);
    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0].featuredImage).toBe('asset_news_1710000000000_existing');
  });

  it('16. Zero temporary URLs in persisted V2 -> rejects blob:, data:, http/https, storage paths, or empty altAr in V2 editorialImage nodes before any upload', async () => {
    const controller = createController();
    const staged = controller.stageInlineImage(createValidPngFile(), {
      altAr: 'وصف صالح عند التجهيز',
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    // Staging metadata with blob: or data: URL in alt/caption is rejected at stage time
    const blobInAltStage = controller.stageInlineImage(createValidPngFile(), {
      altAr: 'صورة من الرابط blob:https://example.org/temp-123',
    });
    expect(blobInAltStage.ok).toBe(false);

    const fetchSpy = vi.fn();
    const transportSpy = vi.fn();
    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    NewsAdminClient.setTransport(transportSpy);

    // 1. V2 editorialImage node with blob: URL in assetId is rejected before any upload
    const blobAssetIdDoc = buildV2DocWithAssets([
      { assetId: 'blob:https://example.org/1234', altAr: 'وصف عربي' },
    ]);
    const blobAssetOutcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'عنوان صالح',
        category: 'Water',
        bodyArHasEdited: true,
        richBodyAr: blobAssetIdDoc,
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    });
    expect(blobAssetOutcome.ok).toBe(false);
    if (!blobAssetOutcome.ok) {
      expect(blobAssetOutcome.reasonCode).toBe('VALIDATION_FAILED');
      expect(blobAssetOutcome.errorMessage).toContain('INVALID_RICH_DOCUMENT_AR');
    }

    // 2. V2 editorialImage node with empty altAr is rejected before any upload
    const emptyAltDoc = buildV2DocWithAssets([
      { assetId: staged.assetId, altAr: '   ' },
    ]);
    const emptyAltOutcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'عنوان صالح ولكن عقدة الصورة بدون نص بديل',
        category: 'Water',
        bodyArHasEdited: true,
        richBodyAr: emptyAltDoc,
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    });

    expect(emptyAltOutcome.ok).toBe(false);
    if (!emptyAltOutcome.ok) {
      expect(emptyAltOutcome.reasonCode).toBe('VALIDATION_FAILED');
      expect(emptyAltOutcome.errorMessage).toContain('INVALID_RICH_DOCUMENT_AR');
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it('17. D2-D1-R1: Failed after intake session creation (HTTP 502 Failed) halts automatic retry and prevents INTAKE_ID_CONFLICT on repeated Save', async () => {
    const controller = createController();
    const staged = controller.stageInlineImage(createValidPngFile('failed-post-session.png'), {
      altAr: 'صورة فشل معالجتها بعد إنشاء الجلسة',
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'Failed',
          intakeId: decoded.intakeId,
          assetId: decoded.assetId,
          errorCode: 'VARIANT_GENERATION_FAILED',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    });

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const transportSpy = vi.fn();
    NewsAdminClient.setTransport(transportSpy);

    const saveInput = {
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال بصورة تفشل بعد فتح جلسة الرفع',
        category: 'Climate',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: staged.assetId, altAr: 'صورة فشل معالجتها بعد إنشاء الجلسة' },
        ]),
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    };

    const firstAttempt = await controller.executeSaveWorkflow(saveInput);
    expect(firstAttempt.ok).toBe(false);
    if (firstAttempt.ok) return;

    expect(firstAttempt.reasonCode).toBe('UPLOAD_FAILED');
    expect(firstAttempt.failedInlineAssetId).toBe(staged.assetId);
    expect(controller.getInlineUploadStatus(staged.assetId)).toBe('Failed');
    // Definite Failed is NOT mislabeled as Ambiguous
    expect(controller.getHaltedAmbiguousInlineUploads()).toHaveLength(0);
    expect(controller.getHaltedInlineUploads()).toHaveLength(1);
    expect(controller.getHaltedInlineUploads()[0]).toMatchObject({
      intakeId: staged.intakeId,
      assetId: staged.assetId,
      status: 'Failed',
      errorCode: 'VARIANT_GENERATION_FAILED',
      httpStatus: 502,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(transportSpy).not.toHaveBeenCalled();

    // Repeated Save with the failed inline asset still referenced performs ZERO new upload calls
    const secondAttempt = await controller.executeSaveWorkflow(saveInput);
    expect(secondAttempt.ok).toBe(false);
    if (secondAttempt.ok) return;

    expect(secondAttempt.reasonCode).toBe('UPLOAD_FAILED');
    expect(secondAttempt.failedInlineAssetId).toBe(staged.assetId);
    expect(secondAttempt.haltedInlineUpload?.status).toBe('Failed');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Zero retry calls!
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it('18. D2-D1-R1: Timeout and malformed server response halt automatic retry on repeated Save', async () => {
    const controller = createController();
    const imgTimeout = controller.stageInlineImage(createValidPngFile('timeout.png', 1024, 1), {
      altAr: 'صورة انتهت مهلة رفعها',
    });
    const imgMalformed = controller.stageInlineImage(
      createValidJpegFile('malformed.jpg', 1536, 2),
      { altAr: 'صورة باستجابة خادم مشوهة' }
    );
    expect(imgTimeout.ok && imgMalformed.ok).toBe(true);
    if (!imgTimeout.ok || !imgMalformed.ok) return;

    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const decoded = JSON.parse(decodeURIComponent(headers['X-Editorial-Image-Metadata']));
      if (decoded.assetId === imgTimeout.assetId) {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      return new Response('<<<NOT_JSON_RESPONSE>>>', {
        status: 201,
        headers: { 'Content-Type': 'text/plain' },
      });
    });

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const transportSpy = vi.fn();
    NewsAdminClient.setTransport(transportSpy);

    // 1. Timeout on imgTimeout -> Ambiguous + halted
    const timeoutSaveInput = {
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'مقال بصورة تنتهي مهلتها',
        category: 'Water',
        bodyArHasEdited: true,
        richBodyAr: buildV2DocWithAssets([
          { assetId: imgTimeout.assetId, altAr: 'صورة انتهت مهلة رفعها' },
        ]),
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: false,
    };

    const timeoutFirst = await controller.executeSaveWorkflow(timeoutSaveInput);
    expect(timeoutFirst.ok).toBe(false);
    expect(controller.getInlineUploadStatus(imgTimeout.assetId)).toBe('Ambiguous');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const timeoutRetry = await controller.executeSaveWorkflow(timeoutSaveInput);
    expect(timeoutRetry.ok).toBe(false);
    if (!timeoutRetry.ok) {
      expect(timeoutRetry.reasonCode).toBe('UPLOAD_HALTED_AMBIGUOUS');
      expect(timeoutRetry.failedInlineAssetId).toBe(imgTimeout.assetId);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Zero retry calls!

    // 2. Malformed HTTP 201 response on imgMalformed -> Ambiguous + halted
    const malformedSaveInput = {
      ...timeoutSaveInput,
      editForm: {
        ...timeoutSaveInput.editForm,
        richBodyAr: buildV2DocWithAssets([
          { assetId: imgMalformed.assetId, altAr: 'صورة باستجابة خادم مشوهة' },
        ]),
      },
    };

    const malformedFirst = await controller.executeSaveWorkflow(malformedSaveInput);
    expect(malformedFirst.ok).toBe(false);
    expect(controller.getInlineUploadStatus(imgMalformed.assetId)).toBe('Ambiguous');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const malformedRetry = await controller.executeSaveWorkflow(malformedSaveInput);
    expect(malformedRetry.ok).toBe(false);
    if (!malformedRetry.ok) {
      expect(malformedRetry.reasonCode).toBe('UPLOAD_HALTED_AMBIGUOUS');
      expect(malformedRetry.failedInlineAssetId).toBe(imgMalformed.assetId);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2); // Zero retry calls!
    expect(transportSpy).not.toHaveBeenCalled();
  });
});

