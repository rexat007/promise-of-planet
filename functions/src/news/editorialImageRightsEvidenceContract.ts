import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetValidationLimits,
  type EditorialImageAssetValidationResult as EditorialImageValidationResult,
} from '../types/editorialImageAsset';
import {
  isValidCanonicalUtcTimestamp,
  validateAssetId,
} from '../shared/editorialImageAssetContract';

export const EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION =
  'editorial_image_rights_evidence' as const;

export type EditorialImageRightsEvidenceStatus = 'Active' | 'Revoked';

export const CANONICAL_EVIDENCE_STATUSES: readonly EditorialImageRightsEvidenceStatus[] =
  ['Active', 'Revoked'] as const;

export type EditorialImageRightsEvidenceSourceKind =
  | 'SignedLicenseAgreement'
  | 'PhotographerWrittenRelease'
  | 'AgencyContractRecord'
  | 'PublicDomainArchivalRecord'
  | 'EditorialExceptionMemo';

export const CANONICAL_EVIDENCE_SOURCE_KINDS: readonly EditorialImageRightsEvidenceSourceKind[] =
  [
    'SignedLicenseAgreement',
    'PhotographerWrittenRelease',
    'AgencyContractRecord',
    'PublicDomainArchivalRecord',
    'EditorialExceptionMemo',
  ] as const;

export const MAX_EVIDENCE_SOURCE_REFERENCE_LENGTH = 500;
export const MAX_EVIDENCE_SUMMARY_LENGTH = 2000;
export const MAX_EVIDENCE_REVOCATION_REASON_LENGTH = 2000;
export const MAX_EVIDENCE_ACTOR_UID_LENGTH = 128;

/**
 * Durable server-side rights evidence registry record stored in
 * `editorial_image_rights_evidence/{evidenceId}`.
 *
 * Security & trust boundary note:
 * - Evidence records are registered and revoked exclusively by verified human
 *   administrators with `AdminPermission.ManageRights` inside server
 *   transactions.
 * - `artifactSha256` is optional descriptive metadata (`64`-character lowercase
 *   hex SHA-256) recorded by a human reviewer. This contract validates its
 *   format only; it does NOT verify external binary file contents or legal
 *   authenticity of external documents.
 */
export interface EditorialImageRightsEvidenceRecord {
  readonly evidenceId: string;
  readonly assetId: string;
  readonly status: EditorialImageRightsEvidenceStatus;
  readonly sourceKind: EditorialImageRightsEvidenceSourceKind;
  readonly sourceReference: string;
  readonly summary: string;
  /**
   * Optional 64-character lowercase hex SHA-256 digest of an offline/external
   * evidence artifact. Treated strictly as unverified descriptive metadata,
   * never as cryptographic proof of binary or legal authenticity.
   */
  readonly artifactSha256?: string;
  readonly recordedByUid: string;
  readonly recordedAtIso: string;
  readonly revokedByUid?: string;
  readonly revokedAtIso?: string;
  readonly revocationReason?: string;
}

export interface RegisterEditorialImageRightsEvidenceInput {
  readonly evidenceId?: string;
  readonly assetId: string;
  readonly sourceKind: EditorialImageRightsEvidenceSourceKind;
  readonly sourceReference: string;
  readonly summary: string;
  readonly artifactSha256?: string;
}

export interface RevokeEditorialImageRightsEvidenceInput {
  readonly evidenceId: string;
  readonly assetId?: string;
  readonly revocationReason: string;
}

const EVIDENCE_ID_CHARS_REGEX = /^[a-zA-Z0-9_.:-]+$/;
const ACTOR_UID_CHARS_REGEX = /^[a-zA-Z0-9_.:-]+$/;
const LOWERCASE_SHA256_REGEX = /^[a-f0-9]{64}$/;

const PROHIBITED_URL_OR_TOKEN_PATTERNS = [
  /https?:\/\//i,
  /gs:\/\//i,
  /file:\/\//i,
  /ftp:\/\//i,
  /data:/i,
  /blob:/i,
  /javascript:/i,
  /vbscript:/i,
  /token=/i,
  /access_token=/i,
  /alt=media/i,
  /x-goog-/i,
];

const PROHIBITED_EVIDENCE_ID_OR_REF_PATTERNS = [
  ...PROHIBITED_URL_OR_TOKEN_PATTERNS,
  /^\/\//,
  /[?#]/,
  /editorial_images/i,
  /[\\/]/,
  /\.\./,
  /%/,
  /bearer/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /credential/i,
  /signature/i,
  /access[_-]?token/i,
  /id[_-]?token/i,
  /refresh[_-]?token/i,
];

const VALID_EVIDENCE_STATUS_SET: ReadonlySet<string> = new Set(
  CANONICAL_EVIDENCE_STATUSES
);

const VALID_EVIDENCE_SOURCE_KIND_SET: ReadonlySet<string> = new Set(
  CANONICAL_EVIDENCE_SOURCE_KINDS
);

export const ALLOWED_EVIDENCE_RECORD_KEYS: ReadonlySet<string> = new Set([
  'evidenceId',
  'assetId',
  'status',
  'sourceKind',
  'sourceReference',
  'summary',
  'artifactSha256',
  'recordedByUid',
  'recordedAtIso',
  'revokedByUid',
  'revokedAtIso',
  'revocationReason',
]);

export const ALLOWED_REGISTER_EVIDENCE_INPUT_KEYS: ReadonlySet<string> =
  new Set([
    'evidenceId',
    'assetId',
    'sourceKind',
    'sourceReference',
    'summary',
    'artifactSha256',
  ]);

export const ALLOWED_REVOKE_EVIDENCE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'evidenceId',
  'assetId',
  'revocationReason',
]);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function getUnexpectedKeys(
  obj: object,
  allowedKeys: ReadonlySet<string>
): string[] {
  const unexpected: string[] = [];
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowedKeys.has(key)) {
      unexpected.push(key);
    }
  }
  for (const sym of Object.getOwnPropertySymbols(obj)) {
    unexpected.push(String(sym));
  }
  return unexpected;
}

function containsProhibitedUrlOrTokenPattern(value: string): boolean {
  return PROHIBITED_URL_OR_TOKEN_PATTERNS.some((pattern) =>
    pattern.test(value)
  );
}

function containsProhibitedEvidenceIdOrRefPattern(value: string): boolean {
  return PROHIBITED_EVIDENCE_ID_OR_REF_PATTERNS.some((pattern) =>
    pattern.test(value)
  );
}

export function isValidEvidenceStatus(
  value: unknown
): value is EditorialImageRightsEvidenceStatus {
  return typeof value === 'string' && VALID_EVIDENCE_STATUS_SET.has(value);
}

export function isValidEvidenceSourceKind(
  value: unknown
): value is EditorialImageRightsEvidenceSourceKind {
  return typeof value === 'string' && VALID_EVIDENCE_SOURCE_KIND_SET.has(value);
}

export function validateEvidenceId(
  evidenceId: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageValidationResult {
  const maxLen =
    limits.maxEvidenceRefLength ??
    DEFAULT_ASSET_VALIDATION_LIMITS.maxEvidenceRefLength ??
    128;
  const errors: string[] = [];

  if (typeof evidenceId !== 'string' || evidenceId.trim().length === 0) {
    errors.push('evidenceId must be a non-empty string.');
    return { valid: false, errors };
  }

  if (evidenceId !== evidenceId.trim() || /\s/.test(evidenceId)) {
    errors.push('evidenceId must not contain leading, trailing, or internal whitespace.');
  }

  if (evidenceId.length > maxLen) {
    errors.push(`evidenceId length must not exceed ${maxLen} characters.`);
  }

  if (containsProhibitedEvidenceIdOrRefPattern(evidenceId)) {
    errors.push(
      'evidenceId must be an opaque identifier and must not contain URLs, paths, tokens, or credentials.'
    );
  }

  if (!EVIDENCE_ID_CHARS_REGEX.test(evidenceId)) {
    errors.push(
      'evidenceId contains disallowed characters; only alphanumeric, "_", "-", ".", and ":" are permitted.'
    );
  }

  return { valid: errors.length === 0, errors };
}

export function validateEditorialImageRightsEvidenceRecord(
  raw: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageValidationResult {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [
        'EditorialImageRightsEvidenceRecord must be a plain non-null object.',
      ],
    };
  }

  const errors: string[] = [];
  const unexpectedKeys = getUnexpectedKeys(raw, ALLOWED_EVIDENCE_RECORD_KEYS);
  for (const key of unexpectedKeys) {
    errors.push(
      `Unexpected property "${key}" on EditorialImageRightsEvidenceRecord.`
    );
  }

  const evidenceIdResult = validateEvidenceId(raw.evidenceId, limits);
  if (!evidenceIdResult.valid) {
    errors.push(...evidenceIdResult.errors);
  }

  const assetIdResult = validateAssetId(raw.assetId, limits);
  if (!assetIdResult.valid) {
    errors.push(...assetIdResult.errors);
  }

  if (!isValidEvidenceStatus(raw.status)) {
    errors.push(
      `status must be one of ${CANONICAL_EVIDENCE_STATUSES.join(', ')}, received "${String(raw.status)}".`
    );
  }

  if (!isValidEvidenceSourceKind(raw.sourceKind)) {
    errors.push(
      `sourceKind must be one of ${CANONICAL_EVIDENCE_SOURCE_KINDS.join(', ')}, received "${String(raw.sourceKind)}".`
    );
  }

  if (
    typeof raw.sourceReference !== 'string' ||
    raw.sourceReference.trim().length === 0
  ) {
    errors.push('sourceReference must be a non-empty string.');
  } else {
    if (raw.sourceReference !== raw.sourceReference.trim()) {
      errors.push(
        'sourceReference must not contain leading or trailing whitespace.'
      );
    }
    if (raw.sourceReference.length > MAX_EVIDENCE_SOURCE_REFERENCE_LENGTH) {
      errors.push(
        `sourceReference length must not exceed ${MAX_EVIDENCE_SOURCE_REFERENCE_LENGTH} characters.`
      );
    }
    if (containsProhibitedEvidenceIdOrRefPattern(raw.sourceReference)) {
      errors.push(
        'sourceReference must not contain URLs, storage paths, query tokens, or credentials.'
      );
    }
  }

  if (typeof raw.summary !== 'string' || raw.summary.trim().length === 0) {
    errors.push('summary must be a non-empty string.');
  } else {
    if (raw.summary !== raw.summary.trim()) {
      errors.push('summary must not contain leading or trailing whitespace.');
    }
    if (raw.summary.length > MAX_EVIDENCE_SUMMARY_LENGTH) {
      errors.push(
        `summary length must not exceed ${MAX_EVIDENCE_SUMMARY_LENGTH} characters.`
      );
    }
    if (containsProhibitedUrlOrTokenPattern(raw.summary)) {
      errors.push(
        'summary contains prohibited URL, signed-URL, or token patterns.'
      );
    }
  }

  if (raw.artifactSha256 !== undefined) {
    if (
      typeof raw.artifactSha256 !== 'string' ||
      !LOWERCASE_SHA256_REGEX.test(raw.artifactSha256)
    ) {
      errors.push(
        'artifactSha256 must be a 64-character lowercase hexadecimal SHA-256 string when provided.'
      );
    }
  }

  if (
    typeof raw.recordedByUid !== 'string' ||
    raw.recordedByUid.trim().length === 0 ||
    raw.recordedByUid !== raw.recordedByUid.trim() ||
    raw.recordedByUid.length > MAX_EVIDENCE_ACTOR_UID_LENGTH ||
    !ACTOR_UID_CHARS_REGEX.test(raw.recordedByUid) ||
    containsProhibitedUrlOrTokenPattern(raw.recordedByUid)
  ) {
    errors.push('recordedByUid must be a valid non-empty human actor UID.');
  }

  if (!isValidCanonicalUtcTimestamp(raw.recordedAtIso)) {
    errors.push(
      'recordedAtIso must be a valid canonical UTC ISO-8601 timestamp.'
    );
  }

  if (raw.status === 'Active') {
    if (
      raw.revokedByUid !== undefined ||
      raw.revokedAtIso !== undefined ||
      raw.revocationReason !== undefined
    ) {
      errors.push(
        'Active evidence record must not contain revokedByUid, revokedAtIso, or revocationReason.'
      );
    }
  } else if (raw.status === 'Revoked') {
    if (
      typeof raw.revokedByUid !== 'string' ||
      raw.revokedByUid.trim().length === 0 ||
      raw.revokedByUid !== raw.revokedByUid.trim() ||
      raw.revokedByUid.length > MAX_EVIDENCE_ACTOR_UID_LENGTH ||
      !ACTOR_UID_CHARS_REGEX.test(raw.revokedByUid) ||
      containsProhibitedUrlOrTokenPattern(raw.revokedByUid)
    ) {
      errors.push(
        'Revoked evidence record requires a valid non-empty revokedByUid.'
      );
    }

    if (!isValidCanonicalUtcTimestamp(raw.revokedAtIso)) {
      errors.push(
        'Revoked evidence record requires a valid canonical UTC ISO-8601 revokedAtIso.'
      );
    } else if (
      isValidCanonicalUtcTimestamp(raw.recordedAtIso) &&
      Date.parse(raw.revokedAtIso) < Date.parse(raw.recordedAtIso)
    ) {
      errors.push(
        `Revoked evidence record revokedAtIso (${raw.revokedAtIso}) must not precede recordedAtIso (${raw.recordedAtIso}).`
      );
    }

    if (
      typeof raw.revocationReason !== 'string' ||
      raw.revocationReason.trim().length === 0
    ) {
      errors.push(
        'Revoked evidence record requires a non-empty revocationReason.'
      );
    } else {
      if (raw.revocationReason !== raw.revocationReason.trim()) {
        errors.push(
          'revocationReason must not contain leading or trailing whitespace.'
        );
      }
      if (
        raw.revocationReason.length > MAX_EVIDENCE_REVOCATION_REASON_LENGTH
      ) {
        errors.push(
          `revocationReason length must not exceed ${MAX_EVIDENCE_REVOCATION_REASON_LENGTH} characters.`
        );
      }
      if (containsProhibitedUrlOrTokenPattern(raw.revocationReason)) {
        errors.push(
          'revocationReason contains prohibited URL or token patterns.'
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateRegisterEvidenceInputContract(
  rawInput: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): {
  valid: boolean;
  errors: string[];
  value?: RegisterEditorialImageRightsEvidenceInput;
} {
  if (!isPlainObject(rawInput)) {
    return {
      valid: false,
      errors: [
        'Evidence registration input must be a plain non-null object.',
      ],
    };
  }

  const errors: string[] = [];
  const unexpectedKeys = getUnexpectedKeys(
    rawInput,
    ALLOWED_REGISTER_EVIDENCE_INPUT_KEYS
  );
  for (const key of unexpectedKeys) {
    errors.push(
      `Unexpected or spoofed field "${key}" on evidence registration input.`
    );
  }

  if (rawInput.evidenceId !== undefined) {
    const idCheck = validateEvidenceId(rawInput.evidenceId, limits);
    if (!idCheck.valid) {
      errors.push(...idCheck.errors);
    }
  }

  const assetIdCheck = validateAssetId(rawInput.assetId, limits);
  if (!assetIdCheck.valid) {
    errors.push(...assetIdCheck.errors);
  }

  if (!isValidEvidenceSourceKind(rawInput.sourceKind)) {
    errors.push(
      `sourceKind must be one of ${CANONICAL_EVIDENCE_SOURCE_KINDS.join(', ')}, received "${String(rawInput.sourceKind)}".`
    );
  }

  if (
    typeof rawInput.sourceReference !== 'string' ||
    rawInput.sourceReference.trim().length === 0
  ) {
    errors.push('sourceReference must be a non-empty string.');
  } else {
    if (rawInput.sourceReference !== rawInput.sourceReference.trim()) {
      errors.push(
        'sourceReference must not contain leading or trailing whitespace.'
      );
    }
    if (rawInput.sourceReference.length > MAX_EVIDENCE_SOURCE_REFERENCE_LENGTH) {
      errors.push(
        `sourceReference length must not exceed ${MAX_EVIDENCE_SOURCE_REFERENCE_LENGTH} characters.`
      );
    }
    if (containsProhibitedEvidenceIdOrRefPattern(rawInput.sourceReference)) {
      errors.push(
        'sourceReference must not contain URLs, storage paths, query tokens, or credentials.'
      );
    }
  }

  if (
    typeof rawInput.summary !== 'string' ||
    rawInput.summary.trim().length === 0
  ) {
    errors.push('summary must be a non-empty string.');
  } else {
    if (rawInput.summary !== rawInput.summary.trim()) {
      errors.push('summary must not contain leading or trailing whitespace.');
    }
    if (rawInput.summary.length > MAX_EVIDENCE_SUMMARY_LENGTH) {
      errors.push(
        `summary length must not exceed ${MAX_EVIDENCE_SUMMARY_LENGTH} characters.`
      );
    }
    if (containsProhibitedUrlOrTokenPattern(rawInput.summary)) {
      errors.push(
        'summary contains prohibited URL, signed-URL, or token patterns.'
      );
    }
  }

  if (rawInput.artifactSha256 !== undefined) {
    if (
      typeof rawInput.artifactSha256 !== 'string' ||
      !LOWERCASE_SHA256_REGEX.test(rawInput.artifactSha256)
    ) {
      errors.push(
        'artifactSha256 must be a 64-character lowercase hexadecimal SHA-256 string when provided.'
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    value: {
      ...(rawInput.evidenceId !== undefined
        ? { evidenceId: rawInput.evidenceId as string }
        : {}),
      assetId: rawInput.assetId as string,
      sourceKind: rawInput.sourceKind as EditorialImageRightsEvidenceSourceKind,
      sourceReference: rawInput.sourceReference as string,
      summary: rawInput.summary as string,
      ...(rawInput.artifactSha256 !== undefined
        ? { artifactSha256: rawInput.artifactSha256 as string }
        : {}),
    },
  };
}

export function validateRevokeEvidenceInputContract(
  rawInput: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): {
  valid: boolean;
  errors: string[];
  value?: RevokeEditorialImageRightsEvidenceInput;
} {
  if (!isPlainObject(rawInput)) {
    return {
      valid: false,
      errors: ['Evidence revocation input must be a plain non-null object.'],
    };
  }

  const errors: string[] = [];
  const unexpectedKeys = getUnexpectedKeys(
    rawInput,
    ALLOWED_REVOKE_EVIDENCE_INPUT_KEYS
  );
  for (const key of unexpectedKeys) {
    errors.push(
      `Unexpected or spoofed field "${key}" on evidence revocation input.`
    );
  }

  const idCheck = validateEvidenceId(rawInput.evidenceId, limits);
  if (!idCheck.valid) {
    errors.push(...idCheck.errors);
  }

  if (rawInput.assetId !== undefined) {
    const assetIdCheck = validateAssetId(rawInput.assetId, limits);
    if (!assetIdCheck.valid) {
      errors.push(...assetIdCheck.errors);
    }
  }

  if (
    typeof rawInput.revocationReason !== 'string' ||
    rawInput.revocationReason.trim().length === 0
  ) {
    errors.push('revocationReason must be a non-empty string.');
  } else {
    if (rawInput.revocationReason !== rawInput.revocationReason.trim()) {
      errors.push(
        'revocationReason must not contain leading or trailing whitespace.'
      );
    }
    if (
      rawInput.revocationReason.length > MAX_EVIDENCE_REVOCATION_REASON_LENGTH
    ) {
      errors.push(
        `revocationReason length must not exceed ${MAX_EVIDENCE_REVOCATION_REASON_LENGTH} characters.`
      );
    }
    if (containsProhibitedUrlOrTokenPattern(rawInput.revocationReason)) {
      errors.push(
        'revocationReason contains prohibited URL or token patterns.'
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    value: {
      evidenceId: rawInput.evidenceId as string,
      ...(rawInput.assetId !== undefined
        ? { assetId: rawInput.assetId as string }
        : {}),
      revocationReason: rawInput.revocationReason as string,
    },
  };
}

export function cloneEditorialImageRightsEvidenceRecord(
  record: EditorialImageRightsEvidenceRecord
): EditorialImageRightsEvidenceRecord {
  return {
    evidenceId: record.evidenceId,
    assetId: record.assetId,
    status: record.status,
    sourceKind: record.sourceKind,
    sourceReference: record.sourceReference,
    summary: record.summary,
    ...(record.artifactSha256 !== undefined
      ? { artifactSha256: record.artifactSha256 }
      : {}),
    recordedByUid: record.recordedByUid,
    recordedAtIso: record.recordedAtIso,
    ...(record.revokedByUid !== undefined
      ? { revokedByUid: record.revokedByUid }
      : {}),
    ...(record.revokedAtIso !== undefined
      ? { revokedAtIso: record.revokedAtIso }
      : {}),
    ...(record.revocationReason !== undefined
      ? { revocationReason: record.revocationReason }
      : {}),
  };
}

export function serializeEvidenceRecordForPersistence(
  record: EditorialImageRightsEvidenceRecord
): Record<string, unknown> {
  const cloned = cloneEditorialImageRightsEvidenceRecord(record);
  const serialized: Record<string, unknown> = {
    evidenceId: cloned.evidenceId,
    assetId: cloned.assetId,
    status: cloned.status,
    sourceKind: cloned.sourceKind,
    sourceReference: cloned.sourceReference,
    summary: cloned.summary,
    recordedByUid: cloned.recordedByUid,
    recordedAtIso: cloned.recordedAtIso,
  };
  if (cloned.artifactSha256 !== undefined) {
    serialized.artifactSha256 = cloned.artifactSha256;
  }
  if (cloned.revokedByUid !== undefined) {
    serialized.revokedByUid = cloned.revokedByUid;
  }
  if (cloned.revokedAtIso !== undefined) {
    serialized.revokedAtIso = cloned.revokedAtIso;
  }
  if (cloned.revocationReason !== undefined) {
    serialized.revocationReason = cloned.revocationReason;
  }
  return serialized;
}
