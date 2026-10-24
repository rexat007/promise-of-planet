import { validateAssetId } from './editorialImageAssetContract';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetValidationLimits,
} from '../types/editorialImageAsset';
import { NewsAdminClient } from './newsAdminClient';
import {
  createOwnedPreviewUrlRegistry,
  isSafeRuntimePreviewUrl,
  validateCanonicalEditorialImageAttrs,
  type OwnedPreviewUrlRegistry,
} from '../components/news/editor/editorialImageExtension';

/**
 * IMG-F3-09/D2-E3-B2 — Authenticated Private Editorial Image Preview Service
 *
 * Provides strictly bounded, read-only client retrieval of private editorial image
 * previews (`variant=card`, `image/webp`) for authorized human administrators when
 * reopening saved news drafts.
 *
 * Security & Lifecycle Invariants:
 * - Requires explicitly configured `VITE_EDITORIAL_IMAGE_PREVIEW_URL` (HTTPS in production,
 *   or localhost HTTP in local development). Never guesses or constructs Cloud Functions URLs.
 * - Authenticates via `Authorization: Bearer <Firebase ID Token>` using
 *   `NewsAdminClient.getRefreshedAdminIdToken()`. Never puts tokens or credentials in URLs.
 * - Validates canonical `assetId` before any network request.
 * - Sends `GET ?assetId=<assetId>&variant=card` with `AbortSignal`.
 * - Rejects non-200 responses, non-`image/webp` MIME types, empty bodies, oversized bodies
 *   (> 15 MB), and malformed/non-WebP binary signatures.
 * - Registers created `blob:` URLs in `createOwnedPreviewUrlRegistry` and revokes them
 *   deterministically on draft switch, editor close, or unmount.
 * - Never logs tokens, binary image bytes, or private storage paths.
 */

export const MAX_EDITORIAL_IMAGE_PREVIEW_BYTES = 15_000_000 as const;
export const EDITORIAL_IMAGE_PREVIEW_VARIANT = 'card' as const;

export type EditorialImagePreviewErrorCode =
  | 'INVALID_ASSET_ID'
  | 'PREVIEW_ENDPOINT_UNCONFIGURED'
  | 'UNAUTHENTICATED'
  | 'AUTH_TOKEN_FAILURE'
  | 'FETCH_UNAVAILABLE'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR'
  | 'HTTP_STATUS_REJECTED'
  | 'INVALID_CONTENT_TYPE'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'EMPTY_RESPONSE_BODY'
  | 'MALFORMED_IMAGE_BINARY'
  | 'OBJECT_URL_CREATION_FAILED';

export type FetchEditorialImagePreviewOutcome =
  | {
      readonly ok: true;
      readonly assetId: string;
      readonly variant: typeof EDITORIAL_IMAGE_PREVIEW_VARIANT;
      readonly mimeType: 'image/webp';
      readonly byteLength: number;
      readonly bytes: Uint8Array;
      readonly blob: Blob;
    }
  | {
      readonly ok: false;
      readonly assetId: string;
      readonly errorCode: EditorialImagePreviewErrorCode;
      readonly httpStatus?: number;
    };

export interface EditorialImagePreviewRuntimeOverrides {
  readonly endpointUrl?: string | null;
  readonly getRefreshedAdminIdToken?: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly maxBytes?: number;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

let customPreviewRuntime: EditorialImagePreviewRuntimeOverrides | null = null;

function resolveEnvRecord(): Record<string, unknown> {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env as unknown as Record<string, unknown>;
  }
  if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
    return ((globalThis as { process?: { env?: Record<string, unknown> } }).process?.env) || {};
  }
  return {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const ALLOWED_WRAPPER_V2_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'doc',
  'updatedAt',
]);

const ALLOWED_DOC_V2_KEYS: ReadonlySet<string> = new Set([
  'type',
  'content',
]);

const ALLOWED_EDITORIAL_IMAGE_NODE_KEYS: ReadonlySet<string> = new Set([
  'type',
  'attrs',
]);

const RECOGNIZED_CONTAINER_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'horizontalRule',
  'editorialImage',
]);

/**
 * Validates that a candidate preview endpoint base URL is an explicitly configured
 * HTTPS URL (or `http://localhost` / `http://127.0.0.1` for local development) with
 * no query parameters, fragments, embedded credentials, or whitespace.
 * Never guesses or constructs a Cloud Functions URL from a project ID or region.
 */
export function isValidPreviewEndpointUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed !== rawUrl || /\s/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      return false;
    }
    if (parsed.protocol === 'https:') {
      return Boolean(parsed.hostname && parsed.hostname.length > 0);
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 *Builds the bounded GET request URL for a validated `assetId` and `variant=card`.
 * Guarantees no credentials or extra query parameters are included.
 */
export function buildEditorialImagePreviewRequestUrl(
  baseEndpointUrl: string,
  assetId: string,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): string | null {
  if (!isValidPreviewEndpointUrl(baseEndpointUrl)) {
    return null;
  }
  if (!isValidPersistedPreviewAssetId(assetId, limits)) {
    return null;
  }
  try {
    const url = new URL(baseEndpointUrl);
    url.search = '';
    url.hash = '';
    url.searchParams.set('assetId', assetId);
    url.searchParams.set('variant', EDITORIAL_IMAGE_PREVIEW_VARIANT);
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Strict validation for an `assetId` before any preview network call or extraction.
 */
export function isValidPersistedPreviewAssetId(
  assetId: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): assetId is string {
  if (typeof assetId !== 'string') {
    return false;
  }
  if (
    assetId.length === 0 ||
    assetId.trim() !== assetId ||
    /\s/.test(assetId) ||
    assetId.includes('/') ||
    assetId.includes('\\') ||
    assetId.includes('..') ||
    assetId.includes('%') ||
    assetId.includes(':')
  ) {
    return false;
  }
  return validateAssetId(assetId, limits).valid;
}

/**
 * Verifies that a binary payload is a non-empty, bounded, genuine WebP image
 * (`RIFF....WEBP` with a valid `VP8 `, `VP8L`, or `VP8X` chunk header).
 */
export function isValidWebpPreviewBinary(
  bytes: unknown,
  maxBytes: number = MAX_EDITORIAL_IMAGE_PREVIEW_BYTES
): bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    return false;
  }
  const effectiveMax =
    typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.min(maxBytes, MAX_EDITORIAL_IMAGE_PREVIEW_BYTES)
      : MAX_EDITORIAL_IMAGE_PREVIEW_BYTES;

  if (bytes.byteLength < 16 || bytes.byteLength > effectiveMax) {
    return false;
  }

  // 'RIFF' (0x52, 0x49, 0x46, 0x46)
  if (
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46
  ) {
    return false;
  }

  // 'WEBP' (0x57, 0x45, 0x42, 0x50)
  if (
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    return false;
  }

  // Chunk fourCC at 12..15 must be 'VP8 ', 'VP8L', or 'VP8X'
  if (bytes[12] !== 0x56 || bytes[13] !== 0x50 || bytes[14] !== 0x38) {
    return false;
  }
  const fourthChunkChar = bytes[15];
  if (
    fourthChunkChar !== 0x20 && // ' '
    fourthChunkChar !== 0x4c && // 'L'
    fourthChunkChar !== 0x58 // 'X'
  ) {
    return false;
  }

  return true;
}

/**
 * Pure function that extracts unique valid persisted `editorialImage` `assetId`s
 * from a single canonical V2 ProseMirror document wrapper in deterministic traversal order.
 *
 * - Ignores V1 documents, non-objects, and malformed or unsupported nodes.
 * - Validates every `editorialImage` node against `validateCanonicalEditorialImageAttrs`.
 * - Never mutates the input document.
 */
export function extractPersistedEditorialImageAssetIdsFromDocument(
  richDoc: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): string[] {
  if (!isPlainObject(richDoc)) {
    return [];
  }

  for (const key of Object.keys(richDoc)) {
    if (!ALLOWED_WRAPPER_V2_KEYS.has(key)) {
      return [];
    }
  }

  if (richDoc.schemaVersion !== 2) {
    return [];
  }

  const doc = richDoc.doc;
  if (!isPlainObject(doc) || doc.type !== 'doc' || !Array.isArray(doc.content)) {
    return [];
  }

  for (const key of Object.keys(doc)) {
    if (!ALLOWED_DOC_V2_KEYS.has(key)) {
      return [];
    }
  }

  const seen = new Set<string>();

  function walkBlocks(nodes: readonly unknown[], depth: number): void {
    if (depth > 16) {
      return;
    }
    for (const node of nodes) {
      if (!isPlainObject(node)) {
        continue;
      }
      const nodeType = node.type;
      if (typeof nodeType !== 'string' || !RECOGNIZED_CONTAINER_BLOCK_TYPES.has(nodeType)) {
        continue;
      }

      if (nodeType === 'editorialImage') {
        const nodeKeys = Object.keys(node);
        const hasOnlyAllowedKeys = nodeKeys.every((k) =>
          ALLOWED_EDITORIAL_IMAGE_NODE_KEYS.has(k)
        );
        if (!hasOnlyAllowedKeys) {
          continue;
        }
        const attrsValidation = validateCanonicalEditorialImageAttrs(node.attrs);
        if (
          attrsValidation.valid &&
          attrsValidation.attrs &&
          isValidPersistedPreviewAssetId(attrsValidation.attrs.assetId, limits)
        ) {
          seen.add(attrsValidation.attrs.assetId);
        }
        continue;
      }

      if (Array.isArray(node.content)) {
        walkBlocks(node.content, depth + 1);
      }
    }
  }

  walkBlocks(doc.content, 0);
  return Array.from(seen);
}

/**
 * Pure function to collect unique valid persisted `editorialImage` `assetId`s
 * from both `richBodyAr` and `richBodyEn` in deterministic order.
 *
 * - Traverses canonical V2 ProseMirror documents.
 * - Deduplicates repeated `assetId`s across both languages.
 * - Ignores unsupported or malformed nodes.
 * - Does not mutate rich documents.
 */
export function extractPersistedEditorialImageAssetIds(
  richBodyAr?: unknown,
  richBodyEn?: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): string[] {
  const uniqueIds = new Set<string>();
  for (const id of extractPersistedEditorialImageAssetIdsFromDocument(richBodyAr, limits)) {
    uniqueIds.add(id);
  }
  for (const id of extractPersistedEditorialImageAssetIdsFromDocument(richBodyEn, limits)) {
    uniqueIds.add(id);
  }
  return Array.from(uniqueIds);
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<
  | { readonly ok: true; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      readonly errorCode:
        | 'SIZE_LIMIT_EXCEEDED'
        | 'REQUEST_ABORTED'
        | 'MALFORMED_IMAGE_BINARY';
    }
> {
  const contentLengthHeader = response.headers?.get?.('content-length');
  if (contentLengthHeader !== null && contentLengthHeader !== undefined) {
    const trimmedLength = contentLengthHeader.trim();
    if (trimmedLength.length > 0) {
      const parsedLength = Number(trimmedLength);
      if (!Number.isFinite(parsedLength) || parsedLength < 0) {
        return { ok: false, errorCode: 'MALFORMED_IMAGE_BINARY' };
      }
      if (parsedLength > maxBytes) {
        return { ok: false, errorCode: 'SIZE_LIMIT_EXCEEDED' };
      }
    }
  }

  if (signal?.aborted) {
    return { ok: false, errorCode: 'REQUEST_ABORTED' };
  }

  const bodyStream = response.body;
  if (bodyStream && typeof bodyStream.getReader === 'function') {
    const reader = bodyStream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        if (signal?.aborted) {
          try {
            await reader.cancel();
          } catch {
            // Ignore cancel errors
          }
          return { ok: false, errorCode: 'REQUEST_ABORTED' };
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          const chunk =
            value instanceof Uint8Array
              ? value
              : new Uint8Array(value as ArrayBufferLike);
          totalBytes += chunk.byteLength;
          if (totalBytes > maxBytes) {
            try {
              await reader.cancel();
            } catch {
              // Ignore cancel errors
            }
            return { ok: false, errorCode: 'SIZE_LIMIT_EXCEEDED' };
          }
          chunks.push(chunk);
        }
      }
    } catch (err: unknown) {
      const isAbort =
        signal?.aborted ||
        (err instanceof Error &&
          (err.name === 'AbortError' || /abort/i.test(err.message)));
      return {
        ok: false,
        errorCode: isAbort ? 'REQUEST_ABORTED' : 'MALFORMED_IMAGE_BINARY',
      };
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Ignore releaseLock errors
      }
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, bytes: combined };
  }

  try {
    const buffer = await response.arrayBuffer();
    if (signal?.aborted) {
      return { ok: false, errorCode: 'REQUEST_ABORTED' };
    }
    if (buffer.byteLength > maxBytes) {
      return { ok: false, errorCode: 'SIZE_LIMIT_EXCEEDED' };
    }
    return { ok: true, bytes: new Uint8Array(buffer) };
  } catch (err: unknown) {
    const isAbort =
      signal?.aborted ||
      (err instanceof Error &&
        (err.name === 'AbortError' || /abort/i.test(err.message)));
    return {
      ok: false,
      errorCode: isAbort ? 'REQUEST_ABORTED' : 'MALFORMED_IMAGE_BINARY',
    };
  }
}

export class EditorialImagePreviewService {
  /**
   * Injects isolated runtime overrides for automated tests.
   */
  public static setRuntimeOverrides(
    overrides: EditorialImagePreviewRuntimeOverrides | null
  ): void {
    customPreviewRuntime = overrides;
  }

  public static clear(): void {
    customPreviewRuntime = null;
  }

  /**
   * Resolves the explicitly configured preview endpoint URL (`VITE_EDITORIAL_IMAGE_PREVIEW_URL`).
   * Never guesses or constructs a Cloud Functions URL from a project ID or region.
   */
  public static getConfiguredEndpointUrl(): string | null {
    if (customPreviewRuntime && 'endpointUrl' in customPreviewRuntime) {
      const candidate = customPreviewRuntime.endpointUrl;
      return isValidPreviewEndpointUrl(candidate) ? candidate : null;
    }

    const env = resolveEnvRecord();
    const candidate = env.VITE_EDITORIAL_IMAGE_PREVIEW_URL ?? null;
    return isValidPreviewEndpointUrl(candidate) ? candidate : null;
  }

  public static isPreviewEndpointConfigured(): boolean {
    return this.getConfiguredEndpointUrl() !== null;
  }

  /**
   * Fetches and validates a private editorial image preview (`variant=card`, `image/webp`)
   * for a single canonical `assetId`.
   */
  public static async fetchPreviewImage(options: {
    readonly assetId: string;
    readonly signal?: AbortSignal;
    readonly limits?: EditorialImageAssetValidationLimits;
  }): Promise<FetchEditorialImagePreviewOutcome> {
    const rawAssetId = options?.assetId;
    const limits = options?.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;

    if (!isValidPersistedPreviewAssetId(rawAssetId, limits)) {
      return {
        ok: false,
        assetId: typeof rawAssetId === 'string' ? rawAssetId : '',
        errorCode: 'INVALID_ASSET_ID',
      };
    }

    if (options.signal?.aborted) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'REQUEST_ABORTED',
      };
    }

    const endpointUrl = this.getConfiguredEndpointUrl();
    if (!endpointUrl) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'PREVIEW_ENDPOINT_UNCONFIGURED',
      };
    }

    const requestUrl = buildEditorialImagePreviewRequestUrl(
      endpointUrl,
      rawAssetId,
      limits
    );
    if (!requestUrl) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'PREVIEW_ENDPOINT_UNCONFIGURED',
      };
    }

    const tokenResolver =
      customPreviewRuntime?.getRefreshedAdminIdToken ??
      (() => NewsAdminClient.getRefreshedAdminIdToken());

    let bearerToken: string;
    try {
      bearerToken = await tokenResolver();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      const isUnauth = /UNAUTHENTICATED/i.test(msg);
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: isUnauth ? 'UNAUTHENTICATED' : 'AUTH_TOKEN_FAILURE',
      };
    }

    if (
      typeof bearerToken !== 'string' ||
      bearerToken.trim().length === 0 ||
      bearerToken !== bearerToken.trim() ||
      /\s/.test(bearerToken)
    ) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'AUTH_TOKEN_FAILURE',
      };
    }

    if (options.signal?.aborted) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'REQUEST_ABORTED',
      };
    }

    const fetchFn = customPreviewRuntime?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'FETCH_UNAVAILABLE',
      };
    }

    let response: Response;
    try {
      response = await fetchFn(requestUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'image/webp',
        },
        signal: options.signal,
      });
    } catch (err: unknown) {
      const isAbort =
        options.signal?.aborted ||
        (err instanceof Error &&
          (err.name === 'AbortError' || /abort/i.test(err.message)));
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: isAbort ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
      };
    }

    if (options.signal?.aborted) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'REQUEST_ABORTED',
      };
    }

    if (response.status !== 200) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'HTTP_STATUS_REJECTED',
        httpStatus: response.status,
      };
    }

    const rawContentType = response.headers?.get?.('content-type') ?? '';
    const mediaType = rawContentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (mediaType !== 'image/webp') {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'INVALID_CONTENT_TYPE',
        httpStatus: response.status,
      };
    }

    const maxBytes =
      customPreviewRuntime?.maxBytes &&
      Number.isFinite(customPreviewRuntime.maxBytes) &&
      customPreviewRuntime.maxBytes > 0
        ? Math.min(customPreviewRuntime.maxBytes, MAX_EDITORIAL_IMAGE_PREVIEW_BYTES)
        : MAX_EDITORIAL_IMAGE_PREVIEW_BYTES;

    const bodyRead = await readBoundedResponseBytes(
      response,
      maxBytes,
      options.signal
    );
    if (!bodyRead.ok) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: bodyRead.errorCode,
        httpStatus: response.status,
      };
    }

    if (bodyRead.bytes.byteLength === 0) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'EMPTY_RESPONSE_BODY',
        httpStatus: response.status,
      };
    }

    if (!isValidWebpPreviewBinary(bodyRead.bytes, maxBytes)) {
      return {
        ok: false,
        assetId: rawAssetId,
        errorCode: 'MALFORMED_IMAGE_BINARY',
        httpStatus: response.status,
      };
    }

    const blobCopy = new Uint8Array(bodyRead.bytes.byteLength);
    blobCopy.set(bodyRead.bytes);
    const blob = new Blob([blobCopy.buffer], { type: 'image/webp' });

    return {
      ok: true,
      assetId: rawAssetId,
      variant: EDITORIAL_IMAGE_PREVIEW_VARIANT,
      mimeType: 'image/webp',
      byteLength: bodyRead.bytes.byteLength,
      bytes: bodyRead.bytes,
      blob,
    };
  }
}

export interface EditorialDraftPreviewSessionOptions {
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly fetchPreview?: (options: {
    readonly assetId: string;
    readonly signal?: AbortSignal;
  }) => Promise<FetchEditorialImagePreviewOutcome>;
}

export interface LoadDraftPersistedPreviewsInput {
  readonly richBodyAr?: unknown;
  readonly richBodyEn?: unknown;
  readonly getStagedSessionPreviewMap?: () => Readonly<Record<string, string>>;
  readonly onPreviewMapUpdated?: (
    persistedPreviewMap: Readonly<Record<string, string>>
  ) => void;
}

export interface EditorialDraftPreviewSessionController {
  readonly loadPersistedPreviewsForDraft: (
    input: LoadDraftPersistedPreviewsInput
  ) => Promise<Readonly<Record<string, string>>>;
  readonly resetAndRevokeAll: () => void;
  readonly getPersistedPreviewMap: () => Readonly<Record<string, string>>;
  readonly getGeneration: () => number;
  readonly getRegistry: () => OwnedPreviewUrlRegistry;
}

/**
 * Merges persisted preview URLs with session-owned staged inline preview URLs,
 * guaranteeing that actively staged session-owned preview URLs always take precedence
 * and are never overwritten by persisted previews.
 */
export function mergePersistedAndStagedPreviewUrlMaps(
  persistedPreviewUrls: Readonly<Record<string, string>> | undefined,
  stagedSessionPreviewUrls: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> {
  const merged: Record<string, string> = {};

  if (persistedPreviewUrls && typeof persistedPreviewUrls === 'object') {
    for (const [assetId, url] of Object.entries(persistedPreviewUrls)) {
      if (typeof url === 'string' && isSafeRuntimePreviewUrl(url)) {
        merged[assetId] = url;
      }
    }
  }

  if (stagedSessionPreviewUrls && typeof stagedSessionPreviewUrls === 'object') {
    for (const [assetId, url] of Object.entries(stagedSessionPreviewUrls)) {
      if (typeof url === 'string' && isSafeRuntimePreviewUrl(url)) {
        merged[assetId] = url;
      }
    }
  }

  return Object.freeze(merged);
}

/**
 * Creates a lifecycle-managed controller for loading persisted editorial image previews
 * when opening an existing article draft.
 *
 * - Uses `createOwnedPreviewUrlRegistry` to register and deterministically revoke object URLs.
 * - Maintains a monotonic generation counter and an `AbortController` so switching drafts,
 *   closing the editor, or unmounting aborts in-flight requests and prevents stale responses
 *   from mutating state or leaking object URLs.
 * - Never overwrites an actively staged image's preview mapping.
 */
export function createEditorialDraftPreviewSessionController(
  options?: EditorialDraftPreviewSessionOptions
): EditorialDraftPreviewSessionController {
  const resolveCreateObjectUrl = (): ((blob: Blob) => string) => {
    if (options?.createObjectUrl) {
      return options.createObjectUrl;
    }
    if (customPreviewRuntime?.createObjectUrl) {
      return customPreviewRuntime.createObjectUrl;
    }
    return (blob: Blob) =>
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(blob)
        : '';
  };

  const resolveRevokeObjectUrl = (): ((url: string) => void) => {
    if (options?.revokeObjectUrl) {
      return options.revokeObjectUrl;
    }
    if (customPreviewRuntime?.revokeObjectUrl) {
      return customPreviewRuntime.revokeObjectUrl;
    }
    return (url: string) => {
      if (
        url &&
        typeof URL !== 'undefined' &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        URL.revokeObjectURL(url);
      }
    };
  };

  const registry = createOwnedPreviewUrlRegistry((url: string) => {
    resolveRevokeObjectUrl()(url);
  });

  let generation = 0;
  let activeAbortController: AbortController | null = null;

  const resetAndRevokeAll = (): void => {
    generation += 1;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    registry.revokeAllOwnedPreviewUrls();
  };

  const loadPersistedPreviewsForDraft = async (
    input: LoadDraftPersistedPreviewsInput
  ): Promise<Readonly<Record<string, string>>> => {
    resetAndRevokeAll();

    const currentGeneration = generation;
    const abortController = new AbortController();
    activeAbortController = abortController;

    const notifyIfCurrent = () => {
      if (generation === currentGeneration && !abortController.signal.aborted) {
        input.onPreviewMapUpdated?.(registry.getPreviewMap());
      }
    };

    const assetIds = extractPersistedEditorialImageAssetIds(
      input.richBodyAr,
      input.richBodyEn
    );

    notifyIfCurrent();

    if (assetIds.length === 0) {
      return registry.getPreviewMap();
    }

    const fetchFn =
      options?.fetchPreview ??
      ((req: { readonly assetId: string; readonly signal?: AbortSignal }) =>
        EditorialImagePreviewService.fetchPreviewImage(req));

    await Promise.all(
      assetIds.map(async (assetId) => {
        if (generation !== currentGeneration || abortController.signal.aborted) {
          return;
        }

        // Do not fetch or overwrite if this assetId is already owned by the active staged session
        const initialStaged = input.getStagedSessionPreviewMap?.() ?? {};
        if (
          typeof initialStaged[assetId] === 'string' &&
          isSafeRuntimePreviewUrl(initialStaged[assetId])
        ) {
          return;
        }

        let outcome: FetchEditorialImagePreviewOutcome;
        try {
          outcome = await fetchFn({
            assetId,
            signal: abortController.signal,
          });
        } catch {
          return;
        }

        if (!outcome.ok) {
          return;
        }

        if (generation !== currentGeneration || abortController.signal.aborted) {
          return;
        }

        // Re-check staged session preview map after async completion so staged images are never overwritten
        const latestStaged = input.getStagedSessionPreviewMap?.() ?? {};
        if (
          typeof latestStaged[assetId] === 'string' &&
          isSafeRuntimePreviewUrl(latestStaged[assetId])
        ) {
          return;
        }

        let createdUrl = '';
        try {
          createdUrl = resolveCreateObjectUrl()(outcome.blob);
        } catch {
          return;
        }

        if (!isSafeRuntimePreviewUrl(createdUrl)) {
          if (createdUrl) {
            try {
              resolveRevokeObjectUrl()(createdUrl);
            } catch {
              // Ignore revoke errors
            }
          }
          return;
        }

        if (generation !== currentGeneration || abortController.signal.aborted) {
          try {
            resolveRevokeObjectUrl()(createdUrl);
          } catch {
            // Ignore revoke errors
          }
          return;
        }

        registry.registerOwnedPreviewUrl(assetId, createdUrl);
        if (
          !registry.isUrlOwned(assetId) ||
          registry.getPreviewMap()[assetId] !== createdUrl
        ) {
          try {
            resolveRevokeObjectUrl()(createdUrl);
          } catch {
            // Ignore revoke errors
          }
          return;
        }

        notifyIfCurrent();
      })
    );

    return registry.getPreviewMap();
  };

  return Object.freeze({
    loadPersistedPreviewsForDraft,
    resetAndRevokeAll,
    getPersistedPreviewMap: () => registry.getPreviewMap(),
    getGeneration: () => generation,
    getRegistry: () => registry,
  });
}
