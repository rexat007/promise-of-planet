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
} from '../shared/libraryContract';
import { WorkflowState } from '../shared/workflowContract';
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
} from './firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
  verifyReceiptAndDraftEligibleForHumanReviewCase,
  type LibraryQuarantineFirestoreDocumentData,
  type LibraryQuarantineHumanReviewCaseErrorCode,
} from './firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  SanitizedLibraryQuarantineHumanReviewCaseDto,
  toSanitizedLibraryQuarantineHumanReviewCaseDto,
  validatePersistedLibraryQuarantineHumanReviewCase,
  type LibraryQuarantinePersistedHumanReviewCase,
} from './libraryQuarantineHumanReviewCaseContract';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  deriveQuarantineCatalogDocumentId,
  toSanitizedLibraryQuarantineCatalogHandoffDto,
  validatePersistedCatalogDraftDocument,
  validatePersistedLibraryQuarantineCatalogHandoff,
  type LibraryQuarantinePersistedCatalogHandoff,
  type SanitizedLibraryQuarantineCatalogDocumentDto,
  type SanitizedLibraryQuarantineCatalogHandoffDto,
} from './libraryQuarantineCatalogHandoffService';
import {
  LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION,
} from './firestoreLibraryQuarantineRightsDecisionStore';
import {
  validatePersistedLibraryQuarantineRightsDecision,
  type LibraryQuarantinePersistedRightsDecision,
} from './libraryQuarantineRightsDecisionContract';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';
import type {
  TrustedQuarantineAuthenticatedPrincipal,
  TrustedQuarantineReviewerPrincipalProvider,
} from './libraryQuarantineReviewDraftPersistenceService';

export const LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION =
  'library_quarantine_catalog_case_alignments' as const;

export const LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION =
  'library_quarantine_catalog_case_alignment_events' as const;

export const LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL =
  'APPLY_CASE_METADATA' as const;

export const LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENT_REASON =
  'HUMAN_CASE_METADATA_REALIGNED' as const;

export type LibraryQuarantineCatalogCaseAlignmentState =
  | 'ALIGNED'
  | 'NEEDS_REALIGNMENT';

export type LibraryQuarantineCatalogCaseAlignmentOutcome =
  | 'ALIGNED'
  | 'ALREADY_ALIGNED'
  | 'NOT_ALIGNED'
  | 'UNKNOWN';

export type LibraryQuarantineCatalogCaseAlignmentErrorCode =
  | LibraryQuarantineHumanReviewCaseErrorCode
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED_ALIGNMENT_ACTOR'
  | 'INVALID_RECEIPT_ID'
  | 'INVALID_ALIGNMENT_PAYLOAD'
  | 'CONFIRMATION_REQUIRED'
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
  | 'CATALOG_DOCUMENT_VALIDATION_FAILED'
  | 'INVALID_PERSISTED_ALIGNMENT_SCHEMA'
  | 'ALIGNMENT_SOURCE_MISMATCH'
  | 'INCONSISTENT_ALIGNMENT_STATE'
  | 'INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA'
  | 'ALIGNMENT_REVISION_CONFLICT'
  | 'ALIGNMENT_EVENT_ALREADY_EXISTS'
  | 'SECURITY_POSTURE_VIOLATION'
  | 'TRANSACTION_ABORTED_NO_WRITE'
  | 'TRANSACTION_COMMIT_UNCERTAIN'
  | 'ALIGNMENT_PERSISTENCE_FAILED';

export interface LibraryQuarantinePersistedCatalogCaseAlignment {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly originalHandoffCaseRevision: number;
  readonly alignmentRevision: number;
  readonly alignedHumanCaseRevision: number;
  readonly alignedHumanCaseUpdatedAt: string;
  readonly documentUpdatedAt: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface SanitizedLibraryQuarantineCatalogCaseAlignmentDto {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly originalHandoffCaseRevision: number;
  readonly alignmentRevision: number;
  readonly alignedHumanCaseRevision: number;
  readonly alignedHumanCaseUpdatedAt: string;
  readonly documentUpdatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantinePersistedCatalogCaseAlignmentEvent {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly alignmentRevision: number;
  readonly previousAlignmentRevision: number;
  readonly reason: typeof LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENT_REASON;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly originalHandoffCaseRevision: number;
  readonly fromCaseRevision: number;
  readonly toCaseRevision: number;
  readonly fromCatalogUpdatedAt: string;
  readonly toCatalogUpdatedAt: string;
  readonly actorUid: string;
  readonly recordedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface LibraryQuarantineCatalogCaseFieldDiffDto {
  readonly caseValue: string;
  readonly catalogValue: string;
  readonly changed: boolean;
}

export interface LibraryQuarantineCatalogCaseFourFieldDiffDto {
  readonly hasAnyDifference: boolean;
  readonly fields: {
    readonly titleAr: LibraryQuarantineCatalogCaseFieldDiffDto;
    readonly titleEn: LibraryQuarantineCatalogCaseFieldDiffDto;
    readonly summaryAr: LibraryQuarantineCatalogCaseFieldDiffDto;
    readonly summaryEn: LibraryQuarantineCatalogCaseFieldDiffDto;
  };
}

export interface GetLibraryQuarantineCatalogCaseAlignmentSuccessDto {
  readonly ok: true;
  readonly status: 'READY';
  readonly receiptId: string;
  readonly documentId: string;
  readonly alignmentState: LibraryQuarantineCatalogCaseAlignmentState;
  readonly sourceRevision: number;
  readonly originalHandoffCaseRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly currentAlignmentRevision: number;
  readonly catalogUpdatedAt: string;
  readonly diff: LibraryQuarantineCatalogCaseFourFieldDiffDto;
  readonly alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly humanReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto;
  readonly hasRecordedRightsDecision: boolean;
  readonly recordedRightsDecisionCaseRevision: number | null;
  readonly rightsDecisionInvalidatedByCaseChange: boolean;
  readonly requiresFreshRightsReview: boolean;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface GetLibraryQuarantineCatalogCaseAlignmentHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly errorCode: LibraryQuarantineCatalogCaseAlignmentErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type GetLibraryQuarantineCatalogCaseAlignmentResponseDto =
  | GetLibraryQuarantineCatalogCaseAlignmentSuccessDto
  | GetLibraryQuarantineCatalogCaseAlignmentHoldDto;

export interface AlignLibraryQuarantineCatalogCaseSuccessDto {
  readonly ok: true;
  readonly status: 'ALIGNED' | 'ALREADY_ALIGNED';
  readonly alignmentOutcome: 'ALIGNED' | 'ALREADY_ALIGNED';
  readonly alignmentSaved: boolean;
  readonly receiptId: string;
  readonly documentId: string;
  readonly alignmentState: 'ALIGNED';
  readonly sourceRevision: number;
  readonly originalHandoffCaseRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly currentAlignmentRevision: number;
  readonly catalogUpdatedAt: string;
  readonly diff: LibraryQuarantineCatalogCaseFourFieldDiffDto;
  readonly alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly humanReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto;
  readonly hasRecordedRightsDecision: boolean;
  readonly recordedRightsDecisionCaseRevision: number | null;
  readonly rightsDecisionInvalidatedByCaseChange: boolean;
  readonly requiresFreshRightsReview: boolean;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface AlignLibraryQuarantineCatalogCaseConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly alignmentOutcome: 'NOT_ALIGNED';
  readonly alignmentSaved: false;
  readonly errorCode: 'ALIGNMENT_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentHumanCaseRevision: number;
  readonly currentCatalogUpdatedAt: string;
  readonly currentAlignmentRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly diff: LibraryQuarantineCatalogCaseFourFieldDiffDto;
  readonly alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly humanReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface AlignLibraryQuarantineCatalogCaseHoldDto {
  readonly ok: false;
  readonly status: 'HOLD';
  readonly alignmentOutcome: 'NOT_ALIGNED';
  readonly alignmentSaved: false;
  readonly errorCode: LibraryQuarantineCatalogCaseAlignmentErrorCode;
  readonly errorMessage: string;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export interface AlignLibraryQuarantineCatalogCaseUnknownDto {
  readonly ok: false;
  readonly status: 'UNKNOWN';
  readonly alignmentOutcome: 'UNKNOWN';
  readonly alignmentSaved: null;
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

export type AlignLibraryQuarantineCatalogCaseResponseDto =
  | AlignLibraryQuarantineCatalogCaseSuccessDto
  | AlignLibraryQuarantineCatalogCaseConflictDto
  | AlignLibraryQuarantineCatalogCaseHoldDto
  | AlignLibraryQuarantineCatalogCaseUnknownDto;

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

const FORBIDDEN_TEXT_TOKEN_REGEX =
  /(?:https?:\/\/|gs:\/\/|file:\/\/|data:|blob:|javascript:|library\/quarantine\/|library_quarantine_|storagePath|sourceSha256|sha256|<script|<\/script|<iframe|<object|<embed)/i;

const BIDI_OR_CONTROL_CHAR_REGEX =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const PERSISTED_ALIGNMENT_ALLOWED_KEYS = new Set<string>([
  'schemaVersion',
  'receiptId',
  'documentId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'originalHandoffCaseRevision',
  'alignmentRevision',
  'alignedHumanCaseRevision',
  'alignedHumanCaseUpdatedAt',
  'documentUpdatedAt',
  'createdBy',
  'createdAt',
  'updatedBy',
  'updatedAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const PERSISTED_ALIGNMENT_EVENT_ALLOWED_KEYS = new Set<string>([
  'schemaVersion',
  'eventId',
  'receiptId',
  'documentId',
  'alignmentRevision',
  'previousAlignmentRevision',
  'reason',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'originalHandoffCaseRevision',
  'fromCaseRevision',
  'toCaseRevision',
  'fromCatalogUpdatedAt',
  'toCatalogUpdatedAt',
  'actorUid',
  'recordedAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_GET_INPUT_KEYS = new Set<string>(['receiptId']);

const ALLOWED_ALIGN_INPUT_KEYS = new Set<string>([
  'receiptId',
  'expectedCaseRevision',
  'expectedCatalogUpdatedAt',
  'expectedAlignmentRevision',
  'confirmation',
]);

const ALLOWED_PRINCIPAL_KEYS = new Set<string>(['uid', 'token']);

const FORBIDDEN_TOKEN_OVERRIDE_KEYS = new Set<string>([
  'permissions',
  'domains',
  'isRightsApproved',
  'isPublished',
  'isSanitized',
  'isVerifiedSafe',
  'isReadyForPeia',
  'rightsScope',
]);

const ALLOWED_ALIGNMENT_WRITE_COLLECTIONS = new Set<string>([
  LIBRARY_DOCUMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION,
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOnlyAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): boolean {
  if (Object.getOwnPropertySymbols(record).length > 0) {
    return false;
  }
  const keys = Object.keys(record);
  return keys.every((key) => allowedKeys.has(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSafeEditorialText(
  value: unknown,
  maxLength: number,
  allowNewlines: boolean
): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return false;
  }
  if (!allowNewlines && /[\r\n]/.test(trimmed)) {
    return false;
  }
  if (BIDI_OR_CONTROL_CHAR_REGEX.test(trimmed)) {
    return false;
  }
  if (FORBIDDEN_TEXT_TOKEN_REGEX.test(trimmed)) {
    return false;
  }
  if (/[<>]/.test(trimmed)) {
    return false;
  }
  return true;
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

export function deriveLibraryQuarantineCatalogCaseAlignmentEventId(
  receiptId: string,
  alignmentRevision: number
): string {
  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    throw new Error('INVALID_RECEIPT_ID');
  }
  if (!isPositiveSafeInteger(alignmentRevision)) {
    throw new Error('INVALID_ALIGNMENT_REVISION');
  }
  return `${receiptId}_${alignmentRevision}`;
}

/**
 * Verifies that the authenticated caller is an active human Library administrator
 * who possesses Library domain responsibility AND both `AdminPermission.Review`
 * and `AdminPermission.Create`.
 */
export function isAuthorizedHumanLibraryCaseAlignmentActor(
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
  if (!hasDomainResponsibility(user.role, AdminDomain.Library)) {
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

export function computeLibraryQuarantineCatalogCaseFourFieldDiff(
  humanCase: Pick<
    LibraryQuarantinePersistedHumanReviewCase,
    'titleAr' | 'titleEn' | 'summaryAr' | 'summaryEn'
  >,
  catalogDoc: Pick<
    LibraryDocument,
    'titleAr' | 'titleEn' | 'summaryAr' | 'summaryEn'
  >
): LibraryQuarantineCatalogCaseFourFieldDiffDto {
  const caseTitleAr = humanCase.titleAr.trim();
  const catalogTitleAr = catalogDoc.titleAr.trim();
  const titleArChanged = caseTitleAr !== catalogTitleAr;

  const caseTitleEn = humanCase.titleEn.trim();
  const catalogTitleEn = catalogDoc.titleEn.trim();
  const titleEnChanged = caseTitleEn !== catalogTitleEn;

  const caseSummaryAr = humanCase.summaryAr.trim();
  const catalogSummaryAr = catalogDoc.summaryAr.trim();
  const summaryArChanged = caseSummaryAr !== catalogSummaryAr;

  const caseSummaryEn = humanCase.summaryEn.trim();
  const catalogSummaryEn = catalogDoc.summaryEn.trim();
  const summaryEnChanged = caseSummaryEn !== catalogSummaryEn;

  const hasAnyDifference =
    titleArChanged || titleEnChanged || summaryArChanged || summaryEnChanged;

  return Object.freeze({
    hasAnyDifference,
    fields: Object.freeze({
      titleAr: Object.freeze({
        caseValue: caseTitleAr,
        catalogValue: catalogTitleAr,
        changed: titleArChanged,
      }),
      titleEn: Object.freeze({
        caseValue: caseTitleEn,
        catalogValue: catalogTitleEn,
        changed: titleEnChanged,
      }),
      summaryAr: Object.freeze({
        caseValue: caseSummaryAr,
        catalogValue: catalogSummaryAr,
        changed: summaryArChanged,
      }),
      summaryEn: Object.freeze({
        caseValue: caseSummaryEn,
        catalogValue: catalogSummaryEn,
        changed: summaryEnChanged,
      }),
    }),
  });
}

export function validatePersistedLibraryQuarantineCatalogCaseAlignment(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly alignment: LibraryQuarantinePersistedCatalogCaseAlignment;
    }
  | {
      readonly ok: false;
      readonly errorCode: LibraryQuarantineCatalogCaseAlignmentErrorCode;
      readonly errorMessage: string;
    } {
  if (
    !isPlainRecord(raw) ||
    !hasOnlyAllowedKeys(raw, PERSISTED_ALIGNMENT_ALLOWED_KEYS) ||
    Object.keys(raw).length !== PERSISTED_ALIGNMENT_ALLOWED_KEYS.size
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted quarantine catalog case alignment does not match the strict 20-key schema.',
    };
  }

  if (
    raw.schemaVersion !== LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage: 'Unsupported quarantine catalog case alignment schemaVersion.',
    };
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage: 'Invalid receiptId on persisted catalog case alignment.',
    };
  }

  if (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId) {
    return {
      ok: false,
      errorCode: 'ALIGNMENT_SOURCE_MISMATCH',
      errorMessage:
        'Persisted catalog case alignment receiptId does not match expected receiptId.',
    };
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentId(raw.receiptId);
  if (raw.documentId !== expectedDocumentId) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted catalog case alignment documentId does not match deterministic qcat-<receiptId>.',
    };
  }

  if (
    !isPositiveSafeInteger(raw.sourceRevision) ||
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_HEX_REGEX.test(raw.sourceSha256)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted catalog case alignment source provenance fields are invalid.',
    };
  }

  if (
    !isPositiveSafeInteger(raw.originalHandoffCaseRevision) ||
    !isPositiveSafeInteger(raw.alignmentRevision) ||
    !isPositiveSafeInteger(raw.alignedHumanCaseRevision) ||
    raw.alignedHumanCaseRevision < raw.originalHandoffCaseRevision ||
    typeof raw.alignedHumanCaseUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.alignedHumanCaseUpdatedAt) ||
    typeof raw.documentUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.documentUpdatedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted catalog case alignment revision or timestamp fields are invalid.',
    };
  }

  if (
    typeof raw.createdBy !== 'string' ||
    raw.createdBy.trim() !== raw.createdBy ||
    !isValidUploaderUid(raw.createdBy) ||
    typeof raw.updatedBy !== 'string' ||
    raw.updatedBy.trim() !== raw.updatedBy ||
    !isValidUploaderUid(raw.updatedBy) ||
    typeof raw.createdAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.createdAt) ||
    typeof raw.updatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.updatedAt) ||
    Date.parse(raw.updatedAt) < Date.parse(raw.createdAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted catalog case alignment actor or audit timestamp fields are invalid.',
    };
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false
  ) {
    return {
      ok: false,
      errorCode: 'SECURITY_POSTURE_VIOLATION',
      errorMessage:
        'Persisted catalog case alignment contains a non-false security posture flag.',
    };
  }

  return {
    ok: true,
    alignment: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
      receiptId: raw.receiptId,
      documentId: raw.documentId,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
      originalHandoffCaseRevision: raw.originalHandoffCaseRevision,
      alignmentRevision: raw.alignmentRevision,
      alignedHumanCaseRevision: raw.alignedHumanCaseRevision,
      alignedHumanCaseUpdatedAt: raw.alignedHumanCaseUpdatedAt,
      documentUpdatedAt: raw.documentUpdatedAt,
      createdBy: raw.createdBy,
      createdAt: raw.createdAt,
      updatedBy: raw.updatedBy,
      updatedAt: raw.updatedAt,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    }),
  };
}

export function toSanitizedLibraryQuarantineCatalogCaseAlignmentDto(
  persisted: LibraryQuarantinePersistedCatalogCaseAlignment
): SanitizedLibraryQuarantineCatalogCaseAlignmentDto {
  const validated = validatePersistedLibraryQuarantineCatalogCaseAlignment(
    persisted,
    persisted.receiptId
  );
  if (!validated.ok) {
    throw new Error(validated.errorCode);
  }
  const a = validated.alignment;
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
    receiptId: a.receiptId,
    documentId: a.documentId,
    sourceRevision: a.sourceRevision,
    sourceUpdatedAt: a.sourceUpdatedAt,
    originalHandoffCaseRevision: a.originalHandoffCaseRevision,
    alignmentRevision: a.alignmentRevision,
    alignedHumanCaseRevision: a.alignedHumanCaseRevision,
    alignedHumanCaseUpdatedAt: a.alignedHumanCaseUpdatedAt,
    documentUpdatedAt: a.documentUpdatedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });
}

export function validatePersistedLibraryQuarantineCatalogCaseAlignmentEvent(
  raw: unknown,
  expectedReceiptId?: string,
  expectedAlignmentRevision?: number
):
  | {
      readonly ok: true;
      readonly alignmentEvent: LibraryQuarantinePersistedCatalogCaseAlignmentEvent;
    }
  | {
      readonly ok: false;
      readonly errorCode: LibraryQuarantineCatalogCaseAlignmentErrorCode;
      readonly errorMessage: string;
    } {
  if (
    !isPlainRecord(raw) ||
    !hasOnlyAllowedKeys(raw, PERSISTED_ALIGNMENT_EVENT_ALLOWED_KEYS) ||
    Object.keys(raw).length !== PERSISTED_ALIGNMENT_EVENT_ALLOWED_KEYS.size
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted quarantine catalog case alignment event does not match the strict 22-key schema.',
    };
  }

  if (
    raw.schemaVersion !== LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION ||
    raw.reason !== LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENT_REASON
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted catalog case alignment event has invalid schemaVersion or reason.',
    };
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage: 'Invalid receiptId on persisted catalog case alignment event.',
    };
  }

  if (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId) {
    return {
      ok: false,
      errorCode: 'ALIGNMENT_SOURCE_MISMATCH',
      errorMessage:
        'Persisted catalog case alignment event receiptId does not match expected receiptId.',
    };
  }

  if (
    !isPositiveSafeInteger(raw.alignmentRevision) ||
    !isNonNegativeSafeInteger(raw.previousAlignmentRevision) ||
    raw.previousAlignmentRevision !== raw.alignmentRevision - 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted catalog case alignment event revision progression is invalid.',
    };
  }

  if (
    expectedAlignmentRevision !== undefined &&
    raw.alignmentRevision !== expectedAlignmentRevision
  ) {
    return {
      ok: false,
      errorCode: 'ALIGNMENT_SOURCE_MISMATCH',
      errorMessage:
        'Persisted catalog case alignment event revision does not match expected revision.',
    };
  }

  const expectedEventId = deriveLibraryQuarantineCatalogCaseAlignmentEventId(
    raw.receiptId,
    raw.alignmentRevision
  );
  const expectedDocumentId = deriveQuarantineCatalogDocumentId(raw.receiptId);
  if (raw.eventId !== expectedEventId || raw.documentId !== expectedDocumentId) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted catalog case alignment eventId or documentId is invalid.',
    };
  }

  if (
    !isPositiveSafeInteger(raw.sourceRevision) ||
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_HEX_REGEX.test(raw.sourceSha256) ||
    !isPositiveSafeInteger(raw.originalHandoffCaseRevision) ||
    !isPositiveSafeInteger(raw.fromCaseRevision) ||
    !isPositiveSafeInteger(raw.toCaseRevision) ||
    raw.fromCaseRevision < raw.originalHandoffCaseRevision ||
    raw.toCaseRevision < raw.fromCaseRevision ||
    typeof raw.fromCatalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.fromCatalogUpdatedAt) ||
    typeof raw.toCatalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.toCatalogUpdatedAt) ||
    typeof raw.actorUid !== 'string' ||
    raw.actorUid.trim() !== raw.actorUid ||
    !isValidUploaderUid(raw.actorUid) ||
    typeof raw.recordedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.recordedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_ALIGNMENT_SCHEMA',
      errorMessage:
        'Persisted catalog case alignment event provenance or revision fields are invalid.',
    };
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false
  ) {
    return {
      ok: false,
      errorCode: 'SECURITY_POSTURE_VIOLATION',
      errorMessage:
        'Persisted catalog case alignment event contains a non-false security posture flag.',
    };
  }

  return {
    ok: true,
    alignmentEvent: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
      eventId: raw.eventId,
      receiptId: raw.receiptId,
      documentId: raw.documentId,
      alignmentRevision: raw.alignmentRevision,
      previousAlignmentRevision: raw.previousAlignmentRevision,
      reason: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENT_REASON,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
      originalHandoffCaseRevision: raw.originalHandoffCaseRevision,
      fromCaseRevision: raw.fromCaseRevision,
      toCaseRevision: raw.toCaseRevision,
      fromCatalogUpdatedAt: raw.fromCatalogUpdatedAt,
      toCatalogUpdatedAt: raw.toCatalogUpdatedAt,
      actorUid: raw.actorUid,
      recordedAt: raw.recordedAt,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    }),
  };
}

export function validateAlignmentAwarePersistedRightsDecision(
  raw: unknown,
  expectedReceiptId?: string
): ReturnType<typeof validatePersistedLibraryQuarantineRightsDecision> {
  if (!isPlainRecord(raw)) {
    return validatePersistedLibraryQuarantineRightsDecision(raw, expectedReceiptId);
  }
  const handoffRev = raw.catalogHandoffCaseRevision;
  const currentCaseRev = raw.currentHumanCaseRevision;
  if (
    !isPositiveSafeInteger(handoffRev) ||
    !isPositiveSafeInteger(currentCaseRev) ||
    currentCaseRev < handoffRev
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA',
      errorMessage: 'Persisted rights decision schema version or metadata alignment revision is invalid.',
    };
  }
  const normalizedForBaseContract: Record<string, unknown> = {
    ...raw,
    currentHumanCaseRevision: handoffRev,
  };
  const baseResult = validatePersistedLibraryQuarantineRightsDecision(
    normalizedForBaseContract,
    expectedReceiptId
  );
  if (!baseResult.ok) {
    return baseResult;
  }
  const hydrated: LibraryQuarantinePersistedRightsDecision = Object.freeze({
    ...baseResult.rightsDecision,
    currentHumanCaseRevision: currentCaseRev,
  });
  return {
    ok: true,
    rightsDecision: hydrated,
  };
}

interface VerifiedAlignmentChainSnapshot {
  readonly receiptEnvelope: LibraryQuarantinePersistedReceiptEnvelope;
  readonly reviewDraft: LibraryQuarantinePersistedReviewDraft;
  readonly humanReviewCase: LibraryQuarantinePersistedHumanReviewCase;
  readonly catalogHandoff: LibraryQuarantinePersistedCatalogHandoff;
  readonly rawCatalogDocument: LibraryDocument;
  readonly sanitizedCatalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
  readonly alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null;
  readonly currentAlignmentRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly effectiveAlignedCaseUpdatedAt: string;
  readonly alignmentState: LibraryQuarantineCatalogCaseAlignmentState;
  readonly diff: LibraryQuarantineCatalogCaseFourFieldDiffDto;
  readonly hasRecordedRightsDecision: boolean;
  readonly recordedRightsDecisionCaseRevision: number | null;
  readonly rightsDecisionInvalidatedByCaseChange: boolean;
  readonly requiresFreshRightsReview: boolean;
}

function verifyAlignmentChainSnapshots(
  expectedReceiptId: string,
  receiptSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  draftSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  caseSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  handoffSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  docSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  alignmentSnap: LibraryQuarantineFirestoreDocumentSnapshot,
  rightsDecisionSnap: LibraryQuarantineFirestoreDocumentSnapshot
):
  | { readonly ok: true; readonly snapshot: VerifiedAlignmentChainSnapshot }
  | {
      readonly ok: false;
      readonly errorCode: LibraryQuarantineCatalogCaseAlignmentErrorCode;
      readonly errorMessage: string;
    } {
  const sourceVerification = verifyReceiptAndDraftEligibleForHumanReviewCase(
    expectedReceiptId,
    receiptSnap,
    draftSnap
  );
  if (!sourceVerification.ok) {
    return {
      ok: false,
      errorCode: sourceVerification.reasonCode,
      errorMessage:
        'Source quarantine receipt or review draft is not eligible for catalog case alignment.',
    };
  }
  const { receiptEnvelope, reviewDraft } = sourceVerification;
  const receipt = receiptEnvelope.receipt;

  if (!caseSnap.exists) {
    return {
      ok: false,
      errorCode: 'HUMAN_REVIEW_CASE_NOT_FOUND',
      errorMessage: 'Saved human review case does not exist.',
    };
  }
  const caseValidation = validatePersistedLibraryQuarantineHumanReviewCase(
    caseSnap.data(),
    expectedReceiptId
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
      errorMessage:
        'Saved human review case provenance does not match quarantine source.',
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
        'Human review case must be in METADATA_RECORDED status for catalog case alignment.',
    };
  }

  if (!handoffSnap.exists) {
    return {
      ok: false,
      errorCode: 'CATALOG_HANDOFF_NOT_CREATED',
      errorMessage: 'Quarantine catalog handoff record does not exist yet.',
    };
  }
  const handoffValidation = validatePersistedLibraryQuarantineCatalogHandoff(
    handoffSnap.data(),
    expectedReceiptId
  );
  if (!handoffValidation.ok) {
    return {
      ok: false,
      errorCode:
        handoffValidation.errorCode === 'SECURITY_POSTURE_VIOLATION'
          ? 'SECURITY_POSTURE_VIOLATION'
          : 'INVALID_PERSISTED_HANDOFF_SCHEMA',
      errorMessage:
        'Persisted quarantine catalog handoff record failed schema validation.',
    };
  }
  const catalogHandoff = handoffValidation.handoff;

  const expectedDocumentId = deriveQuarantineCatalogDocumentId(expectedReceiptId);
  if (
    catalogHandoff.documentId !== expectedDocumentId ||
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

  if (
    humanReviewCase.revision < catalogHandoff.caseRevision ||
    Date.parse(humanReviewCase.updatedAt) < Date.parse(catalogHandoff.caseUpdatedAt)
  ) {
    return {
      ok: false,
      errorCode: 'ALIGNMENT_SOURCE_MISMATCH',
      errorMessage:
        'Human review case revision is older than original catalog handoff provenance.',
    };
  }

  if (!docSnap.exists) {
    return {
      ok: false,
      errorCode: 'CATALOG_DOCUMENT_MISSING',
      errorMessage:
        'Internal qcat-<receiptId> catalog document is missing for existing handoff.',
    };
  }
  const rawDocData = docSnap.data();
  const docValidation = validatePersistedCatalogDraftDocument(
    rawDocData,
    expectedDocumentId
  );
  if (!docValidation.ok) {
    return {
      ok: false,
      errorCode:
        docValidation.errorCode === 'SECURITY_POSTURE_VIOLATION'
          ? 'SECURITY_POSTURE_VIOLATION'
          : 'INVALID_CATALOG_DOCUMENT_STATE',
      errorMessage:
        'Internal qcat-<receiptId> catalog document failed validation.',
    };
  }
  const rawCatalogDocument = rawDocData as unknown as LibraryDocument;
  const sanitizedCatalogDocument = docValidation.catalogDocument;

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
        'Catalog document organization, source, or timestamps are inconsistent with original catalog handoff.',
    };
  }

  const diff = computeLibraryQuarantineCatalogCaseFourFieldDiff(
    humanReviewCase,
    rawCatalogDocument
  );

  let alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null = null;
  let currentAlignmentRevision = 0;
  let effectiveAlignedCaseRevision = catalogHandoff.caseRevision;
  let effectiveAlignedCaseUpdatedAt = catalogHandoff.caseUpdatedAt;

  if (alignmentSnap.exists) {
    const alignmentCheck = validatePersistedLibraryQuarantineCatalogCaseAlignment(
      alignmentSnap.data(),
      expectedReceiptId
    );
    if (!alignmentCheck.ok) {
      return alignmentCheck;
    }
    alignment = alignmentCheck.alignment;

    if (
      alignment.documentId !== expectedDocumentId ||
      alignment.sourceRevision !== receiptEnvelope.revision ||
      alignment.sourceUpdatedAt !== receipt.updatedAt ||
      alignment.sourceSha256 !== receipt.sha256 ||
      alignment.originalHandoffCaseRevision !== catalogHandoff.caseRevision ||
      alignment.alignedHumanCaseRevision < catalogHandoff.caseRevision ||
      Date.parse(alignment.alignedHumanCaseUpdatedAt) <
        Date.parse(catalogHandoff.caseUpdatedAt)
    ) {
      return {
        ok: false,
        errorCode: 'ALIGNMENT_SOURCE_MISMATCH',
        errorMessage:
          'Persisted catalog case alignment provenance does not match quarantine source or handoff.',
      };
    }

    if (alignment.documentUpdatedAt !== sanitizedCatalogDocument.updatedAt) {
      return {
        ok: false,
        errorCode: 'INCONSISTENT_ALIGNMENT_STATE',
        errorMessage:
          'Persisted catalog case alignment documentUpdatedAt does not match current qcat catalog document updatedAt.',
      };
    }

    currentAlignmentRevision = alignment.alignmentRevision;
    effectiveAlignedCaseRevision = alignment.alignedHumanCaseRevision;
    effectiveAlignedCaseUpdatedAt = alignment.alignedHumanCaseUpdatedAt;
  } else {
    if (sanitizedCatalogDocument.updatedAt !== catalogHandoff.createdAt) {
      return {
        ok: false,
        errorCode: 'INCONSISTENT_ALIGNMENT_STATE',
        errorMessage:
          'Catalog document was modified without a corresponding catalog case alignment overlay.',
      };
    }
  }

  if (
    humanReviewCase.revision < effectiveAlignedCaseRevision ||
    Date.parse(humanReviewCase.updatedAt) < Date.parse(effectiveAlignedCaseUpdatedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INCONSISTENT_ALIGNMENT_STATE',
      errorMessage:
        'Human review case revision is older than the effective aligned catalog case revision.',
    };
  }

  let alignmentState: LibraryQuarantineCatalogCaseAlignmentState;
  if (humanReviewCase.revision === effectiveAlignedCaseRevision) {
    if (
      humanReviewCase.updatedAt !== effectiveAlignedCaseUpdatedAt ||
      diff.hasAnyDifference
    ) {
      return {
        ok: false,
        errorCode: 'INCONSISTENT_ALIGNMENT_STATE',
        errorMessage:
          'Catalog document text or timestamp diverges from human review case at identical revision.',
      };
    }
    alignmentState = 'ALIGNED';
  } else {
    alignmentState = 'NEEDS_REALIGNMENT';
  }

  let hasRecordedRightsDecision = false;
  let recordedRightsDecisionCaseRevision: number | null = null;
  let rightsDecisionInvalidatedByCaseChange = false;
  let requiresFreshRightsReview = true;

  if (rightsDecisionSnap.exists) {
    const rightsValidation = validateAlignmentAwarePersistedRightsDecision(
      rightsDecisionSnap.data(),
      expectedReceiptId
    );
    if (!rightsValidation.ok) {
      return {
        ok: false,
        errorCode:
          rightsValidation.errorCode === 'SECURITY_POSTURE_VIOLATION'
            ? 'SECURITY_POSTURE_VIOLATION'
            : 'INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA',
        errorMessage:
          'Persisted rights decision record failed schema validation.',
      };
    }
    const rightsDecision = rightsValidation.rightsDecision;
    if (
      rightsDecision.documentId !== expectedDocumentId ||
      rightsDecision.sourceRevision !== receiptEnvelope.revision ||
      rightsDecision.sourceUpdatedAt !== receipt.updatedAt ||
      rightsDecision.sourceSha256 !== receipt.sha256 ||
      rightsDecision.draftSourceRevision !== reviewDraft.sourceRevision ||
      rightsDecision.catalogHandoffCaseRevision !== catalogHandoff.caseRevision ||
      rightsDecision.currentHumanCaseRevision > effectiveAlignedCaseRevision ||
      rightsDecision.currentHumanCaseRevision > humanReviewCase.revision
    ) {
      return {
        ok: false,
        errorCode: 'ALIGNMENT_SOURCE_MISMATCH',
        errorMessage:
          'Persisted rights decision provenance is inconsistent with catalog handoff or alignment chain.',
      };
    }

    hasRecordedRightsDecision = true;
    recordedRightsDecisionCaseRevision = rightsDecision.currentHumanCaseRevision;

    if (rightsDecision.currentHumanCaseRevision < humanReviewCase.revision) {
      rightsDecisionInvalidatedByCaseChange = true;
      requiresFreshRightsReview = true;
    } else if (alignmentState === 'ALIGNED') {
      rightsDecisionInvalidatedByCaseChange = false;
      requiresFreshRightsReview = false;
    } else {
      rightsDecisionInvalidatedByCaseChange = true;
      requiresFreshRightsReview = true;
    }
  }

  return {
    ok: true,
    snapshot: Object.freeze({
      receiptEnvelope,
      reviewDraft,
      humanReviewCase,
      catalogHandoff,
      rawCatalogDocument,
      sanitizedCatalogDocument,
      alignment,
      currentAlignmentRevision,
      effectiveAlignedCaseRevision,
      effectiveAlignedCaseUpdatedAt,
      alignmentState,
      diff,
      hasRecordedRightsDecision,
      recordedRightsDecisionCaseRevision,
      rightsDecisionInvalidatedByCaseChange,
      requiresFreshRightsReview,
    }),
  };
}

class PreWriteAlignmentHoldError extends Error {
  constructor(
    public readonly errorCode: LibraryQuarantineCatalogCaseAlignmentErrorCode,
    public readonly errorMessage: string
  ) {
    super(`${errorCode}: ${errorMessage}`);
    this.name = 'PreWriteAlignmentHoldError';
  }
}

class PreWriteAlignmentConflictError extends Error {
  constructor(
    public readonly currentHumanCaseRevision: number,
    public readonly currentCatalogUpdatedAt: string,
    public readonly currentAlignmentRevision: number,
    public readonly effectiveAlignedCaseRevision: number,
    public readonly diff: LibraryQuarantineCatalogCaseFourFieldDiffDto,
    public readonly alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null,
    public readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto,
    public readonly humanReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto
  ) {
    super('ALIGNMENT_REVISION_CONFLICT');
    this.name = 'PreWriteAlignmentConflictError';
  }
}

function makeGetHoldDto(
  receiptId: string | null,
  errorCode: LibraryQuarantineCatalogCaseAlignmentErrorCode,
  errorMessage: string
): GetLibraryQuarantineCatalogCaseAlignmentHoldDto {
  const validReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;
  const documentId = validReceiptId
    ? deriveQuarantineCatalogDocumentId(validReceiptId)
    : null;
  return Object.freeze({
    ok: false,
    status: 'HOLD',
    errorCode,
    errorMessage,
    receiptId: validReceiptId,
    documentId,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });
}

function makeAlignHoldDto(
  receiptId: string | null,
  errorCode: LibraryQuarantineCatalogCaseAlignmentErrorCode,
  errorMessage: string
): AlignLibraryQuarantineCatalogCaseHoldDto {
  const validReceiptId =
    typeof receiptId === 'string' && isValidLibraryQuarantineReceiptId(receiptId)
      ? receiptId
      : null;
  const documentId = validReceiptId
    ? deriveQuarantineCatalogDocumentId(validReceiptId)
    : null;
  return Object.freeze({
    ok: false,
    status: 'HOLD',
    alignmentOutcome: 'NOT_ALIGNED',
    alignmentSaved: false,
    errorCode,
    errorMessage,
    receiptId: validReceiptId,
    documentId,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });
}

function makeAlignUnknownDto(
  receiptId: string
): AlignLibraryQuarantineCatalogCaseUnknownDto {
  const documentId = deriveQuarantineCatalogDocumentId(receiptId);
  return Object.freeze({
    ok: false,
    status: 'UNKNOWN',
    alignmentOutcome: 'UNKNOWN',
    alignmentSaved: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
    errorMessage:
      'Transaction commit outcome is uncertain after staging catalog case alignment writes; verify current alignment state before retrying.',
    receiptId,
    documentId,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
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

export interface LibraryQuarantineCatalogCaseAlignmentServiceDependencies {
  readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  readonly clock?: () => string;
}

export class LibraryQuarantineCatalogCaseAlignmentService {
  private readonly trustedPrincipalProvider: TrustedQuarantineReviewerPrincipalProvider;
  private readonly adminRepository: Pick<AdminRepository, 'getAdminByUid'>;
  private readonly db: LibraryQuarantineReviewDraftFirestoreDatabase;
  private readonly clock: () => string;

  constructor(deps: LibraryQuarantineCatalogCaseAlignmentServiceDependencies) {
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
        'LibraryQuarantineCatalogCaseAlignmentService requires trustedPrincipalProvider, adminRepository, and db.'
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
    if (!ALLOWED_ALIGNMENT_WRITE_COLLECTIONS.has(collectionName)) {
      throw new Error(
        `FORBIDDEN_COLLECTION_WRITE: Attempted to write to collection "${collectionName}".`
      );
    }
  }

  private async resolveAuthorizedActor(): Promise<
    | { readonly ok: true; readonly actorUid: string; readonly admin: AdminUser }
    | {
        readonly ok: false;
        readonly errorCode:
          | 'UNAUTHENTICATED'
          | 'UNAUTHORIZED_ALIGNMENT_ACTOR';
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
        errorMessage: 'Authenticated principal is required.',
      };
    }

    if (!hasOnlyAllowedKeys(rawPrincipal, ALLOWED_PRINCIPAL_KEYS)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_ALIGNMENT_ACTOR',
        errorMessage: 'Authenticated principal contains unexpected properties.',
      };
    }

    const uid = rawPrincipal.uid;
    if (
      typeof uid !== 'string' ||
      uid.trim() !== uid ||
      !isValidUploaderUid(uid)
    ) {
      return {
        ok: false,
        errorCode: 'UNAUTHENTICATED',
        errorMessage: 'Authenticated principal UID is required.',
      };
    }

    if (rawPrincipal.token !== undefined) {
      if (
        !isPlainRecord(rawPrincipal.token) ||
        Object.getOwnPropertySymbols(rawPrincipal.token).length > 0
      ) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_ALIGNMENT_ACTOR',
          errorMessage: 'Authenticated principal token is malformed.',
        };
      }

      for (const key of Object.getOwnPropertyNames(rawPrincipal.token)) {
        if (FORBIDDEN_TOKEN_OVERRIDE_KEYS.has(key)) {
          return {
            ok: false,
            errorCode: 'UNAUTHORIZED_ALIGNMENT_ACTOR',
            errorMessage:
              'Token claims may not override server-side authorization or security posture.',
          };
        }
      }

      if (hasAutomatedOrAiTokenClaim(rawPrincipal.token)) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_ALIGNMENT_ACTOR',
          errorMessage:
            'Automated or AI assistant principals are not permitted to align quarantine catalog drafts.',
        };
      }
    }

    let admin: AdminUser | null = null;
    try {
      admin = await this.adminRepository.getAdminByUid(uid);
    } catch {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_ALIGNMENT_ACTOR',
        errorMessage: 'Failed to verify administrator permissions.',
      };
    }

    if (
      !admin ||
      typeof admin.id !== 'string' ||
      admin.id.trim() !== uid ||
      admin.id !== uid ||
      !isAuthorizedHumanLibraryCaseAlignmentActor(admin)
    ) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_ALIGNMENT_ACTOR',
        errorMessage:
          'Caller is not an active human Library administrator with Review and Create permissions.',
      };
    }

    return { ok: true, actorUid: uid, admin };
  }

  async getQuarantineCatalogCaseAlignment(
    rawInput: unknown
  ): Promise<GetLibraryQuarantineCatalogCaseAlignmentResponseDto> {
    if (
      !isPlainRecord(rawInput) ||
      !hasOnlyAllowedKeys(rawInput, ALLOWED_GET_INPUT_KEYS)
    ) {
      return makeGetHoldDto(
        null,
        'INVALID_ALIGNMENT_PAYLOAD',
        'getQuarantineCatalogCaseAlignment requires { receiptId } only.'
      );
    }

    const rawReceiptId = rawInput.receiptId;
    if (
      typeof rawReceiptId !== 'string' ||
      rawReceiptId.trim() !== rawReceiptId ||
      !isValidLibraryQuarantineReceiptId(rawReceiptId)
    ) {
      return makeGetHoldDto(
        null,
        'INVALID_RECEIPT_ID',
        'receiptId must be a valid quarantine receipt ID.'
      );
    }
    const receiptId = rawReceiptId;

    const authResult = await this.resolveAuthorizedActor();
    if (!authResult.ok) {
      return makeGetHoldDto(
        receiptId,
        authResult.errorCode,
        authResult.errorMessage
      );
    }

    try {
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
      const handoffRef = this.db
        .collection(LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION)
        .doc(receiptId);
      const docRef = this.db
        .collection(LIBRARY_DOCUMENTS_COLLECTION)
        .doc(documentId);
      const alignmentRef = this.db
        .collection(LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION)
        .doc(receiptId);
      const rightsDecisionRef = this.db
        .collection(LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION)
        .doc(receiptId);

      const readPointDocSnapshot = (
        docRef: LibraryQuarantineFirestoreDocumentRef
      ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
        if (!docRef || typeof docRef.get !== 'function') {
          return Promise.reject(
            new Error(
              'INVALID_POINT_DOC_REF: Firestore document reference does not expose a point get() method.'
            )
          );
        }
        return docRef.get();
      };

      // 7 point reads, 0 writes
      const [
        receiptSnap,
        draftSnap,
        caseSnap,
        handoffSnap,
        docSnap,
        alignmentSnap,
        rightsDecisionSnap,
      ] = await Promise.all([
        readPointDocSnapshot(receiptRef),
        readPointDocSnapshot(draftRef),
        readPointDocSnapshot(caseRef),
        readPointDocSnapshot(handoffRef),
        readPointDocSnapshot(docRef),
        readPointDocSnapshot(alignmentRef),
        readPointDocSnapshot(rightsDecisionRef),
      ]);

      const verified = verifyAlignmentChainSnapshots(
        receiptId,
        receiptSnap,
        draftSnap,
        caseSnap,
        handoffSnap,
        docSnap,
        alignmentSnap,
        rightsDecisionSnap
      );
      if (!verified.ok) {
        return makeGetHoldDto(
          receiptId,
          verified.errorCode,
          verified.errorMessage
        );
      }

      const s = verified.snapshot;
      return Object.freeze({
        ok: true,
        status: 'READY',
        receiptId,
        documentId,
        alignmentState: s.alignmentState,
        sourceRevision: s.receiptEnvelope.revision,
        originalHandoffCaseRevision: s.catalogHandoff.caseRevision,
        effectiveAlignedCaseRevision: s.effectiveAlignedCaseRevision,
        currentHumanCaseRevision: s.humanReviewCase.revision,
        currentAlignmentRevision: s.currentAlignmentRevision,
        catalogUpdatedAt: s.sanitizedCatalogDocument.updatedAt,
        diff: s.diff,
        alignment: s.alignment
          ? toSanitizedLibraryQuarantineCatalogCaseAlignmentDto(s.alignment)
          : null,
        handoff: toSanitizedLibraryQuarantineCatalogHandoffDto(s.catalogHandoff),
        catalogDocument: s.sanitizedCatalogDocument,
        humanReviewCase: toSanitizedLibraryQuarantineHumanReviewCaseDto(
          s.humanReviewCase
        ),
        hasRecordedRightsDecision: s.hasRecordedRightsDecision,
        recordedRightsDecisionCaseRevision: s.recordedRightsDecisionCaseRevision,
        rightsDecisionInvalidatedByCaseChange:
          s.rightsDecisionInvalidatedByCaseChange,
        requiresFreshRightsReview: s.requiresFreshRightsReview,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      });
    } catch {
      return makeGetHoldDto(
        receiptId,
        'ALIGNMENT_PERSISTENCE_FAILED',
        'Failed to load quarantine catalog case alignment snapshot.'
      );
    }
  }

  async alignQuarantineCatalogCase(
    rawInput: unknown
  ): Promise<AlignLibraryQuarantineCatalogCaseResponseDto> {
    if (
      !isPlainRecord(rawInput) ||
      !hasOnlyAllowedKeys(rawInput, ALLOWED_ALIGN_INPUT_KEYS)
    ) {
      return makeAlignHoldDto(
        null,
        'INVALID_ALIGNMENT_PAYLOAD',
        'alignQuarantineCatalogCase requires { receiptId, expectedCaseRevision, expectedCatalogUpdatedAt, expectedAlignmentRevision, confirmation } only.'
      );
    }

    const rawReceiptId = rawInput.receiptId;
    if (
      typeof rawReceiptId !== 'string' ||
      rawReceiptId.trim() !== rawReceiptId ||
      !isValidLibraryQuarantineReceiptId(rawReceiptId)
    ) {
      return makeAlignHoldDto(
        null,
        'INVALID_RECEIPT_ID',
        'receiptId must be a valid quarantine receipt ID.'
      );
    }
    const receiptId = rawReceiptId;

    if (
      rawInput.confirmation !==
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL
    ) {
      return makeAlignHoldDto(
        receiptId,
        'CONFIRMATION_REQUIRED',
        'Explicit confirmation literal APPLY_CASE_METADATA is required.'
      );
    }

    const expectedCaseRevision = rawInput.expectedCaseRevision;
    const expectedCatalogUpdatedAt = rawInput.expectedCatalogUpdatedAt;
    const expectedAlignmentRevision = rawInput.expectedAlignmentRevision;

    if (
      !isPositiveSafeInteger(expectedCaseRevision) ||
      typeof expectedCatalogUpdatedAt !== 'string' ||
      !isValidIsoUtcTimestamp(expectedCatalogUpdatedAt) ||
      !isNonNegativeSafeInteger(expectedAlignmentRevision)
    ) {
      return makeAlignHoldDto(
        receiptId,
        'INVALID_ALIGNMENT_PAYLOAD',
        'expectedCaseRevision, expectedCatalogUpdatedAt, and expectedAlignmentRevision must be valid optimistic concurrency tokens.'
      );
    }

    const authResult = await this.resolveAuthorizedActor();
    if (!authResult.ok) {
      return makeAlignHoldDto(
        receiptId,
        authResult.errorCode,
        authResult.errorMessage
      );
    }

    let nowIso: string;
    try {
      nowIso = this.clock();
    } catch {
      return makeAlignHoldDto(
        receiptId,
        'ALIGNMENT_PERSISTENCE_FAILED',
        'Failed to resolve server clock.'
      );
    }
    if (typeof nowIso !== 'string' || !isValidIsoUtcTimestamp(nowIso)) {
      return makeAlignHoldDto(
        receiptId,
        'ALIGNMENT_PERSISTENCE_FAILED',
        'Server clock produced an invalid ISO UTC timestamp.'
      );
    }

    const documentId = deriveQuarantineCatalogDocumentId(receiptId);
    const targetAlignmentRevision = expectedAlignmentRevision + 1;
    const targetEventId = deriveLibraryQuarantineCatalogCaseAlignmentEventId(
      receiptId,
      targetAlignmentRevision
    );

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
    const docRef = this.db
      .collection(LIBRARY_DOCUMENTS_COLLECTION)
      .doc(documentId);
    const alignmentRef = this.db
      .collection(LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION)
      .doc(receiptId);
    const eventRef = this.db
      .collection(LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION)
      .doc(targetEventId);
    const rightsDecisionRef = this.db
      .collection(LIBRARY_QUARANTINE_RIGHTS_DECISIONS_COLLECTION)
      .doc(receiptId);

    this.assertAllowedWriteCollection(LIBRARY_DOCUMENTS_COLLECTION);
    this.assertAllowedWriteCollection(
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION
    );
    this.assertAllowedWriteCollection(
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENTS_COLLECTION
    );

    // Track whether ANY transaction attempt staged writes (never reset inside callback)
    let writeStagedInAnyAttempt = false;

    try {
      const txResult = await this.db.runTransaction(async (tx) => {
        if (
          typeof tx.get !== 'function' ||
          typeof tx.create !== 'function' ||
          typeof tx.update !== 'function'
        ) {
          throw new PreWriteAlignmentHoldError(
            'ALIGNMENT_PERSISTENCE_FAILED',
            'Firestore transaction contract requires get, create, and update.'
          );
        }

        // Read all 8 point references before any write
        const [
          receiptSnap,
          draftSnap,
          caseSnap,
          handoffSnap,
          docSnap,
          alignmentSnap,
          eventSnap,
          rightsDecisionSnap,
        ] = await Promise.all([
          tx.get(receiptRef),
          tx.get(draftRef),
          tx.get(caseRef),
          tx.get(handoffRef),
          tx.get(docRef),
          tx.get(alignmentRef),
          tx.get(eventRef),
          tx.get(rightsDecisionRef),
        ]);

        const verified = verifyAlignmentChainSnapshots(
          receiptId,
          receiptSnap,
          draftSnap,
          caseSnap,
          handoffSnap,
          docSnap,
          alignmentSnap,
          rightsDecisionSnap
        );
        if (!verified.ok) {
          throw new PreWriteAlignmentHoldError(
            verified.errorCode,
            verified.errorMessage
          );
        }

        const s = verified.snapshot;

        // Optimistic concurrency check on all 3 CAS tokens
        if (
          s.humanReviewCase.revision !== expectedCaseRevision ||
          s.sanitizedCatalogDocument.updatedAt !== expectedCatalogUpdatedAt ||
          s.currentAlignmentRevision !== expectedAlignmentRevision
        ) {
          throw new PreWriteAlignmentConflictError(
            s.humanReviewCase.revision,
            s.sanitizedCatalogDocument.updatedAt,
            s.currentAlignmentRevision,
            s.effectiveAlignedCaseRevision,
            s.diff,
            s.alignment
              ? toSanitizedLibraryQuarantineCatalogCaseAlignmentDto(s.alignment)
              : null,
            s.sanitizedCatalogDocument,
            toSanitizedLibraryQuarantineHumanReviewCaseDto(s.humanReviewCase)
          );
        }

        // Idempotent ALREADY_ALIGNED path (0 writes)
        if (s.alignmentState === 'ALIGNED' && !s.diff.hasAnyDifference) {
          return Object.freeze({
            outcome: 'ALREADY_ALIGNED' as const,
            sourceRevision: s.receiptEnvelope.revision,
            originalHandoffCaseRevision: s.catalogHandoff.caseRevision,
            effectiveAlignedCaseRevision: s.effectiveAlignedCaseRevision,
            currentHumanCaseRevision: s.humanReviewCase.revision,
            currentAlignmentRevision: s.currentAlignmentRevision,
            catalogUpdatedAt: s.sanitizedCatalogDocument.updatedAt,
            diff: s.diff,
            alignment: s.alignment,
            catalogHandoff: s.catalogHandoff,
            sanitizedCatalogDocument: s.sanitizedCatalogDocument,
            humanReviewCase: s.humanReviewCase,
            hasRecordedRightsDecision: s.hasRecordedRightsDecision,
            recordedRightsDecisionCaseRevision:
              s.recordedRightsDecisionCaseRevision,
            rightsDecisionInvalidatedByCaseChange:
              s.rightsDecisionInvalidatedByCaseChange,
            requiresFreshRightsReview: s.requiresFreshRightsReview,
          });
        }

        if (eventSnap.exists) {
          throw new PreWriteAlignmentHoldError(
            'ALIGNMENT_EVENT_ALREADY_EXISTS',
            'Target catalog case alignment audit event already exists.'
          );
        }

        // Strict validation of the 4 editorial fields from humanReviewCase (no guessing or auto-translation)
        const nextTitleAr = s.humanReviewCase.titleAr.trim();
        const nextTitleEn = s.humanReviewCase.titleEn.trim();
        const nextSummaryAr = s.humanReviewCase.summaryAr.trim();
        const nextSummaryEn = s.humanReviewCase.summaryEn.trim();

        if (
          !isSafeEditorialText(nextTitleAr, 300, false) ||
          !isSafeEditorialText(nextTitleEn, 300, false) ||
          !isSafeEditorialText(nextSummaryAr, 2000, true) ||
          !isSafeEditorialText(nextSummaryEn, 2000, true)
        ) {
          throw new PreWriteAlignmentHoldError(
            'CATALOG_DOCUMENT_VALIDATION_FAILED',
            'All four bilingual editorial fields (titleAr, titleEn, summaryAr, summaryEn) must be non-empty plain text in the saved human review case before aligning the catalog draft.'
          );
        }

        if (
          Date.parse(nowIso) < Date.parse(s.sanitizedCatalogDocument.updatedAt)
        ) {
          throw new PreWriteAlignmentHoldError(
            'ALIGNMENT_PERSISTENCE_FAILED',
            'Server timestamp is earlier than current catalog document updatedAt.'
          );
        }

        const updatedCatalogDocument: LibraryDocument = {
          ...s.rawCatalogDocument,
          titleAr: nextTitleAr,
          titleEn: nextTitleEn,
          summaryAr: nextSummaryAr,
          summaryEn: nextSummaryEn,
          rightsStatus: LibraryRightsStatus.ReviewRequired,
          workflowState: WorkflowState.Draft,
          workflowHistory: [],
          updatedAt: nowIso,
          versions: s.sanitizedCatalogDocument.versions.map((v) => ({
            id: v.id,
            documentId: v.documentId,
            versionNumber: v.versionNumber,
            publishedDate: v.publishedDate,
            changeDescriptionAr: v.changeDescriptionAr,
            changeDescriptionEn: v.changeDescriptionEn,
          })),
        };

        try {
          LibraryValidator.validateDocument(updatedCatalogDocument);
        } catch (validationErr) {
          throw new PreWriteAlignmentHoldError(
            'CATALOG_DOCUMENT_VALIDATION_FAILED',
            validationErr instanceof Error
              ? validationErr.message
              : 'Updated qcat catalog document failed LibraryValidator.'
          );
        }

        const strictDocCheck = validatePersistedCatalogDraftDocument(
          toFirestoreDocumentData(updatedCatalogDocument),
          documentId
        );
        if (!strictDocCheck.ok) {
          throw new PreWriteAlignmentHoldError(
            strictDocCheck.errorCode === 'SECURITY_POSTURE_VIOLATION'
              ? 'SECURITY_POSTURE_VIOLATION'
              : 'INVALID_CATALOG_DOCUMENT_STATE',
            'Updated qcat catalog document failed strict draft validation.'
          );
        }

        const nextAlignment: LibraryQuarantinePersistedCatalogCaseAlignment = {
          schemaVersion:
            LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
          receiptId,
          documentId,
          sourceRevision: s.receiptEnvelope.revision,
          sourceUpdatedAt: s.receiptEnvelope.receipt.updatedAt,
          sourceSha256: s.receiptEnvelope.receipt.sha256,
          originalHandoffCaseRevision: s.catalogHandoff.caseRevision,
          alignmentRevision: targetAlignmentRevision,
          alignedHumanCaseRevision: s.humanReviewCase.revision,
          alignedHumanCaseUpdatedAt: s.humanReviewCase.updatedAt,
          documentUpdatedAt: nowIso,
          createdBy: s.alignment ? s.alignment.createdBy : authResult.actorUid,
          createdAt: s.alignment ? s.alignment.createdAt : nowIso,
          updatedBy: authResult.actorUid,
          updatedAt: nowIso,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        };

        const alignmentValidation =
          validatePersistedLibraryQuarantineCatalogCaseAlignment(
            nextAlignment,
            receiptId
          );
        if (!alignmentValidation.ok) {
          throw new PreWriteAlignmentHoldError(
            alignmentValidation.errorCode,
            alignmentValidation.errorMessage
          );
        }

        const nextEvent: LibraryQuarantinePersistedCatalogCaseAlignmentEvent = {
          schemaVersion:
            LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
          eventId: targetEventId,
          receiptId,
          documentId,
          alignmentRevision: targetAlignmentRevision,
          previousAlignmentRevision: expectedAlignmentRevision,
          reason: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_EVENT_REASON,
          sourceRevision: s.receiptEnvelope.revision,
          sourceUpdatedAt: s.receiptEnvelope.receipt.updatedAt,
          sourceSha256: s.receiptEnvelope.receipt.sha256,
          originalHandoffCaseRevision: s.catalogHandoff.caseRevision,
          fromCaseRevision: s.effectiveAlignedCaseRevision,
          toCaseRevision: s.humanReviewCase.revision,
          fromCatalogUpdatedAt: s.sanitizedCatalogDocument.updatedAt,
          toCatalogUpdatedAt: nowIso,
          actorUid: authResult.actorUid,
          recordedAt: nowIso,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        };

        const eventValidation =
          validatePersistedLibraryQuarantineCatalogCaseAlignmentEvent(
            nextEvent,
            receiptId,
            targetAlignmentRevision
          );
        if (!eventValidation.ok) {
          throw new PreWriteAlignmentHoldError(
            eventValidation.errorCode,
            eventValidation.errorMessage
          );
        }

        // Stage exactly 3 writes: tx.update(qcat), tx.create/update(alignment), tx.create(event)
        tx.update(docRef, toFirestoreDocumentData(updatedCatalogDocument));
        writeStagedInAnyAttempt = true;
        if (expectedAlignmentRevision === 0) {
          tx.create(
            alignmentRef,
            toFirestoreDocumentData(alignmentValidation.alignment)
          );
        } else {
          tx.update(
            alignmentRef,
            toFirestoreDocumentData(alignmentValidation.alignment)
          );
        }
        tx.create(
          eventRef,
          toFirestoreDocumentData(eventValidation.alignmentEvent)
        );

        const updatedDiff = computeLibraryQuarantineCatalogCaseFourFieldDiff(
          s.humanReviewCase,
          updatedCatalogDocument
        );

        const rightsInvalidated =
          s.hasRecordedRightsDecision &&
          s.recordedRightsDecisionCaseRevision !== null &&
          s.recordedRightsDecisionCaseRevision < s.humanReviewCase.revision;

        const requiresFreshRights =
          !s.hasRecordedRightsDecision || rightsInvalidated;

        return Object.freeze({
          outcome: 'ALIGNED' as const,
          sourceRevision: s.receiptEnvelope.revision,
          originalHandoffCaseRevision: s.catalogHandoff.caseRevision,
          effectiveAlignedCaseRevision: s.humanReviewCase.revision,
          currentHumanCaseRevision: s.humanReviewCase.revision,
          currentAlignmentRevision: targetAlignmentRevision,
          catalogUpdatedAt: nowIso,
          diff: updatedDiff,
          alignment: alignmentValidation.alignment,
          catalogHandoff: s.catalogHandoff,
          sanitizedCatalogDocument: strictDocCheck.catalogDocument,
          humanReviewCase: s.humanReviewCase,
          hasRecordedRightsDecision: s.hasRecordedRightsDecision,
          recordedRightsDecisionCaseRevision:
            s.recordedRightsDecisionCaseRevision,
          rightsDecisionInvalidatedByCaseChange: rightsInvalidated,
          requiresFreshRightsReview: requiresFreshRights,
        });
      });

      const sanitizedAlignment = txResult.alignment
        ? toSanitizedLibraryQuarantineCatalogCaseAlignmentDto(txResult.alignment)
        : null;
      const sanitizedHandoff = toSanitizedLibraryQuarantineCatalogHandoffDto(
        txResult.catalogHandoff
      );
      const sanitizedCase = toSanitizedLibraryQuarantineHumanReviewCaseDto(
        txResult.humanReviewCase
      );

      return Object.freeze({
        ok: true,
        status: txResult.outcome,
        alignmentOutcome: txResult.outcome,
        alignmentSaved: txResult.outcome === 'ALIGNED',
        receiptId,
        documentId,
        alignmentState: 'ALIGNED',
        sourceRevision: txResult.sourceRevision,
        originalHandoffCaseRevision: txResult.originalHandoffCaseRevision,
        effectiveAlignedCaseRevision: txResult.effectiveAlignedCaseRevision,
        currentHumanCaseRevision: txResult.currentHumanCaseRevision,
        currentAlignmentRevision: txResult.currentAlignmentRevision,
        catalogUpdatedAt: txResult.catalogUpdatedAt,
        diff: txResult.diff,
        alignment: sanitizedAlignment,
        handoff: sanitizedHandoff,
        catalogDocument: txResult.sanitizedCatalogDocument,
        humanReviewCase: sanitizedCase,
        hasRecordedRightsDecision: txResult.hasRecordedRightsDecision,
        recordedRightsDecisionCaseRevision:
          txResult.recordedRightsDecisionCaseRevision,
        rightsDecisionInvalidatedByCaseChange:
          txResult.rightsDecisionInvalidatedByCaseChange,
        requiresFreshRightsReview: txResult.requiresFreshRightsReview,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      });
    } catch (err) {
      if (writeStagedInAnyAttempt) {
        return makeAlignUnknownDto(receiptId);
      }

      if (err instanceof PreWriteAlignmentConflictError) {
        return Object.freeze({
          ok: false,
          status: 'CONFLICT',
          alignmentOutcome: 'NOT_ALIGNED',
          alignmentSaved: false,
          errorCode: 'ALIGNMENT_REVISION_CONFLICT',
          errorMessage:
            'Optimistic concurrency check failed because the human review case, catalog draft, or alignment revision changed on the server.',
          receiptId,
          documentId,
          currentHumanCaseRevision: err.currentHumanCaseRevision,
          currentCatalogUpdatedAt: err.currentCatalogUpdatedAt,
          currentAlignmentRevision: err.currentAlignmentRevision,
          effectiveAlignedCaseRevision: err.effectiveAlignedCaseRevision,
          diff: err.diff,
          alignment: err.alignment,
          catalogDocument: err.catalogDocument,
          humanReviewCase: err.humanReviewCase,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        });
      }

      if (err instanceof PreWriteAlignmentHoldError) {
        return makeAlignHoldDto(receiptId, err.errorCode, err.errorMessage);
      }

      return makeAlignHoldDto(
        receiptId,
        'TRANSACTION_ABORTED_NO_WRITE',
        'Catalog case alignment transaction aborted before staging writes.'
      );
    }
  }
}
