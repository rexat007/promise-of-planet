import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
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
import { LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION } from './firestoreLibraryQuarantineRightsDecisionStore';
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
import { LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION } from './firestoreLibraryQuarantineBinarySafetyCaseStore';
import {
  isMatchingSourceFormatAndDeepInspection,
  isValidSha256Hex,
  validatePersistedLibraryQuarantineBinarySafetyCase,
  type LibraryQuarantineBinarySafetyDeepInspectionStatus,
  type LibraryQuarantineBinarySafetySourceFormat,
  type LibraryQuarantinePersistedBinarySafetyCase,
} from './libraryQuarantineBinarySafetyCaseContract';
import { LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION } from './firestoreLibraryQuarantineIsolatedInspectionRequestStore';
import {
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  validatePersistedLibraryQuarantineIsolatedInspectionRequest,
  type LibraryQuarantinePersistedIsolatedInspectionRequest,
} from './libraryQuarantineIsolatedInspectionRequestContract';
import {
  LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION,
  arePersistedAvExecutionProvenanceIncompatible,
  validatePersistedLibraryQuarantineAvExecution,
  type LibraryQuarantineAvExecutionState,
  type LibraryQuarantinePersistedAvExecution,
} from './libraryQuarantineAvExecutionContract';
import {
  LIBRARY_QUARANTINE_PDF_INSPECTIONS_COLLECTION,
  arePersistedPdfInspectionProvenanceIncompatible,
  inspectPdfBytesStructurally,
  validatePersistedLibraryQuarantinePdfInspection,
} from './libraryIsolatedPdfInspection';
import {
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
} from './libraryQuarantineUploadEndpoint';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
  type LibraryUploadCanonicalMimeType,
} from './libraryUploadBinaryAdmission';
import { inspectLibraryUploadDeepStructure } from './libraryUploadDeepStructure';
import {
  parseCanonicalSafeGcsGeneration,
  type GcsLibraryQuarantineObjectMetadata,
  type GcsLibraryQuarantineReadableStream,
} from './gcsLibraryQuarantineStorageAdapter';
import {
  deriveLibraryQuarantineStoragePath,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import type {
  TrustedQuarantineAuthenticatedPrincipal,
  TrustedQuarantineReviewerPrincipalProvider,
} from './libraryQuarantineReviewDraftPersistenceService';

/**
 * LIB-DIRECT-FILE-01 — Published Binary Release Service (`doc-qbin-<receiptId>`)
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Enables an active, authorized human Library administrator holding ALL FOUR
 *   permissions (`Review`, `ManageRights`, `Approve`, `Publish`) in AdminDomain.Library
 *   to promote a cleanly AV-scanned, catalog-aligned, explicitly binary-rights-authorized
 *   quarantined PDF or DOCX file into a private immutable released copy under
 *   `library/released/<receiptId>/v1/document.<pdf|docx>` and publish a regular
 *   `LibraryDocument` with deterministic ID `doc-qbin-<receiptId>`.
 * - Reuses existing quarantine upload receipts, review drafts, human review cases,
 *   catalog handoffs, catalog-case alignments, binary safety cases, and real
 *   ClamAV terminal execution results (`AV_NO_THREAT_DETECTED`). Never fabricates
 *   scan results, never mutates `qcat-<receiptId>` out of `WorkflowState.Draft`,
 *   never overwrites `library_quarantine_rights_decisions/<receiptId>`, and never
 *   alters the independent `doc-qsrc-<receiptId>` external-link flow.
 * - Requires an explicit human binary distribution authorization and verifiable
 *   evidence; rejects `CATALOG_METADATA_ONLY` / `METADATA_USE_CLEARED` substitutes.
 *   When a prior rights decision (`RESTRICTED`, etc.) exists, requires explicit
 *   human contradiction resolution acknowledgement and explanation while keeping
 *   the prior rights decision immutable.
 * - Preserves `isSanitized: false` and `isVerifiedSafe: false` truthfully: ClamAV
 *   and OOXML structural checks do not constitute binary content sanitization, and
 *   visitors receive the uploaded file strictly as `Content-Disposition: attachment`.
 */

export const LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION = 1 as const;

export const LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION =
  'library_published_binary_releases' as const;

export const LIBRARY_PUBLISHED_BINARY_RELEASE_EVENTS_COLLECTION =
  'library_published_binary_release_events' as const;

export const LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL =
  'CONFIRM_PUBLISH_QUARANTINED_BINARY_TO_PUBLIC_LIBRARY' as const;

export const PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_PREFIX = 'doc-qbin-' as const;
export const PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_REGEX =
  /^doc-qbin-[0-9a-f]{32}$/;

export const LIBRARY_RELEASED_STORAGE_PREFIX = 'library/released' as const;

export const DEFAULT_LIBRARY_PUBLISHED_BINARY_DOWNLOAD_BASE_URL =
  'https://us-central1-promiseofplanet-bb325.cloudfunctions.net/libraryPublishedBinaryDownload' as const;

export const LIBRARY_PUBLISHED_BINARY_DOWNLOAD_URL_ENV_VAR =
  'POP_LIBRARY_PUBLISHED_BINARY_DOWNLOAD_URL' as const;

export const PUBLISHED_BINARY_CACHE_CONTROL =
  'private, no-store, max-age=0' as const;
export const PUBLISHED_BINARY_CONTENT_DISPOSITION = 'attachment' as const;

export const PUBLISHED_BINARY_PUBLIC_RIGHTS_STATUSES = Object.freeze([
  LibraryRightsStatus.OpenPubliclyAvailable,
  LibraryRightsStatus.PermissionGranted,
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

export const BINARY_RELEASE_EVIDENCE_REFERENCE_MAX_LENGTH = 500 as const;
export const BINARY_RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH = 2000 as const;
export const BINARY_RELEASE_NOTES_MAX_LENGTH = 1000 as const;
export const BINARY_DOWNLOAD_FILENAME_MAX_LENGTH = 180 as const;

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const BIDI_OR_INVISIBLE_FORMAT_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;
const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;
const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|blob\s*:|gs:\/\/|library\/quarantine\/|library\/released\/|firebasestorage\.googleapis\.com|firebasestorage\.app|storage\.googleapis\.com|x-goog-signature|\.\.\/|\.\.\\)/i;

const FORBIDDEN_FILENAME_CHARS_REGEX = /[\\/:*?"<>|%$;`]/;

const ALLOWED_GET_INPUT_KEYS: ReadonlySet<string> = new Set(['receiptId']);

const ALLOWED_PUBLISH_REQUEST_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedHumanCaseRevision',
  'expectedCatalogUpdatedAt',
  'expectedAlignmentRevision',
  'expectedSafetyCaseRevision',
  'expectedAvRequestId',
  'expectedPriorRightsDecisionRevision',
  'confirmation',
  'input',
]);

const ALLOWED_PUBLISH_INPUT_KEYS: ReadonlySet<string> = new Set([
  'publicRightsStatus',
  'binaryRightsBasis',
  'rightsEvidenceReference',
  'rightsEvidenceSummary',
  'releaseNotes',
  'downloadFilename',
  'acknowledgePriorRestrictedDecision',
  'contradictionResolutionSummary',
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
  'releasedStoragePath',
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
  LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION,
  LIBRARY_PUBLISHED_BINARY_RELEASE_EVENTS_COLLECTION,
]);

const PERSISTED_RELEASE_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'sourceCatalogDocumentId',
  'publicDocumentId',
  'releaseRevision',
  'status',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'sourceGeneration',
  'sourceByteSize',
  'format',
  'canonicalMimeType',
  'deepInspectionStatus',
  'draftSourceRevision',
  'catalogHandoffCaseRevision',
  'alignedHumanCaseRevision',
  'alignedHumanCaseUpdatedAt',
  'alignmentRevision',
  'catalogUpdatedAt',
  'safetyCaseRevision',
  'avRequestId',
  'avExecutionState',
  'avCompletedAt',
  'avEngineName',
  'avEngineVersion',
  'avSignatureVersion',
  'avSignatureUpdatedAt',
  'priorRightsDecisionRevision',
  'priorRightsDecision',
  'priorRightsBasis',
  'contradictionResolutionRequired',
  'contradictionResolutionSummary',
  'organizationId',
  'sourceId',
  'publicRightsStatus',
  'binaryRightsBasis',
  'rightsEvidenceReference',
  'rightsEvidenceSummary',
  'releaseNotes',
  'downloadFilename',
  'releasedBucketName',
  'releasedStoragePath',
  'releasedObjectGeneration',
  'downloadGatewayUrl',
  'publishedBy',
  'publishedAt',
  'isSanitized',
  'isVerifiedSafe',
  'quarantineSourceExposed',
  'quarantineDraftRemainsDraft',
]);

export interface PublishedBinaryStorageSavePreconditions {
  readonly ifGenerationMatch: 0;
}

export interface PublishedBinaryStorageSaveOptions {
  readonly contentType: LibraryUploadCanonicalMimeType;
  readonly resumable: false;
  readonly preconditionOpts: PublishedBinaryStorageSavePreconditions;
  readonly preconditions: PublishedBinaryStorageSavePreconditions;
  readonly metadata: {
    readonly cacheControl: typeof PUBLISHED_BINARY_CACHE_CONTROL;
    readonly contentDisposition: typeof PUBLISHED_BINARY_CONTENT_DISPOSITION;
    readonly metadata: Readonly<Record<string, string>>;
  };
}

export interface PublishedBinaryStorageFile {
  readonly name: string;
  readonly generation?: string | number;
  getMetadata(): Promise<[GcsLibraryQuarantineObjectMetadata, unknown?]>;
  createReadStream(options?: {
    readonly validation?: boolean;
    readonly start?: number;
    readonly end?: number;
  }): GcsLibraryQuarantineReadableStream;
  save(data: Buffer, options: PublishedBinaryStorageSaveOptions): Promise<void>;
}

export interface PublishedBinaryStorageBucket {
  readonly name?: string;
  file(
    objectPath: string,
    options?: { readonly generation?: string }
  ): PublishedBinaryStorageFile;
}

export type PublishedLibraryBinaryReleaseErrorCode =
  | LibraryQuarantineHumanReviewCaseErrorCode
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED_RELEASE_ACTOR'
  | 'INVALID_RECEIPT_ID'
  | 'INVALID_RELEASE_PAYLOAD'
  | 'INVALID_DOWNLOAD_URL_CONFIG'
  | 'INVALID_DOWNLOAD_FILENAME'
  | 'INVALID_PUBLIC_RIGHTS_STATUS'
  | 'INVALID_BINARY_RIGHTS_BASIS'
  | 'BINARY_RIGHTS_EVIDENCE_REQUIRED'
  | 'PRIOR_RIGHTS_CONTRADICTION_UNRESOLVED'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_PLAIN_TEXT_FIELD'
  | 'QUARANTINE_RECEIPT_NOT_FOUND'
  | 'RECEIPT_NEEDS_RECONCILIATION'
  | 'UNSUPPORTED_RECEIPT_STATE'
  | 'UNSUPPORTED_BINARY_FORMAT'
  | 'BINARY_SIZE_LIMIT_EXCEEDED'
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
  | 'ORGANIZATION_NOT_FOUND'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_ORGANIZATION_MISMATCH'
  | 'SOURCE_NOT_VERIFIED'
  | 'BINARY_SAFETY_CASE_MISSING'
  | 'BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE'
  | 'ISOLATED_INSPECTION_REQUEST_MISSING'
  | 'WAITING_FOR_ACTUAL_SCAN'
  | 'AV_THREAT_DETECTED'
  | 'AV_SCAN_NOT_CLEAN'
  | 'AV_SCAN_STALE_HOLD'
  | 'PDF_ISOLATED_PARSER_ATTESTATION_MISSING'
  | 'PDF_INSPECTION_NOT_CLEARED'
  | 'PDF_INSPECTION_STALE_HOLD'
  | 'STORAGE_BUCKET_MISCONFIGURED'
  | 'SOURCE_STORAGE_OBJECT_INVALID'
  | 'RELEASED_STORAGE_PROMOTION_FAILED'
  | 'RELEASED_OBJECT_CONFLICT'
  | 'STORAGE_INTEGRITY_ERROR'
  | 'INCONSISTENT_RELEASE_STATE'
  | 'RELEASE_PRECONDITION_CONFLICT'
  | 'RELEASE_ALREADY_EXISTS_CONFLICT'
  | 'SECURITY_POSTURE_VIOLATION'
  | 'PUBLIC_DOCUMENT_VALIDATION_FAILED'
  | 'TRANSACTION_COMMIT_UNCERTAIN'
  | 'RELEASE_PERSISTENCE_FAILED';

export interface PublishedLibraryBinaryReleaseEditorialInput {
  readonly publicRightsStatus: PublishedBinaryPublicLibraryRightsStatus;
  readonly binaryRightsBasis: PublishedBinaryRightsBasis;
  readonly rightsEvidenceReference: string;
  readonly rightsEvidenceSummary: string;
  readonly releaseNotes?: string;
  readonly downloadFilename?: string;
  readonly acknowledgePriorRestrictedDecision?: boolean;
  readonly contradictionResolutionSummary?: string;
}

export interface GetPublishedLibraryBinaryReleaseStatusInput {
  readonly receiptId: string;
}

export interface PublishQuarantinedBinaryToPublicLibraryInput {
  readonly receiptId: string;
  readonly expectedHumanCaseRevision: number;
  readonly expectedCatalogUpdatedAt: string;
  readonly expectedAlignmentRevision: number;
  readonly expectedSafetyCaseRevision: number;
  readonly expectedAvRequestId: string;
  readonly expectedPriorRightsDecisionRevision?: number | null;
  readonly confirmation: typeof LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL;
  readonly input: PublishedLibraryBinaryReleaseEditorialInput;
}

export interface LibraryQuarantinePersistedPublishedBinaryRelease {
  readonly schemaVersion: typeof LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly sourceCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRevision: number;
  readonly status: 'PUBLISHED' | 'REVOKED';
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly sourceGeneration: string;
  readonly sourceByteSize: number;
  readonly format: LibraryQuarantineBinarySafetySourceFormat;
  readonly canonicalMimeType: LibraryUploadCanonicalMimeType;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly draftSourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly alignedHumanCaseRevision: number;
  readonly alignedHumanCaseUpdatedAt: string;
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
  readonly priorRightsBasis: LibraryQuarantineRightsBasis | null;
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
  readonly releasedBucketName: string;
  readonly releasedStoragePath: string;
  readonly releasedObjectGeneration: string;
  readonly downloadGatewayUrl: string;
  readonly publishedBy: string;
  readonly publishedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly quarantineSourceExposed: false;
  readonly quarantineDraftRemainsDraft: true;
}

export interface LibraryQuarantinePersistedPublishedBinaryReleaseEvent {
  readonly schemaVersion: typeof LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION;
  readonly eventId: string;
  readonly receiptId: string;
  readonly sourceCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRevision: number;
  readonly eventType: 'PUBLISHED_QUARANTINED_BINARY_TO_PUBLIC_LIBRARY';
  readonly sourceRevision: number;
  readonly sourceSha256: string;
  readonly sourceGeneration: string;
  readonly format: LibraryQuarantineBinarySafetySourceFormat;
  readonly alignedHumanCaseRevision: number;
  readonly alignmentRevision: number;
  readonly safetyCaseRevision: number;
  readonly avRequestId: string;
  readonly priorRightsDecisionRevision: number | null;
  readonly priorRightsDecision: LibraryQuarantineRightsDecisionStatus | null;
  readonly contradictionResolutionRequired: boolean;
  readonly publicRightsStatus: PublishedBinaryPublicLibraryRightsStatus;
  readonly binaryRightsBasis: PublishedBinaryRightsBasis;
  readonly releasedStoragePath: string;
  readonly releasedObjectGeneration: string;
  readonly downloadFilename: string;
  readonly actorUid: string;
  readonly recordedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly quarantineSourceExposed: false;
}

export interface SanitizedPublishedLibraryBinaryReleaseDto {
  readonly schemaVersion: typeof LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly sourceCatalogDocumentId: string;
  readonly publicDocumentId: string;
  readonly releaseRevision: number;
  readonly status: 'PUBLISHED' | 'REVOKED';
  readonly format: LibraryQuarantineBinarySafetySourceFormat;
  readonly canonicalMimeType: LibraryUploadCanonicalMimeType;
  readonly byteSize: number;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
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
  readonly format: LibraryQuarantineBinarySafetySourceFormat;
  readonly rightsStatus: PublishedBinaryPublicLibraryRightsStatus;
  readonly workflowState: typeof WorkflowState.Published;
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
  readonly blockCode: PublishedLibraryBinaryReleaseErrorCode | null;
  readonly blockMessage: string | null;
  readonly isPublished: boolean;
  readonly quarantineDraftWorkflowState: typeof WorkflowState.Draft;
  readonly format: LibraryQuarantineBinarySafetySourceFormat;
  readonly canonicalMimeType: LibraryUploadCanonicalMimeType;
  readonly byteSize: number;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
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
  readonly avExecutionState:
    | 'NOT_REQUESTED'
    | 'NOT_DISPATCHED'
    | LibraryQuarantineAvExecutionState;
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
  readonly errorCode: PublishedLibraryBinaryReleaseErrorCode;
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
  readonly errorCode: PublishedLibraryBinaryReleaseErrorCode;
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
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
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

export function derivePublishedBinaryPublicLibraryDocumentId(
  receiptId: string
): string {
  return `${PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_PREFIX}${receiptId}`;
}

export function derivePublishedBinaryReleaseEventId(
  receiptId: string,
  releaseRevision: number
): string {
  return `${receiptId}_${releaseRevision}`;
}

export function parsePublishedBinaryPublicLibraryDocumentId(
  documentId: unknown
): string | null {
  if (
    typeof documentId !== 'string' ||
    !PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_REGEX.test(documentId)
  ) {
    return null;
  }
  return documentId.slice(PUBLISHED_BINARY_PUBLIC_DOCUMENT_ID_PREFIX.length);
}

export function deriveLibraryReleasedStoragePath(
  receiptId: string,
  format: LibraryQuarantineBinarySafetySourceFormat,
  releaseRevision = 1
): string {
  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    throw new Error('INVALID_RECEIPT_ID: Invalid receiptId for released path.');
  }
  if (!Number.isSafeInteger(releaseRevision) || releaseRevision < 1) {
    throw new Error('INVALID_RELEASE_REVISION: Invalid releaseRevision.');
  }
  const ext = format === 'PDF' ? 'pdf' : 'docx';
  return `${LIBRARY_RELEASED_STORAGE_PREFIX}/${receiptId}/v${releaseRevision}/document.${ext}`;
}

export function resolveOwnedPublishedBinaryDownloadGatewayBaseUrl(
  overrideBaseUrl?: string
):
  | { readonly ok: true; readonly baseUrl: string }
  | {
      readonly ok: false;
      readonly errorCode: 'INVALID_DOWNLOAD_URL_CONFIG';
      readonly errorMessage: string;
    } {
  const raw =
    overrideBaseUrl ??
    process.env[LIBRARY_PUBLISHED_BINARY_DOWNLOAD_URL_ENV_VAR] ??
    DEFAULT_LIBRARY_PUBLISHED_BINARY_DOWNLOAD_BASE_URL;

  if (typeof raw !== 'string' || raw.trim() !== raw || raw.length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_URL_CONFIG',
      errorMessage: 'Download gateway base URL must be a trimmed non-empty https:// URL.',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_URL_CONFIG',
      errorMessage: 'Download gateway base URL is malformed.',
    };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    host.endsWith('storage.googleapis.com') ||
    host.endsWith('firebasestorage.googleapis.com') ||
    host.endsWith('firebasestorage.app') ||
    !parsed.pathname.endsWith('/libraryPublishedBinaryDownload')
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_URL_CONFIG',
      errorMessage:
        'Download gateway base URL must target the owned https://.../libraryPublishedBinaryDownload Cloud Function.',
    };
  }
  return { ok: true, baseUrl: raw.replace(/\/+$/, '') };
}

export function buildOwnedPublishedBinaryDownloadUrl(
  publicDocumentId: string,
  baseUrlOverride?: string
): string {
  const resolved = resolveOwnedPublishedBinaryDownloadGatewayBaseUrl(baseUrlOverride);
  if (!resolved.ok) {
    throw new Error(`${resolved.errorCode}: ${resolved.errorMessage}`);
  }
  return `${resolved.baseUrl}?documentId=${publicDocumentId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return (
    (proto === Object.prototype || proto === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
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
    ? raw.normalize('NFC').replace(/\r\n?/g, '\n').trim()
    : raw.normalize('NFC').trim();

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
      message:
        'Field contains forbidden control or bidirectional formatting characters.',
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
      message:
        'Field contains forbidden URL schemes or internal quarantine/released storage paths.',
    };
  }
  return { ok: true, value: normalized };
}

export function deriveSafePublishedDownloadFilename(
  rawCandidate: string,
  format: LibraryQuarantineBinarySafetySourceFormat
):
  | { readonly ok: true; readonly filename: string }
  | {
      readonly ok: false;
      readonly errorCode: 'INVALID_DOWNLOAD_FILENAME';
      readonly errorMessage: string;
    } {
  if (typeof rawCandidate !== 'string') {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_FILENAME',
      errorMessage: 'downloadFilename must be a string.',
    };
  }
  const trimmed = rawCandidate.normalize('NFC').trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > BINARY_DOWNLOAD_FILENAME_MAX_LENGTH ||
    hasForbiddenControlOrBidiChar(trimmed, false) ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    FORBIDDEN_FILENAME_CHARS_REGEX.test(trimmed)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_FILENAME',
      errorMessage:
        'downloadFilename contains forbidden path separators, control/BiDi characters, or unsafe symbols.',
    };
  }

  const lower = trimmed.toLowerCase();
  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_FILENAME',
      errorMessage: 'Legacy .doc extension is unsupported; only PDF and DOCX are allowed.',
    };
  }

  const expectedExt = format === 'PDF' ? '.pdf' : '.docx';
  const wrongExt = format === 'PDF' ? '.docx' : '.pdf';
  if (lower.endsWith(wrongExt)) {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_FILENAME',
      errorMessage: `downloadFilename extension mismatch for authoritative format ${format}.`,
    };
  }

  const stemRaw = lower.endsWith(expectedExt)
    ? trimmed.slice(0, trimmed.length - expectedExt.length)
    : trimmed;
  const cleanedStem = stemRaw.replace(/[.\s]+$/g, '').trim();
  if (
    cleanedStem.length === 0 ||
    cleanedStem.startsWith('.') ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleanedStem)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_FILENAME',
      errorMessage: 'downloadFilename stem is invalid or reserved.',
    };
  }

  const finalFilename = `${cleanedStem}${expectedExt}`;
  if (finalFilename.length > BINARY_DOWNLOAD_FILENAME_MAX_LENGTH) {
    return {
      ok: false,
      errorCode: 'INVALID_DOWNLOAD_FILENAME',
      errorMessage: `downloadFilename exceeds ${BINARY_DOWNLOAD_FILENAME_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, filename: finalFilename };
}

export function buildSuggestedDownloadFilename(
  sanitizedFilename: string,
  format: LibraryQuarantineBinarySafetySourceFormat,
  receiptId: string
): string {
  const checked = deriveSafePublishedDownloadFilename(sanitizedFilename, format);
  if (checked.ok) {
    return checked.filename;
  }
  const ext = format === 'PDF' ? 'pdf' : 'docx';
  return `library-document-${receiptId.slice(0, 8)}.${ext}`;
}

function isRightsEvidenceMerelyCatalogMetadataOnly(summary: string): boolean {
  const lower = summary.toLowerCase();
  if (
    (lower.includes('catalog_metadata_only') ||
      lower.includes('metadata_use_cleared')) &&
    !lower.includes('binary') &&
    !lower.includes('pdf') &&
    !lower.includes('docx') &&
    !lower.includes('redistribution')
  ) {
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

export function validatePublishedBinaryReleaseEditorialInput(
  raw: unknown,
  authoritativeFormat: LibraryQuarantineBinarySafetySourceFormat,
  fallbackFilename: string,
  requiresContradictionResolution: boolean
):
  | {
      readonly ok: true;
      readonly value: {
        readonly publicRightsStatus: PublishedBinaryPublicLibraryRightsStatus;
        readonly binaryRightsBasis: PublishedBinaryRightsBasis;
        readonly rightsEvidenceReference: string;
        readonly rightsEvidenceSummary: string;
        readonly releaseNotes: string;
        readonly downloadFilename: string;
        readonly contradictionResolutionSummary: string;
      };
    }
  | {
      readonly ok: false;
      readonly errorCode: PublishedLibraryBinaryReleaseErrorCode;
      readonly errorMessage: string;
    } {
  if (!isPlainRecord(raw)) {
    return {
      ok: false,
      errorCode: 'INVALID_RELEASE_PAYLOAD',
      errorMessage: 'Binary release editorial input must be a plain object.',
    };
  }
  if (!hasOnlyAllowedKeys(raw, ALLOWED_PUBLISH_INPUT_KEYS)) {
    return {
      ok: false,
      errorCode: 'INVALID_RELEASE_PAYLOAD',
      errorMessage:
        'Binary release editorial input contains unexpected or forbidden fields.',
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
        'publicRightsStatus must strictly be OpenPubliclyAvailable or PermissionGranted.',
    };
  }

  if (
    typeof raw.binaryRightsBasis !== 'string' ||
    !(PUBLISHED_BINARY_RIGHTS_BASES as readonly string[]).includes(
      raw.binaryRightsBasis
    )
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_BINARY_RIGHTS_BASIS',
      errorMessage:
        'binaryRightsBasis must be OWNER_COPYRIGHT_BINARY_DISTRIBUTION, EXPLICIT_BINARY_REDISTRIBUTION_PERMISSION, OPEN_LICENSE_BINARY_REDISTRIBUTION, or PUBLIC_DOMAIN_BINARY_DISTRIBUTION.',
    };
  }

  const refCheck = validateSafePlainText(
    raw.rightsEvidenceReference,
    3,
    BINARY_RELEASE_EVIDENCE_REFERENCE_MAX_LENGTH,
    false
  );
  if (!refCheck.ok) {
    return {
      ok: false,
      errorCode: 'BINARY_RIGHTS_EVIDENCE_REQUIRED',
      errorMessage: `rightsEvidenceReference invalid: ${refCheck.message}`,
    };
  }

  const summaryCheck = validateSafePlainText(
    raw.rightsEvidenceSummary,
    10,
    BINARY_RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH,
    true
  );
  if (!summaryCheck.ok) {
    return {
      ok: false,
      errorCode: 'BINARY_RIGHTS_EVIDENCE_REQUIRED',
      errorMessage: `rightsEvidenceSummary invalid: ${summaryCheck.message}`,
    };
  }
  if (isRightsEvidenceMerelyCatalogMetadataOnly(summaryCheck.value)) {
    return {
      ok: false,
      errorCode: 'BINARY_RIGHTS_EVIDENCE_REQUIRED',
      errorMessage:
        'rightsEvidenceSummary must explicitly substantiate public binary file redistribution rights rather than citing CATALOG_METADATA_ONLY or METADATA_USE_CLEARED.',
    };
  }

  let releaseNotes = '';
  if (raw.releaseNotes !== undefined) {
    const notesCheck = validateSafePlainText(
      raw.releaseNotes,
      0,
      BINARY_RELEASE_NOTES_MAX_LENGTH,
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

  const filenameSource =
    raw.downloadFilename !== undefined && raw.downloadFilename !== ''
      ? raw.downloadFilename
      : fallbackFilename;
  const filenameCheck = deriveSafePublishedDownloadFilename(
    filenameSource as string,
    authoritativeFormat
  );
  if (!filenameCheck.ok) {
    return filenameCheck;
  }

  let contradictionResolutionSummary = '';
  if (requiresContradictionResolution) {
    if (raw.acknowledgePriorRestrictedDecision !== true) {
      return {
        ok: false,
        errorCode: 'PRIOR_RIGHTS_CONTRADICTION_UNRESOLVED',
        errorMessage:
          'An earlier RESTRICTED or non-cleared rights decision exists. Human acknowledgement (acknowledgePriorRestrictedDecision: true) and explicit binary-grant explanation are required.',
      };
    }
    const resCheck = validateSafePlainText(
      raw.contradictionResolutionSummary,
      10,
      BINARY_RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH,
      true
    );
    if (!resCheck.ok) {
      return {
        ok: false,
        errorCode: 'PRIOR_RIGHTS_CONTRADICTION_UNRESOLVED',
        errorMessage: `contradictionResolutionSummary invalid: ${resCheck.message}`,
      };
    }
    contradictionResolutionSummary = resCheck.value;
  } else if (raw.contradictionResolutionSummary !== undefined) {
    const resCheck = validateSafePlainText(
      raw.contradictionResolutionSummary,
      0,
      BINARY_RELEASE_EVIDENCE_SUMMARY_MAX_LENGTH,
      true
    );
    if (!resCheck.ok) {
      return {
        ok: false,
        errorCode: 'INVALID_PLAIN_TEXT_FIELD',
        errorMessage: `contradictionResolutionSummary invalid: ${resCheck.message}`,
      };
    }
    contradictionResolutionSummary = resCheck.value;
  }

  return {
    ok: true,
    value: Object.freeze({
      publicRightsStatus: raw.publicRightsStatus,
      binaryRightsBasis: raw.binaryRightsBasis as PublishedBinaryRightsBasis,
      rightsEvidenceReference: refCheck.value,
      rightsEvidenceSummary: summaryCheck.value,
      releaseNotes,
      downloadFilename: filenameCheck.filename,
      contradictionResolutionSummary,
    }),
  };
}

export function validatePersistedPublishedBinaryReleaseRecord(
  raw: unknown,
  expectedReceiptId: string
):
  | {
      readonly ok: true;
      readonly release: LibraryQuarantinePersistedPublishedBinaryRelease;
    }
  | {
      readonly ok: false;
      readonly errorCode: PublishedLibraryBinaryReleaseErrorCode;
      readonly errorMessage: string;
    } {
  if (!isPlainRecord(raw)) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage: 'Persisted binary release manifest must be a plain object.',
    };
  }
  if (
    !hasOnlyAllowedKeys(raw, PERSISTED_RELEASE_KEYS) ||
    Object.keys(raw).length !== PERSISTED_RELEASE_KEYS.size
  ) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage: 'Persisted binary release manifest schema is invalid.',
    };
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.quarantineSourceExposed !== false ||
    raw.quarantineDraftRemainsDraft !== true
  ) {
    return {
      ok: false,
      errorCode: 'SECURITY_POSTURE_VIOLATION',
      errorMessage:
        'Persisted binary release manifest violated immutable safety posture locks.',
    };
  }

  if (
    raw.schemaVersion !== LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION ||
    raw.receiptId !== expectedReceiptId ||
    raw.sourceCatalogDocumentId !==
      deriveQuarantineCatalogDocumentId(expectedReceiptId) ||
    raw.publicDocumentId !==
      derivePublishedBinaryPublicLibraryDocumentId(expectedReceiptId) ||
    !isPositiveSafeInteger(raw.releaseRevision) ||
    (raw.status !== 'PUBLISHED' && raw.status !== 'REVOKED') ||
    !isPositiveSafeInteger(raw.sourceRevision) ||
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_HEX_REGEX.test(raw.sourceSha256) ||
    parseCanonicalSafeGcsGeneration(raw.sourceGeneration) !==
      raw.sourceGeneration ||
    !isPositiveSafeInteger(raw.sourceByteSize) ||
    (raw.sourceByteSize as number) > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES ||
    !isMatchingSourceFormatAndDeepInspection(
      raw.format,
      raw.deepInspectionStatus
    ) ||
    raw.canonicalMimeType !==
      (raw.format === 'PDF'
        ? CANONICAL_PDF_MIME_TYPE
        : CANONICAL_DOCX_MIME_TYPE) ||
    !isPositiveSafeInteger(raw.draftSourceRevision) ||
    !isPositiveSafeInteger(raw.catalogHandoffCaseRevision) ||
    !isPositiveSafeInteger(raw.alignedHumanCaseRevision) ||
    typeof raw.alignedHumanCaseUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.alignedHumanCaseUpdatedAt) ||
    !isNonNegativeSafeInteger(raw.alignmentRevision) ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.catalogUpdatedAt) ||
    !isPositiveSafeInteger(raw.safetyCaseRevision) ||
    raw.avRequestId !==
      deriveLibraryQuarantineIsolatedInspectionRequestId(
        expectedReceiptId,
        raw.sourceRevision as number,
        raw.safetyCaseRevision as number
      ) ||
    raw.avExecutionState !== 'AV_NO_THREAT_DETECTED' ||
    typeof raw.avCompletedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.avCompletedAt) ||
    raw.avEngineName !== 'ClamAV' ||
    typeof raw.avEngineVersion !== 'string' ||
    typeof raw.avSignatureVersion !== 'string' ||
    typeof raw.avSignatureUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.avSignatureUpdatedAt) ||
    typeof raw.releasedBucketName !== 'string' ||
    raw.releasedBucketName !== LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME ||
    raw.releasedStoragePath !==
      deriveLibraryReleasedStoragePath(
        expectedReceiptId,
        raw.format,
        raw.releaseRevision as number
      ) ||
    parseCanonicalSafeGcsGeneration(raw.releasedObjectGeneration) !==
      raw.releasedObjectGeneration ||
    typeof raw.downloadGatewayUrl !== 'string' ||
    !raw.downloadGatewayUrl.endsWith(
      `?documentId=${derivePublishedBinaryPublicLibraryDocumentId(expectedReceiptId)}`
    ) ||
    typeof raw.publishedBy !== 'string' ||
    !isValidUploaderUid(raw.publishedBy) ||
    typeof raw.publishedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.publishedAt) ||
    typeof raw.organizationId !== 'string' ||
    raw.organizationId.trim().length === 0 ||
    typeof raw.sourceId !== 'string' ||
    raw.sourceId.trim().length === 0 ||
    typeof raw.contradictionResolutionRequired !== 'boolean'
  ) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage: 'Persisted binary release manifest metadata is invalid.',
    };
  }

  const editorialValidation = validatePublishedBinaryReleaseEditorialInput(
    {
      publicRightsStatus: raw.publicRightsStatus,
      binaryRightsBasis: raw.binaryRightsBasis,
      rightsEvidenceReference: raw.rightsEvidenceReference,
      rightsEvidenceSummary: raw.rightsEvidenceSummary,
      releaseNotes: raw.releaseNotes,
      downloadFilename: raw.downloadFilename,
      acknowledgePriorRestrictedDecision: raw.contradictionResolutionRequired
        ? true
        : undefined,
      contradictionResolutionSummary: raw.contradictionResolutionSummary,
    },
    raw.format,
    raw.downloadFilename as string,
    raw.contradictionResolutionRequired as boolean
  );
  if (!editorialValidation.ok) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage: editorialValidation.errorMessage,
    };
  }

  return {
    ok: true,
    release: Object.freeze(
      raw as unknown as LibraryQuarantinePersistedPublishedBinaryRelease
    ),
  };
}

function validatePersistedPublishedBinaryDocument(
  raw: unknown,
  expectedPublicDocId: string,
  expectedRelease: LibraryQuarantinePersistedPublishedBinaryRelease
):
  | { readonly ok: true; readonly document: LibraryDocument }
  | {
      readonly ok: false;
      readonly errorCode: PublishedLibraryBinaryReleaseErrorCode;
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
          : 'Persisted public binary library document failed validation.',
    };
  }

  if (
    doc.workflowState !== WorkflowState.Published ||
    doc.rightsStatus !== expectedRelease.publicRightsStatus ||
    doc.organizationId !== expectedRelease.organizationId ||
    doc.sourceId !== expectedRelease.sourceId ||
    doc.versions.length < 1 ||
    doc.versions[0].referenceUrl !== expectedRelease.downloadGatewayUrl
  ) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_RELEASE_STATE',
      errorMessage:
        'Persisted public binary library document does not match release provenance.',
    };
  }

  return { ok: true, document: doc };
}

function toSanitizedBinaryReleaseDto(
  release: LibraryQuarantinePersistedPublishedBinaryRelease
): SanitizedPublishedLibraryBinaryReleaseDto {
  return Object.freeze({
    schemaVersion: release.schemaVersion,
    receiptId: release.receiptId,
    sourceCatalogDocumentId: release.sourceCatalogDocumentId,
    publicDocumentId: release.publicDocumentId,
    releaseRevision: release.releaseRevision,
    status: release.status,
    format: release.format,
    canonicalMimeType: release.canonicalMimeType,
    byteSize: release.sourceByteSize,
    deepInspectionStatus: release.deepInspectionStatus,
    sourceRevision: release.sourceRevision,
    alignedHumanCaseRevision: release.alignedHumanCaseRevision,
    alignmentRevision: release.alignmentRevision,
    catalogUpdatedAt: release.catalogUpdatedAt,
    safetyCaseRevision: release.safetyCaseRevision,
    avRequestId: release.avRequestId,
    avExecutionState: release.avExecutionState,
    avCompletedAt: release.avCompletedAt,
    avEngineName: release.avEngineName,
    avEngineVersion: release.avEngineVersion,
    avSignatureVersion: release.avSignatureVersion,
    avSignatureUpdatedAt: release.avSignatureUpdatedAt,
    priorRightsDecisionRevision: release.priorRightsDecisionRevision,
    priorRightsDecision: release.priorRightsDecision,
    contradictionResolutionRequired: release.contradictionResolutionRequired,
    contradictionResolutionSummary: release.contradictionResolutionSummary,
    organizationId: release.organizationId,
    sourceId: release.sourceId,
    publicRightsStatus: release.publicRightsStatus,
    binaryRightsBasis: release.binaryRightsBasis,
    rightsEvidenceReference: release.rightsEvidenceReference,
    rightsEvidenceSummary: release.rightsEvidenceSummary,
    releaseNotes: release.releaseNotes,
    downloadFilename: release.downloadFilename,
    downloadGatewayUrl: release.downloadGatewayUrl,
    publishedAt: release.publishedAt,
    isSanitized: false,
    isVerifiedSafe: false,
    quarantineSourceExposed: false,
    quarantineDraftRemainsDraft: true,
  });
}

function toSanitizedPublicDocumentSummaryDto(
  doc: LibraryDocument,
  format: LibraryQuarantineBinarySafetySourceFormat
): SanitizedPublishedBinaryPublicDocumentDto {
  const gatewayUrl =
    doc.versions.find((v) => typeof v.referenceUrl === 'string')?.referenceUrl ??
    '';
  return Object.freeze({
    id: doc.id,
    titleAr: doc.titleAr,
    titleEn: doc.titleEn,
    organizationId: doc.organizationId,
    sourceId: doc.sourceId,
    format,
    rightsStatus: doc.rightsStatus as PublishedBinaryPublicLibraryRightsStatus,
    workflowState: WorkflowState.Published,
    downloadGatewayUrl: gatewayUrl,
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

async function readBoundedObjectBytes(
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
          message: `Streamed object size exceeded expected ${expectedByteSize} bytes.`,
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
          : 'Failed reading GCS object stream.',
    };
  }

  const combined = Buffer.concat(chunks);
  if (combined.length !== expectedByteSize || combined.length < 1) {
    return {
      ok: false,
      message: `Streamed object byte length ${combined.length} did not match expected ${expectedByteSize}.`,
    };
  }
  const sha256 = createHash('sha256').update(combined).digest('hex');
  return { ok: true, bytes: combined, sha256 };
}

interface VerifiedBinaryReleaseChainState {
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
  readonly alignmentBlockCode: PublishedLibraryBinaryReleaseErrorCode | null;
  readonly alignmentBlockMessage: string | null;
  readonly priorRightsDecision: LibraryQuarantinePersistedRightsDecision | null;
  readonly requiresContradictionResolution: boolean;
  readonly organization: LibraryOrganization;
  readonly source: LibrarySource;
  readonly sourceVerified: boolean;
  readonly safetyCase: LibraryQuarantinePersistedBinarySafetyCase | null;
  readonly inspectionRequest: LibraryQuarantinePersistedIsolatedInspectionRequest | null;
  readonly avExecution: LibraryQuarantinePersistedAvExecution | null;
  readonly avExecutionState:
    | 'NOT_REQUESTED'
    | 'NOT_DISPATCHED'
    | LibraryQuarantineAvExecutionState;
  readonly avRequestId: string | null;
  readonly isScanCleanForCurrentRevision: boolean;
  readonly eligibleForPublish: boolean;
  readonly blockCode: PublishedLibraryBinaryReleaseErrorCode | null;
  readonly blockMessage: string | null;
}

function evaluateBinaryReleaseChainSnapshots(
  receiptId: string,
  receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  draftSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  caseSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  handoffSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  qcatDocSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  alignmentSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  rightsDecisionSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  orgSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  sourceSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  safetyCaseSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  inspectionRequestSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  avExecutionSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  pdfInspectionSnap: LibraryQuarantineFirestoreDocumentSnapshot
):
  | { readonly ok: true; readonly chain: VerifiedBinaryReleaseChainState }
  | {
      readonly ok: false;
      readonly errorCode: PublishedLibraryBinaryReleaseErrorCode;
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
        'Source quarantine receipt or review draft is not eligible for binary publication.',
    };
  }
  const { receiptEnvelope, reviewDraft } = sourceVerification;
  const receipt = receiptEnvelope.receipt;

  if (
    !isMatchingSourceFormatAndDeepInspection(
      receipt.format,
      receipt.deepInspectionStatus
    )
  ) {
    return {
      ok: false,
      errorCode: 'UNSUPPORTED_BINARY_FORMAT',
      errorMessage: 'Only PDF and DOCX formats are permitted for publication.',
    };
  }
  if (
    !isPositiveSafeInteger(receipt.byteSize) ||
    receipt.byteSize > MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES
  ) {
    return {
      ok: false,
      errorCode: 'BINARY_SIZE_LIMIT_EXCEEDED',
      errorMessage: `Quarantined file size exceeds maximum limit of ${MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES} bytes.`,
    };
  }
  const canonicalGeneration = parseCanonicalSafeGcsGeneration(receipt.generation);
  if (canonicalGeneration === null || receipt.generation !== canonicalGeneration) {
    return {
      ok: false,
      errorCode: 'SOURCE_STORAGE_OBJECT_INVALID',
      errorMessage:
        'Quarantine receipt is missing a verified canonical GCS generation.',
    };
  }

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
      errorMessage:
        'Persisted human review case failed strict schema validation.',
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
        'Human review case must be in METADATA_RECORDED state with title and source evidence.',
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
      errorMessage:
        'Persisted catalog handoff provenance does not match quarantine source.',
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

  let alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null = null;
  let currentAlignmentRevision = 0;
  let effectiveAlignedCaseRevision = catalogHandoff.caseRevision;
  let effectiveAlignedCaseUpdatedAt = catalogHandoff.caseUpdatedAt;
  let catalogAligned = true;
  let alignmentBlockCode: PublishedLibraryBinaryReleaseErrorCode | null = null;
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

  // Prior catalog-metadata rights decision (optional but inspected strictly read-only)
  let priorRightsDecision: LibraryQuarantinePersistedRightsDecision | null = null;
  let requiresContradictionResolution = false;
  if (rightsDecisionSnap.exists) {
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
            : 'INCONSISTENT_RELEASE_STATE',
        errorMessage:
          'Persisted prior rights decision failed strict schema validation.',
      };
    }
    priorRightsDecision = rightsValidation.rightsDecision;
    if (
      priorRightsDecision.documentId !== qcatDocumentId ||
      priorRightsDecision.rightsScope !== LIBRARY_QUARANTINE_RIGHTS_SCOPE
    ) {
      return {
        ok: false,
        errorCode: 'INCONSISTENT_RELEASE_STATE',
        errorMessage:
          'Persisted prior rights decision does not match catalog draft provenance.',
      };
    }
    if (priorRightsDecision.decision !== 'METADATA_USE_CLEARED') {
      requiresContradictionResolution = true;
    }
  }

  // Binary Safety Case, Isolated Inspection Request, and ClamAV Execution
  let safetyCase: LibraryQuarantinePersistedBinarySafetyCase | null = null;
  let inspectionRequest: LibraryQuarantinePersistedIsolatedInspectionRequest | null =
    null;
  let avExecution: LibraryQuarantinePersistedAvExecution | null = null;
  let avExecutionState:
    | 'NOT_REQUESTED'
    | 'NOT_DISPATCHED'
    | LibraryQuarantineAvExecutionState = 'NOT_REQUESTED';
  let avRequestId: string | null = null;
  let isScanCleanForCurrentRevision = false;

  let safetyBlockCode: PublishedLibraryBinaryReleaseErrorCode | null = null;
  let safetyBlockMessage: string | null = null;

  if (!safetyCaseSnap.exists) {
    safetyBlockCode = 'BINARY_SAFETY_CASE_MISSING';
    safetyBlockMessage =
      'Binary safety case has not been saved for this receipt.';
  } else {
    const scValidation = validatePersistedLibraryQuarantineBinarySafetyCase(
      safetyCaseSnap.data(),
      receiptId
    );
    if (!scValidation.ok) {
      safetyBlockCode = 'INCONSISTENT_RELEASE_STATE';
      safetyBlockMessage = scValidation.errorMessage;
    } else {
      safetyCase = scValidation.value;
      if (
        safetyCase.sourceRevision !== receiptEnvelope.revision ||
        safetyCase.sourceUpdatedAt !== receipt.updatedAt ||
        safetyCase.sourceSha256 !== receipt.sha256 ||
        safetyCase.sourceFormat !== receipt.format ||
        safetyCase.deepInspectionStatus !== receipt.deepInspectionStatus ||
        safetyCase.effectiveHumanCaseRevision !== effectiveAlignedCaseRevision ||
        safetyCase.catalogUpdatedAt !== sanitizedCatalogDocument.updatedAt
      ) {
        safetyBlockCode = 'AV_SCAN_STALE_HOLD';
        safetyBlockMessage =
          'Saved binary safety case is stale relative to the current source file or aligned human review case revision.';
      } else if (safetyCase.disposition !== 'ISOLATED_ASSESSMENT_REQUIRED') {
        safetyBlockCode = 'BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE';
        safetyBlockMessage = `Binary safety case disposition '${safetyCase.disposition}' does not permit isolated scan clearance for public file release.`;
      } else {
        avRequestId = deriveLibraryQuarantineIsolatedInspectionRequestId(
          receiptId,
          receiptEnvelope.revision,
          safetyCase.revision
        );
        if (!inspectionRequestSnap.exists) {
          avExecutionState = 'NOT_REQUESTED';
          safetyBlockCode = 'ISOLATED_INSPECTION_REQUEST_MISSING';
          safetyBlockMessage =
            'An isolated inspection request has not been recorded for the current binary safety case revision.';
        } else {
          const reqValidation =
            validatePersistedLibraryQuarantineIsolatedInspectionRequest(
              inspectionRequestSnap.data(),
              avRequestId
            );
          if (!reqValidation.ok) {
            safetyBlockCode = 'INCONSISTENT_RELEASE_STATE';
            safetyBlockMessage = reqValidation.errorMessage;
          } else {
            inspectionRequest = reqValidation.value;
            if (
              inspectionRequest.requestId !== avRequestId ||
              inspectionRequest.sourceRevision !== receiptEnvelope.revision ||
              inspectionRequest.sourceSha256 !== receipt.sha256 ||
              inspectionRequest.safetyCaseRevision !== safetyCase.revision ||
              inspectionRequest.effectiveHumanCaseRevision !==
                effectiveAlignedCaseRevision
            ) {
              safetyBlockCode = 'AV_SCAN_STALE_HOLD';
              safetyBlockMessage =
                'Recorded isolated inspection request does not match the current source receipt or safety case revision.';
            } else if (!avExecutionSnap.exists) {
              avExecutionState = 'NOT_DISPATCHED';
              safetyBlockCode = 'WAITING_FOR_ACTUAL_SCAN';
              safetyBlockMessage =
                'WAITING_FOR_ACTUAL_SCAN: Isolated inspection request is recorded (RECORDED_NOT_DISPATCHED), but no actual ClamAV execution has completed for this file revision.';
            } else {
              const avValidation =
                validatePersistedLibraryQuarantineAvExecution(
                  avExecutionSnap.data(),
                  avRequestId
                );
              if (!avValidation.ok) {
                safetyBlockCode =
                  avValidation.errorCode === 'SECURITY_POSTURE_VIOLATION'
                    ? 'SECURITY_POSTURE_VIOLATION'
                    : 'AV_SCAN_STALE_HOLD';
                safetyBlockMessage = avValidation.errorMessage;
              } else {
                avExecution = avValidation.value;
                avExecutionState = avExecution.state;
                const provenanceIncompatible =
                  arePersistedAvExecutionProvenanceIncompatible(avExecution, {
                    requestId: avRequestId,
                    receiptId,
                    documentId: qcatDocumentId,
                    sourceRevision: receiptEnvelope.revision,
                    sourceUpdatedAt: receipt.updatedAt,
                    sourceSha256: receipt.sha256,
                    sourceGeneration: canonicalGeneration,
                    sourceByteSize: receipt.byteSize,
                    sourceFormat: receipt.format,
                    deepInspectionStatus: receipt.deepInspectionStatus,
                    safetyCaseRevision: safetyCase.revision,
                    effectiveHumanCaseRevision: effectiveAlignedCaseRevision,
                    catalogUpdatedAt: sanitizedCatalogDocument.updatedAt,
                  });
                if (provenanceIncompatible) {
                  safetyBlockCode = 'AV_SCAN_STALE_HOLD';
                  safetyBlockMessage =
                    'ClamAV execution provenance does not match the current quarantine source SHA-256, GCS generation, byteSize, or human review revision.';
                } else if (avExecution.state === 'AV_THREAT_DETECTED') {
                  safetyBlockCode = 'AV_THREAT_DETECTED';
                  safetyBlockMessage =
                    'ClamAV detected a threat in the quarantined binary; public binary release is permanently blocked.';
                } else if (
                  avExecution.state === 'DISPATCH_PENDING' ||
                  avExecution.state === 'DISPATCHED_WAITING_WORKER' ||
                  avExecution.state === 'DISPATCH_UNKNOWN' ||
                  avExecution.state === 'RUNNING'
                ) {
                  safetyBlockCode = 'WAITING_FOR_ACTUAL_SCAN';
                  safetyBlockMessage = `WAITING_FOR_ACTUAL_SCAN: Isolated ClamAV scan is currently in state '${avExecution.state}'.`;
                } else if (avExecution.state !== 'AV_NO_THREAT_DETECTED') {
                  safetyBlockCode = 'AV_SCAN_NOT_CLEAN';
                  safetyBlockMessage = `ClamAV scan state '${avExecution.state}' is not clean (AV_NO_THREAT_DETECTED required).`;
                } else if (receipt.format === 'PDF') {
                  if (!pdfInspectionSnap.exists) {
                    safetyBlockCode = 'PDF_ISOLATED_PARSER_ATTESTATION_MISSING';
                    safetyBlockMessage =
                      'Isolated PDF parser inspection attestation is missing for this PDF file revision; ClamAV scan clearance alone does not release a PDF.';
                  } else {
                    const pdfVal = validatePersistedLibraryQuarantinePdfInspection(
                      pdfInspectionSnap.data(),
                      avRequestId
                    );
                    if (!pdfVal.ok) {
                      safetyBlockCode =
                        pdfVal.errorCode === 'SECURITY_POSTURE_VIOLATION'
                          ? 'SECURITY_POSTURE_VIOLATION'
                          : 'PDF_INSPECTION_STALE_HOLD';
                      safetyBlockMessage = pdfVal.errorMessage;
                    } else if (
                      arePersistedPdfInspectionProvenanceIncompatible(
                        pdfVal.value,
                        {
                          requestId: avRequestId,
                          receiptId,
                          documentId: qcatDocumentId,
                          sourceRevision: receiptEnvelope.revision,
                          sourceUpdatedAt: receipt.updatedAt,
                          sourceSha256: receipt.sha256,
                          sourceGeneration: canonicalGeneration,
                          sourceByteSize: receipt.byteSize,
                          sourceFormat: receipt.format,
                          deepInspectionStatus: receipt.deepInspectionStatus,
                          safetyCaseRevision: safetyCase.revision,
                          effectiveHumanCaseRevision:
                            effectiveAlignedCaseRevision,
                          catalogUpdatedAt: sanitizedCatalogDocument.updatedAt,
                          workerRunId: avExecution.workerRunId,
                          avCompletedAt: avExecution.completedAt,
                        }
                      )
                    ) {
                      safetyBlockCode = 'PDF_INSPECTION_STALE_HOLD';
                      safetyBlockMessage =
                        'Isolated PDF parser attestation provenance does not match the current source SHA-256, GCS generation, byteSize, human case revision, or ClamAV worker run.';
                    } else {
                      isScanCleanForCurrentRevision = true;
                    }
                  }
                } else {
                  isScanCleanForCurrentRevision = true;
                }
              }
            }
          }
        }
      }
    }
  }

  let eligibleForPublish = true;
  let blockCode: PublishedLibraryBinaryReleaseErrorCode | null = null;
  let blockMessage: string | null = null;

  if (!catalogAligned) {
    eligibleForPublish = false;
    blockCode = alignmentBlockCode;
    blockMessage = alignmentBlockMessage;
  } else if (!sourceVerified) {
    eligibleForPublish = false;
    blockCode = 'SOURCE_NOT_VERIFIED';
    blockMessage = `Registered source ${source.id} has verificationStatus '${source.verificationStatus}' and must be Verified before binary publication.`;
  } else if (!isScanCleanForCurrentRevision) {
    eligibleForPublish = false;
    blockCode = safetyBlockCode;
    blockMessage = safetyBlockMessage;
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
      priorRightsDecision,
      requiresContradictionResolution,
      organization,
      source,
      sourceVerified,
      safetyCase,
      inspectionRequest,
      avExecution,
      avExecutionState,
      avRequestId,
      isScanCleanForCurrentRevision,
      eligibleForPublish,
      blockCode,
      blockMessage,
    }),
  };
}

class PreWriteBinaryReleaseHoldError extends Error {
  constructor(
    public readonly errorCode: PublishedLibraryBinaryReleaseErrorCode,
    public readonly errorMessage: string
  ) {
    super(`${errorCode}: ${errorMessage}`);
    this.name = 'PreWriteBinaryReleaseHoldError';
  }
}

class PreWriteBinaryReleaseConflictError extends Error {
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
    public readonly currentSafetyCaseRevision: number | null,
    public readonly currentAvRequestId: string | null,
    public readonly currentPriorRightsDecisionRevision: number | null,
    public readonly releaseRecord: SanitizedPublishedLibraryBinaryReleaseDto | null,
    public readonly publicDocument: SanitizedPublishedBinaryPublicDocumentDto | null
  ) {
    super(`${errorCode}: ${errorMessage}`);
    this.name = 'PreWriteBinaryReleaseConflictError';
  }
}

function makeGetHoldDto(
  receiptId: string | null,
  errorCode: PublishedLibraryBinaryReleaseErrorCode,
  errorMessage: string
): GetPublishedLibraryBinaryReleaseStatusHoldDto {
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
      ? derivePublishedBinaryPublicLibraryDocumentId(validReceiptId)
      : null,
    eligibleForPublish: false,
    isPublished: false,
    isSanitized: false,
    isVerifiedSafe: false,
    quarantineSourceExposed: false,
  });
}

function makePublishHoldDto(
  receiptId: string | null,
  errorCode: PublishedLibraryBinaryReleaseErrorCode,
  errorMessage: string
): PublishQuarantinedBinaryToPublicLibraryHoldDto {
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
      ? derivePublishedBinaryPublicLibraryDocumentId(validReceiptId)
      : null,
    quarantineSourceExposed: false,
    isSanitized: false,
    isVerifiedSafe: false,
  });
}

function makePublishUnknownDto(
  receiptId: string
): PublishQuarantinedBinaryToPublicLibraryUnknownDto {
  return Object.freeze({
    ok: false,
    status: 'UNKNOWN',
    releaseOutcome: 'UNKNOWN',
    published: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
    errorMessage:
      'Transaction commit confirmation was lost after staging binary publication writes. Verify current status via GET before retrying.',
    receiptId,
    quarantineCatalogDocumentId: deriveQuarantineCatalogDocumentId(receiptId),
    publicDocumentId: derivePublishedBinaryPublicLibraryDocumentId(receiptId),
    quarantineSourceExposed: false,
    isSanitized: false,
    isVerifiedSafe: false,
  });
}

export interface LibraryPublishedBinaryReleaseServiceDependencies {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly storageBucket?: PublishedBinaryStorageBucket;
  readonly downloadGatewayBaseUrl?: string;
  readonly clock?: () => string;
}

export class LibraryPublishedBinaryReleaseService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  private readonly storageBucket?: PublishedBinaryStorageBucket;
  private readonly downloadGatewayBaseUrl?: string;
  private readonly clock: () => string;

  constructor(deps: LibraryPublishedBinaryReleaseServiceDependencies) {
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
        'LibraryPublishedBinaryReleaseService requires trustedPrincipalProvider, adminRepository, and db.'
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
    this.storageBucket = deps.storageBucket;
    this.downloadGatewayBaseUrl = deps.downloadGatewayBaseUrl;
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  private assertAllowedWriteCollection(collectionName: string): void {
    if (!ALLOWED_WRITE_COLLECTIONS.has(collectionName)) {
      throw new Error(
        `FORBIDDEN_COLLECTION_WRITE: Attempted to write to collection "${collectionName}".`
      );
    }
  }

  private assertValidStorageBucket():
    | { readonly ok: true; readonly bucket: PublishedBinaryStorageBucket; readonly bucketName: string }
    | {
        readonly ok: false;
        readonly errorCode: 'STORAGE_BUCKET_MISCONFIGURED';
        readonly errorMessage: string;
      } {
    if (
      !this.storageBucket ||
      typeof this.storageBucket.file !== 'function'
    ) {
      return {
        ok: false,
        errorCode: 'STORAGE_BUCKET_MISCONFIGURED',
        errorMessage:
          'Dedicated private binary release storage bucket is not configured on the server.',
      };
    }
    const bucketName =
      typeof this.storageBucket.name === 'string' &&
      this.storageBucket.name.trim().length > 0
        ? this.storageBucket.name.trim()
        : LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME;

    if (
      bucketName === FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME ||
      bucketName !== LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    ) {
      return {
        ok: false,
        errorCode: 'STORAGE_BUCKET_MISCONFIGURED',
        errorMessage:
          'Refusing to bind binary release to a non-dedicated or default Firebase Storage bucket.',
      };
    }

    return { ok: true, bucket: this.storageBucket, bucketName };
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
            'Automated or AI accounts are strictly forbidden from publishing binary files.',
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
            'Caller must hold Review, ManageRights, Approve, and Publish permissions to publish quarantined binary files.',
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
  ): Promise<{
    readonly receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly draftSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly caseSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly handoffSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly qcatDocSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly alignmentSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly rightsDecisionSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly orgSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly sourceSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly safetyCaseSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly inspectionRequestSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly avExecutionSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly pdfInspectionSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly releaseSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly publicDocSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    readonly releaseEventSnap: LibraryQuarantineFirestoreDocumentSnapshot;
  }> {
    const qcatDocumentId = deriveQuarantineCatalogDocumentId(receiptId);
    const publicDocumentId = derivePublishedBinaryPublicLibraryDocumentId(receiptId);
    const eventId = derivePublishedBinaryReleaseEventId(receiptId, 1);

    const [
      receiptSnap,
      draftSnap,
      caseSnap,
      handoffSnap,
      qcatDocSnap,
      alignmentSnap,
      rightsDecisionSnap,
      safetyCaseSnap,
      releaseSnap,
      publicDocSnap,
      releaseEventSnap,
    ] = await Promise.all([
      getDoc(
        this.db.collection(LIBRARY_QUARANTINE_RECEIPT_COLLECTION).doc(receiptId)
      ),
      getDoc(
        this.db
          .collection(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION)
          .doc(receiptId)
      ),
      getDoc(
        this.db
          .collection(LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION)
          .doc(receiptId)
      ),
      getDoc(
        this.db
          .collection(LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION)
          .doc(receiptId)
      ),
      getDoc(this.db.collection(LIBRARY_DOCUMENTS_COLLECTION).doc(qcatDocumentId)),
      getDoc(
        this.db
          .collection(LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION)
          .doc(receiptId)
      ),
      getDoc(
        this.db
          .collection(LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION)
          .doc(receiptId)
      ),
      getDoc(
        this.db
          .collection(LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION)
          .doc(receiptId)
      ),
      getDoc(
        this.db
          .collection(LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION)
          .doc(receiptId)
      ),
      getDoc(
        this.db.collection(LIBRARY_DOCUMENTS_COLLECTION).doc(publicDocumentId)
      ),
      getDoc(
        this.db
          .collection(LIBRARY_PUBLISHED_BINARY_RELEASE_EVENTS_COLLECTION)
          .doc(eventId)
      ),
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

    const rawReceiptData = receiptSnap.exists ? receiptSnap.data() : null;
    const rawSafetyData = safetyCaseSnap.exists ? safetyCaseSnap.data() : null;
    const rawAvRequestId =
      isPlainRecord(rawReceiptData) &&
      typeof rawReceiptData.revision === 'number' &&
      Number.isSafeInteger(rawReceiptData.revision) &&
      rawReceiptData.revision >= 1 &&
      isPlainRecord(rawSafetyData) &&
      typeof rawSafetyData.revision === 'number' &&
      Number.isSafeInteger(rawSafetyData.revision) &&
      rawSafetyData.revision >= 1
        ? deriveLibraryQuarantineIsolatedInspectionRequestId(
            receiptId,
            rawReceiptData.revision,
            rawSafetyData.revision
          )
        : null;

    const emptyMissingSnap: LibraryQuarantineFirestoreDocumentSnapshot = {
      exists: false,
      id: '',
      data: () => undefined,
    };

    const [
      orgSnap,
      sourceSnap,
      inspectionRequestSnap,
      avExecutionSnap,
      pdfInspectionSnap,
    ] = await Promise.all([
      orgId.trim().length > 0
        ? getDoc(
            this.db.collection(LIBRARY_ORGANIZATIONS_COLLECTION).doc(orgId)
          )
        : Promise.resolve(emptyMissingSnap),
      sourceId.trim().length > 0
        ? getDoc(this.db.collection(LIBRARY_SOURCES_COLLECTION).doc(sourceId))
        : Promise.resolve(emptyMissingSnap),
      rawAvRequestId !== null
        ? getDoc(
            this.db
              .collection(
                LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUESTS_COLLECTION
              )
              .doc(rawAvRequestId)
          )
        : Promise.resolve(emptyMissingSnap),
      rawAvRequestId !== null
        ? getDoc(
            this.db
              .collection(LIBRARY_QUARANTINE_AV_EXECUTIONS_COLLECTION)
              .doc(rawAvRequestId)
          )
        : Promise.resolve(emptyMissingSnap),
      rawAvRequestId !== null
        ? getDoc(
            this.db
              .collection(LIBRARY_QUARANTINE_PDF_INSPECTIONS_COLLECTION)
              .doc(rawAvRequestId)
          )
        : Promise.resolve(emptyMissingSnap),
    ]);

    return {
      receiptSnap,
      draftSnap,
      caseSnap,
      handoffSnap,
      qcatDocSnap,
      alignmentSnap,
      rightsDecisionSnap,
      orgSnap,
      sourceSnap,
      safetyCaseSnap,
      inspectionRequestSnap,
      avExecutionSnap,
      pdfInspectionSnap,
      releaseSnap,
      publicDocSnap,
      releaseEventSnap,
    };
  }

  private async verifySourceAndPromoteReleasedCopy(params: {
    readonly receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
    readonly publicDocumentId: string;
    readonly avRequestId: string;
    readonly bucket: PublishedBinaryStorageBucket;
    readonly bucketName: string;
  }): Promise<
    | {
        readonly ok: true;
        readonly releasedStoragePath: string;
        readonly releasedObjectGeneration: string;
      }
    | {
        readonly ok: false;
        readonly errorCode: PublishedLibraryBinaryReleaseErrorCode;
        readonly errorMessage: string;
      }
  > {
    const { receiptEnvelope, publicDocumentId, avRequestId, bucket, bucketName } =
      params;
    const receipt = receiptEnvelope.receipt;
    const canonicalPathRes = deriveLibraryQuarantineStoragePath(
      receipt.receiptId,
      receipt.format
    );
    if (!canonicalPathRes.ok) {
      return {
        ok: false,
        errorCode: 'SOURCE_STORAGE_OBJECT_INVALID',
        errorMessage: 'Failed to derive canonical quarantine storage path.',
      };
    }
    const canonicalSourcePath = canonicalPathRes.parsed.storagePath;
    if (receipt.storagePath !== canonicalSourcePath) {
      return {
        ok: false,
        errorCode: 'SOURCE_STORAGE_OBJECT_INVALID',
        errorMessage: 'Receipt quarantine storage path does not match canonical pattern.',
      };
    }
    const sourceGeneration = receipt.generation!;

    // 1. Verify quarantined source metadata + generation-pinned bytes
    const unpinnedSourceFile = bucket.file(canonicalSourcePath);
    let sourceMeta: GcsLibraryQuarantineObjectMetadata;
    try {
      const [meta] = await unpinnedSourceFile.getMetadata();
      sourceMeta = meta;
    } catch {
      return {
        ok: false,
        errorCode: 'SOURCE_STORAGE_OBJECT_INVALID',
        errorMessage:
          'Failed to read quarantined source object metadata in dedicated bucket.',
      };
    }

    if (
      !sourceMeta ||
      (sourceMeta.bucket && sourceMeta.bucket !== bucketName) ||
      (sourceMeta.name && sourceMeta.name !== canonicalSourcePath) ||
      parseCanonicalSafeGcsGeneration(sourceMeta.generation) !==
        sourceGeneration ||
      sourceMeta.contentType !== receipt.canonicalMimeType ||
      Number(sourceMeta.size) !== receipt.byteSize ||
      hasPublicAclOrTokenExposure(sourceMeta)
    ) {
      return {
        ok: false,
        errorCode: 'SOURCE_STORAGE_OBJECT_INVALID',
        errorMessage:
          'Quarantined source object metadata failed generation, MIME, size, or privacy checks.',
      };
    }

    const pinnedSourceFile = bucket.file(canonicalSourcePath, {
      generation: sourceGeneration,
    });
    const sourceRead = await readBoundedObjectBytes(
      pinnedSourceFile,
      receipt.byteSize
    );
    if (!sourceRead.ok) {
      return {
        ok: false,
        errorCode: 'STORAGE_INTEGRITY_ERROR',
        errorMessage: sourceRead.message,
      };
    }
    if (sourceRead.sha256 !== receipt.sha256) {
      return {
        ok: false,
        errorCode: 'STORAGE_INTEGRITY_ERROR',
        errorMessage:
          'Quarantined source SHA-256 digest does not match receipt.',
      };
    }

    const sourceDeep = inspectLibraryUploadDeepStructure({
      originalFilename: receipt.originalFilename,
      claimedMimeType: receipt.canonicalMimeType,
      bytes: sourceRead.bytes,
    });
    if (
      sourceDeep.status !== receipt.deepInspectionStatus ||
      sourceDeep.format !== receipt.format ||
      sourceDeep.sha256 !== receipt.sha256
    ) {
      return {
        ok: false,
        errorCode: 'STORAGE_INTEGRITY_ERROR',
        errorMessage:
          'Quarantined source binary failed re-verification of format or deep OOXML structure.',
      };
    }

    if (receipt.format === 'PDF') {
      const pdfStructural = inspectPdfBytesStructurally(sourceRead.bytes);
      if (!pdfStructural.ok) {
        return {
          ok: false,
          errorCode: 'STORAGE_INTEGRITY_ERROR',
          errorMessage:
            'Quarantined PDF failed structural policy re-verification prior to release promotion.',
        };
      }
    }

    // 2. Write private immutable copy in library/released/<receiptId>/v1/document.<ext>
    const releasedStoragePath = deriveLibraryReleasedStoragePath(
      receipt.receiptId,
      receipt.format,
      1
    );
    const releasedFile = bucket.file(releasedStoragePath);

    const expectedReleasedCustomMeta = Object.freeze({
      receiptId: receipt.receiptId,
      publicDocumentId,
      sourceSha256: receipt.sha256,
      sourceGeneration,
      format: receipt.format,
      releaseNamespace: LIBRARY_RELEASED_STORAGE_PREFIX,
      releaseRevision: '1',
      avRequestId,
      isSanitized: 'false',
      isVerifiedSafe: 'false',
    });

    try {
      await releasedFile.save(sourceRead.bytes, {
        contentType: receipt.canonicalMimeType,
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        preconditions: { ifGenerationMatch: 0 },
        metadata: {
          cacheControl: PUBLISHED_BINARY_CACHE_CONTROL,
          contentDisposition: PUBLISHED_BINARY_CONTENT_DISPOSITION,
          metadata: expectedReleasedCustomMeta,
        },
      });
    } catch (saveErr: unknown) {
      // Check if an identical orphan copy already exists due to a prior failed Firestore commit;
      // otherwise reject deterministically!
      const errCode = (saveErr as { code?: unknown } | null)?.code;
      const errMsg =
        saveErr instanceof Error ? saveErr.message : String(saveErr);
      const looksLikePreconditionOrExists =
        errCode === 412 ||
        errCode === 409 ||
        /precondition|already exists|412/i.test(errMsg);
      if (!looksLikePreconditionOrExists) {
        return {
          ok: false,
          errorCode: 'RELEASED_STORAGE_PROMOTION_FAILED',
          errorMessage: `Failed to write immutable released binary object: ${errMsg}`,
        };
      }
    }

    // 3. Generation-pinned readback verification of the released object before Firestore tx
    let releasedMeta: GcsLibraryQuarantineObjectMetadata;
    try {
      const [meta] = await releasedFile.getMetadata();
      releasedMeta = meta;
    } catch {
      return {
        ok: false,
        errorCode: 'RELEASED_STORAGE_PROMOTION_FAILED',
        errorMessage: 'Failed to read back released binary metadata after write.',
      };
    }

    const releasedGen = parseCanonicalSafeGcsGeneration(
      releasedMeta?.generation
    );
    if (
      !releasedMeta ||
      releasedGen === null ||
      (releasedMeta.bucket && releasedMeta.bucket !== bucketName) ||
      (releasedMeta.name && releasedMeta.name !== releasedStoragePath) ||
      releasedMeta.contentType !== receipt.canonicalMimeType ||
      Number(releasedMeta.size) !== receipt.byteSize ||
      releasedMeta.cacheControl !== PUBLISHED_BINARY_CACHE_CONTROL ||
      releasedMeta.contentDisposition !== PUBLISHED_BINARY_CONTENT_DISPOSITION ||
      hasPublicAclOrTokenExposure(releasedMeta) ||
      releasedMeta.metadata?.receiptId !== receipt.receiptId ||
      releasedMeta.metadata?.publicDocumentId !== publicDocumentId ||
      releasedMeta.metadata?.sourceSha256 !== receipt.sha256 ||
      releasedMeta.metadata?.sourceGeneration !== sourceGeneration ||
      releasedMeta.metadata?.avRequestId !== avRequestId ||
      releasedMeta.metadata?.isSanitized !== 'false' ||
      releasedMeta.metadata?.isVerifiedSafe !== 'false'
    ) {
      return {
        ok: false,
        errorCode: 'RELEASED_OBJECT_CONFLICT',
        errorMessage:
          'Released storage object failed privacy, metadata, provenance, or non-token readback checks.',
      };
    }

    const pinnedReleasedFile = bucket.file(releasedStoragePath, {
      generation: releasedGen,
    });
    const releasedRead = await readBoundedObjectBytes(
      pinnedReleasedFile,
      receipt.byteSize
    );
    if (!releasedRead.ok || releasedRead.sha256 !== receipt.sha256) {
      return {
        ok: false,
        errorCode: 'STORAGE_INTEGRITY_ERROR',
        errorMessage:
          'Generation-pinned readback of released object failed SHA-256 or byte size verification.',
      };
    }

    return {
      ok: true,
      releasedStoragePath,
      releasedObjectGeneration: releasedGen,
    };
  }

  public async getPublishedLibraryBinaryReleaseStatus(
    rawInput: GetPublishedLibraryBinaryReleaseStatusInput
  ): Promise<GetPublishedLibraryBinaryReleaseStatusResponseDto> {
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

    const publicDocumentId = derivePublishedBinaryPublicLibraryDocumentId(receiptId);
    const qcatDocumentId = deriveQuarantineCatalogDocumentId(receiptId);

    const gatewayCheck = resolveOwnedPublishedBinaryDownloadGatewayBaseUrl(
      this.downloadGatewayBaseUrl
    );
    if (!gatewayCheck.ok) {
      return makeGetHoldDto(
        receiptId,
        gatewayCheck.errorCode,
        gatewayCheck.errorMessage
      );
    }
    const downloadGatewayUrl = buildOwnedPublishedBinaryDownloadUrl(
      publicDocumentId,
      gatewayCheck.baseUrl
    );

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
        'Failed to read binary publication readiness records from Firestore.'
      );
    }

    const evalResult = evaluateBinaryReleaseChainSnapshots(
      receiptId,
      snaps.receiptSnap,
      snaps.draftSnap,
      snaps.caseSnap,
      snaps.handoffSnap,
      snaps.qcatDocSnap,
      snaps.alignmentSnap,
      snaps.rightsDecisionSnap,
      snaps.orgSnap,
      snaps.sourceSnap,
      snaps.safetyCaseSnap,
      snaps.inspectionRequestSnap,
      snaps.avExecutionSnap,
      snaps.pdfInspectionSnap
    );
    if (!evalResult.ok) {
      return makeGetHoldDto(
        receiptId,
        evalResult.errorCode,
        evalResult.errorMessage
      );
    }

    const chain = evalResult.chain;
    const receipt = chain.receiptEnvelope.receipt;

    let isPublished = false;
    let releaseDto: SanitizedPublishedLibraryBinaryReleaseDto | null = null;
    let publicDocDto: SanitizedPublishedBinaryPublicDocumentDto | null = null;

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
          'Partial binary publication artifacts detected in Firestore.'
        );
      }

      const releaseValidation = validatePersistedPublishedBinaryReleaseRecord(
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
      const pubDocValidation = validatePersistedPublishedBinaryDocument(
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

      isPublished = releaseValidation.release.status === 'PUBLISHED';
      releaseDto = toSanitizedBinaryReleaseDto(releaseValidation.release);
      publicDocDto = toSanitizedPublicDocumentSummaryDto(
        pubDocValidation.document,
        releaseValidation.release.format
      );
    }

    const suggestedDownloadFilename = buildSuggestedDownloadFilename(
      receipt.sanitizedFilename,
      receipt.format,
      receiptId
    );

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
      format: receipt.format,
      canonicalMimeType: receipt.canonicalMimeType,
      byteSize: receipt.byteSize,
      deepInspectionStatus: receipt.deepInspectionStatus,
      sanitizedFilename: receipt.sanitizedFilename,
      suggestedDownloadFilename,
      sourceRevision: chain.receiptEnvelope.revision,
      currentHumanCaseRevision: chain.humanReviewCase.revision,
      effectiveAlignedCaseRevision: chain.effectiveAlignedCaseRevision,
      currentAlignmentRevision: chain.currentAlignmentRevision,
      catalogUpdatedAt: chain.sanitizedCatalogDocument.updatedAt,
      catalogAligned: chain.catalogAligned,
      safetyCaseRevision: chain.safetyCase?.revision ?? null,
      avRequestId: chain.avRequestId,
      avExecutionState: chain.avExecutionState,
      avCompletedAt: chain.avExecution?.completedAt ?? null,
      isScanCleanForCurrentRevision: chain.isScanCleanForCurrentRevision,
      requiresContradictionResolution: chain.requiresContradictionResolution,
      currentPriorRightsDecisionRevision:
        chain.priorRightsDecision?.revision ?? null,
      currentPriorRightsDecision: chain.priorRightsDecision?.decision ?? null,
      currentPriorRightsBasis: chain.priorRightsDecision?.basis ?? null,
      organizationId: chain.organization.id,
      organizationNameAr: chain.organization.nameAr,
      organizationNameEn: chain.organization.nameEn,
      sourceId: chain.source.id,
      sourceNameAr: chain.source.sourceNameAr,
      sourceNameEn: chain.source.sourceNameEn,
      sourceVerified: chain.sourceVerified,
      catalogTitleAr: chain.sanitizedCatalogDocument.titleAr,
      catalogTitleEn: chain.sanitizedCatalogDocument.titleEn,
      downloadGatewayUrl,
      isSanitized: false,
      isVerifiedSafe: false,
      quarantineSourceExposed: false,
      releaseRecord: releaseDto,
      publicDocument: publicDocDto,
    });
  }

  public async publishQuarantinedBinaryToPublicLibrary(
    rawInput: PublishQuarantinedBinaryToPublicLibraryInput
  ): Promise<PublishQuarantinedBinaryToPublicLibraryResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makePublishHoldDto(
        null,
        'INVALID_RELEASE_PAYLOAD',
        'Binary publish request payload must be a plain object.'
      );
    }

    const receiptCandidate =
      typeof rawInput.receiptId === 'string' ? rawInput.receiptId : null;

    if (!hasOnlyAllowedKeys(rawInput, ALLOWED_PUBLISH_REQUEST_KEYS)) {
      return makePublishHoldDto(
        receiptCandidate,
        'INVALID_RELEASE_PAYLOAD',
        'Binary publish payload contains unexpected or forbidden fields.'
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
      !isPositiveSafeInteger(rawInput.expectedSafetyCaseRevision) ||
      typeof rawInput.expectedAvRequestId !== 'string' ||
      rawInput.expectedAvRequestId.trim().length === 0
    ) {
      return makePublishHoldDto(
        receiptId,
        'INVALID_RELEASE_PAYLOAD',
        'Missing or invalid compare-and-swap precondition fields.'
      );
    }

    if (
      rawInput.expectedPriorRightsDecisionRevision !== undefined &&
      rawInput.expectedPriorRightsDecisionRevision !== null &&
      !isPositiveSafeInteger(rawInput.expectedPriorRightsDecisionRevision)
    ) {
      return makePublishHoldDto(
        receiptId,
        'INVALID_RELEASE_PAYLOAD',
        'expectedPriorRightsDecisionRevision must be null or a positive safe integer.'
      );
    }

    if (
      rawInput.confirmation !== LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL
    ) {
      return makePublishHoldDto(
        receiptId,
        'CONFIRMATION_REQUIRED',
        `Explicit human confirmation must equal ${LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL}.`
      );
    }

    const auth = await this.resolveAuthorizedActor();
    if (!auth.ok) {
      return makePublishHoldDto(receiptId, auth.errorCode, auth.errorMessage);
    }

    const gatewayCheck = resolveOwnedPublishedBinaryDownloadGatewayBaseUrl(
      this.downloadGatewayBaseUrl
    );
    if (!gatewayCheck.ok) {
      return makePublishHoldDto(
        receiptId,
        gatewayCheck.errorCode,
        gatewayCheck.errorMessage
      );
    }

    const bucketCheck = this.assertValidStorageBucket();
    if (!bucketCheck.ok) {
      return makePublishHoldDto(
        receiptId,
        bucketCheck.errorCode,
        bucketCheck.errorMessage
      );
    }

    const qcatDocumentId = deriveQuarantineCatalogDocumentId(receiptId);
    const publicDocumentId = derivePublishedBinaryPublicLibraryDocumentId(receiptId);
    const eventId = derivePublishedBinaryReleaseEventId(receiptId, 1);
    const downloadGatewayUrl = buildOwnedPublishedBinaryDownloadUrl(
      publicDocumentId,
      gatewayCheck.baseUrl
    );

    // Phase 1 pre-flight read before promoting storage object
    let preSnaps: Awaited<ReturnType<typeof this.readChainSnapshots>>;
    try {
      preSnaps = await this.readChainSnapshots(receiptId, (ref) => {
        if (typeof ref.get !== 'function') {
          throw new Error('STORE_READ_FAILED');
        }
        return ref.get();
      });
    } catch {
      return makePublishHoldDto(
        receiptId,
        'STORE_READ_FAILED',
        'Failed to read quarantine release readiness records before storage promotion.'
      );
    }

    const preEval = evaluateBinaryReleaseChainSnapshots(
      receiptId,
      preSnaps.receiptSnap,
      preSnaps.draftSnap,
      preSnaps.caseSnap,
      preSnaps.handoffSnap,
      preSnaps.qcatDocSnap,
      preSnaps.alignmentSnap,
      preSnaps.rightsDecisionSnap,
      preSnaps.orgSnap,
      preSnaps.sourceSnap,
      preSnaps.safetyCaseSnap,
      preSnaps.inspectionRequestSnap,
      preSnaps.avExecutionSnap,
      preSnaps.pdfInspectionSnap
    );
    if (!preEval.ok) {
      return makePublishHoldDto(
        receiptId,
        preEval.errorCode,
        preEval.errorMessage
      );
    }

    const preChain = preEval.chain;
    const preReceipt = preChain.receiptEnvelope.receipt;

    const editorialCheck = validatePublishedBinaryReleaseEditorialInput(
      rawInput.input,
      preReceipt.format,
      preReceipt.sanitizedFilename,
      preChain.requiresContradictionResolution
    );
    if (!editorialCheck.ok) {
      return makePublishHoldDto(
        receiptId,
        editorialCheck.errorCode,
        editorialCheck.errorMessage
      );
    }
    const editorial = editorialCheck.value;

    // Check existing release BEFORE touching GCS for idempotency vs conflict
    const preAnyExists =
      preSnaps.releaseSnap.exists ||
      preSnaps.publicDocSnap.exists ||
      preSnaps.releaseEventSnap.exists;

    if (preAnyExists) {
      if (
        !preSnaps.releaseSnap.exists ||
        !preSnaps.publicDocSnap.exists ||
        !preSnaps.releaseEventSnap.exists
      ) {
        return makePublishHoldDto(
          receiptId,
          'INCONSISTENT_RELEASE_STATE',
          'Partial binary publication artifacts already exist in Firestore.'
        );
      }

      const relVal = validatePersistedPublishedBinaryReleaseRecord(
        preSnaps.releaseSnap.data(),
        receiptId
      );
      if (!relVal.ok) {
        return makePublishHoldDto(receiptId, relVal.errorCode, relVal.errorMessage);
      }
      const pubVal = validatePersistedPublishedBinaryDocument(
        preSnaps.publicDocSnap.data(),
        publicDocumentId,
        relVal.release
      );
      if (!pubVal.ok) {
        return makePublishHoldDto(receiptId, pubVal.errorCode, pubVal.errorMessage);
      }
      const existing = relVal.release;
      const releaseDto = toSanitizedBinaryReleaseDto(existing);
      const pubDocDto = toSanitizedPublicDocumentSummaryDto(
        pubVal.document,
        existing.format
      );

      const isExactIdempotentReplay =
        existing.status === 'PUBLISHED' &&
        existing.sourceRevision === preChain.receiptEnvelope.revision &&
        existing.sourceSha256 === preReceipt.sha256 &&
        existing.sourceGeneration === preReceipt.generation &&
        existing.alignedHumanCaseRevision ===
          rawInput.expectedHumanCaseRevision &&
        existing.alignmentRevision === rawInput.expectedAlignmentRevision &&
        existing.catalogUpdatedAt === rawInput.expectedCatalogUpdatedAt &&
        existing.safetyCaseRevision === rawInput.expectedSafetyCaseRevision &&
        existing.avRequestId === rawInput.expectedAvRequestId &&
        existing.publicRightsStatus === editorial.publicRightsStatus &&
        existing.binaryRightsBasis === editorial.binaryRightsBasis &&
        existing.rightsEvidenceReference === editorial.rightsEvidenceReference &&
        existing.rightsEvidenceSummary === editorial.rightsEvidenceSummary &&
        existing.releaseNotes === editorial.releaseNotes &&
        existing.downloadFilename === editorial.downloadFilename &&
        existing.contradictionResolutionSummary ===
          editorial.contradictionResolutionSummary;

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
          quarantineSourceExposed: false,
          isSanitized: false,
          isVerifiedSafe: false,
        });
      }

      return Object.freeze({
        ok: false,
        status: 'CONFLICT',
        releaseOutcome: 'ALREADY_PUBLISHED',
        published: false,
        errorCode: 'RELEASE_ALREADY_EXISTS_CONFLICT',
        errorMessage:
          'A published binary release already exists for this receipt with different release parameters or provenance.',
        receiptId,
        quarantineCatalogDocumentId: qcatDocumentId,
        publicDocumentId,
        currentHumanCaseRevision: preChain.humanReviewCase.revision,
        effectiveAlignedCaseRevision: preChain.effectiveAlignedCaseRevision,
        currentAlignmentRevision: preChain.currentAlignmentRevision,
        currentCatalogUpdatedAt: preChain.sanitizedCatalogDocument.updatedAt,
        currentSafetyCaseRevision: preChain.safetyCase?.revision ?? null,
        currentAvRequestId: preChain.avRequestId,
        currentPriorRightsDecisionRevision:
          preChain.priorRightsDecision?.revision ?? null,
        releaseRecord: releaseDto,
        publicDocument: pubDocDto,
        quarantineSourceExposed: false,
        isSanitized: false,
        isVerifiedSafe: false,
      });
    }

    if (!preChain.eligibleForPublish || preChain.blockCode !== null) {
      return makePublishHoldDto(
        receiptId,
        preChain.blockCode ?? 'WAITING_FOR_ACTUAL_SCAN',
        preChain.blockMessage ??
          'Binary publication prerequisites are not satisfied.'
      );
    }

    const priorRightsRev = preChain.priorRightsDecision?.revision ?? null;
    if (
      rawInput.expectedHumanCaseRevision !== preChain.humanReviewCase.revision ||
      rawInput.expectedCatalogUpdatedAt !==
        preChain.sanitizedCatalogDocument.updatedAt ||
      rawInput.expectedAlignmentRevision !== preChain.currentAlignmentRevision ||
      rawInput.expectedSafetyCaseRevision !== preChain.safetyCase?.revision ||
      rawInput.expectedAvRequestId !== preChain.avRequestId ||
      (rawInput.expectedPriorRightsDecisionRevision !== undefined &&
        rawInput.expectedPriorRightsDecisionRevision !== priorRightsRev)
    ) {
      return Object.freeze({
        ok: false,
        status: 'CONFLICT',
        releaseOutcome: 'NOT_PUBLISHED',
        published: false,
        errorCode: 'RELEASE_PRECONDITION_CONFLICT',
        errorMessage:
          'Upstream case, catalog alignment, safety case, AV scan, or prior rights revision changed concurrently; reload status before publishing.',
        receiptId,
        quarantineCatalogDocumentId: qcatDocumentId,
        publicDocumentId,
        currentHumanCaseRevision: preChain.humanReviewCase.revision,
        effectiveAlignedCaseRevision: preChain.effectiveAlignedCaseRevision,
        currentAlignmentRevision: preChain.currentAlignmentRevision,
        currentCatalogUpdatedAt: preChain.sanitizedCatalogDocument.updatedAt,
        currentSafetyCaseRevision: preChain.safetyCase?.revision ?? null,
        currentAvRequestId: preChain.avRequestId,
        currentPriorRightsDecisionRevision: priorRightsRev,
        releaseRecord: null,
        publicDocument: null,
        quarantineSourceExposed: false,
        isSanitized: false,
        isVerifiedSafe: false,
      });
    }

    // Phase 2: Promote private quarantined binary to private library/released/<receiptId>/v1/document.<ext>
    const promotionResult = await this.verifySourceAndPromoteReleasedCopy({
      receiptEnvelope: preChain.receiptEnvelope,
      publicDocumentId,
      avRequestId: preChain.avRequestId!,
      bucket: bucketCheck.bucket,
      bucketName: bucketCheck.bucketName,
    });
    if (!promotionResult.ok) {
      return makePublishHoldDto(
        receiptId,
        promotionResult.errorCode,
        promotionResult.errorMessage
      );
    }

    // Phase 3: Atomic Firestore CAS transaction (creates 3 records or aborts cleanly; released copy remains private)
    let writesStaged = false;
    try {
      const txResult =
        await this.db.runTransaction<PublishQuarantinedBinaryToPublicLibraryResponseDto>(
          async (tx: LibraryQuarantineReviewDraftFirestoreTransaction) => {
            const snaps = await this.readChainSnapshots(receiptId, (ref) =>
              tx.get(ref)
            );
            const evalResult = evaluateBinaryReleaseChainSnapshots(
              receiptId,
              snaps.receiptSnap,
              snaps.draftSnap,
              snaps.caseSnap,
              snaps.handoffSnap,
              snaps.qcatDocSnap,
              snaps.alignmentSnap,
              snaps.rightsDecisionSnap,
              snaps.orgSnap,
              snaps.sourceSnap,
              snaps.safetyCaseSnap,
              snaps.inspectionRequestSnap,
              snaps.avExecutionSnap,
              snaps.pdfInspectionSnap
            );
            if (!evalResult.ok) {
              throw new PreWriteBinaryReleaseHoldError(
                evalResult.errorCode,
                evalResult.errorMessage
              );
            }
            const chain = evalResult.chain;
            const receipt = chain.receiptEnvelope.receipt;

            const anyExists =
              snaps.releaseSnap.exists ||
              snaps.publicDocSnap.exists ||
              snaps.releaseEventSnap.exists;
            if (anyExists) {
              if (
                !snaps.releaseSnap.exists ||
                !snaps.publicDocSnap.exists ||
                !snaps.releaseEventSnap.exists
              ) {
                throw new PreWriteBinaryReleaseHoldError(
                  'INCONSISTENT_RELEASE_STATE',
                  'Partial binary publication artifacts already exist in Firestore.'
                );
              }
              const relVal = validatePersistedPublishedBinaryReleaseRecord(
                snaps.releaseSnap.data(),
                receiptId
              );
              if (!relVal.ok) {
                throw new PreWriteBinaryReleaseHoldError(
                  relVal.errorCode,
                  relVal.errorMessage
                );
              }
              const pubVal = validatePersistedPublishedBinaryDocument(
                snaps.publicDocSnap.data(),
                publicDocumentId,
                relVal.release
              );
              if (!pubVal.ok) {
                throw new PreWriteBinaryReleaseHoldError(
                  pubVal.errorCode,
                  pubVal.errorMessage
                );
              }
              const existing = relVal.release;
              const releaseDto = toSanitizedBinaryReleaseDto(existing);
              const pubDocDto = toSanitizedPublicDocumentSummaryDto(
                pubVal.document,
                existing.format
              );

              const isExactReplay =
                existing.status === 'PUBLISHED' &&
                existing.sourceRevision === chain.receiptEnvelope.revision &&
                existing.sourceSha256 === receipt.sha256 &&
                existing.sourceGeneration === receipt.generation &&
                existing.alignedHumanCaseRevision ===
                  rawInput.expectedHumanCaseRevision &&
                existing.alignmentRevision ===
                  rawInput.expectedAlignmentRevision &&
                existing.catalogUpdatedAt ===
                  rawInput.expectedCatalogUpdatedAt &&
                existing.safetyCaseRevision ===
                  rawInput.expectedSafetyCaseRevision &&
                existing.avRequestId === rawInput.expectedAvRequestId &&
                existing.publicRightsStatus === editorial.publicRightsStatus &&
                existing.binaryRightsBasis === editorial.binaryRightsBasis &&
                existing.rightsEvidenceReference ===
                  editorial.rightsEvidenceReference &&
                existing.rightsEvidenceSummary ===
                  editorial.rightsEvidenceSummary &&
                existing.releaseNotes === editorial.releaseNotes &&
                existing.downloadFilename === editorial.downloadFilename &&
                existing.contradictionResolutionSummary ===
                  editorial.contradictionResolutionSummary;

              if (isExactReplay) {
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
                  quarantineSourceExposed: false,
                  isSanitized: false,
                  isVerifiedSafe: false,
                });
              }

              throw new PreWriteBinaryReleaseConflictError(
                'RELEASE_ALREADY_EXISTS_CONFLICT',
                'ALREADY_PUBLISHED',
                'A public binary release already exists for this receipt with different release parameters or provenance.',
                chain.humanReviewCase.revision,
                chain.effectiveAlignedCaseRevision,
                chain.currentAlignmentRevision,
                chain.sanitizedCatalogDocument.updatedAt,
                chain.safetyCase?.revision ?? null,
                chain.avRequestId,
                chain.priorRightsDecision?.revision ?? null,
                releaseDto,
                pubDocDto
              );
            }

            if (!chain.eligibleForPublish || chain.blockCode !== null) {
              throw new PreWriteBinaryReleaseHoldError(
                chain.blockCode ?? 'WAITING_FOR_ACTUAL_SCAN',
                chain.blockMessage ??
                  'Reviewed catalog binary does not satisfy publication prerequisites.'
              );
            }

            if (
              chain.receiptEnvelope.revision !== preChain.receiptEnvelope.revision ||
              receipt.sha256 !== preReceipt.sha256 ||
              receipt.generation !== preReceipt.generation ||
              rawInput.expectedHumanCaseRevision !==
                chain.humanReviewCase.revision ||
              rawInput.expectedCatalogUpdatedAt !==
                chain.sanitizedCatalogDocument.updatedAt ||
              rawInput.expectedAlignmentRevision !==
                chain.currentAlignmentRevision ||
              rawInput.expectedSafetyCaseRevision !==
                chain.safetyCase?.revision ||
              rawInput.expectedAvRequestId !== chain.avRequestId ||
              (rawInput.expectedPriorRightsDecisionRevision !== undefined &&
                rawInput.expectedPriorRightsDecisionRevision !==
                  (chain.priorRightsDecision?.revision ?? null))
            ) {
              throw new PreWriteBinaryReleaseConflictError(
                'RELEASE_PRECONDITION_CONFLICT',
                'NOT_PUBLISHED',
                'Quarantine source, review case, catalog alignment, safety case, or AV execution changed concurrently; reload status before publishing.',
                chain.humanReviewCase.revision,
                chain.effectiveAlignedCaseRevision,
                chain.currentAlignmentRevision,
                chain.sanitizedCatalogDocument.updatedAt,
                chain.safetyCase?.revision ?? null,
                chain.avRequestId,
                chain.priorRightsDecision?.revision ?? null,
                null,
                null
              );
            }

            const nowIso = this.clock();
            if (
              !isValidIsoUtcTimestamp(nowIso) ||
              Date.parse(nowIso) < Date.parse(receipt.updatedAt) ||
              Date.parse(nowIso) < Date.parse(chain.humanReviewCase.updatedAt) ||
              Date.parse(nowIso) <
                Date.parse(chain.sanitizedCatalogDocument.updatedAt) ||
              Date.parse(nowIso) < Date.parse(chain.avExecution!.completedAt!)
            ) {
              throw new PreWriteBinaryReleaseHoldError(
                'INVALID_TIMESTAMP',
                'Release timestamp must be a valid canonical ISO-8601 UTC timestamp not preceding upstream records or AV scan completion.'
              );
            }

            const qcatDoc = chain.rawCatalogDocument;
            const transitionBase = `${receiptId}-qbin-1`;
            const workflowHistory: WorkflowTransitionRecord[] = [
              {
                id: `${transitionBase}-submit`,
                fromState: WorkflowState.Draft,
                toState: WorkflowState.InReview,
                action: WorkflowAction.SubmitForReview,
                actorName: auth.admin.name,
                actorRole: auth.admin.role,
                timestamp: nowIso,
                comment:
                  'Cleanly AV-scanned quarantined document submitted for public binary download release.',
              },
              {
                id: `${transitionBase}-approve`,
                fromState: WorkflowState.InReview,
                toState: WorkflowState.Approved,
                action: WorkflowAction.Approve,
                actorName: auth.admin.name,
                actorRole: auth.admin.role,
                timestamp: nowIso,
                comment:
                  'Human catalog alignment, ClamAV scan, and explicit binary distribution rights verified.',
              },
              {
                id: `${transitionBase}-publish`,
                fromState: WorkflowState.Approved,
                toState: WorkflowState.Published,
                action: WorkflowAction.Publish,
                actorName: auth.admin.name,
                actorRole: auth.admin.role,
                timestamp: nowIso,
                comment:
                  'Published original verified document to the public library via owned attachment download gateway.',
              },
            ];

            const formatLabelAr =
              receipt.format === 'PDF'
                ? 'نسخة PDF أصلية مفحوصة ومعتمدة للتحميل (PDF Original)'
                : 'نسخة Word DOCX أصلية مفحوصة ومعتمدة للتحميل (Word DOCX Original)';
            const formatLabelEn =
              receipt.format === 'PDF'
                ? 'Public release for direct attachment download (PDF Original)'
                : 'Public release for direct attachment download (Word DOCX Original)';

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
                'تم نشر الملف الأصلي المرفوع بعد فحص ClamAV النظيف وإثبات حق التوزيع الثنائي الصريح؛ التقديم يتم كتنزيل مرفق آمن دون إظهار مسار الحجر.',
              rightsNotesEn:
                'Published original uploaded file after clean ClamAV execution and explicit human binary redistribution authorization; served strictly as an attachment without exposing quarantine paths.',
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
                  changeDescriptionAr: formatLabelAr,
                  changeDescriptionEn: formatLabelEn,
                  referenceUrl: downloadGatewayUrl,
                },
              ],
            };

            try {
              LibraryValidator.validatePersistedDocument(
                publicDocument,
                publicDocumentId
              );
            } catch (valErr) {
              throw new PreWriteBinaryReleaseHoldError(
                'PUBLIC_DOCUMENT_VALIDATION_FAILED',
                valErr instanceof Error
                  ? valErr.message
                  : 'Public LibraryDocument failed schema validation.'
              );
            }

            const av = chain.avExecution!;
            const persistedRelease: LibraryQuarantinePersistedPublishedBinaryRelease =
              Object.freeze({
                schemaVersion: LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION,
                receiptId,
                sourceCatalogDocumentId: qcatDocumentId,
                publicDocumentId,
                releaseRevision: 1,
                status: 'PUBLISHED',
                sourceRevision: chain.receiptEnvelope.revision,
                sourceUpdatedAt: receipt.updatedAt,
                sourceSha256: receipt.sha256,
                sourceGeneration: receipt.generation!,
                sourceByteSize: receipt.byteSize,
                format: receipt.format,
                canonicalMimeType: receipt.canonicalMimeType,
                deepInspectionStatus: receipt.deepInspectionStatus,
                draftSourceRevision: chain.reviewDraft.sourceRevision,
                catalogHandoffCaseRevision: chain.catalogHandoff.caseRevision,
                alignedHumanCaseRevision: chain.humanReviewCase.revision,
                alignedHumanCaseUpdatedAt: chain.humanReviewCase.updatedAt,
                alignmentRevision: chain.currentAlignmentRevision,
                catalogUpdatedAt: chain.sanitizedCatalogDocument.updatedAt,
                safetyCaseRevision: chain.safetyCase!.revision,
                avRequestId: chain.avRequestId!,
                avExecutionState: 'AV_NO_THREAT_DETECTED',
                avCompletedAt: av.completedAt!,
                avEngineName: av.engineName!,
                avEngineVersion: av.engineVersion!,
                avSignatureVersion: av.signatureVersion!,
                avSignatureUpdatedAt: av.signatureUpdatedAt!,
                priorRightsDecisionRevision:
                  chain.priorRightsDecision?.revision ?? null,
                priorRightsDecision:
                  chain.priorRightsDecision?.decision ?? null,
                priorRightsBasis: chain.priorRightsDecision?.basis ?? null,
                contradictionResolutionRequired:
                  chain.requiresContradictionResolution,
                contradictionResolutionSummary:
                  editorial.contradictionResolutionSummary,
                organizationId: chain.organization.id,
                sourceId: chain.source.id,
                publicRightsStatus: editorial.publicRightsStatus,
                binaryRightsBasis: editorial.binaryRightsBasis,
                rightsEvidenceReference: editorial.rightsEvidenceReference,
                rightsEvidenceSummary: editorial.rightsEvidenceSummary,
                releaseNotes: editorial.releaseNotes,
                downloadFilename: editorial.downloadFilename,
                releasedBucketName: bucketCheck.bucketName,
                releasedStoragePath: promotionResult.releasedStoragePath,
                releasedObjectGeneration:
                  promotionResult.releasedObjectGeneration,
                downloadGatewayUrl,
                publishedBy: auth.actorUid,
                publishedAt: nowIso,
                isSanitized: false,
                isVerifiedSafe: false,
                quarantineSourceExposed: false,
                quarantineDraftRemainsDraft: true,
              });

            const persistedEvent: LibraryQuarantinePersistedPublishedBinaryReleaseEvent =
              Object.freeze({
                schemaVersion: LIBRARY_PUBLISHED_BINARY_RELEASE_SCHEMA_VERSION,
                eventId,
                receiptId,
                sourceCatalogDocumentId: qcatDocumentId,
                publicDocumentId,
                releaseRevision: 1,
                eventType: 'PUBLISHED_QUARANTINED_BINARY_TO_PUBLIC_LIBRARY',
                sourceRevision: chain.receiptEnvelope.revision,
                sourceSha256: receipt.sha256,
                sourceGeneration: receipt.generation!,
                format: receipt.format,
                alignedHumanCaseRevision: chain.humanReviewCase.revision,
                alignmentRevision: chain.currentAlignmentRevision,
                safetyCaseRevision: chain.safetyCase!.revision,
                avRequestId: chain.avRequestId!,
                priorRightsDecisionRevision:
                  chain.priorRightsDecision?.revision ?? null,
                priorRightsDecision:
                  chain.priorRightsDecision?.decision ?? null,
                contradictionResolutionRequired:
                  chain.requiresContradictionResolution,
                publicRightsStatus: editorial.publicRightsStatus,
                binaryRightsBasis: editorial.binaryRightsBasis,
                releasedStoragePath: promotionResult.releasedStoragePath,
                releasedObjectGeneration:
                  promotionResult.releasedObjectGeneration,
                downloadFilename: editorial.downloadFilename,
                actorUid: auth.actorUid,
                recordedAt: nowIso,
                isSanitized: false,
                isVerifiedSafe: false,
                quarantineSourceExposed: false,
              });

            this.assertAllowedWriteCollection(LIBRARY_DOCUMENTS_COLLECTION);
            this.assertAllowedWriteCollection(
              LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION
            );
            this.assertAllowedWriteCollection(
              LIBRARY_PUBLISHED_BINARY_RELEASE_EVENTS_COLLECTION
            );

            const publicDocRef = this.db
              .collection(LIBRARY_DOCUMENTS_COLLECTION)
              .doc(publicDocumentId);
            const releaseRef = this.db
              .collection(LIBRARY_PUBLISHED_BINARY_RELEASES_COLLECTION)
              .doc(receiptId);
            const releaseEventRef = this.db
              .collection(LIBRARY_PUBLISHED_BINARY_RELEASE_EVENTS_COLLECTION)
              .doc(eventId);

            writesStaged = true;
            await Promise.resolve(
              tx.create(publicDocRef, toFirestoreDocumentData(publicDocument))
            );
            await Promise.resolve(
              tx.create(releaseRef, toFirestoreDocumentData(persistedRelease))
            );
            await Promise.resolve(
              tx.create(releaseEventRef, toFirestoreDocumentData(persistedEvent))
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
              releaseRecord: toSanitizedBinaryReleaseDto(persistedRelease),
              publicDocument: toSanitizedPublicDocumentSummaryDto(
                publicDocument,
                receipt.format
              ),
              quarantineDraftRemainsDraft: true,
              quarantineSourceExposed: false,
              isSanitized: false,
              isVerifiedSafe: false,
            });
          }
        );

      return txResult;
    } catch (err: unknown) {
      if (err instanceof PreWriteBinaryReleaseHoldError) {
        return makePublishHoldDto(receiptId, err.errorCode, err.errorMessage);
      }
      if (err instanceof PreWriteBinaryReleaseConflictError) {
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
          currentSafetyCaseRevision: err.currentSafetyCaseRevision,
          currentAvRequestId: err.currentAvRequestId,
          currentPriorRightsDecisionRevision:
            err.currentPriorRightsDecisionRevision,
          releaseRecord: err.releaseRecord,
          publicDocument: err.publicDocument,
          quarantineSourceExposed: false,
          isSanitized: false,
          isVerifiedSafe: false,
        });
      }
      if (writesStaged) {
        return makePublishUnknownDto(receiptId);
      }
      return makePublishHoldDto(
        receiptId,
        'RELEASE_PERSISTENCE_FAILED',
        'Failed to persist published binary release transaction cleanly.'
      );
    }
  }
}
