import {
  QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX,
  QUARANTINE_CATALOG_DOCUMENT_ID_REGEX,
} from './libraryApplicationService';
import {
  LIBRARY_QUARANTINE_STORAGE_PREFIX,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';

/**
 * LIB-FILE-RIGHTS-AND-READINESS-01 — Server-Side Human Rights Review Decision,
 * Evidence Ledger, and Internal Library Readiness Contract
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Defines the strict contract for human rights review decisions on internal
 *   quarantine catalog drafts (`documentId = "qcat-" + receiptId`), persisted in
 *   `library_quarantine_rights_decisions/<receiptId>` with append-only audit events
 *   in `library_quarantine_rights_decision_events/<receiptId>_<revision>`.
 * - Scope is strictly fixed to `rightsScope = 'CATALOG_METADATA_ONLY'`. Even when
 *   a human rights reviewer records `decision = 'METADATA_USE_CLEARED'`, it clears
 *   ONLY internal descriptive catalog metadata use — NEVER binary PDF/DOCX safety,
 *   file sanitization, PEIA readiness, or public publication.
 * - Constant readiness indicators (`QUARANTINE_RIGHTS_READINESS_INDICATORS`) remain:
 *     - `binarySafety: 'NOT_VERIFIED'`
 *     - `fileSanitization: 'NOT_PERFORMED'`
 *     - `publication: 'BLOCKED'`
 *     - `catalogWorkflow: 'Draft'`
 *   and all five non-assurance flags (`isSanitized`, `isVerifiedSafe`,
 *   `isRightsApproved`, `isPublished`, `isReadyForPeia`) remain `false`.
 * - Sanitized administrative DTOs (`SanitizedLibraryQuarantineRightsDecisionDto`)
 *   omit `sourceSha256`, `createdBy`, `updatedBy`, `actorUid`, `storagePath`,
 *   `generation`, bucket names, URLs, download tokens, and raw binary bytes.
 */

export const LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENT_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_RIGHTS_SCOPE = 'CATALOG_METADATA_ONLY' as const;

export const LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES = Object.freeze([
  'EVIDENCE_PENDING',
  'PERMISSION_REQUIRED',
  'METADATA_USE_CLEARED',
  'RESTRICTED',
  'NOT_PERMITTED',
] as const);

export type LibraryQuarantineRightsDecisionStatus =
  (typeof LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES)[number];

const ALLOWED_DECISION_STATUS_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES
);

export const LIBRARY_QUARANTINE_RIGHTS_BASES = Object.freeze([
  'OFFICIAL_RECORD',
  'OPEN_LICENSE',
  'EXPLICIT_PERMISSION_METADATA',
  'PUBLIC_DOMAIN',
  'INTERNAL_ONLY',
  'UNDETERMINED',
] as const);

export type LibraryQuarantineRightsBasis =
  (typeof LIBRARY_QUARANTINE_RIGHTS_BASES)[number];

const ALLOWED_RIGHTS_BASIS_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_RIGHTS_BASES
);

export const RIGHTS_DECISION_EVIDENCE_REFERENCE_MAX_LENGTH = 500 as const;
export const RIGHTS_DECISION_NOTES_MAX_LENGTH = 2000 as const;

export interface LibraryQuarantineReadinessIndicatorsDto {
  readonly binarySafety: 'NOT_VERIFIED';
  readonly fileSanitization: 'NOT_PERFORMED';
  readonly publication: 'BLOCKED';
  readonly catalogWorkflow: 'Draft';
}

export const QUARANTINE_RIGHTS_READINESS_INDICATORS: LibraryQuarantineReadinessIndicatorsDto =
  Object.freeze({
    binarySafety: 'NOT_VERIFIED' as const,
    fileSanitization: 'NOT_PERFORMED' as const,
    publication: 'BLOCKED' as const,
    catalogWorkflow: 'Draft' as const,
  });

const SHA256_LOWERCASE_HEX_REGEX = /^[0-9a-f]{64}$/;

const BIDI_OR_INVISIBLE_FORMAT_REGEX =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

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

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|gs:\/\/|https?:\/\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com|x-goog-signature)/i;

export interface LibraryQuarantineRightsDecisionEditorialFields {
  readonly decision: LibraryQuarantineRightsDecisionStatus;
  readonly basis: LibraryQuarantineRightsBasis;
  readonly evidenceReference: string;
  readonly evidenceNotes: string;
  readonly reviewNotes: string;
}

export interface SaveLibraryQuarantineRightsDecisionInput {
  readonly decision: LibraryQuarantineRightsDecisionStatus;
  readonly basis: LibraryQuarantineRightsBasis;
  readonly evidenceReference?: string;
  readonly evidenceNotes?: string;
  readonly reviewNotes?: string;
}

/**
 * Exact 25-field persisted Firestore document in
 * `library_quarantine_rights_decisions/<receiptId>`.
 */
export interface LibraryQuarantinePersistedRightsDecision
  extends LibraryQuarantineRightsDecisionEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly draftSourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
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

export type LibraryQuarantineRightsDecisionAuditEventType =
  | 'CREATED'
  | 'UPDATED';

/**
 * Exact 26-field append-only persisted Firestore audit event in
 * `library_quarantine_rights_decision_events/<receiptId>_<revision>`.
 */
export interface LibraryQuarantinePersistedRightsDecisionEvent
  extends LibraryQuarantineRightsDecisionEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly previousRevision: number;
  readonly eventType: LibraryQuarantineRightsDecisionAuditEventType;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly draftSourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly actorUid: string;
  readonly recordedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

/**
 * Sanitized 22-field DTO returned to authorized human Library rights reviewers.
 * Omits `sourceSha256`, `createdBy`, and `updatedBy`.
 */
export interface SanitizedLibraryQuarantineRightsDecisionDto
  extends LibraryQuarantineRightsDecisionEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly draftSourceRevision: number;
  readonly catalogHandoffCaseRevision: number;
  readonly currentHumanCaseRevision: number;
  readonly rightsScope: typeof LIBRARY_QUARANTINE_RIGHTS_SCOPE;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isSanitized: false;
  readonly isVerifiedSafe: false;
  readonly isRightsApproved: false;
  readonly isPublished: false;
  readonly isReadyForPeia: false;
}

export type LibraryQuarantineRightsDecisionContractErrorCode =
  | 'INVALID_RIGHTS_DECISION_INPUT_OBJECT'
  | 'UNTRUSTED_OR_FORBIDDEN_RIGHTS_FIELD'
  | 'INVALID_RIGHTS_DECISION_STATUS'
  | 'INVALID_RIGHTS_BASIS'
  | 'INVALID_PLAIN_TEXT_FIELD'
  | 'FIELD_MAX_LENGTH_EXCEEDED'
  | 'METADATA_USE_CLEARED_REQUIREMENTS_NOT_MET'
  | 'JUSTIFICATION_NOTES_REQUIRED'
  | 'EMPTY_RIGHTS_DECISION_NOT_ALLOWED'
  | 'INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA'
  | 'INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA'
  | 'SECURITY_POSTURE_VIOLATION';

export interface ValidateRightsDecisionEditorialInputSuccess {
  readonly ok: true;
  readonly value: LibraryQuarantineRightsDecisionEditorialFields;
}

export interface ValidateRightsDecisionContractFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineRightsDecisionContractErrorCode;
  readonly errorMessage: string;
}

export type ValidateRightsDecisionEditorialInputResult =
  | ValidateRightsDecisionEditorialInputSuccess
  | ValidateRightsDecisionContractFailure;

export interface ValidatePersistedRightsDecisionSuccess {
  readonly ok: true;
  readonly rightsDecision: LibraryQuarantinePersistedRightsDecision;
}

export type ValidatePersistedRightsDecisionResult =
  | ValidatePersistedRightsDecisionSuccess
  | ValidateRightsDecisionContractFailure;

export interface ValidatePersistedRightsDecisionEventSuccess {
  readonly ok: true;
  readonly rightsEvent: LibraryQuarantinePersistedRightsDecisionEvent;
}

export type ValidatePersistedRightsDecisionEventResult =
  | ValidatePersistedRightsDecisionEventSuccess
  | ValidateRightsDecisionContractFailure;

export const RIGHTS_DECISION_CONTRACT_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineRightsDecisionContractErrorCode, string>
> = Object.freeze({
  INVALID_RIGHTS_DECISION_INPUT_OBJECT:
    'Rights decision input must be a plain object with allowed editorial fields only.',
  UNTRUSTED_OR_FORBIDDEN_RIGHTS_FIELD:
    'Rights decision payload contains an unexpected, privileged, or forbidden property.',
  INVALID_RIGHTS_DECISION_STATUS:
    'Rights decision must be one of EVIDENCE_PENDING, PERMISSION_REQUIRED, METADATA_USE_CLEARED, RESTRICTED, or NOT_PERMITTED.',
  INVALID_RIGHTS_BASIS:
    'Rights basis must be one of OFFICIAL_RECORD, OPEN_LICENSE, EXPLICIT_PERMISSION_METADATA, PUBLIC_DOMAIN, INTERNAL_ONLY, or UNDETERMINED.',
  INVALID_PLAIN_TEXT_FIELD:
    'Rights decision text fields must be plain text without HTML tags, control/bidi characters, or forbidden URI schemes/paths.',
  FIELD_MAX_LENGTH_EXCEEDED:
    'One or more rights decision text fields exceed the maximum permitted character length.',
  METADATA_USE_CLEARED_REQUIREMENTS_NOT_MET:
    'METADATA_USE_CLEARED requires a determined rights basis (not UNDETERMINED), a non-empty evidenceReference, and non-empty evidenceNotes explaining verifiable metadata scope.',
  JUSTIFICATION_NOTES_REQUIRED:
    'RESTRICTED and NOT_PERMITTED decisions require non-empty reviewNotes or evidenceNotes.',
  EMPTY_RIGHTS_DECISION_NOT_ALLOWED:
    'Rights decision must include at least one non-empty evidenceReference, evidenceNotes, or reviewNotes field.',
  INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA:
    'Persisted rights decision record failed strict 25-field schema or integrity validation.',
  INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA:
    'Persisted rights decision audit event failed strict 26-field schema or integrity validation.',
  SECURITY_POSTURE_VIOLATION:
    'Persisted rights decision or audit event violated non-assurance security posture or CATALOG_METADATA_ONLY scope invariants.',
});

export const ALLOWED_RIGHTS_DECISION_INPUT_KEYS: ReadonlySet<string> = new Set([
  'decision',
  'basis',
  'evidenceReference',
  'evidenceNotes',
  'reviewNotes',
]);

export const ALLOWED_PERSISTED_RIGHTS_DECISION_KEYS: ReadonlySet<string> =
  new Set([
    'schemaVersion',
    'receiptId',
    'documentId',
    'revision',
    'sourceRevision',
    'sourceUpdatedAt',
    'sourceSha256',
    'draftSourceRevision',
    'catalogHandoffCaseRevision',
    'currentHumanCaseRevision',
    'rightsScope',
    'decision',
    'basis',
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

export const ALLOWED_PERSISTED_RIGHTS_EVENT_KEYS: ReadonlySet<string> = new Set([
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
  'draftSourceRevision',
  'catalogHandoffCaseRevision',
  'currentHumanCaseRevision',
  'rightsScope',
  'decision',
  'basis',
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

export const ALLOWED_SANITIZED_RIGHTS_DECISION_DTO_KEYS: ReadonlySet<string> =
  new Set([
    'schemaVersion',
    'receiptId',
    'documentId',
    'revision',
    'sourceRevision',
    'sourceUpdatedAt',
    'draftSourceRevision',
    'catalogHandoffCaseRevision',
    'currentHumanCaseRevision',
    'rightsScope',
    'decision',
    'basis',
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

export const FORBIDDEN_RIGHTS_DECISION_KEYS: ReadonlySet<string> = new Set([
  'rightsScope',
  'storagePath',
  'generation',
  'attestedGeneration',
  'gcsGeneration',
  'objectGeneration',
  'metageneration',
  'attestedStoragePath',
  'attestation',
  'bucket',
  'bucketName',
  'url',
  'signedUrl',
  'downloadUrl',
  'downloadToken',
  'referenceUrl',
  'token',
  'accessToken',
  'bytes',
  'rawBytes',
  'buffer',
  'isSanitized',
  'isVerifiedSafe',
  'isRightsApproved',
  'isPublished',
  'isReadyForPeia',
  'workflowState',
  'rightsStatus',
  'auth',
  'uid',
  'actorUid',
  'createdBy',
  'updatedBy',
  'role',
  'permissions',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function makeContractFailure(
  errorCode: LibraryQuarantineRightsDecisionContractErrorCode
): ValidateRightsDecisionContractFailure {
  return Object.freeze({
    ok: false as const,
    errorCode,
    errorMessage: RIGHTS_DECISION_CONTRACT_SAFE_MESSAGES[errorCode],
  });
}

export function deriveQuarantineCatalogDocumentIdFromReceipt(
  receiptId: string
): string {
  if (!isValidLibraryQuarantineReceiptId(receiptId)) {
    throw new Error(
      'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hexadecimal string.'
    );
  }
  return `${QUARANTINE_CATALOG_DOCUMENT_ID_PREFIX}${receiptId}`;
}

export function deriveLibraryQuarantineRightsDecisionEventId(
  receiptId: string,
  revision: number
): string {
  if (
    !isValidLibraryQuarantineReceiptId(receiptId) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    throw new Error(
      'INVALID_EVENT_ID_INPUT: receiptId must be 32-hex and revision must be a positive safe integer.'
    );
  }
  return `${receiptId}_${revision}`;
}

export function isValidLibraryQuarantineRightsDecisionStatus(
  value: unknown
): value is LibraryQuarantineRightsDecisionStatus {
  return typeof value === 'string' && ALLOWED_DECISION_STATUS_SET.has(value);
}

export function isValidLibraryQuarantineRightsBasis(
  value: unknown
): value is LibraryQuarantineRightsBasis {
  return typeof value === 'string' && ALLOWED_RIGHTS_BASIS_SET.has(value);
}

function validateAndNormalizeSingleLinePlainText(
  raw: unknown,
  maxLength: number
):
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly errorCode: LibraryQuarantineRightsDecisionContractErrorCode;
    } {
  if (raw === undefined) {
    return { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }
  if (
    hasForbiddenControlOrBidiChar(raw, false) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(raw) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(raw) ||
    raw.includes(LIBRARY_QUARANTINE_STORAGE_PREFIX)
  ) {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }
  const trimmed = raw.trim();
  if (trimmed.length > maxLength) {
    return { ok: false, errorCode: 'FIELD_MAX_LENGTH_EXCEEDED' };
  }
  return { ok: true, value: trimmed };
}

function validateAndNormalizeMultiLinePlainText(
  raw: unknown,
  maxLength: number
):
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly errorCode: LibraryQuarantineRightsDecisionContractErrorCode;
    } {
  if (raw === undefined) {
    return { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }
  const normalizedNewlines = raw.replace(/\r\n?/g, '\n');
  if (
    hasForbiddenControlOrBidiChar(normalizedNewlines, true) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(normalizedNewlines) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(normalizedNewlines) ||
    normalizedNewlines.includes(LIBRARY_QUARANTINE_STORAGE_PREFIX)
  ) {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }
  const trimmed = normalizedNewlines.trim();
  if (trimmed.length > maxLength) {
    return { ok: false, errorCode: 'FIELD_MAX_LENGTH_EXCEEDED' };
  }
  return { ok: true, value: trimmed };
}

function checkDecisionEditorialRequirements(
  fields: LibraryQuarantineRightsDecisionEditorialFields
): LibraryQuarantineRightsDecisionContractErrorCode | null {
  const hasAnyContent =
    fields.evidenceReference.length > 0 ||
    fields.evidenceNotes.length > 0 ||
    fields.reviewNotes.length > 0;

  if (!hasAnyContent) {
    return 'EMPTY_RIGHTS_DECISION_NOT_ALLOWED';
  }

  if (fields.decision === 'METADATA_USE_CLEARED') {
    if (
      fields.basis === 'UNDETERMINED' ||
      fields.evidenceReference.length === 0 ||
      fields.evidenceNotes.length === 0
    ) {
      return 'METADATA_USE_CLEARED_REQUIREMENTS_NOT_MET';
    }
  }

  if (
    fields.decision === 'RESTRICTED' ||
    fields.decision === 'NOT_PERMITTED'
  ) {
    if (fields.reviewNotes.length === 0 && fields.evidenceNotes.length === 0) {
      return 'JUSTIFICATION_NOTES_REQUIRED';
    }
  }

  return null;
}

/**
 * Validates and normalizes caller-supplied editorial input for saving a human rights decision.
 */
export function validateRightsDecisionInput(
  rawInput: unknown
): ValidateRightsDecisionEditorialInputResult {
  if (!isPlainObject(rawInput)) {
    return makeContractFailure('INVALID_RIGHTS_DECISION_INPUT_OBJECT');
  }
  if (Object.getOwnPropertySymbols(rawInput).length > 0) {
    return makeContractFailure('UNTRUSTED_OR_FORBIDDEN_RIGHTS_FIELD');
  }

  for (const key of Object.keys(rawInput)) {
    if (
      FORBIDDEN_RIGHTS_DECISION_KEYS.has(key) ||
      !ALLOWED_RIGHTS_DECISION_INPUT_KEYS.has(key)
    ) {
      return makeContractFailure('UNTRUSTED_OR_FORBIDDEN_RIGHTS_FIELD');
    }
  }

  if (!isValidLibraryQuarantineRightsDecisionStatus(rawInput.decision)) {
    return makeContractFailure('INVALID_RIGHTS_DECISION_STATUS');
  }
  if (!isValidLibraryQuarantineRightsBasis(rawInput.basis)) {
    return makeContractFailure('INVALID_RIGHTS_BASIS');
  }

  const evidenceRefRes = validateAndNormalizeSingleLinePlainText(
    rawInput.evidenceReference,
    RIGHTS_DECISION_EVIDENCE_REFERENCE_MAX_LENGTH
  );
  if (!evidenceRefRes.ok) {
    return makeContractFailure(evidenceRefRes.errorCode);
  }

  const evidenceNotesRes = validateAndNormalizeMultiLinePlainText(
    rawInput.evidenceNotes,
    RIGHTS_DECISION_NOTES_MAX_LENGTH
  );
  if (!evidenceNotesRes.ok) {
    return makeContractFailure(evidenceNotesRes.errorCode);
  }

  const reviewNotesRes = validateAndNormalizeMultiLinePlainText(
    rawInput.reviewNotes,
    RIGHTS_DECISION_NOTES_MAX_LENGTH
  );
  if (!reviewNotesRes.ok) {
    return makeContractFailure(reviewNotesRes.errorCode);
  }

  const normalizedFields: LibraryQuarantineRightsDecisionEditorialFields =
    Object.freeze({
      decision: rawInput.decision,
      basis: rawInput.basis,
      evidenceReference: evidenceRefRes.value,
      evidenceNotes: evidenceNotesRes.value,
      reviewNotes: reviewNotesRes.value,
    });

  const requirementErr = checkDecisionEditorialRequirements(normalizedFields);
  if (requirementErr !== null) {
    return makeContractFailure(requirementErr);
  }

  return Object.freeze({
    ok: true as const,
    value: normalizedFields,
  });
}

function validateStrictNormalizedSingleLineField(
  raw: unknown,
  maxLength: number
): raw is string {
  if (typeof raw !== 'string') {
    return false;
  }
  const res = validateAndNormalizeSingleLinePlainText(raw, maxLength);
  return res.ok && res.value === raw;
}

function validateStrictNormalizedMultiLineField(
  raw: unknown,
  maxLength: number
): raw is string {
  if (typeof raw !== 'string') {
    return false;
  }
  const res = validateAndNormalizeMultiLinePlainText(raw, maxLength);
  return res.ok && res.value === raw;
}

/**
 * Validates a persisted 25-field `LibraryQuarantinePersistedRightsDecision` document.
 */
export function validatePersistedLibraryQuarantineRightsDecision(
  raw: unknown,
  expectedReceiptId?: string
): ValidatePersistedRightsDecisionResult {
  if (!isPlainObject(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  const keys = Object.keys(raw);
  if (keys.length !== ALLOWED_PERSISTED_RIGHTS_DECISION_KEYS.size) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }
  for (const key of keys) {
    if (!ALLOWED_PERSISTED_RIGHTS_DECISION_KEYS.has(key)) {
      return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
    }
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false ||
    raw.rightsScope !== LIBRARY_QUARANTINE_RIGHTS_SCOPE
  ) {
    return makeContractFailure('SECURITY_POSTURE_VIOLATION');
  }

  if (
    raw.schemaVersion !== LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (
    expectedReceiptId !== undefined &&
    raw.receiptId !== expectedReceiptId
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  const expectedDocId = deriveQuarantineCatalogDocumentIdFromReceipt(
    raw.receiptId
  );
  if (
    typeof raw.documentId !== 'string' ||
    raw.documentId !== expectedDocId ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(raw.documentId)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1 ||
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    typeof raw.draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.draftSourceRevision) ||
    raw.draftSourceRevision !== raw.sourceRevision ||
    typeof raw.catalogHandoffCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.catalogHandoffCaseRevision) ||
    raw.catalogHandoffCaseRevision < 1 ||
    typeof raw.currentHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.currentHumanCaseRevision) ||
    raw.currentHumanCaseRevision !== raw.catalogHandoffCaseRevision
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    !isValidIsoUtcTimestamp(raw.createdAt) ||
    !isValidIsoUtcTimestamp(raw.updatedAt)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (
    Date.parse(raw.createdAt) < Date.parse(raw.sourceUpdatedAt) ||
    Date.parse(raw.updatedAt) < Date.parse(raw.createdAt)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (raw.revision === 1 && raw.updatedAt !== raw.createdAt) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(raw.sourceSha256)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (
    !isValidUploaderUid(raw.createdBy) ||
    !isValidUploaderUid(raw.updatedBy)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (raw.revision === 1 && raw.updatedBy !== raw.createdBy) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  if (
    !isValidLibraryQuarantineRightsDecisionStatus(raw.decision) ||
    !isValidLibraryQuarantineRightsBasis(raw.basis) ||
    !validateStrictNormalizedSingleLineField(
      raw.evidenceReference,
      RIGHTS_DECISION_EVIDENCE_REFERENCE_MAX_LENGTH
    ) ||
    !validateStrictNormalizedMultiLineField(
      raw.evidenceNotes,
      RIGHTS_DECISION_NOTES_MAX_LENGTH
    ) ||
    !validateStrictNormalizedMultiLineField(
      raw.reviewNotes,
      RIGHTS_DECISION_NOTES_MAX_LENGTH
    )
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  const editorialFields: LibraryQuarantineRightsDecisionEditorialFields = {
    decision: raw.decision,
    basis: raw.basis,
    evidenceReference: raw.evidenceReference,
    evidenceNotes: raw.evidenceNotes,
    reviewNotes: raw.reviewNotes,
  };

  if (checkDecisionEditorialRequirements(editorialFields) !== null) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_DECISION_SCHEMA');
  }

  const rightsDecision: LibraryQuarantinePersistedRightsDecision =
    Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
      receiptId: raw.receiptId,
      documentId: raw.documentId,
      revision: raw.revision,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
      draftSourceRevision: raw.draftSourceRevision,
      catalogHandoffCaseRevision: raw.catalogHandoffCaseRevision,
      currentHumanCaseRevision: raw.currentHumanCaseRevision,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      decision: raw.decision,
      basis: raw.basis,
      evidenceReference: raw.evidenceReference,
      evidenceNotes: raw.evidenceNotes,
      reviewNotes: raw.reviewNotes,
      createdBy: raw.createdBy,
      createdAt: raw.createdAt,
      updatedBy: raw.updatedBy,
      updatedAt: raw.updatedAt,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });

  return Object.freeze({
    ok: true as const,
    rightsDecision,
  });
}

/**
 * Validates a persisted 26-field `LibraryQuarantinePersistedRightsDecisionEvent` audit document.
 */
export function validatePersistedLibraryQuarantineRightsDecisionEvent(
  raw: unknown,
  expectedReceiptId?: string,
  expectedRevision?: number
): ValidatePersistedRightsDecisionEventResult {
  if (!isPlainObject(raw) || Object.getOwnPropertySymbols(raw).length > 0) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  const keys = Object.keys(raw);
  if (keys.length !== ALLOWED_PERSISTED_RIGHTS_EVENT_KEYS.size) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }
  for (const key of keys) {
    if (!ALLOWED_PERSISTED_RIGHTS_EVENT_KEYS.has(key)) {
      return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
    }
  }

  if (
    raw.isSanitized !== false ||
    raw.isVerifiedSafe !== false ||
    raw.isRightsApproved !== false ||
    raw.isPublished !== false ||
    raw.isReadyForPeia !== false ||
    raw.rightsScope !== LIBRARY_QUARANTINE_RIGHTS_SCOPE
  ) {
    return makeContractFailure('SECURITY_POSTURE_VIOLATION');
  }

  if (
    raw.schemaVersion !==
      LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENT_SCHEMA_VERSION ||
    !isValidLibraryQuarantineReceiptId(raw.receiptId)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  if (
    expectedReceiptId !== undefined &&
    raw.receiptId !== expectedReceiptId
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  const expectedDocId = deriveQuarantineCatalogDocumentIdFromReceipt(
    raw.receiptId
  );
  if (
    typeof raw.documentId !== 'string' ||
    raw.documentId !== expectedDocId ||
    !QUARANTINE_CATALOG_DOCUMENT_ID_REGEX.test(raw.documentId)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1 ||
    typeof raw.previousRevision !== 'number' ||
    !Number.isSafeInteger(raw.previousRevision) ||
    raw.previousRevision !== raw.revision - 1
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  if (expectedRevision !== undefined && raw.revision !== expectedRevision) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  const expectedEventId = deriveLibraryQuarantineRightsDecisionEventId(
    raw.receiptId,
    raw.revision
  );
  if (typeof raw.eventId !== 'string' || raw.eventId !== expectedEventId) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  const expectedEventType: LibraryQuarantineRightsDecisionAuditEventType =
    raw.revision === 1 ? 'CREATED' : 'UPDATED';
  if (raw.eventType !== expectedEventType) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  if (
    typeof raw.sourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.sourceRevision) ||
    raw.sourceRevision < 1 ||
    typeof raw.draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(raw.draftSourceRevision) ||
    raw.draftSourceRevision !== raw.sourceRevision ||
    typeof raw.catalogHandoffCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.catalogHandoffCaseRevision) ||
    raw.catalogHandoffCaseRevision < 1 ||
    typeof raw.currentHumanCaseRevision !== 'number' ||
    !Number.isSafeInteger(raw.currentHumanCaseRevision) ||
    raw.currentHumanCaseRevision !== raw.catalogHandoffCaseRevision
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  if (
    !isValidIsoUtcTimestamp(raw.sourceUpdatedAt) ||
    !isValidIsoUtcTimestamp(raw.recordedAt) ||
    Date.parse(raw.recordedAt) < Date.parse(raw.sourceUpdatedAt)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  if (
    typeof raw.sourceSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(raw.sourceSha256) ||
    !isValidUploaderUid(raw.actorUid)
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  if (
    !isValidLibraryQuarantineRightsDecisionStatus(raw.decision) ||
    !isValidLibraryQuarantineRightsBasis(raw.basis) ||
    !validateStrictNormalizedSingleLineField(
      raw.evidenceReference,
      RIGHTS_DECISION_EVIDENCE_REFERENCE_MAX_LENGTH
    ) ||
    !validateStrictNormalizedMultiLineField(
      raw.evidenceNotes,
      RIGHTS_DECISION_NOTES_MAX_LENGTH
    ) ||
    !validateStrictNormalizedMultiLineField(
      raw.reviewNotes,
      RIGHTS_DECISION_NOTES_MAX_LENGTH
    )
  ) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  const editorialFields: LibraryQuarantineRightsDecisionEditorialFields = {
    decision: raw.decision,
    basis: raw.basis,
    evidenceReference: raw.evidenceReference,
    evidenceNotes: raw.evidenceNotes,
    reviewNotes: raw.reviewNotes,
  };

  if (checkDecisionEditorialRequirements(editorialFields) !== null) {
    return makeContractFailure('INVALID_PERSISTED_RIGHTS_EVENT_SCHEMA');
  }

  const rightsEvent: LibraryQuarantinePersistedRightsDecisionEvent =
    Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_RIGHTS_DECISION_EVENT_SCHEMA_VERSION,
      eventId: raw.eventId,
      receiptId: raw.receiptId,
      documentId: raw.documentId,
      revision: raw.revision,
      previousRevision: raw.previousRevision,
      eventType: expectedEventType,
      sourceRevision: raw.sourceRevision,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      sourceSha256: raw.sourceSha256,
      draftSourceRevision: raw.draftSourceRevision,
      catalogHandoffCaseRevision: raw.catalogHandoffCaseRevision,
      currentHumanCaseRevision: raw.currentHumanCaseRevision,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      decision: raw.decision,
      basis: raw.basis,
      evidenceReference: raw.evidenceReference,
      evidenceNotes: raw.evidenceNotes,
      reviewNotes: raw.reviewNotes,
      actorUid: raw.actorUid,
      recordedAt: raw.recordedAt,
      isSanitized: false as const,
      isVerifiedSafe: false as const,
      isRightsApproved: false as const,
      isPublished: false as const,
      isReadyForPeia: false as const,
    });

  return Object.freeze({
    ok: true as const,
    rightsEvent,
  });
}

/**
 * Converts a validated `LibraryQuarantinePersistedRightsDecision` into the
 * 22-field `SanitizedLibraryQuarantineRightsDecisionDto` safe for administrative UI.
 * Omits `sourceSha256`, `createdBy`, and `updatedBy`.
 */
export function toSanitizedLibraryQuarantineRightsDecisionDto(
  persisted: LibraryQuarantinePersistedRightsDecision
): SanitizedLibraryQuarantineRightsDecisionDto {
  const checked = validatePersistedLibraryQuarantineRightsDecision(
    persisted,
    persisted?.receiptId
  );
  if (!checked.ok) {
    throw new Error(checked.errorMessage);
  }
  const d = checked.rightsDecision;
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
    receiptId: d.receiptId,
    documentId: d.documentId,
    revision: d.revision,
    sourceRevision: d.sourceRevision,
    sourceUpdatedAt: d.sourceUpdatedAt,
    draftSourceRevision: d.draftSourceRevision,
    catalogHandoffCaseRevision: d.catalogHandoffCaseRevision,
    currentHumanCaseRevision: d.currentHumanCaseRevision,
    rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
    decision: d.decision,
    basis: d.basis,
    evidenceReference: d.evidenceReference,
    evidenceNotes: d.evidenceNotes,
    reviewNotes: d.reviewNotes,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}
