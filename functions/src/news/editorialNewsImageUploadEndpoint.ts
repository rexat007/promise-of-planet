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
import { validateAssetId } from '../shared/editorialImageAssetContract';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetOrigin,
  type EditorialImageAssetValidationLimits,
} from '../types/editorialImageAsset';
import {
  DEFAULT_IMAGE_INSPECTION_POLICY,
  type EditorialBinaryRejectionCode,
} from './editorialBinaryInspector';
import {
  EditorialBinaryIntakeError,
  type EditorialBinaryIntakeErrorCode,
  EditorialBinaryIntakeService,
  type EditorialBinaryStorageAdapter,
  type EditorialImageBinaryIntakeResult,
  type EditorialRightsEvidenceRegistrationBridge,
  type IngestEditorialImageBinaryInput,
  type IntakeSessionStore,
  validateIntakeId,
} from './editorialBinaryIntakeService';
import type { EditorialImageAssetRepository } from './editorialImageAssetRepository';
import {
  EditorialImageRightsReviewService,
  FirestoreEditorialImageRightsReviewRunner,
} from './editorialImageRightsReviewService';
import {
  FirestoreEditorialBinaryIntakeSessionStore,
  type IntakeSessionFirestoreDatabase,
} from './firestoreEditorialBinaryIntakeSessionStore';
import {
  FirestoreEditorialImageAssetRepository,
  type EditorialImageFirestoreDatabase,
} from './firestoreEditorialImageAssetRepository';
import {
  GcsEditorialBinaryStorageAdapter,
  type GcsEditorialBinaryBucket,
} from './gcsEditorialBinaryStorageAdapter';

/**
 * IMG-F3-09/B — Secure News Image Binary Intake Endpoint
 *
 * Exposes an authenticated, human-only HTTP endpoint for genuine editorial image
 * binary intake using Firebase Functions v2 `onRequest`, reusing the accepted
 * `EditorialBinaryIntakeService` saga and Sharp 5-variant WebP processor.
 *
 * Security & Transport Invariants:
 * - POST only (with explicit trusted-origin CORS preflight support)
 * - Firebase ID token verification (`Bearer <token>`)
 * - Active human administrator authorization (`Create`, `Edit`, or `ManageRights`)
 * - AI assistant identities strictly rejected
 * - Explicit trusted origin / CORS allowlist (never wildcard `*`)
 * - Bounded binary payload enforcement (`<= 15,000,000` bytes)
 * - No base64 JSON transport, no multipart stream hang, no unbounded body parsing
 * - No user-controlled GCS paths or bucket names
 * - Minimal authenticated response: never leaks private storage paths, raw bytes,
 *   internal session records, or rights-approval claims.
 */

export const MAX_UPLOAD_SOURCE_BYTES =
  DEFAULT_IMAGE_INSPECTION_POLICY.maxSizeBytes; // 15,000,000 bytes
export const MAX_METADATA_HEADER_BYTES = 16_384 as const;

export const DEFAULT_TRUSTED_UPLOAD_ORIGINS: ReadonlySet<string> = new Set([
  'https://promiseofplanet.org',
  'https://www.promiseofplanet.org',
  'https://promiseofplanet-bb325.web.app',
  'https://promiseofplanet-bb325.firebaseapp.com',
  'https://promise-of-planet.web.app',
  'https://promise-of-planet.firebaseapp.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
]);

export const ALLOWED_BINARY_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/octet-stream',
]);

const VALID_IMAGE_ORIGINS: ReadonlySet<EditorialImageAssetOrigin> = new Set([
  'news_article',
  'standalone_upload',
  'editorial_library',
]);

const ALLOWED_METADATA_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'intakeId',
  'assetId',
  'originalFilename',
  'claimedMimeType',
  'claimedFilenameOrExtension',
  'origin',
  'altAr',
  'altEn',
  'captionAr',
  'captionEn',
  'photographerCredit',
  'licensingInfo',
  'tags',
  'associatedArticleIds',
]);

const FORBIDDEN_PATH_OR_STORAGE_HEADERS: ReadonlySet<string> = new Set([
  'x-storage-path',
  'x-gcs-path',
  'x-bucket',
  'x-bucket-name',
  'x-target-path',
  'x-destination-path',
  'x-public-url',
  'x-rights-status',
  'x-uploader-uid',
  'x-created-by-uid',
]);

const UID_CHARS_REGEX = /^[A-Za-z0-9_.:-]{1,128}$/;

export type EditorialNewsImageUploadErrorCode =
  | EditorialBinaryIntakeErrorCode
  | 'HTTP_METHOD_NOT_ALLOWED'
  | 'CORS_ORIGIN_FORBIDDEN'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'EMPTY_BINARY'
  | 'INTERNAL_ERROR';

export type EditorialNewsImageUploadOutcomeStatus =
  | 'Completed'
  | 'CleanupPending'
  | 'Rejected'
  | 'Failed'
  | 'NeedsReconciliation';

export interface EditorialNewsImageUploadSuccessResponse {
  readonly ok: true;
  readonly intakeId: string;
  readonly assetId: string;
  readonly status: 'Completed' | 'CleanupPending';
  readonly errorCode?: 'CLEANUP_INCOMPLETE';
}

export interface EditorialNewsImageUploadErrorResponse {
  readonly ok: false;
  readonly intakeId?: string;
  readonly assetId?: string;
  readonly status: 'Rejected' | 'Failed' | 'NeedsReconciliation' | 'CleanupPending';
  readonly errorCode: EditorialNewsImageUploadErrorCode;
  readonly rejectionCode?: EditorialBinaryRejectionCode;
}

export type EditorialNewsImageUploadResponseBody =
  | EditorialNewsImageUploadSuccessResponse
  | EditorialNewsImageUploadErrorResponse;

export interface DecodedFirebaseIdToken {
  readonly uid: string;
  readonly [key: string]: unknown;
}

export type FirebaseIdTokenVerifier = (
  idToken: string
) => Promise<DecodedFirebaseIdToken>;

export interface EditorialNewsImageUploadHttpRequest {
  readonly method?: string;
  readonly url?: string;
  readonly path?: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody?: unknown;
  readonly body?: unknown;
}

export interface EditorialNewsImageUploadHttpResponseWriter {
  setHeader(name: string, value: string): void;
  status(code: number): EditorialNewsImageUploadHttpResponseWriter;
  json(body: EditorialNewsImageUploadResponseBody): unknown;
  end?(): unknown;
}

export interface EditorialNewsImageUploadIntakeExecutor {
  ingestEditorialImageBinary(
    requestContext: {
      readonly auth?: {
        readonly uid: string;
        readonly token?: Record<string, unknown>;
      };
    },
    rawInput: IngestEditorialImageBinaryInput
  ): Promise<EditorialImageBinaryIntakeResult>;
}

export interface EditorialNewsImageUploadEndpointDependencies {
  readonly verifyIdToken: FirebaseIdTokenVerifier;
  readonly adminRepository: AdminRepository;
  readonly intakeService: EditorialNewsImageUploadIntakeExecutor;
  readonly trustedOrigins?: ReadonlySet<string>;
  readonly maxUploadBytes?: number;
  readonly limits?: EditorialImageAssetValidationLimits;
}

export interface ProductionEditorialNewsImageUploadRuntime {
  readonly adminRepository: AdminRepository;
  readonly assetRepository: EditorialImageAssetRepository;
  readonly rightsEvidenceBridge: EditorialRightsEvidenceRegistrationBridge;
  readonly storageAdapter: EditorialBinaryStorageAdapter;
  readonly sessionStore: IntakeSessionStore;
  readonly intakeService: EditorialBinaryIntakeService;
  readonly verifyIdToken: FirebaseIdTokenVerifier;
}

export interface ProductionRuntimeSdkOverrides {
  readonly adminRepository?: AdminRepository;
  readonly getFirestore?: () => unknown;
  readonly getStorage?: () => { bucket: (name?: string) => unknown };
  readonly getAuth?: () => {
    verifyIdToken: (
      idToken: string,
      checkRevoked?: boolean
    ) => Promise<DecodedFirebaseIdToken>;
  };
  readonly bucketName?: string;
  readonly limits?: EditorialImageAssetValidationLimits;
}

/**
 * Assembles the production dependency graph for `EditorialBinaryIntakeService`
 * using exclusively the accepted production Firestore, GCS, Admin, and Rights
 * Review adapters. Zero mock, in-memory, or no-op substitutes.
 */
export function createProductionEditorialNewsImageUploadRuntime(
  overrides?: ProductionRuntimeSdkOverrides
): ProductionEditorialNewsImageUploadRuntime {
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

  const rightsReviewRunner = new FirestoreEditorialImageRightsReviewRunner(
    firestoreInstance as EditorialImageFirestoreDatabase,
    limits
  );

  const rightsEvidenceBridge: EditorialRightsEvidenceRegistrationBridge =
    new EditorialImageRightsReviewService({
      adminRepository,
      transactionRunner: rightsReviewRunner,
      limits,
    });

  const storageAdapter: EditorialBinaryStorageAdapter =
    new GcsEditorialBinaryStorageAdapter({
      bucket: bucketInstance,
      limits,
    });

  const sessionStore: IntakeSessionStore =
    new FirestoreEditorialBinaryIntakeSessionStore(
      firestoreInstance as IntakeSessionFirestoreDatabase,
      limits
    );

  const intakeService = new EditorialBinaryIntakeService({
    adminRepository,
    assetRepository,
    rightsEvidenceBridge,
    storageAdapter,
    sessionStore,
    limits,
  });

  const verifyIdToken: FirebaseIdTokenVerifier = async (idToken: string) => {
    return authInstance.verifyIdToken(idToken, true);
  };

  return Object.freeze({
    adminRepository,
    assetRepository,
    rightsEvidenceBridge,
    storageAdapter,
    sessionStore,
    intakeService,
    verifyIdToken,
  });
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

function decodeHeaderValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('%')) {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Malformed percent-encoded header value.',
      });
    }
  }
  return trimmed;
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

async function verifyAndAuthorizeHumanAdmin(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined,
  verifyIdToken: FirebaseIdTokenVerifier,
  adminRepository: AdminRepository
): Promise<{
  readonly admin: AdminUser;
  readonly decodedToken: DecodedFirebaseIdToken;
}> {
  const bearerToken = extractBearerToken(headers);
  if (!bearerToken) {
    throw new EditorialBinaryIntakeError({
      code: 'UNAUTHENTICATED',
      message: 'Missing or malformed Bearer authentication token.',
    });
  }

  let decodedToken: DecodedFirebaseIdToken;
  try {
    decodedToken = await verifyIdToken(bearerToken);
  } catch {
    throw new EditorialBinaryIntakeError({
      code: 'UNAUTHENTICATED',
      message: 'Firebase ID token verification failed.',
    });
  }

  if (
    !decodedToken ||
    typeof decodedToken !== 'object' ||
    typeof decodedToken.uid !== 'string' ||
    decodedToken.uid.trim().length === 0 ||
    decodedToken.uid !== decodedToken.uid.trim() ||
    !UID_CHARS_REGEX.test(decodedToken.uid)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'UNAUTHENTICATED',
      message: 'Verified Firebase token lacks a valid canonical UID.',
    });
  }

  // Reject tokens carrying explicit AI assistant claims
  if (
    decodedToken.role === AdminRole.AIAssistant ||
    decodedToken.isAiAssistant === true ||
    decodedToken.actorType === 'ai'
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'PERMISSION_DENIED',
      message: 'AI assistant identities are forbidden from binary intake.',
    });
  }

  let admin: AdminUser | null = null;
  try {
    admin = await adminRepository.getAdminByUid(decodedToken.uid);
  } catch {
    throw new EditorialBinaryIntakeError({
      code: 'STORAGE_FAILURE',
      message: 'Failed to resolve administrative account record.',
    });
  }

  if (!admin || !isPlainObject(admin as unknown)) {
    throw new EditorialBinaryIntakeError({
      code: 'PERMISSION_DENIED',
      message: 'Caller is not registered as a canonical AdminUser.',
    });
  }

  if (admin.id !== decodedToken.uid) {
    throw new EditorialBinaryIntakeError({
      code: 'PERMISSION_DENIED',
      message: 'Persisted AdminUser ID does not match verified token UID.',
    });
  }

  if (admin.isActive !== true) {
    throw new EditorialBinaryIntakeError({
      code: 'PERMISSION_DENIED',
      message: 'AdminUser account is inactive.',
    });
  }

  if (!isValidAdminRole(admin.role)) {
    throw new EditorialBinaryIntakeError({
      code: 'PERMISSION_DENIED',
      message: 'AdminUser role is invalid.',
    });
  }

  if (admin.role === AdminRole.AIAssistant) {
    throw new EditorialBinaryIntakeError({
      code: 'PERMISSION_DENIED',
      message: 'AI assistant accounts are prohibited from binary image intake.',
    });
  }

  const canIngestImage =
    hasAdminPermission(admin, AdminPermission.Create) ||
    hasAdminPermission(admin, AdminPermission.Edit) ||
    hasAdminPermission(admin, AdminPermission.ManageRights);

  if (!canIngestImage) {
    throw new EditorialBinaryIntakeError({
      code: 'PERMISSION_DENIED',
      message:
        'AdminUser lacks required Create, Edit, or ManageRights permission for image intake.',
    });
  }

  return { admin, decodedToken };
}

function parseContentTypeHeader(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined
): {
  readonly mediaType: string;
  readonly claimedMimeType?: string;
} {
  const transferEncoding = getSingleHeaderString(
    headers,
    'content-transfer-encoding'
  );
  if (
    transferEncoding.present &&
    (!transferEncoding.valid ||
      (transferEncoding.value &&
        transferEncoding.value.trim().toLowerCase() !== 'binary'))
  ) {
    throw {
      status: 415,
      errorCode: 'UNSUPPORTED_CONTENT_TYPE' as const,
    };
  }

  const ctHeader = getSingleHeaderString(headers, 'content-type');
  if (!ctHeader.present || !ctHeader.valid || !ctHeader.value) {
    throw {
      status: 415,
      errorCode: 'UNSUPPORTED_CONTENT_TYPE' as const,
    };
  }

  const rawCt = ctHeader.value.trim();
  if (/base64/i.test(rawCt)) {
    throw {
      status: 415,
      errorCode: 'UNSUPPORTED_CONTENT_TYPE' as const,
    };
  }

  const semiIndex = rawCt.indexOf(';');
  const mediaType = (
    semiIndex >= 0 ? rawCt.slice(0, semiIndex) : rawCt
  )
    .trim()
    .toLowerCase();

  if (!ALLOWED_BINARY_CONTENT_TYPES.has(mediaType)) {
    throw {
      status: 415,
      errorCode: 'UNSUPPORTED_CONTENT_TYPE' as const,
    };
  }

  const claimedMimeType =
    mediaType === 'application/octet-stream' ? undefined : mediaType;

  return { mediaType, claimedMimeType };
}

function extractBoundedBinaryBody(
  request: EditorialNewsImageUploadHttpRequest,
  maxUploadBytes: number
): Buffer {
  const clHeader = getSingleHeaderString(request.headers, 'content-length');
  let declaredLength: number | undefined;

  if (clHeader.present) {
    if (!clHeader.valid || !clHeader.value) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Invalid Content-Length header.',
      });
    }
    const trimmedCl = clHeader.value.trim();
    if (!/^\d+$/.test(trimmedCl)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Content-Length must be a non-negative integer.',
      });
    }
    declaredLength = Number.parseInt(trimmedCl, 10);
    if (!Number.isSafeInteger(declaredLength)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Content-Length is not a safe integer.',
      });
    }
    if (declaredLength === 0) {
      throw new EditorialBinaryIntakeError({
        code: 'BINARY_REJECTED',
        message: 'Request binary payload must not be empty.',
        rejectionCode: 'EMPTY_BINARY',
      });
    }
    if (declaredLength > maxUploadBytes) {
      throw new EditorialBinaryIntakeError({
        code: 'BINARY_REJECTED',
        message: `Content-Length (${declaredLength}) exceeds maximum allowed upload size of ${maxUploadBytes} bytes.`,
        rejectionCode: 'SIZE_LIMIT_EXCEEDED',
      });
    }
  }

  // Reject any parsed JSON / string / base64 body objects
  if (
    request.body !== undefined &&
    request.body !== null &&
    !Buffer.isBuffer(request.body) &&
    !(request.body instanceof Uint8Array)
  ) {
    // Allow Express empty default `{}` ONLY if `rawBody` is a genuine Buffer/Uint8Array
    const isEmptyPlainBody =
      isPlainObject(request.body) &&
      Object.keys(request.body).length === 0 &&
      (Buffer.isBuffer(request.rawBody) ||
        request.rawBody instanceof Uint8Array);

    if (!isEmptyPlainBody) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message:
          'Request body must be raw binary bytes (Buffer); JSON or base64 text payloads are forbidden.',
      });
    }
  }

  let binaryBuffer: Buffer | null = null;

  if (request.rawBody !== undefined && request.rawBody !== null) {
    if (Buffer.isBuffer(request.rawBody)) {
      binaryBuffer = request.rawBody;
    } else if (request.rawBody instanceof Uint8Array) {
      binaryBuffer = Buffer.from(
        request.rawBody.buffer,
        request.rawBody.byteOffset,
        request.rawBody.byteLength
      );
    } else {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'request.rawBody must be a binary Buffer or Uint8Array.',
      });
    }
  } else if (request.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body)) {
      binaryBuffer = request.body;
    } else if (request.body instanceof Uint8Array) {
      binaryBuffer = Buffer.from(
        request.body.buffer,
        request.body.byteOffset,
        request.body.byteLength
      );
    }
  }

  if (!binaryBuffer || binaryBuffer.byteLength === 0) {
    throw new EditorialBinaryIntakeError({
      code: 'BINARY_REJECTED',
      message: 'Binary upload payload is missing or empty.',
      rejectionCode: 'EMPTY_BINARY',
    });
  }

  if (binaryBuffer.byteLength > maxUploadBytes) {
    throw new EditorialBinaryIntakeError({
      code: 'BINARY_REJECTED',
      message: `Binary payload (${binaryBuffer.byteLength} bytes) exceeds maximum allowed limit of ${maxUploadBytes} bytes.`,
      rejectionCode: 'SIZE_LIMIT_EXCEEDED',
    });
  }

  if (
    declaredLength !== undefined &&
    binaryBuffer.byteLength !== declaredLength
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Binary byte length (${binaryBuffer.byteLength}) does not match Content-Length (${declaredLength}).`,
    });
  }

  return Buffer.from(binaryBuffer);
}

function parseUploadMetadataAndBuildInput(
  request: EditorialNewsImageUploadHttpRequest,
  binaryBuffer: Buffer,
  contentTypeClaimedMime: string | undefined,
  limits: EditorialImageAssetValidationLimits
): IngestEditorialImageBinaryInput {
  const headers = request.headers;

  // Reject any query parameters or user-supplied storage path headers
  if (
    request.query &&
    typeof request.query === 'object' &&
    Object.keys(request.query).length > 0
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Query parameters are not permitted on binary intake requests.',
    });
  }

  if (typeof request.url === 'string' && request.url.includes('?')) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Query strings are not permitted on binary intake requests.',
    });
  }

  if (headers) {
    for (const rawKey of Object.keys(headers)) {
      const lowerKey = rawKey.toLowerCase();
      if (
        FORBIDDEN_PATH_OR_STORAGE_HEADERS.has(lowerKey) &&
        headers[rawKey] !== undefined
      ) {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Forbidden caller-supplied header "${lowerKey}".`,
        });
      }
    }
  }

  // Parse optional structured JSON metadata header (`x-editorial-image-metadata` or `x-editorial-metadata`)
  const metaHeaderPrimary = getSingleHeaderString(
    headers,
    'x-editorial-image-metadata'
  );
  const metaHeaderAlias = getSingleHeaderString(
    headers,
    'x-editorial-metadata'
  );

  if (!metaHeaderPrimary.valid || !metaHeaderAlias.valid) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Duplicate or invalid editorial metadata headers.',
    });
  }

  if (metaHeaderPrimary.present && metaHeaderAlias.present) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message:
        'Provide at most one metadata envelope header (x-editorial-image-metadata).',
    });
  }

  let parsedEnvelope: Record<string, unknown> = {};
  const rawEnvelopeStr = metaHeaderPrimary.present
    ? metaHeaderPrimary.value
    : metaHeaderAlias.value;

  if (rawEnvelopeStr !== undefined) {
    if (
      rawEnvelopeStr.trim().length === 0 ||
      Buffer.byteLength(rawEnvelopeStr, 'utf8') > MAX_METADATA_HEADER_BYTES
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Metadata header is empty or exceeds maximum byte length.',
      });
    }

    const decodedJsonStr = decodeHeaderValue(rawEnvelopeStr);
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodedJsonStr);
    } catch {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Metadata header must be valid JSON.',
      });
    }

    if (!isPlainObject(parsed)) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Metadata header must decode to a plain JSON object.',
      });
    }

    const unexpectedKeys = Object.keys(parsed).filter(
      (k) => !ALLOWED_METADATA_ENVELOPE_KEYS.has(k)
    );
    if (unexpectedKeys.length > 0) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Metadata header contains forbidden or unknown fields: ${unexpectedKeys.join(', ')}.`,
      });
    }

    parsedEnvelope = parsed;
  }

  // Resolve individual header overrides / values and check consistency if both are provided
  const resolveStringField = (
    envelopeKey: string,
    headerNames: readonly string[]
  ): string | undefined => {
    let headerVal: string | undefined;
    for (const hName of headerNames) {
      const h = getSingleHeaderString(headers, hName);
      if (!h.valid) {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Invalid header "${hName}".`,
        });
      }
      if (h.present && h.value !== undefined) {
        const decoded = decodeHeaderValue(h.value);
        if (headerVal !== undefined && headerVal !== decoded) {
          throw new EditorialBinaryIntakeError({
            code: 'INVALID_INPUT',
            message: `Conflicting values for header "${hName}".`,
          });
        }
        headerVal = decoded;
      }
    }

    const envVal = parsedEnvelope[envelopeKey];
    if (envVal !== undefined) {
      if (typeof envVal !== 'string') {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Metadata field "${envelopeKey}" must be a string.`,
        });
      }
      if (headerVal !== undefined && headerVal !== envVal) {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Header value for "${envelopeKey}" conflicts with metadata envelope.`,
        });
      }
      return envVal;
    }

    return headerVal;
  };

  const resolveStringArrayField = (
    envelopeKey: string,
    headerName: string
  ): readonly string[] | undefined => {
    const h = getSingleHeaderString(headers, headerName);
    if (!h.valid) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid header "${headerName}".`,
      });
    }

    let fromHeader: string[] | undefined;
    if (h.present && h.value !== undefined) {
      const decoded = decodeHeaderValue(h.value);
      let parsedArr: unknown;
      try {
        parsedArr = JSON.parse(decoded);
      } catch {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Header "${headerName}" must be a valid JSON string array.`,
        });
      }
      if (
        !Array.isArray(parsedArr) ||
        parsedArr.some((item) => typeof item !== 'string')
      ) {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Header "${headerName}" must be an array of strings.`,
        });
      }
      fromHeader = parsedArr as string[];
    }

    const envVal = parsedEnvelope[envelopeKey];
    if (envVal !== undefined) {
      if (
        !Array.isArray(envVal) ||
        envVal.some((item) => typeof item !== 'string')
      ) {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Metadata field "${envelopeKey}" must be an array of strings.`,
        });
      }
      if (
        fromHeader !== undefined &&
        JSON.stringify(fromHeader) !== JSON.stringify(envVal)
      ) {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Header "${headerName}" conflicts with metadata envelope "${envelopeKey}".`,
        });
      }
      return envVal as string[];
    }

    return fromHeader;
  };

  const rawIntakeId = resolveStringField('intakeId', ['x-intake-id']);
  const rawAssetId = resolveStringField('assetId', ['x-asset-id']);

  const validIntakeId = validateIntakeId(rawIntakeId);
  const assetCheck = validateAssetId(rawAssetId, limits);
  if (!assetCheck.valid || typeof rawAssetId !== 'string') {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Invalid assetId: ${assetCheck.errors.join(' ')}`,
      intakeId: validIntakeId,
      details: assetCheck.errors,
    });
  }

  const originalFilename = resolveStringField('originalFilename', [
    'x-original-filename',
  ]);
  if (
    typeof originalFilename !== 'string' ||
    originalFilename.trim().length === 0 ||
    originalFilename.includes('/') ||
    originalFilename.includes('\\') ||
    originalFilename.includes('..')
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message:
        'originalFilename is required and must not contain path separators or traversal segments.',
      intakeId: validIntakeId,
    });
  }

  const rawOrigin = resolveStringField('origin', [
    'x-image-origin',
    'x-origin',
  ]);
  if (
    typeof rawOrigin !== 'string' ||
    !VALID_IMAGE_ORIGINS.has(rawOrigin as EditorialImageAssetOrigin)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message:
        'origin must be one of "news_article", "standalone_upload", or "editorial_library".',
      intakeId: validIntakeId,
    });
  }

  const altAr = resolveStringField('altAr', ['x-alt-ar']);
  if (typeof altAr !== 'string' || altAr.trim().length === 0) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'altAr is required and must be a non-empty string.',
      intakeId: validIntakeId,
    });
  }

  const envelopeClaimedMime = resolveStringField('claimedMimeType', [
    'x-claimed-mime-type',
  ]);
  if (
    contentTypeClaimedMime !== undefined &&
    envelopeClaimedMime !== undefined &&
    envelopeClaimedMime.trim().toLowerCase() !== contentTypeClaimedMime
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'BINARY_REJECTED',
      message:
        'claimedMimeType in metadata conflicts with HTTP Content-Type header.',
      intakeId: validIntakeId,
      rejectionCode: 'CLAIMED_MIME_MISMATCH',
    });
  }

  const effectiveClaimedMime =
    contentTypeClaimedMime ??
    (envelopeClaimedMime ? envelopeClaimedMime.trim().toLowerCase() : undefined);

  const explicitClaimedFilename = resolveStringField(
    'claimedFilenameOrExtension',
    ['x-claimed-extension']
  );

  const altEn = resolveStringField('altEn', ['x-alt-en']);
  const captionAr = resolveStringField('captionAr', ['x-caption-ar']);
  const captionEn = resolveStringField('captionEn', ['x-caption-en']);
  const photographerCredit = resolveStringField('photographerCredit', [
    'x-photographer-credit',
  ]);
  const licensingInfo = resolveStringField('licensingInfo', [
    'x-licensing-info',
  ]);
  const tags = resolveStringArrayField('tags', 'x-tags');
  const associatedArticleIds = resolveStringArrayField(
    'associatedArticleIds',
    'x-associated-article-ids'
  );

  return {
    intakeId: validIntakeId,
    assetId: rawAssetId,
    binary: binaryBuffer,
    originalFilename,
    claimedMimeType: effectiveClaimedMime,
    claimedFilenameOrExtension: explicitClaimedFilename ?? originalFilename,
    origin: rawOrigin as EditorialImageAssetOrigin,
    altAr,
    ...(altEn !== undefined ? { altEn } : {}),
    ...(captionAr !== undefined ? { captionAr } : {}),
    ...(captionEn !== undefined ? { captionEn } : {}),
    ...(photographerCredit !== undefined ? { photographerCredit } : {}),
    ...(licensingInfo !== undefined ? { licensingInfo } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(associatedArticleIds !== undefined ? { associatedArticleIds } : {}),
  };
}

function tryExtractSafeIdentifiers(
  request: EditorialNewsImageUploadHttpRequest,
  limits: EditorialImageAssetValidationLimits
): { readonly intakeId?: string; readonly assetId?: string } {
  let intakeId: string | undefined;
  let assetId: string | undefined;

  try {
    const hIntake = getSingleHeaderString(request.headers, 'x-intake-id');
    if (hIntake.present && hIntake.valid && hIntake.value) {
      intakeId = validateIntakeId(decodeHeaderValue(hIntake.value));
    }
  } catch {
    intakeId = undefined;
  }

  try {
    const hAsset = getSingleHeaderString(request.headers, 'x-asset-id');
    if (hAsset.present && hAsset.valid && hAsset.value) {
      const candidate = decodeHeaderValue(hAsset.value);
      if (validateAssetId(candidate, limits).valid) {
        assetId = candidate;
      }
    }
  } catch {
    assetId = undefined;
  }

  if (!intakeId || !assetId) {
    try {
      const metaPrimary = getSingleHeaderString(
        request.headers,
        'x-editorial-image-metadata'
      );
      const metaAlias = getSingleHeaderString(
        request.headers,
        'x-editorial-metadata'
      );
      const raw = metaPrimary.present ? metaPrimary.value : metaAlias.value;
      if (
        raw &&
        Buffer.byteLength(raw, 'utf8') <= MAX_METADATA_HEADER_BYTES
      ) {
        const parsed = JSON.parse(decodeHeaderValue(raw));
        if (isPlainObject(parsed)) {
          if (!intakeId && typeof parsed.intakeId === 'string') {
            try {
              intakeId = validateIntakeId(parsed.intakeId);
            } catch {
              // ignore invalid intakeId
            }
          }
          if (!assetId && typeof parsed.assetId === 'string') {
            if (validateAssetId(parsed.assetId, limits).valid) {
              assetId = parsed.assetId;
            }
          }
        }
      }
    } catch {
      // ignore malformed envelope when extracting safe error context
    }
  }

  return {
    ...(intakeId !== undefined ? { intakeId } : {}),
    ...(assetId !== undefined ? { assetId } : {}),
  };
}

function mapIntakeErrorToHttpResponse(
  err: EditorialBinaryIntakeError,
  fallbackIds: { readonly intakeId?: string; readonly assetId?: string }
): {
  readonly httpStatus: number;
  readonly body: EditorialNewsImageUploadErrorResponse;
} {
  const safeIntakeId = err.intakeId ?? fallbackIds.intakeId;
  const safeAssetId = fallbackIds.assetId;

  const resolveErrorStatus = (
    fallback: 'Rejected' | 'Failed' | 'NeedsReconciliation' | 'CleanupPending'
  ): 'Rejected' | 'Failed' | 'NeedsReconciliation' | 'CleanupPending' => {
    if (err.sessionStatus === 'NeedsReconciliation') {
      return 'NeedsReconciliation';
    }
    if (err.sessionStatus === 'CleanupPending') {
      return 'CleanupPending';
    }
    if (err.sessionStatus === 'Failed') {
      return 'Failed';
    }
    return fallback;
  };

  let httpStatus = 500;
  let errorCode: EditorialNewsImageUploadErrorCode = err.code;
  let outcomeStatus:
    | 'Rejected'
    | 'Failed'
    | 'NeedsReconciliation'
    | 'CleanupPending' = resolveErrorStatus('Failed');

  switch (err.code) {
    case 'UNAUTHENTICATED':
      httpStatus = 401;
      outcomeStatus = 'Rejected';
      break;
    case 'PERMISSION_DENIED':
      httpStatus = 403;
      outcomeStatus = 'Rejected';
      break;
    case 'INVALID_INPUT':
      httpStatus = 400;
      outcomeStatus = resolveErrorStatus('Rejected');
      break;
    case 'BINARY_REJECTED':
      if (err.rejectionCode === 'SIZE_LIMIT_EXCEEDED') {
        httpStatus = 413;
        errorCode = 'SIZE_LIMIT_EXCEEDED';
        outcomeStatus = resolveErrorStatus('Rejected');
      } else if (err.rejectionCode === 'EMPTY_BINARY') {
        httpStatus = 400;
        errorCode = 'EMPTY_BINARY';
        outcomeStatus = resolveErrorStatus('Rejected');
      } else {
        httpStatus = 422;
        outcomeStatus = resolveErrorStatus('Failed');
      }
      break;
    case 'INTAKE_ID_CONFLICT':
    case 'ASSET_ALREADY_EXISTS':
    case 'EVIDENCE_ALREADY_EXISTS':
    case 'STORAGE_CONFLICT':
      httpStatus = 409;
      outcomeStatus = resolveErrorStatus('Failed');
      break;
    case 'NOT_FOUND':
      httpStatus = 404;
      outcomeStatus = resolveErrorStatus('Failed');
      break;
    case 'RECONCILIATION_REQUIRED':
      httpStatus = 503;
      outcomeStatus = 'NeedsReconciliation';
      break;
    case 'CLEANUP_INCOMPLETE':
      httpStatus = 500;
      outcomeStatus = 'CleanupPending';
      break;
    case 'STORAGE_FAILURE':
    case 'REGISTRATION_FAILURE':
    default:
      httpStatus = 500;
      outcomeStatus = resolveErrorStatus('Failed');
      break;
  }

  return {
    httpStatus,
    body: {
      ok: false,
      ...(safeIntakeId !== undefined ? { intakeId: safeIntakeId } : {}),
      ...(safeAssetId !== undefined ? { assetId: safeAssetId } : {}),
      status: outcomeStatus,
      errorCode,
      ...(err.rejectionCode !== undefined
        ? { rejectionCode: err.rejectionCode }
        : {}),
    },
  };
}

/**
 * Executes the bounded HTTP editorial news image upload endpoint against
 * injected or production dependencies.
 */
export async function executeEditorialNewsImageUploadEndpoint(
  request: EditorialNewsImageUploadHttpRequest,
  response: EditorialNewsImageUploadHttpResponseWriter,
  dependencies: EditorialNewsImageUploadEndpointDependencies
): Promise<void> {
  const trustedOrigins =
    dependencies.trustedOrigins ?? DEFAULT_TRUSTED_UPLOAD_ORIGINS;
  const maxUploadBytes =
    dependencies.maxUploadBytes ?? MAX_UPLOAD_SOURCE_BYTES;
  const limits = dependencies.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;

  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  // 1. Validate explicit trusted Origin / CORS policy
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
        status: 'Rejected',
        errorCode: 'CORS_ORIGIN_FORBIDDEN',
      });
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', candidateOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Editorial-Image-Metadata, X-Intake-Id, X-Asset-Id, X-Original-Filename, X-Image-Origin, X-Alt-Ar, X-Alt-En, X-Caption-Ar, X-Caption-En, X-Photographer-Credit, X-Licensing-Info, X-Tags, X-Associated-Article-Ids'
    );
    response.setHeader('Access-Control-Max-Age', '3600');
  }

  // Handle CORS preflight OPTIONS when a trusted Origin header is present
  if (request.method === 'OPTIONS' && originHeader.present) {
    const requestedMethod = getSingleHeaderString(
      request.headers,
      'access-control-request-method'
    );
    if (
      requestedMethod.present &&
      (!requestedMethod.valid ||
        requestedMethod.value?.trim().toUpperCase() !== 'POST')
    ) {
      response.setHeader('Allow', 'POST');
      response.status(405).json({
        ok: false,
        status: 'Rejected',
        errorCode: 'HTTP_METHOD_NOT_ALLOWED',
      });
      return;
    }

    response.status(204);
    if (typeof response.end === 'function') {
      response.end();
    } else {
      response.json({
        ok: true,
        intakeId: 'preflight',
        assetId: 'preflight',
        status: 'Completed',
      });
    }
    return;
  }

  // 2. Enforce POST-only HTTP method
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({
      ok: false,
      status: 'Rejected',
      errorCode: 'HTTP_METHOD_NOT_ALLOWED',
    });
    return;
  }

  const fallbackIds = tryExtractSafeIdentifiers(request, limits);

  try {
    // 3. Authenticate Firebase ID token and authorize active human administrator
    const { admin, decodedToken } = await verifyAndAuthorizeHumanAdmin(
      request.headers,
      dependencies.verifyIdToken,
      dependencies.adminRepository
    );

    // 4. Validate Content-Type header (forbid JSON / base64 / multipart / text)
    let contentTypeInfo: {
      readonly mediaType: string;
      readonly claimedMimeType?: string;
    };
    try {
      contentTypeInfo = parseContentTypeHeader(request.headers);
    } catch {
      response.status(415).json({
        ok: false,
        ...(fallbackIds.intakeId !== undefined
          ? { intakeId: fallbackIds.intakeId }
          : {}),
        ...(fallbackIds.assetId !== undefined
          ? { assetId: fallbackIds.assetId }
          : {}),
        status: 'Rejected',
        errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      });
      return;
    }

    // 5. Extract and bound binary buffer within memory limits
    const binaryBuffer = extractBoundedBinaryBody(request, maxUploadBytes);

    // 6. Parse and validate intake metadata headers and identifiers
    const intakeInput = parseUploadMetadataAndBuildInput(
      request,
      binaryBuffer,
      contentTypeInfo.claimedMimeType,
      limits
    );

    // 7. Invoke the accepted EditorialBinaryIntakeService saga
    const intakeResult =
      await dependencies.intakeService.ingestEditorialImageBinary(
        {
          auth: {
            uid: admin.id,
            token: decodedToken,
          },
        },
        intakeInput
      );

    // 8. Return minimal authenticated response (never expose storage paths or raw bytes)
    const responseBody: EditorialNewsImageUploadSuccessResponse = {
      ok: true,
      intakeId: intakeResult.intakeId,
      assetId: intakeResult.assetRecord.assetId,
      status: intakeResult.sessionStatus,
      ...(intakeResult.sessionStatus === 'CleanupPending'
        ? { errorCode: 'CLEANUP_INCOMPLETE' }
        : {}),
    };

    response.status(201).json(responseBody);
  } catch (err: unknown) {
    if (err instanceof EditorialBinaryIntakeError) {
      const mapped = mapIntakeErrorToHttpResponse(err, fallbackIds);
      if (mapped.httpStatus === 401) {
        response.setHeader('WWW-Authenticate', 'Bearer');
      }
      response.status(mapped.httpStatus).json(mapped.body);
      return;
    }

    // Fail closed on any unexpected error without leaking internal details
    response.status(500).json({
      ok: false,
      ...(fallbackIds.intakeId !== undefined
        ? { intakeId: fallbackIds.intakeId }
        : {}),
      ...(fallbackIds.assetId !== undefined
        ? { assetId: fallbackIds.assetId }
        : {}),
      status: 'Failed',
      errorCode: 'INTERNAL_ERROR',
    });
  }
}

let cachedProductionRuntime: ProductionEditorialNewsImageUploadRuntime | null =
  null;

function getOrCreateProductionRuntime(): ProductionEditorialNewsImageUploadRuntime {
  if (!cachedProductionRuntime) {
    cachedProductionRuntime = createProductionEditorialNewsImageUploadRuntime();
  }
  return cachedProductionRuntime;
}

/**
 * Firebase Functions v2 HTTPS endpoint for authenticated editorial news image binary intake.
 */
export const editorialNewsImageUpload = onRequest(
  {
    cors: false,
    maxInstances: 10,
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (request, response) => {
    const runtime = getOrCreateProductionRuntime();

    await executeEditorialNewsImageUploadEndpoint(
      {
        method: request.method,
        url: request.url,
        path: request.path,
        query: request.query as Readonly<Record<string, unknown>>,
        headers: request.headers as Readonly<
          Record<string, string | string[] | undefined>
        >,
        rawBody: request.rawBody,
        body: request.body,
      },
      response,
      {
        verifyIdToken: runtime.verifyIdToken,
        adminRepository: runtime.adminRepository,
        intakeService: runtime.intakeService,
      }
    );
  }
);
