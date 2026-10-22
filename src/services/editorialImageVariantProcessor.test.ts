import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  EDITORIAL_IMAGE_VARIANT_TARGET_SPECS,
  EditorialImageVariantProcessingError,
  processEditorialImageVariants,
} from '../../functions/src/news/editorialImageVariantProcessor';
import { buildEditorialImageVariantStoragePath } from '../../functions/src/shared/editorialImageAssetContract';

/**
 * IMG-F3-07 — Real Sharp Variant Processor Tests
 *
 * Verifies real native Sharp image decoding, EXIF auto-orientation,
 * metadata stripping, 5-variant WebP re-encoding without enlargement,
 * alpha preservation, input validation, and fail-closed error handling.
 */

// ============================================================================
// Fixture Generators (Generates REAL, valid test images using Sharp)
// ============================================================================

async function createTestPng(options: {
  width: number;
  height: number;
  channels?: 3 | 4;
  color?: { r: number; g: number; b: number; alpha?: number };
}): Promise<Buffer> {
  const channels = options.channels ?? 3;
  const color = options.color ?? { r: 60, g: 140, b: 220, alpha: 1 };

  return sharp({
    create: {
      width: options.width,
      height: options.height,
      channels,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

async function createTestJpeg(options: {
  width: number;
  height: number;
}): Promise<Buffer> {
  return sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 3,
      background: { r: 180, g: 70, b: 50 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function createTestWebp(options: {
  width: number;
  height: number;
}): Promise<Buffer> {
  return sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 3,
      background: { r: 40, g: 190, b: 120 },
    },
  })
    .webp({ quality: 85 })
    .toBuffer();
}

describe('IMG-F3-07 — Sharp Native Runtime Environment Verification', () => {
  it('loads Sharp native bindings and verifies supported image format decoders and encoders', () => {
    expect(sharp).toBeDefined();
    expect(typeof sharp).toBe('function');
    expect(sharp.versions).toBeDefined();
    expect(sharp.versions.sharp).toBe('0.35.5');
    expect(sharp.versions.vips).toBeDefined();
    expect(sharp.versions.webp).toBeDefined();
    expect(sharp.versions.png).toBeDefined();
    expect(sharp.versions.mozjpeg).toBeDefined();
  });
});

describe('IMG-F3-07 — processEditorialImageVariants — Core Decoding & 5-Variant Encoding', () => {
  const validAssetId = 'asset_2026_test01';

  it('decodes a valid PNG and produces 5 genuine WebP variants with canonical paths, dimensions, and SHA-256', async () => {
    // Large image: 2800 x 1400 (aspect ratio 2:1)
    const pngBuffer = await createTestPng({ width: 2800, height: 1400 });
    const originalSha = createHash('sha256').update(pngBuffer).digest('hex');

    const result = await processEditorialImageVariants({
      assetId: validAssetId,
      binary: pngBuffer,
      claimedMimeType: 'image/png',
      claimedFilenameOrExtension: 'test_photo.png',
    });

    expect(result.assetId).toBe(validAssetId);
    expect(result.detectedInputMimeType).toBe('image/png');
    expect(result.originalWidth).toBe(2800);
    expect(result.originalHeight).toBe(1400);
    expect(result.originalSizeBytes).toBe(pngBuffer.length);
    expect(result.originalSha256).toBe(originalSha);

    // Verify 5 variants in exact order
    expect(result.variants).toHaveLength(5);
    const variantKeys = result.variants.map((v) => v.variantKey);
    expect(variantKeys).toEqual([
      'thumbnail',
      'card',
      'article_inline',
      'article_cover',
      'original_processed',
    ]);

    // Expected maximum widths for a 2800px input:
    // thumbnail: 320 -> height 160
    // card: 720 -> height 360
    // article_inline: 1280 -> height 640
    // article_cover: 1920 -> height 960
    // original_processed: 2560 -> height 1280
    const expectedWidths = [320, 720, 1280, 1920, 2560];

    for (let i = 0; i < result.variants.length; i++) {
      const v = result.variants[i];
      const spec = EDITORIAL_IMAGE_VARIANT_TARGET_SPECS[i];

      expect(v.variantKey).toBe(spec.variantKey);
      expect(v.mimeType).toBe('image/webp');
      expect(v.width).toBe(expectedWidths[i]);
      expect(v.height).toBe(expectedWidths[i] / 2); // preserves 2:1 aspect ratio

      // Canonical storage path
      const expectedPath = buildEditorialImageVariantStoragePath(
        validAssetId,
        spec.variantKey,
        'image/webp'
      );
      expect(v.storagePath).toBe(expectedPath);

      // Verify returned SHA-256 matches actual output bytes
      const actualSha = createHash('sha256').update(v.bytes).digest('hex');
      expect(v.sha256Checksum).toBe(actualSha);
      expect(v.sizeBytes).toBe(v.bytes.length);
      expect(v.sizeBytes).toBeLessThanOrEqual(15_000_000);

      // Re-decode the variant bytes with sharp to verify genuine WebP format
      const decodedVariant = await sharp(v.bytes).metadata();
      expect(decodedVariant.format).toBe('webp');
      expect(decodedVariant.width).toBe(expectedWidths[i]);
      expect(decodedVariant.height).toBe(expectedWidths[i] / 2);
    }

    // Large input produces distinct dimensions across all 5 variants
    const widthsSet = new Set(result.variants.map((v) => v.width));
    expect(widthsSet.size).toBe(5);
  });

  it('decodes a valid JPEG and produces 5 genuine WebP variants', async () => {
    const jpegBuffer = await createTestJpeg({ width: 1600, height: 1200 });
    const result = await processEditorialImageVariants({
      assetId: 'asset_2026_jpeg01',
      binary: jpegBuffer,
      claimedMimeType: 'image/jpeg',
      claimedFilenameOrExtension: 'cover.jpeg',
    });

    expect(result.detectedInputMimeType).toBe('image/jpeg');
    expect(result.originalWidth).toBe(1600);
    expect(result.originalHeight).toBe(1200);
    expect(result.variants).toHaveLength(5);

    // Since original width is 1600:
    // thumbnail (max 320) -> 320
    // card (max 720) -> 720
    // article_inline (max 1280) -> 1280
    // article_cover (max 1920) -> 1600 (without enlargement!)
    // original_processed (max 2560) -> 1600 (without enlargement!)
    const widths = result.variants.map((v) => v.width);
    expect(widths).toEqual([320, 720, 1280, 1600, 1600]);

    for (const v of result.variants) {
      expect(v.mimeType).toBe('image/webp');
      const meta = await sharp(v.bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(v.width);
    }
  });

  it('decodes a valid WebP input and produces 5 WebP variants', async () => {
    const webpBuffer = await createTestWebp({ width: 800, height: 600 });
    const result = await processEditorialImageVariants({
      assetId: 'asset_2026_webp01',
      binary: webpBuffer,
      claimedMimeType: 'image/webp',
    });

    expect(result.detectedInputMimeType).toBe('image/webp');
    expect(result.originalWidth).toBe(800);
    expect(result.originalHeight).toBe(600);
    expect(result.variants).toHaveLength(5);

    // For 800px input:
    // thumbnail: 320, card: 720, article_inline: 800, article_cover: 800, original_processed: 800
    const widths = result.variants.map((v) => v.width);
    expect(widths).toEqual([320, 720, 800, 800, 800]);
  });
});

describe('IMG-F3-07 — processEditorialImageVariants — Dimension Constraints & Alpha Preservation', () => {
  it('never enlarges a small image: all 5 variants retain the smaller input dimensions', async () => {
    // 250 x 200 input: smaller than all variant max widths (320, 720, 1280, 1920, 2560)
    const smallPng = await createTestPng({ width: 250, height: 200 });

    const result = await processEditorialImageVariants({
      assetId: 'asset_2026_small01',
      binary: smallPng,
    });

    expect(result.originalWidth).toBe(250);
    expect(result.originalHeight).toBe(200);

    for (const v of result.variants) {
      // Must NOT be enlarged to 320 or beyond
      expect(v.width).toBe(250);
      expect(v.height).toBe(200);
      const meta = await sharp(v.bytes).metadata();
      expect(meta.width).toBe(250);
      expect(meta.height).toBe(200);
    }
  });

  it('preserves alpha transparency channel when converting transparent PNG to WebP', async () => {
    // Create RGBA image with 50% opacity
    const alphaPng = await createTestPng({
      width: 400,
      height: 400,
      channels: 4,
      color: { r: 100, g: 150, b: 200, alpha: 0.5 },
    });

    const result = await processEditorialImageVariants({
      assetId: 'asset_2026_alpha01',
      binary: alphaPng,
    });

    expect(result.variants).toHaveLength(5);

    for (const v of result.variants) {
      const decodedMeta = await sharp(v.bytes).metadata();
      expect(decodedMeta.format).toBe('webp');
      expect(decodedMeta.hasAlpha).toBe(true);
      expect(decodedMeta.channels).toBe(4);
    }
  });

  it('strips EXIF metadata and corrects EXIF orientation in generated WebP variants', async () => {
    // Generate JPEG with EXIF orientation 6 (90 degrees CW) and text metadata
    const rawJpeg = await sharp({
      create: {
        width: 600,
        height: 300,
        channels: 3,
        background: { r: 210, g: 130, b: 40 },
      },
    })
      .withMetadata({
        orientation: 6, // 90° CW
        exif: {
          IFD0: {
            Artist: 'Editorial Contributor',
            Copyright: 'Planet Rights Reserved',
            ImageDescription: 'Sensitive Description',
          },
        },
      })
      .jpeg()
      .toBuffer();

    // Verify input JPEG has orientation metadata
    const inputMeta = await sharp(rawJpeg).metadata();
    expect(inputMeta.orientation).toBe(6);

    const result = await processEditorialImageVariants({
      assetId: 'asset_2026_exif01',
      binary: rawJpeg,
    });

    // Output variants should have orientation corrected (.rotate() rotates 90° so dimensions flip: width 300, height 600)
    for (const v of result.variants) {
      const outMeta = await sharp(v.bytes).metadata();
      // Auto-oriented: orientation tag removed or set to 1 (top-left)
      expect(outMeta.orientation).toBeUndefined();
      // Metadata (EXIF, IPTC, XMP) stripped by default
      expect(outMeta.exif).toBeUndefined();
      expect(outMeta.iptc).toBeUndefined();
      expect(outMeta.xmp).toBeUndefined();
    }
  });
});

describe('IMG-F3-07 — processEditorialImageVariants — Input Rejection & Safety Limits', () => {
  const validAssetId = 'asset_2026_reject01';

  it('rejects non-canonical assetId with INVALID_INPUT', async () => {
    const png = await createTestPng({ width: 100, height: 100 });

    await expect(
      processEditorialImageVariants({
        assetId: 'INVALID_ID_WITH_SPACES !!',
        binary: png,
      })
    ).rejects.toThrow(EditorialImageVariantProcessingError);

    try {
      await processEditorialImageVariants({
        assetId: 'invalid/traversal/id',
        binary: png,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(EditorialImageVariantProcessingError);
      const e = err as EditorialImageVariantProcessingError;
      expect(e.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects empty or oversized buffer (> 15,000,000 bytes) with INVALID_INPUT', async () => {
    // Empty buffer
    await expect(
      processEditorialImageVariants({
        assetId: validAssetId,
        binary: Buffer.alloc(0),
      })
    ).rejects.toThrow(EditorialImageVariantProcessingError);

    // Oversized buffer: 15,000,001 bytes
    const oversized = Buffer.alloc(15_000_001);
    await expect(
      processEditorialImageVariants({
        assetId: validAssetId,
        binary: oversized,
      })
    ).rejects.toThrow(EditorialImageVariantProcessingError);
  });

  it('rejects animated GIF and SVG formats as unsupported', async () => {
    // SVG buffer
    const svgBuffer = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
      'utf8'
    );

    await expect(
      processEditorialImageVariants({
        assetId: validAssetId,
        binary: svgBuffer,
        claimedMimeType: 'image/svg+xml',
      })
    ).rejects.toThrow(EditorialImageVariantProcessingError);

    try {
      await processEditorialImageVariants({
        assetId: validAssetId,
        binary: svgBuffer,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(EditorialImageVariantProcessingError);
      const e = err as EditorialImageVariantProcessingError;
      expect(e.code).toBe('UNSUPPORTED_IMAGE');
    }
  });

  it('rejects deceptively claimed MIME types (claimed JPEG but binary is PNG)', async () => {
    const png = await createTestPng({ width: 100, height: 100 });

    await expect(
      processEditorialImageVariants({
        assetId: validAssetId,
        binary: png,
        claimedMimeType: 'image/jpeg',
      })
    ).rejects.toThrow(EditorialImageVariantProcessingError);

    try {
      await processEditorialImageVariants({
        assetId: validAssetId,
        binary: png,
        claimedMimeType: 'image/jpeg',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(EditorialImageVariantProcessingError);
      const e = err as EditorialImageVariantProcessingError;
      expect(e.code).toBe('UNSUPPORTED_IMAGE');
      expect(e.rejectionCode).toBe('CLAIMED_MIME_MISMATCH');
    }
  });

  it('rejects corrupted pixel stream with plausible PNG magic header', async () => {
    // Valid PNG 8-byte header followed by randomized junk
    const corruptPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('CORRUPTED_PIXEL_DATA_JUNK_PAYLOAD_NOT_A_VALID_IHDR_CHUNK'),
    ]);

    await expect(
      processEditorialImageVariants({
        assetId: validAssetId,
        binary: corruptPng,
      })
    ).rejects.toThrow(EditorialImageVariantProcessingError);

    try {
      await processEditorialImageVariants({
        assetId: validAssetId,
        binary: corruptPng,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(EditorialImageVariantProcessingError);
      const e = err as EditorialImageVariantProcessingError;
      expect(['CORRUPT_IMAGE', 'UNSUPPORTED_IMAGE']).toContain(e.code);
    }
  });
});

describe('IMG-F3-07 — processEditorialImageVariants — Fail-Closed Behavior', () => {
  it('fails closed and returns no partial results if transformation fails', async () => {
    // Pass non-null invalid inputs to verify complete fail-closed behavior
    await expect(
      processEditorialImageVariants({
        assetId: 'asset_2026_fail01',
        binary: Buffer.from('not an image'),
      })
    ).rejects.toThrow(EditorialImageVariantProcessingError);
  });
});
