import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetMetadata,
  type EditorialImageAssetValidationLimits,
  type UpdateEditorialImageAssetInput,
} from '../types/editorialImageAsset';
import {
  applyValidatedEditorialMetadataUpdate,
  buildFoundReadResult,
  buildNotFoundReadResult,
  cloneRepositoryRecord,
  EDITORIAL_IMAGE_ASSET_COLLECTION,
  EditorialImageAssetRepositoryError,
  INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
  serializeEnvelopeForPersistence,
  validateAndCloneInitialAssetForCreate,
  validateAndCloneUpdatePatch,
  validateExpectedRevision,
  validatePersistedEditorialImageAssetEnvelope,
  validateRepositoryAssetId,
  type EditorialImageAssetReadResult,
  type EditorialImageAssetRepository,
  type EditorialImageAssetRepositoryRecord,
} from './editorialImageAssetRepository';

export interface EditorialImageFirestoreDocumentSnapshot {
  readonly exists: boolean;
  readonly id?: string;
  data(): unknown;
}

export interface EditorialImageFirestoreDocumentRef {
  readonly id: string;
  get?(): Promise<EditorialImageFirestoreDocumentSnapshot>;
}

export interface EditorialImageFirestoreCollectionRef {
  doc(documentId: string): EditorialImageFirestoreDocumentRef;
}

/**
 * Structural Firestore transaction interface following the dependency-injected
 * repository pattern in functions/src/peia/firestoreAdvisoryResultRepository.ts.
 * Note: set() intentionally omits merge options so conditional updates always
 * write a complete validated envelope rather than performing partial merges.
 */
export interface EditorialImageFirestoreTransaction {
  get(
    docRef: EditorialImageFirestoreDocumentRef
  ): Promise<EditorialImageFirestoreDocumentSnapshot>;
  create(
    docRef: EditorialImageFirestoreDocumentRef,
    data: Record<string, unknown>
  ): EditorialImageFirestoreTransaction | void;
  set(
    docRef: EditorialImageFirestoreDocumentRef,
    data: Record<string, unknown>
  ): EditorialImageFirestoreTransaction | void;
}

export interface EditorialImageFirestoreDatabase {
  collection(collectionName: string): EditorialImageFirestoreCollectionRef;
  runTransaction<T>(
    updateFunction: (
      transaction: EditorialImageFirestoreTransaction
    ) => Promise<T>
  ): Promise<T>;
}

function isAlreadyExistsStorageError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as { code?: unknown; message?: unknown };
  if (
    candidate.code === 6 ||
    candidate.code === 'ALREADY_EXISTS' ||
    candidate.code === 'already-exists'
  ) {
    return true;
  }
  if (
    typeof candidate.message === 'string' &&
    /already[_\s-]?exists/i.test(candidate.message)
  ) {
    return true;
  }
  return false;
}

function wrapPersistenceError(
  operationLabel: string,
  assetId: string,
  err: unknown
): EditorialImageAssetRepositoryError {
  if (err instanceof EditorialImageAssetRepositoryError) {
    return err;
  }
  const causeMsg =
    err instanceof Error ? err.message : 'Unknown Firestore transaction error.';
  const detail = `Firestore ${operationLabel} failed for editorial image asset "${assetId}": ${causeMsg}`;
  return new EditorialImageAssetRepositoryError(
    'PERSISTENCE_FAILURE',
    detail,
    [detail],
    err
  );
}

/**
 * Dependency-injected Firestore adapter for EditorialImageAssetRepository.
 * Persists versioned envelopes under `editorial_image_assets/{assetId}` using
 * atomic Firestore transactions for create-if-absent and compare-and-swap
 * editorial metadata updates.
 */
export class FirestoreEditorialImageAssetRepository
  implements EditorialImageAssetRepository
{
  public static readonly COLLECTION = EDITORIAL_IMAGE_ASSET_COLLECTION;

  private readonly db: EditorialImageFirestoreDatabase;
  private readonly limits: EditorialImageAssetValidationLimits;

  constructor(
    db: EditorialImageFirestoreDatabase,
    limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
  ) {
    if (
      !db ||
      typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      const detail =
        'FirestoreEditorialImageAssetRepository requires a valid transactional Firestore database adapter.';
      throw new EditorialImageAssetRepositoryError(
        'PERSISTENCE_FAILURE',
        detail,
        [detail]
      );
    }
    this.db = db;
    this.limits = limits;
  }

  private getDocRef(assetId: string): EditorialImageFirestoreDocumentRef {
    return this.db
      .collection(FirestoreEditorialImageAssetRepository.COLLECTION)
      .doc(assetId);
  }

  async getById(assetId: string): Promise<EditorialImageAssetReadResult> {
    const validAssetId = validateRepositoryAssetId(assetId, this.limits);
    const docRef = this.getDocRef(validAssetId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot || typeof snapshot.exists !== 'boolean') {
          const detail = `Invalid Firestore document snapshot returned for asset "${validAssetId}".`;
          throw new EditorialImageAssetRepositoryError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }

        if (!snapshot.exists) {
          return buildNotFoundReadResult(validAssetId);
        }

        const rawData = snapshot.data();
        const validatedRecord = validatePersistedEditorialImageAssetEnvelope(
          validAssetId,
          rawData,
          this.limits
        );

        return buildFoundReadResult(validatedRecord, this.limits);
      });
    } catch (err) {
      throw wrapPersistenceError('getById', validAssetId, err);
    }
  }

  async createIfAbsent(
    asset: EditorialImageAssetMetadata
  ): Promise<EditorialImageAssetRepositoryRecord> {
    const validatedAsset = validateAndCloneInitialAssetForCreate(
      asset,
      this.limits
    );
    const docRef = this.getDocRef(validatedAsset.assetId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot || typeof snapshot.exists !== 'boolean') {
          const detail = `Invalid Firestore document snapshot returned during createIfAbsent for asset "${validatedAsset.assetId}".`;
          throw new EditorialImageAssetRepositoryError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }

        if (snapshot.exists) {
          const detail = `Editorial image asset "${validatedAsset.assetId}" already exists in "${FirestoreEditorialImageAssetRepository.COLLECTION}".`;
          throw new EditorialImageAssetRepositoryError(
            'ALREADY_EXISTS',
            detail,
            [detail]
          );
        }

        const initialRecord: EditorialImageAssetRepositoryRecord = {
          assetId: validatedAsset.assetId,
          revision: INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
          asset: validatedAsset,
        };

        const serialized = serializeEnvelopeForPersistence(
          initialRecord,
          this.limits
        );
        transaction.create(docRef, serialized);

        return cloneRepositoryRecord(initialRecord, this.limits);
      });
    } catch (err) {
      if (isAlreadyExistsStorageError(err)) {
        const detail = `Editorial image asset "${validatedAsset.assetId}" already exists in "${FirestoreEditorialImageAssetRepository.COLLECTION}".`;
        throw new EditorialImageAssetRepositoryError(
          'ALREADY_EXISTS',
          detail,
          [detail],
          err
        );
      }
      throw wrapPersistenceError(
        'createIfAbsent',
        validatedAsset.assetId,
        err
      );
    }
  }

  async updateEditorialMetadata(
    assetId: string,
    expectedRevision: number,
    patch: UpdateEditorialImageAssetInput
  ): Promise<EditorialImageAssetRepositoryRecord> {
    const validAssetId = validateRepositoryAssetId(assetId, this.limits);
    const validRevision = validateExpectedRevision(expectedRevision);
    const clonedPatch = validateAndCloneUpdatePatch(patch);
    const docRef = this.getDocRef(validAssetId);

    try {
      return await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot || typeof snapshot.exists !== 'boolean') {
          const detail = `Invalid Firestore document snapshot returned during updateEditorialMetadata for asset "${validAssetId}".`;
          throw new EditorialImageAssetRepositoryError(
            'PERSISTENCE_FAILURE',
            detail,
            [detail]
          );
        }

        if (!snapshot.exists) {
          const detail = `Editorial image asset "${validAssetId}" was not found in "${FirestoreEditorialImageAssetRepository.COLLECTION}".`;
          throw new EditorialImageAssetRepositoryError('NOT_FOUND', detail, [
            detail,
          ]);
        }

        const rawData = snapshot.data();
        const currentRecord = validatePersistedEditorialImageAssetEnvelope(
          validAssetId,
          rawData,
          this.limits
        );

        const nextRecord = applyValidatedEditorialMetadataUpdate(
          currentRecord,
          validRevision,
          clonedPatch,
          this.limits
        );

        const serialized = serializeEnvelopeForPersistence(
          nextRecord,
          this.limits
        );
        transaction.set(docRef, serialized);

        return cloneRepositoryRecord(nextRecord, this.limits);
      });
    } catch (err) {
      throw wrapPersistenceError('updateEditorialMetadata', validAssetId, err);
    }
  }
}
