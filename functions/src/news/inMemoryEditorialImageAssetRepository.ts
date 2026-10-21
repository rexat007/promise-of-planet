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

export interface InMemoryEditorialImageAssetRepositoryOptions {
  readonly limits?: EditorialImageAssetValidationLimits;
  readonly onBeforeCommit?: (
    operation: 'create' | 'update',
    candidate: EditorialImageAssetRepositoryRecord
  ) => Promise<void> | void;
}

/**
 * Isolated in-memory implementation of EditorialImageAssetRepository.
 * Serializes all read-verify-write transactions through a strict mutex queue
 * so concurrent async compare-and-swap calls cannot interleave or overwrite
 * each other.
 */
export class InMemoryEditorialImageAssetRepository
  implements EditorialImageAssetRepository
{
  private readonly records: Map<string, unknown> = new Map();
  private readonly limits: EditorialImageAssetValidationLimits;
  private readonly onBeforeCommit?: (
    operation: 'create' | 'update',
    candidate: EditorialImageAssetRepositoryRecord
  ) => Promise<void> | void;
  private transactionTail: Promise<void> = Promise.resolve();
  private pendingSimulatedFailureMessage: string | null = null;

  constructor(options: InMemoryEditorialImageAssetRepositoryOptions = {}) {
    this.limits = options.limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;
    this.onBeforeCommit = options.onBeforeCommit;
  }

  private runAtomicTransaction<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let releaseLock!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    return previous.then(async () => {
      try {
        return await work();
      } finally {
        releaseLock();
      }
    });
  }

  private consumeSimulatedFailureIfSet(): void {
    if (this.pendingSimulatedFailureMessage !== null) {
      const msg = this.pendingSimulatedFailureMessage;
      this.pendingSimulatedFailureMessage = null;
      throw new EditorialImageAssetRepositoryError(
        'PERSISTENCE_FAILURE',
        msg,
        [msg]
      );
    }
  }

  async getById(assetId: string): Promise<EditorialImageAssetReadResult> {
    const validAssetId = validateRepositoryAssetId(assetId, this.limits);

    return this.runAtomicTransaction(async () => {
      this.consumeSimulatedFailureIfSet();

      if (!this.records.has(validAssetId)) {
        return buildNotFoundReadResult(validAssetId);
      }

      const rawStored = this.records.get(validAssetId);
      const validated = validatePersistedEditorialImageAssetEnvelope(
        validAssetId,
        rawStored,
        this.limits
      );

      return buildFoundReadResult(validated, this.limits);
    });
  }

  async createIfAbsent(
    asset: EditorialImageAssetMetadata
  ): Promise<EditorialImageAssetRepositoryRecord> {
    const validatedAsset = validateAndCloneInitialAssetForCreate(
      asset,
      this.limits
    );

    return this.runAtomicTransaction(async () => {
      this.consumeSimulatedFailureIfSet();

      if (this.records.has(validatedAsset.assetId)) {
        const detail = `Editorial image asset "${validatedAsset.assetId}" already exists.`;
        throw new EditorialImageAssetRepositoryError(
          'ALREADY_EXISTS',
          detail,
          [detail]
        );
      }

      const initialEnvelope: EditorialImageAssetRepositoryRecord = {
        assetId: validatedAsset.assetId,
        revision: INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
        asset: validatedAsset,
      };

      const serialized = serializeEnvelopeForPersistence(
        initialEnvelope,
        this.limits
      );

      if (this.onBeforeCommit) {
        try {
          await this.onBeforeCommit(
            'create',
            cloneRepositoryRecord(initialEnvelope, this.limits)
          );
        } catch (err) {
          if (err instanceof EditorialImageAssetRepositoryError) {
            throw err;
          }
          const msg =
            err instanceof Error
              ? err.message
              : 'In-memory transaction commit aborted.';
          throw new EditorialImageAssetRepositoryError(
            'PERSISTENCE_FAILURE',
            msg,
            [msg],
            err
          );
        }
      }

      this.records.set(validatedAsset.assetId, serialized);
      return cloneRepositoryRecord(initialEnvelope, this.limits);
    });
  }

  async updateEditorialMetadata(
    assetId: string,
    expectedRevision: number,
    patch: UpdateEditorialImageAssetInput
  ): Promise<EditorialImageAssetRepositoryRecord> {
    const validAssetId = validateRepositoryAssetId(assetId, this.limits);
    const validRevision = validateExpectedRevision(expectedRevision);
    const clonedPatch = validateAndCloneUpdatePatch(patch);

    return this.runAtomicTransaction(async () => {
      this.consumeSimulatedFailureIfSet();

      if (!this.records.has(validAssetId)) {
        const detail = `Editorial image asset "${validAssetId}" was not found.`;
        throw new EditorialImageAssetRepositoryError('NOT_FOUND', detail, [
          detail,
        ]);
      }

      const rawStored = this.records.get(validAssetId);
      const currentRecord = validatePersistedEditorialImageAssetEnvelope(
        validAssetId,
        rawStored,
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

      if (this.onBeforeCommit) {
        try {
          await this.onBeforeCommit(
            'update',
            cloneRepositoryRecord(nextRecord, this.limits)
          );
        } catch (err) {
          if (err instanceof EditorialImageAssetRepositoryError) {
            throw err;
          }
          const msg =
            err instanceof Error
              ? err.message
              : 'In-memory transaction commit aborted.';
          throw new EditorialImageAssetRepositoryError(
            'PERSISTENCE_FAILURE',
            msg,
            [msg],
            err
          );
        }
      }

      this.records.set(validAssetId, serialized);
      return cloneRepositoryRecord(nextRecord, this.limits);
    });
  }

  /**
   * Test-only helper allowing controlled injection of a malformed/corrupted
   * persisted record to verify fail-closed read and update behavior.
   */
  corruptStoredRecordForTesting(assetId: string, corruptedPayload: unknown): void {
    this.records.set(assetId, corruptedPayload);
  }

  /**
   * Test-only helper that forces the next repository transaction to fail with
   * PERSISTENCE_FAILURE before committing any write.
   */
  failNextOperationForTesting(
    reason = 'Simulated repository persistence failure.'
  ): void {
    this.pendingSimulatedFailureMessage = reason;
  }
}
