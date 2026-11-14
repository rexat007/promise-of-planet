import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  ROLE_PERMISSIONS_MAP,
  hasDomainResponsibility,
  type AdminUser,
} from '../types/admin';
import {
  deriveQuarantineCatalogDocumentId,
  validateSanitizedLibraryQuarantineCatalogDocumentDto,
  validateSanitizedLibraryQuarantineCatalogHandoffDto,
  type SanitizedLibraryQuarantineCatalogDocumentDto,
  type SanitizedLibraryQuarantineCatalogHandoffDto,
} from './libraryQuarantineCatalogHandoffClient';
import {
  validateSanitizedLibraryQuarantineHumanReviewCaseDto,
  type SanitizedLibraryQuarantineHumanReviewCaseDto,
} from './libraryQuarantineHumanReviewClient';

export const LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL =
  'APPLY_CASE_METADATA' as const;
export type LibraryQuarantineCatalogCaseAlignmentConfirmationLiteral =
  typeof LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL;

export const VITE_LIBRARY_CASE_ALIGNMENT_RELEASE_FLAG =
  'VITE_LIBRARY_CASE_ALIGNMENT_ENABLED' as const;
export const LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR =
  VITE_LIBRARY_CASE_ALIGNMENT_RELEASE_FLAG;
export const LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION = 1 as const;

export const CASE_ALIGNMENT_CLIENT_SAFE_ERRORS = Object.freeze({
  FEATURE_NOT_RELEASED:
    'Catalog case alignment is not enabled in this environment.',
  UNAUTHORIZED:
    'Only active Library Curators or System Administrators with Review and Create permissions may align catalog drafts with human review cases.',
  INVALID_RECEIPT_ID: 'A valid quarantine receipt ID is required.',
  INVALID_PAYLOAD: 'Case alignment payload contains invalid parameters.',
  BACKEND_UNAVAILABLE: 'Quarantine case alignment backend is unavailable.',
  NETWORK_ERROR:
    'A network or server error occurred while processing case alignment.',
  TRANSACTION_COMMIT_UNCERTAIN:
    'Alignment commit state is uncertain due to a network interruption. Please verify status before retrying.',
  UNCONFIRMED_RECONCILIATION:
    'Explicit confirmation checkbox must be checked before applying case metadata.',
  UNSAVED_CASE_EDITS:
    'Save or discard unsaved human review case edits before aligning the catalog draft.',
});

export type LibraryQuarantineCatalogCaseAlignmentState =
  | 'ALIGNED'
  | 'NEEDS_REALIGNMENT';

export type LibraryQuarantineCatalogCaseAlignmentStatus =
  LibraryQuarantineCatalogCaseAlignmentState;

export type LibraryQuarantineCatalogCaseAlignmentOutcome =
  | 'ALIGNED'
  | 'ALREADY_ALIGNED'
  | 'NOT_ALIGNED'
  | 'UNKNOWN';

export type LibraryQuarantineCatalogCaseFourFieldKey =
  | 'titleAr'
  | 'titleEn'
  | 'summaryAr'
  | 'summaryEn';

export const LIBRARY_QUARANTINE_CATALOG_CASE_FOUR_FIELD_KEYS: readonly LibraryQuarantineCatalogCaseFourFieldKey[] =
  Object.freeze(['titleAr', 'titleEn', 'summaryAr', 'summaryEn']);

export interface LibraryQuarantineCatalogCaseFieldComparisonDto {
  readonly caseValue: string;
  readonly catalogValue: string;
  readonly changed: boolean;
}

export interface LibraryQuarantineCatalogCaseFourFieldDiffDto {
  readonly hasAnyDifference: boolean;
  readonly fields: {
    readonly titleAr: LibraryQuarantineCatalogCaseFieldComparisonDto;
    readonly titleEn: LibraryQuarantineCatalogCaseFieldComparisonDto;
    readonly summaryAr: LibraryQuarantineCatalogCaseFieldComparisonDto;
    readonly summaryEn: LibraryQuarantineCatalogCaseFieldComparisonDto;
  };
}

export interface SanitizedLibraryQuarantineCatalogCaseAlignmentDto {
  readonly schemaVersion: 1;
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
  readonly errorCode: string;
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
  readonly errorCode: string;
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

export interface GetQuarantineCatalogCaseAlignmentCallablePayload {
  readonly action: 'getQuarantineCatalogCaseAlignment';
  readonly receiptId: string;
}

export interface AlignQuarantineCatalogCaseCallablePayload {
  readonly action: 'alignQuarantineCatalogCase';
  readonly receiptId: string;
  readonly expectedCaseRevision: number;
  readonly expectedCatalogUpdatedAt: string;
  readonly expectedAlignmentRevision: number;
  readonly confirmation: typeof LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL;
}

export type LibraryQuarantineCatalogCaseAlignmentCallablePayload =
  | GetQuarantineCatalogCaseAlignmentCallablePayload
  | AlignQuarantineCatalogCaseCallablePayload;

export type LibraryQuarantineCatalogCaseAlignmentCallableInvoker = (
  payload: LibraryQuarantineCatalogCaseAlignmentCallablePayload
) => Promise<unknown>;

export interface LibraryQuarantineCatalogCaseAlignmentClientOptions {
  readonly envOverride?: Record<string, unknown>;
  readonly currentUser?: AdminUser | null;
  readonly invokeCallable?: LibraryQuarantineCatalogCaseAlignmentCallableInvoker;
  readonly caseAlignmentEnabled?: boolean;
  readonly getAlignmentFn?: (
    receiptId: string
  ) => Promise<GetLibraryQuarantineCatalogCaseAlignmentResponseDto>;
  readonly alignCaseFn?: (
    payload: AlignQuarantineCatalogCaseClientRequest
  ) => Promise<AlignLibraryQuarantineCatalogCaseResponseDto>;
}

const RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;
const STRICT_UTC_ISO_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const FORBIDDEN_PRIVATE_KEYS: ReadonlySet<string> = new Set([
  'alignedBy',
  'alignedByUid',
  'alignedByEmail',
  'createdBy',
  'createdByUid',
  'updatedBy',
  'updatedByUid',
  'decidedByUid',
  'uploaderUid',
  'sourceSha256',
  'storagePath',
  'quarantineBucketName',
  'quarantineObjectPath',
  'gsUri',
  'storageUri',
  'signedUrl',
  'downloadUrl',
  'mediaLink',
  'selfLink',
  'referenceUrl',
  'extractedText',
  'rawExtractedText',
  'suppliedExcerpt',
  'bodyText',
  'binaryPayload',
  'fileBytes',
  'contentBytes',
  'sha256',
  'etag',
  'generation',
  'metageneration',
  'sourceReference',
  'internalNotes',
]);

const FORBIDDEN_STRING_SUBSTRINGS: readonly string[] = Object.freeze([
  'gs://',
  'https://storage.googleapis.com/',
  'firebasestorage.googleapis.com',
  'library/quarantine/',
  'X-Goog-Signature',
]);

const SANITIZED_ALIGNMENT_KEYS: readonly string[] = Object.freeze([
  'schemaVersion',
  'receiptId',
  'documentId',
  'sourceRevision',
  'sourceUpdatedAt',
  'originalHandoffCaseRevision',
  'alignmentRevision',
  'alignedHumanCaseRevision',
  'alignedHumanCaseUpdatedAt',
  'documentUpdatedAt',
  'createdAt',
  'updatedAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const DIFF_TOP_KEYS: readonly string[] = Object.freeze([
  'hasAnyDifference',
  'fields',
]);

const DIFF_FIELDS_KEYS: readonly string[] = Object.freeze([
  'titleAr',
  'titleEn',
  'summaryAr',
  'summaryEn',
]);

const FIELD_COMPARISON_KEYS: readonly string[] = Object.freeze([
  'caseValue',
  'catalogValue',
  'changed',
]);

const GET_READY_KEYS: readonly string[] = Object.freeze([
  'ok',
  'status',
  'receiptId',
  'documentId',
  'alignmentState',
  'sourceRevision',
  'originalHandoffCaseRevision',
  'effectiveAlignedCaseRevision',
  'currentHumanCaseRevision',
  'currentAlignmentRevision',
  'catalogUpdatedAt',
  'diff',
  'alignment',
  'handoff',
  'catalogDocument',
  'humanReviewCase',
  'hasRecordedRightsDecision',
  'recordedRightsDecisionCaseRevision',
  'rightsDecisionInvalidatedByCaseChange',
  'requiresFreshRightsReview',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const GET_HOLD_KEYS: readonly string[] = Object.freeze([
  'ok',
  'status',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALIGN_SUCCESS_KEYS: readonly string[] = Object.freeze([
  'ok',
  'status',
  'alignmentOutcome',
  'alignmentSaved',
  'receiptId',
  'documentId',
  'alignmentState',
  'sourceRevision',
  'originalHandoffCaseRevision',
  'effectiveAlignedCaseRevision',
  'currentHumanCaseRevision',
  'currentAlignmentRevision',
  'catalogUpdatedAt',
  'diff',
  'alignment',
  'handoff',
  'catalogDocument',
  'humanReviewCase',
  'hasRecordedRightsDecision',
  'recordedRightsDecisionCaseRevision',
  'rightsDecisionInvalidatedByCaseChange',
  'requiresFreshRightsReview',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALIGN_CONFLICT_KEYS: readonly string[] = Object.freeze([
  'ok',
  'status',
  'alignmentOutcome',
  'alignmentSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'currentHumanCaseRevision',
  'currentCatalogUpdatedAt',
  'currentAlignmentRevision',
  'effectiveAlignedCaseRevision',
  'diff',
  'alignment',
  'catalogDocument',
  'humanReviewCase',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALIGN_HOLD_OR_UNKNOWN_KEYS: readonly string[] = Object.freeze([
  'ok',
  'status',
  'alignmentOutcome',
  'alignmentSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

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

function hasExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== expectedKeys.length) {
    return false;
  }
  const expectedSet = new Set(expectedKeys);
  for (const key of actualKeys) {
    if (!expectedSet.has(key)) {
      return false;
    }
  }
  return true;
}

function hasFiveFalseAssuranceFlags(record: Record<string, unknown>): boolean {
  return (
    record.isSanitized === false &&
    record.isVerifiedSafe === false &&
    record.isRightsApproved === false &&
    record.isPublished === false &&
    record.isReadyForPeia === false
  );
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !STRICT_UTC_ISO_TIMESTAMP_REGEX.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

function containsForbiddenKeyOrStringDeep(
  value: unknown,
  visited: Set<object> = new Set()
): boolean {
  if (typeof value === 'string') {
    for (const forbidden of FORBIDDEN_STRING_SUBSTRINGS) {
      if (value.includes(forbidden)) {
        return true;
      }
    }
    return false;
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (visited.has(value)) {
    return false;
  }
  visited.add(value);

  if (Object.getOwnPropertySymbols(value).length > 0) {
    return true;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsForbiddenKeyOrStringDeep(item, visited)) {
        return true;
      }
    }
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return true;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PRIVATE_KEYS.has(key)) {
      return true;
    }
    if (containsForbiddenKeyOrStringDeep(nested, visited)) {
      return true;
    }
  }

  return false;
}

export function areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(
  envOverride?: Record<string, unknown>
): boolean {
  const metaEnv =
    envOverride ??
    ((typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { readonly env?: Record<string, unknown> })
        .env) ||
      {});

  const workbenchFlag = metaEnv.VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED;
  const humanCaseFlag = metaEnv.VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED;
  const catalogHandoffFlag = metaEnv.VITE_LIBRARY_CATALOG_HANDOFF_ENABLED;
  const caseAlignmentFlag = metaEnv[VITE_LIBRARY_CASE_ALIGNMENT_RELEASE_FLAG];

  return (
    (workbenchFlag === 'true' || workbenchFlag === true) &&
    (humanCaseFlag === 'true' || humanCaseFlag === true) &&
    (catalogHandoffFlag === 'true' || catalogHandoffFlag === true) &&
    (caseAlignmentFlag === 'true' || caseAlignmentFlag === true)
  );
}

export const isLibraryQuarantineCatalogCaseAlignmentEnabled =
  areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled;

export function canCurrentAdminAlignQuarantineCatalogDraft(
  user: AdminUser | null | undefined
): boolean {
  if (!user || typeof user !== 'object') {
    return false;
  }
  if (user.isActive !== true) {
    return false;
  }

  const candidate = user as AdminUser & {
    readonly accountType?: unknown;
    readonly isAutomated?: unknown;
    readonly permissions?: unknown;
  };

  if (candidate.accountType !== undefined && candidate.accountType === 'service') {
    return false;
  }
  if (candidate.isAutomated !== undefined && candidate.isAutomated !== false) {
    return false;
  }

  if (
    typeof user.role !== 'string' ||
    !Object.values(AdminRole).includes(user.role)
  ) {
    return false;
  }

  if (!hasDomainResponsibility(user.role, AdminDomain.Library)) {
    return false;
  }

  const rolePerms = ROLE_PERMISSIONS_MAP[user.role];
  if (
    !rolePerms ||
    !rolePerms.has(AdminPermission.Review) ||
    !rolePerms.has(AdminPermission.Create)
  ) {
    return false;
  }

  if (Array.isArray(candidate.permissions)) {
    if (
      !candidate.permissions.includes(AdminPermission.Review) ||
      !candidate.permissions.includes(AdminPermission.Create)
    ) {
      return false;
    }
  }

  return true;
}

export const canAlignLibraryQuarantineCatalogDraft =
  canCurrentAdminAlignQuarantineCatalogDraft;

export function computeClientCatalogCaseFourFieldDiff(
  savedCase: Pick<
    SanitizedLibraryQuarantineHumanReviewCaseDto,
    'titleAr' | 'titleEn' | 'summaryAr' | 'summaryEn'
  >,
  catalogDocument: Pick<
    SanitizedLibraryQuarantineCatalogDocumentDto,
    'titleAr' | 'titleEn' | 'summaryAr' | 'summaryEn'
  >
): LibraryQuarantineCatalogCaseFourFieldDiffDto {
  const titleArChanged = savedCase.titleAr !== catalogDocument.titleAr;
  const titleEnChanged = savedCase.titleEn !== catalogDocument.titleEn;
  const summaryArChanged = savedCase.summaryAr !== catalogDocument.summaryAr;
  const summaryEnChanged = savedCase.summaryEn !== catalogDocument.summaryEn;

  return Object.freeze({
    hasAnyDifference:
      titleArChanged || titleEnChanged || summaryArChanged || summaryEnChanged,
    fields: Object.freeze({
      titleAr: Object.freeze({
        caseValue: savedCase.titleAr,
        catalogValue: catalogDocument.titleAr,
        changed: titleArChanged,
      }),
      titleEn: Object.freeze({
        caseValue: savedCase.titleEn,
        catalogValue: catalogDocument.titleEn,
        changed: titleEnChanged,
      }),
      summaryAr: Object.freeze({
        caseValue: savedCase.summaryAr,
        catalogValue: catalogDocument.summaryAr,
        changed: summaryArChanged,
      }),
      summaryEn: Object.freeze({
        caseValue: savedCase.summaryEn,
        catalogValue: catalogDocument.summaryEn,
        changed: summaryEnChanged,
      }),
    }),
  });
}

function validateFieldComparisonDto(
  value: unknown
): LibraryQuarantineCatalogCaseFieldComparisonDto | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, FIELD_COMPARISON_KEYS)) {
    return null;
  }
  if (
    typeof value.caseValue !== 'string' ||
    typeof value.catalogValue !== 'string' ||
    typeof value.changed !== 'boolean'
  ) {
    return null;
  }
  if (value.changed !== (value.caseValue !== value.catalogValue)) {
    return null;
  }
  return Object.freeze({
    caseValue: value.caseValue,
    catalogValue: value.catalogValue,
    changed: value.changed,
  });
}

export function validateCatalogCaseFourFieldDiffDto(
  value: unknown
): LibraryQuarantineCatalogCaseFourFieldDiffDto | null {
  if (
    !isPlainRecord(value) ||
    containsForbiddenKeyOrStringDeep(value) ||
    !hasExactKeys(value, DIFF_TOP_KEYS) ||
    typeof value.hasAnyDifference !== 'boolean' ||
    !isPlainRecord(value.fields) ||
    !hasExactKeys(value.fields, DIFF_FIELDS_KEYS)
  ) {
    return null;
  }

  const titleAr = validateFieldComparisonDto(value.fields.titleAr);
  const titleEn = validateFieldComparisonDto(value.fields.titleEn);
  const summaryAr = validateFieldComparisonDto(value.fields.summaryAr);
  const summaryEn = validateFieldComparisonDto(value.fields.summaryEn);
  if (!titleAr || !titleEn || !summaryAr || !summaryEn) {
    return null;
  }

  const expectedHasAnyDifference =
    titleAr.changed ||
    titleEn.changed ||
    summaryAr.changed ||
    summaryEn.changed;
  if (value.hasAnyDifference !== expectedHasAnyDifference) {
    return null;
  }

  return Object.freeze({
    hasAnyDifference: value.hasAnyDifference,
    fields: Object.freeze({
      titleAr,
      titleEn,
      summaryAr,
      summaryEn,
    }),
  });
}

export function validateSanitizedCatalogCaseAlignmentDto(
  value: unknown,
  expectedReceiptId?: string
): SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null {
  if (
    !isPlainRecord(value) ||
    containsForbiddenKeyOrStringDeep(value) ||
    !hasExactKeys(value, SANITIZED_ALIGNMENT_KEYS) ||
    !hasFiveFalseAssuranceFlags(value)
  ) {
    return null;
  }

  if (value.schemaVersion !== 1) {
    return null;
  }

  const receiptId = value.receiptId;
  if (typeof receiptId !== 'string' || !RECEIPT_ID_REGEX.test(receiptId)) {
    return null;
  }
  if (expectedReceiptId !== undefined && receiptId !== expectedReceiptId) {
    return null;
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentId(receiptId);
  if (value.documentId !== expectedDocumentId) {
    return null;
  }

  if (
    typeof value.sourceRevision !== 'number' ||
    !Number.isSafeInteger(value.sourceRevision) ||
    value.sourceRevision < 1 ||
    !isValidIsoTimestamp(value.sourceUpdatedAt) ||
    typeof value.originalHandoffCaseRevision !== 'number' ||
    !Number.isSafeInteger(value.originalHandoffCaseRevision) ||
    value.originalHandoffCaseRevision < 1 ||
    typeof value.alignmentRevision !== 'number' ||
    !Number.isSafeInteger(value.alignmentRevision) ||
    value.alignmentRevision < 1 ||
    typeof value.alignedHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(value.alignedHumanCaseRevision) ||
    value.alignedHumanCaseRevision < value.originalHandoffCaseRevision ||
    !isValidIsoTimestamp(value.alignedHumanCaseUpdatedAt) ||
    !isValidIsoTimestamp(value.documentUpdatedAt) ||
    !isValidIsoTimestamp(value.createdAt) ||
    !isValidIsoTimestamp(value.updatedAt)
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    receiptId,
    documentId: expectedDocumentId,
    sourceRevision: value.sourceRevision,
    sourceUpdatedAt: value.sourceUpdatedAt,
    originalHandoffCaseRevision: value.originalHandoffCaseRevision,
    alignmentRevision: value.alignmentRevision,
    alignedHumanCaseRevision: value.alignedHumanCaseRevision,
    alignedHumanCaseUpdatedAt: value.alignedHumanCaseUpdatedAt,
    documentUpdatedAt: value.documentUpdatedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function validateHandoffSafe(
  raw: unknown,
  receiptId: string
): SanitizedLibraryQuarantineCatalogHandoffDto | null {
  try {
    return validateSanitizedLibraryQuarantineCatalogHandoffDto(raw, receiptId);
  } catch {
    return null;
  }
}

function validateCatalogDocumentSafe(
  raw: unknown,
  receiptId: string
): SanitizedLibraryQuarantineCatalogDocumentDto | null {
  try {
    return validateSanitizedLibraryQuarantineCatalogDocumentDto(
      raw,
      deriveQuarantineCatalogDocumentId(receiptId)
    );
  } catch {
    return null;
  }
}

function validateHumanReviewCaseSafe(
  raw: unknown,
  receiptId: string
): SanitizedLibraryQuarantineHumanReviewCaseDto | null {
  try {
    return validateSanitizedLibraryQuarantineHumanReviewCaseDto(raw, receiptId);
  } catch {
    return null;
  }
}

function diffMatchesCaseAndCatalog(
  diff: LibraryQuarantineCatalogCaseFourFieldDiffDto,
  humanReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto,
  catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto
): boolean {
  return (
    diff.fields.titleAr.caseValue === humanReviewCase.titleAr &&
    diff.fields.titleAr.catalogValue === catalogDocument.titleAr &&
    diff.fields.titleEn.caseValue === humanReviewCase.titleEn &&
    diff.fields.titleEn.catalogValue === catalogDocument.titleEn &&
    diff.fields.summaryAr.caseValue === humanReviewCase.summaryAr &&
    diff.fields.summaryAr.catalogValue === catalogDocument.summaryAr &&
    diff.fields.summaryEn.caseValue === humanReviewCase.summaryEn &&
    diff.fields.summaryEn.catalogValue === catalogDocument.summaryEn
  );
}

export function validateGetCatalogCaseAlignmentResponseDto(
  rawResponse: unknown,
  expectedReceiptId?: string
): GetLibraryQuarantineCatalogCaseAlignmentResponseDto | null {
  if (
    !isPlainRecord(rawResponse) ||
    containsForbiddenKeyOrStringDeep(rawResponse)
  ) {
    return null;
  }

  if (rawResponse.ok === false && rawResponse.status === 'HOLD') {
    if (
      !hasExactKeys(rawResponse, GET_HOLD_KEYS) ||
      !hasFiveFalseAssuranceFlags(rawResponse) ||
      typeof rawResponse.errorCode !== 'string' ||
      rawResponse.errorCode.trim().length === 0 ||
      typeof rawResponse.errorMessage !== 'string' ||
      rawResponse.errorMessage.trim().length === 0
    ) {
      return null;
    }

    const receiptId = rawResponse.receiptId;
    if (
      receiptId !== null &&
      (typeof receiptId !== 'string' || !RECEIPT_ID_REGEX.test(receiptId))
    ) {
      return null;
    }
    if (
      expectedReceiptId !== undefined &&
      RECEIPT_ID_REGEX.test(expectedReceiptId) &&
      receiptId !== null &&
      receiptId !== expectedReceiptId
    ) {
      return null;
    }

    const documentId = rawResponse.documentId;
    if (documentId !== null) {
      if (typeof documentId !== 'string' || !/^qcat-[0-9a-f]{32}$/.test(documentId)) {
        return null;
      }
      if (
        receiptId !== null &&
        documentId !== deriveQuarantineCatalogDocumentId(receiptId)
      ) {
        return null;
      }
    }

    return Object.freeze({
      ok: false as const,
      status: 'HOLD' as const,
      errorCode: rawResponse.errorCode,
      errorMessage: rawResponse.errorMessage,
      receiptId,
      documentId,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (rawResponse.ok !== true || rawResponse.status !== 'READY') {
    return null;
  }

  if (
    !hasExactKeys(rawResponse, GET_READY_KEYS) ||
    !hasFiveFalseAssuranceFlags(rawResponse)
  ) {
    return null;
  }

  const receiptId = rawResponse.receiptId;
  if (typeof receiptId !== 'string' || !RECEIPT_ID_REGEX.test(receiptId)) {
    return null;
  }
  if (expectedReceiptId !== undefined && receiptId !== expectedReceiptId) {
    return null;
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentId(receiptId);
  if (rawResponse.documentId !== expectedDocumentId) {
    return null;
  }

  if (
    rawResponse.alignmentState !== 'ALIGNED' &&
    rawResponse.alignmentState !== 'NEEDS_REALIGNMENT'
  ) {
    return null;
  }

  if (
    typeof rawResponse.sourceRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.sourceRevision) ||
    rawResponse.sourceRevision < 1 ||
    typeof rawResponse.originalHandoffCaseRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.originalHandoffCaseRevision) ||
    rawResponse.originalHandoffCaseRevision < 1 ||
    typeof rawResponse.effectiveAlignedCaseRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.effectiveAlignedCaseRevision) ||
    rawResponse.effectiveAlignedCaseRevision <
      rawResponse.originalHandoffCaseRevision ||
    typeof rawResponse.currentHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.currentHumanCaseRevision) ||
    rawResponse.currentHumanCaseRevision <
      rawResponse.effectiveAlignedCaseRevision ||
    typeof rawResponse.currentAlignmentRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.currentAlignmentRevision) ||
    rawResponse.currentAlignmentRevision < 0 ||
    !isValidIsoTimestamp(rawResponse.catalogUpdatedAt) ||
    typeof rawResponse.hasRecordedRightsDecision !== 'boolean' ||
    typeof rawResponse.rightsDecisionInvalidatedByCaseChange !== 'boolean' ||
    typeof rawResponse.requiresFreshRightsReview !== 'boolean'
  ) {
    return null;
  }

  const diff = validateCatalogCaseFourFieldDiffDto(rawResponse.diff);
  const handoff = validateHandoffSafe(rawResponse.handoff, receiptId);
  const catalogDocument = validateCatalogDocumentSafe(
    rawResponse.catalogDocument,
    receiptId
  );
  const humanReviewCase = validateHumanReviewCaseSafe(
    rawResponse.humanReviewCase,
    receiptId
  );

  if (!diff || !handoff || !catalogDocument || !humanReviewCase) {
    return null;
  }

  if (
    humanReviewCase.status !== 'METADATA_RECORDED' ||
    rawResponse.sourceRevision !== handoff.sourceRevision ||
    humanReviewCase.sourceRevision !== rawResponse.sourceRevision ||
    rawResponse.originalHandoffCaseRevision !== handoff.caseRevision ||
    rawResponse.currentHumanCaseRevision !== humanReviewCase.revision ||
    rawResponse.catalogUpdatedAt !== catalogDocument.updatedAt
  ) {
    return null;
  }

  let alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null = null;
  if (rawResponse.alignment !== null) {
    alignment = validateSanitizedCatalogCaseAlignmentDto(
      rawResponse.alignment,
      receiptId
    );
    if (
      !alignment ||
      alignment.sourceRevision !== rawResponse.sourceRevision ||
      alignment.originalHandoffCaseRevision !== handoff.caseRevision ||
      alignment.alignmentRevision !== rawResponse.currentAlignmentRevision ||
      alignment.alignedHumanCaseRevision !==
        rawResponse.effectiveAlignedCaseRevision
    ) {
      return null;
    }
  } else if (
    rawResponse.currentAlignmentRevision !== 0 ||
    rawResponse.effectiveAlignedCaseRevision !== handoff.caseRevision
  ) {
    return null;
  }

  if (!diffMatchesCaseAndCatalog(diff, humanReviewCase, catalogDocument)) {
    return null;
  }

  const expectedAlignmentState: LibraryQuarantineCatalogCaseAlignmentState =
    rawResponse.currentHumanCaseRevision ===
      rawResponse.effectiveAlignedCaseRevision && !diff.hasAnyDifference
      ? 'ALIGNED'
      : 'NEEDS_REALIGNMENT';
  if (rawResponse.alignmentState !== expectedAlignmentState) {
    return null;
  }

  if (!rawResponse.hasRecordedRightsDecision) {
    if (
      rawResponse.recordedRightsDecisionCaseRevision !== null ||
      rawResponse.rightsDecisionInvalidatedByCaseChange !== false ||
      rawResponse.requiresFreshRightsReview !== false
    ) {
      return null;
    }
  } else {
    if (
      typeof rawResponse.recordedRightsDecisionCaseRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.recordedRightsDecisionCaseRevision) ||
      rawResponse.recordedRightsDecisionCaseRevision < 1 ||
      rawResponse.recordedRightsDecisionCaseRevision >
        rawResponse.currentHumanCaseRevision
    ) {
      return null;
    }
    const expectedInvalidated =
      rawResponse.recordedRightsDecisionCaseRevision <
      rawResponse.currentHumanCaseRevision;
    const expectedRequiresFresh =
      expectedInvalidated || rawResponse.alignmentState === 'NEEDS_REALIGNMENT';
    if (
      rawResponse.rightsDecisionInvalidatedByCaseChange !== expectedInvalidated ||
      rawResponse.requiresFreshRightsReview !== expectedRequiresFresh
    ) {
      return null;
    }
  }

  return Object.freeze({
    ok: true as const,
    status: 'READY' as const,
    receiptId,
    documentId: expectedDocumentId,
    alignmentState: rawResponse.alignmentState,
    sourceRevision: rawResponse.sourceRevision,
    originalHandoffCaseRevision: rawResponse.originalHandoffCaseRevision,
    effectiveAlignedCaseRevision: rawResponse.effectiveAlignedCaseRevision,
    currentHumanCaseRevision: rawResponse.currentHumanCaseRevision,
    currentAlignmentRevision: rawResponse.currentAlignmentRevision,
    catalogUpdatedAt: rawResponse.catalogUpdatedAt,
    diff,
    alignment,
    handoff,
    catalogDocument,
    humanReviewCase,
    hasRecordedRightsDecision: rawResponse.hasRecordedRightsDecision,
    recordedRightsDecisionCaseRevision:
      rawResponse.recordedRightsDecisionCaseRevision as number | null,
    rightsDecisionInvalidatedByCaseChange:
      rawResponse.rightsDecisionInvalidatedByCaseChange,
    requiresFreshRightsReview: rawResponse.requiresFreshRightsReview,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

export function validateAlignCatalogCaseResponseDto(
  rawResponse: unknown,
  expectedReceiptId?: string
): AlignLibraryQuarantineCatalogCaseResponseDto | null {
  if (
    !isPlainRecord(rawResponse) ||
    containsForbiddenKeyOrStringDeep(rawResponse)
  ) {
    return null;
  }

  if (
    rawResponse.ok === true &&
    (rawResponse.status === 'ALIGNED' ||
      rawResponse.status === 'ALREADY_ALIGNED')
  ) {
    if (
      !hasExactKeys(rawResponse, ALIGN_SUCCESS_KEYS) ||
      !hasFiveFalseAssuranceFlags(rawResponse)
    ) {
      return null;
    }

    const expectedSaved = rawResponse.status === 'ALIGNED';
    if (
      rawResponse.alignmentOutcome !== rawResponse.status ||
      rawResponse.alignmentSaved !== expectedSaved ||
      rawResponse.alignmentState !== 'ALIGNED'
    ) {
      return null;
    }

    const receiptId = rawResponse.receiptId;
    if (typeof receiptId !== 'string' || !RECEIPT_ID_REGEX.test(receiptId)) {
      return null;
    }
    if (expectedReceiptId !== undefined && receiptId !== expectedReceiptId) {
      return null;
    }

    const expectedDocumentId = deriveQuarantineCatalogDocumentId(receiptId);
    if (rawResponse.documentId !== expectedDocumentId) {
      return null;
    }

    if (
      typeof rawResponse.sourceRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.sourceRevision) ||
      rawResponse.sourceRevision < 1 ||
      typeof rawResponse.originalHandoffCaseRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.originalHandoffCaseRevision) ||
      rawResponse.originalHandoffCaseRevision < 1 ||
      typeof rawResponse.effectiveAlignedCaseRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.effectiveAlignedCaseRevision) ||
      rawResponse.effectiveAlignedCaseRevision <
        rawResponse.originalHandoffCaseRevision ||
      typeof rawResponse.currentHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.currentHumanCaseRevision) ||
      rawResponse.currentHumanCaseRevision !==
        rawResponse.effectiveAlignedCaseRevision ||
      typeof rawResponse.currentAlignmentRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.currentAlignmentRevision) ||
      (rawResponse.status === 'ALIGNED'
        ? rawResponse.currentAlignmentRevision < 1
        : rawResponse.currentAlignmentRevision < 0) ||
      !isValidIsoTimestamp(rawResponse.catalogUpdatedAt) ||
      typeof rawResponse.hasRecordedRightsDecision !== 'boolean' ||
      typeof rawResponse.rightsDecisionInvalidatedByCaseChange !== 'boolean' ||
      typeof rawResponse.requiresFreshRightsReview !== 'boolean'
    ) {
      return null;
    }

    const diff = validateCatalogCaseFourFieldDiffDto(rawResponse.diff);
    const handoff = validateHandoffSafe(rawResponse.handoff, receiptId);
    const catalogDocument = validateCatalogDocumentSafe(
      rawResponse.catalogDocument,
      receiptId
    );
    const humanReviewCase = validateHumanReviewCaseSafe(
      rawResponse.humanReviewCase,
      receiptId
    );

    if (
      !diff ||
      diff.hasAnyDifference !== false ||
      !handoff ||
      !catalogDocument ||
      !humanReviewCase
    ) {
      return null;
    }

    if (
      humanReviewCase.status !== 'METADATA_RECORDED' ||
      rawResponse.sourceRevision !== handoff.sourceRevision ||
      humanReviewCase.sourceRevision !== rawResponse.sourceRevision ||
      rawResponse.originalHandoffCaseRevision !== handoff.caseRevision ||
      rawResponse.currentHumanCaseRevision !== humanReviewCase.revision ||
      rawResponse.catalogUpdatedAt !== catalogDocument.updatedAt
    ) {
      return null;
    }

    let alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null =
      null;
    if (rawResponse.alignment !== null) {
      alignment = validateSanitizedCatalogCaseAlignmentDto(
        rawResponse.alignment,
        receiptId
      );
      if (
        !alignment ||
        alignment.sourceRevision !== rawResponse.sourceRevision ||
        alignment.originalHandoffCaseRevision !== handoff.caseRevision ||
        alignment.alignmentRevision !== rawResponse.currentAlignmentRevision ||
        alignment.alignedHumanCaseRevision !==
          rawResponse.effectiveAlignedCaseRevision
      ) {
        return null;
      }
    } else if (
      rawResponse.status === 'ALIGNED' ||
      rawResponse.currentAlignmentRevision !== 0 ||
      rawResponse.effectiveAlignedCaseRevision !== handoff.caseRevision
    ) {
      return null;
    }

    if (!diffMatchesCaseAndCatalog(diff, humanReviewCase, catalogDocument)) {
      return null;
    }

    if (!rawResponse.hasRecordedRightsDecision) {
      if (
        rawResponse.recordedRightsDecisionCaseRevision !== null ||
        rawResponse.rightsDecisionInvalidatedByCaseChange !== false ||
        rawResponse.requiresFreshRightsReview !== false
      ) {
        return null;
      }
    } else {
      if (
        typeof rawResponse.recordedRightsDecisionCaseRevision !== 'number' ||
        !Number.isSafeInteger(rawResponse.recordedRightsDecisionCaseRevision) ||
        rawResponse.recordedRightsDecisionCaseRevision < 1 ||
        rawResponse.recordedRightsDecisionCaseRevision >
          rawResponse.currentHumanCaseRevision
      ) {
        return null;
      }
      const expectedInvalidated =
        rawResponse.recordedRightsDecisionCaseRevision <
        rawResponse.currentHumanCaseRevision;
      if (
        rawResponse.rightsDecisionInvalidatedByCaseChange !==
          expectedInvalidated ||
        rawResponse.requiresFreshRightsReview !== expectedInvalidated
      ) {
        return null;
      }
    }

    return Object.freeze({
      ok: true as const,
      status: rawResponse.status,
      alignmentOutcome: rawResponse.status,
      alignmentSaved: rawResponse.alignmentSaved,
      receiptId,
      documentId: expectedDocumentId,
      alignmentState: 'ALIGNED' as const,
      sourceRevision: rawResponse.sourceRevision,
      originalHandoffCaseRevision: rawResponse.originalHandoffCaseRevision,
      effectiveAlignedCaseRevision: rawResponse.effectiveAlignedCaseRevision,
      currentHumanCaseRevision: rawResponse.currentHumanCaseRevision,
      currentAlignmentRevision: rawResponse.currentAlignmentRevision,
      catalogUpdatedAt: rawResponse.catalogUpdatedAt,
      diff,
      alignment,
      handoff,
      catalogDocument,
      humanReviewCase,
      hasRecordedRightsDecision: rawResponse.hasRecordedRightsDecision,
      recordedRightsDecisionCaseRevision:
        rawResponse.recordedRightsDecisionCaseRevision as number | null,
      rightsDecisionInvalidatedByCaseChange:
        rawResponse.rightsDecisionInvalidatedByCaseChange,
      requiresFreshRightsReview: rawResponse.requiresFreshRightsReview,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (rawResponse.ok === false && rawResponse.status === 'CONFLICT') {
    if (
      !hasExactKeys(rawResponse, ALIGN_CONFLICT_KEYS) ||
      !hasFiveFalseAssuranceFlags(rawResponse) ||
      rawResponse.alignmentOutcome !== 'NOT_ALIGNED' ||
      rawResponse.alignmentSaved !== false ||
      rawResponse.errorCode !== 'ALIGNMENT_REVISION_CONFLICT' ||
      typeof rawResponse.errorMessage !== 'string' ||
      rawResponse.errorMessage.trim().length === 0
    ) {
      return null;
    }

    const receiptId = rawResponse.receiptId;
    if (typeof receiptId !== 'string' || !RECEIPT_ID_REGEX.test(receiptId)) {
      return null;
    }
    if (expectedReceiptId !== undefined && receiptId !== expectedReceiptId) {
      return null;
    }

    const expectedDocumentId = deriveQuarantineCatalogDocumentId(receiptId);
    if (
      rawResponse.documentId !== expectedDocumentId ||
      typeof rawResponse.currentHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.currentHumanCaseRevision) ||
      rawResponse.currentHumanCaseRevision < 1 ||
      !isValidIsoTimestamp(rawResponse.currentCatalogUpdatedAt) ||
      typeof rawResponse.currentAlignmentRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.currentAlignmentRevision) ||
      rawResponse.currentAlignmentRevision < 0 ||
      typeof rawResponse.effectiveAlignedCaseRevision !== 'number' ||
      !Number.isSafeInteger(rawResponse.effectiveAlignedCaseRevision) ||
      rawResponse.effectiveAlignedCaseRevision < 1 ||
      rawResponse.currentHumanCaseRevision <
        rawResponse.effectiveAlignedCaseRevision
    ) {
      return null;
    }

    const diff = validateCatalogCaseFourFieldDiffDto(rawResponse.diff);
    const catalogDocument = validateCatalogDocumentSafe(
      rawResponse.catalogDocument,
      receiptId
    );
    const humanReviewCase = validateHumanReviewCaseSafe(
      rawResponse.humanReviewCase,
      receiptId
    );
    if (!diff || !catalogDocument || !humanReviewCase) {
      return null;
    }

    if (
      rawResponse.currentHumanCaseRevision !== humanReviewCase.revision ||
      rawResponse.currentCatalogUpdatedAt !== catalogDocument.updatedAt ||
      !diffMatchesCaseAndCatalog(diff, humanReviewCase, catalogDocument)
    ) {
      return null;
    }

    let alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null =
      null;
    if (rawResponse.alignment !== null) {
      alignment = validateSanitizedCatalogCaseAlignmentDto(
        rawResponse.alignment,
        receiptId
      );
      if (
        !alignment ||
        alignment.alignmentRevision !== rawResponse.currentAlignmentRevision ||
        alignment.alignedHumanCaseRevision !==
          rawResponse.effectiveAlignedCaseRevision
      ) {
        return null;
      }
    } else if (rawResponse.currentAlignmentRevision !== 0) {
      return null;
    }

    return Object.freeze({
      ok: false as const,
      status: 'CONFLICT' as const,
      alignmentOutcome: 'NOT_ALIGNED' as const,
      alignmentSaved: false as const,
      errorCode: 'ALIGNMENT_REVISION_CONFLICT' as const,
      errorMessage: rawResponse.errorMessage,
      receiptId,
      documentId: expectedDocumentId,
      currentHumanCaseRevision: rawResponse.currentHumanCaseRevision,
      currentCatalogUpdatedAt: rawResponse.currentCatalogUpdatedAt,
      currentAlignmentRevision: rawResponse.currentAlignmentRevision,
      effectiveAlignedCaseRevision: rawResponse.effectiveAlignedCaseRevision,
      diff,
      alignment,
      catalogDocument,
      humanReviewCase,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  if (
    rawResponse.ok === false &&
    (rawResponse.status === 'HOLD' || rawResponse.status === 'UNKNOWN')
  ) {
    if (
      !hasExactKeys(rawResponse, ALIGN_HOLD_OR_UNKNOWN_KEYS) ||
      !hasFiveFalseAssuranceFlags(rawResponse) ||
      typeof rawResponse.errorCode !== 'string' ||
      rawResponse.errorCode.trim().length === 0 ||
      typeof rawResponse.errorMessage !== 'string' ||
      rawResponse.errorMessage.trim().length === 0
    ) {
      return null;
    }

    if (rawResponse.status === 'UNKNOWN') {
      if (
        rawResponse.alignmentOutcome !== 'UNKNOWN' ||
        rawResponse.alignmentSaved !== null ||
        rawResponse.errorCode !== 'TRANSACTION_COMMIT_UNCERTAIN' ||
        typeof rawResponse.receiptId !== 'string' ||
        !RECEIPT_ID_REGEX.test(rawResponse.receiptId)
      ) {
        return null;
      }
      if (
        expectedReceiptId !== undefined &&
        rawResponse.receiptId !== expectedReceiptId
      ) {
        return null;
      }
      const expectedDocId = deriveQuarantineCatalogDocumentId(
        rawResponse.receiptId
      );
      if (rawResponse.documentId !== expectedDocId) {
        return null;
      }
      return Object.freeze({
        ok: false as const,
        status: 'UNKNOWN' as const,
        alignmentOutcome: 'UNKNOWN' as const,
        alignmentSaved: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
        errorMessage: rawResponse.errorMessage,
        receiptId: rawResponse.receiptId,
        documentId: expectedDocId,
        isSanitized: false as const,
        isVerifiedSafe: false as const,
        isRightsApproved: false as const,
        isPublished: false as const,
        isReadyForPeia: false as const,
      });
    }

    if (
      rawResponse.alignmentOutcome !== 'NOT_ALIGNED' ||
      rawResponse.alignmentSaved !== false
    ) {
      return null;
    }

    const receiptId = rawResponse.receiptId;
    if (
      receiptId !== null &&
      (typeof receiptId !== 'string' || !RECEIPT_ID_REGEX.test(receiptId))
    ) {
      return null;
    }
    if (
      expectedReceiptId !== undefined &&
      RECEIPT_ID_REGEX.test(expectedReceiptId) &&
      receiptId !== null &&
      receiptId !== expectedReceiptId
    ) {
      return null;
    }

    const documentId = rawResponse.documentId;
    if (documentId !== null) {
      if (typeof documentId !== 'string' || !/^qcat-[0-9a-f]{32}$/.test(documentId)) {
        return null;
      }
      if (
        receiptId !== null &&
        documentId !== deriveQuarantineCatalogDocumentId(receiptId)
      ) {
        return null;
      }
    }

    return Object.freeze({
      ok: false as const,
      status: 'HOLD' as const,
      alignmentOutcome: 'NOT_ALIGNED' as const,
      alignmentSaved: false as const,
      errorCode: rawResponse.errorCode,
      errorMessage: rawResponse.errorMessage,
      receiptId,
      documentId,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });
  }

  return null;
}

export function validateGetQuarantineCatalogCaseAlignmentResponseDto(
  raw: unknown,
  expectedReceiptId?: string
): GetLibraryQuarantineCatalogCaseAlignmentResponseDto {
  const validated = validateGetCatalogCaseAlignmentResponseDto(
    raw,
    expectedReceiptId
  );
  if (!validated) {
    throw new Error(
      'RESPONSE_VALIDATION_FAILED: Server response for getQuarantineCatalogCaseAlignment failed strict DTO validation.'
    );
  }
  return validated;
}

export function validateAlignQuarantineCatalogCaseResponseDto(
  raw: unknown,
  expectedReceiptId?: string
): AlignLibraryQuarantineCatalogCaseResponseDto {
  const validated = validateAlignCatalogCaseResponseDto(raw, expectedReceiptId);
  if (!validated) {
    throw new Error(
      'RESPONSE_VALIDATION_FAILED: Server response for alignQuarantineCatalogCase failed strict DTO validation.'
    );
  }
  return validated;
}

function makeClientGetHoldDto(
  receiptId: string | null,
  errorCode: string,
  errorMessage: string
): GetLibraryQuarantineCatalogCaseAlignmentHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && RECEIPT_ID_REGEX.test(receiptId)
      ? receiptId
      : null;
  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    errorCode,
    errorMessage,
    receiptId: safeReceiptId,
    documentId:
      safeReceiptId !== null
        ? deriveQuarantineCatalogDocumentId(safeReceiptId)
        : null,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeClientAlignHoldDto(
  receiptId: string | null,
  errorCode: string,
  errorMessage: string
): AlignLibraryQuarantineCatalogCaseHoldDto {
  const safeReceiptId =
    typeof receiptId === 'string' && RECEIPT_ID_REGEX.test(receiptId)
      ? receiptId
      : null;
  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    alignmentOutcome: 'NOT_ALIGNED' as const,
    alignmentSaved: false as const,
    errorCode,
    errorMessage,
    receiptId: safeReceiptId,
    documentId:
      safeReceiptId !== null
        ? deriveQuarantineCatalogDocumentId(safeReceiptId)
        : null,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function makeClientAlignUnknownDto(
  receiptId: string,
  errorMessage = 'Transactional catalog case alignment commit outcome is uncertain; verify current alignment status before retrying.'
): AlignLibraryQuarantineCatalogCaseUnknownDto {
  const validReceiptId = RECEIPT_ID_REGEX.test(receiptId)
    ? receiptId
    : '0'.repeat(32);
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    alignmentOutcome: 'UNKNOWN' as const,
    alignmentSaved: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
    errorMessage,
    receiptId: validReceiptId,
    documentId: deriveQuarantineCatalogDocumentId(validReceiptId),
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function createDefaultCallableInvoker(): LibraryQuarantineCatalogCaseAlignmentCallableInvoker {
  if (!isFirebaseConfigured || !app || !auth?.currentUser) {
    throw new Error('BACKEND_UNAVAILABLE');
  }
  const functionsInstance = getFunctions(app);
  const callable = httpsCallable<
    LibraryQuarantineCatalogCaseAlignmentCallablePayload,
    unknown
  >(functionsInstance, 'manageLibraryDocuments');
  return async (payload) => {
    const result = await callable(payload);
    return result.data;
  };
}

export async function getQuarantineCatalogCaseAlignmentClient(
  receiptId: string,
  options?: LibraryQuarantineCatalogCaseAlignmentClientOptions
): Promise<GetLibraryQuarantineCatalogCaseAlignmentResponseDto> {
  const safeReceiptId = typeof receiptId === 'string' ? receiptId.trim() : '';

  if (
    !areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(options?.envOverride)
  ) {
    return makeClientGetHoldDto(
      safeReceiptId,
      'FEATURE_NOT_RELEASED',
      'Catalog case alignment is not enabled in this environment.'
    );
  }

  if (
    options?.currentUser !== undefined &&
    !canCurrentAdminAlignQuarantineCatalogDraft(options.currentUser)
  ) {
    return makeClientGetHoldDto(
      safeReceiptId,
      'INSUFFICIENT_PERMISSIONS',
      'Current administrator lacks Library Review and Create permissions for catalog case alignment.'
    );
  }

  if (!RECEIPT_ID_REGEX.test(safeReceiptId)) {
    return makeClientGetHoldDto(
      safeReceiptId,
      'INVALID_RECEIPT_ID',
      'receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }

  if (options?.getAlignmentFn) {
    try {
      const rawResponse = await options.getAlignmentFn(safeReceiptId);
      const validated = validateGetCatalogCaseAlignmentResponseDto(
        rawResponse,
        safeReceiptId
      );
      if (!validated) {
        return makeClientGetHoldDto(
          safeReceiptId,
          'RESPONSE_VALIDATION_FAILED',
          'Server response for getQuarantineCatalogCaseAlignment failed strict DTO validation.'
        );
      }
      return validated;
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : 'Callable getQuarantineCatalogCaseAlignment request failed.';
      return makeClientGetHoldDto(
        safeReceiptId,
        'CALLABLE_REQUEST_FAILED',
        message
      );
    }
  }

  const payload: GetQuarantineCatalogCaseAlignmentCallablePayload =
    Object.freeze({
      action: 'getQuarantineCatalogCaseAlignment',
      receiptId: safeReceiptId,
    });

  try {
    const invoker = options?.invokeCallable ?? createDefaultCallableInvoker();
    const rawResponse = await invoker(payload);
    const validated = validateGetCatalogCaseAlignmentResponseDto(
      rawResponse,
      safeReceiptId
    );
    if (!validated) {
      return makeClientGetHoldDto(
        safeReceiptId,
        'RESPONSE_VALIDATION_FAILED',
        'Server response for getQuarantineCatalogCaseAlignment failed strict DTO validation.'
      );
    }
    return validated;
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.message.trim().length > 0
        ? err.message
        : 'Callable getQuarantineCatalogCaseAlignment request failed.';
    const errorCode =
      message === 'BACKEND_UNAVAILABLE'
        ? 'BACKEND_UNAVAILABLE'
        : 'CALLABLE_REQUEST_FAILED';
    return makeClientGetHoldDto(safeReceiptId, errorCode, message);
  }
}

export interface AlignQuarantineCatalogCaseClientRequest {
  readonly receiptId: string;
  readonly expectedCaseRevision?: number;
  readonly expectedHandoffCaseRevision?: number;
  readonly expectedCatalogUpdatedAt?: string;
  readonly expectedAlignmentRevision?: number;
  readonly confirmedApplyCaseMetadata?: boolean;
  readonly hasUnsavedCaseEdits?: boolean;
}

export async function alignQuarantineCatalogCaseClient(
  request: AlignQuarantineCatalogCaseClientRequest,
  options?: LibraryQuarantineCatalogCaseAlignmentClientOptions
): Promise<AlignLibraryQuarantineCatalogCaseResponseDto> {
  const safeReceiptId =
    typeof request?.receiptId === 'string' ? request.receiptId.trim() : '';

  if (
    !areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(options?.envOverride)
  ) {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'FEATURE_NOT_RELEASED',
      'Catalog case alignment is not enabled in this environment.'
    );
  }

  if (
    options?.currentUser !== undefined &&
    !canCurrentAdminAlignQuarantineCatalogDraft(options.currentUser)
  ) {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'INSUFFICIENT_PERMISSIONS',
      'Current administrator lacks Library Review and Create permissions for catalog case alignment.'
    );
  }

  if (request?.hasUnsavedCaseEdits === true) {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'UNSAVED_CASE_EDITS_PRESENT',
      'Save or discard unsaved human review case edits before aligning the catalog draft.'
    );
  }

  if (request?.confirmedApplyCaseMetadata !== true) {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'CONFIRMATION_REQUIRED',
      'Explicit human confirmation is required before applying case metadata to the catalog draft.'
    );
  }

  if (!RECEIPT_ID_REGEX.test(safeReceiptId)) {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'INVALID_RECEIPT_ID',
      'receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }

  if (
    typeof request.expectedCaseRevision !== 'number' ||
    !Number.isSafeInteger(request.expectedCaseRevision) ||
    request.expectedCaseRevision < 1
  ) {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'INVALID_EXPECTED_CASE_REVISION',
      'expectedCaseRevision must be a positive safe integer (>= 1).'
    );
  }

  if (
    typeof request.expectedCatalogUpdatedAt !== 'string' ||
    !isValidIsoTimestamp(request.expectedCatalogUpdatedAt)
  ) {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'INVALID_EXPECTED_CATALOG_UPDATED_AT',
      'expectedCatalogUpdatedAt must be a valid UTC ISO-8601 timestamp.'
    );
  }

  if (
    typeof request.expectedAlignmentRevision !== 'number' ||
    !Number.isSafeInteger(request.expectedAlignmentRevision) ||
    request.expectedAlignmentRevision < 0
  ) {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'INVALID_EXPECTED_ALIGNMENT_REVISION',
      'expectedAlignmentRevision must be a non-negative safe integer (>= 0).'
    );
  }

  if (options?.alignCaseFn) {
    try {
      const rawResponse = await options.alignCaseFn(request);
      const validated = validateAlignCatalogCaseResponseDto(
        rawResponse,
        safeReceiptId
      );
      if (!validated) {
        return makeClientAlignUnknownDto(
          safeReceiptId,
          'Server response for alignQuarantineCatalogCase failed strict DTO validation after dispatch; commit outcome is uncertain.'
        );
      }
      return validated;
    } catch (err: unknown) {
      return makeClientAlignUnknownDto(
        safeReceiptId,
        err instanceof Error && err.message
          ? err.message
          : 'Alignment request outcome uncertain.'
      );
    }
  }

  let invoker: LibraryQuarantineCatalogCaseAlignmentCallableInvoker;
  try {
    invoker = options?.invokeCallable ?? createDefaultCallableInvoker();
  } catch {
    return makeClientAlignHoldDto(
      safeReceiptId,
      'BACKEND_UNAVAILABLE',
      CASE_ALIGNMENT_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE
    );
  }

  const payload: AlignQuarantineCatalogCaseCallablePayload = Object.freeze({
    action: 'alignQuarantineCatalogCase',
    receiptId: safeReceiptId,
    expectedCaseRevision: request.expectedCaseRevision,
    expectedCatalogUpdatedAt: request.expectedCatalogUpdatedAt,
    expectedAlignmentRevision: request.expectedAlignmentRevision,
    confirmation: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
  });

  // Once the mutation request is dispatched over the network, any transport/timeout
  // rejection or malformed response MUST be classified as UNKNOWN (commit uncertain)
  // rather than NOT_ALIGNED, requiring a GET-only verification step.
  try {
    const rawResponse = await invoker(payload);
    const validated = validateAlignCatalogCaseResponseDto(
      rawResponse,
      safeReceiptId
    );
    if (!validated) {
      return makeClientAlignUnknownDto(
        safeReceiptId,
        'Server response for alignQuarantineCatalogCase failed strict DTO validation after dispatch; commit outcome is uncertain.'
      );
    }
    return validated;
  } catch {
    return makeClientAlignUnknownDto(
      safeReceiptId,
      'Network or callable failure after alignQuarantineCatalogCase dispatch; commit outcome is uncertain.'
    );
  }
}

export type LibraryQuarantineCatalogCaseAlignmentPanelPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'aligning'
  | 'hold'
  | 'conflict'
  | 'uncertain';

export interface LibraryQuarantineCatalogCaseAlignmentPanelState {
  readonly phase: LibraryQuarantineCatalogCaseAlignmentPanelPhase;
  readonly receiptId: string | null;
  readonly savedCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly snapshot: GetLibraryQuarantineCatalogCaseAlignmentSuccessDto | null;
  readonly confirmedApplyCaseMetadata: boolean;
  readonly hasUnsavedCaseEdits: boolean;
  readonly inFlight: boolean;
  readonly lastAlignmentOutcome: LibraryQuarantineCatalogCaseAlignmentOutcome | null;
  readonly lastAlignOutcome?: LibraryQuarantineCatalogCaseAlignmentOutcome | null;
  readonly lastAlignmentSaved: boolean | null;
  readonly rightsInvalidatedNotice: boolean;
  readonly hasDiff?: boolean;
  readonly alignError?: string | null;
  readonly holdState: {
    readonly errorCode: string;
    readonly errorMessage: string;
  } | null;
  readonly conflictState: AlignLibraryQuarantineCatalogCaseConflictDto | null;
  readonly uncertainState: {
    readonly errorCode: string;
    readonly errorMessage: string;
  } | null;
}

export class LibraryQuarantineCatalogCaseAlignmentPanelController {
  private state: LibraryQuarantineCatalogCaseAlignmentPanelState;
  private readonly options: LibraryQuarantineCatalogCaseAlignmentClientOptions;
  private readonly listeners: Set<
    (state: LibraryQuarantineCatalogCaseAlignmentPanelState) => void
  > = new Set();
  private requestEpoch = 0;

  constructor(
    currentUserOrOptions?:
      | AdminUser
      | LibraryQuarantineCatalogCaseAlignmentClientOptions
      | null,
    maybeOptions?: LibraryQuarantineCatalogCaseAlignmentClientOptions
  ) {
    if (
      currentUserOrOptions &&
      typeof currentUserOrOptions === 'object' &&
      'role' in currentUserOrOptions
    ) {
      this.options = {
        currentUser: currentUserOrOptions as AdminUser,
        ...(maybeOptions || {}),
      };
    } else {
      this.options =
        (currentUserOrOptions as LibraryQuarantineCatalogCaseAlignmentClientOptions) ||
        maybeOptions ||
        {};
    }
    if (this.options.caseAlignmentEnabled === true && !this.options.envOverride) {
      this.options = {
        ...this.options,
        envOverride: {
          VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
          VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
          VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
          [VITE_LIBRARY_CASE_ALIGNMENT_RELEASE_FLAG]: 'true',
        },
      };
    }
    this.state = this.createInitialState();
  }

  public isCaseAlignmentEnabled(): boolean {
    if (this.options.caseAlignmentEnabled !== undefined) {
      return this.options.caseAlignmentEnabled;
    }
    return areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(
      this.options.envOverride
    );
  }

  public getOptions(): LibraryQuarantineCatalogCaseAlignmentClientOptions {
    return this.options;
  }

  private createInitialState(): LibraryQuarantineCatalogCaseAlignmentPanelState {
    return Object.freeze({
      phase: 'idle',
      receiptId: null,
      savedCase: null,
      snapshot: null,
      confirmedApplyCaseMetadata: false,
      hasUnsavedCaseEdits: false,
      inFlight: false,
      lastAlignmentOutcome: null,
      lastAlignOutcome: null,
      lastAlignmentSaved: null,
      rightsInvalidatedNotice: false,
      hasDiff: false,
      alignError: null,
      holdState: null,
      conflictState: null,
      uncertainState: null,
    });
  }

  public getState(): LibraryQuarantineCatalogCaseAlignmentPanelState {
    return this.state;
  }

  public getSnapshot(): LibraryQuarantineCatalogCaseAlignmentPanelState {
    return this.getState();
  }

  public setConfirmReconciliation(confirmed: boolean): void {
    this.setConfirmedApplyCaseMetadata(confirmed);
  }

  public async alignCase(): Promise<AlignLibraryQuarantineCatalogCaseResponseDto | null> {
    return this.alignCatalogDraft();
  }

  public subscribe(
    listener: (state: LibraryQuarantineCatalogCaseAlignmentPanelState) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(
    next: LibraryQuarantineCatalogCaseAlignmentPanelState
  ): void {
    this.state = Object.freeze(next);
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public reset(): void {
    this.requestEpoch += 1;
    this.setState(this.createInitialState());
  }

  private isUncertainLatched(): boolean {
    return (
      this.state.phase === 'uncertain' || this.state.uncertainState !== null
    );
  }

  private isConflictLatched(): boolean {
    return (
      !this.isUncertainLatched() &&
      (this.state.phase === 'conflict' || this.state.conflictState !== null)
    );
  }

  private static appendVerificationDiagnostic(
    baseMessage: string,
    errorCode: string,
    errorMessage: string
  ): string {
    const separator = ' | Verification GET failed [';
    const existingIdx = baseMessage.indexOf(separator);
    const cleanBase =
      existingIdx >= 0 ? baseMessage.slice(0, existingIdx) : baseMessage;
    return `${cleanBase}${separator}${errorCode}]: ${errorMessage}`;
  }

  public setConfirmedApplyCaseMetadata(confirmed: boolean): void {
    if (
      this.state.inFlight ||
      this.isUncertainLatched() ||
      this.isConflictLatched()
    ) {
      return;
    }
    const nextConfirmed = confirmed === true;
    if (nextConfirmed && this.state.phase !== 'ready') {
      if (
        this.state.phase === 'hold' &&
        this.state.holdState?.errorCode === 'CONFIRMATION_REQUIRED' &&
        this.state.snapshot !== null
      ) {
        this.setState({
          ...this.state,
          phase: 'ready',
          confirmedApplyCaseMetadata: true,
          alignError: null,
          holdState: null,
        });
      }
      return;
    }
    this.setState({
      ...this.state,
      confirmedApplyCaseMetadata: nextConfirmed,
      alignError: nextConfirmed ? null : this.state.alignError,
    });
  }

  public setHasUnsavedCaseEdits(hasUnsavedCaseEdits: boolean): void {
    const dirty = hasUnsavedCaseEdits === true;
    const canClearUnsavedHold =
      !dirty &&
      !this.isUncertainLatched() &&
      !this.isConflictLatched() &&
      this.state.phase === 'hold' &&
      this.state.holdState?.errorCode === 'UNSAVED_CASE_EDITS_PRESENT';

    this.setState({
      ...this.state,
      hasUnsavedCaseEdits: dirty,
      ...(dirty ? { confirmedApplyCaseMetadata: false } : {}),
      ...(canClearUnsavedHold
        ? {
            phase: this.state.snapshot ? 'ready' : this.state.phase,
            holdState: null,
          }
        : {}),
    });
  }

  public async openPanelForCase(
    savedCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null,
    options?: { readonly hasUnsavedCaseEdits?: boolean }
  ): Promise<LibraryQuarantineCatalogCaseAlignmentPanelState> {
    if (!savedCase || savedCase.status !== 'METADATA_RECORDED') {
      this.reset();
      return this.state;
    }

    if (
      !areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(
        this.options.envOverride
      ) ||
      (this.options.currentUser !== undefined &&
        !canCurrentAdminAlignQuarantineCatalogDraft(this.options.currentUser))
    ) {
      this.reset();
      return this.state;
    }

    if (this.state.inFlight && this.state.receiptId === savedCase.receiptId) {
      return this.state;
    }

    if (
      this.state.receiptId === savedCase.receiptId &&
      (this.isUncertainLatched() || this.isConflictLatched())
    ) {
      if (options?.hasUnsavedCaseEdits !== undefined) {
        this.setHasUnsavedCaseEdits(options.hasUnsavedCaseEdits);
      }
      await this.verifyAlignmentStatus();
      return this.state;
    }

    const epoch = ++this.requestEpoch;
    const receiptId = savedCase.receiptId;
    const hasUnsavedCaseEdits =
      options?.hasUnsavedCaseEdits ?? this.state.hasUnsavedCaseEdits;

    this.setState({
      phase: 'loading',
      receiptId,
      savedCase,
      snapshot: null,
      confirmedApplyCaseMetadata: false,
      hasUnsavedCaseEdits,
      inFlight: true,
      lastAlignmentOutcome: null,
      lastAlignOutcome: null,
      lastAlignmentSaved: null,
      rightsInvalidatedNotice: false,
      hasDiff: false,
      alignError: null,
      holdState: null,
      conflictState: null,
      uncertainState: null,
    });

    let response: GetLibraryQuarantineCatalogCaseAlignmentResponseDto;
    try {
      response = await getQuarantineCatalogCaseAlignmentClient(
        receiptId,
        this.options
      );
    } catch (err: unknown) {
      response = makeClientGetHoldDto(
        receiptId,
        'CALLABLE_REQUEST_FAILED',
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : 'Callable getQuarantineCatalogCaseAlignment request failed.'
      );
    }

    if (epoch !== this.requestEpoch || this.state.receiptId !== receiptId) {
      return this.state;
    }

    if (!response.ok || response.receiptId !== receiptId) {
      const errorCode = !response.ok
        ? response.errorCode
        : 'RESPONSE_VALIDATION_FAILED';
      const errorMessage = !response.ok
        ? response.errorMessage
        : 'Server response receiptId did not match active receiptId.';
      this.setState({
        ...this.state,
        phase: 'hold',
        inFlight: false,
        holdState: Object.freeze({
          errorCode,
          errorMessage,
        }),
      });
      return this.state;
    }

    this.setState({
      ...this.state,
      phase: 'ready',
      savedCase: response.humanReviewCase,
      snapshot: response,
      confirmedApplyCaseMetadata: false,
      hasDiff:
        response.diff.hasAnyDifference ||
        response.alignmentState === 'NEEDS_REALIGNMENT' ||
        response.currentHumanCaseRevision !==
          response.effectiveAlignedCaseRevision,
      inFlight: false,
      rightsInvalidatedNotice:
        response.requiresFreshRightsReview ||
        response.rightsDecisionInvalidatedByCaseChange,
      holdState: null,
      conflictState: null,
      uncertainState: null,
    });

    return this.state;
  }

  public async alignCatalogDraft(): Promise<AlignLibraryQuarantineCatalogCaseResponseDto | null> {
    if (this.state.inFlight) {
      return null;
    }

    if (
      this.isUncertainLatched() ||
      this.isConflictLatched() ||
      (this.state.phase !== 'ready' &&
        !(
          this.state.phase === 'hold' &&
          (this.state.holdState?.errorCode === 'CONFIRMATION_REQUIRED' ||
            this.state.holdState?.errorCode === 'UNSAVED_CASE_EDITS_PRESENT')
        ))
    ) {
      return null;
    }

    const {
      receiptId,
      snapshot,
      confirmedApplyCaseMetadata,
      hasUnsavedCaseEdits,
    } = this.state;

    if (!receiptId || !snapshot) {
      return null;
    }

    if (hasUnsavedCaseEdits) {
      const holdDto = makeClientAlignHoldDto(
        receiptId,
        'UNSAVED_CASE_EDITS_PRESENT',
        'Save or discard unsaved human review case edits before aligning the catalog draft.'
      );
      this.setState({
        ...this.state,
        phase: 'hold',
        holdState: Object.freeze({
          errorCode: holdDto.errorCode,
          errorMessage: holdDto.errorMessage,
        }),
      });
      return holdDto;
    }

    if (!confirmedApplyCaseMetadata) {
      const holdDto = makeClientAlignHoldDto(
        receiptId,
        'CONFIRMATION_REQUIRED',
        'Explicit human confirmation is required before applying case metadata to the catalog draft.'
      );
      this.setState({
        ...this.state,
        phase: 'hold',
        alignError:
          CASE_ALIGNMENT_CLIENT_SAFE_ERRORS.UNCONFIRMED_RECONCILIATION,
        holdState: Object.freeze({
          errorCode: holdDto.errorCode,
          errorMessage: holdDto.errorMessage,
        }),
      });
      return null;
    }

    const expectedHandoffCaseRevision = snapshot.originalHandoffCaseRevision;
    const expectedCaseRevision = snapshot.currentHumanCaseRevision;
    const expectedCatalogUpdatedAt = snapshot.catalogUpdatedAt;
    const expectedAlignmentRevision = snapshot.currentAlignmentRevision;

    if (
      typeof expectedCaseRevision !== 'number' ||
      !Number.isSafeInteger(expectedCaseRevision) ||
      expectedCaseRevision < 1 ||
      !isValidIsoTimestamp(expectedCatalogUpdatedAt) ||
      typeof expectedAlignmentRevision !== 'number' ||
      !Number.isSafeInteger(expectedAlignmentRevision) ||
      expectedAlignmentRevision < 0
    ) {
      const holdDto = makeClientAlignHoldDto(
        receiptId,
        'INVALID_PAYLOAD',
        CASE_ALIGNMENT_CLIENT_SAFE_ERRORS.INVALID_PAYLOAD
      );
      this.setState({
        ...this.state,
        phase: 'hold',
        inFlight: false,
        holdState: Object.freeze({
          errorCode: holdDto.errorCode,
          errorMessage: holdDto.errorMessage,
        }),
      });
      return holdDto;
    }

    const epoch = ++this.requestEpoch;
    this.setState({
      ...this.state,
      phase: 'aligning',
      inFlight: true,
      holdState: null,
      conflictState: null,
      uncertainState: null,
    });

    try {
      const response = await alignQuarantineCatalogCaseClient(
        {
          receiptId,
          expectedCaseRevision,
          expectedHandoffCaseRevision,
          expectedCatalogUpdatedAt,
          expectedAlignmentRevision,
          confirmedApplyCaseMetadata: true,
          hasUnsavedCaseEdits: false,
        },
        this.options
      );

      if (epoch !== this.requestEpoch || this.state.receiptId !== receiptId) {
        return response;
      }

      if (response.ok) {
        const updatedSnapshot: GetLibraryQuarantineCatalogCaseAlignmentSuccessDto =
          Object.freeze({
            ok: true as const,
            status: 'READY' as const,
            receiptId: response.receiptId,
            documentId: response.documentId,
            alignmentState: 'ALIGNED' as const,
            sourceRevision: response.sourceRevision,
            originalHandoffCaseRevision: response.originalHandoffCaseRevision,
            effectiveAlignedCaseRevision: response.effectiveAlignedCaseRevision,
            currentHumanCaseRevision: response.currentHumanCaseRevision,
            currentAlignmentRevision: response.currentAlignmentRevision,
            catalogUpdatedAt: response.catalogUpdatedAt,
            diff: response.diff,
            alignment: response.alignment,
            handoff: response.handoff,
            catalogDocument: response.catalogDocument,
            humanReviewCase: response.humanReviewCase,
            hasRecordedRightsDecision: response.hasRecordedRightsDecision,
            recordedRightsDecisionCaseRevision:
              response.recordedRightsDecisionCaseRevision,
            rightsDecisionInvalidatedByCaseChange:
              response.rightsDecisionInvalidatedByCaseChange,
            requiresFreshRightsReview: response.requiresFreshRightsReview,
            isSanitized: false as const,
            isVerifiedSafe: false as const,
            isRightsApproved: false as const,
            isPublished: false as const,
            isReadyForPeia: false as const,
          });

        this.setState({
          ...this.state,
          phase: 'ready',
          savedCase: response.humanReviewCase,
          snapshot: updatedSnapshot,
          confirmedApplyCaseMetadata: false,
          inFlight: false,
          lastAlignmentOutcome: response.alignmentOutcome,
          lastAlignOutcome: response.alignmentOutcome,
          lastAlignmentSaved: response.alignmentSaved,
          alignError: null,
          hasDiff: false,
          rightsInvalidatedNotice:
            response.rightsDecisionInvalidatedByCaseChange ||
            response.requiresFreshRightsReview,
          holdState: null,
          conflictState: null,
          uncertainState: null,
        });
        return response;
      }

      if (response.status === 'CONFLICT') {
        const conflictAlignmentState: LibraryQuarantineCatalogCaseAlignmentState =
          response.currentHumanCaseRevision ===
            response.effectiveAlignedCaseRevision &&
          !response.diff.hasAnyDifference
            ? 'ALIGNED'
            : 'NEEDS_REALIGNMENT';
        const rightsDecisionInvalidated =
          snapshot.hasRecordedRightsDecision &&
          snapshot.recordedRightsDecisionCaseRevision !== null &&
          snapshot.recordedRightsDecisionCaseRevision <
            response.currentHumanCaseRevision;
        const requiresFreshRights =
          snapshot.hasRecordedRightsDecision &&
          (rightsDecisionInvalidated ||
            conflictAlignmentState === 'NEEDS_REALIGNMENT');

        const reconciledSnapshot: GetLibraryQuarantineCatalogCaseAlignmentSuccessDto =
          Object.freeze({
            ...snapshot,
            alignmentState: conflictAlignmentState,
            currentAlignmentRevision: response.currentAlignmentRevision,
            effectiveAlignedCaseRevision: response.effectiveAlignedCaseRevision,
            currentHumanCaseRevision: response.currentHumanCaseRevision,
            catalogUpdatedAt: response.currentCatalogUpdatedAt,
            rightsDecisionInvalidatedByCaseChange: rightsDecisionInvalidated,
            requiresFreshRightsReview: requiresFreshRights,
            diff: response.diff,
            alignment: response.alignment,
            catalogDocument: response.catalogDocument,
            humanReviewCase: response.humanReviewCase,
          });

        this.setState({
          ...this.state,
          phase: 'conflict',
          savedCase: response.humanReviewCase,
          snapshot: reconciledSnapshot,
          confirmedApplyCaseMetadata: false,
          inFlight: false,
          lastAlignmentOutcome: 'NOT_ALIGNED',
          lastAlignOutcome: 'NOT_ALIGNED',
          lastAlignmentSaved: false,
          hasDiff:
            response.diff.hasAnyDifference ||
            conflictAlignmentState === 'NEEDS_REALIGNMENT',
          rightsInvalidatedNotice: requiresFreshRights,
          conflictState: response,
          holdState: null,
          uncertainState: null,
        });
        return response;
      }

      if (response.status === 'UNKNOWN') {
        this.setState({
          ...this.state,
          phase: 'uncertain',
          confirmedApplyCaseMetadata: false,
          inFlight: false,
          lastAlignmentOutcome: 'UNKNOWN',
          lastAlignOutcome: 'UNKNOWN',
          lastAlignmentSaved: null,
          uncertainState: Object.freeze({
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
          }),
          holdState: null,
          conflictState: null,
        });
        return null;
      }

      this.setState({
        ...this.state,
        phase: 'hold',
        confirmedApplyCaseMetadata: false,
        inFlight: false,
        lastAlignmentOutcome: 'NOT_ALIGNED',
        lastAlignOutcome: 'NOT_ALIGNED',
        lastAlignmentSaved: false,
        holdState: Object.freeze({
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
        }),
        conflictState: null,
        uncertainState: null,
      });
      return response;
    } catch (err: unknown) {
      if (epoch !== this.requestEpoch || this.state.receiptId !== receiptId) {
        return null;
      }
      this.setState({
        ...this.state,
        phase: 'uncertain',
        confirmedApplyCaseMetadata: false,
        inFlight: false,
        lastAlignmentOutcome: 'UNKNOWN',
        lastAlignOutcome: 'UNKNOWN',
        lastAlignmentSaved: null,
        alignError: null,
        uncertainState: Object.freeze({
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
          errorMessage:
            err instanceof Error && err.message
              ? err.message
              : 'Network transport failure. Transaction commit state is uncertain.',
        }),
        holdState: null,
        conflictState: null,
      });
      return null;
    }
  }

  public async verifyAlignmentStatus(): Promise<GetLibraryQuarantineCatalogCaseAlignmentResponseDto | null> {
    if (this.state.inFlight || !this.state.receiptId) {
      return null;
    }

    const epoch = ++this.requestEpoch;
    const receiptId = this.state.receiptId;
    const wasUncertain = this.isUncertainLatched();
    const previousUncertainState = this.state.uncertainState;
    const wasConflict = this.isConflictLatched();
    const previousConflictState = this.state.conflictState;

    this.setState({
      ...this.state,
      phase: wasUncertain
        ? 'uncertain'
        : wasConflict
          ? 'conflict'
          : 'loading',
      confirmedApplyCaseMetadata: false,
      inFlight: true,
      holdState: null,
      conflictState: wasConflict ? previousConflictState : null,
      uncertainState: wasUncertain ? previousUncertainState : null,
    });

    let response: GetLibraryQuarantineCatalogCaseAlignmentResponseDto;
    try {
      response = await getQuarantineCatalogCaseAlignmentClient(
        receiptId,
        this.options
      );
    } catch (err: unknown) {
      response = makeClientGetHoldDto(
        receiptId,
        'CALLABLE_REQUEST_FAILED',
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : 'Callable getQuarantineCatalogCaseAlignment request failed.'
      );
    }

    if (epoch !== this.requestEpoch || this.state.receiptId !== receiptId) {
      return response;
    }

    if (!response.ok || response.receiptId !== receiptId) {
      const failureCode = !response.ok
        ? response.errorCode
        : 'RESPONSE_VALIDATION_FAILED';
      const failureMessage = !response.ok
        ? response.errorMessage
        : 'Server response receiptId did not match active receiptId.';
      const latestHoldState = Object.freeze({
        errorCode: failureCode,
        errorMessage: failureMessage,
      });

      if (wasUncertain) {
        const baseUncertainMessage =
          previousUncertainState?.errorMessage ??
          CASE_ALIGNMENT_CLIENT_SAFE_ERRORS.TRANSACTION_COMMIT_UNCERTAIN;
        this.setState({
          ...this.state,
          phase: 'uncertain',
          confirmedApplyCaseMetadata: false,
          inFlight: false,
          lastAlignmentOutcome: 'UNKNOWN',
          lastAlignOutcome: 'UNKNOWN',
          lastAlignmentSaved: null,
          holdState: latestHoldState,
          conflictState: null,
          uncertainState: Object.freeze({
            errorCode:
              previousUncertainState?.errorCode ??
              'TRANSACTION_COMMIT_UNCERTAIN',
            errorMessage:
              LibraryQuarantineCatalogCaseAlignmentPanelController.appendVerificationDiagnostic(
                baseUncertainMessage,
                failureCode,
                failureMessage
              ),
          }),
        });
        return response;
      }

      if (wasConflict && previousConflictState) {
        const updatedConflictState: AlignLibraryQuarantineCatalogCaseConflictDto =
          Object.freeze({
            ...previousConflictState,
            errorMessage:
              LibraryQuarantineCatalogCaseAlignmentPanelController.appendVerificationDiagnostic(
                previousConflictState.errorMessage,
                failureCode,
                failureMessage
              ),
          });
        this.setState({
          ...this.state,
          phase: 'conflict',
          confirmedApplyCaseMetadata: false,
          inFlight: false,
          lastAlignmentOutcome: 'NOT_ALIGNED',
          lastAlignOutcome: 'NOT_ALIGNED',
          lastAlignmentSaved: false,
          holdState: latestHoldState,
          conflictState: updatedConflictState,
          uncertainState: null,
        });
        return response;
      }

      this.setState({
        ...this.state,
        phase: 'hold',
        confirmedApplyCaseMetadata: false,
        inFlight: false,
        holdState: latestHoldState,
        conflictState: null,
        uncertainState: null,
      });
      return response;
    }

    this.setState({
      ...this.state,
      phase: 'ready',
      savedCase: response.humanReviewCase,
      snapshot: response,
      confirmedApplyCaseMetadata: false,
      hasDiff:
        response.diff.hasAnyDifference ||
        response.alignmentState === 'NEEDS_REALIGNMENT' ||
        response.currentHumanCaseRevision !==
          response.effectiveAlignedCaseRevision,
      inFlight: false,
      alignError: null,
      rightsInvalidatedNotice:
        response.requiresFreshRightsReview ||
        response.rightsDecisionInvalidatedByCaseChange,
      holdState: null,
      conflictState: null,
      uncertainState: null,
    });

    return response;
  }
}

export type GetQuarantineCatalogCaseAlignmentResponseDto =
  GetLibraryQuarantineCatalogCaseAlignmentResponseDto;
export type AlignQuarantineCatalogCaseResponseDto =
  AlignLibraryQuarantineCatalogCaseResponseDto;

export const LibraryQuarantineCatalogCaseAlignmentClient = Object.freeze({
  getQuarantineCatalogCaseAlignment: getQuarantineCatalogCaseAlignmentClient,
  alignQuarantineCatalogCase: alignQuarantineCatalogCaseClient,
  areReleaseFlagsEnabled: areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled,
  canCurrentAdminAlign: canCurrentAdminAlignQuarantineCatalogDraft,
  computeFourFieldDiff: computeClientCatalogCaseFourFieldDiff,
});
