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
import { NewsApplicationService, type ActorContext } from './newsApplicationService';

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

describe('IMG-F3-09/D1-A — V1/V2 Rich News Validation & Plain-Text Compatibility', () => {
  let repo: InMemoryTestNewsRepository;
  let assetRepo: InMemoryEditorialImageAssetRepository;
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
    await assetRepo.createIfAbsent(
      createCanonicalTestAsset('asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c')
    );
    await assetRepo.createIfAbsent(
      createCanonicalTestAsset('asset_abcdef0123456789abcdef0123456789')
    );
    service = new NewsApplicationService(repo, assetRepo);
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
});
