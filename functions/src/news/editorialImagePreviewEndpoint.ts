import { Buffer } from 'node:buffer';
import { onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import {
  AdminPermission,
  AdminRole,
  type AdminUser,
  hasAdminPermission,
  isValidAdminRole,
} from '../shared/adminContract';
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
import type {
  EditorialImageAssetReadResult,
  EditorialImageAssetRepository,
} from './editorialImageAssetRepository';
import {
  FirestoreEditorialImageAssetRepository,
  type EditorialImageFirestoreDatabase,
} from './firestoreEditorialImageAssetRepository';
import {
  GcsEditorialBinaryStorageAdapter,
  type GcsEditorialBinaryBucket,
  validateAndParseCanonicalStoragePath,
} from './gcsEditorialBinaryStorageAdapter';
import { DEFAULT_TRUSTED_UPLOAD_ORIGINS } from './editorialNewsImageUploadEndpoint';

/**
 * IMG-F3-09/D2-E3-B1 — Private Editorial Image Preview Endpoint
 *
 * Implements a secure read-only HTTPS endpoint for authorized human editors
 * to preview previously saved private editorial images without public bucket access,
 * signed URLs, or AI principal access.
 *
 * Invariants:
 * - GET only (OPTIONS for approved CORS preflight)
 * - Firebase ID token required (Bearer <token>)
 * - Active human administrator with AdminPermission.View
 * - Strictly rejects AI principals and inactive users
 * - Reuses DEFAULT_TRUSTED_UPLOAD_ORIGINS (never wildcard `*`)
 * - Bounded query validation: only canonical assetId and variant ('card' | 'thumbnail')
 * - Safe fail-closed responses without disclosing private storage paths or stack traces
 * - Zero storage or database mutations on read
 */

const UID_CHARS_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export const ALLOWED_PREVIEW_VARIANTS: ReadonlySet<string> = new Set([
  'card',
  'thumbnail',
]);

export interface DecodedFirebaseIdToken {
  readonly uid: string;
  readonly role?: unknown;
  readonly isAiAssistant?: unknown;
  readonly actorType?: unknown;
  readonly [key: string]: unknown;
}

export type FirebaseIdTokenVerifier = (
  idToken: string
) => Promise<DecodedFirebaseIdToken>;

export interface EditorialImagePreviewHttpRequest {
  readonly method?: string;
  readonly url?: string;
  readonly path?: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
}

export interface EditorialImagePreviewHttpResponseWriter {
  status(statusCode: number): EditorialImagePreviewHttpResponseWriter;
  setHeader(name: string, value: string): EditorialImagePreviewHttpResponseWriter;
  getHeader?(name: string): string | number | string[] | undefined;
  json(body: unknown): void;
  send?(body: Buffer | string): void;
  end?(chunk?: Buffer | string): void;
}

export interface EditorialImagePreviewEndpointDependencies {
  readonly verifyIdToken: FirebaseIdTokenVerifier;
  readonly adminRepository: AdminRepository;
  readonly assetRepository: EditorialImageAssetRepository;
  readonly storageAdapter: EditorialBinaryStorageAdapter;
  readonly trustedOrigins?: ReadonlySet<string>;
  readonly limits?: EditorialImageAssetValidationLimits;
}

export interface ProductionEditorialImagePreviewRuntime {
  readonly verifyIdToken: FirebaseIdTokenVerifier;
  readonly adminRepository: AdminRepository;
  readonly assetRepository: EditorialImageAssetRepository;
  readonly storageAdapter: EditorialBinaryStorageAdapter;
  readonly limits: EditorialImageAssetValidationLimits;
}

export interface ProductionRuntimeSdkOverrides {
  readonly getFirestore?: () => unknown;
  readonly getStorage?: () => { bucket: (name?: string) => unknown };
  readonly getAuth?: () => {
    verifyIdToken: (
      idToken: string,
      checkRevoked?: boolean
    ) => Promise<DecodedFirebaseIdToken>;
  };
  readonly bucketName?: string;
  readonly adminRepository?: AdminRepository;
  readonly limits?: EditorialImageAssetValidationLimits;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function findHeaderEntries(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined,
  targetLowerName: string
): Array<[string, string | string[] | undefined]> {
  if (!headers || typeof headers !== 'object') {
    return [];
  }
  return Object.entries(headers).filter(
    ([key, val]) => key.toLowerCase() === targetLowerName && val !== undefined
  );
}

function getSingleHeaderString(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined,
  targetLowerName: string
): { readonly present: boolean; readonly valid: boolean; readonly value?: string } {
  const entries = findHeaderEntries(headers, targetLowerName);
  if (entries.length === 0) {
    return { present: false, valid: true };
  }
  if (entries.length > 1) {
    return { present: true, valid: false };
  }
  const rawVal = entries[0][1];
  if (typeof rawVal !== 'string') {
    return { present: true, valid: false };
  }
  return { present: true, valid: true, value: rawVal };
}

function extractBearerToken(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined
): string | null {
  const authHeader = getSingleHeaderString(headers, 'authorization');
  if (!authHeader.present || !authHeader.valid || !authHeader.value) {
    return null;
  }

  const raw = authHeader.value;
  if (
    raw.startsWith(' ') ||
    raw.endsWith(' ') ||
    raw.includes('\t') ||
    raw.includes('\n') ||
    raw.includes('\r')
  ) {
    return null;
  }

  const parts = raw.split(' ');
  if (parts.length !== 2) {
    return null;
  }

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  if (!token || token.length === 0 || token.length > 8192 || /\s/.test(token)) {
    return null;
  }

  return token;
}

export function createProductionEditorialImagePreviewRuntime(
  overrides?: ProductionRuntimeSdkOverrides
): ProductionEditorialImagePreviewRuntime {
  const resolveFirestore = overrides?.getFirestore ?? getFirestore;
  const resolveStorage = overrides?.getStorage ?? getStorage;
  const resolveAuth = overrides?.getAuth ?? getAuth;
  const limits = overrides?.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;

  const firestoreInstance = resolveFirestore();
  const storageInstance = resolveStorage();
  const bucketInstance = (
    overrides?.bucketName
      ? storageInstance.bucket(overrides.bucketName)
      : storageInstance.bucket()
  ) as GcsEditorialBinaryBucket;
  const authInstance = resolveAuth();

  const adminRepository: AdminRepository =
    overrides?.adminRepository ?? new FirestoreAdminRepository();

  const assetRepository: EditorialImageAssetRepository =
    new FirestoreEditorialImageAssetRepository(
      firestoreInstance as EditorialImageFirestoreDatabase,
      limits
    );

  const storageAdapter: EditorialBinaryStorageAdapter =
    new GcsEditorialBinaryStorageAdapter({
      bucket: bucketInstance,
      limits,
    });

  const verifyIdToken: FirebaseIdTokenVerifier = async (idToken: string) => {
    return authInstance.verifyIdToken(idToken, true);
  };

  return Object.freeze({
    adminRepository,
    assetRepository,
    storageAdapter,
    limits,
    verifyIdToken,
  });
}

/**
 * Core bounded execution function for editorial image preview.
 */
export async function executeEditorialImagePreviewEndpoint(
  request: EditorialImagePreviewHttpRequest,
  response: EditorialImagePreviewHttpResponseWriter,
  dependencies: EditorialImagePreviewEndpointDependencies
): Promise<void> {
  const trustedOrigins =
    dependencies.trustedOrigins ?? DEFAULT_TRUSTED_UPLOAD_ORIGINS;
  const limits = dependencies.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;

  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  // 1. Validate Origin header if present
  const originHeader = getSingleHeaderString(request.headers, 'origin');
  if (originHeader.present) {
    const candidateOrigin = originHeader.value?.trim() ?? '';
    if (
      !originHeader.valid ||
      candidateOrigin.length === 0 ||
      candidateOrigin === '*' ||
      !trustedOrigins.has(candidateOrigin)
    ) {
      response.status(403).json({
        ok: false,
        errorCode: 'CORS_ORIGIN_FORBIDDEN',
        error: 'Forbidden Origin.',
      });
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', candidateOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type'
    );
    response.setHeader('Access-Control-Max-Age', '86400');
  }

  // 2. Handle CORS preflight OPTIONS
  if (request.method === 'OPTIONS') {
    if (originHeader.present) {
      const requestedMethod = getSingleHeaderString(
        request.headers,
        'access-control-request-method'
      );
      if (
        requestedMethod.present &&
        (!requestedMethod.valid ||
          requestedMethod.value?.trim().toUpperCase() !== 'GET')
      ) {
        response.setHeader('Allow', 'GET, OPTIONS');
        response.status(405).json({
          ok: false,
          errorCode: 'HTTP_METHOD_NOT_ALLOWED',
          error: 'Only GET is permitted for image preview.',
        });
        return;
      }
    }

    response.status(204);
    if (typeof response.end === 'function') {
      response.end();
    } else if (typeof response.send === 'function') {
      response.send('');
    } else {
      response.json({ ok: true });
    }
    return;
  }

  // 3. Enforce GET-only HTTP method
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET, OPTIONS');
    response.status(405).json({
      ok: false,
      errorCode: 'HTTP_METHOD_NOT_ALLOWED',
      error: 'HTTP method not allowed. Only GET is supported for preview.',
    });
    return;
  }

  // 4. Validate query parameters
  const query = request.query ?? {};
  const queryKeys = Object.keys(query);
  const allowedParams = new Set(['assetId', 'variant']);

  for (const key of queryKeys) {
    if (!allowedParams.has(key)) {
      response.status(400).json({
        ok: false,
        errorCode: 'INVALID_QUERY_PARAMETER',
        error: `Unknown query parameter "${key}".`,
      });
      return;
    }
  }

  // 4a. Validate assetId
  if (!('assetId' in query) || query.assetId === undefined || query.assetId === null) {
    response.status(400).json({
      ok: false,
      errorCode: 'MISSING_ASSET_ID',
      error: 'assetId query parameter is required.',
    });
    return;
  }

  const rawAssetId = query.assetId;
  if (Array.isArray(rawAssetId) || typeof rawAssetId !== 'string') {
    response.status(400).json({
      ok: false,
      errorCode: 'DUPLICATE_QUERY_PARAMETER',
      error: 'assetId must be a single string parameter.',
    });
    return;
  }

  const trimmedAssetId = rawAssetId.trim();
  if (
    trimmedAssetId.length === 0 ||
    trimmedAssetId !== rawAssetId ||
    rawAssetId.includes('/') ||
    rawAssetId.includes('\\') ||
    rawAssetId.includes('..') ||
    rawAssetId.includes('%')
  ) {
    response.status(400).json({
      ok: false,
      errorCode: 'INVALID_ASSET_ID',
      error: 'assetId contains invalid characters or path traversal sequences.',
    });
    return;
  }

  const assetValidation = validateAssetId(trimmedAssetId, limits);
  if (!assetValidation.valid) {
    response.status(400).json({
      ok: false,
      errorCode: 'INVALID_ASSET_ID',
      error: `Invalid assetId: ${assetValidation.errors.join(' ')}`,
    });
    return;
  }

  // 4b. Validate variant
  if (!('variant' in query) || query.variant === undefined || query.variant === null) {
    response.status(400).json({
      ok: false,
      errorCode: 'MISSING_VARIANT',
      error: 'variant query parameter is required.',
    });
    return;
  }

  const rawVariant = query.variant;
  if (Array.isArray(rawVariant) || typeof rawVariant !== 'string') {
    response.status(400).json({
      ok: false,
      errorCode: 'DUPLICATE_QUERY_PARAMETER',
      error: 'variant must be a single string parameter.',
    });
    return;
  }

  if (!ALLOWED_PREVIEW_VARIANTS.has(rawVariant)) {
    response.status(400).json({
      ok: false,
      errorCode: 'INVALID_VARIANT',
      error: 'variant must be either "card" or "thumbnail".',
    });
    return;
  }

  const variantKey = rawVariant as 'card' | 'thumbnail';

  // 5. Authenticate Firebase ID token
  const bearerToken = extractBearerToken(request.headers);
  if (!bearerToken) {
    response.status(401).json({
      ok: false,
      errorCode: 'UNAUTHENTICATED',
      error: 'Missing or malformed Bearer authorization token.',
    });
    return;
  }

  let decodedToken: DecodedFirebaseIdToken;
  try {
    decodedToken = await dependencies.verifyIdToken(bearerToken);
  } catch {
    response.status(401).json({
      ok: false,
      errorCode: 'UNAUTHENTICATED',
      error: 'Firebase ID token verification failed.',
    });
    return;
  }

  if (
    !decodedToken ||
    typeof decodedToken !== 'object' ||
    typeof decodedToken.uid !== 'string' ||
    decodedToken.uid.trim().length === 0 ||
    decodedToken.uid !== decodedToken.uid.trim() ||
    !UID_CHARS_REGEX.test(decodedToken.uid)
  ) {
    response.status(401).json({
      ok: false,
      errorCode: 'UNAUTHENTICATED',
      error: 'Verified Firebase token lacks a valid canonical UID.',
    });
    return;
  }

  // Reject AI assistant tokens
  if (
    decodedToken.role === AdminRole.AIAssistant ||
    decodedToken.isAiAssistant === true ||
    decodedToken.actorType === 'ai'
  ) {
    response.status(403).json({
      ok: false,
      errorCode: 'AI_PRINCIPAL_FORBIDDEN',
      error: 'AI assistant principals are strictly prohibited from private image preview.',
    });
    return;
  }

  // 6. Resolve and authorize human administrator
  let admin: AdminUser | null = null;
  try {
    admin = await dependencies.adminRepository.getAdminByUid(decodedToken.uid);
  } catch {
    response.status(500).json({
      ok: false,
      errorCode: 'STORAGE_FAILURE',
      error: 'Failed to resolve administrative account record.',
    });
    return;
  }

  if (!admin || !isPlainObject(admin as unknown)) {
    response.status(403).json({
      ok: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'Caller is not registered as a canonical AdminUser.',
    });
    return;
  }

  if (admin.id !== decodedToken.uid) {
    response.status(403).json({
      ok: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'Persisted AdminUser ID does not match verified token UID.',
    });
    return;
  }

  if (admin.isActive !== true) {
    response.status(403).json({
      ok: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'AdminUser account is inactive.',
    });
    return;
  }

  if (!isValidAdminRole(admin.role)) {
    response.status(403).json({
      ok: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'AdminUser role is invalid.',
    });
    return;
  }

  if (admin.role === AdminRole.AIAssistant) {
    response.status(403).json({
      ok: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'AI assistant accounts are prohibited from private image preview.',
    });
    return;
  }

  if (!hasAdminPermission(admin, AdminPermission.View)) {
    response.status(403).json({
      ok: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'AdminUser lacks required View permission for editorial preview.',
    });
    return;
  }

  // 7. Canonical asset lookup
  let readResult: EditorialImageAssetReadResult;
  try {
    readResult = await dependencies.assetRepository.getById(trimmedAssetId);
  } catch {
    response.status(500).json({
      ok: false,
      errorCode: 'STORAGE_FAILURE',
      error: 'Failed to query editorial image asset.',
    });
    return;
  }

  if (!readResult.ok || readResult.status !== 'FOUND' || !readResult.asset) {
    response.status(404).json({
      ok: false,
      errorCode: 'ASSET_NOT_FOUND',
      error: 'Editorial image asset not found.',
    });
    return;
  }

  const asset = readResult.asset;

  // Verify canonical asset envelope and matching assetId
  const envelopeValidation = validateEditorialImageAsset(asset, limits);
  if (!envelopeValidation.valid || asset.assetId !== trimmedAssetId) {
    response.status(404).json({
      ok: false,
      errorCode: 'INVALID_ASSET_ENVELOPE',
      error: 'Editorial image asset record failed canonical validation.',
    });
    return;
  }

  // Verify asset lifecycle status is active
  if (asset.status !== 'active') {
    response.status(404).json({
      ok: false,
      errorCode: 'ASSET_NOT_ACTIVE',
      error: 'Editorial image asset is not active.',
    });
    return;
  }

  // Verify requested variant exists in asset
  const variantRecord = asset.variants?.[variantKey];
  if (!variantRecord) {
    response.status(404).json({
      ok: false,
      errorCode: 'VARIANT_NOT_FOUND',
      error: `Requested variant "${variantKey}" not found for this asset.`,
    });
    return;
  }

  // Verify variant metadata integrity via canonical contract
  const variantValidation = validateEditorialImageAssetVariant(
    variantRecord,
    variantKey,
    limits,
    trimmedAssetId
  );
  if (
    !variantValidation.valid ||
    variantRecord.variantKey !== variantKey ||
    !variantRecord.storagePath ||
    typeof variantRecord.storagePath !== 'string' ||
    variantRecord.mimeType !== 'image/webp' ||
    typeof variantRecord.sizeBytes !== 'number' ||
    variantRecord.sizeBytes <= 0 ||
    !CANONICAL_SHA256_CHECKSUM_REGEX.test(variantRecord.sha256Checksum)
  ) {
    response.status(404).json({
      ok: false,
      errorCode: 'INVALID_VARIANT_METADATA',
      error: 'Stored variant metadata is invalid or incomplete.',
    });
    return;
  }

  // Verify storagePath is valid canonical path and matches assetId and variantKey
  try {
    const parsedPath = validateAndParseCanonicalStoragePath(
      variantRecord.storagePath,
      limits
    );
    if (
      parsedPath.assetId !== trimmedAssetId ||
      parsedPath.variantKey !== variantKey ||
      parsedPath.namespace !== 'private' ||
      parsedPath.targetKind !== 'editorial_image_asset'
    ) {
      response.status(404).json({
        ok: false,
        errorCode: 'INVALID_VARIANT_STORAGE_PATH',
        error: 'Variant storage path does not match canonical asset specification.',
      });
      return;
    }
  } catch {
    response.status(404).json({
      ok: false,
      errorCode: 'INVALID_VARIANT_STORAGE_PATH',
      error: 'Variant storage path validation failed.',
    });
    return;
  }

  // 8. Private binary delivery
  let binaryResult: { bytes: Buffer; metadata: StorageObjectMetadata } | null =
    null;
  try {
    binaryResult = await dependencies.storageAdapter.readBytes(
      variantRecord.storagePath
    );
  } catch {
    // Sanitize private storage errors: never leak private paths, bucket names, or stack traces
    response.status(500).json({
      ok: false,
      errorCode: 'STORAGE_FAILURE',
      error: 'Failed to retrieve image binary from storage.',
    });
    return;
  }

  if (
    !binaryResult ||
    !binaryResult.bytes ||
    !Buffer.isBuffer(binaryResult.bytes) ||
    binaryResult.bytes.length === 0
  ) {
    response.status(404).json({
      ok: false,
      errorCode: 'BINARY_NOT_FOUND',
      error: 'Image binary not found in storage.',
    });
    return;
  }

  // Verify binary ownership, byte size, SHA-256 checksum, and genuine WebP magic bytes
  const actualSha256 = computeSha256Hex(binaryResult.bytes);
  const binaryInspection = inspectEditorialImageBinary(binaryResult.bytes);
  if (
    binaryResult.bytes.length !== variantRecord.sizeBytes ||
    actualSha256 !== variantRecord.sha256Checksum ||
    binaryResult.metadata?.ownership?.assetId !== trimmedAssetId ||
    binaryResult.metadata?.ownership?.namespace !== 'private' ||
    binaryInspection.status !== 'PRELIMINARY_VERIFIED' ||
    binaryInspection.detectedMimeType !== 'image/webp'
  ) {
    response.status(500).json({
      ok: false,
      errorCode: 'STORAGE_FAILURE',
      error: 'Retrieved image binary failed canonical integrity verification.',
    });
    return;
  }

  // 9. Deliver genuine WebP binary with security headers
  response.setHeader('Content-Type', 'image/webp');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'");
  response.status(200);

  if (typeof response.send === 'function') {
    response.send(binaryResult.bytes);
  } else if (typeof response.end === 'function') {
    response.end(binaryResult.bytes);
  } else {
    response.json({ ok: true });
  }
}

let cachedProductionRuntime: ProductionEditorialImagePreviewRuntime | null =
  null;

function getOrCreateProductionRuntime(): ProductionEditorialImagePreviewRuntime {
  if (!cachedProductionRuntime) {
    cachedProductionRuntime = createProductionEditorialImagePreviewRuntime();
  }
  return cachedProductionRuntime;
}

/**
 * Firebase Functions v2 HTTPS endpoint for authenticated editorial image preview.
 */
export const editorialImagePreviewEndpoint = onRequest(
  {
    cors: false,
    maxInstances: 10,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request, response) => {
    const runtime = getOrCreateProductionRuntime();

    await executeEditorialImagePreviewEndpoint(
      {
        method: request.method,
        url: request.url,
        path: request.path,
        query: request.query as Readonly<Record<string, unknown>>,
        headers: request.headers as Readonly<
          Record<string, string | string[] | undefined>
        >,
      },
      response,
      runtime
    );
  }
);
