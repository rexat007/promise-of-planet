import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetMetadata,
  type EditorialImageAssetValidationLimits,
  type UpdateEditorialImageAssetInput,
} from '../types/editorialImageAsset';
import {
  sanitizeEditorialImageAssetMetadata,
  updateEditorialImageAssetRecord,
  validateAssetId,
  validateEditorialImageAsset,
} from '../shared/editorialImageAssetContract';

export const EDITORIAL_IMAGE_ASSET_COLLECTION = 'editorial_image_assets' as const;

export const INITIAL_EDITORIAL_IMAGE_ASSET_REVISION = 1 as const;

export type EditorialImageAssetRepositoryErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_ASSET'
  | 'INVALID_PATCH'
  | 'CONFLICT'
  | 'PERSISTENCE_FAILURE';

export class EditorialImageAssetRepositoryError extends Error {
  public readonly code: EditorialImageAssetRepositoryErrorCode;
  public readonly details: readonly string[];
  public readonly cause?: unknown;

  constructor(
    code: EditorialImageAssetRepositoryErrorCode,
    message: string,
    details: readonly string[] = [],
    cause?: unknown
  ) {
    super(message);
    this.name = 'EditorialImageAssetRepositoryError';
    this.code = code;
    this.details = [...details];
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Versioned storage envelope persisting canonical EditorialImageAssetMetadata
 * alongside a positive integer repository revision without mutating the
 * canonical asset schema.
 */
export interface EditorialImageAssetRepositoryRecord {
  readonly assetId: string;
  readonly revision: number;
  readonly asset: EditorialImageAssetMetadata;
}

export interface EditorialImageAssetFoundResult {
  readonly ok: true;
  readonly status: 'FOUND';
  readonly record: EditorialImageAssetRepositoryRecord;
  readonly asset: EditorialImageAssetMetadata;
  readonly revision: number;
}

export interface EditorialImageAssetNotFoundResult {
  readonly ok: false;
  readonly status: 'NOT_FOUND';
  readonly code: 'NOT_FOUND';
  readonly assetId: string;
  readonly record: null;
}

export type EditorialImageAssetReadResult =
  | EditorialImageAssetFoundResult
  | EditorialImageAssetNotFoundResult;

/**
 * Internal persistence boundary for editorial image asset metadata.
 * Does not authenticate callers, approve rights, or expose public delivery URLs.
 */
export interface EditorialImageAssetRepository {
  getById(assetId: string): Promise<EditorialImageAssetReadResult>;
  createIfAbsent(
    asset: EditorialImageAssetMetadata
  ): Promise<EditorialImageAssetRepositoryRecord>;
  updateEditorialMetadata(
    assetId: string,
    expectedRevision: number,
    patch: UpdateEditorialImageAssetInput
  ): Promise<EditorialImageAssetRepositoryRecord>;
}

const ALLOWED_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'assetId',
  'revision',
  'asset',
]);

const ALLOWED_UPDATE_PATCH_KEYS: ReadonlySet<string> = new Set([
  'altAr',
  'altEn',
  'captionAr',
  'captionEn',
  'photographerCredit',
  'licensingInfo',
  'tags',
  'associatedArticleIds',
]);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function getUnexpectedObjectKeys(
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

export function isPositiveSafeIntegerRevision(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 1;
}

export function validateRepositoryAssetId(
  assetId: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): string {
  const validation = validateAssetId(assetId, limits);
  if (!validation.valid) {
    throw new EditorialImageAssetRepositoryError(
      'INVALID_ASSET',
      `Invalid assetId: ${validation.errors.join(' ')}`,
      validation.errors
    );
  }
  return assetId as string;
}

export function validateExpectedRevision(expectedRevision: unknown): number {
  if (!isPositiveSafeIntegerRevision(expectedRevision)) {
    const detail =
      'expectedRevision must be a positive safe integer (>= 1).';
    throw new EditorialImageAssetRepositoryError(
      'INVALID_PATCH',
      detail,
      [detail]
    );
  }
  return expectedRevision;
}

/**
 * Validates a full canonical asset for initial repository creation.
 * Requires canonical contract validity, initial lifecycle status 'active',
 * and initial rights status 'PendingReview' without pre-populated rights
 * approval or reviewer fields.
 */
export function validateAndCloneInitialAssetForCreate(
  asset: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetMetadata {
  if (!isPlainObject(asset)) {
    const detail = 'Editorial image asset must be a plain non-null object.';
    throw new EditorialImageAssetRepositoryError('INVALID_ASSET', detail, [
      detail,
    ]);
  }

  const errors: string[] = [];
  const validation = validateEditorialImageAsset(asset, limits);
  if (!validation.valid) {
    errors.push(...validation.errors);
  }

  if (asset.status !== 'active') {
    errors.push(
      `Initial editorial image asset lifecycle status must be "active", received "${String(asset.status)}".`
    );
  }

  if (!isPlainObject(asset.rights)) {
    errors.push('Initial editorial image asset rights must be a plain object.');
  } else {
    if (asset.rights.status !== 'PendingReview') {
      errors.push(
        `Initial editorial image asset rights.status must be "PendingReview", received "${String(asset.rights.status)}".`
      );
    }
    const extraRightsKeys = getUnexpectedObjectKeys(
      asset.rights,
      new Set(['status'])
    );
    if (extraRightsKeys.length > 0) {
      errors.push(
        `Initial editorial image asset with PendingReview rights must not pre-populate rights or reviewer fields: ${extraRightsKeys.join(', ')}.`
      );
    }
  }

  if (errors.length > 0) {
    throw new EditorialImageAssetRepositoryError(
      'INVALID_ASSET',
      `Invalid editorial image asset for creation:\n- ${errors.join('\n- ')}`,
      errors
    );
  }

  return sanitizeEditorialImageAssetMetadata(
    asset as unknown as EditorialImageAssetMetadata,
    limits
  );
}

/**
 * Validates and defensively clones an editorial metadata update patch before
 * transaction execution. Rejects attempts to modify immutable fields,
 * storage paths, variants, rights/reviewer fields, lifecycle status, or
 * repository revision.
 */
export function validateAndCloneUpdatePatch(
  patch: unknown
): UpdateEditorialImageAssetInput {
  if (!isPlainObject(patch)) {
    const detail =
      'Editorial metadata update patch must be a plain non-null object.';
    throw new EditorialImageAssetRepositoryError('INVALID_PATCH', detail, [
      detail,
    ]);
  }

  const unexpectedKeys = getUnexpectedObjectKeys(patch, ALLOWED_UPDATE_PATCH_KEYS);
  if (unexpectedKeys.length > 0) {
    const details = unexpectedKeys.map((key) =>
      key === 'revision' || key === 'expectedRevision'
        ? `Cannot modify repository revision field "${key}" via editorial metadata update.`
        : `Disallowed or protected field "${key}" in editorial metadata update patch.`
    );
    throw new EditorialImageAssetRepositoryError(
      'INVALID_PATCH',
      `Invalid editorial metadata update patch:\n- ${details.join('\n- ')}`,
      details
    );
  }

  const cloned: UpdateEditorialImageAssetInput = {};

  if (Object.prototype.hasOwnProperty.call(patch, 'altAr')) {
    cloned.altAr = patch.altAr as string | undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'altEn')) {
    cloned.altEn = patch.altEn as string | undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'captionAr')) {
    cloned.captionAr = patch.captionAr as string | undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'captionEn')) {
    cloned.captionEn = patch.captionEn as string | undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'photographerCredit')) {
    cloned.photographerCredit = patch.photographerCredit as string | undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'licensingInfo')) {
    cloned.licensingInfo = patch.licensingInfo as string | undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
    cloned.tags = Array.isArray(patch.tags)
      ? ([...patch.tags] as string[])
      : (patch.tags as string[] | undefined);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'associatedArticleIds')) {
    cloned.associatedArticleIds = Array.isArray(patch.associatedArticleIds)
      ? ([...patch.associatedArticleIds] as string[])
      : (patch.associatedArticleIds as string[] | undefined);
  }

  return cloned;
}

/**
 * Validates a persisted storage envelope and its embedded canonical asset.
 * Fails closed on any schema corruption, identity mismatch, or invalid revision.
 */
export function validatePersistedEditorialImageAssetEnvelope(
  expectedAssetId: string,
  rawEnvelope: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetRepositoryRecord {
  validateRepositoryAssetId(expectedAssetId, limits);

  if (!isPlainObject(rawEnvelope)) {
    const detail = `Corrupted or malformed persisted envelope for asset "${expectedAssetId}": envelope must be a plain object.`;
    throw new EditorialImageAssetRepositoryError('INVALID_ASSET', detail, [
      detail,
    ]);
  }

  const errors: string[] = [];
  const unexpectedEnvelopeKeys = getUnexpectedObjectKeys(
    rawEnvelope,
    ALLOWED_ENVELOPE_KEYS
  );
  for (const key of unexpectedEnvelopeKeys) {
    errors.push(`Unexpected property "${key}" on persisted asset envelope.`);
  }

  if (typeof rawEnvelope.assetId !== 'string' || rawEnvelope.assetId !== expectedAssetId) {
    errors.push(
      `Persisted envelope assetId "${String(rawEnvelope.assetId)}" does not match expected document ID "${expectedAssetId}".`
    );
  }

  if (!isPositiveSafeIntegerRevision(rawEnvelope.revision)) {
    errors.push(
      `Persisted envelope revision must be a positive safe integer (>= 1), received "${String(rawEnvelope.revision)}".`
    );
  }

  if (!isPlainObject(rawEnvelope.asset)) {
    errors.push('Persisted envelope asset payload must be a plain object.');
  } else {
    if (rawEnvelope.asset.assetId !== expectedAssetId) {
      errors.push(
        `Embedded canonical assetId "${String(rawEnvelope.asset.assetId)}" does not match expected document ID "${expectedAssetId}".`
      );
    }
    const assetValidation = validateEditorialImageAsset(
      rawEnvelope.asset,
      limits
    );
    if (!assetValidation.valid) {
      errors.push(...assetValidation.errors);
    }
  }

  if (errors.length > 0) {
    throw new EditorialImageAssetRepositoryError(
      'INVALID_ASSET',
      `Corrupted or invalid persisted editorial image asset record for "${expectedAssetId}":\n- ${errors.join('\n- ')}`,
      errors
    );
  }

  const sanitizedAsset = sanitizeEditorialImageAssetMetadata(
    rawEnvelope.asset as unknown as EditorialImageAssetMetadata,
    limits
  );

  return {
    assetId: sanitizedAsset.assetId,
    revision: rawEnvelope.revision as number,
    asset: sanitizedAsset,
  };
}

export function cloneRepositoryRecord(
  record: EditorialImageAssetRepositoryRecord,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetRepositoryRecord {
  const validated = validatePersistedEditorialImageAssetEnvelope(
    record.assetId,
    record,
    limits
  );
  return {
    assetId: validated.assetId,
    revision: validated.revision,
    asset: sanitizeEditorialImageAssetMetadata(validated.asset, limits),
  };
}

export function buildFoundReadResult(
  record: EditorialImageAssetRepositoryRecord,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetFoundResult {
  const clonedRecord = cloneRepositoryRecord(record, limits);
  return {
    ok: true,
    status: 'FOUND',
    record: clonedRecord,
    asset: sanitizeEditorialImageAssetMetadata(clonedRecord.asset, limits),
    revision: clonedRecord.revision,
  };
}

export function buildNotFoundReadResult(
  assetId: string
): EditorialImageAssetNotFoundResult {
  return {
    ok: false,
    status: 'NOT_FOUND',
    code: 'NOT_FOUND',
    assetId,
    record: null,
  };
}

/**
 * Applies an editorial metadata update against a validated current envelope,
 * enforcing exact expectedRevision match and canonical contract rules, and
 * incrementing revision by 1.
 */
export function applyValidatedEditorialMetadataUpdate(
  currentRecord: EditorialImageAssetRepositoryRecord,
  expectedRevision: number,
  patch: UpdateEditorialImageAssetInput,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialImageAssetRepositoryRecord {
  if (currentRecord.revision !== expectedRevision) {
    const detail = `Revision conflict for editorial image asset "${currentRecord.assetId}": expected revision ${expectedRevision}, but current stored revision is ${currentRecord.revision}.`;
    throw new EditorialImageAssetRepositoryError('CONFLICT', detail, [detail]);
  }

  let updatedAsset: EditorialImageAssetMetadata;
  try {
    updatedAsset = updateEditorialImageAssetRecord(
      currentRecord.asset,
      patch,
      limits
    );
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Invalid editorial metadata update patch.';
    throw new EditorialImageAssetRepositoryError(
      'INVALID_PATCH',
      msg,
      [msg],
      err
    );
  }

  const postValidation = validateEditorialImageAsset(updatedAsset, limits);
  if (!postValidation.valid) {
    throw new EditorialImageAssetRepositoryError(
      'INVALID_PATCH',
      `Updated editorial image asset failed canonical validation:\n- ${postValidation.errors.join('\n- ')}`,
      postValidation.errors
    );
  }

  return {
    assetId: updatedAsset.assetId,
    revision: currentRecord.revision + 1,
    asset: sanitizeEditorialImageAssetMetadata(updatedAsset, limits),
  };
}

function stripUndefinedRecursively<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedRecursively(entry)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        cleaned[key] = stripUndefinedRecursively(val);
      }
    }
    return cleaned as unknown as T;
  }
  return value;
}

export function serializeEnvelopeForPersistence(
  record: EditorialImageAssetRepositoryRecord,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): Record<string, unknown> {
  const cloned = cloneRepositoryRecord(record, limits);
  return stripUndefinedRecursively({
    assetId: cloned.assetId,
    revision: cloned.revision,
    asset: cloned.asset,
  });
}
