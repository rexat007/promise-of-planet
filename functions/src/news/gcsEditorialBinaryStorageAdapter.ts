import { Buffer } from 'node:buffer';
import {
  type ConditionalStorageDeleteRequest,
  type ConditionalStorageDeleteOutcome,
  EditorialBinaryIntakeError,
  type EditorialBinaryIntakeTargetKind,
  type EditorialBinaryStorageAdapter,
  type EditorialBinaryStorageNamespace,
  type StorageObjectMetadata,
  type StorageObjectOwnershipMetadata,
  type StorageWriteIfAbsentOutcome,
  type StorageWriteIfAbsentRequest,
  validateIntakeId,
} from './editorialBinaryIntakeService';
import {
  CANONICAL_SHA256_CHECKSUM_REGEX,
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetValidationLimits,
  type EditorialImageAssetVariantKey,
} from '../types/editorialImageAsset';
import {
  validateAssetId,
} from '../shared/editorialImageAssetContract';
import { validateEvidenceId } from './editorialImageRightsEvidenceContract';
import { computeSha256Hex } from './editorialBinaryInspector';

export interface GcsFileMetadataResponse {
  readonly generation?: string | number;
  readonly metageneration?: string | number;
  readonly etag?: string;
  readonly contentType?: string;
  readonly size?: string | number;
  readonly timeCreated?: string;
  readonly updated?: string;
  readonly md5Hash?: string;
  readonly metadata?: Record<string, string>;
  [key: string]: unknown;
}

export interface GcsSavePreconditionOptions {
  readonly ifGenerationMatch?: number | string;
  [key: string]: unknown;
}

export interface GcsSaveOptions {
  readonly contentType?: string;
  readonly metadata?: {
    readonly metadata?: Record<string, string>;
    [key: string]: unknown;
  };
  readonly preconditionOpts?: GcsSavePreconditionOptions;
  readonly preconditions?: GcsSavePreconditionOptions;
  readonly resumable?: boolean;
  readonly validation?: boolean | string;
  [key: string]: unknown;
}

export interface GcsDeleteOptions {
  readonly preconditionOpts?: {
    readonly ifGenerationMatch?: number | string;
    [key: string]: unknown;
  };
  readonly preconditions?: {
    readonly ifGenerationMatch?: number | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GcsEditorialBinaryFile {
  readonly name: string;
  save(data: Buffer, options?: GcsSaveOptions): Promise<void>;
  getMetadata(): Promise<[GcsFileMetadataResponse, unknown]>;
  download?(): Promise<[Buffer]>;
  delete(options?: GcsDeleteOptions): Promise<[unknown] | void>;
  exists?(): Promise<[boolean]>;
}

export interface GcsEditorialBinaryBucket {
  readonly name: string;
  file(name: string): GcsEditorialBinaryFile;
}

const VALID_VARIANT_KEYS: ReadonlySet<string> = new Set([
  'thumbnail',
  'card',
  'article_inline',
  'article_cover',
  'original_processed',
]);

const ALLOWED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
]);

const ALLOWED_EVIDENCE_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
]);

export function isGcsPreconditionFailedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  if (
    candidate.code === 412 ||
    candidate.status === 412 ||
    candidate.statusCode === 412
  ) {
    return true;
  }
  if (typeof candidate.message === 'string') {
    return /precondition\s*failed|conditionNotMet|412/i.test(
      candidate.message
    );
  }
  return false;
}

export function isGcsNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  if (
    candidate.code === 404 ||
    candidate.status === 404 ||
    candidate.statusCode === 404
  ) {
    return true;
  }
  if (typeof candidate.message === 'string') {
    return /not\s*found|no\s*such\s*object|404/i.test(candidate.message);
  }
  return false;
}

export interface ValidatedParsedStoragePath {
  readonly storagePath: string;
  readonly namespace: EditorialBinaryStorageNamespace;
  readonly targetKind: EditorialBinaryIntakeTargetKind;
  readonly assetId: string;
  readonly evidenceId?: string;
  readonly intakeId?: string;
  readonly variantKey?: EditorialImageAssetVariantKey;
  readonly extension: string;
}

/**
 * Validates and classifies canonical private and quarantine storage paths.
 * Rejects path traversal, whitespace, backslashes, percent-encoding, URLs,
 * and arbitrary unregistered path segments.
 */
export function validateAndParseCanonicalStoragePath(
  storagePath: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): ValidatedParsedStoragePath {
  if (typeof storagePath !== 'string' || storagePath.trim().length === 0) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'storagePath must be a non-empty string.',
    });
  }

  if (storagePath !== storagePath.trim() || /\s/.test(storagePath)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'storagePath must not contain whitespace.',
    });
  }

  if (storagePath.includes('\\')) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'storagePath must not contain backslashes.',
    });
  }

  if (storagePath.includes('%')) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'storagePath must not contain percent-encoded characters.',
    });
  }

  if (
    storagePath.startsWith('/') ||
    storagePath.endsWith('/') ||
    storagePath.includes('//')
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message:
        'storagePath must be a normalized relative path without leading, trailing, or duplicate slashes.',
    });
  }

  if (
    /https?:\/\/|gs:\/\/|file:\/\/|data:|blob:/i.test(storagePath) ||
    /[?#]/.test(storagePath)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message:
        'storagePath must not contain external URLs, URI schemes, query parameters, or fragment identifiers.',
    });
  }

  const segments = storagePath.split('/');
  if (segments.some((seg) => seg === '.' || seg === '..')) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'storagePath must not contain path traversal segments ("." or "..").',
    });
  }

  // 1. Quarantine Image Path: editorial_intake_quarantine/images/<intakeId>/source.<ext>
  if (
    segments.length === 4 &&
    segments[0] === 'editorial_intake_quarantine' &&
    segments[1] === 'images'
  ) {
    const intakeId = validateIntakeId(segments[2]);
    const filename = segments[3];
    const dotIdx = filename.indexOf('.');
    if (dotIdx <= 0 || dotIdx !== filename.lastIndexOf('.')) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid quarantine image filename "${filename}".`,
      });
    }
    const base = filename.slice(0, dotIdx);
    const ext = filename.slice(dotIdx + 1).toLowerCase();
    if (base !== 'source' || !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Quarantine image filename must be "source.<ext>" with allowed extension, received "${filename}".`,
      });
    }
    return Object.freeze({
      storagePath,
      namespace: 'quarantine',
      targetKind: 'editorial_image_asset',
      assetId: 'quarantine_asset',
      intakeId,
      extension: ext,
    });
  }

  // 2. Quarantine Rights Evidence Path: editorial_intake_quarantine/rights_evidence/<intakeId>/source.<ext>
  if (
    segments.length === 4 &&
    segments[0] === 'editorial_intake_quarantine' &&
    segments[1] === 'rights_evidence'
  ) {
    const intakeId = validateIntakeId(segments[2]);
    const filename = segments[3];
    const dotIdx = filename.indexOf('.');
    if (dotIdx <= 0 || dotIdx !== filename.lastIndexOf('.')) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid quarantine evidence filename "${filename}".`,
      });
    }
    const base = filename.slice(0, dotIdx);
    const ext = filename.slice(dotIdx + 1).toLowerCase();
    if (base !== 'source' || !ALLOWED_EVIDENCE_EXTENSIONS.has(ext)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Quarantine evidence filename must be "source.<ext>" with allowed extension, received "${filename}".`,
      });
    }
    return Object.freeze({
      storagePath,
      namespace: 'quarantine',
      targetKind: 'rights_evidence_binary',
      assetId: 'quarantine_asset',
      intakeId,
      extension: ext,
    });
  }

  // 3. Private Editorial Image Variant Path: editorial_images/private/<assetId>/<variantKey>.<ext>
  if (
    segments.length === 4 &&
    segments[0] === 'editorial_images' &&
    segments[1] === 'private'
  ) {
    const assetId = segments[2];
    const assetCheck = validateAssetId(assetId, limits);
    if (!assetCheck.valid) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid assetId segment "${assetId}" in private image path.`,
        details: assetCheck.errors,
      });
    }

    const filename = segments[3];
    const dotIdx = filename.indexOf('.');
    if (dotIdx <= 0 || dotIdx !== filename.lastIndexOf('.')) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid private image variant filename "${filename}".`,
      });
    }

    const variantKey = filename.slice(0, dotIdx);
    const ext = filename.slice(dotIdx + 1).toLowerCase();

    if (!VALID_VARIANT_KEYS.has(variantKey)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid variantKey "${variantKey}" in private image path. Allowed: ${Array.from(VALID_VARIANT_KEYS).join(', ')}.`,
      });
    }

    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid image extension ".${ext}" in private image path.`,
      });
    }

    return Object.freeze({
      storagePath,
      namespace: 'private',
      targetKind: 'editorial_image_asset',
      assetId,
      variantKey: variantKey as EditorialImageAssetVariantKey,
      extension: ext,
    });
  }

  // 4. Private Rights Evidence Path: editorial_rights_evidence/private/<assetId>/<evidenceId>/artifact.<ext>
  if (
    segments.length === 5 &&
    segments[0] === 'editorial_rights_evidence' &&
    segments[1] === 'private'
  ) {
    const assetId = segments[2];
    const assetCheck = validateAssetId(assetId, limits);
    if (!assetCheck.valid) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid assetId segment "${assetId}" in private evidence path.`,
        details: assetCheck.errors,
      });
    }

    const evidenceId = segments[3];
    const evCheck = validateEvidenceId(evidenceId, limits);
    if (!evCheck.valid) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid evidenceId segment "${evidenceId}" in private evidence path.`,
        details: evCheck.errors,
      });
    }

    const filename = segments[4];
    const dotIdx = filename.indexOf('.');
    if (dotIdx <= 0 || dotIdx !== filename.lastIndexOf('.')) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid private evidence filename "${filename}".`,
      });
    }

    const base = filename.slice(0, dotIdx);
    const ext = filename.slice(dotIdx + 1).toLowerCase();

    if (base !== 'artifact' || !ALLOWED_EVIDENCE_EXTENSIONS.has(ext)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Private evidence filename must be "artifact.<ext>" with allowed extension, received "${filename}".`,
      });
    }

    return Object.freeze({
      storagePath,
      namespace: 'private',
      targetKind: 'rights_evidence_binary',
      assetId,
      evidenceId,
      extension: ext,
    });
  }

  throw new EditorialBinaryIntakeError({
    code: 'INVALID_INPUT',
    message: `Storage path "${storagePath}" does not match any recognized canonical private or quarantine namespace pattern.`,
  });
}

function assertOwnershipMatchesParsedPath(
  ownership: StorageObjectOwnershipMetadata,
  parsed: ValidatedParsedStoragePath
): void {
  if (ownership.namespace !== parsed.namespace) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Ownership namespace "${ownership.namespace}" does not match path namespace "${parsed.namespace}".`,
    });
  }

  if (ownership.targetKind !== parsed.targetKind) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Ownership targetKind "${ownership.targetKind}" does not match path targetKind "${parsed.targetKind}".`,
    });
  }

  if (parsed.namespace === 'quarantine') {
    if (ownership.createdByIntakeId !== parsed.intakeId) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Ownership createdByIntakeId "${ownership.createdByIntakeId}" does not match quarantine path intake ID "${parsed.intakeId}".`,
      });
    }
  } else {
    // private namespace
    if (ownership.assetId !== parsed.assetId) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Ownership assetId "${ownership.assetId}" does not match private path assetId "${parsed.assetId}".`,
      });
    }

    if (parsed.targetKind === 'rights_evidence_binary') {
      if (!ownership.evidenceId || ownership.evidenceId !== parsed.evidenceId) {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Ownership evidenceId "${ownership.evidenceId || ''}" does not match private evidence path ID "${parsed.evidenceId || ''}".`,
        });
      }
    }
  }
}

/**
 * Production-ready Google Cloud Storage adapter for editorial binaries.
 *
 * Implements strict create-if-absent (generation precondition 0),
 * server-side conditional deletion (expected generation match), exact binary
 * SHA-256 and byte-size verification, server-owned metadata enforcement,
 * and conservative error classification.
 */
export class GcsEditorialBinaryStorageAdapter
  implements EditorialBinaryStorageAdapter
{
  private readonly bucket: GcsEditorialBinaryBucket;
  private readonly limits: EditorialImageAssetValidationLimits;
  private readonly clock: () => string;

  constructor(options: {
    readonly bucket: GcsEditorialBinaryBucket;
    readonly limits?: EditorialImageAssetValidationLimits;
    readonly clock?: () => string;
  }) {
    if (
      !options ||
      !options.bucket ||
      typeof options.bucket.file !== 'function'
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message:
          'GcsEditorialBinaryStorageAdapter requires a valid GcsEditorialBinaryBucket interface.',
      });
    }
    this.bucket = options.bucket;
    this.limits = options.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async writeIfAbsent(
    request: StorageWriteIfAbsentRequest
  ): Promise<StorageWriteIfAbsentOutcome> {
    if (!request) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Write request must be a non-null object.',
      });
    }

    const parsedPath = validateAndParseCanonicalStoragePath(
      request.storagePath,
      this.limits
    );

    if (
      !request.ownership ||
      typeof request.ownership !== 'object' ||
      !request.ownership.createdByIntakeId ||
      !request.ownership.uploaderUid
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Storage write request requires valid ownership metadata.',
      });
    }

    assertOwnershipMatchesParsedPath(request.ownership, parsedPath);

    if (
      !Buffer.isBuffer(request.bytes) ||
      request.bytes.length === 0 ||
      request.bytes.byteLength === 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Binary bytes must be a non-empty Buffer.',
      });
    }

    if (
      typeof request.contentType !== 'string' ||
      request.contentType.trim().length === 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'contentType must be a non-empty string.',
      });
    }

    if (
      typeof request.sha256Checksum !== 'string' ||
      !CANONICAL_SHA256_CHECKSUM_REGEX.test(request.sha256Checksum)
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'sha256Checksum must be a 64-character lowercase hexadecimal string.',
      });
    }

    // Verify actual buffer matches claimed SHA-256
    const actualSha = computeSha256Hex(request.bytes);
    if (actualSha !== request.sha256Checksum) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Claimed sha256Checksum "${request.sha256Checksum}" does not match actual binary SHA-256 "${actualSha}".`,
      });
    }

    const file = this.bucket.file(request.storagePath);
    const createdAtIso = this.clock();

    const customMetadata: Record<string, string> = {
      createdByIntakeId: request.ownership.createdByIntakeId,
      targetKind: request.ownership.targetKind,
      namespace: request.ownership.namespace,
      assetId: request.ownership.assetId,
      uploaderUid: request.ownership.uploaderUid,
      sha256Checksum: actualSha,
      createdAtIso,
    };

    if (request.ownership.evidenceId) {
      customMetadata.evidenceId = request.ownership.evidenceId;
    }

    try {
      await file.save(request.bytes, {
        contentType: request.contentType,
        metadata: {
          metadata: customMetadata,
        },
        preconditionOpts: {
          ifGenerationMatch: 0,
        },
        preconditions: {
          ifGenerationMatch: 0,
        },
      });
    } catch (err) {
      if (isGcsPreconditionFailedError(err)) {
        // Object already exists (generation was not 0). Read existing metadata.
        const existingMetadata = await this.readMetadata(request.storagePath);
        if (existingMetadata) {
          return {
            created: false,
            existingMetadata,
          };
        }
        throw new EditorialBinaryIntakeError({
          code: 'STORAGE_CONFLICT',
          message: `Storage path "${request.storagePath}" already exists (precondition failed).`,
        });
      }

      const msg = err instanceof Error ? err.message : 'Unknown GCS save error.';
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS writeIfAbsent failed for "${request.storagePath}": ${msg}`,
      });
    }

    // Successfully created new object; read back canonical metadata to verify generation
    const createdMetadata = await this.readMetadata(request.storagePath);
    if (!createdMetadata) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS write succeeded but readMetadata returned null for "${request.storagePath}".`,
      });
    }

    return {
      created: true,
      metadata: createdMetadata,
    };
  }

  async readMetadata(
    storagePath: string
  ): Promise<StorageObjectMetadata | null> {
    const parsedPath = validateAndParseCanonicalStoragePath(
      storagePath,
      this.limits
    );
    const file = this.bucket.file(parsedPath.storagePath);

    let rawMeta: GcsFileMetadataResponse;
    try {
      const [meta] = await file.getMetadata();
      rawMeta = meta;
    } catch (err) {
      if (isGcsNotFoundError(err)) {
        return null;
      }
      const msg =
        err instanceof Error ? err.message : 'Unknown GCS getMetadata error.';
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS getMetadata failed for "${parsedPath.storagePath}": ${msg}`,
      });
    }

    if (!rawMeta || typeof rawMeta !== 'object') {
      return null;
    }

    const generationStr =
      rawMeta.generation !== undefined && rawMeta.generation !== null
        ? String(rawMeta.generation)
        : '';

    if (!generationStr || generationStr.trim().length === 0) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS object "${parsedPath.storagePath}" metadata lacks a valid generation string.`,
      });
    }

    const etagStr =
      rawMeta.etag !== undefined && rawMeta.etag !== null
        ? String(rawMeta.etag)
        : `etag_${generationStr}`;

    const sizeNum =
      typeof rawMeta.size === 'number'
        ? rawMeta.size
        : typeof rawMeta.size === 'string'
          ? Number.parseInt(rawMeta.size, 10)
          : NaN;

    if (!Number.isSafeInteger(sizeNum) || sizeNum <= 0) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS object "${parsedPath.storagePath}" metadata has invalid size (${String(rawMeta.size)}).`,
      });
    }

    const contentType =
      typeof rawMeta.contentType === 'string' &&
      rawMeta.contentType.trim().length > 0
        ? rawMeta.contentType
        : 'application/octet-stream';

    const createdAtIso =
      typeof rawMeta.timeCreated === 'string' &&
      rawMeta.timeCreated.trim().length > 0
        ? rawMeta.timeCreated
        : this.clock();

    const customMeta = rawMeta.metadata;
    if (!customMeta || typeof customMeta !== 'object') {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS object "${parsedPath.storagePath}" is missing required server ownership custom metadata.`,
      });
    }

    const createdByIntakeId = customMeta.createdByIntakeId;
    const targetKind = customMeta.targetKind as EditorialBinaryIntakeTargetKind;
    const namespace = customMeta.namespace as EditorialBinaryStorageNamespace;
    const assetId = customMeta.assetId;
    const uploaderUid = customMeta.uploaderUid;
    const sha256Checksum = customMeta.sha256Checksum;
    const evidenceId = customMeta.evidenceId;

    if (
      !createdByIntakeId ||
      !targetKind ||
      !namespace ||
      !assetId ||
      !uploaderUid ||
      !sha256Checksum ||
      !CANONICAL_SHA256_CHECKSUM_REGEX.test(sha256Checksum)
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS object "${parsedPath.storagePath}" custom metadata contains corrupted or incomplete ownership descriptors.`,
      });
    }

    const ownership: StorageObjectOwnershipMetadata = Object.freeze({
      createdByIntakeId,
      targetKind,
      namespace,
      assetId,
      ...(evidenceId ? { evidenceId } : {}),
      uploaderUid,
    });

    assertOwnershipMatchesParsedPath(ownership, parsedPath);

    return Object.freeze({
      storagePath: parsedPath.storagePath,
      generation: generationStr,
      etag: etagStr,
      contentType,
      sizeBytes: sizeNum,
      sha256Checksum,
      createdAtIso,
      ownership,
    });
  }

  async readBytes(
    storagePath: string
  ): Promise<{ bytes: Buffer; metadata: StorageObjectMetadata } | null> {
    const metadata = await this.readMetadata(storagePath);
    if (!metadata) {
      return null;
    }

    const file = this.bucket.file(metadata.storagePath);
    if (typeof file.download !== 'function') {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS file adapter does not implement download() for "${metadata.storagePath}".`,
      });
    }

    let downloadedBuffer: Buffer;
    try {
      const [buf] = await file.download();
      downloadedBuffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    } catch (err) {
      if (isGcsNotFoundError(err)) {
        return null;
      }
      const msg =
        err instanceof Error ? err.message : 'Unknown GCS download error.';
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS download failed for "${metadata.storagePath}": ${msg}`,
      });
    }

    if (downloadedBuffer.length !== metadata.sizeBytes) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Downloaded byte length (${downloadedBuffer.length}) does not match stored metadata sizeBytes (${metadata.sizeBytes}) for "${metadata.storagePath}".`,
      });
    }

    const downloadedSha = computeSha256Hex(downloadedBuffer);
    if (downloadedSha !== metadata.sha256Checksum) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Downloaded binary SHA-256 ("${downloadedSha}") does not match stored metadata sha256Checksum ("${metadata.sha256Checksum}") for "${metadata.storagePath}".`,
      });
    }

    return {
      bytes: downloadedBuffer,
      metadata,
    };
  }

  async deleteIfGenerationMatches(
    request: ConditionalStorageDeleteRequest
  ): Promise<ConditionalStorageDeleteOutcome> {
    if (!request) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Delete request must be a non-null object.',
      });
    }

    const parsedPath = validateAndParseCanonicalStoragePath(
      request.storagePath,
      this.limits
    );

    if (
      typeof request.expectedGeneration !== 'string' ||
      request.expectedGeneration.trim().length === 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'expectedGeneration must be a non-empty string.',
      });
    }

    const expectedIntakeId = validateIntakeId(request.expectedIntakeId);

    // 1. First inspect the current stored metadata to verify ownership and generation
    const currentMeta = await this.readMetadata(parsedPath.storagePath);
    if (!currentMeta) {
      return { deleted: false, reason: 'ALREADY_ABSENT' };
    }

    if (currentMeta.ownership.createdByIntakeId !== expectedIntakeId) {
      return { deleted: false, reason: 'OWNERSHIP_MISMATCH' };
    }

    if (currentMeta.generation !== request.expectedGeneration) {
      return { deleted: false, reason: 'GENERATION_MISMATCH' };
    }

    // 2. Perform actual server-side conditional deletion using GCS generation precondition
    const file = this.bucket.file(parsedPath.storagePath);

    try {
      await file.delete({
        preconditionOpts: {
          ifGenerationMatch: request.expectedGeneration,
        },
        preconditions: {
          ifGenerationMatch: request.expectedGeneration,
        },
      });
      return { deleted: true, reason: 'DELETED' };
    } catch (err) {
      if (isGcsNotFoundError(err)) {
        return { deleted: false, reason: 'ALREADY_ABSENT' };
      }

      if (isGcsPreconditionFailedError(err)) {
        return { deleted: false, reason: 'GENERATION_MISMATCH' };
      }

      const msg =
        err instanceof Error ? err.message : 'Unknown GCS delete error.';
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `GCS conditional delete failed for "${parsedPath.storagePath}": ${msg}`,
      });
    }
  }
}
