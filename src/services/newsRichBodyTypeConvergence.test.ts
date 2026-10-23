/**
 * Promise of Planet — IMG-F3-09/D1-C2
 * News Rich-Body Type Safety Convergence Tests
 *
 * Verifies:
 * 1. NewsItem accepts valid V1 and V2 wrappers (RichNewsDocumentWrapper and RichNewsDocumentWrapperV2).
 * 2. Invalid arbitrary objects are rejected by the static type contract on NewsItem and DraftSaveWithImageInput.
 * 3. Existing V1 editor state remains assignable and compatible across RichTextEditor / adapter / NewsItem / DraftSaveWithImageInput.
 * 4. V2 editorialImage attributes (assetId, altAr, altEn, captionAr, captionEn, width, layout) survive NewsAdminClient draft payload assembly.
 * 5. Existing featuredImage and single-Save behavior remain unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsItem } from '../types/news';
import type {
  RichNewsDocument,
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from '../types/richNewsDocument';
import { WorkflowState } from '../types/workflow';
import { AdminRole, type AdminUser } from '../types/admin';
import {
  NewsAdminClient,
  NewsEditorImageSessionController,
  createCanonicalNewsImageUploadIds,
  type DraftSaveWithImageInput,
} from './newsAdminClient';
import { convertPlainTextToRichDocument } from './richNewsDocumentContract';
import {
  richDocumentToTiptapJson,
  richDocumentToTiptapJsonByVersion,
  tiptapJsonToRichDocument,
  tiptapJsonToRichDocumentByVersion,
  tiptapJsonToRichDocumentV2,
} from './richNewsTiptapAdapter';

const TEST_ADMIN: AdminUser = {
  id: 'admin-c2-01',
  name: 'محرر وعد الكوكب',
  email: 'editor@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: true,
};

const VALID_V1_WRAPPER: RichNewsDocumentWrapper = {
  schemaVersion: 1,
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { dir: 'rtl', textAlign: 'right' },
        content: [{ type: 'text', text: 'نص الفقرة الأولى بالنسخة الأولى' }],
      },
    ],
  },
};

const VALID_V2_WRAPPER_AR: RichNewsDocumentWrapperV2 = {
  schemaVersion: 2,
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { dir: 'rtl', textAlign: 'right' },
        content: [{ type: 'text', text: 'فقرة تقديمية قبل الصورة التحريرية' }],
      },
      {
        type: 'editorialImage',
        attrs: {
          assetId: 'asset_news_1710000000000_inline01',
          altAr: 'صورة ميدانية لمنسوب النيل الأزرق',
          altEn: 'Field photo of Blue Nile water level',
          captionAr: 'قياس المناسيب في محطة الرصد - الخرطوم',
          captionEn: 'Water level measurement at Khartoum station',
          width: '75%',
          layout: 'block-center',
        },
      },
      {
        type: 'paragraph',
        attrs: { dir: 'rtl', textAlign: 'right' },
        content: [{ type: 'text', text: 'فقرة ختامية بعد الصورة التحريرية' }],
      },
    ],
  },
};

const VALID_V2_WRAPPER_EN: RichNewsDocumentWrapperV2 = {
  schemaVersion: 2,
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { dir: 'ltr', textAlign: 'left' },
        content: [{ type: 'text', text: 'Introductory paragraph before inline image' }],
      },
      {
        type: 'editorialImage',
        attrs: {
          assetId: 'asset_news_1710000000000_inline02',
          altAr: 'صورة توثيقية للغطاء النباتي',
          altEn: 'Documentary photo of vegetation cover',
          captionAr: 'رصد الغطاء النباتي',
          captionEn: 'Monitoring vegetation cover',
          width: '50%',
          layout: 'float-end',
        },
      },
    ],
  },
};

function createBaseNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'news-c2-draft-1',
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

describe('IMG-F3-09/D1-C2 — News Rich-Body Type Safety Convergence', () => {
  beforeEach(() => {
    NewsAdminClient.setImageUploadRuntime(null);
    NewsAdminClient.setTransport(null);
  });

  afterEach(() => {
    NewsAdminClient.setImageUploadRuntime(null);
    NewsAdminClient.setTransport(null);
    vi.restoreAllMocks();
  });

  it('1. NewsItem and RichNewsDocument accept valid V1 and V2 wrappers', () => {
    const docV1: RichNewsDocument = VALID_V1_WRAPPER;
    const docV2: RichNewsDocument = VALID_V2_WRAPPER_AR;

    const itemWithV1: NewsItem = createBaseNewsItem({
      richBodyAr: docV1,
      richBodyEn: VALID_V1_WRAPPER,
    });

    const itemWithV2: NewsItem = createBaseNewsItem({
      richBodyAr: docV2,
      richBodyEn: VALID_V2_WRAPPER_EN,
    });

    const itemWithMixed: NewsItem = createBaseNewsItem({
      richBodyAr: VALID_V2_WRAPPER_AR,
      richBodyEn: VALID_V1_WRAPPER,
    });

    expect(itemWithV1.richBodyAr?.schemaVersion).toBe(1);
    expect(itemWithV2.richBodyAr?.schemaVersion).toBe(2);
    expect(itemWithV2.richBodyEn?.schemaVersion).toBe(2);
    expect(itemWithMixed.richBodyAr?.schemaVersion).toBe(2);
    expect(itemWithMixed.richBodyEn?.schemaVersion).toBe(1);
  });

  it('2. Static type contract rejects invalid arbitrary objects on NewsItem and DraftSaveWithImageInput', () => {
    const invalidArbitraryObject = { arbitraryKey: 'not-a-rich-doc' };
    const invalidVersionObject = {
      schemaVersion: 99,
      doc: { type: 'doc', content: [] },
    };

    const validItem: NewsItem = createBaseNewsItem({
      // @ts-expect-error Arbitrary untyped object must be rejected by NewsItem.richBodyAr
      richBodyAr: invalidArbitraryObject,
      // @ts-expect-error Unsupported schemaVersion must be rejected by NewsItem.richBodyEn
      richBodyEn: invalidVersionObject,
    });

    const draftInput: DraftSaveWithImageInput = {
      isDraft: true,
      isCreating: false,
      activeItem: createBaseNewsItem(),
      editForm: {
        titleAr: 'عنوان',
        category: 'Water',
        // @ts-expect-error Arbitrary untyped object must be rejected by DraftSaveWithImageInput.editForm.richBodyAr
        richBodyAr: invalidArbitraryObject,
        // @ts-expect-error Unsupported schemaVersion must be rejected by DraftSaveWithImageInput.editForm.richBodyEn
        richBodyEn: invalidVersionObject,
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: TEST_ADMIN,
      isAr: true,
    };

    // Runtime sanity assertions so variables are exercised
    expect(validItem.id).toBe('news-c2-draft-1');
    expect(draftInput.isDraft).toBe(true);
  });

  it('3. Existing V1 editor state and version-dispatched Tiptap adapters remain assignable and compatible', () => {
    const plainConvertedAr = convertPlainTextToRichDocument('فقرة عربية', 'rtl');
    const plainConvertedEn = convertPlainTextToRichDocument('English paragraph', 'ltr');

    const tiptapV1 = richDocumentToTiptapJson(plainConvertedAr);
    const roundTrippedV1 = tiptapJsonToRichDocument(tiptapV1);

    const dispatchedTiptapV1 = richDocumentToTiptapJsonByVersion(roundTrippedV1);
    const dispatchedWrapperV1 = tiptapJsonToRichDocumentByVersion(dispatchedTiptapV1, 1);
    const dispatchedWrapperV2 = tiptapJsonToRichDocumentByVersion(
      richDocumentToTiptapJsonByVersion(VALID_V2_WRAPPER_AR),
      2
    );

    const itemFromV1Editor: NewsItem = createBaseNewsItem({
      richBodyAr: roundTrippedV1,
      richBodyEn: plainConvertedEn,
    });

    const itemFromDispatchedAdapter: NewsItem = createBaseNewsItem({
      richBodyAr: dispatchedWrapperV2,
      richBodyEn: dispatchedWrapperV1,
    });

    expect(itemFromV1Editor.richBodyAr).toEqual(roundTrippedV1);
    expect(itemFromV1Editor.richBodyEn).toEqual(plainConvertedEn);
    expect(itemFromDispatchedAdapter.richBodyAr).toEqual(VALID_V2_WRAPPER_AR);
    expect(itemFromDispatchedAdapter.richBodyEn).toEqual(roundTrippedV1);
  });

  it('4. V2 editorialImage attributes (assetId, altAr, altEn, captionAr, captionEn, width, layout) survive NewsAdminClient draft payload assembly', async () => {
    const capturedPayloads: Partial<NewsItem>[] = [];

    NewsAdminClient.setTransport(async (action, payload) => {
      if (action === 'saveDraft') {
        const itemPayload = payload.item as Partial<NewsItem>;
        capturedPayloads.push(JSON.parse(JSON.stringify(itemPayload)));
        return {
          item: {
            ...createBaseNewsItem(),
            ...itemPayload,
            id: itemPayload.id || 'news-persisted-v2-1',
          },
        };
      }
      throw new Error(`Unexpected action: ${action}`);
    });

    // Case A: Direct NewsAdminClient.saveNewsItem with V2 richBodyAr and richBodyEn
    const roundTrippedV2Ar = tiptapJsonToRichDocumentV2(
      richDocumentToTiptapJsonByVersion(VALID_V2_WRAPPER_AR)
    );
    const directSaved = await NewsAdminClient.saveNewsItem(
      {
        titleAr: 'خبر بالنسخة الثانية',
        category: 'Water',
        richBodyAr: roundTrippedV2Ar,
        richBodyEn: VALID_V2_WRAPPER_EN,
      },
      TEST_ADMIN,
      true
    );

    expect(directSaved.richBodyAr).toEqual(VALID_V2_WRAPPER_AR);
    expect(directSaved.richBodyEn).toEqual(VALID_V2_WRAPPER_EN);
    expect(capturedPayloads[0].richBodyAr).toEqual(VALID_V2_WRAPPER_AR);
    expect(capturedPayloads[0].richBodyEn).toEqual(VALID_V2_WRAPPER_EN);

    // Case B: NewsEditorImageSessionController.executeSaveWorkflow (create mode & update mode)
    const controller = new NewsEditorImageSessionController();

    const createOutcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: true,
      activeItem: createBaseNewsItem({ id: 'news-sudan-1710000000000' }),
      editForm: {
        id: 'news-sudan-1710000000000',
        titleAr: 'إنشاء خبر مع صورة مضمنة V2',
        category: 'Climate',
        bodyArHasEdited: true,
        bodyEnHasEdited: true,
        richBodyAr: VALID_V2_WRAPPER_AR,
        richBodyEn: VALID_V2_WRAPPER_EN,
      },
      tagsInput: 'مناخ, سودان',
      sourcesInput: 'مرصد البيئة',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(createOutcome.ok).toBe(true);
    if (createOutcome.ok) {
      expect(createOutcome.savedItem.richBodyAr).toEqual(VALID_V2_WRAPPER_AR);
      expect(createOutcome.savedItem.richBodyEn).toEqual(VALID_V2_WRAPPER_EN);
    }

    const createPayload = capturedPayloads[1];
    expect(createPayload.richBodyAr).toEqual(VALID_V2_WRAPPER_AR);
    expect(createPayload.richBodyEn).toEqual(VALID_V2_WRAPPER_EN);
    expect(createPayload.bodyAr).toBe('');
    expect(createPayload.bodyEn).toBe('');

    const imageBlockAr = (createPayload.richBodyAr as RichNewsDocumentWrapperV2).doc.content[1];
    expect(imageBlockAr).toEqual({
      type: 'editorialImage',
      attrs: {
        assetId: 'asset_news_1710000000000_inline01',
        altAr: 'صورة ميدانية لمنسوب النيل الأزرق',
        altEn: 'Field photo of Blue Nile water level',
        captionAr: 'قياس المناسيب في محطة الرصد - الخرطوم',
        captionEn: 'Water level measurement at Khartoum station',
        width: '75%',
        layout: 'block-center',
      },
    });

    // Case C: Reopened draft where bodyArHasEdited is false preserves existing activeItem V2 richBodyAr
    const existingV2Draft = createBaseNewsItem({
      id: 'news-existing-v2-99',
      richBodyAr: VALID_V2_WRAPPER_AR,
      richBodyEn: VALID_V1_WRAPPER,
    });

    const updateOutcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: false,
      activeItem: existingV2Draft,
      editForm: {
        ...existingV2Draft,
        titleAr: 'عنوان محدث مع الحفاظ على V2',
        bodyArHasEdited: false,
        bodyEnHasEdited: true,
        richBodyEn: VALID_V2_WRAPPER_EN,
      },
      tagsInput: 'المياه',
      sourcesInput: 'هيئة الأرصاد',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(updateOutcome.ok).toBe(true);
    const updatePayload = capturedPayloads[2];
    expect(updatePayload.richBodyAr).toEqual(VALID_V2_WRAPPER_AR);
    expect(updatePayload.richBodyEn).toEqual(VALID_V2_WRAPPER_EN);
  });

  it('5. Existing featuredImage upload and single-Save behavior remain unchanged alongside V2 richBody', async () => {
    const fixedIds = createCanonicalNewsImageUploadIds(1710000000000, 'c2feat01');
    const capturedPayloads: Partial<NewsItem>[] = [];

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://us-central1-promise-of-planet.cloudfunctions.net/editorialNewsImageUpload',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'valid-token-c2',
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
        capturedPayloads.push(itemPayload);
        return {
          item: {
            ...createBaseNewsItem(),
            ...itemPayload,
          },
        };
      }
      throw new Error(`Unexpected action: ${action}`);
    });

    const controller = new NewsEditorImageSessionController({
      idFactory: () => fixedIds,
      urlAdapter: {
        createObjectURL: () => 'blob:https://example.org/c2-preview',
        revokeObjectURL: vi.fn(),
      },
    });

    const bytes = new Uint8Array(1024);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const file = new File([bytes], 'featured.png', { type: 'image/png', lastModified: 1710000000000 });

    controller.selectFile(file);
    controller.setImageMetadata({
      altAr: 'صورة بارزة للمقال',
      altEn: 'Featured article image',
    });

    const outcome = await controller.executeSaveWorkflow({
      isDraft: true,
      isCreating: false,
      activeItem: createBaseNewsItem(),
      editForm: {
        ...createBaseNewsItem(),
        bodyArHasEdited: true,
        richBodyAr: VALID_V2_WRAPPER_AR,
      },
      tagsInput: 'المياه',
      sourcesInput: 'هيئة الأرصاد',
      currentUser: TEST_ADMIN,
      isAr: true,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.linkedAssetId).toBe(fixedIds.assetId);
      expect(outcome.savedItem.featuredImage).toBe(fixedIds.assetId);
      expect(outcome.savedItem.richBodyAr).toEqual(VALID_V2_WRAPPER_AR);
    }
    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0].featuredImage).toBe(fixedIds.assetId);
    expect(capturedPayloads[0].richBodyAr).toEqual(VALID_V2_WRAPPER_AR);
  });
});
