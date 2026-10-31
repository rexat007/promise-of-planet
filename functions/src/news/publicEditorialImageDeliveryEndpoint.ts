import { Buffer } from 'node:buffer';
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import { FirestoreNewsRepository } from './firestoreNewsRepository';
import {
  FirestoreEditorialImageAssetRepository,
  type EditorialImageFirestoreDatabase,
} from './firestoreEditorialImageAssetRepository';
import {
  GcsEditorialBinaryStorageAdapter,
  type GcsEditorialBinaryBucket,
  validateAndParseCanonicalStoragePath,
} from './gcsEditorialBinaryStorageAdapter';
import type { NewsRepository } from './newsRepository';
import type {
  EditorialImageAssetReadResult,
  EditorialImageAssetRepository,
} from './editorialImageAssetRepository';
import {
  validateAssetId,
  validateEditorialImageAsset,
  validateEditorialImageAssetVariant,
} from '../shared/editorialImageAssetContract';
import {
  CANONICAL_SHA256_CHECKSUM_REGEX,
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetValidationLimits,
} from '../types/editorialImageAsset';
import {
  computeSha256Hex,
  inspectEditorialImageBinary,
} from './editorialBinaryInspector';
import {
  type EditorialBinaryStorageAdapter,
  type StorageObjectMetadata,
} from './editorialBinaryIntakeService';
import { DEFAULT_TRUSTED_UPLOAD_ORIGINS } from './editorialNewsImageUploadEndpoint';
import {
  PublicNewsRepository,
  PUBLIC_DELIVERY_EDITORIAL_IMAGE_VARIANT_KEYS,
  isEditorialImageAssetEligibleForPublicArticle,
  isPublicDeliveryEditorialImageVariantKey,
  type PublicEditorialImageDeliveryVariantKey,
} from './publicNewsRepository';

export const PUBLIC_DELIVERY_ALLOWED_VARIANTS: readonly PublicEditorialImageDeliveryVariantKey[] =
  PUBLIC_DELIVERY_EDITORIAL_IMAGE_VARIANT_KEYS;

export const PUBLIC_IMAGE_MAX_SERVE_BYTES = 15_000_000 as const;

const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set([
  'articleId',
  'assetId',
  'variant',
]);

const SAFE_ARTICLE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export type PublicEditorialImageDeliveryErrorCode =
  | 'CORS_ORIGIN_FORBIDDEN'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_QUERY_PARAMETERS'
  | 'INVALID_ARTICLE_ID'
  | 'INVALID_ASSET_ID'
  | 'INVALID_VARIANT_KEY'
  | 'ARTICLE_NOT_FOUND'
  | 'ARTICLE_NOT_PUBLISHED'
  | 'ASSET_NOT_REFERENCED_BY_ARTICLE'
  | 'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE'
  | 'ASSET_NOT_FOUND'
  | 'VARIANT_NOT_AVAILABLE'
  | 'BINARY_NOT_FOUND'
  | 'STORAGE_INTEGRITY_ERROR'
  | 'INTERNAL_DELIVERY_ERROR';

export interface PublicEditorialImageDeliveryErrorResponse {
  readonly ok: false;
  readonly errorCode: PublicEditorialImageDeliveryErrorCode;
  readonly message: string;
}

export interface PublicEditorialImageDeliveryHttpRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly url?: string;
}

export interface PublicEditorialImageDeliveryHttpResponseWriter {
  status(code: number): PublicEditorialImageDeliveryHttpResponseWriter;
  setHeader(
    name: string,
    value: string
  ): PublicEditorialImageDeliveryHttpResponseWriter;
  getHeader?(name: string): string | number | string[] | undefined;
  json(body: unknown): void;
  send(body: Buffer | string): void;
  end(chunk?: Buffer | string): void;
}

export interface PublicEditorialImageDeliveryDependencies {
  readonly newsRepository: NewsRepository;
  readonly assetRepository: EditorialImageAssetRepository;
  readonly storageAdapter: EditorialBinaryStorageAdapter;
  readonly publicNewsRepository?: PublicNewsRepository;
  readonly allowedOrigins?: ReadonlySet<string>;
  readonly limits?: EditorialImageAssetValidationLimits;
}

export interface ProductionPublicEditorialImageDeliveryRuntimeOverrides {
  readonly newsRepository?: NewsRepository;
  readonly assetRepository?: EditorialImageAssetRepository;
  readonly storageAdapter?: EditorialBinaryStorageAdapter;
  readonly getFirestore?: () => unknown;
  readonly getStorage?: () => { bucket(name?: string): unknown };
  readonly bucketName?: string;
  readonly limits?: EditorialImageAssetValidationLimits;
}

function getHeaderCaseInsensitive(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined,
  targetName: string
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const lowerTarget = targetName.toLowerCase();
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerTarget) {
      if (Array.isArray(val)) {
        return val[0];
      }
      return val;
    }
  }
  return undefined;
}

function resolveAllowedOrigins(
  overrideOrigins?: ReadonlySet<string>
): ReadonlySet<string> {
  if (overrideOrigins) {
    return overrideOrigins;
  }

  const configuredEnv =
    process.env.PUBLIC_IMAGE_DELIVERY_ALLOWED_ORIGINS ||
    process.env.EDITORIAL_UPLOAD_ALLOWED_ORIGINS;
  if (!configuredEnv || configuredEnv.trim().length === 0) {
    return DEFAULT_TRUSTED_UPLOAD_ORIGINS;
  }

  const merged = new Set<string>(DEFAULT_TRUSTED_UPLOAD_ORIGINS);
  for (const part of configuredEnv.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length > 0 && trimmed !== '*' && trimmed !== 'null') {
      merged.add(trimmed);
    }
  }
  return merged;
}

function validateAndApplyCors(
  req: PublicEditorialImageDeliveryHttpRequest,
  res: PublicEditorialImageDeliveryHttpResponseWriter,
  allowedOrigins: ReadonlySet<string>
): {
  readonly allowed: boolean;
  readonly isPreflight: boolean;
  readonly origin?: string;
} {
  const rawOrigin = getHeaderCaseInsensitive(req.headers, 'origin');

  if (rawOrigin === undefined) {
    return {
      allowed: true,
      isPreflight: req.method.toUpperCase() === 'OPTIONS',
    };
  }

  const trimmedOrigin = rawOrigin.trim();
  if (
    trimmedOrigin.length === 0 ||
    trimmedOrigin === '*' ||
    trimmedOrigin.toLowerCase() === 'null' ||
    !allowedOrigins.has(trimmedOrigin)
  ) {
    return {
      allowed: false,
      isPreflight: req.method.toUpperCase() === 'OPTIONS',
    };
  }

  res.setHeader('Access-Control-Allow-Origin', trimmedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Type, Content-Length, Cache-Control'
  );
  res.setHeader('Access-Control-Max-Age', '3600');

  return {
    allowed: true,
    isPreflight: req.method.toUpperCase() === 'OPTIONS',
    origin: trimmedOrigin,
  };
}

function applySecurityAndNoCacheHeaders(
  res: PublicEditorialImageDeliveryHttpResponseWriter
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Cache-Control',
    'private, no-cache, no-store, max-age=0, must-revalidate'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self'; sandbox"
  );
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

function sendSanitizedError(
  res: PublicEditorialImageDeliveryHttpResponseWriter,
  statusCode: number,
  errorCode: PublicEditorialImageDeliveryErrorCode,
  message: string
): void {
  applySecurityAndNoCacheHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const payload: PublicEditorialImageDeliveryErrorResponse = {
    ok: false,
    errorCode,
    message,
  };
  res.status(statusCode).json(payload);
}

function extractQueryParameters(
  req: PublicEditorialImageDeliveryHttpRequest,
  limits: EditorialImageAssetValidationLimits
):
  | {
      readonly ok: true;
      readonly articleId: string;
      readonly assetId: string;
      readonly variant: PublicEditorialImageDeliveryVariantKey;
    }
  | {
      readonly ok: false;
      readonly errorCode: PublicEditorialImageDeliveryErrorCode;
      readonly message: string;
    } {
  const queryRecord: Record<string, unknown> = {};

  if (
    req.query &&
    typeof req.query === 'object' &&
    !Array.isArray(req.query)
  ) {
    for (const [k, v] of Object.entries(req.query)) {
      queryRecord[k] = v;
    }
  } else if (typeof req.url === 'string' && req.url.includes('?')) {
    try {
      const parsed = new URL(req.url, 'https://localhost');
      const seenKeys = new Set<string>();
      for (const [k, v] of parsed.searchParams.entries()) {
        if (seenKeys.has(k)) {
          queryRecord[k] = [queryRecord[k], v];
        } else {
          seenKeys.add(k);
          queryRecord[k] = v;
        }
      }
    } catch {
      return {
        ok: false,
        errorCode: 'INVALID_QUERY_PARAMETERS',
        message: 'Invalid request query URL.',
      };
    }
  }

  const keys = Object.keys(queryRecord);
  for (const key of keys) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      return {
        ok: false,
        errorCode: 'INVALID_QUERY_PARAMETERS',
        message: 'Unexpected query parameter provided.',
      };
    }
  }

  const rawArticleId = queryRecord.articleId;
  const rawAssetId = queryRecord.assetId;
  const rawVariant = queryRecord.variant;

  if (
    typeof rawArticleId !== 'string' ||
    rawArticleId.trim().length === 0 ||
    rawArticleId !== rawArticleId.trim() ||
    !SAFE_ARTICLE_ID_REGEX.test(rawArticleId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_ARTICLE_ID',
      message: 'Query parameter articleId is missing or invalid.',
    };
  }

  if (typeof rawAssetId !== 'string' || rawAssetId.trim().length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_ASSET_ID',
      message: 'Query parameter assetId is required.',
    };
  }

  const assetIdCheck = validateAssetId(rawAssetId, limits);
  if (!assetIdCheck.valid) {
    return {
      ok: false,
      errorCode: 'INVALID_ASSET_ID',
      message: 'Query parameter assetId is invalid.',
    };
  }

  if (typeof rawVariant !== 'string' || rawVariant.trim().length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_VARIANT_KEY',
      message: 'Query parameter variant is required.',
    };
  }

  if (!isPublicDeliveryEditorialImageVariantKey(rawVariant)) {
    return {
      ok: false,
      errorCode: 'INVALID_VARIANT_KEY',
      message:
        'Requested image variant is not permitted for public delivery.',
    };
  }

  return {
    ok: true,
    articleId: rawArticleId,
    assetId: rawAssetId,
    variant: rawVariant,
  };
}

let cachedProductionRuntime: PublicEditorialImageDeliveryDependencies | null =
  null;

export function createProductionPublicEditorialImageDeliveryRuntime(
  overrides?: ProductionPublicEditorialImageDeliveryRuntimeOverrides
): PublicEditorialImageDeliveryDependencies {
  if (!overrides && cachedProductionRuntime) {
    return cachedProductionRuntime;
  }

  const resolveFirestore = overrides?.getFirestore ?? getFirestore;
  const resolveStorage = overrides?.getStorage ?? getStorage;
  const limits = overrides?.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;

  const firestoreInstance = resolveFirestore();
  const storageInstance = resolveStorage();
  const bucketInstance = (
    overrides?.bucketName
      ? storageInstance.bucket(overrides.bucketName)
      : storageInstance.bucket()
  ) as GcsEditorialBinaryBucket;

  const newsRepository =
    overrides?.newsRepository ?? new FirestoreNewsRepository();
  const assetRepository =
    overrides?.assetRepository ??
    new FirestoreEditorialImageAssetRepository(
      firestoreInstance as EditorialImageFirestoreDatabase,
      limits
    );
  const storageAdapter =
    overrides?.storageAdapter ??
    new GcsEditorialBinaryStorageAdapter({
      bucket: bucketInstance,
      limits,
    });
  const publicNewsRepository = new PublicNewsRepository(
    newsRepository,
    assetRepository
  );

  const runtime: PublicEditorialImageDeliveryDependencies = Object.freeze({
    newsRepository,
    assetRepository,
    storageAdapter,
    publicNewsRepository,
    limits,
  });

  if (!overrides) {
    cachedProductionRuntime = runtime;
  }

  return runtime;
}

export async function executePublicEditorialImageDeliveryEndpoint(
  req: PublicEditorialImageDeliveryHttpRequest,
  res: PublicEditorialImageDeliveryHttpResponseWriter,
  deps: PublicEditorialImageDeliveryDependencies
): Promise<void> {
  try {
    const limits = deps.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;
    const allowedOrigins = resolveAllowedOrigins(deps.allowedOrigins);
    const corsResult = validateAndApplyCors(req, res, allowedOrigins);

    if (!corsResult.allowed) {
      sendSanitizedError(
        res,
        403,
        'CORS_ORIGIN_FORBIDDEN',
        'Origin is not authorized to access this endpoint.'
      );
      return;
    }

    if (corsResult.isPreflight) {
      applySecurityAndNoCacheHeaders(res);
      res.status(204).end();
      return;
    }

    if (req.method.toUpperCase() !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
      sendSanitizedError(
        res,
        405,
        'METHOD_NOT_ALLOWED',
        'Only GET requests are permitted on this endpoint.'
      );
      return;
    }

    const queryCheck = extractQueryParameters(req, limits);
    if (!queryCheck.ok) {
      sendSanitizedError(res, 400, queryCheck.errorCode, queryCheck.message);
      return;
    }

    const { articleId, assetId, variant } = queryCheck;

    const publicNewsRepo =
      deps.publicNewsRepository ??
      new PublicNewsRepository(deps.newsRepository, deps.assetRepository);

    const decision = await publicNewsRepo.evaluatePublicEditorialImageDelivery(
      articleId,
      assetId,
      variant
    );

    if (!decision.eligible) {
      const reason = decision.reason ?? 'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE';
      if (
        reason === 'INVALID_ARTICLE_ID' ||
        reason === 'INVALID_ASSET_ID' ||
        reason === 'INVALID_VARIANT_KEY'
      ) {
        sendSanitizedError(
          res,
          400,
          reason,
          'Invalid public image delivery parameters.'
        );
        return;
      }

      if (reason === 'ARTICLE_NOT_PUBLISHED') {
        sendSanitizedError(
          res,
          403,
          'ARTICLE_NOT_PUBLISHED',
          'Requested article is not publicly available.'
        );
        return;
      }

      if (reason === 'ASSET_NOT_REFERENCED_BY_ARTICLE') {
        sendSanitizedError(
          res,
          403,
          'ASSET_NOT_REFERENCED_BY_ARTICLE',
          'Requested image asset is not referenced by the specified article.'
        );
        return;
      }

      sendSanitizedError(
        res,
        403,
        'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE',
        'Requested image asset is not authorized for public delivery.'
      );
      return;
    }

    let assetLookup: EditorialImageAssetReadResult;
    try {
      assetLookup = await deps.assetRepository.getById(assetId);
    } catch {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Canonical editorial image metadata failed integrity verification.'
      );
      return;
    }

    if (
      !assetLookup.ok ||
      assetLookup.status !== 'FOUND' ||
      !assetLookup.asset
    ) {
      sendSanitizedError(
        res,
        404,
        'ASSET_NOT_FOUND',
        'Requested editorial image asset was not found.'
      );
      return;
    }

    const asset = assetLookup.asset;
    if (!isEditorialImageAssetEligibleForPublicArticle(asset, articleId)) {
      sendSanitizedError(
        res,
        403,
        'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE',
        'Requested image asset is not authorized for public delivery.'
      );
      return;
    }

    const canonicalMetadataCheck = validateEditorialImageAsset(asset, limits);
    if (!canonicalMetadataCheck.valid || asset.assetId !== assetId) {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Canonical editorial image metadata failed integrity verification.'
      );
      return;
    }

    const variantMeta = asset.variants?.[variant];
    if (!variantMeta) {
      sendSanitizedError(
        res,
        404,
        'VARIANT_NOT_AVAILABLE',
        'Requested editorial image variant is not available.'
      );
      return;
    }

    const variantCheck = validateEditorialImageAssetVariant(
      variantMeta,
      variant,
      limits,
      asset.assetId
    );
    if (
      !variantCheck.valid ||
      variantMeta.variantKey !== variant ||
      !variantMeta.storagePath ||
      typeof variantMeta.storagePath !== 'string' ||
      variantMeta.mimeType !== 'image/webp' ||
      typeof variantMeta.sizeBytes !== 'number' ||
      variantMeta.sizeBytes <= 0 ||
      variantMeta.sizeBytes > PUBLIC_IMAGE_MAX_SERVE_BYTES ||
      !CANONICAL_SHA256_CHECKSUM_REGEX.test(variantMeta.sha256Checksum)
    ) {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Stored editorial image variant metadata is invalid.'
      );
      return;
    }

    try {
      const parsedPath = validateAndParseCanonicalStoragePath(
        variantMeta.storagePath,
        limits
      );
      if (
        parsedPath.assetId !== asset.assetId ||
        parsedPath.variantKey !== variant ||
        parsedPath.namespace !== 'private' ||
        parsedPath.targetKind !== 'editorial_image_asset'
      ) {
        sendSanitizedError(
          res,
          500,
          'STORAGE_INTEGRITY_ERROR',
          'Stored editorial image variant path is invalid.'
        );
        return;
      }
    } catch {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Stored editorial image variant path is invalid.'
      );
      return;
    }

    let binaryResult: { bytes: Buffer; metadata: StorageObjectMetadata } | null =
      null;
    try {
      binaryResult = await deps.storageAdapter.readBytes(
        variantMeta.storagePath
      );
    } catch {
      sendSanitizedError(
        res,
        500,
        'INTERNAL_DELIVERY_ERROR',
        'Failed to retrieve editorial image binary from storage.'
      );
      return;
    }

    if (
      !binaryResult ||
      !binaryResult.bytes ||
      !Buffer.isBuffer(binaryResult.bytes) ||
      binaryResult.bytes.length === 0
    ) {
      sendSanitizedError(
        res,
        404,
        'BINARY_NOT_FOUND',
        'Stored editorial image binary was not found.'
      );
      return;
    }

    const storedMetadata = binaryResult.metadata;
    if (!storedMetadata || storedMetadata.contentType !== 'image/webp') {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Stored editorial image binary has an unexpected content type.'
      );
      return;
    }

    const ownership = storedMetadata.ownership;
    if (
      !ownership ||
      ownership.targetKind !== 'editorial_image_asset' ||
      ownership.namespace !== 'private' ||
      ownership.assetId !== asset.assetId ||
      typeof ownership.createdByIntakeId !== 'string' ||
      ownership.createdByIntakeId.trim().length === 0 ||
      typeof ownership.uploaderUid !== 'string' ||
      ownership.uploaderUid.trim().length === 0
    ) {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Stored editorial image binary failed ownership verification.'
      );
      return;
    }

    if (
      binaryResult.bytes.length !== variantMeta.sizeBytes ||
      binaryResult.bytes.length > PUBLIC_IMAGE_MAX_SERVE_BYTES
    ) {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Stored editorial image binary byte length does not match canonical metadata.'
      );
      return;
    }

    const actualSha256 = computeSha256Hex(binaryResult.bytes);
    if (
      actualSha256 !== variantMeta.sha256Checksum.toLowerCase() ||
      (typeof storedMetadata.sha256Checksum === 'string' &&
        storedMetadata.sha256Checksum.length > 0 &&
        actualSha256 !== storedMetadata.sha256Checksum.toLowerCase())
    ) {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Stored editorial image binary checksum verification failed.'
      );
      return;
    }

    const binaryInspection = inspectEditorialImageBinary(binaryResult.bytes);
    if (
      binaryInspection.status !== 'PRELIMINARY_VERIFIED' ||
      binaryInspection.detectedMimeType !== 'image/webp'
    ) {
      sendSanitizedError(
        res,
        500,
        'STORAGE_INTEGRITY_ERROR',
        'Stored editorial image binary failed format inspection.'
      );
      return;
    }

    applySecurityAndNoCacheHeaders(res);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', String(binaryResult.bytes.length));
    res.status(200).send(binaryResult.bytes);
  } catch {
    sendSanitizedError(
      res,
      500,
      'INTERNAL_DELIVERY_ERROR',
      'An unexpected error occurred while processing the public image delivery request.'
    );
  }
}

export const publicEditorialImageDeliveryEndpoint = onRequest(
  {
    cors: false,
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    const runtime = createProductionPublicEditorialImageDeliveryRuntime();
    await executePublicEditorialImageDeliveryEndpoint(
      {
        method: req.method || 'GET',
        headers: req.headers as Readonly<
          Record<string, string | string[] | undefined>
        >,
        query: req.query as Readonly<Record<string, unknown>>,
        url: req.url,
      },
      {
        status(code: number) {
          res.status(code);
          return this;
        },
        setHeader(name: string, value: string) {
          res.setHeader(name, value);
          return this;
        },
        getHeader(name: string) {
          return res.getHeader(name);
        },
        json(body: unknown) {
          res.json(body);
        },
        send(body: Buffer | string) {
          res.send(body);
        },
        end(chunk?: Buffer | string) {
          if (chunk !== undefined) {
            res.end(chunk);
          } else {
            res.end();
          }
        },
      },
      runtime
    );
  }
);
