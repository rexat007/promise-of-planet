import type { AdminRepository } from '../admin/adminRepository';
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
  LibraryRightsStatus,
  type LibraryDocument,
  type LibraryOrganization,
  type LibrarySource,
} from '../shared/libraryContract';
import {
  WorkflowAction,
  WorkflowState,
  type WorkflowTransitionRecord,
} from '../shared/workflowContract';
import { LibraryValidator } from './libraryValidator';
import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
  type LibraryQuarantinePersistedReviewDraft,
  type LibraryQuarantineReviewDraftFirestoreDatabase,
  type LibraryQuarantineReviewDraftFirestoreTransaction,
} from './firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
  verifyReceiptAndDraftEligibleForHumanReviewCase,
  type LibraryQuarantineFirestoreDocumentData,
  type LibraryQuarantineHumanReviewCaseErrorCode,
} from './firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  validatePersistedLibraryQuarantineHumanReviewCase,
  type LibraryQuarantinePersistedHumanReviewCase,
} from './libraryQuarantineHumanReviewCaseContract';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_ORGANIZATIONS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  LIBRARY_SOURCES_COLLECTION,
  deriveQuarantineCatalogDocumentId,
  validatePersistedCatalogDraftDocument,
  validatePersistedLibraryQuarantineCatalogHandoff,
  type LibraryQuarantinePersistedCatalogHandoff,
  type SanitizedLibraryQuarantineCatalogDocumentDto,
} from './libraryQuarantineCatalogHandoffService';
import {
  LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
} from './firestoreLibraryQuarantineRightsDecisionStore';
import {
  LIBRARY_QUARANTINE_RIGHTS_SCOPE,
  type LibraryQuarantinePersistedRightsDecision,
  type LibraryQuarantineRightsBasis,
  type LibraryQuarantineRightsDecisionStatus,
} from './libraryQuarantineRightsDecisionContract';
import {
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
  computeLibraryQuarantineCatalogCaseFourFieldDiff,
  validateAlignmentAwarePersistedRightsDecision,
  validatePersistedLibraryQuarantineCatalogCaseAlignment,
  type LibraryQuarantinePersistedCatalogCaseAlignment,
} from './libraryQuarantineCatalogCaseAlignmentService';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import type {
  TrustedQuarantineAuthenticatedPrincipal,
  TrustedQuarantineReviewerPrincipalProvider,
} from './libraryQuarantineReviewDraftPersistenceService';

/**
 * LIB-PUBLISH-01 — Reviewed External Source Release Service
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Enables an active, authorized human Library administrator holding ALL FOUR
 *   permissions (`Review`, `ManageRights`, `Approve`, `Publish`) in Library
 *   domain to publish a reviewed, source-linked regular public `LibraryDocument`
 *   with deterministic ID `doc-qsrc-<receiptId>` (never `qcat-`).
 * - Strictly refuses to copy, expose, proxy, download, or publicly serve
 *   quarantined PDF/DOCX binary bytes, GCS quarantine paths (`library/quarantine/`,
 *   `gs://`), signed URLs, download tokens, `sourceSha256`, or internal actor UIDs.
 * - Keeps the internal `qcat-<receiptId>` draft untouched in `WorkflowState.Draft`,
 *   alongside all quarantine receipts, review drafts, human review cases,
 *   catalog handoffs, alignment overlays, and catalog-metadata rights decisions.
 * - Persists an immutable release provenance record in
 *   `library_reviewed_source_releases/<receiptId>` and append-only audit event
 *   in `library_reviewed_source_release_events/<receiptId>_1` inside a single
 *   atomic Firestore transaction alongside `library_documents/doc-qsrc-<receiptId>`.
 * - Fails closed (`HOLD`) unless the entire quarantine -> case -> handoff ->
 *   alignment -> verified source -> non-stale `METADATA_USE_CLEARED` rights chain
 *   is consistent AND explicit full-text public-link authorization + verified
 *   external publisher `https://` URL are provided.
 * - `RESTRICTED`, `NOT_PERMITTED`, `EVIDENCE_PENDING`, and `PERMISSION_REQUIRED`
 *   rights decisions are NEVER authorized for public linking or release.
 */

export const LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION = 1 as const;

export const LIBRARY_REVIEWED_SOURCE_RELEASES_COLLECTION =
  'library_reviewed_source_releases' as const;

export const LIBRARY_REVIEWED_SOURCE_RELEASE_EVENTS_COLLECTION =
  'library_reviewed_source_release_events' as const;

export const LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL =
  'CONFIRM_PUBLISH_REVIEWED_SOURCE_REFERENCE' as const;

export const REVIEWED_PUBLIC_LIBRARY_DOCUMENT_ID_PREFIX = 'doc-qsrc-' as const;
export const REVIEWED_PUBLIC_LIBRARY_DOCUMENT_ID_REGEX =
  /^doc-qsrc-[0-9a-f]{32}$/;

export const REVIEWED_PUBLIC_RIGHTS_STATUSES = Object.freeze([
  LibraryRightsStatus.OpenPubliclyAvailable,
  LibraryRightsStatus.PermissionGranted,
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

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

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

const ALLOWED_GET_INPUT_KEYS: ReadonlySet<string> = new Set(['receiptId']);

const ALLOWED_PUBLISH_REQUEST_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedHumanCaseRevision',
  'expectedCatalogUpdatedAt',
  'expectedAlignmentRevision',
  'expectedRightsDecisionRevision',
  'confirmation',
  'input',
]);

const ALLOWED_PUBLISH_INPUT_KEYS: ReadonlySet<string> = new Set([
  'publicRightsStatus',
  'publicLinkBasis',
  'verifiedSourceUrl',
  'rightsEvidenceReference',
  'rightsEvidenceSummary',
  'releaseNotes',
]);

const ALLOWED_PRINCIPAL_KEYS: ReadonlySet<string> = new Set(['uid', 'token']);

const FORBIDDEN_TOKEN_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'isAuthorized',
  'authorized',
  'bypassAuth',
  'bypassRbac',
  'adminOverride',
  'overrideRole',
  'permissions',
  'isSuperAdmin',
  'forceAllow',
  'forceAuthorize',
  'allow',
  'adminUser',
  'createdBy',
  'updatedBy',
  'storagePath',
  'generation',
  'url',
  'signedUrl',
  'downloadUrl',
  'bytes',
  'rawBytes',
  'buffer',
]);

const ALLOWED_WRITE_COLLECTIONS: ReadonlySet<string> = new Set([
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_REVIEWED_SOURCE_RELEASES_COLLECTION,
  LIBRARY_REVIEWED_SOURCE_RELEASE_EVENTS_COLLECTION,
]);

const PERSISTED_RELEASE_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'sourceCatalogDocumentId',
  'publicDocumentId',
  'releaseRevision',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'draftSourceRevision',
  'catalogHandoffCaseRevision',
  'alignedHumanCaseRevision',
  'alignedHumanCaseUpdatedAt',
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
  'publishedBy',
  'publishedAt',
  'quarantineBinaryExposed',
  'quarantineDraftRemainsDraft',
]);

export type ReviewedLibrarySourceReleaseErrorCode =
  | LibraryQuarantineHumanReviewCaseErrorCode
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED_RELEASE_ACTOR'
  | 'INVALID_RECEIPT_ID'
  | 'INVALID_RELEASE_PAYLOAD'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_VERIFIED_SOURCE_URL'
  | 'INVALID_PUBLIC_RIGHTS_STATUS'
  | 'INVALID_PUBLIC_LINK_BASIS'
  | 'PUBLIC_RIGHTS_EVIDENCE_REQUIRED'
  | 'INVALID_PLAIN_TEXT_FIELD'
  | 'QUARANTINE_RECEIPT_NOT_FOUND'
  | 'RECEIPT_NEEDS_RECONCILIATION'
  | 'UNSUPPORTED_RECEIPT_STATE'
  | 'REVIEW_DRAFT_NOT_FOUND'
  | 'INVALID_REVIEW_DRAFT'
  | 'DRAFT_SOURCE_MISMATCH'
  | 'DRAFT_STATUS_NOT_ELIGIBLE'
  | 'HUMAN_REVIEW_CASE_NOT_FOUND'
  | 'INVALID_HUMAN_REVIEW_CASE'
  | 'CASE_SOURCE_MISMATCH'
  | 'CASE_NOT_METADATA_RECORDED'
  | 'CATALOG_HANDOFF_NOT_CREATED'
  | 'INVALID_PERSISTED_HANDOFF_SCHEMA'
  | 'HANDOFF_SOURCE_MISMATCH'
  | 'CATALOG_DOCUMENT_MISSING'
  | 'INVALID_CATALOG_DOCUMENT_STATE'
  | 'CATALOG_CASE_NOT_ALIGNED'
  | 'INCONSISTENT_ALIGNMENT_STATE'
  | 'RIGHTS_DECISION_MISSING'
  | 'INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA'
  | 'RIGHTS_DECISION_STALE_HOLD'
  | 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK'
  | 'ORGANIZATION_NOT_FOUND'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_ORGANIZATION_MISMATCH'
  | 'SOURCE_NOT_VERIFIED'
  | 'INCONSISTENT_RELEASE_STATE'
  | 'RELEASE_PRECONDITION_CONFLICT'
  | 'RELEASE_ALREADY_EXISTS_CONFLICT'
  | 'RELEASE_EVENT_ALREADY_EXISTS'
  | 'SECURITY_POSTURE_VIOLATION'
  | 'PUBLIC_DOCUMENT_VALIDATION_FAILED'
  | 'TRANSACTION_ABORTED_NO_WRITE'
  | 'TRANSACTION_COMMIT_UNCERTAIN'
  | 'RELEASE_PERSISTENCE_FAILED';

export interface ReviewedLibrarySourceReleaseEditorialInput {
  readonly publicRightsStatus: ReviewedPublicLibraryRightsStatus;
  readonly publicLinkBasis: ReviewedPublicLinkBasis;
  readonly verifiedSourceUrl: string;
  readonly rightsEvidenceReference: string;
  readonly rightsEvidenceSummary: string;
  readonly releaseNotes?: string;
}

export interface GetReviewedLibrarySourceReleaseStatusInput {
  readonly receiptId: string;
}

export interface PublishReviewedLibrarySourceReferenceInput {
  readonly receiptId: string;
  readonly expectedHumanCaseRevision: number;
  readonly expectedCatalogUpdatedAt: string;
  readonly expectedAlignmentRevision: number;
  readonly expectedRightsDecisionRevision: number;
  readonly confirmation: typeof LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL;
  readonly input: ReviewedLibrarySourceReleaseEditorialInput;
}

export interface LibraryQuarantinePersistedReviewedSourceRelease {
  readonly schemaVersion: typeof LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly sourceCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRevision: number;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly draftSourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly alignedHumanCaseRevision: number;
  readonly alignedHumanCaseUpdatedAt: string;
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
  readonly publishedBy: string;
  readonly publishedAt: string;
  readonly quarantineBinaryExposed: false;
  readonly quarantineDraftRemainsDraft: true;
}

export interface LibraryQuarantinePersistedReviewedSourceReleaseEvent {
  readonly schemaVersion: typeof LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION;
  readonly eventId: string;
  readonly receiptId: string;
  readonly sourceCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRevision: number;
  readonly eventType: 'PUBLISHED_EXTERNAL_SOURCE_REFERENCE';
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
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
  readonly verifiedSourceUrl: string;
  readonly actorUid: string;
  readonly recordedAt: string;
  readonly quarantineBinaryExposed: false;
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
  readonly workflowState: typeof WorkflowState.Published;
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
  readonly blockCode: ReviewedLibrarySourceReleaseErrorCode | null;
  readonly blockMessage: string | null;
  readonly isPublished: boolean;
  readonly quarantineDraftWorkflowState: typeof WorkflowState.Draft;
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
  readonly errorCode: ReviewedLibrarySourceReleaseErrorCode;
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
  readonly errorCode: ReviewedLibrarySourceReleaseErrorCode;
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

export function deriveReviewedSourceReleaseEventId(
  receiptId: string,
  releaseRevision: number
): string {
  return `${receiptId}_${releaseRevision}`;
}

export function parseReviewedPublicLibraryDocumentId(
  documentId: unknown
): string | null {
  if (
    typeof documentId !== 'string' ||
    !REVIEWED_PUBLIC_LIBRARY_DOCUMENT_ID_REGEX.test(documentId)
  ) {
    return null;
  }
  return documentId.slice(REVIEWED_PUBLIC_LIBRARY_DOCUMENT_ID_PREFIX.length);
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

function hasOnlyAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): boolean {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      return false;
    }
  }
  return true;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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

function validateSafePlainText(
  raw: unknown,
  minLength: number,
  maxLength: number,
  allowNewline: boolean
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string } {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Field must be a string.' };
  }
  const normalized = allowNewline
    ? raw.replace(/\r\n?/g, '\n').trim()
    : raw.trim();

  if (normalized.length < minLength) {
    return {
      ok: false,
      message: `Field must contain at least ${minLength} non-whitespace characters.`,
    };
  }
  if (normalized.length > maxLength) {
    return {
      ok: false,
      message: `Field exceeds maximum allowed length of ${maxLength} characters.`,
    };
  }
  if (hasForbiddenControlOrBidiChar(normalized, allowNewline)) {
    return {
      ok: false,
      message: 'Field contains forbidden control or bidirectional formatting characters.',
    };
  }
  if (HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(normalized)) {
    return {
      ok: false,
      message: 'Field must not contain angle brackets or HTML tags.',
    };
  }
  if (FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(normalized)) {
    return {
      ok: false,
      message: 'Field contains forbidden URL schemes or internal quarantine storage paths.',
    };
  }
  return { ok: true, value: normalized };
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

export function validateVerifiedPublisherSourceUrl(raw: unknown):
  | { readonly ok: true; readonly url: string }
  | {
      readonly ok: false;
      readonly errorCode: 'INVALID_VERIFIED_SOURCE_URL';
      readonly errorMessage: string;
    } {
  if (typeof raw !== 'string') {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage: 'verifiedSourceUrl must be a string.',
    };
  }

  const trimmed = raw.trim();
  if (trimmed !== raw || trimmed.length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage:
        'verifiedSourceUrl must be a trimmed non-empty https:// publisher URL.',
    };
  }

  if (trimmed.length > VERIFIED_PUBLISHER_URL_MAX_LENGTH) {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage: `verifiedSourceUrl exceeds maximum length of ${VERIFIED_PUBLISHER_URL_MAX_LENGTH} characters.`,
    };
  }

  if (
    /\s/.test(trimmed) ||
    hasForbiddenControlOrBidiChar(trimmed, false) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(trimmed)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage:
        'verifiedSourceUrl must not contain whitespace, control characters, BiDi controls, or angle brackets.',
    };
  }

  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(trimmed)) {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage:
        'verifiedSourceUrl must not contain encoded control characters.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage: 'verifiedSourceUrl is not a valid URL.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage:
        'verifiedSourceUrl must strictly use the https: protocol.',
    };
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage:
        'verifiedSourceUrl must not embed username or password credentials.',
    };
  }

  if (parsed.port !== '') {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage:
        'verifiedSourceUrl must not specify a custom port number.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host.length === 0 ||
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
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage:
        'verifiedSourceUrl hostname is invalid, private, storage-bucket hosted, or an unauthorized shortener.',
    };
  }

  let decodedCombined = `${parsed.pathname}${parsed.search}${parsed.hash}`.toLowerCase();
  try {
    decodedCombined = decodeURIComponent(decodedCombined);
  } catch {
    return {
      ok: false,
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage: 'verifiedSourceUrl contains malformed percent-encoding.',
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
      errorCode: 'INVALID_VERIFIED_SOURCE_URL',
      errorMessage:
        'verifiedSourceUrl must not reference quarantine paths, storage buckets, or signed storage tokens.',
    };
  }

  for (const [paramKey, paramValue] of parsed.searchParams.entries()) {
    const lowerKey = paramKey.toLowerCase();
    if (
      FORBIDDEN_URL_PARAM_NAMES.has(lowerKey) ||
      lowerKey.startsWith('x-goog-') ||
      lowerKey.startsWith('x-amz-')
    ) {
      return {
        ok: false,
        errorCode: 'INVALID_VERIFIED_SOURCE_URL',
        errorMessage: `verifiedSourceUrl must not include signed-token or redirect query parameter '${paramKey}'.`,
      };
    }
    if (/https?:\/\//i.test(paramValue) || /gs:\/\//i.test(paramValue)) {
      return {
        ok: false,
        errorCode: 'INVALID_VERIFIED_SOURCE_URL',
        errorMessage:
          'verifiedSourceUrl must not embed open-redirect URLs in query parameters.',
      };
    }
  }

  return { ok: true, url: trimmed };
}

function isRightsEvidenceMerelyCatalogMetadataOnly(summary: string): boolean {
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

export function validateReviewedSourceReleaseEditorialInput(raw: unknown):
  | {
      readonly ok: true;
      readonly value: {
        readonly publicRightsStatus: ReviewedPublicLibraryRightsStatus;
        readonly publicLinkBasis: ReviewedPublicLinkBasis;
        readonly verifiedSourceUrl: string;
        readonly rightsEvidenceReference: string;
        readonly rightsEvidenceSummary: string;
        readonly releaseNotes: string;
      };
    }
  | {
      readonly ok: false;
      readonly errorCode: ReviewedLibrarySourceReleaseErrorCode;
      readonly errorMessage: string;
    } {
  if (!isPlainRecord(raw)) {
    return {
      ok: false,
      errorCode: 'INVALID_RELEASE_PAYLOAD',
      errorMessage: 'Release editorial input must be a plain object.',
    };
  }

  if (!hasOnlyAllowedKeys(raw, ALLOWED_PUBLISH_INPUT_KEYS)) {
    return {
      ok: false,
      errorCode: 'INVALID_RELEASE_PAYLOAD',
      errorMessage: 'Release editorial input contains unexpected or forbidden fields.',
    };
  }

  if (
    raw.publicRightsStatus !== LibraryRightsStatus.OpenPubliclyAvailable &&
    raw.publicRightsStatus !== LibraryRightsStatus.PermissionGranted
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PUBLIC_RIGHTS_STATUS',
      errorMessage:
        'publicRightsStatus must be OpenPubliclyAvailable or PermissionGranted.',
    };
  }

  if (
    typeof raw.publicLinkBasis !== 'string' ||
    !(REVIEWED_PUBLIC_LINK_BASES as readonly string[]).includes(
      raw.publicLinkBasis
    )
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PUBLIC_LINK_BASIS',
      errorMessage:
        'publicLinkBasis must be one of PUBLIC_DOMAIN_FULL_TEXT, OPEN_LICENSE_FULL_TEXT, EXPLICIT_PUBLISHER_PERMISSION_FULL_TEXT, or OFFICIAL_PUBLIC_SOURCE_LINK.',
    };
  }

  const urlCheck = validateVerifiedPublisherSourceUrl(raw.verifiedSourceUrl);
  if (!urlCheck.ok) {
    return urlCheck;
  }

  const refCheck = validateSafePlainText(
    raw.rightsEvidenceReference,
    3,
    RELEASE_EVIDENCE_REFERENCE_MAX_LENGTH,
    false
  );
  if (!refCheck.ok) {
    return {
      ok: false,
      errorCode: 'PUBLIC_RIGHTS_EVIDENCE_REQUIRED',
      errorMessage: `rightsEvidenceReference invalid: ${refCheck.message}`,
    };
  }

  const summaryCheck = validateSafePlainText(
    raw.rightsEvidenceSummary,
    10,
    RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH,
    true
  );
  if (!summaryCheck.ok) {
    return {
      ok: false,
      errorCode: 'PUBLIC_RIGHTS_EVIDENCE_REQUIRED',
      errorMessage: `rightsEvidenceSummary invalid: ${summaryCheck.message}`,
    };
  }

  if (isRightsEvidenceMerelyCatalogMetadataOnly(summaryCheck.value)) {
    return {
      ok: false,
      errorCode: 'PUBLIC_RIGHTS_EVIDENCE_REQUIRED',
      errorMessage:
        'rightsEvidenceSummary must explicitly substantiate public full-text linking rights rather than repeating CATALOG_METADATA_ONLY.',
    };
  }

  let releaseNotes = '';
  if (raw.releaseNotes !== undefined) {
    const notesCheck = validateSafePlainText(
      raw.releaseNotes,
      0,
      RELEASE_NOTES_MAX_LENGTH,
      true
    );
    if (!notesCheck.ok) {
      return {
        ok: false,
        errorCode: 'INVALID_PLAIN_TEXT_FIELD',
        errorMessage: `releaseNotes invalid: ${notesCheck.message}`,
      };
    }
    releaseNotes = notesCheck.value;
  }

  return {
    ok: true,
    value: Object.freeze({
      publicRightsStatus: raw.publicRightsStatus,
      publicLinkBasis: raw.publicLinkBasis as ReviewedPublicLinkBasis,
      verifiedSourceUrl: urlCheck.url,
      rightsEvidenceReference: refCheck.value,
      rightsEvidenceSummary: summaryCheck.value,
      releaseNotes,
    }),
  };
}

function validatePersistedReleaseRecord(
  raw: unknown,
  expectedReceiptId: string
):
  | {
      readonly ok: true;
      readonly release: LibraryQuarantinePersistedReviewedSourceRelease;
    }
  | {
      readonly ok: false;
      readonly errorCode: ReviewedLibrarySourceReleaseErrorCode;
      readonly errorMessage: string;
    } {
  if (!isPlainRecord(raw)) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage: 'Persisted release provenance record must be a plain object.',
    };
  }

  if (
    !hasOnlyAllowedKeys(raw, PERSISTED_RELEASE_KEYS) ||
    Object.keys(raw).length !== PERSISTED_RELEASE_KEYS.size
  ) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage: 'Persisted release provenance record schema is invalid.',
    };
  }

  if (
    raw.schemaVersion !== LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION ||
    raw.receiptId !== expectedReceiptId ||
    raw.sourceCatalogDocumentId !==
      deriveQuarantineCatalogDocumentId(expectedReceiptId) ||
    raw.publicDocumentId !==
      deriveReviewedPublicLibraryDocumentId(expectedReceiptId) ||
    !isPositiveSafeInteger(raw.releaseRevision) ||
    !isPositiveSafeInteger(raw.sourceRevision) ||
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_HEX_REGEX.test(raw.sourceSha256) ||
    !isPositiveSafeInteger(raw.draftSourceRevision) ||
    !isPositiveSafeInteger(raw.catalogHandoffCaseRevision) ||
    !isPositiveSafeInteger(raw.alignedHumanCaseRevision) ||
    typeof raw.alignedHumanCaseUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.alignedHumanCaseUpdatedAt) ||
    !isNonNegativeSafeInteger(raw.alignmentRevision) ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.catalogUpdatedAt) ||
    !isPositiveSafeInteger(raw.rightsDecisionRevision) ||
    typeof raw.organizationId !== 'string' ||
    typeof raw.sourceId !== 'string' ||
    typeof raw.publishedBy !== 'string' ||
    !isValidUploaderUid(raw.publishedBy) ||
    typeof raw.publishedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.publishedAt) ||
    raw.quarantineBinaryExposed !== false ||
    raw.quarantineDraftRemainsDraft !== true
  ) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage: 'Persisted release provenance record metadata is invalid.',
    };
  }

  const editorialValidation = validateReviewedSourceReleaseEditorialInput({
    publicRightsStatus: raw.publicRightsStatus,
    publicLinkBasis: raw.publicLinkBasis,
    verifiedSourceUrl: raw.verifiedSourceUrl,
    rightsEvidenceReference: raw.rightsEvidenceReference,
    rightsEvidenceSummary: raw.rightsEvidenceSummary,
    releaseNotes: raw.releaseNotes,
  });

  if (!editorialValidation.ok) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage: editorialValidation.errorMessage,
    };
  }

  return {
    ok: true,
    release: Object.freeze({
      schemaVersion: LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION,
      receiptId: raw.receiptId,
      sourceCatalogDocumentId: raw.sourceCatalogDocumentId,
      publicDocumentId: raw.publicDocumentId,
      releaseRevision: raw.releaseRevision,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
      draftSourceRevision: raw.draftSourceRevision,
      catalogHandoffCaseRevision: raw.catalogHandoffCaseRevision,
      alignedHumanCaseRevision: raw.alignedHumanCaseRevision,
      alignedHumanCaseUpdatedAt: raw.alignedHumanCaseUpdatedAt,
      alignmentRevision: raw.alignmentRevision,
      catalogUpdatedAt: raw.catalogUpdatedAt,
      rightsDecisionRevision: raw.rightsDecisionRevision,
      organizationId: raw.organizationId,
      sourceId: raw.sourceId,
      publicRightsStatus: editorialValidation.value.publicRightsStatus,
      publicLinkBasis: editorialValidation.value.publicLinkBasis,
      rightsEvidenceReference: editorialValidation.value.rightsEvidenceReference,
      rightsEvidenceSummary: editorialValidation.value.rightsEvidenceSummary,
      releaseNotes: editorialValidation.value.releaseNotes,
      verifiedSourceUrl: editorialValidation.value.verifiedSourceUrl,
      publishedBy: raw.publishedBy,
      publishedAt: raw.publishedAt,
      quarantineBinaryExposed: false,
      quarantineDraftRemainsDraft: true,
    }),
  };
}

function validatePersistedPublishedLibraryDocument(
  raw: unknown,
  expectedPublicDocId: string,
  expectedRelease: LibraryQuarantinePersistedReviewedSourceRelease
):
  | { readonly ok: true; readonly document: LibraryDocument }
  | {
      readonly ok: false;
      readonly errorCode: ReviewedLibrarySourceReleaseErrorCode;
      readonly errorMessage: string;
    } {
  let doc: LibraryDocument;
  try {
    doc = LibraryValidator.validatePersistedDocument(raw, expectedPublicDocId);
  } catch (err) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage:
        err instanceof Error
          ? err.message
          : 'Persisted public library document failed validation.',
    };
  }

  if (
    doc.workflowState !== WorkflowState.Published ||
    doc.rightsStatus !== expectedRelease.publicRightsStatus ||
    doc.organizationId !== expectedRelease.organizationId ||
    doc.sourceId !== expectedRelease.sourceId ||
    doc.versions.length < 1 ||
    doc.versions[0].referenceUrl !== expectedRelease.verifiedSourceUrl
  ) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage:
        'Persisted public library document does not match release provenance.',
    };
  }

  return { ok: true, document: doc };
}

function toSanitizedReleaseDto(
  release: LibraryQuarantinePersistedReviewedSourceRelease
): SanitizedReviewedLibrarySourceReleaseDto {
  return Object.freeze({
    schemaVersion: release.schemaVersion,
    receiptId: release.receiptId,
    sourceCatalogDocumentId: release.sourceCatalogDocumentId,
    publicDocumentId: release.publicDocumentId,
    releaseRevision: release.releaseRevision,
    sourceRevision: release.sourceRevision,
    draftSourceRevision: release.draftSourceRevision,
    catalogHandoffCaseRevision: release.catalogHandoffCaseRevision,
    alignedHumanCaseRevision: release.alignedHumanCaseRevision,
    alignmentRevision: release.alignmentRevision,
    catalogUpdatedAt: release.catalogUpdatedAt,
    rightsDecisionRevision: release.rightsDecisionRevision,
    organizationId: release.organizationId,
    sourceId: release.sourceId,
    publicRightsStatus: release.publicRightsStatus,
    publicLinkBasis: release.publicLinkBasis,
    rightsEvidenceReference: release.rightsEvidenceReference,
    rightsEvidenceSummary: release.rightsEvidenceSummary,
    releaseNotes: release.releaseNotes,
    verifiedSourceUrl: release.verifiedSourceUrl,
    publishedAt: release.publishedAt,
    quarantineBinaryExposed: false,
    quarantineDraftRemainsDraft: true,
  });
}

function toSanitizedPublicDocumentSummaryDto(
  doc: LibraryDocument
): SanitizedPublishedLibraryDocumentSummaryDto {
  const referenceUrl =
    doc.versions.find((v) => typeof v.referenceUrl === 'string')?.referenceUrl ??
    '';
  return Object.freeze({
    id: doc.id,
    titleAr: doc.titleAr,
    titleEn: doc.titleEn,
    organizationId: doc.organizationId,
    sourceId: doc.sourceId,
    rightsStatus: doc.rightsStatus as ReviewedPublicLibraryRightsStatus,
    workflowState: WorkflowState.Published,
    referenceUrl,
    updatedAt: doc.updatedAt,
  });
}

function toFirestoreDocumentData(
  record: object
): LibraryQuarantineFirestoreDocumentData {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      clone[key] = value;
    }
  }
  return clone;
}

interface VerifiedReleaseChainState {
  readonly receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly reviewDraft: LibraryQuarantinePersistedReviewDraft;
  readonly humanReviewCase: LibraryQuarantinePersistedHumanReviewCase;
  readonly catalogHandoff: LibraryQuarantinePersistedCatalogHandoff;
  readonly rawCatalogDocument: LibraryDocument;
  readonly sanitizedCatalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null;
  readonly currentAlignmentRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly catalogAligned: boolean;
  readonly alignmentBlockCode: ReviewedLibrarySourceReleaseErrorCode | null;
  readonly alignmentBlockMessage: string | null;
  readonly rightsDecision: LibraryQuarantinePersistedRightsDecision | null;
  readonly rightsAuthorizedForMetadata: boolean;
  readonly organization: LibraryOrganization;
  readonly source: LibrarySource;
  readonly sourceVerified: boolean;
  readonly suggestedPublisherBaseUrl: string | null;
  readonly eligibleForPublish: boolean;
  readonly blockCode: ReviewedLibrarySourceReleaseErrorCode | null;
  readonly blockMessage: string | null;
}

function evaluateReleaseChainSnapshots(
  receiptId: string,
  receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  draftSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  caseSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  handoffSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  qcatDocSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  alignmentSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  rightsDecisionSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  orgSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  sourceSnap: LibraryQuarantineFirestoreDocumentSnapshot
):
  | { readonly ok: true; readonly chain: VerifiedReleaseChainState }
  | {
      readonly ok: false;
      readonly errorCode: ReviewedLibrarySourceReleaseErrorCode;
      readonly errorMessage: string;
    } {
  const sourceVerification = verifyReceiptAndDraftEligibleForHumanReviewCase(
    receiptId,
    receiptSnap,
    draftSnap
  );
  if (!sourceVerification.ok) {
    return {
      ok: false,
      errorCode: sourceVerification.reasonCode,
      errorMessage:
        'Source quarantine receipt or review draft is not eligible for public source release.',
    };
  }
  const { receiptEnvelope, reviewDraft } = sourceVerification;
  const receipt = receiptEnvelope.receipt;

  if (!caseSnap.exists) {
    return {
      ok: false,
      errorCode: 'HUMAN_REVIEW_CASE_NOT_FOUND',
      errorMessage: 'Human review case has not been recorded for this receipt.',
    };
  }
  const caseValidation = validatePersistedLibraryQuarantineHumanReviewCase(
    caseSnap.data(),
    receiptId
  );
  if (!caseValidation.ok) {
    return {
      ok: false,
      errorCode: caseValidation.errorCode,
      errorMessage: 'Persisted human review case failed strict schema validation.',
    };
  }
  const humanReviewCase = caseValidation.reviewCase;
  if (
    humanReviewCase.sourceRevision !== receiptEnvelope.revision ||
    humanReviewCase.sourceUpdatedAt !== receipt.updatedAt ||
    humanReviewCase.sourceSha256 !== receipt.sha256 ||
    humanReviewCase.draftSourceRevision !== reviewDraft.sourceRevision
  ) {
    return {
      ok: false,
      errorCode: 'CASE_SOURCE_MISMATCH',
      errorMessage: 'Human review case provenance does not match quarantine source.',
    };
  }
  if (
    humanReviewCase.status !== 'METADATA_RECORDED' ||
    humanReviewCase.sourceEvidenceNotes.trim().length === 0 ||
    (humanReviewCase.titleAr.trim().length === 0 &&
      humanReviewCase.titleEn.trim().length === 0)
  ) {
    return {
      ok: false,
      errorCode: 'CASE_NOT_METADATA_RECORDED',
      errorMessage:
        'Human review case must be in METADATA_RECORDED state with valid title and source evidence.',
    };
  }

  if (!handoffSnap.exists) {
    return {
      ok: false,
      errorCode: 'CATALOG_HANDOFF_NOT_CREATED',
      errorMessage: 'Catalog draft handoff has not been created for this receipt.',
    };
  }
  const handoffValidation = validatePersistedLibraryQuarantineCatalogHandoff(
    handoffSnap.data(),
    receiptId
  );
  if (!handoffValidation.ok) {
    return {
      ok: false,
      errorCode:
        handoffValidation.errorCode === 'SECURITY_POSTURE_VIOLATION'
          ? 'SECURITY_POSTURE_VIOLATION'
          : 'INVALID_PERSISTED_HANDOFF_SCHEMA',
      errorMessage: 'Persisted catalog handoff record failed schema validation.',
    };
  }
  const catalogHandoff = handoffValidation.handoff;
  const qcatDocumentId = deriveQuarantineCatalogDocumentId(receiptId);

  if (
    catalogHandoff.documentId !== qcatDocumentId ||
    catalogHandoff.sourceRevision !== receiptEnvelope.revision ||
    catalogHandoff.sourceUpdatedAt !== receipt.updatedAt ||
    catalogHandoff.sourceSha256 !== receipt.sha256 ||
    catalogHandoff.draftSourceRevision !== reviewDraft.sourceRevision
  ) {
    return {
      ok: false,
      errorCode: 'HANDOFF_SOURCE_MISMATCH',
      errorMessage: 'Persisted catalog handoff provenance does not match quarantine source.',
    };
  }

  if (!qcatDocSnap.exists) {
    return {
      ok: false,
      errorCode: 'CATALOG_DOCUMENT_MISSING',
      errorMessage: 'Internal qcat-<receiptId> catalog draft document is missing.',
    };
  }
  const rawCatalogData = qcatDocSnap.data();
  const qcatValidation = validatePersistedCatalogDraftDocument(
    rawCatalogData,
    qcatDocumentId
  );
  if (!qcatValidation.ok) {
    return {
      ok: false,
      errorCode:
        qcatValidation.errorCode === 'SECURITY_POSTURE_VIOLATION'
          ? 'SECURITY_POSTURE_VIOLATION'
          : 'INVALID_CATALOG_DOCUMENT_STATE',
      errorMessage: 'Internal qcat-<receiptId> catalog draft failed validation.',
    };
  }
  const rawCatalogDocument = rawCatalogData as unknown as LibraryDocument;
  const sanitizedCatalogDocument = qcatValidation.catalogDocument;

  if (
    sanitizedCatalogDocument.organizationId !== catalogHandoff.organizationId ||
    sanitizedCatalogDocument.sourceId !== catalogHandoff.sourceId ||
    sanitizedCatalogDocument.createdAt !== catalogHandoff.createdAt ||
    Date.parse(sanitizedCatalogDocument.updatedAt) <
      Date.parse(catalogHandoff.createdAt)
  ) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_ALIGNMENT_STATE',
      errorMessage:
        'Internal catalog draft metadata is inconsistent with catalog handoff provenance.',
    };
  }

  // Verify alignment state strictly fail-closed (no unattributed recovery bypass)
  let alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null = null;
  let currentAlignmentRevision = 0;
  let effectiveAlignedCaseRevision = catalogHandoff.caseRevision;
  let effectiveAlignedCaseUpdatedAt = catalogHandoff.caseUpdatedAt;
  let catalogAligned = true;
  let alignmentBlockCode: ReviewedLibrarySourceReleaseErrorCode | null = null;
  let alignmentBlockMessage: string | null = null;

  const diff = computeLibraryQuarantineCatalogCaseFourFieldDiff(
    humanReviewCase,
    rawCatalogDocument
  );

  if (alignmentSnap.exists) {
    const alignmentCheck = validatePersistedLibraryQuarantineCatalogCaseAlignment(
      alignmentSnap.data(),
      receiptId
    );
    if (!alignmentCheck.ok) {
      return {
        ok: false,
        errorCode:
          alignmentCheck.errorCode === 'SECURITY_POSTURE_VIOLATION'
            ? 'SECURITY_POSTURE_VIOLATION'
            : 'INCONSISTENT_ALIGNMENT_STATE',
        errorMessage: alignmentCheck.errorMessage,
      };
    }
    alignment = alignmentCheck.alignment;
    if (
      alignment.documentId !== qcatDocumentId ||
      alignment.sourceRevision !== receiptEnvelope.revision ||
      alignment.sourceUpdatedAt !== receipt.updatedAt ||
      alignment.sourceSha256 !== receipt.sha256 ||
      alignment.originalHandoffCaseRevision !== catalogHandoff.caseRevision ||
      alignment.alignedHumanCaseRevision < catalogHandoff.caseRevision ||
      Date.parse(alignment.alignedHumanCaseUpdatedAt) <
        Date.parse(catalogHandoff.caseUpdatedAt) ||
      alignment.documentUpdatedAt !== sanitizedCatalogDocument.updatedAt
    ) {
      return {
        ok: false,
        errorCode: 'INCONSISTENT_ALIGNMENT_STATE',
        errorMessage:
          'Persisted catalog case alignment record is inconsistent with catalog draft or provenance.',
      };
    }
    currentAlignmentRevision = alignment.alignmentRevision;
    effectiveAlignedCaseRevision = alignment.alignedHumanCaseRevision;
    effectiveAlignedCaseUpdatedAt = alignment.alignedHumanCaseUpdatedAt;
  } else if (sanitizedCatalogDocument.updatedAt !== catalogHandoff.createdAt) {
    catalogAligned = false;
    alignmentBlockCode = 'INCONSISTENT_ALIGNMENT_STATE';
    alignmentBlockMessage =
      'Catalog document was modified without a corresponding catalog case alignment record.';
  }

  if (catalogAligned) {
    if (
      humanReviewCase.revision !== effectiveAlignedCaseRevision ||
      humanReviewCase.updatedAt !== effectiveAlignedCaseUpdatedAt ||
      diff.hasAnyDifference
    ) {
      catalogAligned = false;
      alignmentBlockCode = 'CATALOG_CASE_NOT_ALIGNED';
      alignmentBlockMessage =
        'Human review case has unaligned updates relative to the qcat-<receiptId> catalog draft.';
    }
  }

  // Verify organization and source records
  if (!orgSnap.exists || !isPlainRecord(orgSnap.data())) {
    return {
      ok: false,
      errorCode: 'ORGANIZATION_NOT_FOUND',
      errorMessage: `Referenced organization ${sanitizedCatalogDocument.organizationId} does not exist.`,
    };
  }
  const rawOrg = orgSnap.data() as LibraryOrganization;
  const organization: LibraryOrganization = {
    ...rawOrg,
    id: rawOrg.id || sanitizedCatalogDocument.organizationId,
  };

  if (!sourceSnap.exists || !isPlainRecord(sourceSnap.data())) {
    return {
      ok: false,
      errorCode: 'SOURCE_NOT_FOUND',
      errorMessage: `Referenced source ${sanitizedCatalogDocument.sourceId} does not exist.`,
    };
  }
  const rawSource = sourceSnap.data() as LibrarySource;
  const source: LibrarySource = {
    ...rawSource,
    id: rawSource.id || sanitizedCatalogDocument.sourceId,
  };
  if (source.organizationId !== organization.id) {
    return {
      ok: false,
      errorCode: 'SOURCE_ORGANIZATION_MISMATCH',
      errorMessage: `Source ${source.id} does not belong to organization ${organization.id}.`,
    };
  }
  const sourceVerified = source.verificationStatus === 'Verified';
  let suggestedPublisherBaseUrl: string | null = null;
  if (typeof source.sourceUrl === 'string' && source.sourceUrl.trim() !== '') {
    const urlCheck = validateVerifiedPublisherSourceUrl(source.sourceUrl.trim());
    if (urlCheck.ok) {
      suggestedPublisherBaseUrl = urlCheck.url;
    }
  }

  // Verify rights decision record
  let rightsDecision: LibraryQuarantinePersistedRightsDecision | null = null;
  let rightsAuthorizedForMetadata = false;
  let rightsBlockCode: ReviewedLibrarySourceReleaseErrorCode | null = null;
  let rightsBlockMessage: string | null = null;

  if (!rightsDecisionSnap.exists) {
    rightsBlockCode = 'RIGHTS_DECISION_MISSING';
    rightsBlockMessage =
      'Human rights review decision has not been recorded for this catalog draft.';
  } else {
    const rightsValidation = validateAlignmentAwarePersistedRightsDecision(
      rightsDecisionSnap.data(),
      receiptId
    );
    if (!rightsValidation.ok) {
      return {
        ok: false,
        errorCode:
          rightsValidation.errorCode === 'SECURITY_POSTURE_VIOLATION'
            ? 'SECURITY_POSTURE_VIOLATION'
            : 'INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA',
        errorMessage: 'Persisted rights decision failed strict schema validation.',
      };
    }
    rightsDecision = rightsValidation.rightsDecision;

    if (
      rightsDecision.documentId !== qcatDocumentId ||
      rightsDecision.sourceRevision !== receiptEnvelope.revision ||
      rightsDecision.sourceUpdatedAt !== receipt.updatedAt ||
      rightsDecision.sourceSha256 !== receipt.sha256 ||
      rightsDecision.draftSourceRevision !== reviewDraft.sourceRevision ||
      rightsDecision.catalogHandoffCaseRevision !== catalogHandoff.caseRevision ||
      rightsDecision.rightsScope !== LIBRARY_QUARANTINE_RIGHTS_SCOPE
    ) {
      return {
        ok: false,
        errorCode: 'INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA',
        errorMessage:
          'Persisted rights decision provenance does not match catalog handoff chain.',
      };
    }

    if (rightsDecision.currentHumanCaseRevision !== effectiveAlignedCaseRevision) {
      rightsBlockCode = 'RIGHTS_DECISION_STALE_HOLD';
      rightsBlockMessage =
        'Recorded rights decision does not match the current aligned human review case revision.';
    } else if (
      rightsDecision.decision !== 'METADATA_USE_CLEARED' ||
      rightsDecision.basis === 'INTERNAL_ONLY' ||
      rightsDecision.basis === 'UNDETERMINED'
    ) {
      rightsBlockCode = 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK';
      rightsBlockMessage = `Current rights decision (${rightsDecision.decision} / ${rightsDecision.basis}) does not authorize public library publication or external publisher linking.`;
    } else {
      rightsAuthorizedForMetadata = true;
    }
  }

  let eligibleForPublish = true;
  let blockCode: ReviewedLibrarySourceReleaseErrorCode | null = null;
  let blockMessage: string | null = null;

  if (!catalogAligned) {
    eligibleForPublish = false;
    blockCode = alignmentBlockCode;
    blockMessage = alignmentBlockMessage;
  } else if (!sourceVerified) {
    eligibleForPublish = false;
    blockCode = 'SOURCE_NOT_VERIFIED';
    blockMessage = `Registered source ${source.id} has verificationStatus '${source.verificationStatus}' and must be Verified before public release.`;
  } else if (!rightsAuthorizedForMetadata) {
    eligibleForPublish = false;
    blockCode = rightsBlockCode;
    blockMessage = rightsBlockMessage;
  }

  return {
    ok: true,
    chain: Object.freeze({
      receiptEnvelope,
      reviewDraft,
      humanReviewCase,
      catalogHandoff,
      rawCatalogDocument,
      sanitizedCatalogDocument,
      alignment,
      currentAlignmentRevision,
      effectiveAlignedCaseRevision,
      catalogAligned,
      alignmentBlockCode,
      alignmentBlockMessage,
      rightsDecision,
      rightsAuthorizedForMetadata,
      organization,
      source,
      sourceVerified,
      suggestedPublisherBaseUrl,
      eligibleForPublish,
      blockCode,
      blockMessage,
    }),
  };
}

class PreWriteReleaseHoldError extends Error {
  constructor(
    public readonly errorCode: ReviewedLibrarySourceReleaseErrorCode,
    public readonly errorMessage: string
  ) {
    super(`${errorCode}: ${errorMessage}`);
    this.name = 'PreWriteReleaseHoldError';
  }
}

class PreWriteReleaseConflictError extends Error {
  constructor(
    public readonly errorCode:
      | 'RELEASE_PRECONDITION_CONFLICT'
      | 'RELEASE_ALREADY_EXISTS_CONFLICT',
    public readonly releaseOutcome: 'NOT_PUBLISHED' | 'ALREADY_PUBLISHED',
    public readonly errorMessage: string,
    public readonly currentHumanCaseRevision: number,
    public readonly effectiveAlignedCaseRevision: number,
    public readonly currentAlignmentRevision: number,
    public readonly currentCatalogUpdatedAt: string,
    public readonly currentRightsDecisionRevision: number | null,
    public readonly releaseRecord: SanitizedReviewedLibrarySourceReleaseDto | null,
    public readonly publicDocument: SanitizedPublishedLibraryDocumentSummaryDto | null
  ) {
    super(`${errorCode}: ${errorMessage}`);
    this.name = 'PreWriteReleaseConflictError';
  }
}

function makeGetHoldDto(
  receiptId: string | null,
  errorCode: ReviewedLibrarySourceReleaseErrorCode,
  errorMessage: string
): GetReviewedLibrarySourceReleaseStatusHoldDto {
  const validReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;
  return Object.freeze({
    ok: false,
    status: 'HOLD',
    errorCode,
    errorMessage,
    receiptId: validReceiptId,
    quarantineCatalogDocumentId: validReceiptId
      ? deriveQuarantineCatalogDocumentId(validReceiptId)
      : null,
    publicDocumentId: validReceiptId
      ? deriveReviewedPublicLibraryDocumentId(validReceiptId)
      : null,
    eligibleForPublish: false,
    isPublished: false,
    quarantineBinaryExposed: false,
  });
}

function makePublishHoldDto(
  receiptId: string | null,
  errorCode: ReviewedLibrarySourceReleaseErrorCode,
  errorMessage: string
): PublishReviewedLibrarySourceReferenceHoldDto {
  const validReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;
  return Object.freeze({
    ok: false,
    status: 'HOLD',
    releaseOutcome: 'NOT_PUBLISHED',
    published: false,
    errorCode,
    errorMessage,
    receiptId: validReceiptId,
    quarantineCatalogDocumentId: validReceiptId
      ? deriveQuarantineCatalogDocumentId(validReceiptId)
      : null,
    publicDocumentId: validReceiptId
      ? deriveReviewedPublicLibraryDocumentId(validReceiptId)
      : null,
    quarantineBinaryExposed: false,
  });
}

function makePublishUnknownDto(
  receiptId: string
): PublishReviewedLibrarySourceReferenceUnknownDto {
  return Object.freeze({
    ok: false,
    status: 'UNKNOWN',
    releaseOutcome: 'UNKNOWN',
    published: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
    errorMessage:
      'Transaction commit confirmation was lost after staging public release writes. Verify current release status before retrying.',
    receiptId,
    quarantineCatalogDocumentId: deriveQuarantineCatalogDocumentId(receiptId),
    publicDocumentId: deriveReviewedPublicLibraryDocumentId(receiptId),
    quarantineBinaryExposed: false,
  });
}

export interface LibraryReviewedSourceReleaseServiceDependencies {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly clock?: () => string;
}

export class LibraryReviewedSourceReleaseService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  private readonly clock: () => string;

  constructor(deps: LibraryReviewedSourceReleaseServiceDependencies) {
    if (
      !deps ||
      typeof deps !== 'object' ||
      !deps.trustedPrincipalProvider ||
      typeof deps.trustedPrincipalProvider.resolveAuthenticatedPrincipal !==
        'function' ||
      !deps.adminRepository ||
      typeof deps.adminRepository.getAdminByUid !== 'function' ||
      !deps.db ||
      typeof deps.db.collection !== 'function' ||
      typeof deps.db.runTransaction !== 'function'
    ) {
      throw new Error(
        'LibraryReviewedSourceReleaseService requires trustedPrincipalProvider, adminRepository, and db.'
      );
    }
    if (deps.clock !== undefined && typeof deps.clock !== 'function') {
      throw new Error(
        'Optional clock must be a function returning an ISO-8601 UTC timestamp.'
      );
    }

    const underlyingPrincipalProvider = deps.trustedPrincipalProvider;
    this.trustedPrincipalProvider = Object.freeze({
      resolveAuthenticatedPrincipal: () =>
        underlyingPrincipalProvider.resolveAuthenticatedPrincipal(),
    });
    const underlyingAdminRepo = deps.adminRepository;
    this.adminRepository = Object.freeze({
      getAdminByUid: (uid: string) => underlyingAdminRepo.getAdminByUid(uid),
    });
    this.db = deps.db;
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  private assertAllowedWriteCollection(collectionName: string): void {
    if (!ALLOWED_WRITE_COLLECTIONS.has(collectionName)) {
      throw new Error(
        `FORBIDDEN_COLLECTION_WRITE: Attempted to write to collection "${collectionName}".`
      );
    }
  }

  private async resolveAuthorizedActor(): Promise<
    | { readonly ok: true; readonly actorUid: string; readonly admin: AdminUser }
    | {
        readonly ok: false;
        readonly errorCode: 'UNAUTHENTICATED' | 'UNAUTHORIZED_RELEASE_ACTOR';
        readonly errorMessage: string;
      }
  > {
    let rawPrincipal: TrustedQuarantineAuthenticatedPrincipal | null = null;
    try {
      rawPrincipal =
        await this.trustedPrincipalProvider.resolveAuthenticatedPrincipal();
    } catch {
      return {
        ok: false,
        errorCode: 'UNAUTHENTICATED',
        errorMessage: 'Authenticated principal could not be resolved.',
      };
    }

    if (!isPlainRecord(rawPrincipal)) {
      return {
        ok: false,
        errorCode: 'UNAUTHENTICATED',
        errorMessage: 'Authenticated principal is missing.',
      };
    }

    if (!hasOnlyAllowedKeys(rawPrincipal, ALLOWED_PRINCIPAL_KEYS)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_RELEASE_ACTOR',
        errorMessage:
          'Authenticated principal contains unexpected override properties.',
      };
    }

    const uid = rawPrincipal.uid;
    if (typeof uid !== 'string' || uid.trim() !== uid || !isValidUploaderUid(uid)) {
      return {
        ok: false,
        errorCode: 'UNAUTHENTICATED',
        errorMessage: 'Authenticated uid is invalid.',
      };
    }

    const token = rawPrincipal.token;
    if (token !== undefined) {
      if (!isPlainRecord(token)) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_RELEASE_ACTOR',
          errorMessage: 'Authenticated token envelope must be a plain object.',
        };
      }
      for (const tokenKey of Object.keys(token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(tokenKey)) {
          return {
            ok: false,
            errorCode: 'UNAUTHORIZED_RELEASE_ACTOR',
            errorMessage: 'Token contains forbidden privilege override claims.',
          };
        }
      }
      if (
        token.role === AdminRole.AIAssistant ||
        token.isAIAssistant === true ||
        token.aiAssistant === true ||
        token.ai === true ||
        token.automated === true
      ) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_RELEASE_ACTOR',
          errorMessage:
            'Automated or AI accounts are strictly forbidden from publishing library records.',
        };
      }
    }

    let admin: AdminUser | null = null;
    try {
      admin = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_RELEASE_ACTOR',
        errorMessage: 'Failed to resolve authoritative AdminUser record.',
      };
    }

    if (
      !admin ||
      !isPlainRecord(admin) ||
      admin.id !== uid ||
      admin.isActive !== true ||
      !isValidAdminRole(admin.role) ||
      admin.role === AdminRole.AIAssistant ||
      !hasDomainResponsibility(admin.role, AdminDomain.Library)
    ) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_RELEASE_ACTOR',
        errorMessage:
          'Caller is not an active human Library domain administrator.',
      };
    }

    const requiredPermissions: readonly AdminPermission[] = [
      AdminPermission.Review,
      AdminPermission.ManageRights,
      AdminPermission.Approve,
      AdminPermission.Publish,
    ];

    for (const perm of requiredPermissions) {
      if (!AdminAuthorizationService.hasPermission(admin, perm)) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_RELEASE_ACTOR',
          errorMessage:
            'Caller must hold Review, ManageRights, Approve, and Publish permissions to release public library records.',
        };
      }
    }

    const explicitPermissions = (
      admin as { readonly permissions?: unknown }
    ).permissions;
    if (
      Array.isArray(explicitPermissions) &&
      !requiredPermissions.every((perm) => explicitPermissions.includes(perm))
    ) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_RELEASE_ACTOR',
        errorMessage:
          'Caller explicit permission list does not include Review, ManageRights, Approve, and Publish.',
      };
    }

    return { ok: true, actorUid: uid, admin };
  }

  private async readChainSnapshots(
    receiptId: string,
    getDoc: (
      ref: LibraryQuarantineFirestoreDocumentRef
    ) => Promise<LibraryQuarantineFirestoreDocumentSnapshot>
  ): Promise<
    | {
        readonly ok: true;
        readonly receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly draftSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly caseSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly handoffSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly qcatDocSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly alignmentSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly rightsDecisionSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly orgSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly sourceSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly releaseSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly publicDocSnap: LibraryQuarantineFirestoreDocumentSnapshot;
        readonly releaseEventSnap: LibraryQuarantineFirestoreDocumentSnapshot;
      }
    | {
        readonly ok: false;
        readonly errorCode: ReviewedLibrarySourceReleaseErrorCode;
        readonly errorMessage: string;
      }
  > {
    const qcatDocumentId = deriveQuarantineCatalogDocumentId(receiptId);
    const publicDocumentId = deriveReviewedPublicLibraryDocumentId(receiptId);
    const eventId = deriveReviewedSourceReleaseEventId(receiptId, 1);

    const receiptRef = this.db
      .collection(LIBRARY_QUARANTINE_RECEIPT_COLLECTION)
      .doc(receiptId);
    const draftRef = this.db
      .collection(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION)
      .doc(receiptId);
    const caseRef = this.db
      .collection(LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION)
      .doc(receiptId);
    const handoffRef = this.db
      .collection(LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION)
      .doc(receiptId);
    const qcatDocRef = this.db
      .collection(LIBRARY_DOCUMENTS_COLLECTION)
      .doc(qcatDocumentId);
    const alignmentRef = this.db
      .collection(LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION)
      .doc(receiptId);
    const rightsDecisionRef = this.db
      .collection(LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION)
      .doc(receiptId);
    const releaseRef = this.db
      .collection(LIBRARY_REVIEWED_SOURCE_RELEASES_COLLECTION)
      .doc(receiptId);
    const publicDocRef = this.db
      .collection(LIBRARY_DOCUMENTS_COLLECTION)
      .doc(publicDocumentId);
    const releaseEventRef = this.db
      .collection(LIBRARY_REVIEWED_SOURCE_RELEASE_EVENTS_COLLECTION)
      .doc(eventId);

    const [
      receiptSnap,
      draftSnap,
      caseSnap,
      handoffSnap,
      qcatDocSnap,
      alignmentSnap,
      rightsDecisionSnap,
      releaseSnap,
      publicDocSnap,
      releaseEventSnap,
    ] = await Promise.all([
      getDoc(receiptRef),
      getDoc(draftRef),
      getDoc(caseRef),
      getDoc(handoffRef),
      getDoc(qcatDocRef),
      getDoc(alignmentRef),
      getDoc(rightsDecisionRef),
      getDoc(releaseRef),
      getDoc(publicDocRef),
      getDoc(releaseEventRef),
    ]);

    const rawQcatData = qcatDocSnap.exists ? qcatDocSnap.data() : null;
    const rawHandoffData = handoffSnap.exists ? handoffSnap.data() : null;
    const orgId =
      isPlainRecord(rawQcatData) && typeof rawQcatData.organizationId === 'string'
        ? rawQcatData.organizationId
        : isPlainRecord(rawHandoffData) &&
            typeof rawHandoffData.organizationId === 'string'
          ? rawHandoffData.organizationId
          : '';
    const sourceId =
      isPlainRecord(rawQcatData) && typeof rawQcatData.sourceId === 'string'
        ? rawQcatData.sourceId
        : isPlainRecord(rawHandoffData) &&
            typeof rawHandoffData.sourceId === 'string'
          ? rawHandoffData.sourceId
          : '';

    const emptyMissingSnap: LibraryQuarantineFirestoreDocumentSnapshot = {
      exists: false,
      id: '',
      data: () => undefined,
    };

    const [orgSnap, sourceSnap] = await Promise.all([
      orgId.trim().length > 0
        ? getDoc(
            this.db.collection(LIBRARY_ORGANIZATIONS_COLLECTION).doc(orgId)
          )
        : Promise.resolve(emptyMissingSnap),
      sourceId.trim().length > 0
        ? getDoc(this.db.collection(LIBRARY_SOURCES_COLLECTION).doc(sourceId))
        : Promise.resolve(emptyMissingSnap),
    ]);

    return {
      ok: true,
      receiptSnap,
      draftSnap,
      caseSnap,
      handoffSnap,
      qcatDocSnap,
      alignmentSnap,
      rightsDecisionSnap,
      orgSnap,
      sourceSnap,
      releaseSnap,
      publicDocSnap,
      releaseEventSnap,
    };
  }

  public async getReviewedLibrarySourceReleaseStatus(
    rawInput: GetReviewedLibrarySourceReleaseStatusInput
  ): Promise<GetReviewedLibrarySourceReleaseStatusResponseDto> {
    if (
      !isPlainRecord(rawInput) ||
      !hasOnlyAllowedKeys(rawInput, ALLOWED_GET_INPUT_KEYS) ||
      !isValidLibraryQuarantineReceiptId(rawInput.receiptId)
    ) {
      return makeGetHoldDto(
        isPlainRecord(rawInput) && typeof rawInput.receiptId === 'string'
          ? rawInput.receiptId
          : null,
        'INVALID_RECEIPT_ID',
        'receiptId must be a 32-character lowercase hexadecimal string.'
      );
    }
    const receiptId = rawInput.receiptId;

    const auth = await this.resolveAuthorizedActor();
    if (!auth.ok) {
      return makeGetHoldDto(receiptId, auth.errorCode, auth.errorMessage);
    }

    let snaps: Awaited<ReturnType<typeof this.readChainSnapshots>>;
    try {
      snaps = await this.readChainSnapshots(receiptId, (ref) => {
        if (typeof ref.get !== 'function') {
          throw new Error('STORE_READ_FAILED');
        }
        return ref.get();
      });
    } catch {
      return makeGetHoldDto(
        receiptId,
        'STORE_READ_FAILED',
        'Failed to read quarantine release readiness records from Firestore.'
      );
    }
    if (!snaps.ok) {
      return makeGetHoldDto(receiptId, snaps.errorCode, snaps.errorMessage);
    }

    const evalResult = evaluateReleaseChainSnapshots(
      receiptId,
      snaps.receiptSnap,
      snaps.draftSnap,
      snaps.caseSnap,
      snaps.handoffSnap,
      snaps.qcatDocSnap,
      snaps.alignmentSnap,
      snaps.rightsDecisionSnap,
      snaps.orgSnap,
      snaps.sourceSnap
    );

    if (!evalResult.ok) {
      return makeGetHoldDto(
        receiptId,
        evalResult.errorCode,
        evalResult.errorMessage
      );
    }

    const chain = evalResult.chain;
    const publicDocumentId = deriveReviewedPublicLibraryDocumentId(receiptId);
    const qcatDocumentId = deriveQuarantineCatalogDocumentId(receiptId);

    let isPublished = false;
    let releaseDto: SanitizedReviewedLibrarySourceReleaseDto | null = null;
    let publicDocDto: SanitizedPublishedLibraryDocumentSummaryDto | null = null;

    const anyReleaseExists =
      snaps.releaseSnap.exists ||
      snaps.publicDocSnap.exists ||
      snaps.releaseEventSnap.exists;

    if (anyReleaseExists) {
      if (
        !snaps.releaseSnap.exists ||
        !snaps.publicDocSnap.exists ||
        !snaps.releaseEventSnap.exists
      ) {
        return makeGetHoldDto(
          receiptId,
          'INCONSISTENT_RELEASE_STATE',
          'Partial reviewed source release artifacts detected in Firestore.'
        );
      }

      const releaseValidation = validatePersistedReleaseRecord(
        snaps.releaseSnap.data(),
        receiptId
      );
      if (!releaseValidation.ok) {
        return makeGetHoldDto(
          receiptId,
          releaseValidation.errorCode,
          releaseValidation.errorMessage
        );
      }
      const pubDocValidation = validatePersistedPublishedLibraryDocument(
        snaps.publicDocSnap.data(),
        publicDocumentId,
        releaseValidation.release
      );
      if (!pubDocValidation.ok) {
        return makeGetHoldDto(
          receiptId,
          pubDocValidation.errorCode,
          pubDocValidation.errorMessage
        );
      }

      isPublished = true;
      releaseDto = toSanitizedReleaseDto(releaseValidation.release);
      publicDocDto = toSanitizedPublicDocumentSummaryDto(
        pubDocValidation.document
      );
    }

    return Object.freeze({
      ok: true,
      status: 'READY',
      receiptId,
      quarantineCatalogDocumentId: qcatDocumentId,
      publicDocumentId,
      eligibleForPublish: chain.eligibleForPublish,
      blockCode: chain.blockCode,
      blockMessage: chain.blockMessage,
      isPublished,
      quarantineDraftWorkflowState: WorkflowState.Draft,
      quarantineBinaryExposed: false,
      currentHumanCaseRevision: chain.humanReviewCase.revision,
      effectiveAlignedCaseRevision: chain.effectiveAlignedCaseRevision,
      currentAlignmentRevision: chain.currentAlignmentRevision,
      catalogUpdatedAt: chain.sanitizedCatalogDocument.updatedAt,
      catalogAligned: chain.catalogAligned,
      currentRightsDecisionRevision: chain.rightsDecision?.revision ?? null,
      currentRightsDecision: chain.rightsDecision?.decision ?? null,
      currentRightsBasis: chain.rightsDecision?.basis ?? null,
      rightsAuthorizedForMetadata: chain.rightsAuthorizedForMetadata,
      organizationId: chain.organization.id,
      organizationNameAr: chain.organization.nameAr,
      organizationNameEn: chain.organization.nameEn,
      sourceId: chain.source.id,
      sourceNameAr: chain.source.sourceNameAr,
      sourceNameEn: chain.source.sourceNameEn,
      sourceVerified: chain.sourceVerified,
      suggestedPublisherBaseUrl: chain.suggestedPublisherBaseUrl,
      catalogTitleAr: chain.sanitizedCatalogDocument.titleAr,
      catalogTitleEn: chain.sanitizedCatalogDocument.titleEn,
      releaseRecord: releaseDto,
      publicDocument: publicDocDto,
    });
  }

  public async publishReviewedLibrarySourceReference(
    rawInput: PublishReviewedLibrarySourceReferenceInput
  ): Promise<PublishReviewedLibrarySourceReferenceResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makePublishHoldDto(
        null,
        'INVALID_RELEASE_PAYLOAD',
        'Publish request payload must be a plain object.'
      );
    }

    const receiptCandidate =
      typeof rawInput.receiptId === 'string' ? rawInput.receiptId : null;

    if (!hasOnlyAllowedKeys(rawInput, ALLOWED_PUBLISH_REQUEST_KEYS)) {
      return makePublishHoldDto(
        receiptCandidate,
        'INVALID_RELEASE_PAYLOAD',
        'Publish request payload contains unexpected or forbidden fields.'
      );
    }

    if (!isValidLibraryQuarantineReceiptId(rawInput.receiptId)) {
      return makePublishHoldDto(
        receiptCandidate,
        'INVALID_RECEIPT_ID',
        'receiptId must be a 32-character lowercase hexadecimal string.'
      );
    }
    const receiptId = rawInput.receiptId;

    if (
      !isPositiveSafeInteger(rawInput.expectedHumanCaseRevision) ||
      typeof rawInput.expectedCatalogUpdatedAt !== 'string' ||
      !isValidIsoUtcTimestamp(rawInput.expectedCatalogUpdatedAt) ||
      !isNonNegativeSafeInteger(rawInput.expectedAlignmentRevision) ||
      !isPositiveSafeInteger(rawInput.expectedRightsDecisionRevision)
    ) {
      return makePublishHoldDto(
        receiptId,
        'INVALID_RELEASE_PAYLOAD',
        'Missing or invalid compare-and-swap precondition fields.'
      );
    }

    if (
      rawInput.confirmation !== LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL
    ) {
      return makePublishHoldDto(
        receiptId,
        'CONFIRMATION_REQUIRED',
        `Explicit human confirmation must equal ${LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL}.`
      );
    }

    const editorialCheck = validateReviewedSourceReleaseEditorialInput(
      rawInput.input
    );
    if (!editorialCheck.ok) {
      return makePublishHoldDto(
        receiptId,
        editorialCheck.errorCode,
        editorialCheck.errorMessage
      );
    }
    const editorial = editorialCheck.value;

    const auth = await this.resolveAuthorizedActor();
    if (!auth.ok) {
      return makePublishHoldDto(receiptId, auth.errorCode, auth.errorMessage);
    }

    const qcatDocumentId = deriveQuarantineCatalogDocumentId(receiptId);
    const publicDocumentId = deriveReviewedPublicLibraryDocumentId(receiptId);
    const eventId = deriveReviewedSourceReleaseEventId(receiptId, 1);

    let writesStaged = false;

    try {
      const txResult =
        await this.db.runTransaction<PublishReviewedLibrarySourceReferenceResponseDto>(
          async (tx: LibraryQuarantineReviewDraftFirestoreTransaction) => {
            const snaps = await this.readChainSnapshots(receiptId, (ref) =>
              tx.get(ref)
            );
            if (!snaps.ok) {
              throw new PreWriteReleaseHoldError(
                snaps.errorCode,
                snaps.errorMessage
              );
            }

            const evalResult = evaluateReleaseChainSnapshots(
              receiptId,
              snaps.receiptSnap,
              snaps.draftSnap,
              snaps.caseSnap,
              snaps.handoffSnap,
              snaps.qcatDocSnap,
              snaps.alignmentSnap,
              snaps.rightsDecisionSnap,
              snaps.orgSnap,
              snaps.sourceSnap
            );

            if (!evalResult.ok) {
              throw new PreWriteReleaseHoldError(
                evalResult.errorCode,
                evalResult.errorMessage
              );
            }

            const chain = evalResult.chain;

            if (!chain.eligibleForPublish || chain.blockCode !== null) {
              throw new PreWriteReleaseHoldError(
                chain.blockCode ?? 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK',
                chain.blockMessage ??
                  'Reviewed catalog record does not satisfy publication prerequisites.'
              );
            }

            // Check existing published artifacts for idempotency vs conflict
            const anyReleaseExists =
              snaps.releaseSnap.exists ||
              snaps.publicDocSnap.exists ||
              snaps.releaseEventSnap.exists;

            if (anyReleaseExists) {
              if (
                !snaps.releaseSnap.exists ||
                !snaps.publicDocSnap.exists ||
                !snaps.releaseEventSnap.exists
              ) {
                throw new PreWriteReleaseHoldError(
                  'INCONSISTENT_RELEASE_STATE',
                  'Partial reviewed source release artifacts already exist in Firestore.'
                );
              }

              const releaseValidation = validatePersistedReleaseRecord(
                snaps.releaseSnap.data(),
                receiptId
              );
              if (!releaseValidation.ok) {
                throw new PreWriteReleaseHoldError(
                  releaseValidation.errorCode,
                  releaseValidation.errorMessage
                );
              }
              const existingRelease = releaseValidation.release;
              const pubDocValidation = validatePersistedPublishedLibraryDocument(
                snaps.publicDocSnap.data(),
                publicDocumentId,
                existingRelease
              );
              if (!pubDocValidation.ok) {
                throw new PreWriteReleaseHoldError(
                  pubDocValidation.errorCode,
                  pubDocValidation.errorMessage
                );
              }

              const releaseDto = toSanitizedReleaseDto(existingRelease);
              const pubDocDto = toSanitizedPublicDocumentSummaryDto(
                pubDocValidation.document
              );

              const isExactIdempotentReplay =
                existingRelease.sourceRevision ===
                  chain.receiptEnvelope.revision &&
                existingRelease.alignedHumanCaseRevision ===
                  rawInput.expectedHumanCaseRevision &&
                existingRelease.alignmentRevision ===
                  rawInput.expectedAlignmentRevision &&
                existingRelease.catalogUpdatedAt ===
                  rawInput.expectedCatalogUpdatedAt &&
                existingRelease.rightsDecisionRevision ===
                  rawInput.expectedRightsDecisionRevision &&
                existingRelease.publicRightsStatus ===
                  editorial.publicRightsStatus &&
                existingRelease.publicLinkBasis === editorial.publicLinkBasis &&
                existingRelease.verifiedSourceUrl ===
                  editorial.verifiedSourceUrl &&
                existingRelease.rightsEvidenceReference ===
                  editorial.rightsEvidenceReference &&
                existingRelease.rightsEvidenceSummary ===
                  editorial.rightsEvidenceSummary &&
                existingRelease.releaseNotes === editorial.releaseNotes;

              if (isExactIdempotentReplay) {
                return Object.freeze({
                  ok: true,
                  status: 'ALREADY_PUBLISHED' as const,
                  releaseOutcome: 'ALREADY_PUBLISHED' as const,
                  publishedChanged: false,
                  published: true,
                  receiptId,
                  quarantineCatalogDocumentId: qcatDocumentId,
                  publicDocumentId,
                  releaseRecord: releaseDto,
                  publicDocument: pubDocDto,
                  quarantineDraftRemainsDraft: true,
                  quarantineBinaryExposed: false,
                });
              }

              throw new PreWriteReleaseConflictError(
                'RELEASE_ALREADY_EXISTS_CONFLICT',
                'ALREADY_PUBLISHED',
                'A public reviewed source release already exists for this receipt with different release parameters or provenance.',
                chain.humanReviewCase.revision,
                chain.effectiveAlignedCaseRevision,
                chain.currentAlignmentRevision,
                chain.sanitizedCatalogDocument.updatedAt,
                chain.rightsDecision?.revision ?? null,
                releaseDto,
                pubDocDto
              );
            }

            // CAS precondition check before publishing
            if (
              rawInput.expectedHumanCaseRevision !==
                chain.humanReviewCase.revision ||
              rawInput.expectedCatalogUpdatedAt !==
                chain.sanitizedCatalogDocument.updatedAt ||
              rawInput.expectedAlignmentRevision !==
                chain.currentAlignmentRevision ||
              rawInput.expectedRightsDecisionRevision !==
                (chain.rightsDecision?.revision ?? -1)
            ) {
              throw new PreWriteReleaseConflictError(
                'RELEASE_PRECONDITION_CONFLICT',
                'NOT_PUBLISHED',
                'Catalog draft, human review case, alignment, or rights decision changed concurrently; refresh release readiness before publishing.',
                chain.humanReviewCase.revision,
                chain.effectiveAlignedCaseRevision,
                chain.currentAlignmentRevision,
                chain.sanitizedCatalogDocument.updatedAt,
                chain.rightsDecision?.revision ?? null,
                null,
                null
              );
            }

            const nowIso = this.clock();
            if (
              !isValidIsoUtcTimestamp(nowIso) ||
              Date.parse(nowIso) <
                Date.parse(chain.receiptEnvelope.receipt.updatedAt) ||
              Date.parse(nowIso) < Date.parse(chain.humanReviewCase.updatedAt) ||
              Date.parse(nowIso) <
                Date.parse(chain.sanitizedCatalogDocument.updatedAt) ||
              Date.parse(nowIso) <
                Date.parse(chain.rightsDecision!.updatedAt)
            ) {
              throw new PreWriteReleaseHoldError(
                'INVALID_TIMESTAMP',
                'Release timestamp must be a valid canonical ISO-8601 UTC timestamp not preceding upstream review records.'
              );
            }

            const qcatDoc = chain.rawCatalogDocument;
            const transitionBase = `${receiptId}-qsrc-1`;
            const workflowHistory: WorkflowTransitionRecord[] = [
              {
                id: `${transitionBase}-submit`,
                fromState: WorkflowState.Draft,
                toState: WorkflowState.InReview,
                action: WorkflowAction.SubmitForReview,
                actorName: auth.admin.name,
                actorRole: auth.admin.role,
                timestamp: nowIso,
                comment: 'Reviewed quarantine catalog draft submitted for external source release.',
              },
              {
                id: `${transitionBase}-approve`,
                fromState: WorkflowState.InReview,
                toState: WorkflowState.Approved,
                action: WorkflowAction.Approve,
                actorName: auth.admin.name,
                actorRole: auth.admin.role,
                timestamp: nowIso,
                comment: 'Human editorial alignment and external link rights verified.',
              },
              {
                id: `${transitionBase}-publish`,
                fromState: WorkflowState.Approved,
                toState: WorkflowState.Published,
                action: WorkflowAction.Publish,
                actorName: auth.admin.name,
                actorRole: auth.admin.role,
                timestamp: nowIso,
                comment: 'Published regular public catalog entry linked strictly to verified external publisher URL.',
              },
            ];

            const publicDocument: LibraryDocument = {
              id: publicDocumentId,
              titleAr: qcatDoc.titleAr,
              titleEn: qcatDoc.titleEn,
              ...(qcatDoc.originalTitle
                ? { originalTitle: qcatDoc.originalTitle }
                : {}),
              documentType: qcatDoc.documentType,
              organizationId: qcatDoc.organizationId,
              sourceId: qcatDoc.sourceId,
              geographyAr: qcatDoc.geographyAr,
              geographyEn: qcatDoc.geographyEn,
              publicationDate: qcatDoc.publicationDate,
              language: qcatDoc.language,
              summaryAr: qcatDoc.summaryAr,
              summaryEn: qcatDoc.summaryEn,
              topicsAr: [...qcatDoc.topicsAr],
              topicsEn: [...qcatDoc.topicsEn],
              environmentalDomains: [...qcatDoc.environmentalDomains],
              rightsStatus: editorial.publicRightsStatus,
              rightsNotesAr:
                'تم نشر السجل المفهرس وربطه بالرابط الرسمي الموثّق للمصدر الأصلي بعد التحقق البشري من الحقوق دون إتاحة أي ملف محجور.',
              rightsNotesEn:
                'Published reviewed catalog record linked strictly to the verified external publisher URL after human rights clearance; no uploaded binary is served.',
              workflowState: WorkflowState.Published,
              workflowHistory,
              legalStatusDescriptionAr: qcatDoc.legalStatusDescriptionAr,
              legalStatusDescriptionEn: qcatDoc.legalStatusDescriptionEn,
              createdAt: nowIso,
              updatedAt: nowIso,
              versions: [
                {
                  id: `${publicDocumentId}-v1`,
                  documentId: publicDocumentId,
                  versionNumber: '1.0',
                  publishedDate: qcatDoc.publicationDate,
                  changeDescriptionAr:
                    'إصدار عام مرتبط برابط المصدر الرسمي الموثّق',
                  changeDescriptionEn:
                    'Public release linked to verified official publisher URL',
                  referenceUrl: editorial.verifiedSourceUrl,
                },
              ],
            };

            try {
              LibraryValidator.validatePersistedDocument(
                publicDocument,
                publicDocumentId
              );
            } catch (valErr) {
              throw new PreWriteReleaseHoldError(
                'PUBLIC_DOCUMENT_VALIDATION_FAILED',
                valErr instanceof Error
                  ? valErr.message
                  : 'Public LibraryDocument failed schema validation.'
              );
            }

            const persistedRelease: LibraryQuarantinePersistedReviewedSourceRelease =
              Object.freeze({
                schemaVersion: LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION,
                receiptId,
                sourceCatalogDocumentId: qcatDocumentId,
                publicDocumentId,
                releaseRevision: 1,
                sourceRevision: chain.receiptEnvelope.revision,
                sourceUpdatedAt: chain.receiptEnvelope.receipt.updatedAt,
                sourceSha256: chain.receiptEnvelope.receipt.sha256,
                draftSourceRevision: chain.reviewDraft.sourceRevision,
                catalogHandoffCaseRevision: chain.catalogHandoff.caseRevision,
                alignedHumanCaseRevision: chain.humanReviewCase.revision,
                alignedHumanCaseUpdatedAt: chain.humanReviewCase.updatedAt,
                alignmentRevision: chain.currentAlignmentRevision,
                catalogUpdatedAt: chain.sanitizedCatalogDocument.updatedAt,
                rightsDecisionRevision: chain.rightsDecision!.revision,
                organizationId: chain.organization.id,
                sourceId: chain.source.id,
                publicRightsStatus: editorial.publicRightsStatus,
                publicLinkBasis: editorial.publicLinkBasis,
                rightsEvidenceReference: editorial.rightsEvidenceReference,
                rightsEvidenceSummary: editorial.rightsEvidenceSummary,
                releaseNotes: editorial.releaseNotes,
                verifiedSourceUrl: editorial.verifiedSourceUrl,
                publishedBy: auth.actorUid,
                publishedAt: nowIso,
                quarantineBinaryExposed: false,
                quarantineDraftRemainsDraft: true,
              });

            const persistedReleaseEvent: LibraryQuarantinePersistedReviewedSourceReleaseEvent =
              Object.freeze({
                schemaVersion: LIBRARY_REVIEWED_SOURCE_RELEASE_SCHEMA_VERSION,
                eventId,
                receiptId,
                sourceCatalogDocumentId: qcatDocumentId,
                publicDocumentId,
                releaseRevision: 1,
                eventType: 'PUBLISHED_EXTERNAL_SOURCE_REFERENCE',
                sourceRevision: chain.receiptEnvelope.revision,
                sourceUpdatedAt: chain.receiptEnvelope.receipt.updatedAt,
                sourceSha256: chain.receiptEnvelope.receipt.sha256,
                draftSourceRevision: chain.reviewDraft.sourceRevision,
                catalogHandoffCaseRevision: chain.catalogHandoff.caseRevision,
                alignedHumanCaseRevision: chain.humanReviewCase.revision,
                alignmentRevision: chain.currentAlignmentRevision,
                catalogUpdatedAt: chain.sanitizedCatalogDocument.updatedAt,
                rightsDecisionRevision: chain.rightsDecision!.revision,
                organizationId: chain.organization.id,
                sourceId: chain.source.id,
                publicRightsStatus: editorial.publicRightsStatus,
                publicLinkBasis: editorial.publicLinkBasis,
                verifiedSourceUrl: editorial.verifiedSourceUrl,
                actorUid: auth.actorUid,
                recordedAt: nowIso,
                quarantineBinaryExposed: false,
              });

            this.assertAllowedWriteCollection(LIBRARY_DOCUMENTS_COLLECTION);
            this.assertAllowedWriteCollection(
              LIBRARY_REVIEWED_SOURCE_RELEASES_COLLECTION
            );
            this.assertAllowedWriteCollection(
              LIBRARY_REVIEWED_SOURCE_RELEASE_EVENTS_COLLECTION
            );

            const publicDocRef = this.db
              .collection(LIBRARY_DOCUMENTS_COLLECTION)
              .doc(publicDocumentId);
            const releaseRef = this.db
              .collection(LIBRARY_REVIEWED_SOURCE_RELEASES_COLLECTION)
              .doc(receiptId);
            const releaseEventRef = this.db
              .collection(LIBRARY_REVIEWED_SOURCE_RELEASE_EVENTS_COLLECTION)
              .doc(eventId);

            writesStaged = true;
            await Promise.resolve(
              tx.create(publicDocRef, toFirestoreDocumentData(publicDocument))
            );
            await Promise.resolve(
              tx.create(releaseRef, toFirestoreDocumentData(persistedRelease))
            );
            await Promise.resolve(
              tx.create(
                releaseEventRef,
                toFirestoreDocumentData(persistedReleaseEvent)
              )
            );

            return Object.freeze({
              ok: true,
              status: 'PUBLISHED' as const,
              releaseOutcome: 'PUBLISHED' as const,
              publishedChanged: true,
              published: true,
              receiptId,
              quarantineCatalogDocumentId: qcatDocumentId,
              publicDocumentId,
              releaseRecord: toSanitizedReleaseDto(persistedRelease),
              publicDocument: toSanitizedPublicDocumentSummaryDto(publicDocument),
              quarantineDraftRemainsDraft: true,
              quarantineBinaryExposed: false,
            });
          }
        );

      return txResult;
    } catch (err: unknown) {
      if (err instanceof PreWriteReleaseHoldError) {
        return makePublishHoldDto(receiptId, err.errorCode, err.errorMessage);
      }
      if (err instanceof PreWriteReleaseConflictError) {
        return Object.freeze({
          ok: false,
          status: 'CONFLICT',
          releaseOutcome: err.releaseOutcome,
          published: false,
          errorCode: err.errorCode,
          errorMessage: err.errorMessage,
          receiptId,
          quarantineCatalogDocumentId: qcatDocumentId,
          publicDocumentId,
          currentHumanCaseRevision: err.currentHumanCaseRevision,
          effectiveAlignedCaseRevision: err.effectiveAlignedCaseRevision,
          currentAlignmentRevision: err.currentAlignmentRevision,
          currentCatalogUpdatedAt: err.currentCatalogUpdatedAt,
          currentRightsDecisionRevision: err.currentRightsDecisionRevision,
          releaseRecord: err.releaseRecord,
          publicDocument: err.publicDocument,
          quarantineBinaryExposed: false,
        });
      }
      if (writesStaged) {
        return makePublishUnknownDto(receiptId);
      }
      return makePublishHoldDto(
        receiptId,
        'TRANSACTION_ABORTED_NO_WRITE',
        'Reviewed source release transaction aborted before staging writes.'
      );
    }
  }
}
