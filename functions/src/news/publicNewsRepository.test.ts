import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockUiLanguage: 'ar' | 'en' = 'ar';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return mockUiLanguage;
      },
      changeLanguage: async (lang: 'ar' | 'en') => {
        mockUiLanguage = lang;
      },
    },
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

import {
  PublicNewsRepository,
  isEditorialImageAssetEligibleForPublicArticle,
  sanitizePublicRichDocument,
  isPublicDeliveryEditorialImageVariantKey,
  PUBLIC_DELIVERY_EDITORIAL_IMAGE_VARIANT_KEYS,
} from './publicNewsRepository';
import { PublicNewsClient } from '../../../src/services/publicNewsClient';
import { NewsCard } from '../../../src/components/content/NewsCard';
import { HomeNewsPreview } from '../../../src/components/news/HomeNewsPreview';
import {
  PublicNewsHub,
  PublicRichNewsDocumentRenderer,
  getEditorialImageFigureClasses,
  shouldSuppressDuplicateCoverBanner,
} from '../../../src/components/news/PublicNewsHub';
import { InMemoryNewsRepository } from './inMemoryNewsRepository';
import { InMemoryEditorialImageAssetRepository } from './inMemoryEditorialImageAssetRepository';
import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
  validateEditorialImageAsset,
} from '../shared/editorialImageAssetContract';
import { REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS } from './newsApplicationService';
import type { NewsItemBackend } from './newsRepository';
import type {
  EditorialImageAssetMetadata,
  EditorialImageAssetStatus,
  EditorialImageAssetVariant,
  EditorialImageAssetVariantKey,
  EditorialImageRightsRecord,
} from '../types/editorialImageAsset';
import type {
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from '../types/richNewsDocument';

function buildCanonicalVariantsMap(
  assetId: string,
  keys: readonly EditorialImageAssetVariantKey[] = REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS
): Record<string, EditorialImageAssetVariant> {
  const variants: Record<string, EditorialImageAssetVariant> = {};
  for (const key of keys) {
    variants[key] = {
      variantKey: key,
      storagePath: buildEditorialImageVariantStoragePath(
        assetId,
        key,
        'image/webp'
      ),
      mimeType: 'image/webp',
      width: 800,
      height: 600,
      sizeBytes: 24576,
      sha256Checksum: 'a'.repeat(64),
    };
  }
  return variants;
}

function buildPendingReviewAsset(assetId: string): EditorialImageAssetMetadata {
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
    variants: buildCanonicalVariantsMap(assetId),
    altAr: 'صورة ميدانية لغرس الأشجار',
    altEn: 'Field photo of planting trees',
  });
}

function buildApprovedAsset(
  assetId: string,
  rightsOverrides?: Partial<EditorialImageRightsRecord>
): EditorialImageAssetMetadata {
  const base = buildPendingReviewAsset(assetId);
  const approvedRights: EditorialImageRightsRecord = {
    status: 'Approved',
    licenseType: 'OriginalWork',
    rightsHolder: 'Promise of Planet Editorial Team',
    sourceAttributionAr: 'فريق التحرير في وعد الكوكب',
    sourceAttributionEn: 'Promise of Planet Editorial Team',
    evidenceRefs: ['evidence_ref_001'],
    usageScope: {
      scopeType: 'GeneralEditorial',
    },
    reviewedByUid: 'admin-reviewer-01',
    reviewedAtIso: '2026-03-20T11:00:00.000Z',
    reviewReason: 'Verified original field photography.',
    ...rightsOverrides,
  };

  const candidate: EditorialImageAssetMetadata = {
    ...base,
    updatedAtIso: '2026-03-20T11:00:00.000Z',
    rights: approvedRights,
  };

  const check = validateEditorialImageAsset(candidate);
  if (!check.valid) {
    throw new Error(
      `Invalid test approved asset fixture: ${check.errors.join('; ')}`
    );
  }
  return candidate;
}

function buildAssetWithState(
  assetId: string,
  options: {
    readonly status?: EditorialImageAssetStatus;
    readonly rights?: EditorialImageRightsRecord;
    readonly variantKeys?: readonly EditorialImageAssetVariantKey[];
  }
): EditorialImageAssetMetadata {
  const base = buildPendingReviewAsset(assetId);
  const candidate: EditorialImageAssetMetadata = {
    ...base,
    updatedAtIso: '2026-03-20T12:00:00.000Z',
    status: options.status ?? base.status,
    rights: options.rights ?? base.rights,
    variants: options.variantKeys
      ? buildCanonicalVariantsMap(assetId, options.variantKeys)
      : base.variants,
  };

  return candidate;
}

function seedAssetsIntoRepo(
  repo: InMemoryEditorialImageAssetRepository,
  assets: readonly EditorialImageAssetMetadata[]
): void {
  for (const asset of assets) {
    repo.corruptStoredRecordForTesting(asset.assetId, {
      assetId: asset.assetId,
      revision: 1,
      asset,
    });
  }
}

function buildPublishedNewsItem(
  id: string,
  overrides?: Partial<NewsItemBackend>
): NewsItemBackend {
  return {
    id,
    titleAr: 'تقرير مناخي حول السودان',
    titleEn: 'Climate Report on Sudan',
    summaryAr: 'ملخص التقرير المناخي',
    summaryEn: 'Summary of the climate report',
    bodyAr: 'نص التقرير الكامل بالعربية',
    bodyEn: 'Full report body in English',
    author: 'Editorial Desk',
    category: 'Climate',
    tags: ['sudan', 'cop16'],
    sources: ['https://www.unccd.int'],
    featuredImage: 'https://images.unsplash.com/photo-1500000000000',
    location: 'Sudan / السودان',
    urgencyLevel: 'Standard',
    workflowState: 'Published',
    createdAt: '2026-04-15T08:00:00.000Z',
    updatedAt: '2026-04-15T11:00:00.000Z',
    publishedAt: '2026-04-15T12:00:00.000Z',
    history: [],
    relatedVideoIds: ['vid-1'],
    ...overrides,
  };
}

describe('IMG-F3-09/D3-B1: Public News Editorial Image Rights Gate', () => {
  it('1. V1 published article passes through unchanged and deep-cloned', async () => {
    const richV1: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'فقرة نصية أولى' }],
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-v1', { richBodyAr: richV1 }),
    ]);
    // Do not pass assetRepo when no images exist to verify lazy asset repo initialization
    const publicRepo = new PublicNewsRepository(newsRepo);

    const item = await publicRepo.getPublicNewsById('article-v1');
    expect(item).not.toBeNull();
    expect(item?.richBodyAr).toEqual(richV1);
    expect(item?.richBodyAr).not.toBe(richV1);
  });

  it('2. V2 published article with text only passes through unchanged', async () => {
    const richV2TextOnly: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2, dir: 'rtl' },
            content: [{ type: 'text', text: 'عنوان فرعي' }],
          },
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [
              {
                type: 'text',
                text: 'نص مع تنسيق عريض',
                marks: [{ type: 'bold' }],
              },
            ],
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-v2-text', { richBodyAr: richV2TextOnly }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo);

    const list = await publicRepo.listPublicNews();
    expect(list).toHaveLength(1);
    expect(list[0].richBodyAr).toEqual(richV2TextOnly);
  });

  it('3. V2 published article with active + Approved + GeneralEditorial image keeps editorialImage node', async () => {
    const assetId = 'asset_general_approved_01';
    const asset = buildApprovedAsset(assetId);

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'مقدمة التقرير' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'صورة مؤتمر الأطراف',
              altEn: 'COP16 photo',
              captionAr: 'تغطية خاصة من مؤتمر الرياض',
              captionEn: 'Special coverage from Riyadh COP16',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-general', { richBodyAr: richV2 }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [asset]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const result = await publicRepo.getPublicNewsById('article-general');
    expect(result?.richBodyAr).toEqual(richV2);
  });

  it('4. V2 published article with active + Approved + ArticleRestricted image matching articleId keeps editorialImage node', async () => {
    const articleId = 'article-restricted-match';
    const assetId = 'asset_restricted_match_01';
    const asset = buildApprovedAsset(assetId, {
      licenseType: 'ContextSpecificAssessment',
      licenseDetails: 'Cleared specifically for this COP16 article',
      usageScope: {
        scopeType: 'ArticleRestricted',
        articleIds: [articleId, 'other-allowed-article'],
      },
    });

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'صورة مقيدة بالمقال',
              altEn: 'Restricted image',
              captionEn: 'Cleared specifically for this article',
              width: '50%',
              layout: 'float-start',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem(articleId, { richBodyEn: richV2 }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [asset]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById(articleId, 'en');
    expect(dto?.richBodyEn).toEqual(richV2);
  });

  it('5. V2 published article with ArticleRestricted image NOT matching articleId strips editorialImage node', async () => {
    const assetId = 'asset_restricted_mismatch_01';
    const asset = buildApprovedAsset(assetId, {
      licenseType: 'DirectLicense',
      licenseDetails: 'Direct written license for single-article use',
      usageScope: {
        scopeType: 'ArticleRestricted',
        articleIds: ['some-other-article-id'],
      },
    });

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'ltr' },
            content: [{ type: 'text', text: 'Paragraph stays visible' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'صورة خارج النطاق',
              width: '50%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-unauthorized-scope', {
        richBodyEn: richV2,
      }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [asset]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-unauthorized-scope');
    expect(dto?.richBodyEn).toEqual({
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'ltr' },
            content: [{ type: 'text', text: 'Paragraph stays visible' }],
          },
        ],
      },
    });
  });

  it('6. V2 published article with PendingReview rights strips editorialImage node', () => {
    const assetId = 'asset_pending_review_01';
    const asset = buildPendingReviewAsset(assetId);

    expect(
      isEditorialImageAssetEligibleForPublicArticle(asset, 'article-pending')
    ).toBe(false);

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'خبر مناخي' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'صورة قيد المراجعة',
              width: '50%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const sanitized = sanitizePublicRichDocument(
      richV2,
      'article-pending',
      new Map([[assetId, asset]])
    );
    expect(sanitized?.doc.content).toEqual([
      {
        type: 'paragraph',
        attrs: { dir: 'rtl' },
        content: [{ type: 'text', text: 'خبر مناخي' }],
      },
    ]);
  });

  it('7. V2 published article with Rejected rights strips editorialImage node', () => {
    const assetId = 'asset_rejected_01';
    const asset = buildAssetWithState(assetId, {
      rights: {
        status: 'Rejected',
        reviewedByUid: 'admin-reviewer-01',
        reviewedAtIso: '2026-03-20T12:00:00.000Z',
        reviewReason: 'Missing source attribution.',
      },
    });

    expect(
      isEditorialImageAssetEligibleForPublicArticle(asset, 'article-rejected')
    ).toBe(false);

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'صورة مرفوضة',
              width: '50%',
              layout: 'block-center',
            },
          },
          {
            type: 'paragraph',
            attrs: { dir: 'ltr' },
            content: [{ type: 'text', text: 'Keep text' }],
          },
        ],
      },
    };

    const sanitized = sanitizePublicRichDocument(
      richV2,
      'article-rejected',
      new Map([[assetId, asset]])
    );
    expect(sanitized?.doc.content).toEqual([
      {
        type: 'paragraph',
        attrs: { dir: 'ltr' },
        content: [{ type: 'text', text: 'Keep text' }],
      },
    ]);
  });

  it('8. V2 published article with Revoked rights strips editorialImage node', () => {
    const assetId = 'asset_revoked_01';
    const asset = buildAssetWithState(assetId, {
      rights: {
        status: 'Revoked',
        licenseType: 'DirectLicense',
        rightsHolder: 'Agency',
        sourceAttributionAr: 'وكالة',
        sourceAttributionEn: 'Agency',
        evidenceRefs: ['revocation-notice-1'],
        usageScope: { scopeType: 'GeneralEditorial' },
        reviewedByUid: 'admin-reviewer-01',
        reviewedAtIso: '2026-03-20T12:00:00.000Z',
        reviewReason: 'Permission withdrawn by rights holder.',
      },
    });

    expect(
      isEditorialImageAssetEligibleForPublicArticle(asset, 'article-revoked')
    ).toBe(false);

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'صورة مسحوبة',
              width: '50%',
              layout: 'block-center',
            },
          },
          {
            type: 'paragraph',
            attrs: { dir: 'ltr' },
            content: [{ type: 'text', text: 'Remaining text' }],
          },
        ],
      },
    };

    const sanitized = sanitizePublicRichDocument(
      richV2,
      'article-revoked',
      new Map([[assetId, asset]])
    );
    expect(sanitized?.doc.content).toEqual([
      {
        type: 'paragraph',
        attrs: { dir: 'ltr' },
        content: [{ type: 'text', text: 'Remaining text' }],
      },
    ]);
  });

  it('9. V2 published article with missing asset strips editorialImage node', async () => {
    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'ltr' },
            content: [{ type: 'text', text: 'Visible paragraph' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: 'asset_missing_from_repo',
              altAr: 'صورة مفقودة',
              width: '50%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-missing-asset', { richBodyAr: richV2 }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-missing-asset');
    expect(dto?.richBodyAr?.doc.content).toEqual([
      {
        type: 'paragraph',
        attrs: { dir: 'ltr' },
        content: [{ type: 'text', text: 'Visible paragraph' }],
      },
    ]);
  });

  it('10. V2 published article with quarantined or retired asset strips editorialImage node', () => {
    const baseApproved1 = buildApprovedAsset('asset_quarantined_01');
    const quarantinedAsset: EditorialImageAssetMetadata = {
      ...baseApproved1,
      status: 'quarantined',
    };

    const baseApproved2 = buildApprovedAsset('asset_retired_01');
    const retiredAsset: EditorialImageAssetMetadata = {
      ...baseApproved2,
      status: 'retired',
    };

    expect(
      isEditorialImageAssetEligibleForPublicArticle(
        quarantinedAsset,
        'article-status-check'
      )
    ).toBe(false);
    expect(
      isEditorialImageAssetEligibleForPublicArticle(
        retiredAsset,
        'article-status-check'
      )
    ).toBe(false);

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: 'asset_quarantined_01',
              altAr: 'صورة محجوزة',
              width: '50%',
              layout: 'block-center',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: 'asset_retired_01',
              altAr: 'صورة متقاعدة',
              width: '50%',
              layout: 'block-center',
            },
          },
          {
            type: 'paragraph',
            attrs: { dir: 'ltr' },
            content: [{ type: 'text', text: 'Body remains intact' }],
          },
        ],
      },
    };

    const sanitized = sanitizePublicRichDocument(
      richV2,
      'article-status-check',
      new Map([
        ['asset_quarantined_01', quarantinedAsset],
        ['asset_retired_01', retiredAsset],
      ])
    );

    expect(sanitized?.doc.content).toEqual([
      {
        type: 'paragraph',
        attrs: { dir: 'ltr' },
        content: [{ type: 'text', text: 'Body remains intact' }],
      },
    ]);
  });

  it('11. V2 published article with missing or invalid canonical variant strips editorialImage node', () => {
    const assetMissingCover = buildApprovedAsset('asset_missing_cover_01');
    const mutableVariants = { ...assetMissingCover.variants };
    delete mutableVariants.article_cover;
    const assetWithFourVariants: EditorialImageAssetMetadata = {
      ...assetMissingCover,
      variants: mutableVariants,
    };

    const assetInvalidPath = buildApprovedAsset('asset_invalid_path_01');
    const corruptedVariants = {
      ...assetInvalidPath.variants,
      card: {
        ...assetInvalidPath.variants.card!,
        storagePath: 'editorial_images/public/asset_invalid_path_01/card.webp',
      },
    };
    const assetWithCorruptedVariantPath: EditorialImageAssetMetadata = {
      ...assetInvalidPath,
      variants: corruptedVariants,
    };

    expect(
      isEditorialImageAssetEligibleForPublicArticle(
        assetWithFourVariants,
        'article-variants'
      )
    ).toBe(false);
    expect(
      isEditorialImageAssetEligibleForPublicArticle(
        assetWithCorruptedVariantPath,
        'article-variants'
      )
    ).toBe(false);
  });

  it('12. V2 published article with mixed approved + unapproved images keeps only approved node(s) and preserves all text/marks/blocks', async () => {
    const approvedId = 'asset_mixed_approved_01';
    const unapprovedId = 'asset_mixed_unapproved_02';
    const outOfScopeId = 'asset_mixed_out_of_scope_03';

    const approvedAsset = buildApprovedAsset(approvedId);
    const unapprovedAsset = buildPendingReviewAsset(unapprovedId);
    const outOfScopeAsset = buildApprovedAsset(outOfScopeId, {
      licenseType: 'DirectLicense',
      licenseDetails: 'Direct written license for single-article use',
      usageScope: {
        scopeType: 'ArticleRestricted',
        articleIds: ['different-article-id'],
      },
    });

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2, dir: 'rtl' },
            content: [{ type: 'text', text: 'تقرير ميداني' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: unapprovedId,
              altAr: 'صورة غير معتمدة',
              captionAr: 'غير معتمد',
              width: '50%',
              layout: 'float-start',
            },
          },
          {
            type: 'blockquote',
            attrs: { dir: 'rtl' },
            content: [
              {
                type: 'paragraph',
                attrs: { dir: 'rtl' },
                content: [
                  {
                    type: 'text',
                    text: 'اقتباس مهم من المؤتمر',
                    marks: [{ type: 'italic' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: approvedId,
              altAr: 'صورة معتمدة',
              captionAr: 'توثيق ميداني معتمد',
              width: '100%',
              layout: 'block-full',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: outOfScopeId,
              altAr: 'صورة خارج النطاق',
              captionAr: 'خارج النطاق',
              width: '50%',
              layout: 'block-center',
            },
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
                    content: [
                      {
                        type: 'text',
                        text: 'رابط مرجعي',
                        marks: [
                          {
                            type: 'link',
                            attrs: { href: 'https://www.unccd.int' },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-mixed', { richBodyAr: richV2 }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [
      approvedAsset,
      unapprovedAsset,
      outOfScopeAsset,
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-mixed');
    expect(dto?.richBodyAr?.doc.content).toEqual([
      {
        type: 'heading',
        attrs: { level: 2, dir: 'rtl' },
        content: [{ type: 'text', text: 'تقرير ميداني' }],
      },
      {
        type: 'blockquote',
        attrs: { dir: 'rtl' },
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [
              {
                type: 'text',
                text: 'اقتباس مهم من المؤتمر',
                marks: [{ type: 'italic' }],
              },
            ],
          },
        ],
      },
      {
        type: 'editorialImage',
        attrs: {
          assetId: approvedId,
          altAr: 'صورة معتمدة',
          captionAr: 'توثيق ميداني معتمد',
          width: '100%',
          layout: 'block-full',
        },
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
                content: [
                  {
                    type: 'text',
                    text: 'رابط مرجعي',
                    marks: [
                      {
                        type: 'link',
                        attrs: { href: 'https://www.unccd.int' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('13. V2 published article containing ONLY an unapproved image strips the image and replaces empty content with a single valid empty paragraph', async () => {
    const assetId = 'asset_only_unapproved_01';
    const richV2OnlyImage: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'صورة وحيدة غير معتمدة',
              captionEn: 'Unapproved sole block',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-only-image', {
        richBodyAr: richV2OnlyImage,
      }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-only-image');
    expect(dto?.richBodyAr).toEqual({
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { dir: 'rtl' }, content: [] }],
      },
    });
  });

  it('14. Malformed rich document fails closed to undefined without crashing public article retrieval', async () => {
    const malformedDoc = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'unknownUnsupportedNode',
          },
        ],
      },
    } as unknown as RichNewsDocumentWrapperV2;

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-malformed', { richBodyAr: malformedDoc }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-malformed');
    expect(dto).not.toBeNull();
    expect(dto?.id).toBe('article-malformed');
    expect(dto?.bodyAr).toBe('نص التقرير الكامل بالعربية');
    expect(dto?.richBodyAr).toBeUndefined();
  });

  it('15. Deduplicated asset lookup calls assetRepo.getById once per unique assetId across listPublicNews', async () => {
    const sharedAssetId = 'asset_shared_across_articles_01';
    const secondAssetId = 'asset_second_unique_02';

    const sharedAsset = buildApprovedAsset(sharedAssetId);
    const secondAsset = buildApprovedAsset(secondAssetId);

    const docWithShared: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: sharedAssetId,
              altAr: 'صورة مشتركة 1',
              width: '50%',
              layout: 'block-center',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: sharedAssetId,
              altAr: 'صورة مشتركة مكررة',
              width: '50%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const docWithBoth: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: sharedAssetId,
              altAr: 'صورة مشتركة',
              width: '50%',
              layout: 'block-center',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: secondAssetId,
              altAr: 'صورة ثانية',
              width: '50%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-1', {
        richBodyAr: docWithShared,
        richBodyEn: docWithShared,
      }),
      buildPublishedNewsItem('article-2', {
        richBodyAr: docWithBoth,
      }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [sharedAsset, secondAsset]);
    const getByIdSpy = vi.spyOn(assetRepo, 'getById');

    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);
    const list = await publicRepo.listPublicNews();

    expect(list).toHaveLength(2);
    expect(getByIdSpy).toHaveBeenCalledTimes(2);
    expect(getByIdSpy).toHaveBeenCalledWith(sharedAssetId);
    expect(getByIdSpy).toHaveBeenCalledWith(secondAssetId);
  });

  it('16. Asset lookup exception for one asset strips that asset node without failing the article or list', async () => {
    const okAssetId = 'asset_ok_lookup_01';
    const failingAssetId = 'asset_throws_lookup_02';
    const okAsset = buildApprovedAsset(okAssetId);

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [okAsset]);
    const originalGetById = assetRepo.getById.bind(assetRepo);

    vi.spyOn(assetRepo, 'getById').mockImplementation(async (id: string) => {
      if (id === failingAssetId) {
        throw new Error('FIRESTORE_UNAVAILABLE: Simulated transient timeout');
      }
      return originalGetById(id);
    });

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: failingAssetId,
              altAr: 'صورة تفشل قراءتها',
              width: '50%',
              layout: 'block-center',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: okAssetId,
              altAr: 'صورة سليمة',
              width: '50%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-resilient', { richBodyAr: richV2 }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const list = await publicRepo.listPublicNews();
    expect(list).toHaveLength(1);
    expect(list[0].richBodyAr?.doc.content).toEqual([
      {
        type: 'editorialImage',
        attrs: {
          assetId: okAssetId,
          altAr: 'صورة سليمة',
          width: '50%',
          layout: 'block-center',
        },
      },
    ]);
  });

  it('17. Underlying InMemoryNewsRepository stored records are NOT mutated by public sanitization', async () => {
    const unapprovedAssetId = 'asset_unapproved_no_mutate';
    const originalDoc: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'ltr' },
            content: [{ type: 'text', text: 'Original paragraph' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: unapprovedAssetId,
              altAr: 'صورة مسودة',
              captionEn: 'Draft caption',
              width: '50%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-immutability', {
        richBodyAr: originalDoc,
      }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const publicDto = await publicRepo.getPublicNewsById(
      'article-immutability'
    );
    expect(publicDto?.richBodyAr?.doc.content).toHaveLength(1);

    const storedRecord = await newsRepo.getById('article-immutability');
    expect(storedRecord?.richBodyAr?.doc.content).toHaveLength(2);
    expect(storedRecord?.richBodyAr).toEqual(originalDoc);
  });

  it('18. Public delivery eligibility helper allows thumbnail, card, article_inline, article_cover and rejects original_processed, unpublished articles, unreferenced assets, and out-of-scope assets', async () => {
    const approvedAssetId = 'asset_delivery_approved_01';
    const unreferencedAssetId = 'asset_delivery_unreferenced_02';
    const outOfScopeAssetId = 'asset_delivery_out_of_scope_03';

    const approvedAsset = buildApprovedAsset(approvedAssetId);
    const unreferencedAsset = buildApprovedAsset(unreferencedAssetId);
    const outOfScopeAsset = buildApprovedAsset(outOfScopeAssetId, {
      licenseType: 'DirectLicense',
      licenseDetails: 'Direct written license for single-article use',
      usageScope: {
        scopeType: 'ArticleRestricted',
        articleIds: ['other-article'],
      },
    });

    const richDoc: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: approvedAssetId,
              altAr: 'صورة معتمدة للتسليم',
              width: '75%',
              layout: 'block-center',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: outOfScopeAssetId,
              altAr: 'صورة مقيدة بمقال آخر',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const publishedArticle = buildPublishedNewsItem('article-published-1', {
      richBodyAr: richDoc,
    });
    const draftArticle = buildPublishedNewsItem('article-draft-1', {
      workflowState: 'Draft',
      richBodyAr: richDoc,
    });

    const newsRepo = new InMemoryNewsRepository([
      publishedArticle,
      draftArticle,
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [
      approvedAsset,
      unreferencedAsset,
      outOfScopeAsset,
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    expect(PUBLIC_DELIVERY_EDITORIAL_IMAGE_VARIANT_KEYS).toEqual([
      'thumbnail',
      'card',
      'article_inline',
      'article_cover',
    ]);
    expect(isPublicDeliveryEditorialImageVariantKey('original_processed')).toBe(
      false
    );

    for (const allowedVariant of PUBLIC_DELIVERY_EDITORIAL_IMAGE_VARIANT_KEYS) {
      const decision = await publicRepo.evaluatePublicEditorialImageDelivery(
        'article-published-1',
        approvedAssetId,
        allowedVariant
      );
      expect(decision).toEqual({
        eligible: true,
        articleId: 'article-published-1',
        assetId: approvedAssetId,
        variantKey: allowedVariant,
      });
      // Ensure no storagePath or evidenceRefs are leaked on the decision object
      expect(JSON.stringify(decision)).not.toContain(
        'editorial_images/private'
      );
      expect(JSON.stringify(decision)).not.toContain('evidence_ref_001');
    }

    // Explicitly reject original_processed for public delivery
    const originalProcessedDecision =
      await publicRepo.evaluatePublicEditorialImageDelivery(
        'article-published-1',
        approvedAssetId,
        'original_processed'
      );
    expect(originalProcessedDecision).toEqual({
      eligible: false,
      articleId: 'article-published-1',
      assetId: approvedAssetId,
      reason: 'INVALID_VARIANT_KEY',
    });

    // Reject unpublished article
    const draftDecision =
      await publicRepo.evaluatePublicEditorialImageDelivery(
        'article-draft-1',
        approvedAssetId,
        'article_inline'
      );
    expect(draftDecision).toEqual({
      eligible: false,
      articleId: 'article-draft-1',
      assetId: approvedAssetId,
      variantKey: 'article_inline',
      reason: 'ARTICLE_NOT_PUBLISHED',
    });

    // Reject asset not referenced by the article
    const unreferencedDecision =
      await publicRepo.evaluatePublicEditorialImageDelivery(
        'article-published-1',
        unreferencedAssetId,
        'article_inline'
      );
    expect(unreferencedDecision).toEqual({
      eligible: false,
      articleId: 'article-published-1',
      assetId: unreferencedAssetId,
      variantKey: 'article_inline',
      reason: 'ASSET_NOT_REFERENCED_BY_ARTICLE',
    });

    // Reject out-of-scope asset referenced by the article
    const outOfScopeDecision =
      await publicRepo.evaluatePublicEditorialImageDelivery(
        'article-published-1',
        outOfScopeAssetId,
        'article_inline'
      );
    expect(outOfScopeDecision).toEqual({
      eligible: false,
      articleId: 'article-published-1',
      assetId: outOfScopeAssetId,
      variantKey: 'article_inline',
      reason: 'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE',
    });
  });
});

describe('NEWS-IMG-PUBLIC-DELIVERY-01 — Automatic Cover Selection & DTO Resolution', () => {
  it('1. Explicit valid cover takes precedence over inline images', async () => {
    const explicitCoverId = 'asset_explicit_cover_priority_01';
    const inlineImageId = 'asset_inline_body_image_02';

    const explicitCoverAsset = buildApprovedAsset(explicitCoverId);
    const inlineAsset = buildApprovedAsset(inlineImageId);

    const richV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: inlineImageId,
              altAr: 'صورة داخل المتن',
              altEn: 'Inline body image',
              captionAr: 'تسمية الصورة الداخلية',
              captionEn: 'Inline image caption',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-explicit-cover', {
        featuredImage: explicitCoverId,
        richBodyAr: richV2,
      }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [explicitCoverAsset, inlineAsset]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-explicit-cover');
    expect(dto?.featuredImage).toBe(explicitCoverId);
    expect(dto?.coverImage).toEqual({
      assetId: explicitCoverId,
      source: 'explicit',
      altAr: explicitCoverAsset.altAr,
      altEn: explicitCoverAsset.altEn,
    });

    // Delivery evaluation also authorizes the explicit cover assetId
    const deliveryDecision =
      await publicRepo.evaluatePublicEditorialImageDelivery(
        'article-explicit-cover',
        explicitCoverId,
        'article_cover'
      );
    expect(deliveryDecision.eligible).toBe(true);
  });

  it('2. Missing explicit cover selects first eligible Arabic inline image', async () => {
    const firstArId = 'asset_first_ar_inline_01';
    const secondArId = 'asset_second_ar_inline_02';
    const firstEnId = 'asset_first_en_inline_03';

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [
      buildApprovedAsset(firstArId),
      buildApprovedAsset(secondArId),
      buildApprovedAsset(firstEnId),
    ]);

    const richAr: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'الفقرة الافتتاحية' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: firstArId,
              altAr: 'الصورة العربية الأولى',
              altEn: 'First Arabic inline image',
              captionAr: 'توثيق أول من الخرطوم',
              captionEn: 'First documentation from Khartoum',
              width: '100%',
              layout: 'block-full',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: secondArId,
              altAr: 'الصورة العربية الثانية',
              width: '50%',
              layout: 'float-start',
            },
          },
        ],
      },
    };

    const richEn: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: firstEnId,
              altAr: 'صورة النسخة الإنجليزية',
              altEn: 'English version inline image',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-derived-ar', {
        featuredImage: undefined,
        richBodyAr: richAr,
        richBodyEn: richEn,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-derived-ar');
    expect(dto?.featuredImage).toBe(firstArId);
    expect(dto?.coverImage).toEqual({
      assetId: firstArId,
      source: 'derived_first_inline',
      sourceLocale: 'ar',
      altAr: 'الصورة العربية الأولى',
      altEn: 'First Arabic inline image',
      captionAr: 'توثيق أول من الخرطوم',
      captionEn: 'First documentation from Khartoum',
    });
  });

  it('3. Missing Arabic inline images selects first eligible English inline image', async () => {
    const firstEnId = 'asset_first_en_only_01';
    const secondEnId = 'asset_second_en_only_02';

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [
      buildApprovedAsset(firstEnId),
      buildApprovedAsset(secondEnId),
    ]);

    const richArTextOnly: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'نص عربي بدون صور مدمجة' }],
          },
        ],
      },
    };

    const richEnWithImages: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: firstEnId,
              altAr: 'صورة التقرير الإنجليزي الأولى',
              altEn: 'First English report image',
              captionEn: 'Blue Nile monitoring station',
              width: '75%',
              layout: 'block-center',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: secondEnId,
              altAr: 'صورة التقرير الإنجليزي الثانية',
              altEn: 'Second English report image',
              width: '50%',
              layout: 'float-end',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-derived-en', {
        featuredImage: undefined,
        richBodyAr: richArTextOnly,
        richBodyEn: richEnWithImages,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-derived-en');
    expect(dto?.featuredImage).toBe(firstEnId);
    expect(dto?.coverImage).toEqual({
      assetId: firstEnId,
      source: 'derived_first_inline',
      sourceLocale: 'en',
      altAr: 'صورة التقرير الإنجليزي الأولى',
      altEn: 'First English report image',
      captionEn: 'Blue Nile monitoring station',
    });
  });

  it('4. Ineligible first inline image is not used as cover and does not skip to a later image', async () => {
    const firstIneligibleId = 'asset_first_ineligible_revoked_01';
    const secondEligibleId = 'asset_second_eligible_approved_02';

    const revokedAsset = buildAssetWithState(firstIneligibleId, {
      rights: {
        status: 'Revoked',
        licenseType: 'DirectLicense',
        rightsHolder: 'Agency',
        sourceAttributionAr: 'وكالة',
        sourceAttributionEn: 'Agency',
        evidenceRefs: ['revoked-1'],
        usageScope: { scopeType: 'GeneralEditorial' },
        reviewedByUid: 'admin-1',
        reviewedAtIso: '2026-04-10T10:00:00.000Z',
        reviewReason: 'Withdrawn rights.',
      },
    });
    const secondApprovedAsset = buildApprovedAsset(secondEligibleId);

    const richAr: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: firstIneligibleId,
              altAr: 'صورة أولى مسحوبة الحقوق',
              width: '100%',
              layout: 'block-full',
            },
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: secondEligibleId,
              altAr: 'صورة ثانية معتمدة',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-ineligible-first', {
        featuredImage: undefined,
        richBodyAr: richAr,
      }),
    ]);
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [revokedAsset, secondApprovedAsset]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-ineligible-first');
    // Cover must NOT be derived from the ineligible first image and must NOT skip to the second image
    expect(dto?.featuredImage).toBeUndefined();
    expect(dto?.coverImage).toBeUndefined();
    // Meanwhile, the second eligible inline image remains in the sanitized rich body
    expect(dto?.richBodyAr?.doc.content).toEqual([
      {
        type: 'editorialImage',
        attrs: {
          assetId: secondEligibleId,
          altAr: 'صورة ثانية معتمدة',
          width: '75%',
          layout: 'block-center',
        },
      },
    ]);
  });

  it('5. Article without images returns no cover cleanly', async () => {
    const richV2TextOnly: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'تقرير نصي فقط بدون أي صور' }],
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-no-images', {
        featuredImage: undefined,
        richBodyAr: richV2TextOnly,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo);

    const dto = await publicRepo.getPublicNewsById('article-no-images');
    expect(dto?.featuredImage).toBeUndefined();
    expect(dto?.coverImage).toBeUndefined();
  });

  it('6. Mixed eligible/ineligible inline images preserve only eligible inline nodes', async () => {
    const eligibleFirstId = 'asset_mixed_cover_first_ok_01';
    const ineligibleSecondId = 'asset_mixed_cover_second_pending_02';

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [
      buildApprovedAsset(eligibleFirstId),
      buildPendingReviewAsset(ineligibleSecondId),
    ]);

    const richAr: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: eligibleFirstId,
              altAr: 'صورة أولى معتمدة',
              width: '50%',
              layout: 'float-start',
            },
          },
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'فقرة وسطى' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: ineligibleSecondId,
              altAr: 'صورة ثانية قيد المراجعة',
              width: '50%',
              layout: 'float-end',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-mixed-cover', {
        featuredImage: undefined,
        richBodyAr: richAr,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-mixed-cover');
    expect(dto?.featuredImage).toBe(eligibleFirstId);
    expect(dto?.coverImage?.source).toBe('derived_first_inline');
    expect(dto?.richBodyAr?.doc.content).toHaveLength(2);
    expect(dto?.richBodyAr?.doc.content[0]).toEqual({
      type: 'editorialImage',
      attrs: {
        assetId: eligibleFirstId,
        altAr: 'صورة أولى معتمدة',
        width: '50%',
        layout: 'float-start',
      },
    });
  });

  it('7. V1 and plain-text articles remain unaffected', async () => {
    const richV1: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'مقال بصيغة النسخة الأولى' }],
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-v1-no-cover', {
        featuredImage: undefined,
        richBodyAr: richV1,
      }),
      buildPublishedNewsItem('article-plain-legacy-cover', {
        featuredImage: 'https://images.unsplash.com/photo-1500000000000',
        richBodyAr: undefined,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo);

    const v1Dto = await publicRepo.getPublicNewsById('article-v1-no-cover');
    expect(v1Dto?.featuredImage).toBeUndefined();
    expect(v1Dto?.coverImage).toBeUndefined();
    expect(v1Dto?.richBodyAr).toEqual(richV1);

    const plainDto = await publicRepo.getPublicNewsById(
      'article-plain-legacy-cover'
    );
    expect(plainDto?.featuredImage).toBe(
      'https://images.unsplash.com/photo-1500000000000'
    );
    expect(plainDto?.coverImage?.source).toBe('explicit');
    expect(plainDto?.richBodyAr).toBeUndefined();
  });

  it('8. Underlying repository records are not mutated during cover derivation and sanitization', async () => {
    const firstId = 'asset_immutable_derived_01';
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [buildApprovedAsset(firstId)]);

    const richAr: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: firstId,
              altAr: 'صورة الأصل',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-immutable-check', {
        featuredImage: undefined,
        richBodyAr: richAr,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

    const dto = await publicRepo.getPublicNewsById('article-immutable-check');
    expect(dto?.featuredImage).toBe(firstId);

    const storedAfter = await newsRepo.getById('article-immutable-check');
    expect(storedAfter?.featuredImage).toBeUndefined();
    expect(storedAfter?.richBodyAr).toEqual(richAr);
  });
});

describe('NEWS-IMG-PUBLIC-DELIVERY-01 — Frontend Rich V2 Rendering, Cards & Duplicate Cover Prevention', () => {
  const TEST_DELIVERY_ENDPOINT =
    'https://us-central1-promise-of-planet.cloudfunctions.net/publicEditorialImageDeliveryEndpoint';

  beforeEach(() => {
    mockUiLanguage = 'ar';
    PublicNewsClient.setPublicImageDeliveryEndpointUrl(TEST_DELIVERY_ENDPOINT);
  });

  afterEach(() => {
    PublicNewsClient.setPublicImageDeliveryEndpointUrl(undefined);
    PublicNewsClient.setTransport(null);
  });

  it('1. Rich News Document V2 article renders text blocks, marks, and approved editorialImage nodes in order', () => {
    const asset1 = 'asset_render_order_01';
    const asset2 = 'asset_render_order_02';

    const docV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2, dir: 'rtl' },
            content: [{ type: 'text', text: 'عنوان رئيسي أول' }],
          },
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [
              {
                type: 'text',
                text: 'فقرة تمهيدية عريضة ',
                marks: [{ type: 'bold' }],
              },
              {
                type: 'text',
                text: 'ورابط رسمي',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'https://www.unep.org' },
                  },
                ],
              },
            ],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: asset1,
              altAr: 'صورة الترتيب الأولى',
              altEn: 'First ordered image',
              captionAr: 'وصف الصورة الأولى',
              captionEn: 'First image caption',
              width: '75%',
              layout: 'block-center',
            },
          },
          {
            type: 'blockquote',
            attrs: { dir: 'rtl' },
            content: [
              {
                type: 'paragraph',
                attrs: { dir: 'rtl' },
                content: [
                  {
                    type: 'text',
                    text: 'اقتباس ميداني موثق',
                    marks: [{ type: 'italic' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: asset2,
              altAr: 'صورة الترتيب الثانية',
              altEn: 'Second ordered image',
              captionAr: 'وصف الصورة الثانية',
              captionEn: 'Second image caption',
              width: '50%',
              layout: 'float-start',
            },
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
                    content: [{ type: 'text', text: 'عنصر قائمة ختامي' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(PublicRichNewsDocumentRenderer, {
        articleId: 'article-order-1',
        document: docV2,
        isAr: true,
        defaultDir: 'rtl',
      })
    );

    const h2Idx = html.indexOf('عنوان رئيسي أول');
    const pIdx = html.indexOf('فقرة تمهيدية عريضة');
    const linkIdx = html.indexOf('href="https://www.unep.org"');
    const img1Idx = html.indexOf(
      `articleId=article-order-1&amp;assetId=${asset1}&amp;variant=article_inline`
    );
    const bqIdx = html.indexOf('اقتباس ميداني موثق');
    const img2Idx = html.indexOf(
      `articleId=article-order-1&amp;assetId=${asset2}&amp;variant=article_inline`
    );
    const liIdx = html.indexOf('عنصر قائمة ختامي');

    expect(h2Idx).toBeGreaterThan(-1);
    expect(pIdx).toBeGreaterThan(h2Idx);
    expect(linkIdx).toBeGreaterThan(pIdx);
    expect(img1Idx).toBeGreaterThan(linkIdx);
    expect(bqIdx).toBeGreaterThan(img1Idx);
    expect(img2Idx).toBeGreaterThan(bqIdx);
    expect(liIdx).toBeGreaterThan(img2Idx);
  });

  it('2. Localized alt and caption render correctly in Arabic and English', () => {
    const assetId = 'asset_localized_alt_caption_01';
    const docV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'نص بديل بالعربية',
              altEn: 'English alternative text',
              captionAr: 'تعليق الصورة بالعربية',
              captionEn: 'English photo caption',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const arHtml = renderToStaticMarkup(
      React.createElement(PublicRichNewsDocumentRenderer, {
        articleId: 'article-loc-1',
        document: docV2,
        isAr: true,
        defaultDir: 'rtl',
      })
    );
    expect(arHtml).toContain('alt="نص بديل بالعربية"');
    expect(arHtml).toContain('تعليق الصورة بالعربية');
    expect(arHtml).not.toContain('English photo caption');

    const enHtml = renderToStaticMarkup(
      React.createElement(PublicRichNewsDocumentRenderer, {
        articleId: 'article-loc-1',
        document: docV2,
        isAr: false,
        defaultDir: 'ltr',
      })
    );
    expect(enHtml).toContain('alt="English alternative text"');
    expect(enHtml).toContain('English photo caption');
    expect(enHtml).not.toContain('تعليق الصورة بالعربية');
  });

  it('3. Image width and layout classes render with mobile-safe responsive behavior', () => {
    const floatStartRtl = getEditorialImageFigureClasses(
      '50%',
      'float-start',
      'rtl'
    );
    expect(floatStartRtl).toContain('w-full');
    expect(floatStartRtl).toContain('sm:w-1/2');
    expect(floatStartRtl).toContain('max-w-full');
    expect(floatStartRtl).toContain('md:float-right');

    const floatEndLtr = getEditorialImageFigureClasses(
      '25%',
      'float-end',
      'ltr'
    );
    expect(floatEndLtr).toContain('w-full');
    expect(floatEndLtr).toContain('md:w-1/4');
    expect(floatEndLtr).toContain('md:float-right');

    const blockCenter75 = getEditorialImageFigureClasses(
      '75%',
      'block-center',
      'rtl'
    );
    expect(blockCenter75).toContain('w-full');
    expect(blockCenter75).toContain('md:w-3/4');
    expect(blockCenter75).toContain('mx-auto');
    expect(blockCenter75).toContain('clear-both');

    const blockFull = getEditorialImageFigureClasses(
      '100%',
      'block-full',
      'rtl'
    );
    expect(blockFull).toContain('w-full');
    expect(blockFull).toContain('max-w-full');
    expect(blockFull).toContain('clear-both');
  });

  it('4. Explicit cover renders in article view and cards', async () => {
    const explicitAssetId = 'asset_explicit_cover_view_01';
    const inlineAssetId = 'asset_inline_view_02';

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [
      buildApprovedAsset(explicitAssetId),
      buildApprovedAsset(inlineAssetId),
    ]);

    const richAr: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'محتوى المقال مع صورة غلاف صريحة' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: inlineAssetId,
              altAr: 'صورة داخلية',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-explicit-ui', {
        featuredImage: explicitAssetId,
        richBodyAr: richAr,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);
    const dto = await publicRepo.getPublicNewsById('article-explicit-ui');
    expect(dto).not.toBeNull();

    const publicArticle = PublicNewsClient.toPublicNewsArticle(dto!);

    // Card renders explicit cover using variant=card
    const cardHtml = renderToStaticMarkup(
      React.createElement(NewsCard, {
        news: publicArticle,
        currentLanguage: 'ar',
      })
    );
    expect(cardHtml).toContain(
      `articleId=article-explicit-ui&amp;assetId=${explicitAssetId}&amp;variant=card`
    );

    // Full article reader renders BOTH the explicit cover banner (variant=article_cover) AND the inline image (variant=article_inline)
    const hubReaderHtml = renderToStaticMarkup(
      React.createElement(PublicNewsHub, {
        initialArticles: [publicArticle],
        initialArticleIdOrSlug: 'article-explicit-ui',
      })
    );
    expect(hubReaderHtml).toContain('data-article-cover="explicit"');
    expect(hubReaderHtml).toContain(
      `articleId=article-explicit-ui&amp;assetId=${explicitAssetId}&amp;variant=article_cover`
    );
    expect(hubReaderHtml).toContain(
      `articleId=article-explicit-ui&amp;assetId=${inlineAssetId}&amp;variant=article_inline`
    );
  });

  it('5. Automatically derived cover renders in cards without duplicating the cover block above the first inline image in full article view', async () => {
    const derivedAssetId = 'asset_derived_first_inline_ui_01';

    const assetRepo = new InMemoryEditorialImageAssetRepository();
    seedAssetsIntoRepo(assetRepo, [buildApprovedAsset(derivedAssetId)]);

    const richAr: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'الفقرة الأولى من التحقيق' }],
          },
          {
            type: 'editorialImage',
            attrs: {
              assetId: derivedAssetId,
              altAr: 'صورة مشتقة كغلاف تلقائي',
              captionAr: 'تظهر كغلاف في البطاقات وداخل المتن مرة واحدة في القارئ',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-derived-ui', {
        featuredImage: undefined,
        richBodyAr: richAr,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);
    const dto = await publicRepo.getPublicNewsById('article-derived-ui');
    const publicArticle = PublicNewsClient.toPublicNewsArticle(dto!);

    expect(publicArticle.coverImage?.source).toBe('derived_first_inline');
    expect(
      shouldSuppressDuplicateCoverBanner(
        publicArticle,
        publicArticle.richBodyAr!
      )
    ).toBe(true);

    // 1. NewsCard uses the derived cover (variant=card)
    const cardHtml = renderToStaticMarkup(
      React.createElement(NewsCard, {
        news: publicArticle,
        currentLanguage: 'ar',
      })
    );
    expect(cardHtml).toContain(
      `articleId=article-derived-ui&amp;assetId=${derivedAssetId}&amp;variant=card`
    );

    // 2. Hub catalog view Featured Coverage hero card uses the derived cover
    const hubCatalogHtml = renderToStaticMarkup(
      React.createElement(PublicNewsHub, {
        initialArticles: [publicArticle],
      })
    );
    expect(hubCatalogHtml).toContain(
      `articleId=article-derived-ui&amp;assetId=${derivedAssetId}&amp;variant=article_cover`
    );

    // 3. Full article reader suppresses the top duplicate cover banner and renders the image ONCE inline
    const hubReaderHtml = renderToStaticMarkup(
      React.createElement(PublicNewsHub, {
        initialArticles: [publicArticle],
        initialArticleIdOrSlug: 'article-derived-ui',
      })
    );
    expect(hubReaderHtml).not.toContain('data-article-cover="explicit"');
    expect(hubReaderHtml).not.toContain('variant=article_cover');
    const inlineMatches =
      hubReaderHtml.match(new RegExp(derivedAssetId, 'g')) || [];
    // Appears in data-editorial-asset-id and img src of the single inline figure
    expect(hubReaderHtml).toContain(
      `articleId=article-derived-ui&amp;assetId=${derivedAssetId}&amp;variant=article_inline`
    );
    expect(inlineMatches.length).toBe(2);
  });

  it('6. Article with no images renders cleanly in full view, cards, and homepage preview without broken image tags', async () => {
    const richArNoImages: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'مقال تحليلي بدون صور مرفقة' }],
          },
        ],
      },
    };

    const newsRepo = new InMemoryNewsRepository([
      buildPublishedNewsItem('article-clean-no-images', {
        featuredImage: undefined,
        richBodyAr: richArNoImages,
      }),
    ]);
    const publicRepo = new PublicNewsRepository(newsRepo);
    const dto = await publicRepo.getPublicNewsById('article-clean-no-images');
    const publicArticle = PublicNewsClient.toPublicNewsArticle(dto!);

    expect(publicArticle.featuredImage).toBeUndefined();
    expect(publicArticle.coverImage).toBeUndefined();

    const cardHtml = renderToStaticMarkup(
      React.createElement(NewsCard, {
        news: publicArticle,
        currentLanguage: 'ar',
      })
    );
    expect(cardHtml).not.toContain('<img');
    expect(cardHtml).toContain('تقرير مناخي حول السودان');

    const hubCatalogHtml = renderToStaticMarkup(
      React.createElement(PublicNewsHub, {
        initialArticles: [publicArticle],
      })
    );
    expect(hubCatalogHtml).not.toContain('<img');

    const hubReaderHtml = renderToStaticMarkup(
      React.createElement(PublicNewsHub, {
        initialArticles: [publicArticle],
        initialArticleIdOrSlug: 'article-clean-no-images',
      })
    );
    expect(hubReaderHtml).not.toContain('<img');
    expect(hubReaderHtml).toContain('مقال تحليلي بدون صور مرفقة');

    const homePreviewHtml = renderToStaticMarkup(
      React.createElement(HomeNewsPreview, {
        currentLanguage: 'ar',
      })
    );
    expect(homePreviewHtml).not.toContain('<img');
  });

  it('7. Image load error or unconfigured endpoint falls back cleanly without breaking the article or card', () => {
    const assetId = 'asset_error_fallback_01';
    const docV2: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId,
              altAr: 'صورة تعذر تحميلها',
              captionAr: 'يبقى التعليق واضحاً عند فشل التحميل',
              width: '75%',
              layout: 'block-center',
            },
          },
        ],
      },
    };

    const failedHtml = renderToStaticMarkup(
      React.createElement(PublicRichNewsDocumentRenderer, {
        articleId: 'article-img-err',
        document: docV2,
        isAr: true,
        defaultDir: 'rtl',
        failedAssetIds: new Set([assetId]),
      })
    );

    expect(failedHtml).not.toContain('<img');
    expect(failedHtml).toContain('تعذر تحميل الصورة التحريرية المعتمدة');
    expect(failedHtml).toContain('يبقى التعليق واضحاً عند فشل التحميل');

    // When public delivery endpoint is unconfigured, raw assetId is never rendered as <img src="asset_...">
    PublicNewsClient.setPublicImageDeliveryEndpointUrl(null);
    const articleWhenUnconfigured = PublicNewsClient.toPublicNewsArticle({
      id: 'article-unconfigured',
      titleAr: 'عنوان المقال',
      titleEn: 'Article Title',
      summaryAr: 'ملخص',
      summaryEn: 'Summary',
      bodyAr: 'متن',
      bodyEn: 'Body',
      author: 'Editor',
      category: 'Climate',
      tags: [],
      sources: [],
      featuredImage: assetId,
      urgencyLevel: 'Standard',
      publishedAt: '2026-04-15T12:00:00.000Z',
      createdAt: '2026-04-15T08:00:00.000Z',
    });

    expect(articleWhenUnconfigured.featuredImage).toBeUndefined();
    const cardUnconfiguredHtml = renderToStaticMarkup(
      React.createElement(NewsCard, {
        news: articleWhenUnconfigured,
        currentLanguage: 'ar',
      })
    );
    expect(cardUnconfiguredHtml).not.toContain('<img');
  });

  it('8. V1 and plain-text articles still render correctly in PublicNewsHub', () => {
    const richV1: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 3, dir: 'rtl' },
            content: [{ type: 'text', text: 'عنوان فرعي في النسخة الأولى' }],
          },
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [
              {
                type: 'text',
                text: 'فقرة نصية من النسخة الأولى للمستندات الغنية.',
              },
            ],
          },
        ],
      },
    };

    const v1Article = PublicNewsClient.toPublicNewsArticle({
      id: 'article-v1-render',
      titleAr: 'مقال النسخة الأولى',
      titleEn: 'V1 Article',
      summaryAr: 'ملخص',
      summaryEn: 'Summary',
      bodyAr: 'نص احتياطي',
      bodyEn: 'Fallback body',
      richBodyAr: richV1,
      author: 'Editor',
      category: 'Climate',
      tags: ['v1'],
      sources: ['https://www.un.org'],
      urgencyLevel: 'Standard',
      publishedAt: '2026-04-15T12:00:00.000Z',
      createdAt: '2026-04-15T08:00:00.000Z',
    });

    const v1Html = renderToStaticMarkup(
      React.createElement(PublicNewsHub, {
        initialArticles: [v1Article],
        initialArticleIdOrSlug: 'article-v1-render',
      })
    );
    expect(v1Html).toContain('عنوان فرعي في النسخة الأولى');
    expect(v1Html).toContain('فقرة نصية من النسخة الأولى للمستندات الغنية.');

    const plainArticle = PublicNewsClient.toPublicNewsArticle({
      id: 'article-plain-render',
      titleAr: 'مقال نصي تقليدي',
      titleEn: 'Plain Text Article',
      summaryAr: 'ملخص نصي',
      summaryEn: 'Plain summary',
      bodyAr: 'الفقرة النصية الأولى.\n\nالفقرة النصية الثانية.',
      bodyEn: 'First plain paragraph.\n\nSecond plain paragraph.',
      author: 'Editor',
      category: 'Climate',
      tags: [],
      sources: [],
      urgencyLevel: 'Standard',
      publishedAt: '2026-04-15T12:00:00.000Z',
      createdAt: '2026-04-15T08:00:00.000Z',
    });

    const plainHtml = renderToStaticMarkup(
      React.createElement(PublicNewsHub, {
        initialArticles: [plainArticle],
        initialArticleIdOrSlug: 'article-plain-render',
      })
    );
    expect(plainHtml).toContain('الفقرة النصية الأولى.');
    expect(plainHtml).toContain('الفقرة النصية الثانية.');
  });
});

