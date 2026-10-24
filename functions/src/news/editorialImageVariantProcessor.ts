import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as sharpNamespace from 'sharp';
import type { Metadata as SharpMetadata } from 'sharp';

const sharp = (
  typeof sharpNamespace === 'function'
    ? sharpNamespace
    : sharpNamespace.default
) as unknown as typeof sharpNamespace.default;
import {
  buildEditorialImageVariantStoragePath,
  validateAssetId,
} from '../shared/editorialImageAssetContract';
import {
  inspectEditorialImageBinary,
  type EditorialBinaryRejectionCode,
} from './editorialBinaryInspector';
import {
  type EditorialImageAssetVariantFormat,
  type EditorialImageAssetVariantKey,
} from '../types/editorialImageAsset';

/**
 * IMG-F3-07 — Editorial Image Variant Processor
 *
 * STANDALONE SERVER-SIDE PROCESSOR FOUNDATION:
 * - Genuine pixel decoding and WebP re-encoding via Sharp native pipeline.
 * - Enforces 15,000,000-byte input limit and 25,000,000-pixel processing limit.
 * - Auto-orients per EXIF and strips all EXIF/GPS/XMP/IPTC metadata.
 * - Produces 5 canonical WebP variants without enlargement.
 * - Bounded sequential transformations with 15-second operation timeout.
 * - Fail-closed: any failure rejects the entire request (never partial results).
 * - Read-only: zero GCS or Firestore operations, no public URLs.
 */

export type EditorialImageVariantProcessorErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_IMAGE'
  | 'CORRUPT_IMAGE'
  | 'PROCESSING_FAILURE'
  | 'OUTPUT_VALIDATION_FAILED';

export class EditorialImageVariantProcessingError extends Error {
  public readonly code: EditorialImageVariantProcessorErrorCode;
  public readonly assetId?: string;
  public readonly rejectionCode?: EditorialBinaryRejectionCode;
  public readonly details: readonly string[];

  constructor(params: {
    code: EditorialImageVariantProcessorErrorCode;
    message: string;
    assetId?: string;
    rejectionCode?: EditorialBinaryRejectionCode;
    details?: readonly string[];
  }) {
    super(params.message);
    this.name = 'EditorialImageVariantProcessingError';
    this.code = params.code;
    this.assetId = params.assetId;
    this.rejectionCode = params.rejectionCode;
    this.details = Object.freeze([...(params.details ?? [params.message])]);
    Object.setPrototypeOf(this, EditorialImageVariantProcessingError.prototype);
  }
}

export interface ProcessEditorialImageVariantsInput {
  readonly assetId: string;
  readonly binary: Buffer;
  readonly claimedMimeType?: string;
  readonly claimedFilenameOrExtension?: string;
}

export interface ProcessedEditorialImageVariant {
  readonly variantKey: EditorialImageAssetVariantKey;
  readonly storagePath: string;
  readonly mimeType: 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly sha256Checksum: string;
  readonly bytes: Buffer;
}

export interface ProcessEditorialImageVariantsResult {
  readonly assetId: string;
  readonly detectedInputMimeType: EditorialImageAssetVariantFormat;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly originalSizeBytes: number;
  readonly originalSha256: string;
  readonly variants: readonly ProcessedEditorialImageVariant[];
}

interface VariantTargetSpec {
  readonly variantKey: EditorialImageAssetVariantKey;
  readonly maxWidth: number;
}

export const EDITORIAL_IMAGE_VARIANT_TARGET_SPECS: readonly VariantTargetSpec[] =
  Object.freeze([
    { variantKey: 'thumbnail', maxWidth: 320 },
    { variantKey: 'card', maxWidth: 720 },
    { variantKey: 'article_inline', maxWidth: 1280 },
    { variantKey: 'article_cover', maxWidth: 1920 },
    { variantKey: 'original_processed', maxWidth: 2560 },
  ]);

export const MAX_PROCESSOR_INPUT_BYTES = 15_000_000 as const;
export const MAX_PROCESSOR_PIXELS = 25_000_000 as const;
export const PROCESSOR_TIMEOUT_SECONDS = 15 as const;

/**
 * Processes an input image buffer into 5 canonical WebP variants.
 *
 * Fully decodes pixels using Sharp, corrects EXIF orientation, strips sensitive
 * metadata, resizes without enlargement, re-encodes to WebP, and validates
 * each output independently.
 */
export async function processEditorialImageVariants(
  input: ProcessEditorialImageVariantsInput
): Promise<ProcessEditorialImageVariantsResult> {
  // 1. Basic structural input validation
  if (!input || typeof input !== 'object') {
    throw new EditorialImageVariantProcessingError({
      code: 'INVALID_INPUT',
      message: 'Input parameter must be a non-null object.',
    });
  }

  const assetIdValidation = validateAssetId(input.assetId);
  if (!assetIdValidation.valid) {
    throw new EditorialImageVariantProcessingError({
      code: 'INVALID_INPUT',
      message: `Invalid canonical assetId: ${assetIdValidation.errors.join(' ')}`,
      assetId: typeof input.assetId === 'string' ? input.assetId : undefined,
    });
  }

  if (!Buffer.isBuffer(input.binary) || input.binary.length === 0) {
    throw new EditorialImageVariantProcessingError({
      code: 'INVALID_INPUT',
      message: 'Input image binary must be a non-empty Buffer.',
      assetId: input.assetId,
    });
  }

  if (input.binary.length > MAX_PROCESSOR_INPUT_BYTES) {
    throw new EditorialImageVariantProcessingError({
      code: 'INVALID_INPUT',
      message: `Input image binary exceeds maximum allowed limit of ${MAX_PROCESSOR_INPUT_BYTES} bytes (received ${input.binary.length} bytes).`,
      assetId: input.assetId,
    });
  }

  // 2. Preliminary inspector check (magic bytes, headers, container boundaries)
  const inspection = inspectEditorialImageBinary(input.binary, {
    claimedMimeType: input.claimedMimeType,
    claimedFilenameOrExtension: input.claimedFilenameOrExtension,
  });

  if (inspection.status === 'REJECTED') {
    const isCorrupt =
      inspection.rejectionCode === 'CORRUPTED_HEADER_OR_STRUCTURE' ||
      inspection.rejectionCode === 'INVALID_CHUNK_CRC' ||
      inspection.rejectionCode === 'INVALID_DIMENSIONS' ||
      inspection.rejectionCode === 'TRAILING_DATA_AFTER_TERMINATOR';

    const isUnsupported =
      inspection.rejectionCode === 'UNSUPPORTED_MAGIC_BYTES' ||
      inspection.rejectionCode === 'CLAIMED_MIME_MISMATCH' ||
      inspection.rejectionCode === 'CLAIMED_EXTENSION_MISMATCH' ||
      inspection.rejectionCode === 'ANIMATED_IMAGE_FORBIDDEN' ||
      inspection.rejectionCode === 'MULTI_PICTURE_FORBIDDEN' ||
      inspection.rejectionCode === 'POLYGLOT_SIGNATURE_DETECTED';

    throw new EditorialImageVariantProcessingError({
      code: isCorrupt
        ? 'CORRUPT_IMAGE'
        : isUnsupported
          ? 'UNSUPPORTED_IMAGE'
          : 'INVALID_INPUT',
      message: `Preliminary binary inspection rejected input image: ${inspection.rejectionReason}`,
      assetId: input.assetId,
      rejectionCode: inspection.rejectionCode,
    });
  }

  // 3. Native Sharp pixel decode and safety verification
  let decodedMetadata: SharpMetadata;
  try {
    const initialInstance = sharp(input.binary, {
      failOn: 'warning',
      limitInputPixels: MAX_PROCESSOR_PIXELS,
      unlimited: false,
      animated: false,
      pages: 1,
    }).timeout({ seconds: PROCESSOR_TIMEOUT_SECONDS });

    decodedMetadata = await initialInstance.metadata();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPixelExceeded =
      msg.toLowerCase().includes('pixel') || msg.toLowerCase().includes('limit');
    throw new EditorialImageVariantProcessingError({
      code: isPixelExceeded ? 'INVALID_INPUT' : 'CORRUPT_IMAGE',
      message: `Sharp pixel decode failed: ${msg}`,
      assetId: input.assetId,
    });
  }

  // Verify format matches accepted static formats: png, jpeg, webp
  const format = decodedMetadata.format;
  if (!format || !['png', 'jpeg', 'webp'].includes(format)) {
    throw new EditorialImageVariantProcessingError({
      code: 'UNSUPPORTED_IMAGE',
      message: `Unsupported image format decoded: "${format ?? 'unknown'}". Only static PNG, JPEG, and WebP are allowed.`,
      assetId: input.assetId,
    });
  }

  // Reject multi-page or animated
  if (decodedMetadata.pages && decodedMetadata.pages > 1) {
    throw new EditorialImageVariantProcessingError({
      code: 'UNSUPPORTED_IMAGE',
      message: 'Multi-frame or animated images are forbidden.',
      assetId: input.assetId,
    });
  }

  const rawWidth = decodedMetadata.width ?? 0;
  const rawHeight = decodedMetadata.height ?? 0;
  if (rawWidth <= 0 || rawHeight <= 0) {
    throw new EditorialImageVariantProcessingError({
      code: 'CORRUPT_IMAGE',
      message: `Decoded image has non-positive dimensions: ${rawWidth}x${rawHeight}.`,
      assetId: input.assetId,
    });
  }

  const totalPixels = rawWidth * rawHeight;
  if (totalPixels > MAX_PROCESSOR_PIXELS) {
    throw new EditorialImageVariantProcessingError({
      code: 'INVALID_INPUT',
      message: `Decoded image exceeds maximum processing budget of ${MAX_PROCESSOR_PIXELS} pixels (received ${totalPixels} pixels).`,
      assetId: input.assetId,
    });
  }

  // 4. Sequential variant generation and validation
  const processedVariants: ProcessedEditorialImageVariant[] = [];

  try {
    for (const spec of EDITORIAL_IMAGE_VARIANT_TARGET_SPECS) {
      // Build transformation pipeline:
      // - auto-orient per EXIF (.rotate() with no args)
      // - resize down without enlargement, fit: 'inside' (preserves aspect ratio)
      // - strip EXIF/GPS/XMP/IPTC metadata by default (no .withMetadata())
      // - encode to WebP with balanced compression
      const transformPipeline = sharp(input.binary, {
        failOn: 'warning',
        limitInputPixels: MAX_PROCESSOR_PIXELS,
        unlimited: false,
        animated: false,
        pages: 1,
      })
        .timeout({ seconds: PROCESSOR_TIMEOUT_SECONDS })
        .rotate()
        .resize({
          width: spec.maxWidth,
          withoutEnlargement: true,
          fit: 'inside',
        })
        .webp({
          quality: 85,
          effort: 4,
        });

      const outputBuffer = await transformPipeline.toBuffer();

      // Output size safety validation
      if (outputBuffer.length === 0) {
        throw new EditorialImageVariantProcessingError({
          code: 'OUTPUT_VALIDATION_FAILED',
          message: `Variant "${spec.variantKey}" produced an empty output buffer.`,
          assetId: input.assetId,
        });
      }

      if (outputBuffer.length > MAX_PROCESSOR_INPUT_BYTES) {
        throw new EditorialImageVariantProcessingError({
          code: 'OUTPUT_VALIDATION_FAILED',
          message: `Variant "${spec.variantKey}" produced ${outputBuffer.length} bytes, exceeding maximum ${MAX_PROCESSOR_INPUT_BYTES} bytes.`,
          assetId: input.assetId,
        });
      }

      // Re-decode output WebP bytes to verify format, dimensions, and lack of corruption
      const verifyMetadata = await sharp(outputBuffer, {
        failOn: 'warning',
        limitInputPixels: MAX_PROCESSOR_PIXELS,
      })
        .timeout({ seconds: PROCESSOR_TIMEOUT_SECONDS })
        .metadata();

      if (verifyMetadata.format !== 'webp') {
        throw new EditorialImageVariantProcessingError({
          code: 'OUTPUT_VALIDATION_FAILED',
          message: `Variant "${spec.variantKey}" did not produce valid WebP format (got ${verifyMetadata.format}).`,
          assetId: input.assetId,
        });
      }

      const outWidth = verifyMetadata.width ?? 0;
      const outHeight = verifyMetadata.height ?? 0;
      if (outWidth <= 0 || outHeight <= 0) {
        throw new EditorialImageVariantProcessingError({
          code: 'OUTPUT_VALIDATION_FAILED',
          message: `Variant "${spec.variantKey}" decoded with invalid dimensions ${outWidth}x${outHeight}.`,
          assetId: input.assetId,
        });
      }

      // Compute SHA-256 checksum over output WebP bytes
      const sha256 = createHash('sha256').update(outputBuffer).digest('hex');

      // Derive storage path from accepted canonical contract
      const storagePath = buildEditorialImageVariantStoragePath(
        input.assetId,
        spec.variantKey,
        'image/webp'
      );

      processedVariants.push(
        Object.freeze({
          variantKey: spec.variantKey,
          storagePath,
          mimeType: 'image/webp' as const,
          width: outWidth,
          height: outHeight,
          sizeBytes: outputBuffer.length,
          sha256Checksum: sha256,
          bytes: outputBuffer,
        })
      );
    }
  } catch (err) {
    if (err instanceof EditorialImageVariantProcessingError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new EditorialImageVariantProcessingError({
      code: 'PROCESSING_FAILURE',
      message: `Failed during variant transformation pipeline: ${msg}`,
      assetId: input.assetId,
    });
  }

  // Ensure all 5 variants were successfully produced
  if (processedVariants.length !== EDITORIAL_IMAGE_VARIANT_TARGET_SPECS.length) {
    throw new EditorialImageVariantProcessingError({
      code: 'PROCESSING_FAILURE',
      message: `Expected ${EDITORIAL_IMAGE_VARIANT_TARGET_SPECS.length} variants, but only ${processedVariants.length} were generated.`,
      assetId: input.assetId,
    });
  }

  return Object.freeze({
    assetId: input.assetId,
    detectedInputMimeType: inspection.detectedMimeType,
    originalWidth: inspection.width,
    originalHeight: inspection.height,
    originalSizeBytes: inspection.sizeBytes,
    originalSha256: inspection.sha256Checksum,
    variants: Object.freeze(processedVariants),
  });
}
