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
import { isLibraryQuarantineHumanReviewEnabled } from './libraryQuarantineHumanReviewClient';
import {
  QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX,
  QUARANTINE_CATALOG_DOCUMENT_ID_REGEX,
  isLibraryQuarantineCatalogHandoffEnabled,
} from './libraryQuarantineCatalogHandoffClient';
import {
  QUARANTINE_RIGHTS_READINESS_INDICATORS,
  type LibraryQuarantineReadinessIndicatorsDto,
} from './libraryQuarantineRightsDecisionClient';

export type { LibraryQuarantineReadinessIndicatorsDto };

export const LIBRARY_BINARY_SAFETY_CASE_UI_ENV_VAR =
  'VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED' as const;

export const LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_BINARY_SAFETY_DISPOSITIONS = Object.freeze([
  'ISOLATED_ASSESSMENT_REQUIRED',
  'EXTERNAL_REPORT_NOT_VERIFIED',
  'DO_NOT_PROCESS',
] as const);

export type LibraryQuarantineBinarySafetyDisposition =
  (typeof LIBRARY_QUARANTINE_BINARY_SAFETY_DISPOSITIONS)[number];

const ALLOWED_DISPOSITION_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_BINARY_SAFETY_DISPOSITIONS
);

export const LIBRARY_QUARANTINE_BINARY_SAFETY_SOURCE_FORMATS = Object.freeze([
  'PDF',
  'DOCX',
] as const);

export type LibraryQuarantineBinarySafetySourceFormat =
  (typeof LIBRARY_QUARANTINE_BINARY_SAFETY_SOURCE_FORMATS)[number];

export const LIBRARY_QUARANTINE_BINARY_SAFETY_DEEP_INSPECTION_STATUSES =
  Object.freeze([
    'PDF_REQUIRES_ISOLATED_PARSER',
    'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
  ] as const);

export type LibraryQuarantineBinarySafetyDeepInspectionStatus =
  (typeof LIBRARY_QUARANTINE_BINARY_SAFETY_DEEP_INSPECTION_STATUSES)[number];

export const BINARY_SAFETY_EVIDENCE_REFERENCE_MAX_LENGTH = 500 as const;
export const BINARY_SAFETY_NOTES_MAX_LENGTH = 2000 as const;

export const QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS: LibraryQuarantineReadinessIndicatorsDto =
  QUARANTINE_RIGHTS_READINESS_INDICATORS;

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;

const ISO_UTC_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const BIDI_OR_INVISIBLE_FORMAT_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|blob\s*:|gs:\/\/|https?:\/\/|\/quarantine\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com|x-goog-signature|\.\.\/|\.\.\\)/i;

const FORBIDDEN_DTO_SECRET_KEYS: ReadonlySet<string> = new Set([
  'sourceSha256',
  'sha256',
  'createdBy',
  'updatedBy',
  'actorUid',
  'storagePath',
  'quarantineBucket',
  'quarantineObjectPath',
  'bucket',
  'objectPath',
  'generation',
  'url',
  'signedUrl',
  'downloadUrl',
  'publicUrl',
  'fileUrl',
  'referenceUrl',
  'receipt',
  'rawBytes',
  'bytes',
  'buffer',
  'token',
]);

const ALLOWED_EDITORIAL_INPUT_KEYS: ReadonlySet<string> = new Set([
  'disposition',
  'evidenceReference',
  'evidenceNotes',
  'reviewNotes',
]);

const ALLOWED_SANITIZED_CASE_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'documentId',
  'revision',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'effectiveHumanCaseRevision',
  'effectiveHumanCaseUpdatedAt',
  'catalogUpdatedAt',
  'disposition',
  'evidenceReference',
  'evidenceNotes',
  'reviewNotes',
  'createdAt',
  'updatedAt',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_READINESS_KEYS: ReadonlySet<string> = new Set([
  'binarySafety',
  'fileSanitization',
  'publication',
  'catalogWorkflow',
]);

const ALLOWED_GET_READY_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'receiptId',
  'documentId',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'catalogHandoffCaseRevision',
  'currentHumanCaseRevision',
  'effectiveHumanCaseRevision',
  'effectiveHumanCaseUpdatedAt',
  'catalogUpdatedAt',
  'currentRevision',
  'isCaseCurrent',
  'requiresFreshEvidence',
  'readiness',
  'binarySafetyCase',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_GET_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_SAVED_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'caseSaveOutcome',
  'caseSaved',
  'receiptId',
  'documentId',
  'revision',
  'currentRevision',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceFormat',
  'deepInspectionStatus',
  'catalogHandoffCaseRevision',
  'currentHumanCaseRevision',
  'effectiveHumanCaseRevision',
  'effectiveHumanCaseUpdatedAt',
  'catalogUpdatedAt',
  'isCaseCurrent',
  'requiresFreshEvidence',
  'readiness',
  'binarySafetyCase',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_CONFLICT_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'caseSaveOutcome',
  'caseSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'currentRevision',
  'currentBinarySafetyCase',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_HOLD_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'caseSaveOutcome',
  'caseSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

const ALLOWED_SAVE_UNKNOWN_KEYS: ReadonlySet<string> = new Set([
  'ok',
  'status',
  'outcome',
  'caseSaveOutcome',
  'caseSaved',
  'errorCode',
  'errorMessage',
  'receiptId',
  'documentId',
  'readiness',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
]);

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return (
    (proto === Object.prototype || proto === null) &&
    Object.getOwnPropertySymbols(val).length === 0
  );
}

function hasAllowedKeysOnly(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): boolean {
  if (Object.getOwnPropertySymbols(record).length > 0) {
    return false;
  }
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_DTO_SECRET_KEYS.has(key) || !allowedKeys.has(key)) {
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

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC_TIMESTAMP_REGEX.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export function deriveQuarantineCatalogDocumentId(receiptId: string): string {
  return `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`;
}

export function isMatchingSourceFormatAndDeepInspection(
  sourceFormat: unknown,
  deepInspectionStatus: unknown
): sourceFormat is LibraryQuarantineBinarySafetySourceFormat {
  if (
    sourceFormat === 'PDF' &&
    deepInspectionStatus === 'PDF_REQUIRES_ISOLATED_PARSER'
  ) {
    return true;
  }
  if (
    sourceFormat === 'DOCX' &&
    deepInspectionStatus === 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
  ) {
    return true;
  }
  return false;
}

export interface LibraryQuarantineBinarySafetyEditorialFields {
  readonly disposition: LibraryQuarantineBinarySafetyDisposition;
  readonly evidenceReference: string;
  readonly evidenceNotes: string;
  readonly reviewNotes: string;
}

export interface SaveLibraryQuarantineBinarySafetyCaseInput {
  readonly disposition: LibraryQuarantineBinarySafetyDisposition;
  readonly evidenceReference?: string;
  readonly evidenceNotes?: string;
  readonly reviewNotes?: string;
}

export interface SanitizedLibraryQuarantineBinarySafetyCaseDto
  extends LibraryQuarantineBinarySafetyEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly effectiveHumanCaseRevision: number;
  readonly effectiveHumanCaseUpdatedAt: string;
  readonly catalogUpdatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export function isLibraryQuarantineBinarySafetyCaseEnabled(
  envOverride?: Record<string, unknown>
): boolean {
  if (!isLibraryQuarantineReviewWorkbenchEnabled(envOverride)) {
    return false;
  }
  if (!isLibraryQuarantineHumanReviewEnabled(envOverride)) {
    return false;
  }
  if (!isLibraryQuarantineCatalogHandoffEnabled(envOverride)) {
    return false;
  }
  if (envOverride !== undefined) {
    if (!isPlainRecord(envOverride)) {
      return false;
    }
    return envOverride[LIBRARY_BINARY_SAFETY_CASE_UI_ENV_VAR] === 'true';
  }
  const viteEnv = (
    import.meta as unknown as { readonly env?: Record<string, unknown> }
  )?.env;
  if (!viteEnv || typeof viteEnv !== 'object') {
    return false;
  }
  return viteEnv[LIBRARY_BINARY_SAFETY_CASE_UI_ENV_VAR] === 'true';
}

export const isLibraryQuarantineBinarySafetyCaseFeatureEnabled =
  isLibraryQuarantineBinarySafetyCaseEnabled;

export function canUserManageBinarySafetyCases(
  user: AdminUser | null | undefined
): boolean {
  if (!user || typeof user !== 'object') {
    return false;
  }
  if (user.isActive !== true) {
    return false;
  }
  if (user.role !== AdminRole.Owner) {
    return false;
  }
  if (!hasDomainResponsibility(user.role, AdminDomain.Library)) {
    return false;
  }
  if (!AdminAccessService.hasPermission(user, AdminPermission.Review)) {
    return false;
  }
  const explicitPermissions = (
    user as AdminUser & { readonly permissions?: unknown }
  ).permissions;
  if (explicitPermissions !== undefined) {
    if (
      !Array.isArray(explicitPermissions) ||
      !explicitPermissions.includes(AdminPermission.Review)
    ) {
      return false;
    }
  }
  return true;
}

function sanitizeClientPlainTextField(
  raw: unknown,
  maxLength: number,
  allowNewline: boolean,
  fieldName: string
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly errorCode: string; readonly errorMessage: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      errorCode: 'INVALID_PLAIN_TEXT_FIELD',
      errorMessage: `${fieldName} must be a string.`,
    };
  }
  const normalized = allowNewline
    ? raw.normalize('NFC').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : raw.normalize('NFC');
  const trimmed = normalized.trim();
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      errorCode: 'FIELD_MAX_LENGTH_EXCEEDED',
      errorMessage: `${fieldName} exceeds maximum length of ${maxLength} characters.`,
    };
  }
  if (hasForbiddenControlOrBidiChar(trimmed, allowNewline)) {
    return {
      ok: false,
      errorCode: 'INVALID_PLAIN_TEXT_FIELD',
      errorMessage: `${fieldName} contains forbidden control or bidi formatting characters.`,
    };
  }
  if (HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(trimmed)) {
    return {
      ok: false,
      errorCode: 'INVALID_PLAIN_TEXT_FIELD',
      errorMessage: `${fieldName} must not contain HTML angle brackets.`,
    };
  }
  if (FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(trimmed)) {
    return {
      ok: false,
      errorCode: 'UNTRUSTED_OR_FORBIDDEN_BINARY_SAFETY_FIELD',
      errorMessage: `${fieldName} contains forbidden URL schemes, storage paths, or signatures.`,
    };
  }
  return { ok: true, value: trimmed };
}

export function validateClientBinarySafetyCaseInput(
  rawInput: unknown
):
  | { readonly ok: true; readonly value: LibraryQuarantineBinarySafetyEditorialFields }
  | { readonly ok: false; readonly errorCode: string; readonly errorMessage: string } {
  if (!isPlainRecord(rawInput)) {
    return {
      ok: false,
      errorCode: 'INVALID_BINARY_SAFETY_INPUT_OBJECT',
      errorMessage: 'Binary safety input must be a plain object.',
    };
  }

  if (!hasAllowedKeysOnly(rawInput, ALLOWED_EDITORIAL_INPUT_KEYS)) {
    return {
      ok: false,
      errorCode: 'UNTRUSTED_OR_FORBIDDEN_BINARY_SAFETY_FIELD',
      errorMessage:
        'Binary safety input contains unexpected or forbidden properties.',
    };
  }

  const dispositionRaw = rawInput.disposition;
  if (
    typeof dispositionRaw !== 'string' ||
    !ALLOWED_DISPOSITION_SET.has(dispositionRaw)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_BINARY_SAFETY_DISPOSITION',
      errorMessage:
        'Disposition must be ISOLATED_ASSESSMENT_REQUIRED, EXTERNAL_REPORT_NOT_VERIFIED, or DO_NOT_PROCESS.',
    };
  }

  const disposition = dispositionRaw as LibraryQuarantineBinarySafetyDisposition;

  const evRefRes = sanitizeClientPlainTextField(
    rawInput.evidenceReference,
    BINARY_SAFETY_EVIDENCE_REFERENCE_MAX_LENGTH,
    false,
    'evidenceReference'
  );
  if (!evRefRes.ok) {
    return evRefRes;
  }

  const evNotesRes = sanitizeClientPlainTextField(
    rawInput.evidenceNotes,
    BINARY_SAFETY_NOTES_MAX_LENGTH,
    true,
    'evidenceNotes'
  );
  if (!evNotesRes.ok) {
    return evNotesRes;
  }

  const revNotesRes = sanitizeClientPlainTextField(
    rawInput.reviewNotes,
    BINARY_SAFETY_NOTES_MAX_LENGTH,
    true,
    'reviewNotes'
  );
  if (!revNotesRes.ok) {
    return revNotesRes;
  }

  const evidenceReference = evRefRes.value;
  const evidenceNotes = evNotesRes.value;
  const reviewNotes = revNotesRes.value;

  if (
    evidenceReference.length === 0 &&
    evidenceNotes.length === 0 &&
    reviewNotes.length === 0
  ) {
    return {
      ok: false,
      errorCode: 'EMPTY_BINARY_SAFETY_CASE_NOT_ALLOWED',
      errorMessage:
        'At least one non-empty evidenceReference, evidenceNotes, or reviewNotes field is required.',
    };
  }

  if (disposition === 'EXTERNAL_REPORT_NOT_VERIFIED') {
    if (evidenceReference.length === 0 || evidenceNotes.length === 0) {
      return {
        ok: false,
        errorCode: 'EXTERNAL_REPORT_REQUIREMENTS_NOT_MET',
        errorMessage:
          'EXTERNAL_REPORT_NOT_VERIFIED requires both evidenceReference and evidenceNotes.',
      };
    }
  }

  if (disposition === 'DO_NOT_PROCESS') {
    if (reviewNotes.length === 0) {
      return {
        ok: false,
        errorCode: 'DO_NOT_PROCESS_JUSTIFICATION_REQUIRED',
        errorMessage:
          'DO_NOT_PROCESS disposition requires reviewNotes justification.',
      };
    }
  }

  return {
    ok: true,
    value: Object.freeze({
      disposition,
      evidenceReference,
      evidenceNotes,
      reviewNotes,
    }),
  };
}

export function validateReadinessIndicatorsDto(
  raw: unknown
): LibraryQuarantineReadinessIndicatorsDto | null {
  if (!isPlainRecord(raw)) {
    return null;
  }
  const keys = Object.keys(raw);
  if (
    keys.length !== ALLOWED_READINESS_KEYS.size ||
    !keys.every((k) => ALLOWED_READINESS_KEYS.has(k))
  ) {
    return null;
  }
  if (
    raw.binarySafety !== 'NOT_VERIFIED' ||
    raw.fileSanitization !== 'NOT_PERFORMED' ||
    raw.publication !== 'BLOCKED' ||
    raw.catalogWorkflow !== 'Draft'
  ) {
    return null;
  }
  return QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS;
}

export function validateSanitizedBinarySafetyCaseDto(
  raw: unknown,
  expectedReceiptId?: string
): SanitizedLibraryQuarantineBinarySafetyCaseDto | null {
  if (!isPlainRecord(raw)) {
    return null;
  }
  const keys = Object.keys(raw);
  if (
    keys.length !== ALLOWED_SANITIZED_CASE_KEYS.size ||
    !hasAllowedKeysOnly(raw, ALLOWED_SANITIZED_CASE_KEYS)
  ) {
    return null;
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false
  ) {
    return null;
  }

  if (raw.schemaVersion !== LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION) {
    return null;
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
    (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
  ) {
    return null;
  }

  const expectedDocId = deriveQuarantineCatalogDocumentId(raw.receiptId);
  if (
    typeof raw.documentId !== 'string' ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(raw.documentId) ||
    raw.documentId !== expectedDocId
  ) {
    return null;
  }

  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1 ||
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    !isValidIsoTimestamp(raw.sourceUpdatedAt) ||
    !isMatchingSourceFormatAndDeepInspection(
      raw.sourceFormat,
      raw.deepInspectionStatus
    ) ||
    typeof raw.effectiveHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
    raw.effectiveHumanCaseRevision < 1 ||
    !isValidIsoTimestamp(raw.effectiveHumanCaseUpdatedAt) ||
    !isValidIsoTimestamp(raw.catalogUpdatedAt) ||
    !isValidIsoTimestamp(raw.createdAt) ||
    !isValidIsoTimestamp(raw.updatedAt) ||
    Date.parse(raw.updatedAt) < Date.parse(raw.createdAt)
  ) {
    return null;
  }

  const editorialCheck = validateClientBinarySafetyCaseInput({
    disposition: raw.disposition,
    evidenceReference: raw.evidenceReference,
    evidenceNotes: raw.evidenceNotes,
    reviewNotes: raw.reviewNotes,
  });
  if (!editorialCheck.ok) {
    return null;
  }

  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
    receiptId: raw.receiptId,
    documentId: expectedDocId,
    revision: raw.revision,
    sourceRevision: raw.sourceRevision,
    sourceUpdatedAt: raw.sourceUpdatedAt,
    sourceFormat: raw.sourceFormat,
    deepInspectionStatus:
      raw.deepInspectionStatus as LibraryQuarantineBinarySafetyDeepInspectionStatus,
    effectiveHumanCaseRevision: raw.effectiveHumanCaseRevision,
    effectiveHumanCaseUpdatedAt: raw.effectiveHumanCaseUpdatedAt,
    catalogUpdatedAt: raw.catalogUpdatedAt,
    disposition: editorialCheck.value.disposition,
    evidenceReference: editorialCheck.value.evidenceReference,
    evidenceNotes: editorialCheck.value.evidenceNotes,
    reviewNotes: editorialCheck.value.reviewNotes,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });
}

function sanitizeServerMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.normalize('NFC').trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 500 ||
    hasForbiddenControlOrBidiChar(trimmed, false) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(trimmed) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function hasValidFalsePostureFlags(record: Record<string, unknown>): boolean {
  return (
    record.isSanitized === false &&
    record.isVerifiedSafe === false &&
    record.isRightsApproved === false &&
    record.isPublished === false &&
    record.isReadyForPeia === false
  );
}

export interface ValidatedGetBinarySafetyReadyDto {
  readonly ok: true;
  readonly outcome: 'READY';
  readonly receiptId: string;
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly effectiveHumanCaseUpdatedAt: string;
  readonly catalogUpdatedAt: string;
  readonly currentRevision: number;
  readonly isCaseCurrent: boolean;
  readonly requiresFreshEvidence: boolean;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
}

export interface ValidatedGetBinarySafetyHoldDto {
  readonly ok: false;
  readonly outcome: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
}

export type ValidatedGetBinarySafetyResponseDto =
  | ValidatedGetBinarySafetyReadyDto
  | ValidatedGetBinarySafetyHoldDto;

export function validateGetQuarantineBinarySafetyCaseResponseDto(
  raw: unknown,
  expectedReceiptId?: string
): ValidatedGetBinarySafetyResponseDto | null {
  if (!isPlainRecord(raw)) {
    return null;
  }

  const outcome = raw.outcome ?? raw.status;
  if (outcome === 'HOLD' && raw.ok === false) {
    if (!hasAllowedKeysOnly(raw, ALLOWED_GET_HOLD_KEYS)) {
      return null;
    }
    if (raw.status !== undefined && raw.status !== 'HOLD') {
      return null;
    }
    if (!hasValidFalsePostureFlags(raw)) {
      return null;
    }
    const readiness = validateReadinessIndicatorsDto(raw.readiness);
    const errorMessage = sanitizeServerMessage(raw.errorMessage);
    if (
      !readiness ||
      !errorMessage ||
      typeof raw.errorCode !== 'string' ||
      raw.errorCode.trim().length === 0
    ) {
      return null;
    }
    return Object.freeze({
      ok: false as const,
      outcome: 'HOLD' as const,
      errorCode: raw.errorCode.trim(),
      errorMessage,
      readiness,
    });
  }

  if (outcome === 'READY' && raw.ok === true) {
    if (!hasAllowedKeysOnly(raw, ALLOWED_GET_READY_KEYS)) {
      return null;
    }
    if (raw.status !== undefined && raw.status !== 'READY') {
      return null;
    }
    if (!hasValidFalsePostureFlags(raw)) {
      return null;
    }
    const readiness = validateReadinessIndicatorsDto(raw.readiness);
    if (!readiness) {
      return null;
    }
    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
    ) {
      return null;
    }
    const expectedDocId = deriveQuarantineCatalogDocumentId(raw.receiptId);
    if (raw.documentId !== expectedDocId) {
      return null;
    }
    if (
      typeof raw.sourceRevision !== 'number' ||
      !Number.isSafeInteger(raw.sourceRevision) ||
      raw.sourceRevision < 1 ||
      !isValidIsoTimestamp(raw.sourceUpdatedAt) ||
      !isMatchingSourceFormatAndDeepInspection(
        raw.sourceFormat,
        raw.deepInspectionStatus
      ) ||
      typeof raw.catalogHandoffCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.catalogHandoffCaseRevision) ||
      raw.catalogHandoffCaseRevision < 1 ||
      typeof raw.currentHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentHumanCaseRevision) ||
      raw.currentHumanCaseRevision < raw.catalogHandoffCaseRevision ||
      typeof raw.effectiveHumanCaseRevision !== 'number' ||
      !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
      raw.effectiveHumanCaseRevision < raw.catalogHandoffCaseRevision ||
      !isValidIsoTimestamp(raw.effectiveHumanCaseUpdatedAt) ||
      !isValidIsoTimestamp(raw.catalogUpdatedAt) ||
      typeof raw.currentRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentRevision) ||
      raw.currentRevision < 0 ||
      typeof raw.isCaseCurrent !== 'boolean' ||
      typeof raw.requiresFreshEvidence !== 'boolean'
    ) {
      return null;
    }

    let binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null =
      null;
    if (raw.binarySafetyCase !== null) {
      binarySafetyCase = validateSanitizedBinarySafetyCaseDto(
        raw.binarySafetyCase,
        raw.receiptId
      );
      if (!binarySafetyCase || binarySafetyCase.revision !== raw.currentRevision) {
        return null;
      }
      if (raw.isCaseCurrent === raw.requiresFreshEvidence) {
        return null;
      }
    } else if (
      raw.currentRevision !== 0 ||
      raw.isCaseCurrent !== true ||
      raw.requiresFreshEvidence !== false
    ) {
      return null;
    }

    return Object.freeze({
      ok: true as const,
      outcome: 'READY' as const,
      receiptId: raw.receiptId,
      documentId: expectedDocId,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceFormat: raw.sourceFormat,
      deepInspectionStatus:
        raw.deepInspectionStatus as LibraryQuarantineBinarySafetyDeepInspectionStatus,
      catalogHandoffCaseRevision: raw.catalogHandoffCaseRevision,
      currentHumanCaseRevision: raw.currentHumanCaseRevision,
      effectiveHumanCaseRevision: raw.effectiveHumanCaseRevision,
      effectiveHumanCaseUpdatedAt: raw.effectiveHumanCaseUpdatedAt,
      catalogUpdatedAt: raw.catalogUpdatedAt,
      currentRevision: raw.currentRevision,
      isCaseCurrent: raw.isCaseCurrent,
      requiresFreshEvidence: raw.requiresFreshEvidence,
      readiness,
      binarySafetyCase,
    });
  }

  return null;
}

export function validateSaveQuarantineBinarySafetyCaseResponseDto(
  raw: unknown,
  expectedReceiptId?: string
):
  | {
      readonly ok: true;
      readonly outcome: 'SAVED';
      readonly caseSaveOutcome: 'CREATED' | 'UPDATED';
      readonly caseSaved: true;
      readonly receiptId: string;
      readonly documentId: string;
      readonly currentRevision: number;
      readonly sourceRevision: number;
      readonly sourceUpdatedAt: string;
      readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
      readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
      readonly catalogHandoffCaseRevision: number;
      readonly currentHumanCaseRevision: number;
      readonly effectiveHumanCaseRevision: number;
      readonly effectiveHumanCaseUpdatedAt: string;
      readonly catalogUpdatedAt: string;
      readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
      readonly binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto;
    }
  | {
      readonly ok: false;
      readonly outcome: 'CONFLICT';
      readonly caseSaved: false;
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly currentRevision: number;
      readonly currentBinarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
      readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
    }
  | {
      readonly ok: false;
      readonly outcome: 'HOLD';
      readonly caseSaved: false;
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
    }
  | {
      readonly ok: false;
      readonly outcome: 'UNKNOWN';
      readonly caseSaved: null;
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
    }
  | null {
  if (!isPlainRecord(raw)) {
    return null;
  }

  const outcome = raw.outcome ?? raw.status;

  if (outcome === 'SAVED' && raw.ok === true) {
    if (!hasAllowedKeysOnly(raw, ALLOWED_SAVE_SAVED_KEYS)) {
      return null;
    }
    if (
      raw.status !== 'SAVED' ||
      raw.caseSaved !== true ||
      (raw.caseSaveOutcome !== 'CREATED' && raw.caseSaveOutcome !== 'UPDATED') ||
      !hasValidFalsePostureFlags(raw)
    ) {
      return null;
    }
    const readiness = validateReadinessIndicatorsDto(raw.readiness);
    if (!readiness) {
      return null;
    }
    if (
      typeof raw.receiptId !== 'string' ||
      !QUARANTINE_RECEIPT_ID_REGEX.test(raw.receiptId) ||
      (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
    ) {
      return null;
    }
    const expectedDocId = deriveQuarantineCatalogDocumentId(raw.receiptId);
    if (raw.documentId !== expectedDocId) {
      return null;
    }
    const binarySafetyCase = validateSanitizedBinarySafetyCaseDto(
      raw.binarySafetyCase,
      raw.receiptId
    );
    if (
      !binarySafetyCase ||
      typeof raw.currentRevision !== 'number' ||
      raw.currentRevision !== binarySafetyCase.revision ||
      raw.revision !== binarySafetyCase.revision ||
      raw.isCaseCurrent !== true ||
      raw.requiresFreshEvidence !== false
    ) {
      return null;
    }
    return Object.freeze({
      ok: true as const,
      outcome: 'SAVED' as const,
      caseSaveOutcome: raw.caseSaveOutcome,
      caseSaved: true as const,
      receiptId: raw.receiptId,
      documentId: expectedDocId,
      currentRevision: binarySafetyCase.revision,
      sourceRevision: binarySafetyCase.sourceRevision,
      sourceUpdatedAt: binarySafetyCase.sourceUpdatedAt,
      sourceFormat: binarySafetyCase.sourceFormat,
      deepInspectionStatus: binarySafetyCase.deepInspectionStatus,
      catalogHandoffCaseRevision: Number(raw.catalogHandoffCaseRevision),
      currentHumanCaseRevision: Number(raw.currentHumanCaseRevision),
      effectiveHumanCaseRevision: binarySafetyCase.effectiveHumanCaseRevision,
      effectiveHumanCaseUpdatedAt: binarySafetyCase.effectiveHumanCaseUpdatedAt,
      catalogUpdatedAt: binarySafetyCase.catalogUpdatedAt,
      readiness,
      binarySafetyCase,
    });
  }

  if (outcome === 'CONFLICT' && raw.ok === false) {
    if (!hasAllowedKeysOnly(raw, ALLOWED_SAVE_CONFLICT_KEYS)) {
      return null;
    }
    if (
      raw.status !== 'CONFLICT' ||
      raw.caseSaved !== false ||
      !hasValidFalsePostureFlags(raw)
    ) {
      return null;
    }
    const readiness = validateReadinessIndicatorsDto(raw.readiness);
    const errorMessage = sanitizeServerMessage(raw.errorMessage);
    if (
      !readiness ||
      !errorMessage ||
      typeof raw.errorCode !== 'string' ||
      typeof raw.currentRevision !== 'number' ||
      !Number.isSafeInteger(raw.currentRevision) ||
      raw.currentRevision < 0
    ) {
      return null;
    }
    let currentBinarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null =
      null;
    if (raw.currentBinarySafetyCase !== null) {
      currentBinarySafetyCase = validateSanitizedBinarySafetyCaseDto(
        raw.currentBinarySafetyCase,
        expectedReceiptId
      );
      if (
        !currentBinarySafetyCase ||
        currentBinarySafetyCase.revision !== raw.currentRevision
      ) {
        return null;
      }
    }
    return Object.freeze({
      ok: false as const,
      outcome: 'CONFLICT' as const,
      caseSaved: false as const,
      errorCode: raw.errorCode,
      errorMessage,
      currentRevision: raw.currentRevision,
      currentBinarySafetyCase,
      readiness,
    });
  }

  if (outcome === 'HOLD' && raw.ok === false) {
    if (!hasAllowedKeysOnly(raw, ALLOWED_SAVE_HOLD_KEYS)) {
      return null;
    }
    if (
      raw.status !== 'HOLD' ||
      raw.caseSaved !== false ||
      !hasValidFalsePostureFlags(raw)
    ) {
      return null;
    }
    const readiness = validateReadinessIndicatorsDto(raw.readiness);
    const errorMessage = sanitizeServerMessage(raw.errorMessage);
    if (!readiness || !errorMessage || typeof raw.errorCode !== 'string') {
      return null;
    }
    return Object.freeze({
      ok: false as const,
      outcome: 'HOLD' as const,
      caseSaved: false as const,
      errorCode: raw.errorCode,
      errorMessage,
      readiness,
    });
  }

  if (outcome === 'UNKNOWN' && raw.ok === false) {
    if (!hasAllowedKeysOnly(raw, ALLOWED_SAVE_UNKNOWN_KEYS)) {
      return null;
    }
    if (
      raw.status !== 'UNKNOWN' ||
      raw.caseSaved !== null ||
      !hasValidFalsePostureFlags(raw)
    ) {
      return null;
    }
    const readiness = validateReadinessIndicatorsDto(raw.readiness);
    const errorMessage = sanitizeServerMessage(raw.errorMessage);
    if (!readiness || !errorMessage || typeof raw.errorCode !== 'string') {
      return null;
    }
    return Object.freeze({
      ok: false as const,
      outcome: 'UNKNOWN' as const,
      caseSaved: null,
      errorCode: raw.errorCode,
      errorMessage,
      readiness,
    });
  }

  return null;
}

export interface BinarySafetyCaseHoldState {
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface BinarySafetyCaseConflictState {
  readonly currentRevision: number;
  readonly currentBinarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
  readonly errorMessage: string;
}

export interface BinarySafetyCaseUncertainState {
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly caseSaved: null;
}

export interface LibraryQuarantineBinarySafetySnapshotState {
  readonly documentId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly effectiveHumanCaseRevision: number;
  readonly effectiveHumanCaseUpdatedAt: string;
  readonly catalogUpdatedAt: string;
  readonly currentRevision: number;
  readonly isCaseCurrent: boolean;
  readonly requiresFreshEvidence: boolean;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
  readonly stalePreviousCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
}

export interface LibraryQuarantineBinarySafetyCaseControllerState {
  readonly phase:
    | 'idle'
    | 'loading'
    | 'ready'
    | 'saving'
    | 'hold'
    | 'conflict'
    | 'uncertain'
    | 'error';
  readonly receiptId: string;
  readonly snapshot: LibraryQuarantineBinarySafetySnapshotState | null;
  readonly acknowledgedCurrentCaseRevision: boolean;
  readonly inFlight: boolean;
  readonly lastSaveOutcome: 'CREATED' | 'UPDATED' | null;
  readonly errorMessage: string | null;
  readonly holdState: BinarySafetyCaseHoldState | null;
  readonly conflictState: BinarySafetyCaseConflictState | null;
  readonly uncertainState: BinarySafetyCaseUncertainState | null;
  readonly sessionToken: number;
}

export interface LibraryQuarantineBinarySafetyRuntimeOverrides {
  readonly invokeCallable?: (
    action: string,
    data: Record<string, unknown>
  ) => Promise<unknown>;
  readonly envOverride?: Record<string, unknown>;
  readonly currentUser?: AdminUser | null;
}

export class LibraryQuarantineBinarySafetyCaseController {
  private receiptId: string;
  private readonly runtimeOverrides?: LibraryQuarantineBinarySafetyRuntimeOverrides;
  private currentUser: AdminUser | null | undefined;
  private sessionToken = 0;

  private state: LibraryQuarantineBinarySafetyCaseControllerState;

  private listeners: Array<
    (state: LibraryQuarantineBinarySafetyCaseControllerState) => void
  > = [];

  constructor(
    receiptId: string,
    runtimeOverrides?: LibraryQuarantineBinarySafetyRuntimeOverrides
  ) {
    if (!QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)) {
      throw new Error(
        'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hex string.'
      );
    }
    this.receiptId = receiptId;
    this.runtimeOverrides = runtimeOverrides;
    this.currentUser = runtimeOverrides?.currentUser;
    this.state = Object.freeze({
      phase: 'idle',
      receiptId,
      snapshot: null,
      acknowledgedCurrentCaseRevision: false,
      inFlight: false,
      lastSaveOutcome: null,
      errorMessage: null,
      holdState: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: 0,
    });
  }

  public getState(): LibraryQuarantineBinarySafetyCaseControllerState {
    return this.state;
  }

  public subscribe(
    listener: (state: LibraryQuarantineBinarySafetyCaseControllerState) => void
  ): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private setState(
    updater: Partial<LibraryQuarantineBinarySafetyCaseControllerState>
  ): void {
    this.state = Object.freeze({
      ...this.state,
      ...updater,
    });
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public setCurrentUser(user: AdminUser | null | undefined): void {
    this.currentUser = user;
  }

  public setAcknowledgedCurrentCaseRevision(acknowledged: boolean): void {
    this.setState({
      acknowledgedCurrentCaseRevision: acknowledged === true,
    });
  }

  public switchReceipt(
    nextReceiptId: string
  ): LibraryQuarantineBinarySafetyCaseControllerState {
    if (!QUARANTINE_RECEIPT_ID_REGEX.test(nextReceiptId)) {
      throw new Error(
        'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hex string.'
      );
    }
    this.sessionToken += 1;
    this.receiptId = nextReceiptId;
    this.setState({
      phase: 'idle',
      receiptId: nextReceiptId,
      snapshot: null,
      acknowledgedCurrentCaseRevision: false,
      inFlight: false,
      lastSaveOutcome: null,
      errorMessage: null,
      holdState: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: this.sessionToken,
    });
    return this.state;
  }

  private async invokeBackend(
    action: string,
    data: Record<string, unknown>
  ): Promise<unknown> {
    if (this.runtimeOverrides?.invokeCallable) {
      return this.runtimeOverrides.invokeCallable(action, {
        receiptId: this.receiptId,
        ...data,
      });
    }
    if (!isFirebaseConfigured || !app) {
      throw new Error('FIREBASE_UNCONFIGURED: Firebase is not initialized.');
    }
    const functions = getFunctions(app);
    const fn = httpsCallable(functions, 'manageLibraryDocuments');
    const result = await fn({
      action,
      receiptId: this.receiptId,
      ...data,
    });
    return result.data;
  }

  public async loadCase(): Promise<void> {
    if (
      !isLibraryQuarantineBinarySafetyCaseEnabled(
        this.runtimeOverrides?.envOverride
      )
    ) {
      this.setState({
        phase: 'hold',
        inFlight: false,
        holdState: {
          errorCode: 'BINARY_SAFETY_CASE_NOT_RELEASED',
          errorMessage: 'Library binary safety case feature flag is disabled.',
        },
      });
      return;
    }

    if (
      this.currentUser !== undefined &&
      !canUserManageBinarySafetyCases(this.currentUser)
    ) {
      this.setState({
        phase: 'hold',
        inFlight: false,
        holdState: {
          errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD',
          errorMessage:
            'Binary safety casework is restricted to active Library Owners with Review permission.',
        },
      });
      return;
    }

    if (this.state.inFlight) {
      return;
    }

    const activeToken = ++this.sessionToken;
    const targetReceiptId = this.receiptId;

    this.setState({
      phase: 'loading',
      inFlight: true,
      errorMessage: null,
      sessionToken: activeToken,
    });

    try {
      const rawResponse = await this.invokeBackend(
        'getQuarantineBinarySafetyCase',
        {}
      );

      if (
        activeToken !== this.sessionToken ||
        targetReceiptId !== this.receiptId
      ) {
        return;
      }

      const validated = validateGetQuarantineBinarySafetyCaseResponseDto(
        rawResponse,
        targetReceiptId
      );
      if (!validated) {
        this.setState({
          phase: 'hold',
          inFlight: false,
          holdState: {
            errorCode: 'INVALID_SERVER_RESPONSE_CONTRACT',
            errorMessage:
              'Server response failed binary safety DTO schema or security posture validation.',
          },
        });
        return;
      }

      if (!validated.ok) {
        this.setState({
          phase: 'hold',
          inFlight: false,
          holdState: {
            errorCode: validated.errorCode,
            errorMessage: validated.errorMessage,
          },
        });
        return;
      }

      this.setState({
        phase: 'ready',
        inFlight: false,
        acknowledgedCurrentCaseRevision: false,
        snapshot: Object.freeze({
          documentId: validated.documentId,
          sourceRevision: validated.sourceRevision,
          sourceUpdatedAt: validated.sourceUpdatedAt,
          sourceFormat: validated.sourceFormat,
          deepInspectionStatus: validated.deepInspectionStatus,
          catalogHandoffCaseRevision: validated.catalogHandoffCaseRevision,
          currentHumanCaseRevision: validated.currentHumanCaseRevision,
          effectiveHumanCaseRevision: validated.effectiveHumanCaseRevision,
          effectiveHumanCaseUpdatedAt: validated.effectiveHumanCaseUpdatedAt,
          catalogUpdatedAt: validated.catalogUpdatedAt,
          currentRevision: validated.currentRevision,
          isCaseCurrent: validated.isCaseCurrent,
          requiresFreshEvidence: validated.requiresFreshEvidence,
          readiness: validated.readiness,
          binarySafetyCase: validated.binarySafetyCase,
          stalePreviousCase: validated.requiresFreshEvidence
            ? validated.binarySafetyCase
            : null,
        }),
        holdState: null,
        conflictState: null,
        uncertainState: null,
      });
    } catch {
      if (
        activeToken !== this.sessionToken ||
        targetReceiptId !== this.receiptId
      ) {
        return;
      }
      this.setState({
        phase: 'hold',
        inFlight: false,
        holdState: {
          errorCode: 'STORE_READ_FAILED',
          errorMessage: 'Failed to load binary safety case record from server.',
        },
      });
    }
  }

  public async saveCase(
    expectedRevision: number,
    input: SaveLibraryQuarantineBinarySafetyCaseInput,
    options?: {
      readonly acknowledgedHumanCaseRevision?: number;
      readonly hasUnsavedCaseEdits?: boolean;
      readonly savedCaseStatus?: string;
    }
  ): Promise<unknown> {
    if (
      !isLibraryQuarantineBinarySafetyCaseEnabled(
        this.runtimeOverrides?.envOverride
      )
    ) {
      this.setState({
        phase: 'hold',
        inFlight: false,
        holdState: {
          errorCode: 'BINARY_SAFETY_CASE_NOT_RELEASED',
          errorMessage: 'Library binary safety case feature flag is disabled.',
        },
      });
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'BINARY_SAFETY_CASE_NOT_RELEASED',
      };
    }

    if (
      this.currentUser !== undefined &&
      !canUserManageBinarySafetyCases(this.currentUser)
    ) {
      this.setState({
        phase: 'hold',
        inFlight: false,
        holdState: {
          errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD',
          errorMessage:
            'Binary safety casework is restricted to active Library Owners with Review permission.',
        },
      });
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'UNAUTHORIZED_BINARY_SAFETY_OWNER_HOLD',
      };
    }

    if (this.state.inFlight) {
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'DUPLICATE_SUBMIT_BLOCKED',
      };
    }

    if (
      this.state.phase === 'uncertain' ||
      this.state.phase === 'conflict' ||
      this.state.phase === 'hold'
    ) {
      return {
        ok: false,
        outcome: this.state.phase === 'uncertain' ? 'UNKNOWN' : 'HOLD',
        errorCode: 'SAVE_BLOCKED_IN_CURRENT_PHASE',
      };
    }

    if (options?.hasUnsavedCaseEdits === true) {
      this.setState({
        errorMessage:
          'Save the human review case edits and align the catalog draft before recording binary safety evidence.',
      });
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'DIRTY_HUMAN_REVIEW_CASE_LOCK',
      };
    }

    if (
      options?.savedCaseStatus !== undefined &&
      options.savedCaseStatus !== 'METADATA_RECORDED'
    ) {
      this.setState({
        phase: 'hold',
        holdState: {
          errorCode: 'CASE_NOT_METADATA_RECORDED',
          errorMessage:
            'Human review case must be saved in METADATA_RECORDED status before binary safety casework.',
        },
      });
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'CASE_NOT_METADATA_RECORDED',
      };
    }

    const currentSnapshot = this.state.snapshot;
    if (!currentSnapshot) {
      this.setState({
        phase: 'hold',
        holdState: {
          errorCode: 'SNAPSHOT_NOT_LOADED',
          errorMessage: 'Load the binary safety case snapshot before saving.',
        },
      });
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'SNAPSHOT_NOT_LOADED',
      };
    }

    const resolvedAckRevision =
      options?.acknowledgedHumanCaseRevision !== undefined
        ? options.acknowledgedHumanCaseRevision
        : this.state.acknowledgedCurrentCaseRevision
        ? currentSnapshot.effectiveHumanCaseRevision
        : undefined;

    if (
      resolvedAckRevision === undefined ||
      typeof resolvedAckRevision !== 'number' ||
      !Number.isSafeInteger(resolvedAckRevision) ||
      resolvedAckRevision !== currentSnapshot.effectiveHumanCaseRevision
    ) {
      this.setState({
        errorMessage:
          'Explicit acknowledgement of the current effective human review case revision is required before saving.',
      });
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'UNACKNOWLEDGED_CASE_REVISION_HOLD',
      };
    }

    const inputValidation = validateClientBinarySafetyCaseInput(input);
    if (!inputValidation.ok) {
      this.setState({
        errorMessage: inputValidation.errorMessage,
      });
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: inputValidation.errorCode,
      };
    }

    if (
      currentSnapshot.requiresFreshEvidence &&
      currentSnapshot.binarySafetyCase &&
      currentSnapshot.binarySafetyCase.disposition ===
        inputValidation.value.disposition &&
      currentSnapshot.binarySafetyCase.evidenceReference ===
        inputValidation.value.evidenceReference &&
      currentSnapshot.binarySafetyCase.evidenceNotes ===
        inputValidation.value.evidenceNotes &&
      currentSnapshot.binarySafetyCase.reviewNotes ===
        inputValidation.value.reviewNotes
    ) {
      this.setState({
        errorMessage:
          'Stale binary safety evidence cannot be reused verbatim; enter fresh evidence for the current human case revision.',
      });
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'STALE_BINARY_SAFETY_EVIDENCE_HOLD',
      };
    }

    const activeToken = ++this.sessionToken;
    const targetReceiptId = this.receiptId;

    this.setState({
      phase: 'saving',
      inFlight: true,
      errorMessage: null,
      sessionToken: activeToken,
    });

    try {
      const rawResponse = await this.invokeBackend(
        'saveQuarantineBinarySafetyCase',
        {
          expectedRevision,
          acknowledgedHumanCaseRevision: resolvedAckRevision,
          input: inputValidation.value,
        }
      );

      if (
        activeToken !== this.sessionToken ||
        targetReceiptId !== this.receiptId
      ) {
        return rawResponse;
      }

      const validated = validateSaveQuarantineBinarySafetyCaseResponseDto(
        rawResponse,
        targetReceiptId
      );

      if (!validated) {
        // After dispatching save, a malformed response means commit outcome is uncertain -> UNKNOWN
        this.setState({
          phase: 'uncertain',
          inFlight: false,
          uncertainState: {
            errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
            errorMessage:
              'Save response failed contract validation; commit status is uncertain. Verify record state via GET before retrying.',
            caseSaved: null,
          },
        });
        return {
          ok: false,
          outcome: 'UNKNOWN',
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
          caseSaved: null,
        };
      }

      if (!validated.ok) {
        if (validated.outcome === 'CONFLICT') {
          this.setState({
            phase: 'conflict',
            inFlight: false,
            conflictState: {
              currentRevision: validated.currentRevision,
              currentBinarySafetyCase: validated.currentBinarySafetyCase,
              errorMessage: validated.errorMessage,
            },
          });
          return validated;
        }
        if (validated.outcome === 'HOLD') {
          this.setState({
            phase: 'hold',
            inFlight: false,
            holdState: {
              errorCode: validated.errorCode,
              errorMessage: validated.errorMessage,
            },
          });
          return validated;
        }
        this.setState({
          phase: 'uncertain',
          inFlight: false,
          uncertainState: {
            errorCode: validated.errorCode,
            errorMessage: validated.errorMessage,
            caseSaved: null,
          },
        });
        return validated;
      }

      this.setState({
        phase: 'ready',
        inFlight: false,
        acknowledgedCurrentCaseRevision: false,
        lastSaveOutcome: validated.caseSaveOutcome,
        snapshot: Object.freeze({
          documentId: validated.documentId,
          sourceRevision: validated.sourceRevision,
          sourceUpdatedAt: validated.sourceUpdatedAt,
          sourceFormat: validated.sourceFormat,
          deepInspectionStatus: validated.deepInspectionStatus,
          catalogHandoffCaseRevision: validated.catalogHandoffCaseRevision,
          currentHumanCaseRevision: validated.currentHumanCaseRevision,
          effectiveHumanCaseRevision: validated.effectiveHumanCaseRevision,
          effectiveHumanCaseUpdatedAt: validated.effectiveHumanCaseUpdatedAt,
          catalogUpdatedAt: validated.catalogUpdatedAt,
          currentRevision: validated.currentRevision,
          isCaseCurrent: true,
          requiresFreshEvidence: false,
          readiness: validated.readiness,
          binarySafetyCase: validated.binarySafetyCase,
          stalePreviousCase: null,
        }),
        holdState: null,
        conflictState: null,
        uncertainState: null,
      });

      return validated;
    } catch {
      if (
        activeToken !== this.sessionToken ||
        targetReceiptId !== this.receiptId
      ) {
        return {
          ok: false,
          outcome: 'UNKNOWN',
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
          caseSaved: null,
        };
      }
      this.setState({
        phase: 'uncertain',
        inFlight: false,
        uncertainState: {
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
          errorMessage:
            'Network or callable failure after staging save request; verify record state via GET before retrying.',
          caseSaved: null,
        },
      });
      return {
        ok: false,
        outcome: 'UNKNOWN',
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
        errorMessage:
          'Network or callable failure after staging save request; verify record state via GET before retrying.',
        caseSaved: null,
      };
    }
  }
}
