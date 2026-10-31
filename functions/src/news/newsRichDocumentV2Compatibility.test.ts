import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

import {
  validateRichNewsDocument,
  validateRichNewsDocumentV2,
  validateRichNewsDocumentByVersion,
  extractPlainTextFromRichDocument,
} from '../shared/richNewsDocumentContract';
import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
  validateEditorialImageAsset,
} from '../shared/editorialImageAssetContract';
import type {
  EditorialImageAssetMetadata,
  EditorialImageAssetVariant,
  EditorialImageAssetVariantKey,
} from '../types/editorialImageAsset';
import type {
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from '../types/richNewsDocument';
import type { NewsItemBackend, NewsRepository } from './newsRepository';
import { InMemoryEditorialImageAssetRepository } from './inMemoryEditorialImageAssetRepository';
import { InMemoryMediaRepository } from '../media/inMemoryMediaRepository';
import type { Video } from '../shared/contentContract';
import { NewsApplicationService, type ActorContext } from './newsApplicationService';
import { PublicNewsRepository } from './publicNewsRepository';
import { MAX_WORKFLOW_COMMENT_LENGTH } from './newsValidator';

const CANONICAL_VARIANT_KEYS: readonly EditorialImageAssetVariantKey[] = [
  'thumbnail',
  'card',
  'article_inline',
  'article_cover',
  'original_processed',
];

function createCanonicalTestAsset(assetId: string): EditorialImageAssetMetadata {
  const variants: Record<string, EditorialImageAssetVariant> = {};
  for (const key of CANONICAL_VARIANT_KEYS) {
    variants[key] = {
      variantKey: key,
      storagePath: buildEditorialImageVariantStoragePath(assetId, key, 'image/webp'),
      mimeType: 'image/webp',
      width: 800,
      height: 600,
      sizeBytes: 24576,
      sha256Checksum: 'a'.repeat(64),
    };
  }

  return createEditorialImageAssetRecord({
    assetId,
    createdByUid: 'admin-editor-01',
    createdAtIso: '2026-03-20T10:00:00.000Z',
    updatedAtIso: '2026-03-20T10:00:00.000Z',
    origin: 'news_article',
    originalFilename: `${assetId}.webp`,
    mimeType: 'image/webp',
    originalSizeBytes: 49152,
    originalWidth: 1600,
    originalHeight: 1200,
    sha256Checksum: 'b'.repeat(64),
    variants,
    altAr: 'صورة ميدانية لغرس أشجار السنط على ضفاف النيل',
    altEn: 'Field photo of planting Acacia trees along the Nile bank',
  });
}

class InMemoryTestNewsRepository implements NewsRepository {
  private readonly store = new Map<string, NewsItemBackend>();

  async getById(id: string): Promise<NewsItemBackend | null> {
    const item = this.store.get(id);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async save(item: NewsItemBackend): Promise<void> {
    this.store.set(item.id, JSON.parse(JSON.stringify(item)));
  }

  async listAll(): Promise<NewsItemBackend[]> {
    return Array.from(this.store.values()).map((item) => JSON.parse(JSON.stringify(item)));
  }

  async listPublished(_language?: 'ar' | 'en'): Promise<NewsItemBackend[]> {
    return Array.from(this.store.values())
      .filter((item) => item.workflowState === 'Published')
      .map((item) => JSON.parse(JSON.stringify(item)));
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

function createCanonicalTestMediaVideo(
  id: string,
  overrides: Partial<Video> = {}
): Video {
  return {
    id,
    titleAr: `فيديو وثائقي (${id})`,
    titleEn: `Documentary Video (${id})`,
    descriptionAr: 'توثيق ميداني للتنوع الحيوي في السودان.',
    descriptionEn: 'Field documentation of biodiversity in Sudan.',
    category: 'Biodiversity',
    sourceType: 'External',
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    youtubeVideoId: 'dQw4w9WgXcQ',
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    durationSeconds: 180,
    createdAt: '2026-03-20T10:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z',
    status: 'Published',
    approvalStatus: 'Approved',
    rightsStatus: 'Approved',
    ...overrides,
  };
}

describe('IMG-F3-09/D1-A — V1/V2 Rich News Validation & Plain-Text Compatibility', () => {
  let repo: InMemoryTestNewsRepository;
  let assetRepo: InMemoryEditorialImageAssetRepository;
  let mediaRepo: InMemoryMediaRepository;
  let service: NewsApplicationService;

  const editorActor: ActorContext = {
    uid: 'admin-editor-01',
    name: 'سارة أحمد',
    role: 'ContentEditor',
  };

  const reviewerActor: ActorContext = {
    uid: 'admin-reviewer-01',
    name: 'د. عبد العظيم',
    role: 'ManagingEditor',
  };

  const ownerActor: ActorContext = {
    uid: 'admin-owner-01',
    name: 'عباس عبد الحليم',
    role: 'Owner',
  };

  const validV1DocAr: RichNewsDocumentWrapper = {
    schemaVersion: 1,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, dir: 'rtl', textAlign: 'right' },
          content: [{ type: 'text', text: 'عنوان فرعي للتقرير' }],
        },
        {
          type: 'paragraph',
          attrs: { dir: 'rtl' },
          content: [
            { type: 'text', text: 'الفقرة الأولى من المقال.' },
            { type: 'hardBreak' },
            { type: 'text', text: 'السطر الثاني داخل الفقرة.' },
          ],
        },
        {
          type: 'blockquote',
          attrs: { dir: 'rtl' },
          content: [
            {
              type: 'paragraph',
              attrs: { dir: 'rtl' },
              content: [{ type: 'text', text: 'اقتباس بيئي مهم.' }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  attrs: { dir: 'rtl' },
                  content: [{ type: 'text', text: 'عنصر قائمة أول' }],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const validV2DocAr: RichNewsDocumentWrapperV2 = {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, dir: 'rtl', textAlign: 'right' },
          content: [{ type: 'text', text: 'مبادرة تشجير حوض النيل' }],
        },
        {
          type: 'paragraph',
          attrs: { dir: 'rtl' },
          content: [{ type: 'text', text: 'انطلقت المرحلة الأولى من مشروع التشجير.' }],
        },
        {
          type: 'editorialImage',
          attrs: {
            assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
            altAr: 'صورة ميدانية لغرس أشجار السنط على ضفاف النيل',
            altEn: 'Field photo of planting Acacia trees along the Nile bank',
            captionAr: 'المتطوعون يغرسون الشتلات في ولاية نهر النيل',
            captionEn: 'Volunteers planting saplings in River Nile State',
            width: '50%',
            layout: 'float-start',
          },
        },
        {
          type: 'paragraph',
          attrs: { dir: 'rtl' },
          content: [{ type: 'text', text: 'وتستهدف المرحلة زراعة عشرة آلاف شجرة محلية.' }],
        },
      ],
    },
  };

  const validV2DocEn: RichNewsDocumentWrapperV2 = {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, dir: 'ltr', textAlign: 'left' },
          content: [{ type: 'text', text: 'Nile Basin Afforestation Initiative' }],
        },
        {
          type: 'paragraph',
          attrs: { dir: 'ltr' },
          content: [{ type: 'text', text: 'Phase one of the afforestation project has launched.' }],
        },
        {
          type: 'editorialImage',
          attrs: {
            assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
            altAr: 'صورة ميدانية لغرس أشجار السنط على ضفاف النيل',
            altEn: 'Field photo of planting Acacia trees along the Nile bank',
            captionAr: 'المتطوعون يغرسون الشتلات في ولاية نهر النيل',
            captionEn: 'Volunteers planting saplings in River Nile State',
            width: '75%',
            layout: 'block-center',
          },
        },
        {
          type: 'paragraph',
          attrs: { dir: 'ltr' },
          content: [{ type: 'text', text: 'The phase targets planting ten thousand native trees.' }],
        },
      ],
    },
  };

  beforeEach(async () => {
    repo = new InMemoryTestNewsRepository();
    assetRepo = new InMemoryEditorialImageAssetRepository();
    mediaRepo = new InMemoryMediaRepository();
    await mediaRepo.createVideo(createCanonicalTestMediaVideo('vid-sennar-01'));
    await mediaRepo.createVideo(createCanonicalTestMediaVideo('vid-sennar-02'));
    await assetRepo.createIfAbsent(
      createCanonicalTestAsset('asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c')
    );
    await assetRepo.createIfAbsent(
      createCanonicalTestAsset('asset_abcdef0123456789abcdef0123456789')
    );
    service = new NewsApplicationService(repo, assetRepo, mediaRepo);
  });

  describe('1. Validator & Plain-Text Extraction Contract', () => {
    it('keeps validateRichNewsDocument strict for V1 and validateRichNewsDocumentV2 strict for V2', () => {
      expect(validateRichNewsDocument(validV1DocAr).valid).toBe(true);
      expect(validateRichNewsDocument(validV2DocAr).valid).toBe(false);

      expect(validateRichNewsDocumentV2(validV2DocAr).valid).toBe(true);
      expect(validateRichNewsDocumentV2(validV1DocAr).valid).toBe(false);

      expect(validateRichNewsDocumentByVersion(validV1DocAr).valid).toBe(true);
      expect(validateRichNewsDocumentByVersion(validV2DocAr).valid).toBe(true);
    });

    it('preserves V1 paragraph, heading, hardBreak, blockquote, and list extraction semantics', () => {
      const extracted = extractPlainTextFromRichDocument(validV1DocAr);
      expect(extracted).toBe(
        [
          'عنوان فرعي للتقرير',
          'الفقرة الأولى من المقال.\nالسطر الثاني داخل الفقرة.',
          'اقتباس بيئي مهم.',
          'عنصر قائمة أول',
        ].join('\n\n')
      );
    });

    it('extracts plain text from V2 documents while skipping editorialImage nodes completely', () => {
      const extractedAr = extractPlainTextFromRichDocument(validV2DocAr);
      expect(extractedAr).toBe(
        [
          'مبادرة تشجير حوض النيل',
          'انطلقت المرحلة الأولى من مشروع التشجير.',
          'وتستهدف المرحلة زراعة عشرة آلاف شجرة محلية.',
        ].join('\n\n')
      );
      expect(extractedAr).not.toContain('asset_');
      expect(extractedAr).not.toContain('صورة ميدانية');
      expect(extractedAr).not.toContain('المتطوعون يغرسون');

      const extractedEn = extractPlainTextFromRichDocument(validV2DocEn);
      expect(extractedEn).toBe(
        [
          'Nile Basin Afforestation Initiative',
          'Phase one of the afforestation project has launched.',
          'The phase targets planting ten thousand native trees.',
        ].join('\n\n')
      );
    });

    it('returns empty string for valid V2 document containing only editorialImage nodes', () => {
      const imageOnlyV2: RichNewsDocumentWrapperV2 = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_11112222333344445555666677778888',
                altAr: 'صورة مستقلة',
                width: '100%',
                layout: 'block-full',
              },
            },
          ],
        },
      };
      expect(extractPlainTextFromRichDocument(imageOnlyV2)).toBe('');
    });

    it('fails closed in extractPlainTextFromRichDocument for missing or unknown schema versions and invalid documents', () => {
      const unversionedDoc = {
        doc: validV1DocAr.doc,
      };
      const rawProseMirrorDoc = validV1DocAr.doc;
      const versionZeroDoc = { ...validV1DocAr, schemaVersion: 0 };
      const versionThreeDoc = { ...validV2DocAr, schemaVersion: 3 };
      const invalidV1WithImage = {
        schemaVersion: 1,
        doc: validV2DocAr.doc,
      };
      const invalidV2MissingAltAr = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'نص لا يجب استخراجه عند فشل التحقق' }],
            },
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_11112222333344445555666677778888',
                altAr: '   ',
                width: '50%',
                layout: 'float-start',
              },
            },
          ],
        },
      };

      expect(extractPlainTextFromRichDocument(null)).toBe('');
      expect(extractPlainTextFromRichDocument(undefined)).toBe('');
      expect(extractPlainTextFromRichDocument(unversionedDoc)).toBe('');
      expect(extractPlainTextFromRichDocument(rawProseMirrorDoc)).toBe('');
      expect(extractPlainTextFromRichDocument(versionZeroDoc)).toBe('');
      expect(extractPlainTextFromRichDocument(versionThreeDoc)).toBe('');
      expect(extractPlainTextFromRichDocument(invalidV1WithImage)).toBe('');
      expect(extractPlainTextFromRichDocument(invalidV2MissingAltAr)).toBe('');
    });
  });

  describe('2. NewsApplicationService V1 & V2 Draft Creation and Updates', () => {
    it('creates and updates existing V1 text-only drafts without regression', async () => {
      const created = await service.createDraft(
        {
          titleAr: 'تقرير مناخي بالنسخة الأولى',
          summaryAr: 'ملخص التقرير',
          bodyAr: '',
          richBodyAr: validV1DocAr,
          category: 'Climate',
        },
        editorActor
      );

      expect(created.workflowState).toBe('Draft');
      expect(created.richBodyAr).toEqual(validV1DocAr);
      expect(created.bodyAr).toBe(
        [
          'عنوان فرعي للتقرير',
          'الفقرة الأولى من المقال.\nالسطر الثاني داخل الفقرة.',
          'اقتباس بيئي مهم.',
          'عنصر قائمة أول',
        ].join('\n\n')
      );

      const updatedV1: RichNewsDocumentWrapper = {
        schemaVersion: 1,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { dir: 'rtl' },
              content: [{ type: 'text', text: 'فقرة محدثة بالنسخة الأولى.' }],
            },
          ],
        },
      };

      const updated = await service.updateDraft(
        created.id,
        {
          richBodyAr: updatedV1,
        },
        editorActor
      );

      expect(updated.richBodyAr).toEqual(updatedV1);
      expect(updated.bodyAr).toBe('فقرة محدثة بالنسخة الأولى.');
    });

    it('creates and updates valid bilingual V2 drafts with editorialImage nodes and derives plain text excluding images', async () => {
      const created = await service.createDraft(
        {
          titleAr: 'مبادرة تشجير حوض النيل',
          titleEn: 'Nile Basin Afforestation Initiative',
          summaryAr: 'ملخص المبادرة',
          summaryEn: 'Initiative summary',
          bodyAr: '',
          bodyEn: '',
          richBodyAr: validV2DocAr,
          richBodyEn: validV2DocEn,
          category: 'Biodiversity',
        },
        editorActor
      );

      expect(created.workflowState).toBe('Draft');
      expect(created.richBodyAr).toEqual(validV2DocAr);
      expect(created.richBodyEn).toEqual(validV2DocEn);
      expect(created.bodyAr).toBe(
        [
          'مبادرة تشجير حوض النيل',
          'انطلقت المرحلة الأولى من مشروع التشجير.',
          'وتستهدف المرحلة زراعة عشرة آلاف شجرة محلية.',
        ].join('\n\n')
      );
      expect(created.bodyEn).toBe(
        [
          'Nile Basin Afforestation Initiative',
          'Phase one of the afforestation project has launched.',
          'The phase targets planting ten thousand native trees.',
        ].join('\n\n')
      );

      const updatedV2Ar: RichNewsDocumentWrapperV2 = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { dir: 'rtl' },
              content: [{ type: 'text', text: 'تحديث الفقرة الافتتاحية بعد المراجعة.' }],
            },
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_abcdef0123456789abcdef0123456789',
                altAr: 'صورة محدثة للمشروع',
                width: '100%',
                layout: 'block-full',
              },
            },
          ],
        },
      };

      const updated = await service.updateDraft(
        created.id,
        {
          richBodyAr: updatedV2Ar,
        },
        editorActor
      );

      expect(updated.richBodyAr).toEqual(updatedV2Ar);
      expect(updated.bodyAr).toBe('تحديث الفقرة الافتتاحية بعد المراجعة.');
      expect(updated.richBodyEn).toEqual(validV2DocEn);
      expect(updated.bodyEn).toBe(created.bodyEn);
    });

    it('rejects contradictory plain text and V2 richBody updates in createDraft and updateDraft', async () => {
      await expect(
        service.createDraft(
          {
            titleAr: 'مقال متناقض',
            summaryAr: 'ملخص',
            bodyAr: 'نص مختلف عن محتوى الوثيقة الغنية',
            richBodyAr: validV2DocAr,
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/CONTRADICTORY_UPDATE/);

      const draft = await service.createDraft(
        {
          titleAr: 'مقال سليم',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: validV2DocAr,
          category: 'Climate',
        },
        editorActor
      );

      await expect(
        service.updateDraft(
          draft.id,
          {
            richBodyEn: validV2DocEn,
            bodyEn: 'Mismatched English plain text',
          },
          editorActor
        )
      ).rejects.toThrow(/CONTRADICTORY_UPDATE/);
    });
  });

  describe('3. Fail-Closed Rejection of Invalid Image Attributes, URLs, and Schema Versions', () => {
    it('rejects missing or blank altAr in createDraft and updateDraft', async () => {
      const missingAltArDoc = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
                altAr: '   ',
                width: '50%',
                layout: 'float-start',
              },
            },
          ],
        },
      };

      await expect(
        service.createDraft(
          {
            titleAr: 'مقال بصورة بدون نص بديل',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: missingAltArDoc,
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RICH_DOCUMENT_AR.*altAr/i);

      const validDraft = await service.createDraft(
        {
          titleAr: 'مقال سليم',
          summaryAr: 'ملخص',
          bodyAr: 'نص أولي',
          category: 'Climate',
        },
        editorActor
      );

      await expect(
        service.updateDraft(
          validDraft.id,
          {
            richBodyEn: missingAltArDoc,
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RICH_DOCUMENT_EN.*altAr/i);
    });

    it('rejects invalid width and layout values in V2 editorialImage nodes', async () => {
      const invalidWidthDoc = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
                altAr: 'نص بديل سليم',
                width: '60%',
                layout: 'float-start',
              },
            },
          ],
        },
      };

      const invalidLayoutDoc = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'editorialImage',
              attrs: {
                assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
                altAr: 'نص بديل سليم',
                width: '50%',
                layout: 'float-left',
              },
            },
          ],
        },
      };

      await expect(
        service.createDraft(
          {
            titleAr: 'عرض غير صالح',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: invalidWidthDoc,
            category: 'Water',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RICH_DOCUMENT_AR.*width must be one of/i);

      await expect(
        service.createDraft(
          {
            titleAr: 'تخطيط غير صالح',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyEn: invalidLayoutDoc,
            category: 'Water',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RICH_DOCUMENT_EN.*layout must be one of/i);
    });

    it('rejects forbidden src, blob:, data:, http:, https:, and GCS references on editorialImage nodes and links', async () => {
      const forbiddenImagePayloads = [
        {
          label: 'src attribute with https URL',
          attrs: {
            assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
            altAr: 'صورة',
            width: '50%',
            layout: 'float-start',
            src: 'https://storage.googleapis.com/bucket/image.webp',
          },
        },
        {
          label: 'blob URL in src attribute',
          attrs: {
            assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
            altAr: 'صورة',
            width: '50%',
            layout: 'float-start',
            src: 'blob:https://promiseofplanet.org/550e8400-e29b-41d4-a716-446655440000',
          },
        },
        {
          label: 'data URL in url attribute',
          attrs: {
            assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
            altAr: 'صورة',
            width: '50%',
            layout: 'float-start',
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          },
        },
        {
          label: 'http URL in assetId',
          attrs: {
            assetId: 'http://example.com/image.png',
            altAr: 'صورة',
            width: '50%',
            layout: 'float-start',
          },
        },
        {
          label: 'https URL in assetId',
          attrs: {
            assetId: 'https://example.com/image.png',
            altAr: 'صورة',
            width: '50%',
            layout: 'float-start',
          },
        },
        {
          label: 'gs:// URI in assetId',
          attrs: {
            assetId: 'gs://bucket/editorial_images/private/master.webp',
            altAr: 'صورة',
            width: '50%',
            layout: 'float-start',
          },
        },
        {
          label: 'private GCS storagePath attribute',
          attrs: {
            assetId: 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
            altAr: 'صورة',
            width: '50%',
            layout: 'float-start',
            storagePath: 'editorial_images/private/asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c/master.webp',
          },
        },
      ];

      for (const payload of forbiddenImagePayloads) {
        const doc = {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'editorialImage',
                attrs: payload.attrs,
              },
            ],
          },
        };

        await expect(
          service.createDraft(
            {
              titleAr: `اختبار رفض ${payload.label}`,
              summaryAr: 'ملخص',
              bodyAr: '',
              richBodyAr: doc,
              category: 'Climate',
            },
            editorActor
          )
        ).rejects.toThrow(/INVALID_RICH_DOCUMENT_AR/);
      }

      const blobLinkInV2 = {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'رابط مؤقت غير مسموح',
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: 'blob:https://promiseofplanet.org/12345' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      await expect(
        service.createDraft(
          {
            titleAr: 'اختبار رفض رابط blob',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: blobLinkInV2,
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RICH_DOCUMENT_AR.*Unsafe link URL protocol/i);
    });

    it('rejects unknown or missing schema versions and V1 documents containing editorialImage', async () => {
      const unknownVersionDoc = {
        schemaVersion: 3,
        doc: validV2DocAr.doc,
      };
      const missingVersionDoc = {
        doc: validV2DocAr.doc,
      };
      const v1WithEditorialImage = {
        schemaVersion: 1,
        doc: validV2DocAr.doc,
      };

      await expect(
        service.createDraft(
          {
            titleAr: 'نسخة غير معروفة',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: unknownVersionDoc,
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RICH_DOCUMENT_AR.*expected 1 or 2, received 3/i);

      await expect(
        service.createDraft(
          {
            titleAr: 'نسخة مفقودة',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: missingVersionDoc,
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RICH_DOCUMENT_AR.*expected 1 or 2, received undefined/i);

      await expect(
        service.createDraft(
          {
            titleAr: 'صورة داخل النسخة الأولى',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: v1WithEditorialImage,
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RICH_DOCUMENT_AR.*Disallowed or unknown node type: "editorialImage"/i);
    });
  });

  describe('4. Editorial Workflow Preservation with V2 Documents', () => {
    it('preserves full Draft -> InReview -> ChangesRequested -> Draft -> Approved -> Published workflow and blocks non-Draft edits', async () => {
      const created = await service.createDraft(
        {
          titleAr: 'تقرير التنوع الحيوي بالنسخة الثانية',
          titleEn: 'Biodiversity V2 Report',
          summaryAr: 'ملخص التقرير',
          summaryEn: 'Report summary',
          bodyAr: '',
          bodyEn: '',
          richBodyAr: validV2DocAr,
          richBodyEn: validV2DocEn,
          category: 'Biodiversity',
        },
        editorActor
      );

      const inReview = await service.transitionWorkflow(created.id, 'InReview', editorActor, 'جاهز للمراجعة');
      expect(inReview.workflowState).toBe('InReview');

      await expect(
        service.updateDraft(
          created.id,
          { titleAr: 'تعديل غير مسموح أثناء المراجعة' },
          editorActor
        )
      ).rejects.toThrow(/INVALID_TRANSITION/);

      const changesRequested = await service.transitionWorkflow(
        created.id,
        'ChangesRequested',
        reviewerActor,
        'يرجى تحديث الفقرة الثانية'
      );
      expect(changesRequested.workflowState).toBe('ChangesRequested');

      const backToDraft = await service.transitionWorkflow(created.id, 'Draft', editorActor, 'إعادة للمسودة');
      expect(backToDraft.workflowState).toBe('Draft');

      const revisedV2Ar: RichNewsDocumentWrapperV2 = {
        ...validV2DocAr,
        doc: {
          type: 'doc',
          content: [
            ...validV2DocAr.doc.content,
            {
              type: 'paragraph',
              attrs: { dir: 'rtl' },
              content: [{ type: 'text', text: 'فقرة إضافية بعد تلبية ملاحظات المراجع.' }],
            },
          ],
        },
      };

      const updatedDraft = await service.updateDraft(
        created.id,
        { richBodyAr: revisedV2Ar },
        editorActor
      );
      expect(updatedDraft.bodyAr).toContain('فقرة إضافية بعد تلبية ملاحظات المراجع.');
      expect(updatedDraft.richBodyAr).toEqual(revisedV2Ar);

      await service.transitionWorkflow(created.id, 'InReview', editorActor);
      const approved = await service.transitionWorkflow(created.id, 'Approved', reviewerActor);
      expect(approved.workflowState).toBe('Approved');

      // Publication is blocked while the referenced canonical image remains PendingReview
      await expect(
        service.transitionWorkflow(created.id, 'Published', reviewerActor)
      ).rejects.toThrow(/EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE/);

      // Establish canonical human-approved public usage rights permitting publication for this article
      const canonicalAssetId = 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';
      const approvedAsset: EditorialImageAssetMetadata = {
        ...createCanonicalTestAsset(canonicalAssetId),
        updatedAtIso: '2026-03-20T11:00:00.000Z',
        rights: {
          status: 'Approved',
          licenseType: 'ContextSpecificAssessment',
          rightsHolder: 'Promise of Planet Field Documentation Team',
          sourceAttributionAr: 'فريق التوثيق الميداني في وعد الكوكب',
          sourceAttributionEn: 'Promise of Planet Field Documentation Team',
          evidenceRefs: ['evidence_ref_nile_afforestation_001'],
          documentedException:
            'Verified field photography cleared for this biodiversity report.',
          usageScope: {
            scopeType: 'ArticleRestricted',
            articleIds: [created.id],
          },
          reviewedByUid: reviewerActor.uid,
          reviewedAtIso: '2026-03-20T11:00:00.000Z',
          reviewReason:
            'Approved human rights clearance for biodiversity V2 article publication.',
        },
      };
      expect(validateEditorialImageAsset(approvedAsset).valid).toBe(true);

      assetRepo.corruptStoredRecordForTesting(canonicalAssetId, {
        assetId: canonicalAssetId,
        revision: 2,
        asset: approvedAsset,
      });

      const published = await service.transitionWorkflow(created.id, 'Published', reviewerActor);
      expect(published.workflowState).toBe('Published');
      expect(published.publishedAt).toBeDefined();
      expect(published.richBodyAr).toEqual(revisedV2Ar);
      expect(published.richBodyEn).toEqual(validV2DocEn);
    });
  });

  describe('5. NEWS-REVISION-01 — Owner-Only Published Article Withdrawal & Redraft Lifecycle', () => {
    const canonicalAssetId = 'asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

    async function createAndPublishCanonicalArticle(): Promise<NewsItemBackend> {
      const created = await service.createDraft(
        {
          titleAr: 'تحقيق استقصائي حول الغطاء النباتي في سنار',
          titleEn: 'Investigative Report on Vegetation Cover in Sennar',
          kickerAr: 'تقرير خاص',
          kickerEn: 'Special Report',
          journalisticType: 'Investigation',
          summaryAr: 'ملخص التحقيق الميداني في سنار.',
          summaryEn: 'Summary of the Sennar field investigation.',
          bodyAr: '',
          bodyEn: '',
          richBodyAr: validV2DocAr,
          richBodyEn: validV2DocEn,
          category: 'Biodiversity',
          tags: ['Sennar', 'Forests'],
          sources: ['Sudan Forestry National Corporation'],
          featuredImage: canonicalAssetId,
          location: 'Sennar State / ولاية سنار',
          urgencyLevel: 'Urgent',
          relatedVideoIds: ['vid-sennar-01', 'vid-sennar-02'],
        },
        editorActor
      );

      await service.transitionWorkflow(created.id, 'InReview', editorActor, 'تقديم للمراجعة');
      await service.transitionWorkflow(created.id, 'Approved', reviewerActor, 'اعتماد التحقيق');

      const approvedAsset: EditorialImageAssetMetadata = {
        ...createCanonicalTestAsset(canonicalAssetId),
        updatedAtIso: '2026-03-21T10:00:00.000Z',
        rights: {
          status: 'Approved',
          licenseType: 'ContextSpecificAssessment',
          rightsHolder: 'Promise of Planet Field Documentation Team',
          sourceAttributionAr: 'فريق التوثيق الميداني في وعد الكوكب',
          sourceAttributionEn: 'Promise of Planet Field Documentation Team',
          evidenceRefs: ['evidence_ref_nile_afforestation_001'],
          documentedException: 'Verified field photography cleared for Sennar report.',
          usageScope: {
            scopeType: 'ArticleRestricted',
            articleIds: [created.id],
          },
          reviewedByUid: reviewerActor.uid,
          reviewedAtIso: '2026-03-21T10:00:00.000Z',
          reviewReason: 'Approved human rights clearance for Sennar publication.',
        },
      };
      expect(validateEditorialImageAsset(approvedAsset).valid).toBe(true);
      assetRepo.corruptStoredRecordForTesting(canonicalAssetId, {
        assetId: canonicalAssetId,
        revision: 2,
        asset: approvedAsset,
      });

      return service.transitionWorkflow(created.id, 'Published', ownerActor, 'نشر رسمي للجمهور');
    }

    it('allows an active Owner to withdraw a Published article to Draft with a valid reason, preserving all data, image rights, and history while removing it from public news queries', async () => {
      const published = await createAndPublishCanonicalArticle();
      const publicRepo = new PublicNewsRepository(repo, assetRepo);

      // Verify article is initially visible in public news queries and public image delivery
      const publicListBeforeAr = await publicRepo.listPublicNews('ar');
      expect(publicListBeforeAr.map((a) => a.id)).toContain(published.id);
      const publicByIdBefore = await publicRepo.getPublicNewsById(published.id, 'en');
      expect(publicByIdBefore).not.toBeNull();
      const imageDeliveryBefore = await publicRepo.evaluatePublicEditorialImageDelivery(
        published.id,
        canonicalAssetId,
        'article_inline'
      );
      expect(imageDeliveryBefore.eligible).toBe(true);

      // Cannot edit while Published
      await expect(
        service.updateDraft(
          published.id,
          { titleAr: 'محاولة تعديل مباشر أثناء النشر' },
          ownerActor
        )
      ).rejects.toThrow(/INVALID_TRANSITION/);

      // Active Owner withdraws Published -> Draft with a written reason
      const withdrawalReason = '  سحب المقال لتحديث إحصائيات الغطاء الشجري لعام 2026 وتدقيق المصادر  ';
      const withdrawn = await service.transitionWorkflow(
        published.id,
        'Draft',
        ownerActor,
        withdrawalReason
      );

      expect(withdrawn.workflowState).toBe('Draft');
      expect(withdrawn.id).toBe(published.id);
      expect(withdrawn.titleAr).toBe(published.titleAr);
      expect(withdrawn.titleEn).toBe(published.titleEn);
      expect(withdrawn.kickerAr).toBe(published.kickerAr);
      expect(withdrawn.kickerEn).toBe(published.kickerEn);
      expect(withdrawn.journalisticType).toBe(published.journalisticType);
      expect(withdrawn.summaryAr).toBe(published.summaryAr);
      expect(withdrawn.summaryEn).toBe(published.summaryEn);
      expect(withdrawn.bodyAr).toBe(published.bodyAr);
      expect(withdrawn.bodyEn).toBe(published.bodyEn);
      expect(withdrawn.richBodyAr).toEqual(published.richBodyAr);
      expect(withdrawn.richBodyEn).toEqual(published.richBodyEn);
      expect(withdrawn.featuredImage).toBe(canonicalAssetId);
      expect(withdrawn.relatedVideoIds).toEqual(['vid-sennar-01', 'vid-sennar-02']);
      expect(withdrawn.tags).toEqual(['Sennar', 'Forests']);
      expect(withdrawn.sources).toEqual(['Sudan Forestry National Corporation']);
      expect(withdrawn.location).toBe('Sennar State / ولاية سنار');
      expect(withdrawn.urgencyLevel).toBe('Urgent');
      expect(withdrawn.createdAt).toBe(published.createdAt);

      // Existing image rights decision is preserved intact in the canonical asset repository
      const storedAssetAfterWithdrawal = await assetRepo.getById(canonicalAssetId);
      expect(storedAssetAfterWithdrawal.status).toBe('FOUND');
      if (storedAssetAfterWithdrawal.status === 'FOUND') {
        expect(storedAssetAfterWithdrawal.record.asset.rights.status).toBe('Approved');
      }

      // History preserves all previous records and appends the distinct withdraw_for_revision record
      expect(withdrawn.history).toHaveLength(published.history.length + 1);
      expect(withdrawn.history.slice(0, published.history.length)).toEqual(published.history);
      const lastRecord = withdrawn.history[withdrawn.history.length - 1];
      expect(lastRecord.action).toBe('withdraw_for_revision');
      expect(lastRecord.fromState).toBe('Published');
      expect(lastRecord.toState).toBe('Draft');
      expect(lastRecord.actorName).toBe(ownerActor.name);
      expect(lastRecord.actorRole).toBe('Owner');
      expect(lastRecord.comment).toBe(withdrawalReason.trim());

      // Withdrawn article is immediately absent from public news queries and public image delivery
      expect(await publicRepo.listPublicNews('ar')).toEqual([]);
      expect(await publicRepo.listPublicNews('en')).toEqual([]);
      expect(await publicRepo.getPublicNewsById(published.id, 'ar')).toBeNull();
      expect(await publicRepo.getPublicNewsById(published.id, 'en')).toBeNull();
      const imageDeliveryAfter = await publicRepo.evaluatePublicEditorialImageDelivery(
        published.id,
        canonicalAssetId,
        'article_inline'
      );
      expect(imageDeliveryAfter).toEqual({
        eligible: false,
        articleId: published.id,
        assetId: canonicalAssetId,
        variantKey: 'article_inline',
        reason: 'ARTICLE_NOT_PUBLISHED',
      });
    });

    it('rejects non-Owner roles, missing/empty/whitespace/oversized reasons, and repeated or invalid transitions without writing to the repository', async () => {
      const published = await createAndPublishCanonicalArticle();
      const saveSpy = vi.spyOn(repo, 'save');

      // Non-Owner roles are rejected
      for (const nonOwner of [
        editorActor,
        reviewerActor,
        { uid: 'u-rights', name: 'Rights Reviewer', role: 'RightsReviewer' },
        { uid: 'u-tm', name: 'Training Manager', role: 'TrainingManager' },
        { uid: 'u-viewer', name: 'Viewer', role: 'Viewer' },
        { uid: 'u-ai', name: 'AI Assistant', role: 'AIAssistant' },
      ]) {
        await expect(
          service.transitionWorkflow(
            published.id,
            'Draft',
            nonOwner,
            'محاولة سحب من غير المالك'
          )
        ).rejects.toThrow(/PERMISSION_DENIED: Only an active Owner may withdraw a published article to Draft/);
      }

      // Missing, empty, whitespace-only, and oversized (> 2000 chars) reasons are rejected without silent truncation
      for (const invalidReason of [
        undefined,
        '',
        '   \t\n  ',
        'أ'.repeat(MAX_WORKFLOW_COMMENT_LENGTH + 1),
      ]) {
        await expect(
          service.transitionWorkflow(published.id, 'Draft', ownerActor, invalidReason)
        ).rejects.toThrow(/VALIDATION_ERROR/);
      }

      // Invalid transition from Published -> InReview or Published -> Approved is rejected
      await expect(
        service.transitionWorkflow(published.id, 'InReview', ownerActor, 'سبب')
      ).rejects.toThrow(/VALIDATION_ERROR: Unauthorized transition path from 'Published' to 'InReview'/);
      await expect(
        service.transitionWorkflow(published.id, 'Approved', ownerActor, 'سبب')
      ).rejects.toThrow(/VALIDATION_ERROR: Unauthorized transition path from 'Published' to 'Approved'/);

      // Zero writes occurred during all failed attempts
      expect(saveSpy).not.toHaveBeenCalled();
      const persistedStillPublished = await repo.getById(published.id);
      expect(persistedStillPublished?.workflowState).toBe('Published');
      expect(persistedStillPublished?.history).toHaveLength(published.history.length);

      // Now withdraw validly once, then verify repeated withdrawal (Draft -> Draft) is rejected without write
      await service.transitionWorkflow(
        published.id,
        'Draft',
        ownerActor,
        'سحب رسمي للمراجعة التحريرية'
      );
      saveSpy.mockClear();

      await expect(
        service.transitionWorkflow(
          published.id,
          'Draft',
          ownerActor,
          'محاولة سحب مكررة للمسودة'
        )
      ).rejects.toThrow(/VALIDATION_ERROR: Item is already in state 'Draft'/);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('permits editing only after confirmed Draft state, requires the full Draft -> InReview -> Approved -> Published cycle, and re-enforces the image rights gate on re-publication', async () => {
      const published = await createAndPublishCanonicalArticle();

      const withdrawn = await service.transitionWorkflow(
        published.id,
        'Draft',
        ownerActor,
        'سحب لتحديث عنوان التحقيق وإضافة بيانات الرصد الجديدة'
      );
      expect(withdrawn.workflowState).toBe('Draft');

      // Editing succeeds now that the article is in Draft state
      const editedDraft = await service.updateDraft(
        published.id,
        {
          titleAr: 'تحقيق استقصائي محدّث حول الغطاء النباتي في سنار 2026',
          titleEn: 'Updated Investigative Report on Vegetation Cover in Sennar 2026',
        },
        ownerActor
      );
      expect(editedDraft.workflowState).toBe('Draft');
      expect(editedDraft.titleAr).toBe('تحقيق استقصائي محدّث حول الغطاء النباتي في سنار 2026');

      // Direct Draft -> Published jump is forbidden even for Owner
      await expect(
        service.transitionWorkflow(published.id, 'Published', ownerActor, 'محاولة قفز مباشر للنشر')
      ).rejects.toThrow(/VALIDATION_ERROR: Publication forbidden/);

      // Direct Draft -> Approved jump is also forbidden
      await expect(
        service.transitionWorkflow(published.id, 'Approved', ownerActor)
      ).rejects.toThrow(/VALIDATION_ERROR: Unauthorized transition path from 'Draft' to 'Approved'/);

      // Must pass through InReview -> Approved
      const inReviewAgain = await service.transitionWorkflow(
        published.id,
        'InReview',
        editorActor,
        'إعادة تقديم بعد التحديث'
      );
      expect(inReviewAgain.workflowState).toBe('InReview');

      const approvedAgain = await service.transitionWorkflow(
        published.id,
        'Approved',
        reviewerActor,
        'اعتماد النسخة المحدّثة'
      );
      expect(approvedAgain.workflowState).toBe('Approved');

      // Simulate image rights revocation before re-publication: re-publication must be blocked by NEWS-IMG-RIGHTS-PUBLISH-01 gate
      const revokedAsset: EditorialImageAssetMetadata = {
        ...createCanonicalTestAsset(canonicalAssetId),
        updatedAtIso: '2026-03-22T10:00:00.000Z',
        rights: {
          status: 'Revoked',
          licenseType: 'ContextSpecificAssessment',
          rightsHolder: 'Promise of Planet Field Documentation Team',
          sourceAttributionAr: 'فريق التوثيق الميداني في وعد الكوكب',
          sourceAttributionEn: 'Promise of Planet Field Documentation Team',
          evidenceRefs: ['evidence_ref_nile_afforestation_001'],
          documentedException: 'Revoked pending updated release verification.',
          usageScope: {
            scopeType: 'ArticleRestricted',
            articleIds: [published.id],
          },
          reviewedByUid: reviewerActor.uid,
          reviewedAtIso: '2026-03-22T10:00:00.000Z',
          reviewReason: 'Rights temporarily revoked prior to re-publication.',
        },
      };
      assetRepo.corruptStoredRecordForTesting(canonicalAssetId, {
        assetId: canonicalAssetId,
        revision: 3,
        asset: revokedAsset,
      });

      await expect(
        service.transitionWorkflow(published.id, 'Published', ownerActor)
      ).rejects.toThrow(/EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE.*Revoked/);

      // Re-approve image rights and complete re-publication
      const reapprovedAsset: EditorialImageAssetMetadata = {
        ...revokedAsset,
        updatedAtIso: '2026-03-22T11:00:00.000Z',
        rights: {
          ...revokedAsset.rights,
          status: 'Approved',
          reviewedAtIso: '2026-03-22T11:00:00.000Z',
          reviewReason: 'Re-approved human rights clearance for updated Sennar report.',
        },
      };
      assetRepo.corruptStoredRecordForTesting(canonicalAssetId, {
        assetId: canonicalAssetId,
        revision: 4,
        asset: reapprovedAsset,
      });

      const republished = await service.transitionWorkflow(
        published.id,
        'Published',
        ownerActor,
        'إعادة النشر بعد استكمال المراجعة والاعتماد'
      );
      expect(republished.workflowState).toBe('Published');
      expect(republished.history.map((h) => h.action)).toEqual([
        'revise_draft',
        'submit_for_review',
        'approve',
        'publish',
        'withdraw_for_revision',
        'submit_for_review',
        'approve',
        'publish',
      ]);
    });
  });

  describe('7. NEWS-VIDEO-01A — Server-Authoritative Editorial Video Attachment for Drafts', () => {
    it('attaches existing canonical Media Library videos (including Draft/PendingReview videos) to a Draft article, persists relatedVideoIds, reloads via getById, and supports removal on updateDraft', async () => {
      // Seed a canonical video that is not yet publicly playable (Draft / PendingReview / NotStarted rights)
      const draftMediaVideo = createCanonicalTestMediaVideo('vid-blue-nile-draft-03', {
        status: 'Draft',
        approvalStatus: 'PendingReview',
        rightsStatus: 'NotStarted',
      });
      await mediaRepo.createVideo(draftMediaVideo);

      const created = await service.createDraft(
        {
          titleAr: 'تقرير حول الموارد المائية في النيل الأزرق',
          titleEn: 'Report on Water Resources in the Blue Nile',
          summaryAr: 'ملخص التقرير المائي.',
          summaryEn: 'Water report summary.',
          bodyAr: 'نص التقرير بالعربية.',
          bodyEn: 'Report body in English.',
          category: 'Water',
          relatedVideoIds: ['vid-sennar-01', 'vid-blue-nile-draft-03'],
        },
        editorActor
      );

      expect(created.workflowState).toBe('Draft');
      expect(created.relatedVideoIds).toEqual(['vid-sennar-01', 'vid-blue-nile-draft-03']);

      // Reload from repository via getById
      const reloaded = await service.getById(created.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.relatedVideoIds).toEqual(['vid-sennar-01', 'vid-blue-nile-draft-03']);

      // Remove one video and keep the other on updateDraft
      const updated = await service.updateDraft(
        created.id,
        {
          relatedVideoIds: ['vid-blue-nile-draft-03'],
        },
        editorActor
      );
      expect(updated.relatedVideoIds).toEqual(['vid-blue-nile-draft-03']);

      const reloadedAfterRemove = await service.getById(created.id);
      expect(reloadedAfterRemove!.relatedVideoIds).toEqual(['vid-blue-nile-draft-03']);

      // Clear all attached videos
      const cleared = await service.updateDraft(
        created.id,
        {
          relatedVideoIds: [],
        },
        editorActor
      );
      expect(cleared.relatedVideoIds).toEqual([]);
    });

    it('rejects non-array relatedVideoIds, empty/whitespace IDs, arbitrary YouTube URLs, duplicate IDs, nonexistent Media Library video IDs, and > 5 videos on createDraft and updateDraft', async () => {
      for (let i = 1; i <= 6; i++) {
        await mediaRepo.createVideo(createCanonicalTestMediaVideo(`vid-extra-0${i}`));
      }

      const baseDraftInput = {
        titleAr: 'خبر تجريبي للتحقق من الفيديوهات المرتبطة',
        titleEn: 'Test draft for related videos validation',
        summaryAr: 'ملخص',
        summaryEn: 'Summary',
        bodyAr: 'محتوى الخبر',
        bodyEn: 'Article body',
        category: 'Climate',
      };

      // 1. Non-array relatedVideoIds
      await expect(
        service.createDraft(
          {
            ...baseDraftInput,
            relatedVideoIds: 'vid-sennar-01' as unknown as string[],
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RELATED_VIDEO_IDS/);

      // 2. Empty or whitespace video ID
      await expect(
        service.createDraft(
          {
            ...baseDraftInput,
            relatedVideoIds: ['   '],
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RELATED_VIDEO_ID/);

      // 3. Arbitrary YouTube URL instead of canonical video ID
      await expect(
        service.createDraft(
          {
            ...baseDraftInput,
            relatedVideoIds: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RELATED_VIDEO_ID/);

      await expect(
        service.createDraft(
          {
            ...baseDraftInput,
            relatedVideoIds: ['youtu.be/dQw4w9WgXcQ'],
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RELATED_VIDEO_ID/);

      // 4. Duplicate video IDs
      await expect(
        service.createDraft(
          {
            ...baseDraftInput,
            relatedVideoIds: ['vid-sennar-01', 'vid-sennar-01'],
          },
          editorActor
        )
      ).rejects.toThrow(/DUPLICATE_RELATED_VIDEO_ID/);

      // 5. Nonexistent / unresolvable video ID in MediaRepository
      await expect(
        service.createDraft(
          {
            ...baseDraftInput,
            relatedVideoIds: ['vid-sennar-01', 'vid-does-not-exist-999'],
          },
          editorActor
        )
      ).rejects.toThrow(/RELATED_VIDEO_NOT_FOUND.*vid-does-not-exist-999/);

      // 6. More than 5 videos
      await expect(
        service.createDraft(
          {
            ...baseDraftInput,
            relatedVideoIds: [
              'vid-extra-01',
              'vid-extra-02',
              'vid-extra-03',
              'vid-extra-04',
              'vid-extra-05',
              'vid-extra-06',
            ],
          },
          editorActor
        )
      ).rejects.toThrow(/RELATED_VIDEOS_LIMIT_EXCEEDED/);

      // Valid draft creation with 5 videos succeeds
      const validDraft = await service.createDraft(
        {
          ...baseDraftInput,
          relatedVideoIds: [
            'vid-extra-01',
            'vid-extra-02',
            'vid-extra-03',
            'vid-extra-04',
            'vid-extra-05',
          ],
        },
        editorActor
      );
      expect(validDraft.relatedVideoIds).toHaveLength(5);

      // Verify updateDraft also enforces nonexistent ID, URL, duplicate, and > 5 checks without mutating stored record
      await expect(
        service.updateDraft(
          validDraft.id,
          { relatedVideoIds: ['https://youtu.be/abc12345678'] },
          editorActor
        )
      ).rejects.toThrow(/INVALID_RELATED_VIDEO_ID/);

      await expect(
        service.updateDraft(
          validDraft.id,
          { relatedVideoIds: ['vid-missing-id'] },
          editorActor
        )
      ).rejects.toThrow(/RELATED_VIDEO_NOT_FOUND.*vid-missing-id/);

      const unchanged = await service.getById(validDraft.id);
      expect(unchanged!.relatedVideoIds).toEqual([
        'vid-extra-01',
        'vid-extra-02',
        'vid-extra-03',
        'vid-extra-04',
        'vid-extra-05',
      ]);
    });
  });
});

