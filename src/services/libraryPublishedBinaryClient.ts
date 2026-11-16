import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
  type AdminUser,
} from '../types/admin';
import { LibraryRightsStatus, type PublicLibraryDocument } from '../types/library';
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
import { isLibraryQuarantineBinarySafetyCaseEnabled } from './libraryQuarantineBinarySafetyCaseClient';
import { isLibraryQuarantineIsolatedInspectionRequestEnabled } from './libraryQuarantineIsolatedInspectionRequestClient';

/**
 * LIB-DIRECT-FILE-01 — Browser-Safe Client & Controller for Publishing Quarantined
 * Binaries (`doc-qbin-<receiptId>`) + PublicLibraryHub Direct Download Helpers
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Calls ONLY the existing `manageLibraryDocuments` callable with:
 *     - `{ action: 'getPublishedLibraryBinaryReleaseStatus', receiptId }`
 *     - `{ action: 'publishQuarantinedBinaryToPublicLibrary', ... }`
 * - Never touches GCS directly, never reads Firebase tokens or storage paths,
 *   and never requests or submits an external publisher URL for direct-file release.
 * - Rejects any response containing quarantine storage paths, `sourceSha256`,
 *   internal actor UIDs, GCS signed URLs, Firebase download tokens, or raw bytes.
 * - `PublicLibraryHub` helpers render direct PDF/Word download links ONLY for
 *   `doc-qbin-<32hex>` records whose `referenceUrl` targets our owned HTTPS
 *   `libraryPublishedBinaryDownload?documentId=doc-qbin-...` gateway.
 */

export const LIBRARY_PUBLISHED_BINARY_RELEASE_UI_ENV_VAR =
  'VITE_LIBRARY_PUBLISHED_BINARY_RELEASE_ENABLED' as const;

export const LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION = 1 as const;

export const LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL =
  'CONFIRM_PUBLISH_QUARANTINED_BINARY_TO_PUBLIC_LIBRARY' as const;

export const PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_PREFIX = 'doc-qbin-' as const;
export const PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_REGEX =
  /^doc-qbin-[0-9a-f]{32}$/;

export const PUBLISHED_BINARY_PUBLIC_RIGHTS_STATUSES = Object.freeze([
  'OpenPubliclyAvailable',
  'PermissionGranted',
] as const);

export type PublishedBinaryPublicLibraryRightsStatus =
  (typeof PUBLISHED_BINARY_PUBLIC_RIGHTS_STATUSES)[number];

export const PUBLISHED_BINARY_RIGHTS_BASES = Object.freeze([
  'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
  'EXPLICIT_BINARY_REDISTRIBUTION_PERMISSION',
  'OPEN_LICENSE_BINARY_REDISTRIBUTION',
  'PUBLIC_DOMAIN_BINARY_DISTRIBUTION',
] as const);

export type PublishedBinaryRightsBasis =
  (typeof PUBLISHED_BINARY_RIGHTS_BASES)[number];

export type PublishedBinarySourceFormat = 'PDF' | 'DOCX';

export const BINARY_RELEASE_EVIDENCE_REFERENCE_MAX_LENGTH = 500 as const;
export const BINARY_RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH = 2000 as const;
export const BINARY_RELEASE_NOTES_MAX_LENGTH = 1000 as const;
export const BINARY_DOWNLOAD_FILENAME_MAX_LENGTH = 180 as const;

export const PUBLISHED_BINARY_CLIENT_SAFE_ERRORS = Object.freeze({
  BACKEND_UNAVAILABLE: 'PUBLISHED_BINARY_RELEASE_BACKEND_UNAVAILABLE',
  FEATURE_NOT_RELEASED: 'PUBLISHED_BINARY_RELEASE_NOT_RELEASED',
  INVALID_RECEIPT_ID: 'INVALID_RECEIPT_ID',
  INVALID_INPUT: 'INVALID_RELEASE_INPUT',
  INVALID_FILENAME: 'INVALID_DOWNLOAD_FILENAME',
  EVIDENCE_REQUIRED: 'BINARY_RIGHTS_EVIDENCE_REQUIRED',
  CONTRADICTION_UNRESOLVED: 'PRIOR_RIGHTS_CONTRADICTION_UNRESOLVED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  GET_CALL_FAILED: 'PUBLISHED_BINARY_RELEASE_GET_CALL_FAILED',
  GET_RESPONSE_INVALID: 'PUBLISHED_BINARY_RELEASE_GET_RESPONSE_INVALID',
  PUBLISH_RESPONSE_INVALID: 'PUBLISHED_BINARY_RELEASE_PUBLISH_RESPONSE_INVALID',
  PUBLISH_UNCONFIRMED: 'PUBLISH_RESULT_UNCONFIRMED',
} as const);

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;
const ISO_UTC_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const BIDI_OR_INVISIBLE_FORMAT_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;
const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;
const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|blob\s*:|gs:\/\/|library\/quarantine\/|library\/released\/|firebasestorage\.googleapis\.com|firebasestorage\.app|storage\.googleapis\.com|x-goog-signature|\.\.\/|\.\.\\)/i;
const FORBIDDEN_FILENAME_CHARS_REGEX = /[\\/:*?"<>|%$;`]/;

const FORBIDDEN_SECRET_KEYS: ReadonlySet<string> = new Set([
  'sourceSha256',
  'sha256',
  'createdBy',
  'updatedBy',
  'publishedBy',
  'actorUid',
  'storagePath',
  'releasedStoragePath',
  'releasedBucketName',
  'releasedObjectGeneration',
  'quarantineBucket',
  'quarantineObjectPath',
  'bucket',
  'objectPath',
  'generation',
  'signedUrl',
  'downloadUrl',
  'rawBytes',
  'bytes',
  'buffer',
  'token',
]);

export interface SanitizedPublishedLibraryBinaryReleaseDto {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly sourceCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRevision: number;
  readonly status: 'PUBLISHED' | 'REVOKED';
  readonly format: PublishedBinarySourceFormat;
  readonly canonicalMimeType: string;
  readonly byteSize: number;
  readonly deepInspectionStatus:
    | 'PDF_REQUIRES_ISOLATED_PARSER'
    | 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';
  readonly sourceRevision: number;
  readonly alignedHumanCaseRevision: number;
  readonly alignmentRevision: number;
  readonly catalogUpdatedAt: string;
  readonly safetyCaseRevision: number;
  readonly avRequestId: string;
  readonly avExecutionState: 'AV_NO_THREAT_DETECTED';
  readonly avCompletedAt: string;
  readonly avEngineName: 'ClamAV';
  readonly avEngineVersion: string;
  readonly avSignatureVersion: string;
  readonly avSignatureUpdatedAt: string;
  readonly priorRightsDecisionRevision: number | null;
  readonly priorRightsDecision: LibraryQuarantineRightsDecisionStatus | null;
  readonly contradictionResolutionRequired: boolean;
  readonly contradictionResolutionSummary: string;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly publicRightsStatus: PublishedBinaryPublicLibraryRightsStatus;
  readonly binaryRightsBasis: PublishedBinaryRightsBasis;
  readonly rightsEvidenceReference: string;
  readonly rightsEvidenceSummary: string;
  readonly releaseNotes: string;
  readonly downloadFilename: string;
  readonly downloadGatewayUrl: string;
  readonly publishedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly quarantineSourceExposed: false;
  readonly quarantineDraftRemainsDraft: true;
}

export interface SanitizedPublishedBinaryPublicDocumentDto {
  readonly id: string;
  readonly titleAr: string;
  readonly titleEn: string;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly format: PublishedBinarySourceFormat;
  readonly rightsStatus: PublishedBinaryPublicLibraryRightsStatus;
  readonly workflowState: 'Published';
  readonly downloadGatewayUrl: string;
  readonly updatedAt: string;
}

export interface GetPublishedLibraryBinaryReleaseStatusReadyDto {
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
  readonly format: PublishedBinarySourceFormat;
  readonly canonicalMimeType: string;
  readonly byteSize: number;
  readonly deepInspectionStatus:
    | 'PDF_REQUIRES_ISOLATED_PARSER'
    | 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';
  readonly sanitizedFilename: string;
  readonly suggestedDownloadFilename: string;
  readonly sourceRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly currentAlignmentRevision: number;
  readonly catalogUpdatedAt: string;
  readonly catalogAligned: boolean;
  readonly safetyCaseRevision: number | null;
  readonly avRequestId: string | null;
  readonly avExecutionState: string;
  readonly avCompletedAt: string | null;
  readonly isScanCleanForCurrentRevision: boolean;
  readonly requiresContradictionResolution: boolean;
  readonly currentPriorRightsDecisionRevision: number | null;
  readonly currentPriorRightsDecision: LibraryQuarantineRightsDecisionStatus | null;
  readonly currentPriorRightsBasis: LibraryQuarantineRightsBasis | null;
  readonly organizationId: string;
  readonly organizationNameAr: string;
  readonly organizationNameEn: string;
  readonly sourceId: string;
  readonly sourceNameAr: string;
  readonly sourceNameEn: string;
  readonly sourceVerified: boolean;
  readonly catalogTitleAr: string;
  readonly catalogTitleEn: string;
  readonly downloadGatewayUrl: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly quarantineSourceExposed: false;
  readonly releaseRecord: SanitizedPublishedLibraryBinaryReleaseDto | null;
  readonly publicDocument: SanitizedPublishedBinaryPublicDocumentDto | null;
}

export interface GetPublishedLibraryBinaryReleaseStatusHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly quarantineCatalogDocumentId: string | null;
  readonly publicDocumentId: string | null;
  readonly eligibleForPublish: false;
  readonly isPublished: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly quarantineSourceExposed: false;
}

export type GetPublishedLibraryBinaryReleaseStatusResponseDto =
  | GetPublishedLibraryBinaryReleaseStatusReadyDto
  | GetPublishedLibraryBinaryReleaseStatusHoldDto;

export interface PublishQuarantinedBinaryToPublicLibrarySuccessDto {
  readonly ok: true;
  readonly status: 'PUBLISHED' | 'ALREADY_PUBLISHED';
  readonly releaseOutcome: 'PUBLISHED' | 'ALREADY_PUBLISHED';
  readonly publishedChanged: boolean;
  readonly published: true;
  readonly receiptId: string;
  readonly quarantineCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRecord: SanitizedPublishedLibraryBinaryReleaseDto;
  readonly publicDocument: SanitizedPublishedBinaryPublicDocumentDto;
  readonly quarantineDraftRemainsDraft: true;
  readonly quarantineSourceExposed: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
}

export interface PublishQuarantinedBinaryToPublicLibraryConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly releaseOutcome: 'NOT_PUBLISHED' | 'ALREADY_PUBLISHED';
  readonly published: false;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly quarantineCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly currentHumanCaseRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly currentAlignmentRevision: number;
  readonly currentCatalogUpdatedAt: string;
  readonly currentSafetyCaseRevision: number | null;
  readonly currentAvRequestId: string | null;
  readonly currentPriorRightsDecisionRevision: number | null;
  readonly releaseRecord: SanitizedPublishedLibraryBinaryReleaseDto | null;
  readonly publicDocument: SanitizedPublishedBinaryPublicDocumentDto | null;
  readonly quarantineSourceExposed: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
}

export interface PublishQuarantinedBinaryToPublicLibraryHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly releaseOutcome: 'NOT_PUBLISHED';
  readonly published: false;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly quarantineCatalogDocumentId: string | null;
  readonly publicDocumentId: string | null;
  readonly quarantineSourceExposed: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
}

export interface PublishQuarantinedBinaryToPublicLibraryUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly releaseOutcome: 'UNKNOWN';
  readonly published: null;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly quarantineCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly quarantineSourceExposed: false;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
}

export type PublishQuarantinedBinaryToPublicLibraryResponseDto =
  | PublishQuarantinedBinaryToPublicLibrarySuccessDto
  | PublishQuarantinedBinaryToPublicLibraryConflictDto
  | PublishQuarantinedBinaryToPublicLibraryHoldDto
  | PublishQuarantinedBinaryToPublicLibraryUnknownDto;

export interface PublishedBinaryReleaseFormState {
  readonly publicRightsStatus: PublishedBinaryPublicLibraryRightsStatus;
  readonly binaryRightsBasis: PublishedBinaryRightsBasis;
  readonly rightsEvidenceReference: string;
  readonly rightsEvidenceSummary: string;
  readonly releaseNotes: string;
  readonly downloadFilename: string;
  readonly acknowledgePriorRestrictedDecision: boolean;
  readonly contradictionResolutionSummary: string;
}

export interface LibraryQuarantinePublishedBinaryReleasePanelSnapshot {
  readonly enabled: boolean;
  readonly activeReceiptId: string | null;
  readonly loading: boolean;
  readonly publishing: boolean;
  readonly readinessStatus: GetPublishedLibraryBinaryReleaseStatusReadyDto | null;
  readonly holdCode: string | null;
  readonly holdMessage: string | null;
  readonly form: PublishedBinaryReleaseFormState;
  readonly confirmed: boolean;
  readonly loadError: string | null;
  readonly publishError: string | null;
  readonly lastOutcome: 'PUBLISHED' | 'ALREADY_PUBLISHED' | null;
  readonly conflictState: PublishQuarantinedBinaryToPublicLibraryConflictDto | null;
  readonly uncertainState: PublishQuarantinedBinaryToPublicLibraryUnknownDto | null;
}

function readClientEnvFlag(
  key: string,
  envOverride?: Record<string, unknown>
): string | undefined {
  if (envOverride && Object.prototype.hasOwnProperty.call(envOverride, key)) {
    const val = envOverride[key];
    return typeof val === 'string' ? val : String(val);
  }
  const viteEnv =
    typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { readonly env?: Record<string, unknown> }).env
      ? (import.meta as unknown as { readonly env: Record<string, unknown> }).env
      : undefined;
  if (viteEnv && Object.prototype.hasOwnProperty.call(viteEnv, key)) {
    const val = viteEnv[key];
    return typeof val === 'string' ? val : String(val);
  }
  if (typeof process !== 'undefined' && process.env && key in process.env) {
    return process.env[key];
  }
  return undefined;
}

export function isLibraryQuarantinePublishedBinaryReleaseEnabled(
  envOverride?: Record<string, unknown>
): boolean {
  return (
    isLibraryQuarantineReviewWorkbenchEnabled(envOverride) &&
    isLibraryQuarantineHumanReviewEnabled(envOverride) &&
    isLibraryQuarantineCatalogHandoffEnabled(envOverride) &&
    isLibraryQuarantineRightsDecisionEnabled(envOverride) &&
    isLibraryQuarantineBinarySafetyCaseEnabled(envOverride) &&
    isLibraryQuarantineIsolatedInspectionRequestEnabled(envOverride) &&
    readClientEnvFlag(
      LIBRARY_PUBLISHED_BINARY_RELEASE_UI_ENV_VAR,
      envOverride
    ) === 'true'
  );
}

export function canUserPublishQuarantinedBinaryToPublicLibrary(
  user: AdminUser | null | undefined
): boolean {
  if (!user || !user.isActive || user.role === AdminRole.AIAssistant) {
    return false;
  }
  if (!hasDomainResponsibility(user.role, AdminDomain.Library)) {
    return false;
  }
  const hasRolePermissions =
    AdminAccessService.hasPermission(user, AdminPermission.Review) &&
    AdminAccessService.hasPermission(user, AdminPermission.ManageRights) &&
    AdminAccessService.hasPermission(user, AdminPermission.Approve) &&
    AdminAccessService.hasPermission(user, AdminPermission.Publish);
  if (!hasRolePermissions) {
    return false;
  }
  const explicitPermissions = (user as { readonly permissions?: unknown })
    .permissions;
  if (
    Array.isArray(explicitPermissions) &&
    ![
      AdminPermission.Review,
      AdminPermission.ManageRights,
      AdminPermission.Approve,
      AdminPermission.Publish,
    ].every((perm) => explicitPermissions.includes(perm))
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
  return proto === Object.prototype || proto === null;
}

function assertNoForbiddenSecretLeak(value: unknown, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenSecretLeak(item, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_SECRET_KEYS.has(k)) {
        throw new Error(`FORBIDDEN_SECRET_FIELD_LEAK:${k}`);
      }
      if (
        typeof v === 'string' &&
        (v.includes('gs://') ||
          v.includes('library/quarantine/') ||
          v.includes('library/released/') ||
          v.includes('X-Goog-Signature') ||
          v.includes('firebaseStorageDownloadTokens'))
      ) {
        throw new Error(`FORBIDDEN_SECRET_VALUE_LEAK:${k}`);
      }
      assertNoForbiddenSecretLeak(v, depth + 1);
    }
  }
}

export function isOwnedPublishedBinaryDownloadUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed !== rawUrl || /\s/.test(trimmed)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    host.endsWith('storage.googleapis.com') ||
    host.endsWith('firebasestorage.googleapis.com') ||
    host.endsWith('firebasestorage.app') ||
    !parsed.pathname.endsWith('/libraryPublishedBinaryDownload')
  ) {
    return false;
  }
  const params = Array.from(parsed.searchParams.keys());
  const docId = parsed.searchParams.get('documentId');
  return (
    params.length === 1 &&
    params[0] === 'documentId' &&
    typeof docId === 'string' &&
    PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_REGEX.test(docId)
  );
}

export function isPublishedBinaryPublicDocumentId(
  documentId: unknown
): documentId is string {
  return (
    typeof documentId === 'string' &&
    PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_REGEX.test(documentId)
  );
}

export function detectPublishedBinaryFormat(
  doc: PublicLibraryDocument
): PublishedBinarySourceFormat | null {
  if (!isPublishedBinaryPublicDocumentId(doc.id)) {
    return null;
  }
  for (const v of doc.versions || []) {
    const desc =
      `${v.changeDescriptionEn || ''} ${v.changeDescriptionAr || ''}`.toUpperCase();
    if (desc.includes('DOCX') || desc.includes('WORD')) {
      return 'DOCX';
    }
    if (desc.includes('PDF')) {
      return 'PDF';
    }
  }
  return 'PDF';
}

export function getOwnedPublishedBinaryDownloadUrl(
  doc: PublicLibraryDocument
): string | null {
  if (!isPublishedBinaryPublicDocumentId(doc.id)) {
    return null;
  }
  if (
    doc.rightsStatus !== LibraryRightsStatus.OpenPubliclyAvailable &&
    doc.rightsStatus !== LibraryRightsStatus.PermissionGranted
  ) {
    return null;
  }
  for (const v of doc.versions || []) {
    if (isOwnedPublishedBinaryDownloadUrl(v.referenceUrl)) {
      const urlDocId = new URL(v.referenceUrl).searchParams.get('documentId');
      if (urlDocId === doc.id) {
        return v.referenceUrl;
      }
    }
  }
  return null;
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

export function validateClientBinaryDownloadFilename(
  rawFilename: string,
  format: PublishedBinarySourceFormat
): string {
  const trimmed = rawFilename.normalize('NFC').trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > BINARY_DOWNLOAD_FILENAME_MAX_LENGTH ||
    hasForbiddenControlOrBidiChar(trimmed, false) ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    FORBIDDEN_FILENAME_CHARS_REGEX.test(trimmed)
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_FILENAME);
  }
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_FILENAME);
  }
  const expectedExt = format === 'PDF' ? '.pdf' : '.docx';
  const wrongExt = format === 'PDF' ? '.docx' : '.pdf';
  if (lower.endsWith(wrongExt)) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_FILENAME);
  }
  const stem = lower.endsWith(expectedExt)
    ? trimmed.slice(0, trimmed.length - expectedExt.length)
    : trimmed;
  const cleanedStem = stem.replace(/[.\s]+$/g, '').trim();
  if (cleanedStem.length === 0 || cleanedStem.startsWith('.')) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_FILENAME);
  }
  return `${cleanedStem}${expectedExt}`;
}

export function validateClientPublishedBinaryEditorialForm(
  form: PublishedBinaryReleaseFormState,
  format: PublishedBinarySourceFormat,
  requiresContradictionResolution: boolean
): PublishedBinaryReleaseFormState {
  if (
    form.publicRightsStatus !== 'OpenPubliclyAvailable' &&
    form.publicRightsStatus !== 'PermissionGranted'
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_INPUT);
  }
  if (
    !(PUBLISHED_BINARY_RIGHTS_BASES as readonly string[]).includes(
      form.binaryRightsBasis
    )
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_INPUT);
  }

  const ref = form.rightsEvidenceReference.normalize('NFC').trim();
  const summary = form.rightsEvidenceSummary
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();
  const notes = form.releaseNotes
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();
  const resolution = form.contradictionResolutionSummary
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();

  if (
    ref.length < 3 ||
    ref.length > BINARY_RELEASE_EVIDENCE_REFERENCE_MAX_LENGTH ||
    summary.length < 10 ||
    summary.length > BINARY_RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH ||
    hasForbiddenControlOrBidiChar(ref, false) ||
    hasForbiddenControlOrBidiChar(summary, true) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(ref) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(summary) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(ref) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(summary)
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.EVIDENCE_REQUIRED);
  }

  const lowerSummary = summary.toLowerCase();
  if (
    (lowerSummary.includes('catalog_metadata_only') ||
      lowerSummary.includes('metadata_use_cleared')) &&
    !lowerSummary.includes('binary') &&
    !lowerSummary.includes('pdf') &&
    !lowerSummary.includes('docx') &&
    !lowerSummary.includes('redistribution')
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.EVIDENCE_REQUIRED);
  }

  if (
    notes.length > BINARY_RELEASE_NOTES_MAX_LENGTH ||
    hasForbiddenControlOrBidiChar(notes, true) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(notes) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(notes)
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_INPUT);
  }

  const downloadFilename = validateClientBinaryDownloadFilename(
    form.downloadFilename,
    format
  );

  if (requiresContradictionResolution) {
    if (
      !form.acknowledgePriorRestrictedDecision ||
      resolution.length < 10 ||
      resolution.length > BINARY_RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH ||
      hasForbiddenControlOrBidiChar(resolution, true) ||
      HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(resolution) ||
      FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(resolution)
    ) {
      throw new Error(
        PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.CONTRADICTION_UNRESOLVED
      );
    }
  }

  return Object.freeze({
    publicRightsStatus: form.publicRightsStatus,
    binaryRightsBasis: form.binaryRightsBasis,
    rightsEvidenceReference: ref,
    rightsEvidenceSummary: summary,
    releaseNotes: notes,
    downloadFilename,
    acknowledgePriorRestrictedDecision:
      requiresContradictionResolution &&
      form.acknowledgePriorRestrictedDecision,
    contradictionResolutionSummary: resolution,
  });
}

function validateSanitizedReleaseRecordDto(
  raw: unknown,
  expectedReceiptId: string
): SanitizedPublishedLibraryBinaryReleaseDto {
  if (!isPlainRecord(raw)) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.GET_RESPONSE_INVALID);
  }
  assertNoForbiddenSecretLeak(raw);
  if (
    raw.schemaVersion !== LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION ||
    raw.receiptId !== expectedReceiptId ||
    raw.sourceCatalogDocumentId !==
      deriveQuarantineCatalogDocumentId(expectedReceiptId) ||
    raw.publicDocumentId !==
      `${PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_PREFIX}${expectedReceiptId}` ||
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.quarantineSourceExposed !== false ||
    raw.quarantineDraftRemainsDraft !== true ||
    !isOwnedPublishedBinaryDownloadUrl(raw.downloadGatewayUrl)
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.GET_RESPONSE_INVALID);
  }
  return raw as unknown as SanitizedPublishedLibraryBinaryReleaseDto;
}

function validateSanitizedPublicDocumentDto(
  raw: unknown,
  expectedReceiptId: string
): SanitizedPublishedBinaryPublicDocumentDto {
  if (!isPlainRecord(raw)) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.GET_RESPONSE_INVALID);
  }
  assertNoForbiddenSecretLeak(raw);
  if (
    raw.id !== `${PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_PREFIX}${expectedReceiptId}` ||
    raw.workflowState !== 'Published' ||
    !isOwnedPublishedBinaryDownloadUrl(raw.downloadGatewayUrl) ||
    (raw.rightsStatus !== 'OpenPubliclyAvailable' &&
      raw.rightsStatus !== 'PermissionGranted') ||
    typeof raw.updatedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.updatedAt)
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.GET_RESPONSE_INVALID);
  }
  return raw as unknown as SanitizedPublishedBinaryPublicDocumentDto;
}

function validateGetResponse(
  raw: unknown,
  expectedReceiptId: string
): GetPublishedLibraryBinaryReleaseStatusResponseDto {
  if (!isPlainRecord(raw)) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.GET_RESPONSE_INVALID);
  }
  assertNoForbiddenSecretLeak(raw);
  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.quarantineSourceExposed !== false
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.GET_RESPONSE_INVALID);
  }

  if (raw.ok === false && raw.status === 'HOLD') {
    return Object.freeze({
      ok: false,
      status: 'HOLD',
      errorCode: String(raw.errorCode || 'HOLD'),
      errorMessage: String(raw.errorMessage || 'Held'),
      receiptId: typeof raw.receiptId === 'string' ? raw.receiptId : null,
      quarantineCatalogDocumentId:
        typeof raw.quarantineCatalogDocumentId === 'string'
          ? raw.quarantineCatalogDocumentId
          : null,
      publicDocumentId:
        typeof raw.publicDocumentId === 'string' ? raw.publicDocumentId : null,
      eligibleForPublish: false,
      isPublished: false,
      isSanitized: false,
      isVerifiedSafe: false,
      quarantineSourceExposed: false,
    });
  }

  if (
    raw.ok !== true ||
    raw.status !== 'READY' ||
    raw.receiptId !== expectedReceiptId ||
    raw.quarantineCatalogDocumentId !==
      deriveQuarantineCatalogDocumentId(expectedReceiptId) ||
    raw.publicDocumentId !==
      `${PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_PREFIX}${expectedReceiptId}` ||
    raw.quarantineDraftWorkflowState !== 'Draft' ||
    !isOwnedPublishedBinaryDownloadUrl(raw.downloadGatewayUrl) ||
    typeof raw.eligibleForPublish !== 'boolean' ||
    typeof raw.isPublished !== 'boolean' ||
    typeof raw.isScanCleanForCurrentRevision !== 'boolean' ||
    typeof raw.requiresContradictionResolution !== 'boolean' ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !ISO_UTC_TIMESTAMP_REGEX.test(raw.catalogUpdatedAt)
  ) {
    throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.GET_RESPONSE_INVALID);
  }

  const releaseRecord =
    raw.releaseRecord !== null
      ? validateSanitizedReleaseRecordDto(raw.releaseRecord, expectedReceiptId)
      : null;
  const publicDocument =
    raw.publicDocument !== null
      ? validateSanitizedPublicDocumentDto(raw.publicDocument, expectedReceiptId)
      : null;

  return Object.freeze({
    ...(raw as unknown as GetPublishedLibraryBinaryReleaseStatusReadyDto),
    releaseRecord,
    publicDocument,
  });
}

function validatePublishResponse(
  raw: unknown,
  expectedReceiptId: string
): PublishQuarantinedBinaryToPublicLibraryResponseDto {
  if (!isPlainRecord(raw)) {
    throw new Error(
      PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.PUBLISH_RESPONSE_INVALID
    );
  }
  assertNoForbiddenSecretLeak(raw);
  if (
    raw.quarantineSourceExposed !== false ||
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false
  ) {
    throw new Error(
      PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.PUBLISH_RESPONSE_INVALID
    );
  }

  if (raw.ok === true && raw.published === true) {
    const releaseRecord = validateSanitizedReleaseRecordDto(
      raw.releaseRecord,
      expectedReceiptId
    );
    const publicDocument = validateSanitizedPublicDocumentDto(
      raw.publicDocument,
      expectedReceiptId
    );
    if (
      raw.quarantineDraftRemainsDraft !== true ||
      (raw.status !== 'PUBLISHED' && raw.status !== 'ALREADY_PUBLISHED')
    ) {
      throw new Error(
        PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.PUBLISH_RESPONSE_INVALID
      );
    }
    return Object.freeze({
      ok: true,
      status: raw.status,
      releaseOutcome: raw.status,
      publishedChanged: Boolean(raw.publishedChanged),
      published: true,
      receiptId: expectedReceiptId,
      quarantineCatalogDocumentId:
        deriveQuarantineCatalogDocumentId(expectedReceiptId),
      publicDocumentId: `${PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_PREFIX}${expectedReceiptId}`,
      releaseRecord,
      publicDocument,
      quarantineDraftRemainsDraft: true,
      quarantineSourceExposed: false,
      isSanitized: false,
      isVerifiedSafe: false,
    });
  }

  if (raw.ok === false && raw.status === 'CONFLICT') {
    return raw as unknown as PublishQuarantinedBinaryToPublicLibraryConflictDto;
  }

  if (raw.ok === false && raw.status === 'UNKNOWN' && raw.published === null) {
    return raw as unknown as PublishQuarantinedBinaryToPublicLibraryUnknownDto;
  }

  if (raw.ok === false && raw.status === 'HOLD' && raw.published === false) {
    return raw as unknown as PublishQuarantinedBinaryToPublicLibraryHoldDto;
  }

  throw new Error(
    PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.PUBLISH_RESPONSE_INVALID
  );
}

export function isPublishedBinaryReleaseNotReleasedError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    code === 'functions/failed-precondition' ||
    code === 'failed-precondition' ||
    msg.includes('PUBLISHED_BINARY_RELEASE_NOT_RELEASED') ||
    msg.includes('PUBLISHED_BINARY_RELEASE_BACKEND_UNAVAILABLE')
  );
}

export interface LibraryQuarantinePublishedBinaryReleaseClientApi {
  getPublishedLibraryBinaryReleaseStatus(
    receiptId: string
  ): Promise<GetPublishedLibraryBinaryReleaseStatusResponseDto>;
  publishQuarantinedBinaryToPublicLibrary(input: {
    readonly receiptId: string;
    readonly expectedHumanCaseRevision: number;
    readonly expectedCatalogUpdatedAt: string;
    readonly expectedAlignmentRevision: number;
    readonly expectedSafetyCaseRevision: number;
    readonly expectedAvRequestId: string;
    readonly expectedPriorRightsDecisionRevision?: number | null;
    readonly confirmation: typeof LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL;
    readonly input: {
      readonly publicRightsStatus: PublishedBinaryPublicLibraryRightsStatus;
      readonly binaryRightsBasis: PublishedBinaryRightsBasis;
      readonly rightsEvidenceReference: string;
      readonly rightsEvidenceSummary: string;
      readonly releaseNotes?: string;
      readonly downloadFilename?: string;
      readonly acknowledgePriorRestrictedDecision?: boolean;
      readonly contradictionResolutionSummary?: string;
    };
  }): Promise<PublishQuarantinedBinaryToPublicLibraryResponseDto>;
}

export const LibraryQuarantinePublishedBinaryReleaseClient: LibraryQuarantinePublishedBinaryReleaseClientApi =
  {
    async getPublishedLibraryBinaryReleaseStatus(
      receiptId: string
    ): Promise<GetPublishedLibraryBinaryReleaseStatusResponseDto> {
      if (!QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)) {
        throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
      }
      if (!isFirebaseConfigured || !app) {
        throw new Error(
          PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE
        );
      }
      const fns = getFunctions(app);
      const callable = httpsCallable<
        { action: 'getPublishedLibraryBinaryReleaseStatus'; receiptId: string },
        unknown
      >(fns, 'manageLibraryDocuments');
      const res = await callable({
        action: 'getPublishedLibraryBinaryReleaseStatus',
        receiptId,
      });
      return validateGetResponse(res.data, receiptId);
    },

    async publishQuarantinedBinaryToPublicLibrary(input) {
      if (!QUARANTINE_RECEIPT_ID_REGEX.test(input.receiptId)) {
        throw new Error(PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID);
      }
      if (!isFirebaseConfigured || !app) {
        throw new Error(
          PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE
        );
      }
      const fns = getFunctions(app);
      const callable = httpsCallable<
        Record<string, unknown>,
        unknown
      >(fns, 'manageLibraryDocuments');
      const res = await callable({
        action: 'publishQuarantinedBinaryToPublicLibrary',
        receiptId: input.receiptId,
        expectedHumanCaseRevision: input.expectedHumanCaseRevision,
        expectedCatalogUpdatedAt: input.expectedCatalogUpdatedAt,
        expectedAlignmentRevision: input.expectedAlignmentRevision,
        expectedSafetyCaseRevision: input.expectedSafetyCaseRevision,
        expectedAvRequestId: input.expectedAvRequestId,
        ...(input.expectedPriorRightsDecisionRevision !== undefined
          ? {
              expectedPriorRightsDecisionRevision:
                input.expectedPriorRightsDecisionRevision,
            }
          : {}),
        confirmation: input.confirmation,
        input: input.input,
      });
      return validatePublishResponse(res.data, input.receiptId);
    },
  };

export function createDefaultPublishedBinaryReleaseForm(): PublishedBinaryReleaseFormState {
  return Object.freeze({
    publicRightsStatus: 'PermissionGranted',
    binaryRightsBasis: 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION',
    rightsEvidenceReference: '',
    rightsEvidenceSummary: '',
    releaseNotes: '',
    downloadFilename: '',
    acknowledgePriorRestrictedDecision: false,
    contradictionResolutionSummary: '',
  });
}

export class LibraryQuarantinePublishedBinaryReleasePanelController {
  private readonly listeners = new Set<
    (snap: LibraryQuarantinePublishedBinaryReleasePanelSnapshot) => void
  >();
  private currentUser: AdminUser | null;
  private readonly api: LibraryQuarantinePublishedBinaryReleaseClientApi;
  private state: LibraryQuarantinePublishedBinaryReleasePanelSnapshot;
  private sessionSeq = 0;

  constructor(
    initialUser: AdminUser | null,
    options?: {
      readonly enabled?: boolean;
      readonly api?: LibraryQuarantinePublishedBinaryReleaseClientApi;
    }
  ) {
    this.currentUser = initialUser ?? null;
    this.api = options?.api ?? LibraryQuarantinePublishedBinaryReleaseClient;
    this.state = Object.freeze({
      enabled: options?.enabled ?? isLibraryQuarantinePublishedBinaryReleaseEnabled(),
      activeReceiptId: null,
      loading: false,
      publishing: false,
      readinessStatus: null,
      holdCode: null,
      holdMessage: null,
      form: createDefaultPublishedBinaryReleaseForm(),
      confirmed: false,
      loadError: null,
      publishError: null,
      lastOutcome: null,
      conflictState: null,
      uncertainState: null,
    });
  }

  public getSnapshot(): LibraryQuarantinePublishedBinaryReleasePanelSnapshot {
    return this.state;
  }

  public subscribe(
    listener: (snap: LibraryQuarantinePublishedBinaryReleasePanelSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(
    partial: Partial<LibraryQuarantinePublishedBinaryReleasePanelSnapshot>
  ): void {
    this.state = Object.freeze({
      ...this.state,
      ...partial,
    });
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public setCurrentUser(user: AdminUser | null): void {
    this.currentUser = user ?? null;
    if (!canUserPublishQuarantinedBinaryToPublicLibrary(this.currentUser)) {
      this.resetPanel();
    }
  }

  public resetPanel(): void {
    this.sessionSeq += 1;
    this.setState({
      activeReceiptId: null,
      loading: false,
      publishing: false,
      readinessStatus: null,
      holdCode: null,
      holdMessage: null,
      form: createDefaultPublishedBinaryReleaseForm(),
      confirmed: false,
      loadError: null,
      publishError: null,
      lastOutcome: null,
      conflictState: null,
      uncertainState: null,
    });
  }

  public updateFormField<K extends keyof PublishedBinaryReleaseFormState>(
    field: K,
    value: PublishedBinaryReleaseFormState[K]
  ): void {
    this.setState({
      form: Object.freeze({
        ...this.state.form,
        [field]: value,
      }),
      publishError: null,
    });
  }

  public setConfirmed(confirmed: boolean): void {
    this.setState({
      confirmed,
      publishError: null,
    });
  }

  public async openForSavedCase(
    savedCase: SanitizedLibraryQuarantineHumanReviewCaseDto
  ): Promise<GetPublishedLibraryBinaryReleaseStatusResponseDto | null> {
    if (
      !this.state.enabled ||
      !canUserPublishQuarantinedBinaryToPublicLibrary(this.currentUser) ||
      savedCase.status !== 'METADATA_RECORDED'
    ) {
      return null;
    }
    this.setState({
      activeReceiptId: savedCase.receiptId,
    });
    return this.executeLoad(savedCase.receiptId);
  }

  public async reloadStatus(): Promise<GetPublishedLibraryBinaryReleaseStatusResponseDto | null> {
    if (!this.state.activeReceiptId) {
      return null;
    }
    return this.executeLoad(this.state.activeReceiptId);
  }

  public async verifyUncertainPublish(): Promise<GetPublishedLibraryBinaryReleaseStatusResponseDto | null> {
    return this.reloadStatus();
  }

  private async executeLoad(
    receiptId: string
  ): Promise<GetPublishedLibraryBinaryReleaseStatusResponseDto | null> {
    const seq = ++this.sessionSeq;
    const expectedUid = this.currentUser?.id ?? null;

    this.setState({
      loading: true,
      loadError: null,
      holdCode: null,
      holdMessage: null,
      conflictState: null,
      uncertainState: null,
    });

    try {
      const response = await this.api.getPublishedLibraryBinaryReleaseStatus(
        receiptId
      );
      if (
        this.sessionSeq !== seq ||
        (this.currentUser?.id ?? null) !== expectedUid
      ) {
        return null;
      }

      if (!response.ok) {
        this.setState({
          loading: false,
          readinessStatus: null,
          holdCode: response.errorCode,
          holdMessage: response.errorMessage,
        });
        return response;
      }

      const nextFilename =
        this.state.form.downloadFilename.trim().length > 0 &&
        this.state.activeReceiptId === receiptId
          ? this.state.form.downloadFilename
          : response.suggestedDownloadFilename;

      this.setState({
        loading: false,
        readinessStatus: response,
        holdCode: response.blockCode,
        holdMessage: response.blockMessage,
        form: Object.freeze({
          ...this.state.form,
          downloadFilename: nextFilename,
        }),
      });
      return response;
    } catch (err: unknown) {
      if (this.sessionSeq !== seq) {
        return null;
      }
      if (isPublishedBinaryReleaseNotReleasedError(err)) {
        this.setState({
          loading: false,
          enabled: false,
          loadError: PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
        });
        return null;
      }
      this.setState({
        loading: false,
        loadError:
          err instanceof Error
            ? err.message
            : PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.GET_CALL_FAILED,
      });
      return null;
    }
  }

  public async publish(): Promise<PublishQuarantinedBinaryToPublicLibraryResponseDto | null> {
    const status = this.state.readinessStatus;
    if (
      !this.state.enabled ||
      !status ||
      !status.eligibleForPublish ||
      this.state.loading ||
      this.state.publishing ||
      this.state.uncertainState !== null ||
      !this.state.confirmed ||
      !status.safetyCaseRevision ||
      !status.avRequestId
    ) {
      return null;
    }

    if (!canUserPublishQuarantinedBinaryToPublicLibrary(this.currentUser)) {
      this.resetPanel();
      return null;
    }

    let validatedForm: PublishedBinaryReleaseFormState;
    try {
      validatedForm = validateClientPublishedBinaryEditorialForm(
        this.state.form,
        status.format,
        status.requiresContradictionResolution
      );
    } catch (valErr: unknown) {
      this.setState({
        publishError:
          valErr instanceof Error
            ? valErr.message
            : PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.INVALID_INPUT,
      });
      return null;
    }

    const seq = ++this.sessionSeq;
    const expectedUid = this.currentUser?.id ?? null;
    const receiptId = status.receiptId;

    this.setState({
      publishing: true,
      publishError: null,
      conflictState: null,
      uncertainState: null,
    });

    try {
      const response =
        await this.api.publishQuarantinedBinaryToPublicLibrary({
          receiptId,
          expectedHumanCaseRevision: status.currentHumanCaseRevision,
          expectedCatalogUpdatedAt: status.catalogUpdatedAt,
          expectedAlignmentRevision: status.currentAlignmentRevision,
          expectedSafetyCaseRevision: status.safetyCaseRevision,
          expectedAvRequestId: status.avRequestId,
          expectedPriorRightsDecisionRevision:
            status.currentPriorRightsDecisionRevision,
          confirmation: LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
          input: {
            publicRightsStatus: validatedForm.publicRightsStatus,
            binaryRightsBasis: validatedForm.binaryRightsBasis,
            rightsEvidenceReference: validatedForm.rightsEvidenceReference,
            rightsEvidenceSummary: validatedForm.rightsEvidenceSummary,
            releaseNotes: validatedForm.releaseNotes,
            downloadFilename: validatedForm.downloadFilename,
            ...(status.requiresContradictionResolution
              ? {
                  acknowledgePriorRestrictedDecision: true,
                  contradictionResolutionSummary:
                    validatedForm.contradictionResolutionSummary,
                }
              : {}),
          },
        });

      if (
        this.sessionSeq !== seq ||
        (this.currentUser?.id ?? null) !== expectedUid
      ) {
        return null;
      }

      if (response.ok && response.published) {
        this.setState({
          publishing: false,
          confirmed: false,
          lastOutcome: response.releaseOutcome,
          readinessStatus: Object.freeze({
            ...status,
            isPublished: true,
            releaseRecord: response.releaseRecord,
            publicDocument: response.publicDocument,
          }),
        });
        return response;
      }

      if (!response.ok && response.status === 'CONFLICT') {
        this.setState({
          publishing: false,
          conflictState: response,
        });
        return response;
      }

      if (!response.ok && response.status === 'UNKNOWN') {
        this.setState({
          publishing: false,
          uncertainState: response,
        });
        return response;
      }

      this.setState({
        publishing: false,
        publishError: `${response.errorCode}: ${response.errorMessage}`,
      });
      return response;
    } catch (err: unknown) {
      if (this.sessionSeq !== seq) {
        return null;
      }
      this.setState({
        publishing: false,
        uncertainState: Object.freeze({
          ok: false,
          status: 'UNKNOWN',
          releaseOutcome: 'UNKNOWN',
          published: null,
          errorCode: PUBLISHED_BINARY_CLIENT_SAFE_ERRORS.PUBLISH_UNCONFIRMED,
          errorMessage:
            err instanceof Error
              ? err.message
              : 'Binary publication call result could not be confirmed.',
          receiptId,
          quarantineCatalogDocumentId: status.quarantineCatalogDocumentId,
          publicDocumentId: status.publicDocumentId,
          quarantineSourceExposed: false,
          isSanitized: false,
          isVerifiedSafe: false,
        }),
      });
      return null;
    }
  }
}

export const _QUARANTINE_CATALOG_ID_PREFIX_USED =
  QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX;
