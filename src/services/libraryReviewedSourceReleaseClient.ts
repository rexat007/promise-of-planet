import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
  type AdminUser,
} from '../types/admin';
import { AdminAccessService } from './adminAccess';
import { isLibraryQuarantineReviewWorkbenchEnabled } from './libraryQuarantineReviewWorkbenchClient';
import {
  isLibraryQuarantineHumanReviewEnabled,
  type SanitizedLibraryQuarantineHumanReviewCaseDto,
} from './libraryQuarantineHumanReviewClient';
import {
  QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX,
  deriveQuarantineCatalogDocumentId,
  isLibraryQuarantineCatalogHandoffEnabled,
} from './libraryQuarantineCatalogHandoffClient';
import {
  isLibraryQuarantineRightsDecisionEnabled,
  type LibraryQuarantineRightsBasis,
  type LibraryQuarantineRightsDecisionStatus,
} from './libraryQuarantineRightsDecisionClient';

/**
 * LIB-PUBLISH-01 — Browser-Safe Client & State Controller for Publishing
 * Reviewed External Source References (`doc-qsrc-<receiptId>`)
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Calls ONLY the existing `manageLibraryDocuments` Cloud Function with exact
 *   minimal payloads:
 *     - `{ action: 'getReviewedLibrarySourceReleaseStatus', receiptId }`
 *     - `{ action: 'publishReviewedLibrarySourceReference', receiptId, expectedHumanCaseRevision, expectedCatalogUpdatedAt, expectedAlignmentRevision, expectedRightsDecisionRevision, confirmation, input }`
 * - Never writes directly to Firestore or touches GCS quarantine storage.
 * - Strictly requires active human Library administrator holding ALL FOUR
 *   permissions (`Review`, `ManageRights`, `Approve`, `Publish`).
 * - Strictly validates external publisher `https://` URLs and full-text public
 *   link rights evidence; never falls back to `CATALOG_METADATA_ONLY` or
 *   `RESTRICTED` rights decisions.
 * - Rejects any response containing quarantine storage paths, `sourceSha256`,
 *   internal actor UIDs, signed URLs, download tokens, or raw bytes.
 * - Never auto-retries on `UNKNOWN` (`published: null`); provides read-only
 *   status verification (`verifyUncertainPublish`).
 */

export const LIBRARY_REVIEWED_SOURCE_RELEASE_UI_ENV_VAR =
  'VITE_LIBRARY_REVIEWED_SOURCE_RELEASE_ENABLED' as const;

export const LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION = 1 as const;

export const LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL =
  'CONFIRM_PUBLISH_REVIEWED_SOURCE_REFERENCE' as const;

export const REVIEWED_PUBLIC_LIBRARY_DOCUMENT_ID_PREFIX = 'doc-qsrc-' as const;
export const REVIEWED_PUBLIC_LIBRARY_DOCUMENT_ID_REGEX =
  /^doc-qsrc-[0-9a-f]{32}$/;

export const REVIEWED_PUBLIC_RIGHTS_STATUSES = Object.freeze([
  'OpenPubliclyAvailable',
  'PermissionGranted',
] as const);

export type ReviewedPublicLibraryRightsStatus =
  (typeof REVIEWED_PUBLIC_RIGHTS_STATUSES)[number];

export const REVIEWED_PUBLIC_LINK_BASES = Object.freeze([
  'PUBLIC_DOMAIN_FULL_TEXT',
  'OPEN_LICENSE_FULL_TEXT',
  'EXPLICIT_PUBLISHER_PERMISSION_FULL_TEXT',
  'OFFICIAL_PUBLIC_SOURCE_LINK',
] as const);

export type ReviewedPublicLinkBasis =
  (typeof REVIEWED_PUBLIC_LINK_BASES)[number];

export const VERIFIED_PUBLISHER_URL_MAX_LENGTH = 2000 as const;
export const RELEASE_EVIDENCE_REFERENCE_MAX_LENGTH = 500 as const;
export const RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH = 2000 as const;
export const RELEASE_NOTES_MAX_LENGTH = 1000 as const;

export const REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS = Object.freeze({
  BACKEND_UNAVAILABLE: 'REVIEWED_SOURCE_RELEASE_BACKEND_UNAVAILABLE',
  FEATURE_NOT_RELEASED: 'REVIEWED_SOURCE_RELEASE_NOT_RELEASED',
  INVALID_RECEIPT_ID: 'INVALID_RECEIPT_ID',
  INVALID_INPUT: 'INVALID_RELEASE_INPUT',
  INVALID_URL: 'INVALID_VERIFIED_SOURCE_URL',
  EVIDENCE_REQUIRED: 'PUBLIC_RIGHTS_EVIDENCE_REQUIRED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  GET_CALL_FAILED: 'REVIEWED_SOURCE_RELEASE_GET_CALL_FAILED',
  GET_RESPONSE_INVALID: 'REVIEWED_SOURCE_RELEASE_GET_RESPONSE_INVALID',
  PUBLISH_RESPONSE_INVALID: 'REVIEWED_SOURCE_RELEASE_PUBLISH_RESPONSE_INVALID',
  PUBLISH_UNCONFIRMED: 'PUBLISH_RESULT_UNCONFIRMED',
} as const);

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;

const ISO_UTC_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const BIDI_OR_INVISIBLE_FORMAT_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|blob\s*:|gs:\/\/|library\/quarantine\/|firebasestorage\.googleapis\.com|firebasestorage\.app|storage\.googleapis\.com|x-goog-signature|\.\.\/|\.\.\\)/i;

const FORBIDDEN_URL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.localdomain',
  'storage.googleapis.com',
  'storage.cloud.google.com',
  'firebasestorage.googleapis.com',
  'firebasestorage.app',
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rb.gy',
  'shorturl.at',
  'rebrand.ly',
]);

const FORBIDDEN_URL_PARAM_NAMES: ReadonlySet<string> = new Set([
  'token',
  'access_token',
  'id_token',
  'auth',
  'alt',
  'googleaccessid',
  'signature',
  'sig',
  'expires',
  'apikey',
  'api_key',
  'redirect',
  'redirect_uri',
  'redirect_url',
  'return',
  'returnto',
  'returnurl',
  'next',
  'url',
  'target',
  'dest',
  'destination',
  'continue',
]);

const FORBIDDEN_SECRET_KEYS: ReadonlySet<string> = new Set([
  'sourceSha256',
  'sha256',
  'createdBy',
  'updatedBy',
  'publishedBy',
  'actorUid',
  'storagePath',
  'quarantineBucket',
  'quarantineObjectPath',
  'bucket',
  'objectPath',
  'generation',
  'signedUrl',
  'downloadUrl',
  'fileUrl',
  'rawBytes',
  'bytes',
  'buffer',
  'token',
]);

const ALLOWED_SANITIZED_RELEASE_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'sourceCatalogDocumentId',
  'publicDocumentId',
  'releaseRevision',
  'sourceRevision',
  'draftSourceRevision',
  'catalogHandoffCaseRevision',
  'alignedHumanCaseRevision',
  'alignmentRevision',
  'catalogUpdatedAt',
  'rightsDecisionRevision',
  'organizationId',
  'sourceId',
  'publicRightsStatus',
  'publicLinkBasis',
  'rightsEvidenceReference',
  'rightsEvidenceSummary',
  'releaseNotes',
  'verifiedSourceUrl',
  'publishedAt',
  'quarantineBinaryExposed',
  'quarantineDraftRemainsDraft',
]);

const ALLOWED_SANITIZED_PUBLIC_DOC_KEYS: ReadonlySet<string> = new Set([
  'id',
  'titleAr',
  'titleEn',
  'organizationId',
  'sourceId',
  'rightsStatus',
  'workflowState',
  'referenceUrl',
  'updatedAt',
]);

const ALLOWED_GET_READY_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'receiptId',
  'quarantineCatalogDocumentId',
  'publicDocumentId',
  'eligibleForPublish',
  'blockCode',
  'blockMessage',
  'isPublished',
  'quarantineDraftWorkflowState',
  'quarantineBinaryExposed',
  'currentHumanCaseRevision',
  'effectiveAlignedCaseRevision',
  'currentAlignmentRevision',
  'catalogUpdatedAt',
  'catalogAligned',
  'currentRightsDecisionRevision',
  'currentRightsDecision',
  'currentRightsBasis',
  'rightsAuthorizedForMetadata',
  'organizationId',
  'organizationNameAr',
  'organizationNameEn',
  'sourceId',
  'sourceNameAr',
  'sourceNameEn',
  'sourceVerified',
  'suggestedPublisherBaseUrl',
  'catalogTitleAr',
  'catalogTitleEn',
  'releaseRecord',
  'publicDocument',
]);

const ALLOWED_GET_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'errorCode',
  'errorMessage',
  'receiptId',
  'quarantineCatalogDocumentId',
  'publicDocumentId',
  'eligibleForPublish',
  'isPublished',
  'quarantineBinaryExposed',
]);

const ALLOWED_PUBLISH_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'releaseOutcome',
  'publishedChanged',
  'published',
  'receiptId',
  'quarantineCatalogDocumentId',
  'publicDocumentId',
  'releaseRecord',
  'publicDocument',
  'quarantineDraftRemainsDraft',
  'quarantineBinaryExposed',
]);

const ALLOWED_PUBLISH_CONFLICT_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'releaseOutcome',
  'published',
  'errorCode',
  'errorMessage',
  'receiptId',
  'quarantineCatalogDocumentId',
  'publicDocumentId',
  'currentHumanCaseRevision',
  'effectiveAlignedCaseRevision',
  'currentAlignmentRevision',
  'currentCatalogUpdatedAt',
  'currentRightsDecisionRevision',
  'releaseRecord',
  'publicDocument',
  'quarantineBinaryExposed',
]);

const ALLOWED_PUBLISH_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'releaseOutcome',
  'published',
  'errorCode',
  'errorMessage',
  'receiptId',
  'quarantineCatalogDocumentId',
  'publicDocumentId',
  'quarantineBinaryExposed',
]);

const ALLOWED_PUBLISH_UNKNOWN_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'releaseOutcome',
  'published',
  'errorCode',
  'errorMessage',
  'receiptId',
  'quarantineCatalogDocumentId',
  'publicDocumentId',
  'quarantineBinaryExposed',
]);

export interface ReviewedLibrarySourceReleaseFormFields {
  readonly publicRightsStatus: ReviewedPublicLibraryRightsStatus;
  readonly publicLinkBasis: ReviewedPublicLinkBasis;
  readonly verifiedSourceUrl: string;
  readonly rightsEvidenceReference: string;
  readonly rightsEvidenceSummary: string;
  readonly releaseNotes: string;
}

export interface SanitizedReviewedLibrarySourceReleaseDto {
  readonly schemaVersion: typeof LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly sourceCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRevision: number;
  readonly sourceRevision: number;
  readonly draftSourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly alignedHumanCaseRevision: number;
  readonly alignmentRevision: number;
  readonly catalogUpdatedAt: string;
  readonly rightsDecisionRevision: number;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly publicRightsStatus: ReviewedPublicLibraryRightsStatus;
  readonly publicLinkBasis: ReviewedPublicLinkBasis;
  readonly rightsEvidenceReference: string;
  readonly rightsEvidenceSummary: string;
  readonly releaseNotes: string;
  readonly verifiedSourceUrl: string;
  readonly publishedAt: string;
  readonly quarantineBinaryExposed: false;
  readonly quarantineDraftRemainsDraft: true;
}

export interface SanitizedPublishedLibraryDocumentSummaryDto {
  readonly id: string;
  readonly titleAr: string;
  readonly titleEn: string;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly rightsStatus: ReviewedPublicLibraryRightsStatus;
  readonly workflowState: 'Published';
  readonly referenceUrl: string;
  readonly updatedAt: string;
}

export interface GetReviewedLibrarySourceReleaseStatusReadyDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly receiptId: string;
  readonly quarantineCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly eligibleForPublish: boolean;
  readonly blockCode: string | null;
  readonly blockMessage: string | null;
  readonly isPublished: boolean;
  readonly quarantineDraftWorkflowState: 'Draft';
  readonly quarantineBinaryExposed: false;
  readonly currentHumanCaseRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly currentAlignmentRevision: number;
  readonly catalogUpdatedAt: string;
  readonly catalogAligned: boolean;
  readonly currentRightsDecisionRevision: number | null;
  readonly currentRightsDecision: LibraryQuarantineRightsDecisionStatus | null;
  readonly currentRightsBasis: LibraryQuarantineRightsBasis | null;
  readonly rightsAuthorizedForMetadata: boolean;
  readonly organizationId: string;
  readonly organizationNameAr: string;
  readonly organizationNameEn: string;
  readonly sourceId: string;
  readonly sourceNameAr: string;
  readonly sourceNameEn: string;
  readonly sourceVerified: boolean;
  readonly suggestedPublisherBaseUrl: string | null;
  readonly catalogTitleAr: string;
  readonly catalogTitleEn: string;
  readonly releaseRecord: SanitizedReviewedLibrarySourceReleaseDto | null;
  readonly publicDocument: SanitizedPublishedLibraryDocumentSummaryDto | null;
}

export interface GetReviewedLibrarySourceReleaseStatusHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly quarantineCatalogDocumentId: string | null;
  readonly publicDocumentId: string | null;
  readonly eligibleForPublish: false;
  readonly isPublished: false;
  readonly quarantineBinaryExposed: false;
}

export type GetReviewedLibrarySourceReleaseStatusResponseDto =
  | GetReviewedLibrarySourceReleaseStatusReadyDto
  | GetReviewedLibrarySourceReleaseStatusHoldDto;

export interface PublishReviewedLibrarySourceReferenceSuccessDto {
  readonly ok: true;
  readonly status: 'PUBLISHED' | 'ALREADY_PUBLISHED';
  readonly releaseOutcome: 'PUBLISHED' | 'ALREADY_PUBLISHED';
  readonly publishedChanged: boolean;
  readonly published: true;
  readonly receiptId: string;
  readonly quarantineCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRecord: SanitizedReviewedLibrarySourceReleaseDto;
  readonly publicDocument: SanitizedPublishedLibraryDocumentSummaryDto;
  readonly quarantineDraftRemainsDraft: true;
  readonly quarantineBinaryExposed: false;
}

export interface PublishReviewedLibrarySourceReferenceConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly releaseOutcome: 'NOT_PUBLISHED' | 'ALREADY_PUBLISHED';
  readonly published: false;
  readonly errorCode:
    | 'RELEASE_PRECONDITION_CONFLICT'
    | 'RELEASE_ALREADY_EXISTS_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly quarantineCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly currentHumanCaseRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly currentAlignmentRevision: number;
  readonly currentCatalogUpdatedAt: string;
  readonly currentRightsDecisionRevision: number | null;
  readonly releaseRecord: SanitizedReviewedLibrarySourceReleaseDto | null;
  readonly publicDocument: SanitizedPublishedLibraryDocumentSummaryDto | null;
  readonly quarantineBinaryExposed: false;
}

export interface PublishReviewedLibrarySourceReferenceHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly releaseOutcome: 'NOT_PUBLISHED';
  readonly published: false;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly quarantineCatalogDocumentId: string | null;
  readonly publicDocumentId: string | null;
  readonly quarantineBinaryExposed: false;
}

export interface PublishReviewedLibrarySourceReferenceUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly releaseOutcome: 'UNKNOWN';
  readonly published: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly quarantineCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly quarantineBinaryExposed: false;
}

export type PublishReviewedLibrarySourceReferenceResponseDto =
  | PublishReviewedLibrarySourceReferenceSuccessDto
  | PublishReviewedLibrarySourceReferenceConflictDto
  | PublishReviewedLibrarySourceReferenceHoldDto
  | PublishReviewedLibrarySourceReferenceUnknownDto;

export function deriveReviewedPublicLibraryDocumentId(receiptId: string): string {
  return `${REVIEWED_PUBLIC_LIBRARY_DOCUMENT_ID_PREFIX}${receiptId}`;
}

export function canUserPublishReviewedLibrarySourceReference(
  user: AdminUser | null | undefined
): boolean {
  if (!user || user.isActive !== true) {
    return false;
  }
  if (user.role === AdminRole.AIAssistant) {
    return false;
  }
  if (!hasDomainResponsibility(user.role, AdminDomain.Library)) {
    return false;
  }
  return (
    AdminAccessService.hasPermission(user, AdminPermission.Review) &&
    AdminAccessService.hasPermission(user, AdminPermission.ManageRights) &&
    AdminAccessService.hasPermission(user, AdminPermission.Approve) &&
    AdminAccessService.hasPermission(user, AdminPermission.Publish)
  );
}

export function isLibraryQuarantineReviewedSourceReleaseEnabled(
  envOverride?: Record<string, unknown>
): boolean {
  if (
    !isLibraryQuarantineReviewWorkbenchEnabled(envOverride) ||
    !isLibraryQuarantineHumanReviewEnabled(envOverride) ||
    !isLibraryQuarantineCatalogHandoffEnabled(envOverride) ||
    !isLibraryQuarantineRightsDecisionEnabled(envOverride)
  ) {
    return false;
  }
  if (envOverride) {
    return envOverride[LIBRARY_REVIEWED_SOURCE_RELEASE_UI_ENV_VAR] !== 'false';
  }
  const viteEnv = (import.meta as { env?: Record<string, unknown> }).env;
  if (
    viteEnv &&
    viteEnv[LIBRARY_REVIEWED_SOURCE_RELEASE_UI_ENV_VAR] === 'false'
  ) {
    return false;
  }
  if (
    typeof process !== 'undefined' &&
    process.env &&
    process.env[LIBRARY_REVIEWED_SOURCE_RELEASE_UI_ENV_VAR] === 'false'
  ) {
    return false;
  }
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  return Object.getOwnPropertySymbols(value).length === 0;
}

function containsForbiddenSecretKeysDeep(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenSecretKeysDeep(item, depth + 1));
  }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEYS.has(k)) {
      return true;
    }
    if (typeof v === 'string') {
      if (
        v.includes('library/quarantine/') ||
        v.includes('gs://') ||
        v.toLowerCase().includes('firebasestorage.googleapis.com') ||
        v.toLowerCase().includes('x-goog-signature')
      ) {
        return true;
      }
    } else if (containsForbiddenSecretKeysDeep(v, depth + 1)) {
      return true;
    }
  }
  return false;
}

function hasAllowedKeysOnly(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): boolean {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      return false;
    }
  }
  return true;
}

function hasForbiddenControlOrBidiChar(
  value: string,
  allowNewline: boolean
): boolean {
  if (BIDI_OR_INVISIBLE_FORMAT_REGEX.test(value)) {
    return true;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (allowNewline && code === 0x0a) {
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function isIpv4LiteralOrPrivateHost(hostname: string): boolean {
  const parts = hostname.split('.');
  if (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return true;
  }
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    return true;
  }
  if (hostname.startsWith('[') || hostname.includes(':')) {
    return true;
  }
  return false;
}

export function validateClientVerifiedPublisherSourceUrl(raw: unknown):
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly errorMessage: string } {
  if (typeof raw !== 'string') {
    return {
      ok: false,
      errorMessage: 'INVALID_VERIFIED_SOURCE_URL: Must be a string.',
    };
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > VERIFIED_PUBLISHER_URL_MAX_LENGTH ||
    /\s/.test(trimmed) ||
    hasForbiddenControlOrBidiChar(trimmed, false) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(trimmed) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(trimmed)
  ) {
    return {
      ok: false,
      errorMessage:
        'INVALID_VERIFIED_SOURCE_URL: Provide a single-line https:// publisher URL without spaces or control characters.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      errorMessage: 'INVALID_VERIFIED_SOURCE_URL: Malformed URL.',
    };
  }

  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.port !== '') {
    return {
      ok: false,
      errorMessage:
        'INVALID_VERIFIED_SOURCE_URL: Must use strict https:// without credentials or custom ports.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host.includes('.') ||
    host.startsWith('.') ||
    host.endsWith('.') ||
    host.includes('..') ||
    isIpv4LiteralOrPrivateHost(host) ||
    FORBIDDEN_URL_HOSTS.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localdomain') ||
    host.endsWith('.arpa') ||
    host.endsWith('.storage.googleapis.com') ||
    host.endsWith('.firebasestorage.app')
  ) {
    return {
      ok: false,
      errorMessage:
        'INVALID_VERIFIED_SOURCE_URL: Private hosts, quarantine buckets, and shorteners are not allowed.',
    };
  }

  let decodedCombined = `${parsed.pathname}${parsed.search}${parsed.hash}`.toLowerCase();
  try {
    decodedCombined = decodeURIComponent(decodedCombined);
  } catch {
    return {
      ok: false,
      errorMessage:
        'INVALID_VERIFIED_SOURCE_URL: Malformed percent encoding.',
    };
  }

  if (
    decodedCombined.includes('library/quarantine') ||
    decodedCombined.includes('/quarantine/') ||
    decodedCombined.includes('gs://') ||
    decodedCombined.includes('qcat-') ||
    decodedCombined.includes('x-goog-') ||
    decodedCombined.includes('googleaccessid') ||
    decodedCombined.includes('firebasestorage.googleapis.com') ||
    decodedCombined.includes('storage.googleapis.com')
  ) {
    return {
      ok: false,
      errorMessage:
        'INVALID_VERIFIED_SOURCE_URL: URL must not reference quarantine paths or storage tokens.',
    };
  }

  for (const [k, v] of parsed.searchParams.entries()) {
    const lk = k.toLowerCase();
    if (
      FORBIDDEN_URL_PARAM_NAMES.has(lk) ||
      lk.startsWith('x-goog-') ||
      lk.startsWith('x-amz-') ||
      /https?:\/\//i.test(v) ||
      /gs:\/\//i.test(v)
    ) {
      return {
        ok: false,
        errorMessage:
          'INVALID_VERIFIED_SOURCE_URL: Query tokens or open-redirect parameters are forbidden.',
      };
    }
  }

  return { ok: true, url: trimmed };
}

function isCatalogMetadataOnlyPhrase(summary: string): boolean {
  const lower = summary.toLowerCase();
  if (lower.includes('catalog_metadata_only') && !lower.includes('full')) {
    return true;
  }
  const normalizedOnly = lower.replace(/[^a-z0-9]+/g, ' ').trim();
  return (
    normalizedOnly === 'catalog metadata only' ||
    normalizedOnly === 'metadata use cleared' ||
    normalizedOnly === 'official record' ||
    normalizedOnly === 'public domain'
  );
}

export function validateClientReviewedSourceReleaseForm(
  raw: ReviewedLibrarySourceReleaseFormFields
): ReviewedLibrarySourceReleaseFormFields {
  if (
    raw.publicRightsStatus !== 'OpenPubliclyAvailable' &&
    raw.publicRightsStatus !== 'PermissionGranted'
  ) {
    throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.INVALID_INPUT);
  }

  if (
    !(REVIEWED_PUBLIC_LINK_BASES as readonly string[]).includes(
      raw.publicLinkBasis
    )
  ) {
    throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.INVALID_INPUT);
  }

  const urlResult = validateClientVerifiedPublisherSourceUrl(raw.verifiedSourceUrl);
  if (!urlResult.ok) {
    throw new Error(urlResult.errorMessage);
  }

  const ref = raw.rightsEvidenceReference.trim();
  if (
    ref.length < 3 ||
    ref.length > RELEASE_EVIDENCE_REFERENCE_MAX_LENGTH ||
    hasForbiddenControlOrBidiChar(ref, false) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(ref) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(ref)
  ) {
    throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.EVIDENCE_REQUIRED);
  }

  const summary = raw.rightsEvidenceSummary.replace(/\r\n?/g, '\n').trim();
  if (
    summary.length < 10 ||
    summary.length > RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH ||
    hasForbiddenControlOrBidiChar(summary, true) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(summary) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(summary) ||
    isCatalogMetadataOnlyPhrase(summary)
  ) {
    throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.EVIDENCE_REQUIRED);
  }

  const notes = raw.releaseNotes.replace(/\r\n?/g, '\n').trim();
  if (
    notes.length > RELEASE_NOTES_MAX_LENGTH ||
    hasForbiddenControlOrBidiChar(notes, true) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(notes) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(notes)
  ) {
    throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.INVALID_INPUT);
  }

  return Object.freeze({
    publicRightsStatus: raw.publicRightsStatus,
    publicLinkBasis: raw.publicLinkBasis,
    verifiedSourceUrl: urlResult.url,
    rightsEvidenceReference: ref,
    rightsEvidenceSummary: summary,
    releaseNotes: notes,
  });
}

function validateSafePlainString(
  raw: unknown,
  minLen: number,
  maxLen: number,
  allowNewline: boolean
): raw is string {
  return (
    typeof raw === 'string' &&
    raw.length >= minLen &&
    raw.length <= maxLen &&
    !hasForbiddenControlOrBidiChar(raw, allowNewline) &&
    !HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(raw)
  );
}

export function validateSanitizedReviewedReleaseDto(
  raw: unknown,
  expectedReceiptId?: string
): SanitizedReviewedLibrarySourceReleaseDto | null {
  if (!isPlainRecord(raw) || containsForbiddenSecretKeysDeep(raw)) {
    return null;
  }
  if (!hasAllowedKeysOnly(raw, ALLOWED_SANITIZED_RELEASE_KEYS)) {
    return null;
  }
  if (
    raw.schemaVersion !== LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION ||
    typeof raw.receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
    (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
  ) {
    return null;
  }
  if (
    raw.sourceCatalogDocumentId !==
      deriveQuarantineCatalogDocumentId(raw.receiptId) ||
    raw.publicDocumentId !==
      deriveReviewedPublicLibraryDocumentId(raw.receiptId) ||
    raw.quarantineBinaryExposed !== false ||
    raw.quarantineDraftRemainsDraft !== true
  ) {
    return null;
  }
  const urlCheck = validateClientVerifiedPublisherSourceUrl(raw.verifiedSourceUrl);
  if (!urlCheck.ok) {
    return null;
  }
  if (
    (raw.publicRightsStatus !== 'OpenPubliclyAvailable' &&
      raw.publicRightsStatus !== 'PermissionGranted') ||
    typeof raw.publicLinkBasis !== 'string' ||
    !(REVIEWED_PUBLIC_LINK_BASES as readonly string[]).includes(
      raw.publicLinkBasis
    ) ||
    !validateSafePlainString(
      raw.rightsEvidenceReference,
      3,
      RELEASE_EVIDENCE_REFERENCE_MAX_LENGTH,
      false
    ) ||
    !validateSafePlainString(
      raw.rightsEvidenceSummary,
      10,
      RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH,
      true
    ) ||
    !validateSafePlainString(raw.releaseNotes, 0, RELEASE_NOTES_MAX_LENGTH, true) ||
    typeof raw.publishedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.publishedAt) ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.catalogUpdatedAt) ||
    typeof raw.alignedHumanCaseRevision !== 'number' ||
    typeof raw.alignmentRevision !== 'number' ||
    typeof raw.rightsDecisionRevision !== 'number' ||
    typeof raw.organizationId !== 'string' ||
    typeof raw.sourceId !== 'string'
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION,
    receiptId: raw.receiptId,
    sourceCatalogDocumentId: raw.sourceCatalogDocumentId,
    publicDocumentId: raw.publicDocumentId,
    releaseRevision: Number(raw.releaseRevision),
    sourceRevision: Number(raw.sourceRevision),
    draftSourceRevision: Number(raw.draftSourceRevision),
    catalogHandoffCaseRevision: Number(raw.catalogHandoffCaseRevision),
    alignedHumanCaseRevision: raw.alignedHumanCaseRevision,
    alignmentRevision: raw.alignmentRevision,
    catalogUpdatedAt: raw.catalogUpdatedAt,
    rightsDecisionRevision: raw.rightsDecisionRevision,
    organizationId: raw.organizationId,
    sourceId: raw.sourceId,
    publicRightsStatus: raw.publicRightsStatus,
    publicLinkBasis: raw.publicLinkBasis as ReviewedPublicLinkBasis,
    rightsEvidenceReference: raw.rightsEvidenceReference,
    rightsEvidenceSummary: raw.rightsEvidenceSummary,
    releaseNotes: raw.releaseNotes,
    verifiedSourceUrl: urlCheck.url,
    publishedAt: raw.publishedAt,
    quarantineBinaryExposed: false,
    quarantineDraftRemainsDraft: true,
  });
}

export function validateSanitizedPublicDocSummaryDto(
  raw: unknown,
  expectedPublicDocId?: string
): SanitizedPublishedLibraryDocumentSummaryDto | null {
  if (!isPlainRecord(raw) || containsForbiddenSecretKeysDeep(raw)) {
    return null;
  }
  if (!hasAllowedKeysOnly(raw, ALLOWED_SANITIZED_PUBLIC_DOC_KEYS)) {
    return null;
  }
  if (
    typeof raw.id !== 'string' ||
    !REVIEWED_PUBLIC_LIBRARY_DOCUMENT_ID_REGEX.test(raw.id) ||
    raw.id.startsWith(QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX) ||
    (expectedPublicDocId !== undefined && raw.id !== expectedPublicDocId) ||
    raw.workflowState !== 'Published' ||
    (raw.rightsStatus !== 'OpenPubliclyAvailable' &&
      raw.rightsStatus !== 'PermissionGranted') ||
    !validateSafePlainString(raw.titleAr, 1, 300, false) ||
    !validateSafePlainString(raw.titleEn, 1, 300, false) ||
    typeof raw.organizationId !== 'string' ||
    typeof raw.sourceId !== 'string' ||
    typeof raw.updatedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.updatedAt)
  ) {
    return null;
  }
  const urlCheck = validateClientVerifiedPublisherSourceUrl(raw.referenceUrl);
  if (!urlCheck.ok) {
    return null;
  }
  return Object.freeze({
    id: raw.id,
    titleAr: raw.titleAr,
    titleEn: raw.titleEn,
    organizationId: raw.organizationId,
    sourceId: raw.sourceId,
    rightsStatus: raw.rightsStatus,
    workflowState: 'Published',
    referenceUrl: urlCheck.url,
    updatedAt: raw.updatedAt,
  });
}

export function validateGetReviewedSourceReleaseStatusResponseDto(
  raw: unknown,
  expectedReceiptId?: string
): GetReviewedLibrarySourceReleaseStatusResponseDto | null {
  if (!isPlainRecord(raw) || containsForbiddenSecretKeysDeep(raw)) {
    return null;
  }
  if (raw.ok === false && raw.status === 'HOLD') {
    if (
      !hasAllowedKeysOnly(raw, ALLOWED_GET_HOLD_KEYS) ||
      typeof raw.errorCode !== 'string' ||
      typeof raw.errorMessage !== 'string' ||
      raw.eligibleForPublish !== false ||
      raw.isPublished !== false ||
      raw.quarantineBinaryExposed !== false
    ) {
      return null;
    }
    return Object.freeze({
      ok: false,
      status: 'HOLD',
      errorCode: raw.errorCode,
      errorMessage: raw.errorMessage,
      receiptId: typeof raw.receiptId === 'string' ? raw.receiptId : null,
      quarantineCatalogDocumentId:
        typeof raw.quarantineCatalogDocumentId === 'string'
          ? raw.quarantineCatalogDocumentId
          : null,
      publicDocumentId:
        typeof raw.publicDocumentId === 'string' ? raw.publicDocumentId : null,
      eligibleForPublish: false,
      isPublished: false,
      quarantineBinaryExposed: false,
    });
  }

  if (raw.ok === true && raw.status === 'READY') {
    if (
      !hasAllowedKeysOnly(raw, ALLOWED_GET_READY_KEYS) ||
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId) ||
      raw.quarantineCatalogDocumentId !==
        deriveQuarantineCatalogDocumentId(raw.receiptId) ||
      raw.publicDocumentId !==
        deriveReviewedPublicLibraryDocumentId(raw.receiptId) ||
      typeof raw.eligibleForPublish !== 'boolean' ||
      typeof raw.isPublished !== 'boolean' ||
      raw.quarantineDraftWorkflowState !== 'Draft' ||
      raw.quarantineBinaryExposed !== false ||
      typeof raw.currentHumanCaseRevision !== 'number' ||
      typeof raw.effectiveAlignedCaseRevision !== 'number' ||
      typeof raw.currentAlignmentRevision !== 'number' ||
      typeof raw.catalogUpdatedAt !== 'string' ||
      !ISO_UTC_TIMESTAMP_REGEX.test(raw.catalogUpdatedAt) ||
      typeof raw.catalogAligned !== 'boolean' ||
      typeof raw.rightsAuthorizedForMetadata !== 'boolean' ||
      typeof raw.sourceVerified !== 'boolean'
    ) {
      return null;
    }

    let releaseRecord: SanitizedReviewedLibrarySourceReleaseDto | null = null;
    let publicDocument: SanitizedPublishedLibraryDocumentSummaryDto | null = null;

    if (raw.isPublished) {
      releaseRecord = validateSanitizedReviewedReleaseDto(
        raw.releaseRecord,
        raw.receiptId
      );
      publicDocument = validateSanitizedPublicDocSummaryDto(
        raw.publicDocument,
        raw.publicDocumentId
      );
      if (!releaseRecord || !publicDocument) {
        return null;
      }
    } else if (raw.releaseRecord !== null || raw.publicDocument !== null) {
      return null;
    }

    let suggestedUrl: string | null = null;
    if (typeof raw.suggestedPublisherBaseUrl === 'string') {
      const check = validateClientVerifiedPublisherSourceUrl(
        raw.suggestedPublisherBaseUrl
      );
      suggestedUrl = check.ok ? check.url : null;
    }

    return Object.freeze({
      ok: true,
      status: 'READY',
      receiptId: raw.receiptId,
      quarantineCatalogDocumentId: raw.quarantineCatalogDocumentId,
      publicDocumentId: raw.publicDocumentId,
      eligibleForPublish: raw.eligibleForPublish,
      blockCode: typeof raw.blockCode === 'string' ? raw.blockCode : null,
      blockMessage:
        typeof raw.blockMessage === 'string' ? raw.blockMessage : null,
      isPublished: raw.isPublished,
      quarantineDraftWorkflowState: 'Draft',
      quarantineBinaryExposed: false,
      currentHumanCaseRevision: raw.currentHumanCaseRevision,
      effectiveAlignedCaseRevision: raw.effectiveAlignedCaseRevision,
      currentAlignmentRevision: raw.currentAlignmentRevision,
      catalogUpdatedAt: raw.catalogUpdatedAt,
      catalogAligned: raw.catalogAligned,
      currentRightsDecisionRevision:
        typeof raw.currentRightsDecisionRevision === 'number'
          ? raw.currentRightsDecisionRevision
          : null,
      currentRightsDecision:
        typeof raw.currentRightsDecision === 'string'
          ? (raw.currentRightsDecision as LibraryQuarantineRightsDecisionStatus)
          : null,
      currentRightsBasis:
        typeof raw.currentRightsBasis === 'string'
          ? (raw.currentRightsBasis as LibraryQuarantineRightsBasis)
          : null,
      rightsAuthorizedForMetadata: raw.rightsAuthorizedForMetadata,
      organizationId: String(raw.organizationId ?? ''),
      organizationNameAr: String(raw.organizationNameAr ?? ''),
      organizationNameEn: String(raw.organizationNameEn ?? ''),
      sourceId: String(raw.sourceId ?? ''),
      sourceNameAr: String(raw.sourceNameAr ?? ''),
      sourceNameEn: String(raw.sourceNameEn ?? ''),
      sourceVerified: raw.sourceVerified,
      suggestedPublisherBaseUrl: suggestedUrl,
      catalogTitleAr: String(raw.catalogTitleAr ?? ''),
      catalogTitleEn: String(raw.catalogTitleEn ?? ''),
      releaseRecord,
      publicDocument,
    });
  }

  return null;
}

export function validatePublishReviewedSourceReferenceResponseDto(
  raw: unknown,
  expectedReceiptId?: string
): PublishReviewedLibrarySourceReferenceResponseDto | null {
  if (!isPlainRecord(raw) || containsForbiddenSecretKeysDeep(raw)) {
    return null;
  }

  if (
    raw.ok === true &&
    (raw.status === 'PUBLISHED' || raw.status === 'ALREADY_PUBLISHED')
  ) {
    if (
      !hasAllowedKeysOnly(raw, ALLOWED_PUBLISH_SUCCESS_KEYS) ||
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId) ||
      raw.published !== true ||
      typeof raw.publishedChanged !== 'boolean' ||
      raw.quarantineDraftRemainsDraft !== true ||
      raw.quarantineBinaryExposed !== false
    ) {
      return null;
    }
    const releaseRecord = validateSanitizedReviewedReleaseDto(
      raw.releaseRecord,
      raw.receiptId
    );
    const publicDocument = validateSanitizedPublicDocSummaryDto(
      raw.publicDocument,
      deriveReviewedPublicLibraryDocumentId(raw.receiptId)
    );
    if (!releaseRecord || !publicDocument) {
      return null;
    }
    return Object.freeze({
      ok: true,
      status: raw.status,
      releaseOutcome: raw.status,
      publishedChanged: raw.publishedChanged,
      published: true,
      receiptId: raw.receiptId,
      quarantineCatalogDocumentId: deriveQuarantineCatalogDocumentId(
        raw.receiptId
      ),
      publicDocumentId: deriveReviewedPublicLibraryDocumentId(raw.receiptId),
      releaseRecord,
      publicDocument,
      quarantineDraftRemainsDraft: true,
      quarantineBinaryExposed: false,
    });
  }

  if (raw.ok === false && raw.status === 'CONFLICT') {
    if (
      !hasAllowedKeysOnly(raw, ALLOWED_PUBLISH_CONFLICT_KEYS) ||
      raw.published !== false ||
      raw.quarantineBinaryExposed !== false ||
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (raw.errorCode !== 'RELEASE_PRECONDITION_CONFLICT' &&
        raw.errorCode !== 'RELEASE_ALREADY_EXISTS_CONFLICT') ||
      typeof raw.errorMessage !== 'string'
    ) {
      return null;
    }
    const releaseRecord =
      raw.releaseRecord !== null
        ? validateSanitizedReviewedReleaseDto(raw.releaseRecord, raw.receiptId)
        : null;
    const publicDocument =
      raw.publicDocument !== null
        ? validateSanitizedPublicDocSummaryDto(
            raw.publicDocument,
            deriveReviewedPublicLibraryDocumentId(raw.receiptId)
          )
        : null;

    return Object.freeze({
      ok: false,
      status: 'CONFLICT',
      releaseOutcome:
        raw.releaseOutcome === 'ALREADY_PUBLISHED'
          ? 'ALREADY_PUBLISHED'
          : 'NOT_PUBLISHED',
      published: false,
      errorCode: raw.errorCode,
      errorMessage: raw.errorMessage,
      receiptId: raw.receiptId,
      quarantineCatalogDocumentId: deriveQuarantineCatalogDocumentId(
        raw.receiptId
      ),
      publicDocumentId: deriveReviewedPublicLibraryDocumentId(raw.receiptId),
      currentHumanCaseRevision: Number(raw.currentHumanCaseRevision ?? 0),
      effectiveAlignedCaseRevision: Number(
        raw.effectiveAlignedCaseRevision ?? 0
      ),
      currentAlignmentRevision: Number(raw.currentAlignmentRevision ?? 0),
      currentCatalogUpdatedAt: String(raw.currentCatalogUpdatedAt ?? ''),
      currentRightsDecisionRevision:
        typeof raw.currentRightsDecisionRevision === 'number'
          ? raw.currentRightsDecisionRevision
          : null,
      releaseRecord,
      publicDocument,
      quarantineBinaryExposed: false,
    });
  }

  if (raw.ok === false && raw.status === 'HOLD') {
    if (
      !hasAllowedKeysOnly(raw, ALLOWED_PUBLISH_HOLD_KEYS) ||
      raw.published !== false ||
      raw.quarantineBinaryExposed !== false ||
      typeof raw.errorCode !== 'string' ||
      typeof raw.errorMessage !== 'string'
    ) {
      return null;
    }
    return Object.freeze({
      ok: false,
      status: 'HOLD',
      releaseOutcome: 'NOT_PUBLISHED',
      published: false,
      errorCode: raw.errorCode,
      errorMessage: raw.errorMessage,
      receiptId: typeof raw.receiptId === 'string' ? raw.receiptId : null,
      quarantineCatalogDocumentId:
        typeof raw.quarantineCatalogDocumentId === 'string'
          ? raw.quarantineCatalogDocumentId
          : null,
      publicDocumentId:
        typeof raw.publicDocumentId === 'string' ? raw.publicDocumentId : null,
      quarantineBinaryExposed: false,
    });
  }

  if (raw.ok === false && raw.status === 'UNKNOWN') {
    if (
      !hasAllowedKeysOnly(raw, ALLOWED_PUBLISH_UNKNOWN_KEYS) ||
      raw.published !== null ||
      raw.releaseOutcome !== 'UNKNOWN' ||
      raw.quarantineBinaryExposed !== false ||
      typeof raw.receiptId !== 'string' ||
      typeof raw.errorMessage !== 'string'
    ) {
      return null;
    }
    return Object.freeze({
      ok: false,
      status: 'UNKNOWN',
      releaseOutcome: 'UNKNOWN',
      published: null,
      errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
      errorMessage: raw.errorMessage,
      receiptId: raw.receiptId,
      quarantineCatalogDocumentId: deriveQuarantineCatalogDocumentId(
        raw.receiptId
      ),
      publicDocumentId: deriveReviewedPublicLibraryDocumentId(raw.receiptId),
      quarantineBinaryExposed: false,
    });
  }

  return null;
}

export function isReviewedSourceReleaseNotReleasedError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return (
    err.message.includes('REVIEWED_SOURCE_RELEASE_NOT_RELEASED') ||
    err.message.includes('RIGHTS_DECISION_NOT_RELEASED') ||
    err.message.includes('WORKBENCH_NOT_RELEASED')
  );
}

export class LibraryReviewedSourceReleaseClient {
  public static async getReviewedLibrarySourceReleaseStatus(
    receiptId: string
  ): Promise<GetReviewedLibrarySourceReleaseStatusResponseDto> {
    if (!QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)) {
      throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
    }
    if (!isFirebaseConfigured || !app) {
      throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE);
    }

    const fn = httpsCallable<
      { readonly action: string; readonly receiptId: string },
      unknown
    >(getFunctions(app), 'manageLibraryDocuments');

    let resultData: unknown;
    try {
      const response = await fn({
        action: 'getReviewedLibrarySourceReleaseStatus',
        receiptId,
      });
      resultData = response.data;
    } catch (err) {
      if (isReviewedSourceReleaseNotReleasedError(err)) {
        throw new Error(
          REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED
        );
      }
      throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.GET_CALL_FAILED);
    }

    const validated = validateGetReviewedSourceReleaseStatusResponseDto(
      resultData,
      receiptId
    );
    if (!validated) {
      throw new Error(
        REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.GET_RESPONSE_INVALID
      );
    }
    return validated;
  }

  public static async publishReviewedLibrarySourceReference(params: {
    readonly receiptId: string;
    readonly expectedHumanCaseRevision: number;
    readonly expectedCatalogUpdatedAt: string;
    readonly expectedAlignmentRevision: number;
    readonly expectedRightsDecisionRevision: number;
    readonly confirmation: typeof LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL;
    readonly input: ReviewedLibrarySourceReleaseFormFields;
  }): Promise<PublishReviewedLibrarySourceReferenceResponseDto> {
    if (!QUARANTINE_RECEIPT_ID_REGEX.test(params.receiptId)) {
      throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
    }
    if (
      params.confirmation !== LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL
    ) {
      throw new Error(
        REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.CONFIRMATION_REQUIRED
      );
    }
    const validatedInput = validateClientReviewedSourceReleaseForm(params.input);

    if (!isFirebaseConfigured || !app) {
      throw new Error(REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE);
    }

    const fn = httpsCallable<unknown, unknown>(
      getFunctions(app),
      'manageLibraryDocuments'
    );

    const response = await fn({
      action: 'publishReviewedLibrarySourceReference',
      receiptId: params.receiptId,
      expectedHumanCaseRevision: params.expectedHumanCaseRevision,
      expectedCatalogUpdatedAt: params.expectedCatalogUpdatedAt,
      expectedAlignmentRevision: params.expectedAlignmentRevision,
      expectedRightsDecisionRevision: params.expectedRightsDecisionRevision,
      confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
      input: validatedInput,
    });

    const validated = validatePublishReviewedSourceReferenceResponseDto(
      response.data,
      params.receiptId
    );
    if (!validated) {
      throw new Error(
        REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.PUBLISH_RESPONSE_INVALID
      );
    }
    return validated;
  }
}

export interface LibraryQuarantineReviewedSourceReleasePanelSnapshot {
  readonly enabled: boolean;
  readonly receiptId: string | null;
  readonly loading: boolean;
  readonly publishing: boolean;
  readonly readinessStatus: GetReviewedLibrarySourceReleaseStatusReadyDto | null;
  readonly holdCode: string | null;
  readonly holdMessage: string | null;
  readonly form: ReviewedLibrarySourceReleaseFormFields;
  readonly confirmed: boolean;
  readonly loadError: string | null;
  readonly publishError: string | null;
  readonly lastOutcome: 'PUBLISHED' | 'ALREADY_PUBLISHED' | null;
  readonly conflictState: PublishReviewedLibrarySourceReferenceConflictDto | null;
  readonly uncertainState: PublishReviewedLibrarySourceReferenceUnknownDto | null;
  readonly sessionToken: number;
}

export function createEmptyReviewedSourceReleaseForm(): ReviewedLibrarySourceReleaseFormFields {
  return Object.freeze({
    publicRightsStatus: 'OpenPubliclyAvailable' as const,
    publicLinkBasis: 'OFFICIAL_PUBLIC_SOURCE_LINK' as const,
    verifiedSourceUrl: '',
    rightsEvidenceReference: '',
    rightsEvidenceSummary: '',
    releaseNotes: '',
  });
}

export interface LibraryQuarantineReviewedSourceReleaseControllerOptions {
  readonly enabled?: boolean;
  readonly getStatusFn?: (
    receiptId: string
  ) => Promise<GetReviewedLibrarySourceReleaseStatusResponseDto>;
  readonly publishFn?: (params: {
    readonly receiptId: string;
    readonly expectedHumanCaseRevision: number;
    readonly expectedCatalogUpdatedAt: string;
    readonly expectedAlignmentRevision: number;
    readonly expectedRightsDecisionRevision: number;
    readonly confirmation: typeof LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL;
    readonly input: ReviewedLibrarySourceReleaseFormFields;
  }) => Promise<PublishReviewedLibrarySourceReferenceResponseDto>;
  readonly onPublished?: (
    result: PublishReviewedLibrarySourceReferenceSuccessDto
  ) => void;
}

export class LibraryQuarantineReviewedSourceReleasePanelController {
  private currentUser: AdminUser | null;
  private getStatusFn: (
    receiptId: string
  ) => Promise<GetReviewedLibrarySourceReleaseStatusResponseDto>;
  private publishFn: (params: {
    readonly receiptId: string;
    readonly expectedHumanCaseRevision: number;
    readonly expectedCatalogUpdatedAt: string;
    readonly expectedAlignmentRevision: number;
    readonly expectedRightsDecisionRevision: number;
    readonly confirmation: typeof LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL;
    readonly input: ReviewedLibrarySourceReleaseFormFields;
  }) => Promise<PublishReviewedLibrarySourceReferenceResponseDto>;
  private onPublished?: (
    result: PublishReviewedLibrarySourceReferenceSuccessDto
  ) => void;
  private state: LibraryQuarantineReviewedSourceReleasePanelSnapshot;
  private readonly listeners = new Set<
    (snapshot: LibraryQuarantineReviewedSourceReleasePanelSnapshot) => void
  >();

  constructor(
    currentUser: AdminUser | null,
    options?: LibraryQuarantineReviewedSourceReleaseControllerOptions
  ) {
    this.currentUser = currentUser;
    this.getStatusFn =
      options?.getStatusFn ??
      ((receiptId) =>
        LibraryReviewedSourceReleaseClient.getReviewedLibrarySourceReleaseStatus(
          receiptId
        ));
    this.publishFn =
      options?.publishFn ??
      ((params) =>
        LibraryReviewedSourceReleaseClient.publishReviewedLibrarySourceReference(
          params
        ));
    this.onPublished = options?.onPublished;

    const resolvedEnabled =
      options?.enabled !== undefined
        ? options.enabled === true
        : isLibraryQuarantineReviewedSourceReleaseEnabled();

    this.state = Object.freeze({
      enabled: resolvedEnabled,
      receiptId: null,
      loading: false,
      publishing: false,
      readinessStatus: null,
      holdCode: null,
      holdMessage: null,
      form: createEmptyReviewedSourceReleaseForm(),
      confirmed: false,
      loadError: null,
      publishError: null,
      lastOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: 0,
    });
  }

  public getSnapshot(): LibraryQuarantineReviewedSourceReleasePanelSnapshot {
    return this.state;
  }

  public subscribe(
    listener: (
      snapshot: LibraryQuarantineReviewedSourceReleasePanelSnapshot
    ) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(
    patch: Partial<LibraryQuarantineReviewedSourceReleasePanelSnapshot>
  ): void {
    this.state = Object.freeze({
      ...this.state,
      ...patch,
    });
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public setCurrentUser(user: AdminUser | null): void {
    const prevId = this.currentUser?.id ?? null;
    const nextId = user?.id ?? null;
    this.currentUser = user;
    if (
      prevId !== nextId ||
      !canUserPublishReviewedLibrarySourceReference(user)
    ) {
      this.resetPanel();
    }
  }

  public setOptions(
    options: LibraryQuarantineReviewedSourceReleaseControllerOptions
  ): void {
    if (options.getStatusFn) {
      this.getStatusFn = options.getStatusFn;
    }
    if (options.publishFn) {
      this.publishFn = options.publishFn;
    }
    if (options.onPublished !== undefined) {
      this.onPublished = options.onPublished;
    }
    if (options.enabled !== undefined) {
      this.setState({ enabled: options.enabled === true });
    }
  }

  public resetPanel(): void {
    this.setState({
      receiptId: null,
      loading: false,
      publishing: false,
      readinessStatus: null,
      holdCode: null,
      holdMessage: null,
      form: createEmptyReviewedSourceReleaseForm(),
      confirmed: false,
      loadError: null,
      publishError: null,
      lastOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: this.state.sessionToken + 1,
    });
  }

  public updateFormField<K extends keyof ReviewedLibrarySourceReleaseFormFields>(
    field: K,
    value: ReviewedLibrarySourceReleaseFormFields[K]
  ): void {
    if (
      this.state.loading ||
      this.state.publishing ||
      this.state.uncertainState !== null ||
      this.state.readinessStatus?.isPublished === true
    ) {
      return;
    }
    this.setState({
      form: Object.freeze({
        ...this.state.form,
        [field]: value,
      }),
      publishError: null,
    });
  }

  public setConfirmed(confirmed: boolean): void {
    if (
      this.state.loading ||
      this.state.publishing ||
      this.state.uncertainState !== null ||
      this.state.readinessStatus?.isPublished === true
    ) {
      return;
    }
    this.setState({
      confirmed: confirmed === true,
      publishError: null,
    });
  }

  public async openForSavedCase(
    reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null
  ): Promise<GetReviewedLibrarySourceReleaseStatusResponseDto | null> {
    if (
      !this.state.enabled ||
      !canUserPublishReviewedLibrarySourceReference(this.currentUser) ||
      !reviewCase ||
      reviewCase.status !== 'METADATA_RECORDED'
    ) {
      this.resetPanel();
      return null;
    }

    const receiptId = reviewCase.receiptId;
    const nextToken = this.state.sessionToken + 1;
    const expectedUid = this.currentUser?.id ?? null;

    this.setState({
      receiptId,
      loading: true,
      readinessStatus: null,
      holdCode: null,
      holdMessage: null,
      confirmed: false,
      loadError: null,
      publishError: null,
      conflictState: null,
      uncertainState: null,
      lastOutcome: null,
      sessionToken: nextToken,
    });

    return this.executeLoadStatus(receiptId, nextToken, expectedUid);
  }

  public async reloadStatus(): Promise<GetReviewedLibrarySourceReleaseStatusResponseDto | null> {
    if (!this.state.receiptId || this.state.loading || this.state.publishing) {
      return null;
    }
    const receiptId = this.state.receiptId;
    const nextToken = this.state.sessionToken + 1;
    const expectedUid = this.currentUser?.id ?? null;

    this.setState({
      loading: true,
      loadError: null,
      publishError: null,
      conflictState: null,
      sessionToken: nextToken,
    });

    return this.executeLoadStatus(receiptId, nextToken, expectedUid);
  }

  private async executeLoadStatus(
    receiptId: string,
    activeToken: number,
    expectedUid: string | null
  ): Promise<GetReviewedLibrarySourceReleaseStatusResponseDto | null> {
    try {
      const response = await this.getStatusFn(receiptId);
      if (
        this.state.sessionToken !== activeToken ||
        this.state.receiptId !== receiptId ||
        (this.currentUser?.id ?? null) !== expectedUid ||
        !canUserPublishReviewedLibrarySourceReference(this.currentUser)
      ) {
        return null;
      }

      if (!response.ok) {
        this.setState({
          loading: false,
          readinessStatus: null,
          holdCode: response.errorCode,
          holdMessage: response.errorMessage,
          uncertainState: null,
        });
        return response;
      }

      const nextForm = response.releaseRecord
        ? Object.freeze({
            publicRightsStatus: response.releaseRecord.publicRightsStatus,
            publicLinkBasis: response.releaseRecord.publicLinkBasis,
            verifiedSourceUrl: response.releaseRecord.verifiedSourceUrl,
            rightsEvidenceReference:
              response.releaseRecord.rightsEvidenceReference,
            rightsEvidenceSummary: response.releaseRecord.rightsEvidenceSummary,
            releaseNotes: response.releaseRecord.releaseNotes,
          })
        : this.state.form;

      this.setState({
        loading: false,
        readinessStatus: response,
        holdCode: response.eligibleForPublish ? null : response.blockCode,
        holdMessage: response.eligibleForPublish ? null : response.blockMessage,
        form: nextForm,
        loadError: null,
        uncertainState: null,
      });
      return response;
    } catch (err) {
      if (
        this.state.sessionToken !== activeToken ||
        this.state.receiptId !== receiptId
      ) {
        return null;
      }
      const message =
        err instanceof Error
          ? err.message
          : REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.GET_CALL_FAILED;
      this.setState({
        loading: false,
        loadError: message,
      });
      return null;
    }
  }

  public async verifyUncertainPublish(): Promise<GetReviewedLibrarySourceReleaseStatusResponseDto | null> {
    if (!this.state.receiptId || this.state.loading || this.state.publishing) {
      return null;
    }
    const receiptId = this.state.receiptId;
    const nextToken = this.state.sessionToken + 1;
    const expectedUid = this.currentUser?.id ?? null;

    this.setState({
      loading: true,
      loadError: null,
      sessionToken: nextToken,
    });
    return this.executeLoadStatus(receiptId, nextToken, expectedUid);
  }

  public async publish(): Promise<PublishReviewedLibrarySourceReferenceResponseDto | null> {
    if (
      !this.state.enabled ||
      !canUserPublishReviewedLibrarySourceReference(this.currentUser) ||
      !this.state.receiptId ||
      this.state.loading ||
      this.state.publishing ||
      this.state.uncertainState !== null ||
      !this.state.readinessStatus ||
      !this.state.readinessStatus.eligibleForPublish ||
      this.state.readinessStatus.isPublished ||
      this.state.readinessStatus.currentRightsDecisionRevision === null
    ) {
      return null;
    }

    if (!this.state.confirmed) {
      this.setState({
        publishError:
          REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.CONFIRMATION_REQUIRED,
      });
      return null;
    }

    let validatedForm: ReviewedLibrarySourceReleaseFormFields;
    try {
      validatedForm = validateClientReviewedSourceReleaseForm(this.state.form);
    } catch (err) {
      this.setState({
        publishError:
          err instanceof Error
            ? err.message
            : REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.INVALID_INPUT,
      });
      return null;
    }

    const receiptId = this.state.receiptId;
    const activeToken = this.state.sessionToken;
    const expectedUid = this.currentUser?.id ?? null;
    const readiness = this.state.readinessStatus;

    this.setState({
      publishing: true,
      form: validatedForm,
      publishError: null,
      conflictState: null,
      lastOutcome: null,
    });

    try {
      const response = await this.publishFn({
        receiptId,
        expectedHumanCaseRevision: readiness.currentHumanCaseRevision,
        expectedCatalogUpdatedAt: readiness.catalogUpdatedAt,
        expectedAlignmentRevision: readiness.currentAlignmentRevision,
        expectedRightsDecisionRevision: readiness.currentRightsDecisionRevision!,
        confirmation: LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
        input: validatedForm,
      });

      if (
        this.state.sessionToken !== activeToken ||
        this.state.receiptId !== receiptId ||
        (this.currentUser?.id ?? null) !== expectedUid
      ) {
        return null;
      }

      if (response.ok) {
        this.setState({
          publishing: false,
          publishError: null,
          conflictState: null,
          uncertainState: null,
          lastOutcome: response.status,
        });
        this.onPublished?.(response);
        await this.executeLoadStatus(receiptId, activeToken, expectedUid);
        return response;
      }

      if (response.status === 'CONFLICT') {
        this.setState({
          publishing: false,
          conflictState: response,
          publishError: null,
        });
        return response;
      }

      if (response.status === 'UNKNOWN' || response.published === null) {
        this.setState({
          publishing: false,
          uncertainState: response as PublishReviewedLibrarySourceReferenceUnknownDto,
          publishError: null,
        });
        return response;
      }

      this.setState({
        publishing: false,
        holdCode: response.errorCode,
        holdMessage: response.errorMessage,
        publishError: `${response.errorCode}: ${response.errorMessage}`,
      });
      return response;
    } catch (err) {
      if (
        this.state.sessionToken !== activeToken ||
        this.state.receiptId !== receiptId
      ) {
        return null;
      }
      this.setState({
        publishing: false,
        uncertainState: Object.freeze({
          ok: false,
          status: 'UNKNOWN',
          releaseOutcome: 'UNKNOWN',
          published: null,
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
          errorMessage:
            err instanceof Error
              ? err.message
              : REVIEWED_SOURCE_RELEASE_CLIENT_SAFE_ERRORS.PUBLISH_UNCONFIRMED,
          receiptId,
          quarantineCatalogDocumentId:
            deriveQuarantineCatalogDocumentId(receiptId),
          publicDocumentId: deriveReviewedPublicLibraryDocumentId(receiptId),
          quarantineBinaryExposed: false,
        }),
      });
      return null;
    }
  }
}
