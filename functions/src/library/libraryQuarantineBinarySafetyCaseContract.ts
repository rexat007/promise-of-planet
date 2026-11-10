import type {
  LibraryQuarantineReadinessIndicatorsDto,
} from './libraryQuarantineRightsDecisionContract';

export type { LibraryQuarantineReadinessIndicatorsDto };

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

export const BINARY_SAFETY_EVIDENCE_REFERENCE_MAX_LENGTH = 500 as const;
export const BINARY_SAFETY_NOTES_MAX_LENGTH = 2000 as const;

export const QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS: LibraryQuarantineReadinessIndicatorsDto =
  Object.freeze({
    binarySafety: 'NOT_VERIFIED' as const,
    fileSanitization: 'NOT_PERFORMED' as const,
    publication: 'BLOCKED' as const,
    catalogWorkflow: 'Draft' as const,
  });

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

const FORBIDDEN_TEXT_SCHEME_OR_PATH_REGEX =
  /(?:javascript\s*:|data\s*:|vbscript\s*:|file\s*:|gs:\/\/|https?:\/\/|library\/quarantine\/|firebasestorage\.googleapis\.com|storage\.googleapis\.com|x-goog-signature)/i;

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
  readonly sourceFormat: string;
  readonly deepInspectionStatus: string;
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
  readonly sourceFormat: string;
  readonly deepInspectionStatus: string;
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
  readonly sourceFormat: string;
  readonly deepInspectionStatus: string;
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

function sanitizePlainTextField(
  raw: unknown,
  maxLength: number,
  allowNewline: boolean,
  fieldName: string
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly errorCode: LibraryQuarantineBinarySafetyCaseContractErrorCode; readonly errorMessage: string } {
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
  const trimmed = raw.trim();
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
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return {
      ok: false,
      errorCode: 'INVALID_BINARY_SAFETY_INPUT_OBJECT',
      errorMessage: 'Binary safety input must be a plain object.',
    };
  }

  const record = rawInput as Record<string, unknown>;
  const dispositionRaw = record.disposition;

  if (
    typeof dispositionRaw !== 'string' ||
    !ALLOWED_DISPOSITION_SET.has(dispositionRaw)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_BINARY_SAFETY_DISPOSITION',
      errorMessage: `Invalid disposition: ${String(dispositionRaw)}. Must be one of ISOLATED_ASSESSMENT_REQUIRED, EXTERNAL_REPORT_NOT_VERIFIED, DO_NOT_PROCESS.`,
    };
  }

  const disposition = dispositionRaw as LibraryQuarantineBinarySafetyDisposition;

  const evRefRes = sanitizePlainTextField(
    record.evidenceReference,
    BINARY_SAFETY_EVIDENCE_REFERENCE_MAX_LENGTH,
    false,
    'evidenceReference'
  );
  if (!evRefRes.ok) {
    return evRefRes;
  }

  const evNotesRes = sanitizePlainTextField(
    record.evidenceNotes,
    BINARY_SAFETY_NOTES_MAX_LENGTH,
    true,
    'evidenceNotes'
  );
  if (!evNotesRes.ok) {
    return evNotesRes;
  }

  const revNotesRes = sanitizePlainTextField(
    record.reviewNotes,
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

  if (disposition === 'EXTERNAL_REPORT_NOT_VERIFIED') {
    if (evidenceReference.length === 0 || evidenceNotes.length === 0) {
      return {
        ok: false,
        errorCode: 'EXTERNAL_REPORT_REQUIREMENTS_NOT_MET',
        errorMessage: 'EXTERNAL_REPORT_NOT_VERIFIED requires both evidenceReference and evidenceNotes to be provided.',
      };
    }
  }

  if (disposition === 'DO_NOT_PROCESS') {
    if (reviewNotes.length === 0) {
      return {
        ok: false,
        errorCode: 'DO_NOT_PROCESS_JUSTIFICATION_REQUIRED',
        errorMessage: 'DO_NOT_PROCESS disposition requires reviewNotes justification.',
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

export function toSanitizedLibraryQuarantineBinarySafetyCaseDto(
  persisted: LibraryQuarantinePersistedBinarySafetyCase
): SanitizedLibraryQuarantineBinarySafetyCaseDto {
  return Object.freeze({
    schemaVersion: persisted.schemaVersion,
    receiptId: persisted.receiptId,
    documentId: persisted.documentId,
    revision: persisted.revision,
    sourceRevision: persisted.sourceRevision,
    sourceUpdatedAt: persisted.sourceUpdatedAt,
    sourceFormat: persisted.sourceFormat,
    deepInspectionStatus: persisted.deepInspectionStatus,
    effectiveHumanCaseRevision: persisted.effectiveHumanCaseRevision,
    effectiveHumanCaseUpdatedAt: persisted.effectiveHumanCaseUpdatedAt,
    catalogUpdatedAt: persisted.catalogUpdatedAt,
    disposition: persisted.disposition,
    evidenceReference: persisted.evidenceReference,
    evidenceNotes: persisted.evidenceNotes,
    reviewNotes: persisted.reviewNotes,
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  });
}
