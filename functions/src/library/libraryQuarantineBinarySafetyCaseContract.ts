import {
  QUARANTINE_RIGHTS_READINESS_INDICATORS,
  deriveQuarantineCatalogDocumentIdFromReceipt,
  type LibraryQuarantineReadinessIndicatorsDto,
} from './libraryQuarantineRightsDecisionContract';
import {
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';

export type { LibraryQuarantineReadinessIndicatorsDto };
export { deriveQuarantineCatalogDocumentIdFromReceipt };

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

export function isValidSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_REGEX.test(value);
}

export const LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENT_SCHEMA_VERSION = 1 as const;

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

export const LIBRARY_QUARANTINE_BINARY_SAFETY_DEEP_INSPECTION_STATUSES = Object.freeze([
  'PDF_REQUIRES_ISOLATED_PARSER',
  'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
] as const);

export type LibraryQuarantineBinarySafetyDeepInspectionStatus =
  (typeof LIBRARY_QUARANTINE_BINARY_SAFETY_DEEP_INSPECTION_STATUSES)[number];

export const BINARY_SAFETY_EVIDENCE_REFERENCE_MAX_LENGTH = 500 as const;
export const BINARY_SAFETY_NOTES_MAX_LENGTH = 2000 as const;

export const QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS: LibraryQuarantineReadinessIndicatorsDto =
  QUARANTINE_RIGHTS_READINESS_INDICATORS;

const BIDI_OR_INVISIBLE_FORMAT_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|blob\s*:|gs:\/\/|https?:\/\/|\/quarantine\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com|x-goog-signature|\.\.\/|\.\.\\)/i;

const ALLOWED_EDITORIAL_INPUT_KEYS: ReadonlySet<string> = new Set([
  'disposition',
  'evidenceReference',
  'evidenceNotes',
  'reviewNotes',
]);

const PERSISTED_BINARY_SAFETY_CASE_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'receiptId',
  'documentId',
  'revision',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'sourceFormat',
  'deepInspectionStatus',
  'effectiveHumanCaseRevision',
  'effectiveHumanCaseUpdatedAt',
  'catalogUpdatedAt',
  'disposition',
  'evidenceReference',
  'evidenceNotes',
  'reviewNotes',
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

const PERSISTED_BINARY_SAFETY_CASE_EVENT_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'eventId',
  'receiptId',
  'documentId',
  'revision',
  'previousRevision',
  'eventType',
  'sourceRevision',
  'sourceUpdatedAt',
  'sourceSha256',
  'sourceFormat',
  'deepInspectionStatus',
  'effectiveHumanCaseRevision',
  'effectiveHumanCaseUpdatedAt',
  'catalogUpdatedAt',
  'disposition',
  'evidenceReference',
  'evidenceNotes',
  'reviewNotes',
  'actorUid',
  'recordedAt',
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
  return proto === Object.prototype || proto === null;
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

export function deriveLibraryQuarantineBinarySafetyCaseEventId(
  receiptId: string,
  revision: number
): string {
  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    throw new Error(
      'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(
      'INVALID_BINARY_SAFETY_REVISION: revision must be a positive safe integer.'
    );
  }
  return `${receiptId}_${revision}`;
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

export interface LibraryQuarantinePersistedBinarySafetyCase
  extends LibraryQuarantineBinarySafetyEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly effectiveHumanCaseRevision: number;
  readonly effectiveHumanCaseUpdatedAt: string;
  readonly catalogUpdatedAt: string;
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

export type LibraryQuarantineBinarySafetyCaseAuditEventType =
  | 'CREATED'
  | 'UPDATED';

export interface LibraryQuarantinePersistedBinarySafetyCaseEvent
  extends LibraryQuarantineBinarySafetyEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly previousRevision: number;
  readonly eventType: LibraryQuarantineBinarySafetyCaseAuditEventType;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly sourceFormat: LibraryQuarantineBinarySafetySourceFormat;
  readonly deepInspectionStatus: LibraryQuarantineBinarySafetyDeepInspectionStatus;
  readonly effectiveHumanCaseRevision: number;
  readonly effectiveHumanCaseUpdatedAt: string;
  readonly catalogUpdatedAt: string;
  readonly actorUid: string;
  readonly recordedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
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

export type LibraryQuarantineBinarySafetyCaseContractErrorCode =
  | 'INVALID_BINARY_SAFETY_INPUT_OBJECT'
  | 'UNTRUSTED_OR_FORBIDDEN_BINARY_SAFETY_FIELD'
  | 'INVALID_BINARY_SAFETY_DISPOSITION'
  | 'INVALID_PLAIN_TEXT_FIELD'
  | 'FIELD_MAX_LENGTH_EXCEEDED'
  | 'EXTERNAL_REPORT_REQUIREMENTS_NOT_MET'
  | 'DO_NOT_PROCESS_JUSTIFICATION_REQUIRED'
  | 'EMPTY_BINARY_SAFETY_CASE_NOT_ALLOWED'
  | 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA'
  | 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA'
  | 'SECURITY_POSTURE_VIOLATION';

export interface ValidateBinarySafetyEditorialInputSuccess {
  readonly ok: true;
  readonly value: LibraryQuarantineBinarySafetyEditorialFields;
}

export interface ValidateBinarySafetyContractFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineBinarySafetyCaseContractErrorCode;
  readonly errorMessage: string;
}

export type ValidateBinarySafetyEditorialInputResult =
  | ValidateBinarySafetyEditorialInputSuccess
  | ValidateBinarySafetyContractFailure;

export interface ValidatePersistedBinarySafetyCaseSuccess {
  readonly ok: true;
  readonly value: LibraryQuarantinePersistedBinarySafetyCase;
}

export type ValidatePersistedBinarySafetyCaseResult =
  | ValidatePersistedBinarySafetyCaseSuccess
  | ValidateBinarySafetyContractFailure;

export interface ValidatePersistedBinarySafetyCaseEventSuccess {
  readonly ok: true;
  readonly value: LibraryQuarantinePersistedBinarySafetyCaseEvent;
}

export type ValidatePersistedBinarySafetyCaseEventResult =
  | ValidatePersistedBinarySafetyCaseEventSuccess
  | ValidateBinarySafetyContractFailure;

function sanitizePlainTextField(
  raw: unknown,
  maxLength: number,
  allowNewline: boolean,
  fieldName: string
):
  | { readonly ok: true; readonly value: string }
  | ValidateBinarySafetyContractFailure {
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

export function validateSaveLibraryQuarantineBinarySafetyCaseInput(
  rawInput: unknown
): ValidateBinarySafetyEditorialInputResult {
  if (!isPlainRecord(rawInput)) {
    return {
      ok: false,
      errorCode: 'INVALID_BINARY_SAFETY_INPUT_OBJECT',
      errorMessage: 'Binary safety input must be a plain object.',
    };
  }

  if (Object.getOwnPropertySymbols(rawInput).length > 0) {
    return {
      ok: false,
      errorCode: 'UNTRUSTED_OR_FORBIDDEN_BINARY_SAFETY_FIELD',
      errorMessage: 'Symbol properties are forbidden in binary safety input.',
    };
  }

  for (const key of Object.keys(rawInput)) {
    if (!ALLOWED_EDITORIAL_INPUT_KEYS.has(key)) {
      return {
        ok: false,
        errorCode: 'UNTRUSTED_OR_FORBIDDEN_BINARY_SAFETY_FIELD',
        errorMessage: `Unexpected or forbidden field in binary safety input: ${key}.`,
      };
    }
  }

  const dispositionRaw = rawInput.disposition;
  if (
    typeof dispositionRaw !== 'string' ||
    !ALLOWED_DISPOSITION_SET.has(dispositionRaw)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_BINARY_SAFETY_DISPOSITION',
      errorMessage: `Invalid disposition: ${String(
        dispositionRaw
      )}. Must be one of ISOLATED_ASSESSMENT_REQUIRED, EXTERNAL_REPORT_NOT_VERIFIED, DO_NOT_PROCESS.`,
    };
  }

  const disposition = dispositionRaw as LibraryQuarantineBinarySafetyDisposition;

  const evRefRes = sanitizePlainTextField(
    rawInput.evidenceReference,
    BINARY_SAFETY_EVIDENCE_REFERENCE_MAX_LENGTH,
    false,
    'evidenceReference'
  );
  if (!evRefRes.ok) {
    return evRefRes;
  }

  const evNotesRes = sanitizePlainTextField(
    rawInput.evidenceNotes,
    BINARY_SAFETY_NOTES_MAX_LENGTH,
    true,
    'evidenceNotes'
  );
  if (!evNotesRes.ok) {
    return evNotesRes;
  }

  const revNotesRes = sanitizePlainTextField(
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
        'Binary safety case requires at least one non-empty evidenceReference, evidenceNotes, or reviewNotes field.',
    };
  }

  if (disposition === 'EXTERNAL_REPORT_NOT_VERIFIED') {
    if (evidenceReference.length === 0 || evidenceNotes.length === 0) {
      return {
        ok: false,
        errorCode: 'EXTERNAL_REPORT_REQUIREMENTS_NOT_MET',
        errorMessage:
          'EXTERNAL_REPORT_NOT_VERIFIED requires both evidenceReference and evidenceNotes to be provided.',
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

export function validatePersistedLibraryQuarantineBinarySafetyCase(
  raw: unknown,
  expectedReceiptId?: string
): ValidatePersistedBinarySafetyCaseResult {
  if (!isPlainRecord(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage:
        'Persisted binary safety case must be a plain object without symbol properties.',
    };
  }

  const keys = Object.keys(raw);
  if (
    keys.length !== PERSISTED_BINARY_SAFETY_CASE_KEYS.size ||
    !keys.every((k) => PERSISTED_BINARY_SAFETY_CASE_KEYS.has(k))
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage:
        'Persisted binary safety case failed strict 25-field schema validation.',
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
        'All five binary safety security posture flags must remain strictly false.',
    };
  }

  if (raw.schemaVersion !== LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid binary safety case schemaVersion.',
    };
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId) ||
    (expectedReceiptId !== undefined && raw.receiptId !== expectedReceiptId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid or mismatched receiptId in persisted binary safety case.',
    };
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentIdFromReceipt(raw.receiptId);
  if (raw.documentId !== expectedDocumentId) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid documentId in persisted binary safety case.',
    };
  }

  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid revision in persisted binary safety case.',
    };
  }

  if (
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid sourceRevision in persisted binary safety case.',
    };
  }

  if (
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid sourceUpdatedAt in persisted binary safety case.',
    };
  }

  if (
    typeof raw.sourceSha256 !== 'string' ||
    !isValidSha256Hex(raw.sourceSha256)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid sourceSha256 in persisted binary safety case.',
    };
  }

  if (
    !isMatchingSourceFormatAndDeepInspection(
      raw.sourceFormat,
      raw.deepInspectionStatus
    )
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage:
        'sourceFormat and deepInspectionStatus must be a valid PDF or DOCX quarantine pair.',
    };
  }

  if (
    typeof raw.effectiveHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
    raw.effectiveHumanCaseRevision < 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage:
        'Invalid effectiveHumanCaseRevision in persisted binary safety case.',
    };
  }

  if (
    typeof raw.effectiveHumanCaseUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.effectiveHumanCaseUpdatedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage:
        'Invalid effectiveHumanCaseUpdatedAt in persisted binary safety case.',
    };
  }

  if (
    typeof raw.catalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.catalogUpdatedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid catalogUpdatedAt in persisted binary safety case.',
    };
  }

  if (
    typeof raw.createdBy !== 'string' ||
    !isValidUploaderUid(raw.createdBy) ||
    typeof raw.updatedBy !== 'string' ||
    !isValidUploaderUid(raw.updatedBy)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: 'Invalid createdBy or updatedBy UID in persisted binary safety case.',
    };
  }

  if (
    typeof raw.createdAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.createdAt) ||
    typeof raw.updatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.updatedAt) ||
    Date.parse(raw.updatedAt) < Date.parse(raw.createdAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage:
        'Invalid or non-monotonic createdAt/updatedAt timestamps in persisted binary safety case.',
    };
  }

  if (raw.revision === 1) {
    if (raw.createdAt !== raw.updatedAt || raw.createdBy !== raw.updatedBy) {
      return {
        ok: false,
        errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
        errorMessage:
          'Initial revision 1 must have matching createdAt/updatedAt and createdBy/updatedBy.',
      };
    }
  }

  const editorialCheck = validateSaveLibraryQuarantineBinarySafetyCaseInput({
    disposition: raw.disposition,
    evidenceReference: raw.evidenceReference,
    evidenceNotes: raw.evidenceNotes,
    reviewNotes: raw.reviewNotes,
  });
  if (!editorialCheck.ok) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage: editorialCheck.errorMessage,
    };
  }

  if (
    raw.evidenceReference !== editorialCheck.value.evidenceReference ||
    raw.evidenceNotes !== editorialCheck.value.evidenceNotes ||
    raw.reviewNotes !== editorialCheck.value.reviewNotes
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_SCHEMA',
      errorMessage:
        'Persisted editorial fields must be canonical NFC-normalized trimmed strings.',
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
      receiptId: raw.receiptId,
      documentId: expectedDocumentId,
      revision: raw.revision,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
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

export function validatePersistedLibraryQuarantineBinarySafetyCaseEvent(
  raw: unknown,
  expectedEventId?: string
): ValidatePersistedBinarySafetyCaseEventResult {
  if (!isPlainRecord(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage:
        'Persisted binary safety audit event must be a plain object without symbol properties.',
    };
  }

  const keys = Object.keys(raw);
  if (
    keys.length !== PERSISTED_BINARY_SAFETY_CASE_EVENT_KEYS.size ||
    !keys.every((k) => PERSISTED_BINARY_SAFETY_CASE_EVENT_KEYS.has(k))
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage:
        'Persisted binary safety audit event failed strict 26-field schema validation.',
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
        'All five binary safety audit event security posture flags must remain strictly false.',
    };
  }

  if (
    raw.schemaVersion !== LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage: 'Invalid binary safety audit event schemaVersion.',
    };
  }

  if (
    typeof raw.receiptId !== 'string' ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage: 'Invalid receiptId in persisted binary safety audit event.',
    };
  }

  const expectedDocumentId = deriveQuarantineCatalogDocumentIdFromReceipt(raw.receiptId);
  if (raw.documentId !== expectedDocumentId) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage: 'Invalid documentId in persisted binary safety audit event.',
    };
  }

  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage: 'Invalid revision in persisted binary safety audit event.',
    };
  }

  if (
    typeof raw.previousRevision !== 'number' ||
    !Number.isSafeInteger(raw.previousRevision) ||
    raw.previousRevision !== raw.revision - 1
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage:
        'previousRevision must equal revision - 1 in persisted binary safety audit event.',
    };
  }

  const expectedEventType: LibraryQuarantineBinarySafetyCaseAuditEventType =
    raw.revision === 1 ? 'CREATED' : 'UPDATED';
  if (raw.eventType !== expectedEventType) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage: 'eventType does not match revision transition.',
    };
  }

  const derivedEventId = deriveLibraryQuarantineBinarySafetyCaseEventId(
    raw.receiptId,
    raw.revision
  );
  if (
    raw.eventId !== derivedEventId ||
    (expectedEventId !== undefined && raw.eventId !== expectedEventId)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage:
        'eventId must deterministically match <receiptId>_<revision> and its Firestore document ID.',
    };
  }

  if (
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    typeof raw.sourceUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    typeof raw.sourceSha256 !== 'string' ||
    !isValidSha256Hex(raw.sourceSha256) ||
    !isMatchingSourceFormatAndDeepInspection(
      raw.sourceFormat,
      raw.deepInspectionStatus
    ) ||
    typeof raw.effectiveHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.effectiveHumanCaseRevision) ||
    raw.effectiveHumanCaseRevision < 1 ||
    typeof raw.effectiveHumanCaseUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.effectiveHumanCaseUpdatedAt) ||
    typeof raw.catalogUpdatedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.catalogUpdatedAt) ||
    typeof raw.actorUid !== 'string' ||
    !isValidUploaderUid(raw.actorUid) ||
    typeof raw.recordedAt !== 'string' ||
    !isValidIsoUtcTimestamp(raw.recordedAt)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage:
        'Invalid provenance, actor, or timestamp field in persisted binary safety audit event.',
    };
  }

  const editorialCheck = validateSaveLibraryQuarantineBinarySafetyCaseInput({
    disposition: raw.disposition,
    evidenceReference: raw.evidenceReference,
    evidenceNotes: raw.evidenceNotes,
    reviewNotes: raw.reviewNotes,
  });
  if (
    !editorialCheck.ok ||
    raw.evidenceReference !== editorialCheck.value.evidenceReference ||
    raw.evidenceNotes !== editorialCheck.value.evidenceNotes ||
    raw.reviewNotes !== editorialCheck.value.reviewNotes
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PERSISTED_BINARY_SAFETY_EVENT_SCHEMA',
      errorMessage:
        'Invalid editorial fields in persisted binary safety audit event.',
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENT_SCHEMA_VERSION,
      eventId: derivedEventId,
      receiptId: raw.receiptId,
      documentId: expectedDocumentId,
      revision: raw.revision,
      previousRevision: raw.previousRevision,
      eventType: expectedEventType,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
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

export function toSanitizedLibraryQuarantineBinarySafetyCaseDto(
  persisted: LibraryQuarantinePersistedBinarySafetyCase
): SanitizedLibraryQuarantineBinarySafetyCaseDto {
  const validated = validatePersistedLibraryQuarantineBinarySafetyCase(persisted);
  if (!validated.ok) {
    throw new Error(`${validated.errorCode}: ${validated.errorMessage}`);
  }
  const c = validated.value;
  return Object.freeze({
    schemaVersion: c.schemaVersion,
    receiptId: c.receiptId,
    documentId: c.documentId,
    revision: c.revision,
    sourceRevision: c.sourceRevision,
    sourceUpdatedAt: c.sourceUpdatedAt,
    sourceFormat: c.sourceFormat,
    deepInspectionStatus: c.deepInspectionStatus,
    effectiveHumanCaseRevision: c.effectiveHumanCaseRevision,
    effectiveHumanCaseUpdatedAt: c.effectiveHumanCaseUpdatedAt,
    catalogUpdatedAt: c.catalogUpdatedAt,
    disposition: c.disposition,
    evidenceReference: c.evidenceReference,
    evidenceNotes: c.evidenceNotes,
    reviewNotes: c.reviewNotes,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });
}
