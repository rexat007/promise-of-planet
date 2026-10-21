import { describe, expect, it } from 'vitest';
import {
  CANONICAL_EDITORIAL_IMAGE_STORAGE_PREFIX,
  CANONICAL_SHA256_CHECKSUM_REGEX,
  CANONICAL_UTC_TIMESTAMP_REGEX,
  DEFAULT_ASSET_VALIDATION_LIMITS,
  MAX_IMAGE_DIMENSION_PX,
  type CreateEditorialImageAssetInput,
  type EditorialImageAssetMetadata,
  type EditorialImageAssetVariant,
  type EditorialImageRightsRecord,
} from '../types/editorialImageAsset';
import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
  isValidCanonicalUtcTimestamp,
  sanitizeEditorialImageAssetMetadata,
  updateEditorialImageAssetRecord,
  validateAssetId,
  validateEditorialImageAsset,
  validateEditorialImageAssetVariant,
  validateEditorialImageRights,
  validateEditorialImageStoragePath,
  validateEditorialImageUsageScope,
  validateSha256Checksum,
} from './editorialImageAssetContract';
import { validateRichNewsDocumentV2 } from './richNewsDocumentContract';
import {
  richDocumentV2ToTiptapJson,
  tiptapJsonToRichDocumentV2,
} from './richNewsTiptapAdapter';

describe('EditorialImageAssetContract Unit Tests', () => {
  const VALID_ASSET_SHA256 =
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const VALID_VARIANT_SHA256 =
    '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';

  const validVariant: EditorialImageAssetVariant = {
    variantKey: 'article_inline',
    storagePath: 'editorial_images/private/img_valid_asset_123/article_inline.webp',
    mimeType: 'image/webp',
    width: 1200,
    height: 800,
    sizeBytes: 150_000,
    sha256Checksum: VALID_VARIANT_SHA256,
  };

  const validRecordInput: CreateEditorialImageAssetInput = {
    assetId: 'img_valid_asset_123',
    createdByUid: 'admin_user_99',
    origin: 'news_article',
    originalFilename: 'sunset_climate_report.jpg',
    mimeType: 'image/jpeg',
    originalSizeBytes: 2_500_000,
    originalWidth: 3000,
    originalHeight: 2000,
    sha256Checksum: VALID_ASSET_SHA256,
    variants: {
      article_inline: validVariant,
    },
    altAr: 'صورة غروب الشمس للتقرير المناخي',
    altEn: 'Sunset photo for climate report',
    captionAr: 'مشهد لغروب الشمس في المنطقة الجنوبية',
    captionEn: 'Sunset scene in the southern region',
    photographerCredit: 'John Doe / Planet Press',
    licensingInfo: 'CC-BY-4.0',
    tags: ['environment', 'climate', 'sunset'],
    associatedArticleIds: ['art_998877'],
  };

  const syntheticApprovedRightsFixture: EditorialImageRightsRecord = {
    status: 'Approved',
    licenseType: 'DirectLicense',
    licenseDetails: 'Planet Press Syndication License #PP-2026-091',
    rightsHolder: 'Planet Press Agency',
    sourceAttributionAr: 'وكالة بلانيت برس الإخبارية',
    sourceAttributionEn: 'Planet Press News Agency',
    evidenceRefs: ['ev_contract_2026_091', 'ev_invoice_88412'],
    usageScope: {
      scopeType: 'GeneralEditorial',
    },
    reviewedByUid: 'rights_reviewer_01',
    reviewedAtIso: '2026-10-21T02:00:00.000Z',
    reviewReason: 'Verified written syndication agreement and agency invoice.',
  };

  it('1. should validate canonical asset IDs across full V2 length range (1..128 chars)', () => {
    const validIds = [
      'a',
      'short',
      'img_001',
      'img_valid_asset_123',
      'img_access_token_diagram',
      'x'.repeat(64),
      'y'.repeat(65),
      'z'.repeat(128),
    ];

    for (const id of validIds) {
      const res = validateAssetId(id);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    }
  });

  it('2. should reject invalid asset IDs (empty, >128 chars, leading/trailing spaces, special chars, URLs)', () => {
    expect(validateAssetId('').valid).toBe(false);
    expect(validateAssetId('   ').valid).toBe(false);
    expect(validateAssetId('a'.repeat(129)).valid).toBe(false);
    expect(validateAssetId(' img_valid_asset_123').valid).toBe(false);
    expect(validateAssetId('img_valid_asset_123 ').valid).toBe(false);
    expect(validateAssetId('invalid asset space').valid).toBe(false);
    expect(validateAssetId('asset@with$special!').valid).toBe(false);
    expect(validateAssetId('https://example.com/image.png').valid).toBe(false);
    expect(
      validateAssetId('short', {
        ...DEFAULT_ASSET_VALIDATION_LIMITS,
        minAssetIdLength: 8,
      }).valid
    ).toBe(false);
  });

  it('3. should build and validate a valid image variant with canonical editorial_images/private storagePath', () => {
    expect(CANONICAL_EDITORIAL_IMAGE_STORAGE_PREFIX).toBe('editorial_images/private');
    const builtPath = buildEditorialImageVariantStoragePath(
      'img_valid_asset_123',
      'article_inline',
      'image/webp'
    );
    expect(builtPath).toBe('editorial_images/private/img_valid_asset_123/article_inline.webp');

    const res = validateEditorialImageAssetVariant(
      validVariant,
      'article_inline',
      DEFAULT_ASSET_VALIDATION_LIMITS,
      'img_valid_asset_123'
    );
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('4. should reject variant with external HTTP URL or cloud scheme in storagePath', () => {
    const badVariant: EditorialImageAssetVariant = {
      ...validVariant,
      storagePath: 'https://storage.googleapis.com/bucket/image.png',
    };
    const res = validateEditorialImageAssetVariant(badVariant, 'article_inline');
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('external URLs'))).toBe(true);

    const gsVariant: EditorialImageAssetVariant = {
      ...validVariant,
      storagePath: 'gs://bucket/editorial_images/private/img_valid_asset_123/article_inline.webp',
    };
    expect(validateEditorialImageAssetVariant(gsVariant, 'article_inline').valid).toBe(false);
  });

  it('5. should reject variant with Blob or Data URI in storagePath', () => {
    const blobVariant: EditorialImageAssetVariant = {
      ...validVariant,
      storagePath: 'blob:https://app.com/1234-5678',
    };
    expect(validateEditorialImageAssetVariant(blobVariant).valid).toBe(false);

    const dataVariant: EditorialImageAssetVariant = {
      ...validVariant,
      storagePath: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
    };
    expect(validateEditorialImageAssetVariant(dataVariant).valid).toBe(false);
  });

  it('6. should reject variant with Firebase auth query token or query/hash in storagePath', () => {
    const tokenVariant: EditorialImageAssetVariant = {
      ...validVariant,
      storagePath:
        'editorial_images/private/img_valid_asset_123/article_inline.webp?alt=media&token=secret-token-12345',
    };
    const res = validateEditorialImageAssetVariant(tokenVariant);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('security tokens'))).toBe(true);

    const queryVariant: EditorialImageAssetVariant = {
      ...validVariant,
      storagePath: 'editorial_images/private/img_valid_asset_123/article_inline.webp?v=1',
    };
    expect(validateEditorialImageAssetVariant(queryVariant).valid).toBe(false);
  });

  it('7. should create a valid EditorialImageAssetRecord with PendingReview rights, calculated aspectRatio, and required sha256Checksum without mutating input', () => {
    const inputClone: CreateEditorialImageAssetInput = JSON.parse(JSON.stringify(validRecordInput));
    const snapshotBefore = JSON.parse(JSON.stringify(inputClone));

    const record = createEditorialImageAssetRecord(inputClone);
    expect(inputClone).toEqual(snapshotBefore);

    expect(record.assetId).toBe('img_valid_asset_123');
    expect(record.aspectRatio).toBe(1.5); // 3000 / 2000
    expect(record.sha256Checksum).toBe(VALID_ASSET_SHA256);
    expect(record.variants.article_inline.sha256Checksum).toBe(VALID_VARIANT_SHA256);
    expect(record.status).toBe('active');
    expect(record.rights).toEqual({ status: 'PendingReview' });
    expect(record.rights.reviewedByUid).toBeUndefined();
    expect(record.rights.reviewedAtIso).toBeUndefined();
    expect(record.createdAtIso).toMatch(CANONICAL_UTC_TIMESTAMP_REGEX);
    expect(record.updatedAtIso).toMatch(CANONICAL_UTC_TIMESTAMP_REGEX);

    // Mutating returned record must not mutate input
    record.tags?.push('mutated_tag');
    record.associatedArticleIds?.push('mutated_article');
    record.variants.article_inline.width = 999;
    expect(inputClone).toEqual(snapshotBefore);

    const freshRecord = createEditorialImageAssetRecord(validRecordInput);
    const valRes = validateEditorialImageAsset(freshRecord);
    expect(valRes.valid).toBe(true);
  });

  it('8. should reject record creation when Arabic alt text (altAr) is missing or empty', () => {
    const inputWithoutAltAr = {
      ...validRecordInput,
      altAr: '   ',
    };
    expect(() => createEditorialImageAssetRecord(inputWithoutAltAr)).toThrow(
      /altAr \(Arabic alt text\) is required/
    );
  });

  it('9. should reject record creation if file size exceeds maximum limits', () => {
    const inputOversized = {
      ...validRecordInput,
      originalSizeBytes: 20_000_000, // 20 MB > 15 MB limit
    };
    expect(() => createEditorialImageAssetRecord(inputOversized)).toThrow(
      /originalSizeBytes exceeds maximum limit/
    );
  });

  it('10. should reject record with invalid or unsupported MIME type', () => {
    const badMimeInput = {
      ...validRecordInput,
      mimeType: 'image/gif' as any,
    };
    expect(() => createEditorialImageAssetRecord(badMimeInput)).toThrow(/mimeType must be one of/);
  });

  it('11. should reject metadata containing external HTTP URLs in alt or caption text', () => {
    const httpAltInput = {
      ...validRecordInput,
      altAr: 'صورة تحتوي رابط https://evil.com/phishing',
    };
    expect(() => createEditorialImageAssetRecord(httpAltInput)).toThrow(
      /altAr contains prohibited URL/
    );
  });

  it('12. should update editable editorial metadata fields while preserving original record immutability, untouched fields, and complete rights object', () => {
    const baseRecord = createEditorialImageAssetRecord({
      ...validRecordInput,
      createdAtIso: '2026-10-20T10:00:00.000Z',
      updatedAtIso: '2026-10-21T02:00:00.000Z',
    });

    // Also verify preservation when existing record holds a complete Approved rights object
    const record: EditorialImageAssetMetadata = {
      ...baseRecord,
      rights: JSON.parse(JSON.stringify(syntheticApprovedRightsFixture)),
    };
    const recordSnapshot = JSON.parse(JSON.stringify(record));

    const patch = {
      altEn: 'Updated English Alt Text',
      tags: ['environment', 'sustainability', 'green'],
    };
    const patchSnapshot = JSON.parse(JSON.stringify(patch));

    const updated = updateEditorialImageAssetRecord(record, patch);

    // Original record and patch must remain completely unchanged
    expect(record).toEqual(recordSnapshot);
    expect(patch).toEqual(patchSnapshot);

    // Updated fields
    expect(updated.altEn).toBe('Updated English Alt Text');
    expect(updated.tags).toEqual(['environment', 'sustainability', 'green']);
    expect(updated.updatedAtIso).not.toEqual(record.updatedAtIso);
    expect(Date.parse(updated.updatedAtIso)).toBeGreaterThanOrEqual(
      Date.parse(record.updatedAtIso)
    );

    // Untouched fields including complete rights object remain identical
    expect(updated.assetId).toBe(record.assetId);
    expect(updated.createdByUid).toBe(record.createdByUid);
    expect(updated.createdAtIso).toBe(record.createdAtIso);
    expect(updated.origin).toBe(record.origin);
    expect(updated.status).toBe(record.status);
    expect(updated.rights).toEqual(record.rights);
    expect(updated.rights).not.toBe(record.rights);
    expect(updated.rights.evidenceRefs).not.toBe(record.rights.evidenceRefs);
    expect(updated.rights.usageScope).not.toBe(record.rights.usageScope);
    expect(updated.originalFilename).toBe(record.originalFilename);
    expect(updated.mimeType).toBe(record.mimeType);
    expect(updated.originalSizeBytes).toBe(record.originalSizeBytes);
    expect(updated.originalWidth).toBe(record.originalWidth);
    expect(updated.originalHeight).toBe(record.originalHeight);
    expect(updated.aspectRatio).toBe(record.aspectRatio);
    expect(updated.sha256Checksum).toBe(record.sha256Checksum);
    expect(updated.variants).toEqual(record.variants);
    expect(updated.altAr).toBe(record.altAr);
    expect(updated.captionAr).toBe(record.captionAr);
    expect(updated.captionEn).toBe(record.captionEn);
    expect(updated.photographerCredit).toBe(record.photographerCredit);
    expect(updated.licensingInfo).toBe(record.licensingInfo);
    expect(updated.associatedArticleIds).toEqual(record.associatedArticleIds);

    // Mutating returned updated object must not mutate original record
    updated.tags?.push('after_mutation');
    updated.rights.evidenceRefs?.push('ev_mutated');
    updated.variants.article_inline.width = 500;
    expect(record).toEqual(recordSnapshot);

    const valRes = validateEditorialImageAsset(
      validateEditorialImageAsset(updated).valid ? updated : record
    );
    expect(valRes.valid).toBe(true);
  });

  it('13. should fail-closed in sanitizeEditorialImageAssetMetadata: preserve valid records (including nested rights) without mutation and reject malformed identifiers, dimensions, tags, checksums, rights, or unknown fields', () => {
    const pendingRecord = createEditorialImageAssetRecord({
      ...validRecordInput,
      createdAtIso: '2026-10-21T00:00:00.000Z',
      updatedAtIso: '2026-10-21T02:00:00.000Z',
    });
    const validRecord: EditorialImageAssetMetadata = {
      ...pendingRecord,
      rights: {
        ...JSON.parse(JSON.stringify(syntheticApprovedRightsFixture)),
        usageScope: {
          scopeType: 'ArticleRestricted',
          articleIds: ['art_998877'],
        },
      },
    };
    const inputSnapshot = JSON.parse(JSON.stringify(validRecord));

    const sanitized = sanitizeEditorialImageAssetMetadata(validRecord);
    expect(sanitized).toEqual(validRecord);
    expect(sanitized).not.toBe(validRecord);
    expect(sanitized.rights).not.toBe(validRecord.rights);
    expect(sanitized.rights.evidenceRefs).not.toBe(validRecord.rights.evidenceRefs);
    expect(sanitized.rights.usageScope).not.toBe(validRecord.rights.usageScope);
    expect(sanitized.rights.usageScope?.articleIds).not.toBe(
      validRecord.rights.usageScope?.articleIds
    );
    expect(sanitized.variants).not.toBe(validRecord.variants);
    expect(sanitized.variants.article_inline).not.toBe(validRecord.variants.article_inline);
    expect(sanitized.tags).not.toBe(validRecord.tags);
    expect(sanitized.associatedArticleIds).not.toBe(validRecord.associatedArticleIds);

    sanitized.tags?.push('mutated');
    sanitized.associatedArticleIds?.push('art_mutated');
    sanitized.rights.evidenceRefs?.push('ev_mutated');
    sanitized.rights.usageScope?.articleIds?.push('art_mutated');
    sanitized.variants.article_inline.width = 42;
    expect(validRecord).toEqual(inputSnapshot);

    // Invalid dimensions rejected, not rounded
    expect(() =>
      sanitizeEditorialImageAssetMetadata({
        ...validRecord,
        originalWidth: 1200.5,
      })
    ).toThrow(/originalWidth must be a finite positive integer/);

    // Invalid tags rejected, not dropped
    expect(() =>
      sanitizeEditorialImageAssetMetadata({
        ...validRecord,
        tags: ['climate', '   ', 'nature'],
      })
    ).toThrow(/tag at index 1 must not be empty/);

    // Malformed rights rejected, not normalized or stripped
    expect(() =>
      sanitizeEditorialImageAssetMetadata({
        ...validRecord,
        rights: {
          status: 'Approved',
        },
      })
    ).toThrow(/Failed to sanitize EditorialImageAssetMetadata/);

    expect(() =>
      sanitizeEditorialImageAssetMetadata({
        ...validRecord,
        rights: {
          ...validRecord.rights,
          extraRightsFlag: true,
        } as any,
      })
    ).toThrow(/Unexpected or disallowed field "extraRightsFlag" on editorial image rights record/);
  });

  it('14. should enforce max tags count limit', () => {
    const tooManyTags = Array.from({ length: 60 }, (_, i) => `tag_${i}`);
    const inputWithManyTags = {
      ...validRecordInput,
      tags: tooManyTags,
    };
    expect(() => createEditorialImageAssetRecord(inputWithManyTags)).toThrow(
      /tags count must not exceed/
    );
  });

  it('15. should validate aspectRatio precision mismatch', () => {
    const mismatchedRecord: EditorialImageAssetMetadata = {
      ...createEditorialImageAssetRecord(validRecordInput),
      originalWidth: 2000,
      originalHeight: 1000,
      aspectRatio: 1.0, // Expected 2.0
    };

    const res = validateEditorialImageAsset(mismatchedRecord);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('aspectRatio'))).toBe(true);
  });

  it('16. should maintain strict assetId parity with V2 document contract and Tiptap V2 adapter', () => {
    const edgeCaseAssetIds = [
      'a',
      'img_7ch',
      'img_access_token_flow',
      'asset_' + 'k'.repeat(122), // 128 chars total
    ];

    for (const id of edgeCaseAssetIds) {
      const record = createEditorialImageAssetRecord({
        ...validRecordInput,
        assetId: id,
        variants: {
          article_inline: {
            ...validVariant,
            storagePath: buildEditorialImageVariantStoragePath(id, 'article_inline', 'image/webp'),
          },
        },
      });

      const tiptapDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'editorialImage',
            attrs: {
              assetId: record.assetId,
              altAr: record.altAr,
              width: '100%',
              layout: 'block-full',
            },
          },
        ],
      };

      const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapDoc);
      expect(validateRichNewsDocumentV2(wrapperV2).valid).toBe(true);
      const roundTripTiptap = richDocumentV2ToTiptapJson(wrapperV2);
      expect(roundTripTiptap.content?.[0]?.attrs?.assetId).toBe(id);
    }
  });

  it('17. should reject storagePath when path assetId does not match parent record assetId', () => {
    const mismatchedInput: CreateEditorialImageAssetInput = {
      ...validRecordInput,
      assetId: 'img_valid_asset_123',
      variants: {
        article_inline: {
          ...validVariant,
          storagePath: 'editorial_images/private/img_other_999/article_inline.webp',
        },
      },
    };

    expect(() => createEditorialImageAssetRecord(mismatchedInput)).toThrow(
      /does not match assetId 'img_valid_asset_123'/
    );

    const record = createEditorialImageAssetRecord(validRecordInput);
    expect(
      validateEditorialImageAsset({
        ...record,
        variants: {
          article_inline: {
            ...validVariant,
            storagePath: 'editorial_images/private/img_other_999/article_inline.webp',
          },
        },
      }).valid
    ).toBe(false);
  });

  it('18. should reject storagePath when filename variantKey or extension mismatches variant metadata', () => {
    const wrongFilenameVariant: EditorialImageAssetVariant = {
      ...validVariant,
      variantKey: 'article_inline',
      storagePath: 'editorial_images/private/img_valid_asset_123/thumbnail.webp',
    };
    const resKeyMismatch = validateEditorialImageAssetVariant(
      wrongFilenameVariant,
      'article_inline',
      DEFAULT_ASSET_VALIDATION_LIMITS,
      'img_valid_asset_123'
    );
    expect(resKeyMismatch.valid).toBe(false);
    expect(resKeyMismatch.errors.some((e) => e.includes('does not match variantKey'))).toBe(true);

    const wrongExtVariant: EditorialImageAssetVariant = {
      ...validVariant,
      mimeType: 'image/webp',
      storagePath: 'editorial_images/private/img_valid_asset_123/article_inline.png',
    };
    const resExtMismatch = validateEditorialImageAssetVariant(
      wrongExtVariant,
      'article_inline',
      DEFAULT_ASSET_VALIDATION_LIMITS,
      'img_valid_asset_123'
    );
    expect(resExtMismatch.valid).toBe(false);
    expect(resExtMismatch.errors.some((e) => e.includes('does not match mimeType'))).toBe(true);

    const jpegVariant: EditorialImageAssetVariant = {
      ...validVariant,
      mimeType: 'image/jpeg',
      storagePath: 'editorial_images/private/img_valid_asset_123/article_inline.jpeg',
    };
    expect(
      validateEditorialImageAssetVariant(
        jpegVariant,
        'article_inline',
        DEFAULT_ASSET_VALIDATION_LIMITS,
        'img_valid_asset_123'
      ).valid
    ).toBe(true);
  });

  it('19. should reject path traversal, slashes, backslashes, percent-encoding, and non-canonical prefixes in storagePath', () => {
    const unsafePaths = [
      '/editorial_images/private/img_valid_asset_123/article_inline.webp',
      'editorial_images/private/img_valid_asset_123/article_inline.webp/',
      'editorial_images//private/img_valid_asset_123/article_inline.webp',
      'editorial_images\\private\\img_valid_asset_123\\article_inline.webp',
      'editorial_images/private/../img_valid_asset_123/article_inline.webp',
      'editorial_images/private/img_valid_asset_123/./article_inline.webp',
      'editorial_images/private/img_valid_asset_123/%2e%2e/article_inline.webp',
      ' editorial_images/private/img_valid_asset_123/article_inline.webp ',
      'news/images/assets/img_valid_asset_123/article_inline.webp',
      'editorial_images/public/img_valid_asset_123/article_inline.webp',
      'public/images/assets/img_valid_asset_123/article_inline.webp',
      'editorial_images/private/path.webp',
    ];

    for (const badPath of unsafePaths) {
      const res = validateEditorialImageStoragePath(badPath, {
        expectedAssetId: 'img_valid_asset_123',
        expectedVariantKey: 'article_inline',
        expectedMimeType: 'image/webp',
      });
      expect(res.valid).toBe(false);
    }
  });

  it('20. should validate sha256Checksum on asset and variant records and reject missing, uppercase, whitespace, short, long, or non-hex values', () => {
    expect(CANONICAL_SHA256_CHECKSUM_REGEX.test(VALID_ASSET_SHA256)).toBe(true);
    expect(validateSha256Checksum(VALID_ASSET_SHA256).valid).toBe(true);
    expect(validateSha256Checksum('0123456789abcdef'.repeat(4)).valid).toBe(true);

    const invalidChecksums: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      VALID_ASSET_SHA256.toUpperCase(),
      'E3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ` ${VALID_ASSET_SHA256}`,
      `${VALID_ASSET_SHA256} `,
      `${VALID_ASSET_SHA256.slice(0, 32)} ${VALID_ASSET_SHA256.slice(33)}`,
      'a'.repeat(63),
      'a'.repeat(65),
      'g'.repeat(64),
    ];

    for (const badChecksum of invalidChecksums) {
      expect(validateSha256Checksum(badChecksum).valid).toBe(false);

      expect(() =>
        createEditorialImageAssetRecord({
          ...validRecordInput,
          sha256Checksum: badChecksum as string,
        })
      ).toThrow(/sha256Checksum/);
    }
  });

  it('21. should enforce finite positive integer dimensions up to 10,000px for original image and variants', () => {
    expect(MAX_IMAGE_DIMENSION_PX).toBe(10_000);
    expect(DEFAULT_ASSET_VALIDATION_LIMITS.maxDimensionPx).toBe(10_000);

    const maxBoundaryRecord = createEditorialImageAssetRecord({
      ...validRecordInput,
      originalWidth: 10_000,
      originalHeight: 10_000,
      variants: {
        article_inline: {
          ...validVariant,
          width: 1,
          height: 10_000,
        },
      },
    });
    expect(validateEditorialImageAsset(maxBoundaryRecord).valid).toBe(true);

    const invalidDimensions = [
      0,
      -1,
      -500,
      1200.5,
      0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      10_001,
      50_000,
    ];

    for (const badDim of invalidDimensions) {
      expect(() =>
        createEditorialImageAssetRecord({
          ...validRecordInput,
          originalWidth: badDim,
        })
      ).toThrow(/originalWidth/);

      expect(() =>
        createEditorialImageAssetRecord({
          ...validRecordInput,
          originalHeight: badDim,
        })
      ).toThrow(/originalHeight/);
    }
  });

  it('22. should enforce strict canonical UTC timestamps (YYYY-MM-DDTHH:mm:ss.sssZ) and chronological consistency (updatedAtIso >= createdAtIso)', () => {
    expect(isValidCanonicalUtcTimestamp('2026-10-21T01:05:17.123Z')).toBe(true);
    expect(isValidCanonicalUtcTimestamp('2024-02-29T23:59:59.999Z')).toBe(true);

    const invalidTimestamps = [
      '2026',
      '2026-10-21',
      '2026-10-21T01:05:17Z',
      '2026-10-21T01:05:17.12Z',
      '2026-10-21T01:05:17.1234Z',
      '2026-10-21T01:05:17.123+00:00',
      '2026-10-21T01:05:17.123+03:00',
      '2026-10-21T01:05:17.123',
      '2026-10-21 01:05:17.123Z',
      '2026-10-21t01:05:17.123z',
      '2026-02-29T10:00:00.000Z',
      '2026-02-30T10:00:00.000Z',
      '2026-04-31T10:00:00.000Z',
      '2026-13-01T10:00:00.000Z',
      '2026-00-10T10:00:00.000Z',
      '2026-10-32T10:00:00.000Z',
      '2026-10-21T24:00:00.000Z',
      '2026-10-21T10:60:00.000Z',
      ' 2026-10-21T01:05:17.123Z',
      '2026-10-21T01:05:17.123Z ',
    ];

    for (const badTs of invalidTimestamps) {
      expect(isValidCanonicalUtcTimestamp(badTs)).toBe(false);
    }

    expect(() =>
      createEditorialImageAssetRecord({
        ...validRecordInput,
        createdAtIso: '2026-10-21T10:00:00.001Z',
        updatedAtIso: '2026-10-21T10:00:00.000Z',
      })
    ).toThrow(/updatedAtIso must be greater than or equal to createdAtIso/);
  });

  it('23. should fail-closed on unknown fields, approval/public claims, and malicious prototype structures on asset records and nested variants', () => {
    const baseRecord = createEditorialImageAssetRecord(validRecordInput);

    const prohibitedExtraFields = [
      'src',
      'publicUrl',
      'downloadUrl',
      'accessToken',
      'isPublic',
      'isApproved',
      'rightsApproved',
      'approvedByUid',
      'reviewedByUid',
      'reviewedAtIso',
      'extraField',
    ];

    for (const extraKey of prohibitedExtraFields) {
      const pollutedAsset = {
        ...baseRecord,
        [extraKey]: 'unexpected_value',
      };
      const assetRes = validateEditorialImageAsset(pollutedAsset);
      expect(assetRes.valid).toBe(false);

      expect(() =>
        createEditorialImageAssetRecord({
          ...validRecordInput,
          [extraKey]: 'unexpected_value',
        } as any)
      ).toThrow(/Unexpected or disallowed/);

      expect(() =>
        updateEditorialImageAssetRecord(baseRecord, {
          altEn: 'Valid update',
          [extraKey]: 'unexpected_value',
        } as any)
      ).toThrow(/Unexpected or disallowed/);
    }

    const parsedProtoAsset = JSON.parse(
      JSON.stringify(baseRecord).replace('{', '{"__proto__":{"isAdmin":true},')
    );
    expect(validateEditorialImageAsset(parsedProtoAsset).valid).toBe(false);
  });

  it('24. should reject prohibited lifecycle states (archived/deleted) during asset creation', () => {
    expect(() =>
      createEditorialImageAssetRecord({
        ...validRecordInput,
        status: 'archived',
      })
    ).toThrow(/Prohibited initial lifecycle status "archived"/);

    expect(() =>
      createEditorialImageAssetRecord({
        ...validRecordInput,
        status: 'deleted',
      })
    ).toThrow(/Prohibited initial lifecycle status "deleted"/);
  });

  it('25. should reject update attempts touching immutable identity, verified-file metadata, variants, or lifecycle status (even if values match existing record)', () => {
    const baseRecord = createEditorialImageAssetRecord({
      ...validRecordInput,
      createdAtIso: '2026-10-20T10:00:00.000Z',
      updatedAtIso: '2026-10-20T10:00:00.000Z',
    });

    expect(() =>
      updateEditorialImageAssetRecord(baseRecord, {
        assetId: baseRecord.assetId,
      } as any)
    ).toThrow(/Cannot modify immutable identity or verified-file property "assetId"/);

    expect(() =>
      updateEditorialImageAssetRecord(baseRecord, {
        createdByUid: baseRecord.createdByUid,
      } as any)
    ).toThrow(/Cannot modify immutable identity or verified-file property "createdByUid"/);

    expect(() =>
      updateEditorialImageAssetRecord(baseRecord, {
        sha256Checksum: baseRecord.sha256Checksum,
      } as any)
    ).toThrow(/Cannot modify immutable identity or verified-file property "sha256Checksum"/);

    expect(() =>
      updateEditorialImageAssetRecord(baseRecord, {
        variants: baseRecord.variants,
      } as any)
    ).toThrow(/Cannot modify protected lifecycle or variant property "variants"/);

    expect(() =>
      updateEditorialImageAssetRecord(baseRecord, {
        status: 'active',
      } as any)
    ).toThrow(/Cannot modify protected lifecycle or variant property "status"/);
  });

  it('26. should reject malformed patch values and reject invalid existing records before applying updates', () => {
    const baseRecord = createEditorialImageAssetRecord({
      ...validRecordInput,
      createdAtIso: '2026-10-20T10:00:00.000Z',
      updatedAtIso: '2026-10-20T10:00:00.000Z',
    });

    expect(() =>
      updateEditorialImageAssetRecord(baseRecord, {
        altAr: '   ',
      })
    ).toThrow(/altAr \(Arabic alt text\) is required/);

    const corruptedExistingRecord: EditorialImageAssetMetadata = {
      ...baseRecord,
      altAr: '',
    };

    expect(() =>
      updateEditorialImageAssetRecord(corruptedExistingRecord, {
        altAr: 'نص بديل جديد وصحيح',
      })
    ).toThrow(/existing record is invalid/);
  });

  it('27. should default new assets to rights.status = "PendingReview" and validate minimal PendingReview rights without reviewer or timestamp fabrication', () => {
    const created = createEditorialImageAssetRecord(validRecordInput);
    expect(created.rights).toEqual({
      status: 'PendingReview',
    });
    expect(created.rights.reviewedByUid).toBeUndefined();
    expect(created.rights.reviewedAtIso).toBeUndefined();
    expect(created.rights.reviewReason).toBeUndefined();

    // Minimal PendingReview validates directly
    const minPendingRes = validateEditorialImageRights({
      status: 'PendingReview',
    });
    expect(minPendingRes.valid).toBe(true);
    expect(minPendingRes.errors).toHaveLength(0);

    // PendingReview with fabricated reviewer UID, timestamp, or reviewReason must be rejected
    expect(
      validateEditorialImageRights({
        status: 'PendingReview',
        reviewedByUid: 'rights_reviewer_01',
      }).valid
    ).toBe(false);

    expect(
      validateEditorialImageRights({
        status: 'PendingReview',
        reviewedAtIso: '2026-10-21T02:00:00.000Z',
      }).valid
    ).toBe(false);

    expect(
      validateEditorialImageRights({
        status: 'PendingReview',
        reviewReason: 'Pre-approved',
      }).valid
    ).toBe(false);
  });

  it('28. should reject creation input supplying rights, rights.status, Approved/Rejected/Revoked claims, reviewer identity, or public-access flags', () => {
    const disallowedCreationInputs: Array<Record<string, unknown>> = [
      { rights: { status: 'PendingReview' } },
      { rights: syntheticApprovedRightsFixture },
      { rights: { status: 'Rejected', reviewedByUid: 'rev_1', reviewedAtIso: '2026-10-21T02:00:00.000Z', reviewReason: 'No license' } },
      { rights: { status: 'Revoked', reviewedByUid: 'rev_1', reviewedAtIso: '2026-10-21T02:00:00.000Z', reviewReason: 'Dispute' } },
      { rightsStatus: 'Approved' },
      { reviewedByUid: 'rights_reviewer_01' },
      { reviewedAtIso: '2026-10-21T02:00:00.000Z' },
      { isPublic: true },
      { rightsApproved: true },
      { isApproved: true },
      { approvedByUid: 'owner_01' },
    ];

    for (const extra of disallowedCreationInputs) {
      expect(() =>
        createEditorialImageAssetRecord({
          ...validRecordInput,
          ...extra,
        } as any)
      ).toThrow(/Unexpected or disallowed/);
    }
  });

  it('29. should validate structurally complete Approved rights fixtures and enforce all required Approved fields', () => {
    const baseRecord = createEditorialImageAssetRecord({
      ...validRecordInput,
      createdAtIso: '2026-10-21T01:00:00.000Z',
      updatedAtIso: '2026-10-21T02:00:00.000Z',
    });

    const approvedAsset: EditorialImageAssetMetadata = {
      ...baseRecord,
      rights: { ...syntheticApprovedRightsFixture },
    };

    expect(validateEditorialImageRights(syntheticApprovedRightsFixture).valid).toBe(true);
    expect(validateEditorialImageAsset(approvedAsset).valid).toBe(true);

    // 6. Approved missing reviewer UID rejected
    const missingReviewer: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      reviewedByUid: undefined,
    };
    const resNoReviewer = validateEditorialImageRights(missingReviewer);
    expect(resNoReviewer.valid).toBe(false);
    expect(resNoReviewer.errors.some((e) => e.includes('reviewedByUid'))).toBe(true);

    // 7. Approved missing review timestamp or invalid UTC timestamp rejected
    const missingTimestamp: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      reviewedAtIso: undefined,
    };
    const resNoTimestamp = validateEditorialImageRights(missingTimestamp);
    expect(resNoTimestamp.valid).toBe(false);
    expect(resNoTimestamp.errors.some((e) => e.includes('reviewedAtIso'))).toBe(true);

    const nonUtcTimestamp: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      reviewedAtIso: '2026-10-21T02:00:00+03:00',
    };
    expect(validateEditorialImageRights(nonUtcTimestamp).valid).toBe(false);

    // 8. Approved missing evidence rejected (undefined or empty array)
    const missingEvidence: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      evidenceRefs: undefined,
    };
    expect(validateEditorialImageRights(missingEvidence).valid).toBe(false);

    const emptyEvidence: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      evidenceRefs: [],
    };
    expect(validateEditorialImageRights(emptyEvidence).valid).toBe(false);

    // 9. Approved missing licenseType or licenseDetails rejected
    const missingLicenseType: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      licenseType: undefined,
    };
    expect(validateEditorialImageRights(missingLicenseType).valid).toBe(false);

    const missingLicenseDetails: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      licenseType: 'DirectLicense',
      licenseDetails: undefined,
    };
    const resNoDetails = validateEditorialImageRights(missingLicenseDetails);
    expect(resNoDetails.valid).toBe(false);
    expect(resNoDetails.errors.some((e) => e.includes('licenseDetails'))).toBe(true);

    // 10. Approved missing usageScope rejected
    const missingScope: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      usageScope: undefined,
    };
    const resNoScope = validateEditorialImageRights(missingScope);
    expect(resNoScope.valid).toBe(false);
    expect(resNoScope.errors.some((e) => e.includes('usageScope'))).toBe(true);

    // Missing rightsHolder and documentedException rejected
    const missingHolderAndException: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      rightsHolder: undefined,
      documentedException: undefined,
    };
    expect(validateEditorialImageRights(missingHolderAndException).valid).toBe(false);

    // Missing Arabic source attribution rejected
    const missingSourceAr: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      sourceAttributionAr: undefined,
    };
    expect(validateEditorialImageRights(missingSourceAr).valid).toBe(false);
  });

  it('30. should enforce license-specific and usage-scope constraints (CreativeCommons, PublicDomainClaim, ContextSpecificAssessment, ArticleRestricted)', () => {
    // 11. CreativeCommons missing specific details or using generic label rejected
    const ccMissingDetails: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      licenseType: 'CreativeCommons',
      licenseDetails: undefined,
    };
    expect(validateEditorialImageRights(ccMissingDetails).valid).toBe(false);

    for (const genericLabel of ['CC', 'Creative Commons', 'CreativeCommons', 'cc license']) {
      const ccGeneric: EditorialImageRightsRecord = {
        ...syntheticApprovedRightsFixture,
        licenseType: 'CreativeCommons',
        licenseDetails: genericLabel,
      };
      const ccRes = validateEditorialImageRights(ccGeneric);
      expect(ccRes.valid).toBe(false);
      expect(ccRes.errors.some((e) => e.includes('specific license identifier'))).toBe(true);
    }

    const ccSpecificValid: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      licenseType: 'CreativeCommons',
      licenseDetails: 'CC-BY-SA-4.0',
    };
    expect(validateEditorialImageRights(ccSpecificValid).valid).toBe(true);

    // PublicDomainClaim requires supporting rationale (reviewReason) and exception/details + evidence
    const pdMissingReason: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      licenseType: 'PublicDomainClaim',
      rightsHolder: undefined,
      documentedException: 'Published prior to 1928; copyright expired under statutory term.',
      reviewReason: undefined,
    };
    expect(validateEditorialImageRights(pdMissingReason).valid).toBe(false);

    const pdValid: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      licenseType: 'PublicDomainClaim',
      rightsHolder: undefined,
      documentedException: 'Official government meteorological satellite release in public domain.',
      reviewReason: 'Confirmed statutory public-domain release via agency archive reference.',
    };
    expect(validateEditorialImageRights(pdValid).valid).toBe(true);

    // 12. ContextSpecificAssessment with GeneralEditorial rejected; valid only with ArticleRestricted + articleIds
    const csaWithGeneralScope: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      licenseType: 'ContextSpecificAssessment',
      usageScope: {
        scopeType: 'GeneralEditorial',
      },
      reviewReason: 'Editorial quotation of historical climate summit poster.',
    };
    const csaGeneralRes = validateEditorialImageRights(csaWithGeneralScope);
    expect(csaGeneralRes.valid).toBe(false);
    expect(
      csaGeneralRes.errors.some((e) => e.includes('prohibits GeneralEditorial usageScope'))
    ).toBe(true);

    const csaWithArticleRestricted: EditorialImageRightsRecord = {
      ...syntheticApprovedRightsFixture,
      licenseType: 'ContextSpecificAssessment',
      usageScope: {
        scopeType: 'ArticleRestricted',
        articleIds: ['art_998877', 'news-2026-10'],
      },
      reviewReason: 'Context-specific assessment restricted to summit retrospective articles.',
    };
    expect(validateEditorialImageRights(csaWithArticleRestricted).valid).toBe(true);

    // 13. ArticleRestricted without articleIds (undefined or empty) rejected
    expect(
      validateEditorialImageUsageScope({
        scopeType: 'ArticleRestricted',
      }).valid
    ).toBe(false);

    expect(
      validateEditorialImageUsageScope({
        scopeType: 'ArticleRestricted',
        articleIds: [],
      }).valid
    ).toBe(false);

    expect(
      validateEditorialImageUsageScope({
        scopeType: 'ArticleRestricted',
        articleIds: ['   '],
      }).valid
    ).toBe(false);

    // GeneralEditorial with non-empty articleIds rejected
    expect(
      validateEditorialImageUsageScope({
        scopeType: 'GeneralEditorial',
        articleIds: ['art_998877'],
      }).valid
    ).toBe(false);
  });

  it('31. should enforce Rejected and Revoked decision requirements and reject unknown rights status, unknown nested fields, or unsafe evidenceRefs', () => {
    // 14. Rejected without reason, reviewer, or timestamp rejected
    expect(
      validateEditorialImageRights({
        status: 'Rejected',
        reviewedByUid: 'rights_reviewer_01',
        reviewedAtIso: '2026-10-21T02:00:00.000Z',
      }).valid
    ).toBe(false);

    expect(
      validateEditorialImageRights({
        status: 'Rejected',
        reviewedAtIso: '2026-10-21T02:00:00.000Z',
        reviewReason: 'Unverified source ownership.',
      }).valid
    ).toBe(false);

    expect(
      validateEditorialImageRights({
        status: 'Rejected',
        reviewedByUid: 'rights_reviewer_01',
        reviewedAtIso: '2026-10-21T02:00:00.000Z',
        reviewReason: 'Unverified source ownership.',
      }).valid
    ).toBe(true);

    // 15. Revoked without reason, reviewer, or timestamp rejected
    expect(
      validateEditorialImageRights({
        status: 'Revoked',
        reviewedByUid: 'owner_01',
        reviewedAtIso: '2026-10-21T03:00:00.000Z',
      }).valid
    ).toBe(false);

    expect(
      validateEditorialImageRights({
        status: 'Revoked',
        reviewedByUid: 'owner_01',
        reviewedAtIso: '2026-10-21T03:00:00.000Z',
        reviewReason: 'Agency syndicate license expired and takedown requested.',
      }).valid
    ).toBe(true);

    // 16. Unknown rights status rejected
    const badStatusRes = validateEditorialImageRights({
      status: 'AutoApproved' as any,
    });
    expect(badStatusRes.valid).toBe(false);
    expect(badStatusRes.errors.some((e) => e.includes('rights.status must be one of'))).toBe(true);

    // 17. Unknown nested rights field and unknown usageScope field rejected
    const unknownRightsFieldRes = validateEditorialImageRights({
      ...syntheticApprovedRightsFixture,
      bypassGate: true,
    } as any);
    expect(unknownRightsFieldRes.valid).toBe(false);
    expect(
      unknownRightsFieldRes.errors.some((e) =>
        e.includes('Unexpected or disallowed field "bypassGate" on editorial image rights record.')
      )
    ).toBe(true);

    const unknownScopeFieldRes = validateEditorialImageRights({
      ...syntheticApprovedRightsFixture,
      usageScope: {
        scopeType: 'GeneralEditorial',
        allowPublicCdn: true,
      } as any,
    });
    expect(unknownScopeFieldRes.valid).toBe(false);
    expect(
      unknownScopeFieldRes.errors.some((e) =>
        e.includes('Unexpected or disallowed field "allowPublicCdn" on rights.usageScope.')
      )
    ).toBe(true);

    // 18. URL/token/path/credential evidence reference rejected
    const prohibitedEvidenceSamples = [
      'https://example.com/license.pdf',
      'http://internal/doc',
      'gs://bucket/evidence.pdf',
      'blob:https://example.com/123',
      'data:text/plain;base64,SGVsbG8=',
      'editorial_images/private/img_valid_asset_123/article_inline.webp',
      'folder/subfolder/doc_1',
      '..\\secret\\file',
      'ev_ref?token=abc123',
      'Bearer_eyJhbGciOi',
      'api_key_998877',
      'client_secret_value',
      'ref with spaces',
    ];

    for (const badRef of prohibitedEvidenceSamples) {
      const badEvRes = validateEditorialImageRights({
        ...syntheticApprovedRightsFixture,
        evidenceRefs: [badRef],
      });
      expect(badEvRes.valid).toBe(false);
      expect(badEvRes.errors.some((e) => e.includes('rights.evidenceRefs[0]'))).toBe(true);
    }
  });

  it('32. should reject any generic update attempt touching rights, nested rights fields, or reviewer identity (even when equal to existing value)', () => {
    const baseRecord = createEditorialImageAssetRecord({
      ...validRecordInput,
      createdAtIso: '2026-10-20T10:00:00.000Z',
      updatedAtIso: '2026-10-21T02:00:00.000Z',
    });

    const approvedRecord: EditorialImageAssetMetadata = {
      ...baseRecord,
      rights: JSON.parse(JSON.stringify(syntheticApprovedRightsFixture)),
    };

    // 19. Generic update of rights rejected (both changed and identical to existing)
    expect(() =>
      updateEditorialImageAssetRecord(baseRecord, {
        rights: baseRecord.rights,
      } as any)
    ).toThrow(/cannot modify protected rights or human-review metadata/);

    expect(() =>
      updateEditorialImageAssetRecord(baseRecord, {
        rights: syntheticApprovedRightsFixture,
      } as any)
    ).toThrow(/cannot modify protected rights or human-review metadata/);

    expect(() =>
      updateEditorialImageAssetRecord(approvedRecord, {
        rights: approvedRecord.rights,
      } as any)
    ).toThrow(/cannot modify protected rights or human-review metadata/);

    // 20. Generic update of reviewer identity, timestamps, evidence, or nested rights properties rejected
    const prohibitedRightsPatchKeys: Array<[string, unknown]> = [
      ['reviewedByUid', approvedRecord.rights.reviewedByUid],
      ['reviewedByUid', 'other_reviewer_99'],
      ['reviewedAtIso', approvedRecord.rights.reviewedAtIso],
      ['reviewReason', approvedRecord.rights.reviewReason],
      ['evidenceRefs', approvedRecord.rights.evidenceRefs],
      ['usageScope', approvedRecord.rights.usageScope],
      ['licenseType', approvedRecord.rights.licenseType],
      ['licenseDetails', approvedRecord.rights.licenseDetails],
      ['rightsHolder', approvedRecord.rights.rightsHolder],
      ['documentedException', 'exception'],
      ['sourceAttributionAr', approvedRecord.rights.sourceAttributionAr],
      ['sourceAttributionEn', approvedRecord.rights.sourceAttributionEn],
      ['rights.status', 'Approved'],
    ];

    for (const [key, val] of prohibitedRightsPatchKeys) {
      expect(() =>
        updateEditorialImageAssetRecord(approvedRecord, {
          [key]: val,
        } as any)
      ).toThrow(/cannot modify protected rights or human-review metadata/);
    }
  });

  it('33. should enforce complete rights-review timestamp chronology (createdAtIso <= rights.reviewedAtIso <= updatedAtIso) across Approved, Rejected, Revoked, and PendingReview states', () => {
    const createdAtIso = '2026-10-21T01:00:00.000Z';
    const midReviewIso = '2026-10-21T02:00:00.000Z';
    const updatedAtIso = '2026-10-21T03:00:00.000Z';
    const beforeCreatedIso = '2026-10-21T00:59:59.999Z';
    const afterUpdatedIso = '2026-10-21T03:00:00.001Z';

    const baseAsset = createEditorialImageAssetRecord({
      ...validRecordInput,
      createdAtIso,
      updatedAtIso,
    });

    const rejectedRightsBase: EditorialImageRightsRecord = {
      status: 'Rejected',
      reviewedByUid: 'rights_reviewer_01',
      reviewedAtIso: midReviewIso,
      reviewReason: 'Missing agency syndication proof.',
    };

    const revokedRightsBase: EditorialImageRightsRecord = {
      status: 'Revoked',
      reviewedByUid: 'rights_reviewer_01',
      reviewedAtIso: midReviewIso,
      reviewReason: 'Syndication license expired.',
    };

    // 1. Review before asset creation is rejected (Approved, Rejected, Revoked)
    for (const baseRights of [
      syntheticApprovedRightsFixture,
      rejectedRightsBase,
      revokedRightsBase,
    ]) {
      const beforeRes = validateEditorialImageAsset({
        ...baseAsset,
        rights: {
          ...baseRights,
          reviewedAtIso: beforeCreatedIso,
        },
      });
      expect(beforeRes.valid).toBe(false);
      expect(beforeRes.errors).toContain(
        'rights.reviewedAtIso must be greater than or equal to createdAtIso.'
      );
    }

    // 2. Review after last asset update is rejected (Approved, Rejected, Revoked)
    for (const baseRights of [
      syntheticApprovedRightsFixture,
      rejectedRightsBase,
      revokedRightsBase,
    ]) {
      const afterRes = validateEditorialImageAsset({
        ...baseAsset,
        rights: {
          ...baseRights,
          reviewedAtIso: afterUpdatedIso,
        },
      });
      expect(afterRes.valid).toBe(false);
      expect(afterRes.errors).toContain(
        'rights.reviewedAtIso must be less than or equal to updatedAtIso.'
      );
    }

    // 3. Review equal to asset creation is accepted (Approved, Rejected, Revoked)
    for (const baseRights of [
      syntheticApprovedRightsFixture,
      rejectedRightsBase,
      revokedRightsBase,
    ]) {
      const equalStartRes = validateEditorialImageAsset({
        ...baseAsset,
        rights: {
          ...baseRights,
          reviewedAtIso: createdAtIso,
        },
      });
      expect(equalStartRes.valid).toBe(true);
      expect(equalStartRes.errors).toHaveLength(0);
    }

    // 4. Review equal to last update is accepted (Approved, Rejected, Revoked)
    for (const baseRights of [
      syntheticApprovedRightsFixture,
      rejectedRightsBase,
      revokedRightsBase,
    ]) {
      const equalEndRes = validateEditorialImageAsset({
        ...baseAsset,
        rights: {
          ...baseRights,
          reviewedAtIso: updatedAtIso,
        },
      });
      expect(equalEndRes.valid).toBe(true);
      expect(equalEndRes.errors).toHaveLength(0);
    }

    // 5. Valid Approved chronology is accepted (createdAtIso < reviewedAtIso < updatedAtIso)
    const validApprovedRes = validateEditorialImageAsset({
      ...baseAsset,
      rights: {
        ...syntheticApprovedRightsFixture,
        reviewedAtIso: midReviewIso,
      },
    });
    expect(validApprovedRes.valid).toBe(true);
    expect(validApprovedRes.errors).toHaveLength(0);

    // 6. Valid Rejected chronology is accepted (createdAtIso < reviewedAtIso < updatedAtIso)
    const validRejectedRes = validateEditorialImageAsset({
      ...baseAsset,
      rights: rejectedRightsBase,
    });
    expect(validRejectedRes.valid).toBe(true);
    expect(validRejectedRes.errors).toHaveLength(0);

    // 7. Valid Revoked chronology is accepted (createdAtIso < reviewedAtIso < updatedAtIso)
    const validRevokedRes = validateEditorialImageAsset({
      ...baseAsset,
      rights: revokedRightsBase,
    });
    expect(validRevokedRes.valid).toBe(true);
    expect(validRevokedRes.errors).toHaveLength(0);

    // 8. PendingReview without a review timestamp remains accepted
    const validPendingRes = validateEditorialImageAsset(baseAsset);
    expect(baseAsset.rights).toEqual({ status: 'PendingReview' });
    expect(validPendingRes.valid).toBe(true);
    expect(validPendingRes.errors).toHaveLength(0);

    // 9. Invalid review timestamp format remains rejected
    for (const badReviewedAt of [
      '2026-10-21T02:00:00Z',
      '2026-10-21T02:00:00.000+00:00',
      '2026-02-30T02:00:00.000Z',
      'not-a-timestamp',
    ]) {
      const badFormatRes = validateEditorialImageAsset({
        ...baseAsset,
        rights: {
          ...syntheticApprovedRightsFixture,
          reviewedAtIso: badReviewedAt,
        },
      });
      expect(badFormatRes.valid).toBe(false);
      expect(badFormatRes.errors).toContain(
        'rights.reviewedAtIso must be a valid canonical UTC ISO-8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ).'
      );
    }
  });
});
