import {
  AdminRole,
  isValidAdminRole,
} from '../shared/adminContract';
import {
  EditorialBinaryIntakeError,
  type EditorialBinaryIntakeErrorCode,
  type EditorialBinaryIntakeSession,
  type EditorialBinaryIntakeSessionStatus,
  type EditorialBinaryIntakeTargetKind,
  type EditorialBinaryStorageNamespace,
  type IntakeSessionStore,
  type TrackedIntakeStorageObject,
  validateIntakeId,
} from './editorialBinaryIntakeService';
import {
  CANONICAL_SHA256_CHECKSUM_REGEX,
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetValidationLimits,
} from '../types/editorialImageAsset';
import {
  isValidCanonicalUtcTimestamp,
  validateAssetId,
} from '../shared/editorialImageAssetContract';
import { validateEvidenceId } from './editorialImageRightsEvidenceContract';

export const EDITORIAL_BINARY_INTAKE_SESSION_COLLECTION =
  'editorial_binary_intake_sessions' as const;

export const VALID_INTAKE_SESSION_STATUSES: readonly EditorialBinaryIntakeSessionStatus[] =
  Object.freeze([
    'Created',
    'Quarantined',
    'PreliminarilyVerified',
    'Promoting',
    'Registering',
    'Registered',
    'CleanupPending',
    'Completed',
    'Failed',
    'NeedsReconciliation',
  ]);

const VALID_STATUS_SET: ReadonlySet<string> = new Set(
  VALID_INTAKE_SESSION_STATUSES
);

const VALID_TARGET_KINDS: ReadonlySet<string> = new Set([
  'editorial_image_asset',
  'rights_evidence_binary',
]);

const VALID_STORAGE_NAMESPACES: ReadonlySet<string> = new Set([
  'quarantine',
  'private',
]);

const ALLOWED_SESSION_KEYS: ReadonlySet<string> = new Set([
  'intakeId',
  'targetKind',
  'assetId',
  'evidenceId',
  'uploaderUid',
  'uploaderRole',
  'requestFingerprint',
  'status',
  'revision',
  'createdAt',
  'updatedAt',
  'expiresAt',
  'binarySha256',
  'detectedMimeType',
  'binarySizeBytes',
  'width',
  'height',
  'aspectRatio',
  'createdQuarantineObjects',
  'createdPrivateObjects',
  'pendingCleanupObjects',
  'canonicalRegistrationAttempted',
  'canonicalRegistrationSucceeded',
  'registrationOutcomeUnknown',
  'rejectionCode',
  'lastErrorCode',
  'lastErrorMessage',
]);

const ALLOWED_TRACKED_OBJECT_KEYS: ReadonlySet<string> = new Set([
  'storagePath',
  'namespace',
  'generation',
  'etag',
  'sha256Checksum',
  'sizeBytes',
  'contentType',
  'createdByIntakeId',
]);

export interface IntakeSessionFirestoreDocumentSnapshot {
  readonly exists: boolean;
  readonly id?: string;
  data(): unknown;
}

export interface IntakeSessionFirestoreDocumentRef {
  readonly id: string;
  get?(): Promise<IntakeSessionFirestoreDocumentSnapshot>;
}

export interface IntakeSessionFirestoreQuerySnapshot {
  readonly empty: boolean;
  readonly size: number;
  readonly docs: readonly IntakeSessionFirestoreDocumentSnapshot[];
}

export interface IntakeSessionFirestoreQuery {
  where(
    fieldPath: string,
    opStr: string,
    value: unknown
  ): IntakeSessionFirestoreQuery;
  orderBy?(
    fieldPath: string,
    directionStr?: 'asc' | 'desc'
  ): IntakeSessionFirestoreQuery;
  limit(limitCount: number): IntakeSessionFirestoreQuery;
  get(): Promise<IntakeSessionFirestoreQuerySnapshot>;
}

export interface IntakeSessionFirestoreCollectionRef {
  doc(documentId: string): IntakeSessionFirestoreDocumentRef;
  where?(
    fieldPath: string,
    opStr: string,
    value: unknown
  ): IntakeSessionFirestoreQuery;
  orderBy?(
    fieldPath: string,
    directionStr?: 'asc' | 'desc'
  ): IntakeSessionFirestoreQuery;
  limit?(limitCount: number): IntakeSessionFirestoreQuery;
  get?(): Promise<IntakeSessionFirestoreQuerySnapshot>;
}

export interface IntakeSessionFirestoreTransaction {
  get(
    docRef: IntakeSessionFirestoreDocumentRef
  ): Promise<IntakeSessionFirestoreDocumentSnapshot>;
  create?(
    docRef: IntakeSessionFirestoreDocumentRef,
    data: Record<string, unknown>
  ): IntakeSessionFirestoreTransaction | void;
  set(
    docRef: IntakeSessionFirestoreDocumentRef,
    data: Record<string, unknown>
  ): IntakeSessionFirestoreTransaction | void;
}

export interface IntakeSessionFirestoreDatabase {
  collection(collectionName: string): IntakeSessionFirestoreCollectionRef;
  runTransaction<T>(
    updateFunction: (
      transaction: IntakeSessionFirestoreTransaction
    ) => Promise<T>
  ): Promise<T>;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
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

function cloneTrackedObject(
  obj: TrackedIntakeStorageObject
): TrackedIntakeStorageObject {
  return Object.freeze({
    storagePath: obj.storagePath,
    namespace: obj.namespace,
    generation: obj.generation,
    etag: obj.etag,
    sha256Checksum: obj.sha256Checksum,
    sizeBytes: obj.sizeBytes,
    contentType: obj.contentType,
    createdByIntakeId: obj.createdByIntakeId,
  });
}

function cloneTrackedObjectsList(
  list: readonly TrackedIntakeStorageObject[] | undefined
): readonly TrackedIntakeStorageObject[] {
  if (!Array.isArray(list)) {
    return Object.freeze([]);
  }
  return Object.freeze(list.map(cloneTrackedObject));
}

export function cloneIntakeSessionRecord(
  session: EditorialBinaryIntakeSession
): EditorialBinaryIntakeSession {
  return Object.freeze({
    intakeId: session.intakeId,
    targetKind: session.targetKind,
    assetId: session.assetId,
    ...(session.evidenceId !== undefined
      ? { evidenceId: session.evidenceId }
      : {}),
    uploaderUid: session.uploaderUid,
    uploaderRole: session.uploaderRole,
    requestFingerprint: session.requestFingerprint,
    status: session.status,
    revision: session.revision,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    ...(session.binarySha256 !== undefined
      ? { binarySha256: session.binarySha256 }
      : {}),
    ...(session.detectedMimeType !== undefined
      ? { detectedMimeType: session.detectedMimeType }
      : {}),
    ...(session.binarySizeBytes !== undefined
      ? { binarySizeBytes: session.binarySizeBytes }
      : {}),
    ...(session.width !== undefined ? { width: session.width } : {}),
    ...(session.height !== undefined ? { height: session.height } : {}),
    ...(session.aspectRatio !== undefined
      ? { aspectRatio: session.aspectRatio }
      : {}),
    createdQuarantineObjects: cloneTrackedObjectsList(
      session.createdQuarantineObjects
    ),
    createdPrivateObjects: cloneTrackedObjectsList(
      session.createdPrivateObjects
    ),
    pendingCleanupObjects: cloneTrackedObjectsList(
      session.pendingCleanupObjects
    ),
    canonicalRegistrationAttempted: Boolean(
      session.canonicalRegistrationAttempted
    ),
    canonicalRegistrationSucceeded: Boolean(
      session.canonicalRegistrationSucceeded
    ),
    registrationOutcomeUnknown: Boolean(session.registrationOutcomeUnknown),
    ...(session.rejectionCode !== undefined
      ? { rejectionCode: session.rejectionCode }
      : {}),
    ...(session.lastErrorCode !== undefined
      ? { lastErrorCode: session.lastErrorCode }
      : {}),
    ...(session.lastErrorMessage !== undefined
      ? { lastErrorMessage: session.lastErrorMessage }
      : {}),
  });
}

export function validateTrackedStorageObjectEnvelope(
  raw: unknown,
  contextLabel = 'Tracked storage object'
): TrackedIntakeStorageObject {
  if (!isPlainRecord(raw)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} must be a plain non-null object.`,
    });
  }

  const unexpected = getUnexpectedKeys(raw, ALLOWED_TRACKED_OBJECT_KEYS);
  if (unexpected.length > 0) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} contains disallowed properties: ${unexpected.join(', ')}.`,
    });
  }

  if (
    typeof raw.storagePath !== 'string' ||
    raw.storagePath.trim().length === 0
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} storagePath must be a non-empty string.`,
    });
  }

  if (
    typeof raw.namespace !== 'string' ||
    !VALID_STORAGE_NAMESPACES.has(raw.namespace)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} namespace must be "quarantine" or "private".`,
    });
  }

  if (
    typeof raw.generation !== 'string' ||
    raw.generation.trim().length === 0
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} generation must be a non-empty string.`,
    });
  }

  if (typeof raw.etag !== 'string' || raw.etag.trim().length === 0) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} etag must be a non-empty string.`,
    });
  }

  if (
    typeof raw.sha256Checksum !== 'string' ||
    !CANONICAL_SHA256_CHECKSUM_REGEX.test(raw.sha256Checksum)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} sha256Checksum must be a 64-character lowercase hex string.`,
    });
  }

  if (
    typeof raw.sizeBytes !== 'number' ||
    !Number.isSafeInteger(raw.sizeBytes) ||
    raw.sizeBytes <= 0
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} sizeBytes must be a positive integer.`,
    });
  }

  if (
    typeof raw.contentType !== 'string' ||
    raw.contentType.trim().length === 0
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `${contextLabel} contentType must be a non-empty string.`,
    });
  }

  const validIntakeId = validateIntakeId(raw.createdByIntakeId);

  return Object.freeze({
    storagePath: raw.storagePath,
    namespace: raw.namespace as EditorialBinaryStorageNamespace,
    generation: raw.generation,
    etag: raw.etag,
    sha256Checksum: raw.sha256Checksum,
    sizeBytes: raw.sizeBytes,
    contentType: raw.contentType,
    createdByIntakeId: validIntakeId,
  });
}

export function validatePersistedIntakeSessionEnvelope(
  raw: unknown,
  expectedIntakeId?: string,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): EditorialBinaryIntakeSession {
  if (!isPlainRecord(raw)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Persisted intake session must be a plain non-null object.',
    });
  }

  const unexpected = getUnexpectedKeys(raw, ALLOWED_SESSION_KEYS);
  if (unexpected.length > 0) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Persisted intake session contains unexpected properties: ${unexpected.join(', ')}.`,
    });
  }

  const intakeId = validateIntakeId(raw.intakeId);
  if (expectedIntakeId !== undefined && intakeId !== expectedIntakeId) {
    throw new EditorialBinaryIntakeError({
      code: 'STORAGE_CONFLICT',
      message: `Persisted intakeId "${intakeId}" does not match requested ID "${expectedIntakeId}".`,
      intakeId,
    });
  }

  if (
    typeof raw.targetKind !== 'string' ||
    !VALID_TARGET_KINDS.has(raw.targetKind)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Invalid session targetKind "${String(raw.targetKind)}".`,
      intakeId,
    });
  }

  const assetCheck = validateAssetId(raw.assetId, limits);
  if (!assetCheck.valid) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Invalid session assetId "${String(raw.assetId)}".`,
      intakeId,
      details: assetCheck.errors,
    });
  }

  if (raw.evidenceId !== undefined) {
    const evCheck = validateEvidenceId(raw.evidenceId, limits);
    if (!evCheck.valid) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Invalid session evidenceId "${String(raw.evidenceId)}".`,
        intakeId,
        details: evCheck.errors,
      });
    }
  }

  if (
    typeof raw.uploaderUid !== 'string' ||
    raw.uploaderUid.trim().length === 0
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session uploaderUid must be a non-empty string.',
      intakeId,
    });
  }

  if (
    !isValidAdminRole(raw.uploaderRole) ||
    raw.uploaderRole === AdminRole.AIAssistant
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session uploaderRole must be an authorized human AdminRole.',
      intakeId,
    });
  }

  if (
    typeof raw.requestFingerprint !== 'string' ||
    !CANONICAL_SHA256_CHECKSUM_REGEX.test(raw.requestFingerprint)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message:
        'Session requestFingerprint must be a 64-character lowercase hexadecimal SHA-256 string.',
      intakeId,
    });
  }

  if (
    typeof raw.status !== 'string' ||
    !VALID_STATUS_SET.has(raw.status)
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: `Invalid intake session status "${String(raw.status)}".`,
      intakeId,
    });
  }

  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1
  ) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session revision must be a positive safe integer (>= 1).',
      intakeId,
    });
  }

  if (!isValidCanonicalUtcTimestamp(raw.createdAt)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session createdAt must be a valid canonical UTC ISO-8601 timestamp.',
      intakeId,
    });
  }

  if (!isValidCanonicalUtcTimestamp(raw.updatedAt)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session updatedAt must be a valid canonical UTC ISO-8601 timestamp.',
      intakeId,
    });
  }

  if (!isValidCanonicalUtcTimestamp(raw.expiresAt)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session expiresAt must be a valid canonical UTC ISO-8601 timestamp.',
      intakeId,
    });
  }

  if (Date.parse(raw.updatedAt) < Date.parse(raw.createdAt)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session updatedAt cannot precede createdAt.',
      intakeId,
    });
  }

  if (raw.binarySha256 !== undefined) {
    if (
      typeof raw.binarySha256 !== 'string' ||
      !CANONICAL_SHA256_CHECKSUM_REGEX.test(raw.binarySha256)
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message:
          'Session binarySha256 must be a 64-character lowercase hex string.',
        intakeId,
      });
    }
  }

  if (raw.detectedMimeType !== undefined) {
    if (
      typeof raw.detectedMimeType !== 'string' ||
      raw.detectedMimeType.trim().length === 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Session detectedMimeType must be a non-empty string.',
        intakeId,
      });
    }
  }

  if (raw.binarySizeBytes !== undefined) {
    if (
      typeof raw.binarySizeBytes !== 'number' ||
      !Number.isSafeInteger(raw.binarySizeBytes) ||
      raw.binarySizeBytes <= 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Session binarySizeBytes must be a positive integer.',
        intakeId,
      });
    }
  }

  if (raw.width !== undefined) {
    if (
      typeof raw.width !== 'number' ||
      !Number.isSafeInteger(raw.width) ||
      raw.width <= 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Session width must be a positive integer.',
        intakeId,
      });
    }
  }

  if (raw.height !== undefined) {
    if (
      typeof raw.height !== 'number' ||
      !Number.isSafeInteger(raw.height) ||
      raw.height <= 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Session height must be a positive integer.',
        intakeId,
      });
    }
  }

  if (raw.aspectRatio !== undefined) {
    if (
      typeof raw.aspectRatio !== 'number' ||
      !Number.isFinite(raw.aspectRatio) ||
      raw.aspectRatio <= 0
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: 'Session aspectRatio must be a positive finite number.',
        intakeId,
      });
    }
  }

  if (!Array.isArray(raw.createdQuarantineObjects)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session createdQuarantineObjects must be an array.',
      intakeId,
    });
  }

  if (!Array.isArray(raw.createdPrivateObjects)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session createdPrivateObjects must be an array.',
      intakeId,
    });
  }

  if (!Array.isArray(raw.pendingCleanupObjects)) {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session pendingCleanupObjects must be an array.',
      intakeId,
    });
  }

  const quarantineObjs = raw.createdQuarantineObjects.map((item, idx) =>
    validateTrackedStorageObjectEnvelope(
      item,
      `createdQuarantineObjects[${idx}]`
    )
  );

  const privateObjs = raw.createdPrivateObjects.map((item, idx) =>
    validateTrackedStorageObjectEnvelope(
      item,
      `createdPrivateObjects[${idx}]`
    )
  );

  const pendingCleanupObjs = raw.pendingCleanupObjects.map((item, idx) =>
    validateTrackedStorageObjectEnvelope(
      item,
      `pendingCleanupObjects[${idx}]`
    )
  );

  if (typeof raw.canonicalRegistrationAttempted !== 'boolean') {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session canonicalRegistrationAttempted must be a boolean.',
      intakeId,
    });
  }

  if (typeof raw.canonicalRegistrationSucceeded !== 'boolean') {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session canonicalRegistrationSucceeded must be a boolean.',
      intakeId,
    });
  }

  if (typeof raw.registrationOutcomeUnknown !== 'boolean') {
    throw new EditorialBinaryIntakeError({
      code: 'INVALID_INPUT',
      message: 'Session registrationOutcomeUnknown must be a boolean.',
      intakeId,
    });
  }

  return cloneIntakeSessionRecord({
    intakeId,
    targetKind: raw.targetKind as EditorialBinaryIntakeTargetKind,
    assetId: raw.assetId as string,
    evidenceId: raw.evidenceId as string | undefined,
    uploaderUid: raw.uploaderUid as string,
    uploaderRole: raw.uploaderRole as AdminRole,
    requestFingerprint: raw.requestFingerprint as string,
    status: raw.status as EditorialBinaryIntakeSessionStatus,
    revision: raw.revision as number,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    expiresAt: raw.expiresAt as string,
    binarySha256: raw.binarySha256 as string | undefined,
    detectedMimeType: raw.detectedMimeType as string | undefined,
    binarySizeBytes: raw.binarySizeBytes as number | undefined,
    width: raw.width as number | undefined,
    height: raw.height as number | undefined,
    aspectRatio: raw.aspectRatio as number | undefined,
    createdQuarantineObjects: quarantineObjs,
    createdPrivateObjects: privateObjs,
    pendingCleanupObjects: pendingCleanupObjs,
    canonicalRegistrationAttempted: raw.canonicalRegistrationAttempted as boolean,
    canonicalRegistrationSucceeded: raw.canonicalRegistrationSucceeded as boolean,
    registrationOutcomeUnknown: raw.registrationOutcomeUnknown as boolean,
    rejectionCode: raw.rejectionCode as any,
    lastErrorCode: raw.lastErrorCode as EditorialBinaryIntakeErrorCode | undefined,
    lastErrorMessage: raw.lastErrorMessage as string | undefined,
  });
}

export function serializeIntakeSessionForPersistence(
  session: EditorialBinaryIntakeSession,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): Record<string, unknown> {
  const validated = validatePersistedIntakeSessionEnvelope(
    session,
    session.intakeId,
    limits
  );

  const cleanTrackedObject = (
    o: TrackedIntakeStorageObject
  ): Record<string, unknown> => ({
    storagePath: o.storagePath,
    namespace: o.namespace,
    generation: o.generation,
    etag: o.etag,
    sha256Checksum: o.sha256Checksum,
    sizeBytes: o.sizeBytes,
    contentType: o.contentType,
    createdByIntakeId: o.createdByIntakeId,
  });

  const serialized: Record<string, unknown> = {
    intakeId: validated.intakeId,
    targetKind: validated.targetKind,
    assetId: validated.assetId,
    uploaderUid: validated.uploaderUid,
    uploaderRole: validated.uploaderRole,
    requestFingerprint: validated.requestFingerprint,
    status: validated.status,
    revision: validated.revision,
    createdAt: validated.createdAt,
    updatedAt: validated.updatedAt,
    expiresAt: validated.expiresAt,
    createdQuarantineObjects: validated.createdQuarantineObjects.map(
      cleanTrackedObject
    ),
    createdPrivateObjects: validated.createdPrivateObjects.map(
      cleanTrackedObject
    ),
    pendingCleanupObjects: validated.pendingCleanupObjects.map(
      cleanTrackedObject
    ),
    canonicalRegistrationAttempted: validated.canonicalRegistrationAttempted,
    canonicalRegistrationSucceeded: validated.canonicalRegistrationSucceeded,
    registrationOutcomeUnknown: validated.registrationOutcomeUnknown,
  };

  if (validated.evidenceId !== undefined) {
    serialized.evidenceId = validated.evidenceId;
  }
  if (validated.binarySha256 !== undefined) {
    serialized.binarySha256 = validated.binarySha256;
  }
  if (validated.detectedMimeType !== undefined) {
    serialized.detectedMimeType = validated.detectedMimeType;
  }
  if (validated.binarySizeBytes !== undefined) {
    serialized.binarySizeBytes = validated.binarySizeBytes;
  }
  if (validated.width !== undefined) {
    serialized.width = validated.width;
  }
  if (validated.height !== undefined) {
    serialized.height = validated.height;
  }
  if (validated.aspectRatio !== undefined) {
    serialized.aspectRatio = validated.aspectRatio;
  }
  if (validated.rejectionCode !== undefined) {
    serialized.rejectionCode = validated.rejectionCode;
  }
  if (validated.lastErrorCode !== undefined) {
    serialized.lastErrorCode = validated.lastErrorCode;
  }
  if (validated.lastErrorMessage !== undefined) {
    serialized.lastErrorMessage = validated.lastErrorMessage;
  }

  return serialized;
}

/**
 * Dependency-injected Firestore implementation of IntakeSessionStore.
 *
 * Implements optimistic concurrency with explicit revisions, complete document
 * replacement, immutable identity assertions, and bounded deterministic
 * queries for reconciliation without unbounded collection scans.
 */
export class FirestoreEditorialBinaryIntakeSessionStore
  implements IntakeSessionStore
{
  public static readonly COLLECTION =
    EDITORIAL_BINARY_INTAKE_SESSION_COLLECTION;

  public static readonly DEFAULT_RECONCILIATION_LIMIT = 50 as const;
  public static readonly MAX_RECONCILIATION_LIMIT = 100 as const;

  private readonly db: IntakeSessionFirestoreDatabase;
  private readonly limits: EditorialImageAssetValidationLimits;

  constructor(
    db: IntakeSessionFirestoreDatabase,
    limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
  ) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message:
          'FirestoreEditorialBinaryIntakeSessionStore requires a valid structural Firestore database interface with transactions.',
      });
    }
    this.db = db;
    this.limits = limits;
  }

  private getDocRef(
    intakeId: string
  ): IntakeSessionFirestoreDocumentRef {
    const validId = validateIntakeId(intakeId);
    return this.db
      .collection(FirestoreEditorialBinaryIntakeSessionStore.COLLECTION)
      .doc(validId);
  }

  async createSessionIfAbsent(
    session: EditorialBinaryIntakeSession
  ): Promise<{
    readonly created: boolean;
    readonly session: EditorialBinaryIntakeSession;
  }> {
    const validatedInput = validatePersistedIntakeSessionEnvelope(
      session,
      session.intakeId,
      this.limits
    );

    if (validatedInput.revision !== 1) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `Initial session revision must be 1, received ${validatedInput.revision}.`,
        intakeId: validatedInput.intakeId,
      });
    }

    const docRef = this.getDocRef(validatedInput.intakeId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);

        if (snapshot && snapshot.exists) {
          const persisted = validatePersistedIntakeSessionEnvelope(
            snapshot.data(),
            validatedInput.intakeId,
            this.limits
          );
          return {
            created: false,
            session: cloneIntakeSessionRecord(persisted),
          };
        }

        const serialized = serializeIntakeSessionForPersistence(
          validatedInput,
          this.limits
        );

        if (typeof transaction.create === 'function') {
          transaction.create(docRef, serialized);
        } else {
          transaction.set(docRef, serialized);
        }

        return {
          created: true,
          session: cloneIntakeSessionRecord(validatedInput),
        };
      });
    } catch (err) {
      if (err instanceof EditorialBinaryIntakeError) {
        throw err;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Unknown Firestore transaction error.';
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Firestore transaction failed while creating intake session "${validatedInput.intakeId}": ${msg}`,
        intakeId: validatedInput.intakeId,
      });
    }
  }

  async getSessionById(
    intakeId: string
  ): Promise<EditorialBinaryIntakeSession | null> {
    const validId = validateIntakeId(intakeId);
    const docRef = this.getDocRef(validId);

    try {
      let snapshot: IntakeSessionFirestoreDocumentSnapshot;
      if (typeof docRef.get === 'function') {
        snapshot = await docRef.get();
      } else {
        snapshot = await this.db.runTransaction(async (tx) => tx.get(docRef));
      }

      if (!snapshot || !snapshot.exists) {
        return null;
      }

      const session = validatePersistedIntakeSessionEnvelope(
        snapshot.data(),
        validId,
        this.limits
      );
      return cloneIntakeSessionRecord(session);
    } catch (err) {
      if (err instanceof EditorialBinaryIntakeError) {
        throw err;
      }
      const msg =
        err instanceof Error ? err.message : 'Unknown Firestore read error.';
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Firestore read failed for intake session "${validId}": ${msg}`,
        intakeId: validId,
      });
    }
  }

  async updateSession(
    session: EditorialBinaryIntakeSession,
    expectedRevision: number
  ): Promise<EditorialBinaryIntakeSession> {
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      throw new EditorialBinaryIntakeError({
        code: 'INVALID_INPUT',
        message: `expectedRevision must be a positive safe integer (>= 1), received "${String(expectedRevision)}".`,
        intakeId: session?.intakeId,
      });
    }

    const validatedInput = validatePersistedIntakeSessionEnvelope(
      session,
      session.intakeId,
      this.limits
    );

    const docRef = this.getDocRef(validatedInput.intakeId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);

        if (!snapshot || !snapshot.exists) {
          throw new EditorialBinaryIntakeError({
            code: 'NOT_FOUND',
            message: `Intake session "${validatedInput.intakeId}" does not exist.`,
            intakeId: validatedInput.intakeId,
          });
        }

        const persisted = validatePersistedIntakeSessionEnvelope(
          snapshot.data(),
          validatedInput.intakeId,
          this.limits
        );

        if (persisted.revision !== expectedRevision) {
          throw new EditorialBinaryIntakeError({
            code: 'STORAGE_CONFLICT',
            message: `Intake session "${validatedInput.intakeId}" revision conflict: expected ${expectedRevision}, found stored revision ${persisted.revision}.`,
            intakeId: validatedInput.intakeId,
            sessionStatus: persisted.status,
          });
        }

        // Enforce immutable identity and binding properties
        if (
          persisted.targetKind !== validatedInput.targetKind ||
          persisted.assetId !== validatedInput.assetId ||
          persisted.evidenceId !== validatedInput.evidenceId ||
          persisted.uploaderUid !== validatedInput.uploaderUid ||
          persisted.uploaderRole !== validatedInput.uploaderRole ||
          persisted.requestFingerprint !== validatedInput.requestFingerprint ||
          persisted.createdAt !== validatedInput.createdAt
        ) {
          throw new EditorialBinaryIntakeError({
            code: 'STORAGE_CONFLICT',
            message: `Illegal attempt to mutate immutable identity/binding fields of intake session "${validatedInput.intakeId}".`,
            intakeId: validatedInput.intakeId,
            sessionStatus: persisted.status,
          });
        }

        const nextRevision = expectedRevision + 1;
        const nextSession: EditorialBinaryIntakeSession =
          cloneIntakeSessionRecord({
            ...validatedInput,
            revision: nextRevision,
          });

        const serialized = serializeIntakeSessionForPersistence(
          nextSession,
          this.limits
        );

        transaction.set(docRef, serialized);

        return cloneIntakeSessionRecord(nextSession);
      });
    } catch (err) {
      if (err instanceof EditorialBinaryIntakeError) {
        throw err;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Unknown Firestore transaction error.';
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Firestore transaction failed while updating intake session "${validatedInput.intakeId}": ${msg}`,
        intakeId: validatedInput.intakeId,
      });
    }
  }

  async listSessionsForReconciliation(options?: {
    readonly nowIso?: string;
    readonly limit?: number;
  }): Promise<readonly EditorialBinaryIntakeSession[]> {
    const collectionRef = this.db.collection(
      FirestoreEditorialBinaryIntakeSessionStore.COLLECTION
    );

    if (typeof collectionRef.where !== 'function') {
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message:
          'Firestore collection adapter lacks query capability (.where). Unbounded collection scans are prohibited for reconciliation.',
      });
    }

    const effectiveLimit = Math.min(
      Math.max(
        1,
        options?.limit ??
          FirestoreEditorialBinaryIntakeSessionStore.DEFAULT_RECONCILIATION_LIMIT
      ),
      FirestoreEditorialBinaryIntakeSessionStore.MAX_RECONCILIATION_LIMIT
    );

    const nowMs = options?.nowIso ? Date.parse(options.nowIso) : null;
    const candidateDocsMap = new Map<
      string,
      IntakeSessionFirestoreDocumentSnapshot
    >();

    // 1. Directly reconcilable non-terminal statuses: actionable regardless of expiration
    const directlyReconcilableStatuses: readonly EditorialBinaryIntakeSessionStatus[] = [
      'NeedsReconciliation',
      'CleanupPending',
      'Registering',
      'Registered',
    ];

    // 2. In-flight active statuses: actionable if expired (worker aborted during intake)
    const inFlightActiveStatuses: readonly EditorialBinaryIntakeSessionStatus[] = [
      'Created',
      'Quarantined',
      'PreliminarilyVerified',
      'Promoting',
    ];

    // Validate nowIso strictly if provided
    if (options?.nowIso !== undefined) {
      if (!isValidCanonicalUtcTimestamp(options.nowIso)) {
        throw new EditorialBinaryIntakeError({
          code: 'INVALID_INPUT',
          message: `Invalid nowIso timestamp "${String(options.nowIso)}". Must be a valid canonical UTC ISO-8601 string.`,
        });
      }
    }

    try {
      // 1. Query directly actionable statuses using composite-index prefix (status ASC, expiresAt ASC)
      for (const status of directlyReconcilableStatuses) {
        let query = collectionRef.where('status', '==', status);
        if (typeof query.orderBy === 'function') {
          query = query.orderBy('expiresAt', 'asc');
        }
        query = query.limit(effectiveLimit);
        const snap = await query.get();
        if (snap && Array.isArray(snap.docs)) {
          for (const doc of snap.docs) {
            if (doc && doc.exists) {
              const id = doc.id || (doc.data() as any)?.intakeId;
              if (id) {
                candidateDocsMap.set(id, doc);
              }
            }
          }
        }
      }

      // 2. Query expiry-gated statuses using compound composite-index query (status == X AND expiresAt <= nowIso ORDER BY expiresAt ASC)
      if (options?.nowIso !== undefined) {
        for (const status of inFlightActiveStatuses) {
          let query = collectionRef
            .where('status', '==', status)
            .where('expiresAt', '<=', options.nowIso);
          if (typeof query.orderBy === 'function') {
            query = query.orderBy('expiresAt', 'asc');
          }
          query = query.limit(effectiveLimit);
          const snap = await query.get();
          if (snap && Array.isArray(snap.docs)) {
            for (const doc of snap.docs) {
              if (doc && doc.exists) {
                const id = doc.id || (doc.data() as any)?.intakeId;
                if (id) {
                  candidateDocsMap.set(id, doc);
                }
              }
            }
          }
        }
      }

      // 3. Parse, validate, fail closed on corrupted documents, and filter actionable sessions
      const validSessions: EditorialBinaryIntakeSession[] = [];
      for (const doc of candidateDocsMap.values()) {
        let session: EditorialBinaryIntakeSession;
        try {
          session = validatePersistedIntakeSessionEnvelope(
            doc.data(),
            undefined,
            this.limits
          );
        } catch {
          const docId = typeof doc.id === 'string' ? doc.id : 'unknown';
          const safeId = docId.replace(/[^A-Za-z0-9_.:-]/g, '');
          throw new EditorialBinaryIntakeError({
            code: 'STORAGE_FAILURE',
            message: `Corrupted intake session record encountered during reconciliation discovery for document "${safeId}".`,
            intakeId: safeId !== 'unknown' ? safeId : undefined,
          });
        }

        const isDirectlyReconcilable =
          session.status === 'NeedsReconciliation' ||
          session.status === 'CleanupPending' ||
          session.status === 'Registering' ||
          session.status === 'Registered';

        const isExpiredUnfinished =
          nowMs !== null &&
          !Number.isNaN(nowMs) &&
          Date.parse(session.expiresAt) <= nowMs &&
          session.status !== 'Completed' &&
          !(
            session.status === 'Failed' &&
            session.pendingCleanupObjects.length === 0
          );

        if (isDirectlyReconcilable || isExpiredUnfinished) {
          validSessions.push(session);
        }
      }
      // 4. Deterministic ordering: by expiresAt ascending, then intakeId ascending
      validSessions.sort((a, b) => {
        const timeDiff =
          Date.parse(a.expiresAt) - Date.parse(b.expiresAt);
        if (timeDiff !== 0) {
          return timeDiff;
        }
        return a.intakeId.localeCompare(b.intakeId);
      });

      return Object.freeze(
        validSessions.slice(0, effectiveLimit).map(cloneIntakeSessionRecord)
      );
    } catch (err) {
      if (err instanceof EditorialBinaryIntakeError) {
        throw err;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Unknown Firestore query error.';
      throw new EditorialBinaryIntakeError({
        code: 'STORAGE_FAILURE',
        message: `Failed listing intake sessions for reconciliation: ${msg}`,
      });
    }
  }
}
