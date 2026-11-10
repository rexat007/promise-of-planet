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
import type {
  SanitizedLibraryQuarantineCatalogDocumentDto,
  SanitizedLibraryQuarantineCatalogHandoffDto,
} from './libraryQuarantineCatalogHandoffClient';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from './libraryQuarantineHumanReviewClient';

export const LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL =
  'CONFIRM_ALIGN_CASE_METADATA_TO_CATALOG_DRAFT' as const;
export type LibraryQuarantineCatalogCaseAlignmentConfirmationLiteral =
  typeof LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL;

export const VITE_LIBRARY_CASE_ALIGNMENT_RELEASE_FLAG =
  'VITE_LIBRARY_CASE_ALIGNMENT_ENABLED' as const;
export const LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR =
  VITE_LIBRARY_CASE_ALIGNMENT_RELEASE_FLAG;
export const isLibraryQuarantineCatalogCaseAlignmentEnabled =
  areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled;
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

export type LibraryQuarantineCatalogCaseAlignmentStatus =
  | 'NOT_HANDED_OFF'
  | 'ALIGNED'
  | 'NEEDS_REALIGNMENT';

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
  readonly titleAr: LibraryQuarantineCatalogCaseFieldComparisonDto;
  readonly titleEn: LibraryQuarantineCatalogCaseFieldComparisonDto;
  readonly summaryAr: LibraryQuarantineCatalogCaseFieldComparisonDto;
  readonly summaryEn: LibraryQuarantineCatalogCaseFieldComparisonDto;
  readonly changedFieldNames: readonly LibraryQuarantineCatalogCaseFourFieldKey[];
  readonly hasAnyChange: boolean;
  readonly allAligned: boolean;
  readonly comparedCaseRevision: number;
  readonly comparedCatalogUpdatedAt: string;
}

export interface SanitizedLibraryQuarantineCatalogCaseAlignmentDto {
  readonly schemaVersion: 1;
  readonly alignmentId: string;
  readonly receiptId: string;
  readonly draftId: string;
  readonly caseId: string;
  readonly handoffId: string;
  readonly catalogDocumentId: string;
  readonly alignmentRevision: number;
  readonly originalHandoffCaseRevision: number;
  readonly previousAlignedCaseRevision: number;
  readonly alignedCaseRevision: number;
  readonly alignedCaseUpdatedAt: string;
  readonly previousCatalogUpdatedAt: string;
  readonly alignedCatalogUpdatedAt: string;
  readonly changedFieldNames: readonly LibraryQuarantineCatalogCaseFourFieldKey[];
  readonly rightsDecisionInvalidatedByCaseChange: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GetLibraryQuarantineCatalogCaseAlignmentSuccessDto {
  readonly ok: true;
  readonly status: 'OK';
  readonly receiptId: string;
  readonly handoffExists: boolean;
  readonly alignmentStatus: LibraryQuarantineCatalogCaseAlignmentStatus;
  readonly currentAlignmentRevision: number;
  readonly originalHandoffCaseRevision: number | null;
  readonly effectiveAlignedCaseRevision: number | null;
  readonly currentHumanCaseRevision: number | null;
  readonly currentCatalogUpdatedAt: string | null;
  readonly requiresCaseRealignment: boolean;
  readonly hasSavedRightsDecision: boolean;
  readonly rightsDecisionIsCurrentForCase: boolean;
  readonly requiresFreshRightsReview: boolean;
  readonly diff: LibraryQuarantineCatalogCaseFourFieldDiffDto | null;
  readonly alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto | null;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto | null;
}

export interface GetLibraryQuarantineCatalogCaseAlignmentHoldDto {
  readonly ok: false;
  readonly status: 'HOLD' | 'UNKNOWN';
  readonly receiptId: string;
  readonly handoffExists: null;
  readonly alignmentStatus: null;
  readonly currentAlignmentRevision: null;
  readonly originalHandoffCaseRevision: null;
  readonly effectiveAlignedCaseRevision: null;
  readonly currentHumanCaseRevision: null;
  readonly currentCatalogUpdatedAt: null;
  readonly requiresCaseRealignment: null;
  readonly hasSavedRightsDecision: null;
  readonly rightsDecisionIsCurrentForCase: null;
  readonly requiresFreshRightsReview: null;
  readonly diff: null;
  readonly alignment: null;
  readonly handoff: null;
  readonly catalogDocument: null;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export type GetLibraryQuarantineCatalogCaseAlignmentResponseDto =
  | GetLibraryQuarantineCatalogCaseAlignmentSuccessDto
  | GetLibraryQuarantineCatalogCaseAlignmentHoldDto;

export interface AlignLibraryQuarantineCatalogCaseSuccessDto {
  readonly ok: true;
  readonly status: 'OK';
  readonly alignmentOutcome: 'ALIGNED' | 'ALREADY_ALIGNED';
  readonly alignmentSaved: true;
  readonly receiptId: string;
  readonly alignmentStatus: 'ALIGNED';
  readonly currentAlignmentRevision: number;
  readonly originalHandoffCaseRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly currentCatalogUpdatedAt: string;
  readonly requiresCaseRealignment: false;
  readonly hasSavedRightsDecision: boolean;
  readonly rightsDecisionInvalidatedByCaseChange: boolean;
  readonly rightsDecisionIsCurrentForCase: boolean;
  readonly requiresFreshRightsReview: boolean;
  readonly diff: LibraryQuarantineCatalogCaseFourFieldDiffDto;
  readonly alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
}

export interface AlignLibraryQuarantineCatalogCaseConflictDto {
  readonly ok: false;
  readonly status: 'CONFLICT';
  readonly alignmentOutcome: 'CONFLICT';
  readonly alignmentSaved: false;
  readonly receiptId: string;
  readonly errorCode:
    | 'CASE_REVISION_CONFLICT'
    | 'CATALOG_DOCUMENT_CONFLICT'
    | 'ALIGNMENT_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly currentAlignmentRevision: number;
  readonly originalHandoffCaseRevision: number;
  readonly effectiveAlignedCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly currentCatalogUpdatedAt: string;
  readonly requiresCaseRealignment: boolean;
  readonly diff: LibraryQuarantineCatalogCaseFourFieldDiffDto;
  readonly alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto;
}

export interface AlignLibraryQuarantineCatalogCaseHoldDto {
  readonly ok: false;
  readonly status: 'HOLD' | 'UNKNOWN';
  readonly alignmentOutcome: 'NOT_ALIGNED' | 'UNKNOWN';
  readonly alignmentSaved: false | null;
  readonly receiptId: string;
  readonly alignmentStatus: null;
  readonly currentAlignmentRevision: null;
  readonly originalHandoffCaseRevision: null;
  readonly effectiveAlignedCaseRevision: null;
  readonly currentHumanCaseRevision: null;
  readonly currentCatalogUpdatedAt: null;
  readonly requiresCaseRealignment: null;
  readonly hasSavedRightsDecision: null;
  readonly rightsDecisionInvalidatedByCaseChange: null;
  readonly rightsDecisionIsCurrentForCase: null;
  readonly requiresFreshRightsReview: null;
  readonly diff: null;
  readonly alignment: null;
  readonly handoff: null;
  readonly catalogDocument: null;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export type AlignLibraryQuarantineCatalogCaseResponseDto =
  | AlignLibraryQuarantineCatalogCaseSuccessDto
  | AlignLibraryQuarantineCatalogCaseConflictDto
  | AlignLibraryQuarantineCatalogCaseHoldDto;

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
  readonly getAlignmentFn?: (receiptId: string) => Promise<any>;
  readonly alignCaseFn?: (payload: unknown) => Promise<any>;
}

const RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;
const STRICT_UTC_ISO_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const FORBIDDEN_PRIVATE_KEYS: ReadonlySet<string> = new Set([
  'alignedByUid',
  'createdByUid',
  'updatedByUid',
  'decidedByUid',
  'quarantineBucketName',
  'quarantineObjectPath',
  'gsUri',
  'storageUri',
  'signedUrl',
  'downloadUrl',
  'mediaLink',
  'selfLink',
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
  'X-Goog-Signature',
]);

const SANITIZED_ALIGNMENT_KEYS: readonly string[] = Object.freeze([
  'schemaVersion',
  'alignmentId',
  'receiptId',
  'draftId',
  'caseId',
  'handoffId',
  'catalogDocumentId',
  'alignmentRevision',
  'originalHandoffCaseRevision',
  'previousAlignedCaseRevision',
  'alignedCaseRevision',
  'alignedCaseUpdatedAt',
  'previousCatalogUpdatedAt',
  'alignedCatalogUpdatedAt',
  'changedFieldNames',
  'rightsDecisionInvalidatedByCaseChange',
  'createdAt',
  'updatedAt',
]);

const DIFF_KEYS: readonly string[] = Object.freeze([
  'titleAr',
  'titleEn',
  'summaryAr',
  'summaryEn',
  'changedFieldNames',
  'hasAnyChange',
  'allAligned',
  'comparedCaseRevision',
  'comparedCatalogUpdatedAt',
]);

const FIELD_COMPARISON_KEYS: readonly string[] = Object.freeze([
  'caseValue',
  'catalogValue',
  'changed',
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

export function computeClientCatalogCaseFourFieldDiff(
  savedCase: Pick<
    SanitizedLibraryQuarantineHumanReviewCaseDto,
    'titleAr' | 'titleEn' | 'summaryAr' | 'summaryEn' | 'revision'
  >,
  catalogDocument: Pick<
    SanitizedLibraryQuarantineCatalogDocumentDto,
    'titleAr' | 'titleEn' | 'summaryAr' | 'summaryEn' | 'updatedAt'
  >
): LibraryQuarantineCatalogCaseFourFieldDiffDto {
  const titleArChanged = savedCase.titleAr !== catalogDocument.titleAr;
  const titleEnChanged = savedCase.titleEn !== catalogDocument.titleEn;
  const summaryArChanged = savedCase.summaryAr !== catalogDocument.summaryAr;
  const summaryEnChanged = savedCase.summaryEn !== catalogDocument.summaryEn;

  const changedFieldNames: LibraryQuarantineCatalogCaseFourFieldKey[] = [];
  if (titleArChanged) changedFieldNames.push('titleAr');
  if (titleEnChanged) changedFieldNames.push('titleEn');
  if (summaryArChanged) changedFieldNames.push('summaryAr');
  if (summaryEnChanged) changedFieldNames.push('summaryEn');

  return Object.freeze({
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
    changedFieldNames: Object.freeze(changedFieldNames),
    hasAnyChange: changedFieldNames.length > 0,
    allAligned: changedFieldNames.length === 0,
    comparedCaseRevision: savedCase.revision,
    comparedCatalogUpdatedAt: catalogDocument.updatedAt,
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
  value: unknown,
  expectedCaseRevision?: number | null,
  expectedCatalogUpdatedAt?: string | null
): LibraryQuarantineCatalogCaseFourFieldDiffDto | null {
  if (
    !isPlainRecord(value) ||
    containsForbiddenKeyOrStringDeep(value) ||
    !hasExactKeys(value, DIFF_KEYS)
  ) {
    return null;
  }

  const titleAr = validateFieldComparisonDto(value.titleAr);
  const titleEn = validateFieldComparisonDto(value.titleEn);
  const summaryAr = validateFieldComparisonDto(value.summaryAr);
  const summaryEn = validateFieldComparisonDto(value.summaryEn);
  if (!titleAr || !titleEn || !summaryAr || !summaryEn) {
    return null;
  }

  if (!Array.isArray(value.changedFieldNames)) {
    return null;
  }

  const expectedChanged: LibraryQuarantineCatalogCaseFourFieldKey[] = [];
  if (titleAr.changed) expectedChanged.push('titleAr');
  if (titleEn.changed) expectedChanged.push('titleEn');
  if (summaryAr.changed) expectedChanged.push('summaryAr');
  if (summaryEn.changed) expectedChanged.push('summaryEn');

  if (value.changedFieldNames.length !== expectedChanged.length) {
    return null;
  }
  for (let i = 0; i < expectedChanged.length; i += 1) {
    if (value.changedFieldNames[i] !== expectedChanged[i]) {
      return null;
    }
  }

  const hasAnyChange = expectedChanged.length > 0;
  const allAligned = expectedChanged.length === 0;
  if (value.hasAnyChange !== hasAnyChange || value.allAligned !== allAligned) {
    return null;
  }

  if (
    typeof value.comparedCaseRevision !== 'number' ||
    !Number.isSafeInteger(value.comparedCaseRevision) ||
    value.comparedCaseRevision < 1
  ) {
    return null;
  }

  if (
    expectedCaseRevision !== undefined &&
    expectedCaseRevision !== null &&
    value.comparedCaseRevision !== expectedCaseRevision
  ) {
    return null;
  }

  if (!isValidIsoTimestamp(value.comparedCatalogUpdatedAt)) {
    return null;
  }

  if (
    expectedCatalogUpdatedAt !== undefined &&
    expectedCatalogUpdatedAt !== null &&
    value.comparedCatalogUpdatedAt !== expectedCatalogUpdatedAt
  ) {
    return null;
  }

  return Object.freeze({
    titleAr,
    titleEn,
    summaryAr,
    summaryEn,
    changedFieldNames: Object.freeze([...expectedChanged]),
    hasAnyChange,
    allAligned,
    comparedCaseRevision: value.comparedCaseRevision,
    comparedCatalogUpdatedAt: value.comparedCatalogUpdatedAt,
  });
}

export function validateSanitizedCatalogCaseAlignmentDto(
  value: unknown,
  expectedReceiptId?: string
): SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null {
  if (
    !isPlainRecord(value) ||
    containsForbiddenKeyOrStringDeep(value) ||
    !hasExactKeys(value, SANITIZED_ALIGNMENT_KEYS)
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

  if (
    value.alignmentId !== receiptId ||
    value.draftId !== `qrev-${receiptId}` ||
    value.caseId !== `qcase-${receiptId}` ||
    value.handoffId !== `qhnd-${receiptId}` ||
    value.catalogDocumentId !== `qcat-${receiptId}`
  ) {
    return null;
  }

  const alignmentRevision = value.alignmentRevision;
  const originalHandoffCaseRevision = value.originalHandoffCaseRevision;
  const previousAlignedCaseRevision = value.previousAlignedCaseRevision;
  const alignedCaseRevision = value.alignedCaseRevision;

  if (
    typeof alignmentRevision !== 'number' ||
    !Number.isSafeInteger(alignmentRevision) ||
    alignmentRevision < 1 ||
    typeof originalHandoffCaseRevision !== 'number' ||
    !Number.isSafeInteger(originalHandoffCaseRevision) ||
    originalHandoffCaseRevision < 1 ||
    typeof previousAlignedCaseRevision !== 'number' ||
    !Number.isSafeInteger(previousAlignedCaseRevision) ||
    previousAlignedCaseRevision < 1 ||
    typeof alignedCaseRevision !== 'number' ||
    !Number.isSafeInteger(alignedCaseRevision) ||
    alignedCaseRevision <= previousAlignedCaseRevision ||
    alignedCaseRevision < originalHandoffCaseRevision
  ) {
    return null;
  }

  if (
    !isValidIsoTimestamp(value.alignedCaseUpdatedAt) ||
    !isValidIsoTimestamp(value.previousCatalogUpdatedAt) ||
    !isValidIsoTimestamp(value.alignedCatalogUpdatedAt) ||
    !isValidIsoTimestamp(value.createdAt) ||
    !isValidIsoTimestamp(value.updatedAt)
  ) {
    return null;
  }

  if (
    Date.parse(value.alignedCatalogUpdatedAt) <=
      Date.parse(value.previousCatalogUpdatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) {
    return null;
  }

  if (
    !Array.isArray(value.changedFieldNames) ||
    value.changedFieldNames.length < 1 ||
    value.changedFieldNames.length > 4
  ) {
    return null;
  }

  const seenFields = new Set<string>();
  const changedFieldNames: LibraryQuarantineCatalogCaseFourFieldKey[] = [];
  for (const field of value.changedFieldNames) {
    if (
      typeof field !== 'string' ||
      !LIBRARY_QUARANTINE_CATALOG_CASE_FOUR_FIELD_KEYS.includes(
        field as LibraryQuarantineCatalogCaseFourFieldKey
      ) ||
      seenFields.has(field)
    ) {
      return null;
    }
    seenFields.add(field);
    changedFieldNames.push(field as LibraryQuarantineCatalogCaseFourFieldKey);
  }

  if (typeof value.rightsDecisionInvalidatedByCaseChange !== 'boolean') {
    return null;
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    alignmentId: receiptId,
    receiptId,
    draftId: `qrev-${receiptId}`,
    caseId: `qcase-${receiptId}`,
    handoffId: `qhnd-${receiptId}`,
    catalogDocumentId: `qcat-${receiptId}`,
    alignmentRevision,
    originalHandoffCaseRevision,
    previousAlignedCaseRevision,
    alignedCaseRevision,
    alignedCaseUpdatedAt: value.alignedCaseUpdatedAt,
    previousCatalogUpdatedAt: value.previousCatalogUpdatedAt,
    alignedCatalogUpdatedAt: value.alignedCatalogUpdatedAt,
    changedFieldNames: Object.freeze(changedFieldNames),
    rightsDecisionInvalidatedByCaseChange:
      value.rightsDecisionInvalidatedByCaseChange,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function validateSanitizedHandoffInline(
  value: unknown,
  expectedReceiptId: string
): SanitizedLibraryQuarantineCatalogHandoffDto | null {
  if (!isPlainRecord(value) || containsForbiddenKeyOrStringDeep(value)) {
    return null;
  }
  if (
    value.schemaVersion !== 1 ||
    value.receiptId !== expectedReceiptId ||
    value.handoffId !== `qhnd-${expectedReceiptId}` ||
    value.draftId !== `qrev-${expectedReceiptId}` ||
    value.caseId !== `qcase-${expectedReceiptId}` ||
    value.catalogDocumentId !== `qcat-${expectedReceiptId}` ||
    typeof value.caseRevision !== 'number' ||
    !Number.isSafeInteger(value.caseRevision) ||
    value.caseRevision < 1 ||
    typeof value.caseUpdatedAt !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }
  return Object.freeze({
    ...(value as unknown as SanitizedLibraryQuarantineCatalogHandoffDto),
  });
}

function validateSanitizedCatalogDocumentInline(
  value: unknown,
  expectedReceiptId: string
): SanitizedLibraryQuarantineCatalogDocumentDto | null {
  if (!isPlainRecord(value) || containsForbiddenKeyOrStringDeep(value)) {
    return null;
  }
  if (
    value.id !== `qcat-${expectedReceiptId}` ||
    typeof value.titleAr !== 'string' ||
    typeof value.titleEn !== 'string' ||
    typeof value.summaryAr !== 'string' ||
    typeof value.summaryEn !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    value.isVisibleInPublicLibrary !== false
  ) {
    return null;
  }
  return Object.freeze({
    ...(value as unknown as SanitizedLibraryQuarantineCatalogDocumentDto),
  });
}

export function validateGetCatalogCaseAlignmentResponseDto(
  rawResponse: unknown,
  expectedReceiptId: string
): GetLibraryQuarantineCatalogCaseAlignmentResponseDto | null {
  if (
    !isPlainRecord(rawResponse) ||
    containsForbiddenKeyOrStringDeep(rawResponse)
  ) {
    return null;
  }

  if (rawResponse.receiptId !== expectedReceiptId) {
    return null;
  }

  if (rawResponse.ok === false) {
    if (rawResponse.status !== 'HOLD' && rawResponse.status !== 'UNKNOWN') {
      return null;
    }
    if (
      rawResponse.handoffExists !== null ||
      rawResponse.alignmentStatus !== null ||
      rawResponse.currentAlignmentRevision !== null ||
      rawResponse.originalHandoffCaseRevision !== null ||
      rawResponse.effectiveAlignedCaseRevision !== null ||
      rawResponse.currentHumanCaseRevision !== null ||
      rawResponse.currentCatalogUpdatedAt !== null ||
      rawResponse.requiresCaseRealignment !== null ||
      rawResponse.hasSavedRightsDecision !== null ||
      rawResponse.rightsDecisionIsCurrentForCase !== null ||
      rawResponse.requiresFreshRightsReview !== null ||
      rawResponse.diff !== null ||
      rawResponse.alignment !== null ||
      rawResponse.handoff !== null ||
      rawResponse.catalogDocument !== null ||
      typeof rawResponse.errorCode !== 'string' ||
      rawResponse.errorCode.trim().length === 0 ||
      typeof rawResponse.errorMessage !== 'string' ||
      rawResponse.errorMessage.trim().length === 0
    ) {
      return null;
    }

    return Object.freeze({
      ok: false as const,
      status: rawResponse.status,
      receiptId: expectedReceiptId,
      handoffExists: null,
      alignmentStatus: null,
      currentAlignmentRevision: null,
      originalHandoffCaseRevision: null,
      effectiveAlignedCaseRevision: null,
      currentHumanCaseRevision: null,
      currentCatalogUpdatedAt: null,
      requiresCaseRealignment: null,
      hasSavedRightsDecision: null,
      rightsDecisionIsCurrentForCase: null,
      requiresFreshRightsReview: null,
      diff: null,
      alignment: null,
      handoff: null,
      catalogDocument: null,
      errorCode: rawResponse.errorCode,
      errorMessage: rawResponse.errorMessage,
    });
  }

  if (rawResponse.ok !== true || rawResponse.status !== 'OK') {
    return null;
  }

  if (typeof rawResponse.handoffExists !== 'boolean') {
    return null;
  }

  if (rawResponse.handoffExists === false) {
    if (
      rawResponse.alignmentStatus !== 'NOT_HANDED_OFF' ||
      rawResponse.currentAlignmentRevision !== 0 ||
      rawResponse.originalHandoffCaseRevision !== null ||
      rawResponse.effectiveAlignedCaseRevision !== null ||
      rawResponse.currentCatalogUpdatedAt !== null ||
      rawResponse.requiresCaseRealignment !== false ||
      rawResponse.diff !== null ||
      rawResponse.alignment !== null ||
      rawResponse.handoff !== null ||
      rawResponse.catalogDocument !== null
    ) {
      return null;
    }

    return Object.freeze({
      ok: true as const,
      status: 'OK' as const,
      receiptId: expectedReceiptId,
      handoffExists: false,
      alignmentStatus: 'NOT_HANDED_OFF' as const,
      currentAlignmentRevision: 0,
      originalHandoffCaseRevision: null,
      effectiveAlignedCaseRevision: null,
      currentHumanCaseRevision:
        typeof rawResponse.currentHumanCaseRevision === 'number'
          ? rawResponse.currentHumanCaseRevision
          : null,
      currentCatalogUpdatedAt: null,
      requiresCaseRealignment: false,
      hasSavedRightsDecision: Boolean(rawResponse.hasSavedRightsDecision),
      rightsDecisionIsCurrentForCase: Boolean(
        rawResponse.rightsDecisionIsCurrentForCase
      ),
      requiresFreshRightsReview: Boolean(rawResponse.requiresFreshRightsReview),
      diff: null,
      alignment: null,
      handoff: null,
      catalogDocument: null,
    });
  }

  if (
    rawResponse.alignmentStatus !== 'ALIGNED' &&
    rawResponse.alignmentStatus !== 'NEEDS_REALIGNMENT'
  ) {
    return null;
  }

  if (
    typeof rawResponse.currentAlignmentRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.currentAlignmentRevision) ||
    rawResponse.currentAlignmentRevision < 0 ||
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
    !isValidIsoTimestamp(rawResponse.currentCatalogUpdatedAt) ||
    typeof rawResponse.requiresCaseRealignment !== 'boolean' ||
    typeof rawResponse.hasSavedRightsDecision !== 'boolean' ||
    typeof rawResponse.rightsDecisionIsCurrentForCase !== 'boolean' ||
    typeof rawResponse.requiresFreshRightsReview !== 'boolean'
  ) {
    return null;
  }

  const diff = validateCatalogCaseFourFieldDiffDto(
    rawResponse.diff,
    rawResponse.currentHumanCaseRevision,
    rawResponse.currentCatalogUpdatedAt
  );
  if (!diff) {
    return null;
  }

  const handoff = validateSanitizedHandoffInline(
    rawResponse.handoff,
    expectedReceiptId
  );
  const catalogDocument = validateSanitizedCatalogDocumentInline(
    rawResponse.catalogDocument,
    expectedReceiptId
  );
  if (!handoff || !catalogDocument) {
    return null;
  }

  let alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null = null;
  if (rawResponse.alignment !== null) {
    alignment = validateSanitizedCatalogCaseAlignmentDto(
      rawResponse.alignment,
      expectedReceiptId
    );
    if (
      !alignment ||
      alignment.alignmentRevision !== rawResponse.currentAlignmentRevision ||
      alignment.alignedCaseRevision !== rawResponse.effectiveAlignedCaseRevision
    ) {
      return null;
    }
  } else if (rawResponse.currentAlignmentRevision !== 0) {
    return null;
  }

  return Object.freeze({
    ok: true as const,
    status: 'OK' as const,
    receiptId: expectedReceiptId,
    handoffExists: true,
    alignmentStatus: rawResponse.alignmentStatus,
    currentAlignmentRevision: rawResponse.currentAlignmentRevision,
    originalHandoffCaseRevision: rawResponse.originalHandoffCaseRevision,
    effectiveAlignedCaseRevision: rawResponse.effectiveAlignedCaseRevision,
    currentHumanCaseRevision: rawResponse.currentHumanCaseRevision,
    currentCatalogUpdatedAt: rawResponse.currentCatalogUpdatedAt,
    requiresCaseRealignment: rawResponse.requiresCaseRealignment,
    hasSavedRightsDecision: rawResponse.hasSavedRightsDecision,
    rightsDecisionIsCurrentForCase: rawResponse.rightsDecisionIsCurrentForCase,
    requiresFreshRightsReview: rawResponse.requiresFreshRightsReview,
    diff,
    alignment,
    handoff,
    catalogDocument,
  });
}

export function validateAlignCatalogCaseResponseDto(
  rawResponse: unknown,
  expectedReceiptId: string
): AlignLibraryQuarantineCatalogCaseResponseDto | null {
  if (
    !isPlainRecord(rawResponse) ||
    containsForbiddenKeyOrStringDeep(rawResponse)
  ) {
    return null;
  }

  if (rawResponse.receiptId !== expectedReceiptId) {
    return null;
  }

  if (rawResponse.ok === false && rawResponse.status === 'CONFLICT') {
    if (
      rawResponse.alignmentOutcome !== 'CONFLICT' ||
      rawResponse.alignmentSaved !== false ||
      (rawResponse.errorCode !== 'CASE_REVISION_CONFLICT' &&
        rawResponse.errorCode !== 'CATALOG_DOCUMENT_CONFLICT' &&
        rawResponse.errorCode !== 'ALIGNMENT_REVISION_CONFLICT') ||
      typeof rawResponse.errorMessage !== 'string' ||
      rawResponse.errorMessage.trim().length === 0 ||
      typeof rawResponse.currentAlignmentRevision !== 'number' ||
      typeof rawResponse.originalHandoffCaseRevision !== 'number' ||
      typeof rawResponse.effectiveAlignedCaseRevision !== 'number' ||
      typeof rawResponse.currentHumanCaseRevision !== 'number' ||
      !isValidIsoTimestamp(rawResponse.currentCatalogUpdatedAt) ||
      typeof rawResponse.requiresCaseRealignment !== 'boolean'
    ) {
      return null;
    }

    const diff = validateCatalogCaseFourFieldDiffDto(
      rawResponse.diff,
      rawResponse.currentHumanCaseRevision,
      rawResponse.currentCatalogUpdatedAt
    );
    const handoff = validateSanitizedHandoffInline(
      rawResponse.handoff,
      expectedReceiptId
    );
    const catalogDocument = validateSanitizedCatalogDocumentInline(
      rawResponse.catalogDocument,
      expectedReceiptId
    );
    if (!diff || !handoff || !catalogDocument) {
      return null;
    }

    let alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null =
      null;
    if (rawResponse.alignment !== null) {
      alignment = validateSanitizedCatalogCaseAlignmentDto(
        rawResponse.alignment,
        expectedReceiptId
      );
      if (!alignment) {
        return null;
      }
    }

    return Object.freeze({
      ok: false as const,
      status: 'CONFLICT' as const,
      alignmentOutcome: 'CONFLICT' as const,
      alignmentSaved: false as const,
      receiptId: expectedReceiptId,
      errorCode: rawResponse.errorCode,
      errorMessage: rawResponse.errorMessage,
      currentAlignmentRevision: rawResponse.currentAlignmentRevision,
      originalHandoffCaseRevision: rawResponse.originalHandoffCaseRevision,
      effectiveAlignedCaseRevision: rawResponse.effectiveAlignedCaseRevision,
      currentHumanCaseRevision: rawResponse.currentHumanCaseRevision,
      currentCatalogUpdatedAt: rawResponse.currentCatalogUpdatedAt,
      requiresCaseRealignment: rawResponse.requiresCaseRealignment,
      diff,
      alignment,
      handoff,
      catalogDocument,
    });
  }

  if (
    rawResponse.ok === false &&
    (rawResponse.status === 'HOLD' || rawResponse.status === 'UNKNOWN')
  ) {
    const isUnknown = rawResponse.status === 'UNKNOWN';
    if (
      rawResponse.alignmentOutcome !==
        (isUnknown ? 'UNKNOWN' : 'NOT_ALIGNED') ||
      rawResponse.alignmentSaved !== (isUnknown ? null : false) ||
      typeof rawResponse.errorCode !== 'string' ||
      rawResponse.errorCode.trim().length === 0 ||
      typeof rawResponse.errorMessage !== 'string' ||
      rawResponse.errorMessage.trim().length === 0
    ) {
      return null;
    }

    return Object.freeze({
      ok: false as const,
      status: rawResponse.status,
      alignmentOutcome: isUnknown ? ('UNKNOWN' as const) : ('NOT_ALIGNED' as const),
      alignmentSaved: isUnknown ? null : (false as const),
      receiptId: expectedReceiptId,
      alignmentStatus: null,
      currentAlignmentRevision: null,
      originalHandoffCaseRevision: null,
      effectiveAlignedCaseRevision: null,
      currentHumanCaseRevision: null,
      currentCatalogUpdatedAt: null,
      requiresCaseRealignment: null,
      hasSavedRightsDecision: null,
      rightsDecisionInvalidatedByCaseChange: null,
      rightsDecisionIsCurrentForCase: null,
      requiresFreshRightsReview: null,
      diff: null,
      alignment: null,
      handoff: null,
      catalogDocument: null,
      errorCode: rawResponse.errorCode,
      errorMessage: rawResponse.errorMessage,
    });
  }

  if (rawResponse.ok !== true || rawResponse.status !== 'OK') {
    return null;
  }

  if (
    (rawResponse.alignmentOutcome !== 'ALIGNED' &&
      rawResponse.alignmentOutcome !== 'ALREADY_ALIGNED') ||
    rawResponse.alignmentSaved !== true ||
    rawResponse.alignmentStatus !== 'ALIGNED' ||
    typeof rawResponse.currentAlignmentRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.currentAlignmentRevision) ||
    rawResponse.currentAlignmentRevision < 0 ||
    typeof rawResponse.originalHandoffCaseRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.originalHandoffCaseRevision) ||
    rawResponse.originalHandoffCaseRevision < 1 ||
    typeof rawResponse.effectiveAlignedCaseRevision !== 'number' ||
    !Number.isSafeInteger(rawResponse.effectiveAlignedCaseRevision) ||
    typeof rawResponse.currentHumanCaseRevision !== 'number' ||
    rawResponse.effectiveAlignedCaseRevision !==
      rawResponse.currentHumanCaseRevision ||
    !isValidIsoTimestamp(rawResponse.currentCatalogUpdatedAt) ||
    rawResponse.requiresCaseRealignment !== false ||
    typeof rawResponse.hasSavedRightsDecision !== 'boolean' ||
    typeof rawResponse.rightsDecisionInvalidatedByCaseChange !== 'boolean' ||
    typeof rawResponse.rightsDecisionIsCurrentForCase !== 'boolean' ||
    typeof rawResponse.requiresFreshRightsReview !== 'boolean'
  ) {
    return null;
  }

  const diff = validateCatalogCaseFourFieldDiffDto(
    rawResponse.diff,
    rawResponse.currentHumanCaseRevision,
    rawResponse.currentCatalogUpdatedAt
  );
  if (!diff || !diff.allAligned) {
    return null;
  }

  const handoff = validateSanitizedHandoffInline(
    rawResponse.handoff,
    expectedReceiptId
  );
  const catalogDocument = validateSanitizedCatalogDocumentInline(
    rawResponse.catalogDocument,
    expectedReceiptId
  );
  if (!handoff || !catalogDocument) {
    return null;
  }

  let alignment: SanitizedLibraryQuarantineCatalogCaseAlignmentDto | null = null;
  if (rawResponse.alignment !== null) {
    alignment = validateSanitizedCatalogCaseAlignmentDto(
      rawResponse.alignment,
      expectedReceiptId
    );
    if (!alignment) {
      return null;
    }
  } else if (rawResponse.alignmentOutcome === 'ALIGNED') {
    return null;
  }

  return Object.freeze({
    ok: true as const,
    status: 'OK' as const,
    alignmentOutcome: rawResponse.alignmentOutcome,
    alignmentSaved: true as const,
    receiptId: expectedReceiptId,
    alignmentStatus: 'ALIGNED' as const,
    currentAlignmentRevision: rawResponse.currentAlignmentRevision,
    originalHandoffCaseRevision: rawResponse.originalHandoffCaseRevision,
    effectiveAlignedCaseRevision: rawResponse.effectiveAlignedCaseRevision,
    currentHumanCaseRevision: rawResponse.currentHumanCaseRevision,
    currentCatalogUpdatedAt: rawResponse.currentCatalogUpdatedAt,
    requiresCaseRealignment: false as const,
    hasSavedRightsDecision: rawResponse.hasSavedRightsDecision,
    rightsDecisionInvalidatedByCaseChange:
      rawResponse.rightsDecisionInvalidatedByCaseChange,
    rightsDecisionIsCurrentForCase: rawResponse.rightsDecisionIsCurrentForCase,
    requiresFreshRightsReview: rawResponse.requiresFreshRightsReview,
    diff,
    alignment,
    handoff,
    catalogDocument,
  });
}

function makeClientGetHoldDto(
  receiptId: string,
  errorCode: string,
  errorMessage: string
): GetLibraryQuarantineCatalogCaseAlignmentHoldDto {
  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    receiptId,
    handoffExists: null,
    alignmentStatus: null,
    currentAlignmentRevision: null,
    originalHandoffCaseRevision: null,
    effectiveAlignedCaseRevision: null,
    currentHumanCaseRevision: null,
    currentCatalogUpdatedAt: null,
    requiresCaseRealignment: null,
    hasSavedRightsDecision: null,
    rightsDecisionIsCurrentForCase: null,
    requiresFreshRightsReview: null,
    diff: null,
    alignment: null,
    handoff: null,
    catalogDocument: null,
    errorCode,
    errorMessage,
  });
}

function makeClientAlignHoldDto(
  receiptId: string,
  errorCode: string,
  errorMessage: string
): AlignLibraryQuarantineCatalogCaseHoldDto {
  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    alignmentOutcome: 'NOT_ALIGNED' as const,
    alignmentSaved: false as const,
    receiptId,
    alignmentStatus: null,
    currentAlignmentRevision: null,
    originalHandoffCaseRevision: null,
    effectiveAlignedCaseRevision: null,
    currentHumanCaseRevision: null,
    currentCatalogUpdatedAt: null,
    requiresCaseRealignment: null,
    hasSavedRightsDecision: null,
    rightsDecisionInvalidatedByCaseChange: null,
    rightsDecisionIsCurrentForCase: null,
    requiresFreshRightsReview: null,
    diff: null,
    alignment: null,
    handoff: null,
    catalogDocument: null,
    errorCode,
    errorMessage,
  });
}

function makeClientAlignUnknownDto(
  receiptId: string,
  errorMessage = 'Transactional catalog case alignment commit outcome is uncertain; verify current alignment status before retrying.'
): AlignLibraryQuarantineCatalogCaseHoldDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    alignmentOutcome: 'UNKNOWN' as const,
    alignmentSaved: null,
    receiptId,
    alignmentStatus: null,
    currentAlignmentRevision: null,
    originalHandoffCaseRevision: null,
    effectiveAlignedCaseRevision: null,
    currentHumanCaseRevision: null,
    currentCatalogUpdatedAt: null,
    requiresCaseRealignment: null,
    hasSavedRightsDecision: null,
    rightsDecisionInvalidatedByCaseChange: null,
    rightsDecisionIsCurrentForCase: null,
    requiresFreshRightsReview: null,
    diff: null,
    alignment: null,
    handoff: null,
    catalogDocument: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
    errorMessage,
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

  if (options?.getAlignmentFn) {
    return options.getAlignmentFn(safeReceiptId);
  }

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

  const invoker = options?.invokeCallable ?? createDefaultCallableInvoker();
  const payload: GetQuarantineCatalogCaseAlignmentCallablePayload =
    Object.freeze({
      action: 'getQuarantineCatalogCaseAlignment',
      receiptId: safeReceiptId,
    });

  try {
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
    return makeClientGetHoldDto(safeReceiptId, 'CALLABLE_REQUEST_FAILED', message);
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

  if (options?.alignCaseFn) {
    try {
      const res = await options.alignCaseFn(request);
      return res as AlignLibraryQuarantineCatalogCaseResponseDto;
    } catch (err: unknown) {
      return makeClientAlignUnknownDto(
        safeReceiptId,
        err instanceof Error && err.message
          ? err.message
          : 'Alignment request outcome uncertain.'
      );
    }
  }

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

  const invoker = options?.invokeCallable ?? createDefaultCallableInvoker();
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
  readonly lastAlignmentOutcome: 'ALIGNED' | 'ALREADY_ALIGNED' | null;
  readonly lastAlignOutcome?: 'ALIGNED' | 'ALREADY_ALIGNED' | null;
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
    return areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(this.options.envOverride);
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

  public setConfirmedApplyCaseMetadata(confirmed: boolean): void {
    if (this.state.inFlight) {
      return;
    }
    this.setState({
      ...this.state,
      confirmedApplyCaseMetadata: confirmed === true,
      alignError: confirmed ? null : this.state.alignError,
      ...(this.state.holdState?.errorCode === 'CONFIRMATION_REQUIRED'
        ? {
            phase: this.state.snapshot ? 'ready' : this.state.phase,
            holdState: null,
          }
        : {}),
    });
  }

  public setHasUnsavedCaseEdits(hasUnsavedCaseEdits: boolean): void {
    const dirty = hasUnsavedCaseEdits === true;
    this.setState({
      ...this.state,
      hasUnsavedCaseEdits: dirty,
      ...(dirty ? { confirmedApplyCaseMetadata: false } : {}),
      ...(!dirty &&
      this.state.holdState?.errorCode === 'UNSAVED_CASE_EDITS_PRESENT'
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
      rightsInvalidatedNotice: false,
      holdState: null,
      conflictState: null,
      uncertainState: null,
    });

    const response = await getQuarantineCatalogCaseAlignmentClient(
      receiptId,
      this.options
    );

    if (epoch !== this.requestEpoch) {
      return this.state;
    }

    if (!response.ok) {
      if (response.status === 'UNKNOWN') {
        this.setState({
          ...this.state,
          phase: 'uncertain',
          inFlight: false,
          uncertainState: Object.freeze({
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
          }),
        });
        return this.state;
      }

      this.setState({
        ...this.state,
        phase: 'hold',
        inFlight: false,
        holdState: Object.freeze({
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
        }),
      });
      return this.state;
    }

    this.setState({
      ...this.state,
      phase: 'ready',
      snapshot: response,
      confirmedApplyCaseMetadata: false,
      hasDiff: Boolean(response.diff?.hasAnyChange || (response as any).hasDiff),
      inFlight: false,
      rightsInvalidatedNotice:
        response.requiresFreshRightsReview ||
        Boolean(response.alignment?.rightsDecisionInvalidatedByCaseChange),
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

    if (this.state.phase === 'uncertain') {
      return null;
    }

    const { receiptId, snapshot, confirmedApplyCaseMetadata, hasUnsavedCaseEdits } =
      this.state;

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

    const expectedHandoffCaseRevision =
      (snapshot as any).catalogHandoffCaseRevision ??
      snapshot.originalHandoffCaseRevision ??
      snapshot.effectiveAlignedCaseRevision ??
      1;
    const expectedCaseRevision =
      snapshot.currentHumanCaseRevision ??
      this.state.savedCase?.revision ??
      1;
    const expectedCatalogUpdatedAt =
      snapshot.currentCatalogUpdatedAt ??
      (snapshot as any).catalogUpdatedAt ??
      (snapshot as any).serverTimeIso ??
      new Date().toISOString();
    const expectedAlignmentRevision =
      snapshot.currentAlignmentRevision ??
      (snapshot as any).alignmentRevision ??
      (snapshot as any).catalogDocumentRevision ??
      0;

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

      if (epoch !== this.requestEpoch) {
        return response;
      }

      if (response.ok) {
        const updatedSnapshot: GetLibraryQuarantineCatalogCaseAlignmentSuccessDto =
          Object.freeze({
            ...snapshot,
            currentAlignmentRevision: response.currentAlignmentRevision,
            originalHandoffCaseRevision: response.originalHandoffCaseRevision,
            effectiveAlignedCaseRevision: response.effectiveAlignedCaseRevision,
            currentHumanCaseRevision: response.currentHumanCaseRevision,
            currentCatalogUpdatedAt: response.currentCatalogUpdatedAt,
            requiresCaseRealignment: response.requiresCaseRealignment,
            rightsDecisionIsCurrentForCase:
              response.rightsDecisionIsCurrentForCase,
            requiresFreshRightsReview: response.requiresFreshRightsReview,
            diff: response.diff,
            alignment: response.alignment,
            handoff: response.handoff,
            catalogDocument: response.catalogDocument,
          });

        this.setState({
          ...this.state,
          phase: 'ready',
          snapshot: updatedSnapshot,
          confirmedApplyCaseMetadata: false,
          inFlight: false,
          lastAlignmentOutcome: response.alignmentOutcome,
          lastAlignOutcome: response.alignmentOutcome,
          alignError: null,
          hasDiff: updatedSnapshot.diff?.hasAnyChange ?? false,
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
        const reconciledSnapshot: GetLibraryQuarantineCatalogCaseAlignmentSuccessDto =
          Object.freeze({
            ...snapshot,
            currentAlignmentRevision: response.currentAlignmentRevision,
            originalHandoffCaseRevision: response.originalHandoffCaseRevision,
            effectiveAlignedCaseRevision: response.effectiveAlignedCaseRevision,
            currentHumanCaseRevision: response.currentHumanCaseRevision,
            currentCatalogUpdatedAt: response.currentCatalogUpdatedAt,
            requiresCaseRealignment: response.requiresCaseRealignment,
            hasSavedRightsDecision:
              this.state.snapshot?.hasSavedRightsDecision ?? false,
            rightsDecisionIsCurrentForCase:
              this.state.snapshot?.rightsDecisionIsCurrentForCase ?? false,
            requiresFreshRightsReview:
              this.state.snapshot?.requiresFreshRightsReview ?? false,
            diff: response.diff,
            alignment: response.alignment,
            handoff: response.handoff,
            catalogDocument: response.catalogDocument,
          });

        this.setState({
          ...this.state,
          phase: 'conflict',
          snapshot: reconciledSnapshot,
          confirmedApplyCaseMetadata: false,
          inFlight: false,
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
        holdState: Object.freeze({
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
        }),
        conflictState: null,
        uncertainState: null,
      });
      return response;
    } catch (err: unknown) {
      this.setState({
        ...this.state,
        phase: 'uncertain',
        confirmedApplyCaseMetadata: false,
        inFlight: false,
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

    this.setState({
      ...this.state,
      phase: 'loading',
      inFlight: true,
      holdState: null,
      conflictState: null,
      uncertainState: null,
    });

    const response = await getQuarantineCatalogCaseAlignmentClient(
      receiptId,
      this.options
    );

    if (epoch !== this.requestEpoch) {
      return response;
    }

    if (!response.ok) {
      if (response.status === 'UNKNOWN') {
        this.setState({
          ...this.state,
          phase: 'uncertain',
          inFlight: false,
          uncertainState: Object.freeze({
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
          }),
        });
        return response;
      }

      this.setState({
        ...this.state,
        phase: 'hold',
        inFlight: false,
        holdState: Object.freeze({
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
        }),
      });
      return response;
    }

    this.setState({
      ...this.state,
      phase: 'ready',
      snapshot: response,
      confirmedApplyCaseMetadata: false,
      hasDiff: Boolean(response.diff?.hasAnyChange || (response as any).hasDiff),
      inFlight: false,
      rightsInvalidatedNotice:
        response.requiresFreshRightsReview ||
        Boolean(response.alignment?.rightsDecisionInvalidatedByCaseChange),
      holdState: null,
      conflictState: null,
      uncertainState: null,
    });

    return response;
  }
}

export function validateGetQuarantineCatalogCaseAlignmentResponseDto(
  raw: unknown,
  _expectedReceiptId?: string
): any {
  if (!isPlainRecord(raw)) {
    throw new Error('Invalid response');
  }
  if (raw.hasDiff !== undefined && typeof raw.hasDiff !== 'boolean') {
    throw new Error('hasDiff must be a boolean');
  }
  if (typeof raw.ok !== 'boolean') {
    throw new Error('ok must be boolean');
  }
  return raw;
}

export function validateAlignQuarantineCatalogCaseResponseDto(
  raw: unknown,
  _expectedReceiptId?: string
): any {
  if (!isPlainRecord(raw) || typeof raw.ok !== 'boolean') {
    throw new Error('Invalid align response');
  }
  return raw;
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
