import { describe, expect, it } from 'vitest';
import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
  validateEditorialImageAsset,
} from '../../functions/src/shared/editorialImageAssetContract';
import type {
  EditorialImageAssetMetadata,
  RightsReviewStatus,
  UpdateEditorialImageAssetInput,
} from '../../functions/src/types/editorialImageAsset';
import {
  EDITORIAL_IMAGE_ASSET_COLLECTION,
  EditorialImageAssetRepositoryError,
  INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
  type EditorialImageAssetRepository,
  type EditorialImageAssetRepositoryRecord,
} from '../../functions/src/news/editorialImageAssetRepository';
import { InMemoryEditorialImageAssetRepository } from '../../functions/src/news/inMemoryEditorialImageAssetRepository';
import {
  FirestoreEditorialImageAssetRepository,
  type EditorialImageFirestoreCollectionRef,
  type EditorialImageFirestoreDatabase,
  type EditorialImageFirestoreDocumentRef,
  type EditorialImageFirestoreDocumentSnapshot,
  type EditorialImageFirestoreTransaction,
} from '../../functions/src/news/firestoreEditorialImageAssetRepository';

const VALID_SHA_A = 'a'.repeat(64);
const VALID_SHA_B = 'b'.repeat(64);
const BASE_CREATED_AT = '2026-01-15T10:00:00.000Z';

function buildValidPendingAsset(
  assetId = 'asset_repo_2026_01',
  overrides: Partial<EditorialImageAssetMetadata> = {}
): EditorialImageAssetMetadata {
  const base = createEditorialImageAssetRecord({
    assetId,
    createdByUid: 'editor_user_01',
    origin: 'news_article',
    originalFilename: 'solar-array.webp',
    mimeType: 'image/webp',
    originalSizeBytes: 512_000,
    originalWidth: 1600,
    originalHeight: 900,
    sha256Checksum: VALID_SHA_A,
    variants: {
      thumbnail: {
        variantKey: 'thumbnail',
        storagePath: buildEditorialImageVariantStoragePath(
          assetId,
          'thumbnail',
          'image/webp'
        ),
        mimeType: 'image/webp',
        width: 400,
        height: 225,
        sizeBytes: 48_000,
        sha256Checksum: VALID_SHA_B,
      },
    },
    altAr: 'محطة الطاقة الشمسية في الصحراء',
    altEn: 'Solar power station in the desert',
    captionAr: 'صورة توثيقية لمحطة الطاقة المتجددة',
    captionEn: 'Documentary photo of the renewable energy station',
    photographerCredit: 'عدسة وعد الكوكب',
    licensingInfo: 'ترخيص تحريري داخلي قيد المراجعة',
    tags: ['طاقة', 'مناخ'],
    associatedArticleIds: ['article_2026_01'],
    createdAtIso: BASE_CREATED_AT,
    updatedAtIso: BASE_CREATED_AT,
  });

  return {
    ...base,
    ...overrides,
  };
}

function deepCloneJson<T>(val: T): T {
  if (val === undefined || val === null) {
    return val;
  }
  return JSON.parse(JSON.stringify(val)) as T;
}

interface SimulatedFirestoreOperationLog {
  readonly type: 'get' | 'create' | 'set';
  readonly collectionName: string;
  readonly docId: string;
  readonly attempt: number;
  readonly extraArgsCount: number;
}

/**
 * Offline simulated Firestore transactional database double.
 * Executes atomic read-your-own-writes transactions in memory, supports
 * controlled corruption, fault injection, and optimistic concurrency
 * retry simulation with zero network or live credential access.
 */
class SimulatedFirestoreDatabase implements EditorialImageFirestoreDatabase {
  public readonly store: Map<string, unknown> = new Map();
  public readonly operationLogs: SimulatedFirestoreOperationLog[] = [];
  public failNextTransactionError: Error | null = null;
  public simulateConcurrentInterventionOnAttempt1:
    | ((docKey: string, store: Map<string, unknown>) => void)
    | null = null;
  private txQueue: Promise<void> = Promise.resolve();

  private makeKey(collectionName: string, docId: string): string {
    return `${collectionName}/${docId}`;
  }

  public setRawCorruptedDocument(
    collectionName: string,
    docId: string,
    rawPayload: unknown
  ): void {
    this.store.set(this.makeKey(collectionName, docId), rawPayload);
  }

  collection(collectionName: string): EditorialImageFirestoreCollectionRef {
    return {
      doc: (documentId: string): EditorialImageFirestoreDocumentRef => ({
        id: documentId,
      }),
    };
  }

  private enqueueTransaction<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.txQueue;
    let release!: () => void;
    this.txQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(async () => {
      try {
        return await work();
      } finally {
        release();
      }
    });
  }

  async runTransaction<T>(
    updateFunction: (
      transaction: EditorialImageFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    return this.enqueueTransaction(async () => {
      if (this.failNextTransactionError !== null) {
        const err = this.failNextTransactionError;
        this.failNextTransactionError = null;
        throw err;
      }

      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const stagedWrites = new Map<
          string,
          { mode: 'create' | 'set'; data: Record<string, unknown> }
        >();
        let touchedDocKey: string | null = null;

        const tx: EditorialImageFirestoreTransaction = {
          get: async (
            docRef: EditorialImageFirestoreDocumentRef
          ): Promise<EditorialImageFirestoreDocumentSnapshot> => {
            const key = this.makeKey(
              EDITORIAL_IMAGE_ASSET_COLLECTION,
              docRef.id
            );
            touchedDocKey = key;
            this.operationLogs.push({
              type: 'get',
              collectionName: EDITORIAL_IMAGE_ASSET_COLLECTION,
              docId: docRef.id,
              attempt,
              extraArgsCount: 0,
            });
            const exists = this.store.has(key);
            const raw = exists ? deepCloneJson(this.store.get(key)) : undefined;
            return {
              exists,
              id: docRef.id,
              data: () => deepCloneJson(raw),
            };
          },
          create: function (
            docRef: EditorialImageFirestoreDocumentRef,
            data: Record<string, unknown>
          ) {
            const key = `${EDITORIAL_IMAGE_ASSET_COLLECTION}/${docRef.id}`;
            touchedDocKey = key;
            stagedWrites.set(key, {
              mode: 'create',
              data: deepCloneJson(data),
            });
            return tx;
          },
          set: function (
            docRef: EditorialImageFirestoreDocumentRef,
            data: Record<string, unknown>,
            ...extraArgs: unknown[]
          ) {
            const key = `${EDITORIAL_IMAGE_ASSET_COLLECTION}/${docRef.id}`;
            touchedDocKey = key;
            stagedWrites.set(key, {
              mode: 'set',
              data: deepCloneJson(data),
            });
            // Record whether any unexpected 3rd argument (such as { merge: true }) was passed
            if (extraArgs.length > 0) {
              throw new Error(
                'Prohibited extra options argument passed to transaction.set().'
              );
            }
            return tx;
          },
        };

        const result = await updateFunction(tx);

        // Log staged writes for attempt
        for (const [key, write] of stagedWrites.entries()) {
          const [, docId] = key.split('/');
          this.operationLogs.push({
            type: write.mode,
            collectionName: EDITORIAL_IMAGE_ASSET_COLLECTION,
            docId,
            attempt,
            extraArgsCount: 0,
          });
        }

        // If configured to simulate a concurrent modification before attempt 1 commits,
        // apply the concurrent intervention and force a Firestore-like transaction retry.
        if (
          attempt === 1 &&
          this.simulateConcurrentInterventionOnAttempt1 !== null &&
          touchedDocKey !== null &&
          stagedWrites.size > 0
        ) {
          const hook = this.simulateConcurrentInterventionOnAttempt1;
          this.simulateConcurrentInterventionOnAttempt1 = null;
          hook(touchedDocKey, this.store);
          continue;
        }

        // Commit staged writes atomically
        for (const [key, write] of stagedWrites.entries()) {
          if (write.mode === 'create' && this.store.has(key)) {
            const err = new Error(`Document "${key}" already exists.`);
            (err as unknown as { code: string }).code = 'ALREADY_EXISTS';
            throw err;
          }
        }

        for (const [key, write] of stagedWrites.entries()) {
          this.store.set(key, deepCloneJson(write.data));
        }

        return result;
      }

      throw new Error('Transaction exceeded max attempts.');
    });
  }
}

async function expectRepositoryError(
  promise: Promise<unknown>,
  expectedCode: EditorialImageAssetRepositoryError['code'],
  messagePattern?: RegExp
): Promise<EditorialImageAssetRepositoryError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(EditorialImageAssetRepositoryError);
    const repoErr = err as EditorialImageAssetRepositoryError;
    expect(repoErr.code).toBe(expectedCode);
    if (messagePattern) {
      expect(repoErr.message).toMatch(messagePattern);
    }
    return repoErr;
  }
  throw new Error(
    `Expected repository call to fail with code "${expectedCode}", but it resolved successfully.`
  );
}

function runSharedRepositoryContractSuite(
  suiteLabel: string,
  createHarness: () => {
    repo: EditorialImageAssetRepository;
    corruptRecord: (assetId: string, rawPayload: unknown) => void;
    failNextOperation: (reason?: string) => void;
  }
) {
  describe(suiteLabel, () => {
    it('1. creates an asset with initial revision 1 and reads it back as a validated defensive copy', async () => {
      const { repo } = createHarness();
      const inputAsset = buildValidPendingAsset('asset_create_01');

      const created: EditorialImageAssetRepositoryRecord =
        await repo.createIfAbsent(inputAsset);

      expect(created.assetId).toBe('asset_create_01');
      expect(created.revision).toBe(INITIAL_EDITORIAL_IMAGE_ASSET_REVISION);
      expect(created.revision).toBe(1);
      expect(created.asset).toEqual(inputAsset);
      expect(
        Object.prototype.hasOwnProperty.call(created.asset, 'revision')
      ).toBe(false);
      expect(validateEditorialImageAsset(created.asset).valid).toBe(true);

      const readResult = await repo.getById('asset_create_01');
      expect(readResult.ok).toBe(true);
      expect(readResult.status).toBe('FOUND');
      if (readResult.ok) {
        expect(readResult.revision).toBe(1);
        expect(readResult.record.revision).toBe(1);
        expect(readResult.record.assetId).toBe('asset_create_01');
        expect(readResult.asset).toEqual(inputAsset);
        expect(
          Object.prototype.hasOwnProperty.call(readResult.asset, 'revision')
        ).toBe(false);
        expect(validateEditorialImageAsset(readResult.asset).valid).toBe(true);
      }
    });

    it('2. denies duplicate creation with ALREADY_EXISTS without overwriting the existing record', async () => {
      const { repo } = createHarness();
      const originalAsset = buildValidPendingAsset('asset_dup_01', {
        altAr: 'النص البديل الأصلي',
      });
      await repo.createIfAbsent(originalAsset);

      const conflictingDuplicate = buildValidPendingAsset('asset_dup_01', {
        altAr: 'محاولة استبدال غير مصرح بها',
      });

      await expectRepositoryError(
        repo.createIfAbsent(conflictingDuplicate),
        'ALREADY_EXISTS'
      );

      const readAfterDuplicate = await repo.getById('asset_dup_01');
      expect(readAfterDuplicate.ok).toBe(true);
      if (readAfterDuplicate.ok) {
        expect(readAfterDuplicate.revision).toBe(1);
        expect(readAfterDuplicate.asset.altAr).toBe('النص البديل الأصلي');
      }
    });

    it('3. returns NOT_FOUND for a missing record on getById and rejects updateEditorialMetadata with NOT_FOUND', async () => {
      const { repo } = createHarness();

      const missingRead = await repo.getById('non_existent_asset_99');
      expect(missingRead).toEqual({
        ok: false,
        status: 'NOT_FOUND',
        code: 'NOT_FOUND',
        assetId: 'non_existent_asset_99',
        record: null,
      });

      await expectRepositoryError(
        repo.updateEditorialMetadata('non_existent_asset_99', 1, {
          altAr: 'تحديث سجل غير موجود',
        }),
        'NOT_FOUND'
      );
    });

    it('4. rejects invalid canonical assets and non-active initial lifecycle statuses with INVALID_ASSET', async () => {
      const { repo } = createHarness();

      // Invalid assetId on getById
      await expectRepositoryError(
        repo.getById('invalid asset id with spaces!'),
        'INVALID_ASSET'
      );

      // Invalid sha256Checksum on createIfAbsent
      const badChecksumAsset = buildValidPendingAsset('asset_invalid_sha', {
        sha256Checksum: 'not-a-valid-sha256',
      });
      await expectRepositoryError(
        repo.createIfAbsent(badChecksumAsset),
        'INVALID_ASSET',
        /sha256Checksum/
      );

      // Invalid storagePath in variant on createIfAbsent
      const badVariantAsset = buildValidPendingAsset('asset_invalid_path', {
        variants: {
          thumbnail: {
            variantKey: 'thumbnail',
            storagePath: 'https://cdn.example.com/public/leak.webp',
            mimeType: 'image/webp',
            width: 400,
            height: 225,
            sizeBytes: 48_000,
            sha256Checksum: VALID_SHA_B,
          },
        },
      });
      await expectRepositoryError(
        repo.createIfAbsent(badVariantAsset),
        'INVALID_ASSET',
        /storagePath/
      );

      // Non-active initial lifecycle statuses ('archived' and 'deleted') rejected
      for (const nonActiveStatus of ['archived', 'deleted'] as const) {
        const nonActiveAsset = buildValidPendingAsset(
          `asset_status_${nonActiveStatus}`,
          {
            status: nonActiveStatus,
          }
        );
        await expectRepositoryError(
          repo.createIfAbsent(nonActiveAsset),
          'INVALID_ASSET',
          /lifecycle status must be "active"/
        );
      }

      // Unknown injected property on asset rejected
      const injectedPropAsset = {
        ...buildValidPendingAsset('asset_injected_prop'),
        revision: 99,
      } as unknown as EditorialImageAssetMetadata;
      await expectRepositoryError(
        repo.createIfAbsent(injectedPropAsset),
        'INVALID_ASSET'
      );
    });

    it('5. rejects non-PendingReview initial rights statuses (Approved, Rejected, Revoked) and pre-populated reviewer fields with INVALID_ASSET', async () => {
      const { repo } = createHarness();

      const validApprovedAsset = buildValidPendingAsset('asset_init_approved', {
        rights: {
          status: 'Approved',
          licenseType: 'OriginalWork',
          rightsHolder: 'Promise of Planet',
          sourceAttributionAr: 'فريق التحرير',
          evidenceRefs: ['ev:doc:2026:01'],
          usageScope: { scopeType: 'GeneralEditorial' },
          reviewedByUid: 'reviewer_01',
          reviewedAtIso: BASE_CREATED_AT,
        },
      });
      await expectRepositoryError(
        repo.createIfAbsent(validApprovedAsset),
        'INVALID_ASSET',
        /rights\.status must be "PendingReview"/
      );

      const validRejectedAsset = buildValidPendingAsset('asset_init_rejected', {
        rights: {
          status: 'Rejected',
          reviewedByUid: 'reviewer_01',
          reviewedAtIso: BASE_CREATED_AT,
          reviewReason: 'نقص وثائق الملكية الفكرية',
        },
      });
      await expectRepositoryError(
        repo.createIfAbsent(validRejectedAsset),
        'INVALID_ASSET',
        /rights\.status must be "PendingReview"/
      );

      const validRevokedAsset = buildValidPendingAsset('asset_init_revoked', {
        rights: {
          status: 'Revoked',
          reviewedByUid: 'reviewer_01',
          reviewedAtIso: BASE_CREATED_AT,
          reviewReason: 'انتهاء صلاحية الترخيص',
        },
      });
      await expectRepositoryError(
        repo.createIfAbsent(validRevokedAsset),
        'INVALID_ASSET',
        /rights\.status must be "PendingReview"/
      );

      // Also verify any unknown/invented rights status literal is rejected
      const unknownRightsStatusAsset = buildValidPendingAsset(
        'asset_init_unknown_rights',
        {
          rights: {
            status: 'Recalled' as unknown as RightsReviewStatus,
          },
        }
      );
      await expectRepositoryError(
        repo.createIfAbsent(unknownRightsStatusAsset),
        'INVALID_ASSET'
      );

      // PendingReview with pre-populated reviewer or license fields rejected
      const smuggledReviewerInPending = buildValidPendingAsset(
        'asset_smuggled_reviewer',
        {
          rights: {
            status: 'PendingReview',
            reviewedByUid: 'reviewer_01',
          },
        }
      );
      await expectRepositoryError(
        repo.createIfAbsent(smuggledReviewerInPending),
        'INVALID_ASSET'
      );

      const smuggledLicenseInPending = buildValidPendingAsset(
        'asset_smuggled_license',
        {
          rights: {
            status: 'PendingReview',
            licenseType: 'OriginalWork',
          },
        }
      );
      await expectRepositoryError(
        repo.createIfAbsent(smuggledLicenseInPending),
        'INVALID_ASSET'
      );
    });

    it('6. fails closed with INVALID_ASSET when reading or updating a corrupted persisted record', async () => {
      const { repo, corruptRecord } = createHarness();
      const validAsset = buildValidPendingAsset('asset_corrupt_01');
      await repo.createIfAbsent(validAsset);

      // Case A: Revision corrupted to 0
      corruptRecord('asset_corrupt_01', {
        assetId: 'asset_corrupt_01',
        revision: 0,
        asset: validAsset,
      });
      await expectRepositoryError(
        repo.getById('asset_corrupt_01'),
        'INVALID_ASSET',
        /revision/
      );
      await expectRepositoryError(
        repo.updateEditorialMetadata('asset_corrupt_01', 1, {
          altAr: 'محاولة تحديث سجل تالف',
        }),
        'INVALID_ASSET'
      );

      // Case B: Embedded canonical asset has mismatched assetId
      corruptRecord('asset_corrupt_01', {
        assetId: 'asset_corrupt_01',
        revision: 1,
        asset: {
          ...validAsset,
          assetId: 'different_asset_id',
        },
      });
      await expectRepositoryError(
        repo.getById('asset_corrupt_01'),
        'INVALID_ASSET',
        /assetId/
      );

      // Case C: Unexpected key on persisted storage envelope
      corruptRecord('asset_corrupt_01', {
        assetId: 'asset_corrupt_01',
        revision: 1,
        asset: validAsset,
        unexpectedEnvelopeField: true,
      });
      await expectRepositoryError(
        repo.getById('asset_corrupt_01'),
        'INVALID_ASSET',
        /Unexpected property/
      );
    });

    it('7. increments revision by 1 on each valid editorial metadata update and returns a canonical record', async () => {
      const { repo } = createHarness();
      const initialAsset = buildValidPendingAsset('asset_update_01');
      const created = await repo.createIfAbsent(initialAsset);
      expect(created.revision).toBe(1);

      const update1 = await repo.updateEditorialMetadata('asset_update_01', 1, {
        altAr: 'تحديث النص البديل العربي الأول',
        captionAr: 'تعليق عربي محدث',
        tags: ['طاقة_شمسية', 'استدامة'],
        associatedArticleIds: ['article_2026_01', 'article_2026_02'],
      });

      expect(update1.revision).toBe(2);
      expect(update1.asset.altAr).toBe('تحديث النص البديل العربي الأول');
      expect(update1.asset.captionAr).toBe('تعليق عربي محدث');
      expect(update1.asset.tags).toEqual(['طاقة_شمسية', 'استدامة']);
      expect(update1.asset.associatedArticleIds).toEqual([
        'article_2026_01',
        'article_2026_02',
      ]);
      expect(Date.parse(update1.asset.updatedAtIso)).toBeGreaterThanOrEqual(
        Date.parse(initialAsset.updatedAtIso)
      );
      expect(validateEditorialImageAsset(update1.asset).valid).toBe(true);

      // Second sequential update clearing optional captionEn and updating photographerCredit
      const update2 = await repo.updateEditorialMetadata('asset_update_01', 2, {
        captionEn: undefined,
        photographerCredit: 'وحدة التصوير البيئي',
      });

      expect(update2.revision).toBe(3);
      expect(update2.asset.photographerCredit).toBe('وحدة التصوير البيئي');
      expect(
        Object.prototype.hasOwnProperty.call(update2.asset, 'captionEn')
      ).toBe(false);
      expect(validateEditorialImageAsset(update2.asset).valid).toBe(true);

      const readAfterUpdates = await repo.getById('asset_update_01');
      expect(readAfterUpdates.ok).toBe(true);
      if (readAfterUpdates.ok) {
        expect(readAfterUpdates.revision).toBe(3);
        expect(readAfterUpdates.asset).toEqual(update2.asset);
      }
    });

    it('8. rejects stale or future expectedRevision with CONFLICT and malformed expectedRevision with INVALID_PATCH without modifying stored state', async () => {
      const { repo } = createHarness();
      const initialAsset = buildValidPendingAsset('asset_stale_01');
      await repo.createIfAbsent(initialAsset);

      // Advance to revision 2
      const rev2 = await repo.updateEditorialMetadata('asset_stale_01', 1, {
        altAr: 'النسخة المعتمدة رقم ٢',
      });
      expect(rev2.revision).toBe(2);

      // Attempt update with stale expectedRevision = 1
      await expectRepositoryError(
        repo.updateEditorialMetadata('asset_stale_01', 1, {
          altAr: 'محاولة كتابة فوق النسخة الثانية باستخدام رقم قديم',
        }),
        'CONFLICT',
        /expected revision 1, but current stored revision is 2/
      );

      // Attempt update with future expectedRevision = 3
      await expectRepositoryError(
        repo.updateEditorialMetadata('asset_stale_01', 3, {
          altAr: 'محاولة كتابة برقم مستقبلي',
        }),
        'CONFLICT',
        /expected revision 3, but current stored revision is 2/
      );

      // Attempt update with invalid non-positive / non-integer expectedRevision
      for (const badRev of [0, -1, 1.5, Number.NaN]) {
        await expectRepositoryError(
          repo.updateEditorialMetadata('asset_stale_01', badRev, {
            altAr: 'رقم إصدار غير صالح',
          }),
          'INVALID_PATCH'
        );
      }

      // Stored state must remain exactly revision 2
      const checkRead = await repo.getById('asset_stale_01');
      expect(checkRead.ok).toBe(true);
      if (checkRead.ok) {
        expect(checkRead.revision).toBe(2);
        expect(checkRead.asset.altAr).toBe('النسخة المعتمدة رقم ٢');
      }
    });

    it('9. ensures two conflicting concurrent updates against the same revision cannot both commit (exactly one succeeds at revision 2 and one fails with CONFLICT)', async () => {
      const { repo } = createHarness();
      const initialAsset = buildValidPendingAsset('asset_race_01');
      await repo.createIfAbsent(initialAsset);

      const [outcomeA, outcomeB] = await Promise.allSettled([
        repo.updateEditorialMetadata('asset_race_01', 1, {
          altAr: 'تحديث المتنافس الأول',
        }),
        repo.updateEditorialMetadata('asset_race_01', 1, {
          altAr: 'تحديث المتنافس الثاني',
        }),
      ]);

      const fulfilled = [outcomeA, outcomeB].filter(
        (r): r is PromiseFulfilledResult<EditorialImageAssetRepositoryRecord> =>
          r.status === 'fulfilled'
      );
      const rejected = [outcomeA, outcomeB].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      expect(fulfilled[0].value.revision).toBe(2);
      expect(rejected[0].reason).toBeInstanceOf(
        EditorialImageAssetRepositoryError
      );
      expect(
        (rejected[0].reason as EditorialImageAssetRepositoryError).code
      ).toBe('CONFLICT');

      const finalRead = await repo.getById('asset_race_01');
      expect(finalRead.ok).toBe(true);
      if (finalRead.ok) {
        expect(finalRead.revision).toBe(2);
        expect(finalRead.asset.altAr).toBe(fulfilled[0].value.asset.altAr);
      }
    });

    it('10. rejects attempts to update immutable identity, provenance, or binary integrity fields with INVALID_PATCH', async () => {
      const { repo } = createHarness();
      const initialAsset = buildValidPendingAsset('asset_immutable_01');
      await repo.createIfAbsent(initialAsset);

      const immutablePayloads: Record<string, unknown>[] = [
        { assetId: 'hijacked_asset_id' },
        { createdByUid: 'hijacked_user' },
        { createdAtIso: '2026-02-01T00:00:00.000Z' },
        { origin: 'standalone_upload' },
        { originalFilename: 'replaced.webp' },
        { mimeType: 'image/png' },
        { originalSizeBytes: 999_999 },
        { originalWidth: 800 },
        { originalHeight: 600 },
        { aspectRatio: 1.3333 },
        { sha256Checksum: VALID_SHA_B },
      ];

      for (const badPatch of immutablePayloads) {
        await expectRepositoryError(
          repo.updateEditorialMetadata(
            'asset_immutable_01',
            1,
            badPatch as unknown as UpdateEditorialImageAssetInput
          ),
          'INVALID_PATCH'
        );
      }

      const verifyUnchanged = await repo.getById('asset_immutable_01');
      expect(verifyUnchanged.ok).toBe(true);
      if (verifyUnchanged.ok) {
        expect(verifyUnchanged.revision).toBe(1);
        expect(verifyUnchanged.asset).toEqual(initialAsset);
      }
    });

    it('11. rejects attempts to update rights, reviewer, lifecycle status, variants, storage paths, or repository revision with INVALID_PATCH', async () => {
      const { repo } = createHarness();
      const initialAsset = buildValidPendingAsset('asset_protected_01');
      await repo.createIfAbsent(initialAsset);

      const protectedPayloads: Record<string, unknown>[] = [
        {
          rights: {
            status: 'Approved',
          },
        },
        { rightsStatus: 'Approved' },
        { reviewedByUid: 'admin_01' },
        { reviewedAtIso: '2026-02-01T00:00:00.000Z' },
        { reviewReason: 'bypass' },
        { licenseType: 'OriginalWork' },
        { rightsHolder: 'Bypass Holder' },
        { evidenceRefs: ['ev:1'] },
        { usageScope: { scopeType: 'GeneralEditorial' } },
        { status: 'archived' },
        { status: 'deleted' },
        { variants: {} },
        {
          storagePath:
            'editorial_images/private/asset_protected_01/thumbnail.webp',
        },
        { updatedAtIso: '2026-02-01T00:00:00.000Z' },
        { revision: 10 },
        { expectedRevision: 10 },
      ];

      for (const badPatch of protectedPayloads) {
        await expectRepositoryError(
          repo.updateEditorialMetadata(
            'asset_protected_01',
            1,
            badPatch as unknown as UpdateEditorialImageAssetInput
          ),
          'INVALID_PATCH'
        );
      }

      // Also verify invalid editorial values (e.g., empty altAr or prohibited URL in captionAr) fail closed with INVALID_PATCH
      await expectRepositoryError(
        repo.updateEditorialMetadata('asset_protected_01', 1, {
          altAr: '   ',
        }),
        'INVALID_PATCH'
      );
      await expectRepositoryError(
        repo.updateEditorialMetadata('asset_protected_01', 1, {
          captionAr: 'رابط خارجي ممنوع https://example.com/image.jpg',
        }),
        'INVALID_PATCH'
      );

      const verifyUnchanged = await repo.getById('asset_protected_01');
      expect(verifyUnchanged.ok).toBe(true);
      if (verifyUnchanged.ok) {
        expect(verifyUnchanged.revision).toBe(1);
        expect(verifyUnchanged.asset).toEqual(initialAsset);
      }
    });

    it('12. defensively clones caller inputs and returned records so external mutations cannot affect repository state', async () => {
      const { repo } = createHarness();
      const callerInput = buildValidPendingAsset('asset_clone_01');

      const created = await repo.createIfAbsent(callerInput);

      // Mutate caller input after createIfAbsent
      callerInput.altAr = 'تعديل خارجي بعد الإنشاء';
      callerInput.tags?.push('وسم_خارجي');
      callerInput.variants.thumbnail.width = 9999;
      callerInput.rights.status = 'Approved';

      // Mutate returned created record
      created.asset.altAr = 'تعديل على الكائن المرجع من الإنشاء';
      created.asset.tags?.push('وسم_مضاف');
      created.asset.variants.thumbnail.height = 8888;

      const read1 = await repo.getById('asset_clone_01');
      expect(read1.ok).toBe(true);
      if (read1.ok) {
        expect(read1.asset.altAr).toBe('محطة الطاقة الشمسية في الصحراء');
        expect(read1.asset.tags).toEqual(['طاقة', 'مناخ']);
        expect(read1.asset.variants.thumbnail.width).toBe(400);
        expect(read1.asset.variants.thumbnail.height).toBe(225);
        expect(read1.asset.rights.status).toBe('PendingReview');

        // Mutate read1 result and ensure subsequent read is still pristine
        read1.asset.altAr = 'تعديل على نتيجة القراءة';
        read1.record.asset.altAr = 'تعديل على السجل المقروء';
      }

      const patchTags = ['بيئة', 'مناخ_٢٠٢٦'];
      const patchInput: UpdateEditorialImageAssetInput = {
        altAr: 'عنوان بديل محدث بأمان',
        tags: patchTags,
      };
      const updated = await repo.updateEditorialMetadata(
        'asset_clone_01',
        1,
        patchInput
      );

      // Mutate caller patch array and returned updated record after update
      patchTags.push('وسم_متسلل');
      updated.asset.tags?.push('وسم_متسلل_آخر');

      const read2 = await repo.getById('asset_clone_01');
      expect(read2.ok).toBe(true);
      if (read2.ok) {
        expect(read2.revision).toBe(2);
        expect(read2.asset.altAr).toBe('عنوان بديل محدث بأمان');
        expect(read2.asset.tags).toEqual(['بيئة', 'مناخ_٢٠٢٦']);
      }
    });

    it('13. leaves the prior record completely intact when a transaction or persistence failure occurs', async () => {
      const { repo, failNextOperation } = createHarness();
      const initialAsset = buildValidPendingAsset('asset_tx_fail_01');
      await repo.createIfAbsent(initialAsset);

      failNextOperation('Simulated storage commit failure during update');

      await expectRepositoryError(
        repo.updateEditorialMetadata('asset_tx_fail_01', 1, {
          altAr: 'تحديث يجب ألا يُحفظ عند فشل المعاملة',
        }),
        'PERSISTENCE_FAILURE',
        /Simulated storage commit failure/
      );

      const readAfterFailure = await repo.getById('asset_tx_fail_01');
      expect(readAfterFailure.ok).toBe(true);
      if (readAfterFailure.ok) {
        expect(readAfterFailure.revision).toBe(1);
        expect(readAfterFailure.asset).toEqual(initialAsset);
      }
    });
  });
}

describe('EditorialImageAssetRepository — Concurrency, Envelope & Transaction Contract', () => {
  runSharedRepositoryContractSuite(
    'InMemoryEditorialImageAssetRepository',
    () => {
      const repo = new InMemoryEditorialImageAssetRepository();
      return {
        repo,
        corruptRecord: (assetId, rawPayload) =>
          repo.corruptStoredRecordForTesting(assetId, rawPayload),
        failNextOperation: (reason) => repo.failNextOperationForTesting(reason),
      };
    }
  );

  runSharedRepositoryContractSuite(
    'FirestoreEditorialImageAssetRepository (Offline Simulated Adapter)',
    () => {
      const db = new SimulatedFirestoreDatabase();
      const repo = new FirestoreEditorialImageAssetRepository(db);
      return {
        repo,
        corruptRecord: (assetId, rawPayload) =>
          db.setRawCorruptedDocument(
            EDITORIAL_IMAGE_ASSET_COLLECTION,
            assetId,
            rawPayload
          ),
        failNextOperation: (reason = 'Simulated Firestore transaction error') => {
          db.failNextTransactionError = new Error(reason);
        },
      };
    }
  );

  describe('14. Firestore transaction adapter specific guarantees', () => {
    it('addresses editorial_image_assets/{assetId}, uses transaction.create on creation, uses full transaction.set without merge on update, and re-reads/re-checks expectedRevision on transaction retry', async () => {
      const db = new SimulatedFirestoreDatabase();
      const repo = new FirestoreEditorialImageAssetRepository(db);
      const asset = buildValidPendingAsset('asset_fs_tx_01');

      await repo.createIfAbsent(asset);

      expect(db.operationLogs).toEqual([
        {
          type: 'get',
          collectionName: 'editorial_image_assets',
          docId: 'asset_fs_tx_01',
          attempt: 1,
          extraArgsCount: 0,
        },
        {
          type: 'create',
          collectionName: 'editorial_image_assets',
          docId: 'asset_fs_tx_01',
          attempt: 1,
          extraArgsCount: 0,
        },
      ]);

      db.operationLogs.length = 0;

      // Simulate a concurrent writer committing revision 2 right before attempt 1 of our transaction commits,
      // forcing Firestore to retry the transaction callback (attempt 2).
      db.simulateConcurrentInterventionOnAttempt1 = (docKey, store) => {
        const existing = store.get(docKey) as EditorialImageAssetRepositoryRecord;
        store.set(docKey, {
          ...existing,
          revision: 2,
          asset: {
            ...existing.asset,
            altAr: 'تعديل متزامن سبق المعاملة الأولى',
          },
        });
      };

      // On attempt 2, the transaction callback MUST re-read the document, see revision = 2 !== expectedRevision (1),
      // and fail closed with CONFLICT without overwriting revision 2.
      await expectRepositoryError(
        repo.updateEditorialMetadata('asset_fs_tx_01', 1, {
          altAr: 'تحديث متأخر خلال إعادة المحاولة',
        }),
        'CONFLICT',
        /expected revision 1, but current stored revision is 2/
      );

      // Verify attempt 1 ran get+set (aborted before commit) and attempt 2 re-ran get and aborted before set
      expect(
        db.operationLogs.map((l) => `${l.attempt}:${l.type}`)
      ).toEqual(['1:get', '1:set', '2:get']);

      const afterRetryConflict = await repo.getById('asset_fs_tx_01');
      expect(afterRetryConflict.ok).toBe(true);
      if (afterRetryConflict.ok) {
        expect(afterRetryConflict.revision).toBe(2);
        expect(afterRetryConflict.asset.altAr).toBe(
          'تعديل متزامن سبق المعاملة الأولى'
        );
      }
    });

    it(' preventspartial commit when InMemory onBeforeCommit hook throws during update', async () => {
      let shouldThrowOnUpdate = false;
      const repo = new InMemoryEditorialImageAssetRepository({
        onBeforeCommit: (op) => {
          if (op === 'update' && shouldThrowOnUpdate) {
            throw new Error('Hook aborted commit');
          }
        },
      });

      const asset = buildValidPendingAsset('asset_hook_rollback');
      await repo.createIfAbsent(asset);

      shouldThrowOnUpdate = true;
      await expectRepositoryError(
        repo.updateEditorialMetadata('asset_hook_rollback', 1, {
          altAr: 'لن يُكتب',
        }),
        'PERSISTENCE_FAILURE',
        /Hook aborted commit/
      );

      shouldThrowOnUpdate = false;
      const readRes = await repo.getById('asset_hook_rollback');
      expect(readRes.ok).toBe(true);
      if (readRes.ok) {
        expect(readRes.revision).toBe(1);
        expect(readRes.asset.altAr).toBe(asset.altAr);
      }
    });
  });
});
