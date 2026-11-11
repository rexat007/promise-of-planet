import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  LIBRARY_QUARANTINE_CACHE_CONTROL,
  LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
  LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
  parseCanonicalSafeGcsGeneration,
  type GcsLibraryQuarantineObjectMetadata,
} from './gcsLibraryQuarantineStorageAdapter';
import {
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
} from './libraryQuarantineUploadEndpoint';
import { MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES } from './libraryUploadBinaryAdmission';
import {
  deriveLibraryQuarantineStoragePath,
  isValidIsoUtcTimestamp,
  type LibraryQuarantineInternalReceipt,
} from './libraryQuarantineReceiptContract';
import type { LibraryQuarantineReviewDraftFirestoreDatabase } from './firestoreLibraryQuarantineReviewDraftStore';
import {
  isValidSafeEngineToken,
  isValidWorkerRunId,
  parseLibraryQuarantineIsolatedInspectionRequestId,
  type LibraryQuarantineAvExecutionFailureReasonCode,
  type LibraryQuarantinePersistedAvExecution,
} from './libraryQuarantineAvExecutionContract';
import { LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR } from './libraryQuarantineAvJobInvoker';
import {
  FirestoreLibraryQuarantineAvExecutionStore,
} from './libraryQuarantineAvExecutionService';

export const DEFAULT_CLAMAV_DB_DIR = '/var/lib/clamav' as const;
export const DEFAULT_CLAMAV_SIGNATURE_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000; // 7 days
export const DEFAULT_QUARANTINE_STREAM_TIMEOUT_MS = 60_000;
export const DEFAULT_CLAMSCAN_TIMEOUT_MS = 120_000;

export interface GenerationPinnedQuarantineFile {
  exists(): Promise<readonly [boolean]>;
  getMetadata(): Promise<readonly [GcsLibraryQuarantineObjectMetadata]>;
  createReadStream(options?: {
    readonly validation?: boolean;
  }): NodeJS.ReadableStream;
}

export interface GenerationPinnedQuarantineBucket {
  readonly name: string;
  file(
    objectPath: string,
    options?: { readonly generation?: string | number }
  ): GenerationPinnedQuarantineFile;
}

export interface ClamAvSignatureVerificationSuccess {
  readonly ok: true;
  readonly engineVersion: string;
  readonly signatureVersion: string;
  readonly signatureUpdatedAt: string;
}

export interface ClamAvSignatureVerificationFailure {
  readonly ok: false;
  readonly failureReasonCode:
    | 'CLAMAV_BINARY_MISSING'
    | 'SIGNATURE_DB_MISSING'
    | 'SIGNATURE_DB_STALE';
  readonly errorMessage: string;
}

export type ClamAvSignatureVerificationResult =
  | ClamAvSignatureVerificationSuccess
  | ClamAvSignatureVerificationFailure;

export interface ClamAvSubprocessRunResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
}

export type ClamAvSubprocessRunner = (params: {
  readonly tempFilePath: string;
  readonly timeoutMs: number;
}) => Promise<ClamAvSubprocessRunResult>;

export type ClamAvSignatureVerifier = (params: {
  readonly nowIso: string;
  readonly maxSignatureAgeMs: number;
}) => Promise<ClamAvSignatureVerificationResult>;

export interface QuarantineAvWorkerOptions {
  readonly requestId?: string;
  readonly workerRunId?: string;
  readonly avExecutionStore?: FirestoreLibraryQuarantineAvExecutionStore;
  readonly db?: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly bucket?: GenerationPinnedQuarantineBucket;
  readonly signatureVerifier?: ClamAvSignatureVerifier;
  readonly clamAvRunner?: ClamAvSubprocessRunner;
  readonly clock?: () => string;
  readonly streamTimeoutMs?: number;
  readonly scanTimeoutMs?: number;
  readonly maxSignatureAgeMs?: number;
  readonly tempRootDir?: string;
  readonly onTempFileCreated?: (tempFilePath: string) => void;
}

export interface QuarantineAvWorkerExecutionResult {
  readonly ok: boolean;
  readonly status:
    | 'COMPLETED_CLEAN'
    | 'COMPLETED_THREAT'
    | 'FAILED_CLOSED'
    | 'SKIPPED_ALREADY_RUNNING'
    | 'SKIPPED_ALREADY_TERMINAL'
    | 'STALE_HOLD'
    | 'HOLD';
  readonly requestId: string | null;
  readonly execution: LibraryQuarantinePersistedAvExecution | null;
  readonly failureReasonCode: LibraryQuarantineAvExecutionFailureReasonCode | null;
  readonly tempCleanedUp: boolean;
}

function hasPublicDownloadTokenMetadata(
  customMeta: Readonly<Record<string, unknown>> | undefined
): boolean {
  if (!customMeta || typeof customMeta !== 'object') {
    return false;
  }
  for (const key of Object.keys(customMeta)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('downloadtoken') ||
      lower.includes('firebasestoragedownloadtokens') ||
      lower.includes('public') ||
      lower.includes('signedurl')
    ) {
      return true;
    }
  }
  return false;
}

export function verifyGenerationPinnedQuarantineObjectMetadata(
  receipt: LibraryQuarantineInternalReceipt,
  rawMeta: unknown
):
  | { readonly ok: true; readonly generation: string }
  | {
      readonly ok: false;
      readonly failureReasonCode: 'QUARANTINE_OBJECT_METADATA_MISMATCH';
      readonly errorMessage: string;
    } {
  if (typeof rawMeta !== 'object' || rawMeta === null || Array.isArray(rawMeta)) {
    return {
      ok: false,
      failureReasonCode: 'QUARANTINE_OBJECT_METADATA_MISMATCH',
      errorMessage: 'Quarantine object metadata is missing or not an object.',
    };
  }

  const meta = rawMeta as GcsLibraryQuarantineObjectMetadata & {
    readonly acl?: unknown;
  };
  const canonicalGen = parseCanonicalSafeGcsGeneration(meta.generation);
  if (canonicalGen === null || canonicalGen !== receipt.generation) {
    return {
      ok: false,
      failureReasonCode: 'QUARANTINE_OBJECT_METADATA_MISMATCH',
      errorMessage:
        'Quarantine object generation does not match authoritative receipt.generation.',
    };
  }

  const rawSize =
    typeof meta.size === 'number'
      ? meta.size
      : typeof meta.size === 'string' && /^[1-9][0-9]{0,14}$/.test(meta.size)
      ? Number(meta.size)
      : NaN;
  if (
    !Number.isSafeInteger(rawSize) ||
    rawSize !== receipt.byteSize ||
    rawSize < 1 ||
    rawSize > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
  ) {
    return {
      ok: false,
      failureReasonCode: 'QUARANTINE_OBJECT_METADATA_MISMATCH',
      errorMessage:
        'Quarantine object byte size does not match authoritative receipt.byteSize.',
    };
  }

  if (meta.contentType !== receipt.canonicalMimeType) {
    return {
      ok: false,
      failureReasonCode: 'QUARANTINE_OBJECT_METADATA_MISMATCH',
      errorMessage:
        'Quarantine object contentType does not match authoritative receipt.canonicalMimeType.',
    };
  }

  if (
    meta.cacheControl !== LIBRARY_QUARANTINE_CACHE_CONTROL ||
    meta.contentDisposition !== LIBRARY_QUARANTINE_CONTENT_DISPOSITION
  ) {
    return {
      ok: false,
      failureReasonCode: 'QUARANTINE_OBJECT_METADATA_MISMATCH',
      errorMessage:
        'Quarantine object cacheControl or contentDisposition violated private attachment invariants.',
    };
  }

  const customMeta = meta.metadata as
    | Readonly<Record<string, unknown>>
    | undefined;
  if (
    !customMeta ||
    customMeta.quarantineState !== LIBRARY_QUARANTINE_METADATA_STATE_VALUE ||
    hasPublicDownloadTokenMetadata(customMeta) ||
    Array.isArray(meta.acl)
  ) {
    return {
      ok: false,
      failureReasonCode: 'QUARANTINE_OBJECT_METADATA_MISMATCH',
      errorMessage:
        'Quarantine object custom metadata or ACL violated private quarantine posture.',
    };
  }

  return {
    ok: true,
    generation: canonicalGen,
  };
}

export async function defaultVerifyClamAvEngineAndSignatures(params: {
  readonly nowIso: string;
  readonly maxSignatureAgeMs: number;
  readonly dbDir?: string;
  readonly clamscanBinary?: string;
}): Promise<ClamAvSignatureVerificationResult> {
  const dbDir =
    params.dbDir ?? process.env.POP_CLAMAV_DB_DIR ?? DEFAULT_CLAMAV_DB_DIR;
  const clamscanBin =
    params.clamscanBinary ?? process.env.POP_CLAMSCAN_PATH ?? 'clamscan';

  // 1. Verify signature DB files exist and are non-empty + fresh within TTL
  const mainCandidates = ['main.cvd', 'main.cld'];
  const dailyCandidates = ['daily.cvd', 'daily.cld'];

  let mainStat: fs.Stats | null = null;
  for (const name of mainCandidates) {
    try {
      const st = await fs.promises.stat(path.join(dbDir, name));
      if (st.isFile() && st.size > 0) {
        mainStat = st;
        break;
      }
    } catch {
      // continue
    }
  }

  let dailyStat: fs.Stats | null = null;
  for (const name of dailyCandidates) {
    try {
      const st = await fs.promises.stat(path.join(dbDir, name));
      if (st.isFile() && st.size > 0) {
        dailyStat = st;
        break;
      }
    } catch {
      // continue
    }
  }

  if (!mainStat || !dailyStat) {
    return {
      ok: false,
      failureReasonCode: 'SIGNATURE_DB_MISSING',
      errorMessage:
        'ClamAV signature database files (main.cvd/cld and daily.cvd/cld) are missing or empty.',
    };
  }

  const latestSignatureMs = Math.max(mainStat.mtimeMs, dailyStat.mtimeMs);
  const nowMs = Date.parse(params.nowIso);
  if (
    !Number.isFinite(latestSignatureMs) ||
    nowMs - latestSignatureMs > params.maxSignatureAgeMs
  ) {
    return {
      ok: false,
      failureReasonCode: 'SIGNATURE_DB_STALE',
      errorMessage:
        'ClamAV signature database age exceeded maximum allowed freshness TTL.',
    };
  }

  const signatureUpdatedAt = new Date(latestSignatureMs).toISOString();

  // 2. Query `clamscan --version` to verify binary presence and extract engine/signature version
  return new Promise<ClamAvSignatureVerificationResult>((resolve) => {
    let stdout = '';
    let settled = false;

    const child = spawn(clamscanBin, ['--version', `--database=${dbDir}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({
          ok: false,
          failureReasonCode: 'CLAMAV_BINARY_MISSING',
          errorMessage: 'clamscan --version timed out.',
        });
      }
    }, 10_000);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 512) {
        stdout += chunk.toString('utf8');
      }
    });

    child.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          failureReasonCode: 'CLAMAV_BINARY_MISSING',
          errorMessage: 'Failed to spawn clamscan executable.',
        });
      }
    });

    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false,
          failureReasonCode: 'CLAMAV_BINARY_MISSING',
          errorMessage: `clamscan --version exited with code ${String(code)}.`,
        });
        return;
      }

      // Typical output: "ClamAV 1.0.7/27455/Mon Nov 11 08:15:22 2026"
      const match = /ClamAV\s+([0-9A-Za-z._+-]+)(?:\/([0-9A-Za-z._+-]+))?/i.exec(
        stdout.trim()
      );
      const rawEngineVer = match?.[1] ?? '1.0.0';
      const rawSigVer = match?.[2] ?? 'daily';

      const engineVersion = isValidSafeEngineToken(rawEngineVer)
        ? rawEngineVer
        : '1.0.0';
      const signatureVersion = isValidSafeEngineToken(rawSigVer)
        ? rawSigVer
        : 'daily';

      resolve({
        ok: true,
        engineVersion,
        signatureVersion,
        signatureUpdatedAt,
      });
    });
  });
}

export async function defaultRunClamScanSubprocess(params: {
  readonly tempFilePath: string;
  readonly timeoutMs: number;
  readonly dbDir?: string;
  readonly clamscanBinary?: string;
}): Promise<ClamAvSubprocessRunResult> {
  const dbDir =
    params.dbDir ?? process.env.POP_CLAMAV_DB_DIR ?? DEFAULT_CLAMAV_DB_DIR;
  const clamscanBin =
    params.clamscanBinary ?? process.env.POP_CLAMSCAN_PATH ?? 'clamscan';

  const args = [
    '--stdout',
    '--no-summary',
    `--database=${dbDir}`,
    '--max-filesize=15M',
    '--max-scansize=30M',
    '--max-recursion=10',
    '--max-files=500',
    params.tempFilePath,
  ];

  return new Promise<ClamAvSubprocessRunResult>((resolve) => {
    let settled = false;
    let timedOut = false;

    const child = spawn(clamscanBin, args, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill('SIGKILL');
      }
    }, params.timeoutMs);

    child.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: null,
          timedOut: false,
          spawnFailed: true,
        });
      }
    });

    child.on('close', (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: typeof code === 'number' ? code : null,
          timedOut,
          spawnFailed: false,
        });
      }
    });
  });
}

async function streamGenerationPinnedObjectToTempFile(params: {
  readonly fileHandle: GenerationPinnedQuarantineFile;
  readonly destFilePath: string;
  readonly expectedByteSize: number;
  readonly expectedSha256: string;
  readonly timeoutMs: number;
}): Promise<
  | {
      readonly ok: true;
      readonly streamedBytes: number;
      readonly computedSha256: string;
    }
  | {
      readonly ok: false;
      readonly failureReasonCode:
        | 'QUARANTINE_STREAM_TIMEOUT'
        | 'QUARANTINE_BYTE_SIZE_MISMATCH'
        | 'QUARANTINE_SHA256_MISMATCH'
        | 'QUARANTINE_OBJECT_MISSING';
    }
> {
  return new Promise((resolve) => {
    let settled = false;
    let streamedBytes = 0;
    const hash = createHash('sha256');

    const readStream = params.fileHandle.createReadStream({
      validation: false,
    });
    const writeStream = fs.createWriteStream(params.destFilePath, {
      flags: 'wx',
      mode: 0o600,
    });

    const finishWithFailure = (
      reasonCode:
        | 'QUARANTINE_STREAM_TIMEOUT'
        | 'QUARANTINE_BYTE_SIZE_MISMATCH'
        | 'QUARANTINE_SHA256_MISMATCH'
        | 'QUARANTINE_OBJECT_MISSING'
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        if (
          typeof (readStream as unknown as { destroy?: () => void }).destroy ===
          'function'
        ) {
          (readStream as unknown as { destroy: () => void }).destroy();
        }
      } catch {
        // ignore
      }
      try {
        writeStream.destroy();
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        failureReasonCode: reasonCode,
      });
    };

    const timer = setTimeout(() => {
      finishWithFailure('QUARANTINE_STREAM_TIMEOUT');
    }, params.timeoutMs);

    readStream.on('data', (chunk: Buffer | string) => {
      if (settled) {
        return;
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      streamedBytes += buf.length;
      if (
        streamedBytes > params.expectedByteSize ||
        streamedBytes > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
      ) {
        finishWithFailure('QUARANTINE_BYTE_SIZE_MISMATCH');
        return;
      }
      hash.update(buf);
    });

    readStream.on('error', () => {
      finishWithFailure('QUARANTINE_OBJECT_MISSING');
    });

    writeStream.on('error', () => {
      finishWithFailure('QUARANTINE_OBJECT_MISSING');
    });

    writeStream.on('finish', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (streamedBytes !== params.expectedByteSize) {
        resolve({
          ok: false,
          failureReasonCode: 'QUARANTINE_BYTE_SIZE_MISMATCH',
        });
        return;
      }

      const computedSha256 = hash.digest('hex').toLowerCase();
      if (computedSha256 !== params.expectedSha256) {
        resolve({
          ok: false,
          failureReasonCode: 'QUARANTINE_SHA256_MISMATCH',
        });
        return;
      }

      resolve({
        ok: true,
        streamedBytes,
        computedSha256,
      });
    });

    readStream.pipe(writeStream);
  });
}

export async function executeLibraryQuarantineAvWorkerTask(
  options: QuarantineAvWorkerOptions = {}
): Promise<QuarantineAvWorkerExecutionResult> {
  const rawRequestId =
    options.requestId ??
    process.env[LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR] ??
    '';
  const parsedId = parseLibraryQuarantineIsolatedInspectionRequestId(
    rawRequestId
  );
  if (!parsedId) {
    return Object.freeze({
      ok: false,
      status: 'HOLD',
      requestId: null,
      execution: null,
      failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID',
      tempCleanedUp: true,
    });
  }

  const clock = options.clock ?? (() => new Date().toISOString());
  const nowIso = clock();
  if (!isValidIsoUtcTimestamp(nowIso)) {
    return Object.freeze({
      ok: false,
      status: 'HOLD',
      requestId: parsedId.requestId,
      execution: null,
      failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID',
      tempCleanedUp: true,
    });
  }

  const rawWorkerRunId =
    options.workerRunId ??
    process.env.CLOUD_RUN_EXECUTION ??
    `av-worker-${Date.parse(nowIso)}`;
  const workerRunId = isValidWorkerRunId(rawWorkerRunId)
    ? rawWorkerRunId
    : `av-worker-${Date.parse(nowIso)}`;

  let avStore = options.avExecutionStore;
  if (!avStore) {
    if (options.db) {
      avStore = new FirestoreLibraryQuarantineAvExecutionStore(options.db);
    } else {
      if (!ensureQuarantineAvWorkerFirebaseAppInitialized()) {
        return Object.freeze({
          ok: false,
          status: 'HOLD',
          requestId: parsedId.requestId,
          execution: null,
          failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID',
          tempCleanedUp: true,
        });
      }
      let firestoreDb: LibraryQuarantineReviewDraftFirestoreDatabase;
      try {
        firestoreDb =
          getFirestore() as unknown as LibraryQuarantineReviewDraftFirestoreDatabase;
      } catch {
        return Object.freeze({
          ok: false,
          status: 'HOLD',
          requestId: parsedId.requestId,
          execution: null,
          failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID',
          tempCleanedUp: true,
        });
      }
      avStore = new FirestoreLibraryQuarantineAvExecutionStore(firestoreDb);
    }
  }

  // Step 1: Claim execution in Firestore (`RUNNING`) via CAS
  const claimResult = await avStore.claimAvExecutionForWorkerTransactional({
    requestId: parsedId.requestId,
    workerRunId,
    nowIso,
  });

  if (claimResult.status === 'ALREADY_RUNNING') {
    return Object.freeze({
      ok: false,
      status: 'SKIPPED_ALREADY_RUNNING',
      requestId: parsedId.requestId,
      execution: claimResult.execution,
      failureReasonCode: null,
      tempCleanedUp: true,
    });
  }

  if (claimResult.status === 'ALREADY_TERMINAL') {
    return Object.freeze({
      ok: false,
      status: 'SKIPPED_ALREADY_TERMINAL',
      requestId: parsedId.requestId,
      execution: claimResult.execution,
      failureReasonCode: claimResult.execution.failureReasonCode,
      tempCleanedUp: true,
    });
  }

  if (claimResult.status === 'STALE_HOLD') {
    return Object.freeze({
      ok: false,
      status: 'STALE_HOLD',
      requestId: parsedId.requestId,
      execution: claimResult.execution,
      failureReasonCode: claimResult.execution.failureReasonCode,
      tempCleanedUp: true,
    });
  }

  if (claimResult.status !== 'CLAIMED') {
    return Object.freeze({
      ok: false,
      status: 'HOLD',
      requestId: parsedId.requestId,
      execution: null,
      failureReasonCode: null,
      tempCleanedUp: true,
    });
  }

  const claimedExec = claimResult.execution;
  const claimedRevision = claimedExec.revision;
  const receipt =
    claimResult.eligibleChain.chainSnapshot.receiptEnvelope.receipt;
  const inspectionRequest = claimResult.inspectionRequest;

  const recordFailClosed = async (
    failureReasonCode: LibraryQuarantineAvExecutionFailureReasonCode,
    extra?: {
      readonly engineName?: 'ClamAV' | null;
      readonly engineVersion?: string | null;
      readonly signatureVersion?: string | null;
      readonly signatureUpdatedAt?: string | null;
      readonly scannedBytes?: number | null;
      readonly exitCode?: number | null;
    },
    tempCleanedUp = true
  ): Promise<QuarantineAvWorkerExecutionResult> => {
    const failAt = clock();
    const recordRes = await avStore!.recordWorkerAvScanOutcomeTransactional({
      requestId: parsedId.requestId,
      expectedRevision: claimedRevision,
      workerRunId,
      nowIso: isValidIsoUtcTimestamp(failAt) ? failAt : nowIso,
      targetState: 'AV_SCAN_FAILED',
      engineName: extra?.engineName ?? null,
      engineVersion: extra?.engineVersion ?? null,
      signatureVersion: extra?.signatureVersion ?? null,
      signatureUpdatedAt: extra?.signatureUpdatedAt ?? null,
      scannedBytes: extra?.scannedBytes ?? null,
      exitCode: extra?.exitCode ?? null,
      failureReasonCode,
    });

    return Object.freeze({
      ok: false,
      status: 'FAILED_CLOSED',
      requestId: parsedId.requestId,
      execution: recordRes.status === 'RECORDED' ? recordRes.execution : null,
      failureReasonCode,
      tempCleanedUp,
    });
  };

  // Step 2: Verify ClamAV binary & signature DB freshness BEFORE touching quarantine object bytes
  const maxSignatureAgeMs =
    options.maxSignatureAgeMs ?? DEFAULT_CLAMAV_SIGNATURE_MAX_AGE_MS;
  const signatureVerifier =
    options.signatureVerifier ?? defaultVerifyClamAvEngineAndSignatures;

  const sigCheck = await signatureVerifier({
    nowIso: clock(),
    maxSignatureAgeMs,
  });
  if (!sigCheck.ok) {
    return recordFailClosed(sigCheck.failureReasonCode);
  }

  // Step 3: Bind strictly to dedicated quarantine bucket (never default bucket)
  let bucket = options.bucket;
  if (!bucket) {
    if (!ensureQuarantineAvWorkerFirebaseAppInitialized()) {
      return recordFailClosed('QUARANTINE_BUCKET_MISMATCH', {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
      });
    }
    try {
      bucket = getStorage().bucket(
        LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
      ) as unknown as GenerationPinnedQuarantineBucket;
    } catch {
      return recordFailClosed('QUARANTINE_BUCKET_MISMATCH', {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
      });
    }
  }

  if (
    !bucket ||
    typeof bucket.name !== 'string' ||
    bucket.name === FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME ||
    bucket.name !== LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
  ) {
    return recordFailClosed('QUARANTINE_BUCKET_MISMATCH', {
      engineName: 'ClamAV',
      engineVersion: sigCheck.engineVersion,
      signatureVersion: sigCheck.signatureVersion,
      signatureUpdatedAt: sigCheck.signatureUpdatedAt,
    });
  }

  const derivedPathRes = deriveLibraryQuarantineStoragePath(
    receipt.receiptId,
    receipt.format
  );
  if (
    !derivedPathRes.ok ||
    receipt.storagePath !== derivedPathRes.parsed.storagePath
  ) {
    return recordFailClosed('QUARANTINE_OBJECT_METADATA_MISMATCH', {
      engineName: 'ClamAV',
      engineVersion: sigCheck.engineVersion,
      signatureVersion: sigCheck.signatureVersion,
      signatureUpdatedAt: sigCheck.signatureUpdatedAt,
    });
  }
  const canonicalPath = derivedPathRes.parsed.storagePath;

  const sourceGeneration = claimResult.eligibleChain.sourceGeneration;
  if (
    !sourceGeneration ||
    receipt.generation !== sourceGeneration ||
    inspectionRequest.sourceGeneration !== sourceGeneration
  ) {
    return recordFailClosed('QUARANTINE_OBJECT_METADATA_MISMATCH', {
      engineName: 'ClamAV',
      engineVersion: sigCheck.engineVersion,
      signatureVersion: sigCheck.signatureVersion,
      signatureUpdatedAt: sigCheck.signatureUpdatedAt,
    });
  }

  // Step 4: Open generation-pinned file handle & verify object metadata before streaming bytes
  const pinnedFile = bucket.file(canonicalPath, {
    generation: sourceGeneration,
  });

  let existsTuple: readonly [boolean];
  try {
    existsTuple = await pinnedFile.exists();
  } catch {
    return recordFailClosed('QUARANTINE_OBJECT_MISSING', {
      engineName: 'ClamAV',
      engineVersion: sigCheck.engineVersion,
      signatureVersion: sigCheck.signatureVersion,
      signatureUpdatedAt: sigCheck.signatureUpdatedAt,
    });
  }

  if (!existsTuple || existsTuple[0] !== true) {
    return recordFailClosed('QUARANTINE_OBJECT_MISSING', {
      engineName: 'ClamAV',
      engineVersion: sigCheck.engineVersion,
      signatureVersion: sigCheck.signatureVersion,
      signatureUpdatedAt: sigCheck.signatureUpdatedAt,
    });
  }

  let metadataTuple: readonly [GcsLibraryQuarantineObjectMetadata];
  try {
    metadataTuple = await pinnedFile.getMetadata();
  } catch {
    return recordFailClosed('QUARANTINE_OBJECT_METADATA_MISMATCH', {
      engineName: 'ClamAV',
      engineVersion: sigCheck.engineVersion,
      signatureVersion: sigCheck.signatureVersion,
      signatureUpdatedAt: sigCheck.signatureUpdatedAt,
    });
  }

  const metaCheck = verifyGenerationPinnedQuarantineObjectMetadata(
    receipt,
    metadataTuple?.[0]
  );
  if (!metaCheck.ok) {
    return recordFailClosed(metaCheck.failureReasonCode, {
      engineName: 'ClamAV',
      engineVersion: sigCheck.engineVersion,
      signatureVersion: sigCheck.signatureVersion,
      signatureUpdatedAt: sigCheck.signatureUpdatedAt,
    });
  }

  // Step 5: Create restricted temporary workspace, stream bounded bytes, and verify SHA-256
  let tempDir: string | null = null;
  let tempCleanedUp = false;

  try {
    const baseTmp = options.tempRootDir ?? os.tmpdir();
    try {
      tempDir = await fs.promises.mkdtemp(path.join(baseTmp, 'pop-qav-'));
      await fs.promises.chmod(tempDir, 0o700);
    } catch {
      return recordFailClosed('TEMP_WORKSPACE_INIT_FAILED', {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
      });
    }

    const safeFileName =
      receipt.format === 'PDF' ? 'input.pdf' : 'input.docx';
    const tempFilePath = path.join(tempDir, safeFileName);

    const streamTimeoutMs =
      options.streamTimeoutMs ?? DEFAULT_QUARANTINE_STREAM_TIMEOUT_MS;

    const streamRes = await streamGenerationPinnedObjectToTempFile({
      fileHandle: pinnedFile,
      destFilePath: tempFilePath,
      expectedByteSize: receipt.byteSize,
      expectedSha256: receipt.sha256,
      timeoutMs: streamTimeoutMs,
    });

    if (options.onTempFileCreated) {
      options.onTempFileCreated(tempFilePath);
    }

    if (!streamRes.ok) {
      return await recordFailClosed(streamRes.failureReasonCode, {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
      });
    }

    if (
      streamRes.computedSha256 !== inspectionRequest.sourceSha256 ||
      streamRes.streamedBytes !== inspectionRequest.sourceByteSize
    ) {
      return await recordFailClosed('QUARANTINE_SHA256_MISMATCH', {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
        scannedBytes: streamRes.streamedBytes,
      });
    }

    // Step 6: Execute ClamAV scan on the isolated temp file
    const scanTimeoutMs = options.scanTimeoutMs ?? DEFAULT_CLAMSCAN_TIMEOUT_MS;
    const clamAvRunner = options.clamAvRunner ?? defaultRunClamScanSubprocess;

    const scanRes = await clamAvRunner({
      tempFilePath,
      timeoutMs: scanTimeoutMs,
    });

    if (scanRes.spawnFailed) {
      return await recordFailClosed('CLAMAV_BINARY_MISSING', {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
        scannedBytes: streamRes.streamedBytes,
      });
    }

    if (scanRes.timedOut) {
      return await recordFailClosed('SCAN_TIMEOUT', {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
        scannedBytes: streamRes.streamedBytes,
      });
    }

    if (scanRes.exitCode !== 0 && scanRes.exitCode !== 1) {
      return await recordFailClosed('SCAN_EXECUTION_ERROR', {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
        scannedBytes: streamRes.streamedBytes,
        exitCode:
          typeof scanRes.exitCode === 'number' &&
          scanRes.exitCode >= 0 &&
          scanRes.exitCode <= 255
            ? scanRes.exitCode
            : null,
      });
    }

    // Step 7: Re-verify generation on GCS right after scan before committing Firestore result
    let postScanMetaTuple: readonly [GcsLibraryQuarantineObjectMetadata];
    try {
      postScanMetaTuple = await pinnedFile.getMetadata();
    } catch {
      return await recordFailClosed('QUARANTINE_OBJECT_MISSING', {
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
        scannedBytes: streamRes.streamedBytes,
      });
    }

    const postScanMetaCheck = verifyGenerationPinnedQuarantineObjectMetadata(
      receipt,
      postScanMetaTuple?.[0]
    );
    const observedGcsGeneration = postScanMetaCheck.ok
      ? postScanMetaCheck.generation
      : 'DRIFTED';

    const targetState =
      scanRes.exitCode === 0
        ? ('AV_NO_THREAT_DETECTED' as const)
        : ('AV_THREAT_DETECTED' as const);

    const completeAt = clock();
    const recordOutcomeRes =
      await avStore.recordWorkerAvScanOutcomeTransactional({
        requestId: parsedId.requestId,
        expectedRevision: claimedRevision,
        workerRunId,
        nowIso: isValidIsoUtcTimestamp(completeAt) ? completeAt : nowIso,
        targetState,
        engineName: 'ClamAV',
        engineVersion: sigCheck.engineVersion,
        signatureVersion: sigCheck.signatureVersion,
        signatureUpdatedAt: sigCheck.signatureUpdatedAt,
        scannedBytes: streamRes.streamedBytes,
        exitCode: scanRes.exitCode,
        failureReasonCode: null,
        observedGcsGeneration,
        observedSha256: streamRes.computedSha256,
        observedByteSize: streamRes.streamedBytes,
      });

    if (recordOutcomeRes.status !== 'RECORDED') {
      return Object.freeze({
        ok: false,
        status: 'HOLD',
        requestId: parsedId.requestId,
        execution: null,
        failureReasonCode: null,
        tempCleanedUp: true,
      });
    }

    const finalExec = recordOutcomeRes.execution;
    if (finalExec.state === 'STALE_HOLD') {
      return Object.freeze({
        ok: false,
        status: 'STALE_HOLD',
        requestId: parsedId.requestId,
        execution: finalExec,
        failureReasonCode: finalExec.failureReasonCode,
        tempCleanedUp: true,
      });
    }

    return Object.freeze({
      ok: true,
      status:
        finalExec.state === 'AV_NO_THREAT_DETECTED'
          ? 'COMPLETED_CLEAN'
          : 'COMPLETED_THREAT',
      requestId: parsedId.requestId,
      execution: finalExec,
      failureReasonCode: null,
      tempCleanedUp: true,
    });
  } finally {
    if (tempDir !== null) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        tempCleanedUp = true;
      } catch {
        tempCleanedUp = false;
      }
    }
    void tempCleanedUp;
  }
}

export function ensureQuarantineAvWorkerFirebaseAppInitialized(): boolean {
  try {
    const existingApps = getApps();
    if (!Array.isArray(existingApps)) {
      return false;
    }
    if (existingApps.length === 0) {
      initializeApp();
    }
    return true;
  } catch {
    return false;
  }
}

export interface QuarantineAvWorkerCliOptions {
  readonly workerOptions?: QuarantineAvWorkerOptions;
  readonly exit?: (code: number) => void;
}

export async function runLibraryQuarantineAvWorkerCli(
  cliOptions: QuarantineAvWorkerCliOptions = {}
): Promise<number> {
  const exitFn = cliOptions.exit ?? ((code: number) => process.exit(code));
  if (!ensureQuarantineAvWorkerFirebaseAppInitialized()) {
    exitFn(1);
    return 1;
  }

  try {
    const result = await executeLibraryQuarantineAvWorkerTask(
      cliOptions.workerOptions
    );
    const exitCode =
      result.status === 'COMPLETED_CLEAN' ||
      result.status === 'COMPLETED_THREAT' ||
      result.status === 'SKIPPED_ALREADY_TERMINAL'
        ? 0
        : 1;
    exitFn(exitCode);
    return exitCode;
  } catch {
    exitFn(1);
    return 1;
  }
}

if (require.main === module) {
  void runLibraryQuarantineAvWorkerCli();
}
