import { afterEach, describe, expect, it, vi } from 'vitest';
import * as clientTypes from '../../../src/types/editorialImageAsset';
import * as clientContract from '../../../src/services/editorialImageAssetContract';
import * as serverTypes from '../types/editorialImageAsset';
import * as serverContract from './editorialImageAssetContract';
import type {
  CreateEditorialImageAssetInput,
  EditorialImageAssetMetadata,
  EditorialImageAssetVariant,
  EditorialImageRightsRecord,
} from '../types/editorialImageAsset';

function captureOutcome<T>(fn: () => T): { ok: true; value: T } | { ok: false; message: string } {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

describe('IMG-F3-02A Server EditorialImageAssetContract Parity Suite', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  const validCreateInput: CreateEditorialImageAssetInput = {
    assetId: 'img_valid_asset_123',
    createdByUid: 'admin_user_99',
    createdAtIso: '2026-10-20T10:00:00.000Z',
    updatedAtIso: '2026-10-20T10:00:00.000Z',
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

  const approvedRightsRecord: EditorialImageRightsRecord = {
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
    reviewedAtIso: '2026-10-21T01:00:00.000Z',
    reviewReason: 'Verified written syndication agreement and agency invoice.',
  };

  it('0. exports identical constants, regex patterns, and default validation limits', () => {
    expect(serverTypes.CANONICAL_ASSET_ID_REGEX.source).toBe(
      clientTypes.CANONICAL_ASSET_ID_REGEX.source
    );
    expect(serverTypes.CANONICAL_EDITORIAL_IMAGE_STORAGE_PREFIX).toBe(
      clientTypes.CANONICAL_EDITORIAL_IMAGE_STORAGE_PREFIX
    );
    expect(serverTypes.CANONICAL_SHA256_CHECKSUM_REGEX.source).toBe(
      clientTypes.CANONICAL_SHA256_CHECKSUM_REGEX.source
    );
    expect(serverTypes.CANONICAL_UTC_TIMESTAMP_REGEX.source).toBe(
      clientTypes.CANONICAL_UTC_TIMESTAMP_REGEX.source
    );
    expect(serverTypes.MAX_IMAGE_DIMENSION_PX).toBe(clientTypes.MAX_IMAGE_DIMENSION_PX);
    expect(serverTypes.DEFAULT_ASSET_VALIDATION_LIMITS).toEqual(
      clientTypes.DEFAULT_ASSET_VALIDATION_LIMITS
    );
    expect(Object.keys(serverContract).sort()).toEqual(Object.keys(clientContract).sort());
  });

  it('1. Valid PendingReview asset parity', () => {
    const clientAsset = clientContract.createEditorialImageAssetRecord(validCreateInput);
    const serverAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);

    expect(serverAsset).toEqual(clientAsset);
    expect(serverAsset.rights).toEqual({ status: 'PendingReview' });

    const clientVal = clientContract.validateEditorialImageAsset(clientAsset);
    const serverVal = serverContract.validateEditorialImageAsset(serverAsset);

    expect(serverVal).toEqual(clientVal);
    expect(serverVal.valid).toBe(true);
    expect(serverVal.errors).toEqual([]);
  });

  it('2. Invalid assetId parity (including 1..128 boundary checks)', () => {
    const samples: unknown[] = [
      '',
      '   ',
      'a'.repeat(129),
      ' img_valid_asset_123',
      'img_valid_asset_123 ',
      'invalid asset space',
      'asset@with$special!',
      'https://example.com/image.png',
      null,
      12345,
      'a',
      'x'.repeat(128),
    ];

    for (const candidateId of samples) {
      const clientRes = clientContract.validateAssetId(candidateId);
      const serverRes = serverContract.validateAssetId(candidateId);
      expect(serverRes).toEqual(clientRes);
    }

    const baseAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);
    const invalidAsset = { ...baseAsset, assetId: 'bad asset id!' };
    const clientAssetRes = clientContract.validateEditorialImageAsset(invalidAsset);
    const serverAssetRes = serverContract.validateEditorialImageAsset(invalidAsset);
    expect(serverAssetRes).toEqual(clientAssetRes);
    expect(serverAssetRes.valid).toBe(false);
  });

  it('3. Missing or malformed SHA-256 parity on original and variants', () => {
    const checksumSamples: unknown[] = [
      undefined,
      '',
      'e3b0c44298fc1c149afbf4c8996fb924', // too short
      VALID_ASSET_SHA256.toUpperCase(), // uppercase disallowed
      'g'.repeat(64), // non-hex
      VALID_ASSET_SHA256,
    ];

    for (const sample of checksumSamples) {
      expect(serverContract.validateSha256Checksum(sample)).toEqual(
        clientContract.validateSha256Checksum(sample)
      );
    }

    const baseAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);
    const badOriginalChecksumAsset = {
      ...baseAsset,
      sha256Checksum: 'invalid_sha256',
    };
    expect(serverContract.validateEditorialImageAsset(badOriginalChecksumAsset)).toEqual(
      clientContract.validateEditorialImageAsset(badOriginalChecksumAsset)
    );

    const badVariantChecksumAsset: EditorialImageAssetMetadata = {
      ...baseAsset,
      variants: {
        article_inline: {
          ...validVariant,
          sha256Checksum: VALID_VARIANT_SHA256.toUpperCase(),
        },
      },
    };
    const serverVarRes = serverContract.validateEditorialImageAsset(badVariantChecksumAsset);
    const clientVarRes = clientContract.validateEditorialImageAsset(badVariantChecksumAsset);
    expect(serverVarRes).toEqual(clientVarRes);
    expect(serverVarRes.valid).toBe(false);
  });

  it('4. Invalid original or variant dimensions and size parity', () => {
    const baseAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);

    const invalidDimensionAssets: unknown[] = [
      { ...baseAsset, originalWidth: 0 },
      { ...baseAsset, originalHeight: -10 },
      { ...baseAsset, originalWidth: 10_001 },
      { ...baseAsset, originalHeight: 1200.5 },
      { ...baseAsset, originalWidth: Number.NaN },
      { ...baseAsset, originalHeight: Number.POSITIVE_INFINITY },
      { ...baseAsset, aspectRatio: 0.5 }, // mismatch with 3000/2000 = 1.5
      { ...baseAsset, originalSizeBytes: 0 },
      { ...baseAsset, originalSizeBytes: 20_000_000 },
      {
        ...baseAsset,
        variants: {
          article_inline: { ...validVariant, width: 0, height: 10_001, sizeBytes: -5 },
        },
      },
    ];

    for (const candidate of invalidDimensionAssets) {
      const clientRes = clientContract.validateEditorialImageAsset(candidate);
      const serverRes = serverContract.validateEditorialImageAsset(candidate);
      expect(serverRes).toEqual(clientRes);
      expect(serverRes.valid).toBe(false);
    }
  });

  it('5. Incorrect private storage path and MIME/extension binding parity', () => {
    expect(
      serverContract.buildEditorialImageVariantStoragePath(
        'img_valid_asset_123',
        'article_inline',
        'image/webp'
      )
    ).toBe(
      clientContract.buildEditorialImageVariantStoragePath(
        'img_valid_asset_123',
        'article_inline',
        'image/webp'
      )
    );

    const pathSamples: Array<[unknown, serverContract.ValidateEditorialImageStoragePathOptions]> = [
      [
        'editorial_images/public/img_valid_asset_123/article_inline.webp',
        { expectedAssetId: 'img_valid_asset_123', expectedVariantKey: 'article_inline', expectedMimeType: 'image/webp' },
      ],
      [
        'https://storage.googleapis.com/bucket/editorial_images/private/img_valid_asset_123/article_inline.webp',
        { expectedAssetId: 'img_valid_asset_123' },
      ],
      [
        'editorial_images/private/img_valid_asset_123/article_inline.webp?alt=media&token=abc',
        { expectedAssetId: 'img_valid_asset_123' },
      ],
      [
        'editorial_images/private/../img_valid_asset_123/article_inline.webp',
        { expectedAssetId: 'img_valid_asset_123' },
      ],
      [
        'editorial_images/private/other_asset_999/article_inline.webp',
        { expectedAssetId: 'img_valid_asset_123', expectedVariantKey: 'article_inline', expectedMimeType: 'image/webp' },
      ],
      [
        'editorial_images/private/img_valid_asset_123/thumbnail.webp',
        { expectedAssetId: 'img_valid_asset_123', expectedVariantKey: 'article_inline', expectedMimeType: 'image/webp' },
      ],
      [
        'editorial_images/private/img_valid_asset_123/article_inline.png',
        { expectedAssetId: 'img_valid_asset_123', expectedVariantKey: 'article_inline', expectedMimeType: 'image/webp' },
      ],
    ];

    for (const [pathValue, opts] of pathSamples) {
      const clientRes = clientContract.validateEditorialImageStoragePath(pathValue, opts);
      const serverRes = serverContract.validateEditorialImageStoragePath(pathValue, opts);
      expect(serverRes).toEqual(clientRes);
      expect(serverRes.valid).toBe(false);
    }
  });

  it('6. Unexpected field fail-closed rejection parity across asset, rights, usageScope, and variants', () => {
    const baseAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);

    const pollutedSamples: unknown[] = [
      { ...baseAsset, unexpectedRootField: true },
      { ...baseAsset, rights: { ...baseAsset.rights, extraRightsFlag: 'bypass' } },
      {
        ...baseAsset,
        rights: {
          ...approvedRightsRecord,
          usageScope: { scopeType: 'GeneralEditorial', extraScopeProp: 1 },
        },
        updatedAtIso: '2026-10-21T02:00:00.000Z',
      },
      {
        ...baseAsset,
        variants: {
          article_inline: { ...validVariant, downloadUrl: 'https://example.com/a.webp' },
        },
      },
      {
        ...baseAsset,
        variants: {
          ...baseAsset.variants,
          unknown_variant_slot: validVariant,
        },
      },
    ];

    for (const sample of pollutedSamples) {
      const clientRes = clientContract.validateEditorialImageAsset(sample);
      const serverRes = serverContract.validateEditorialImageAsset(sample);
      expect(serverRes).toEqual(clientRes);
      expect(serverRes.valid).toBe(false);
    }
  });

  it('7. Structurally valid Approved rights metadata parity', () => {
    const baseAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);

    const validRightsVariants: EditorialImageRightsRecord[] = [
      approvedRightsRecord,
      {
        ...approvedRightsRecord,
        licenseType: 'CreativeCommons',
        licenseDetails: 'CC-BY-SA-4.0',
      },
      {
        ...approvedRightsRecord,
        licenseType: 'ContextSpecificAssessment',
        documentedException: 'Fair-dealing archival documentation under editorial policy §4.2',
        usageScope: {
          scopeType: 'ArticleRestricted',
          articleIds: ['art_998877'],
        },
      },
      {
        status: 'Rejected',
        reviewedByUid: 'rights_reviewer_01',
        reviewedAtIso: '2026-10-21T01:00:00.000Z',
        reviewReason: 'Unverified copyright claim.',
      },
      {
        status: 'Revoked',
        reviewedByUid: 'rights_reviewer_01',
        reviewedAtIso: '2026-10-21T01:00:00.000Z',
        reviewReason: 'Rightsholder withdrew permission.',
      },
    ];

    for (const rights of validRightsVariants) {
      const assetWithRights: EditorialImageAssetMetadata = {
        ...baseAsset,
        updatedAtIso: '2026-10-21T02:00:00.000Z',
        rights,
      };
      const clientRes = clientContract.validateEditorialImageAsset(assetWithRights);
      const serverRes = serverContract.validateEditorialImageAsset(assetWithRights);
      expect(serverRes).toEqual(clientRes);
      expect(serverRes.valid).toBe(true);
    }
  });

  it('8. Incomplete Approved rights metadata parity', () => {
    const incompleteRightsSamples: unknown[] = [
      { status: 'Approved' },
      {
        ...approvedRightsRecord,
        licenseType: 'CreativeCommons',
        licenseDetails: 'Creative Commons', // generic label prohibited
      },
      {
        ...approvedRightsRecord,
        evidenceRefs: [], // empty evidenceRefs prohibited
      },
      {
        ...approvedRightsRecord,
        evidenceRefs: ['https://example.com/secret?token=123'], // URL/token prohibited in evidenceRefs
      },
      {
        ...approvedRightsRecord,
        licenseType: 'ContextSpecificAssessment',
        usageScope: { scopeType: 'GeneralEditorial' }, // requires ArticleRestricted
      },
      {
        ...approvedRightsRecord,
        sourceAttributionAr: '   ',
      },
      {
        ...approvedRightsRecord,
        reviewedByUid: undefined,
      },
    ];

    for (const badRights of incompleteRightsSamples) {
      const clientRes = clientContract.validateEditorialImageRights(badRights);
      const serverRes = serverContract.validateEditorialImageRights(badRights);
      expect(serverRes).toEqual(clientRes);
      expect(serverRes.valid).toBe(false);
    }
  });

  it('9. Invalid rights-review chronology parity (createdAtIso <= rights.reviewedAtIso <= updatedAtIso)', () => {
    const baseAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);

    const chronologyCases: EditorialImageAssetMetadata[] = [
      // reviewedAtIso < createdAtIso
      {
        ...baseAsset,
        createdAtIso: '2026-10-20T10:00:00.000Z',
        updatedAtIso: '2026-10-21T02:00:00.000Z',
        rights: {
          ...approvedRightsRecord,
          reviewedAtIso: '2026-10-20T09:59:59.999Z',
        },
      },
      // reviewedAtIso > updatedAtIso (Approved)
      {
        ...baseAsset,
        createdAtIso: '2026-10-20T10:00:00.000Z',
        updatedAtIso: '2026-10-21T01:00:00.000Z',
        rights: {
          ...approvedRightsRecord,
          reviewedAtIso: '2026-10-21T01:00:00.001Z',
        },
      },
      // reviewedAtIso > updatedAtIso (Rejected)
      {
        ...baseAsset,
        createdAtIso: '2026-10-20T10:00:00.000Z',
        updatedAtIso: '2026-10-21T01:00:00.000Z',
        rights: {
          status: 'Rejected',
          reviewedByUid: 'rights_reviewer_01',
          reviewedAtIso: '2026-10-21T02:00:00.000Z',
          reviewReason: 'Rejected after insufficient proof.',
        },
      },
      // reviewedAtIso > updatedAtIso (Revoked)
      {
        ...baseAsset,
        createdAtIso: '2026-10-20T10:00:00.000Z',
        updatedAtIso: '2026-10-21T01:00:00.000Z',
        rights: {
          status: 'Revoked',
          reviewedByUid: 'rights_reviewer_01',
          reviewedAtIso: '2026-10-21T02:00:00.000Z',
          reviewReason: 'Revoked license.',
        },
      },
      // Exact boundary equality: createdAtIso === reviewedAtIso === updatedAtIso (valid)
      {
        ...baseAsset,
        createdAtIso: '2026-10-21T01:00:00.000Z',
        updatedAtIso: '2026-10-21T01:00:00.000Z',
        rights: {
          ...approvedRightsRecord,
          reviewedAtIso: '2026-10-21T01:00:00.000Z',
        },
      },
    ];

    for (const testCase of chronologyCases) {
      const clientRes = clientContract.validateEditorialImageAsset(testCase);
      const serverRes = serverContract.validateEditorialImageAsset(testCase);
      expect(serverRes).toEqual(clientRes);
    }

    expect(serverContract.validateEditorialImageAsset(chronologyCases[0]).valid).toBe(false);
    expect(serverContract.validateEditorialImageAsset(chronologyCases[1]).valid).toBe(false);
    expect(serverContract.validateEditorialImageAsset(chronologyCases[2]).valid).toBe(false);
    expect(serverContract.validateEditorialImageAsset(chronologyCases[3]).valid).toBe(false);
    expect(serverContract.validateEditorialImageAsset(chronologyCases[4]).valid).toBe(true);
  });

  it('10. Prohibited generic rights update and creation bypass parity', () => {
    const baseAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);

    const prohibitedUpdatePatches: Array<Record<string, unknown>> = [
      { rights: approvedRightsRecord },
      { 'rights.status': 'Approved' },
      { rightsStatus: 'Approved' },
      { reviewedByUid: 'admin_1' },
      { reviewedAtIso: '2026-10-21T01:00:00.000Z' },
      { isApproved: true },
      { assetId: 'new_asset_id' },
      { sha256Checksum: VALID_VARIANT_SHA256 },
      { status: 'archived' },
      { variants: {} },
    ];

    for (const badPatch of prohibitedUpdatePatches) {
      const clientOutcome = captureOutcome(() =>
        clientContract.updateEditorialImageAssetRecord(baseAsset, badPatch as any)
      );
      const serverOutcome = captureOutcome(() =>
        serverContract.updateEditorialImageAssetRecord(baseAsset, badPatch as any)
      );
      expect(serverOutcome).toEqual(clientOutcome);
      expect(serverOutcome.ok).toBe(false);
    }

    const prohibitedCreateInput = {
      ...validCreateInput,
      rights: approvedRightsRecord,
    };
    const clientCreateOutcome = captureOutcome(() =>
      clientContract.createEditorialImageAssetRecord(prohibitedCreateInput as any)
    );
    const serverCreateOutcome = captureOutcome(() =>
      serverContract.createEditorialImageAssetRecord(prohibitedCreateInput as any)
    );
    expect(serverCreateOutcome).toEqual(clientCreateOutcome);
    expect(serverCreateOutcome.ok).toBe(false);
  });

  it('11. Invalid sanitization input parity', () => {
    const baseAsset = serverContract.createEditorialImageAssetRecord(validCreateInput);
    const invalidSanitizeInputs: unknown[] = [
      null,
      { ...baseAsset, altAr: '' },
      { ...baseAsset, injectedField: 'evil' },
      {
        ...baseAsset,
        rights: {
          ...approvedRightsRecord,
          reviewedAtIso: '2026-10-25T00:00:00.000Z', // > updatedAtIso
        },
      },
    ];

    for (const invalidInput of invalidSanitizeInputs) {
      const clientOutcome = captureOutcome(() =>
        clientContract.sanitizeEditorialImageAssetMetadata(invalidInput as any)
      );
      const serverOutcome = captureOutcome(() =>
        serverContract.sanitizeEditorialImageAssetMetadata(invalidInput as any)
      );
      expect(serverOutcome).toEqual(clientOutcome);
      expect(serverOutcome.ok).toBe(false);
    }
  });

  it('12. Valid creation and update preserving expected fields and immutability parity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T04:30:00.000Z'));

    const clientCreated = clientContract.createEditorialImageAssetRecord(validCreateInput);
    const serverCreated = serverContract.createEditorialImageAssetRecord(validCreateInput);
    expect(serverCreated).toEqual(clientCreated);

    // Promote both records to identical valid Approved state and apply generic editorial update
    const approvedBaseClient: EditorialImageAssetMetadata = {
      ...clientCreated,
      updatedAtIso: '2026-10-21T02:00:00.000Z',
      rights: JSON.parse(JSON.stringify(approvedRightsRecord)),
    };
    const approvedBaseServer: EditorialImageAssetMetadata = {
      ...serverCreated,
      updatedAtIso: '2026-10-21T02:00:00.000Z',
      rights: JSON.parse(JSON.stringify(approvedRightsRecord)),
    };

    const updateInput = {
      altAr: 'نص بديل محدث للصورة التحريرية',
      altEn: 'Updated editorial image alt text',
      captionAr: undefined,
      tags: ['updated_tag_1', 'updated_tag_2'],
      associatedArticleIds: ['art_998877', 'art_112233'],
    };

    const clientUpdated = clientContract.updateEditorialImageAssetRecord(
      approvedBaseClient,
      updateInput
    );
    const serverUpdated = serverContract.updateEditorialImageAssetRecord(
      approvedBaseServer,
      updateInput
    );

    expect(serverUpdated).toEqual(clientUpdated);
    expect(serverUpdated.updatedAtIso).toBe('2026-10-21T04:30:00.000Z');
    expect(serverUpdated.captionAr).toBeUndefined();
    expect(serverUpdated.rights).toEqual(approvedRightsRecord);
    expect(serverUpdated.sha256Checksum).toBe(VALID_ASSET_SHA256);

    const clientSanitized = clientContract.sanitizeEditorialImageAssetMetadata(clientUpdated);
    const serverSanitized = serverContract.sanitizeEditorialImageAssetMetadata(serverUpdated);
    expect(serverSanitized).toEqual(clientSanitized);
  });
});
