import {
  LIBRARY_QUARANTINE_STORAGE_PREFIX,
  isValidIsoUtcTimestamp,
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';

/**
 * LIB-FILE-HUMAN-CASEWORK-01 — Server-Side Human Review Case & Audit Event Contract
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Defines the strict schema for durable, private human review case records stored in
 *   `library_quarantine_human_review_cases/<receiptId>` and append-only audit events in
 *   `library_quarantine_human_review_events/<receiptId>_<revision>`.
 * - Records preliminary human editorial metadata and source/rights evidence notes ONLY:
 *   `IN_REVIEW | NEEDS_INFORMATION | METADATA_RECORDED | NOT_SUITABLE`.
 * - `METADATA_RECORDED` indicates only that initial descriptive metadata and source
 *   evidence notes have been recorded by a human reviewer. It NEVER implies binary
 *   sanitization, PDF active-content safety, copyright/rights clearance, PEIA readiness,
 *   or public publication.
 * - All text fields are validated as plain text only (no HTML tags, no control/bidi
 *   characters, no executable URI schemes, no internal `library/quarantine/` paths or
 *   `gs://` URIs).
 * - Sanitized administrative DTOs (`SanitizedLibraryQuarantineHumanReviewCaseDto`)
 *   omit `sourceSha256`, `createdBy`, and `updatedBy`, and never include `storagePath`,
 *   `generation`, signed URLs, download tokens, or raw binary bytes.
 */

export const LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENT_SCHEMA_VERSION = 1 as const;

export const LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_STATUSES = Object.freeze([
  'IN_REVIEW',
  'NEEDS_INFORMATION',
  'METADATA_RECORDED',
  'NOT_SUITABLE',
] as const);

export type LibraryQuarantineHumanReviewCaseStatus =
  (typeof LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_STATUSES)[number];

const ALLOWED_CASE_STATUS_SET: ReadonlySet<string> = new Set(
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_STATUSES
);

export const HUMAN_REVIEW_TITLE_MAX_LENGTH = 300 as const;
export const HUMAN_REVIEW_ORGANIZATION_MAX_LENGTH = 240 as const;
export const HUMAN_REVIEW_NOTES_MAX_LENGTH = 2000 as const;

const SHA256_LOWERCASE_HEX_REGEX = /^[0-9a-f]{64}$/;

const SINGLE_LINE_CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const MULTI_LINE_CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]/;

const HTML_TAG_OR_ANGLE_BRACKET_REGEX = /[<>]/;

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|gs:\/\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i;

export interface LibraryQuarantineHumanReviewEditorialFields {
  readonly status: LibraryQuarantineHumanReviewCaseStatus;
  readonly titleAr: string;
  readonly titleEn: string;
  readonly issuingOrganization: string;
  readonly summaryAr: string;
  readonly summaryEn: string;
  readonly sourceEvidenceNotes: string;
  readonly rightsEvidenceNotes: string;
  readonly editorialNotes: string;
}

/**
 * Exact 20-field persisted Firestore document in
 * `library_quarantine_human_review_cases/<receiptId>`.
 */
export interface LibraryQuarantinePersistedHumanReviewCase
  extends LibraryQuarantineHumanReviewEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly draftSourceRevision: number;
  readonly revision: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export type LibraryQuarantineHumanReviewAuditEventType = 'CREATED' | 'UPDATED';

/**
 * Exact 21-field append-only persisted Firestore audit event in
 * `library_quarantine_human_review_events/<receiptId>_<revision>`.
 */
export interface LibraryQuarantinePersistedHumanReviewEvent
  extends LibraryQuarantineHumanReviewEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly receiptId: string;
  readonly revision: number;
  readonly previousRevision: number;
  readonly eventType: LibraryQuarantineHumanReviewAuditEventType;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly sourceSha256: string;
  readonly draftSourceRevision: number;
  readonly actorUid: string;
  readonly recordedAt: string;
}

/**
 * Sanitized 17-field DTO returned to authorized human Library reviewers.
 * Omits `sourceSha256`, `createdBy`, and `updatedBy`.
 */
export interface SanitizedLibraryQuarantineHumanReviewCaseDto
  extends LibraryQuarantineHumanReviewEditorialFields {
  readonly schemaVersion: typeof LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly sourceRevision: number;
  readonly sourceUpdatedAt: string;
  readonly draftSourceRevision: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveLibraryQuarantineHumanReviewCaseEditorialInput {
  readonly status: LibraryQuarantineHumanReviewCaseStatus;
  readonly titleAr?: string;
  readonly titleEn?: string;
  readonly issuingOrganization?: string;
  readonly summaryAr?: string;
  readonly summaryEn?: string;
  readonly sourceEvidenceNotes?: string;
  readonly rightsEvidenceNotes?: string;
  readonly editorialNotes?: string;
}

export type LibraryQuarantineHumanReviewContractErrorCode =
  | 'INVALID_CASE_INPUT_OBJECT'
  | 'UNTRUSTED_OR_FORBIDDEN_CASE_FIELD'
  | 'INVALID_CASE_STATUS'
  | 'INVALID_PLAIN_TEXT_FIELD'
  | 'FIELD_MAX_LENGTH_EXCEEDED'
  | 'METADATA_RECORDED_REQUIREMENTS_NOT_MET'
  | 'JUSTIFICATION_NOTES_REQUIRED'
  | 'EMPTY_REVIEW_CASE_NOT_ALLOWED'
  | 'INVALID_PERSISTED_CASE_SCHEMA'
  | 'INVALID_PERSISTED_EVENT_SCHEMA';

export interface ValidateHumanReviewEditorialInputSuccess {
  readonly ok: true;
  readonly value: LibraryQuarantineHumanReviewEditorialFields;
}

export interface ValidateHumanReviewContractFailure {
  readonly ok: false;
  readonly errorCode: LibraryQuarantineHumanReviewContractErrorCode;
  readonly errorMessage: string;
}

export type ValidateHumanReviewEditorialInputResult =
  | ValidateHumanReviewEditorialInputSuccess
  | ValidateHumanReviewContractFailure;

export interface ValidatePersistedHumanReviewCaseSuccess {
  readonly ok: true;
  readonly reviewCase: LibraryQuarantinePersistedHumanReviewCase;
}

export type ValidatePersistedHumanReviewCaseResult =
  | ValidatePersistedHumanReviewCaseSuccess
  | ValidateHumanReviewContractFailure;

export interface ValidatePersistedHumanReviewEventSuccess {
  readonly ok: true;
  readonly reviewEvent: LibraryQuarantinePersistedHumanReviewEvent;
}

export type ValidatePersistedHumanReviewEventResult =
  | ValidatePersistedHumanReviewEventSuccess
  | ValidateHumanReviewContractFailure;

export const HUMAN_REVIEW_CONTRACT_SAFE_MESSAGES: Readonly<
  Record<LibraryQuarantineHumanReviewContractErrorCode, string>
> = Object.freeze({
  INVALID_CASE_INPUT_OBJECT:
    'Human review case input must be a plain object with allowed editorial fields only.',
  UNTRUSTED_OR_FORBIDDEN_CASE_FIELD:
    'Human review case payload contains an unexpected, privileged, or forbidden property.',
  INVALID_CASE_STATUS:
    'Human review case status must be one of IN_REVIEW, NEEDS_INFORMATION, METADATA_RECORDED, or NOT_SUITABLE.',
  INVALID_PLAIN_TEXT_FIELD:
    'Human review case text fields must be plain text without HTML tags, control characters, or forbidden URI schemes.',
  FIELD_MAX_LENGTH_EXCEEDED:
    'One or more human review case text fields exceed the maximum permitted character length.',
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
});

export const ALLOWED_EDITORIAL_INPUT_KEYS: ReadonlySet<string> = new Set([
  'status',
  'titleAr',
  'titleEn',
  'issuingOrganization',
  'summaryAr',
  'summaryEn',
  'sourceEvidenceNotes',
  'rightsEvidenceNotes',
  'editorialNotes',
]);

export const ALLOWED_PERSISTED_HUMAN_REVIEW_CASE_KEYS: ReadonlySet<string> =
  new Set([
    'schemaVersion',
    'receiptId',
    'sourceRevision',
    'sourceUpdatedAt',
    'sourceSha256',
    'draftSourceRevision',
    'revision',
    'status',
    'titleAr',
    'titleEn',
    'issuingOrganization',
    'summaryAr',
    'summaryEn',
    'sourceEvidenceNotes',
    'rightsEvidenceNotes',
    'editorialNotes',
    'createdBy',
    'createdAt',
    'updatedBy',
    'updatedAt',
  ]);

export const ALLOWED_PERSISTED_HUMAN_REVIEW_EVENT_KEYS: ReadonlySet<string> =
  new Set([
    'schemaVersion',
    'eventId',
    'receiptId',
    'revision',
    'previousRevision',
    'eventType',
    'sourceRevision',
    'sourceUpdatedAt',
    'sourceSha256',
    'draftSourceRevision',
    'status',
    'titleAr',
    'titleEn',
    'issuingOrganization',
    'summaryAr',
    'summaryEn',
    'sourceEvidenceNotes',
    'rightsEvidenceNotes',
    'editorialNotes',
    'actorUid',
    'recordedAt',
  ]);

export const ALLOWED_SANITIZED_HUMAN_REVIEW_CASE_DTO_KEYS: ReadonlySet<string> =
  new Set([
    'schemaVersion',
    'receiptId',
    'sourceRevision',
    'sourceUpdatedAt',
    'draftSourceRevision',
    'revision',
    'status',
    'titleAr',
    'titleEn',
    'issuingOrganization',
    'summaryAr',
    'summaryEn',
    'sourceEvidenceNotes',
    'rightsEvidenceNotes',
    'editorialNotes',
    'createdAt',
    'updatedAt',
  ]);

export const FORBIDDEN_HUMAN_REVIEW_KEYS: ReadonlySet<string> = new Set([
  'storagePath',
  'generation',
  'attestedGeneration',
  'attestedStoragePath',
  'attestation',
  'bucket',
  'bucketName',
  'url',
  'signedUrl',
  'downloadUrl',
  'downloadToken',
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
  'auth',
  'uid',
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
  errorCode: LibraryQuarantineHumanReviewContractErrorCode
): ValidateHumanReviewContractFailure {
  return Object.freeze({
    ok: false as const,
    errorCode,
    errorMessage: HUMAN_REVIEW_CONTRACT_SAFE_MESSAGES[errorCode],
  });
}

export function isValidLibraryQuarantineHumanReviewCaseStatus(
  value: unknown
): value is LibraryQuarantineHumanReviewCaseStatus {
  return typeof value === 'string' && ALLOWED_CASE_STATUS_SET.has(value);
}

export function deriveLibraryQuarantineHumanReviewEventId(
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

function validateAndNormalizeSingleLinePlainText(
  raw: unknown,
  maxLength: number
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly errorCode: LibraryQuarantineHumanReviewContractErrorCode } {
  if (raw === undefined) {
    return { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }
  if (
    SINGLE_LINE_CONTROL_OR_BIDI_REGEX.test(raw) ||
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
  | { readonly ok: false; readonly errorCode: LibraryQuarantineHumanReviewContractErrorCode } {
  if (raw === undefined) {
    return { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, errorCode: 'INVALID_PLAIN_TEXT_FIELD' };
  }
  const normalizedNewlines = raw.replace(/\r\n?/g, '\n');
  if (
    MULTI_LINE_CONTROL_OR_BIDI_REGEX.test(normalizedNewlines) ||
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

/**
 * Validates and normalizes caller-supplied editorial input for saving a human review case.
 * Enforces plain-text rules, character limits, and status-specific editorial requirements.
 */
export function validateHumanReviewCaseEditorialInput(
  rawInput: unknown
): ValidateHumanReviewEditorialInputResult {
  if (!isPlainObject(rawInput)) {
    return makeContractFailure('INVALID_CASE_INPUT_OBJECT');
  }
  if (Object.getOwnPropertySymbols(rawInput).length > 0) {
    return makeContractFailure('UNTRUSTED_OR_FORBIDDEN_CASE_FIELD');
  }

  for (const key of Object.keys(rawInput)) {
    if (
      FORBIDDEN_HUMAN_REVIEW_KEYS.has(key) ||
      !ALLOWED_EDITORIAL_INPUT_KEYS.has(key)
    ) {
      return makeContractFailure('UNTRUSTED_OR_FORBIDDEN_CASE_FIELD');
    }
  }

  if (!isValidLibraryQuarantineHumanReviewCaseStatus(rawInput.status)) {
    return makeContractFailure('INVALID_CASE_STATUS');
  }
  const status = rawInput.status;

  const titleArRes = validateAndNormalizeSingleLinePlainText(
    rawInput.titleAr,
    HUMAN_REVIEW_TITLE_MAX_LENGTH
  );
  if (!titleArRes.ok) return makeContractFailure(titleArRes.errorCode);

  const titleEnRes = validateAndNormalizeSingleLinePlainText(
    rawInput.titleEn,
    HUMAN_REVIEW_TITLE_MAX_LENGTH
  );
  if (!titleEnRes.ok) return makeContractFailure(titleEnRes.errorCode);

  const orgRes = validateAndNormalizeSingleLinePlainText(
    rawInput.issuingOrganization,
    HUMAN_REVIEW_ORGANIZATION_MAX_LENGTH
  );
  if (!orgRes.ok) return makeContractFailure(orgRes.errorCode);

  const summaryArRes = validateAndNormalizeMultiLinePlainText(
    rawInput.summaryAr,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  if (!summaryArRes.ok) return makeContractFailure(summaryArRes.errorCode);

  const summaryEnRes = validateAndNormalizeMultiLinePlainText(
    rawInput.summaryEn,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  if (!summaryEnRes.ok) return makeContractFailure(summaryEnRes.errorCode);

  const sourceEvidenceRes = validateAndNormalizeMultiLinePlainText(
    rawInput.sourceEvidenceNotes,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  if (!sourceEvidenceRes.ok) {
    return makeContractFailure(sourceEvidenceRes.errorCode);
  }

  const rightsEvidenceRes = validateAndNormalizeMultiLinePlainText(
    rawInput.rightsEvidenceNotes,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  if (!rightsEvidenceRes.ok) {
    return makeContractFailure(rightsEvidenceRes.errorCode);
  }

  const editorialNotesRes = validateAndNormalizeMultiLinePlainText(
    rawInput.editorialNotes,
    HUMAN_REVIEW_NOTES_MAX_LENGTH
  );
  if (!editorialNotesRes.ok) {
    return makeContractFailure(editorialNotesRes.errorCode);
  }

  const normalized: LibraryQuarantineHumanReviewEditorialFields = Object.freeze({
    status,
    titleAr: titleArRes.value,
    titleEn: titleEnRes.value,
    issuingOrganization: orgRes.value,
    summaryAr: summaryArRes.value,
    summaryEn: summaryEnRes.value,
    sourceEvidenceNotes: sourceEvidenceRes.value,
    rightsEvidenceNotes: rightsEvidenceRes.value,
    editorialNotes: editorialNotesRes.value,
  });

  if (status === 'METADATA_RECORDED') {
    const hasAtLeastOneTitle =
      normalized.titleAr.length > 0 || normalized.titleEn.length > 0;
    const hasSourceEvidence = normalized.sourceEvidenceNotes.length > 0;
    if (!hasAtLeastOneTitle || !hasSourceEvidence) {
      return makeContractFailure('METADATA_RECORDED_REQUIREMENTS_NOT_MET');
    }
  }

  if (status === 'NEEDS_INFORMATION' || status === 'NOT_SUITABLE') {
    if (normalized.editorialNotes.length === 0) {
      return makeContractFailure('JUSTIFICATION_NOTES_REQUIRED');
    }
  }

  const hasAnyContent =
    normalized.titleAr.length > 0 ||
    normalized.titleEn.length > 0 ||
    normalized.issuingOrganization.length > 0 ||
    normalized.summaryAr.length > 0 ||
    normalized.summaryEn.length > 0 ||
    normalized.sourceEvidenceNotes.length > 0 ||
    normalized.rightsEvidenceNotes.length > 0 ||
    normalized.editorialNotes.length > 0;

  if (!hasAnyContent) {
    return makeContractFailure('EMPTY_REVIEW_CASE_NOT_ALLOWED');
  }

  return Object.freeze({
    ok: true as const,
    value: normalized,
  });
}

function validateStrictPersistedPlainText(
  value: unknown,
  maxLength: number,
  multiLine: boolean
): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (value !== value.trim()) {
    return false;
  }
  if (value.length > maxLength) {
    return false;
  }
  if (value.includes('\r')) {
    return false;
  }
  const controlRegex = multiLine
    ? MULTI_LINE_CONTROL_OR_BIDI_REGEX
    : SINGLE_LINE_CONTROL_OR_BIDI_REGEX;
  if (
    controlRegex.test(value) ||
    HTML_TAG_OR_ANGLE_BRACKET_REGEX.test(value) ||
    FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX.test(value) ||
    value.includes(LIBRARY_QUARANTINE_STORAGE_PREFIX)
  ) {
    return false;
  }
  return true;
}

/**
 * Validates a persisted 20-field `LibraryQuarantinePersistedHumanReviewCase` document.
 */
export function validatePersistedLibraryQuarantineHumanReviewCase(
  candidate: unknown,
  expectedReceiptId?: string
): ValidatePersistedHumanReviewCaseResult {
  if (
    !isPlainObject(candidate) ||
    Object.getOwnPropertySymbols(candidate).length > 0
  ) {
    return makeContractFailure('INVALID_PERSISTED_CASE_SCHEMA');
  }

  const keys = Object.keys(candidate);
  if (keys.length !== ALLOWED_PERSISTED_HUMAN_REVIEW_CASE_KEYS.size) {
    return makeContractFailure('INVALID_PERSISTED_CASE_SCHEMA');
  }
  for (const key of keys) {
    if (
      FORBIDDEN_HUMAN_REVIEW_KEYS.has(key) ||
      !ALLOWED_PERSISTED_HUMAN_REVIEW_CASE_KEYS.has(key)
    ) {
      return makeContractFailure('INVALID_PERSISTED_CASE_SCHEMA');
    }
  }

  const {
    schemaVersion,
    receiptId,
    sourceRevision,
    sourceUpdatedAt,
    sourceSha256,
    draftSourceRevision,
    revision,
    status,
    titleAr,
    titleEn,
    issuingOrganization,
    summaryAr,
    summaryEn,
    sourceEvidenceNotes,
    rightsEvidenceNotes,
    editorialNotes,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt,
  } = candidate;

  if (
    schemaVersion !== LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION ||
    !isValidLibraryQuarantineReceiptId(receiptId) ||
    (expectedReceiptId !== undefined && receiptId !== expectedReceiptId) ||
    typeof sourceRevision !== 'number' ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1 ||
    !isValidIsoUtcTimestamp(sourceUpdatedAt) ||
    typeof sourceSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(sourceSha256) ||
    typeof draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(draftSourceRevision) ||
    draftSourceRevision < 1 ||
    draftSourceRevision !== sourceRevision ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !isValidLibraryQuarantineHumanReviewCaseStatus(status) ||
    !validateStrictPersistedPlainText(
      titleAr,
      HUMAN_REVIEW_TITLE_MAX_LENGTH,
      false
    ) ||
    !validateStrictPersistedPlainText(
      titleEn,
      HUMAN_REVIEW_TITLE_MAX_LENGTH,
      false
    ) ||
    !validateStrictPersistedPlainText(
      issuingOrganization,
      HUMAN_REVIEW_ORGANIZATION_MAX_LENGTH,
      false
    ) ||
    !validateStrictPersistedPlainText(
      summaryAr,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !validateStrictPersistedPlainText(
      summaryEn,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !validateStrictPersistedPlainText(
      sourceEvidenceNotes,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !validateStrictPersistedPlainText(
      rightsEvidenceNotes,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !validateStrictPersistedPlainText(
      editorialNotes,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !isValidUploaderUid(createdBy) ||
    !isValidIsoUtcTimestamp(createdAt) ||
    !isValidUploaderUid(updatedBy) ||
    !isValidIsoUtcTimestamp(updatedAt) ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    Date.parse(createdAt) < Date.parse(sourceUpdatedAt)
  ) {
    return makeContractFailure('INVALID_PERSISTED_CASE_SCHEMA');
  }

  // Re-verify editorial status constraints on persisted record
  const editorialCheck = validateHumanReviewCaseEditorialInput({
    status,
    titleAr,
    titleEn,
    issuingOrganization,
    summaryAr,
    summaryEn,
    sourceEvidenceNotes,
    rightsEvidenceNotes,
    editorialNotes,
  });
  if (!editorialCheck.ok) {
    return makeContractFailure('INVALID_PERSISTED_CASE_SCHEMA');
  }

  const persistedCase: LibraryQuarantinePersistedHumanReviewCase =
    Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
      receiptId,
      sourceRevision,
      sourceUpdatedAt,
      sourceSha256,
      draftSourceRevision,
      revision,
      status,
      titleAr,
      titleEn,
      issuingOrganization,
      summaryAr,
      summaryEn,
      sourceEvidenceNotes,
      rightsEvidenceNotes,
      editorialNotes,
      createdBy,
      createdAt,
      updatedBy,
      updatedAt,
    });

  return Object.freeze({
    ok: true as const,
    reviewCase: persistedCase,
  });
}

/**
 * Validates a persisted 21-field `LibraryQuarantinePersistedHumanReviewEvent` document.
 */
export function validatePersistedLibraryQuarantineHumanReviewEvent(
  candidate: unknown,
  expectedEventId?: string
): ValidatePersistedHumanReviewEventResult {
  if (
    !isPlainObject(candidate) ||
    Object.getOwnPropertySymbols(candidate).length > 0
  ) {
    return makeContractFailure('INVALID_PERSISTED_EVENT_SCHEMA');
  }

  const keys = Object.keys(candidate);
  if (keys.length !== ALLOWED_PERSISTED_HUMAN_REVIEW_EVENT_KEYS.size) {
    return makeContractFailure('INVALID_PERSISTED_EVENT_SCHEMA');
  }
  for (const key of keys) {
    if (
      FORBIDDEN_HUMAN_REVIEW_KEYS.has(key) ||
      !ALLOWED_PERSISTED_HUMAN_REVIEW_EVENT_KEYS.has(key)
    ) {
      return makeContractFailure('INVALID_PERSISTED_EVENT_SCHEMA');
    }
  }

  const {
    schemaVersion,
    eventId,
    receiptId,
    revision,
    previousRevision,
    eventType,
    sourceRevision,
    sourceUpdatedAt,
    sourceSha256,
    draftSourceRevision,
    status,
    titleAr,
    titleEn,
    issuingOrganization,
    summaryAr,
    summaryEn,
    sourceEvidenceNotes,
    rightsEvidenceNotes,
    editorialNotes,
    actorUid,
    recordedAt,
  } = candidate;

  if (
    schemaVersion !== LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENT_SCHEMA_VERSION ||
    !isValidLibraryQuarantineReceiptId(receiptId) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof previousRevision !== 'number' ||
    !Number.isSafeInteger(previousRevision) ||
    previousRevision !== revision - 1 ||
    typeof eventId !== 'string' ||
    eventId !== deriveLibraryQuarantineHumanReviewEventId(receiptId, revision) ||
    (expectedEventId !== undefined && eventId !== expectedEventId) ||
    (eventType !== 'CREATED' && eventType !== 'UPDATED') ||
    (revision === 1 ? eventType !== 'CREATED' : eventType !== 'UPDATED') ||
    typeof sourceRevision !== 'number' ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1 ||
    !isValidIsoUtcTimestamp(sourceUpdatedAt) ||
    typeof sourceSha256 !== 'string' ||
    !SHA256_LOWERCASE_HEX_REGEX.test(sourceSha256) ||
    typeof draftSourceRevision !== 'number' ||
    !Number.isSafeInteger(draftSourceRevision) ||
    draftSourceRevision !== sourceRevision ||
    !isValidLibraryQuarantineHumanReviewCaseStatus(status) ||
    !validateStrictPersistedPlainText(
      titleAr,
      HUMAN_REVIEW_TITLE_MAX_LENGTH,
      false
    ) ||
    !validateStrictPersistedPlainText(
      titleEn,
      HUMAN_REVIEW_TITLE_MAX_LENGTH,
      false
    ) ||
    !validateStrictPersistedPlainText(
      issuingOrganization,
      HUMAN_REVIEW_ORGANIZATION_MAX_LENGTH,
      false
    ) ||
    !validateStrictPersistedPlainText(
      summaryAr,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !validateStrictPersistedPlainText(
      summaryEn,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !validateStrictPersistedPlainText(
      sourceEvidenceNotes,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !validateStrictPersistedPlainText(
      rightsEvidenceNotes,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !validateStrictPersistedPlainText(
      editorialNotes,
      HUMAN_REVIEW_NOTES_MAX_LENGTH,
      true
    ) ||
    !isValidUploaderUid(actorUid) ||
    !isValidIsoUtcTimestamp(recordedAt) ||
    Date.parse(recordedAt) < Date.parse(sourceUpdatedAt)
  ) {
    return makeContractFailure('INVALID_PERSISTED_EVENT_SCHEMA');
  }

  const editorialCheck = validateHumanReviewCaseEditorialInput({
    status,
    titleAr,
    titleEn,
    issuingOrganization,
    summaryAr,
    summaryEn,
    sourceEvidenceNotes,
    rightsEvidenceNotes,
    editorialNotes,
  });
  if (!editorialCheck.ok) {
    return makeContractFailure('INVALID_PERSISTED_EVENT_SCHEMA');
  }

  return Object.freeze({
    ok: true as const,
    reviewEvent: Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_EVENT_SCHEMA_VERSION,
      eventId,
      receiptId,
      revision,
      previousRevision,
      eventType,
      sourceRevision,
      sourceUpdatedAt,
      sourceSha256,
      draftSourceRevision,
      status,
      titleAr,
      titleEn,
      issuingOrganization,
      summaryAr,
      summaryEn,
      sourceEvidenceNotes,
      rightsEvidenceNotes,
      editorialNotes,
      actorUid,
      recordedAt,
    }),
  });
}

/**
 * Projects a validated `LibraryQuarantinePersistedHumanReviewCase` into its
 * sanitized 17-field DTO (`SanitizedLibraryQuarantineHumanReviewCaseDto`),
 * redacting `sourceSha256`, `createdBy`, and `updatedBy`.
 */
export function toSanitizedLibraryQuarantineHumanReviewCaseDto(
  persisted: LibraryQuarantinePersistedHumanReviewCase
): SanitizedLibraryQuarantineHumanReviewCaseDto {
  const validated = validatePersistedLibraryQuarantineHumanReviewCase(
    persisted,
    persisted?.receiptId
  );
  if (!validated.ok) {
    throw new Error(validated.errorMessage);
  }
  const c = validated.reviewCase;
  return Object.freeze({
    schemaVersion: c.schemaVersion,
    receiptId: c.receiptId,
    sourceRevision: c.sourceRevision,
    sourceUpdatedAt: c.sourceUpdatedAt,
    draftSourceRevision: c.draftSourceRevision,
    revision: c.revision,
    status: c.status,
    titleAr: c.titleAr,
    titleEn: c.titleEn,
    issuingOrganization: c.issuingOrganization,
    summaryAr: c.summaryAr,
    summaryEn: c.summaryEn,
    sourceEvidenceNotes: c.sourceEvidenceNotes,
    rightsEvidenceNotes: c.rightsEvidenceNotes,
    editorialNotes: c.editorialNotes,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  });
}
