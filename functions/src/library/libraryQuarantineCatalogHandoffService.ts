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
  LibraryDocumentType,
  LibraryRightsStatus,
  type LibraryDocument,
  type LibraryDocumentVersion,
} from '../shared/libraryContract';
import { WorkflowState } from '../shared/workflowContract';
import { LibraryValidator } from './libraryValidator';
import {
  QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX,
  QUARANTINE_CATALOG_DOCUMENT_ID_REGEX,
  isQuarantineCatalogDocumentId,
} from './libraryApplicationService';
import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
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
  type LibraryQuarantineHumanReviewCaseStatus,
  type LibraryQuarantinePersistedHumanReviewCase,
} from './libraryQuarantineHumanReviewCaseContract';
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
 * LIB-FILE-CATALOG-HANDOFF-01 — Internal Catalog Draft Handoff Service
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Bridges an eligible human review case (`status === 'METADATA_RECORDED'`) for a
 *   `Quarantined` upload receipt linked to a `PENDING_HUMAN_REVIEW` draft into an
 *   internal, non-public `LibraryDocument` catalog draft (`id = "qcat-" + receiptId`).
 * - Executes a single atomic Firestore transaction that performs 8 point reads
 *   BEFORE staging 3 `tx.create` writes (`library_documents/<documentId>`,
 *   `library_quarantine_catalog_handoffs/<receiptId>`, and
 *   `library_quarantine_catalog_handoff_events/<receiptId>`).
 * - Never calls `tx.set` or `tx.update` on catalog handoff creation, never accesses
 *   Google Cloud Storage, never mutates receipts, review drafts, or human review cases,
 *   and never attaches `referenceUrl`, `storagePath`, `generation`, signed URLs, or
 *   binary handles to the created `LibraryDocument`.
 * - Enforces dual RBAC (`AdminPermission.Review` AND `AdminPermission.Create`) for an
 *   active human Library administrator.
 * - Preserves all 5 non-assurance security posture flags (`false`) across every
 *   persisted handoff record, audit event, and response DTO.
 */

export const LIBRARY_DOCUMENTS_COLLECTION = 'library_documents' as const;
export const LIBRARY_ORGANIZATIONS_COLLECTION = 'library_organizations' as const;
export const LIBRARY_SOURCES_COLLECTION = 'library_sources' as const;

export const LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION =
  'library_quarantine_catalog_handoffs' as const;

export const LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION =
  'library_quarantine_catalog_handoff_events' as const;

export const LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION = 1 as const;
export const LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENT_SCHEMA_VERSION = 1 as const;

export const CATALOG_HANDOFF_TITLE_MAX_LENGTH = 300 as const;
export const CATALOG_HANDOFF_SUMMARY_MAX_LENGTH = 2000 as const;
export const CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH = 200 as const;
export const CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH = 1000 as const;
export const CATALOG_HANDOFF_ID_REF_MAX_LENGTH = 128 as const;
export const CATALOG_HANDOFF_TAG_MAX_LENGTH = 120 as const;
export const CATALOG_HANDOFF_MAX_TOPICS = 20 as const;
export const CATALOG_HANDOFF_MAX_DOMAINS = 10 as const;

const SHA256_LOWERCASE_HEX_REGEX = /^[0-9a-f]{64}$/;
const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const SINGLE_LINE_CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const MULTI_LINE_CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|gs:\/\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i;

const ALLOWED_LANGUAGES: ReadonlySet<string> = new Set([
  'ar',
  'en',
  'bilingual',
  'other',
]);

const ALLOWED_DOCUMENT_TYPES: ReadonlySet<string> = new Set(
  Object.values(LibraryDocumentType)
);

const ALLOWED_GET_INPUT_KEYS: ReadonlySet<string> = new Set(['receiptId']);

const ALLOWED_CREATE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'receiptId',
  'expectedCaseRevision',
  'input',
]);

export const ALLOWED_CLASSIFICATION_INPUT_KEYS: ReadonlySet<string> = new Set([
  'titleAr',
  'titleEn',
  'originalTitle',
  'summaryAr',
  'summaryEn',
  'documentType',
  'organizationId',
  'sourceId',
  'geographyAr',
  'geographyEn',
  'publicationDate',
  'language',
  'topicsAr',
  'topicsEn',
  'environmentalDomains',
  'legalStatusDescriptionAr',
  'legalStatusDescriptionEn',
]);

const ALLOWED_PERSISTED_HANDOFF_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'documentId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'draftSourceRevision',
  'caseRevision',
  'caseUpdatedAt',
  'organizationId',
  'sourceId',
  'createdBy',
  'createdAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_PERSISTED_HANDOFF_EVENT_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'eventId',
  'receiptId',
  'documentId',
  'eventType',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'draftSourceRevision',
  'caseRevision',
  'caseUpdatedAt',
  'organizationId',
  'sourceId',
  'actorUid',
  'recordedAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_PRINCIPAL_KEYS: ReadonlySet<string> = new Set(['uid', 'token']);

const FORBIDDEN_TOKEN_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'isAuthorized',
  'authorized',
  'bypassAuth',
  'forceAuthorize',
  'allow',
  'adminUser',
  'createdBy',
  'updatedBy',
  'storagePath',
  'generation',
  'attestation',
  'candidate',
  'receipt',
  'adminReceipt',
  'url',
  'signedUrl',
  'downloadUrl',
  'bytes',
  'rawBytes',
  'buffer',
]);

const ALLOWED_WRITE_COLLECTIONS: ReadonlySet<string> = new Set([
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION,
]);

export type LibraryQuarantineCatalogHandoffErrorCode =
  | LibraryQuarantineHumanReviewCaseErrorCode
  | 'INVALID_SERVICE_INPUT_HOLD'
  | 'UNTRUSTED_CALLER_FIELD_HOLD'
  | 'UNAUTHENTICATED_CALLER_HOLD'
  | 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD'
  | 'INVALID_EXPECTED_CASE_REVISION'
  | 'INVALID_CLASSIFICATION_INPUT'
  | 'UNTRUSTED_OR_FORBIDDEN_CLASSIFICATION_FIELD'
  | 'INVALID_DOCUMENT_TYPE'
  | 'INVALID_LANGUAGE'
  | 'INVALID_PUBLICATION_DATE'
  | 'INVALID_TOPICS_OR_DOMAINS'
  | 'HUMAN_REVIEW_CASE_NOT_FOUND'
  | 'CASE_NOT_METADATA_RECORDED'
  | 'ORGANIZATION_NOT_FOUND'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_ORGANIZATION_MISMATCH'
  | 'SOURCE_NOT_VERIFIED'
  | 'INCONSISTENT_EXISTING_HANDOFF_STATE'
  | 'HANDOFF_SOURCE_MISMATCH'
  | 'TIMESTAMP_BEFORE_SOURCE_OR_CASE'
  | 'CATALOG_DOCUMENT_VALIDATION_FAILED'
  | 'INVALID_PERSISTED_HANDOFF_SCHEMA'
  | 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA';

export type LibraryQuarantineCatalogHandoffConflictCode =
  | 'CASE_REVISION_CONFLICT'
  | 'HANDOFF_ALREADY_EXISTS_CONFLICT';

export const CATALOG_HANDOFF_SAFE_MESSAGES: Readonly<
  Record<
    | LibraryQuarantineCatalogHandoffErrorCode
    | LibraryQuarantineCatalogHandoffConflictCode,
    string
  >
> = Object.freeze({
  INVALID_CASE_INPUT_OBJECT:
    'Human review case input must be a plain object with allowed editorial fields only.',
  UNTRUSTED_OR_FORBIDDEN_CASE_FIELD:
    'Human review case payload contains an unexpected, privileged, or forbidden property.',
  INVALID_CASE_STATUS:
    'Human review case status must be one of IN_REVIEW, NEEDS_INFORMATION, METADATA_RECORDED, or NOT_SUITABLE.',
  INVALID_PLAIN_TEXT_FIELD:
    'Catalog handoff text fields must be plain text without HTML tags, control characters, or forbidden URI schemes.',
  FIELD_MAX_LENGTH_EXCEEDED:
    'One or more catalog handoff text fields exceed the maximum permitted character length.',
  METADATA_RECORDED_REQUIREMENTS_NOT_MET:
    'METADATA_RECORDED requires at least one document title (Arabic or English) and non-empty source evidence notes.',
  JUSTIFICATION_NOTES_REQUIRED:
    'NEEDS_INFORMATION and NOT_SUITABLE require non-empty reviewer editorial justification notes.',
  EMPTY_REVIEW_CASE_NOT_ALLOWED:
    'Human review case must include at least one non-empty descriptive field or reviewer note.',
  INVALID_PERSISTED_CASE_SCHEMA:
    'Persisted human review case failed strict 20-field schema or integrity validation.',
  INVALID_PERSISTED_EVENT_SCHEMA:
    'Persisted human review audit event failed strict 21-field schema or integrity validation.',
  INVALID_RECEIPT_ID:
    'Quarantine receiptId must be a lowercase 32-character hexadecimal identifier.',
  INVALID_EXPECTED_REVISION:
    'expectedRevision must be a non-negative safe integer.',
  INVALID_ACTOR_UID:
    'Reviewer actorUid must be a valid authenticated Firebase user identifier.',
  INVALID_TIMESTAMP:
    'Catalog handoff timestamp must be a canonical UTC ISO-8601 string.',
  DOCUMENT_ID_MISMATCH:
    'Firestore document identifier does not match the expected catalog handoff record key.',
  SOURCE_RECEIPT_NOT_FOUND:
    'Authoritative quarantine receipt does not exist in library_quarantine_receipts.',
  CORRUPTED_SOURCE_RECEIPT:
    'Authoritative quarantine receipt failed strict envelope schema validation.',
  SECURITY_POSTURE_VIOLATION:
    'Source quarantine receipt, review draft, or catalog draft violated non-assurance security posture invariants.',
  RECEIPT_NEEDS_RECONCILIATION:
    'Quarantine receipt requires storage reconciliation and is held from catalog handoff.',
  RECEIPT_NOT_ELIGIBLE_FOR_HUMAN_REVIEW:
    'Quarantine receipt is not in an eligible Quarantined state with verified private storage write.',
  REVIEW_DRAFT_NOT_LINKED:
    'Quarantine receipt does not have a linked PENDING_HUMAN_REVIEW draft record.',
  CORRUPTED_REVIEW_DRAFT:
    'Linked quarantine review draft failed strict 15-field schema validation.',
  DRAFT_SOURCE_MISMATCH:
    'Linked quarantine review draft does not match the authoritative source receipt identity or revision.',
  CORRUPTED_EXISTING_HUMAN_REVIEW_CASE:
    'Existing persisted human review case failed strict 20-field schema validation.',
  CASE_SOURCE_STALE_OR_MISMATCHED:
    'Existing human review case does not match the current source receipt or linked draft revision.',
  CASE_REVISION_CONFLICT:
    'Human review case revision changed concurrently; reload the latest case record before creating the catalog draft.',
  HANDOFF_ALREADY_EXISTS_CONFLICT:
    'A catalog draft handoff already exists for this receipt with different provenance or classification parameters.',
  AUDIT_EVENT_ALREADY_EXISTS:
    'Append-only catalog handoff audit event already exists.',
  TIMESTAMP_BEFORE_SOURCE_OR_PRIOR_REVISION:
    'Catalog handoff timestamp cannot precede the source receipt, linked draft, or human review case timestamp.',
  TRANSACTION_ABORTED_NO_WRITE:
    'Catalog handoff transaction aborted before any write was committed.',
  TRANSACTION_COMMIT_UNCERTAIN:
    'Catalog handoff transaction commit acknowledgement was lost after staging writes; verify draft status before retrying.',
  STORE_READ_FAILED:
    'Point lookup of catalog handoff records failed in Firestore.',
  INVALID_SERVICE_INPUT_HOLD:
    'Catalog handoff request payload must be a plain object with required fields.',
  UNTRUSTED_CALLER_FIELD_HOLD:
    'Catalog handoff request payload contains an unexpected, privileged, or forbidden property.',
  UNAUTHENTICATED_CALLER_HOLD:
    'Request is missing a valid server-authenticated Firebase user principal.',
  UNAUTHORIZED_HANDOFF_ACTOR_HOLD:
    'Authenticated caller is not an active authorized human Library administrator with both Review and Create permissions.',
  INVALID_EXPECTED_CASE_REVISION:
    'expectedCaseRevision must be a positive safe integer (>= 1).',
  INVALID_CLASSIFICATION_INPUT:
    'Catalog draft classification input must be a plain object with all required bilingual and registry fields.',
  UNTRUSTED_OR_FORBIDDEN_CLASSIFICATION_FIELD:
    'Catalog draft classification input contains an unexpected, privileged, or forbidden property.',
  INVALID_DOCUMENT_TYPE:
    'Catalog draft documentType must be a valid LibraryDocumentType enum value.',
  INVALID_LANGUAGE:
    'Catalog draft language must be one of ar, en, bilingual, or other.',
  INVALID_PUBLICATION_DATE:
    'Catalog draft publicationDate must be a valid calendar date string (YYYY-MM-DD).',
  INVALID_TOPICS_OR_DOMAINS:
    'Catalog draft topicsAr, topicsEn, and environmentalDomains must be non-empty plain-text string arrays within bounds.',
  HUMAN_REVIEW_CASE_NOT_FOUND:
    'Human review case has not been recorded yet for this quarantine receipt.',
  CASE_NOT_METADATA_RECORDED:
    'Human review case must be saved in METADATA_RECORDED status with source evidence notes before catalog handoff.',
  ORGANIZATION_NOT_FOUND:
    'Referenced organizationId does not exist in library_organizations.',
  SOURCE_NOT_FOUND:
    'Referenced sourceId does not exist in library_sources.',
  SOURCE_ORGANIZATION_MISMATCH:
    'Referenced sourceId does not belong to the selected organizationId.',
  SOURCE_NOT_VERIFIED:
    'Referenced sourceId must have verificationStatus === Verified in library_sources.',
  INCONSISTENT_EXISTING_HANDOFF_STATE:
    'Existing catalog handoff or draft document record is incomplete, corrupted, or violated Draft/ReviewRequired locks.',
  HANDOFF_SOURCE_MISMATCH:
    'Existing catalog handoff record does not match the current quarantine receipt or review draft revision.',
  TIMESTAMP_BEFORE_SOURCE_OR_CASE:
    'Catalog handoff timestamp cannot precede the source receipt, review draft, or human review case timestamp.',
  CATALOG_DOCUMENT_VALIDATION_FAILED:
    'Candidate LibraryDocument failed strict domain or non-publication validation.',
  INVALID_PERSISTED_HANDOFF_SCHEMA:
    'Persisted catalog handoff link failed strict 18-field schema validation.',
  INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA:
    'Persisted catalog handoff audit event failed strict 20-field schema validation.',
});

export interface CreateLibraryQuarantineCatalogDraftClassificationInput {
  readonly titleAr: string;
  readonly titleEn: string;
  readonly originalTitle?: string;
  readonly summaryAr: string;
  readonly summaryEn: string;
  readonly documentType: LibraryDocumentType;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly geographyAr: string;
  readonly geographyEn: string;
  readonly publicationDate: string;
  readonly language: 'ar' | 'en' | 'bilingual' | 'other';
  readonly topicsAr: readonly string[];
  readonly topicsEn: readonly string[];
  readonly environmentalDomains: readonly string[];
  readonly legalStatusDescriptionAr: string;
  readonly legalStatusDescriptionEn: string;
}

export interface GetLibraryQuarantineCatalogHandoffInput {
  readonly receiptId: string;
}

export interface CreateLibraryQuarantineCatalogDraftInput {
  readonly receiptId: string;
  readonly expectedCaseRevision: number;
  readonly input: CreateLibraryQuarantineCatalogDraftClassificationInput;
}

/**
 * Exact 18-field immutable persisted Firestore document in
 * `library_quarantine_catalog_handoffs/<receiptId>`.
 */
export interface LibraryQuarantinePersistedCatalogHandoff {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly draftSourceRevision: number;
  readonly caseRevision: number;
  readonly caseUpdatedAt: string;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

/**
 * Exact 20-field immutable persisted Firestore audit event in
 * `library_quarantine_catalog_handoff_events/<receiptId>`.
 */
export interface LibraryQuarantinePersistedCatalogHandoffEvent {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly eventType: 'CATALOG_DRAFT_CREATED';
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly draftSourceRevision: number;
  readonly caseRevision: number;
  readonly caseUpdatedAt: string;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly actorUid: string;
  readonly recordedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

/**
 * Sanitized 16-field DTO returned to authorized human Library administrators.
 * Omits `sourceSha256` and `createdBy`.
 */
export interface SanitizedLibraryQuarantineCatalogHandoffDto {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly draftSourceRevision: number;
  readonly caseRevision: number;
  readonly caseUpdatedAt: string;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly createdAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SanitizedLibraryQuarantineCatalogDocumentVersionDto {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: string;
  readonly publishedDate: string;
  readonly changeDescriptionAr: string;
  readonly changeDescriptionEn: string;
}

export interface SanitizedLibraryQuarantineCatalogDocumentDto {
  readonly id: string;
  readonly titleAr: string;
  readonly titleEn: string;
  readonly originalTitle?: string;
  readonly documentType: LibraryDocumentType;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly geographyAr: string;
  readonly geographyEn: string;
  readonly publicationDate: string;
  readonly language: 'ar' | 'en' | 'bilingual' | 'other';
  readonly summaryAr: string;
  readonly summaryEn: string;
  readonly topicsAr: readonly string[];
  readonly topicsEn: readonly string[];
  readonly environmentalDomains: readonly string[];
  readonly rightsStatus: typeof LibraryRightsStatus.ReviewRequired;
  readonly workflowState: typeof WorkflowState.Draft;
  readonly legalStatusDescriptionAr: string;
  readonly legalStatusDescriptionEn: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly SanitizedLibraryQuarantineCatalogDocumentVersionDto[];
}

export interface GetLibraryQuarantineCatalogHandoffSuccessDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly receiptId: string;
  readonly documentId: string;
  readonly handoffExists: boolean;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto | null;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto | null;
  readonly caseStatus: LibraryQuarantineHumanReviewCaseStatus | null;
  readonly currentCaseRevision: number;
  readonly isEligibleForHandoff: boolean;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineCatalogHandoffHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: LibraryQuarantineCatalogHandoffErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineCatalogHandoffResponseDto =
  | GetLibraryQuarantineCatalogHandoffSuccessDto
  | GetLibraryQuarantineCatalogHandoffHoldDto;

export interface CreateLibraryQuarantineCatalogDraftSuccessDto {
  readonly ok: true;
  readonly status: 'HANDOFF_RECORDED';
  readonly disposition: 'CREATED' | 'IDEMPOTENT_EXISTING';
  readonly documentCreationOutcome: 'CREATED' | 'IDEMPOTENT_EXISTING';
  readonly documentCreated: boolean;
  readonly receiptId: string;
  readonly documentId: string;
  readonly caseRevision: number;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface CreateLibraryQuarantineCatalogDraftConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly documentCreationOutcome: 'NOT_CREATED';
  readonly documentCreated: false;
  readonly errorCode: LibraryQuarantineCatalogHandoffConflictCode;
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentCaseRevision: number;
  readonly existingHandoff: SanitizedLibraryQuarantineCatalogHandoffDto | null;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface CreateLibraryQuarantineCatalogDraftHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly documentCreationOutcome: 'NOT_CREATED';
  readonly documentCreated: false;
  readonly errorCode: LibraryQuarantineCatalogHandoffErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface CreateLibraryQuarantineCatalogDraftUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly documentCreationOutcome: 'UNKNOWN';
  readonly documentCreated: null;
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type CreateLibraryQuarantineCatalogDraftResponseDto =
  | CreateLibraryQuarantineCatalogDraftSuccessDto
  | CreateLibraryQuarantineCatalogDraftConflictDto
  | CreateLibraryQuarantineCatalogDraftHoldDto
  | CreateLibraryQuarantineCatalogDraftUnknownDto;

export interface LibraryQuarantineCatalogHandoffServiceOptions {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly clock?: () => string;
}

export function deriveQuarantineCatalogDocumentId(receiptId: string): string {
  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    throw new Error(CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_RECEIPT_ID);
  }
  return `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasUnexpectedPropertyOrSymbol(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): boolean {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowedKeys.has(key)) {
      return true;
    }
  }
  return Object.getOwnPropertySymbols(obj).length > 0;
}

function hasExactKeysAndNoSymbols(
  obj: Record<string, unknown>,
  expectedKeys: ReadonlySet<string>
): boolean {
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    return false;
  }
  const ownKeys = Object.getOwnPropertyNames(obj);
  if (ownKeys.length !== expectedKeys.size) {
    return false;
  }
  for (const key of ownKeys) {
    if (!expectedKeys.has(key)) {
      return false;
    }
  }
  return true;
}

function normalizeAndValidatePlainText(
  raw: unknown,
  maxLength: number,
  allowMultiLine: boolean
):
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly errorCode:
        | 'INVALID_PLAIN_TEXT_FIELD'
        | 'FIELD_MAX_LENGTH_EXCEEDED';
    } {
  if (typeof raw !== 'string') {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }

  const normalizedLineEndings = allowMultiLine
    ? raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : raw;

  const controlRegex = allowMultiLine
    ? MULTI_LINE_CONTROL_OR_BIDI_REGEX
    : SINGLE_LINE_CONTROL_OR_BIDI_REGEX;

  if (controlRegex.test(normalizedLineEndings)) {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }

  const trimmed = normalizedLineEndings.trim();
  if (trimmed.length > maxLength) {
    return { ok: false, errorCode: 'FIELD_MAX_LENGTH_EXCEEDED' };
  }

  if (
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(trimmed) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(trimmed)
  ) {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }

  return { ok: true, value: trimmed };
}

function isValidCalendarDateString(value: string): boolean {
  if (!CALENDAR_DATE_REGEX.test(value)) {
    return false;
  }
  const parsedMs = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsedMs)) {
    return false;
  }
  const isoDatePart = new Date(parsedMs).toISOString().slice(0, 10);
  return isoDatePart === value;
}

export function validateCreateCatalogDraftClassificationInput(
  rawInput: unknown
):
  | {
      readonly ok: true;
      readonly value: CreateLibraryQuarantineCatalogDraftClassificationInput;
    }
  | {
      readonly ok: false;
      readonly errorCode: LibraryQuarantineCatalogHandoffErrorCode;
      readonly errorMessage: string;
    } {
  if (!isPlainRecord(rawInput)) {
    return {
      ok: false,
      errorCode: 'INVALID_CLASSIFICATION_INPUT',
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_CLASSIFICATION_INPUT,
    };
  }

  if (
    hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_CLASSIFICATION_INPUT_KEYS)
  ) {
    return {
      ok: false,
      errorCode: 'UNTRUSTED_OR_FORBIDDEN_CLASSIFICATION_FIELD',
      errorMessage:
        CATALOG_HANDOFF_SAFE_MESSAGES.UNTRUSTED_OR_FORBIDDEN_CLASSIFICATION_FIELD,
    };
  }

  const titleArRes = normalizeAndValidatePlainText(
    rawInput.titleAr,
    CATALOG_HANDOFF_TITLE_MAX_LENGTH,
    false
  );
  if (!titleArRes.ok) {
    return {
      ok: false,
      errorCode: titleArRes.errorCode,
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[titleArRes.errorCode],
    };
  }
  if (titleArRes.value.length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_CLASSIFICATION_INPUT',
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_CLASSIFICATION_INPUT,
    };
  }

  const titleEnRes = normalizeAndValidatePlainText(
    rawInput.titleEn,
    CATALOG_HANDOFF_TITLE_MAX_LENGTH,
    false
  );
  if (!titleEnRes.ok) {
    return {
      ok: false,
      errorCode: titleEnRes.errorCode,
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[titleEnRes.errorCode],
    };
  }
  if (titleEnRes.value.length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_CLASSIFICATION_INPUT',
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_CLASSIFICATION_INPUT,
    };
  }

  let originalTitle: string | undefined;
  if (rawInput.originalTitle !== undefined) {
    const origRes = normalizeAndValidatePlainText(
      rawInput.originalTitle,
      CATALOG_HANDOFF_TITLE_MAX_LENGTH,
      false
    );
    if (!origRes.ok) {
      return {
        ok: false,
        errorCode: origRes.errorCode,
        errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[origRes.errorCode],
      };
    }
    if (origRes.value.length > 0) {
      originalTitle = origRes.value;
    }
  }

  const summaryArRes = normalizeAndValidatePlainText(
    rawInput.summaryAr,
    CATALOG_HANDOFF_SUMMARY_MAX_LENGTH,
    true
  );
  if (!summaryArRes.ok) {
    return {
      ok: false,
      errorCode: summaryArRes.errorCode,
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[summaryArRes.errorCode],
    };
  }
  if (summaryArRes.value.length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_CLASSIFICATION_INPUT',
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_CLASSIFICATION_INPUT,
    };
  }

  const summaryEnRes = normalizeAndValidatePlainText(
    rawInput.summaryEn,
    CATALOG_HANDOFF_SUMMARY_MAX_LENGTH,
    true
  );
  if (!summaryEnRes.ok) {
    return {
      ok: false,
      errorCode: summaryEnRes.errorCode,
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[summaryEnRes.errorCode],
    };
  }
  if (summaryEnRes.value.length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_CLASSIFICATION_INPUT',
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_CLASSIFICATION_INPUT,
    };
  }

  if (
    typeof rawInput.documentType !== 'string' ||
    !ALLOWED_DOCUMENT_TYPES.has(rawInput.documentType)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_DOCUMENT_TYPE',
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_DOCUMENT_TYPE,
    };
  }
  const documentType = rawInput.documentType as LibraryDocumentType;

  const orgIdRes = normalizeAndValidatePlainText(
    rawInput.organizationId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    false
  );
  if (!orgIdRes.ok || orgIdRes.value.length === 0) {
    return {
      ok: false,
      errorCode: orgIdRes.ok
        ? 'INVALID_CLASSIFICATION_INPUT'
        : orgIdRes.errorCode,
      errorMessage:
        CATALOG_HANDOFF_SAFE_MESSAGES[
          orgIdRes.ok ? 'INVALID_CLASSIFICATION_INPUT' : orgIdRes.errorCode
        ],
    };
  }

  const sourceIdRes = normalizeAndValidatePlainText(
    rawInput.sourceId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    false
  );
  if (!sourceIdRes.ok || sourceIdRes.value.length === 0) {
    return {
      ok: false,
      errorCode: sourceIdRes.ok
        ? 'INVALID_CLASSIFICATION_INPUT'
        : sourceIdRes.errorCode,
      errorMessage:
        CATALOG_HANDOFF_SAFE_MESSAGES[
          sourceIdRes.ok ? 'INVALID_CLASSIFICATION_INPUT' : sourceIdRes.errorCode
        ],
    };
  }

  const geographyArRes = normalizeAndValidatePlainText(
    rawInput.geographyAr,
    CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH,
    false
  );
  if (!geographyArRes.ok || geographyArRes.value.length === 0) {
    return {
      ok: false,
      errorCode: geographyArRes.ok
        ? 'INVALID_CLASSIFICATION_INPUT'
        : geographyArRes.errorCode,
      errorMessage:
        CATALOG_HANDOFF_SAFE_MESSAGES[
          geographyArRes.ok
            ? 'INVALID_CLASSIFICATION_INPUT'
            : geographyArRes.errorCode
        ],
    };
  }

  const geographyEnRes = normalizeAndValidatePlainText(
    rawInput.geographyEn,
    CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH,
    false
  );
  if (!geographyEnRes.ok || geographyEnRes.value.length === 0) {
    return {
      ok: false,
      errorCode: geographyEnRes.ok
        ? 'INVALID_CLASSIFICATION_INPUT'
        : geographyEnRes.errorCode,
      errorMessage:
        CATALOG_HANDOFF_SAFE_MESSAGES[
          geographyEnRes.ok
            ? 'INVALID_CLASSIFICATION_INPUT'
            : geographyEnRes.errorCode
        ],
    };
  }

  const pubDateRes = normalizeAndValidatePlainText(
    rawInput.publicationDate,
    32,
    false
  );
  if (!pubDateRes.ok || !isValidCalendarDateString(pubDateRes.value)) {
    return {
      ok: false,
      errorCode: 'INVALID_PUBLICATION_DATE',
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_PUBLICATION_DATE,
    };
  }

  if (
    typeof rawInput.language !== 'string' ||
    !ALLOWED_LANGUAGES.has(rawInput.language)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_LANGUAGE',
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.INVALID_LANGUAGE,
    };
  }
  const language = rawInput.language as 'ar' | 'en' | 'bilingual' | 'other';

  const validateTagArray = (
    rawArr: unknown,
    maxItems: number
  ):
    | { readonly ok: true; readonly items: readonly string[] }
    | {
        readonly ok: false;
        readonly errorCode: LibraryQuarantineCatalogHandoffErrorCode;
      } => {
    if (
      !Array.isArray(rawArr) ||
      rawArr.length < 1 ||
      rawArr.length > maxItems
    ) {
      return { ok: false, errorCode: 'INVALID_TOPICS_OR_DOMAINS' };
    }
    const items: string[] = [];
    for (const rawItem of rawArr) {
      const itemRes = normalizeAndValidatePlainText(
        rawItem,
        CATALOG_HANDOFF_TAG_MAX_LENGTH,
        false
      );
      if (!itemRes.ok) {
        return { ok: false, errorCode: itemRes.errorCode };
      }
      if (itemRes.value.length === 0) {
        return { ok: false, errorCode: 'INVALID_TOPICS_OR_DOMAINS' };
      }
      items.push(itemRes.value);
    }
    return { ok: true, items: Object.freeze(items) };
  };

  const topicsArRes = validateTagArray(
    rawInput.topicsAr,
    CATALOG_HANDOFF_MAX_TOPICS
  );
  if (!topicsArRes.ok) {
    return {
      ok: false,
      errorCode: topicsArRes.errorCode,
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[topicsArRes.errorCode],
    };
  }

  const topicsEnRes = validateTagArray(
    rawInput.topicsEn,
    CATALOG_HANDOFF_MAX_TOPICS
  );
  if (!topicsEnRes.ok) {
    return {
      ok: false,
      errorCode: topicsEnRes.errorCode,
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[topicsEnRes.errorCode],
    };
  }

  const domainsRes = validateTagArray(
    rawInput.environmentalDomains,
    CATALOG_HANDOFF_MAX_DOMAINS
  );
  if (!domainsRes.ok) {
    return {
      ok: false,
      errorCode: domainsRes.errorCode,
      errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[domainsRes.errorCode],
    };
  }

  const legalArRes = normalizeAndValidatePlainText(
    rawInput.legalStatusDescriptionAr,
    CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH,
    true
  );
  if (!legalArRes.ok || legalArRes.value.length === 0) {
    return {
      ok: false,
      errorCode: legalArRes.ok
        ? 'INVALID_CLASSIFICATION_INPUT'
        : legalArRes.errorCode,
      errorMessage:
        CATALOG_HANDOFF_SAFE_MESSAGES[
          legalArRes.ok ? 'INVALID_CLASSIFICATION_INPUT' : legalArRes.errorCode
        ],
    };
  }

  const legalEnRes = normalizeAndValidatePlainText(
    rawInput.legalStatusDescriptionEn,
    CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH,
    true
  );
  if (!legalEnRes.ok || legalEnRes.value.length === 0) {
    return {
      ok: false,
      errorCode: legalEnRes.ok
        ? 'INVALID_CLASSIFICATION_INPUT'
        : legalEnRes.errorCode,
      errorMessage:
        CATALOG_HANDOFF_SAFE_MESSAGES[
          legalEnRes.ok ? 'INVALID_CLASSIFICATION_INPUT' : legalEnRes.errorCode
        ],
    };
  }

  const value: CreateLibraryQuarantineCatalogDraftClassificationInput =
    Object.freeze({
      titleAr: titleArRes.value,
      titleEn: titleEnRes.value,
      ...(originalTitle !== undefined ? { originalTitle } : {}),
      summaryAr: summaryArRes.value,
      summaryEn: summaryEnRes.value,
      documentType,
      organizationId: orgIdRes.value,
      sourceId: sourceIdRes.value,
      geographyAr: geographyArRes.value,
      geographyEn: geographyEnRes.value,
      publicationDate: pubDateRes.value,
      language,
      topicsAr: topicsArRes.items,
      topicsEn: topicsEnRes.items,
      environmentalDomains: domainsRes.items,
      legalStatusDescriptionAr: legalArRes.value,
      legalStatusDescriptionEn: legalEnRes.value,
    });

  return { ok: true, value };
}

export function validatePersistedLibraryQuarantineCatalogHandoff(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly handoff: LibraryQuarantinePersistedCatalogHandoff;
    }
  | {
      readonly ok: false;
      readonly errorCode:
        | 'INVALID_PERSISTED_HANDOFF_SCHEMA'
        | 'SECURITY_POSTURE_VIOLATION';
    } {
  if (
    !isPlainRecord(raw) ||
    !hasExactKeysAndNoSymbols(raw, ALLOWED_PERSISTED_HANDOFF_KEYS)
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false
  ) {
    return { ok: false, errorCode: 'SECURITY_POSTURE_VIOLATION' };
  }

  if (
    raw.schemaVersion !== LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId)
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  if (
    expectedReceiptId !== undefined &&
    raw.receiptId !== expectedReceiptId
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentId(raw.receiptId);
  if (
    typeof raw.documentId !== 'string' ||
    raw.documentId !== expectedDocumentId ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(raw.documentId)
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  if (
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    typeof raw.draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.draftSourceRevision) ||
    raw.draftSourceRevision !== raw.sourceRevision ||
    typeof raw.caseRevision !== 'number' ||
    !Number.isSafeInteger(raw.caseRevision) ||
    raw.caseRevision < 1
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  if (
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    !isValidIsoUtcTimestamp(raw.caseUpdatedAt) ||
    !isValidIsoUtcTimestamp(raw.createdAt)
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  if (
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(raw.sourceSha256)
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  if (!isValidUploaderUid(raw.createdBy)) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  const orgIdRes = normalizeAndValidatePlainText(
    raw.organizationId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    false
  );
  const srcIdRes = normalizeAndValidatePlainText(
    raw.sourceId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    false
  );
  if (
    !orgIdRes.ok ||
    orgIdRes.value.length === 0 ||
    orgIdRes.value !== raw.organizationId ||
    !srcIdRes.ok ||
    srcIdRes.value.length === 0 ||
    srcIdRes.value !== raw.sourceId
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_SCHEMA' };
  }

  return {
    ok: true,
    handoff: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
      receiptId: raw.receiptId,
      documentId: raw.documentId,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
      draftSourceRevision: raw.draftSourceRevision,
      caseRevision: raw.caseRevision,
      caseUpdatedAt: raw.caseUpdatedAt,
      organizationId: raw.organizationId,
      sourceId: raw.sourceId,
      createdBy: raw.createdBy,
      createdAt: raw.createdAt,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    }),
  };
}

export function validatePersistedLibraryQuarantineCatalogHandoffEvent(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly handoffEvent: LibraryQuarantinePersistedCatalogHandoffEvent;
    }
  | {
      readonly ok: false;
      readonly errorCode:
        | 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA'
        | 'SECURITY_POSTURE_VIOLATION';
    } {
  if (
    !isPlainRecord(raw) ||
    !hasExactKeysAndNoSymbols(raw, ALLOWED_PERSISTED_HANDOFF_EVENT_KEYS)
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false
  ) {
    return { ok: false, errorCode: 'SECURITY_POSTURE_VIOLATION' };
  }

  if (
    raw.schemaVersion !==
      LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENT_SCHEMA_VERSION ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId) ||
    raw.eventId !== raw.receiptId ||
    raw.eventType !== 'CATALOG_DRAFT_CREATED'
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  if (
    expectedReceiptId !== undefined &&
    raw.receiptId !== expectedReceiptId
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentId(raw.receiptId);
  if (
    typeof raw.documentId !== 'string' ||
    raw.documentId !== expectedDocumentId
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  if (
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    typeof raw.draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.draftSourceRevision) ||
    raw.draftSourceRevision !== raw.sourceRevision ||
    typeof raw.caseRevision !== 'number' ||
    !Number.isSafeInteger(raw.caseRevision) ||
    raw.caseRevision < 1
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  if (
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    !isValidIsoUtcTimestamp(raw.caseUpdatedAt) ||
    !isValidIsoUtcTimestamp(raw.recordedAt)
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  if (
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(raw.sourceSha256)
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  if (!isValidUploaderUid(raw.actorUid)) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  const orgIdRes = normalizeAndValidatePlainText(
    raw.organizationId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    false
  );
  const srcIdRes = normalizeAndValidatePlainText(
    raw.sourceId,
    CATALOG_HANDOFF_ID_REF_MAX_LENGTH,
    false
  );
  if (
    !orgIdRes.ok ||
    orgIdRes.value.length === 0 ||
    orgIdRes.value !== raw.organizationId ||
    !srcIdRes.ok ||
    srcIdRes.value.length === 0 ||
    srcIdRes.value !== raw.sourceId
  ) {
    return { ok: false, errorCode: 'INVALID_PERSISTED_HANDOFF_EVENT_SCHEMA' };
  }

  return {
    ok: true,
    handoffEvent: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENT_SCHEMA_VERSION,
      eventId: raw.eventId,
      receiptId: raw.receiptId,
      documentId: raw.documentId,
      eventType: 'CATALOG_DRAFT_CREATED' as const,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
      draftSourceRevision: raw.draftSourceRevision,
      caseRevision: raw.caseRevision,
      caseUpdatedAt: raw.caseUpdatedAt,
      organizationId: raw.organizationId,
      sourceId: raw.sourceId,
      actorUid: raw.actorUid,
      recordedAt: raw.recordedAt,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    }),
  };
}

export function validatePersistedCatalogDraftDocument(
  raw: unknown,
  expectedDocumentId: string
):
  | {
      readonly ok: true;
      readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
    }
  | {
      readonly ok: false;
      readonly errorCode:
        | 'INCONSISTENT_EXISTING_HANDOFF_STATE'
        | 'SECURITY_POSTURE_VIOLATION';
    } {
  if (!isPlainRecord(raw)) {
    return { ok: false, errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' };
  }

  if (
    typeof raw.id !== 'string' ||
    raw.id !== expectedDocumentId ||
    !isQuarantineCatalogDocumentId(raw.id)
  ) {
    return { ok: false, errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' };
  }

  if (
    raw.workflowState !== WorkflowState.Draft ||
    raw.rightsStatus !== LibraryRightsStatus.ReviewRequired
  ) {
    return { ok: false, errorCode: 'SECURITY_POSTURE_VIOLATION' };
  }

  if (!Array.isArray(raw.workflowHistory) || raw.workflowHistory.length !== 0) {
    return { ok: false, errorCode: 'SECURITY_POSTURE_VIOLATION' };
  }

  if (!Array.isArray(raw.versions) || raw.versions.length < 1) {
    return { ok: false, errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' };
  }

  const safeVersions: SanitizedLibraryQuarantineCatalogDocumentVersionDto[] = [];
  for (const v of raw.versions) {
    if (!isPlainRecord(v)) {
      return { ok: false, errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' };
    }
    if (v.referenceUrl !== undefined && v.referenceUrl !== null) {
      return { ok: false, errorCode: 'SECURITY_POSTURE_VIOLATION' };
    }
    if (
      typeof v.id !== 'string' ||
      typeof v.documentId !== 'string' ||
      v.documentId !== expectedDocumentId ||
      typeof v.versionNumber !== 'string' ||
      typeof v.publishedDate !== 'string' ||
      typeof v.changeDescriptionAr !== 'string' ||
      typeof v.changeDescriptionEn !== 'string'
    ) {
      return { ok: false, errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' };
    }
    safeVersions.push(
      Object.freeze({
        id: v.id,
        documentId: v.documentId,
        versionNumber: v.versionNumber,
        publishedDate: v.publishedDate,
        changeDescriptionAr: v.changeDescriptionAr,
        changeDescriptionEn: v.changeDescriptionEn,
      })
    );
  }

  try {
    LibraryValidator.validateDocument(raw as unknown as LibraryDocument);
  } catch {
    return { ok: false, errorCode: 'INCONSISTENT_EXISTING_HANDOFF_STATE' };
  }

  const doc = raw as unknown as LibraryDocument;
  const dto: SanitizedLibraryQuarantineCatalogDocumentDto = Object.freeze({
    id: doc.id,
    titleAr: doc.titleAr,
    titleEn: doc.titleEn,
    ...(typeof doc.originalTitle === 'string' &&
    doc.originalTitle.trim().length > 0
      ? { originalTitle: doc.originalTitle.trim() }
      : {}),
    documentType: doc.documentType,
    organizationId: doc.organizationId,
    sourceId: doc.sourceId,
    geographyAr: doc.geographyAr,
    geographyEn: doc.geographyEn,
    publicationDate: doc.publicationDate,
    language: doc.language,
    summaryAr: doc.summaryAr,
    summaryEn: doc.summaryEn,
    topicsAr: Object.freeze([...doc.topicsAr]),
    topicsEn: Object.freeze([...doc.topicsEn]),
    environmentalDomains: Object.freeze([...doc.environmentalDomains]),
    rightsStatus: LibraryRightsStatus.ReviewRequired,
    workflowState: WorkflowState.Draft,
    legalStatusDescriptionAr: doc.legalStatusDescriptionAr,
    legalStatusDescriptionEn: doc.legalStatusDescriptionEn,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    versions: Object.freeze(safeVersions),
  });

  return { ok: true, catalogDocument: dto };
}

export function toSanitizedLibraryQuarantineCatalogHandoffDto(
  persisted: LibraryQuarantinePersistedCatalogHandoff
): SanitizedLibraryQuarantineCatalogHandoffDto {
  const checked = validatePersistedLibraryQuarantineCatalogHandoff(
    persisted,
    persisted?.receiptId
  );
  if (!checked.ok) {
    throw new Error(CATALOG_HANDOFF_SAFE_MESSAGES[checked.errorCode]);
  }
  const h = checked.handoff;
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
    receiptId: h.receiptId,
    documentId: h.documentId,
    sourceRevision: h.sourceRevision,
    sourceUpdatedAt: h.sourceUpdatedAt,
    draftSourceRevision: h.draftSourceRevision,
    caseRevision: h.caseRevision,
    caseUpdatedAt: h.caseUpdatedAt,
    organizationId: h.organizationId,
    sourceId: h.sourceId,
    createdAt: h.createdAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function hasAutomatedOrAiTokenClaim(
  token: Readonly<Record<string, unknown>>
): boolean {
  const principalTypeLower =
    typeof token.principalType === 'string'
      ? token.principalType.trim().toLowerCase()
      : '';
  const actorTypeLower =
    typeof token.actorType === 'string'
      ? token.actorType.trim().toLowerCase()
      : '';
  const roleLower =
    typeof token.role === 'string' ? token.role.trim().toLowerCase() : '';

  return (
    token.role === AdminRole.AIAssistant ||
    roleLower === 'ai_assistant' ||
    roleLower === 'aiassistant' ||
    token.isAIAssistant === true ||
    token.isAiAssistant === true ||
    token.aiAssistant === true ||
    token.ai === true ||
    token.automated === true ||
    token.isBot === true ||
    principalTypeLower === 'ai' ||
    principalTypeLower === 'machine' ||
    principalTypeLower === 'bot' ||
    actorTypeLower === 'ai' ||
    actorTypeLower === 'machine' ||
    actorTypeLower === 'bot'
  );
}

/**
 * Verifies that the authenticated caller is an active human Library administrator
 * who possesses BOTH `AdminPermission.Review` AND `AdminPermission.Create`.
 */
export function isAuthorizedHumanLibraryCatalogHandoffActor(
  user: AdminUser | null | undefined
): user is AdminUser {
  if (!user || typeof user !== 'object') {
    return false;
  }
  if (user.isActive !== true) {
    return false;
  }
  if (!isValidAdminRole(user.role) || user.role === AdminRole.AIAssistant) {
    return false;
  }
  const hasLibraryOrRightsDomain =
    hasDomainResponsibility(user.role, AdminDomain.Library) ||
    user.role === AdminRole.RightsReviewer;
  if (!hasLibraryOrRightsDomain) {
    return false;
  }
  if (
    !AdminAuthorizationService.hasPermission(user, AdminPermission.Review) ||
    !AdminAuthorizationService.hasPermission(user, AdminPermission.Create)
  ) {
    return false;
  }

  const explicitPermissions = (
    user as AdminUser & { readonly permissions?: unknown }
  ).permissions;
  if (explicitPermissions !== undefined) {
    if (
      !Array.isArray(explicitPermissions) ||
      !explicitPermissions.includes(AdminPermission.Review) ||
      !explicitPermissions.includes(AdminPermission.Create)
    ) {
      return false;
    }
  }

  return true;
}

function makeGetHoldDto(
  errorCode: LibraryQuarantineCatalogHandoffErrorCode,
  receiptId: string | null
): GetLibraryQuarantineCatalogHandoffHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    errorCode,
    errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentId(safeReceiptId)
      : null,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeCreateHoldDto(
  errorCode: LibraryQuarantineCatalogHandoffErrorCode,
  receiptId: string | null
): CreateLibraryQuarantineCatalogDraftHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;

  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    documentCreationOutcome: 'NOT_CREATED' as const,
    documentCreated: false as const,
    errorCode,
    errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES[errorCode],
    receiptId: safeReceiptId,
    documentId: safeReceiptId
      ? deriveQuarantineCatalogDocumentId(safeReceiptId)
      : null,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeCreateUnknownDto(
  receiptId: string
): CreateLibraryQuarantineCatalogDraftUnknownDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    documentCreationOutcome: 'UNKNOWN' as const,
    documentCreated: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
    errorMessage: CATALOG_HANDOFF_SAFE_MESSAGES.TRANSACTION_COMMIT_UNCERTAIN,
    receiptId,
    documentId: deriveQuarantineCatalogDocumentId(receiptId),
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
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

export class LibraryQuarantineCatalogHandoffService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  private readonly clock: () => string;

  constructor(options: LibraryQuarantineCatalogHandoffServiceOptions) {
    if (
      !options ||
      typeof options !== 'object' ||
      !options.trustedPrincipalProvider ||
      typeof options.trustedPrincipalProvider.resolveAuthenticatedPrincipal !==
        'function' ||
      !options.adminRepository ||
      typeof options.adminRepository.getAdminByUid !== 'function' ||
      !options.db ||
      typeof options.db.collection !== 'function' ||
      typeof options.db.runTransaction !== 'function'
    ) {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: LibraryQuarantineCatalogHandoffService requires valid trustedPrincipalProvider, adminRepository, and Firestore db.'
      );
    }

    if (options.clock !== undefined && typeof options.clock !== 'function') {
      throw new Error(
        'INVALID_SERVICE_DEPENDENCY: Optional clock must be a function returning an ISO-8601 UTC timestamp.'
      );
    }

    const underlyingPrincipalProvider = options.trustedPrincipalProvider;
    this.trustedPrincipalProvider = Object.freeze({
      resolveAuthenticatedPrincipal: () =>
        underlyingPrincipalProvider.resolveAuthenticatedPrincipal(),
    });

    const underlyingAdminRepo = options.adminRepository;
    this.adminRepository = Object.freeze({
      getAdminByUid: (uid: string) => underlyingAdminRepo.getAdminByUid(uid),
    });

    this.db = options.db;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private assertAllowedWriteCollection(collectionName: string): void {
    if (!ALLOWED_WRITE_COLLECTIONS.has(collectionName)) {
      throw new Error(
        `FORBIDDEN_COLLECTION_WRITE: Attempted to write to collection "${collectionName}".`
      );
    }
  }

  private async resolveAndAuthorizeActor(): Promise<
    | { readonly ok: true; readonly actorUid: string }
    | {
        readonly ok: false;
        readonly errorCode:
          | 'UNAUTHENTICATED_CALLER_HOLD'
          | 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD';
      }
  > {
    let rawPrincipal: TrustedQuarantineAuthenticatedPrincipal | null;
    try {
      rawPrincipal =
        await this.trustedPrincipalProvider.resolveAuthenticatedPrincipal();
    } catch {
      return { ok: false, errorCode: 'UNAUTHENTICATED_CALLER_HOLD' };
    }

    if (!isPlainRecord(rawPrincipal)) {
      return { ok: false, errorCode: 'UNAUTHENTICATED_CALLER_HOLD' };
    }

    if (hasUnexpectedPropertyOrSymbol(rawPrincipal, ALLOWED_PRINCIPAL_KEYS)) {
      return { ok: false, errorCode: 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD' };
    }

    const uid = rawPrincipal.uid;
    if (
      typeof uid !== 'string' ||
      uid.trim() !== uid ||
      !isValidUploaderUid(uid)
    ) {
      return { ok: false, errorCode: 'UNAUTHENTICATED_CALLER_HOLD' };
    }

    if (rawPrincipal.token !== undefined) {
      if (
        !isPlainRecord(rawPrincipal.token) ||
        Object.getOwnPropertySymbols(rawPrincipal.token).length > 0
      ) {
        return { ok: false, errorCode: 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD' };
      }

      for (const key of Object.getOwnPropertyNames(rawPrincipal.token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(key)) {
          return { ok: false, errorCode: 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD' };
        }
      }

      if (hasAutomatedOrAiTokenClaim(rawPrincipal.token)) {
        return { ok: false, errorCode: 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD' };
      }
    }

    let adminUser: AdminUser | null;
    try {
      adminUser = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return { ok: false, errorCode: 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD' };
    }

    if (
      !adminUser ||
      typeof adminUser.id !== 'string' ||
      adminUser.id.trim() !== uid ||
      adminUser.id !== uid
    ) {
      return { ok: false, errorCode: 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD' };
    }

    if (!isAuthorizedHumanLibraryCatalogHandoffActor(adminUser)) {
      return { ok: false, errorCode: 'UNAUTHORIZED_HANDOFF_ACTOR_HOLD' };
    }

    return { ok: true, actorUid: uid };
  }

  private async readPointSnapshot(
    collectionName: string,
    docId: string
  ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> {
    const ref: LibraryQuarantineFirestoreDocumentRef = this.db
      .collection(collectionName)
      .doc(docId);
    if (typeof ref.get !== 'function') {
      throw new Error('Document reference must provide get()');
    }
    return ref.get();
  }

  /**
   * Reads the current catalog handoff status and linked internal `LibraryDocument`
   * draft (if already created) for an eligible `Quarantined` receipt.
   */
  public async getQuarantineCatalogHandoff(
    rawInput: unknown
  ): Promise<GetLibraryQuarantineCatalogHandoffResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makeGetHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_GET_INPUT_KEYS)) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeGetHoldDto('UNTRUSTED_CALLER_FIELD_HOLD', candidateId);
    }

    if (!Object.prototype.hasOwnProperty.call(rawInput, 'receiptId')) {
      return makeGetHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    const receiptId = rawInput.receiptId;
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeGetHoldDto('INVALID_RECEIPT_ID', null);
    }

    const authResult = await this.resolveAndAuthorizeActor();
    if (!authResult.ok) {
      return makeGetHoldDto(authResult.errorCode, receiptId);
    }

    const documentId = deriveQuarantineCatalogDocumentId(receiptId);

    let receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    let draftSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    let caseSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    let handoffSnap: LibraryQuarantineFirestoreDocumentSnapshot;
    let docSnap: LibraryQuarantineFirestoreDocumentSnapshot;

    try {
      receiptSnap = await this.readPointSnapshot(
        LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
        receiptId
      );
      draftSnap = await this.readPointSnapshot(
        LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
        receiptId
      );
      caseSnap = await this.readPointSnapshot(
        LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
        receiptId
      );
      handoffSnap = await this.readPointSnapshot(
        LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
        receiptId
      );
      docSnap = await this.readPointSnapshot(
        LIBRARY_DOCUMENTS_COLLECTION,
        documentId
      );
    } catch {
      return makeGetHoldDto('STORE_READ_FAILED', receiptId);
    }

    const eligibility = verifyReceiptAndDraftEligibleForHumanReviewCase(
      receiptId,
      receiptSnap,
      draftSnap
    );
    if (!eligibility.ok) {
      return makeGetHoldDto(eligibility.reasonCode, receiptId);
    }

    const { receiptEnvelope, reviewDraft } = eligibility;
    const receipt = receiptEnvelope.receipt;

    let reviewCase: LibraryQuarantinePersistedHumanReviewCase | null = null;
    if (caseSnap.exists) {
      if (caseSnap.id !== receiptId) {
        return makeGetHoldDto('DOCUMENT_ID_MISMATCH', receiptId);
      }
      const caseValidation = validatePersistedLibraryQuarantineHumanReviewCase(
        caseSnap.data(),
        receiptId
      );
      if (!caseValidation.ok) {
        return makeGetHoldDto('CORRUPTED_EXISTING_HUMAN_REVIEW_CASE', receiptId);
      }
      reviewCase = caseValidation.reviewCase;
      if (
        reviewCase.sourceRevision !== receiptEnvelope.revision ||
        reviewCase.sourceUpdatedAt !== receipt.updatedAt ||
        reviewCase.sourceSha256 !== receipt.sha256 ||
        reviewCase.draftSourceRevision !== reviewDraft.sourceRevision
      ) {
        return makeGetHoldDto('CASE_SOURCE_STALE_OR_MISMATCHED', receiptId);
      }
    }

    if (!handoffSnap.exists && !docSnap.exists) {
      const isEligibleForHandoff = Boolean(
        reviewCase &&
          reviewCase.status === 'METADATA_RECORDED' &&
          reviewCase.sourceEvidenceNotes.trim().length > 0 &&
          (reviewCase.titleAr.trim().length > 0 ||
            reviewCase.titleEn.trim().length > 0)
      );

      return Object.freeze({
        ok: true as const,
        status: 'READY' as const,
        receiptId,
        documentId,
        handoffExists: false,
        handoff: null,
        catalogDocument: null,
        caseStatus: reviewCase ? reviewCase.status : null,
        currentCaseRevision: reviewCase ? reviewCase.revision : 0,
        isEligibleForHandoff,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (!handoffSnap.exists || !docSnap.exists) {
      return makeGetHoldDto('INCONSISTENT_EXISTING_HANDOFF_STATE', receiptId);
    }

    if (handoffSnap.id !== receiptId || docSnap.id !== documentId) {
      return makeGetHoldDto('DOCUMENT_ID_MISMATCH', receiptId);
    }

    const handoffCheck = validatePersistedLibraryQuarantineCatalogHandoff(
      handoffSnap.data(),
      receiptId
    );
    if (!handoffCheck.ok) {
      return makeGetHoldDto(handoffCheck.errorCode, receiptId);
    }

    const persistedHandoff = handoffCheck.handoff;
    if (
      persistedHandoff.sourceRevision !== receiptEnvelope.revision ||
      persistedHandoff.sourceUpdatedAt !== receipt.updatedAt ||
      persistedHandoff.sourceSha256 !== receipt.sha256 ||
      persistedHandoff.draftSourceRevision !== reviewDraft.sourceRevision
    ) {
      return makeGetHoldDto('HANDOFF_SOURCE_MISMATCH', receiptId);
    }

    const docCheck = validatePersistedCatalogDraftDocument(
      docSnap.data(),
      documentId
    );
    if (!docCheck.ok) {
      return makeGetHoldDto(docCheck.errorCode, receiptId);
    }

    if (
      docCheck.catalogDocument.organizationId !==
        persistedHandoff.organizationId ||
      docCheck.catalogDocument.sourceId !== persistedHandoff.sourceId
    ) {
      return makeGetHoldDto('INCONSISTENT_EXISTING_HANDOFF_STATE', receiptId);
    }

    const sanitizedHandoff =
      toSanitizedLibraryQuarantineCatalogHandoffDto(persistedHandoff);

    return Object.freeze({
      ok: true as const,
      status: 'READY' as const,
      receiptId,
      documentId,
      handoffExists: true,
      handoff: sanitizedHandoff,
      catalogDocument: docCheck.catalogDocument,
      caseStatus: reviewCase ? reviewCase.status : null,
      currentCaseRevision: reviewCase ? reviewCase.revision : 0,
      isEligibleForHandoff: Boolean(
        reviewCase && reviewCase.status === 'METADATA_RECORDED'
      ),
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  /**
   * Executes an atomic 8-read / 3-create Firestore transaction to create an
   * internal `LibraryDocument` catalog draft (`qcat-<receiptId>`), immutable
   * handoff link (`library_quarantine_catalog_handoffs/<receiptId>`), and
   * append-only audit event (`library_quarantine_catalog_handoff_events/<receiptId>`).
   */
  public async createQuarantineCatalogDraft(
    rawInput: unknown
  ): Promise<CreateLibraryQuarantineCatalogDraftResponseDto> {
    if (!isPlainRecord(rawInput)) {
      return makeCreateHoldDto('INVALID_SERVICE_INPUT_HOLD', null);
    }

    if (hasUnexpectedPropertyOrSymbol(rawInput, ALLOWED_CREATE_INPUT_KEYS)) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeCreateHoldDto('UNTRUSTED_CALLER_FIELD_HOLD', candidateId);
    }

    if (
      !Object.prototype.hasOwnProperty.call(rawInput, 'receiptId') ||
      !Object.prototype.hasOwnProperty.call(rawInput, 'expectedCaseRevision') ||
      !Object.prototype.hasOwnProperty.call(rawInput, 'input')
    ) {
      const candidateId = isValidLibraryQuarantineReceiptId(rawInput.receiptId)
        ? rawInput.receiptId
        : null;
      return makeCreateHoldDto('INVALID_SERVICE_INPUT_HOLD', candidateId);
    }

    const receiptId = rawInput.receiptId;
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      return makeCreateHoldDto('INVALID_RECEIPT_ID', null);
    }

    const expectedCaseRevision = rawInput.expectedCaseRevision;
    if (
      typeof expectedCaseRevision !== 'number' ||
      !Number.isSafeInteger(expectedCaseRevision) ||
      expectedCaseRevision < 1
    ) {
      return makeCreateHoldDto('INVALID_EXPECTED_CASE_REVISION', receiptId);
    }

    const classificationValidation =
      validateCreateCatalogDraftClassificationInput(rawInput.input);
    if (!classificationValidation.ok) {
      return makeCreateHoldDto(classificationValidation.errorCode, receiptId);
    }
    const classification = classificationValidation.value;

    const authResult = await this.resolveAndAuthorizeActor();
    if (!authResult.ok) {
      return makeCreateHoldDto(authResult.errorCode, receiptId);
    }

    let nowIso: string;
    try {
      nowIso = this.clock();
    } catch {
      return makeCreateHoldDto('INVALID_TIMESTAMP', receiptId);
    }
    if (!isValidIsoUtcTimestamp(nowIso)) {
      return makeCreateHoldDto('INVALID_TIMESTAMP', receiptId);
    }

    const documentId = deriveQuarantineCatalogDocumentId(receiptId);

    const receiptRef = this.db
      .collection(LIBRARY_QUARANTINE_RECEIPT_COLLECTION)
      .doc(receiptId);
    const draftRef = this.db
      .collection(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION)
      .doc(receiptId);
    const caseRef = this.db
      .collection(LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION)
      .doc(receiptId);
    const orgRef = this.db
      .collection(LIBRARY_ORGANIZATIONS_COLLECTION)
      .doc(classification.organizationId);
    const sourceRef = this.db
      .collection(LIBRARY_SOURCES_COLLECTION)
      .doc(classification.sourceId);
    const docRef = this.db
      .collection(LIBRARY_DOCUMENTS_COLLECTION)
      .doc(documentId);
    const handoffRef = this.db
      .collection(LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION)
      .doc(receiptId);
    const eventRef = this.db
      .collection(LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION)
      .doc(receiptId);

    let writeStagedInAnyAttempt = false;

    try {
      const txResult =
        await this.db.runTransaction<CreateLibraryQuarantineCatalogDraftResponseDto>(
          async (tx: LibraryQuarantineReviewDraftFirestoreTransaction) => {
            // STEP 1: Execute all 8 point reads BEFORE any write.
            const receiptSnap = await tx.get(receiptRef);
            const draftSnap = await tx.get(draftRef);
            const caseSnap = await tx.get(caseRef);
            const orgSnap = await tx.get(orgRef);
            const sourceSnap = await tx.get(sourceRef);
            const docSnap = await tx.get(docRef);
            const handoffSnap = await tx.get(handoffRef);
            const eventSnap = await tx.get(eventRef);

            // STEP 2: Verify receipt and linked review draft integrity & eligibility.
            const eligibility = verifyReceiptAndDraftEligibleForHumanReviewCase(
              receiptId,
              receiptSnap,
              draftSnap
            );
            if (!eligibility.ok) {
              return makeCreateHoldDto(eligibility.reasonCode, receiptId);
            }

            const { receiptEnvelope, reviewDraft } = eligibility;
            const receipt = receiptEnvelope.receipt;

            // STEP 3: Verify human review case exists, is intact, and matches receipt/draft.
            if (!caseSnap.exists) {
              return makeCreateHoldDto(
                'HUMAN_REVIEW_CASE_NOT_FOUND',
                receiptId
              );
            }
            if (caseSnap.id !== receiptId) {
              return makeCreateHoldDto('DOCUMENT_ID_MISMATCH', receiptId);
            }

            const caseValidation =
              validatePersistedLibraryQuarantineHumanReviewCase(
                caseSnap.data(),
                receiptId
              );
            if (!caseValidation.ok) {
              return makeCreateHoldDto(
                'CORRUPTED_EXISTING_HUMAN_REVIEW_CASE',
                receiptId
              );
            }

            const reviewCase = caseValidation.reviewCase;
            if (
              reviewCase.sourceRevision !== receiptEnvelope.revision ||
              reviewCase.sourceUpdatedAt !== receipt.updatedAt ||
              reviewCase.sourceSha256 !== receipt.sha256 ||
              reviewCase.draftSourceRevision !== reviewDraft.sourceRevision
            ) {
              return makeCreateHoldDto(
                'CASE_SOURCE_STALE_OR_MISMATCHED',
                receiptId
              );
            }

            if (
              reviewCase.status !== 'METADATA_RECORDED' ||
              reviewCase.sourceEvidenceNotes.trim().length === 0 ||
              (reviewCase.titleAr.trim().length === 0 &&
                reviewCase.titleEn.trim().length === 0)
            ) {
              return makeCreateHoldDto('CASE_NOT_METADATA_RECORDED', receiptId);
            }

            // STEP 4: Verify organization and Verified source exist and match inside transaction.
            if (!orgSnap.exists) {
              return makeCreateHoldDto('ORGANIZATION_NOT_FOUND', receiptId);
            }
            const orgData = orgSnap.data();
            if (
              !isPlainRecord(orgData) ||
              orgSnap.id !== classification.organizationId ||
              (typeof orgData.id === 'string' &&
                orgData.id !== classification.organizationId) ||
              typeof orgData.nameAr !== 'string' ||
              orgData.nameAr.trim().length === 0 ||
              typeof orgData.nameEn !== 'string' ||
              orgData.nameEn.trim().length === 0
            ) {
              return makeCreateHoldDto('ORGANIZATION_NOT_FOUND', receiptId);
            }

            if (!sourceSnap.exists) {
              return makeCreateHoldDto('SOURCE_NOT_FOUND', receiptId);
            }
            const sourceData = sourceSnap.data();
            if (
              !isPlainRecord(sourceData) ||
              sourceSnap.id !== classification.sourceId ||
              (typeof sourceData.id === 'string' &&
                sourceData.id !== classification.sourceId)
            ) {
              return makeCreateHoldDto('SOURCE_NOT_FOUND', receiptId);
            }
            if (sourceData.organizationId !== classification.organizationId) {
              return makeCreateHoldDto(
                'SOURCE_ORGANIZATION_MISMATCH',
                receiptId
              );
            }
            if (sourceData.verificationStatus !== 'Verified') {
              return makeCreateHoldDto('SOURCE_NOT_VERIFIED', receiptId);
            }

            // STEP 5: Handle existing handoff / catalog document / audit event (idempotency vs conflict vs hold).
            if (docSnap.exists || handoffSnap.exists || eventSnap.exists) {
              if (!docSnap.exists || !handoffSnap.exists || !eventSnap.exists) {
                return makeCreateHoldDto(
                  'INCONSISTENT_EXISTING_HANDOFF_STATE',
                  receiptId
                );
              }
              if (
                docSnap.id !== documentId ||
                handoffSnap.id !== receiptId ||
                eventSnap.id !== receiptId
              ) {
                return makeCreateHoldDto('DOCUMENT_ID_MISMATCH', receiptId);
              }

              const existingHandoffCheck =
                validatePersistedLibraryQuarantineCatalogHandoff(
                  handoffSnap.data(),
                  receiptId
                );
              if (!existingHandoffCheck.ok) {
                return makeCreateHoldDto(
                  existingHandoffCheck.errorCode,
                  receiptId
                );
              }

              const existingEventCheck =
                validatePersistedLibraryQuarantineCatalogHandoffEvent(
                  eventSnap.data(),
                  receiptId
                );
              if (!existingEventCheck.ok) {
                return makeCreateHoldDto(
                  existingEventCheck.errorCode,
                  receiptId
                );
              }

              const existingDocCheck = validatePersistedCatalogDraftDocument(
                docSnap.data(),
                documentId
              );
              if (!existingDocCheck.ok) {
                return makeCreateHoldDto(
                  existingDocCheck.errorCode,
                  receiptId
                );
              }

              const existingHandoff = existingHandoffCheck.handoff;
              const existingDoc = existingDocCheck.catalogDocument;

              if (
                existingHandoff.sourceRevision !== receiptEnvelope.revision ||
                existingHandoff.sourceUpdatedAt !== receipt.updatedAt ||
                existingHandoff.sourceSha256 !== receipt.sha256 ||
                existingHandoff.draftSourceRevision !==
                  reviewDraft.sourceRevision
              ) {
                return makeCreateHoldDto('HANDOFF_SOURCE_MISMATCH', receiptId);
              }

              if (
                existingDoc.organizationId !== existingHandoff.organizationId ||
                existingDoc.sourceId !== existingHandoff.sourceId
              ) {
                return makeCreateHoldDto(
                  'INCONSISTENT_EXISTING_HANDOFF_STATE',
                  receiptId
                );
              }

              const sanitizedExistingHandoff =
                toSanitizedLibraryQuarantineCatalogHandoffDto(existingHandoff);

              if (expectedCaseRevision !== reviewCase.revision) {
                return Object.freeze({
                  ok: false as const,
                  status: 'CONFLICT' as const,
                  documentCreationOutcome: 'NOT_CREATED' as const,
                  documentCreated: false as const,
                  errorCode: 'CASE_REVISION_CONFLICT' as const,
                  errorMessage:
                    CATALOG_HANDOFF_SAFE_MESSAGES.CASE_REVISION_CONFLICT,
                  receiptId,
                  documentId,
                  currentCaseRevision: reviewCase.revision,
                  existingHandoff: sanitizedExistingHandoff,
                  catalogDocument: existingDoc,
                  isSanitized: false as const,
                  isVerifiedSafe: false as const,
                  isRightsApproved: false as const,
                  isPublished: false as const,
                  isReadyForPeia: false as const,
                });
              }

              if (
                existingHandoff.caseRevision === expectedCaseRevision &&
                existingHandoff.organizationId ===
                  classification.organizationId &&
                existingHandoff.sourceId === classification.sourceId
              ) {
                return Object.freeze({
                  ok: true as const,
                  status: 'HANDOFF_RECORDED' as const,
                  disposition: 'IDEMPOTENT_EXISTING' as const,
                  documentCreationOutcome: 'IDEMPOTENT_EXISTING' as const,
                  documentCreated: false as const,
                  receiptId,
                  documentId,
                  caseRevision: existingHandoff.caseRevision,
                  handoff: sanitizedExistingHandoff,
                  catalogDocument: existingDoc,
                  isSanitized: false as const,
                  isVerifiedSafe: false as const,
                  isRightsApproved: false as const,
                  isPublished: false as const,
                  isReadyForPeia: false as const,
                });
              }

              return Object.freeze({
                ok: false as const,
                status: 'CONFLICT' as const,
                documentCreationOutcome: 'NOT_CREATED' as const,
                documentCreated: false as const,
                errorCode: 'HANDOFF_ALREADY_EXISTS_CONFLICT' as const,
                errorMessage:
                  CATALOG_HANDOFF_SAFE_MESSAGES.HANDOFF_ALREADY_EXISTS_CONFLICT,
                receiptId,
                documentId,
                currentCaseRevision: reviewCase.revision,
                existingHandoff: sanitizedExistingHandoff,
                catalogDocument: existingDoc,
                isSanitized: false as const,
                isVerifiedSafe: false as const,
                isRightsApproved: false as const,
                isPublished: false as const,
                isReadyForPeia: false as const,
              });
            }

            // STEP 6: Compare-and-swap check on `expectedCaseRevision` before creating new records.
            if (expectedCaseRevision !== reviewCase.revision) {
              return Object.freeze({
                ok: false as const,
                status: 'CONFLICT' as const,
                documentCreationOutcome: 'NOT_CREATED' as const,
                documentCreated: false as const,
                errorCode: 'CASE_REVISION_CONFLICT' as const,
                errorMessage:
                  CATALOG_HANDOFF_SAFE_MESSAGES.CASE_REVISION_CONFLICT,
                receiptId,
                documentId,
                currentCaseRevision: reviewCase.revision,
                existingHandoff: null,
                catalogDocument: null,
                isSanitized: false as const,
                isVerifiedSafe: false as const,
                isRightsApproved: false as const,
                isPublished: false as const,
                isReadyForPeia: false as const,
              });
            }

            // STEP 7: Enforce monotonic timestamp against receipt, draft, and human review case.
            const nowMs = Date.parse(nowIso);
            const receiptUpdatedMs = Date.parse(receipt.updatedAt);
            const draftCreatedMs = Date.parse(reviewDraft.createdAt);
            const caseUpdatedMs = Date.parse(reviewCase.updatedAt);

            if (
              nowMs < receiptUpdatedMs ||
              nowMs < draftCreatedMs ||
              nowMs < caseUpdatedMs
            ) {
              return makeCreateHoldDto(
                'TIMESTAMP_BEFORE_SOURCE_OR_CASE',
                receiptId
              );
            }

            // STEP 8: Construct and validate the internal LibraryDocument draft (`qcat-<receiptId>`).
            const initialVersion: LibraryDocumentVersion = Object.freeze({
              id: `ver-${documentId}-1`,
              documentId,
              versionNumber: '1.0',
              publishedDate: classification.publicationDate,
              changeDescriptionAr:
                'إنشاء مسودة فهرس داخلية أولية من مراجعة الحجر الصحي (بدون ملف مرفق)',
              changeDescriptionEn:
                'Initial internal catalog draft created from quarantine human review (no attached file)',
            });

            const rightsNotesTrimmed = reviewCase.rightsEvidenceNotes.trim();

            const candidateDocument: LibraryDocument = Object.freeze({
              id: documentId,
              titleAr: classification.titleAr,
              titleEn: classification.titleEn,
              ...(classification.originalTitle !== undefined
                ? { originalTitle: classification.originalTitle }
                : {}),
              documentType: classification.documentType,
              organizationId: classification.organizationId,
              sourceId: classification.sourceId,
              geographyAr: classification.geographyAr,
              geographyEn: classification.geographyEn,
              publicationDate: classification.publicationDate,
              language: classification.language,
              summaryAr: classification.summaryAr,
              summaryEn: classification.summaryEn,
              topicsAr: [...classification.topicsAr],
              topicsEn: [...classification.topicsEn],
              environmentalDomains: [...classification.environmentalDomains],
              rightsStatus: LibraryRightsStatus.ReviewRequired,
              ...(rightsNotesTrimmed.length > 0
                ? {
                    rightsNotesAr: rightsNotesTrimmed,
                    rightsNotesEn: rightsNotesTrimmed,
                  }
                : {}),
              workflowState: WorkflowState.Draft,
              workflowHistory: [],
              legalStatusDescriptionAr: classification.legalStatusDescriptionAr,
              legalStatusDescriptionEn: classification.legalStatusDescriptionEn,
              createdAt: nowIso,
              updatedAt: nowIso,
              versions: [initialVersion],
            });

            const docValidation = validatePersistedCatalogDraftDocument(
              candidateDocument,
              documentId
            );
            if (!docValidation.ok) {
              return makeCreateHoldDto(
                'CATALOG_DOCUMENT_VALIDATION_FAILED',
                receiptId
              );
            }

            const candidateHandoff: LibraryQuarantinePersistedCatalogHandoff =
              Object.freeze({
                schemaVersion:
                  LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
                receiptId,
                documentId,
                sourceRevision: receiptEnvelope.revision,
                sourceUpdatedAt: receipt.updatedAt,
                sourceSha256: receipt.sha256,
                draftSourceRevision: reviewDraft.sourceRevision,
                caseRevision: reviewCase.revision,
                caseUpdatedAt: reviewCase.updatedAt,
                organizationId: classification.organizationId,
                sourceId: classification.sourceId,
                createdBy: authResult.actorUid,
                createdAt: nowIso,
                isSanitized: false as const,
                isVerifiedSafe: false as const,
                isRightsApproved: false as const,
                isPublished: false as const,
                isReadyForPeia: false as const,
              });

            const handoffCheck =
              validatePersistedLibraryQuarantineCatalogHandoff(
                candidateHandoff,
                receiptId
              );
            if (!handoffCheck.ok) {
              return makeCreateHoldDto(handoffCheck.errorCode, receiptId);
            }

            const candidateEvent: LibraryQuarantinePersistedCatalogHandoffEvent =
              Object.freeze({
                schemaVersion:
                  LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENT_SCHEMA_VERSION,
                eventId: receiptId,
                receiptId,
                documentId,
                eventType: 'CATALOG_DRAFT_CREATED' as const,
                sourceRevision: receiptEnvelope.revision,
                sourceUpdatedAt: receipt.updatedAt,
                sourceSha256: receipt.sha256,
                draftSourceRevision: reviewDraft.sourceRevision,
                caseRevision: reviewCase.revision,
                caseUpdatedAt: reviewCase.updatedAt,
                organizationId: classification.organizationId,
                sourceId: classification.sourceId,
                actorUid: authResult.actorUid,
                recordedAt: nowIso,
                isSanitized: false as const,
                isVerifiedSafe: false as const,
                isRightsApproved: false as const,
                isPublished: false as const,
                isReadyForPeia: false as const,
              });

            const eventCheck =
              validatePersistedLibraryQuarantineCatalogHandoffEvent(
                candidateEvent,
                receiptId
              );
            if (!eventCheck.ok) {
              return makeCreateHoldDto(eventCheck.errorCode, receiptId);
            }

            // STEP 9: Stage 3 create-only writes (`tx.create`). Never call `tx.set` or `tx.update`.
            this.assertAllowedWriteCollection(LIBRARY_DOCUMENTS_COLLECTION);
            this.assertAllowedWriteCollection(
              LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION
            );
            this.assertAllowedWriteCollection(
              LIBRARY_QUARANTINE_CATALOG_HANDOFF_EVENTS_COLLECTION
            );

            writeStagedInAnyAttempt = true;

            tx.create(docRef, toFirestoreDocumentData(candidateDocument));
            tx.create(
              handoffRef,
              toFirestoreDocumentData(handoffCheck.handoff)
            );
            tx.create(
              eventRef,
              toFirestoreDocumentData(eventCheck.handoffEvent)
            );

            return Object.freeze({
              ok: true as const,
              status: 'HANDOFF_RECORDED' as const,
              disposition: 'CREATED' as const,
              documentCreationOutcome: 'CREATED' as const,
              documentCreated: true as const,
              receiptId,
              documentId,
              caseRevision: reviewCase.revision,
              handoff: toSanitizedLibraryQuarantineCatalogHandoffDto(
                handoffCheck.handoff
              ),
              catalogDocument: docValidation.catalogDocument,
              isSanitized: false as const,
              isVerifiedSafe: false as const,
              isRightsApproved: false as const,
              isPublished: false as const,
              isReadyForPeia: false as const,
            });
          }
        );

      if (!txResult || typeof txResult !== 'object') {
        return writeStagedInAnyAttempt
          ? makeCreateUnknownDto(receiptId)
          : makeCreateHoldDto('TRANSACTION_ABORTED_NO_WRITE', receiptId);
      }

      return txResult;
    } catch {
      if (writeStagedInAnyAttempt) {
        return makeCreateUnknownDto(receiptId);
      }
      return makeCreateHoldDto('TRANSACTION_ABORTED_NO_WRITE', receiptId);
    }
  }
}
