import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
  type LibraryUploadPreliminaryFormat,
} from './libraryUploadBinaryAdmission';
import { inspectLibraryUploadDeepStructure } from './libraryUploadDeepStructure';
import {
  LIBRARY_QUARANTINE_STORAGE_PREFIX,
  LibraryQuarantineReceiptState,
  deriveLibraryQuarantineStoragePath,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
  parseLibraryQuarantineStoragePath,
  validateLibraryQuarantineInternalReceipt,
  type LibraryQuarantineInternalReceipt,
  type TrustedStorageReadbackAttestation,
} from './libraryQuarantineReceiptContract';

/**
 * LIB-FILE-02B2A / LIB-FILE-02B2C — Private Library GCS Quarantine Adapter
 * (with Generation-Pinned Readback)
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Dependency-injected server-side Google Cloud Storage adapter for privately
 *   quarantined PDF and DOCX library upload candidates.
 * - Uses the validated `LibraryQuarantineInternalReceipt` as the sole authority
 *   for `receiptId`, `uploaderUid`, `format`, `canonicalMimeType`, `byteSize`,
 *   `sha256`, and canonical `storagePath` (`library/quarantine/<receiptId>/source.<pdf|docx>`).
 * - Requires `receipt.state === 'WritePending'` before initiating a new storage write.
 * - Enforces conditional creation `ifGenerationMatch: 0` (never overwrites).
 * - Sets private cache headers (`cacheControl: 'private, no-store, max-age=0'`),
 *   `contentDisposition: 'attachment'`, and server-owned immutable custom metadata.
 * - Closes the metadata-to-byte-stream generation race (`LIB-FILE-02B2C`):
 *   1. Reads object metadata from the canonical path and validates a canonical,
 *      non-zero, positive decimal integer GCS generation within `Number.MAX_SAFE_INTEGER`.
 *   2. Acquires a generation-pinned file handle via
 *      `bucket.file(canonicalStoragePath, { generation: verifiedGeneration })`.
 *   3. Streams the actual stored bytes exclusively through that generation-pinned
 *      handle with a bounded reader (`<= 15,000,000` bytes) and early abort on
 *      excess bytes, never falling back to an unpinned stream and never calling
 *      unbounded `file.download()`.
 * - Rejects any object exhibiting `firebaseStorageDownloadTokens`, download tokens,
 *   or visible public ACL grants.
 * - Does NOT claim proof of bucket-level IAM privacy from object metadata alone
 *   (`bucketIamPrivacyVerified: false`).
 * - Does NOT mutate Firestore or transition receipt states directly; returns
 *   `TrustedStorageReadbackAttestation` only after verified generation-pinned
 *   readback for consumption by the write and recovery coordinators.
 */

export const LIBRARY_QUARANTINE_CACHE_CONTROL =
  'private, no-store, max-age=0' as const;

export const LIBRARY_QUARANTINE_CONTENT_DISPOSITION = 'attachment' as const;

export const LIBRARY_QUARANTINE_METADATA_STATE_VALUE = 'QUARANTINED' as const;

export interface GcsLibraryQuarantineAclEntry {
  readonly entity?: string;
  readonly role?: string;
  [key: string]: unknown;
}

export interface GcsLibraryQuarantineObjectMetadata {
  readonly name?: string;
  readonly bucket?: string;
  readonly generation?: string | number;
  readonly metageneration?: string | number;
  readonly etag?: string;
  readonly contentType?: string;
  readonly cacheControl?: string;
  readonly contentDisposition?: string;
  readonly size?: string | number;
  readonly timeCreated?: string;
  readonly updated?: string;
  readonly acl?: readonly GcsLibraryQuarantineAclEntry[];
  readonly predefinedAcl?: string;
  readonly public?: boolean;
  readonly firebaseStorageDownloadTokens?: string;
  readonly downloadTokens?: string;
  readonly metadata?: Readonly<Record<string, string | undefined>>;
}

export interface GcsLibraryQuarantineSavePreconditions {
  readonly ifGenerationMatch: 0;
}

export interface GcsLibraryQuarantineSaveOptions {
  readonly contentType: string;
  readonly resumable: false;
  readonly preconditionOpts: GcsLibraryQuarantineSavePreconditions;
  readonly preconditions: GcsLibraryQuarantineSavePreconditions;
  readonly metadata: {
    readonly cacheControl: typeof LIBRARY_QUARANTINE_CACHE_CONTROL;
    readonly contentDisposition: typeof LIBRARY_QUARANTINE_CONTENT_DISPOSITION;
    readonly metadata: {
      readonly receiptId: string;
      readonly uploaderUid: string;
      readonly sha256: string;
      readonly format: LibraryUploadPreliminaryFormat;
      readonly quarantineState: typeof LIBRARY_QUARANTINE_METADATA_STATE_VALUE;
    };
  };
}

export interface GcsLibraryQuarantineReadStreamOptions {
  readonly validation?: boolean;
  readonly start?: number;
  readonly end?: number;
}

export interface GcsLibraryQuarantineReadableStream
  extends AsyncIterable<Uint8Array | Buffer> {
  destroy?(error?: Error): void;
}

export interface GcsLibraryQuarantineFileOptions {
  readonly generation?: string;
}

/**
 * Dependency-injected GCS File contract.
 * Intentionally omits unbounded `download()` to enforce bounded stream reading.
 */
export interface GcsLibraryQuarantineFile {
  readonly name: string;
  readonly generation?: string | number;
  save(
    data: Buffer,
    options: GcsLibraryQuarantineSaveOptions
  ): Promise<void>;
  getMetadata(): Promise<[GcsLibraryQuarantineObjectMetadata, unknown?]>;
  createReadStream(
    options?: GcsLibraryQuarantineReadStreamOptions
  ): GcsLibraryQuarantineReadableStream;
}

export interface GcsLibraryQuarantineBucket {
  readonly name?: string;
  file(
    objectPath: string,
    options?: GcsLibraryQuarantineFileOptions
  ): GcsLibraryQuarantineFile;
}

export interface WriteLibraryQuarantineObjectInput {
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly bytes: Buffer | Uint8Array;
  readonly verifiedAtIso?: string;
}

export interface VerifyExistingLibraryQuarantineObjectInput {
  readonly receipt: LibraryQuarantineInternalReceipt;
  readonly verifiedAtIso?: string;
}

export type LibraryQuarantineGcsAdapterErrorCode =
  | 'INVALID_ADAPTER_DEPENDENCY'
  | 'INVALID_ADAPTER_INPUT'
  | 'UNTRUSTED_CALLER_FIELD'
  | 'INVALID_RECEIPT_RECORD'
  | 'INVALID_RECEIPT_STATE_FOR_WRITE'
  | 'INVALID_RECEIPT_STATE_FOR_VERIFY'
  | 'INVALID_BINARY_BYTES'
  | 'INPUT_BYTE_SIZE_MISMATCH'
  | 'INPUT_SHA256_MISMATCH'
  | 'BINARY_ADMISSION_OR_STRUCTURE_REJECTED'
  | 'INVALID_TIMESTAMP'
  | 'FILE_PATH_MISMATCH'
  | 'EXISTING_OBJECT_CONFLICT'
  | 'STORED_OBJECT_NOT_FOUND'
  | 'STORED_GENERATION_INVALID'
  | 'STORED_MIME_MISMATCH'
  | 'INSECURE_CACHE_OR_DISPOSITION_POLICY'
  | 'PUBLIC_EXPOSURE_OR_TOKEN_DETECTED'
  | 'STORED_OWNERSHIP_METADATA_MISMATCH'
  | 'STORED_BYTE_SIZE_EXCEEDED_OR_MISMATCH'
  | 'STORED_SHA256_MISMATCH'
  | 'AMBIGUOUS_WRITE_OUTCOME'
  | 'READBACK_INTERRUPTED_AFTER_WRITE';

export interface LibraryQuarantineGcsVerifiedSuccess {
  readonly ok: true;
  readonly status: 'WRITTEN_AND_VERIFIED' | 'EXISTING_VERIFIED';
  readonly createdNewObject: boolean;
  readonly receiptId: string;
  readonly attestation: TrustedStorageReadbackAttestation;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineGcsNeedsReconciliationFailure {
  readonly ok: false;
  readonly status: 'NEEDS_RECONCILIATION';
  readonly errorCode:
    | 'AMBIGUOUS_WRITE_OUTCOME'
    | 'READBACK_INTERRUPTED_AFTER_WRITE';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly reconciliationReason: string;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineGcsDeterministicFailure {
  readonly ok: false;
  readonly status: 'PREWRITE_REJECTED' | 'CONFLICT_OR_MISMATCH';
  readonly errorCode: Exclude<
    LibraryQuarantineGcsAdapterErrorCode,
    'AMBIGUOUS_WRITE_OUTCOME' | 'READBACK_INTERRUPTED_AFTER_WRITE'
  >;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly bucketIamPrivacyVerified: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type LibraryQuarantineGcsAdapterResult =
  | LibraryQuarantineGcsVerifiedSuccess
  | LibraryQuarantineGcsNeedsReconciliationFailure
  | LibraryQuarantineGcsDeterministicFailure;

export const MAX_SAFE_GCS_GENERATION_NUMBER = Number.MAX_SAFE_INTEGER;

const CANONICAL_DECIMAL_GENERATION_REGEX = /^[1-9][0-9]{0,15}$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const CONTROL_OR_BIDI_CHAR_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/g;

/**
 * Validates that a raw GCS generation value is a canonical, non-zero, positive
 * decimal integer representation within `1..Number.MAX_SAFE_INTEGER` so that
 * `@google-cloud/storage` (`bucket.file(path, { generation })`, which parses
 * generation via base-10 integer conversion into a JS Number) targets the exact
 * generation without precision loss, sign/fraction ambiguity, or leading zeros.
 */
export function parseCanonicalSafeGcsGeneration(
  rawGeneration: unknown
): string | null {
  if (typeof rawGeneration === 'number') {
    if (!Number.isSafeInteger(rawGeneration) || rawGeneration <= 0) {
      return null;
    }
    const canonical = String(rawGeneration);
    return CANONICAL_DECIMAL_GENERATION_REGEX.test(canonical)
      ? canonical
      : null;
  }

  if (typeof rawGeneration === 'string') {
    if (!CANONICAL_DECIMAL_GENERATION_REGEX.test(rawGeneration)) {
      return null;
    }
    const parsedNum = Number(rawGeneration);
    if (
      !Number.isSafeInteger(parsedNum) ||
      parsedNum <= 0 ||
      String(parsedNum) !== rawGeneration
    ) {
      return null;
    }
    return rawGeneration;
  }

  return null;
}

const ALLOWED_WRITE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receipt',
  'bytes',
  'verifiedAtIso',
]);

const ALLOWED_VERIFY_EXISTING_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receipt',
  'verifiedAtIso',
]);

const ALLOWED_CUSTOM_METADATA_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'uploaderUid',
  'sha256',
  'format',
  'quarantineState',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function findUnexpectedPropertyOrSymbol(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): string | null {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowedKeys.has(key)) {
      return key;
    }
  }
  const symbols = Object.getOwnPropertySymbols(obj);
  if (symbols.length > 0) {
    return String(symbols[0]);
  }
  return null;
}

function sanitizeDiagnosticText(raw: string): string {
  const withoutPaths = raw
    .replace(/library\/quarantine\/[0-9a-f]{32}\/source\.(?:pdf|docx)/gi, '[REDACTED_QUARANTINE_PATH]')
    .replace(new RegExp(LIBRARY_QUARANTINE_STORAGE_PREFIX, 'gi'), '[REDACTED_PREFIX]')
    .replace(/https?:\/\/[^\s"']+/gi, '[REDACTED_URL]')
    .replace(/gs:\/\/[^\s"']+/gi, '[REDACTED_GS_URI]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED_TOKEN]')
    .replace(CONTROL_OR_BIDI_CHAR_REGEX, ' ')
    .trim();

  if (withoutPaths.length === 0) {
    return 'Storage operation encountered an unspecified error.';
  }
  return withoutPaths.length > 200
    ? `${withoutPaths.slice(0, 197)}...`
    : withoutPaths;
}

function makeDeterministicFailure(
  status: 'PREWRITE_REJECTED' | 'CONFLICT_OR_MISMATCH',
  errorCode: Exclude<
    LibraryQuarantineGcsAdapterErrorCode,
    'AMBIGUOUS_WRITE_OUTCOME' | 'READBACK_INTERRUPTED_AFTER_WRITE'
  >,
  errorMessage: string,
  receiptId: string | null
): LibraryQuarantineGcsDeterministicFailure {
  return Object.freeze({
    ok: false as const,
    status,
    errorCode,
    errorMessage: sanitizeDiagnosticText(errorMessage),
    receiptId,
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeNeedsReconciliationFailure(
  errorCode: 'AMBIGUOUS_WRITE_OUTCOME' | 'READBACK_INTERRUPTED_AFTER_WRITE',
  errorMessage: string,
  receiptId: string,
  reconciliationReason: string
): LibraryQuarantineGcsNeedsReconciliationFailure {
  return Object.freeze({
    ok: false as const,
    status: 'NEEDS_RECONCILIATION' as const,
    errorCode,
    errorMessage: sanitizeDiagnosticText(errorMessage),
    receiptId,
    reconciliationReason: sanitizeDiagnosticText(reconciliationReason),
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeVerifiedSuccess(
  status: 'WRITTEN_AND_VERIFIED' | 'EXISTING_VERIFIED',
  createdNewObject: boolean,
  receiptId: string,
  attestation: TrustedStorageReadbackAttestation
): LibraryQuarantineGcsVerifiedSuccess {
  return Object.freeze({
    ok: true as const,
    status,
    createdNewObject,
    receiptId,
    attestation: Object.freeze({ ...attestation }),
    bucketIamPrivacyVerified: false as const,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

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
    return /precondition\s*failed|conditionNotMet|\b412\b/i.test(
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
    return /not\s*found|no\s*such\s*object|\b404\b/i.test(candidate.message);
  }
  return false;
}

function extractExactByteSlice(rawBytes: unknown): Buffer | null {
  if (rawBytes instanceof Uint8Array) {
    return Buffer.from(
      rawBytes.buffer,
      rawBytes.byteOffset,
      rawBytes.byteLength
    );
  }
  return null;
}

function hasVisiblePublicAclOrDownloadToken(
  meta: GcsLibraryQuarantineObjectMetadata
): { readonly exposed: boolean; readonly detail: string } {
  if (meta.public === true) {
    return {
      exposed: true,
      detail: 'GCS object metadata indicates public=true.',
    };
  }

  if (
    typeof meta.predefinedAcl === 'string' &&
    /public/i.test(meta.predefinedAcl)
  ) {
    return {
      exposed: true,
      detail: 'GCS object metadata has a public predefinedAcl.',
    };
  }

  if (Array.isArray(meta.acl)) {
    for (const entry of meta.acl) {
      if (entry && typeof entry === 'object') {
        const entity =
          typeof entry.entity === 'string' ? entry.entity.toLowerCase() : '';
        if (
          entity === 'allusers' ||
          entity === 'allauthenticatedusers' ||
          entity.includes('allusers') ||
          entity.includes('allauthenticatedusers')
        ) {
          return {
            exposed: true,
            detail:
              'GCS object ACL grants access to allUsers or allAuthenticatedUsers.',
          };
        }
      }
    }
  }

  if (
    (typeof meta.firebaseStorageDownloadTokens === 'string' &&
      meta.firebaseStorageDownloadTokens.trim().length > 0) ||
    (typeof meta.downloadTokens === 'string' &&
      meta.downloadTokens.trim().length > 0)
  ) {
    return {
      exposed: true,
      detail:
        'GCS top-level object metadata contains Firebase download tokens.',
    };
  }

  const customMeta = meta.metadata;
  if (customMeta && typeof customMeta === 'object') {
    for (const key of Object.keys(customMeta)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('downloadtoken') ||
        lowerKey === 'firebasestoragedownloadtokens' ||
        lowerKey.includes('signedurl') ||
        lowerKey.includes('publicurl')
      ) {
        return {
          exposed: true,
          detail: `GCS custom metadata contains forbidden token/URL key "${key}".`,
        };
      }
    }
  }

  return { exposed: false, detail: '' };
}

/**
 * Dependency-injected server-side GCS adapter for private library quarantine objects.
 */
export class GcsLibraryQuarantineStorageAdapter {
  private readonly bucket: GcsLibraryQuarantineBucket;
  private readonly clock: () => string;

  constructor(options: {
    readonly bucket: GcsLibraryQuarantineBucket;
    readonly clock?: () => string;
  }) {
    if (
      !options ||
      !options.bucket ||
      typeof options.bucket.file !== 'function'
    ) {
      throw new Error(
        'INVALID_ADAPTER_DEPENDENCY: GcsLibraryQuarantineStorageAdapter requires a valid bucket interface with .file(objectPath).'
      );
    }
    this.bucket = options.bucket;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  /**
   * Conditionally writes a `WritePending` library quarantine binary to its
   * canonical internal path (`library/quarantine/<receiptId>/source.<pdf|docx>`)
   * with `ifGenerationMatch: 0`, then performs bounded actual-byte readback
   * verification to produce a `TrustedStorageReadbackAttestation`.
   */
  public async writeQuarantineObjectIfAbsent(
    rawInput: unknown
  ): Promise<LibraryQuarantineGcsAdapterResult> {
    if (!isPlainRecord(rawInput)) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_ADAPTER_INPUT',
        'writeQuarantineObjectIfAbsent input must be a plain non-null object.',
        null
      );
    }

    const unexpectedInputKey = findUnexpectedPropertyOrSymbol(
      rawInput,
      ALLOWED_WRITE_INPUT_KEYS
    );
    if (unexpectedInputKey !== null) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'UNTRUSTED_CALLER_FIELD',
        `Caller-supplied field "${unexpectedInputKey}" is forbidden in writeQuarantineObjectIfAbsent.`,
        null
      );
    }

    const receiptCheck = validateLibraryQuarantineInternalReceipt(
      rawInput.receipt
    );
    if (!receiptCheck.ok) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_RECEIPT_RECORD',
        receiptCheck.errorMessage,
        null
      );
    }

    const receipt = receiptCheck.receipt;

    if (receipt.state !== LibraryQuarantineReceiptState.WritePending) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_RECEIPT_STATE_FOR_WRITE',
        `Quarantine storage write requires receipt state "WritePending", received "${receipt.state}".`,
        receipt.receiptId
      );
    }

    // Re-verify canonical path derivation from receiptId + format
    const derivedPathCheck = deriveLibraryQuarantineStoragePath(
      receipt.receiptId,
      receipt.format
    );
    const parsedPathCheck = parseLibraryQuarantineStoragePath(
      receipt.storagePath
    );
    if (
      !derivedPathCheck.ok ||
      !parsedPathCheck.ok ||
      derivedPathCheck.parsed.storagePath !== receipt.storagePath ||
      parsedPathCheck.parsed.storagePath !== receipt.storagePath
    ) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'FILE_PATH_MISMATCH',
        'Receipt storagePath does not match canonical derived quarantine path.',
        receipt.receiptId
      );
    }

    const verifiedAtIso =
      rawInput.verifiedAtIso !== undefined
        ? rawInput.verifiedAtIso
        : this.clock();

    if (
      !isValidIsoUtcTimestamp(verifiedAtIso) ||
      Date.parse(verifiedAtIso) < Date.parse(receipt.updatedAt)
    ) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_TIMESTAMP',
        'verifiedAtIso must be a valid ISO-8601 UTC timestamp not earlier than receipt.updatedAt.',
        receipt.receiptId
      );
    }

    const byteSlice = extractExactByteSlice(rawInput.bytes);
    if (byteSlice === null) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_BINARY_BYTES',
        'Binary payload must be a Buffer or Uint8Array.',
        receipt.receiptId
      );
    }

    if (
      byteSlice.byteLength <= 0 ||
      byteSlice.byteLength > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
    ) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INPUT_BYTE_SIZE_MISMATCH',
        `Binary payload byteLength (${byteSlice.byteLength}) is outside the 1..${MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES} byte admission budget.`,
        receipt.receiptId
      );
    }

    if (byteSlice.byteLength !== receipt.byteSize) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INPUT_BYTE_SIZE_MISMATCH',
        `Binary payload byteLength (${byteSlice.byteLength}) does not match receipt.byteSize (${receipt.byteSize}).`,
        receipt.receiptId
      );
    }

    const actualInputSha256 = createHash('sha256')
      .update(byteSlice)
      .digest('hex')
      .toLowerCase();

    if (actualInputSha256 !== receipt.sha256) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INPUT_SHA256_MISMATCH',
        'Binary payload SHA-256 does not match receipt.sha256.',
        receipt.receiptId
      );
    }

    // Re-execute 01A + 01B deep structure inspection on the exact slice
    const deepInspection = inspectLibraryUploadDeepStructure({
      originalFilename: receipt.originalFilename,
      claimedMimeType: receipt.canonicalMimeType,
      bytes: byteSlice,
    });

    if (
      deepInspection.status === 'REJECTED' ||
      deepInspection.status !== receipt.deepInspectionStatus ||
      deepInspection.format !== receipt.format ||
      deepInspection.sizeBytes !== receipt.byteSize ||
      deepInspection.sha256 !== receipt.sha256
    ) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'BINARY_ADMISSION_OR_STRUCTURE_REJECTED',
        deepInspection.status === 'REJECTED'
          ? deepInspection.reasonDetail
          : 'Binary payload inspection verdict does not match authoritative receipt fields.',
        receipt.receiptId
      );
    }

    let file: GcsLibraryQuarantineFile;
    try {
      file = this.getValidatedFileHandle(receipt.storagePath);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Invalid GCS file handle.';
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_ADAPTER_DEPENDENCY',
        msg,
        receipt.receiptId
      );
    }

    const saveOptions: GcsLibraryQuarantineSaveOptions = Object.freeze({
      contentType: receipt.canonicalMimeType,
      resumable: false as const,
      preconditionOpts: Object.freeze({ ifGenerationMatch: 0 as const }),
      preconditions: Object.freeze({ ifGenerationMatch: 0 as const }),
      metadata: Object.freeze({
        cacheControl: LIBRARY_QUARANTINE_CACHE_CONTROL,
        contentDisposition: LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
        metadata: Object.freeze({
          receiptId: receipt.receiptId,
          uploaderUid: receipt.uploaderUid,
          sha256: receipt.sha256,
          format: receipt.format,
          quarantineState: LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
        }),
      }),
    });

    let createdNewObject = false;

    try {
      await file.save(byteSlice, saveOptions);
      createdNewObject = true;
    } catch (err) {
      if (isGcsPreconditionFailedError(err)) {
        // Object already exists at this canonical path (generation != 0).
        // Do NOT overwrite; verify the existing object through authoritative readback.
        return this.readAndVerifyStoredObject(
          file,
          receipt,
          verifiedAtIso,
          false,
          true
        );
      }

      const rawMsg =
        err instanceof Error ? err.message : 'Unknown GCS write failure.';
      return makeNeedsReconciliationFailure(
        'AMBIGUOUS_WRITE_OUTCOME',
        `GCS conditional write outcome is ambiguous for receipt "${receipt.receiptId}": ${rawMsg}`,
        receipt.receiptId,
        `GCS conditional write outcome was ambiguous: ${rawMsg}`
      );
    }

    return this.readAndVerifyStoredObject(
      file,
      receipt,
      verifiedAtIso,
      createdNewObject,
      true
    );
  }

  /**
   * Reads and verifies an existing quarantine object without writing or overwriting,
   * suitable for deterministic reconciliation of `WritePending` or `NeedsReconciliation`
   * receipts.
   */
  public async verifyExistingQuarantineObject(
    rawInput: unknown
  ): Promise<LibraryQuarantineGcsAdapterResult> {
    if (!isPlainRecord(rawInput)) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_ADAPTER_INPUT',
        'verifyExistingQuarantineObject input must be a plain non-null object.',
        null
      );
    }

    const unexpectedInputKey = findUnexpectedPropertyOrSymbol(
      rawInput,
      ALLOWED_VERIFY_EXISTING_INPUT_KEYS
    );
    if (unexpectedInputKey !== null) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'UNTRUSTED_CALLER_FIELD',
        `Caller-supplied field "${unexpectedInputKey}" is forbidden in verifyExistingQuarantineObject.`,
        null
      );
    }

    const receiptCheck = validateLibraryQuarantineInternalReceipt(
      rawInput.receipt
    );
    if (!receiptCheck.ok) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_RECEIPT_RECORD',
        receiptCheck.errorMessage,
        null
      );
    }

    const receipt = receiptCheck.receipt;

    if (
      receipt.state !== LibraryQuarantineReceiptState.WritePending &&
      receipt.state !== LibraryQuarantineReceiptState.NeedsReconciliation &&
      receipt.state !== LibraryQuarantineReceiptState.Quarantined
    ) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_RECEIPT_STATE_FOR_VERIFY',
        `verifyExistingQuarantineObject requires receipt state WritePending, NeedsReconciliation, or Quarantined; received "${receipt.state}".`,
        receipt.receiptId
      );
    }

    const verifiedAtIso =
      rawInput.verifiedAtIso !== undefined
        ? rawInput.verifiedAtIso
        : this.clock();

    if (
      !isValidIsoUtcTimestamp(verifiedAtIso) ||
      Date.parse(verifiedAtIso) < Date.parse(receipt.updatedAt)
    ) {
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_TIMESTAMP',
        'verifiedAtIso must be a valid ISO-8601 UTC timestamp not earlier than receipt.updatedAt.',
        receipt.receiptId
      );
    }

    let file: GcsLibraryQuarantineFile;
    try {
      file = this.getValidatedFileHandle(receipt.storagePath);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Invalid GCS file handle.';
      return makeDeterministicFailure(
        'PREWRITE_REJECTED',
        'INVALID_ADAPTER_DEPENDENCY',
        msg,
        receipt.receiptId
      );
    }

    return this.readAndVerifyStoredObject(
      file,
      receipt,
      verifiedAtIso,
      false,
      false
    );
  }

  private getValidatedFileHandle(
    canonicalStoragePath: string
  ): GcsLibraryQuarantineFile {
    const file = this.bucket.file(canonicalStoragePath);
    if (
      !file ||
      typeof file.save !== 'function' ||
      typeof file.getMetadata !== 'function' ||
      typeof file.createReadStream !== 'function'
    ) {
      throw new Error(
        'GCS file adapter must provide .save(), .getMetadata(), and bounded .createReadStream().'
      );
    }
    if (file.name !== canonicalStoragePath) {
      throw new Error(
        'GCS file handle name does not match the canonical quarantine storagePath.'
      );
    }
    return file;
  }

  private getValidatedGenerationPinnedFileHandle(
    canonicalStoragePath: string,
    verifiedGeneration: string,
    unpinnedFile: GcsLibraryQuarantineFile
  ): GcsLibraryQuarantineFile {
    const pinnedOptions: GcsLibraryQuarantineFileOptions = Object.freeze({
      generation: verifiedGeneration,
    });
    const pinnedFile = this.bucket.file(canonicalStoragePath, pinnedOptions);
    if (
      !pinnedFile ||
      typeof pinnedFile !== 'object' ||
      typeof pinnedFile.createReadStream !== 'function'
    ) {
      throw new Error(
        'GCS bucket adapter must provide a valid generation-pinned file handle with bounded .createReadStream().'
      );
    }
    if (pinnedFile === unpinnedFile) {
      throw new Error(
        'GCS bucket adapter returned the unpinned file handle instead of a distinct generation-pinned file handle.'
      );
    }
    if (pinnedFile.name !== canonicalStoragePath) {
      throw new Error(
        'GCS generation-pinned file handle name does not match the canonical quarantine storagePath.'
      );
    }
    if (pinnedFile.generation !== undefined) {
      const pinnedHandleGen = parseCanonicalSafeGcsGeneration(
        pinnedFile.generation
      );
      if (pinnedHandleGen !== verifiedGeneration) {
        throw new Error(
          'GCS generation-pinned file handle generation does not match the verified metadata generation.'
        );
      }
    }
    return pinnedFile;
  }

  private async readAndVerifyStoredObject(
    file: GcsLibraryQuarantineFile,
    receipt: LibraryQuarantineInternalReceipt,
    verifiedAtIso: string,
    createdNewObject: boolean,
    writeWasAttempted: boolean
  ): Promise<LibraryQuarantineGcsAdapterResult> {
    if (file.name !== receipt.storagePath) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        'FILE_PATH_MISMATCH',
        'GCS file handle name does not match receipt.storagePath.',
        receipt.receiptId
      );
    }

    let rawMeta: GcsLibraryQuarantineObjectMetadata;
    try {
      const metaResponse = await file.getMetadata();
      if (!Array.isArray(metaResponse) || !isPlainRecord(metaResponse[0])) {
        return makeNeedsReconciliationFailure(
          'READBACK_INTERRUPTED_AFTER_WRITE',
          'GCS getMetadata returned an invalid or empty metadata tuple.',
          receipt.receiptId,
          'GCS metadata readback returned an invalid structure.'
        );
      }
      rawMeta = metaResponse[0] as GcsLibraryQuarantineObjectMetadata;
    } catch (err) {
      if (isGcsNotFoundError(err) && !writeWasAttempted) {
        return makeDeterministicFailure(
          'CONFLICT_OR_MISMATCH',
          'STORED_OBJECT_NOT_FOUND',
          `Quarantine object for receipt "${receipt.receiptId}" does not exist in storage.`,
          receipt.receiptId
        );
      }
      const msg =
        err instanceof Error ? err.message : 'Unknown GCS getMetadata error.';
      return makeNeedsReconciliationFailure(
        'READBACK_INTERRUPTED_AFTER_WRITE',
        `GCS metadata readback failed for receipt "${receipt.receiptId}": ${msg}`,
        receipt.receiptId,
        `GCS metadata readback failed after write attempt: ${msg}`
      );
    }

    if (rawMeta.name !== undefined && rawMeta.name !== receipt.storagePath) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        'FILE_PATH_MISMATCH',
        'Stored object metadata name does not match receipt.storagePath.',
        receipt.receiptId
      );
    }

    // 1. Check for public ACL or download tokens
    const exposureCheck = hasVisiblePublicAclOrDownloadToken(rawMeta);
    if (exposureCheck.exposed) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        'PUBLIC_EXPOSURE_OR_TOKEN_DETECTED',
        exposureCheck.detail,
        receipt.receiptId
      );
    }

    // 2. Validate canonical, non-zero, positive safe-integer decimal generation
    const verifiedGeneration = parseCanonicalSafeGcsGeneration(
      rawMeta.generation
    );

    if (verifiedGeneration === null) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        'STORED_GENERATION_INVALID',
        'Stored GCS object is missing a valid canonical non-zero safe-integer decimal generation identifier.',
        receipt.receiptId
      );
    }

    // 3. Validate canonical MIME type
    if (rawMeta.contentType !== receipt.canonicalMimeType) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        'STORED_MIME_MISMATCH',
        `Stored GCS contentType "${String(rawMeta.contentType)}" does not match canonicalMimeType "${receipt.canonicalMimeType}".`,
        receipt.receiptId
      );
    }

    // 4. Validate private cacheControl and attachment contentDisposition
    if (
      rawMeta.cacheControl !== LIBRARY_QUARANTINE_CACHE_CONTROL ||
      rawMeta.contentDisposition !== LIBRARY_QUARANTINE_CONTENT_DISPOSITION
    ) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        'INSECURE_CACHE_OR_DISPOSITION_POLICY',
        'Stored GCS object is missing required private cacheControl or attachment contentDisposition.',
        receipt.receiptId
      );
    }

    // 5. Validate metadata byte size
    const metaSizeNum =
      typeof rawMeta.size === 'number'
        ? rawMeta.size
        : typeof rawMeta.size === 'string' && /^\d+$/.test(rawMeta.size)
          ? Number.parseInt(rawMeta.size, 10)
          : Number.NaN;

    if (
      !Number.isSafeInteger(metaSizeNum) ||
      metaSizeNum <= 0 ||
      metaSizeNum > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES ||
      metaSizeNum !== receipt.byteSize
    ) {
      return makeDeterministicFailure(
        createdNewObject ? 'CONFLICT_OR_MISMATCH' : 'CONFLICT_OR_MISMATCH',
        createdNewObject
          ? 'STORED_BYTE_SIZE_EXCEEDED_OR_MISMATCH'
          : 'EXISTING_OBJECT_CONFLICT',
        `Stored metadata size (${String(rawMeta.size)}) does not match receipt.byteSize (${receipt.byteSize}).`,
        receipt.receiptId
      );
    }

    // 6. Validate custom ownership metadata
    const customMeta = rawMeta.metadata;
    if (!isPlainRecord(customMeta)) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        'STORED_OWNERSHIP_METADATA_MISMATCH',
        'Stored GCS object is missing required server ownership custom metadata.',
        receipt.receiptId
      );
    }

    const unexpectedCustomKey = findUnexpectedPropertyOrSymbol(
      customMeta,
      ALLOWED_CUSTOM_METADATA_KEYS
    );
    if (unexpectedCustomKey !== null) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        'STORED_OWNERSHIP_METADATA_MISMATCH',
        `Stored GCS custom metadata contains unexpected key "${unexpectedCustomKey}".`,
        receipt.receiptId
      );
    }

    const metaReceiptId = customMeta.receiptId;
    const metaUploaderUid = customMeta.uploaderUid;
    const metaSha256 = customMeta.sha256;
    const metaFormat = customMeta.format;
    const metaQuarantineState = customMeta.quarantineState;

    if (
      !isValidLibraryQuarantineReceiptId(metaReceiptId) ||
      !isValidUploaderUid(metaUploaderUid) ||
      typeof metaSha256 !== 'string' ||
      !SHA256_HEX_REGEX.test(metaSha256) ||
      metaReceiptId !== receipt.receiptId ||
      metaUploaderUid !== receipt.uploaderUid ||
      metaSha256 !== receipt.sha256 ||
      metaFormat !== receipt.format ||
      metaQuarantineState !== LIBRARY_QUARANTINE_METADATA_STATE_VALUE
    ) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        createdNewObject
          ? 'STORED_OWNERSHIP_METADATA_MISMATCH'
          : 'EXISTING_OBJECT_CONFLICT',
        'Stored GCS custom ownership metadata does not match receipt identity, owner, format, or SHA-256.',
        receipt.receiptId
      );
    }

    // 7. Acquire generation-scoped file handle and stream actual stored bytes ONLY from that pinned handle
    let pinnedFile: GcsLibraryQuarantineFile;
    try {
      pinnedFile = this.getValidatedGenerationPinnedFileHandle(
        receipt.storagePath,
        verifiedGeneration,
        file
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to create generation-pinned GCS file handle.';
      return makeNeedsReconciliationFailure(
        'READBACK_INTERRUPTED_AFTER_WRITE',
        `GCS generation-pinned readback initialization failed for receipt "${receipt.receiptId}": ${msg}`,
        receipt.receiptId,
        `GCS generation-pinned readback handle initialization failed: ${msg}`
      );
    }

    const maxBudgetBytes = Math.min(
      MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
      receipt.byteSize
    );
    const hasher = createHash('sha256');
    let totalBytesRead = 0;
    let stream: GcsLibraryQuarantineReadableStream | null = null;

    try {
      stream = pinnedFile.createReadStream({ validation: false });
      if (
        !stream ||
        typeof (stream as AsyncIterable<Uint8Array | Buffer>)[
          Symbol.asyncIterator
        ] !== 'function'
      ) {
        return makeNeedsReconciliationFailure(
          'READBACK_INTERRUPTED_AFTER_WRITE',
          'GCS generation-pinned createReadStream did not return a valid async iterable stream.',
          receipt.receiptId,
          'GCS generation-pinned readback stream initialization failed.'
        );
      }

      for await (const rawChunk of stream) {
        const chunkSlice = extractExactByteSlice(rawChunk);
        if (chunkSlice === null) {
          stream.destroy?.();
          return makeNeedsReconciliationFailure(
            'READBACK_INTERRUPTED_AFTER_WRITE',
            'GCS readback stream emitted a non-binary chunk.',
            receipt.receiptId,
            'GCS readback stream emitted an invalid chunk type.'
          );
        }

        totalBytesRead += chunkSlice.byteLength;
        if (
          totalBytesRead > maxBudgetBytes ||
          totalBytesRead > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
        ) {
          // Early abort before accumulating excess bytes
          stream.destroy?.();
          return makeDeterministicFailure(
            'CONFLICT_OR_MISMATCH',
            'STORED_BYTE_SIZE_EXCEEDED_OR_MISMATCH',
            `Stored object byte stream exceeded bounded limit (${maxBudgetBytes} bytes); aborted early at ${totalBytesRead} bytes.`,
            receipt.receiptId
          );
        }

        hasher.update(chunkSlice);
      }
    } catch (err) {
      stream?.destroy?.();
      const msg =
        err instanceof Error
          ? err.message
          : 'Unknown GCS stream readback error.';
      return makeNeedsReconciliationFailure(
        'READBACK_INTERRUPTED_AFTER_WRITE',
        `GCS bounded generation-pinned stream readback was interrupted for receipt "${receipt.receiptId}": ${msg}`,
        receipt.receiptId,
        `GCS bounded generation-pinned stream readback interrupted: ${msg}`
      );
    }

    if (pinnedFile.generation !== undefined) {
      const postStreamPinnedGen = parseCanonicalSafeGcsGeneration(
        pinnedFile.generation
      );
      if (postStreamPinnedGen !== verifiedGeneration) {
        return makeNeedsReconciliationFailure(
          'READBACK_INTERRUPTED_AFTER_WRITE',
          'GCS generation-pinned file handle generation changed unexpectedly during readback.',
          receipt.receiptId,
          'GCS generation-pinned readback detected unexpected generation drift.'
        );
      }
    }

    if (totalBytesRead !== receipt.byteSize) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        createdNewObject
          ? 'STORED_BYTE_SIZE_EXCEEDED_OR_MISMATCH'
          : 'EXISTING_OBJECT_CONFLICT',
        `Actual streamed byte count (${totalBytesRead}) does not match receipt.byteSize (${receipt.byteSize}).`,
        receipt.receiptId
      );
    }

    const actualStoredSha256 = hasher.digest('hex').toLowerCase();
    if (actualStoredSha256 !== receipt.sha256) {
      return makeDeterministicFailure(
        'CONFLICT_OR_MISMATCH',
        createdNewObject ? 'STORED_SHA256_MISMATCH' : 'EXISTING_OBJECT_CONFLICT',
        'Actual stored-byte SHA-256 digest does not match receipt.sha256.',
        receipt.receiptId
      );
    }

    const attestation: TrustedStorageReadbackAttestation = Object.freeze({
      attestedReceiptId: receipt.receiptId,
      attestedUploaderUid: receipt.uploaderUid,
      attestedStoragePath: receipt.storagePath,
      attestedFormat: receipt.format,
      attestedContentType: rawMeta.contentType,
      attestedByteSize: totalBytesRead,
      attestedSha256: actualStoredSha256,
      attestedGeneration: verifiedGeneration,
      verifiedAtIso,
    });

    return makeVerifiedSuccess(
      createdNewObject ? 'WRITTEN_AND_VERIFIED' : 'EXISTING_VERIFIED',
      createdNewObject,
      receipt.receiptId,
      attestation
    );
  }
}
