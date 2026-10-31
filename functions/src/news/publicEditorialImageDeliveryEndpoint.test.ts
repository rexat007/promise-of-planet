import { Buffer } from 'node:buffer';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

import { computeSha256Hex } from './editorialBinaryInspector';
import { InMemoryEditorialBinaryStorageAdapter } from './editorialBinaryIntakeService';
import { InMemoryEditorialImageAssetRepository } from './inMemoryEditorialImageAssetRepository';
import { InMemoryNewsRepository } from './inMemoryNewsRepository';
import { REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS } from './newsApplicationService';
import type { NewsItemBackend } from './newsRepository';
import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
  validateEditorialImageAsset,
} from '../shared/editorialImageAssetContract';
import {
  executePublicEditorialImageDeliveryEndpoint,
  PUBLIC_DELIVERY_ALLOWED_VARIANTS,
  type PublicEditorialImageDeliveryHttpResponseWriter,
} from './publicEditorialImageDeliveryEndpoint';
import type {
  EditorialImageAssetMetadata,
  EditorialImageAssetStatus,
  EditorialImageAssetVariant,
  EditorialImageAssetVariantKey,
  EditorialImageRightsRecord,
} from '../types/editorialImageAsset';
import type { RichNewsDocumentWrapperV2 } from '../types/richNewsDocument';

interface MockResponseState {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  binaryBuffer: Buffer | null;
}

function createMockResponseWriter(): {
  writer: PublicEditorialImageDeliveryHttpResponseWriter;
  state: MockResponseState;
} {
  const state: MockResponseState = {
    statusCode: 200,
    headers: {},
    body: null,
    binaryBuffer: null,
  };

  const writer: PublicEditorialImageDeliveryHttpResponseWriter = {
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

describe('NEWS-IMG-PUBLIC-DELIVERY-01 — Public Editorial Image Delivery Endpoint', () => {
  const PUBLISHED_ARTICLE_ID = 'article_published_cop16';
  const OTHER_PUBLISHED_ARTICLE_ID = 'article_other_published';
  const DRAFT_ARTICLE_ID = 'article_draft_01';
  const WITHDRAWN_ARTICLE_ID = 'article_withdrawn_to_draft';

  const APPROVED_ASSET_ID = 'asset_public_approved_01';
  const EXPLICIT_COVER_ASSET_ID = 'asset_explicit_cover_02';
  const UNREFERENCED_ASSET_ID = 'asset_unreferenced_03';
  const RESTRICTED_ASSET_ID = 'asset_restricted_scope_04';

  let sampleWebpBytes: Buffer;
  let sampleWebpSha256: string;

  beforeAll(async () => {
    sampleWebpBytes = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: { r: 16, g: 120, b: 88 },
      },
    })
      .webp({ quality: 82 })
      .toBuffer();
    sampleWebpSha256 = computeSha256Hex(sampleWebpBytes);
  });

  function buildCanonicalVariantsForBytes(
    assetId: string,
    bytes: Buffer = sampleWebpBytes,
    sha256: string = sampleWebpSha256
  ): Record<string, EditorialImageAssetVariant> {
    const variants: Record<string, EditorialImageAssetVariant> = {};
    for (const key of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
      variants[key] = {
        variantKey: key,
        storagePath: buildEditorialImageVariantStoragePath(
          assetId,
          key,
          'image/webp'
        ),
        mimeType: 'image/webp',
        width: 640,
        height: 360,
        sizeBytes: bytes.length,
        sha256Checksum: sha256,
      };
    }
    return variants;
  }

  function buildApprovedAsset(
    assetId: string,
    rightsOverrides?: Partial<EditorialImageRightsRecord>,
    status: EditorialImageAssetStatus = 'active'
  ): EditorialImageAssetMetadata {
    const base = createEditorialImageAssetRecord({
      assetId,
      createdByUid: 'admin-editor-01',
      createdAtIso: '2026-04-10T10:00:00.000Z',
      updatedAtIso: '2026-04-10T10:00:00.000Z',
      origin: 'news_article',
      originalFilename: `${assetId}.webp`,
      mimeType: 'image/webp',
      originalSizeBytes: sampleWebpBytes.length,
      originalWidth: 1280,
      originalHeight: 720,
      sha256Checksum: sampleWebpSha256,
      variants: buildCanonicalVariantsForBytes(assetId),
      altAr: 'صورة ميدانية معتمدة من السودان',
      altEn: 'Approved field photo from Sudan',
    });

    const approvedRights: EditorialImageRightsRecord = {
      status: 'Approved',
      licenseType: 'OriginalWork',
      rightsHolder: 'Promise of Planet Editorial Desk',
      sourceAttributionAr: 'فريق التحرير في وعد الكوكب',
      sourceAttributionEn: 'Promise of Planet Editorial Desk',
      evidenceRefs: ['evidence_ref_999'],
      usageScope: {
        scopeType: 'GeneralEditorial',
      },
      reviewedByUid: 'admin-owner-01',
      reviewedAtIso: '2026-04-10T11:00:00.000Z',
      reviewReason: 'Cleared for public editorial delivery.',
      ...rightsOverrides,
    };

    const candidate: EditorialImageAssetMetadata = {
      ...base,
      status,
      updatedAtIso: '2026-04-10T11:00:00.000Z',
      rights: approvedRights,
    };

    if (status === 'active' && approvedRights.status === 'Approved') {
      const check = validateEditorialImageAsset(candidate);
      if (!check.valid) {
        throw new Error(
          `Invalid approved asset fixture: ${check.errors.join('; ')}`
        );
      }
    }

    return candidate;
  }

  async function seedAssetAndBinaries(
    assetRepo: InMemoryEditorialImageAssetRepository,
    storageAdapter: InMemoryEditorialBinaryStorageAdapter,
    asset: EditorialImageAssetMetadata,
    bytes: Buffer = sampleWebpBytes,
    sha256: string = sampleWebpSha256
  ): Promise<void> {
    assetRepo.corruptStoredRecordForTesting(asset.assetId, {
      assetId: asset.assetId,
      revision: 1,
      asset,
    });

    for (const key of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
      const variant = asset.variants[key as EditorialImageAssetVariantKey];
      if (!variant) {
        continue;
      }
      await storageAdapter.writeIfAbsent({
        storagePath: variant.storagePath,
        bytes,
        contentType: 'image/webp',
        sha256Checksum: sha256,
        ownership: {
          createdByIntakeId: `intake_${asset.assetId}`,
          targetKind: 'editorial_image_asset',
          namespace: 'private',
          assetId: asset.assetId,
          uploaderUid: asset.createdByUid,
        },
      });
    }
  }

  function buildRichBodyWithAssets(
    assetIds: readonly string[]
  ): RichNewsDocumentWrapperV2 {
    return {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dir: 'rtl' },
            content: [{ type: 'text', text: 'تقرير بيئي ميداني' }],
          },
          ...assetIds.map((assetId) => ({
            type: 'editorialImage' as const,
            attrs: {
              assetId,
              altAr: `صورة ${assetId}`,
              altEn: `Photo ${assetId}`,
              captionAr: 'تسمية توضيحية بالعربية',
              captionEn: 'English caption',
              width: '75%' as const,
              layout: 'block-center' as const,
            },
          })),
        ],
      },
    };
  }

  function buildNewsItem(
    id: string,
    overrides?: Partial<NewsItemBackend>
  ): NewsItemBackend {
    return {
      id,
      titleAr: 'تحقيق مناخي حول حوض النيل',
      titleEn: 'Climate Investigation on the Nile Basin',
      summaryAr: 'ملخص التحقيق المناخي',
      summaryEn: 'Summary of the climate investigation',
      bodyAr: 'النص الكامل للتحقيق بالعربية',
      bodyEn: 'Full investigation body in English',
      author: 'Editorial Desk',
      category: 'Climate',
      tags: ['nile', 'climate'],
      sources: ['https://www.unep.org'],
      location: 'Sudan / السودان',
      urgencyLevel: 'Standard',
      workflowState: 'Published',
      createdAt: '2026-04-15T08:00:00.000Z',
      updatedAt: '2026-04-15T11:00:00.000Z',
      publishedAt: '2026-04-15T12:00:00.000Z',
      history: [],
      ...overrides,
    };
  }

  it('1. Allowed variants (thumbnail, card, article_inline, article_cover) succeed for a published article referencing an active approved in-scope asset (inline or explicit cover)', async () => {
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();

    const inlineAsset = buildApprovedAsset(APPROVED_ASSET_ID);
    const explicitCoverAsset = buildApprovedAsset(EXPLICIT_COVER_ASSET_ID);

    await seedAssetAndBinaries(assetRepo, storageAdapter, inlineAsset);
    await seedAssetAndBinaries(assetRepo, storageAdapter, explicitCoverAsset);

    const publishedArticle = buildNewsItem(PUBLISHED_ARTICLE_ID, {
      featuredImage: EXPLICIT_COVER_ASSET_ID,
      richBodyAr: buildRichBodyWithAssets([APPROVED_ASSET_ID]),
    });

    const newsRepo = new InMemoryNewsRepository([publishedArticle]);

    expect(PUBLIC_DELIVERY_ALLOWED_VARIANTS).toEqual([
      'thumbnail',
      'card',
      'article_inline',
      'article_cover',
    ]);

    for (const variant of PUBLIC_DELIVERY_ALLOWED_VARIANTS) {
      for (const targetAssetId of [APPROVED_ASSET_ID, EXPLICIT_COVER_ASSET_ID]) {
        const { writer, state } = createMockResponseWriter();

        await executePublicEditorialImageDeliveryEndpoint(
          {
            method: 'GET',
            headers: {
              origin: 'https://promiseofplanet.org',
            },
            query: {
              articleId: PUBLISHED_ARTICLE_ID,
              assetId: targetAssetId,
              variant,
            },
          },
          writer,
          {
            newsRepository: newsRepo,
            assetRepository: assetRepo,
            storageAdapter,
          }
        );

        expect(state.statusCode).toBe(200);
        expect(state.headers['content-type']).toBe('image/webp');
        expect(state.headers['x-content-type-options']).toBe('nosniff');
        expect(state.headers['cache-control']).toContain('no-store');
        expect(state.headers['cross-origin-resource-policy']).toBe(
          'cross-origin'
        );
        expect(state.headers['access-control-allow-origin']).toBe(
          'https://promiseofplanet.org'
        );
        expect(state.binaryBuffer).not.toBeNull();
        expect(state.binaryBuffer?.equals(sampleWebpBytes)).toBe(true);
      }
    }
  });

  it('2. original_processed and unknown variants are rejected with HTTP 400 INVALID_VARIANT_KEY', async () => {
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();
    const inlineAsset = buildApprovedAsset(APPROVED_ASSET_ID);
    await seedAssetAndBinaries(assetRepo, storageAdapter, inlineAsset);

    const newsRepo = new InMemoryNewsRepository([
      buildNewsItem(PUBLISHED_ARTICLE_ID, {
        richBodyAr: buildRichBodyWithAssets([APPROVED_ASSET_ID]),
      }),
    ]);

    for (const disallowedVariant of [
      'original_processed',
      'raw',
      'full',
      '../card',
      '',
    ]) {
      const { writer, state } = createMockResponseWriter();

      await executePublicEditorialImageDeliveryEndpoint(
        {
          method: 'GET',
          headers: {},
          query: {
            articleId: PUBLISHED_ARTICLE_ID,
            assetId: APPROVED_ASSET_ID,
            variant: disallowedVariant,
          },
        },
        writer,
        {
          newsRepository: newsRepo,
          assetRepository: assetRepo,
          storageAdapter,
        }
      );

      expect(state.statusCode).toBe(400);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'INVALID_VARIANT_KEY'
      );
      expect(state.binaryBuffer).toBeNull();
    }
  });

  it('3. Unpublished or withdrawn articles are rejected with HTTP 403 ARTICLE_NOT_PUBLISHED', async () => {
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();
    const inlineAsset = buildApprovedAsset(APPROVED_ASSET_ID);
    await seedAssetAndBinaries(assetRepo, storageAdapter, inlineAsset);

    const draftArticle = buildNewsItem(DRAFT_ARTICLE_ID, {
      workflowState: 'Draft',
      richBodyAr: buildRichBodyWithAssets([APPROVED_ASSET_ID]),
    });

    const withdrawnArticle = buildNewsItem(WITHDRAWN_ARTICLE_ID, {
      workflowState: 'Draft',
      publishedAt: '2026-04-15T12:00:00.000Z',
      richBodyAr: buildRichBodyWithAssets([APPROVED_ASSET_ID]),
      history: [
        {
          fromState: 'Published',
          toState: 'Draft',
          actorId: 'owner-1',
          actorName: 'Owner',
          actorRole: 'Owner',
          timestamp: '2026-04-16T09:00:00.000Z',
          comment: 'Withdrawn for factual update.',
        },
      ],
    });

    const newsRepo = new InMemoryNewsRepository([
      draftArticle,
      withdrawnArticle,
    ]);

    for (const targetArticleId of [
      DRAFT_ARTICLE_ID,
      WITHDRAWN_ARTICLE_ID,
      'non_existent_article_99',
    ]) {
      const { writer, state } = createMockResponseWriter();

      await executePublicEditorialImageDeliveryEndpoint(
        {
          method: 'GET',
          headers: {},
          query: {
            articleId: targetArticleId,
            assetId: APPROVED_ASSET_ID,
            variant: 'article_inline',
          },
        },
        writer,
        {
          newsRepository: newsRepo,
          assetRepository: assetRepo,
          storageAdapter,
        }
      );

      expect(state.statusCode).toBe(403);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'ARTICLE_NOT_PUBLISHED'
      );
      expect(state.binaryBuffer).toBeNull();
    }
  });

  it('4. Unreferenced asset is rejected with HTTP 403 ASSET_NOT_REFERENCED_BY_ARTICLE', async () => {
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();

    const referencedAsset = buildApprovedAsset(APPROVED_ASSET_ID);
    const unreferencedAsset = buildApprovedAsset(UNREFERENCED_ASSET_ID);

    await seedAssetAndBinaries(assetRepo, storageAdapter, referencedAsset);
    await seedAssetAndBinaries(assetRepo, storageAdapter, unreferencedAsset);

    const newsRepo = new InMemoryNewsRepository([
      buildNewsItem(PUBLISHED_ARTICLE_ID, {
        richBodyAr: buildRichBodyWithAssets([APPROVED_ASSET_ID]),
      }),
    ]);

    const { writer, state } = createMockResponseWriter();

    await executePublicEditorialImageDeliveryEndpoint(
      {
        method: 'GET',
        headers: {},
        query: {
          articleId: PUBLISHED_ARTICLE_ID,
          assetId: UNREFERENCED_ASSET_ID,
          variant: 'card',
        },
      },
      writer,
      {
        newsRepository: newsRepo,
        assetRepository: assetRepo,
        storageAdapter,
      }
    );

    expect(state.statusCode).toBe(403);
    expect((state.body as { errorCode: string }).errorCode).toBe(
      'ASSET_NOT_REFERENCED_BY_ARTICLE'
    );
    expect(state.binaryBuffer).toBeNull();
  });

  it('5. PendingReview, Rejected, Revoked, quarantined, and retired assets are rejected with HTTP 403', async () => {
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();

    const pendingId = 'asset_state_pending_01';
    const rejectedId = 'asset_state_rejected_02';
    const revokedId = 'asset_state_revoked_03';
    const quarantinedId = 'asset_state_quarantined_04';
    const retiredId = 'asset_state_retired_05';

    const pendingAsset = buildApprovedAsset(pendingId, {
      status: 'PendingReview',
    });
    const rejectedAsset = buildApprovedAsset(rejectedId, {
      status: 'Rejected',
      reviewedByUid: 'admin-owner-01',
      reviewedAtIso: '2026-04-11T10:00:00.000Z',
      reviewReason: 'Insufficient attribution evidence.',
    });
    const revokedAsset = buildApprovedAsset(revokedId, {
      status: 'Revoked',
      reviewedByUid: 'admin-owner-01',
      reviewedAtIso: '2026-04-11T10:00:00.000Z',
      reviewReason: 'License revoked by photographer.',
    });
    const quarantinedAsset = buildApprovedAsset(
      quarantinedId,
      undefined,
      'quarantined'
    );
    const retiredAsset = buildApprovedAsset(retiredId, undefined, 'retired');

    for (const asset of [
      pendingAsset,
      rejectedAsset,
      revokedAsset,
      quarantinedAsset,
      retiredAsset,
    ]) {
      await seedAssetAndBinaries(assetRepo, storageAdapter, asset);
    }

    const newsRepo = new InMemoryNewsRepository([
      buildNewsItem(PUBLISHED_ARTICLE_ID, {
        richBodyAr: buildRichBodyWithAssets([
          pendingId,
          rejectedId,
          revokedId,
          quarantinedId,
          retiredId,
        ]),
      }),
    ]);

    for (const ineligibleId of [
      pendingId,
      rejectedId,
      revokedId,
      quarantinedId,
      retiredId,
    ]) {
      const { writer, state } = createMockResponseWriter();

      await executePublicEditorialImageDeliveryEndpoint(
        {
          method: 'GET',
          headers: {},
          query: {
            articleId: PUBLISHED_ARTICLE_ID,
            assetId: ineligibleId,
            variant: 'article_inline',
          },
        },
        writer,
        {
          newsRepository: newsRepo,
          assetRepository: assetRepo,
          storageAdapter,
        }
      );

      expect(state.statusCode).toBe(403);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE'
      );
      expect(state.binaryBuffer).toBeNull();
    }
  });

  it('6. ArticleRestricted asset succeeds for authorized article and is rejected for another published article', async () => {
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();

    const restrictedAsset = buildApprovedAsset(RESTRICTED_ASSET_ID, {
      licenseType: 'DirectLicense',
      licenseDetails: 'Single-article license for COP16 report',
      usageScope: {
        scopeType: 'ArticleRestricted',
        articleIds: [PUBLISHED_ARTICLE_ID],
      },
    });

    await seedAssetAndBinaries(assetRepo, storageAdapter, restrictedAsset);

    const authorizedArticle = buildNewsItem(PUBLISHED_ARTICLE_ID, {
      richBodyAr: buildRichBodyWithAssets([RESTRICTED_ASSET_ID]),
    });
    const unauthorizedArticle = buildNewsItem(OTHER_PUBLISHED_ARTICLE_ID, {
      richBodyAr: buildRichBodyWithAssets([RESTRICTED_ASSET_ID]),
    });

    const newsRepo = new InMemoryNewsRepository([
      authorizedArticle,
      unauthorizedArticle,
    ]);

    // Authorized article succeeds
    {
      const { writer, state } = createMockResponseWriter();
      await executePublicEditorialImageDeliveryEndpoint(
        {
          method: 'GET',
          headers: {},
          query: {
            articleId: PUBLISHED_ARTICLE_ID,
            assetId: RESTRICTED_ASSET_ID,
            variant: 'article_cover',
          },
        },
        writer,
        {
          newsRepository: newsRepo,
          assetRepository: assetRepo,
          storageAdapter,
        }
      );
      expect(state.statusCode).toBe(200);
      expect(state.binaryBuffer?.equals(sampleWebpBytes)).toBe(true);
    }

    // Other published article referencing the same restricted asset is rejected
    {
      const { writer, state } = createMockResponseWriter();
      await executePublicEditorialImageDeliveryEndpoint(
        {
          method: 'GET',
          headers: {},
          query: {
            articleId: OTHER_PUBLISHED_ARTICLE_ID,
            assetId: RESTRICTED_ASSET_ID,
            variant: 'article_cover',
          },
        },
        writer,
        {
          newsRepository: newsRepo,
          assetRepository: assetRepo,
          storageAdapter,
        }
      );
      expect(state.statusCode).toBe(403);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE'
      );
      expect(state.binaryBuffer).toBeNull();
    }
  });

  it('7. Corrupt or mismatched binary (checksum mismatch, size mismatch, or non-WebP bytes) is rejected with HTTP 500 STORAGE_INTEGRITY_ERROR', async () => {
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();

    const corruptChecksumId = 'asset_corrupt_checksum_01';
    const corruptFormatId = 'asset_corrupt_format_02';

    const assetWithChecksumMismatch = buildApprovedAsset(corruptChecksumId);
    assetRepo.corruptStoredRecordForTesting(corruptChecksumId, {
      assetId: corruptChecksumId,
      revision: 1,
      asset: assetWithChecksumMismatch,
    });

    // Write valid WebP bytes with a different payload than the metadata checksum
    const differentWebpBytes = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: { r: 220, g: 30, b: 30 },
      },
    })
      .webp({ quality: 50 })
      .toBuffer();

    await storageAdapter.writeIfAbsent({
      storagePath: assetWithChecksumMismatch.variants.card!.storagePath,
      bytes: differentWebpBytes,
      contentType: 'image/webp',
      sha256Checksum: computeSha256Hex(differentWebpBytes),
      ownership: {
        createdByIntakeId: 'intake_corrupt_1',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: corruptChecksumId,
        uploaderUid: 'admin-editor-01',
      },
    });

    // Non-WebP bytes matching length and checksum in metadata
    const nonWebpBytes = Buffer.from(
      'NOT_A_WEBP_IMAGE_HEADER_PAYLOAD_0123456789ABCDEF',
      'utf-8'
    );
    const nonWebpSha = computeSha256Hex(nonWebpBytes);
    const baseCorruptFormat = buildApprovedAsset(corruptFormatId);
    const assetWithNonWebpBinary: EditorialImageAssetMetadata = {
      ...baseCorruptFormat,
      variants: buildCanonicalVariantsForBytes(
        corruptFormatId,
        nonWebpBytes,
        nonWebpSha
      ),
    };
    await seedAssetAndBinaries(
      assetRepo,
      storageAdapter,
      assetWithNonWebpBinary,
      nonWebpBytes,
      nonWebpSha
    );

    const newsRepo = new InMemoryNewsRepository([
      buildNewsItem(PUBLISHED_ARTICLE_ID, {
        richBodyAr: buildRichBodyWithAssets([
          corruptChecksumId,
          corruptFormatId,
        ]),
      }),
    ]);

    for (const badAssetId of [corruptChecksumId, corruptFormatId]) {
      const { writer, state } = createMockResponseWriter();
      await executePublicEditorialImageDeliveryEndpoint(
        {
          method: 'GET',
          headers: {},
          query: {
            articleId: PUBLISHED_ARTICLE_ID,
            assetId: badAssetId,
            variant: 'card',
          },
        },
        writer,
        {
          newsRepository: newsRepo,
          assetRepository: assetRepo,
          storageAdapter,
        }
      );

      expect(state.statusCode).toBe(500);
      expect((state.body as { errorCode: string }).errorCode).toBe(
        'STORAGE_INTEGRITY_ERROR'
      );
      expect(state.binaryBuffer).toBeNull();
    }
  });

  it('8. Error responses never leak private storage paths, bucket names, tokens, or evidence references', async () => {
    const assetRepo = new InMemoryEditorialImageAssetRepository();
    const storageAdapter = new InMemoryEditorialBinaryStorageAdapter();

    const approvedAsset = buildApprovedAsset(APPROVED_ASSET_ID);
    // Intentionally do NOT write binary to storage so BINARY_NOT_FOUND triggers after metadata lookup
    assetRepo.corruptStoredRecordForTesting(APPROVED_ASSET_ID, {
      assetId: APPROVED_ASSET_ID,
      revision: 1,
      asset: approvedAsset,
    });

    const newsRepo = new InMemoryNewsRepository([
      buildNewsItem(PUBLISHED_ARTICLE_ID, {
        richBodyAr: buildRichBodyWithAssets([APPROVED_ASSET_ID]),
      }),
    ]);

    const { writer, state } = createMockResponseWriter();
    await executePublicEditorialImageDeliveryEndpoint(
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer secret_ leaked_token_value',
        },
        query: {
          articleId: PUBLISHED_ARTICLE_ID,
          assetId: APPROVED_ASSET_ID,
          variant: 'article_inline',
        },
      },
      writer,
      {
        newsRepository: newsRepo,
        assetRepository: assetRepo,
        storageAdapter,
      }
    );

    expect(state.statusCode).toBe(404);
    const serialized = JSON.stringify(state.body);
    expect(serialized).not.toContain('editorial_images/private');
    expect(serialized).not.toContain('evidence_ref_999');
    expect(serialized).not.toContain('secret_ leaked_token_value');
    expect(serialized).not.toContain('gs://');
  });
});
