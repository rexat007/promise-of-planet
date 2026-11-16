import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  LibraryRightsStatus,
  type LibraryDocument,
} from '../shared/libraryContract';
import { WorkflowState } from '../shared/workflowContract';
import { LibraryValidator } from './libraryValidator';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  deriveQuarantineCatalogDocumentId,
} from './libraryQuarantineCatalogHandoffService';
import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  type LibraryQuarantineFirestoreDocumentSnapshot,
} from './firestoreLibraryQuarantineReceiptStore';
import { type LibraryQuarantineReviewDraftFirestoreDatabase } from './firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
  validatePersistedLibraryQuarantineAvExecution,
} from './libraryQuarantineAvExecutionContract';
import {
  LIBRARY_QUARANTINE_PDF_INSPECTIONS_COLLECTION,
  arePersistedPdfInspectionProvenanceIncompatible,
  validatePersistedLibraryQuarantinePdfInspection,
} from './libraryIsolatedPdfInspection';
import {
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
} from './libraryQuarantineUploadEndpoint';
import { validateLibraryQuarantineInternalReceipt } from './libraryQuarantineReceiptContract';
import { MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES } from './libraryUploadBinaryAdmission';
import { inspectLibraryUploadDeepStructure } from './libraryUploadDeepStructure';
import {
  parseCanonicalSafeGcsGeneration,
  type GcsLibraryQuarantineObjectMetadata,
} from './gcsLibraryQuarantineStorageAdapter';
import {
  LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION,
  LIBRARY_RELEASED_STORAGE_PREFIX,
  PUBLISHED_BINARY_CACHE_CONTROL,
  PUBLISHED_BINARY_CONTENT_DISPOSITION,
  derivePublishedBinaryPublicLibraryDocumentId,
  deriveSafePublishedDownloadFilename,
  parsePublishedBinaryPublicLibraryDocumentId,
  validatePersistedPublishedBinaryReleaseRecord,
  type PublishedBinaryStorageBucket,
  type PublishedBinaryStorageFile,
} from './libraryPublishedBinaryReleaseService';

/**
 * LIB-DIRECT-FILE-01 — Anonymous Public Published Binary Download Endpoint
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Public Gen 2 HTTPS `onRequest` gateway supporting strictly `GET` and `HEAD`.
 * - Accepts ONLY a single canonical query parameter `documentId=doc-qbin-<32-hex>`.
 *   Rejects path suffixes, extra/duplicate query parameters, `qcat-*`, `doc-qsrc-*`,
 *   or arbitrary document IDs with fail-closed 400/403/404 responses (never exposing
 *   internal bucket names, object paths, hashes, generations, or UIDs).
 * - Verifies on every request:
 *   1. `library_documents/doc-qbin-<receiptId>` exists, passes schema validation,
 *      has `workflowState === WorkflowState.Published`, and `rightsStatus` is strictly
 *      `OpenPubliclyAvailable` or `PermissionGranted`.
 *   2. `library_published_binary_releases/<receiptId>` exists, passes closed schema
 *      validation, has `status === 'PUBLISHED'`, `isSanitized === false`,
 *      `isVerifiedSafe === false`, `releasedStoragePath` starts with
 *      `library/released/<receiptId>/`, `releasedBucketName === LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME`.
 *   3. `library_quarantine_receipts/<receiptId>` remains `Quarantined` with matching
 *      `sha256`, `generation`, and `byteSize <= 15,000,000`.
 *   4. `library_quarantine_av_executions/<avRequestId>` exists, matches receipt + safety
 *      provenance, and has terminal clean state `AV_NO_THREAT_DETECTED`.
 *   5. Generation-pinned read from `library/released/<receiptId>/v1/document.<pdf|docx>`
 *      confirms zero Firebase download tokens, no `allUsers`/`allAuthenticatedUsers` ACL,
 *      exact byte count, SHA-256 match, and deep OOXML/PDF format admission.
 * - Serves bytes strictly as an attachment (`Content-Disposition: attachment` with safe
 *   RFC 5987 UTF-8 filename), `X-Content-Type-Options: nosniff`,
 *   `Content-Security-Policy: default-src 'none'; sandbox`, and
 *   `Cache-Control: private, no-store, max-age=0`. Zero signed URLs or redirects.
 */

export const PUBLISHED_BINARY_DOWNLOAD_ALLOWED_QUERY_KEYS: ReadonlySet<string> =
  new Set(['documentId']);

export type PublishedBinaryDownloadErrorCode =
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_PATH'
  | 'INVALID_QUERY_PARAMETERS'
  | 'FORBIDDEN_DOCUMENT_PREFIX'
  | 'INVALID_DOCUMENT_ID'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_NOT_PUBLIC'
  | 'RIGHTS_NOT_PERMITTED'
  | 'RELEASE_MANIFEST_MISSING'
  | 'RELEASE_REVOKED'
  | 'AV_SCAN_NOT_CLEARED'
  | 'PDF_INSPECTION_NOT_CLEARED'
  | 'SOURCE_RECEIPT_INVALID'
  | 'INVALID_DOWNLOAD_FILENAME'
  | 'STORAGE_BUCKET_MISCONFIGURED'
  | 'RELEASED_BINARY_UNAVAILABLE'
  | 'STORAGE_INTEGRITY_ERROR'
  | 'INTERNAL_DELIVERY_ERROR';

export interface PublishedBinaryDownloadHttpRequest {
  readonly method: string;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly path?: string;
  readonly url?: string;
}

export interface PublishedBinaryDownloadHttpResponseWriter {
  status(code: number): PublishedBinaryDownloadHttpResponseWriter;
  setHeader(
    name: string,
    value: string
  ): PublishedBinaryDownloadHttpResponseWriter;
  getHeader?(name: string): string | number | string[] | undefined;
  json(body: unknown): void;
  send(body: Buffer | string): void;
  end(chunk?: Buffer | string): void;
}

export interface PublishedBinaryDownloadDependencies {
  readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly storageBucket: PublishedBinaryStorageBucket;
}

function applyAttachmentSecurityHeaders(
  res: PublishedBinaryDownloadHttpResponseWriter
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', PUBLISHED_BINARY_CACHE_CONTROL);
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; sandbox"
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendSanitizedError(
  res: PublishedBinaryDownloadHttpResponseWriter,
  statusCode: number,
  errorCode: PublishedBinaryDownloadErrorCode,
  message: string,
  method: string
): void {
  applyAttachmentSecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (method === 'HEAD') {
    res.status(statusCode).end();
    return;
  }
  res.status(statusCode).json(
    Object.freeze({
      ok: false,
      errorCode,
      message,
    })
  );
}

function extractDocumentIdQuery(req: PublishedBinaryDownloadHttpRequest):
  | { readonly ok: true; readonly rawDocumentId: string }
  | {
      readonly ok: false;
      readonly errorCode: PublishedBinaryDownloadErrorCode;
      readonly message: string;
      readonly statusCode: number;
    } {
  if (typeof req.path === 'string' && req.path !== '' && req.path !== '/') {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'INVALID_PATH',
      message: 'Extra path segments are not permitted.',
    };
  }

  let parsedUrlSearch: URLSearchParams | null = null;
  if (typeof req.url === 'string' && req.url.length > 0) {
    try {
      const parsed = new URL(req.url, 'https://placeholder.local');
      if (parsed.pathname !== '/' && parsed.pathname !== '') {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_PATH',
          message: 'Extra path segments are not permitted.',
        };
      }
      parsedUrlSearch = parsed.searchParams;
    } catch {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_QUERY_PARAMETERS',
        message: 'Malformed request URL.',
      };
    }
  }

  if (parsedUrlSearch) {
    const keys = Array.from(parsedUrlSearch.keys());
    if (
      keys.length !== 1 ||
      keys[0] !== 'documentId' ||
      parsedUrlSearch.getAll('documentId').length !== 1
    ) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_QUERY_PARAMETERS',
        message: 'Request must include exactly one documentId query parameter.',
      };
    }
  }

  const rawQuery = req.query;
  if (rawQuery && typeof rawQuery === 'object') {
    const qKeys = Object.keys(rawQuery);
    if (qKeys.length > 0) {
      if (qKeys.length !== 1 || qKeys[0] !== 'documentId') {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_QUERY_PARAMETERS',
          message: 'Unexpected query parameters in request.',
        };
      }
      const val = rawQuery.documentId;
      if (typeof val !== 'string' || val.trim().length === 0) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_QUERY_PARAMETERS',
          message: 'documentId query parameter must be a non-empty string.',
        };
      }
      return { ok: true, rawDocumentId: val.trim() };
    }
  }

  const fromUrl = parsedUrlSearch?.get('documentId')?.trim();
  if (!fromUrl) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'INVALID_QUERY_PARAMETERS',
      message: 'Missing required documentId query parameter.',
    };
  }
  return { ok: true, rawDocumentId: fromUrl };
}

function buildAsciiFallbackFilename(
  utf8Filename: string,
  ext: 'pdf' | 'docx'
): string {
  const stem = utf8Filename.slice(0, utf8Filename.length - ext.length - 1);
  const ascii = stem
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/[\\/:*?"<>|;]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const safeStem = ascii.length > 0 ? ascii : 'library-document';
  return `${safeStem}.${ext}`;
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function formatAttachmentContentDisposition(filename: string): string {
  const ext = filename.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
  const asciiFallback = buildAsciiFallbackFilename(filename, ext);
  const encodedUtf8 = encodeRfc5987Value(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

function hasPublicAclOrTokenExposure(
  meta: GcsLibraryQuarantineObjectMetadata
): boolean {
  if (
    typeof meta.firebaseStorageDownloadTokens === 'string' &&
    meta.firebaseStorageDownloadTokens.trim().length > 0
  ) {
    return true;
  }
  if (
    typeof meta.downloadTokens === 'string' &&
    meta.downloadTokens.trim().length > 0
  ) {
    return true;
  }
  if (meta.public === true) {
    return true;
  }
  if (
    typeof meta.predefinedAcl === 'string' &&
    meta.predefinedAcl.toLowerCase().includes('public')
  ) {
    return true;
  }
  const customMeta = meta.metadata;
  if (customMeta && typeof customMeta === 'object') {
    for (const [k, v] of Object.entries(customMeta)) {
      const lowerKey = k.toLowerCase();
      if (
        (lowerKey === 'firebasestoragedownloadtokens' ||
          lowerKey === 'downloadtokens') &&
        typeof v === 'string' &&
        v.trim().length > 0
      ) {
        return true;
      }
    }
  }
  if (Array.isArray(meta.acl)) {
    for (const entry of meta.acl) {
      const entity =
        typeof entry?.entity === 'string'
          ? entry.entity.trim().toLowerCase()
          : '';
      if (entity === 'allusers' || entity === 'allauthenticatedusers') {
        return true;
      }
    }
  }
  return false;
}

async function readBoundedReleasedBytes(
  file: PublishedBinaryStorageFile,
  expectedByteSize: number
): Promise<
  | { readonly ok: true; readonly bytes: Buffer; readonly sha256: string }
  | { readonly ok: false; readonly message: string }
> {
  const stream = file.createReadStream({ validation: false });
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for await (const rawChunk of stream) {
      const buf = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk as Uint8Array);
      total += buf.length;
      if (
        total > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES ||
        total > expectedByteSize
      ) {
        if (typeof stream.destroy === 'function') {
          stream.destroy(new Error('BYTE_SIZE_EXCEEDED'));
        }
        return {
          ok: false,
          message: 'Released object exceeded maximum permitted size.',
        };
      }
      chunks.push(buf);
    }
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : 'Failed reading released binary stream.',
    };
  }

  const combined = Buffer.concat(chunks);
  if (combined.length !== expectedByteSize || combined.length < 1) {
    return {
      ok: false,
      message: 'Released object byte size mismatch.',
    };
  }
  const sha256 = createHash('sha256').update(combined).digest('hex');
  return { ok: true, bytes: combined, sha256 };
}

export function createPublishedBinaryDownloadHandler(
  deps: PublishedBinaryDownloadDependencies
) {
  if (
    !deps ||
    typeof deps !== 'object' ||
    !deps.db ||
    typeof deps.db.collection !== 'function' ||
    !deps.storageBucket ||
    typeof deps.storageBucket.file !== 'function'
  ) {
    throw new Error(
      'createPublishedBinaryDownloadHandler requires valid db and storageBucket.'
    );
  }

  return async function handlePublishedBinaryDownload(
    req: PublishedBinaryDownloadHttpRequest,
    res: PublishedBinaryDownloadHttpResponseWriter
  ): Promise<void> {
    const method = (req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendSanitizedError(
        res,
        405,
        'METHOD_NOT_ALLOWED',
        'Only GET and HEAD methods are permitted.',
        method
      );
      return;
    }

    const bucketName =
      typeof deps.storageBucket.name === 'string' &&
      deps.storageBucket.name.trim().length > 0
        ? deps.storageBucket.name.trim()
        : LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME;
    if (
      bucketName === FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME ||
      bucketName !== LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    ) {
      sendSanitizedError(
        res,
        503,
        'STORAGE_BUCKET_MISCONFIGURED',
        'Download storage boundary misconfigured.',
        method
      );
      return;
    }

    const queryResult = extractDocumentIdQuery(req);
    if (!queryResult.ok) {
      sendSanitizedError(
        res,
        queryResult.statusCode,
        queryResult.errorCode,
        queryResult.message,
        method
      );
      return;
    }
    const rawDocId = queryResult.rawDocumentId;

    if (
      rawDocId.startsWith('qcat-') ||
      rawDocId.startsWith('doc-qsrc-')
    ) {
      sendSanitizedError(
        res,
        403,
        'FORBIDDEN_DOCUMENT_PREFIX',
        'Document identifier is not eligible for public binary download.',
        method
      );
      return;
    }

    const receiptId = parsePublishedBinaryPublicLibraryDocumentId(rawDocId);
    if (!receiptId) {
      sendSanitizedError(
        res,
        400,
        'INVALID_DOCUMENT_ID',
        'Invalid published binary document identifier.',
        method
      );
      return;
    }

    try {
      const publicDocRef = deps.db
        .collection(LIBRARY_DOCUMENTS_COLLECTION)
        .doc(rawDocId);
      const releaseRef = deps.db
        .collection(LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION)
        .doc(receiptId);
      const receiptRef = deps.db
        .collection(LIBRARY_QUARANTINE_RECEIPT_COLLECTION)
        .doc(receiptId);

      const getSnap = async (ref: {
        get?: () => Promise<LibraryQuarantineFirestoreDocumentSnapshot>;
      }): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
        if (typeof ref.get !== 'function') {
          throw new Error('STORE_READ_UNSUPPORTED');
        }
        return ref.get();
      };

      const [publicDocSnap, releaseSnap, receiptSnap] = await Promise.all([
        getSnap(publicDocRef),
        getSnap(releaseRef),
        getSnap(receiptRef),
      ]);

      if (!publicDocSnap.exists) {
        sendSanitizedError(
          res,
          404,
          'DOCUMENT_NOT_FOUND',
          'Requested public document was not found.',
          method
        );
        return;
      }

      let publicDoc: LibraryDocument;
      try {
        publicDoc = LibraryValidator.validatePersistedDocument(
          publicDocSnap.data(),
          rawDocId
        );
      } catch {
        sendSanitizedError(
          res,
          403,
          'DOCUMENT_NOT_PUBLIC',
          'Requested document is not valid for public download.',
          method
        );
        return;
      }

      if (publicDoc.workflowState !== WorkflowState.Published) {
        sendSanitizedError(
          res,
          403,
          'DOCUMENT_NOT_PUBLIC',
          'Requested document is not currently published.',
          method
        );
        return;
      }

      if (
        publicDoc.rightsStatus !== LibraryRightsStatus.OpenPubliclyAvailable &&
        publicDoc.rightsStatus !== LibraryRightsStatus.PermissionGranted
      ) {
        sendSanitizedError(
          res,
          403,
          'RIGHTS_NOT_PERMITTED',
          'Document rights status does not authorize binary download.',
          method
        );
        return;
      }

      if (!releaseSnap.exists) {
        sendSanitizedError(
          res,
          404,
          'RELEASE_MANIFEST_MISSING',
          'Published binary release manifest not found.',
          method
        );
        return;
      }

      const releaseValidation = validatePersistedPublishedBinaryReleaseRecord(
        releaseSnap.data(),
        receiptId
      );
      if (!releaseValidation.ok) {
        sendSanitizedError(
          res,
          403,
          'RELEASE_MANIFEST_MISSING',
          'Published binary release manifest failed verification.',
          method
        );
        return;
      }
      const release = releaseValidation.release;

      if (release.status !== 'PUBLISHED') {
        sendSanitizedError(
          res,
          403,
          'RELEASE_REVOKED',
          'Binary download release has been revoked.',
          method
        );
        return;
      }

      if (
        publicDoc.rightsStatus !== release.publicRightsStatus ||
        publicDoc.organizationId !== release.organizationId ||
        publicDoc.sourceId !== release.sourceId ||
        !publicDoc.versions.some(
          (v) => v.referenceUrl === release.downloadGatewayUrl
        ) ||
        !release.releasedStoragePath.startsWith(
          `${LIBRARY_RELEASED_STORAGE_PREFIX}/${receiptId}/`
        ) ||
        release.sourceByteSize > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
      ) {
        sendSanitizedError(
          res,
          403,
          'DOCUMENT_NOT_PUBLIC',
          'Public document and release manifest do not match.',
          method
        );
        return;
      }

      const filenameCheck = deriveSafePublishedDownloadFilename(
        release.downloadFilename,
        release.format
      );
      if (!filenameCheck.ok) {
        sendSanitizedError(
          res,
          403,
          'INVALID_DOWNLOAD_FILENAME',
          'Configured download filename failed safety checks.',
          method
        );
        return;
      }

      // Re-verify source receipt and terminal AV scan result
      if (!receiptSnap.exists) {
        sendSanitizedError(
          res,
          403,
          'SOURCE_RECEIPT_INVALID',
          'Source quarantine receipt missing.',
          method
        );
        return;
      }
      const rawReceiptEnvelope = receiptSnap.data() as
        | { readonly revision?: unknown; readonly receipt?: unknown }
        | undefined;
      if (
        !rawReceiptEnvelope ||
        typeof rawReceiptEnvelope !== 'object' ||
        rawReceiptEnvelope.revision !== release.sourceRevision
      ) {
        sendSanitizedError(
          res,
          403,
          'SOURCE_RECEIPT_INVALID',
          'Source quarantine receipt revision changed since publication.',
          method
        );
        return;
      }
      const receiptCheck = validateLibraryQuarantineInternalReceipt(
        rawReceiptEnvelope.receipt
      );
      if (!receiptCheck.ok) {
        sendSanitizedError(
          res,
          403,
          'SOURCE_RECEIPT_INVALID',
          'Source quarantine receipt is invalid.',
          method
        );
        return;
      }
      const receipt = receiptCheck.receipt;
      if (
        receipt.state !== 'Quarantined' ||
        receipt.sha256 !== release.sourceSha256 ||
        receipt.generation !== release.sourceGeneration ||
        receipt.byteSize !== release.sourceByteSize ||
        receipt.format !== release.format ||
        receipt.byteSize > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
      ) {
        sendSanitizedError(
          res,
          403,
          'SOURCE_RECEIPT_INVALID',
          'Source receipt no longer matches published binary release.',
          method
        );
        return;
      }

      const avSnap = await getSnap(
        deps.db
          .collection(LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION)
          .doc(release.avRequestId)
      );
      if (!avSnap.exists) {
        sendSanitizedError(
          res,
          403,
          'AV_SCAN_NOT_CLEARED',
          'Required AV scan record is missing.',
          method
        );
        return;
      }
      const avValidation = validatePersistedLibraryQuarantineAvExecution(
        avSnap.data(),
        release.avRequestId
      );
      if (
        !avValidation.ok ||
        avValidation.value.state !== 'AV_NO_THREAT_DETECTED' ||
        avValidation.value.receiptId !== receiptId ||
        avValidation.value.documentId !==
          deriveQuarantineCatalogDocumentId(receiptId) ||
        avValidation.value.sourceRevision !== release.sourceRevision ||
        avValidation.value.sourceSha256 !== release.sourceSha256 ||
        avValidation.value.sourceGeneration !== release.sourceGeneration ||
        avValidation.value.sourceByteSize !== release.sourceByteSize ||
        avValidation.value.sourceFormat !== release.format ||
        avValidation.value.scannedBytes !== release.sourceByteSize ||
        avValidation.value.exitCode !== 0
      ) {
        sendSanitizedError(
          res,
          403,
          'AV_SCAN_NOT_CLEARED',
          'AV scan is not clean or does not match released file.',
          method
        );
        return;
      }

      if (release.format === 'PDF') {
        const pdfSnap = await getSnap(
          deps.db
            .collection(LIBRARY_QUARANTINE_PDF_INSPECTIONS_COLLECTION)
            .doc(release.avRequestId)
        );
        if (!pdfSnap.exists) {
          sendSanitizedError(
            res,
            403,
            'PDF_INSPECTION_NOT_CLEARED',
            'Required isolated PDF parser inspection attestation is missing.',
            method
          );
          return;
        }
        const pdfValidation = validatePersistedLibraryQuarantinePdfInspection(
          pdfSnap.data(),
          release.avRequestId
        );
        if (
          !pdfValidation.ok ||
          arePersistedPdfInspectionProvenanceIncompatible(pdfValidation.value, {
            requestId: release.avRequestId,
            receiptId,
            documentId: deriveQuarantineCatalogDocumentId(receiptId),
            sourceRevision: release.sourceRevision,
            sourceUpdatedAt: release.sourceUpdatedAt,
            sourceSha256: release.sourceSha256,
            sourceGeneration: release.sourceGeneration,
            sourceByteSize: release.sourceByteSize,
            sourceFormat: release.format,
            deepInspectionStatus: release.deepInspectionStatus,
            safetyCaseRevision: release.safetyCaseRevision,
            effectiveHumanCaseRevision: release.alignedHumanCaseRevision,
            catalogUpdatedAt: release.catalogUpdatedAt,
            workerRunId: avValidation.value.workerRunId,
            avCompletedAt: avValidation.value.completedAt,
          })
        ) {
          sendSanitizedError(
            res,
            403,
            'PDF_INSPECTION_NOT_CLEARED',
            'Isolated PDF parser inspection attestation is missing, stale, or invalid.',
            method
          );
          return;
        }
      }

      // Inspect released GCS object metadata + generation-pinned stream
      const unpinnedReleasedFile = deps.storageBucket.file(
        release.releasedStoragePath
      );
      let releasedMeta: GcsLibraryQuarantineObjectMetadata;
      try {
        const [meta] = await unpinnedReleasedFile.getMetadata();
        releasedMeta = meta;
      } catch {
        sendSanitizedError(
          res,
          404,
          'RELEASED_BINARY_UNAVAILABLE',
          'Released binary object is unavailable.',
          method
        );
        return;
      }

      const metaGen = parseCanonicalSafeGcsGeneration(releasedMeta?.generation);
      if (
        !releasedMeta ||
        metaGen === null ||
        metaGen !== release.releasedObjectGeneration ||
        (releasedMeta.bucket && releasedMeta.bucket !== bucketName) ||
        (releasedMeta.name && releasedMeta.name !== release.releasedStoragePath) ||
        releasedMeta.contentType !== release.canonicalMimeType ||
        Number(releasedMeta.size) !== release.sourceByteSize ||
        releasedMeta.cacheControl !== PUBLISHED_BINARY_CACHE_CONTROL ||
        releasedMeta.contentDisposition !== PUBLISHED_BINARY_CONTENT_DISPOSITION ||
        hasPublicAclOrTokenExposure(releasedMeta) ||
        releasedMeta.metadata?.receiptId !== receiptId ||
        releasedMeta.metadata?.publicDocumentId !==
          derivePublishedBinaryPublicLibraryDocumentId(receiptId) ||
        releasedMeta.metadata?.sourceSha256 !== release.sourceSha256 ||
        releasedMeta.metadata?.isSanitized !== 'false' ||
        releasedMeta.metadata?.isVerifiedSafe !== 'false'
      ) {
        sendSanitizedError(
          res,
          503,
          'STORAGE_INTEGRITY_ERROR',
          'Released binary object failed integrity or privacy checks.',
          method
        );
        return;
      }

      if (method === 'HEAD') {
        applyAttachmentSecurityHeaders(res);
        res.setHeader('Content-Type', release.canonicalMimeType);
        res.setHeader('Content-Length', String(release.sourceByteSize));
        res.setHeader(
          'Content-Disposition',
          formatAttachmentContentDisposition(filenameCheck.filename)
        );
        res.status(200).end();
        return;
      }

      const pinnedFile = deps.storageBucket.file(release.releasedStoragePath, {
        generation: release.releasedObjectGeneration,
      });
      const streamRead = await readBoundedReleasedBytes(
        pinnedFile,
        release.sourceByteSize
      );
      if (!streamRead.ok || streamRead.sha256 !== release.sourceSha256) {
        sendSanitizedError(
          res,
          503,
          'STORAGE_INTEGRITY_ERROR',
          'Released binary checksum or size verification failed.',
          method
        );
        return;
      }

      const deepCheck = inspectLibraryUploadDeepStructure({
        originalFilename: filenameCheck.filename,
        claimedMimeType: release.canonicalMimeType,
        bytes: streamRead.bytes,
      });
      if (
        deepCheck.status !== release.deepInspectionStatus ||
        deepCheck.format !== release.format ||
        deepCheck.sha256 !== release.sourceSha256
      ) {
        sendSanitizedError(
          res,
          503,
          'STORAGE_INTEGRITY_ERROR',
          'Released binary failed structural admission verification.',
          method
        );
        return;
      }

      applyAttachmentSecurityHeaders(res);
      res.setHeader('Content-Type', release.canonicalMimeType);
      res.setHeader('Content-Length', String(streamRead.bytes.length));
      res.setHeader(
        'Content-Disposition',
        formatAttachmentContentDisposition(filenameCheck.filename)
      );
      res.status(200).send(streamRead.bytes);
    } catch {
      sendSanitizedError(
        res,
        503,
        'INTERNAL_DELIVERY_ERROR',
        'Published binary download service is temporarily unavailable.',
        method
      );
    }
  };
}

export const libraryPublishedBinaryDownload = onRequest(
  {
    cors: false,
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    const db = getFirestore() as unknown as LibraryQuarantineReviewDraftFirestoreDatabase;
    const storageBucket = getStorage().bucket(
      LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    ) as unknown as PublishedBinaryStorageBucket;

    const handler = createPublishedBinaryDownloadHandler({
      db,
      storageBucket,
    });
    await handler(
      {
        method: req.method,
        headers: req.headers,
        query: req.query as Record<string, unknown>,
        path: req.path,
        url: req.url,
      },
      res as unknown as PublishedBinaryDownloadHttpResponseWriter
    );
  }
);
