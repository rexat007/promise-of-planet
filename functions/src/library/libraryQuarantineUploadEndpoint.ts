import { Buffer } from 'node:buffer';
import { onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { AdminRepository } from '../admin/adminRepository';
import {
  FirestoreAdminRepository,
  type FirestoreAdminDatabase,
} from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
  isValidAdminRole,
  type AdminUser,
} from '../types/admin';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
} from './libraryUploadBinaryAdmission';
import { type LibraryUploadDeepStructureRejectionCode } from './libraryUploadDeepStructure';
import {
  LibraryQuarantineReceiptState,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  reserveLibraryQuarantineReceipt,
  type LibraryQuarantineContractErrorCode,
  type ReserveLibraryQuarantineReceiptInput,
  type ReserveLibraryQuarantineReceiptResult,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from './libraryQuarantineReceiptContract';
import {
  FirestoreLibraryQuarantineReceiptStore,
  type LibraryQuarantineFirestoreDatabase,
  type LibraryQuarantineReceiptStore,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  GcsLibraryQuarantineStorageAdapter,
  type GcsLibraryQuarantineBucket,
} from './gcsLibraryQuarantineStorageAdapter';
import {
  LibraryQuarantineWriteCoordinator,
  type ExecuteReservedQuarantineWriteInput,
  type ExecuteReservedQuarantineWriteResult,
  type LibraryQuarantineWriteCoordinatorErrorCode,
} from './libraryQuarantineWriteCoordinator';

/**
 * LIB-FILE-UPLOAD-01 — Private Library Quarantine Upload Gateway
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Authenticated, server-only HTTPS `onRequest` gateway for privately
 *   quarantining single raw PDF or DOCX library upload candidates.
 * - Requires a single `Authorization: Bearer <idToken>` header verified via
 *   `getAuth().verifyIdToken(token, true)` (revocation-checked). Rejects
 *   cookie-only and alternative credential headers.
 * - Loads the canonical `AdminUser` from Firestore (`FirestoreAdminRepository`)
 *   and requires an active human administrator with `AdminDomain.Library`
 *   responsibility and `AdminPermission.Create` or `AdminPermission.Edit`.
 *   Strictly rejects AI/automated principals, inactive accounts, wrong-domain
 *   admins, and untrusted token claims.
 * - Enforces a strict fixed CORS origin allowlist (never wildcard `*`).
 * - Accepts a single raw binary payload (`1..15,000,000` bytes) with validated
 *   `Content-Length` and `Content-Type` (`application/pdf`,
 *   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
 *   or `application/octet-stream`). Rejects JSON/base64/multipart bodies,
 *   non-identity content encodings, query strings, and caller-supplied receipt
 *   IDs, storage paths, bucket names, hashes, generations, or safety verdicts.
 * - Reuses `reserveLibraryQuarantineReceipt` (which runs `LIB-FILE-01A` and
 *   `LIB-FILE-01B`), persists the `Reserved` receipt via
 *   `FirestoreLibraryQuarantineReceiptStore.createReceiptIfAbsent` strictly
 *   before any storage write, and invokes
 *   `LibraryQuarantineWriteCoordinator.executeReservedQuarantineWrite` at most
 *   once against the explicit dedicated GCS bucket:
 *     `promiseofplanet-bb325-library-quarantine`
 *   Never falls back to the default Firebase Storage bucket (`bucket()`).
 * - Returns only sanitized receipt lifecycle state (`QUARANTINED`,
 *   `NEEDS_RECONCILIATION`, `PERSISTENCE_UNCERTAIN`, or rejection status)
 *   without leaking `storagePath`, bucket names, GCS generations, signed/public
 *   URLs, tokens, or raw bytes.
 */

export const LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME =
  'promiseofplanet-bb325-library-quarantine' as const;

export const FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME =
  'promiseofplanet-bb325.firebasestorage.app' as const;

export const MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES =
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES; // 15,000,000 bytes

export const MAX_LIBRARY_UPLOAD_METADATA_HEADER_BYTES = 8_192 as const;

export const DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS: ReadonlySet<string> =
  new Set([
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

export const ALLOWED_LIBRARY_UPLOAD_CONTENT_TYPES: ReadonlySet<string> =
  new Set([
    CANONICAL_PDF_MIME_TYPE,
    CANONICAL_DOCX_MIME_TYPE,
    'application/octet-stream',
  ]);

const ALLOWED_METADATA_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'originalFilename',
  'claimedMimeType',
]);

const FORBIDDEN_CALLER_HEADERS: ReadonlySet<string> = new Set([
  'x-receipt-id',
  'x-quarantine-receipt-id',
  'x-intake-id',
  'x-asset-id',
  'x-document-id',
  'x-storage-path',
  'x-gcs-path',
  'x-object-path',
  'x-target-path',
  'x-destination-path',
  'x-bucket',
  'x-bucket-name',
  'x-storage-bucket',
  'x-gcs-bucket',
  'x-generation',
  'x-gcs-generation',
  'x-object-generation',
  'x-metageneration',
  'x-sha256',
  'x-checksum',
  'x-file-hash',
  'x-byte-size',
  'x-inspection-status',
  'x-deep-inspection-status',
  'x-inspection-verdict',
  'x-verified-safe',
  'x-is-sanitized',
  'x-quarantine-state',
  'x-receipt-state',
  'x-lifecycle-state',
  'x-status',
  'x-revision',
  'x-public-url',
  'x-signed-url',
  'x-download-url',
  'x-download-token',
  'x-rights-status',
  'x-is-published',
  'x-ready-for-peia',
  'x-uploader-uid',
  'x-actor-uid',
  'x-created-by-uid',
  'x-admin-role',
]);

const FORBIDDEN_ALTERNATIVE_AUTH_HEADERS: ReadonlySet<string> = new Set([
  'cookie',
  'x-api-key',
  'x-auth-token',
  'x-id-token',
  'x-access-token',
  'x-machine-token',
  'x-machine-credential',
  'x-firebase-auth',
  'proxy-authorization',
]);

const ALLOWED_ADMIN_RECEIPT_DTO_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'uploaderUid',
  'originalFilename',
  'sanitizedFilename',
  'format',
  'canonicalExtension',
  'canonicalMimeType',
  'byteSize',
  'sha256',
  'state',
  'deepInspectionStatus',
  'hasVerifiedStorageWrite',
  'reconciliationRequired',
  'reconciliationReason',
  'rejectionReasonCode',
  'createdAt',
  'updatedAt',
  'isQuarantinedPrivateOnly',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

export type LibraryQuarantineUploadEndpointErrorCode =
  | LibraryQuarantineContractErrorCode
  | LibraryQuarantineWriteCoordinatorErrorCode
  | 'HTTP_METHOD_NOT_ALLOWED'
  | 'CORS_ORIGIN_FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'AI_ACCOUNT_FORBIDDEN'
  | 'ADMIN_LOOKUP_FAILED'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'AMBIGUOUS_CONTENT_ENCODING'
  | 'INVALID_INPUT'
  | 'UNTRUSTED_CALLER_FIELD'
  | 'EMPTY_BINARY'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'CONTENT_LENGTH_MISMATCH'
  | 'CLAIMED_MIME_MISMATCH'
  | 'RESERVATION_PERSISTENCE_FAILED'
  | 'RECEIPT_ALREADY_EXISTS_CONFLICT'
  | 'UNSAFE_BUCKET_BINDING'
  | 'INTERNAL_ERROR';

export interface LibraryQuarantineUploadQuarantinedResponse {
  readonly ok: true;
  readonly status: 'QUARANTINED';
  readonly receiptId: string;
  readonly revision: number;
  readonly adminReceipt: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineUploadErrorResponse {
  readonly ok: false;
  readonly status:
    | 'REJECTED'
    | 'RESERVATION_FAILED'
    | 'PREFLIGHT_REJECTED'
    | 'WRITE_PENDING_CAS_FAILED'
    | 'NEEDS_RECONCILIATION'
    | 'PERSISTENCE_UNCERTAIN';
  readonly errorCode: LibraryQuarantineUploadEndpointErrorCode;
  readonly binaryRejectionCode?: LibraryUploadDeepStructureRejectionCode;
  readonly receiptId?: string;
  readonly revision?: number;
  readonly lastKnownRevision?: number;
  readonly reconciliationPersisted?: boolean;
  readonly adminReceipt?: SanitizedLibraryQuarantineAdminReceiptDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type LibraryQuarantineUploadResponseBody =
  | LibraryQuarantineUploadQuarantinedResponse
  | LibraryQuarantineUploadErrorResponse;

export interface DecodedLibraryFirebaseIdToken {
  readonly uid: string;
  readonly [key: string]: unknown;
}

export type LibraryFirebaseIdTokenVerifier = (
  idToken: string,
  checkRevoked?: boolean
) => Promise<DecodedLibraryFirebaseIdToken>;

export interface LibraryQuarantineUploadHttpRequest {
  readonly method?: string;
  readonly url?: string;
  readonly path?: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody?: unknown;
  readonly body?: unknown;
}

export interface LibraryQuarantineUploadHttpResponseWriter {
  setHeader(name: string, value: string): void;
  status(code: number): LibraryQuarantineUploadHttpResponseWriter;
  json(body: LibraryQuarantineUploadResponseBody): unknown;
  end?(): unknown;
}

export interface LibraryQuarantineWriteCoordinatorPort {
  executeReservedQuarantineWrite(
    input: ExecuteReservedQuarantineWriteInput
  ): Promise<ExecuteReservedQuarantineWriteResult>;
}

export interface LibraryQuarantineUploadEndpointDependencies {
  readonly verifyIdToken: LibraryFirebaseIdTokenVerifier;
  readonly adminRepository: AdminRepository;
  readonly receiptStore: LibraryQuarantineReceiptStore;
  readonly writeCoordinator: LibraryQuarantineWriteCoordinatorPort;
  readonly reserveReceipt?: (
    input: ReserveLibraryQuarantineReceiptInput
  ) => ReserveLibraryQuarantineReceiptResult;
  readonly trustedOrigins?: ReadonlySet<string>;
  readonly maxUploadBytes?: number;
  readonly clock?: () => string;
}

export interface ProductionLibraryQuarantineUploadRuntime {
  readonly targetBucketName: typeof LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME;
  readonly adminRepository: AdminRepository;
  readonly receiptStore: FirestoreLibraryQuarantineReceiptStore;
  readonly gcsAdapter: GcsLibraryQuarantineStorageAdapter;
  readonly writeCoordinator: LibraryQuarantineWriteCoordinator;
  readonly verifyIdToken: LibraryFirebaseIdTokenVerifier;
}

export interface ProductionLibraryQuarantineUploadRuntimeOverrides {
  readonly adminRepository?: AdminRepository;
  readonly getFirestore?: () => unknown;
  readonly getStorage?: () => {
    bucket: (name: string) => unknown;
  };
  readonly getAuth?: () => {
    verifyIdToken: (
      idToken: string,
      checkRevoked?: boolean
    ) => Promise<DecodedLibraryFirebaseIdToken>;
  };
  readonly clock?: () => string;
}

class EndpointHttpError extends Error {
  readonly httpStatus: number;
  readonly status: LibraryQuarantineUploadErrorResponse['status'];
  readonly errorCode: LibraryQuarantineUploadEndpointErrorCode;
  readonly binaryRejectionCode?: LibraryUploadDeepStructureRejectionCode;

  constructor(params: {
    readonly httpStatus: number;
    readonly status: LibraryQuarantineUploadErrorResponse['status'];
    readonly errorCode: LibraryQuarantineUploadEndpointErrorCode;
    readonly message: string;
    readonly binaryRejectionCode?: LibraryUploadDeepStructureRejectionCode;
  }) {
    super(params.message);
    this.name = 'EndpointHttpError';
    this.httpStatus = params.httpStatus;
    this.status = params.status;
    this.errorCode = params.errorCode;
    this.binaryRejectionCode = params.binaryRejectionCode;
  }
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
): {
  readonly present: boolean;
  readonly valid: boolean;
  readonly value?: string;
} {
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
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'INVALID_INPUT',
        message: 'Malformed percent-encoded header value.',
      });
    }
  }
  return trimmed;
}

function sanitizeAdminReceiptDto(
  dto: SanitizedLibraryQuarantineAdminReceiptDto
): SanitizedLibraryQuarantineAdminReceiptDto {
  const rawRecord = dto as unknown as Record<string, unknown>;
  for (const key of Object.keys(rawRecord)) {
    if (!ALLOWED_ADMIN_RECEIPT_DTO_KEYS.has(key)) {
      throw new EndpointHttpError({
        httpStatus: 500,
        status: 'RESERVATION_FAILED',
        errorCode: 'INTERNAL_ERROR',
        message: 'Unexpected property detected on admin receipt DTO.',
      });
    }
  }

  return Object.freeze({
    receiptId: dto.receiptId,
    uploaderUid: dto.uploaderUid,
    originalFilename: dto.originalFilename,
    sanitizedFilename: dto.sanitizedFilename,
    format: dto.format,
    canonicalExtension: dto.canonicalExtension,
    canonicalMimeType: dto.canonicalMimeType,
    byteSize: dto.byteSize,
    sha256: dto.sha256,
    state: dto.state,
    deepInspectionStatus: dto.deepInspectionStatus,
    hasVerifiedStorageWrite: dto.hasVerifiedStorageWrite,
    reconciliationRequired: dto.reconciliationRequired,
    reconciliationReason: dto.reconciliationReason,
    rejectionReasonCode: dto.rejectionReasonCode,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    isQuarantinedPrivateOnly: dto.isQuarantinedPrivateOnly,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });
}

function buildErrorResponse(params: {
  readonly status: LibraryQuarantineUploadErrorResponse['status'];
  readonly errorCode: LibraryQuarantineUploadEndpointErrorCode;
  readonly binaryRejectionCode?: LibraryUploadDeepStructureRejectionCode;
  readonly receiptId?: string;
  readonly revision?: number;
  readonly lastKnownRevision?: number;
  readonly reconciliationPersisted?: boolean;
  readonly adminReceipt?: SanitizedLibraryQuarantineAdminReceiptDto | null;
}): LibraryQuarantineUploadErrorResponse {
  const safeReceiptId =
    typeof params.receiptId === 'string' &&
    isValidLibraryQuarantineReceiptId(params.receiptId)
      ? params.receiptId
      : undefined;

  return Object.freeze({
    ok: false,
    status: params.status,
    errorCode: params.errorCode,
    ...(params.binaryRejectionCode !== undefined
      ? { binaryRejectionCode: params.binaryRejectionCode }
      : {}),
    ...(safeReceiptId !== undefined ? { receiptId: safeReceiptId } : {}),
    ...(typeof params.revision === 'number'
      ? { revision: params.revision }
      : {}),
    ...(typeof params.lastKnownRevision === 'number'
      ? { lastKnownRevision: params.lastKnownRevision }
      : {}),
    ...(typeof params.reconciliationPersisted === 'boolean'
      ? { reconciliationPersisted: params.reconciliationPersisted }
      : {}),
    ...(params.adminReceipt
      ? { adminReceipt: sanitizeAdminReceiptDto(params.adminReceipt) }
      : {}),
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });
}

/**
 * Assembles the production dependency graph for the Library Quarantine Upload
 * Gateway, binding explicitly and exclusively to the dedicated quarantine
 * bucket `promiseofplanet-bb325-library-quarantine`.
 *
 * NEVER calls `storage.bucket()` without an explicit bucket name and NEVER
 * binds to `promiseofplanet-bb325.firebasestorage.app`.
 */
export function createProductionLibraryQuarantineUploadRuntime(
  overrides?: ProductionLibraryQuarantineUploadRuntimeOverrides
): ProductionLibraryQuarantineUploadRuntime {
  const rawOverrides = overrides as unknown;
  if (
    rawOverrides !== undefined &&
    (!isPlainObject(rawOverrides) ||
      'bucketName' in rawOverrides ||
      'bucket' in rawOverrides)
  ) {
    throw new Error(
      'UNSAFE_BUCKET_BINDING: Caller-supplied bucket overrides are forbidden in production runtime creation.'
    );
  }

  const resolveFirestore = overrides?.getFirestore ?? getFirestore;
  const resolveStorage = overrides?.getStorage ?? getStorage;
  const resolveAuth = overrides?.getAuth ?? getAuth;

  const firestoreInstance = resolveFirestore();
  const storageInstance = resolveStorage();
  if (
    !storageInstance ||
    typeof storageInstance !== 'object' ||
    typeof storageInstance.bucket !== 'function'
  ) {
    throw new Error(
      'UNSAFE_BUCKET_BINDING: Storage SDK instance is missing a valid bucket(name) method.'
    );
  }

  const rawBucket = storageInstance.bucket(
    LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
  ) as GcsLibraryQuarantineBucket | null | undefined;

  if (
    !rawBucket ||
    typeof rawBucket !== 'object' ||
    typeof rawBucket.file !== 'function'
  ) {
    throw new Error(
      'UNSAFE_BUCKET_BINDING: Dedicated library quarantine bucket handle is invalid.'
    );
  }

  const resolvedBucketName: string | undefined = rawBucket.name;
  if (
    resolvedBucketName !== undefined &&
    (resolvedBucketName === FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME ||
      resolvedBucketName !== LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME)
  ) {
    throw new Error(
      `UNSAFE_BUCKET_BINDING: Resolved bucket name does not match required dedicated quarantine bucket "${LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME}".`
    );
  }

  const authInstance = resolveAuth();
  if (
    !authInstance ||
    typeof authInstance !== 'object' ||
    typeof authInstance.verifyIdToken !== 'function'
  ) {
    throw new Error(
      'INVALID_AUTH_DEPENDENCY: Auth SDK instance is missing verifyIdToken.'
    );
  }

  const adminRepository: AdminRepository =
    overrides?.adminRepository ??
    new FirestoreAdminRepository(firestoreInstance as FirestoreAdminDatabase);

  const receiptStore = new FirestoreLibraryQuarantineReceiptStore(
    firestoreInstance as LibraryQuarantineFirestoreDatabase
  );

  const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
    bucket: rawBucket,
    ...(overrides?.clock !== undefined ? { clock: overrides.clock } : {}),
  });

  const writeCoordinator = new LibraryQuarantineWriteCoordinator({
    receiptStore,
    storageAdapter: gcsAdapter,
    ...(overrides?.clock !== undefined ? { clock: overrides.clock } : {}),
  });

  const verifyIdToken: LibraryFirebaseIdTokenVerifier = async (
    idToken: string,
    checkRevoked = true
  ) => {
    return authInstance.verifyIdToken(idToken, checkRevoked !== false);
  };

  return Object.freeze({
    targetBucketName: LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
    adminRepository,
    receiptStore,
    gcsAdapter,
    writeCoordinator,
    verifyIdToken,
  });
}

function extractBearerToken(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined
): string | null {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  // Reject cookie-based or alternative authentication headers
  for (const rawKey of Object.keys(headers)) {
    const lowerKey = rawKey.toLowerCase();
    if (
      FORBIDDEN_ALTERNATIVE_AUTH_HEADERS.has(lowerKey) &&
      headers[rawKey] !== undefined
    ) {
      return null;
    }
  }

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

function hasAutomatedOrAiClaims(
  record: Readonly<Record<string, unknown>>
): boolean {
  return (
    record.role === AdminRole.AIAssistant ||
    record.isAIAssistant === true ||
    record.isAiAssistant === true ||
    record.aiAssistant === true ||
    record.ai === true ||
    record.automated === true ||
    record.actorType === 'ai' ||
    record.principalType === 'ai' ||
    record.principalType === 'machine'
  );
}

async function verifyAndAuthorizeLibraryHumanEditor(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined,
  verifyIdToken: LibraryFirebaseIdTokenVerifier,
  adminRepository: AdminRepository
): Promise<{
  readonly admin: AdminUser;
  readonly decodedToken: DecodedLibraryFirebaseIdToken;
}> {
  const bearerToken = extractBearerToken(headers);
  if (!bearerToken) {
    throw new EndpointHttpError({
      httpStatus: 401,
      status: 'REJECTED',
      errorCode: 'UNAUTHENTICATED',
      message: 'Missing, malformed, or unsupported authentication credentials.',
    });
  }

  let decodedToken: DecodedLibraryFirebaseIdToken;
  try {
    decodedToken = await verifyIdToken(bearerToken, true);
  } catch {
    throw new EndpointHttpError({
      httpStatus: 401,
      status: 'REJECTED',
      errorCode: 'UNAUTHENTICATED',
      message: 'Firebase ID token verification failed or token is revoked.',
    });
  }

  if (
    !decodedToken ||
    typeof decodedToken !== 'object' ||
    typeof decodedToken.uid !== 'string' ||
    !isValidUploaderUid(decodedToken.uid)
  ) {
    throw new EndpointHttpError({
      httpStatus: 401,
      status: 'REJECTED',
      errorCode: 'UNAUTHENTICATED',
      message: 'Verified Firebase ID token lacks a valid canonical UID.',
    });
  }

  if (hasAutomatedOrAiClaims(decodedToken)) {
    throw new EndpointHttpError({
      httpStatus: 403,
      status: 'REJECTED',
      errorCode: 'AI_ACCOUNT_FORBIDDEN',
      message: 'AI or automated principals are forbidden from library uploads.',
    });
  }

  let admin: AdminUser | null = null;
  try {
    admin = await adminRepository.getAdminByUid(decodedToken.uid);
  } catch {
    throw new EndpointHttpError({
      httpStatus: 500,
      status: 'REJECTED',
      errorCode: 'ADMIN_LOOKUP_FAILED',
      message: 'Failed to resolve canonical AdminUser record.',
    });
  }

  if (!admin || !isPlainObject(admin as unknown)) {
    throw new EndpointHttpError({
      httpStatus: 403,
      status: 'REJECTED',
      errorCode: 'PERMISSION_DENIED',
      message: 'Authenticated user is not registered as a canonical AdminUser.',
    });
  }

  if (admin.id !== decodedToken.uid) {
    throw new EndpointHttpError({
      httpStatus: 403,
      status: 'REJECTED',
      errorCode: 'PERMISSION_DENIED',
      message: 'AdminUser ID does not match verified token UID.',
    });
  }

  const adminRecord = admin as unknown as Record<string, unknown>;
  if (hasAutomatedOrAiClaims(adminRecord)) {
    throw new EndpointHttpError({
      httpStatus: 403,
      status: 'REJECTED',
      errorCode: 'AI_ACCOUNT_FORBIDDEN',
      message: 'AI assistant accounts are forbidden from library uploads.',
    });
  }

  if (admin.isActive !== true) {
    throw new EndpointHttpError({
      httpStatus: 403,
      status: 'REJECTED',
      errorCode: 'PERMISSION_DENIED',
      message: 'AdminUser account is inactive.',
    });
  }

  if (!isValidAdminRole(admin.role)) {
    throw new EndpointHttpError({
      httpStatus: 403,
      status: 'REJECTED',
      errorCode: 'PERMISSION_DENIED',
      message: 'AdminUser role is invalid.',
    });
  }

  // Require Library domain responsibility on the canonical role (and on any explicit domains property if present)
  const hasCanonicalLibraryDomain = hasDomainResponsibility(
    admin.role,
    AdminDomain.Library
  );
  const explicitDomains = adminRecord.domains;
  const hasExplicitLibraryDomain =
    explicitDomains === undefined
      ? true
      : Array.isArray(explicitDomains)
        ? explicitDomains.includes(AdminDomain.Library)
        : explicitDomains instanceof Set
          ? explicitDomains.has(AdminDomain.Library)
          : false;

  if (!hasCanonicalLibraryDomain || !hasExplicitLibraryDomain) {
    throw new EndpointHttpError({
      httpStatus: 403,
      status: 'REJECTED',
      errorCode: 'PERMISSION_DENIED',
      message: 'AdminUser lacks Library domain responsibility.',
    });
  }

  // Require Create or Edit permission on the canonical role (and on any explicit permissions property if present)
  const hasCanonicalCreateOrEdit =
    AdminAuthorizationService.hasPermission(admin, AdminPermission.Create) ||
    AdminAuthorizationService.hasPermission(admin, AdminPermission.Edit);

  const explicitPermissions = adminRecord.permissions;
  const hasExplicitCreateOrEdit =
    explicitPermissions === undefined
      ? true
      : Array.isArray(explicitPermissions)
        ? explicitPermissions.includes(AdminPermission.Create) ||
          explicitPermissions.includes(AdminPermission.Edit)
        : explicitPermissions instanceof Set
          ? explicitPermissions.has(AdminPermission.Create) ||
            explicitPermissions.has(AdminPermission.Edit)
          : false;

  if (!hasCanonicalCreateOrEdit || !hasExplicitCreateOrEdit) {
    throw new EndpointHttpError({
      httpStatus: 403,
      status: 'REJECTED',
      errorCode: 'PERMISSION_DENIED',
      message:
        'AdminUser lacks required Create or Edit permission for Library uploads.',
    });
  }

  return { admin, decodedToken };
}

function validateAndParseContentType(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined
): {
  readonly mediaType: string;
  readonly headerClaimedMimeType?: string;
} {
  const contentEncoding = getSingleHeaderString(headers, 'content-encoding');
  if (
    contentEncoding.present &&
    (!contentEncoding.valid ||
      !contentEncoding.value ||
      contentEncoding.value.trim().toLowerCase() !== 'identity')
  ) {
    throw new EndpointHttpError({
      httpStatus: 415,
      status: 'REJECTED',
      errorCode: 'AMBIGUOUS_CONTENT_ENCODING',
      message: 'Ambiguous or compressed Content-Encoding is not permitted.',
    });
  }

  const transferEncoding = getSingleHeaderString(headers, 'transfer-encoding');
  if (transferEncoding.present) {
    throw new EndpointHttpError({
      httpStatus: 415,
      status: 'REJECTED',
      errorCode: 'AMBIGUOUS_CONTENT_ENCODING',
      message: 'Transfer-Encoding is not permitted on bounded raw binary uploads.',
    });
  }

  const contentTransferEncoding = getSingleHeaderString(
    headers,
    'content-transfer-encoding'
  );
  if (
    contentTransferEncoding.present &&
    (!contentTransferEncoding.valid ||
      !contentTransferEncoding.value ||
      contentTransferEncoding.value.trim().toLowerCase() !== 'binary')
  ) {
    throw new EndpointHttpError({
      httpStatus: 415,
      status: 'REJECTED',
      errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      message: 'Only binary Content-Transfer-Encoding is permitted.',
    });
  }

  const ctHeader = getSingleHeaderString(headers, 'content-type');
  if (!ctHeader.present || !ctHeader.valid || !ctHeader.value) {
    throw new EndpointHttpError({
      httpStatus: 415,
      status: 'REJECTED',
      errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      message: 'Missing or invalid Content-Type header.',
    });
  }

  const rawCt = ctHeader.value.trim();
  if (/base64|multipart|json|form-urlencoded/i.test(rawCt)) {
    throw new EndpointHttpError({
      httpStatus: 415,
      status: 'REJECTED',
      errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      message: 'Unsupported Content-Type for raw binary upload.',
    });
  }

  const semiIndex = rawCt.indexOf(';');
  const mediaType = (semiIndex >= 0 ? rawCt.slice(0, semiIndex) : rawCt)
    .trim()
    .toLowerCase();

  if (!ALLOWED_LIBRARY_UPLOAD_CONTENT_TYPES.has(mediaType)) {
    throw new EndpointHttpError({
      httpStatus: 415,
      status: 'REJECTED',
      errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      message: 'Content-Type is not an allowed Library upload binary MIME type.',
    });
  }

  const headerClaimedMimeType =
    mediaType === 'application/octet-stream' ? undefined : mediaType;

  return { mediaType, headerClaimedMimeType };
}

function validateAndParseUploadMetadata(
  request: LibraryQuarantineUploadHttpRequest,
  headerClaimedMimeType: string | undefined
): {
  readonly originalFilename: string;
  readonly claimedMimeType: string | null;
} {
  if (
    request.query &&
    typeof request.query === 'object' &&
    Object.keys(request.query).length > 0
  ) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'UNTRUSTED_CALLER_FIELD',
      message: 'Query parameters are forbidden on Library quarantine uploads.',
    });
  }

  if (typeof request.url === 'string' && request.url.includes('?')) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'UNTRUSTED_CALLER_FIELD',
      message: 'Query strings are forbidden on Library quarantine uploads.',
    });
  }

  const headers = request.headers;
  if (headers && typeof headers === 'object') {
    for (const rawKey of Object.keys(headers)) {
      const lowerKey = rawKey.toLowerCase();
      if (
        FORBIDDEN_CALLER_HEADERS.has(lowerKey) &&
        headers[rawKey] !== undefined
      ) {
        throw new EndpointHttpError({
          httpStatus: 400,
          status: 'REJECTED',
          errorCode: 'UNTRUSTED_CALLER_FIELD',
          message: `Forbidden caller-supplied header "${lowerKey}".`,
        });
      }
    }
  }

  const metaPrimary = getSingleHeaderString(
    headers,
    'x-library-upload-metadata'
  );
  const metaAlias = getSingleHeaderString(headers, 'x-upload-metadata');

  if (!metaPrimary.valid || !metaAlias.valid) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message: 'Duplicate or malformed upload metadata headers.',
    });
  }

  if (metaPrimary.present && metaAlias.present) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message: 'Provide at most one metadata envelope header.',
    });
  }

  let parsedEnvelope: Record<string, unknown> = {};
  const rawEnvelopeStr = metaPrimary.present
    ? metaPrimary.value
    : metaAlias.value;

  if (rawEnvelopeStr !== undefined) {
    if (
      rawEnvelopeStr.trim().length === 0 ||
      Buffer.byteLength(rawEnvelopeStr, 'utf8') >
        MAX_LIBRARY_UPLOAD_METADATA_HEADER_BYTES
    ) {
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'INVALID_INPUT',
        message: 'Metadata header is empty or exceeds maximum byte length.',
      });
    }

    const decodedJsonStr = decodeHeaderValue(rawEnvelopeStr);
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodedJsonStr);
    } catch {
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'INVALID_INPUT',
        message: 'Metadata header must be valid JSON.',
      });
    }

    if (!isPlainObject(parsed)) {
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'INVALID_INPUT',
        message: 'Metadata header must decode to a plain JSON object.',
      });
    }

    for (const key of Object.keys(parsed)) {
      if (!ALLOWED_METADATA_ENVELOPE_KEYS.has(key)) {
        throw new EndpointHttpError({
          httpStatus: 400,
          status: 'REJECTED',
          errorCode: 'UNTRUSTED_CALLER_FIELD',
          message: `Forbidden or unknown field "${key}" in metadata header.`,
        });
      }
    }

    parsedEnvelope = parsed;
  }

  const filenameHeader = getSingleHeaderString(headers, 'x-original-filename');
  if (!filenameHeader.valid) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message: 'Invalid X-Original-Filename header.',
    });
  }

  const headerFilename =
    filenameHeader.present && filenameHeader.value !== undefined
      ? decodeHeaderValue(filenameHeader.value)
      : undefined;

  const envelopeFilename = parsedEnvelope.originalFilename;
  if (
    envelopeFilename !== undefined &&
    typeof envelopeFilename !== 'string'
  ) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message: 'originalFilename in metadata envelope must be a string.',
    });
  }

  if (
    headerFilename !== undefined &&
    envelopeFilename !== undefined &&
    headerFilename !== envelopeFilename
  ) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message:
        'X-Original-Filename header conflicts with metadata envelope originalFilename.',
    });
  }

  const originalFilename = headerFilename ?? (envelopeFilename as string | undefined);
  if (
    typeof originalFilename !== 'string' ||
    originalFilename.trim().length === 0 ||
    originalFilename.includes('/') ||
    originalFilename.includes('\\') ||
    originalFilename.includes('..') ||
    originalFilename.includes('\0')
  ) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message:
        'originalFilename is required and must not contain path separators or traversal sequences.',
    });
  }

  const claimedMimeHeader = getSingleHeaderString(
    headers,
    'x-claimed-mime-type'
  );
  if (!claimedMimeHeader.valid) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message: 'Invalid X-Claimed-Mime-Type header.',
    });
  }

  const headerClaimedMimeOverride =
    claimedMimeHeader.present && claimedMimeHeader.value !== undefined
      ? decodeHeaderValue(claimedMimeHeader.value).trim().toLowerCase()
      : undefined;

  const envelopeClaimedMime = parsedEnvelope.claimedMimeType;
  if (
    envelopeClaimedMime !== undefined &&
    typeof envelopeClaimedMime !== 'string'
  ) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message: 'claimedMimeType in metadata envelope must be a string.',
    });
  }

  const normalizedEnvelopeMime =
    typeof envelopeClaimedMime === 'string'
      ? envelopeClaimedMime.trim().toLowerCase()
      : undefined;

  if (
    headerClaimedMimeOverride !== undefined &&
    normalizedEnvelopeMime !== undefined &&
    headerClaimedMimeOverride !== normalizedEnvelopeMime
  ) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'CLAIMED_MIME_MISMATCH',
      message:
        'X-Claimed-Mime-Type header conflicts with metadata envelope claimedMimeType.',
    });
  }

  const metadataClaimedMime =
    headerClaimedMimeOverride ?? normalizedEnvelopeMime;

  if (
    headerClaimedMimeType !== undefined &&
    metadataClaimedMime !== undefined &&
    metadataClaimedMime !== headerClaimedMimeType
  ) {
    throw new EndpointHttpError({
      httpStatus: 422,
      status: 'REJECTED',
      errorCode: 'CLAIMED_MIME_MISMATCH',
      message:
        'Claimed MIME type in metadata conflicts with HTTP Content-Type header.',
    });
  }

  const effectiveClaimedMime =
    headerClaimedMimeType ?? metadataClaimedMime ?? null;

  return {
    originalFilename,
    claimedMimeType: effectiveClaimedMime,
  };
}

function extractBoundedBinaryPayload(
  request: LibraryQuarantineUploadHttpRequest,
  maxUploadBytes: number
): Buffer {
  const clHeader = getSingleHeaderString(request.headers, 'content-length');
  let declaredLength: number | undefined;

  if (clHeader.present) {
    if (!clHeader.valid || !clHeader.value) {
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'INVALID_INPUT',
        message: 'Invalid Content-Length header.',
      });
    }
    const trimmedCl = clHeader.value.trim();
    if (!/^\d+$/.test(trimmedCl)) {
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'INVALID_INPUT',
        message: 'Content-Length must be a canonical non-negative decimal integer.',
      });
    }
    declaredLength = Number.parseInt(trimmedCl, 10);
    if (
      !Number.isSafeInteger(declaredLength) ||
      String(declaredLength) !== trimmedCl
    ) {
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'INVALID_INPUT',
        message: 'Content-Length is not a canonical safe integer.',
      });
    }
    if (declaredLength === 0) {
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'EMPTY_BINARY',
        message: 'Binary upload payload must not be empty.',
      });
    }
    if (declaredLength > maxUploadBytes) {
      throw new EndpointHttpError({
        httpStatus: 413,
        status: 'REJECTED',
        errorCode: 'SIZE_LIMIT_EXCEEDED',
        message: `Declared Content-Length exceeds maximum limit of ${maxUploadBytes} bytes.`,
      });
    }
  }

  if (
    request.body !== undefined &&
    request.body !== null &&
    !Buffer.isBuffer(request.body) &&
    !(request.body instanceof Uint8Array)
  ) {
    const isEmptyPlainBody =
      isPlainObject(request.body) &&
      Object.keys(request.body).length === 0 &&
      (Buffer.isBuffer(request.rawBody) ||
        request.rawBody instanceof Uint8Array);

    if (!isEmptyPlainBody) {
      throw new EndpointHttpError({
        httpStatus: 400,
        status: 'REJECTED',
        errorCode: 'INVALID_INPUT',
        message:
          'Request body must be raw binary bytes; JSON, multipart, or text bodies are forbidden.',
      });
    }
  }

  if (request.rawBody === undefined || request.rawBody === null) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'EMPTY_BINARY',
      message: 'request.rawBody binary payload is required.',
    });
  }

  let binaryBuffer: Buffer;
  if (Buffer.isBuffer(request.rawBody)) {
    binaryBuffer = Buffer.from(
      request.rawBody.buffer,
      request.rawBody.byteOffset,
      request.rawBody.byteLength
    );
  } else if (request.rawBody instanceof Uint8Array) {
    binaryBuffer = Buffer.from(
      request.rawBody.buffer,
      request.rawBody.byteOffset,
      request.rawBody.byteLength
    );
  } else {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'INVALID_INPUT',
      message: 'request.rawBody must be a Buffer or Uint8Array.',
    });
  }

  if (binaryBuffer.byteLength === 0) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'EMPTY_BINARY',
      message: 'Binary upload payload is empty.',
    });
  }

  if (binaryBuffer.byteLength > maxUploadBytes) {
    throw new EndpointHttpError({
      httpStatus: 413,
      status: 'REJECTED',
      errorCode: 'SIZE_LIMIT_EXCEEDED',
      message: `Binary payload exceeds maximum allowed size of ${maxUploadBytes} bytes.`,
    });
  }

  if (
    declaredLength !== undefined &&
    binaryBuffer.byteLength !== declaredLength
  ) {
    throw new EndpointHttpError({
      httpStatus: 400,
      status: 'REJECTED',
      errorCode: 'CONTENT_LENGTH_MISMATCH',
      message: 'Actual binary payload length does not match Content-Length.',
    });
  }

  return Buffer.from(binaryBuffer);
}

/**
 * Executes the authenticated Library Quarantine Upload Gateway against injected
 * or production dependencies.
 */
export async function executeLibraryQuarantineUploadEndpoint(
  request: LibraryQuarantineUploadHttpRequest,
  response: LibraryQuarantineUploadHttpResponseWriter,
  dependencies: LibraryQuarantineUploadEndpointDependencies
): Promise<void> {
  const trustedOrigins =
    dependencies.trustedOrigins ?? DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS;
  const maxUploadBytes =
    dependencies.maxUploadBytes ?? MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES;
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const reserveReceiptFn =
    dependencies.reserveReceipt ?? reserveLibraryQuarantineReceipt;

  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  // 1. Validate explicit fixed CORS Origin policy (never wildcard `*`)
  const originHeader = getSingleHeaderString(request.headers, 'origin');
  if (originHeader.present) {
    const candidateOrigin = originHeader.value?.trim() ?? '';
    if (
      !originHeader.valid ||
      candidateOrigin.length === 0 ||
      candidateOrigin === '*' ||
      !trustedOrigins.has(candidateOrigin)
    ) {
      response.status(403).json(
        buildErrorResponse({
          status: 'REJECTED',
          errorCode: 'CORS_ORIGIN_FORBIDDEN',
        })
      );
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', candidateOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Content-Length, X-Original-Filename, X-Claimed-Mime-Type, X-Library-Upload-Metadata'
    );
    response.setHeader('Access-Control-Max-Age', '3600');
  }

  // Handle safe OPTIONS preflight when a trusted Origin is present
  if (request.method === 'OPTIONS') {
    if (!originHeader.present) {
      response.setHeader('Allow', 'POST');
      response.status(405).json(
        buildErrorResponse({
          status: 'REJECTED',
          errorCode: 'HTTP_METHOD_NOT_ALLOWED',
        })
      );
      return;
    }

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
      response.status(405).json(
        buildErrorResponse({
          status: 'REJECTED',
          errorCode: 'HTTP_METHOD_NOT_ALLOWED',
        })
      );
      return;
    }

    response.status(204);
    if (typeof response.end === 'function') {
      response.end();
    }
    return;
  }

  // 2. Enforce POST-only HTTP method
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json(
      buildErrorResponse({
        status: 'REJECTED',
        errorCode: 'HTTP_METHOD_NOT_ALLOWED',
      })
    );
    return;
  }

  try {
    // 3. Authenticate Firebase ID token (revocation-aware) and authorize human Library editor
    const { admin } = await verifyAndAuthorizeLibraryHumanEditor(
      request.headers,
      dependencies.verifyIdToken,
      dependencies.adminRepository
    );

    // 4. Validate Content-Type and Content-Encoding headers
    const { headerClaimedMimeType } = validateAndParseContentType(
      request.headers
    );

    // 5. Reject forbidden headers/fields and parse originalFilename & claimedMimeType
    const { originalFilename, claimedMimeType } =
      validateAndParseUploadMetadata(request, headerClaimedMimeType);

    // 6. Extract and bound raw binary payload (1..15,000,000 bytes)
    const binaryBuffer = extractBoundedBinaryPayload(request, maxUploadBytes);

    const nowIso = clock();
    if (!isValidIsoUtcTimestamp(nowIso)) {
      throw new EndpointHttpError({
        httpStatus: 500,
        status: 'REJECTED',
        errorCode: 'INVALID_TIMESTAMP',
        message: 'Server clock produced an invalid ISO-8601 UTC timestamp.',
      });
    }

    // 7. Run LIB-FILE-01A/01B admission and reserve quarantine receipt via LIB-FILE-02A
    const reservationResult = reserveReceiptFn({
      uploaderUid: admin.id,
      originalFilename,
      claimedMimeType,
      bytes: binaryBuffer,
      nowIso,
    });

    if (!reservationResult.ok) {
      const httpStatus =
        reservationResult.binaryRejectionCode === 'SIZE_LIMIT_EXCEEDED'
          ? 413
          : reservationResult.errorCode === 'BINARY_ADMISSION_OR_STRUCTURE_REJECTED'
            ? 422
            : 400;

      response.status(httpStatus).json(
        buildErrorResponse({
          status: 'REJECTED',
          errorCode: reservationResult.errorCode,
          binaryRejectionCode: reservationResult.binaryRejectionCode,
        })
      );
      return;
    }

    const reservedReceipt = reservationResult.receipt;

    // 8. Persist Reserved receipt in Firestore BEFORE any GCS write
    const createReceiptResult =
      await dependencies.receiptStore.createReceiptIfAbsent(reservedReceipt);

    if (!createReceiptResult.ok) {
      const isConflict =
        createReceiptResult.errorCode === 'RECEIPT_ALREADY_EXISTS_CONFLICT';
      response.status(isConflict ? 409 : 500).json(
        buildErrorResponse({
          status: 'RESERVATION_FAILED',
          errorCode: isConflict
            ? 'RECEIPT_ALREADY_EXISTS_CONFLICT'
            : 'RESERVATION_PERSISTENCE_FAILED',
          reconciliationPersisted: false,
        })
      );
      return;
    }

    if (
      createReceiptResult.envelope.state !==
        LibraryQuarantineReceiptState.Reserved ||
      createReceiptResult.envelope.receipt.state !==
        LibraryQuarantineReceiptState.Reserved ||
      createReceiptResult.envelope.receipt.receiptId !==
        reservedReceipt.receiptId
    ) {
      response.status(500).json(
        buildErrorResponse({
          status: 'RESERVATION_FAILED',
          errorCode: 'RESERVATION_PERSISTENCE_FAILED',
          reconciliationPersisted: false,
        })
      );
      return;
    }

    // 9. Execute the one-shot Firestore + GCS Quarantine Write Coordinator
    const coordinatorResult =
      await dependencies.writeCoordinator.executeReservedQuarantineWrite({
        receiptId: reservedReceipt.receiptId,
        actorUid: admin.id,
        bytes: binaryBuffer,
      });

    if (coordinatorResult.ok) {
      if (
        coordinatorResult.status !== 'QUARANTINED' ||
        coordinatorResult.adminReceiptDto.state !==
          LibraryQuarantineReceiptState.Quarantined ||
        coordinatorResult.adminReceiptDto.hasVerifiedStorageWrite !== true
      ) {
        response.status(503).json(
          buildErrorResponse({
            status: 'PERSISTENCE_UNCERTAIN',
            errorCode: 'FINAL_QUARANTINE_CAS_FAILED',
            receiptId: reservedReceipt.receiptId,
            reconciliationPersisted: false,
          })
        );
        return;
      }

      const successBody: LibraryQuarantineUploadQuarantinedResponse =
        Object.freeze({
          ok: true,
          status: 'QUARANTINED',
          receiptId: coordinatorResult.receiptId,
          revision: coordinatorResult.revision,
          adminReceipt: sanitizeAdminReceiptDto(
            coordinatorResult.adminReceiptDto
          ),
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        });

      response.status(201).json(successBody);
      return;
    }

    if (coordinatorResult.status === 'NEEDS_RECONCILIATION') {
      response.status(503).json(
        buildErrorResponse({
          status: 'NEEDS_RECONCILIATION',
          errorCode: coordinatorResult.errorCode,
          receiptId: coordinatorResult.receiptId,
          revision: coordinatorResult.revision,
          reconciliationPersisted: true,
          adminReceipt: coordinatorResult.adminReceiptDto,
        })
      );
      return;
    }

    if (coordinatorResult.status === 'PERSISTENCE_UNCERTAIN') {
      response.status(503).json(
        buildErrorResponse({
          status: 'PERSISTENCE_UNCERTAIN',
          errorCode: coordinatorResult.errorCode,
          receiptId: coordinatorResult.receiptId,
          lastKnownRevision: coordinatorResult.lastKnownRevision,
          reconciliationPersisted: false,
          adminReceipt: coordinatorResult.adminReceiptDto,
        })
      );
      return;
    }

    const preflightStatus =
      coordinatorResult.status === 'WRITE_PENDING_CAS_FAILED' ? 409 : 500;
    response.status(preflightStatus).json(
      buildErrorResponse({
        status: coordinatorResult.status,
        errorCode: coordinatorResult.errorCode,
        receiptId: coordinatorResult.receiptId ?? reservedReceipt.receiptId,
        reconciliationPersisted: false,
        adminReceipt: coordinatorResult.adminReceiptDto,
      })
    );
  } catch (err: unknown) {
    if (err instanceof EndpointHttpError) {
      if (err.httpStatus === 401) {
        response.setHeader('WWW-Authenticate', 'Bearer');
      }
      response.status(err.httpStatus).json(
        buildErrorResponse({
          status: err.status,
          errorCode: err.errorCode,
          binaryRejectionCode: err.binaryRejectionCode,
        })
      );
      return;
    }

    response.status(500).json(
      buildErrorResponse({
        status: 'REJECTED',
        errorCode: 'INTERNAL_ERROR',
      })
    );
  }
}

let cachedProductionRuntime: ProductionLibraryQuarantineUploadRuntime | null =
  null;

function getOrCreateProductionLibraryQuarantineUploadRuntime(): ProductionLibraryQuarantineUploadRuntime {
  if (!cachedProductionRuntime) {
    cachedProductionRuntime = createProductionLibraryQuarantineUploadRuntime();
  }
  return cachedProductionRuntime;
}

/**
 * Firebase Functions v2 HTTPS endpoint for authenticated Library document
 * quarantine binary intake (`LIB-FILE-UPLOAD-01`).
 */
export const libraryQuarantineUploadEndpoint = onRequest(
  {
    cors: false,
    maxInstances: 10,
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (
    request: LibraryQuarantineUploadHttpRequest,
    response: LibraryQuarantineUploadHttpResponseWriter
  ) => {
    const runtime = getOrCreateProductionLibraryQuarantineUploadRuntime();

    await executeLibraryQuarantineUploadEndpoint(
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
        receiptStore: runtime.receiptStore,
        writeCoordinator: runtime.writeCoordinator,
      }
    );
  }
);
